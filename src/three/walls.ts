// Dry stone walls along a line. The stones lie level in thin courses, as a waller lays them,
// whatever the ground does: a course runs into the hill where the ground rises and stops where the
// wall's top comes down to it. Bigger stones lie low, a long one ties the wall now and then, the
// ends are squared stones (a wall head), the middle is filled (the hearting) and the topstones
// stand on edge, following the ground and tipped with the slope.
// A long wall is thousands of stones, so it is built in stretches, each drawn by how big it is on
// screen: every stone in full, every stone more simply, every stone as a plain block, or one solid
// shape. The stones are made from a few shapes kept ready, sized and turned for each place, and a
// stretch's stones are only made when it is first seen that close.
import * as THREE from "three";
import type { P, RockStone } from "../types";
import { samplePath } from "../lib/structures";
import { rockMaterial, rockRandom, wallStone } from "./rocks";

type Ground = (x: number, y: number) => number;
/** Where the wall's line is, s ft along it: the place (plan feet), its direction, the ground there
 * and the lowest ground across the wall's thickness. */
type Where = { x: number; y: number; angle: number; ground: number; low: number };
type Kind = "body" | "head" | "cope" | "core";
/** (`ground`: the ground at the wall's foot there, its low side; `tone`: lighter or darker than its neighbors) */
type Stone = { kind: Kind; pick: number; L: number; W: number; H: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number; ground: number; tone: number };

/** Courses about 4 in. high. */
const PITCH = 0.36;
/** A stretch of wall drawn as one, ft. */
const STRETCH = 40;
/** How many screen dots a foot must cover for every stone in full, more simply, and as plain
 * blocks (below that: one solid shape). */
const DOTS = [15, 6.5, 2.2];
/** How much bigger than that a stretch must be on this device, as it is running now (1: a computer
 * keeping up; more on a phone, without a graphics card, or when frames run slow; less for a video,
 * where each frame can take its time). Set by the view. */
export const wallDetail = { scale: 1 };
/** How finely a stone is made, in full and more simply. */
const FINE = [4, 2];
/** How many stretches keep their stones at once, in full and more simply (the ones not being
 * looked at that close let go first). */
const KEEP = [14, 40];

const line = (points: P[], half: number, g: Ground) => {
  const samples = samplePath(points, 1);
  const length = samples.length ? samples[samples.length - 1].s : 0;
  // (the ground read once at each foot of the line, and between them a straight run: the wall
  // asks where it is tens of thousands of times)
  const ground = samples.map(p => g(p.x, p.y));
  const low = samples.map((p, i) => { const nx = -Math.sin(p.angle) * half, ny = Math.cos(p.angle) * half; return Math.min(ground[i], g(p.x + nx, p.y + ny), g(p.x - nx, p.y - ny)); });
  const at = (s: number): Where => {
    let a = 0, b = samples.length - 1;
    while (b - a > 1) { const c = (a + b) >> 1; if (samples[c].s <= s) a = c; else b = c; }
    const p = samples[a], n = samples[b], t = n.s > p.s ? Math.max(0, Math.min(1, (s - p.s) / (n.s - p.s))) : 0;
    return { x: p.x + (n.x - p.x) * t, y: p.y + (n.y - p.y) * t, angle: t < 0.5 ? p.angle : n.angle, ground: ground[a] + (ground[b] - ground[a]) * t, low: low[a] + (low[b] - low[a]) * t };
  };
  return { length, at };
};

/** How many stretches a wall this long is built in (all the same length, about STRETCH). */
const stretchesOf = (length: number) => Math.max(1, Math.round(length / STRETCH));

/** How tall the topstones stand: about a quarter of the wall. */
const copeOf = (H: number) => Math.min(0.85, Math.max(0.5, H * 0.26));

