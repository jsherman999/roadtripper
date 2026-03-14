import math
from typing import Iterable, Optional


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_degrees(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)
    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


class RelevanceEngine:
    def __init__(self, score_threshold: float = 0.35):
        self.score_threshold = score_threshold

    def score_place(self, place, nearby_places: Iterable) -> float:
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
        if list(nearby_places):
            score += 0.15
        return min(score, 1.0)

    def should_narrate(
        self,
        place,
        nearby_places: Iterable,
        last_event: Optional[dict],
        trip_settings,
        current_latitude: float,
        current_longitude: float,
    ):
        score = self.score_place(place, nearby_places)
        if score < self.score_threshold:
            return False, score, "score_below_threshold"
        if not last_event:
            return True, score, "first_event"
        if last_event["place_name"] == place.name:
            moved_km = haversine_km(
                current_latitude,
                current_longitude,
                float(last_event["latitude"]),
                float(last_event["longitude"]),
            )
            if moved_km < trip_settings.minimum_distance_km:
                return False, score, "cooldown_distance"
        return True, score, "new_place_or_far_enough"
