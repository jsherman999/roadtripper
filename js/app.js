import {
  buildNarration,
  exportTripMarkdown,
  formatDistance,
  formatDuration,
  formatPopulation,
  haversineKm,
  makeId,
  shouldNarrate,
} from "./core.js?v=20260901.2";
import { PublicDataClient } from "./services.js?v=20260901.2";
import { TripStore } from "./store.js?v=20260901.2";
import { KeyVault, NarrationClient, PROVIDERS, SpeechClient, TTS_MODELS, groupModels, speechInstructions, voicesForModel } from "./llm.js?v=20260901.2";

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
const llm = new NarrationClient();
const speech = new SpeechClient();
const vault = new KeyVault();
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
  llmModels: [],
  llmLoading: false,
  llmErrorAt: 0,
  currentAudio: null,
  audioGeneration: 0,
  ttsCache: new Map(),
  ttsErrorAt: 0,
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
    llmProvider: "",
    llmModel: "",
    ttsProvider: "",
    ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "sage",
    rememberKey: false,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

function savePreferences() {
  const providerId = PROVIDERS[byId("llm-provider").value] ? byId("llm-provider").value : "";
  const ttsOn = byId("tts-provider").value === "openai";
  const remember = byId("llm-remember-key").checked;
  state.preferences = {
    narrationMode: byId("narration-mode").value,
    ageBand: byId("age-band").value,
    voiceName: byId("voice-select").value,
    minimumMinutes: Number(byId("minimum-minutes").value) || 4,
    minimumDistance: Number(byId("minimum-distance").value) || 5,
    speakAloud: byId("speak-aloud").checked,
    saveHistory: byId("save-history").checked,
    llmProvider: providerId,
    llmModel: providerId ? byId("llm-model").value : "",
    ttsProvider: ttsOn ? "openai" : "",
    ttsModel: byId("tts-model").value || "gpt-4o-mini-tts",
    ttsVoice: byId("tts-voice").value || "sage",
    rememberKey: remember,
  };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
  if (providerId) vault.write(providerId, byId("llm-api-key").value, { remember });
  if (ttsOn && providerId !== "openai") vault.write("openai", byId("tts-api-key").value, { remember });

  const narration = llmConfig();
  const voice = ttsConfig();
  const notes = [];
  if (narration) {
    setLlmStatus(`AI narration is on. Stories will be written by ${narration.model} via ${PROVIDERS[providerId].name}.`, "ok");
    notes.push(`stories by ${narration.model}`);
  } else if (providerId && !byId("llm-api-key").value.trim()) {
    setLlmStatus(`Add your ${PROVIDERS[providerId].name} API key to turn on AI narration.`, "error");
    notes.push("add an API key for AI narration");
  } else if (providerId) {
    setLlmStatus("Choose a model to turn on AI narration.", "error");
    notes.push("choose a model for AI narration");
  }
  if (voice) {
    setTtsStatus(`AI voice is on. Stories will be read by ${voice.voice} on ${voice.model}.`, "ok");
    notes.push(`read by ${voice.voice}`);
  } else if (ttsOn) {
    setTtsStatus("Add your OpenAI API key to turn on the AI voice.", "error");
    notes.push("add an OpenAI key for the AI voice");
  }
  toast(notes.length ? `Preferences saved. ${notes.join(" · ")}.` : "Preferences saved.");
}

function applyPreferences() {
  byId("narration-mode").value = state.preferences.narrationMode;
  byId("age-band").value = state.preferences.ageBand;
  byId("minimum-minutes").value = state.preferences.minimumMinutes;
  byId("minimum-distance").value = state.preferences.minimumDistance;
  byId("speak-aloud").checked = state.preferences.speakAloud;
  byId("save-history").checked = state.preferences.saveHistory;
  byId("llm-provider").value = PROVIDERS[state.preferences.llmProvider] ? state.preferences.llmProvider : "";
  byId("llm-remember-key").checked = Boolean(state.preferences.rememberKey);
  syncLlmKeyField();
  renderTtsControls();
  syncTtsKeyField();
}

function llmConfig() {
  const providerId = state.preferences.llmProvider;
  if (!PROVIDERS[providerId]) return null;
  const { key } = vault.read(providerId);
  const model = state.preferences.llmModel;
  return key && model ? { providerId, key, model } : null;
}

