// Denmark's own maps, from Dataforsyningen (Klimadatastyrelsen; free, with a free token, and
// open to any website): the ground and the surface of Danmarks Højdemodel (DHM, 0.4 m), so the
// trees standing on it (the surface over the ground), and the spring aerial photo. The token is
// the visitor's own, kept in this browser only.
import { FEET_PER_METER, type GeoBounds } from "./core";
import type { GeoRef } from "../geoRef";
import { gatherer, type Measured } from "../lidar";
import { measureGathered } from "./lidarFetch";
import type { LidarTree, P } from "../../types";

export { DK_REGIONS, inDenmark } from "./dkArea";

export const DATAFORSYNINGEN = "https://api.dataforsyningen.dk";
/** Where a free token is made. */
export const DK_TOKEN_PAGE = "https://dataforsyningen.dk/";
export const DHM_CREDIT = "Danmarks Højdemodel © Klimadatastyrelsen";
export const ORTO_CREDIT = "GeoDanmark ortofoto © Klimadatastyrelsen";

// ---------------------------------------------------------------- the token

const TOKEN_KEY = "glideline-dk-token";
const listeners = new Set<() => void>();
export const dkToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
};
/** Whether text could be a token (letters, digits, - and _, no spaces; 8 to 128 of them): what's
 * typed or pasted is saved, and sent to Dataforsyningen, only then. */
export const dkTokenLike = (text: string) => /^[A-Za-z0-9_-]{8,128}$/.test(text.trim());
export const setDkToken = (token: string) => {
  try {
    if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // (storage blocked: the token is gone with the page)
  }
  listeners.forEach(f => f());
};
export const onDkToken = (f: () => void) => {
  listeners.add(f);
  return () => { listeners.delete(f); };
};

// ---------------------------------------------------------------- UTM zone 32 (ETRS89)

const A = 6378137, F = 1 / 298.257222101, K0 = 0.9996;
/** Latitude and longitude to ETRS89 / UTM zone 32N (EPSG:25832), meters. */
export const toUtm32 = (lat: number, lon: number) => {
  const e2 = F * (2 - F), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = ((lon - 9) * Math.PI) / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, a = c * lam;
  const M = A * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * a ** 5) / 120) + 500000;
  const y = K0 * (M + N * t * ((a * a) / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * a ** 6) / 720));
  return { x, y };
};

// ---------------------------------------------------------------- the height model

export type DhmLayer = "dhm_terraen" | "dhm_overflade";

/** A raster in UTM 32: its box (m), size, and values (m above sea; NaN where none). */
type Raster = { x0: number; y1: number; px: number; w: number; h: number; v: Float32Array };

/** The UTM box round a site, `margin` m out. */
const utmBox = (b: GeoBounds, margin: number) => {
  const cs = [toUtm32(b.north, b.west), toUtm32(b.north, b.east), toUtm32(b.south, b.west), toUtm32(b.south, b.east)];
  return { x0: Math.min(...cs.map(c => c.x)) - margin, y0: Math.min(...cs.map(c => c.y)) - margin, x1: Math.max(...cs.map(c => c.x)) + margin, y1: Math.max(...cs.map(c => c.y)) + margin };
};

/** The most pixels a side one request asks for: a bigger one can time out at Dataforsyningen. */
export const DHM_TILE = 800;

/** One piece of a layer (a GetCoverage), as values row by row from the north; tried three times
 * (Dataforsyningen sometimes answers a busy moment with a 502 or 504). */
