// The printed course map, as SVG: the land (photo or a drawn style), hill shading and contours,
// woods and trees, water, paths and roads, OB and hazards, then the holes (fairways, throw lines,
// tees, baskets, mandos, drop zones, distances), labels, and the frame (title, legend, hole table,
// north arrow, scale bar). The same renderer draws a single hole for tee signs, turned so the tee
// is at the bottom.
import { brushOnly } from "./brushSpots";
import { extrasSvg, keepsItsSize, keepsItsTurn, turned } from "./pieces";
import { fitAttr } from "./fitText";
import { SCRIPT_FONTS } from "./fontKinds";
import { GOV_CREDITS } from "./geo/usgov";
import { latitudeOf, sunFromOf } from "./mapLook";
import { AMENITY_KINDS, AREA_KINDS, CIRCLE_ONE_FT, FIELD_KINDS, FT_PER_M, LINE_KINDS, STRUCTURE_KINDS, STRUCTURE_ORDER, TEE_LEVELS, TEE_ORDER } from "../constants";
import type { AmenityItem, AreaItem, BasketItem, CourseDoc, DropZoneItem, LabelItem, LineItem, MandoItem, MapStyle, MapTheme, P, PageElementId, PageElementStyle, PaperSize, StructureItem, StructureKind, TeeItem, TreeItem } from "../types";
import { activeLayout, areaObEdges, beyondSides, drawnAreas, fairwayOutline, holeBaskets, linePath, obFor, obPicked, obRanges, sharedWalks, teeAim, walkRoutes, taglineOf, titleFontOf } from "./course";
import { boundsOf, dist, offsetPath, pathLength, pointAlong, pointInPolygon, polygonArea, rectCorners, rotatePoint, smoothPath, subPath } from "./geom";
import { courseTotals, holeStats, isOb, isOutOfPlay, playsOf, type HoleStats } from "./holeStats";
import { forestCanvas, forestCanvasAsync, paintedFrom, paintedLine, paintsAgain, paintsFromPhoto, treesOverOf, type CanopyGrid } from "./forest";
import { BASKET_MARKS, RESTRICTED, STRUCTURE_INK, amenitySymbol, basketMark, dropZoneSymbol, gateSymbol, mandoSymbol, structureLegend, structureSymbol, type StructureDraw, type StructureInk } from "./symbols";
import { isLineKind, structureHeight, structurePath, structureRoof, structureWidth } from "./structures";
import { chainContours, type Contours } from "./relief";
import { fmtDist } from "./units";
import { tallGrassOf } from "./landscapes";
import { fieldInks, fieldLegend, fieldPlan, fieldSvg } from "./fieldPlan";
// (the tests' measure of what a style change changes: loaded with the map's painter)
import "./paintProbe";
import { FIELD_ORDER, fieldKindOf } from "./fields";

export const PAPER: Record<PaperSize, { label: string; w: number; h: number }> = {
  letter: { label: "Letter, 8.5 × 11 in", w: 8.5, h: 11 },
  tabloid: { label: "Tabloid, 11 × 17 in", w: 11, h: 17 },
  "18x24": { label: "Poster, 18 × 24 in", w: 18, h: 24 },
  "24x36": { label: "Poster, 24 × 36 in", w: 24, h: 36 },
  "36x48": { label: "Poster, 36 × 48 in", w: 36, h: 48 },
  a4: { label: "A4, 210 × 297 mm", w: 8.27, h: 11.69 },
  a3: { label: "A3, 297 × 420 mm", w: 11.69, h: 16.54 }
};

/** The hole guide's and legend's panel on the course map, unless colored by hand. */
export const PAGE_PANEL = { bg: "#080e07", opacity: 0.78, ink: "#f4f7ef" };

export const THEMES: Record<MapTheme, { label: string; blurb: string }> = {
  forest: { label: "Forest", blurb: "Lush painted woods with the fairways cut through, like hand-made course maps." },
  illustrated: { label: "Illustrated", blurb: "Painted park map: drawn grass, trees with shadows, hill shading." },
  satellite: { label: "Satellite", blurb: "The aerial photo with the course drawn over it." },
  topo: { label: "Topographic", blurb: "Contours and relief on a cream map, like a trail map." },
  minimal: { label: "Minimal", blurb: "Clean and printer-friendly, little ink." },
  night: { label: "Night", blurb: "Dark background with bright lines, for screens." }
};

/** What each theme shows by default: the forest look is a clean picture (no lines, legend or
 * table); the others are working maps. */
export const THEME_SHOWS: Record<MapTheme, Partial<MapStyle>> = {
  forest: { throwLines: false, distances: false, circle: false, legend: false, holeTable: false, contours: false, hillshade: true, font: "Script", basketMark: "basket" },
  illustrated: { throwLines: true, distances: true, circle: true, legend: true, holeTable: true, contours: true, hillshade: true, font: "Oswald", basketMark: "badge" },
  satellite: { throwLines: true, distances: true, circle: true, legend: true, holeTable: true, contours: false, hillshade: false, font: "Oswald", basketMark: "badge" },
  topo: { throwLines: true, distances: true, circle: true, legend: true, holeTable: true, contours: true, hillshade: true, font: "Bitter", basketMark: "target" },
  minimal: { throwLines: true, distances: true, circle: true, legend: true, holeTable: true, contours: true, hillshade: false, font: "Inter", basketMark: "target" },
  night: { throwLines: true, distances: true, circle: true, legend: true, holeTable: true, contours: true, hillshade: true, font: "Oswald", basketMark: "target" }
};

/** Theme presets: picking a theme sets these colors (they can be changed afterwards). */
export const THEME_COLORS: Record<MapTheme, Partial<MapStyle>> = {
  forest: { fairway: "#6f9255", rough: "#4d6a3c", trees: "#354a2c", water: "#23677f", path: "#6e5b38", ob: "#e0483d", hazard: "#e8c547", basket: "#ffffff" },
  illustrated: { fairway: "#a7dc7b", rough: "#5f9447", trees: "#2d6a35", water: "#4aa3e6", path: "#e2c08d", ob: "#e5383b", hazard: "#f2c230", basket: "#f2c94c" },
  satellite: { fairway: "#b5f08a", rough: "#4f7a3a", trees: "#1f4d29", water: "#3d9be9", path: "#f1d6a6", ob: "#ff3b3b", hazard: "#ffd23f", basket: "#ffd84d" },
  topo: { fairway: "#cfe7a8", rough: "#efe9d2", trees: "#9cc58a", water: "#8cc7ef", path: "#b0703a", ob: "#d62828", hazard: "#e09f1f", basket: "#f4b41a" },
  minimal: { fairway: "#e6eedb", rough: "#ffffff", trees: "#c9d6c0", water: "#d6e8f5", path: "#b9b4ac", ob: "#d62828", hazard: "#d9a400", basket: "#222222" },
  night: { fairway: "#2f6b3a", rough: "#16211b", trees: "#0f3a1e", water: "#1d4f7a", path: "#8a7552", ob: "#ff4d6d", hazard: "#ffd166", basket: "#ffd166" }
};

type Palette = {
  bg: string; grass: string; contour: string; contourMajor: string; ink: string; inkSoft: string; paper: string; panel: string; panelInk: string;
  line: string; lineCasing: string; label: string; labelHalo: string; road: string; building: string; parking: string; grain: number; treeShadow: number;
};

export const palette = (s: MapStyle): Palette => {
  switch (s.theme) {
    case "satellite": return { bg: "#26351f", grass: s.rough, contour: "rgba(255,255,255,.35)", contourMajor: "rgba(255,255,255,.6)", ink: "#111827", inkSoft: "#4b5563", paper: "#f8f6f0", panel: "#ffffff", panelInk: "#111827", line: "#ffffff", lineCasing: "rgba(0,0,0,.55)", label: "#ffffff", labelHalo: "rgba(0,0,0,.75)", road: "#8b8d90", building: "#c8bfb0", parking: "#7d8086", grain: 0, treeShadow: 0.0 };
    case "topo": return { bg: s.rough, grass: s.rough, contour: "#c2915a", contourMajor: "#a0672e", ink: "#2b2118", inkSoft: "#6b5a47", paper: "#fbf7ea", panel: "#fffdf5", panelInk: "#2b2118", line: "#2b2118", lineCasing: "rgba(255,253,245,.9)", label: "#2b2118", labelHalo: "rgba(255,253,245,.9)", road: "#c94f3d", building: "#a39a8c", parking: "#d5d0c4", grain: 0, treeShadow: 0.12 };
    case "minimal": return { bg: "#ffffff", grass: "#ffffff", contour: "#dedede", contourMajor: "#c4c4c4", ink: "#111111", inkSoft: "#666666", paper: "#ffffff", panel: "#ffffff", panelInk: "#111111", line: "#111111", lineCasing: "rgba(255,255,255,.95)", label: "#111111", labelHalo: "rgba(255,255,255,.95)", road: "#bdbdbd", building: "#d9d9d9", parking: "#ececec", grain: 0, treeShadow: 0 };
    case "forest": return { bg: s.rough, grass: s.rough, contour: "rgba(20,40,10,.25)", contourMajor: "rgba(20,40,10,.4)", ink: "#f4f7ef", inkSoft: "#c5d3bd", paper: "#0f1a0e", panel: "rgba(8,14,7,.78)", panelInk: "#f4f7ef", line: "#ffffff", lineCasing: "rgba(0,0,0,.45)", label: "#ffffff", labelHalo: "rgba(10,25,6,.85)", road: "#cfd1cc", building: "#d9d2c3", parking: "#b9bab4", grain: 0.06, treeShadow: 0.35 };
    case "night": return { bg: s.rough, grass: s.rough, contour: "rgba(160,220,180,.18)", contourMajor: "rgba(160,220,180,.35)", ink: "#e5f2ea", inkSoft: "#93a99c", paper: "#0d1511", panel: "#121d17", panelInk: "#e5f2ea", line: "#f8fafc", lineCasing: "rgba(0,0,0,.6)", label: "#f1f5f9", labelHalo: "rgba(0,0,0,.8)", road: "#3a4048", building: "#2d3a33", parking: "#28302c", grain: 0.04, treeShadow: 0.3 };
    default: return { bg: s.rough, grass: s.rough, contour: "rgba(30,60,20,.28)", contourMajor: "rgba(30,60,20,.45)", ink: "#1f2a1c", inkSoft: "#566451", paper: "#f6f3e7", panel: "#fffdf6", panelInk: "#1f2a1c", line: "#ffffff", lineCasing: "rgba(25,45,20,.65)", label: "#ffffff", labelHalo: "rgba(20,35,15,.85)", road: "#9c9a92", building: "#e8dcc4", parking: "#bab6ab", grain: 0.07, treeShadow: 0.32 };
  }
};

/** How built things are colored in each style (weathered wood, stone, roofs). */
export const structureInk = (theme: MapTheme): StructureInk => {
  switch (theme) {
    case "forest": return { ...STRUCTURE_INK, casing: "#1d160f", deck: "#c4a77c", seam: "#7f6345", rail: "#4f3a28", stone: "#aaa293", roof: "#8f6a52", shelter: "#5f7a5b", ridge: "#eadfca", shadow: "#060b04" };
    case "night": return { ...STRUCTURE_INK, casing: "#05070a", deck: "#8a7558", seam: "#5a4835", rail: "#3a2c20", stone: "#6e6a62", joint: "#3e3b36", roof: "#6b5243", shelter: "#3f5a46", ridge: "#b8ad98", shadow: "#000000" };
    case "minimal": return { ...STRUCTURE_INK, casing: "#3a3a3a", deck: "#ddd6ca", seam: "#aaa196", rail: "#7a7268", stone: "#d4cfc6", joint: "#9a958c", roof: "#c4bcb0", shelter: "#c3cbbd", ridge: "#ffffff", shadow: "#000000" };
    case "topo": return { ...STRUCTURE_INK, casing: "#2b2118", deck: "#d7bd92", seam: "#9a7a52", rail: "#5c4430", stone: "#c4b9a5", joint: "#7a6c58", roof: "#a3694b", shelter: "#6f8a62", ridge: "#fbf3e2", shadow: "#2b2118" };
    default: return STRUCTURE_INK;
  }
};
/** Drop shadows under built things (the Forest painting casts its own). */
const STRUCTURE_SHADOW: Record<MapTheme, number> = { forest: 0.35, illustrated: 0.32, satellite: 0.3, topo: 0.16, minimal: 0.1, night: 0.4 };

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const pts = (p: P[]) => p.map(q => `${n(q.x)},${n(q.y)}`).join(" ");
const pathD = (p: P[], closed = false) => p.map((q, i) => `${i ? "L" : "M"}${n(q.x)} ${n(q.y)}`).join("") + (closed ? "Z" : "");

/** How the map is placed: the plan point at the middle, the turn (degrees, the tee-to-basket
 * direction is "up" for tee signs) and pixels per foot, into a box of the given size. */
export type MapView = { cx: number; cy: number; rotation: number; scale: number; width: number; height: number };

/** Whether a plan point lands inside a map drawn with this view. */
export const inView = (view: MapView, p: P) => {
  const v = rotatePoint({ x: p.x - view.cx, y: p.y - view.cy }, -view.rotation);
  const x = view.width / 2 + v.x * view.scale, y = view.height / 2 + v.y * view.scale;
  return x >= 0 && y >= 0 && x <= view.width && y <= view.height;
};

/** The markings a map with this view shows, for its key: red OB, hazards, mandos and drop zones. */
export const markingsInView = (doc: Pick<CourseDoc, "items">, view: MapView) => {
  const middle = { x: view.cx, y: view.cy };
  const shows = (i: CourseDoc["items"][number]) => {
    if (i.type === "area") return i.points.some(p => inView(view, p)) || pointInPolygon(middle, i.points);
    if (i.type === "line") return i.points.some((p, k) => inView(view, p) || (k > 0 && inView(view, { x: (p.x + i.points[k - 1].x) / 2, y: (p.y + i.points[k - 1].y) / 2 })));
    return inView(view, i);
  };
  const shown = doc.items.filter(shows);
  return {
    ob: shown.some(i => (i.type === "area" || i.type === "line") && (i.kind === "ob" || i.ob === true)),
    hazard: shown.some(i => (i.type === "area" && i.kind === "hazard") || ((i.type === "area" || i.type === "line") && i.hazard === true)),
    mando: shown.some(i => i.type === "mando" || i.type === "dropzone")
  };
};

export type MapLayers = {
  stats: HoleStats[];
  contours: Contours | null;
  hillshade: string | null;
  /** Show only this hole's parts (a tee sign); others are faded. */
  focusHole?: string;
  /** How much the other holes show then (0..1; unset: 0.35). */
  fade?: number;
  /** Text size multiplier (bigger on posters). */
  textScale: number;
  fontFamily: string;
  /** Forest style: where the photo shows trees. */
  canopy?: CanopyGrid | null;
  /** Labels moved or hidden by hand (the course map's page): each one marked to be picked. */
  labelAt?: MapStyle["labelAt"];
};

const OWN_FONTS = new Set(["", "Oswald", "Inter", "Bitter", "Script"]);
/** A font for labels: the app's own, or a Google font by name (a script's labels in Oswald, where
 * the one font is the title's too; `asked`: picked for the labels alone, so it's used as it is). */
export const fontStack = (f: string, asked = false) => (asked && !OWN_FONTS.has(f) && f !== "Oswald" ? `'${f.replace(/'/g, "")}', Inter, Arial, sans-serif` : f === "Oswald" || f === "Script" || SCRIPT_FONTS.has(f) ? "Oswald, 'Arial Narrow', Arial, sans-serif" : f === "Bitter" ? "Bitter, Georgia, serif" : OWN_FONTS.has(f) ? "Inter, Arial, sans-serif" : `'${f.replace(/'/g, "")}', Inter, Arial, sans-serif`);
/** A font for titles: a script stays a script. */
export const titleStack = (f: string) => (f === "Script" ? "'Kaushan Script', 'Brush Script MT', cursive" : SCRIPT_FONTS.has(f) ? `'${f.replace(/'/g, "")}', 'Kaushan Script', cursive` : fontStack(f));
/** A script keeps its own capitals (a title in all capitals reads badly in one). */
export const keepsCase = (f: string) => f === "Script" || SCRIPT_FONTS.has(f);

export { BASKET_MARKS, basketMark };

