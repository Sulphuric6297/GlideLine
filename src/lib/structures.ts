// Built things on the course: bridges, boardwalks, stairs and walls (drawn along a line) and
// buildings, shelters and decks (drawn as an outline). Their shape on the plan, the deck heights
// along a bridge or a boardwalk, the steps of stairs, and roofs: shared by the printed map, the
// Forest painting and the 3D models. Plan units are feet.
import { STRUCTURE_KINDS } from "../constants";
import type { P, RoofKind, StructureItem, StructureKind } from "../types";
import { boundsOf, pathLength, pointAlong, smoothPath } from "./geom";

type Ground = (x: number, y: number) => number;

export const isLineKind = (kind: StructureKind) => STRUCTURE_KINDS[kind].shape === "line";
export const structureWidth = (s: Pick<StructureItem, "kind" | "width">) => s.width ?? STRUCTURE_KINDS[s.kind].width;
export const structureHeight = (s: Pick<StructureItem, "kind" | "height">) => s.height ?? STRUCTURE_KINDS[s.kind].height;
export const structureRoof = (s: Pick<StructureItem, "kind" | "roof">): RoofKind => s.roof ?? STRUCTURE_KINDS[s.kind].roof ?? "gable";

/** A building's (or a shelter's) roof as it's set: its kind, its pitch where it was measured, and
 * which way its ridge runs. */
export const roofFor = (st: Pick<StructureItem, "kind" | "roof" | "points" | "roofPitch" | "ridgeAcross">, overhang = 1.5, pitch0 = 0.5, outline: P[] = st.points) =>
  roofOf(outline, structureRoof(st), overhang, st.roofPitch ?? pitch0, st.roofPitch ? 40 : 12, st.ridgeAcross);

/** The line a bridge, boardwalk or stairs follows: a smooth curve through the clicks (walls keep
 * their corners). */
export const structurePath = (s: Pick<StructureItem, "kind" | "points">): P[] =>
  s.kind === "wall" || s.points.length < 3 ? s.points.map(p => ({ ...p })) : smoothPath(s.points, 8);

/** Plan bounds of a structure, its width included. */
export const structureBounds = (s: StructureItem) => {
  const b = boundsOf(s.points);
  const r = isLineKind(s.kind) ? structureWidth(s) / 2 + 1 : 2;
  return { minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r };
};

// ------------------------------------------------------------------ along a line

export type PathSample = { x: number; y: number; s: number; angle: number };

/** Points about every `step` ft along a polyline and at each of its corners, with the direction
 * there (at a corner: halfway between the two legs). */
export const samplePath = (pts: P[], step: number): PathSample[] => {
  const out: PathSample[] = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = out.length ? 1 : 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, s: s + (len * k) / n, angle: ang });
    s += len;
  }
  // Corners: the direction halfway between the legs
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[i - 1], b = out[i + 1];
    if (Math.abs(a.angle - out[i].angle) > 1e-6 || Math.abs(b.angle - out[i].angle) > 1e-6) out[i].angle = Math.atan2(b.y - a.y, b.x - a.x);
  }
  return out;
};

export type DeckSample = PathSample & { ground: number; top: number };

/**
 * A bridge's deck: straight from one end to the other at the banks' heights plus `deck` ft, with a
 * slight camber in the middle. It spans whatever is under it (a creek's dip, a ditch), and is never
 * lower than the ground.
 */
export const bridgeDeck = (path: P[], groundAt: Ground, deck: number, step = 1): DeckSample[] => {
  const samples = samplePath(path, step);
  if (!samples.length) return [];
  const L = samples[samples.length - 1].s || 1;
  const first = samples[0], last = samples[samples.length - 1];
  const y0 = groundAt(first.x, first.y) + deck, y1 = groundAt(last.x, last.y) + deck;
  const camber = Math.min(1.5, L * 0.025);
  return samples.map(p => {
    const ground = groundAt(p.x, p.y);
    const t = p.s / L;
    return { ...p, ground, top: Math.max(y0 + (y1 - y0) * t + camber * Math.sin(Math.PI * t), ground + 0.15) };
  });
};