/** Every stone of the wall, in the stretch it belongs to. */
/** `butt`: which ends (first, last) stop against another wall: laid as a run, not squared off. */
const lay = (length: number, at: (s: number) => Where, W: number, H: number, seed: number, butt: [boolean, boolean] = [false, false]): Stone[][] => {
  const out: Stone[][] = Array.from({ length: stretchesOf(length) }, () => []);
  const put = (s: number, st: Stone) => out[Math.min(out.length - 1, Math.max(0, Math.floor((s / length) * out.length)))].push(st);
  const cope = copeOf(H), clampS = (s: number) => Math.max(0, Math.min(length, s));
  let lo = Infinity, hi = -Infinity;
  for (let s = 0; s <= length; s += 2) { const p = at(s); lo = Math.min(lo, p.low); hi = Math.max(hi, p.ground); }
  // The courses: level, at the same heights all along the wall
  for (let k = Math.floor((lo - 0.6) / PITCH); k <= Math.ceil((hi + H) / PITCH); k++) {
    const R = rockRandom(seed * 31 + (k & 0xffff) * 7 + 3), y0 = k * PITCH;
    let s = -R() * 1.1;
    while (s < length) {
      const r1 = R(), r2 = R(), wj = 0.92 + R() * 0.16, zj = (R() - 0.5) * 0.1, rj = (R() - 0.5) * 0.07, tj = (R() - 0.5) * 0.05, hj = 0.94 + R() * 0.2, pick = R();
      // (how far up the wall this stone is: the big ones lie low, and now and then a long one ties the wall)
      const p0 = at(clampS(s + 0.7)), up0 = Math.max(0, Math.min(1, (y0 - p0.ground) / H));
      const l = (0.8 + r1 * 1.1) * (1.3 - 0.45 * up0) * (r2 < 0.1 ? 1.7 : 1);
      const s0 = Math.max(0, s), s1 = Math.min(length, s + l), ll = s1 - s0;
      s += l;
      if (ll < 0.3) continue;
      const sc = (s0 + s1) / 2, p = at(sc);
      if (y0 + PITCH * 0.5 > p.ground + H - cope || y0 + PITCH < p.low - 0.3) continue;
      const up = Math.max(0, Math.min(1, (y0 - p.ground) / H));
      // (the wall's two ends: squared stones laid true, the wall head)
      const head = (s0 < 0.01 && !butt[0]) || (s1 > length - 0.01 && !butt[1]);
      put(sc, {
        kind: head ? "head" : "body", pick, L: ll * (head ? 1.04 : 1.12), W: W * (head ? 1.02 : wj) * (1 - 0.32 * up), H: PITCH * 1.3 * hj,
        x: p.x - Math.sin(p.angle) * (head ? 0 : zj), y: y0 + PITCH / 2, z: p.y + Math.cos(p.angle) * (head ? 0 : zj), yaw: -p.angle + (head ? 0 : rj), pitch: 0, roll: head ? 0 : tj, ground: p.low, tone: (pick * 7.31) % 1 - 0.5
      });
    }
  }
  // The hearting: the wall's middle filled, so no daylight shows between its stones
  for (let s = 0; s < length; s += 2.4) {
    const l = Math.min(2.4, length - s);
    if (l < 0.3) continue;
    const sc = s + l / 2, p = at(sc), rise = Math.abs(at(clampS(sc + 1)).ground - at(clampS(sc - 1)).ground) / 2;
    const h = H - cope - 0.3 - rise * 1.3;
    if (h < 0.3) continue;
    put(sc, { kind: "core", pick: (s / 2.4) % 1, L: l * 1.3, W: W * 0.5, H: h, x: p.x, y: p.ground + h / 2 + 0.05, z: p.y, yaw: -p.angle, pitch: 0, roll: 0, ground: p.low, tone: -0.3 });
  }
  // The topstones: on edge across the wall, one against the next, leaning a little, tipped with the slope
  const R = rockRandom(seed * 17 + 5);
  let s = 0;
  while (s < length) {
    const t = Math.min(length - s, 0.34 + R() * 0.3), hj = 0.85 + R() * 0.4, wj = 0.66 + R() * 0.14, rj = (R() - 0.5) * 0.12, lean = (R() - 0.5) * 0.34, pick = R();
    if (t > 0.12) {
      const sc = s + t / 2, p = at(sc), slope = Math.atan2(at(clampS(sc + 1)).ground - at(clampS(sc - 1)).ground, 2), h = cope * hj;
      put(sc, { kind: "cope", pick, L: t * 1.2, W: W * wj, H: h, x: p.x, y: p.ground + H - cope + h / 2 - 0.08, z: p.y, yaw: -p.angle + rj, pitch: slope * 0.6 + lean, roll: 0, ground: p.low, tone: (pick * 5.17) % 1 - 0.45 });
    }
    s += t;
  }
  return out;
};

