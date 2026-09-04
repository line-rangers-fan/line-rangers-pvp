"""Validation helpers for the published character and equipment statistics."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone


EQUIPMENT_TYPES = ("WEAPON", "ARMOR", "ACC")
MAX_CHARACTERS_PER_PLAYER = 10
# Schema 11 requires an explicit comparison-baseline mode.  This prevents a
# rolling "one day ago" value from being shown under the fixed daily/weekly/
# monthly close labels used by the public selector.
SCHEMA_VERSION = 11
RANK_PERIODS = ("hour", "day", "week", "month")
CALENDAR_CLOSE_REFERENCE_MODE = "jst_calendar_close_v1"
# A collection may retry and verify a suspect player, but a slow upstream must
# never occupy later update windows.  Fifteen minutes leaves several bounded
# retry passes while making recovery from an outage prompt.
MAX_COLLECTION_DURATION_SECONDS = 15 * 60


def assign_competition_ranks(rows: list[dict]) -> list[dict]:
    """Assign 1, 2, 2, 4-style ranks to rows already sorted by usage."""
    previous_count: int | None = None
    current_rank = 0
    for index, row in enumerate(rows, start=1):
        count = int(row["occurrence_count"])
        if count != previous_count:
            current_rank = index
        row["rank"] = current_rank
        previous_count = count
    return rows


def equipment_rankings(records: list[dict]) -> dict[str, list[dict]]:
    """Aggregate equipment while counting copies and unique players separately."""
    totals = {
        kind: defaultdict(
            lambda: {
                "item_code": "",
                "image": "",
                "occurrence_count": 0,
                "player_count": 0,
            }
        )
        for kind in EQUIPMENT_TYPES
    }

    for record in records:
        seen = {kind: set() for kind in EQUIPMENT_TYPES}
        for item in record.get("equipment", []):
            kind = str(item.get("type", "")).upper()
            item_code = str(item.get("item_code") or item.get("id") or "").strip()
            if kind not in totals or not item_code:
                continue

            row = totals[kind][item_code]
            row["item_code"] = item_code
            row["image"] = str(item.get("image") or "")
            row["occurrence_count"] += 1
            seen[kind].add(item_code)

        for kind, item_codes in seen.items():
            for item_code in item_codes:
                totals[kind][item_code]["player_count"] += 1

    result: dict[str, list[dict]] = {}
    for kind, values in totals.items():
        rows = list(values.values())
        rows.sort(
            key=lambda row: (
                -int(row["occurrence_count"]),
                -int(row["player_count"]),
                str(row["item_code"]),
            )
        )
        result[kind] = assign_competition_ranks(rows)
    return result


def _number_matches(actual: object, expected: float, tolerance: float = 0.001) -> bool:
    try:
        number = float(actual)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and abs(number - expected) <= tolerance


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _validate_period_change(value: object, errors: list[str]) -> None:
    """Validate additive day/week/month rank-change metadata."""
    if not isinstance(value, dict):
        errors.append("invalid period rank change")
        return
    comparable = value.get("comparable")
    if not isinstance(comparable, bool):
        errors.append("invalid period comparability")
        return
    rank = value.get("rank")
    occurrence_count = value.get("occurrence_count")
    source_time = value.get("from_updated_at")
    interval = value.get("interval_minutes")
    if not comparable:
        if (
            rank is not None
            or occurrence_count is not None
            or source_time is not None
            or interval is not None
        ):
            errors.append("non-comparable period contains values")
        return
    if rank is not None and (not isinstance(rank, int) or isinstance(rank, bool)):
        errors.append("invalid period rank")
    if not isinstance(occurrence_count, int) or isinstance(occurrence_count, bool):
        errors.append("invalid period occurrence count")
    if _parse_time(source_time) is None:
        errors.append("invalid period source timestamp")
    try:
        interval_number = float(interval)
    except (TypeError, ValueError):
        interval_number = -1.0
    if not math.isfinite(interval_number) or interval_number <= 0:
        errors.append("invalid period interval")


def _validate_periods(value: object, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append("invalid period rank changes")
        return
    for period in RANK_PERIODS:
        if period not in value:
            errors.append(f"missing {period} rank change")
        else:
            _validate_period_change(value[period], errors)


def _validate_public_comparison(data: dict, errors: list[str]) -> None:
    """Validate the four public baselines even without a previous JSON file."""
    comparison = data.get("comparison")
    if not isinstance(comparison, dict):
        errors.append("missing previous comparison")
        return
    if comparison.get("reference_mode") != CALENDAR_CLOSE_REFERENCE_MODE:
        errors.append("invalid comparison reference mode")
    current_time = _parse_time(data.get("updated_at"))
    if current_time is None:
        return
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    jst = timezone(timedelta(hours=9))
    local_date = current_time.astimezone(jst).date()
    if comparison.get("calendar_date") != local_date.isoformat():
        errors.append("comparison calendar date mismatch")
    close_dates = {
        "day": local_date - timedelta(days=1),
        "week": local_date - timedelta(days=local_date.weekday() + 1),
        "month": local_date.replace(day=1) - timedelta(days=1),
    }
    summaries = comparison.get("periods")
    if not isinstance(summaries, dict):
        errors.append("missing comparison periods")
        summaries = {}
    for period in RANK_PERIODS:
        summary = summaries.get(period)
        if not isinstance(summary, dict) or not isinstance(summary.get("comparable"), bool):
            errors.append(f"invalid {period} comparison summary")
            continue
        if not summary["comparable"]:
            if summary.get("updated_at") is not None or summary.get("calendar_date") is not None:
                errors.append("non-comparable comparison contains a baseline")
            continue
        reference = _parse_time(summary.get("updated_at"))
        if reference is None or reference.tzinfo is None:
            errors.append("invalid comparison period timestamp")
            continue
        local_reference = reference.astimezone(jst)
        age = (current_time - reference).total_seconds()
        if summary.get("calendar_date") != local_reference.date().isoformat():
            errors.append("comparison period calendar date mismatch")
        if period == "hour":
            if not 30 * 60 <= age <= 90 * 60:
                errors.append("hour comparison outside verified window")
        elif local_reference.date() != close_dates[period] or local_reference.hour not in (22, 23):
            errors.append("comparison does not use the fixed JST close")

    def validate_row(row: dict) -> None:
        change = row.get("change")
        periods = change.get("periods") if isinstance(change, dict) else None
        _validate_periods(periods, errors)
        if not isinstance(periods, dict):
            return
        for period in RANK_PERIODS:
            value = periods.get(period)
            if not isinstance(value, dict) or value.get("comparable") is not True:
                continue
            summary = summaries.get(period)
            if (
                not isinstance(summary, dict)
                or summary.get("comparable") is not True
                or value.get("from_updated_at") != summary.get("updated_at")
            ):
                errors.append("row comparison baseline mismatch")
                continue
            reference = _parse_time(value.get("from_updated_at"))
            if reference is not None and reference.tzinfo is not None:
                interval = round((current_time - reference).total_seconds() / 60, 1)
                if not _number_matches(value.get("interval_minutes"), interval):
                    errors.append("row comparison interval mismatch")

    for row in data.get("characters", []):
        validate_row(row)
        for category in row.get("equipment_rankings", {}).values():
            for item in category.get("items", []):
                validate_row(item)


def _validate_comparison(data: dict, previous: dict, errors: list[str]) -> None:
    comparison = data.get("comparison")
    if not isinstance(comparison, dict):
        errors.append("missing previous comparison")
        return

    if comparison.get("reference_mode") != CALENDAR_CLOSE_REFERENCE_MODE:
        errors.append("invalid comparison reference mode")

    if comparison.get("previous_updated_at") != previous.get("updated_at"):
        errors.append("previous timestamp mismatch")

    old_time = _parse_time(previous.get("updated_at"))
    new_time = _parse_time(data.get("updated_at"))
    if old_time and new_time:
        expected_interval = round((new_time - old_time).total_seconds() / 60, 1)
        if not _number_matches(
            comparison.get("interval_minutes"),
            expected_interval,
        ):
            errors.append("comparison interval mismatch")

    characters = data.get("characters", [])
    previous_rows = {
        str(row.get("unit_code")): row
        for row in previous.get("characters", [])
        if isinstance(row, dict) and row.get("unit_code")
    }
    current_codes = {
        str(row.get("unit_code"))
        for row in characters
        if isinstance(row, dict) and row.get("unit_code")
    }
    expected_new = sum(
        1 for row in characters if str(row.get("unit_code")) not in previous_rows
    )
    expected_removed = len(set(previous_rows) - current_codes)
    if int(comparison.get("new_characters", -1)) != expected_new:
        errors.append("new character comparison mismatch")
    if int(comparison.get("removed_characters", -1)) != expected_removed:
        errors.append("removed character comparison mismatch")

    for row in characters:
        code = str(row.get("unit_code"))
        change = row.get("change")
        if not isinstance(change, dict):
            errors.append("missing character change")
            continue
        old = previous_rows.get(code)
        if old is None:
            if change.get("new") is not True or any(
                key not in {"new", "periods"} for key in change
            ):
                errors.append("invalid new character change")
            if "periods" in change:
                _validate_periods(change["periods"], errors)
            continue

        expected = {
            "new": False,
            "rank": int(old.get("rank", 0)) - int(row.get("rank", 0)),
            "occurrence_count": int(row.get("occurrence_count", 0))
            - int(old.get("occurrence_count", 0)),
            "player_count": int(row.get("player_count", 0))
            - int(old.get("player_count", 0)),
            "adoption_rate": round(
                float(row.get("adoption_rate", 0))
                - float(old.get("adoption_rate", 0)),
                1,
            ),
        }
        if any(change.get(key) != value for key, value in expected.items()):
            errors.append("invalid character change")
        if any(key not in set(expected) | {"periods"} for key in change):
            errors.append("invalid character change fields")
        if "periods" in change:
            _validate_periods(change["periods"], errors)

    comparison_periods = comparison.get("periods")
    if comparison_periods is not None:
        if not isinstance(comparison_periods, dict):
            errors.append("invalid comparison periods")
        else:
            for period in RANK_PERIODS:
                summary = comparison_periods.get(period)
                if not isinstance(summary, dict) or not isinstance(
                    summary.get("comparable"), bool
                ):
                    errors.append("invalid comparison period summary")
                    continue
                if summary["comparable"]:
                    if _parse_time(summary.get("updated_at")) is None:
                        errors.append("invalid comparison period timestamp")
                elif summary.get("updated_at") is not None:
                    errors.append("non-comparable comparison period timestamp")


def _validate_data(data: dict, previous: dict | None = None) -> bool:
    """Reject incomplete, inconsistent, or statistically impossible output."""
    errors: list[str] = []
    schema_version = int(data.get("schema_version", 0))
    players = int(data.get("sampled_players", 0))
    target_players = int(data.get("target_players", 0))
    slots = int(data.get("character_slots", 0))
    characters = data.get("characters")

    if schema_version < SCHEMA_VERSION:
        errors.append("unsupported schema")
    if _parse_time(data.get("updated_at")) is None:
        errors.append("invalid updated timestamp")
    if players <= 0 or not isinstance(characters, list) or not characters:
        errors.append("invalid sample")
        characters = []
    if (
        target_players <= 0
        or players != target_players
        or data.get("complete_target") is not True
    ):
        errors.append("incomplete sample")
    if slots < players or slots > players * MAX_CHARACTERS_PER_PLAYER:
        errors.append("invalid slot range")
    if sum(int(char.get("occurrence_count", 0)) for char in characters) != slots:
        errors.append("slot total mismatch")
    if int(data.get("unique_characters", -1)) != len(characters):
        errors.append("unique character total mismatch")

    unit_codes = [str(char.get("unit_code") or "") for char in characters]
    if any(not code for code in unit_codes) or len(unit_codes) != len(set(unit_codes)):
        errors.append("duplicate or missing character unit code")
    cached_image_count = 0
    for character, unit_code in zip(characters, unit_codes):
        cached_image = character.get("cached_image")
        if cached_image is None:
            continue
        if cached_image != f"./assets/characters/{unit_code}.png":
            errors.append("invalid cached character image")
        else:
            cached_image_count += 1

    character_assets = data.get("character_assets")
    if character_assets is not None:
        if not isinstance(character_assets, dict):
            errors.append("invalid character asset summary")
        else:
            try:
                asset_characters = int(character_assets.get("characters", -1))
                asset_cached = int(character_assets.get("cached_images", -1))
                asset_pending = int(character_assets.get("pending_images", -1))
                asset_downloaded = int(character_assets.get("downloaded_images", -1))
            except (TypeError, ValueError):
                errors.append("invalid character asset summary")
            else:
                if (
                    asset_characters != len(characters)
                    or asset_cached != cached_image_count
                    or asset_pending != len(characters) - cached_image_count
                    or not 0 <= asset_downloaded <= asset_cached
                ):
                    errors.append("character asset summary mismatch")

    expected_order = sorted(
        characters,
        key=lambda row: (
            -int(row.get("occurrence_count", 0)),
            -int(row.get("player_count", 0)),
            str(row.get("unit_code") or ""),
        ),
    )
    if unit_codes != [str(row.get("unit_code") or "") for row in expected_order]:
        errors.append("character sort order mismatch")

    equipment_slots_collected = 0
    previous_character_count: int | None = None
    previous_character_rank = 0
    for index, character in enumerate(characters, start=1):
        if not str(character.get("name") or "").strip():
            errors.append("missing character name")
            continue
        occurrence_count = int(character.get("occurrence_count", 0))
        player_count = int(character.get("player_count", 0))
        if (
            occurrence_count <= 0
            or player_count <= 0
            or occurrence_count < player_count
            or player_count > players
        ):
            errors.append("invalid character counts")
            continue

        expected_rank = (
            index
            if occurrence_count != previous_character_count
            else previous_character_rank
        )
        if int(character.get("rank", 0)) != expected_rank:
            errors.append("invalid character rank")
        previous_character_count = occurrence_count
        previous_character_rank = expected_rank

        if not _number_matches(
            character.get("adoption_rate"),
            round(player_count / players * 100, 1),
        ):
            errors.append("character adoption rate mismatch")
        if not _number_matches(
            character.get("slot_rate"),
            round(occurrence_count / slots * 100, 2),
        ):
            errors.append("character slot rate mismatch")

        rankings = character.get("equipment_rankings")
        if not isinstance(rankings, dict):
            errors.append("missing equipment rankings")
            continue

        for equipment_type in EQUIPMENT_TYPES:
            category = rankings.get(equipment_type)
            if not isinstance(category, dict):
                errors.append(f"missing {equipment_type} ranking")
                continue

            category_occurrences = int(category.get("equipped_occurrence_count", 0))
            category_players = int(category.get("equipped_player_count", 0))
            items = category.get("items")
            if (
                category_occurrences < 0
                or category_occurrences > occurrence_count
                or category_players < 0
                or category_players > player_count
                or not isinstance(items, list)
            ):
                errors.append(f"invalid {equipment_type} totals")
                continue
            equipment_slots_collected += category_occurrences

            expected_items = sorted(
                items,
                key=lambda item: (
                    -int(item.get("occurrence_count", 0)),
                    -int(item.get("player_count", 0)),
                    str(item.get("item_code") or ""),
                ),
            )
            if items != expected_items:
                errors.append(f"invalid {equipment_type} sort order")

            item_codes: set[str] = set()
            item_occurrences = 0
            previous_item_count: int | None = None
            previous_rank = 0
            for item_index, item in enumerate(items, start=1):
                item_code = str(item.get("item_code") or "").strip()
                item_count = int(item.get("occurrence_count", 0))
                item_players = int(item.get("player_count", 0))
                if (
                    not item_code
                    or item_code in item_codes
                    or item_count <= 0
                    or item_players <= 0
                    or item_count < item_players
                    or item_count > category_occurrences
                    or item_players > category_players
                ):
                    errors.append(f"invalid {equipment_type} item")
                    break
                item_codes.add(item_code)

                expected_item_rank = (
                    item_index if item_count != previous_item_count else previous_rank
                )
                if int(item.get("rank", 0)) != expected_item_rank:
                    errors.append(f"invalid {equipment_type} rank")
                    break
                if not _number_matches(
                    item.get("adoption_rate"),
                    round(item_players / player_count * 100, 1),
                ):
                    errors.append(f"invalid {equipment_type} adoption rate")

                item_change = item.get("change")
                if item_change is not None:
                    if not isinstance(item_change, dict):
                        errors.append(f"invalid {equipment_type} item change")
                    else:
                        if not isinstance(item_change.get("new"), bool):
                            errors.append(f"invalid {equipment_type} item change flag")
                        if not isinstance(item_change.get("rank"), int) or isinstance(
                            item_change.get("rank"), bool
                        ):
                            errors.append(f"invalid {equipment_type} item change rank")
                        if "periods" not in item_change:
                            errors.append(f"missing {equipment_type} item period changes")
                        else:
                            _validate_periods(item_change["periods"], errors)

                item_occurrences += item_count
                previous_item_count = item_count
                previous_rank = expected_item_rank

            if item_occurrences != category_occurrences:
                errors.append(f"{equipment_type} total mismatch")

    quality = data.get("collection_quality")
    if not isinstance(quality, dict):
        errors.append("missing collection quality")
    else:
        expected_equipment_slots = slots * len(EQUIPMENT_TYPES)
        collection_started_at = _parse_time(quality.get("collection_started_at"))
        collection_duration = quality.get("collection_duration_seconds")
        detail_duration = quality.get("detail_fetch_duration_seconds")
        try:
            collection_duration = float(collection_duration)
            detail_duration = float(detail_duration)
        except (TypeError, ValueError):
            collection_duration = detail_duration = -1.0
        updated_at = _parse_time(data.get("updated_at"))
        if (
            collection_started_at is None
            or updated_at is None
            or collection_started_at > updated_at
            or not math.isfinite(collection_duration)
            or not math.isfinite(detail_duration)
            or collection_duration < 0
            or collection_duration > MAX_COLLECTION_DURATION_SECONDS
            or detail_duration < 0
            or detail_duration > collection_duration
        ):
            errors.append("invalid collection timing")
        if int(quality.get("equipment_slots_expected", -1)) != expected_equipment_slots:
            errors.append("equipment slot expectation mismatch")
        if int(quality.get("equipment_slots_collected", -1)) != equipment_slots_collected:
            errors.append("equipment slot collection mismatch")
        if int(quality.get("equipment_slots_missing", -1)) != (
            expected_equipment_slots - equipment_slots_collected
        ):
            errors.append("equipment slot missing total mismatch")
        if not _number_matches(
            quality.get("equipment_fill_rate"),
            round(equipment_slots_collected / expected_equipment_slots * 100, 1),
        ):
            errors.append("equipment fill rate mismatch")
        if not _number_matches(
            quality.get("sample_coverage"),
            round(players / target_players * 100, 1),
        ):
            errors.append("sample coverage mismatch")
        if int(quality.get("detail_fetch_failures", -1)) != 0:
            errors.append("detail fetch failures present")
        if int(quality.get("invalid_player_records", -1)) != 0:
            errors.append("invalid player records present")

    diagnostics = data.get("diagnostics")
    if not isinstance(diagnostics, dict):
        errors.append("missing diagnostics")
    else:
        if int(diagnostics.get("valid_players", -1)) != players:
            errors.append("diagnostic player total mismatch")
        if int(diagnostics.get("detail_fetches_requested", -1)) != target_players:
            errors.append("diagnostic fetch total mismatch")
        failure_keys = (
            "detail_fetch_failures",
            "missing_player_info",
            "invalid_players",
            "invalid_unit_codes",
            "invalid_equipment",
            "invalid_rank_records",
        )
        if any(diagnostics.get(key) for key in failure_keys):
            errors.append("diagnostic collection errors present")
        distribution = diagnostics.get("team_size_distribution")
        if not isinstance(distribution, dict):
            errors.append("missing team size distribution")
        else:
            try:
                team_total = sum(int(count) for count in distribution.values())
                slot_total = sum(
                    int(size) * int(count)
                    for size, count in distribution.items()
                )
                sizes_valid = all(
                    1 <= int(size) <= MAX_CHARACTERS_PER_PLAYER
                    and int(count) >= 0
                    for size, count in distribution.items()
                )
            except (TypeError, ValueError):
                team_total = slot_total = -1
                sizes_valid = False
            if not sizes_valid or team_total != players or slot_total != slots:
                errors.append("team size distribution mismatch")

    _validate_public_comparison(data, errors)

    if previous:
        previous_target = int(previous.get("target_players", target_players))
        if previous_target != target_players:
            errors.append("target player count changed")
        for key in ("sampled_players", "character_slots"):
            old = int(previous.get(key, 0))
            new = int(data.get(key, 0))
            if old and new < old * 0.5:
                errors.append(f"{key} dropped by 50% or more")
        old_time = _parse_time(previous.get("updated_at"))
        new_time = _parse_time(data.get("updated_at"))
        if old_time and new_time and new_time <= old_time:
            errors.append("updated timestamp did not advance")
        _validate_comparison(data, previous, errors)

    if errors:
        raise ValueError("; ".join(errors))
    return True


def validate_data(data: dict, previous: dict | None = None) -> bool:
    """Validate published output without leaking parser implementation errors.

    The collector calls this immediately before replacing either public JSON
    file.  Malformed upstream structures should therefore become an ordinary
    validation failure, never an uncaught TypeError/KeyError that can obscure
    why publication was refused.
    """
    try:
        return _validate_data(data, previous)
    except ValueError:
        raise
    except (AttributeError, KeyError, TypeError, OverflowError) as error:
        raise ValueError("invalid published data structure") from error
