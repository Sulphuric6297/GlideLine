// Trees and ground measured from the air (USGS 3DEP LiDAR, kept on AWS as Entwine Point Tiles in
// web Mercator). Pure: which tiles cover a site, reading them, gathering their points on a fine
// grid (one survey, or several each covering part of the site), and turning that into the ground
// (checked against USGS 3DEP's), the canopy (roofs left out) and single trees (where each stands,
// how tall, how wide its crown spreads; a conifer only where the survey shows one), and how high
// a building stands.
import type { CourseDoc, Hole, LidarTree, P } from "../types";
import { areaPath, fairwayOutline } from "./course";
import { boundsOf, distanceToPolygon, nearestOnSegment, pointInPolygon, smoothPath } from "./geom";
import { FEET_PER_METER } from "./geo/core";
import type { GeoRef } from "./geoRef";

const R = 6378137, DEG = Math.PI / 180;
/** Web Mercator meters from latitude and longitude, and back. */
export const mercX = (lon: number) => R * lon * DEG;
export const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
const lonOf = (x: number) => x / R / DEG;
const latOf = (y: number) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG;

/** A survey's tiles: its bounds (a cube, meters), how many points across a tile, how stored. */
export type Ept = { bounds: number[]; span: number; dataType: string; srs?: { horizontal?: string } };
/** Site bounds in web Mercator meters: [minX, minY, maxX, maxY]. */
export type Box = [number, number, number, number];

export const siteBox = (ref: GeoRef, margin = 15): Box => [mercX(ref.west) - margin, mercY(ref.south) - margin, mercX(ref.east) + margin, mercY(ref.north) + margin];

/** How deep a survey's tiles go for points `spacing` m apart (its deepest; it may stop sooner). */
export const depthFor = (ept: Ept, spacing = 1) => Math.max(0, Math.floor(Math.log2((ept.bounds[3] - ept.bounds[0]) / (ept.span * spacing))));

/** The tiles over a box, down to `maxDepth`, with how many points each holds (its hierarchy read
 * as needed: a count of -1 means more of it in its own file). */
export const tilesOver = async (ept: Ept, box: Box, maxDepth: number, hierarchy: (key: string) => Promise<Record<string, number>>) => {
  const [x0, y0, , x1] = ept.bounds, size = x1 - x0;
  const over = (key: string) => {
    const [d, x, y] = key.split("-").map(Number), s = size / 2 ** d;
    const ax = x0 + x * s, ay = y0 + y * s;
    return d <= maxDepth && ax < box[2] && ax + s > box[0] && ay < box[3] && ay + s > box[1];
  };
  const tiles: { key: string; points: number }[] = [];
  const walk = async (key: string): Promise<void> => {
    const h = await hierarchy(key);
    const more: string[] = [];
    for (const [k, n] of Object.entries(h)) {
      if (!over(k)) continue;
      if (n === -1) more.push(k);
      else if (n > 0) tiles.push({ key: k, points: n });
    }
    await Promise.all(more.map(walk));
  };
  await walk("0-0-0-0");
  // (the same order however the hierarchy came in: shallow first)
  const order = (k: string) => k.split("-").map(Number);
  return tiles.sort((a, b) => { const p = order(a.key), q = order(b.key); return p[0] - q[0] || p[1] - q[1] || p[2] - q[2] || p[3] - q[3]; });
};

/** The tiles worth reading for points about half a meter apart: the shallowest depth whose tiles,
 * with those above them, hold 3 points to a square meter of ground by their own count (their
 * boxes reach past what the survey flew, so on the site that's 4 or 5), or all there are. A survey
 * keeps its points spread down its depths, each about four times as many as the one above; finer
 * than this adds a lot to read for no better crowns. */
export const tilesFor = (ept: Ept, box: Box, tiles: { key: string; points: number }[], perM2 = 3) => {
  const size = ept.bounds[3] - ept.bounds[0];
  // (web Mercator meters are longer than the ground's by 1/cos(latitude))
  const k = Math.cos(latOf((box[1] + box[3]) / 2) * DEG) ** 2;
  const depths = new Map<number, { points: number; area: number }>();
  for (const t of tiles) {
    const d = Number(t.key.split("-")[0]), s = size / 2 ** d, e = depths.get(d) ?? { points: 0, area: 0 };
    e.points += t.points;
    e.area += s * s * k;
    depths.set(d, e);
  }
  let dense = 0, upTo = Infinity;
  for (const d of [...depths.keys()].sort((a, b) => a - b)) {
    const e = depths.get(d)!;
    dense += e.points / e.area;
    if (dense >= perM2) { upTo = d; break; }
  }
  return tiles.filter(t => Number(t.key.split("-")[0]) <= upTo);
};

/** A tile's points that fall on the site: plan feet (x east, y south), height (ft, the survey's
 * datum), LAS class, how many returns the laser pulse had (a leaf or a branch lets some of it on
 * through to what's below; a roof or the ground gives back only one), and now and then when (GPS
 * seconds, as the surveys keep it). */
export type TilePoints = { n: number; x: Float32Array; y: Float32Array; z: Float32Array; cls: Uint8Array; returns: Uint8Array; times: number[] };

/** What reads compressed LAS tiles (laz-perf). */
export type LazReader = {
  HEAPU8: Uint8Array;
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  LASZip: new () => { open: (p: number, n: number) => void; getPoint: (p: number) => void; getCount: () => number; getPointLength: () => number; delete: () => void };
};

/** One compressed tile's points that fall on the site, in plan feet. */
export const readTile = (lp: LazReader, buf: Uint8Array, ref: GeoRef, box: Box): TilePoints => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fmt = buf[104] & 0x3f;
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true);
  // (where the class, the returns and the time are: from format 6 on the class has its own byte;
  // formats 0 and 2 keep no time)
  const clsAt = fmt >= 6 ? 16 : 15, timeAt = fmt >= 6 ? 22 : fmt === 0 || fmt === 2 ? -1 : 20;
  const file = lp._malloc(buf.length);
  lp.HEAPU8.set(buf, file);
  const las = new lp.LASZip();
  try {
    las.open(file, buf.length);
    const len = las.getPointLength(), n = las.getCount(), pt = lp._malloc(len);
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), cls = new Uint8Array(n), returns = new Uint8Array(n), times: number[] = [];
    const kx = ref.width / (ref.east - ref.west), ky = ref.height / (ref.north - ref.south);
    let heap = new DataView(lp.HEAPU8.buffer), m = 0;
    for (let k = 0; k < n; k++) {
      las.getPoint(pt);
      if (heap.buffer !== lp.HEAPU8.buffer) heap = new DataView(lp.HEAPU8.buffer);
      const X = heap.getInt32(pt, true) * sx + ox, Y = heap.getInt32(pt + 4, true) * sy + oy;
      if (X < box[0] || X > box[2] || Y < box[1] || Y > box[3]) continue;
      x[m] = (lonOf(X) - ref.west) * kx;
      y[m] = (ref.north - latOf(Y)) * ky;
      z[m] = (heap.getInt32(pt + 8, true) * sz + oz) * FEET_PER_METER;
      const c = heap.getUint8(pt + clsAt), r = heap.getUint8(pt + 14);
      cls[m] = fmt >= 6 ? c : c & 31;
      returns[m] = fmt >= 6 ? r >> 4 : (r >> 3) & 7;
      if (timeAt >= 0 && !(m & 63)) times.push(heap.getFloat64(pt + timeAt, true));
      m++;
    }
    lp._free(pt);
    return { n: m, x: x.slice(0, m), y: y.slice(0, m), z: z.slice(0, m), cls: cls.slice(0, m), returns: returns.slice(0, m), times };
  } finally {
    las.delete();
    lp._free(file);
  }
};

