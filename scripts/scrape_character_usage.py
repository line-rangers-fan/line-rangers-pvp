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
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

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
MIN_REQUIRED_PLAYERS = int(os.environ.get("MIN_REQUIRED_PLAYERS", "50"))
PLAYER_FETCH_WORKERS = min(
    12, max(1, int(os.environ.get("PLAYER_FETCH_WORKERS", "6")))
)
MIN_CHARACTERS_PER_PLAYER = 1
MAX_CHARACTERS_PER_PLAYER = 10
REQUEST_TIMEOUT_SECONDS = 30
REQUEST_ATTEMPTS = 3
OUTPUT_PATH = Path("docs/data/character_usage.json")
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
    """Fetch every ranked player's detailed formation concurrently."""
    details: dict[str, dict] = {}
    failures: list[dict] = []

    with ThreadPoolExecutor(max_workers=PLAYER_FETCH_WORKERS) as executor:
        future_by_mid = {
            executor.submit(fetch_player_detail, mid): mid
            for mid in mids
        }
        for future in as_completed(future_by_mid):
            mid = future_by_mid[future]
            try:
                details[mid] = future.result()
            except Exception as error:  # Gather every failure for diagnostics.
                failures.append({"mid": mid, "error": str(error)})

    return details, sorted(failures, key=lambda item: item["mid"])


def extract_unit_equipment(unit: dict, mid: str, diagnostics: dict) -> dict[str, str]:
    """Extract the three equipment slots attached to one character occurrence."""
    equip_map = unit.get("equipMap")
    if equip_map is None:
        diagnostics["units_without_equipment"] += 1
        return {}
    if not isinstance(equip_map, dict):
        raise ValueError(f"{mid}: equipMap is not an object")

    equipment: dict[str, str] = {}
    for equipment_type in EQUIPMENT_TYPES:
        slot = equip_map.get(equipment_type)
        if slot is None:
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
    return {
        "schema_version": 6,
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
        "characters": characters,
        "diagnostics": diagnostics,
    }


def scrape() -> dict:
    if TARGET_PLAYER_COUNT < 1:
        raise RuntimeError("TARGET_PLAYER_COUNT must be at least 1.")

    payload = fetch_rank_data()
    mids, ranking_diagnostics = extract_ranked_mids(payload, TARGET_PLAYER_COUNT)
    details, detail_failures = fetch_ranked_player_details(mids)
    players, diagnostics = extract_ranked_players(
        payload, TARGET_PLAYER_COUNT, player_details=details
    )
    diagnostics.update(ranking_diagnostics)
    diagnostics["detail_fetches_requested"] = len(mids)
    diagnostics["detail_fetch_failures"] = detail_failures

    if len(players) < MIN_REQUIRED_PLAYERS:
        raise RuntimeError(
            "Not enough valid players from the PvP API: "
            f"{len(players)} < {MIN_REQUIRED_PLAYERS}"
        )
    if len(players) < TARGET_PLAYER_COUNT and len(payload.get("top100", [])) >= TARGET_PLAYER_COUNT:
        raise RuntimeError(
            "Some requested ranked players had incomplete team or equipment data; "
            "refusing to publish a partial sample."
        )

    unit_codes = {
        record["unit_code"]
        for player in players
        for record in player["unit_records"]
    }
    character_names = fetch_character_names(unit_codes)
    return build_statistics(
        players,
        diagnostics,
        character_names=character_names,
        target_players=TARGET_PLAYER_COUNT,
    )


def write_output(data: dict) -> None:
    temporary_path = OUTPUT_PATH.with_suffix(".json.tmp")
    save_json(temporary_path, data)
    temporary_path.replace(OUTPUT_PATH)


def dump_debug(data: dict) -> None:
    if os.environ.get("DEBUG", "0") == "1":
        save_json(DEBUG_DIR / "diagnostics.json", data["diagnostics"])


def main() -> None:
    previous = load_json(OUTPUT_PATH)
    try:
        data = scrape()
        validate_data(data, previous)
        write_output(data)
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
