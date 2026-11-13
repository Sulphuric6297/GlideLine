import { clamp } from "../../constants";
import { ELEVATION_TILE_SIZE, FEET_PER_METER, GeoBounds, SiteLocation, getGeoBounds, latToPixel, loadTileMosaic, lonToPixel, mercatorBbox } from "./core";
import { ESRI, IMAGE_SERVICES, MAX_TILES, esriZoom, photoChoices, targetMetersPerPx, type ImageService, type PhotoChoice, type PhotoSourceId } from "./photoSources";


export type MapImagerySource = "satellite" | "streets";
export const MAP_IMAGERY_SOURCES: Record<MapImagerySource, {
  label: string;
  maxZoom: number;
  attribution: string;
  url: (z: number, x: number, y: number) => string;
  // Coverage lookup for zoom levels that only exist in some areas (high-res aerials).
  tilemap?: (z: number, x: number, y: number) => string;
}> = {
  satellite: {
    label: "Satellite",
    maxZoom: ESRI.maxZoom,
    attribution: ESRI.credit,
    url: ESRI.url,
    tilemap: ESRI.tilemap
  },
  streets: {
    label: "Street Map",
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
  }
};
// Statewide high-resolution orthoimagery (public ArcGIS ImageServers, no key): the state services
// of photoSources, as the site picker draws them over Esri inside their states.
export const STATE_ORTHO_SOURCES: {
  id: string;
  /** A map service (export), not an image service (exportImage). */
  map: boolean;
  label: string;
  attribution: string;
  region: GeoBounds;
  feetPerPixel: number;
  services: string[];
}[] = IMAGE_SERVICES.filter(s => s.id !== "naip").map(s => ({ id: s.id, map: !!s.map, label: s.label, attribution: s.credit, region: s.regions[0], feetPerPixel: s.metersPerPx * FEET_PER_METER, services: s.urls }));

export const findStateOrtho = (lat: number, lon: number) =>
  STATE_ORTHO_SOURCES.find(src => lat >= src.region.south && lat <= src.region.north && lon >= src.region.west && lon <= src.region.east);

export const loadBlobImage = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Invalid image")); };
    img.src = url;
  });

const creditFontPx = (imageWidth: number) => Math.max(6, Math.round(imageWidth / 140));
/** Height of the provider credit box that photos brought in before were drawn with along their
 * bottom edge (the credit is kept with the site now, never drawn on the photo). */
export const creditHeightPx = (imageWidth: number) => creditFontPx(imageWidth) * 1.6;

/** The largest piece of an exported image asked for in one request, pixels a side (bigger ones
 * take much longer to come). */
const EXPORT_CHUNK = 2048;

