import { haversineKm, sampleCoordinates, sortTownsAlongRoute } from "./core.js?v=20260814";

const DEFAULT_TIMEOUT_MS = 16000;

function parsePopulation(value) {
  const number = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function populationFromText(text) {
  const match = String(text || "").match(/population(?:\s+was|\s+of|:)?\s+(?:about\s+)?([\d,]+)/i);
  return match ? parsePopulation(match[1]) : null;
}

function coordinatesFor(element) {
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export class PublicDataClient {
  constructor(fetchImpl = globalThis.fetch) {
    // Window.fetch relies on its receiver in some browsers. Binding once also
    // keeps injected test implementations working without per-request wrappers.
    this.fetch = fetchImpl.bind(globalThis);
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async json(url, { cacheKey = url, ttlMs = 15 * 60 * 1000, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < ttlMs) return cached.value;
    if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Public data request returned ${response.status}`);
        const value = await response.json();
        this.cache.set(cacheKey, { savedAt: Date.now(), value });
        return value;
      } catch (error) {
        if (error?.name === "AbortError") throw new Error("The public data service took too long to respond");
        throw error;
      } finally {
        clearTimeout(timer);
        this.inFlight.delete(cacheKey);
      }
    })();
    this.inFlight.set(cacheKey, request);
    return request;
  }

  async reverseGeocode(latitude, longitude) {
    const cacheKey = `reverse:${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
    const primaryUrl = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    primaryUrl.search = new URLSearchParams({ latitude, longitude, localityLanguage: "en" });
    try {
      const data = await this.json(primaryUrl, { cacheKey, ttlMs: 24 * 60 * 60 * 1000 });
      const informative = data.localityInfo?.informative || [];
      const nearbyHints = informative
        .filter((item) => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        .slice(0, 6)
        .map((item) => ({
          name: item.name,
          kind: item.description || item.order || "local place",
          blurb: item.description || "A nearby place",
          latitude: item.latitude,
          longitude: item.longitude,
        }));
      return {
        name: data.city || data.locality || data.localityInfo?.administrative?.find((item) => item.name)?.name || "Selected location",
        region: data.principalSubdivision || "",
        country: data.countryName || "",
        latitude,
        longitude,
        description: data.postcode ? `Postal area ${data.postcode}.` : "",
        nearbyHints,
        source: "BigDataCloud",
      };
    } catch {
      const fallbackUrl = new URL("https://nominatim.openstreetmap.org/reverse");
      fallbackUrl.search = new URLSearchParams({ format: "jsonv2", lat: latitude, lon: longitude, zoom: 10, addressdetails: 1 });
      const data = await this.json(fallbackUrl, { cacheKey: `${cacheKey}:fallback`, ttlMs: 24 * 60 * 60 * 1000 });
      const address = data.address || {};
      return {
        name: address.city || address.town || address.village || address.hamlet || address.county || "Selected location",
        region: address.state || address.region || "",
        country: address.country || "",
        latitude,
        longitude,
        description: data.display_name || "",
        nearbyHints: [],
        source: "OpenStreetMap",
      };
    }
  }

  async wikipediaSummary(place) {
    const query = [place.name, place.region].filter(Boolean).join(" ");
    if (!query) return null;
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      origin: "*",
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "0",
      gsrlimit: "1",
      prop: "extracts|info|pageimages",
      exintro: "1",
      explaintext: "1",
      exsentences: "4",
      inprop: "url",
      piprop: "thumbnail",
      pithumbsize: "900",
    });
    const data = await this.json(url, { cacheKey: `wiki:${query.toLowerCase()}`, ttlMs: 7 * 24 * 60 * 60 * 1000 });
    const page = Object.values(data.query?.pages || {})[0];
    if (!page?.extract) return null;
    return {
      title: page.title,
      extract: page.extract,
      url: page.fullurl || `https://en.wikipedia.org/?curid=${page.pageid}`,
      thumbnail: page.thumbnail?.source || "",
      population: populationFromText(page.extract),
    };
  }

  async nearbyPlaces(latitude, longitude) {
    const query = `[out:json][timeout:18];(
      nwr["tourism"~"attraction|museum|viewpoint|gallery|zoo"](around:12000,${latitude},${longitude});
      nwr["historic"]["name"](around:12000,${latitude},${longitude});
      nwr["natural"~"peak|water|wood"]["name"](around:12000,${latitude},${longitude});
    );out center 45;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const data = await this.json(url, {
      cacheKey: `nearby:${latitude.toFixed(2)}:${longitude.toFixed(2)}`,
      ttlMs: 12 * 60 * 60 * 1000,
      timeoutMs: 22000,
    });
    const seen = new Set();
    return (data.elements || [])
      .map((element) => {
        const coordinates = coordinatesFor(element);
        const name = element.tags?.name;
        if (!coordinates || !name) return null;
        const kind = element.tags.tourism || element.tags.historic || element.tags.natural || "landmark";
        return {
          ...coordinates,
          name,
          kind: String(kind).replaceAll("_", " "),
          blurb: element.tags.description || element.tags["description:en"] || `A nearby ${String(kind).replaceAll("_", " ")}`,
          distanceKm: haversineKm({ latitude, longitude }, coordinates),
        };
      })
      .filter((place) => {
        if (!place) return false;
        const key = place.name.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);
  }

  async planRoute(waypoints) {
    const coordinateString = waypoints.map((point) => `${point.longitude},${point.latitude}`).join(";");
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coordinateString}`);
    url.search = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "false" });
    const data = await this.json(url, { cacheKey: `route:${coordinateString}`, ttlMs: 60 * 60 * 1000, timeoutMs: 26000 });
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error("A drivable route could not be found between those points");
    return {
      geometry: route.geometry.coordinates,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      source: "OSRM",
    };
  }

  async townsAlongRoute(coordinates) {
    const samples = sampleCoordinates(coordinates, 45, 32);
    const selectors = samples
      .map(([longitude, latitude]) => `nwr["place"~"city|town|village"]["name"](around:15000,${latitude},${longitude});`)
      .join("\n");
    const query = `[out:json][timeout:24];(${selectors});out center tags;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    try {
      const data = await this.json(url, { cacheKey: `towns:${samples.map((point) => point.map((value) => value.toFixed(2)).join(",")).join(";")}`, ttlMs: 24 * 60 * 60 * 1000, timeoutMs: 30000 });
      const towns = (data.elements || []).map((element) => {
        const point = coordinatesFor(element);
        if (!point || !element.tags?.name) return null;
        return {
          ...point,
          name: element.tags.name,
          region: element.tags["addr:state"] || element.tags["is_in:state"] || "",
          population: parsePopulation(element.tags.population),
          kind: element.tags.place || "town",
          source: "OpenStreetMap",
          status: "ready",
        };
      }).filter(Boolean);
      return sortTownsAlongRoute(towns, coordinates);
    } catch {
      const fallbackSamples = sampleCoordinates(coordinates, 140, 10);
      const towns = [];
      for (const [longitude, latitude] of fallbackSamples) {
        try {
          towns.push(await this.reverseGeocode(latitude, longitude));
        } catch {
          // Continue: a partial itinerary is more useful than dropping the route.
        }
      }
      return sortTownsAlongRoute(towns.map((town) => ({ ...town, status: "ready" })), coordinates, 12);
    }
  }
}
