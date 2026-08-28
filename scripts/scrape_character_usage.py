"""Build Legend PvP character and equipment statistics from public API data.

The ranking endpoint lists the current Legend players and their defence teams.
Each ranked player is then fetched from /api/getPlayer/{mid}, because that
detail response contains the equipment attached to every character. Both
visible pvpteam groups are included: they form one player's ten-character
defence formation.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

try:
    from quality_checks import (
        EQUIPMENT_TYPES,
        assign_competition_ranks,
        equipment_rankings,
        validate_data,
    )
except ImportError:  # Allows importing this module from the test suite.
    from scripts.quality_checks import (
        EQUIPMENT_TYPES,
        assign_competition_ranks,
        equipment_rankings,
        validate_data,
    )


TARGET_URL = "https://rangers.lerico.net/ja/pvp-tracker"
SOURCE_NAME = "LINE Rangers Handbook PvP Tracker"
LEAGUE = "LEGEND"
API_URL_TEMPLATE = "https://rangers.lerico.net/api/v2/pvp/league/rank/{league}"
PLAYER_API_URL_TEMPLATE = "https://rangers.lerico.net/api/getPlayer/{mid}"
TRANSLATE_API_URL = "https://rangers.lerico.net/api/v2/translate"
UNIT_TRANSLATE_KEY = "ja:UNIT"
TARGET_PLAYER_COUNT = int(os.environ.get("TARGET_PLAYER_COUNT", "200"))
PLAYER_FETCH_WORKERS = min(
    12, max(1, int(os.environ.get("PLAYER_FETCH_WORKERS", "6")))
)
MIN_CHARACTERS_PER_PLAYER = 1
MAX_CHARACTERS_PER_PLAYER = 10
REQUEST_TIMEOUT_SECONDS = 30
# Three total attempts balance temporary network failures with respectful
# source access. A failed incomplete run is never published.
REQUEST_ATTEMPTS = 3
OUTPUT_PATH = Path("docs/data/character_usage.json")
HISTORY_PATH = Path("docs/data/character_usage_history.json")
# Keep enough hourly snapshots for the longest public comparison period.  The
# history file contains only compact aggregate rows (never player IDs), so it
# remains small while allowing a true calendar-month comparison.
HISTORY_LIMIT = 24 * 31
HISTORY_TIME_ZONE = ZoneInfo("Asia/Tokyo")
RANK_COMPARISON_PERIODS = {
    "day": 24 * 60 * 60,
    "week": 7 * 24 * 60 * 60,
    "month": 31 * 24 * 60 * 60,
}
RANK_COMPARISON_MIN_RATIO = 0.75
RANK_COMPARISON_MAX_RATIO = 1.50
DEBUG_DIR = Path(".artifacts/debug")

# IDs are only used in known source URLs. Strict validation avoids publishing a
# made-up path if the upstream response is malformed.
UNIT_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
PLAYER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as file:
        value = json.load(file)
    return value if isinstance(value, dict) else None


def fetch_json(url: str, label: str) -> object:
    """Fetch and decode a public JSON response with small, bounded retries."""
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "line-rangers-pvp-stats/1.1",
        },
    )
    last_error: Exception | None = None
    for attempt in range(1, REQUEST_ATTEMPTS + 1):
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", 200)
                if status >= 400:
                    raise RuntimeError(f"{label} returned HTTP {status}.")
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            last_error = RuntimeError(f"{label} returned HTTP {error.code}.")
            if error.code < 500 and error.code != 429:
                break
        except URLError as error:
            last_error = RuntimeError(f"{label} request failed: {error.reason}")
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{label} did not return valid JSON.") from error

        if attempt < REQUEST_ATTEMPTS:
            import time

            time.sleep(0.35 * attempt)

    raise last_error or RuntimeError(f"{label} request failed.")


def fetch_rank_data(league: str = LEAGUE) -> dict:
    url = API_URL_TEMPLATE.format(league=quote(league, safe=""))
    payload = fetch_json(url, "PvP ranking API")
    if not isinstance(payload, dict):
        raise RuntimeError("PvP ranking API response has an invalid root structure.")
    return payload


def fetch_player_detail(mid: str) -> dict:
    if not PLAYER_ID_PATTERN.fullmatch(mid):
        raise ValueError(f"Invalid player id: {mid!r}")
    url = PLAYER_API_URL_TEMPLATE.format(mid=quote(mid, safe=""))
    payload = fetch_json(url, f"Player detail API for {mid}")
    if not isinstance(payload, dict):
        raise RuntimeError(f"Player detail API for {mid} has an invalid structure.")
    returned_mid = str(payload.get("mid") or "").strip()
    if returned_mid and returned_mid != mid:
        raise RuntimeError(f"Player detail API returned a mismatched player id for {mid}.")
    return payload


def character_image_url(unit_code: str) -> str:
    """Return the canonical thumbnail URL for a validated unit code."""
    if not UNIT_CODE_PATTERN.fullmatch(unit_code):
        raise ValueError(f"Invalid unit code: {unit_code!r}")
    encoded = quote(unit_code, safe="-_")
    return f"https://rangers.lerico.net/res/{encoded}/{encoded}-thum.png"


def equipment_image_url(item_code: str) -> str:
    """Return the canonical equipment icon URL for a validated item code."""
    if not UNIT_CODE_PATTERN.fullmatch(item_code):
        raise ValueError(f"Invalid equipment code: {item_code!r}")
    encoded = quote(item_code, safe="-_")
    return f"https://rangers.lerico.net/res/gear_icon/{encoded}_icon.png"


def team_group_sort_key(item: tuple[object, object]) -> tuple[int, int | str]:
    key = str(item[0])
    return (0, int(key)) if key.isdecimal() else (1, key)


def extract_ranked_mids(payload: dict, target_players: int) -> tuple[list[str], dict]:
    """Read the first requested unique player IDs in leaderboard order."""
    rankings = payload.get("top100")
    if not isinstance(rankings, list):
        raise RuntimeError("PvP ranking API response is missing top100.")

    mids: list[str] = []
    seen_mids: set[str] = set()
    diagnostics = {
        "ranked_players_available": len(rankings),
        "invalid_rank_records": [],
    }

    for rank_record in rankings:
        if len(mids) >= target_players:
            break
        if not isinstance(rank_record, dict):
            diagnostics["invalid_rank_records"].append("ranking entry is not an object")
            continue

        mid = str(rank_record.get("mid") or "").strip()
        if not PLAYER_ID_PATTERN.fullmatch(mid) or mid in seen_mids:
            diagnostics["invalid_rank_records"].append(
                f"missing, malformed, or duplicate player id: {mid or '<empty>'}"
            )
            continue
        seen_mids.add(mid)
        mids.append(mid)

    return mids, diagnostics


def fetch_ranked_player_details(mids: list[str]) -> tuple[dict[str, dict], list[dict]]:
    """Fetch details in bounded batches and stop after the first failed batch.

    One missing player already makes a 200-player publication impossible.
    Continuing through all remaining IDs during an upstream outage would only
    extend the run and add avoidable load to the public source.
    """
    details: dict[str, dict] = {}
    failures: list[dict] = []
    batch_size = PLAYER_FETCH_WORKERS * 2

    for start in range(0, len(mids), batch_size):
        batch = mids[start : start + batch_size]
        batch_failures: list[dict] = []
        with ThreadPoolExecutor(max_workers=PLAYER_FETCH_WORKERS) as executor:
            future_by_mid = {
                executor.submit(fetch_player_detail, mid): mid for mid in batch
            }
            for future in as_completed(future_by_mid):
                mid = future_by_mid[future]
                try:
                    details[mid] = future.result()
                except Exception as error:
                    batch_failures.append({"mid": mid, "error": str(error)})
        if batch_failures:
            failures.extend(batch_failures)
            break

    return details, sorted(failures, key=lambda item: item["mid"])


def extract_unit_equipment(unit: dict, mid: str, diagnostics: dict) -> dict[str, str]:
    """Extract the three equipment slots attached to one character occurrence."""
    missing_slots = diagnostics.setdefault(
        "missing_equipment_slots",
        {equipment_type: 0 for equipment_type in EQUIPMENT_TYPES},
    )
    equip_map = unit.get("equipMap")
    if equip_map is None:
        diagnostics["units_without_equipment"] += 1
        for equipment_type in EQUIPMENT_TYPES:
            missing_slots[equipment_type] += 1
        return {}
    if not isinstance(equip_map, dict):
        raise ValueError(f"{mid}: equipMap is not an object")

    equipment: dict[str, str] = {}
    for equipment_type in EQUIPMENT_TYPES:
        slot = equip_map.get(equipment_type)
        if slot is None:
            missing_slots[equipment_type] += 1
            continue
        if not isinstance(slot, dict):
            raise ValueError(f"{mid}: {equipment_type} slot is not an object")
        item_code = str(slot.get("itemCode") or "").strip()
        if not UNIT_CODE_PATTERN.fullmatch(item_code):
            raise ValueError(f"{mid}: invalid {equipment_type} item code {item_code!r}")
        equipment[equipment_type] = item_code
    return equipment


def extract_ranked_players(
    payload: dict,
    target_players: int,
    player_details: dict[str, dict] | None = None,
) -> tuple[list[dict], dict]:
    """Extract all visible defence groups for the first ranked players.

    When player_details is supplied it is used instead of the compact
    playerInfo payload, so the returned slot records include equipment. The
    compact payload remains supported for deterministic unit tests.
    """
    rankings = payload.get("top100")
    if not isinstance(rankings, list):
        raise RuntimeError("PvP API response is missing top100.")

    if player_details is None:
        player_info = payload.get("playerInfo")
        if not isinstance(player_info, list):
            raise RuntimeError("PvP API response is missing playerInfo.")
        info_by_mid = {
            str(record.get("mid")): record
            for record in player_info
            if isinstance(record, dict) and str(record.get("mid") or "").strip()
        }
    else:
        info_by_mid = player_details

    players: list[dict] = []
    seen_mids: set[str] = set()
    diagnostics: dict = {
        "ranked_players_available": len(rankings),
        "player_info_available": len(info_by_mid),
        "missing_player_info": [],
        "invalid_players": [],
        "invalid_unit_codes": [],
        "invalid_equipment": [],
        "units_without_equipment": 0,
        "missing_equipment_slots": {
            equipment_type: 0 for equipment_type in EQUIPMENT_TYPES
        },
    }

    for rank_record in rankings:
        if len(players) >= target_players:
            break
        if not isinstance(rank_record, dict):
            diagnostics["invalid_players"].append("ranking entry is not an object")
            continue

        mid = str(rank_record.get("mid") or "").strip()
        if not PLAYER_ID_PATTERN.fullmatch(mid) or mid in seen_mids:
            diagnostics["invalid_players"].append(
                f"missing, malformed, or duplicate player id: {mid or '<empty>'}"
            )
            continue
        seen_mids.add(mid)

        info = info_by_mid.get(mid)
        if not isinstance(info, dict):
            diagnostics["missing_player_info"].append(mid)
            continue

        team_map = info.get("playerUnitTeamGroupMap")
        team_map = team_map if isinstance(team_map, dict) else {}
        team_groups = team_map.get("pvpteam")
        if not isinstance(team_groups, dict):
            diagnostics["invalid_players"].append(f"{mid}: no pvpteam map")
            continue

        units: list[str] = []
        unit_records: list[dict] = []
        invalid_player = False
        for _, group in sorted(team_groups.items(), key=team_group_sort_key):
            if not isinstance(group, list):
                invalid_player = True
                break
            for unit in group:
                code = str(unit.get("unitCode") or "").strip() if isinstance(unit, dict) else ""
                if not UNIT_CODE_PATTERN.fullmatch(code):
                    diagnostics["invalid_unit_codes"].append(
                        {"mid": mid, "unit_code": code}
                    )
                    invalid_player = True
                    break
                try:
                    equipment = extract_unit_equipment(unit, mid, diagnostics)
                except ValueError as error:
                    diagnostics["invalid_equipment"].append(str(error))
                    invalid_player = True
                    break

                units.append(code)
                unit_records.append({"unit_code": code, "equipment": equipment})
            if invalid_player:
                break

        if invalid_player or not (
            MIN_CHARACTERS_PER_PLAYER <= len(units) <= MAX_CHARACTERS_PER_PLAYER
        ):
            diagnostics["invalid_players"].append(f"{mid}: character count={len(units)}")
            continue
        players.append({"mid": mid, "units": units, "unit_records": unit_records})

    diagnostics["valid_players"] = len(players)
    diagnostics["team_size_distribution"] = dict(
        sorted(Counter(len(player["units"]) for player in players).items())
    )
    return players, diagnostics


def fetch_character_names(unit_codes: set[str]) -> dict[str, str]:
    """Load concise Japanese character names, without their preceding titles."""
    if not unit_codes:
        return {}

    url = f"{TRANSLATE_API_URL}?{urlencode({'keys': UNIT_TRANSLATE_KEY})}"
    payload = fetch_json(url, "Character translation API")
    if not isinstance(payload, dict):
        raise RuntimeError("Character translation API has an invalid root structure.")
    catalog = payload.get(UNIT_TRANSLATE_KEY)
    if not isinstance(catalog, dict):
        raise RuntimeError("Character translation API is missing the character catalog.")

    names: dict[str, str] = {}
    for unit_code in unit_codes:
        value = catalog.get(f"{unit_code}_snm") or catalog.get(f"{unit_code}_nm")
        if isinstance(value, str) and value.strip():
            names[unit_code] = " ".join(value.replace("\n", " ").split())
        else:
            names[unit_code] = unit_code
    return names


def build_statistics(
    players: list[dict],
    diagnostics: dict,
    character_names: dict[str, str] | None = None,
    target_players: int = TARGET_PLAYER_COUNT,
) -> dict:
    """Build character and per-character equipment rankings."""
    character_names = character_names or {}
    character_counts = defaultdict(lambda: {"occurrence_count": 0, "player_count": 0})
    character_equipment_records: dict[str, list[dict]] = defaultdict(list)
    category_occurrences = defaultdict(lambda: Counter())
    category_players = defaultdict(lambda: defaultdict(set))
    player_sizes: list[int] = []

    for player in players:
        mid = str(player["mid"])
        records = player.get("unit_records")
        if not isinstance(records, list):
            records = [
                {"unit_code": unit_code, "equipment": {}}
                for unit_code in player.get("units", [])
            ]

        player_sizes.append(len(records))
        seen_units: set[str] = set()
        equipment_by_character: dict[str, list[dict]] = defaultdict(list)

        for record in records:
            unit_code = str(record.get("unit_code") or "")
            if not UNIT_CODE_PATTERN.fullmatch(unit_code):
                raise RuntimeError(f"Invalid unit code while building statistics: {unit_code!r}")

            character_counts[unit_code]["occurrence_count"] += 1
            seen_units.add(unit_code)
            equipment = record.get("equipment")
            equipment = equipment if isinstance(equipment, dict) else {}

            for equipment_type, item_code in equipment.items():
                if equipment_type not in EQUIPMENT_TYPES:
                    continue
                if not UNIT_CODE_PATTERN.fullmatch(str(item_code)):
                    raise RuntimeError(
                        f"Invalid equipment code while building statistics: {item_code!r}"
                    )
                item_code = str(item_code)
                equipment_by_character[unit_code].append(
                    {
                        "type": equipment_type,
                        "item_code": item_code,
                        "image": equipment_image_url(item_code),
                    }
                )
                category_occurrences[unit_code][equipment_type] += 1
                category_players[unit_code][equipment_type].add(mid)

        for unit_code in seen_units:
            character_counts[unit_code]["player_count"] += 1
        for unit_code, equipment in equipment_by_character.items():
            character_equipment_records[unit_code].append({"equipment": equipment})

    sampled_players = len(players)
    total_slots = sum(player_sizes)
    if not sampled_players or not total_slots:
        raise RuntimeError("No character slots were found in the ranked players.")

    characters: list[dict] = []
    for unit_code, counts in character_counts.items():
        ranked_equipment = equipment_rankings(character_equipment_records[unit_code])
        rankings: dict[str, dict] = {}
        for equipment_type in EQUIPMENT_TYPES:
            items = ranked_equipment[equipment_type]
            for item in items:
                item["image"] = equipment_image_url(item["item_code"])
                item["adoption_rate"] = round(
                    item["player_count"] / counts["player_count"] * 100, 1
                )
            rankings[equipment_type] = {
                "equipped_occurrence_count": int(
                    category_occurrences[unit_code][equipment_type]
                ),
                "equipped_player_count": len(
                    category_players[unit_code][equipment_type]
                ),
                "items": items,
            }

        characters.append(
            {
                "unit_code": unit_code,
                "name": character_names.get(unit_code, unit_code),
                "image": character_image_url(unit_code),
                "occurrence_count": int(counts["occurrence_count"]),
                "player_count": int(counts["player_count"]),
                "adoption_rate": round(
                    counts["player_count"] / sampled_players * 100, 1
                ),
                "slot_rate": round(
                    counts["occurrence_count"] / total_slots * 100, 2
                ),
                "equipment_rankings": rankings,
            }
        )

    characters.sort(
        key=lambda item: (
            -item["occurrence_count"],
            -item["player_count"],
            item["unit_code"],
        )
    )
    assign_competition_ranks(characters)

    calculated_slots = sum(item["occurrence_count"] for item in characters)
    if calculated_slots != total_slots:
        raise RuntimeError(
            "Character totals do not match team totals: "
            f"{calculated_slots} != {total_slots}"
        )

    diagnostics["equipment_items_collected"] = sum(
        len(category["items"])
        for character in characters
        for category in character["equipment_rankings"].values()
    )
    equipment_slots_collected = sum(
        int(category["equipped_occurrence_count"])
        for character in characters
        for category in character["equipment_rankings"].values()
    )
    equipment_slots_expected = total_slots * len(EQUIPMENT_TYPES)
    return {
        # Version 9 adds compact equipment-rank history/change metadata while
        # preserving the existing character and equipment count semantics.
        "schema_version": 9,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": {"name": SOURCE_NAME, "url": TARGET_URL},
        "league": "レジェンド",
        "target_players": target_players,
        "sampled_players": sampled_players,
        "character_slots": total_slots,
        "unique_characters": len(characters),
        "median_characters_per_player": median(player_sizes),
        "pages_scanned": 1,
        "termination_reason": "api_target_reached",
        "complete_target": sampled_players >= target_players,
        "collection_quality": {
            "sample_coverage": round(sampled_players / target_players * 100, 1),
            "equipment_slots_collected": equipment_slots_collected,
            "equipment_slots_expected": equipment_slots_expected,
            "equipment_slots_missing": (
                equipment_slots_expected - equipment_slots_collected
            ),
            "equipment_fill_rate": round(
                equipment_slots_collected / equipment_slots_expected * 100,
                1,
            ),
            "detail_fetch_failures": len(
                diagnostics.get("detail_fetch_failures", [])
            ),
            "invalid_player_records": sum(
                len(diagnostics.get(key, []))
                for key in (
                    "missing_player_info",
                    "invalid_players",
                    "invalid_unit_codes",
                    "invalid_equipment",
                    "invalid_rank_records",
                )
            ),
        },
        "characters": characters,
        "diagnostics": diagnostics,
    }


def scrape() -> dict:
    if TARGET_PLAYER_COUNT < 1:
        raise RuntimeError("TARGET_PLAYER_COUNT must be at least 1.")

    collection_started_at = datetime.now(timezone.utc)
    collection_started_clock = monotonic()

    payload = fetch_rank_data()
    mids, ranking_diagnostics = extract_ranked_mids(payload, TARGET_PLAYER_COUNT)
    if len(mids) != TARGET_PLAYER_COUNT:
        raise RuntimeError(
            "PvP ranking API did not provide the requested number of unique players: "
            f"{len(mids)} != {TARGET_PLAYER_COUNT}"
        )

    detail_started_clock = monotonic()
    details, detail_failures = fetch_ranked_player_details(mids)
    detail_duration_seconds = monotonic() - detail_started_clock
    if detail_failures:
        if os.environ.get("DEBUG", "0") == "1":
            save_json(
                DEBUG_DIR / "detail_fetch_failures.json",
                {
                    "requested": len(mids),
                    "completed_before_abort": len(details),
                    "failures": detail_failures,
                },
            )
        raise RuntimeError(
            "Player detail collection failed after bounded retries; "
            f"aborted without publishing ({len(detail_failures)} failures)."
        )
    players, diagnostics = extract_ranked_players(
        payload, TARGET_PLAYER_COUNT, player_details=details
    )
    diagnostics.update(ranking_diagnostics)
    diagnostics["detail_fetches_requested"] = len(mids)
    diagnostics["detail_fetch_failures"] = detail_failures

    if len(players) != TARGET_PLAYER_COUNT:
        raise RuntimeError(
            "Some requested ranked players had incomplete team or equipment data; "
            f"refusing to publish a partial sample ({len(players)} != {TARGET_PLAYER_COUNT})."
        )

    unit_codes = {
        record["unit_code"]
        for player in players
        for record in player["unit_records"]
    }
    character_names = fetch_character_names(unit_codes)
    data = build_statistics(
        players,
        diagnostics,
        character_names=character_names,
        target_players=TARGET_PLAYER_COUNT,
    )
    data["collection_quality"].update(
        {
            "collection_started_at": collection_started_at.isoformat(),
            "collection_duration_seconds": round(
                monotonic() - collection_started_clock,
                2,
            ),
            "detail_fetch_duration_seconds": round(
                detail_duration_seconds,
                2,
            ),
        }
    )
    return data


def _parse_history_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _history_date_key(value: datetime | None) -> str | None:
    """Return the calendar date used by the Japanese-facing daily comparison.

    Stored timestamps are UTC, but the site is operated and read primarily in
    Japan.  Keeping an explicit date key prevents a snapshot around 00:00 JST
    from being assigned to the wrong comparison day.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(HISTORY_TIME_ZONE).date().isoformat()


