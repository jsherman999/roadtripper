# RoadTripper iOS Plan

## Goal
Add a native iPhone and iPad app in SwiftUI while preserving the existing Python/web RoadTripper app as a separate, working product in the same repository.

## Why A Native iOS App
- Better long-running location tracking than a browser tab
- Better audio session control for spoken narration in the car
- Native map interaction with smoother POI tapping and camera follow
- A clearer path to background-safe behavior, offline caching, and App Store distribution

## Repo Strategy
- Keep the current web/mac app unchanged in the repo root.
- Add the native app under `ios/`.
- Reuse concepts rather than runtime code:
  - trip settings
  - place and POI summaries
  - narration events
  - nearby-town queue
  - provider abstractions for LLM and TTS later

## Native Scope For This Scaffold
The scaffold now includes:
- A standalone SwiftUI iOS application target
- A map-first root screen
- Trip controls and audience selection
- Core Location service wiring
- Reverse geocoding and nearby discovery shells with MapKit
- AVSpeechSynthesizer-based narration
- In-memory narration feed and current trip state
- A ready-to-open Xcode project under `ios/`

The scaffold intentionally does not yet include:
- background location or audio policies
- persistent local trip storage
- OpenRouter or OpenAI provider integration on iOS
- trip export or sync
- production analytics, safety guardrails, or App Store packaging

## Architecture

### App Layer
- `RoadTripperIOSApp`
- creates the service graph and root view model

### UI Layer
- `RoadTripperRootView`
- compact controls
- map with tappable annotations
- current place card
- nearby towns and POIs
- narration feed

### State Layer
- `TripViewModel`
- owns trip lifecycle
- listens to live coordinates
- refreshes discovery data
- throttles repeat narration

### Service Layer
- `RoadTripperLocationService`
- `RoadTripperDiscoveryService`
- `RoadTripperNarrationService`

### Model Layer
- `TripSettings`
- `PlaceSummary`
- `PointOfInterestSummary`
- `NarrationEvent`
- `TripSnapshot`
- `MapSelectionItem`

## Delivery Phases

### Phase 1: Foundation
- Create the Xcode project and SwiftUI app shell.
- Mirror the core product nouns from the web app.
- Prove simulator builds and basic device launch.

### Phase 2: Native Trip Loop
- Hook up live Core Location updates.
- Center the map on the live route.
- Support tap-to-narrate for pins and raw map taps.

### Phase 3: Local History
- Persist trip events with SwiftData or SQLite.
- Add search and trip replay.
- Add export to Markdown or share sheet.

### Phase 4: Smarter Narration
- Port LLM provider abstractions to Swift.
- Add configurable OpenRouter and OpenAI clients.
- Cache summaries so the app stays responsive on the road.

### Phase 5: Higher-Quality Voice
- Port the OpenAI TTS integration to Swift.
- Support streamed audio playback with graceful fallback.
- Add voice selection and downloaded-audio caching.

### Phase 6: Road-Trip Hardening
- Improve cooldown and repeat suppression.
- Add battery-aware update behavior.
- Explore background-safe narration and CarPlay-friendly UX.

## Immediate Build Layout
- `ios/RoadTripperIOS.xcodeproj`
- `ios/RoadTripperIOS/`

## Success Criteria For This Scaffold
- Opens in Xcode without extra generators
- Builds for the iOS simulator
- Shows a working SwiftUI interface
- Requests location permission
- Speaks narration when the user starts a trip or taps a place

## Shared Strategy With The Existing Web App
- The web/mac app remains the current production path.
- The iOS app is a parallel client, not a replacement.
- The two versions should stay conceptually aligned so features can move between them without a full redesign.
