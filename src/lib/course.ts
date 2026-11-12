// Making course documents and items, and finding a hole's parts.
import { CIRCLE_ONE_FT, DEFAULT_CANVAS, DEFAULT_FAIRWAY_FT, DEFAULT_PAD, LINE_KINDS, PIN_POSITIONS, STRUCTURE_KINDS, TEE_ORDER, TREE_COLORS, generateId } from "../constants";
import type {
  AmenityItem, AmenityKind, AreaItem, AreaKind, BasketItem, CourseDoc, CourseItem, CourseRules, DropZoneItem, Hole, LabelItem,
  Layout, LineItem, LineKind, MandoItem, MapStyle, P, PinPosition, StructureItem, StructureKind, TeeItem, TeeLevel, TreeItem
} from "../types";
import { centroid, corridor, dist, nearestAlong, nearestOnSegment, pathLength, pointAlong, pointInPolygon, smoothClosed, smoothPath, subPath } from "./geom";
import { landscapeOf } from "./landscapes";
import { flyoverOf, keysAsTheyFlew } from "./flight";

export const defaultStyle = (): MapStyle => ({
  theme: "forest",
  title: "",
  subtitle: "",
  footer: "",
  fairway: "#6f9255",
  rough: "#4d6a3c",
  ob: "#ff4b4b",
  hazard: "#ffd23f",
  water: "#23677f",
  path: "#6e5b38",
  trees: "#354a2c",
  basket: "#ffffff",
  basketMark: "basket",
  markings: "map",
  photo: 1,
  contours: false,
  hillshade: true,
  throwLines: false,
  distances: false,
  nextTee: false,
  circle: false,
  legend: false,
  holeTable: false,
  north: true,
  scale: true,
  font: "Script",
  forest: "photo",
  treeCover: 1,
  sunAngle: 315,
  sunHeight: 38,
  shadows: 0.65,
  light: 0,
  contrast: 0,
  colorStrength: 1,
  paint: 0.8,
  rotation: 0,
  labelScale: 1,
  paper: "tabloid",
  orientation: "auto"
});

export const defaultLayouts = (): Layout[] => [
  { id: "layout-main", name: "Main", tee: "blue", pin: "A" }
];

/** Prices are rough 2026 US figures for budgeting, meant to be edited. */
export const defaultRules = (): CourseRules => ({
  elevationFactor: 3,
  prices: { basket: 450, teePad: 350, sign: 120, bench: 300, trash: 150, kiosk: 1200, sleeve: 40 }
});

/** The font the course's title is set in. */
export const titleFontOf = (s: { font: string; titleFont?: string }) => s.titleFont || s.font;

/** The line under the course's name, as printed (none: ""). */
export const taglineOf = (s: { tagline?: string }) => (s.tagline ?? "Disc golf course").trim().toUpperCase();

export const createEmptyCourse = (): CourseDoc => ({
  version: 1,
  id: generateId(),
  name: "New Disc Golf Course",
  designer: "",
  site: { location: null, bounds: null, baseElevationFt: 0 },
  canvas: { ...DEFAULT_CANVAS },
  gridSize: 20,
  terrainHeights: {},
  groundPaint: {},
  background: null,
  holes: [],
  items: [],
  layouts: defaultLayouts(),
  activeLayout: "layout-main",
  // (a new course starts in Brushed; one saved without a look is Classic, as it was)
  style: { ...defaultStyle(), mapLook: "handpainted" },
  units: "ft",
  rules: defaultRules()
});

/** The painted Forest map is the one style: a course saved in one of the old ones (illustrated,
 * satellite, topographic, minimal, night) comes back as Forest in its landscape's colors (keeping
 * what it showed, its lettering and its marks). */
const forestStyle = (style: CourseDoc["style"]): CourseDoc["style"] => {
  if (style.theme === "forest") return style;
  const l = landscapeOf(style);
  return { ...style, theme: "forest", ...l.colors, ob: "#e0483d", hazard: "#e8c547", basket: "#ffffff" };
};

/** The woods an older import made from the measured trees, with nothing set on them by hand: only
 * a painting under the trees, so they go (the trees each stand on their own). */
const bareStand = (i: CourseItem) =>
  i.type === "area" && i.kind === "woods" && i.importSource === "lidar" && !i.label && i.ob === undefined && !i.hazard && !i.underbrush && !i.brush?.length &&
  i.trees === undefined && i.pines === undefined && i.bushes === undefined && i.density === undefined && i.heights === undefined;

/** Measured trees no longer go with a wood: the ones a wood took with it (its edge pulled in past
 * them, or the wood deleted) are cut down for good, and the rest stand on their own. */
const unbound = (lidar: NonNullable<CourseDoc["lidar"]>, items: CourseItem[]): NonNullable<CourseDoc["lidar"]> => {
  if (!lidar.bound?.length) return lidar;
  const woods = items.filter((i): i is AreaItem => i.type === "area" && i.kind === "woods" && i.points.length >= 3).map(areaPath);
  const gone = lidar.bound.filter(k => { const t = lidar.trees[k]; return t && !woods.some(w => pointInPolygon({ x: t[0], y: t[1] }, w)); });
  const removed = [...new Set([...(lidar.removed ?? []), ...gone])].sort((a, b) => a - b);
  return { ...lidar, bound: undefined, removed: removed.length ? removed : undefined };
};

/** A wood's or tall grass's older settings, made simple: trees from the survey only, or filled
 * in, or in patches, all keep the measured trees and fill in the whole wood; each underbrush
 * section becomes woods of bushes of its own (as thick as its level). */
