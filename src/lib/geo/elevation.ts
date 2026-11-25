import { decode as decodePng } from "fast-png";
import { clamp } from "../../constants";
import { ELEVATION_MAX_TILES, ELEVATION_MAX_ZOOM, ELEVATION_TILE_SIZE, GeoBounds, SiteLocation, elevationTileUrl, getGeoBounds, getTileRange, latToPixel, lonToPixel, mercatorBbox } from "./core";
import { dhmElevationGrid, dkToken, inDenmark } from "./denmark";


// Downloads a Terrarium elevation tile and decodes it to meters. Decoded from the PNG bytes directly —
// not through a canvas — because browser privacy protections can add noise to canvas reads,
// which turns into ±250 m spikes in this encoding.
export const loadTerrariumTile = async (z: number, x: number, y: number): Promise<Float32Array | null> => {
  try {
    const res = await fetch(elevationTileUrl(z, x, y));
    if (!res.ok) return null;
    const png = decodePng(new Uint8Array(await res.arrayBuffer()));
    const { width, height, channels } = png;
    if (width !== ELEVATION_TILE_SIZE || height !== ELEVATION_TILE_SIZE) return null;
    const data = png.data as ArrayLike<number>;
    const palette = (png as any).palette as number[][] | undefined;
    const out = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      let r: number, g: number, b: number;
      if (palette) {
        [r, g, b] = palette[data[i]];
      } else {
        r = data[i * channels];
        g = data[i * channels + 1];
        b = data[i * channels + 2];
      }
      out[i] = r * 256 + g + b / 256 - 32768;
    }
    return out;
  } catch {
    return null;
  }
};

// 3x3 median filter: removes single-sample spikes without blurring real slopes.
export const medianFilterGrid = (values: Float32Array, w: number, h: number) => {
  const out = new Float32Array(values.length);
  const window: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      window.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = values[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
          if (Number.isFinite(v)) window.push(v);
        }
      }
      window.sort((p, q) => p - q);
      out[y * w + x] = window.length ? window[window.length >> 1] : values[y * w + x];
    }
  }
  return out;
};

// Samples real-world elevation (meters) on a samplesX x samplesY grid covering widthFt x heightFt centered on the location.
// Row 0 is the north edge, column 0 is the west edge (matches a north-up map).
export const fetchElevationGrid = async (
  location: SiteLocation,
  widthFt: number,
  heightFt: number,
  samplesX: number,
  samplesY: number
) => {
  const bounds = getGeoBounds(location, widthFt, heightFt);
  let z = ELEVATION_MAX_ZOOM;
  let range = getTileRange(bounds, z);
  while (z > 1 && (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) > ELEVATION_MAX_TILES) {
    z -= 1;
    range = getTileRange(bounds, z);
  }
  const tilesX = range.x1 - range.x0 + 1;
  const tilesY = range.y1 - range.y0 + 1;
  const mosaicW = tilesX * ELEVATION_TILE_SIZE;
  const mosaicH = tilesY * ELEVATION_TILE_SIZE;
  const mosaic = new Float32Array(mosaicW * mosaicH).fill(NaN);
  const jobs: Promise<boolean>[] = [];
  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      jobs.push(loadTerrariumTile(z, tx, ty).then(tile => {
        if (!tile) return false;
        const ox = (tx - range.x0) * ELEVATION_TILE_SIZE;
        const oy = (ty - range.y0) * ELEVATION_TILE_SIZE;
        for (let row = 0; row < ELEVATION_TILE_SIZE; row++) {
          mosaic.set(tile.subarray(row * ELEVATION_TILE_SIZE, (row + 1) * ELEVATION_TILE_SIZE), (oy + row) * mosaicW + ox);
        }
        return true;
      }));
    }
  }
  const loaded = await Promise.all(jobs);
  if (!loaded.some(Boolean)) {
    throw new Error("Couldn't download elevation data.");
  }
  const at = (px: number, py: number) => mosaic[clamp(py, 0, mosaicH - 1) * mosaicW + clamp(px, 0, mosaicW - 1)];
  const sample = (lat: number, lon: number) => {
    const gx = lonToPixel(lon, z) - range.x0 * ELEVATION_TILE_SIZE - 0.5;
    const gy = latToPixel(lat, z) - range.y0 * ELEVATION_TILE_SIZE - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };

  const raw = new Float32Array(samplesX * samplesY);
  for (let sy = 0; sy < samplesY; sy++) {
    const lat = bounds.north - (sy / Math.max(samplesY - 1, 1)) * (bounds.north - bounds.south);
    for (let sx = 0; sx < samplesX; sx++) {
      const lon = bounds.west + (sx / Math.max(samplesX - 1, 1)) * (bounds.east - bounds.west);
      raw[sy * samplesX + sx] = sample(lat, lon);
    }
  }
  const values = medianFilterGrid(raw, samplesX, samplesY);
  let min = Infinity;
  let max = -Infinity;
  values.forEach(v => {
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  });
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("No elevation data is available for that location.");
  }
  return { values, min, max, zoom: z };
};

