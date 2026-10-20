import unittest
from datetime import datetime, timedelta, timezone

from storyguide.models import TripSettings
from storyguide.plotting import distance_to_route_km
from storyguide.providers import DemoPlaceProvider
from storyguide.relevance import RelevanceEngine
from storyguide.service import StoryGuideService
from storyguide.storage import Storage


class Phase9OntologyTests(unittest.TestCase):
    def test_route_research_events_do_not_reset_live_cooldown(self):
        service = StoryGuideService(storage=Storage(":memory:"), start_background_jobs=False)
        trip = service.create_trip("Cooldown Test", settings_payload={"live_providers": False})
        first = service.ingest_location(trip["id"], 30.2672, -97.7431)
        self.assertTrue(first["decision"]["should_narrate"])
        service.storage.add_event(
            trip_id=trip["id"],
            place_name="Waco",
            region="Texas",
            title="Research",
            script="Researched ahead of time.",
            trigger_type="plot_trip_research",
            latitude=31.5493,
            longitude=-97.1467,
            score=0.5,
            tags=[],
        )
        repeat = service.ingest_location(trip["id"], 30.2675, -97.7434)
        self.assertFalse(repeat["decision"]["should_narrate"])
        self.assertEqual(repeat["decision"]["reason"], "cooldown_distance")

    def test_selected_point_has_its_own_trigger_and_manual_cooldown(self):
        service = StoryGuideService(storage=Storage(":memory:"))
        trip = service.create_trip("Point Test", settings_payload={"live_providers": False})
        result = service.narrate_selected_place(
            trip["id"],
            {
                "name": "Texas State Capitol",
                "region": "Texas",
                "kind": "landmark",
                "blurb": "The large pink granite capitol building in Austin.",
                "latitude": 30.2747,
                "longitude": -97.7403,
            },
        )
        self.assertEqual(result["event"]["trigger_type"], "selected_point")
        self.assertIn("selected_point", result["event"]["tags"])
        follow_up = service.ingest_location(trip["id"], 30.2672, -97.7431)
        self.assertEqual(follow_up["decision"]["reason"], "cooldown_after_manual_selection")

    def test_same_place_respects_minimum_interval(self):
        engine = RelevanceEngine()
        provider = DemoPlaceProvider()
        place = provider.reverse_geocode(30.2672, -97.7431)
        now = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
        last_event = {
            "place_name": place.name,
            "trigger_type": "current_place",
            "latitude": 30.2672,
            "longitude": -97.7431,
            "recorded_at": (now - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
        }
        should, _, reason = engine.should_narrate(
            place, provider.nearby_points(30.2672, -97.7431), last_event, TripSettings(),
            current_latitude=30.40, current_longitude=-97.7431, now=now,
        )
        self.assertFalse(should)
        self.assertEqual(reason, "cooldown_interval")
        should, _, _ = engine.should_narrate(
            place, provider.nearby_points(30.2672, -97.7431), last_event, TripSettings(),
            current_latitude=30.40, current_longitude=-97.7431, now=now + timedelta(minutes=10),
        )
        self.assertTrue(should)

    def test_route_position_is_fraction_of_distance(self):
        route = [(40.0, -100.0), (40.0, -99.9), (40.0, -98.9)]
        _, position = distance_to_route_km(40.05, -99.4, route)
        self.assertAlmostEqual(position, 0.6 / 1.1, places=2)

    def test_legacy_trip_modes_are_normalized(self):
        self.assertEqual(TripSettings.from_dict({"trip_mode": "plan"}).trip_mode, "explore")
        self.assertEqual(TripSettings.from_dict({"trip_mode": "plot_trip"}).trip_mode, "route")
        self.assertEqual(TripSettings.from_dict({"trip_mode": "bogus"}).trip_mode, "drive")
        self.assertNotIn("kid_mode", TripSettings.from_dict({"kid_mode": True}).to_dict())


if __name__ == "__main__":
    unittest.main()