// ---------- the shapes kept ready ----------
type Shape = { pos: ArrayLike<number>; nor: ArrayLike<number>; curv: ArrayLike<number>; idx: ArrayLike<number>; L: number; W: number; H: number };
/** How each kind of stone is made: its usual size, how rough, how square (from, to), how many. */
const MAKE: Record<Kind, { L: number; W: number; H: number; jag: number; p: [number, number]; n: number }> = {
  body: { L: 1.6, W: 2, H: 0.47, jag: 0.7, p: [5.5, 8], n: 12 },
  head: { L: 1.5, W: 2, H: 0.47, jag: 0.2, p: [12, 12], n: 3 },
  cope: { L: 0.55, W: 1.45, H: 0.7, jag: 0.7, p: [4, 6.5], n: 10 },
  core: { L: 3.1, W: 1, H: 2, jag: 0.2, p: [8, 8], n: 2 }
};
const shapes: Record<string, Shape[]> = {};
const stoneShapes = (kind: Kind, fine: number) => (shapes[kind + fine] ??= Array.from({ length: MAKE[kind].n }, (_, i) => {
  // (the hearting is never seen whole: always simple)
  const m = MAKE[kind], g = wallStone(m.L, m.W, m.H, m.jag, 4001 + i * 53 + kind.length * 911, m.p[0] + ((m.p[1] - m.p[0]) * i) / Math.max(1, m.n - 1), kind === "core" ? 2 : fine);
  const shape: Shape = { pos: g.attributes.position.array, nor: g.attributes.normal.array, curv: g.attributes.curv.array, idx: g.index!.array, L: m.L, W: m.W, H: m.H };
  return shape;
}));
/** Plain blocks, a foot each way, their corners a little off square. */
let plain: Shape[] | null = null;
const plainShapes = () => (plain ??= Array.from({ length: 6 }, (_, i) => {
  const R = rockRandom(7001 + i * 31);
  const c = [...Array(8).keys()].map(k => new THREE.Vector3(((k & 1) - 0.5) * (0.9 + R() * 0.16), (((k >> 1) & 1) - 0.5) * (0.92 + R() * 0.12), (((k >> 2) & 1) - 0.5) * (0.9 + R() * 0.16)));
  // (each face's corners, wound so it faces out)
  const faces = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  faces.forEach((f, k) => {
    const n = a.subVectors(c[f[1]], c[f[0]]).cross(b.subVectors(c[f[2]], c[f[0]])).normalize();
    for (const v of f) { pos.push(c[v].x, c[v].y, c[v].z); nor.push(n.x, n.y, n.z); }
    idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  });
  return { pos, nor, curv: new Array(24).fill(0), idx, L: 1, W: 1, H: 1 };
}));