/** The cells a side of a block: what each survey covers is told by blocks (32 ft a side at 2 ft). */
const BLOCK = 16;
/** The points a block needs for a survey to cover it (about one every 2 m²). */
const BLOCK_FULL = 40;

/** A site's points gathered on a grid, `cell` ft a square: in each cell the highest of what stands
 * on the ground (unsorted points, class 1, and what grows, 3 to 5, apart), the lowest of it, the
 * lowest ground point, how many points stood there and how many of those came from a pulse with
 * more than one return, how many ground points, and whether a building point (class 6) did. Over
 * it, at twice the cell, the highest thing standing at all (for buildings' heights). Which survey
 * covers each block; every class seen, and when each survey flew (GPS times, sampled). */
export type Gathered = {
  width: number; height: number; cell: number; nx: number; ny: number;
  top1: Float32Array; topV: Float32Array; low: Float32Array; ground: Float32Array;
  nUp: Uint8Array; nMulti: Uint8Array; nGround: Uint8Array; building: Uint8Array;
  surface: Float32Array; snx: number; sny: number;
  bx: number; by: number; owner: Uint8Array; count: Uint32Array;
  classes: number[]; times: number[][];
};

/** An empty grid over a site `width` by `height` ft (cells grow past `cell` on a very big site, so
 * it stays within about 4 million cells). */
export const gatherer = (width: number, height: number, cell = 2): Gathered => {
  cell = Math.max(cell, Math.ceil(Math.sqrt((width * height) / 4e6) * 2) / 2);
  const nx = Math.max(1, Math.ceil(width / cell)), ny = Math.max(1, Math.ceil(height / cell)), n = nx * ny;
  const snx = Math.ceil(nx / 2), sny = Math.ceil(ny / 2), bx = Math.ceil(nx / BLOCK), by = Math.ceil(ny / BLOCK);
  return {
    width, height, cell, nx, ny,
    top1: new Float32Array(n).fill(-Infinity), topV: new Float32Array(n).fill(-Infinity), low: new Float32Array(n).fill(Infinity), ground: new Float32Array(n).fill(Infinity),
    nUp: new Uint8Array(n), nMulti: new Uint8Array(n), nGround: new Uint8Array(n), building: new Uint8Array(n),
    surface: new Float32Array(snx * sny).fill(-Infinity), snx, sny,
    bx, by, owner: new Uint8Array(bx * by), count: new Uint32Array(bx * by),
    classes: new Array(32).fill(0), times: []
  };
};

/** A tile's points onto the grid, for survey `survey` (1 the first): only where no survey before
 * it covers. */
export const gather = (g: Gathered, p: TilePoints, survey = 1) => {
  const { cell, nx, ny, owner, count } = g;
  const times = (g.times[survey - 1] ??= []);
  for (const t of p.times) if (times.length < 4000) times.push(t);
  for (let k = 0; k < p.n; k++) {
    const i = Math.floor(p.x[k] / cell), j = Math.floor(p.y[k] / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    const b = Math.floor(j / BLOCK) * g.bx + Math.floor(i / BLOCK);
    if (owner[b] && owner[b] !== survey) continue;
    count[b]++;
    const c = j * nx + i, cls = p.cls[k], z = p.z[k];
    g.classes[cls & 31]++;
    if (cls === 2) {
      if (z < g.ground[c]) g.ground[c] = z;
      if (g.nGround[c] < 255) g.nGround[c]++;
      continue;
    }
    // (noise, water, wires and the like stand for nothing here)
    if (cls !== 1 && cls !== 3 && cls !== 4 && cls !== 5 && cls !== 6) continue;
    const s = (j >> 1) * g.snx + (i >> 1);
    if (z > g.surface[s]) g.surface[s] = z;
    if (cls === 6) { g.building[c] = 1; continue; }
    if (cls === 1) { if (z > g.top1[c]) g.top1[c] = z; }
    else if (z > g.topV[c]) g.topV[c] = z;
    if (z < g.low[c]) g.low[c] = z;
    if (g.nUp[c] < 255) {
      g.nUp[c]++;
      if (p.returns[k] > 1) g.nMulti[c]++;
    }
  }
};

/** After a survey's points: the blocks it covers are its own (no later survey's points go there).
 * Returns how much of the site no survey covers yet (0..1) and the box round it, plan ft: only
 * what reaches the site's edges, where a survey stops short of them (a pond in the middle of one,
 * with hardly a point off its water, is no reason to read another). */
export const claim = (g: Gathered, survey: number) => {
  const span = BLOCK * g.cell, { bx, by } = g;
  for (let b = 0; b < g.owner.length; b++) {
    const i = b % bx, j = (b - i) / bx;
    // (a block on the site's far edges only partly on it: as many as its part)
    const part = (Math.min(span, g.width - i * span) * Math.min(span, g.height - j * span)) / (span * span);
    if (!g.owner[b] && g.count[b] >= BLOCK_FULL * part) g.owner[b] = survey;
    g.count[b] = 0;
  }
  const seen = new Uint8Array(g.owner.length), queue: number[] = [];
  for (let b = 0; b < g.owner.length; b++) {
    const i = b % bx, j = (b - i) / bx;
    if (!g.owner[b] && (i === 0 || j === 0 || i === bx - 1 || j === by - 1)) { seen[b] = 1; queue.push(b); }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let q = 0; q < queue.length; q++) {
    const b = queue[q], i = b % bx, j = (b - i) / bx;
    x0 = Math.min(x0, i * span); y0 = Math.min(y0, j * span);
    x1 = Math.max(x1, (i + 1) * span); y1 = Math.max(y1, (j + 1) * span);
    for (const d of [i > 0 ? b - 1 : -1, i < bx - 1 ? b + 1 : -1, b - bx, b + bx]) {
      if (d < 0 || d >= g.owner.length || seen[d] || g.owner[d]) continue;
      seen[d] = 1;
      queue.push(d);
    }
  }
  return { open: queue.length / g.owner.length, box: queue.length ? { x0, y0, x1: Math.min(g.width, x1), y1: Math.min(g.height, y1) } : null };
};

/** When a survey flew over the site, from its points' GPS times (adjusted standard GPS time, as
 * the 3DEP surveys keep it): the middle one, or null (an older survey keeping seconds of the week). */
export const flownOn = (times: number[]) => {
  const t = times.filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 10) return null;
  const mid = t[t.length >> 1];
  // (seconds of the GPS week: a week's worth, no date)
  if (t[0] >= 0 && t[t.length - 1] <= 604800) return null;
  const date = new Date(Date.UTC(1980, 0, 6) + (mid + 1e9) * 1000);
  const year = date.getUTCFullYear();
  return year >= 1995 && year <= new Date().getUTCFullYear() + 1 ? date : null;
};

/** Whether trees were in leaf when a survey flew (mid-May to mid-October), bare (November to
 * mid-April), or no telling (on the turn of the seasons, or no date). */
export const leafOnAt = (date: Date | null): boolean | null => {
  if (!date) return null;
  const day = date.getUTCMonth() * 31 + date.getUTCDate();
  if (day >= 4 * 31 + 15 && day <= 9 * 31 + 15) return true;
  if (day >= 10 * 31 || day <= 3 * 31 + 15) return false;
  return null;
};

