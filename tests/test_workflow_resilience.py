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


def test_incident_guardian_reports_only_repeated_failures_and_closes_on_recovery():
    workflow = _read(".github/workflows/guard-collection-incidents.yml")

    assert 'workflows: ["scrape-and-deploy"]' in workflow
    assert "issues: write" in workflow
    assert 'const incidentTitle = "自動集計の連続障害を検出しました"' in workflow
    assert "run.id !== current.id" in workflow
    assert "failureConclusions.has(previous.conclusion)" in workflow
    assert 'step.name === "Run scraper"' in workflow
    assert "issues.create(" in workflow
    assert "issues.createComment(" in workflow
    assert 'state: "closed"' in workflow
    assert "品質基準を外したり" in workflow


def test_worker_and_runbook_document_the_same_deduplicated_recovery_contract():
    worker = _read("infra/cloudflare-watchdog/src/index.mjs")
    runbook = _read("OPERATIONS.md")

    assert "export async function hasActiveCollection" in worker
    assert 'reason: "collection_active"' in worker
    assert "continuing guarded dispatch" in worker
    assert "重複する復旧要求を追加しません" in runbook
    assert "2回連続で失敗" in runbook
    assert "正常な200人集計" in runbook
