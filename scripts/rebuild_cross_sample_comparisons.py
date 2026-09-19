"""Rebuild PvP period comparisons from verified complete Legend snapshots.

Public comparison baselines must remain 200/200. Partial collections may be
diagnostic evidence elsewhere, but they are never retained or reused as
one-hour/day/week/month comparison references.
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
RECENT_GIT_VERSIONS = 24


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
    if sampled != scraper.TARGET_PLAYER_COUNT:
        return False
    try:
        return scraper._usable_history_snapshot(
            snapshot, current_time, scraper.TARGET_PLAYER_COUNT
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
    """Recover recent partial publications during first-time bootstrap."""
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
    previous = previous_context(snapshots[-1] if snapshots else None, data)

    scraper.add_previous_comparison(data, previous, clean_history)
    if isinstance(data.get("comparison"), dict):
        data["comparison"]["comparable"] = previous is not None

    # Keep all current-sample quality and fixed-JST comparison checks strict.
    validate_data(data)

    # A partial publication must never become comparison history. It can be
    # displayed as partial elsewhere, but comparisons stay unavailable until
    # the next complete 200/200 collection.
    if (
        data.get("sampled_players") != scraper.TARGET_PLAYER_COUNT
        or data.get("complete_target") is not True
    ):
        return data, clean_history

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
