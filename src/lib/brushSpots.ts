// Where underbrush grows in a wood, bush by bush: the one list the 3D view grows (three/woods) and
// the painted map draws (lib/forest), so the map shows the same bushes 3D does. Each spot's draws
// come from where it is, so they're the same every time.
import type { BrushKind, P } from "../types";
import { nearestOnSegment, pointInPolygon } from "./geom";

/** A number in [0, 1) of a spot and a salt: the same every time. */
export const spotDraw = (p: P, salt: number) => {
  let n = Math.imul(Math.round(p.x * 10) ^ 0x5bd1e995, 0x2c1b3c6d) ^ Math.imul(Math.round(p.y * 10) + salt * 7919, 0x297a2d39);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** How far apart the underbrush grows, ft, how big its bushes, how much of them are the twiggy
 * airy ones, and how far off it is drawn (light, medium, heavy: a thicket you can't see into). */
export const BRUSH = {
  light: { spacing: 22, height: [2, 4.5], width: [1.1, 1.8], airy: 0.15, reach: 360, size: 0.8 },
  medium: { spacing: 12, height: [2.5, 6], width: [1.2, 2], airy: 0.25, reach: 320, size: 1 },
  heavy: { spacing: 6.5, height: [3.5, 8.5], width: [1.4, 2.4], airy: 0.4, reach: 240, size: 1.2 }
} as const;
export type BrushLevel = keyof typeof BRUSH;

/** What grows in underbrush: bushes, thicket shrubs, briars, weeds. */
export type Growth = "shrub" | "thicket" | "briars" | "weeds";
/** How much of each growth a kind of underbrush has, out in the light at the wood's edge (`sun`
 * 1) and deep in the shade (0): weeds and briars want light, shrubs and thickets stand shade. */
const SHARES: Record<BrushKind, (sun: number) => Record<Growth, number>> = {
  mixed: sun => ({ shrub: 0.3, thicket: 0.15 + 0.15 * (1 - sun), briars: 0.25 + 0.15 * sun, weeds: 0.04 + 0.26 * sun }),
  thicket: sun => ({ shrub: 0.25, thicket: 0.6, briars: 0.06 + 0.06 * sun, weeds: 0.02 + 0.05 * sun }),
  briars: sun => ({ shrub: 0.1, thicket: 0.05, briars: 0.7, weeds: 0.05 + 0.15 * sun }),
  weeds: sun => ({ shrub: 0.08, thicket: 0, briars: 0.1 + 0.07 * sun, weeds: 0.75 })
};
const pickGrowth = (shares: Record<Growth, number>, draw: number): Growth => {
  const total = shares.shrub + shares.thicket + shares.briars + shares.weeds;
  let d = draw * total;
  for (const g of ["shrub", "thicket", "briars", "weeds"] as const) { d -= shares[g]; if (d <= 0) return g; }
  return "shrub";
};

/** How far a point is from an outline's edge, inside or out. */
const edgeDistance = (p: P, poly: P[]) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, nearestOnSegment(p, poly[i], poly[(i + 1) % poly.length]).distance);
  return best;
};

/** How deep into a wood the light reaches for underbrush, ft (past it, the edge's extra fades out). */
const EDGE_DEPTH = 45;

/** One bush of underbrush: where, how tall and wide (ft), what it is (null: a young tree). */
export type BrushSpot = { x: number; y: number; height: number; width: number; growth: Growth | null };

/** Underbrush in a wood, about every `spacing` feet (closer the heavier, and `closer` times closer
 * still; never more than `most` of them), kept off what `keepOut` says: bushes, thicket shrubs,
 * briars and weeds as its kind has them (weeds and briars out where the light reaches, along the
 * edge), and now and then a young tree. */
export const underbrushSpots = (outline: P[], keepOut: (p: P, reach: number) => boolean, level: BrushLevel, edge = 0.6, wood: P[] = outline, kind: BrushKind = "mixed", closer = 1, most = 6000): BrushSpot[] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const spots: BrushSpot[] = [];
  if (outline.length < 3) return spots;
  const b = BRUSH[level];
  const step = Math.max(b.spacing / closer, Math.sqrt(((maxX - minX) * (maxY - minY)) / most));
  const range = (d: number, [lo, hi]: readonly [number, number]) => lo + d * (hi - lo);
  for (let y = minY; y <= maxY; y += step * 0.87) {
    for (let x = minX + ((Math.round((y - minY) / step) % 2) * step) / 2; x <= maxX; x += step) {
      const p = { x: x + (spotDraw({ x, y }, 11) - 0.5) * step * 0.9, y: y + (spotDraw({ x, y }, 12) - 0.5) * step * 0.9 };
      if (!pointInPolygon(p, outline)) continue;
      // (thickest along the wood's edge, where the light gets in; thinner deep inside)
      const sun = Math.exp(-edgeDistance(p, wood) / EDGE_DEPTH);
      if (edge > 0 && spotDraw(p, 24) > 1 - edge * (1 - sun)) continue;
      const young = spotDraw(p, 13) < (level === "heavy" || kind !== "mixed" ? 0.08 : 0.14);
      const growth = young ? null : pickGrowth(SHARES[kind](sun), spotDraw(p, 26));
      const dh = spotDraw(p, 15), dw = spotDraw(p, 17);
      let height: number, width: number;
      if (!growth) {
        // a young oak or ash
        height = 7 + spotDraw(p, 14) * 9;
        width = height * (0.45 + spotDraw(p, 16) * 0.2);
      } else if (growth === "thicket") {
        // laurel and rhododendron: taller and wider than the bushes, packed
        height = range(dh, b.height) * 1.3;
        width = height * range(dw, [1.2, 1.8]);
      } else if (growth === "briars") {
        // briars: chest- to head-high tangles of arching canes, wide, running into each other
        height = range(dh, [3.5, 7]) * b.size;
        width = height * range(dw, [1.5, 2.3]);
      } else if (growth === "weeds") {
        // weeds: upright stalks, narrow
        height = range(dh, [2.5, 5]) * b.size;
        width = height * range(dw, [0.6, 1]);
      } else {
        // bushes: the round and dense ones, and the twiggy airy ones
        height = range(dh, b.height);
        width = height * range(dw, b.width);
      }
      if (keepOut(p, width * 0.4)) continue;
      spots.push({ x: p.x, y: p.y, height, width, growth });
    }
  }
  return spots;
};

/** A wood of bushes only (the brush that comes in with the import): grown as underbrush, no trees. */
export const brushOnly = (a: { kind: string; bushes?: number }) => a.kind === "woods" && (a.bushes ?? 0) >= 1;
