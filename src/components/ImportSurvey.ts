// A site being brought in, shown as a survey over the picker's map: every source sweeps the frame
// in its own color (several at once), a faint line while it's still being fetched, a bright pass
// once it has landed that draws what it found as it goes (the ground's contours, each measured
// tree, roads, buildings). The frame's edge fills as the whole import does.
import L from "leaflet";
import type { GeoBounds } from "../lib/geo/core";
import type { SourceId, SourceStatus } from "../lib/importSite";

type P = { x: number; y: number };
/** A shape a source found, in plan feet over the frame. */
export type SurveyShape = { points: P[]; color: string; fill?: number; weight?: number };
/** What a source found, to be drawn by its pass. */
export type SurveyFind = { heights?: Record<string, number>; trees?: [number, number, number][]; shapes?: SurveyShape[] };

/** Each source's color: its sweep, and its row in the checklist. */
export const SURVEY_COLORS: Record<SourceId, string> = {
  photo: "#e4e4e7", elevation: "#f0c070", lidar: "#8fe07a", osm: "#f4e3b8", buildings: "#ff9d4d", photoTrees: "#5ed3b0", gov: "#6cb8ff", seasons: "#b9a2ff"
};
const TAG: Partial<Record<SourceId, string>> = { photo: "Photo", seasons: "Seasons", gov: "Water and buildings" };
const WORD: Partial<Record<SourceId, string>> = { lidar: "trees", osm: "found", buildings: "buildings", photoTrees: "from the photo", gov: "found" };
const LIME = "#a2cf6a";
/** How long a pass takes to cross the frame, and how far apart two that land together start. */
const PASS = 1500, APART = 260, FADE = 350;

type Src = {
  id: SourceId; color: string; period: number; offset: number;
  state: SourceStatus["state"]; count?: number;
  /** When its bright pass starts (landed), and when its line began to fade (nothing here, or failed). */
  pass: number | null; gone: number | null;
  segs?: Float32Array; trees?: Float32Array; shapes?: SurveyShape[]; climb?: Float32Array;
};

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const frac = (x: number) => x - Math.floor(x);

/** Contour lines of a ground (heights at its grid's corners, ft): [x0, y0, x1, y1] each, in plan
 * feet, sorted by where they start from the left; and how much it climbs, left to there, per column. */
const contoursOf = (heights: Record<string, number>, width: number, height: number, grid: number) => {
  const nx = Math.round(width / grid) + 1, ny = Math.round(height / grid) + 1;
  const h = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = heights[`${i * grid},${j * grid}`] ?? 0; h[j * nx + i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const climb = new Float32Array(nx);
  let cl = Infinity, ch = -Infinity;
  for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) { const v = h[j * nx + i]; if (v < cl) cl = v; if (v > ch) ch = v; } climb[i] = ch - cl; }
  // (about ten lines over the site, at a round number of feet)
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(s => (hi - lo) / s <= 11) ?? 1000;
  const out: number[][] = [];
  if (hi - lo >= 2) {
    for (let lv = Math.ceil((lo + 0.01) / step) * step; lv < hi; lv += step) {
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i + 1], d = h[(j + 1) * nx + i];
        const k = (a > lv ? 1 : 0) | (b > lv ? 2 : 0) | (c > lv ? 4 : 0) | (d > lv ? 8 : 0);
        if (k === 0 || k === 15) continue;
        const x = i * grid, y = j * grid, t = (p: number, q: number) => (lv - p) / (q - p || 1);
        const top = [x + t(a, b) * grid, y], right = [x + grid, y + t(b, c) * grid], bottom = [x + t(d, c) * grid, y + grid], left = [x, y + t(a, d) * grid];
        const seg = (p: number[], q: number[]) => out.push(p[0] < q[0] ? [p[0], p[1], q[0], q[1]] : [q[0], q[1], p[0], p[1]]);
        switch (k) {
          case 1: case 14: seg(left, top); break;
          case 2: case 13: seg(top, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(right, bottom); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, bottom); break;
          case 5: seg(left, top); seg(right, bottom); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
  }
  out.sort((p, q) => p[0] - q[0]);
  return { segs: Float32Array.from(out.flat()), climb };
};

