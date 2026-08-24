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
    os.environ.get("STABLE_ATTEMPTS_LIMIT", "5")
)

NEXT_PAGE_STABLE_ATTEMPTS = int(
    os.environ.get("NEXT_PAGE_STABLE_ATTEMPTS", "2")
)

CONTENT_CHANGE_TIMEOUT_MS = int(
    os.environ.get("CONTENT_CHANGE_TIMEOUT_MS", "1200")
)

ACTION_SETTLE_MS = int(
    os.environ.get("ACTION_SETTLE_MS", "100")
)

DEFAULT_TIMEOUT_MS = int(
    os.environ.get("DEFAULT_TIMEOUT_MS", "5000")
)

PAGE_NAVIGATION_TIMEOUT_MS = int(
    os.environ.get("PAGE_NAVIGATION_TIMEOUT_MS", "15000")
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
    "[data-player-id]",
    "[data-player]",
    "[data-rank-entry]",
    "table tbody tr",
    "[role='rowgroup'] [role='row']",
    ".ranking-table tbody tr",
    ".ranking-list .ranking-row",
    ".player-list .player-row",
    ".player-card",
    "[class*='ranking'] [class*='row']",
    "[class*='player'] [class*='row']",
]

STRICT_TEAM_CONTAINER_SELECTORS = [
    "[data-team='defense']",
    "[data-team='defence']",
    "[data-team-type='defense']",
    "[data-team-type='defence']",
    "[data-type='defense']",
    "[data-type='defence']",
    "[aria-label*='defense' i]",
    "[aria-label*='defence' i]",
    "[aria-label*='防衛']",
    ".defense-team",
    ".defence-team",
    "[class*='defense-team']",
    "[class*='defence-team']",
    "[class*='defense_team']",
    "[class*='defence_team']",
    "[class*='defense'] [class*='team']",
    "[class*='defence'] [class*='team']",
]

# [class*='team']のような広すぎる指定は使用しない。
# プロフィール画像や対戦相手側の画像を誤取得するため。
FALLBACK_TEAM_CONTAINER_SELECTORS = [
    ".team-formation",
    ".ranger-team",
    ".formation",
    "[class*='team-formation']",
    "[class*='ranger-team']",
    "[class*='formation']",
]

