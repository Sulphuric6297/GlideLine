// Underbrush from the air: where brush grows on a site, as a chance for every 10 ft block, from the
// aerial survey (what stands 1.5 to 12 ft up, and how much of the laser it stops before the ground)
// and the satellite's seasons (how green a spot is in winter, as the leaves come and in summer),
// and how near water it is. Weighed as the brush hand-drawn on a real course was (Old Siler, 2026:
// survey and satellite together found about two of every three of its patches). Then, as the
// import's How much and How thick ask, underbrush areas: light, medium and heavy, never on a
// building, a road, parking or water.
import type { AreaItem, P } from "../types";
import type { TilePoints } from "./lidar";
import { generateId } from "../constants";
import { centroid, pointInPolygon } from "./geom";

/** A block's side, ft. */
export const UG_BLOCK = 10;
const CELL = 2, PER = UG_BLOCK / CELL;

// ---------------------------------------------------------------- the survey's points

/** The survey's points gathered for the brush: in each 2 ft cell whether anything stands 1.5 to
 * 12 ft up and how high the tallest is; in each block how many points came back from 1.5 to 12 ft,
 * from the ground, from 20 ft and up, and in all. Heights from the USGS ground (DEM), brought to
 * the survey's own ground. */
export type UgGather = {
  nx: number; ny: number; bx: number; by: number;
  low: Uint8Array; top: Int16Array;
  under: Uint32Array; ground: Uint32Array; high: Uint32Array; all: Uint32Array;
  dem: ((x: number, y: number) => number) | null; off: number | null; samples: number[]; waiting: TilePoints[];
};

export const ugGatherer = (width: number, height: number): UgGather => {
  const nx = Math.ceil(width / CELL), ny = Math.ceil(height / CELL), bx = Math.ceil(nx / PER), by = Math.ceil(ny / PER);
  return {
    nx, ny, bx, by,
    low: new Uint8Array(nx * ny), top: new Int16Array(nx * ny).fill(-32768),
    under: new Uint32Array(bx * by), ground: new Uint32Array(bx * by), high: new Uint32Array(bx * by), all: new Uint32Array(bx * by),
    dem: null, off: null, samples: [], waiting: []
  };
};

/** The DEM (heights in metres on a samplesX by samplesY grid over the site) as a height in feet at
 * a plan point. */
export const demHeights = (dem: { values: Float32Array; samplesX: number; samplesY: number }, width: number, height: number) => {
  const { values: v, samplesX: sx, samplesY: sy } = dem;
  return (x: number, y: number) => {
    const fx = Math.max(0, Math.min(sx - 1.001, (x / width) * (sx - 1))), fy = Math.max(0, Math.min(sy - 1.001, (y / height) * (sy - 1)));
    const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
    return ((v[j * sx + i] * (1 - tx) + v[j * sx + i + 1] * tx) * (1 - ty) + (v[(j + 1) * sx + i] * (1 - tx) + v[(j + 1) * sx + i + 1] * tx) * ty) * 3.28084;
  };
};

// (noise, wires, water and bridges stand for nothing here)
const SKIP = new Set([7, 9, 17, 18]);

const add = (u: UgGather, p: TilePoints) => {
  const dem = u.dem!, off = u.off!;
  for (let k = 0; k < p.n; k++) {
    if (SKIP.has(p.cls[k])) continue;
    const i = Math.floor(p.x[k] / CELL), j = Math.floor(p.y[k] / CELL);
    if (i < 0 || j < 0 || i >= u.nx || j >= u.ny) continue;
    const h = p.z[k] - dem(p.x[k], p.y[k]) - off;
    if (h < -6 || h >= 40) continue;
    const c = j * u.nx + i, q = Math.floor(j / PER) * u.bx + Math.floor(i / PER);
    u.all[q]++;
    if (h >= 1.5 && h < 12) { u.under[q]++; u.low[c] = 1; }
    else if (h > -1.5 && h < 1.5) u.ground[q]++;
    if (h >= 19.5) u.high[q]++;
    const t = Math.round(h * 4);
    if (t > u.top[c]) u.top[c] = t;
  }
};

