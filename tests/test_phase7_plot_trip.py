import unittest

from storyguide.plotting import RoutePlan, TownGazetteer
from storyguide.service import StoryGuideService
from storyguide.storage import Storage


class FakeRoutingProvider:
    def plan_route(self, waypoints):
        geometry = [
            {"latitude": 30.2672, "longitude": -97.7431},
            {"latitude": 30.6333, "longitude": -97.6770},
            {"latitude": 31.5493, "longitude": -97.1467},
        ]
        optimized = []
        for index, waypoint in enumerate(waypoints):
            payload = dict(waypoint)
            payload["input_order"] = index
            payload["optimized_order"] = index
            optimized.append(payload)
        return RoutePlan(
            geometry=geometry,
            waypoints=optimized,
            distance_m=160000,
            duration_s=7200,
            source="fake",
        )


class Phase7PlotTripTests(unittest.TestCase):
    def test_plot_trip_creates_route_waypoints_and_towns(self):
        service = StoryGuideService(
            storage=Storage(":memory:"),
            routing_provider=FakeRoutingProvider(),
            town_gazetteer=TownGazetteer(data_path="/tmp/missing-roadtripper-towns.json"),
            start_background_jobs=False,
        )
        trip = service.create_trip("Plot Test", settings_payload={"trip_mode": "plot_trip", "live_providers": False})
        route = service.create_plotted_route(
            trip["id"],
            {
                "name": "Austin to Waco",
                "waypoints": [
                    {"latitude": 30.2672, "longitude": -97.7431, "name": "Austin"},
                    {"latitude": 31.5493, "longitude": -97.1467, "name": "Waco"},
                ],
            },
        )
        self.assertEqual(route["name"], "Austin to Waco")
        self.assertEqual(route["route_source"], "fake")
        self.assertEqual(len(route["waypoints"]), 2)
        self.assertIn("Austin", [town["name"] for town in route["towns"]])
        self.assertTrue(all(town["population"] > 200 for town in route["towns"]))

    def test_plot_trip_requires_two_waypoints(self):
        service = StoryGuideService(storage=Storage(":memory:"), routing_provider=FakeRoutingProvider())
        trip = service.create_trip("Plot Test")
        with self.assertRaises(ValueError):
            service.create_plotted_route(
                trip["id"],
                {"waypoints": [{"latitude": 30.2672, "longitude": -97.7431}]},
            )

    def test_get_plotted_route_is_scoped_to_trip(self):
        service = StoryGuideService(
            storage=Storage(":memory:"),
            routing_provider=FakeRoutingProvider(),
            town_gazetteer=TownGazetteer(data_path="/tmp/missing-roadtripper-towns.json"),
            start_background_jobs=False,
        )
        first = service.create_trip("First")
        second = service.create_trip("Second")
        route = service.create_plotted_route(
            first["id"],
            {
                "waypoints": [
                    {"latitude": 30.2672, "longitude": -97.7431},
                    {"latitude": 31.5493, "longitude": -97.1467},
                ]
            },
        )
        with self.assertRaises(KeyError):
            service.get_plotted_route(second["id"], route["id"])

    def test_route_research_marks_towns_done_and_stores_research(self):
        service = StoryGuideService(
            storage=Storage(":memory:"),
            routing_provider=FakeRoutingProvider(),
            town_gazetteer=TownGazetteer(data_path="/tmp/missing-roadtripper-towns.json"),
            start_background_jobs=False,
        )
        trip = service.create_trip("Research Test", settings_payload={"live_providers": False})
        route = service.create_plotted_route(
            trip["id"],
            {
                "waypoints": [
                    {"latitude": 30.2672, "longitude": -97.7431},
                    {"latitude": 31.5493, "longitude": -97.1467},
                ]
            },
        )
        researched = service.run_plotted_route_research(route["id"])
        self.assertEqual(researched["status"], "done")
        self.assertTrue(researched["towns"])
        self.assertTrue(all(town["status"] == "done" for town in researched["towns"]))
        self.assertTrue(all(town["research"].get("narration") for town in researched["towns"]))
        self.assertTrue(service.history(query="Austin", trip_id=trip["id"]))


if __name__ == "__main__":
    unittest.main()
