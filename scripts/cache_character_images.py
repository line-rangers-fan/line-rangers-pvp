"""Cache verified canonical character thumbnails without blocking core statistics.

The ranking and player APIs are the publication contract. Character thumbnails
are optional presentation assets: a missing or slow image must never prevent a
complete 200-player aggregate from being published. This helper runs after the
collector, stores only bounded PNG files from the trusted source host, and adds
an exact same-unit local path to the public JSON.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from http.client import HTTPException
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request

try:
    from scripts import scrape_character_usage as collector
except ImportError:  # Supports `python scripts/cache_character_images.py` in CI.
    import scrape_character_usage as collector


DATA_PATH = collector.OUTPUT_PATH
HEALTH_PATH = collector.HEALTH_PATH
CACHE_DIR = Path("docs/assets/characters")
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_DIMENSION = 1024
MIN_IMAGE_DIMENSION = 16
IMAGE_FETCH_ATTEMPTS = 2
IMAGE_FETCH_TIMEOUT_SECONDS = 8
IMAGE_FETCH_WORKERS = 4
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def cached_image_location(unit_code: str) -> tuple[Path, str]:
    if not collector.UNIT_CODE_PATTERN.fullmatch(unit_code):
        raise ValueError("Invalid unit code for image cache.")
    return CACHE_DIR / f"{unit_code}.png", f"./assets/characters/{unit_code}.png"


def valid_png(data: bytes) -> bool:
    """Validate the small structural subset needed for a safe thumbnail."""
    if not isinstance(data, bytes) or not (33 <= len(data) <= MAX_IMAGE_BYTES):
        return False
    if not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        return False
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if not (
        MIN_IMAGE_DIMENSION <= width <= MAX_IMAGE_DIMENSION
        and MIN_IMAGE_DIMENSION <= height <= MAX_IMAGE_DIMENSION
    ):
        return False
    return data[-8:-4] == b"IEND"


def valid_cached_file(path: Path) -> bool:
    try:
        if path.stat().st_size > MAX_IMAGE_BYTES:
            return False
        return valid_png(path.read_bytes())
    except OSError:
        return False


def _read_bounded_image(response: object) -> bytes:
    headers = getattr(response, "headers", None)
    content_length = headers.get("Content-Length") if headers else None
    if content_length:
        try:
            if int(content_length) > MAX_IMAGE_BYTES:
                raise RuntimeError("Character image exceeds the safety limit.")
        except ValueError:
            pass
    data = response.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise RuntimeError("Character image exceeds the safety limit.")
    if not valid_png(data):
        raise RuntimeError("Character image is not a valid bounded PNG.")
    return data


def fetch_canonical_image(unit_code: str, image_url: str) -> bytes | None:
    expected_url = collector.character_image_url(unit_code)
    if image_url != expected_url or not collector.is_trusted_source_url(image_url):
        return None
    request = Request(
        image_url,
        headers={
            "Accept": "image/png",
            "User-Agent": "line-rangers-pvp-stats/1.1",
        },
    )
    for attempt in range(1, IMAGE_FETCH_ATTEMPTS + 1):
        try:
            with collector.SOURCE_OPENER.open(
                request, timeout=IMAGE_FETCH_TIMEOUT_SECONDS
            ) as response:
                status = getattr(response, "status", 200)
                if status >= 400:
                    return None
                return _read_bounded_image(response)
        except HTTPError as error:
            if error.code < 500 and error.code != 429:
                return None
        except (URLError, TimeoutError, OSError, HTTPException, RuntimeError):
            pass
        if attempt < IMAGE_FETCH_ATTEMPTS:
            sleep(0.5)
    return None


def cache_one_character(unit_code: str, image_url: str) -> bool:
    path, _ = cached_image_location(unit_code)
    if valid_cached_file(path):
        return True
    data = fetch_canonical_image(unit_code, image_url)
    if data is None:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".png.tmp")
    try:
        temporary.write_bytes(data)
        if not valid_cached_file(temporary):
            return False
        temporary.replace(path)
        return True
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def cache_character_images(data: dict) -> dict[str, int]:
    characters = data.get("characters")
    if not isinstance(characters, list):
        raise ValueError("Published data is missing the character list.")

    pending: list[tuple[str, str]] = []
    for character in characters:
        if not isinstance(character, dict):
            raise ValueError("Published character row is invalid.")
        character.pop("cached_image", None)
        unit_code = str(character.get("unit_code") or "")
        image_url = str(character.get("image") or "")
        path, _ = cached_image_location(unit_code)
        if not valid_cached_file(path):
            pending.append((unit_code, image_url))

    downloaded = 0
    if pending:
        with ThreadPoolExecutor(max_workers=IMAGE_FETCH_WORKERS) as executor:
            futures = {
                executor.submit(cache_one_character, unit_code, image_url): unit_code
                for unit_code, image_url in pending
            }
            for future in as_completed(futures):
                try:
                    downloaded += int(bool(future.result()))
                except Exception:
                    # An optional asset must never reject already validated data.
                    pass

    cached = 0
    for character in characters:
        unit_code = str(character.get("unit_code") or "")
        path, public_path = cached_image_location(unit_code)
        if valid_cached_file(path):
            character["cached_image"] = public_path
            cached += 1

    return {
        "characters": len(characters),
        "cached_images": cached,
        "pending_images": len(characters) - cached,
        "downloaded_images": downloaded,
    }


def _atomic_save(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    collector.save_json(temporary, value)
    temporary.replace(path)


def main() -> None:
    data = collector.load_json(DATA_PATH)
    if not isinstance(data, dict):
        raise RuntimeError("Cannot cache images without valid collected data.")
    collector.validate_data(data)
    stats = cache_character_images(data)
    data["character_assets"] = stats
    collector.validate_data(data)
    _atomic_save(DATA_PATH, data)

    health = collector.load_json(HEALTH_PATH)
    if isinstance(health, dict) and health.get("updated_at") == data.get("updated_at"):
        health["character_assets"] = stats
        _atomic_save(HEALTH_PATH, health)

    print(
        "[ASSETS] "
        f"cached={stats['cached_images']}/{stats['characters']}, "
        f"downloaded={stats['downloaded_images']}, "
        f"pending={stats['pending_images']}"
    )


if __name__ == "__main__":
    main()