// (the survey's ground and the DEM a little apart: the middle of where the survey's ground points
// stand on it, from the first two thousand of them)
const sample = (u: UgGather, p: TilePoints) => {
  for (let k = 0; k < p.n && u.samples.length < 20000; k += 3) if (p.cls[k] === 2) u.samples.push(p.z[k] - u.dem!(p.x[k], p.y[k]));
};
const settle = (u: UgGather, force = false) => {
  if (u.off !== null || !u.dem || (!force && u.samples.length < 2000)) return;
  const s = u.samples.slice().sort((a, b) => a - b);
  u.off = s.length ? s[s.length >> 1] : 0;
  for (const p of u.waiting) add(u, p);
  u.waiting = [];
};

/** A tile's points, as they come (held until the DEM and the survey's ground are known). */
export const ugFeed = (u: UgGather, p: TilePoints) => {
  if (u.dem && u.off !== null) return add(u, p);
  u.waiting.push(p);
  if (u.dem) { sample(u, p); settle(u); }
};
/** The DEM in: the points held so far placed. */
export const ugDem = (u: UgGather, dem: (x: number, y: number) => number) => {
  u.dem = dem;
  for (const p of u.waiting) sample(u, p);
  settle(u);
};

/** What the survey says of each block, each read over about 50 ft round it: how much of it has
 * anything 1.5 to 12 ft up, how much of it has that as its tallest, how much of the laser low
 * growth stops under the trees, and how wooded it is. Null without a DEM. */
export type UgSurvey = { bx: number; by: number; low: Float32Array; shrub: Float32Array; stop: Float32Array; wood: Float32Array };
export const ugSurvey = (u: UgGather): UgSurvey | null => {
  if (!u.dem) return null;
  settle(u, true);
  const { nx, ny, bx, by } = u, n = bx * by;
  const low = new Float32Array(n), shrub = new Float32Array(n), cells = new Float32Array(n), stop = new Float32Array(n).fill(NaN), wooded = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, q = Math.floor(j / PER) * bx + Math.floor(i / PER);
    cells[q]++;
    if (u.low[c]) low[q]++;
    if (u.top[c] >= 6 && u.top[c] < 48) shrub[q]++;
  }
  for (let q = 0; q < n; q++) {
    low[q] /= Math.max(1, cells[q]); shrub[q] /= Math.max(1, cells[q]);
    wooded[q] = u.all[q] >= 40 && u.high[q] / u.all[q] > 0.15 ? 1 : 0;
    if (wooded[q] && u.under[q] + u.ground[q] >= 15) stop[q] = u.under[q] / (u.under[q] + u.ground[q]);
  }
  return { bx, by, low: smooth(low, bx, by), shrub: smooth(shrub, bx, by), stop: smooth(stop, bx, by), wood: smooth(wooded, bx, by) };
};

/** The mean over the blocks within two of each (none counted: 0). */
const smooth = (a: Float32Array, bx: number, by: number, R = 2) => {
  const o = new Float32Array(bx * by);
  for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let t = 0, k = 0;
    for (let b = Math.max(0, j - R); b <= Math.min(by - 1, j + R); b++) for (let a2 = Math.max(0, i - R); a2 <= Math.min(bx - 1, i + R); a2++) {
      const v = a[b * bx + a2];
      if (!Number.isNaN(v)) { t += v; k++; }
    }
    o[j * bx + i] = k ? t / k : 0;
  }
  return o;
};

// ---------------------------------------------------------------- the chance of brush

/** The satellite's seasons: each a greenness (NDVI) picture over the site, -1 to 1 (NaN: none). */
export type Seasons = { w: number; h: number; winter: Float32Array; spring: Float32Array; summer: Float32Array; dates: string[] };

// The weights, as Old Siler's hand-drawn brush has them (2026; see the comment at the top): with
// both, the survey alone, or the satellite alone
const WEIGHTS = {
  both: { bias: -8.4411, low: 1.0737, shrub: -0.4822, stop: -1.2429, nearWater: 2.2545, wood: -0.3748, winter: 5.5091, spring: 1.4485, summer: 7.852, springGain: -1.4428, summerGain: 7.8888 },
  survey: { bias: -0.4311, low: 1.5175, shrub: 1.002, stop: -1.2768, nearWater: -0.0276, wood: 0.499 },
  satellite: { bias: -8.4454, winter: 5.4209, spring: 1.889, summer: 7.3317, springGain: -0.1083, summerGain: 7.1425, nearWater: 1.9179 }
} as const;

/** Brush on a site: the chance of it in each block (0 to 1; NaN where it never goes: on a
 * building, a road, parking or water), and what it came from. */
