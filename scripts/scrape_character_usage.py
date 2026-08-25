"""Build Legend PvP character statistics from the Handbook's public API.

The PvP Tracker page renders the same data after it has been fetched from
``/api/v2/pvp/league/rank/LEGEND``. Reading the API directly is deliberate:
lazy-loaded, off-screen, or split DOM rows must never make a character vanish
from the statistics. Every ``unitCode`` in a ranked player's ``pvpteam`` is
counted, including a team with only one character and duplicate characters in
the same team.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from quality_checks import validate_data
except ImportError:  # Allows importing this module from the test suite.
    from scripts.quality_checks import validate_data


TARGET_URL = "https://rangers.lerico.net/ja/pvp-tracker"
SOURCE_NAME = "LINE Rangers Handbook PvP Tracker"
LEAGUE = "LEGEND"
API_URL_TEMPLATE = "https://rangers.lerico.net/api/v2/pvp/league/rank/{league}"
TARGET_PLAYER_COUNT = int(os.environ.get("TARGET_PLAYER_COUNT", "200"))
MIN_REQUIRED_PLAYERS = int(os.environ.get("MIN_REQUIRED_PLAYERS", "50"))
MIN_CHARACTERS_PER_PLAYER = 1
MAX_CHARACTERS_PER_PLAYER = 10
REQUEST_TIMEOUT_SECONDS = 30
OUTPUT_PATH = Path("docs/data/character_usage.json")
DEBUG_DIR = Path(".artifacts/debug")

# Unit codes are used only to construct a known image path. Reject malformed
# values instead of publishing a made-up or unsafe URL.
UNIT_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


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


def fetch_rank_data(league: str = LEAGUE) -> dict:
    url = API_URL_TEMPLATE.format(league=quote(league, safe=""))
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "line-rangers-pvp-stats/1.0",
        },
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", 200)
            if status >= 400:
                raise RuntimeError(f"PvP API returned HTTP {status}.")
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"PvP API returned HTTP {error.code}.") from error
    except URLError as error:
        raise RuntimeError(f"PvP API request failed: {error.reason}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("PvP API did not return valid JSON.") from error
    if not isinstance(payload, dict):
        raise RuntimeError("PvP API response has an invalid root structure.")
    return payload


def character_image_url(unit_code: str) -> str:
    """Return the canonical thumbnail URL for a validated unit code."""
    if not UNIT_CODE_PATTERN.fullmatch(unit_code):
        raise ValueError(f"Invalid unit code: {unit_code!r}")
    encoded = quote(unit_code, safe="-_")
    return f"https://rangers.lerico.net/res/{encoded}/{encoded}-thum.png"


def team_group_sort_key(item: tuple[object, object]) -> tuple[int, int | str]:
    key = str(item[0])
    return (0, int(key)) if key.isdecimal() else (1, key)


def extract_ranked_players(payload: dict, target_players: int) -> tuple[list[dict], dict]:
    """Extract complete PvP teams for the first ranked players.

    ``pvpteam`` contains the two visible defense groups. They form one
    player's defence formation, so both groups are included. We do not fall
    back to the selected team number: that would silently discard half of a
    normal ten-character formation.
    """
    rankings = payload.get("top100")
    player_info = payload.get("playerInfo")
    if not isinstance(rankings, list) or not isinstance(player_info, list):
        raise RuntimeError("PvP API response is missing top100 or playerInfo.")

    info_by_mid = {
        str(record.get("mid")): record
        for record in player_info
        if isinstance(record, dict) and str(record.get("mid") or "").strip()
    }
    players: list[dict] = []
    seen_mids: set[str] = set()
    diagnostics: dict = {
        "ranked_players_available": len(rankings),
        "player_info_available": len(info_by_mid),
        "missing_player_info": [],
        "invalid_players": [],
        "invalid_unit_codes": [],
    }

    for rank_record in rankings:
        if len(players) >= target_players:
            break
        if not isinstance(rank_record, dict):
            diagnostics["invalid_players"].append("ranking entry is not an object")
            continue

        mid = str(rank_record.get("mid") or "").strip()
        if not mid or mid in seen_mids:
            diagnostics["invalid_players"].append(
                f"missing or duplicate player id: {mid or '<empty>'}"
            )
            continue
        seen_mids.add(mid)
        info = info_by_mid.get(mid)
        if info is None:
            diagnostics["missing_player_info"].append(mid)
            continue

        team_map = info.get("playerUnitTeamGroupMap")
        team_map = team_map if isinstance(team_map, dict) else {}
        team_groups = team_map.get("pvpteam")
        if not isinstance(team_groups, dict):
            diagnostics["invalid_players"].append(f"{mid}: no pvpteam map")
            continue

        units: list[str] = []
        invalid_code = False
        for _, group in sorted(team_groups.items(), key=team_group_sort_key):
            if not isinstance(group, list):
                invalid_code = True
                break
            for unit in group:
                code = str(unit.get("unitCode") or "").strip() if isinstance(unit, dict) else ""
                if not UNIT_CODE_PATTERN.fullmatch(code):
                    diagnostics["invalid_unit_codes"].append(
                        {"mid": mid, "unit_code": code}
                    )
                    invalid_code = True
                    break
                units.append(code)
            if invalid_code:
                break

        if invalid_code or not (MIN_CHARACTERS_PER_PLAYER <= len(units) <= MAX_CHARACTERS_PER_PLAYER):
            diagnostics["invalid_players"].append(f"{mid}: character count={len(units)}")
            continue
        players.append({"mid": mid, "units": units})

    diagnostics["valid_players"] = len(players)
    diagnostics["team_size_distribution"] = dict(
        sorted(Counter(len(player["units"]) for player in players).items())
    )
    return players, diagnostics


def build_statistics(players: list[dict], diagnostics: dict) -> dict:
    counts = defaultdict(lambda: {"occurrence_count": 0, "player_count": 0})
    player_sizes: list[int] = []
    for player in players:
        units = player["units"]
        player_sizes.append(len(units))
        seen_units: set[str] = set()
        for unit_code in units:
            counts[unit_code]["occurrence_count"] += 1
            seen_units.add(unit_code)
        for unit_code in seen_units:
            counts[unit_code]["player_count"] += 1

    sampled_players = len(players)
    total_slots = sum(player_sizes)
    if not sampled_players or not total_slots:
        raise RuntimeError("No character slots were found in the ranked players.")

    characters = [
        {
            "image": character_image_url(unit_code),
            "occurrence_count": int(data["occurrence_count"]),
            "player_count": int(data["player_count"]),
            "adoption_rate": round(data["player_count"] / sampled_players * 100, 1),
            "slot_rate": round(data["occurrence_count"] / total_slots * 100, 2),
        }
        for unit_code, data in counts.items()
    ]
    characters.sort(
        key=lambda item: (-item["occurrence_count"], -item["player_count"], item["image"])
    )
    previous_count = None
    current_rank = 0
    for index, character in enumerate(characters, start=1):
        if character["occurrence_count"] != previous_count:
            current_rank = index
        character["rank"] = current_rank
        previous_count = character["occurrence_count"]

    calculated_slots = sum(item["occurrence_count"] for item in characters)
    if calculated_slots != total_slots:
        raise RuntimeError(
            "Character totals do not match team totals: "
            f"{calculated_slots} != {total_slots}"
        )
    return {
        "schema_version": 4,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": {"name": SOURCE_NAME, "url": TARGET_URL},
        "league": "レジェンド",
        "target_players": TARGET_PLAYER_COUNT,
        "sampled_players": sampled_players,
        "character_slots": total_slots,
        "unique_characters": len(characters),
        "median_characters_per_player": median(player_sizes),
        "pages_scanned": 1,
        "termination_reason": "api_target_reached",
        "complete_target": sampled_players >= TARGET_PLAYER_COUNT,
        "characters": characters,
        "diagnostics": diagnostics,
    }


def scrape() -> dict:
    if TARGET_PLAYER_COUNT < 1:
        raise RuntimeError("TARGET_PLAYER_COUNT must be at least 1.")
    payload = fetch_rank_data()
    players, diagnostics = extract_ranked_players(payload, TARGET_PLAYER_COUNT)
    if len(players) < MIN_REQUIRED_PLAYERS:
        raise RuntimeError(
            "Not enough valid players from the PvP API: "
            f"{len(players)} < {MIN_REQUIRED_PLAYERS}"
        )
    if len(players) < TARGET_PLAYER_COUNT and len(payload.get("top100", [])) >= TARGET_PLAYER_COUNT:
        raise RuntimeError(
            "Some requested ranked players had incomplete team data; "
            "refusing to publish a partial sample."
        )
    return build_statistics(players, diagnostics)


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
            f"termination={data['termination_reason']}"
        )
    except Exception as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
