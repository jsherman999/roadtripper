import {
  buildNarration,
  exportTripMarkdown,
  formatDistance,
  formatDuration,
  formatPopulation,
  haversineKm,
  makeId,
  shouldNarrate,
} from "./core.js?v=20260814";
import { PublicDataClient } from "./services.js?v=20260814";
import { TripStore } from "./store.js?v=20260814";

const PREFERENCES_KEY = "roadtripper-browser-preferences-v1";
const DEFAULT_CENTER = [39.5, -98.35];
const MODE_COPY = {
  drive: {
    hint: "Start the trip and allow location access. RoadTripper will speak when a new place comes into view.",
    map: "Following your position · click a place for a story",
    start: "Start trip",
  },
  explore: {
    hint: "Click anywhere on the map to research and narrate that place. Live location is optional.",
    map: "Click anywhere to research a place",
    start: "Start exploring",
  },
  route: {
    hint: "Click the map to add stops, then build a driving route and research towns along the way.",
    map: "Click the map to add route stops",
    start: "Start planning",
  },
};

const byId = (id) => document.getElementById(id);
const api = new PublicDataClient();
const store = new TripStore();
const state = {
  mode: "drive",
  running: false,
  trip: null,
  watchId: null,
  map: null,
  layers: {},
  currentMarker: null,
  currentCoordinates: null,
  nearby: [],
  sessionEvents: [],
  lastNarrated: null,
  lastLookup: null,
  lookupGeneration: 0,
  locationBusy: false,
  pendingPosition: null,
  voices: [],
  waypoints: [],
  route: null,
  loadingCount: 0,
  preferences: readPreferences(),
};

