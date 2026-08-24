# File: scripts/scrape_character_usage.py
"""
LINE Rangers HandbookのPvP Trackerから、
レジェンド帯プレイヤーの防衛チームを集計する。

集計仕様:
    occurrence_count:
        同一プレイヤー内の重複を含むキャラクターの総編成数。

    player_count:
        対象キャラクターを1体以上編成しているプレイヤー数。

    adoption_rate:
        player_count / sampled_players * 100。

同じキャラクターを1人が複数体使用している場合:
    occurrence_countには体数分を加算する。
    player_countには1人分だけ加算する。

重要:
    プレイヤーはキャラクターを1体以上取得できれば集計対象にする。
    1プレイヤーにつき最大10体まで読み取る。
    遅延読み込み、仮想スクロール、ページネーションに対応する。
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

# 1体以上読み取れたプレイヤーを集計対象にする。
MIN_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MIN_CHARACTERS_PER_PLAYER", "1")
)

# LINE Rangersの1チーム上限。
MAX_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MAX_CHARACTERS_PER_PLAYER", "10")
)

MAX_PAGES = int(
    os.environ.get("MAX_PAGES", "30")
)

MAX_LOAD_ATTEMPTS = int(
    os.environ.get("MAX_LOAD_ATTEMPTS", "240")
)

STABLE_ATTEMPTS_LIMIT = int(
    os.environ.get("STABLE_ATTEMPTS_LIMIT", "4")
)

NEXT_PAGE_STABLE_ATTEMPTS = int(
    os.environ.get("NEXT_PAGE_STABLE_ATTEMPTS", "2")
)

CONTENT_CHANGE_TIMEOUT_MS = int(
    os.environ.get("CONTENT_CHANGE_TIMEOUT_MS", "900")
)

ACTION_SETTLE_MS = int(
    os.environ.get("ACTION_SETTLE_MS", "80")
)

PAGE_NAVIGATION_TIMEOUT_MS = int(
    os.environ.get("PAGE_NAVIGATION_TIMEOUT_MS", "15000")
)

DEFAULT_TIMEOUT_MS = int(
    os.environ.get("DEFAULT_TIMEOUT_MS", "5000")
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

FALLBACK_TEAM_CONTAINER_SELECTORS = [
    ".team-formation",
    ".ranger-team",
    ".formation",
    "[class*='team-formation']",
    "[class*='ranger-team']",
    "[class*='formation']",
    "[class*='team']",
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

WRAPPED_IMAGE_QUERY_KEYS = (
    "url",
    "src",
    "image",
    "image_url",
)

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


def first_srcset_url(value: str) -> str:
    if not value:
        return ""

    candidates = []

    for part in value.split(","):
        candidate = part.strip().split(" ")[0].strip()

        if candidate:
            candidates.append(candidate)

    if not candidates:
        return ""

    return candidates[-1]


def unwrap_image_url(url: str) -> str:
    current = url

    for _ in range(3):
        if not current:
            break

        absolute_url = urljoin(TARGET_URL, current)
        parts = urlsplit(absolute_url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))

        wrapped = ""

        for key in WRAPPED_IMAGE_QUERY_KEYS:
            value = query.get(key, "")

            if not value:
                continue

            decoded = unquote(value)

            if (
                decoded.startswith("http://")
                or decoded.startswith("https://")
                or decoded.startswith("/")
            ):
                wrapped = decoded
                break

        if not wrapped:
            return absolute_url

        current = wrapped

    return urljoin(TARGET_URL, current)


def clean_url(url: str) -> str:
    if not url:
        return ""

    stripped_url = url.strip()

    if (
        not stripped_url
        or stripped_url.startswith("data:")
        or stripped_url.startswith("blob:")
        or stripped_url.startswith("javascript:")
    ):
        return ""

    absolute_url = unwrap_image_url(stripped_url)
    parts = urlsplit(absolute_url)

    if parts.scheme not in {"http", "https"}:
        return ""

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

        filtered_query.append((key, value))

    filtered_query.sort()

    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path,
            urlencode(filtered_query, doseq=True),
            "",
        )
    )


def character_key(image_url: str) -> str:
    normalized = clean_url(image_url)

    if normalized:
        return normalized

    return "unknown"


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

    context.route("**/*", handle_route)


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

    state_before = get_page_state(page)

    for selector in selectors:
        try:
            candidates = page.locator(selector)
            count = min(candidates.count(), 10)
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

                candidate.click(timeout=3_000)

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
        "[INFO] レジェンド選択ボタンは見つかりませんでした。"
        " 現在の表示内容で処理します。"
    )


def extract_rows_from_dom(page) -> list[dict]:
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

                    const link = preferred || links[0];

                    return link
                        ? link.getAttribute('href') || ''
                        : '';
                };

                const readAncestorContext = (image, row) => {
                    const values = [];
                    let current = image.parentElement;
                    let depth = 0;

                    while (
                        current
                        && current !== row
                        && depth < 6
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

                    return normalizeText(values.join(' '));
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
                        context: readAncestorContext(image, row)
                    };
                };

                const queryAllSafe = (root, selectors) => {
                    const result = [];
                    const seen = new Set();

                    for (const selector of selectors) {
                        let elements = [];

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

                const findTextDefenseContainers = (row) => {
                    const result = [];

                    for (
                        const element
                        of row.querySelectorAll(
                            'section, article, td, div, li'
                        )
                    ) {
                        const ownText = normalizeText(
                            element.textContent || ''
                        ).toLowerCase();

                        if (
                            !ownText.includes('防衛')
                            && !ownText.includes('defense')
                            && !ownText.includes('defence')
                        ) {
                            continue;
                        }

                        const imageCount =
                            element.querySelectorAll('img').length;

                        if (
                            imageCount >= 1
                            && imageCount <= 20
                        ) {
                            result.push(element);
                        }
                    }

                    return result;
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

                    const images = [];
                    const seenImages = new Set();

                    for (const container of containers) {
                        for (
                            const image
                            of container.querySelectorAll('img')
                        ) {
                            if (seenImages.has(image)) {
                                continue;
                            }

                            seenImages.add(image);

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
                    let rows = [];

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

                        return row.querySelectorAll('img').length > 0;
                    });

                    if (usableRows.length === 0) {
                        continue;
                    }

                    const imageCounts = usableRows.map((row) => {
                        return row.querySelectorAll('img').length;
                    });

                    const reasonableRows = imageCounts.filter(
                        (count) => count >= 1 && count <= 30
                    ).length;

                    const score =
                        reasonableRows * 1000
                        + usableRows.length;

                    candidateGroups.push({
                        selector,
                        rows: usableRows,
                        score
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
                        const playerName = readPlayerName(row);
                        const profileHref = readProfileHref(row);

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
                "playerNameSelectors": PLAYER_NAME_SELECTORS,
            },
        )
    except PlaywrightError as error:
        print(
            "[WARN] DOMから行を取得できませんでした。"
            f" error={error}"
        )
        return []


def choose_image_source(image: dict) -> str:
    candidates = []

    for source in image.get("sources", []):
        if source:
            candidates.append(source)

    for srcset in image.get("srcsets", []):
        source = first_srcset_url(srcset)

        if source:
            candidates.append(source)

    for candidate in candidates:
        cleaned = clean_url(candidate)

        if cleaned:
            return cleaned

    return ""


def image_candidate_score(image: dict, source: str) -> int:
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
    text_words = _extract_words(f"{alt} {title}")

    score = 0

    if image.get("team_matched"):
        score += 100

    if source_words & POSITIVE_CHARACTER_WORDS:
        score += 60

    if context_words & POSITIVE_CHARACTER_WORDS:
        score += 40

    if text_words & POSITIVE_CHARACTER_WORDS:
        score += 20

    if image.get("visible"):
        score += 8

    if image.get("complete"):
        score += 4

    if width >= 32 and height >= 32:
        score += 15

    if width >= 48 and height >= 48:
        score += 10

    if width and height:
        ratio = width / height

        if 0.70 <= ratio <= 1.30:
            score += 15

    if source_words & EXCLUDED_SOURCE_WORDS:
        score -= 100

    if context_words & EXCLUDED_CONTEXT_WORDS:
        score -= 120

    return score


def is_character_image(
    image: dict,
    source: str,
) -> bool:
    if not source:
        _log_exclusion(
            "画像URLなし",
            "",
            int(image.get("width", 0)),
            int(image.get("height", 0)),
            image.get("context", ""),
        )
        return False

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
    source_words = _extract_words(source)
    context_words = _extract_words(context)

    positive_source = bool(
        source_words & POSITIVE_CHARACTER_WORDS
    )

    positive_context = bool(
        context_words & POSITIVE_CHARACTER_WORDS
    )

    team_matched = bool(image.get("team_matched"))

    if (
        source_words & EXCLUDED_SOURCE_WORDS
        and not positive_source
        and not team_matched
    ):
        _log_exclusion(
            "除外対象の画像URL",
            source,
            width,
            height,
            context,
        )
        return False

    if (
        context_words & EXCLUDED_CONTEXT_WORDS
        and not positive_context
        and not team_matched
    ):
        _log_exclusion(
            "除外対象の画像コンテキスト",
            source,
            width,
            height,
            context,
        )
        return False

    if (
        width > 0
        and height > 0
        and width <= 16
        and height <= 16
    ):
        _log_exclusion(
            "画像が小さすぎる",
            source,
            width,
            height,
            context,
        )
        return False

    if width > 0 and height > 0:
        ratio = width / height

        if (
            ratio < 0.40
            or ratio > 2.50
        ):
            _log_exclusion(
                "画像の縦横比がキャラクター画像ではない",
                source,
                width,
                height,
                context,
            )
            return False

    return True


def extract_character_images(row: dict) -> list[dict]:
    candidates = []

    for image in row.get("images", []):
        source = choose_image_source(image)

        if not is_character_image(image, source):
            continue

        name = normalize_text(
            image.get("alt")
            or image.get("title")
            or ""
        )

        candidates.append(
            {
                "index": int(image.get("index", 0)),
                "image_url": source,
                "name": name,
                "score": image_candidate_score(
                    image,
                    source,
                ),
                "visible": bool(image.get("visible")),
                "complete": bool(image.get("complete")),
            }
        )

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


def snapshot_quality(snapshot: dict) -> tuple:
    characters = snapshot.get("characters", [])

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

    score = sum(
        int(character.get("score", 0))
        for character in characters
    )

    return (
        len(characters),
        completed,
        visible,
        score,
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
        characters = extract_character_images(row)

        if len(characters) < MIN_CHARACTERS_PER_PLAYER:
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

        # 同一プレイヤーのスナップショットを加算しない。
        # 遅延読み込み後の、より多く読み取れたスナップショットで
        # 置き換える。これにより同一DOMの二重加算を防ぐ。
        if snapshot_quality(snapshot) > snapshot_quality(previous):
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
                        || image.getAttribute('srcset')
                        || image.getAttribute('data-srcset')
                    );
                }).length;

                const completedImages = images.filter((image) => {
                    return (
                        image.complete
                        && image.naturalWidth > 0
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
                        || image.getAttribute('srcset')
                        || image.getAttribute('data-srcset')
                    );
                }).length;

                const completedImages = images.filter((image) => {
                    return (
                        image.complete
                        && image.naturalWidth > 0
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
                    previous_state.get("scroll_height", 0),
            },
            timeout=timeout_ms,
            polling=100,
        )
        return True
    except PlaywrightTimeoutError:
        return False
    except PlaywrightError:
        return False


def click_first_enabled(
    page,
    selectors: list[str],
) -> bool:
    for selector in selectors:
        try:
            candidates = page.locator(selector)
            count = min(candidates.count(), 5)
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

                candidate.click(timeout=2_000)
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
                    320,
                    Math.floor(viewportHeight * 0.78)
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

    total_characters = sum(character_counts)

    if character_counts:
        median_characters = median(character_counts)
        minimum_characters = min(character_counts)
        maximum_characters = max(character_counts)
    else:
        median_characters = 0
        minimum_characters = 0
        maximum_characters = 0

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

    for attempt in range(1, MAX_LOAD_ATTEMPTS + 1):
        rows = extract_rows_from_dom(page)

        merge_rows(
            players,
            rows,
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

            last_logged_player_count = len(players)
            last_logged_character_count = (
                current_character_count
            )

        state_before = get_page_state(page)
        action_performed = False

        if not state_before.get("at_bottom", False):
            scroll_forward(page)
            action_performed = True
        elif click_load_more(page):
            action_performed = True
        else:
            # 最下部でも、遅延読み込み中の画像が残っている可能性が
            # あるため、短時間だけDOM変化を待つ。
            action_performed = False

        changed = wait_for_page_change(
            page,
            state_before,
        )

        # スクロールではDOM件数が変化しないことがあるため、
        # 移動後の表示領域を必ず再取得する。
        rows_after_action = extract_rows_from_dom(page)

        merged_after_action = merge_rows(
            players,
            rows_after_action,
            page_number,
        )

        state_after = get_page_state(page)

        if (
            changed
            or merged_after_action > 0
            or not state_after.get("at_bottom", False)
        ):
            stable_attempts = 0
        else:
            stable_attempts += 1

        # 200人に達しても即終了しない。
        # 最下部で複数回安定するまで処理し、200人目付近の
        # 遅延画像も読み取る。
        if (
            len(players) >= TARGET_PLAYER_COUNT
            and state_after.get("at_bottom", False)
            and stable_attempts >= STABLE_ATTEMPTS_LIMIT
        ):
            break

        # 現在のページで不足している場合だけ次ページへ進む。
        if (
            len(players) < TARGET_PLAYER_COUNT
            and state_after.get("at_bottom", False)
            and stable_attempts
            >= NEXT_PAGE_STABLE_ATTEMPTS
            and page_number < MAX_PAGES
        ):
            previous_url = page.url
            previous_state = get_page_state(page)

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
                        timeout=CONTENT_CHANGE_TIMEOUT_MS,
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
            and stable_attempts >= STABLE_ATTEMPTS_LIMIT
            and not action_performed
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
            page.wait_for_timeout(ACTION_SETTLE_MS)

    ordered_players = sorted(
        players.values(),
        key=lambda player: (
            player.get("page_number", 0),
            player.get("row_index", 0),
            player.get("player_key", ""),
        ),
    )

    return ordered_players[:TARGET_PLAYER_COUNT]


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

    for player in players:
        characters = player.get(
            "characters",
            [],
        )[:MAX_CHARACTERS_PER_PLAYER]

        if len(characters) < MIN_CHARACTERS_PER_PLAYER:
            continue

        accepted_players.append(player)
        seen_character_keys = set()

        for character in characters:
            image_url = clean_url(
                character.get("image_url", "")
            )

            key = character_key(image_url)

            if key == "unknown":
                continue

            occurrence_count[key] += 1
            image_urls[key] = image_url

            name = normalize_text(
                character.get("name", "")
            )

            if name:
                character_names[key][name] += 1

            seen_character_keys.add(key)

        for key in seen_character_keys:
            player_count[key] += 1

    sampled_players = len(accepted_players)
    total_occurrences = sum(
        occurrence_count.values()
    )

    characters_output = []

    for key, occurrences in occurrence_count.items():
        users = player_count[key]

        if sampled_players > 0:
            adoption_rate = (
                users / sampled_players * 100
            )
        else:
            adoption_rate = 0.0

        names = character_names.get(key)

        if names:
            character_name = names.most_common(1)[0][0]
        else:
            character_name = ""

        characters_output.append(
            {
                "character_key": key,
                "character_name": character_name,
                "image_url": image_urls.get(key, ""),
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

    player_character_counts = [
        len(player.get("characters", []))
        for player in accepted_players
    ]

    if player_character_counts:
        minimum_per_player = min(
            player_character_counts
        )
        maximum_per_player = max(
            player_character_counts
        )
        median_per_player = median(
            player_character_counts
        )
        average_per_player = (
            total_occurrences / sampled_players
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
        "total_occurrence_count": total_occurrences,
        "statistics": {
            "minimum_characters_per_player":
                minimum_per_player,
            "median_characters_per_player":
                median_per_player,
            "maximum_characters_per_player":
                maximum_per_player,
            "average_characters_per_player": round(
                average_per_player,
                3,
            ),
        },
        "characters": characters_output,
    }


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
        html = page.content()

        (
            DEBUG_DIR / "pvp-tracker.html"
        ).write_text(
            html,
            encoding="utf-8",
        )
    except PlaywrightError:
        pass

    try:
        page.screenshot(
            path=str(
                DEBUG_DIR / "pvp-tracker.png"
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
        DEBUG_DIR / "excluded-images.json",
        EXCLUSION_LOG,
    )

    if result is not None:
        save_json(
            DEBUG_DIR / "result.json",
            result,
        )


def validate_result(result: dict) -> None:
    sampled_players = int(
        result.get("sampled_players", 0)
    )

    total_occurrences = int(
        result.get(
            "total_occurrence_count",
            0,
        )
    )

    if sampled_players < MIN_REQUIRED_PLAYERS:
        raise RuntimeError(
            "必要なプレイヤー数を取得できませんでした。"
            f" required={MIN_REQUIRED_PLAYERS}"
            f" actual={sampled_players}"
        )

    if total_occurrences < sampled_players:
        raise RuntimeError(
            "キャラクター総数がプレイヤー数を"
            "下回っています。"
            f" players={sampled_players}"
            f" characters={total_occurrences}"
        )

    maximum_possible = (
        sampled_players
        * MAX_CHARACTERS_PER_PLAYER
    )

    if total_occurrences > maximum_possible:
        raise RuntimeError(
            "キャラクター総数が編成上限を"
            "超えています。"
            f" maximum={maximum_possible}"
            f" actual={total_occurrences}"
        )

    if sampled_players >= TARGET_PLAYER_COUNT:
        average = (
            total_occurrences / sampled_players
        )

        if average < 8.0:
            print(
                "[WARN] 1プレイヤーあたりの平均取得数が"
                "8体未満です。"
                f" players={sampled_players}"
                f" characters={total_occurrences}"
                f" average={average:.3f}"
            )

    print(
        "[INFO] 集計検証:"
        f" players={sampled_players}"
        f" characters={total_occurrences}"
        f" maximum={maximum_possible}"
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
                    "[WARN] 初期プレイヤー行の表示待機が"
                    "タイムアウトしました。"
                )

            select_legend_league(page)
            scroll_to_top(page)

            players = load_players(page)
            result = build_character_usage(players)

            validate_result(result)
            save_json(OUTPUT_PATH, result)
            dump_debug(page, players, result)

            print(
                "[INFO] 集計結果を保存しました。"
                f" path={OUTPUT_PATH}"
                f" players={result['sampled_players']}"
                f" characters="
                f"{result['total_occurrence_count']}"
            )

            return 0
        except Exception:
            dump_debug(page, players, result)
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
