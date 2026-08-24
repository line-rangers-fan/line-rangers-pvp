# File: scripts/scrape_character_usage.py

"""
LINE Rangers HandbookのPvP Trackerから、
レジェンド帯プレイヤーの防衛チームを集計する。

occurrence_count:
同一プレイヤー内の重複を含むキャラクターの総編成数。

player_count:
対象キャラクターを1体以上編成しているプレイヤー数。

adoption_rate:
player_count / sampled_players * 100。

同じキャラクターを1人が複数体使用している場合、
occurrence_countには体数分を加算し、
player_countには1人分だけ加算する。
"""

import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

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

# 10体は集計条件ではなく、画像読み込み完了の目安として使用する。
EXPECTED_CHARACTERS_PER_PLAYER = int(
    os.environ.get(
        "EXPECTED_CHARACTERS_PER_PLAYER",
        "10",
    )
)

# 1体でも編成されていれば集計対象にする。
MIN_CHARACTERS_PER_PLAYER = int(
    os.environ.get(
        "MIN_CHARACTERS_PER_PLAYER",
        "1",
    )
)

MAX_CHARACTERS_PER_PLAYER = int(
    os.environ.get(
        "MAX_CHARACTERS_PER_PLAYER",
        "15",
    )
)

DEBUG = os.environ.get("DEBUG", "0") == "1"

OUTPUT_PATH = Path(
    "docs/data/character_usage.json"
)

DEBUG_DIR = Path(".artifacts/debug")

MAX_PAGES = int(
    os.environ.get("MAX_PAGES", "30")
)

MAX_LOAD_ATTEMPTS = int(
    os.environ.get("MAX_LOAD_ATTEMPTS", "100")
)

STABLE_ATTEMPTS_LIMIT = int(
    os.environ.get("STABLE_ATTEMPTS_LIMIT", "5")
)

LOAD_WAIT_MS = int(
    os.environ.get("LOAD_WAIT_MS", "2000")
)

IMAGE_WAIT_TIMEOUT_MS = int(
    os.environ.get(
        "IMAGE_WAIT_TIMEOUT_MS",
        "20000",
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


def clean_url(url: str) -> str:
    if not url:
        return ""

    absolute_url = urljoin(
        TARGET_URL,
        url,
    )

    parts = urlsplit(absolute_url)

    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path,
            "",
            "",
        )
    )


def character_key(image_url: str) -> str:
    normalized = clean_url(image_url)

    if normalized:
        return normalized

    return "unknown"


