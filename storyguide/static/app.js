const state = {
  tripId: null,
  watchId: null,
  speakAloud: true,
  helpOpen: false,
  selectedVoiceName: "",
  voices: [],
  map: null,
  mapReady: false,
  mapCentered: false,
  mapLayers: null,
  discoveredKeys: new Set(),
  lastAnchor: null,
  audioGeneration: 0,
  currentAudio: null,
  ttsProvider: "browser",
};

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  byId(id).textContent = value;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function getStoredLlmModel() {
  return window.localStorage.getItem("roadtripper_llm_model") || "";
}

function setStoredLlmModel(modelId) {
  if (modelId) {
    window.localStorage.setItem("roadtripper_llm_model", modelId);
  } else {
    window.localStorage.removeItem("roadtripper_llm_model");
  }
}

async function speak(script) {
  if (!state.speakAloud) {
    setText("audio-status", "Muted");
    return;
  }
  const generation = ++state.audioGeneration;
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (state.ttsProvider === "openai") {
    const selectedVoice = byId("voice-select").value;
    const data = await requestJson("/api/tts", {
      method: "POST",
      body: JSON.stringify({ text: script, voice: selectedVoice }),
    });
    if (generation !== state.audioGeneration) {
      return;
    }
    if (!data.fallback && data.audio_base64) {
      const audio = new Audio(`data:${data.mime_type};base64,${data.audio_base64}`);
      state.currentAudio = audio;
      audio.play().catch(() => {
        setText("audio-status", "Audio blocked");
      });
      setText("audio-status", data.voice ? `Speaking (${data.voice})` : "Speaking");
      return;
    }
  }
  if (!("speechSynthesis" in window)) {
    setText("audio-status", "No audio provider");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(script);
  const voice = chooseVoice();
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  setText("audio-status", voice ? `Speaking (${voice.name})` : "Speaking");
}

function chooseVoice() {
  const voices = state.voices.length ? state.voices : window.speechSynthesis.getVoices();
  if (!voices.length) {
    return null;
  }
  if (state.selectedVoiceName) {
    const selected = voices.find((voice) => voice.name === state.selectedVoiceName);
    if (selected) {
      return selected;
    }
  }
  const preferredNames = [
    "Samantha",
    "Ava",
    "Allison",
    "Karen",
    "Moira",
    "Serena",
    "Daniel",
    "Google US English",
  ];
  for (const name of preferredNames) {
    const preferred = voices.find((voice) => voice.name === name);
    if (preferred) {
      return preferred;
    }
  }
  return voices.find((voice) => voice.lang && voice.lang.startsWith("en")) || voices[0];
}

function populateVoices() {
  if (state.ttsProvider === "openai") {
    return;
  }
  if (!("speechSynthesis" in window)) {
    return;
  }
  const voiceSelect = byId("voice-select");
  const voices = window.speechSynthesis.getVoices();
  state.voices = voices;
  voiceSelect.innerHTML = `<option value="">Auto</option>`;
  voices
    .filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith("en"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      if (voice.name === state.selectedVoiceName) {
        option.selected = true;
      }
      voiceSelect.appendChild(option);
    });
}

function appendFeed(event) {
  const feed = byId("feed");
  const item = document.createElement("article");
  item.className = "feed-item";
  item.innerHTML = `
    <p class="feed-kicker">${event.trigger_type.replace("_", " ")}</p>
    <h3>${event.title}</h3>
    <p>${event.script}</p>
    <small>${event.place_name}, ${event.region} at ${event.recorded_at}</small>
  `;
  feed.prepend(item);
}

function ensureMap() {
  if (state.mapReady || !window.L) {
    return;
  }
  state.map = L.map("trip-map").setView([39.8283, -98.5795], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);
  state.mapLayers = {
    current: L.layerGroup().addTo(state.map),
    queue: L.layerGroup().addTo(state.map),
    points: L.layerGroup().addTo(state.map),
    discovered: L.layerGroup().addTo(state.map),
  };
  state.map.on("click", (event) => {
    narrateMapLocation({
      latitude: event.latlng.lat,
      longitude: event.latlng.lng,
    }).catch((error) => {
      setText("decision-reason", error.message);
    });
  });
  state.mapReady = true;
}

function highlightDiscoveredPlace(place, type = "discovered", blurb = "") {
  ensureMap();
  if (!state.mapLayers || !place || place.latitude == null || place.longitude == null) {
    return;
  }
  const key = `${type}:${place.name}:${place.region}:${place.latitude}:${place.longitude}`;
  if (state.discoveredKeys.has(key)) {
    return;
  }
  state.discoveredKeys.add(key);
  const marker = L.circleMarker([place.latitude, place.longitude], {
    radius: type === "point" ? 6 : 8,
    color: type === "point" ? "#d97706" : "#0f766e",
    fillColor: type === "point" ? "#fb923c" : "#14b8a6",
    fillOpacity: 0.75,
    weight: 2,
  }).addTo(state.mapLayers.discovered);
  marker.bindPopup(
    `<strong>${place.name}</strong><br>${place.region || ""}${blurb ? `<br>${blurb}` : ""}`
  );
  marker.on("click", () => {
    narrateMapLocation(place).catch((error) => {
      setText("decision-reason", error.message);
    });
  });
}

