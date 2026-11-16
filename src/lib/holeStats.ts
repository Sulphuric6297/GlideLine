// Numbers for each hole and the whole course: length, elevation change, how long it plays, par,
// shape, what is in the way, and safety checks between holes.
import { CIRCLE_ONE_FT, CLEAR_IN_FRONT_FT, FT_PER_M, MIN_PAD, TEE_LEVELS, TEE_ORDER } from "../constants";
import type { AreaItem, CourseDoc, CourseItem, Hole, Layout, LineItem, P, StructureItem, TeeItem, TeeLevel, TreeItem } from "../types";
import { fieldKindOf, fieldWord } from "./fields";
import { activeLayout, areaPath, basketFor, belongsTo, fairwayOutline, holeLabel, holeNumber, holeTees, linePath, obFor, obPieces, teeAim, teeFor, throwLine } from "./course";
import { boundsGap, boundsOf, centroid, densify, dist, distanceToPath, lengthInside, pathLength, pathTouchesPolygon, pointBoundsGap, segmentsIntersect, smoothPath, turnAngles } from "./geom";
import { heightAt, profileAlong } from "./terrainGrid";
import { fmtDist } from "./units";

/**
 * Minimum effective length (ft) for each par and tee color, from the PDGA Par Guidelines.
 * Effective length = the length along the intended route + 3 x the climb from tee to basket
 * (a drop counts the other way), longer again for doglegs and heavy foliage.
 */
export const PAR_MIN_FT: Record<TeeLevel, { par3: number; par4: number; par5: number }> = {
  gold: { par3: 250, par4: 625, par5: 1000 },
  blue: { par3: 200, par4: 525, par5: 800 },
  white: { par3: 160, par4: 450, par5: 675 },
  red: { par3: 140, par4: 375, par5: 550 },
  green: { par3: 100, par4: 325, par5: 475 },
  purple: { par3: 80, par4: 275, par5: 400 }
};
/** Typical 18-hole course length for each tee color (PDGA), ft. */
export const COURSE_LENGTH_FT: Record<TeeLevel, [number, number]> = {
  gold: [7000, 11000],
  blue: [5000, 8500],
  white: [4500, 7500],
  red: [3500, 5500],
  green: [2500, 4000],
  purple: [2000, 3500]
};
/** No hole should play shorter than this (PDGA), ft. */
export const MIN_HOLE_FT = 100;
/** How much longer heavy foliage makes a hole play (an estimate; the PDGA's par table has separate columns). */
export const HEAVY_FOLIAGE = 1.12;

export const parForDistance = (effectiveFt: number, level: TeeLevel) => {
  const lim = PAR_MIN_FT[level];
  if (effectiveFt < lim.par4) return 3;
  if (effectiveFt < lim.par5) return 4;
  if (effectiveFt < lim.par5 + (lim.par5 - lim.par4)) return 5;
  return 6;
};

export type HoleShape = "straight" | "left" | "right" | "s-curve";

export type HoleStats = {
  holeId: string;
  number: number;
  /** Its numbers as shown ("3", or "3/12" for a hole played as both). */
  label: string;
  /** The tee and basket used (the layout's), and the throw line between them. */
  teeId: string | null;
  basketId: string | null;
  level: TeeLevel;
  line: P[];
  /** Horizontal length along the throw line, ft. */
  length: number;
  /** Straight from tee to basket, ft. */
  direct: number;
  teeElevation: number;
  basketElevation: number;
  /** Basket minus tee, ft (positive: uphill). */
  elevationChange: number;
  /** Effective length (PDGA): length + 3 x climb, plus doglegs and heavy foliage. */
  playsLike: number;
  foliage: "light" | "heavy";
  par: number;
  parAuto: number;
  shape: HoleShape;
  /** Biggest turn of the line, degrees. */
  turn: number;
  /** Trees whose crowns the throw line passes through, and trees standing in the fairway. */
  treesOnLine: number;
  treesInFairway: number;
  /** OB or water the throw line crosses, and OB within the fairway or close to the basket. */
  obCrossed: number;
  obInPlay: boolean;
  obNearBasket: boolean;
  /** Steepest slope along the line (percent) and climb/descent totals (ft). */
  maxSlope: number;
  climb: number;
  descent: number;
  /** 1 (easy) to 5 (hard), for the hole sheet. */
  difficulty: number;
  complete: boolean;
};

