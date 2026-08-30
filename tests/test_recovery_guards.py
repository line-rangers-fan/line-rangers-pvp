"""A damaged comparison context must not permanently block a new full sample."""

from copy import deepcopy
from datetime import datetime, timedelta
import json
import io

import pytest

from scripts import scrape_character_usage as scraper
from scripts.quality_checks import validate_data
from test_comparison_guards import complete_data


def run_collection(tmp_path, monkeypatch, previous, history):
    output = tmp_path / "data.json"
    history_path = tmp_path / "history.json"
    health_path = tmp_path / "health.json"
    output.write_text(json.dumps(previous))
    history_path.write_text(json.dumps(history))
    current = complete_data()
    current["diagnostics"]["equipment_items_collected"] = 0
    current["termination_reason"] = "api_target_reached"
    monkeypatch.setattr(scraper, "OUTPUT_PATH", output)
    monkeypatch.setattr(scraper, "HISTORY_PATH", history_path)
    monkeypatch.setattr(scraper, "HEALTH_PATH", health_path)
    monkeypatch.setattr(scraper, "scrape", lambda: deepcopy(current))
    monkeypatch.setenv("DEBUG", "0")
    scraper.main()
    result = json.loads(output.read_text())
    retained = json.loads(history_path.read_text())
    assert result["updated_at"] == current["updated_at"]
    assert result["sampled_players"] == result["target_players"] == 200
    assert validate_data(result)
    return result, retained


@pytest.mark.parametrize("case", ["null_count", "invalid_sample", "wrong_target", "future_time", "invalid_rank"])
def test_corrupt_previous_data_cannot_block_recovery(case, tmp_path, monkeypatch):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    good_history = {"snapshots": [scraper.history_snapshot(previous)]}
    if case == "null_count":
        previous["characters"][0]["occurrence_count"] = None
    elif case == "invalid_sample":
        previous["sampled_players"] = "broken"
    elif case == "wrong_target":
        previous["target_players"] = 199
    elif case == "future_time":
        previous = complete_data("2099-08-31T06:00:00+09:00")
    elif case == "invalid_rank":
        previous["characters"][0]["rank"] = "broken"
    result, _ = run_collection(tmp_path, monkeypatch, previous, good_history)
    assert result["comparison"]["previous_updated_at"] is None
    assert result["comparison"]["periods"]["hour"]["comparable"] is True
    assert result["characters"][0]["change"]["periods"]["hour"]["occurrence_count"] == 0


@pytest.mark.parametrize("snapshots", [None, 7, "broken", {"unexpected": "shape"}])
def test_bad_history_root_cannot_block_recovery(snapshots, tmp_path, monkeypatch):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    result, retained = run_collection(tmp_path, monkeypatch, previous, {"snapshots":snapshots})
    # The valid previous publication is real history; preserve it, don't invent
    # a count or lose the hourly baseline merely because its sidecar was bad.
    assert result["comparison"]["periods"]["hour"]["comparable"] is True
    assert len(retained["snapshots"]) == 2


@pytest.mark.parametrize("case", ["future", "null_count", "bad_characters", "duplicate_time", "naive_time"])
def test_bad_history_entries_do_not_poison_valid_history(case, tmp_path, monkeypatch):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    good = scraper.history_snapshot(previous)
    broken = deepcopy(good)
    broken["updated_at"] = "2026-08-31T05:59:00+09:00"
    if case == "future":
        broken["updated_at"] = "2099-08-31T06:00:00+09:00"
    elif case == "null_count":
        broken["characters"][0]["occurrence_count"] = None
    elif case == "bad_characters":
        broken["characters"] = "broken"
    elif case == "duplicate_time":
        broken["updated_at"] = "2026-08-30T21:00:00Z"
    elif case == "naive_time":
        broken["updated_at"] = "2026-08-30T20:59:00"
    result, retained = run_collection(tmp_path, monkeypatch, previous, {"snapshots":[good,broken]})
    times = [datetime.fromisoformat(s["updated_at"].replace("Z", "+00:00")) for s in retained["snapshots"]]
    assert all(t.tzinfo is not None for t in times)
    assert times == sorted(set(times))
    assert max(times) <= datetime.fromisoformat(result["updated_at"])
    assert all(isinstance(s["characters"],list) and all(isinstance(c["occurrence_count"],int) for c in s["characters"]) for s in retained["snapshots"])
    assert result["characters"][0]["change"]["periods"]["hour"]["occurrence_count"] == 0


def test_normal_context_does_not_change(tmp_path, monkeypatch):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    history = {"snapshots":[scraper.history_snapshot(previous)]}
    expected = complete_data()
    expected["diagnostics"]["equipment_items_collected"] = 0
    expected["termination_reason"] = "api_target_reached"
    scraper.add_previous_comparison(expected, previous, history)
    expected_history = scraper.update_history(expected, history)
    result, retained = run_collection(tmp_path, monkeypatch, previous, history)
    assert result == expected
    assert retained == expected_history


def test_transient_invalid_json_uses_existing_bounded_retries(monkeypatch):
    responses = iter([b"temporarily incomplete JSON", b'{"ok":true}'])
    calls = []
    class Opener:
        def open(self, _request, timeout):
            calls.append(timeout)
            return io.BytesIO(next(responses))
    monkeypatch.setattr(scraper, "SOURCE_OPENER", Opener())
    monkeypatch.setattr(scraper, "sleep", lambda _: None)
    result = scraper.fetch_json("https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND", "PvP ranking API")
    assert result == {"ok":True}
    assert len(calls) == 2


def test_invalid_json_never_retries_without_a_bound(monkeypatch):
    calls = []
    class Opener:
        def open(self, _request, timeout):
            calls.append(timeout)
            return io.BytesIO(b"invalid")
    monkeypatch.setattr(scraper, "SOURCE_OPENER", Opener())
    monkeypatch.setattr(scraper, "sleep", lambda _: None)
    with pytest.raises(RuntimeError):
        scraper.fetch_json("https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND", "PvP ranking API")
    assert len(calls) == scraper.REQUEST_ATTEMPTS
