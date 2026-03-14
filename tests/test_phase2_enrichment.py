import unittest

from storyguide.models import PlaceProfile, TripSettings
from storyguide.providers import DemoPlaceProvider
from storyguide.relevance import RelevanceEngine


class Phase2EnrichmentTests(unittest.TestCase):
    def test_demo_provider_enriches_known_place(self):
        provider = DemoPlaceProvider()
        place = provider.reverse_geocode(31.5493, -97.1467)
        enriched = provider.enrich(place)
        self.assertEqual(enriched.name, "Waco")
        self.assertTrue(enriched.population)
        self.assertTrue(enriched.known_for)

    def test_relevance_engine_suppresses_duplicate_nearby_place(self):
        engine = RelevanceEngine()
        provider = DemoPlaceProvider()
        place = provider.reverse_geocode(30.2672, -97.7431)
        nearby = provider.nearby_places(30.2672, -97.7431)
        last_event = {
            "place_name": "Austin",
            "latitude": 30.2672,
            "longitude": -97.7431,
        }
        should_narrate, _, reason = engine.should_narrate(
            place,
            nearby,
            last_event,
            TripSettings(),
            current_latitude=30.2675,
            current_longitude=-97.7434,
        )
        self.assertFalse(should_narrate)
        self.assertEqual(reason, "cooldown_distance")

    def test_relevance_engine_scores_interesting_places_higher(self):
        engine = RelevanceEngine()
        plain = PlaceProfile(name="Tiny Town", region="Texas", latitude=0, longitude=0)
        rich = DemoPlaceProvider().reverse_geocode(30.2672, -97.7431)
        self.assertGreater(engine.score_place(rich, []), engine.score_place(plain, []))
