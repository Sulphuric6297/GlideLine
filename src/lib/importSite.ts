// Bringing in a real site: the satellite photo, the ground's elevation, the trees measured from the
// air, the trees on the photo and what OpenStreetMap knows (paths, roads, water, parking,
// buildings, benches and the rest, a disc golf course mapped there). Every download starts at once
// and each is put together as it lands; one that fails leaves the rest (no photo: the street map
// or plain ground; no elevation: flat ground), and each says how it went (`onProgress`) and hands
// over what it brought as it lands (`onLayer`). Stop (`signal`) stops them all. What came is kept
// for the session (lib/geo/cache), so the same spot comes in again at once. Each thing brought in
// keeps what it was like when it came (`importSig`), so one changed by hand is never replaced. What
// went wrong is kept with the site, for the Site step to say. Everything comes from free services
// with no keys, as in the Security Camera Planner.
import { PIN_POSITIONS, STRUCTURE_KINDS, LINE_KINDS, TEE_ORDER, clamp, generateId } from "../constants";
import type { AmenityItem, AreaItem, CourseDoc, CourseItem, Hole, LidarTree, LineItem, P, ParkDetail, PinPosition, RoofKind, SiteInfo, StructureItem, TeeLevel, TreeItem } from "../types";
import { FEET_PER_METER, getGeoBounds, throwIfAborted, untilAborted, type GeoBounds, type SiteSelection } from "./geo/core";
import { boundsKey, cached } from "./geo/cache";
import { fetchBestElevationGrid, usgsGroundLabel } from "./geo/elevation";
import { fetchLidar } from "./geo/lidarFetch";
import { findBushes, groundOnGrid, standingTrees, surveyYear, type LidarBush } from "./lidar";
import { summerFills, treesFromSummer } from "./summerTrees";
import { fetchMapImagery, type MapImagerySource } from "./geo/imagery";
import { natureFromPhoto } from "./geo/photoNature";
import { holeHints, mappedCourse, parkWords, type LatLon, type MappedCourse, type MappedSpot, type OsmBuilding, type OsmFeature } from "./geo/osm";
import { fetchOsm } from "./geo/osmFetch";
import { withoutSlabs, tracedBuildings, withMeasuredHeights, type TracedBuilding } from "./geo/buildings";
import { createAmenity, createArea, createBasket, createLine, createStructure, createTee, createTree, newHole } from "./course";
import { courtCount, createField, fieldKindOf, fieldWord } from "./fields";
import { fieldOf } from "./geo/parkKinds";
import { centroid, clipPathToRect, clipPolygonToRect, nearestOnSegment, pointInPolygon, polygonArea, simplify } from "./geom";
import { fetchStructures, fetchWater, fetchWetlands, inUS } from "./geo/usgov";
import { courtsFromPhoto } from "./geo/courtsFound";
import { fittedToPhoto } from "./geo/photoFit";
import type { PhotoSourceId } from "./geo/photoSources";
import { reframe, toPlanXY, type GeoRef } from "./geoRef";
import { boxOutline, orientedBox, roofOf } from "./structures";
import { treeFree } from "./treeFree";
import { underbrushChance, type Underbrush } from "./undergrowth";
import { seasonsFromSpace } from "./geo/sentinel";

export type ImportedSite = {
  canvas: { width: number; height: number };
  gridSize: number;
  terrainHeights: Record<string, number>;
  background: string | null;
  site: SiteInfo;
  trees: TreeItem[];
  mapped: CourseItem[];
  notes: string[];
  /** OpenStreetMap was asked for and couldn't be reached (the import offers to try again). */
  osmFailed?: boolean;
  /** The trees measured from the air (where a LiDAR survey covers the site). */
  lidar?: CourseDoc["lidar"];
  /** How many of the measured trees stand (none on a road or a building). */
  standing?: number;
  /** A disc golf course mapped on OpenStreetMap there: its holes, tees and baskets on the plan
   * (brought in only when asked for; `holes` can be empty when only its outline is mapped). */
  course?: { name?: string; holes: Hole[]; items: CourseItem[] };
  /** How each source went, as at the end. */
  sources: ImportProgress["sources"];
  /** What was left out but could be brought in instead (looking before it comes in): the photo's
   * water where the government's maps of water came, and all of FEMA's buildings (those
   * OpenStreetMap has too among them). */
  alternates?: { photoWater: CourseItem[]; fema: CourseItem[] };
  /** Where brush grows (the chance in each block; the areas made as the import asks). */
  underbrush?: Underbrush;
};

/** The sources a site comes from, each with its own progress. */
export type SourceId = "photo" | "elevation" | "lidar" | "osm" | "buildings" | "photoTrees" | "gov" | "seasons";
/** Not started, under way, in, not to be had at this spot (no survey covers it, say), or failed. */
export type SourceState = "waiting" | "coming" | "done" | "not-here" | "failed";
export type SourceStatus = {
  state: SourceState;
  /** How far along (0..1), where it's known or can be judged. */
  fraction?: number;
  /** How many things it brought (trees, shapes, buildings; unset for the photo and the ground). */
  count?: number;
  /** Where it came from ("Esri satellite", "USGS 3DEP (high detail)", "USGS LiDAR 2022",
   * "Overpass" or "OpenFreeMap map tiles"), and its year where known. */
  source?: string;
  year?: number;
  /** How long it took, ms (from the import's start). */
  ms?: number;
  /** Kept from an earlier download of the same spot. */
  cached?: boolean;
  /** OpenStreetMap: a server was busy and the others are still being asked. */
  busy?: boolean;
  /** Photo trees: left out, as trees measured from the air cover the site (only its water is looked for). */
  skipped?: "measured";
  /** OpenStreetMap: the park's things it found, by what they are ({ "ball fields": 4, "playground": 1 }),
   * and the same in a line ("4 ball fields, 2 tennis courts, 1 playground"). */
  parts?: Record<string, number>;
  detail?: string;
  /** What went wrong, for the console and the Site step (not shown as is). */
  error?: string;
};
export type ImportProgress = {
  /** Only the sources asked for. */
  sources: Partial<Record<SourceId, SourceStatus>>;
  /** All of it together (0..1). */
  fraction: number;
  /** What it's doing, in a line. */
  text: string;
};
/** What a source brought, handed over the moment it lands so the map can fill in layer by layer
 * (the import's result is what's kept: OpenStreetMap's and the photo's things are sorted out
 * against each other there). */
export type ImportLayer =
  | { source: "frame"; canvas: { width: number; height: number }; gridSize: number; bounds: GeoBounds }
  | { source: "photo"; background: string; label: string }
  | { source: "elevation"; terrainHeights: Record<string, number>; baseElevationFt: number; label: string }
  | { source: "lidar"; trees: LidarTree[]; terrainHeights: Record<string, number>; baseElevationFt: number; label: string }
  | { source: "osm"; items: CourseItem[] }
  | { source: "buildings"; items: CourseItem[] }
  | { source: "photoTrees"; trees: TreeItem[]; areas: AreaItem[] };

export type ImportOptions = {
  imagery: MapImagerySource | "none";
  trees: boolean;
  /** An aerial survey covers the site: the photo is looked over for water only, never for trees
   * (the survey's trees are the ones to use, even when they're left out this time). */
  surveyed?: boolean;
  osm: boolean;
  /** Trees and ground measured from the air (LiDAR), where a survey covers the site. */
  lidar?: boolean;
  /** With a survey flown bare: the trees it missed filled in from the summer photo (unset: yes). */
  summerFill?: boolean;
  /** The US government's maps: creeks and ponds (USGS), wetlands (USFWS), buildings (FEMA). */
  gov?: boolean;
  /** The photo to use, by its source (unset: the best one there). */
  photo?: PhotoSourceId;
  /** How each source is going, and all of it together. */
  onProgress?: (p: ImportProgress) => void;
  /** What each source brought, as it lands. */
  onLayer?: (layer: ImportLayer) => void;
  /** Waited for once every source is in, before they're sorted out against each other (the one
   * long piece of work on the page's own thread): whoever is drawing meanwhile says when. */
  beforeSort?: () => Promise<void>;
  /** Stops it: every download, at once (the import then rejects with an AbortError). */
  signal?: AbortSignal;
  /** (older callers) What it is doing, and how far along all of it is (`fraction`). */
  onStatus?: (text: string, progress?: { step: number; of: number; fraction?: number }) => void;
};

/** A moment for the page to draw between two long pieces of work (stopped: throws as the import does). */
const breath = (signal?: AbortSignal) => new Promise<void>((ok, no) => setTimeout(() => (signal?.aborted ? no(new DOMException("Aborted", "AbortError")) : ok()), 24));

/** Terrain grid spacing for a site this wide: about 160 cells across, 4 to 20 ft. */
export const gridFor = (widthFt: number) => clamp(Math.round(widthFt / 160), 4, 20);

