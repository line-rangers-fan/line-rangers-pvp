import json

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

    data = scraper.build_statistics(players, diagnostics, target_players=2)
    by_image = {row["image"]: row for row in data["characters"]}
    alpha = by_image[scraper.character_image_url("u-alpha")]
    beta = by_image[scraper.character_image_url("u-beta")]

    assert data["character_slots"] == 4
    assert data["schema_version"] == scraper.SCHEMA_VERSION
    assert data["collection_quality"]["sample_coverage"] == 100.0
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


def test_source_requests_are_limited_to_the_known_handbook_host():
    assert scraper.is_trusted_source_url(
        "https://rangers.lerico.net/api/v2/translate"
    )
    assert not scraper.is_trusted_source_url("http://rangers.lerico.net/api")
    assert not scraper.is_trusted_source_url("https://example.test/api")
    assert not scraper.is_trusted_source_url(
        "https://rangers.lerico.net@example.test/api"
    )


def test_insufficient_ranked_players_refuses_publish(monkeypatch):
    monkeypatch.setattr(scraper, "TARGET_PLAYER_COUNT", 2)
    monkeypatch.setattr(
        scraper,
        "fetch_rank_data",
        lambda: {"top100": [{"mid": "player-1"}]},
    )

    with pytest.raises(RuntimeError, match="did not provide the requested number"):
        scraper.scrape()


def test_detail_failure_retries_only_the_failed_player_and_checks_all_players(monkeypatch):
    requested = []

    def fetch(mid):
        requested.append(mid)
        if mid == "player-1":
            raise RuntimeError("temporary outage")
        return {"mid": mid}

    monkeypatch.setattr(scraper, "PLAYER_FETCH_WORKERS", 1)
    monkeypatch.setattr(scraper, "DETAIL_FETCH_ROUNDS", 2)
    monkeypatch.setattr(scraper, "fetch_player_detail", fetch)
    monkeypatch.setattr(scraper, "sleep", lambda _seconds: None)

    details, failures = scraper.fetch_ranked_player_details(
        ["player-1", "player-2", "player-3", "player-4"]
    )

    assert failures == [{"mid": "player-1", "error_type": "RuntimeError"}]
    assert set(requested) == {"player-1", "player-2", "player-3", "player-4"}
    assert requested.count("player-1") == 2
    assert set(details) == {"player-2", "player-3", "player-4"}


def test_detail_collection_checks_budget_between_batches(monkeypatch):
    checked = []

    monkeypatch.setattr(scraper, "PLAYER_FETCH_WORKERS", 1)
    monkeypatch.setattr(scraper, "DETAIL_FETCH_ROUNDS", 1)
    monkeypatch.setattr(scraper, "fetch_player_detail", lambda mid: {"mid": mid})
    monkeypatch.setattr(
        scraper, "ensure_collection_within_budget", lambda started: checked.append(started)
    )

    details, failures = scraper.fetch_ranked_player_details(
        ["player-1", "player-2", "player-3", "player-4", "player-5"],
        collection_started_clock=123.0,
    )

    assert failures == []
    assert len(details) == 5
    assert checked == [123.0] * 5


def test_invalid_environment_number_uses_safe_bounded_value(monkeypatch):
    monkeypatch.setenv("SAFE_TEST_VALUE", "invalid")
    assert scraper.read_bounded_env_int("SAFE_TEST_VALUE", 3, 1, 4) == 3

    monkeypatch.setenv("SAFE_TEST_VALUE", "99")
    assert scraper.read_bounded_env_int("SAFE_TEST_VALUE", 3, 1, 4) == 4

    monkeypatch.setenv("SAFE_TEST_VALUE", "-5")
    assert scraper.read_bounded_env_int("SAFE_TEST_VALUE", 3, 1, 4) == 1


