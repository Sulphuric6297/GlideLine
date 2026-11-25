// The aerial photos a site can have, and what each is like there: who took it, when (so whether
// the trees were in leaf), and how sharp it is. National: USGS NAIP Plus over the US (aerial,
// summer, with a near-infrared band) and Esri's World Imagery everywhere (mostly satellite);
// statewide: services that only cover their own state. All are free, need no key and allow any
// website (CORS). Only quick metadata calls here; the photo itself is downloaded in imagery.ts.
import { FEET_PER_METER, METERS_PER_DEG_LAT, mercatorBbox, type GeoBounds } from "./core";
import { DATAFORSYNINGEN, DK_REGIONS, ORTO_CREDIT, dkToken } from "./denmark";

export type PhotoSourceId = "naip" | "ky" | "nc" | "in" | "oh" | "pa" | "va" | "tn" | "wi" | "ny" | "nj" | "ct" | "md" | "mo" | "dk" | "esri";
/** In leaf (late spring to early fall), bare (late fall to early spring), or between. */
export type PhotoSeason = "leaf-on" | "leaf-off" | "mixed";

/** One photo a frame can have, as the picker lists it. */
export type PhotoChoice = {
  id: PhotoSourceId;
  /** What to call it ("NAIP aerial photo"). */
  label: string;
  /** The provider's credit, for the printed map and the app's credits line (never on the photo). */
  credit: string;
  /** Aerial photos stand straight over the ground; satellite photos are often taken at an angle,
   * so tall crowns lean and fall a few yards off where they stand. */
  kind: "aerial" | "satellite";
  /** When it was taken: YYYY-MM-DD, or YYYY when only the year is known (the first, when the
   * frame takes in more than one). */
  date?: string;
  /** The last date, when the frame takes in photos of more than one day. */
  dateTo?: string;
  year?: number;
  season?: PhotoSeason;
  /** The photo's own pixel size on the ground, meters. */
  metersPerPx: number;
  /** It has a near-infrared band (leaves, shadows and water told apart on it). */
  nir: boolean;
  /** How good a pick it is here (higher is better): in leaf, sharp, recent, straight down. */
  score: number;
};

/** A photo served by an ArcGIS image service (exportImage: any box, any size, in one request). */
export type ImageService = {
  id: Exclude<PhotoSourceId, "esri">;
  label: string;
  credit: string;
  kind: "aerial";
  /** Where it has pictures (rough boxes: the service itself says where it has none). */
  regions: GeoBounds[];
  /** The service, and mirrors to try if it doesn't answer. */
  urls: string[];
  metersPerPx: number;
  /** The largest image one request may ask for, pixels a side. */
  maxPx: number;
  /** The bands for the color photo, and the near-infrared one, where there is one. */
  rgbBands?: string;
  nirBand?: string;
  /** When the catalog doesn't say the season (only the year). */
  season?: PhotoSeason;
  /** A map service (export, no catalog to ask): whether it has a picture here is seen on a small
   * one of the frame, and its year is the flight's (`year`). */
  map?: boolean;
  /** A WMS (GetMap, in web mercator) instead: its layer, and whether it needs the Danish token. */
  wms?: { layer: string; dkToken?: boolean };
  year?: number;
  /** What the catalog says of the picture at a spot: its date, year, pixel size. */
  read: (a: Record<string, unknown>) => { date?: string; year?: number; metersPerPx?: number };
};

const dateOfMs = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v).toISOString().slice(0, 10) : undefined);
/** A date written YYYYMMDD inside a name (a photo tile's file name). */
const dateInName = (v: unknown) => {
  const m = typeof v === "string" ? v.match(/(?:^|[^0-9])((?:19|20)\d\d)(0[1-9]|1[0-2])([0-2]\d|3[01])(?:[^0-9]|$)/) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
};

