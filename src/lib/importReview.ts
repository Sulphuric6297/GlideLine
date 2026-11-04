// Looking before it comes in: what an import found, by where it came from, each source switched on
// or off, and which source wins where two have the same building. Pure: the import dialog shows
// it on the map and brings in what's on.
import type { CourseItem, P } from "../types";
import type { ImportedSite } from "./importSite";
import { centroid, pointInPolygon } from "./geom";
import { signed } from "./importSite";
import { BEST_GUESS, brushAreas, brushLevels, keepFound, type BrushTune } from "./undergrowth";

export type SourceKey =
  | "lidarTrees" | "summerTrees" | "photoTrees" | "bushes" | "underbrush" | "osmTrees"
  | "osmBuildings" | "femaBuildings" | "tracedBuildings" | "lidarBuildings"
  | "osmWater" | "govWater" | "photoWater"
  | "foundParking" | "osmParking" | "courts"
  | "osmPaths" | "osmOther";

export type SourceGroup = "trees" | "buildings" | "water" | "parking" | "paths" | "other";

/** Each source: its group, what to call it and where it's from, its color on the map. */
export const SOURCES: Record<SourceKey, { group: SourceGroup; label: string; who?: string; color: string }> = {
  lidarTrees: { group: "trees", label: "Measured", who: "LiDAR", color: "#4ade80" },
  summerTrees: { group: "trees", label: "From the photo", who: "the survey's gaps", color: "#bef264" },
  photoTrees: { group: "trees", label: "From the photo", color: "#bef264" },
  bushes: { group: "trees", label: "Bushes", who: "LiDAR", color: "#6ee7b7" },
  underbrush: { group: "trees", label: "Underbrush", who: "survey and satellite", color: "#f59e0b" },
  osmTrees: { group: "trees", label: "OpenStreetMap", color: "#86efac" },
  femaBuildings: { group: "buildings", label: "FEMA", who: "checked by hand", color: "#facc15" },
  osmBuildings: { group: "buildings", label: "OpenStreetMap", color: "#ffffff" },
  tracedBuildings: { group: "buildings", label: "Traced from the air", color: "#a78bfa" },
  lidarBuildings: { group: "buildings", label: "Measured from the air", who: "LiDAR, no map has them", color: "#34d399" },
  osmWater: { group: "water", label: "OpenStreetMap", color: "#3b82f6" },
  govWater: { group: "water", label: "USGS and USFWS", color: "#22d3ee" },
  photoWater: { group: "water", label: "From the photo", color: "#f472b6" },
  foundParking: { group: "parking", label: "Found on the photo", color: "#d4d4d8" },
  osmParking: { group: "parking", label: "Parking from OpenStreetMap", color: "#a1a1aa" },
  courts: { group: "parking", label: "Courts found on the photo", color: "#fb923c" },
  osmPaths: { group: "paths", label: "OpenStreetMap", color: "#e5e7eb" },
  osmOther: { group: "other", label: "OpenStreetMap", who: "fields, benches and more", color: "#fdba74" }
};

export const GROUPS: { id: SourceGroup; label: string }[] = [
  { id: "trees", label: "Trees and bushes" },
  { id: "buildings", label: "Buildings" },
  { id: "water", label: "Water" },
  { id: "parking", label: "Parking, fields and courts" },
  { id: "paths", label: "Paths and roads" },
  { id: "other", label: "Everything else" }
];

const isBuilding = (i: CourseItem) => i.type === "structure" && (i.kind === "building" || i.kind === "shelter");
const wet = (i: CourseItem) => i.type === "area" && (i.kind === "water" || i.kind === "rough") || (i.type === "line" && i.kind === "stream");

/** Where one thing came from (null: not from a source the review shows). */
export const sourceOf = (i: CourseItem): SourceKey | null => {
  const src = (i as { importSource?: string }).importSource;
  if (!src) return null;
  if (i.type === "tree") return src === "lidar" ? "bushes" : src === "photo" ? "photoTrees" : "osmTrees";
  if (i.type === "area" && i.kind === "woods" && src === "lidar" && (i.bushes ?? 0) >= 1) return "underbrush";
  if (isBuilding(i)) return src === "fema" ? "femaBuildings" : src === "traced" ? "tracedBuildings" : src === "lidar" ? "lidarBuildings" : "osmBuildings";
  if (src === "usgs" || src === "nwi") return "govWater";
  if (i.type === "area" && i.kind === "field" && src === "photo") return "courts";
  if (i.type === "area" && i.kind === "parking") return src === "photo" ? "foundParking" : "osmParking";
  if (src === "photo") return i.type === "area" && i.kind === "water" ? "photoWater" : "photoTrees";
  if (src === "osm") {
    if (wet(i)) return "osmWater";
    if (i.type === "line" && (i.kind === "path" || i.kind === "road" || i.kind === "walk")) return "osmPaths";
    return "osmOther";
  }
  return null;
};

