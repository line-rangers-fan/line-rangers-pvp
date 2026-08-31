"""Broken JSON and slow bodies must not trap the collection/recovery path."""

from copy import deepcopy
from http.client import HTTPResponse
import io
import json

import pytest

from scripts import scrape_character_usage as scraper
from scripts.check_data_freshness import check_freshness
from scripts.quality_checks import validate_data
from test_collection_resilience import prepare_files
from test_comparison_guards import complete_data


BAD_JSON = [
    b'{"payload":' + b'[' * 10000 + b'0' + b']' * 10000 + b'}',
    b'{"payload":' + b'7' * 5000 + b'}',
]


@pytest.mark.parametrize("raw", BAD_JSON, ids=["nesting", "integer"])
@pytest.mark.parametrize("target", ["previous", "history"])
def test_bad_json_context_is_repaired_by_complete_sample(tmp_path, monkeypatch, raw, target):
    current, paths = prepare_files(tmp_path, monkeypatch)
    paths[0 if target == "previous" else 1].write_bytes(raw)
    monkeypatch.setenv("DEBUG", "0")
    scraper.main()
    data = json.loads(paths[0].read_text())
    assert validate_data(data)
    assert data["updated_at"] == current["updated_at"]
    assert data["comparison"]["periods"]["hour"]["comparable"]


@pytest.mark.parametrize("raw", BAD_JSON, ids=["nesting", "integer"])
def test_bad_json_requests_repair_instead_of_crashing_watchdog(tmp_path, raw):
    path = tmp_path / "data.json"
    path.write_bytes(raw)
    assert check_freshness(path).due


@pytest.mark.parametrize("raw", BAD_JSON, ids=["nesting", "integer"])
@pytest.mark.parametrize("recover", [True, False])
def test_bad_api_json_keeps_existing_retry_limit(monkeypatch, raw, recover):
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(timeout)
            return io.BytesIO(b'{"ok":true}' if recover and len(calls) > 1 else raw)

    monkeypatch.setattr(scraper, "SOURCE_OPENER", Opener())
    monkeypatch.setattr(scraper, "sleep", lambda _: None)
    url = "https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND"
    if recover:
        assert scraper.fetch_json(url, "Ranking") == {"ok": True}
        assert len(calls) == 2
    else:
        with pytest.raises(scraper.MalformedJsonResponse):
            scraper.fetch_json(url, "Ranking")
        assert len(calls) == scraper.REQUEST_ATTEMPTS


@pytest.mark.parametrize("field", ["collection_duration_seconds", "adoption_rate"])
def test_overflowing_history_entry_does_not_remove_valid_baseline(field):
    previous = complete_data("2026-08-31T06:00:00+09:00")
    good = scraper.history_snapshot(previous)
    broken = deepcopy(good)
    broken["updated_at"] = "2026-08-31T05:55:00+09:00"
    if field == "adoption_rate":
        broken["characters"][0][field] = 10 ** 400
    else:
        broken[field] = 10 ** 400
    _, history = scraper.prepare_comparison_context(
        complete_data(), previous, {"snapshots": [broken, good]}
    )
    assert history["snapshots"] == [good]


class FakeSocket:
    def __init__(self, raw):
        self.raw = raw

    def makefile(self, *args):
        return self.raw


def response_for(raw):
    response = HTTPResponse(FakeSocket(raw))
    response.begin()
    return response


@pytest.mark.parametrize("chunked", [False, True])
def test_slow_body_cannot_bypass_time_checks(monkeypatch, chunked):
    now = [0.0]
    monkeypatch.setattr(scraper, "monotonic", lambda: now[0])

    class SlowBody(io.BytesIO):
        def read(self, size=-1):
            # A full buffered read keeps waiting while bytes trickle in.
            now[0] += scraper.REQUEST_TIMEOUT_SECONDS + 1
            return super().read(size)

        def read1(self, size=-1):
            now[0] += scraper.REQUEST_TIMEOUT_SECONDS / 2
            return super().read(min(size, 1))

    body = b'{"ok":true}'
    header = b'Transfer-Encoding: chunked' if chunked else b'Content-Length: 11'
    wire_body = b'b\r\n' + body + b'\r\n0\r\n\r\n' if chunked else body
    response = response_for(SlowBody(b'HTTP/1.1 200 OK\r\n' + header + b'\r\n\r\n' + wire_body))
    with response, pytest.raises(TimeoutError):
        scraper._read_json_response(response, "Ranking")
    assert now[0] <= scraper.REQUEST_TIMEOUT_SECONDS + 1


