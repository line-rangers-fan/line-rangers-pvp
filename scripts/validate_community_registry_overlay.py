"""Guard a data-only monthly community registry overlay on pinned Worker code.

Usage: python scripts/validate_community_registry_overlay.py PINNED CANDIDATE
The caller verifies the two exact git commits and their ancestry first.
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ALLOWED = {
    # Schedule-only edits to Copy's automation are never copied into the
    # pinned Worker source. Permit this exact path so safe registry/data
    # overlays do not remain blocked after discovery cadence changes.
    ".github/workflows/refresh-pvp-data.yml",
    "config/community-characters.json",
    "data/community-character-discovery.json",
    "public/pvp/data/character_usage.json",
    "public/pvp/data/character_usage_history.json",
}
TOPICS = "config/community-characters.json"
STATE = "data/community-character-discovery.json"
SNAPSHOT = "public/pvp/data/character_usage.json"
ID = re.compile(r"u\d+e-[a-z0-9_-]+", re.I)
MONTH = re.compile(r"20\d\d-(?:0[1-9]|1[0-2])")


def read(root, path):
    return json.loads((root / path).read_text(encoding="utf-8"))


def date(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a time zone")
    return parsed


def topic_map(registry):
    if registry.get("schemaVersion") != 1 or not isinstance(registry.get("characters"), list):
        raise ValueError("invalid community topic registry")
    result = {}
    for topic in registry["characters"]:
        if not isinstance(topic, dict):
            raise ValueError("invalid community topic")
        unit, month = topic.get("id"), topic.get("releaseMonth")
        if not isinstance(unit, str) or not ID.fullmatch(unit) or not isinstance(month, str) or not MONTH.fullmatch(month):
            raise ValueError("invalid community topic identity")
        key = (month, unit)
        if key in result:
            raise ValueError("duplicate community topic")
        result[key] = topic
    return result


def validate_overlay(pinned, candidate, changed_files):
    if not changed_files or set(changed_files) - ALLOWED:
        raise ValueError("copy main contains non-generated changes since the pinned code; promote code separately")
    old = topic_map(read(pinned, TOPICS))
    new = topic_map(read(candidate, TOPICS))
    snapshot = read(candidate, SNAPSHOT)
    if snapshot.get("target_players") != 200 or snapshot.get("sampled_players") != 200 or snapshot.get("complete_target") is not True:
        raise ValueError("candidate PvP snapshot is not 200/200")
    now = date(snapshot["updated_at"])
    from zoneinfo import ZoneInfo
    release_month = now.astimezone(ZoneInfo("Asia/Tokyo")).strftime("%Y-%m")
    for key, original in old.items():
        replacement = new.get(key)
        if replacement is None:
            raise ValueError("previously confirmed topic was removed")
        # The collector may refresh ordering from PvP; identity and existing
        # metadata remain immutable, including archived months and posts.
        for field in set(original) | set(replacement):
            if field not in {"pvpRank", "adoptionRate"}:
                if replacement.get(field) != original.get(field):
                    raise ValueError("existing community topic metadata changed: " + key[1])
        rank = replacement.get("pvpRank")
        rate = replacement.get("adoptionRate")
        if rank is not None and (type(rank) is not int or rank < 1):
            raise ValueError("invalid topic rank")
        if rate is not None and (type(rate) not in (int, float) or not 0 <= rate <= 100):
            raise ValueError("invalid topic adoption rate")
    for key, topic in new.items():
        if key in old:
            continue
        if key[0] != release_month or topic.get("source") != "pvp-auto" or topic.get("confirmed") is not True:
            raise ValueError("unverified monthly topic addition")
        if topic.get("skillsVerified") is not True or type(topic.get("skillCount")) is not int or not 1 <= topic["skillCount"] <= 3:
            raise ValueError("new topic is missing verified skills")
        if type(topic.get("observationCount")) is not int or topic["observationCount"] < 3:
            raise ValueError("new topic lacks three complete observations")
        date(topic["skillsVerifiedAt"])
        if topic.get("image") != "https://rangers.lerico.net/res/" + key[1] + "/" + key[1] + "-thum.png":
            raise ValueError("new topic has an untrusted image")
        for name in ("name", "nameEn", "nameZh"):
            if not isinstance(topic.get(name), str) or not topic[name].strip():
                raise ValueError("new topic is missing a localized name")
        if topic.get("metadataSource") != "rangers.lerico.net/api/getRangersBasics" or topic.get("evolutionStage") != "e":
            raise ValueError("new topic lacks official Ranger verification")
    previous_state, next_state = read(pinned, STATE), read(candidate, STATE)
    if previous_state.get("initialized") is True and next_state.get("initialized") is not True:
        raise ValueError("community discovery state was reset")
    if previous_state.get("catalogInitialized") is True and next_state.get("catalogInitialized") is not True:
        raise ValueError("official catalog baseline was reset")
    for key in ("knownIds", "knownCatalogIds"):
        before, after = previous_state.get(key, []), next_state.get(key, [])
        if not isinstance(before, list) or not isinstance(after, list) or not set(before).issubset(after):
            raise ValueError("known character identities were removed")
    if previous_state.get("lastSnapshotAt") and date(next_state["lastSnapshotAt"]) < date(previous_state["lastSnapshotAt"]):
        raise ValueError("community snapshot moved backwards")
    return len(new) - len(old)


def main():
    pinned, candidate = map(Path, sys.argv[1:3])
    changed = subprocess.check_output(
        ["git", "-C", str(pinned), "diff", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD", "refs/remotes/origin/community-candidate", "--"],
        text=True,
    ).splitlines()
    added = validate_overlay(pinned, candidate, changed)
    print(f"Validated append-only community registry overlay: {added} new character board(s)")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print("Community registry overlay blocked: " + str(error), file=sys.stderr)
        sys.exit(1)
