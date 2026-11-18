// Rocks: boulders, blocks, ledges, outcrops, clusters and dry-stone walls, each made from its
// numbers (kind, size, edges, a seed; or an outline drawn by hand), so a saved rock is a handful of
// fields and any size keeps its surface at true scale. Shapes: a superellipsoid (egg to brick) cut by
// a few flat breaks with soft corners, then lumps and grain in feet; a drawn outline grows a rock
// from how far each spot is from its edge, so any outline works. Surface: the stone's scan laid by
// direction (triplanar), so there are no seams or stretching; worn edges lighter, hollows darker;
// moss on what faces up and in hollows, lichen, and earth at the foot, all worked out in the shader.
// Scans: public/rocks (CC0, see its SOURCES.md; scripts/rock-scans.py).
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RockItem, RockKind, RockProfile, RockStone } from "../types";
import { stoneShown } from "../constants";

type V = [number, number];
/** What one rock (or one piece of a cluster or wall) is made from, in its own feet. */
type Spec = {
  kind: RockKind; L: number; W: number; H: number; jag: number; seed: number; sunk: number; detail: number;
  outline?: V[]; profile?: RockProfile; p?: number; slab?: boolean;
  x?: number; y?: number; z?: number; rot?: number; tilt?: number;
};

// ---------- seeded random and gradient noise ----------
const rng = (seed: number) => {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
type Noise = (x: number, y: number, z: number) => number;
const makeNoise = (seed: number): Noise => {
  const R = rng(seed * 7 + 3), p = new Uint8Array(512), perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const g = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10), lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number, z: number) => { const v = g[h % 12]; return v[0] * x + v[1] * y + v[2] * z; };
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  };
};
const fbm = (n: Noise, x: number, y: number, z: number, oct: number) => { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the kinds' shapes ----------
/** p: how square (2 an egg); planes: how many flat breaks, cut: how deep, round: how soft their
 * corners (rounded to jagged), amp: the big lumps. */
const SHAPE: Record<RockKind, { p?: number; planes?: [number, number]; cut?: [number, number]; round?: [number, number]; amp?: number; layered?: boolean; dip?: boolean }> = {
  boulder: { p: 2.3, planes: [3, 6], cut: [0.72, 0.92], round: [0.55, 0.2], amp: 0.07 },
  block: { p: 3.2, planes: [9, 14], cut: [0.55, 0.82], round: [0.16, 0.025], amp: 0.035 },
  ledge: { p: 4.2, planes: [6, 9], cut: [0.7, 0.9], round: [0.2, 0.04], amp: 0.03, layered: true },
  outcrop: { planes: [5, 8], cut: [0.62, 0.9], round: [0.3, 0.06], amp: 0.13, dip: true },
  cluster: {},
  wall: {}
};

const curve = (pts: V[]) => new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), true, "centripetal");
/** A drawn outline as the editor draws it: smoothed through its points (plan feet round the middle). */
export const rockOutlinePoints = (pts: V[], n = 120): V[] => curve(pts).getPoints(n).map(p => [p.x, p.z]);

/** A rock grown from a drawn outline of any shape: its height at each spot from how far it is from
 * the edge, shaped by the profile. Ground at y = 0; it meets the ground right on the outline. */
function outlineRock(o: Spec) {
  const poly = rockOutlinePoints(o.outline!, 240);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const span = Math.max(x1 - x0, z1 - z0, 0.5), cell = span / Math.max(12, Math.round(o.detail * 3.2)), pad = cell * 2;
  const nx = Math.ceil((x1 - x0 + pad * 2) / cell), nz = Math.ceil((z1 - z0 + pad * 2) / cell);
  const sd = new Float32Array((nx + 1) * (nz + 1));
  const inside = (x: number, z: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const edge = (x: number, z: number) => { let m = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); m = Math.min(m, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return m; };
  let dmax = 1e-3;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 - pad + i * cell, z = z0 - pad + j * cell, d = edge(x, z) * (inside(x, z) ? 1 : -1); sd[j * (nx + 1) + i] = d; dmax = Math.max(dmax, d); }
  // (soften the ridge where two edges are equally far, so no crease runs along the top)
  for (let pass = 0; pass < 4; pass++) {
    const t = sd.slice();
    for (let j = 1; j < nz; j++) for (let i = 1; i < nx; i++) { const k = j * (nx + 1) + i; if (t[k] <= cell) continue; sd[k] = (t[k] * 4 + t[k - 1] + t[k + 1] + t[k - nx - 1] + t[k + nx + 1]) / 8; }
  }
  const noise = makeNoise(o.seed), jag = o.jag, Hup = o.H * (1 - o.sunk), prof = o.profile ?? "round";
  const reachIn = Math.min(dmax, Math.max(Hup * 1.1, dmax * 0.55));
  const round = (t: number) => Math.sqrt(1 - (1 - t) ** 2);
  const shape = (t: number) => (prof === "flat" ? 1 - (1 - t) ** 5 : prof === "peak" ? 0.45 * round(t) + 0.55 * Math.pow(t, 1.15) : round(t));
  const geo = new THREE.PlaneGeometry(1, 1, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const i = k % (nx + 1), j = Math.floor(k / (nx + 1)), x = x0 - pad + i * cell, z = z0 - pad + j * cell, d = sd[j * (nx + 1) + i];
    let y: number;
    if (d <= 0) y = d * 3; // (just outside the line it's under the ground, so it meets the ground right on it)
    else {
      const t = Math.min(1, d / reachIn), tm = Math.min(1, d / dmax);
      y = Hup * (prof === "peak" ? shape(tm) : shape(t) * (0.92 + 0.08 * tm));
      y += (0.1 * Math.max(1, span * 0.5) * fbm(noise, x * 0.35, 0, z * 0.35, 3) + (0.12 + 0.12 * jag) * fbm(noise, x * 0.9 + 4, 0, z * 0.9, 3) + (0.05 + 0.1 * jag) * fbm(noise, x * 1.8 + 9, 0, z * 1.8, 3)) * Math.min(1, d * 1.5);
    }
    pos.setXYZ(k, x, y, z);
  }
  geo.deleteAttribute("uv");
  geo.computeVertexNormals();
  addCurvature(geo);
  geo.userData.grounded = true;
  return geo;
}

