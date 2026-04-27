from typing import Dict, Optional

from storyguide.llm import BaseNarrationLLM, build_llm_provider_from_env, build_openai_provider_from_env
from storyguide.models import TripSettings
from storyguide.narration import NarrationBuilder
from storyguide.providers import DemoPlaceProvider, LivePlaceProvider
from storyguide.relevance import RelevanceEngine
from storyguide.route import RouteForecaster
from storyguide.storage import Storage
from storyguide.tts import BaseTTSProvider, audio_json_payload, build_tts_provider_from_env


class StoryGuideService:
    def __init__(
        self,
        storage: Optional[Storage] = None,
        demo_provider: Optional[DemoPlaceProvider] = None,
        live_provider: Optional[LivePlaceProvider] = None,
        relevance_engine: Optional[RelevanceEngine] = None,
        narration_builder: Optional[NarrationBuilder] = None,
        route_forecaster: Optional[RouteForecaster] = None,
        llm_provider: Optional[BaseNarrationLLM] = None,
        tts_provider: Optional[BaseTTSProvider] = None,
        openai_provider: Optional[BaseNarrationLLM] = None,
    ):
        self.storage = storage or Storage()
        self.demo_provider = demo_provider or DemoPlaceProvider()
        self.live_provider = live_provider or LivePlaceProvider(self.demo_provider, allow_demo_fallback=False)
        self.relevance = relevance_engine or RelevanceEngine()
        self.narration_builder = narration_builder or NarrationBuilder()
        self.route_forecaster = route_forecaster or RouteForecaster()
        self.llm_provider = llm_provider or build_llm_provider_from_env()
        self.tts_provider = tts_provider or build_tts_provider_from_env()
        self.openai_provider = openai_provider if openai_provider is not None else build_openai_provider_from_env()

    def create_trip(self, name: str, settings_payload: Optional[Dict] = None) -> Dict:
        settings = TripSettings.from_dict(settings_payload)
        trip = self.storage.create_trip(name=name, settings=settings.to_dict())
        return trip

    def list_trips(self):
        return self.storage.list_trips()

    def stop_trip(self, trip_id: int):
        return self.storage.stop_trip(trip_id)

    def delete_trip(self, trip_id: int):
        self.storage.delete_trip(trip_id)

    def history(self, query: str = "", trip_id: Optional[int] = None):
        return self.storage.search_events(query=query, trip_id=trip_id)

    def trip_events(self, trip_id: int):
        return self.storage.get_events(trip_id)

    def export_trip_markdown(self, trip_id: int) -> str:
        return self.storage.export_trip_markdown(trip_id)

    def llm_free_models(self) -> Dict:
        models = list(self.llm_provider.list_free_models())
        if self.openai_provider and self.openai_provider.api_key:
            models.extend(self.openai_provider.list_free_models())
        return {
            "provider": getattr(self.llm_provider, "provider_name", "none"),
            "default_model": self.llm_provider.default_model,
            "models": models,
        }

    def tts_options(self) -> Dict:
        return {
            "provider": getattr(self.tts_provider, "provider_name", "browser"),
            "voices": self.tts_provider.list_voices(),
        }

    def synthesize_tts(self, text: str, voice: str = "") -> Optional[Dict]:
        result = self.tts_provider.synthesize(text, voice=voice)
        if not result:
            return None
        audio, mime_type, resolved_voice = result
        return audio_json_payload(audio, mime_type, resolved_voice, getattr(self.tts_provider, "provider_name", "openai"))

    def narrate_selected_place(self, trip_id: int, place_payload: Dict) -> Dict:
        trip = self.storage.get_trip(trip_id)
        if not trip:
            raise KeyError("Trip not found")
        settings = TripSettings.from_dict(trip["settings"])
        provider = self.live_provider if settings.live_providers else self.demo_provider
        latitude = float(place_payload["latitude"])
        longitude = float(place_payload["longitude"])
        nearby = provider.nearby_places(latitude, longitude)
        nearby_towns = provider.nearby_towns(latitude, longitude)
        nearby_queue = self.route_forecaster.nearby_queue(latitude, longitude, nearby_towns, limit=6)
        if place_payload.get("kind") and place_payload.get("blurb"):
            region = place_payload.get("region") or provider.reverse_geocode(latitude, longitude).region
            narration = self.narration_builder.build_selected_point_script(
                place_payload.get("name", "Selected stop"),
                region,
                place_payload["blurb"],
                age_band=settings.age_band,
            )
            narration["script"] = self._maybe_llm_narrate(
                narration["script"],
                {
                    "age_band": settings.age_band,
                    "narration_mode": settings.narration_mode,
                    "kind": "selected_point",
                    "point_name": place_payload.get("name", "Selected stop"),
                    "region": region,
                    "blurb": place_payload["blurb"],
                },
                settings.llm_model,
            )
            place_name = place_payload.get("name", "Selected stop")
            place_region = region
        else:
            place = provider.reverse_geocode(latitude, longitude)
            place.name = place_payload.get("name", place.name)
            place.region = place_payload.get("region", place.region)
            place.latitude = latitude
            place.longitude = longitude
            place = provider.enrich(place)
            narration = self.narration_builder.build_current_place_script(
                place,
                nearby,
                mode=settings.narration_mode,
                age_band=settings.age_band,
            )
            narration["script"] = self._maybe_llm_narrate(
                narration["script"],
                {
                    "age_band": settings.age_band,
                    "narration_mode": settings.narration_mode,
                    "kind": "selected_place",
                    "place": place.to_dict(),
                    "nearby_points": [point.to_dict() for point in nearby],
                },
                settings.llm_model,
            )
            place_name = place.name
            place_region = place.region
        event = self.storage.add_event(
            trip_id=trip_id,
            place_name=place_name,
            region=place_region,
            title=narration["title"],
            script=narration["script"],
            trigger_type="selected_place",
            latitude=latitude,
            longitude=longitude,
            score=0.9,
            tags=narration["tags"] + ["manual_selection"],
        )
        return {
            "trip": trip,
            "selected_place": {
                "name": place_name,
                "region": place_region,
                "latitude": latitude,
                "longitude": longitude,
            },
            "nearby_towns": nearby_queue,
            "nearby_points": [point.to_dict() for point in nearby],
            "event": event,
        }

    def ingest_location(
        self,
        trip_id: int,
        latitude: float,
        longitude: float,
        speed_kph: Optional[float] = None,
        heading_deg: Optional[float] = None,
    ) -> Dict:
        trip = self.storage.get_trip(trip_id)
        if not trip:
            raise KeyError("Trip not found")
        settings = TripSettings.from_dict(trip["settings"])
        provider = self.live_provider if settings.live_providers else self.demo_provider
        location = self.storage.add_location(trip_id, latitude, longitude, speed_kph=speed_kph, heading_deg=heading_deg)
        place = provider.reverse_geocode(latitude, longitude)
        place = provider.enrich(place)
        nearby = provider.nearby_places(latitude, longitude)
        history = self.storage.recent_locations(trip_id, limit=8)
        nearby_towns = provider.nearby_towns(latitude, longitude)
        nearby_queue = self.route_forecaster.nearby_queue(latitude, longitude, nearby_towns, limit=6)
        last_event = self.storage.get_last_event(trip_id)
        should_narrate, score, reason = self.relevance.should_narrate(
            place,
            nearby,
            last_event,
            settings,
            current_latitude=latitude,
            current_longitude=longitude,
        )

        event = None
        if should_narrate:
            narration = self.narration_builder.build_current_place_script(
                place,
                nearby,
                mode=settings.narration_mode,
                age_band=settings.age_band,
            )
            narration["script"] = self._maybe_llm_narrate(
                narration["script"],
                {
                    "age_band": settings.age_band,
                    "narration_mode": settings.narration_mode,
                    "kind": "current_place",
                    "place": place.to_dict(),
                    "nearby_points": [point.to_dict() for point in nearby],
                },
                settings.llm_model,
            )
            if settings.save_history:
                event = self.storage.add_event(
                    trip_id=trip_id,
                    place_name=place.name,
                    region=place.region,
                    title=narration["title"],
                    script=narration["script"],
                    trigger_type="current_place",
                    latitude=latitude,
                    longitude=longitude,
                    score=score,
                    tags=narration["tags"],
                )
        return {
            "trip": trip,
            "current_place": place.to_dict(),
            "nearby_towns": nearby_queue,
            "nearby_points": [point.to_dict() for point in nearby],
            "event": event,
            "decision": {
                "should_narrate": should_narrate,
                "score": score,
                "reason": reason,
            },
            "location": location,
        }

    def _maybe_llm_narrate(self, fallback_script: str, context: Dict, model_override: str = "") -> str:
        if model_override.startswith("openai:") and self.openai_provider:
            model = model_override[7:]
            llm_script = self.openai_provider.generate_narration(fallback_script, context, model_override=model)
        elif model_override.startswith("openai:"):
            llm_script = self.llm_provider.generate_narration(fallback_script, context)
        else:
            llm_script = self.llm_provider.generate_narration(fallback_script, context, model_override=model_override)
        return llm_script or fallback_script
