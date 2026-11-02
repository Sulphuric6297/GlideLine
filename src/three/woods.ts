// Woods in 3D: a drawn woods area filled with real-looking trees (see treeKit), drawn instanced
// so thousands stay quick: mostly broadleaf canopy trees with some conifers, a few smaller trees
// beneath them, each its own height, crown, lean and shade of green.
import type { BrushKind, LidarTree, P } from "../types";
import { BRUSH_VARIANTS } from "./ezShapes";
import { pointInPolygon } from "../lib/geom";
import { BRUSH, spotDraw, underbrushSpots, type BrushLevel } from "../lib/brushSpots";
import { Forest, VARIANTS, type TreeSpot } from "./treeKit";
import { foliageTint } from "./trees";
import { LOOK_TINT, conifersWith, drawOf, lookFor, shapeWith, variantOf, type TreeLookId, type TreeShares } from "../lib/treeMix";

/** A tree's variant and leaf color as its look has them (none: as drawn). */
const asLook = (look: TreeLookId | null, variant: number, u: number) => (look ? variantOf(look, u) : variant);
const tintAs = <T extends { offsetHSL: (h: number, s: number, l: number) => T }>(look: TreeLookId | null, c: T) => (look ? c.offsetHSL(...LOOK_TINT[look]) : c);

const MAX_TREES = 6000;

/** How a wood fills itself (unset: the landscape's mix, usual heights). */
export type WoodsFill = { pines?: number; bushes?: number; heights?: [number, number] };

/** Trees about every `spacing` feet inside the outline, standing on the ground. */
export const createWoods = (outline: P[], groundAt: (x: number, y: number) => number, color: string, conifers = 0.22, mix: string[] = [], keepOut: (p: P, reach: number) => boolean = () => false, spacing = 22, fill: WoodsFill = {}, shares: TreeShares | null = null) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return createWoodsWhere(outline.length >= 3 ? { minX, minY, maxX, maxY } : null, p => pointInPolygon(p, outline), groundAt, color, fill.pines ?? conifers, mix, keepOut, spacing, fill, shares);
};

/** Trees about every `spacing` feet wherever `inside` says, within the bounds, standing on the ground;
 * with the course's kinds of trees (`shares`, lib/treeMix), each tree one of them (none of a shape
 * allowed: none of it). */
export const createWoodsWhere = (bounds: { minX: number; minY: number; maxX: number; maxY: number } | null, inside: (p: P) => boolean, groundAt: (x: number, y: number) => number, color: string, conifers = 0.22, mix: string[] = [], keepOut: (p: P, reach: number) => boolean = () => false, spacing = 22, fill: WoodsFill = {}, shares: TreeShares | null = null) => {
  const spots: TreeSpot[] = [];
  conifers = conifersWith(shares, conifers);
  if (bounds) {
    const { minX, minY, maxX, maxY } = bounds;
    const area = (maxX - minX) * (maxY - minY);
    const step = Math.max(spacing, Math.sqrt(area / MAX_TREES));
    let seed = Math.round(Math.abs(minX * 13 + minY * 7)) % 2147483646 + 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = minY; y <= maxY; y += step * 0.87) {
      for (let x = minX + ((Math.round((y - minY) / step) % 2) * step) / 2; x <= maxX; x += step) {
        const p = { x: x + (rnd() - 0.5) * step * 0.7, y: y + (rnd() - 0.5) * step * 0.7 };
        if (!inside(p)) continue;
        const u = rnd();
        // (a bush, for its share of the spots: a draw of its own)
        const bush = (fill.bushes ?? 0) > 0 && spotDraw(p, 1) < (fill.bushes ?? 0);
        const shape = bush ? "bush" : u < conifers ? "conifer" : "broadleaf";
        // Now and then a smaller tree under the big ones
        const small = rnd() < 0.18;
        let height = small ? 16 + rnd() * 12 : shape === "conifer" ? 45 + rnd() * 35 : 38 + rnd() * 34;
        // (heights asked for: the same spread of sizes within them; a bush its own few feet)
        if (fill.heights && !bush) { const [lo, hi] = fill.heights, t = Math.min(1, Math.max(0, (height - 16) / 64)); height = lo + (hi - lo) * t; }
        if (bush) height = 3 + spotDraw(p, 2) * 6;
        const width = bush ? height * (1.2 + spotDraw(p, 3) * 0.6) : (shape === "conifer" ? height * 0.42 : Math.max(step * 1.25, height * 0.62)) * (0.8 + rnd() * 0.4) * (small ? 0.7 : 1);
        // (its kind among the course's, by its spot: the woods' own draws stay as they were)
        const look = lookFor(shape, spotDraw(p, 7), shares);
        const tree: TreeSpot = {
          ...p,
          ground: 0,
          height,
          width,
          shape,
          variant: asLook(look, Math.floor(rnd() * VARIANTS[shape]), spotDraw(p, 8)),
          // (conifers darker and bluer than the broadleaf trees)
          tint: tintAs(look, shape === "conifer" ? foliageTint(color, rnd).offsetHSL(0.03, -0.06, -0.08) : foliageTint(mix.length ? mix[Math.floor(rnd() * mix.length)] : color, rnd)),
          turn: rnd() * Math.PI * 2,
          lean: (rnd() - 0.5) * 0.06
        };
        // None on the fairways, water, paths, tees and baskets (crowns may lean over the edges).
        // (Every draw above is made either way, so clearing one spot leaves the other trees be.)
        if (keepOut(p, width * 0.3)) continue;
        tree.ground = groundAt(p.x, p.y);
        spots.push(tree);
      }
    }
  }
  const forest = new Forest(spots);
  forest.group.name = "woods";
  forest.group.userData.forest = forest;
  // (where each tree stands and how big it is: flyovers keep clear of them)
  forest.group.userData.spots = spots;
  return forest.group;
};

