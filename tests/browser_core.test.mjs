import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNarration,
  exportTripMarkdown,
  haversineKm,
  sampleCoordinates,
  searchEvents,
  shouldNarrate,
  sortTownsAlongRoute,
} from "../docs/js/core.js";
import { TripStore } from "../docs/js/store.js";

test("haversineKm returns realistic great-circle distance", () => {
  const chicago = { latitude: 41.8781, longitude: -87.6298 };
  const milwaukee = { latitude: 43.0389, longitude: -87.9065 };
  assert.ok(Math.abs(haversineKm(chicago, milwaukee) - 131) < 3);
});

test("narration adapts to mode and audience", () => {
  const place = { name: "Duluth", region: "Minnesota", population: 86697 };
  const summary = "Duluth is a port city on Lake Superior. It became important through shipping and railroads.";
  const quick = buildNarration({ place, summary, mode: "quick", ageBand: "adult" });
  const young = buildNarration({ place, summary, mode: "storyteller", ageBand: "early_elementary" });
  assert.match(quick.title, /quick/i);
  assert.match(young.script, /Look out the window/);
  assert.ok(quick.script.length < young.script.length);
});

test("relevance narrates a new place but throttles a nearby repeat", () => {
  const previous = {
    place: { name: "Madison", region: "Wisconsin", latitude: 43.0731, longitude: -89.4012 },
    timestamp: Date.now() - 30_000,
  };
  const repeat = shouldNarrate({ current: { ...previous.place, latitude: 43.074 }, previous });
  const newPlace = shouldNarrate({ current: { name: "Sun Prairie", region: "Wisconsin", latitude: 43.1836, longitude: -89.2137 }, previous });
  assert.equal(repeat.narrate, false);
  assert.equal(newPlace.narrate, true);
});

test("route sampling keeps endpoints and honors its cap", () => {
  const coordinates = Array.from({ length: 1000 }, (_, index) => [-100 + index * 0.01, 40]);
  const sampled = sampleCoordinates(coordinates, 1, 20);
  assert.deepEqual(sampled[0], coordinates[0]);
  assert.deepEqual(sampled.at(-1), coordinates.at(-1));
  assert.equal(sampled.length, 20);
});

test("towns are de-duplicated and ordered along the route", () => {
  const geometry = [[-90, 40], [-89, 40], [-88, 40]];
  const towns = [
    { name: "East", region: "IL", latitude: 40, longitude: -88.1 },
    { name: "West", region: "IL", latitude: 40, longitude: -89.9 },
    { name: "West", region: "IL", latitude: 40.01, longitude: -89.91 },
  ];
  const ordered = sortTownsAlongRoute(towns, geometry);
  assert.deepEqual(ordered.map((town) => town.name), ["West", "East"]);
});

test("history search and Markdown export remain local and readable", () => {
  const events = [{ title: "Lake story", script: "A shipping harbor.", placeName: "Duluth", region: "Minnesota", tags: ["water"] }];
  assert.equal(searchEvents(events, "harbor").length, 1);
  assert.equal(searchEvents(events, "desert").length, 0);
  const markdown = exportTripMarkdown({ name: "North Shore", createdAt: "2026-08-14T12:00:00Z", settings: { tripMode: "drive" }, events: [{ ...events[0], recordedAt: "2026-08-14T12:10:00Z", sourceUrl: "https://example.com" }] });
  assert.match(markdown, /^# North Shore/m);
  assert.match(markdown, /\[Source\]\(https:\/\/example.com\)/);
});

test("TripStore caps, searches, and clears browser history", () => {
  const values = new Map();
  const memoryStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const tripStore = new TripStore(memoryStorage);
  tripStore.createTrip("Test drive", { tripMode: "drive" });
  tripStore.addEvent({ title: "Hello Waco", script: "A Texas story", placeName: "Waco", region: "Texas" });
  assert.equal(tripStore.events("texas").length, 1);
  tripStore.clearHistory();
  assert.equal(tripStore.events().length, 0);
});
