import { SiteLocation, fetchJson, isAbort } from "./core";
import { askOverpass } from "./osm";


// Accepts "lat, lon", a Google Maps / Apple Maps / OSM link, or a plain address (geocoded via OpenStreetMap).
// --- Address search (free, keyless; several providers so one outage or gap doesn't break search) ---
// (the free services ask for a fair use: the dialog asks once a pause in the typing, an older ask
// let go of; the browser sends the page as the Referer, which is what Nominatim asks a website for)

/** A place offered while typing: `kind` a disc golf course, a park or anything else (for the
 * order they're offered in, and the frame); `osmId` its OpenStreetMap id ("W123", for its outline). */
export type PlaceSuggestion = { text: string; detail?: string; lat?: number; lon?: number; magicKey?: string; kind?: PlaceKind; osmId?: string };
export type PlaceKind = "course" | "park" | "place";

export const isValidLatLon = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// Coordinates or a map link (Google/Apple/OSM) typed or pasted into the search box. No name
// comes with them (label ""): the course isn't named after numbers.
export const parseCoordinateInput = (text: string): SiteLocation | null => {
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // Google Maps pin
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // Google Maps view center
    /[?&](?:q|ll|query|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i, // ?q=lat,lon
    /[#&]map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/, // openstreetmap.org/#map=z/lat/lon
    /^\s*(-?\d+(?:\.\d+)?)°?\s*[, ]\s*(-?\d+(?:\.\d+)?)°?\s*$/ // "lat, lon"
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (isValidLatLon(lat, lon)) return { lat, lon, label: "" };
    }
  }
  return null;
};

export const ESRI_GEOCODER = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

// Esri World Geocoder: strongest for US street addresses, including rural routes.
export const esriFindCandidates = async (text: string, near?: { lat: number; lon: number }, magicKey?: string): Promise<SiteLocation[]> => {
  const params = new URLSearchParams({ SingleLine: text, f: "json", maxLocations: "5", outFields: "Match_addr,Addr_type" });
  if (magicKey) params.set("magicKey", magicKey);
  if (near) params.set("location", `${near.lon},${near.lat}`);
  const json = await fetchJson(`${ESRI_GEOCODER}/findAddressCandidates?${params.toString()}`);
  return (json.candidates ?? [])
    .filter((c: any) => c.score >= 70 && isValidLatLon(c.location?.y, c.location?.x))
    .map((c: any) => ({ lat: c.location.y, lon: c.location.x, label: c.address || text }));
};

// US Census geocoder: official US address ranges. Called via JSONP because it doesn't send CORS headers.
export const censusFindCandidates = (text: string): Promise<SiteLocation[]> =>
  new Promise((resolve, reject) => {
    const callback = `__censusGeocode${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      delete (window as any)[callback];
      script.remove();
      window.clearTimeout(timer);
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Census timeout")); }, 8000);
    (window as any)[callback] = (json: any) => {
      cleanup();
      const matches = json?.result?.addressMatches ?? [];
      resolve(matches
        .filter((m: any) => isValidLatLon(m.coordinates?.y, m.coordinates?.x))
        .map((m: any) => ({ lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress || text })));
    };
    script.onerror = () => { cleanup(); reject(new Error("Census unavailable")); };
    script.src = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${new URLSearchParams({
      address: text,
      benchmark: "Public_AR_Current",
      format: "jsonp",
      callback
    }).toString()}`;
    document.head.appendChild(script);
  });

/** What kind of place an OpenStreetMap tag makes it. */
const osmKind = (key?: string, value?: string): PlaceKind =>
  value === "disc_golf_course" ? "course" : key === "leisure" && /^(park|recreation_ground|nature_reserve|common)$/.test(value ?? "") ? "park" : key === "boundary" && value === "protected_area" ? "park" : "place";
/** What kind of place a name says it is (Esri's suggestions come with nothing else). */
export const kindFromName = (text: string): PlaceKind =>
  /disc golf|frisbee golf|\bdgc\b|\bdisc course\b/i.test(text) ? "course" : /\b(park|parks|recreation|preserve|reserve|nature area|arboretum|commons|forest|greenway)\b/i.test(text) ? "park" : "place";

