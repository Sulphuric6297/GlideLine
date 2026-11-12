// A site just brought in, built in front of you: the 3D view starts straight down over the photo,
// swoops into 3D as the ground rises, and a hand picks the app's own tools in turn and plants the
// trees, runs the water down its bed, draws the paths and roads, sets down the buildings, then
// opens View and carries the sun across the sky. Everything it shows is the course as it already
// is: the scene is whole before it starts (so nothing is made while it plays), each part only
// held back and let in, and all of it is put back exactly when it ends or is skipped.
import * as THREE from "three";
import { forestDetail } from "../three/treeKit";
import { getView } from "../state/view";
import { changeDoc, getDoc, useEditor } from "../state/course";
import { isImported, type ImportLayer } from "../lib/importSite";
import { playTreesSound } from "../lib/importSound";

type P = { x: number; y: number };
const cl = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const io = (x: number) => ((x = cl(x)), x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const out = (x: number) => 1 - (1 - cl(x)) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const onPath = (path: P[], u: number): P => {
  if (path.length < 2) return path[0] ?? { x: 0, y: 0 };
  const f = cl(u) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), k = f - i;
  return { x: lerp(path[i].x, path[i + 1].x, k), y: lerp(path[i].y, path[i + 1].y, k) };
};
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** How it's going, for tests ("skipped": not played on this device or course). */
type ShowState = "idle" | "waiting" | "playing" | "done" | "skipped";
const say = (state: ShowState, extra: Record<string, unknown> = {}) => { (window as any).__dgImportShow = { ...(window as any).__dgImportShow, state, ...extra }; };

/** A site still coming in, handed to the show a part at a time: each part waits in line and is let
 * into the course at a moment the picture is at rest. */
type LivePart = { kind: "ground" | "photo" | "lidar" | "things" | "sort" | "final"; apply: () => void };
type LiveState = { waiters: (() => void)[]; queue: LivePart[]; fraction: number; text: string; finalDone: boolean; ended: boolean; name: string; photo?: string; reveal?: () => void };
const BIG = 1e6;
const LIVE_ROWS: [string, string][] = [["ground", "Ground"], ["trees", "Trees"], ["water", "Water"], ["paths", "Paths, roads and more"], ["build", "Buildings and more"]];

type Step = { id: "ground" | "trees" | "water" | "paths" | "build"; tool: string; name: string; doing: string; now: string; val: string; click: number; from: number; to: number };

/** Whether a hand acts the build out with the app's tools (off: each part comes in on its own). */
const HAND = typeof window !== "undefined" && (window as any).__dgShowHand === true;

/** Plays the show on the course just brought in (a first site, on a device with a graphics card:
 * a computer, or a phone in its own layout; with motion reduced, nothing happens). Resolves when
 * it's over. */
export async function playImportShow(opts: { force?: boolean } = {}): Promise<void> {
  const w = window as any, speed: number = w.__dgShowSpeed ?? 1;
  say("waiting");
  // (the Design step's 3D view, once it's there with this course)
  useEditor.getState().set({ step: "design", view: "3d", tool: "select", selectedId: null } as any);
  let v: any = null;
  for (let n = 0; n < 100; n++) {
    await new Promise(r => setTimeout(r, 60));
    v = getView();
    if (v?.doc && v.doc.canvas.width === getDoc().canvas.width && v.size?.width > 1) break;
  }
  const doc = getDoc();
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const why = !v?.doc ? "no 3D view" : opts.force ? "" : v.software ? "no graphics card" : reduced ? "reduced motion" : doc.holes.length > 0 ? "the course has holes" : "";
  if (why) { say("skipped", { why }); console.info(`Import show not played: ${why}`); return; }
  const show = new ImportShow(v, speed);
  try { await show.run(); } catch (err) { console.warn("Import show stopped", err); } finally { show.restore(); say("done"); }
}
if (typeof window !== "undefined") (window as any).__dgImportShow = { state: "idle", play: (force = true) => playImportShow({ force }) };

/** A site built in front of you while it's still coming in (see `startLiveImport`). */
export type LiveImport = {
  /** A part of the site, as it lands. */
  layer(l: ImportLayer): void;
  /** Resolves when the picture is at rest: the import sorts its sources out then (a long piece of
   * work on the page's thread, which would hold a moving picture still). */
  beforeSort(): Promise<void>;
  /** Resolves at a moment nothing of the build is moving (within a few seconds at most): for a
   * short piece of the import's work on the page's own thread. */
  calm(): Promise<void>;
  /** How far the whole import has got, and what it's doing. */
  progress(fraction: number, text: string): void;
  /** Everything's in: `commit` brings it into the course once the show reaches it. Resolves true
   * when the show has played to its end, false when it was skipped or couldn't play (the course
   * then as it was before, for the usual review). */
  final(commit: () => void): Promise<boolean>;
  /** The import failed or was stopped: the course as it was. */
  abort(): void;
  dead(): boolean;
};
let liveEnded: Promise<unknown> = Promise.resolve();
/** Resolves once the show of a site coming in is over (at once when none is playing). */
export const liveShowEnded = () => liveEnded;

/** The view of the Design step in 3D, once it shows the course as it is now. */
const viewReady = async () => {
  useEditor.getState().set({ step: "design", view: "3d", tool: "select", selectedId: null } as any);
  let v: any = null;
  for (let n = 0; n < 100; n++) {
    await new Promise(r => setTimeout(r, 60));
    v = getView();
    if (v?.doc && v.doc.canvas.width === getDoc().canvas.width && v.size?.width > 1) return v;
  }
  return null;
};

/**
 * Starts the show for a site that is still coming in: the ground goes in as soon as it lands and
 * the view swoops into 3D as it rises, the measured trees are planted when they land, and the rest
 * (water, paths, buildings) once everything is in and sorted out. Nothing is kept in the course
 * until the import's own `commit`; skipped or failed, the course is put back as it was.
 * Null where it doesn't play (not switched on, a course with something in it, no graphics card,
 * motion reduced): the import then goes as it always has. `hide` puts the import's own screen out
 * of the way (true) or back (false).
 */
export function startLiveImport(o: { name: string; hide: (on: boolean) => void }): LiveImport | null {
  const w = window as any, v0: any = getView(), d0 = getDoc();
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let on = w.__dgLiveImport !== false;
  try { on = on && localStorage.getItem("dg-live-import") !== "off"; } catch { /* no storage */ }
  // (the old way, a hand acting it out: a computer only, as it was made)
  if (HAND && v0?.mobile) on = false;
  if (!on || !v0 || v0.software || reduced || d0.holes.length || d0.items.some(i => !isImported(i))) return null;
  const L: LiveState = { waiters: [], queue: [], fraction: 0, text: "", finalDone: false, ended: false, name: o.name };
  const snap = { canvas: d0.canvas, gridSize: d0.gridSize, terrainHeights: d0.terrainHeights, terrainOriginal: d0.terrainOriginal, background: d0.background, items: d0.items, lidar: d0.lidar, groundPaint: d0.groundPaint, cutTrees: d0.cutTrees };
  let dead = false, started = false, finish: (ok: boolean) => void = () => {};
  const done = new Promise<boolean>(r => (finish = r));
  liveEnded = done;
  const fail = () => {
    if (dead || L.ended) return;
    dead = true; L.ended = true; L.queue.length = 0;
    if (started && !L.finalDone) changeDoc(() => snap, false);
    o.hide(false);
    say("skipped", { why: "stopped" });
    finish(false);
  };
  const begin = async (l: Extract<ImportLayer, { source: "frame" }>) => {
    changeDoc(() => ({ canvas: l.canvas, gridSize: l.gridSize, terrainHeights: {}, terrainOriginal: undefined, background: null, items: [], lidar: undefined, groundPaint: {}, cutTrees: [] }), false);
    // (the import's own screen stays, its frame and its list, till the ground is in and the show begins)
    L.reveal = () => o.hide(true);
    say("waiting");
    const v = await viewReady();
    if (!v || dead) { fail(); return; }
    const show = new ImportShow(v, w.__dgShowSpeed ?? 1, L);
    try { await show.run(); } catch (err) { console.warn("Import show stopped", err); }
    show.restore();
    if (L.finalDone) { L.ended = true; say("done"); finish(true); } else fail();
  };
  return {
    layer(l) {
      if (dead) return;
      if (l.source === "frame") { if (!started) { started = true; void begin(l); } }
      else if (l.source === "photo") { L.photo = l.background; if (!HAND) L.queue.push({ kind: "photo", apply: () => changeDoc(() => ({ background: l.background }), false) }); }
      // (what the map has, as it lands: its water, paths, roads and buildings. Its woods wait for
      // the end, when it's known whether measured trees stand in them.)
      else if (l.source === "osm" && !HAND) { const add = l.items.filter(i => !(i.type === "area" && i.kind === "woods")); if (add.length) L.queue.push({ kind: "things", apply: () => changeDoc(d => ({ items: [...d.items, ...add] }), false) }); }
      else if (l.source === "elevation") L.queue.push({ kind: "ground", apply: () => changeDoc(() => ({ terrainHeights: l.terrainHeights }), false) });
      else if (l.source === "lidar" && l.trees.length) L.queue.push({ kind: "lidar", apply: () => changeDoc(() => ({ lidar: { source: l.label, trees: l.trees }, terrainHeights: l.terrainHeights }), false) });
    },
    beforeSort() { return dead ? Promise.resolve() : new Promise<void>(ok => { L.queue.push({ kind: "sort", apply: ok }); setTimeout(ok, 20000); }); },
    calm() { return dead || L.ended ? Promise.resolve() : new Promise<void>(ok => { L.waiters.push(ok); setTimeout(ok, 4000); }); },
    progress(fraction, text) { L.fraction = fraction; L.text = text; },
    final(commit) {
      if (dead) return Promise.resolve(false);
      // (the course as it was, then the import's own bringing-in on top of it: one step to undo)
      L.queue.push({ kind: "final", apply: () => { if (HAND) changeDoc(() => snap, false); commit(); } });
      return done;
    },
    abort: fail,
    dead: () => dead
  };
}