/** Areas and lines as drawn (curved through their points, unless set straight). */
const asDrawn = <T extends AreaItem | LineItem>(i: T): T => ({ ...i, points: i.type === "area" ? areaPath(i) : linePath(i) });
const areasOf = (doc: Pick<CourseDoc, "items">, kinds: string[]) => (doc.items.filter(i => i.type === "area" && kinds.includes((i as AreaItem).kind)) as AreaItem[]).map(asDrawn);

/** Whether landing in or beyond it is out of bounds: OB shapes; water and streams unless marked
 * otherwise; anything else marked OB (a road, a fence line). */
export const isOb = (i: AreaItem | LineItem) => i.kind === "ob" || i.ob === true || ((i.kind === "water" || i.kind === "stream") && i.ob !== false);

/** Whether players have to stay out of it: an Out of play area, or a field, court or play area set
 * Out of play (a playground, a pool...). */
export const isOutOfPlay = (i: CourseItem): i is AreaItem => i.type === "area" && (i.kind === "nogo" || (i.kind === "field" && !!i.outOfPlay));

export const holeStats = (doc: CourseDoc, hole: Hole, layout: Layout | undefined = activeLayout(doc)): HoleStats => {
  const tee = teeFor(doc, hole.id, layout?.tee);
  const basket = basketFor(doc, hole.id, layout?.pin);
  const line = throwLine(hole, tee, basket);
  const level = tee?.level ?? layout?.tee ?? "blue";
  const complete = !!tee && !!basket;
  const g = (p: P) => heightAt(doc.terrainHeights, doc.gridSize, p.x, p.y);
  const length = complete ? pathLength(line) : 0;
  const direct = complete ? dist(line[0], line[line.length - 1]) : 0;
  const teeElevation = tee ? g(tee) + doc.site.baseElevationFt : 0;
  const basketElevation = basket ? g(basket) + (basket.raised ?? 0) + doc.site.baseElevationFt : 0;
  const elevationChange = complete ? basketElevation - teeElevation : 0;
  const turns = turnAngles(line);
  const turn = turns.reduce((m, t) => (Math.abs(t) > Math.abs(m) ? t : m), 0);
  const total = turns.reduce((s, t) => s + t, 0);
  const shape: HoleShape = Math.abs(turn) < 12 ? "straight"
    : turns.some(t => t > 12) && turns.some(t => t < -12) ? "s-curve"
    // Plan y points south, so a positive turn (clockwise on screen) bends right
    : total > 0 ? "right" : "left";

  // In the way
  const smooth = smoothPath(line, 10);
  const trees = doc.items.filter(i => i.type === "tree") as TreeItem[];
  const halfWidth = hole.fairwayWidth / 2;
  // (anything farther from the line's bounds than it reaches is farther from the line too)
  const box = boundsOf(smooth);
  let treesOnLine = 0, treesInFairway = 0;
  if (complete) for (const t of trees) {
    const reach = t.radius * (t.width ?? 1) * 0.8;
    if (pointBoundsGap(t, box) >= Math.max(reach, halfWidth)) continue;
    const d = distanceToPath(t, smooth);
    if (d < reach && dist(t, line[0]) > 10) treesOnLine++;
    if (d < halfWidth) treesInFairway++;
  }
  // Heavy foliage: trees all along it (about one per 60 ft of fairway), unless set by hand
  const foliage = hole.foliage ?? (complete && treesInFairway >= Math.max(3, length / 60) ? "heavy" : "light");
  // A bending hole plays longer than its line: the disc has to be shaped round the corner
  const shapeExtra = Math.min(0.15, turns.reduce((s, t) => s + Math.max(0, Math.abs(t) - 15), 0) / 600);
  const factor = doc.rules?.elevationFactor ?? 3;
  const playsLike = complete ? Math.max(0, (length + factor * elevationChange) * (1 + shapeExtra) * (foliage === "heavy" ? HEAVY_FOLIAGE : 1)) : 0;
  const parAuto = complete ? parForDistance(playsLike, level) : 3;
  const obAreas = (doc.items.filter(i => i.type === "area" && isOb(i)) as AreaItem[]).filter(a => !a.holeId || belongsTo(a, hole.id)).map(asDrawn);
  // (a line OB only along stretches of it: each stretch)
  const obLines = (doc.items.filter(i => i.type === "line" && isOb(i)) as LineItem[]).filter(l => obFor(doc, l, hole.id)).flatMap(l => obPieces(l).map(points => ({ ...l, points })));
  let obCrossed = 0;
  if (complete) {
    obCrossed += obAreas.filter(a => lengthInside(smooth, a.points, 3) > 4).length;
    for (const l of obLines) {
      let crossed = false;
      if (boundsGap(box, boundsOf(l.points)) > 0) continue;
      for (let i = 1; i < smooth.length && !crossed; i++) for (let j = 1; j < l.points.length && !crossed; j++) crossed = segmentsIntersect(smooth[i - 1], smooth[i], l.points[j - 1], l.points[j]);
      if (crossed) obCrossed++;
    }
  }
  const fairwayPoly = complete ? fairwayOutline(hole, smooth, 0, 10) : [];
  const obInPlay = complete && (obCrossed > 0 || obAreas.some(a => pathTouchesPolygon(a.points, fairwayPoly)) || obLines.some(l => boundsGap(box, boundsOf(l.points)) < halfWidth && densify(l.points, 8).some(p => pointBoundsGap(p, box) < halfWidth && distanceToPath(p, smooth) < halfWidth)));
  const obNearBasket = !!basket && (obAreas.some(a => {
    if (pointBoundsGap(basket, boundsOf(a.points)) >= CIRCLE_ONE_FT) return false;
    const d = a.points.length >= 3 ? Math.min(...a.points.map((p, i) => distanceToPath(basket, [p, a.points[(i + 1) % a.points.length]]))) : Infinity;
    return d < CIRCLE_ONE_FT;
  }) || obLines.some(l => distanceToPath(basket, l.points) < CIRCLE_ONE_FT));

  // Slope along the line
  let maxSlope = 0, climb = 0, descent = 0;
  if (complete) {
    const prof = profileAlong(doc.terrainHeights, doc.gridSize, line, Math.max(8, Math.round(length / 15)));
    for (let i = 1; i < prof.length; i++) {
      const dh = prof[i].h - prof[i - 1].h;
      const dd = prof[i].d - prof[i - 1].d;
      if (dd > 0) maxSlope = Math.max(maxSlope, Math.abs(dh / dd) * 100);
      if (dh > 0) climb += dh; else descent -= dh;
    }
  }

  const lim = PAR_MIN_FT[level];
  const par = tee?.par ?? hole.par ?? parAuto;
  // Difficulty: how far it plays within its par's range, plus trees, OB and shape
  const lo = par <= 3 ? lim.par3 : par === 4 ? lim.par4 : lim.par5;
  const hi = par <= 3 ? lim.par4 : par === 4 ? lim.par5 : lim.par5 + (lim.par5 - lim.par4);
  let score = 1.5 + 2 * Math.max(0, Math.min(1.2, (playsLike - lo) / Math.max(1, hi - lo)));
  score += Math.min(1, treesOnLine * 0.25 + treesInFairway * 0.05);
  score += obInPlay ? 0.6 : 0;
  score += obNearBasket ? 0.4 : 0;
  score += Math.min(0.5, Math.abs(turn) / 120);
  const difficulty = Math.max(1, Math.min(5, Math.round(score - 0.4)));

  return {
    holeId: hole.id, number: holeNumber(doc, hole.id), label: holeLabel(doc, hole.id), teeId: tee?.id ?? null, basketId: basket?.id ?? null, level, line,
    length, direct, teeElevation, basketElevation, elevationChange, playsLike, foliage, par, parAuto, shape, turn,
    treesOnLine, treesInFairway, obCrossed, obInPlay, obNearBasket, maxSlope, climb, descent, difficulty, complete
  };
};

