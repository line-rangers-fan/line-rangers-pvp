"""Read-only watchdog for verified character topics published to Production."""

# Manual recovery marker: touching this watched path deliberately runs the
# freshness watchdog, which dispatches the collector when the snapshot is stale.

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