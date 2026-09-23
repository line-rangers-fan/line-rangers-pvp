import json
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from scripts.validate_community_registry_overlay import validate_overlay, TOPICS, STATE, SNAPSHOT


def topic(unit, month="2026-10"):
    return {
        "id": unit, "releaseMonth": month, "confirmed": True,
        "source": "pvp-auto", "name": "新キャラ", "nameEn": "New ranger", "nameZh": "新角色",
        "image": f"https://rangers.lerico.net/res/{unit}/{unit}-thum.png",
        "metadataSource": "rangers.lerico.net/api/getRangersBasics", "evolutionStage": "e",
        "skillsVerified": True, "skillCount": 2, "skillsVerifiedAt": "2026-10-02T00:00:00Z",
        "observationCount": 3, "pvpRank": None, "adoptionRate": None,
    }


def write(root, name, value):
    dest = root / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(value), encoding="utf-8")


def fixture(old_topics, new_topics):
    pinned_dir = TemporaryDirectory()
    candidate_dir = TemporaryDirectory()
    pinned, candidate = Path(pinned_dir.name), Path(candidate_dir.name)
    write(pinned, TOPICS, {"schemaVersion": 1, "characters": old_topics})
    write(candidate, TOPICS, {"schemaVersion": 1, "characters": new_topics})
    state = {"initialized": True, "catalogInitialized": True,
             "knownIds": ["u1631e-sally"], "knownCatalogIds": ["u1631e-sally"],
             "lastSnapshotAt": "2026-10-01T00:00:00Z"}
    write(pinned, STATE, state)
    write(candidate, STATE, {**state, "lastSnapshotAt": "2026-10-02T00:00:00Z"})
    write(candidate, SNAPSHOT, {"target_players": 200, "sampled_players": 200,
                                "complete_target": True, "updated_at": "2026-10-02T00:00:00Z"})
    return pinned_dir, candidate_dir, pinned, candidate


def test_append_several_verified_unranked_topics_then_rank_them():
    old = topic("u1631e-sally", "2026-09")
    newer = [deepcopy(old), *(topic("u2000e-new" + str(i)) for i in range(4))]
    newer[0]["pvpRank"] = 42  # legitimate historical ordering update
    tmp_a, tmp_b, pinned, candidate = fixture([old], newer)
    with tmp_a, tmp_b:
        assert validate_overlay(pinned, candidate, [TOPICS, STATE, SNAPSHOT]) == 4


@pytest.mark.parametrize("alteration", ["remove", "metadata", "skills", "duplicate", "partial", "source_reset", "unknown_path"])
def test_cannot_publish_unsafe_registry_or_other_code(alteration):
    original = topic("u1631e-sally", "2026-09")
    added = topic("u2000e-new")
    tmp_a, tmp_b, pinned, candidate = fixture([original], [deepcopy(original), added])
    with tmp_a, tmp_b:
        changes = [TOPICS, STATE, SNAPSHOT]
        if alteration == "remove":
            write(candidate, TOPICS, {"schemaVersion": 1, "characters": [added]})
        elif alteration == "metadata":
            changed = deepcopy(original)
            changed["name"] = "rewritten"
            write(candidate, TOPICS, {"schemaVersion": 1, "characters": [changed, added]})
        elif alteration == "skills":
            added["skillsVerified"] = False
            write(candidate, TOPICS, {"schemaVersion": 1, "characters": [original, added]})
        elif alteration == "duplicate":
            write(candidate, TOPICS, {"schemaVersion": 1, "characters": [original, added, added]})
        elif alteration == "partial":
            data = json.loads((candidate / SNAPSHOT).read_text())
            data["sampled_players"] = 199
            write(candidate, SNAPSHOT, data)
        elif alteration == "source_reset":
            state = json.loads((candidate / STATE).read_text())
            state["knownIds"] = []
            write(candidate, STATE, state)
        else:
            changes.append("app/api/board/route.ts")
        with pytest.raises((ValueError, KeyError)):
            validate_overlay(pinned, candidate, changes)


def test_sync_overlay_retains_pinned_code_and_preserves_pvp_when_board_source_is_unavailable():
    workflow = (Path(__file__).parents[1] / ".github/workflows/sync-production-pvp.yml").read_text()
    assert "COPY_SOURCE_SHA" in workflow
    assert "git -C copy-source merge-base --is-ancestor" in workflow
    assert "git -C copy-source restore -- config/community-characters.json data/community-character-discovery.json" in workflow
    assert "cp community-candidate/config/community-characters.json copy-source/config/community-characters.json" in workflow
    assert "scripts/validate_community_registry_overlay.py" in workflow
    assert "Verify live monthly topics and four-language metadata without board writes" in workflow
    assert "api/community-topics?month=$month" in workflow
    assert "rm -rf copy-source/public/pvp" in workflow
    assert "wrangler d1 create" not in workflow and "wrangler r2 bucket create" not in workflow
