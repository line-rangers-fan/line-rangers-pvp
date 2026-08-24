# File: scripts/scrape_character_usage.py
"""
LINE Rangers HandbookのPvP Trackerから、
レジェンド帯プレイヤーの防衛チームを集計する。

集計仕様:
    occurrence_count:
        同一プレイヤー内の重複を含むキャラクター総編成数。

    player_count:
        対象キャラクターを1体以上編成しているプレイヤー数。

    adoption_rate:
        player_count / sampled_players * 100。

同じキャラクターを1人が複数体使用している場合:
    occurrence_countには体数分を加算する。
    player_countには1人分だけ加算する。

重要:
    キャラクターを1体以上取得できたプレイヤーを集計対象にする。
    1プレイヤーにつき最大10体まで取得する。
    200人に到達しても、遅延画像の読み込みが完了するまで巡回する。
    表示用画像URLは変換せず、ブラウザーで有効なURLを保持する。
"""

import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from urllib.parse import (
    parse_qsl,
    unquote,
    urlencode,
    urljoin,
    urlsplit,
    urlunsplit,
)

from playwright.sync_api import (
    Error as PlaywrightError,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)


TARGET_URL = "https://rangers.lerico.net/ja/pvp-tracker"
SOURCE_NAME = "LINE Rangers Handbook PvP Tracker"

TARGET_PLAYER_COUNT = int(
    os.environ.get("TARGET_PLAYER_COUNT", "200")
)

MIN_REQUIRED_PLAYERS = int(
    os.environ.get("MIN_REQUIRED_PLAYERS", "50")
)

# 1体以上取得できれば、そのプレイヤーを集計対象にする。
MIN_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MIN_CHARACTERS_PER_PLAYER", "1")
)

# 1人あたりの編成上限。
MAX_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MAX_CHARACTERS_PER_PLAYER", "10")
)

MAX_PAGES = int(
    os.environ.get("MAX_PAGES", "30")
)

MAX_LOAD_ATTEMPTS = int(
    os.environ.get("MAX_LOAD_ATTEMPTS", "300")
)

STABLE_ATTEMPTS_LIMIT = int(
    os.environ.get("STABLE_ATTEMPTS_LIMIT", "8")
)

NEXT_PAGE_STABLE_ATTEMPTS = int(
    os.environ.get("NEXT_PAGE_STABLE_ATTEMPTS", "3")
)

CONTENT_CHANGE_TIMEOUT_MS = int(
    os.environ.get("CONTENT_CHANGE_TIMEOUT_MS", "1500")
)

ACTION_SETTLE_MS = int(
    os.environ.get("ACTION_SETTLE_MS", "200")
)

DEFAULT_TIMEOUT_MS = int(
    os.environ.get("DEFAULT_TIMEOUT_MS", "10000")
)

PAGE_NAVIGATION_TIMEOUT_MS = int(
    os.environ.get("PAGE_NAVIGATION_TIMEOUT_MS", "20000")
)

DEBUG = os.environ.get("DEBUG", "0") == "1"
HEADLESS = os.environ.get("HEADLESS", "1") != "0"

OUTPUT_PATH = Path(
    os.environ.get(
        "OUTPUT_PATH",
        "docs/data/character_usage.json",
    )
)

DEBUG_DIR = Path(
    os.environ.get(
        "DEBUG_DIR",
        ".artifacts/debug",
    )
)

ROW_SELECTORS = [
    "table tbody tr",
    "[role='rowgroup'] [role='row']",
    ".ranking-table tbody tr",
    ".ranking-list .ranking-row",
    ".player-list .player-row",
    ".player-card",
    "[data-player-id]",
    "[class*='ranking'] [class*='row']",
    "[class*='player'] [class*='row']",
]

TEAM_CONTAINER_SELECTORS = [
    "[data-team='defense']",
    "[data-team='defence']",
    "[data-type='defense']",
    "[data-type='defence']",
    "[aria-label*='defense' i]",
    "[aria-label*='defence' i]",
    "[aria-label*='防衛']",
    ".defense-team",
    ".defence-team",
    "[class*='defense-team']",
    "[class*='defence-team']",
    "[class*='defense'] [class*='team']",
    "[class*='defence'] [class*='team']",
    ".team-formation",
    ".ranger-team",
    "[class*='formation']",
]

