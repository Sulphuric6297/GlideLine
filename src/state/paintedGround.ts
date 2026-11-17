// The ground in the Design look for flyovers, the tee view and videos: the painted map of the
// whole site (the Forest painting, in the course's own colors), draped on the terrain in place of
// the satellite photo. Painted a slice at a time, once per version of the course.
import { measuredStanding, onStanding } from "../lib/standing";
import { useEffect, useState } from "react";
import { canopyFor, detailArea, forestCanvasAsync, paintedFrom, paintsFromPhoto, woodedOf, type WoodedGrid } from "../lib/forest";
import { courseStats, holeStats } from "../lib/holeStats";
import type { CourseDoc } from "../types";
import { useCourse } from "./course";
import { style3dOf } from "../lib/landscapes";
import { cacheDelete, cacheGet, cacheSet, idbDelete, idbGet } from "../lib/storage";
import { spareMoment } from "./pace";

/** The paintings wanted now (a tee view, a flyover, a video, a viewer's look), by key. The rest are
 * painted ahead, gently: only while the view is still and the browser has time to spare, a few
 * ms at a time, so looking round the 3D view never stalls for them. */
const wanted = new Set<string>();
const gently = (key: string, stop: AbortController) => () => {
  // (the course changed since: this painting is out of date before it's done, so it stops)
  if (!wanted.has(key) && paintKey(useCourse.getState().doc) !== key) { stop.abort(); return Promise.resolve(8); }
  return spareMoment(() => wanted.has(key));
};

// Paintings kept on this device, by what they depend on: the next session skips the painting
// (the slowest part of a flyover's wait). A short list; the oldest go. (The number in the key: the
// way they're painted; a new one paints them again.)
const KEPT_KEY = "paint:index", KEEP = 16;
const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const savedPaint = async <T,>(key: string): Promise<T | null> => { try { return ((await cacheGet(key)) as T | undefined) ?? null; } catch { return null; } };
const savePaint = async (key: string, value: unknown) => {
  try {
    await cacheSet(key, value);
    const index = ((await cacheGet(KEPT_KEY)) as string[] | undefined ?? []).filter(k => k !== key);
    index.push(key);
    while (index.length > KEEP) await cacheDelete(index.shift()!);
    await cacheSet(KEPT_KEY, index);
  } catch { /* no room, or no store: painted again next time */ }
};
// (paintings kept before they had a database of their own: let go of from the course's, once)
const oldPaintings = async () => {
  try {
    const index = (await idbGet(KEPT_KEY)) as string[] | undefined;
    if (!index) return;
    for (const k of index) await idbDelete(k);
    await idbDelete(KEPT_KEY);
  } catch { /* nothing kept, or no store */ }
};
if (typeof window !== "undefined") window.setTimeout(() => void oldPaintings(), 20_000);
const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>(res => canvas.toBlob(res, type, quality));
/** A kept picture back on a canvas (what the view draws from). */
const canvasOf = async (blob: Blob) => {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
};

/** The painting's longest side, pixels (about a foot per pixel on a usual site, like the photo). */
const MAX_PX = 2048;

/** The painting (a picture's URL) and where it shows woods. */
export type PaintedGround = { url: string; wooded: WoodedGrid | null };

// (the terrain by what's in it, not which object it is: a painting kept on disk is found again
// in the next session)
const terrainIds = new WeakMap<object, string>();
const idOf = (o: Record<string, number>) => {
  let id = terrainIds.get(o);
  if (!id) {
    let h = 2166136261, n = 0;
    for (const k in o) { const v = o[k]; h ^= (v * 100) | 0; h = Math.imul(h, 16777619); n++; }
    id = `${n}:${(h >>> 0).toString(36)}`;
    terrainIds.set(o, id);
  }
  return id;
};
/** What the painting depends on (not flyover settings, names, the logo and such). Worked out once
 * per version of the course: every item goes into it, and the map view asks on each render. */