export type CourseTotals = {
  holes: number;
  complete: number;
  length: number;
  par: number;
  /** Walking from each basket to the next tee, ft. */
  walk: number;
  longestWalk: { from: number; ft: number } | null;
  climb: number;
  shortest: HoleStats | null;
  longest: HoleStats | null;
  parCounts: Record<number, number>;
};

/** How many times a hole is played: once for each of its numbers (a hole that is 3 and 13 twice). */
export const playsOf = (doc: Pick<CourseDoc, "holes">, holeId: string) => 1 + (doc.holes.find(h => h.id === holeId)?.alsoNumbers?.length ?? 0);

/** The holes as they are played, in the order of their numbers: one for each number (a hole with
 * two numbers twice), each labelled with that number. */
export const playedHoles = <S extends { holeId: string; label: string }>(doc: Pick<CourseDoc, "holes">, stats: S[]) =>
  stats
    .flatMap(s => {
      const hole = doc.holes.find(h => h.id === s.holeId);
      const nums = [holeNumber(doc, s.holeId), ...(hole?.alsoNumbers ?? [])];
      return nums.map(n => ({ ...s, label: String(n), number: n }));
    })
    .sort((a, b) => a.number - b.number);

export const courseTotals = (doc: CourseDoc, stats: HoleStats[] = doc.holes.map(h => holeStats(doc, h))): CourseTotals => {
  const done = stats.filter(s => s.complete);
  // (a hole played as two numbers counts twice)
  const sum = (list: HoleStats[], f: (s: HoleStats) => number) => list.reduce((t, s) => t + f(s) * playsOf(doc, s.holeId), 0);
  let walk = 0;
  let longestWalk: CourseTotals["longestWalk"] = null;
  for (let i = 0; i + 1 < stats.length; i++) {
    const b = stats[i].line[stats[i].line.length - 1];
    const t = stats[i + 1].line[0];
    if (!stats[i].complete || !stats[i + 1].complete) continue;
    const d = dist(b, t);
    walk += d;
    if (!longestWalk || d > longestWalk.ft) longestWalk = { from: i + 1, ft: d };
  }
  const parCounts: Record<number, number> = {};
  done.forEach(s => { parCounts[s.par] = (parCounts[s.par] ?? 0) + playsOf(doc, s.holeId); });
  return {
    holes: sum(stats, () => 1),
    complete: sum(done, () => 1),
    length: sum(done, s => s.length),
    par: sum(done, s => s.par),
    walk,
    longestWalk,
    climb: sum(done, s => s.climb),
    shortest: done.length ? done.reduce((a, b) => (b.length < a.length ? b : a)) : null,
    longest: done.length ? done.reduce((a, b) => (b.length > a.length ? b : a)) : null,
    parCounts
  };
};

