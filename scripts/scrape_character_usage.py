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
    200人に到達するまで、ページの最後まで巡回して確実に取得する。
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
    os.environ.get("MAX_LOAD_ATTEMPTS", "200")
)

STABLE_ATTEMPTS_LIMIT = int(
    os.environ.get("STABLE_ATTEMPTS_LIMIT", "6")
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

LOAD_MORE_SELECTORS = [
    "button:has-text('もっと見る')",
    "a:has-text('もっと見る')",
    "button:has-text('さらに表示')",
    "a:has-text('さらに表示')",
    "button:has-text('Load more')",
    "a:has-text('Load more')",
    "button:has-text('Show more')",
    "a:has-text('Show more')",
]

NEXT_PAGE_SELECTORS = [
    "button[aria-label='Go to next page']",
    "a[aria-label='Go to next page']",
    "button[aria-label*='next' i]",
    "a[aria-label*='next' i]",
    "button:has-text('次へ')",
    "a:has-text('次へ')",
    "button:has-text('Next')",
    "a:has-text('Next')",
    "button:has-text('›')",
    "a:has-text('›')",
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

PLACEHOLDER_WORDS = {
    "blank",
    "default",
    "fallback",
    "loading",
    "placeholder",
    "spinner",
    "transparent",
}

_SPACE_CHARACTERS = re.compile(r"\s+")


def normalize_text(value: str) -> str:
    return _SPACE_CHARACTERS.sub(" ", value or "").strip()


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def resolve_display_image_url(url: str) -> str:
    if not url:
        return ""
    value = url.strip()
    if not value or value.lower().startswith(("data:", "blob:", "javascript:", "about:")):
        return ""
    absolute_url = urljoin(TARGET_URL, value)
    parts = urlsplit(absolute_url)
    if parts.scheme.lower() not in {"http", "https"}:
        return ""
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, ""))


def is_placeholder(url: str) -> bool:
    if not url:
        return True
    lower = url.lower()
    return any(word in lower for word in PLACEHOLDER_WORDS)


def character_key(image_url: str) -> str:
    resolved = resolve_display_image_url(image_url)
    return resolved if resolved else "unknown"


def is_disabled(locator) -> bool:
    try:
        return (
            locator.get_attribute("disabled") is not None
            or locator.get_attribute("aria-disabled") == "true"
            or "disabled" in (locator.get_attribute("class") or "").lower()
        )
    except PlaywrightError:
        return True


def dismiss_common_dialogs(page) -> None:
    for label in ["同意する", "許可する", "Accept", "OK", "閉じる", "Close"]:
        try:
            buttons = page.get_by_role("button", name=label, exact=True)
            if buttons.count() > 0 and buttons.first.is_visible():
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
    ]
    for selector in selectors:
        try:
            candidates = page.locator(selector)
            for index in range(min(candidates.count(), 5)):
                candidate = candidates.nth(index)
                if candidate.is_visible() and not is_disabled(candidate):
                    candidate.click(timeout=3_000)
                    page.wait_for_timeout(1_500)
                    print(f"[INFO] レジェンドリーグを選択しました。 selector={selector}")
                    return
        except PlaywrightError:
            continue
    print("[INFO] レジェンド選択ボタンは見つかりませんでした。現在の表示内容で処理します。")


def extract_rows_from_dom(page) -> list[dict]:
    try:
        return page.evaluate(
            """
            (rowSelectors) => {
                const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim();

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

                // 最も確実な行要素のグループを見つける
                let selectedRows = [];
                for (const selector of rowSelectors) {
                    try {
                        const rows = Array.from(document.querySelectorAll(selector));
                        const validRows = rows.filter(r => r.isConnected && r.querySelectorAll('img').length > 0);
                        if (validRows.length > 0) {
                            selectedRows = validRows;
                            break;
                        }
                    } catch {}
                }

                if (selectedRows.length === 0) {
                    // フォールバック：画像を含むコンテナ行を広く探す
                    selectedRows = Array.from(document.querySelectorAll('tr, li, div')).filter(el => {
                        return el.querySelectorAll('img').length >= 1 && el.querySelectorAll('img').length <= 25;
                    });
                }

                return selectedRows.map((row, rowIndex) => {
                    const images = [];
                    const seenImgs = new Set();

                    // 行内のすべての画像を走査
                    for (const img of row.querySelectorAll('img')) {
                        if (seenImgs.has(img)) continue;
                        seenImgs.add(img);

                        const src = (
                            img.currentSrc
                            || img.getAttribute('src')
                            || img.getAttribute('data-src')
                            || img.getAttribute('data-lazy-src')
                            || img.getAttribute('data-original')
                            || ''
                        ).trim();

                        if (!src) continue;

                        const alt = normalizeText(img.getAttribute('alt') || '');
                        const title = normalizeText(img.getAttribute('title') || '');
                        const rect = img.getBoundingClientRect();

                        images.push({
                            index: images.length,
                            src,
                            alt,
                            title,
                            width: Math.round(rect.width),
                            height: Math.round(rect.height)
                        });
                    }

                    const rowText = normalizeText(row.innerText || '').slice(0, 300);
                    const explicitId = row.getAttribute('data-player-id') || row.getAttribute('data-player') || '';
                    const identity = explicitId || rowText || `row:${rowIndex}`;

                    return {
                        row_index: rowIndex,
                        identity,
                        text: rowText,
                        images
                    };
                });
            }
            """,
            ROW_SELECTORS,
        )
    except PlaywrightError as error:
        print(f"[WARN] DOM取得エラー: {error}")
        return []


