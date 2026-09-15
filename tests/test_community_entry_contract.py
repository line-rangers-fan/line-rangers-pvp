from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
ENTRY_JS = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")
ENTRY_CSS = (ROOT / "docs" / "assets" / "community-entry.css").read_text(encoding="utf-8")

BOARD_HOST = "line-rangers-community-dev.n-yu1791.chatgpt.site"
BOARD_PATH = "/boards"
BOARD_URL = f"https://{BOARD_HOST}{BOARD_PATH}"
BANNED_RANKING_LINK_LABELS = (
    "PvP集計表を開く",
    "集計表へ",
    "ランキング表を開く",
)


def test_existing_maintenance_and_search_controls_are_preserved():
    assert '<body class="maintenance-mode">' in INDEX
    assert '<meta name="robots" content="noindex, nofollow">' in INDEX
    assert 'class="maintenance-screen"' in INDEX


def test_entry_is_single_isolated_slot_and_url_is_not_static_html():
    assert INDEX.count('id="community-board-entry-slot"') == 1
    assert BOARD_URL not in INDEX
    assert "COMMUNITY_BOARD_URL" not in INDEX
    assert "iframe" not in INDEX.lower()


def test_community_entry_is_above_update_summary_and_ranking():
    entry_position = INDEX.index('id="community-board-entry-slot"')
    status_position = INDEX.index('id="status-message"')
    summary_position = INDEX.index('id="summary"')
    ranking_position = INDEX.index('id="ranking-section"')
    assert entry_position < status_position < summary_position < ranking_position


def test_ranking_navigation_buttons_are_removed():
    combined = INDEX + ENTRY_JS
    for label in BANNED_RANKING_LINK_LABELS:
        assert label not in combined


def test_feature_flag_is_fail_closed_but_currently_approved():
    assert "defaultState: false" in ENTRY_JS
    assert "state: true" in ENTRY_JS
    assert "return value === true" in ENTRY_JS
    assert "slot.hidden = true" in ENTRY_JS


def test_url_is_https_allowlisted_and_direct_to_latest_board():
    assert BOARD_URL in ENTRY_JS
    assert BOARD_HOST in ENTRY_JS
    assert f'allowedPath: "{BOARD_PATH}"' in ENTRY_JS
    assert 'url.protocol !== "https:"' in ENTRY_JS
    assert 'url.username !== ""' in ENTRY_JS
    assert 'url.password !== ""' in ENTRY_JS
    assert 'url.search !== ""' in ENTRY_JS
    assert 'url.hash !== ""' in ENTRY_JS
    assert 'url.pathname !== allowedPath' in ENTRY_JS
    assert 'allowedHosts.includes(url.hostname)' in ENTRY_JS
    assert "rangers-community-review.n-yu1791.chatgpt.site" not in ENTRY_JS


def test_board_button_navigates_same_tab_without_intermediate_page():
    assert 'button.textContent = "掲示板を開く →"' in ENTRY_JS
    assert 'button.target = "_blank"' not in ENTRY_JS
    assert "noopener noreferrer" not in ENTRY_JS
    assert "注目コメント" in ENTRY_JS
    assert "新キャラ情報掲示板" in ENTRY_JS


def test_entry_does_not_call_the_board_or_pvp_apis():
    forbidden = ("fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon")
    for token in forbidden:
        assert token not in ENTRY_JS


def test_entry_assets_are_small_mobile_first_and_dedicated():
    assert len(ENTRY_JS.encode("utf-8")) < 8_000
    assert len(ENTRY_CSS.encode("utf-8")) < 6_000
    assert ".community-board-entry-card" in ENTRY_CSS
    assert ".community-board-entry-button" in ENTRY_CSS
    assert "@media (min-width: 680px)" in ENTRY_CSS
