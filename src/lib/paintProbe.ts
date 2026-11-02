// For the tests: how much a change of style changes a stretch of the illustrated map (the mean
// difference of its pixels, 0 to 255, the treetops over the buildings laid on), so a test can tell
// a setting that does nothing in some look from one that works in all of them.
import { bandsLaidIn, canopyFor, forestCanvas, forestCanvasAsync, forgetKept, treesOverOf, type ForestView } from "./forest";
import { courseStats } from "./holeStats";
import { coursePoints, renderPoster } from "./mapSvg";
import { rotatePoint } from "./geom";
import type { CourseDoc, MapStyle } from "../types";
import { BEST_GUESS, UG_BLOCK, brushAcres, brushAreas, brushLevels, tapPatch, underbrushChance } from "./undergrowth";
import { treeFree } from "./treeFree";
import { pointInPolygon, distanceToPath } from "./geom";
import { applyEdit, brushStroke } from "./areaBrush";
import { strokeOutline } from "./brush";

// (the last few, so a style compared with many others is painted once)
const kept = new Map<string, Uint8ClampedArray>();
const pixels = async (doc: CourseDoc, view: ForestView) => {
  const key = JSON.stringify([doc.style, view, doc.items.length]);
  const had = kept.get(key);
  // (used again: kept longest)
  if (had) { kept.delete(key); kept.set(key, had); return had; }
  const data = await paint(doc, view);
  kept.set(key, data);
  if (kept.size > 4) kept.delete(kept.keys().next().value!);
  return data;
};
const paint = async (doc: CourseDoc, view: ForestView) => {
  const canopy = await canopyFor(doc).catch(() => null);
  const c = forestCanvas(doc, view, courseStats(doc), { mode: doc.style.forest ?? "everywhere", canopy, style: doc.style, density: 1 });
  const out = document.createElement("canvas");
  out.width = c.width;
  out.height = c.height;
  const g = out.getContext("2d")!;
  g.drawImage(c, 0, 0);
  const over = treesOverOf(c);
  if (over) g.drawImage(over.picture, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, out.width, out.height).data;
};

if (typeof window !== "undefined") {
  (window as unknown as { __dgMapDiff: unknown }).__dgMapDiff = async (doc: CourseDoc, a: MapStyle, b: MapStyle, view: ForestView) => {
    const pa = await pixels({ ...doc, style: a }, view), pb = await pixels({ ...doc, style: b }, view);
    let sum = 0;
    for (let i = 0; i < pa.length; i += 4) sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
    return sum / (pa.length / 4) / 3;
  };
}

