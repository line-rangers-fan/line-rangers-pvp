"""Decide whether the published ranking data needs a repair collection."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


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
        updated_at = parse_timestamp(data.get("updated_at"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
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
