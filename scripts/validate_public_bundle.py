"""Fail closed when a public PvP snapshot, health, and comparison history disagree."""

from __future__ import annotations

import json
import sys
from datetime import timezone
from pathlib import Path

try:
    import scrape_character_usage as scraper
    import rebuild_cross_sample_comparisons as cross_rebuild
    from quality_checks import validate_data
    from validate_public_comparisons import validate_payload
except ImportError:
    from scripts import scrape_character_usage as scraper
    from scripts import rebuild_cross_sample_comparisons as cross_rebuild
    from scripts.quality_checks import validate_data
    from scripts.validate_public_comparisons import validate_payload


DATA = Path("docs/data/character_usage.json")
HEALTH = Path("docs/data/character_usage_health.json")
HISTORIES = (
    Path("docs/data/character_usage_history.json"),
    Path("docs/data/character_usage_cross_sample_history.json"),
)


def read_object(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} is not a JSON object")
    return value


def ordered_competition_ranks(rows: list[dict]) -> bool:
    previous_count = None
    previous_rank = 0
    for index, row in enumerate(rows, start=1):
        count = row["occurrence_count"]
        expected_rank = previous_rank if count == previous_count else index
        if (previous_count is not None and count > previous_count) or row["rank"] != expected_rank:
            return False
        previous_count, previous_rank = count, expected_rank
    return True


def checked_history(history: dict, current_time, label: str) -> dict[str, dict]:
    snapshots = history.get("snapshots")
    if not isinstance(snapshots, list):
        raise ValueError(f"{label} has no snapshot list")
    by_time = {}
    for snapshot in snapshots:
        sampled = scraper._exact_int(snapshot.get("sampled_players")) if isinstance(snapshot, dict) else None
        if (
            sampled is None
            or not 0 < sampled <= scraper.TARGET_PLAYER_COUNT
            or not scraper._usable_history_snapshot(snapshot, current_time, sampled)
        ):
            raise ValueError(f"{label} contains an invalid comparison baseline")
        if not ordered_competition_ranks(snapshot["characters"]):
            raise ValueError(f"{label} contains inconsistent character ranks")
        for character in snapshot["characters"]:
            for category in (character.get("equipment_rankings") or {}).values():
                if not ordered_competition_ranks(category["items"]):
                    raise ValueError(f"{label} contains inconsistent equipment ranks")
        instant = scraper._parse_history_time(snapshot["updated_at"]).astimezone(timezone.utc)
        if instant in by_time:
            raise ValueError(f"{label} has a duplicate comparison baseline")
        by_time[instant] = snapshot
    return {snapshot["updated_at"]: snapshot for snapshot in by_time.values()}


def _partial_character_hour_reference(data: dict, period: str, summary: dict) -> dict | None:
    """Recover the same ephemeral hour baseline used by the collector."""
    if period != "hour" or summary.get("comparable") is not True:
        return None
    fallback = data.get("partial_fallback")
    sampled = data.get("sampled_players")
    if (
        data.get("complete_target") is not False
        or data.get("publication_mode") != "partial_after_stale"
        or not isinstance(sampled, int)
        or isinstance(sampled, bool)
        or not 0 < sampled < 200
        or not isinstance(fallback, dict)
        or fallback.get("trigger_after_minutes") != 0
    ):
        return None
    reference = cross_rebuild._runtime_partial_hour_reference(data)
    if not isinstance(reference, dict):
        return None
    if reference.get("updated_at") != summary.get("updated_at"):
        return None
    return reference


def _verify_equipment_hour_unavailable(character: dict) -> None:
    for category in (character.get("equipment_rankings") or {}).values():
        for item in (category or {}).get("items") or []:
            value = ((item.get("change") or {}).get("periods") or {}).get("hour")
            if not isinstance(value, dict) or value.get("comparable") is not False:
                raise ValueError("partial hour comparison must remain character-only")
            if any(
                value.get(key) is not None
                for key in ("rank", "occurrence_count", "from_updated_at", "interval_minutes")
            ):
                raise ValueError("partial hour equipment comparison contains values")