@pytest.mark.parametrize("chunked", [False, True])
def test_complete_http_body_still_parses(chunked):
    body = b'{"ok":true}'
    header = b'Transfer-Encoding: chunked' if chunked else b'Content-Length: 11'
    wire_body = b'b\r\n' + body + b'\r\n0\r\n\r\n' if chunked else body
    with response_for(io.BytesIO(b'HTTP/1.1 200 OK\r\n' + header + b'\r\n\r\n' + wire_body)) as response:
        assert scraper._read_json_response(response, "Ranking") == {"ok": True}


def test_truncated_content_length_retries_even_when_prefix_is_valid_json():
    with response_for(io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{"ok":true}')) as response:
        with pytest.raises(scraper.MalformedJsonResponse):
            scraper._read_json_response(response, "Ranking")


def test_chunked_framing_does_not_use_overridden_content_length():
    wire = (b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n'
            b'Content-Length: 99999999\r\n\r\nb\r\n{"ok":true}\r\n0\r\n\r\n')
    with response_for(io.BytesIO(wire)) as response:
        assert scraper._read_json_response(response, "Ranking") == {"ok": True}


@pytest.mark.parametrize("recover", [True, False])
def test_body_deadline_retries_and_closes_response(monkeypatch, recover):
    now = [0.0]
    responses = []
    monkeypatch.setattr(scraper, "monotonic", lambda: now[0])
    monkeypatch.setattr(scraper, "sleep", lambda _: None)

    class SlowResponse(io.BytesIO):
        def read1(self, size=-1):
            now[0] += scraper.REQUEST_TIMEOUT_SECONDS
            return super().read1(size)

    class Opener:
        def open(self, request, timeout):
            response = io.BytesIO(b'{"ok":true}') if recover and responses else SlowResponse(b'{"ok":true}')
            responses.append(response)
            return response

    monkeypatch.setattr(scraper, "SOURCE_OPENER", Opener())
    url = "https://rangers.lerico.net/api/v2/pvp/league/rank/LEGEND"
    if recover:
        assert scraper.fetch_json(url, "Ranking") == {"ok": True}
        assert len(responses) == 2
    else:
        with pytest.raises(RuntimeError, match="TimeoutError"):
            scraper.fetch_json(url, "Ranking")
        assert len(responses) == scraper.REQUEST_ATTEMPTS
    assert all(response.closed for response in responses)


def test_slow_but_complete_body_within_existing_timeout_is_accepted(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(scraper, "monotonic", lambda: now[0])

    class GradualResponse(io.BytesIO):
        def read1(self, size=-1):
            now[0] += scraper.REQUEST_TIMEOUT_SECONDS / 13
            return super().read1(min(size, 1))

    with GradualResponse(b'{"ok":true}') as response:
        assert scraper._read_json_response(response, "Ranking") == {"ok": True}
    assert 0 < now[0] < scraper.REQUEST_TIMEOUT_SECONDS


@pytest.mark.parametrize("extra", [0, 1])
def test_existing_body_size_limit_is_preserved(monkeypatch, extra):
    monkeypatch.setattr(scraper, "MAX_JSON_RESPONSE_BYTES", 20)
    body = b'{"ok":true}' + b' ' * (9 + extra)
    if extra:
        with pytest.raises(RuntimeError, match="safety limit"):
            scraper._read_json_response(io.BytesIO(body), "Ranking")
    else:
        assert scraper._read_json_response(io.BytesIO(body), "Ranking") == {"ok": True}
