// The painted land for the "Forest" map style, after hand-painted course maps on park signs: a
// dense canopy of small treetops of many sizes, lit from the top left, with fine leaf grain and
// shadows cast onto the clearings; bright fairways with lighter middles; dirt trails between holes
// and worn dirt at the tees; creeks and ponds in clear blue with dark banks; soft gray roads and
// mown grass. It is one picture for the whole map, laid into the SVG under the symbols (built
// things are drawn there too; the painting clears the trees from them and casts their shadows).
import { timed } from "./perfLog";
import { measuredStanding } from "./standing";
import { CIRCLE_ONE_FT, LINE_KINDS, PATH_SURFACES } from "../constants";
import type { AreaItem, CourseDoc, LineItem, MapStyle, P, PathSurface, ReliefLook, StructureItem, TreeItem } from "../types";
import { toUnits } from "./units";
import { canopyMask } from "./geo/detect";
import { boundsOf, corridor, dist, pathLength, pointInPolygon, smoothPath } from "./geom";
import { autoWalks, drawnAreas, fairwayShiftAt, fairwayWidthAt, linePath, teeLines, widthAlong, widthFactors, widthVaries } from "./course";
import type { HoleStats } from "./holeStats";
import { conifersOf, style3dOf, tallGrassOf, treeMixOf } from "./landscapes";
import { reliefExaggeration } from "./relief";
import { isLineKind, offsetPolygon, roofFor, structureHeight, structurePath, structureWidth } from "./structures";
import { latitudeOf, lookParts, paintLight, sunFromOf, themeOf } from "./mapLook";
import { STYLE_GREENS, drawMist, drawShadows, drawTrees, gradeLight, type PaintTree } from "./paintTrees";
import { drawBrushedSteps, type Wait } from "./brushCrown";
import { BRUSH, brushOnly, spotDraw, underbrushSpots } from "./brushSpots";
import { LOOK_TINT, LOOK_VARIANTS, conifersWith, drawOf, lookFor, shapeWith, sharesOf, standShares, type TreeLookId } from "./treeMix";

/** Where the photo shows trees, on a grid over the site (1 = canopy). */
export type CanopyGrid = { cols: number; rows: number; ftPerCell: number; data: Uint8Array };

export type ForestMode = "everywhere" | "photo" | "woods";

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

let photoCache: { url: string; grid: CanopyGrid | null } | null = null;