// Photon (OpenStreetMap-based): good for places, roads and towns; supports a location bias.
export const photonSearch = async (text: string, near?: { lat: number; lon: number }, limit = 5, signal?: AbortSignal): Promise<PlaceSuggestion[]> => {
  const params = new URLSearchParams({ q: text, limit: String(limit), lang: "en" });
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lon));
  }
  const json = await fetchJson(`https://photon.komoot.io/api/?${params.toString()}`, 8000, signal);
  return (json.features ?? []).map((f: any) => {
    const p = f.properties ?? {};
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const title = p.name || street || p.city || text;
    const detail = [p.name && street ? street : null, p.city || p.county, p.state, p.postcode].filter(Boolean).join(", ");
    const osmId = p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : undefined;
    return { text: title, detail, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1], kind: osmKind(p.osm_key, p.osm_value), ...(osmId ? { osmId } : {}) };
  }).filter((s: PlaceSuggestion) => isValidLatLon(s.lat as number, s.lon as number));
};

/**
 * The name of the park (or the disc golf course, or another named place on the ground) at a spot,
 * from OpenStreetMap (Nominatim), or "" where there's none: coordinates and map links get a name
 * this way, but never a street address's.
 */
export const placeNameAt = async (lat: number, lon: number, signal?: AbortSignal): Promise<string> => {
  // Nominatim names the nearest thing (often the path or road through the park); Overpass says
  // which park or course the spot is inside: both at once, the course or park first
  const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lon), zoom: "17", namedetails: "0", addressdetails: "0" });
  const near = fetchJson(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, 4000, signal).then(json => {
    const category = String(json?.category ?? ""), type = String(json?.type ?? "");
    if (!json?.name || !/^(leisure|natural|landuse|boundary|tourism)$/.test(category)) return "";
    // (a town's boundary or a land use without its own name says nothing about the spot)
    if (category === "boundary" && type !== "protected_area" && type !== "national_park") return "";
    return String(json.name);
  }).catch(() => "");
  const inside = askOverpass(`[out:json][timeout:6];is_in(${lat},${lon})->.a;area.a[leisure~"^(disc_golf_course|park|recreation_ground|nature_reserve)$"][name];out tags;`, { timeoutMs: 6000, signal })
    .then(json => {
      const areas: { leisure: string; name: string }[] = (json.elements ?? []).map((e: any) => e.tags ?? {});
      const rank = ["disc_golf_course", "park", "recreation_ground", "nature_reserve"];
      return areas.sort((a, b) => rank.indexOf(a.leisure) - rank.indexOf(b.leisure))[0]?.name ?? "";
    })
    .catch(() => "");
  const [a, b] = await Promise.all([inside, near]);
  return a || b;
};

