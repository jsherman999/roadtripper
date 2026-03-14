from typing import Iterable, List, Optional

from storyguide.relevance import bearing_degrees, haversine_km


def _bearing_delta(a: float, b: float) -> float:
    delta = abs(a - b) % 360.0
    return min(delta, 360.0 - delta)


class RouteForecaster:
    def nearby_queue(self, latitude: float, longitude: float, nearby_towns: Iterable, limit: int = 6):
        suggestions = []
        for place in nearby_towns:
            if isinstance(place, dict):
                lat = float(place["latitude"])
                lon = float(place["longitude"])
                payload = dict(place)
            else:
                lat = float(place.latitude)
                lon = float(place.longitude)
                payload = place.to_dict()
            distance = haversine_km(latitude, longitude, lat, lon)
            if distance <= 1.0:
                continue
            payload["distance_km"] = round(distance, 1)
            suggestions.append(payload)
        suggestions.sort(key=lambda item: item["distance_km"])
        return suggestions[:limit]

    def upcoming_places(self, history: List[dict], known_places: Iterable, limit: int = 3):
        if len(history) < 2:
            return []
        previous = history[-2]
        current = history[-1]
        heading = bearing_degrees(
            float(previous["latitude"]),
            float(previous["longitude"]),
            float(current["latitude"]),
            float(current["longitude"]),
        )
        suggestions = []
        for place in known_places:
            distance = haversine_km(
                float(current["latitude"]),
                float(current["longitude"]),
                float(place.latitude),
                float(place.longitude),
            )
            if distance < 2.0:
                continue
            place_heading = bearing_degrees(
                float(current["latitude"]),
                float(current["longitude"]),
                float(place.latitude),
                float(place.longitude),
            )
            if _bearing_delta(heading, place_heading) <= 45.0:
                suggestions.append((distance, place))
        suggestions.sort(key=lambda item: item[0])
        upcoming = []
        for distance, place in suggestions[:limit]:
            payload = place.to_dict()
            payload["distance_km"] = round(distance, 1)
            upcoming.append(payload)
        return upcoming

    def best_upcoming(self, history: List[dict], known_places: Iterable) -> Optional[dict]:
        candidates = self.upcoming_places(history, known_places, limit=1)
        return candidates[0] if candidates else None
