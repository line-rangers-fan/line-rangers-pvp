import pytest

from scripts import scrape_character_usage as scraper


def payload_with_complete_and_single_character_teams():
    return {
        "top100": [{"mid": "player-2"}, {"mid": "player-1"}],
        "playerInfo": [
            {
                "mid": "player-1",
                "playerUnitTeamGroupMap": {
                    "pvpteam": {
                        "2": [{"unitCode": "u-beta"}],
                        "1": [
                            {"unitCode": "u-alpha"},
                            {"unitCode": "u-alpha"},
                        ],
                    }
                },
            },
            {
                "mid": "player-2",
                "playerUnitTeamGroupMap": {
                    "pvpteam": {"1": [{"unitCode": "u-beta"}]}
                },
            },
        ],
    }


def test_all_pvp_groups_and_duplicate_units_are_preserved():
    players, diagnostics = scraper.extract_ranked_players(
        payload_with_complete_and_single_character_teams(),
        target_players=2,
    )

    assert [player["mid"] for player in players] == ["player-2", "player-1"]
    assert players[0]["units"] == ["u-beta"]
    assert players[1]["units"] == ["u-alpha", "u-alpha", "u-beta"]
    assert diagnostics["team_size_distribution"] == {1: 1, 3: 1}

    data = scraper.build_statistics(players, diagnostics)
    by_image = {row["image"]: row for row in data["characters"]}
    alpha = by_image[scraper.character_image_url("u-alpha")]
    beta = by_image[scraper.character_image_url("u-beta")]

    assert data["character_slots"] == 4
    assert alpha["occurrence_count"] == 2
    assert alpha["player_count"] == 1
    assert beta["occurrence_count"] == 2
    assert beta["player_count"] == 2


def test_incomplete_ranked_player_is_reported_instead_of_silently_replaced():
    payload = payload_with_complete_and_single_character_teams()
    payload["playerInfo"] = payload["playerInfo"][1:]

    players, diagnostics = scraper.extract_ranked_players(payload, target_players=2)

    assert [player["mid"] for player in players] == ["player-2"]
    assert diagnostics["missing_player_info"] == ["player-1"]


def test_malformed_unit_code_is_rejected():
    with pytest.raises(ValueError):
        scraper.character_image_url("../../not-a-unit")
