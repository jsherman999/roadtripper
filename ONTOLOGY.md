# RoadTripper Ontology

RoadTripper has three clients: the Python server (`storyguide/`), the browser-only edition (`docs/`), and the iOS app (`ios/`). They share one vocabulary. Use the exact string values below in storage, API payloads, and language-model context. Each client may show its own labels in the UI.

## Entities

| Entity | Meaning | Python | Browser | iOS |
|---|---|---|---|---|
| Trip | One journey: a name, a start, and an optional stop | `trips` row | `TripStore` trip | `Trip` |
| Location fix | One reported device position | `locations` row | not stored | not stored |
| Place | A populated place (city, town, village) | `PlaceProfile` | place object | `PlaceSummary` |
| Point of interest | A geolocated stop near a position (museum, park, landmark) | `PointOfInterest` | nearby item | `PointOfInterestSummary` |
| Story | One narration event that was generated | `narration_events` row | story event | `NarrationEvent` |
| Planned route | A routed path between waypoints | `plotted_routes` row | `state.route` | not implemented |
| Waypoint | A stop the user put on a planned route | `plotted_waypoints` row | waypoint | not implemented |
| Route town | A place found along a planned route, researched ahead of time | `route_towns` row | route town | not implemented |

`PlaceProfile.landmarks` holds landmark names from the place's own profile. Geolocated stops near a position are points of interest, not landmarks.

## Enumerations

**Audience** (`age_band`): `adult`, `elementary`, `early_elementary`. Default: `adult`.

**Narration style** (`narration_mode`): `storyteller`, `quick`, `history`. Default: `storyteller`.

**Trip mode** (`trip_mode`): `drive` (follow live location), `explore` (click the map to research places), `route` (plan a multi-stop route). The legacy Python values `plan` and `plot_trip` are read as `explore` and `route`.

**Trigger** (`trigger_type`): why a story was written.

| Value | Meaning | Counts for cooldown |
|---|---|---|
| `current_place` | The rider's live position reached a place | yes |
| `selected_place` | The user picked a place (town) | yes, as a manual selection |
| `selected_point` | The user picked a point of interest | yes, as a manual selection |
| `plot_trip_research` | Written ahead of time for a route town | no |

**Route-town research status**: `pending`, `researching`, `done`, `failed`.

**Narration decision codes** (machine-readable; each client writes its own display text):

| Code | Meaning |
|---|---|
| `first_event` | First story on this trip |
| `score_below_threshold` | Not enough material to say anything (Python only) |
| `new_place_or_far_enough` | A new place, or far enough from the last story |
| `cooldown_distance` | Same place, not far enough from the last story |
| `cooldown_interval` | Same place, too soon after the last story |
| `cooldown_after_manual_selection` | Too close to a place the user just picked (Python only) |
| `moved_past_manual_selection` | Far enough from a place the user just picked (Python only) |
| `manual_selection` | The user picked this place, so the story always plays (browser only) |

## Cooldown defaults

A place that was already narrated is narrated again only after the rider has moved at least `minimum_distance_km` (5 km) **and** at least `minimum_interval_minutes` (4 min) have passed. Only live triggers count. Route research does not.

## Units

Distances are kilometres (`*_km`), except planned-route totals, which are metres (`distance_m`) and seconds (`duration_s`). `route_position` is the fraction of the route's length (0 to 1) at the point closest to a route town.
