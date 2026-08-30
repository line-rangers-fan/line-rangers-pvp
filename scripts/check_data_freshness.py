"""Decide whether the published ranking data needs a repair collection."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

try:
    from quality_checks import (
        CALENDAR_CLOSE_REFERENCE_MODE,
        MAX_COLLECTION_DURATION_SECONDS,
        RANK_PERIODS,
        SCHEMA_VERSION,
    )
except ImportError:  # Allows importing this module from the test suite.
    from scripts.quality_checks import (
        CALENDAR_CLOSE_REFERENCE_MODE,
        MAX_COLLECTION_DURATION_SECONDS,
        RANK_PERIODS,
        SCHEMA_VERSION,
    )


DEFAULT_DATA_PATH = Path("docs/data/character_usage.json")


@dataclass(frozen=True)
class Freshness:
    due: bool
    age_minutes: float | None
    reason: str


def parse_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("updated_at is missing")
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def has_complete_sample(data: dict) -> bool:
    """Check the publication guard fields without re-running full statistics."""
    try:
        schema_version = int(data.get("schema_version", 0))
        target = int(data.get("target_players", 0))
        sampled = int(data.get("sampled_players", 0))
        characters = data.get("characters")
        quality = data.get("collection_quality")
        comparison = data.get("comparison")
        if not isinstance(quality, dict):
            return False
        comparison_periods = (
            comparison.get("periods") if isinstance(comparison, dict) else None
        )
        if not isinstance(comparison_periods, dict):
            return False
        if comparison.get("reference_mode") != CALENDAR_CLOSE_REFERENCE_MODE:
            return False
        if any(
            not isinstance(comparison_periods.get(period), dict)
            or not isinstance(comparison_periods[period].get("comparable"), bool)
            for period in RANK_PERIODS
        ):
            return False
        collection_duration = float(quality.get("collection_duration_seconds"))
        detail_duration = float(quality.get("detail_fetch_duration_seconds"))
        equipment_fill_rate = float(quality.get("equipment_fill_rate"))
        return (
            schema_version >= SCHEMA_VERSION
            and target > 0
            and sampled == target
            and data.get("complete_target") is True
            and isinstance(characters, list)
            and len(characters) > 0
            and float(quality.get("sample_coverage", 0)) == 100.0
            and math.isfinite(collection_duration)
            and 0 <= collection_duration <= MAX_COLLECTION_DURATION_SECONDS
            and math.isfinite(detail_duration)
            and 0 <= detail_duration <= collection_duration
            and math.isfinite(equipment_fill_rate)
            and 0 <= equipment_fill_rate <= 100
            and int(quality.get("detail_fetch_failures", -1)) == 0
            and int(quality.get("invalid_player_records", -1)) == 0
        )
    except (TypeError, ValueError, OverflowError):
        return False


def check_freshness(
    path: Path = DEFAULT_DATA_PATH,
    max_age_minutes: float = 50,
    *,
    force: bool = False,
    now: datetime | None = None,
) -> Freshness:
    """Return a deterministic collection decision for workflows and tests."""
    if max_age_minutes <= 0:
        raise ValueError("max_age_minutes must be positive")
    if force:
        return Freshness(True, None, "forced")

    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    current_time = current_time.astimezone(timezone.utc)

    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        if not isinstance(data, dict):
            raise ValueError("ranking JSON root is not an object")
        if not has_complete_sample(data):
            return Freshness(True, None, "invalid_quality")
        updated_at = parse_timestamp(data.get("updated_at"))
    except (OSError, TypeError, ValueError, OverflowError, json.JSONDecodeError):
        return Freshness(True, None, "missing_or_invalid_data")

    age_minutes = (current_time - updated_at).total_seconds() / 60
    if age_minutes < -10:
        return Freshness(True, age_minutes, "future_timestamp")
    if age_minutes >= max_age_minutes:
        return Freshness(True, age_minutes, "stale")
    return Freshness(False, max(0.0, age_minutes), "fresh")


def write_github_output(path: Path, result: Freshness) -> None:
    age = "unknown" if result.age_minutes is None else f"{result.age_minutes:.1f}"
    with path.open("a", encoding="utf-8") as output:
        output.write(f"due={'true' if result.due else 'false'}\n")
        output.write(f"age_minutes={age}\n")
        output.write(f"reason={result.reason}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, default=DEFAULT_DATA_PATH)
    parser.add_argument("--max-age-minutes", type=float, default=50)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    result = check_freshness(
        args.path,
        args.max_age_minutes,
        force=args.force,
    )
    if args.github_output:
        write_github_output(args.github_output, result)
    age = "unknown" if result.age_minutes is None else f"{result.age_minutes:.1f}"
    print(f"Collection due: {result.due} (reason={result.reason}, age_minutes={age})")


if __name__ == "__main__":
    main()
