from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_production_promotion_pin_is_single_source_of_truth():
    workflow = read(".github/workflows/deploy-original-community-production.yml")
    assert "COPY_SOURCE_SHA: 3790879c49c76b607e8ffe356f3606dd2ee6e6c1" not in workflow
    assert "Resolve current production promotion pin" in workflow
    assert 'echo "COPY_SOURCE_SHA=$source_sha" >> "$GITHUB_ENV"' in workflow
    assert 'if [ "$latest_sha" != "$COPY_SOURCE_SHA" ]; then' in workflow
    assert "MINIMUM_COMMUNITY_SOURCE_SHA: d7b4fe844766a77d3526379f74e6bce8becc425c" in workflow


def test_visual_audit_waits_for_pages_worker_parity():
    workflow = read(".github/workflows/production-visual-audit.yml")
    assert 'workflows: ["deploy-github-pages", "sync-production-pvp"]' in workflow
    assert "Wait for synchronized Pages and Worker snapshots" in workflow
    assert "cmp -s /tmp/pages-character-usage.json /tmp/worker-character-usage.json" in workflow
    assert ".target_players == 200 and .sampled_players == 200 and .complete_target == true" in workflow


def test_retryable_incident_requires_independent_repeat_before_escalation():
    workflow = read(".github/workflows/guard-collection-incidents.yml")
    assert "repeatedTransientFailure" in workflow
    assert "run.id === current.id" in workflow
    assert "currentCreatedAt - previousCreatedAt <= 2 * 60 * 60 * 1000" in workflow
    assert "previousFailedSteps.includes(name)" in workflow
    assert "waiting for the next scheduled collection before escalating" in workflow


def test_truth_and_production_resource_guards_remain_strict():
    collector = read(".github/workflows/update-character-usage.yml")
    validator = read("scripts/validate_public_comparisons.py")
    production = read(".github/workflows/deploy-original-community-production.yml")
    assert ".target_players == 200 and .sampled_players == 200 and .complete_target == true" in collector
    assert 'value.get("reason") == "source_stale"' in validator
    assert "D1_NAME: line-rangers-pvp-production-db" in production
    assert "R2_BUCKET: line-rangers-pvp-production-media" in production
