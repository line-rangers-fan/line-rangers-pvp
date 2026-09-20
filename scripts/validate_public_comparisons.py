"""Validate public PvP comparison readiness for deployment gates."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

PERIODS = ("hour", "day", "week", "month")


def _timestamp(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def _complete_period(value: object) -> bool:
    if not isinstance(value, dict) or value.get("comparable") is not True:
        return False
    delta = value.get("occurrence_count")
    return isinstance(delta, int) and not isinstance(delta, bool)


def validate_payload(data: object) -> None:
    if not isinstance(data, dict):
        raise ValueError("PvP payload is not an object")
    if data.get("target_players") != 200:
        raise ValueError("PvP target must remain 200")

    sampled = data.get("sampled_players")
    complete = sampled == 200 and data.get("complete_target") is True
    partial = (
        isinstance(sampled, int)
        and not isinstance(sampled, bool)
        and 0 < sampled < 200
        and data.get("complete_target") is False
        and data.get("publication_mode") == "partial_after_stale"
    )
    if not (complete or partial):
        raise ValueError("PvP payload is neither a valid complete nor partial publication")

    comparison = data.get("comparison")
    if not isinstance(comparison, dict) or comparison.get("reference_mode") != "jst_calendar_close_v1":
        raise ValueError("Unexpected comparison reference mode")

    # Partial-after-stale publications are intentionally not written into
    # comparison history. Complete 200/200 publications, however, must always
    # expose all four comparison periods; unchanged values are valid ±0 deltas.
    if not complete:
        return

    summaries = comparison.get("periods")
    if not isinstance(summaries, dict):
        raise ValueError("Missing comparison summaries")
    for period in PERIODS:
        summary = summaries.get(period)
        if (
            not isinstance(summary, dict)
            or summary.get("comparable") is not True
            or not _timestamp(summary.get("updated_at"))
        ):
            raise ValueError(f"Invalid comparison summary: {period}")

    characters = data.get("characters")
    if not isinstance(characters, list) or not characters:
        raise ValueError("Missing character rows")
    for character in characters:
        code = character.get("unit_code", "?") if isinstance(character, dict) else "?"
        periods = ((character.get("change") or {}).get("periods") or {}) if isinstance(character, dict) else {}
        for period in PERIODS:
            if not _complete_period(periods.get(period)):
                raise ValueError(f"Invalid character comparison: {code} {period}")

        for equipment_type, category in (character.get("equipment_rankings") or {}).items():
            for item in (category or {}).get("items") or []:
                item_code = item.get("item_code", "?")
                item_periods = ((item.get("change") or {}).get("periods") or {})
                for period in PERIODS:
                    if not _complete_period(item_periods.get(period)):
                        raise ValueError(
                            f"Invalid equipment comparison: {code} {equipment_type} {item_code} {period}"
                        )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: validate_public_comparisons.py PATH")
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    validate_payload(data)
    print("Public comparison state validated.")


if __name__ == "__main__":
    main()