function readPreferences() {
  const defaults = {
    narrationMode: "storyteller",
    ageBand: "adult",
    voiceName: "",
    minimumMinutes: 4,
    minimumDistance: 5,
    speakAloud: true,
    saveHistory: true,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

function savePreferences() {
  state.preferences = {
    narrationMode: byId("narration-mode").value,
    ageBand: byId("age-band").value,
    voiceName: byId("voice-select").value,
    minimumMinutes: Number(byId("minimum-minutes").value) || 4,
    minimumDistance: Number(byId("minimum-distance").value) || 5,
    speakAloud: byId("speak-aloud").checked,
    saveHistory: byId("save-history").checked,
  };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
  toast("Preferences saved.");
}

function applyPreferences() {
  byId("narration-mode").value = state.preferences.narrationMode;
  byId("age-band").value = state.preferences.ageBand;
  byId("minimum-minutes").value = state.preferences.minimumMinutes;
  byId("minimum-distance").value = state.preferences.minimumDistance;
  byId("speak-aloud").checked = state.preferences.speakAloud;
  byId("save-history").checked = state.preferences.saveHistory;
}

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = `toast${isError ? " is-error" : ""}`;
  item.textContent = message;
  byId("toast-region").append(item);
  window.setTimeout(() => item.remove(), 4400);
}

function setLoading(active, message = "Looking up the road ahead…") {
  state.loadingCount = Math.max(0, state.loadingCount + (active ? 1 : -1));
  if (active) byId("loading-message").textContent = message;
  byId("map-loading").classList.toggle("is-hidden", state.loadingCount === 0);
}

function setMode(mode) {
  if (!MODE_COPY[mode]) return;
  if (state.watchId != null && mode !== "drive") {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    byId("gps-status").textContent = "Optional";
  }
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  byId("mode-hint").textContent = MODE_COPY[mode].hint;
  byId("map-tip").textContent = MODE_COPY[mode].map;
  byId("start-trip").lastChild.textContent = ` ${MODE_COPY[mode].start}`;
  byId("route-builder").classList.toggle("is-hidden", mode !== "route");
  if (mode !== "route") state.layers.routeStops.clearLayers();
  if (mode === "route") renderWaypoints();
  if (state.running && mode === "drive" && state.watchId == null) startLocationWatch();
  updateRunningUi();
}

function ensureTrip() {
  if (state.trip && !state.trip.stoppedAt) return state.trip;
  const settings = {
    tripMode: state.mode,
    narrationMode: state.preferences.narrationMode,
    ageBand: state.preferences.ageBand,
    saveHistory: state.preferences.saveHistory,
  };
  state.trip = store.createTrip(byId("trip-name").value, settings);
  state.sessionEvents = [];
  state.lastNarrated = null;
  return state.trip;
}

function updateRunningUi() {
  byId("start-trip").disabled = state.running;
  byId("stop-trip").disabled = !state.running;
  byId("trip-status").textContent = state.running
    ? state.mode === "drive" ? "Driving" : state.mode === "route" ? "Planning" : "Exploring"
    : "Ready";
}

function startTrip() {
  ensureTrip();
  state.running = true;
  updateRunningUi();
  if (state.mode === "drive") {
    startLocationWatch();
    return;
  }
  byId("gps-status").textContent = "Optional";
  toast(state.mode === "route" ? "Click the map to add your first stop." : "Click the map to hear a place story.");
}

function stopTrip() {
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  state.running = false;
  window.speechSynthesis?.cancel();
  byId("voice-status").textContent = "Ready";
  store.stopActiveTrip();
  if (state.trip) state.trip.stoppedAt = new Date().toISOString();
  updateRunningUi();
  toast("Trip stopped. Your saved stories remain in Trips.");
}

function startLocationWatch() {
  if (!("geolocation" in navigator)) {
    byId("gps-status").textContent = "Unavailable";
    toast("This browser does not provide location access. Try Explore mode instead.", true);
    return;
  }
  byId("gps-status").textContent = "Requesting";
  state.watchId = navigator.geolocation.watchPosition(handlePosition, handleLocationError, {
    enableHighAccuracy: false,
    maximumAge: 15000,
    timeout: 20000,
  });
}

function handleLocationError(error) {
  const messages = {
    1: "Location permission was denied. Explore and Route modes still work.",
    2: "Your location is temporarily unavailable.",
    3: "Location lookup timed out. RoadTripper will keep trying.",
  };
  byId("gps-status").textContent = error.code === 1 ? "Blocked" : "Retrying";
  toast(messages[error.code] || "Location could not be read.", true);
}

async function handlePosition(position) {
  const coordinates = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
  state.currentCoordinates = coordinates;
  byId("gps-status").textContent = `${Math.round(position.coords.accuracy)} m`;
  updateCurrentMarker(coordinates);
  if (!state.lastLookup) state.map.setView([coordinates.latitude, coordinates.longitude], 12);
  if (state.locationBusy) {
    state.pendingPosition = coordinates;
    return;
  }
  if (state.lastLookup && haversineKm(coordinates, state.lastLookup.coordinates) < 0.8 && Date.now() - state.lastLookup.time < 90000) return;

  state.locationBusy = true;
  try {
    await investigate(coordinates, { manual: false });
    state.lastLookup = { coordinates, time: Date.now() };
  } catch (error) {
    reportError(error, "The next place could not be researched yet.");
  } finally {
    state.locationBusy = false;
    if (state.pendingPosition) {
      const pending = state.pendingPosition;
      state.pendingPosition = null;
      handlePosition({ coords: { latitude: pending.latitude, longitude: pending.longitude, accuracy: pending.accuracy } });
    }
  }
}

function pinIcon(kind = "place", label = "") {
  const html = kind === "route-stop"
    ? `<div class="map-pin route-stop"><span>${Number(label)}</span></div>`
    : `<div class="map-pin ${kind === "current" ? "current" : ""}"><span></span></div>`;
  return L.divIcon({ className: "", html, iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -27] });
}

function popupNode(title, subtitle = "") {
  const wrapper = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  wrapper.append(strong);
  if (subtitle) {
    const span = document.createElement("span");
    span.textContent = subtitle;
    wrapper.append(span);
  }
  return wrapper;
}

function initMap() {
  if (!globalThis.L) throw new Error("The map library did not load");
  state.map = L.map("trip-map", { zoomControl: true }).setView(DEFAULT_CENTER, 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);
  state.layers = {
    nearby: L.layerGroup().addTo(state.map),
    selected: L.layerGroup().addTo(state.map),
    routeStops: L.layerGroup().addTo(state.map),
    routeLine: L.layerGroup().addTo(state.map),
    routeTowns: L.layerGroup().addTo(state.map),
  };
  state.map.on("click", ({ latlng }) => {
    const coordinates = { latitude: latlng.lat, longitude: latlng.lng };
    if (state.mode === "route") addWaypoint(coordinates);
    else {
      ensureTrip();
      if (!state.running) {
        state.running = true;
        updateRunningUi();
      }
      investigate(coordinates, { manual: true }).catch((error) => reportError(error, "That place could not be researched."));
    }
  });
}