const rot = new THREE.Matrix4(), turn = new THREE.Euler(0, 0, 0, "YZX");
/** Stones as one geometry, about `o` (world feet): each a kept shape, sized, turned and set in place. */
const merge = (stones: Stone[], level: number, o: THREE.Vector3) => {
  const use = stones.map(st => { const set = level < 2 ? stoneShapes(st.kind, FINE[level]) : plainShapes(); return set[Math.min(set.length - 1, Math.floor(st.pick * set.length))]; });
  let nv = 0, ni = 0;
  for (const t of use) { nv += t.pos.length / 3; ni += t.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), curv = new Float32Array(nv), foot = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0;
  stones.forEach((st, k) => {
    const t = use[k], sx = st.L / t.L, sy = st.H / t.H, sz = st.W / t.W, n = t.pos.length / 3;
    turn.set(st.roll, st.yaw, st.pitch);
    const r = rot.makeRotationFromEuler(turn).elements;
    for (let i = 0; i < n; i++) {
      const x = t.pos[i * 3] * sx, y = t.pos[i * 3 + 1] * sy, z = t.pos[i * 3 + 2] * sz, v = (v0 + i) * 3;
      const wy = r[1] * x + r[5] * y + r[9] * z + st.y;
      pos[v] = r[0] * x + r[4] * y + r[8] * z + st.x - o.x; pos[v + 1] = wy - o.y; pos[v + 2] = r[2] * x + r[6] * y + r[10] * z + st.z - o.z;
      const a = t.nor[i * 3] / sx, b = t.nor[i * 3 + 1] / sy, c = t.nor[i * 3 + 2] / sz;
      const nx = r[0] * a + r[4] * b + r[8] * c, ny = r[1] * a + r[5] * b + r[9] * c, nz = r[2] * a + r[6] * b + r[10] * c, nl = Math.hypot(nx, ny, nz) || 1;
      nor[v] = nx / nl; nor[v + 1] = ny / nl; nor[v + 2] = nz / nl;
      // (its worn edges and hollows, and its own shade)
      curv[v0 + i] = t.curv[i] + st.tone * 0.9;
      foot[v0 + i] = wy - st.ground;
    }
    for (let i = 0; i < t.idx.length; i++) idx[i0 + i] = t.idx[i] + v0;
    v0 += n; i0 += t.idx.length;
  });
  return finish(pos, nor, curv, foot, idx);
};
const finish = (pos: Float32Array, nor: Float32Array | null, curv: Float32Array, foot: Float32Array, idx: Uint16Array | Uint32Array) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("curv", new THREE.BufferAttribute(curv, 1));
  geo.setAttribute("foot", new THREE.BufferAttribute(foot, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  if (nor) geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); else geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
};

/** A stretch as one solid shape, for far away: the wall's width at its foot, narrower at the top,
 * its top the wall's height above the ground and a little uneven. */