const simpleWoods = (items: CourseItem[]): CourseItem[] => {
  if (!items.some(i => i.type === "area" && (i.trees === "measured" || i.trees === "custom" || i.patches || i.brush || i.brushEdge !== undefined))) return items;
  return items.flatMap((i): CourseItem[] => {
    if (i.type !== "area" || (i.kind !== "woods" && i.kind !== "rough")) return [i];
    const { patches: _p, brush, brushEdge: _e, ...rest } = i;
    const own: AreaItem = { ...rest, trees: i.trees === "measured" || i.trees === "custom" ? undefined : i.trees };
    const bushes = (brush ?? []).filter(b => b.level !== "none" && b.points.length >= 3).map(b => {
      const at = centroid(b.points);
      return { id: generateId(), type: "area", kind: "woods", x: at.x, y: at.y, points: b.points, bushes: 1, density: b.level === "light" ? 0.5 : b.level === "heavy" ? 2 : undefined, brushKind: b.kind ?? i.brushKind } as AreaItem;
    });
    return [own, ...bushes];
  });
};

/** Fills in anything an older or hand-edited file is missing. */
/** What a thing brought in is like, as a short code (the same as lib/importSite's signOf, which
 * can't be reached from here without a circle). */
const signOfItem = (i: CourseItem) => {
  const { id: _id, importSig: _sig, ...rest } = i as CourseItem & { importSig?: string };
  const text = JSON.stringify(rest, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v));
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
  return (h >>> 0).toString(36);
};

export const normalizeCourse = (raw: Partial<CourseDoc>): CourseDoc => {
  const base = createEmptyCourse();
  // (a course's look is its own: an older one, saved without one, stays Classic)
  delete base.style.mapLook;
  const doc: CourseDoc = {
    ...base,
    ...raw,
    site: { ...base.site, ...(raw.site ?? {}) },
    canvas: raw.canvas && raw.canvas.width > 0 && raw.canvas.height > 0 ? raw.canvas : base.canvas,
    // (Courses saved before there was a choice of basket marks keep the mark their style had)
    style: forestStyle({ ...base.style, ...(raw.style && !raw.style.basketMark ? { basketMark: raw.style.theme === "forest" || !raw.style.theme ? "basket" : "target" } : {}), ...(raw.style ?? {}), nextTee: false }),
    rules: { ...base.rules, ...(raw.rules ?? {}), prices: { ...base.rules.prices, ...(raw.rules?.prices ?? {}) } },
    holes: (raw.holes ?? []).map(h => {
      const stations = Array.isArray(h.fairwayStations) && h.fairwayStations.length > 0 && h.fairwayStations.every((v, i, a) => Number.isFinite(v) && v > 0 && v < 1 && (i === 0 || v > a[i - 1])) ? h.fairwayStations : undefined;
      const S = stations ?? FAIRWAY_STATIONS;
      const shape = Array.isArray(h.fairwayShape) && h.fairwayShape.length === S.length && h.fairwayShape.every(v => typeof v === "number" && v > 0) ? h.fairwayShape : undefined;
      const shift = Array.isArray(h.fairwayShift) && h.fairwayShift.length === S.length && h.fairwayShift.every(v => Number.isFinite(v)) ? h.fairwayShift : undefined;
      const number = Number.isInteger(h.number) && h.number! > 0 ? h.number : undefined;
      const alsoNumbers = Array.isArray(h.alsoNumbers) ? h.alsoNumbers.filter(v => Number.isInteger(v) && v > 0) : [];
      // (a flight through keyframes saved while Speed and the flyover's Lens still applied to it:
      // its keyframes given the seconds and lens it flew with, and Speed 1 of its own, so it's
      // done once)
      const fly = h.flyKeys && h.flyKeys.length >= 2 ? flyoverOf({ flyover: raw.flyover }, h) : null;
      if (fly && (fly.speed !== 1 || h.flyKeys!.some(k => k.fov === undefined))) h = { ...h, flyKeys: keysAsTheyFlew(h.flyKeys!, fly.speed, fly.fov), ...(fly.speed !== 1 ? { flyover: { ...h.flyover, speed: 1 } } : {}) };
      return { ...h, number, alsoNumbers: alsoNumbers.length ? alsoNumbers : undefined, fairwayWidth: h.fairwayWidth ?? DEFAULT_FAIRWAY_FT, fairway: h.fairway ?? true, doglegs: h.doglegs ?? [], fairwayShape: shape, fairwayShift: shift, fairwayStations: stations && (shape || shift) ? stations : undefined };
    }),
    // (A structure needs its points and a kind this version knows)
    items: Array.isArray(raw.items) ? raw.items.filter(i => i.type !== "structure" || (Array.isArray(i.points) && i.kind in STRUCTURE_KINDS)).map(i => {
      // (palms are gone: one placed before is a leafy tree now)
      if (i.type === "tree" && (i.treeType as string) === "palm") return { ...i, treeType: "deciduous" as const };
      // (a line from the maps brought in when they came curved: straight between its points, as
      // it's mapped, unless it's been changed by hand since)
      if (i.type === "line" && i.straight === undefined && i.importSig && (i.importSource === "osm" || i.importSource === "usgs" || i.importSource === "nwi") && i.importSig === signOfItem(i)) { const st = { ...i, straight: true as const }; i = { ...st, importSig: signOfItem(st) }; }
      // (a line's OB stretches: pairs of numbers, or none; the holes it's OB for: holes on the course)
      if (i.type !== "line" || (i.obStretches === undefined && i.obHoles === undefined)) return i;
      const ok = Array.isArray(i.obStretches) ? mergeStretches(i.obStretches.filter(st => Array.isArray(st) && st.length === 2 && st.every(v => Number.isFinite(v)))) : [];
      const holes = Array.isArray(i.obHoles) ? i.obHoles.filter(id => (raw.holes ?? []).some(h => h.id === id)) : [];
      return { ...i, obStretches: ok.length ? ok : undefined, obHoles: holes.length ? holes : undefined };
    }) : [],
    layouts: raw.layouts?.length ? raw.layouts : base.layouts,
    terrainHeights: raw.terrainHeights ?? {},
    terrainOriginal: raw.terrainOriginal && typeof raw.terrainOriginal === "object" ? raw.terrainOriginal : undefined,
    groundPaint: raw.groundPaint ?? {},
    lidar: raw.lidar && typeof raw.lidar.source === "string" && Array.isArray(raw.lidar.trees) ? unbound(raw.lidar, Array.isArray(raw.items) ? raw.items : []) : undefined,
    ignoredChecks: Array.isArray(raw.ignoredChecks) ? raw.ignoredChecks.filter(x => typeof x === "string") : undefined,
    version: 1
  };
  if (!doc.layouts.some(l => l.id === doc.activeLayout)) doc.activeLayout = doc.layouts[0].id;
  if (doc.lidar) doc.items = doc.items.filter(i => !bareStand(i));
  doc.items = simpleWoods(doc.items);
  // (the Golden trees are gone: Brushed's in their place)
  if ((doc.style.lookParts?.trees?.style as string | undefined) === "golden") doc.style = { ...doc.style, lookParts: { ...doc.style.lookParts, trees: { ...doc.style.lookParts!.trees, style: "brushed" } } };
  return doc;
};

