// Shapes lying on the ground: cut along the terrain grid so they follow every slope.
import * as THREE from "three";
import type { P } from "../types";

/** The part of a polygon inside an axis-aligned box (Sutherland-Hodgman, one side at a time). */
export const clipToBox = (poly: P[], x0: number, y0: number, x1: number, y1: number) => {
  const sides: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [p => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [p => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [p => p.y >= y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0 })],
    [p => p.y <= y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1 })]
  ];
  let out = poly;
  for (const [inside, cross] of sides) {
    if (!out.length) break;
    const input = out;
    out = [];
    input.forEach((cur, i) => {
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    });
  }
  return out;
};

const area2 = (pts: P[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0);

/**
 * A polygon lying on the ground: its outline cut along the terrain grid, every corner at the
 * ground's height plus `lift`. Simple polygons only (self-crossing outlines are filled as best can).
 * With `edges` (lines along its edge), each corner's distance to the nearest of them as `aEdge`
 * (up to 64), for a soft edge `feather` ft wide (groundDetail's addSurfaceDetail): the cells along
 * the edge cut finer (4 ft), so the fade is as even as the edge, not stepped by the grid's cells.
 */
export const drapedPolygon = (outline: P[], groundAt: (x: number, y: number) => number, grid: number, lift: number, edges?: P[][], feather = 8) => {
  const pos: number[] = [];
  if (outline.length >= 3) {
    let poly = outline;
    if (area2(poly) < 0) poly = [...poly].reverse();
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    // Big shapes on a fine grid: coarser cells (at most ~4000 of them)
    let cell = grid > 0 ? grid : 20;
    while (((maxX - minX) / cell) * ((maxY - minY) / cell) > 4000) cell *= 2;
    // Concave outlines: triangulate once, then cut each triangle along the grid
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(p => new THREE.Vector2(p.x, p.y)), []);
    // A fan over a convex piece, wound so the top faces up (plan y is world z)
    const fan = (piece: P[]) => {
      for (let k = 1; k + 1 < piece.length; k++) {
        const a = piece[0], b = piece[k], c = piece[k + 1];
        const up = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
        for (const p of up ? [a, c, b] : [a, b, c]) pos.push(p.x, groundAt(p.x, p.y) + lift, p.y);
      }
    };
    const segs = edges ? segmentsOf(edges) : null;
    // (how near the edge a cell is cut finer: the fade and its ragged reach, and the cell itself)
    const reach = feather * 1.4 + cell * 0.71;
    const near = new Map<string, boolean>();
    const nearEdge = (cx: number, cy: number) => {
      const key = `${cx},${cy}`;
      let v = near.get(key);
      if (v === undefined) near.set(key, (v = distanceTo(segs!, cx + cell / 2, cy + cell / 2, reach) < reach));
      return v;
    };
    // (at most 8 across a cell: a big shape's coarse cells stay within reason)
    const n = Math.min(8, Math.ceil(cell / 4)), sub = cell / n;
    for (const t of tris) {
      const tri = t.map(k => poly[k]);
      const tx = tri.map(p => p.x), ty = tri.map(p => p.y);
      for (let cx = Math.floor(Math.min(...tx) / cell) * cell; cx < Math.max(...tx); cx += cell) {
        for (let cy = Math.floor(Math.min(...ty) / cell) * cell; cy < Math.max(...ty); cy += cell) {
          const piece = clipToBox(tri, cx, cy, cx + cell, cy + cell);
          if (piece.length < 3 || Math.abs(area2(piece)) < 1e-6) continue;
          if (!segs || n < 2 || !nearEdge(cx, cy)) { fan(piece); continue; }
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const bit = clipToBox(piece, cx + i * sub, cy + j * sub, cx + (i + 1) * sub, cy + (j + 1) * sub);
            if (bit.length >= 3 && Math.abs(area2(bit)) > 1e-6) fan(bit);
          }
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (edges) geo.setAttribute("aEdge", new THREE.Float32BufferAttribute(edgeDistances(pos, edges, 64), 1));
  geo.computeVertexNormals();
  return geo;
};

/** Lines as a flat list of segments (x0, y0, x1, y1, ...). */
const segmentsOf = (lines: P[][]) => {
  const segs: number[] = [];
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) segs.push(l[i].x, l[i].y, l[i + 1].x, l[i + 1].y);
  return segs;
};
/** A plan point's distance to the nearest segment, up to `max`. */
const distanceTo = (segs: number[], x: number, y: number, max: number) => {
  let d = max;
  for (let s = 0; s < segs.length; s += 4) {
    const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3];
    if (x < Math.min(ax, bx) - d || x > Math.max(ax, bx) + d || y < Math.min(ay, by) - d || y > Math.max(ay, by) + d) continue;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
};
/** Each corner's (x, z) plan distance to the nearest of `lines`, up to `max` (each spot worked out
 * once, however many triangles share it). */
const edgeDistances = (pos: number[], lines: P[][], max: number) => {
  const segs = segmentsOf(lines);
  const out = new Float32Array(pos.length / 3), seen = new Map<string, number>();
  for (let v = 0; v < out.length; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 2], key = `${x},${y}`;
    let d = seen.get(key);
    if (d === undefined) seen.set(key, (d = distanceTo(segs, x, y, max)));
    out[v] = d;
  }
  return out;
};

/** Points along a polyline every `step` feet, on the ground (plus `lift`), as world positions. */
export const drapedPoints = (pts: P[], groundAt: (x: number, y: number) => number, step: number, lift: number, closed = false) => {
  const out: THREE.Vector3[] = [];
  const line = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    out.push(new THREE.Vector3(a.x, groundAt(a.x, a.y) + lift, a.y));
    const b = line[i + 1];
    if (!b) break;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      out.push(new THREE.Vector3(x, groundAt(x, y) + lift, y));
    }
  }
  return out;
};