/** The ground's elevation over a site from elsewhere (USGS 3DEP, as the import downloads it): meters,
 * `samplesX` by `samplesY` from the north-west corner to the south-east one. */
export type Dem = { values: Float32Array; samplesX: number; samplesY: number };

/** A DEM's height (ft) at a plan point, and how far it rises and falls round it (ft, its four
 * samples there). */
const demReader = (dem: Dem, width: number, height: number) => {
  const { values, samplesX: sx, samplesY: sy } = dem;
  const at = (i: number, j: number) => values[Math.min(sy - 1, Math.max(0, j)) * sx + Math.min(sx - 1, Math.max(0, i))];
  return (x: number, y: number) => {
    const fx = (x / width) * (sx - 1), fy = (y / height) * (sy - 1), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return { z: ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * FEET_PER_METER, range: (Math.max(a, b, c, d) - Math.min(a, b, c, d)) * FEET_PER_METER };
  };
};

/** The ground from the survey's ground points, cleaned: a cell more than 3 ft off the DEM (more on a
 * steep bank) is taken out, or, with no DEM, one off the plane the ground round it lies in; cells
 * with none (under buildings, water, thick cover) filled from the DEM, or from round about. */
const cleanGround = (g: Gathered, dem: Dem | null | undefined) => {
  const { nx, ny, cell } = g, ground = g.ground.slice();
  if (dem) {
    const read = demReader(dem, g.width, g.height), ref = new Float32Array(nx * ny), offs: number[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i, d = read((i + 0.5) * cell, (j + 0.5) * cell);
      ref[c] = d.z;
      if (!Number.isFinite(ground[c])) continue;
      if (Math.abs(ground[c] - d.z) > 3 + d.range) ground[c] = Infinity;
      else if (!(c % 7)) offs.push(ground[c] - d.z);
    }
    // (the survey and the DEM a little apart overall: the DEM brought to the survey's)
    offs.sort((a, b) => a - b);
    const off = offs.length ? offs[offs.length >> 1] : 0;
    for (let c = 0; c < ground.length; c++) if (!Number.isFinite(ground[c])) ground[c] = ref[c] + off;
    return ground;
  }
  // No DEM: each 16 ft block's middle height, each block tried against the plane through the
  // blocks round it (80 ft), its cells off that by more than 3 ft (and the ground's own roughness
  // there) taken out
  const B = Math.max(1, Math.round(16 / cell)), bx = Math.ceil(nx / B), by = Math.ceil(ny / B), mid = new Float32Array(bx * by).fill(NaN);
  const vals: number[] = [];
  for (let q = 0; q < by; q++) for (let p = 0; p < bx; p++) {
    vals.length = 0;
    for (let j = q * B; j < Math.min(ny, (q + 1) * B); j++) for (let i = p * B; i < Math.min(nx, (p + 1) * B); i++) if (Number.isFinite(ground[j * nx + i])) vals.push(ground[j * nx + i]);
    if (vals.length >= 3) { vals.sort((a, b) => a - b); mid[q * bx + p] = vals[vals.length >> 1]; }
  }
  for (let q = 0; q < by; q++) for (let p = 0; p < bx; p++) {
    const pts: [number, number, number][] = [];
    for (let b = q - 2; b <= q + 2; b++) for (let a = p - 2; a <= p + 2; a++) {
      if (a < 0 || b < 0 || a >= bx || b >= by || (a === p && b === q)) continue;
      const v = mid[b * bx + a];
      if (Number.isFinite(v)) pts.push([a - p, b - q, v]);
    }
    if (pts.length < 6) continue;
    let fit = planeFit(pts);
    // (once more without the blocks far off it: a roof taken for ground among them)
    const near = pts.filter(([a, b, v]) => Math.abs(v - (fit.c + fit.a * a + fit.b * b)) < 3 + 2 * fit.rms);
    if (near.length >= 6 && near.length < pts.length) fit = planeFit(near);
    const tol = 3 + 2 * fit.rms;
    for (let j = q * B; j < Math.min(ny, (q + 1) * B); j++) for (let i = p * B; i < Math.min(nx, (p + 1) * B); i++) {
      const c = j * nx + i;
      const u = ((i + 0.5) / B - 0.5) - p, v = ((j + 0.5) / B - 0.5) - q;
      if (Number.isFinite(ground[c]) && Math.abs(ground[c] - (fit.c + fit.a * u + fit.b * v)) > tol) ground[c] = Infinity;
    }
  }
  return fillGaps(ground, nx, ny);
};

/** The plane z = c + a x + b y nearest some points (least squares), and how far off it they lie (rms). */
const planeFit = (pts: [number, number, number][]) => {
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (const [x, y, z] of pts) { n++; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; }
  const mx = sx / n, my = sy / n, mz = sz / n;
  const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy;
  const a = Math.abs(det) > 1e-9 ? (cxz * cyy - cyz * cxy) / det : 0, b = Math.abs(det) > 1e-9 ? (cyz * cxx - cxz * cxy) / det : 0;
  const c = mz - a * mx - b * my;
  let e = 0;
  for (const [x, y, z] of pts) e += (z - (c + a * x + b * y)) ** 2;
  return { a, b, c, rms: Math.sqrt(e / n) };
};

/** Cells with no value (Infinity) filled from their neighbors, nearest first. */
const fillGaps = (v: Float32Array, nx: number, ny: number) => {
  let front: number[] = [];
  for (let c = 0; c < v.length; c++) if (!Number.isFinite(v[c])) front.push(c);
  if (front.length === v.length) return v.fill(0);
  while (front.length) {
    const next: number[] = [], set: [number, number][] = [];
    for (const c of front) {
      const i = c % nx, j = (c - i) / nx;
      let s = 0, k = 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1], [i - 1, j - 1], [i + 1, j + 1], [i - 1, j + 1], [i + 1, j - 1]]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const w = v[b * nx + a];
        if (Number.isFinite(w)) { s += w; k++; }
      }
      if (k) set.push([c, s / k]);
      else next.push(c);
    }
    for (const [c, w] of set) v[c] = w;
    if (!set.length) break;
    front = next;
  }
  return v;
};

/** Polygons (plan ft) as a mask on the grid, grown `grow` cells all round. */
const outlineMask = (polys: P[][], nx: number, ny: number, cell: number, grow: number) => {
  const mask = new Uint8Array(nx * ny);
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const b = boundsOf(poly);
    const j0 = Math.max(0, Math.floor(b.minY / cell)), j1 = Math.min(ny - 1, Math.floor(b.maxY / cell));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * cell, xs: number[] = [];
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const p = poly[k], q = poly[l];
        if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let i = Math.max(0, Math.ceil(xs[k] / cell - 0.5)); i <= Math.min(nx - 1, Math.floor(xs[k + 1] / cell - 0.5)); i++) mask[j * nx + i] = 1;
      }
    }
  }
  return grow ? dilate(mask, nx, ny, grow) : mask;
};

/** A mask grown `r` cells all round (a square reach). */
const dilate = (mask: Uint8Array, nx: number, ny: number, r: number) => {
  const a = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let j = 0; j < ny; j++) {
    let run = -1e9;
    for (let i = 0; i < nx; i++) { if (mask[j * nx + i]) run = i; if (i - run <= r) a[j * nx + i] = 1; }
    run = 1e9;
    for (let i = nx - 1; i >= 0; i--) { if (mask[j * nx + i]) run = i; if (run - i <= r) a[j * nx + i] = 1; }
  }
  for (let i = 0; i < nx; i++) {
    let run = -1e9;
    for (let j = 0; j < ny; j++) { if (a[j * nx + i]) run = j; if (j - run <= r) out[j * nx + i] = 1; }
    run = 1e9;
    for (let j = ny - 1; j >= 0; j--) { if (a[j * nx + i]) run = j; if (run - j <= r) out[j * nx + i] = 1; }
  }
  return out;
};

