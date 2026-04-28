# Road Trip Commentary App Technical Spec

## Purpose
This document translates the product roadmap into a buildable technical design for a web application that narrates nearby towns and points of interest during a road trip, then saves the spoken commentary as searchable trip history.

## Scope Of This Implementation
This implementation targets a zero-dependency Python stack so it can run in the current workspace without package installation. It includes:
- A browser-based UI
- A Python HTTP server
- SQLite-backed trip history
- Pluggable geocoding and enrichment providers
- Kid-friendly narration generation
- Route-aware upcoming place previews
- Plot Trip mode with waypoint selection, provider-backed route planning, route-corridor town selection, and background advance research
- Search and Markdown export
- Automated tests aligned to each roadmap phase

## System Overview

### Runtime Components
- Browser client:
  - Requests geolocation permission
  - Streams location updates to the backend
  - Collects plot-trip map waypoints and polls plotted-route research status
  - Plays narration through browser speech synthesis
  - Displays live place cards, commentary feed, and searchable history
- Python backend:
  - Accepts trip and location events
  - Plans plotted routes through a routing-provider abstraction
  - Finds towns along route geometry from a local town gazetteer
  - Runs background research for route towns
  - Resolves the current place
  - Enriches place facts
  - Decides whether narration should occur
  - Persists locations and narration events
  - Exposes search and export endpoints
- SQLite database:
  - Stores trips, locations, narration events, plotted routes, route waypoints, and route-town research status

### Architectural Style
- Layered architecture
- Provider interfaces for live and demo data
- Stateless HTTP handlers
- Stateful persistence in SQLite
- Deterministic business logic for testability

## Phase-To-Module Mapping
- Phase 1:
  - `storyguide.service`
  - `storyguide.providers`
  - `storyguide.server`
- Phase 2:
  - `storyguide.relevance`
  - `storyguide.providers`
- Phase 3:
  - `storyguide.narration`
- Phase 4:
  - `storyguide.storage`
  - `storyguide.server`
- Phase 5:
  - `storyguide.route`
  - `storyguide.service`
- Phase 6:
  - `storyguide.storage`
  - `storyguide.providers`
  - `storyguide.server`
- Phase 7:
  - `storyguide.plotting`
  - `storyguide.service`
  - `storyguide.storage`
  - `storyguide.static`

## Functional Requirements

### Trip Lifecycle
- User can start a trip from the web UI.
- Backend creates a trip session and returns a session id.
- User can stop a trip.
- User can delete a stored trip and associated location history.

### Live Commentary
- Browser streams geolocation updates while the trip is active.
- Backend identifies the closest town and nearby points of interest.
- Backend enriches place information with population, known-for facts, history, school enrollment when available, and landmarks.
- Backend scores the place for narration relevance.
- Backend returns either:
  - A new narration event
  - A route-aware upcoming preview
  - A no-op if the place is too repetitive or low value

### Narration
- Scripts must be brief and child-friendly by default.
- Narration should omit unavailable facts gracefully.
- Safety filtering should suppress sensitive words and topics.
- Narration should support:
  - `storyteller`
  - `quick`
  - `history`

### Archive And Search
- Every narration event is stored with timestamp and coordinates.
- User can search trip history by keyword.
- User can export a trip as Markdown.

### Plot Trip
- User can choose `Plot Trip`, start a trip, then click multiple map points.
- User can submit the chosen points for route planning.
- Backend stores the plotted route name, optimized waypoints, route geometry, distance, duration, and town research status.
- Backend selects towns along the route corridor with population over 200 when a town gazetteer is available.
- Backend researches each route town in the background using the same enrichment, nearby point-of-interest, narration, and optional LLM flow used by live driving.
- Frontend renders pending towns in neutral styling, currently researched towns in red, completed towns in green, and failed towns in yellow.

### Reliability
- App should work with demo data even if live providers fail.
- Live provider failures must not stop the app from responding.
- Cached/demo content should be used as fallback.
- Users can remove stored location history via trip deletion.