// For the tests: how the course map's page frames the course. Of the page, the share past the
// site's measured ground (0 to 1); how near the page's edge the nearest tee, basket or amenity
// comes (points); and the page's pieces (title, legend, QR code...) any of them is under.
if (typeof window !== "undefined") {
  (window as unknown as { __dgPosterFit: unknown }).__dgPosterFit = (doc: CourseDoc) => {
    const p = renderPoster(doc, { contours: null, hillshade: null });
    const k = Number(/data-el="map" data-box="[^"]*" data-k="([^"]*)"/.exec(p.svg)?.[1]);
    const rot = doc.style.rotation || 0, stats = courseStats(doc), hl = p.holeLines[0];
    const st = stats.find(s => s.holeId === hl?.holeId);
    if (!k || !hl || !st) return null;
    // (the map's middle, from where the first hole's tee landed on the page)
    const v = rotatePoint({ x: (hl.pts[0].x - p.width / 2) / k, y: (hl.pts[0].y - p.height / 2) / k }, rot);
    const c = { x: st.line[0].x - v.x, y: st.line[0].y - v.y };
    const onPage = (q: { x: number; y: number }) => { const r = rotatePoint({ x: q.x - c.x, y: q.y - c.y }, -rot); return { x: p.width / 2 + r.x * k, y: p.height / 2 + r.y * k }; };
    let off = 0, all = 0;
    for (let i = 0; i < 80; i++) for (let j = 0; j < 60; j++) {
      const q = rotatePoint({ x: ((i + 0.5) / 80 - 0.5) * p.width / k, y: ((j + 0.5) / 60 - 0.5) * p.height / k }, rot);
      const x = c.x + q.x, y = c.y + q.y;
      all++;
      if (x < 0 || y < 0 || x > doc.canvas.width || y > doc.canvas.height) off++;
    }
    const pieces = [...p.svg.matchAll(/data-el="([^"]+)" data-box="([^"]+)"/g)].filter(m => m[1] !== "map" && !/^(label|num):/.test(m[1])).map(m => ({ id: m[1], b: m[2].split(" ").map(Number) }));
    const under = new Set<string>();
    let nearest = Infinity;
    for (const q of coursePoints(doc, stats)) {
      const s = onPage(q);
      nearest = Math.min(nearest, s.x, s.y, p.width - s.x, p.height - s.y);
      for (const { id, b } of pieces) if (s.x >= b[0] && s.x <= b[0] + b[2] && s.y >= b[1] && s.y <= b[1] + b[3]) under.add(id);
    }
    return { offSite: off / all, nearest, under: [...under] };
  };
}

// For the tests: a change of style painted from the last painting kept, and as a whole new
// painting; how many pixels differ (none, or it isn't the same painting), and how long each took.
if (typeof window !== "undefined") {
  (window as unknown as { __dgPaintAgain: unknown }).__dgPaintAgain = async (doc: CourseDoc, a: MapStyle, b: MapStyle, view: ForestView) => {
    const canopy = await canopyFor(doc).catch(() => null), stats = courseStats(doc);
    const opts = (style: MapStyle, keep: boolean) => ({ mode: style.forest ?? "everywhere", canopy, style, density: 1, keep });
    const picture = (c: HTMLCanvasElement) => {
      const out = document.createElement("canvas");
      out.width = c.width; out.height = c.height;
      const g = out.getContext("2d")!;
      g.drawImage(c, 0, 0);
      const over = treesOverOf(c);
      if (over) g.drawImage(over.picture, 0, 0, c.width, c.height);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    forgetKept();
    forestCanvas({ ...doc, style: a }, view, stats, opts(a, true));
    let t = performance.now();
    const fast = picture(forestCanvas({ ...doc, style: b }, view, stats, opts(b, false)));
    const fastMs = performance.now() - t;
    forgetKept();
    t = performance.now();
    const whole = picture(forestCanvas({ ...doc, style: b }, view, stats, opts(b, false)));
    const wholeMs = performance.now() - t;
    let differ = 0;
    for (let i = 0; i < fast.length; i += 4) if (fast[i] !== whole[i] || fast[i + 1] !== whole[i + 1] || fast[i + 2] !== whole[i + 2]) differ++;
    return { differ, fastMs: Math.round(fastMs), wholeMs: Math.round(wholeMs) };
  };
}

// For the tests: a painting with its pixel pass shared out among workers, and the same painted on
// the page alone; how many pixels differ (none), whether workers painted it, and how long each took.
if (typeof window !== "undefined") {
  (window as unknown as { __dgPaintBands: unknown }).__dgPaintBands = async (doc: CourseDoc, view: ForestView) => {
    const canopy = await canopyFor(doc).catch(() => null), stats = courseStats(doc), s = doc.style;
    const opts = { mode: s.forest ?? "everywhere", canopy, style: s, density: 1 };
    forgetKept();
    const before = bandsLaidIn();
    let t = performance.now();
    const banded = await forestCanvasAsync(doc, view, stats, { ...opts, parallel: true }, undefined, undefined, async () => 1e9);
    const bandMs = performance.now() - t;
    const used = bandsLaidIn() > before;
    forgetKept();
    t = performance.now();
    const page = forestCanvas(doc, view, stats, opts);
    const pageMs = performance.now() - t;
    const a = banded.getContext("2d")!.getImageData(0, 0, banded.width, banded.height).data, b = page.getContext("2d")!.getImageData(0, 0, page.width, page.height).data;
    let differ = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differ++;
    return { differ, used, bandMs: Math.round(bandMs), pageMs: Math.round(pageMs) };
  };
}

// For the tests: two paintings at once (Hand painted's trees on the graphics chip, where there is
// one), and one stopped part way, against each painted alone: the share of pixels that differ.
if (typeof window !== "undefined") {
  (window as unknown as { __dgPaintTogether: unknown }).__dgPaintTogether = async (doc: CourseDoc, a: ForestView, b: ForestView) => {
    const canopy = await canopyFor(doc).catch(() => null), stats = courseStats(doc), s = doc.style;
    const opts = { mode: s.forest ?? "everywhere", canopy, style: s, density: 1, parallel: false };
    const px = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const share = (p: Uint8ClampedArray, q: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 6) n++;
      return n / (p.length / 4);
    };
    forgetKept();
    const soloA = px(await forestCanvasAsync(doc, a, stats, opts)), soloB = px(await forestCanvasAsync(doc, b, stats, opts));
    const [ca, cb] = await Promise.all([forestCanvasAsync(doc, a, stats, opts), forestCanvasAsync(doc, b, stats, opts)]);
    const stop = new AbortController();
    const stopped = forestCanvasAsync(doc, a, stats, opts, stop.signal).catch(() => null);
    setTimeout(() => stop.abort(), 400);
    await stopped;
    const after = px(await forestCanvasAsync(doc, b, stats, opts));
    return { a: share(px(ca), soloA), b: share(px(cb), soloB), afterStopped: share(after, soloB) };
  };
}

// For the tests: the brush on a course, from a satellite that sees it greener from west to east (so
// there's brush all over the east, wherever it may go): how many acres at each step of How much
// and How thick, whether any block of it is on a building, road, path, parking or water, or any
// brush area over a building, parking lot or road, and what taps on a patch do to it.
if (typeof window !== "undefined") {
  (window as unknown as { __dgBrush: unknown }).__dgBrush = (doc: CourseDoc) => {
    const W = doc.canvas.width, H = doc.canvas.height, w = 48, h = 48;
    // (greener from west to east: the brush surer the further east)
    const green = (v: number) => Float32Array.from({ length: w * h }, (_, q) => v + ((q % w) / w) * 0.5);
    const seasons = { w, h, winter: green(0.1), spring: green(0.25), summer: green(0.35), dates: ["2025-01-10", "2025-07-10"] };
    const items = doc.items;
    const water = {
      areas: items.filter(i => i.type === "area" && i.kind === "water").map(i => (i as { points: { x: number; y: number }[] }).points),
      lines: items.filter(i => i.type === "line" && i.kind === "stream").map(i => (i as { points: { x: number; y: number }[] }).points)
    };
    const never = treeFree(items);
    const u = underbrushChance(W, H, null, seasons, water, never);
    if (!u) return null;
    const acres = (t: typeof BEST_GUESS) => { const a = brushAcres(brushLevels(u, t)); return a[1] + a[2] + a[3]; };
    const heavy = (t: typeof BEST_GUESS) => brushAcres(brushLevels(u, t))[3];
    const lv = brushLevels(u, BEST_GUESS);
    // (blocks of brush with their middle on somewhere it never goes)
    let onNever = 0;
    for (let q = 0; q < lv.length; q++) {
      if (!lv[q]) continue;
      const i = q % u.bx, j = (q - i) / u.bx;
      if (never({ x: (i + 0.5) * UG_BLOCK, y: (j + 0.5) * UG_BLOCK })) onNever++;
    }
    // (brush areas over the middle of a building or a parking lot, or over a road's middle line)
    const areas = brushAreas(lv, u.bx, u.by);
    const covered = (p: { x: number; y: number }) => areas.some(a => pointInPolygon(p, a.points));
    let overBuilt = 0;
    for (const it of items) {
      if (it.type === "area" && (it.kind === "building" || it.kind === "parking")) {
        const pts = it.points, c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 });
        if (pointInPolygon(c, pts) && covered(c)) overBuilt++;
      } else if (it.type === "line" && it.kind === "road") {
        for (let k = 1; k < it.points.length; k++) {
          const a = it.points[k - 1], b = it.points[k], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20);
          for (let s = 0; s <= n; s++) { const p = { x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n }; if (distanceToPath(p, it.points) < 1 && covered(p)) { overBuilt++; break; } }
        }
      }
    }
    // (taps on one patch: lighter a step at a time, then gone, then back as found)
    let q0 = -1, most = 0;
    for (let q = 0; q < lv.length; q++) if (lv[q] > most) { most = lv[q]; q0 = q; }
    const taps: number[] = [];
    let t = { ...BEST_GUESS };
    for (let k = 0; k < most + 1 && q0 >= 0; k++) { t = tapPatch(u, t, q0) ?? t; taps.push(brushLevels(u, t)[q0]); }
    return {
      much: [0, 1, 2, 3, 4].map(m => Math.round(acres({ much: m, thick: 0 }) * 10) / 10),
      heavy: [-1, 0, 1].map(k => Math.round(heavy({ much: 2, thick: k }) * 10) / 10),
      onNever, overBuilt, areas, startsAt: most, taps
    };
  };
}

// For the tests: the brush on areas, worked out on a course without changing it (lib/areaBrush).
if (typeof window !== "undefined") {
  (window as unknown as { __dgAreaBrush: unknown }).__dgAreaBrush = { brushStroke, applyEdit, strokeOutline };
}
