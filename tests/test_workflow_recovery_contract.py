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


def test_public_delivery_guardian_escalates_only_after_independent_repeat():
    workflow = read(".github/workflows/guard-public-delivery-incidents.yml")
    assert "findRepeatedFailure" in workflow
    assert "workflow_id: current.workflow_id" in workflow
    assert "run.id === current.id" in workflow
    assert "currentCreatedAt - previousCreatedAt > 2 * 60 * 60 * 1000" in workflow
    assert "No incident is opened unless the same failure repeats on an independent publication." in workflow
    assert "waiting for the next normal publication before escalating" in workflow
    assert "Wait for synchronized Pages and Worker snapshots" in workflow
    assert "Audit production at mobile, iPad, and desktop viewports" in workflow


def test_visual_audit_allows_bounded_ranger_info_recovery():
    workflow = read(".github/workflows/production-visual-audit.yml")
    assert "async function waitForRangerSkills" in workflow
    assert "timeout: 65000" in workflow
    assert workflow.count("await waitForRangerSkills(page, target.name, viewport.name);") == 4
    assert "Ranger skill information did not recover within 65 seconds" in workflow
    assert "skill-timeout.png" in workflow
    assert "if-no-files-found: warn" in workflow


def test_pages_verification_requires_all_four_public_languages():
    workflow = read(".github/workflows/deploy-github-pages.yml")
    for language in ("ja", "en", "zh", "th"):
        assert f'grep -q \'data-language="{language}"\' /tmp/index.html' in workflow
    assert "! grep -q 'data-language=\"zh\"'" not in workflow


def test_production_deploy_verifies_all_four_ranger_languages_and_localized_board_names():
    workflow = read(".github/workflows/deploy-original-community-production.yml")
    for language, source_language in (("ja", "ja"), ("en", "en"), ("zh", "zh"), ("th", "en")):
        assert f"probe_ranger {language} {source_language}" in workflow
    assert '/api/ranger-info?unit=u1556e-af&lang=$language&schema=3' in workflow
    assert '.language == $language' in workflow
    assert '.nameZh == "巨蟹座 莎莉"' in workflow
    assert '.nameTh == "แซลลี่ ราศีกรกฎ"' in workflow


def test_transient_ranger_probe_is_bounded_and_does_not_fail_core_deploy():
    workflow = read(".github/workflows/deploy-original-community-production.yml")
    core = workflow.split("- name: Verify production Worker core end to end", 1)[1].split("- name: Probe Ranger info with bounded recovery", 1)[0]
    probe = workflow.split("- name: Probe Ranger info with bounded recovery", 1)[1].split("- name: Verify Owner plus Viewer A/B unread isolation without posts", 1)[0]
    assert "/api/ranger-info" not in core
    assert "continue-on-error: true" in probe
    assert "--max-time 20 --retry 1" in probe
    assert "probe_ranger ja ja" in probe
    assert "probe_ranger en en" in probe
    assert "probe_ranger zh zh" in probe
    assert "probe_ranger th en" in probe
    assert "Production Visual Audit remains authoritative" in probe