// --- Safety ---

export type SafetyIssue = {
  /** The same check on the same holes and things keeps its id as the course changes (so it can be
   * set aside). */
  id: string;
  level: "danger" | "warning" | "info";
  text: string;
  /** Holes involved (ids) and a spot to show on the map. */
  holes: string[];
  at: P;
};

/**
 * Recommended clear distance between one hole's throw line and another hole's tee, basket or
 * throw line, ft: a disc can stray about 15% of the throw's length sideways, with a 50 ft floor.
 */
export const SAFE_GAP_MIN_FT = 50;
export const defaultGap = (lengthFt: number) => Math.max(SAFE_GAP_MIN_FT, lengthFt * 0.15);

const pathPathDistance = (a: P[], b: P[]) => {
  let best = { d: Infinity, at: a[0] ?? { x: 0, y: 0 } };
  for (const p of a) { const d = distanceToPath(p, b); if (d < best.d) best = { d, at: p }; }
  for (const p of b) { const d = distanceToPath(p, a); if (d < best.d) best = { d, at: p }; }
  return best;
};

const crossing = (a: P[], b: P[]): P | null => {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return { x: (a[i - 1].x + a[i].x) / 2, y: (a[i - 1].y + a[i].y) / 2 };
  }
  return null;
};

/** Whether two holes play to the same basket (alternate tees: one waits on the other). */
const sharesBasket = (a: HoleStats, b: HoleStats) => (!!a.basketId && a.basketId === b.basketId) || dist(a.line[a.line.length - 1], b.line[b.line.length - 1]) < 3;
// The app never changes a course document in place, so the panels, the map and the step bar
// share one working-out of each document's numbers and checks.
const statsMemo = new WeakMap<CourseDoc, HoleStats[]>();
const issuesMemo = new WeakMap<CourseDoc, SafetyIssue[]>();
/** Every hole's numbers on the course's layout, worked out once for each document. */
export const courseStats = (doc: CourseDoc) => {
  let out = statsMemo.get(doc);
  if (!out) statsMemo.set(doc, (out = doc.holes.map(h => holeStats(doc, h))));
  return out;
};
/** The course's checks on its layout, worked out once for each document. */
export const courseIssues = (doc: CourseDoc) => {
  let out = issuesMemo.get(doc);
  if (!out) issuesMemo.set(doc, (out = safetyIssues(doc, courseStats(doc))));
  return out;
};

