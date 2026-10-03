from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_independent_watcher_avoids_duplicate_collection_but_fails_open():
    workflow = _read(".github/workflows/watch-character-usage.yml")

    assert "Check for an active collection" in workflow
    assert "listWorkflowRuns" in workflow
    for status in ("requested", "waiting", "pending", "queued", "in_progress"):
        assert f'"{status}"' in workflow
    assert "active.outputs.active != 'true'" in workflow
    assert "Fail open: an inspection problem must not disable recovery." in workflow
    assert 'core.setOutput("active", active ? "true" : "false")' in workflow


def test_incident_guardian_retries_transient_failure_once_then_escalates():
    workflow = _read(".github/workflows/guard-collection-incidents.yml")

    assert 'workflows: ["scrape-and-deploy"]' in workflow
    assert "actions: write" in workflow
    assert "issues: write" in workflow
    assert 'const incidentTitle = "自動集計の連続障害を検出しました"' in workflow
    assert 'const attempt = Number(current.run_attempt || 1);' in workflow
    assert "reRunWorkflowFailedJobs" in workflow
    assert '"Run scraper"' in workflow
    assert '"Save collected data"' in workflow
    assert '"Dispatch synchronized PvP publication"' in workflow
    assert '"Run collector-critical quality tests"' not in workflow
    assert "issues.create(" in workflow
    assert "issues.createComment(" in workflow
    assert 'state: "closed"' in workflow
    assert "200/200、比較整合性、公開データの品質基準は自動では緩めません" in workflow


def test_collector_retries_publication_dispatch_before_failing():
    workflow = _read(".github/workflows/update-character-usage.yml")

    block = workflow.split("- name: Dispatch synchronized PvP publication", 1)[1]
    block = block.split("\n      - name:", 1)[0]
    assert "dispatch_workflow()" in block
    assert "for attempt in 1 2 3 4; do" in block
    assert "deploy-github-pages.yml" in block
    assert "sync-production-pvp.yml" in block
    assert "retrying in" in block
    assert "Unable to dispatch" in block


def test_worker_and_runbook_document_the_same_deduplicated_recovery_contract():
    worker = _read("infra/cloudflare-watchdog/src/index.mjs")
    runbook = _read("OPERATIONS.md")

    assert "export async function hasActiveCollection" in worker
    assert 'reason: "collection_active"' in worker
    assert "continuing guarded dispatch" in worker
    assert "重複する復旧要求を追加しません" in runbook
    assert "1回だけ自動再試行" in runbook
    assert "正常な200人集計" in runbook