export const IMAGE_SERVICES: ImageService[] = [
  {
    // (Denmark's spring photo, with a Dataforsyningen token)
    id: "dk",
    label: "GeoDanmark orthophoto",
    credit: ORTO_CREDIT,
    kind: "aerial",
    regions: DK_REGIONS,
    urls: [`${DATAFORSYNINGEN}/orto_foraar_DAF`],
    metersPerPx: 0.125,
    maxPx: 4000,
    // (flown in spring before the leaves are out, as the states' own are: no canopy is read off it)
    season: "leaf-off",
    map: true,
    wms: { layer: "orto_foraar", dkToken: true },
    read: () => ({})
  },
  {
    id: "naip",
    label: "NAIP aerial photo",
    credit: "Imagery: USGS The National Map, USDA NAIP",
    kind: "aerial",
    // (the lower 48 and Hawaii)
    regions: [{ south: 24.3, north: 49.5, west: -125, east: -66.8 }, { south: 18.8, north: 22.4, west: -160.5, east: -154.6 }],
    urls: ["https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer"],
    metersPerPx: 0.6,
    maxPx: 4000,
    rgbBands: "0,1,2",
    nirBand: "3",
    read: a => {
      const mpp = typeof a.resolution_value === "number" && /^m/i.test(String(a.resolution_units ?? "")) ? a.resolution_value : undefined;
      return { date: dateOfMs(a.acquisition_date) ?? dateInName(a.Name), year: typeof a.Year === "number" ? a.Year : undefined, metersPerPx: mpp };
    }
  },
  {
    id: "ky",
    label: "KyFromAbove aerial photo",
    credit: "Imagery: KyFromAbove",
    kind: "aerial",
    regions: [{ south: 36.49, north: 39.15, west: -89.58, east: -81.96 }],
    urls: ["https://kyraster.ky.gov/arcgis/rest/services/ImageServices/Ky_KYAPED_Phase3_3IN_WGS84WM/ImageServer"],
    metersPerPx: 0.0762,
    maxPx: 15000,
    rgbBands: "0,1,2",
    nirBand: "3",
    // (flown in early spring, before the leaves: "Season1" in its tiles' names)
    season: "leaf-off",
    read: a => {
      const m = String(a.Name ?? "").match(/_((?:19|20)\d\d)_/);
      return { year: m ? +m[1] : undefined };
    }
  },
  {
    id: "nc",
    label: "NC OneMap aerial photo",
    credit: "Imagery © NC OneMap / NC Orthoimagery Program",
    kind: "aerial",
    regions: [{ south: 33.75, north: 36.6, west: -84.33, east: -75.4 }],
    urls: [
      "https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer",
      "https://services.gis.nc.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer"
    ],
    metersPerPx: 0.1524,
    maxPx: 4100,
    // (flown in winter)
    season: "leaf-off",
    read: a => ({ date: dateInName(a.name) })
  },
  // More states' own photos, sharper than NAIP (3 to 12 in), all free with no key: image services
  // (a catalog to ask; the year in each picture's name) and map services (a picture, the flight's
  // year). Statewide mapping flights go in early spring, before the leaves (Wisconsin's and
  // Pennsylvania's say so).
  ...([
    ["in", "Indiana aerial photo", "Imagery: Indiana Geographic Information Office", [37.77, 41.77, -88.1, -84.78], "https://di-ingov.img.arcgis.com/arcgis/rest/services/DynamicWebMercator/Indiana_Current_Imagery/ImageServer", 0.0762, 2025, "leaf-off", true],
    ["oh", "Ohio aerial photo (OSIP)", "Imagery: Ohio Statewide Imagery Program", [38.4, 41.98, -84.82, -80.52], "https://maps.ohio.gov/image/rest/services/osip_most_current/ImageServer", 0.1524, 2024, "leaf-off", false],
    ["wi", "Wisconsin aerial photo (WROC)", "Imagery: WisDOT, Wisconsin Regional Orthoimagery Consortium", [42.49, 47.31, -92.89, -86.25], "https://di-wisdot.img.arcgis.com/arcgis/rest/services/Statewide/WisconsinWROC/ImageServer", 0.3048, 2025, "leaf-off", true],
    ["ct", "Connecticut aerial photo", "Imagery: CT ECO, 2023 Connecticut Orthophotography", [40.98, 42.05, -73.73, -71.79], "https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023/ImageServer", 0.0762, 2023, "leaf-off", true],
    ["md", "Maryland aerial photo", "Imagery: MD iMAP, Maryland DoIT", [37.91, 39.72, -79.49, -75.05], "https://mdgeodata.md.gov/imagery/rest/services/SixInch/SixInchImagery/ImageServer", 0.1524, 2024, "leaf-off", true],
    ["mo", "Missouri aerial photo", "Imagery: Missouri Spatial Data Information Service (MSDIS)", [35.99, 40.61, -95.77, -89.1], "https://stateimagery.msdis.missouri.edu/arcgis/rest/services/Missouri_6inch_Statewide_2023_2024_Dynamic/ImageServer", 0.15, 2024, undefined, true]
  ] as const).map(([id, label, credit, [south, north, west, east], url, mpp, year, season, nir]): ImageService => ({
    id, label, credit, kind: "aerial", regions: [{ south, north, west, east }], urls: [url], metersPerPx: mpp, maxPx: 4000,
    ...(nir ? { rgbBands: "0,1,2", nirBand: "3" } : {}), season, year,
    // (the year in a picture's name, as "in2025_…" or "COLUMBUS_2025"; the flight's otherwise)
    read: a => ({ year: yearInName(a.Name) ?? (typeof a.Image_Year === "number" ? a.Image_Year : year) })
  })),
  ...([
    ["pa", "Pennsylvania aerial photo (PEMA)", "Imagery: PEMA, via PASDA", [39.72, 42.27, -80.52, -74.69], "https://imagery.pasda.psu.edu/arcgis/rest/services/pasda/PEMAImagery2018_2020/MapServer", 0.1524, 2019, "leaf-off"],
    ["va", "Virginia aerial photo (VBMP)", "Imagery: VGIN, Virginia Base Mapping Program", [36.54, 39.47, -83.68, -75.24], "https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VBMP_Imagery/MostRecentImagery_WGS/MapServer", 0.3048, 2023, "leaf-off"],
    ["tn", "Tennessee aerial photo (TDOT)", "Imagery: TDOT Aerial Surveys", [34.98, 36.68, -90.31, -81.65], "https://tnmap.tn.gov/arcgis/rest/services/BASEMAPS/IMAGERY_WEB_MERCATOR/MapServer", 0.1524, undefined, "leaf-off"],
    ["ny", "New York aerial photo", "Imagery: NYS ITS Geospatial Services", [40.5, 45.02, -79.76, -71.86], "https://orthos.its.ny.gov/arcgis/rest/services/wms/Latest/MapServer", 0.3048, 2023, "leaf-off"],
    ["nj", "New Jersey aerial photo", "Imagery: NJ Office of GIS (NJOGIS)", [38.93, 41.36, -75.56, -73.89], "https://maps.nj.gov/arcgis/rest/services/Basemap/Orthos_Natural_2020_NJ_WM/MapServer", 0.3048, 2020, undefined]
  ] as const).map(([id, label, credit, [south, north, west, east], url, mpp, year, season]): ImageService => ({
    id, label, credit, kind: "aerial", regions: [{ south, north, west, east }], urls: [url], metersPerPx: mpp, maxPx: 2048, map: true, season, year,
    read: () => ({})
  }))
];

