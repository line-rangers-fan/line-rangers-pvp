import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = (ROOT / "community" / "SECURITY_AND_MIGRATION_CONTRACT.md").read_text(encoding="utf-8")
REGISTRY = json.loads((ROOT / "community" / "new_character_registry.json").read_text(encoding="utf-8"))
ENTRY = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")


def test_security_contract_contains_required_identity_and_authz_guards():
    required = (
        "Secure",
        "HttpOnly",
        "SameSite",
        "Display name is mutable profile data",
        "Only Owner can grant/revoke Moderator",
        "idempotency/request ID",
        "CSRF",
        "CORS",
        "parameterized",
        "12 MiB",
        "magic bytes",
        "soft deletes",
        "backup",
        "restore",
    )
    for token in required:
        assert token in CONTRACT


def test_new_character_policy_is_fail_closed():
    policy = REGISTRY["policy"]
    assert policy["minimum_valid_observations"] >= 2
    assert policy["require_metadata_verification"] is True
    assert policy["require_release_or_registry_verification"] is True
    assert policy["publish_fail_closed"] is True
    assert policy["identity_key"] == "character_id"
    assert policy["pvp_failure_isolation"] is True


def test_september_board_has_exactly_approved_sally_target():
    september = [c for c in REGISTRY["characters"] if c["board_month"] == "2026-09" and c["approved"]]
    assert len(september) == 1
    sally = september[0]
    assert sally["character_id"] == "u1631e-sally"
    assert sally["display_name_ja"] == "かに座 サリー"
    assert sally["exclude_other_evolution"] is True


def test_missing_sally_image_fails_closed_instead_of_using_wrong_evolution():
    sally = REGISTRY["characters"][0]
    image = sally["image"]
    assert image["status"] == "missing_requires_verified_asset"
    assert image["repository_path"] is None
    assert image["allow_name_similarity_fallback"] is False
    assert image["allow_other_evolution_fallback"] is False


def test_pvp_entry_points_directly_to_latest_board_only():
    assert "https://line-rangers-community-dev.n-yu1791.chatgpt.site/boards" in ENTRY
    assert "rangers-community-review.n-yu1791.chatgpt.site" not in ENTRY
