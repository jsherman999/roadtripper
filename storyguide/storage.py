import json
import sqlite3
import threading
from datetime import datetime
from typing import Dict, List, Optional


def utcnow() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


class Storage:
    def __init__(self, path: str = "storyguide.sqlite3"):
        self.path = path
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(self.path, check_same_thread=False, timeout=30.0)
        self.connection.row_factory = sqlite3.Row
        with self.lock:
            self.connection.execute("PRAGMA busy_timeout = 30000")
            self.connection.execute("PRAGMA journal_mode = WAL")
        self._init_schema()

    def _init_schema(self):
        with self.lock:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS trips (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    settings_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS locations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trip_id INTEGER NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    speed_kph REAL,
                    heading_deg REAL,
                    recorded_at TEXT NOT NULL,
                    FOREIGN KEY(trip_id) REFERENCES trips(id)
                );

                CREATE TABLE IF NOT EXISTS narration_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trip_id INTEGER NOT NULL,
                    place_name TEXT NOT NULL,
                    region TEXT NOT NULL,
                    title TEXT NOT NULL,
                    script TEXT NOT NULL,
                    trigger_type TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    score REAL NOT NULL,
                    tags_json TEXT NOT NULL,
                    recorded_at TEXT NOT NULL,
                    FOREIGN KEY(trip_id) REFERENCES trips(id)
                );

                CREATE TABLE IF NOT EXISTS plotted_routes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trip_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    route_source TEXT NOT NULL,
                    distance_m REAL NOT NULL,
                    duration_s REAL NOT NULL,
                    geometry_json TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    FOREIGN KEY(trip_id) REFERENCES trips(id)
                );

                CREATE TABLE IF NOT EXISTS plotted_waypoints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    route_id INTEGER NOT NULL,
                    input_order INTEGER NOT NULL,
                    optimized_order INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    FOREIGN KEY(route_id) REFERENCES plotted_routes(id)
                );

                CREATE TABLE IF NOT EXISTS route_towns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    route_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    region TEXT NOT NULL,
                    country TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    population INTEGER,
                    distance_km REAL NOT NULL,
                    route_position REAL NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT,
                    research_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(route_id) REFERENCES plotted_routes(id)
                );
                """
            )
            self.connection.commit()

    def create_trip(self, name: str, settings: Dict) -> Dict:
        started_at = utcnow()
        with self.lock:
            cursor = self.connection.execute(
                "INSERT INTO trips(name, status, started_at, settings_json) VALUES (?, 'active', ?, ?)",
                (name, started_at, json.dumps(settings)),
            )
            self.connection.commit()
        return self.get_trip(cursor.lastrowid)

    def get_trip(self, trip_id: int) -> Optional[Dict]:
        with self.lock:
            row = self.connection.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
        return self._trip_row_to_dict(row) if row else None

    def list_trips(self) -> List[Dict]:
        with self.lock:
            rows = self.connection.execute("SELECT * FROM trips ORDER BY id DESC").fetchall()
        return [self._trip_row_to_dict(row) for row in rows]

    def stop_trip(self, trip_id: int) -> Optional[Dict]:
        with self.lock:
            self.connection.execute(
                "UPDATE trips SET status = 'stopped', ended_at = ? WHERE id = ?",
                (utcnow(), trip_id),
            )
            self.connection.commit()
        return self.get_trip(trip_id)

    def delete_trip(self, trip_id: int):
        with self.lock:
            route_rows = self.connection.execute("SELECT id FROM plotted_routes WHERE trip_id = ?", (trip_id,)).fetchall()
            for row in route_rows:
                self.connection.execute("DELETE FROM plotted_waypoints WHERE route_id = ?", (row["id"],))
                self.connection.execute("DELETE FROM route_towns WHERE route_id = ?", (row["id"],))
            self.connection.execute("DELETE FROM plotted_routes WHERE trip_id = ?", (trip_id,))
            self.connection.execute("DELETE FROM locations WHERE trip_id = ?", (trip_id,))
            self.connection.execute("DELETE FROM narration_events WHERE trip_id = ?", (trip_id,))
            self.connection.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
            self.connection.commit()

    def clear_events(self, trip_id: int):
        with self.lock:
            self.connection.execute("DELETE FROM narration_events WHERE trip_id = ?", (trip_id,))
            self.connection.commit()

    def add_location(self, trip_id: int, latitude: float, longitude: float, speed_kph=None, heading_deg=None) -> Dict:
        recorded_at = utcnow()
        with self.lock:
            cursor = self.connection.execute(
                """
                INSERT INTO locations(trip_id, latitude, longitude, speed_kph, heading_deg, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (trip_id, latitude, longitude, speed_kph, heading_deg, recorded_at),
            )
            self.connection.commit()
            row = self.connection.execute("SELECT * FROM locations WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)

    def recent_locations(self, trip_id: int, limit: int = 10) -> List[Dict]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT * FROM locations WHERE trip_id = ? ORDER BY id DESC LIMIT ?",
                (trip_id, limit),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]

    def add_event(
        self,
        trip_id: int,
        place_name: str,
        region: str,
        title: str,
        script: str,
        trigger_type: str,
        latitude: float,
        longitude: float,
        score: float,
        tags,
    ) -> Dict:
        recorded_at = utcnow()
        with self.lock:
            cursor = self.connection.execute(
                """
                INSERT INTO narration_events(
                    trip_id, place_name, region, title, script, trigger_type,
                    latitude, longitude, score, tags_json, recorded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (trip_id, place_name, region, title, script, trigger_type, latitude, longitude, score, json.dumps(tags), recorded_at),
            )
            self.connection.commit()
            row = self.connection.execute("SELECT * FROM narration_events WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return self._event_row_to_dict(row)

    def get_last_event(self, trip_id: int) -> Optional[Dict]:
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM narration_events WHERE trip_id = ? ORDER BY id DESC LIMIT 1",
                (trip_id,),
            ).fetchone()
        return self._event_row_to_dict(row) if row else None

    def get_events(self, trip_id: int) -> List[Dict]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT * FROM narration_events WHERE trip_id = ? ORDER BY id ASC",
                (trip_id,),
            ).fetchall()
        return [self._event_row_to_dict(row) for row in rows]

    def search_events(self, query: str = "", trip_id: Optional[int] = None) -> List[Dict]:
        pattern = "%%%s%%" % query
        with self.lock:
            if trip_id:
                rows = self.connection.execute(
                    """
                    SELECT * FROM narration_events
                    WHERE trip_id = ? AND (place_name LIKE ? OR script LIKE ? OR title LIKE ?)
                    ORDER BY id DESC
                    """,
                    (trip_id, pattern, pattern, pattern),
                ).fetchall()
            else:
                rows = self.connection.execute(
                    """
                    SELECT * FROM narration_events
                    WHERE place_name LIKE ? OR script LIKE ? OR title LIKE ?
                    ORDER BY id DESC
                    """,
                    (pattern, pattern, pattern),
                ).fetchall()
        return [self._event_row_to_dict(row) for row in rows]

    def create_plotted_route(
        self,
        trip_id: int,
        name: str,
        route_source: str,
        distance_m: float,
        duration_s: float,
        geometry: List[Dict],
        status: str = "pending",
        error: Optional[str] = None,
    ) -> Dict:
        now = utcnow()
        with self.lock:
            cursor = self.connection.execute(
                """
                INSERT INTO plotted_routes(
                    trip_id, name, status, route_source, distance_m, duration_s,
                    geometry_json, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (trip_id, name, status, route_source, distance_m, duration_s, json.dumps(geometry), error, now, now),
            )
            self.connection.commit()
        return self.get_plotted_route(cursor.lastrowid)

    def set_route_status(self, route_id: int, status: str, error: Optional[str] = None) -> Optional[Dict]:
        now = utcnow()
        completed_at = now if status in ("done", "failed") else None
        started_at = now if status == "researching" else None
        with self.lock:
            if started_at:
                self.connection.execute(
                    """
                    UPDATE plotted_routes
                    SET status = ?, error = ?, updated_at = ?, started_at = COALESCE(started_at, ?)
                    WHERE id = ?
                    """,
                    (status, error, now, started_at, route_id),
                )
            elif completed_at:
                self.connection.execute(
                    """
                    UPDATE plotted_routes
                    SET status = ?, error = ?, updated_at = ?, completed_at = ?
                    WHERE id = ?
                    """,
                    (status, error, now, completed_at, route_id),
                )
            else:
                self.connection.execute(
                    "UPDATE plotted_routes SET status = ?, error = ?, updated_at = ? WHERE id = ?",
                    (status, error, now, route_id),
                )
            self.connection.commit()
        return self.get_plotted_route(route_id)

    def add_plotted_waypoints(self, route_id: int, waypoints: List[Dict]):
        with self.lock:
            self.connection.execute("DELETE FROM plotted_waypoints WHERE route_id = ?", (route_id,))
            for waypoint in waypoints:
                self.connection.execute(
                    """
                    INSERT INTO plotted_waypoints(route_id, input_order, optimized_order, name, latitude, longitude)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        route_id,
                        int(waypoint.get("input_order", waypoint.get("optimized_order", 0))),
                        int(waypoint.get("optimized_order", waypoint.get("input_order", 0))),
                        waypoint.get("name") or "Waypoint",
                        float(waypoint["latitude"]),
                        float(waypoint["longitude"]),
                    ),
                )
            self.connection.commit()

    def add_route_towns(self, route_id: int, towns: List[Dict]):
        now = utcnow()
        with self.lock:
            self.connection.execute("DELETE FROM route_towns WHERE route_id = ?", (route_id,))
            for town in towns:
                self.connection.execute(
                    """
                    INSERT INTO route_towns(
                        route_id, name, region, country, latitude, longitude, population,
                        distance_km, route_position, status, error, research_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '{}', ?)
                    """,
                    (
                        route_id,
                        town["name"],
                        town["region"],
                        town.get("country", "USA"),
                        float(town["latitude"]),
                        float(town["longitude"]),
                        int(town.get("population") or 0),
                        float(town.get("distance_km") or 0),
                        float(town.get("route_position") or 0),
                        now,
                    ),
                )
            self.connection.commit()

    def update_route_town(self, town_id: int, status: str, research: Optional[Dict] = None, error: Optional[str] = None) -> Optional[Dict]:
        now = utcnow()
        with self.lock:
            self.connection.execute(
                """
                UPDATE route_towns
                SET status = ?, research_json = ?, error = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, json.dumps(research or {}), error, now, town_id),
            )
            self.connection.commit()
            row = self.connection.execute("SELECT * FROM route_towns WHERE id = ?", (town_id,)).fetchone()
        return self._route_town_row_to_dict(row) if row else None

    def get_route_town(self, town_id: int) -> Optional[Dict]:
        with self.lock:
            row = self.connection.execute("SELECT * FROM route_towns WHERE id = ?", (town_id,)).fetchone()
        return self._route_town_row_to_dict(row) if row else None

    def list_pending_route_towns(self, route_id: int) -> List[Dict]:
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT * FROM route_towns
                WHERE route_id = ? AND status IN ('pending', 'failed')
                ORDER BY route_position ASC, id ASC
                """,
                (route_id,),
            ).fetchall()
        return [self._route_town_row_to_dict(row) for row in rows]

    def get_plotted_route(self, route_id: int) -> Optional[Dict]:
        with self.lock:
            row = self.connection.execute("SELECT * FROM plotted_routes WHERE id = ?", (route_id,)).fetchone()
        return self._route_row_to_dict(row) if row else None

    def get_plotted_route_for_trip(self, trip_id: int, route_id: int) -> Optional[Dict]:
        route = self.get_plotted_route(route_id)
        if route and route["trip_id"] == trip_id:
            return route
        return None

    def list_plotted_routes(self, trip_id: int) -> List[Dict]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT * FROM plotted_routes WHERE trip_id = ? ORDER BY id DESC",
                (trip_id,),
            ).fetchall()
        return [self._route_row_to_dict(row) for row in rows]

    def export_trip_markdown(self, trip_id: int) -> str:
        trip = self.get_trip(trip_id)
        if not trip:
            raise KeyError("Trip not found")
        events = self.get_events(trip_id)
        lines = [
            "# %s" % trip["name"],
            "",
            "- Status: %s" % trip["status"],
            "- Started: %s" % trip["started_at"],
            "",
            "## Narration Events",
        ]
        for event in events:
            lines.extend(
                [
                    "",
                    "### %s" % event["title"],
                    "- Place: %s, %s" % (event["place_name"], event["region"]),
                    "- Trigger: %s" % event["trigger_type"],
                    "- Time: %s" % event["recorded_at"],
                    "",
                    event["script"],
                ]
            )
        return "\n".join(lines) + "\n"

    def _trip_row_to_dict(self, row: sqlite3.Row) -> Dict:
        data = dict(row)
        data["settings"] = json.loads(data.pop("settings_json"))
        return data

    def _event_row_to_dict(self, row: sqlite3.Row) -> Dict:
        data = dict(row)
        data["tags"] = json.loads(data.pop("tags_json"))
        return data

    def _route_row_to_dict(self, row: sqlite3.Row) -> Dict:
        data = dict(row)
        data["geometry"] = json.loads(data.pop("geometry_json"))
        with self.lock:
            waypoint_rows = self.connection.execute(
                "SELECT * FROM plotted_waypoints WHERE route_id = ? ORDER BY optimized_order ASC",
                (data["id"],),
            ).fetchall()
            town_rows = self.connection.execute(
                "SELECT * FROM route_towns WHERE route_id = ? ORDER BY route_position ASC, id ASC",
                (data["id"],),
            ).fetchall()
        data["waypoints"] = [self._waypoint_row_to_dict(row) for row in waypoint_rows]
        data["towns"] = [self._route_town_row_to_dict(row) for row in town_rows]
        return data

    def _waypoint_row_to_dict(self, row: sqlite3.Row) -> Dict:
        return dict(row)

    def _route_town_row_to_dict(self, row: sqlite3.Row) -> Dict:
        data = dict(row)
        data["research"] = json.loads(data.pop("research_json"))
        return data