/** The canopy on the site's photo (worked out once per photo, at about half a meter). */
export const canopyFromPhoto = async (url: string, widthFt: number): Promise<CanopyGrid | null> => {
  if (photoCache?.url === url) return photoCache.grid;
  try {
    const img = await loadImage(url);
    const widthM = widthFt / 3.28084;
    const scale = Math.min(1, widthM / 0.5 / img.naturalWidth);
    const w = Math.max(16, Math.round(img.naturalWidth * scale)), h = Math.max(16, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const found = canopyMask(ctx.getImageData(0, 0, w, h), { metersPerPx: widthM / w });
    const grid: CanopyGrid | null = found ? { cols: w, rows: h, ftPerCell: widthFt / w, data: found.mask } : null;
    photoCache = { url, grid };
    return grid;
  } catch {
    return null;
  }
};

/** The canopy for a course's map, when its style paints the forest from the photo. */
export const canopyFor = async (doc: CourseDoc) =>
  doc.style.theme === "forest" && doc.style.forest !== "everywhere" && doc.background ? canopyFromPhoto(doc.background, doc.canvas.width) : null;

// --- Randomness and noise (the same picture every time for the same course)

/** A small seeded random generator (mulberry32). */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const NOISE = (() => {
  const r = seeded(91);
  const a = new Float32Array(256 * 256);
  for (let i = 0; i < a.length; i++) a[i] = r();
  return a;
})();

/** Smooth value noise, 0..1, one bump per unit. */
const noise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  let u = x - xi, v = y - yi;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const x0 = xi & 255, x1 = (x0 + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
  const a = NOISE[y0 + x0], b = NOISE[y0 + x1], c = NOISE[y1 + x0], d = NOISE[y1 + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/** Three octaves of noise, each turned so no grid shows (about 0..1, mostly near 0.5). */
const fbm = (x: number, y: number) =>
  noise(x, y) * 0.55 +
  noise(x * 1.62 - y * 1.22 + 17.1, x * 1.22 + y * 1.62 + 3.7) * 0.3 +
  noise(x * 2.05 + y * 3.57 + 41.3, -x * 3.57 + y * 2.05 + 9.2) * 0.15;


// Fine grain (leaves, grass, grit), made once: 512-pixel
// squares that repeat without a seam (each noise repeats a whole number of times across the tile)
let fine: { leaf: Float32Array; grain: Float32Array; grit: Float32Array } | null = null;
const fineGrain = () => {
  if (fine) return fine;
  const n = 512 * 512;
  const leaf = new Float32Array(n), grain = new Float32Array(n), grit = new Float32Array(n);
  for (let y = 0, i = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++, i++) {
      leaf[i] = noise(x * 0.5, y * 0.5) * 0.6 + noise(x + 19, y + 5) * 0.4;
      grain[i] = noise(x + 101, y + 37) - 0.5;
      grit[i] = noise(x + 300, y + 70);
    }
  }
  return (fine = { leaf, grain, grit });
};

// Leaf dabs: the frothy texture of painted treetops (hand-made course maps dab the leaves on
// with a sponge): clusters of little domes, packed into bigger clumps with dark gaps between.
// A 512-pixel height tile that repeats without a seam, with its slopes, lit later from the sun.
let dabs: { h: Float32Array; gx: Float32Array; gy: Float32Array } | null = null;
const leafDabs = () => {
  if (dabs) return dabs;
  const S = 512, n = S * S;
  const clump = new Float32Array(n), small = new Float32Array(n);
  const rnd = seeded(0x2f6e2b1);
  /** A dome of radius r at (cx, cy), the higher one winning (wrapping round the tile). */
  const dome = (f: Float32Array, cx: number, cy: number, r: number, top: number) => {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const q = 1 - (dx * dx + dy * dy) / (r * r);
        if (q <= 0) continue;
        const j = (((Math.round(cy) + dy) & (S - 1)) << 9) | ((Math.round(cx) + dx) & (S - 1));
        const v = top * Math.sqrt(q);
        if (v > f[j]) f[j] = v;
      }
    }
  };
  // Clumps of leaves, then the dabs on them (a few in each little square, at random)
  for (let gy = 0; gy < S; gy += 13) for (let gx = 0; gx < S; gx += 13) {
    dome(clump, gx + rnd() * 13, gy + rnd() * 13, 6.5 + rnd() * 4, 0.75 + rnd() * 0.25);
  }
  for (let gy = 0; gy < S; gy += 4) for (let gx = 0; gx < S; gx += 4) {
    dome(small, gx + rnd() * 4, gy + rnd() * 4, 2.1 + rnd() * 1.6, 0.6 + rnd() * 0.4);
  }
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = clump[i] > 0 ? clump[i] * 0.55 + small[i] * 0.45 : small[i] * 0.22;
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y << 9) | x;
      gx[i] = (h[(y << 9) | ((x + 1) & (S - 1))] - h[(y << 9) | ((x - 1) & (S - 1))]) * 0.5;
      gy[i] = (h[(((y + 1) & (S - 1)) << 9) | x] - h[(((y - 1) & (S - 1)) << 9) | x]) * 0.5;
    }
  }
  return (dabs = { h, gx, gy });
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type RGB = [number, number, number];
const hexRgb = (hex: string): RGB => {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
/** One of autumn's leaf colors, as vivid as asked (`k`, Autumn colors); the greens among them as they are. */
const vividLeaf = (hex: string, k: number) => {
  if (k === 1) return hex;
  const [h, sl, l] = rgbToHsl(hexRgb(hex));
  if (h > 70 && h < 170) return hex;
  const c = hslToRgb(h, Math.max(0, Math.min(1, sl * k)), Math.max(0.05, Math.min(0.85, l * (0.9 + 0.1 * k))));
  return `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
};

/**
 * A line that winds like a creek or a trail: long straight stretches (drawn with few clicks) get
 * bends, lines that already follow the ground closely (many points) only a little wobble.
 */
export const meander = (pts: P[], amp: number, wave: number, seed: number, fine = 0.18): P[] => {
  if (pts.length < 2 || amp <= 0) return pts;
  const rnd = seeded(seed);
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const out: P[] = [];
  const step = Math.max(1, wave / 14);
  let s = 0;
  const total = pathLength(pts);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    // Long straight pieces bend fully; short ones (already following a real creek) barely
    const bend = Math.min(1, len / wave);
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const t = j / n, d = s + len * t;
      const taper = Math.min(1, d / (wave * 0.5), (total - d) / (wave * 0.5));
      const off = amp * taper * (bend * (0.62 * Math.sin((d / wave) * 6.28 + ph[0]) + 0.28 * Math.sin((d / (wave * 0.41)) * 6.28 + ph[1]) + fine * Math.sin((d / (wave * 0.13)) * 6.28 + ph[2])));
      out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
    s += len;
  }
  return out;
};

const idSeed = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * Where the painting draws a line and how wide (feet), on a map of `scale` points per foot: creeks
 * and trails wind, and everything is at least wide enough to see. (The red OB edge of a creek
 * follows the same line.)
 */
export const paintedLine = (l: LineItem, scale: number): { points: P[]; width: number; widthAt?: (t: number) => number } => {
  const w = l.width ?? LINE_KINDS[l.kind].width;
  const atLeast = (points: number) => Math.max(w, points / scale);
  if (l.kind === "stream") {
    const cw = atLeast(5.5);
    // (wider or narrower along the way where it was set: `width` is then the widest)
    const along = widthAlong(l, w);
    const widthAt = widthVaries(l) ? (t: number) => Math.max(along(t), 5.5 / scale) : undefined;
    const widest = widthAt ? Math.max(cw, w * Math.max(...widthFactors(l))) : cw;
    return { points: l.straight ? l.points : smoothPath(meander(l.points, cw * 1.6, Math.max(50, cw * 11), idSeed(l.id)), 3), width: widest, widthAt };
  }
  // (paths, walks and roads exactly where they were drawn)
  if (l.kind === "path" || l.kind === "walk") return { points: linePath(l), width: atLeast(3.6) };
  if (l.kind === "road") return { points: linePath(l), width: atLeast(3.5) };
  return { points: linePath(l), width: w };
};

/** How far along a polyline each of its points is. */
const cumulative = (pts: P[]) => {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]));
  return out;
};

/**
 * Where to paint a hole sharper (for its tee view, flyover and video) and how sharp (pixels a
 * foot): round its line with room for the flight, on the terrain's grid (so its ground lines up
 * with the ground under it), at most 6 px a foot and `maxPx` on its longest side; null when that
 * isn't clearly sharper than the whole site's painting (`wholeK` px a foot).
 */
export const detailArea = (doc: Pick<CourseDoc, "canvas" | "gridSize">, line: P[], maxPx: number, wholeK: number) => {
  if (!line.length) return null;
  const MARGIN = 160, MAX_K = 6;
  const { width, height } = doc.canvas;
  const g = doc.gridSize || 20;
  const xs = line.map(p => p.x), ys = line.map(p => p.y);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - MARGIN) / g) * g), y0 = Math.max(0, Math.floor((Math.min(...ys) - MARGIN) / g) * g);
  const x1 = Math.min(width, Math.ceil((Math.max(...xs) + MARGIN) / g) * g), y1 = Math.min(height, Math.ceil((Math.max(...ys) + MARGIN) / g) * g);
  const rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (rect.width <= 0 || rect.height <= 0) return null;
  const k = Math.min(MAX_K, maxPx / Math.max(rect.width, rect.height));
  return k < wholeK * 1.5 ? null : { rect, k };
};

export type ForestView = { cx: number; cy: number; rotation: number; scale: number; width: number; height: number };

export type ForestOpts = {
  mode: ForestMode;
  canopy: CanopyGrid | null;
  style: MapStyle;
  /** Pixels per page point. */
  density?: number;
  /** The ground under the trees, for the 3D views (where the trees stand in 3D): grass in the
   * woods, no treetops. */
  under?: boolean;
  /** Kept, to be painted again quickly after a change of only its colors or tone (the live one). */
  keep?: boolean;
  /** Its pixel pass shared out among workers, where that helps (painted a step at a time). */
  parallel?: boolean;
  /** Only these rows' pixel pass (a worker's band). */
  rows?: [number, number];
};

// ---------------------------------------------------------------- painted again
// A painting's work kept for the next: after a change of only the colors and tone its pixels are
// mixed from, only the pixels that color reaches are painted again (after a change of tone, only
// the last step of each), from the masks, treetops, light and ground it already worked out, the
// same pixels a whole new painting would give. One painting kept, the live one: each pixel's color
// before the tone, and which of those colors it was mixed from.
const RECOLORS = ["water", "path", "fairway", "rough", "tallGrass", "light", "contrast", "colorStrength", "paint"] as const;
const MIX = { grass: 1, fairway: 2, water: 4, path: 8, tall: 16 }, ALL = 255;
type Steps = Generator<number | void | Wait, HTMLCanvasElement, unknown>;
/** A canvas, on the page or in a worker (where there's no page: an offscreen one, used alike). */
const newCanvas = () => (typeof document === "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas")) as HTMLCanvasElement;

// ---------------------------------------------------------------- painted in bands
// A whole new painting's pixel pass (most of its time) shared out in bands of rows among workers,
// each working out the masks, treetops and light as the page does, then its rows, the very same
// pixels; the page lays them in and draws the trees and the rest over them. Only where it's
// sure to help and to fit: a computer with cores and memory to spare (a phone, a tablet, an
// older or smaller machine, or a browser without workers that draw: all on the page, as before).
type Band = { o: Uint8ClampedArray; pre: Float32Array; bits: Uint8Array };
let bandOut: Band | null = null;
const bandWorkers = () => {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof document === "undefined") return 0;
  const cores = navigator.hardwareConcurrency || 2, memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (matchMedia("(pointer: coarse)").matches || cores < 6 || (memory !== undefined && memory < 8)) return 0;
  return Math.min(4, cores - 2);
};
let pool: Worker[] = [], poolBusy = false, jobNo = 0, laidIn = 0;
/** (the job the workers are on: let go, it's painted on the page instead) */
let letGo: (() => void)[] = [];
const terrainIds = new WeakMap<object, number>(), sentTerrain = new WeakMap<Worker, number>();
let terrainNo = 0;
/** (for the tests: how many paintings had their bands painted by workers) */
export const bandsLaidIn = () => laidIn;
/** The pixel pass for rows y0 to y1 only (in a worker): those rows' pixels, colors before the tone and marks. */
export const forestBand = (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts): Band | null => {
  bandOut = null;
  forestCanvas(doc, view, stats, opts);
  return bandOut;
};
/** The bands, painted by the workers (null: done on the page instead). */
const paintBands = (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts, H: number): Promise<Band[] | null> | null => {
  const n = bandWorkers();
  if (n < 2) return null;
  // (a painting asked for while the last is still out: the workers it's waiting on let go, fresh ones taken)
  // (and the painting that was waiting on them told to paint on the page: never left waiting)
  if (poolBusy) { pool.forEach(w => w.terminate()); pool = []; letGo.forEach(f => f()); letGo = []; }
  try {
    while (pool.length < n) pool.push(new Worker(new URL("./forest.worker.ts", import.meta.url), { type: "module" }));
  } catch {
    return null;
  }
  poolBusy = true;
  const id = ++jobNo, workers = pool, standing = measuredStanding();
  // (the ground's heights sent to a worker once and kept there, so what it works out from them
  // is kept too, as the page keeps it; the photo not at all: the painting doesn't read it)
  const terrainId = terrainIds.get(doc.terrainHeights) ?? terrainIds.set(doc.terrainHeights, ++terrainNo).get(doc.terrainHeights)!;
  const plain = { ...doc, terrainHeights: {}, background: undefined };
  const job = Promise.all(workers.map((w, j) => new Promise<Band | null>(done => {
    const rows: [number, number] = [Math.round((H * j) / n), Math.round((H * (j + 1)) / n)];
    const fail = () => done(null);
    letGo.push(fail);
    w.onmessage = (e: MessageEvent<{ id: number } & Partial<Band>>) => { if (e.data.id === id) done(e.data.o && e.data.pre && e.data.bits ? (e.data as Band) : null); };
    w.onerror = fail;
    const terrain = sentTerrain.get(w) === terrainId ? null : doc.terrainHeights;
    sentTerrain.set(w, terrainId);
    w.postMessage({ id, doc: plain, terrainId, terrain, view, stats, opts: { ...opts, keep: false, parallel: false, rows }, standing });
  }))).then(bands => (bands.every(Boolean) ? (bands as Band[]) : null)).catch(() => null);
  void job.finally(() => { if (jobNo === id) { poolBusy = false; letGo = []; } });
  return job;
};
let kept: { key: string; canopy: unknown; terrain: unknown; rerun: (s: MapStyle) => Steps } | null = null;
/** Everything a painting is made from but those colors and tone. */
const keptKey = (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts) => {
  const st: Record<string, unknown> = { ...opts.style };
  for (const k of RECOLORS) delete st[k];
  if (opts.style.lookParts) st.lookParts = Object.fromEntries(Object.entries(opts.style.lookParts).map(([part, v]) => [part, { ...v, bright: undefined, texture: undefined }]));
  return JSON.stringify([view, opts.density ?? 2, opts.mode, !!opts.under, st, paintedFrom(doc), stats.map(t => [t.holeId, t.line, t.complete]), doc.canvas, doc.units, doc.site]);
};
const keptFor = (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts) =>
  kept && kept.canopy === opts.canopy && kept.terrain === doc.terrainHeights && kept.key === keptKey(doc, view, stats, opts) ? kept : null;
/** Whether this painting can be made from the one kept (only its colors or tone changed). */
export const paintsAgain = (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts) => !!keptFor(doc, view, stats, opts);
/** (for the tests: the next painting a whole new one) */
export const forgetKept = () => { kept = null; };
/** The colors to paint again from one style to the next (ALL: every pixel, its brushwork changed). */
const redoOf = (a: MapStyle, b: MapStyle) => {
  const brush = (s: MapStyle) => JSON.stringify([s.paint, Object.values(lookParts(s)).map(v => [(v as { bright?: number }).bright, (v as { texture?: number }).texture])]);
  if (brush(a) !== brush(b)) return ALL;
  return (a.rough !== b.rough ? MIX.grass : 0) | (a.fairway !== b.fairway ? MIX.fairway : 0) | (a.water !== b.water ? MIX.water : 0) | (a.path !== b.path ? MIX.path : 0) | (tallGrassOf(a) !== tallGrassOf(b) ? MIX.tall : 0);
};

/**
 * The painted land over the map view, as a canvas `density` times the view's size (the view is
 * in page points; `view.scale` is points per foot).
 */
/** The painting, a slice at a time; some slices say how far along it is (0..1). */
function* forestSteps(doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts): Generator<number | void | Wait, HTMLCanvasElement, unknown> {
  const measured = doc.lidar?.trees.length ? measuredStanding() : null;
  const density = opts.density ?? 2;
  const s = opts.style;
  const again = kept && keptFor(doc, view, stats, opts);
  if (again) return yield* again.rerun(s);
  const W = Math.max(1, Math.round(view.width * density)), H = Math.max(1, Math.round(view.height * density));
  const bands = opts.parallel && !opts.rows && W * H >= 1e6 ? paintBands(doc, view, stats, opts, H) : null;
  const canvas = newCanvas();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const k = view.scale * density; // pixels per foot
  const pt = density; // pixels per page point
  const ftOf = (points: number) => (points * pt) / k;
  const rot = (view.rotation * Math.PI) / 180;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const toScreen = (p: P) => {
    const dx = p.x - view.cx, dy = p.y - view.cy;
    return { x: W / 2 + (dx * cos - dy * sin) * k, y: H / 2 + (dx * sin + dy * cos) * k };
  };
  const toPlan = (x: number, y: number) => {
    const sx = (x - W / 2) / k, sy = (y - H / 2) / k;
    return { x: view.cx + sx * cos + sy * sin, y: view.cy - sx * sin + sy * cos };
  };

  // ---------------------------------------------------------------- what is where (masks)
  // Three small pictures, one cell per two pixels, a kind of ground in each color channel:
  //   A: fairway, clear of trees, water    B: dirt, road, drawn woods    C: building, sand, fairway middle
  const cell = 2;
  const mw = Math.ceil(W / cell), mh = Math.ceil(H / cell);
  const mk = k / cell;
  const mask = () => {
    const c = newCanvas();
    c.width = mw;
    c.height = mh;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, mw, mh);
    g.setTransform(mk * cos, mk * sin, -mk * sin, mk * cos, mw / 2 - (view.cx * cos - view.cy * sin) * mk, mh / 2 - (view.cx * sin + view.cy * cos) * mk);
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    g.lineJoin = "round";
    return { c, g };
  };
  const A = mask(), B = mask(), C = mask(), D = mask(), E = mask();
  type Ch = { g: CanvasRenderingContext2D; color: string };
  const ch = (m: { g: CanvasRenderingContext2D }, i: 0 | 1 | 2, v = 255): Ch => ({ g: m.g, color: `rgb(${i === 0 ? v : 0},${i === 1 ? v : 0},${i === 2 ? v : 0})` });
  const FAIR = ch(A, 0), CLEAR = ch(A, 1), WATER = ch(A, 2);
  const DIRT = ch(B, 0), ROAD = ch(B, 1), WOODS = ch(B, 2);
  const BUILDING = ch(C, 0), SAND = ch(C, 1), MIDDLE = ch(C, 2);
  //   D: gravel, wood chips, tall grass
  const GRAVEL = ch(D, 0), CHIPS = ch(D, 1), TALL = ch(D, 2);
  //   E: paved walkways (sidewalks, paved paths and walks: under the roads, over gravel and dirt)
  const WALKWAY = ch(E, 0);
  /** Where a path or walk of this surface is painted (grass: as mown as a fairway; paved: as a road). */
  const surfaceCh = (surface: PathSurface | undefined) => (surface === "gravel" ? GRAVEL : surface === "woodchips" ? CHIPS : surface === "grass" ? FAIR : surface === "paved" ? WALKWAY : DIRT);
  const poly = (c: Ch, pts: P[]) => {
    if (pts.length < 3) return;
    c.g.fillStyle = c.color;
    c.g.beginPath();
    pts.forEach((p, i) => (i ? c.g.lineTo(p.x, p.y) : c.g.moveTo(p.x, p.y)));
    c.g.closePath();
    c.g.fill();
  };
  const disc = (c: Ch, p: P, r: number) => {
    c.g.fillStyle = c.color;
    c.g.beginPath();
    c.g.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.g.fill();
  };
  /** A line `width` wide, or as wide as `width(t)` along the way (t: 0 at its start, 1 at its end),
   * in short pieces. */
  const line = (c: Ch, pts: P[], width: number | ((t: number) => number)) => {
    if (pts.length < 2) return;
    c.g.strokeStyle = c.color;
    if (typeof width !== "number") {
      const along = cumulative(pts), total = along[along.length - 1] || 1;
      for (let i = 1; i < pts.length; i++) {
        c.g.lineWidth = width((along[i - 1] + along[i]) / 2 / total);
        c.g.beginPath();
        c.g.moveTo(pts[i - 1].x, pts[i - 1].y);
        c.g.lineTo(pts[i].x, pts[i].y);
        c.g.stroke();
      }
      return;
    }
    c.g.lineWidth = width;
    c.g.beginPath();
    pts.forEach((p, i) => (i ? c.g.lineTo(p.x, p.y) : c.g.moveTo(p.x, p.y)));
    c.g.stroke();
  };
  /** A line of varying width (creeks): short pieces, each a little wider or narrower (round the
   * width it is set to there). */
  const wobblyLine = (c: Ch, pts: P[], width: number | ((t: number) => number), seed: number) => {
    const rnd = seeded(seed);
    const at = typeof width === "number" ? () => width : width;
    const along = cumulative(pts), total = along[along.length - 1] || 1;
    let f = 1;
    for (let i = 1; i < pts.length; i++) {
      f = Math.max(0.6, Math.min(1.45, f + (rnd() - 0.5) * 0.35));
      line(c, [pts[i - 1], pts[i]], at((along[i - 1] + along[i]) / 2 / total) * f);
    }
  };

  // Treetops a few points across on a course map (they read as texture, as on painted maps), and
  // bigger on a close-up like a tee sign's hole map
  const crownR = (Math.min(16, Math.max(5, 26 * view.scale * 0.5)) / 2) * pt;

  for (const st of stats) {
    const hole = doc.holes.find(h => h.id === st.holeId);
    if (!st.complete || !hole) continue;
    const wAt = fairwayWidthAt(hole);
    const width = (t: number) => Math.max(18, wAt(t) * (hole.fairway ? 1 : 0.6));
    const shift = hole.fairway && hole.fairwayShift ? fairwayShiftAt(hole) : undefined;
    // (a fairway from each of the hole's tees: painted over each other, they make one; with the
    // hole's fairway off, only the narrower lane cleared through the trees, in the rough's grass,
    // as in 3D)
    for (const line of teeLines(doc, hole, st.line, st.teeId)) {
      const path = smoothPath(line, 10);
      if (hole.fairway) poly(FAIR, corridor(path, width, 12, shift));
      // Treetops lean in over the edges: keep their middles back so the fairway keeps its width
      poly(CLEAR, corridor(path, t => width(t) + (crownR * 1.2) / k, 12, shift));
      if (hole.fairway) poly(MIDDLE, corridor(path, t => width(t) * 0.4, 12, shift));
    }
  }
  for (const i of drawnAreas(doc.items)) {
    if (i.type === "tee") {
      const r = Math.max(12, i.padLength * 0.9);
      disc(FAIR, i, r);
      disc(CLEAR, i, r + 4);
      // Worn dirt around the pad
      disc(ch(B, 0, 175), i, Math.max(9, i.padLength * 1.05));
    } else if (i.type === "basket") {
      disc(FAIR, i, CIRCLE_ONE_FT * 0.75);
      disc(CLEAR, i, CIRCLE_ONE_FT * 0.8);
      disc(MIDDLE, i, CIRCLE_ONE_FT * 0.45);
      disc(ch(B, 0, 110), i, 7);
    } else if (i.type === "dropzone") {
      disc(FAIR, i, 12);
      disc(CLEAR, i, 12);
    } else if (i.type === "amenity") {
      disc(CLEAR, i, 10);
    } else if (i.type === "area") {
      const a = i as AreaItem;
      if (a.kind === "fairway" || a.kind === "green") { poly(FAIR, a.points); poly(CLEAR, a.points); if (a.kind === "green") poly(MIDDLE, a.points); }
      else if (a.kind === "water") { poly(WATER, a.points); poly(CLEAR, a.points); }
      else if (a.kind === "parking") { poly(ROAD, a.points); poly(CLEAR, a.points); }
      else if (a.kind === "building") { poly(BUILDING, a.points); poly(CLEAR, a.points); }
      else if (a.kind === "sand") { poly(SAND, a.points); poly(CLEAR, a.points); }
      else if (a.kind === "rough") { poly(TALL, a.points); poly(CLEAR, a.points); }
      else if (a.kind === "nogo") poly(CLEAR, a.points);
      // (a field, court or play area: mown, no treetops over it; the map draws it on top)
      else if (a.kind === "field") { poly(FAIR, a.points); poly(CLEAR, offsetPolygon(a.points, (crownR * 0.8) / k)); }
      // (a wood of bushes only: its bushes drawn one by one, below, no woods floor or treetops)
      // (a wood of bushes only: a few of its bushes drawn, below, on the ground as it is)
      else if (a.kind === "woods" && !brushOnly(a)) poly(WOODS, a.points);
    } else if (i.type === "line") {
      const l = i as LineItem;
      const { points: pts, width: lw, widthAt } = paintedLine(l, view.scale);
      if (l.kind === "road") {
        line(ROAD, pts, lw);
        line(CLEAR, pts, lw + ftOf(2));
      } else if (l.kind === "path") {
        line(surfaceCh(l.surface), pts, lw);
        line(CLEAR, pts, lw + (crownR * 2.4) / k);
      } else if (l.kind === "hedge") {
        // (drawn on top by the map; no treetops in its row)
        line(CLEAR, pts, (l.width ?? 4) + (crownR * 0.8) / k);
      } else if (l.kind === "stream") {
        const cw = widthAt ?? lw;
        wobblyLine(WATER, pts, cw, idSeed(l.id) + 1);
        // Crowns lean over the banks a little
        line(CLEAR, pts, typeof cw === "number" ? cw + (crownR * 1.4) / k : t => cw(t) + (crownR * 1.4) / k);
      }
    } else if (i.type === "structure") {
      // No treetops over built things (a little lawn round them)
      const st = i as StructureItem;
      if (isLineKind(st.kind)) line(CLEAR, structurePath(st), structureWidth(st) + ftOf(3) + (crownR * (st.kind === "wall" ? 0.4 : 1.2)) / k);
      else poly(CLEAR, offsetPolygon(st.points, 4 + ftOf(2) + (crownR * 1.2) / k));
    }
  }
  yield;
  // Walks to the next hole, over every other path (what other paths and roads painted under them
  // taken out first): drawn ones, then dirt trails from each basket to the next tee
  // (their surface stacks with the rest: see the paths' order)
  const walkLine = (c: Ch, pts: P[], width: number) => line(c, pts, width);
  for (const l of doc.items.filter(i => i.type === "line" && i.kind === "walk") as LineItem[]) {
    const { points: pts, width: lw } = paintedLine(l, view.scale);
    walkLine(surfaceCh(l.surface), pts, lw);
    line(CLEAR, pts, lw + (crownR * 2.4) / k);
  }
  // (the walks between holes as painted, winding: the Trail look dashes these same lines)
  const walked: { pts: P[]; width: number }[] = [];
  if (s.nextTee) {
    for (const { from, to, a, b } of autoWalks(doc.items, stats, doc.holes)) {
      const d = dist(from, to);
      if (d < 40) continue;
      // (worn wide, as on painted course maps: a walk you can see from across the map; or as wide as
      // set, never too thin to see)
      const hole = doc.holes.find(h => h.id === a.holeId);
      const ww = hole?.walkWidth ?? s.walkWidth;
      const tw = ww ? Math.max(ww, ftOf(2)) : Math.max(6, ftOf(6));
      const pts = smoothPath(meander([from, to], Math.min(d * 0.07, 30), Math.max(70, d * 0.55), idSeed(a.holeId + b.holeId), 0), 3);
      walked.push({ pts, width: tw });
      walkLine(surfaceCh(hole?.walkSurface), pts, tw);
      line(CLEAR, pts, tw + (crownR * 2.4) / k);
    }
  }
  // (the masks depend on the course and the frame, not on the look: a look changed reuses them)
  const maskKey = JSON.stringify([view, density, paintedFrom(doc), stats.map(st => [st.holeId, st.line, st.complete]), s.nextTee, s.walkWidth, doc.canvas, !!opts.under]);
  const store: MaskStore = maskStores.get(maskKey) ?? { key: maskKey, reads: new Map() };
  maskStores.delete(maskKey);
  maskStores.set(maskKey, store);
  // (a draft's and a sharp painting's, and the one before: three)
  while (maskStores.size > 3) maskStores.delete(maskStores.keys().next().value!);
  let readNo = 0;
  const read = (c: HTMLCanvasElement, blur: number) => {
    const name = `r${readNo++}`;
    const had = store.reads.get(name);
    if (had) return had;
    const out = readNow(c, blur);
    store.reads.set(name, out);
    return out;
  };
  const readNow = (c: HTMLCanvasElement, blur: number) => {
    const o = newCanvas();
    o.width = mw;
    o.height = mh;
    const g = o.getContext("2d", { willReadFrequently: true })!;
    if (blur > 0) g.filter = `blur(${blur}px)`;
    g.drawImage(c, 0, 0);
    return g.getImageData(0, 0, mw, mh).data;
  };
  yield;
  // (fairways and tall grass a little softer: their edges fade, not step)
  const a = read(A.c, 2 * (pt / cell));
  yield;
  const b = read(B.c, 0.9 * (pt / cell));
  yield;
  const c = read(C.c, 1 * (pt / cell));
  yield;
  const dd = read(D.c, 2.6 * (pt / cell));
  const ee = read(E.c, 0.8 * (pt / cell));
  yield;
  const wet = read(A.c, 0.6 * (pt / cell));
  yield;
  // How far into the water each cell is (pixels from the shore), and whether it is open water (a
  // pond, a lake) or a narrow creek: the shore's distance averaged round about stays small along
  // a creek and grows inside a pond
  const shore = store.shore ?? new Float32Array(mw * mh);
  if (!store.shore) {
    store.shore = shore;
    const INF = 1e9, D1 = 1, D2 = 1.4142;
    for (let m = 0; m < shore.length; m++) shore[m] = wet[m * 4 + 2] > 127 ? INF : 0;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const m = y * mw + x;
      if (!shore[m]) continue;
      let v = shore[m];
      if (x > 0) v = Math.min(v, shore[m - 1] + D1);
      if (y > 0) v = Math.min(v, shore[m - mw] + D1);
      if (x > 0 && y > 0) v = Math.min(v, shore[m - mw - 1] + D2);
      if (x < mw - 1 && y > 0) v = Math.min(v, shore[m - mw + 1] + D2);
      shore[m] = v;
    }
    for (let y = mh - 1; y >= 0; y--) for (let x = mw - 1; x >= 0; x--) {
      const m = y * mw + x;
      if (!shore[m]) continue;
      let v = shore[m];
      if (x < mw - 1) v = Math.min(v, shore[m + 1] + D1);
      if (y < mh - 1) v = Math.min(v, shore[m + mw] + D1);
      if (x < mw - 1 && y < mh - 1) v = Math.min(v, shore[m + mw + 1] + D2);
      if (x > 0 && y < mh - 1) v = Math.min(v, shore[m + mw - 1] + D2);
      shore[m] = v;
    }
    for (let m = 0; m < shore.length; m++) if (shore[m] >= 1e8) shore[m] = 0;
    for (let m = 0; m < shore.length; m++) shore[m] *= cell;
  }
  yield;
  const openWater = store.openWater ?? (store.openWater = (() => {
    // A wide box average (rows, then columns) of the shore distance
    const R = Math.max(2, Math.round((10 * pt) / cell));
    const tmp = new Float32Array(mw * mh), out = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      let s2 = 0;
      for (let x = -R; x <= R; x++) s2 += shore[y * mw + Math.min(mw - 1, Math.max(0, x))];
      for (let x = 0; x < mw; x++) {
        tmp[y * mw + x] = s2 / (2 * R + 1);
        s2 += shore[y * mw + Math.min(mw - 1, x + R + 1)] - shore[y * mw + Math.max(0, x - R)];
      }
    }
    for (let x = 0; x < mw; x++) {
      let s2 = 0;
      for (let y = -R; y <= R; y++) s2 += tmp[Math.min(mh - 1, Math.max(0, y)) * mw + x];
      for (let y = 0; y < mh; y++) {
        out[y * mw + x] = s2 / (2 * R + 1);
        s2 += tmp[Math.min(mh - 1, y + R + 1) * mw + x] - tmp[Math.max(0, y - R) * mw + x];
      }
    }
    return out;
  })());
  yield;
  const middle = read(C.c, 7 * (pt / cell));
  yield;

  // Slow-changing noise on a coarse grid (every 8 pixels), read smoothly in between. In page
  // points, so a print looks like the screen.
  const CS = 8;
  const cw = Math.ceil(W / CS) + 2, chh = Math.ceil(H / CS) + 2;
  const coarse = (f: (u: number, v: number) => number) => {
    const out = new Float32Array(cw * chh);
    for (let y = 0, j = 0; y < chh; y++) for (let x = 0; x < cw; x++, j++) out[j] = f((x * CS) / pt, (y * CS) / pt) - 0.5;
    return out;
  };
  const at = (g: Float32Array, x: number, y: number) => {
    const fx = x / CS, fy = y / CS;
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, j = iy * cw + ix;
    return (g[j] * (1 - tx) + g[j + 1] * tx) * (1 - ty) + (g[j + cw] * (1 - tx) + g[j + cw + 1] * tx) * ty;
  };
  const mottle = coarse((u, v) => fbm(u * 0.05, v * 0.05));
  const fairMottle = coarse((u, v) => fbm(u * 0.07 + 20, v * 0.07));
  yield;
  const stands = coarse((u, v) => fbm(u * 0.018 + 5, v * 0.018 + 9));
  const treeEdge = coarse((u, v) => fbm(u * 0.09 + 31, v * 0.09 + 7));
  yield;
  const clumps = coarse((u, v) => fbm(u * 0.035 + 61, v * 0.035 + 2));
  yield;
  const { leaf: LEAF, grain: GRAIN, grit: GRIT } = fineGrain();
  yield;
  const { h: DH, gx: DGX, gy: DGY } = leafDabs();
  yield;

  // Wooded, cell by cell: drawn woods; or everywhere, or where the photo shows trees
  const site = (p: P) => p.x >= -doc.canvas.width * 0.5 && p.y >= -doc.canvas.height * 0.5 && p.x <= doc.canvas.width * 1.5 && p.y <= doc.canvas.height * 1.5;
  const canopy = opts.canopy;
  const photoTrees = (p: P) => {
    if (!canopy) return false;
    const cc = Math.floor(p.x / canopy.ftPerCell), rr = Math.floor(p.y / canopy.ftPerCell);
    // Beyond the photo nothing is known: paint it wooded, so the page's edges stay lush
    if (cc < 0 || rr < 0 || cc >= canopy.cols || rr >= canopy.rows) return site(p);
    const reach = Math.max(1, Math.round(6 / canopy.ftPerCell));
    let hits = 0, all = 0;
    for (let dy = -reach; dy <= reach; dy += reach) for (let dx = -reach; dx <= reach; dx += reach) {
      const x = cc + dx, y = rr + dy;
      if (x < 0 || y < 0 || x >= canopy.cols || y >= canopy.rows) continue;
      all++;
      if (canopy.data[y * canopy.cols + x]) hits++;
    }
    return hits >= Math.max(2, all * 0.3);
  };
  const wooded = new Uint8Array(mw * mh);
  // (with measured trees: only the woods drawn, unless the course asks for more)
  const mode = measured ? s.forestMeasured ?? "woods" : opts.mode;
  for (let y = 0; y < mh; y++) {
    if ((y & 31) === 0) yield 0.05 + 0.1 * (y / mh);
    for (let x = 0; x < mw; x++) {
      const m = y * mw + x;
      // A wobbly edge where the trees stop
      if (a[m * 4 + 1] / 255 + at(treeEdge, x * cell + 1, y * cell + 1) * 0.5 > 0.5) continue;
      // (2: drawn woods, which plant their own trees in 3D)
      if (b[m * 4 + 2] > 127) { wooded[m] = 2; continue; }
      if (mode === "woods") continue;
      const p = toPlan(x * cell + cell / 2, y * cell + cell / 2);
      wooded[m] = (mode === "everywhere" || !canopy ? site(p) : photoTrees(p)) ? 1 : 0;
    }
  }
  // Measured trees: no woods floor painted (the trees are the woods, each drawn whole where it
  // stands, below, as trees placed by hand are; between their crowns is the ground, as from the
  // air); a tree cut down or brought back in 3D opens or fills its place. Woods drawn by hand are
  // painted as drawn.
  const planted = new Uint8Array(mw * mh);
  if (!measured) planted.fill(1);
  if (measured) {
    // (the drawn woods painted on a mask of their own, as the other masks are: a cell in them when
    // its middle is, as near as makes no difference; testing each cell against each wood's
    // outline took seconds on a phone, in one go, the view stuck meanwhile)
    const inDrawn = mask();
    const DRAWN = ch(inDrawn, 0);
    for (const a of doc.items.filter(i => i.type === "area" && i.kind === "woods" && (i as AreaItem).trees !== "none" && !brushOnly(i as AreaItem)) as AreaItem[]) poly(DRAWN, drawnAreas([a])[0].points);
    const drawn = inDrawn.g.getImageData(0, 0, mw, mh).data;
    // (more woods asked for, from the photo or everywhere: never under a measured crown, no woods
    // floor round the measured trees)
    const crowns = new Uint8Array(mode === "woods" ? 0 : mw * mh);
    if (mode !== "woods") for (const t of measured.trees) {
      const c = toScreen({ x: t[0], y: t[1] }), r = (t[3] * k + 2 * cell) / cell;
      const cx = c.x / cell, cy = c.y / cell;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(mh - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(mw - 1, Math.ceil(cx + r)); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) crowns[y * mw + x] = 1;
    }
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const m = y * mw + x;
      if (!wooded[m]) continue;
      if (drawn[m * 4] >= 128) planted[m] = 1;
      else if (mode !== "woods" && !crowns[m]) planted[m] = 1;
      else wooded[m] = 0;
    }
  }

  // ---------------------------------------------------------------- the canopy (a height field)
  const cover = Math.max(0.1, Math.min(1, s.treeCover ?? 1));
  const height = new Float32Array(W * H);
  const kind = new Uint8Array(W * H);
  /** A treetop: a lumpy dome, `top` high at the middle; the taller one wins where they overlap. */
  const stamp = (cx: number, cy: number, r: number, top: number, t: number) => {
    const x0 = Math.max(0, Math.floor(cx - r * 1.2)), x1 = Math.min(W - 1, Math.ceil(cx + r * 1.2));
    const y0 = Math.max(0, Math.floor(cy - r * 1.2)), y1 = Math.min(H - 1, Math.ceil(cy + r * 1.2));
    const ir2 = 1 / (r * r);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, dy2 = dy * dy, tr = (y & 511) << 9;
      for (let x = x0, i = y * W + x0; x <= x1; x++, i++) {
        const dx = x + 0.5 - cx;
        // Leafy outline: the edge pushed in and out by the leaf grain
        const q = 1 - (dx * dx + dy2) * ir2 * (0.72 + LEAF[tr | (x & 511)] * 0.6);
        if (q <= 0) continue;
        const h = top - r + r * Math.sqrt(q);
        if (h > height[i]) { height[i] = h; kind[i] = t; }
      }
    }
  };
  /** A tuft of needles seen from above: a soft round dome, its edge fringed with fine needle tips
   * (no star points). */
  const tuft = (cx: number, cy: number, r: number, top: number, t: number) => {
    const x0 = Math.max(0, Math.floor(cx - r * 1.1)), x1 = Math.min(W - 1, Math.ceil(cx + r * 1.1));
    const y0 = Math.max(0, Math.floor(cy - r * 1.1)), y1 = Math.min(H - 1, Math.ceil(cy + r * 1.1));
    const ph = t * 1.9 + cx * 0.37;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, tr = (y & 511) << 9;
      for (let x = x0, i = y * W + x0; x <= x1; x++, i++) {
        const dx = x + 0.5 - cx;
        const a = Math.atan2(dy, dx);
        // (many fine needle tips round the edge, uneven: a fringe, not points)
        const fringe = 0.8 + 0.16 * Math.abs(Math.cos(a * 9 + ph)) + 0.08 * Math.abs(Math.cos(a * 19 - ph)) + (LEAF[tr | (x & 511)] - 0.5) * 0.14;
        const q = 1 - (dx * dx + dy * dy) / (r * r * fringe * fringe);
        if (q <= 0) continue;
        // (needles radiate from the tuft's middle: fine ridges across it)
        const h = top - r * 0.8 + r * 0.8 * Math.sqrt(q) + r * 0.06 * Math.cos(a * 17 + ph);
        if (h > height[i]) { height[i] = h; kind[i] = t; }
      }
    }
  };
  /** A big crown as a big tree looks from above: many leaf clumps, each about a small tree's size
   * and lit on its own, packed over a lower, shaded body (the valleys between them), the middle
   * highest, the outline uneven; never one great dome. */
  const bigCrown = (cx: number, cy: number, R: number, top: number, t: number) => {
    const tr = seeded(Math.round(cx * 9.1 + cy * 3.7) ^ 0x68e31da4);
    stamp(cx, cy, R * 0.86, top - R * 0.55, t);
    const rc = crownR * 1.35, n = Math.min(90, Math.round(((R / rc) ** 2) * 1.7));
    const placed: [number, number, number][] = [];
    const bend = tr() * Math.PI * 2;
    for (let tries = 0; tries < n * 12 && placed.length < n; tries++) {
      const a = tr() * Math.PI * 2;
      // (the outline uneven: further out on some sides)
      const reach = R * (0.82 + 0.14 * Math.cos(a * 3 + bend) + 0.06 * Math.cos(a * 5 - bend));
      const r = rc * (0.75 + tr() * 0.55);
      const d = Math.sqrt(tr()) * Math.max(0, reach - r * 0.7);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (placed.some(([px, py, pr]) => (px - x) ** 2 + (py - y) ** 2 < ((pr + r) * 0.62) ** 2)) continue;
      placed.push([x, y, r]);
    }
    // (lower ones first: those out at the edge; the higher ones in the middle over them)
    placed.sort((p, q) => Math.hypot(q[0] - cx, q[1] - cy) - Math.hypot(p[0] - cx, p[1] - cy));
    for (const [x, y, r] of placed) {
      const d = Math.hypot(x - cx, y - cy);
      stamp(x, y, r, top - (d / R) * R * 0.38 - tr() * r * 0.35, t);
    }
  };
  /** A bigger single tree: a few leafy clumps (each lit on its own), higher in the middle; `top`
   * its height (shadows), in pixels. */
  const clumpTree = (cx: number, cy: number, R: number, t: number, top = R * 1.3) => {
    if (R > crownR * 2.2) { bigCrown(cx, cy, R, top, t); return; }
    const tr = seeded(Math.round(cx * 7 + cy * 13));
    const n = 3 + Math.round((R / crownR) * 2.5);
    const tall = top / (R * 1.3);
    stamp(cx, cy, R * 0.7, top, t);
    for (let j = 0; j < n; j++) {
      const a = tr() * Math.PI * 2, d = Math.sqrt(tr()) * R * 0.55;
      const r = Math.min(R * 0.6, crownR * (0.8 + tr() * 0.6));
      stamp(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, (R * 1.25 + r * 0.4 - d * 0.3) * tall, t);
    }
  };
  // Natural treetops (as the 3D trees look from above): a broadleaf's crown is leaf clusters at
  // the ends of its limbs, the middle highest and gaps between them where the floor shows; a
  // pine is tiers of boughs, each a star a little smaller and higher than the one below it
  const look = lookParts(s), pl = paintLight(s);
  // (Size, the one thing about the trees that's the map's: every tree in every look, the woods',
  // the measured and the placed, as big as its look draws it times this; 1 until it's moved)
  const treeScale = look.trees.size / (themeOf(s).parts.trees.size || 1), brushSize = look.trees.brush ?? 1;
  // (the newer looks: trees drawn as shapes after the ground, not stamped into the height field)
  const vector = look.trees.style !== "classic" && !opts.under;
  const vstyle = look.trees.style as Exclude<typeof look.trees.style, "classic">;
  const vtrees: PaintTree[] = [];
  const natural = !vector && s.treeLook === "natural" && !s.mapLook;
  const leafy = (cx: number, cy: number, R: number, top: number, t: number, clusters = 0) => {
    if (!clusters && R > crownR * 2.2) { bigCrown(cx, cy, R, top, t); return; }
    const tr = seeded(Math.round(cx * 7.3 + cy * 13.1) ^ 0x2c1b3c6d);
    const n = clusters || 5 + Math.round(tr() * 3 + Math.min(4, R / crownR));
    const turn = tr() * Math.PI * 2;
    stamp(cx + (tr() - 0.5) * R * 0.15, cy + (tr() - 0.5) * R * 0.15, R * 0.4, top, t);
    for (let j = 0; j < n; j++) {
      const a = turn + (j / n) * Math.PI * 2 + (tr() - 0.5) * 0.7;
      const d = R * (0.4 + tr() * 0.28);
      const r = R * (0.27 + tr() * 0.17);
      stamp(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, top - d * 0.45 - tr() * r * 0.3, t);
    }
  };
  /** A pine seen from above: rings of soft needle tufts over the whole crown, each a little star
   * of boughs, the outer rings lower and the middle highest. */
  const tufted = (cx: number, cy: number, R: number, top: number, t: number) => {
    const tr = seeded(Math.round(cx * 5.7 + cy * 11.3) ^ 0x1b873593);
    const turn = tr() * Math.PI * 2;
    t = PINE;
    const rings: [number, number, number][] = R > crownR * 1.6 ? [[0.8, 14, 0.22], [0.58, 11, 0.22], [0.36, 8, 0.21], [0.14, 3, 0.2]] : [[0.66, 9, 0.3], [0.3, 5, 0.28]];
    rings.forEach(([rr, n, ts], ring) => {
      for (let k2 = 0; k2 < n; k2++) {
        const a = turn + ring * 0.5 + (k2 / n) * Math.PI * 2 + (tr() - 0.5) * 0.3;
        const r = Math.max(pt * 1.2, R * ts * (0.85 + tr() * 0.3));
        tuft(cx + Math.cos(a) * R * rr, cy + Math.sin(a) * R * rr, r, top - R * rr * 0.9 + tr() * r * 0.2, t);
      }
    });
    tuft(cx, cy, Math.max(pt * 1.2, R * 0.26), top + R * 0.1, t);
  };
  const rnd = seeded(idSeed(doc.seed ?? doc.id ?? doc.name) ^ 0x5bd1e995);
  const vGreens: RGB[] = (() => {
    if (!vector) return [];
    const mixes = treeMixOf(s);
    // (autumn's colours as vivid as asked: the greens among them as they are)
    if (mixes.length) return mixes.map(c => { const rgb = hexRgb(c), k = s.autumnVivid ?? 1; if (k === 1) return rgb; const [h, sl, l] = rgbToHsl(rgb); return h > 70 && h < 170 ? rgb : hslToRgb(h, Math.max(0, Math.min(1, sl * k)), Math.max(0.05, Math.min(0.85, l * (0.9 + 0.1 * k)))); });
    const [h0, s0, l0] = rgbToHsl(hexRgb("#354a2c")), [h1, s1, l1] = rgbToHsl(hexRgb(s.trees));
    return STYLE_GREENS[vstyle].map(c => { const [h, sl, l] = rgbToHsl(hexRgb(c)); return hslToRgb(h + (h1 - h0), Math.max(0, Math.min(1, sl * (s1 / Math.max(0.05, s0)))), Math.max(0.05, Math.min(0.9, l * (l1 / Math.max(0.05, l0))))); });
  })();
  /** A tree's color: one of the style's greens, as varied as the style says. */
  const treeColor = (u: number): RGB => {
    // (autumn's mix: each tree its own colour of it; greens as varied as the style says)
    const a = vGreens[0], b = vGreens[Math.floor(u * vGreens.length) % vGreens.length], v = vstyle === "brushed" && treeMixOf(s).length ? 1 : look.trees.variety;
    const k2 = 0.92 + ((u * 7.31) % 1) * 0.16 * (0.4 + v);
    return [(a[0] + (b[0] - a[0]) * v) * k2, (a[1] + (b[1] - a[1]) * v) * k2, (a[2] + (b[2] - a[2]) * v) * k2];
  };
  // Stratified at random (no grid shows): one or two treetops in each small square, all sizes.
  // Sparse woods keep fewer, in clumps, and the trees stand bigger on their own.
  // (natural: trees at about their real size and spacing, as the 3D woods stand, about 15 ft
  // apart and 14 to 30 ft across, never smaller than the classic treetops; the landscape's share
  // of pines. Their shadows as long as the classic treetops' are: a map, not a photo at sunset)
  const realStep = 15 * k, realR = (f: number) => Math.max(crownR * 0.9, (7 + f * 8) * k);
  const realTop = (r: number) => crownR * (1.9 + rnd() * 0.9) + r * 0.35;
  // (the newer looks: each style's spacing and crown sizes, in feet, never smaller than reads)
  const VSPACE = { brushed: 12.5, cluster: 13.6, drybrush: 10.5, cloud: 14.3, gouache: 13.6 } as const, VSIZE = { brushed: [8, 14], cluster: [8.2, 13.6], drybrush: [7, 12], cloud: [7.5, 12.3], gouache: [7.5, 13] } as const;
  const vStep = vector ? Math.max(crownR * 1.05, (VSPACE[vstyle] / Math.sqrt(Math.max(0.3, look.trees.density))) * k) : 0;
  const vR = (u: number) => Math.max(crownR * 0.75, (VSIZE[vstyle][0] + u * (VSIZE[vstyle][1] - VSIZE[vstyle][0])) * look.trees.size * k);
  const stepPx = vector ? vStep : natural ? Math.max(crownR * 1.15, realStep) : crownR * 1.15;
  // (the course's kinds of trees: pines only if a needle kind is allowed, all pines if only
  // they are; each treetop one of the kinds, its leaves' color moved as in 3D)
  const shares = sharesOf(s);
  // (as many pines as the 3D map grows: its landscape's, or as set there)
  const vPines = conifersWith(shares, conifersOf(style3dOf(s)));
  // (one share of pines for every look: a pine share set means the same on any of them)
  const pineShare = vPines;
  // (a stand of one species, drawn: the treetops in it all of it, as in 3D)
  const oneSpecies = vector ? (doc.items.filter(i => i.type === "area" && i.kind === "woods") as AreaItem[]).flatMap(a => {
    const own = standShares(a, null);
    if (!own) return [];
    const pts = drawnAreas([a])[0].points;
    return [{ pts, box: boundsOf(pts), look: Object.keys(own)[0] as TreeLookId }];
  }) : [];
  const standAt = (x: number, y: number) => {
    if (!oneSpecies.length) return null;
    const p = toPlan(x, y);
    return oneSpecies.find(st => p.x >= st.box.minX && p.x <= st.box.maxX && p.y >= st.box.minY && p.y <= st.box.maxY && pointInPolygon(p, st.pts))?.look ?? null;
  };
  const asKind = (c: RGB, kind: TreeLookId | null | undefined): RGB => {
    if (!kind) return c;
    const [h, sl, l] = rgbToHsl(c), [dh, ds, dl] = LOOK_TINT[kind];
    return hslToRgb(h + dh * 360, Math.max(0, Math.min(1, sl + ds)), Math.max(0.03, Math.min(0.95, l + dl)));
  };
  const grow = 1 + (1 - cover) * 0.7;
  for (let gy = -stepPx; gy < H + stepPx && !opts.under; gy += stepPx) {
    yield 0.15 + 0.35 * ((gy + stepPx) / (H + 2 * stepPx));
    for (let gx = -stepPx; gx < W + stepPx; gx += stepPx) {
      const n = natural || vector ? 1 : rnd() < 0.5 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const x = gx + rnd() * stepPx, y = gy + rnd() * stepPx;
        const mx = Math.min(mw - 1, Math.max(0, Math.floor(x / cell))), my = Math.min(mh - 1, Math.max(0, Math.floor(y / cell)));
        if (!wooded[my * mw + mx] || !planted[my * mw + mx]) continue;
        if (cover < 1) {
          const clump = Math.max(0, Math.min(1, at(clumps, Math.max(0, x), Math.max(0, y)) * 2.4 + 0.5));
          if (rnd() > (Math.pow(cover, 2.5) * (0.15 + 1.85 * clump)) / (grow * grow)) continue;
        }
        const u = rnd();
        const t = 1 + Math.floor(rnd() * 6);
        // (a crown that would reach over a fairway, path or water nearby: smaller, so the clearing
        // stays clear, in every look)
        const clearAt = (dx: number, dy: number) => { const cx = Math.min(mw - 1, Math.max(0, Math.floor((x + dx) / cell))), cy = Math.min(mh - 1, Math.max(0, Math.floor((y + dy) / cell))); return a[(cy * mw + cx) * 4 + 1] > 90; };
        const clear = (r0: number) => { let r = r0; for (let tries = 0; tries < 2; tries++) { const q = r * 0.75; if (clearAt(q, 0) || clearAt(-q, 0) || clearAt(0, q) || clearAt(0, -q)) r *= 0.72; else break; } return r; };
        // (as tall as a woods' tree is, 13 to 34 ft, in every look: over a shed or a house as the
        // vector looks have it, never under its roof at a close scale)
        const ftTop = (13 + 21 * (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1)) * k;
        if (vector) {
          const r = clear(vR(u) * grow);
          const h = r * (1.6 + rnd() * 0.8), drawnPine = rnd() < vPines, col = treeColor(rnd()), seed = rnd();
          const own = standAt(x, y), pine = own ? LOOK_VARIANTS[own].shape === "conifer" : drawnPine;
          const kind = own ?? lookFor(pine ? "conifer" : "broadleaf", drawOf(Math.round(seed * 1e6), 7), shares);
          vtrees.push({ x, y, r, h, pine, col: asKind(col, kind), seed, look: kind, fill: true });
          continue;
        }
        if (natural) {
          const r = clear(realR(u) * grow * treeScale);
          if (rnd() < pineShare) tufted(x, y, r * 0.8, Math.max(realTop(r) * 1.15, ftTop * treeScale), t);
          else leafy(x, y, r, Math.max(realTop(r), ftTop * treeScale), t);
          continue;
        }
        const r = clear(crownR * (0.45 + u * u * 1.35) * grow * treeScale);
        if (rnd() < pineShare) tufted(x, y, r * 0.95, Math.max(r * (2.2 + rnd() * 0.9), ftTop * treeScale), t);
        else if (cover < 0.75 && rnd() < (0.75 - cover) * 0.8) clumpTree(x, y, r * 1.5, t, Math.max(r * 1.95, ftTop * treeScale));
        else stamp(x, y, r, Math.max(r * (1.9 + rnd() * 0.9), ftTop * treeScale), t);
      }
    }
  }
  // Underbrush on its own (the brush that came in with the import): a few of the bushes 3D grows
  // (lib/brushSpots), low, under the trees, on the ground as it is; where brush areas overlap, the
  // smaller one's grows, as in 3D. The map is an overview: the trees lead, the brush only says it's
  // there, its bushes as big as Brush size says.
  const brushWoods = opts.under ? [] : (doc.items.filter(i => i.type === "area" && i.kind === "woods" && brushOnly(i as AreaItem) && (i as AreaItem).trees !== "none") as AreaItem[]);
  brushWoods.forEach((w, n) => {
    const box = boundsOf(w.points), sb = { a: toScreen({ x: box.minX, y: box.minY }), b: toScreen({ x: box.maxX, y: box.maxY }) };
    if (Math.max(sb.a.x, sb.b.x) < 0 || Math.max(sb.a.y, sb.b.y) < 0 || Math.min(sb.a.x, sb.b.x) > W || Math.min(sb.a.y, sb.b.y) > H) return;
    const over = brushWoods.slice(n + 1).filter(o => { const b = boundsOf(o.points); return b.minX < box.maxX && b.maxX > box.minX && b.minY < box.maxY && b.maxY > box.minY; }).map(o => o.points);
    const clearAt = (x: number, y: number) => { const cx = Math.min(mw - 1, Math.max(0, Math.floor(x / cell))), cy = Math.min(mh - 1, Math.max(0, Math.floor(y / cell))); return a[(cy * mw + cx) * 4 + 1] > 90; };
    const keepOut = (p: P, reach: number) => {
      if (over.some(o => pointInPolygon(p, o))) return true;
      const q = toScreen(p), d = reach * k;
      return clearAt(q.x, q.y) || clearAt(q.x + d, q.y) || clearAt(q.x - d, q.y) || clearAt(q.x, q.y + d) || clearAt(q.x, q.y - d);
    };
    const density = w.density ?? 1, level = density < 0.75 ? "light" : density > 1.4 ? "heavy" : "medium";
    // (closer than reads: fewer bushes, each bigger, the same ground covered)
    // (a bush every three and a half treetops or so, none of the young trees, smaller than in 3D)
    const least = (crownR * 3.5) / k, closer = Math.min(1, BRUSH[level].spacing / least), size = 0.7 * brushSize;
    const spots = underbrushSpots(w.points, keepOut, level, 0, w.points, w.brushKind ?? "mixed", closer).filter(b => b.growth);
    for (const b of spots) {
      const sp = toScreen(b);
      const r = Math.max(1.6 * pt, (b.width / 2) * k * treeScale * size);
      if (sp.x < -r || sp.y < -r || sp.x > W + r || sp.y > H + r) continue;
      const top = Math.max(r * 1.1, b.height * k * treeScale), seed = spotDraw(b, 31), tone = 1 + Math.floor(seed * 6);
      if (vector) { vtrees.push({ x: sp.x, y: sp.y, r: b.growth ? r * 0.9 : r, h: b.growth ? Math.min(top, r * 1.1) : top, pine: false, col: treeColor(spotDraw(b, 32)), seed, look: null }); continue; }
      if (!b.growth) natural ? leafy(sp.x, sp.y, r, top, tone) : stamp(sp.x, sp.y, r, top, tone);
      else natural ? leafy(sp.x, sp.y, r * 0.9, Math.min(top, r * 1.1), tone, 4) : stamp(sp.x, sp.y, r * 0.9, Math.min(top, r * 1.1), tone);
    }
  });
  // The measured trees, each drawn whole where it stands, at its own size and height and of its
  // own kind, as a tree placed by hand is (crowns that touch are the woods' canopy)
  if (measured && !opts.under) measured.trees.forEach(([x0, y0, h0, radius, conifer], idx) => {
    const sp = toScreen({ x: x0, y: y0 });
    const r = Math.max(2.2 * pt, radius * k * treeScale);
    if (sp.x < -r || sp.y < -r || sp.x > W + r || sp.y > H + r) return;
    const top = Math.max(r * 1.2, h0 * k * treeScale);
    const tone = 1 + (idx % 6);
    // (its kind by its index, as the 3D view picks it, lib/treeMix; a needle tree leafy where no needle kind is allowed)
    if (vector) { const tr = seeded(idx * 7919 + 13), shape = shapeWith(shares, conifer ? "conifer" : "broadleaf"), kind = lookFor(shape, drawOf(idx, 7), shares); vtrees.push({ x: sp.x, y: sp.y, r, h: top, pine: shape === "conifer", col: asKind(treeColor(tr()), kind), seed: tr(), look: kind }); return; }
    if (conifer) tufted(sp.x, sp.y, r, top, tone);
    else if (natural) leafy(sp.x, sp.y, r, top, tone);
    else if (r > crownR * 1.4) clumpTree(sp.x, sp.y, r, tone, top);
    else stamp(sp.x, sp.y, r, top, tone);
  });
  // Trees placed on the map (or found on the photo): each where it stands, at its own size and
  // height and of its own kind, wherever it is (on a fairway too), apart from the woods
  for (const t of opts.under ? [] : (doc.items.filter(i => i.type === "tree") as TreeItem[])) {
    const sp = toScreen(t);
    const r = Math.max(2.2 * pt, t.radius * (t.width ?? 1) * k * treeScale);
    if (sp.x < -r || sp.y < -r || sp.x > W + r || sp.y > H + r) continue;
    const top = Math.max(r * 1.2, (t.height ?? t.radius * 2.6) * k * treeScale);
    const tone = 1 + (idSeed(t.id) % 6);
    if (vector) {
      const tr = seeded(idSeed(t.id));
      const kind = t.species && t.species in LOOK_TINT ? (t.species as TreeLookId) : null;
      vtrees.push({ x: sp.x, y: sp.y, r: t.treeType === "bush" ? r * 0.9 : r, h: t.treeType === "bush" ? r * 1.1 : top, pine: t.treeType === "conifer", col: asKind(treeColor(tr()), kind), seed: tr(), look: kind });
      continue;
    }
    if (t.treeType === "conifer") tufted(sp.x, sp.y, r, top, tone);
    else if (t.treeType === "bush") natural ? leafy(sp.x, sp.y, r * 0.9, Math.min(top, r * 1.1), tone, 4) : stamp(sp.x, sp.y, r * 0.9, Math.min(top, r * 1.1), tone);
    else if (natural) leafy(sp.x, sp.y, r, top, tone);
    else if (r > crownR * 1.4) clumpTree(sp.x, sp.y, r, tone, top);
    else stamp(sp.x, sp.y, r, top, tone);
  }

  yield;
  // ---------------------------------------------------------------- light
  // The sun comes from `sunAngle` (degrees clockwise from the top of the page) at `sunHeight`
  // (where it shines from by the compass, turned with the map on the page; as high as the light says)
  const az = ((sunFromOf(s, latitudeOf(doc.site)) - (view.rotation || 0)) * Math.PI) / 180, el = (Math.max(10, Math.min(85, pl.height)) * Math.PI) / 180;
  const sunX = Math.sin(az), sunY = -Math.cos(az), rise = Math.tan(el);
  const L = { x: sunX * Math.cos(el), y: sunY * Math.cos(el), z: Math.sin(el) };
  const shadowK = Math.max(0, Math.min(1, s.shadows ?? 0.65));
  let tallest = 0;
  for (let i = 0; i < height.length; i++) if (height[i] > tallest) tallest = height[i];
  yield;
  // Built things stand up out of the ground too (in pixels, like the treetops), and cast shadows:
  // a building's roof its own shape (a gable's end, a hip's slopes)
  const built = new Float32Array(W * H);
  // (whose roof each pixel is, for how much of each building the leaves hide)
  const roofOwner = new Int32Array(W * H), roofIds: string[] = [];
  const raise = (x: number, y: number, ft: number) => {
    const i = y * W + x, v = ft * k * 0.85;
    if (v > built[i]) built[i] = v;
    if (v > tallest) tallest = v;
  };
  for (const st of doc.items.filter(i => i.type === "structure") as StructureItem[]) {
    if (st.points.length < 2) continue;
    const tall = structureHeight(st);
    if (isLineKind(st.kind)) {
      // Each piece of the line: the pixels within half its width
      const path = structurePath(st).map(toScreen);
      const half = (structureWidth(st) / 2) * k;
      const top = st.kind === "bridge" ? tall + 3.5 : st.kind === "boardwalk" ? tall + 0.4 : st.kind === "stairs" ? 0.6 : tall;
      for (let j = 1; j < path.length; j++) {
        const a = path[j - 1], c = path[j], dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1;
        for (let y = Math.max(0, Math.floor(Math.min(a.y, c.y) - half)); y <= Math.min(H - 1, Math.ceil(Math.max(a.y, c.y) + half)); y++) {
          for (let x = Math.max(0, Math.floor(Math.min(a.x, c.x) - half)); x <= Math.min(W - 1, Math.ceil(Math.max(a.x, c.x) + half)); x++) {
            const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / l2));
            if (Math.hypot(x + 0.5 - a.x - dx * t, y + 0.5 - a.y - dy * t) <= half) raise(x, y, top);
          }
        }
      }
      continue;
    }
    const roof = st.kind === "building" || st.kind === "shelter" ? roofFor(st) : null;
    const shape = roof ? roof.eaves : st.points;
    const top = st.kind === "deck" ? tall + (tall > 2 ? 3 : 0) : tall;
    const b = boundsOf(shape.map(toScreen));
    const owner = roof ? roofIds.push(st.id) : 0;
    for (let y = Math.max(0, Math.floor(b.minY)); y <= Math.min(H - 1, Math.ceil(b.maxY)); y++) {
      for (let x = Math.max(0, Math.floor(b.minX)); x <= Math.min(W - 1, Math.ceil(b.maxX)); x++) {
        const p = toPlan(x + 0.5, y + 0.5);
        if (pointInPolygon(p, shape)) {
          raise(x, y, roof ? tall + roof.pitch * roof.run(p) : top);
          if (owner) roofOwner[y * W + x] = owner;
        }
      }
    }
  }
  yield;
  const sdx: number[] = [], sdy: number[] = [], sup: number[] = [];
  for (let d = 1.5; d < tallest / rise + 2 && d < 400; d *= 1.3) {
    const dx = Math.round(sunX * d), dy = Math.round(sunY * d);
    if (sdx.length && dx === sdx[sdx.length - 1] && dy === sdy[sdy.length - 1]) continue;
    sdx.push(dx); sdy.push(dy); sup.push(d * rise);
  }
  const nSteps = sdx.length;
  const soft = crownR * 0.7;
  /** How much sun reaches a pixel at height h0 (1 = full sun). */
  const sunlit = (x: number, y: number, h0: number) => {
    let shade = 0;
    for (let j = 0; j < nSteps; j++) {
      const up = h0 + sup[j];
      if (up >= tallest) break;
      const sx = x + sdx[j], sy = y + sdy[j];
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) break;
      const over = Math.max(height[sy * W + sx], built[sy * W + sx]) - up;
      if (over > 0) {
        shade = Math.max(shade, over / soft);
        if (shade >= 1) return 0;
      }
    }
    return 1 - shade;
  };
  // On the ground, every other pixel is enough (the shadows are soft)
  const hw = (W >> 1) + 1;
  const groundSun = new Float32Array(hw * ((H >> 1) + 1));
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) groundSun[(y >> 1) * hw + (x >> 1)] = sunlit(x, y, 0);
    if ((y & 15) === 0) yield 0.5 + 0.15 * (y / H);
  }
  yield;
  // (read smoothly between the samples taken every other pixel)
  const hh = (H >> 1) + 1;
  const sunAt = (x: number, y: number) => {
    const fx = Math.min(hw - 1.001, x * 0.5), fy = Math.min(hh - 1.001, y * 0.5), x0 = fx | 0, y0 = fy | 0, u = fx - x0, v = fy - y0, i = y0 * hw + x0;
    const top = groundSun[i] * (1 - u) + groundSun[i + 1] * u, bot = (groundSun[i + hw] ?? groundSun[i]) * (1 - u) + (groundSun[i + hw + 1] ?? groundSun[i + 1]) * u;
    return top * (1 - v) + bot * v;
  };
  // The ground darkens near the woods, all round (the light under the trees' edges)
  const near = (() => {
    const cov = newCanvas();
    cov.width = mw;
    cov.height = mh;
    const g = cov.getContext("2d", { willReadFrequently: true })!;
    const id = g.createImageData(mw, mh);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (height[y * W + x] > 0) id.data[((y >> 1) * mw + (x >> 1)) * 4] = 255;
    for (let m = 3; m < id.data.length; m += 4) id.data[m] = 255;
    g.putImageData(id, 0, 0);
    const o2 = newCanvas();
    o2.width = mw;
    o2.height = mh;
    const g2 = o2.getContext("2d", { willReadFrequently: true })!;
    g2.filter = `blur(${4.5 * (pt / cell)}px)`;
    g2.drawImage(cov, 0, 0);
    return g2.getImageData(0, 0, mw, mh).data;
  })();
  yield;
  // How far into the woods each spot is, softened: the floor under the trees shows only well
  // inside them and fades into the grass at their edges (the woods' outline is coarse; hard
  // edged, its gaps beside the treetops read as dark specks)
  const inWoods = (() => {
    const cov = newCanvas();
    cov.width = mw;
    cov.height = mh;
    const g = cov.getContext("2d", { willReadFrequently: true })!;
    const id = g.createImageData(mw, mh);
    for (let m = 0; m < wooded.length; m++) if (wooded[m]) id.data[m * 4] = 255;
    for (let m = 3; m < id.data.length; m += 4) id.data[m] = 255;
    g.putImageData(id, 0, 0);
    const o2 = newCanvas();
    o2.width = mw;
    o2.height = mh;
    const g2 = o2.getContext("2d", { willReadFrequently: true })!;
    g2.filter = `blur(${2.5 * (pt / cell)}px)`;
    g2.drawImage(cov, 0, 0);
    return g2.getImageData(0, 0, mw, mh).data;
  })();
  yield;
  // The ground's relief (hill shading), from the terrain, lit from the same side
  const relief = yield* reliefGridSteps(doc, s.hillshade || s.contours, W, H, toPlan, L, shadowK);
  // Contour lines painted in (when shown): a tidy interval for the course's rise and fall
  const contourIv = s.contours && relief ? contourInterval(relief.hi - relief.lo) : 0;
  const lxyL = Math.hypot(L.x, L.y) || 1;
  // Bare rock, a warm gray-tan
  const rockColor = [186, 172, 152];
  // How elevation is drawn (hill shading on): the contours' and terraces' steps in round numbers
  // of the course's own units, counted from sea level so their heights read as real ones
  // (Sketched, dropped, reads as Cliff edges)
  const reliefLook: ReliefLook | "off" = relief && s.hillshade ? (s.reliefLook === "sketched" ? "cliffs" : s.reliefLook ?? "shaded") : "off";
  const perFt = toUnits(1, doc.units), seaFt = doc.site.baseElevationFt ?? 0;
  const tidyStep = (raw: number) => { for (const iv of [1, 2, 5, 10, 20, 25, 30, 40, 50, 100, 200, 250, 500]) if (iv >= raw) return iv; return 1000; };
  const lineIv = reliefLook === "contours" ? tidyStep(((relief!.hi - relief!.lo) * perFt) / 30) / perFt : 0;
  const stepIv = reliefLook === "terraces" ? tidyStep(((relief!.hi - relief!.lo) * perFt) / 12) / perFt : 0;
  const inked = reliefLook === "cliffs" || reliefLook === "terraces";

  yield;
  // (the trees as worked out: each painting draws copies, never these)
  const treesOnce = vtrees;
  let last: { style: MapStyle; bits: Uint8Array; pre: Float32Array } | null = null;
  // ---------------------------------------------------------------- paint
  // (once for this painting, and again for each change of only its colors and tone, in that style;
  // `prev`, the last one's pixels: those the change doesn't reach only have their tone again)
  function* finish(s: MapStyle, prev: typeof last): Steps {
    const look = lookParts(s);
    const canvas = newCanvas();
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const vtrees = treesOnce.map(t => ({ ...t, col: [...t.col] as RGB }));
    // Every surface is a brightness, cut into a few tones of its own earthy palette (the
    // painted, cut-out look of hand-made course maps); `paint` 0 blends the tones smoothly
    const crisp = Math.max(0, Math.min(1, s.paint ?? 0.8));
    // Near-black gaps up to pale, sunlit sage tops
    const woodsFactors = [0.54, 0.69, 0.86, 1.02, 1.2, 1.46, 1.86, 2.4];
    const woods = palette(s.trees, woodsFactors, 6, 0.82);
    // Treetops in several colors where the landscape has them (autumn), one color per tree
    // (as vivid as Autumn colors asks, as in every look)
    const mixPals = treeMixOf(s).map(c => palette(vividLeaf(c, s.autumnVivid ?? 1), woodsFactors, 6, 0.9));
    // (pines keep their needles: deep blue-green whatever the season)
    const pinePal = palette("#2c4636", woodsFactors, 0, 0.9);
    // (under the 3D view, a little darker: its sun is brighter than the printed map's paper)
    const dim = (f: number[]) => (opts.under ? f.map(v => v * 0.88) : f);
    const fair = palette(s.fairway, dim([0.56, 0.7, 0.84, 1, 1.14, 1.28]), 4);
    const lawn = palette(s.rough, dim([0.6, 0.76, 0.9, 1.04, 1.18]), 3);
    // Tall grass: lighter and straw yellow
    const tallPal = palette(tallGrassOf(s), [0.62, 0.78, 0.92, 1.06, 1.2, 1.34], 6, 0.9);
    // (shaded green, never black: the gaps between treetops are where it shows)
    const floorPal = palette(s.trees, [0.5, 0.64, 0.8], 0, 0.9);
    // (the lightest tones toward teal: shallows and the rim)
    const water = palette(s.water, [0.42, 0.58, 0.76, 0.94, 1.12, 1.34, 1.62], -14);
    // Worn dirt: an olive tan, lighter than the shade around it (it reads as open ground)
    const dirtPal = palette(s.path, [0.86, 1.03, 1.19, 1.35, 1.54], -8, 0.85);
    // (under the 3D view, the 3D look's roads and parking)
    const road = palette(opts.under ? s.look3d?.paving ?? "#969a9d" : "#969a9d", [0.66, 0.8, 0.92, 1.02, 1.1], 0);
    // (concrete: lighter and warmer than the asphalt roads, so a walkway reads apart from a road)
    const walkPal = palette("#dcdad4", [0.8, 0.9, 0.97, 1.02, 1.06], 0, 0.6);
    const TIERS = ["dirt", "gravel", "walkway", "road"] as const;
    const order = (s.pathOrder?.length === 4 ? s.pathOrder : TIERS).map(t => TIERS.indexOf(t));
    const sandPal = palette("#b3a275", [0.78, 0.9, 1, 1.1], 0);
    // (gravel: a warm stone, speckled light and dark: never the smooth pale of concrete)
    const gravelPal = palette("#b3a891", [0.66, 0.82, 0.96, 1.1, 1.22], 0, 1.1);
    const chipsPal = palette(PATH_SURFACES.woodchips.color, [0.72, 0.86, 1, 1.16], 0);
    const roof = palette("#77716a", [0.6, 0.8, 1, 1.18], 0);
    // (the colors a change can be painted again for: which of them each pixel is mixed from)
    const mark = (pal: RGB[], bit: number) => Object.assign(pal, { bit });
    mark(lawn, MIX.grass); mark(fair, MIX.fairway); mark(water, MIX.water); mark(dirtPal, MIX.path); mark(tallPal, MIX.tall);
    let px = 0;
    const n6 = (pal: RGB[]) => pal.length;
    /** A palette tone for brightness v (0..1): bands with soft or crisp steps. */
    let tr0 = 0, tg0 = 0, tb0 = 0;
    const tone = (pal: RGB[], v: number) => {
      px |= (pal as RGB[] & { bit?: number }).bit ?? 0;
      const n = n6(pal);
      const f = Math.max(0, Math.min(0.9999, v)) * (n - 1);
      const i = Math.floor(f);
      const frac = f - i;
      // crisp: the next tone only in the last sliver of the band; smooth: a full blend
      const e = 1 - 0.88 * crisp;
      const t = frac < 1 - e ? 0 : (frac - (1 - e)) / e;
      const c0 = pal[i], c1 = pal[Math.min(n - 1, i + 1)];
      tr0 = c0[0] + (c1[0] - c0[0]) * t;
      tg0 = c0[1] + (c1[1] - c0[1]) * t;
      tb0 = c0[2] + (c1[2] - c0[2]) * t;
    };
    const thick = smooth(0.55, 1, cover);
    const bump = crownR * 0.75;
    // Leaf dabs grow with the page's resolution (tile pixels per pixel), a little bigger than a pixel
    // each; the crowns' own slope is softened so the dabs carry the texture (soft: sharp dabs and
    // dark gaps between clumps read as broccoli)
    const dabK = 0.8 / Math.max(0.5, pt * 0.85);
    const bumpK = 5;
    const img = ctx.createImageData(W, H);
    const o = img.data;
    let cr = 0, cg = 0, cb = 0;
    /** Lays a surface over what is there, with a narrow soft edge. */
    const lay = (pal: RGB[], v: number, alpha: number) => {
      if (alpha <= 0) return;
      tone(pal, v);
      cr += (tr0 - cr) * alpha;
      cg += (tg0 - cg) * alpha;
      cb += (tb0 - cb) * alpha;
    };
    const light = s.light ?? 0, contrast = s.contrast ?? 0, sat = s.colorStrength ?? 1;
    // The grass's own looks (Painted: the tone bands above): each from the course's grass color,
    // lighter and sunnier, its patterns in feet so they stay put however the map is framed
    const grassBase = rgbToHsl(hexRgb(s.rough));
    const lightLift = Math.max(0, Math.min(1, (0.85 - grassBase[2]) / 0.5));
    const gshift = (dl: number, dh: number, ds: number): RGB => hslToRgb(grassBase[0] + dh, Math.max(0, Math.min(1, grassBase[1] + ds)), Math.max(0.04, Math.min(0.92, grassBase[2] + dl)));
    const G = {
      meadow: [gshift(0.13, -6, 0.06), gshift(0.29, -14, 0.08), gshift(0.03, 0, 0.02)],
      field: [gshift(0.06, -22, 0.02), gshift(0.2, -34, 0.08), gshift(0.0, -12, 0.02)],
      mown: [gshift(0.08, -2, 0.04), gshift(0.14, -6, 0.06), gshift(0.02, 0, 0)],
      // (lifted less where the land is already light: sand stays sand, not white)
      storybook: [gshift(0.2 * lightLift, -4, 0.16), gshift(0.26 * lightLift, -8, 0.18), gshift(0.33 * lightLift, -14, 0.12)]
    };
    const blend = (p: RGB, q: RGB, t: number): RGB => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    // (the patterns are broad: a sample every other pixel, read between, is as good and a quarter the work)
    const GF = 2, gfw = Math.ceil(W / GF) + 2, gfh = Math.ceil(H / GF) + 2;
    const gStyle = look.grass.style;
    const field2 = (f1: (X: number, Y: number) => number, f2: (X: number, Y: number) => number) => {
      const A1 = new Float32Array(gfw * gfh), A2 = new Float32Array(gfw * gfh);
      for (let gy = 0; gy < gfh; gy++) for (let gx = 0; gx < gfw; gx++) {
        const sxp = (gx * GF - W / 2) / k, syp = (gy * GF - H / 2) / k, X = view.cx + sxp * cos + syp * sin, Y = view.cy - sxp * sin + syp * cos;
        A1[gy * gfw + gx] = f1(X, Y); A2[gy * gfw + gx] = f2(X, Y);
      }
      return [A1, A2] as const;
    };
    const gfields = gStyle === "meadow" ? field2((X, Y) => fbm(X * 0.006, Y * 0.006), (X, Y) => fbm(X * 0.03 + 4, Y * 0.03))
      : gStyle === "field" ? field2((X, Y) => fbm(X * 0.004 + Y * 0.002, Y * 0.03 - X * 0.012), (X, Y) => fbm(X * 0.008, Y * 0.008))
      : gStyle === "storybook" ? field2((X, Y) => fbm(X * 0.004, Y * 0.004), (X, Y) => fbm(X * 0.012 + 3, Y * 0.012))
      : gStyle === "mown" ? field2((X, Y) => fbm(X * 0.01, Y * 0.01), () => 0) : null;
    const gread = (arr: Float32Array, x: number, y: number) => {
      const fx = x / GF, fy = y / GF, ix = fx | 0, iy = fy | 0, u = fx - ix, v = fy - iy, j = iy * gfw + ix;
      return (arr[j] * (1 - u) + arr[j + 1] * u) * (1 - v) + (arr[j + gfw] * (1 - u) + arr[j + gfw + 1] * u) * v;
    };
    const grassColor = (style: string, X: number, Y: number, tex: number, mott: number, grain: number, px: number, py: number): RGB => {
      const f1 = gfields ? gread(gfields[0], px, py) : 0, f2 = gfields ? gread(gfields[1], px, py) : 0;
      if (style === "meadow") {
        const pp = f1, q = f2;
        const c0 = blend(blend(G.meadow[0], G.meadow[1], smooth(0.35, 0.75, pp)), G.meadow[2], smooth(0.55, 0.85, q) * 0.5 * tex);
        const kk = 0.94 + 0.08 * noise(X * 0.8, Y * 0.8) * tex + (grain - 0.5) * 0.04 * tex;
        return [c0[0] * kk, c0[1] * kk, c0[2] * kk];
      }
      if (style === "field") {
        const st = f1, pp = f2;
        const c0 = blend(blend(G.field[0], G.field[1], smooth(0.3, 0.8, pp * 0.6 + st * 0.4 * tex)), G.field[2], (1 - mott) * 0.15);
        const kk = 0.92 + 0.12 * noise(X * 0.8, Y * 0.8) * tex;
        return [c0[0] * kk, c0[1] * kk, c0[2] * kk];
      }
      if (style === "storybook") {
        // flat bright green, soft light patches, a fine dot grain (dots blended over a pixel)
        const pp = f1, q = f2;
        const c0 = blend(blend(G.storybook[0], G.storybook[1], smooth(0.4, 0.6, pp)), G.storybook[2], smooth(0.62, 0.72, q) * 0.6);
        const fx = ((X % 7) + 7) % 7 - 3.5, fy = ((Y % 7) + 7) % 7 - 3.5, dd2 = Math.hypot(fx, fy), aa = 0.7 / k;
        // (Texture: the dots deeper or fainter, as the style has them at its own 0.8)
        const kk = 1 - Math.min(0.15, 0.05 * (tex / 0.8)) * smooth(1.25 + aa, 1.25 - aa, dd2);
        return [c0[0] * kk, c0[1] * kk, c0[2] * kk];
      }
      // mown: stripes as a mower leaves them, blended over a pixel
      const band = Math.max(-1, Math.min(1, Math.sin((X * 0.6 + Y * 0.8) / 18) * (18 * k / 1.2)));
      const c0 = blend(G.mown[0], G.mown[1], f1);
      const kk = 1.005 + 0.055 * band * tex + (grain - 0.5) * 0.03;
      return [c0[0] * kk, c0[1] * kk, c0[2] * kk];
    };
    yield;
    // (a mask's channel k where the pixel is, from its four nearest cells)
    let q00 = 0, q10 = 0, q01 = 0, q11 = 0, w00 = 1, w10 = 0, w01 = 0, w11 = 0;
    // Each pixel's color before the tone, and the colors it was mixed from; painted again, the last
    // painting's, and only the pixels whose colors changed worked out again
    const redo = prev ? redoOf(prev.style, s) : ALL, reuse = !!prev && redo !== ALL;
    const bits = prev?.bits ?? new Uint8Array(W * H), pre = prev?.pre ?? new Float32Array(W * H * 3);
    /** The whole picture's brightness, contrast and color strength, on a pixel's color as kept. */
    const put = (o4: number, i3: number) => {
      let r = pre[i3], g = pre[i3 + 1], b = pre[i3 + 2];
      if (light !== 0 || contrast !== 0 || sat !== 1) {
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
        const kk = 1 + contrast, add = 128 * (1 - kk) + light * 255;
        r = r * kk + add; g = g * kk + add; b = b * kk + add;
      }
      o[o4] = r;
      o[o4 + 1] = g;
      o[o4 + 2] = b;
      o[o4 + 3] = 255;
    };
    const S = (arr: ArrayLike<number>, k: number) => arr[q00 + k] * w00 + arr[q10 + k] * w10 + arr[q01 + k] * w01 + arr[q11 + k] * w11;
    const rows = opts.rows ?? [0, H];
    // (the bands from the workers, when they're painting it: laid in, the pass done)
    const got = !prev && bands ? ((yield { wait: bands }) as Band[] | null) : null;
    if (got) {
      laidIn++;
      let y = 0;
      for (const b of got) {
        o.set(b.o, y * W * 4); pre.set(b.pre, y * W * 3); bits.set(b.bits, y * W);
        y += b.bits.length / W;
      }
    }
    for (let y = got ? H : rows[0]; y < rows[1]; y++) {
      if ((y & 7) === 0) yield 0.7 + 0.3 * (y / H);
      const my = Math.min(mh - 1, y >> 1) * mw;
      // (the masks read smoothly between their cells: edges blend over a pixel, never in steps)
      const fy = Math.max(0, Math.min(mh - 1.001, (y + 0.5) / cell - 0.5)), y0 = fy | 0, wy = fy - y0;
      const tr = (y & 511) << 9, tu = ((y - 1) & 511) << 9, td = ((y + 1) & 511) << 9;
      for (let x = 0, i = y * W; x < W; x++, i++) {
        const o4 = i * 4;
        if (reuse && !(bits[i] & redo)) { put(o4, i * 3); continue; }
        px = 0;
        const m = my + Math.min(mw - 1, x >> 1);
        const fx = Math.max(0, Math.min(mw - 1.001, (x + 0.5) / cell - 0.5)), x0 = fx | 0, wx = fx - x0;
        q00 = (y0 * mw + x0) * 4; q10 = q00 + 4; q01 = q00 + mw * 4; q11 = q01 + 4;
        w00 = (1 - wx) * (1 - wy); w10 = wx * (1 - wy); w01 = (1 - wx) * wy; w11 = wx * wy;
        const rh = relief ? relief.at(x, y, contourIv > 0 || lineIv > 0, inked) : null;
        let rf = rh && s.hillshade ? rh.shade : 1;
        // (terraces: each shelf flat and lit alike, a little lighter the higher it is, under the
        // shadow of higher ground; the inked looks: the light a little softer, the lines carry it)
        if (stepIv) rf = 1 + ((0.8 + 0.34 * ((Math.floor((seaFt + rh!.elev) / stepIv) * stepIv - seaFt - relief!.lo) / (relief!.hi - relief!.lo))) * rh!.amb - 1) * rh!.inside;
        else if (reliefLook === "contours") rf = 1 + (rf - 1) * 0.7;
        const h = height[i];
        if (h > 0) {
          // Treetops: the slope of the leafy surface (neighbours outside the crowns count as level)
          const c0 = h + LEAF[tr | (x & 511)] * bump;
          const hr = x < W - 1 && height[i + 1] > 0 ? height[i + 1] + LEAF[tr | ((x + 1) & 511)] * bump : c0;
          const hl = x > 0 && height[i - 1] > 0 ? height[i - 1] + LEAF[tr | ((x - 1) & 511)] * bump : c0;
          const hd = y < H - 1 && height[i + W] > 0 ? height[i + W] + LEAF[td | (x & 511)] * bump : c0;
          const hu = y > 0 && height[i - W] > 0 ? height[i - W] + LEAF[tu | (x & 511)] * bump : c0;
          const gx = (hr - hl) * 0.5, gy = (hd - hu) * 0.5;
          const lam = Math.max(0, (-gx * L.x - gy * L.y + L.z) / Math.sqrt(gx * gx + gy * gy + 1));
          const sun = sunlit(x, y, h);
          // Leaf dabs on the treetop, lit by the sun: a little paler on the sunny side of each clump,
          // a little darker between them, the tree's own roundness lit over them
          const fx = x * dabK, fy = y * dabK;
          const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy;
          const r0 = (iy & 511) << 9, r1 = ((iy + 1) & 511) << 9, c0x = ix & 511, c1x = (ix + 1) & 511;
          const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
          const j00 = r0 | c0x, j10 = r0 | c1x, j01 = r1 | c0x, j11 = r1 | c1x;
          const dh = DH[j00] * w00 + DH[j10] * w10 + DH[j01] * w01 + DH[j11] * w11;
          const nx = gx / bumpK + (DGX[j00] * w00 + DGX[j10] * w10 + DGX[j01] * w01 + DGX[j11] * w11) * 1.6;
          const ny = gy / bumpK + (DGY[j00] * w00 + DGY[j10] * w10 + DGY[j01] * w01 + DGY[j11] * w11) * 1.6;
          const lit = Math.max(0, (-nx * L.x - ny * L.y + L.z) / Math.sqrt(nx * nx + ny * ny + 1));
          const occ = smooth(0.04, 0.5, dh);
          const shade = 1 - shadowK * 0.9 * (1 - sun);
          let v = (0.17 + 0.6 * lit) * (0.8 + 0.2 * occ) * shade;
          v += smooth(0.8, 0.97, lit) * occ * sun * 0.03;
          v += at(stands, x, y) * 0.2 + ((kind[i] % 3) - 1) * 0.025 + (lam - 0.6) * 0.28;
          // (hills read through the trees: their shaded sides darker, as from the air)
          v *= 0.58 + 0.42 * rf;
          tone(kind[i] === PINE ? pinePal : mixPals.length ? mixPals[kind[i] % mixPals.length] : woods, v);
          cr = tr0; cg = tg0; cb = tb0;
        } else {
          // The ground: grass, or the dark floor under the trees, then what is drawn on it
          const sun = sunAt(x, y);
          const ao = S(near, 0) / 255;
          // (the grass darkens in a band along the trees, as on painted maps)
          const lit = (1 - shadowK * 0.75 * (1 - sun)) * (1 - 0.62 * shadowK * ao) * rf;
          const mott = at(mottle, x, y);
          const grain = GRAIN[tr | (x & 511)];
          if (look.grass.style === "painted") {
            // (brighter than the tones go: the whole lawn lighter; Texture, its mottle stronger or
            // calmer about the same middle, as every grass look has it)
            tone(lawn, (0.84 + (mott * 0.5 + grain * 0.18 - 0.34) * look.grass.texture) * Math.min(1, look.grass.bright) * lit);
            const lift = Math.max(1, look.grass.bright);
            cr = tr0 * lift; cg = tg0 * lift; cb = tb0 * lift;
          }
          else {
            // (the plan position, in feet, for the grass's own patterns)
            const sxp = (x - W / 2) / k, syp = (y - H / 2) / k, X = view.cx + sxp * cos + syp * sin, Y = view.cy - sxp * sin + syp * cos;
            const g0 = grassColor(look.grass.style, X, Y, look.grass.texture, mott, grain, x, y);
            px |= MIX.grass;
            const kk = look.grass.bright * lit;
            cr = g0[0] * kk; cg = g0[1] * kk; cb = g0[2] * kk;
          }
          // Cliffs and steep banks: bare rock in ledges across the slope (the layers of a canyon
          // wall), broken up at its edge, lit like the ground round it (on the map only: the 3D
          // ground keeps its own colors on a slope, its shape showing it's steep)
          if (rh && reliefLook === "shaded" && rh.rock > 0.02 && !opts.under) {
            const ledge = rh.elev / 11 + (fbm(x / pt * 0.03 + 70, y / pt * 0.03) - 0.5) * 2.2 + (noise(x / pt * 0.4, y / pt * 0.4) - 0.5) * 0.25;
            const fr = ledge - Math.floor(ledge);
            const band = 0.88 + 0.18 * smooth(0.1, 0.5, fr) - 0.16 * smooth(0.86, 1, fr);
            const rv = (0.78 + (grain - 0.5) * 0.3 + mott * 0.16) * band * lit;
            const ra = smooth(0.15, 0.75, rh.rock + (fbm(x / pt * 0.12 + 90, y / pt * 0.12) - 0.5) * 0.6);
            cr += (rockColor[0] * rv - cr) * ra; cg += (rockColor[1] * rv - cg) * ra; cb += (rockColor[2] * rv - cb) * ra;
          }
          // Cliff edges: the walls darker than the ground above and below, worn into ledges
          if (rh && reliefLook === "cliffs" && rh.wall > 0.02) {
            const ledge = rh.elev / 12 + (fbm(x / pt * 0.03 + 70, y / pt * 0.03) - 0.5) * 2.2;
            const fr = ledge - Math.floor(ledge);
            const wk = 1 - rh.wall * (0.26 + 0.16 * smooth(0.86, 1, fr) - 0.06 * smooth(0.1, 0.5, fr));
            cr *= wk; cg *= wk; cb *= wk;
          }
          // The floor under the trees, well inside the woods (fading out toward their edges)
          const deep = smooth(0.55, 0.95, S(inWoods, 0) / 255);
          if (deep > 0) {
            if (thick > 0.5 && !opts.under) lay(floorPal, (0.5 + mott * 0.4 + grain * 0.2) * (0.35 + 0.65 * lit), deep);
            else lay(lawn, (0.45 + mott * 0.4 + grain * 0.2) * lit * 0.8, deep);
          }
          // Tall grass: in tufts, its blades streaked up and down; its edge fading into the grass
          // over a few feet, ragged, tufts reaching out past it and the lawn reaching in
          const tg = S(dd, 2) / 255;
          if (tg > 0.04) {
            const tuft = noise(x / pt * 0.9 + 30, y / pt * 0.3) - 0.5;
            const edge = (fbm(x / pt * 0.3 + 160, y / pt * 0.3) - 0.5) * 0.3 + (noise(x / pt * 1.4 + 7, y / pt * 0.45) - 0.5) * 0.22;
            lay(tallPal, (0.5 + tuft * 0.55 + (GRIT[tr | (x & 511)] - 0.5) * 0.3 + mott * 0.2) * lit, smooth(0.2, 0.72, tg + edge));
          }
          const f = S(a, 0) / 255, r = S(b, 1) / 255;
          const rag = f > 0.05 || r > 0.2 ? fbm(x / pt * 0.16 + 50, y / pt * 0.16) - 0.5 : 0;
          // Fairways: light down the middle, darker toward the trees, soft ragged edges
          if (f > 0.05) {
            const mid = smooth(0.05, 0.9, S(middle, 2) / 255);
            const fv = (0.44 + 0.62 * mid + at(fairMottle, x, y) * 0.3 + grain * 0.08) * look.fairway.bright * lit;
            // (its edge fading into the grass round it)
            const fa = smooth(0.3, 0.62, f + rag * 0.45);
            if (look.fairway.style === "stripes") {
              // mown stripes: bands across the plan, about 26 ft, blended over a pixel
              const sxp = (x - W / 2) / k, syp = (y - H / 2) / k, X = view.cx + sxp * cos + syp * sin, Y = view.cy - sxp * sin + syp * cos;
              const band = Math.max(-1, Math.min(1, Math.sin(((X + Y) * 0.7071 * Math.PI) / 26) * (26 / (Math.PI * 1.2 / k))));
              lay(fair, fv * (1.02 + 0.06 * band), fa);
            } else if (look.fairway.style === "outlined") {
              // a crisp dark outline round a striped fairway (as a storybook draws it)
              const sxp = (x - W / 2) / k, syp = (y - H / 2) / k, X = view.cx + sxp * cos + syp * sin, Y = view.cy - sxp * sin + syp * cos;
              const band = Math.max(-1, Math.min(1, Math.sin(((X + Y) * 0.7071 * Math.PI) / 22) * (22 / (Math.PI * 1.2 / k))));
              lay(fair, fv * (1.06 + 0.04 * band), fa);
              const fe = f + rag * 0.12, rim = smooth(0.4, 0.45, fe) * (1 - smooth(0.5, 0.56, fe));
              cr += (34 * 1.4 - cr) * rim * 0.9; cg += (84 - cg) * rim * 0.9; cb += (34 - cb) * rim * 0.9;
            } else if (look.fairway.style === "sunlit") {
              lay(fair, fv * 1.04, fa);
              // (warm sun down the middle)
              const sm2 = fa * mid * 0.45;
              cr += (236 - cr) * sm2; cg += (228 - cg) * sm2; cb += (150 - cb) * sm2;
            } else lay(fair, fv, fa);
          }
          const sa = S(c, 1) / 255;
          if (sa > 0.3) lay(sandPal, (0.6 + grain * 0.3) * lit, smooth(0.45, 0.55, sa));
          // Paths and roads, stacked in the order the style sets (unset: dirt under gravel, gravel
          // under paved walkways, walkways under roads and parking)
          for (let li = 0; li < order.length; li++) {
            const layer = order[li];
            if (look.paths.style === "trail" && (layer === 0 || layer === 1)) continue;
            if (layer === 3) {
              // Roads and parking: soft gray, darker at the edges, a little gravel
              if (r > 0.2) lay(road, (0.35 + 0.45 * smooth(0.45, 0.9, r) + grain * 0.25 + mott * 0.1) * lit, smooth(0.38, 0.5, r + rag * 0.04));
            } else if (layer === 0) {
              // Dirt: fuzzy edged, speckled with lighter and darker grit
              const d = S(b, 0) / 255;
              if (d > 0.1) {
                const da = smooth(0.45, 0.55, d + (fbm(x / pt * 0.35 + 80, y / pt * 0.35) - 0.5) * 0.12);
                if (da > 0) {
                  const grit = GRIT[tr | (x & 511)];
                  lay(dirtPal, (0.52 + (grit - 0.5) * 0.7 + mott * 0.3) * (0.45 + 0.55 * lit), da);
                }
              }
            } else if (layer === 1) {
              // Gravel and wood chips: speckled, fuzzy edged like the dirt
              const gv = S(dd, 0) / 255, ch2 = S(dd, 1) / 255;
              if (gv > 0.1 || ch2 > 0.1) {
                const edge = (fbm(x / pt * 0.35 + 120, y / pt * 0.35) - 0.5) * 0.12;
                const grit = GRIT[tr | (x & 511)];
                if (gv > 0.1) lay(gravelPal, (0.55 + (grit - 0.5) * 0.8 + mott * 0.2) * (0.5 + 0.5 * lit), smooth(0.45, 0.55, gv + edge));
                if (ch2 > 0.1) lay(chipsPal, (0.5 + (grit - 0.5) * 0.9 + mott * 0.25) * (0.45 + 0.55 * lit), smooth(0.45, 0.55, ch2 + edge));
              }
            } else {
              // Paved walkways: pale concrete, a little darker at the edges, a faint fine grit
              const wk = S(ee, 0) / 255;
              if (look.paths.style === "clean" && wk > 0.2) { const rim = smooth(0.25, 0.42, wk) * (1 - smooth(0.5, 0.66, wk)); cr *= 1 - 0.3 * rim; cg *= 1 - 0.3 * rim; cb *= 1 - 0.3 * rim; }
              if (wk > 0.2) lay(walkPal, (0.42 + 0.4 * smooth(0.45, 0.9, wk) + (GRIT[tr | (x & 511)] - 0.5) * 0.12 + mott * 0.08) * (0.55 + 0.45 * lit), smooth(0.4, 0.52, wk));
            }
          }
          if (look.paths.style === "clean") {
            const pv = Math.max(S(b, 0), S(dd, 0), S(dd, 1)) / 255;
            if (pv > 0.2) { const rim = smooth(0.3, 0.45, pv) * (1 - smooth(0.52, 0.66, pv)); cr *= 1 - 0.32 * rim; cg *= 1 - 0.32 * rim; cb *= 1 - 0.32 * rim; }
          }
          const bd = S(c, 0) / 255;
          if (bd > 0.25) lay(roof, (0.25 + 0.6 * smooth(0.5, 0.8, bd)) * (0.6 + 0.4 * lit), smooth(0.42, 0.52, bd));
          // Water. Ponds: lighter in the shallows, deepening toward the middle, a bright rim just
          // inside the shore and a few faint lines following it out (as cartographers draw water),
          // and now and then a glint of sun. Creeks: dark at the banks, light down the middle.
          const w0 = S(wet, 2) / 255;
          if (w0 > 0.25) {
            const w = w0 + (fbm(x / pt * 0.25 + 120, y / pt * 0.25) - 0.5) * 0.1;
            if (w > 0.36) {
              const ripple = noise(x / pt * 0.35 + 7, y / pt * 0.12) - 0.5;
              const d = shore[m], open = smooth(2.5 * pt, 7 * pt, openWater[m]);
              const creek = 0.15 + 0.6 * smooth(0.4, 0.8, w) + ripple * 0.1;
              let pond = 0.7 - 0.38 * smooth(0, 32 * pt, d) + ripple * 0.06;
              pond += 0.24 * (1 - smooth(0.5 * pt, 1.8 * pt, d));
              for (let k = 1; k <= 3; k++) {
                const at = (2.2 + k * k * 1.6) * pt;
                pond += (0.11 / k) * (1 - smooth(0.2 * pt, 0.75 * pt, Math.abs(d - at))) * (1 - 0.4 * smooth(0, 30 * pt, d));
              }
              const sun = sunAt(x, y);
              if (sun > 0.9 && d > 6 * pt && GRIT[tr | (x & 511)] > 0.93 && GRIT[((y >> 1) & 511) << 9 | ((x * 3) & 511)] > 0.6) pond += 0.3;
              let wv = (creek + (pond - creek) * open) * (0.55 + 0.45 * lit);
              if (look.water.style === "glinting") wv *= 0.78;
              // (flat: one bright blue, a little deeper in the middle, a white line just inside the shore)
              if (look.water.style === "flat") wv = (0.7 + 0.12 * (1 - smooth(0, 24 * pt, d)) * open - 0.08 * smooth(4 * pt, 30 * pt, d) * open) * (0.55 + 0.45 * lit);
              lay(water, wv, smooth(0.4, 0.46, w));
              if (look.water.style === "flat") {
                const ring = (1 - smooth(0.35 * pt, 0.8 * pt, Math.abs(d - 1.8 * pt))) * open * 0.55 * smooth(0.4, 0.46, w);
                cr += (255 - cr) * ring; cg += (255 - cg) * ring; cb += (255 - cb) * ring;
              }
              if (look.water.style === "painterly") {
                // (foam streaks along the current, on the creeks; a pale rim at the shore)
                // (and on open water, soft long brush strokes across it, lighter and darker: painted, not deep)
                const foam = smooth(0.62, 0.7, fbm(x / pt * 0.12 + 40, y / pt * 0.5)) * (1 - open) * 0.38 + (1 - smooth(0.3 * pt, 1.4 * pt, d)) * 0.18
                  + smooth(0.52, 0.72, fbm(x / pt * 0.035 + 11, y / pt * 0.16)) * open * 0.16;
                const dab = smooth(0.55, 0.75, fbm(x / pt * 0.03 + 90, y / pt * 0.14)) * open * 0.12 * smooth(0.4, 0.46, w);
                cr *= 1 - dab; cg *= 1 - dab * 0.7; cb *= 1 - dab * 0.4;
                const fa2 = foam * smooth(0.4, 0.46, w);
                cr += (240 - cr) * fa2; cg += (250 - cg) * fa2; cb += (250 - cb) * fa2;
              } else if (look.water.style === "glinting") {
                const gl = smooth(0.82, 0.9, noise(x / pt * 0.9 + 3, y / pt * 2.2)) * smooth(0.5, 0.6, fbm(x / pt * 0.05, y / pt * 0.05)) * sunAt(x, y) * 0.75 * smooth(0.4, 0.46, w);
                cr += (255 - cr) * gl; cg += (231 - cg) * gl; cb += (168 - cb) * gl;
              }
            }
          }
          // Illuminated contours on the open ground (never across the treetops or water): light
          // where the slope faces the sun, dark where it faces away, every fifth a little bolder
          if (contourIv > 0 && relief && w0 <= 0.3) {
            const gX = rh!.sx, gY = rh!.sy;
            const g = Math.hypot(gX, gY);
            if (g > 1e-5) {
              const k = rh!.elev / contourIv, near = Math.round(k);
              const dpx = (Math.abs(k - near) * contourIv) / g;
              const index = near % 5 === 0;
              const half = (index ? 0.7 : 0.42) * pt;
              if (dpx < half + 0.8) {
                const a = (1 - smooth(half - 0.4, half + 0.8, dpx)) * (index ? 1 : 0.75);
                const face = (-gX * L.x - gY * L.y) / (g * lxyL);
                if (face > 0.15) {
                  const m = a * (0.12 + 0.4 * face);
                  cr += (250 - cr) * m; cg += (246 - cg) * m; cb += (222 - cb) * m;
                } else {
                  const m = a * (0.22 + 0.4 * Math.max(0, -face));
                  cr += (14 - cr) * m; cg += (24 - cg) * m; cb += (12 - cb) * m;
                }
              }
            }
          }
          if (rh && w0 <= 0.3 && reliefLook !== "off" && reliefLook !== "shaded") {
            // The rim of every drop, inked, with a pale lip of light just above it (only where the
            // ground bulges: the foot of a wall gets none)
            if (reliefLook === "cliffs") {
              const gw2 = Math.hypot(rh.wgx, rh.wgy);
              if (gw2 > 1e-4 && rh.cv > 0) {
                const dpx = (rh.wall - 0.5) / gw2;
                const conv = smooth(0, 0.15, rh.cv);
                const lip = dpx < 0 ? (1 - smooth(1.2 * pt, 6 * pt, -dpx)) * smooth(0.7 * pt, 1.5 * pt, -dpx) * conv * 0.42 : 0;
                if (lip > 0) { cr += (255 - cr) * lip; cg += (242 - cg) * lip; cb += (200 - cb) * lip; }
                const ln = (1 - smooth(0.7 * pt, 1.5 * pt, Math.abs(dpx))) * conv * 0.88;
                if (ln > 0) { cr += (48 - cr) * ln; cg += (34 - cg) * ln; cb += (22 - cb) * ln; }
              }
            }
            // Contours: a lit line every so often (every fifth bolder), at round heights
            if (lineIv) {
              const gX = rh.sx, gY = rh.sy, g = Math.hypot(gX, gY);
              if (g > 1e-5) {
                const kk = (seaFt + rh.elev) / lineIv, near = Math.round(kk);
                const dpx = (Math.abs(kk - near) * lineIv) / g;
                const index = near % 5 === 0;
                const half = (index ? 0.75 : 0.42) * pt;
                if (dpx < half + 0.8) {
                  const a = (1 - smooth(half - 0.4, half + 0.8, dpx)) * (index ? 1 : 0.8);
                  const face = (-gX * L.x - gY * L.y) / (g * lxyL);
                  if (face > 0.15) {
                    const m = a * (0.18 + 0.5 * face);
                    cr += (252 - cr) * m; cg += (248 - cg) * m; cb += (226 - cb) * m;
                  } else {
                    const m = a * (0.3 + 0.45 * Math.max(0, -face));
                    cr += (30 - cr) * m; cg += (32 - cg) * m; cb += (22 - cb) * m;
                  }
                }
              }
            }
            // Terraces: at each step a fine dark line, a pale lip on top, and a soft shadow thrown
            // down onto the shelf below (longer where the step faces away from the sun)
            if (stepIv) {
              const gX = rh.sx, gY = rh.sy, g = Math.hypot(gX, gY);
              if (g > 1e-5) {
                const t = (seaFt + rh.elev) / stepIv, n0 = Math.round(t);
                const dpx = ((t - n0) * stepIv) / g;
                const face = (-gX * L.x - gY * L.y) / (g * lxyL);
                if (dpx < 0) {
                  const sh = (1 - smooth(0, (4 + 9 * Math.max(0, -face)) * pt, -dpx)) * 0.38;
                  cr *= 1 - sh; cg *= 1 - sh; cb *= 1 - sh * 0.85;
                } else {
                  const lip = (1 - smooth(0.8 * pt, 3 * pt, dpx)) * smooth(0.3 * pt, 0.8 * pt, dpx) * (0.26 + 0.26 * Math.max(0, face));
                  cr += (255 - cr) * lip; cg += (246 - cg) * lip; cb += (214 - cb) * lip;
                }
                const ln = (1 - smooth(0.4 * pt, 1.0 * pt, Math.abs(dpx))) * 0.48;
                cr += (40 - cr) * ln; cg += (34 - cg) * ln; cb += (24 - cb) * ln;
              }
            }
          }
        }
        // Relief in color, as on Swiss maps: slopes facing the sun a little warmer, slopes facing
        // away a little cooler, high ground a touch lighter than low (half as much on treetops)
        // (strong enough that a canyon or a ridge reads at a glance: the slope away from the sun as
        // much as half in shadow, the slope toward it warmed; treetops get a little less, so the
        // woods stay woods)
        if (relief && s.hillshade) {
          const tt = (rf - 1) * (h > 0 ? 0.7 : 1) * (stepIv ? 0.5 : 1);
          if (tt > 0) {
            const k = Math.min(0.45, tt * 1.3);
            cr += (255 - cr) * k * 0.42; cg += (244 - cg) * k * 0.36; cb += (206 - cb) * k * 0.16;
          } else {
            const k = Math.min(0.6, -tt * 1.5);
            cr += (28 - cr) * k * 0.62; cg += (38 - cg) * k * 0.58; cb += (58 - cb) * k * 0.55;
          }
          // (and high ground a touch lighter than low, so which way is down reads too)
          const lift = ((rh!.elev - relief.lo) / (relief.hi - relief.lo) - 0.5) * 0.16 * rh!.inside;
          cr *= 1 + lift; cg *= 1 + lift; cb *= 1 + lift * 0.7;
        }
        // The whole picture: brightness, contrast and color strength (on the color as kept)
        const i3 = i * 3;
        pre[i3] = cr; pre[i3 + 1] = cg; pre[i3 + 2] = cb;
        bits[i] = px;
        put(o4, i3);
      }
    }
    if (opts.rows) {
      const [y0, y1] = opts.rows;
      bandOut = { o: o.slice(y0 * W * 4, y1 * W * 4), pre: pre.slice(y0 * W * 3, y1 * W * 3), bits: bits.slice(y0 * W, y1 * W) };
      return canvas;
    }
    last = { style: s, bits, pre };
    yield;
    // (the open ground everywhere: its tone bands' steps; treetops and roofs only at their outline,
    // so the leaf grain stays crisp)
    const solid = (i: number) => height[i] > 0 || built[i] > 0;
    yield* smoothEdgeSteps(o, W, H, i => !solid(i) || !solid(i + 1) || !solid(i - 1) || !solid(i + W) || !solid(i - W));
    ctx.putImageData(img, 0, 0);
    yield;
    const lxy = Math.hypot(sunX, sunY) || 1, Lx = sunX / lxy, Ly = sunY / lxy;
    if (vector) roomBetween(vtrees);
    // (the picture's brightness, contrast and color strength on the vector looks' trees too: they're
    // drawn after the pass that gives the rest of the map them)
    const adjust = (c: RGB): RGB => {
      if (light === 0 && contrast === 0 && sat === 1) return c;
      const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], kk = 1 + contrast, add = 128 * (1 - kk) + light * 255;
      return [c[0], c[1], c[2]].map(v => Math.max(0, Math.min(255, (lum + (v - lum) * sat) * kk + add))) as RGB;
    };
    if (vector) for (const t of vtrees) t.col = adjust(t.col);
    if (vector) {
      // (none at 0%, as the other looks; as long as the sun's height makes them, 38° the usual)
      const strength = shadowK * 1.72, long = Math.max(0.3, Math.min(3, Math.tan((38 * Math.PI) / 180) / rise));
      if (strength > 0.01) drawShadows(ctx, vtrees, Lx * long, Ly * long, pl, strength, vstyle === "drybrush" ? 1 : vstyle === "cloud" ? 0.3 : 0.6);
      yield 0.92;
      if (vstyle === "brushed") {
        // (every crown brushed on, a step at a time, leafy and pine, the smallest too; a pine in the
        // map's own green, as an evergreen keeps (not the autumn mix); specks too small to paint, as
        // the other looks draw them)
        const pineGreens = (() => {
          const [h0, s0, l0] = rgbToHsl(hexRgb("#354a2c")), [h1, s1, l1] = rgbToHsl(hexRgb(s.trees));
          return STYLE_GREENS.brushed.map(c => { const [h, sl, l] = rgbToHsl(hexRgb(c)); const g = hslToRgb(h + (h1 - h0), Math.max(0, Math.min(1, sl * (s1 / Math.max(0.05, s0)))), Math.max(0.05, Math.min(0.9, l * (l1 / Math.max(0.05, l0))))); return [g[0] * 0.86, g[1] * 0.94, g[2] * 0.96] as RGB; });
        })();
        const painted = vtrees.filter(t => t.r >= 1.5);
        yield* drawBrushedSteps(ctx, painted.map(t => ({ x: t.x, y: t.y, r: t.r, h: t.h, seed: t.seed, pine: t.pine, col: t.pine ? adjust(asKind(pineGreens[Math.floor(t.seed * 997) % pineGreens.length], t.look)) : t.col })), [Lx, Ly], k);
        drawTrees(ctx, vtrees.filter(t => t.r < 1.5), "cluster", Lx, Ly, pl);
      } else drawTrees(ctx, vtrees, vstyle, Lx, Ly, pl);
    }
    // Paths and walks where the leaves cover them: a pale dashed line with a dark edge over the
    // treetops, as trail maps draw them, so you can see where a path leads through the woods (in the
    // open it's painted as it is; the Trail look dashes the unpaved ones everywhere already)
    const trailed = (l: LineItem) => look.paths.style === "trail" && l.surface !== "paved" && l.surface !== "grass";
    const covered = (doc.items.filter(i => i.type === "line" && (i.kind === "path" || i.kind === "walk")) as LineItem[]).filter(l => !trailed(l)).map(l => paintedLine(l, view.scale).points).filter(p => p.length >= 2);
    if (covered.length && !opts.under) {
      // (where the leaves are: the treetops painted in, and the crowns drawn over the painting)
      const cover = newCanvas();
      cover.width = W; cover.height = H;
      const cg = cover.getContext("2d")!;
      const mask = cg.createImageData(W, H), md = mask.data;
      for (let i = 0; i < W * H; i++) if (height[i] > 0) md[i * 4 + 3] = 255;
      cg.putImageData(mask, 0, 0);
      cg.beginPath();
      for (const t of vtrees) { cg.moveTo(t.x + t.r, t.y); cg.arc(t.x, t.y, t.r, 0, Math.PI * 2); }
      cg.fill();
      // (the lines, then only what's under the leaves kept)
      const lines = newCanvas();
      lines.width = W; lines.height = H;
      const lg = lines.getContext("2d")!;
      lg.lineCap = "round"; lg.lineJoin = "round";
      const trace = (pts: P[]) => { lg.beginPath(); pts.forEach((q, i) => { const sp = toScreen(q); if (i) lg.lineTo(sp.x, sp.y); else lg.moveTo(sp.x, sp.y); }); lg.stroke(); };
      lg.strokeStyle = "rgba(22,28,18,.55)"; lg.lineWidth = Math.max(2, 2.8 * pt);
      covered.forEach(trace);
      lg.setLineDash([4 * pt, 3 * pt]); lg.strokeStyle = pl.mode === "night" ? "rgba(220,228,255,.92)" : "rgba(246,238,214,.95)"; lg.lineWidth = Math.max(1.1, 1.5 * pt);
      covered.forEach(trace);
      lg.globalCompositeOperation = "destination-in";
      lg.drawImage(cover, 0, 0);
      ctx.drawImage(lines, 0, 0);
    }
    yield;
    if (pl.mist) {
      const mr = seeded(31), spots: { x: number; y: number; r: number }[] = [];
      // (only over open ground well away from the woods, never on the hole's own fairway)
      for (let i = 0; i < 200 && spots.length < 10; i++) {
        const x = mr() * W, y = mr() * H, mm = (Math.min(mh - 1, y >> 1) * mw + Math.min(mw - 1, x >> 1)) * 4;
        if (inWoods[mm] > 40 || a[mm] > 40 || near[mm] > 90) continue;
        spots.push({ x, y, r: (50 + mr() * 70) * k });
      }
      drawMist(ctx, spots);
    }
    gradeLight(ctx, W, H, Lx, Ly, pl);
    // (the newer looks draw their crowns as shapes, not into the height field: their tops stamped
    // here, a low dome each, for which roofs they cover and shade)
    let tops = height, topMost = tallest;
    if (vector && vtrees.length) {
      tops = new Float32Array(height);
      for (const t of vtrees) {
        const r = t.r, r2 = r * r;
        for (let y = Math.max(0, Math.floor(t.y - r)); y <= Math.min(H - 1, Math.ceil(t.y + r)); y++) {
          for (let x = Math.max(0, Math.floor(t.x - r)); x <= Math.min(W - 1, Math.ceil(t.x + r)); x++) {
            const d2 = ((x + 0.5 - t.x) ** 2 + (y + 0.5 - t.y) ** 2) / r2;
            if (d2 > 1) continue;
            const h = t.h * (0.75 + 0.25 * Math.sqrt(1 - d2)), i = y * W + x;
            if (h > tops[i]) tops[i] = h;
            if (h > topMost) topMost = h;
          }
        }
      }
    }
    if (look.paths.style === "trail") {
      // dirt and gravel paths as dashed trail lines (walkways and roads stay painted)
      ctx.save();
      // (a light tint of the paths' color, so a color picked for them shows here too)
      const tint = hexRgb(s.path ?? "#c8b48a"), up = (c: number, w: number) => Math.round(c + (w - c) * 0.6);
      ctx.strokeStyle = pl.mode === "night" ? `rgba(${up(tint[0], 220)},${up(tint[1], 228)},${up(tint[2], 255)},.85)` : `rgba(${up(tint[0], 255)},${up(tint[1], 255)},${up(tint[2], 255)},.9)`;
      ctx.lineCap = "round"; ctx.setLineDash([4 * pt, 3.2 * pt]);
      // (each as wide as its path, a third of it, never thinner than reads; the walks between holes
      // along the same winding line they're painted on)
      const trail = (pts: P[], widthFt: number) => { if (pts.length < 2) return; ctx.lineWidth = Math.max(1.2, 1.1 * pt, widthFt * k * 0.35); ctx.beginPath(); pts.forEach((q, i) => { const sp = toScreen(q); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); }); ctx.stroke(); };
      for (const l of doc.items.filter(i => i.type === "line" && (i.kind === "path" || i.kind === "walk")) as LineItem[]) if (l.surface !== "paved" && l.surface !== "grass") trail(paintedLine(l, view.scale).points, l.width || 5);
      for (const w of walked) trail(w.pts, w.width);
      ctx.restore();
    }
    // (labels kept off the treetops, every look's: the vector looks' crowns are in `tops`)
    if (lineIv) contourLabels(ctx, relief!, W, H, pt, lineIv, seaFt, doc.units, tops, s.labelScale ?? 1);
    // The treetops over the buildings, and the trees' shade on the roofs: a picture of its own (clear
    // elsewhere), laid over the buildings, which are drawn over the painting
    {
      // (the shade on a roof, from whatever stands between it and the sun: the treetops as stamped)
      const tdx: number[] = [], tdy: number[] = [], tup: number[] = [];
      for (let d = 1.5; d < topMost / rise + 2 && d < 400; d *= 1.3) {
        const dx = Math.round(sunX * d), dy = Math.round(sunY * d);
        if (tdx.length && dx === tdx[tdx.length - 1] && dy === tdy[tdy.length - 1]) continue;
        tdx.push(dx); tdy.push(dy); tup.push(d * rise);
      }
      const roofSun = (x: number, y: number, h0: number) => {
        let shade = 0;
        for (let j = 0; j < tdx.length; j++) {
          const up = h0 + tup[j];
          if (up >= topMost) break;
          const sx = x + tdx[j], sy = y + tdy[j];
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) break;
          const over = Math.max(tops[sy * W + sx], built[sy * W + sx]) - up;
          if (over > 0) {
            shade = Math.max(shade, over / soft);
            if (shade >= 1) return 0;
          }
        }
        return 1 - shade;
      };
      const near = new Uint8Array(W * H);
      let any = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (built[y * W + x] <= 0) continue;
        any = true;
        // (a little past the roof's edge, so its outline is under the leaves too)
        const rr = Math.max(2, Math.round(pt * 1.5));
        for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) near[yy * W + xx] = 1;
        }
      }
      if (any && !opts.under) {
        const fin = ctx.getImageData(0, 0, W, H).data;
        const ov = new ImageData(W, H), od = ov.data;
        for (let i = 0; i < W * H; i++) {
          if (!near[i]) continue;
          const o4 = i * 4;
          if (tops[i] > built[i]) {
            od[o4] = fin[o4]; od[o4 + 1] = fin[o4 + 1]; od[o4 + 2] = fin[o4 + 2]; od[o4 + 3] = 255;
          } else if (built[i] > 0) {
            const x = i % W, y = (i / W) | 0;
            const shade = shadowK * 0.75 * (1 - roofSun(x, y, built[i]));
            if (shade > 0.01) { od[o4 + 3] = Math.round(shade * 255); }
          }
        }
        const oc = newCanvas();
        oc.width = W; oc.height = H;
        oc.getContext("2d")!.putImageData(ov, 0, 0);
        // The buildings mostly hidden by leaves (over half the roof): their outline shows through
        const roofPx = new Uint32Array(roofIds.length + 1), leafPx = new Uint32Array(roofIds.length + 1);
        for (let i = 0; i < W * H; i++) {
          const o = roofOwner[i];
          if (!o) continue;
          roofPx[o]++;
          if (tops[i] > built[i]) leafPx[o]++;
        }
        const hidden = new Set(roofIds.filter((_, j) => roofPx[j + 1] > 0 && leafPx[j + 1] > roofPx[j + 1] * 0.5));
        overGrids.set(canvas, { picture: oc, hidden });
      }
    }
    // Where it painted woods, for 3D trees standing on the painting (an unturned view only)
    if (!view.rotation) woodedGrids.set(canvas, { cols: mw, rows: mh, data: wooded, x0: view.cx - W / 2 / k, y0: view.cy - H / 2 / k, ftPerCell: cell / k, cover });
    return canvas;
  }
  const first = yield* finish(s, null);
  // (kept: a new style made from it takes the last one's pixels in hand, given back when it's done,
  // so one stopped part way leaves none to be taken up wrong)
  if (opts.keep) kept = { key: keptKey(doc, view, stats, opts), canopy: opts.canopy, terrain: doc.terrainHeights, rerun: function* (s2) { const prev = last; last = null; return yield* finish(s2, prev); } };
  return first;
}

type Relief = NonNullable<ReturnType<typeof reliefGridSteps> extends Generator<unknown, infer R, unknown> ? R : never>;

/** Contours: the bolder lines' heights, written along them (their tops uphill, never upside
 * down), a few to each line, on open ground. */
const contourLabels = (ctx: CanvasRenderingContext2D, relief: Relief, W: number, H: number, pt: number, iv: number, seaFt: number, units: CourseDoc["units"], trees: Float32Array, scale: number) => {
  const major = iv * 5, size = 7.5 * pt * scale, sp = 6 * pt, gap = 170 * pt;
  const placed: { x: number; y: number }[] = [];
  const perLevel = new Map<number, number>();
  ctx.save();
  ctx.font = `600 ${size}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const rnd = seeded(91);
  for (let y = size * 2; y < H - size * 2; y += sp) for (let x = size * 3; x < W - size * 3; x += sp) {
    const t = relief.at(x + (rnd() - 0.5) * sp, y + (rnd() - 0.5) * sp, true, true);
    if (t.rise < 0.06 || t.rise > 0.9 || t.inside < 0.99) continue;
    const abs = seaFt + t.elev, n0 = Math.round(abs / major), off = abs - n0 * major;
    const g2 = t.sx * t.sx + t.sy * t.sy;
    // (onto the line: a step against the slope)
    const lx = x - (off * t.sx) / g2, ly = y - (off * t.sy) / g2;
    if (Math.abs(off) / Math.sqrt(g2) > sp || lx < size * 3 || ly < size * 2 || lx > W - size * 3 || ly > H - size * 2) continue;
    if (trees[(ly | 0) * W + (lx | 0)] > 0 || (perLevel.get(n0) ?? 0) >= 4) continue;
    if (placed.some(p => (p.x - lx) ** 2 + (p.y - ly) ** 2 < gap * gap)) continue;
    placed.push({ x: lx, y: ly });
    perLevel.set(n0, (perLevel.get(n0) ?? 0) + 1);
    const gl = Math.sqrt(g2);
    let ang = Math.atan2(t.sx / gl, -t.sy / gl);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    const label = Math.round(toUnits(n0 * major, units)).toLocaleString();
    ctx.save();
    ctx.translate(lx, ly); ctx.rotate(ang);
    ctx.lineWidth = 3 * pt; ctx.strokeStyle = "rgba(240,234,210,.92)"; ctx.strokeText(label, 0, 0);
    ctx.fillStyle = "#2a2a1e"; ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
};

/**
 * Anti-aliasing, FXAA's way (T. Lottes): every step between tones or at an outline blends over
 * about a pixel. Only where `eligible` says, and only where the contrast is a real edge's, so
 * fine textures stay crisp.
 */
export const smoothEdges = (o: Uint8ClampedArray, W: number, H: number, eligible: (i: number) => boolean) => {
  for (const _ of smoothEdgeSteps(o, W, H, eligible)) { /* all at once */ }
};
function* smoothEdgeSteps(o: Uint8ClampedArray, W: number, H: number, eligible: (i: number) => boolean) {
  const src = new Uint8ClampedArray(o);
  const luma = (i: number) => src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114;
  // (a bilinear read of the source, as r, g, b)
  const out = [0, 0, 0];
  const read = (x: number, y: number, k: number, acc: number[]) => {
    x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 4;
    for (let c = 0; c < 3; c++) {
      const top = src[i + c] * (1 - fx) + src[i + 4 + c] * fx, bot = src[i + W * 4 + c] * (1 - fx) + src[i + W * 4 + 4 + c] * fx;
      acc[c] += (top * (1 - fy) + bot * fy) * k;
    }
  };
  const A = [0, 0, 0], B = [0, 0, 0];
  for (let y = 1; y < H - 1; y++) {
    if ((y & 31) === 0) yield;
    for (let x = 1, i = y * W + 1; x < W - 1; x++, i++) {
      if (!eligible(i)) continue;
      const lM = luma(i), lNW = luma(i - W - 1), lNE = luma(i - W + 1), lSW = luma(i + W - 1), lSE = luma(i + W + 1);
      const lMin = Math.min(lM, lNW, lNE, lSW, lSE), lMax = Math.max(lM, lNW, lNE, lSW, lSE);
      if (lMax - lMin < Math.max(8, lMax * 0.1)) continue;
      let dx = -(lNW + lNE - (lSW + lSE)), dy = lNW + lSW - (lNE + lSE);
      const reduce = Math.max((lNW + lNE + lSW + lSE) * 0.25 * (1 / 8), 1 / 128);
      const rcp = 1 / (Math.min(Math.abs(dx), Math.abs(dy)) + reduce);
      dx = Math.max(-8, Math.min(8, dx * rcp)); dy = Math.max(-8, Math.min(8, dy * rcp));
      A[0] = A[1] = A[2] = 0; B[0] = B[1] = B[2] = 0;
      read(x + dx * (1 / 3 - 0.5), y + dy * (1 / 3 - 0.5), 0.5, A);
      read(x + dx * (2 / 3 - 0.5), y + dy * (2 / 3 - 0.5), 0.5, A);
      read(x - dx * 0.5, y - dy * 0.5, 0.25, B);
      read(x + dx * 0.5, y + dy * 0.5, 0.25, B);
      for (let c = 0; c < 3; c++) B[c] += A[c] * 0.5;
      const lB = B[0] * 0.299 + B[1] * 0.587 + B[2] * 0.114;
      const pick = lB < lMin || lB > lMax ? A : B;
      out[0] = pick[0]; out[1] = pick[1]; out[2] = pick[2];
      o[i * 4] = out[0]; o[i * 4 + 1] = out[1]; o[i * 4 + 2] = out[2];
    }
  }
};

type MaskStore = { key: string; reads: Map<string, Uint8ClampedArray>; shore?: Float32Array; openWater?: Float32Array };
/** The last paintings' masks, by course and frame. */
const maskStores = new Map<string, MaskStore>();

/** Where a painting shows woods, cell by cell (1: woods it painted itself; 2: drawn woods), and how thick. */
export type WoodedGrid = { cols: number; rows: number; data: Uint8Array; x0: number; y0: number; ftPerCell: number; cover: number };
const woodedGrids = new WeakMap<HTMLCanvasElement, WoodedGrid>();
/** The tone a pine's needles are painted in (the trees' own tones are 1 to 6). */
const PINE = 7;
const overGrids = new WeakMap<HTMLCanvasElement, { picture: HTMLCanvasElement; hidden: Set<string> }>();
/** The treetops over the buildings on a painting (and their shade on the roofs), a picture as big
 * as the painting, clear elsewhere, and the buildings mostly under leaves; none when no building
 * stands on it. */
export const treesOverOf = (canvas: HTMLCanvasElement) => overGrids.get(canvas) ?? null;
/** Whether a painting of the course paints woods from the photo (it needs the photo's tree cover):
 * with measured trees, only when asked for besides them. */
export const paintsFromPhoto = (doc: Pick<CourseDoc, "style" | "lidar">) => (doc.lidar?.trees.length ? doc.style.forestMeasured === "photo" : doc.style.forest === "photo");
/** The woods on a painting made by `forestCanvas` or `forestCanvasAsync`. */
export const woodedOf = (canvas: HTMLCanvasElement) => woodedGrids.get(canvas) ?? null;

/** The painted land, all at once (for prints and exports). */
export const forestCanvas = (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts) => {
  const steps = forestSteps(doc, view, stats, opts);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
};

/**
 * The painted land a slice at a time between frames (about 8 ms each), so the page stays smooth
 * while it paints, even on a phone. Stops (rejects) when `signal` is aborted.
 */
/** Everything of the course the painting is made from (for knowing when to paint it again):
 * every thing on the map in full but its name and lock (labels and mandos aren't painted), the
 * course's kinds of trees, and the holes, in order, but their names, par, notes, flyovers and tee sign settings. */
export const paintedFrom = (doc: CourseDoc) => [
  doc.lidar?.trees.length ? measuredStanding()?.key ?? "" : "",
  // (the course's kinds of trees: the treetops')
  doc.style.treeKinds ?? null,
  doc.items.filter(i => i.type !== "label" && i.type !== "mando").map(i => ({ ...i, label: undefined, locked: undefined })),
  doc.holes.map(h => ({ ...h, name: undefined, par: undefined, notes: undefined, flyKeys: undefined, flyover: undefined, sign: undefined }))
];

export const forestCanvasAsync = async (doc: CourseDoc, view: ForestView, stats: HoleStats[], opts: ForestOpts, signal?: AbortSignal, onProgress?: (fraction: number) => void, pace?: () => Promise<number>) => {
  const steps = forestSteps(doc, view, stats, { parallel: true, ...opts });
  // (a slice at a time, 8 ms of painting between frames; or as `pace` says: it waits for its moment
  // and says how long the next slice may run; and what the steps wait for, waited for, the page
  // free meanwhile: Hand painted's trees, painted by workers)
  let start = performance.now(), told = -1, budget = 8, back: unknown;
  // (stopped, or failed, part way: the steps closed, so what they hold is let go, the graphics
  // chip's trees among it)
  let done = false;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Painting stopped", "AbortError");
      const r = timed("a step of painting the ground", () => steps.next(back));
      back = undefined;
      if (r.done) { done = true; return r.value; }
      if (r.value && typeof r.value === "object" && "wait" in r.value) { back = await r.value.wait; start = performance.now(); continue; }
      if (onProgress && typeof r.value === "number" && r.value - told >= 0.01) onProgress((told = r.value));
      if (performance.now() - start > budget) {
        if (pace) budget = await pace();
        else await new Promise<void>(res => setTimeout(res, 0));
        start = performance.now();
      }
    }
  } finally {
    if (!done) try { steps.return(undefined as never); } catch { /* already stopped */ }
  }
};