## Non-Functional Requirements
- Zero external Python dependencies
- Testable core logic
- Browser-compatible frontend with no build step
- SQLite for easy local portability
- Clear seams for future live API upgrades

## Data Model

### Trip
- `id`: integer primary key
- `name`: text
- `status`: `active` or `stopped`
- `started_at`: ISO timestamp
- `ended_at`: ISO timestamp nullable
- `settings_json`: JSON string

### LocationSample
- `id`: integer primary key
- `trip_id`: foreign key
- `latitude`: real
- `longitude`: real
- `speed_kph`: real nullable
- `heading_deg`: real nullable
- `recorded_at`: ISO timestamp

### NarrationEvent
- `id`: integer primary key
- `trip_id`: foreign key
- `place_name`: text
- `region`: text
- `title`: text
- `script`: text
- `trigger_type`: `current_place` or `upcoming_place`
- `latitude`: real
- `longitude`: real
- `score`: real
- `tags_json`: JSON string
- `recorded_at`: ISO timestamp

### PlottedRoute
- `id`: integer primary key
- `trip_id`: foreign key
- `name`: text
- `status`: `pending`, `researching`, `done`, or `failed`
- `route_source`: routing provider identifier, such as `osrm`, `openrouteservice_ordered`, or `straight_line_fallback`
- `distance_m`: real
- `duration_s`: real
- `geometry_json`: JSON array of latitude/longitude points
- `error`: nullable text
- `created_at`, `updated_at`, `started_at`, `completed_at`: ISO timestamps

### PlottedWaypoint
- `id`: integer primary key
- `route_id`: foreign key
- `input_order`: integer
- `optimized_order`: integer
- `name`: text
- `latitude`: real
- `longitude`: real

### RouteTown
- `id`: integer primary key
- `route_id`: foreign key
- `name`: text
- `region`: text
- `country`: text
- `latitude`: real
- `longitude`: real
- `population`: integer nullable
- `distance_km`: distance from route corridor
- `route_position`: normalized route ordering value
- `status`: `pending`, `researching`, `done`, or `failed`
- `error`: nullable text
- `research_json`: stored enriched place, nearby POIs, narration, and related event id
- `updated_at`: ISO timestamp

## API Design

### `GET /api/health`
- Returns service health and whether live providers are enabled.

### `POST /api/trips`
Request:
```json
{
  "name": "Spring Break Drive",
  "settings": {
    "kid_mode": true,
    "save_history": true,
    "narration_mode": "storyteller",
    "age_band": "elementary",
    "live_providers": false
  }
}
```

Response:
```json
{
  "trip": {
    "id": 1,
    "status": "active"
  }
}
```

### `POST /api/trips/{trip_id}/locations`
Request:
```json
{
  "latitude": 30.2672,
  "longitude": -97.7431,
  "speed_kph": 88.0,
  "heading_deg": 270
}
```

Response:
```json
{
  "current_place": {
    "name": "Austin",
    "region": "Texas"
  },
  "upcoming": {
    "name": "Dripping Springs",
    "distance_km": 22.4
  },
  "event": {
    "title": "Welcome to Austin",
    "script": "We are near Austin..."
  }
}
```

### `GET /api/trips`
- Returns all trips.

### `GET /api/trips/{trip_id}/events`
- Returns narration events for a trip.

### `GET /api/history?q=term`
- Returns filtered narration events across trips.

### `GET /api/trips/{trip_id}/export.md`
- Returns a Markdown trip journal.

### `POST /api/trips/{trip_id}/stop`
- Marks a trip stopped.

### `POST /api/trips/{trip_id}/plot-routes`
Request:
```json
{
  "name": "Austin to Waco",
  "waypoints": [
    {"name": "Point 1", "latitude": 30.2672, "longitude": -97.7431},
    {"name": "Point 2", "latitude": 31.5493, "longitude": -97.1467}
  ],
  "min_population": 200,
  "corridor_km": 12
}
```