function setLlmStatus(message, tone = "") {
  const status = byId("llm-status");
  status.textContent = message;
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-ok", tone === "ok");
}

function renderModelOptions(models, selectedId = "") {
  const providerId = byId("llm-provider").value;
  const select = byId("llm-model");
  select.replaceChildren();
  if (!models.length) {
    select.append(new Option(providerId ? "Enter a key, then load models" : "Turn on a provider first", ""));
  } else {
    select.append(new Option("Choose a model", ""));
    groupModels(providerId, models).forEach((group) => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      group.models.forEach((model) => optgroup.append(new Option(model.name, model.id)));
      select.append(optgroup);
    });
  }
  if (selectedId && !models.some((model) => model.id === selectedId)) select.append(new Option(`${selectedId} (saved)`, selectedId));
  select.value = selectedId || "";
}

function syncLlmKeyField() {
  const providerId = byId("llm-provider").value;
  const provider = PROVIDERS[providerId];
  const keyInput = byId("llm-api-key");
  const stored = provider ? vault.read(providerId) : { key: "", remembered: false };
  keyInput.value = stored.key;
  keyInput.disabled = !provider;
  byId("llm-load-models").disabled = !provider;
  if (provider && stored.key) byId("llm-remember-key").checked = stored.remembered;
  state.llmModels = [];
  const selectedModel = providerId && providerId === state.preferences.llmProvider ? state.preferences.llmModel : "";
  renderModelOptions([], selectedModel);
  if (!provider) {
    setLlmStatus("Built-in narration is on. Choose a provider to write stories with an AI model.");
    return;
  }
  if (stored.key) {
    setLlmStatus(`${provider.name} key ${stored.remembered ? "remembered on this device" : "kept for this tab"}. Loading models…`);
    loadModels();
  } else {
    setLlmStatus(`${provider.keyHint} Paste it above, then press Enter or Load models.`);
    keyInput.focus?.({ preventScroll: true });
  }
}

async function loadModels() {
  const providerId = byId("llm-provider").value;
  const provider = PROVIDERS[providerId];
  const key = byId("llm-api-key").value.trim();
  if (!provider) {
    setLlmStatus("Choose a provider first.", "error");
    return;
  }
  if (!key) {
    setLlmStatus(`Enter your ${provider.name} API key to load its models.`, "error");
    byId("llm-api-key").focus();
    return;
  }
  if (state.llmLoading) return;
  state.llmLoading = true;
  byId("llm-load-models").disabled = true;
  setLlmStatus(`Loading ${provider.name} models…`);
  try {
    const models = await llm.listModels(providerId, key);
    if (byId("llm-provider").value !== providerId) return;
    state.llmModels = models;
    const selected = providerId === state.preferences.llmProvider ? state.preferences.llmModel : "";
    renderModelOptions(models, selected);
    setLlmStatus(
      selected && models.some((model) => model.id === selected)
        ? `${models.length} ${provider.name} models loaded. ${selected} is selected.`
        : `${models.length} ${provider.name} models loaded. Pick one, then save your preferences.`,
      "ok",
    );
  } catch (error) {
    state.llmModels = [];
    setLlmStatus(error.message || `${provider.name} models could not be loaded.`, "error");
  } finally {
    state.llmLoading = false;
    byId("llm-load-models").disabled = !PROVIDERS[byId("llm-provider").value];
  }
}

function ttsConfig() {
  if (state.preferences.ttsProvider !== "openai") return null;
  const { key } = vault.read("openai");
  if (!key) return null;
  const model = TTS_MODELS.some((item) => item.id === state.preferences.ttsModel) ? state.preferences.ttsModel : TTS_MODELS[0].id;
  const voices = voicesForModel(model);
  const voice = voices.some((item) => item.id === state.preferences.ttsVoice) ? state.preferences.ttsVoice : voices[0].id;
  return { key, model, voice };
}

function setTtsStatus(message, tone = "") {
  const status = byId("tts-status");
  status.textContent = message;
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-ok", tone === "ok");
}