/**
 * A palette of tones from a base color: its lightness scaled by each factor (hue kept, a little
 * less saturated at the ends), the top tones warmed by `warm` degrees of hue toward yellow.
 */
const palette = (base: string, factors: number[], warm: number, satK = 1): RGB[] => {
  const [h, sl, l] = rgbToHsl(hexRgb(base));
  return factors.map((f, i) => {
    const t = factors.length > 1 ? i / (factors.length - 1) : 0;
    const ll = Math.max(0.02, Math.min(0.95, l * f));
    const ss = sl * satK * (1 - 0.25 * Math.abs(t - 0.5) * 2);
    return hslToRgb(h - warm * Math.max(0, t - 0.5) * 2, ss, ll);
  });
};

const rgbToHsl = ([r0, g0, b0]: RGB): [number, number, number] => {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, sat, l];
};

const hslToRgb = (h: number, sat: number, l: number): RGB => {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (sat === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p2 = 2 * l - q;
  const f = (t: number) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return (t < 1 / 6 ? p2 + (q - p2) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p2 + (q - p2) * (2 / 3 - t) * 6 : p2) * 255;
  };
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
};

// The terrain as a plain grid (looking heights up by "x,y" keys is slow for every pixel)
const terrainGrids = new WeakMap<object, { cols: number; rows: number; grid: number; data: Float32Array }>();
const terrainGrid = (doc: CourseDoc) => {
  const hit = terrainGrids.get(doc.terrainHeights);
  if (hit) return hit;
  const grid = doc.gridSize || 20;
  // As big as the measured points reach (no empty rows past them, which would read as a cliff)
  const cells: [number, number, number][] = [];
  let cols = 1, rows = 1;
  for (const [key, v] of Object.entries(doc.terrainHeights)) {
    const comma = key.indexOf(",");
    const c = Math.round(Number(key.slice(0, comma)) / grid), r = Math.round(Number(key.slice(comma + 1)) / grid);
    if (c < 0 || r < 0) continue;
    cells.push([c, r, v]);
    cols = Math.max(cols, c + 1);
    rows = Math.max(rows, r + 1);
  }
  cols = Math.max(2, cols);
  rows = Math.max(2, rows);
  const data = new Float32Array(cols * rows), known = new Uint8Array(cols * rows);
  for (const [c, r, v] of cells) { data[r * cols + c] = v; known[r * cols + c] = 1; }
  // (a point never measured inside it: its measured neighbours' height, spreading in from them,
  // never a pit at 0)
  for (let gap = cells.length < cols * rows, pass = 0; gap && pass < 64; pass++) {
    gap = false;
    const was = known.slice();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const j = r * cols + c;
      if (was[j]) continue;
      let sum = 0, n = 0;
      if (c > 0 && was[j - 1]) { sum += data[j - 1]; n++; }
      if (c < cols - 1 && was[j + 1]) { sum += data[j + 1]; n++; }
      if (r > 0 && was[j - cols]) { sum += data[j - cols]; n++; }
      if (r < rows - 1 && was[j + cols]) { sum += data[j + cols]; n++; }
      if (n) { data[j] = sum / n; known[j] = 1; } else gap = true;
    }
  }
  const value = { cols, rows, grid, data };
  terrainGrids.set(doc.terrainHeights, value);
  return value;
};

