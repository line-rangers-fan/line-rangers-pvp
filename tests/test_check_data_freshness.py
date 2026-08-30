import json
from datetime import datetime, timedelta, timezone

from scripts.check_data_freshness import check_freshness
from scripts.quality_checks import CALENDAR_CLOSE_REFERENCE_MODE, SCHEMA_VERSION
from scripts.scrape_character_usage import add_previous_comparison
from test_quality_checks import valid_data


def write_timestamp(path, timestamp):
    data = valid_data(sampled_players=200)
    data["updated_at"] = timestamp.isoformat()
    data["collection_quality"]["collection_started_at"] = (timestamp - timedelta(seconds=12)).isoformat()
    data["collection_quality"]["collection_duration_seconds"] = 12.0
    data["collection_quality"]["detail_fetch_duration_seconds"] = 10.0
    add_previous_comparison(data, None, {"snapshots": []})
    path.write_text(
        json.dumps(data),
        encoding="utf-8",
    )


def test_fresh_data_is_not_due(tmp_path):
    now = datetime(2026, 8, 27, 3, 0, tzinfo=timezone.utc)
    path = tmp_path / "ranking.json"
    write_timestamp(path, now - timedelta(minutes=49))

    result = check_freshness(path, 50, now=now)

    assert result.due is False
    assert result.reason == "fresh"


def test_stale_missing_and_future_data_are_due(tmp_path):
    now = datetime(2026, 8, 27, 3, 0, tzinfo=timezone.utc)
    path = tmp_path / "ranking.json"
    write_timestamp(path, now - timedelta(minutes=50))
    assert check_freshness(path, 50, now=now).reason == "stale"

    path.unlink()
    assert check_freshness(path, 50, now=now).reason == "missing_or_invalid_data"

    write_timestamp(path, now + timedelta(minutes=11))
    assert check_freshness(path, 50, now=now).reason == "future_timestamp"


def test_force_always_collects(tmp_path):
    result = check_freshness(tmp_path / "missing.json", 50, force=True)

    assert result.due is True
    assert result.reason == "forced"


def test_fresh_but_incomplete_data_is_due(tmp_path):
    now = datetime(2026, 8, 27, 3, 0, tzinfo=timezone.utc)
    path = tmp_path / "ranking.json"
    write_timestamp(path, now - timedelta(minutes=5))
    data = json.loads(path.read_text(encoding="utf-8"))
    data["sampled_players"] = 199
    path.write_text(json.dumps(data), encoding="utf-8")

    result = check_freshness(path, 50, now=now)

    assert result.due is True
    assert result.reason == "invalid_quality"


def test_fresh_data_with_impossible_collection_timing_is_due(tmp_path):
    now = datetime(2026, 8, 27, 3, 0, tzinfo=timezone.utc)
    path = tmp_path / "ranking.json"
    write_timestamp(path, now - timedelta(minutes=5))
    data = json.loads(path.read_text(encoding="utf-8"))
    data["collection_quality"]["detail_fetch_duration_seconds"] = 13.0
    data["collection_quality"]["collection_duration_seconds"] = 12.0
    path.write_text(json.dumps(data), encoding="utf-8")

    result = check_freshness(path, 50, now=now)

    assert result.due is True
    assert result.reason == "invalid_quality"


def test_legacy_schema_or_missing_hour_comparison_is_due(tmp_path):
    now = datetime(2026, 8, 27, 3, 0, tzinfo=timezone.utc)
    path = tmp_path / "ranking.json"
    write_timestamp(path, now - timedelta(minutes=5))
    data = json.loads(path.read_text(encoding="utf-8"))
    data["schema_version"] = SCHEMA_VERSION - 1
    path.write_text(json.dumps(data), encoding="utf-8")

    assert check_freshness(path, 50, now=now).reason == "invalid_quality"

    data["schema_version"] = SCHEMA_VERSION
    del data["comparison"]["periods"]["hour"]
    path.write_text(json.dumps(data), encoding="utf-8")
    assert check_freshness(path, 50, now=now).reason == "invalid_quality"
