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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

try:
    from quality_checks import (
        CALENDAR_CLOSE_REFERENCE_MODE,
        EQUIPMENT_TYPES,
        MAX_COLLECTION_DURATION_SECONDS,
        SCHEMA_VERSION,
        assign_competition_ranks,
        equipment_rankings,
        validate_data,
    )
except ImportError:  # Allows importing this module from the test suite.
    from scripts.quality_checks import (
        CALENDAR_CLOSE_REFERENCE_MODE,
        EQUIPMENT_TYPES,
        MAX_COLLECTION_DURATION_SECONDS,
        SCHEMA_VERSION,
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
SOURCE_HOST = "rangers.lerico.net"


def read_bounded_env_int(
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    """Read a numeric setting without letting a bad environment stop the run."""
    raw_value = os.environ.get(name, "")
    try:
        value = int(str(raw_value).strip()) if str(raw_value).strip() else default
    except (TypeError, ValueError):
        return default
    return min(maximum, max(minimum, value))


TARGET_PLAYER_COUNT = read_bounded_env_int("TARGET_PLAYER_COUNT", 200, 1, 500)
# Deliberately modest concurrency gives the source time to answer and leaves
# room for a full retry/verification pass when one detail response is bad.
PLAYER_FETCH_WORKERS = read_bounded_env_int("PLAYER_FETCH_WORKERS", 3, 1, 4)
MIN_CHARACTERS_PER_PLAYER = 1
MAX_CHARACTERS_PER_PLAYER = 10
# Normal responses arrive in seconds.  A 15-second request bound still gives
# five attempts and structural rechecks time to recover, without letting one
# stalled connection block an entire update window.
REQUEST_TIMEOUT_SECONDS = read_bounded_env_int(
    "REQUEST_TIMEOUT_SECONDS", 15, 5, 30
)
# The public APIs are expected to return compact JSON.  A firm cap prevents a
# malformed upstream response from exhausting the runner while still allowing
# the translation catalogue to grow substantially.
MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024
# Five total attempts and one verification pass favour a complete, consistent
# snapshot over the previous quick-fail behaviour.  The collection deadline
# below keeps an upstream outage bounded.
REQUEST_ATTEMPTS = read_bounded_env_int("REQUEST_ATTEMPTS", 5, 1, 6)
DETAIL_FETCH_ROUNDS = read_bounded_env_int("DETAIL_FETCH_ROUNDS", 2, 1, 3)
DETAIL_CONTENT_RECHECKS = read_bounded_env_int(
    "DETAIL_CONTENT_RECHECKS", 1, 0, 2
)
OUTPUT_PATH = Path("docs/data/character_usage.json")
HISTORY_PATH = Path("docs/data/character_usage_history.json")
# Retain only the short rolling window needed for the one-hour comparison, plus
# one verified close per JST date. Keeping every half-hour snapshot for a
# month would eventually discard the month-end baseline (or bloat the public
# history file); these values make the monthly close durable and bounded.
HISTORY_RECENT_HOURS = 6
HISTORY_CLOSE_RETENTION_DAYS = 40
HISTORY_LIMIT = 96
HISTORY_TIME_ZONE = ZoneInfo("Asia/Tokyo")
# Daily, weekly, and monthly comparisons all use a verified Japanese evening
# closing snapshot. We prefer the latest 23:xx result, while 22:xx safely
# covers a missed 23:00 collection.
CALENDAR_CLOSE_START_HOUR = 22
CALENDAR_CLOSE_END_HOUR = 23
RANK_COMPARISON_PERIODS = {
    "hour": 60 * 60,
    "day": 24 * 60 * 60,
    "week": 7 * 24 * 60 * 60,
    "month": 31 * 24 * 60 * 60,
}
# A normal verified run may finish a little before or after the nominal hour.
# Choose the closest usable sample rather than requiring it to be strictly
# older than exactly one hour; otherwise a healthy hourly series can show
# "history pending" for much of every hour.
RANK_COMPARISON_MIN_RATIO = 0.50
RANK_COMPARISON_MAX_RATIO = 1.50
DEBUG_DIR = Path(".artifacts/debug")

# IDs are only used in known source URLs. Strict validation avoids publishing a
# made-up path if the upstream response is malformed.
UNIT_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
PLAYER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def is_trusted_source_url(url: str) -> bool:
    """Allow only the handbook API host, including after any redirect."""
    try:
        parsed = urlparse(url)
        return (
            parsed.scheme == "https"
            and parsed.hostname == SOURCE_HOST
            and parsed.port in (None, 443)
            and not parsed.username
            and not parsed.password
        )
    except ValueError:
        return False


class SourceOnlyRedirectHandler(HTTPRedirectHandler):
    """Refuse an API redirect to a different host before making the request."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not is_trusted_source_url(newurl):
            raise RuntimeError("Source API redirected outside the trusted host.")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


SOURCE_OPENER = build_opener(SourceOnlyRedirectHandler())


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as file:
            value = json.load(file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        # A previous local file is only comparison context.  Treating a damaged
        # copy as absent lets a fully validated fresh collection repair itself;
        # the new result still must pass every publication quality gate.
        return None
    return value if isinstance(value, dict) else None


def _read_json_response(response: object, label: str) -> object:
    """Read a bounded JSON response and make size failures explicit."""
    headers = getattr(response, "headers", None)
    content_length = headers.get("Content-Length") if headers else None
    if content_length:
        try:
            if int(content_length) > MAX_JSON_RESPONSE_BYTES:
                raise RuntimeError(f"{label} response exceeds the safety limit.")
        except ValueError:
            # A malformed header is not trusted; the bounded body read below is
            # still authoritative.
            pass

    body = response.read(MAX_JSON_RESPONSE_BYTES + 1)
    if len(body) > MAX_JSON_RESPONSE_BYTES:
        raise RuntimeError(f"{label} response exceeds the safety limit.")
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label} did not return valid UTF-8 JSON.") from error


def fetch_json(url: str, label: str) -> object:
    """Fetch a bounded, trusted JSON response with patient retry handling."""
    if not is_trusted_source_url(url):
        raise ValueError("Refusing to request an untrusted source URL.")
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
            with SOURCE_OPENER.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", 200)
                if status >= 400:
                    raise RuntimeError(f"{label} returned HTTP {status}.")
                return _read_json_response(response, label)
        except HTTPError as error:
            last_error = RuntimeError(f"{label} returned HTTP {error.code}.")
            if error.code < 500 and error.code != 429:
                break
        except (URLError, TimeoutError, OSError) as error:
            # Do not expose raw URL, response, or player information in CI
            # logs.  The error class is sufficient to diagnose retry policy.
            last_error = RuntimeError(
                f"{label} request failed ({type(error).__name__})."
            )
        if attempt < REQUEST_ATTEMPTS:
            # Bounded exponential backoff gives a rate-limited source time to
            # recover while still fitting within the collection time budget.
            sleep(min(5.0, 0.75 * (2 ** (attempt - 1))))

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
    payload = fetch_json(url, "Player detail API")
    if not isinstance(payload, dict):
        raise RuntimeError("Player detail API has an invalid structure.")
    returned_mid = str(payload.get("mid") or "").strip()
    if returned_mid and returned_mid != mid:
        raise RuntimeError("Player detail API returned a mismatched player id.")
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


def fetch_ranked_player_details(
    mids: list[str],
    collection_started_clock: float | None = None,
) -> tuple[dict[str, dict], list[dict]]:
    """Fetch every ranked player and retry only the transient failures.

    A failure for one player must not stop collection of the other ranked
    players.  After each full pass, only failures are retried, giving the API
    time to recover without duplicating successful work or publishing a
    partial sample.
    """
    unique_mids = list(dict.fromkeys(mids))
    details: dict[str, dict] = {}
    failure_types: dict[str, str] = {}
    pending = unique_mids
    batch_size = PLAYER_FETCH_WORKERS * 4

    for round_number in range(1, DETAIL_FETCH_ROUNDS + 1):
        if not pending:
            break
        if collection_started_clock is not None:
            ensure_collection_within_budget(collection_started_clock)
        next_pending: list[str] = []
        for start in range(0, len(pending), batch_size):
            if collection_started_clock is not None:
                ensure_collection_within_budget(collection_started_clock)
            batch = pending[start : start + batch_size]
            with ThreadPoolExecutor(max_workers=PLAYER_FETCH_WORKERS) as executor:
                future_by_mid = {
                    executor.submit(fetch_player_detail, mid): mid for mid in batch
                }
                for future in as_completed(future_by_mid):
                    mid = future_by_mid[future]
                    try:
                        detail = future.result()
                        if not isinstance(detail, dict):
                            raise TypeError("detail response is not an object")
                        details[mid] = detail
                        failure_types.pop(mid, None)
                    except Exception as error:
                        next_pending.append(mid)
                        failure_types[mid] = type(error).__name__
            if collection_started_clock is not None:
                ensure_collection_within_budget(collection_started_clock)
        failed_mids = set(next_pending)
        pending = [mid for mid in pending if mid in failed_mids]
        if pending and round_number < DETAIL_FETCH_ROUNDS:
            sleep(1.5 * round_number)

    failures = [
        {"mid": mid, "error_type": failure_types.get(mid, "UnknownError")}
        for mid in unique_mids
        if mid in pending
    ]
    return details, failures


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
        # Version 11 identifies the fixed Japanese calendar-close baselines,
        # in addition to the complete hour/day/week/month comparison contract.
        "schema_version": SCHEMA_VERSION,
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


def ensure_collection_within_budget(collection_started_clock: float) -> None:
    """Stop cleanly before an unusually slow source can publish stale work."""
    if monotonic() - collection_started_clock > MAX_COLLECTION_DURATION_SECONDS:
        raise RuntimeError(
            "Collection exceeded the verification time budget; "
            "retained the last known-good data."
        )


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
    details, detail_failures = fetch_ranked_player_details(
        mids, collection_started_clock=collection_started_clock
    )
    ensure_collection_within_budget(collection_started_clock)
    if detail_failures:
        dump_detail_failure_summary(len(mids), len(details), detail_failures)
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

    # A valid JSON response can still contain an incomplete defence team.
    # Re-fetch only the players rejected by structural validation, then repeat
    # the extraction.  This is deliberately separate from network retries so
    # a transient partial payload cannot become a misleading published count.
    content_rechecks = 0
    content_recheck_failures: list[dict] = []
    valid_mids = {str(player.get("mid")) for player in players}
    pending_content_recheck = [mid for mid in mids if mid not in valid_mids]
    while pending_content_recheck and content_rechecks < DETAIL_CONTENT_RECHECKS:
        content_rechecks += 1
        sleep(1.5 * content_rechecks)
        confirmed_details, recheck_failures = fetch_ranked_player_details(
            pending_content_recheck, collection_started_clock=collection_started_clock
        )
        details.update(confirmed_details)
        ensure_collection_within_budget(collection_started_clock)
        content_recheck_failures.extend(recheck_failures)
        players, diagnostics = extract_ranked_players(
            payload, TARGET_PLAYER_COUNT, player_details=details
        )
        diagnostics.update(ranking_diagnostics)
        diagnostics["detail_fetches_requested"] = len(mids)
        diagnostics["detail_fetch_failures"] = []
        valid_mids = {str(player.get("mid")) for player in players}
        pending_content_recheck = [mid for mid in mids if mid not in valid_mids]
    diagnostics["detail_content_rechecks"] = content_rechecks

    if len(players) != TARGET_PLAYER_COUNT:
        dump_detail_failure_summary(
            len(mids),
            len(players),
            content_recheck_failures + [{"error_type": "InvalidDetailContent"}],
        )
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
    ensure_collection_within_budget(collection_started_clock)
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
                monotonic() - detail_started_clock,
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


def _as_japan_time(value: datetime) -> datetime:
    """Normalize an aware or legacy-naive timestamp to Japan Standard Time."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(HISTORY_TIME_ZONE)


def _calendar_close_date(current_time: datetime, period_name: str):
    """Return the completed JST date used by a fixed period close.

    Daily changes always compare against yesterday's close. Weekly changes use
    the preceding Sunday close (Monday-based weeks), and monthly changes use
    the final close of the preceding calendar month. These dates deliberately
    do not move with the time at which a visitor opens the page.
    """
    local_date = _as_japan_time(current_time).date()
    if period_name == "day":
        return local_date - timedelta(days=1)
    if period_name == "week":
        return local_date - timedelta(days=local_date.weekday() + 1)
    if period_name == "month":
        return local_date.replace(day=1) - timedelta(days=1)
    raise ValueError(f"Unsupported calendar close period: {period_name}")


def _calendar_close_reference(
    history: dict,
    current_time: datetime,
    period_name: str,
) -> dict | None:
    """Return the latest verified 22:xx/23:xx JST snapshot for a fixed close."""
    snapshots = history.get("snapshots")
    if not isinstance(snapshots, list):
        return None

    close_date = _calendar_close_date(current_time, period_name)
    candidates: list[tuple[float, dict]] = []
    for snapshot in snapshots:
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("characters"), list):
            continue
        timestamp = _parse_history_time(snapshot.get("updated_at"))
        if timestamp is None:
            continue
        local_time = _as_japan_time(timestamp)
        if (
            local_time.date() == close_date
            and CALENDAR_CLOSE_START_HOUR <= local_time.hour <= CALENDAR_CLOSE_END_HOUR
        ):
            candidates.append((timestamp.timestamp(), snapshot))
    if not candidates:
        return None
    # The 23:xx snapshot wins when available; otherwise a valid 22:xx result
    # remains a trustworthy close baseline instead of delaying the comparison.
    return max(candidates, key=lambda item: item[0])[1]


def _period_reference(
    history: dict | None,
    current_time: datetime | None,
    period_seconds: int,
    period_name: str | None = None,
) -> dict | None:
    """Return the earlier verified snapshot required for a public period.

    Hourly comparisons use the nearest verified snapshot around one hour ago.
    Day/week/month comparisons instead use fixed JST closing snapshots, so the
    baseline never changes merely because the page was read an hour later.
    """
    if current_time is None or not isinstance(history, dict):
        return None
    snapshots = history.get("snapshots")
    if not isinstance(snapshots, list):
        return None

    if period_name in {"day", "week", "month"}:
        return _calendar_close_reference(history, current_time, period_name)

    target_time = current_time.timestamp() - period_seconds
    candidates: list[tuple[float, float, dict]] = []
    for snapshot in snapshots:
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("characters"), list):
            continue
        timestamp = _parse_history_time(snapshot.get("updated_at"))
        if timestamp is None:
            continue
        age = current_time.timestamp() - timestamp.timestamp()
        if (
            age >= period_seconds * RANK_COMPARISON_MIN_RATIO
            and age <= period_seconds * RANK_COMPARISON_MAX_RATIO
        ):
            # Prefer the verified sample closest to one hour ago.  A sample
            # that finished a few minutes after the exact target is still a
            # more truthful comparison than silently dropping all history.
            candidates.append((abs(timestamp.timestamp() - target_time), -timestamp.timestamp(), snapshot))
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[0], item[1]))[2]


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