def normalize_text(value: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        str(value or ""),
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


def save_debug_artifacts(
    page,
    name: str,
) -> None:
    if not DEBUG:
        return

    DEBUG_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    safe_name = re.sub(
        r"[^a-zA-Z0-9_.-]+",
        "_",
        name,
    )

    try:
        page.screenshot(
            path=str(
                DEBUG_DIR
                / f"{safe_name}.png"
            ),
            full_page=True,
        )
    except PlaywrightError:
        pass

    try:
        html = page.content()

        (
            DEBUG_DIR
            / f"{safe_name}.html"
        ).write_text(
            html,
            encoding="utf-8",
        )
    except PlaywrightError:
        pass


def is_disabled(locator) -> bool:
    try:
        disabled = locator.get_attribute(
            "disabled"
        )

        aria_disabled = locator.get_attribute(
            "aria-disabled"
        )

        class_name = (
            locator.get_attribute("class")
            or ""
        ).lower()

        return (
            disabled is not None
            or aria_disabled == "true"
            or "disabled" in class_name
        )
    except PlaywrightError:
        return True


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

                page.wait_for_timeout(200)
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
                if not candidate.is_visible():
                    continue

                candidate.click(
                    timeout=3_000
                )

                page.wait_for_timeout(1_500)

                print(
                    "[INFO] レジェンドリーグを"
                    "選択しました。"
                    f" selector={selector}"
                )
                return
            except PlaywrightError:
                continue

    print(
        "[INFO] レジェンド選択ボタンは"
        "見つかりませんでした。"
        " 現在の表示内容で処理します。"
    )


def hydrate_lazy_images(page) -> None:
    try:
        page.locator("img").evaluate_all(
            """
            (images) => {
                for (const image of images) {
                    const source =
                        image.currentSrc
                        || image.getAttribute('src')
                        || image.getAttribute('data-src')
                        || image.getAttribute(
                            'data-lazy-src'
                        )
                        || image.getAttribute(
                            'data-original'
                        )
                        || image.getAttribute(
                            'data-url'
                        )
                        || '';

                    if (
                        source
                        && (
                            !image.getAttribute('src')
                            || image.getAttribute('src')
                                .startsWith('data:')
                        )
                    ) {
                        image.setAttribute(
                            'src',
                            source
                        );
                    }

                    image.loading = 'eager';
                    image.decoding = 'sync';
                }
            }
            """
        )
    except PlaywrightError:
        return


def scroll_page_for_images(page) -> None:
    try:
        page.evaluate(
            """
            async () => {
                const delay = (milliseconds) => {
                    return new Promise((resolve) => {
                        setTimeout(
                            resolve,
                            milliseconds
                        );
                    });
                };

                const height = Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight
                );

                const step = Math.max(
                    Math.floor(
                        window.innerHeight * 0.8
                    ),
                    400
                );

                for (
                    let position = 0;
                    position < height;
                    position += step
                ) {
                    window.scrollTo(
                        0,
                        position
                    );

                    await delay(80);
                }

                window.scrollTo(
                    0,
                    0
                );
            }
            """
        )
    except PlaywrightError:
        return


def filter_character_images(
    images: list[dict],
) -> list[dict]:
    results = []

    for image in images:
        if not image.get("visible"):
            continue

        src = clean_url(
            str(image.get("src") or "")
        )

        width = int(
            image.get("width") or 0
        )

        height = int(
            image.get("height") or 0
        )

        natural_width = int(
            image.get("naturalWidth") or 0
        )

        natural_height = int(
            image.get("naturalHeight") or 0
        )

        context = str(
            image.get("context") or ""
        ).lower()

        alt = normalize_text(
            str(image.get("alt") or "")
        )

        title = normalize_text(
            str(image.get("title") or "")
        )

        if not src:
            continue

        source_lower = src.lower()

        if source_lower.startswith("data:"):
            continue

        if any(
            word in source_lower
            for word in EXCLUDED_SOURCE_WORDS
        ):
            continue

        if any(
            word in context
            for word in EXCLUDED_CONTEXT_WORDS
        ):
            continue

        effective_width = max(
            width,
            natural_width,
        )

        effective_height = max(
            height,
            natural_height,
        )

        if (
            effective_width < 18
            or effective_height < 18
        ):
            continue

        if width > 220 or height > 220:
            continue

        results.append(
            {
                "image": src,
                "width": width,
                "height": height,
                "natural_width": natural_width,
                "natural_height": natural_height,
                "index": image.get("index"),
                "alt": alt,
                "title": title,
            }
        )

    return results


def extract_rows_from_dom(
    page,
    selector: str,
) -> list[dict]:
    try:
        raw_rows = page.locator(
            selector
        ).evaluate_all(
            """
            (rows, teamSelectors) => {
                function readImage(
                    image,
                    index
                ) {
                    const rect =
                        image.getBoundingClientRect();

                    const style =
                        getComputedStyle(image);

                    const context = image.closest(
                        [
                            '[class]',
                            '[data-team]',
                            '[data-type]',
                            '[aria-label]',
                            'td',
                            'li'
                        ].join(',')
                    );

                    const pictureSource =
                        image
                            .closest('picture')
                            ?.querySelector('source');

                    const source =
                        image.currentSrc
                        || image.getAttribute('src')
                        || image.getAttribute(
                            'data-src'
                        )
                        || image.getAttribute(
                            'data-lazy-src'
                        )
                        || image.getAttribute(
                            'data-original'
                        )
                        || image.getAttribute(
                            'data-url'
                        )
                        || pictureSource?.srcset
                            ?.split(',')[0]
                            ?.trim()
                            ?.split(/\\s+/)[0]
                        || '';

                    return {
                        index: index,
                        src: source,
                        width: Math.round(
                            rect.width
                        ),
                        height: Math.round(
                            rect.height
                        ),
                        naturalWidth:
                            image.naturalWidth || 0,
                        naturalHeight:
                            image.naturalHeight || 0,
                        complete:
                            Boolean(image.complete),
                        visible:
                            rect.width > 0
                            && rect.height > 0
                            && style.display !== 'none'
                            && style.visibility
                                !== 'hidden'
                            && Number(
                                style.opacity || 1
                            ) !== 0,
                        context:
                            context
                            && typeof context.className
                                === 'string'
                                ? context.className
                                : '',
                        alt:
                            image.getAttribute('alt')
                            || '',
                        title:
                            image.getAttribute('title')
                            || ''
                    };
                }

                return rows.map(
                    (row, rowIndex) => {
                        const rowImages =
                            Array.from(
                                row.querySelectorAll(
                                    'img'
                                )
                            );

                        const groups = [];

                        for (
                            const selector
                            of teamSelectors
                        ) {
                            let containers = [];

                            try {
                                containers =
                                    Array.from(
                                        row.querySelectorAll(
                                            selector
                                        )
                                    );

                                if (
                                    row.matches(selector)
                                ) {
                                    containers.unshift(
                                        row
                                    );
                                }
                            } catch {
                                continue;
                            }

                            for (
                                const container
                                of containers
                            ) {
                                const images =
                                    Array.from(
                                        container
                                            .querySelectorAll(
                                                'img'
                                            )
                                    ).map(
                                        (image) => {
                                            return readImage(
                                                image,
                                                rowImages
                                                    .indexOf(
                                                        image
                                                    )
                                            );
                                        }
                                    );

                                if (
                                    images.length > 0
                                ) {
                                    groups.push({
                                        selector:
                                            selector,
                                        images:
                                            images
                                    });
                                }
                            }
                        }

                        const allImages =
                            rowImages.map(
                                (
                                    image,
                                    index
                                ) => {
                                    return readImage(
                                        image,
                                        index
                                    );
                                }
                            );

                        const attributes = {};

                        for (
                            const attribute
                            of row.attributes
                        ) {
                            if (
                                attribute.name
                                    .startsWith(
                                        'data-'
                                    )
                                || attribute.name
                                    === 'id'
                            ) {
                                attributes[
                                    attribute.name
                                ] = attribute.value;
                            }
                        }

                        return {
                            rowIndex: rowIndex,
                            text: (
                                row.innerText
                                || row.textContent
                                || ''
                            )
                                .replace(
                                    /\\s+/g,
                                    ' '
                                )
                                .trim(),
                            attributes:
                                attributes,
                            groups:
                                groups,
                            allImages:
                                allImages
                        };
                    }
                );
            }
            """,
            TEAM_CONTAINER_SELECTORS,
        )
    except PlaywrightError:
        return []

    rows = []

    for raw_row in raw_rows:
        groups = []

        for raw_group in raw_row.get(
            "groups",
            [],
        ):
            images = filter_character_images(
                raw_group.get(
                    "images",
                    [],
                )
            )

            if images:
                groups.append(images)

        all_images = filter_character_images(
            raw_row.get(
                "allImages",
                [],
            )
        )

        rows.append(
            {
                "row_index": int(
                    raw_row.get("rowIndex")
                    or 0
                ),
                "text": normalize_text(
                    str(
                        raw_row.get("text")
                        or ""
                    )
                ),
                "attributes": raw_row.get(
                    "attributes",
                    {},
                ),
                "groups": groups,
                "all_images": all_images,
            }
        )

    return rows


def unique_images_by_index(
    images: list[dict],
) -> list[dict]:
    results = []
    seen_indices = set()

    for image in images:
        index = image.get("index")

        if index is not None:
            if index in seen_indices:
                continue

            seen_indices.add(index)

        results.append(image)

    return results


def team_score(
    images: list[dict],
    source_priority: int,
) -> tuple:
    count = len(images)

    return (
        abs(
            count
            - EXPECTED_CHARACTERS_PER_PLAYER
        ),
        source_priority,
        -count,
    )


def select_team_images(
    row: dict,
) -> list[dict]:
    candidates = []

    combined_images = []

    for group in row.get(
        "groups",
        [],
    ):
        combined_images.extend(group)

    combined_images = unique_images_by_index(
        combined_images
    )

    if (
        MIN_CHARACTERS_PER_PLAYER
        <= len(combined_images)
        <= MAX_CHARACTERS_PER_PLAYER
    ):
        candidates.append(
            (
                team_score(
                    combined_images,
                    0,
                ),
                combined_images,
            )
        )

    for group in row.get(
        "groups",
        [],
    ):
        images = unique_images_by_index(
            group
        )

        if (
            MIN_CHARACTERS_PER_PLAYER
            <= len(images)
            <= MAX_CHARACTERS_PER_PLAYER
        ):
            candidates.append(
                (
                    team_score(
                        images,
                        1,
                    ),
                    images,
                )
            )

    all_images = unique_images_by_index(
        row.get(
            "all_images",
            [],
        )
    )

    if (
        MIN_CHARACTERS_PER_PLAYER
        <= len(all_images)
        <= MAX_CHARACTERS_PER_PLAYER
    ):
        candidates.append(
            (
                team_score(
                    all_images,
                    2,
                ),
                all_images,
            )
        )

    if not candidates:
        return []

    candidates.sort(
        key=lambda item: item[0]
    )

    return candidates[0][1]


def find_best_row_selector(
    page,
) -> tuple[str | None, dict]:
    diagnostics = {}

    for selector in ROW_SELECTORS:
        rows = extract_rows_from_dom(
            page,
            selector,
        )

        valid_rows = 0
        image_counts = []

        for row in rows[:50]:
            images = select_team_images(row)

            if images:
                valid_rows += 1
                image_counts.append(
                    len(images)
                )

        diagnostics[selector] = {
            "row_count": len(rows),
            "valid_rows": valid_rows,
            "image_counts": image_counts,
        }

    ranked = sorted(
        diagnostics.items(),
        key=lambda item: (
            item[1]["valid_rows"],
            sum(
                1
                for count
                in item[1]["image_counts"]
                if count
                >= EXPECTED_CHARACTERS_PER_PLAYER
            ),
            item[1]["row_count"],
        ),
        reverse=True,
    )

    if not ranked:
        return None, diagnostics

    if ranked[0][1]["valid_rows"] == 0:
        return None, diagnostics

    return ranked[0][0], diagnostics


def wait_for_character_rows(
    page,
    selector: str,
    timeout_ms: int = IMAGE_WAIT_TIMEOUT_MS,
) -> list[dict]:
    started_at = datetime.now(
        timezone.utc
    )

    stable_attempts = 0
    previous_signature = None
    best_rows = []
    best_total = -1

    while True:
        hydrate_lazy_images(page)

        rows = extract_rows_from_dom(
            page,
            selector,
        )

        counts = [
            len(select_team_images(row))
            for row in rows
        ]

        total = sum(counts)

        if total > best_total:
            best_total = total
            best_rows = rows

        signature = tuple(counts)

        if (
            signature
            and signature == previous_signature
        ):
            stable_attempts += 1
        else:
            stable_attempts = 0

        previous_signature = signature

        valid_counts = [
            count
            for count in counts
            if count
            >= MIN_CHARACTERS_PER_PLAYER
        ]

        all_expected = (
            bool(valid_counts)
            and all(
                count
                >= EXPECTED_CHARACTERS_PER_PLAYER
                for count in valid_counts
            )
        )

        if (
            all_expected
            and stable_attempts >= 2
        ):
            return rows

        if (
            valid_counts
            and stable_attempts
            >= STABLE_ATTEMPTS_LIMIT
        ):
            return rows

        elapsed_ms = (
            datetime.now(timezone.utc)
            - started_at
        ).total_seconds() * 1000

        if elapsed_ms >= timeout_ms:
            if DEBUG:
                print(
                    "[DEBUG] 画像読み込み待機が"
                    "タイムアウトしました。"
                    f" selector={selector}"
                    f" counts={counts}"
                )

            return best_rows or rows

        page.wait_for_timeout(750)


def create_player_identity(
    row: dict,
    page_number: int,
) -> str:
    attributes = row.get(
        "attributes",
        {},
    )

    preferred_attributes = [
        "data-player-id",
        "data-user-id",
        "data-id",
        "data-rank",
        "id",
    ]

    for attribute_name in preferred_attributes:
        value = normalize_text(
            str(
                attributes.get(
                    attribute_name,
                    "",
                )
            )
        )

        if value:
            return (
                f"attribute:"
                f"{attribute_name}:"
                f"{value}"
            )

    text = normalize_text(
        row.get("text", "")
    )

    if text:
        text_hash = hashlib.sha256(
            (
                f"{page_number}:"
                f"{text}"
            ).encode("utf-8")
        ).hexdigest()

        return f"text:{text_hash}"

    row_index = int(
        row.get("row_index") or 0
    )

    return (
        f"fallback:"
        f"{page_number}:"
        f"{row_index}"
    )


def is_better_team(
    new_images: list[dict],
    old_images: list[dict],
) -> bool:
    if not old_images:
        return bool(new_images)

    if not new_images:
        return False

    new_score = (
        abs(
            len(new_images)
            - EXPECTED_CHARACTERS_PER_PLAYER
        ),
        -len(new_images),
    )

    old_score = (
        abs(
            len(old_images)
            - EXPECTED_CHARACTERS_PER_PLAYER
        ),
        -len(old_images),
    )

    return new_score < old_score


def collect_players_from_rows(
    rows: list[dict],
    page_number: int,
    players: dict[str, list[dict]],
) -> int:
    added = 0

    for row in rows:
        images = select_team_images(row)

        if not images:
            continue

        identity = create_player_identity(
            row,
            page_number,
        )

        if identity not in players:
            players[identity] = images
            added += 1
            continue

        if is_better_team(
            images,
            players[identity],
        ):
            players[identity] = images

    return added


def row_signature(
    rows: list[dict],
) -> str:
    values = []

    for row in rows:
        images = select_team_images(row)

        values.append(
            {
                "row_index": row.get(
                    "row_index"
                ),
                "text": row.get("text"),
                "images": [
                    image.get("image")
                    for image in images
                ],
            }
        )

    serialized = json.dumps(
        values,
        ensure_ascii=False,
        sort_keys=True,
    )

    return hashlib.sha256(
        serialized.encode("utf-8")
    ).hexdigest()


def click_first_available(
    page,
    selectors: list[str],
) -> bool:
    for selector in selectors:
        try:
            candidates = page.locator(
                selector
            )

            count = min(
                candidates.count(),
                20,
            )
        except PlaywrightError:
            continue

        for index in range(count):
            candidate = candidates.nth(index)

            try:
                if not candidate.is_visible():
                    continue

                if is_disabled(candidate):
                    continue

                candidate.scroll_into_view_if_needed(
                    timeout=2_000
                )

                candidate.click(
                    timeout=5_000
                )

                return True
            except PlaywrightError:
                continue

    return False


def try_load_more(
    page,
    selector: str,
) -> bool:
    before_rows = extract_rows_from_dom(
        page,
        selector,
    )

    before_signature = row_signature(
        before_rows
    )

    before_count = len(before_rows)

    if not click_first_available(
        page,
        LOAD_MORE_SELECTORS,
    ):
        return False

    page.wait_for_timeout(
        LOAD_WAIT_MS
    )

    hydrate_lazy_images(page)
    scroll_page_for_images(page)

    after_rows = wait_for_character_rows(
        page,
        selector,
    )

    after_signature = row_signature(
        after_rows
    )

    return (
        len(after_rows) > before_count
        or after_signature
        != before_signature
    )


def try_next_page(
    page,
    selector: str,
) -> bool:
    before_url = page.url

    before_rows = extract_rows_from_dom(
        page,
        selector,
    )

    before_signature = row_signature(
        before_rows
    )

    if not click_first_available(
        page,
        NEXT_PAGE_SELECTORS,
    ):
        return False

    try:
        page.wait_for_load_state(
            "domcontentloaded",
            timeout=10_000,
        )
    except PlaywrightTimeoutError:
        pass

    page.wait_for_timeout(
        LOAD_WAIT_MS
    )

    dismiss_common_dialogs(page)
    hydrate_lazy_images(page)
    scroll_page_for_images(page)

    after_rows = extract_rows_from_dom(
        page,
        selector,
    )

    after_signature = row_signature(
        after_rows
    )

    return (
        page.url != before_url
        or after_signature
        != before_signature
    )


def character_name(
    image: dict,
) -> str:
    alt = normalize_text(
        image.get("alt", "")
    )

    title = normalize_text(
        image.get("title", "")
    )

    excluded_names = {
        "image",
        "icon",
        "character",
        "ranger",
        "画像",
        "アイコン",
        "キャラクター",
    }

    for value in [alt, title]:
        if (
            value
            and value.lower()
            not in excluded_names
        ):
            return value

    return ""


def build_output(
    players: dict[str, list[dict]],
) -> dict:
    occurrence_counts = defaultdict(int)
    player_counts = defaultdict(int)
    image_names = {}

    for images in players.values():
        keys = []

        for image in images:
            image_url = image.get(
                "image",
                "",
            )

            key = character_key(image_url)

            if key == "unknown":
                continue

            keys.append(key)
            occurrence_counts[key] += 1

            name = character_name(image)

            if (
                name
                and not image_names.get(key)
            ):
                image_names[key] = name

        for key in set(keys):
            player_counts[key] += 1

    sampled_players = len(players)

    expected_occurrence_total = sum(
        len(
            [
                image
                for image in images
                if character_key(
                    image.get("image", "")
                )
                != "unknown"
            ]
        )
        for images in players.values()
    )

    actual_occurrence_total = sum(
        occurrence_counts.values()
    )

    if (
        expected_occurrence_total
        != actual_occurrence_total
    ):
        raise RuntimeError(
            "キャラクター総編成数が"
            "一致しません。"
            f" player_team_total="
            f"{expected_occurrence_total}"
            f" occurrence_total="
            f"{actual_occurrence_total}"
        )

    characters = []

    for key in occurrence_counts:
        player_count = player_counts[key]

        adoption_rate = (
            player_count
            / sampled_players
            * 100
            if sampled_players
            else 0
        )

        item = {
            "character_key": key,
            "image": key,
            "occurrence_count": (
                occurrence_counts[key]
            ),
            "player_count": player_count,
            "adoption_rate": round(
                adoption_rate,
                2,
            ),
        }

        if image_names.get(key):
            item["name"] = image_names[key]

        characters.append(item)

    characters.sort(
        key=lambda item: (
            -item["player_count"],
            -item["occurrence_count"],
            item.get("name", ""),
            item["character_key"],
        )
    )

    average_characters_per_player = (
        actual_occurrence_total
        / sampled_players
        if sampled_players
        else 0
    )

    return {
        "source": SOURCE_NAME,
        "source_url": TARGET_URL,
        "league": "legend",
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "sampled_players": sampled_players,
        "total_occurrences": (
            actual_occurrence_total
        ),
        "average_characters_per_player": round(
            average_characters_per_player,
            2,
        ),
        "characters": characters,
    }


def scrape(page) -> dict[str, list[dict]]:
    print(
        f"[INFO] ページを開きます。 "
        f"url={TARGET_URL}"
    )

    page.goto(
        TARGET_URL,
        wait_until="domcontentloaded",
        timeout=60_000,
    )

    try:
        page.wait_for_load_state(
            "networkidle",
            timeout=15_000,
        )
    except PlaywrightTimeoutError:
        pass

    dismiss_common_dialogs(page)
    select_legend_league(page)

    try:
        page.wait_for_load_state(
            "networkidle",
            timeout=10_000,
        )
    except PlaywrightTimeoutError:
        pass

    hydrate_lazy_images(page)
    scroll_page_for_images(page)
    page.wait_for_timeout(1_000)

    best_selector, diagnostics = (
        find_best_row_selector(page)
    )

    if DEBUG:
        save_json(
            DEBUG_DIR
            / "row-selector-diagnostics.json",
            diagnostics,
        )

    if not best_selector:
        save_debug_artifacts(
            page,
            "row-selector-not-found",
        )

        raise RuntimeError(
            "プレイヤー行を判定できませんでした。"
        )

    print(
        "[INFO] プレイヤー行セレクタを"
        "決定しました。"
        f" selector={best_selector}"
    )

    players: dict[str, list[dict]] = {}

    page_number = 1
    load_attempts = 0
    visited_page_signatures = set()

    while (
        page_number <= MAX_PAGES
        and load_attempts
        < MAX_LOAD_ATTEMPTS
    ):
        load_attempts += 1

        dismiss_common_dialogs(page)
        hydrate_lazy_images(page)
        scroll_page_for_images(page)

        rows = wait_for_character_rows(
            page,
            best_selector,
        )

        signature = row_signature(rows)

        page_signature = (
            page.url,
            page_number,
            signature,
        )

        added = collect_players_from_rows(
            rows,
            page_number,
            players,
        )

        total_occurrences = sum(
            len(images)
            for images in players.values()
        )

        print(
            "[INFO] 集計中:"
            f" page={page_number}"
            f" rows={len(rows)}"
            f" added={added}"
            f" players={len(players)}"
            f" occurrences="
            f"{total_occurrences}"
        )

        if len(players) >= TARGET_PLAYER_COUNT:
            break

        if page_signature in visited_page_signatures:
            print(
                "[INFO] 同じページ内容を"
                "再検出したため、"
                "次ページを確認します。"
            )
        else:
            visited_page_signatures.add(
                page_signature
            )

            if try_load_more(
                page,
                best_selector,
            ):
                print(
                    "[INFO] 追加のプレイヤーを"
                    "読み込みました。"
                )
                continue

        if not try_next_page(
            page,
            best_selector,
        ):
            print(
                "[INFO] 次ページが"
                "見つからないため、"
                "読み込みを終了します。"
            )
            break

        page_number += 1

        new_selector, new_diagnostics = (
            find_best_row_selector(page)
        )

        if new_selector:
            best_selector = new_selector

        if DEBUG:
            save_json(
                DEBUG_DIR
                / (
                    "row-selector-diagnostics-"
                    f"page-{page_number}.json"
                ),
                new_diagnostics,
            )

    if len(players) > TARGET_PLAYER_COUNT:
        players = dict(
            list(players.items())[
                :TARGET_PLAYER_COUNT
            ]
        )

    return players


def validate_players(
    players: dict[str, list[dict]],
) -> None:
    if len(players) < MIN_REQUIRED_PLAYERS:
        raise RuntimeError(
            "必要なプレイヤー数を"
            "集計できませんでした。"
            f" required={MIN_REQUIRED_PLAYERS}"
            f" actual={len(players)}"
        )

    empty_players = [
        identity
        for identity, images
        in players.items()
        if not images
    ]

    if empty_players:
        raise RuntimeError(
            "キャラクターが1体もない"
            "プレイヤーが集計対象に"
            "含まれています。"
            f" count={len(empty_players)}"
        )

    invalid_players = [
        identity
        for identity, images
        in players.items()
        if len(images)
        > MAX_CHARACTERS_PER_PLAYER
    ]

    if invalid_players:
        raise RuntimeError(
            "編成数の上限を超えた"
            "プレイヤーが存在します。"
            f" count={len(invalid_players)}"
        )


def main() -> int:
    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    if DEBUG:
        DEBUG_DIR.mkdir(
            parents=True,
            exist_ok=True,
        )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
        )

        context = browser.new_context(
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            viewport={
                "width": 1440,
                "height": 1200,
            },
            device_scale_factor=1,
        )

        page = context.new_page()

        page.set_default_timeout(
            10_000
        )

        try:
            players = scrape(page)
            validate_players(players)

            output = build_output(players)

            save_json(
                OUTPUT_PATH,
                output,
            )

            print(
                "[INFO] 集計が完了しました。"
                f" players="
                f"{output['sampled_players']}"
                f" occurrences="
                f"{output['total_occurrences']}"
                f" average="
                f"{output['average_characters_per_player']}"
                f" output={OUTPUT_PATH}"
            )

            return 0
        except Exception as error:
            save_debug_artifacts(
                page,
                "scrape-error",
            )

            print(
                f"[ERROR] {error}",
                file=sys.stderr,
            )

            if DEBUG:
                raise

            return 1
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
