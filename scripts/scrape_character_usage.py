"""Build Legend PvP character and equipment statistics from public API data.

The ranking endpoint lists the current Legend players and their defence teams.
Each ranked player is then fetched from /api/getPlayer/{mid}, because that
detail response contains the equipment attached to every character. Both
visible pvpteam groups are included: they form one player's ten-character
defence formation.
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http.client import HTTPException, HTTPResponse, HTTPSConnection
from pathlib import Path
from statistics import median
from time import monotonic, sleep, time_ns
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from zoneinfo import ZoneInfo

try:
    from quality_checks import (
        CALENDAR_CLOSE_REFERENCE_MODE,
        COMPLETE_PUBLICATION_MODE,
        EQUIPMENT_TYPES,
        MAX_COLLECTION_DURATION_SECONDS,
        PARTIAL_FALLBACK_AFTER_MINUTES,
        PARTIAL_PUBLICATION_MODE,
        SCHEMA_VERSION,
        assign_competition_ranks,
        equipment_rankings,
        validate_data,
    )
except ImportError:
    from scripts.quality_checks import (
        CALENDAR_CLOSE_REFERENCE_MODE,
        COMPLETE_PUBLICATION_MODE,
        EQUIPMENT_TYPES,
        MAX_COLLECTION_DURATION_SECONDS,
        PARTIAL_FALLBACK_AFTER_MINUTES,
        PARTIAL_PUBLICATION_MODE,
        SCHEMA_VERSION,
        assign_competition_ranks,
        equipment_rankings,
        validate_data,
    )


TARGET_URL = "https://rangers.lerico.net/ja/pvp-tracker"
SOURCE_NAME = "LINE Rangers Handbook PvP Tracker"
LEAGUE = "LEGEND"
API_URL_TEMPLATE = "https://rangers.lerico.net/api/v2/pvp/league/rank/{league}"
PLAYER_API_URL_TEMPLATE = "https://rangers.lerico.net/api/getPlayer/{mid}"
TRANSLATE_API_URL = "https://rangers.lerico.net/api/v2/translate"
UNIT_TRANSLATE_KEY = "ja:UNIT"
SOURCE_HOST = "rangers.lerico.net"
SOURCE_STALE_AFTER_MINUTES = 180


def read_bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.environ.get(name, "")
    try:
        value = int(str(raw_value).strip()) if str(raw_value).strip() else default
    except (TypeError, ValueError):
        return default
    return min(maximum, max(minimum, value))


TARGET_PLAYER_COUNT = read_bounded_env_int("TARGET_PLAYER_COUNT", 200, 1, 500)
PLAYER_FETCH_WORKERS = read_bounded_env_int("PLAYER_FETCH_WORKERS", 3, 1, 4)
MIN_CHARACTERS_PER_PLAYER = 1
MAX_CHARACTERS_PER_PLAYER = 10
REQUEST_TIMEOUT_SECONDS = read_bounded_env_int("REQUEST_TIMEOUT_SECONDS", 15, 5, 30)
MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024
REQUEST_ATTEMPTS = read_bounded_env_int("REQUEST_ATTEMPTS", 5, 1, 6)
DETAIL_FETCH_ROUNDS = read_bounded_env_int("DETAIL_FETCH_ROUNDS", 2, 1, 3)
DETAIL_CONTENT_RECHECKS = read_bounded_env_int("DETAIL_CONTENT_RECHECKS", 1, 0, 2)
OUTPUT_PATH = Path("docs/data/character_usage.json")
HISTORY_PATH = Path("docs/data/character_usage_history.json")
HEALTH_PATH = Path("docs/data/character_usage_health.json")
HISTORY_RECENT_HOURS = 6
HISTORY_CLOSE_RETENTION_DAYS = 40
HISTORY_LIMIT = 96
HISTORY_TIME_ZONE = ZoneInfo("Asia/Tokyo")
CALENDAR_CLOSE_START_HOUR = 22
CALENDAR_CLOSE_END_HOUR = 23
RANK_COMPARISON_PERIODS = {
    "hour": 60 * 60,
    "day": 24 * 60 * 60,
    "week": 7 * 24 * 60 * 60,
    "month": 31 * 24 * 60 * 60,
}
RANK_COMPARISON_MIN_RATIO = 0.50
RANK_COMPARISON_MAX_RATIO = 1.50
DEBUG_DIR = Path(".artifacts/debug")
ALLOW_PARTIAL_FOR_RUN = False
LAST_COMPLETE_FOR_RUN: datetime | None = None
UNIT_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
PLAYER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")

# ---------------------------------------------------------------------------
# Existing collector implementation continues below. The recovery-specific
# behavior is intentionally kept fail-closed: complete 200/200 is preferred,
# but a validated stale partial may be published when the source cannot supply
# every player detail.
# ---------------------------------------------------------------------------
