"""Regression coverage for missing counts and the public comparison contract."""

from copy import deepcopy
from datetime import datetime, timedelta
import json

import pytest

from scripts import scrape_character_usage as scraper
from scripts.check_data_freshness import check_freshness, has_complete_sample
from scripts.quality_checks import validate_data
from test_quality_checks import valid_data


def complete_data(timestamp="2026-08-31T07:00:00+09:00"):
    data = valid_data(sampled_players=200)
    data["updated_at"] = timestamp
    data["collection_quality"]["collection_started_at"] = (
        datetime.fromisoformat(timestamp) - timedelta(seconds=60)
    ).isoformat()
    return scraper.add_previous_comparison(data, None, {"snapshots": []})


def comparison_case():
    previous = complete_data("2026-08-31T06:00:00+09:00")
    close = complete_data("2026-08-30T23:30:00+09:00")
    history = {"snapshots": [scraper.history_snapshot(close), scraper.history_snapshot(previous)]}
    data = complete_data()
    scraper.add_previous_comparison(data, previous, history)
    assert validate_data(data, previous)
    return data, previous, history


@pytest.mark.parametrize("bad_count", [None, -1, True, "", "100", 1.5])
def test_missing_or_invalid_history_count_is_not_zero(bad_count):
    data, previous, history = comparison_case()
    history["snapshots"][-1]["characters"][0]["occurrence_count"] = bad_count
    scraper.add_previous_comparison(data, previous, history)
    result = data["characters"][0]["change"]["periods"]["hour"]
    assert result == {
        "comparable": False, "rank": None, "occurrence_count": None,
        "from_updated_at": None, "interval_minutes": None,
    }
    assert validate_data(data, previous)


def test_missing_count_key_and_absent_character_are_distinct():
    data, previous, history = comparison_case()
    del history["snapshots"][-1]["characters"][0]["occurrence_count"]
    scraper.add_previous_comparison(data, previous, history)
    assert data["characters"][0]["change"]["periods"]["hour"]["comparable"] is False
    history["snapshots"][-1]["characters"].pop(0)
    scraper.add_previous_comparison(data, previous, history)
    result = data["characters"][0]["change"]["periods"]["hour"]
    assert result["comparable"] is True
    assert result["occurrence_count"] == data["characters"][0]["occurrence_count"]


@pytest.mark.parametrize("bad_count", [None, -1, True, "", 1.5])
def test_equipment_missing_count_is_not_an_increase(bad_count):
    current = {"item_code": "w1", "rank": 1, "occurrence_count": 8}
    reference = {"updated_at": "2026-08-31T06:00:00+09:00", "characters": [{
        "unit_code": "u-a", "equipment_rankings": {
            "WEAPON": {"items": [{"item_code": "w1", "rank": 1, "occurrence_count": bad_count}]},
        },
    }]}
    result = scraper._equipment_period_change(current, reference, "u-a", "WEAPON", datetime.fromisoformat("2026-08-31T07:00:00+09:00"))
    assert result["comparable"] is False
    assert result["occurrence_count"] is None


def test_legacy_character_only_history_is_not_zero_equipment():
    reference = {"updated_at": "2026-08-31T06:00:00+09:00", "characters": [{"unit_code": "u-a"}]}
    result = scraper._equipment_period_change(
        {"item_code": "w1", "rank": 1, "occurrence_count": 8}, reference,
        "u-a", "WEAPON", datetime.fromisoformat("2026-08-31T07:00:00+09:00"),
    )
    assert result["comparable"] is False