const keys = new WeakMap<CourseDoc, string>();
const paintKey = (doc: CourseDoc) => {
  let key = keys.get(doc);
  if (key === undefined) keys.set(doc, (key = keyOf(doc)));
  // (and the measured trees standing, worked out by the 3D view after the course changes)
  return doc.lidar?.trees.length ? `${key}|${measuredStanding()?.key ?? ""}` : key;
};
const keyOf = (doc: CourseDoc) =>
  JSON.stringify([
    { ...doc.style, logo: undefined, card: undefined, sign: undefined, legendAt: undefined, page: undefined, texts: undefined, images: undefined, title: undefined, subtitle: undefined, footer: undefined, hideRocks: undefined, steepRock: undefined },
    idOf(doc.terrainHeights),
    doc.background?.length ?? 0,
    doc.canvas,
    doc.activeLayout,
    paintedFrom(doc, true)
  ]);

/** The course with its 3D look's colors (the painted ground is for the 3D view only), the same
 * copy each time for the same course. */
const docs3d = new WeakMap<CourseDoc, CourseDoc>(), made3d = new WeakSet<CourseDoc>();
const as3d = (doc: CourseDoc): CourseDoc => {
  if (made3d.has(doc)) return doc;
  let d = docs3d.get(doc);
  if (!d) { d = { ...doc, style: style3dOf(doc.style) }; docs3d.set(doc, d); made3d.add(d); }
  return d;
};

const made = new Map<string, Promise<PaintedGround | null>>();
/** The latest paintings (blob URLs), oldest first; older ones are let go. */
const kept: { key: string; url: string }[] = [];
let under: { key: string; stop: AbortController } | null = null;

/** The painted ground of a course, or null when it can't be painted; `ahead`: not wanted yet,
 * painted gently (one wanted later speeds up). */
export const paintedGround = (course: CourseDoc, ahead = false): Promise<PaintedGround | null> => {
  const doc = as3d(course);
  const key = paintKey(doc);
  if (!ahead) wanted.add(key);
  const hit = made.get(key);
  if (hit) return hit;
  // (a newer version of the course: the one under way is no longer wanted)
  if (under && under.key !== key) under.stop.abort();
  const job = { key, stop: new AbortController() };
  under = job;
  const { width, height } = doc.canvas;
  const k = Math.min(4, MAX_PX / Math.max(width, height, 1));
  const view = { cx: width / 2, cy: height / 2, rotation: 0, scale: k, width: width * k, height: height * k };
  const work = (async () => {
    const diskKey = `paint:map:3:${hashOf(key)}`;
    const saved = await savedPaint<{ blob: Blob; wooded: WoodedGrid | null }>(diskKey);
    let blob: Blob | null, wooded: WoodedGrid | null;
    if (saved) ({ blob, wooded } = saved);
    else {
      if (job.stop.signal.aborted) throw new Error("stopped");
      const canopy = paintsFromPhoto(doc) ? await canopyFor(doc) : null;
      const canvas = await forestCanvasAsync(doc, view, courseStats(doc), { mode: doc.style.forest ?? "everywhere", canopy, style: doc.style, density: 1, under: true }, job.stop.signal, undefined, gently(key, job.stop));
      blob = await toBlob(canvas, "image/jpeg", 0.9);
      wooded = woodedOf(canvas);
      if (blob) void savePaint(diskKey, { blob, wooded });
    }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    kept.push({ key, url });
    while (kept.length > 3) {
      const old = kept.shift()!;
      made.delete(old.key);
      URL.revokeObjectURL(old.url);
    }
    return { url, wooded };
  })().catch((err: unknown) => {
    // (stopped for a newer one: nothing to say; a failure is said)
    if (!job.stop.signal.aborted) console.error("The ground couldn't be painted:", err);
    made.delete(key);
    return null;
  }).finally(() => {
    if (under === job) under = null;
    wanted.delete(key);
  });
  made.set(key, work);
  return work;
};

/** A sharper painting round one hole, for its tee view, flyover and video: the canvas (its edges
 * fading out, over the painting of the whole site) and the plan rectangle it covers. */
export type PaintedDetail = { canvas: HTMLCanvasElement; rect: { x: number; y: number; width: number; height: number } };

/** Its edges fade over this many ft into the painting of the whole site. */
const DETAIL_FADE = 40;

const detailMade = new Map<string, Promise<PaintedDetail | null>>();
let detailUnder: { key: string; stop: AbortController } | null = null;