function updateCurrentMarker(coordinates) {
  const latlng = [coordinates.latitude, coordinates.longitude];
  if (!state.currentMarker) {
    state.currentMarker = L.marker(latlng, { icon: pinIcon("current"), zIndexOffset: 1000 }).addTo(state.map);
    state.currentMarker.bindPopup(popupNode("Your location", "Live browser position"));
  } else {
    state.currentMarker.setLatLng(latlng);
  }
}

function renderNearby(places) {
  state.nearby = places;
  state.layers.nearby.clearLayers();
  const list = byId("nearby-list");
  list.replaceChildren();
  if (!places.length) {
    const empty = document.createElement("p");
    empty.className = "empty-row";
    empty.textContent = "No named highlights were returned nearby. Try another place or come back online.";
    list.append(empty);
    return;
  }
  places.forEach((place) => {
    const marker = L.marker([place.latitude, place.longitude], { icon: pinIcon("place") }).addTo(state.layers.nearby);
    marker.bindPopup(popupNode(place.name, place.blurb || place.kind));
    marker.on("click", () => narrateKnownPlace(place));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "nearby-card";
    const strong = document.createElement("strong");
    strong.textContent = place.name;
    const copy = document.createElement("span");
    const distance = Number.isFinite(place.distanceKm) ? ` · ${place.distanceKm.toFixed(1)} km away` : "";
    copy.textContent = `${place.blurb || place.kind || "Local highlight"}${distance}`;
    button.append(strong, copy);
    button.addEventListener("click", () => narrateKnownPlace(place));
    list.append(button);
  });
}

async function investigate(coordinates, { manual = false, suppliedPlace = null, suppliedSummary = null } = {}) {
  const generation = ++state.lookupGeneration;
  setLoading(true, manual ? "Researching this place…" : "Looking up the road ahead…");
  try {
    const placePromise = suppliedPlace ? Promise.resolve(suppliedPlace) : api.reverseGeocode(coordinates.latitude, coordinates.longitude);
    const nearbyPromise = api.nearbyPlaces(coordinates.latitude, coordinates.longitude).catch(() => []);
    const place = await placePromise;
    const nearby = await Promise.race([
      nearbyPromise,
      new Promise((resolve) => window.setTimeout(() => resolve(null), 2800)),
    ]);
    if (generation !== state.lookupGeneration) return;
    place.latitude = Number(place.latitude ?? coordinates.latitude);
    place.longitude = Number(place.longitude ?? coordinates.longitude);
    const combinedNearby = mergeNearby(nearby || [], place.nearbyHints || [], coordinates);
    renderCurrentPlace(place, null);
    renderNearby(combinedNearby);
    if (nearby === null) {
      nearbyPromise.then((lateNearby) => {
        if (generation !== state.lookupGeneration) return;
        renderNearby(mergeNearby(lateNearby, place.nearbyHints || [], coordinates));
      });
    }
    if (manual) {
      state.layers.selected.clearLayers();
      L.marker([place.latitude, place.longitude], { icon: pinIcon("place") })
        .addTo(state.layers.selected)
        .bindPopup(popupNode(place.name, place.region))
        .openPopup();
    }

    const decision = manual
      ? { narrate: true, reason: "You selected this place" }
      : shouldNarrate({
        current: place,
        previous: state.lastNarrated,
        minimumMinutes: state.preferences.minimumMinutes,
        minimumKm: state.preferences.minimumDistance,
      });
    byId("decision-reason").textContent = decision.reason;
    if (!decision.narrate) return;

    const wiki = suppliedSummary ? suppliedSummary : await api.wikipediaSummary(place).catch(() => null);
    if (generation !== state.lookupGeneration) return;
    if (wiki?.population && !place.population) place.population = wiki.population;
    renderCurrentPlace(place, wiki);
    const narration = buildNarration({
      place,
      summary: wiki?.extract || place.description,
      nearby: combinedNearby,
      mode: state.preferences.narrationMode,
      ageBand: state.preferences.ageBand,
    });
    addStory({
      title: narration.title,
      script: narration.script,
      placeName: place.name,
      region: place.region,
      latitude: place.latitude,
      longitude: place.longitude,
      triggerType: manual ? "selected place" : "road ahead",
      sourceUrl: wiki?.url || "",
      tags: [place.name, place.region, ...(combinedNearby.slice(0, 3).map((item) => item.name))],
    });
    state.lastNarrated = { place: { ...place }, timestamp: Date.now() };
  } finally {
    setLoading(false);
  }
}