def _period_reference(
    history: dict | None,
    current_time: datetime | None,
    period_seconds: int,
    period_name: str | None = None,
) -> dict | None:
    """Return a sufficiently close, earlier verified snapshot for a period.

    A missing hourly run must not turn into a misleading month comparison. We
    therefore select the newest snapshot at or before the target point and
    accept it only when its actual age is between 75% and 150% of the target.
    """
    if current_time is None or not isinstance(history, dict):
        return None
    snapshots = history.get("snapshots")
    if not isinstance(snapshots, list):
        return None

    target_time = current_time.timestamp() - period_seconds
    previous_calendar_date: date | None = None
    if period_name == "day":
        previous_calendar_date = (
            current_time.astimezone(HISTORY_TIME_ZONE).date() - timedelta(days=1)
        )
    candidates: list[tuple[float, dict]] = []
    for snapshot in snapshots:
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("characters"), list):
            continue
        timestamp = _parse_history_time(snapshot.get("updated_at"))
        if timestamp is None:
            continue
        if (
            previous_calendar_date is not None
            and timestamp.astimezone(HISTORY_TIME_ZONE).date() == previous_calendar_date
        ):
            # A daily comparison is a calendar-day comparison in JST.  The
            # latest verified snapshot from the preceding JST date is the
            # least surprising baseline after midnight or a delayed run.
            candidates.append((timestamp.timestamp(), snapshot))
            continue
        age = current_time.timestamp() - timestamp.timestamp()
        if (
            timestamp.timestamp() <= target_time
            and age >= period_seconds * RANK_COMPARISON_MIN_RATIO
            and age <= period_seconds * RANK_COMPARISON_MAX_RATIO
        ):
            candidates.append((timestamp.timestamp(), snapshot))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def _find_history_character(reference: dict | None, unit_code: str) -> dict | None:
    if not isinstance(reference, dict):
        return None
    for row in reference.get("characters", []):
        if isinstance(row, dict) and str(row.get("unit_code")) == str(unit_code):
            return row
    return None


