"""Read-only watchdog for verified character topics published to Production."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Callable


COPY_REGISTRY_URL = (
    "https://raw.githubusercontent.com/nyu1791-collab/copy-LINE-/main/"
    "config/community-characters.json"
)
PRODUCTION_BASE_URL = (
    "https://line-rangers-pvp-community-production.n-yu1791.workers.dev"
)
MAX_RESPONSE_BYTES = 1_000_000
SAFE_TOPIC_ID = re.compile(r"^u\d+e-[a-z0-9_-]+$", re.IGNORECASE)


class PublicationCheckError(ValueError):
    """The registry or Production manifest is malformed or inconsistent."""


def current_jst_month(now: dt.datetime | None = None) -> str:
    current = now or dt.datetime.now(dt.timezone.utc)
    return current.astimezone(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m")


def _safe_name(value: Any, field: str, required: bool) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 80:
        raise PublicationCheckError(f"invalid community topic {field}")
    return value.strip()


def _project_topics(rows: Any, month: str, *, registry_rows: bool) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        raise PublicationCheckError("community topics must be an array")

    projected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for topic in rows:
        if not isinstance(topic, dict):
            raise PublicationCheckError("community topic must be an object")
        if registry_rows and topic.get("releaseMonth") != month:
            continue
        if registry_rows and topic.get("confirmed") is not True:
            continue

        topic_id = topic.get("id")
        if not isinstance(topic_id, str) or not SAFE_TOPIC_ID.fullmatch(topic_id):
            raise PublicationCheckError("invalid confirmed community topic ID")
        if topic_id in seen:
            raise PublicationCheckError("duplicate confirmed community topic ID")
        seen.add(topic_id)

        auto_topic = topic.get("source") == "pvp-auto"
        pvp_rank = topic.get("pvpRank")
        if pvp_rank is not None and (type(pvp_rank) is not int or pvp_rank < 1):
            raise PublicationCheckError(f"invalid PvP rank for {topic_id}")
        if registry_rows:
            skills_verified = topic.get("skillsVerified") is True if auto_topic else None
        else:
            skills_verified = topic.get("skillsVerified")
            if skills_verified is not None and type(skills_verified) is not bool:
                raise PublicationCheckError(f"invalid skill verification value for {topic_id}")
        if registry_rows and auto_topic and not skills_verified:
            raise PublicationCheckError(f"automatic topic {topic_id} has unverified skills")

        projected.append(
            {
                "id": topic_id,
                "name": _safe_name(topic.get("name"), "name", True),
                "nameEn": _safe_name(topic.get("nameEn"), "nameEn", False),
                "nameZh": _safe_name(topic.get("nameZh"), "nameZh", False),
                "nameTh": _safe_name(topic.get("nameTh"), "nameTh", False),
                "pvpRank": pvp_rank,
                "skillsVerified": skills_verified,
            }
        )
    return sorted(projected, key=lambda item: item["id"])


def expected_topics(registry: Any, month: str) -> list[dict[str, Any]]:
    if (
        not isinstance(registry, dict)
        or registry.get("schemaVersion") != 1
        or not isinstance(registry.get("characters"), list)
    ):
        raise PublicationCheckError("invalid community character registry")
    return _project_topics(registry["characters"], month, registry_rows=True)


def actual_topics(manifest: Any, month: str) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict) or manifest.get("month") != month:
        raise PublicationCheckError("Production manifest month mismatch")
    return _project_topics(manifest.get("characters"), month, registry_rows=False)


def publication_drift(registry: Any, manifest: Any, month: str) -> bool:
    return expected_topics(registry, month) != actual_topics(manifest, month)


def fetch_json(
    url: str,
    *,
    opener: Callable[..., Any] = urllib.request.urlopen,
    attempts: int = 3,
    timeout: int = 12,
) -> Any:
    last_error: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "line-rangers-community-watchdog/1.0"},
            method="GET",
        )
        try:
            with opener(request, timeout=timeout) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise PublicationCheckError("watchdog response exceeds size limit")
                return json.loads(body)
        except (
            urllib.error.URLError,
            TimeoutError,
            UnicodeError,
            json.JSONDecodeError,
        ) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(min(2**attempt, 4))
    raise PublicationCheckError(f"read-only manifest request failed: {last_error}")


def check_remote(
    month: str,
    *,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> bool:
    from urllib.parse import quote

    nonce = str(int(time.time()))
    registry = fetch_json(COPY_REGISTRY_URL, opener=opener)
    manifest_url = (
        f"{PRODUCTION_BASE_URL}/api/community-topics?month={quote(month)}"
        f"&watch={nonce}"
    )
    manifest = fetch_json(manifest_url, opener=opener)
    return publication_drift(registry, manifest, month)


def write_github_output(path: str, drift: bool) -> None:
    with open(path, "a", encoding="utf-8") as output:
        output.write(f"community_drift={'true' if drift else 'false'}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"))
    args = parser.parse_args()
    month = current_jst_month()
    try:
        drift = check_remote(month)
    except (PublicationCheckError, OSError) as error:
        message = str(error).replace("\n", " ")
        print(f"::error::Community manifest watchdog could not verify Production: {message}")
        print("No sync was dispatched; the failed run is visible and the next scheduled check will retry.")
        if args.github_output:
            with open(args.github_output, "a", encoding="utf-8") as output:
                output.write("community_drift=unknown\n")
        return 1

    if args.github_output:
        write_github_output(args.github_output, drift)
    if drift:
        print(f"Verified registry differs from the read-only Production manifest for {month}.")
    else:
        print(f"Production manifest matches the verified registry for {month}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