/** Each source's count in what was found (the measured trees by the survey's own list). */
export const sourceCounts = (site: ImportedSite) => {
  const n: Partial<Record<SourceKey, number>> = {};
  const add = (k: SourceKey | null, c = 1) => { if (k) n[k] = (n[k] ?? 0) + c; };
  for (const i of [...site.mapped, ...site.trees]) add(sourceOf(i));
  const lidar = site.lidar, summer = lidar?.fromPhoto ?? 0;
  if (lidar) { add("lidarTrees", lidar.trees.length - summer); if (summer) add("summerTrees", summer); }
  add("photoWater", site.alternates?.photoWater?.length ?? 0);
  // (the brush: its row says how many acres, as tuned)
  if (site.underbrush) add("underbrush");
  return n;
};

/** Whether a source starts on: all but the photo's water where the government's maps of water
 * came (most of the photo's dark patches are tree shadows there). */
export const startsOn = (k: SourceKey, site: ImportedSite) => !(k === "photoWater" && (site.alternates?.photoWater?.length ?? 0) > 0);

const overlaps = (a: P[], b: P[]) => pointInPolygon(centroid(a), b) || pointInPolygon(centroid(b), a);

/** The site with only what's on, and where FEMA and OpenStreetMap have the same building, the one
 * asked for. */
export const reviewedSite = (site: ImportedSite, on: Partial<Record<SourceKey, boolean>>, keep: "osm" | "fema" = "osm", tune: BrushTune = BEST_GUESS): ImportedSite => {
  const yes = (k: SourceKey | null) => !k || on[k] !== false;
  let mapped = site.mapped.filter(i => yes(sourceOf(i)));
  const trees = site.trees.filter(i => yes(sourceOf(i)));
  // FEMA's where both have it: OpenStreetMap's that overlap one of FEMA's give way to it
  if (keep === "fema" && on.femaBuildings !== false) {
    const fema = (site.alternates?.fema ?? []).filter(isBuilding) as (CourseItem & { points: P[] })[];
    const osm = mapped.filter(i => isBuilding(i) && sourceOf(i) === "osmBuildings") as (CourseItem & { points: P[] })[];
    const out = new Set<string>(), add: CourseItem[] = [];
    for (const f of fema) {
      const twins = osm.filter(o => overlaps(o.points, f.points));
      if (!twins.length) continue;
      twins.forEach(t => out.add(t.id));
      if (!mapped.some(m => m.id === f.id)) add.push(f);
    }
    mapped = [...mapped.filter(i => !out.has(i.id)), ...add];
  }
  // The photo's water, where it was left out and is wanted
  if (on.photoWater && site.alternates?.photoWater?.length) mapped = [...mapped, ...site.alternates.photoWater];
  // The measured trees: none, or without the ones filled in from the summer photo
  let lidar = site.lidar;
  if (lidar && on.lidarTrees === false) lidar = undefined;
  else if (lidar?.fromPhoto && on.summerTrees === false) {
    const { fromPhoto, ...rest } = lidar;
    lidar = { ...rest, trees: lidar.trees.slice(0, lidar.trees.length - fromPhoto) };
  }
  // The brush, as tuned (and the tuning kept with the course, for the next time it comes in)
  const u = site.underbrush;
  const lv = u && on.underbrush !== false ? brushLevels(u, tune) : null;
  if (u && lv) mapped = [...mapped, ...brushAreas(lv, u.bx, u.by).map(signed)];
  return { ...site, site: u ? { ...site.site, brushTune: { much: tune.much, thick: tune.thick }, ...(lv ? { brushFound: keepFound(lv, u.bx, u.by) } : {}) } : site.site, mapped, trees, lidar };
};

/** How many FEMA buildings OpenStreetMap has too (the choice of which to keep matters only then). */
export const sharedBuildings = (site: ImportedSite) => {
  const fema = (site.alternates?.fema ?? []).filter(isBuilding) as (CourseItem & { points: P[] })[];
  const osm = site.mapped.filter(i => isBuilding(i) && sourceOf(i) === "osmBuildings") as (CourseItem & { points: P[] })[];
  return fema.filter(f => osm.some(o => overlaps(o.points, f.points))).length;
};

