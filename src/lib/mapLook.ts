// The painted map's looks: seven styles, each setting every part of the map (its trees, grass,
// fairways, paths and roads, water and light), and any part of any style changeable on its own
// (mix and match). Pure: the painter (lib/forest) draws what this resolves, the Design step shows it.
import type { MapStyle } from "../types";

export type LookTheme = "classic" | "handpainted" | "brushwood" | "hollow" | "golden" | "storybook" | "gouache";
export type TreeStyle = "classic" | "brushed" | "cluster" | "drybrush" | "cloud" | "gouache";
export type GrassStyle = "painted" | "meadow" | "field" | "storybook" | "mown";
export type FairwayStyle = "soft" | "stripes" | "sunlit" | "outlined";
export type PathStyle = "painted" | "clean" | "trail";
export type WaterStyle = "deep" | "painterly" | "glinting" | "flat";
export type LightMode = "golden" | "midday" | "night";

export type LookParts = {
  trees: { style: TreeStyle; density: number; size: number; variety: number; pines: number; brush?: number };
  grass: { style: GrassStyle; bright: number; texture: number };
  fairway: { style: FairwayStyle; bright: number };
  paths: { style: PathStyle };
  water: { style: WaterStyle };
};
export type LookPart = keyof LookParts;

type ThemeDef = { id: LookTheme; label: string; hint: string; parts: LookParts; light: LightMode; sun: number };
export const LOOK_THEMES: ThemeDef[] = [
  {
    // (new courses start in it; unset is still Classic, so a course made before keeps its look)
    id: "handpainted", label: "Brushed", hint: "Every leaf brushed on, soft light",
    parts: { trees: { style: "brushed", density: 1, size: 1, variety: 0.5, pines: 0.12 }, grass: { style: "painted", bright: 1, texture: 1 }, fairway: { style: "soft", bright: 1 }, paths: { style: "painted" }, water: { style: "deep" } },
    light: "midday", sun: 0.8
  },
  {
    id: "classic", label: "Classic", hint: "Thick treetops packed close",
    parts: { trees: { style: "classic", density: 1, size: 1, variety: 0.3, pines: 0 }, grass: { style: "painted", bright: 1, texture: 1 }, fairway: { style: "soft", bright: 1 }, paths: { style: "painted" }, water: { style: "deep" } },
    light: "midday", sun: 0.8
  },
  {
    id: "brushwood", label: "Brushwood", hint: "Brushy tree clumps, bright meadow",
    parts: { trees: { style: "cluster", density: 1, size: 1.05, variety: 0.7, pines: 0.15 }, grass: { style: "meadow", bright: 1.02, texture: 1 }, fairway: { style: "soft", bright: 1.04 }, paths: { style: "painted" }, water: { style: "painterly" } },
    light: "midday", sun: 0.8
  },
  {
    id: "hollow", label: "Hollow", hint: "Dark woods, sunlit edges",
    parts: { trees: { style: "drybrush", density: 1.05, size: 1.05, variety: 0.7, pines: 0.12 }, grass: { style: "meadow", bright: 1, texture: 1.2 }, fairway: { style: "soft", bright: 1.04 }, paths: { style: "painted" }, water: { style: "painterly" } },
    light: "midday", sun: 0.8
  },
  {
    id: "golden", label: "Golden hour", hint: "Low warm sun, long shadows",
    parts: { trees: { style: "brushed", density: 1, size: 1.05, variety: 0.8, pines: 0.2 }, grass: { style: "field", bright: 1, texture: 1 }, fairway: { style: "sunlit", bright: 1 }, paths: { style: "painted" }, water: { style: "glinting" } },
    light: "golden", sun: 1
  },
  {
    id: "storybook", label: "Storybook", hint: "Puffy treetops, striped fairways",
    parts: { trees: { style: "cloud", density: 0.95, size: 1, variety: 0.8, pines: 0.12 }, grass: { style: "storybook", bright: 1.02, texture: 0.8 }, fairway: { style: "outlined", bright: 1 }, paths: { style: "trail" }, water: { style: "flat" } },
    light: "midday", sun: 0.8
  },
  {
    id: "gouache", label: "Gouache", hint: "Flat layers of paint, soft edges",
    parts: { trees: { style: "gouache", density: 1, size: 1.05, variety: 0.6, pines: 0.2 }, grass: { style: "painted", bright: 1.12, texture: 1 }, fairway: { style: "sunlit", bright: 1.02 }, paths: { style: "clean" }, water: { style: "deep" } },
    light: "midday", sun: 0.8
  }
];

