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


def test_duplicate_characters_count_each_equipment_but_not_each_player():
    players = [
        {
            "mid": "player-1",
            "unit_records": [
                {
                    "unit_code": "u-alpha",
                    "equipment": {
                        "WEAPON": "eq-w1",
                        "ARMOR": "eq-a1",
                        "ACC": "eq-c1",
                    },
                },
                {
                    "unit_code": "u-alpha",
                    "equipment": {
                        "WEAPON": "eq-w1",
                        "ARMOR": "eq-a2",
                        "ACC": "eq-c1",
                    },
                },
            ],
        },
        {
            "mid": "player-2",
            "unit_records": [
                {
                    "unit_code": "u-alpha",
                    "equipment": {
                        "WEAPON": "eq-w2",
                        "ARMOR": "eq-a1",
                        "ACC": "eq-c2",
                    },
                }
            ],
        },
    ]
    names = {
        "eq-w1": "Weapon 1",
        "eq-w2": "Weapon 2",
        "eq-a1": "Armor 1",
        "eq-a2": "Armor 2",
        "eq-c1": "Accessory 1",
        "eq-c2": "Accessory 2",
    }

    data = scraper.build_statistics(players, {}, character_names={"u-alpha": "Alpha"}, target_players=2)
    alpha = data["characters"][0]
    weapon = alpha["equipment_rankings"]["WEAPON"]

    assert alpha["occurrence_count"] == 3
    assert alpha["player_count"] == 2
    assert weapon["equipped_occurrence_count"] == 3
    assert weapon["equipped_player_count"] == 2
    assert weapon["items"][0]["item_code"] == "eq-w1"
    assert weapon["items"][0]["occurrence_count"] == 2
    assert weapon["items"][0]["player_count"] == 1
    assert weapon["items"][0]["adoption_rate"] == 50.0


def test_incomplete_ranked_player_is_reported_instead_of_silently_replaced():
    payload = payload_with_complete_and_single_character_teams()
    payload["playerInfo"] = payload["playerInfo"][1:]

    players, diagnostics = scraper.extract_ranked_players(payload, target_players=2)

    assert [player["mid"] for player in players] == ["player-2"]
    assert diagnostics["missing_player_info"] == ["player-1"]


def test_malformed_unit_code_is_rejected():
    with pytest.raises(ValueError):
        scraper.character_image_url("../../not-a-unit")


def test_insufficient_ranked_players_refuses_publish(monkeypatch):
    monkeypatch.setattr(scraper, "TARGET_PLAYER_COUNT", 2)
    monkeypatch.setattr(
        scraper,
        "fetch_rank_data",
        lambda: {"top100": [{"mid": "player-1"}]},
    )

    with pytest.raises(RuntimeError, match="did not provide the requested number"):
        scraper.scrape()


def test_failed_collection_keeps_previous_published_data(tmp_path, monkeypatch):
    output_path = tmp_path / "character_usage.json"
    previous = {"updated_at": "previous", "sampled_players": 200}
    scraper.save_json(output_path, previous)
    monkeypatch.setattr(scraper, "OUTPUT_PATH", output_path)
    monkeypatch.setattr(
        scraper,
        "scrape",
        lambda: (_ for _ in ()).throw(RuntimeError("incomplete sample")),
    )

    with pytest.raises(RuntimeError, match="incomplete sample"):
        scraper.main()

    assert scraper.load_json(output_path) == previous
