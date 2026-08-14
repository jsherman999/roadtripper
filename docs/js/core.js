const EARTH_RADIUS_KM = 6371.0088;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function haversineKm(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(Number(a.latitude));
  const lat2 = toRadians(Number(b.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(Number(b.longitude) - Number(a.longitude));
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const root = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(root)));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "Distance unavailable";
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles).toLocaleString()} mi`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Time unavailable";
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

export function formatPopulation(population) {
  const value = Number(population);
  return Number.isFinite(value) && value > 0 ? value.toLocaleString() : "Population unavailable";
}

export function placeKey(place) {
  const name = String(place?.name || "").trim().toLowerCase();
  const region = String(place?.region || "").trim().toLowerCase();
  if (name) return `${name}|${region}`;
  const latitude = Number(place?.latitude || 0).toFixed(2);
  const longitude = Number(place?.longitude || 0).toFixed(2);
  return `${latitude}|${longitude}`;
}

function sentenceList(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function conciseSummary(text, limit) {
  const sentences = sentenceList(text);
  const selected = sentences.slice(0, limit).join(" ").trim();
  return selected.length <= 560 ? selected : `${selected.slice(0, 557).trimEnd()}…`;
}

export function buildNarration({ place, summary = "", nearby = [], mode = "storyteller", ageBand = "adult" }) {
  const name = place?.name || "this place";
  const region = place?.region ? `, ${place.region}` : "";
  const population = Number(place?.population);
  const intro = `We are near ${name}${region}.`;
  const fact = conciseSummary(summary || place?.description, mode === "quick" ? 1 : 2);
  const populationFact = Number.isFinite(population) && population > 0
    ? `${name} is home to about ${population.toLocaleString()} people.`
    : "";
  const nearbyFact = nearby.length
    ? `Nearby, keep an eye out for ${nearby.slice(0, 2).map((item) => item.name).join(" and ")}.`
    : "";

  let parts;
  if (mode === "quick") {
    parts = [intro, fact || populationFact, nearbyFact];
  } else if (mode === "history") {
    parts = [intro, fact || `${name} has a story shaped by the people and landscape around it.`, populationFact];
  } else {
    parts = [
      ageBand === "early_elementary" ? `Look out the window—we are near ${name}${region}!` : intro,
      fact || populationFact || `Every road through ${name} connects a local story to the wider region.`,
      nearbyFact,
    ];
  }

  let script = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (ageBand === "early_elementary") {
    script = script
      .replace(/approximately/gi, "about")
      .replace(/municipality/gi, "town")
      .replace(/population/gi, "people");
  }
  return {
    title: mode === "quick" ? `A quick look at ${name}` : mode === "history" ? `${name}: then and now` : `Passing through ${name}`,
    script,
  };
}

export function shouldNarrate({ current, previous, now = Date.now(), minimumMinutes = 4, minimumKm = 5 }) {
  if (!previous) return { narrate: true, reason: "First stop on this trip" };
  const newPlace = placeKey(current) !== placeKey(previous.place);
  const elapsedMinutes = Math.max(0, now - Number(previous.timestamp || 0)) / 60000;
  const distanceKm = haversineKm(current, previous.place);
  if (newPlace && (elapsedMinutes >= 1 || distanceKm >= 1.5)) {
    return { narrate: true, reason: "A new place came into view" };
  }
  if (elapsedMinutes >= minimumMinutes && distanceKm >= minimumKm) {
    return { narrate: true, reason: "Far enough from the last story" };
  }
  return {
    narrate: false,
    reason: `Waiting for ${Math.max(0, minimumKm - distanceKm).toFixed(1)} more km or ${Math.max(0, Math.ceil(minimumMinutes - elapsedMinutes))} min`,
  };
}

export function sampleCoordinates(coordinates, intervalKm = 40, maximum = 36) {
  if (!Array.isArray(coordinates) || coordinates.length <= 2) return coordinates || [];
  const sampled = [coordinates[0]];
  let distanceSinceSample = 0;
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    const previous = { longitude: coordinates[index - 1][0], latitude: coordinates[index - 1][1] };
    const current = { longitude: coordinates[index][0], latitude: coordinates[index][1] };
    distanceSinceSample += haversineKm(previous, current);
    if (distanceSinceSample >= intervalKm) {
      sampled.push(coordinates[index]);
      distanceSinceSample = 0;
    }
  }
  sampled.push(coordinates.at(-1));
  if (sampled.length <= maximum) return sampled;
  const step = (sampled.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => sampled[Math.round(index * step)]);
}

export function nearestRouteIndex(place, coordinates) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  coordinates.forEach((coordinate, index) => {
    const distance = haversineKm(place, { longitude: coordinate[0], latitude: coordinate[1] });
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return { index: bestIndex, distanceKm: bestDistance };
}

export function sortTownsAlongRoute(towns, coordinates, limit = 36) {
  const deduped = new Map();
  towns.forEach((town) => {
    const key = placeKey(town);
    const routePosition = nearestRouteIndex(town, coordinates);
    if (routePosition.distanceKm > 20) return;
    const existing = deduped.get(key);
    if (!existing || routePosition.distanceKm < existing.distanceKm) {
      deduped.set(key, { ...town, ...routePosition });
    }
  });
  return [...deduped.values()]
    .filter((town) => !Number.isFinite(Number(town.population)) || Number(town.population) >= 200)
    .sort((a, b) => a.index - b.index || a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

export function searchEvents(events, query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return [...events];
  return events.filter((event) => [event.title, event.script, event.placeName, event.region, ...(event.tags || [])]
    .some((value) => String(value || "").toLocaleLowerCase().includes(needle)));
}

function markdownText(value) {
  return String(value || "").replace(/[\\`*_{}[\]<>]/g, "\\$&");
}

export function exportTripMarkdown(trip) {
  const lines = [
    `# ${markdownText(trip.name || "RoadTripper journey")}`,
    "",
    `Started: ${new Date(trip.createdAt).toLocaleString()}`,
    `Mode: ${markdownText(trip.settings?.tripMode || "drive")}`,
    "",
  ];
  if (!trip.events?.length) {
    lines.push("No stories were saved for this trip.", "");
  } else {
    trip.events.forEach((event) => {
      lines.push(`## ${markdownText(event.title)}`, "");
      lines.push(`_${markdownText(event.placeName)}${event.region ? `, ${markdownText(event.region)}` : ""} · ${new Date(event.recordedAt).toLocaleString()}_`, "");
      lines.push(event.script, "");
      if (event.sourceUrl) lines.push(`[Source](${event.sourceUrl})`, "");
    });
  }
  return `${lines.join("\n").trim()}\n`;
}

export function makeId(prefix = "item") {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
}