function mergeNearby(primary, hints, anchor) {
  const seen = new Set();
  return [...primary, ...hints]
    .filter((place) => {
      if (!place?.name || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return false;
      const key = place.name.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      if (!Number.isFinite(place.distanceKm)) place.distanceKm = haversineKm(anchor, place);
      return true;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8);
}

function renderCurrentPlace(place, wiki) {
  byId("current-place-card").classList.remove("is-empty");
  byId("current-place-name").textContent = place.name || "Selected location";
  const region = [place.region, place.country].filter(Boolean).join(" · ");
  byId("current-place-region").textContent = region || `${place.latitude.toFixed(3)}, ${place.longitude.toFixed(3)}`;
  byId("current-place-summary").textContent = wiki?.extract || place.description || "Local details are still coming into view.";
  const source = byId("current-place-source");
  source.classList.toggle("is-hidden", !wiki?.url);
  if (wiki?.url) source.href = wiki.url;
}

function addStory(event) {
  ensureTrip();
  const complete = {
    id: makeId("story"),
    recordedAt: new Date().toISOString(),
    ...event,
  };
  const stored = state.preferences.saveHistory ? store.addEvent(complete) : null;
  const displayEvent = stored || complete;
  state.sessionEvents.unshift(displayEvent);
  renderStories();
  speak(displayEvent.script);
}

function renderStories() {
  const feed = byId("story-feed");
  feed.replaceChildren();
  byId("story-count").textContent = `${state.sessionEvents.length} ${state.sessionEvents.length === 1 ? "story" : "stories"}`;
  if (!state.sessionEvents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const glyph = document.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "◌";
    const heading = document.createElement("h3");
    heading.textContent = "The road is quiet—for now.";
    const copy = document.createElement("p");
    copy.textContent = "Your narrated places will collect here as the trip unfolds.";
    empty.append(glyph, heading, copy);
    feed.append(empty);
    return;
  }
  state.sessionEvents.forEach((event, index) => {
    const item = document.createElement("article");
    item.className = "story-item";
    const icon = document.createElement("span");
    icon.className = "story-index";
    icon.textContent = "♬";
    const copy = document.createElement("div");
    copy.className = "story-copy";
    const heading = document.createElement("h3");
    heading.textContent = event.title;
    const script = document.createElement("p");
    script.textContent = event.script;
    const meta = document.createElement("div");
    meta.className = "story-meta";
    meta.textContent = `${event.placeName}${event.region ? `, ${event.region}` : ""} · ${new Date(event.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    copy.append(heading, script, meta);
    const play = document.createElement("button");
    play.type = "button";
    play.className = "play-story";
    play.setAttribute("aria-label", `Play ${event.title}`);
    play.textContent = "▶";
    play.addEventListener("click", () => speak(event.script));
    item.append(icon, copy, play);
    feed.append(item);
    if (index === 0) item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function chooseVoice() {
  const selected = state.voices.find((voice) => voice.name === state.preferences.voiceName);
  if (selected) return selected;
  const preferred = ["Samantha", "Ava", "Google US English", "Daniel"];
  return preferred.map((name) => state.voices.find((voice) => voice.name === name)).find(Boolean)
    || state.voices.find((voice) => voice.lang?.toLowerCase().startsWith("en"))
    || null;
}

function speak(script) {
  if (!state.preferences.speakAloud) {
    byId("voice-status").textContent = "Muted";
    return;
  }
  if (!("speechSynthesis" in window)) {
    byId("voice-status").textContent = "Unavailable";
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(script);
  const voice = chooseVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = state.preferences.ageBand === "early_elementary" ? 0.9 : 0.96;
  utterance.pitch = 1.02;
  utterance.onstart = () => { byId("voice-status").textContent = "Speaking"; };
  utterance.onend = () => { byId("voice-status").textContent = "Ready"; };
  utterance.onerror = () => { byId("voice-status").textContent = "Blocked"; };
  window.speechSynthesis.speak(utterance);
}

function populateVoices() {
  if (!("speechSynthesis" in window)) return;
  state.voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
  const select = byId("voice-select");
  select.replaceChildren(new Option("Automatic", ""));
  state.voices.sort((a, b) => a.name.localeCompare(b.name)).forEach((voice) => {
    select.append(new Option(`${voice.name} (${voice.lang})`, voice.name));
  });
  select.value = state.preferences.voiceName || "";
}

async function narrateKnownPlace(place) {
  ensureTrip();
  if (!state.running) {
    state.running = true;
    updateRunningUi();
  }
  state.map.panTo([place.latitude, place.longitude]);
  await investigate(place, { manual: true, suppliedPlace: { ...place, region: place.region || "" } });
}

function addWaypoint(coordinates) {
  if (state.waypoints.length >= 12) {
    toast("A browser route is limited to 12 stops. Remove one before adding another.", true);
    return;
  }
  if (state.route) clearRouteResults();
  const waypoint = { id: makeId("waypoint"), name: `Stop ${state.waypoints.length + 1}`, ...coordinates };
  state.waypoints.push(waypoint);
  renderWaypoints();
  api.reverseGeocode(coordinates.latitude, coordinates.longitude).then((place) => {
    const current = state.waypoints.find((item) => item.id === waypoint.id);
    if (!current) return;
    current.name = [place.name, place.region].filter(Boolean).join(", ");
    renderWaypoints();
  }).catch(() => {});
}

function removeWaypoint(id) {
  state.waypoints = state.waypoints.filter((waypoint) => waypoint.id !== id);
  renderWaypoints();
  clearRouteResults();
}

function renderWaypoints() {
  const list = byId("waypoint-list");
  list.replaceChildren();
  state.layers.routeStops.clearLayers();
  if (!state.waypoints.length) {
    const empty = document.createElement("li");
    empty.className = "empty-row";
    empty.textContent = "Click the map to add at least two stops.";
    list.append(empty);
  }
  state.waypoints.forEach((waypoint, index) => {
    const item = document.createElement("li");
    item.className = "waypoint-item";
    const number = document.createElement("span");
    number.className = "waypoint-number";
    number.textContent = String(index + 1);
    const copy = document.createElement("span");
    copy.className = "waypoint-copy";
    const title = document.createElement("strong");
    title.textContent = waypoint.name;
    const coords = document.createElement("small");
    coords.textContent = `${waypoint.latitude.toFixed(4)}, ${waypoint.longitude.toFixed(4)}`;
    copy.append(title, coords);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.setAttribute("aria-label", `Remove ${waypoint.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeWaypoint(waypoint.id));
    item.append(number, copy, remove);
    list.append(item);
    L.marker([waypoint.latitude, waypoint.longitude], { icon: pinIcon("route-stop", index + 1) })
      .addTo(state.layers.routeStops)
      .bindPopup(popupNode(waypoint.name, `Stop ${index + 1}`));
  });
  byId("plot-route").disabled = state.waypoints.length < 2;
  byId("route-status").textContent = state.waypoints.length < 2
    ? "Add at least two stops. Stops stay in the order you choose them."
    : `${state.waypoints.length} stops ready to connect.`;
}

function clearRouteResults() {
  state.route = null;
  state.layers.routeLine.clearLayers();
  state.layers.routeTowns.clearLayers();
  byId("itinerary-panel").classList.add("is-hidden");
}

function clearRoute() {
  state.waypoints = [];
  clearRouteResults();
  renderWaypoints();
}

async function buildRoute() {
  if (state.waypoints.length < 2) return;
  ensureTrip();
  state.running = true;
  updateRunningUi();
  byId("plot-route").disabled = true;
  setLoading(true, "Building your driving route…");
  byId("route-status").textContent = "Asking the routing service for the road ahead…";
  try {
    const planned = await api.planRoute(state.waypoints);
    state.layers.routeLine.clearLayers();
    const latlngs = planned.geometry.map(([longitude, latitude]) => [latitude, longitude]);
    const line = L.polyline(latlngs, { color: "#2f7f9c", weight: 6, opacity: 0.88 }).addTo(state.layers.routeLine);
    state.map.fitBounds(line.getBounds(), { padding: [36, 36] });
    state.route = { id: makeId("route"), ...planned, waypoints: [...state.waypoints], towns: [] };
    byId("route-status").textContent = "Finding towns along the route…";
    byId("itinerary-panel").classList.remove("is-hidden");
    renderItinerary();
    const towns = await api.townsAlongRoute(planned.geometry);
    state.route.towns = towns.map((town) => ({ ...town, status: "queued", summary: "", sourceUrl: "" }));
    store.setRoute(state.route);
    renderRouteTowns();
    renderItinerary();
    byId("route-status").textContent = towns.length
      ? `Route ready. Researching ${Math.min(towns.length, 18)} towns in the background…`
      : "Route ready. No named towns were returned along this corridor.";
    researchRouteTowns();
  } catch (error) {
    reportError(error, "The route could not be built. Try fewer or closer stops.");
    byId("route-status").textContent = "Route planning failed. Adjust the stops and try again.";
  } finally {
    setLoading(false);
    byId("plot-route").disabled = state.waypoints.length < 2;
  }
}

function renderRouteTowns() {
  state.layers.routeTowns.clearLayers();
  state.route?.towns?.forEach((town) => {
    const color = town.status === "ready" ? "#4f9a73" : town.status === "failed" ? "#b85b56" : "#d79c40";
    const marker = L.circleMarker([town.latitude, town.longitude], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 0.94,
    }).addTo(state.layers.routeTowns);
    marker.bindPopup(popupNode(town.name, town.region || formatPopulation(town.population)));
    marker.on("click", () => narrateRouteTown(town));
  });
}

function renderItinerary() {
  if (!state.route) return;
  byId("route-summary").textContent = `${formatDistance(state.route.distanceMeters)} · ${formatDuration(state.route.durationSeconds)}`;
  const list = byId("itinerary-list");
  list.replaceChildren();
  if (!state.route.towns.length) {
    const empty = document.createElement("p");
    empty.className = "empty-row";
    empty.textContent = "The route is drawn. Towns will appear as public place data arrives.";
    list.append(empty);
    return;
  }
  state.route.towns.forEach((town, index) => {
    const item = document.createElement("article");
    item.className = `itinerary-stop is-${town.status}`;
    const number = document.createElement("span");
    number.className = "stop-number";
    number.textContent = String(index + 1);
    const heading = document.createElement("h3");
    heading.textContent = [town.name, town.region].filter(Boolean).join(", ");
    const copy = document.createElement("p");
    copy.textContent = town.summary || (town.status === "researching" ? "Gathering a local story…" : `${formatPopulation(town.population)} · ${town.distanceKm.toFixed(1)} km from the route`);
    const footer = document.createElement("div");
    footer.className = "stop-footer";
    const status = document.createElement("span");
    status.textContent = town.status === "ready" ? "Story ready" : town.status === "failed" ? "Basic details" : "Research queued";
    const narrate = document.createElement("button");
    narrate.type = "button";
    narrate.className = "narrate-stop";
    narrate.textContent = "Narrate";
    narrate.addEventListener("click", () => narrateRouteTown(town));
    footer.append(status, narrate);
    item.append(number, heading, copy, footer);
    list.append(item);
  });
}

async function researchRouteTowns() {
  const queue = state.route.towns.slice(0, 18);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const town = queue[cursor];
      cursor += 1;
      town.status = "researching";
      renderItinerary();
      renderRouteTowns();
      try {
        const wiki = await api.wikipediaSummary(town);
        town.summary = wiki?.extract || `${town.name} is one of the communities along this route.`;
        town.sourceUrl = wiki?.url || "";
        if (wiki?.population && !town.population) town.population = wiki.population;
        town.status = "ready";
      } catch {
        town.status = "failed";
      }
      renderItinerary();
      renderRouteTowns();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  if (state.route) {
    store.setRoute(state.route);
    byId("route-status").textContent = `Route ready · ${queue.filter((town) => town.status === "ready").length} town stories gathered.`;
  }
}

async function narrateRouteTown(town) {
  let summary = town.summary ? { extract: town.summary, url: town.sourceUrl, population: town.population } : null;
  if (!summary) {
    setLoading(true, `Researching ${town.name}…`);
    try {
      summary = await api.wikipediaSummary(town);
      town.summary = summary?.extract || "";
      town.sourceUrl = summary?.url || "";
      town.status = "ready";
      renderItinerary();
    } finally {
      setLoading(false);
    }
  }
  await investigate(town, { manual: true, suppliedPlace: town, suppliedSummary: summary });
  state.map.panTo([town.latitude, town.longitude]);
}

function renderHistory() {
  const events = store.events(byId("history-search").value);
  const list = byId("history-list");
  list.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty-row";
    empty.textContent = "No saved stories match this search.";
    list.append(empty);
    return;
  }
  events.forEach((event) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const title = document.createElement("h3");
    title.textContent = event.title;
    const copy = document.createElement("p");
    copy.textContent = event.script;
    const meta = document.createElement("small");
    meta.textContent = `${event.tripName} · ${event.placeName}${event.region ? `, ${event.region}` : ""} · ${new Date(event.recordedAt).toLocaleString()}`;
    item.append(title, copy, meta);
    list.append(item);
  });
}

