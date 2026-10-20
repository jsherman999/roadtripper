from typing import Iterable

from storyguide.relevance import haversine_km


class NearbyTownRanker:
    """Ranks nearby towns by straight-line distance. It does not consider heading."""

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