@pytest.mark.parametrize("case", [
    "missing_comparison", "missing_summaries", "missing_summary", "missing_character_periods",
    "null_delta", "wrong_calendar", "wrong_current_date", "wrong_close_hour",
    "wrong_hour_window", "wrong_row_timestamp", "wrong_row_interval",
])
@pytest.mark.parametrize("with_previous", [False, True])
def test_publication_rejects_broken_comparison_contract(case, with_previous):
    data, previous, _ = comparison_case()
    comparison = data["comparison"]
    change = data["characters"][0]["change"]
    if case == "missing_comparison":
        del data["comparison"]
    elif case == "missing_summaries":
        del comparison["periods"]
    elif case == "missing_summary":
        del comparison["periods"]["hour"]
    elif case == "missing_character_periods":
        del change["periods"]
    elif case == "null_delta":
        change["periods"]["hour"]["occurrence_count"] = None
    elif case == "wrong_calendar":
        comparison["periods"]["day"]["calendar_date"] = "1900-01-01"
    elif case == "wrong_current_date":
        comparison["calendar_date"] = "2026-08-30"
    elif case == "wrong_close_hour":
        comparison["periods"]["day"]["updated_at"] = "2026-08-30T21:59:00+09:00"
    elif case == "wrong_hour_window":
        comparison["periods"]["hour"]["updated_at"] = "2026-08-31T05:00:00+09:00"
    elif case == "wrong_row_timestamp":
        change["periods"]["hour"]["from_updated_at"] = "2026-08-31T05:00:00+09:00"
    elif case == "wrong_row_interval":
        change["periods"]["hour"]["interval_minutes"] = 1
    with pytest.raises(ValueError):
        validate_data(data, previous if with_previous else None)


@pytest.mark.parametrize("case", ["negative_count", "null_count", "missing_periods", "wrong_date", "wrong_total", "equipment_total"])
def test_fresh_corrupt_payload_requests_repair(case, tmp_path):
    data, _, _ = comparison_case()
    if case == "negative_count":
        data["characters"][0]["occurrence_count"] = -1
    elif case == "null_count":
        data["characters"][0]["occurrence_count"] = None
    elif case == "missing_periods":
        del data["characters"][0]["change"]["periods"]
    elif case == "wrong_date":
        data["comparison"]["periods"]["day"]["calendar_date"] = "1900-01-01"
    elif case == "wrong_total":
        data["character_slots"] += 1
    elif case == "equipment_total":
        data["characters"][0]["equipment_rankings"]["WEAPON"]["equipped_occurrence_count"] = 1
    path = tmp_path / "data.json"
    path.write_text(json.dumps(data))
    result = check_freshness(path, now=datetime.fromisoformat(data["updated_at"]))
    assert result.due and result.reason == "invalid_quality"


def test_monitor_requires_200_players_even_when_smaller_sample_is_consistent():
    data = valid_data(sampled_players=199)
    assert validate_data(data)
    assert has_complete_sample(data) is False


def test_quality_failure_does_not_replace_previous_files(tmp_path, monkeypatch):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    output = tmp_path / "data.json"
    history = tmp_path / "history.json"
    output.write_text(json.dumps(previous))
    history.write_text(json.dumps({"snapshots": [scraper.history_snapshot(previous)]}))
    before = (output.read_bytes(), history.read_bytes())
    broken = complete_data()
    broken["characters"][0]["occurrence_count"] = -1
    monkeypatch.setattr(scraper, "OUTPUT_PATH", output)
    monkeypatch.setattr(scraper, "HISTORY_PATH", history)
    monkeypatch.setattr(scraper, "scrape", lambda: deepcopy(broken))
    with pytest.raises(ValueError):
        scraper.main()
    assert (output.read_bytes(), history.read_bytes()) == before


@pytest.mark.parametrize("minutes,expected", [(29.99,False),(30,True),(60,True),(90,True),(90.01,False)])
def test_hour_window_is_unchanged(minutes, expected):
    now = datetime.fromisoformat("2026-08-31T07:00:00+09:00")
    snapshot = scraper.history_snapshot(complete_data((now - timedelta(minutes=minutes)).isoformat()))
    assert (scraper._period_reference({"snapshots":[snapshot]}, now, 3600, "hour") is not None) == expected


def test_close_preference_and_month_end_survive_retention():
    now = datetime.fromisoformat("2026-10-31T07:00:00+09:00")
    data = complete_data(now.isoformat())
    snapshots = []
    for day in range(1, 51):
        for hour in (12, 22, 23):
            stamp = (now - timedelta(days=day)).replace(hour=hour)
            snapshots.append(scraper.history_snapshot(complete_data(stamp.isoformat())))
    history = scraper.update_history(data, {"snapshots":snapshots})
    assert len(history["snapshots"]) <= 96
    reference = scraper._period_reference(history, now, 31 * 86400, "month")
    assert reference["updated_at"] == "2026-09-30T23:00:00+09:00"
    assert history["retention_hours"] == 6 and history["calendar_close_retention_days"] == 40
    assert len({s["updated_at"] for s in history["snapshots"]}) == len(history["snapshots"])