PLAYER_NAME_SELECTORS = [
    "[data-player-name]",
    ".player-name",
    "[class*='player-name']",
    "[class*='player_name']",
    ".username",
    "[class*='username']",
    "[class*='user-name']",
    "[class*='display-name']",
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

POSITIVE_CHARACTER_WORDS = {
    "character",
    "characters",
    "chara",
    "iconunit",
    "ranger",
    "rangers",
    "unit",
    "units",
}

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
    "emoji",
    "flag",
    "guild",
    "league-icon",
    "player-icon",
    "profile",
    "rank-icon",
    "tier-icon",
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
    """表示用画像URLを返す。

    署名、サイズ指定、品質指定を壊さないため、
    表示用URLのクエリパラメーターは削除しない。
    """

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
    """srcsetを高解像度候補順に解析する。"""

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
    """集計キー作成時だけ既知の画像プロキシを解除する。

    表示用URLには使用しない。
    """

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
    """同一キャラクターをまとめる集計キー用URLを生成する。

    この戻り値は画面表示には使用しない。
    """

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
    """画像は維持し、集計に不要な重いリソースだけ遮断する。"""

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
                buttons.first.click(
                    timeout=2_000
                )

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
                            document.querySelectorAll(
                                selector
                            ).length
                        );
                    } catch {
                        // 無効なセレクターは無視する。
                    }
                }

                const images = Array.from(
                    document.querySelectorAll('img')
                );

                const sourcedImages = images.filter((image) => {
                    return Boolean(
                        image.currentSrc
                        || image.getAttribute('src')
                        || image.getAttribute('data-src')
                        || image.getAttribute('data-lazy-src')
                        || image.getAttribute('data-original')
                        || image.getAttribute('srcset')
                        || image.getAttribute('data-srcset')
                    );
                }).length;

                const completedImages = images.filter((image) => {
                    return (
                        image.complete
                        && image.naturalWidth > 0
                        && image.naturalHeight > 0
                    );
                }).length;

                const body = document.body;
                const root = document.documentElement;

                const scrollHeight = Math.max(
                    body ? body.scrollHeight : 0,
                    root ? root.scrollHeight : 0
                );

                const scrollTop =
                    window.scrollY
                    || root.scrollTop
                    || 0;

                const viewportHeight =
                    window.innerHeight
                    || root.clientHeight
                    || 0;

                return {
                    row_count: maximumRowCount,
                    image_count: images.length,
                    sourced_image_count: sourcedImages,
                    completed_image_count: completedImages,
                    scroll_height: scrollHeight,
                    scroll_top: scrollTop,
                    viewport_height: viewportHeight,
                    at_bottom:
                        scrollTop + viewportHeight
                        >= scrollHeight - 8
                };
            }
            """,
            ROW_SELECTORS,
        )
    except PlaywrightError:
        return {
            "row_count": 0,
            "image_count": 0,
            "sourced_image_count": 0,
            "completed_image_count": 0,
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
            ({
                rowSelectors,
                previousRowCount,
                previousImageCount,
                previousSourcedImageCount,
                previousCompletedImageCount,
                previousHeight
            }) => {
                let maximumRowCount = 0;

                for (const selector of rowSelectors) {
                    try {
                        maximumRowCount = Math.max(
                            maximumRowCount,
                            document.querySelectorAll(
                                selector
                            ).length
                        );
                    } catch {
                        // 無効なセレクターは無視する。
                    }
                }

                const images = Array.from(
                    document.querySelectorAll('img')
                );

                const sourcedImages = images.filter((image) => {
                    return Boolean(
                        image.currentSrc
                        || image.getAttribute('src')
                        || image.getAttribute('data-src')
                        || image.getAttribute('data-lazy-src')
                        || image.getAttribute('data-original')
                        || image.getAttribute('srcset')
                        || image.getAttribute('data-srcset')
                    );
                }).length;

                const completedImages = images.filter((image) => {
                    return (
                        image.complete
                        && image.naturalWidth > 0
                        && image.naturalHeight > 0
                    );
                }).length;

                const body = document.body;
                const root = document.documentElement;

                const currentHeight = Math.max(
                    body ? body.scrollHeight : 0,
                    root ? root.scrollHeight : 0
                );

                return (
                    maximumRowCount > previousRowCount
                    || images.length > previousImageCount
                    || sourcedImages > previousSourcedImageCount
                    || completedImages > previousCompletedImageCount
                    || currentHeight > previousHeight
                );
            }
            """,
            arg={
                "rowSelectors": ROW_SELECTORS,
                "previousRowCount":
                    previous_state.get("row_count", 0),
                "previousImageCount":
                    previous_state.get("image_count", 0),
                "previousSourcedImageCount":
                    previous_state.get(
                        "sourced_image_count",
                        0,
                    ),
                "previousCompletedImageCount":
                    previous_state.get(
                        "completed_image_count",
                        0,
                    ),
                "previousHeight":
                    previous_state.get(
                        "scroll_height",
                        0,
                    ),
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
            count = min(
                candidates.count(),
                10,
            )
        except PlaywrightError:
            continue

        for index in range(count):
            candidate = candidates.nth(index)

            try:
                if (
                    not candidate.is_visible()
                    or is_disabled(candidate)
                ):
                    continue

                state_before = get_page_state(page)

                candidate.click(
                    timeout=3_000
                )

                wait_for_page_change(
                    page,
                    state_before,
                    timeout_ms=2_000,
                )

                print(
                    "[INFO] レジェンドリーグを選択しました。"
                    f" selector={selector}"
                )
                return
            except PlaywrightError:
                continue

    print(
        "[INFO] レジェンド選択ボタンは"
        "見つかりませんでした。"
        "現在の表示内容で処理します。"
    )


def extract_rows_from_dom(page) -> list[dict]:
    """行と画像候補をブラウザー側で一括取得する。"""

    try:
        return page.evaluate(
            """
            ({
                rowSelectors,
                strictTeamSelectors,
                fallbackTeamSelectors,
                playerNameSelectors
            }) => {
                const normalizeText = (value) => {
                    return (value || '')
                        .replace(/\\s+/g, ' ')
                        .trim();
                };

                const isVisible = (element) => {
                    if (!element || !element.isConnected) {
                        return false;
                    }

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

                        if (value) {
                            return value;
                        }
                    }

                    return '';
                };

                const queryAllSafe = (root, selectors) => {
                    const result = [];
                    const seen = new Set();

                    for (const selector of selectors) {
                        let elements;

                        try {
                            elements = root.querySelectorAll(
                                selector
                            );
                        } catch {
                            continue;
                        }

                        for (const element of elements) {
                            if (seen.has(element)) {
                                continue;
                            }

                            seen.add(element);
                            result.push(element);
                        }
                    }

                    return result;
                };

                const readPlayerName = (row) => {
                    const directName = readAttribute(
                        row,
                        [
                            'data-player-name',
                            'data-user-name',
                            'data-username'
                        ]
                    );

                    if (directName) {
                        return normalizeText(directName);
                    }

                    for (const selector of playerNameSelectors) {
                        const element = row.querySelector(selector);

                        if (!element) {
                            continue;
                        }

                        const value = normalizeText(
                            element.textContent || ''
                        );

                        if (value) {
                            return value;
                        }
                    }

                    const lines = (row.innerText || '')
                        .split('\\n')
                        .map(normalizeText)
                        .filter(Boolean);

                    return lines.length > 0
                        ? lines[0].slice(0, 160)
                        : '';
                };

                const readProfileHref = (row) => {
                    const links = Array.from(
                        row.querySelectorAll('a[href]')
                    );

                    const preferred = links.find((link) => {
                        const href = (
                            link.getAttribute('href') || ''
                        ).toLowerCase();

                        return (
                            href.includes('player')
                            || href.includes('profile')
                            || href.includes('user')
                        );
                    });

                    const selected = preferred || links[0];

                    return selected
                        ? selected.getAttribute('href') || ''
                        : '';
                };

                const readAncestorContext = (image, row) => {
                    const values = [];
                    let current = image.parentElement;
                    let depth = 0;

                    while (
                        current
                        && current !== row
                        && depth < 8
                    ) {
                        if (
                            typeof current.className === 'string'
                            && current.className
                        ) {
                            values.push(current.className);
                        }

                        for (
                            const attribute
                            of [
                                'data-team',
                                'data-team-type',
                                'data-type',
                                'aria-label'
                            ]
                        ) {
                            const value = current.getAttribute(
                                attribute
                            );

                            if (value) {
                                values.push(value);
                            }
                        }

                        current = current.parentElement;
                        depth += 1;
                    }

                    return normalizeText(
                        values.join(' ')
                    );
                };

                const readImage = (
                    image,
                    index,
                    row,
                    teamMatched
                ) => {
                    const rect = image.getBoundingClientRect();

                    const sources = [
                        image.currentSrc || '',
                        image.getAttribute('src') || '',
                        image.getAttribute('data-src') || '',
                        image.getAttribute('data-lazy-src') || '',
                        image.getAttribute('data-original') || '',
                        image.getAttribute('data-image') || '',
                        image.getAttribute('data-url') || ''
                    ];

                    const srcsets = [
                        image.getAttribute('srcset') || '',
                        image.getAttribute('data-srcset') || ''
                    ];

                    const picture = image.closest('picture');

                    if (picture) {
                        for (
                            const source
                            of picture.querySelectorAll('source')
                        ) {
                            srcsets.push(
                                source.getAttribute('srcset') || ''
                            );

                            srcsets.push(
                                source.getAttribute(
                                    'data-srcset'
                                ) || ''
                            );
                        }
                    }

                    return {
                        index,
                        sources,
                        srcsets,
                        alt: normalizeText(
                            image.getAttribute('alt') || ''
                        ),
                        title: normalizeText(
                            image.getAttribute('title') || ''
                        ),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        natural_width: image.naturalWidth || 0,
                        natural_height: image.naturalHeight || 0,
                        visible: isVisible(image),
                        complete: Boolean(image.complete),
                        team_matched: teamMatched,
                        context: readAncestorContext(
                            image,
                            row
                        )
                    };
                };

                const findTextDefenseContainers = (row) => {
                    const result = [];
                    const seen = new Set();

                    for (
                        const element
                        of row.querySelectorAll(
                            'section, article, td, div, li'
                        )
                    ) {
                        const text = normalizeText(
                            element.textContent || ''
                        ).toLowerCase();

                        if (
                            !text.includes('防衛')
                            && !text.includes('defense')
                            && !text.includes('defence')
                        ) {
                            continue;
                        }

                        const imageCount =
                            element.querySelectorAll('img').length;

                        if (
                            imageCount < 1
                            || imageCount > 20
                            || seen.has(element)
                        ) {
                            continue;
                        }

                        seen.add(element);
                        result.push(element);
                    }

                    return result;
                };

                const removeNestedDuplicateContainers = (
                    containers
                ) => {
                    return containers.filter((container, index) => {
                        return !containers.some(
                            (other, otherIndex) => {
                                return (
                                    index !== otherIndex
                                    && other.contains(container)
                                    && other !== container
                                );
                            }
                        );
                    });
                };

                const collectImages = (row) => {
                    let containers = queryAllSafe(
                        row,
                        strictTeamSelectors
                    );

                    let teamMatched = containers.length > 0;

                    if (containers.length === 0) {
                        containers = findTextDefenseContainers(row);
                        teamMatched = containers.length > 0;
                    }

                    if (containers.length === 0) {
                        containers = queryAllSafe(
                            row,
                            fallbackTeamSelectors
                        );
                    }

                    if (containers.length === 0) {
                        containers = [row];
                    }

                    containers = removeNestedDuplicateContainers(
                        containers
                    );

                    const images = [];
                    const seenElements = new Set();

                    for (const container of containers) {
                        for (
                            const image
                            of container.querySelectorAll('img')
                        ) {
                            if (seenElements.has(image)) {
                                continue;
                            }

                            seenElements.add(image);

                            images.push(
                                readImage(
                                    image,
                                    images.length,
                                    row,
                                    teamMatched
                                )
                            );
                        }
                    }

                    return {
                        images,
                        teamMatched
                    };
                };

                const candidateGroups = [];

                for (const selector of rowSelectors) {
                    let rows;

                    try {
                        rows = Array.from(
                            document.querySelectorAll(selector)
                        );
                    } catch {
                        continue;
                    }

                    const usableRows = rows.filter((row) => {
                        if (!row.isConnected) {
                            return false;
                        }

                        const imageCount =
                            row.querySelectorAll('img').length;

                        return (
                            imageCount >= 1
                            && imageCount <= 40
                        );
                    });

                    if (usableRows.length === 0) {
                        continue;
                    }

                    const plausibleRows = usableRows.filter((row) => {
                        const count =
                            row.querySelectorAll('img').length;

                        return count >= 1 && count <= 20;
                    }).length;

                    candidateGroups.push({
                        selector,
                        rows: usableRows,
                        score:
                            plausibleRows * 1000
                            + usableRows.length
                    });
                }

                candidateGroups.sort(
                    (left, right) => right.score - left.score
                );

                const selectedGroup = candidateGroups[0];

                if (!selectedGroup) {
                    return [];
                }

                const viewportHeight =
                    window.innerHeight
                    || document.documentElement.clientHeight
                    || 0;

                return selectedGroup.rows.map(
                    (row, rowIndex) => {
                        const rect = row.getBoundingClientRect();

                        const explicitId = readAttribute(
                            row,
                            [
                                'data-player-id',
                                'data-player',
                                'data-user-id',
                                'data-id'
                            ]
                        );

                        const rank = readAttribute(
                            row,
                            [
                                'data-rank',
                                'data-position',
                                'data-index'
                            ]
                        );

                        const playerName = readPlayerName(row);
                        const profileHref = readProfileHref(row);

                        const rowText = normalizeText(
                            row.innerText || ''
                        ).slice(0, 500);

                        const identityParts = [
                            explicitId,
                            profileHref,
                            playerName,
                            rank
                        ].filter(Boolean);

                        const identity = identityParts.length > 0
                            ? identityParts.join('|')
                            : `${rowText}|${rowIndex}`;

                        const collected = collectImages(row);

                        return {
                            row_index: rowIndex,
                            identity,
                            explicit_id: explicitId,
                            player_name: playerName,
                            profile_href: profileHref,
                            rank,
                            text: rowText,
                            selector: selectedGroup.selector,
                            team_matched:
                                collected.teamMatched,
                            viewport_seen:
                                rect.bottom >= 0
                                && rect.top <= viewportHeight,
                            images: collected.images
                        };
                    }
                );
            }
            """,
            {
                "rowSelectors": ROW_SELECTORS,
                "strictTeamSelectors":
                    STRICT_TEAM_CONTAINER_SELECTORS,
                "fallbackTeamSelectors":
                    FALLBACK_TEAM_CONTAINER_SELECTORS,
                "playerNameSelectors":
                    PLAYER_NAME_SELECTORS,
            },
        )
    except PlaywrightError as error:
        print(
            "[WARN] DOMから行を取得できませんでした。"
            f" error={error}"
        )
        return []


def choose_image_source(image: dict) -> str:
    """画像候補から表示可能な実画像URLを選択する。"""

    candidates: list[dict] = []

    raw_sources = image.get(
        "sources",
        [],
    )

    for position, source in enumerate(raw_sources):
        display_url = resolve_display_image_url(
            source
        )

        if not display_url:
            continue

        candidates.append(
            {
                "url": display_url,
                "source_priority":
                    len(raw_sources) - position,
                "resolution_score": 0.0,
            }
        )

    for srcset in image.get(
        "srcsets",
        [],
    ):
        for source, resolution_score in parse_srcset_urls(
            srcset
        ):
            display_url = resolve_display_image_url(
                source
            )

            if not display_url:
                continue

            candidates.append(
                {
                    "url": display_url,
                    "source_priority": 0,
                    "resolution_score":
                        resolution_score,
                }
            )

    if not candidates:
        return ""

    unique_candidates: dict[str, dict] = {}

    for candidate in candidates:
        url = candidate["url"]
        previous = unique_candidates.get(url)

        if previous is None:
            unique_candidates[url] = candidate
            continue

        previous_quality = (
            previous["resolution_score"],
            previous["source_priority"],
        )

        candidate_quality = (
            candidate["resolution_score"],
            candidate["source_priority"],
        )

        if candidate_quality > previous_quality:
            unique_candidates[url] = candidate

    scored_candidates = []

    for candidate in unique_candidates.values():
        url = candidate["url"]
        words = _extract_words(url)
        score = 0.0

        if words & POSITIVE_CHARACTER_WORDS:
            score += 200

        if is_placeholder_image_url(url):
            score -= 10_000

        if (
            words & EXCLUDED_SOURCE_WORDS
            and not words & POSITIVE_CHARACTER_WORDS
        ):
            score -= 500

        # 高解像度srcset候補を優先するが、
        # URL種別判定より強くしすぎない。
        score += min(
            candidate["resolution_score"] / 100,
            100,
        )

        score += candidate["source_priority"]

        if image.get("complete"):
            score += 10

        if int(
            image.get("natural_width", 0) or 0
        ) > 0:
            score += 20

        if int(
            image.get("natural_height", 0) or 0
        ) > 0:
            score += 20

        scored_candidates.append(
            (
                score,
                url,
            )
        )

    scored_candidates.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    best_score, best_url = scored_candidates[0]

    if best_score <= -10_000:
        return ""

    return best_url


def image_candidate_score(
    image: dict,
    source: str,
) -> int:
    width = int(
        image.get("width")
        or image.get("natural_width")
        or 0
    )

    height = int(
        image.get("height")
        or image.get("natural_height")
        or 0
    )

    context = image.get("context", "")
    alt = image.get("alt", "")
    title = image.get("title", "")

    source_words = _extract_words(source)
    context_words = _extract_words(context)
    text_words = _extract_words(
        f"{alt} {title}"
    )

    score = 0

    if image.get("team_matched"):
        score += 150

    if source_words & POSITIVE_CHARACTER_WORDS:
        score += 100

    if context_words & POSITIVE_CHARACTER_WORDS:
        score += 60

    if text_words & POSITIVE_CHARACTER_WORDS:
        score += 30

    if image.get("visible"):
        score += 15

    if image.get("complete"):
        score += 10

    if width >= 24 and height >= 24:
        score += 15

    if width >= 40 and height >= 40:
        score += 15

    if width and height:
        ratio = width / height

        if 0.70 <= ratio <= 1.30:
            score += 20

    if source_words & EXCLUDED_SOURCE_WORDS:
        score -= 200

    if context_words & EXCLUDED_CONTEXT_WORDS:
        score -= 250

    if is_placeholder_image_url(source):
        score -= 10_000

    return score


def is_character_image(
    image: dict,
    source: str,
) -> bool:
    width = int(
        image.get("width")
        or image.get("natural_width")
        or 0
    )

    height = int(
        image.get("height")
        or image.get("natural_height")
        or 0
    )

    context = image.get(
        "context",
        "",
    )

    if not source:
        _log_exclusion(
            "有効な画像URLなし",
            "",
            width,
            height,
            context,
        )
        return False

    if is_placeholder_image_url(source):
        _log_exclusion(
            "プレースホルダー画像",
            source,
            width,
            height,
            context,
        )
        return False

    source_words = _extract_words(source)
    context_words = _extract_words(context)

    positive_source = bool(
        source_words & POSITIVE_CHARACTER_WORDS
    )

    positive_context = bool(
        context_words & POSITIVE_CHARACTER_WORDS
    )

    team_matched = bool(
        image.get("team_matched")
    )

    if (
        source_words & EXCLUDED_SOURCE_WORDS
        and not positive_source
    ):
        _log_exclusion(
            "キャラクター以外の画像URL",
            source,
            width,
            height,
            context,
        )
        return False

    if (
        context_words & EXCLUDED_CONTEXT_WORDS
        and not positive_context
    ):
        _log_exclusion(
            "キャラクター以外の画像領域",
            source,
            width,
            height,
            context,
        )
        return False

    if (
        not team_matched
        and not positive_source
        and not positive_context
    ):
        _log_exclusion(
            "防衛編成画像と判定できない",
            source,
            width,
            height,
            context,
        )
        return False

    if (
        width > 0
        and height > 0
        and (
            width < 18
            or height < 18
        )
    ):
        _log_exclusion(
            "画像サイズが小さすぎる",
            source,
            width,
            height,
            context,
        )
        return False

    if width > 0 and height > 0:
        ratio = width / height

        if ratio < 0.50 or ratio > 2.00:
            _log_exclusion(
                "画像の縦横比が不正",
                source,
                width,
                height,
                context,
            )
            return False

    return True


def extract_character_images(
    row: dict,
) -> list[dict]:
    candidates = []

    for image in row.get("images", []):
        source = choose_image_source(image)

        if not is_character_image(
            image,
            source,
        ):
            continue

        candidates.append(
            {
                "index": int(
                    image.get("index", 0)
                ),
                "image_url": source,
                "name": normalize_text(
                    image.get("alt")
                    or image.get("title")
                    or ""
                ),
                "score": image_candidate_score(
                    image,
                    source,
                ),
                "visible": bool(
                    image.get("visible")
                ),
                "complete": bool(
                    image.get("complete")
                ),
            }
        )

    # DOM要素そのものの重複だけはブラウザー側で除外済み。
    # URLの重複は除外しない。
    # 同じキャラクターを複数体編成できるため。
    if len(candidates) > MAX_CHARACTERS_PER_PLAYER:
        candidates = sorted(
            candidates,
            key=lambda item: (
                item["score"],
                item["visible"],
                item["complete"],
                -item["index"],
            ),
            reverse=True,
        )[:MAX_CHARACTERS_PER_PLAYER]

    candidates.sort(
        key=lambda item: item["index"]
    )

    return candidates


def make_player_key(
    row: dict,
    page_number: int,
) -> str:
    identity = normalize_text(
        row.get("identity", "")
    )

    if not identity:
        identity = (
            f"row:{row.get('row_index', 0)}"
        )

    digest = hashlib.sha256(
        identity.encode("utf-8")
    ).hexdigest()[:24]

    return f"page:{page_number}:{digest}"


def snapshot_quality(
    snapshot: dict,
) -> tuple:
    characters = snapshot.get(
        "characters",
        [],
    )

    completed = sum(
        1
        for character in characters
        if character.get("complete")
    )

    visible = sum(
        1
        for character in characters
        if character.get("visible")
    )

    total_score = sum(
        int(character.get("score", 0))
        for character in characters
    )

    return (
        len(characters),
        completed,
        visible,
        total_score,
        bool(snapshot.get("viewport_seen")),
        bool(snapshot.get("team_matched")),
    )


def merge_rows(
    players: dict[str, dict],
    rows: list[dict],
    page_number: int,
) -> int:
    changed = 0

    for row in rows:
        characters = extract_character_images(
            row
        )

        if (
            len(characters)
            < MIN_CHARACTERS_PER_PLAYER
        ):
            continue

        player_key = make_player_key(
            row,
            page_number,
        )

        snapshot = {
            "player_key": player_key,
            "player_name": normalize_text(
                row.get("player_name", "")
            ),
            "rank": normalize_text(
                row.get("rank", "")
            ),
            "characters": characters,
            "viewport_seen": bool(
                row.get("viewport_seen")
            ),
            "team_matched": bool(
                row.get("team_matched")
            ),
            "page_number": page_number,
            "row_index": int(
                row.get("row_index", 0)
            ),
        }

        previous = players.get(player_key)

        if previous is None:
            players[player_key] = snapshot
            changed += 1
            continue

        # 同一プレイヤーを加算せず、
        # より多くの画像を取得できた状態へ置換する。
        if (
            snapshot_quality(snapshot)
            > snapshot_quality(previous)
        ):
            players[player_key] = snapshot
            changed += 1
            continue

        if (
            snapshot.get("viewport_seen")
            and not previous.get("viewport_seen")
        ):
            previous["viewport_seen"] = True
            changed += 1

    return changed


def click_first_enabled(
    page,
    selectors: list[str],
) -> bool:
    for selector in selectors:
        try:
            candidates = page.locator(selector)
            count = min(
                candidates.count(),
                5,
            )
        except PlaywrightError:
            continue

        for index in range(count):
            candidate = candidates.nth(index)

            try:
                if (
                    not candidate.is_visible()
                    or is_disabled(candidate)
                ):
                    continue

                candidate.scroll_into_view_if_needed(
                    timeout=1_000
                )

                candidate.click(
                    timeout=2_000
                )

                return True
            except PlaywrightError:
                continue

    return False


def click_load_more(page) -> bool:
    return click_first_enabled(
        page,
        LOAD_MORE_SELECTORS,
    )


def click_next_page(page) -> bool:
    return click_first_enabled(
        page,
        NEXT_PAGE_SELECTORS,
    )


def scroll_forward(page) -> None:
    try:
        page.evaluate(
            """
            () => {
                const root = document.documentElement;

                const viewportHeight =
                    window.innerHeight
                    || root.clientHeight
                    || 800;

                const distance = Math.max(
                    300,
                    Math.floor(viewportHeight * 0.72)
                );

                window.scrollBy({
                    top: distance,
                    left: 0,
                    behavior: 'auto'
                });
            }
            """
        )
    except PlaywrightError:
        pass


def scroll_to_top(page) -> None:
    try:
        page.evaluate(
            """
            () => {
                window.scrollTo({
                    top: 0,
                    left: 0,
                    behavior: 'auto'
                });
            }
            """
        )
    except PlaywrightError:
        pass


def log_collection_progress(
    players: dict[str, dict],
    attempt: int,
    page_number: int,
) -> None:
    character_counts = [
        len(player.get("characters", []))
        for player in players.values()
    ]

    total_characters = sum(
        character_counts
    )

    if character_counts:
        minimum_characters = min(
            character_counts
        )

        maximum_characters = max(
            character_counts
        )

        median_characters = median(
            character_counts
        )
    else:
        minimum_characters = 0
        maximum_characters = 0
        median_characters = 0

    print(
        "[INFO] 取得状況:"
        f" players={len(players)}"
        f" characters={total_characters}"
        f" min={minimum_characters}"
        f" median={median_characters}"
        f" max={maximum_characters}"
        f" attempt={attempt}"
        f" page={page_number}"
    )


def load_players(page) -> list[dict]:
    players: dict[str, dict] = {}

    stable_attempts = 0
    page_number = 1
    last_logged_player_count = -1
    last_logged_character_count = -1

    for attempt in range(
        1,
        MAX_LOAD_ATTEMPTS + 1,
    ):
        rows_before = extract_rows_from_dom(
            page
        )

        merged_before = merge_rows(
            players,
            rows_before,
            page_number,
        )

        current_character_count = sum(
            len(player.get("characters", []))
            for player in players.values()
        )

        if (
            len(players) != last_logged_player_count
            or current_character_count
            != last_logged_character_count
        ):
            log_collection_progress(
                players,
                attempt,
                page_number,
            )

            last_logged_player_count = len(
                players
            )

            last_logged_character_count = (
                current_character_count
            )

        state_before = get_page_state(page)
        action = "wait"

        if not state_before.get(
            "at_bottom",
            False,
        ):
            scroll_forward(page)
            action = "scroll"
        elif click_load_more(page):
            action = "load_more"

        changed = wait_for_page_change(
            page,
            state_before,
        )

        # スクロールでDOM件数が変わらない場合でも、
        # 表示領域へ入った画像のcurrentSrcが変わるため再取得する。
        rows_after = extract_rows_from_dom(
            page
        )

        merged_after = merge_rows(
            players,
            rows_after,
            page_number,
        )

        state_after = get_page_state(page)

        if (
            changed
            or merged_before > 0
            or merged_after > 0
            or not state_after.get(
                "at_bottom",
                False,
            )
        ):
            stable_attempts = 0
        else:
            stable_attempts += 1

        current_character_count = sum(
            len(player.get("characters", []))
            for player in players.values()
        )

        # 200人に到達しても即座には終了しない。
        # 最下部で複数回変化がなくなるまで、
        # 200人目付近の遅延画像を再取得する。
        if (
            len(players) >= TARGET_PLAYER_COUNT
            and state_after.get("at_bottom", False)
            and stable_attempts
            >= STABLE_ATTEMPTS_LIMIT
        ):
            print(
                "[INFO] 目標人数到達後の"
                "遅延画像確認が完了しました。"
                f" players={len(players)}"
                f" characters={current_character_count}"
            )
            break

        if (
            len(players) < TARGET_PLAYER_COUNT
            and state_after.get("at_bottom", False)
            and stable_attempts
            >= NEXT_PAGE_STABLE_ATTEMPTS
            and page_number < MAX_PAGES
        ):
            previous_state = get_page_state(
                page
            )

            previous_url = page.url

            if click_next_page(page):
                page_number += 1

                try:
                    page.wait_for_function(
                        """
                        (previousUrl) => {
                            return (
                                location.href !== previousUrl
                                || document.readyState === 'complete'
                            );
                        }
                        """,
                        arg=previous_url,
                        timeout=2_000,
                        polling=100,
                    )
                except PlaywrightError:
                    pass

                wait_for_page_change(
                    page,
                    previous_state,
                    timeout_ms=2_000,
                )

                scroll_to_top(page)
                stable_attempts = 0
                continue

        if (
            state_after.get("at_bottom", False)
            and stable_attempts
            >= STABLE_ATTEMPTS_LIMIT
            and action == "wait"
        ):
            print(
                "[INFO] 追加データがないため"
                "読み込みを終了します。"
                f" players={len(players)}"
                f" characters={current_character_count}"
                f" attempt={attempt}"
            )
            break

        if ACTION_SETTLE_MS > 0:
            page.wait_for_timeout(
                ACTION_SETTLE_MS
            )

    ordered_players = sorted(
        players.values(),
        key=lambda player: (
            player.get("page_number", 0),
            player.get("row_index", 0),
            player.get("player_key", ""),
        ),
    )

    return ordered_players[
        :TARGET_PLAYER_COUNT
    ]


def build_character_usage(
    players: list[dict],
) -> dict:
    occurrence_count: Counter[str] = Counter()
    player_count: Counter[str] = Counter()

    image_urls: dict[str, str] = {}

    character_names: defaultdict[
        str,
        Counter[str],
    ] = defaultdict(Counter)

    accepted_players = []
    accepted_player_counts = []

    for player in players:
        valid_characters = []

        for character in player.get(
            "characters",
            [],
        )[:MAX_CHARACTERS_PER_PLAYER]:
            # 表示用URLはクエリを含めてそのまま維持する。
            image_url = resolve_display_image_url(
                character.get(
                    "image_url",
                    "",
                )
            )

            if not image_url:
                continue

            if is_placeholder_image_url(
                image_url
            ):
                continue

            key = character_key(
                image_url
            )

            if key == "unknown":
                continue

            valid_characters.append(
                {
                    **character,
                    "image_url": image_url,
                    "character_key": key,
                }
            )

        # 有効画像を1体以上取得できたプレイヤーだけ集計する。
        if (
            len(valid_characters)
            < MIN_CHARACTERS_PER_PLAYER
        ):
            continue

        accepted_players.append(player)
        accepted_player_counts.append(
            len(valid_characters)
        )

        seen_character_keys = set()

        for character in valid_characters:
            key = character["character_key"]
            image_url = character["image_url"]

            occurrence_count[key] += 1

            # 表示には正規化済みキーではなく、
            # 実際にブラウザーが使用したURLを保存する。
            image_urls[key] = image_url

            name = normalize_text(
                character.get("name", "")
            )

            if name:
                character_names[key][name] += 1

            seen_character_keys.add(key)

        # 同一プレイヤーが同じキャラクターを複数使用しても、
        # player_countには1だけ加算する。
        for key in seen_character_keys:
            player_count[key] += 1

    sampled_players = len(
        accepted_players
    )

    total_occurrences = sum(
        occurrence_count.values()
    )

    characters_output = []

    for key, occurrences in occurrence_count.items():
        users = player_count[key]

        adoption_rate = (
            users / sampled_players * 100
            if sampled_players > 0
            else 0.0
        )

        names = character_names.get(key)

        character_name = (
            names.most_common(1)[0][0]
            if names
            else ""
        )

        characters_output.append(
            {
                "character_key": key,
                "character_name": character_name,
                "image_url": image_urls.get(
                    key,
                    "",
                ),
                "occurrence_count": occurrences,
                "player_count": users,
                "adoption_rate": round(
                    adoption_rate,
                    2,
                ),
            }
        )

    characters_output.sort(
        key=lambda character: (
            -character["player_count"],
            -character["occurrence_count"],
            character["character_name"],
            character["character_key"],
        )
    )

    if accepted_player_counts:
        minimum_per_player = min(
            accepted_player_counts
        )

        maximum_per_player = max(
            accepted_player_counts
        )

        median_per_player = median(
            accepted_player_counts
        )

        average_per_player = (
            total_occurrences
            / sampled_players
        )
    else:
        minimum_per_player = 0
        maximum_per_player = 0
        median_per_player = 0
        average_per_player = 0

    return {
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "source": {
            "name": SOURCE_NAME,
            "page": "PvP Tracker",
            "league": "Legend",
        },
        "sampled_players": sampled_players,
        "target_players": TARGET_PLAYER_COUNT,
        "minimum_characters_per_player":
            MIN_CHARACTERS_PER_PLAYER,
        "maximum_characters_per_player":
            MAX_CHARACTERS_PER_PLAYER,
        "total_occurrence_count":
            total_occurrences,
        "statistics": {
            "minimum_characters_per_player":
                minimum_per_player,
            "median_characters_per_player":
                median_per_player,
            "maximum_characters_per_player":
                maximum_per_player,
            "average_characters_per_player":
                round(
                    average_per_player,
                    3,
                ),
        },
        "characters": characters_output,
    }


def validate_character_image_urls(
    result: dict,
) -> None:
    invalid_characters = []

    for character in result.get(
        "characters",
        [],
    ):
        image_url = character.get(
            "image_url",
            "",
        )

        resolved_url = resolve_display_image_url(
            image_url
        )

        if (
            not resolved_url
            or is_placeholder_image_url(
                resolved_url
            )
        ):
            invalid_characters.append(
                {
                    "character_key":
                        character.get(
                            "character_key",
                            "",
                        ),
                    "image_url": image_url,
                }
            )

    if invalid_characters:
        if DEBUG:
            DEBUG_DIR.mkdir(
                parents=True,
                exist_ok=True,
            )

            save_json(
                DEBUG_DIR
                / "invalid-character-images.json",
                invalid_characters,
            )

        raise RuntimeError(
            "無効なキャラクター画像が"
            "集計結果に含まれています。"
            f" count={len(invalid_characters)}"
        )


def validate_result(result: dict) -> None:
    sampled_players = int(
        result.get(
            "sampled_players",
            0,
        )
    )

    total_occurrences = int(
        result.get(
            "total_occurrence_count",
            0,
        )
    )

    if sampled_players < MIN_REQUIRED_PLAYERS:
        raise RuntimeError(
            "必要なプレイヤー数を"
            "取得できませんでした。"
            f" required={MIN_REQUIRED_PLAYERS}"
            f" actual={sampled_players}"
        )

    if total_occurrences < sampled_players:
        raise RuntimeError(
            "キャラクター総数が"
            "プレイヤー数を下回っています。"
            f" players={sampled_players}"
            f" characters={total_occurrences}"
        )

    maximum_possible = (
        sampled_players
        * MAX_CHARACTERS_PER_PLAYER
    )

    if total_occurrences > maximum_possible:
        raise RuntimeError(
            "キャラクター総数が"
            "編成上限を超えています。"
            f" maximum={maximum_possible}"
            f" actual={total_occurrences}"
        )

    average = (
        total_occurrences / sampled_players
        if sampled_players > 0
        else 0
    )

    if (
        sampled_players >= TARGET_PLAYER_COUNT
        and average < 8.0
    ):
        print(
            "[WARN] 1プレイヤーあたりの"
            "平均取得数が8体未満です。"
            f" players={sampled_players}"
            f" characters={total_occurrences}"
            f" average={average:.3f}"
        )

    print(
        "[INFO] 集計検証:"
        f" players={sampled_players}"
        f" characters={total_occurrences}"
        f" maximum={maximum_possible}"
        f" average={average:.3f}"
    )


def dump_debug(
    page,
    players: list[dict],
    result: dict | None = None,
) -> None:
    if not DEBUG:
        return

    DEBUG_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        (
            DEBUG_DIR / "pvp-tracker.html"
        ).write_text(
            page.content(),
            encoding="utf-8",
        )
    except PlaywrightError:
        pass

    try:
        page.screenshot(
            path=str(
                DEBUG_DIR
                / "pvp-tracker.png"
            ),
            full_page=True,
        )
    except PlaywrightError:
        pass

    save_json(
        DEBUG_DIR / "players.json",
        players,
    )

    save_json(
        DEBUG_DIR
        / "excluded-images.json",
        EXCLUSION_LOG,
    )

    if result is not None:
        save_json(
            DEBUG_DIR / "result.json",
            result,
        )


def run() -> int:
    result = None
    players: list[dict] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=HEADLESS,
        )

        context = browser.new_context(
            locale="ja-JP",
            viewport={
                "width": 1440,
                "height": 1200,
            },
            device_scale_factor=1,
            reduced_motion="reduce",
        )

        install_resource_filter(context)

        page = context.new_page()

        page.set_default_timeout(
            DEFAULT_TIMEOUT_MS
        )

        page.set_default_navigation_timeout(
            PAGE_NAVIGATION_TIMEOUT_MS
        )

        try:
            page.goto(
                TARGET_URL,
                wait_until="domcontentloaded",
                timeout=PAGE_NAVIGATION_TIMEOUT_MS,
            )

            dismiss_common_dialogs(page)

            try:
                page.wait_for_function(
                    """
                    (rowSelectors) => {
                        return rowSelectors.some((selector) => {
                            try {
                                return (
                                    document.querySelector(
                                        selector
                                    ) !== null
                                );
                            } catch {
                                return false;
                            }
                        });
                    }
                    """,
                    arg=ROW_SELECTORS,
                    timeout=10_000,
                    polling=100,
                )
            except PlaywrightTimeoutError:
                print(
                    "[WARN] 初期プレイヤー行の"
                    "表示待機がタイムアウトしました。"
                )

            select_legend_league(page)
            scroll_to_top(page)

            players = load_players(page)

            result = build_character_usage(
                players
            )

            validate_result(result)

            validate_character_image_urls(
                result
            )

            save_json(
                OUTPUT_PATH,
                result,
            )

            dump_debug(
                page,
                players,
                result,
            )

            print(
                "[INFO] 集計結果を保存しました。"
                f" path={OUTPUT_PATH}"
                f" players={result['sampled_players']}"
                f" characters="
                f"{result['total_occurrence_count']}"
            )

            return 0
        except Exception:
            dump_debug(
                page,
                players,
                result,
            )
            raise
        finally:
            context.close()
            browser.close()


def main() -> None:
    try:
        exit_code = run()
    except Exception as error:
        print(
            f"[ERROR] 集計に失敗しました: {error}",
            file=sys.stderr,
        )

        if DEBUG:
            import traceback

            traceback.print_exc()

        raise SystemExit(1) from error

    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
