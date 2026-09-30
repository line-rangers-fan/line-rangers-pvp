from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "docs" / "assets" / "app.js").read_text(encoding="utf-8")
COMMUNITY = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")


def test_static_shell_reduces_browser_exfiltration_surface():
    assert '<meta name="referrer" content="no-referrer">' in INDEX
    assert "form-action 'none';" in INDEX
    assert "frame-src 'none';" in INDEX
    assert "'unsafe-inline'" not in INDEX
    assert "'unsafe-eval'" not in INDEX


def test_ranking_fast_path_remains_owned_by_app_js():
    assert 'const DATA_PATH = "./data/character_usage.json";' in APP
    assert "fetchJsonWithLimits" in APP
    assert "REQUEST_TIMEOUT_MS" in APP
    assert "performance-boost.js" not in INDEX
    assert "MutationObserver" not in COMMUNITY


def test_community_activity_is_bounded_and_fail_closed():
    assert "COMMUNITY_ACTIVITY_TIMEOUT_MS = 5000" in COMMUNITY
    assert "COMMUNITY_ACTIVITY_MAX_BYTES = 256 * 1024" in COMMUNITY
    assert "new AbortController()" in COMMUNITY
    assert "controller.abort()" in COMMUNITY
    assert "response.body.getReader()" in COMMUNITY
    assert "total > COMMUNITY_ACTIVITY_MAX_BYTES" in COMMUNITY
    assert 'contentType.includes("application/json")' in COMMUNITY
    assert "communityActivityInFlight" in COMMUNITY


def test_public_viewer_token_is_validated_before_storage_or_forwarding():
    assert "COMMUNITY_VIEWER_TOKEN_PATTERN" in COMMUNITY
    assert "isValidCommunityViewerToken" in COMMUNITY
    assert 'headers["X-LR-Viewer"] = communityViewerToken' in COMMUNITY
    assert "saveCommunityViewerToken(payload.viewerToken)" in COMMUNITY


def test_community_rendering_keeps_dom_injection_and_remote_images_bounded():
    assert "innerHTML" not in COMMUNITY
    assert "insertAdjacentHTML" not in COMMUNITY
    assert "eval(" not in COMMUNITY
    assert 'image.protocol !== "https:"' in COMMUNITY
    assert 'image.hostname !== "rangers.lerico.net"' in COMMUNITY
    assert "COMMUNITY_ACTIVITY_MAX_TOPICS = 12" in COMMUNITY
    assert "topic.id.length > 128" in COMMUNITY
    assert "topic.image.length > 2048" in COMMUNITY