PLAYER_NAME_SELECTORS = [
    "[data-player-name]",
    ".player-name",
    "[class*='player-name']",
    ".username",
    "[class*='username']",
]

LOAD_MORE_SELECTORS = [
    "button:has-text('もっと見る')",
    "a:has-text('もっと見る')",
    "button:has-text('さらに表示')",
    "a:has-text('さらに表示')",
    "button:has-text('Load more')",
    "a:has-text('Load more')",
    "button:has-text('Show more')",
    "a:has-text('Show more')",
    "[class*='load-more'] button",
    "[class*='load-more'] a",
]

NEXT_PAGE_SELECTORS = [
    "button[aria-label='Go to next page']",
    "a[aria-label='Go to next page']",
    "button[aria-label*='next' i]",
    "a[aria-label*='next' i]",
    "button[title*='next' i]",
    "a[title*='next' i]",
    "button[rel='next']",
    "a[rel='next']",
    "button:has-text('次へ')",
    "a:has-text('次へ')",
    "button:has-text('Next')",
    "a:has-text('Next')",
    "button:has-text('›')",
    "a:has-text('›')",
    "button:has-text('»')",
    "a:has-text('»')",
    ".pagination-next button",
    ".pagination-next a",
    ".pagination .next button",
    ".pagination .next a",
    "[class*='pagination'] [class*='next']",
]

EXCLUDED_SOURCE_WORDS = {
    "avatar",
    "badge",
    "banner",
    "country",
    "emoji",
    "flag",
    "guild",
    "league",
    "logo",
    "profile",
    "rank",
    "tier",
    "user",
}

EXCLUDED_CONTEXT_WORDS = {
    "avatar",
    "badge",
    "country",
    "flag",
    "guild",
    "league",
    "player-icon",
    "profile",
    "rank-icon",
    "user-icon",
}

PLACEHOLDER_IMAGE_WORDS = {
    "blank",
    "default",
    "fallback",
    "loading",
    "placeholder",
    "spinner",
    "transparent",
}

TRACKING_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "fbclid",
    "gclid",
}

IMAGE_TRANSFORM_QUERY_KEYS = {
    "dpr",
    "fit",
    "fm",
    "format",
    "h",
    "height",
    "q",
    "quality",
    "resize",
    "w",
    "width",
}

WRAPPED_IMAGE_QUERY_KEYS = {
    "url",
    "src",
    "image",
    "image_url",
}

_NON_WORD_CHARACTERS = re.compile(r"[^a-z0-9]+")
_SPACE_CHARACTERS = re.compile(r"\s+")

MAX_EXCLUSION_LOG_ENTRIES = 500
EXCLUSION_LOG: list[dict] = []


def _log_exclusion(
    reason: str,
    src: str,
    width: int = 0,
    height: int = 0,
    context: str = "",
) -> None:
    if len(EXCLUSION_LOG) >= MAX_EXCLUSION_LOG_ENTRIES:
        return

    EXCLUSION_LOG.append(
        {
            "reason": reason,
            "src": src,
            "width": width,
            "height": height,
            "context": context,
        }
    )


def _extract_words(value: str) -> set[str]:
    return {
        token
        for token in _NON_WORD_CHARACTERS.split(
            (value or "").lower()
        )
        if token
    }


def normalize_text(value: str) -> str:
    return _SPACE_CHARACTERS.sub(
        " ",
        value or "",
    ).strip()


def save_json(path: Path, value) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with path.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            value,
            file,
            ensure_ascii=False,
            indent=2,
        )
        file.write("\n")


def resolve_display_image_url(url: str) -> str:
    if not url:
        return ""

    value = url.strip()

    if not value:
        return ""

    lower_value = value.lower()

    if lower_value.startswith(
        (
            "data:",
            "blob:",
            "javascript:",
            "about:",
        )
    ):
        return ""

    absolute_url = urljoin(
        TARGET_URL,
        value,
    )

    parts = urlsplit(absolute_url)

    if parts.scheme.lower() not in {
        "http",
        "https",
    }:
        return ""

    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path,
            parts.query,
            "",
        )
    )