/** Where along a hole its fairway can be made wider or narrower (0 = the tee, 1 = the basket):
 * just off the tee, the two landing zones, and round the basket. */
export const FAIRWAY_STATIONS = [0.15, 0.4, 0.65, 0.88];

/** A hole's fairway width at a point along it (the share of the way from tee to basket), ft:
 * its shape's widths at the stations, blended smoothly in between. */
/** Where along a hole its fairway's width is set (0 = the tee, 1 = the basket). */
export const stationsOf = (hole: Pick<Hole, "fairwayStations">) => (hole.fairwayStations?.length ? hole.fairwayStations : FAIRWAY_STATIONS);

export const fairwayWidthAt = (hole: Pick<Hole, "fairwayWidth" | "fairwayShape" | "fairwayStations">) => (t: number) => hole.fairwayWidth * stationValue(hole.fairwayShape, 1, t, stationsOf(hole));

/** How far a hole's fairway middle is moved off its line at a point along it, ft (toward the
 * left-hand normal of the line). */
export const fairwayShiftAt = (hole: Pick<Hole, "fairwayWidth" | "fairwayShift" | "fairwayStations">) => (t: number) => hole.fairwayWidth * stationValue(hole.fairwayShift, 0, t, stationsOf(hole));

/** Values set at points along the hole (`S`), blended smoothly in between (unset: `none` all along). */
const stationValue = (f: number[] | undefined, none: number, t: number, S: readonly number[]) => {
  if (!f || f.length !== S.length) return none;
  if (t <= S[0]) return f[0];
  if (t >= S[S.length - 1]) return f[f.length - 1];
  let i = 0;
  while (t > S[i + 1]) i++;
  const u = (t - S[i]) / (S[i + 1] - S[i]), e = u * u * (3 - 2 * u);
  return f[i] + (f[i + 1] - f[i]) * e;
};

/** A hole's fairway outline along its (smoothed) line, `extra` ft wider all along. */
/** A hole's fairway with one more width point at `t` (as wide there as it is now): its patch and
 * the new point's index. */
export const withStation = (hole: Hole, t: number) => {
  const S = stationsOf(hole);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const i = S.findIndex(s => s > t), at = i < 0 ? S.length : i;
  const put = <T,>(a: readonly T[], v: T) => [...a.slice(0, at), v, ...a.slice(at)];
  return {
    index: at,
    patch: {
      fairwayStations: put(S, r(t)),
      fairwayShape: put(hole.fairwayShape ?? S.map(() => 1), r(stationValue(hole.fairwayShape, 1, t, S))),
      fairwayShift: put(hole.fairwayShift ?? S.map(() => 0), r(stationValue(hole.fairwayShift, 0, t, S)))
    } satisfies Partial<Hole>
  };
};

/** A hole's fairway without its width point `i` (none left: the same width all along). */
export const withoutStation = (hole: Hole, i: number): Partial<Hole> => {
  const S = stationsOf(hole);
  if (S.length <= 1) return { fairwayStations: undefined, fairwayShape: undefined, fairwayShift: undefined };
  const drop = <T,>(a: readonly T[] | undefined) => a && a.filter((_, k) => k !== i);
  return { fairwayStations: drop(S), fairwayShape: drop(hole.fairwayShape), fairwayShift: drop(hole.fairwayShift) };
};

export const fairwayOutline = (hole: Pick<Hole, "fairwayWidth" | "fairwayShape" | "fairwayShift" | "fairwayStations">, line: P[], extra = 0, roundSteps = 12) => {
  const w = fairwayWidthAt(hole);
  return corridor(line, t => w(t) + extra, roundSteps, hole.fairwayShift ? fairwayShiftAt(hole) : undefined);
};

/** Lines that curve through their points as drawn (every kind, unless set straight). */
export const CURVED_LINES = Object.keys(LINE_KINDS) as LineKind[];
export const curves = (l: Pick<LineItem, "kind" | "straight">) => !l.straight && CURVED_LINES.includes(l.kind);

/** Areas that curve through their corners as drawn (all but parking lots, buildings and fields, unless set straight). */
export const areaCurves = (a: Pick<AreaItem, "kind" | "straight">) => !a.straight && a.kind !== "parking" && a.kind !== "building" && a.kind !== "field";
/** An area's outline as it is drawn: a smooth closed curve through its corners, or the corners. */
export const areaPath = (a: Pick<AreaItem, "kind" | "straight" | "points">) => (areaCurves(a) ? smoothClosed(a.points, a.points.length > 40 ? 2 : 6) : a.points);
/** Areas with their outlines as drawn (for drawing them). */
export const drawnAreas = <T extends CourseItem>(items: T[]): T[] => items.map(i => (i.type === "area" && areaCurves(i) ? ({ ...i, points: areaPath(i) } as T) : i));
/** A line as it is drawn: a smooth curve through its points, or straight between them. */
export const linePath = (l: Pick<LineItem, "kind" | "straight" | "points">, perSegment = 8) => (curves(l) ? smoothPath(l.points, l.points.length > 60 ? 3 : perSegment) : l.points);

