from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = (ROOT / "community" / "HARDENING_PERFORMANCE_PLAN.md").read_text(encoding="utf-8")
ENTRY = (ROOT / "docs" / "assets" / "community-entry.js").read_text(encoding="utf-8")
INDEX = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")


def test_role_security_is_server_authoritative():
    for token in (
        "server-side",
        "Display name is profile data only",
        "Only Owner can grant/revoke Moderator",
        "UI hiding is not security",
        "Invalid/tampered/expired sessions fail to ordinary User",
        "Achievement/title badges are a separate namespace/table",
    ):
        assert token in PLAN


def test_owner_identity_must_not_leak_to_frontend():
    assert "Never ship the owner email/principal to public JS" in PLAN
    assert "BOARD_OWNER_EMAIL" not in ENTRY
    assert "ownerEmail" not in ENTRY


def test_media_delivery_has_bounded_lightweight_contract():
    for token in (
        "12 MiB",
        'preload=\\"none\\"',
        "No autoplay",
        "poster thumbnail",
        "byte-range support",
        "Lazy-load below-fold images",
        "Clean temporary/orphan objects",
    ):
        assert token in PLAN


def test_mutations_require_abuse_and_duplicate_guards():
    for token in (
        "rate limits",
        "idempotency key",
        "Unique DB constraints",
        "CSRF",
        "Credentialed CORS never uses `*`",
        "Parameterized database queries",
    ):
        assert token in PLAN


def test_community_entry_remains_isolated_and_dependency_free():
    assert "fetch(" not in ENTRY
    assert "XMLHttpRequest" not in ENTRY
    assert "WebSocket" not in ENTRY
    assert "community-board-entry-slot" in INDEX
    assert "ranking-section" in INDEX


def test_release_stays_fail_closed():
    assert "GitHub Pages stays disabled" in PLAN
    assert "repository visibility stays private" in PLAN
    assert 'class="maintenance-mode"' in INDEX
    assert 'content="noindex, nofollow"' in INDEX
