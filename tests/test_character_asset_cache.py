"""Automatic character image caching stays optional, bounded and same-unit."""

from io import BytesIO

from scripts import cache_character_images as cache
from test_quality_checks import valid_data


def png(width=64, height=64):
    return (
        cache.PNG_SIGNATURE
        + b"\x00\x00\x00\x0dIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + b"\x08\x06\x00\x00\x00"
        + b"\x00\x00\x00\x00"
        + b"\x00\x00\x00\x00IEND\xaeB\x60\x82"
    )


class Response(BytesIO):
    status = 200
    headers = {}


class Opener:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request.full_url, timeout))
        value = self.responses.get(request.full_url)
        if value is None:
            raise TimeoutError("fixture image unavailable")
        return Response(value)


def character(unit_code):
    return {
        "unit_code": unit_code,
        "image": cache.collector.character_image_url(unit_code),
    }


def test_cache_downloads_only_verified_same_unit_png(tmp_path, monkeypatch):
    available = character("u100e-test")
    missing = character("u101h-test")
    opener = Opener({available["image"]: png()})
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache.collector, "SOURCE_OPENER", opener)
    monkeypatch.setattr(cache, "sleep", lambda _seconds: None)
    data = {"characters": [available, missing]}

    stats = cache.cache_character_images(data)

    assert stats == {
        "characters": 2,
        "cached_images": 1,
        "pending_images": 1,
        "downloaded_images": 1,
    }
    assert available["cached_image"] == "./assets/characters/u100e-test.png"
    assert available["cached_image_version"] == cache.cached_image_version(
        tmp_path / "u100e-test.png"
    )
    assert "cached_image" not in missing
    assert "cached_image_version" not in missing
    assert (tmp_path / "u100e-test.png").read_bytes() == png()
    assert all(timeout == cache.IMAGE_FETCH_TIMEOUT_SECONDS for _, timeout in opener.requests)


def test_existing_valid_cache_avoids_network_and_is_reused(tmp_path, monkeypatch):
    unit = character("u100e-test")
    (tmp_path / "u100e-test.png").write_bytes(png())
    opener = Opener({})
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache.collector, "SOURCE_OPENER", opener)

    stats = cache.cache_character_images({"characters": [unit]})

    assert stats["cached_images"] == 1
    assert stats["downloaded_images"] == 0
    assert unit["cached_image"] == "./assets/characters/u100e-test.png"
    assert len(unit["cached_image_version"]) == 12
    assert opener.requests == []


def test_invalid_or_oversized_images_never_become_public_cache(tmp_path, monkeypatch):
    assert not cache.valid_png(b"<html>not an image</html>")
    assert not cache.valid_png(png(width=4096))
    assert not cache.valid_png(b"x" * (cache.MAX_IMAGE_BYTES + 1))
    try:
        cache.cached_image_location("../../escape")
    except ValueError:
        pass
    else:
        raise AssertionError("unsafe unit code was accepted")

    unit = character("u100e-test")
    opener = Opener({unit["image"]: b"<html>not an image</html>"})
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache.collector, "SOURCE_OPENER", opener)
    monkeypatch.setattr(cache, "sleep", lambda _seconds: None)
    stats = cache.cache_character_images({"characters": [unit]})
    assert stats["cached_images"] == 0
    assert "cached_image" not in unit
    assert "cached_image_version" not in unit
    assert not (tmp_path / "u100e-test.png").exists()


def test_main_updates_data_and_matching_health_atomically(tmp_path, monkeypatch):
    data = valid_data()
    data_path = tmp_path / "data.json"
    health_path = tmp_path / "health.json"
    cache_dir = tmp_path / "characters"
    for character in data["characters"]:
        character["image"] = cache.collector.character_image_url(
            character["unit_code"]
        )
        path = cache_dir / f"{character['unit_code']}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png())
    cache.collector.save_json(data_path, data)
    cache.collector.save_json(health_path, cache.collector.health_summary(data))
    monkeypatch.setattr(cache, "DATA_PATH", data_path)
    monkeypatch.setattr(cache, "HEALTH_PATH", health_path)
    monkeypatch.setattr(cache, "CACHE_DIR", cache_dir)

    cache.main()

    published = cache.collector.load_json(data_path)
    health = cache.collector.load_json(health_path)
    assert published["character_assets"]["cached_images"] == 2
    assert health["character_assets"] == published["character_assets"]
    assert all("cached_image" in row for row in published["characters"])
    assert all("cached_image_version" in row for row in published["characters"])
