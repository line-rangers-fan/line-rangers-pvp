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


def test_200_to_199_uses_valid_hour_and_close_history():
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

    assert rebuilt["comparison"]["comparable"] is True
    assert rebuilt["comparison"]["periods"]["hour"]["comparable"] is True
    assert rebuilt["comparison"]["periods"]["hour"]["updated_at"] == previous["updated_at"]
    assert rebuilt["comparison"]["periods"]["day"]["comparable"] is True
    assert rebuilt["comparison"]["periods"]["day"]["updated_at"] == previous_close["updated_at"]
    assert all(
        row["change"]["periods"]["hour"]["comparable"] is True
        for row in rebuilt["characters"]
    )
    assert any(
        snapshot["sampled_players"] == 199
        and snapshot["updated_at"] == current["updated_at"]
        for snapshot in next_history["snapshots"]
    )
    assert validate_data(rebuilt)


def test_partial_history_remains_usable_when_player_count_changes_again():
    first = stamped_partial(199, "2026-08-31T07:00:00+09:00")
    base = stamped_complete(200, "2026-08-31T06:00:00+09:00")
    _, history = cross.rebuild_comparisons(
        deepcopy(first),
        {"snapshots": [scraper.history_snapshot(base)]},
    )

    second = stamped_partial(198, "2026-08-31T08:00:00+09:00")
    rebuilt_second, history = cross.rebuild_comparisons(deepcopy(second), history)
    assert rebuilt_second["comparison"]["periods"]["hour"]["comparable"] is True
    assert (
        rebuilt_second["comparison"]["periods"]["hour"]["updated_at"]
        == first["updated_at"]
    )

    complete = stamped_complete(200, "2026-08-31T09:00:00+09:00")
    rebuilt_complete, _ = cross.rebuild_comparisons(deepcopy(complete), history)
    assert rebuilt_complete["comparison"]["periods"]["hour"]["comparable"] is True
    assert (
        rebuilt_complete["comparison"]["periods"]["hour"]["updated_at"]
        == second["updated_at"]
    )
    assert validate_data(rebuilt_complete)