const dhmPiece = async (layer: DhmLayer, x0: number, y0: number, w: number, h: number, px: number, token: string, signal?: AbortSignal) => {
  const q = new URLSearchParams({
    service: "WCS", version: "1.0.0", request: "GetCoverage", coverage: layer,
    crs: "EPSG:25832", response_crs: "EPSG:25832",
    bbox: [x0, y0, x0 + w * px, y0 + h * px].map(v => v.toFixed(2)).join(","),
    width: String(w), height: String(h), format: "GTiff", token
  });
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 800 * attempt));
    try {
      const res = await fetch(`${DATAFORSYNINGEN}/dhm_wcs_DAF?${q}`, { signal });
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Dataforsyningen refused the token"), { final: true });
      if (!res.ok) throw new Error(`Dataforsyningen ${res.status}`);
      const { fromArrayBuffer } = await import("geotiff");
      const image = await (await fromArrayBuffer(await res.arrayBuffer())).getImage();
      if (image.getWidth() !== w || image.getHeight() !== h) throw Object.assign(new Error("The height model sent another size"), { final: true });
      const raster = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>;
      return { raster, noData: image.getGDALNoData() };
    } catch (err) {
      if (signal?.aborted || (err as { final?: boolean }).final) throw err;
      last = err;
    }
  }
  throw last;
};

/** One layer of the height model over a site, `px` m a pixel: asked for in pieces of at most
 * DHM_TILE pixels a side, four at a time. */
export const fetchDhm = async (b: GeoBounds, layer: DhmLayer, px: number, opts: { token?: string; signal?: AbortSignal; onPiece?: () => void } = {}): Promise<Raster> => {
  const token = opts.token ?? dkToken();
  if (!token) throw new Error("No Dataforsyningen token");
  const box = utmBox(b, 4 * px);
  const w = Math.max(2, Math.ceil((box.x1 - box.x0) / px)), h = Math.max(2, Math.ceil((box.y1 - box.y0) / px));
  const y1 = box.y0 + h * px;
  const v = new Float32Array(w * h).fill(NaN);
  const pieces: [number, number, number, number][] = [];
  for (let j = 0; j < h; j += DHM_TILE) for (let i = 0; i < w; i += DHM_TILE) pieces.push([i, j, Math.min(DHM_TILE, w - i), Math.min(DHM_TILE, h - j)]);
  let next = 0, valid = 0;
  const worker = async () => {
    while (next < pieces.length) {
      const [i, j, pw, ph] = pieces[next++];
      const { raster, noData } = await dhmPiece(layer, box.x0 + i * px, y1 - (j + ph) * px, pw, ph, px, token, opts.signal);
      for (let b2 = 0; b2 < ph; b2++) for (let a = 0; a < pw; a++) {
        const z = raster[b2 * pw + a];
        if (!Number.isFinite(z) || z < -100 || z > 500 || (noData !== null && z === noData)) continue;
        v[(j + b2) * w + i + a] = z;
        valid++;
      }
      opts.onPiece?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pieces.length) }, worker));
  if (valid < v.length * 0.5) throw new Error("The height model has no ground here");
  return { x0: box.x0, y1, px, w, h, v };
};

/** How many pieces a layer over a site comes in. */
export const dhmPieces = (b: GeoBounds, px: number) => {
  const box = utmBox(b, 4 * px);
  return Math.ceil((box.x1 - box.x0) / px / DHM_TILE) * Math.ceil((box.y1 - box.y0) / px / DHM_TILE);
};

/** A raster's value at a spot (m), between its four nearest pixels. */
const sampler = (r: Raster) => (x: number, y: number) => {
  const fx = (x - r.x0) / r.px - 0.5, fy = (r.y1 - y) / r.px - 0.5;
  const i = Math.max(0, Math.min(r.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(r.h - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - i)), ty = Math.max(0, Math.min(1, fy - j));
  const at = (a: number, b: number) => r.v[b * r.w + a];
  const p = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)], k = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  let s = 0, n = 0;
  for (let q = 0; q < 4; q++) if (!Number.isNaN(p[q])) { s += p[q] * k[q]; n += k[q]; }
  return n > 0 ? s / n : NaN;
};

/** Plan (ft) to UTM 32 (m), for a site: between its four corners (over a mile or two the
 * projection is straight to well under an inch, and millions of cells are quick). */
const planToUtm = (ref: GeoRef) => {
  const nw = toUtm32(ref.north, ref.west), ne = toUtm32(ref.north, ref.east), sw = toUtm32(ref.south, ref.west), se = toUtm32(ref.south, ref.east);
  return (x: number, y: number) => {
    const u = x / ref.width, v = y / ref.height;
    return { x: (nw.x * (1 - u) + ne.x * u) * (1 - v) + (sw.x * (1 - u) + se.x * u) * v, y: (nw.y * (1 - u) + ne.y * u) * (1 - v) + (sw.y * (1 - u) + se.y * u) * v };
  };
};