/** Turns an elevation sample grid (meters, row 0 north) into terrain heights at the plan's grid points (ft above the lowest point). */
export const heightsFromSamples = (values: Float32Array, samplesX: number, samplesY: number, min: number, width: number, height: number, grid: number) => {
  const heights: Record<string, number> = {};
  const at = (sx: number, sy: number) => values[clamp(sy, 0, samplesY - 1) * samplesX + clamp(sx, 0, samplesX - 1)];
  for (let x = 0; x <= width + 1e-6; x += grid) {
    for (let y = 0; y <= height + 1e-6; y += grid) {
      const fx = (x / width) * (samplesX - 1), fy = (y / height) * (samplesY - 1);
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const v = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      const ft = (v - min) * FEET_PER_METER;
      if (Math.abs(ft) > 0.001) heights[`${Math.round(x)},${Math.round(y)}`] = Math.round(ft * 100) / 100;
    }
  }
  return heights;
};

/** What the photo shows: stands of trees (as woods areas), the trees standing on their own (as
 * trees) and open water (as water areas), found in a worker (geo/photoNature.ts). */
export { natureFromPhoto };

/** What a thing brought in is like (all of it but its id and this), as a short code: kept with it
 * when it comes in, so one changed since (a road made OB, a building renamed) can be told apart. */
export const signOf = (i: CourseItem) => {
  const { id: _id, importSig: _sig, ...rest } = i;
  // (keys in order, unset ones left out: the same thing gives the same code however it was built)
  const text = JSON.stringify(rest, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v));
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
  return (h >>> 0).toString(36);
};
/** A thing as it comes in: what it's like kept with it. */
export const signed = <T extends CourseItem>(i: T): T => ({ ...i, importSig: signOf(i) });
/** Whether a thing brought in is as it came (one from before these codes counts as it came). */
export const asItCame = (i: CourseItem) => !i.importSig || i.importSig === signOf(i);

/** Whether a thing came from the maps (OpenStreetMap, or a building traced from the air) and is
 * as it came: the ones a new lookup replaces. */
export const fromMaps = (i: CourseItem) =>
  (((i.type === "area" || i.type === "line" || i.type === "structure") && (i.importSource === "osm" || i.importSource === "traced")) || ((i.type === "amenity" || i.type === "tree") && i.importSource === "osm")) && asItCame(i);

/** Whether a thing was brought in by an import (found on the photo, from OpenStreetMap, made from
 * the measured trees) and is as it came: changed since, it's yours, and stays. */
export const isImported = (i: CourseItem) => (i.type === "tree" || i.type === "area" || i.type === "line" || i.type === "structure" || i.type === "amenity") && !!i.importSource && asItCame(i);

/** What came in, less what's here already as it was changed by hand (the same thing brought in
 * again would stand beside it). */
export const freshOnly = (kept: CourseItem[], incoming: CourseItem[]) => {
  const had = new Set(kept.filter(i => i.importSig && !asItCame(i)).map(i => i.importSig));
  return had.size ? incoming.filter(i => !i.importSig || !had.has(i.importSig)) : incoming;
};

/** What the US government's maps add to OpenStreetMap's (`mapped`): a creek it hasn't drawn (most
 * of its length over 30 ft from one of its creeks), and a pond, wet ground or a building where it
 * has none (neither's middle inside the other). Water first, then the wetlands not already in. */
export const govFresh = (gov: { water: CourseItem[]; wet: CourseItem[]; built: CourseItem[] }, mapped: CourseItem[]) => {
  const out: CourseItem[] = [];
  const near = (p: P, line: P[]) => line.some((q, k) => k > 0 && nearestOnSegment(p, line[k - 1], q).distance < 30);
  const covers = (a: P[], b: P[]) => pointInPolygon(centroid(b), a) || pointInPolygon(centroid(a), b);
  const has = (i: CourseItem, pool: CourseItem[]) => {
    if (i.type === "line") {
      const streams = pool.filter((m): m is LineItem => m.type === "line" && m.kind === "stream");
      return i.points.filter(p => streams.some(s => near(p, s.points))).length >= i.points.length * 0.5;
    }
    if (i.type === "area") return pool.some(m => m.type === "area" && (m.kind === i.kind || m.kind === "water" || (i.kind === "rough" && m.kind === "woods")) && covers(m.points, i.points));
    if (i.type === "structure") return pool.some(m => (m.type === "structure" || (m.type === "area" && m.kind === "building")) && covers(m.points, i.points));
    return true;
  };
  for (const group of [gov.water, gov.wet, gov.built]) for (const i of group) if (!has(i, [...mapped, ...out])) out.push(i);
  return out;
};

const govSummary = (added: CourseItem[]) => {
  const n = (f: (i: CourseItem) => boolean) => added.filter(f).length;
  const creeks = n(i => i.type === "line"), ponds = n(i => i.type === "area" && i.kind === "water"), wet = n(i => i.type === "area" && i.kind === "rough"), built = n(i => i.type === "structure");
  const parts = [
    creeks ? `${creeks} ${creeks === 1 ? "creek" : "creeks"}` : "",
    ponds ? `${ponds} ${ponds === 1 ? "pond" : "ponds"}` : "",
    wet ? `${wet} ${wet === 1 ? "wetland" : "wetlands"}` : "",
    built ? `${built} ${built === 1 ? "building" : "buildings"}` : ""
  ].filter(Boolean);
  return `From the US maps, not on OpenStreetMap: ${parts.join(", ")}.`;
};

/** A painted court the photo's water pass took for a pond: a patch that's a rectangle (its outline
 * fills 85% of the box round it or more), 30 to 130 ft across and 45 to 260 ft long (one
 * court with its run-off, or a row of them). Tennis from 55 ft across, pickleball under that. */
export const courtOf = (a: AreaItem): AreaItem | null => {
  if (a.points.length < 4) return null;
  const { a: half, b: halfW } = orientedBox(a.points);
  const long = half * 2, wide = halfW * 2;
  if (wide < 30 || wide > 130 || long < 45 || long > 260) return null;
  if (polygonArea(a.points) < long * wide * 0.85) return null;
  const c = createField(wide >= 55 ? "tennis" : "pickleball", boxOutline(a.points));
  return { ...c, importSource: "photo" };
};

const OSM_NAMES: Record<string, [string, string]> = {
  path: ["path", "paths"], road: ["road", "roads"], stream: ["stream", "streams"], water: ["water area", "water areas"],
  woods: ["wooded area", "wooded areas"], rough: ["grass area", "grass areas"],
  parking: ["parking lot", "parking lots"], building: ["building", "buildings"], shelter: ["shelter", "shelters"],
  hedge: ["hedge", "hedges"], power: ["power line", "power lines"], tree: ["tree", "trees"],
  bench: ["bench", "benches"], picnic: ["picnic table", "picnic tables"], restroom: ["restroom", "restrooms"], drinking: ["drinking fountain", "drinking fountains"],
  trash: ["trash can", "trash cans"], sign: ["parking sign", "parking signs"], practice: ["practice basket", "practice baskets"],
  grill: ["grill", "grills"], fitness: ["fitness station", "fitness stations"], flagpole: ["flagpole", "flagpoles"], fountain: ["fountain", "fountains"],
  gate: ["gate", "gates"], bikerack: ["bike rack", "bike racks"], light: ["light pole", "light poles"], pole: ["utility pole", "utility poles"]
};
/** The most of one amenity kind brought in (street lamps and utility poles can be hundreds). */
const AMENITY_CAP = 400;
/** (an amenity's name in the summary, where it isn't its own kind's) */
const AMENITY_SAID: Record<string, string> = { water: "drinking", parking: "sign" };

/** Feet to the nearest half foot. */
const halfFt = (ft: number) => Math.round(ft * 2) / 2;

/**
 * A building's (or a shelter's) walls, ft, from what's known of it: a height to the top of the
 * roof less the roof (its own height where mapped, else the roof this outline gets: a flat roof is
 * none), else its floors' height; unset where nothing is known. Kept within the kind's heights.
 */
export const wallsFt = (b: OsmBuilding | undefined, kind: "building" | "shelter", points: P[], roof?: RoofKind) => {
  if (!b) return undefined;
  const [lo, hi] = STRUCTURE_KINDS[kind].heights;
  if (b.topM) {
    const top = b.topM * FEET_PER_METER;
    const shape = roof ?? STRUCTURE_KINDS[kind].roof ?? "gable";
    const rise = b.roofM ? b.roofM * FEET_PER_METER : shape === "flat" ? 0 : roofOf(points, shape).rise;
    // (never less than half the height: a roof taller than its walls is a guess gone wrong)
    return halfFt(clamp(Math.max(top - rise, top * 0.5), lo, hi));
  }
  if (b.heightM) return halfFt(clamp(b.heightM * FEET_PER_METER, Math.max(8, lo), hi));
  return undefined;
};