/** Where along a line it is out of bounds, as fractions of it as drawn (in order): its stretches,
 * or all of it. */
export const obRanges = (l: { obStretches?: [number, number][] }): [number, number][] =>
  l.obStretches?.length ? l.obStretches.map(([a, b]): [number, number] => [Math.max(0, Math.min(a, b)), Math.min(1, Math.max(a, b))]).sort((x, y) => x[0] - y[0]) : [[0, 1]];
/** Stretches put in order, overlapping ones joined and any next to nothing left out. */
export const mergeStretches = (list: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [a, b] of list.map(([a, b]): [number, number] => [Math.max(0, Math.min(a, b)), Math.min(1, Math.max(a, b))]).sort((x, y) => x[0] - y[0])) {
    if (b - a < 0.002) continue;
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [Math.round(a * 10000) / 10000, Math.round(b * 10000) / 10000]);
};
/**
 * A line with a stretch of it taken out (from `a` to `b`, fractions of it as drawn): the pieces left
 * either side (none under 2 ft), the first keeping its id. Each keeps its own points, a point where
 * it was cut, and its share of the line's OB stretches and creek widths.
 */
export const withoutStretch = (l: LineItem, a: number, b: number, newId = generateId): LineItem[] => {
  const drawn = linePath(l), total = pathLength(drawn);
  const from = Math.max(0, Math.min(a, b)), to = Math.min(1, Math.max(a, b));
  // (where each of its points is along it as drawn, in order)
  const at: number[] = [];
  for (const p of l.points) at.push(Math.max(at[at.length - 1] ?? 0, nearestAlong(drawn, p).t));
  const f = widthFactors(l), varies = widthVaries(l);
  const factorAt = (t: number) => {
    const i = at.findIndex(x => x >= t);
    if (i <= 0) return f[Math.max(0, i)];
    const k = at[i] - at[i - 1] > 1e-9 ? (t - at[i - 1]) / (at[i] - at[i - 1]) : 0;
    return f[i - 1] + (f[i] - f[i - 1]) * k;
  };
  const piece = (s: number, e: number, id: string): LineItem | null => {
    if ((e - s) * total < 2) return null;
    const cut = (t: number) => ({ p: pointAlong(drawn, t * total).point, w: factorAt(t) });
    const inner = l.points.map((p, i) => ({ p, w: f[i], t: at[i] })).filter(o => o.t > s + 1e-4 && o.t < e - 1e-4);
    const pts = [s <= 0 ? { p: l.points[0], w: f[0] } : cut(s), ...inner, e >= 1 ? { p: l.points[l.points.length - 1], w: f[f.length - 1] } : cut(e)];
    const c = { x: pts.reduce((t, o) => t + o.p.x, 0) / pts.length, y: pts.reduce((t, o) => t + o.p.y, 0) / pts.length };
    // (its OB stretches, as shares of this piece; along none of them: not OB)
    const ob = l.ob === true && l.obStretches?.length ? mergeStretches(l.obStretches.map(([x, y]): [number, number] => [(Math.max(s, Math.min(x, y)) - s) / (e - s), (Math.min(e, Math.max(x, y)) - s) / (e - s)]).filter(([x, y]) => y > x)) : null;
    const notOb = ob !== null && !ob.length;
    return {
      ...l, id, points: pts.map(o => o.p), x: c.x, y: c.y,
      widths: varies ? pts.map(o => o.w) : undefined,
      ...(ob ? (notOb ? { ob: undefined, obBeyond: undefined, obHoles: undefined, obStretches: undefined } : { obStretches: ob }) : {})
    };
  };
  return [piece(0, from, l.id), piece(to, 1, newId())].filter((x): x is LineItem => !!x);
};
/** Whether a path comes back to where it starts (an area's edge, a line drawn round in a ring). */
export const isRing = (pts: P[]) => pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 3;
/**
 * A stretch round a ring from `from` to `to` (fractions round it), the way it was gone round:
 * `dir` 1 forward (as drawn), -1 back; 0: the shorter way. Crossing where the ring starts, it is
 * two stretches.
 */
export const ringStretch = (from: number, to: number, dir: number): [number, number][] => {
  let d = dir;
  if (!d) { const fwd = (((to - from) % 1) + 1) % 1; d = fwd <= 0.5 ? 1 : -1; }
  const [a, b] = d > 0 ? [from, to] : [to, from];
  return a <= b ? [[a, b]] : [[a, 1], [0, b]];
};
/** An area's edge as drawn, closed (back to where it starts): what its OB stretches run round. */
export const areaRing = (a: Pick<AreaItem, "kind" | "straight" | "points">) => { const p = areaPath(a); return p.length ? [...p, p[0]] : p; };
/** An area's red OB edge as drawn: all the way round, or each of its stretches. */
export const areaObEdges = (a: Pick<AreaItem, "kind" | "straight" | "points" | "obStretches">): P[][] => {
  const ring = areaRing(a);
  return obRanges(a).map(([x, y]) => subPath(ring, x, y)).filter(p => p.length >= 2 && pathLength(p) > 0.5);
};
/** A line's out-of-bounds pieces as drawn: all of it, or each of its stretches. */
export const obPieces = (l: Pick<LineItem, "kind" | "straight" | "points" | "obStretches">): P[][] => {
  const drawn = linePath(l);
  return obRanges(l).map(([a, b]) => subPath(drawn, a, b)).filter(p => p.length >= 2 && pathLength(p) > 0.5);
};
/** How closely a hole's line runs along a piece of line, on each side of it (1: right of the way it
 * runs, -1: left): each bit of the hole within `reach` ft counts the closer it is, so a hole
 * running along it outweighs one that only comes near at its tee. */