export const nominatimSearch = async (text: string): Promise<SiteLocation[]> => {
  const json = await fetchJson(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(text)}`);
  return (Array.isArray(json) ? json : [])
    .map((r: any) => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: r.display_name || text }))
    .filter((r: SiteLocation) => isValidLatLon(r.lat, r.lon));
};

/** Esri's suggestions while typing (addresses, and places by name). */
export const esriSuggest = async (text: string, near?: { lat: number; lon: number }, signal?: AbortSignal): Promise<PlaceSuggestion[]> => {
  const params = new URLSearchParams({ text, f: "json", maxSuggestions: "6" });
  if (near) params.set("location", `${near.lon},${near.lat}`);
  const json = await fetchJson(`${ESRI_GEOCODER}/suggest?${params.toString()}`, 5000, signal);
  return (json.suggestions ?? [])
    .filter((s: any) => !s.isCollection)
    .map((s: any) => {
      const [first, ...rest] = String(s.text).split(", ");
      return { text: first, detail: rest.join(", "), magicKey: s.magicKey, kind: kindFromName(String(s.text)) };
    });
};

/**
 * Suggestions merged from Esri (strong on addresses) and Photon (OpenStreetMap's places, with
 * where they are and what they are), both near `near`: disc golf courses first, then parks, then
 * the rest, each in the order the services gave; the same place from both once (Photon's, which
 * knows where it is). An address (it starts with a number) keeps Esri's order.
 */
export const rankSuggestions = (esri: PlaceSuggestion[], photon: PlaceSuggestion[], text: string, near?: { lat: number; lon: number }): PlaceSuggestion[] => {
  const same = (a: PlaceSuggestion, b: PlaceSuggestion) => a.text.trim().toLowerCase() === b.text.trim().toLowerCase();
  // (Photon's places far from where the map is, past 150 km, after Esri's, which are near by itself)
  const far = (s: PlaceSuggestion) => !!near && s.lat !== undefined && Math.hypot(s.lat - near.lat, ((s.lon as number) - near.lon) * Math.cos((near.lat * Math.PI) / 180)) > 1.35;
  const merged: PlaceSuggestion[] = [...esri.map(e => {
    const twin = photon.find(p => same(p, e) && !far(p));
    return twin ? { ...twin, magicKey: e.magicKey, kind: twin.kind !== "place" ? twin.kind : e.kind } : e;
  })];
  for (const p of photon) if (!merged.some(m => same(m, p) && (m.lat === undefined || Math.abs((m.lat ?? 0) - (p.lat ?? 0)) < 0.05))) merged.push(p);
  if (/^\s*\d/.test(text)) return merged.slice(0, 6);
  const rank = (s: PlaceSuggestion) => (s.kind === "course" ? 0 : s.kind === "park" ? 1 : 2) + (far(s) ? 3 : 0);
  return merged.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map(x => x.s).slice(0, 6);
};

/** What was offered for each text lately (the same text typed again asks no one). */
const suggested = new Map<string, PlaceSuggestion[]>();

// Suggestions while typing: Esri and Photon at once (Photon given a moment past Esri's answer),
// ranked for finding a park or a course near the map
export const fetchPlaceSuggestions = async (text: string, near?: { lat: number; lon: number }, opts: { signal?: AbortSignal } = {}): Promise<PlaceSuggestion[]> => {
  if (text.trim().length < 3 || parseCoordinateInput(text)) return [];
  const key = `${text.trim().toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ""}`;
  const had = suggested.get(key);
  if (had) return had;
  const quiet = <T,>(p: Promise<T[]>) => p.catch(err => { if (isAbort(err) && opts.signal?.aborted) throw err; return [] as T[]; });
  const photon = quiet(photonSearch(text, near, 6, opts.signal));
  // (stopped while Esri's answer is awaited, by the next letter typed: this one isn't waited on any
  // more, so its stop is caught here, not left for the page to report as an error)
  photon.catch(() => {});
  const esri = await quiet(esriSuggest(text, near, opts.signal));
  // (Photon a little longer than Esri, at most: a slow one doesn't hold up the list)
  const late = await Promise.race([photon, new Promise<PlaceSuggestion[] | null>(r => setTimeout(() => r(null), esri.length ? 700 : 4000))]);
  const list = rankSuggestions(esri, late ?? [], text, near);
  if (late !== null) {
    suggested.set(key, list);
    if (suggested.size > 60) suggested.delete(suggested.keys().next().value as string);
  }
  return list;
};

// Resolves typed text (or a picked suggestion) to a location, trying each provider in turn.
export const resolveSiteLocation = async (
  input: string,
  options?: { near?: { lat: number; lon: number }; suggestion?: PlaceSuggestion }
): Promise<SiteLocation> => {
  const text = input.trim();
  if (!text) throw new Error("Enter an address, coordinates, or a map link.");
  const coords = parseCoordinateInput(text);
  // (named for the park there, where there is one: never for the numbers)
  if (coords) return { ...coords, label: await placeNameAt(coords.lat, coords.lon).catch(() => "") };
  const suggestion = options?.suggestion;
  if (suggestion && isValidLatLon(suggestion.lat as number, suggestion.lon as number)) {
    return { lat: suggestion.lat as number, lon: suggestion.lon as number, label: [suggestion.text, suggestion.detail].filter(Boolean).join(", ") };
  }
  const attempts: (() => Promise<SiteLocation[]>)[] = [
    () => esriFindCandidates(text, options?.near, suggestion?.magicKey),
    () => censusFindCandidates(text),
    () => photonSearch(text, options?.near, 1).then(list => list.map(s => ({
      lat: s.lat as number,
      lon: s.lon as number,
      label: [s.text, s.detail].filter(Boolean).join(", ")
    }))),
    () => nominatimSearch(text)
  ];
  for (const attempt of attempts) {
    try {
      const results = await attempt();
      if (results.length > 0) return results[0];
    } catch (err) {
      console.info("Geocoder unavailable, trying the next one", err);
    }
  }
  throw new Error("Couldn't find that place.");
};
