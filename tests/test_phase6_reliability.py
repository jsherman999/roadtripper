import os
import tempfile
import concurrent.futures
import unittest

from storyguide.providers import DemoPlaceProvider, LivePlaceProvider
from storyguide.service import StoryGuideService
from storyguide.storage import Storage
from storyguide.tts import build_tts_provider_from_env


class FailingSummaryProvider:
    def fetch_summary(self, title):
        raise OSError("network unavailable")


class Phase6ReliabilityTests(unittest.TestCase):
    def test_live_provider_falls_back_to_demo_on_failure(self):
        demo = DemoPlaceProvider()
        live = LivePlaceProvider(demo, summary_provider=FailingSummaryProvider(), allow_demo_fallback=True)
        place = live.reverse_geocode(30.2672, -97.7431)
        enriched = live.enrich(place)
        self.assertEqual(enriched.name, "Austin")
        self.assertTrue(enriched.known_for)

    def test_live_provider_without_demo_fallback_stays_generic(self):
        demo = DemoPlaceProvider()
        live = LivePlaceProvider(demo, summary_provider=FailingSummaryProvider(), allow_demo_fallback=False)
        place = live.reverse_geocode(47.9253, -97.0329)
        self.assertNotEqual(place.region, "Texas")

    def test_delete_trip_removes_history(self):
        service = StoryGuideService(storage=Storage(":memory:"))
        trip = service.create_trip("Privacy Trip")
        service.ingest_location(trip["id"], 30.2672, -97.7431)
        self.assertTrue(service.history(query="Austin"))
        service.delete_trip(trip["id"])
        self.assertFalse(service.history(query="Austin"))

    def test_storage_serializes_concurrent_location_writes(self):
        tempdir = tempfile.TemporaryDirectory()
        try:
            db_path = os.path.join(tempdir.name, "concurrency.sqlite3")
            service = StoryGuideService(storage=Storage(db_path))
            trip = service.create_trip("Concurrency Trip", settings_payload={"live_providers": False})

            def ingest(index):
                return service.ingest_location(
                    trip["id"],
                    30.2672 + (index * 0.0001),
                    -97.7431 + (index * 0.0001),
                )

            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                results = list(executor.map(ingest, range(8)))

            self.assertEqual(len(results), 8)
            self.assertTrue(service.trip_events(trip["id"]))
        finally:
            tempdir.cleanup()

    def test_manual_selected_town_creates_narration_event(self):
        service = StoryGuideService(storage=Storage(":memory:"))
        trip = service.create_trip("Manual Town Test", settings_payload={"live_providers": False})
        result = service.narrate_selected_place(
            trip["id"],
            {
                "name": "Temple",
                "region": "Texas",
                "latitude": 31.0982,
                "longitude": -97.3428,
            },
        )
        self.assertEqual(result["event"]["trigger_type"], "selected_place")
        self.assertEqual(result["event"]["place_name"], "Temple")

    def test_ingest_location_returns_nearby_points_payload(self):
        service = StoryGuideService(storage=Storage(":memory:"))
        trip = service.create_trip("Nearby Points Test", settings_payload={"live_providers": False})
        result = service.ingest_location(trip["id"], 30.2672, -97.7431)
        self.assertIn("nearby_points", result)
        self.assertTrue(result["nearby_points"])

    def test_service_uses_llm_provider_when_available(self):
        class FakeLLMProvider:
            provider_name = "fake"

            def generate_narration(self, fallback_script, context, model_override=""):
                return "LLM narration for %s" % context["kind"]

            def list_free_models(self):
                return [{"id": "fake/free", "name": "Fake Free"}]

        service = StoryGuideService(storage=Storage(":memory:"), llm_provider=FakeLLMProvider())
        trip = service.create_trip("LLM Test", settings_payload={"live_providers": False})
        result = service.ingest_location(trip["id"], 30.2672, -97.7431)
        self.assertEqual(result["event"]["script"], "LLM narration for current_place")

    def test_build_tts_provider_from_env(self):
        provider = build_tts_provider_from_env(
            {
                "ROADTRIPPER_TTS_PROVIDER": "openai",
                "ROADTRIPPER_OPENAI_API_KEY": "test-key",
                "ROADTRIPPER_TTS_MODEL": "tts-1",
                "ROADTRIPPER_TTS_VOICE": "nova",
            }
        )
        self.assertEqual(provider.provider_name, "openai")
        self.assertEqual(provider.model, "tts-1")
        self.assertEqual(provider.default_voice, "nova")
