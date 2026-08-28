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
    assert "alwaysShowZero: true" in app
    assert "renderRankPeriodChanges(rank, item.change" in app
    assert ".rank-period-changes" in style
    assert ".equipment-rank-cell .rank-period-changes" in style