function renderMap(data, payload) {
  ensureMap();
  if (!state.mapReady) {
    return;
  }
  const lat = payload.latitude;
  const lon = payload.longitude;
  state.lastAnchor = { latitude: lat, longitude: lon };
  state.mapLayers.current.clearLayers();
  state.mapLayers.queue.clearLayers();
  state.mapLayers.points.clearLayers();

  const currentMarker = L.marker([lat, lon]).addTo(state.mapLayers.current);
  currentMarker.bindPopup("Current location");

  if (!state.mapCentered) {
    state.map.setView([lat, lon], 11);
    state.mapCentered = true;
  } else {
    state.map.panTo([lat, lon], { animate: true });
  }

  const currentPlace = data.current_place;
  if (currentPlace) {
    highlightDiscoveredPlace(currentPlace, "town");
  }

  (data.nearby_towns || []).forEach((town) => {
    const marker = L.circleMarker([town.latitude, town.longitude], {
      radius: 7,
      color: "#2563eb",
      fillColor: "#60a5fa",
      fillOpacity: 0.8,
      weight: 2,
    }).addTo(state.mapLayers.queue);
    marker.bindPopup(`<strong>${town.name}</strong><br>${town.region}<br>${town.distance_km} km away`);
    marker.on("click", () => {
      narrateTownNow(town).catch((error) => {
        setText("decision-reason", error.message);
      });
    });
  });

  (data.nearby_points || []).forEach((point) => {
    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: 6,
      color: "#d97706",
      fillColor: "#fdba74",
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(state.mapLayers.points);
    marker.bindPopup(`<strong>${point.name}</strong><br>${point.blurb || point.kind}`);
    marker.on("click", () => {
      narrateMapLocation(point).catch((error) => {
        setText("decision-reason", error.message);
      });
    });
    highlightDiscoveredPlace(
      {
        name: point.name,
        region: currentPlace ? currentPlace.region : "",
        latitude: point.latitude,
        longitude: point.longitude,
      },
      "point",
      point.blurb || point.kind
    );
  });
}

function renderNearbyTowns(towns) {
  const list = byId("nearby-town-list");
  list.innerHTML = "";
  if (!towns || !towns.length) {
    setText("upcoming-name", "No nearby towns yet");
    setText("upcoming-details", "Drive a little farther to build a nearby-town queue.");
    return;
  }
  setText("upcoming-name", `${towns.length} nearby towns`);
  setText("upcoming-details", "Tap a town to narrate it now, or let it trigger when you arrive nearby.");
  towns.forEach((town) => {
    const button = document.createElement("button");
    button.className = "town-chip";
    button.type = "button";
    button.innerHTML = `<strong>${town.name}</strong><span>${town.region} • ${town.distance_km} km</span>`;
    button.addEventListener("click", () => narrateTownNow(town));
    list.appendChild(button);
  });
}

function renderNearbyContext(data) {
  renderNearbyTowns(data.nearby_towns || []);
}

async function narrateTownNow(town) {
  if (!state.tripId) {
    return;
  }
  const data = await requestJson(`/api/trips/${state.tripId}/narrate-place`, {
    method: "POST",
    body: JSON.stringify(town),
  });
  if (data.event) {
    appendFeed(data.event);
    speak(data.event.script);
    renderNearbyContext(data);
    renderMap(data, {
      latitude: data.selected_place.latitude,
      longitude: data.selected_place.longitude,
    });
    highlightDiscoveredPlace(
      {
        name: data.selected_place.name,
        region: data.selected_place.region,
        latitude: data.selected_place.latitude,
        longitude: data.selected_place.longitude,
      },
      "town"
    );
    refreshHistory().catch(() => {});
  }
}

async function narrateMapLocation(location) {
  if (!state.tripId) {
    return;
  }
  const data = await requestJson(`/api/trips/${state.tripId}/narrate-place`, {
    method: "POST",
    body: JSON.stringify(location),
  });
  if (data.event) {
    appendFeed(data.event);
    speak(data.event.script);
    renderNearbyContext(data);
    renderMap(data, {
      latitude: data.selected_place.latitude,
      longitude: data.selected_place.longitude,
    });
    highlightDiscoveredPlace(
      {
        name: data.selected_place.name,
        region: data.selected_place.region,
        latitude: data.selected_place.latitude,
        longitude: data.selected_place.longitude,
      },
      location.kind ? "point" : "town",
      location.blurb || ""
    );
    refreshHistory().catch(() => {});
  }
}

function renderHistory(events) {
  const container = byId("history-results");
  container.innerHTML = "";
  if (!events.length) {
    container.innerHTML = `<p class="empty-state">No saved narration matches that search yet.</p>`;
    return;
  }
  events.forEach((event) => {
    const item = document.createElement("article");
    item.className = "history-item";
    item.innerHTML = `
      <h3>${event.title}</h3>
      <p>${event.script}</p>
      <small>${event.place_name}, ${event.region}</small>
    `;
    container.appendChild(item);
  });
}