def parse_srcset_urls(value: str) -> list[tuple[str, float]]:
    if not value:
        return []

    candidates: list[tuple[str, float, int]] = []

    for position, part in enumerate(value.split(",")):
        fields = part.strip().split()

        if not fields:
            continue

        source = fields[0].strip()

        if not source:
            continue

        descriptor = (
            fields[1].strip().lower()
            if len(fields) >= 2
            else ""
        )

        score = 0.0

        try:
            if descriptor.endswith("w"):
                score = float(descriptor[:-1])
            elif descriptor.endswith("x"):
                score = float(descriptor[:-1]) * 10_000
        except ValueError:
            score = 0.0

        candidates.append(
            (
                source,
                score,
                position,
            )
        )

    candidates.sort(
        key=lambda item: (
            item[1],
            item[2],
        ),
        reverse=True,
    )

    return [
        (
            source,
            score,
        )
        for source, score, _ in candidates
    ]


def is_placeholder_image_url(url: str) -> bool:
    if not url:
        return True

    parts = urlsplit(url)

    words = _extract_words(
        f"{parts.netloc} {parts.path}"
    )

    return bool(
        words & PLACEHOLDER_IMAGE_WORDS
    )


def unwrap_image_url_for_key(url: str) -> str:
    current = resolve_display_image_url(url)

    for _ in range(3):
        if not current:
            return ""

        parts = urlsplit(current)
        path = parts.path.lower()

        is_known_proxy = (
            path.endswith("/_next/image")
            or "/_next/image/" in path
            or "/image-proxy/" in path
            or "/image_proxy/" in path
        )

        if not is_known_proxy:
            return current

        wrapped_url = ""

        for key, value in parse_qsl(
            parts.query,
            keep_blank_values=True,
        ):
            if key.lower() not in WRAPPED_IMAGE_QUERY_KEYS:
                continue

            decoded = unquote(value).strip()

            if decoded:
                wrapped_url = decoded
                break

        if not wrapped_url:
            return current

        current = resolve_display_image_url(
            wrapped_url
        )

    return current


def canonicalize_image_url(url: str) -> str:
    unwrapped_url = unwrap_image_url_for_key(url)

    if not unwrapped_url:
        return ""

    parts = urlsplit(unwrapped_url)
    filtered_query = []

    for key, value in parse_qsl(
        parts.query,
        keep_blank_values=True,
    ):
        lower_key = key.lower()

        if lower_key in TRACKING_QUERY_KEYS:
            continue

        if lower_key in IMAGE_TRANSFORM_QUERY_KEYS:
            continue

        filtered_query.append(
            (
                key,
                value,
            )
        )

    filtered_query.sort(
        key=lambda item: (
            item[0],
            item[1],
        )
    )

    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path,
            urlencode(
                filtered_query,
                doseq=True,
            ),
            "",
        )
    )


def character_key(image_url: str) -> str:
    normalized = canonicalize_image_url(
        image_url
    )

    if normalized:
        return normalized

    return "unknown"


def is_disabled(locator) -> bool:
    try:
        disabled = locator.get_attribute("disabled")
        aria_disabled = locator.get_attribute("aria-disabled")
        class_name = (
            locator.get_attribute("class") or ""
        ).lower()

        return (
            disabled is not None
            or aria_disabled == "true"
            or "disabled" in class_name
        )
    except PlaywrightError:
        return True


def install_resource_filter(context) -> None:
    blocked_hosts = {
        "connect.facebook.net",
        "googleads.g.doubleclick.net",
        "www.google-analytics.com",
        "www.googletagmanager.com",
    }

    def handle_route(route) -> None:
        request = route.request
        host = urlsplit(request.url).netloc.lower()

        if (
            request.resource_type in {"font", "media"}
            or host in blocked_hosts
        ):
            route.abort()
            return

        route.continue_()

    context.route(
        "**/*",
        handle_route,
    )


