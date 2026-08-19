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

MIN_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MIN_CHARACTERS_PER_PLAYER", "5")
)

MAX_CHARACTERS_PER_PLAYER = int(
    os.environ.get("MAX_CHARACTERS_PER_PLAYER", "15")
)

DEBUG = os.environ.get("DEBUG", "0") == "1"

OUTPUT_PATH = Path("docs/data/character_usage.json")
DEBUG_DIR = Path(".artifacts/debug")

MAX_PAGES = 30
MAX_LOAD_ATTEMPTS = 50
STABLE_ATTEMPTS_LIMIT = 6
LOAD_WAIT_MS = 500

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
            }
        )

    # 重複排除しない
    return results


def select_team_images(row: dict) -> list[dict]:
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
    try:
        result = page.evaluate(
            """
            () => {
                let moved = false;

                const scrollables = Array.from(
                    document.querySelectorAll('*')
                ).filter((element) => {
                    const style = getComputedStyle(element);

                    return (
                        element.scrollHeight
                            > element.clientHeight + 100
                        && (
                            style.overflowY === 'auto'
                            || style.overflowY === 'scroll'
                        )
                    );
                });

                for (const element of scrollables) {
                    const before = element.scrollTop;
                    const step = Math.max(
                        400,
                        Math.floor(element.clientHeight * 0.8)
                    );

                    element.scrollTop = Math.min(
                        element.scrollTop + step,
                        element.scrollHeight
                    );

                    if (element.scrollTop !== before) {
                        moved = true;
                    }
                }

                const beforeWindow = window.scrollY;

                window.scrollTo(
                    0,
                    Math.min(
                        window.scrollY
                            + Math.max(600, window.innerHeight * 0.8),
                        document.documentElement.scrollHeight
                    )
                );

                if (window.scrollY !== beforeWindow) {
                    moved = true;
                }

                return moved;
            }
            """
        )

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

        previous_count = current_count

        clicked = click_load_more(page)
        moved = scroll_dynamic_content(page)

        if (
            stable_attempts >= STABLE_ATTEMPTS_LIMIT
            and not clicked
            and not moved
        ):
            break

        if stable_attempts >= STABLE_ATTEMPTS_LIMIT + 3:
            break

        page.wait_for_timeout(LOAD_WAIT_MS)

    return (
        list(collected.values()),
        {
            "attempts": attempts,
            "maximum_dom_rows": maximum_dom_rows,
            "collected_rows": len(collected),
        },
    )


def page_signature(page, selector: str) -> str:
    rows = extract_rows_from_dom(page, selector)

    text = "\n".join(
        row.get("text", "")[:300]
        for row in rows[:10]
    )

    if not text:
        text = page.url

    return hashlib.sha256(
        text.encode("utf-8")
    ).hexdigest()


def go_to_next_page(page, selector: str) -> bool:
    previous_signature = page_signature(
        page,
        selector,
    )
    previous_url = page.url

    reset_scroll(page)

    for button_selector in NEXT_PAGE_SELECTORS:
        try:
            candidates = page.locator(button_selector)
            count = min(candidates.count(), 20)
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
                    timeout=4_000
                )
                candidate.click(timeout=5_000)

                page.wait_for_timeout(1_500)

                new_signature = page_signature(
                    page,
                    selector,
                )

                if (
                    new_signature != previous_signature
                    or page.url != previous_url
                ):
                    print(
                        "[INFO] 次ページへ移動しました。"
                        f" selector={button_selector}"
                    )
                    return True
            except PlaywrightError:
                continue

    return False