// High-resolution US elevation (USGS 3DEP, lidar-based where available, ~1-10 m). Free, no key.
export const USGS_3DEP_EXPORT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";

export const fetchUsgsElevationGrid = async (bounds: GeoBounds, samplesX: number, samplesY: number) => {
  const params = new URLSearchParams({
    bbox: mercatorBbox(bounds),
    bboxSR: "3857",
    imageSR: "3857",
    size: `${samplesX},${samplesY}`,
    adjustAspectRatio: "false",
    format: "tiff",
    pixelType: "F32",
    interpolation: "RSP_BilinearInterpolation",
    f: "image"
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${USGS_3DEP_EXPORT}?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`USGS ${res.status}`);
    const buffer = await res.arrayBuffer();
    const { fromArrayBuffer } = await import("geotiff");
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    if (image.getWidth() !== samplesX || image.getHeight() !== samplesY) throw new Error("USGS size mismatch");
    const raster = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>;
    const noData = image.getGDALNoData();
    const values = new Float32Array(samplesX * samplesY);
    let min = Infinity;
    let max = -Infinity;
    let valid = 0;
    for (let i = 0; i < values.length; i++) {
      const v = raster[i];
      // 3DEP marks missing data with a huge negative number.
      if (!Number.isFinite(v) || v < -1000 || v > 9000 || (noData !== null && v === noData)) {
        values[i] = NaN;
        continue;
      }
      values[i] = v;
      valid++;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (valid < values.length * 0.95) throw new Error("USGS coverage incomplete");
    // Fill any small gaps from the nearest valid neighbor in the row.
    for (let i = 0; i < values.length; i++) {
      if (Number.isNaN(values[i])) values[i] = Number.isNaN(values[i - 1]) ? min : values[i - 1];
    }
    return { values, min, max };
  } finally {
    window.clearTimeout(timeout);
  }
};

/** USGS 3DEP's elevation over a site as a DEM for the trees measured from the air to check their
 * ground against (lidar's Dem: meters, about every 5 ft, up to 800 a side), or null where 3DEP
 * has none. */
export const usgsDem = async (bounds: GeoBounds, widthFt: number, heightFt: number) => {
  const spacing = Math.max(5, Math.max(widthFt, heightFt) / 800);
  const samplesX = clamp(Math.round(widthFt / spacing) + 1, 2, 800), samplesY = clamp(Math.round(heightFt / spacing) + 1, 2, 800);
  try {
    const { values } = await fetchUsgsElevationGrid(bounds, samplesX, samplesY);
    return { values, samplesX, samplesY };
  } catch (err) {
    console.warn("USGS 3DEP elevation unavailable", err);
    return null;
  }
};

/** The 3DEP Elevation Index: where its DEMs of each detail are (1 m, 1/9 and 1/3 arc-second). */
const DEM_INDEX = "https://index.nationalmap.gov/arcgis/rest/services/3DEPElevationIndex/MapServer";

/** How fine 3DEP's ground is over a site, as a progress list or the Site step names it: "USGS
 * 3DEP 1 m ground" where its 1 m DEM covers the middle of the site, 3 m or 10 m where only those
 * do, "USGS 3DEP ground" when the index can't be asked. */
export const usgsGroundLabel = async (bounds: GeoBounds) => {
  const lat = (bounds.north + bounds.south) / 2, lon = (bounds.west + bounds.east) / 2;
  const has = async (layer: number) => {
    const q = new URLSearchParams({ where: "1=1", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true", f: "json" });
    const res = await fetch(`${DEM_INDEX}/${layer}/query?${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { count?: number }).count! > 0;
  };
  try {
    for (const [layer, detail] of [[1, "1 m"], [2, "3 m"], [4, "10 m"]] as const) if (await has(layer)) return `USGS 3DEP ${detail} ground`;
  } catch {
    // (the index out of reach: said plainly)
  }
  return "USGS 3DEP ground";
};

// Best available elevation: Danmarks Højdemodel (Denmark, with a token), USGS 3DEP (US, high
// detail), else global terrain tiles.
export const fetchBestElevationGrid = async (
  location: SiteLocation,
  widthFt: number,
  heightFt: number,
  samplesX: number,
  samplesY: number
) => {
  const bounds = getGeoBounds(location, widthFt, heightFt);
  // (Denmark's own height model, with a token for it)
  if (inDenmark(bounds) && dkToken()) {
    try {
      return await dhmElevationGrid({ ...bounds, width: widthFt, height: heightFt }, samplesX, samplesY);
    } catch (err) {
      console.warn("Danmarks Højdemodel unavailable, using global terrain tiles:", err);
    }
  }
  try {
    const usgs = await fetchUsgsElevationGrid(bounds, samplesX, samplesY);
    return { ...usgs, source: "USGS 3DEP (high detail)" };
  } catch (err) {
    console.warn("USGS 3DEP elevation unavailable, using global terrain tiles:", err);
    const tiles = await fetchElevationGrid(location, widthFt, heightFt, samplesX, samplesY);
    return { values: tiles.values, min: tiles.min, max: tiles.max, source: "global terrain tiles (~10 m detail)" };
  }
};