function exportCurrentTrip() {
  const trip = store.getActiveTrip() || state.trip;
  if (!trip) {
    toast("Start a trip before exporting.", true);
    return;
  }
  const blob = new Blob([exportTripMarkdown(trip)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${trip.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "roadtripper"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function clearHistory() {
  if (!window.confirm("Clear every saved RoadTripper story on this device? This cannot be undone.")) return;
  store.clearHistory();
  state.sessionEvents = [];
  if (state.trip) state.trip.events = [];
  renderStories();
  renderHistory();
  toast("Saved stories cleared.");
}

function locateMe() {
  if (!("geolocation" in navigator)) {
    toast("Location is unavailable in this browser.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    state.currentCoordinates = coordinates;
    updateCurrentMarker(coordinates);
    state.map.setView([coordinates.latitude, coordinates.longitude], 12);
    byId("gps-status").textContent = `${Math.round(position.coords.accuracy)} m`;
  }, handleLocationError, { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 });
}

function reportError(error, fallback) {
  const message = error?.message && !error.message.startsWith("Public data request") ? error.message : fallback;
  toast(message, true);
  byId("decision-reason").textContent = fallback;
  console.error(error);
}

function updateConnectionStatus() {
  const element = byId("connection-status");
  const online = navigator.onLine;
  element.classList.toggle("is-offline", !online);
  element.lastChild.textContent = online ? " Online" : " Offline";
}

function wireEvents() {
  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  byId("start-trip").addEventListener("click", startTrip);
  byId("stop-trip").addEventListener("click", stopTrip);
  byId("locate-me").addEventListener("click", locateMe);
  byId("clear-route").addEventListener("click", clearRoute);
  byId("plot-route").addEventListener("click", buildRoute);
  byId("open-settings").addEventListener("click", () => byId("settings-dialog").showModal());
  byId("open-about").addEventListener("click", () => byId("about-dialog").showModal());
  byId("open-history").addEventListener("click", () => {
    renderHistory();
    byId("history-dialog").showModal();
  });
  byId("save-settings").addEventListener("click", savePreferences);
  byId("history-search").addEventListener("input", renderHistory);
  byId("export-trip").addEventListener("click", exportCurrentTrip);
  byId("clear-history").addEventListener("click", clearHistory);
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function init() {
  applyPreferences();
  initMap();
  wireEvents();
  populateVoices();
  if ("speechSynthesis" in window) window.speechSynthesis.addEventListener("voiceschanged", populateVoices);
  updateConnectionStatus();
  updateRunningUi();
  renderStories();
  setMode("drive");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js?v=20260814.3").catch(() => {});
}

try {
  init();
} catch (error) {
  reportError(error, "RoadTripper could not start. Reload the page and check your connection.");
}