def _find_history_equipment(
    reference_character: dict | None,
    equipment_type: str,
    item_code: str,
) -> dict | None:
    if not isinstance(reference_character, dict):
        return None
    rankings = reference_character.get("equipment_rankings")
    category = rankings.get(equipment_type) if isinstance(rankings, dict) else None
    items = category.get("items") if isinstance(category, dict) else None
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and str(item.get("item_code")) == str(item_code):
            return item
    return None


def _period_change(
    current_row: dict,
    reference: dict | None,
    current_time: datetime | None,
) -> dict:
    """Build one period result with an explicit comparable flag."""
    result = {
        "comparable": False,
        "rank": None,
        "occurrence_count": None,
        "from_updated_at": None,
        "interval_minutes": None,
    }
    if not reference:
        return result

    reference_time = _parse_history_time(reference.get("updated_at"))
    old_rows = {
        str(row.get("unit_code")): row
        for row in reference.get("characters", [])
        if isinstance(row, dict) and row.get("unit_code")
    }
    old = old_rows.get(str(current_row.get("unit_code")))
    if not old or reference_time is None or current_time is None:
        return result

    result.update(
        {
            "comparable": True,
            # Positive means the character moved up the ranking.
            "rank": int(old.get("rank", 0)) - int(current_row.get("rank", 0)),
            # Positive means this character is used in more defence-team slots.
            "occurrence_count": int(current_row.get("occurrence_count", 0))
            - int(old.get("occurrence_count", 0)),
            "from_updated_at": reference.get("updated_at"),
            "interval_minutes": round(
                (current_time - reference_time).total_seconds() / 60,
                1,
            ),
        }
    )
    return result


