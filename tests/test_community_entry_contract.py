from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
ENTRY_JS = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")
ENTRY_CSS = (ROOT / "docs" / "assets" / "community-entry.css").read_text(encoding="utf-8")

BOARD_HOST = "rangers-community-review.n-yu1791.chatgpt.site"
BOARD_URL = f"https://{BOARD_HOST}/"


def test_existing_maintenance_and_search_controls_are_preserved():
    assert '<body class="maintenance-mode">' in INDEX
    assert '<meta name="robots" content="noindex, nofollow">' in INDEX
    assert 'class="maintenance-screen"' in INDEX


def test_entry_is_single_isolated_slot_and_url_is_not_static_html():
    assert INDEX.count('id="community-board-entry-slot"') == 1
    assert BOARD_URL not in INDEX
    assert "COMMUNITY_BOARD_URL" not in INDEX
    assert "iframe" not in INDEX.lower()


def test_feature_flag_is_fail_closed_but_currently_approved():
    # The permanent fallback remains false. The current state is true only
    # because the owner explicitly approved adding the entry.
    assert "defaultState: false" in ENTRY_JS
    assert "state: true" in ENTRY_JS
    assert 'value === "preview"' in ENTRY_JS
    assert "return false;" in ENTRY_JS
    assert "slot.hidden = true" in ENTRY_JS


def test_url_is_https_allowlisted_and_carries_no_url_secrets():
    assert BOARD_URL in ENTRY_JS
    assert BOARD_HOST in ENTRY_JS
    assert 'url.protocol !== "https:"' in ENTRY_JS
    assert 'url.username !== ""' in ENTRY_JS
    assert 'url.password !== ""' in ENTRY_JS
    assert 'url.search !== ""' in ENTRY_JS
    assert 'url.hash !== ""' in ENTRY_JS
    assert 'allowedHosts.includes(url.hostname)' in ENTRY_JS


def test_external_link_security_attributes_are_mandatory():
    assert 'link.target = "_blank"' in ENTRY_JS
    assert 'link.rel = "noopener noreferrer"' in ENTRY_JS


def test_entry_does_not_call_the_board_or_pvp_apis():
    forbidden = (
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "sendBeacon",
    )
    for token in forbidden:
        assert token not in ENTRY_JS


def test_entry_assets_are_small_and_dedicated():
    assert len(ENTRY_JS.encode("utf-8")) < 8_000
    assert len(ENTRY_CSS.encode("utf-8")) < 4_000
    assert ".community-board-entry-link" in ENTRY_CSS
