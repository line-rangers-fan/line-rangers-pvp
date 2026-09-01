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
        "sunday-notice",
    ):
        assert f'id="{element_id}"' in index


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
    assert '"±0"' in app
    assert "fetchJsonWithLimits" in app
    assert "REQUEST_TIMEOUT_MS" in app
    # The browser must use the same bounded collection window as the
    # collector, freshness gate, and watchdog.
    assert "const MAX_COLLECTION_DURATION_SECONDS = 15 * 60;" in app
    assert "isTrustedCharacterImage" in app
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
    cloudflare = (workflows / "deploy-cloudflare-watchdog.yml").read_text(
        encoding="utf-8"
    )

    for content in (update, watcher, cloudflare):
        assert "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262" in content
        assert "uses: actions/checkout@v4" not in content
    assert "uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065" in update
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