/** The site measured: the ground (ft, the survey's datum, cleaned and filled), how high the trees
 * stand over it in each cell (ft; buildings, roofs, wires and other thin streaks left out), how
 * many points stood and how many reached the ground in each, and whether the trees were in leaf.
 * Buildings: the outlines given (the maps', traced from the air), the survey's own building
 * points, and, in a survey that didn't sort what stands from what grows, every patch flat and
 * solid as a roof (the laser goes on through leaves, so a pulse that came back once off a level
 * surface is a roof). */
export type Measured = {
  nx: number; ny: number; cell: number; width: number; height: number;
  ground: Float32Array; canopy: Float32Array; nUp: Uint8Array; nMulti: Uint8Array; nGround: Uint8Array;
  surface: Float32Array; snx: number; sny: number; leafOn: boolean | null; roofs: Uint8Array;
  /** The survey told what grows apart (its vegetation classes). */
  sorted: boolean;
  /** What grows low, 2 to 25 ft up (tenths of a foot; 0: nothing, or a roof): for the bushes. */
  shrub: Uint8Array;
  /** Where the survey sorted a point as a building's (class 6). */
  bldg: Uint8Array;
};

export const measureSite = (g: Gathered, opts: { dem?: Dem | null; outlines?: P[][]; leafOn?: boolean | null } = {}): Measured => {
  const { nx, ny, cell } = g, n = nx * ny;
  const ground = cleanGround(g, opts.dem);
  // What grows: the vegetation classes, or, in a survey that only told the ground apart, all else
  const total = g.classes.reduce((a, b) => a + b, 0);
  const sorted = g.classes[3] + g.classes[4] + g.classes[5] > total * 0.002;
  const top = sorted ? g.topV : g.top1;
  const raw = new Float32Array(n).fill(NaN);
  for (let c = 0; c < n; c++) if (Number.isFinite(top[c])) raw[c] = Math.min(250, Math.max(0, top[c] - ground[c]));
  // (the highest within a cell of each: the crown's outer twigs, where the laser went in between
  // them, as in a wood bare of leaves, and cells no point fell in)
  const h = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let v = 0;
    for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) {
      const w = raw[b * nx + a];
      if (w > v) v = w;
    }
    h[j * nx + i] = v;
  }
  // Not trees: buildings, as the maps have them (and their eaves), the survey's building points
  const roofs = outlineMask(opts.outlines ?? [], nx, ny, cell, Math.round(3 / cell));
  const bld = dilate(g.building, nx, ny, 1);
  for (let c = 0; c < n; c++) if (bld[c]) roofs[c] = 1;
  if (!sorted) {
    const flat = roofLike(g, raw, h);
    for (let c = 0; c < n; c++) if (flat[c]) roofs[c] = 1;
  }
  const canopy = new Float32Array(n);
  for (let c = 0; c < n; c++) canopy[c] = roofs[c] ? 0 : h[c];
  const shrub = new Uint8Array(n);
  for (let c = 0; c < n; c++) if (!roofs[c] && h[c] >= 2 && h[c] <= 25) shrub[c] = Math.round(h[c] * 10);
  // (only where a 3 x 3 block of it stands: a wire or a fence line is one or two cells wide)
  const on = (c: number) => canopy[c] > 8;
  const core = new Uint8Array(n);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    let all = 1;
    for (let dj = -1; dj <= 1 && all; dj++) for (let di = -1; di <= 1 && all; di++) if (!on((j + dj) * nx + i + di)) all = 0;
    core[j * nx + i] = all;
  }
  const near = dilate(core, nx, ny, 1);
  for (let c = 0; c < n; c++) if (!near[c]) canopy[c] = 0;
  // (the survey's own season first, then the one it was said to fly in)
  const leafOn = leafOnAt(flownOn(g.times[0] ?? [])) ?? opts.leafOn ?? null;
  return { nx, ny, cell, width: g.width, height: g.height, ground, canopy, nUp: g.nUp, nMulti: g.nMulti, nGround: g.nGround, surface: g.surface, snx: g.snx, sny: g.sny, leafOn, roofs, sorted, shrub, bldg: g.building };
};

/** A bush the survey measured: where it stands, how tall and how wide (ft). */
export type LidarBush = [x: number, y: number, height: number, radius: number];

/** The bushes: clumps of low growth (3 to 15 ft) out from under the trees' crowns, round (no more
 * than two and a half times as long as wide: a hedge or a fence line is longer) and 3 to 24 ft
 * across, that the laser partly went through (what grows lets some of it on to the ground; a car,
 * a shed or a stack of something doesn't), or that the survey itself sorted as growing. */
export const findBushes = (m: Pick<Measured, "nx" | "ny" | "cell" | "canopy" | "shrub" | "nUp" | "nMulti" | "sorted">): LidarBush[] => {
  const { nx, ny, cell, canopy, shrub } = m, n = nx * ny;
  // (a survey measured before bushes were looked for)
  if (!shrub) return [];
  const on = (c: number) => shrub[c] >= 30 && shrub[c] <= 150 && canopy[c] <= 0;
  const seen = new Uint8Array(n), out: LidarBush[] = [];
  const stack: number[] = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0] || !on(s0)) continue;
    // (one clump: every low cell joined to it, corners too)
    let N = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, top = 0, up = 0, multi = 0, tall = false;
    seen[s0] = 1;
    stack.push(s0);
    while (stack.length) {
      const c = stack.pop()!, i = c % nx, j = (c - i) / nx;
      N++; sx += i; sy += j; sxx += i * i; syy += j * j; sxy += i * j;
      top = Math.max(top, shrub[c]); up += m.nUp[c]; multi += m.nMulti[c];
      for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) {
        const d = b * nx + a;
        if (seen[d]) continue;
        // (a clump that runs on into a tree's crown or something taller is part of that)
        if (shrub[d] > 150 || canopy[d] > 0) tall = true;
        if (!on(d)) continue;
        seen[d] = 1;
        stack.push(d);
      }
      if (N > 4000) break;
    }
    if (tall || N > 4000) continue;
    // (its cells reach a cell past the clump all round: the highest within a cell of each)
    const r = Math.sqrt((N * cell * cell) / Math.PI) - cell;
    if (r < 1.5 || r > 12) continue;
    const ax = sx / N, ay = sy / N, vxx = sxx / N - ax * ax, vyy = syy / N - ay * ay, vxy = sxy / N - ax * ay;
    const mid = (vxx + vyy) / 2, dev = Math.sqrt(Math.max(0, ((vxx - vyy) / 2) ** 2 + vxy * vxy));
    if (Math.sqrt(Math.max(0, mid + dev)) > 2.5 * Math.sqrt(Math.max(1e-6, mid - dev))) continue;
    // (and what grows lets part of the laser through: a post, a lamp, a car or a sign doesn't)
    if (multi < up * (m.sorted ? 0.08 : 0.3)) continue;
    out.push([Math.round((ax + 0.5) * cell * 10) / 10, Math.round((ay + 0.5) * cell * 10) / 10, Math.round(top) / 10, Math.round(r * 10) / 10]);
  }
  return out;
};

