"""Apply the exact 199/200 partial-publication policy in CI runner copies.

The repository keeps the normal collector and validators conservative.  Before
an authorized collection/publication workflow runs, this helper applies a
small, verified runtime patch that permits exactly one missing ranked player.
It does not relax 198-or-lower samples, detail-fetch failures, malformed unit
or equipment records, comparison history, or production board data.

The patch is intentionally runner-local: collector output commits only data and
cached images, while Pages/Worker validation apply the same policy before they
validate a 199/200 snapshot.
"""

from pathlib import Path


SCRAPER = Path("scripts/scrape_character_usage.py")
QUALITY = Path("scripts/quality_checks.py")

SCRAPE_CONTEXT_DOC_OLD = (
    '    """Enable partial publication only after three hours without a full sample."""\n'
)
SCRAPE_CONTEXT_DOC_NEW = (
    '    """Enable an exact 199/200 publication when a verified full baseline exists."""\n'
)

SCRAPE_CONTEXT_AGE_OLD = '''    age = (current - last_complete.astimezone(timezone.utc)).total_seconds()
    return age >= PARTIAL_FALLBACK_AFTER_MINUTES * 60, last_complete
'''
SCRAPE_CONTEXT_AGE_NEW = '''    # A verified complete baseline is still required, but a one-player
    # upstream defect no longer has to remain unresolved for three hours.
    # The 199/200 limit itself is enforced by the patched quality validator.
    return current >= last_complete.astimezone(timezone.utc), last_complete
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
        # Only one structurally invalid ranked player may be omitted. Network
        # detail failures remain strict above, and 198-or-lower samples remain
        # fail-closed here.
        if (
            not ALLOW_PARTIAL_FOR_RUN
            or LAST_COMPLETE_FOR_RUN is None
            or missing_players != 1
            or len(players) != TARGET_PLAYER_COUNT - 1
        ):
            raise RuntimeError(
                "Some requested ranked players had incomplete team or equipment data; "
                f"refusing to publish missing player details ({len(players)} != {expected_players})."
            )
        diagnostics["partial_missing_players"] = missing_players
        diagnostics["partial_detail_recheck_failures"] = len(content_recheck_failures)
'''

SCRAPE_FALLBACK_OLD = '            "trigger_after_minutes": PARTIAL_FALLBACK_AFTER_MINUTES,\n'
SCRAPE_FALLBACK_NEW = '            "trigger_after_minutes": 0,\n'

QUALITY_PARTIAL_OLD = '''    is_partial = (
        publication_mode == PARTIAL_PUBLICATION_MODE
        and target_players == 200
        and 0 < players < target_players
        and data.get("complete_target") is False
    )
'''
QUALITY_PARTIAL_NEW = '''    is_partial = (
        publication_mode == PARTIAL_PUBLICATION_MODE
        and target_players == 200
        and players == target_players - 1
        and data.get("complete_target") is False
    )
'''

QUALITY_FALLBACK_OLD = '''        if (
            not isinstance(fallback, dict)
            or int(fallback.get("trigger_after_minutes", 0))
            != PARTIAL_FALLBACK_AFTER_MINUTES
            or int(fallback.get("missing_players", -1))
            != target_players - players
            or last_complete is None
            or current is None
            or (current - last_complete).total_seconds()
            < PARTIAL_FALLBACK_AFTER_MINUTES * 60
        ):
            errors.append("invalid partial fallback evidence")
'''
QUALITY_FALLBACK_NEW = '''        trigger_after_minutes = (
            int(fallback.get("trigger_after_minutes", -1))
            if isinstance(fallback, dict)
            else -1
        )
        if (
            not isinstance(fallback, dict)
            or trigger_after_minutes not in {0, PARTIAL_FALLBACK_AFTER_MINUTES}
            or int(fallback.get("missing_players", -1))
            != target_players - players
            or last_complete is None
            or current is None
            or (
                trigger_after_minutes > 0
                and (current - last_complete).total_seconds()
                < trigger_after_minutes * 60
            )
        ):
            errors.append("invalid partial fallback evidence")
'''

QUALITY_DIAGNOSTICS_OLD = '''        if int(quality.get("detail_fetch_failures", -1)) != 0:
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
QUALITY_DIAGNOSTICS_NEW = '''        detail_failures = int(quality.get("detail_fetch_failures", -1))
        invalid_records = int(quality.get("invalid_player_records", -1))
        if detail_failures != 0:
            errors.append("detail fetch failures present")
        if invalid_records < 0:
            errors.append("invalid player record count")
        elif is_partial:
            if invalid_records > target_players - players:
                errors.append("too many invalid player records for 199/200 publication")
        elif invalid_records != 0:
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
        if is_partial:
            if requested_fetches not in {players, target_players}:
                errors.append("diagnostic fetch total mismatch")
        elif requested_fetches != target_players:
            errors.append("diagnostic fetch total mismatch")

        failure_keys = (
            "detail_fetch_failures",
            "missing_player_info",
            "invalid_players",
            "invalid_unit_codes",
            "invalid_equipment",
            "invalid_rank_records",
        )
        if is_partial:
            # Exact 199/200 may explain its single missing player through one
            # missing/current-team/rank record. Unit/equipment corruption and
            # transport failures remain hard failures.
            if diagnostics.get("detail_fetch_failures"):
                errors.append("diagnostic detail fetch failures present")
            if diagnostics.get("invalid_unit_codes") or diagnostics.get("invalid_equipment"):
                errors.append("diagnostic unit/equipment corruption present")
            bounded_player_errors = sum(
                len(diagnostics.get(key))
                if isinstance(diagnostics.get(key), list)
                else 0
                for key in ("missing_player_info", "invalid_players", "invalid_rank_records")
            )
            if bounded_player_errors > target_players - players:
                errors.append("too many diagnostic player errors for 199/200 publication")
        elif any(diagnostics.get(key) for key in failure_keys):
            errors.append("diagnostic collection errors present")
'''


def replace_once(path: Path, old: str, new: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return False
    if old not in text:
        raise SystemExit(
            f"Expected source block was not found in {path}; refusing an unsafe patch."
        )
    updated = text.replace(old, new, 1)
    path.write_text(updated, encoding="utf-8")
    if new not in path.read_text(encoding="utf-8"):
        raise SystemExit(f"Patch verification failed for {path}.")
    return True


def main() -> None:
    changed = False
    changed |= replace_once(SCRAPER, SCRAPE_CONTEXT_DOC_OLD, SCRAPE_CONTEXT_DOC_NEW)
    changed |= replace_once(SCRAPER, SCRAPE_CONTEXT_AGE_OLD, SCRAPE_CONTEXT_AGE_NEW)
    changed |= replace_once(SCRAPER, SCRAPE_CONTENT_OLD, SCRAPE_CONTENT_NEW)
    changed |= replace_once(SCRAPER, SCRAPE_FALLBACK_OLD, SCRAPE_FALLBACK_NEW)
    changed |= replace_once(QUALITY, QUALITY_PARTIAL_OLD, QUALITY_PARTIAL_NEW)
    changed |= replace_once(QUALITY, QUALITY_FALLBACK_OLD, QUALITY_FALLBACK_NEW)
    changed |= replace_once(QUALITY, QUALITY_DIAGNOSTICS_OLD, QUALITY_DIAGNOSTICS_NEW)
    if changed:
        print("Applied exact 199/200 partial-publication policy.")
    else:
        print("Exact 199/200 partial-publication policy already present.")


if __name__ == "__main__":
    main()
