from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
ENTRY_JS = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")
ENTRY_CSS = (ROOT / "docs" / "assets" / "community-entry.css").read_text(encoding="utf-8")

BOARD_HOST = "line-rangers-pvp-community-production.n-yu1791.workers.dev"
BOARD_PATH = "/boards"
BOARD_URL = f"https://{BOARD_HOST}{BOARD_PATH}"
ACTIVITY_URL = f"https://{BOARD_HOST}/api/activity?public=1"
BANNED_RANKING_LINK_LABELS = (
    "PvP集計表を開く",
    "集計表へ",
    "ランキング表を開く",
)


def test_original_ranking_shell_is_published_without_maintenance_mode():
    assert '<body class="maintenance-mode">' not in INDEX
    assert 'class="maintenance-screen"' not in INDEX
    assert '<meta name="robots" content="index, follow">' in INDEX
    assert '<title>LINEレンジャー レジェンド帯キャラ集計</title>' in INDEX
    assert 'id="ranking-section"' in INDEX


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


def test_feature_flag_is_explicitly_enabled_and_fail_closed():
    assert "defaultState: true" in ENTRY_JS
    assert "state: true" in ENTRY_JS
    assert "return value === true" in ENTRY_JS
    assert "if (!enabled) return" in ENTRY_JS
    assert "slot.hidden = true" in ENTRY_JS


def test_urls_are_https_allowlisted_and_activity_feed_is_read_only_public_data():
    assert BOARD_URL in ENTRY_JS
    assert ACTIVITY_URL in ENTRY_JS
    assert BOARD_HOST in ENTRY_JS
    assert f'allowedPath: "{BOARD_PATH}"' in ENTRY_JS
    assert 'url.protocol !== "https:"' in ENTRY_JS
    assert 'url.username !== ""' in ENTRY_JS
    assert 'url.password !== ""' in ENTRY_JS
    assert 'allowedHosts.includes(url.hostname)' in ENTRY_JS
    assert 'url.pathname !== "/api/activity"' in ENTRY_JS
    assert 'url.search !== "?public=1"' in ENTRY_JS
    assert 'credentials:"omit"' in ENTRY_JS
    assert 'mode:"cors"' in ENTRY_JS
    assert "rangers-community-review.n-yu1791.chatgpt.site" not in ENTRY_JS


def test_csp_allows_only_the_production_worker_for_live_teaser_fetch():
    assert f"connect-src 'self' https://{BOARD_HOST}" in INDEX
    assert 'community-entry.js?v=20260918-featured-2' in INDEX
    assert 'community-entry.css?v=20260918-featured-2' in INDEX


def test_featured_comment_is_live_clickable_and_shows_reaction_counts():
    assert 'featuredBoardUrl' in ENTRY_JS
    assert 'clipText(featured.body)' in ENTRY_JS
    assert '`♥ ${featured.likes}`' in ENTRY_JS
    assert 'featured.helpful' in ENTRY_JS
    # Data attributes are created through the DOM dataset API. Selectors that
    # read those attributes later are safe; raw HTML injection remains banned.
    assert 'helpful.dataset.communityHelpful = "true"' in ENTRY_JS
    assert 'helpful.dataset.helpfulCount = String(featured.helpful)' in ENTRY_JS
    assert 'wrapper.href = href' in ENTRY_JS
    assert 'url.searchParams.set("board", topic.id)' in ENTRY_JS
    assert 'url.searchParams.set("month", topic.month)' in ENTRY_JS
    assert 'innerHTML' not in ENTRY_JS


def test_featured_comment_shows_unread_count_from_activity_feed():
    assert "function normalizeUnread(value)" in ENTRY_JS
    assert "unread:normalizeUnread(payload.unread)" in ENTRY_JS
    assert "buildFeatured(state.featured, baseUrl, state.unread)" in ENTRY_JS
    assert "if (unread > 0)" in ENTRY_JS
    assert '`NEW ${unread}`' in ENTRY_JS
    assert ".community-board-entry-unread" in ENTRY_CSS


def test_board_button_navigates_same_tab_without_intermediate_page():
    assert 'button.textContent = entryText("openBoard")' in ENTRY_JS
    assert 'button.target = "_blank"' not in ENTRY_JS
    assert "noopener noreferrer" not in ENTRY_JS
    assert "注目コメント" in ENTRY_JS
    assert "新キャラ情報掲示板" in ENTRY_JS


def test_entry_assets_remain_small_mobile_first_and_dedicated():
    assert len(ENTRY_JS.encode("utf-8")) < 20_000
    assert len(ENTRY_CSS.encode("utf-8")) < 8_000
    assert ".community-board-entry-card" in ENTRY_CSS
    assert ".community-board-entry-featured-reactions" in ENTRY_CSS
    assert ".community-board-entry-button" in ENTRY_CSS
    assert "@media (min-width: 680px)" in ENTRY_CSS