const closeness = (piece: P[], line: P[], reach: number) => {
  const weight = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  for (let k = 0; k <= Math.floor(pathLength(line) / 20); k++) {
    const q = pointAlong(line, k * 20).point;
    let best = { d: Infinity, side: 1 as 1 | -1 };
    for (let i = 1; i < piece.length; i++) {
      const a = piece[i - 1], b = piece[i], n = nearestOnSegment(q, a, b);
      if (n.distance < best.d) best = { d: n.distance, side: (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) >= 0 ? 1 : -1 };
    }
    if (best.d <= reach) weight[best.side] += (1 - best.d / reach) ** 2;
  }
  return weight;
};
/** Which side of a piece of line the holes are on (1: right of the way it runs, -1: left), within
 * `reach` ft (none near: both): each hole's side, or (`one`) only the side of the holes running
 * closest along it. Where it's OB "and beyond", OB starts at its edge there. */
export const obSides = (piece: P[], holeLines: P[][], reach = 300, one = false): (1 | -1)[] => {
  const sides = new Set<1 | -1>(), total = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  for (const line of holeLines) {
    const w = closeness(piece, line, reach);
    if (w[1] + w[-1] > 0) sides.add(w[1] >= w[-1] ? 1 : -1);
    total[1] += w[1];
    total[-1] += w[-1];
  }
  if (!sides.size) return [1, -1];
  return one ? [total[1] >= total[-1] ? 1 : -1] : [...sides];
};
/** OB and beyond: the side the holes are on (OB starts at the edge there and runs away from them),
 * as chosen, or the app's guess. */
export const beyondSides = (l: Pick<LineItem, "obToward">, piece: P[], holeLines: P[][], one = false): (1 | -1)[] =>
  l.obToward ? [l.obToward === 1 ? -1 : 1] : obSides(piece, holeLines, 300, one);
/** Which way a side of a line faces, roughly, by the compass (1: right of the way it was drawn). */
export const sideCompass = (pts: P[], side: 1 | -1) => {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  // (right of the way it runs, with y down the plan: turned +90°; north is up)
  const rx = -dy * side, ry = dx * side;
  return Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? "east" : "west") : ry > 0 ? "south" : "north";
};
/** The hole running closest along a piece of line, if any is within `reach` ft. */
export const closestHole = (piece: P[], holes: { id: string; line: P[] }[], reach = 300) => {
  let best: { id: string; w: number } | null = null;
  for (const h of holes) {
    const w = closeness(piece, h.line, reach), t = w[1] + w[-1];
    if (t > 0 && (!best || t > best.w)) best = { id: h.id, w: t };
  }
  return best?.id ?? null;
};
/** The holes picked for a line marked OB that are still on the course. */
export const obPicked = (doc: Pick<CourseDoc, "holes">, l: Pick<LineItem, "obHoles">) => l.obHoles?.filter(id => doc.holes.some(h => h.id === id)) ?? [];
/** Whether a line marked OB is OB for a hole: one of the holes picked for it, or (none picked) any
 * hole it belongs to. */
export const obFor = (doc: Pick<CourseDoc, "holes">, l: LineItem, holeId: string) => {
  const picked = obPicked(doc, l);
  return picked.length ? picked.includes(holeId) : !l.holeId || belongsTo(l, holeId);
};

/** A line's width, ft: its own, or its kind's. */
export const lineWidth = (l: Pick<LineItem, "kind" | "width">) => l.width ?? LINE_KINDS[l.kind].width;
/** A line's own factor at each of its points (1 where it is its usual width). Only creeks keep
 * them (a line made another kind keeps its factors for when it is a creek again). */
export const widthFactors = (l: Pick<LineItem, "kind" | "widths" | "points">) => l.points.map((_, i) => (l.kind === "stream" && l.widths && l.widths.length === l.points.length ? l.widths[i] : 1));
/** Whether a line is wider or narrower somewhere along it (a creek that opens out). */
export const widthVaries = (l: Pick<LineItem, "kind" | "widths" | "points">) => widthFactors(l).some(f => Math.abs(f - 1) > 1e-3);
/**
 * How wide a line is along its length (`t`: 0 at its start, 1 at its end), ft: its width times its
 * factor at each point, easing from one point to the next.
 */
export const widthAlong = (l: Pick<LineItem, "kind" | "width" | "widths" | "points">, base = lineWidth(l)): ((t: number) => number) => {
  if (!widthVaries(l)) return () => base;
  const f = widthFactors(l);
  const along = [0];
  for (let i = 1; i < l.points.length; i++) along.push(along[i - 1] + dist(l.points[i - 1], l.points[i]));
  const total = along[along.length - 1] || 1;
  return t => {
    const d = Math.max(0, Math.min(1, t)) * total;
    let i = 1;
    while (i < along.length - 1 && along[i] < d) i++;
    const a = along[i - 1], b = along[i];
    const u = b > a ? Math.max(0, Math.min(1, (d - a) / (b - a))) : 0;
    const e = u * u * (3 - 2 * u);
    return base * (f[i - 1] + (f[i] - f[i - 1]) * e);
  };
};
/** A line's factors kept in step with its points as one is put in after `index` (its factor
 * between its neighbours'), added at an end or taken out: whatever kind it is now, so a creek made
 * a path for a while is the same creek again. */
const storedWidths = (l: Pick<LineItem, "widths" | "points">) => (l.widths && l.widths.length === l.points.length && l.widths.some(v => Math.abs(v - 1) > 1e-3) ? l.widths : null);
export const widthsWithPoint = (l: Pick<LineItem, "kind" | "widths" | "points">, index: number): number[] | undefined => {
  const f = storedWidths(l);
  if (!f) return undefined;
  const next = f[Math.min(f.length - 1, index + 1)];
  return [...f.slice(0, index + 1), index + 1 < f.length ? (f[index] + next) / 2 : f[index], ...f.slice(index + 1)];
};
export const widthsWithEnd = (l: Pick<LineItem, "kind" | "widths" | "points">, end: 0 | 1): number[] | undefined => {
  const f = storedWidths(l);
  if (!f) return undefined;
  return end ? [...f, f[f.length - 1]] : [f[0], ...f];
};
export const widthsWithout = (l: Pick<LineItem, "kind" | "widths" | "points">, index: number): number[] | undefined => {
  const f = storedWidths(l)?.filter((_, k) => k !== index);
  return f?.some(v => Math.abs(v - 1) > 1e-3) ? f : undefined;
};

