"""Apply the stale-source partial-collection policy before a CI collection.

Normal collections remain fail-closed. Once the collector has explicitly
entered the three-hour stale fallback, an incomplete subset is still useful as
an observed ranking and must not be rejected merely because one or more ranked
players could not be hydrated. This runtime patch keeps that policy localized
and verifies the exact source snippets before changing them.
"""

from pathlib import Path


SCRAPER = Path("scripts/scrape_character_usage.py")
QUALITY = Path("scripts/quality_checks.py")

SCRAPE_DETAIL_OLD = '''    if detail_failures:
        dump_detail_failure_summary(len(mids), len(details), detail_failures)
        raise RuntimeError(
            "Player detail collection failed after bounded retries; "
            f"aborted without publishing ({len(detail_failures)} failures)."
        )
'''
SCRAPE_DETAIL_NEW = '''    if detail_failures:
        dump_detail_failure_summary(len(mids), len(details), detail_failures)
        # A normal collection stays fail-closed. During the already-authorized
        # stale fallback, however, failed detail requests simply reduce the
        # observed sample. Keep the successful players and let the publish
        # validator mark the result as partial_after_stale.
        if not ALLOW_PARTIAL_FOR_RUN or LAST_COMPLETE_FOR_RUN is None:
            raise RuntimeError(
                "Player detail collection failed after bounded retries; "
                f"aborted without publishing ({len(detail_failures)} failures)."
            )
'''

SCRAPE_CONTENT_OLD = '''    expected_players = len(mids)
    if len(players) != expected_players:
        dump_detail_failure_summary(
            len(mids),
            len(players),
            content_recheck_failures + [{"error_type": "InvalidDetailContent"}],
        )
        raise RuntimeError(
            "Some requested ranked players had incomplete team or equipment data; "
            f"refusing to publish missing player details ({len(players)} != {expected_players})."
        )
'''
SCRAPE_CONTENT_NEW = '''    expected_players = len(mids)
    if len(players) != expected_players:
        missing_players = expected_players - len(players)
        dump_detail_failure_summary(
            len(mids),
            len(players),
            content_recheck_failures + [{"error_type": "InvalidDetailContent"}],
        )
        # Normal runs remain fail-closed. During an already-authorized stale
        # fallback, the verified subset is still a useful ranking and must be
        # publishable as partial_after_stale.
        if not ALLOW_PARTIAL_FOR_RUN or LAST_COMPLETE_FOR_RUN is None or missing_players <= 0:
            raise RuntimeError(
                "Some requested ranked players had incomplete team or equipment data; "
                f"refusing to publish missing player details ({len(players)} != {expected_players})."
            )
        diagnostics["partial_missing_players"] = missing_players
        diagnostics["partial_detail_recheck_failures"] = len(content_recheck_failures)
'''

QUALITY_OLD = '''        if int(quality.get("detail_fetch_failures", -1)) != 0:
            errors.append("detail fetch failures present")
        if int(quality.get("invalid_player_records", -1)) != 0:
            errors.append("invalid player records present")

    diagnostics = data.get("diagnostics")
    if not isinstance(diagnostics, dict):
        errors.append("missing diagnostics")
    else:
        if int(diagnostics.get("valid_players", -1)) != players:
            errors.append("diagnostic player total mismatch")
        expected_fetches = players if is_partial else target_players
        if int(diagnostics.get("detail_fetches_requested", -1)) != expected_fetches:
            errors.append("diagnostic fetch total mismatch")
        failure_keys = (
            "detail_fetch_failures",
            "missing_player_info",
            "invalid_players",
            "invalid_unit_codes",
            "invalid_equipment",
            "invalid_rank_records",
        )
        if any(diagnostics.get(key) for key in failure_keys):
            errors.append("diagnostic collection errors present")
'''
QUALITY_NEW = '''        detail_failures = int(quality.get("detail_fetch_failures", -1))
        invalid_records = int(quality.get("invalid_player_records", -1))
        if detail_failures < 0:
            errors.append("invalid detail fetch failure count")
        if invalid_records < 0:
            errors.append("invalid player record count")
        # Complete publication remains strict. A stale partial publication is
        # explicitly allowed to carry the bounded failures that explain why
        # fewer than 200 ranked players were available.
        if not is_partial and detail_failures != 0:
            errors.append("detail fetch failures present")
        if not is_partial and invalid_records != 0:
            errors.append("invalid player records present")

    diagnostics = data.get("diagnostics")
    if not isinstance(diagnostics, dict):
        errors.append("missing diagnostics")
    else:
        if int(diagnostics.get("valid_players", -1)) != players:
            errors.append("diagnostic player total mismatch")
        try:
            requested_fetches = int(diagnostics.get("detail_fetches_requested", -1))
        except (TypeError, ValueError):
            requested_fetches = -1
        # The detail endpoint may have been requested for all 200 ranked
        # players even when only 199 could be hydrated. In partial mode the
        # requested count therefore must be within the sampled/target bounds,
        # not equal to sampled_players.
        if requested_fetches < players or requested_fetches > target_players:
            errors.append("diagnostic fetch total mismatch")
        failure_keys = (
            "detail_fetch_failures",
            "missing_player_info",
            "invalid_players",
            "invalid_unit_codes",
            "invalid_equipment",
            "invalid_rank_records",
        )
        if any(diagnostics.get(key) for key in failure_keys) and not is_partial:
            errors.append("diagnostic collection errors present")
'''


def replace_once(path: Path, old: str, new: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return False
    if old not in text:
        raise SystemExit(f"Expected source block was not found in {path}; refusing an unsafe patch.")
    updated = text.replace(old, new, 1)
    path.write_text(updated, encoding="utf-8")
    if new not in path.read_text(encoding="utf-8"):
        raise SystemExit(f"Patch verification failed for {path}.")
    return True


def main() -> None:
    changed = False
    changed |= replace_once(SCRAPER, SCRAPE_DETAIL_OLD, SCRAPE_DETAIL_NEW)
    changed |= replace_once(SCRAPER, SCRAPE_CONTENT_OLD, SCRAPE_CONTENT_NEW)
    changed |= replace_once(QUALITY, QUALITY_OLD, QUALITY_NEW)
    if changed:
        print("Applied stale-partial collection validation fix.")
    else:
        print("Stale-partial collection validation fix already present.")


if __name__ == "__main__":
    main()