/** One stone of a wall, in feet, centred on its middle: a block `p` square (2 an egg), `jag` rough. */
export const wallStone = (L: number, W: number, H: number, jag: number, seed: number, p: number, detail = 2) => rockGeometry({ kind: "block", L, W, H, jag, seed, sunk: 0, detail, p });
export const rockRandom = (seed: number) => rng(seed);

/** One rock's geometry in feet, centred on its middle (a drawn one: ground at y = 0). */
function rockGeometry(o: Spec): THREE.BufferGeometry {
  if (o.outline && o.outline.length >= 3) return outlineRock(o);
  const K = SHAPE[o.kind], R = rng(o.seed), noise = makeNoise(o.seed);
  const ax = o.L / 2, ay = o.H / 2, az = o.W / 2, minD = Math.min(ax, ay, az), maxD = Math.max(ax, ay, az);
  const prof = o.profile ?? "round", jag = o.jag;
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, Math.max(2, Math.round(o.detail)));
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo);
  const support = (n: THREE.Vector3) => Math.sqrt((ax * n.x) ** 2 + (ay * n.y) ** 2 + (az * n.z) ** 2);
  const planes: { n: THREE.Vector3; d: number }[] = [];
  const pl = K.planes ?? [3, 6], cut = K.cut ?? [0.7, 0.9], rd = K.round ?? [0.4, 0.1];
  const nP = Math.round(pl[0] + (pl[1] - pl[0]) * (0.3 + 0.7 * jag) + R() * 1.5);
  const dipAx = new THREE.Vector3(R() - 0.5, 0, R() - 0.5).normalize();
  for (let i = 0; i < nP; i++) {
    let n: THREE.Vector3;
    if (K.layered && i < 2) n = new THREE.Vector3(R() * 0.12 - 0.06, i ? -1 : 1, R() * 0.12 - 0.06).normalize();
    else if (K.layered) { const a = R() * Math.PI * 2; n = new THREE.Vector3(Math.cos(a), R() * 0.5 - 0.25, Math.sin(a)).normalize(); }
    else { n = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1); if (n.lengthSq() < 0.05) n.set(1, 0.2, 0); n.normalize(); }
    if (K.dip) n.applyAxisAngle(dipAx, 0.35);
    const depth = cut[0] + (cut[1] - cut[0]) * R();
    planes.push({ n, d: support(n) * (K.layered && i < 2 ? 0.86 : depth + (1 - depth) * (1 - jag) * 0.35) });
  }
  const k = Math.max(0.03, rd[0] + (rd[1] - rd[0]) * jag) * minD * 2;
  // (a ledge's beds, each set back a little)
  const layers: { y0: number; y1: number; inset: number }[] = [];
  if (K.layered && !o.slab) { let y = -ay; while (y < ay) { const h = o.H * (0.18 + R() * 0.16); layers.push({ y0: y, y1: y + h, inset: R() * 0.1 + (y + h > ay * 0.4 ? 0.05 : 0) }); y += h; } }
  const fA = 1 / Math.max(1.6, maxD * 0.55), fB = 1 / 0.55;
  const P = o.p ?? K.p ?? 2;
  const pos = geo.attributes.position, d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    let r: number;
    if (prof === "round") r = Math.pow(Math.abs(d.x / ax) ** P + Math.abs(d.y / ay) ** P + Math.abs(d.z / az) ** P, -1 / P);
    else {
      // (its side by the profile: a flat top or a peak; from above, the oval)
      const h = Math.hypot(d.x, d.z), t = Math.atan2(d.z, d.x);
      const Rh = Math.pow(Math.abs(Math.cos(t) / ax) ** P + Math.abs(Math.sin(t) / az) ** P, -1 / P);
      const Q = prof === "flat" ? 6 : 1.25, dy = d.y < 0 ? Math.max(2, P) : Q;
      let lo = 0, hi = maxD * 3;
      for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; if ((m * h / Rh) ** P + (m * Math.abs(d.y) / ay) ** dy > 1) hi = m; else lo = m; }
      r = lo;
    }
    for (const p of planes) { const c = d.dot(p.n); if (c > 1e-3) r = smin(r, p.d / c, k); }
    let x = d.x * r, y = d.y * r, z = d.z * r;
    if (layers.length) {
      let s = 0;
      for (const L of layers) { const w = 0.06 * o.H; s += L.inset * smooth(L.y0 - w, L.y0 + w, y) * (1 - smooth(L.y1 - w, L.y1 + w, y)); }
      const seam = layers.reduce((m, L) => Math.max(m, Math.exp(-(((y - L.y0) / (0.035 * o.H)) ** 2))), 0);
      const hs = 1 - s - seam * 0.035;
      x *= hs; z *= hs;
    }
    const big = fbm(noise, x * fA, y * fA, z * fA, 3), fine = fbm(noise, x * fB + 9, y * fB, z * fB, 3);
    const disp = (K.amp ?? 0.05) * maxD * big + (0.05 + 0.08 * jag) * Math.min(1, minD) * fine;
    const len = Math.hypot(x, y, z) || 1;
    x += (x / len) * disp; y += (y / len) * disp; z += (z / len) * disp;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  addCurvature(geo);
  return geo;
}