export type Underbrush = { bx: number; by: number; chance: Float32Array; from: "both" | "survey" | "satellite"; surveyYear?: number; seenFrom?: string };

/**
 * The chance of brush in each block. `water` the site's water (areas and the lines of creeks), for
 * how near each block is; `never` where it never goes. Null with neither the survey nor the
 * satellite.
 */
export const underbrushChance = (width: number, height: number, survey: UgSurvey | null, seasons: Seasons | null, water: { areas: P[][]; lines: P[][] }, never: (p: P) => boolean, roofs?: { nx: number; ny: number; cell: number; roofs: Uint8Array }): Underbrush | null => {
  if (!survey && !seasons) return null;
  const bx = survey?.bx ?? Math.ceil(width / UG_BLOCK), by = survey?.by ?? Math.ceil(height / UG_BLOCK), n = bx * by;
  const from = survey && seasons ? "both" : survey ? "survey" : "satellite";
  const W = WEIGHTS[from] as Record<string, number>;
  const near = nearWater(bx, by, water);
  const at = (img: Float32Array, x: number, y: number) => {
    if (!seasons) return NaN;
    const fx = Math.max(0, Math.min(seasons.w - 1.001, (x / width) * seasons.w - 0.5)), fy = Math.max(0, Math.min(seasons.h - 1.001, (y / height) * seasons.h - 0.5));
    const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, w = seasons.w;
    return (img[j * w + i] * (1 - tx) + img[j * w + i + 1] * tx) * (1 - ty) + (img[(j + 1) * w + i] * (1 - tx) + img[(j + 1) * w + i + 1] * tx) * ty;
  };
  const off = offLimits(bx, by, never, roofs);
  const chance = new Float32Array(n).fill(NaN);
  for (let q = 0; q < n; q++) {
    if (off[q]) continue;
    const i = q % bx, j = (q - i) / bx, x = (i + 0.5) * UG_BLOCK, y = (j + 0.5) * UG_BLOCK;
    const f: Record<string, number> = { nearWater: near[q] };
    if (survey) { f.low = survey.low[q]; f.shrub = survey.shrub[q]; f.stop = survey.stop[q]; f.wood = survey.wood[q]; }
    if (seasons) {
      f.winter = at(seasons.winter, x, y); f.spring = at(seasons.spring, x, y); f.summer = at(seasons.summer, x, y);
      f.springGain = f.spring - f.winter; f.summerGain = f.summer - f.winter;
    }
    let s = W.bias;
    for (const k in W) if (k !== "bias") s += W[k] * (f[k] ?? 0);
    chance[q] = Number.isFinite(s) ? 1 / (1 + Math.exp(-s)) : NaN;
  }
  return { bx, by, chance, from };
};

/** How near water each block is: 1 in it, fading over about 60 ft (distance by eight-way steps). */
const nearWater = (bx: number, by: number, water: { areas: P[][]; lines: P[][] }) => {
  const n = bx * by, d = new Float32Array(n).fill(1e9);
  const c = document.createElement("canvas");
  c.width = bx; c.height = by;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.scale(1 / UG_BLOCK, 1 / UG_BLOCK);
  g.fillStyle = g.strokeStyle = "#fff";
  for (const a of water.areas) { if (a.length < 3) continue; g.beginPath(); a.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); }
  g.lineWidth = 12;
  for (const l of water.lines) { if (l.length < 2) continue; g.beginPath(); l.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
  const px = g.getImageData(0, 0, bx, by).data;
  for (let q = 0; q < n; q++) if (px[q * 4 + 3] > 64) d[q] = 0;
  // (two passes of the chamfer: 10 ft a step, 14 ft a step corner to corner)
  for (let pass = 0; pass < 2; pass++) {
    const fw = pass === 0;
    for (let jj = 0; jj < by; jj++) for (let ii = 0; ii < bx; ii++) {
      const j = fw ? jj : by - 1 - jj, i = fw ? ii : bx - 1 - ii, q = j * bx + i, s = fw ? -1 : 1;
      const look = (a: number, b: number, w: number) => { if (a < 0 || b < 0 || a >= bx || b >= by) return; const v = d[b * bx + a] + w; if (v < d[q]) d[q] = v; };
      look(i + s, j, 10); look(i, j + s, 10); look(i + s, j + s, 14.1); look(i - s, j + s, 14.1);
    }
  }
  return Float32Array.from(d, v => Math.exp(-v / 60));
};