export class ImportSurvey {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private on = false;
  private raf = 0;
  private startedAt = 0;
  private endedAt: number | null = null;
  private lastPass = 0;
  private frame: { bounds: GeoBounds; width: number; height: number; grid: number } | null = null;
  private fraction = 0;
  private shown = 0;
  private srcs = new Map<SourceId, Src>();
  private waiting: (() => void)[] = [];

  constructor(private map: L.Map) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "site-survey";
    this.canvas.setAttribute("data-testid", "import-survey");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.display = "none";
    map.getContainer().appendChild(this.canvas);
    this.g = this.canvas.getContext("2d")!;
  }

  /** An import begins: the frame's own handles step aside, the survey shows. */
  start() {
    this.on = true;
    this.startedAt = performance.now();
    this.endedAt = null;
    this.lastPass = 0;
    this.frame = null;
    this.fraction = this.shown = 0;
    this.srcs.clear();
    this.canvas.style.display = "";
    this.map.getContainer().classList.add("site-surveying");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.draw);
    this.say();
  }

  /** Over (in, stopped or failed): the map as it was. */
  stop() {
    this.on = false;
    cancelAnimationFrame(this.raf);
    this.canvas.style.display = "none";
    this.map.getContainer().classList.remove("site-surveying");
    this.waiting.splice(0).forEach(done => done());
    this.say();
  }

  destroy() {
    this.stop();
    this.canvas.remove();
  }

  setFrame(bounds: GeoBounds, width: number, height: number, grid: number) {
    this.frame = { bounds, width, height, grid };
  }

  private src(id: SourceId) {
    let s = this.srcs.get(id);
    if (!s) {
      // (each at its own pace and place, so the lines never march together)
      const n = this.srcs.size;
      s = { id, color: SURVEY_COLORS[id], period: 2300 + ((n * 370) % 1300), offset: frac(n * 0.381), state: "waiting", pass: null, gone: null };
      this.srcs.set(id, s);
    }
    return s;
  }

  /** How each source is going, and all of it together. */
  status(sources: Partial<Record<SourceId, SourceStatus>>, fraction: number) {
    if (!this.on) return;
    // (never back: a source that turns out bigger than thought takes nothing off the edge)
    this.fraction = Math.max(this.fraction, fraction);
    const now = performance.now();
    for (const [id, st] of Object.entries(sources) as [SourceId, SourceStatus][]) {
      const s = this.src(id);
      s.state = st.state;
      if (st.count !== undefined) s.count = st.count;
      if (st.state === "done" && s.pass === null) this.land(id);
      if ((st.state === "not-here" || st.state === "failed") && s.pass === null && s.gone === null) s.gone = now;
    }
    this.say();
  }

  /** A source has landed: its bright pass starts (a moment after the one before it), drawing what it found. */
  land(id: SourceId, find?: SurveyFind) {
    if (!this.on) return;
    const s = this.src(id), f = this.frame;
    if (s.pass === null) {
      const now = performance.now();
      s.pass = this.lastPass = Math.max(now, this.lastPass + APART);
      s.gone = null;
    }
    if (find && f) {
      if (find.heights) { const c = contoursOf(find.heights, f.width, f.height, f.grid); s.segs = c.segs; s.climb = c.climb; }
      if (find.trees) { const t = [...find.trees].sort((a, b) => a[0] - b[0]); s.trees = Float32Array.from(t.flat()); }
      if (find.shapes) s.shapes = [...(s.shapes ?? []), ...find.shapes];
    }
    this.say();
  }

  /** Once every pass under way has crossed (at once with motion reduced, or nothing under way). */
  settled(): Promise<void> {
    if (!this.on || reduced()) return Promise.resolve();
    this.endedAt = performance.now();
    return new Promise(done => {
      this.waiting.push(done);
      // (never held up for long)
      window.setTimeout(() => { const k = this.waiting.indexOf(done); if (k >= 0) { this.waiting.splice(k, 1); done(); } }, 3200);
    });
  }

  /** How far a source's bright pass has got (0: not landed; 1: across). */
  private passAt(s: Src, now: number) {
    if (s.pass === null) return 0;
    if (reduced()) return 1;
    return Math.max(0, Math.min(1, (now - s.pass) / PASS));
  }

  /** For tests: which sources sweep, and which have landed. */
  private say() {
    const now = performance.now();
    (window as { __dgSurvey?: unknown }).__dgSurvey = { on: this.on, fraction: this.fraction, framed: !!this.frame, sources: Object.fromEntries([...this.srcs].map(([id, s]) => [id, { state: s.state, color: s.color, landed: s.pass !== null, pass: this.passAt(s, now), contours: (s.segs?.length ?? 0) / 4, trees: (s.trees?.length ?? 0) / 3, shapes: s.shapes?.length ?? 0 }])) };
  }

  private pill(text: string, cx: number, cy: number, fill: string, ink = "#0c1209") {
    const g = this.g;
    g.font = "700 12.5px system-ui, 'Segoe UI', sans-serif";
    const w = g.measureText(text).width + 22, h = 24, x = cx - w / 2, y = cy - h / 2, r = h / 2;
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
    g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
    g.fillStyle = fill; g.fill();
    g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.fillStyle = ink; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, cx, cy + 0.5);
  }

  private draw = () => {
    if (!this.on) return;
    this.raf = requestAnimationFrame(this.draw);
    const g = this.g, box = this.map.getContainer(), W = box.clientWidth, H = box.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const f = this.frame;
    if (!f) return;
    const now = performance.now(), still = reduced();
    const a = this.map.latLngToContainerPoint([f.bounds.north, f.bounds.west]), b = this.map.latLngToContainerPoint([f.bounds.south, f.bounds.east]);
    const x0 = a.x, y0 = a.y, w = b.x - a.x, h = b.y - a.y, k = w / f.width, ky = h / f.height;
    const sx = (x: number) => x0 + x * k, sy = (y: number) => y0 + y * ky;
    // The ground round the frame steps back
    const dim = Math.min(1, (now - this.startedAt) / 500);
    g.fillStyle = `rgba(8,12,6,${0.45 * dim})`;
    g.beginPath(); g.rect(0, 0, W, H); g.rect(x0, y0, w, h); g.fill("evenodd");

    g.save();
    g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    const srcs = [...this.srcs.values()];
    // What's been found, behind each source's pass: shapes, then contours, then trees
    for (const s of srcs) {
      const p = this.passAt(s, now);
      if (!s.shapes?.length || p <= 0) continue;
      g.save();
      g.beginPath(); g.rect(x0, y0, w * p, h); g.clip();
      g.lineJoin = g.lineCap = "round";
      for (const sh of s.shapes) {
        if (sh.points.length < 2) continue;
        g.beginPath();
        sh.points.forEach((q, i) => (i ? g.lineTo(sx(q.x), sy(q.y)) : g.moveTo(sx(q.x), sy(q.y))));
        if (sh.fill !== undefined) { g.closePath(); g.globalAlpha = sh.fill; g.fillStyle = sh.color; g.fill(); g.globalAlpha = 0.9; g.strokeStyle = sh.color; g.lineWidth = 1.5; g.stroke(); }
        else { g.globalAlpha = 0.95; g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = (sh.weight ?? 3) + 2.5; g.stroke(); g.strokeStyle = sh.color; g.lineWidth = sh.weight ?? 3; g.stroke(); }
      }
      g.restore();
    }
    g.globalAlpha = 1;
    for (const s of srcs) {
      const p = this.passAt(s, now), sg = s.segs;
      if (!sg?.length || p <= 0) continue;
      const upTo = p * f.width;
      g.beginPath();
      for (let i = 0; i < sg.length && sg[i] <= upTo; i += 4) { g.moveTo(sx(sg[i]), sy(sg[i + 1])); g.lineTo(sx(sg[i + 2]), sy(sg[i + 3])); }
      g.strokeStyle = s.color; g.globalAlpha = 0.8; g.lineWidth = 1.2; g.stroke();
    }
    for (const s of srcs) {
      const p = this.passAt(s, now), t = s.trees;
      if (!t?.length || p <= 0) continue;
      const upTo = p * f.width, fresh = f.width * 0.03;
      for (let i = 0; i < t.length && t[i] <= upTo; i += 3) {
        // (just reached: lit, a little bigger)
        const age = still || p >= 1 ? 1 : Math.min(1, (upTo - t[i]) / fresh), r = Math.min(6, Math.max(1.3, t[i + 2] * k * 0.3)) * (1 + (1 - age) * 0.9);
        g.globalAlpha = age < 1 ? 0.95 : 0.6;
        g.fillStyle = age < 1 ? "#eaffd0" : s.color;
        g.beginPath(); g.arc(sx(t[i]), sy(t[i + 1]), r, 0, 6.3); g.fill();
      }
    }
    g.globalAlpha = 1;
    // The sweeps: a faint line for each source still being fetched, a bright pass for each landed
    const tags: { x: number; text: string; color: string }[] = [];
    let busy = false;
    if (!still) {
      for (const s of srcs) {
        const p = this.passAt(s, now);
        if (s.pass !== null && now >= s.pass && p < 1) {
          busy = true;
          const x = x0 + w * p, trail = Math.min(110, w * 0.16);
          const grad = g.createLinearGradient(x - trail, 0, x, 0);
          grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, s.color);
          g.globalAlpha = 0.34; g.fillStyle = grad; g.fillRect(x - trail, y0, trail, h);
          g.globalAlpha = 1; g.fillStyle = s.color; g.shadowColor = s.color; g.shadowBlur = 10; g.fillRect(x - 1.25, y0, 2.5, h); g.shadowBlur = 0;
          const n = s.count, word = WORD[s.id];
          const text = s.id === "elevation" && s.climb ? `${Math.round(s.climb[Math.min(s.climb.length - 1, Math.floor(p * (s.climb.length - 1)))])} ft of climb`
            : n && word ? `${Math.round(n * p).toLocaleString()} ${word}` : TAG[s.id] ?? "";
          if (text) tags.push({ x, text, color: s.color });
        } else if (s.pass === null && (s.state === "coming" || s.gone !== null)) {
          const fade = s.gone !== null ? 1 - (now - s.gone) / FADE : Math.min(1, (now - this.startedAt) / 400);
          if (fade <= 0) continue;
          if (s.gone === null) busy = true;
          const x = x0 + w * frac((now - this.startedAt) / s.period + s.offset), trail = Math.min(46, w * 0.07);
          const grad = g.createLinearGradient(x - trail, 0, x, 0);
          grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, s.color);
          g.globalAlpha = 0.16 * fade; g.fillStyle = grad; g.fillRect(x - trail, y0, trail, h);
          g.globalAlpha = 0.55 * fade; g.fillStyle = s.color; g.fillRect(x - 0.75, y0, 1.5, h);
        } else if (s.pass !== null && now < s.pass) busy = true;
      }
    }
    g.globalAlpha = 1;
    g.restore();

    // The frame: its edge filled as far as the whole import has got, its corners
    this.shown += (this.fraction - this.shown) * 0.12;
    const edge = 2 * (w + h), upTo = edge * Math.min(1, this.shown);
    g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,.55)"; g.strokeRect(x0, y0, w, h);
    g.save();
    g.setLineDash([upTo, edge]); g.lineCap = "round"; g.lineWidth = 3.5; g.strokeStyle = LIME; g.shadowColor = "rgba(162,207,106,.8)"; g.shadowBlur = 7;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0); g.lineTo(x0 + w, y0 + h); g.lineTo(x0, y0 + h); g.closePath(); g.stroke();
    g.restore();
    const c = Math.min(26, w / 4, h / 4);
    g.lineWidth = 4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#fff";
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0 + w, y0 + h, -1, -1], [x0, y0 + h, 1, -1]]) { g.beginPath(); g.moveTo(cx, cy + dy * c); g.lineTo(cx, cy); g.lineTo(cx + dx * c, cy); g.stroke(); }
    this.pill(`${Math.round(Math.min(1, this.shown) * 100)}%`, x0 + w / 2, y0, LIME);
    // (each pass says what it's drawing, under the frame; two close together, one under the other)
    tags.sort((p, q) => p.x - q.x);
    const rows: number[] = [];
    for (const t of tags) {
      let row = 0;
      while (rows[row] !== undefined && t.x - rows[row] < 150) row++;
      rows[row] = t.x;
      this.pill(t.text, Math.max(x0 + 50, Math.min(x0 + w - 50, t.x)), y0 + h + 22 + row * 29, t.color);
    }
    // (everything in and every pass across: whoever waits for the survey goes on)
    if (this.endedAt !== null && !busy && this.waiting.length) this.waiting.splice(0).forEach(done => done());
  };
}