/** Worn edges (lighter) and hollows (darker, where moss and earth collect), per corner. */
function addCurvature(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index!.array, n = pos.count;
  const sum = new Float32Array(n * 3), cnt = new Float32Array(n), el = new Float32Array(n);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
    for (const [u, v] of [[a, b], [b, a]]) {
      sum[u * 3] += pos.getX(v); sum[u * 3 + 1] += pos.getY(v); sum[u * 3 + 2] += pos.getZ(v); cnt[u]++;
      el[u] += Math.hypot(pos.getX(v) - pos.getX(u), pos.getY(v) - pos.getY(u), pos.getZ(v) - pos.getZ(u));
    }
  }
  let c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = cnt[i] || 1, dx = pos.getX(i) - sum[i * 3] / m, dy = pos.getY(i) - sum[i * 3 + 1] / m, dz = pos.getZ(i) - sum[i * 3 + 2] / m;
    c[i] = (dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i)) / (el[i] / m || 1);
  }
  for (let pass = 0; pass < 2; pass++) {
    const s2 = new Float32Array(n), k2 = new Float32Array(n);
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + ((e + 1) % 3)]; s2[a] += c[b]; k2[a]++; s2[b] += c[a]; k2[b]++; }
    for (let i = 0; i < n; i++) s2[i] = (c[i] + s2[i]) / (1 + k2[i]);
    c = s2;
  }
  for (let i = 0; i < n; i++) c[i] = Math.max(-1, Math.min(1, c[i] * 9));
  geo.setAttribute("curv", new THREE.BufferAttribute(c, 1));
}

/** The pieces an item is made of, in its own feet (ground at y = 0): one rock, or a ledge's beds,
 * an outcrop's tilted beds, a cluster's rocks, a wall's courses of stones. q: detail (1 close up). */
