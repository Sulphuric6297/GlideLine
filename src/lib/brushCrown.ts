// The Hand painted look's treetops (lib/mapLook), painted the way the reference is: every crown is
// clumps of leaf groups, every group three to five brush strokes out from a shared middle, every
// stroke a flat-brush dab with a scalloped edge and the bristles' marks in its paint. The light is
// the map's sun: the clumps toward it in yellow-green, those away from it in deep shade; the sunny
// groups lie over the shaded ones and each casts a soft shadow on the leaves under it. Nothing is
// pasted: every tree is painted from its own seed. Each tree is painted on a small canvas of its
// own (so the soft shadows only blur that much), then laid on the map. Where the browser has
// WebGL2, the graphics chip paints them instead (lib/brushGpu), all their strokes at once: this
// lists them. Without it, background workers paint them several at once (brushCrown.worker.ts).
type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type BrushTree = { x: number; y: number; r: number; col: RGB; seed: number; pine?: boolean; h?: number };

import { OP, beginMap, dropMap, endMap, gpuPainter, paintBatch } from "./brushGpu";

const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
/** A stroke's own random numbers (0..1), from its seed: whole-number maths, so the graphics chip's
 * shader works out the very same ones (lib/brushGpu, sh). */
const sh = (seed: number, k: number) => {
  let x = (Math.imul(seed | 0, 374761393) + Math.imul(k | 0, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const css = (c: number[], a = 1) => `rgba(${c.map(v => Math.round(Math.max(0, Math.min(255, v)))).join(",")},${a})`;
const mix = (a: number[], b: number[], k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
// (colour by hue, saturation and lightness, for autumn's own light and shade)
const toHsl = (c: number[]): [number, number, number] => {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const fromHsl = (h: number, s: number, l: number): RGB => {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};
/** A green crown's shade and sunlight: a deep green and a fresh yellow-green (not olive: muted). */
const GREEN_SHADE: RGB = [20, 46, 34], GREEN_SUN: RGB = [196, 210, 82];
/** How green a leaf colour is (1: green, as the look was tuned for; 0: autumn's reds, oranges and golds). */
const greenness = (h: number) => Math.max(0, Math.min(1, (h - 52) / 22));
/**
 * A crown's leaf colour and its light and shade. A green one: as tuned, shaded toward the map's
 * own olive. An autumn one: brighter and fuller, shaded within its own hue (a deep red-brown in
 * the shade, a glowing yellow-orange in the sun), as a painter keeps fall colour vivid.
 */
const leafLight = (base: RGB) => {
  const [h, s, l] = toHsl(base), w = greenness(h);
  if (w >= 1) return { base, shadow: GREEN_SHADE, sun: GREEN_SUN };
  const vivid = fromHsl(h, Math.min(0.92, s * 1.45 + 0.08), Math.min(0.62, l * 1.18 + 0.04));
  const own = { base: vivid, shadow: fromHsl(h - 10, Math.min(0.95, s * 1.4 + 0.1), Math.max(0.07, l * 0.36)), sun: fromHsl(h + 14, Math.min(1, s * 1.5 + 0.15), Math.min(0.78, l * 1.5 + 0.18)) };
  return { base: mix(own.base, base, w), shadow: mix(own.shadow, GREEN_SHADE, w), sun: mix(own.sun, GREEN_SUN, w) };
};
const rng = (s: number) => { s = (Math.abs(Math.floor(s)) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
// (in a worker there's no page: an offscreen canvas)
const canvas = (w: number, h: number): AnyCanvas => { if (typeof document === "undefined") return new OffscreenCanvas(w, h); const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const ctx2d = (c: AnyCanvas) => c.getContext("2d") as Ctx;

/** The look, as tuned against the reference: leaf groups' size and spacing, the crown's clumps,
 * how the light falls across them, its bands from shade to sun, the shade's and sun's paint. */
const P = {
  sec: 0.27, armLen: 0.75, armWid: 0.89, armOut: 0.1, sprayGap: 1.05, sprays: 2, clumps: 4.7, clumpR: 0.42, clumpD: 0.56,
  env: 0.96, envLump: 0.13, litBase: 0.46, litIn: 0.8, litTree: 0.8, litNoise: 0.4, lo: -0.57, hi: 0.66, nb: 7,
  shadow: [31, 38, 28] as RGB, sun: [178, 168, 74] as RGB, tex: 0.6, lift: 0.07, sink: 0.21, clumpVar: 0.12, clumpHue: 8,
  scallop: 0.19, bumpsMin: 9, shadeRim: 0.32, shadeRimCol: [110, 168, 150] as RGB, sunRim: 0.08, shadeTex: 0.22, shadeVar: 1.2
};

// ---------------------------------------------------------------- one brush stroke

let bristleTex: AnyCanvas | null = null;
/** The brush's own marks: fine bristle lines side by side, each lighter or darker than the next and
 * fading in and out along its length, over a faint grain (half grey: laid over the paint, it only
 * lightens and darkens it). */
const bristles = () => {
  if (bristleTex) return bristleTex;
  const S = 256, c = canvas(S, S), t = ctx2d(c), im = t.createImageData(S, S);
  const smooth = (v: number, k: number) => { const i = Math.floor(v), f = v - i, u = f * f * (3 - 2 * f); return hash(i, k) * (1 - u) + hash(i + 1, k) * u; };
  for (let x = 0; x < S; x++) {
    const line = (hash(x, 1) - 0.5) * 0.9 + (smooth(x / 6, 2) - 0.5) * 0.8 + (smooth(x / 23, 3) - 0.5) * 0.5;
    for (let y = 0; y < S; y++) {
      const along = smooth(y / 30 + x * 0.37, 4) * 0.7 + 0.3, grain = (hash(x * 7 + y, 5) - 0.5) * 0.18;
      const v = Math.max(0, Math.min(255, 128 + (line * along + grain) * 70)), i = (y * S + x) * 4;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
    }
  }
  t.putImageData(im, 0, 0);
  return (bristleTex = c);
};

type StrokeOpts = { sun: number[]; bumps: number; flat?: boolean; alpha?: number; rim?: number; rimCol?: RGB; texMin?: number; pine?: boolean; veins?: number };

/** The strokes listed for the graphics chip instead of painted (lib/brushGpu: OP numbers each). */
type Rec = { data: Float32Array; n: number; soft: number; crown: number[] };
let rec: Rec | null = null;
const put = (...v: number[]) => {
  const r = rec!;
  if ((r.n + 1) * OP > r.data.length) { const d = new Float32Array(r.data.length * 2); d.set(r.data); r.data = d; }
  r.data.set(v, r.n * OP); r.n++;
};
/** A stroke's outline from its base at (x0, y0) toward `ang`: squarish, as a flat brush leaves it,
 * narrower at the base, a little lopsided, its edge in scallops each its own size (at least seven
 * points a scallop, so each stays round, and about one every pixel and a half). */
// (a pine's leaflet: squarer, and wider toward its tip)
const outline = (g: Ctx, x0: number, y0: number, ang: number, len: number, wid: number, sd: number, bumps: number, pine = false) => {
  const pe = pine ? 0.92 : 0.82;
  const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux, n = Math.max(bumps * 7, Math.min(160, Math.round((len + wid) * 1.6)));
  const cx = x0 + ux * len * 0.5, cy = y0 + uy * len * 0.5, sc = P.scallop, ph = sh(sd, 1) * 6.28, asymK = (sh(sd, 8) - 0.5) * 0.35;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 6.2832, c = Math.cos(t), s = Math.sin(t);
    const c2 = Math.sign(c) * Math.pow(Math.abs(c), pe), s2 = Math.sign(s) * Math.pow(Math.abs(s), pe);
    const w = (wid / 2) * (pine ? 0.6 + 0.4 * c : 0.74 + 0.26 * c) * (1 + asymK * s);
    const warp = t + 0.35 * Math.sin(t * 2 + ph) + 0.18 * Math.sin(t * 5 + ph * 2);
    const u = (warp * bumps) / 6.2832 + ph, bi = Math.floor(u), f = u - bi;
    const size = 0.72 + sh(sd, 100 + (((bi % bumps) + bumps) % bumps)) * 0.7;
    const bump = 1 - sc * size + sc * size * 2 * Math.pow(Math.sin(f * Math.PI), 0.45);
    const px = c2 * (len / 2) * bump, py = s2 * w * bump;
    g.lineTo(cx + ux * px + vx * py, cy + uy * px + vy * py);
  }
  g.closePath();
};
/** A stroke painted: one paint, its sunny edge lighter (in the shade most), a touch lighter toward
 * the sun and darker away, the bristles' marks along it, its edge a shade darker where the paint
 * gathers. Flat: the shape alone, one paint (shadows, and the deep shade under the leaves). */
const stroke = (g: Ctx, x0: number, y0: number, ang: number, len: number, wid: number, col: RGB, sd: number, o: StrokeOpts) => {
  if (rec) {
    // (where, how big; flat, painted or a soft shadow; its paint; its edge, bristles, seed, softness; its crown)
    const shade = o.rimCol === P.shadeRimCol || o.rimCol === PINE.shadeRimCol ? 1 : 0;
    put(x0, y0, ang, len, wid, o.flat ? (rec.soft ? 2 : 0) : 1, o.alpha ?? 1, o.bumps, col[0], col[1], col[2], o.rim ?? 0, shade, o.texMin ?? 0.35, sd, rec.soft, ...rec.crown);
    return;
  }
  const light = mix(P.sun, [255, 255, 255], 0.3), dark = P.shadow, sun = o.sun;
  outline(g, x0, y0, ang, len, wid, sd, o.bumps, o.pine);
  g.fillStyle = css(col, o.alpha ?? 1); g.fill();
  if (o.flat) return;
  g.save(); g.clip();
  if (o.rim) {
    g.strokeStyle = css(mix(col, o.rimCol ?? light, o.rim)); g.lineWidth = Math.max(1.2, wid * 0.16); g.stroke();
    outline(g, x0 - sun[0] * wid * 0.07, y0 - sun[1] * wid * 0.07, ang, len, wid, sd, o.bumps, o.pine);
    g.fillStyle = css(col); g.fill();
  }
  const cx = x0 + Math.cos(ang) * len * 0.5, cy = y0 + Math.sin(ang) * len * 0.5, R = Math.max(len, wid);
  const gr = g.createLinearGradient(cx + sun[0] * R * 0.6, cy + sun[1] * R * 0.6, cx - sun[0] * R * 0.6, cy - sun[1] * R * 0.6);
  gr.addColorStop(0, css(mix(col, light, P.lift))); gr.addColorStop(0.5, css(col, 0)); gr.addColorStop(1, css(mix(col, dark, P.sink)));
  g.fillStyle = gr; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  // (the bristles: about forty across, never finer than a pixel and a half; none on a stroke too
  // small to show them)
  if (wid >= 5) {
    const px = Math.max(1.5, wid / 40), fine = Math.min(1, wid / 60), lum = (0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2]) / 255;
    g.save();
    g.translate(cx, cy); g.rotate(ang + Math.PI / 2 + (sh(sd, 4) - 0.5) * 0.15); g.scale(px, px);
    g.translate(-sh(sd, 6) * 256, -sh(sd, 7) * 256);
    g.globalCompositeOperation = "overlay"; g.globalAlpha = P.tex * Math.min(1, Math.max(o.texMin ?? 0.35, (lum - 0.2) * 2.2)) * (0.45 + 0.55 * fine);
    g.fillStyle = g.createPattern(bristles() as CanvasImageSource, "repeat")!;
    const span = (R * 1.5) / px; g.fillRect(sh(sd, 6) * 256 - span / 2, sh(sd, 7) * 256 - span / 2, span, span);
    g.restore();
  }
  // (a pine's leaflet: a lighter vein down its middle, fainter ones out to its lobes)
  if (o.veins) {
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux, vc = mix(col, light, o.veins);
    g.lineCap = "round"; g.strokeStyle = css(vc, 0.75); g.lineWidth = Math.max(0.6, wid * 0.05);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ux * len * 0.82, y0 + uy * len * 0.82); g.stroke();
    g.strokeStyle = css(vc, 0.4); g.lineWidth = Math.max(0.5, wid * 0.03);
    for (const at of [0.35, 0.55, 0.72]) for (const side of [1, -1]) {
      const bx = x0 + ux * len * at, by = y0 + uy * len * at, l = wid * (0.32 + at * 0.2);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (ux * 0.7 + vx * side * 0.7) * l, by + (uy * 0.7 + vy * side * 0.7) * l); g.stroke();
    }
  }
  outline(g, x0, y0, ang, len, wid, sd, o.bumps, o.pine);
  g.strokeStyle = css(mix(col, dark, 0.25), 0.22); g.lineWidth = Math.max(1, wid * 0.08); g.stroke();
  g.restore();
};

// ---------------------------------------------------------------- one crown

type Arm = { x: number; y: number; a: number; len: number; wid: number; sd: number; bumps: number };
type Group = { c: number; k: number; arms: Arm[]; edge?: boolean };
type Clump = { x: number; y: number; r: number; top?: boolean; k: number; dl: number; hue: number };

/** A crown at (x, y), R px across its middle, in its leaf colour `base`, lit from `sun` (toward it). */
const paintCrown = (g: Ctx, x: number, y: number, R: number, leaf: RGB, seed: number, sun: number[]) => {
  const r = rng(seed * 1e6 + 1), nb = P.nb, { base, shadow: shadowC, sun: sunC } = leafLight(leaf);
  // (its bands of light, shade to sun; a band past the darkest goes darker still)
  const band = (k: number) => { const v = Math.max(-1, P.lo + ((P.hi - P.lo) * Math.min(nb - 1, k)) / (nb - 1)); return v < 0 ? mix(base, shadowC, -v) : mix(base, sunC, v); };
  const bandOf = (lit: number) => Math.max(0, Math.min(nb - 1, Math.round(lit * (nb - 1))));
  const toSun = (dx: number, dy: number) => dx * sun[0] + dy * sun[1];
  // (small crowns: leaf groups never smaller than reads, so fewer of them)
  // (and a crown smaller than that: a leaf group or two, never bigger than the crown)
  // (and a big crown: its leaf groups as big as a middling tree's, about 3.5 ft, so a big tree has
  // more leaves, not bigger ones)
  const secOf = P.sec * Math.min(1.7, Math.max(1, 34 / R)), cap = pxPerFt > 0 ? (3.5 * pxPerFt) / R : Infinity;
  const sec = Math.max(Math.min(secOf, Math.max(cap, 0.08)), Math.min(3.4 / R, 0.55)), sr = R * sec;
  const groupOf = (gx: number, gy: number, rad: number, k: number, c: number): Group => {
    const n = r() < 0.6 ? 4 : r() < 0.5 ? 3 : 5, a0 = r() * 6.2832, arms: Arm[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 6.2832 + (r() - 0.5) * 0.7, len = rad * P.armLen * (0.8 + r() * 0.5);
      arms.push({ x: gx - Math.cos(a) * len * P.armOut, y: gy - Math.sin(a) * len * P.armOut, a, len, wid: len * P.armWid * (0.85 + r() * 0.3), sd: Math.floor(r() * 1e6), bumps: P.bumpsMin + Math.floor(r() * 4) });
    }
    return { c, k, arms };
  };
  // The crown's edge: round, a few gentle lumps; no group past it
  const eph = r() * 7, eph2 = r() * 7, edgeAt = (a: number) => R * P.env * (1 + P.envLump * Math.sin(a * 3 + eph) + P.envLump * 0.6 * Math.sin(a * 5 + eph2));
  const inside = (px: number, py: number, rad: number) => Math.hypot(px - x, py - y) + rad * 0.8 <= edgeAt(Math.atan2(py - y, px - x));
  // The clumps: one near the middle, the rest round it; each a little its own in light and green
  const nc = Math.max(2, Math.round(P.clumps) + Math.floor(r() * 2));
  const clumps: Clump[] = [{ x: x + (r() - 0.5) * R * 0.15, y: y + (r() - 0.5) * R * 0.15, r: R * (P.clumpR + 0.04), top: true, k: 0, dl: 0, hue: 0 }];
  for (let i = 0; i < nc; i++) { const a = (i / nc) * 6.2832 + r() * 0.7, d = R * (P.clumpD - 0.06 + r() * 0.12); clumps.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: R * (P.clumpR - 0.04 + r() * 0.1), k: 0, dl: 0, hue: 0 }); }
  clumps.forEach(c => { c.k = c.top ? 9 : toSun(c.x - x, c.y - y) / R + r() * 0.6; c.dl = (r() - 0.5) * 2 * P.clumpVar; c.hue = (r() - 0.5) * 2 * P.clumpHue; });
  // (those away from the sun first; the middle one last, on top)
  clumps.sort((p, q) => p.k - q.k);
  const groups: Group[] = [], under: Group[] = [];
  const litAt = (px: number, py: number, c: Clump) => P.litBase + (toSun(px - c.x, py - c.y) / (c.r * 1.3)) * P.litIn + (toSun(c.x - x, c.y - y) / (R * 1.1)) * P.litTree;
  clumps.forEach((c, ci) => {
    // (the clump's inner leaves, in its own shade: what shows between its groups)
    const step = sr * 1.6;
    for (let gy = -c.r; gy <= c.r; gy += step) for (let gx = -c.r; gx <= c.r; gx += step) {
      const ux = c.x + gx + (r() - 0.5) * sr * 0.6, uy = c.y + gy + (r() - 0.5) * sr * 0.6;
      if (Math.hypot(ux - c.x, uy - c.y) > c.r * 0.9 || !inside(ux, uy, sr)) continue;
      under.push(groupOf(ux, uy, sr, bandOf(litAt(ux, uy, c)) - 2, ci));
    }
    const spots: { x: number; y: number }[] = [], want = Math.round((c.r / sr) ** 2 * P.sprays);
    for (let t = 0; t < want * 12 && spots.length < want; t++) {
      const a = r() * 6.2832, d = Math.sqrt(r()) * c.r * 0.9, sx = c.x + Math.cos(a) * d, sy = c.y + Math.sin(a) * d;
      if (!inside(sx, sy, sr) || spots.some(o => Math.hypot(o.x - sx, o.y - sy) < sr * P.sprayGap)) continue;
      spots.push({ x: sx, y: sy });
    }
    // (in a clump: its side away from the sun first, its sunny side over it)
    spots.sort((p, q) => toSun(p.x - c.x, p.y - c.y) - toSun(q.x - c.x, q.y - c.y));
    for (const s of spots) {
      let k = bandOf(litAt(s.x, s.y, c) + (c.top ? 0.06 : 0) + c.dl + (r() - 0.5) * P.litNoise);
      // (in the shade, leaves a band or so apart from one another, so they don't merge)
      if (k <= 2) k = Math.max(0, Math.min(2, k + Math.round((r() - 0.4) * P.shadeVar)));
      groups.push(groupOf(s.x, s.y, sr * (0.85 + r() * 0.3), k, ci));
    }
  });
  // A ring of groups along the edge, so the outline is leaves all the way round
  const ring = Math.round((2 * Math.PI * R * P.env) / (sr * P.sprayGap * 1.2));
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * 6.2832 + (r() - 0.5) * 0.2, d = edgeAt(a) - sr * 0.75, ex = x + Math.cos(a) * d, ey = y + Math.sin(a) * d;
    let ci = 0, best = Infinity;
    clumps.forEach((c, j) => { const dd = Math.hypot(c.x - ex, c.y - ey) - c.r; if (dd < best) { best = dd; ci = j; } });
    // (only where the crown's clumps reach: never a leaf on its own out past them)
    if (best > sr * 0.4) continue;
    groups.push({ ...groupOf(ex, ey, sr * (0.85 + r() * 0.3), bandOf(litAt(ex, ey, clumps[ci]) - 0.08), ci), edge: true });
  }
  // (clump by clump, its edge groups first)
  groups.sort((p, q) => p.c - q.c || (q.edge ? 1 : 0) - (p.edge ? 1 : 0));
  const draw = (gr: Group, k: number, flat = false, dx = 0, dy = 0, alpha = 1) => {
    const h = clumps[gr.c].hue, c0 = band(k), col: RGB = [c0[0] + h, c0[1] + h * 0.3, c0[2] - h * 0.4];
    const shade = k <= 2, o: StrokeOpts = { sun, bumps: 0, flat, alpha, ...(flat ? {} : { rim: shade ? P.shadeRim : P.sunRim, rimCol: shade ? P.shadeRimCol : undefined, texMin: shade ? P.shadeTex : 0.35 }) };
    for (const s of gr.arms) stroke(g, s.x + dx, s.y + dy, s.a, s.len, s.wid, col, s.sd, { ...o, bumps: s.bumps });
  };
  // (shadows fall away from the sun)
  const ox = -sun[0] * sr * 0.12, oy = -sun[1] * sr * 0.12;
  // Under it all: the crown's deep shade, solid inside its edge, then in the groups' own shapes.
  // (no further out than the clumps' leaves reach all the way round: on a big crown's small
  // leaves, its smooth edge showed past them between the clumps, a near-black blob)
  let fit = 0.8;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * 6.2832, ux = Math.cos(a), uy = Math.sin(a);
    let reach = 0;
    for (const c of clumps) {
      const dx = c.x - x, dy = c.y - y, along = dx * ux + dy * uy, rad = c.r * 0.9 + sr * 0.3, off = rad * rad - (dx * dx + dy * dy - along * along);
      if (off > 0) reach = Math.max(reach, along + Math.sqrt(off));
    }
    fit = Math.min(fit, reach / edgeAt(a));
  }
  fit = Math.max(0.35, fit);
  const deep = mix(band(0), shadowC, 0.5);
  if (rec) { rec.crown = [x, y, R * P.env, P.envLump, eph, eph2, 0, 0]; /* (7th: 0 leafy, 1 pine) */ put(0, 0, 0, 0, 0, 3, 1, 0, deep[0], deep[1], deep[2], 0, 0, 0, 0, 0, x, y, (R * P.env * fit) / 0.8, ...rec.crown.slice(3)); }
  else {
    g.fillStyle = css(deep);
    g.beginPath();
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * 6.2832, rr = edgeAt(a) * fit; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  for (const o of groups) for (const s of o.arms) stroke(g, s.x + ox * 0.6, s.y + oy * 0.6, s.a, s.len, s.wid, deep, s.sd, { sun, bumps: s.bumps, flat: true });
  // (its limbs, showing here and there between the clumps)
  if (rec) for (const c of clumps) put(x, y, c.x, c.y, Math.max(0.6, R * 0.025), 4, 0.9, 0, 60, 46, 30, 0, 0, 0, 0, 0, ...rec.crown);
  else {
    g.strokeStyle = "rgba(60,46,30,0.9)"; g.lineCap = "round";
    for (const c of clumps) { g.lineWidth = Math.max(0.6, R * 0.025); g.beginPath(); g.moveTo(x, y); g.lineTo(c.x, c.y); g.stroke(); }
  }
  const blur = sr * 0.06;
  let last = -1;
  for (const o of groups) {
    if (o.c !== last) { last = o.c; for (const q of under) if (q.c === o.c) draw(q, q.k + 1); }
    // (each group's soft shadow on the leaves under it, never past the crown's edge)
    if (rec) { rec.soft = blur >= 0.5 ? Math.max(0.8, blur) : 0.35; draw(o, o.k - 3, true, ox * 1.4, oy * 1.4, 0.6); rec.soft = 0; }
    else {
      g.save(); g.globalCompositeOperation = "source-atop"; if (blur >= 0.5) g.filter = `blur(${Math.max(0.8, blur).toFixed(1)}px)`;
      draw(o, o.k - 3, true, ox * 1.4, oy * 1.4, 0.6);
      g.restore();
    }
    draw(o, o.k);
  }
};

// ---------------------------------------------------------------- one pine

/** A pine, as the reference paints it: fronds out from the trunk in rings, each a fan of lobed
 * leaflets (wider toward the tip, a lighter vein down each), the outer, lower rings first, their
 * stems showing between them, a dark leaf-green shade under it all. Its green is the map's own
 * (`base`), its light and shade between a pine's teal and the map's warm olive. No two alike: each
 * its own count of fronds, their length and spread, leaflet width, lumps, green and sun. */
const PINE = { shadow: [22, 56, 66] as RGB, sun: [206, 196, 78] as RGB, lo: -0.6, hi: 0.72, wid: 0.72, bumps: 9, noise: 0.7, shadeRimCol: [96, 146, 146] as RGB };
const paintPine = (g: Ctx, x: number, y: number, R: number, base: RGB, seed: number, sun: number[]) => {
  const r = rng(seed * 1e6 + 7);
  // (this pine's own: how dense, how long and wide its fronds and leaflets, how lumpy, how sunny,
  // its green a touch lighter or darker, bluer or yellower)
  const dense = 0.8 + r() * 0.4, flen = 0.9 + r() * 0.24, spread0 = 0.65 + r() * 0.3, wid = PINE.wid * (0.86 + r() * 0.24);
  const lump = 0.03 + r() * 0.05, sunny = (r() - 0.5) * 0.16, li = 0.9 + r() * 0.2, hue = (r() - 0.5) * 16;
  const col0: RGB = [base[0] * li + hue * 0.6, base[1] * li, base[2] * li - hue * 0.4];
  const shadow = mix(PINE.shadow, GREEN_SHADE, 0.45), sunC = mix(PINE.sun, GREEN_SUN, 0.45);
  const band = (v: number) => (v < 0 ? mix(col0, shadow, Math.min(1, -v)) : mix(col0, sunC, Math.min(1, v)));
  const tone = (lit: number) => band(PINE.lo + (PINE.hi - PINE.lo) * Math.max(0, Math.min(1, lit + sunny)));
  const toSun = (dx: number, dy: number) => (dx * sun[0] + dy * sun[1]) / R;
  const a0 = r() * 6.2832, eph = r() * 7, f3 = 2 + Math.floor(r() * 3);
  // (small pines: fewer, simpler fronds, so they read at their size)
  const small = Math.max(0.45, Math.min(1, R / 34));
  // (a big pine: more fronds round each ring, each the size a middling pine's are)
  const big = pxPerFt > 0 ? Math.max(1, Math.min(2.4, R / (13 * pxPerFt))) : 1;
  // (its shade inside, round and lumpy: a gap between fronds is shade, not a hole)
  const deep = tone(0.08), shadeR = R * 0.74;
  if (rec) { rec.crown = [x, y, shadeR / 0.8, lump, eph, a0, 1, 0]; put(0, 0, 0, 0, 0, 3, 1, 0, deep[0], deep[1], deep[2], 0, 0, 0, 0, 0, ...rec.crown); }
  else {
    g.fillStyle = css(deep);
    g.beginPath();
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * 6.2832, rr = shadeR * (1 + lump * Math.sin(a * 3 + eph) + lump * 0.6 * Math.sin(a * 5 + a0)); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  // (the crown's edge: round, gently lumpy; no leaflet reaches past it)
  const edgeAt = (a: number) => R * 1.02 * (1 + lump * Math.sin(a * f3 + eph) + lump * 0.6 * Math.sin(a * 5 + eph * 2));
  const blur = (len: number) => Math.max(0.5, len * 0.025);
  const leaflet = (bx: number, by: number, a: number, len: number, lit: number) => {
    const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len, d = Math.hypot(tx - x, ty - y), m = edgeAt(Math.atan2(ty - y, tx - x));
    if (d > m) len = Math.max(len * 0.55, len - (d - m));
    const sd = Math.floor(r() * 1e6), w = len * wid * (0.85 + r() * 0.3), bumps = PINE.bumps + Math.floor(r() * 3), shade = lit < 0.35;
    // (its soft shadow, only on what's painted already)
    const sc = mix(tone(lit - 1.0), shadow, 0.35);
    if (rec) { rec.soft = blur(len); stroke(g, bx - sun[0] * len * 0.17, by - sun[1] * len * 0.17, a, len * 1.06, w * 1.08, sc, sd, { sun, bumps, flat: true, alpha: 0.82, pine: true }); rec.soft = 0; }
    else {
      g.save(); g.globalCompositeOperation = "source-atop"; g.filter = `blur(${blur(len).toFixed(1)}px)`;
      stroke(g, bx - sun[0] * len * 0.17, by - sun[1] * len * 0.17, a, len * 1.06, w * 1.08, sc, sd, { sun, bumps, flat: true, alpha: 0.82, pine: true });
      g.restore();
    }
    stroke(g, bx, by, a, len, w, tone(lit), sd, { sun, bumps, pine: true, rim: shade ? 0.38 : 0.12, rimCol: shade ? PINE.shadeRimCol : undefined, texMin: shade ? 0.25 : 0.4, veins: shade ? 0.18 : 0.32 });
  };
  type Frond = { ri: number; a: number; x: number; y: number; len: number; up: number; toS: number; dl: number };
  const fronds: Frond[] = [];
  const rings: [number, number, number, number][] = [[0.6, 14, 0.33, 0], [0.42, 11, 0.31, 0.08], [0.25, 8, 0.29, 0.16], [0.08, 4, 0.27, 0.26]];
  rings.forEach(([d, cnt, fl, up], ri) => {
    const m = Math.max(3, Math.round((cnt + Math.floor(r() * 3)) * dense * small * big)), b0 = a0 + ri * (0.3 + r() * 0.3);
    for (let i = 0; i < m; i++) {
      const a = b0 + (i / m) * 6.2832 + (r() - 0.5) * 0.35, dd = R * d * (0.88 + r() * 0.24), pa = a + (r() - 0.5) * (ri === 3 ? 3 : 0.32);
      fronds.push({ ri, a: pa, x: x + Math.cos(a) * dd, y: y + Math.sin(a) * dd, len: R * fl * flen * (0.85 + r() * 0.3) / Math.sqrt(small) / Math.sqrt(big), up, toS: Math.cos(pa) * sun[0] + Math.sin(pa) * sun[1], dl: (r() - 0.5) * 0.25 });
    }
  });
  fronds.sort((p, q) => p.ri - q.ri || p.toS - q.toS);
  // (the stems, from part way out, showing between the outer fronds)
  for (const f of fronds) if (f.ri === 0) {
    const sx = x + (f.x - x) * 0.3, sy = y + (f.y - y) * 0.3, lw = Math.max(0.8, R * 0.026);
    if (rec) put(sx, sy, f.x, f.y, lw, 4, 0.95, 0, 68, 48, 32, 0, 0, 0, 0, 0, ...rec.crown);
    else { g.strokeStyle = "rgba(68,48,32,0.95)"; g.lineCap = "round"; g.lineWidth = lw; g.beginPath(); g.moveTo(sx, sy); g.lineTo(f.x, f.y); g.stroke(); }
  }
  for (const f of fronds) {
    const n = small < 0.7 ? 3 + Math.floor(r() * 2) : 4 + Math.floor(r() * 3), spread = spread0 + r() * 0.25, order: number[] = [];
    for (let i = 0; i < n; i++) order.push((i / (n - 1)) * 2 - 1);
    // (the side leaflets first, the middle one on top)
    order.sort((p, q) => Math.abs(q) - Math.abs(p));
    for (const t of order) {
      const a = f.a + t * spread + (r() - 0.5) * 0.15, len = f.len * (1 - 0.28 * Math.abs(t)) * (0.9 + r() * 0.2);
      const lit = 0.44 + f.up + f.dl + toSun(f.x - x + Math.cos(a) * len * 0.5, f.y - y + Math.sin(a) * len * 0.5) * 0.95 + (r() - 0.5) * PINE.noise * 0.6;
      leaflet(f.x - Math.cos(a) * len * 0.08, f.y - Math.sin(a) * len * 0.08, a, len, lit);
    }
  }
};

/** A tree's own canvas: its size, and where it lands on the map (to the pixel, so it's painted the
 * same wherever it's painted). */
const sizeOf = (t: BrushTree) => Math.ceil(t.r * 3.4) + 24;
let own: AnyCanvas | null = null;
/** One tree painted on its own canvas (`c`, at least its size; cleared first). */
export const paintTree = (c: AnyCanvas, t: BrushTree, sun: number[]) => {
  const S = sizeOf(t), half = S / 2, o = ctx2d(c);
  o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, S, S);
  (t.pine ? paintPine : paintCrown)(o, half + (t.x - Math.floor(t.x)), half + (t.y - Math.floor(t.y)), t.r, t.col, t.seed, sun);
  return S;
};
const layTree = (g: Ctx, img: CanvasImageSource, t: BrushTree, S: number) => g.drawImage(img, 0, 0, S, S, Math.floor(t.x) - S / 2, Math.floor(t.y) - S / 2, S, S);

// ---------------------------------------------------------------- the workers
type Painted = { S: number; bm: ImageBitmap }[];
let pool: Worker[] | null = null;
const canWork = () => typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
const workers = () => {
  if (pool) return pool;
  const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  try { pool = Array.from({ length: n }, () => new Worker(new URL("./brushCrown.worker.ts", import.meta.url), { type: "module" })); }
  catch { pool = []; }
  return pool;
};
let jobId = 0;
const waiting = new Map<number, (p: unknown) => void>();
const ask = <T = Painted>(w: Worker, trees: BrushTree[], sun: number[], scale: number, list = false) => new Promise<T | null>(res => {
  const id = ++jobId;
  waiting.set(id, res as (p: unknown) => void);
  if (!(w as unknown as { told?: boolean }).told) {
    (w as unknown as { told?: boolean }).told = true;
    w.onmessage = (e: MessageEvent<{ id: number; out: unknown }>) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data.out); };
    w.onerror = () => { for (const [k, f] of waiting) { waiting.delete(k); f(null); } };
  }
  w.postMessage({ id, trees, sun, scale, list });
});

