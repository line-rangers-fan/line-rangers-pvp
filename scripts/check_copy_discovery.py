"""Read-only health check for the Copy repository's character discovery loop."""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


REPOSITORY = "nyu1791-collab/copy-LINE-"
API_REF = f"https://api.github.com/repos/{REPOSITORY}/git/ref/heads/main"
RAW_BASE = f"https://raw.githubusercontent.com/{REPOSITORY}"
STATE_PATH = "data/community-character-discovery.json"
SNAPSHOT_PATH = "public/pvp/data/character_usage.json"
REGISTRY_PATH = "config/community-characters.json"
SHA = re.compile(r"[a-f0-9]{40}")
MAX_BODY = 2_000_000


class DiscoveryHealthError(ValueError):
    pass


def fetch_json(url, opener=urlopen):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "line-rangers-discovery-watchdog"})
    with opener(request, timeout=15) as response:
        body = response.read(MAX_BODY + 1)
    if len(body) > MAX_BODY:
        raise DiscoveryHealthError("remote response exceeded the size limit")
    return json.loads(body)


def parse_time(value):
    if not isinstance(value, str):
        raise DiscoveryHealthError("missing discovery timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise DiscoveryHealthError("invalid discovery timestamp") from error
    if parsed.tzinfo is None:
        raise DiscoveryHealthError("discovery timestamp has no timezone")
    return parsed.astimezone(timezone.utc)


def assess(state, snapshot, registry, *, now, max_age=timedelta(hours=6)):
    if not isinstance(state, dict) or state.get("schemaVersion") != 1 or state.get("initialized") is not True:
        raise DiscoveryHealthError("discovery baseline is not initialized")
    if state.get("catalogInitialized") is not True or not isinstance(state.get("knownCatalogIds"), list) or not state["knownCatalogIds"]:
        raise DiscoveryHealthError("official catalog baseline is missing")
    if state.get("catalogStatus") != "verified" or state.get("releaseNoticeStatus") != "verified":
        raise DiscoveryHealthError("official catalog or release notice verification failed")
    if not isinstance(state.get("candidates"), dict):
        raise DiscoveryHealthError("discovery candidate state is invalid")
    if not isinstance(snapshot, dict) or (
        snapshot.get("complete_target") is not True
        or type(snapshot.get("target_players")) is not int
        or type(snapshot.get("sampled_players")) is not int
        or snapshot["target_players"] != 200
        or snapshot["sampled_players"] != 200
        or not isinstance(snapshot.get("characters"), list)
    ):
        raise DiscoveryHealthError("Copy snapshot is not a complete 200/200 sample")
    if not isinstance(registry, dict) or registry.get("schemaVersion") != 1 or not isinstance(registry.get("characters"), list):
        raise DiscoveryHealthError("community topic registry is invalid")
    seen_at = parse_time(state.get("lastSnapshotAt"))
    if seen_at != parse_time(snapshot.get("updated_at")):
        raise DiscoveryHealthError("discovery state and complete snapshot are out of sync")
    age = now.astimezone(timezone.utc) - seen_at
    if age < -timedelta(minutes=15):
        raise DiscoveryHealthError("discovery snapshot is timestamped in the future")
    if age > max_age:
        raise DiscoveryHealthError(f"discovery has not advanced for {age}; limit {max_age}")
    month = now.astimezone(ZoneInfo("Asia/Tokyo")).strftime("%Y-%m")
    topics = [row for row in registry["characters"] if isinstance(row, dict) and row.get("releaseMonth") == month and row.get("confirmed") is True]
    if len({row.get("id") for row in topics}) != len(topics):
        raise DiscoveryHealthError("duplicate confirmed monthly community topics")
    return {"last_snapshot_at": seen_at.isoformat(), "age_minutes": round(age.total_seconds() / 60, 1),
            "known_catalog_ids": len(state["knownCatalogIds"]), "pending_candidates": len(state["candidates"]),
            "confirmed_topics": len(topics), "month": month}


def check_remote(*, now=None, opener=urlopen, max_age=timedelta(hours=6)):
    reference = fetch_json(API_REF, opener)
    sha = reference.get("object", {}).get("sha") if isinstance(reference, dict) else None
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise DiscoveryHealthError("could not resolve Copy main commit")
    state, snapshot, registry = (
        fetch_json(f"{RAW_BASE}/{sha}/{path}", opener)
        for path in (STATE_PATH, SNAPSHOT_PATH, REGISTRY_PATH)
    )
    return sha, assess(state, snapshot, registry, now=now or datetime.now(timezone.utc), max_age=max_age)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-age-minutes", type=int, default=360)
    args = parser.parse_args()
    if not 0 < args.max_age_minutes <= 1440:
        parser.error("max age must be between 1 and 1440 minutes")
    try:
        sha, result = check_remote(max_age=timedelta(minutes=args.max_age_minutes))
    except (DiscoveryHealthError, OSError, ValueError, TypeError, KeyError) as error:
        print(f"::error::Copy community discovery needs attention: {error}", file=sys.stderr)
        return 1
    summary = (f"Copy `{sha[:12]}`: verified 200/200 discovery at {result['last_snapshot_at']} "
               f"({result['age_minutes']} min old); catalog {result['known_catalog_ids']}, "
               f"pending {result['pending_candidates']}, {result['month']} boards {result['confirmed_topics']}.")
    print(summary)
    import os
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(summary + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