function rockPieces(o: Spec, q: number): Spec[] {
  const dt = (d: number) => Math.max(2, Math.round(d * q));
  if (o.kind === "ledge" && !o.outline) {
    const R = rng(o.seed + 77), out: Spec[] = [], n = Math.max(2, Math.min(4, Math.round(o.H / 0.9)));
    let y = 0, l = o.L, w = o.W, cx = 0, cz = 0;
    const sunkH = o.sunk * o.H;
    for (let i = 0; i < n; i++) {
      const h = (o.H / n) * (0.9 + R() * 0.35);
      out.push({ kind: "ledge", slab: true, L: l, W: w, H: h * 1.12, jag: 0.6 + o.jag * 0.4, seed: o.seed * 23 + i * 9, sunk: 0, x: cx, z: cz, y: y + h / 2 - sunkH, rot: (R() - 0.5) * 0.12, tilt: (R() - 0.5) * 0.03, detail: dt(30), p: 4.6 });
      y += h; l *= 0.68 + R() * 0.2; w *= 0.7 + R() * 0.2; cx += (R() - 0.5) * o.L * 0.15; cz += (R() - 0.5) * o.W * 0.12;
    }
    return out;
  }
  if (o.kind === "outcrop" && !o.outline) {
    const R = rng(o.seed + 55), out: Spec[] = [], n = 3 + Math.floor(R() * 2 + o.L / 14);
    const dip = 0.34 + R() * 0.2, yaw = R() * 0.5 - 0.25;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      const L = o.L * (0.45 + R() * 0.25), W = o.W * (0.6 + R() * 0.35), H = o.H * (1.0 + R() * 0.5);
      out.push({ kind: "block", L, W, H, jag: 0.55 + o.jag * 0.45, seed: o.seed * 17 + i * 11, x: t * o.L * 0.6 + (R() - 0.5) * o.L * 0.08, z: (R() - 0.5) * o.W * 0.3,
        rot: yaw + (R() - 0.5) * 0.3, tilt: dip * (0.8 + R() * 0.4), sunk: o.sunk * (0.75 + R() * 0.5), detail: dt(26), p: 3.8 });
    }
    return out;
  }
  if (o.kind === "cluster") {
    const R = rng(o.seed + 101), out: Spec[] = [], spots: { x: number; z: number; r: number }[] = [];
    const n = 3 + Math.floor(R() * 3 + o.L / 8);
    for (let i = 0; i < n * 6 && spots.length < n; i++) {
      const big = spots.length === 0, s = big ? 1 : 0.35 + R() * 0.45;
      const L = Math.min(o.L, o.W) * 0.62 * s * (0.9 + R() * 0.3), W = L * (0.6 + R() * 0.3), H = o.H * s * (0.75 + R() * 0.35);
      const x = big ? (R() - 0.5) * o.L * 0.15 : (R() - 0.5) * (o.L - L), z = big ? (R() - 0.5) * o.W * 0.15 : (R() - 0.5) * (o.W - W);
      if (spots.some(p => Math.hypot(p.x - x, p.z - z) < (p.r + Math.max(L, W) / 2) * 0.72)) continue;
      spots.push({ x, z, r: Math.max(L, W) / 2 });
      out.push({ kind: R() < 0.5 ? "boulder" : "block", L, W, H, jag: o.jag, seed: o.seed * 13 + i * 7 + 1, x, z, rot: R() * Math.PI * 2, sunk: 0.15 + R() * 0.15, detail: dt(big ? 30 : 22) });
    }
    return out;
  }
  if (o.kind === "wall") {
    const R = rng(o.seed + 7), out: Spec[] = [];
    let y = 0, row = 0;
    while (y < o.H - 0.2) {
      const top = y + 0.75 > o.H - 0.2;
      const h = top ? Math.max(0.35, o.H - y) : 0.42 + R() * 0.3;
      let x = -o.L / 2 + (row % 2 ? -0.5 : 0);
      while (x < o.L / 2) {
        const l = Math.min(o.L / 2 - x, (top ? 2.0 : 1.4) + R() * 1.4);
        if (l > 0.35) out.push({ kind: "block", L: l * 1.16, W: o.W * (0.9 + R() * 0.2) * (1 - row * 0.03), H: h * 1.18, jag: 0.8 + o.jag * 0.2, seed: o.seed * 31 + out.length * 5 + 3,
          sunk: 0, x: x + l / 2, z: (R() - 0.5) * 0.12, y: y + h / 2 - o.sunk * o.H, rot: (R() - 0.5) * 0.08, tilt: (R() - 0.5) * 0.06, detail: Math.max(2, Math.round(10 * Math.min(1, q * 1.3))), p: 4.5 + R() * 2 });
        x += l;
      }
      y += h * 0.97; row++;
    }
    return out;
  }
  return [{ ...o, kind: o.kind === "ledge" || o.kind === "outcrop" ? "block" : o.kind, detail: dt(o.detail), x: 0, z: 0, rot: 0 }];
}

/** How finely a single rock is made close up, by its size. */
const detailOf = (o: Spec) => Math.min(40, Math.max(18, Math.round(16 + Math.max(o.L, o.W, o.H) * 1.6)));

const specOf = (it: RockItem): Spec => ({
  kind: it.kind, L: Math.max(0.3, it.length), W: Math.max(0.3, it.width), H: Math.max(0.2, it.height), jag: it.edges ?? 0.5, seed: it.seed ?? 1,
  sunk: it.buried ?? ROCK_BURIED[it.kind], detail: 0, profile: it.profile, outline: it.outline && it.outline.length >= 3 && (it.kind === "boulder" || it.kind === "block") ? it.outline.map(p => [p.x, p.y] as V) : undefined
});
/** How deep each kind sits by default (a share of its height). */
export const ROCK_BURIED: Record<RockKind, number> = { boulder: 0.18, block: 0.12, ledge: 0.22, outcrop: 0.4, cluster: 0.15, wall: 0.05 };

/** The whole item as one geometry in its own feet (plan x east, z south), ground at y = 0. */
export function rockItemGeometry(it: RockItem, q = 1): THREE.BufferGeometry {
  const o = specOf(it);
  o.detail = detailOf(o);
  const parts = rockPieces(o, q), geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler();
  for (const p of parts) {
    const g = rockGeometry(p);
    g.computeBoundingBox();
    const y = g.userData.grounded ? 0 : p.y != null ? p.y : -g.boundingBox!.min.y - p.sunk * p.H;
    e.set(p.tilt ?? 0, p.rot ?? 0, 0);
    qt.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x ?? 0, y, p.z ?? 0), qt, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    geos.push(g);
  }
  const all = geos.length === 1 ? geos[0] : mergeGeometries(geos) ?? geos[0];
  if (geos.length > 1) geos.forEach(g => g.dispose());
  all.computeBoundingBox();
  all.computeBoundingSphere();
  return all;
}

/** Its outline where it meets the ground, seen from above (plan feet round its middle, before its
 * turn): for the map's drawing and the picked outline. n points round. */
