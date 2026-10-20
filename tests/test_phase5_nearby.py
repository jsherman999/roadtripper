import os
import tempfile
import unittest

from storyguide.nearby import NearbyTownRanker
from storyguide.service import StoryGuideService
from storyguide.storage import Storage


class Phase5NearbyTests(unittest.TestCase):
    def test_ingest_location_queues_nearby_towns(self):
        service = StoryGuideService(storage=Storage(":memory:"))
        trip = service.create_trip("Route Trip")
        service.ingest_location(trip["id"], 30.2672, -97.7431)
        result = service.ingest_location(trip["id"], 30.45, -97.70)
        self.assertTrue(result["nearby_towns"])
        self.assertIn(result["nearby_towns"][0]["name"], {"Georgetown", "Temple", "Waco"})

    def test_nearby_queue_returns_multiple_candidates(self):
        ranker = NearbyTownRanker()
        queue = ranker.nearby_queue(
            30.2672,
            -97.7431,
            [
                {"name": "Georgetown", "region": "Texas", "latitude": 30.6333, "longitude": -97.6770},
                {"name": "Temple", "region": "Texas", "latitude": 31.0982, "longitude": -97.3428},
            ],
        )
        self.assertEqual(len(queue), 2)