def test_scrape_rechecks_only_player_details_with_incomplete_content(monkeypatch):
    def detail(mid, unit_code, *, complete=True):
        return {
            "mid": mid,
            "playerUnitTeamGroupMap": (
                {
                    "pvpteam": {
                        "1": [
                            {
                                "unitCode": unit_code,
                                "equipMap": {
                                    "WEAPON": {"itemCode": "weapon"},
                                    "ARMOR": {"itemCode": "armor"},
                                    "ACC": {"itemCode": "accessory"},
                                },
                            }
                        ]
                    }
                }
                if complete
                else {}
            ),
        }

    calls = []
    monkeypatch.setattr(scraper, "TARGET_PLAYER_COUNT", 2)
    monkeypatch.setattr(scraper, "DETAIL_CONTENT_RECHECKS", 1)
    monkeypatch.setattr(scraper, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        scraper,
        "fetch_rank_data",
        lambda: {"top100": [{"mid": "player-1"}, {"mid": "player-2"}]},
    )

    def fetch_details(mids):
        calls.append(list(mids))
        if len(calls) == 1:
            return {
                "player-1": detail("player-1", "u-alpha"),
                "player-2": detail("player-2", "u-beta", complete=False),
            }, []
        return {"player-2": detail("player-2", "u-beta")}, []

    monkeypatch.setattr(scraper, "fetch_ranked_player_details", fetch_details)
    monkeypatch.setattr(scraper, "fetch_character_names", lambda _codes: {})

    data = scraper.scrape()

    assert calls == [["player-1", "player-2"], ["player-2"]]
    assert data["diagnostics"]["detail_content_rechecks"] == 1
    assert data["sampled_players"] == 2


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


def test_previous_comparison_uses_positive_values_for_upward_rank_moves():
    previous = {
        "updated_at": "2026-08-27T01:00:00+00:00",
        "sampled_players": 2,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 3,
                "occurrence_count": 1,
                "player_count": 1,
                "adoption_rate": 50.0,
            },
            {
                "unit_code": "u-removed",
                "rank": 1,
                "occurrence_count": 2,
                "player_count": 2,
                "adoption_rate": 100.0,
            },
        ],
    }
    current = {
        "updated_at": "2026-08-27T02:00:00+00:00",
        "sampled_players": 2,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 2,
                "player_count": 2,
                "adoption_rate": 100.0,
            },
            {
                "unit_code": "u-new",
                "rank": 2,
                "occurrence_count": 1,
                "player_count": 1,
                "adoption_rate": 50.0,
            },
        ],
    }

    scraper.add_previous_comparison(current, previous)

    assert current["characters"][0]["change"]["rank"] == 2
    assert current["characters"][0]["change"]["occurrence_count"] == 1
    assert current["characters"][1]["change"] == {"new": True}
    assert current["comparison"]["new_characters"] == 1
    assert current["comparison"]["removed_characters"] == 1
    assert current["comparison"]["interval_minutes"] == 60.0


def test_period_count_changes_use_verified_hour_day_week_and_month_snapshots():
    previous = {
        "updated_at": "2026-08-28T01:00:00+00:00",
        "sampled_players": 2,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 2,
                "occurrence_count": 2,
                "player_count": 2,
                "adoption_rate": 100.0,
            }
        ],
    }
    current = {
        "updated_at": "2026-08-28T02:00:00+00:00",
        "sampled_players": 2,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 5,
                "player_count": 2,
                "adoption_rate": 100.0,
            }
        ],
    }

    def snapshot(updated_at: str, rank: int, occurrence_count: int) -> dict:
        return {
            "updated_at": updated_at,
            "characters": [
                {
                    "unit_code": "u-alpha",
                    "rank": rank,
                    "occurrence_count": occurrence_count,
                }
            ],
        }

    history = {
        "snapshots": [
            snapshot("2026-07-28T02:00:00+00:00", 4, 2),
            snapshot("2026-08-21T02:00:00+00:00", 3, 2),
            snapshot("2026-08-27T02:00:00+00:00", 2, 2),
            snapshot("2026-08-28T01:00:00+00:00", 1, 4),
        ]
    }

    scraper.add_previous_comparison(current, previous, history)
    periods = current["characters"][0]["change"]["periods"]

    assert periods["hour"]["comparable"] is True
    assert periods["hour"]["rank"] == 0
    assert periods["day"]["comparable"] is True
    assert periods["day"]["rank"] == 1
    assert periods["week"]["rank"] == 2
    assert periods["month"]["rank"] == 3
    assert periods["hour"]["occurrence_count"] == 1
    assert periods["day"]["occurrence_count"] == 3
    assert periods["week"]["occurrence_count"] == 3
    assert periods["month"]["occurrence_count"] == 3
    assert current["comparison"]["periods"]["month"]["comparable"] is True


