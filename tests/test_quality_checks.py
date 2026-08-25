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


def valid_data(sampled_players=2, character_slots=2):
    categories = {
        kind: {
            "equipped_occurrence_count": 0,
            "equipped_player_count": 0,
            "items": [],
        }
        for kind in ("WEAPON", "ARMOR", "ACC")
    }
    return {
        "sampled_players": sampled_players,
        "character_slots": character_slots,
        "characters": [
            {
                "unit_code": "u-a",
                "name": "Alpha",
                "image": "x",
                "occurrence_count": 1,
                "player_count": 1,
                "equipment_rankings": categories,
            },
            {
                "unit_code": "u-b",
                "name": "Beta",
                "image": "y",
                "occurrence_count": 1,
                "player_count": 1,
                "equipment_rankings": {
                    kind: dict(value)
                    for kind, value in categories.items()
                },
            },
        ],
    }


def test_duplicate_and_drop_rejected():
    data = valid_data(sampled_players=100)
    data["characters"][1]["unit_code"] = "u-a"
    with pytest.raises(ValueError):
        validate_data(data, {"sampled_players": 100, "character_slots": 2})

    data["characters"][1]["unit_code"] = "u-b"
    data["sampled_players"] = 40
    with pytest.raises(ValueError):
        validate_data(data, {"sampled_players": 100, "character_slots": 2})


def test_valid_data():
    assert validate_data(valid_data())
