import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from storyguide.providers import CATALOG
from storyguide.relevance import haversine_km


@dataclass
class RoutePlan:
    geometry: List[Dict]
    waypoints: List[Dict]
    distance_m: float
    duration_s: float
    source: str
    fallback: bool = False


class RoutingError(RuntimeError):
    pass


class OSRMRoutingProvider:
    def __init__(self, base_url: Optional[str] = None, timeout: float = 12.0):
        self.base_url = (base_url or os.environ.get("ROADTRIPPER_OSRM_URL") or "https://router.project-osrm.org").rstrip("/")
        self.timeout = timeout

    def plan_route(self, waypoints: Sequence[Dict]) -> RoutePlan:
        if len(waypoints) < 2:
            raise ValueError("At least two waypoints are required")
        coords = ";".join("%s,%s" % (point["longitude"], point["latitude"]) for point in waypoints)
        params = urllib.parse.urlencode(
            {
                "source": "first",
                "destination": "last",
                "roundtrip": "false",
                "overview": "full",
                "geometries": "geojson",
                "steps": "false",
            }
        )
        url = "%s/trip/v1/driving/%s?%s" % (self.base_url, coords, params)
        request = urllib.request.Request(url, headers={"User-Agent": "RoadTripper/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
            raise RoutingError("Routing provider failed: %s" % exc) from exc
        if payload.get("code") != "Ok" or not payload.get("trips"):
            raise RoutingError(payload.get("message") or "Routing provider returned no trip")
        trip = payload["trips"][0]
        geometry = [
            {"latitude": float(lat), "longitude": float(lon)}
            for lon, lat in trip.get("geometry", {}).get("coordinates", [])
        ]
        if not geometry:
            raise RoutingError("Routing provider returned an empty route")
        optimized = self._optimized_waypoints(waypoints, payload.get("waypoints", []))
        return RoutePlan(
            geometry=geometry,
            waypoints=optimized,
            distance_m=float(trip.get("distance") or 0.0),
            duration_s=float(trip.get("duration") or 0.0),
            source="osrm",
            fallback=False,
        )

    def _optimized_waypoints(self, input_waypoints: Sequence[Dict], osrm_waypoints: Sequence[Dict]) -> List[Dict]:
        ordered = []
        for input_index, original in enumerate(input_waypoints):
            waypoint_index = input_index
            if input_index < len(osrm_waypoints):
                try:
                    waypoint_index = int(osrm_waypoints[input_index].get("waypoint_index", input_index))
                except (TypeError, ValueError):
                    waypoint_index = input_index
            payload = dict(original)
            payload["input_order"] = input_index
            payload["optimized_order"] = waypoint_index
            ordered.append(payload)
        ordered.sort(key=lambda item: item["optimized_order"])
        for index, item in enumerate(ordered):
            item["optimized_order"] = index
        return ordered


class FallbackRoutingProvider:
    def plan_route(self, waypoints: Sequence[Dict]) -> RoutePlan:
        if len(waypoints) < 2:
            raise ValueError("At least two waypoints are required")
        geometry = [{"latitude": float(point["latitude"]), "longitude": float(point["longitude"])} for point in waypoints]
        distance_m = 0.0
        for previous, current in zip(geometry, geometry[1:]):
            distance_m += haversine_km(
                previous["latitude"],
                previous["longitude"],
                current["latitude"],
                current["longitude"],
            ) * 1000.0
        optimized = []
        for index, point in enumerate(waypoints):
            payload = dict(point)
            payload["input_order"] = index
            payload["optimized_order"] = index
            optimized.append(payload)
        return RoutePlan(
            geometry=geometry,
            waypoints=optimized,
            distance_m=distance_m,
            duration_s=(distance_m / 1000.0 / 80.0) * 3600.0 if distance_m else 0.0,
            source="straight_line_fallback",
            fallback=True,
        )


class ResilientRoutingProvider:
    def __init__(self, primary=None, fallback=None):
        self.primary = primary or OSRMRoutingProvider()
        self.fallback = fallback or FallbackRoutingProvider()

    def plan_route(self, waypoints: Sequence[Dict]) -> RoutePlan:
        try:
            return self.primary.plan_route(waypoints)
        except RoutingError:
            return self.fallback.plan_route(waypoints)


class TownGazetteer:
    def __init__(self, data_path: Optional[str] = None):
        self.data_path = Path(data_path) if data_path else _default_town_data_path()
        self._towns = None

    def towns_along_route(
        self,
        geometry: Sequence[Dict],
        min_population: int = 200,
        corridor_km: float = 12.0,
    ) -> List[Dict]:
        towns = [town for town in self._load_towns() if int(town.get("population") or 0) > min_population]
        route = [(float(point["latitude"]), float(point["longitude"])) for point in geometry]
        if len(route) < 2:
            return []
        candidates = []
        seen = set()
        for town in towns:
            key = ((town.get("name") or "").lower(), (town.get("region") or "").lower())
            if key in seen:
                continue
            lat = float(town["latitude"])
            lon = float(town["longitude"])
            distance_km, route_position = distance_to_route_km(lat, lon, route)
            if distance_km <= corridor_km:
                payload = dict(town)
                payload["distance_km"] = round(distance_km, 2)
                payload["route_position"] = round(route_position, 4)
                candidates.append(payload)
                seen.add(key)
        candidates.sort(key=lambda item: (item["route_position"], item["distance_km"]))
        return candidates

    def _load_towns(self) -> List[Dict]:
        if self._towns is not None:
            return self._towns
        if self.data_path and self.data_path.exists():
            with open(self.data_path) as fh:
                raw = json.load(fh)
            towns = raw.get("towns", raw if isinstance(raw, list) else [])
            self._towns = [_normalize_town(town) for town in towns if _normalize_town(town)]
            return self._towns
        self._towns = [_normalize_town(place.to_dict()) for place in CATALOG]
        return self._towns


def distance_to_route_km(latitude: float, longitude: float, route: Sequence[Tuple[float, float]]) -> Tuple[float, float]:
    best_distance = float("inf")
    best_position = 0.0
    total_segments = max(1, len(route) - 1)
    for index, (start, end) in enumerate(zip(route, route[1:])):
        distance = _point_segment_distance_km(latitude, longitude, start, end)
        if distance < best_distance:
            best_distance = distance
            best_position = index / total_segments
    return best_distance, best_position


def _point_segment_distance_km(
    latitude: float,
    longitude: float,
    start: Tuple[float, float],
    end: Tuple[float, float],
) -> float:
    mean_lat = math.radians((start[0] + end[0] + latitude) / 3.0)
    x = longitude * 111.320 * math.cos(mean_lat)
    y = latitude * 110.574
    x1 = start[1] * 111.320 * math.cos(mean_lat)
    y1 = start[0] * 110.574
    x2 = end[1] * 111.320 * math.cos(mean_lat)
    y2 = end[0] * 110.574
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return haversine_km(latitude, longitude, start[0], start[1])
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / ((dx * dx) + (dy * dy))))
    px = x1 + (t * dx)
    py = y1 + (t * dy)
    return math.hypot(x - px, y - py)


def _normalize_town(raw: Dict) -> Optional[Dict]:
    try:
        latitude = float(raw.get("latitude", raw.get("lat")))
        longitude = float(raw.get("longitude", raw.get("lon")))
    except (TypeError, ValueError):
        return None
    name = raw.get("name") or raw.get("city")
    region = raw.get("region") or raw.get("state") or raw.get("state_name")
    if not name or not region:
        return None
    try:
        population = int(raw.get("population") or raw.get("pop") or 0)
    except (TypeError, ValueError):
        population = 0
    return {
        "name": str(name),
        "region": str(region),
        "country": raw.get("country") or "USA",
        "latitude": latitude,
        "longitude": longitude,
        "population": population,
        "source": raw.get("source") or "gazetteer",
    }


def _default_town_data_path() -> Path:
    configured = os.environ.get("ROADTRIPPER_TOWN_DATA")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent / "data" / "us_towns.json"