def verify_deltas(data: dict, references: dict[str, dict]) -> None:
    summaries = data["comparison"]["periods"]
    for period, summary in summaries.items():
        if not summary["comparable"]:
            continue
        reference = references.get(summary["updated_at"])
        partial_character_hour = False
        if reference is None:
            reference = _partial_character_hour_reference(data, period, summary)
            partial_character_hour = reference is not None
        if reference is None:
            raise ValueError(f"{period} comparison has no verified baseline")
        old_characters = {row["unit_code"]: row for row in reference["characters"]}
        for character in data["characters"]:
            code = character["unit_code"]
            old = old_characters.get(code)
            change = character["change"]["periods"][period]
            if change["comparable"] is not True:
                raise ValueError(f"{period} character comparison is missing despite a valid baseline: {code}")
            expected = character["occurrence_count"] - (old["occurrence_count"] if old else 0)
            if change["occurrence_count"] != expected:
                raise ValueError(f"{period} character occurrence delta differs from history: {code}")
            if partial_character_hour:
                _verify_equipment_hour_unavailable(character)
                continue
            for kind, category in character["equipment_rankings"].items():
                old_rankings = old.get("equipment_rankings") if old else None
                old_category = old_rankings.get(kind) if isinstance(old_rankings, dict) else None
                if old and old_category is None:
                    continue
                old_items = {item["item_code"]: item["occurrence_count"]
                             for item in old_category["items"]} if old_category else {}
                for item in category["items"]:
                    item_change = item["change"]["periods"][period]
                    if item_change["comparable"] is not True:
                        raise ValueError(f"{period} equipment comparison is missing despite a valid baseline")
                    expected = item["occurrence_count"] - old_items.get(item["item_code"], 0)
                    if item_change["occurrence_count"] != expected:
                        raise ValueError(f"{period} equipment occurrence delta differs from history")


def verify_shared_history(public: dict[str, dict], cross: dict[str, dict]) -> None:
    for timestamp in public.keys() & cross.keys():
        left = {row["unit_code"]: row for row in public[timestamp]["characters"]}
        right = {row["unit_code"]: row for row in cross[timestamp]["characters"]}
        if left.keys() != right.keys():
            raise ValueError("public and cross-sample histories disagree on character identities")
        for code in left:
            for key in ("rank", "occurrence_count", "player_count", "adoption_rate"):
                if left[code][key] != right[code][key]:
                    raise ValueError("public and cross-sample histories disagree on character counts")
            first = left[code].get("equipment_rankings")
            second = right[code].get("equipment_rankings")
            if isinstance(first, dict) and isinstance(second, dict) and first != second:
                raise ValueError("public and cross-sample histories disagree on equipment counts")


def _publication_mode_is_valid(data: dict) -> bool:
    target = data.get("target_players")
    sampled = data.get("sampled_players")
    complete = data.get("complete_target")
    mode = data.get("publication_mode")
    if target != 200:
        return False
    if sampled == 200 and complete is True and mode == "complete":
        return True
    if not (isinstance(sampled, int) and not isinstance(sampled, bool) and 0 < sampled < 200):
        return False
    if complete is not False or mode != "partial_after_stale":
        return False
    fallback = data.get("partial_fallback")
    if not isinstance(fallback, dict):
        return False
    try:
        missing = int(fallback.get("missing_players", -1))
        trigger = int(fallback.get("trigger_after_minutes", -1))
    except (TypeError, ValueError):
        return False
    if missing != target - sampled or trigger not in {0, 180}:
        return False
    # Baseline lineage is useful when available, but a missing historical full
    # sample must not block a fresh nonzero ranking. Valid variable-size
    # snapshots are retained in cross-sample history so comparisons stay live.
    last_complete = fallback.get("last_complete_updated_at")
    return last_complete is None or scraper._parse_history_time(last_complete) is not None


def validate_bundle(data: dict, health: dict, public_history: dict, cross_history: dict) -> None:
    if not _publication_mode_is_valid(data):
        raise ValueError("public aggregation requires a valid complete or partial snapshot")
    validate_data(data)
    validate_payload(data)
    if health != scraper.health_summary(data):
        raise ValueError("health JSON does not match the validated PvP snapshot")
    current_time = scraper._parse_history_time(data["updated_at"])
    public = checked_history(public_history, current_time, "public history")
    cross = checked_history(cross_history, current_time, "cross-sample history")
    verify_shared_history(public, cross)
    verify_deltas(data, {**public, **cross})


def main() -> None:
    if len(sys.argv) != 1:
        raise SystemExit("usage: validate_public_bundle.py")
    validate_bundle(
        read_object(DATA), read_object(HEALTH),
        read_object(HISTORIES[0]), read_object(HISTORIES[1]),
    )
    print("Public PvP aggregation, health, and comparison history validated.")


if __name__ == "__main__":
    main()