/** Holes this close (basket to the next tee, ft) need no path: the next tee is in sight. */
const NO_PATH_NEEDED_FT = 120;
/** How near a path has to come to a basket or tee to reach it, and two paths to meet (ft). */
const PATH_REACH_FT = 60, PATH_MEET_FT = 20;
/** What players can walk along: paths, walks and roads, and bridges, boardwalks and stairs (not
 * a wall). */
const WALKED_ON = ["bridge", "boardwalk", "stairs"];
const walkwaysOf = (doc: CourseDoc): P[][] => [
  ...(doc.items.filter(i => i.type === "line" && ["path", "walk", "road"].includes((i as LineItem).kind)) as LineItem[]).map(l => linePath(l)),
  ...(doc.items.filter(i => i.type === "structure" && WALKED_ON.includes(i.kind)) as StructureItem[]).map(s => s.points)
].filter(p => p.length >= 2);
/** Whether paths that meet one another lead from one spot to another. */
const connected = (ways: P[][], from: P, to: P) => {
  const start = ways.map((w, k) => (distanceToPath(from, w) <= PATH_REACH_FT ? k : -1)).filter(k => k >= 0);
  const seen = new Set(start), todo = [...start];
  while (todo.length) {
    const k = todo.pop()!;
    if (distanceToPath(to, ways[k]) <= PATH_REACH_FT) return true;
    for (let j = 0; j < ways.length; j++) if (!seen.has(j) && pathPathDistance(ways[k], ways[j]).d <= PATH_MEET_FT) { seen.add(j); todo.push(j); }
  }
  return false;
};

