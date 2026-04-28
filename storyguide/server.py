import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from storyguide.config import load_dotenv
from storyguide.service import StoryGuideService
from storyguide.storage import Storage


STATIC_DIR = Path(__file__).resolve().parent / "static"


class StoryGuideHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address, RequestHandlerClass, service: StoryGuideService):
        super().__init__(server_address, RequestHandlerClass)
        self.service = service


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "RoadTripStoryguide/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return self._serve_static("index.html")
        if parsed.path.startswith("/static/"):
            return self._serve_static(parsed.path.replace("/static/", "", 1))
        if parsed.path == "/api/health":
            return self._json_response({"status": "ok", "service": "storyguide"})
        if parsed.path == "/api/trips":
            return self._json_response({"trips": self.server.service.list_trips()})
        if parsed.path == "/api/history":
            params = parse_qs(parsed.query)
            query = params.get("q", [""])[0]
            trip_id = params.get("trip_id", [None])[0]
            history = self.server.service.history(query=query, trip_id=int(trip_id) if trip_id else None)
            return self._json_response({"events": history})
        if parsed.path == "/api/llm/free-models":
            return self._json_response(self.server.service.llm_free_models())
        if parsed.path == "/api/tts/options":
            return self._json_response(self.server.service.tts_options())
        if parsed.path.endswith("/export.md"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "trips":
                trip_id = int(parts[2])
                try:
                    content = self.server.service.export_trip_markdown(trip_id)
                except KeyError:
                    return self._json_response({"error": "Trip not found"}, status=HTTPStatus.NOT_FOUND)
                return self._text_response(content, content_type="text/markdown; charset=utf-8")
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/events"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4:
                trip_id = int(parts[2])
                return self._json_response({"events": self.server.service.trip_events(trip_id)})
        if parsed.path.startswith("/api/trips/") and "/plot-routes" in parsed.path:
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4 and parts[3] == "plot-routes":
                trip_id = int(parts[2])
                try:
                    return self._json_response({"routes": self.server.service.list_plotted_routes(trip_id)})
                except KeyError:
                    return self._json_response({"error": "Trip not found"}, status=HTTPStatus.NOT_FOUND)
            if len(parts) == 5 and parts[3] == "plot-routes":
                trip_id = int(parts[2])
                route_id = int(parts[4])
                try:
                    return self._json_response({"route": self.server.service.get_plotted_route(trip_id, route_id)})
                except KeyError:
                    return self._json_response({"error": "Route not found"}, status=HTTPStatus.NOT_FOUND)
        self._json_response({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        payload = self._read_json()
        if parsed.path == "/api/trips":
            trip = self.server.service.create_trip(
                name=payload.get("name") or "Road Trip",
                settings_payload=payload.get("settings"),
            )
            return self._json_response({"trip": trip}, status=HTTPStatus.CREATED)
        if parsed.path == "/api/tts":
            result = self.server.service.synthesize_tts(payload.get("text", ""), voice=payload.get("voice", ""))
            if not result:
                return self._json_response({"provider": "browser", "fallback": True})
            return self._json_response(result)
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/locations"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4:
                trip_id = int(parts[2])
                try:
                    result = self.server.service.ingest_location(
                        trip_id=trip_id,
                        latitude=float(payload["latitude"]),
                        longitude=float(payload["longitude"]),
                        speed_kph=payload.get("speed_kph"),
                        heading_deg=payload.get("heading_deg"),
                    )
                except KeyError:
                    return self._json_response({"error": "Trip not found"}, status=HTTPStatus.NOT_FOUND)
                return self._json_response(result)
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/narrate-place"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4:
                trip_id = int(parts[2])
                try:
                    result = self.server.service.narrate_selected_place(trip_id, payload)
                except KeyError:
                    return self._json_response({"error": "Trip not found"}, status=HTTPStatus.NOT_FOUND)
                return self._json_response(result)
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/plot-routes"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4:
                trip_id = int(parts[2])
                try:
                    route = self.server.service.create_plotted_route(trip_id, payload)
                except KeyError:
                    return self._json_response({"error": "Trip not found"}, status=HTTPStatus.NOT_FOUND)
                except ValueError as exc:
                    return self._json_response({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
                return self._json_response({"route": route}, status=HTTPStatus.CREATED)
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/research"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 6 and parts[3] == "plot-routes":
                trip_id = int(parts[2])
                route_id = int(parts[4])
                try:
                    route = self.server.service.start_plotted_route_research(trip_id, route_id)
                except KeyError:
                    return self._json_response({"error": "Route not found"}, status=HTTPStatus.NOT_FOUND)
                return self._json_response({"route": route})
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/stop"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4:
                trip_id = int(parts[2])
                trip = self.server.service.stop_trip(trip_id)
                if not trip:
                    return self._json_response({"error": "Trip not found"}, status=HTTPStatus.NOT_FOUND)
                return self._json_response({"trip": trip})
        self._json_response({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/trips/") and parsed.path.endswith("/events"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 4:
                trip_id = int(parts[2])
                self.server.service.clear_trip_events(trip_id)
                return self._json_response({"cleared": True})
        if parsed.path.startswith("/api/trips/"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) == 3:
                trip_id = int(parts[2])
                self.server.service.delete_trip(trip_id)
                return self._json_response({"deleted": True})
        self._json_response({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format, *args):
        return

    def _serve_static(self, name: str):
        file_path = STATIC_DIR / name
        if not file_path.exists() or not file_path.is_file():
            return self._json_response({"error": "Static file not found"}, status=HTTPStatus.NOT_FOUND)
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "text/plain"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "%s; charset=utf-8" % content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        payload = self.rfile.read(length).decode("utf-8")
        return json.loads(payload)

    def _json_response(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text_response(self, payload: str, content_type: str = "text/plain; charset=utf-8"):
        body = payload.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def create_app(db_path: str = "storyguide.sqlite3") -> StoryGuideHTTPServer:
    load_dotenv()
    storage = Storage(path=db_path)
    service = StoryGuideService(storage=storage)
    return StoryGuideHTTPServer(("127.0.0.1", 8001), RequestHandler, service)


def run_server(host: str = "127.0.0.1", port: int = 8001, db_path: str = "storyguide.sqlite3"):
    load_dotenv()
    storage = Storage(path=db_path)
    service = StoryGuideService(storage=storage)
    server = StoryGuideHTTPServer((host, port), RequestHandler, service)
    print("Storyguide running at http://%s:%s" % (host, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
