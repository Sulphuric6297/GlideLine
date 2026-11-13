// Water's level and the ground under it, for the 3D view.
//
// Water lies at the level of its banks nearby: the lowest of them within REACH (a pond level, a
// river sloping down its length, never up a bluff on one side). The survey can't see under water:
// what it hands over inside a pond is guesswork, often with tall spots that are no island. So
// inside its outline the ground is drawn as a bed shelving down from the bank, under the water,
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

/** The water's level at any spot near it (ft), from the ground along its outline (`h`, the
 * ground as measured). */
export const waterLevel = (pts: P[], h: (x: number, y: number) => number) => {
  const banks: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
    for (let k = 0; k < n; k++) { const x = p.x + ((q.x - p.x) * k) / n, y = p.y + ((q.y - p.y) * k) / n; banks.push({ x, y, h: h(x, y) }); }
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
