const state = {
  tripId: null,
  watchId: null,
  speakAloud: true,
  helpOpen: false,
  settingsOpen: false,
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
  userNarrationActive: false,
  tripMode: "drive",
  planMarkers: [],
  plotWaypoints: [],
  plotWaypointMarkers: [],
  plotRouteId: null,
  plotRouteLine: null,
  plotTownMarkers: [],
  plotPollTimer: null,
  plotRoute: null,
};

function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return "mobile";
  if (/Macintosh/i.test(ua)) return "mac";
  return "desktop";
}

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

async function speak(script, onEnd) {
  if (!state.speakAloud) {
    setText("audio-status", "Muted");
    if (onEnd) onEnd();
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
      if (onEnd) onEnd();
      return;
    }
    if (!data.fallback && data.audio_base64) {
      const audio = new Audio(`data:${data.mime_type};base64,${data.audio_base64}`);
      state.currentAudio = audio;
      if (onEnd) {
        audio.addEventListener("ended", onEnd, { once: true });
      }
      audio.play().catch(() => {
        setText("audio-status", "Audio blocked");
        if (onEnd) onEnd();
      });
      setText("audio-status", data.voice ? `Speaking (${data.voice})` : "Speaking");
      return;
    }
  }
  if (!("speechSynthesis" in window)) {
    setText("audio-status", "No audio provider");
    if (onEnd) onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(script);
  const voice = chooseVoice();
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  if (onEnd) {
    utterance.onend = onEnd;
  }
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

function showMapLoading() {
  byId("map-loading").classList.remove("hidden");
}

function hideMapLoading() {
  byId("map-loading").classList.add("hidden");
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
    plan: L.layerGroup().addTo(state.map),
    plotWaypoints: L.layerGroup().addTo(state.map),
    plotRoute: L.layerGroup().addTo(state.map),
    plotTowns: L.layerGroup().addTo(state.map),
  };
  state.map.on("click", (event) => {
    if (state.tripMode === "plot_trip") {
      addPlotWaypoint(event.latlng.lat, event.latlng.lng);
      return;
    }
    narrateMapLocation({
      latitude: event.latlng.lat,
      longitude: event.latlng.lng,
    }).catch((error) => {
      setText("decision-reason", error.message);
    });
  });
  state.mapReady = true;
}

