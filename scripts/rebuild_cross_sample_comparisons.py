"""Rebuild PvP period comparisons from verified Legend snapshots.

The collector still targets 200 ranked players on every run. Any structurally
valid nonzero sample can be published and can serve as comparison evidence.
Variable-size samples are retained only in the comparison history; the public
target remains 200 so coverage stays visible to users and monitoring.
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import scrape_character_usage as scraper
    from quality_checks import validate_data
except ImportError:
    from scripts import scrape_character_usage as scraper
    from scripts.quality_checks import validate_data

DATA_PATH = Path("docs/data/character_usage.json")
PUBLIC_HISTORY_PATH = Path("docs/data/character_usage_history.json")
CROSS_SAMPLE_HISTORY_PATH = Path("docs/data/character_usage_cross_sample_history.json")
HEALTH_PATH = Path("docs/data/character_usage_health.json")
RECENT_GIT_VERSIONS = 192


def load_dict(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def _current_time(data: dict) -> datetime:
    value = scraper._parse_history_time(data.get("updated_at"))
    if value is None:
        raise ValueError("current data has no valid updated_at timestamp")
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


def _usable_snapshot(snapshot: object, current_time: datetime) -> bool:
    """Validate a compact snapshot against its own sampled-player count."""
    if not isinstance(snapshot, dict):
        return False
    sampled = scraper._exact_int(snapshot.get("sampled_players"))
    if sampled is None or not 0 < sampled <= scraper.TARGET_PLAYER_COUNT:
        return False
    try:
        return scraper._usable_history_snapshot(
            snapshot, current_time, sampled
        )
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
        return False


def merge_history_sources(
    data: dict,
    *histories: dict | None,
    extra_snapshots: list[dict] | None = None,
) -> dict:
    """Merge verified history without requiring the same player count."""
    current_time = _current_time(data)
    verified: dict[datetime, dict] = {}

    def consider(snapshot: object) -> None:
        if not _usable_snapshot(snapshot, current_time):
            return
        timestamp = scraper._parse_history_time(snapshot.get("updated_at"))
        if timestamp is None or timestamp >= current_time:
            return
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        verified[timestamp] = snapshot

    for history in histories:
        snapshots = history.get("snapshots") if isinstance(history, dict) else None
        if isinstance(snapshots, list):
            for snapshot in snapshots:
                consider(snapshot)
    for snapshot in extra_snapshots or []:
        consider(snapshot)

    return {"snapshots": [verified[key] for key in sorted(verified)]}


def compact_snapshot_from_published(payload: object, current_time: datetime) -> dict | None:
    if not isinstance(payload, dict):
        return None
    timestamp = scraper._parse_history_time(payload.get("updated_at"))
    if timestamp is None or timestamp >= current_time:
        return None
    try:
        validate_data(payload)
        snapshot = scraper.history_snapshot(payload)
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
        return None
    return snapshot if _usable_snapshot(snapshot, current_time) else None


def recent_git_snapshots(data: dict, limit: int = RECENT_GIT_VERSIONS) -> list[dict]:
    """Recover recent validated publications during comparison bootstrap."""
    if limit <= 0:
        return []
    current_time = _current_time(data)
    try:
        history = subprocess.run(
            ["git", "log", f"-n{limit}", "--format=%H", "--", DATA_PATH.as_posix()],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if history.returncode != 0:
        return []

    snapshots: list[dict] = []
    for commit_sha in [line.strip() for line in history.stdout.splitlines() if line.strip()]:
        try:
            shown = subprocess.run(
                ["git", "show", f"{commit_sha}:{DATA_PATH.as_posix()}"],
                check=False,
                capture_output=True,
                text=True,
                timeout=8,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if shown.returncode != 0:
            continue
        try:
            payload = json.loads(shown.stdout)
        except (ValueError, RecursionError):
            continue
        snapshot = compact_snapshot_from_published(payload, current_time)
        if snapshot is not None:
            snapshots.append(snapshot)
    return snapshots


def _runtime_partial_hour_reference(
    data: dict,
    limit: int = RECENT_GIT_VERSIONS,
) -> dict | None:
    """Recover one same-sized partial snapshot for the one-hour display only."""
    fallback = data.get("partial_fallback")
    sampled = scraper._exact_int(data.get("sampled_players"))
    if (
        limit <= 0
        or data.get("complete_target") is not False
        or data.get("publication_mode") != scraper.PARTIAL_PUBLICATION_MODE
        or not isinstance(fallback, dict)
        or fallback.get("trigger_after_minutes") != 0
        or sampled is None
        or not 0 < sampled < scraper.TARGET_PLAYER_COUNT
    ):
        return None

    current_time = _current_time(data)
    target_time = current_time - timedelta(hours=1)
    try:
        history = subprocess.run(
            ["git", "log", f"-n{limit}", "--format=%H", "--", DATA_PATH.as_posix()],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if history.returncode != 0:
        return None

    candidates: list[tuple[float, float, dict]] = []
    for commit_sha in [line.strip() for line in history.stdout.splitlines() if line.strip()]:
        try:
            shown = subprocess.run(
                ["git", "show", f"{commit_sha}:{DATA_PATH.as_posix()}"],
                check=False,
                capture_output=True,
                text=True,
                timeout=8,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if shown.returncode != 0:
            continue
        try:
            payload = json.loads(shown.stdout)
        except (ValueError, RecursionError):
            continue
        if (
            not isinstance(payload, dict)
            or scraper._exact_int(payload.get("sampled_players")) != sampled
            or payload.get("complete_target") is not False
            or payload.get("publication_mode") != scraper.PARTIAL_PUBLICATION_MODE
        ):
            continue
        timestamp = scraper._parse_history_time(payload.get("updated_at"))
        if timestamp is None or timestamp.tzinfo is None or timestamp >= current_time:
            continue
        age = (current_time - timestamp).total_seconds()
        if not 30 * 60 <= age <= 90 * 60:
            continue
        try:
            validate_data(payload)
            snapshot = scraper.history_snapshot(payload)
            if not scraper._usable_history_snapshot(snapshot, current_time, sampled):
                continue
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
            continue
        candidates.append(
            (
                abs((timestamp - target_time).total_seconds()),
                -timestamp.timestamp(),
                snapshot,
            )
        )

    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[0], item[1]))[2]


def _limit_partial_comparison_to_character_hour(data: dict) -> None:
    """Keep the partial exception limited to the requested character-hour delta."""
    summary_unavailable = {
        "comparable": False,
        "updated_at": None,
        "calendar_date": None,
    }
    row_unavailable = {
        "comparable": False,
        "rank": None,
        "occurrence_count": None,
        "from_updated_at": None,
        "interval_minutes": None,
    }

    comparison = data.get("comparison")
    if isinstance(comparison, dict):
        comparison["comparable"] = False
        summaries = comparison.get("periods")
        if isinstance(summaries, dict):
            for period in ("day", "week", "month"):
                summaries[period] = dict(summary_unavailable)

    for character in data.get("characters", []):
        if not isinstance(character, dict):
            continue
        periods = (character.get("change") or {}).get("periods")
        if isinstance(periods, dict):
            for period in ("day", "week", "month"):
                periods[period] = dict(row_unavailable)
        for category in (character.get("equipment_rankings") or {}).values():
            if not isinstance(category, dict):
                continue
            for item in category.get("items", []):
                if not isinstance(item, dict):
                    continue
                item_periods = (item.get("change") or {}).get("periods")
                if isinstance(item_periods, dict):
                    for period in ("hour", "day", "week", "month"):
                        item_periods[period] = dict(row_unavailable)


def previous_context(snapshot: dict | None, data: dict) -> dict | None:
    if not isinstance(snapshot, dict):
        return None
    rows = snapshot.get("characters")
    if not isinstance(rows, list) or not rows:
        return None
    return {
        "updated_at": snapshot.get("updated_at"),
        "target_players": data.get("target_players"),
        "sampled_players": snapshot.get("sampled_players"),
        "character_slots": snapshot.get("character_slots"),
        "characters": rows,
    }


def rebuild_comparisons(data: dict, history: dict | None) -> tuple[dict, dict]:
    """Attach period comparisons from valid history regardless of headcount."""
    current_time = _current_time(data)
    clean_history = merge_history_sources(data, history)
    snapshots = clean_history["snapshots"]

    clean_history, source_context = scraper.quarantine_repeated_source_history(
        data, clean_history
    )
    snapshots = clean_history["snapshots"]
    if source_context.get("stale") is True:
        previous = previous_context(snapshots[-1] if snapshots else None, data)
        scraper.add_previous_comparison(data, previous, clean_history)
        scraper.mark_source_stale_comparison(data, source_context)
        validate_data(data)
        return data, clean_history

    previous = previous_context(snapshots[-1] if snapshots else None, data)
    scraper.add_previous_comparison(data, previous, clean_history)
    if isinstance(data.get("comparison"), dict):
        data["comparison"]["comparable"] = previous is not None

    # Keep current-sample quality and fixed-JST comparison checks strict. The
    # current nonzero sample is retained even when fewer than 200 players were
    # available, so a later day/week/month close does not become "history pending".
    validate_data(data)
    next_history = scraper.update_history(data, clean_history)
    added = next(
        (
            snapshot
            for snapshot in reversed(next_history.get("snapshots", []))
            if snapshot.get("updated_at") == data.get("updated_at")
        ),
        None,
    )
    if not _usable_snapshot(added, current_time + timedelta(microseconds=1)):
        raise ValueError("failed to retain the current comparison snapshot")
    return data, next_history


def _atomic_save(path: Path, value: object) -> None:
    temporary = path.with_name(f"{path.name}.tmp")
    scraper.save_json(temporary, value)
    temporary.replace(path)


def main() -> None:
    data = load_dict(DATA_PATH)
    if data is None:
        raise RuntimeError("current PvP data is unavailable")

    merged = merge_history_sources(
        data,
        load_dict(CROSS_SAMPLE_HISTORY_PATH),
        load_dict(PUBLIC_HISTORY_PATH),
        extra_snapshots=recent_git_snapshots(data),
    )
    data, cross_history = rebuild_comparisons(data, merged)
    health = scraper.health_summary(data)

    _atomic_save(CROSS_SAMPLE_HISTORY_PATH, cross_history)
    _atomic_save(DATA_PATH, data)
    _atomic_save(HEALTH_PATH, health)

    periods = data.get("comparison", {}).get("periods", {})
    ready = [
        name
        for name, value in periods.items()
        if isinstance(value, dict) and value.get("comparable") is True
    ]
    print(
        "[DONE] cross-sample comparisons "
        f"players={data.get('sampled_players')}, "
        f"history={len(cross_history.get('snapshots', []))}, "
        f"ready={','.join(ready) or 'none'}"
    )


if __name__ == "__main__":
    main()
