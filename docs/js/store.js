import { makeId, searchEvents } from "./core.js?v=20260901";

const STORAGE_KEY = "roadtripper-browser-state-v1";
const MAX_TRIPS = 20;
const MAX_EVENTS_PER_TRIP = 250;
const MAX_ROUTE_POINTS = 500;

function slimGeometry(geometry = []) {
  if (geometry.length <= MAX_ROUTE_POINTS) return geometry;
  const step = (geometry.length - 1) / (MAX_ROUTE_POINTS - 1);
  return Array.from({ length: MAX_ROUTE_POINTS }, (_, index) => geometry[Math.round(index * step)]);
}

function emptyState() {
  return { version: 1, activeTripId: null, trips: [] };
}

export class TripStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.state = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(this.storage?.getItem(STORAGE_KEY) || "null");
      if (parsed?.version === 1 && Array.isArray(parsed.trips)) return parsed;
    } catch {
      // A corrupt browser record should never prevent the app from starting.
    }
    return emptyState();
  }

  #write() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      if (error?.name !== "QuotaExceededError") throw error;
      this.state.trips = this.state.trips.slice(0, 5).map((trip) => ({ ...trip, events: trip.events.slice(0, 75) }));
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    }
  }

  createTrip(name, settings) {
    const trip = {
      id: makeId("trip"),
      name: String(name || "Road trip").trim() || "Road trip",
      createdAt: new Date().toISOString(),
      stoppedAt: null,
      settings: { ...settings },
      events: [],
      route: null,
    };
    this.state.trips.unshift(trip);
    this.state.trips = this.state.trips.slice(0, MAX_TRIPS);
    this.state.activeTripId = trip.id;
    this.#write();
    return trip;
  }

  getActiveTrip() {
    return this.state.trips.find((trip) => trip.id === this.state.activeTripId) || null;
  }

  stopActiveTrip() {
    const trip = this.getActiveTrip();
    if (trip) trip.stoppedAt = new Date().toISOString();
    this.state.activeTripId = null;
    this.#write();
    return trip;
  }

  addEvent(event) {
    const trip = this.getActiveTrip();
    if (!trip) return null;
    const stored = { id: makeId("story"), recordedAt: new Date().toISOString(), ...event };
    trip.events.unshift(stored);
    trip.events = trip.events.slice(0, MAX_EVENTS_PER_TRIP);
    this.#write();
    return stored;
  }

  setRoute(route) {
    const trip = this.getActiveTrip();
    if (!trip) return;
    trip.route = { ...route, geometry: slimGeometry(route.geometry) };
    this.#write();
  }

  events(query = "") {
    const events = this.state.trips.flatMap((trip) => trip.events.map((event) => ({ ...event, tripName: trip.name })));
    return searchEvents(events, query).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
  }

  clearHistory() {
    this.state.trips.forEach((trip) => { trip.events = []; });
    this.#write();
  }
}