function renderTtsControls() {
  const modelSelect = byId("tts-model");
  modelSelect.replaceChildren(...TTS_MODELS.map((model) => new Option(model.name, model.id)));
  modelSelect.value = TTS_MODELS.some((model) => model.id === state.preferences.ttsModel) ? state.preferences.ttsModel : TTS_MODELS[0].id;
  byId("tts-provider").value = state.preferences.ttsProvider === "openai" ? "openai" : "";
  renderTtsVoices(state.preferences.ttsVoice);
}

function renderTtsVoices(preferred = "") {
  const select = byId("tts-voice");
  const voices = voicesForModel(byId("tts-model").value);
  const wanted = preferred || select.value;
  select.replaceChildren(...voices.map((voice) => new Option(`${voice.name} · ${voice.note}`, voice.id)));
  select.value = voices.some((voice) => voice.id === wanted) ? wanted : voices[0].id;
}

function currentOpenAIKey() {
  if (byId("llm-provider").value === "openai") return byId("llm-api-key").value.trim();
  return byId("tts-api-key").value.trim();
}

function syncTtsKeyField() {
  const ttsOn = byId("tts-provider").value === "openai";
  const shared = byId("llm-provider").value === "openai";
  const keyInput = byId("tts-api-key");
  byId("tts-key-label").classList.toggle("is-hidden", !ttsOn || shared);
  keyInput.disabled = !ttsOn || shared;
  byId("tts-model").disabled = !ttsOn;
  byId("tts-voice").disabled = !ttsOn;
  byId("tts-preview").disabled = !ttsOn;
  if (!ttsOn) {
    setTtsStatus("Browser voice is on. Choose OpenAI to hear a natural voice.");
    return;
  }
  const stored = vault.read("openai");
  if (!shared) keyInput.value = stored.key;
  if (shared) setTtsStatus("Using the OpenAI key from AI narration above. Pick a voice and play a sample.");
  else if (stored.key) setTtsStatus(`OpenAI key ${stored.remembered ? "remembered on this device" : "kept for this tab"}. Pick a voice and play a sample.`);
  else setTtsStatus("Paste your OpenAI key, pick a voice, then play a sample.");
}

async function explainProviderFailure(providerId, key, error) {
  if (error?.code !== "network" || !key) return error?.message || "The request failed.";
  const provider = PROVIDERS[providerId];
  const verdict = await llm.verifyKey(providerId, key);
  if (verdict.code === "network") return error.message;
  if (!verdict.ok) return verdict.message;
  return `${provider.name} accepted the key, but this request was refused. ${providerId === "openai" ? "OpenAI hides the reason from browsers; check that the key can use this model or voice." : "Check the model and try again."}`;
}