/** A boardwalk's deck: `deck` ft over the ground (smoothed over a few feet), sloping down to it in
 * the last few feet at each end. */
export const boardwalkDeck = (path: P[], groundAt: Ground, deck: number, step = 1): DeckSample[] => {
  const samples = samplePath(path, step);
  if (!samples.length) return [];
  const L = samples[samples.length - 1].s;
  const ground = samples.map(p => groundAt(p.x, p.y));
  const ramp = Math.min(4, L / 3);
  return samples.map((p, i) => {
    // (Evenly either side, so the ends stay on the ground)
    const end = Math.min(p.s, L - p.s);
    const win = Math.min(4, end);
    let sum = 0, n = 0;
    for (let j = 0; j < samples.length; j++) if (Math.abs(samples[j].s - p.s) <= win + 1e-9) { sum += ground[j]; n++; }
    const h = ramp > 0 && end < ramp ? 0.3 + (deck - 0.3) * Math.max(0, end / ramp) : deck;
    return { ...p, ground: ground[i], top: Math.max(sum / n + Math.max(0.3, h), ground[i] + 0.25) };
  });
};

export type Step = { s0: number; s1: number; at: P; angle: number; top: number; low: number };

/** Stairs: level steps along the path (about 1.4 ft treads, risers no higher than about 7 inches),
 * each standing just above the highest ground under it. */
export const stairSteps = (path: P[], groundAt: Ground): Step[] => {
  const L = pathLength(path);
  if (L < 0.5) return [];
  const g = (d: number) => { const p = pointAlong(path, d).point; return groundAt(p.x, p.y); };
  const n = Math.max(1, Math.round(Math.max(L / 1.4, Math.abs(g(L) - g(0)) / 0.58)));
  const t = L / n;
  return Array.from({ length: n }, (_, k) => {
    const s0 = k * t, s1 = (k + 1) * t;
    const mid = pointAlong(path, (s0 + s1) / 2);
    const gs = [g(s0), g((s0 + s1) / 2), g(s1)];
    return { s0, s1, at: mid.point, angle: mid.angle, top: Math.max(...gs) + 0.2, low: Math.min(...gs) };
  });
};

/** The outline of a band `width` wide along a polyline (square ends, mitered corners). */
export const ribbon = (pts: P[], width: number): P[] => {
  const line = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6);
  if (line.length < 2) return [];
  const half = width / 2;
  const left: P[] = [], right: P[] = [];
  line.forEach((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    // Mitered: as far out as the legs' own offsets meet (within reason)
    let k = 1;
    if (i > 0 && i < line.length - 1) {
      const d1 = { x: p.x - a.x, y: p.y - a.y }, l1 = Math.hypot(d1.x, d1.y) || 1;
      const cos = (-d1.y / l1) * nx + (d1.x / l1) * ny;
      k = 1 / Math.max(0.35, cos);
    }
    left.push({ x: p.x + nx * half * k, y: p.y + ny * half * k });
    right.push({ x: p.x - nx * half * k, y: p.y - ny * half * k });
  });
  return [...left, ...right.reverse()];
};

// ------------------------------------------------------------------ outlines and roofs

const signedArea = (poly: P[]) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;

/** A polygon grown outward by `d` ft (mitered corners). */
export const offsetPolygon = (poly: P[], d: number): P[] => {
  if (poly.length < 3 || d === 0) return poly.map(p => ({ ...p }));
  const sgn = signedArea(poly) > 0 ? 1 : -1;
  const normal = (a: P, b: P) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (sgn * (b.y - a.y)) / l, y: (-sgn * (b.x - a.x)) / l };
  };
  return poly.map((p, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length], next = poly[(i + 1) % poly.length];
    const n1 = normal(prev, p), n2 = normal(p, next);
    const k = d / Math.max(0.3, 1 + n1.x * n2.x + n1.y * n2.y);
    return { x: p.x + (n1.x + n2.x) * k, y: p.y + (n1.y + n2.y) * k };
  });
};

/** The rectangle closest around points: middle `c`, its long direction `u` and the other `v`
 * (unit vectors), half its length `a` along u and half its width `b` along v (a ≥ b). */
