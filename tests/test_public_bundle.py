"""The deployment gate must reject fabricated deltas and mismatched companions."""

import unittest
from copy import deepcopy

from scripts import scrape_character_usage as scraper
from scripts.validate_public_bundle import validate_bundle
from test_quality_checks import valid_data


def verified_bundle():
    previous = valid_data(sampled_players=200)
    data = valid_data(sampled_players=200)
    previous["publication_mode"] = "complete"
    data["publication_mode"] = "complete"
    data["updated_at"] = "2026-08-27T04:00:00+00:00"
    data["collection_quality"]["collection_started_at"] = "2026-08-27T03:59:00+00:00"
    history = {"snapshots": [scraper.history_snapshot(previous)]}
    scraper.add_previous_comparison(data, previous, history)
    scraper.mark_source_stale_comparison(data, {
        "stale": True, "unchanged_since": previous["updated_at"],
        "unchanged_minutes": 60.0,
        "quarantined_periods": ["day", "week", "month"],
        "stale_covered_periods": [],
    })
    health = scraper.health_summary(data)
    return data, health, history, deepcopy(history)


class PublicBundleTests(unittest.TestCase):
    def test_valid_complete_bundle_passes(self):
        validate_bundle(*verified_bundle())

    def test_comparable_delta_must_equal_verified_history(self):
        bundle = list(verified_bundle())
        bundle[0]["characters"][0]["change"]["periods"]["hour"]["occurrence_count"] += 1
        with self.assertRaisesRegex(ValueError, "delta differs from history"):
            validate_bundle(*bundle)

    def test_equipment_delta_must_equal_verified_history(self):
        bundle = list(verified_bundle())
        item = bundle[0]["characters"][0]["equipment_rankings"]["WEAPON"]["items"][0]
        item["change"]["periods"]["hour"]["occurrence_count"] += 1
        with self.assertRaisesRegex(ValueError, "equipment occurrence delta"):
            validate_bundle(*bundle)

    def test_partial_or_corrupt_baseline_cannot_support_a_comparison(self):
        bundle = list(verified_bundle())
        bundle[2]["snapshots"][0]["sampled_players"] = 199
        with self.assertRaisesRegex(ValueError, "invalid or partial comparison baseline"):
            validate_bundle(*bundle)

    def test_health_must_derive_from_the_same_snapshot(self):
        bundle = list(verified_bundle())
        bundle[1]["updated_at"] = "2026-08-27T03:00:00+00:00"
        with self.assertRaisesRegex(ValueError, "health JSON"):
            validate_bundle(*bundle)


if __name__ == "__main__":
    unittest.main()