def _equipment_period_change(
    current_item: dict,
    reference: dict | None,
    unit_code: str,
    equipment_type: str,
    current_time: datetime | None,
) -> dict:
    """Compare one equipment item with the verified period snapshot.

    Missing history is deliberately represented as non-comparable.  The
    frontend renders that state as 0, while the metadata remains truthful and
    can be distinguished from a real unchanged rank.
    """
    result = {
        "comparable": False,
        "rank": None,
        "occurrence_count": None,
        "from_updated_at": None,
        "interval_minutes": None,
    }
    reference_character = _find_history_character(reference, unit_code)
    reference_time = _parse_history_time(reference.get("updated_at")) if reference else None
    if reference_character is None or reference_time is None or current_time is None:
        return result

    old_item = _find_history_equipment(
        reference_character,
        equipment_type,
        str(current_item.get("item_code") or ""),
    )
    if old_item is None:
        # A newly observed item has no defensible prior rank.  Keep it
        # non-comparable so the UI shows the requested neutral 0 instead of a
        # fabricated movement.
        return result

    result.update(
        {
            "comparable": True,
            "rank": int(old_item.get("rank", 0)) - int(current_item.get("rank", 0)),
            "occurrence_count": (
                int(current_item.get("occurrence_count", 0))
                - int(old_item.get("occurrence_count", 0))
                if isinstance(old_item.get("occurrence_count"), int)
                and isinstance(current_item.get("occurrence_count"), int)
                else None
            ),
            "from_updated_at": reference.get("updated_at"),
            "interval_minutes": round(
                (current_time - reference_time).total_seconds() / 60,
                1,
            ),
        }
    )
    return result


