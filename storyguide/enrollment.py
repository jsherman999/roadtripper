import json
import math
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from storyguide.relevance import haversine_km

TARGET_STATES = {"MN", "IA", "MO", "KS", "AR", "OK", "TX"}

STATE_NAMES_TO_ABBR = {
    "Minnesota": "MN",
    "Iowa": "IA",
    "Missouri": "MO",
    "Kansas": "KS",
    "Arkansas": "AR",
    "Oklahoma": "OK",
    "Texas": "TX",
}

STATE_ABBR_TO_NAME = {v: k for k, v in STATE_NAMES_TO_ABBR.items()}


class EnrollmentDB:
    def __init__(self, data_path: Optional[str] = None):
        self._schools: List[Dict] = []
        self._by_town: Dict[Tuple[str, str], int] = {}
        self._loaded = False
        if data_path:
            self.load(data_path)
        else:
            default = _default_data_path()
            if default and default.exists():
                try:
                    self.load(str(default))
                except (json.JSONDecodeError, KeyError, ValueError):
                    pass

    def load(self, path: str) -> None:
        with open(path) as f:
            raw = json.load(f)
        schools = raw.get("schools", raw if isinstance(raw, list) else [])
        self._schools = []
        self._by_town.clear()
        for entry in schools:
            self._schools.append(entry)
            city = (entry.get("city") or "").lower().strip()
            state = (entry.get("state") or "").upper().strip()
            if not city or state not in TARGET_STATES:
                continue
            key = (city, state)
            self._by_town[key] = self._by_town.get(key, 0) + int(entry.get("enrollment", 0))
        self._loaded = True

    def town_enrollment(self, town_name: str, state: str) -> Optional[int]:
        state_abbr = _resolve_state(state)
        if not state_abbr:
            return None
        key = (town_name.lower().strip(), state_abbr)
        return self._by_town.get(key)

    def nearby_enrollment(
        self, lat: float, lon: float, state: str, radius_km: float = 15.0
    ) -> Optional[int]:
        state_abbr = _resolve_state(state)
        if not state_abbr:
            return None
        total = 0
        for school in self._schools:
            if (school.get("state") or "").upper() != state_abbr:
                continue
            slat = float(school.get("lat", 0) or 0)
            slon = float(school.get("lon", 0) or 0)
            if not slat and not slon:
                continue
            if haversine_km(lat, lon, slat, slon) <= radius_km:
                total += int(school.get("enrollment", 0))
        return total if total > 0 else None

    def nearby_enrollment_any_state(
        self, lat: float, lon: float, radius_km: float = 15.0
    ) -> Optional[int]:
        total = 0
        for school in self._schools:
            slat = float(school.get("lat", 0) or 0)
            slon = float(school.get("lon", 0) or 0)
            if not slat and not slon:
                continue
            if haversine_km(lat, lon, slat, slon) <= radius_km:
                total += int(school.get("enrollment", 0))
        return total if total > 0 else None

    @property
    def loaded(self) -> bool:
        return self._loaded and len(self._schools) > 0

    def __bool__(self) -> bool:
        return self.loaded


def _resolve_state(state: str) -> Optional[str]:
    cleaned = state.strip()
    if len(cleaned) == 2 and cleaned.upper() in TARGET_STATES:
        return cleaned.upper()
    return STATE_NAMES_TO_ABBR.get(cleaned)


def _default_data_path() -> Optional[Path]:
    data_dir = os.environ.get("ROADTRIPPER_DATA_DIR")
    if data_dir:
        return Path(data_dir) / "enrollment.json"
    candidate = Path(__file__).resolve().parent / "data" / "enrollment.json"
    return candidate