async function refreshHistory() {
  const query = encodeURIComponent(byId("search-query").value || "");
  const data = await requestJson(`/api/history?q=${query}`);
  renderHistory(data.events || []);
}

async function handleLocation(position) {
  if (!state.tripId) {
    return;
  }
  const activeTripId = state.tripId;
  const payload = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    speed_kph: position.coords.speed ? position.coords.speed * 3.6 : null,
    heading_deg: position.coords.heading,
  };
  setText(
    "coords-status",
    `${payload.latitude.toFixed(4)}, ${payload.longitude.toFixed(4)}`
  );
  const data = await requestJson(`/api/trips/${activeTripId}/locations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (state.tripId !== activeTripId) {
    return;
  }
  const place = data.current_place;
  setText("current-place-name", `${place.name}, ${place.region}`);
  setText(
    "current-place-details",
    [
      place.population ? `${place.population.toLocaleString()} people` : "",
      place.known_for ? `Known for ${place.known_for}` : "",
      place.history ? `History: ${place.history}` : "",
    ]
      .filter(Boolean)
      .join(" • ")
  );
  renderNearbyTowns(data.nearby_towns || []);
  renderMap(data, payload);
  setText("decision-reason", data.decision.reason.replace(/_/g, " "));
  if (data.event) {
    appendFeed(data.event);
    speak(data.event.script);
    highlightDiscoveredPlace(
      {
        name: data.event.place_name,
        region: data.event.region,
        latitude: data.event.latitude,
        longitude: data.event.longitude,
      },
      "town"
    );
    refreshHistory().catch(() => {});
  } else {
    setText("audio-status", state.speakAloud ? "Waiting" : "Muted");
  }
}

function handleLocationError(error) {
  setText("trip-status", `Location error: ${error.message}`);
}

async function startTrip() {
  const selectedLlmModel = byId("llm-model-select").value;
  const payload = {
    name: byId("trip-name").value || "Road Trip",
    settings: {
      narration_mode: byId("narration-mode").value,
      age_band: byId("age-band").value,
      save_history: byId("save-history").checked,
      live_providers: byId("data-mode").value === "live",
      llm_model: selectedLlmModel,
    },
  };
  const data = await requestJson("/api/trips", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.tripId = data.trip.id;
  state.speakAloud = byId("speak-aloud").checked;
  byId("start-trip").disabled = true;
  byId("stop-trip").disabled = false;
  setText("trip-status", `Running (#${state.tripId})`);
  if (!navigator.geolocation) {
    throw new Error("Geolocation is not available in this browser");
  }
  state.watchId = navigator.geolocation.watchPosition(handleLocation, handleLocationError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 5000,
  });
}

async function stopTrip() {
  const activeTripId = state.tripId;
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
  }
  state.audioGeneration += 1;
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  state.tripId = null;
  state.watchId = null;
  if (activeTripId) {
    await requestJson(`/api/trips/${activeTripId}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
  byId("start-trip").disabled = false;
  byId("stop-trip").disabled = true;
  setText("trip-status", "Stopped");
  setText("audio-status", "Ready");
  renderNearbyTowns([]);
}

async function loadFreeModels() {
  const select = byId("llm-model-select");
  const stored = getStoredLlmModel();
  const data = await requestJson("/api/llm/free-models");
  select.innerHTML = `<option value="">Default</option>`;
  (data.models || []).forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    if (model.id === stored) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function loadTtsOptions() {
  const select = byId("voice-select");
  const data = await requestJson("/api/tts/options");
  state.ttsProvider = data.provider || "browser";
  if (state.ttsProvider === "openai") {
    select.innerHTML = "";
    (data.voices || []).forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.name;
      select.appendChild(option);
    });
    setText("audio-status", "OpenAI TTS ready");
    return;
  }
  populateVoices();
}

byId("start-trip").addEventListener("click", () => {
  startTrip().catch((error) => {
    setText("trip-status", error.message);
  });
});
byId("stop-trip").addEventListener("click", () => {
  stopTrip().catch((error) => {
    setText("trip-status", error.message);
  });
});
byId("refresh-history").addEventListener("click", () => {
  refreshHistory().catch((error) => {
    setText("decision-reason", error.message);
  });
});
byId("search-button").addEventListener("click", () => {
  refreshHistory().catch((error) => {
    setText("decision-reason", error.message);
  });
});
byId("toggle-help").addEventListener("click", () => {
  state.helpOpen = !state.helpOpen;
  byId("help-panel").classList.toggle("hidden", !state.helpOpen);
  byId("help-panel").setAttribute("aria-hidden", String(!state.helpOpen));
});
byId("voice-select").addEventListener("change", (event) => {
  state.selectedVoiceName = event.target.value;
});
byId("llm-model-select").addEventListener("change", (event) => {
  setStoredLlmModel(event.target.value);
});

if ("speechSynthesis" in window) {
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}
ensureMap();
loadFreeModels().catch(() => {});
loadTtsOptions().catch(() => {});
refreshHistory().catch(() => {});