def dismiss_common_dialogs(page) -> None:
    labels = [
        "同意する",
        "許可する",
        "すべて許可",
        "Accept",
        "Accept all",
        "OK",
        "閉じる",
        "Close",
    ]

    for label in labels:
        try:
            buttons = page.get_by_role(
                "button",
                name=label,
                exact=True,
            )

            if (
                buttons.count() > 0
                and buttons.first.is_visible()
            ):
                buttons.first.click(timeout=2_000)
                page.wait_for_timeout(100)
        except PlaywrightError:
            continue


def get_page_state(page) -> dict:
    try:
        return page.evaluate(
            """
            (rowSelectors) => {
                let maximumRowCount = 0;

                for (const selector of rowSelectors) {
                    try {
                        maximumRowCount = Math.max(
                            maximumRowCount,
                            document.querySelectorAll(selector).length
                        );
                    } catch {}
                }

                const images = Array.from(document.querySelectorAll('img'));
                const body = document.body;
                const root = document.documentElement;

                const scrollHeight = Math.max(
                    body ? body.scrollHeight : 0,
                    root ? root.scrollHeight : 0
                );

                const scrollTop = window.scrollY || root.scrollTop || 0;
                const viewportHeight = window.innerHeight || root.clientHeight || 0;

                return {
                    row_count: maximumRowCount,
                    image_count: images.length,
                    scroll_height: scrollHeight,
                    scroll_top: scrollTop,
                    viewport_height: viewportHeight,
                    at_bottom: scrollTop + viewportHeight >= scrollHeight - 8
                };
            }
            """,
            ROW_SELECTORS,
        )
    except PlaywrightError:
        return {
            "row_count": 0,
            "image_count": 0,
            "scroll_height": 0,
            "scroll_top": 0,
            "viewport_height": 0,
            "at_bottom": False,
        }


def wait_for_page_change(
    page,
    previous_state: dict,
    timeout_ms: int = CONTENT_CHANGE_TIMEOUT_MS,
) -> bool:
    try:
        page.wait_for_function(
            """
            ({ previousRowCount, previousImageCount, previousHeight }) => {
                let maximumRowCount = 0;
                const images = document.querySelectorAll('img');

                const body = document.body;
                const root = document.documentElement;
                const currentHeight = Math.max(
                    body ? body.scrollHeight : 0,
                    root ? root.scrollHeight : 0
                );

                return (
                    images.length > previousImageCount
                    || currentHeight > previousHeight
                );
            }
            """,
            arg={
                "previousRowCount": previous_state.get("row_count", 0),
                "previousImageCount": previous_state.get("image_count", 0),
                "previousHeight": previous_state.get("scroll_height", 0),
            },
            timeout=timeout_ms,
            polling=100,
        )
        return True
    except PlaywrightTimeoutError:
        return False
    except PlaywrightError:
        return False


def select_legend_league(page) -> None:
    selectors = [
        "[role='tab']:has-text('レジェンド')",
        "button:has-text('レジェンド')",
        "a:has-text('レジェンド')",
        "[role='option']:has-text('レジェンド')",
        "[role='tab']:has-text('Legend')",
        "button:has-text('Legend')",
        "a:has-text('Legend')",
        "[role='option']:has-text('Legend')",
    ]

    for selector in selectors:
        try:
            candidates = page.locator(selector)
            count = min(candidates.count(), 10)
        except PlaywrightError:
            continue

        for index in range(count):
            candidate = candidates.nth(index)

            try:
                if not candidate.is_visible() or is_disabled(candidate):
                    continue

                state_before = get_page_state(page)
                candidate.click(timeout=3_000)
                wait_for_page_change(page, state_before, timeout_ms=2_000)

                print(f"[INFO] レジェンドリーグを選択しました。 selector={selector}")
                return
            except PlaywrightError:
                continue

    print("[INFO] レジェンド選択ボタンは見つかりませんでした。現在の表示内容で処理します。")