async function previewVoice() {
  const key = currentOpenAIKey();
  const model = byId("tts-model").value;
  const voice = byId("tts-voice").value;
  if (!key) {
    setTtsStatus("Enter your OpenAI key first.", "error");
    (byId("llm-provider").value === "openai" ? byId("llm-api-key") : byId("tts-api-key")).focus();
    return;
  }
  const button = byId("tts-preview");
  button.disabled = true;
  setTtsStatus(`Asking OpenAI for a ${voice} sample…`);
  try {
    stopAudio();
    const generation = state.audioGeneration;
    const sample = `Hi there! I'm ${voice}, your RoadTripper narrator. Save your preferences and let's hit the road.`;
    const url = await synthesizeCached({ key, model, voice }, sample);
    if (generation !== state.audioGeneration) return;
    playAudio(url, voice);
    setTtsStatus(`That is ${voice} on ${model}. Save preferences to use it.`, "ok");
  } catch (error) {
    setTtsStatus(await explainProviderFailure("openai", key, error), "error");
  } finally {
    button.disabled = byId("tts-provider").value !== "openai";
  }
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
  stopAudio();
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
    const aiStory = await writeWithModel(narration, { place, summary: wiki?.extract || place.description, nearby: combinedNearby });
    if (generation !== state.lookupGeneration) return;
    byId("decision-reason").textContent = aiStory ? `${decision.reason} · written by ${aiStory.model}` : decision.reason;
    addStory({
      title: narration.title,
      script: aiStory?.script || narration.script,
      narrator: aiStory?.model || "",
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

async function writeWithModel(narration, { place, summary, nearby }) {
  const config = llmConfig();
  if (!config) return null;
  byId("loading-message").textContent = `Writing the story with ${config.model}…`;
  byId("decision-reason").textContent = `Writing with ${config.model}…`;
  try {
    const script = await llm.narrate({
      ...config,
      fallbackScript: narration.script,
      context: {
        place: { name: place.name, region: place.region, country: place.country, population: place.population },
        summary,
        nearby: nearby.slice(0, 5).map((item) => ({ name: item.name, kind: item.kind || "" })),
        mode: state.preferences.narrationMode,
        ageBand: state.preferences.ageBand,
      },
    });
    return { script, model: config.model };
  } catch (error) {
    console.error(error);
    if (Date.now() - state.llmErrorAt > 30000) {
      state.llmErrorAt = Date.now();
      toast(`AI narration failed: ${await explainProviderFailure(config.providerId, config.key, error)} Using the built-in story instead.`, true);
    }
    return null;
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
    meta.textContent = `${event.placeName}${event.region ? `, ${event.region}` : ""} · ${new Date(event.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${event.narrator ? ` · ${event.narrator}` : ""}`;
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

function stopAudio() {
  state.audioGeneration += 1;
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }
  window.speechSynthesis?.cancel();
}

function speak(script) {
  stopAudio();
  if (!state.preferences.speakAloud) {
    byId("voice-status").textContent = "Muted";
    return;
  }
  const config = ttsConfig();
  if (!config) {
    speakWithBrowser(script);
    return;
  }
  const generation = state.audioGeneration;
  byId("voice-status").textContent = `Fetching ${config.voice}…`;
  synthesizeCached(config, script)
    .then((url) => {
      if (generation !== state.audioGeneration) return;
      playAudio(url, config.voice);
    })
    .catch(async (error) => {
      if (generation !== state.audioGeneration) return;
      console.error(error);
      speakWithBrowser(script);
      if (Date.now() - state.ttsErrorAt > 30000) {
        state.ttsErrorAt = Date.now();
        toast(`AI voice failed: ${await explainProviderFailure("openai", config.key, error)} Using the browser voice instead.`, true);
      }
    });
}

async function synthesizeCached(config, text) {
  const cacheKey = `${config.model}|${config.voice}|${text}`;
  const cached = state.ttsCache.get(cacheKey);
  if (cached) return cached;
  const blob = await speech.synthesize({
    key: config.key,
    model: config.model,
    voice: config.voice,
    text,
    instructions: speechInstructions(state.preferences.ageBand, state.preferences.narrationMode),
  });
  const url = URL.createObjectURL(blob);
  state.ttsCache.set(cacheKey, url);
  if (state.ttsCache.size > 40) {
    const [oldestKey, oldestUrl] = state.ttsCache.entries().next().value;
    state.ttsCache.delete(oldestKey);
    URL.revokeObjectURL(oldestUrl);
  }
  return url;
}

function playAudio(url, voiceName) {
  const audio = new Audio(url);
  state.currentAudio = audio;
  audio.addEventListener("playing", () => { byId("voice-status").textContent = `Speaking · ${voiceName}`; });
  audio.addEventListener("ended", () => {
    if (state.currentAudio === audio) state.currentAudio = null;
    byId("voice-status").textContent = "Ready";
  });
  audio.addEventListener("error", () => { byId("voice-status").textContent = "Blocked"; });
  audio.play().catch(() => {
    byId("voice-status").textContent = "Blocked";
    toast("The browser blocked audio playback. Click anywhere on the page, then play the story again.", true);
  });
}

function speakWithBrowser(script) {
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
  byId("llm-provider").addEventListener("change", () => {
    syncLlmKeyField();
    syncTtsKeyField();
  });
  byId("tts-provider").addEventListener("change", syncTtsKeyField);
  byId("tts-model").addEventListener("change", () => renderTtsVoices());
  byId("tts-preview").addEventListener("click", previewVoice);
  byId("llm-load-models").addEventListener("click", loadModels);
  byId("llm-api-key").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Return" && event.keyCode !== 13) return;
    event.preventDefault();
    loadModels();
  });
  byId("llm-api-key").addEventListener("change", () => {
    if (byId("llm-api-key").value.trim()) loadModels();
  });
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
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js?v=20260901.2").catch(() => {});
}

try {
  init();
} catch (error) {
  reportError(error, "RoadTripper could not start. Reload the page and check your connection.");
}