/** The map itself (everything inside the frame), in a box `view.width` × `view.height`. */
export const renderMapLayers = (doc: CourseDoc, view: MapView, layers: MapLayers, uid = "m") => {
  const s = doc.style;
  const pal = palette(s);
  const k = view.scale;
  // Screen pixels -> feet inside the plan group; lines and hatching grow with the text on big prints
  const px = (v: number) => (v * Math.max(1, layers.textScale * 0.8)) / k;
  const rot = (view.rotation * Math.PI) / 180;
  const toScreen = (p: P): P => {
    const dx = p.x - view.cx, dy = p.y - view.cy;
    const c = Math.cos(-rot), sn = Math.sin(-rot);
    return { x: view.width / 2 + (dx * c - dy * sn) * k, y: view.height / 2 + (dx * sn + dy * c) * k };
  };
  const ts = layers.textScale;
  // (the labels' own font once the title has one of its own)
  const font = fontStack(layers.fontFamily, !!s.titleFont);
  const out: string[] = [];
  const defs: string[] = [];
  const focus = layers.focusHole;
  const dim = (holeId?: string, also?: string[]) => (focus && holeId && holeId !== focus && !also?.includes(focus) ? layers.fade ?? 0.35 : 1);
  const theme = s.theme;
  const photo = theme === "satellite" && !!doc.background;
  const forest = theme === "forest";

  // --- Patterns and filters
  const hatch = (id: string, color: string, gap: number, width: number, angle = 45) =>
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(px(gap))}" height="${n(px(gap))}" patternTransform="rotate(${angle})"><rect width="${n(px(gap))}" height="${n(px(gap))}" fill="${color}" fill-opacity="0.12"/><line x1="0" y1="0" x2="0" y2="${n(px(gap))}" stroke="${color}" stroke-width="${n(px(width))}" stroke-opacity="0.8"/></pattern>`;
  // Regulated areas: the common map habit (red OB, purple out of play) or the PDGA course marking
  // colors (white OB, red out of play, cased dark so white reads on a light map). Hazards yellow,
  // casual areas blue in both.
  const pdga = s.markings === "pdga";
  const obCol = pdga ? "#ffffff" : s.ob, obCase = pdga ? "#1b1d1a" : "#ffffff", obInk = pdga ? "#1b1d1a" : "#ffffff";
  const nogoCol = pdga ? RESTRICTED : "#7c3aed", casualCol = AREA_KINDS.casual.color;
  defs.push(hatch(`${uid}-ob`, obCol, 9, 1.6), hatch(`${uid}-hz`, s.hazard, 9, 1.6, -45), hatch(`${uid}-ng`, nogoCol, 10, 1.2), hatch(`${uid}-cs`, casualCol, 12, 1, 0));
  defs.push(`<filter id="${uid}-soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${n(px(1.6))}"/></filter>`);
  defs.push(`<radialGradient id="${uid}-crown" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0.05"/><stop offset="1" stop-color="#000000" stop-opacity="0.18"/></radialGradient>`);
  if (pal.grain > 0) {
    // Grass grain: tiny strokes on a repeating tile, in screen space so it prints the same at any scale
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const marks: string[] = [];
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 40, y = rnd() * 40, a = (rnd() - 0.5) * 1.2;
      marks.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + Math.sin(a) * 2.2)}" y2="${n(y - Math.cos(a) * 2.2)}" stroke="${rnd() > 0.5 ? "#000" : "#fff"}" stroke-opacity="${n(pal.grain * (0.6 + rnd()))}" stroke-width="0.8" stroke-linecap="round"/>`);
    }
    defs.push(`<pattern id="${uid}-grain" patternUnits="userSpaceOnUse" width="40" height="40">${marks.join("")}</pattern>`);
  }

  const g = `translate(${n(view.width / 2)} ${n(view.height / 2)}) rotate(${n(-view.rotation)}) scale(${n(k)}) translate(${n(-view.cx)} ${n(-view.cy)})`;
  out.push(`<rect width="${n(view.width)}" height="${n(view.height)}" fill="${pal.bg}"/>`);
  out.push(`<g transform="${g}">`);
  // Ground: the photo, the painted land (Forest), or the drawn grass
  let treesOver: { url: string; hidden: Set<string> } | null = null;
  let at = { x: 0, y: 0, w: view.width, h: view.height }, before: { url: string; at: Placed } | null = null;
  if (forest && typeof document !== "undefined") {
    // (while the first painting of a live preview is under way: the grass color alone)
    const painted = forestPicture(doc, view, layers);
    treesOver = painted ? overOf.get(painted.url) ?? null : null;
    // (a painting made for another view of the same turn stands in where it falls in this one)
    if (painted && painted.view !== view) {
      const v0 = painted.view, r = view.scale / v0.scale;
      const c = Math.cos(-rot), sn = Math.sin(-rot), dx = v0.cx - view.cx, dy = v0.cy - view.cy;
      at = { x: view.width / 2 + (dx * c - dy * sn) * k - (v0.width / 2) * r, y: view.height / 2 + (dx * sn + dy * c) * k - (v0.height / 2) * r, w: v0.width * r, h: v0.height * r };
    }
    // (live, the painting it takes over from fading out over a new one: the new one first, as the
    // page's painting)
    before = painted && paintLive ? fadeFrom(JSON.stringify([doc.id, view.cx, view.cy, view.scale, view.rotation, view.width, view.height]), painted.url, at) : null;
    const picture = (url: string, p: Placed, fade: boolean) => `<image href="${url}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none"${fade ? ` class="dg-paintgone"` : ""}/>`;
    out.push(painted ? `</g>${picture(painted.url, at, false)}${before ? picture(before.url, before.at, true) : ""}<g transform="${g}">` : `</g><rect width="${n(view.width)}" height="${n(view.height)}" fill="${shade(s.rough, -0.25)}"/><g transform="${g}">`);
  } else if (photo) {
    out.push(`<image href="${doc.background}" x="0" y="0" width="${doc.canvas.width}" height="${doc.canvas.height}" preserveAspectRatio="none" opacity="${n(s.photo)}"/>`);
  } else {
    out.push(`<rect x="${-doc.canvas.width}" y="${-doc.canvas.height}" width="${doc.canvas.width * 3}" height="${doc.canvas.height * 3}" fill="${pal.grass}"/>`);
  }
  if (s.hillshade && layers.hillshade && theme !== "minimal" && !forest) {
    out.push(`<image href="${layers.hillshade}" x="0" y="0" width="${doc.canvas.width}" height="${doc.canvas.height}" preserveAspectRatio="none" opacity="${theme === "satellite" ? 0.45 : theme === "night" ? 0.6 : forest ? 0.7 : 0.9}"/>`);
  }
  out.push(`</g>`);
  if (pal.grain > 0 && !photo && !forest) out.push(`<rect width="${n(view.width)}" height="${n(view.height)}" fill="url(#${uid}-grain)"/>`);
  out.push(`<g transform="${g}">`);

  // Contours
  const contourLabels: { at: P; angle: number; text: string }[] = [];
  // (The Forest style paints its contours into the land, under the treetops)
  if (s.contours && !forest && layers.contours?.segments.length) {
    const lines = chainContours(layers.contours.segments);
    const iv = layers.contours.interval;
    const minor: string[] = [], major: string[] = [];
    for (const l of lines) (Math.abs(Math.round(l.level / iv)) % 5 === 0 ? major : minor).push(pathD(l.pts));
    if (minor.length) out.push(`<path d="${minor.join("")}" fill="none" stroke="${pal.contour}" stroke-width="${n(px(0.7))}" stroke-linejoin="round"/>`);
    if (major.length) out.push(`<path d="${major.join("")}" fill="none" stroke="${pal.contourMajor}" stroke-width="${n(px(1.3))}" stroke-linejoin="round"/>`);
    // The heights on the bolder lines (on a small site with few of them, every line or every
    // other one), set in the line along its run, upright, spaced out so they don't crowd
    const levels = new Set(lines.map(l => Math.round(l.level / iv)));
    const bold = [...levels].filter(v => v % 5 === 0).length;
    const every = bold >= 3 ? 5 : levels.size > 10 ? 2 : 1;
    for (const l of lines) {
      if (Math.abs(Math.round(l.level / iv)) % every !== 0 || l.pts.length < 2) continue;
      const len = pathLength(l.pts);
      if (len * k < 140 * ts) continue;
      // The middle, or failing that a spot further along that is clear of the other labels
      let a: P | null = null, b: P | null = null;
      for (const f of [0.5, 0.3, 0.7, 0.18, 0.82]) {
        const p0 = toScreen(pointAlong(l.pts, len * f).point);
        if (contourLabels.some(c => dist(c.at, p0) < 90 * ts)) continue;
        a = p0;
        b = toScreen(pointAlong(l.pts, Math.min(len, len * f + 2)).point);
        break;
      }
      if (!a || !b) continue;
      let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      const ft = (doc.site?.baseElevationFt ?? 0) + l.level;
      contourLabels.push({ at: a, angle, text: `${Math.round(doc.units === "m" ? ft / FT_PER_M : ft)}` });
    }
  }

  // (areas with their outlines as drawn: smooth curves through their corners)
  const items = drawnAreas(doc.items);
  const areas = (items.filter(i => i.type === "area") as AreaItem[]).sort((a, b) => polygonArea(b.points) - polygonArea(a.points));
  const lines = items.filter(i => i.type === "line") as LineItem[];

  // Land cover areas first (under the course)
  const landFill = (a: AreaItem) => {
    switch (a.kind) {
      case "water": return s.water;
      case "woods": return s.trees;
      case "fairway": return s.fairway;
      case "green": return s.fairway;
      case "rough": return tallGrassOf(s);
      case "parking": return pal.parking;
      case "building": return pal.building;
      case "sand": return "#e3cf98";
      default: return null;
    }
  };
  const inks = fieldInks(theme, s.fairway);
  for (const a of areas) {
    if (a.kind === "field") {
      const plan = a.points.length >= 3 ? fieldPlan(a) : null;
      if (plan) out.push(`<g opacity="${dim(a.holeId, a.alsoHoles)}">${fieldSvg(plan, inks, px(0.5), `${uid}-f${a.id}`)}</g>`);
      continue;
    }
    const fill = landFill(a);
    if (!fill || a.points.length < 3 || forest) continue;
    const o = dim(a.holeId, a.alsoHoles);
    if (a.kind === "water") {
      out.push(`<polygon points="${pts(a.points)}" fill="${fill}" opacity="${o}" stroke="${shade(fill, -0.25)}" stroke-width="${n(px(1.4))}" stroke-linejoin="round"/>`);
      out.push(`<polygon points="${pts(a.points)}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${n(px(3))}" stroke-linejoin="round" transform="translate(0 0)" style="paint-order:stroke"/>`);
    } else if (a.kind === "woods" && brushOnly(a)) {
      // (brush on its own: a soft lighter green, thicker the heavier, no treetops)
      out.push(`<polygon points="${pts(a.points)}" fill="${shade(fill, 0.3)}" opacity="${n(((a.density ?? 1) < 0.75 ? 0.3 : (a.density ?? 1) > 1.4 ? 0.6 : 0.45) * o)}" stroke-linejoin="round"/>`);
    } else if (a.kind === "woods") {
      if (!forest) out.push(woods(a, fill, k, uid, pal.treeShadow, o));
    } else if (a.kind === "building") {
      if (pal.treeShadow > 0) out.push(`<polygon points="${pts(a.points.map(p => ({ x: p.x + px(3), y: p.y + px(3) })))}" fill="#000" opacity="${n(0.25 * o)}"/>`);
      out.push(`<polygon points="${pts(a.points)}" fill="${fill}" stroke="${shade(fill, -0.3)}" stroke-width="${n(px(1))}" opacity="${o}"/>`);
    } else {
      out.push(`<polygon points="${pts(a.points)}" fill="${fill}" opacity="${n((a.kind === "fairway" || a.kind === "green" ? 0.9 : 0.85) * o)}" stroke="${shade(fill, -0.15)}" stroke-width="${n(px(0.8))}"/>`);
    }
  }

  // Fairways along throw lines (soft edged)
  {
    for (const st of layers.stats) {
      const hole = doc.holes.find(h => h.id === st.holeId);
      if (!hole?.fairway || !st.complete || forest) continue;
      const poly = fairwayOutline(hole, smoothPath(st.line, 10), 0, 12);
      const o = dim(hole.id) * (photo ? 0.4 : theme === "minimal" ? 0.8 : 0.95);
      out.push(`<polygon points="${pts(poly)}" fill="${s.fairway}" opacity="${n(o)}" ${theme === "minimal" ? "" : `filter="url(#${uid}-soft)"`}/>`);
      if (photo) out.push(`<polygon points="${pts(poly)}" fill="none" stroke="${s.fairway}" stroke-width="${n(px(1.2))}" opacity="${n(dim(hole.id))}"/>`);
    }
  }

  // Paths, roads, streams, fences, walks
  for (const l of lines) {
    if (l.points.length < 2 || (forest && l.kind !== "fence" && l.kind !== "hedge" && l.kind !== "power")) continue;
    const meta = LINE_KINDS[l.kind];
    const w = l.width ?? meta.width;
    const o = dim(l.holeId, l.alsoHoles);
    // Creeks and trails wind: draw them as smooth curves through their points
    const d = pathD(linePath(l));
    if (l.kind === "road") {
      out.push(`<path d="${d}" fill="none" stroke="${shade(pal.road, -0.25)}" stroke-width="${n(Math.max(w, px(3)) + px(2))}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${pal.road}" stroke-width="${n(Math.max(w, px(3)))}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="${n(px(0.8))}" stroke-dasharray="${n(px(6))} ${n(px(6))}"/>`);
    } else if (l.kind === "path") {
      out.push(`<path d="${d}" fill="none" stroke="${shade(s.path, -0.3)}" stroke-width="${n(Math.max(w, px(2.2)) + px(1.2))}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(0.8 * o)}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${s.path}" stroke-width="${n(Math.max(w, px(2.2)))}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`);
    } else if (l.kind === "stream") {
      out.push(`<path d="${d}" fill="none" stroke="${shade(s.water, -0.35)}" stroke-width="${n(Math.max(w, px(2)) + px(1))}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(0.7 * o)}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${s.water}" stroke-width="${n(Math.max(w, px(2)))}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${n(Math.max(w, px(2)) * 0.3)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (l.kind === "fence") {
      out.push(`<path d="${d}" fill="none" stroke="${pal.inkSoft}" stroke-width="${n(px(1.2))}" stroke-dasharray="${n(px(1))} ${n(px(3))}" stroke-linecap="round" opacity="${o}"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${pal.inkSoft}" stroke-width="${n(px(0.6))}" opacity="${o}"/>`);
    } else if (l.kind === "hedge") {
      out.push(hedgeSvg(d, Math.max(w, px(2.4)), s.trees, o, pal.treeShadow > 0 && !photo ? px(1.6) : 0));
    } else if (l.kind === "power") {
      out.push(powerSvg(linePath(l), powerInk(theme), px, o));
    }
  }

  // Trees (shadow, crown, highlight)
  const trees = (items.filter(i => i.type === "tree") as TreeItem[]).sort((a, b) => a.y - b.y);
  if (pal.treeShadow > 0 && !photo && !forest) {
    out.push(`<g opacity="${n(pal.treeShadow)}">${trees.map(t => `<circle cx="${n(t.x + t.radius * 0.28)}" cy="${n(t.y + t.radius * 0.32)}" r="${n(t.radius * (t.width ?? 1))}" fill="#0b1a08"/>`).join("")}</g>`);
  }
  if (forest) {
    // (painted with the forest)
  } else if (!photo) {
    for (const t of trees) {
      const r = t.radius * (t.width ?? 1);
      const c = t.treeType === "conifer" ? shade(s.trees, -0.12) : t.treeType === "bush" ? shade(s.trees, 0.12) : s.trees;
      if (t.treeType === "conifer") {
        // (tufted: a ring of soft needle tufts round the middle, as every map style draws a pine)
        const tufts = Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return `<circle cx="${n(t.x + Math.cos(a) * r * 0.6)}" cy="${n(t.y + Math.sin(a) * r * 0.6)}" r="${n(r * 0.4)}"/>`;
        }).join("");
        out.push(`<g fill="${c}" stroke="${shade(c, -0.3)}" stroke-width="${n(px(0.6))}">${tufts}<circle cx="${n(t.x)}" cy="${n(t.y)}" r="${n(r * 0.42)}"/></g><circle cx="${n(t.x)}" cy="${n(t.y)}" r="${n(r)}" fill="url(#${uid}-crown)"/>`);
      } else {
        out.push(`<circle cx="${n(t.x)}" cy="${n(t.y)}" r="${n(r)}" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width="${n(px(0.6))}"/><circle cx="${n(t.x)}" cy="${n(t.y)}" r="${n(r)}" fill="url(#${uid}-crown)"/>`);
      }
    }
  } else {
    // On the photo the trees are already there: only outline the ones that matter
    out.push(`<g fill="none" stroke="#bbf7d0" stroke-opacity="0.45" stroke-width="${n(px(0.8))}">${trees.map(t => `<circle cx="${n(t.x)}" cy="${n(t.y)}" r="${n(t.radius * (t.width ?? 1))}"/>`).join("")}</g>`);
  }

  // Built things: bridges over the creeks, boardwalks, stairs, walls, buildings, shelters and decks
  const structures = items.filter(i => i.type === "structure") as StructureItem[];
  if (structures.length) {
    // (where the sun really shines from, by the compass; turned with the map below)
    const az = (sunFromOf(s, latitudeOf(doc.site)) * Math.PI) / 180;
    const draw: StructureDraw = {
      u: px(1), ft: 1, sun: rotatePoint({ x: Math.sin(az), y: -Math.cos(az) }, view.rotation), sunHeight: s.sunHeight ?? 38,
      // (The Forest painting casts their shadows itself)
      shadow: forest ? 0 : STRUCTURE_SHADOW[theme], blur: `url(#${uid}-soft)`, ink: structureInk(theme), id: uid
    };
    // Walls and stairs under decks and bridges; buildings on top
    const order: StructureKind[] = ["wall", "stairs", "boardwalk", "deck", "bridge", "shelter", "building"];
    for (const st of [...structures].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
      const shape = isLineKind(st.kind) ? structurePath(st) : st.points;
      out.push(`<g opacity="${dim(st.holeId, st.alsoHoles)}">${structureSymbol(st.kind, shape, structureWidth(st), structureHeight(st), structureRoof(st), { ...draw, id: `${uid}-s${st.id}`, ink: st.roofColor ? { ...draw.ink, roof: st.roofColor, shelter: st.roofColor } : draw.ink }, { pitch: st.roofPitch, across: st.ridgeAcross })}</g>`);
    }
  }
  // (the painted treetops over the buildings, and their shade on the roofs: crowns overhang roofs
  // as they do from the air)
  if (treesOver) out.push(`</g><image href="${treesOver.url}" x="${n(at.x)}" y="${n(at.y)}" width="${n(at.w)}" height="${n(at.h)}" preserveAspectRatio="none"${before ? ` class="dg-paintfade"` : ""}/><g transform="${g}">`);
  // (and the outlines of the buildings mostly under leaves, faint and dashed: still there under them)
  if (treesOver) {
    const under = structures.filter(st => (st.kind === "building" || st.kind === "shelter") && st.points.length >= 3 && treesOver!.hidden.has(st.id));
    if (under.length) out.push(`<g fill="none" stroke="${structureInk(theme).casing}" stroke-opacity="0.55" stroke-width="${n(px(0.8))}" stroke-dasharray="${n(px(2.5))} ${n(px(2))}" stroke-linejoin="round">${under.map(st => `<polygon points="${pts(st.points)}"/>`).join("")}</g>`);
  }

  // OB, hazards and no-go areas over the land: a soft band of color inside the edge, the edge
  // itself crisp on a white casing, and a tag saying what it is (when there is room)
  const tags: { id: string; at: P; text: string; bg: string; fg: string; o: number }[] = [];
  for (const a of areas) {
    if (a.kind === "field" && isOutOfPlay(a) && a.points.length >= 3) {
      const poly = pts(a.points);
      out.push(`<g opacity="${dim(a.holeId, a.alsoHoles)}"><polygon points="${poly}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${n(px(4))}" stroke-linejoin="round"/><polygon points="${poly}" fill="none" stroke="${nogoCol}" stroke-width="${n(px(2.2))}" stroke-linejoin="round" stroke-dasharray="${n(px(6))} ${n(px(3.5))}"/></g>`);
      continue;
    }
    if (a.kind !== "ob" && a.kind !== "hazard" && a.kind !== "nogo" && a.kind !== "casual") continue;
    if (a.points.length < 3) continue;
    const pat = a.kind === "ob" ? `${uid}-ob` : a.kind === "hazard" ? `${uid}-hz` : a.kind === "casual" ? `${uid}-cs` : `${uid}-ng`;
    const col = a.kind === "ob" ? obCol : a.kind === "hazard" ? s.hazard : a.kind === "casual" ? casualCol : nogoCol;
    const casing = a.kind === "ob" ? obCase : "#ffffff";
    const o = dim(a.holeId, a.alsoHoles);
    const clip = `${uid}-in-${a.id.replace(/[^\w-]/g, "")}`;
    const poly = pts(a.points);
    defs.push(`<clipPath id="${clip}"><polygon points="${poly}"/></clipPath>`);
    const dash = a.kind === "ob" ? "" : `stroke-dasharray="${n(px(6))} ${n(px(3.5))}"`;
    out.push(`<g opacity="${o}"><polygon points="${poly}" fill="url(#${pat})" stroke="none"/><polygon points="${poly}" fill="none" stroke="${col}" stroke-opacity="0.38" stroke-width="${n(px(10))}" clip-path="url(#${clip})"/><polygon points="${poly}" fill="none" stroke="${casing}" stroke-opacity="0.9" stroke-width="${n(px(4.6))}" stroke-linejoin="round"/><polygon points="${poly}" fill="none" stroke="${col}" stroke-width="${n(px(2.5))}" stroke-linejoin="round" ${dash}/></g>`);
    const b = boundsOf(a.points);
    if (!a.label && Math.min(b.maxX - b.minX, b.maxY - b.minY) * k > 34 * ts) {
      tags.push({ id: `tag:${a.id}`, at: toScreen(labelPoint(a.points)), text: a.kind === "ob" ? "OB" : a.kind === "hazard" ? "HAZARD" : a.kind === "casual" ? "CASUAL" : "OUT OF PLAY", bg: col, fg: a.kind === "hazard" ? "#1b1d1a" : a.kind === "ob" ? obInk : "#ffffff", o });
    }
  }
  for (const l of lines.filter(x => x.kind === "ob")) {
    const pts = linePath(l);
    out.push(`<path d="${pathD(pts)}" fill="none" stroke="${obCase}" stroke-width="${n(px(4.6))}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(0.9 * dim(l.holeId, l.alsoHoles))}"/>`);
    out.push(`<path d="${pathD(pts)}" fill="none" stroke="${obCol}" stroke-width="${n(px(2.6))}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(dim(l.holeId, l.alsoHoles))}"/>`);
    const len = pathLength(pts);
    if (len * k > 70 * ts) tags.push({ id: `tag:${l.id}`, at: toScreen(pointAlong(pts, len * (l.label ? 0.72 : 0.5)).point), text: "OB", bg: obCol, fg: obInk, o: dim(l.holeId, l.alsoHoles) });
  }

  // Water, creeks, roads, fences and paths marked OB: a red edge along them (on both banks of a
  // creek or road, following the painted line in the Forest style)
  {
    // (`d` ft to one side, or as far as `d(t)` along the way: a creek that widens)
    const offset = (line: P[], d: number | ((t: number) => number)) => {
      const along = [0];
      for (let i = 1; i < line.length; i++) along.push(along[i - 1] + dist(line[i - 1], line[i]));
      const total = along[along.length - 1] || 1;
      return line.map((p, i) => {
        const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const off = typeof d === "number" ? d : d(along[i] / total);
        return { x: p.x - (dy / len) * off, y: p.y + (dx / len) * off };
      });
    };
    const edge = (d: string, o: number) => out.push(`<path d="${d}" fill="none" stroke="${obCase}" stroke-opacity="0.9" stroke-width="${n(px(3.6))}" stroke-linejoin="round" stroke-linecap="round" opacity="${n(o)}"/><path d="${d}" fill="none" stroke="${obCol}" stroke-width="${n(px(1.9))}" stroke-linejoin="round" stroke-linecap="round" opacity="${n(o)}"/>`);
    for (const a of areas) if (a.ob === true && a.kind !== "ob" && a.points.length >= 3) for (const piece of areaObEdges({ ...a, straight: true })) edge(pathD(piece), dim(a.holeId, a.alsoHoles));
    // (short ticks from an edge into the out-of-bounds side: a road and beyond)
    const ticks = (line: P[], side: number, o: number) => {
      const len = pathLength(line), step = px(9), out1: string[] = [];
      for (let d = step / 2; d < len; d += step) {
        const { point: p, angle } = pointAlong(line, d);
        const q = { x: p.x - Math.sin(angle) * side * px(4.2), y: p.y + Math.cos(angle) * side * px(4.2) };
        out1.push(`M${n(p.x)} ${n(p.y)}L${n(q.x)} ${n(q.y)}`);
      }
      if (out1.length) out.push(`<path d="${out1.join("")}" fill="none" stroke="${obCol}" stroke-width="${n(px(1.3))}" stroke-linecap="round" opacity="${n(o)}"/>`);
    };
    for (const l of lines) {
      if (l.ob !== true || l.kind === "ob" || l.points.length < 2) continue;
      const o = dim(l.holeId, l.alsoHoles);
      const w = l.width ?? LINE_KINDS[l.kind].width;
      const g = forest ? paintedLine(l, view.scale) : { points: linePath(l), width: Math.max(w, px(l.kind === "road" ? 3 : l.kind === "path" ? 2.2 : 2)) };
      const k1 = forest && l.kind === "stream" ? 1.3 : 1;
      const wAt = "widthAt" in g ? g.widthAt : undefined;
      // (the holes it's beside: OB "and beyond" from its edge on their side)
      const holeLines = layers.stats.filter(st => st.complete && obFor(doc, l, st.holeId)).map(st => st.line);
      let longest: P[] = [];
      // Along all of it, or only its stretches marked OB
      for (const [a, b] of obRanges(l)) {
        const piece = subPath(g.points, a, b);
        if (piece.length < 2) continue;
        if (pathLength(piece) > pathLength(longest)) longest = piece;
        const sides = l.obBeyond ? beyondSides(l, piece, holeLines, !obPicked(doc, l).length) : null;
        if (l.kind === "fence" || l.kind === "walk") {
          edge(pathD(piece), o);
          if (sides?.length === 1) ticks(piece, -sides[0], o);
          continue;
        }
        const off = (u: number) => ((wAt ? wAt(a + (b - a) * u) : g.width) / 2) * k1 + px(1.6);
        for (const side of sides ?? [1, -1]) {
          const e = offset(piece, u => side * off(u));
          edge(pathD(e), o);
          if (sides) ticks(e, -side, o);
        }
      }
      const len = pathLength(longest);
      // (Away from its name, which sits in the middle)
      if (len * k > 70 * ts) tags.push({ id: `tag:${l.id}`, at: toScreen(pointAlong(longest, len * (l.label && longest.length === g.points.length ? 0.72 : 0.5)).point), text: "OB", bg: obCol, fg: obInk, o });
    }
  }

  // Water, creeks, roads, fences and the rest made hazards: a dashed hazard edge round them (both
  // banks of a creek or road), white under it
  {
    const hz = (d: string, o: number) => out.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${n(px(3.8))}" stroke-linejoin="round" opacity="${n(o)}"/><path d="${d}" fill="none" stroke="${s.hazard}" stroke-width="${n(px(2.2))}" stroke-dasharray="${n(px(6))} ${n(px(3.5))}" stroke-linejoin="round" opacity="${n(o)}"/>`);
    for (const a of areas) {
      if (a.hazard !== true || a.kind === "hazard" || a.points.length < 3) continue;
      const o = dim(a.holeId, a.alsoHoles);
      hz(`${pathD(a.points)}Z`, o);
      const b = boundsOf(a.points);
      if (!a.label && Math.min(b.maxX - b.minX, b.maxY - b.minY) * k > 34 * ts) tags.push({ id: `tag:${a.id}`, at: toScreen(labelPoint(a.points)), text: "HAZARD", bg: s.hazard, fg: "#1b1d1a", o });
    }
    for (const l of lines) {
      if (l.hazard !== true || l.kind === "ob" || l.points.length < 2) continue;
      const o = dim(l.holeId, l.alsoHoles);
      const pts = linePath(l), w = l.width ?? LINE_KINDS[l.kind].width;
      const half = Math.max(w, px(2)) / 2 + px(1.6);
      if (l.kind === "fence" || l.kind === "walk" || w <= 0) hz(pathD(pts), o);
      else for (const side of [1, -1]) hz(pathD(offsetPath(pts, () => side * half)), o);
      const len = pathLength(pts);
      if (len * k > 70 * ts) tags.push({ id: `tag:${l.id}`, at: toScreen(pointAlong(pts, len * (l.label ? 0.72 : 0.5)).point), text: "HAZARD", bg: s.hazard, fg: "#1b1d1a", o });
    }
  }

  // Next-tee walks
  if (s.nextTee && !forest) {
    for (let i = 0; i + 1 < layers.stats.length; i++) {
      const a = layers.stats[i], b = layers.stats[i + 1];
      if (!a.complete || !b.complete || focus) continue;
      const from = a.line[a.line.length - 1], to = b.line[0];
      const d = dist(from, to);
      if (d < 40) continue;
      const k0 = Math.min(0.4, CIRCLE_ONE_FT / d), k1 = Math.max(0.6, 1 - 14 / d);
      const s0 = { x: from.x + (to.x - from.x) * k0, y: from.y + (to.y - from.y) * k0 };
      const s1 = { x: from.x + (to.x - from.x) * k1, y: from.y + (to.y - from.y) * k1 };
      out.push(`<path d="${pathD([s0, s1])}" fill="none" stroke="${pal.line}" stroke-opacity="0.85" stroke-width="${n(px(1.6))}" stroke-dasharray="${n(px(1.5))} ${n(px(4))}" stroke-linecap="round"/>`);
    }
    for (const l of lines.filter(x => x.kind === "walk")) {
      out.push(`<path d="${pathD(l.points)}" fill="none" stroke="${pal.line}" stroke-opacity="0.85" stroke-width="${n(px(1.6))}" stroke-dasharray="${n(px(1.5))} ${n(px(4))}" stroke-linecap="round"/>`);
    }
  }

  // Putting circles, throw lines
  for (const st of layers.stats) {
    if (!st.complete) continue;
    const o = dim(st.holeId);
    if (s.circle) {
      for (const b of holeBaskets(doc, st.holeId)) out.push(`<circle cx="${n(b.x)}" cy="${n(b.y)}" r="${n(CIRCLE_ONE_FT)}" fill="none" stroke="${pal.line}" stroke-opacity="${n(0.6 * o)}" stroke-width="${n(px(1))}" stroke-dasharray="${n(px(3))} ${n(px(3))}"/>`);
    }
  }
  if (s.throwLines) {
    for (const st of layers.stats) {
      if (!st.complete) continue;
      const hole = doc.holes.find(h => h.id === st.holeId)!;
      const o = dim(st.holeId);
      // Other tees of the hole: thinner dashed lines in their colors
      for (const tee of doc.items.filter(i => i.type === "tee" && i.holeId === st.holeId && i.id !== st.teeId) as TeeItem[]) {
        const line = smoothPath([{ x: tee.x, y: tee.y }, ...hole.doglegs, st.line[st.line.length - 1]], 10);
        out.push(`<path d="${pathD(line)}" fill="none" stroke="${TEE_LEVELS[tee.level].color === "#f8fafc" ? "#e5e7eb" : TEE_LEVELS[tee.level].color}" stroke-width="${n(px(1.6))}" stroke-dasharray="${n(px(5))} ${n(px(4))}" opacity="${n(0.9 * o)}"/>`);
      }
      const line = smoothPath(st.line, 12);
      const len = pathLength(line);
      const trim = trimPath(line, 6 / k, len - Math.max(2.2 / k * 6, 8));
      out.push(`<path d="${pathD(trim)}" fill="none" stroke="${pal.lineCasing}" stroke-width="${n(px(4.6))}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`);
      out.push(`<path d="${pathD(trim)}" fill="none" stroke="${pal.line}" stroke-width="${n(px(2.4))}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`);
      // Arrowhead short of the basket
      const end = pointAlong(line, Math.max(0, len - Math.max(12 / k, 6)));
      const tip = end.point, a = end.angle, al = 9 / k;
      const head = [
        { x: tip.x + Math.cos(a) * al * 0.6, y: tip.y + Math.sin(a) * al * 0.6 },
        { x: tip.x - Math.cos(a - 0.45) * al, y: tip.y - Math.sin(a - 0.45) * al },
        { x: tip.x - Math.cos(a + 0.45) * al, y: tip.y - Math.sin(a + 0.45) * al }
      ];
      out.push(`<polygon points="${pts(head)}" fill="${pal.line}" stroke="${pal.lineCasing}" stroke-width="${n(px(1))}" opacity="${o}"/>`);
    }
  }
  out.push(`</g>`);

  // --- Symbols and labels in screen space (always upright, constant size)
  const sym: string[] = [];
  const textLabel = (p: P, text: string, size: number, opts: { color?: string; halo?: string; weight?: number; anchor?: string; angle?: number; family?: string } = {}) =>
    `<text x="${n(p.x)}" y="${n(p.y)}" font-family="${opts.family ?? font}" font-size="${n(size)}" font-weight="${opts.weight ?? 700}" text-anchor="${opts.anchor ?? "middle"}" dominant-baseline="central" fill="${opts.color ?? pal.label}" stroke="${opts.halo ?? pal.labelHalo}" stroke-width="${n(size * 0.22)}" stroke-linejoin="round" paint-order="stroke"${opts.angle ? ` transform="rotate(${n(opts.angle)} ${n(p.x)} ${n(p.y)})"` : ""}>${esc(text)}</text>`;

  // Labels where they were dragged on the Design page (kept in feet from where they go by
  // themselves, so they stay by their things), or hidden; each in a group to be picked by
  const moved = layers.labelAt;
  const place = (id: string, p: P): P | null => {
    const o = moved?.[id];
    if (!o) return p;
    if (o.hidden) return null;
    const c = Math.cos(-rot), sn = Math.sin(-rot);
    return { x: p.x + (o.dx * c - o.dy * sn) * k, y: p.y + (o.dx * sn + o.dy * c) * k };
  };
  const label = (id: string, p: P, draw: (q: P) => string) => {
    const q = place(id, p);
    if (q) sym.push(moved ? `<g data-label="${id}">${draw(q)}</g>` : draw(q));
  };

  // Contour heights (a halo of the ground's color breaks the line under them)
  for (const c of contourLabels) sym.push(textLabel(c.at, c.text, 7 * ts, { color: pal.contourMajor.startsWith("rgba") ? pal.inkSoft : pal.contourMajor, halo: pal.bg, weight: 600, angle: c.angle }));

  // Area and line names
  for (const a of areas) if (a.label) label(`name:${a.id}`, toScreen(labelPoint(a.points)), q => textLabel(q, a.label!, 10 * ts, { color: a.kind === "water" && pal.label === "#ffffff" ? "#e0f2fe" : a.kind === "water" ? shade(s.water, -0.55) : pal.label, halo: a.kind === "water" && pal.label !== "#ffffff" ? shade(s.water, 0.6) : undefined, weight: 600 }));
  for (const st of structures) if (st.label && st.points.length >= 2) {
    if (isLineKind(st.kind)) {
      const mid = pointAlong(st.points, pathLength(st.points) / 2);
      let ang = (mid.angle * 180) / Math.PI - view.rotation;
      while (ang > 90) ang -= 180;
      while (ang < -90) ang += 180;
      const off = (structureWidth(st) / 2) * k + 7 * ts;
      const sp = toScreen(mid.point), nrm = { x: -Math.sin((ang * Math.PI) / 180), y: Math.cos((ang * Math.PI) / 180) };
      label(`name:${st.id}`, { x: sp.x - nrm.x * off, y: sp.y - nrm.y * off }, q => textLabel(q, st.label!, 8.5 * ts, { weight: 600, angle: ang }));
    } else label(`name:${st.id}`, toScreen(labelPoint(st.points)), q => textLabel(q, st.label!, 8.5 * ts, { weight: 600 }));
  }
  for (const l of lines) if (l.label && l.points.length >= 2) {
    const mid = pointAlong(l.points, pathLength(l.points) / 2);
    let ang = (mid.angle * 180) / Math.PI - view.rotation;
    while (ang > 90) ang -= 180;
    while (ang < -90) ang += 180;
    label(`name:${l.id}`, toScreen(mid.point), q => textLabel(q, l.label!, 9 * ts, { weight: 600, angle: ang }));
  }

  // Distance labels along each throw line
  if (s.distances) {
    for (const st of layers.stats) {
      if (!st.complete || (focus && st.holeId !== focus)) continue;
      const line = smoothPath(st.line, 10);
      const len = pathLength(line);
      // Along the line, clear of mandos, drop zones and the like
      const busy = items.filter(i => i.type === "mando" || i.type === "dropzone" || i.type === "amenity").map(i => toScreen(i));
      const clear = (q: P) => busy.every(b => Math.hypot(b.x - q.x, b.y - q.y) > 26 * ts);
      const mid = [0.55, 0.4, 0.7, 0.3, 0.8].map(f => pointAlong(line, len * f)).find(m => clear(toScreen(m.point))) ?? pointAlong(line, len * 0.55);
      let ang = (mid.angle * 180) / Math.PI - view.rotation;
      while (ang > 90) ang -= 180;
      while (ang < -90) ang += 180;
      const off = 9 * ts;
      const sp = toScreen(mid.point);
      const nrm = { x: -Math.sin((ang * Math.PI) / 180), y: Math.cos((ang * Math.PI) / 180) };
      label(`dist:${st.holeId}`, { x: sp.x - nrm.x * off, y: sp.y - nrm.y * off }, q => textLabel(q, `${fmtDist(st.length, doc.units, false)}${doc.units === "ft" ? "'" : " m"}`, 10 * ts, { angle: ang, weight: 700 }));
    }
  }

  // Walks leaving a basket that holes share: which hole each goes to
  if (s.nextTee) {
    for (const r of sharedWalks(walkRoutes(doc.items, layers.stats, doc.holes))) {
      const len = pathLength(r.points);
      tags.push({ id: `walk:${r.a.holeId}`, at: toScreen(pointAlong(r.points, len * 0.32).point), text: `→ ${r.b.label}`, bg: "#ffffff", fg: "#1b1d1a", o: dim(r.b.holeId) });
    }
  }
  // What the OB, hazard and out-of-play shapes are
  for (const t of tags) {
    const fs = 6.6 * ts, w = (t.text.length * 0.66 + 1.2) * fs, h = fs * 1.55;
    label(t.id, t.at, q => `<g opacity="${t.o}"><rect x="${n(q.x - w / 2)}" y="${n(q.y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="${t.bg}" stroke="#ffffff" stroke-width="${n(0.9 * ts)}"/><text x="${n(q.x)}" y="${n(q.y + 0.3 * ts)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="${n(fs)}" letter-spacing="${n(0.4 * ts)}" fill="${t.fg}">${t.text}</text></g>`);
  }
  // Mandos and drop zones
  const mandos = items.filter(i => i.type === "mando") as MandoItem[];
  for (const m of mandos) {
    // A gate's two posts are drawn together, once
    const pair = m.pairId ? mandos.find(o => o.id === m.pairId) : undefined;
    if (pair && pair.id < m.id) continue;
    sym.push(`<g opacity="${dim(m.holeId)}">${pair ? gateSymbol(toScreen(m), toScreen(pair), m.rotation - view.rotation, 1.3 * ts) : mandoSymbol(toScreen(m), m.rotation - view.rotation, m.side, 1.3 * ts)}</g>`);
  }
  for (const dz of items.filter(i => i.type === "dropzone") as DropZoneItem[]) sym.push(`<g opacity="${dim(dz.holeId)}">${dropZoneSymbol(toScreen(dz), 1.15 * ts)}</g>`);

  // Amenities
  for (const am of items.filter(i => i.type === "amenity") as AmenityItem[]) sym.push(amenitySymbol(am.kind, toScreen(am), 0.85 * ts));

  // Tees and baskets, then hole numbers
  const mainTees = new Set(layers.stats.map(st => st.teeId));
  for (const tee of items.filter(i => i.type === "tee") as TeeItem[]) {
    const o = dim(tee.holeId);
    const lvl = TEE_LEVELS[tee.level];
    // The pad at real size when that's big enough to see, else a minimum size
    const len = Math.max(tee.padLength * k, 9 * ts), wid = Math.max(tee.padWidth * k, 4.5 * ts);
    const c = toScreen(tee);
    const corners = rectCorners(c, len, wid, teeAim(doc, tee) - view.rotation);
    sym.push(`<polygon points="${pts(corners)}" fill="${lvl.color}" stroke="${lvl.color === "#f8fafc" ? "#333" : "#111"}" stroke-width="${n(0.9 * ts)}" opacity="${n(o * (mainTees.has(tee.id) ? 1 : 0.85))}"/>`);
  }
  for (const b of items.filter(i => i.type === "basket") as BasketItem[]) {
    const p = toScreen(b);
    const r = 5.2 * ts;
    const o = Math.max(...[b.holeId, ...(b.alsoHoles ?? [])].map(h => Number(dim(h))));
    const multi = holeBaskets(doc, b.holeId).length > 1;
    // (a basket several holes play to carries each one's number)
    const number = [b.holeId, ...(b.alsoHoles ?? [])].map(h => layers.stats.find(st => st.holeId === h)).filter((st): st is HoleStats => !!st).sort((x, y) => x.number - y.number).map(st => st.label).join("/");
    sym.push(`<g opacity="${o}">${basketMark(s.basketMark ?? "basket", p, 0.72 * ts, s.basket, number)}`);
    if (multi) sym.push(textLabel({ x: p.x + r * 1.6, y: p.y - r * 1.1 }, b.position, 7 * ts, { color: pal.label, weight: 800 }));
    sym.push(`</g>`);
  }
  // Hole number badges at the tees used (the main tee), offset back from the pad
  for (const st of layers.stats) {
    const tee = items.find(i => i.id === st.teeId) as TeeItem | undefined;
    if (!tee) continue;
    const lvl = TEE_LEVELS[tee.level];
    const aim = teeAim(doc, tee);
    const back = toScreen({ x: tee.x - Math.cos((aim * Math.PI) / 180) * (tee.padLength / 2 + 2), y: tee.y - Math.sin((aim * Math.PI) / 180) * (tee.padLength / 2 + 2) });
    const dir = { x: back.x - toScreen(tee).x, y: back.y - toScreen(tee).y };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    const r = 9.5 * ts;
    const at = { x: back.x + (dir.x / dl) * (r + 3 * ts), y: back.y + (dir.y / dl) * (r + 3 * ts) };
    const o = dim(st.holeId);
    if (forest) {
      // Bold white italic numbers beside the tee, as on painted course maps
      const side = { x: -dir.y / dl, y: dir.x / dl };
      const p = { x: toScreen(tee).x + side.x * 14 * ts + (dir.x / dl) * 4 * ts, y: toScreen(tee).y + side.y * 14 * ts + (dir.y / dl) * 4 * ts };
      label(`num:${st.holeId}`, p, q => `<text x="${n(q.x)}" y="${n(q.y)}" font-family="${font}" font-size="${n(15 * ts)}" font-weight="700" font-style="italic" text-anchor="middle" dominant-baseline="central" fill="#ffffff" stroke="rgba(8,20,4,.75)" stroke-width="${n(2.6 * ts)}" stroke-linejoin="round" paint-order="stroke" opacity="${o}">${st.label}</text>`);
      continue;
    }
    label(`num:${st.holeId}`, at, q => `<g opacity="${o}"><circle cx="${n(q.x)}" cy="${n(q.y)}" r="${n(r)}" fill="${lvl.color}" stroke="${lvl.color === "#f8fafc" ? "#1f2937" : "#ffffff"}" stroke-width="${n(1.6 * ts)}"/>${textLabel({ x: q.x, y: q.y + 0.5 * ts }, st.label, 11.5 * ts, { color: lvl.ink, halo: lvl.color, weight: 700 })}</g>`);
  }
  // Text labels placed on the map
  for (const l of items.filter(i => i.type === "label") as LabelItem[]) label(`text:${l.id}`, toScreen(l), q => textLabel(q, l.text, l.fontSize * 0.8 * ts, { color: l.color, weight: 700 }));

  return { svg: `<defs>${defs.join("")}</defs>${out.join("")}${sym.join("")}`, toScreen };
};

