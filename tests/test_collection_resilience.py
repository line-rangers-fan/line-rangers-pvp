"""Transient transport and optional debug failures must not reject good data."""

from copy import deepcopy
from http.client import IncompleteRead
import io
import json

import pytest

from scripts import scrape_character_usage as scraper
from scripts.quality_checks import validate_data
from test_comparison_guards import complete_data


class TruncatedResponse(io.BytesIO):
    def read(self, *args):
        raise IncompleteRead(b"untrusted partial response", 100)

    read1 = read


@pytest.mark.parametrize("recover", [True, False])
def test_incomplete_http_read_retries_with_existing_limits(monkeypatch, recover):
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(timeout)
            return io.BytesIO(b'{"ok":true}') if recover and len(calls) > 1 else TruncatedResponse()

    monkeypatch.setattr(scraper, "SOURCE_OPENER", Opener())
    monkeypatch.setattr(scraper, "sleep", lambda _: None)
    url = "https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND"
    if recover:
        assert scraper.fetch_json(url, "Ranking") == {"ok": True}
        assert len(calls) == 2
    else:
        with pytest.raises(RuntimeError, match="IncompleteRead") as error:
            scraper.fetch_json(url, "Ranking")
        assert "untrusted partial response" not in str(error.value)
        assert len(calls) == scraper.REQUEST_ATTEMPTS


def prepare_files(tmp_path, monkeypatch):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    current = complete_data()
    current["diagnostics"]["equipment_items_collected"] = 0
    current["termination_reason"] = "api_target_reached"
    output = tmp_path / "data.json"
    history = tmp_path / "history.json"
    health = tmp_path / "health.json"
    scraper.save_json(output, previous)
    scraper.save_json(history, {"snapshots": [scraper.history_snapshot(previous)]})
    scraper.save_json(health, scraper.health_summary(previous))
    for key, path in [("OUTPUT_PATH", output), ("HISTORY_PATH", history), ("HEALTH_PATH", health)]:
        monkeypatch.setattr(scraper, key, path)
    monkeypatch.setattr(scraper, "scrape", lambda: deepcopy(current))
    return current, [output, history, health]


def test_optional_diagnostic_file_failure_does_not_reject_valid_collection(tmp_path, monkeypatch, capsys):
    current, paths = prepare_files(tmp_path, monkeypatch)
    blocked = tmp_path / "debug"
    blocked.write_text("not a directory", encoding="utf-8")
    monkeypatch.setattr(scraper, "DEBUG_DIR", blocked)
    monkeypatch.setenv("DEBUG", "1")
    scraper.main()
    data = json.loads(paths[0].read_text())
    assert validate_data(data)
    assert data["updated_at"] == current["updated_at"]
    assert json.loads(paths[2].read_text()) == scraper.health_summary(data)
    assert "diagnostic" in capsys.readouterr().err.lower()


@pytest.mark.parametrize("failure", ["invalid_sample", "output_write"])
def test_required_validation_and_publication_errors_still_fail_closed(tmp_path, monkeypatch, failure):
    current, paths = prepare_files(tmp_path, monkeypatch)
    before = [path.read_bytes() for path in paths]
    monkeypatch.setenv("DEBUG", "0")
    if failure == "invalid_sample":
        current["sampled_players"] = 199
        expected = ValueError
    else:
        def fail_write(*args):
            raise OSError("publication fixture failure")
        monkeypatch.setattr(scraper, "save_json", fail_write)
        expected = OSError
    with pytest.raises(expected):
        scraper.main()
    assert [path.read_bytes() for path in paths] == before


def test_optional_character_names_preserve_last_known_values(tmp_path, monkeypatch, capsys):
    output = tmp_path / "data.json"
    scraper.save_json(
        output,
        {
            "characters": [
                {"unit_code": "u-known", "name": "Known Name"},
                {"unit_code": "u-new", "name": "u-new"},
            ]
        },
    )
    monkeypatch.setattr(scraper, "OUTPUT_PATH", output)
    monkeypatch.setattr(
        scraper,
        "fetch_character_names",
        lambda _codes: (_ for _ in ()).throw(RuntimeError("metadata outage")),
    )

    names, metadata = scraper.resolve_character_names({"u-known", "u-new"})

    assert names == {"u-known": "Known Name", "u-new": "u-new"}
    assert metadata == {
        "source_names": 0,
        "preserved_names": 1,
        "pending_names": 1,
        "translation_fetch_failed": True,
    }
    assert "metadata was unavailable" in capsys.readouterr().err


def test_source_character_names_replace_preserved_values(tmp_path, monkeypatch):
    output = tmp_path / "data.json"
    scraper.save_json(
        output,
        {"characters": [{"unit_code": "u-known", "name": "Old Name"}]},
    )
    monkeypatch.setattr(scraper, "OUTPUT_PATH", output)
    monkeypatch.setattr(
        scraper,
        "fetch_character_names",
        lambda _codes: {"u-known": "Current Name", "u-new": "u-new"},
    )

    names, metadata = scraper.resolve_character_names({"u-known", "u-new"})

    assert names == {"u-known": "Current Name", "u-new": "u-new"}
    assert metadata["source_names"] == 1
    assert metadata["preserved_names"] == 0
    assert metadata["pending_names"] == 1
    assert metadata["translation_fetch_failed"] is False


def test_optional_character_name_request_uses_short_retry_budget(monkeypatch):
    calls = []

    def fetch(url, label, **kwargs):
        calls.append((url, label, kwargs))
        return {"ja:UNIT": {"u-known_snm": "Known Name"}}

    monkeypatch.setattr(scraper, "fetch_json", fetch)

    assert scraper.fetch_character_names({"u-known"}) == {"u-known": "Known Name"}
    assert calls[0][2] == {
        "attempts": min(2, scraper.REQUEST_ATTEMPTS),
        "timeout_seconds": min(8, scraper.REQUEST_TIMEOUT_SECONDS),
    }


def test_failure_artifact_records_stage_without_error_or_player_details(
    tmp_path, monkeypatch
):
    output = tmp_path / "data.json"
    previous = {"updated_at": "2026-09-03T03:00:00+00:00", "sampled_players": 200}
    scraper.save_json(output, previous)
    monkeypatch.setattr(scraper, "OUTPUT_PATH", output)
    monkeypatch.setattr(scraper, "HISTORY_PATH", tmp_path / "history.json")
    monkeypatch.setattr(scraper, "DEBUG_DIR", tmp_path / "debug")
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.setattr(
        scraper,
        "scrape",
        lambda: (_ for _ in ()).throw(
            RuntimeError("sensitive-player-id and upstream payload")
        ),
    )

    with pytest.raises(RuntimeError):
        scraper.main()

    report = json.loads(
        (tmp_path / "debug" / "collection_failure.json").read_text(encoding="utf-8")
    )
    assert report == {
        "stage": "scrape",
        "error_type": "RuntimeError",
        "last_known_good_updated_at": "2026-09-03T03:00:00+00:00",
        "previous_data_retained": True,
    }
    assert "sensitive-player-id" not in json.dumps(report)
