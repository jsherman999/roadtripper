# Road Trip Commentary App Plan

## Working Title
Road Trip Storyguide

## Product Vision
Build a web-based application that continuously uses the laptop's live location to identify nearby towns and points of interest, fetches interesting and age-appropriate facts from online sources, narrates them through the laptop speaker, and optionally saves each spoken item as searchable trip notes.

The experience should feel like a friendly road trip storyteller for children: informative, lightweight, and continuous without becoming repetitive or distracting.

## Core User Experience
- The app opens in a browser and asks for location permission and audio permission.
- While the trip is active, the app watches the laptop's changing GPS location.
- As the car approaches or passes places, the app detects the most relevant nearby town or point of interest.
- The app gathers short facts such as town name, population, notable features, history, school enrollment, landmarks, and fun local trivia.
- The app turns that information into a short spoken script appropriate for children.
- The script is narrated through the laptop speaker.
- Each narrated item can optionally be saved as a timestamped text record for later viewing and search.

## Primary Goals
- Continuous location-aware commentary during a road trip
- Kid-friendly narration that stays interesting without over-talking
- Web interface for trip control and later browsing of saved commentary
- Internet-connected enrichment so facts stay broader than a static offline database
- Searchable log of narrated places and points of interest

## Key Constraints And Assumptions
- The device has a browser, speaker output, and a reasonably accurate location signal.
- The application will run with internet access for map lookups, research, and optional AI summarization.
- Browser geolocation updates may vary in frequency and precision depending on device and OS.
- Some requested facts, such as high school enrollment, may not exist for every town in a clean public source and should degrade gracefully.
- Children are the audience, so narration should avoid controversial or unsafe material and should be filtered for age appropriateness.

## Suggested System Architecture

### Frontend Web App
- Trip dashboard with start, pause, resume, and stop controls
- Live map and current place card
- Narration controls: volume, pace, voice, content density, kid mode
- Timeline of narrated places with search and filters
- Settings for save-history, narration frequency, distance sensitivity, and content categories

### Backend Service
- Receives live or periodic location updates from the browser
- Determines nearby towns and points of interest
- Orchestrates external APIs and enrichment pipelines
- Builds normalized place records and narration payloads
- Stores trip logs and saved commentary

### Data And Enrichment Layer
- Reverse geocoding for town/city lookup
- Places/landmarks lookup for nearby attractions
- Population and civic data sources
- School data source for enrollment when available
- History and trivia enrichment from trusted web or structured data providers
- Summarization layer to convert raw facts into short child-friendly narration

### Narration Layer
- Text-to-speech generation
- Playback queue with interruption rules
- Deduplication to avoid repeating the same place too often
- Script length control based on vehicle speed and density of nearby points

### Storage
- Trip sessions
- Narration events
- Place cache
- Saved transcripts and metadata
- Search index for later retrieval

## Recommended Technical Stack

### Frontend
- React or Next.js for the web interface
- Mapbox GL JS or Google Maps for live mapping
- Browser Geolocation API for live position tracking
- Web Speech API for first-pass browser TTS, with option to upgrade to a higher-quality cloud TTS provider later

### Backend
- Node.js with TypeScript
- REST or lightweight realtime API for trip updates
- Background job queue for enrichment and summarization

### Data Storage
- PostgreSQL for durable trip/session data
- Redis for short-lived caching and narration throttling
- Optional full-text search via PostgreSQL search or Meilisearch/OpenSearch later

### External Services
- Reverse geocoding and map provider
- Places/landmarks provider
- Census/demographics sources where practical
- School directory or public education datasets
- LLM-based summarization for concise kid-friendly scripts
- Cloud TTS provider if browser voices are insufficient

## Major Product Risks
- Location jitter may create noisy or repetitive place detection.
- Fact quality will vary widely across towns, especially smaller ones.
- School enrollment data may be difficult to obtain consistently and legally across all regions.
- Continuous narration can become annoying without strong throttling and relevance scoring.
- Browser-based TTS quality may vary by machine and operating system.
- Live web lookups could increase latency unless aggressively cached.

## Phase Plan

## Phase 0: Discovery And Validation
### Objective
Reduce product risk before building the full experience.

### Deliverables
- Define primary user scenarios: highway driving, passing small towns, scenic areas, rest stops, major landmarks
- Decide geographic scope for first release, such as United States only
- Choose initial source strategy for population, town facts, and points of interest
- Define content safety rules for children
- Establish success criteria for commentary frequency, response time, and narration quality

### Exit Criteria
- Clear feature scope for MVP
- Chosen API/source shortlist
- Agreed content guidelines and fallback rules

## Phase 1: Core Prototype
### Objective
Prove that the browser can track movement, identify places, and speak basic commentary.

### Features
- Single-page web app with trip start/stop
- Browser geolocation watch
- Reverse geocoding to identify current town
- Simple fact retrieval for town name, state, and population
- Basic narration through browser TTS
- On-screen trip feed showing spoken items

### Technical Focus
- Geolocation update loop
- Debounce and distance-threshold logic
- Minimal backend endpoint for enrichment
- Local or database persistence for narrated text

### Exit Criteria
- App can narrate location changes during a simulated trip
- Spoken items are logged and viewable later

## Phase 2: Enrichment And Relevance Engine
### Objective
Make commentary genuinely interesting rather than just reading map labels.

### Features
- Nearby point-of-interest detection
- Fact aggregation from multiple sources
- Structured place profile with fields such as population, town nickname, history, schools, notable industries, and fun facts
- Relevance scoring to decide what is worth narrating
- Duplicate suppression and cooldown windows

