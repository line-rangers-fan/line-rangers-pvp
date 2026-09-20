import hashlib
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.inline_scripts = 0
        self.inline_styles = 0

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and not values.get("src"):
            self.inline_scripts += 1
        if tag == "style":
            self.inline_styles += 1


def test_frontend_assets_keep_strict_csp_and_required_controls():
    index = (ROOT / "docs/index.html").read_text(encoding="utf-8")
    parser = AssetParser()
    parser.feed(index)

    assert "script-src 'self';" in index
    # frame-ancestors is ignored when CSP is delivered through a meta element
    # and causes a browser console error. Framing policy belongs in HTTP headers.
    assert "frame-ancestors" not in index
    assert parser.inline_scripts == 0
    assert parser.inline_styles == 0
    for element_id in (
        "summary-freshness",
        "summary-health",
        "ranking-section",
        "ranking-body",
        "rank-period-selector",
        "rank-period-trigger",
        "rank-period-options",
        "equipment-dialog",
        "source-status-notice",
    ):
        assert f'id="{element_id}"' in index
    assert 'id="source-status-notice"' in index
    notice = index.split('id="source-status-notice"', 1)[1].split(">", 1)[0]
    assert "hidden" in notice


def test_history_and_equipment_change_contract_is_present():
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")
    style = (ROOT / "docs/assets/style.css").read_text(encoding="utf-8")

    assert 'const HISTORY_PATH = "./data/character_usage_history.json"' in app
    assert "function validateHistory(" in app
    assert "HISTORY_MAX_SNAPSHOTS" in app
    assert "History snapshots are not in chronological order." in app
    assert "const RANK_CHANGE_PERIODS" in app
    assert "function renderRankPeriodChanges(" in app
    assert "alwaysShow: true" in app
    assert "selectedRankPeriod" in app
    assert 'selectedRankPeriod: "day"' in app
    assert "setupRankPeriodSelector" in app
    assert "rankHour" in app
    assert "rankComparison" in app
    assert 'rankDay: "前日締め"' in app
    assert 'rankWeek: "先週締め"' in app
    assert 'rankMonth: "先月締め"' in app
    assert "CALENDAR_CLOSE_REFERENCE_MODE" in app
    assert "method8:" in app
    assert 'id="method-8"' in (ROOT / "docs/index.html").read_text(encoding="utf-8")
    assert 'data-rank-period="hour"' in (ROOT / "docs/index.html").read_text(encoding="utf-8")
    assert 'metric: "occurrence"' in app
    assert 'rankHistoryPending' in app
    assert 'rankSourcePending' in app
    assert 'sourceStale:' in app
    assert 'const movement = !hasDelta' in app
    assert '? "±0"' in app
    assert 'rank-period-source-pending' not in app
    assert "fetchJsonWithLimits" in app
    assert "REQUEST_TIMEOUT_MS" in app
    # The browser must use the same bounded collection window as the
    # collector, freshness gate, and watchdog.
    assert "const MAX_COLLECTION_DURATION_SECONDS = 15 * 60;" in app
    assert "const PUBLIC_TARGET_PLAYER_COUNT = 200;" in app
    assert "target !== PUBLIC_TARGET_PLAYER_COUNT" in app
    assert "equipmentFillRate <= 0" in app
    assert "Object.values(equipmentTypeTotals).some((count) => count === 0)" in app
    assert "isTrustedCharacterImage" in app
    assert "isTrustedCachedCharacterImage" in app
    assert "validateEquipmentRankings" in app
    assert "includePeriodLabel: false" in app
    assert "renderRankPeriodChanges(rank, item.change" in app
    assert ".rank-period-changes" in style
    assert ".rank-period-selector" in style
    assert ".rank-period-trigger" in style
    assert ".rank-period-options" in style
    assert ".ranking-section {\n  overflow: visible;" in style
    assert ".equipment-rank-cell .rank-period-changes" in style
    assert ".rank-period-pending" in style


def test_summary_cards_keep_only_updated_card_and_key_metrics():
    index = (ROOT / "docs/index.html").read_text(encoding="utf-8")
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")

    assert index.count('class="summary-card') == 1
    assert 'class="summary-card summary-updated-card"' in index
    assert 'class="summary-key-metrics"' in index
    assert 'id="summary-league"' in index
    assert 'id="summary-slots"' in index
    assert 'id="summary-players"' not in index
    assert 'id="summary-characters"' not in index
    assert 'id="summary-players"' not in app
    assert 'id="summary-characters"' not in app