// The painted land takes a moment: keep the last few, keyed by what they depend on (so typing a
// title or changing the OB color doesn't repaint it).
const forestCache = new Map<string, string>();
let objectIds = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object | null | undefined) => {
  if (!o) return 0;
  if (!objectIds.has(o)) objectIds.set(o, nextId++);
  return objectIds.get(o)!;
};
/** The painted land's longest side, pixels: full for prints and exports, less for a preview. */
let paintLimit = 2400;
/** A live preview: paint in slices between frames, showing the last picture until it's done. */
let paintLive = false;
/** A print: the painting's pixels per page point (null: as the preview or a quick export). */
let printDensity: number | null = null;
/** The paintings the first drawing of a print asks for (painted before it is drawn again). */
let printJobs: (() => Promise<void>)[] | null = null;
/** How a print's paintings wait between slices (unset: between frames, as fast as they go). */
let printPace: (() => Promise<number>) | null = null;
/** Prints take turns (they share the settings above): the one painting now, and how many wait. */
let printTurn: Promise<void> = Promise.resolve();
let printsWaiting = 0;

/**
 * Draws a page for print: a first drawing notes the paintings it needs, they are painted at
 * `dpi` (a slice at a time, so the page never freezes; at most 250 dpi, plenty for the painted
 * texture, and no bigger than a browser holds), then the page is drawn with them. One at a time:
 * `pace` (painting in spare moments) is told to hurry while another waits its turn.
 */