export const newHole = (over: Partial<Hole> = {}): Hole => ({ id: `hole-${generateId()}`, doglegs: [], fairwayWidth: DEFAULT_FAIRWAY_FT, fairway: true, ...over });

export const createTee = (holeId: string, at: P, level: TeeLevel = "blue"): TeeItem => ({
  id: generateId(), type: "tee", holeId, level, x: at.x, y: at.y, rotation: 0,
  padWidth: DEFAULT_PAD.width, padLength: DEFAULT_PAD.length, surface: "concrete"
});

export const createBasket = (holeId: string, at: P, position: PinPosition = "A"): BasketItem => ({
  id: generateId(), type: "basket", holeId, position, x: at.x, y: at.y, rotation: 0
});

export const createMando = (at: P, holeId?: string, rotation = 0): MandoItem => ({ id: generateId(), type: "mando", holeId, side: "right", x: at.x, y: at.y, rotation });
export const createDropZone = (at: P, holeId?: string): DropZoneItem => ({ id: generateId(), type: "dropzone", holeId, x: at.x, y: at.y, rotation: 0 });
export const createTree = (at: P, over: Partial<TreeItem> = {}): TreeItem => ({
  id: generateId(), type: "tree", x: at.x, y: at.y, rotation: 0, radius: 14, height: 40, treeType: "deciduous", color: TREE_COLORS[0], ...over
});
export const createAmenity = (at: P, kind: AmenityKind): AmenityItem => ({ id: generateId(), type: "amenity", kind, x: at.x, y: at.y, rotation: 0 });
export const createLabel = (at: P, text = "Label"): LabelItem => ({ id: generateId(), type: "label", text, fontSize: 14, color: "#ffffff", x: at.x, y: at.y, rotation: 0 });
export const createArea = (kind: AreaKind, points: P[], holeId?: string): AreaItem => {
  const c = centroid(points);
  return { id: generateId(), type: "area", kind, points, holeId, x: c.x, y: c.y, rotation: 0 };
};
export const createLine = (kind: LineKind, points: P[], holeId?: string): LineItem => {
  const c = points.length ? { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length } : { x: 0, y: 0 };
  return { id: generateId(), type: "line", kind, points, holeId, x: c.x, y: c.y, rotation: 0 };
};
/** A bridge, boardwalk, stairs or wall along `points`, or a building, shelter or deck with that outline. */
export const createStructure = (kind: StructureKind, points: P[], holeId?: string): StructureItem => {
  const c = STRUCTURE_KINDS[kind].shape === "outline" ? centroid(points) : points.length ? { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length } : { x: 0, y: 0 };
  return { id: generateId(), type: "structure", kind, points, holeId, x: c.x, y: c.y, rotation: 0 };
};

// --- Finding a hole's parts ---

export const holeTees = (doc: Pick<CourseDoc, "items">, holeId: string) =>
  (doc.items.filter(i => i.type === "tee" && i.holeId === holeId) as TeeItem[]).sort((a, b) => TEE_ORDER.indexOf(a.level) - TEE_ORDER.indexOf(b.level));

export const holeBaskets = (doc: Pick<CourseDoc, "items">, holeId: string) =>
  (doc.items.filter(i => i.type === "basket" && (i.holeId === holeId || i.alsoHoles?.includes(holeId))) as BasketItem[]).sort((a, b) => PIN_POSITIONS.indexOf(a.position) - PIN_POSITIONS.indexOf(b.position));

/** The tee a layout plays: its color, else the nearest color to it, else the first. */
export const teeFor = (doc: Pick<CourseDoc, "items">, holeId: string, level?: TeeLevel): TeeItem | null => {
  const tees = holeTees(doc, holeId);
  if (!tees.length) return null;
  if (!level) return tees[0];
  const want = TEE_ORDER.indexOf(level);
  return [...tees].sort((a, b) => Math.abs(TEE_ORDER.indexOf(a.level) - want) - Math.abs(TEE_ORDER.indexOf(b.level) - want) || TEE_ORDER.indexOf(a.level) - TEE_ORDER.indexOf(b.level))[0];
};

export const basketFor = (doc: Pick<CourseDoc, "items">, holeId: string, pin?: PinPosition): BasketItem | null => {
  const baskets = holeBaskets(doc, holeId);
  return baskets.find(b => b.position === pin) ?? baskets[0] ?? null;
};

export const activeLayout = (doc: Pick<CourseDoc, "layouts" | "activeLayout">) => doc.layouts.find(l => l.id === doc.activeLayout) ?? doc.layouts[0];

/** The throw line of a hole: tee, its doglegs, basket. */
export const throwLine = (hole: Hole, tee: P | null, basket: P | null): P[] => {
  const pts: P[] = [];
  if (tee) pts.push({ x: tee.x, y: tee.y });
  pts.push(...hole.doglegs.map(p => ({ ...p })));
  if (basket) pts.push({ x: basket.x, y: basket.y });
  return pts;
};

/**
 * A hole's lines of play from each of its tees (the hole's own first) to its basket, through the
 * turns still ahead of each tee: every tee has a fairway of its own (where they meet, they make
 * one). `line` is the hole's main line, tee to basket.
 */
export const teeLines = (doc: Pick<CourseDoc, "items">, hole: Hole, line: P[], mainTeeId?: string | null): P[][] => {
  if (line.length < 2) return [];
  const basket = line[line.length - 1];
  const out: P[][] = [line];
  for (const tee of holeTees(doc, hole.id)) {
    if (tee.id === mainTeeId || dist(tee, line[0]) < 1) continue;
    // (turns the tee is already past are left out: a short tee ahead of the first turn)
    let turns = hole.doglegs;
    while (turns.length && dist(tee, turns[1] ?? basket) < dist(turns[0], turns[1] ?? basket)) turns = turns.slice(1);
    out.push([{ x: tee.x, y: tee.y }, ...turns.map(p => ({ ...p })), { ...basket }]);
  }
  return out;
};