export const safetyIssues = (doc: CourseDoc, stats: HoleStats[] = doc.holes.map(h => holeStats(doc, h))): SafetyIssue[] => {
  const issues: SafetyIssue[] = [];
  const fixed = doc.rules?.safetyGapFt;
  const safeGap = (len: number) => (fixed && fixed > 0 ? fixed : defaultGap(len));
  const done = stats.filter(s => s.complete);
  const smooth = new Map(done.map(s => [s.holeId, smoothPath(s.line, 8)]));
  const boxes = new Map([...smooth].map(([id, l]) => [id, boundsOf(l)]));
  const n = (s: HoleStats) => `Hole ${s.label}`;
  // (a second hole in the same sentence)
  const m = (s: HoleStats) => `hole ${s.label}`;
  const ft = (d: number) => fmtDist(d, doc.units);
  const roads = (doc.items.filter(it => it.type === "line" && ((it as LineItem).kind === "road" || (it as LineItem).kind === "path")) as LineItem[]).map(l => {
    const pts = linePath(l);
    return { l, pts, box: boundsOf(pts) };
  });
  // (out of play (a field set so: by its own name), a parking lot, a building: drawn as an area, or
  // built with Build; not a deck, which a tee can stand on)
  const keepOut: { id: string; points: P[]; what: string }[] = [
    ...(doc.items.filter(isOutOfPlay) as AreaItem[]).map(asDrawn).map(a => ({ id: a.id, points: a.points, what: a.kind === "field" ? `a ${fieldWord(fieldKindOf(a))}` : "an out-of-play area" })),
    ...areasOf(doc, ["parking", "building"]).map(a => ({ id: a.id, points: a.points, what: a.kind === "parking" ? "a parking lot" : "a building" })),
    ...(doc.items.filter(i => i.type === "structure" && (i.kind === "building" || i.kind === "shelter")) as StructureItem[]).filter(s => s.points.length >= 3).map(s => ({ id: s.id, points: s.points, what: s.kind === "shelter" ? "a shelter" : "a building" }))
  ];
  // (fields, courts and play areas in play: played over, with people on them; power lines overhead)
  const fieldsInPlay = areasOf(doc, ["field"]).filter(f => !f.outOfPlay);
  const powerLines = (doc.items.filter(it => it.type === "line" && (it as LineItem).kind === "power") as LineItem[]).map(l => {
    const pts = linePath(l);
    return { l, pts, box: boundsOf(pts) };
  });
  for (let i = 0; i < done.length; i++) {
    const a = done[i];
    const la = smooth.get(a.holeId)!;
    const boxA = boxes.get(a.holeId)!;
    const gapA = safeGap(a.length);
    for (let j = i + 1; j < done.length; j++) {
      const b = done[j];
      const lb = smooth.get(b.holeId)!;
      // (holes to one basket wait on each other for it: never thrown at the same time)
      if (sharesBasket(a, b)) continue;
      // (the same id whichever order the holes are in)
      const pair = [a.holeId, b.holeId].sort().join(":");
      const need = Math.min(gapA, safeGap(b.length));
      const apart = boundsGap(boxA, boxes.get(b.holeId)!);
      if (apart >= need) continue;
      const x = apart > 0 ? null : crossing(la, lb);
      if (x) {
        issues.push({ id: `cross:${pair}`, level: "danger", text: `${n(a)} and ${m(b)}: the throw lines cross.`, holes: [a.holeId, b.holeId], at: x });
        continue;
      }
      const near = pathPathDistance(la, lb);
      if (near.d < need) {
        issues.push({ id: `close:${pair}`, level: near.d < need * 0.5 ? "danger" : "warning", text: `${n(a)} and ${m(b)}: throw lines only ${ft(near.d)} apart (${ft(need)} recommended).`, holes: [a.holeId, b.holeId], at: near.at });
      }
    }
    // Other holes' tees and baskets near this hole's line (beyond its own ends)
    for (const b of done) {
      if (b.holeId === a.holeId || sharesBasket(a, b)) continue;
      const tee = b.line[0];
      const basket = b.line[b.line.length - 1];
      const dTee = pointBoundsGap(tee, boxA) < gapA ? distanceToPath(tee, la) : Infinity;
      // The next hole's tee is expected near this hole's basket, so measure it from the line short of the basket
      if (dTee < gapA && dist(tee, la[la.length - 1]) > 30) {
        issues.push({ id: `tee-near:${a.holeId}:${b.holeId}`, level: dTee < gapA * 0.5 ? "danger" : "warning", text: `${n(b)}'s tee is ${ft(dTee)} from ${m(a)}'s throw line (${ft(gapA)} recommended).`, holes: [a.holeId, b.holeId], at: tee });
      }
      const dBasket = pointBoundsGap(basket, boxA) < gapA * 0.8 ? distanceToPath(basket, la) : Infinity;
      if (dBasket < gapA * 0.8 && dist(basket, la[0]) > 30) {
        issues.push({ id: `basket-near:${a.holeId}:${b.holeId}`, level: "warning", text: `${n(b)}'s basket is ${ft(dBasket)} from ${m(a)}'s throw line (${ft(gapA * 0.8)} recommended).`, holes: [a.holeId, b.holeId], at: basket });
      }
    }
    // Roads, paths, parking and out-of-play areas in the line of fire
    for (const { l, pts, box } of roads) {
      const x2 = boundsGap(boxA, box) > 0 ? null : crossing(la, pts);
      if (x2) issues.push({ id: `crosses:${a.holeId}:${l.id}`, level: l.kind === "road" ? "danger" : "warning", text: `${n(a)} throws across a ${l.kind === "road" ? "road" : "walking path"}.`, holes: [a.holeId], at: x2 });
    }
    for (const ar of keepOut) {
      if (pathTouchesPolygon(la, ar.points)) issues.push({ id: `over:${a.holeId}:${ar.id}`, level: "danger", text: `${n(a)} throws over ${ar.what}.`, holes: [a.holeId], at: centroid(ar.points) });
    }
    for (const f of fieldsInPlay) {
      if (pathTouchesPolygon(la, f.points)) issues.push({ id: `across:${a.holeId}:${f.id}`, level: "warning", text: `${n(a)} throws across a ${fieldWord(fieldKindOf(f))}.`, holes: [a.holeId], at: centroid(f.points) });
    }
    for (const { l, pts, box } of powerLines) {
      const x3 = boundsGap(boxA, box) > 0 ? null : crossing(la, pts);
      if (x3) issues.push({ id: `under:${a.holeId}:${l.id}`, level: "warning", text: `${n(a)} throws under a power line.`, holes: [a.holeId], at: x3 });
    }
    // Off the site
    const outside = la.find(p => p.x < 0 || p.y < 0 || p.x > doc.canvas.width || p.y > doc.canvas.height);
    if (outside) issues.push({ id: `off-site:${a.holeId}`, level: "info", text: `${n(a)} runs off the edge of the site.`, holes: [a.holeId], at: outside });
  }
  // Walks between holes: a long one, and one with no path to follow
  const walkways = walkwaysOf(doc);
  for (let i = 0; i + 1 < stats.length; i++) {
    const a = stats[i], b = stats[i + 1];
    if (!a.complete || !b.complete) continue;
    const from = a.line[a.line.length - 1], to = b.line[0];
    const d = dist(from, to);
    if (d > 400) issues.push({ id: `long-walk:${a.holeId}:${b.holeId}`, level: "info", text: `Long walk from ${n(a)}'s basket to ${m(b)}'s tee: ${ft(d)}.`, holes: [a.holeId, b.holeId], at: to });
    if (d > NO_PATH_NEEDED_FT && !connected(walkways, from, to)) issues.push({ id: `no-path:${a.holeId}:${b.holeId}`, level: "info", text: `No path from ${n(a)}'s basket to ${m(b)}'s tee.`, holes: [a.holeId, b.holeId], at: to });
  }
  // Holes not finished
  stats.filter(s => !s.complete).forEach(s => issues.push({ id: `unfinished:${s.holeId}`, level: "info", text: `Hole ${s.label} needs ${s.teeId ? "a basket" : "a tee"}.`, holes: [s.holeId], at: s.line[0] ?? { x: 0, y: 0 } }));
  issues.push(...designChecks(doc, stats));
  return issues;
};

