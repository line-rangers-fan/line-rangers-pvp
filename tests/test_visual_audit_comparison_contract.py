from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_production_visual_audit_uses_current_health_for_comparison_badges():
    workflow = (ROOT / ".github/workflows/production-visual-audit.yml").read_text(encoding="utf-8")

    assert "character_usage_health.json" in workflow
    assert "cp \"$GITHUB_WORKSPACE/scripts/visual-audit-comparisons.mjs\" ." in workflow
    assert "import { assertComparisonBadgeState } from './visual-audit-comparisons.mjs';" in workflow
    assert "JSON.parse(await fs.readFile('/tmp/pages-character-usage-health.json', 'utf8'))" in workflow
    assert workflow.count("assertComparisonBadgeState(") == 2
    assert "comparisonState," in workflow
    assert "equipmentState," in workflow
