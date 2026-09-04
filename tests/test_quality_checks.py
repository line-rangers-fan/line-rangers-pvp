import pytest

from scripts.quality_checks import (
    MAX_COLLECTION_DURATION_SECONDS,
    MIN_EQUIPMENT_RETENTION_RATIO,
    RANK_PERIODS,
    SCHEMA_VERSION,
    equipment_rankings,
    validate_data,
)


def test_equipment_counts_and_unique_players():
    rows = equipment_rankings(
        [
            {
                "equipment": [
                    {"type": "WEAPON", "item_code": "w1"},
                    {"type": "WEAPON", "item_code": "w1"},
                ]
            },
            {
                "equipment": [
                    {"type": "WEAPON", "item_code": "w1"},
                    {"type": "ARMOR", "item_code": "a1"},
                ]
            },
        ]
    )

    assert rows["WEAPON"][0]["occurrence_count"] == 3
    assert rows["WEAPON"][0]["player_count"] == 2
    assert rows["WEAPON"][0]["rank"] == 1


def valid_data(sampled_players=2, character_slots=None):
    character_slots = character_slots or sampled_players
    first_count = character_slots // 2
    second_count = character_slots - first_count
    rows = [
        ("u-a", "Alpha", "x", first_count),
        ("u-b", "Beta", "y", second_count),
    ]
    rows.sort(key=lambda row: (-row[3], row[0]))
    previous_count = None
    previous_rank = 0
    characters = []
    for index, (unit_code, name, image, occurrence_count) in enumerate(rows, start=1):
        rank = index if occurrence_count != previous_count else previous_rank
        characters.append(
            {
                "unit_code": unit_code,
                "name": name,
                "image": image,
                "occurrence_count": occurrence_count,
                "player_count": 1,
                "adoption_rate": round(1 / sampled_players * 100, 1),
                "slot_rate": round(occurrence_count / character_slots * 100, 2),
                "rank": rank,
                "equipment_rankings": {
                    kind: {
                        "equipped_occurrence_count": occurrence_count,
                        "equipped_player_count": 1,
                        "items": [
                            {
                                "item_code": f"{kind.lower()}-{unit_code}",
                                "image": "",
                                "occurrence_count": occurrence_count,
                                "player_count": 1,
                                "adoption_rate": 100.0,
                                "rank": 1,
                            }
                        ],
                    }
                    for kind in ("WEAPON", "ARMOR", "ACC")
                },
            }
        )
        previous_count = occurrence_count
        previous_rank = rank

    data = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": "2026-08-27T03:00:00+00:00",
        "target_players": sampled_players,
        "sampled_players": sampled_players,
        "complete_target": True,
        "character_slots": character_slots,
        "unique_characters": 2,
        "collection_quality": {
            "collection_started_at": "2026-08-27T02:59:00+00:00",
            "collection_duration_seconds": 60.0,
            "detail_fetch_duration_seconds": 45.0,
            "sample_coverage": 100.0,
            "equipment_slots_collected": character_slots * 3,
            "equipment_slots_expected": character_slots * 3,
            "equipment_slots_missing": 0,
            "equipment_fill_rate": 100.0,
            "detail_fetch_failures": 0,
            "invalid_player_records": 0,
        },
        "characters": characters,
        "diagnostics": {
            "valid_players": sampled_players,
            "detail_fetches_requested": sampled_players,
            "detail_fetch_failures": [],
            "missing_player_info": [],
            "invalid_players": [],
            "invalid_unit_codes": [],
            "invalid_equipment": [],
            "invalid_rank_records": [],
            "team_size_distribution": {"1": sampled_players},
        },
    }
    from scripts.scrape_character_usage import add_previous_comparison
    return add_previous_comparison(data, None, {"snapshots": []})


def test_duplicate_and_drop_rejected():
    data = valid_data(sampled_players=100)
    data["characters"][1]["unit_code"] = "u-a"
    with pytest.raises(ValueError):
        validate_data(data, {"sampled_players": 100, "character_slots": 100})

    data["characters"][1]["unit_code"] = "u-b"
    data["sampled_players"] = 40
    with pytest.raises(ValueError):
        validate_data(data, {"sampled_players": 100, "character_slots": 100})


def test_valid_data():
    assert validate_data(valid_data())


def remove_equipment(data, equipment_types):
    removed = 0
    for character in data["characters"]:
        for equipment_type in equipment_types:
            category = character["equipment_rankings"][equipment_type]
            removed += category["equipped_occurrence_count"]
            category["equipped_occurrence_count"] = 0
            category["equipped_player_count"] = 0
            category["items"] = []
    quality = data["collection_quality"]
    quality["equipment_slots_collected"] -= removed
    quality["equipment_slots_missing"] += removed
    quality["equipment_fill_rate"] = round(
        quality["equipment_slots_collected"]
        / quality["equipment_slots_expected"]
        * 100,
        1,
    )