export type Box = { c: P; u: P; v: P; a: number; b: number };

const hull = (pts: P[]) => {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [], upper: P[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

export const orientedBox = (pts: P[]): Box => {
  const h = hull(pts);
  let best: Box | null = null, bestArea = Infinity;
  const tryDir = (ang: number) => {
    const u = { x: Math.cos(ang), y: Math.sin(ang) }, v = { x: -u.y, y: u.x };
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of h) {
      const s = p.x * u.x + p.y * u.y, t = p.x * v.x + p.y * v.y;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area < bestArea - 1e-6) {
      bestArea = area;
      const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2;
      best = { c: { x: u.x * cs + v.x * ct, y: u.y * cs + v.y * ct }, u, v, a: (s1 - s0) / 2, b: (t1 - t0) / 2 };
    }
  };
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) tryDir(Math.atan2(b.y - a.y, b.x - a.x));
  }
  if (!best) tryDir(0);
  const box = best as unknown as Box;
  // The long side along u
  if (box.b > box.a) return { c: box.c, u: box.v, v: { x: -box.u.x, y: -box.u.y }, a: box.b, b: box.a };
  return box;
};

/** A drawn shape's points (and its spot) turned `rad` about its middle: clockwise on the map for
 * a positive angle. */
export const turnShape = (points: P[], at: P, rad: number, about = orientedBox(points).c) => {
  const cs = Math.cos(rad), sn = Math.sin(rad);
  const turn = (p: P) => ({ x: about.x + (p.x - about.x) * cs - (p.y - about.y) * sn, y: about.y + (p.x - about.x) * sn + (p.y - about.y) * cs });
  const c = turn(at);
  return { points: points.map(turn), x: c.x, y: c.y };
};

/** A gazebo's outline over the same ground as `pts`: a regular octagon, turned like it. */
export const gazeboOutline = (pts: P[], sides = 8): P[] => {
  const { c, u, a, b } = orientedBox(pts);
  const r = (a + b) / 2;
  const a0 = Math.atan2(u.y, u.x) + Math.PI / sides;
  return Array.from({ length: sides }, (_, i) => ({ x: c.x + Math.cos(a0 + (i / sides) * Math.PI * 2) * r, y: c.y + Math.sin(a0 + (i / sides) * Math.PI * 2) * r }));
};

/** The rectangle closest around `pts`, as an outline. */
export const boxOutline = (pts: P[]): P[] => {
  const { c, u, v, a, b } = orientedBox(pts);
  return [[-a, -b], [a, -b], [a, b], [-a, b]].map(([s, t]) => ({ x: c.x + u.x * s + v.x * t, y: c.y + u.y * s + v.y * t }));
};

/** One sloping face of a roof: its outline on the plan, and the way it faces (level, outward). */
export type RoofFacet = { poly: P[]; out: P };

export type Roof = {
  box: Box;
  /** The roof's edge on the plan (the outline grown by the overhang). */
  eaves: P[];
  facets: RoofFacet[];
  /** Rise per foot run (6 in 12 is 0.5). */
  pitch: number;
  /** How far a point is in from the walls under its roof face, ft (negative under the overhang):
   * the roof is `pitch × run` above the top of the walls. */
  run: (p: P) => number;
  /** Each face's own run (the roof's is the least of them). */
  runs: ((p: P) => number)[];
  /** The highest the roof rises above the top of the walls, ft. */
  rise: number;
};

/** A side the roof drains to: how far in from it a point is (linear), and the way it faces. */
type Side = { run: (p: P) => number; out: P };

/**
 * A roof over an outline. Each face drains to one side and covers the part of the outline nearer
 * that side than any other; a point is `pitch × run` above the top of the walls, its run being how
 * far in it is from its side:
 * - gable: the closest rectangle's two long sides (gable ends on the short ones);
 * - hip: its four sides;
 * - shed: one long side, rising to the other (a single slope, lower);
 * - pyramid: every side of the outline itself, meeting in the middle (a gazebo's roof);
 * - flat: no slope at all.
 */