/** The blocks brush never takes: any with a corner or its middle on a building, a road, parking or
 * water, and any the survey found a roof in or beside. */
const offLimits = (bx: number, by: number, never: (p: P) => boolean, roofs?: { nx: number; ny: number; cell: number; roofs: Uint8Array }) => {
  const off = new Uint8Array(bx * by);
  for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    const x = i * UG_BLOCK, y = j * UG_BLOCK, B = UG_BLOCK;
    if ([[x + B / 2, y + B / 2], [x, y], [x + B, y], [x, y + B], [x + B, y + B]].some(([a, b]) => never({ x: a, y: b }))) off[j * bx + i] = 1;
  }
  if (roofs) {
    const k = UG_BLOCK / roofs.cell;
    for (let c = 0; c < roofs.roofs.length; c++) {
      if (!roofs.roofs[c]) continue;
      const i = Math.floor((c % roofs.nx) / k), j = Math.floor(Math.floor(c / roofs.nx) / k);
      for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) if (a >= 0 && b >= 0 && a < bx && b < by) off[b * bx + a] = 1;
    }
  }
  return off;
};

// ---------------------------------------------------------------- as the import asks

/** How much brush (0 only the surest .. 4 every hint; 2 the best guess) and how thick (-1 thinner
 * .. 1 thicker), and patches made lighter by hand (by a block in them: how many steps lighter). */
export type BrushTune = { much: number; thick: number; set?: Record<number, number> };
export const BEST_GUESS: BrushTune = { much: 2, thick: 0 };

// (the chance a block needs for brush at each step of How much; and over it, how much more for
// medium and for heavy, as How thick moves them)
const AT = [0.75, 0.62, 0.5, 0.4, 0.3];

/** Each block's level as tuned: 0 none, 1 light, 2 medium, 3 heavy (NaN: never). */
export const brushLevels = (u: Underbrush, t: BrushTune) => {
  const at = AT[Math.max(0, Math.min(4, Math.round(t.much)))], step = 0.07 * (1 - 0.6 * t.thick);
  const out = new Uint8Array(u.bx * u.by);
  for (let q = 0; q < out.length; q++) {
    const p = u.chance[q];
    if (!(p >= at)) continue;
    out[q] = p >= at + 2 * step ? 3 : p >= at + step ? 2 : 1;
  }
  // (patches made lighter by hand: every block of the patch the tap fell in, as it was found)
  if (t.set) {
    const found = out.slice();
    for (const [k, steps] of Object.entries(t.set)) for (const q of patchOf(found, u.bx, u.by, Number(k))) out[q] = Math.max(0, found[q] - steps);
  }
  return out;
};

/** A tap on block `q`: the patch it's in a step lighter, all of it, till it's gone; the next tap
 * brings it back as found (null: no brush there as found). */
export const tapPatch = (u: Underbrush, t: BrushTune, q: number): BrushTune | null => {
  const found = brushLevels(u, { ...t, set: undefined });
  if (!found[q]) return null;
  const patch = patchOf(found, u.bx, u.by, q), set = { ...(t.set ?? {}) };
  const key = Object.keys(set).map(Number).find(k => patch.includes(k)) ?? q, steps = set[key] ?? 0;
  if (steps >= Math.max(...patch.map(p => found[p]))) delete set[key];
  else set[key] = steps + 1;
  return { ...t, set };
};

/** The blocks of brush joined to block `q`, at any level (corners too). */
export const patchOf = (lv: Uint8Array, bx: number, by: number, q: number) => {
  const seen = new Set([q]), stack = [q];
  if (!lv[q]) return [];
  while (stack.length) {
    const c = stack.pop()!, i = c % bx, j = (c - i) / bx;
    for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) {
      if (a < 0 || b < 0 || a >= bx || b >= by) continue;
      const d = b * bx + a;
      if (!seen.has(d) && lv[d]) { seen.add(d); stack.push(d); }
    }
  }
  return [...seen];
};

/** How many acres have brush at each level. */
export const brushAcres = (lv: Uint8Array) => {
  const a = [0, 0, 0, 0];
  for (const v of lv) a[v]++;
  return a.map(k => (k * UG_BLOCK * UG_BLOCK) / 43560);
};

/** The underbrush areas: light all through what has brush, medium and heavy inside it (in 3D the
 * one on top grows where they overlap), their outlines smooth, none smaller than 400 sq ft. */