/**
 * Every tree read as its own in dense woods, never a merged mass: a crown pressed into others
 * (more than a tenth of their reach overlapping) is drawn at 0.88 of its reach, so a sliver of
 * shade shows between it and the next, as plan drawings and painted maps show trees; and each
 * crown a touch lighter or darker than the next (within 8%), so woods don't read as an orchard.
 */
const roomBetween = (trees: PaintTree[]) => {
  const CELL = 64, grid = new Map<string, PaintTree[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  for (const t of trees) { const k = key(t.x, t.y); (grid.get(k) ?? grid.set(k, []).get(k)!).push(t); }
  const pressed = trees.map(t => {
    const reach = Math.ceil((t.r * 2) / CELL), cx = Math.floor(t.x / CELL), cy = Math.floor(t.y / CELL);
    for (let gy = cy - reach; gy <= cy + reach; gy++) for (let gx = cx - reach; gx <= cx + reach; gx++)
      for (const o of grid.get(`${gx},${gy}`) ?? []) if (o !== t && Math.hypot(t.x - o.x, t.y - o.y) < (t.r + o.r) * 0.9) return true;
    return false;
  });
  trees.forEach((t, i) => {
    // (only the woods' own trees make room: one placed or measured keeps its size)
    if (pressed[i] && t.fill) t.r *= 0.88;
    const v = 0.92 + 0.16 * ((Math.sin(t.seed * 9301.7) * 43758.5453) % 1 + 1) % 1;
    t.col = [t.col[0] * v, t.col[1] * v, t.col[2] * v];
  });
};

/** Hill shading for the painting, as a function of the pixel (null when the ground is flat). */
/** A tidy contour interval for a site's relief: about a dozen lines from lowest to highest. */
export const contourInterval = (range: number) => {
  const raw = range / 12;
  for (const iv of [1, 2, 5, 10, 20, 25, 50, 100, 200]) if (iv >= raw) return iv;
  return 500;
};

/**
 * What the light does over the ground itself, worked out on the terrain's own grid (coarser on a
 * big site): how much of it is in the shadow of higher ground toward the sun (a canyon wall's
 * shadow across the floor, soft at its edge), how much of the sky it sees (low in a canyon or a
 * hollow: the floor and the foot of the walls darker, so depth reads without the sun), and how
 * steep it is (cliffs and steep banks drawn as bare rock). Plan direction `dir` points at the sun.
 */
const terrainLights = new WeakMap<object, { key: string; v: { cols: number; rows: number; grid: number; cast: Float32Array; sky: Float32Array; rock: Float32Array; wall: Float32Array; cv: Float32Array } }>();
// (a few rows at a time, between frames: the whole site at once was most of a second on a phone)
function* terrainLight(doc: CourseDoc, dir: P, tanEl: number, hills: number) {
  const key = `${dir.x.toFixed(3)},${dir.y.toFixed(3)},${tanEl.toFixed(3)},${hills}`;
  const hit = terrainLights.get(doc.terrainHeights);
  if (hit && hit.key === key) return hit.v;
  const tg = terrainGrid(doc);
  const stride = Math.max(1, Math.ceil(Math.sqrt((tg.cols * tg.rows) / 40000)));
  const cols = Math.ceil(tg.cols / stride), rows = Math.ceil(tg.rows / stride), G = tg.grid * stride;
  const z = (x: number, y: number) => {
    const fx = Math.max(0, Math.min(tg.cols - 1.001, x / tg.grid)), fy = Math.max(0, Math.min(tg.rows - 1.001, y / tg.grid));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, j = iy * tg.cols + ix, d = tg.data;
    return ((d[j] * (1 - tx) + d[j + 1] * tx) * (1 - ty) + (d[j + tg.cols] * (1 - tx) + d[j + tg.cols + 1] * tx) * ty) * hills;
  };
  let top = -Infinity;
  for (let k = 0; k < tg.data.length; k++) top = Math.max(top, tg.data[k] * hills);
  const cast = new Float32Array(cols * rows), sky = new Float32Array(cols * rows), rock = new Float32Array(cols * rows);
  // (and for the inked looks: walls, steep enough to draw as a drop; and whether the ground
  // here bulges (a rim, a ridge) or dips (the foot of a wall, a gully) against the ring round it)
  const wall = new Float32Array(cols * rows), cv = new Float32Array(cols * rows);
  const elA = Math.atan(tanEl), soft = (2.5 * Math.PI) / 180;
  const far = Math.min(2000, Math.max(tg.cols, tg.rows) * tg.grid);
  const skyR = 400, dirs = Array.from({ length: 8 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 4), y: Math.sin((k * Math.PI) / 4) }));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c === 0 && (r & 7) === 7) yield;
    const x = c * G, y = r * G, h0 = z(x, y), j = r * cols + c;
    // (the highest the ground toward the sun rises above the level here, as an angle)
    let best = -1;
    for (let d = G; d <= far; d += d < 200 ? G : G * 2) {
      if ((top - h0) / d < best) break;
      best = Math.max(best, (z(x + dir.x * d, y + dir.y * d) - h0) / d);
    }
    cast[j] = smooth(elA - soft, elA + soft, Math.atan(best));
    let seen = 0;
    for (const u of dirs) {
      let b = 0;
      for (let d = G; d <= skyR; d += d < 100 ? G : G * 2) b = Math.max(b, (z(x + u.x * d, y + u.y * d) - h0) / d);
      seen += Math.sin(Math.atan(b));
    }
    sky[j] = 1 - seen / dirs.length;
    const gx = (z(x + G, y) - z(x - G, y)) / (2 * G), gy = (z(x, y + G) - z(x, y - G)) / (2 * G);
    // (a real drop only: steep ground that falls a few feet at least; a road's bank or a ditch is
    // steep for a step and draws no rock, rim or strokes)
    let ring = 0, top2 = h0, low2 = h0;
    for (const u of dirs) {
      const a2 = z(x + u.x * 2 * G, y + u.y * 2 * G), a3 = z(x + u.x * 3 * G, y + u.y * 3 * G);
      ring += a3;
      top2 = Math.max(top2, a2, a3); low2 = Math.min(low2, a2, a3);
    }
    // (on the ground's real slope and drop: Hills makes the shading stronger, it never turns a
    // wooded bank into a cliff)
    const drop = smooth(5, 12, (top2 - low2) / hills), steep = Math.hypot(gx, gy) / hills;
    rock[j] = smooth(0.62, 1.05, steep) * drop;
    wall[j] = smooth(0.45, 0.8, steep) * drop;
    cv[j] = Math.max(-1, Math.min(1, ((h0 - ring / dirs.length) / (3 * G)) * 3));
  }
  const v = { cols, rows, grid: G, cast, sky, rock, wall, cv };
  terrainLights.set(doc.terrainHeights, { key, v });
  return v;
}

