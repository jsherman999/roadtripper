import json
import math
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import replace
from typing import Dict, Iterable, List, Optional

from storyguide.models import NearbyPlace, PlaceProfile
from storyguide.relevance import haversine_km


CATALOG = [
    PlaceProfile(
        name="Austin",
        region="Texas",
        latitude=30.2672,
        longitude=-97.7431,
        population=974447,
        known_for="live music, technology, and many outdoor spaces",
        history="the city grew from a small capital town into a creative and university-centered hub",
        high_school_enrollment=2750,
        landmarks=["Texas State Capitol", "Lady Bird Lake"],
        trivia=["Bat watching under the Congress Avenue Bridge is a famous local tradition"],
    ),
    PlaceProfile(
        name="Georgetown",
        region="Texas",
        latitude=30.6333,
        longitude=-97.6770,
        population=79953,
        known_for="a historic downtown square and scenic river parks",
        history="Georgetown was shaped by railroad growth and the nearby university community",
        high_school_enrollment=2200,
        landmarks=["Blue Hole Park", "Georgetown Square"],
        trivia=["Its downtown square is often used for festivals and holiday events"],
    ),
    PlaceProfile(
        name="Temple",
        region="Texas",
        latitude=31.0982,
        longitude=-97.3428,
        population=87589,
        known_for="regional medical care and railroad history",
        history="Temple expanded rapidly when the railroad made it an important stop in Central Texas",
        high_school_enrollment=1900,
        landmarks=["Czech Heritage Museum", "Temple Railroad and Heritage Museum"],
        trivia=["Temple has long been known as a crossroads city for travelers"],
    ),
    PlaceProfile(
        name="Waco",
        region="Texas",
        latitude=31.5493,
        longitude=-97.1467,
        population=144816,
        known_for="Baylor University, riverfront sights, and museums",
        history="Waco grew along the Brazos River and became a major trading and education center",
        high_school_enrollment=2100,
        landmarks=["Cameron Park Zoo", "Dr Pepper Museum"],
        trivia=["Dr Pepper was first served in Waco in the 1880s"],
    ),
]

LANDMARKS = [
    NearbyPlace(
        name="Inner Space Cavern",
        latitude=30.6322,
        longitude=-97.6882,
        kind="cave",
        blurb="A cave with dramatic rock formations and guided tours.",
    ),
    NearbyPlace(
        name="Texas State Capitol",
        latitude=30.2747,
        longitude=-97.7403,
        kind="landmark",
        blurb="The large pink granite capitol building in Austin.",
    ),
    NearbyPlace(
        name="Dr Pepper Museum",
        latitude=31.5577,
        longitude=-97.1333,
        kind="museum",
        blurb="A museum celebrating the soft drink first served in Waco.",
    ),
]


class DemoPlaceProvider:
    def __init__(self, catalog: Optional[Iterable[PlaceProfile]] = None, landmarks: Optional[Iterable[NearbyPlace]] = None):
        self.catalog = list(catalog or CATALOG)
        self.landmarks = list(landmarks or LANDMARKS)

    def known_places(self) -> List[PlaceProfile]:
        return [replace(place) for place in self.catalog]

    def reverse_geocode(self, latitude: float, longitude: float) -> PlaceProfile:
        nearest = min(
            self.catalog,
            key=lambda place: haversine_km(latitude, longitude, place.latitude, place.longitude),
        )
        return replace(nearest)

    def nearby_places(self, latitude: float, longitude: float, max_distance_km: float = 20.0) -> List[NearbyPlace]:
        results = []
        for place in self.landmarks:
            distance = haversine_km(latitude, longitude, place.latitude, place.longitude)
            if distance <= max_distance_km:
                results.append((distance, place))
        results.sort(key=lambda item: item[0])
        return [item[1] for item in results]

    def enrich(self, place: PlaceProfile) -> PlaceProfile:
        return place

    def nearby_towns(
        self,
        latitude: float,
        longitude: float,
        limit: int = 6,
        max_distance_km: float = 120.0,
    ) -> List[Dict]:
        results = []
        for place in self.catalog:
            distance = haversine_km(latitude, longitude, place.latitude, place.longitude)
            if distance <= 1.0 or distance > max_distance_km:
                continue
            payload = replace(place).to_dict()
            payload["distance_km"] = round(distance, 1)
            results.append(payload)
        results.sort(key=lambda item: item["distance_km"])
        return results[:limit]


