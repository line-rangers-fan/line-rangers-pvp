import json
from datetime import datetime, timedelta, timezone

import pytest

from scripts.check_copy_discovery import (
    API_REF, RAW_BASE, STATE_PATH, SNAPSHOT_PATH, REGISTRY_PATH,
    DiscoveryHealthError, assess, check_remote,
)


NOW = datetime(2026, 10, 1, 6, 0, tzinfo=timezone.utc)
STAMP = "2026-10-01T05:00:00Z"
SHA = "a" * 40


def fixtures():
    state = {
        "schemaVersion": 1, "initialized": True, "catalogInitialized": True,
        "knownCatalogIds": ["u1e-old"], "catalogStatus": "verified",
        "releaseNoticeStatus": "verified", "lastSnapshotAt": STAMP, "candidates": {},
    }
    snapshot = {"complete_target": True, "target_players": 200, "sampled_players": 200,
                "updated_at": STAMP, "characters": []}
    registry = {"schemaVersion": 1, "characters": [
        {"id": "u2e-new", "releaseMonth": "2026-10", "confirmed": True}
    ]}
    return state, snapshot, registry


def test_complete_matching_discovery_is_healthy():
    result = assess(*fixtures(), now=NOW)
    assert result["age_minutes"] == 60
    assert result["confirmed_topics"] == 1


@pytest.mark.parametrize("change,message", [
    (lambda s,p,r: s.update(catalogStatus="unavailable"), "verification failed"),
    (lambda s,p,r: s.update(lastSnapshotAt="2026-09-30T22:00:00Z"), "out of sync"),
    (lambda s,p,r: p.update(sampled_players=199), "200/200"),
    (lambda s,p,r: s.update(knownCatalogIds=[]), "baseline is missing"),
    (lambda s,p,r: r["characters"].append(dict(r["characters"][0])), "duplicate"),
])
def test_unsafe_discovery_is_reported(change, message):
    state, snapshot, registry = fixtures()
    change(state, snapshot, registry)
    with pytest.raises(DiscoveryHealthError, match=message):
        assess(state, snapshot, registry, now=NOW)


def test_expired_but_matching_discovery_is_not_reported_healthy():
    state, snapshot, registry = fixtures()
    with pytest.raises(DiscoveryHealthError, match="has not advanced"):
        assess(state, snapshot, registry, now=NOW + timedelta(hours=6, minutes=1))


def test_remote_check_pins_all_read_only_requests_to_one_sha():
    state, snapshot, registry = fixtures()
    payloads = {
        API_REF: {"object": {"sha": SHA}},
        f"{RAW_BASE}/{SHA}/{STATE_PATH}": state,
        f"{RAW_BASE}/{SHA}/{SNAPSHOT_PATH}": snapshot,
        f"{RAW_BASE}/{SHA}/{REGISTRY_PATH}": registry,
    }
    requests = []

    class Response:
        def __init__(self, value):
            self.value = value
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            return False
        def read(self, _limit):
            return json.dumps(self.value).encode()

    def opener(request, timeout):
        requests.append((request.get_method(), request.full_url, timeout))
        return Response(payloads[request.full_url])

    sha, result = check_remote(now=NOW, opener=opener)
    assert sha == SHA and result["confirmed_topics"] == 1
    assert all(method == "GET" and timeout > 0 for method, _url, timeout in requests)
    assert [url for _method, url, _timeout in requests] == list(payloads)
