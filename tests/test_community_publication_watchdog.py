import datetime as dt
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_community_publication import (
    PublicationCheckError,
    actual_topics,
    check_remote,
    current_jst_month,
    expected_topics,
    main,
    publication_drift,
)


MONTH = "2026-10"
TOPIC = {
    "id": "u2000e-alpha",
    "name": "新キャラ Alpha",
    "nameEn": "New Ranger Alpha",
    "nameZh": "新角色 Alpha",
    "nameTh": "นักรบ Alpha",
    "releaseMonth": MONTH,
    "confirmed": True,
    "source": "pvp-auto",
    "pvpRank": 7,
    "skillsVerified": True,
}


def registry(*topics):
    return {"schemaVersion": 1, "characters": list(topics)}


def manifest(*topics):
    return {"month": MONTH, "characters": list(topics)}


class CommunityPublicationWatchdogTests(unittest.TestCase):
    def test_month_uses_japan_calendar_at_utc_boundary(self):
        before_jst_month = dt.datetime(2026, 9, 30, 14, 59, tzinfo=dt.timezone.utc)
        after_jst_month = dt.datetime(2026, 9, 30, 15, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(current_jst_month(before_jst_month), "2026-09")
        self.assertEqual(current_jst_month(after_jst_month), "2026-10")

    def test_expected_topics_ignore_unconfirmed_and_archived_rows(self):
        archived = {**TOPIC, "id": "u1999e-archived", "releaseMonth": "2026-09"}
        unconfirmed = {**TOPIC, "id": "u1998e-pending", "confirmed": False}
        topics = expected_topics(registry(TOPIC, archived, unconfirmed), MONTH)
        self.assertEqual([row["id"] for row in topics], [TOPIC["id"]])

    def test_matching_production_manifest_has_no_drift(self):
        expected = expected_topics(registry(TOPIC), MONTH)
        live = {
            "id": TOPIC["id"],
            "name": TOPIC["name"],
            "nameEn": TOPIC["nameEn"],
            "nameZh": TOPIC["nameZh"],
            "nameTh": TOPIC["nameTh"],
            "pvpRank": TOPIC["pvpRank"],
            "skillsVerified": True,
        }
        self.assertEqual(actual_topics(manifest(live), MONTH), expected)
        self.assertFalse(publication_drift(registry(TOPIC), manifest(live), MONTH))

    def test_missing_or_mismatched_topic_triggers_drift(self):
        self.assertTrue(publication_drift(registry(TOPIC), manifest(), MONTH))
        changed_rank = {**TOPIC, "pvpRank": 8}
        live = {**TOPIC, "skillsVerified": True}
        self.assertTrue(publication_drift(registry(changed_rank), manifest(live), MONTH))

    def test_malformed_or_wrong_month_data_fails_closed(self):
        with self.assertRaises(PublicationCheckError):
            expected_topics({"schemaVersion": 1, "characters": "broken"}, MONTH)
        with self.assertRaises(PublicationCheckError):
            actual_topics({"month": "2026-09", "characters": []}, MONTH)
        duplicate = {**TOPIC}
        with self.assertRaises(PublicationCheckError):
            expected_topics(registry(TOPIC, duplicate), MONTH)

    def test_numeric_truth_values_are_not_accepted_as_ranks_or_skill_verification(self):
        with self.assertRaises(PublicationCheckError):
            expected_topics(registry({**TOPIC, "pvpRank": True}), MONTH)
        with self.assertRaises(PublicationCheckError):
            actual_topics(manifest({**TOPIC, "skillsVerified": 1}), MONTH)

    def test_unavailable_manifest_fails_visibly_without_dispatching(self):
        with tempfile.NamedTemporaryFile(mode="r+", encoding="utf-8") as output:
            with patch.dict(os.environ, {"GITHUB_OUTPUT": output.name}), \
                    patch("sys.argv", ["check_community_publication.py"]), \
                    patch("scripts.check_community_publication.check_remote", side_effect=PublicationCheckError("timeout")):
                self.assertEqual(main(), 1)
            output.seek(0)
            self.assertEqual(output.read(), "community_drift=unknown\n")

    def test_workflow_dispatches_only_the_existing_guarded_sync_on_verified_drift(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/watch-character-usage.yml").read_text(encoding="utf-8")
        reconcile = workflow.split("  reconcile-community-publication:", 1)[1]
        self.assertIn('if: steps.manifest.outputs.community_drift == \'true\'', reconcile)
        self.assertIn('workflow_id: "sync-production-pvp.yml"', reconcile)
        self.assertIn('ref: "main"', reconcile)
        self.assertIn("activeStatuses.has(run.status)", reconcile)
        self.assertIn("no duplicate was dispatched", reconcile)
        self.assertIn("actions: write", reconcile)

    def test_remote_verification_uses_only_get_requests(self):
        registry_response = json.dumps(registry(TOPIC)).encode()
        live_topic = {
            "id": TOPIC["id"],
            "name": TOPIC["name"],
            "nameEn": TOPIC["nameEn"],
            "nameZh": TOPIC["nameZh"],
            "nameTh": TOPIC["nameTh"],
            "pvpRank": TOPIC["pvpRank"],
            "skillsVerified": True,
        }
        manifest_response = json.dumps(manifest(live_topic)).encode()
        requests = []

        class Response:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return self.body

        def opener(request, timeout):
            requests.append((request, timeout))
            if "raw.githubusercontent.com" in request.full_url:
                return Response(registry_response)
            return Response(manifest_response)

        self.assertFalse(check_remote(MONTH, opener=opener))
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(request.get_method() == "GET" for request, _ in requests))
        self.assertTrue(all(timeout > 0 for _, timeout in requests))


if __name__ == "__main__":
    unittest.main()