export const roofOf = (outline: P[], kind: RoofKind, overhang = 1.5, pitch0 = 0.5, maxRise = 12, across = false): Roof => {
  // (the ridge across: the box turned a quarter, its short sides taken as its length)
  const long = orientedBox(outline);
  const box = across ? { c: long.c, u: long.v, v: { x: -long.u.x, y: -long.u.y }, a: long.b, b: long.a } : long;
  const { c, u, v, a, b } = box;
  const local = (p: P) => { const dx = p.x - c.x, dy = p.y - c.y; return { s: dx * u.x + dy * u.y, t: dx * v.x + dy * v.y }; };
  const boxSide = (k: number, al: number, be: number, out: P): Side => ({ run: p => { const l = local(p); return k + al * l.s + be * l.t; }, out });
  const neg = (q: P) => ({ x: -q.x, y: -q.y });
  let sides: Side[];
  if (kind === "flat") sides = [];
  else if (kind === "shed") sides = [boxSide(b, 0, -1, v)];
  else if (kind === "pyramid") {
    const h = hull(outline);
    const sgn = signedArea(h) > 0 ? 1 : -1;
    sides = h.map((p, i) => {
      const q = h[(i + 1) % h.length];
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      // (the inward normal: a point's run is how far in from this side it is)
      const inn = { x: (-sgn * (q.y - p.y)) / l, y: (sgn * (q.x - p.x)) / l };
      return { run: (r: P) => (r.x - p.x) * inn.x + (r.y - p.y) * inn.y, out: neg(inn) };
    });
  } else sides = [
    boxSide(b, 0, -1, v),
    boxSide(b, 0, 1, neg(v)),
    ...(kind === "hip" ? [boxSide(a, -1, 0, u), boxSide(a, 1, 0, neg(u))] : [])
  ];
  const run = (p: P) => (sides.length ? Math.min(...sides.map(sd => sd.run(p))) : 0);
  // (a single slope runs the whole width: gentler, to stay as low as a shed's)
  const span = kind === "shed" ? 2 * b : kind === "pyramid" ? Math.max(1, ...outline.map(run), run(c)) : b;
  const pitch = kind === "flat" ? 0 : Math.min(kind === "shed" ? Math.min(pitch0, 0.25) : pitch0, maxRise / Math.max(1, span));
  const eaves = offsetPolygon(outline, overhang);
  const facets: RoofFacet[] = [];
  if (!sides.length) facets.push({ poly: eaves, out: { x: 0, y: 0 } });
  sides.forEach((sd, i) => {
    let poly = eaves;
    sides.forEach((other, j) => {
      if (j === i || !poly.length) return;
      // Nearer this side than the other (ties go to the earlier side)
      poly = clipHalf(poly, p => sd.run(p) - other.run(p) - (j < i ? 1e-9 : -1e-9));
    });
    if (poly.length >= 3 && Math.abs(signedArea(poly)) > 1e-6) facets.push({ poly, out: sd.out });
  });
  return { box, eaves, facets, pitch, run, runs: sides.map(sd => sd.run), rise: pitch * Math.max(0, ...outline.map(run), run(c)) };
};

/** The part of a polygon where f(p) ≤ 0 (f linear). */
const clipHalf = (poly: P[], f: (p: P) => number): P[] => {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
};

/** Points along a wall from a to b where the roof line above it bends (at the ridge or a hip), so
 * the wall's top can follow the roof exactly (a gable end's triangle). */
export const roofBreaks = (a: P, b: P, roof: Roof): P[] => {
  const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const r0 = roof.runs.map(f => f(a)), r1 = roof.runs.map(f => f(b));
  const ts = [0, 1];
  // Where two faces' runs cross along the wall, and that's the roof there
  for (let i = 0; i < r0.length; i++) for (let j = i + 1; j < r0.length; j++) {
    const den = r1[j] - r0[j] - (r1[i] - r0[i]);
    if (Math.abs(den) < 1e-9) continue;
    const t = (r0[i] - r0[j]) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6) continue;
    if (Math.abs(roof.run(at(t)) - (r0[i] + (r1[i] - r0[i]) * t)) < 1e-6) ts.push(t);
  }
  return [...new Set(ts)].sort((x, y) => x - y).map(at);
};