/** The choices for each part, labelled (a part takes any style's look). */
export const PART_CHOICES: { [K in LookPart]: { id: LookParts[K]["style"]; label: string }[] } = {
  trees: [{ id: "classic", label: "Classic" }, { id: "brushed", label: "Brushed" }, { id: "cluster", label: "Painted cluster" }, { id: "drybrush", label: "Deep woods" }, { id: "cloud", label: "Cloud" }, { id: "gouache", label: "Gouache" }],
  grass: [{ id: "painted", label: "Painted" }, { id: "meadow", label: "Meadow" }, { id: "field", label: "Golden field" }, { id: "storybook", label: "Storybook" }, { id: "mown", label: "Mown" }],
  fairway: [{ id: "soft", label: "Soft" }, { id: "stripes", label: "Mown stripes" }, { id: "sunlit", label: "Sunlit" }, { id: "outlined", label: "Outlined" }],
  paths: [{ id: "painted", label: "Painted" }, { id: "clean", label: "Clean" }, { id: "trail", label: "Trail line" }],
  water: [{ id: "deep", label: "Deep" }, { id: "painterly", label: "Painterly" }, { id: "glinting", label: "Glinting" }, { id: "flat", label: "Flat" }]
};
export const LIGHT_MODES: { id: LightMode; label: string }[] = [{ id: "golden", label: "Golden hour" }, { id: "midday", label: "Midday" }, { id: "night", label: "Night" }];

// (unset: Classic, as courses made before Brushed was the first)
export const themeOf = (s: Pick<MapStyle, "mapLook">): ThemeDef => LOOK_THEMES.find(t => t.id === (s.mapLook ?? "classic")) ?? LOOK_THEMES.find(t => t.id === "classic")!;

/** A style's parts: its theme's, with any part changed on its own over them. */
export const lookParts = (s: Pick<MapStyle, "mapLook" | "lookParts">): LookParts => {
  const base = themeOf(s).parts, own = s.lookParts ?? {};
  return {
    // (the trees: their look, overall size and the brush's size are the map's to pick; their
    // spacing, color variety and pines are the look's own, the kinds and where they stand the 3D
    // map's: the same on every map)
    trees: { ...base.trees, ...(own.trees?.style ? { style: own.trees.style } : {}), ...(own.trees?.size !== undefined ? { size: own.trees.size } : {}), ...(own.trees?.brush !== undefined ? { brush: own.trees.brush } : {}) }, grass: { ...base.grass, ...own.grass }, fairway: { ...base.fairway, ...own.fairway },
    paths: { ...base.paths, ...own.paths }, water: { ...base.water, ...own.water }
  };
};
/** Whether a part differs from its theme's (shown as changed). */
export const partChanged = (s: Pick<MapStyle, "mapLook" | "lookParts">, part: LookPart) => {
  const own = s.lookParts?.[part];
  if (!own) return false;
  const base = themeOf(s).parts[part] as Record<string, unknown>;
  return Object.entries(own).some(([k, v]) => v !== undefined && base[k] !== v);
};

/** The light: golden hour (the sun's gold as strong as `sun`), midday, or night. */
export const lightOf = (s: Pick<MapStyle, "mapLook" | "lightMode" | "goldenSun">) => {
  const t = themeOf(s);
  return { mode: s.lightMode ?? t.light, sun: s.goldenSun ?? (s.lightMode ? 1 : t.sun) };
};

