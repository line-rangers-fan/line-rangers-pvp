"""Reproduce a queued Actions event SHA racing a newer data publication."""

import json
from pathlib import Path
import subprocess

import pytest


def git(directory, *args, check=True):
    return subprocess.run(
        ["git", "-c", "user.name=Regression Test", "-c", "user.email=regression@example.invalid", *args],
        cwd=directory, text=True, capture_output=True, check=check,
    )


def publish(directory, snapshots):
    path = directory / "history.json"
    path.write_text(json.dumps({"snapshots": snapshots}) + "\n", encoding="utf-8")
    git(directory, "add", "history.json")
    git(directory, "commit", "-m", "Update fixture history")


@pytest.mark.parametrize("latest_main", [False, True])
def test_queued_event_sha_vs_latest_main(tmp_path, latest_main):
    origin = tmp_path / "origin.git"
    first = tmp_path / "first"
    queued = tmp_path / "queued"
    git(tmp_path, "init", "--bare", str(origin))
    git(tmp_path, "clone", str(origin), str(first))
    git(first, "checkout", "-b", "main")
    publish(first, ["base"])
    git(first, "push", "origin", "main")
    event_sha = git(first, "rev-parse", "HEAD").stdout.strip()

    # The event is now queued; the preceding run completes while it waits.
    publish(first, ["base", "first"])
    git(first, "push", "origin", "main")
    git(tmp_path, "clone", "--branch", "main", str(origin), str(queued))
    git(queued, "checkout", "-B", "main", "origin/main" if latest_main else event_sha)
    history = json.loads((queued / "history.json").read_text(encoding="utf-8"))["snapshots"]
    publish(queued, history + ["queued"])
    result = git(queued, "pull", "--rebase", "origin", "main", check=False)
    if latest_main:
        assert result.returncode == 0
        assert json.loads((queued / "history.json").read_text())["snapshots"] == ["base", "first", "queued"]
    else:
        assert result.returncode != 0
        assert "CONFLICT" in result.stdout + result.stderr
