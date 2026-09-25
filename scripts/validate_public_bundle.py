"""Fail closed when a public PvP snapshot, health, and comparison history disagree."""

from __future__ import annotations

import json
import sys
from datetime import timezone
from pathlib import Path

try:
    import scrape_character_usage as scraper
    from quality_checks import validate_data
    from validate_public_comparisons import validate_payload
except ImportError:
    from scripts import scrape_character_usage as scraper
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
        if not scraper._usable_history_snapshot(snapshot, current_time, 200):
            raise ValueError(f"{label} contains an invalid or partial comparison baseline")
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


def verify_deltas(data: dict, references: dict[str, dict]) -> None:
    summaries = data["comparison"]["periods"]
    for period, summary in summaries.items():
        if not summary["comparable"]:
            continue
        reference = references.get(summary["updated_at"])
        if reference is None:
            raise ValueError(f"{period} comparison has no verified 200/200 baseline")
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
            for kind, category in character["equipment_rankings"].items():
                old_rankings = old.get("equipment_rankings") if old else None
                old_category = old_rankings.get(kind) if isinstance(old_rankings, dict) else None
                # Character-only legacy snapshots do not prove equipment
                # counts; a missing character, however, proves zero use.
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


def validate_bundle(data: dict, health: dict, public_history: dict, cross_history: dict) -> None:
    if (
        data.get("target_players") != 200
        or data.get("sampled_players") != 200
        or data.get("complete_target") is not True
        or data.get("publication_mode") != "complete"
    ):
        raise ValueError("public aggregation requires a complete 200/200 snapshot")
    validate_data(data)
    validate_payload(data)
    if health != scraper.health_summary(data):
        raise ValueError("health JSON does not match the validated PvP snapshot")
    current_time = scraper._parse_history_time(data["updated_at"])
    public = checked_history(public_history, current_time, "public history")
    cross = checked_history(cross_history, current_time, "cross-sample history")
    verify_deltas(data, {**public, **cross})


def main() -> None:
    if len(sys.argv) != 1:
        raise SystemExit("usage: validate_public_bundle.py")
    validate_bundle(
        read_object(DATA), read_object(HEALTH),
        read_object(HISTORIES[0]), read_object(HISTORIES[1]),
    )
    print("Public 200/200 aggregation, health, and comparison history validated.")


if __name__ == "__main__":
    main()