export const brushAreas = (lv: Uint8Array, bx: number, by: number): AreaItem[] => {
  const out: AreaItem[] = [];
  for (const level of [1, 2, 3]) {
    for (const ring of outlines(lv, bx, by, level)) {
      const at = centroid(ring);
      out.push({ id: generateId(), type: "area", kind: "woods", x: at.x, y: at.y, points: ring, bushes: 1, density: level === 1 ? 0.5 : level === 3 ? 2 : undefined, importSource: "lidar" } as AreaItem);
    }
  }
  return out;
};

/** The outlines (plan ft) round the blocks at `level` or more: marching squares over the blocks,
 * softened, joined into rings, thinned to the points that matter. */
const outlines = (lv: Uint8Array, bx: number, by: number, level: number): P[][] => {
  // (a block's say, with its neighbours': edges round, specks gone)
  const W = bx + 2, H = by + 2, f = new Float32Array(W * H);
  for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    let t = 0, k = 0;
    for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) { if (a < 0 || b < 0 || a >= bx || b >= by) continue; t += lv[b * bx + a] >= level ? (a === i && b === j ? 2 : 1) : 0; k += a === i && b === j ? 2 : 1; }
    f[(j + 1) * W + i + 1] = t / k;
  }
  const iso = 0.5, segs: [P, P][] = [];
  const pt = (i: number, j: number) => ({ x: (i - 0.5) * UG_BLOCK, y: (j - 0.5) * UG_BLOCK });
  const lerp = (a: number, b: number) => (iso - a) / (b - a || 1e-9);
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = f[j * W + i], b = f[j * W + i + 1], c = f[(j + 1) * W + i + 1], d = f[(j + 1) * W + i];
    const idx = (a > iso ? 1 : 0) | (b > iso ? 2 : 0) | (c > iso ? 4 : 0) | (d > iso ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const e = [
      { x: pt(i + lerp(a, b), j).x, y: pt(i, j).y },
      { x: pt(i + 1, j).x, y: pt(i, j + lerp(b, c)).y },
      { x: pt(i + lerp(d, c), j).x, y: pt(i, j + 1).y },
      { x: pt(i, j).x, y: pt(i, j + lerp(a, d)).y }
    ];
    const T: Record<number, [number, number][]> = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] };
    for (const [p, q] of T[idx]) segs.push([e[p], e[q]]);
  }
  // Joined into rings (a segment's ends either way round)
  const key = (p: P) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, k) => { for (const e of s) { const a = key(e); (at.get(a) ?? at.set(a, []).get(a)!).push(k); } });
  const used = new Uint8Array(segs.length), rings: P[][] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const ring = [segs[s0][0], segs[s0][1]];
    for (;;) {
      const end = ring[ring.length - 1], next = (at.get(key(end)) ?? []).find(k => !used[k]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next];
      ring.push(key(a) === key(end) ? b : a);
    }
    if (ring.length < 5) continue;
    let area = 0;
    for (let k = 0; k < ring.length; k++) { const p = ring[k], q = ring[(k + 1) % ring.length]; area += p.x * q.y - q.x * p.y; }
    if (Math.abs(area) / 2 >= 400) rings.push(ring);
  }
  // (an outline is inside none of the others, or inside an outline's hole: an even count of rings
  // round it; a hole, an odd count)
  return rings.filter(r => rings.filter(o => o !== r && pointInPolygon(r[0], o)).length % 2 === 0).map(r => thin(r, 2.5));
};
/** The points a ring needs (Ramer-Douglas-Peucker, `tol` ft; the ring split at the point
 * farthest from its first, so each half has ends apart). */
const thin = (ring: P[], tol: number): P[] => {
  const r = Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 0.5 ? ring.slice(0, -1) : ring;
  let m = 0, farthest = -1;
  r.forEach((p, k) => { const d = Math.hypot(p.x - r[0].x, p.y - r[0].y); if (d > farthest) { farthest = d; m = k; } });
  const open = [...r, r[0]], keep = new Uint8Array(open.length);
  keep[0] = keep[m] = keep[open.length - 1] = 1;
  const stack: [number, number][] = [[0, m], [m, open.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1, far = tol;
    const a = open[s], b = open[e], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    for (let k = s + 1; k < e; k++) { const d = Math.abs((open[k].x - a.x) * dy - (open[k].y - a.y) * dx) / l; if (d > far) { far = d; best = k; } }
    if (best >= 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
  }
  return open.filter((_, k) => keep[k] && k < open.length - 1);
};