def test_period_rank_changes_are_unavailable_when_history_gap_is_too_large():
    current = {
        "updated_at": "2026-08-28T02:00:00+00:00",
        "sampled_players": 2,
        "characters": [{"unit_code": "u-alpha", "rank": 1}],
    }
    history = {
        "snapshots": [
            {
                "updated_at": "2026-08-20T02:00:00+00:00",
                "characters": [{"unit_code": "u-alpha", "rank": 2}],
            }
        ]
    }

    scraper.add_previous_comparison(current, None, history)
    periods = current["characters"][0]["change"]["periods"]

    assert periods["day"]["comparable"] is False
    assert periods["day"]["rank"] is None


def test_period_count_change_treats_missing_character_as_zero_in_valid_snapshot():
    current = {
        "updated_at": "2026-08-28T02:00:00+00:00",
        "sampled_players": 2,
        "characters": [{"unit_code": "u-new", "rank": 40, "occurrence_count": 3}],
    }
    history = {
        "snapshots": [
            {
                "updated_at": "2026-08-27T02:00:00+00:00",
                "characters": [{"unit_code": "u-existing", "rank": 1, "occurrence_count": 10}],
            }
        ]
    }

    scraper.add_previous_comparison(current, None, history)
    day = current["characters"][0]["change"]["periods"]["day"]

    assert day["comparable"] is True
    assert day["rank"] is None
    assert day["occurrence_count"] == 3


def test_equipment_period_rank_changes_use_verified_time_window():
    previous = {
        "updated_at": "2026-08-27T00:00:00+00:00",
        "sampled_players": 2,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 2,
                "player_count": 2,
                "adoption_rate": 100.0,
                "equipment_rankings": {
                    "WEAPON": {"items": [{"item_code": "w1", "rank": 2}]},
                    "ARMOR": {"items": []},
                    "ACC": {"items": []},
                },
            }
        ],
    }
    current = {
        "updated_at": "2026-08-28T00:30:00+00:00",
        "sampled_players": 2,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 2,
                "player_count": 2,
                "adoption_rate": 100.0,
                "equipment_rankings": {
                    "WEAPON": {"items": [{"item_code": "w1", "rank": 1}]},
                    "ARMOR": {"items": []},
                    "ACC": {"items": []},
                },
            }
        ],
    }
    history = {
        "snapshots": [
            {
                "updated_at": "2026-08-27T00:00:00+00:00",
                "characters": [
                    {
                        "unit_code": "u-alpha",
                        "rank": 1,
                        "equipment_rankings": {
                            "WEAPON": {"items": [{"item_code": "w1", "rank": 3}]},
                            "ARMOR": {"items": []},
                            "ACC": {"items": []},
                        },
                    }
                ],
            }
        ]
    }

    scraper.add_previous_comparison(current, previous, history)
    item = current["characters"][0]["equipment_rankings"]["WEAPON"]["items"][0]

    assert item["change"]["rank"] == 1
    assert item["change"]["periods"]["day"] == {
        "comparable": True,
        "rank": 2,
        "occurrence_count": None,
        "from_updated_at": "2026-08-27T00:00:00+00:00",
        "interval_minutes": 1470.0,
    }


def test_equipment_without_prior_item_uses_zero_count_from_valid_snapshot():
    current = {
        "updated_at": "2026-08-28T00:30:00+00:00",
        "sampled_players": 1,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 1,
                "player_count": 1,
                "adoption_rate": 100.0,
                "equipment_rankings": {
                    "WEAPON": {"items": [{"item_code": "new", "rank": 1, "occurrence_count": 3}]},
                    "ARMOR": {"items": []},
                    "ACC": {"items": []},
                },
            }
        ],
    }
    history = {
        "snapshots": [
            {
                "updated_at": "2026-08-27T00:00:00+00:00",
                "characters": [
                    {
                        "unit_code": "u-alpha",
                        "rank": 1,
                        "equipment_rankings": {
                            "WEAPON": {"items": []},
                            "ARMOR": {"items": []},
                            "ACC": {"items": []},
                        },
                    }
                ],
            }
        ]
    }

    scraper.add_previous_comparison(current, None, history)
    item = current["characters"][0]["equipment_rankings"]["WEAPON"]["items"][0]

    assert item["change"]["new"] is True
    assert item["change"]["rank"] == 0
    day = item["change"]["periods"]["day"]
    assert day["comparable"] is True
    assert day["rank"] is None
    assert day["occurrence_count"] == 3