def dump_debug(page, details: dict) -> None:
    DEBUG_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        (DEBUG_DIR / "page.html").write_text(
            page.content(),
            encoding="utf-8",
        )
    except PlaywrightError:
        pass

    try:
        page.screenshot(
            path=str(DEBUG_DIR / "screenshot.png"),
            full_page=True,
        )
    except PlaywrightError:
        pass

    try:
        images = page.locator("img").evaluate_all(
            """
            (images) => images.map((image) => {
                const rect = image.getBoundingClientRect();

                return {
                    src:
                        image.currentSrc
                        || image.getAttribute('src')
                        || image.getAttribute('data-src'),
                    alt: image.getAttribute('alt'),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    outerHtml: image.outerHTML.slice(0, 1000)
                };
            })
            """
        )

        save_json(
            DEBUG_DIR / "images.json",
            images,
        )
    except PlaywrightError:
        pass

    try:
        controls = page.locator(
            "button, a, [role='button']"
        ).evaluate_all(
            """
            (elements) => elements.map((element) => ({
                text: (
                    element.innerText
                    || element.textContent
                    || ''
                ).trim().slice(0, 200),
                ariaLabel: element.getAttribute('aria-label'),
                title: element.getAttribute('title'),
                className:
                    typeof element.className === 'string'
                        ? element.className
                        : '',
                disabled:
                    element.hasAttribute('disabled')
                    || element.getAttribute('aria-disabled') === 'true',
                outerHtml: element.outerHTML.slice(0, 1000)
            }))
            """
        )

        save_json(
            DEBUG_DIR / "controls.json",
            controls,
        )
    except PlaywrightError:
        pass

    save_json(
        DEBUG_DIR / "diagnostics.json",
        details,
    )


def scrape(page) -> dict:
    selector, selector_diagnostics = (
        find_best_row_selector(page)
    )

    if selector is None:
        raise RuntimeError(
            "プレイヤー行を特定できませんでした。"
        )

    print(f"[INFO] row selector={selector}")

    counts = defaultdict(
        lambda: {
            "occurrence_count": 0,
            "player_count": 0,
            "image": "",
        }
    )

    sampled_players = 0
    total_slots = 0
    player_sizes = []
    pages_scanned = 0
    termination_reason = "unknown"
    visited_pages = set()
    page_diagnostics = []

    while (
        sampled_players < TARGET_PLAYER_COUNT
        and pages_scanned < MAX_PAGES
    ):
        signature = page_signature(page, selector)

        if signature in visited_pages:
            termination_reason = "duplicate_page"
            break

        visited_pages.add(signature)
        pages_scanned += 1

        page_rows, diagnostics = collect_current_page(
            page,
            selector,
            pages_scanned,
            sampled_players,
        )

        page_players = 0
        page_slots = 0

        for row in page_rows:
            if sampled_players >= TARGET_PLAYER_COUNT:
                break

            images = row["images"]

            if not (
                MIN_CHARACTERS_PER_PLAYER
                <= len(images)
                <= MAX_CHARACTERS_PER_PLAYER
            ):
                continue

            sampled_players += 1
            page_players += 1

            slot_count = len(images)
            total_slots += slot_count
            page_slots += slot_count
            player_sizes.append(slot_count)

            # occurrence_countでは重複を残す
            player_character_keys = set()

            for image in images:
                key = character_key(image["image"])

                counts[key]["occurrence_count"] += 1
                counts[key]["image"] = image["image"]

                # player_countでは同一人物内の重複だけを1件にする
                player_character_keys.add(key)

            for key in player_character_keys:
                counts[key]["player_count"] += 1

        page_diagnostics.append(
            {
                "page": pages_scanned,
                "players": page_players,
                "slots": page_slots,
                **diagnostics,
            }
        )

        print(
            f"[INFO] page={pages_scanned}, "
            f"players={page_players}, "
            f"total_players={sampled_players}, "
            f"total_slots={total_slots}"
        )

        if sampled_players >= TARGET_PLAYER_COUNT:
            termination_reason = "target_reached"
            break

        if page_players == 0:
            termination_reason = "no_valid_players"
            break

        if not go_to_next_page(page, selector):
            termination_reason = "no_next_page"
            break

    if sampled_players < MIN_REQUIRED_PLAYERS:
        raise RuntimeError(
            "品質基準を満たしません。"
            f"取得人数={sampled_players}, "
            f"必要人数={MIN_REQUIRED_PLAYERS}, "
            f"終了理由={termination_reason}"
        )

    characters = []

    for data in counts.values():
        occurrence_count = int(
            data["occurrence_count"]
        )
        player_count = int(
            data["player_count"]
        )

        if player_count > sampled_players:
            raise RuntimeError(
                "採用人数が集計人数を超えています。"
                f"採用人数={player_count}, "
                f"集計人数={sampled_players}, "
                f"画像={data['image']}"
            )

        adoption_rate = round(
            player_count / sampled_players * 100,
            1,
        )

        slot_rate = (
            round(
                occurrence_count / total_slots * 100,
                2,
            )
            if total_slots > 0
            else 0
        )

        characters.append(
            {
                "image": data["image"],
                "occurrence_count": occurrence_count,
                "player_count": player_count,
                "adoption_rate": adoption_rate,
                "slot_rate": slot_rate,
            }
        )

    characters.sort(
        key=lambda item: (
            -item["occurrence_count"],
            -item["player_count"],
            item["image"],
        )
    )

    previous_count = None
    current_rank = 0

    for index, character in enumerate(
        characters,
        start=1,
    ):
        if (
            character["occurrence_count"]
            != previous_count
        ):
            current_rank = index

        character["rank"] = current_rank
        previous_count = character[
            "occurrence_count"
        ]

    calculated_slots = sum(
        character["occurrence_count"]
        for character in characters
    )

    if calculated_slots != total_slots:
        raise RuntimeError(
            "キャラクター総数が一致しません。"
            f"取得枠数={total_slots}, "
            f"キャラクター別合計={calculated_slots}"
        )

    return {
        "schema_version": 3,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "source": {
            "name": SOURCE_NAME,
            "url": TARGET_URL,
        },
        "league": "レジェンド",
        "target_players": TARGET_PLAYER_COUNT,
        "sampled_players": sampled_players,
        "character_slots": total_slots,
        "unique_characters": len(characters),
        "median_characters_per_player": (
            median(player_sizes)
            if player_sizes
            else 0
        ),
        "pages_scanned": pages_scanned,
        "termination_reason": termination_reason,
        "complete_target": (
            sampled_players >= TARGET_PLAYER_COUNT
        ),
        "characters": characters,
        "diagnostics": {
            "row_selector": selector,
            "selector_results": selector_diagnostics,
            "pages": page_diagnostics,
        },
    }