export const paintedForPrint = async <T>(dpi: number | ((page: T) => number), draw: () => T, pace?: (hurry: () => boolean) => Promise<number>): Promise<T> => {
  const before = printTurn;
  let done = () => {};
  printTurn = new Promise<void>(res => { done = res; });
  printsWaiting++;
  await before;
  printsWaiting--;
  const was = printDensity;
  printPace = pace ? () => pace(() => printsWaiting > 0) : null;
  try {
    // (a resolution that depends on the page: measured by a drawing that paints nothing)
    if (typeof dpi === "function") {
      printDensity = 1;
      printJobs = [];
      dpi = dpi(draw());
    }
    printDensity = Math.min(dpi, 250) / 72;
    printJobs = [];
    draw();
    const jobs = printJobs;
    printJobs = null;
    for (const job of jobs) await job();
    return draw();
  } finally {
    printDensity = was;
    printJobs = null;
    printPace = null;
    done();
  }
};

/**
 * Draws pages for the live preview: the painted land at most `px` pixels across (less on a
 * phone: quicker and lighter on memory), painted a slice at a time between frames so the page
 * never freezes; until a new painting is ready the last one for the same view stands in, and
 * `onPainted` listeners hear when to draw again. What is printed or exported is painted at full
 * size, all at once.
 */
export const withLivePaint = <T>(px: number, draw: () => T): T => {
  // (a print painting meanwhile, between frames, isn't this preview's: its size and its list)
  const was = [paintLimit, paintLive, printDensity, printJobs] as const;
  paintLimit = px;
  paintLive = true;
  printDensity = null;
  printJobs = null;
  try {
    return draw();
  } finally {
    [paintLimit, paintLive, printDensity, printJobs] = was;
  }
};

const paintedListeners = new Set<() => void>();
/** Hear when a live painting is ready (draw the page again). */
export const onPainted = (fn: () => void) => {
  paintedListeners.add(fn);
  return () => { paintedListeners.delete(fn); };
};
/** The painting under way for the live preview (one at a time: a newer one stops it). */
let livePaint: { key: string; stop: AbortController } | null = null;
/** The latest painting for each view of the live preview, standing in while a new one paints. */
const lastForView = new Map<string, string>();
/** The latest live painting of all, and the view it was made for (standing in for a new view). */
let lastLive: { url: string; view: MapView; doc: string; limit: number } | null = null;
/** Live paintings (blob URLs), kept apart from those made for print. */
const liveCache = new Map<string, string>();
/** The last live painting that failed (not tried again). */
let failedPaint: string | null = null;

/** For tests: whether a live painting is under way. */
export const paintingNow = () => !!livePaint;

/** How far the live painting under way is (0..1), or null when none is: heard as it goes. */
let liveProgress = 0;
const progressListeners = new Set<(fraction: number | null) => void>();
export const onPaintProgress = (fn: (fraction: number | null) => void) => {
  progressListeners.add(fn);
  fn(livePaint ? liveProgress : null);
  return () => { progressListeners.delete(fn); };
};
const tellProgress = () => progressListeners.forEach(fn => fn(livePaint ? liveProgress : null));
if (typeof window !== "undefined") (window as any).__dgPainting = paintingNow;

/** Each painting's treetops over the buildings, by the painting's url (a PNG: clear elsewhere), and
 * the buildings mostly under them. */
const overOf = new Map<string, { url: string; hidden: Set<string> }>();
const keepOver = (url: string, over: { url: string; hidden: Set<string> } | null) => {
  if (!over) return;
  overOf.set(url, over);
  if (overOf.size > 16) {
    const [k0, v0] = overOf.entries().next().value!;
    overOf.delete(k0);
    if (v0.url.startsWith("blob:")) URL.revokeObjectURL(v0.url);
  }
};
/** The live painting last shown in each place, and for a moment the one it took over from: a new
 * painting fades in over the last (0.4 s) instead of taking its place at once. */