def _attach_equipment_comparison(
    current_row: dict,
    previous_row: dict | None,
    period_references: dict[str, dict | None],
    current_time: datetime | None,
) -> None:
    """Attach hourly and day/week/month rank changes to every equipment item."""
    previous_rankings = previous_row.get("equipment_rankings", {}) if isinstance(previous_row, dict) else {}
    current_rankings = current_row.get("equipment_rankings", {})
    for equipment_type in EQUIPMENT_TYPES:
        category = current_rankings.get(equipment_type)
        items = category.get("items") if isinstance(category, dict) else None
        if not isinstance(items, list):
            continue
        previous_category = (
            previous_rankings.get(equipment_type)
            if isinstance(previous_rankings, dict)
            else None
        )
        previous_items = previous_category.get("items", []) if isinstance(previous_category, dict) else []
        previous_by_code = {
            str(item.get("item_code")): item
            for item in previous_items
            if isinstance(item, dict) and item.get("item_code")
        }
        for item in items:
            item_code = str(item.get("item_code") or "")
            old_item = previous_by_code.get(item_code)
            item["change"] = {
                "new": old_item is None,
                "rank": (
                    int(old_item.get("rank", 0)) - int(item.get("rank", 0))
                    if old_item is not None
                    else 0
                ),
                "occurrence_count": (
                    int(item.get("occurrence_count", 0))
                    - int(old_item.get("occurrence_count", 0))
                    if old_item is not None
                    else 0
                ),
                "periods": {
                    name: _equipment_period_change(
                        item,
                        reference,
                        str(current_row.get("unit_code") or ""),
                        equipment_type,
                        current_time,
                    )
                    for name, reference in period_references.items()
                },
            }