### Technical Focus
- Place normalization pipeline
- Per-place cache to avoid repeated internet lookups
- Ranking model based on distance, novelty, importance, and time since last narration
- Graceful degradation when some facts are missing

### Exit Criteria
- Commentary includes richer facts for many towns
- App avoids repeating the same town or trivial nearby places

## Phase 3: Kid-Friendly Narration System
### Objective
Turn raw facts into engaging short stories suitable for children in a car.

### Features
- Prompt templates for age-appropriate summaries
- Multiple narration modes: quick facts, storyteller, history, landmarks
- Adjustable length options such as 15, 30, or 60 seconds
- Voice and speaking-rate controls
- Safety filtering for sensitive topics

### Technical Focus
- Script generation layer
- Content moderation and fallback narration
- Playback queue with skip, pause, and do-not-interrupt rules

### Exit Criteria
- Narration sounds natural and varied
- Parents can tune density and tone

## Phase 4: Trip Journal And Searchable Archive
### Objective
Preserve the journey as a useful trip record.

### Features
- Saved transcript for every narration event
- Search by town, state, keyword, date, and trip
- Detail page for each stop/place with source facts and spoken script
- Export options such as Markdown, PDF, or plain text

### Technical Focus
- Search indexing
- Session and event data model
- Optional source attribution storage for later display

### Exit Criteria
- Families can review and search previous trip commentary
- Saved text is reliable and easy to browse

## Phase 5: Route Awareness And Proactive Commentary
### Objective
Move from reactive place lookup to smarter trip storytelling.

### Features
- Route-aware forecasting of upcoming towns and attractions
- "Coming up next" narration
- Detection of scenic byways, parks, rivers, monuments, and museums
- Speed-aware narration timing
- Optional quiet hours or nap mode

### Technical Focus
- Route inference from recent GPS trail or optional navigation input
- Ahead-of-position querying
- Timing model for when to narrate before or during a pass-by

### Exit Criteria
- Commentary feels anticipatory and well-timed
- The app can talk about interesting places before they are behind the car

## Phase 6: Reliability, Safety, And Launch Hardening
### Objective
Make the application robust enough for long road trips and wider use.

### Features
- Error handling and retry logic for unreliable networks
- Offline fallback for recently cached places
- Usage analytics and quality metrics
- Admin tools for blocked topics and prompt tuning
- Performance optimizations for battery and CPU usage

### Technical Focus
- Observability and alerting
- Cache invalidation strategy
- Rate-limit protection
- Privacy controls for stored location history

### Exit Criteria
- Stable multi-hour trip performance
- Acceptable latency and narration quality under normal travel conditions

## Cross-Cutting Design Decisions

### Commentary Timing Rules
- Do not narrate every geolocation update.
- Prefer meaningful triggers such as entering a new town, approaching a notable landmark, or enough elapsed time since the last narration.
- Use cooldowns and minimum-distance thresholds.

### Content Rules
- Keep scripts short, positive, and understandable for children.
- Avoid politics, crime details, and upsetting historical content unless explicitly enabled.
- Mark uncertain facts internally and exclude them from narration if confidence is low.

### Data Confidence Strategy
- Store confidence per fact
- Prefer structured sources for population and school size
- Use generative summarization only after facts are assembled
- Log source provenance for later debugging

### Privacy Strategy
- Make trip history opt-in
- Allow deletion of trips and raw location logs
- Separate precise GPS points from user-facing summaries when possible

## MVP Recommendation
The best first version is a child-friendly town narrator, not a full encyclopedic travel companion.

Start with:
- Current town/city detection
- Population
- One or two "known for" facts
- One history tidbit
- One nearby landmark when available
- Spoken narration
- Searchable saved transcript

Defer until later:
- Broad school enrollment coverage
- Deep historical research
- Complex route prediction
- Rich parent dashboards

## Example MVP User Flow
1. Parent opens the app and taps Start Trip.
2. Browser requests location permission.
3. App begins watching position and sends updates to the backend.
4. Backend identifies the current town and fetches enrichment data.
5. App receives a short narration script and speaks it aloud.
6. Narration event is saved with timestamp, coordinates, and text.
7. Parent later opens Trip History and searches for a town visited earlier.

## Proposed Milestones
- Milestone 1: Location tracking plus basic town narration
- Milestone 2: Richer facts plus relevance scoring
- Milestone 3: Child-friendly narration controls and quality improvements
- Milestone 4: Searchable trip journal
- Milestone 5: Route-aware upcoming commentary
- Milestone 6: Production readiness

## Suggested Initial Build Order
1. Design the event model for trips, places, and narration logs.
2. Build a minimal backend that converts coordinates into a place record.
3. Build the web UI with geolocation and narration feed.
4. Add TTS playback and transcript persistence.
5. Add enrichment sources and caching.
6. Add summarization, child-safety filtering, and search.

## Open Questions
- Should the first release focus only on towns, or include landmarks and attractions immediately?
- Should narration happen entirely in-browser at first, or should audio be generated on the server for more consistent voice quality?
- How much location history should be retained by default?
- Should families be able to choose age bands, such as early elementary versus middle school?
- Which regions matter first for launch coverage?

## Recommended Next Step
Begin with a short technical spike that tests four things together:
- continuous browser geolocation
- reverse geocoding
- one enrichment provider
- spoken narration plus saved transcript

That spike will answer the biggest feasibility questions before deeper product work begins.