export function rockFootprint(geo: THREE.BufferGeometry, n = 48): V[] {
  const pos = geo.attributes.position, best = new Array(n).fill(0);
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < -0.05) continue;
    const x = pos.getX(i), z = pos.getZ(i), k = ((Math.round((Math.atan2(z, x) / (Math.PI * 2)) * n) % n) + n) % n;
    best[k] = Math.max(best[k], Math.hypot(x, z));
  }
  return best.map((r, k) => { const v = r || Math.max(best[(k + 1) % n], best[(k + n - 1) % n]) || 0.5; const a = (k / n) * Math.PI * 2; return [Math.cos(a) * v, Math.sin(a) * v] as V; });
}

// ---------- the stones ----------
/** Each stone: its layer in public/rocks (its grain; basalt has granite's), how many feet its
 * scan covers, and its color. One color a stone, everywhere it shows: the map, a rock, a wall, a
 * rock surface, steep rock and its swatch are all constants' stoneShown (the scan gives its light
 * and dark and a little of its own hues: it's laid at its own average, so the average is the
 * stone's color). */
export const STONE_LOOK: Record<RockStone, { layer: number; tile: number; mean: string }> = {
  granite: { layer: 0, tile: 6.5, mean: stoneShown("granite") },
  fieldstone: { layer: 1, tile: 5.5, mean: stoneShown("fieldstone") },
  sandstone: { layer: 2, tile: 7, mean: stoneShown("sandstone") },
  basalt: { layer: 0, tile: 4.5, mean: stoneShown("basalt") },
  redgranite: { layer: 3, tile: 6, mean: stoneShown("redgranite") }
};
/** How bright a rock's own color is against its stone's: in the sun a rock's top then comes out
 * its stone's color, as the map paints it (measured: mockups/walls/measure.py), and pale granite
 * stays under white. */
export const STONE_K = 0.6;

const S = 512, LAYERS = 4;
// (one set of texture uniforms every rock shares: when the scans arrive, every rock has them)
const shared = {
  tStone: { value: null as THREE.DataArrayTexture | null }, tStoneN: { value: null as THREE.DataArrayTexture | null }, uScans: { value: 0 },
  // (one over each scan's own average color, as the light sees it: a scan times this averages 1)
  uScanInv: { value: Array.from({ length: LAYERS }, () => new THREE.Vector3(1, 1, 1)) }
};
let loading: Promise<void> | null = null;
/** The stones' scans as two stacks of layers, loaded once. */
const loadStones = () => {
  if (loading || typeof document === "undefined") return;
  loading = (async () => {
    const strip = async (name: string, srgb: boolean) => {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}rocks/${name}.jpg`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = S; c.height = S * LAYERS;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, S, S * LAYERS);
      const px = new Uint8Array(g.getImageData(0, 0, S, S * LAYERS).data.buffer);
      if (srgb) {
        const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        for (let l = 0; l < LAYERS; l++) {
          const sum = [0, 0, 0];
          let n = 0;
          for (let i = l * S * S * 4, e = (l + 1) * S * S * 4; i < e; i += 4 * 7) { sum[0] += lin(px[i]); sum[1] += lin(px[i + 1]); sum[2] += lin(px[i + 2]); n++; }
          shared.uScanInv.value[l].set(n / Math.max(1e-4, sum[0]), n / Math.max(1e-4, sum[1]), n / Math.max(1e-4, sum[2]));
        }
      }
      const t = new THREE.DataArrayTexture(px, S, S, LAYERS);
      t.format = THREE.RGBAFormat;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      t.userData.shared = true;
      return t;
    };
    try {
      const [c, n] = await Promise.all([strip("color", true), strip("normal", false)]);
      shared.tStone.value = c; shared.tStoneN.value = n; shared.uScans.value = 1;
    } catch { /* (no scans: the stones' own colors) */ }
  })();
};

const NOISE_GLSL = /* glsl */ `
vec3 rkHash( vec3 p ) { p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) ); return -1.0 + 2.0 * fract( sin( p ) * 43758.5453123 ); }
float rkNoise( vec3 p ) { vec3 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( dot( rkHash( i ), f ), dot( rkHash( i + vec3( 1, 0, 0 ) ), f - vec3( 1, 0, 0 ) ), u.x ), mix( dot( rkHash( i + vec3( 0, 1, 0 ) ), f - vec3( 0, 1, 0 ) ), dot( rkHash( i + vec3( 1, 1, 0 ) ), f - vec3( 1, 1, 0 ) ), u.x ), u.y ),
              mix( mix( dot( rkHash( i + vec3( 0, 0, 1 ) ), f - vec3( 0, 0, 1 ) ), dot( rkHash( i + vec3( 1, 0, 1 ) ), f - vec3( 1, 0, 1 ) ), u.x ), mix( dot( rkHash( i + vec3( 0, 1, 1 ) ), f - vec3( 0, 1, 1 ) ), dot( rkHash( i + vec3( 1, 1, 1 ) ), f - vec3( 1, 1, 1 ) ), u.x ), u.y ), u.z ); }
