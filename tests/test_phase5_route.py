import os
import tempfile
import unittest

from storyguide.route import RouteForecaster
from storyguide.service import StoryGuideService
from storyguide.storage import Storage


class Phase5RouteTests(unittest.TestCase):
    def test_route_forecaster_suggests_place_ahead(self):
        service = StoryGuideService(storage=Storage(":memory:"))
        trip = service.create_trip("Route Trip")
        service.ingest_location(trip["id"], 30.2672, -97.7431)
        result = service.ingest_location(trip["id"], 30.45, -97.70)
        self.assertTrue(result["nearby_towns"])
        self.assertIn(result["nearby_towns"][0]["name"], {"Georgetown", "Temple", "Waco"})

    def test_best_upcoming_requires_two_points(self):
        forecaster = RouteForecaster()
        history = [{"latitude": 30.2672, "longitude": -97.7431}]
        self.assertIsNone(forecaster.best_upcoming(history, []))

    def test_nearby_queue_returns_multiple_candidates(self):
        forecaster = RouteForecaster()
        queue = forecaster.nearby_queue(
            30.2672,
            -97.7431,
            [
                {"name": "Georgetown", "region": "Texas", "latitude": 30.6333, "longitude": -97.6770},
                {"name": "Temple", "region": "Texas", "latitude": 31.0982, "longitude": -97.3428},
            ],
        )
        self.assertEqual(len(queue), 2)