class ImportShow {
  private W: number; private H: number; private span: number;
  private undo: (() => void)[] = [];
  private stopped = false;
  private els: HTMLElement[] = [];
  private cur!: HTMLElement; private ring!: SVGPolygonElement; private card!: HTMLElement; private cover!: HTMLElement;
  private curAt = { x: 0, y: 0 }; private from = { x: 0, y: 0 };
  private ringW: { x: number; y: number; r: number } | null = null; private ringO = 0;
  private trees: { o: THREE.Object3D; x: number; y: number; at: number; s: number }[] = [];
  private inst: { m: THREE.InstancedMesh; base: Float32Array; n: number; at: Float32Array }[] = [];
  private shapes: { o: THREE.Object3D; x: number; y: number; pts: P[]; water: boolean; struct: boolean; at: number; way: P[]; rev: { line?: boolean; geo: any; max?: number; n?: number }[]; mats: { m: any; op: number; tr: boolean }[]; p: number }[] = [];
  private built: { o: THREE.Object3D; x: number; y: number; pts?: P[]; out?: SVGPathElement; e: number }[] = [];
  private treePath: P[] = []; private waterPath: P[] = []; private pathPath: P[] = [];
  /** The paths the hand draws itself: where each begins and ends along its way. */
  private traced = new Map<object, [number, number]>();
  private steps: Step[] = [];
  private T = HAND ? { cover: 1.0, groundClick: 1.6, swoop: [1.9, 6.5], rise: [2.3, 6.1], sunClick: 0, sun: [0, 0], sunClose: 0, back: 0, end: 0 } : { cover: 0.8, groundClick: 1.0, swoop: [1.1, 4.6], rise: [1.3, 3.3], sunClick: 0, sun: [0, 0], sunClose: 0, back: 0, end: 0 };
  private cam!: { from: any; to: any; orbit: number; lower: number };
  private sunSet: { azimuth: number; altitude: number; shadows: number } | null = null;
  private sunReal: { azimuth: number; altitude: number; shadows: number };
  private photoReal: number; private photoNow: number;
  private realDoc: any;
  private picked = "select";
  private scene: { open: boolean; shut: boolean; sl?: HTMLInputElement; twin?: HTMLElement; val?: string; hidden: { el: HTMLElement; d: string }[] } = { open: false, shut: false, hidden: [] };
  private labels: HTMLElement[] = [];
  private frameN = 0;
  /** What the show has already taken in hand (a site coming in a part at a time). */
  private seen = new Set<object>();
  private tNow = 0;
  private extras: THREE.Object3D | null = null;
  private treeKick = false;
  private treesPlayed = false;
  /** What's been taken in hand before, by what it is (made again since: left whole, not built twice). */
  private keys = new Set<string>();
  /** The parts already built: whole, and put back with the rest at the end. */
  private was: { trees: ImportShow["trees"]; inst: ImportShow["inst"]; shapes: ImportShow["shapes"]; built: ImportShow["built"] }[] = [];
  private tally: Record<string, number> = {};
  /** A site coming in: open at once, straight down, the ground rising when it lands. */
  private noCover = false;
  /** The site's footprint, dark with a lit edge, till the first of it is here: then it lifts off what's under it. */
  private lid: SVGPathElement | null = null; private lidEdge: SVGPathElement | null = null;
  private revealAt: number | undefined;
  private photoAt: number | undefined;
  private grounded = true;
  private groundAt: number | undefined;
  /** A part being let in: the picture comes to rest, the part goes into the course, its things are held back. */
  private absorbing: { part: LivePart; at: number; applied: boolean } | null = null;
  private awaiting: LivePart["kind"] | null = null;
  private drift = 1;
  private liveAz = 0;
  /** A phone: a fingertip for the hand, the tools' sliding row, a small pill for the card. */
  private phone = false;
  private slid = new Set<string>();
  private put = new Set<string>();
  /** Where the hand is headed, fixed once it sets off (nothing it's gliding to moves under it). */
  private aims = new Map<string, P>();
  private slides: { box: HTMLElement; from: number; to: number; t0: number }[] = [];
  /** A phone's Done button for the tool in hand. */
  private doneBtn() { const el = document.querySelector<HTMLElement>("button.bg-orange-300.rounded-full[aria-label]"); const r = el?.getBoundingClientRect(); return el && r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2, el } : null; }

  constructor(private v: any, private speed: number, private live: LiveState | null = null) {
    const d = v.doc;
    this.W = d.canvas.width; this.H = d.canvas.height; this.span = Math.max(this.W, this.H);
    this.realDoc = d;
    this.sunReal = { azimuth: d.sun?.azimuth ?? 225, altitude: d.sun?.altitude ?? 38, shadows: d.sun?.shadows ?? 0.65 };
    this.photoReal = this.photoNow = d.background?.url ? (d.background.opacity ?? 1) : 0;
    this.phone = !!v.mobile || (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && window.innerWidth < 700);
  }

  private screenOf(x: number, y: number, up = 2) {
    const v = this.v, r = v.container.getBoundingClientRect();
    const p = new THREE.Vector3(x, v.h(cl(x, 0, this.W), cl(y, 0, this.H)) * v.ground.group.scale.y + up, y).project(v.camera);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }
  private el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, parent: HTMLElement = document.body) {
    const e = document.createElement(tag); e.style.cssText = css; parent.appendChild(e); if (parent === document.body) this.els.push(e); return e;
  }
  private tool(id: string) {
    const el = document.querySelector<HTMLElement>(`[data-tool="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // (not while it's off the side of a phone's sliding row)
    const cx = r.x + r.width / 2;
    return r.width && cx > 16 && cx < window.innerWidth - 16 ? { x: cx, y: r.y + r.height / 2 - 3, el } : null;
  }
  private camTo(az: number, polar: number, dist: number, tx: number, ty: number, tz: number) {
    void this.v.controls.setLookAt(tx + dist * Math.sin(polar) * Math.sin(az), ty + dist * Math.cos(polar), tz + dist * Math.sin(polar) * Math.cos(az), tx, ty, tz, false);
  }

  async run() {
    const v = this.v, name = this.live?.name || String(getDoc().name).replace(/ Disc Golf Course$/, "");
    // --- a cover while the scene is made whole (its trees and woods), then lifted as the show starts
    const box = v.container.getBoundingClientRect();
    this.cover = this.el("div", `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:9990;background:#141b12;display:grid;place-items:center;color:#e4e4e7;font:600 15px system-ui,'Segoe UI',sans-serif;border-radius:inherit`);
    this.cover.setAttribute("data-testid", "import-show-cover");
    this.cover.textContent = this.live ? `Fetching ${name}…` : `Putting ${name} together…`;
    // (nothing of the map is worked while it plays; a click anywhere, or Esc, skips it)
    const shield = this.el("div", "position:fixed;inset:0;z-index:9995;cursor:default");
    shield.setAttribute("data-testid", "import-show");
    const skip = this.el("button", "position:fixed;right:24px;bottom:24px;z-index:9999;height:36px;padding:0 16px;border-radius:999px;border:0;background:rgba(20,28,18,.72);color:#f4f4f5;font:650 13px system-ui,'Segoe UI',sans-serif;backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);cursor:pointer");
    if (this.phone) skip.style.cssText += `;right:auto;left:12px;bottom:auto;top:${box.top + 88}px;height:34px;padding:0 13px`;
    skip.textContent = "Skip"; skip.setAttribute("data-testid", "import-show-skip");
    const stop = () => { this.stopped = true; };
    skip.onclick = stop;
    if (this.live) for (const e of [this.cover, shield, skip]) e.style.display = "none";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); stop(); } };
    window.addEventListener("keydown", onKey, true);
    this.undo.push(() => window.removeEventListener("keydown", onKey, true));
    { const ex = v.ground?.extras as THREE.Object3D | undefined; if (ex) { const vis = ex.visible; ex.visible = false; this.undo.push(() => { ex.visible = vis; }); this.extras = ex; } }
    const ctl = v.controls.enabled; v.controls.enabled = false;
    this.undo.push(() => { v.controls.enabled = ctl; });
    // (no stepping the quality down for the show's own frames)
    v.settleUntil = performance.now() + 120000;
    this.undo.push(() => { v.settleUntil = performance.now() + 2500; });

    // --- the camera's way: straight down over the site to start, a low view round it to end
    const span = this.span, cx = this.W / 2, cy = this.H / 2;
    const fov = ((v.camera.fov ?? 30) * Math.PI) / 180, aspect = box.width / box.height;
    const top = Math.max(this.H / 2 / Math.tan(fov / 2), this.W / 2 / (Math.tan(fov / 2) * aspect)) * 1.45;
    this.cam = { from: { az: 0, polar: 0.0015, dist: top, tx: cx, tz: cy }, to: { az: -0.55, polar: this.phone ? 1.08 : 1.17, dist: span * 1.12 * (aspect < 1 ? Math.min(2.1, 1.05 / aspect + 0.35) : 1), tx: cx - this.W * 0.03, tz: cy + this.H * 0.02 }, orbit: 0.85, lower: 0.1 };
    const quick = !!this.live && !HAND;
    if (quick) {
      // (nothing to make ready: the view straight down over the frame at once, each part as it lands)
      const f = this.cam.from;
      this.camTo(f.az, f.polar, f.dist, f.tx, 0, f.tz);
      this.noCover = true; this.grounded = false; this.cover.style.display = "none";
      // (called 3D from the start: the app's own change of that, part-way through the swoop, would hold a frame)
      this.tipped = true; useEditor.getState().set({ view: "3d" } as any);
      this.T = { cover: 0.01, groundClick: BIG, swoop: [BIG, BIG + 3.5], rise: [BIG, BIG + 2], sunClick: BIG, sun: [BIG, BIG + 3.3], sunClose: BIG + 4, back: BIG + 5, end: BIG + 7 };
      this.steps.push({ id: "ground", tool: "ground", name: "Ground", doing: "shaping", now: "Shaping the ground", val: "", click: BIG, from: BIG, to: BIG + 2 });
      this.live!.reveal?.(); shield.style.display = ""; skip.style.display = "";
      v.dirty = true;
    } else {
    // (from where it ends, so every tree is made as it will be seen; then the scene left to finish)
    this.camTo(this.cam.to.az + this.cam.orbit * 0.5, this.cam.to.polar, this.cam.to.dist, this.cam.to.tx, 30, this.cam.to.tz);
    v.dirty = true;
    let calm = 0;
    for (let n = 0; n < 400 && calm < 14 && !this.stopped; n++) {
      await new Promise(r => setTimeout(r, 100));
      v.dirty = true;
      calm = (v.slowQueue?.size ?? 0) === 0 && !v.warming ? calm + 1 : 0;
    }
    // (the skies the sun passes under, fetched and drawn once behind the cover: none is met for the
    // first time while it plays)
    for (let i = 0; i <= 12 && !this.stopped; i++) {
      const u = i / 12;
      v.doc = { ...v.doc, sun: { ...(v.doc.sun ?? {}), azimuth: lerp(104, 256, u), altitude: lerp(21, 11, u) + 30 * Math.sin(Math.PI * u) } };
      v.placeSun(); v.shadowsDirty = true; v.dirty = true;
      await new Promise(r => setTimeout(r, 140));
    }
    v.doc = this.realDoc; v.placeSun(); v.dirty = true;
    await new Promise(r => setTimeout(r, 200));
    if (this.stopped || v.disposed) return;
    if (this.live) {
      // (the ground first: nothing plays till it's in, or till everything is)
      const L = this.live;
      const sortNow = () => { for (let i = L.queue.length - 1; i >= 0; i--) if (L.queue[i].kind === "sort") L.queue.splice(i, 1)[0].apply(); };
      while (!this.stopped && !L.ended && !v.disposed && !L.queue.some(q => q.kind === "ground" || q.kind === "final")) { sortNow(); await new Promise(r => setTimeout(r, 80)); }
      if (this.stopped || v.disposed || L.ended) return;
      const gi = L.queue.findIndex(q => q.kind === "ground");
      if (gi >= 0) { L.queue.splice(gi, 1)[0].apply(); for (let n = 0; n < 40; n++) { await new Promise(r => setTimeout(r, 60)); if (Object.keys(getDoc().terrainHeights).length && (v.slowQueue?.size ?? 0) === 0 && v.doc?.heights === v.heightsRef) break; } await new Promise(r => setTimeout(r, 350)); }
      // (the photo, when it's in already: on the ground as the show opens, straight down, as it was framed)
      if (L.photo) { changeDoc(() => ({ background: L.photo! }), false); await new Promise(r => setTimeout(r, 450)); this.realDoc = v.doc; this.photoReal = this.photoNow = v.doc.background?.url ? (v.doc.background.opacity ?? 1) : 0; }
      if (this.stopped || v.disposed || L.ended) return;
      L.reveal?.(); shield.style.display = ""; skip.style.display = ""; this.cover.style.display = "grid"; this.cover.textContent = "";
      const d = getDoc() as any, hs = Object.values(d.terrainHeights ?? {}) as number[];
      let lo = 0, hi = 0; for (const h of hs) { if (h < lo) lo = h; if (h > hi) hi = h; }
      this.steps.push({ id: "ground", tool: "ground", name: "Ground", doing: "shaping", now: "Shaping the ground", val: `${Math.round(hi - lo)} ft of climb`, click: this.T.groundClick, from: this.T.rise[0], to: this.T.rise[1] });
      this.T.sunClick = BIG; this.T.sun = [BIG, BIG + 3.3]; this.T.sunClose = BIG + 4; this.T.back = BIG + 5; this.T.end = BIG + 7;
    } else {
      this.gather();
      this.beats();
    }
    }
    this.dress(name);
    say("playing", { steps: this.steps.map(s => s.id), seconds: this.T.end });
    // --- played by the clock (a late frame only shows a later moment: nothing is skipped over)
    const t0 = performance.now();
    // (with a graphics card, no frame moves the show on more than a twentieth of a second: after a
    // slow one, a tree being made say, it carries on from where it was, and nothing is jumped over)
    const even = !v.software;
    let clock = 0, lastReal = t0;
    await new Promise<void>(done => {
      const tick = () => {
        const held = (window as any).__dgShowClock as (() => number) | undefined;
        const nowReal = performance.now(); this.even = nowReal - lastReal < 40 ? this.even + 1 : 0; clock += Math.min(0.05, (nowReal - lastReal) / 1000) * this.speed; lastReal = nowReal;
        const t = held ? held() : even ? clock : ((nowReal - t0) / 1000) * this.speed;
        if (this.stopped || v.disposed || this.live?.ended || t >= this.T.end) { done(); return; }
        this.tNow = t;
        if (this.live) this.liveTick(t);
        this.frame(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** What the show holds back and lets in: the trees, the water, paths and other shapes, the buildings. */
  private gather(want = { trees: true, shapes: true }) {
    const v = this.v, d = getDoc(), W = this.W, H = this.H, span = this.span;
    if (want.trees) this.treePath = [];
    if (want.shapes) { this.pathPath = []; this.traced.clear(); }
    for (const it of d.items as any[]) {
      const e = v.objects.get(it.id);
      if (!e || this.seen.has(e.obj)) continue;
      if (this.keys.has("o:" + it.id)) { this.seen.add(e.obj); continue; }
      if (it.type === "tree" ? !want.trees : !want.shapes) { if (it.type === "tree") { this.seen.add(e.obj); this.keys.add("o:" + it.id); } continue; }
      this.seen.add(e.obj); this.keys.add("o:" + it.id);
      if (it.type === "tree") this.trees.push({ o: e.obj, x: it.x, y: it.y, at: 0, s: -1 });
      else if (it.type === "amenity") this.built.push({ o: e.obj, x: it.x, y: it.y, e: -1 });
    }
    // (the woods' and the measured trees: each one's own place kept, to grow it by; held as they are)
    for (const g of v.itemsGroup.children as THREE.Object3D[]) {
      const f = g.userData.forest;
      if (!f || this.seen.has(g)) continue;
      this.seen.add(g);
      const again = !!g.name && this.keys.has("f:" + g.name);
      if (g.name) this.keys.add("f:" + g.name);
      if (!want.trees || again) continue;
      const was = Object.prototype.hasOwnProperty.call(f, "update") ? f.update : undefined;
      f.update = () => {};
      this.undo.push(() => { if (was) f.update = was; else delete f.update; });
      g.traverse(o => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && m.count > 0) this.inst.push({ m, base: Float32Array.from(m.instanceMatrix.array.subarray(0, m.count * 16)), n: m.count, at: new Float32Array(m.count) }); });
    }
    this.undo.push(() => { forestDetail.version++; });
    for (const [key, e] of v.shapes as Map<string, { obj: THREE.Object3D }>) {
      const kind = key.split(":")[0], it = (d.items as any[]).find(i => i.id === key.split(":")[1]);
      if (!it || !(kind === "area" || kind === "line" || kind === "struct") || !want.shapes || this.seen.has(e.obj)) continue;
      this.seen.add(e.obj);
      if (it.type === "area" && it.kind === "woods") { const o = e.obj, vis = o.visible; o.visible = false; this.undo.push(() => { o.visible = vis; }); continue; }
      if (this.keys.has("s:" + key)) continue;
      this.keys.add("s:" + key);
      const pts: P[] = it.points?.length ? it.points : [{ x: it.x, y: it.y }];
      const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const water = (it.type === "area" && it.kind === "water") || (it.type === "line" && it.kind === "stream");
      const struct = kind === "struct" || it.type === "structure";
      // (an outline's middle line, end to end, for what's drawn along it)
      let way = pts;
      if (it.type === "area" && pts.length >= 8) { const half = Math.floor(pts.length / 2), mid: P[] = []; for (let i = 0; i < half; i += Math.max(1, Math.floor(half / 24))) { const a = pts[i], b = pts[pts.length - 1 - i]; mid.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); } if (mid.length > 3) way = mid; }
      this.shapes.push({ o: e.obj, x: mx, y: my, pts, water, struct, at: 0, way, rev: [], mats: [], p: -1 });
    }
    // the hand's way through the trees: stand by stand, nearest next
    {
      const N = 7, cells = new Map<string, { x: number; y: number; n: number }>();
      const add = (x: number, y: number) => { const k = `${Math.floor(x / (W / N))},${Math.floor(y / (H / N))}`; const c = cells.get(k) ?? { x: 0, y: 0, n: 0 }; c.x += x; c.y += y; c.n++; cells.set(k, c); };
      for (const t of this.trees) add(t.x, t.y);
      for (const q of this.inst) for (let i = 0; i < q.n; i++) add(q.base[i * 16 + 12], q.base[i * 16 + 14]);
      const all = [...cells.values()], need = Math.min(12, Math.max(1, Math.floor(all.reduce((s, c) => s + c.n, 0) / 60)));
      const stands = all.filter(c => c.n >= need).map(c => ({ x: c.x / c.n, y: c.y / c.n }));
      const tour: P[] = []; let at: P = { x: 0, y: H };
      while (stands.length) { let bi = 0, bd = Infinity; stands.forEach((c, i) => { const dd = Math.hypot(c.x - at.x, c.y - at.y); if (dd < bd) { bd = dd; bi = i; } }); at = stands.splice(bi, 1)[0]; tour.push(at); }
      const Q = (i: number) => tour[Math.max(0, Math.min(tour.length - 1, i))];
      for (let i = 0; i < tour.length - 1; i++) for (let s = 0; s < 8; s++) { const u = s / 8, p0 = Q(i - 1), p1 = Q(i), p2 = Q(i + 1), p3 = Q(i + 2), cr = (a0: number, a1: number, a2: number, a3: number) => 0.5 * (2 * a1 + (a2 - a0) * u + (2 * a0 - 5 * a1 + 4 * a2 - a3) * u * u + (3 * a1 - a0 - 3 * a2 + a3) * u * u * u); this.treePath.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) }); }
      if (tour.length) this.treePath.push(tour[tour.length - 1]);
    }
    const mainWater = this.shapes.filter(s => s.water).sort((a, b) => b.pts.length - a.pts.length)[0];
    this.waterPath = mainWater?.way ?? [];
    {
      const len = (p: P[]) => { let n = 0; for (let i = 1; i < p.length; i++) n += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return n; };
      const lines = this.shapes.filter(q => !q.water && !q.struct && q.way.length >= 2 && len(q.way) > span * 0.05).sort((a, b) => len(b.way) - len(a.way)).slice(0, 3);
      const total = lines.reduce((n, q) => n + len(q.way), 0);
      let at: P = { x: W * 0.9, y: H * 0.3 };
      const left = [...lines];
      while (left.length) {
        // (the nearest end of the nearest one next)
        let bi = 0, bd = Infinity;
        left.forEach((q, i) => { const a = q.way[0], da = Math.hypot(a.x - at.x, a.y - at.y); if (da < bd) { bd = da; bi = i; } });
        const q = left.splice(bi, 1)[0];
        if (this.pathPath.length) { const hop = Math.max(5, Math.round((44 * 0.7 * Math.hypot(q.way[0].x - at.x, q.way[0].y - at.y)) / (total || 1))); for (let k = 1; k < hop; k++) this.pathPath.push({ x: lerp(at.x, q.way[0].x, io(k / hop)), y: lerp(at.y, q.way[0].y, io(k / hop)) }); }
        const i0 = this.pathPath.length, n = Math.max(8, Math.round((44 * len(q.way)) / (total || 1)));
        for (let k = 0; k <= n; k++) this.pathPath.push(onPath(q.way, k / n));
        this.traced.set(q, [i0, this.pathPath.length - 1]);
        at = q.way[q.way.length - 1];
      }
      if (!this.pathPath.length) for (let k = 0; k <= 40; k++) { const u = k / 40; this.pathPath.push({ x: W * (0.9 - 0.8 * u), y: H * (0.3 + 0.36 * u + 0.16 * Math.sin(u * 9)) }); }
    }
    // when the hand reaches each thing (no two trees up together)
    const reach = (path: P[], x: number, y: number, R: number) => { let best = 1, bd = Infinity; for (let i = 0; i < path.length; i++) { const dd = Math.hypot(path[i].x - x, path[i].y - y); if (dd < R) return i / Math.max(1, path.length - 1); if (dd < bd) { bd = dd; best = i / Math.max(1, path.length - 1); } } return best; };
    const rnd = (a: number, b: number) => { const q = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return q - Math.floor(q); };
    const R = span * 0.1;
    for (const t of this.trees) t.at = cl(reach(this.treePath, t.x, t.y, R) + (rnd(t.x, t.y) - 0.5) * 0.07);
    for (const q of this.inst) for (let i = 0; i < q.n; i++) { const x = q.base[i * 16 + 12], y = q.base[i * 16 + 14]; q.at[i] = cl(reach(this.treePath, x, y, R) + (rnd(x, y) - 0.5) * 0.07); }
    for (const s of this.shapes) s.at = s.water ? 0 : reach(this.pathPath, s.x, s.y, span * 0.12);
    // drawn along their length: a line's pieces in order, a surface's triangles sorted along its way
    const along = (path: P[], x: number, y: number) => { let bi = 0, bd = Infinity; for (let i = 0; i < path.length; i++) { const dd = (path[i].x - x) ** 2 + (path[i].y - y) ** 2; if (dd < bd) { bd = dd; bi = i; } } return bi; };
    for (const s of this.shapes) {
      if (s.struct || s.rev.length || s.mats.length) continue;
      s.o.traverse(o => {
        const m = o as THREE.Mesh, geo = m.geometry as any;
        if (!geo) return;
        if (geo.attributes?.instanceStart) { const max = geo.instanceCount; s.rev.push({ line: true, geo, max: Number.isFinite(max) ? max : geo.attributes.instanceStart.count }); return; }
        const pos = geo.attributes?.position as THREE.BufferAttribute | undefined;
        if (!m.isMesh || !pos) return;
        const idx: number[] = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i), n = Math.floor(idx.length / 3);
        if (n < 2 || n > 400000) return;
        const tris: { a: number; b: number; c: number; k: number }[] = [];
        for (let i = 0; i < n; i++) { const a = idx[i * 3], b = idx[i * 3 + 1], c = idx[i * 3 + 2]; tris.push({ a, b, c, k: along(s.way, (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3) + i * 1e-7 }); }
        tris.sort((p, q) => p.k - q.k);
        const arr = new (pos.count > 65535 ? Uint32Array : Uint16Array)(n * 3);
        tris.forEach((tr, i) => { arr[i * 3] = tr.a; arr[i * 3 + 1] = tr.b; arr[i * 3 + 2] = tr.c; });
        // (a copy of its own, in that order: the one it had is left as it was, and put back after)
        const g2 = (geo as THREE.BufferGeometry).clone(); g2.userData = {}; g2.setIndex(new THREE.BufferAttribute(arr, 1));
        m.geometry = g2;
        this.undo.push(() => { if (m.geometry === g2) m.geometry = geo; g2.dispose(); });
        s.rev.push({ geo: g2, n });
      });
      if (!s.rev.length) s.o.traverse(o => { const mm = (o as THREE.Mesh).material as any; for (const m of Array.isArray(mm) ? mm : mm ? [mm] : []) if (!s.mats.some(q => q.m === m)) s.mats.push({ m, op: m.opacity ?? 1, tr: m.transparent }); });
    }
    if (!want.shapes) return;
    const structs = this.shapes.filter(s => s.struct).sort((a, b) => a.x - b.x);
    this.built.sort((a, b) => a.x - b.x);
    this.built = [...structs.map(s => ({ o: s.o, x: s.x, y: s.y, pts: s.pts.length >= 3 ? s.pts : undefined, e: -1 })), ...this.built];
  }

  /** The show's beats, in seconds: only the steps this site has anything for. */
  private beats() {
    const d = getDoc() as any, v = this.v;
    const hs = Object.values(d.terrainHeights ?? {}) as number[];
    let lo = 0, hi = 0; for (const h of hs) { if (h < lo) lo = h; if (h > hi) hi = h; }
    const nTrees = this.trees.length + (v.lidarState?.stand?.length ?? 0) || this.inst.reduce((s, q) => s + q.n, 0);
    const waters = this.shapes.filter(s => s.water).length, others = this.shapes.filter(s => !s.water && !s.struct).length;
    const structs = this.built.filter(b => b.pts).length;
    const want: [Step["id"], string, string, string, string, string, number, boolean][] = [
      ["trees", "trees", "Trees", "planting", "Planting the trees", nTrees.toLocaleString(), !HAND ? 2.4 : this.phone ? 4.0 : 4.65, this.trees.length + this.inst.length > 0],
      ["water", "water", "Water", "filling", "Filling the water", String(waters), HAND ? 1.3 : 0.8, waters > 0],
      ["paths", "paths", "Paths, roads and more", "drawing", "Drawing paths and roads", String(others), HAND ? 3.0 : 0.9, others > 0],
      ["build", "build", "Buildings and more", "placing", "Setting down the buildings", String(this.built.length), !HAND ? Math.min(1.4, 0.6 + structs * 0.25) : structs ? Math.min(3.4, 1.0 + structs * 0.6) : 1.1, this.built.length > 0]
    ];
    this.steps.push({ id: "ground", tool: "ground", name: "Ground", doing: "shaping", now: "Shaping the ground", val: `${Math.round(hi - lo)} ft of climb`, click: this.T.groundClick, from: this.T.rise[0], to: this.T.rise[1] });
    let t = HAND ? this.T.swoop[1] : this.T.rise[1];
    for (const [id, tool, name, doing, now, val, len, has] of want) {
      if (!has) continue;
      const click = t + (!HAND ? 0.1 : this.phone ? 2.5 : 0.6), lead = HAND ? 0.35 : 0.1; this.steps.push({ id, tool, name, doing, now, val, click, from: click + lead, to: click + lead + len }); t = click + lead + len;
    }
    if (!HAND) { t = Math.max(t, this.T.swoop[1]); this.T.sunClick = t + 0.3; this.T.sun = [t + 1e6, t + 2e6]; this.T.sunClose = t + 0.2; this.T.back = t + 0.2; this.T.end = t + 1.8; return; }
    if (this.phone) t += 1.4;
    this.T.sunClick = t + 0.7; this.T.sun = [t + 1.4, t + 4.7]; this.T.sunClose = t + 5.3; this.T.back = t + 5.6; this.T.end = t + 7.6;
  }
  private step(id: Step["id"]) { for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i].id === id) return this.steps[i]; return undefined; }
  /** The part in hand made whole and put by: the next one is built on its own. */
  private retire() {
    for (const tr of this.trees) { tr.o.visible = true; tr.o.scale.set(1, 1, 1); tr.o.updateMatrixWorld(true); }
    for (const q of this.inst) { (q.m.instanceMatrix.array as Float32Array).set(q.base); q.m.instanceMatrix.needsUpdate = true; }
    for (const s of this.shapes) { s.o.visible = true; for (const r of s.rev) { if (r.line) r.geo.instanceCount = r.max; else r.geo.setDrawRange(0, Infinity); } for (const q of s.mats) { q.m.transparent = q.tr; q.m.opacity = q.op; } }
    for (const s of this.built) { s.o.visible = true; s.o.scale.set(1, 1, 1); s.o.updateMatrixWorld(true); if (s.out) s.out.style.opacity = "0"; }
    this.was.push({ trees: this.trees, inst: this.inst, shapes: this.shapes, built: this.built });
    this.trees = []; this.inst = []; this.shapes = []; this.built = [];
  }

  /** A step joined on, starting a little after now (or after the one before it). */
  private appendStep(id: Step["id"], t: number) {
    const v = this.v, last = this.steps[this.steps.length - 1];
    const waters = this.shapes.filter(s => s.water).length, others = this.shapes.filter(s => !s.water && !s.struct).length, structs = this.built.filter(b => b.pts).length;
    const nTrees = this.trees.length + (v.lidarState?.stand?.length ?? 0) || this.inst.reduce((n, q) => n + q.n, 0);
    const def: Record<string, [string, string, string, string, string, number, boolean]> = {
      trees: ["trees", "Trees", "planting", "Planting the trees", nTrees.toLocaleString(), 4.65, this.trees.length + this.inst.length > 0],
      water: ["water", "Water", "filling", "Filling the water", String(waters), HAND ? 1.3 : 0.8, waters > 0],
      paths: ["paths", "Paths, roads and more", "drawing", "Drawing paths and roads", String(others), HAND ? 3.0 : 0.9, others > 0],
      build: ["build", "Buildings and more", "placing", "Setting down the buildings", String(this.built.length), !HAND ? Math.min(1.4, 0.6 + structs * 0.25) : structs ? Math.min(3.4, 1.0 + structs * 0.6) : 1.1, this.built.length > 0]
    };
    const [tool, name, doing, now, val0, len0, has] = def[id];
    if (!has) return;
    if (!HAND) {
      // (how many of it there are by now, with what came before)
      const n = id === "trees" ? nTrees : id === "water" ? waters : id === "paths" ? others : this.built.length;
      this.tally[id] = (id === "trees" && v.lidarState?.stand?.length ? 0 : this.tally[id] ?? 0) + n;
      const click = Math.max(t, last.to) + 0.15, len = id === "trees" ? 2.4 : len0;
      this.steps.push({ id, tool, name, doing, now, val: this.tally[id].toLocaleString(), click, from: click + 0.1, to: click + 0.1 + len });
      return;
    }
    const val = val0, len = len0;
    const click = Math.max(t + (this.live?.finalDone === false && id !== "trees" ? 0.9 : 0), last.to) + 1.0;
    this.steps.push({ id, tool, name, doing, now, val, click, from: click + 0.35, to: click + 0.35 + len });
  }

  /** A site coming in: the next part let in once the step in hand is done, the picture at rest. */
  private liveTick(t: number) {
    const L = this.live!;
    // (the import's own short pieces of work: let through while nothing is moving)
    if (L.waiters.length && (this.grounded ? !this.pending && t >= this.steps[this.steps.length - 1].to + 0.1 : this.groundAt === undefined || this.even < 4)) { const w = L.waiters.shift()!; w(); }
    // (the photo: laid on the ground the moment it's here, before anything moves; once the site
    // is moving it waits its turn like any other part, for a moment the picture is at rest)
    if (!this.grounded) { const pi = L.queue.findIndex(q => q.kind === "photo"); if (pi >= 0) { L.queue.splice(pi, 1)[0].apply(); if (this.revealAt === undefined) this.revealAt = t + 0.55; if (this.photoAt === undefined) this.photoAt = t + 0.2; } }
    if (!this.grounded) {
      // (before the ground: the photo laid down as soon as it's here, then the ground, which starts it all)
      const v = this.v;
      for (let i = L.queue.length - 1; i >= 0; i--) if (L.queue[i].kind === "sort") L.queue.splice(i, 1)[0].apply();
      const gi = this.groundAt === undefined ? L.queue.findIndex(q => q.kind === "ground") : -1;
      if (gi >= 0) { L.queue.splice(gi, 1)[0].apply(); this.groundAt = t; if (this.revealAt === undefined) this.revealAt = t + 0.35; }
      const inNow = this.groundAt !== undefined && t >= this.groundAt + 0.4 && ((Object.keys(getDoc().terrainHeights).length > 0 && (v.slowQueue?.size ?? 0) === 0 && v.doc?.heights === v.heightsRef) || t >= this.groundAt + 2.8);
      if ((inNow && (this.even >= 8 || t >= this.groundAt! + 3.2)) || (this.groundAt === undefined && L.queue.some(q => q.kind === "final"))) {
        const hs = Object.values(getDoc().terrainHeights ?? {}) as number[];
        let lo = 0, hi = 0; for (const h of hs) { if (h < lo) lo = h; if (h > hi) hi = h; }
        this.T.groundClick = t + 0.2; this.T.swoop = [t + 0.3, t + 3.8]; this.T.rise = [t + 0.5, t + 2.5];
        const g = this.steps[0]; g.click = t + 0.2; g.from = this.T.rise[0]; g.to = this.T.rise[1]; g.val = `${Math.round(hi - lo)} ft of climb`;
        this.grounded = true;
        say("playing", { steps: this.steps.map(s => s.id), seconds: this.T.end });
      }
      return;
    }
    if (this.pending && (this.even >= 10 || t >= this.pending.at + 3)) {
      const fin = this.pending.final; this.pending = null;
      for (const id of ["trees", "water", "paths", "build"] as const) this.appendStep(id, t);
      if (fin) {
        const end = Math.max(t, this.steps[this.steps.length - 1].to);
        this.T.sunClick = end + 0.3; this.T.sun = [end + BIG, end + 2 * BIG]; this.T.sunClose = end + 0.2; this.T.back = end + 0.2; this.T.end = end + 1.8;
        const d = this.realDoc;
        this.sunReal = { azimuth: d.sun?.azimuth ?? 225, altitude: d.sun?.altitude ?? 38, shadows: d.sun?.shadows ?? 0.65 };
        this.photoReal = d.background?.url ? (d.background.opacity ?? 1) : 0;
        L.finalDone = true;
      }
      say("playing", { steps: this.steps.map(s => s.id), seconds: this.T.end });
    }
    if (!this.absorbing && !this.pending && L.queue.length && t >= this.steps[this.steps.length - 1].to + 0.3) this.absorbing = { part: L.queue.shift()!, at: t + 0.5, applied: false };
    const a = this.absorbing;
    if (a && !a.applied && t >= a.at) {
      a.applied = true;
      if (a.part.kind === "sort") a.part.apply();
      else { this.awaiting = a.part.kind; a.part.apply(); }
    }
    // (sorting: at rest till what it makes is in, then that taken straight away)
    if (a && a.applied && a.part.kind === "sort") { const fi = L.queue.findIndex(q => q.kind === "final"); if (fi >= 0) this.absorbing = { part: L.queue.splice(fi, 1)[0], at: t, applied: false }; else if (t >= a.at + 15) this.absorbing = null; }
    // (a part that changed nothing the view draws: taken as in all the same)
    if (a && a.applied && this.awaiting && t >= a.at + 2.5) this.afterDoc();
    this.drift += ((a ? 0 : 1) - this.drift) * 0.14;
  }

  /** The course just took a part in: its things made at once, taken in hand and held back, its steps joined on. */
  private afterDoc() {
    const kind = this.awaiting, v = this.v, t = this.tNow;
    if (!kind) return;
    this.awaiting = null;
    for (let n = 0; n < 60 && (v.slowQueue?.size ?? 0) > 0; n++) v.drainSlow(1e9);
    if (kind === "photo") {
      const d = this.realDoc;
      this.photoReal = d.background?.url ? (d.background.opacity ?? 1) : 0;
      if (this.photoAt === undefined) this.photoAt = t + 0.45;
    } else if (!HAND && kind !== "ground") {
      // (each part built on its own: what was built before stays whole)
      // (held back at once; its steps begin a moment on, when the graphics card has what it needs
      // and the frames come evenly: nothing stutters as it comes up)
      this.retire();
      this.gather();
      this.even = 0;
      this.pending = { final: kind === "final", at: t };
    } else if (kind === "lidar") {
      this.gather({ trees: true, shapes: false });
      if (this.trees.length + this.inst.length) { this.appendStep("trees", t); this.treesPlayed = true; }
    } else if (kind === "final") {
      this.gather({ trees: !this.treesPlayed, shapes: true });
      for (const id of ["trees", "water", "paths", "build"] as const) if (id !== "trees" || !this.treesPlayed) this.appendStep(id, t);
      const end = Math.max(t, this.steps[this.steps.length - 1].to);
      this.T.sunClick = end + 0.7; this.T.sun = [end + 1.4, end + 4.7]; this.T.sunClose = end + 5.3; this.T.back = end + 5.6; this.T.end = end + 7.6;
      const d = this.realDoc;
      this.sunReal = { azimuth: d.sun?.azimuth ?? 225, altitude: d.sun?.altitude ?? 38, shadows: d.sun?.shadows ?? 0.65 };
      this.photoReal = d.background?.url ? (d.background.opacity ?? 1) : 0;
      this.live!.finalDone = true;
    }
    if (this.absorbing?.part.kind !== "sort") this.absorbing = null;
    this.treeKick = true; this.instDone = false;
    say("playing", { steps: this.steps.map(s => s.id), seconds: this.T.end });
    this.frame(t);
  }

  /** The hand, its ring, the buildings' outlines and the card. */
  private dress(name: string) {
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;z-index:9996;pointer-events:none");
    document.body.appendChild(svg); this.els.push(svg as unknown as HTMLElement);
    this.ring = document.createElementNS(NS, "polygon");
    this.ring.setAttribute("style", "fill:rgba(255,255,255,.07);stroke:#fff;stroke-width:1.6;stroke-opacity:.85;opacity:0");
    svg.appendChild(this.ring);
    if (this.noCover) {
      const vb = this.v.container.getBoundingClientRect(), inView = document.createElementNS(NS, "svg");
      for (const [k, val] of [["x", vb.left], ["y", vb.top], ["width", vb.width], ["height", vb.height]] as const) inView.setAttribute(k, String(val));
      inView.setAttribute("viewBox", `${vb.left} ${vb.top} ${vb.width} ${vb.height}`);
      svg.insertBefore(inView, this.ring);
      this.lid = document.createElementNS(NS, "path"); this.lid.setAttribute("style", "fill:#0b100a;stroke:none"); inView.appendChild(this.lid);
      this.lidEdge = document.createElementNS(NS, "path"); this.lidEdge.setAttribute("pathLength", "1"); this.lidEdge.setAttribute("style", "fill:rgba(162,207,106,.05);stroke:#a2cf6a;stroke-width:2;stroke-linejoin:round;filter:drop-shadow(0 0 10px rgba(162,207,106,.75))"); inView.appendChild(this.lidEdge);
    }
    for (const b of this.built) if (b.pts) { const p = document.createElementNS(NS, "path"); p.setAttribute("style", "fill:rgba(255,255,255,.12);stroke:#fff;stroke-width:2;stroke-linejoin:round;opacity:0"); p.setAttribute("pathLength", "1"); svg.appendChild(p); b.out = p; }
    this.cur = this.el("div", "position:fixed;left:0;top:0;z-index:9998;pointer-events:none;width:28px;height:28px;transform-origin:4px 3px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5));opacity:0;will-change:transform");
    this.cur.innerHTML = this.phone
      ? '<div style="width:38px;height:38px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,255,255,.34);box-shadow:inset 0 0 0 2px rgba(255,255,255,.9),0 2px 10px rgba(0,0,0,.35)"></div>'
      : '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2.5l15.5 8.2-6.6 1.9-2.6 6.6z" fill="#fff" stroke="#0b0f0a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    const box = this.v.container.getBoundingClientRect();
    this.curAt = { x: box.left + box.width * 0.56, y: box.top + box.height * 0.62 }; this.from = { ...this.curAt };
    this.card = this.el("div", `position:fixed;left:${box.left + 14}px;top:${box.top + 116}px;width:300px;z-index:9997;border-radius:22px;padding:16px 16px 14px;color:#f4f4f5;font:14px/1.35 system-ui,'Segoe UI',sans-serif;opacity:0;pointer-events:none`);
    if (this.phone) this.card.style.cssText += `;left:${box.left + 78}px;top:${box.top + 84}px;width:${Math.min(250, box.width - 78 - 62)}px;padding:10px 14px 11px;border-radius:18px`;
    // (a computer, with no hand acting it out: the card where the look-over's will be, and like it, so one becomes the other)
    else if (!HAND) this.card.style.cssText += `;left:16px;top:72px;width:344px;padding:16px;border-radius:22px;transition:transform .5s cubic-bezier(.2,.9,.3,1)`;
    this.card.className = "glass"; this.card.setAttribute("data-testid", "import-show-card"); this.card.setAttribute("role", "status");
    this.card.innerHTML = `${!HAND && !this.phone ? '<div style="font-size:10.5px;font-weight:700;letter-spacing:.08em;color:#a2cf6a;margin-bottom:8px">IMPORT</div>' : ""}<div style="font-weight:${!HAND && !this.phone ? "700;font-size:17px" : "650;font-size:15.5px"}" data-k="ttl"></div><div style="font-size:12.5px;color:#a1a1aa;margin-top:2px;min-height:17px" data-k="now"></div>
      <div style="height:5px;border-radius:5px;background:rgba(255,255,255,.1);margin:11px 0 8px;overflow:hidden" data-k="barbox"><i data-k="bar" style="display:block;height:100%;width:0;border-radius:5px;background:linear-gradient(90deg,#7fb24e,#a2cf6a)"></i></div>
      ${(this.live ? LIVE_ROWS : this.steps.map(s => [s.id, s.name])).map(([id, label]) => `<div data-row="${id}" style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13.5px;color:#71717a"><span data-dot style="width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;font-weight:700;color:#0c1209;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.14)"></span><span>${label}</span><span data-v style="margin-left:auto;font-size:13px;font-variant-numeric:tabular-nums"></span></div>`).join("")}`;
    (this.card.querySelector('[data-k="ttl"]') as HTMLElement).dataset.name = name;
    if (this.phone) { for (const r of Array.from(this.card.querySelectorAll<HTMLElement>("[data-row]"))) r.style.display = "none"; const tt = this.card.querySelector('[data-k="ttl"]') as HTMLElement, nw = this.card.querySelector('[data-k="now"]') as HTMLElement, bb = this.card.querySelector('[data-k="barbox"]') as HTMLElement; tt.style.cssText = "font-size:11.5px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"; nw.style.cssText = "font-size:14px;font-weight:650;color:#f4f4f5;margin-top:1px"; bb.style.margin = "8px 0 0"; }
    // (the names and signs over the map: held back till what they name is there)
    const layer = this.v.container.querySelector(".dg-layer") as HTMLElement | null;
    if (layer) { this.labels = [layer]; const vis = layer.style.visibility, op = layer.style.opacity; this.undo.push(() => { layer.style.visibility = vis; layer.style.opacity = op; }); }
    // (the sky's own light on things is worked out once the sun is back where it belongs, not at
    // every step of its way across: each working-out is a tenth of a second the picture stands still)
    { const v2 = this.v, own = Object.prototype.hasOwnProperty.call(v2, "updateSkyEnv") ? v2.updateSkyEnv : undefined; v2.updateSkyEnv = () => {}; this.undo.push(() => { if (own) v2.updateSkyEnv = own; else delete v2.updateSkyEnv; }); }
    // (nor a new photo of the sky fetched and sent to the graphics card part-way across)
    { const v2 = this.v, own = Object.prototype.hasOwnProperty.call(v2, "photoSkyFor") ? v2.photoSkyFor : undefined; v2.photoSkyFor = () => {}; this.undo.push(() => { if (own) v2.photoSkyFor = own; else delete v2.photoSkyFor; }); }
    // (whatever the app hands the view meanwhile, the show's sun and ground stay the show's)
    const v = this.v, had = Object.prototype.hasOwnProperty.call(v, "setDoc") ? v.setDoc : undefined, set = v.setDoc.bind(v);
    v.setDoc = (doc: any) => { this.realDoc = doc; if (this.live && !HAND) this.photoReal = doc.background?.url ? (doc.background.opacity ?? 1) : 0; set(this.dressed(doc)); if (this.live) this.afterDoc(); };
    this.undo.push(() => { if (had) v.setDoc = had; else delete v.setDoc; set(this.realDoc); });
  }
  private dressed(doc: any) {
    return { ...doc, ...(this.sunSet ? { sun: { ...(doc.sun ?? {}), ...this.sunSet } } : {}), background: { ...doc.background, opacity: doc.background?.url ? this.photoNow : doc.background?.opacity } };
  }

  private frame(t: number) {
    const v = this.v, T = this.T, W = this.W, H = this.H;
    this.frameN++;
    if (this.extras?.visible) this.extras.visible = false;
    let shade = false;
    // the footprint: its edge drawn round, breathing while the first of the site is fetched; then it lifts
    if (this.lid && this.lidEdge) {
      const c = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => this.screenOf(x, y, 0.5)), d = "M" + c.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L") + "Z";
      const gone = this.revealAt === undefined ? 0 : io((t - this.revealAt) / 1.1), edge = this.revealAt === undefined ? 1 : 1 - io((t - this.revealAt - 0.5) / 1.4);
      this.lid.setAttribute("d", d); this.lid.style.opacity = String(1 - gone);
      this.lidEdge.setAttribute("d", d); if (this.lidFrom === undefined && (this.even >= 6 || t > 2.2)) this.lidFrom = t;
      this.lidEdge.setAttribute("stroke-dasharray", `${this.lidFrom === undefined ? 0 : io((t - this.lidFrom) / 1.2)} 1`); this.lidEdge.style.opacity = String((0.72 + 0.28 * Math.sin(t * 2.6)) * edge);
      if (edge <= 0.001) { this.lid.remove(); this.lidEdge.remove(); this.lid = this.lidEdge = null; }
    }
    // the cover lifts off the photo, seen straight down
    const cv = this.noCover ? 0 : 1 - io(t / T.cover);
    this.cover.style.opacity = String(cv); this.cover.style.display = cv <= 0.001 ? "none" : "grid";
    // the camera: one move, down from overhead and on round the site, lower at the end to take in the sky
    const k = io((t - T.swoop[0]) / (T.swoop[1] - T.swoop[0])), a = this.cam.from, b = this.cam.to;
    const low = io((t - T.sun[0] + 0.8) / (T.sun[1] - T.sun[0] + 0.8));
    let on = io((t - T.swoop[1] + 0.6) / (T.end - 1.6 - T.swoop[1] + 0.6));
    if (this.live) {
      // (a site coming in: round it at an even pace for as long as it takes, at rest while a part is let in and at the end)
      const dtc = cl(t - this.lastCam, 0, 0.1); this.lastCam = t;
      this.liveAz += 0.034 * dtc * this.drift * io((t - T.swoop[1] + 0.6) / 1.5) * (1 - io((t - T.end + 2.6) / 1.6));
      on = this.liveAz / this.cam.orbit;
    }
    this.camTo(lerp(a.az, b.az, k) + on * this.cam.orbit, lerp(a.polar, b.polar, k) + low * this.cam.lower, lerp(a.dist, b.dist, k) * (1 - 0.1 * on - 0.1 * low), lerp(a.tx, b.tx, k), 30 * k + 60 * low, lerp(a.tz, b.tz, k));
    // the sun: a low morning light while it's built, across the sky, then back to the course's own
    {
      const u = io((t - T.sun[0]) / (T.sun[1] - T.sun[0])), home = io((t - T.back) / (T.end - T.back - 0.3));
      const bearing = lerp(lerp(104, 256, u), this.sunReal.azimuth, home), alt = lerp(lerp(21, 11, u) + 30 * Math.sin(Math.PI * u), this.sunReal.altitude, home);
      if (!this.sunSet || Math.abs(bearing - this.sunSet.azimuth) > 0.02 || Math.abs(alt - this.sunSet.altitude) > 0.02) shade = true;
      this.sunSet = { azimuth: bearing, altitude: alt, shadows: lerp(0.62, this.sunReal.shadows, home) };
      v.doc = { ...v.doc, sun: { ...(v.doc.sun ?? {}), ...this.sunSet } };
      v.placeSun();
      if (v.haze) { v.haze.density = 0.00021 * k * (1 - home); const hz = v.skyBox?.material?.uniforms?.uHaze?.value; if (hz) v.haze.color.copy(hz); }
      // the photo on the ground through the swoop, the course's own ground while it's built, the photo back at the end
      const x = HAND ? Math.max((1 - io((t - T.rise[0] - 0.7) / (T.rise[1] - T.rise[0] - 0.2))) * this.photoReal, home * this.photoReal) : this.photoReal * (this.photoAt === undefined ? 1 : io((t - this.photoAt) / 0.9)), g = v.ground, mat = g.mapPlane?.material;
      if (Math.abs(x - this.photoNow) > 0.0005 || this.frameN === 1) { this.photoNow = x; g.bgOpacity = x; if (mat && g.photo && !g.painted) { mat.opacity = x; mat.visible = x > 0.001; } }
    }
    if (!this.tipped && k > 0.45) { this.tipped = true; useEditor.getState().set({ view: "3d" } as any); }
    // the ground comes up
    const rise = 0.0001 + 0.9999 * io((t - T.rise[0]) / (T.rise[1] - T.rise[0]));
    if (v.ground.group.scale.y !== rise) { v.ground.group.scale.y = rise; v.ground.group.updateMatrixWorld(true); shade = true; }
    // the trees, each as the hand reaches its stand: up out of the ground
    const ts = this.step("trees"), tp = ts ? (t - ts.from) / (ts.to - ts.from) : 2, span = 0.13;
    const growing = tp > -0.05 && tp < 1.05;
    // (a rush of air as they come up)
    if (!HAND && ts && ts !== this.rushFor && t >= ts.from && t < ts.to) { this.rushFor = ts; playTreesSound((ts.to - ts.from) / this.speed); }
    if (growing || this.frameN === 1 || this.treeKick || (tp >= 1.05 && this.trees[0]?.s !== 1 && this.trees.length)) {
      for (const tr of this.trees) { const s = out((tp - tr.at * (1 - span)) / span); if (s === tr.s) continue; tr.s = s; tr.o.visible = s > 0.001; tr.o.scale.set(0.35 + 0.65 * s, Math.max(0.0001, s), 0.35 + 0.65 * s); tr.o.updateMatrixWorld(true); }
    }
    if (growing || this.frameN === 1 || this.treeKick || (tp >= 1.05 && !this.instDone)) {
      for (const q of this.inst) {
        const arr = q.m.instanceMatrix.array as Float32Array;
        for (let i = 0; i < q.n; i++) { const s = Math.max(0.0001, out((tp - q.at[i] * (1 - span)) / span)), w2 = s < 0.001 ? 0.0001 : 0.35 + 0.65 * s, o = i * 16;
          for (let c = 0; c < 12; c++) arr[o + c] = q.base[o + c] * (c >= 4 && c < 8 ? s : w2); }
        q.m.instanceMatrix.needsUpdate = true;
      }
      this.instDone = tp >= 1.05;
      this.treeKick = false;
      if (this.frameN % 2 === 0 || !growing) shade = true;
    }
    // the water runs down its bed; then each path, road and area is drawn along its length
    const ws = this.step("water"), ps = this.step("paths");
    const wp = ws ? (t - ws.from) / (ws.to - ws.from) : 2, pp = ps ? (t - ps.from) / (ps.to - ps.from) : 2;
    for (const s of this.shapes) {
      if (s.struct) continue;
      const tr = this.traced.get(s), last = this.pathPath.length - 1;
      const p = s.water ? io(wp) : tr ? cl((io(pp) * last - tr[0]) / Math.max(1, tr[1] - tr[0])) : out((io(pp) - s.at * 0.88) / 0.12);
      if (p === s.p) continue;
      s.p = p; s.o.visible = p > 0.002;
      for (const r of s.rev) { if (r.line) r.geo.instanceCount = Math.max(0, Math.round((r.max ?? 0) * p)); else r.geo.setDrawRange(0, 3 * Math.round((r.n ?? 0) * p)); }
      for (const q of s.mats) { q.m.transparent = p < 1 ? true : q.tr; q.m.opacity = q.op * p; }
    }
    // buildings: each drawn on the ground by its outline, then lifted; what stands beside them after
    const bs = this.step("build"), bp = bs ? (t - bs.from) / (bs.to - bs.from) : 2;
    let drawing: { s: ImportShow["built"][number]; line: number } | null = null, acc = 0;
    const wOf = (s: ImportShow["built"][number]) => (s.pts ? 1 : 0.25), total = this.built.reduce((n, s) => n + wOf(s), 0);
    for (const s of this.built) {
      const w2 = wOf(s), q = (bp * (total + 0.5) - acc) / w2, line = s.pts ? cl(q / 0.5) : 1, e = out((q - (s.pts ? 0.5 : 0)) / 0.8); acc += w2;
      if (e !== s.e) { s.e = e; s.o.visible = e > 0.001; s.o.scale.set(1, Math.max(0.0001, e), 1); s.o.updateMatrixWorld(true); shade = true; }
      if (s.out) { const on2 = HAND && q > 0 && e < 1; s.out.style.opacity = on2 ? String(1 - cl((e - 0.5) / 0.5)) : "0"; if (on2) { s.out.setAttribute("d", "M" + s.pts!.map(p => { const c = this.screenOf(p.x, p.y, 1.5); return `${c.x.toFixed(1)} ${c.y.toFixed(1)}`; }).join("L") + "Z"); s.out.setAttribute("stroke-dasharray", `${line} 1`); s.out.style.fillOpacity = line >= 1 ? "1" : "0"; } }
      if (q > 0 && q < 1 && !drawing) drawing = { s, line };
    }
    for (const el of this.labels) { const at = bs ? bs.to - 0.5 : T.sunClick - 0.6; el.style.visibility = t >= at ? "" : "hidden"; el.style.opacity = String(io((t - at) / 0.6)); }

    const lastStep = this.steps[this.steps.length - 1];
    // the hand (only where it's asked for: the parts come in on their own otherwise)
    if (!HAND) { this.cur.style.opacity = "0"; this.ring.style.opacity = "0"; }
    else {
    let to: P | null = null, press = 0, pick: string | null = null, ringAt: { x: number; y: number; r: number } | null = null, onTool = false, working = false;
    const goTo = (target: P | null, at: number, lead = 0.85, key = "") => { if (t < at - lead || t >= at + 0.3) return false; if (key) { const had = this.aims.get(key); if (had) target = had; else if (target) this.aims.set(key, { x: target.x, y: target.y }); } if (!target) return false; const u = io((t - (at - lead)) / lead); to = { x: lerp(this.from.x, target.x, u), y: lerp(this.from.y, target.y, u) }; if (t >= at) press = 1 - (t - at) / 0.3; return true; };
    if (this.phone) {
      // (the tool in hand put down with Done, unhurried)
      for (const s of this.steps) { const at = s.to + 0.85; if (!this.put.has(s.id) && goTo(this.doneBtn(), at, 0.8, `done:${s.id}`)) { onTool = true; if (t >= at) { this.put.add(s.id); this.picked = "select"; this.doneBtn()?.el.click(); } break; } }
      // (the tools' row slid to the next one, by the show's own clock, before the hand sets off for it)
      for (const s of this.steps) if (t >= s.click - 1.55 && !this.slid.has(s.tool)) {
        const el = document.querySelector<HTMLElement>(`[data-tool="${s.tool}"]`);
        if (!el) continue;
        this.slid.add(s.tool);
        let box: HTMLElement | null = el.parentElement;
        while (box && box.scrollWidth <= box.clientWidth + 2) box = box.parentElement;
        if (box) { const a2 = el.getBoundingClientRect(), b2 = box.getBoundingClientRect(); this.slides.push({ box, from: box.scrollLeft, to: Math.max(0, Math.min(box.scrollWidth - box.clientWidth, box.scrollLeft + (a2.left + a2.width / 2) - (b2.left + b2.width / 2))), t0: t }); }
      }
      for (const sl of this.slides) { const u = (t - sl.t0) / 0.6; if (u <= 1.1 && sl.box.isConnected) sl.box.scrollLeft = lerp(sl.from, sl.to, io(u)); }
    }
    if (!onTool) for (const s of this.steps) if (goTo(this.tool(s.tool), s.click, 0.85, `tool:${s.id}`)) { onTool = true; if (t >= s.click) pick = s.tool; break; }
    const sb = document.querySelector<HTMLElement>('[data-testid="scene-button"]');
    if (!onTool && sb && !this.scene.open) { const r = sb.getBoundingClientRect(); if (goTo({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, T.sunClick)) { onTool = true; if (t >= T.sunClick) { this.scene.open = true; this.pick("select"); sb.click(); } } }
    if (this.scene.open && !this.scene.sl && !this.scene.shut) this.findSun();
    if (!onTool && sb && this.scene.open && !this.scene.shut) { const r = sb.getBoundingClientRect(); if (goTo({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, T.sunClose, 0.6)) { onTool = true; if (t >= T.sunClose) this.shutScene(); } }
    if (!onTool) {
      const gs = this.steps[0];
      if (ts && t >= ts.from - 0.3 && t < ts.to) { const p = onPath(this.treePath, tp + 0.012); to = this.screenOf(p.x, p.y, 70); working = t >= ts.from; if (t >= ts.from) ringAt = { x: p.x, y: p.y, r: this.span * 0.07 }; }
      else if (ws && this.waterPath.length && t >= ws.from - 0.2 && t < ws.to) { const p = onPath(this.waterPath, io(wp)); to = this.screenOf(p.x, p.y); working = t >= ws.from; if (t >= ws.from) ringAt = { x: p.x, y: p.y, r: 38 }; }
      else if (ps && t >= ps.from - 0.2 && t < ps.to) { const p = onPath(this.pathPath, io(pp)); to = this.screenOf(p.x, p.y); working = t >= ps.from; }
      else if (bs && t >= bs.from - 0.2 && t < bs.to && this.built.length) { const d2: { s: ImportShow["built"][number]; line: number } = drawing ?? { s: this.built[t < bs.from ? 0 : this.built.length - 1], line: 0 }; if (d2.s.pts && d2.line < 1) { const p = onPath([...d2.s.pts, d2.s.pts[0]], d2.line); to = this.screenOf(p.x, p.y, 2); press = 0.6; working = true; } else { to = this.screenOf(d2.s.x, d2.s.y, 2); press = d2.s.pts ? 0 : 0.6; } }
      else if (t >= T.cover && t < gs.to + 0.1) { const u = cl((t - gs.from) / (gs.to - gs.from)), a2 = u * 7.2, gx = W * (0.5 + 0.27 * Math.sin(a2) * (0.4 + 0.6 * u)), gy = H * (0.52 + 0.22 * Math.cos(a2 * 0.5) * (0.4 + 0.6 * u)); to = this.screenOf(gx, gy, 4); if (t >= gs.from && t < gs.to) ringAt = { x: gx, y: gy, r: this.span * 0.085 }; }
      else if (this.scene.sl && t >= T.sunClick + 0.3 && t < T.sunClose - 0.6) {
        // (dragging the Sun slider across: the slider itself moved, as someone would)
        const sl = this.scene.sl, r = sl.getBoundingClientRect(), u = io((t - T.sun[0]) / (T.sun[1] - T.sun[0])), f = 0.08 + 0.84 * u;
        to = { x: r.left + 8 + (r.width - 16) * f, y: r.top + r.height / 2 + 1 }; press = t >= T.sun[0] - 0.1 && t < T.sun[1] ? 0.6 : 0;
        if (sl.isConnected && t < T.sun[1]) { const lo = +sl.min, hi = +sl.max, val = String(Math.round((lo + (hi - lo) * f) * 4) / 4); if (val !== this.scene.val) { this.scene.val = val; this.slide(sl, val); } }
        this.onThumb = t >= T.sun[0];
      }
    }
    const dt = cl(t - this.lastT, 0, 0.1); this.lastT = t;
    if (to) {
      const goal = to as P;
      if (onTool || (this.onThumb && t < T.sun[1] + 0.2 && Math.hypot(goal.x - this.curAt.x, goal.y - this.curAt.y) < 10)) { this.curAt = { x: goal.x, y: goal.y }; this.vel = { x: 0, y: 0 }; }
      else {
        // (working: close on its heels; between: an easy glide)
        const near = working && Math.hypot(goal.x - this.curAt.x, goal.y - this.curAt.y) < 60;
        this.smooth += ((near ? 0.07 : this.phone ? 0.3 : 0.26) - this.smooth) * (near ? 0.2 : 1);
        const st = this.smooth, om = 2 / st, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        for (const ax of ["x", "y"] as const) { const ch = this.curAt[ax] - goal[ax], tmp = (this.vel[ax] + om * ch) * dt; this.vel[ax] = (this.vel[ax] - om * tmp) * ex; this.curAt[ax] = goal[ax] + (ch + tmp) * ex; }
      }
      if (working) { const w2 = window as any, lag = Math.hypot(goal.x - this.curAt.x, goal.y - this.curAt.y); if (this.smooth > 0.1) this.lagFrom = undefined; else if (this.lagFrom === undefined) this.lagFrom = t; if (this.lagFrom !== undefined && t > this.lagFrom + 0.3) w2.__dgImportShow.lag = Math.max(w2.__dgImportShow.lag ?? 0, lag); } else this.lagFrom = undefined;
    } else this.vel = { x: 0, y: 0 };
    if (!onTool) this.from = { ...this.curAt };
    this.cur.style.transform = `translate(${this.curAt.x - 4}px, ${this.curAt.y - 3}px) scale(${1 - (this.phone ? 0.28 : 0.14) * cl(press)})`;
    this.cur.style.opacity = t < T.cover * 0.6 || t > T.sunClose + 0.5 ? "0" : "1";
    if (pick) this.pick(pick);

    if (t > lastStep.to + 0.25 && !this.scene.open) this.pick("select");
    // (the ring eases to where the hand works, and fades when it lifts)
    this.ringO += ((ringAt ? 1 : 0) - this.ringO) * 0.25;
    const ra = ringAt as { x: number; y: number; r: number } | null;
    if (ra) this.ringW = this.ringW ? { x: this.ringW.x + (ra.x - this.ringW.x) * 0.6, y: this.ringW.y + (ra.y - this.ringW.y) * 0.6, r: this.ringW.r + (ra.r - this.ringW.r) * 0.2 } : { ...ra };
    if (this.ringW && this.ringO > 0.02) { const pts: string[] = []; for (let i = 0; i < 32; i++) { const q = this.screenOf(this.ringW.x + this.ringW.r * Math.cos((i / 32) * 6.2832), this.ringW.y + this.ringW.r * Math.sin((i / 32) * 6.2832), 3); pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`); } this.ring.setAttribute("points", pts.join(" ")); }
    this.ring.style.opacity = this.ringO < 0.02 ? "0" : String(this.ringO);
    }

    // the card
    const c = this.card, q = (k2: string) => c.querySelector(`[data-k="${k2}"]`) as HTMLElement, done = t >= lastStep.to && (!this.live || this.live.finalDone), name = q("ttl").dataset.name;
    c.style.opacity = String(io((t - T.cover + 0.2) / 0.6) * (1 - io((t - T.end + 1.0) / 0.8)));
    c.style.display = this.scene.open && !this.scene.shut ? "none" : "";
    const curStep = this.steps.find(s => t < s.to);
    q("ttl").textContent = `Bringing in ${name}`;
    q("now").textContent = done ? (HAND ? "The light through the day" : "Putting it together") : curStep && t >= curStep.from ? curStep.now : this.live && (!curStep || !HAND) ? this.live.text || "Fetching the rest…" : "…";
    q("bar").style.width = `${(this.live && !this.live.finalDone ? cl(this.live.fraction) * 0.85 : cl((t - T.cover) / (lastStep.to - T.cover))) * 100}%`; q("barbox").style.display = done ? "none" : "";
    c.querySelectorAll<HTMLElement>("[data-row]").forEach(row => { const ss = this.steps.filter(x => x.id === row.dataset.row);
      if (!ss.length) return;
      // (a part that came in more than once: at work while any of it is, done once the last is)
      const s = ss.find(x => t >= x.from && t < x.to) ?? [...ss].reverse().find(x => t >= x.to) ?? ss[0];
      const on2 = t >= s.from && t < s.to, dn = !on2 && t >= s.to, dot = row.querySelector("[data-dot]") as HTMLElement, vv = row.querySelector("[data-v]") as HTMLElement;
      row.style.color = on2 ? "#fafafa" : dn ? "#e4e4e7" : "#71717a"; dot.textContent = dn ? "✓" : ""; dot.style.background = dn ? "#a2cf6a" : "none"; dot.style.boxShadow = dn ? "none" : on2 ? "inset 0 0 0 2px #a2cf6a" : "inset 0 0 0 1.5px rgba(255,255,255,.14)";
      vv.textContent = on2 ? s.doing : dn ? s.val : ""; vv.style.color = on2 ? "#a2cf6a" : "#a1a1aa"; vv.style.fontWeight = on2 ? "600" : "400"; });
    if (shade && (!this.phone || this.frameN % 3 === 0)) v.shadowsDirty = true;
    v.dirty = true;
  }
  private instDone = false;
  private rushFor: Step | null = null;
  /** How many frames in a row came on time (the graphics card done with what it had to make ready). */
  private even = 0;
  /** A part taken in, its things held back: its steps begin once the frames come evenly. */
  private pending: { final: boolean; at: number } | null = null;
  private lidFrom: number | undefined;
  private lastCam = 0;
  private vel = { x: 0, y: 0 };
  private smooth = 0.3;
  private lagFrom: number | undefined;
  private lastT = 0;
  private tipped = false;
  private onThumb = false;

  private pick(id: string) {
    if (this.picked === id) return;
    this.picked = id;
    const t = this.tool(id);
    if (t) t.el.click();
    else if (id === "select") { const d = this.doneBtn(); if (d) d.el.click(); else useEditor.getState().set({ tool: "select" } as any); }
  }
  /** View's "Sun from the" slider, the rest of the panel out of the way while it's dragged. */
  private findSun() {
    const box = document.querySelector<HTMLElement>('[data-testid="view-light"]');
    const sl = box?.querySelector<HTMLInputElement>('input[type="range"][aria-label="Sun from the"]');
    if (!box || !sl) return;
    const hide = (el: HTMLElement) => { this.scene.hidden.push({ el, d: el.style.display }); el.style.display = "none"; };
    for (const c of Array.from(box.children) as HTMLElement[]) if (!/Sun /.test(c.textContent ?? "")) hide(c);
    for (let e: HTMLElement | null = box; e?.parentElement && !/overflow-y-auto/.test(e.className || ""); e = e.parentElement) for (const sib of Array.from(e.parentElement.children) as HTMLElement[]) if (sib !== e) hide(sib);
    // (a stand-in of the slider's own row is the one dragged: the course's settings are never touched,
    // and nothing is made again as it moves)
    const row = sl.parentElement as HTMLElement, twin = row.cloneNode(true) as HTMLElement;
    row.after(twin); hide(row);
    this.scene.twin = twin;
    this.scene.sl = twin.querySelector<HTMLInputElement>('input[type="range"]')!;
    this.scene.sl.setAttribute("step", "any");
  }
  private slide(sl: HTMLInputElement, val: string) {
    sl.value = val;
    // (its filled part follows, however the app's own slider draws it)
    const pct = `${((+val - +sl.min) / (+sl.max - +sl.min || 1)) * 100}%`;
    for (let i = 0; i < sl.style.length; i++) { const k = sl.style[i]; if (k.startsWith("--")) sl.style.setProperty(k, pct); }
    const lab = sl.parentElement?.querySelector("span.tabular-nums");
    if (lab && this.sunSet) lab.textContent = COMPASS[Math.round(this.sunSet.azimuth / 45) % 8];
  }
  /** View closed again, its slider and the course's own sun as they were. */
  private shutScene() {
    if (!this.scene.open || this.scene.shut) return;
    this.scene.shut = true;
    const sl = this.scene.sl;
    void sl;
    this.scene.twin?.remove();
    for (const h of this.scene.hidden) h.el.style.display = h.d;
    document.querySelector<HTMLElement>('[data-testid="scene-button"]')?.click();
  }

  /** Everything as it is without the show (at its end, skipped, or stopped by anything). */
  restore() {
    const v = this.v;
    try { this.shutScene(); } catch { /* the panel's gone */ }
    if (this.picked !== "select") { try { this.pick("select"); } catch { /* no toolbar */ } }
    // (left in 3D, where it ended: looking straight down at its start had the app call the view 2D)
    useEditor.getState().set({ view: "3d" } as any);
    if (v.disposed) { for (const e of this.els) e.remove(); return; }
    v.ground.group.scale.y = 1; v.ground.group.updateMatrixWorld(true);
    this.retire();
    if (v.haze) v.haze.density = 0;
    this.sunSet = null; this.photoNow = this.photoReal;
    for (const u of this.undo.reverse()) { try { u(); } catch (err) { console.warn(err); } }
    this.undo = [];
    v.shadowsDirty = true; v.dirty = true;
    const fade = this.els.filter(e => e !== this.cover);
    for (const e of fade) { e.style.transition = "opacity .4s"; e.style.opacity = "0"; e.style.pointerEvents = "none"; }
    this.cover?.remove();
    setTimeout(() => { for (const e of fade) e.remove(); }, 450);
  }
}