def test_empty_equipment_category_is_rejected_without_a_strict_fill_floor():
    data = valid_data(sampled_players=200)
    remove_equipment(data, ("WEAPON",))

    with pytest.raises(ValueError, match="empty WEAPON aggregate"):
        validate_data(data)


def test_large_equipment_drop_is_rejected_against_last_known_good_data():
    from scripts.scrape_character_usage import add_previous_comparison

    previous = valid_data(sampled_players=200)
    current = valid_data(sampled_players=200)
    current["updated_at"] = "2026-08-27T04:00:00+00:00"
    current["collection_quality"]["collection_started_at"] = (
        "2026-08-27T03:59:00+00:00"
    )
    # Retain one valid occurrence in every category, so this exercises the
    # relative collapse guard rather than the empty-category guard.
    for character in current["characters"]:
        for category in character["equipment_rankings"].values():
            category["equipped_occurrence_count"] = 1
            category["equipped_player_count"] = 1
            category["items"][0]["occurrence_count"] = 1
    quality = current["collection_quality"]
    quality["equipment_slots_collected"] = len(current["characters"]) * 3
    quality["equipment_slots_missing"] = (
        quality["equipment_slots_expected"] - quality["equipment_slots_collected"]
    )
    quality["equipment_fill_rate"] = round(
        quality["equipment_slots_collected"]
        / quality["equipment_slots_expected"]
        * 100,
        1,
    )
    add_previous_comparison(current, previous, {"snapshots": []})

    assert quality["equipment_fill_rate"] < (
        previous["collection_quality"]["equipment_fill_rate"]
        * MIN_EQUIPMENT_RETENTION_RATIO
    )
    with pytest.raises(ValueError, match="equipment fill rate dropped by 80%"):
        validate_data(current, previous)


def test_optional_cached_character_images_are_same_unit_and_counted():
    data = valid_data()
    code = data["characters"][0]["unit_code"]
    data["characters"][0]["cached_image"] = f"./assets/characters/{code}.png"
    data["characters"][0]["cached_image_version"] = "0123456789ab"
    data["character_assets"] = {
        "characters": 2,
        "cached_images": 1,
        "pending_images": 1,
        "downloaded_images": 1,
        "refresh_attempted": 1,
        "refresh_updated": 0,
        "refresh_unavailable": 1,
    }
    assert validate_data(data)

    data["characters"][0]["cached_image"] = "./assets/characters/other.png"
    with pytest.raises(ValueError, match="cached character image|asset summary"):
        validate_data(data)

    data = valid_data()
    data["characters"][0]["cached_image_version"] = "../bad"
    with pytest.raises(ValueError, match="cached character image version"):
        validate_data(data)


def test_character_asset_refresh_summary_must_be_complete_and_consistent():
    data = valid_data()
    code = data["characters"][0]["unit_code"]
    data["characters"][0]["cached_image"] = f"./assets/characters/{code}.png"
    data["characters"][0]["cached_image_version"] = "123456789abc"
    data["character_assets"] = {
        "characters": 2,
        "cached_images": 1,
        "pending_images": 1,
        "downloaded_images": 0,
        "refresh_attempted": 1,
        "refresh_updated": 0,
    }

    with pytest.raises(ValueError, match="asset refresh summary"):
        validate_data(data)


def test_comparison_contract_requires_all_four_periods():
    assert RANK_PERIODS == ("hour", "day", "week", "month")


def test_incomplete_sample_rejected():
    data = valid_data()
    data["complete_target"] = False
    with pytest.raises(ValueError, match="incomplete sample"):
        validate_data(data)


def test_wrong_rate_rank_and_quality_are_rejected():
    data = valid_data()
    data["characters"][0]["adoption_rate"] = 99.9
    data["characters"][0]["rank"] = 9
    data["collection_quality"]["equipment_slots_expected"] = 999

    with pytest.raises(
        ValueError,
        match="adoption rate mismatch|character rank|equipment slot expectation",
    ):
        validate_data(data)

    data["complete_target"] = True
    data["target_players"] = 3
    with pytest.raises(ValueError, match="incomplete sample"):
        validate_data(data)


def test_invalid_collection_timing_is_rejected():
    data = valid_data()
    data["collection_quality"]["detail_fetch_duration_seconds"] = 61.0

    with pytest.raises(ValueError, match="collection timing"):
        validate_data(data)

    data = valid_data()
    data["collection_quality"]["collection_duration_seconds"] = (
        MAX_COLLECTION_DURATION_SECONDS + 1
    )
    with pytest.raises(ValueError, match="collection timing"):
        validate_data(data)