/** Trees' strokes listed for the graphics chip, in order (a worker's, or the page's own). */
export type Listed = { data: Float32Array; n: number };
let nowhere: Ctx | null = null;
export const listTrees = (trees: BrushTree[], sun: number[], into?: Listed): Listed => {
  const r: Rec = { data: into?.data ?? new Float32Array(Math.max(1024, trees.length * 400) * OP), n: 0, soft: 0, crown: [0, 0, 1, 0, 0, 0, 0, 0] };
  // (nothing is drawn while strokes are listed: a canvas for the shape of the calls)
  nowhere ??= canvas(1, 1).getContext("2d") as Ctx;
  for (const t of trees) {
    rec = r;
    try { (t.pine ? paintPine : paintCrown)(nowhere, t.x, t.y, t.r, t.col, t.seed, sun); } finally { rec = null; }
  }
  return { data: r.data, n: r.n };
};

/** A thing for the painter's driver to wait for (lib/forest: forestCanvasAsync); what it gives is
 * handed back into the steps. A driver that can't wait hands back nothing. */
export type Wait = { wait: Promise<unknown> };

/** The trees, painted one by one (each on its own canvas, then laid on the map), those away from
 * the sun first so the sunny side of the woods lies over the rest; a step at a time, so the page
 * stays free while they paint. Where the browser can and the driver waits, the workers paint them,
 * a batch each at a time, and here they're laid on the map in order. `sun`: toward the sun. */
