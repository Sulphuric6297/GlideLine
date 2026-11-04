// Painting areas with the brush: a stroke (its outline, lib/brush strokeOutline) added to an area
// of a kind or cut out of the areas of that kind, or, for kinds with levels (underbrush: light,
// medium, heavy; woods: sparse, usual, thick), each spot under it stepped a level thinner or
// thicker, or put back as the import found it. The shapes are joined and cut exactly (corners the
// stroke didn't reach stay where they were); a cut right across an area makes two, each keeping
// its settings; a hole cut inside one is joined to its edge by a seam, as areas have one outline.
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import type { AreaItem, CourseItem, P } from "../types";
import { generateId } from "../constants";
import { boundsOf, centroid, pointInPolygon, polygonArea } from "./geom";
import { brushOnly } from "./brushSpots";

export type BrushMode = "add" | "remove" | "thinner" | "thicker" | "restore";
/** What a stroke changes: areas changed, made and taken away. */
export type BrushEdit = { update: AreaItem[]; add: AreaItem[]; remove: string[] };

/** The kind a stroke paints: an area kind, and for woods whether it's underbrush (bushes only). */
export type BrushKind = { kind: AreaItem["kind"]; brush: boolean };
export const kindOf = (a: AreaItem): BrushKind => ({ kind: a.kind, brush: a.kind === "woods" && brushOnly(a) });
const isKind = (a: AreaItem, k: BrushKind) => a.kind === k.kind && (k.kind !== "woods" || brushOnly(a) === k.brush);
/** Whether a kind has levels to step: underbrush and woods. */
export const hasLevels = (k: BrushKind) => k.kind === "woods";

// ---------------------------------------------------------------- shapes

const ring = (pts: P[]): Ring => { const r = pts.map(p => [p.x, p.y] as [number, number]); r.push([pts[0].x, pts[0].y]); return r; };
const asPoly = (pts: P[]): Polygon => [ring(pts)];
const pts = (r: Ring): P[] => r.slice(0, -1).map(([x, y]) => ({ x, y }));
const size = (poly: Polygon) => Math.abs(polygonArea(pts(poly[0]))) - poly.slice(1).reduce((s, h) => s + Math.abs(polygonArea(pts(h))), 0);

/** A polygon as one outline: each hole joined to the outline by a seam from its nearest corner. */
export const outlineOf = (poly: Polygon): P[] => {
  let out = pts(poly[0]);
  for (const hole of poly.slice(1)) {
    const h = pts(hole);
    let best = { i: 0, j: 0, d: Infinity };
    for (let i = 0; i < out.length; i++) for (let j = 0; j < h.length; j++) {
      const d = (out[i].x - h[j].x) ** 2 + (out[i].y - h[j].y) ** 2;
      if (d < best.d) best = { i, j, d };
    }
    const round = [...h.slice(best.j), ...h.slice(0, best.j), h[best.j]];
    out = [...out.slice(0, best.i + 1), ...round, ...out.slice(best.i)];
  }
  return out;
};
/** Pieces too small to keep (a speck left by a stroke's edge), sq ft. */
const SPECK = 30;
const pieces = (mp: MultiPolygon) => mp.filter(p => size(p) >= SPECK).sort((a, b) => size(b) - size(a));

const withShape = (a: AreaItem, poly: Polygon): AreaItem => { const points = outlineOf(poly); return { ...a, points, ...centroid(points) }; };
const copyWith = (a: AreaItem, poly: Polygon): AreaItem => ({ ...withShape(a, poly), id: generateId() });
const boxOf = (p: P[]) => boundsOf(p);
const overlaps = (a: P[], b: P[]) => { const A = boxOf(a), B = boxOf(b); return A.minX <= B.maxX && A.maxX >= B.minX && A.minY <= B.maxY && A.maxY >= B.minY; };

/** Settings that make two areas the same but for their shape (so a stroke may join them). */
const settings = (a: AreaItem) => { const { id: _i, points: _p, x: _x, y: _y, ...rest } = a as AreaItem & { x: number; y: number }; return JSON.stringify(rest); };

// ---------------------------------------------------------------- levels

/** Underbrush's level (1 light, 2 medium, 3 heavy), or a wood's (1 sparse, 2 usual, 3 thick). */
export const levelOf = (a: AreaItem) => ((a.density ?? 1) < 0.75 ? 1 : (a.density ?? 1) > 1.4 ? 3 : 2);
const densityOf = (lv: number) => (lv === 1 ? 0.5 : lv === 3 ? 2 : undefined);

// ---------------------------------------------------------------- a stroke

/**
 * What a stroke does to the areas. `stroke`: its outline; `start`: where it began (an Add from
 * inside an area grows that area; from open ground it's a new one, which the caller draws, as
 * Paint does: null back); `picked`: the area picked, the only one changed; `found`: what the
 * import found, for Restore (underbrush, as areas by level).
 */