/** Trees spaced along a line (a row of trees, or a hedge's bushes), only those on the plan. */
const treesAlong = (pts: P[], spacing: number, inside: (p: P) => boolean, make: (p: P) => TreeItem) => {
  const out: TreeItem[] = [];
  let carry = spacing / 2;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let d = carry; d <= len; d += spacing) {
      const p = { x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len };
      if (inside(p)) out.push(make(p));
    }
    carry = ((carry - len) % spacing + spacing) % spacing;
  }
  return out;
};

/** How many of each kind came in (for the summary). */
type OsmCounts = Record<string, number>;

/**
 * What OpenStreetMap has on the site as course items: lines and areas cut to the site's edges (a
 * road runs on for miles, a river's outline can be bigger than the whole park), buildings and
 * shelters to edit like ones drawn, fields, amenities, hedges and power lines, and trees (single
 * ones and rows); with how many of each came.
 */
export const osmFeatureItems = (features: OsmFeature[], ref: GeoBounds & { width: number; height: number }) => {
  const { width, height } = ref;
  // (a little past the edges, so lines run cleanly off the map)
  const edge = { x0: -20, y0: -20, x1: width + 20, y1: height + 20 };
  const onPlan = (p: P) => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
  const items: CourseItem[] = [];
  const counts: OsmCounts = {};
  const count = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  /** The park's things, by what they are ("ball field": 4), for the summary and the progress. */
  const parks: ParkCounts = {};
  const countWords = (one: string, many: string, n = 1) => { (parks[one] ??= { one, many, n: 0 }).n += n; };
  const countPark = (p: ParkDetail) => countWords(...parkWords(p));
  const plan = (ll: LatLon) => toPlanXY(ref, ll.lat, ll.lon);
  const osmTreeItem = (at: P, t: { heightM?: number; crownM?: number; conifer?: boolean } | undefined, fallback: { radius: number; height: number }) => {
    const radius = t?.crownM ? clamp((t.crownM / 2) * FEET_PER_METER, 4, 40) : fallback.radius;
    return { ...createTree(at, { radius: Math.round(radius * 2) / 2, height: Math.round(t?.heightM ? clamp(t.heightM * FEET_PER_METER, 8, 150) : fallback.height), treeType: t?.conifer ? "conifer" : "deciduous" }), importSource: "osm" as const } as TreeItem;
  };
  for (const f of features) {
    if (f.kind === "dgCourse" || f.kind === "dgHole" || f.kind === "dgTee" || f.kind === "dgBasket" || f.kind === "dgHint") continue;
    if (f.geom === "point") {
      const at = plan(f.points[0]);
      if (!onPlan(at)) continue;
      if (f.kind === "amenity") {
        const said = AMENITY_SAID[f.amenity] ?? f.amenity;
        if ((counts[said] ?? 0) >= AMENITY_CAP) continue;
        const a = { ...createAmenity(at, f.amenity), importSource: "osm" as const } as AmenityItem;
        if (f.name) a.label = f.name;
        items.push(a);
        count(said);
      } else if (f.kind === "tree") {
        items.push(osmTreeItem(at, f.tree, { radius: 12, height: 35 }));
        count("tree");
      } else if (f.kind === "shelter") {
        // A shelter mapped as a spot: a small one built there (20 ft square; a bus or lean-to shelter less)
        const [hw, hh] = f.small ? [6, 3.5] : [10, 10];
        const s = createStructure("shelter", [{ x: at.x - hw, y: at.y - hh }, { x: at.x + hw, y: at.y - hh }, { x: at.x + hw, y: at.y + hh }, { x: at.x - hw, y: at.y + hh }]);
        if (f.name) s.label = f.name;
        items.push({ ...s, importSource: "osm" });
        count("shelter");
      } else if (f.kind === "park") {
        // (nothing of the app's to draw it as yet: counted, and kept with the map data)
        countPark(f.park);
      }
      continue;
    }
    const pts0 = f.points.map(plan);
    if (f.geom === "area") {
      const pts = simplify(clipPolygonToRect(pts0, edge), 1);
      if (pts.length < 3 || Math.abs(polygonArea(pts)) < 4) continue;
      if (f.kind === "building" || f.kind === "shelter") {
        // A building to edit like one drawn: walls, a roof, a height
        const b = createStructure(f.kind, pts);
        if (f.building?.roof) b.roof = f.building.roof;
        const walls = wallsFt(f.building, f.kind, pts, b.roof);
        if (walls) b.height = walls;
        if (f.name) b.label = f.name;
        if (f.park) b.park = f.park;
        items.push({ ...b, importSource: "osm" });
        count(f.kind);
        if (f.park && f.park.what !== "shed") countPark(f.park);
        continue;
      }
      if (f.kind === "field") {
        // A field, court or play area as the app's own (its kind from its tags and the outline it
        // keeps: a ball field's home plate is a corner of it)
        const fld = fieldOf(f.tags ?? {}, pts);
        if (!fld) continue;
        const a = createField(fld.field, pts);
        if (fld.home !== undefined) a.home = fld.home;
        if (f.name) a.label = f.name;
        if (f.park) a.park = f.park;
        items.push({ ...a, importSource: "osm" });
        // ("4 tennis courts": a court area's courts, each counted)
        const word = fieldWord(fld.field);
        countWords(word, `${word}s`, Math.max(1, fld.courts ?? 1));
        continue;
      }
      const area = createArea(f.kind, pts) as AreaItem;
      if (f.name) area.label = f.name;
      if (f.park) area.park = f.park;
      items.push({ ...area, importSource: "osm" });
      // (a ball field's infield said as one, not as the area it's drawn as)
      if (f.park) countPark(f.park);
      else count(f.kind);
    } else if (f.kind === "treeRow") {
      const made = treesAlong(pts0, 22, onPlan, p => osmTreeItem(p, f.tree, { radius: 11, height: 35 }));
      items.push(...made);
      if (made.length) count("tree", made.length);
    } else {
      let pieces = 0;
      for (const piece of clipPathToRect(pts0, edge)) {
        const pts = simplify(piece, 1);
        if (pts.length < 2) continue;
        const line = createLine(f.kind, pts) as LineItem;
        // (as it's mapped, point to point: a curve through the points leaves the road)
        line.straight = true;
        if (f.name && f.kind !== "path") line.label = f.name;
        if ((f.kind === "path" || f.kind === "road") && f.surface) line.surface = f.surface;
        if ((f.kind === "path" || f.kind === "road" || f.kind === "stream") && f.widthM) line.width = halfFt(clamp(f.widthM * FEET_PER_METER, 2, LINE_KINDS[f.kind].maxWidth));
        if (f.kind === "fence" && f.park) line.park = f.park;
        // (a power line's or a hedge's height, and a hedge's width, where tagged)
        if ((f.kind === "power" || f.kind === "hedge") && f.line?.height) line.fenceHeight = f.line.height;
        if (f.kind === "hedge" && f.line?.width) line.width = f.line.width;
        items.push({ ...line, importSource: "osm" });
        pieces++;
      }
      // (each piece on the site, as the Site step counts them; fences come in, but aren't said)
      if (pieces && f.kind !== "fence") count(f.kind, pieces);
      if (pieces && f.kind === "fence" && f.park) countPark(f.park);
    }
  }
  return { items, counts, parks };
};

/** A park's things by what they are, in words. */
type ParkCounts = Record<string, { one: string; many: string; n: number }>;
/** "4 ball fields, 2 tennis courts, 1 playground", most first. */
export const parkSummary = (parks: ParkCounts) =>
  Object.values(parks).sort((a, b) => b.n - a.n).map(p => `${p.n.toLocaleString()} ${p.n === 1 ? p.one : p.many}`).join(", ");

/** "2 paths, 1 road, 1 water area" (then the park's things, and the buildings traced from the
 * air), in OSM_NAMES' order. */
const osmSummary = (counts: OsmCounts, traced: number, parks: ParkCounts = {}) =>
  [
    ...Object.entries(OSM_NAMES).map(([k, [one, many]]) => {
      const n = counts[k] ?? 0;
      return n ? `${n.toLocaleString()} ${n === 1 ? one : many}` : "";
    }),
    parkSummary(parks),
    traced ? `${traced} more ${traced === 1 ? "building" : "buildings"} traced from the air` : ""
  ]
    .filter(Boolean)
    .join(", ");

/** How long a tee or pin word says it plays: 0 short, 1 in between or unsaid, 2 long. */
const lengthRank = (tag?: string) =>
  !tag ? 1 : /^(short|front|am|amateur|rec|recreational|novice)$/.test(tag) ? 0 : /^(long|back|pro|championship)$/.test(tag) ? 2 : 1;

/** A hole's pin positions: a letter said keeps it, the rest take the letters left, short before
 * long, else in their order (null: past D, the last there is). */