def test_history_snapshot_keeps_equipment_counts_for_period_deltas():
    data = {
        "updated_at": "2026-08-28T02:00:00+00:00",
        "sampled_players": 1,
        "character_slots": 1,
        "unique_characters": 1,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 1,
                "player_count": 1,
                "adoption_rate": 100.0,
                "equipment_rankings": {
                    "WEAPON": {
                        "items": [
                            {"item_code": "w1", "rank": 1, "occurrence_count": 4}
                        ]
                    },
                    "ARMOR": {"items": []},
                    "ACC": {"items": []},
                },
            }
        ],
    }

    snapshot = scraper.history_snapshot(data)
    item = snapshot["characters"][0]["equipment_rankings"]["WEAPON"]["items"][0]

    assert item == {"item_code": "w1", "rank": 1, "occurrence_count": 4}


def test_load_json_ignores_damaged_comparison_context(tmp_path):
    path = tmp_path / "damaged.json"
    path.write_text("{not valid json", encoding="utf-8")

    assert scraper.load_json(path) is None


def test_debug_artifact_redacts_player_identifiers(tmp_path, monkeypatch):
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.setattr(scraper, "DEBUG_DIR", tmp_path)
    data = {
        "diagnostics": {
            "valid_players": 200,
            "team_size_distribution": {"10": 200},
            "detail_fetch_failures": [{"mid": "private-player", "error": "timeout"}],
            "missing_player_info": ["private-player"],
            "invalid_players": ["private-player"],
            "invalid_unit_codes": ["u-bad"],
            "invalid_equipment": ["private-player"],
            "invalid_rank_records": ["private-player"],
        }
    }

    scraper.dump_debug(data)
    artifact = json.loads((tmp_path / "diagnostics.json").read_text(encoding="utf-8"))

    assert artifact["valid_players"] == 200
    assert artifact["diagnostic_error_counts"]["detail_fetch_failures"] == 1
    assert "private-player" not in json.dumps(artifact)


def test_detail_failure_summary_redacts_player_identifiers(tmp_path, monkeypatch):
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.setattr(scraper, "DEBUG_DIR", tmp_path)

    scraper.dump_detail_failure_summary(
        2,
        1,
        [{"mid": "private-player", "error_type": "TimeoutError"}],
    )
    artifact = json.loads(
        (tmp_path / "detail_fetch_failures.json").read_text(encoding="utf-8")
    )

    assert artifact == {
        "requested": 2,
        "completed": 1,
        "failure_count": 1,
        "failure_types": {"TimeoutError": 1},
    }
    assert "private-player" not in json.dumps(artifact)


def test_history_is_compact_deduplicated_and_bounded():
    data = {
        "updated_at": "2026-08-27T02:00:00+00:00",
        "sampled_players": 200,
        "character_slots": 1980,
        "unique_characters": 1,
        "characters": [
            {
                "unit_code": "u-alpha",
                "rank": 1,
                "occurrence_count": 2,
                "player_count": 2,
                "adoption_rate": 1.0,
                "image": "not-copied",
                "equipment_rankings": {"not": "copied"},
            }
        ],
    }
    history = {
        "snapshots": [
            {"updated_at": "old-1"},
            {"updated_at": "old-2"},
            {"updated_at": data["updated_at"]},
        ]
    }

    result = scraper.update_history(data, history, limit=2)

    assert [row["updated_at"] for row in result["snapshots"]] == [
        "old-2",
        data["updated_at"],
    ]
    character = result["snapshots"][-1]["characters"][0]
    assert result["schema_version"] == 2
    assert result["snapshots"][-1]["calendar_date"] == "2026-08-27"
    assert "image" not in character
    assert character["equipment_rankings"] == {
        "WEAPON": {"items": []},
        "ARMOR": {"items": []},
        "ACC": {"items": []},
    }