Response:
```json
{
  "route": {
    "id": 1,
    "status": "researching",
    "route_source": "osrm",
    "geometry": [],
    "waypoints": [],
    "towns": []
  }
}
```

### `GET /api/trips/{trip_id}/plot-routes`
- Lists plotted routes for the trip.

### `GET /api/trips/{trip_id}/plot-routes/{route_id}`
- Returns plotted route geometry, waypoints, town statuses, and stored research payloads.

### `POST /api/trips/{trip_id}/plot-routes/{route_id}/research`
- Starts or retries route-town background research.

### `DELETE /api/trips/{trip_id}`
- Deletes a trip and associated records.

## Frontend Design

### Main Panels
- Trip control panel
- Current place card
- Upcoming place preview
- Live commentary feed
- Searchable trip archive
- Plot Trip waypoint list and route-research status panel
- Leaflet route polyline and route-town status markers

### Browser APIs
- `navigator.geolocation.watchPosition`
- `window.speechSynthesis`
- `fetch`

### UX Rules
- Do not speak before the user explicitly starts a trip.
- Only narrate fresh events returned from the backend.
- Keep a visible transcript even if audio is muted.
- Show errors without crashing the session.

## Provider Strategy

### Demo Providers
Used by default for deterministic behavior and tests.
- Demo reverse geocoder based on nearest known place
- Demo enrichment catalog for town facts and landmarks

### Live Providers
Optional and disabled by default.
- Live reverse geocoder via Nominatim-compatible HTTP lookup
- Live Wikipedia summary lookup for town fact enrichment
- Live results should merge into demo/base records rather than replacing required fields with nulls

### Routing Providers
- Default routing uses OSRM Trip service for selected-waypoint optimization and driving route geometry.
- OpenRouteService Directions is supported with `ROADTRIPPER_ROUTING_PROVIDER=openrouteservice` and `ROADTRIPPER_ORS_API_KEY`; it returns GeoJSON route geometry for the clicked waypoint order.
- Straight-line fallback exists only for offline/demo continuity and is labeled with `route_source=straight_line_fallback`.

### Town Gazetteer
- `storyguide/data/us_towns.json` may provide broad town coverage with name, region, latitude, longitude, and population.
- `ROADTRIPPER_TOWN_DATA` can point at an alternate town JSON file.
- Without a town data file, the app uses the built-in demo catalog, which is deterministic but not geographically comprehensive.

## Relevance Rules
- Narrate when entering a new town or encountering a sufficiently interesting nearby landmark.
- Suppress narration if:
  - The same place was narrated recently
  - Distance moved since the last narration is too small
  - The score is below threshold
- Route-aware previews can fire for an upcoming place even when current-place narration is suppressed.

## Security And Privacy
- No authentication is included in this local-first build.
- Location history storage is opt-in through trip creation settings.
- Deleting a trip removes locations and narration events.
- No raw provider credentials are stored in the database.

## Testing Strategy
- `tests/test_phase1_core.py`:
  - Trip creation
  - Location ingestion
  - Current-place narration
- `tests/test_phase2_enrichment.py`:
  - Fact enrichment
  - Relevance scoring
  - Duplicate suppression
- `tests/test_phase3_narration.py`:
  - Child-safe narration
  - Mode-specific output
- `tests/test_phase4_journal.py`:
  - History search
  - Markdown export
- `tests/test_phase5_route.py`:
  - Upcoming place prediction
  - Route-aware preview narration
- `tests/test_phase6_reliability.py`:
  - Fallback behavior when live providers fail
  - Cache/demo continuity
  - Trip deletion privacy behavior

## Operational Commands
- Run the app:
  - `python3 main.py`
- Run tests:
  - `python3 -m unittest discover -s tests -v`

## Future Upgrades
- Replace demo catalog with broader geographic datasets
- Add real map rendering
- Add cloud TTS for consistent audio quality
- Add source attribution views
- Add content moderation backed by more advanced classifiers