def _exact_int(value: object) -> int | None:
    """Return an integer value while excluding booleans and malformed data."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _occurrence_delta(current_value: object, previous_value: object | None) -> int | None:
    """Return a count delta, using zero only for an item absent from a valid snapshot.

    A missing item in an otherwise valid reference snapshot means it was used zero
    times.  A malformed count is different: it remains unavailable so the page
    does not quietly turn uncertain data into a false zero.
    """
    current_count = _exact_int(current_value)
    if current_count is None or current_count < 0:
        return None
    previous_count = _exact_int(previous_value)
    if previous_count is None or previous_count < 0:
        return None
    return current_count - previous_count


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
    if reference_time is None or current_time is None:
        return result

    old_rank = _exact_int(old.get("rank")) if isinstance(old, dict) else None
    current_rank = _exact_int(current_row.get("rank"))
    # Only an absent character in an existing snapshot means zero. A present
    # row with a missing/null count is unknown, never a fabricated increase.
    old_count = old.get("occurrence_count") if isinstance(old, dict) else 0
    delta = _occurrence_delta(current_row.get("occurrence_count"), old_count)
    if delta is None:
        return result

    result.update(
        {
            "comparable": True,
            # Ranks cannot be inferred for a character absent from a snapshot.
            "rank": old_rank - current_rank if old_rank is not None and current_rank is not None else None,
            # Positive means this character is used in more defence-team slots.
            "occurrence_count": delta,
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

    Missing snapshots are deliberately represented as non-comparable.  The
    frontend labels that state as waiting for history, which is distinct from a
    real unchanged count (0).  An item missing from a valid snapshot, however,
    has a known prior count of zero and therefore has a real positive delta.
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

    rankings = reference_character.get("equipment_rankings")
    category = rankings.get(equipment_type) if isinstance(rankings, dict) else None
    if not isinstance(category, dict) or not isinstance(category.get("items"), list):
        # Older character-only snapshots contain no equipment evidence.
        return result

    old_item = _find_history_equipment(
        reference_character,
        equipment_type,
        str(current_item.get("item_code") or ""),
    )
    old_rank = _exact_int(old_item.get("rank")) if isinstance(old_item, dict) else None
    current_rank = _exact_int(current_item.get("rank"))
    old_count = old_item.get("occurrence_count") if isinstance(old_item, dict) else 0
    delta = _occurrence_delta(current_item.get("occurrence_count"), old_count)
    if delta is None:
        return result

    result.update(
        {
            "comparable": True,
            "rank": old_rank - current_rank if old_rank is not None and current_rank is not None else None,
            "occurrence_count": delta,
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
            "reference_mode": CALENDAR_CLOSE_REFERENCE_MODE,
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
        "reference_mode": CALENDAR_CLOSE_REFERENCE_MODE,
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

    current_time = _parse_history_time(data["updated_at"])
    if current_time is None:
        raise ValueError("history data must have a valid updated_at timestamp")
    current_local = _as_japan_time(current_time)
    recent_after = current_time - timedelta(hours=HISTORY_RECENT_HOURS)
    close_after = current_local.date() - timedelta(days=HISTORY_CLOSE_RETENTION_DAYS)

    # Deduplicate by timestamp before retention.  A later value with the same
    # timestamp is equivalent for comparisons, so retaining one avoids a
    # corrupt history growing without bound after a retry.
    parsed_snapshots: dict[str, tuple[datetime, dict]] = {}
    for item in snapshots:
        timestamp = _parse_history_time(item.get("updated_at"))
        if timestamp is not None:
            parsed_snapshots[str(item["updated_at"])] = (timestamp, item)

    close_by_date: dict[object, tuple[datetime, dict]] = {}
    recent: list[tuple[datetime, dict]] = []
    for timestamp, item in parsed_snapshots.values():
        local_time = _as_japan_time(timestamp)
        if timestamp >= recent_after:
            recent.append((timestamp, item))
        if (
            local_time.date() >= close_after
            and CALENDAR_CLOSE_START_HOUR <= local_time.hour <= CALENDAR_CLOSE_END_HOUR
        ):
            existing = close_by_date.get(local_time.date())
            if existing is None or timestamp > existing[0]:
                close_by_date[local_time.date()] = (timestamp, item)

    retained_by_timestamp = {
        str(item["updated_at"]): (timestamp, item)
        for timestamp, item in close_by_date.values()
    }
    # The close set is the durable part. Fill the remaining bounded capacity
    # with newest short-term snapshots, which is more than enough to retain a
    # valid 45–90 minute reference even when several normal runs are delayed.
    for timestamp, item in sorted(recent, key=lambda value: value[0], reverse=True):
        key = str(item["updated_at"])
        if key in retained_by_timestamp:
            continue
        if len(retained_by_timestamp) >= limit:
            break
        retained_by_timestamp[key] = (timestamp, item)

    retained = sorted(retained_by_timestamp.values(), key=lambda value: value[0])
    return {
        "schema_version": 2,
        "generated_at": data["updated_at"],
        "retention_hours": HISTORY_RECENT_HOURS,
        "calendar_close_retention_days": HISTORY_CLOSE_RETENTION_DAYS,
        "snapshot_limit": limit,
        "snapshots": [item for _, item in retained],
    }


def write_outputs(data: dict, history: dict) -> None:
    temporary_output = OUTPUT_PATH.with_suffix(".json.tmp")
    temporary_history = HISTORY_PATH.with_suffix(".json.tmp")
    save_json(temporary_output, data)
    save_json(temporary_history, history)
    temporary_history.replace(HISTORY_PATH)
    temporary_output.replace(OUTPUT_PATH)


def dump_detail_failure_summary(
    requested: int,
    completed: int,
    failures: list[dict],
) -> None:
    """Write safe aggregate failure diagnostics without player identifiers."""
    if os.environ.get("DEBUG", "0") != "1":
        return
    failure_types = Counter(
        str(item.get("error_type") or "UnknownError")
        for item in failures
        if isinstance(item, dict)
    )
    save_json(
        DEBUG_DIR / "detail_fetch_failures.json",
        {
            "requested": requested,
            "completed": completed,
            "failure_count": len(failures),
            "failure_types": dict(sorted(failure_types.items())),
        },
    )


def dump_debug(data: dict) -> None:
    if os.environ.get("DEBUG", "0") == "1":
        diagnostics = data.get("diagnostics")
        diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
        sensitive_lists = (
            "detail_fetch_failures",
            "missing_player_info",
            "invalid_players",
            "invalid_unit_codes",
            "invalid_equipment",
            "invalid_rank_records",
        )
        # Debug artifacts can be retained by the CI service. Keep useful
        # aggregate health information without storing player identifiers or
        # upstream payload fragments in an artifact.
        safe_diagnostics = {
            key: value
            for key, value in diagnostics.items()
            if key not in sensitive_lists
        }
        safe_diagnostics["diagnostic_error_counts"] = {
            key: len(diagnostics.get(key))
            if isinstance(diagnostics.get(key), list)
            else 0
            for key in sensitive_lists
        }
        save_json(DEBUG_DIR / "diagnostics.json", safe_diagnostics)


def main() -> None:
    previous = load_json(OUTPUT_PATH)
    previous_history = load_json(HISTORY_PATH)
    try:
        data = scrape()
        add_previous_comparison(data, previous, previous_history or {"snapshots": []})
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
