# RoadTripper

RoadTripper is a local web application that turns live laptop location into spoken road trip commentary for children or adults. As the trip runs, it identifies nearby towns and points of interest, generates short narration, plays it through the browser using the laptop speaker, and optionally saves the commentary as searchable trip history.

This project includes:
- A Python HTTP server with no external Python dependencies
- A browser UI with live trip controls
- SQLite-backed trip history and Markdown export
- A `launchd` LaunchAgent for automatic background startup on macOS
- A deploy script for reinstalling and restarting the workspace-backed LaunchAgent
- Plot Trip mode for waypoint-based route planning and advance town research
- Optional LLM-backed narration via provider abstractions
- Optional dedicated OpenAI TTS playback
- A separate native SwiftUI iOS scaffold under `ios/`

## Files
- App entry point: [main.py](/Users/jay/opencode/roadtripper/main.py)
- Browser server: [storyguide/server.py](/Users/jay/opencode/roadtripper/storyguide/server.py)
- Frontend UI: [storyguide/static/index.html](/Users/jay/opencode/roadtripper/storyguide/static/index.html)
- LaunchAgent plist: [com.jay.storyguide.plist](/Users/jay/opencode/roadtripper/com.jay.storyguide.plist)
- Deploy script: [deploy_storyguide.sh](/Users/jay/opencode/roadtripper/deploy_storyguide.sh)
- LLM env example: [.env.example](/Users/jay/opencode/roadtripper/.env.example)
- Product plan: [ROAD_TRIP_COMMENTARY_APP_PLAN.md](/Users/jay/opencode/roadtripper/ROAD_TRIP_COMMENTARY_APP_PLAN.md)
- Technical spec: [ROAD_TRIP_COMMENTARY_TECHNICAL_SPEC.md](/Users/jay/opencode/roadtripper/ROAD_TRIP_COMMENTARY_TECHNICAL_SPEC.md)
- iOS plan: [ROADTRIPPER_IOS_PLAN.md](/Users/jay/opencode/roadtripper/ROADTRIPPER_IOS_PLAN.md)
- iOS scaffold guide: [ios/README.md](/Users/jay/opencode/roadtripper/ios/README.md)

## Requirements
- macOS
- Python 3 available at `/Applications/Xcode.app/Contents/Developer/usr/bin/python3`
- A modern browser with:
  - Geolocation support
  - Speech synthesis support
- Internet connectivity during use if you want live web enrichment, hosted routing, or LLM narration

## Native iOS Scaffold
The repository now also includes a separate native SwiftUI scaffold at:
- [ios/RoadTripperIOS.xcodeproj](/Users/jay/opencode/roadtripper/ios/RoadTripperIOS.xcodeproj)
- [ios/RoadTripperIOS/RoadTripperRootView.swift](/Users/jay/opencode/roadtripper/ios/RoadTripperIOS/RoadTripperRootView.swift)
- [ios/RoadTripperIOS/RoadTripperServices.swift](/Users/jay/opencode/roadtripper/ios/RoadTripperIOS/RoadTripperServices.swift)
- [ios/RoadTripperIOS/RoadTripperLLM.swift](/Users/jay/opencode/roadtripper/ios/RoadTripperIOS/RoadTripperLLM.swift)

Open it with:

```bash
open "/Users/jay/opencode/roadtripper/ios/RoadTripperIOS.xcodeproj"
```

The iOS app is a parallel client. It does not replace or modify the Python/web version.
The iOS scaffold now includes an immersive dark map-first layout, a native settings screen with provider selection, model selection, Keychain-backed API key storage, OpenAI TTS voice playback, and an Embarrass, Minnesota simulator fallback startup. See [ios/README.md](/Users/jay/opencode/roadtripper/ios/README.md) for setup.

## How The App Works
1. The Python server runs locally on `http://127.0.0.1:8001`.
2. The browser page asks for location permission when you start a trip.
3. The browser sends live coordinates to the backend.
4. The backend resolves a nearby town, gathers facts, decides whether narration should fire, and stores commentary history.
5. The browser speaks returned narration using browser speech synthesis.

## Install And Run

## Option 1: Run Manually
Use this when developing or testing.

1. Open Terminal.
2. Start the server:

```bash
cd "/Users/jay/opencode/roadtripper"
PYTHONPYCACHEPREFIX="/Users/jay/.storyguide/.pycache" python3 main.py
```