/** Roofs in a survey that didn't sort them out: cells 6 ft and more up where, over 10 ft round,
 * the tops stand on a plane (within a foot), three pulses in four or more came back once and the
 * points in each cell keep within 3 ft of each other (in a crown, leaves or bare, the laser goes on
 * through and comes back again from deeper in); in patches of 80 sq ft or more, out to their edges. */
const roofLike = (g: Gathered, raw: Float32Array, h: Float32Array) => {
  const { nx, ny, cell } = g, n = nx * ny;
  const R = Math.max(1, Math.round(4 / cell));
  const flat = new Uint8Array(n);
  const pts: [number, number, number][] = [];
  for (let j = R; j < ny - R; j++) for (let i = R; i < nx - R; i++) {
    const c = j * nx + i;
    if (h[c] < 6 || Number.isNaN(raw[c])) continue;
    let up = 0, multi = 0, deep = 0, cells = 0;
    pts.length = 0;
    for (let b = j - R; b <= j + R; b++) for (let a = i - R; a <= i + R; a++) {
      const d = b * nx + a;
      up += g.nUp[d];
      multi += g.nMulti[d];
      if (Number.isNaN(raw[d]) || raw[d] <= 3) continue;
      pts.push([a - i, b - j, raw[d]]);
      if (g.nUp[d] >= 2) { deep += g.top1[d] - g.low[d]; cells++; }
    }
    // (and the points in each cell stay within a few feet of each other: in a crown some go deep)
    if (up < 8 || multi > up * 0.25 || pts.length < (2 * R + 1) ** 2 * 0.5 || (cells && deep / cells > 3)) continue;
    if (planeFit(pts).rms < 1) flat[c] = 1;
  }
  // (patches big enough to be a roof, and a little round them: walls and eaves send pulses on)
  const keep = new Uint8Array(n), seen = new Uint8Array(n), level = new Float32Array(n), min = Math.round(80 / (cell * cell));
  for (let s = 0; s < n; s++) {
    if (!flat[s] || seen[s]) continue;
    const patch = [s];
    seen[s] = 1;
    for (let k = 0; k < patch.length; k++) {
      const c = patch[k], i = c % nx;
      for (const d of [c - 1, c + 1, c - nx, c + nx]) {
        if (d < 0 || d >= n || seen[d] || !flat[d] || Math.abs((d % nx) - i) > 1) continue;
        seen[d] = 1;
        patch.push(d);
      }
    }
    if (patch.length < min) continue;
    const hs = patch.map(c => h[c]).sort((a, b) => a - b), mid = hs[hs.length >> 1];
    for (const c of patch) { keep[c] = 1; level[c] = mid; }
  }
  // (out to its edges, where the plane test can't see for the walls, the eaves and the ground
  // beside them: on for up to 10 ft while it stands within 6 ft of the roof's own height)
  let front: number[] = [];
  for (let c = 0; c < n; c++) if (keep[c]) front.push(c);
  for (let step = 0; step < Math.round(10 / cell) && front.length; step++) {
    const next: number[] = [];
    for (const c of front) {
      const i = c % nx;
      for (const d of [c - 1, c + 1, c - nx, c + nx]) {
        if (d < 0 || d >= n || keep[d] || Math.abs((d % nx) - i) > 1 || h[d] < 6 || Math.abs(h[d] - level[c]) > 6) continue;
        keep[d] = 1;
        level[d] = level[c];
        next.push(d);
      }
    }
    front = next;
  }
  return dilate(keep, nx, ny, 1);
};

/** A max-first queue of cells by height. */
class Heap {
  cells: Int32Array; keys: Float32Array; size = 0;
  constructor(cap: number) { this.cells = new Int32Array(cap); this.keys = new Float32Array(cap); }
  push(c: number, k: number) {
    if (this.size === this.cells.length) {
      const cells = new Int32Array(this.size * 2), keys = new Float32Array(this.size * 2);
      cells.set(this.cells); keys.set(this.keys);
      this.cells = cells; this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] >= k) break;
      this.cells[i] = this.cells[p]; this.keys[i] = this.keys[p];
      i = p;
    }
    this.cells[i] = c; this.keys[i] = k;
  }
  pop() {
    const top = this.cells[0], c = this.cells[--this.size], k = this.keys[this.size];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= this.size) break;
      if (m + 1 < this.size && this.keys[m + 1] > this.keys[m]) m++;
      if (this.keys[m] <= k) break;
      this.cells[i] = this.cells[m]; this.keys[i] = this.keys[m];
      i = m;
    }
    this.cells[i] = c; this.keys[i] = k;
    return top;
  }
}

/** The lowest a tree's top stands (ft): lower is a bush. */
const MIN_TREE = 15;

/** How wide a crown spreads at most, for its height. */
const CROWN_MAX = 0.6;

/** Single trees in the canopy. Each top: the highest point within a reach that grows with its
 * height (at least 15 ft up). Each crown: the canopy round a top, grown out from all the tops at
 * once, highest first (each cell to the crown that reaches it first, so neighbors share the
 * canopy between them where it dips), down to the crown's lower edge (40% of its height) and out
 * at most 0.6 of its height. Two tops with no real dip between them are one tree. How wide it is:
 * the circle as big as its crown. A conifer only where it shows: narrow and pointed in a survey
 * flown in leaf, and in one flown bare, a crown that keeps the laser off the ground as a leafy
 * one couldn't then; with no telling, only a very narrow, pointed crown. */