/** The main throw line (the layout's tee and pin). */
export const holeLine = (doc: Pick<CourseDoc, "items" | "layouts" | "activeLayout">, hole: Hole, layout = activeLayout(doc)) =>
  throwLine(hole, teeFor(doc, hole.id, layout?.tee), basketFor(doc, hole.id, layout?.pin));

/** Which hole an item belongs to (tees, baskets, mandos and drop zones; areas and lines can too). */
/** Whether a thing belongs to a hole (its own, or one of the others it is shared with). */
export const belongsTo = (item: CourseItem, holeId: string) =>
  "holeId" in item && (item.holeId === holeId || (("alsoHoles" in item && item.alsoHoles) || []).includes(holeId));

export const itemHoleId = (item: CourseItem | null | undefined): string | undefined =>
  item && "holeId" in item ? item.holeId : undefined;

/** Hole numbers: their place in the order of play. */
/** Each hole's number: its own (typed in), or else the first number free, in course order. */
const numbered = new WeakMap<Hole[], Map<string, number>>();
export const holeNumbers = (holes: Hole[]) => {
  let m = numbered.get(holes);
  // (still the same holes: a list changed in place is numbered again)
  if (m && m.size === holes.length && holes.every(h => m!.has(h.id))) return m;
  m = new Map();
  const taken = new Set(holes.flatMap(h => [h.number, ...(h.alsoNumbers ?? [])]).filter((v): v is number => !!v));
  let next = 1;
  for (const h of holes) {
    if (h.number) m.set(h.id, h.number);
    else {
      while (taken.has(next)) next++;
      m.set(h.id, next);
      taken.add(next);
    }
  }
  numbered.set(holes, m);
  return m;
};
export const holeNumber = (doc: Pick<CourseDoc, "holes">, holeId: string) => holeNumbers(doc.holes).get(holeId) ?? 0;

/** A hole's numbers as shown: its own, and any more it is played as ("3/12"). */
export const holeLabel = (doc: Pick<CourseDoc, "holes">, holeId: string) => {
  const also = doc.holes.find(h => h.id === holeId)?.alsoNumbers;
  const n = holeNumber(doc, holeId);
  return also?.length ? [n, ...also].join("/") : String(n);
};

/** The numbers typed for a hole ("3/12", "3, 12", "3 & 12"): its own first, then the others. */
export const parseHoleNumbers = (text: string) => [...new Set((text.match(/\d+/g) ?? []).map(Number).filter(v => v >= 1 && v <= 999))];

/** Holes in the order of their numbers (the order they're played). */
export const byNumber = (holes: Hole[]) => {
  const m = holeNumbers(holes);
  return [...holes].sort((a, b) => (m.get(a.id) ?? 0) - (m.get(b.id) ?? 0));
};

/** Holes with a new one put in at `at`; once holes have numbers of their own, the new one takes
 * the first number free (no other hole's number changes) and goes where that number is played. */
export const insertHole = (holes: Hole[], hole: Hole, at = holes.length): Hole[] => {
  const fresh = { ...hole, number: undefined, alsoNumbers: undefined };
  if (!holes.some(h => h.number)) {
    const out = [...holes];
    out.splice(Math.max(0, Math.min(out.length, at)), 0, fresh);
    return out;
  }
  const taken = new Set([...holeNumbers(holes).values(), ...holes.flatMap(h => h.alsoNumbers ?? [])]);
  let n = 1;
  while (taken.has(n)) n++;
  return byNumber([...holes, { ...fresh, number: n }]);
};

/** The direction (degrees, 0 = +x) a tee pad faces: toward the first point of its throw line. */
export const teeAim = (doc: Pick<CourseDoc, "items" | "holes">, tee: TeeItem) => {
  if (tee.aimFixed) return tee.rotation;
  const hole = doc.holes.find(h => h.id === tee.holeId);
  if (!hole) return tee.rotation;
  const next = hole.doglegs[0] ?? basketFor(doc, hole.id);
  if (!next) return tee.rotation;
  return (Math.atan2(next.y - tee.y, next.x - tee.x) * 180) / Math.PI;
};

export const ITEM_LABELS: Record<CourseItem["type"], string> = {
  tee: "Tee",
  basket: "Basket",
  mando: "Mando",
  dropzone: "Drop zone",
  tree: "Tree",
  amenity: "Amenity",
  label: "Label",
  area: "Area",
  line: "Line",
  structure: "Structure"
};

/**
 * The walks from each basket to the next tee the map draws by itself: one for each pair of holes
 * in a row, except where a walk line has been drawn from near the one hole's basket to near the
 * next hole's tee (either way round), which takes its place.
 */
export const autoWalks = <S extends { holeId: string; complete: boolean; line: P[] }>(items: CourseItem[], stats: S[], holes: Pick<Hole, "id" | "walkOut" | "walkIn" | "walkOff">[] = []) => {
  const drawn = items.filter((i): i is LineItem => i.type === "line" && i.kind === "walk" && i.points.length >= 2);
  const out: { from: P; to: P; basket: P; tee: P; a: S; b: S }[] = [];
  for (let i = 0; i + 1 < stats.length; i++) {
    const a = stats[i], b = stats[i + 1];
    if (!a.complete || !b.complete || holes.find(h => h.id === a.holeId)?.walkOff) continue;
    const basket = a.line[a.line.length - 1], tee = b.line[0];
    const reach = Math.max(60, dist(basket, tee) * 0.3);
    const near = (p: P, q: P) => dist(p, q) < reach;
    const replaced = drawn.some(w => {
      const p = w.points[0], q = w.points[w.points.length - 1];
      return (near(p, basket) && near(q, tee)) || (near(q, basket) && near(p, tee));
    });
    if (replaced) continue;
    const { from, to } = walkEnds(a.line, b.line, holes.find(h => h.id === a.holeId)?.walkOut, holes.find(h => h.id === b.holeId)?.walkIn);
    out.push({ from, to, basket, tee, a, b });
  }
  return out;
};