3. Open [http://127.0.0.1:8001](http://127.0.0.1:8001).
4. Leave the terminal window open while using the app.
5. Stop the server with `Ctrl-C`.

## Option 2: Run With launchd
Use this when you want the backend to start automatically at login.

The active `LaunchAgent` runs the workspace copy from:
- Workspace: `/Users/jay/opencode/roadtripper`
- LaunchAgent plist: `/Users/jay/Library/LaunchAgents/com.jay.storyguide.plist`

The backend service is already installed. To redeploy changes from the workspace, run:

```bash
cd "/Users/jay/opencode/roadtripper"
zsh ./deploy_storyguide.sh
```

That script:
- validates the plist
- installs the current plist into `~/Library/LaunchAgents`
- reloads and restarts the LaunchAgent

After deployment, open [http://127.0.0.1:8001](http://127.0.0.1:8001).

## launchd Management Commands

### Check status
```bash
launchctl print gui/$(id -u)/com.jay.storyguide
```

### Restart the service
```bash
launchctl kickstart -k gui/$(id -u)/com.jay.storyguide
```

### Stop and unload the service
```bash
launchctl bootout gui/$(id -u) /Users/jay/Library/LaunchAgents/com.jay.storyguide.plist
```

### Reinstall and restart after code changes
```bash
cd "/Users/jay/opencode/roadtripper"
zsh ./deploy_storyguide.sh
```

## Using The Interface

## First Launch
1. Open [http://127.0.0.1:8001](http://127.0.0.1:8001).
2. Enter a trip name.
3. Choose a narration mode:
   - `Storyteller`: fuller narration with history and trivia
   - `Quick Facts`: shorter commentary
   - `History`: emphasizes brief historical context
4. Choose an age band.
5. Choose a data mode:
   - `Live`: uses online reverse geocoding and live enrichment when available
   - `Demo`: uses the built-in sample dataset for predictable testing
6. Choose a voice, or leave it on `Auto` to let the app pick a better-sounding English voice when available.
7. Choose an age band:
   - `Elementary`
   - `Early Elementary`
   - `Adult`
8. Decide whether to keep `Save searchable trip history` enabled.
9. Decide whether to keep `Speak narration through laptop speakers` enabled.
10. Click `Start Trip`.

## Trip Modes
- `Drive`: watches live browser geolocation and narrates as you travel.
- `Plan`: lets you click a map location or marker and narrate that selected place immediately.
- `Plot Trip`: lets you start a trip, click multiple map points, and submit them for route planning. The backend plans a route, saves the plotted trip, finds towns along the route with population over 200 when town data is available, and researches each town in the background. Town markers are gray while pending, red while currently being researched, green when gathered, and yellow if research failed.

## Browser Permissions
When the trip starts, the browser will ask for:
- Location permission
- Audio playback permission or user activation for speech synthesis, depending on browser behavior

You should allow location access or the app will not receive live position updates.

## During A Trip
After the trip starts:
- `Trip status` changes from `Idle` to `Running`
- `Current coords` updates as the laptop location changes
- `Current place` shows the closest detected town and summary facts
- `Coming up` shows a likely place ahead after enough movement is observed
- `Live narration` fills with spoken commentary events
- The browser speaks each fresh narration event if audio is enabled

The default `Live` data mode should reflect your actual location much better than the built-in demo catalog.

The app does not narrate every GPS update. It throttles commentary to avoid repeating the same place too frequently.

## Live Narration Panel
Each feed item shows:
- whether it was a `current_place` or `upcoming_place` event
- the narration title
- the full spoken script
- the town and timestamp

If the app decides not to narrate, the small decision label above the feed shows why, such as:
- `cooldown distance`
- `score below threshold`
- `new place or far enough`

## Search And History
The `Archive` panel lets you search saved narration text by:
- town name
- region
- landmarks
- script content

Type a query and click `Search`. Click `Refresh History` to reload the latest saved events with no filter changes.

## Trip Stop
When you click `Stop Trip`:
- browser geolocation watching stops
- the backend marks the trip as stopped
- the app remains available in the browser for searching old events

## Saved Data
By default the app saves:
- trip records
- location samples
- narration events

Workspace-run data is stored in:
- `/Users/jay/opencode/roadtripper/storyguide.sqlite3`

LaunchAgent-run data is stored in the workspace because the LaunchAgent runs from `/Users/jay/opencode/roadtripper`:
- `/Users/jay/opencode/roadtripper/storyguide.sqlite3`

The LaunchAgent logs are:
- `/Users/jay/opencode/roadtripper/storyguide.stdout.log`
- `/Users/jay/opencode/roadtripper/storyguide.stderr.log`

## Exporting Trip Notes
The backend supports Markdown export per trip at:

```text
/api/trips/<trip_id>/export.md
```

Example:

[http://127.0.0.1:8001/api/trips/1/export.md](http://127.0.0.1:8001/api/trips/1/export.md)

## Updating The App
If you change code in the workspace, restart the LaunchAgent so it reloads the Python process.

Use:

```bash
cd "/Users/jay/opencode/roadtripper"
zsh ./deploy_storyguide.sh
```

## Plot Trip Routing And Town Data
Route planning is provider-based:
- Default: `ROADTRIPPER_ROUTING_PROVIDER=osrm`, using OSRM's Trip service to optimize selected waypoints and return driving geometry.
- Optional: `ROADTRIPPER_ROUTING_PROVIDER=openrouteservice` or `ors`, using OpenRouteService Directions with `ROADTRIPPER_ORS_API_KEY`. This returns ordered driving geometry for the clicked waypoint order.
- Fallback: `ROADTRIPPER_ROUTING_PROVIDER=fallback`, using straight-line geometry for offline/demo testing only.

Optional routing environment variables:

```bash
ROADTRIPPER_ROUTING_PROVIDER=osrm
ROADTRIPPER_OSRM_URL=https://router.project-osrm.org
ROADTRIPPER_ORS_API_KEY=your_ors_key_here
```

Town selection is handled by `storyguide.plotting.TownGazetteer`. If `storyguide/data/us_towns.json` exists, the app uses it to select towns within the route corridor whose population is over 200. If that file is missing, the app falls back to the small built-in demo catalog, which is enough for tests but not comprehensive for real cross-country trips. You can point at another town dataset with:

```bash
ROADTRIPPER_TOWN_DATA=/path/to/us_towns.json
```

## Optional LLM Narration
RoadTripper now has pluggable LLM provider abstractions. If no provider is configured, the app uses the built-in deterministic narration. If you configure a provider, the app will try to improve the text for:
- current-place narration
- clicked map locations
- clicked nearby points of interest

### Supported provider values
- `openrouter`
- `openai`

### Setup with a `.env`
Create `/Users/jay/opencode/roadtripper/.env` using [.env.example](/Users/jay/opencode/roadtripper/.env.example) as the starting point.

Example for OpenRouter:

```bash
ROADTRIPPER_LLM_PROVIDER=openrouter
ROADTRIPPER_LLM_MODEL=openai/gpt-4.1-mini
ROADTRIPPER_OPENROUTER_API_KEY=your_key_here
```

Example for OpenAI:

```bash
ROADTRIPPER_LLM_PROVIDER=openai
ROADTRIPPER_LLM_MODEL=gpt-4.1-mini
ROADTRIPPER_OPENAI_API_KEY=your_key_here
```

Then redeploy:

```bash
cd "/Users/jay/opencode/roadtripper"
zsh ./deploy_storyguide.sh
```

For manual and `launchd` runs, the server reads `.env` from the workspace automatically.

## Optional OpenAI TTS Playback
RoadTripper can use a dedicated OpenAI text-to-speech provider instead of browser speech synthesis.

Example:

```bash
ROADTRIPPER_TTS_PROVIDER=openai
ROADTRIPPER_TTS_MODEL=tts-1-hd
ROADTRIPPER_TTS_VOICE=sage
ROADTRIPPER_OPENAI_API_KEY=your_openai_api_key_here
```

Notes:
- `tts-1-hd` is the quality-oriented option.
- `tts-1` is the faster, cheaper option.
- If OpenAI TTS is not configured or fails, the app falls back to browser speech synthesis.

## Running Tests
From the workspace:

```bash
cd "/Users/jay/opencode/roadtripper"
PYTHONPYCACHEPREFIX="/Users/jay/.storyguide/.pycache" python3 -m unittest discover -s tests -v
```

## Troubleshooting

### The browser page opens but nothing happens
- Make sure the server is running.
- Make sure you opened `http://127.0.0.1:8001` and not the file directly.
- Confirm the browser has permission to access location.

### No speech plays
- Confirm `Speak narration through laptop speakers` is checked.
- Confirm the laptop is not muted.
- Some browsers require the page to be interacted with before speech synthesis will play.
- `Stop Trip` now cancels any speech already in progress as well as future narration.

### The LaunchAgent says it is not running
- Check status with `launchctl print gui/$(id -u)/com.jay.storyguide`
- Redeploy with `zsh ./deploy_storyguide.sh`
- Check logs in `/Users/jay/opencode/roadtripper/storyguide.stderr.log`

### The service runs but code changes are missing
- The LaunchAgent runs the workspace Python process, so restart it with the deploy script after code changes.

## Notes About This Build
- The current place catalog is a seeded demo dataset, so geographic coverage is intentionally limited.
- The browser provides the spoken voice through speech synthesis.
- The app architecture is ready for broader live providers, but the current demo-first setup is better for repeatable local testing.
