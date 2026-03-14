import os
import tempfile
import unittest

from storyguide.service import StoryGuideService
from storyguide.storage import Storage


class Phase1CoreTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tempdir.name, "phase1.sqlite3")
        self.service = StoryGuideService(storage=Storage(self.db_path))

    def tearDown(self):
        self.tempdir.cleanup()

    def test_trip_creation_and_basic_narration(self):
        trip = self.service.create_trip("Phase 1 Trip")
        result = self.service.ingest_location(
            trip_id=trip["id"],
            latitude=30.2672,
            longitude=-97.7431,
            speed_kph=95.0,
        )
        self.assertEqual(result["current_place"]["name"], "Austin")
        self.assertIsNotNone(result["event"])
        self.assertIn("Austin", result["event"]["script"])

    def test_trip_stop_updates_status(self):
        trip = self.service.create_trip("Stop Test")
        stopped = self.service.stop_trip(trip["id"])
        self.assertEqual(stopped["status"], "stopped")