/** A ribbon of real width along a polyline, on the ground (paths, roads, streams). */
export const drapedRibbon = (pts: P[], width: number | ((t: number) => number), groundAt: (x: number, y: number) => number, step0: number, lift: number) => {
  const pos: number[] = [];
  // (every few feet along it: the ground's own cells are finer than a path's bends)
  const step = Math.min(step0, 4);
  const dense: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    dense.push(a);
    if (!b) break;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k < n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  // (a width that changes along it: by how far along each point is)
  const along = [0];
  for (let i = 1; i < dense.length; i++) along.push(along[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const total = along[along.length - 1] || 1;
  // Across the ribbon, several points, each at the highest ground near it (a ridge under the
  // middle of a path, or the ground's triangles rising between samples, never poke through)
  const ACROSS = 4;
  const top = (x: number, y: number) => Math.max(groundAt(x, y), groundAt(x + 1.2, y), groundAt(x - 1.2, y), groundAt(x, y + 1.2), groundAt(x, y - 1.2));
  const rows = dense.map((p, i) => {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const half = (typeof width === "number" ? width : width(along[i] / total)) / 2;
    const row: number[][] = [];
    for (let k = 0; k <= ACROSS; k++) {
      const t = (k / ACROSS) * 2 - 1, x = p.x + n.x * half * t, y = p.y + n.y * half * t;
      row.push([x, top(x, y) + lift, y]);
    }
    return row;
  });
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    for (let k = 0; k < ACROSS; k++) pos.push(...a[k], ...b[k], ...a[k + 1], ...a[k + 1], ...b[k], ...b[k + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // Faces up whichever way the line was drawn
  const nrm = geo.getAttribute("normal");
  if (nrm && nrm.count && (nrm.getY(0) < 0)) {
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
  }
  return geo;
};

/**
 * Draped polygons kept, by what shapes them (outline, the ground's heights, lift, soft edge): a
 * thing made again because only its look changed (the photo off, standing on the course) takes
 * the geometry it had, not a new one cut along the ground from scratch. The geometries are shared
 * (never freed with a mesh): `sweep` frees those no mesh uses any more.
 */
export class DrapeCache {
  private kept = new Map<string, THREE.BufferGeometry>();
  private static key(pts: P[]) {
    let k = "";
    for (const p of pts) k += `${Math.round(p.x * 50)},${Math.round(p.y * 50)} `;
    return k;
  }
  /** `ground`: what stands for the ground's heights now (a number that changes when they do). */
  get(outline: P[], groundAt: (x: number, y: number) => number, ground: number, grid: number, lift: number, edges?: P[][], feather = 8) {
    const key = `${ground}|${grid}|${lift}|${edges ? feather : 0}|${DrapeCache.key(outline)}|${edges ? edges.map(DrapeCache.key).join(";") : ""}`;
    let geo = this.kept.get(key);
    if (!geo) {
      geo = drapedPolygon(outline, groundAt, grid, lift, edges, feather);
      geo.userData.shared = true;
      this.kept.set(key, geo);
    }
    return geo;
  }
  /** Frees every kept geometry `used` doesn't hold. */
  sweep(used: Set<THREE.BufferGeometry>) {
    for (const [key, geo] of this.kept) if (!used.has(geo)) { geo.dispose(); this.kept.delete(key); }
  }
  clear() {
    for (const geo of this.kept.values()) geo.dispose();
    this.kept.clear();
  }
}
