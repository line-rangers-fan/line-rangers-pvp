import pytest

from scripts.quality_checks import equipment_rankings, validate_data


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
    categories = {
        kind: {
            "equipped_occurrence_count": 0,
            "equipped_player_count": 0,
            "items": [],
        }
        for kind in ("WEAPON", "ARMOR", "ACC")
    }
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
                    kind: dict(value)
                    for kind, value in categories.items()
                },
            }
        )
        previous_count = occurrence_count
        previous_rank = rank

    return {
        "schema_version": 8,
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
            "equipment_slots_collected": 0,
            "equipment_slots_expected": character_slots * 3,
            "equipment_slots_missing": character_slots * 3,
            "equipment_fill_rate": 0.0,
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
