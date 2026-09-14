from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
ENTRY_JS = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")
ENTRY_CSS = (ROOT / "docs" / "assets" / "community-entry.css").read_text(encoding="utf-8")

BOARD_HOST = "rangers-community-review.n-yu1791.chatgpt.site"
BOARD_URL = f"https://{BOARD_HOST}/"
BANNED_RANKING_LINK_LABELS = (
    "PvP集計表を開く",
    "集計表へ",
    "ランキング表を開く",
)


def test_existing_maintenance_and_search_controls_are_preserved():
    # GitHub Pages remains fail-closed even though the separate repo-backed
    # preview Worker strips maintenance for the no-login development preview.
    assert '<body class="maintenance-mode">' in INDEX
    assert '<meta name="robots" content="noindex, nofollow">' in INDEX
    assert 'class="maintenance-screen"' in INDEX


def test_entry_is_single_isolated_slot_and_url_is_not_static_html():
    assert INDEX.count('id="community-board-entry-slot"') == 1
    assert BOARD_URL not in INDEX
    assert "COMMUNITY_BOARD_URL" not in INDEX
    assert "iframe" not in INDEX.lower()


def test_community_entry_is_immediately_before_real_ranking_section():
    entry_position = INDEX.index('id="community-board-entry-slot"')
    ranking_position = INDEX.index('id="ranking-section"')
    assert entry_position < ranking_position
    between = INDEX[entry_position:ranking_position]
    assert 'id="status-message"' not in between
    assert 'id="summary"' not in between


def test_ranking_navigation_buttons_are_removed():
    combined = INDEX + ENTRY_JS
    for label in BANNED_RANKING_LINK_LABELS:
        assert label not in combined


def test_feature_flag_is_fail_closed_but_currently_approved():
    assert "defaultState: false" in ENTRY_JS
    assert "state: true" in ENTRY_JS
    assert "return value === true" in ENTRY_JS
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


def test_only_board_button_navigates_and_uses_safe_external_attributes():
    assert 'button.textContent = "掲示板を開く ↗"' in ENTRY_JS
    assert 'button.target = "_blank"' in ENTRY_JS
    assert 'button.rel = "noopener noreferrer"' in ENTRY_JS
    assert "注目コメント" in ENTRY_JS
    assert "新キャラ情報掲示板" in ENTRY_JS


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


def test_entry_assets_are_small_mobile_first_and_dedicated():
    assert len(ENTRY_JS.encode("utf-8")) < 8_000
    assert len(ENTRY_CSS.encode("utf-8")) < 6_000
    assert ".community-board-entry-card" in ENTRY_CSS
    assert ".community-board-entry-button" in ENTRY_CSS
    assert "@media (min-width: 680px)" in ENTRY_CSS
