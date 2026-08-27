import json
from datetime import datetime, timedelta, timezone

from scripts.check_data_freshness import check_freshness


def write_timestamp(path, timestamp):
    path.write_text(
        json.dumps({"updated_at": timestamp.isoformat()}),
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