def write_output(data: dict) -> None:
    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = OUTPUT_PATH.with_suffix(
        ".json.tmp"
    )

    save_json(temporary_path, data)
    temporary_path.replace(OUTPUT_PATH)


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ],
        )

        context = browser.new_context(
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            viewport={
                "width": 1440,
                "height": 1200,
            },
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/131.0 Safari/537.36"
            ),
        )

        page = context.new_page()
        page.set_default_timeout(10_000)

        try:
            response = page.goto(
                TARGET_URL,
                wait_until="domcontentloaded",
                timeout=60_000,
            )

            if (
                response is not None
                and response.status >= 400
            ):
                raise RuntimeError(
                    f"HTTPエラー: {response.status}"
                )

            try:
                page.wait_for_load_state(
                    "networkidle",
                    timeout=12_000,
                )
            except PlaywrightTimeoutError:
                print(
                    "[WARN] networkidle待機が"
                    "タイムアウトしました。"
                )

            page.wait_for_timeout(2_000)
            dismiss_common_dialogs(page)
            select_legend_league(page)
            page.wait_for_timeout(1_500)

            if DEBUG:
                selector, diagnostics = (
                    find_best_row_selector(page)
                )

                dump_debug(
                    page,
                    {
                        "mode": "debug",
                        "selector": selector,
                        "diagnostics": diagnostics,
                    },
                )

                print(
                    "[DEBUG] 調査ファイルを保存しました。"
                )
                return

            data = scrape(page)
            write_output(data)

            dump_debug(
                page,
                {
                    "mode": "success",
                    "sampled_players": data[
                        "sampled_players"
                    ],
                    "character_slots": data[
                        "character_slots"
                    ],
                    "termination_reason": data[
                        "termination_reason"
                    ],
                    "diagnostics": data[
                        "diagnostics"
                    ],
                },
            )

            print(
                "[DONE] "
                f"players={data['sampled_players']}, "
                f"slots={data['character_slots']}, "
                f"characters={len(data['characters'])}, "
                f"termination={data['termination_reason']}"
            )

        except Exception as error:
            print(
                f"[ERROR] {error}",
                file=sys.stderr,
            )

            dump_debug(
                page,
                {
                    "mode": "error",
                    "error": str(error),
                },
            )

            raise

        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