def add_previous_comparison(
    data: dict,
    previous: dict | None,
    history: dict | None = None,
) -> dict:
    """Attach hour-over-hour and period rank changes without player IDs."""
    current_time = _parse_history_time(data.get("updated_at"))
    period_references = {
        name: _period_reference(history, current_time, seconds, name)
        for name, seconds in RANK_COMPARISON_PERIODS.items()
    }
    period_summary = {
        name: {
            "comparable": reference is not None,
            "updated_at": reference.get("updated_at") if reference else None,
            "calendar_date": _history_date_key(
                _parse_history_time(reference.get("updated_at"))
            )
            if reference
            else None,
        }
        for name, reference in period_references.items()
    }
    if not previous or not isinstance(previous.get("characters"), list):
        data["comparison"] = {
            "previous_updated_at": None,
            "calendar_date": _history_date_key(current_time),
            "interval_minutes": None,
            "comparable": False,
            "new_characters": 0,
            "removed_characters": 0,
            "periods": period_summary,
        }
        for row in data.get("characters", []):
            row["change"] = {"new": True}
            if history is not None:
                row["change"]["periods"] = {
                    name: _period_change(row, reference, current_time)
                    for name, reference in period_references.items()
                }
                _attach_equipment_comparison(
                    row,
                    None,
                    period_references,
                    current_time,
                )
        return data

    previous_rows = {
        str(row.get("unit_code")): row
        for row in previous["characters"]
        if isinstance(row, dict) and row.get("unit_code")
    }
    current_codes: set[str] = set()
    new_characters = 0
    for row in data["characters"]:
        unit_code = str(row["unit_code"])
        current_codes.add(unit_code)
        old = previous_rows.get(unit_code)
        if old is None:
            row["change"] = {"new": True}
            new_characters += 1
            continue
        row["change"] = {
            "new": False,
            # Positive means the character moved up the ranking.
            "rank": int(old.get("rank", 0)) - int(row["rank"]),
            "occurrence_count": int(row["occurrence_count"])
            - int(old.get("occurrence_count", 0)),
            "player_count": int(row["player_count"])
            - int(old.get("player_count", 0)),
            "adoption_rate": round(
                float(row["adoption_rate"])
                - float(old.get("adoption_rate", 0)),
                1,
            ),
        }
        if history is not None:
            row["change"]["periods"] = {
                name: _period_change(row, reference, current_time)
                for name, reference in period_references.items()
            }
            _attach_equipment_comparison(
                row,
                old,
                period_references,
                current_time,
            )

    # New characters still carry explicit period entries so consumers can
    # distinguish "new" from a missing or malformed field.
    for row in data["characters"]:
        if row.get("change", {}).get("new") is True:
            if history is not None:
                row["change"]["periods"] = {
                    name: _period_change(row, reference, current_time)
                    for name, reference in period_references.items()
                }
                _attach_equipment_comparison(
                    row,
                    previous_rows.get(str(row.get("unit_code"))),
                    period_references,
                    current_time,
                )

    try:
        previous_time = datetime.fromisoformat(
            str(previous.get("updated_at")).replace("Z", "+00:00")
        )
        current_time = datetime.fromisoformat(
            str(data.get("updated_at")).replace("Z", "+00:00")
        )
        interval_minutes = round(
            (current_time - previous_time).total_seconds() / 60,
            1,
        )
    except ValueError:
        interval_minutes = None

    data["comparison"] = {
        "previous_updated_at": previous.get("updated_at"),
        "calendar_date": _history_date_key(current_time),
        "interval_minutes": interval_minutes,
        "comparable": (
            int(previous.get("sampled_players", 0))
            == int(data.get("sampled_players", 0))
        ),
        "new_characters": new_characters,
        "removed_characters": len(set(previous_rows) - current_codes),
        "periods": period_summary,
    }
    return data