export const findTrees = (m: { nx: number; ny: number; cell: number; canopy: Float32Array; nUp?: Uint8Array; nMulti?: Uint8Array; nGround?: Uint8Array; leafOn?: boolean | null; sorted?: boolean }): LidarTree[] => {
  const { nx, ny, cell, canopy } = m, n = nx * ny;
  // (smoothed a little: one leafy bump isn't a tree)
  const s = blur(canopy, nx, ny, Math.max(1, Math.round(2 / cell)));
  const tops: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, h = s[c];
    if (h <= MIN_TREE) continue;
    const rr = Math.max(1, Math.round((0.1 * h + 2) / cell)), r2 = rr * rr;
    let top = true;
    for (let b = Math.max(0, j - rr); b <= Math.min(ny - 1, j + rr) && top; b++) for (let a = Math.max(0, i - rr); a <= Math.min(nx - 1, i + rr); a++) {
      if ((a - i) ** 2 + (b - j) ** 2 > r2) continue;
      const v = s[b * nx + a];
      // (on a level top, the first of it)
      if (v > h || (v === h && b * nx + a < c)) { top = false; break; }
    }
    if (top) tops.push(c);
  }
  tops.sort((a, b) => s[b] - s[a]);
  // Every crown grown at once, the highest canopy first
  const label = new Int32Array(n), heap = new Heap(Math.max(16, tops.length * 4));
  const topH = tops.map(c => s[c]), cap2 = topH.map(h => ((CROWN_MAX * h) / cell) ** 2), edge = topH.map(h => Math.max(6, 0.4 * h));
  const ti = tops.map(c => c % nx), tj = tops.map(c => Math.floor(c / nx));
  tops.forEach((c, k) => { label[c] = k + 1; heap.push(c, s[c]); });
  // (the highest the canopy stays between two crowns where they meet)
  const pass = new Map<number, number>();
  while (heap.size) {
    const c = heap.pop(), L = label[c] - 1, i = c % nx, j = (c - i) / nx;
    for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) {
      const d = b * nx + a;
      if (d === c) continue;
      const M = label[d] - 1;
      if (M < 0) {
        if (canopy[d] < edge[L] || (a - ti[L]) ** 2 + (b - tj[L]) ** 2 > cap2[L]) continue;
        label[d] = L + 1;
        heap.push(d, s[d]);
      } else if (M !== L) {
        const key = Math.min(L, M) * 1e6 + Math.max(L, M), v = Math.min(s[c], s[d]);
        if (v > (pass.get(key) ?? -1)) pass.set(key, v);
      }
    }
  }
  // Tops with no real dip between them, close in: one tree (the taller's)
  const root = tops.map((_, k) => k);
  const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])));
  const pairs = [...pass].sort((a, b) => b[1] - a[1]);
  for (const [key, v] of pairs) {
    const A = find(Math.floor(key / 1e6)), B = find(key % 1e6);
    if (A === B) continue;
    const [hi, lo] = topH[A] >= topH[B] ? [A, B] : [B, A];
    const d2 = (ti[hi] - ti[lo]) ** 2 + (tj[hi] - tj[lo]) ** 2;
    if (v >= 0.9 * topH[lo] && d2 <= cap2[hi]) root[lo] = hi;
  }
  // Each tree: its crown's cells, how many points stood there and reached the ground, its top
  const cells = new Float64Array(tops.length), up = new Float64Array(tops.length), multi = new Float64Array(tops.length), down = new Float64Array(tops.length), high = new Float32Array(tops.length);
  // (and its crown's spread each way, for one that's a long thin streak: a wire)
  const mx = new Float64Array(tops.length), my = new Float64Array(tops.length), mxx = new Float64Array(tops.length), myy = new Float64Array(tops.length), mxy = new Float64Array(tops.length);
  for (let c = 0; c < n; c++) {
    if (!label[c]) continue;
    const k = find(label[c] - 1);
    cells[k]++;
    const ci = c % nx, cj = (c - ci) / nx;
    mx[k] += ci; my[k] += cj; mxx[k] += ci * ci; myy[k] += cj * cj; mxy[k] += ci * cj;
    if (m.nUp) up[k] += m.nUp[c];
    if (m.nMulti) multi[k] += m.nMulti[c];
    if (m.nGround) down[k] += m.nGround[c];
    if (canopy[c] > high[k]) high[k] = canopy[c];
  }
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const trees: LidarTree[] = [], density: number[] = [];
  tops.forEach((c, k) => {
    if (find(k) !== k) return;
    // (in a survey that didn't sort what grows: one whose pulses nearly all came back once is
    // something built, a roof's corner or a tank)
    if (m.sorted === false && multi[k] < up[k] * 0.1) return;
    const h = Math.max(high[k], topH[k]);
    const r = Math.min(Math.max(3, Math.sqrt((cells[k] * cell * cell) / Math.PI) - cell / 2), CROWN_MAX * h);
    // Not trees: a power pole (a crown hardly wider than the pole, standing tall: a real tree that
    // tall spreads 8 ft or more) and a wire (its crown a long thin streak, its width under 10 ft
    // and a third of its length or less), wherever the survey didn't sort them out
    if (r <= 3.5 && h > 12) return;
    // (a light pole's lamp head or a sign spreads wider: but it's solid, so the laser came back from
    // it once, and few points stood over its spot; a tree that small, leaves or bare, lets part of
    // each pulse on through and is hit all over)
    if (r < 9 && m.nUp && m.nMulti && (multi[k] < up[k] * 0.3 || up[k] < cells[k] * 0.35)) return;
    {
      const N = cells[k], ax = mx[k] / N, ay = my[k] / N;
      const vxx = mxx[k] / N - ax * ax, vyy = myy[k] / N - ay * ay, vxy = mxy[k] / N - ax * ay;
      const mid = (vxx + vyy) / 2, dev = Math.sqrt(Math.max(0, ((vxx - vyy) / 2) ** 2 + vxy * vxy));
      const long = Math.sqrt(Math.max(0, mid + dev)), thin = Math.sqrt(Math.max(0, mid - dev));
      if (N >= 6 && thin * 4 * cell < 10 && long > thin * 3) return;
    }
    // (how much it falls halfway out, as measured, not smoothed: a cone a good deal, a round
    // crown a little)
    let fall = 0, ways = 0;
    const out = Math.max(cell, r * 0.5);
    for (let w = 0; w < 8; w++) {
      const a = Math.round(ti[k] + (Math.cos((w * Math.PI) / 4) * out) / cell), b = Math.round(tj[k] + (Math.sin((w * Math.PI) / 4) * out) / cell);
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      fall += h - canopy[b * nx + a];
      ways++;
    }
    fall = ways ? fall / ways / h : 0;
    const solid = up[k] + down[k] > 0 ? up[k] / (up[k] + down[k]) : 0;
    const conifer = m.leafOn === true ? r / h < 0.2 && fall > 0.15 : m.leafOn === false ? solid > 0.8 && r / h < 0.3 : r / h < 0.13 && fall > 0.22;
    trees.push([round1((ti[k] + 0.5) * cell), round1((tj[k] + 0.5) * cell), round1(h), round1(r), conifer ? 1 : 0]);
    density.push(cells[k] ? up[k] / cells[k] : 0);
  });
  return withoutWires(trees, m.nUp ? density : null);
};

/**
 * Trees that are a power line: four or more small crowns in a dead straight row (each within 3 ft
 * of one line, up to 120 ft apart), about as high as each other and each thinly hit (a wire is a
 * few points, a crown is hit all over), are left out. (A pulse that grazes a wire goes on to the
 * ground, so a wire isn't solid like a pole: the row and how thinly it's hit tell it.) A row of
 * trees along a road is kept: it's hit all over.
 */
