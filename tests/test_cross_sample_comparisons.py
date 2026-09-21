from copy import deepcopy
from datetime import datetime, timedelta
import json
from pathlib import Path

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


def test_published_comparison_values_match_selected_history_baselines():
    data = json.loads(Path("docs/data/character_usage.json").read_text(encoding="utf-8"))
    history = json.loads(Path("docs/data/character_usage_history.json").read_text(encoding="utf-8"))
    snapshots = {
        snapshot["updated_at"]: snapshot
        for snapshot in history.get("snapshots", [])
        if isinstance(snapshot, dict) and isinstance(snapshot.get("updated_at"), str)
    }

    source_stale = data["comparison"].get("source_stale") is True
    for period in ("hour", "day", "week", "month"):
        summary = data["comparison"]["periods"][period]
        if source_stale and summary.get("reason") == "source_stale":
            assert summary["comparable"] is False
            assert summary["updated_at"] is None
            for current in data["characters"]:
                change = current["change"]["periods"][period]
                assert change["comparable"] is False
                assert change["reason"] == "source_stale"
                assert change["occurrence_count"] is None
                for category in current["equipment_rankings"].values():
                    for item in category["items"]:
                        item_change = item["change"]["periods"][period]
                        assert item_change["comparable"] is False
                        assert item_change["reason"] == "source_stale"
                        assert item_change["occurrence_count"] is None
            continue

        assert summary["comparable"] is True
        baseline = snapshots.get(summary["updated_at"])
        assert baseline is not None, f"{period} baseline is not retained in public history"
        assert baseline["sampled_players"] == scraper.TARGET_PLAYER_COUNT
        baseline_characters = {
            row["unit_code"]: row for row in baseline.get("characters", [])
        }

        for current in data["characters"]:
            old = baseline_characters.get(current["unit_code"])
            change = current["change"]["periods"][period]
            expected_count = current["occurrence_count"] - (
                old["occurrence_count"] if old else 0
            )
            assert change["comparable"] is True
            assert change["from_updated_at"] == summary["updated_at"]
            assert change["occurrence_count"] == expected_count, (
                period,
                current["unit_code"],
                expected_count,
                change["occurrence_count"],
            )
            if old:
                assert change["rank"] == old["rank"] - current["rank"]

            for equipment_type, category in current["equipment_rankings"].items():
                old_items = {
                    item["item_code"]: item
                    for item in (
                        old.get("equipment_rankings", {})
                        .get(equipment_type, {})
                        .get("items", [])
                        if old
                        else []
                    )
                }
                for item in category["items"]:
                    old_item = old_items.get(item["item_code"])
                    item_change = item["change"]["periods"][period]
                    expected_item_count = item["occurrence_count"] - (
                        old_item["occurrence_count"] if old_item else 0
                    )
                    assert item_change["comparable"] is True
                    assert item_change["from_updated_at"] == summary["updated_at"]
                    assert item_change["occurrence_count"] == expected_item_count, (
                        period,
                        current["unit_code"],
                        equipment_type,
                        item["item_code"],
                        expected_item_count,
                        item_change["occurrence_count"],
                    )
                    if old_item:
                        assert item_change["rank"] == old_item["rank"] - item["rank"]