export const pinPositions = (tags: (string | undefined)[]): (PinPosition | null)[] => {
  const out: (PinPosition | null)[] = tags.map(() => null);
  const free = new Set<PinPosition>(PIN_POSITIONS);
  tags.forEach((t, i) => { const l = t?.toUpperCase() as PinPosition; if (t && free.has(l) && /^[A-D]$/.test(t.toUpperCase())) { out[i] = l; free.delete(l); } });
  const rest = tags.map((t, i) => ({ t, i })).filter(x => out[x.i] === null).sort((a, b) => lengthRank(a.t) - lengthRank(b.t) || a.i - b.i);
  for (const r of rest) { const l = PIN_POSITIONS.find(p => free.has(p)); if (!l) break; out[r.i] = l; free.delete(l); }
  return out;
};

/** A hole's tee colors: a color said keeps it; the rest, longest first (a long tee, else the
 * farthest from the basket), take the colors usually used, in order from the back (one tee: blue;
 * two: blue and red; three: gold, blue and red). Null: no color left. */
export const teeLevels = (tees: { tag?: string; far: number }[]): (TeeLevel | null)[] => {
  const out: (TeeLevel | null)[] = tees.map(() => null);
  const free = new Set<TeeLevel>(TEE_ORDER);
  tees.forEach((t, i) => { const c = t.tag as TeeLevel; if (c && free.has(c)) { out[i] = c; free.delete(c); } });
  const rest = tees.map((t, i) => ({ ...t, i })).filter(x => out[x.i] === null).sort((a, b) => lengthRank(b.tag) - lengthRank(a.tag) || b.far - a.far);
  const usual = (rest.length === 1 ? ["blue"] : rest.length === 2 ? ["blue", "red"] : rest.length === 3 ? ["gold", "blue", "red"] : ["gold", "blue", "white", "red", "green", "purple"]) as TeeLevel[];
  const picks = [...usual.filter(l => free.has(l)), ...TEE_ORDER.filter(l => free.has(l) && !usual.includes(l))].slice(0, rest.length).sort((a, b) => TEE_ORDER.indexOf(a) - TEE_ORDER.indexOf(b));
  rest.forEach((r, k) => { if (picks[k]) out[r.i] = picks[k]; });
  return out;
};

/** A disc golf course mapped on OpenStreetMap or read from a GPS file, as holes on the plan: each
 * hole's tees, pin positions and bends, numbered and with a par where mapped; only holes whose tee
 * and basket are on the site (`outside` says how many weren't). `taken`: numbers in use already
 * (a hole with one of those plays as the next free one). `dropped`: tees and pins past the six
 * colors and four letters there are. */
export const courseFromMap = (course: MappedCourse, ref: GeoBounds & { width: number; height: number }, taken = new Set<number>()) => {
  const plan = (ll: LatLon) => toPlanXY(ref, ll.lat, ll.lon);
  const on = (p: P) => p.x >= 0 && p.y >= 0 && p.x <= ref.width && p.y <= ref.height;
  const holes: Hole[] = [];
  const items: CourseItem[] = [];
  taken = new Set(taken);
  let outside = 0, dropped = 0;
  for (const m of course.holes) {
    const tee = plan(m.tee), basket = plan(m.basket);
    if (!on(tee) || !on(basket)) { outside++; continue; }
    // (a number used twice: the second plays as the next free one)
    const number = m.number && !taken.has(m.number) ? m.number : undefined;
    if (number) taken.add(number);
    const hole = newHole({ doglegs: m.doglegs.map(plan), ...(number ? { number } : {}), ...(m.par ? { par: m.par } : {}) });
    holes.push(hole);
    // (every tee and pin it has; one past the site's edge stays out)
    const tees = (m.tees ?? [{ at: m.tee }]).map(t => ({ ...t, p: plan(t.at) })).filter((t, i) => i === 0 || on(t.p));
    const pins = (m.baskets ?? [{ at: m.basket }]).map(b => ({ ...b, p: plan(b.at) })).filter((b, i) => i === 0 || on(b.p));
    const levels = teeLevels(tees.map(t => ({ tag: t.tag, far: Math.hypot(t.p.x - basket.x, t.p.y - basket.y) })));
    const positions = pinPositions(pins.map((b: MappedSpot & { p: P }) => b.tag));
    tees.forEach((t, i) => { const l = levels[i]; if (l) items.push(createTee(hole.id, t.p, l)); else dropped++; });
    pins.forEach((b, i) => { const l = positions[i]; if (l) items.push(createBasket(hole.id, b.p, l)); else dropped++; });
  }
  return { name: course.name, holes, items, outside, dropped };
};

/**
 * What OpenStreetMap has on the site, as course items, with a summary ("2 paths, 1 road, 1 water
 * area") and a disc golf course mapped there; and the buildings traced from the air for the ones
 * nobody's mapped. Throws when OpenStreetMap couldn't be reached. `fresh`: an answer kept from the
 * map tiles is asked for again (from Overpass, with more).
 */
export const osmItems = async (bounds: GeoBounds, width: number, height: number, opts: { signal?: AbortSignal; fresh?: boolean } = {}) => {
  const traced = cached("buildings", "traced", () => tracedBuildings(bounds), { signal: opts.signal, within: bounds }).value.catch(err => {
    if (opts.signal?.aborted) throw err;
    console.warn("Traced buildings lookup failed", err);
    return [] as TracedBuilding[];
  });
  const answer = await fetchOsm(bounds, { signal: opts.signal, fresh: opts.fresh, headStartMs: 15000 }).value;
  const ref = { ...bounds, width, height };
  const { items, counts, parks } = osmFeatureItems(answer.features, ref);
  const more = tracedItems(await traced, items, ref);
  const mc = mappedCourse(answer.features);
  return { items: [...items, ...more].map(signed), summary: osmSummary(counts, more.length, parks), course: mc ? courseFromMap(mc, ref) : undefined };
};

/** The smallest building traced from the air that's kept, sq ft (a shed: about 3 m by 3 m). */
const TRACED_MIN_SQFT = 100;
/** How sure the tracing must be, where it says (0-1). */
const TRACED_SURE = 0.7;

/**
 * The buildings traced from the air worth adding, as buildings to edit like one drawn: only ones
 * the map doesn't have (none overlapping a building it has, nor sitting on parking or water), big
 * enough to be a building, whole on the site, and at least `TRACED_SURE` sure where the tracing
 * says how sure it is. Their heights are to the top of the roof.
 */
export const tracedItems = (traced: TracedBuilding[], mapped: CourseItem[], ref: GeoBounds & { width: number; height: number }) => {
  const taken = mapped.filter((m): m is CourseItem & { points: P[] } => (m.type === "structure" && (m.kind === "building" || m.kind === "shelter")) || (m.type === "area" && (m.kind === "parking" || m.kind === "water")));
  const overlaps = (a: P[], b: P[]) => a.some(p => pointInPolygon(p, b)) || b.some(p => pointInPolygon(p, a)) || pointInPolygon(centroid(a), b);
  const out: (CourseItem & { points: P[] })[] = [];
  for (const t of traced) {
    if (t.confidence !== null && t.confidence < TRACED_SURE) continue;
    const pts = simplify(t.points.map(p => toPlanXY(ref, p.lat, p.lon)), 0.5);
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < TRACED_MIN_SQFT) continue;
    if (pts.some(p => p.x < 0 || p.y < 0 || p.x > ref.width || p.y > ref.height)) continue;
    if (taken.some(m => overlaps(pts, m.points)) || out.some(m => overlaps(pts, m.points))) continue;
    const b: StructureItem = createStructure("building", pts);
    const walls = wallsFt(t.heightM ? { topM: t.heightM } : undefined, "building", pts);
    if (walls) b.height = walls;
    out.push({ ...b, importSource: "traced" });
  }
  return out as CourseItem[];
};

/**
 * The measured trees' last step, on the import and on the Site step's Measure trees and ground:
 * each tree stands on its own (no woods are made from them; any an older import made go), and
 * what they stand in for is taken out: the trees and woods found on the photo, the trees mapped one
 * by one or in rows on OpenStreetMap, and OpenStreetMap's woods (drawn by hand and often over a
 * whole hillside). Only what came in as it came is changed.
 */
/** What the woods from the measured canopy keep off: built things, water, parking, out-of-play
 * areas and fields, and roads (as wide as they're drawn). */
export const canopyKeepOut = (items: CourseItem[]) => ({
  areas: items.filter((i): i is AreaItem | StructureItem => i.type === "structure" || (i.type === "area" && ["water", "parking", "nogo", "field"].includes(i.kind))).map(i => i.points),
  lines: items.filter((i): i is LineItem => i.type === "line" && i.kind === "road").map(i => ({ points: i.points, width: i.width ?? LINE_KINDS.road.width }))
});