export const withoutWires = (trees: LidarTree[], density: number[] | null) => {
  const small = trees.map((t, k) => k).filter(k => trees[k][3] <= 10);
  const wire = new Set<number>();
  for (const k of small) {
    const [x, y] = trees[k];
    // (the others round it, by the way they lie from it)
    const bins = new Map<number, number[]>();
    for (const o of small) {
      if (o === k) continue;
      const dx = trees[o][0] - x, dy = trees[o][1] - y, d = Math.hypot(dx, dy);
      if (d < 10 || d > 120) continue;
      const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
      const b = Math.floor(a / 4);
      (bins.get(b) ?? bins.set(b, []).get(b)!).push(o);
    }
    for (const [b, list] of bins) {
      const cand = [...list, ...(bins.get((b + 1) % 45) ?? []), ...(bins.get((b + 44) % 45) ?? [])];
      if (cand.length < 3) continue;
      // The line through it at their mean way, and those right on it
      const a = ((b + 0.5) * 4 * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
      const on = cand.filter(o => Math.abs((trees[o][0] - x) * -uy + (trees[o][1] - y) * ux) <= 3);
      if (on.length < 3) continue;
      const row = [k, ...on];
      const hs = row.map(o => trees[o][2]).sort((p, q) => p - q), mid = hs[Math.floor(hs.length / 2)];
      const even = row.filter(o => Math.abs(trees[o][2] - mid) <= 6).length >= row.length * 0.75;
      const thin = density ? row.filter(o => density[o] < 0.9).length >= row.length * 0.75 : true;
      if (even && thin) row.forEach(o => wire.add(o));
    }
  }
  return wire.size ? trees.filter((_, k) => !wire.has(k)) : trees;
};

/** A box blur `r` cells round, run twice (near enough a Gaussian). */
const blur = (v: Float32Array, nx: number, ny: number, r: number) => {
  let src = v;
  for (let pass = 0; pass < 2; pass++) {
    const a = new Float32Array(v.length), b = new Float32Array(v.length);
    for (let j = 0; j < ny; j++) {
      let s = 0;
      const row = j * nx;
      for (let i = -r; i <= r; i++) s += src[row + Math.min(nx - 1, Math.max(0, i))];
      for (let i = 0; i < nx; i++) {
        a[row + i] = s / (2 * r + 1);
        s += src[row + Math.min(nx - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += a[Math.min(ny - 1, Math.max(0, j)) * nx + i];
      for (let j = 0; j < ny; j++) {
        b[j * nx + i] = s / (2 * r + 1);
        s += a[Math.min(ny - 1, j + r + 1) * nx + i] - a[Math.max(0, j - r) * nx + i];
      }
    }
    src = b;
  }
  return src;
};

/** How high a building stands by the survey, ft over the ground: its eaves (where its roof is
 * lowest, all but the lowest few cells of it) and its ridge (all but the highest few, which may be
 * a tree over it or a chimney); flat where the two are within 2½ ft. Read over the outline less a
 * cell all round (the walls). Null where the survey shows no roof there (built since, or too
 * small to tell). */
export const roofHeights = (m: Pick<Measured, "nx" | "ny" | "cell" | "ground" | "surface" | "snx" | "sny">, outline: P[]) => {
  if (outline.length < 3) return null;
  const sc = m.cell * 2, b = boundsOf(outline), hs: number[] = [];
  for (let j = Math.max(0, Math.floor(b.minY / sc)); j <= Math.min(m.sny - 1, Math.floor(b.maxY / sc)); j++)
    for (let i = Math.max(0, Math.floor(b.minX / sc)); i <= Math.min(m.snx - 1, Math.floor(b.maxX / sc)); i++) {
      const p = { x: (i + 0.5) * sc, y: (j + 0.5) * sc };
      if (!pointInPolygon(p, outline) || outline.some((q, k) => nearestOnSegment(p, q, outline[(k + 1) % outline.length]).distance < sc)) continue;
      const top = m.surface[j * m.snx + i], gi = Math.min(m.nx - 1, i * 2), gj = Math.min(m.ny - 1, j * 2);
      if (Number.isFinite(top)) hs.push(top - m.ground[gj * m.nx + gi]);
    }
  if (hs.length < 4) return null;
  hs.sort((a, c) => a - c);
  const at = (q: number) => hs[Math.min(hs.length - 1, Math.floor(hs.length * q))];
  // (mostly lower than a shed's walls: the ground, or a lawn where the building is now)
  if (at(0.5) < 6) return null;
  const eaves = Math.max(6, at(0.1)), ridge = Math.max(eaves, at(0.9));
  return { eaves: Math.min(80, eaves), ridge: Math.min(100, ridge), flat: ridge - eaves < 2.5 };
};

/** The ground measured, on the plan's terrain grid: heights (ft over its lowest point), its lowest
 * and highest (ft, the survey's datum). */
export const groundOnGrid = (m: { nx: number; ny: number; cell: number; ground: Float32Array }, width: number, height: number, grid: number) => {
  // (the mean of the cells within about 3 ft of the grid point)
  const reach = Math.max(1, Math.round(3 / m.cell));
  const at = (x: number, y: number) => {
    const i = Math.floor(x / m.cell), j = Math.floor(y / m.cell);
    let s = 0, k = 0;
    for (let b = j - reach; b <= j + reach; b++) for (let a = i - reach; a <= i + reach; a++) {
      if (a < 0 || b < 0 || a >= m.nx || b >= m.ny) continue;
      s += m.ground[b * m.nx + a];
      k++;
    }
    return k ? s / k : 0;
  };
  const raw: [string, number][] = [];
  let lo = Infinity, hi = -Infinity;
  for (let x = 0; x <= width + 1e-6; x += grid) for (let y = 0; y <= height + 1e-6; y += grid) {
    const v = at(x, y);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    raw.push([`${Math.round(x)},${Math.round(y)}`, v]);
  }
  const heights: Record<string, number> = {};
  for (const [k, v] of raw) if (Math.abs(v - lo) > 0.001) heights[k] = Math.round((v - lo) * 100) / 100;
  return { heights, min: lo, max: hi };
};

/** A measured tree grown `years` years: each year it grows less the nearer it is to a tree's full
 * height (small trees fastest, about 2 to 2½ ft a year; tall ones hardly), its crown widening
 * with it. Conifers grow a little slower, and taller. */
export const grownTree = (t: LidarTree, years: number, young = false): LidarTree => {
  const [x, y, h0, r0, conifer] = t;
  // (a sapling shoots up faster and stays narrow: a crown fills out later)
  const full = conifer ? 120 : 100, fast = (conifer ? 2.2 : 2.6) * (young ? 1.4 : 1), widen = young ? 0.55 : 0.8;
  let h = h0, r = r0;
  for (let i = 0; i < Math.round(years); i++) {
    const h2 = h + fast * Math.max(0, 1 - h / full) ** 1.5;
    r *= (h2 / Math.max(1, h)) ** widen;
    h = h2;
  }
  return [x, y, Math.round(h * 10) / 10, Math.round(r * 10) / 10, conifer];
};

/** A number in [0, 1) from a tree's index and a salt: the same every time, so saplings stand
 * where they stood (no library, no state). */
const spread = (k: number, salt: number) => {
  let n = (k + 1) * 2654435761 + salt * 40503;
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** The trees the survey couldn't see that would stand `years` later: saplings that came up in
 * the open gaps of a wood and at its edges (where the light gets in), one for a share of the
 * measured trees rising with the years, each born some year since and grown from a 2 ft shoot,
 * fast and narrow. Never under or against a crown: each stands clear of every measured tree's
 * crown (as it will have grown) by 3 ft, and 8 ft from another sapling; where a tree has no such
 * gap near it, none comes up. Only those tall enough to count (6 ft) are returned. */
export const saplings = (trees: LidarTree[], years: number): LidarTree[] => {
  const out: LidarTree[] = [];
  if (years < 2) return out;
  const share = Math.min(0.45, years * 0.03);
  // (the measured trees by 40 ft cell, with their crowns as they will have grown)
  const CELL = 40, cells = new Map<string, LidarTree[]>();
  const grownAll = trees.map(t => grownTree(t, years));
  for (const t of grownAll) {
    const key = `${Math.floor(t[0] / CELL)},${Math.floor(t[1] / CELL)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(t);
  }
  const placed: P[] = [];
  const clear = (x: number, y: number) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = cx - 2; i <= cx + 2; i++) for (let j = cy - 2; j <= cy + 2; j++) {
      for (const t of cells.get(`${i},${j}`) ?? []) if (Math.hypot(t[0] - x, t[1] - y) < t[3] + 3) return false;
    }
    return !placed.some(q => Math.hypot(q.x - x, q.y - y) < 8);
  };
  trees.forEach((t, k) => {
    if (spread(k, 1) >= share) return;
    const [x, y, , , conifer] = t;
    const r = grownAll[k][3];
    // (a few spots round the tree, just past its crown and further out; the first clear one)
    for (let n = 0; n < 6; n++) {
      const a = spread(k, 2 + n * 3) * Math.PI * 2, d = r + 4 + spread(k, 3 + n * 3) * (r + 14);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!clear(px, py)) continue;
      const born = spread(k, 4) * (years - 1);
      const g = grownTree([px, py, 2, 0.8, conifer], years - born, true);
      if (g[2] >= 6) {
        out.push([Math.round(g[0] * 10) / 10, Math.round(g[1] * 10) / 10, g[2], g[3], conifer]);
        placed.push({ x: px, y: py });
      }
      break;
    }
  });
  return out;
};

const grown = new WeakMap<LidarTree[], { years: number; young: boolean; size: number; out: LidarTree[] }>();
/** The course's measured trees, grown as many years as it asks (the same list when none), with
 * the saplings that came up since after them (so the measured trees keep their places in the
 * list: what was cut down or kept by index stays so), their crowns as wide as Crown size says. */
export const grownTrees = (lidar: NonNullable<CourseDoc["lidar"]>) => {
  const years = lidar.growYears ?? 0, size = lidar.crownSize ?? 1, young = lidar.saplings === true;
  if (!years && size === 1) return lidar.trees;
  const hit = grown.get(lidar.trees);
  if (hit?.years === years && hit.size === size && hit.young === young) return hit.out;
  // (the saplings grown in the gaps since only when asked for)
  const aged = years ? [...lidar.trees.map(t => grownTree(t, years)), ...(young ? saplings(lidar.trees, years) : [])] : lidar.trees;
  const out = size === 1 ? aged : aged.map(([x, y, h, r, c]): LidarTree => [x, y, h, Math.round(r * size * 10) / 10, c]);
  grown.set(lidar.trees, { years, size, young, out });
  return out;
};

/** Years since a survey (by the year in its name), or 0. */
export const yearsSince = (name: string) => { const y = surveyYear(name); return y ? Math.max(0, new Date().getFullYear() - y) : 0; };

/** A survey's year from its name: "…_2019", or USGS's newer work codes ("KY_Western_1_A22": 2022). */
export const surveyYear = (name: string) =>
  Math.max(0, ...(name.match(/(19|20)\d\d/g) ?? []).map(Number), ...[...name.matchAll(/(?:^|_)[A-Z](\d\d)(?=_|$)/g)].map(m => 2000 + Number(m[1])));

/** The measured trees a change took a woods away from: every tree that stood inside a woods area
 * whose outline the change moved, or that it deleted (or made something else), added to the
 * woods' own (`lidar.bound`). Null when nothing changed for them. */
export const bindToWoods = (before: CourseDoc, after: CourseDoc): number[] | null => {
  const lidar = after.lidar;
  if (!lidar?.trees.length || before.items === after.items) return null;
  const now = new Map(after.items.map(i => [i.id, i]));
  const left: P[][] = [];
  for (const it of before.items) {
    if (it.type !== "area" || it.kind !== "woods" || it.points.length < 3) continue;
    const n = now.get(it.id);
    if (n === it || (n && n.type === "area" && n.kind === "woods" && n.points === it.points && n.straight === it.straight)) continue;
    left.push(areaPath(it));
  }
  if (!left.length) return null;
  const bound = new Set(lidar.bound ?? []), had = bound.size;
  for (const pts of left) {
    const b = boundsOf(pts);
    lidar.trees.forEach(([x, y], k) => {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || bound.has(k)) return;
      if (pointInPolygon({ x, y }, pts)) bound.add(k);
    });
  }
  return bound.size === had ? null : [...bound].sort((a, b) => a - b);
};

/** Which measured trees stand: any taken out are gone; with `clearFairways`, those on a fairway, a
 * tee or a basket's circle (as `cleared` says) are cut down unless kept; a woods' own tree only
 * while a woods covers it (`inWoods`). */
export const standingTrees = (lidar: NonNullable<CourseDoc["lidar"]>, cleared: (p: P, reach: number) => boolean, nowhere: (p: P) => boolean = () => false, inWoods: (p: P) => boolean = () => true) => {
  const kept = new Set(lidar.kept ?? []), removed = new Set(lidar.removed ?? []), bound = new Set(lidar.bound ?? []);
  // (unless the course asks for its fairways cleared, measured trees stand where the holes play:
  // cut by hand, or a hole's Clear them)
  if (lidar.clearFairways !== true) cleared = () => false;
  const stand: number[] = [], cut: number[] = [];
  lidar.trees.forEach((t, k) => {
    const p = { x: t[0], y: t[1] };
    if (removed.has(k)) cut.push(k);
    // (a woods' own tree, with no woods over it now)
    else if (bound.has(k) && !inWoods(p)) cut.push(k);
    // (cleared for play, or where no tree stands: in water, on a road or path, a building or
    // parking; a tree found there is a bridge, a car, a wire or noise in the survey)
    // (and those smaller than the course wants: bushes, noise)
    else if (!kept.has(k) && (cleared(p, t[3] * 0.3) || nowhere(p) || t[2] < (lidar.minHeight ?? 0))) cut.push(k);
    else stand.push(k);
  });
  return { stand: withoutTwins(lidar.trees, stand, kept, removed), cut };
};

/** Standing trees less any that are one tree found twice: one standing closer to a taller one than
 * the survey can tell two treetops apart (half its search window for that height, 0.07 H + 3 m,
 * as lidR has it), or well inside its crown at about its height. Not cut (no stump): the taller is
 * the tree, in 3D and on the map alike. A tree kept by hand always stands. A tree taken out by hand
 * (cut down, or made the course's own to move or delete) still counts as the taller one: its twin
 * never stands up in its place. */
const withoutTwins = (trees: LidarTree[], stand: number[], kept: Set<number>, removed: Set<number> = new Set()) => {
  const CELL = 40, grid = new Map<string, number[]>();
  const at = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  const tallest = [...stand, ...[...removed].filter(k => !!trees[k])].sort((a, b) => trees[b][2] - trees[a][2]);
  const out = new Set<number>();
  for (const k of tallest) {
    const [x, y, h, r] = trees[k];
    let twin = false;
    if (!kept.has(k)) {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let gy = cy - 1; gy <= cy + 1 && !twin; gy++) for (let gx = cx - 1; gx <= cx + 1 && !twin; gx++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          const [x2, y2, h2, r2] = trees[j], d = Math.hypot(x - x2, y - y2);
          const window = ((0.07 * (h2 / 3.28084) + 3) / 2) * 3.28084;
          if (d < window || (d < 0.5 * Math.max(r, r2) && h2 - h < 0.25 * h2)) { twin = true; break; }
        }
      }
    }
    if (twin) continue;
    if (!removed.has(k)) out.add(k);
    const key = at(x, y);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
  }
  return stand.filter(k => out.has(k));
};

/** The measured trees on a hole's fairway (its line as played): those cut down (taken out, or
 * cleared for play), those kept standing where the fairways are cleared, and those standing in the
 * way where they aren't. */
export const fairwayTrees = (doc: Pick<CourseDoc, "lidar">, hole: Hole, line: P[]) => {
  const out = { cut: [] as number[], kept: [] as number[], standing: [] as number[] };
  const lidar = doc.lidar;
  if (!lidar?.trees.length || line.length < 2) return out;
  const poly = fairwayOutline(hole, smoothPath(line, 8), hole.fairway ? 0 : -hole.fairwayWidth * 0.4, 6);
  const box = boundsOf(poly), kept = new Set(lidar.kept ?? []), removed = new Set(lidar.removed ?? []), clearing = lidar.clearFairways === true;
  lidar.trees.forEach(([x, y, , r], k) => {
    const reach = r * 0.3;
    if (x < box.minX - reach || x > box.maxX + reach || y < box.minY - reach || y > box.maxY + reach) return;
    if (!pointInPolygon({ x, y }, poly) && distanceToPolygon({ x, y }, poly) >= reach) return;
    if (removed.has(k)) out.cut.push(k);
    else if (!clearing) out.standing.push(k);
    else (kept.has(k) ? out.kept : out.cut).push(k);
  });
  return out;
};
