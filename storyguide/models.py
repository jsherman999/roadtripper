from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class TripSettings:
    kid_mode: bool = True
    save_history: bool = True
    narration_mode: str = "storyteller"
    age_band: str = "adult"
    live_providers: bool = False
    llm_model: str = ""
    minimum_interval_minutes: int = 3
    minimum_distance_km: float = 8.0

    @classmethod
    def from_dict(cls, payload: Optional[Dict]) -> "TripSettings":
        payload = payload or {}
        defaults = cls()
        return cls(
            kid_mode=bool(payload.get("kid_mode", defaults.kid_mode)),
            save_history=bool(payload.get("save_history", defaults.save_history)),
            narration_mode=str(payload.get("narration_mode", defaults.narration_mode)),
            age_band=str(payload.get("age_band", defaults.age_band)),
            live_providers=bool(payload.get("live_providers", defaults.live_providers)),
            llm_model=str(payload.get("llm_model", defaults.llm_model)),
            minimum_interval_minutes=int(payload.get("minimum_interval_minutes", defaults.minimum_interval_minutes)),
            minimum_distance_km=float(payload.get("minimum_distance_km", defaults.minimum_distance_km)),
        )

    def to_dict(self) -> Dict:
        return {
            "kid_mode": self.kid_mode,
            "save_history": self.save_history,
            "narration_mode": self.narration_mode,
            "age_band": self.age_band,
            "live_providers": self.live_providers,
            "llm_model": self.llm_model,
            "minimum_interval_minutes": self.minimum_interval_minutes,
            "minimum_distance_km": self.minimum_distance_km,
        }


@dataclass
class PlaceProfile:
    name: str
    region: str
    country: str = "USA"
    latitude: float = 0.0
    longitude: float = 0.0
    population: Optional[int] = None
    known_for: Optional[str] = None
    history: Optional[str] = None
    high_school_enrollment: Optional[int] = None
    landmarks: List[str] = field(default_factory=list)
    trivia: List[str] = field(default_factory=list)
    raw_extract: str = ""
    source: str = "demo"
    confidence: float = 0.85

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "region": self.region,
            "country": self.country,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "population": self.population,
            "known_for": self.known_for,
            "history": self.history,
            "high_school_enrollment": self.high_school_enrollment,
            "landmarks": list(self.landmarks),
            "trivia": list(self.trivia),
            "raw_extract": self.raw_extract,
            "source": self.source,
            "confidence": self.confidence,
        }


@dataclass
class NearbyPlace:
    name: str
    latitude: float
    longitude: float
    kind: str
    blurb: str

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "kind": self.kind,
            "blurb": self.blurb,
        }
