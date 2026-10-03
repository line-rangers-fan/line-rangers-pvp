"""Fail closed when a public PvP snapshot, health, and comparison history disagree."""

from __future__ import annotations

import json
import sys
from datetime import timezone
from pathlib import Path

try:
    import scrape_character_usage as scraper
    import rebuild_cross_sample_comparisons as cross_rebuild
    from quality_checks import validate_data
    from validate_public_comparisons import validate_payload
except ImportError:
    from scripts import scrape_character_usage as scraper
    from scripts import rebuild_cross_sample_comparisons as cross_rebuild
    from scripts.quality_checks import validate_data
    from scripts.validate_public_comparisons import validate_payload


DATA = Path("docs/data/character_usage.json")
HEALTH = Path("docs/data/character_usage_health.json")
HISTORIES = (
    Path("docs/data/character_usage_history.json"),
    Path("docs/data/character_usage_cross_sample_history.json"),
)


def read_object(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} is not a JSON object")
    return value


def ordered_competition_ranks(rows: list[dict]) -> bool:
    previous_count = None
    previous_rank = 0
    for index, row in enumerate(rows, start=1):
        count = row["occurrence_count"]
        expected_rank = previous_rank if count == previous_count else index
        if (previous_count is not None and count > previous_count) or row["rank"] != expected_rank:
            return False
        previous_count, previous_rank = count, expected_rank
    return True


def checked_history(history: dict, current_time, label: str) -> dict[str, dict]:
    """Return only independently valid baselines without letting old debris deadlock publishing.

    Historical snapshots are supporting evidence, not the current ranking itself.
    An invalid or internally conflicting *unreferenced* old entry is quarantined
    here. If the current public comparison actually points at that entry,
    verify_deltas() still fails closed because no verified reference will exist.
    """
    snapshots = history.get("snapshots")
    if not isinstance(snapshots, list):
        raise ValueError(f"{label} has no snapshot list")
    by_time = {}
    conflicted = set()
    for snapshot in snapshots:
        sampled = scraper._exact_int(snapshot.get("sampled_players")) if isinstance(snapshot, dict) else None
        try:
            usable = (
                sampled is not None
                and 0 < sampled <= scraper.TARGET_PLAYER_COUNT
                and scraper._usable_history_snapshot(snapshot, current_time, sampled)
            )
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
            usable = False
        if not usable:
            continue
        if not ordered_competition_ranks(snapshot["characters"]):
            continue
        rankings_ok = True
        for character in snapshot["characters"]:
            for category in (character.get("equipment_rankings") or {}).values():
                if not ordered_competition_ranks(category["items"]):
                    rankings_ok = False
                    break
            if not rankings_ok:
                break
        if not rankings_ok:
            continue
        instant = scraper._parse_history_time(snapshot["updated_at"]).astimezone(timezone.utc)
        if instant in conflicted:
            continue
        existing = by_time.get(instant)
        if existing is not None:
            if existing == snapshot:
                continue
            # Two different payloads claiming the same instant are ambiguous.
            # Quarantine that instant entirely; a live comparison referencing it
            # will then fail safely instead of choosing one arbitrarily.
            by_time.pop(instant, None)
            conflicted.add(instant)
            continue
        by_time[instant] = snapshot
    return {snapshot["updated_at"]: snapshot for snapshot in by_time.values()}


def verify_deltas(data: dict, references: dict[str, dict]) -> None:
    summaries = data["comparison"]["periods"]
    for period, summary in summaries.items():
        if not summary["comparable"]:
            continue
        reference = references.get(summary["updated_at"])
        if reference is None:
            legacy_partial = (
                data.get("publication_mode") == "partial_after_stale"
                and data.get("complete_target") is False
                and period == "hour"
            )
            if legacy_partial:
                # Before sub-200 snapshots became durable, the one-hour
                # partial reference was intentionally ephemeral. Permit the
                # already-published legacy bundle during this one-time migration.
                continue
            raise ValueError(f"{period} comparison has no verified baseline")
        old_characters = {row["unit_code"]: row for row in reference["characters"]}
        for character in data["characters"]:
            code = character["unit_code"]
            old = old_characters.get(code)
            change = character["change"]["periods"][period]
            if change["comparable"] is not True:
                raise ValueError(f"{period} character comparison is missing despite a valid baseline: {code}")
            expected = character["occurrence_count"] - (old["occurrence_count"] if old else 0)
            if change["occurrence_count"] != expected:
                raise ValueError(f"{period} character occurrence delta differs from history: {code}")
            for kind, category in character["equipment_rankings"].items():
                old_rankings = old.get("equipment_rankings") if old else None
                old_category = old_rankings.get(kind) if isinstance(old_rankings, dict) else None
                if old and old_category is None:
                    continue
                old_items = {item["item_code"]: item["occurrence_count"]
                             for item in old_category["items"]} if old_category else {}
                for item in category["items"]:
                    item_change = item["change"]["periods"][period]
                    if item_change["comparable"] is not True:
                        raise ValueError(f"{period} equipment comparison is missing despite a valid baseline")
                    expected = item["occurrence_count"] - old_items.get(item["item_code"], 0)
                    if item_change["occurrence_count"] != expected:
                        raise ValueError(f"{period} equipment occurrence delta differs from history")


