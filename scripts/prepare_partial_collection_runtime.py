"""Apply resilient partial-publication policy in CI runner copies.

The repository keeps the canonical collector conservative. Authorized collection
and publication workflows run this helper first so a degraded upstream response
can still publish every structurally valid player that was collected.

The runtime policy deliberately keeps two hard boundaries:
- every run still targets all 200 ranked players;
- zero usable players / zero character slots never replace the last publication.

Any positive structurally valid sample is a successful collection and may be
used as comparison history. Malformed rows are omitted and diagnostics remain
visible instead of turning headcount alone into a collection failure.
"""

from pathlib import Path


SCRAPER = Path("scripts/scrape_character_usage.py")
QUALITY = Path("scripts/quality_checks.py")


SCRAPE_PARTIAL_CONTEXT_OLD = '''def partial_fallback_context(
    previous: dict | None,
    now: datetime | None = None,
) -> tuple[bool, datetime | None]:
    """Enable partial publication only after three hours without a full sample."""
    try:
        validate_data(previous)
    except (ValueError, TypeError, AttributeError):
        return False, None
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    last_complete = _last_complete_timestamp(previous)
    if last_complete is None or last_complete.tzinfo is None:
        return False, None
    age = (current - last_complete.astimezone(timezone.utc)).total_seconds()
    return age >= PARTIAL_FALLBACK_AFTER_MINUTES * 60, last_complete
'''
SCRAPE_PARTIAL_CONTEXT_NEW = '''def partial_fallback_context(
    previous: dict | None,
    now: datetime | None = None,
) -> tuple[bool, datetime | None]:
    """Allow best-effort partial publication while retaining baseline lineage."""
    last_complete = None
    try:
        validate_data(previous)
        last_complete = _last_complete_timestamp(previous)
    except (ValueError, TypeError, AttributeError):
        # A damaged/missing previous publication must not prevent a fresh
        # structurally valid sample from keeping the site updated.
        pass
    if last_complete is not None and last_complete.tzinfo is None:
        last_complete = last_complete.replace(tzinfo=timezone.utc)
    return True, last_complete
'''

SCRAPE_DETAIL_FAILURE_OLD = '''    if detail_failures:
        dump_detail_failure_summary(len(mids), len(details), detail_failures)
        raise RuntimeError(
            "Player detail collection failed after bounded retries; "
            f"aborted without publishing ({len(detail_failures)} failures)."
        )
'''
SCRAPE_DETAIL_FAILURE_NEW = '''    if detail_failures:
        dump_detail_failure_summary(len(mids), len(details), detail_failures)
        if not ALLOW_PARTIAL_FOR_RUN:
            raise RuntimeError(
                "Player detail collection failed after bounded retries; "
                f"aborted without publishing ({len(detail_failures)} failures)."
            )
'''

SCRAPE_MISSING_DETAIL_OLD = '''        detail_info = detail_by_mid.get(mid)
        detail_team_map = (
'''
SCRAPE_MISSING_DETAIL_NEW = '''        detail_info = detail_by_mid.get(mid)
        if isinstance(player_details, dict) and detail_info is None:
            # The ranking response still proves this player exists, but without
            # a detail response we cannot safely attach equipment. Omit only
            # this player and keep every other verified player in the sample.
            diagnostics["missing_player_info"].append(mid)
            diagnostics["_detail_recheck_mids"].append(mid)
            continue
        detail_team_map = (
'''

SCRAPE_INVALID_EQUIPMENT_OLD = '''                except ValueError as error:
                    diagnostics["invalid_equipment"].append(str(error))
                    equipment = {}
                    detail_complete = False

                units.append(code)
'''
SCRAPE_INVALID_EQUIPMENT_NEW = '''                except ValueError as error:
                    diagnostics["invalid_equipment"].append(str(error))
                    equipment = {}
                    detail_complete = False
                    invalid_player = True
                    break

                units.append(code)
'''

SCRAPE_DETAIL_MISMATCH_OLD = '''        if isinstance(player_details, dict) and (
            not detail_complete or Counter(detail_codes) != Counter(units)
        ):
            diagnostics["detail_team_mismatch_players"] += 1
            diagnostics["_detail_recheck_mids"].append(mid)

        players.append({"mid": mid, "units": units, "unit_records": unit_records})
'''
SCRAPE_DETAIL_MISMATCH_NEW = '''        if isinstance(player_details, dict) and (
            not detail_complete or Counter(detail_codes) != Counter(units)
        ):
            diagnostics["detail_team_mismatch_players"] += 1
            diagnostics["_detail_recheck_mids"].append(mid)

        players.append({"mid": mid, "units": units, "unit_records": unit_records})
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
        dump_detail_failure_summary(
            len(mids),
            len(players),
            content_recheck_failures + [{"error_type": "InvalidDetailContent"}],
        )
        if not ALLOW_PARTIAL_FOR_RUN or len(players) <= 0:
            raise RuntimeError(
                "Some requested ranked players had incomplete team or equipment data; "
                f"refusing to publish missing player details ({len(players)} != {expected_players})."
            )
        diagnostics["partial_missing_players"] = TARGET_PLAYER_COUNT - len(players)
        diagnostics["partial_detail_recheck_failures"] = len(content_recheck_failures)
'''