/** Trees measured from the air, each where it stands, as tall and as wide as measured; with the
 * course's kinds (`shares`), each one of them (the painted map picks the same), a needle tree leafy
 * where no needle kind is allowed (and the other way round). */
export const createMeasuredWoods = (trees: { tree: LidarTree; index: number }[], groundAt: (x: number, y: number) => number, color: string, mix: string[] = [], shares: TreeShares | null = null) => {
  const spots: TreeSpot[] = trees.map(({ tree: [x, y, height, radius, conifer], index }) => {
    // (each its own look, the same every time it's drawn)
    let seed = (index * 7919 + 13) % 2147483646 + 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shape = shapeWith(shares, conifer ? "conifer" : "broadleaf");
    const look = lookFor(shape, drawOf(index, 7), shares);
    return {
      x, y,
      ground: groundAt(x, y),
      height,
      width: radius * 2,
      shape,
      variant: asLook(look, Math.floor(rnd() * VARIANTS[shape]), drawOf(index, 8)),
      tint: tintAs(look, shape === "conifer" ? foliageTint(color, rnd).offsetHSL(0.03, -0.06, -0.08) : foliageTint(mix.length ? mix[Math.floor(rnd() * mix.length)] : color, rnd)),
      turn: rnd() * Math.PI * 2,
      lean: (rnd() - 0.5) * 0.06
    };
  });
  const forest = new Forest(spots);
  forest.group.name = "woods";
  forest.group.userData.forest = forest;
  forest.group.userData.spots = spots;
  forest.group.userData.measured = true;
  forest.group.userData.indexes = trees.map(t => t.index);
  return forest.group;
};

/** Underbrush in a wood: its bushes where lib/brushSpots puts them (the painted map draws the
 * same), each drawn as what it is: a bush (round and dense, or twiggy and airy, more of those the
 * heavier), a thicket shrub, briars, weeds, or a young tree. */
export const createUnderbrush = (outline: P[], groundAt: (x: number, y: number) => number, color: string, mix: string[], keepOut: (p: P, reach: number) => boolean, level: BrushLevel, edge = 0.6, wood: P[] = outline, kind: BrushKind = "mixed", closer = 1) => {
  const b = BRUSH[level];
  const spots: TreeSpot[] = underbrushSpots(outline, keepOut, level, edge, wood, kind, closer, MAX_TREES).map((s, k) => {
    const p = { x: s.x, y: s.y }, growth = s.growth, dv = spotDraw(p, 20);
    const variant = !growth ? 4 + Math.floor(spotDraw(p, 19) * 2)
      : growth === "shrub" ? (spotDraw(p, 25) < b.airy ? 4 + Math.floor(dv * 2) : Math.floor(dv * 4))
      : BRUSH_VARIANTS[growth][Math.floor(dv * 2)];
    const r = () => spotDraw(p, 18 + k % 7);
    const tint = foliageTint(mix.length ? mix[Math.floor(spotDraw(p, 21) * mix.length)] : color, r);
    // (briars a cooler, deeper green; weeds a yellower one)
    if (growth === "briars") tint.offsetHSL(0.025, 0.06, -0.04);
    else if (growth === "weeds") tint.offsetHSL(-0.035, 0.04, 0.03);
    return {
      ...p,
      ground: groundAt(p.x, p.y),
      height: s.height,
      width: s.width,
      shape: growth ? "bush" : "broadleaf",
      variant,
      tint,
      turn: spotDraw(p, 22) * Math.PI * 2,
      lean: (spotDraw(p, 23) - 0.5) * (growth === "weeds" ? 0.2 : 0.08)
    };
  });
  // (lighter versions than trees get: the middle one close by, the lightest beyond)
  const forest = new Forest(spots, b.reach, { levels: ["mid", "far", "brush"], nearFt: 45, midFt: 110 });
  forest.group.name = "woods";
  forest.group.userData.forest = forest;
  forest.group.userData.spots = spots;
  forest.group.userData.underbrush = true;
  return forest.group;
};