/** The checks not set aside, and those set aside. */
/** A two-hole check's id with its holes the other way round (as ignored before they were sorted). */
export const swapped = (id: string) => id.replace(/^(cross|close):([^:]+):([^:]+)$/, "$1:$3:$2");
export const openIssues = (doc: Pick<CourseDoc, "ignoredChecks">, issues: SafetyIssue[]) => {
  const list = doc.ignoredChecks ?? [];
  const off = new Set([...list, ...list.map(swapped)]);
  return { open: issues.filter(i => !off.has(i.id)), ignored: issues.filter(i => off.has(i.id)) };
};

export const teeLevelLabel = (level: TeeLevel) => TEE_LEVELS[level].label;
export const levelsOnCourse = (doc: CourseDoc): TeeLevel[] => TEE_ORDER.filter(l => doc.items.some(i => i.type === "tee" && i.level === l));

/** Checks against the PDGA's design guidance: tee pads, the space in front of tees, hole and
 * course length, water carries from the shortest tees, and where the course starts and ends. */
export const designChecks = (doc: CourseDoc, stats: HoleStats[]): SafetyIssue[] => {
  const issues: SafetyIssue[] = [];
  const trees = doc.items.filter(i => i.type === "tree") as TreeItem[];
  const tees = doc.items.filter(i => i.type === "tee") as TeeItem[];
  const ft = (d: number) => fmtDist(d, doc.units);
  // (a pad's size, to a tenth of a meter: "1.2 × 3.0 m")
  const size = (w: number, l: number) => (doc.units === "m" ? `${(w / FT_PER_M).toFixed(1)} × ${(l / FT_PER_M).toFixed(1)} m` : `${w} × ${l} ft`);
  for (const tee of tees) {
    const num = holeLabel(doc, tee.holeId);
    if (tee.padWidth < MIN_PAD.width || tee.padLength < MIN_PAD.length) {
      issues.push({ id: `pad:${tee.id}`, level: "warning", text: `Hole ${num}'s ${TEE_LEVELS[tee.level].label.toLowerCase()} tee pad is ${size(tee.padWidth, tee.padLength)} (at least ${size(MIN_PAD.width, MIN_PAD.length)} recommended).`, holes: [tee.holeId], at: tee });
    }
    // Trees within 20 ft in front of the pad (in a 60° wedge down the hole)
    const aim = (teeAim(doc, tee) * Math.PI) / 180;
    const front = { x: tee.x + Math.cos(aim) * tee.padLength / 2, y: tee.y + Math.sin(aim) * tee.padLength / 2 };
    const blocker = trees.find(t => {
      const d = dist(front, t) - t.radius * 0.3;
      if (d > CLEAR_IN_FRONT_FT) return false;
      const a = Math.atan2(t.y - front.y, t.x - front.x) - aim;
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < Math.PI / 6;
    });
    if (blocker) issues.push({ id: `tree-front:${tee.id}`, level: "warning", text: `Hole ${num}: a tree stands within ${ft(CLEAR_IN_FRONT_FT)} in front of the ${TEE_LEVELS[tee.level].label.toLowerCase()} tee.`, holes: [tee.holeId], at: blocker });
  }
  for (const s of stats.filter(x => x.complete)) {
    if (s.playsLike < MIN_HOLE_FT) issues.push({ id: `short:${s.holeId}`, level: "warning", text: `Hole ${s.label} plays ${ft(s.playsLike)}: shorter than the ${ft(MIN_HOLE_FT)} minimum.`, holes: [s.holeId], at: s.line[0] });
  }
  // Water carries from each hole's shortest tee
  const water = areasOf(doc, ["water"]);
  if (water.length) {
    for (const hole of doc.holes) {
      const hTees = holeTees(doc, hole.id);
      const shortest = hTees[hTees.length - 1];
      const basket = basketFor(doc, hole.id);
      if (!shortest || !basket) continue;
      const line = smoothPath(throwLine(hole, shortest, basket), 8);
      if (water.some(w => lengthInside(line, w.points, 3) > 6)) {
        issues.push({ id: `water-carry:${hole.id}`, level: "warning", text: `Hole ${holeLabel(doc, hole.id)}: even the shortest tee has to throw over water.`, holes: [hole.id], at: shortest });
      }
    }
  }
  // Course length for the layout's tee color (scaled to the number of holes)
  const done = stats.filter(x => x.complete);
  if (done.length >= 9) {
    const level = done[0].level;
    const [lo, hi] = COURSE_LENGTH_FT[level];
    const total = done.reduce((t, x) => t + x.length * playsOf(doc, x.holeId), 0);
    const played = done.reduce((t, x) => t + playsOf(doc, x.holeId), 0);
    const k = played / 18;
    if (total < lo * k || total > hi * k) {
      issues.push({ id: "course-length", level: "info", text: `These ${played} holes add up to ${ft(total)}. That's ${total < lo * k ? "short" : "long"} for ${TEE_LEVELS[level].label.toLowerCase()} tees, which usually run ${ft(lo * k)} to ${ft(hi * k)}.`, holes: [], at: done[0].line[0] });
    }
  }
  // Start and finish near parking
  const parking = [
    ...(doc.items.filter(i => i.type === "amenity" && i.kind === "parking") as P[]),
    ...(doc.items.filter(i => i.type === "area" && (i as AreaItem).kind === "parking") as P[])
  ];
  if (parking.length && done.length >= 2) {
    const first = done[0].line[0];
    const last = done[done.length - 1].line[done[done.length - 1].line.length - 1];
    const near = (p: P) => Math.min(...parking.map(q => dist(p, q)));
    if (near(first) > 500) issues.push({ id: "parking-start", level: "info", text: `Hole ${done[0].label}'s tee is ${ft(near(first))} from parking.`, holes: [done[0].holeId], at: first });
    if (near(last) > 500) issues.push({ id: "parking-end", level: "info", text: `The last basket is ${ft(near(last))} from parking.`, holes: [done[done.length - 1].holeId], at: last });
  }
  return issues;
};
