import math
from datetime import datetime, timezone
from typing import Iterable, Optional

from storyguide.models import MANUAL_TRIGGERS


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _minutes_since(recorded_at: Optional[str], now: Optional[datetime] = None) -> float:
    try:
        then = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
    except ValueError:
        return float("inf")
    return ((now or datetime.now(timezone.utc)) - then).total_seconds() / 60.0


class RelevanceEngine:
    def __init__(self, score_threshold: float = 0.35):
        self.score_threshold = score_threshold

    def score_place(self, place, nearby_points: Iterable) -> float:
        score = 0.2
        if place.population:
            score += 0.15 if place.population >= 10000 else 0.05
        if place.known_for:
            score += 0.2
        if place.history:
            score += 0.15
        if place.high_school_enrollment:
            score += 0.1
        if place.trivia:
            score += 0.1
        if list(nearby_points):
            score += 0.15
        return min(score, 1.0)

    def should_narrate(
        self,
        place,
        nearby_points: Iterable,
        last_event: Optional[dict],
        trip_settings,
        current_latitude: float,
        current_longitude: float,
        now: Optional[datetime] = None,
    ):
        score = self.score_place(place, nearby_points)
        if score < self.score_threshold:
            return False, score, "score_below_threshold"
        if not last_event:
            return True, score, "first_event"
        moved_km = haversine_km(
            current_latitude,
            current_longitude,
            float(last_event["latitude"]),
            float(last_event["longitude"]),
        )
        if last_event.get("trigger_type") in MANUAL_TRIGGERS:
            if moved_km < trip_settings.minimum_distance_km:
                return False, score, "cooldown_after_manual_selection"
            return True, score, "moved_past_manual_selection"
        if last_event["place_name"] == place.name:
            if moved_km < trip_settings.minimum_distance_km:
                return False, score, "cooldown_distance"
            if _minutes_since(last_event.get("recorded_at"), now) < trip_settings.minimum_interval_minutes:
                return False, score, "cooldown_interval"
        return True, score, "new_place_or_far_enough"