class LiveWikipediaSummaryProvider:
    def fetch_summary(self, title: str) -> Optional[str]:
        encoded = urllib.parse.quote(title)
        url = "https://en.wikipedia.org/api/rest_v1/page/summary/%s" % encoded
        request = urllib.request.Request(url, headers={"User-Agent": "RoadTripStoryguide/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return None
        return payload.get("extract")


class LivePlaceProvider:
    def __init__(
        self,
        fallback: DemoPlaceProvider,
        summary_provider: Optional[LiveWikipediaSummaryProvider] = None,
        allow_demo_fallback: bool = False,
    ):
        self.fallback = fallback
        self.summary_provider = summary_provider or LiveWikipediaSummaryProvider()
        self.allow_demo_fallback = allow_demo_fallback

    def known_places(self) -> List[PlaceProfile]:
        return self.fallback.known_places() if self.allow_demo_fallback else []

    def _blank_place(self, latitude: float, longitude: float) -> PlaceProfile:
        return PlaceProfile(
            name="Unknown place",
            region="Unknown region",
            latitude=latitude,
            longitude=longitude,
            source="live",
            confidence=0.6,
        )

    def reverse_geocode(self, latitude: float, longitude: float) -> PlaceProfile:
        url = (
            "https://nominatim.openstreetmap.org/reverse?format=jsonv2"
            "&lat=%s&lon=%s" % (urllib.parse.quote(str(latitude)), urllib.parse.quote(str(longitude)))
        )
        request = urllib.request.Request(url, headers={"User-Agent": "RoadTripStoryguide/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            if self.allow_demo_fallback:
                return self.fallback.reverse_geocode(latitude, longitude)
            return self._blank_place(latitude, longitude)
        address = payload.get("address", {})
        place = self.fallback.reverse_geocode(latitude, longitude) if self.allow_demo_fallback else self._blank_place(latitude, longitude)
        name = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("hamlet")
            or address.get("municipality")
            or address.get("county")
            or payload.get("name")
            or place.name
        )
        region = address.get("state") or place.region
        return replace(place, name=name, region=region, latitude=latitude, longitude=longitude, source="live")

    def nearby_places(self, latitude: float, longitude: float, max_distance_km: float = 20.0) -> List[NearbyPlace]:
        radius_m = int(max_distance_km * 1000)
        params = urllib.parse.urlencode(
            {
                "action": "query",
                "list": "geosearch",
                "gscoord": "%s|%s" % (latitude, longitude),
                "gsradius": str(min(radius_m, 10000)),
                "gslimit": "8",
                "format": "json",
            }
        )
        url = "https://en.wikipedia.org/w/api.php?%s" % params
        request = urllib.request.Request(url, headers={"User-Agent": "RoadTripStoryguide/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return self.fallback.nearby_places(latitude, longitude, max_distance_km=max_distance_km) if self.allow_demo_fallback else []
        points = []
        for item in payload.get("query", {}).get("geosearch", []):
            points.append(
                NearbyPlace(
                    name=item.get("title", "Nearby point of interest"),
                    latitude=float(item.get("lat", latitude)),
                    longitude=float(item.get("lon", longitude)),
                    kind="point-of-interest",
                    blurb="A nearby point of interest discovered on the map.",
                )
            )
        return points or (self.fallback.nearby_places(latitude, longitude, max_distance_km=max_distance_km) if self.allow_demo_fallback else [])

    def nearby_towns(
        self,
        latitude: float,
        longitude: float,
        limit: int = 6,
        max_distance_km: float = 80.0,
    ) -> List[Dict]:
        lat_delta = max_distance_km / 111.0
        lon_delta = max_distance_km / max(20.0, 111.0 * max(0.2, math.cos(math.radians(latitude))))
        viewbox = ",".join(
            [
                str(longitude - lon_delta),
                str(latitude + lat_delta),
                str(longitude + lon_delta),
                str(latitude - lat_delta),
            ]
        )
        params = urllib.parse.urlencode(
            {
                "format": "jsonv2",
                "limit": str(limit * 3),
                "bounded": "1",
                "addressdetails": "1",
                "featureType": "city",
                "viewbox": viewbox,
                "q": "",
            }
        )
        url = "https://nominatim.openstreetmap.org/search?%s" % params
        request = urllib.request.Request(url, headers={"User-Agent": "RoadTripStoryguide/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return self.fallback.nearby_towns(latitude, longitude, limit=limit, max_distance_km=max_distance_km) if self.allow_demo_fallback else []
        results = []
        seen = set()
        for item in payload:
            try:
                town_lat = float(item["lat"])
                town_lon = float(item["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            distance = haversine_km(latitude, longitude, town_lat, town_lon)
            if distance <= 1.0 or distance > max_distance_km:
                continue
            address = item.get("address", {})
            name = (
                address.get("city")
                or address.get("town")
                or address.get("village")
                or item.get("name")
                or item.get("display_name", "").split(",")[0]
            )
            region = address.get("state") or address.get("county") or "Unknown"
            key = (name, region)
            if not name or key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "name": name,
                    "region": region,
                    "latitude": town_lat,
                    "longitude": town_lon,
                    "distance_km": round(distance, 1),
                    "country": address.get("country", "USA"),
                    "source": "live",
                }
            )
        results.sort(key=lambda item: item["distance_km"])
        if not results:
            return self.fallback.nearby_towns(latitude, longitude, limit=limit, max_distance_km=max_distance_km) if self.allow_demo_fallback else []
        return results[:limit]

    def enrich(self, place: PlaceProfile) -> PlaceProfile:
        try:
            summary = self.summary_provider.fetch_summary("%s, %s" % (place.name, place.region))
        except OSError:
            return place
        if not summary:
            try:
                summary = self.summary_provider.fetch_summary(place.name)
            except OSError:
                return place
        if not summary:
            return place
        fragments = [fragment.strip() for fragment in summary.split(".") if fragment.strip()]
        history = place.history
        known_for = place.known_for
        trivia = list(place.trivia)
        if fragments:
            known_for = known_for or fragments[0]
        if len(fragments) > 1 and not history:
            history = fragments[1]
        if len(fragments) > 2 and not trivia:
            trivia = [fragments[2]]
        return replace(place, known_for=known_for, history=history, trivia=trivia, source="live")