type Placed = { x: number; y: number; w: number; h: number };
const shownIn = new Map<string, { url: string; at: Placed; before: { url: string; at: Placed } | null; since: number }>();
const fadeFrom = (place: string, url: string, at: Placed) => {
  const now = performance.now(), was = shownIn.get(place);
  if (!was || was.url !== url) {
    shownIn.delete(place);
    shownIn.set(place, { url, at, before: was ? { url: was.url, at: was.at } : null, since: now });
    if (shownIn.size > 24) shownIn.delete(shownIn.keys().next().value!);
  }
  const now2 = shownIn.get(place)!;
  return now2.before && now - now2.since < 400 ? now2.before : null;
};
/** The quick drafts shown while the sharp pictures paint (freed when no longer shown). */
const draftUrls: string[] = [];
const forestPicture = (doc: CourseDoc, view: MapView, layers: MapLayers) => {
  const s = doc.style;
  const canopy = paintsFromPhoto(doc) ? layers.canopy ?? null : null;
  const look = [s.forest, s.treeCover, s.treeLook, s.landscape, s.treeMix, s.autumnVivid, s.conifers, s.contours, s.trees, s.fairway, s.rough, s.tallGrass, s.water, s.path, s.nextTee, s.walkWidth, s.hillshade, s.sunAngle, s.sunHeight, s.shadows, s.light, s.contrast, s.colorStrength, s.paint, s.reliefScale, s.reliefLook, s.mapLook, s.lookParts, s.lightMode, s.goldenSun, s.sunFrom, s.pathOrder, doc.site.location, doc.site.bounds];
  const key = JSON.stringify([paintLimit, printDensity, view, look, idOf(canopy), idOf(doc.terrainHeights), layers.stats.map(st => [st.holeId, st.line]), paintedFrom(doc), doc.canvas, doc.id]);
  // (A live preview may show a picture made for print; a print never uses a live one, which is a
  // blob only this page can read)
  const hit = (paintLive && liveCache.get(key)) || forestCache.get(key);
  const viewKey = JSON.stringify([paintLimit, view, doc.id]);
  if (hit) {
    if (paintLive) {
      lastForView.set(viewKey, hit);
      lastLive = { url: hit, view, doc: doc.id ?? "", limit: paintLimit };
    }
    return { url: hit, view };
  }
  // (a print: its resolution, up to about 32 million pixels)
  // (live: about as many pixels as the screen shows, `paintLimit` along the long side; a big poster
  // isn't painted at print size while it's being designed)
  const density = printDensity !== null ? Math.min(printDensity, Math.sqrt(32e6 / Math.max(1, view.width * view.height))) : Math.min(3, Math.max(0.3, paintLimit / Math.max(view.width, view.height)));
  const opts = { mode: s.forest ?? "everywhere", canopy, style: s, density } as const;
  // A photo-like picture: JPEG keeps it a tenth the size of a PNG
  const keep = (canvas: HTMLCanvasElement) => {
    const url = canvas.toDataURL("image/jpeg", 0.9);
    const over = treesOverOf(canvas);
    keepOver(url, over ? { url: over.picture.toDataURL("image/png"), hidden: over.hidden } : null);
    forestCache.set(key, url);
    if (forestCache.size > 6) forestCache.delete(forestCache.keys().next().value!);
    return { url, view };
  };
  if (printJobs) {
    // (a print's first drawing: painted between frames, and finer JPEG, before it is drawn again)
    const pace = printPace ?? undefined;
    printJobs.push(async () => {
      if (forestCache.has(key)) return;
      const canvas = await forestCanvasAsync(doc, view, layers.stats, opts, undefined, undefined, pace);
      const over = treesOverOf(canvas);
      const overUrl = over ? { url: over.picture.toDataURL("image/png"), hidden: over.hidden } : null;
      const url = await new Promise<string>((res, rej) => canvas.toBlob(b => {
        if (!b) return rej(new Error("The map couldn't be painted."));
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error("The map couldn't be painted."));
        r.readAsDataURL(b);
      }, "image/jpeg", 0.95));
      canvas.width = canvas.height = 1;
      keepOver(url, overUrl);
      forestCache.set(key, url);
      if (forestCache.size > 6) forestCache.delete(forestCache.keys().next().value!);
    });
    return null;
  }
  if (!paintLive) return keep(forestCanvas(doc, view, layers.stats, opts));
  // Live: paint in the background (unless already under way), meanwhile the last picture
  if (livePaint?.key !== key && failedPaint !== key) {
    livePaint?.stop.abort();
    const job = { key, stop: new AbortController() };
    livePaint = job;
    liveProgress = 0;
    queueMicrotask(tellProgress);
    // First a quick draft (a fifth of the pixels: shown in a moment), then the sharp picture
    const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("no picture"))), "image/jpeg", 0.9));
    // (and its treetops over the buildings, as a PNG, the same moment)
    let overBlob: Promise<Blob | null> = Promise.resolve(null), overHidden = new Set<string>();
    const withOver = (canvas: HTMLCanvasElement) => {
      const over = treesOverOf(canvas);
      overHidden = over?.hidden ?? new Set();
      overBlob = over ? new Promise<Blob | null>(res => over.picture.toBlob(b => res(b), "image/png")) : Promise.resolve(null);
      return canvas;
    };
    const tieOver = async (url: string) => { const hidden = overHidden, b = await overBlob; if (b) keepOver(url, { url: URL.createObjectURL(b), hidden }); };
    const draftDensity = density * 0.32;
    // (no draft when only colors or tone changed: the last painting, kept, makes the sharp one as quickly)
    const draft = !paintsAgain(doc, view, layers.stats, opts) && draftDensity * Math.max(view.width, view.height) >= 500
      ? forestCanvasAsync(doc, view, layers.stats, { ...opts, density: draftDensity }, job.stop.signal, f => { if (livePaint === job) { liveProgress = f * 0.3; tellProgress(); } })
        .then(withOver)
        .then(toBlob)
        .then(async blob => {
          if (livePaint !== job) return;
          const url = URL.createObjectURL(blob);
          await tieOver(url);
          draftUrls.push(url);
          while (draftUrls.length > 3) URL.revokeObjectURL(draftUrls.shift()!);
          lastForView.set(viewKey, url);
          lastLive = { url, view, doc: doc.id ?? "", limit: paintLimit };
          paintedListeners.forEach(fn => fn());
        })
      : Promise.resolve();
    void draft
      .then(() => forestCanvasAsync(doc, view, layers.stats, { ...opts, keep: true }, job.stop.signal, f => {
        if (livePaint !== job) return;
        liveProgress = 0.3 + f * 0.7;
        tellProgress();
      }))
      // (encoded off the page's thread, unlike toDataURL)
      .then(withOver)
      .then(toBlob)
      .then(async blob => {
        const url = URL.createObjectURL(blob);
        await tieOver(url);
        liveCache.set(key, url);
        if (liveCache.size > 6) {
          const [oldKey, oldUrl] = liveCache.entries().next().value!;
          liveCache.delete(oldKey);
          for (const [v, u] of lastForView) if (u === oldUrl) lastForView.delete(v);
          if (lastLive?.url === oldUrl) lastLive = null;
          URL.revokeObjectURL(oldUrl);
        }
        lastForView.set(viewKey, url);
        if (lastForView.size > 8) lastForView.delete(lastForView.keys().next().value!);
        lastLive = { url, view, doc: doc.id ?? "", limit: paintLimit };
        if (livePaint === job) livePaint = null;
        tellProgress();
        paintedListeners.forEach(fn => fn());
      }, (err: unknown) => {
        if (livePaint === job) livePaint = null;
        tellProgress();
        // (stopped for a newer one: nothing to do; a painting that failed is said, and not tried
        // again until the course changes)
        if (job.stop.signal.aborted) return;
        console.error("The map couldn't be painted:", err);
        failedPaint = key;
        paintedListeners.forEach(fn => fn());
      });
  }
  const same = lastForView.get(viewKey);
  if (same) return { url: same, view };
  return lastLive && lastLive.doc === (doc.id ?? "") && lastLive.limit === paintLimit && lastLive.view.rotation === view.rotation ? { url: lastLive.url, view: lastLive.view } : null;
};
export const resetForestCache = () => {
  forestCache.clear();
  livePaint?.stop.abort();
  livePaint = null;
  tellProgress();
  for (const url of liveCache.values()) URL.revokeObjectURL(url);
  liveCache.clear();
  lastForView.clear();
  lastLive = null;
  objectIds = new WeakMap();
};

/** Lighter (amount > 0) or darker (< 0) version of a hex color. */
export const shade = (hex: string, amount: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const ch = (c: number) => Math.round(Math.max(0, Math.min(255, amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const r = ch((v >> 16) & 255), g = ch((v >> 8) & 255), b = ch(v & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
};

/** A polyline trimmed to the part between two distances along it. */
const trimPath = (line: P[], from: number, to: number) => {
  if (to <= from) return line;
  const out: P[] = [pointAlong(line, from).point];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += dist(line[i - 1], line[i]);
    if (acc > from && acc < to) out.push(line[i]);
  }
  out.push(pointAlong(line, to).point);
  return out;
};

/** A good spot inside a polygon for its name (its middle, or the most inside of a few tries). */
const labelPoint = (poly: P[]) => {
  const b = boundsOf(poly);
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  if (pointInPolygon(c, poly)) return c;
  let best = c, bestD = -1;
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    const p = { x: b.minX + ((b.maxX - b.minX) * i) / 8, y: b.minY + ((b.maxY - b.minY) * j) / 8 };
    if (!pointInPolygon(p, poly)) continue;
    const d = Math.min(...poly.map((q, k) => {
      const r = poly[(k + 1) % poly.length];
      return segDist(p, q, r);
    }));
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
};
const segDist = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};

/** Woods: the area in canopy green, with crowns scattered over it (deterministic). */
const woods = (a: AreaItem, color: string, k: number, uid: string, shadow: number, o: number) => {
  const b = boundsOf(a.points);
  const step = Math.max(14, 9 / k);
  const crowns: string[] = [];
  const shadows: string[] = [];
  let seed = Math.round(Math.abs(b.minX * 7 + b.minY * 13)) % 2147483646 + 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = b.minY; y <= b.maxY; y += step * 0.85) {
    for (let x = b.minX; x <= b.maxX; x += step) {
      const p = { x: x + (rnd() - 0.5) * step * 0.8, y: y + (rnd() - 0.5) * step * 0.8 };
      if (!pointInPolygon(p, a.points)) continue;
      const r = step * (0.55 + rnd() * 0.3);
      if (shadow > 0) shadows.push(`<circle cx="${n(p.x + r * 0.25)}" cy="${n(p.y + r * 0.3)}" r="${n(r)}"/>`);
      crowns.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(r)}" fill="${shade(color, (rnd() - 0.5) * 0.18)}"/>`);
    }
  }
  const clip = `${uid}-w${Math.abs(Math.round(b.minX + b.minY * 3))}`;
  return `<g opacity="${o}"><clipPath id="${clip}"><polygon points="${pts(a.points)}"/></clipPath><polygon points="${pts(a.points)}" fill="${shade(color, -0.15)}"/><g clip-path="url(#${clip})"><g fill="#081405" opacity="${n(shadow)}">${shadows.join("")}</g>${crowns.join("")}<g fill="url(#${uid}-crown)">${crowns.join("").replace(/ fill="#[0-9a-f]{6}"/gi, "")}</g></g></g>`;
};

// ------------------------------------------------------------------ the poster

export type PosterOptions = { contours: Contours | null; hillshade: string | null; canopy?: CanopyGrid | null; dpi?: number };

/** The page size in inches for the style's paper and orientation (auto: to suit the course's shape). */
export const pageSize = (doc: CourseDoc, aspect: number) => {
  const p = PAPER[doc.style.paper];
  const landscape = doc.style.orientation === "landscape" || (doc.style.orientation === "auto" && aspect > 1.05);
  return landscape ? { w: Math.max(p.w, p.h), h: Math.min(p.w, p.h) } : { w: Math.min(p.w, p.h), h: Math.max(p.w, p.h) };
};

/** The part of the plan the map shows: the holes and what is around them, inside the site. */
export const courseBounds = (doc: CourseDoc, stats: HoleStats[]) => {
  const pts: P[] = [];
  stats.forEach(s => pts.push(...s.line));
  doc.items.forEach(i => { if (i.type === "tee" || i.type === "basket" || i.type === "mando" || i.type === "dropzone" || i.type === "amenity") pts.push(i); });
  if (pts.length < 2) return { minX: 0, minY: 0, maxX: doc.canvas.width, maxY: doc.canvas.height };
  const b = boundsOf(pts);
  const pad = Math.max(80, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08);
  return {
    minX: Math.max(doc.site.bounds ? 0 : -Infinity, b.minX - pad),
    minY: Math.max(doc.site.bounds ? 0 : -Infinity, b.minY - pad),
    maxX: Math.min(doc.site.bounds ? doc.canvas.width : Infinity, b.maxX + pad),
    maxY: Math.min(doc.site.bounds ? doc.canvas.height : Infinity, b.maxY + pad)
  };
};

/** How much of a rectangle (in the turned frame) a convex outline covers: the outline clipped to it. */
const coveredBy = (outline: P[], x0: number, y0: number, x1: number, y1: number) => {
  let poly = outline;
  const clip = (inside: (p: P) => boolean, cut: (a: P, b: P) => P) => {
    const out: P[] = [];
    poly.forEach((b, i) => {
      const a = poly[(i + poly.length - 1) % poly.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    });
    poly = out;
  };
  const atX = (x: number) => (a: P, b: P) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  const atY = (y: number) => (a: P, b: P) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
  clip(p => p.x >= x0, atX(x0)); clip(p => p.x <= x1, atX(x1));
  clip(p => p.y >= y0, atY(y0)); clip(p => p.y <= y1, atY(y1));
  return poly.length > 2 ? Math.abs(polygonArea(poly)) : 0;
};

/**
 * Where the map's middle goes (plan feet): the course's middle, slid as far as the course still
 * fits (inside `margin`, page points) to show as little as can be of the land past the site's
 * measured ground, which has no heights, measured trees or photo. `box` is the course with its
 * room round it, in the frame turned by `rotation`; the map is `w` by `h` points at `scale`.
 */
const leastOffSite = (doc: CourseDoc, box: { minX: number; minY: number; maxX: number; maxY: number }, rotation: number, scale: number, w: number, h: number, margin: number, clear?: { pts: P[]; boxes: { x: number; y: number; w: number; h: number }[]; near: number }) => {
  const mid = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const hw = w / 2 / scale, hh = h / 2 / scale, mm = margin / scale;
  // (how far it can go each way)
  const sx = Math.max(0, hw - mm - (box.maxX - box.minX) / 2), sy = Math.max(0, hh - mm - (box.maxY - box.minY) / 2);
  const measured = !!doc.background || Object.keys(doc.terrainHeights).length > 3;
  // (and, given `clear`, never with one of its points, in the turned frame, under one of its boxes
  // on the page: none such, null)
  const blocked = (c: P) => !!clear && clear.pts.some(q => {
    const x = w / 2 + (q.x - c.x) * scale, y = h / 2 + (q.y - c.y) * scale;
    return clear.boxes.some(b => x > b.x - clear.near && x < b.x + b.w + clear.near && y > b.y - clear.near && y < b.y + b.h + clear.near);
  });
  if (!clear && (!measured || (sx < 1 && sy < 1))) return rotatePoint(mid, rotation);
  const site = [{ x: 0, y: 0 }, { x: doc.canvas.width, y: 0 }, { x: doc.canvas.width, y: doc.canvas.height }, { x: 0, y: doc.canvas.height }].map(q => rotatePoint(q, -rotation));
  // (past the ground, in square feet; among places as good, the one nearest the middle)
  const off = (c: P) => (blocked(c) ? Infinity : (measured ? 4 * hw * hh - coveredBy(site, c.x - hw, c.y - hh, c.x + hw, c.y + hh) : 0) + ((c.x - mid.x) ** 2 + (c.y - mid.y) ** 2) * 1e-3);
  let best = mid, bestOff = off(mid), rx = sx, ry = sy;
  // (a grid over where it can go, then finer round the best)
  for (let round = 0; round < 5; round++) {
    const from = best;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const c = { x: Math.max(mid.x - sx, Math.min(mid.x + sx, from.x + (i / 6) * rx)), y: Math.max(mid.y - sy, Math.min(mid.y + sy, from.y + (j / 6) * ry)) };
      const v = off(c);
      if (v < bestOff) { best = c; bestOff = v; }
    }
    rx /= 4; ry /= 4;
  }
  return bestOff < Infinity ? rotatePoint(best, rotation) : null;
};

/**
 * The whole course map page as an SVG document, sized in points (1/72 in): the map with the
 * title on top, the legend and the hole table at the side (or below, on a tall page).
 */
/** The points a map must show (tees, baskets, throw lines, mandos...), for fitting and turning it. */
export const coursePoints = (doc: CourseDoc, stats: HoleStats[]) => {
  const pts: P[] = [];
  stats.forEach(s => pts.push(...s.line));
  doc.items.forEach(i => { if (i.type === "tee" || i.type === "basket" || i.type === "mando" || i.type === "dropzone" || i.type === "amenity") pts.push(i); });
  return pts;
};

/** The turn (degrees) that lets the course fill a page of this shape best. */
export const bestRotation = (doc: CourseDoc) => {
  const stats = doc.holes.map(h => holeStats(doc, h, activeLayout(doc)));
  const pts = coursePoints(doc, stats);
  if (pts.length < 2) return 0;
  const p = PAPER[doc.style.paper];
  const long = Math.max(p.w, p.h), short = Math.min(p.w, p.h);
  let best = { deg: 0, scale: 0 };
  for (let deg = -90; deg < 90; deg += 3) {
    const b = boundsOf(pts.map(q => rotatePoint(q, -deg)));
    const w = Math.max(1, b.maxX - b.minX), h = Math.max(1, b.maxY - b.minY);
    // Either orientation of the paper
    const scale = Math.max(Math.min(long / w, short / h), Math.min(short / w, long / h));
    // Prefer north up when it's nearly as good
    if (scale > best.scale * (deg === 0 ? 0.97 : 1.03)) best = { deg, scale };
  }
  return best.deg;
};

/**
 * The whole course map page as an SVG document, sized in points (1/72 in). The Forest style is a
 * full-bleed picture with the title laid over the emptiest corner; the others put the title on
 * top and the legend and hole table at the side (or below, on a tall page).
 */
/** The course map's page, in its frame (see MapStyle.frame): the same on every side. */
export const renderPoster = (doc: CourseDoc, opts: PosterOptions) => {
  const out = posterPage(doc, opts);
  const f = doc.style.frame;
  if (!f) return out;
  const { width: W, height: H } = out;
  const t = Math.min(W, H) / 612; // 1 on a letter page's short side
  const pal = palette(doc.style), ink = doc.style.card?.ink ?? "#1d2a1b", paper = doc.style.card?.paper ?? "#f4efe0";
  const band = f === "mat" ? 14 * t : f === "band" ? 18 * t : 0;
  const ring = (inset: number, w: number, c: string, o = 1) => `<rect x="${n(inset + w / 2)}" y="${n(inset + w / 2)}" width="${n(W - 2 * inset - w)}" height="${n(H - 2 * inset - w)}" fill="none" stroke="${c}" stroke-opacity="${o}" stroke-width="${n(w)}"/>`;
  const art = f === "line" ? ring(10 * t, 1.2 * t, pal.ink ?? ink, 0.8) + ring(14 * t, 0.6 * t, pal.ink ?? ink, 0.5)
    : f === "mat" ? ring(0, band, paper) + ring(band, 0.8 * t, ink, 0.45)
    : ring(0, band, doc.style.card?.header ?? "#13311d") + ring(band, 1 * t, paper, 0.7);
  // (its inside edge, for pieces to line up with on the Design page)
  const inner = f === "line" ? 14 * t + 0.6 * t : band + (f === "mat" ? 0.8 : 1) * t;
  return { ...out, svg: out.svg.replace(/<\/svg>\s*$/, `<g data-part="frame" data-inset="${n(inner)}" pointer-events="none">${art}</g></svg>`) };
};

/** The tagline as the painted map's title prints it: none when the course's name already says
 * golf (other than ending in "Disc Golf Course", which the tagline then stands in for). */
export const taglineFits = (doc: Pick<CourseDoc, "name" | "style">) => {
  const name = (doc.style.title || doc.name).trim().replace(/^the\s+/i, "");
  return /\s+disc\s+golf(\s+course)?$/i.test(name) || !/golf/i.test(doc.style.title || doc.name);
};
export const mapTagline = (doc: CourseDoc) => (taglineFits(doc) ? taglineOf(doc.style) : "");