def extract_rows_from_dom(page) -> list[dict]:
    try:
        return page.evaluate(
            """
            ({ rowSelectors, strictTeamSelectors, playerNameSelectors }) => {
                const normalizeText = (value) => {
                    return (value || '').replace(/\\s+/g, ' ').trim();
                };

                const isVisible = (element) => {
                    if (!element || !element.isConnected) return false;
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return (
                        rect.width > 0
                        && rect.height > 0
                        && style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && Number(style.opacity || 1) !== 0
                    );
                };

                const readAttribute = (element, names) => {
                    for (const name of names) {
                        const value = element.getAttribute(name);
                        if (value) return value;
                    }
                    return '';
                };

                const queryAllSafe = (root, selectors) => {
                    const result = [];
                    const seen = new Set();
                    for (const selector of selectors) {
                        try {
                            for (const el of root.querySelectorAll(selector)) {
                                if (!seen.has(el)) {
                                    seen.add(el);
                                    result.push(el);
                                }
                            }
                        } catch {}
                    }
                    return result;
                };

                const readPlayerName = (row) => {
                    for (const selector of playerNameSelectors) {
                        const el = row.querySelector(selector);
                        if (el) {
                            const val = normalizeText(el.textContent || '');
                            if (val) return val;
                        }
                    }
                    const lines = (row.innerText || '').split('\\n').map(normalizeText).filter(Boolean);
                    return lines.length > 0 ? lines[0].slice(0, 160) : '';
                };

                const collectImages = (row) => {
                    let containers = queryAllSafe(row, strictTeamSelectors);
                    if (containers.length === 0) {
                        containers = [row];
                    }

                    const images = [];
                    const seenElements = new Set();

                    for (const container of containers) {
                        for (const image of container.querySelectorAll('img')) {
                            if (seenElements.has(image)) continue;
                            seenElements.add(image);

                            const rect = image.getBoundingClientRect();
                            const sources = [
                                image.currentSrc || '',
                                image.getAttribute('src') || '',
                                image.getAttribute('data-src') || '',
                                image.getAttribute('data-lazy-src') || '',
                                image.getAttribute('data-original') || ''
                            ];

                            images.push({
                                index: images.length,
                                sources,
                                alt: normalizeText(image.getAttribute('alt') || ''),
                                title: normalizeText(image.getAttribute('title') || ''),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height),
                                visible: isVisible(image),
                                complete: Boolean(image.complete)
                            });
                        }
                    }
                    return images;
                };

                for (const selector of rowSelectors) {
                    let rows;
                    try {
                        rows = Array.from(document.querySelectorAll(selector));
                    } catch {
                        continue;
                    }

                    const usableRows = rows.filter(r => r.isConnected && r.querySelectorAll('img').length > 0);
                    if (usableRows.length > 0) {
                        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
                        return usableRows.map((row, rowIndex) => {
                            const rect = row.getBoundingClientRect();
                            const explicitId = readAttribute(row, ['data-player-id', 'data-player', 'data-user-id', 'data-id']);
                            const rank = readAttribute(row, ['data-rank', 'data-position', 'data-index']);
                            const playerName = readPlayerName(row);
                            const rowText = normalizeText(row.innerText || '').slice(0, 500);

                            const identity = explicitId || playerName || `${rowText}|${rowIndex}`;
                            const images = collectImages(row);

                            return {
                                row_index: rowIndex,
                                identity,
                                player_name: playerName,
                                rank,
                                text: rowText,
                                viewport_seen: rect.bottom >= 0 && rect.top <= viewportHeight,
                                images
                            };
                        });
                    }
                }
                return [];
            }
            """,
            {
                "rowSelectors": ROW_SELECTORS,
                "strictTeamSelectors": TEAM_CONTAINER_SELECTORS,
                "playerNameSelectors": PLAYER_NAME_SELECTORS,
            },
        )
    except PlaywrightError as error:
        print(f"[WARN] DOM取得エラー: {error}")
        return []


def choose_image_source(image: dict) -> str:
    for source in image.get("sources", []):
        display_url = resolve_display_image_url(source)
        if display_url and not is_placeholder_image_url(display_url):
            return display_url
    return ""


def is_character_image(image: dict, source: str) -> bool:
    if not source:
        return False
    if is_placeholder_image_url(source):
        return False
    
    source_lower = source.lower()
    for word in EXCLUDED_SOURCE_WORDS:
        if word in source_lower and not any(pw in source_lower for pw in POSITIVE_CHARACTER_WORDS):
            return False

    width = int(image.get("width") or 0)
    height = int(image.get("height") or 0)
    
    if width > 0 and height > 0:
        if width < 12 or height < 12:
            return False
        if width > 300 or height > 300:
            return False

    return True


