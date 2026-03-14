import os
import tempfile
import unittest

from storyguide.service import StoryGuideService
from storyguide.storage import Storage


class Phase4JournalTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tempdir.name, "phase4.sqlite3")
        self.service = StoryGuideService(storage=Storage(self.db_path))
        self.trip = self.service.create_trip("Journal Trip")
        self.service.ingest_location(self.trip["id"], 30.2672, -97.7431)
        self.service.ingest_location(self.trip["id"], 31.5493, -97.1467)

    def tearDown(self):
        self.tempdir.cleanup()

    def test_history_search_finds_matching_place(self):
        results = self.service.history(query="Waco")
        self.assertTrue(results)
        self.assertEqual(results[0]["place_name"], "Waco")

    def test_export_trip_markdown_contains_titles(self):
        markdown = self.service.export_trip_markdown(self.trip["id"])
        self.assertIn("# Journal Trip", markdown)
        self.assertIn("## Narration Events", markdown)