// Exports a north-up image of the bounds from an ArcGIS ImageServer, in pieces of at most
// EXPORT_CHUNK pixels a side asked for all at once. `bands`: which of its bands (one: a grey image).
export const fetchArcgisExportImage = async (
  serviceUrl: string,
  bounds: GeoBounds,
  widthPx: number,
  heightPx: number,
  opts: { bands?: string; signal?: AbortSignal; onProgress?: (fraction: number) => void; maxPx?: number; map?: boolean } = {}
) => {
  const out = document.createElement("canvas");
  out.width = widthPx;
  out.height = heightPx;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  const chunk = Math.min(EXPORT_CHUNK, opts.maxPx ?? EXPORT_CHUNK);
  const lonPerPx = (bounds.east - bounds.west) / widthPx;
  const latPerPx = (bounds.north - bounds.south) / heightPx;
  const jobs: Promise<void>[] = [];
  const total = Math.ceil(widthPx / chunk) * Math.ceil(heightPx / chunk);
  let done = 0;
  for (let py = 0; py < heightPx; py += chunk) {
    for (let px = 0; px < widthPx; px += chunk) {
      const w = Math.min(chunk, widthPx - px);
      const h = Math.min(chunk, heightPx - py);
      const west = bounds.west + px * lonPerPx;
      const east = west + w * lonPerPx;
      const north = bounds.north - py * latPerPx;
      const south = north - h * latPerPx;
      // (a map service: its export, which takes no bands)
      const params = new URLSearchParams(opts.map ? {
        bbox: mercatorBbox({ west, east, north, south }), bboxSR: "3857", imageSR: "3857", size: `${w},${h}`, format: "jpg", transparent: "false", f: "image"
      } : {
        bbox: mercatorBbox({ west, east, north, south }),
        bboxSR: "3857",
        imageSR: "3857",
        size: `${w},${h}`,
        adjustAspectRatio: "false",
        format: "jpg",
        interpolation: "RSP_BilinearInterpolation",
        ...(opts.bands ? { bandIds: opts.bands } : {}),
        f: "image"
      });
      jobs.push((async () => {
        const res = await fetch(`${serviceUrl}/${opts.map ? "export" : "exportImage"}?${params.toString()}`, { signal: opts.signal });
        if (!res.ok) throw new Error(`Imagery service ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) throw new Error("Imagery service returned no image");
        const img = await loadBlobImage(blob);
        ctx.drawImage(img, px, py, w, h);
        opts.onProgress?.(++done / total);
      })());
    }
  }
  await Promise.all(jobs);
  // Outside the program's coverage the service returns blank (black/white) pixels.
  const sample = ctx.getImageData(0, 0, widthPx, heightPx).data;
  let blank = 0;
  let total2 = 0;
  const step = Math.max(4, Math.floor(sample.length / 4 / 5000)) * 4;
  for (let i = 0; i < sample.length; i += step) {
    const r = sample[i], g = sample[i + 1], b = sample[i + 2];
    if ((r < 4 && g < 4 && b < 4) || (r > 251 && g > 251 && b > 251)) blank++;
    total2++;
  }
  if (blank / Math.max(total2, 1) > 0.3) throw new Error("Imagery service has no coverage here");
  return dataUrlOf(out);
};

/** The most street-map tiles one map is made of (OpenStreetMap's tiles are for light use). */
export const MAP_IMAGERY_MAX_TILES = 196;
// ~4K image: sharp in 2D and within every GPU's texture limit for 3D.
export const MAP_IMAGERY_TARGET_PX = 4096;

/** The photo or map brought in under a site. */
export type MapImagery = {
  /** The image (a JPEG data URL), north up, exactly over the site. */
  url: string;
  /** Some map tiles were missing. */
  partial: boolean;
  /** What to call it ("NAIP aerial photo", "Esri satellite", "OpenStreetMap"). */
  sourceLabel: string;
  /** The provider's credit, for the printed map and the app's credits line. */
  credit: string;
  /** Which photo it is, with its date, season and pixel size (unset for the street map). */
  photo?: PhotoChoice;
  /** The year it was taken, when known. */
  year?: number;
  /** Its pixel size on the ground as downloaded, meters. */
  metersPerPx: number;
  /** The near-infrared band over the same ground (a grey JPEG data URL), when asked for and the
   * photo has one: for telling leaves from shadow and lawn. */
  nir?: string | null;
  /** The photos the site could have had, best first (for offering another). */
  choices?: PhotoChoice[];
};

// Downloads a north-up map image exactly covering widthFt x heightFt centered on the location.
// The satellite photo is the best of the photos the site can have (see photoChoices), or the one
// asked for (`photo`), trying the next when one can't be had.
export const fetchMapImagery = async (
  location: SiteLocation,
  widthFt: number,
  heightFt: number,
  source: MapImagerySource,
  onProgress?: (fraction: number) => void,
  options: AbortSignal | { signal?: AbortSignal; photo?: PhotoSourceId; nir?: boolean; choices?: PhotoChoice[] } = {}
): Promise<MapImagery> => {
  // (a signal alone: stopping it is all that's asked)
  const opts = options instanceof AbortSignal ? { signal: options } : options;
  const bounds = getGeoBounds(location, widthFt, heightFt);
  if (source === "streets") return streetMap(bounds, widthFt, onProgress, opts.signal);
  // (waited for longer than the picker does: NAIP's catalog can take 15 s to answer the first time,
  // and the summer photo with its infrared band shouldn't be passed over for that)
  const choices = opts.choices ?? (await photoChoices(bounds, { signal: opts.signal, timeoutMs: 20000 }));
  const order = opts.photo ? [...choices.filter(c => c.id === opts.photo), ...choices.filter(c => c.id !== opts.photo)] : choices;
  let lastErr: unknown = null;
  for (const c of order) {
    try {
      const got = c.id === "esri" ? await esriPhoto(bounds, location, c, onProgress, opts.signal) : await servicePhoto(IMAGE_SERVICES.find(s => s.id === c.id)!, c, bounds, widthFt, heightFt, onProgress, opts);
      return { ...got, photo: c, year: c.year, credit: c.credit, sourceLabel: c.label, choices };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastErr = err;
      console.info(`${c.label} unavailable`, err);
    }
  }
  throw lastErr ?? new Error("Couldn't download the satellite photo.");
};

/** A photo from an image service: at its own pixel size, or coarser when the site is too big
 * for MAP_IMAGERY_TARGET_PX pixels at that; its near-infrared band too when asked for. */
const servicePhoto = async (s: ImageService, c: PhotoChoice, bounds: GeoBounds, widthFt: number, heightFt: number, onProgress: ((f: number) => void) | undefined, opts: { signal?: AbortSignal; nir?: boolean }) => {
  const mpp = Math.max(c.metersPerPx, targetMetersPerPx(bounds, MAP_IMAGERY_TARGET_PX));
  const widthPx = clamp(Math.round(widthFt / FEET_PER_METER / mpp), 1, MAP_IMAGERY_TARGET_PX);
  const heightPx = clamp(Math.round(heightFt / FEET_PER_METER / mpp), 1, MAP_IMAGERY_TARGET_PX);
  let lastErr: unknown = null;
  for (const url of s.urls) {
    try {
      const wantNir = opts.nir && s.nirBand;
      // (the color photo and its infrared together: two parts of the progress)
      let a = 0, b = wantNir ? 0 : 1;
      const tell = () => onProgress?.((a + b) / 2);
      const [photo, nir] = await Promise.all([
        fetchArcgisExportImage(url, bounds, widthPx, heightPx, { bands: s.rgbBands, signal: opts.signal, maxPx: s.maxPx, map: s.map, onProgress: f => { a = f; tell(); } }),
        wantNir ? fetchArcgisExportImage(url, bounds, widthPx, heightPx, { bands: s.nirBand, signal: opts.signal, maxPx: s.maxPx, onProgress: f => { b = f; tell(); } }).catch(err => { if (opts.signal?.aborted) throw err; console.info(`${s.label}: no infrared band`, err); return null; }) : null
      ]);
      return { url: photo, partial: false, metersPerPx: (widthFt / FEET_PER_METER) / widthPx, nir };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastErr = err;
      console.info(`${s.label} unavailable from ${url}`, err);
    }
  }
  throw lastErr;
};

/** Esri's photo from its map tiles: the zoom whose pixels are about the size wanted (up to
 * MAX_TILES tiles), and no sharper than the sharpest that exists here. */
const esriPhoto = async (bounds: GeoBounds, location: SiteLocation, c: PhotoChoice, onProgress?: (f: number) => void, signal?: AbortSignal) => {
  let zoom = esriZoom(bounds, targetMetersPerPx(bounds, MAP_IMAGERY_TARGET_PX));
  // Use the sharpest imagery level that actually exists here (beyond z19 coverage is regional).
  while (zoom > 19) {
    const tx = Math.floor(lonToPixel(location.lon, zoom) / ELEVATION_TILE_SIZE);
    const ty = Math.floor(latToPixel(location.lat, zoom) / ELEVATION_TILE_SIZE);
    try {
      const res = await fetch(ESRI.tilemap(zoom, tx, ty), { signal });
      const json = res.ok ? await res.json() : null;
      if (json && !json.adjusted && Array.isArray(json.data) && json.data[0] === 1) break;
    } catch (err) {
      if (signal?.aborted) throw err;
      // fall through to a lower zoom
    }
    zoom -= 1;
  }
  const got = await mosaicImage(bounds, zoom, MAX_TILES, ESRI.url, onProgress, signal);
  if (!got) throw new Error(`Couldn't download ${c.label}.`);
  return got;
};

/** OpenStreetMap's street map under the site. */
const streetMap = async (bounds: GeoBounds, widthFt: number, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<MapImagery> => {
  const config = MAP_IMAGERY_SOURCES.streets;
  // Pick the zoom whose resolution gives roughly MAP_IMAGERY_TARGET_PX across the area.
  const metersPerPx = widthFt / FEET_PER_METER / MAP_IMAGERY_TARGET_PX;
  const cosLat = Math.cos((((bounds.north + bounds.south) / 2) * Math.PI) / 180);
  const zoom = clamp(Math.ceil(Math.log2((156543.03392 * cosLat) / Math.max(metersPerPx, 0.01))), 1, config.maxZoom);
  const got = await mosaicImage(bounds, zoom, MAP_IMAGERY_MAX_TILES, config.url, onProgress, signal);
  if (!got) throw new Error(`Couldn't download ${config.label.toLowerCase()} imagery.`);
  return { ...got, sourceLabel: "OpenStreetMap", credit: config.attribution };
};

/** A canvas as a JPEG data URL, encoded off the page's thread (`toDataURL` holds the page still for
 * a quarter of a second on a site's photo); the same picture either way. */
const dataUrlOf = (canvas: HTMLCanvasElement, quality = 0.92) =>
  new Promise<string>((ok, no) => {
    if (typeof canvas.toBlob !== "function" || typeof FileReader === "undefined") { ok(canvas.toDataURL("image/jpeg", quality)); return; }
    canvas.toBlob(blob => {
      if (!blob) { ok(canvas.toDataURL("image/jpeg", quality)); return; }
      const r = new FileReader();
      r.onload = () => ok(r.result as string);
      r.onerror = () => no(r.error ?? new Error("Couldn't read the photo."));
      r.readAsDataURL(blob);
    }, "image/jpeg", quality);
  });

/** Map tiles over the bounds, cut to them exactly and scaled to MAP_IMAGERY_TARGET_PX at most
 * (null when not one tile came). */
const mosaicImage = async (bounds: GeoBounds, zoom: number, maxTiles: number, url: (z: number, x: number, y: number) => string, onProgress?: (f: number) => void, signal?: AbortSignal) => {
  const mosaic = await loadTileMosaic(bounds, zoom, maxTiles, url, onProgress, signal);
  if (!mosaic.loadedAny) return null;
  const nw = mosaic.toMosaic(bounds.north, bounds.west);
  const se = mosaic.toMosaic(bounds.south, bounds.east);
  const cropW = Math.max(1, se.x - nw.x);
  const cropH = Math.max(1, se.y - nw.y);
  const outScale = Math.min(1, MAP_IMAGERY_TARGET_PX / Math.max(cropW, cropH));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cropW * outScale));
  out.height = Math.max(1, Math.round(cropH * outScale));
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("Your browser couldn't create a canvas for map data.");
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(mosaic.canvas, nw.x, nw.y, cropW, cropH, 0, 0, out.width, out.height);
  const lat = (bounds.north + bounds.south) / 2;
  const tileMpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** mosaic.z;
  return { url: await dataUrlOf(out), partial: !mosaic.loadedAll, metersPerPx: tileMpp / outScale };
};

// Satellite + labels for browsing in the site picker (the imported image itself has no labels).
export const PICKER_LAYERS: Record<MapImagerySource, { url: string; overlays: string[]; maxNativeZoom: number }> = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    overlays: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
    ],
    maxNativeZoom: 19
  },
  streets: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    overlays: [],
    maxNativeZoom: 19
  }
};