export const withMeasuredTrees = (items: CourseItem[], trees: LidarTree[], bushes: LidarBush[] = [], free: (p: P) => boolean = () => true) => {
  const items2 = items.filter(i => {
    if (!isImported(i)) return true;
    if ((i.type === "area" || i.type === "tree") && i.importSource === "lidar") return false;
    if (!trees.length) return true;
    if (i.type === "tree" && (i.importSource === "photo" || (i.importSource === "osm" && i.treeType !== "bush"))) return false;
    return !(i.type === "area" && i.kind === "woods" && (i.importSource === "photo" || i.importSource === "osm"));
  });
  // The bushes the survey measured, each one to edit like one planted (not on a road, a building or
  // in water, and not where a bush is already)
  const had = items2.filter((t): t is TreeItem => t.type === "tree" && t.treeType === "bush");
  const measured = bushes
    .filter(([x, y, , r]) => free({ x, y }) && !had.some(t => Math.hypot(t.x - x, t.y - y) < Math.max(4, r + t.radius * 0.5)))
    .map(([x, y, h, r]) => ({ ...createTree({ x, y }, { radius: Math.round(r * 2) / 2, height: Math.max(3, Math.round(h)), treeType: "bush" }), importSource: "lidar" as const }));
  return { items: [...items2, ...measured], bushes: measured.length };
};

/**
 * The design carried over to a new site frame (bigger, smaller or moved): every hole, tee, basket,
 * shape and label stays on the same spot on the ground. `outside` counts the things that are now
 * past the new frame's edges (kept, to move in or remove).
 */
export const reframeDesign = (design: { holes: Hole[]; items: CourseItem[] }, from: GeoRef, to: GeoRef) => {
  const f = reframe(from, to);
  const items = design.items.map(i => {
    const at = f({ x: i.x, y: i.y });
    const moved = { ...i, x: at.x, y: at.y } as CourseItem;
    if (moved.type === "area" || moved.type === "line" || moved.type === "structure") moved.points = moved.points.map(f);
    // (one as it came still is: only the frame moved under it)
    return i.importSig && asItCame(i) ? signed(moved) : moved;
  });
  const holes = design.holes.map(h => ({ ...h, doglegs: h.doglegs.map(f) }));
  const outside = items.filter(i => i.x < 0 || i.y < 0 || i.x > to.width || i.y > to.height).length;
  return { holes, items, outside };
};

/** Said when OpenStreetMap couldn't be reached. */
export const OSM_UNREACHABLE = "Couldn't reach OpenStreetMap, so paths, roads, water and buildings weren't brought in.";
/** Said when OpenStreetMap has nothing on the site. */
export const OSM_NOTHING = "OpenStreetMap has nothing mapped here.";
/** What OpenStreetMap is asked for, while it's asked. */
export const OSM_ASKING = "Looking up paths, roads, water and buildings on OpenStreetMap…";
/** Said while an Overpass server has failed and the others are still asked. */
export const OSM_BUSY = "OpenStreetMap is busy: asking another server…";

// ---------------------------------------------------------------- progress

/** How much of the whole each source is (LiDAR's the longest), and how long one that can't say
 * how far along it is usually takes, ms (its bar eases toward the end meanwhile). */
const WEIGHT: Record<SourceId, number> = { photo: 2, elevation: 1, lidar: 4, osm: 2, buildings: 1, photoTrees: 2, gov: 1, seasons: 1 };
const USUAL_MS: Partial<Record<SourceId, number>> = { elevation: 2500, osm: 8000, buildings: 4000 };

/** Each source's state, said to `onProgress` (and `onStatus`) as it changes, and twice a second
 * while anything is coming (for the bars that ease along). Quiet once closed. */
class Progress {
  readonly sources: Partial<Record<SourceId, SourceStatus>> = {};
  private since: Partial<Record<SourceId, number>> = {};
  private t0 = performance.now();
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  /** The photo trees' own step, while they're looked for. */
  step = "";
  constructor(private opts: ImportOptions, ids: SourceId[], private photoName: string) {
    for (const id of ids) this.sources[id] = { state: "waiting" };
    this.timer = setInterval(() => this.emit(), 500);
  }
  set(id: SourceId, s: Partial<SourceStatus>) {
    const was = this.sources[id];
    if (!was || this.closed) return;
    if (s.state === "coming" && was.state !== "coming") this.since[id] = performance.now();
    const next = { ...was, ...s };
    if (s.state && s.state !== "coming" && s.state !== "waiting") {
      next.ms = Math.round(performance.now() - this.t0);
      next.fraction = 1;
      delete next.busy;
    }
    this.sources[id] = next;
    this.emit();
  }
  private fractionOf(id: SourceId, s: SourceStatus) {
    if (s.state === "waiting") return 0;
    if (s.state !== "coming") return 1;
    if (s.fraction !== undefined) return s.fraction;
    const usual = USUAL_MS[id] ?? 5000;
    return 0.9 * (1 - Math.exp(-(performance.now() - (this.since[id] ?? this.t0)) / usual));
  }
  get fraction() {
    let all = 0, got = 0;
    for (const [id, s] of Object.entries(this.sources) as [SourceId, SourceStatus][]) {
      all += WEIGHT[id];
      got += WEIGHT[id] * this.fractionOf(id, s);
    }
    return all ? Math.min(1, got / all) : 1;
  }
  get text() {
    const coming = (Object.entries(this.sources) as [SourceId, SourceStatus][]).filter(([, s]) => s.state === "coming").map(([id]) => id);
    if (coming.includes("photoTrees")) return this.step || "Finding woods, trees and water on the photo…";
    const osm = this.sources.osm;
    if (coming.length === 1) {
      const id = coming[0];
      if (id === "photo") return `Downloading the ${this.photoName}…`;
      if (id === "elevation") return "Downloading elevation…";
      if (id === "lidar") return "Measuring trees and ground from the air (LiDAR)…";
      if (id === "osm") return osm?.busy ? OSM_BUSY : OSM_ASKING;
      if (id === "buildings") return "Looking up buildings traced from the air…";
    }
    if (!coming.length) return Object.values(this.sources).some(s => s.state === "waiting") ? "Finding woods, trees and water on the photo…" : "Putting it together…";
    const names: Record<SourceId, string> = { photo: this.photoName, elevation: "elevation", lidar: "measured trees", osm: "OpenStreetMap", buildings: "traced buildings", photoTrees: "", gov: "the US maps", seasons: "satellite seasons" };
    const list = coming.map(id => names[id]);
    return `Bringing in the ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}…`;
  }
  emit() {
    if (this.closed) return;
    const fraction = this.fraction, text = this.text;
    const sources = Object.fromEntries(Object.entries(this.sources).map(([k, v]) => [k, { ...v }])) as ImportProgress["sources"];
    this.opts.onProgress?.({ sources, fraction, text });
    if (this.opts.onStatus) {
      const all = Object.values(this.sources);
      const done = all.filter(s => s.state !== "waiting" && s.state !== "coming").length;
      this.opts.onStatus(text, { step: Math.min(all.length, done + 1), of: all.length, fraction });
    }
  }
  close() {
    this.emit();
    this.closed = true;
    clearInterval(this.timer);
  }
}

/** A year in a source's name ("USGS LiDAR 2022"), where it has one. */
const yearIn = (label?: string) => {
  const y = label ? surveyYear(label) : 0;
  return y > 1900 ? y : undefined;
};

// ---------------------------------------------------------------- the import