/** The sharp painting round a hole (`maxPx` its longest side), or null when the whole site's
 * painting is already about as sharp there. Painted once per version of the course. */
export const paintedDetail = (course: CourseDoc, holeId: string, maxPx = 3072): Promise<PaintedDetail | null> => {
  const doc = as3d(course);
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return Promise.resolve(null);
  const st = holeStats(doc, hole);
  if (!st.complete) return Promise.resolve(null);
  const { width, height } = doc.canvas;
  const at = detailArea(doc, st.line, maxPx, Math.min(4, MAX_PX / Math.max(width, height, 1)));
  if (!at) return Promise.resolve(null);
  const { rect, k } = at;
  const key = JSON.stringify([paintKey(doc), rect, Math.round(k * 100)]);
  const hit = detailMade.get(key);
  if (hit) return hit;
  if (detailUnder && detailUnder.key !== key) detailUnder.stop.abort();
  const job = { key, stop: new AbortController() };
  detailUnder = job;
  const view = { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rotation: 0, scale: k, width: rect.width * k, height: rect.height * k };
  const work = (async () => {
    const diskKey = `paint:detail:3:${hashOf(key)}`;
    const saved = await savedPaint<{ blob: Blob }>(diskKey);
    if (saved) return { canvas: await canvasOf(saved.blob), rect };
    if (job.stop.signal.aborted) throw new Error("stopped");
    const canopy = paintsFromPhoto(doc) ? await canopyFor(doc) : null;
    const canvas = await forestCanvasAsync(doc, view, courseStats(doc), { mode: doc.style.forest ?? "everywhere", canopy, style: doc.style, density: 1, under: true }, job.stop.signal);
    // Its edges fade into the painting of the whole site (none where it meets the site's edge)
    const c = canvas.getContext("2d")!;
    const f = DETAIL_FADE * k;
    c.globalCompositeOperation = "destination-out";
    const W = canvas.width, H = canvas.height;
    const band = (x: number, y: number, w: number, h: number, gx0: number, gy0: number, gx1: number, gy1: number) => {
      const grad = c.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = grad;
      c.fillRect(x, y, w, h);
    };
    if (rect.x > 0) band(0, 0, f, H, 0, 0, f, 0);
    if (rect.x + rect.width < width) band(W - f, 0, f, H, W, 0, W - f, 0);
    if (rect.y > 0) band(0, 0, W, f, 0, 0, 0, f);
    if (rect.y + rect.height < height) band(0, H - f, W, f, 0, H, 0, H - f);
    c.globalCompositeOperation = "source-over";
    // (kept with its see-through edges: WebP where the browser writes it, else PNG)
    void toBlob(canvas, "image/webp", 0.9).then(b => { if (b) void savePaint(diskKey, { blob: b }); });
    return { canvas, rect };
  })().catch((err: unknown) => {
    if (!job.stop.signal.aborted) console.error("The hole's ground couldn't be painted:", err);
    detailMade.delete(key);
    return null;
  }).finally(() => {
    if (detailUnder === job) detailUnder = null;
  });
  // (only the latest two kept: each is a big picture)
  detailMade.set(key, work);
  while (detailMade.size > 2) detailMade.delete(detailMade.keys().next().value!);
  return work;
};

/** The painted ground for the course as it is, while `active` (null until it is painted), and
 * whether it is of the course as it is now (the last painting stands in while the newest
 * version paints: a flyover waits for the new one). */
export const usePaintedGround = (active: boolean, ahead = false): [PaintedGround | null, boolean] => {
  const doc = as3d(useCourse(s => s.doc));
  const [got, setGot] = useState<{ key: string; p: PaintedGround } | null>(null);
  const [trees, bump] = useState(0);
  useEffect(() => onStanding(() => bump(n => n + 1)), []);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const key = paintKey(doc);
    void paintedGround(doc, ahead).then(p => { if (live && p) setGot({ key, p }); });
    return () => { live = false; };
  }, [active, ahead, doc, trees]);
  const fresh = !!got && got.key === paintKey(doc);
  return [active ? got?.p ?? null : null, fresh];
};
