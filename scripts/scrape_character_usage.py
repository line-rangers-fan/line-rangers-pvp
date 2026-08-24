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
from statistics import median
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

# 【修正】以前の集計方法（10体）に戻し、画像が完全に読み込まれるまで待つストッパーとして機能させます
MIN_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MIN_CHARACTERS_PER_PLAYER", "10")
)

MAX_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MAX_CHARACTERS_PER_PLAYER", "15")
)

DEBUG = os.environ.get("DEBUG", "0") == "1"

OUTPUT_PATH = Path("docs/data/character_usage.json")
DEBUG_DIR = Path(".artifacts/debug")

MAX_PAGES = 30
MAX_LOAD_ATTEMPTS = 100
STABLE_ATTEMPTS_LIMIT = 15
LOAD_WAIT_MS = 2000

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
    "[class*='defense-team']",
    "[class*='defense'] [class*='team']",
    "[class*='defense'] [class*='team']",
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

    absolute_url = urljoin(TARGET_URL, url)
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
            count = min(candidates.count(), 10)
        except PlaywrightError:
            continue

        for index in range(count):
            candidate = candidates.nth(index)

            try:
                if not candidate.is_visible():
                    continue

                candidate.click(timeout=3_000)
                page.wait_for_timeout(1_500)

                print(
                    "[INFO] レジェンドリーグを選択しました。"
                    f" selector={selector}"
                )
                return
            except PlaywrightError:
                continue

    print(
        "[INFO] レジェンド選択ボタンは見つかりませんでした。"
        "現在の表示内容で処理します。"
    )