export const importSite = async (selection: SiteSelection, opts: ImportOptions): Promise<ImportedSite> => {
  const signal = opts.signal;
  throwIfAborted(signal);
  const location = selection.center;
  const grid = gridFor(selection.widthFt);
  // The plan is the selected area at 1 unit = 1 ft, a whole number of grid cells, so the photo,
  // the terrain and everything drawn line up exactly
  const width = Math.max(1, Math.round(selection.widthFt / grid)) * grid;
  const height = Math.max(1, Math.round(selection.heightFt / grid)) * grid;
  const bounds = getGeoBounds(location, width, height);
  const ref = { ...bounds, width, height };
  const here = `${boundsKey(bounds)}|${width}x${height}`;
  const notes: string[] = [];
  const satellite = opts.imagery === "satellite";
  const wantsPhotoTrees = opts.trees && satellite;
  const wantsGov = opts.gov !== false && inUS(bounds);
  const ids: SourceId[] = [
    ...(opts.imagery !== "none" ? ["photo" as const] : []),
    "elevation",
    ...(opts.lidar ? ["lidar" as const] : []),
    ...(opts.osm ? ["osm" as const, "buildings" as const] : []),
    ...(wantsPhotoTrees ? ["photoTrees" as const] : []),
    ...(wantsGov ? ["gov" as const] : []),
    ...(opts.trees || opts.lidar ? ["seasons" as const] : [])
  ];
  const progress = new Progress(opts, ids, satellite ? "satellite photo" : "map");
  const layer = (l: ImportLayer) => { if (!signal?.aborted) opts.onLayer?.(l); };
  layer({ source: "frame", canvas: { width, height }, gridSize: grid, bounds });
  // (a source that failed: said, and the rest goes on; one stopped stops it all)
  const soft = async <T>(id: SourceId, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      // (only a stop of the import itself stops it: a source that ran out of time just failed)
      if (signal?.aborted) throw err;
      console.warn(`Import: ${id} failed`, err);
      progress.set(id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  try {
    // The photo (the street map in its place when it can't be had)
    const photoJob = opts.imagery === "none" ? Promise.resolve(null) : soft("photo", async () => {
      progress.set("photo", { state: "coming", fraction: 0 });
      // (its near-infrared band too, a second download: leaves and water are told apart by it, and a
      // shadow or a blue roof isn't taken for a pond)
      const get = (source: MapImagerySource) => { const nir = source === "satellite"; return cached("photo", `${source}|${nir ? "nir" : ""}|${opts.photo ?? ""}|${here}`, report => fetchMapImagery(location, width, height, source, report, { signal, nir, photo: opts.photo }), { signal, onProgress: f => progress.set("photo", { fraction: f * 0.95 }) }); };
      let got = get(opts.imagery as MapImagerySource);
      const map = await untilAborted(got.value, signal).catch(async err => {
        if (signal?.aborted || !satellite) throw err;
        console.warn("Satellite photo failed: the street map instead", err);
        got = get("streets");
        const streets = await untilAborted(got.value, signal);
        notes.push("Couldn't download the satellite photo, so the street map is under the course.");
        return streets;
      });
      progress.set("photo", { state: "done", source: map.sourceLabel, year: map.year ?? map.photo?.year, cached: got.hit });
      layer({ source: "photo", background: map.url, label: map.sourceLabel });
      return map;
    });

    // The ground (flat when no elevation can be had)
    const spacing = Math.max(grid / 2, Math.max(width, height) / 600);
    const samplesX = clamp(Math.round(width / spacing) + 1, 2, 800);
    const samplesY = clamp(Math.round(height / spacing) + 1, 2, 800);
    // (how fine 3DEP's ground is here, "USGS 3DEP 1 m ground": asked at the same time)
    const groundLabel = cached("groundLabel", boundsKey(bounds), () => usgsGroundLabel(bounds)).value.catch(() => null);
    const elevationJob = soft("elevation", async () => {
      progress.set("elevation", { state: "coming" });
      const got = cached("elevation", `${here}|${samplesX}x${samplesY}`, () => fetchBestElevationGrid(location, width, height, samplesX, samplesY), { signal });
      const elev = await untilAborted(got.value, signal);
      const heights = heightsFromSamples(elev.values, samplesX, samplesY, elev.min, width, height, grid);
      const label = elev.source.startsWith("USGS") ? await Promise.race([groundLabel, new Promise<null>(r => setTimeout(() => r(null), 2000))]) : null;
      progress.set("elevation", { state: "done", source: label ?? elev.source, year: (elev as { year?: number }).year, cached: got.hit });
      layer({ source: "elevation", terrainHeights: heights, baseElevationFt: elev.min * FEET_PER_METER, label: elev.source });
      return { heights, elev };
    });

    // Trees and ground measured from the air, where a survey covers it
    const lidarJob = !opts.lidar ? Promise.resolve(null) : soft("lidar", async () => {
      progress.set("lidar", { state: "coming", fraction: 0 });
      // (the survey's ground checked against 3DEP's, when that's what the elevation is: awaited only
      // once the points are in, so both still download at once)
      const dem = elevationJob.then(e => (e && e.elev.source.startsWith("USGS") ? { values: e.elev.values, samplesX, samplesY } : null)).catch(() => null);
      const got = cached("lidar", here, report => fetchLidar(ref, report, { dem, signal }), { signal, onProgress: f => progress.set("lidar", { fraction: f }) });
      const lidar = await untilAborted(got.value, signal);
      if (!lidar) { progress.set("lidar", { state: "not-here", cached: got.hit }); return null; }
      const g = groundOnGrid(lidar.measured, width, height, grid);
      progress.set("lidar", { state: "done", count: lidar.trees.length, source: lidar.label ?? lidar.source, year: lidar.surveys?.[0]?.year ?? yearIn(lidar.source), cached: got.hit });
      layer({ source: "lidar", trees: lidar.trees, terrainHeights: g.heights, baseElevationFt: g.min, label: lidar.source });
      return { lidar, ground: g };
    });

    // The buildings traced from the air (sorted out against OpenStreetMap's once both are in)
    const tracedJob = !opts.osm ? Promise.resolve(null) : soft("buildings", async () => {
      progress.set("buildings", { state: "coming" });
      // (45 s at most: the rest of the import never waits on it for longer)
      const got = cached("buildings", "traced", () => Promise.race([tracedBuildings(bounds), new Promise<never>((_, no) => setTimeout(() => no(new Error("The buildings from the air took too long")), 45000))]), { signal, within: bounds });
      const list = await untilAborted(got.value, signal);
      return { list, hit: got.hit };
    });

    // The photo's woods, trees and water, once the photo's in: left out where trees measured from
    // the air cover the site (only its water is looked for then)
    const natureJob = !wantsPhotoTrees ? Promise.resolve(null) : (async () => {
      const [map, measured] = await Promise.all([photoJob, lidarJob]);
      if (!map || !satellite || /OpenStreetMap/.test(map.sourceLabel)) { progress.set("photoTrees", { state: "not-here" }); return null; }
      const waterOnly = !!measured?.lidar.trees.length || !!opts.surveyed;
      // (a survey flown bare, a photo taken in leaf: its canopy too, for the trees the survey missed;
      // under a bare photo, the best one of the site's taken in leaf, only to find them on)
      const bare = !!measured?.lidar.trees.length && measured.lidar.measured.leafOn !== true;
      const leafToo = bare && opts.summerFill !== false && summerFills(measured.lidar.measured.leafOn, map.photo?.season);
      const inLeaf = bare && !leafToo ? map.choices?.find(c => c.season === "leaf-on" && c.nir) ?? map.choices?.find(c => c.season === "leaf-on") : undefined;
      return soft("photoTrees", async () => {
        progress.set("photoTrees", { state: "coming", fraction: 0 });
        const got = cached("nature", `${map.sourceLabel}|${here}|${waterOnly ? (leafToo ? "water+leaf" : "water") : "all"}`, report => natureFromPhoto(map.url, width, height, (text, f) => { progress.step = text; report(f); }, { signal, waterOnly, canopy: leafToo, nir: map.nir, date: map.photo?.date, lat: location.lat }), { signal, onProgress: f => progress.set("photoTrees", { fraction: f }) });
        const n = await untilAborted(got.value, signal);
        // (a new id each time it's used: kept from before, it would share them with the last import's)
        const fresh = <T extends CourseItem>(i: T): T => ({ ...i, id: generateId() });
        let leaf = n.leaf;
        if (inLeaf) {
          const summer = await untilAborted(cached("photo", `summer|${inLeaf.id}|${here}`, () => fetchMapImagery(location, width, height, "satellite", undefined, { signal, nir: true, photo: inLeaf.id, choices: [inLeaf] }), { signal }).value, signal).catch(err => { if (signal?.aborted) throw err; console.info("No photo in leaf to find trees on", err); return null; });
          if (summer) leaf = (await untilAborted(natureFromPhoto(summer.url, width, height, undefined, { signal, waterOnly: true, canopy: true, nir: summer.nir }), signal)).leaf;
        }
        const found = { trees: n.trees.map(fresh), woods: n.woods.map(fresh), water: n.water.map(fresh), leaf };
        progress.set("photoTrees", waterOnly ? { state: "not-here", skipped: "measured", count: found.water.length, cached: got.hit } : { state: "done", count: found.trees.length + found.woods.length + found.water.length, cached: got.hit });
        layer({ source: "photoTrees", trees: found.trees, areas: [...found.woods, ...found.water] });
        return found;
      });
    })();

    // The US government's maps: creeks and ponds, wetlands, buildings (each on its own: one that
    // doesn't answer leaves the others)
    const govJob = !wantsGov ? Promise.resolve(null) : soft("gov", async () => {
      progress.set("gov", { state: "coming" });
      const got = cached("gov", here, async () => {
        const t0 = performance.now();
        const one = (what: string, run: Promise<OsmFeature[]>) => run.catch(err => { if (signal?.aborted) throw err; console.info(`US maps: no ${what} after ${Math.round(performance.now() - t0)} ms`, err); return null; });
        const [water, wet, built] = await Promise.all([one("water", fetchWater(bounds, { signal })), one("wetlands", fetchWetlands(bounds, { signal })), one("buildings", fetchStructures(bounds, { signal }))]);
        if (!water && !wet && !built) throw new Error("None of the US maps answered");
        return { water: water ?? [], wet: wet ?? [], built: built ?? [], waterOk: !!water || !!wet };
      }, { signal, within: bounds });
      const v = await untilAborted(got.value, signal);
      const tag = <S extends "usgs" | "nwi" | "fema">(fs: OsmFeature[], src: S) => osmFeatureItems(fs, ref).items.map(i => ({ ...i, importSource: src }) as CourseItem);
      const found = { water: tag(v.water, "usgs"), wet: tag(v.wet, "nwi"), built: tag(v.built, "fema"), waterOk: v.waterOk };
      const n = found.water.length + found.wet.length + found.built.length;
      progress.set("gov", { state: n ? "done" : "not-here", count: n, source: "USGS, USFWS, FEMA", cached: got.hit });
      return found;
    });

    // OpenStreetMap: waited for a little longer while the rest is still coming
    // (the rest given 45 s at most: one that stalls doesn't hold OpenStreetMap up)
    // The satellite's seasons, for the brush (Sentinel-2: how green each spot is in winter, spring
    // and summer)
    const seasonsJob = !(opts.trees || opts.lidar) ? Promise.resolve(null) : soft("seasons", async () => {
      progress.set("seasons", { state: "coming" });
      const got = cached("seasons", here, () => seasonsFromSpace(bounds, signal), { signal });
      const s = await untilAborted(got.value, signal);
      progress.set("seasons", s ? { state: "done", source: "Sentinel-2", cached: got.hit } : { state: "not-here", cached: got.hit });
      return s;
    });
    const restIn = Promise.race([Promise.allSettled([photoJob, elevationJob, lidarJob, tracedJob, natureJob, govJob, seasonsJob]), new Promise(r => setTimeout(r, 45000))]);
    const osmJob = !opts.osm ? Promise.resolve(null) : soft("osm", async () => {
      progress.set("osm", { state: "coming" });
      const got = fetchOsm(bounds, { signal, settle: restIn, onBusy: () => progress.set("osm", { busy: true }), onTiles: () => progress.set("osm", { busy: false }) });
      const answer = await untilAborted(got.value, signal);
      const { items, counts, parks } = osmFeatureItems(answer.features, ref);
      const n = items.length;
      progress.set("osm", { state: n ? "done" : "not-here", count: n, source: answer.from === "overpass" ? "Overpass" : "OpenFreeMap map tiles", cached: got.hit, ...(Object.keys(parks).length ? { parts: Object.fromEntries(Object.values(parks).map(p => [p.n === 1 ? p.one : p.many, p.n])), detail: parkSummary(parks) } : {}) });
      layer({ source: "osm", items });
      return { answer, items, counts, parks };
    });

    const [map, ground, measured, traced, nature, osm, gov, seasons] = await untilAborted(Promise.all([photoJob, elevationJob, lidarJob, tracedJob, natureJob, osmJob, govJob, seasonsJob]), signal);

    // ------------------------------------------------------------ put together
    // (in pieces, the page given a moment between them: whatever is drawing meanwhile, the site
    // being built in front of you say, keeps moving; the same work in the same order)
    if (opts.beforeSort) await untilAborted(opts.beforeSort(), signal);
    await breath(signal);
    const background = map?.url ?? null;
    if (map?.partial) notes.push("Some map tiles were missing.");
    if (opts.imagery !== "none" && !map) notes.push(satellite ? "Couldn't download the satellite photo or the street map, so there's plain ground under the course." : "Couldn't download the street map, so there's plain ground under the course.");

    let terrainHeights = ground?.heights ?? {};
    let baseFt = ground ? ground.elev.min * FEET_PER_METER : 0;
    let reliefFt = ground ? (ground.elev.max - ground.elev.min) * FEET_PER_METER : 0;
    let elevationSource: string | undefined = ground?.elev.source;
    if (!ground) notes.push("Couldn't download the elevation, so the ground is flat.");

    let lidar: CourseDoc["lidar"];
    let treesNoteAt = -1;
    // (none covers the site: remembered, so the Site step says so instead of offering to look)
    const noLidar = !!opts.lidar && progress.sources.lidar?.state === "not-here";
    const lidarFailed = !!opts.lidar && progress.sources.lidar?.state === "failed";
    if (opts.lidar) {
      const fromPhoto = wantsPhotoTrees && !!background;
      if (lidarFailed) notes.push(`Couldn't read the aerial survey this time${fromPhoto ? ": the trees came from the photo" : ""}.`);
      else if (noLidar) notes.push(`No aerial survey covers this spot${fromPhoto ? ": the trees came from the photo" : ""}.`);
    }
    if (measured) {
      terrainHeights = measured.ground.heights;
      baseFt = measured.ground.min;
      reliefFt = measured.ground.max - measured.ground.min;
      elevationSource = measured.lidar.source;
      lidar = { source: measured.lidar.source, trees: measured.lidar.trees };
      // (said once OpenStreetMap's in: the trees standing, none on a road or a building)
      treesNoteAt = notes.length;
    }
    if (ground || measured) notes.push(reliefFt < 1 ? "Nearly flat (under 1 ft of elevation change)." : `${Math.round(reliefFt)} ft of elevation change across the site.`);

    let mapped: CourseItem[] = [];
    let course: ImportedSite["course"];
    const osmFailed = !!opts.osm && !osm;
    if (osm) {
      // (the US maps' creeks, wet ground and buildings OpenStreetMap hasn't got; the buildings traced
      // from the air only where neither has one)
      const added = gov ? govFresh(gov, osm.items) : [];
      const more = tracedItems(traced?.list ?? [], [...osm.items, ...added], ref);
      mapped = [...osm.items, ...added, ...more];
      const summary = osmSummary(osm.counts, more.length, osm.parks);
      notes.push(summary ? `From OpenStreetMap: ${summary}.` : OSM_NOTHING);
      if (added.length) notes.push(govSummary(added));
      const mc = mappedCourse(osm.answer.features);
      if (mc) course = courseFromMap(mc, ref);
      // (a course mapped only as spots named for its holes: said, as they can't make holes)
      const hints = mc?.holes.length ? 0 : holeHints(osm.answer.features);
      if (hints) notes.push(`OpenStreetMap marks ${hints} disc golf ${hints === 1 ? "hole" : "holes"} here as single points, without saying which is the tee and which is the basket, so no holes were made from them. To bring the holes in, open a GPS file of the course (Holes from a GPS file) or walk it with Tee here and Pin here.`);
      progress.set("buildings", traced ? { state: more.length ? "done" : "not-here", count: more.length, source: "Overture Maps", cached: traced.hit } : {});
      if (more.length) layer({ source: "buildings", items: more });
    } else if (traced) {
      // (OpenStreetMap out of reach: the traced buildings are left out too, as they're only the
      // ones it hasn't mapped)
      progress.set("buildings", { state: "failed", error: "OpenStreetMap out of reach" });
    }

    // (OpenStreetMap out of reach or left out: the US maps' creeks, wet ground and buildings still come)
    if (!osm && gov) {
      mapped = govFresh(gov, []);
      if (mapped.length) notes.push(govSummary(mapped).replace(", not on OpenStreetMap", ""));
    }
    const found = nature ?? { trees: [], woods: [], water: [] };
    // What OpenStreetMap maps already (its woods and water) needn't come again from the photo
    const mappedAs = (kind: string) => mapped.filter((m): m is AreaItem => m.type === "area" && m.kind === kind);
    const inside = (p: P, kind: string) => mappedAs(kind).some(a => pointInPolygon(p, a.points));
    // (the photo's water: where the US maps of water answered, theirs is the water, and the photo's
    // dark patches are tree shadows more often than ponds; a painted court, blue or green, is a court)
    const courts = found.water.map(courtOf).filter((c): c is AreaItem => !!c && !mapped.some(m => m.type === "area" && (m.kind === "water" || m.kind === "field") && pointInPolygon(centroid(c.points), m.points)));
    const photoWater = found.water.filter(a => !courtOf(a));
    const water = (gov?.waterOk ? [] : photoWater).filter(a => !inside(centroid(a.points), "water"));
    const alternates = { photoWater: (gov?.waterOk ? photoWater.filter(a => !inside(centroid(a.points), "water")) : []).map(signed), fema: (gov?.built ?? []).map(signed) };
    if (gov?.waterOk && photoWater.length) notes.push("The water came from the USGS and USFWS maps, not the photo, where tree shadows look like ponds.");
    if (courts.length) notes.push(`${courts.length} ${courts.length === 1 ? "court" : "courts"} found on the photo.`);
    // (and never on a road, a building, parking or in water, as OpenStreetMap or the photo has them)
    const nowhere = treeFree([...mapped, ...found.water]);
    let all: CourseItem[] = [
      ...mapped,
      ...found.woods.filter(a => !inside(centroid(a.points), "woods") && !nowhere(centroid(a.points))),
      ...water,
      ...courts,
      ...found.trees.filter(t => !inside(t, "woods") && !inside(t, "water") && !nowhere(t))
    ];
    // Pools: a small rectangle of the maps' water is a pool (a pond is never a rectangle); a building
    // from FEMA or traced from the air that takes in a pool isn't one (it's the pool's deck)
    const rectish = (a: AreaItem) => { const b = orientedBox(a.points), area = polygonArea(a.points); return area < 15000 && area >= b.a * b.b * 4 * 0.8; };
    all = all.map(i => (i.type === "area" && i.kind === "water" && rectish(i) ? ({ ...createField("pool", i.points), importSource: i.importSource } as AreaItem) : i));
    const pools = all.filter((i): i is AreaItem => i.type === "area" && i.kind === "field" && fieldKindOf(i) === "pool");
    all = all.filter(i => !(i.type === "structure" && i.kind === "building" && (i.importSource === "fema" || i.importSource === "traced") && pools.some(pl => pointInPolygon(centroid(pl.points), i.points))));
    // The maps' buildings fitted to their roofs on the photo (moved and turned a little where it
    // clearly fits better: the photo is what's seen under the course)
    if (background && satellite) {
      const fit = await untilAborted(fittedToPhoto(all, background, width, height), signal).catch(err => { if (signal?.aborted) throw err; console.info("Buildings not fitted to the photo", err); return null; });
      if (fit) {
        all = fit.items;
        if (fit.moved) notes.push(`${fit.moved} ${fit.moved === 1 ? "building" : "buildings"} lined up with their roofs on the photo.`);
      }
    }
    // With trees measured from the air: each on its own, in place of the photo's (the same step as
    // Measure trees and ground on the Site step)
    let standing: number | undefined;
    if (lidar && measured) {
      // The buildings' heights the survey measured (where the maps have none)
      // (a slab or a deck the maps took for a building, left out)
      const set = withoutSlabs(all, measured.lidar.measured);
      all = withMeasuredHeights(set.items, measured.lidar.measured, signed);
      if (set.dropped) notes.push(`${set.dropped} ${set.dropped === 1 ? "building" : "buildings"} on the maps left out: the survey shows flat ground there (a slab, a deck or a pool).`);
      // (the trees a bare survey couldn't pick out, from the summer photo's canopy: after the
      // measured ones, so the list of those stays as it was)
      const summer = "leaf" in found && found.leaf ? treesFromSummer(lidar.trees, measured.lidar.measured, found.leaf, width, height, treeFree(all)) : [];
      if (summer.length) lidar = { ...lidar, trees: [...lidar.trees, ...summer], fromPhoto: summer.length };
      const measuredAll = withMeasuredTrees(all, lidar.trees, findBushes(measured.lidar.measured), p => !nowhere(p));
      all = measuredAll.items;
      if (measuredAll.bushes) notes.push(`${measuredAll.bushes.toLocaleString()} ${measuredAll.bushes === 1 ? "bush" : "bushes"} measured from the air.`);
      // Courts and pools no map has: the photo and the survey together. (Parking lots aren't looked
      // for on the photo: a lot full of cars and bare winter woods can't be told apart reliably
      // without machine learning; the maps' lots come in, and the rest are drawn.)
      if (background && satellite) {
        // Courts on the photo the maps haven't got (blue ones), where none came already
        const found = await untilAborted(courtsFromPhoto(background, width, height, measured.lidar.measured, all), signal).catch(err => { if (signal?.aborted) throw err; console.info("Courts not looked for", err); return [] as AreaItem[]; });
        // (a pool the photo shows where the maps have a little water: that water is the pool, its
        // mapped outline kept)
        const small = (a: AreaItem) => polygonArea(a.points) < 15000;
        for (const pool of found.filter(f => fieldKindOf(f) === "pool")) {
          const c = centroid(pool.points);
          const w = all.find((i): i is AreaItem => i.type === "area" && i.kind === "water" && small(i) && pointInPolygon(c, i.points));
          if (!w) continue;
          all = all.map(i => (i === w ? { ...createField("pool", w.points), importSource: w.importSource } as AreaItem : i));
          found.splice(found.indexOf(pool), 1);
        }
        for (const pool of found.filter(f => fieldKindOf(f) === "pool")) {
          const c = centroid(pool.points);
          if (all.some(i => i.type === "area" && i.kind === "water" && pointInPolygon(c, i.points))) found.splice(found.indexOf(pool), 1);
        }
        if (found.length) {
          all = [...all, ...found];
          const pools = found.filter(f => fieldKindOf(f) === "pool").length;
          const n = found.filter(f => fieldKindOf(f) !== "pool").reduce((s, f) => s + courtCount(fieldKindOf(f), f.points), 0);
          if (n) notes.push(`${n} ${n === 1 ? "court" : "courts"} found on the photo.`);
          if (pools) notes.push(`${pools} ${pools === 1 ? "pool" : "pools"} found on the photo.`);
        }
      }
      const stand = standingTrees(lidar, () => false, treeFree(mapped)).stand, first = lidar.trees.length - summer.length;
      standing = stand.length;
      const fromSummer = stand.filter(k => k >= first).length;
      notes.splice(treesNoteAt, 0, `${(standing - fromSummer).toLocaleString()} trees measured from the air (${measured.lidar.source}).${!fromSummer ? "" : measured.lidar.measured.leafOn === false ? ` The survey was flown in winter, when bare trees standing close together don't show apart, so ${fromSummer.toLocaleString()} more came from the summer photo.` : ` ${fromSummer.toLocaleString()} more came from the summer photo, where the survey didn't pick them out.`}`);
    }
    const photo = (type: string, kind?: string) => all.filter(i => (i as TreeItem | AreaItem).importSource === "photo" && i.type === type && (!kind || (i as AreaItem).kind === kind)).length;
    const counted = [[photo("area", "woods"), "wooded area", "wooded areas"], [photo("tree"), "tree", "trees"], [photo("area", "water"), "water area", "water areas"]] as const;
    const said = counted.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    if (said.length) notes.push(`On the photo: ${said.join(", ")}.`);
    // Where brush grows: the chance of it in each 10 ft block, from the survey and the satellite's
    // seasons (the areas themselves made as the import's How much and How thick ask)
    const m = measured?.lidar.measured;
    await breath(signal);
    const underbrush = underbrushChance(width, height, measured?.lidar.undergrowth ?? null, seasons, {
      areas: all.filter((i): i is AreaItem => i.type === "area" && i.kind === "water").map(i => i.points),
      lines: all.filter(i => i.type === "line" && i.kind === "stream").map(i => (i as { points: P[] }).points)
    }, treeFree(all), m ? { nx: m.nx, ny: m.ny, cell: m.cell, roofs: m.roofs } : undefined);
    if (underbrush) {
      underbrush.surveyYear = measured ? surveyYear(measured.lidar.source) || undefined : undefined;
      underbrush.seenFrom = seasons?.dates.length ? `${seasons.dates[0].slice(0, 4)}${seasons.dates[seasons.dates.length - 1].slice(0, 4) !== seasons.dates[0].slice(0, 4) ? `-${seasons.dates[seasons.dates.length - 1].slice(2, 4)}` : ""}` : undefined;
    }
    all = all.map(signed);
    const trees = all.filter((i): i is TreeItem => i.type === "tree");
    mapped = all.filter(i => i.type !== "tree");
    progress.close();

    return {
      canvas: { width, height },
      gridSize: grid,
      terrainHeights,
      background,
      site: {
        location,
        bounds,
        baseElevationFt: Math.round(baseFt * 10) / 10,
        imagerySource: map?.sourceLabel,
        ...(map?.photo ? { photo: { id: map.photo.id, date: map.photo.date, dateTo: map.photo.dateTo, season: map.photo.season, metersPerPx: Math.round(map.metersPerPx * 1000) / 1000, credit: map.credit } } : {}),
        elevationSource,
        // (OpenStreetMap out of reach: said in a toast of its own now, and kept here with the rest)
        notes: osmFailed ? [...notes, OSM_UNREACHABLE] : notes,
        // (what went wrong, for the Site step to say while it still holds)
        ...(noLidar ? { noLidar } : {}),
        ...(lidarFailed ? { lidarFailed } : {}),
        ...(osmFailed ? { osmFailed } : {}),
        ...(map?.partial ? { tilesMissing: true } : {})
      },
      trees,
      mapped,
      notes,
      osmFailed,
      lidar,
      standing,
      alternates,
      underbrush: underbrush ?? undefined,
      course,
      sources: progress.sources
    };
  } finally {
    progress.close();
  }
};
