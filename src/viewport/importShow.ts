// A site just brought in, built in front of you: the 3D view starts straight down over the photo,
// swoops into 3D as the ground rises, and a hand picks the app's own tools in turn and plants the
// trees, runs the water down its bed, draws the paths and roads, sets down the buildings, then
// opens View and carries the sun across the sky. Everything it shows is the course as it already
// is: the scene is whole before it starts (so nothing is made while it plays), each part only
// held back and let in, and all of it is put back exactly when it ends or is skipped.
import * as THREE from "three";
import { forestDetail } from "../three/treeKit";
import { getView } from "../state/view";
import { getDoc, useEditor } from "../state/course";

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

type Step = { id: "ground" | "trees" | "water" | "paths" | "build"; tool: string; name: string; doing: string; now: string; val: string; click: number; from: number; to: number };

/** Plays the show on the course just brought in (a first site, on a computer with a graphics card;
 * anywhere else, or with motion reduced, nothing happens). Resolves when it's over. */
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
  if (!v?.doc || (!opts.force && (v.software || v.mobile || reduced || doc.holes.length > 0))) { say("skipped"); return; }
  const show = new ImportShow(v, speed);
  try { await show.run(); } catch (err) { console.warn("Import show stopped", err); } finally { show.restore(); say("done"); }
}
if (typeof window !== "undefined") (window as any).__dgImportShow = { state: "idle", play: (force = true) => playImportShow({ force }) };

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
  private steps: Step[] = [];
  private T = { cover: 1.0, groundClick: 1.6, swoop: [1.9, 6.5], rise: [2.3, 6.1], sunClick: 0, sun: [0, 0], sunClose: 0, back: 0, end: 0 };
  private cam!: { from: any; to: any; orbit: number; lower: number };
  private sunSet: { azimuth: number; altitude: number; shadows: number } | null = null;
  private sunReal: { azimuth: number; altitude: number; shadows: number };
  private photoReal: number; private photoNow: number;
  private realDoc: any;
  private picked = "select";
  private scene: { open: boolean; shut: boolean; sl?: HTMLInputElement; twin?: HTMLElement; val?: string; hidden: { el: HTMLElement; d: string }[] } = { open: false, shut: false, hidden: [] };
  private labels: HTMLElement[] = [];
  private frameN = 0;

  constructor(private v: any, private speed: number) {
    const d = v.doc;
    this.W = d.canvas.width; this.H = d.canvas.height; this.span = Math.max(this.W, this.H);
    this.realDoc = d;
    this.sunReal = { azimuth: d.sun?.azimuth ?? 225, altitude: d.sun?.altitude ?? 38, shadows: d.sun?.shadows ?? 0.65 };
    this.photoReal = this.photoNow = d.background?.url ? (d.background.opacity ?? 1) : 0;
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
    return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 - 3, el } : null;
  }
  private camTo(az: number, polar: number, dist: number, tx: number, ty: number, tz: number) {
    void this.v.controls.setLookAt(tx + dist * Math.sin(polar) * Math.sin(az), ty + dist * Math.cos(polar), tz + dist * Math.sin(polar) * Math.cos(az), tx, ty, tz, false);
  }

  async run() {
    const v = this.v, name = String(getDoc().name).replace(/ Disc Golf Course$/, "");
    // --- a cover while the scene is made whole (its trees and woods), then lifted as the show starts
    const box = v.container.getBoundingClientRect();
    this.cover = this.el("div", `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:9990;background:#141b12;display:grid;place-items:center;color:#e4e4e7;font:600 15px system-ui,'Segoe UI',sans-serif;border-radius:inherit`);
    this.cover.setAttribute("data-testid", "import-show-cover");
    this.cover.textContent = `Putting ${name} together…`;
    // (nothing of the map is worked while it plays; a click anywhere, or Esc, skips it)
    const shield = this.el("div", "position:fixed;inset:0;z-index:9995;cursor:default");
    shield.setAttribute("data-testid", "import-show");
    const skip = this.el("button", "position:fixed;right:24px;bottom:24px;z-index:9999;height:36px;padding:0 16px;border-radius:999px;border:0;background:rgba(20,28,18,.72);color:#f4f4f5;font:650 13px system-ui,'Segoe UI',sans-serif;backdrop-filter:blur(14px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);cursor:pointer");
    skip.textContent = "Skip"; skip.setAttribute("data-testid", "import-show-skip");
    const stop = () => { this.stopped = true; };
    skip.onclick = stop;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); stop(); } };
    window.addEventListener("keydown", onKey, true);
    this.undo.push(() => window.removeEventListener("keydown", onKey, true));
    const ctl = v.controls.enabled; v.controls.enabled = false;
    this.undo.push(() => { v.controls.enabled = ctl; });
    // (no stepping the quality down for the show's own frames)
    v.settleUntil = performance.now() + 120000;
    this.undo.push(() => { v.settleUntil = performance.now() + 2500; });

    // --- the camera's way: straight down over the site to start, a low view round it to end
    const span = this.span, cx = this.W / 2, cy = this.H / 2;
    const fov = ((v.camera.fov ?? 30) * Math.PI) / 180, aspect = box.width / box.height;
    const top = Math.max(this.H / 2 / Math.tan(fov / 2), this.W / 2 / (Math.tan(fov / 2) * aspect)) * 1.45;
    this.cam = { from: { az: 0, polar: 0.0015, dist: top, tx: cx, tz: cy }, to: { az: -0.55, polar: 1.17, dist: span * 1.12, tx: cx - this.W * 0.03, tz: cy + this.H * 0.02 }, orbit: 0.85, lower: 0.1 };
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
    this.gather();
    this.beats();
    this.dress(name);
    say("playing", { steps: this.steps.map(s => s.id), seconds: this.T.end });
    // --- played by the clock (a late frame only shows a later moment: nothing is skipped over)
    const t0 = performance.now();
    await new Promise<void>(done => {
      const tick = () => {
        const t = ((performance.now() - t0) / 1000) * this.speed;
        if (this.stopped || v.disposed || t >= this.T.end) { done(); return; }
        this.frame(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** What the show holds back and lets in: the trees, the water, paths and other shapes, the buildings. */
  private gather() {
    const v = this.v, d = getDoc(), W = this.W, H = this.H, span = this.span;
    for (const it of d.items as any[]) {
      const e = v.objects.get(it.id);
      if (!e) continue;
      if (it.type === "tree") this.trees.push({ o: e.obj, x: it.x, y: it.y, at: 0, s: -1 });
      else if (it.type === "amenity") this.built.push({ o: e.obj, x: it.x, y: it.y, e: -1 });
    }
    // (the woods' and the measured trees: each one's own place kept, to grow it by; held as they are)
    for (const g of v.itemsGroup.children as THREE.Object3D[]) {
      const f = g.userData.forest;
      if (!f) continue;
      const was = Object.prototype.hasOwnProperty.call(f, "update") ? f.update : undefined;
      f.update = () => {};
      this.undo.push(() => { if (was) f.update = was; else delete f.update; });
      g.traverse(o => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && m.count > 0) this.inst.push({ m, base: Float32Array.from(m.instanceMatrix.array.subarray(0, m.count * 16)), n: m.count, at: new Float32Array(m.count) }); });
    }
    this.undo.push(() => { forestDetail.version++; });
    for (const [key, e] of v.shapes as Map<string, { obj: THREE.Object3D }>) {
      const kind = key.split(":")[0], it = (d.items as any[]).find(i => i.id === key.split(":")[1]);
      if (!it || !(kind === "area" || kind === "line" || kind === "struct")) continue;
      if (it.type === "area" && it.kind === "woods") { const o = e.obj, vis = o.visible; o.visible = false; this.undo.push(() => { o.visible = vis; }); continue; }
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
    for (let k = 0; k <= 40; k++) { const u = k / 40; this.pathPath.push({ x: W * (0.9 - 0.8 * u), y: H * (0.3 + 0.36 * u + 0.16 * Math.sin(u * 9)) }); }
    // when the hand reaches each thing (no two trees up together)
    const reach = (path: P[], x: number, y: number, R: number) => { let best = 1, bd = Infinity; for (let i = 0; i < path.length; i++) { const dd = Math.hypot(path[i].x - x, path[i].y - y); if (dd < R) return i / Math.max(1, path.length - 1); if (dd < bd) { bd = dd; best = i / Math.max(1, path.length - 1); } } return best; };
    const rnd = (a: number, b: number) => { const q = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return q - Math.floor(q); };
    const R = span * 0.1;
    for (const t of this.trees) t.at = cl(reach(this.treePath, t.x, t.y, R) + (rnd(t.x, t.y) - 0.5) * 0.07);
    for (const q of this.inst) for (let i = 0; i < q.n; i++) { const x = q.base[i * 16 + 12], y = q.base[i * 16 + 14]; q.at[i] = cl(reach(this.treePath, x, y, R) + (rnd(x, y) - 0.5) * 0.07); }
    for (const s of this.shapes) s.at = s.water ? 0 : reach(this.pathPath, s.x, s.y, span * 0.16);
    // drawn along their length: a line's pieces in order, a surface's triangles sorted along its way
    const along = (path: P[], x: number, y: number) => { let bi = 0, bd = Infinity; for (let i = 0; i < path.length; i++) { const dd = (path[i].x - x) ** 2 + (path[i].y - y) ** 2; if (dd < bd) { bd = dd; bi = i; } } return bi; };
    for (const s of this.shapes) {
      if (s.struct) continue;
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
      ["trees", "trees", "Trees", "planting", "Planting the trees", nTrees.toLocaleString(), 4.65, this.trees.length + this.inst.length > 0],
      ["water", "water", "Water", "filling", "Filling the water", String(waters), 1.3, waters > 0],
      ["paths", "paths", "Paths, roads and more", "drawing", "Drawing paths and roads", String(others), 1.4, others > 0],
      ["build", "build", "Buildings and more", "placing", "Setting down the buildings", String(this.built.length), structs ? Math.min(3.4, 1.0 + structs * 0.6) : 1.1, this.built.length > 0]
    ];
    this.steps.push({ id: "ground", tool: "ground", name: "Ground", doing: "shaping", now: "Shaping the ground", val: `${Math.round(hi - lo)} ft of climb`, click: this.T.groundClick, from: this.T.rise[0], to: this.T.rise[1] });
    let t = this.T.swoop[1];
    for (const [id, tool, name, doing, now, val, len, has] of want) {
      if (!has) continue;
      const click = t + 0.6; this.steps.push({ id, tool, name, doing, now, val, click, from: click + 0.35, to: click + 0.35 + len }); t = click + 0.35 + len;
    }
    this.T.sunClick = t + 0.7; this.T.sun = [t + 1.4, t + 4.7]; this.T.sunClose = t + 5.3; this.T.back = t + 5.6; this.T.end = t + 7.6;
  }
  private step(id: Step["id"]) { return this.steps.find(s => s.id === id); }

  /** The hand, its ring, the buildings' outlines and the card. */
  private dress(name: string) {
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;z-index:9996;pointer-events:none");
    document.body.appendChild(svg); this.els.push(svg as unknown as HTMLElement);
    this.ring = document.createElementNS(NS, "polygon");
    this.ring.setAttribute("style", "fill:rgba(255,255,255,.07);stroke:#fff;stroke-width:1.6;stroke-opacity:.85;opacity:0");
    svg.appendChild(this.ring);
    for (const b of this.built) if (b.pts) { const p = document.createElementNS(NS, "path"); p.setAttribute("style", "fill:rgba(255,255,255,.12);stroke:#fff;stroke-width:2;stroke-linejoin:round;opacity:0"); p.setAttribute("pathLength", "1"); svg.appendChild(p); b.out = p; }
    this.cur = this.el("div", "position:fixed;left:0;top:0;z-index:9998;pointer-events:none;width:28px;height:28px;transform-origin:4px 3px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5));opacity:0;will-change:transform");
    this.cur.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2.5l15.5 8.2-6.6 1.9-2.6 6.6z" fill="#fff" stroke="#0b0f0a" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    const box = this.v.container.getBoundingClientRect();
    this.curAt = { x: box.left + box.width * 0.56, y: box.top + box.height * 0.62 }; this.from = { ...this.curAt };
    this.card = this.el("div", `position:fixed;left:${box.left + 14}px;top:${box.top + 116}px;width:300px;z-index:9997;border-radius:22px;padding:16px 16px 14px;color:#f4f4f5;font:14px/1.35 system-ui,'Segoe UI',sans-serif;opacity:0;pointer-events:none`);
    this.card.className = "glass"; this.card.setAttribute("data-testid", "import-show-card"); this.card.setAttribute("role", "status");
    this.card.innerHTML = `<div style="font-weight:650;font-size:15.5px" data-k="ttl"></div><div style="font-size:12.5px;color:#a1a1aa;margin-top:2px;min-height:17px" data-k="now"></div>
      <div style="height:5px;border-radius:5px;background:rgba(255,255,255,.1);margin:11px 0 8px;overflow:hidden" data-k="barbox"><i data-k="bar" style="display:block;height:100%;width:0;border-radius:5px;background:linear-gradient(90deg,#7fb24e,#a2cf6a)"></i></div>
      ${this.steps.map((s, i) => `<div data-row="${i}" style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13.5px;color:#71717a"><span data-dot style="width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;font-weight:700;color:#0c1209;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.14)"></span><span>${s.name}</span><span data-v style="margin-left:auto;font-size:13px;font-variant-numeric:tabular-nums"></span></div>`).join("")}`;
    (this.card.querySelector('[data-k="ttl"]') as HTMLElement).dataset.name = name;
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
    v.setDoc = (doc: any) => { this.realDoc = doc; set(this.dressed(doc)); };
    this.undo.push(() => { if (had) v.setDoc = had; else delete v.setDoc; set(this.realDoc); });
  }
  private dressed(doc: any) {
    return { ...doc, ...(this.sunSet ? { sun: { ...(doc.sun ?? {}), ...this.sunSet } } : {}), background: { ...doc.background, opacity: doc.background?.url ? this.photoNow : doc.background?.opacity } };
  }

  private frame(t: number) {
    const v = this.v, T = this.T, W = this.W, H = this.H;
    this.frameN++;
    let shade = false;
    // the cover lifts off the photo, seen straight down
    const cv = 1 - io(t / T.cover);
    this.cover.style.opacity = String(cv); this.cover.style.display = cv <= 0.001 ? "none" : "grid";
    // the camera: one move, down from overhead and on round the site, lower at the end to take in the sky
    const k = io((t - T.swoop[0]) / (T.swoop[1] - T.swoop[0])), a = this.cam.from, b = this.cam.to;
    const on = io((t - T.swoop[1] + 0.6) / (T.end - 1.6 - T.swoop[1] + 0.6)), low = io((t - T.sun[0] + 0.8) / (T.sun[1] - T.sun[0] + 0.8));
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
      const x = Math.max((1 - io((t - T.rise[0] - 0.7) / (T.rise[1] - T.rise[0] - 0.2))) * this.photoReal, home * this.photoReal), g = v.ground, mat = g.mapPlane?.material;
      if (Math.abs(x - this.photoNow) > 0.0005 || this.frameN === 1) { this.photoNow = x; g.bgOpacity = x; if (mat && g.photo && !g.painted) { mat.opacity = x; mat.visible = x > 0.001; } }
    }
    // the ground comes up
    const rise = 0.0001 + 0.9999 * io((t - T.rise[0]) / (T.rise[1] - T.rise[0]));
    if (v.ground.group.scale.y !== rise) { v.ground.group.scale.y = rise; v.ground.group.updateMatrixWorld(true); shade = true; }
    // the trees, each as the hand reaches its stand: up out of the ground
    const ts = this.step("trees"), tp = ts ? (t - ts.from) / (ts.to - ts.from) : 2, span = 0.13;
    const growing = tp > -0.05 && tp < 1.05;
    if (growing || this.frameN === 1 || (tp >= 1.05 && this.trees[0]?.s !== 1 && this.trees.length)) {
      for (const tr of this.trees) { const s = out((tp - tr.at * (1 - span)) / span); if (s === tr.s) continue; tr.s = s; tr.o.visible = s > 0.001; tr.o.scale.set(0.35 + 0.65 * s, Math.max(0.0001, s), 0.35 + 0.65 * s); tr.o.updateMatrixWorld(true); }
    }
    if (growing || this.frameN === 1 || (tp >= 1.05 && !this.instDone)) {
      for (const q of this.inst) {
        const arr = q.m.instanceMatrix.array as Float32Array;
        for (let i = 0; i < q.n; i++) { const s = Math.max(0.0001, out((tp - q.at[i] * (1 - span)) / span)), w2 = s < 0.001 ? 0.0001 : 0.35 + 0.65 * s, o = i * 16;
          for (let c = 0; c < 12; c++) arr[o + c] = q.base[o + c] * (c >= 4 && c < 8 ? s : w2); }
        q.m.instanceMatrix.needsUpdate = true;
      }
      this.instDone = tp >= 1.05;
      if (this.frameN % 2 === 0 || !growing) shade = true;
    }
    // the water runs down its bed; then each path, road and area is drawn along its length
    const ws = this.step("water"), ps = this.step("paths");
    const wp = ws ? (t - ws.from) / (ws.to - ws.from) : 2, pp = ps ? (t - ps.from) / (ps.to - ps.from) : 2;
    for (const s of this.shapes) {
      if (s.struct) continue;
      const p = s.water ? io(wp) : out((pp - s.at * 0.7) / 0.3);
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
      if (s.out) { const on2 = q > 0 && e < 1; s.out.style.opacity = on2 ? String(1 - cl((e - 0.5) / 0.5)) : "0"; if (on2) { s.out.setAttribute("d", "M" + s.pts!.map(p => { const c = this.screenOf(p.x, p.y, 1.5); return `${c.x.toFixed(1)} ${c.y.toFixed(1)}`; }).join("L") + "Z"); s.out.setAttribute("stroke-dasharray", `${line} 1`); s.out.style.fillOpacity = line >= 1 ? "1" : "0"; } }
      if (q > 0 && q < 1 && !drawing) drawing = { s, line };
    }
    for (const el of this.labels) { const at = bs ? bs.to - 0.5 : T.sunClick - 0.6; el.style.visibility = t >= at ? "" : "hidden"; el.style.opacity = String(io((t - at) / 0.6)); }

    // the hand
    let to: P | null = null, press = 0, pick: string | null = null, ringAt: { x: number; y: number; r: number } | null = null, onTool = false;
    const goTo = (target: P | null, at: number, lead = 0.85) => { if (!target || t < at - lead || t >= at + 0.3) return false; const u = io((t - (at - lead)) / lead); to = { x: lerp(this.from.x, target.x, u), y: lerp(this.from.y, target.y, u) }; if (t >= at) press = 1 - (t - at) / 0.3; return true; };
    for (const s of this.steps) if (goTo(this.tool(s.tool), s.click)) { onTool = true; if (t >= s.click) pick = s.tool; break; }
    const sb = document.querySelector<HTMLElement>('[data-testid="scene-button"]');
    if (!onTool && sb && !this.scene.open) { const r = sb.getBoundingClientRect(); if (goTo({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, T.sunClick)) { onTool = true; if (t >= T.sunClick) { this.scene.open = true; this.pick("select"); sb.click(); } } }
    if (this.scene.open && !this.scene.sl && !this.scene.shut) this.findSun();
    if (!onTool && sb && this.scene.open && !this.scene.shut) { const r = sb.getBoundingClientRect(); if (goTo({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, T.sunClose, 0.6)) { onTool = true; if (t >= T.sunClose) this.shutScene(); } }
    if (!onTool) {
      const gs = this.steps[0];
      if (ts && t >= ts.from - 0.3 && t < ts.to) { const p = onPath(this.treePath, tp + 0.012); to = this.screenOf(p.x, p.y, 70); if (t >= ts.from) ringAt = { x: p.x, y: p.y, r: this.span * 0.07 }; }
      else if (ws && this.waterPath.length && t >= ws.from - 0.2 && t < ws.to) { const p = onPath(this.waterPath, io(wp)); to = this.screenOf(p.x, p.y); if (t >= ws.from) ringAt = { x: p.x, y: p.y, r: 38 }; }
      else if (ps && t >= ps.from - 0.2 && t < ps.to) { const p = onPath(this.pathPath, pp); to = this.screenOf(p.x, p.y); }
      else if (bs && t >= bs.from - 0.2 && t < bs.to && this.built.length) { const d2: { s: ImportShow["built"][number]; line: number } = drawing ?? { s: this.built[t < bs.from ? 0 : this.built.length - 1], line: 0 }; if (d2.s.pts && d2.line < 1) { const p = onPath([...d2.s.pts, d2.s.pts[0]], d2.line); to = this.screenOf(p.x, p.y, 2); press = 0.6; } else { to = this.screenOf(d2.s.x, d2.s.y, 2); press = d2.s.pts ? 0 : 0.6; } }
      else if (t >= T.cover && t < (this.steps[1]?.click ?? T.sunClick) - 0.85) { const u = cl((t - gs.from) / (gs.to - gs.from)), a2 = u * 7.2, gx = W * (0.5 + 0.27 * Math.sin(a2) * (0.4 + 0.6 * u)), gy = H * (0.52 + 0.22 * Math.cos(a2 * 0.5) * (0.4 + 0.6 * u)); to = this.screenOf(gx, gy, 4); if (t >= gs.from && t < gs.to) ringAt = { x: gx, y: gy, r: this.span * 0.085 }; }
      else if (this.scene.sl && t >= T.sunClick + 0.3 && t < T.sunClose - 0.6) {
        // (dragging the Sun slider across: the slider itself moved, as someone would)
        const sl = this.scene.sl, r = sl.getBoundingClientRect(), u = io((t - T.sun[0]) / (T.sun[1] - T.sun[0])), f = 0.08 + 0.84 * u;
        to = { x: r.left + 8 + (r.width - 16) * f, y: r.top + r.height / 2 + 1 }; press = t >= T.sun[0] - 0.1 && t < T.sun[1] ? 0.6 : 0;
        if (sl.isConnected && t < T.sun[1]) { const lo = +sl.min, hi = +sl.max, val = String(Math.round((lo + (hi - lo) * f) * 4) / 4); if (val !== this.scene.val) { this.scene.val = val; this.slide(sl, val); } }
        this.onThumb = t >= T.sun[0];
      }
    }
    if (to) { const e = onTool || (this.onThumb && t < T.sun[1] + 0.2) ? 1 : 0.2; this.curAt.x += ((to as P).x - this.curAt.x) * e; this.curAt.y += ((to as P).y - this.curAt.y) * e; }
    if (!onTool) this.from = { ...this.curAt };
    this.cur.style.transform = `translate(${this.curAt.x - 4}px, ${this.curAt.y - 3}px) scale(${1 - 0.14 * cl(press)})`;
    this.cur.style.opacity = t < T.cover * 0.6 || t > T.sunClose + 0.5 ? "0" : "1";
    if (pick) this.pick(pick);
    const lastStep = this.steps[this.steps.length - 1];
    if (t > lastStep.to + 0.25 && !this.scene.open) this.pick("select");
    // (the ring eases to where the hand works, and fades when it lifts)
    this.ringO += ((ringAt ? 1 : 0) - this.ringO) * 0.25;
    const ra = ringAt as { x: number; y: number; r: number } | null;
    if (ra) this.ringW = this.ringW ? { x: this.ringW.x + (ra.x - this.ringW.x) * 0.6, y: this.ringW.y + (ra.y - this.ringW.y) * 0.6, r: this.ringW.r + (ra.r - this.ringW.r) * 0.2 } : { ...ra };
    if (this.ringW && this.ringO > 0.02) { const pts: string[] = []; for (let i = 0; i < 32; i++) { const q = this.screenOf(this.ringW.x + this.ringW.r * Math.cos((i / 32) * 6.2832), this.ringW.y + this.ringW.r * Math.sin((i / 32) * 6.2832), 3); pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`); } this.ring.setAttribute("points", pts.join(" ")); }
    this.ring.style.opacity = this.ringO < 0.02 ? "0" : String(this.ringO);

    // the card
    const c = this.card, q = (k2: string) => c.querySelector(`[data-k="${k2}"]`) as HTMLElement, done = t >= lastStep.to, name = q("ttl").dataset.name;
    c.style.opacity = String(io((t - T.cover + 0.2) / 0.6) * (1 - io((t - T.end + 1.0) / 0.8)));
    c.style.display = this.scene.open && !this.scene.shut ? "none" : "";
    const curStep = this.steps.find(s => t < s.to);
    q("ttl").textContent = done ? `${name} is in` : `Bringing in ${name}`;
    q("now").textContent = done ? "Press H for New hole to lay out your first one." : curStep && t >= curStep.from ? curStep.now : "…";
    q("bar").style.width = `${cl((t - T.cover) / (lastStep.to - T.cover)) * 100}%`; q("barbox").style.display = done ? "none" : "";
    this.steps.forEach((s, i) => { const row = c.querySelector(`[data-row="${i}"]`) as HTMLElement, on2 = t >= s.from && t < s.to, dn = t >= s.to, dot = row.querySelector("[data-dot]") as HTMLElement, vv = row.querySelector("[data-v]") as HTMLElement;
      row.style.color = on2 ? "#fafafa" : dn ? "#e4e4e7" : "#71717a"; dot.textContent = dn ? "✓" : ""; dot.style.background = dn ? "#a2cf6a" : "none"; dot.style.boxShadow = dn ? "none" : on2 ? "inset 0 0 0 2px #a2cf6a" : "inset 0 0 0 1.5px rgba(255,255,255,.14)";
      vv.textContent = on2 ? s.doing : dn ? s.val : ""; vv.style.color = on2 ? "#a2cf6a" : "#a1a1aa"; vv.style.fontWeight = on2 ? "600" : "400"; });
    if (shade) v.shadowsDirty = true;
    v.dirty = true;
  }
  private instDone = false;
  private onThumb = false;

  private pick(id: string) { if (this.picked === id) return; this.picked = id; this.tool(id)?.el.click(); }
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
    if (v.disposed) { for (const e of this.els) e.remove(); return; }
    v.ground.group.scale.y = 1; v.ground.group.updateMatrixWorld(true);
    for (const tr of this.trees) { tr.o.visible = true; tr.o.scale.set(1, 1, 1); tr.o.updateMatrixWorld(true); }
    for (const q of this.inst) { (q.m.instanceMatrix.array as Float32Array).set(q.base); q.m.instanceMatrix.needsUpdate = true; }
    for (const s of this.shapes) { s.o.visible = true; for (const r of s.rev) { if (r.line) r.geo.instanceCount = r.max; else r.geo.setDrawRange(0, Infinity); } for (const q of s.mats) { q.m.transparent = q.tr; q.m.opacity = q.op; } }
    for (const s of this.built) { s.o.visible = true; s.o.scale.set(1, 1, 1); s.o.updateMatrixWorld(true); }
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