const solid = (s0: number, s1: number, length: number, at: (s: number) => Where, W: number, H: number, seed: number, o: THREE.Vector3) => {
  const STEP = 2.5, n = Math.max(1, Math.ceil((s1 - s0) / STEP)), cope = copeOf(H);
  const pos: number[] = [], foot: number[] = [], idx: number[] = [];
  const bump = (k: number) => { let h = Math.imul(k ^ Math.imul(seed + 977, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // (each cut across the wall: its foot and its top, on the left and on the right)
  const cut = (s: number) => {
    const p = at(s), nx = -Math.sin(p.angle), nz = Math.cos(p.angle), top = p.ground + H - cope * 0.3 + (bump(Math.round(s / STEP)) - 0.5) * 0.24, base = p.low - 0.3;
    return [[p.x + nx * W * 0.5, base, p.y + nz * W * 0.5, base - p.low], [p.x + nx * W * 0.36, top, p.y + nz * W * 0.36, top - p.low], [p.x - nx * W * 0.36, top, p.y - nz * W * 0.36, top - p.low], [p.x - nx * W * 0.5, base, p.y - nz * W * 0.5, base - p.low]];
  };
  const add = (v: number[]) => { pos.push(v[0] - o.x, v[1] - o.y, v[2] - o.z); foot.push(v[3]); return pos.length / 3 - 1; };
  // (the left face, the top and the right face, each with its own corners so its edges stay sharp)
  let before: number[][] | null = null;
  for (let i = 0; i <= n; i++) {
    const c = cut(Math.min(s1, s0 + ((s1 - s0) * i) / n));
    const now = [[add(c[0]), add(c[1])], [add(c[1]), add(c[2])], [add(c[2]), add(c[3])]];
    if (before) for (let f = 0; f < 3; f++) {
      const [a0, a1] = before[f], [b0, b1] = now[f];
      idx.push(a0, b0, b1, a0, b1, a1);
    }
    before = now;
    // (the wall's own ends closed)
    if (i === 0 && s0 < 0.01) { const q = c.map(add); idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
    if (i === n && s1 > length - 0.01) { const q = c.map(add); idx.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
  }
  return finish(new Float32Array(pos), null, new Float32Array(pos.length / 3), new Float32Array(foot), pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx));
};

// ---------- a stretch of wall, drawn by how big it is on screen ----------
const kept: { stretch: Stretch; level: number }[] = [];
const eye = new THREE.Vector3(), here = new THREE.Vector3();
const NAMES = ["stones", "stones-simple", "blocks"];
class Stretch extends THREE.LOD {
  /** Its stones in full, more simply and as blocks, each made when first wanted. */
  private made: (THREE.Mesh | null)[] = [null, null, null];
  private level = 3;
  constructor(private stones: Stone[], private far: THREE.Mesh, private mat: THREE.Material, private reach: number) {
    super();
    this.add(far);
  }
  private make(level: number) {
    const m = new THREE.Mesh(merge(this.stones, level, this.position), this.mat);
    m.name = NAMES[level];
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData = { ...this.far.userData };
    m.raycast = this.far.raycast;
    this.add(m);
    // (made while the picture is being drawn: it takes its place now, not a picture late)
    m.updateMatrixWorld(true);
    this.made[level] = m;
    if (level < 2) {
      // (walls taken off the map no longer count among the ones kept)
      for (let i = kept.length - 1; i >= 0; i--) if (!kept[i].stretch.parent?.parent) kept.splice(i, 1);
      kept.push({ stretch: this, level });
      if (kept.filter(k => k.level === level).length > KEEP[level]) {
        const i = kept.findIndex(k => k.level === level && k.stretch.level !== level);
        if (i >= 0) { const k = kept.splice(i, 1)[0]; k.stretch.drop(level); }
      }
    }
  }
  /** (called by the renderer before each picture) */
  override update(camera: THREE.Camera) {
    const e = camera.projectionMatrix.elements, viewH = typeof window !== "undefined" ? window.innerHeight : 900;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    const d = ortho ? 1 : Math.max(1, eye.setFromMatrixPosition(camera.matrixWorld).distanceTo(here.setFromMatrixPosition(this.matrixWorld)) - this.reach);
    const dots = ((viewH / 2) * e[5]) / d / wallDetail.scale;
    // (a little slack, so a stretch right at a change doesn't flicker)
    let want = 3;
    for (let l = 0; l < 3; l++) if (dots >= DOTS[l] * (this.level <= l ? 0.85 : 1)) { want = l; break; }
    if (want < 3 && !this.made[want]) this.make(want);
    this.level = want;
    this.made.forEach((m, l) => { if (m) m.visible = want === l; });
    this.far.visible = want === 3;
  }
  /** Its stones at this level let go (made again when it's next seen that close). */
  drop(level: number) {
    const m = this.made[level];
    if (!m) return;
    this.remove(m);
    m.geometry.dispose();
    this.made[level] = null;
  }
}

/** A dry stone wall along `points` (plan feet), standing on the ground. `butt`: which of its ends
 * (first, last) stop against another wall (lib/wallJoin). */
export const createDryWall = (points: P[], groundAt: Ground, width: number, height: number, look: { stone: RockStone; moss?: number; lichen?: number; seed?: number; butt?: [boolean, boolean] }) => {
  const group = new THREE.Group();
  group.name = "wall";
  const W = Math.max(0.5, width), H = Math.max(0.8, height), seed = look.seed ?? 1;
  const { length, at } = line(points, W / 2, groundAt);
  if (length < 0.5) return group;
  const mat = rockMaterial(look, undefined, true);
  const span = length / stretchesOf(length);
  lay(length, at, W, H, seed, look.butt).forEach((stones, i) => {
    const s0 = i * span, s1 = Math.min(length, s0 + span), mid = at((s0 + s1) / 2);
    const o = new THREE.Vector3(mid.x, mid.ground + H / 2, mid.y);
    const far = new THREE.Mesh(solid(s0, s1, length, at, W, H, seed, o), mat);
    far.name = "solid";
    far.castShadow = true;
    far.receiveShadow = true;
    const stretch = new Stretch(stones, far, mat, far.geometry.boundingSphere!.radius);
    stretch.position.copy(o);
    group.add(stretch);
  });
  return group;
};
