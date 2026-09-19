from copy import deepcopy
from datetime import datetime, timedelta

from scripts import rebuild_cross_sample_comparisons as cross
from scripts import scrape_character_usage as scraper
from scripts.quality_checks import (
    PARTIAL_FALLBACK_AFTER_MINUTES,
    PARTIAL_PUBLICATION_MODE,
    validate_data,
)
from test_quality_checks import valid_data


def stamped_complete(players: int, timestamp: str) -> dict:
    data = valid_data(sampled_players=players)
    moment = datetime.fromisoformat(timestamp)
    data["updated_at"] = moment.isoformat()
    data["collection_quality"]["collection_started_at"] = (
        moment - timedelta(minutes=1)
    ).isoformat()
    scraper.add_previous_comparison(data, None, {"snapshots": []})
    assert validate_data(data)
    return data


def stamped_partial(players: int, timestamp: str) -> dict:
    data = valid_data(sampled_players=players)
    moment = datetime.fromisoformat(timestamp)
    data["updated_at"] = moment.isoformat()
    data["target_players"] = 200
    data["complete_target"] = False
    data["publication_mode"] = PARTIAL_PUBLICATION_MODE
    data["partial_fallback"] = {
        "trigger_after_minutes": PARTIAL_FALLBACK_AFTER_MINUTES,
        "last_complete_updated_at": (moment - timedelta(hours=4)).isoformat(),
        "missing_players": 200 - players,
    }
    data["collection_quality"]["collection_started_at"] = (
        moment - timedelta(minutes=1)
    ).isoformat()
    data["collection_quality"]["sample_coverage"] = round(players / 200 * 100, 1)
    scraper.add_previous_comparison(data, None, {"snapshots": []})
    assert validate_data(data)
    return data


def test_partial_snapshot_is_not_comparable_or_retained():
    current = stamped_partial(199, "2026-08-31T07:00:00+09:00")
    previous = stamped_complete(200, "2026-08-31T06:00:00+09:00")
    previous_close = stamped_complete(200, "2026-08-30T23:30:00+09:00")
    history = {
        "snapshots": [
            scraper.history_snapshot(previous_close),
            scraper.history_snapshot(previous),
        ]
    }

    rebuilt, next_history = cross.rebuild_comparisons(deepcopy(current), history)

    assert rebuilt["comparison"]["periods"]["hour"]["comparable"] is False
    assert rebuilt["comparison"]["periods"]["day"]["comparable"] is False
    assert all(
        row["change"]["periods"]["hour"]["comparable"] is False
        for row in rebuilt["characters"]
    )
    assert all(
        snapshot["sampled_players"] == scraper.TARGET_PLAYER_COUNT
        for snapshot in next_history["snapshots"]
    )
    assert not any(
        snapshot["updated_at"] == current["updated_at"]
        for snapshot in next_history["snapshots"]
    )
    assert validate_data(rebuilt)


def test_complete_run_ignores_newer_partial_baseline():
    complete = stamped_complete(200, "2026-08-31T09:00:00+09:00")
    full_hour = stamped_complete(200, "2026-08-31T08:00:00+09:00")
    partial_newer = stamped_partial(199, "2026-08-31T08:30:00+09:00")
    history = {
        "snapshots": [
            scraper.history_snapshot(full_hour),
            scraper.history_snapshot(partial_newer),
        ]
    }

    rebuilt, next_history = cross.rebuild_comparisons(deepcopy(complete), history)

    assert rebuilt["comparison"]["periods"]["hour"]["comparable"] is True
    assert (
        rebuilt["comparison"]["periods"]["hour"]["updated_at"]
        == full_hour["updated_at"]
    )
    assert all(
        snapshot["sampled_players"] == scraper.TARGET_PLAYER_COUNT
        for snapshot in next_history["snapshots"]
    )
    assert not any(
        snapshot["updated_at"] == partial_newer["updated_at"]
        for snapshot in next_history["snapshots"]
    )
    assert validate_data(rebuilt)