def is_character_image(img_data: dict) -> bool:
    src = img_data.get("src", "").lower()
    if not src or is_placeholder(src):
        return false

    for word in EXCLUDED_SOURCE_WORDS:
        if word in src and not any(p in src for p in ["chara", "ranger", "unit", "character"]):
            return false

    width = img_data.get("width", 0)
    height = img_data.get("height", 0)
    if width > 0 and height > 0:
        if width < 15 or height < 15:
            return false
        if width > 300 or height > 300:
            return false

    return true


def extract_character_images(row: dict) -> list[dict]:
    candidates = []
    for img in row.get("images", []):
        if not is_character_image(img):
            continue

        resolved_url = resolve_display_image_url(img.get("src", ""))
        if not resolved_url:
            continue

        candidates.append(
            {
                "index": img.get("index", 0),
                "image_url": resolved_url,
                "name": img.get("alt") or img.get("title") or "",
            }
        )

    # 1プレイヤーあたりの上限（最大10体）
    if len(candidates) > MAX_CHARACTERS_PER_PLAYER:
        candidates = candidates[:MAX_CHARACTERS_PER_PLAYER]

    return candidates


def make_player_key(row: dict, page_number: int) -> str:
    identity = normalize_text(row.get("identity", ""))
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
            "characters": characters,
            "page_number": page_number,
            "row_index": row.get("row_index", 0),
        }

        previous = players.get(player_key)
        if previous is None or len(characters) > len(previous.get("characters", [])):
            players[player_key] = snapshot
            changed += 1

    return changed


def load_players(page) -> list[dict]:
    players: dict[str, dict] = {}
    stable_attempts = 0
    page_number = 1

    for attempt in range(1, MAX_LOAD_ATTEMPTS + 1):
        # 画面を少しずつスクロールして遅延読み込みを確実に発火させる
        try:
            page.evaluate("window.scrollBy({ top: 500, left: 0, behavior: 'auto' });")
        except PlaywrightError:
            pass
        page.wait_for_timeout(300)

        rows = extract_rows_from_dom(page)
        merged = merge_rows(players, rows, page_number)

        current_count = len(players)
        print(f"[INFO] 取得人数: {current_count}人 (試行回数: {attempt})")

        if merged > 0:
            stable_attempts = 0
        else:
            stable_attempts += 1

        # 目標人数（200人）に達し、安定したら終了
        if current_count >= TARGET_PLAYER_COUNT and stable_attempts >= STABLE_ATTEMPTS_LIMIT:
            print("[INFO] 目標人数に到達しました。")
            break

        if stable_attempts >= STABLE_ATTEMPTS_LIMIT * 2:
            print("[INFO] これ以上新しいプレイヤーが見つからないため読み込みを終了します。")
            break

    ordered_players = sorted(
        players.values(),
        key=lambda p: (p.get("page_number", 0), p.get("row_index", 0)),
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
            image_url = character.get("image_url", "")
            if not image_url or is_placeholder(image_url):
                continue
            key = character_key(image_url)
            if key == "unknown":
                continue
            valid_characters.append({**character, "character_key": key})

        if len(valid_characters) < MIN_CHARACTERS_PER_PLAYER:
            continue

        accepted_players.append(player)
        seen_keys = set()

        for character in valid_characters:
            key = character["character_key"]
            occurrence_count[key] += 1
            image_urls[key] = character["image_url"]
            name = normalize_text(character.get("name", ""))
            if name:
                character_names[key][name] += 1
            seen_keys.add(key)

        for key in seen_keys:
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
        key=lambda c: (-c["player_count"], -c["occurrence_count"], c["character_name"])
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
        page = context.new_page()

        page.set_default_timeout(15_000)
        page.set_default_navigation_timeout(30_000)

        try:
            page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_timeout(2_000)
            dismiss_common_dialogs(page)
            select_legend_league(page)
            page.wait_for_timeout(2_000)

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