/** Each tree style's own daylight: shadow length, warmth and coolness, the color grade over the
 * picture (sun side, shade side: r, g, b, a), and mist in the clearings. Classic: none (as it was). */
export type Daylight = { len: number; warm: number; cool: number; grade: [number[], number[]] | null; mist?: boolean };
const DAY: Record<TreeStyle, Daylight> = {
  classic: { len: 1, warm: 0, cool: 0, grade: null },
  // (the map's own warm shade, not blue: the trees sit in it)
  brushed: { len: 0.9, warm: 0.2, cool: 0.1, grade: [[250, 240, 200, 0.3], [40, 50, 35, 0.15]] },
  cluster: { len: 1.15, warm: 0.3, cool: 0.35, grade: [[250, 240, 190, 0.5], [20, 60, 50, 0.35]] },
  cloud: { len: 0.75, warm: 0.2, cool: 0.25, grade: [[255, 250, 220, 0.4], [40, 80, 120, 0.2]] },
  gouache: { len: 1.05, warm: 0.25, cool: 0.3, grade: [[250, 236, 200, 0.45], [50, 70, 90, 0.25]] },
  drybrush: { len: 1.15, warm: 0.3, cool: 0.45, grade: [[240, 232, 160, 0.5], [8, 36, 30, 0.5]], mist: true }
};
const GOLDEN: Daylight = { len: 1.7, warm: 1, cool: 0.35, grade: [[255, 196, 100, 0.7], [60, 80, 130, 0.28]] };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The light the picture is painted in, and the sun's height for it (degrees). */
export const paintLight = (s: MapStyle) => {
  const parts = lookParts(s), lt = lightOf(s), day = DAY[parts.trees.style];
  const height = s.sunHeight ?? 38;
  if (lt.mode === "night") return { mode: lt.mode, len: 1.1, warm: 0, cool: 0.6, grade: null, mist: false, height: 32 };
  if (lt.mode === "golden") {
    const g = Math.max(0, Math.min(1, lt.sun)), dg = day.grade ?? [[255, 250, 235, 0], [40, 60, 90, 0]];
    return {
      mode: lt.mode, len: lerp(day.len, GOLDEN.len, g), warm: lerp(day.warm, GOLDEN.warm, g), cool: lerp(day.cool, GOLDEN.cool, g),
      grade: [dg[0].map((v, i) => lerp(v, GOLDEN.grade![0][i], g)), dg[1].map((v, i) => lerp(v, GOLDEN.grade![1][i], g))] as [number[], number[]],
      mist: !!day.mist && g < 0.5, height: lerp(height, 16, g)
    };
  }
  return { mode: lt.mode, ...day, mist: !!day.mist, height };
};

// ---------------------------------------------------------------- the sun, by the compass
/** The site's latitude (north positive), if known. */
export const latitudeOf = (site: { location?: { lat: number } | null; bounds?: { north: number; south: number } | null } | undefined) =>
  site?.location?.lat ?? (site?.bounds ? (site.bounds.north + site.bounds.south) / 2 : 40);
/** The directions the sun can shine from at a latitude: east through south to west north of the
 * tropics, east through north to west south of them (degrees: the arc's middle and half its width). */
export const sunArc = (lat: number) => ({ mid: lat >= 0 ? 180 : 0, half: 120 });
/** A compass bearing kept on the sun's arc. */
export const onSunArc = (bearing: number, lat: number) => {
  const { mid, half } = sunArc(lat);
  const off = ((bearing - mid + 540) % 360) - 180;
  return (mid + Math.max(-half, Math.min(half, off)) + 360) % 360;
};
/** Where the sun shines from (compass, degrees clockwise from north): as set, or the afternoon's
 * (south-west north of the tropics, north-west south of them); always on the sun's arc. */
export const sunFromOf = (s: Pick<MapStyle, "sunFrom">, lat: number) => onSunArc(s.sunFrom ?? (lat >= 0 ? 225 : 315), lat);
export const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compassName = (b: number) => COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