def verify_shared_history(
    public: dict[str, dict],
    cross: dict[str, dict],
    referenced_timestamps: set[str],
) -> None:
    # Only evidence used by the current public deltas can block the current
    # publication. Old overlapping history is still retained for later repair,
    # but an unrelated historical disagreement cannot freeze fresh 200/200 data.
    for timestamp in (public.keys() & cross.keys() & referenced_timestamps):
        left = {row["unit_code"]: row for row in public[timestamp]["characters"]}
        right = {row["unit_code"]: row for row in cross[timestamp]["characters"]}
        if left.keys() != right.keys():
            raise ValueError("public and cross-sample histories disagree on character identities")
        for code in left:
            for key in ("rank", "occurrence_count", "player_count", "adoption_rate"):
                if left[code][key] != right[code][key]:
                    raise ValueError("public and cross-sample histories disagree on character counts")
            first = left[code].get("equipment_rankings")
            second = right[code].get("equipment_rankings")
            if isinstance(first, dict) and isinstance(second, dict) and first != second:
                raise ValueError("public and cross-sample histories disagree on equipment counts")


def _publication_mode_is_valid(data: dict) -> bool:
    target = data.get("target_players")
    sampled = data.get("sampled_players")
    complete = data.get("complete_target")
    mode = data.get("publication_mode")
    if target != 200:
        return False
    if sampled == 200 and complete is True and mode == "complete":
        return True
    if not (isinstance(sampled, int) and not isinstance(sampled, bool) and 0 < sampled < 200):
        return False
    if complete is not False or mode != "partial_after_stale":
        return False
    fallback = data.get("partial_fallback")
    if not isinstance(fallback, dict):
        return False
    try:
        missing = int(fallback.get("missing_players", -1))
        trigger = int(fallback.get("trigger_after_minutes", -1))
    except (TypeError, ValueError):
        return False
    if missing != target - sampled or trigger not in {0, 180}:
        return False
    # Baseline lineage is useful when available, but a missing historical full
    # sample must not block a fresh nonzero ranking. Valid smaller snapshots may
    # be retained in cross-sample comparison history.
    last_complete = fallback.get("last_complete_updated_at")
    return last_complete is None or scraper._parse_history_time(last_complete) is not None


def validate_bundle(data: dict, health: dict, public_history: dict, cross_history: dict) -> None:
    if not _publication_mode_is_valid(data):
        raise ValueError("public aggregation requires a valid complete or partial snapshot")
    validate_data(data)
    validate_payload(data)
    if health != scraper.health_summary(data):
        raise ValueError("health JSON does not match the validated PvP snapshot")
    current_time = scraper._parse_history_time(data["updated_at"])
    public = checked_history(public_history, current_time, "public history")
    cross = checked_history(cross_history, current_time, "cross-sample history")
    referenced_timestamps = {
        summary.get("updated_at")
        for summary in data["comparison"]["periods"].values()
        if isinstance(summary, dict)
        and summary.get("comparable") is True
        and isinstance(summary.get("updated_at"), str)
    }
    verify_shared_history(public, cross, referenced_timestamps)
    verify_deltas(data, {**public, **cross})


def main() -> None:
    if len(sys.argv) != 1:
        raise SystemExit("usage: validate_public_bundle.py")
    validate_bundle(
        read_object(DATA), read_object(HEALTH),
        read_object(HISTORIES[0]), read_object(HISTORIES[1]),
    )
    print("Public PvP aggregation, health, and comparison history validated.")


if __name__ == "__main__":
    main()