def extract_character_images(row: dict) -> list[dict]:
    candidates = []
    for image in row.get("images", []):
        source = choose_image_source(image)
        if not is_character_image(image, source):
            continue

        candidates.append(
            {
                "index": int(image.get("index", 0)),
                "image_url": source,
                "name": normalize_text(image.get("name", "")),
                "score": 100,
                "visible": bool(image.get("visible")),
                "complete": bool(image.get("complete")),
            }
        )

    if len(candidates) > MAX_CHARACTERS_PER_PLAYER:
        candidates = candidates[:MAX_CHARACTERS_PER_PLAYER]

    return candidates


def make_player_key(row: dict, page_number: int) -> str:
    identity = normalize_text(row.get("identity", ""))
    if not identity:
        identity = f"row:{row.get('row_index', 0)}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"page:{page_number}:{digest}"


def merge_rows(players: dict[str, dict], rows: list[dict], page_number: int) -> int:
    changed = 0
    for row in rows:
        characters = extract_character_images(row)
        if len(characters) < MIN_CHARACTERS_PER_PLAYER:
            continue

        player_key = make_player_key(row, page_number)
        snapshot = {
            "player_key": player_key,
            "player_name": normalize_text(row.get("player_name", "")),
            "rank": normalize_text(row.get("rank", "")),
            "characters": characters,
            "viewport_seen": bool(row.get("viewport_seen")),
            "page_number": page_number,
            "row_index": int(row.get("row_index", 0)),
        }

        previous = players.get(player_key)
        if previous is None or len(characters) > len(previous.get("characters", [])):
            players[player_key] = snapshot
            changed += 1

    return changed


def click_load_more(page) -> bool:
    for selector in LOAD_MORE_SELECTORS:
        try:
            candidates = page.locator(selector)
            for index in range(min(candidates.count(), 5)):
                candidate = candidates.nth(index)
                if candidate.is_visible() and not is_disabled(candidate):
                    candidate.click(timeout=2_000)
                    return True
        except PlaywrightError:
            continue
    return False


def click_next_page(page) -> bool:
    for selector in NEXT_PAGE_SELECTORS:
        try:
            candidates = page.locator(selector)
            for index in range(min(candidates.count(), 5)):
                candidate = candidates.nth(index)
                if candidate.is_visible() and not is_disabled(candidate):
                    candidate.click(timeout=2_000)
                    return True
        except PlaywrightError:
            continue
    return False


def scroll_forward(page) -> None:
    try:
        page.evaluate("window.scrollBy({ top: 600, left: 0, behavior: 'auto' });")
    except PlaywrightError:
        pass


def scroll_to_top(page) -> None:
    try:
        page.evaluate("window.scrollTo({ top: 0, left: 0, behavior: 'auto' });")
    except PlaywrightError:
        pass


def load_players(page) -> list[dict]:
    players: dict[str, dict] = {}
    stable_attempts = 0
    page_number = 1

    for attempt in range(1, MAX_LOAD_ATTEMPTS + 1):
        rows_before = extract_rows_from_dom(page)
        merged_before = merge_rows(players, rows_before, page_number)

        state_before = get_page_state(page)
        
        if not state_before.get("at_bottom", False):
            scroll_forward(page)
        elif click_load_more(page):
            page.wait_for_timeout(500)
        
        wait_for_page_change(page, state_before)

        rows_after = extract_rows_from_dom(page)
        merged_after = merge_rows(players, rows_after, page_number)
        state_after = get_page_state(page)

        if merged_before > 0 or merged_after > 0 or not state_after.get("at_bottom", False):
            stable_attempts = 0
        else:
            stable_attempts += 1

        current_count = len(players)
        print(f"[INFO] 取得人数: {current_count}人 (試行: {attempt}, ページ: {page_number})")

        if current_count >= TARGET_PLAYER_COUNT and state_after.get("at_bottom", False) and stable_attempts >= STABLE_ATTEMPTS_LIMIT:
            print("[INFO] 目標人数に到達しました。")
            break

        if current_count < TARGET_PLAYER_COUNT and state_after.get("at_bottom", False) and stable_attempts >= NEXT_PAGE_STABLE_ATTEMPTS and page_number < MAX_PAGES:
            if click_next_page(page):
                page_number += 1
                scroll_to_top(page)
                stable_attempts = 0
                page.wait_for_timeout(1000)
                continue

        if state_after.get("at_bottom", False) and stable_attempts >= STABLE_ATTEMPTS_LIMIT:
            print("[INFO] 追加データがないため読み込みを終了します。")
            break

        if ACTION_SETTLE_MS > 0:
            page.wait_for_timeout(ACTION_SETTLE_MS)

    ordered_players = sorted(
        players.values(),
        key=lambda player: (
            player.get("page_number", 0),
            player.get("row_index", 0),
        ),
    )
    return ordered_players[:TARGET_PLAYER_COUNT]