def history_snapshot(data: dict) -> dict:
    """Keep only compact, non-identifying values needed for future trends."""
    timestamp = _parse_history_time(data["updated_at"])

    def compact_equipment_rankings(row: dict) -> dict[str, dict[str, list[dict]]]:
        rankings = row.get("equipment_rankings")
        rankings = rankings if isinstance(rankings, dict) else {}
        compact: dict[str, dict[str, list[dict]]] = {}
        for equipment_type in EQUIPMENT_TYPES:
            category = rankings.get(equipment_type)
            items = category.get("items") if isinstance(category, dict) else []
            compact[equipment_type] = {
                "items": [
                    {
                        "item_code": item["item_code"],
                        "rank": item["rank"],
                        "occurrence_count": item["occurrence_count"],
                    }
                    for item in items
                    if isinstance(item, dict)
                    and item.get("item_code")
                    and isinstance(item.get("rank"), int)
                ]
            }
        return compact

    return {
        "updated_at": data["updated_at"],
        "calendar_date": _history_date_key(timestamp),
        "sampled_players": data["sampled_players"],
        "character_slots": data["character_slots"],
        "unique_characters": data["unique_characters"],
        "collection_duration_seconds": data.get("collection_quality", {}).get(
            "collection_duration_seconds"
        ),
        "characters": [
            {
                "unit_code": row["unit_code"],
                "rank": row["rank"],
                "occurrence_count": row["occurrence_count"],
                "player_count": row["player_count"],
                "adoption_rate": row["adoption_rate"],
                "equipment_rankings": compact_equipment_rankings(row),
            }
            for row in data["characters"]
        ],
    }


