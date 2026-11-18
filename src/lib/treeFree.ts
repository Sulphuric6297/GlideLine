// Where a tree can never stand: in water, on a building, parking or anything built (its outline,
// or along a bridge or boardwalk), on a road, path, creek or walk, on a ball field or a court.
import { LINE_KINDS, STRUCTURE_KINDS } from "../constants";
import type { CourseItem, P } from "../types";
import { distanceToPath, pointInPolygon } from "./geom";
import { widthFactors } from "./course";
import { fieldKindOf, treelessField } from "./fields";

/** Whether this thing is somewhere no tree stands. */
export const keepsTreesOut = (it: CourseItem) =>
  (it.type === "area" && (["water", "parking", "building"].includes(it.kind) || (it.kind === "field" && treelessField(fieldKindOf(it))))) ||
  (it.type === "line" && ["road", "path", "walk", "stream", "wall"].includes(it.kind)) ||
  it.type === "structure";

/** A test: is a spot where no tree could stand, among these things? */
export const treeFree = (items: CourseItem[]) => {
  const polys: P[][] = [], lines: { pts: P[]; half: number }[] = [];
  for (const it of items) {
    if (!keepsTreesOut(it)) continue;
    if (it.type === "area") polys.push(it.points);
    else if (it.type === "line") lines.push({ pts: it.points, half: ((it.width ?? LINE_KINDS[it.kind].width) * Math.max(...widthFactors(it))) / 2 });
    else if (it.type === "structure") {
      if (STRUCTURE_KINDS[it.kind].shape === "outline") polys.push(it.points);
      else lines.push({ pts: it.points, half: (it.width ?? 6) / 2 + 2 });
    }
  }
  return (p: P) => polys.some(pts => pts.length >= 3 && pointInPolygon(p, pts)) || lines.some(l => l.pts.length > 1 && distanceToPath(p, l.pts) < l.half);
};