def test_character_thumbnail_frames_do_not_use_intrinsic_grid_row_height():
    style = (ROOT / "docs/assets/style.css").read_text(encoding="utf-8")
    frame = style.split(".character-image-frame {", 1)[1].split("}", 1)[0]
    image = style.split(".character-image-frame > img {", 1)[1].split("}", 1)[0]
    # Auto grid rows enlarged portrait images beyond their fixed thumbnail.
    # A fixed-height flex frame resolves the child's percentage height to the
    # frame, in both the character table and the equipment dialog.
    assert "display: inline-flex;" in frame
    assert "align-items: center;" in frame
    assert "justify-content: center;" in frame
    for declaration in (
        "min-width: 0;", "min-height: 0;", "width: 100%;", "height: 100%;",
        "object-fit: contain;",
    ):
        assert declaration in image


def test_reviewed_new_character_fallback_is_bounded_and_present():
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")
    style = (ROOT / "docs/assets/style.css").read_text(encoding="utf-8")
    image_paths = (
        ROOT / "docs/assets/characters/crab-sally-hyper-fallback.jpg",
        ROOT / "docs/assets/characters/crab-sally-ultimate-fallback.jpg",
    )

    assert '"u1630h-sally"' in app
    assert '"u1631e-sally"' in app
    assert "かに座 サリー（超進化）" in app
    assert "かに座 サリー（究極進化）" in app
    assert "crab-sally-hyper-fallback.jpg" in app
    assert "crab-sally-ultimate-fallback.jpg" in app
    assert "The canonical image" in app
    assert 'img[data-fallback="true"]' in style
    assert "clip-path: circle(44%);" in style
    assert not (ROOT / "docs/assets/characters/crab-sally-promo-fallback.png").exists()
    for image_path in image_paths:
        assert image_path.is_file()
        assert image_path.stat().st_size < 2 * 1024 * 1024
        assert image_path.read_bytes()[:3] == b"\xff\xd8\xff"


def test_workflows_pin_external_actions_and_fail_shell_scripts_safely():
    workflows = (ROOT / ".github/workflows")
    update = (workflows / "update-character-usage.yml").read_text(encoding="utf-8")
    watcher = (workflows / "watch-character-usage.yml").read_text(encoding="utf-8")
    tests = (workflows / "test-comparison-guards.yml").read_text(encoding="utf-8")
    cloudflare = (workflows / "deploy-cloudflare-watchdog.yml").read_text(
        encoding="utf-8"
    )

    for content in (update, watcher, tests, cloudflare):
        assert "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" in content
        assert "uses: actions/checkout@v4" not in content
    for content in (update, watcher, tests):
        assert "uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97" in content
    assert "uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a" in update
    assert "uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9" in update
    assert "uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128" in update
    assert "uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b" in watcher
    assert "uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd" in cloudflare
    assert "set -euo pipefail" in update
    assert "set -euo pipefail" in cloudflare


def test_queued_collection_checks_out_latest_main():
    update = (ROOT / ".github/workflows/update-character-usage.yml").read_text(encoding="utf-8")
    checkout = update.split("- name: Check out repository", 1)[1].split("- name: Set up Python", 1)[0]
    assert "with:" in checkout
    assert "ref: main" in checkout
    assert "cancel-in-progress: false" in update
    assert "git pull --rebase origin main" in update
    assert "python scripts/cache_character_images.py" in update
    assert "docs/assets/characters" in update
    cache_script = (ROOT / "scripts/cache_character_images.py").read_text(
        encoding="utf-8"
    )
    assert "import scrape_character_usage as collector" in cache_script


def test_static_rank_period_matches_the_javascript_default():
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")
    page = (ROOT / "docs/index.html").read_text(encoding="utf-8")
    pages_workflow = (
        ROOT / ".github/workflows/deploy-github-pages.yml"
    ).read_text(encoding="utf-8")

    assert 'selectedRankPeriod: "day"' in app
    assert '<span id="rank-period-current">前日締め</span>' in page
    app_bytes = (ROOT / "docs/assets/app.js").read_bytes()
    app_blob = hashlib.sha1(
        f"blob {len(app_bytes)}\0".encode() + app_bytes
    ).hexdigest()[:12]
    assert f'<script src="./assets/app.js?v={app_blob}" defer></script>' in page
    style_bytes = (ROOT / "docs/assets/style.css").read_bytes()
    style_blob = hashlib.sha1(
        f"blob {len(style_bytes)}\0".encode() + style_bytes
    ).hexdigest()[:12]
    assert f'<link rel="stylesheet" href="./assets/style.css?v={style_blob}">' in page
    assert "app.js?v=$GITHUB_SHA" in pages_workflow
    assert "community-entry.js?v=$GITHUB_SHA" in pages_workflow
    assert "path: ./pages-dist" in pages_workflow
    assert 'data.publication_mode === "partial_after_stale"' in app
    assert "PARTIAL_FALLBACK_AFTER_MINUTES = 180" in app