/** The credits the map's sources ask for (the photo's, OpenStreetMap's, the buildings'): printed
 * whatever the credit line's own words are, even with them hidden. */
export const requiredCredit = (doc: CourseDoc) => [
  doc.site.imagerySource && doc.style.theme === "satellite" ? "Imagery © Esri" : "",
  // (anything from OpenStreetMap: its areas, lines, buildings, benches, trees, or the holes of a course mapped there)
  doc.site.holesFromOsm || doc.items.some(i => "importSource" in i && i.importSource === "osm") ? "Map data © OpenStreetMap contributors" : "",
  doc.items.some(i => i.type === "structure" && i.importSource === "traced") ? "Buildings © Overture Maps Foundation, Microsoft" : "",
  doc.items.some(i => (i.type === "line" || i.type === "area") && i.importSource === "usgs") ? GOV_CREDITS.usgs : "",
  doc.items.some(i => i.type === "area" && i.importSource === "nwi") ? GOV_CREDITS.nwi : "",
  doc.items.some(i => i.type === "structure" && i.importSource === "fema") ? GOV_CREDITS.fema : ""
].filter(Boolean).join(" · ");

const posterPage = (doc: CourseDoc, opts: PosterOptions) => {
  const s = doc.style;
  const pal = palette(s);
  const layout = activeLayout(doc);
  const stats = doc.holes.map(h => holeStats(doc, h, layout));
  const totals = courseTotals(doc, stats);
  const rotation = s.rotation || 0;
  // The course's extent in the turned frame: its tees, baskets, throws and amenities, nothing more
  // (the room their numbers and labels need is kept on the page, so the map comes in as close as
  // they allow and shows as little as it can past them; a course with no holes yet: the site)
  const pts = coursePoints(doc, stats);
  const raw = courseBounds(doc, stats);
  const few = pts.length < 2;
  const box = boundsOf((few ? [{ x: raw.minX, y: raw.minY }, { x: raw.maxX, y: raw.minY }, { x: raw.maxX, y: raw.maxY }, { x: raw.minX, y: raw.maxY }] : pts).map(q => rotatePoint(q, -rotation)));
  const bw = Math.max(50, box.maxX - box.minX), bh = Math.max(50, box.maxY - box.minY);
  const page = pageSize(doc, bw / bh);
  const W = page.w * 72, H = page.h * 72;
  const ts = (Math.min(W, H) / (8.5 * 72)) * s.labelScale;
  const m = 0.35 * 72 * Math.max(1, ts * 0.8);
  // (round the outermost tee, basket or amenity: its hole number, its label)
  const room = few ? 0 : 26 * ts;
  const font = fontStack(s.font, !!s.titleFont);
  const landscape = W > H;
  const full = s.theme === "forest";
  const title = s.title || doc.name;
  // (what's typed; or, never typed, the place and designer; " ": taken out)
  const sub = s.subtitle?.trim() ? s.subtitle.trim() : s.subtitle ? "" : [doc.site.location?.label, doc.designer ? `Designed by ${doc.designer}` : ""].filter(Boolean).join(" · ");
  const parts: string[] = [];
  parts.push(`<rect width="${n(W)}" height="${n(H)}" fill="${pal.paper}"/>`);
  const required = requiredCredit(doc);
  // (the credit line hidden: the owner's own words go, what the sources ask for stays)
  const credit = [full && s.page?.credit?.hidden ? "" : s.footer, required].filter(Boolean).join(" · ");

  if (full) {
    // Everything on the page is an element of its own: put where it goes by itself, or where it
    // was moved, sized and colored by hand (the Design step), or left out
    const pageEls = s.page ?? {};
    const el = (id: PageElementId): PageElementStyle => pageEls[id] ?? {};
    type Box = { x: number; y: number; w: number; h: number };
    const pieces: Box[] = [];
    const placed = (id: string, o: { x?: number; y?: number; scale?: number; hidden?: boolean; rot?: number; opacity?: number }, box: Box, content: string) => {
      if (o.hidden) return;
      const k = keepsItsSize(id) ? 1 : o.scale ?? 1;
      // (kept at least partly on the page)
      const X = o.x !== undefined ? Math.max(10 - box.w * k, Math.min(W - 10, o.x * W)) : box.x;
      const Y = o.y !== undefined ? Math.max(10 - box.h * k, Math.min(H - 10, o.y * H)) : box.y;
      pieces.push({ x: X, y: Y, w: box.w * k, h: box.h * k });
      // (with a box to pick it by on the Design page, never drawn)
      parts.push(`<g data-el="${id}" data-box="${n(X)} ${n(Y)} ${n(box.w * k)} ${n(box.h * k)}" transform="translate(${n(X)} ${n(Y)}) scale(${n(k)}) translate(${n(-box.x)} ${n(-box.y)})"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="none" pointer-events="all"/>${turned(content, keepsItsTurn(id) ? undefined : o.rot, o.opacity)}</g>`);
    };
    // The map fills the page; the course fits inside a margin. Its labels can be dragged on the
    // Design page (the map's scale and turn say how far that is on the ground). Tried first as close
    // in as the course allows, the page's pieces laid out over it; a tee, basket or amenity under
    // one of them (the title, the legend, the north arrow...), it's tried a little farther out,
    // until none is. Only the last is drawn: the tries need only where the course falls
    const base = parts.length, turnedPts = pts.map(q => rotatePoint(q, -rotation)), near = 8 * ts;
    // (the pieces the last try had a point under: kept clear of, sliding the course first)
    let clearOf: { x: number; y: number; w: number; h: number }[] | null = null, slid = false;
    for (let out = 0, last = false; ; ) {
      parts.length = base;
      pieces.length = 0;
      const scale = Math.min((W - 2 * (m + room)) / bw, (H - 2 * (m + room)) / bh) / (1 + out);
      const center = (clearOf && leastOffSite(doc, box, rotation, scale, W, H, m + room, { pts: turnedPts, boxes: clearOf, near })) || leastOffSite(doc, box, rotation, scale, W, H, m + room)!;
      const view: MapView = { cx: center.x, cy: center.y, rotation, scale, width: W, height: H };
      const onPage = (q: P) => { const r = rotatePoint({ x: q.x - center.x, y: q.y - center.y }, -rotation); return { x: W / 2 + r.x * scale, y: H / 2 + r.y * scale }; };
      const map = last ? renderMapLayers(doc, view, { stats, contours: opts.contours, hillshade: opts.hillshade, textScale: ts * 0.9, fontFamily: s.font, canopy: opts.canopy, labelAt: s.labelAt ?? {} }, "pm") : { svg: "", toScreen: onPage };
      parts.push(`<g data-el="map" data-box="0 0 ${n(W)} ${n(H)}" data-k="${scale}" data-rot="${rotation}">${map.svg}</g>`);
      // The emptiest corner for the title
      const shown = pts.map(map.toScreen);
      const bw2 = W * 0.42, bh2 = H * 0.4;
      const spots = [{ x: 0, y: 0 }, { x: W - bw2, y: 0 }, { x: 0, y: H - bh2 }, { x: W - bw2, y: H - bh2 }];
      const busy = (c: P) => shown.filter(p => p.x >= c.x && p.x <= c.x + bw2 && p.y >= c.y && p.y <= c.y + bh2).length;
      const spot = spots.reduce((a, c) => (busy(c) < busy(a) ? c : a));
      const left = spot.x === 0, top = spot.y === 0;
      {
        const te = el("title");
        const ink = te.ink ?? "#ffffff";
        const out: string[] = [];
        const tx = left ? m : W - m, anchor = left ? "start" : "end";
        const ty0 = top ? m + 6 * ts : H - bh2 + m;
        let ty = ty0;
        const shadow = `filter="url(#title-shadow)"`;
        // "The" small, the name big, "DISC GOLF COURSE" spaced out
        let name = title.trim();
        const the = /^the\s+/i.test(name);
        if (the) name = name.replace(/^the\s+/i, "");
        const course = /\s+disc\s+golf(\s+course)?$/i.test(name);
        if (course) name = name.replace(/\s+disc\s+golf(\s+course)?$/i, "");
        // (in the title's own font, else the course name font)
        const tf = te.font || titleFontOf(s);
        const big = Math.min(54 * ts, ((W * 0.4) / Math.max(4, name.length)) * (keepsCase(tf) ? 2.1 : 1.9));
        let tw = name.length * big * (keepsCase(tf) ? 0.48 : 0.6);
        if (the) { out.push(`<text x="${n(tx)}" y="${n(ty + 12 * ts)}" text-anchor="${anchor}" font-family="${font}" font-weight="700" font-style="italic" font-size="${n(13 * ts)}" fill="${ink}" ${shadow}>THE</text>`); ty += 10 * ts; }
        out.push(`<text${fitAttr(W * 0.42)} x="${n(tx)}" y="${n(ty + big * 0.95)}" text-anchor="${anchor}" font-family="${titleStack(tf)}" font-weight="700" font-size="${n(big)}" fill="${ink}" ${shadow}>${esc(keepsCase(tf) ? name : name.toUpperCase())}</text>`);
        ty += big * 1.15;
        const golf = mapTagline(doc);
        out.push(`<text x="${n(tx)}" y="${n(ty + 12 * ts)}" text-anchor="${anchor}" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="${n(12 * ts)}" letter-spacing="${n(3.2 * ts)}" fill="${ink}" ${shadow}>${esc(golf)}</text>`);
        tw = Math.max(tw, golf.length * (12 * 0.66 + 3.2) * ts);
        ty += 20 * ts;
        if (sub) {
          out.push(`<text x="${n(tx)}" y="${n(ty + 6 * ts)}" text-anchor="${anchor}" font-family="Inter, Arial, sans-serif" font-weight="600" font-size="${n(6.5 * ts)}" letter-spacing="${n(1 * ts)}" fill="${te.ink ?? "#e7f0e2"}" ${shadow}>${esc(sub.toUpperCase())}</text>`);
          tw = Math.max(tw, sub.length * (6.5 * 0.66 + 1) * ts);
          ty += 14 * ts;
        }
        // Layout chips: name with a rule in the tee color (when there's more than one), then
        // PAR | LENGTH on black; none once the title's Par and length is switched off
        const chips = te.parLength === false ? [] : doc.layouts.slice(0, 3).map(l => {
          const ls = doc.holes.map(h => holeStats(doc, h, l)).filter(x => x.complete);
          // (a hole played as two numbers counts twice)
          return { l, par: ls.reduce((t, x) => t + x.par * playsOf(doc, x.holeId), 0), len: ls.reduce((t, x) => t + x.length * playsOf(doc, x.holeId), 0) };
        }).filter(c => c.par > 0);
        const cw = 104 * ts, chH = 20 * ts, named = doc.layouts.length > 1, cy0 = named ? 12 * ts : 2 * ts;
        chips.forEach((c, i) => {
          const x0 = left ? tx + i * (cw + 8 * ts) : tx - (chips.length - i) * (cw + 8 * ts) + 8 * ts;
          const col = TEE_LEVELS[c.l.tee].color;
          if (named) {
            out.push(`<text${fitAttr(50 * ts)} x="${n(x0)}" y="${n(ty + 8 * ts)}" font-family="Oswald, Arial, sans-serif" font-weight="600" font-size="${n(7 * ts)}" fill="${col}" ${shadow}>${esc(`${c.l.name} layout`.toUpperCase())}</text>`);
            out.push(`<rect x="${n(x0 + 52 * ts)}" y="${n(ty + 5.5 * ts)}" width="${n(cw - 52 * ts)}" height="${n(1.4 * ts)}" fill="${col}"/>`);
          }
          out.push(`<rect x="${n(x0)}" y="${n(ty + cy0)}" width="${n(cw)}" height="${n(chH)}" fill="#0b0f0a" fill-opacity="0.88"/>`);
          out.push(`<text${fitAttr(cw - 8 * ts)} x="${n(x0 + cw / 2)}" y="${n(ty + cy0 + chH / 2)}" text-anchor="middle" dominant-baseline="central" font-family="Oswald, Arial, sans-serif" font-weight="600" font-size="${n(11 * ts)}" fill="${col === "#f8fafc" ? "#ffffff" : col}">PAR ${c.par} <tspan fill="#ffffff" fill-opacity="0.6">|</tspan> ${esc(fmtDist(c.len, doc.units).toUpperCase())}</text>`);
        });
        if (chips.length) { tw = Math.max(tw, chips.length * (cw + 8 * ts)); ty += cy0 + chH; }
        const box = { x: left ? tx : tx - tw, y: ty0, w: tw, h: ty - ty0 + 4 * ts };
        // A soft dark glow behind it (its strength: the panel's solidness)
        const glow = te.bgOpacity ?? 0.55;
        parts.push(`<defs><filter id="title-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${n(1.5 * ts)}" stdDeviation="${n(2.5 * ts)}" flood-color="#000" flood-opacity="0.65"/></filter><radialGradient id="title-glow"><stop offset="0" stop-color="${te.bg ?? "#050b04"}" stop-opacity="${n(glow)}"/><stop offset="1" stop-color="${te.bg ?? "#050b04"}" stop-opacity="0"/></radialGradient></defs>`);
        if (glow > 0) out.unshift(`<ellipse pointer-events="none" cx="${n(box.x + box.w / 2)}" cy="${n(box.y + box.h / 2)}" rx="${n(box.w * 0.85 + 40 * ts)}" ry="${n(box.h * 0.95 + 30 * ts)}" fill="url(#title-glow)"/>`);
        if (title || sub) placed("title", te, box, out.join(""));
      }
      // North arrow, scale bar, hole guide and legend in the other corners
      const other = spots.filter(c => c !== spot).sort((a, b) => busy(a) - busy(b));
      if (s.north) {
        const c = other[0];
        const nx = c.x === 0 ? m + 16 * ts : W - m - 16 * ts, ny = c.y === 0 ? m + 20 * ts : H - m - 30 * ts;
        placed("north", el("north"), { x: nx - 18 * ts, y: ny - 24 * ts, w: 36 * ts, h: 46 * ts }, `<g transform="translate(${n(nx)} ${n(ny)}) rotate(${n(-rotation)})">${northArrow(0, 0, 15 * ts, pal)}</g>`);
      }
      if (s.scale) {
        const sx = left && !top ? W - m - 150 * ts : m, sy = H - m * 0.9;
        const sw = scaleBarWidth(scale, ts, doc.units);
        placed("scale", el("scale"), { x: sx - 4 * ts, y: sy - 18 * ts, w: sw + 30 * ts, h: 18 * ts }, scaleBar(sx, sy, scale, ts, { ...pal, panel: "rgba(8,14,7,.7)", ink: "#ffffff" }, doc.units));
      }
      const c = other[1] ?? other[0];
      const pw = 190 * ts;
      const px = c.x === 0 ? m : W - m - pw;
      /** A panel's colors: its own where set. */
      const panelOf = (e: PageElementStyle) => ({ fill: e.bg ?? PAGE_PANEL.bg, opacity: e.bgOpacity ?? PAGE_PANEL.opacity, pal: { ...pal, panelInk: e.ink ?? PAGE_PANEL.ink } });
      // The hole guide
      let holesBox: Box | null = null, holesSvg = "";
      if (s.holeTable) {
        const he = el("holes"), pc = panelOf(he);
        const head = he.heading?.trim();
        const y0 = 0;
        const t = holeTable(doc, stats, px + 10 * ts, y0 + (head ? 30 : 14) * ts, pw - 20 * ts, ts * 0.9, pc.pal, font, "vertical", H * 0.6, he.columns);
        const h = t.bottom - y0 + 6 * ts;
        holesBox = { x: px, y: y0, w: pw, h };
        holesSvg = `<rect x="${n(px)}" y="${n(y0)}" width="${n(pw)}" height="${n(h)}" rx="${n(6 * ts)}" fill="${pc.fill}" fill-opacity="${n(pc.opacity)}"/>${head ? `<text x="${n(px + 10 * ts)}" y="${n(y0 + 14 * ts)}" font-family="${font}" font-weight="700" font-size="${n(10 * ts)}" fill="${pc.pal.panelInk}">${esc(head.toUpperCase())}</text>` : ""}${t.svg}`;
      }
      // The legend
      let legendBox: Box | null = null, legendSvg = "";
      if (s.legend) {
        const le = el("legend"), pc = panelOf(le);
        const lg = legend(doc, px + 10 * ts, 14 * ts, pw - 20 * ts, ts * 0.9, pc.pal, font, le.heading);
        const h = lg.bottom + 6 * ts;
        legendBox = { x: px, y: 0, w: pw, h };
        legendSvg = `<rect x="${n(px)}" y="0" width="${n(pw)}" height="${n(h)}" rx="${n(6 * ts)}" fill="${pc.fill}" fill-opacity="${n(pc.opacity)}"/>${lg.svg}`;
      }
      // Stacked in their corner (top down, or bottom up), the legend after the guide
      const gap = 8 * ts;
      const stack = [holesBox && { id: "holes", box: holesBox, svg: holesSvg }, legendBox && { id: "legend", box: legendBox, svg: legendSvg }].filter(Boolean) as { id: "holes" | "legend"; box: Box; svg: string }[];
      let yy = c.y === 0 ? m : H - m - 14 * ts - stack.reduce((t, e) => t + e.box.h, 0) - gap * Math.max(0, stack.length - 1);
      for (const e of stack) {
        const natural = { ...e.box, y: yy };
        const o = el(e.id);
        // (an older course's legend position)
        const legacy = e.id === "legend" || (e.id === "holes" && !s.legend) ? s.legendAt : undefined;
        placed(e.id, o.x === undefined && legacy ? { ...o, x: legacy.x, y: legacy.y } : o, natural, `<g transform="translate(0 ${n(yy)})">${e.svg}</g>`);
        yy += e.box.h + gap;
      }
      // The credit line
      if (credit) {
        const ce = el("credit");
        const cx = W - m * 0.6, cy = H - m * 0.35, cwid = credit.length * 6 * ts * 0.55;
        placed("credit", { ...ce, hidden: undefined }, { x: cx - cwid, y: cy - 7 * ts, w: cwid, h: 9 * ts }, `<text x="${n(cx)}" y="${n(cy)}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="${n(6 * ts)}" fill="${ce.ink ?? "#ffffff"}" fill-opacity="0.75">${esc(credit)}</text>`);
      }
      // Pictures and text put on the page
      for (const im of s.images ?? []) {
        if (im.hidden) continue;
        const w = im.w * W, h = w * im.aspect, X = im.x * W, Y = im.y * H;
        parts.push(`<g data-el="image:${im.id}" data-box="${n(X)} ${n(Y)} ${n(w)} ${n(h)}">${turned(`<image href="${im.src}" x="${n(X)}" y="${n(Y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet" opacity="${n(im.opacity ?? 1)}"/>`, im.rot)}</g>`);
      }
      for (const t of s.texts ?? []) {
        if (t.hidden || !t.text.trim()) continue;
        const lines = t.text.split("\n");
        const tw = Math.max(...lines.map(l => l.length)) * t.size * (t.bold ? 0.6 : 0.55), th = lines.length * t.size * 1.25;
        const X = t.x * W, Y = t.y * H;
        const ax = t.align === "middle" ? X + tw / 2 : t.align === "end" ? X + tw : X;
        const pad = t.size * 0.4;
        const bgRect = t.bg && (t.bgOpacity ?? 1) > 0 ? `<rect x="${n(X - pad)}" y="${n(Y - pad)}" width="${n(tw + pad * 2)}" height="${n(th + pad * 2)}" rx="${n(pad)}" fill="${t.bg}" fill-opacity="${n(t.bgOpacity ?? 1)}"/>` : "";
        const body = lines.map((l, i) => `<text x="${n(ax)}" y="${n(Y + t.size * (0.95 + i * 1.25))}" text-anchor="${t.align ?? "start"}" font-family="${titleStack(t.font || s.font)}" font-weight="${t.bold ? 700 : 400}"${t.italic ? ` font-style="italic"` : ""} font-size="${n(t.size)}" fill="${t.color}">${esc(l)}</text>`).join("");
        parts.push(`<g data-el="text:${t.id}" data-box="${n(X)} ${n(Y)} ${n(tw)} ${n(th)}"><rect x="${n(X)}" y="${n(Y)}" width="${n(tw)}" height="${n(th)}" fill="none" pointer-events="all"/>${turned(bgRect + body, t.rot, t.opacity)}</g>`);
      }
      // Pictures, QR codes and sponsors added to the map (the course's own name filled in)
      parts.push(extrasSvg(s.mapExtras, s.sponsors, "", { hole: "", par: "", length: "", course: title, name: "" }, W, H, s.font, (id, c) => `<g data-el="${id}">${c}</g>`));
      if (last) return { svg: wrapSvg(W, H, parts.join(""), opts.dpi), width: W, height: H, page, holeLines: holeLinesOf(stats, map.toScreen) };
      // (a little room round each: its hole number, its label)
      if (out >= 0.6 || !shown.some(q => pieces.some(b => q.x > b.x - near && q.x < b.x + b.w + near && q.y > b.y - near && q.y < b.y + b.h + near))) last = true;
      else {
        clearOf = pieces.slice();
        if (slid) out += 0.05;
        slid = true;
      }
    }
  }

  const titleH = (title ? 46 : 0) * ts + (sub ? 14 * ts : 0);
  const showSide = s.legend || s.holeTable;
  const sideW = showSide && landscape ? Math.min(W * 0.26, 210 * ts) : 0;
  const bottomH = showSide && !landscape ? Math.min(H * 0.3, 150 * ts) : 0;
  const map = { x: m, y: m + titleH, w: W - 2 * m - (sideW ? sideW + m * 0.6 : 0), h: H - 2 * m - titleH - (bottomH ? bottomH + m * 0.5 : 0) - 14 * ts };
  const scale = Math.min((map.w - 2 * room) / bw, (map.h - 2 * room) / bh);
  const center = leastOffSite(doc, box, rotation, scale, map.w, map.h, room)!;
  const view: MapView = { cx: center.x, cy: center.y, rotation, scale, width: map.w, height: map.h };
  const { svg, toScreen } = renderMapLayers(doc, view, { stats, contours: opts.contours, hillshade: opts.hillshade, textScale: ts * 0.9, fontFamily: s.font, canopy: opts.canopy }, "pm");
  if (title) parts.push(`<text x="${n(m)}" y="${n(m + 30 * ts)}" font-family="${titleStack((s.page?.title?.font || titleFontOf(s)))}" font-weight="700" font-size="${n(30 * ts)}" fill="${pal.ink}" letter-spacing="${n(keepsCase((s.page?.title?.font || titleFontOf(s))) ? 0 : 0.5 * ts)}">${esc(keepsCase((s.page?.title?.font || titleFontOf(s))) ? title : title.toUpperCase())}</text>`);
  const info = `${totals.complete} HOLES · PAR ${totals.par} · ${fmtDist(totals.length, doc.units).toUpperCase()}${layout && doc.layouts.length > 1 ? ` · ${layout.name.toUpperCase()} LAYOUT` : ""}`;
  parts.push(`<text x="${n(W - m)}" y="${n(m + 28 * ts)}" text-anchor="end" font-family="${font}" font-weight="600" font-size="${n(13 * ts)}" fill="${pal.inkSoft}">${esc(info)}</text>`);
  if (sub) parts.push(`<text x="${n(m)}" y="${n(m + 46 * ts)}" font-family="Inter, Arial, sans-serif" font-size="${n(9.5 * ts)}" fill="${pal.inkSoft}">${esc(sub)}</text>`);
  // Map
  parts.push(`<clipPath id="map-clip"><rect x="${n(map.x)}" y="${n(map.y)}" width="${n(map.w)}" height="${n(map.h)}" rx="${n(4 * ts)}"/></clipPath>`);
  parts.push(`<g clip-path="url(#map-clip)"><g transform="translate(${n(map.x)} ${n(map.y)})">${svg}</g></g>`);
  parts.push(`<rect x="${n(map.x)}" y="${n(map.y)}" width="${n(map.w)}" height="${n(map.h)}" rx="${n(4 * ts)}" fill="none" stroke="${pal.ink}" stroke-opacity="0.6" stroke-width="${n(1 * ts)}"/>`);
  // North arrow and scale bar
  if (s.north) parts.push(`<g transform="translate(${n(map.x + map.w - 26 * ts)} ${n(map.y + 30 * ts)}) rotate(${n(-rotation)})">${northArrow(0, 0, 15 * ts, pal)}</g>`);
  if (s.scale) parts.push(scaleBar(map.x + 12 * ts, map.y + map.h - 14 * ts, scale, ts, pal, doc.units));
  // Side panel / bottom band
  if (showSide) {
    const box = sideW ? { x: W - m - sideW, y: map.y, w: sideW, h: map.h } : { x: m, y: map.y + map.h + m * 0.5, w: W - 2 * m, h: bottomH };
    parts.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="${n(4 * ts)}" fill="${pal.panel}" stroke="${pal.ink}" stroke-opacity="0.15"/>`);
    const tableW = !sideW && s.legend && s.holeTable ? box.w * 0.62 : box.w;
    let y = box.y + 14 * ts;
    if (s.holeTable) {
      const t = holeTable(doc, stats, box.x + 10 * ts, y, tableW - 20 * ts, ts, pal, font, sideW ? "vertical" : "horizontal", sideW ? box.h * (s.legend ? 0.6 : 0.95) : box.h - 20 * ts);
      parts.push(t.svg);
      y = t.bottom + 10 * ts;
    }
    if (s.legend) {
      const lx = !sideW && s.holeTable ? box.x + tableW + 4 * ts : box.x + 10 * ts;
      const ly = !sideW && s.holeTable ? box.y + 14 * ts : y;
      parts.push(legend(doc, lx, ly, (sideW ? box.w : box.w - tableW) - 20 * ts, ts, pal, font).svg);
    }
  }
  parts.push(`<text x="${n(m)}" y="${n(H - m * 0.55)}" font-family="Inter, Arial, sans-serif" font-size="${n(7 * ts)}" fill="${pal.inkSoft}">${esc(credit)}</text>`);
  return { svg: wrapSvg(W, H, parts.join(""), opts.dpi), width: W, height: H, page, holeLines: holeLinesOf(stats, p => { const q = toScreen(p); return { x: q.x + map.x, y: q.y + map.y }; }) };
};

/** Where each finished hole's line of play is on the page (its points, in the page's units): for
 * the public course page, to light up a hole on the map's picture. */
const holeLinesOf = (stats: HoleStats[], at: (p: P) => P) =>
  stats.filter(st => st.complete && st.line.length >= 2).map(st => ({ holeId: st.holeId, pts: st.line.map(at) }));

export const wrapSvg = (W: number, H: number, body: string, dpi?: number, fontCss = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${dpi ? n((W / 72) * dpi) : n(W)}" height="${dpi ? n((H / 72) * dpi) : n(H)}" viewBox="0 0 ${n(W)} ${n(H)}">${fontCss ? `<style>${fontCss}</style>` : ""}${body}</svg>`;

export const northArrow = (x: number, y: number, r: number, pal: Palette) =>
  `<g transform="translate(${n(x)} ${n(y)})"><circle r="${n(r)}" fill="${pal.panel}" fill-opacity="0.9" stroke="${pal.ink}" stroke-opacity="0.4"/><path d="M0 ${n(-r * 0.8)}L${n(r * 0.42)} ${n(r * 0.45)}L0 ${n(r * 0.18)}Z" fill="${pal.ink}"/><path d="M0 ${n(-r * 0.8)}L${n(-r * 0.42)} ${n(r * 0.45)}L0 ${n(r * 0.18)}Z" fill="${pal.ink}" fill-opacity="0.45"/><text y="${n(r * 0.78)}" text-anchor="middle" dominant-baseline="hanging" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="${n(r * 0.55)}" fill="${pal.ink}" transform="translate(0 ${n(-r * 1.95)})">N</text></g>`;

/** A scale bar's round length (in its units) and its width on the page. */
const scaleBarSize = (pxPerFt: number, ts: number, units: "ft" | "m") => {
  const target = 110 * ts;
  const unitFt = units === "m" ? FT_PER_M : 1;
  const raw = target / pxPerFt / unitFt;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const len = [1, 2, 5, 10].map(mm => mm * pow).reduce((a, c) => (Math.abs(c - raw) < Math.abs(a - raw) ? c : a));
  return { len, w: len * unitFt * pxPerFt };
};
const scaleBarWidth = (pxPerFt: number, ts: number, units: "ft" | "m") => scaleBarSize(pxPerFt, ts, units).w;

/** A scale bar with round lengths in feet (and meters under it). */
export const scaleBar = (x: number, y: number, pxPerFt: number, ts: number, pal: Palette, units: "ft" | "m") => {
  const { len, w } = scaleBarSize(pxPerFt, ts, units);
  const h = 4 * ts;
  const seg = (i: number) => `<rect x="${n(x + (w / 4) * i)}" y="${n(y - h)}" width="${n(w / 4)}" height="${n(h)}" fill="${i % 2 ? pal.panel : pal.ink}"/>`;
  return `<g><rect x="${n(x - 4 * ts)}" y="${n(y - h - 14 * ts)}" width="${n(w + 30 * ts)}" height="${n(h + 18 * ts)}" rx="${n(3 * ts)}" fill="${pal.panel}" fill-opacity="0.85"/>${[0, 1, 2, 3].map(seg).join("")}<rect x="${n(x)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${pal.ink}" stroke-width="${n(0.6 * ts)}"/><text x="${n(x)}" y="${n(y - h - 4 * ts)}" font-family="Inter, Arial, sans-serif" font-size="${n(7.5 * ts)}" font-weight="600" fill="${pal.ink}">0</text><text x="${n(x + w)}" y="${n(y - h - 4 * ts)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${n(7.5 * ts)}" font-weight="600" fill="${pal.ink}">${len.toLocaleString()} ${units}</text></g>`;
};

/** The hole table: one row (or column, on a wide page) per hole with par and each layout's length
 * (or the columns asked for: names, par, lengths, elevation). */
const holeTable = (doc: CourseDoc, stats: HoleStats[], x: number, y: number, w: number, ts: number, pal: Palette, font: string, mode: "vertical" | "horizontal", maxH: number, columns?: PageElementStyle["columns"]) => {
  const layouts = doc.layouts;
  const lengths = layouts.map(l => doc.holes.map(h => holeStats(doc, h, l)));
  const rows: string[] = [];
  const fs = 8.5 * ts;
  if (mode === "vertical") {
    const show = columns ?? ["par", "lengths"];
    const rowH = Math.min(14 * ts, (maxH - 30 * ts) / Math.max(1, stats.length + 1));
    const f = Math.min(fs, rowH * 0.7);
    const done = stats.filter(st => st.complete);
    type Col = { head: string; dot?: string; weight: number; left?: boolean; cell: (r: number) => string; total: string };
    const cols: Col[] = [];
    if (show.includes("names")) cols.push({ head: "NAME", weight: 2.4, left: true, cell: r => doc.holes.find(h => h.id === stats[r].holeId)?.name ?? "", total: "" });
    if (show.includes("par")) cols.push({ head: "PAR", weight: 1, cell: r => (stats[r].complete ? String(stats[r].par) : "–"), total: String(done.reduce((t, st) => t + st.par * playsOf(doc, st.holeId), 0)) });
    if (show.includes("lengths")) layouts.forEach((l, i) => cols.push({
      head: l.name.toUpperCase().slice(0, 8), dot: TEE_LEVELS[l.tee].color, weight: 1,
      cell: r => (lengths[i][r].complete ? fmtDist(lengths[i][r].length, doc.units, false) : "–"),
      total: fmtDist(lengths[i].filter(st => st.complete).reduce((t, st) => t + st.length * playsOf(doc, st.holeId), 0), doc.units, false)
    }));
    if (show.includes("elevation")) {
      const elev = (ft: number) => { const v = Math.round(doc.units === "m" ? ft / FT_PER_M : ft); return v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`; };
      cols.push({ head: "ELEV", weight: 1, cell: r => (stats[r].complete ? elev(stats[r].elevationChange) : "–"), total: "" });
    }
    const unit = (w - 26 * ts) / Math.max(1, cols.reduce((t, c) => t + c.weight, 0));
    let cx0 = x + 26 * ts;
    const placedCols = cols.map(c => { const at = { ...c, x0: cx0, cw: c.weight * unit }; cx0 += c.weight * unit; return at; });
    const cellX = (c: (typeof placedCols)[number]) => (c.left ? c.x0 : c.x0 + c.cw / 2);
    const clip = (t: string, c: (typeof placedCols)[number]) => { const most = Math.max(2, Math.floor(c.cw / (f * 0.52))); return t.length > most ? `${t.slice(0, most - 1)}…` : t; };
    rows.push(`<text x="${n(x)}" y="${n(y)}" font-family="${font}" font-weight="700" font-size="${n(f * 1.15)}" fill="${pal.panelInk}">HOLE</text>`);
    placedCols.forEach(c => {
      if (c.dot) {
        const half = c.head.length * f * 0.3;
        const mid = c.x0 + c.cw / 2;
        rows.push(`<circle cx="${n(mid - half - f * 0.7)}" cy="${n(y - f * 0.35)}" r="${n(f * 0.38)}" fill="${c.dot}" stroke="#333" stroke-width="0.5"/><text x="${n(mid + f * 0.3)}" y="${n(y)}" text-anchor="middle" font-family="${font}" font-weight="700" font-size="${n(f * 1.05)}" fill="${pal.panelInk}">${esc(c.head)}</text>`);
      } else rows.push(`<text${fitAttr(c.cw)} x="${n(cellX(c))}" y="${n(y)}" text-anchor="${c.left ? "start" : "middle"}" font-family="${font}" font-weight="700" font-size="${n(f * 1.15)}" fill="${pal.panelInk}">${c.head}</text>`);
    });
    stats.forEach((st, r) => {
      const yy = y + (r + 1) * rowH + 4 * ts;
      if (r % 2 === 0) rows.push(`<rect x="${n(x - 4 * ts)}" y="${n(yy - rowH * 0.72)}" width="${n(w + 8 * ts)}" height="${n(rowH)}" fill="${pal.panelInk}" fill-opacity="0.05"/>`);
      rows.push(`<text x="${n(x + 6 * ts)}" y="${n(yy)}" text-anchor="middle" font-family="${font}" font-weight="700" font-size="${n(f)}" fill="${pal.panelInk}">${st.label}</text>`);
      placedCols.forEach(c => rows.push(`<text${fitAttr(c.cw)} x="${n(cellX(c))}" y="${n(yy)}" text-anchor="${c.left ? "start" : "middle"}" font-family="Inter, Arial, sans-serif" font-size="${n(f)}" fill="${pal.panelInk}">${esc(clip(c.cell(r), c))}</text>`));
    });
    const yy = y + (stats.length + 1) * rowH + 8 * ts;
    rows.push(`<line x1="${n(x - 4 * ts)}" x2="${n(x + w + 4 * ts)}" y1="${n(yy - rowH * 0.8)}" y2="${n(yy - rowH * 0.8)}" stroke="${pal.panelInk}" stroke-opacity="0.4"/>`);
    rows.push(`<text x="${n(x)}" y="${n(yy)}" font-family="${font}" font-weight="700" font-size="${n(f)}" fill="${pal.panelInk}">TOTAL</text>`);
    placedCols.forEach(c => { if (c.total) rows.push(`<text${fitAttr(c.cw)} x="${n(cellX(c))}" y="${n(yy)}" text-anchor="${c.left ? "start" : "middle"}" font-family="${font}" font-weight="700" font-size="${n(f)}" fill="${pal.panelInk}">${c.total}</text>`); });
    return { svg: rows.join(""), bottom: yy + 4 * ts };
  }
  // Horizontal: holes across, rows for par and each layout (two blocks of up to 9 or 12 holes)
  const per = stats.length > 12 ? Math.ceil(stats.length / 2) : stats.length;
  const blocks = Math.ceil(stats.length / Math.max(1, per));
  const labelW = 52 * ts;
  const cellW = (w - labelW) / Math.max(1, per + (blocks === 1 ? 1 : 0));
  const rowH = 12 * ts;
  let yy = y;
  for (let bI = 0; bI < blocks; bI++) {
    const slice = stats.slice(bI * per, (bI + 1) * per);
    const cell = (i: number) => x + labelW + cellW * (i + 0.5);
    const rowsDef: { label: string; dot?: string; values: (string | number)[]; bold?: boolean }[] = [
      { label: "HOLE", values: slice.map(s => s.label), bold: true },
      { label: "PAR", values: slice.map(s => (s.complete ? s.par : "–")) },
      ...layouts.map((l, i) => ({ label: l.name.toUpperCase().slice(0, 9), dot: TEE_LEVELS[l.tee].color, values: slice.map((_, j) => { const ls = lengths[i][bI * per + j]; return ls.complete ? fmtDist(ls.length, doc.units, false) : "–"; }) }))
    ];
    rowsDef.forEach((row, ri) => {
      const ry = yy + ri * rowH;
      if (ri % 2 === 1) rows.push(`<rect x="${n(x - 4 * ts)}" y="${n(ry - rowH * 0.72)}" width="${n(w + 8 * ts)}" height="${n(rowH)}" fill="${pal.panelInk}" fill-opacity="0.05"/>`);
      if (row.dot) rows.push(`<circle cx="${n(x + 3 * ts)}" cy="${n(ry - fs * 0.35)}" r="${n(fs * 0.38)}" fill="${row.dot}" stroke="#333" stroke-width="0.5"/>`);
      rows.push(`<text x="${n(x + (row.dot ? 9 * ts : 0))}" y="${n(ry)}" font-family="${font}" font-weight="700" font-size="${n(fs)}" fill="${pal.panelInk}">${esc(row.label)}</text>`);
      row.values.forEach((v, i) => rows.push(`<text x="${n(cell(i))}" y="${n(ry)}" text-anchor="middle" font-family="${row.bold ? font : "Inter, Arial, sans-serif"}" font-weight="${row.bold ? 700 : 400}" font-size="${n(fs)}" fill="${pal.panelInk}">${v}</text>`));
    });
    yy += rowsDef.length * rowH + 6 * ts;
  }
  const total = stats.filter(s => s.complete);
  rows.push(`<text x="${n(x)}" y="${n(yy + 2 * ts)}" font-family="${font}" font-weight="700" font-size="${n(fs)}" fill="${pal.panelInk}">TOTAL PAR ${total.reduce((t, s) => t + s.par * playsOf(doc, s.holeId), 0)} · ${layouts.map((l, i) => `${l.name} ${fmtDist(lengths[i].filter(s => s.complete).reduce((t, s) => t + s.length * playsOf(doc, s.holeId), 0), doc.units)}`).join(" · ")}</text>`);
  return { svg: rows.join(""), bottom: yy + 8 * ts };
};

/** A hedge on a map: a dark band of bushes, rounded where each one bulges, lit on top (and a soft
 * shadow beside it, `shadow` units off). `d` is its path, `w` its width. */
const hedgeSvg = (d: string, w: number, trees: string, o: number, shadow: number) =>
  (shadow ? `<path d="${d}" transform="translate(${n(shadow)} ${n(shadow)})" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(o)}"/>` : "") +
  `<path d="${d}" fill="none" stroke="${shade(trees, -0.35)}" stroke-width="${n(w * 1.18)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(o)}"/>` +
  `<path d="${d}" fill="none" stroke="${shade(trees, 0.04)}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(o)}"/>` +
  `<path d="${d}" fill="none" stroke="${shade(trees, 0.22)}" stroke-width="${n(w * 0.5)}" stroke-dasharray="0 ${n(w * 0.85)}" stroke-linecap="round" opacity="${n(o * 0.8)}"/>`;

/** The ink a power line is drawn in: dark on a light map, light on a dark one or the photo. */
const powerInk = (theme: MapTheme) => (theme === "satellite" || theme === "forest" || theme === "night" ? { ink: "#ecebe6", halo: "rgba(0,0,0,.55)" } : { ink: "#2b2925", halo: "rgba(255,255,255,.75)" });

/** A power line on a map: a thin line, a dot at each pole (every corner, and no more than 160 ft
 * apart; `every`: so far apart instead). `px` turns points into the drawing's units. */
const powerSvg = (line: P[], c: { ink: string; halo: string }, px: (v: number) => number, o: number, every = 160) => {
  const poles: P[] = [];
  for (let i = 0; i < line.length; i++) {
    poles.push(line[i]);
    const b = line[i + 1];
    if (!b) break;
    const k = Math.ceil(dist(line[i], b) / every);
    for (let j = 1; j < k; j++) poles.push({ x: line[i].x + ((b.x - line[i].x) * j) / k, y: line[i].y + ((b.y - line[i].y) * j) / k });
  }
  const d = pathD(line);
  return `<g opacity="${n(o)}"><path d="${d}" fill="none" stroke="${c.halo}" stroke-width="${n(px(2.2))}" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${c.ink}" stroke-width="${n(px(0.9))}" stroke-linejoin="round"/>${poles.map(p => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(px(1.7))}" fill="${c.ink}" stroke="${c.halo}" stroke-width="${n(px(0.8))}"/>`).join("")}</g>`;
};

/** The legend: only what the map shows. */
const legend = (doc: CourseDoc, x: number, y: number, w: number, ts: number, pal: Palette, font: string, heading = "LEGEND") => {
  const s = doc.style;
  const entries: { sym: string; text: string }[] = [];
  const sw = 18 * ts, sh = 9 * ts;
  const has = (pred: (i: (typeof doc.items)[number]) => boolean) => doc.items.some(pred);
  const levels = TEE_ORDER.filter(l => has(i => i.type === "tee" && i.level === l));
  levels.forEach(l => entries.push({ sym: `<rect x="2" y="${n(sh * 0.2)}" width="${n(sw - 4)}" height="${n(sh * 0.6)}" fill="${TEE_LEVELS[l].color}" stroke="#333" stroke-width="0.6"/>`, text: `${TEE_LEVELS[l].label} tee` }));
  if (has(i => i.type === "basket")) entries.push({ sym: basketMark(s.basketMark ?? "basket", { x: sw / 2, y: sh / 2 }, (sh * 1.25) / 16, s.basket, "1"), text: "Basket" });
  if (s.throwLines && doc.holes.length) entries.push({ sym: `<line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${pal.lineCasing}" stroke-width="${n(4 * ts)}"/><line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${pal.line}" stroke-width="${n(2 * ts)}"/>`, text: "Throw line" });
  if (s.nextTee && doc.holes.length > 1) entries.push({ sym: `<line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${pal.panelInk}" stroke-width="${n(1.6 * ts)}" stroke-dasharray="${n(1.5 * ts)} ${n(3 * ts)}" stroke-linecap="round"/>`, text: "To the next tee" });
  if (doc.holes.some(h => h.fairway)) entries.push({ sym: `<rect width="${n(sw)}" height="${n(sh)}" rx="${n(sh / 2)}" fill="${s.fairway}"/>`, text: "Fairway" });
  const areaKinds = new Set(doc.items.filter(i => i.type === "area").map(i => (i as AreaItem).kind));
  const lineKinds = new Set(doc.items.filter(i => i.type === "line").map(i => (i as LineItem).kind));
  {
    // Regulated areas, each the way it is drawn on the map
    const pdga = s.markings === "pdga";
    const obCol = pdga ? "#ffffff" : s.ob, obCase = pdga ? "#1b1d1a" : "#ffffff";
    const nogoCol = pdga ? RESTRICTED : "#7c3aed", casualCol = AREA_KINDS.casual.color;
    const box = (fill: string, stroke: string, casing: string, dash = "") => `<rect x="1" y="1" width="${n(sw - 2)}" height="${n(sh - 2)}" fill="${fill}" fill-opacity="0.3" stroke="${casing}" stroke-width="${n(3 * ts)}"/><rect x="1" y="1" width="${n(sw - 2)}" height="${n(sh - 2)}" fill="none" stroke="${stroke}" stroke-width="${n(1.6 * ts)}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
    const dashed = `${n(3 * ts)} ${n(2 * ts)}`;
    const obItems = doc.items.filter(i => (i.type === "area" || i.type === "line") && isOb(i as AreaItem | LineItem));
    if (areaKinds.has("ob") || obItems.some(i => i.type === "area" && (i as AreaItem).kind !== "water")) entries.push({ sym: box(obCol, obCol, obCase), text: "Out of bounds" });
    if (obItems.some(i => (i.type === "area" && (i as AreaItem).kind === "water") || (i.type === "line" && (i as LineItem).kind === "stream"))) entries.push({ sym: `<rect width="${n(sw)}" height="${n(sh)}" rx="${n(2 * ts)}" fill="${s.water}"/><rect x="${n(1.5 * ts)}" y="${n(1.5 * ts)}" width="${n(sw - 3 * ts)}" height="${n(sh - 3 * ts)}" rx="${n(2 * ts)}" fill="none" stroke="${obCase}" stroke-width="${n(2.6 * ts)}"/><rect x="${n(1.5 * ts)}" y="${n(1.5 * ts)}" width="${n(sw - 3 * ts)}" height="${n(sh - 3 * ts)}" rx="${n(2 * ts)}" fill="none" stroke="${obCol}" stroke-width="${n(1.3 * ts)}"/>`, text: "OB water" });
    if (obItems.some(i => i.type === "line" && (i as LineItem).kind !== "stream")) entries.push({ sym: `<line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${obCase}" stroke-width="${n(4.2 * ts)}" stroke-linecap="round"/><line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${obCol}" stroke-width="${n(2.2 * ts)}" stroke-linecap="round"/>`, text: "OB line (road, fence)" });
    if (areaKinds.has("hazard") || doc.items.some(i => (i.type === "area" || i.type === "line") && i.hazard === true)) entries.push({ sym: box(s.hazard, s.hazard, "#ffffff", dashed), text: "Hazard" });
    if (areaKinds.has("casual")) entries.push({ sym: box(casualCol, casualCol, "#ffffff", dashed), text: "Casual area" });
    if (doc.items.some(isOutOfPlay)) entries.push({ sym: box(nogoCol, nogoCol, "#ffffff", dashed), text: "Out of play" });
  }
  if (has(i => i.type === "mando" && !i.pairId)) entries.push({ sym: mandoSymbol({ x: sw / 2, y: sh * 0.62 }, 0, "left", sh / 15), text: "Mando" });
  if (has(i => i.type === "mando" && !!i.pairId)) entries.push({ sym: gateSymbol({ x: sw / 2, y: sh * 0.12 }, { x: sw / 2, y: sh * 0.88 }, 0, sh / 17), text: "Mando gate" });
  if (has(i => i.type === "dropzone")) entries.push({ sym: dropZoneSymbol({ x: sw / 2, y: sh / 2 }, sh / 12.5), text: "Drop zone" });
  if (areaKinds.has("water") || lineKinds.has("stream")) entries.push({ sym: `<rect width="${n(sw)}" height="${n(sh)}" rx="${n(2 * ts)}" fill="${s.water}"/>`, text: "Water" });
  if (areaKinds.has("rough")) {
    const tg = tallGrassOf(s), blades = [0.2, 0.42, 0.64, 0.86].map(f => `<path d="M${n(sw * f - 1.6 * ts)} ${n(sh * 0.82)}L${n(sw * f)} ${n(sh * 0.22)}L${n(sw * f + 1.6 * ts)} ${n(sh * 0.82)}" fill="none" stroke="${shade(tg, -0.35)}" stroke-width="${n(0.9 * ts)}" stroke-linejoin="round"/>`).join("");
    entries.push({ sym: `<rect width="${n(sw)}" height="${n(sh)}" rx="${n(2 * ts)}" fill="${tg}"/>${blades}`, text: "Tall grass" });
  }
  if (areaKinds.has("woods") || has(i => i.type === "tree")) entries.push({ sym: `<circle cx="${n(sw * 0.35)}" cy="${n(sh / 2)}" r="${n(sh * 0.48)}" fill="${s.trees}"/><circle cx="${n(sw * 0.7)}" cy="${n(sh / 2)}" r="${n(sh * 0.4)}" fill="${shade(s.trees, 0.1)}"/>`, text: "Trees" });
  if (lineKinds.has("path")) entries.push({ sym: `<line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${s.path}" stroke-width="${n(3 * ts)}" stroke-linecap="round"/>`, text: "Path" });
  if (lineKinds.has("road")) entries.push({ sym: `<line x1="0" y1="${n(sh / 2)}" x2="${n(sw)}" y2="${n(sh / 2)}" stroke="${pal.road}" stroke-width="${n(5 * ts)}"/>`, text: "Road" });
  if (lineKinds.has("hedge")) entries.push({ sym: hedgeSvg(`M${n(sh * 0.3)} ${n(sh / 2)}L${n(sw - sh * 0.3)} ${n(sh / 2)}`, sh * 0.62, s.trees, 1, 0), text: "Hedge" });
  if (lineKinds.has("power")) entries.push({ sym: powerSvg([{ x: 0, y: sh / 2 }, { x: sw, y: sh / 2 }], powerInk(s.theme), v => v * ts * 0.9, 1, sw * 0.6), text: "Power line" });
  // Fields, courts and play areas, each kind a little one of its own
  const fieldKinds = new Set(doc.items.filter(i => i.type === "area" && i.kind === "field").map(i => fieldKindOf(i as AreaItem)));
  const inks = fieldInks(s.theme, s.fairway);
  for (const kd of FIELD_ORDER) if (fieldKinds.has(kd)) entries.push({ sym: fieldLegend(kd, sw, sh, inks, `lgf-${kd}`), text: FIELD_KINDS[kd].label });
  // Built things, each drawn as on the map
  const built = new Set(doc.items.filter(i => i.type === "structure").map(i => (i as StructureItem).kind));
  for (const kd of STRUCTURE_ORDER) {
    if (!built.has(kd)) continue;
    const h = STRUCTURE_KINDS[kd].shape === "outline" ? sh * 1.3 : sh;
    entries.push({ sym: `<g transform="translate(0 ${n((sh - h) / 2)})">${structureLegend(kd, sw, h, ts * 0.55, structureInk(s.theme), `lg-${kd}`)}</g>`, text: STRUCTURE_KINDS[kd].label });
  }
  if (s.contours) entries.push({ sym: `<path d="M0 ${n(sh * 0.7)}Q${n(sw / 2)} ${n(-sh * 0.2)} ${n(sw)} ${n(sh * 0.7)}" fill="none" stroke="${pal.contourMajor === "rgba(255,255,255,.6)" ? "#666" : pal.contourMajor}" stroke-width="${n(1 * ts)}"/>`, text: "Contour line" });
  const kinds = new Set(doc.items.filter(i => i.type === "amenity").map(i => (i as AmenityItem).kind));
  kinds.forEach(kd => {
    entries.push({ sym: amenitySymbol(kd, { x: sw / 2, y: sh / 2 }, kd === "here" ? sh / 19 : (sh * 1.15) / 13.2), text: kd === "here" ? "You are here" : AMENITY_KINDS[kd].label });
  });
  const cols = w > 260 * ts ? 2 : 1;
  const colW = w / cols;
  const rowH = 13 * ts;
  const head = heading.trim();
  const outParts = head ? [`<text x="${n(x)}" y="${n(y)}" font-family="${font}" font-weight="700" font-size="${n(10 * ts)}" fill="${pal.panelInk}">${esc(head.toUpperCase())}</text>`] : [];
  const top = head ? y + 8 * ts : y - 6 * ts;
  entries.forEach((e, i) => {
    const cx = x + (i % cols) * colW, cy = top + Math.floor(i / cols) * rowH;
    outParts.push(`<g transform="translate(${n(cx)} ${n(cy)})">${e.sym}<text x="${n(sw + 6 * ts)}" y="${n(sh / 2)}" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="${n(8 * ts)}" fill="${pal.panelInk}">${esc(e.text)}</text></g>`);
  });
  return { svg: outParts.join(""), bottom: top + Math.ceil(entries.length / cols) * rowH };
};