/** The map's scale while its trees paint (pixels a foot; 0: not known): leaves a real size. */
let pxPerFt = 0;
/** (a worker's: the map's scale, for the trees it paints) */
export const setPxPerFt = (v: number) => { pxPerFt = v; };
// (one map's trees on the chip at a time: its sun, light and tile size are set for the whole map,
// so another map's trees painted in between would land with the wrong ones; the next waits)
let chipBusy = false, chipFree: (() => void)[] = [];
const freeChip = () => { chipBusy = false; const f = chipFree; chipFree = []; f.forEach(go => go()); };
export function* drawBrushedSteps(g: Ctx, trees: BrushTree[], sun: number[], scale = 0): Generator<void | Wait, void, unknown> {
  pxPerFt = scale;
  // (the shorter trees first, in four bands of height, so a tall crown lies over the short ones
  // round it, as seen from above; within a band, from the sun's side)
  const hs = trees.map(t => t.h ?? 0).sort((a, b) => a - b);
  const cuts = [0.25, 0.5, 0.75].map(f => hs[Math.floor(f * (hs.length - 1))] ?? 0);
  const band = (t: BrushTree) => (t.h === undefined ? 0 : cuts.filter(c => t.h! > c).length);
  const sorted = [...trees].sort((p, q) => band(p) - band(q) || p.x * sun[0] + p.y * sun[1] - (q.x * sun[0] + q.y * sun[1]));
  const t0 = performance.now();
  let listing = 0, painting = 0, strokes = 0;
  // The graphics chip, where there is one: the trees' strokes listed a slice at a time, painted a
  // batch at a time (a batch ends between trees: a tree's shadows fall on its own leaves)
  let p = gpuPainter();
  // (another map's trees on the chip: waited for; a driver that can't wait paints these the other way)
  while (p && chipBusy) {
    const turn = yield { wait: new Promise<boolean>(go => chipFree.push(() => go(true))) };
    if (turn !== true) p = null;
    else p = gpuPainter();
  }
  if (p && sorted.length) {
    chipBusy = true;
    let map: ReturnType<typeof beginMap> = null, ended = false;
    try {
      const W = g.canvas.width, H = g.canvas.height, BATCH = 120000;
      const look = { sun, light: mix(P.sun, [255, 255, 255], 0.3), dark: P.shadow, shadeRim: P.shadeRimCol, tex: P.tex, lift: P.lift, sink: P.sink, scallop: P.scallop };
      // (listing only while a tree is listed: other painting in between paints as usual)
      const mine: Rec = { data: new Float32Array(BATCH * OP * 1.25), n: 0, soft: 0, crown: [0, 0, 1, 0, 0, 0, 0, 0] };
      map = beginMap(p, W, H, look, bristles() as TexImageSource);
      let ok = !!map, i = 0, since = performance.now();
      // (many trees: their strokes listed by the workers, a slice each, a few slices ahead, and
      // painted here in order as they come; the very strokes the page would list)
      const ws = canWork() ? workers() : [];
      if (ws.length > 1 && sorted.length > 200) {
        const SLICE = 64, slices: BrushTree[][] = [];
        for (let k = 0; k < sorted.length; k += SLICE) slices.push(sorted.slice(k, k + SLICE));
        const asked: Promise<Listed | null>[] = [], ahead = ws.length * 3;
        const more = (done: number) => { while (asked.length < slices.length && asked.length < done + ahead) { const k = asked.length; asked.push(ask<Listed>(ws[k % ws.length], slices[k], sun, scale, true)); } };
        more(0);
        for (let k = 0; k < slices.length && ok; k++) {
          const l0 = performance.now();
          let got = (yield { wait: asked[k] }) as Listed | null | undefined;
          // (the driver can't wait, or a worker failed: listed here)
          if (!got) { pxPerFt = scale; got = listTrees(slices[k], sun, mine); mine.data = got.data; }
          listing += performance.now() - l0;
          more(k + 1);
          const q0 = performance.now();
          ok = paintBatch(p, map!, got.data, got.n);
          painting += performance.now() - q0; strokes += got.n;
          i += slices[k].length;
          if (performance.now() - since > 12) { yield; since = performance.now(); }
        }
      }
      for (; i < sorted.length && ok; i++) {
        const t = sorted[i], l0 = performance.now();
        rec = mine;
        // (this map's scale, each tree: another map's trees may have painted in between)
      pxPerFt = scale;
      try { (t.pine ? paintPine : paintCrown)(g, t.x, t.y, t.r, t.col, t.seed, sun); } finally { rec = null; }
        listing += performance.now() - l0;
        if (mine.n >= BATCH || i === sorted.length - 1) {
          const q0 = performance.now();
          ok = paintBatch(p, map!, mine.data, mine.n);
          painting += performance.now() - q0; strokes += mine.n; mine.n = 0;
        }
        if (performance.now() - since > 12) { yield; since = performance.now(); }
      }
      if (map) { const q0 = performance.now(); ended = true; ok = endMap(p, map, g) && ok; painting += performance.now() - q0; }
      if (ok) { told(sorted.length, strokes, listing, painting, performance.now() - t0, `graphics chip, ${W} x ${H}`); return; }
      // (the chip was lost: nothing of it reached the map; all the trees painted the other way)
    } finally {
      // (stopped part way, or done: its tiles let go and the chip free for the next map)
      if (map && !ended) dropMap(p, map);
      freeChip();
    }
  }
  const ws = canWork() ? workers() : [];
  if (ws.length && sorted.length > 24) {
    const BATCH = 24, batches: BrushTree[][] = [];
    for (let i = 0; i < sorted.length; i += BATCH) batches.push(sorted.slice(i, i + BATCH));
    // (a few batches ahead for each worker, laid on the map in order as they come; their pictures
    // let go once laid, so only those few are held)
    const asked: Promise<Painted | null>[] = [];
    const ahead = ws.length * 2;
    const more = () => { while (asked.length < batches.length && asked.length < done + ahead) { const k = asked.length; asked.push(ask(ws[k % ws.length], batches[k], sun, scale)); } };
    let done = 0;
    more();
    for (; done < batches.length; ) {
      const got = (yield { wait: asked[done] }) as Painted | null | undefined;
      if (!got) break;
      batches[done].forEach((t, i) => { layTree(g, got[i].bm, t, got[i].S); got[i].bm.close(); });
      done++;
      more();
    }
    if (done === batches.length) { told(sorted.length, 0, 0, 0, performance.now() - t0, "workers"); return; }
    // (the driver can't wait, or a worker failed: the rest painted here)
    sorted.splice(0, done * BATCH);
  }
  let since = performance.now();
  for (const t of sorted) {
    const S = sizeOf(t);
    if (!own || own.width < S) own = canvas(Math.max(S, 128), Math.max(S, 128));
    pxPerFt = scale;
    paintTree(own, t, sun);
    layTree(g, own as CanvasImageSource, t, S);
    if (performance.now() - since > 12) { yield; since = performance.now(); }
  }
  told(sorted.length, 0, 0, 0, performance.now() - t0, "page");
}

/** How long the trees took, the last time (and to anyone listening: ?timing=1 shows it). */
export let treeTiming: { trees: number; strokes: number; listing: number; painting: number; total: number; how: string } | null = null;
const told = (trees: number, strokes: number, listing: number, painting: number, total: number, how: string) => {
  treeTiming = { trees, strokes, listing: Math.round(listing), painting: Math.round(painting), total: Math.round(total), how };
  if (typeof window !== "undefined") { (window as unknown as { __dgTreeTiming: unknown }).__dgTreeTiming = treeTiming; window.dispatchEvent(new CustomEvent("dg-tree-timing", { detail: treeTiming })); }
};