function addPlanMarker(latitude, longitude, name) {
  if (!state.mapLayers) return;
  const marker = L.marker([latitude, longitude], {
    icon: L.divIcon({
      className: "plan-marker",
      html: `<span class="plan-marker-dot"></span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    }),
  }).addTo(state.mapLayers.plan);
  marker.bindPopup(name);
  state.planMarkers.push(marker);
}

function clearPlanMarkers() {
  state.planMarkers.forEach((m) => state.mapLayers.plan.removeLayer(m));
  state.planMarkers = [];
}

function clearPlotRouteDisplay() {
  if (state.plotPollTimer) {
    window.clearInterval(state.plotPollTimer);
    state.plotPollTimer = null;
  }
  if (state.mapLayers) {
    state.mapLayers.plotWaypoints.clearLayers();
    state.mapLayers.plotRoute.clearLayers();
    state.mapLayers.plotTowns.clearLayers();
  }
  const itinerary = byId("plot-itinerary");
  const itineraryList = byId("plot-itinerary-list");
  if (itinerary && itineraryList) {
    itinerary.classList.add("hidden");
    itinerary.setAttribute("aria-hidden", "true");
    itineraryList.innerHTML = "";
  }
  state.plotWaypointMarkers = [];
  state.plotRouteLine = null;
  state.plotTownMarkers = [];
  state.plotRouteId = null;
  state.plotRoute = null;
  setText("plot-route-summary", "No plotted route yet.");
}

function resetPlotTrip() {
  state.plotWaypoints = [];
  clearPlotRouteDisplay();
  renderPlotWaypointList();
  setText("plot-route-status", "Click the map to add at least two points.");
}

function addPlotWaypoint(latitude, longitude) {
  ensureMap();
  const waypoint = {
    name: `Point ${state.plotWaypoints.length + 1}`,
    latitude,
    longitude,
  };
  state.plotWaypoints.push(waypoint);
  renderPlotWaypointList();
  renderPlotWaypointMarkers();
  setText("plot-route-status", `${state.plotWaypoints.length} point${state.plotWaypoints.length === 1 ? "" : "s"} selected.`);
}

function removePlotWaypoint(index) {
  state.plotWaypoints.splice(index, 1);
  state.plotWaypoints.forEach((waypoint, nextIndex) => {
    waypoint.name = `Point ${nextIndex + 1}`;
  });
  clearPlotRouteDisplay();
  renderPlotWaypointList();
  renderPlotWaypointMarkers();
}

function renderPlotWaypointList() {
  const list = byId("plot-waypoint-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.plotWaypoints.length) {
    list.innerHTML = `<p class="empty-state">No points selected.</p>`;
  } else {
    state.plotWaypoints.forEach((waypoint, index) => {
      const item = document.createElement("div");
      item.className = "waypoint-item";
      item.innerHTML = `
        <strong>${waypoint.name}</strong>
        <span>${waypoint.latitude.toFixed(4)}, ${waypoint.longitude.toFixed(4)}</span>
        <button class="icon-button" type="button">Remove</button>
      `;
      item.querySelector("button").addEventListener("click", () => removePlotWaypoint(index));
      list.appendChild(item);
    });
  }
  byId("submit-plot-trip").disabled = state.tripMode !== "plot_trip" || state.plotWaypoints.length < 2;
}

function renderPlotWaypointMarkers() {
  ensureMap();
  if (!state.mapLayers) return;
  state.mapLayers.plotWaypoints.clearLayers();
  state.plotWaypointMarkers = [];
  state.plotWaypoints.forEach((waypoint, index) => {
    const marker = L.marker([waypoint.latitude, waypoint.longitude], {
      icon: L.divIcon({
        className: "plot-waypoint-marker",
        html: `<span>${index + 1}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(state.mapLayers.plotWaypoints);
    marker.bindPopup(waypoint.name);
    state.plotWaypointMarkers.push(marker);
  });
}

function routeTownColor(status) {
  if (status === "done") return { color: "#15803d", fillColor: "#22c55e" };
  if (status === "researching") return { color: "#b91c1c", fillColor: "#ef4444" };
  if (status === "failed") return { color: "#a16207", fillColor: "#facc15" };
  return { color: "#475569", fillColor: "#94a3b8" };
}

function renderPlottedRoute(route) {
  ensureMap();
  if (!state.mapLayers || !route) return;
  state.plotRoute = route;
  state.plotRouteId = route.id;
  state.mapLayers.plotRoute.clearLayers();
  state.mapLayers.plotTowns.clearLayers();
  const latlngs = (route.geometry || []).map((point) => [point.latitude, point.longitude]);
  if (latlngs.length) {
    state.plotRouteLine = L.polyline(latlngs, {
      color: "#38bdf8",
      weight: 5,
      opacity: 0.82,
    }).addTo(state.mapLayers.plotRoute);
    state.map.fitBounds(state.plotRouteLine.getBounds(), { padding: [28, 28] });
  }
  state.plotTownMarkers = [];
  (route.towns || []).forEach((town) => {
    const colors = routeTownColor(town.status);
    const marker = L.circleMarker([town.latitude, town.longitude], {
      radius: town.status === "researching" ? 9 : 7,
      color: colors.color,
      fillColor: colors.fillColor,
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(state.mapLayers.plotTowns);
    marker.bindPopup(
      `<strong>${town.name}</strong><br>${town.region}<br>Population: ${(town.population || 0).toLocaleString()}<br>Status: ${town.status}`
    );
    marker.on("click", () => {
      narrateTownNow(town).catch((error) => {
        setText("plot-route-status", error.message);
      });
    });
    state.plotTownMarkers.push(marker);
  });
  renderPlotItinerary(route);
  const done = (route.towns || []).filter((town) => town.status === "done").length;
  const researching = (route.towns || []).filter((town) => town.status === "researching").length;
  setText("plot-route-status", `Route ${route.status}${researching ? " – researching now" : ""}`);
  setText(
    "plot-route-summary",
    `${Math.round((route.distance_m || 0) / 1000).toLocaleString()} km • ${route.towns.length} towns • ${done} gathered`
  );
}

function renderPlotItinerary(route) {
  const panel = byId("plot-itinerary");
  const list = byId("plot-itinerary-list");
  if (!panel || !list) return;
  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  list.innerHTML = "";
  const towns = route.towns || [];
  if (!towns.length) {
    list.innerHTML = `<p class="empty-state">No towns found along this route corridor.</p>`;
    return;
  }
  towns.forEach((town, index) => {
    const item = document.createElement("article");
    item.className = `itinerary-item status-${town.status}`;
    const narration = town.research && town.research.narration ? town.research.narration.script : "";
    item.innerHTML = `
      <div>
        <p class="feed-kicker">${index + 1}. ${town.status}</p>
        <h3>${town.name}, ${town.region}</h3>
        <p>${(town.population || 0).toLocaleString()} people • ${town.distance_km} km from route</p>
        ${narration ? `<small>${narration}</small>` : ""}
      </div>
      <button class="icon-button" type="button">Narrate</button>
    `;
    item.querySelector("button").addEventListener("click", () => {
      narrateTownNow(town).catch((error) => {
        setText("plot-route-status", error.message);
      });
    });
    list.appendChild(item);
  });
}

async function ensurePlotTripCreated() {
  if (state.tripId) {
    return state.tripId;
  }
  const selectedLlmModel = byId("llm-model-select").value;
  const payload = {
    name: byId("trip-name").value || "Plotted Trip",
    settings: {
      narration_mode: byId("narration-mode").value,
      age_band: byId("age-band").value,
      trip_mode: "plot_trip",
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
  setText("trip-status", `Plotting (#${state.tripId})`);
  setText("coords-status", "Plot trip mode");
  setText("audio-status", "Ready");
  return state.tripId;
}

async function submitPlotTrip() {
  if (state.plotWaypoints.length < 2) {
    setText("plot-route-status", "Choose at least two map points first.");
    return;
  }
  byId("submit-plot-trip").disabled = true;
  setText("plot-route-status", "Planning route...");
  const tripId = await ensurePlotTripCreated();
  const data = await requestJson(`/api/trips/${tripId}/plot-routes`, {
    method: "POST",
    body: JSON.stringify({
      name: byId("trip-name").value || "Plotted Trip",
      waypoints: state.plotWaypoints,
      min_population: 200,
      corridor_km: 12,
    }),
  });
  renderPlottedRoute(data.route);
  pollPlottedRoute();
}

async function pollPlottedRoute() {
  if (!state.tripId || !state.plotRouteId) return;
  const activeTripId = state.tripId;
  const activeRouteId = state.plotRouteId;
  if (state.plotPollTimer) {
    window.clearInterval(state.plotPollTimer);
  }
  const poll = async () => {
    if (state.tripId !== activeTripId || state.plotRouteId !== activeRouteId) {
      return;
    }
    const data = await requestJson(`/api/trips/${activeTripId}/plot-routes/${activeRouteId}`);
    renderPlottedRoute(data.route);
    if (data.route.status === "done" || data.route.status === "failed") {
      window.clearInterval(state.plotPollTimer);
      state.plotPollTimer = null;
      byId("submit-plot-trip").disabled = state.plotWaypoints.length < 2;
      refreshHistory().catch(() => {});
    }
  };
  await poll().catch((error) => setText("plot-route-status", error.message));
  state.plotPollTimer = window.setInterval(() => {
    poll().catch((error) => setText("plot-route-status", error.message));
  }, 2500);
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
    marker.bindPopup(`<strong>${town.name}</strong><br>${town.region}<br>${town.distance_km} km away${town.high_school_enrollment ? '<br>HS enrollment: ' + town.high_school_enrollment.toLocaleString() : ''}`);
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
  if (!list) return;
  list.innerHTML = "";
  if (!towns || !towns.length) {
    setText("upcoming-name", "No nearby towns yet");
    setText("upcoming-details", state.tripMode === "plan" ? "Click the map to explore places and build your itinerary." : "Drive a little farther to build a nearby-town queue.");
    return;
  }
  setText("upcoming-name", `${towns.length} nearby towns`);
  setText("upcoming-details", "Tap a town to narrate it now, or let it trigger when you arrive nearby.");
  towns.forEach((town) => {
    const button = document.createElement("button");
    button.className = "town-chip";
    button.type = "button";
    const enrollmentText = town.high_school_enrollment
      ? ` • HS: ${town.high_school_enrollment.toLocaleString()}`
      : "";
    button.innerHTML = `<strong>${town.name}</strong><span>${town.region} • ${town.distance_km} km${enrollmentText}</span>`;
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
    state.userNarrationActive = true;
    speak(data.event.script, () => {
      state.userNarrationActive = false;
    });
    setTimeout(() => { state.userNarrationActive = false; }, 60000);
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
  showMapLoading();
  try {
    const data = await requestJson(`/api/trips/${state.tripId}/narrate-place`, {
      method: "POST",
      body: JSON.stringify(location),
    });
    if (data.event) {
      appendFeed(data.event);
      state.userNarrationActive = true;
      speak(data.event.script, () => {
        state.userNarrationActive = false;
      });
      setTimeout(() => { state.userNarrationActive = false; }, 60000);
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
      if (state.tripMode === "plan") {
        addPlanMarker(data.selected_place.latitude, data.selected_place.longitude, data.selected_place.name);
      }
      refreshHistory().catch(() => {});
    }
  } finally {
    hideMapLoading();
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
  if (!state.userNarrationActive) {
    renderMap(data, payload);
  }
  setText("decision-reason", data.decision.reason.replace(/_/g, " "));
  if (data.event) {
    appendFeed(data.event);
    if (!state.userNarrationActive) {
      speak(data.event.script);
    }
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
  const tripMode = byId("trip-mode").value;
  state.tripMode = tripMode;
  const selectedLlmModel = byId("llm-model-select").value;
  const payload = {
    name: byId("trip-name").value || "Road Trip",
    settings: {
      narration_mode: byId("narration-mode").value,
      age_band: byId("age-band").value,
      trip_mode: tripMode,
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
  if (tripMode === "plan") {
    setText("trip-status", `Planning (#${state.tripId})`);
    setText("coords-status", "Plan mode");
    setText("audio-status", "Ready");
    setText("decision-reason", "Plan mode – click the map");
    return;
  }
  if (tripMode === "plot_trip") {
    byId("plot-trip-panel").classList.remove("hidden");
    byId("plot-trip-panel").setAttribute("aria-hidden", "false");
    renderPlotWaypointList();
    renderPlotWaypointMarkers();
    setText("trip-status", `Plotting (#${state.tripId})`);
    setText("coords-status", "Plot trip mode");
    setText("audio-status", "Ready");
    setText("decision-reason", "Plot trip mode – choose route points");
    return;
  }
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
  clearPlanMarkers();
  resetPlotTrip();
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
}

async function clearHistory() {
  if (!state.tripId) {
    setText("decision-reason", "No active trip");
    return;
  }
  if (!window.confirm("Clear all history for this trip?")) {
    return;
  }
  await fetch(`/api/trips/${state.tripId}/events`, { method: "DELETE" });
  byId("feed").innerHTML = "";
  byId("history-results").innerHTML = `<p class="empty-state">History cleared.</p>`;
  setText("decision-reason", "History cleared");
}

async function loadFreeModels() {
  const select = byId("llm-model-select");
  const stored = getStoredLlmModel();
  const data = await requestJson("/api/llm/free-models");
  const defaultLabel = data.default_model
    ? `Default (${data.default_model})`
    : "Default";
  select.innerHTML = `<option value="">${defaultLabel}</option>`;
  const openrouterModels = [];
  const openaiModels = [];
  (data.models || []).forEach((model) => {
    if (model.id.startsWith("openai:")) {
      openaiModels.push(model);
    } else {
      openrouterModels.push(model);
    }
  });
  if (openrouterModels.length) {
    const group = document.createElement("optgroup");
    group.label = "OpenRouter";
    openrouterModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      if (model.id === stored) {
        option.selected = true;
      }
      group.appendChild(option);
    });
    select.appendChild(group);
  }
  if (openaiModels.length) {
    const group = document.createElement("optgroup");
    group.label = "OpenAI";
    openaiModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      if (model.id === stored) {
        option.selected = true;
      }
      group.appendChild(option);
    });
    select.appendChild(group);
  }
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

function updateTripModeHint() {
  const mode = byId("trip-mode").value;
  const hint = byId("trip-hint");
  byId("plot-trip-panel").classList.toggle("hidden", mode !== "plot_trip");
  byId("plot-trip-panel").setAttribute("aria-hidden", String(mode !== "plot_trip"));
  if (mode === "plan") {
    hint.textContent = "Plan mode: no GPS needed. Click locations on the map to build your itinerary.";
  } else if (mode === "plot_trip") {
    hint.textContent = "Plot Trip mode: click multiple map points, then submit to calculate the driving route and research towns along it.";
    renderPlotWaypointList();
  } else {
    hint.textContent = "Tip: the browser will ask for location access when the trip starts. Narration begins only after you allow it.";
  }
}

byId("trip-mode").addEventListener("change", () => {
  state.tripMode = byId("trip-mode").value;
  updateTripModeHint();
});

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
byId("clear-history").addEventListener("click", () => {
  clearHistory().catch((error) => {
    setText("decision-reason", error.message);
  });
});
byId("search-button").addEventListener("click", () => {
  refreshHistory().catch((error) => {
    setText("decision-reason", error.message);
  });
});
byId("submit-plot-trip").addEventListener("click", () => {
  submitPlotTrip().catch((error) => {
    setText("plot-route-status", error.message);
    byId("submit-plot-trip").disabled = state.plotWaypoints.length < 2;
  });
});
byId("clear-plot-trip").addEventListener("click", () => {
  resetPlotTrip();
});
byId("toggle-help").addEventListener("click", () => {
  state.helpOpen = !state.helpOpen;
  byId("help-panel").classList.toggle("hidden", !state.helpOpen);
  byId("help-panel").setAttribute("aria-hidden", String(!state.helpOpen));
});
byId("toggle-settings").addEventListener("click", () => {
  state.settingsOpen = !state.settingsOpen;
  byId("settings-dropdown").classList.toggle("hidden", !state.settingsOpen);
  byId("settings-dropdown").setAttribute("aria-hidden", String(!state.settingsOpen));
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

(function initPlatformDefaults() {
  const platform = detectPlatform();
  const defaultMode = platform === "mac" ? "plan" : "drive";
  state.tripMode = defaultMode;
  byId("trip-mode").value = defaultMode;
  updateTripModeHint();
})();

ensureMap();
renderPlotWaypointList();
loadFreeModels().catch(() => {});
loadTtsOptions().catch(() => {});
refreshHistory().catch(() => {});