/**
 * The ground's shape as the painting sees it, on a coarse grid of screen pixels (looked up
 * smoothly in between): how it is lit, its height and its slope. The relief is exaggerated just
 * enough that a gentle course's rises still show and a steep one's don't go black, and it is lit
 * from the sun and two softer lights to either side (so slopes in line with the sun still show).
 */
function* reliefGridSteps(doc: CourseDoc, on: boolean, W: number, H: number, toPlan: (x: number, y: number) => P, L: { x: number; y: number; z: number }, shadowK = 0.65) {
  const heights = doc.terrainHeights;
  if (!on || !heights || Object.keys(heights).length < 4) return null;
  const tg = terrainGrid(doc);
  const step = 8;
  const gw = Math.ceil(W / step) + 2, gh = Math.ceil(H / step) + 2;
  const elev = new Float32Array(gw * gh), sx = new Float32Array(gw * gh), sy = new Float32Array(gw * gh), shade = new Float32Array(gw * gh);
  const castS = new Float32Array(gw * gh), skyS = new Float32Array(gw * gh), rockS = new Float32Array(gw * gh);
  const ambS = new Float32Array(gw * gh), wallS = new Float32Array(gw * gh), cvS = new Float32Array(gw * gh), wgx = new Float32Array(gw * gh), wgy = new Float32Array(gw * gh);
  const ins = new Float32Array(gw * gh);
  const e = Math.max(2, doc.gridSize / 2);
  // Past the measured ground nothing is known of its shape: the edge's heights carry on (no cliff
  // at the site's edge), and its slopes, light and lines ease away to level ground over a little
  // way (carried on unchanged they drew the edge out across the page in stripes)
  const endX = (tg.cols - 1) * tg.grid, endY = (tg.rows - 1) * tg.grid, ease = Math.max(150, tg.grid * 8);
  const inside = (p: P) => 1 - smooth(0, ease, Math.hypot(Math.max(0, -p.x, p.x - endX), Math.max(0, -p.y, p.y - endY)));
  const at = (p: P) => {
    const fx = Math.max(0, Math.min(tg.cols - 1.001, p.x / tg.grid)), fy = Math.max(0, Math.min(tg.rows - 1.001, p.y / tg.grid));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, j = iy * tg.cols + ix, d = tg.data;
    return (d[j] * (1 - tx) + d[j + 1] * tx) * (1 - ty) + (d[j + tg.cols] * (1 - tx) + d[j + tg.cols + 1] * tx) * ty;
  };
  let lo = Infinity, hi = -Infinity, ftPerPx = 1;
  const slopes: number[] = [];
  for (let gy = 0; gy < gh; gy++) {
    if ((gy & 15) === 0) yield;
    for (let gx = 0; gx < gw; gx++) {
      const p = toPlan(gx * step, gy * step);
      // Screen right and down, in plan feet
      const px = toPlan(gx * step + 1, gy * step), py = toPlan(gx * step, gy * step + 1);
      const rx = { x: px.x - p.x, y: px.y - p.y }, ry = { x: py.x - p.x, y: py.y - p.y };
      const rl = Math.hypot(rx.x, rx.y) || 1;
      ftPerPx = rl;
      const ux = { x: rx.x / rl, y: rx.y / rl }, uy = { x: ry.x / rl, y: ry.y / rl };
      const j = gy * gw + gx;
      const h = at(p);
      elev[j] = h;
      // (the slope where the measured ground is: at or past its edge, the edge's own, so the light
      // carries on across it with no seam, then eases away)
      const q = { x: Math.max(e, Math.min(endX - e, p.x)), y: Math.max(e, Math.min(endY - e, p.y)) };
      sx[j] = (at({ x: q.x + ux.x * e, y: q.y + ux.y * e }) - at({ x: q.x - ux.x * e, y: q.y - ux.y * e })) / (2 * e);
      sy[j] = (at({ x: q.x + uy.x * e, y: q.y + uy.y * e }) - at({ x: q.x - uy.x * e, y: q.y - uy.y * e })) / (2 * e);
      const w = (ins[j] = inside(p));
      sx[j] *= w; sy[j] *= w;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      // (how steep the course is: its measured ground's)
      if ((gx & 3) === 0 && (gy & 3) === 0 && w > 0.99) slopes.push(Math.hypot(sx[j], sy[j]));
    }
  }
  slopes.sort((a, b) => a - b);
  const p90 = slopes[Math.floor(slopes.length * 0.9)] ?? 0;
  const hills = doc.style.reliefScale ?? 1;
  if (hi - lo < 0.5 || p90 < 0.002 || hills <= 0) return null;
  // The ground's own shadows, how much sky it sees and its rock, looked up for each cell (the sun
  // turned from the page into plan feet)
  const c0 = toPlan(W / 2, H / 2), cr0 = toPlan(W / 2 + 1, H / 2), cd0 = toPlan(W / 2, H / 2 + 1);
  const ldx = L.x * (cr0.x - c0.x) + L.y * (cd0.x - c0.x), ldy = L.x * (cr0.y - c0.y) + L.y * (cd0.y - c0.y), ldl = Math.hypot(ldx, ldy) || 1;
  yield;
  const tl = yield* terrainLight(doc, { x: ldx / ldl, y: ldy / ldl }, L.z / Math.max(0.05, Math.hypot(L.x, L.y)), hills);
  yield;
  const fromTl = (f: Float32Array, p: P) => {
    const fx = Math.max(0, Math.min(tl.cols - 1.001, p.x / tl.grid)), fy = Math.max(0, Math.min(tl.rows - 1.001, p.y / tl.grid));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, j = iy * tl.cols + ix;
    return (f[j] * (1 - tx) + f[j + 1] * tx) * (1 - ty) + (f[j + tl.cols] * (1 - tx) + f[j + tl.cols + 1] * tx) * ty;
  };
  for (let gy = 0; gy < gh; gy++) {
    if ((gy & 31) === 0) yield;
    for (let gx = 0; gx < gw; gx++) {
    const p = toPlan(gx * step, gy * step), j = gy * gw + gx;
    const w = ins[j];
    castS[j] = fromTl(tl.cast, p) * w; skyS[j] = 1 - (1 - fromTl(tl.sky, p)) * w; rockS[j] = fromTl(tl.rock, p) * w;
    wallS[j] = fromTl(tl.wall, p) * w; cvS[j] = fromTl(tl.cv, p) * w;
    }
  }
  // (how fast the walls start, per screen pixel: to draw their rim a set width)
  for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) {
    const j = gy * gw + gx;
    wgx[j] = (wallS[j + 1] - wallS[j - 1]) / (2 * step); wgy[j] = (wallS[j + gw] - wallS[j - gw]) / (2 * step);
  }
  // Steep enough to read: the steeper slopes shown at about 20 degrees, whatever the course (and
  // as much more or less as the Hills setting asks)
  const exag = reliefExaggeration(p90) * hills;
  const lxy = Math.hypot(L.x, L.y) || 1;
  const lights = [0, 50, -50].map((deg, k) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
    return { x: ((L.x * c - L.y * s2) / lxy) * Math.sqrt(1 - L.z * L.z), y: ((L.x * s2 + L.y * c) / lxy) * Math.sqrt(1 - L.z * L.z), z: L.z, w: k ? 0.2 : 0.6 };
  });
  for (let j = 0; j < elev.length; j++) {
    const dzx = sx[j] * exag, dzy = sy[j] * exag, len = Math.hypot(dzx, dzy, 1);
    let s = 0;
    for (const l of lights) s += l.w * Math.max(0, (-dzx * l.x - dzy * l.y + l.z) / len) / l.z;
    // (then the shadow of higher ground, and less light where the ground sees less sky)
    const lit = Math.max(0.5, Math.min(1.4, 1 + (s - 1) * 0.9));
    const inShadow = 1 - (0.3 + 0.35 * shadowK) * castS[j];
    // (only ground shut in on several sides, a canyon floor or a deep hollow: a hillside or a
    // rolling park sees nearly all its sky and stays as bright as it was)
    const open = 1 - Math.min(0.4, Math.max(0, 0.9 - skyS[j]) * 1.6);
    shade[j] = Math.max(0.3, lit * inShadow * open);
    ambS[j] = inShadow * open;
  }
  let k00 = 0, k10 = 0, k01 = 0, k11 = 0;
  const cell = (x: number, y: number) => {
    const fx = x / step, fy = y / step;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, j = iy * gw + ix;
    k00 = (1 - tx) * (1 - ty); k10 = tx * (1 - ty); k01 = (1 - tx) * ty; k11 = tx * ty;
    return j;
  };
  const look = (f: Float32Array, j: number) => f[j] * k00 + f[j + 1] * k10 + f[j + gw] * k01 + f[j + gw + 1] * k11;
  const here = { shade: 1, elev: 0, sx: 0, sy: 0, rock: 0, amb: 1, wall: 0, wgx: 0, wgy: 0, cv: 0, rise: 0, inside: 1 };
  return {
    /** Everything at a pixel at once (one lookup of its cell): light, height, slope (per pixel). */
    at: (x: number, y: number, withSlope: boolean, inked = false) => {
      const j = cell(x, y);
      here.shade = look(shade, j); here.elev = look(elev, j); here.rock = look(rockS, j); here.inside = look(ins, j);
      if (withSlope || inked) { here.sx = look(sx, j) * ftPerPx; here.sy = look(sy, j) * ftPerPx; }
      if (inked) {
        here.amb = look(ambS, j); here.wall = look(wallS, j); here.wgx = look(wgx, j); here.wgy = look(wgy, j); here.cv = look(cvS, j);
        here.rise = Math.hypot(here.sx, here.sy) / ftPerPx;
      }
      return here;
    },
    lo,
    hi,
    /** Light on the ground here (1 = level ground; more on slopes facing the sun). */
    shade: (x: number, y: number) => look(shade, cell(x, y)),
    /** Height, ft. */
    elev: (x: number, y: number) => look(elev, cell(x, y)),
    /** Rise per screen pixel, right and down (ft). */
    slope: (x: number, y: number): [number, number] => {
      const j = cell(x, y);
      return [look(sx, j) * ftPerPx, look(sy, j) * ftPerPx];
    }
  };
};