def extract_rows_from_dom(page, selector: str) -> list[dict]:
    try:
        raw_rows = page.locator(selector).evaluate_all(
            """
            (rows, teamSelectors) => {
                function readImage(image, index) {
                    const rect = image.getBoundingClientRect();
                    const style = getComputedStyle(image);
                    const context = image.closest(
                        '[class], [data-team], [data-type], td, li'
                    );

                    return {
                        index: index,
                        src:
                            image.currentSrc
                            || image.getAttribute('src')
                            || image.getAttribute('data-src')
                            || image.getAttribute('data-lazy-src')
                            || image.getAttribute('data-original')
                            || '',
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        visible:
                            rect.width > 0
                            && rect.height > 0
                            && style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && Number(style.opacity || 1) !== 0,
                        context:
                            context
                            && typeof context.className === 'string'
                                ? context.className
                                : ''
                    };
                }

                return rows.map((row, rowIndex) => {
                    const groups = [];

                    for (const selector of teamSelectors) {
                        let containers = [];

                        try {
                            containers = Array.from(
                                row.querySelectorAll(selector)
                            );
                        } catch {
                            continue;
                        }

                        for (const container of containers) {
                            const images = Array.from(
                                container.querySelectorAll('img')
                            ).map(readImage);

                            if (images.length > 0) {
                                groups.push({
                                    selector: selector,
                                    images: images
                                });
                            }
                        }
                    }

                    const allImages = Array.from(
                        row.querySelectorAll('img')
                    ).map(readImage);

                    const attributes = {};

                    for (const attribute of row.attributes) {
                        if (
                            attribute.name.startsWith('data-')
                            || attribute.name === 'id'
                        ) {
                            attributes[attribute.name] =
                                attribute.value;
                        }
                    }

                    return {
                        rowIndex: rowIndex,
                        text: (
                            row.innerText
                            || row.textContent
                            || ''
                        )
                            .replace(/\\s+/g, ' ')
                            .trim(),
                        attributes: attributes,
                        groups: groups,
                        allImages: allImages
                    };
                });
            }
            """,
            TEAM_CONTAINER_SELECTORS,
        )
    except PlaywrightError:
        return []

    rows = []

    for raw_row in raw_rows:
        groups = []

        for raw_group in raw_row.get("groups", []):
            images = filter_character_images(
                raw_group.get("images", [])
            )

            if images:
                groups.append(images)

        all_images = filter_character_images(
            raw_row.get("allImages", [])
        )

        rows.append(
            {
                "row_index": int(
                    raw_row.get("rowIndex") or 0
                ),
                "text": str(
                    raw_row.get("text") or ""
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


def filter_character_images(images: list[dict]) -> list[dict]:
    results = []

    for image in images:
        if not image.get("visible"):
            continue

        src = clean_url(
            str(image.get("src") or "")
        )

        width = int(image.get("width") or 0)
        height = int(image.get("height") or 0)
        context = str(
            image.get("context") or ""
        ).lower()

        if not src:
            continue

        source_lower = src.lower()

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

        if width < 18 or height < 18:
            continue

        if width > 220 or height > 220:
            continue

        results.append(
            {
                "image": src,
                "width": width,
                "height": height,
                "index": image.get("index"), 
            }
        )

    return results


def select_team_images(row: dict) -> list[dict]:
    combined_images = []
    seen_indices = set()

    for group in row.get("groups", []):
        for img in group:
            idx = img.get("index")
            if idx is not None and idx not in seen_indices:
                seen_indices.add(idx)
                combined_images.append(img)

    if (
        MIN_CHARACTERS_PER_PLAYER
        <= len(combined_images)
        <= MAX_CHARACTERS_PER_PLAYER
    ):
        return combined_images

    valid_groups = []

    for images in row.get("groups", []):
        if (
            MIN_CHARACTERS_PER_PLAYER
            <= len(images)
            <= MAX_CHARACTERS_PER_PLAYER
        ):
            valid_groups.append(images)

    if valid_groups:
        return max(valid_groups, key=len)

    all_images = row.get("all_images", [])

    if (
        MIN_CHARACTERS_PER_PLAYER
        <= len(all_images)
        <= MAX_CHARACTERS_PER_PLAYER
    ):
        return all_images

    return []


def find_best_row_selector(page) -> tuple[str | None, dict]:
    diagnostics = {}

    for selector in ROW_SELECTORS:
        rows = extract_rows_from_dom(page, selector)
        valid_rows = 0
        image_counts = []

        for row in rows[:30]:
            images = select_team_images(row)

            if images:
                valid_rows += 1
                image_counts.append(len(images))

        diagnostics[selector] = {
            "row_count": len(rows),
            "valid_rows": valid_rows,
            "image_counts": image_counts,
        }

    ranked = sorted(
        diagnostics.items(),
        key=lambda item: (
            item[1]["valid_rows"],
            item[1]["row_count"],
        ),
        reverse=True,
    )

    if not ranked:
        return None, diagnostics

    if ranked[0][1]["valid_rows"] == 0:
        return None, diagnostics

    return ranked[0][0], diagnostics


def create_player_identity(
    row: dict,
    page_number: int,
) -> str:
    attributes = row.get("attributes", {})

    preferred_attributes = [
        "data-player-id",
        "data-user-id",
        "data-id",
        "data-rank",
        "id",
    ]

    for attribute_name in preferred_attributes:
        value = str(
            attributes.get(attribute_name) or ""
        ).strip()

        if value:
            return (
                f"page:{page_number}:"
                f"{attribute_name}:{value}"
            )

    text = re.sub(
        r"\s+",
        " ",
        row.get("text") or "",
    ).strip()

    if text:
        digest = hashlib.sha256(
            text.encode("utf-8")
        ).hexdigest()

        return f"page:{page_number}:text:{digest}"

    return (
        f"page:{page_number}:"
        f"row:{row['row_index']}"
    )


def click_load_more(page) -> bool:
    for selector in LOAD_MORE_SELECTORS:
        try:
            candidates = page.locator(selector)
            count = min(candidates.count(), 10)
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
                    timeout=3_000
                )
                candidate.click(timeout=4_000)
                page.wait_for_timeout(LOAD_WAIT_MS)

                print(
                    "[INFO] 追加表示ボタンを押しました。"
                    f" selector={selector}"
                )
                return True
            except PlaywrightError:
                continue

    return False


def scroll_dynamic_content(page) -> bool:
    """ 【強化版】遅延ロード対策：ゆっくりと確実にページ一番下までスクロールして画像を全て読み込ませる """
    try:
        page.evaluate("""
            () => {
                document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                    img.setAttribute('loading', 'eager');
                });
            }
        """)

        result = page.evaluate(
            """
            async () => {
                let moved = false;
                const beforeWindow = window.scrollY;

                // 100msごとに400pxずつ、一番下まで確実になめらかにスクロール
                await new Promise((resolve) => {
                    let totalHeight = window.scrollY;
                    const distance = 400;
                    const timer = setInterval(() => {
                        const scrollHeight = document.documentElement.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight - window.innerHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });

                if (window.scrollY !== beforeWindow) {
                    moved = true;
                }

                return moved;
            }
            """
        )
        
        # スクロール完了後、画像がネットワークから降ってくるのを十分待つ
        page.wait_for_timeout(1500)
        return bool(result)
    except PlaywrightError:
        return False


def reset_scroll(page) -> None:
    try:
        page.evaluate(
            """
            () => {
                window.scrollTo(0, 0);

                for (const element of document.querySelectorAll('*')) {
                    const style = getComputedStyle(element);

                    if (
                        element.scrollHeight
                            > element.clientHeight + 100
                        && (
                            style.overflowY === 'auto'
                            || style.overflowY === 'scroll'
                        )
                    ) {
                        element.scrollTop = 0;
                    }
                }
            }
            """
        )
    except PlaywrightError:
        pass


def collect_current_page(
    page,
    selector: str,
    page_number: int,
    already_sampled: int,
) -> tuple[list[dict], dict]:
    collected = {}
    stable_attempts = 0
    previous_count = 0
    attempts = 0
    maximum_dom_rows = 0

    # ページを開いた直後に、まずは一番下までスクロールして全員の画像を読み込ませる
    scroll_dynamic_content(page)

    while attempts < MAX_LOAD_ATTEMPTS:
        attempts += 1

        rows = extract_rows_from_dom(page, selector)
        maximum_dom_rows = max(
            maximum_dom_rows,
            len(rows),
        )

        new_rows = 0

        for row in rows:
            images = select_team_images(row)

            if not images:
                continue

            identity = create_player_identity(
                row,
                page_number,
            )

            if identity in collected:
                continue

            collected[identity] = {
                "identity": identity,
                "images": images,
            }

            new_rows += 1

        current_count = len(collected)

        print(
            f"[INFO] page={page_number}, "
            f"attempt={attempts}, "
            f"dom_rows={len(rows)}, "
            f"new_rows={new_rows}, "
            f"collected={current_count}"
        )

        if (
            already_sampled + current_count
            >= TARGET_PLAYER_COUNT
        ):
            break

        if current_count == previous_count:
            stable_attempts += 1
        else:
            stable_attempts = 0

        previous_co