/** A year written inside a name ("in2025_18871646_3in", "COLUMBUS_2025"). */
function yearInName(v: unknown) {
  const m = typeof v === "string" ? v.match(/(?:^|[^0-9])((?:19|20)\d\d)(?:[^0-9]|$)/) ?? v.match(/[a-z]((?:19|20)\d\d)_/i) : null;
  return m ? +m[1] : undefined;
}

/** Esri World Imagery: map tiles everywhere, satellite in most places (aerial in some cities). */
export const ESRI = {
  label: "Esri satellite",
  credit: "Imagery © Esri, Maxar, Vexcel, Earthstar Geographics",
  maxZoom: 21,
  url: (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  // Coverage lookup for zoom levels that only exist in some areas (high-res aerials).
  tilemap: (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap/${z}/${y}/${x}/1/1?f=json`,
  // What the photo is at each spot (its date, its sensor and pixel size), in Esri's releases of it
  metadata: "https://metadata.maptiles.arcgis.com/arcgis/rest/services"
};

/** Whether a box and a region overlap. */
const overlaps = (a: GeoBounds, b: GeoBounds) => a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
const inRegion = (s: ImageService, b: GeoBounds) => s.regions.some(r => overlaps(r, b)) && (!s.wms?.dkToken || !!dkToken());

/** A service's picture of a box (web mercator, as mercatorBbox gives it), `w` by `h` pixels: an
 * ArcGIS map service's export, an image service's exportImage, or a WMS's GetMap. */
export const serviceImageUrl = (url: string, s: { map?: boolean; wms?: ImageService["wms"] }, bbox3857: string, w: number, h: number, o: { png?: boolean; bands?: string } = {}) => {
  if (s.wms) {
    const q = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetMap", layers: s.wms.layer, styles: "", crs: "EPSG:3857", bbox: bbox3857, width: String(w), height: String(h), format: o.png ? "image/png" : "image/jpeg", ...(o.png ? { transparent: "true" } : {}), ...(s.wms.dkToken ? { token: dkToken() } : {}) });
    return `${url}?${q}`;
  }
  if (s.map) return `${url}/export?${new URLSearchParams({ bbox: bbox3857, bboxSR: "3857", imageSR: "3857", size: `${w},${h}`, format: o.png ? "png" : "jpg", transparent: o.png ? "true" : "false", f: "image" })}`;
  return `${url}/exportImage?${new URLSearchParams({ bbox: bbox3857, bboxSR: "3857", imageSR: "3857", size: `${w},${h}`, adjustAspectRatio: "false", format: o.png ? "png" : "jpg", interpolation: "RSP_BilinearInterpolation", ...(o.bands ? { bandIds: o.bands } : {}), ...(o.png ? { transparent: "true" } : {}), f: "image" })}`;
};

/** The pixel size (m) a frame's photo is wanted at: about 4096 pixels across its longer side. */
export const targetMetersPerPx = (b: GeoBounds, targetPx = 4096) => {
  const lat = (b.north + b.south) / 2;
  const wM = (b.east - b.west) * METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const hM = (b.north - b.south) * METERS_PER_DEG_LAT;
  return Math.max(wM, hM) / targetPx;
};

/** Whether the leaves are out on a date at a latitude: May to September in the north, November
 * to March in the south; the months either side are between; near the equator always. */
export const seasonOf = (date: string | undefined, lat: number): PhotoSeason | undefined => {
  const m = date && /^\d{4}-(\d\d)/.exec(date);
  if (!m) return undefined;
  if (Math.abs(lat) < 23.5) return "leaf-on";
  const month = ((+m[1] - 1 + (lat < 0 ? 6 : 0)) % 12) + 1;
  return month >= 5 && month <= 9 ? "leaf-on" : month === 4 || month === 10 ? "mixed" : "leaf-off";
};

/** How good a pick a photo is: in leaf counts most (woods and lone trees show as they are, no
 * long winter shadows), then sharpness (no sharper than the frame needs), then how recent, and an
 * aerial over a satellite one. */
export const photoScore = (c: Pick<PhotoChoice, "season" | "metersPerPx" | "year" | "kind">, wantedMpp: number, thisYear = new Date().getFullYear()) => {
  const leaf = c.season === "leaf-on" ? 4 : c.season === "mixed" ? 2 : c.season === "leaf-off" ? 0 : 1.5;
  const sharp = -1.5 * Math.log2(Math.max(c.metersPerPx, wantedMpp) / 0.3);
  const age = c.year ? -0.15 * Math.min(10, Math.max(0, thisYear - c.year)) : -0.75;
  return Math.round((leaf + sharp + age + (c.kind === "satellite" ? -1 : 0)) * 100) / 100;
};

const getJson = async (url: string, timeoutMs: number, signal?: AbortSignal) => {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(json.error.message || "Service error");
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
};

/** Five spots over a frame: its middle and a spot toward each corner. */
const spotsOver = (b: GeoBounds) => {
  const lat = (b.north + b.south) / 2, lon = (b.east + b.west) / 2;
  const dy = (b.north - b.south) * 0.3, dx = (b.east - b.west) * 0.3;
  return [[lon, lat], [lon - dx, lat + dy], [lon + dx, lat + dy], [lon - dx, lat - dy], [lon + dx, lat - dy]];
};

/** The dates seen over a frame, as a choice says them: the first (and the last, if not the same). */
const dateSpan = (dates: string[]) => {
  const d = [...new Set(dates)].sort();
  return { date: d[0], dateTo: d.length > 1 ? d[d.length - 1] : undefined };
};

/** What an image service has over a frame (null: nothing there, or it didn't answer). */
const serviceChoice = async (s: ImageService, b: GeoBounds, wantedMpp: number, timeoutMs: number, signal?: AbortSignal): Promise<PhotoChoice | null> => {
  if (s.map) return mapChoice(s, b, wantedMpp, timeoutMs, signal);
  const geometry = JSON.stringify({ points: spotsOver(b), spatialReference: { wkid: 4326 } });
  const q = new URLSearchParams({ geometry, geometryType: "esriGeometryMultipoint", returnFirstValueOnly: "true", outFields: "*", f: "json" });
  for (const url of s.urls) {
    try {
      const json = await getJson(`${url}/getSamples?${q}`, timeoutMs, signal);
      const samples = (json.samples ?? []) as { value?: string; rasterId?: number; attributes?: Record<string, unknown> }[];
      // (no picture there: no raster, or no value)
      const here = samples.filter(x => x.rasterId && x.attributes && x.value && !/nodata/i.test(x.value));
      if (!here.length || here.length < Math.ceil(samples.length / 2)) return null;
      const read = here.map(x => s.read(x.attributes!));
      const dates = read.map(r => r.date).filter((d): d is string => !!d);
      const years = read.map(r => r.year ?? (r.date ? +r.date.slice(0, 4) : undefined)).filter((y): y is number => !!y);
      const mpps = read.map(r => r.metersPerPx).filter((m): m is number => !!m);
      const span = dates.length ? dateSpan(dates) : years.length ? { date: String(Math.min(...years)), dateTo: Math.max(...years) > Math.min(...years) ? String(Math.max(...years)) : undefined } : {};
      const lat = (b.north + b.south) / 2;
      const seasons = [...new Set(dates.map(d => seasonOf(d, lat)))];
      const season = seasons.length === 1 ? seasons[0] : seasons.length > 1 ? "mixed" : s.season;
      const c = {
        id: s.id, label: s.label, credit: s.credit, kind: s.kind, ...span,
        year: years.length ? Math.max(...years) : undefined,
        season, metersPerPx: mpps.length ? Math.max(...mpps) : s.metersPerPx, nir: !!s.nirBand
      };
      return { ...c, score: photoScore(c, wantedMpp) };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.info(`${s.label}: no answer from ${url}`, err);
    }
  }
  return null;
};

/** A map service's picture of a frame, small: whether it has one there (not blank, black or white). */
const hasPicture = async (url: string, svc: ImageService, b: GeoBounds, timeoutMs: number, signal?: AbortSignal) => {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  try {
    const res = await fetch(serviceImageUrl(url, svc, mercatorBbox(b), 64, 64), { signal: ctrl.signal });
    const blob = res.ok ? await res.blob() : null;
    if (!blob || !blob.type.startsWith("image/")) return false;
    const img = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let blank = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] < 6 && d[i + 1] < 6 && d[i + 2] < 6) || (d[i] > 249 && d[i + 1] > 249 && d[i + 2] > 249)) blank++;
    return blank < 64 * 64 * 0.3;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
};

/** What a map service has over a frame: its picture, where it has one (null: none, or no answer). */
const mapChoice = async (s: ImageService, b: GeoBounds, wantedMpp: number, timeoutMs: number, signal?: AbortSignal): Promise<PhotoChoice | null> => {
  for (const url of s.urls) {
    try {
      if (!(await hasPicture(url, s, b, timeoutMs, signal))) return null;
      const c = { id: s.id, label: s.label, credit: s.credit, kind: s.kind, date: s.year ? String(s.year) : undefined, year: s.year, season: s.season, metersPerPx: s.metersPerPx, nir: false };
      return { ...c, score: photoScore(c, wantedMpp) };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.info(`${s.label}: no answer from ${url}`, err);
    }
  }
  return null;
};

/** Esri's metadata service for its newest release of World Imagery (looked up once). */
let esriMeta: Promise<string | null> | null = null;
const esriMetaService = (timeoutMs: number) =>
  (esriMeta ??= getJson(`${ESRI.metadata}?f=json`, timeoutMs)
    .then(j => {
      const names = ((j.services ?? []) as { name: string }[]).map(x => x.name).filter(n => /^World_Imagery_Metadata_\d{4}_r\d+$/.test(n)).sort();
      return names.length ? `${ESRI.metadata}/${names[names.length - 1]}/MapServer` : null;
    })
    .catch(() => { esriMeta = null; return null; }));

/** The Esri tile zoom a frame is downloaded at: the coarsest whose pixels are about the size
 * wanted (within 15%), at most `maxTiles` tiles. */
export const esriZoom = (b: GeoBounds, wantedMpp: number, maxTiles = MAX_TILES) => {
  const lat = (b.north + b.south) / 2;
  const cos = Math.cos((lat * Math.PI) / 180);
  let z = Math.min(ESRI.maxZoom, Math.max(1, Math.ceil(Math.log2((156543.03392 * cos) / Math.max(wantedMpp * 1.15, 0.01)))));
  const tiles = (zz: number) => {
    const n = 2 ** zz;
    const x = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const y = (la: number) => { const r = (la * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
    return (x(b.east) - x(b.west) + 1) * (y(b.south) - y(b.north) + 1);
  };
  while (z > 1 && tiles(z) > maxTiles) z--;
  return z;
};
/** The most map tiles one photo is made of (about 7 MB of tiles at most). */
export const MAX_TILES = 450;

/** What Esri's photo is over a frame: date, sensor (satellite or aerial) and pixel size. */
const esriChoice = async (b: GeoBounds, wantedMpp: number, timeoutMs: number, signal?: AbortSignal): Promise<PhotoChoice> => {
  const base = { id: "esri" as const, label: ESRI.label, credit: ESRI.credit, kind: "satellite" as const, nir: false };
  const z = esriZoom(b, wantedMpp);
  const zMpp = (156543.03392 * Math.cos((((b.north + b.south) / 2) * Math.PI) / 180)) / 2 ** z;
  try {
    const svc = await esriMetaService(timeoutMs);
    if (!svc) throw new Error("No metadata service");
    // (its layers by pixel size: 0 is 1.9 cm, each next one twice that; zoom 19 is the 30 cm one)
    const layer = Math.max(0, Math.min(13, 23 - Math.min(z, 19)));
    const q = new URLSearchParams({ geometry: mercatorBbox(b), geometryType: "esriGeometryEnvelope", inSR: "3857", spatialRel: "esriSpatialRelIntersects", outFields: "SRC_DATE,SRC_RES,SRC_DESC", returnGeometry: "false", f: "json" });
    const json = await getJson(`${svc}/${layer}/query?${q}`, timeoutMs, signal);
    const rows = ((json.features ?? []) as { attributes: Record<string, unknown> }[]).map(f => f.attributes);
    const dates = rows.map(r => String(r.SRC_DATE ?? "")).filter(d => /^\d{8}$/.test(d)).map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
    const res = rows.map(r => Number(r.SRC_RES)).filter(v => v > 0);
    // (satellites: WorldView, GeoEye, QuickBird, Pléiades, SPOT and the like)
    const satellite = !rows.length || rows.some(r => /^(WV|GE|QB|PL|PNEO|SP|IK|SV|KOMPSAT|Pleiades)/i.test(String(r.SRC_DESC ?? "")));
    const lat = (b.north + b.south) / 2;
    const span = dates.length ? dateSpan(dates) : {};
    const seasons = [...new Set(dates.map(d => seasonOf(d, lat)))];
    const c = {
      ...base, kind: satellite ? ("satellite" as const) : ("aerial" as const), ...span,
      year: dates.length ? +dates.map(d => d.slice(0, 4)).sort().pop()! : undefined,
      season: seasons.length === 1 ? seasons[0] : seasons.length ? ("mixed" as const) : undefined,
      metersPerPx: res.length ? Math.max(...res, zMpp) : zMpp
    };
    return { ...c, score: photoScore(c, wantedMpp) };
  } catch (err) {
    if (signal?.aborted) throw err;
    const c = { ...base, metersPerPx: zMpp };
    return { ...c, score: photoScore(c, wantedMpp) };
  }
};

/**
 * The photos a frame can have, best first: each with its date, season and pixel size, from the
 * services' catalogs (quick calls, all at once; a service that doesn't answer in `timeoutMs` is
 * left out). Esri's is always there, whatever its catalog says.
 */
export const photoChoices = async (b: GeoBounds, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<PhotoChoice[]> => {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const wanted = targetMetersPerPx(b);
  const found = await Promise.all([
    ...IMAGE_SERVICES.filter(s => inRegion(s, b)).map(s => serviceChoice(s, b, wanted, timeoutMs, opts.signal)),
    esriChoice(b, wanted, timeoutMs, opts.signal)
  ]);
  return found.filter((c): c is PhotoChoice => !!c).sort((a, c) => c.score - a.score);
};

/** A small picture of a frame from one photo source, for a picker's thumbnail: a URL to put in an
 * <img> as it is (one request, `sizePx` on its longer side). */
export const photoPreview = (b: GeoBounds, source: PhotoSourceId, sizePx = 256) => {
  const lat = (b.north + b.south) / 2;
  const wM = (b.east - b.west) * METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180), hM = (b.north - b.south) * METERS_PER_DEG_LAT;
  const w = Math.max(1, Math.round(wM >= hM ? sizePx : (sizePx * wM) / hM)), h = Math.max(1, Math.round(hM >= wM ? sizePx : (sizePx * hM) / wM));
  const box = { bbox: mercatorBbox(b), bboxSR: "3857", imageSR: "3857", size: `${w},${h}`, format: "jpg", f: "image" };
  if (source === "esri") return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${new URLSearchParams(box)}`;
  const m = IMAGE_SERVICES.find(x => x.id === source);
  if (!m) return "";
  return serviceImageUrl(m.urls[0], m, box.bbox, w, h, { bands: m.rgbBands });
};

/** A choice's date in words for the app: "Aug 2023", "2024", "Jun 2022 to Jul 2022". */
export const photoDateText = (c: Pick<PhotoChoice, "date" | "dateTo">) => {
  const one = (d: string) => (/^\d{4}-\d\d/.test(d) ? new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : d.slice(0, 4));
  if (!c.date) return "";
  const a = one(c.date), z = c.dateTo ? one(c.dateTo) : a;
  return a === z ? a : `${a} to ${z}`;
};

/** Feet per pixel of a choice, rounded for saying ("1 ft", "0.25 ft"). */
export const photoFeetPerPx = (c: Pick<PhotoChoice, "metersPerPx">) => Math.round(c.metersPerPx * FEET_PER_METER * 100) / 100;