float rkFbm( vec3 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 4; i++ ) { s += a * rkNoise( p ); p *= 2.03; a *= 0.5; } return s; }
`;

/** A rock's material: its stone's scan by direction, worn edges and hollows, lichen, moss and
 * earth at its foot. One shader for every rock; each has its own numbers. */
/** `surface`: bare rock in the ground (a rock surface's bedrock): no earth at a foot, cracks across
 * it, its edge fading out over a couple of feet (its geometry's aEdge) and grass coming through in
 * patches as much as `gaps` (0 to 1). */
/** `foot`: how high each corner is above the ground comes with the geometry (its `foot`), for
 * stones along a line on a slope (a wall); unset, it's the height above the rock's own middle. */
export function rockMaterial(it: Pick<RockItem, "stone" | "moss" | "lichen" | "seed">, surface?: { gaps: number }, foot = false): THREE.MeshStandardMaterial {
  loadStones();
  const S0 = STONE_LOOK[it.stone] ?? STONE_LOOK.granite;
  const mean = new THREE.Color(S0.mean).multiplyScalar(STONE_K);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  if (surface) Object.assign(mat, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const own = {
    uLayer: { value: S0.layer }, uTile: { value: 1 / S0.tile }, uMean: { value: new THREE.Vector3(mean.r, mean.g, mean.b) },
    uMoss: { value: it.moss ?? 0.2 }, uLichen: { value: it.lichen ?? 0.25 }, uSeed: { value: ((it.seed ?? 1) * 0.37) % 50 }, uGaps: { value: surface?.gaps ?? 0 }
  };
  mat.userData.rock = own;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared, own);
    if (surface) { sh.vertexShader = "#define RK_SURFACE\n" + sh.vertexShader; sh.fragmentShader = "#define RK_SURFACE\n" + sh.fragmentShader; }
    if (foot) { sh.vertexShader = "#define RK_FOOT\n" + sh.vertexShader; sh.fragmentShader = "#define RK_FOOT\n" + sh.fragmentShader; }
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n#ifdef RK_SURFACE\nattribute float aEdge; varying float vEdge;\n#else\nattribute float curv;\n#endif\n#ifdef RK_FOOT\nattribute float foot;\n#endif\nvarying float vCurv; varying vec3 vRP; varying vec3 vWN; varying float vFoot;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n#ifdef RK_SURFACE\nvCurv = 0.0; vEdge = aEdge;\n#else\nvCurv = curv;\n#endif\nvec4 rkW = modelMatrix * vec4( transformed, 1.0 ); vRP = rkW.xyz - modelMatrix[ 3 ].xyz;\n#ifdef RK_FOOT\nvFoot = foot;\n#else\nvFoot = vRP.y;\n#endif\n vWN = normalize( mat3( modelMatrix ) * objectNormal );");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform highp sampler2DArray tStone; uniform highp sampler2DArray tStoneN; uniform float uScans, uLayer, uTile, uMoss, uLichen, uSeed, uGaps; uniform vec3 uMean; uniform vec3 uScanInv[ ${LAYERS} ];
varying float vCurv; varying vec3 vRP; varying vec3 vWN; varying float vFoot;
#ifdef RK_SURFACE
varying float vEdge;
#endif
${NOISE_GLSL}
vec3 rkW3; vec3 rkP; float rkMoss = 0.0; float rkLich = 0.0;
vec3 rkTri( vec3 p ) { return texture( tStone, vec3( p.zy, uLayer ) ).rgb * rkW3.x + texture( tStone, vec3( p.xz, uLayer ) ).rgb * rkW3.y + texture( tStone, vec3( p.xy, uLayer ) ).rgb * rkW3.z; }
vec3 rkTriN( vec3 p, vec3 n ) {
  vec3 s = sign( n ); vec2 ux = p.zy, uy = p.xz, uz = p.xy; ux.x *= s.x; uy.x *= s.y; uz.x *= -s.z;
  vec3 tx = texture( tStoneN, vec3( ux, uLayer ) ).xyz * 2.0 - 1.0, ty = texture( tStoneN, vec3( uy, uLayer ) ).xyz * 2.0 - 1.0, tz = texture( tStoneN, vec3( uz, uLayer ) ).xyz * 2.0 - 1.0;
  tx.x *= s.x; ty.x *= s.y; tz.x *= -s.z;
  tx = vec3( tx.xy + n.zy, abs( tx.z ) * n.x ); ty = vec3( ty.xy + n.xz, abs( ty.z ) * n.y ); tz = vec3( tz.xy + n.xy, abs( tz.z ) * n.z );
  return normalize( tx.zyx * rkW3.x + ty.xzy * rkW3.y + tz.xyz * rkW3.z );
}`)
      .replace("#include <map_fragment>", `
vec3 wn = normalize( vWN );
#ifdef RK_FOOT
// (a wall's stones: broken faces, not rounded ones, each face lit as it lies)
{ vec3 fn = normalize( cross( dFdx( vRP ), dFdy( vRP ) ) ); if ( dot( fn, wn ) < 0.0 ) fn = -fn; wn = normalize( mix( wn, fn, 0.72 ) ); }
#endif
rkW3 = pow( abs( wn ), vec3( 5.0 ) ); rkW3 /= rkW3.x + rkW3.y + rkW3.z;
rkP = vRP * uTile + uSeed;
vec3 alb = uMean;
// (the scan's light and dark on the stone's own color: no glint brighter than twice it)
if ( uScans > 0.5 ) { vec3 sv = min( vec3( 2.0 ), mix( rkTri( rkP ), rkTri( rkP * 0.31 + 0.17 ), 0.35 ) * uScanInv[ int( uLayer ) ] ); alb = uMean * mix( vec3( dot( sv, vec3( 0.3, 0.59, 0.11 ) ) ), sv, 0.6 ); }
alb *= 0.86 + 0.28 * rkFbm( vRP * 0.18 + uSeed );
// (worn edges lighter, hollows darker)
alb *= 1.0 + 0.22 * clamp( vCurv, 0.0, 1.0 ) - 0.38 * clamp( -vCurv, 0.0, 1.0 );
// (lichen: pale spots on open faces)
float ln = rkFbm( vRP * 1.6 + 3.1 + uSeed ) + 0.35 * rkNoise( vRP * 6.0 );
rkLich = smoothstep( 0.42 - uLichen * 0.5, 0.47 - uLichen * 0.5, ln ) * smoothstep( -0.4, 0.3, wn.y ) * step( 0.01, uLichen );
vec3 lc = mix( vec3( 0.36, 0.38, 0.3 ), vec3( 0.42, 0.37, 0.2 ), smoothstep( -0.2, 0.3, rkNoise( vRP * 0.9 + 7.0 ) ) );
alb = mix( alb, lc * ( 0.85 + 0.3 * rkNoise( vRP * 14.0 ) ), rkLich * 0.6 );
// (moss: on what faces up and in hollows, running down the sides in tongues, never on a sharp edge)
float mn = rkFbm( vRP * 0.42 + 11.0 + uSeed ) * 1.2 + 0.3 * rkFbm( vRP * 1.7 + 4.0 ) + 0.12 * rkNoise( vRP * 7.0 );
float streak = rkFbm( vec3( vRP.x * 0.9, 0.0, vRP.z * 0.9 ) + 21.0 ) + 0.5 * rkFbm( vec3( vRP.x * 2.4, vRP.y * 0.3, vRP.z * 2.4 ) + 3.0 );
float up = wn.y * 0.6 + 0.45 * clamp( -vCurv, 0.0, 1.0 ) - 0.5 * clamp( vCurv, 0.0, 1.0 ) + mn * 1.25 + streak * ( 0.5 + 0.9 * uMoss ) + 0.25 * rkNoise( vRP * 2.6 );
float th = 1.0 - uMoss * 1.25;
rkMoss = smoothstep( th, th + 0.05 + 0.1 * smoothstep( 0.4, 1.0, uMoss ), up ) * step( 0.01, uMoss );
rkMoss *= 1.0 - smoothstep( 0.55, 0.75, rkNoise( vRP * 3.3 + 2.0 ) + 0.5 * rkNoise( vRP * 11.0 ) ) * 0.85;
float mt = rkNoise( vRP * 9.0 ) * 0.5 + rkNoise( vRP * 23.0 ) * 0.5;
float rl = dot( alb, vec3( 0.333 ) );
vec3 mc = mix( vec3( 0.075, 0.105, 0.03 ), vec3( 0.2, 0.25, 0.07 ), smoothstep( -0.5, 0.6, rkFbm( vRP * 0.9 + 5.0 ) + mt * 0.7 ) );
mc *= ( 0.6 + 0.9 * rl ) * ( 0.75 + 0.5 * rkNoise( vRP * 31.0 ) ) * ( 0.85 + 0.3 * smoothstep( -0.3, 0.3, rkNoise( vRP * 1.1 + 9.0 ) ) );
alb = mix( alb, mc, rkMoss );
alb *= 1.0 - 0.25 * ( smoothstep( th - 0.06, th + 0.02, up ) - rkMoss );
#ifdef RK_SURFACE
// (bare rock in the ground: cracks across it, darker toward its edge where earth washes over,
// its edge fading out raggedly, grass coming through in patches)
float crack = 1.0 - smoothstep( 0.0, 0.035, abs( rkFbm( vRP * 0.11 + 2.0 ) ) );
alb *= 1.0 - 0.45 * crack;
alb *= ( 1.0 + 0.22 * smoothstep( 0.5, 3.0, vEdge ) ) * ( 0.85 + 0.3 * rkNoise( vRP * 0.05 + 4.0 ) );
float rkE = smoothstep( 0.0, 2.2, vEdge + ( rkNoise( vRP * 0.35 ) ) * 1.6 );
float gb = rkFbm( vRP * 0.16 + 11.0 ) + 0.3 * rkNoise( vRP * 0.9 );
float rkGap = smoothstep( uGaps * 0.9 - 0.44, uGaps * 0.9 - 0.36, gb );
diffuseColor.a *= rkE * mix( 1.0, rkGap, step( 0.01, uGaps ) );
if ( diffuseColor.a < 0.01 ) discard;
#else
// (earth and grass stain at the foot)
float dirt = 1.0 - smoothstep( 0.0, 0.55 + 0.3 * rkNoise( vRP * 1.3 ), vFoot );
alb = mix( alb, alb * vec3( 0.55, 0.5, 0.4 ), dirt * 0.7 );
#endif
diffuseColor.rgb *= alb;`)
      .replace("#include <roughnessmap_fragment>", `
float roughnessFactor = clamp( 1.05 - dot( alb, vec3( 0.2 ) ), 0.62, 0.95 );
roughnessFactor = mix( roughnessFactor, 1.0, max( rkMoss, rkLich * 0.7 ) );`)
      .replace("#include <normal_fragment_maps>", `
#ifdef RK_FOOT
vec3 pn = wn;
#else
vec3 pn = normalize( vWN );
#endif
if ( uScans > 0.5 ) pn = rkTriN( rkP, pn );
pn = normalize( mix( pn, normalize( vWN ), rkMoss * 0.35 ) );
vec3 mb = vec3( rkNoise( vRP * 14.0 + 1.0 ), rkNoise( vRP * 14.0 + 7.0 ), rkNoise( vRP * 14.0 + 13.0 ) ) + 0.5 * vec3( rkNoise( vRP * 37.0 ), rkNoise( vRP * 37.0 + 3.0 ), rkNoise( vRP * 37.0 + 5.0 ) );
pn = normalize( pn + mb * 0.45 * rkMoss );
normal = normalize( ( viewMatrix * vec4( pn, 0.0 ) ).xyz );`)
      // (pale stone facing the sun stays stone: its brightest eases off under white, so its grain
      // and its faces still show)
      .replace("#include <opaque_fragment>", `{ float rkL = max( outgoingLight.r, max( outgoingLight.g, outgoingLight.b ) ); if ( rkL > 0.14 ) outgoingLight *= ( 0.14 + 0.11 * ( 1.0 - exp( -( rkL - 0.14 ) / 0.11 ) ) ) / rkL; }
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => (surface ? "rock-stone-surface-v7" : foot ? "rock-stone-foot-v8" : "rock-stone-v7");
  return mat;
}

/** What makes a rock look as it does (its shape and stone): a change rebuilds it. */
export const rockSignature = (it: RockItem) =>
  JSON.stringify([it.kind, it.stone, it.length, it.width, it.height, it.buried, it.edges, it.moss, it.lichen, it.seed, it.profile, it.outline]);

/** Where a rock gives way to its plainer versions, ft from the eye. */
const LOD_AT = [0, 140, 380];

/** Rock shapes made already, by what shapes them and how fine: a rock's stone, moss or lichen
 * changed, or the rock moved or turned, makes none again. Shared (the 3D view and the map's
 * painter use them; neither frees them), the least used let go past a few dozen. */
const SHAPES = new Map<string, THREE.BufferGeometry>();
const shapeKeyOf = (it: RockItem, q: number) => JSON.stringify([it.kind, it.length, it.width, it.height, it.buried, it.edges, it.seed, it.profile, it.outline, q]);
export function rockShape(it: RockItem, q: number): THREE.BufferGeometry {
  const key = shapeKeyOf(it, q);
  let g = SHAPES.get(key);
  if (g) {
    SHAPES.delete(key);
    SHAPES.set(key, g);
    return g;
  }
  g = rockItemGeometry(it, q);
  g.userData.shared = true;
  SHAPES.set(key, g);
  // (one let go and still drawn somewhere is simply sent to the graphics card again)
  if (SHAPES.size > 120) { const [k0, g0] = SHAPES.entries().next().value!; SHAPES.delete(k0); g0.dispose(); }
  return g;
}

// (the finest versions, made one at a time once changes stop: a slider dragged makes only the
// plainer ones, a few hundredths of a second, not the finest, a fifth of a second a rock)
const finer: { lod: THREE.LOD; it: RockItem; done?: () => void }[] = [];
let finerTimer: ReturnType<typeof setTimeout> | null = null;
const makeFiner = () => {
  finerTimer = null;
  const job = finer.shift();
  if (!job) return;
  // (one taken off the map meanwhile, by a change after it: not made)
  if (job.lod.parent) {
    (job.lod.levels[0].object as THREE.Mesh).geometry = rockShape(job.it, 1);
    job.done?.();
  }
  if (finer.length) finerTimer = setTimeout(makeFiner, 16);
};

/** A rock in 3D: three versions, finer close up; it stands at y = 0 on its own ground. The finest
 * is made a moment later (until then the next one stands in); `done` then (to draw again). */
export function createRock(it: RockItem, done?: () => void): THREE.Object3D {
  const lod = new THREE.LOD();
  const mat = rockMaterial(it);
  const ready = SHAPES.has(shapeKeyOf(it, 1)), mid = rockShape(it, 0.42);
  [ready ? rockShape(it, 1) : mid, mid, rockShape(it, 0.16)].forEach((g, i) => {
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    lod.addLevel(mesh, LOD_AT[i]);
  });
  lod.userData.rock = true;
  if (!ready) {
    finer.push({ lod, it, done });
    if (finerTimer) clearTimeout(finerTimer);
    finerTimer = setTimeout(makeFiner, 350);
  }
  return lod;
}

/** A drawn outline's length and width (its reach along and across), ft. */
export const rockSpan = (pts: { x: number; y: number }[]) => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of rockOutlinePoints(pts.map(p => [p.x, p.y] as V), 120)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { length: Math.round((x1 - x0) * 2) / 2, width: Math.round((z1 - z0) * 2) / 2 };
};
