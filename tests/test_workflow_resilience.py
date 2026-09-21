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


def test_worker_and_runbook_document_the_same_deduplicated_recovery_contract():
    worker = _read("infra/cloudflare-watchdog/src/index.mjs")
    runbook = _read("OPERATIONS.md")

    assert "export async function hasActiveCollection" in worker
    assert 'reason: "collection_active"' in worker
    assert "continuing guarded dispatch" in worker
    assert "重複する復旧要求を追加しません" in runbook
    assert "1回だけ自動再試行" in runbook
    assert "正常な200人集計" in runbook


def test_production_promotion_resolves_copy_sha_from_marker_at_runtime():
    workflow = _read(".github/workflows/deploy-original-community-production.yml")

    assert "COPY_SOURCE_SHA: 3790879c49c76b607e8ffe356f3606dd2ee6e6c1" not in workflow
    assert "- name: Resolve currently promoted community source" in workflow
    assert "source_sha=\"$(sed -n 's/^copy_source_sha=//p' .production-promotion-trigger | head -n1)\"" in workflow
    assert '[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]]' in workflow
    assert 'echo "COPY_SOURCE_SHA=$source_sha" >> "$GITHUB_ENV"' in workflow
    assert "ref: main" in workflow
    assert "- name: Refuse stale production promotion" in workflow
    assert 'EXPECTED_COPY_SOURCE_SHA: $' + '{{ env.COPY_SOURCE_SHA }}' in workflow
    assert 'if [ "$latest_sha" != "$EXPECTED_COPY_SOURCE_SHA" ]; then' in workflow