export const brushStroke = (items: CourseItem[], k: BrushKind, mode: BrushMode, stroke: P[], start: P, picked: string | null = null, found: AreaItem[] = []): BrushEdit | null => {
  if (stroke.length < 3) return null;
  let S: MultiPolygon = [asPoly(stroke)];
  const all = items.filter((i): i is AreaItem => i.type === "area" && !i.locked && i.points.length >= 3 && isKind(i, k));
  const pick = picked ? all.find(a => a.id === picked) ?? null : null;
  if (picked && !pick) return null;
  // (with one picked, the stroke reaches only into it, but for an Add, which grows it)
  if (pick && mode !== "add") S = polygonClipping.intersection(S, asPoly(pick.points));
  if (!S.length) return null;
  const sPts = S.flatMap(p => pts(p[0]));
  const near = (pick ? [pick] : all).filter(a => overlaps(a.points, sPts));
  const edit: BrushEdit = { update: [], add: [], remove: [] };

  if (mode === "add") {
    const host = pick ?? near.filter(a => pointInPolygon(start, a.points)).sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)))[0];
    if (!host) return null;
    // (joined with the others of the same kind and settings that it now touches)
    let shape = polygonClipping.union(asPoly(host.points), ...S);
    const same = settings(host);
    for (const o of all) {
      if (o.id === host.id || settings(o) !== same || !overlaps(o.points, shape.flatMap(p => pts(p[0])))) continue;
      const joined = polygonClipping.union(shape, asPoly(o.points));
      if (joined.length < shape.length + 1) { shape = joined; edit.remove.push(o.id); }
    }
    const [first, ...rest] = pieces(shape);
    if (!first) return null;
    edit.update.push(withShape(host, first));
    rest.forEach(p => edit.add.push(copyWith(host, p)));
    return edit;
  }

  if (mode === "remove") {
    for (const a of near) {
      const left = pieces(polygonClipping.difference(asPoly(a.points), ...S));
      if (!left.length) { edit.remove.push(a.id); continue; }
      if (left.length === 1 && left[0].length === 1 && pts(left[0][0]).length === a.points.length && Math.abs(size(left[0]) - Math.abs(polygonArea(a.points))) < 0.01) continue;
      edit.update.push(withShape(a, left[0]));
      left.slice(1).forEach(p => edit.add.push(copyWith(a, p)));
    }
    return edit.update.length || edit.add.length || edit.remove.length ? edit : null;
  }

  if (!hasLevels(k)) return null;
  if (k.brush) {
    // Underbrush: light holds medium, medium holds heavy (nested, as the import makes it). Under
    // the stroke each level becomes what the one above (thinner), the one below (thicker) or the
    // import (restore) had there; elsewhere it stays as it is
    const at = (lv: number, from: AreaItem[]) => from.filter(a => levelOf(a) === lv);
    // (every level there, the picked patch's too: the stroke is already kept to the picked one)
    const near = all.filter(a => overlaps(a.points, sPts));
    const union = (as: AreaItem[]): MultiPolygon => (as.length ? polygonClipping.union(asPoly(as[0].points), ...as.slice(1).map(a => asPoly(a.points))) : []);
    const now = [0, 1, 2, 3].map(lv => (lv === 0 ? S : union(at(lv, near))));
    const before = [0, 1, 2, 3].map(lv => (lv === 0 ? S : union(at(lv, found.filter(f => overlaps(f.points, sPts))))));
    const inside = (lv: number): MultiPolygon => {
      if (mode === "thinner") return lv < 3 && now[lv + 1].length ? polygonClipping.intersection(now[lv + 1], S) : [];
      if (mode === "thicker") return now[lv - 1].length ? polygonClipping.intersection(now[lv - 1], S) : [];
      return before[lv].length ? polygonClipping.intersection(before[lv], S) : [];
    };
    const template = (lv: number): AreaItem => {
      const own = at(lv, near)[0] ?? at(lv, all)[0] ?? near[0] ?? all[0] ?? found[0];
      return { ...(own ?? ({ type: "area", kind: "woods", bushes: 1, importSource: "lidar" } as AreaItem)), density: densityOf(lv) } as AreaItem;
    };
    for (const lv of [1, 2, 3]) {
      const mine = at(lv, near);
      const outside = now[lv].length ? polygonClipping.difference(now[lv], ...S) : [];
      const inn = inside(lv);
      const shape = outside.length && inn.length ? polygonClipping.union(outside, ...inn) : outside.length ? outside : inn;
      const parts = pieces(shape);
      // (the level's own areas reshaped, in order; more pieces than areas: new ones; fewer: the rest go)
      mine.sort((a, b) => Math.abs(polygonArea(b.points)) - Math.abs(polygonArea(a.points)));
      parts.forEach((p, i) => (mine[i] ? edit.update.push(withShape(mine[i], p)) : edit.add.push(copyWith(mine[0] ?? template(lv), p))));
      mine.slice(parts.length).forEach(a => edit.remove.push(a.id));
    }
    return edit.update.length || edit.add.length || edit.remove.length ? edit : null;
  }

  // Woods: the part under the stroke split off, a step sparser or thicker (none past sparse or thick)
  if (mode === "restore") return null;
  for (const a of near) {
    const lv = levelOf(a), to = mode === "thinner" ? lv - 1 : lv + 1;
    if (to < 1 || to > 3) continue;
    const inn = pieces(polygonClipping.intersection(asPoly(a.points), ...S));
    if (!inn.length) continue;
    const out = pieces(polygonClipping.difference(asPoly(a.points), ...S));
    if (out.length) { edit.update.push(withShape(a, out[0])); out.slice(1).forEach(p => edit.add.push(copyWith(a, p))); }
    else edit.remove.push(a.id);
    const stepped = { ...a, density: densityOf(to) };
    inn.forEach(p => edit.add.push(copyWith(stepped, p)));
  }
  return edit.update.length || edit.add.length || edit.remove.length ? edit : null;
};

/** The items with a stroke's changes made. */
export const applyEdit = (items: CourseItem[], e: BrushEdit): CourseItem[] => {
  const gone = new Set(e.remove), by = new Map(e.update.map(a => [a.id, a]));
  return [...items.filter(i => !gone.has(i.id)).map(i => by.get(i.id) ?? i), ...e.add];
};