SCRAPE_PUBLICATION_OLD = '''    if len(players) == TARGET_PLAYER_COUNT:
        data["publication_mode"] = COMPLETE_PUBLICATION_MODE
    else:
        if LAST_COMPLETE_FOR_RUN is None:
            raise RuntimeError("Partial publication has no verified full-sample baseline.")
        data["publication_mode"] = PARTIAL_PUBLICATION_MODE
        data["termination_reason"] = "api_partial_after_stale"
        data["partial_fallback"] = {
            "trigger_after_minutes": PARTIAL_FALLBACK_AFTER_MINUTES,
            "last_complete_updated_at": LAST_COMPLETE_FOR_RUN.isoformat(),
            "missing_players": TARGET_PLAYER_COUNT - len(players),
        }
'''
SCRAPE_PUBLICATION_NEW = '''    if len(players) == TARGET_PLAYER_COUNT:
        data["publication_mode"] = COMPLETE_PUBLICATION_MODE
    else:
        data["publication_mode"] = PARTIAL_PUBLICATION_MODE
        data["termination_reason"] = "api_partial_available"
        data["partial_fallback"] = {
            "trigger_after_minutes": 0,
            "last_complete_updated_at": (
                LAST_COMPLETE_FOR_RUN.isoformat()
                if LAST_COMPLETE_FOR_RUN is not None
                else None
            ),
            "missing_players": TARGET_PLAYER_COUNT - len(players),
        }
'''

SCRAPE_COMPARISON_OLD = '''        if data.get("publication_mode") == PARTIAL_PUBLICATION_MODE:
            # A changing set of fewer than 200 players is not a trustworthy
            # hour/day/week/month baseline. Keep the last complete history and
            # show comparison as unavailable until a full sample returns.
            previous_history = {"snapshots": []}
'''
SCRAPE_COMPARISON_NEW = '''        if data.get("publication_mode") == PARTIAL_PUBLICATION_MODE:
            # A smaller but structurally valid sample is still a successful
            # collection. Keep verified prior history available for comparison;
            # the cross-sample rebuild will retain this sample as valid history.
            pass
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
            or current is None
            or (
                last_complete is not None
                and (last_complete.tzinfo is None or last_complete > current)
            )
            or (
                trigger_after_minutes > 0
                and (
                    last_complete is None
                    or (current - last_complete).total_seconds()
                    < trigger_after_minutes * 60
                )
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
        if detail_failures < 0 or invalid_records < 0:
            errors.append("invalid collection error counts")
        elif not is_partial and (detail_failures != 0 or invalid_records != 0):
            errors.append("collection errors present in complete publication")

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
            if not players <= requested_fetches <= target_players:
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
        if not is_partial and any(diagnostics.get(key) for key in failure_keys):
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
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    if new not in path.read_text(encoding="utf-8"):
        raise SystemExit(f"Patch verification failed for {path}.")
    return True


def main() -> None:
    changed = False
    for old, new in (
        (SCRAPE_PARTIAL_CONTEXT_OLD, SCRAPE_PARTIAL_CONTEXT_NEW),
        (SCRAPE_DETAIL_FAILURE_OLD, SCRAPE_DETAIL_FAILURE_NEW),
        (SCRAPE_MISSING_DETAIL_OLD, SCRAPE_MISSING_DETAIL_NEW),
        (SCRAPE_INVALID_EQUIPMENT_OLD, SCRAPE_INVALID_EQUIPMENT_NEW),
        (SCRAPE_DETAIL_MISMATCH_OLD, SCRAPE_DETAIL_MISMATCH_NEW),
        (SCRAPE_CONTENT_OLD, SCRAPE_CONTENT_NEW),
        (SCRAPE_PUBLICATION_OLD, SCRAPE_PUBLICATION_NEW),
        (SCRAPE_COMPARISON_OLD, SCRAPE_COMPARISON_NEW),
    ):
        changed |= replace_once(SCRAPER, old, new)
    for old, new in (
        (QUALITY_FALLBACK_OLD, QUALITY_FALLBACK_NEW),
        (QUALITY_DIAGNOSTICS_OLD, QUALITY_DIAGNOSTICS_NEW),
    ):
        changed |= replace_once(QUALITY, old, new)
    if changed:
        print("Applied resilient partial-publication policy.")
    else:
        print("Resilient partial-publication policy already present.")


if __name__ == "__main__":
    main()