/**
 * The walks on to the next tee, drawn ones and the map's own, each with the holes it goes between
 * (its points from the basket's end).
 */
export const walkRoutes = <S extends { holeId: string; complete: boolean; line: P[] }>(items: CourseItem[], stats: S[], holes: Pick<Hole, "id" | "walkOut" | "walkIn" | "walkOff">[] = []) => {
  const drawn = items.filter((i): i is LineItem => i.type === "line" && i.kind === "walk" && i.points.length >= 2);
  const out: { points: P[]; a: S; b: S; lineId?: string }[] = [];
  for (let i = 0; i + 1 < stats.length; i++) {
    const a = stats[i], b = stats[i + 1];
    if (!a.complete || !b.complete || holes.find(h => h.id === a.holeId)?.walkOff) continue;
    const basket = a.line[a.line.length - 1], tee = b.line[0];
    const reach = Math.max(60, dist(basket, tee) * 0.3);
    const near = (p: P, q: P) => dist(p, q) < reach;
    const w = drawn.find(x => {
      const p = x.points[0], q = x.points[x.points.length - 1];
      return (near(p, basket) && near(q, tee)) || (near(q, basket) && near(p, tee));
    });
    if (w) {
      out.push({ points: near(w.points[0], basket) ? w.points : [...w.points].reverse(), a, b, lineId: w.id });
      continue;
    }
    const { from, to } = walkEnds(a.line, b.line, holes.find(h => h.id === a.holeId)?.walkOut, holes.find(h => h.id === b.holeId)?.walkIn);
    out.push({ points: [from, to], a, b });
  }
  return out;
};

/** The walks that leave the same basket as another (holes that share it): each is labelled with
 * the hole it goes to. */
export const sharedWalks = <R extends { a: { line: P[] } }>(routes: R[]) =>
  routes.filter(r => routes.some(o => o !== r && dist(o.a.line[o.a.line.length - 1], r.a.line[r.a.line.length - 1]) < 3));

/** How far from the basket the walk to the next tee starts: just outside the putting circle. */
export const WALK_OUT_FT = CIRCLE_ONE_FT + 6;

/**
 * Where the walk from one hole to the next starts and ends. It leaves the basket from outside the
 * putting circle (10 m), toward the next tee but never back across the fairway the hole was
 * played down (at least 70 degrees off it), and arrives behind the next tee, out of the way of
 * whoever is throwing. `out` (ft from the basket) and `in` (ft from the tee) are where they were
 * moved by hand.
 */
export const walkEnds = (holeLine: P[], nextLine: P[], out?: P, inn?: P) => {
  const basket = holeLine[holeLine.length - 1], back = holeLine[holeLine.length - 2] ?? basket;
  const tee = nextLine[0], ahead = nextLine[1] ?? tee;
  let from: P;
  if (out) from = { x: basket.x + out.x, y: basket.y + out.y };
  else {
    const toTee = Math.atan2(tee.y - basket.y, tee.x - basket.x);
    const fairway = Math.atan2(back.y - basket.y, back.x - basket.x);
    let off = Math.atan2(Math.sin(toTee - fairway), Math.cos(toTee - fairway));
    const MIN = (70 * Math.PI) / 180;
    if (Math.abs(off) < MIN) off = (off < 0 ? -1 : 1) * MIN;
    const dir = dist(basket, back) > 1 ? fairway + off : toTee;
    from = { x: basket.x + Math.cos(dir) * WALK_OUT_FT, y: basket.y + Math.sin(dir) * WALK_OUT_FT };
  }
  let to: P;
  if (inn) to = { x: tee.x + inn.x, y: tee.y + inn.y };
  else {
    const d = dist(tee, ahead) || 1;
    to = { x: tee.x - ((ahead.x - tee.x) / d) * 18, y: tee.y - ((ahead.y - tee.y) / d) * 18 };
  }
  return { from, to };
};

/** Every hole a basket is played to: its own, then the ones sharing it. */
export const basketHoles = (b: Pick<BasketItem, "holeId" | "alsoHoles">) => [b.holeId, ...(b.alsoHoles ?? [])];

/** Holes whose every tee and basket is among `ids` (they go with those things: moved, copied, deleted). */
export const wholeHoles = (doc: Pick<CourseDoc, "items" | "holes">, ids: Set<string>) =>
  doc.holes.filter(h => {
    const parts = [...holeTees(doc, h.id), ...holeBaskets(doc, h.id)];
    return parts.length > 0 && parts.every(p => ids.has(p.id));
  });

/** The things `ids` moved by (dx, dy) from where they are in `doc` (locked ones stay), with the
 * bends of the holes that go along with them. */
export const movedGroup = (doc: Pick<CourseDoc, "items" | "holes">, ids: string[], dx: number, dy: number): Pick<CourseDoc, "items" | "holes"> => {
  const set = new Set(ids);
  const shift = (p: P) => ({ x: p.x + dx, y: p.y + dy });
  const whole = new Set(wholeHoles(doc, set).filter(h => [...holeTees(doc, h.id), ...holeBaskets(doc, h.id)].every(p => !p.locked)).map(h => h.id));
  return {
    items: doc.items.map(i => {
      if (!set.has(i.id) || i.locked) return i;
      const moved = { ...i, x: i.x + dx, y: i.y + dy } as CourseItem;
      if (moved.type === "area" || moved.type === "line" || moved.type === "structure") moved.points = moved.points.map(shift);
      return moved;
    }),
    holes: doc.holes.map(h => (whole.has(h.id) ? { ...h, doglegs: h.doglegs.map(shift) } : h))
  };
};