def build_character_usage(players: list[dict]) -> dict:
    occurrence_count: Counter[str] = Counter()
    player_count: Counter[str] = Counter()
    image_urls: dict[str, str] = {}
    character_names: defaultdict[str, Counter[str]] = defaultdict(Counter)
    accepted_players = []

    for player in players:
        valid_characters = []
        for character in player.get("characters", [])[:MAX_CHARACTERS_PER_PLAYER]:
            image_url = resolve_display_image_url(character.get("image_url", ""))
            if not image_url or is_placeholder_image_url(image_url):
                continue

            key = character_key(image_url)
            if key == "unknown":
                continue

            valid_characters.append({**character, "image_url": image_url, "character_key": key})

        if len(valid_characters) < MIN_CHARACTERS_PER_PLAYER:
            continue

        accepted_players.append(player)
        seen_character_keys = set()

        for character in valid_characters:
            key = character["character_key"]
            occurrence_count[key] += 1
            image_urls[key] = character["image_url"]
            name = normalize_text(character.get("name", ""))
            if name:
                character_names[key][name] += 1
            seen_character_keys.add(key)

        for key in seen_character_keys:
            player_count[key] += 1

    sampled_players = len(accepted_players)
    total_occurrences = sum(occurrence_count.values())

    characters_output = []
    for key, occurrences in occurrence_count.items():
        users = player_count[key]
        adoption_rate = (users / sampled_players * 100) if sampled_players > 0 else 0.0
        names = character_names.get(key)
        character_name = names.most_common(1)[0][0] if names else ""

        characters_output.append(
            {
                "character_key": key,
                "character_name": character_name,
                "image_url": image_urls.get(key, ""),
                "occurrence_count": occurrences,
                "player_count": users,
                "adoption_rate": round(adoption_rate, 2),
            }
        )

    characters_output.sort(
        key=lambda character: (
            -character["player_count"],
            -character["occurrence_count"],
            character["character_name"],
        )
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {"name": SOURCE_NAME, "page": "PvP Tracker", "league": "Legend"},
        "sampled_players": sampled_players,
        "target_players": TARGET_PLAYER_COUNT,
        "total_occurrence_count": total_occurrences,
        "characters": characters_output,
    }


def run() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=HEADLESS)
        context = browser.new_context(
            locale="ja-JP",
            viewport={"width": 1440, "height": 1200},
        )
        install_resource_filter(context)
        page = context.new_page()

        page.set_default_timeout(DEFAULT_TIMEOUT_MS)
        page.set_default_navigation_timeout(PAGE_NAVIGATION_TIMEOUT_MS)

        try:
            page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=PAGE_NAVIGATION_TIMEOUT_MS)
            dismiss_common_dialogs(page)
            select_legend_league(page)
            scroll_to_top(page)

            players = load_players(page)
            result = build_character_usage(players)

            save_json(OUTPUT_PATH, result)
            print(f"[INFO] 集計成功: players={result['sampled_players']}, characters={result['total_occurrence_count']}")
            return 0
        finally:
            context.close()
            browser.close()


def main() -> None:
    try:
        sys.exit(run())
    except Exception as error:
        print(f"[ERROR] 失敗しました: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
