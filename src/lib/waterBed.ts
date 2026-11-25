// Water's level and the ground under it, for the 3D view.
//
// Still water is flat: a lake or a pond lies at one level all over, whatever its outline does (a
// map's outline is often rough, and runs up a bank here and there: the water doesn't follow it up).
// Its level is the one the survey measured where it measured one (most of the ground inside the
// outline at one height: the survey flattens open water), and otherwise that of its lower banks.
// Only a river, long and narrow, lies at the level of its banks nearby: the lowest of them within
// REACH, so it slopes down its length, never up a bluff on one side. The survey can't see under
// water: what it hands over inside a pond is guesswork, often with tall spots that are no island.
// So inside its outline the ground is drawn as a bed shelving down from the bank, under the water,
// and the water is never broken by it. Real islands are holes in the outline and stay land.
import { clipPolygonToRect, distanceToPath, pointInPolygon } from "./geom";
import type { P } from "../types";

/** How far round a spot its banks set its level (ft). */
const REACH = 90;
/** How far over its banks' level the water lies (ft). */
export const WATER_LIFT = 0.2;

/** The outline kept to the site (a lake's outline the maps hand over can run past its edges). */
export const waterOutline = (pts: P[], canvas: { width: number; height: number }) =>
  clipPolygonToRect(pts, { x0: 0, y0: 0, x1: canvas.width, y1: canvas.height });

/** A river: long and narrow (its outline 10 times as long as a round pond's of its size would
 * be, and no wider across than both banks' reach). Anything else is still water. */
export const waterFlows = (pts: P[]) => {
  let area = 0, round = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; round += Math.hypot(q.x - p.x, q.y - p.y); }
  area = Math.abs(area) / 2;
  return area > 0 && (round * round) / (4 * area) >= 10 && (2 * area) / round < 2 * REACH;
};

/** Still water's one level (ft): the survey's own, where six in ten of the spots inside the
 * outline lie within 0.3 ft of their middle height (water it flattened); otherwise that of its
 * lower banks (15 in 100 lie lower: an outlet, a ditch the outline's corner reaches). */
const stillLevel = (pts: P[], banks: number[], h: (x: number, y: number) => number) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const step = Math.max(8, Math.sqrt(((x1 - x0) * (y1 - y0)) / 900)), inside: number[] = [];
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointInPolygon({ x, y }, pts)) inside.push(h(x, y));
  if (inside.length >= 12) {
    inside.sort((a, b) => a - b);
    const mid = inside[inside.length >> 1];
    if (inside.filter(v => Math.abs(v - mid) <= 0.3).length >= inside.length * 0.6) return mid;
  }
  const sorted = [...banks].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.15)];
};

/** The water's level at any spot near it (ft), from the ground along its outline and inside it
 * (`h`, the ground as measured): one level for still water, the banks' nearby for a river. */
export const waterLevel = (pts: P[], h: (x: number, y: number) => number) => {
  const banks: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
    for (let k = 0; k < n; k++) { const x = p.x + ((q.x - p.x) * k) / n, y = p.y + ((q.y - p.y) * k) / n; banks.push({ x, y, h: h(x, y) }); }
  }
  if (banks.length && !waterFlows(pts)) {
    const flat = stillLevel(pts, banks.map(b => b.h), h) + WATER_LIFT;
    return () => flat;
  }
  const lowest = banks.length ? Math.min(...banks.map(b => b.h)) : 0;
  return (x: number, y: number) => {
    let m = Infinity;
    for (const b of banks) if (Math.abs(b.x - x) < REACH && Math.abs(b.y - y) < REACH && b.h < m) m = b.h;
    return (Number.isFinite(m) ? m : lowest) + WATER_LIFT;
  };
};

/** The ground's heights with a bed under each water outline: at each grid point inside it, no
 * higher than the water less a little, shelving a foot every 2 ft out from the bank to 9 ft. */
export const withWaterBeds = (heights: Record<string, number>, gridSize: number, canvas: { width: number; height: number }, waters: P[][]) => {
  if (!waters.length) return heights;
  const grid = gridSize || 20, out = { ...heights };
  const at = (x: number, y: number) => {
    const fx = x / grid, fy = y / grid, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const v = (gx: number, gy: number) => heights[`${gx * grid},${gy * grid}`] || 0;
    return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty;
  };
  for (const raw of waters) {
    const pts = waterOutline(raw, canvas);
    if (pts.length < 3) continue;
    const level = waterLevel(pts, at), edge = [...pts, pts[0]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    for (let gx = Math.ceil(x0 / grid) * grid; gx <= x1; gx += grid) {
      for (let gy = Math.ceil(y0 / grid) * grid; gy <= y1; gy += grid) {
        const p = { x: gx, y: gy };
        if (!pointInPolygon(p, pts)) continue;
        const key = `${gx},${gy}`, d = distanceToPath(p, edge);
        const bed = level(gx, gy) - 0.4 - Math.min(9, d * 0.5);
        if ((out[key] ?? 0) > bed) out[key] = bed;
      }
    }
  }
  return out;
};
