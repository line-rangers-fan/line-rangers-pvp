import pytest
from scripts.quality_checks import equipment_rankings, validate_data

def test_equipment_counts_and_unique_players():
    rows = equipment_rankings([{"equipment":[{"type":"WEAPON","id":"w1"},{"type":"WEAPON","id":"w1"}]},{"equipment":[{"type":"WEAPON","id":"w1"},{"type":"ARMOR","id":"a1"}]}])
    assert rows["WEAPON"][0]["occurrence_count"] == 3
    assert rows["WEAPON"][0]["player_count"] == 2

def test_duplicate_and_drop_rejected():
    data={"sampled_players":100,"character_slots":2,"characters":[{"image":"x","occurrence_count":1},{"image":"x","occurrence_count":1}]}
    with pytest.raises(ValueError): validate_data(data,{"sampled_players":100,"character_slots":2})
    data["characters"][1]["image"]="y"; data["sampled_players"]=40
    with pytest.raises(ValueError): validate_data(data,{"sampled_players":100,"character_slots":2})

def test_valid_data():
    assert validate_data({"sampled_players":2,"character_slots":2,"characters":[{"image":"x","occurrence_count":1},{"image":"y","occurrence_count":1}]})