def test_public_language_switcher_is_strictly_japanese_and_english():
    index = (ROOT / "docs/index.html").read_text(encoding="utf-8")
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")

    assert index.count('data-language="ja"') == 1
    assert index.count('data-language="en"') == 1
    for unsupported in ("zh", "th", "id", "vi", "ko"):
        assert f'data-language="{unsupported}"' not in index
    assert 'const LANGUAGES = ["ja", "en"];' in app
    assert 'if (browser.startsWith("ja")) return "ja";' in app
    for unsupported_prefix in ("th", "zh", "id", "vi", "ko"):
        assert f'if (browser.startsWith("{unsupported_prefix}"))' not in app


def test_mobile_heading_wraps_inside_the_viewport():
    style = (ROOT / "docs/assets/style.css").read_text(encoding="utf-8")
    assert """  h1 {
    font-size: clamp(1.9rem, 8.6vw, 2.35rem);
    overflow-wrap: anywhere;
    word-break: normal;
    text-wrap: pretty;
  }""" in style


def test_character_modal_shows_horizontal_skill_cards_icons_effects_and_blue_handbook_link():
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")
    style = (ROOT / "docs/assets/style.css").read_text(encoding="utf-8")

    assert 'skillInfo: "スキル情報"' in app
    assert 'skillEffects: "スキル効果"' in app
    assert 'function rangerDetailUrl(character)' in app
    assert 'function isTrustedSkillIconUrl(value)' in app
    assert 'function createSkillIcon(skill)' in app
    assert 'https://rangers.lerico.net/ja/ranger/' in app
    assert 'url.pathname.startsWith("/res/skill_icon/")' in app
    assert 'RANGER_INFO_WORKER_URL' in app
    assert 'function loadRangerInfo(character)' in app
    assert 'RANGER_INFO_RETRY_COOLDOWN_MS = 15_000' in app
    assert 'RANGER_INFO_SCHEMA_VERSION = "2"' in app
    assert 'rangerInfoFailed: new Map()' in app
    assert 'cache: "no-store"' in app
    assert 'state.rangerInfoFailed.set(unitCode, Date.now())' in app
    assert 'item.dataset.hasEffects = String(skill.effects.length > 0)' in app
    assert 'renderCharacterSkillSummary(character)' in app
    assert 'equipment-character-name' in app
    assert 'equipment-skill-image' in app
    assert 'equipment-skill-description' in app
    assert 'equipment-skill-effects' in app
    assert 'skill.effects.forEach' in app
    assert 'description.textContent = et("dialogDescription")' not in app
    assert 'et("characterPlayers") +' not in app
    assert '.equipment-character-name' in style
    assert 'color: #60a5fa;' in style
    assert 'a.equipment-character-name:visited' in style
    assert '.equipment-skill-list {' in style
    assert 'grid-template-columns: repeat(2, minmax(0, 1fr));' in style
    assert '.equipment-skill-item {' in style
    assert 'grid-template-columns: 4.25rem minmax(0, 1fr);' in style
    assert '.equipment-skill-image' in style
    assert '.equipment-skill-effects {' in style
    assert 'margin-top: 0.85rem;' in style
    mobile = style.split('@media (max-width: 600px) {', 1)[1]
    assert '.equipment-skill-list {' in mobile
    assert 'grid-template-columns: none;' in mobile
    assert 'grid-auto-flow: column;' in mobile
    assert 'grid-auto-columns: minmax(15.5rem, 92%);' in mobile
    assert 'overflow-x: auto;' in mobile
    assert 'scroll-snap-type: x mandatory;' in mobile
    assert 'grid-template-columns: 1fr;' not in mobile.split('.equipment-skill-item {', 1)[0]
    assert 'scroll-snap-align: start;' in mobile


def test_saturday_pvp_reset_notice_is_fully_removed():
    index = (ROOT / "docs/index.html").read_text(encoding="utf-8")
    app = (ROOT / "docs/assets/app.js").read_text(encoding="utf-8")
    style = (ROOT / "docs/assets/style.css").read_text(encoding="utf-8")

    assert "sunday-notice" not in index
    assert "weekly-notice" not in index
    assert "WEEKLY_NOTICE" not in app
    assert "updateWeeklyNotice" not in app
    assert "土曜のPVPランキング初期化直後は" not in app
    assert ".weekly-notice" not in style