def update_history(
    data: dict,
    history: dict | None,
    limit: int = HISTORY_LIMIT,
) -> dict:
    if limit < 1:
        raise ValueError("history limit must be positive")
    snapshots = history.get("snapshots", []) if isinstance(history, dict) else []
    snapshots = [
        item
        for item in snapshots
        if isinstance(item, dict) and item.get("updated_at") != data["updated_at"]
    ]
    snapshots.append(history_snapshot(data))
    return {
        "schema_version": 2,
        "generated_at": data["updated_at"],
        "retention_hours": limit,
        "snapshots": snapshots[-limit:],
    }


def write_outputs(data: dict, history: dict) -> None:
    temporary_output = OUTPUT_PATH.with_suffix(".json.tmp")
    temporary_history = HISTORY_PATH.with_suffix(".json.tmp")
    save_json(temporary_output, data)
    save_json(temporary_history, history)
    temporary_history.replace(HISTORY_PATH)
    temporary_output.replace(OUTPUT_PATH)


def dump_debug(data: dict) -> None:
    if os.environ.get("DEBUG", "0") == "1":
        save_json(DEBUG_DIR / "diagnostics.json", data["diagnostics"])


def main() -> None:
    previous = load_json(OUTPUT_PATH)
    previous_history = load_json(HISTORY_PATH)
    try:
        data = scrape()
        add_previous_comparison(data, previous, previous_history)
        validate_data(data, previous)
        history = update_history(data, previous_history)
        write_outputs(data, history)
        dump_debug(data)
        print(
            "[DONE] "
            f"players={data['sampled_players']}, "
            f"slots={data['character_slots']}, "
            f"characters={len(data['characters'])}, "
            f"equipment_items={data['diagnostics']['equipment_items_collected']}, "
            f"termination={data['termination_reason']}"
        )
    except Exception as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
