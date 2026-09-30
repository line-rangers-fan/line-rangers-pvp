"""Balanced quality gates: keep the site updating without polluting comparison history."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_collection_gate_is_scoped_to_data_safety_not_frontend_regressions():
    workflow = read(".github/workflows/update-character-usage.yml")
    assert "Run collector-critical quality tests" in workflow
    for path in (
        "tests/test_scrape_character_usage.py",
        "tests/test_quality_checks.py",
        "tests/test_check_data_freshness.py",
        "tests/test_collection_resilience.py",
        "tests/test_queued_collection_checkout.py",
        "tests/test_comparison_guards.py",
        "tests/test_cross_sample_comparisons.py",
    ):
        assert path in workflow
    assert "node --test tests/*.mjs" not in workflow
    assert "node --check docs/assets/app.js" not in workflow


def test_pull_request_gate_still_runs_full_quality_suite():
    workflow = read(".github/workflows/test-comparison-guards.yml")
    assert "PYTHONPATH=. python -m pytest -q" in workflow
    assert "node --check docs/assets/app.js" in workflow
    assert "node --test tests/*.mjs" in workflow


def test_collection_auto_retries_only_transient_operational_steps_once():
    workflow = read(".github/workflows/guard-collection-incidents.yml")
    assert "actions: write" in workflow
    assert 'const attempt = Number(current.run_attempt || 1);' in workflow
    assert "reRunWorkflowFailedJobs" in workflow
    for step in (
        "Run scraper",
        "Save collected data",
        "Dispatch synchronized PvP publication",
    ):
        assert f'"{step}"' in workflow
    assert '"Run collector-critical quality tests"' not in workflow
    assert '"cancelled"' not in workflow


def test_public_delivery_gets_one_retry_without_weakening_safety():
    workflow = read(".github/workflows/guard-public-delivery-incidents.yml")
    assert "actions: write" in workflow
    assert "deploy-github-pages" in workflow
    assert "sync-production-pvp" in workflow
    assert "production-visual-audit" in workflow
    assert 'attempt === 1' in workflow
    assert "reRunWorkflowFailedJobs" in workflow
    assert '"cancelled"' not in workflow


def test_collector_rebuilds_only_derived_comparisons_then_revalidates():
    workflow = read(".github/workflows/update-character-usage.yml")
    rebuild = workflow.index("Rebuild verified comparisons")
    validate = workflow.index("Validate publishable snapshot after repair")
    synchronize = workflow.index("Synchronize git base before saving collection")
    post_sync = workflow.index("Rebuild and revalidate after synchronization")
    save = workflow.index("Save collected data")
    assert rebuild < validate < synchronize < post_sync < save
    assert workflow.count("scripts/rebuild_cross_sample_comparisons.py") >= 2
    assert "scripts/validate_public_comparisons.py docs/data/character_usage.json" in workflow
    assert ".target_players == 200 and .sampled_players == 200 and .complete_target == true" in workflow
    assert ".sampled_players > 0 and .sampled_players < 200" in workflow


def test_pages_can_publish_clean_partial_while_worker_retains_verified_full_snapshot():
    pages = read(".github/workflows/deploy-github-pages.yml")
    worker = read(".github/workflows/sync-production-pvp.yml")
    update = read(".github/workflows/update-character-usage.yml")
    policy = read("scripts/prepare_partial_collection_runtime.py")

    assert "python scripts/prepare_partial_collection_runtime.py" in pages
    assert "python scripts/prepare_partial_collection_runtime.py" not in worker
    assert "Select newest verified full PvP snapshot for production" in worker
    assert "PRODUCTION_PVP_SOURCE_SHA" in worker
    assert '.sampled_players == 200' in worker
    assert '.publication_mode == "complete"' in worker
    assert '.collection_quality.invalid_player_records == 0' in worker
    assert ".sampled_players > 0 and .sampled_players < 200" in update
    assert "return True, last_complete" in policy
    assert "len(players) <= 0" in policy
    assert "if not ALLOW_PARTIAL_FOR_RUN" in policy
    assert 'data["termination_reason"] = "api_partial_available"' in policy
    assert '"trigger_after_minutes": 0' in policy
    assert "previous = None" in policy
    assert 'previous_history = {"snapshots": []}' in policy
    assert 'diagnostics["invalid_equipment"].append(str(error))' in policy
    assert 'invalid_player = True' in policy
    assert 'diagnostics["detail_team_mismatch_players"] += 1' in policy
    assert 'if not is_partial and any(diagnostics.get(key) for key in failure_keys)' in policy

    assert "scripts/validate_public_comparisons.py docs/data/character_usage.json" in pages
    assert "BOARD_OWNER_ACCESS_TOKEN|BOARD_OWNER_SUBJECT|BOARD_ANON_COOKIE_SECRET|CLOUDFLARE_.*TOKEN" in pages

    assert "Existing production D1 could not be resolved." in worker
    assert "Existing production R2 bucket could not be resolved." in worker
    assert "scripts/validate_public_comparisons.py" in worker
    assert "wrangler d1 create" not in worker
    assert "wrangler r2 bucket create" not in worker


def test_production_visual_audit_accepts_the_same_nonzero_partial_contract():
    workflow = read(".github/workflows/production-visual-audit.yml")
    assert workflow.count(".sampled_players > 0") >= 2
    assert workflow.count(".sampled_players < 200") >= 2
    assert workflow.count('.publication_mode == \"partial_after_stale\"') >= 2
    assert "synchronized at 200/200" not in workflow
    assert "same nonzero publishable sample" in workflow