/** The ground's elevation over a site as the import's sample grid (m, row 0 north), from the
 * height model's ground. */
export const dhmElevationGrid = async (ref: GeoRef, samplesX: number, samplesY: number, opts: { signal?: AbortSignal } = {}) => {
  const px = Math.max(0.4, Math.max(ref.width, ref.height) / FEET_PER_METER / 2000);
  const r = await fetchDhm(ref, "dhm_terraen", px, opts);
  const at = sampler(r), utm = planToUtm(ref);
  const values = new Float32Array(samplesX * samplesY);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < samplesY; j++) for (let i = 0; i < samplesX; i++) {
    const u = utm((i / Math.max(1, samplesX - 1)) * ref.width, (j / Math.max(1, samplesY - 1)) * ref.height);
    const z = at(u.x, u.y);
    values[j * samplesX + i] = z;
    if (Number.isFinite(z)) { min = Math.min(min, z); max = Math.max(max, z); }
  }
  if (!Number.isFinite(min)) throw new Error("The height model has no ground here");
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) values[i] = min;
  return { values, min, max, source: "Danmarks Højdemodel (0.4 m)" };
};

/** The tallest a tree in Denmark stands (ft): its tallest are about 50 m. */
export const DK_TALLEST_FT = 150;

/** The site's trees and ground from the height model: its ground, and its surface over the
 * ground where something stands (buildings left out by their outlines), measured the same way as
 * a LiDAR survey's points. The model is flown in spring, before the leaves. */
export const dhmLidar = async (ref: GeoRef, onProgress: (f: number) => void = () => {}, opts: { signal?: AbortSignal; outlines?: P[][] | Promise<P[][]> } = {}): Promise<{ source: string; label: string; surveys: { name: string; year: number; flown: null; leafOn: boolean }[]; trees: LidarTree[]; measured: Measured; undergrowth: null }> => {
  const g = gatherer(ref.width, ref.height);
  const px = Math.max(0.4, (g.cell / FEET_PER_METER) * 0.75);
  let done = 0;
  const all = 2 * dhmPieces(ref, px);
  const piece = { ...opts, onPiece: () => onProgress((0.85 * ++done) / all) };
  const [ground, surface] = await Promise.all([fetchDhm(ref, "dhm_terraen", px, piece), fetchDhm(ref, "dhm_overflade", px, piece)]);
  const atG = sampler(ground), atS = sampler(surface), utm = planToUtm(ref);
  const { nx, ny, cell, snx } = g;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    const u = utm((i + 0.5) * cell, (j + 0.5) * cell);
    const z = atG(u.x, u.y), top = atS(u.x, u.y);
    if (!Number.isFinite(z)) continue;
    g.ground[c] = z * FEET_PER_METER;
    g.nGround[c] = 4;
    if (!Number.isFinite(top)) continue;
    const t = Math.max(z, top) * FEET_PER_METER;
    // (something stands here: what the surface has over the ground)
    if (t - g.ground[c] > 1) {
      g.top1[c] = g.topV[c] = g.low[c] = t;
      g.nUp[c] = 4;
      g.nMulti[c] = 2;
    }
    const s = (j >> 1) * snx + (i >> 1);
    if (t > g.surface[s]) g.surface[s] = t;
  }
  g.owner.fill(1);
  // (what grows is told apart: the surface over the ground, buildings left out by their outlines)
  g.classes[3] = 1;
  const outlines = await Promise.resolve(opts.outlines ?? []).catch(() => [] as P[][]);
  const { measured, trees: found } = await measureGathered(g, outlines, false);
  // (nothing grows that tall here: a tower's roof the maps have no outline for)
  const trees = found.filter(t => t[2] <= DK_TALLEST_FT);
  onProgress(1);
  return { source: "DHM", label: "Danmarks Højdemodel", surveys: [{ name: "DHM", year: 0, flown: null, leafOn: false }], trees, measured, undergrowth: null };
};
