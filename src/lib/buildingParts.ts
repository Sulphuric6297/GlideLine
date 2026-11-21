// A building's parts and colors, as the 3D view, its panel and the import all see them: its
// stories and floor, where its doors and windows go (laid out by itself, or put on by hand), when a
// door needs steps, and the colors and color schemes it can be painted.
import type { AddOn, BuildingType, FoundationKind, Opening, P, RoofingKind, SidingKind, StructureItem, WindowAmount, WindowStyle } from "../types";
import { orientedBox, roofBreaks, roofFor, structureHeight } from "./structures";

/** Ft from one story's floor to the next. */
export const STORY_FT = 9.5;
/** How high the floor stands over the highest ground round the walls, ft. */
export const FLOOR_FT: Record<FoundationKind, number> = { slab: 0.6, crawl: 2.2, raised: 4 };
export const floorOf = (st: Pick<StructureItem, "foundation">) => FLOOR_FT[st.foundation ?? "slab"];

/** Its stories as set, or as its walls' height reads (whole stories). */
export const storiesOf = (st: Pick<StructureItem, "stories" | "kind" | "height">) => st.stories ?? Math.max(1, Math.round(structureHeight(st) / 10));
/** The walls' height for a number of stories (a half story is in the roof: no taller walls). */
export const heightForStories = (n: number) => Math.max(1, Math.floor(n)) * STORY_FT + 0.5;

/** The usual colors, each one of the house or roof colors: a building's as it's always looked (white
 * walls, a light gray roof, gray stone under it), unless one's set. */
export const DEFAULT_COLORS = { walls: "#f4f2ec", roof: "#d8d8d4", trim: "#f4f2ec", door: "#2f3e55", shutters: "#3c4d3b", foundation: "#8c857a" };
/** A wall's, roof's or foundation's color set to its texture's own colors. */
export const NATURAL = "natural";
const own = (v: string | undefined, usual: string) => (v === NATURAL ? undefined : v ?? usual);
/** Its colors, each part's own or the usual. Walls, roof and foundation: undefined is the texture's own ("Natural"). */
export const buildingColors = (st: StructureItem) => ({
  walls: own(st.wallColor, DEFAULT_COLORS.walls),
  roof: own(st.roofColor, DEFAULT_COLORS.roof),
  trim: st.trimColor ?? DEFAULT_COLORS.trim,
  frames: st.frameColor ?? st.trimColor ?? DEFAULT_COLORS.trim,
  door: st.doorColor ?? DEFAULT_COLORS.door,
  shutters: st.shutterColor ?? DEFAULT_COLORS.shutters,
  foundation: own(st.foundationColor, DEFAULT_COLORS.foundation)
});
export const sidingOf = (st: Pick<StructureItem, "siding">): SidingKind => st.siding ?? "lap";
export const roofingOf = (st: Pick<StructureItem, "roofing">): RoofingKind => st.roofing ?? "shingles";
export const windowStyleOf = (st: Pick<StructureItem, "windowStyle">): WindowStyle => st.windowStyle ?? "grid";
export const windowAmountOf = (st: Pick<StructureItem, "windows">): WindowAmount => st.windows ?? "even";

// ------------------------------------------------------------------ doors and windows

/** Ft between windows' middles, by how many. */
const SPACING: Record<WindowAmount, number> = { none: Infinity, few: 15, even: 9, many: 6.5 };
export const WINDOW = { width: 3, height: 4.75, sill: 2.75 };
export const DOOR = { width: 3.1, height: 6.9 };
export const GARAGE = { width: 9, height: 7.25 };

/** An opening as laid out: which wall, where along it, its size, its floor's height over the
 * building's floor; `auto` when laid out by itself (not put on by hand). */
export type Laid = Omit<Opening, "id"> & { id?: string; auto: boolean; y0: number };

const edgesOf = (outline: P[]) => outline.map((a, i) => { const b = outline[(i + 1) % outline.length]; return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) }; });

/** The wall its front door is on: as set, or its longest. */
export const frontWall = (st: Pick<StructureItem, "front">, outline: P[]) => {
  const e = edgesOf(outline);
  if (st.front !== undefined && st.front >= 0 && st.front < e.length) return st.front;
  return e.reduce((best, x, i) => (x.len > e[best].len ? i : best), 0);
};

/**
 * Its doors and windows, every wall's: a wall with any put on by hand has only those; the rest
 * laid out by themselves (a front door in the middle of the front wall, windows evenly along each
 * story, a row in the gables of a story and a half). `fits(wall, at, top)`: whether an opening's
 * top clears the roof there (the gable ends are taller in the middle).
 */
export const openingsOf = (st: StructureItem, outline: P[], fits: (wall: number, at: number, top: number) => boolean): Laid[] => {
  const out: Laid[] = [];
  const H = structureHeight(st);
  const stories = storiesOf(st), whole = Math.max(1, Math.floor(stories));
  const storyH = H / whole;
  const type: BuildingType = st.buildingType ?? "house";
  const front = frontWall(st, outline);
  const byHand = new Set([...(st.handWalls ?? []), ...(st.openings ?? []).map(o => o.wall)]);
  for (const o of st.openings ?? []) out.push({ ...o, auto: false, y0: (o.story ?? 0) * storyH });
  const spacing = SPACING[windowAmountOf(st)];
  edgesOf(outline).forEach((e, w) => {
    if (byHand.has(w) || e.len < 6) return;
    // (the front: its doors, a garage's big ones, in the middle)
    const taken: [number, number][] = [];
    if (w === front && H >= 7.5) {
      if (type === "garage" || type === "barn") {
        const big = type === "barn" ? { width: Math.min(12, e.len - 4), height: Math.min(H - 1, 10) } : GARAGE;
        const n = type === "garage" ? Math.max(1, Math.min(3, Math.floor((e.len - 2) / (GARAGE.width + 2)))) : 1;
        for (let k = 0; k < n; k++) {
          const at = (e.len * (k + 0.5)) / n;
          out.push({ kind: "garage", wall: w, at, width: big.width, height: big.height, auto: true, y0: 0 });
          taken.push([at - big.width / 2 - 1.5, at + big.width / 2 + 1.5]);
        }
      } else {
        out.push({ kind: "door", wall: w, at: e.len / 2, width: DOOR.width, height: DOOR.height, auto: true, y0: 0 });
        taken.push([e.len / 2 - DOOR.width / 2 - 2, e.len / 2 + DOOR.width / 2 + 2]);
      }
    }
    if (!isFinite(spacing) || type === "shed" || type === "garage" && w === front) return;
    // (windows: along each story, clear of the doors and a foot and a half from the corners)
    const count = Math.max(0, Math.floor((e.len - 3) / spacing));
    const rows: { y0: number; height: number; sill: number; width: number; story: number }[] = [];
    for (let k = 0; k < whole; k++) {
      const h = Math.min(WINDOW.height, storyH - WINDOW.sill - 1.25);
      if (h >= 2.5) rows.push({ y0: k * storyH, height: h, sill: WINDOW.sill, width: WINDOW.width, story: k });
    }
    if (stories % 1) rows.push({ y0: whole * storyH, height: 3, sill: 1, width: 2.5, story: whole });
    for (const r of rows) {
      const n = r.story >= whole ? 1 : count;
      for (let k = 0; k < n; k++) {
        const at = (e.len * (k + 0.5)) / n;
        if (at - r.width / 2 < 1.5 || at + r.width / 2 > e.len - 1.5) continue;
        if (r.story === 0 && taken.some(([s0, s1]) => at + r.width / 2 > s0 && at - r.width / 2 < s1)) continue;
        if (!fits(w, at, r.y0 + r.sill + r.height + 0.6)) continue;
        out.push({ kind: "window", wall: w, at, width: r.width, height: r.height, sill: r.sill, story: r.story, auto: true, y0: r.y0 });
      }
    }
  });
  return out;
};

/** Steps up to a door: how many (each 7 in up), none where the floor is near the ground. */
export const stepsUp = (rise: number) => (rise > 0.75 ? Math.ceil(rise / 0.6) : 0);

// ------------------------------------------------------------------ colors

export type Swatch = { name: string; color: string };
/** Real house paint colors, a family to a row of eight: whites and grays, blues and greens, warm. */
export const HOUSE_COLORS: Swatch[] = [
  ["Pure white", "#f4f2ec"], ["Warm white", "#efe9dc"], ["Cream", "#e8dcc0"], ["Linen", "#ddd3c0"], ["Light gray", "#c9c8c3"], ["Greige", "#b5ab9b"], ["Slate gray", "#7d8288"], ["Charcoal", "#3e4144"],
  ["Pale blue", "#b9c7cf"], ["Denim", "#5f7891"], ["Navy", "#2f3e55"], ["Teal", "#3f6b6b"], ["Mint", "#c3d3bc"], ["Sage", "#8e9b80"], ["Olive", "#6b6e4e"], ["Forest", "#3c4d3b"],
  ["Butter", "#e6d08a"], ["Mustard", "#c79a3d"], ["Tan", "#b59a74"], ["Terracotta", "#b8693f"], ["Brick red", "#9a4a38"], ["Barn red", "#8a2f26"], ["Chocolate", "#4c3a2f"], ["Black", "#222326"]
].map(([name, color]) => ({ name, color }));
/** Roof colors: as roofs are, what the import reads from the photo snapped to one of these. */
export const ROOF_COLORS: Swatch[] = [
  ["Black", "#232426"], ["Charcoal", "#38393b"], ["Weathered gray", "#5d5c59"], ["Light gray", "#8c8b87"], ["White", "#d8d8d4"], ["Slate blue", "#4a5563"],
  ["Brown", "#4f3d30"], ["Cedar", "#765943"], ["Tan", "#a8987a"], ["Terracotta", "#a8552f"], ["Barn red", "#7f2a24"], ["Forest", "#3c4d3b"]
].map(([name, color]) => ({ name, color }));
/** A color's name, where it's one of ours. */
export const colorName = (c: string | undefined, list: Swatch[] = [...HOUSE_COLORS, ...ROOF_COLORS, { name: "Stone gray", color: "#8c857a" }]) =>
  c === undefined || c === NATURAL ? "Natural" : list.find(s => s.color.toLowerCase() === c.toLowerCase())?.name ?? "Custom";

/** A color scheme: walls (siding and color; brick and stone their own), trim, door, shutters (a
 * window style with them), and the roof colors it suits; how common it is. */
export type Scheme = { id: string; name: string; siding: SidingKind; walls?: string; trim: string; door: string; shutters?: string; roofs: string[]; roof: string; weight: number };
export const SCHEMES: Scheme[] = [
  { id: "classic", name: "Classic white", siding: "lap", walls: "#f4f2ec", trim: "#f4f2ec", door: "#222326", roof: "Charcoal", roofs: ["Black", "Charcoal", "Weathered gray", "Light gray", "Slate blue", "Barn red", "Forest", "Terracotta"], weight: 5 },
  { id: "gray", name: "Gray and white", siding: "lap", walls: "#7d8288", trim: "#f4f2ec", door: "#8a2f26", roof: "Charcoal", roofs: ["Black", "Charcoal", "Weathered gray", "Slate blue"], weight: 4 },
  { id: "greige", name: "Greige", siding: "lap", walls: "#b5ab9b", trim: "#efe9dc", door: "#3c4d3b", roof: "Weathered gray", roofs: ["Charcoal", "Weathered gray", "Brown", "Cedar", "Terracotta"], weight: 3 },
  { id: "sage", name: "Sage", siding: "lap", walls: "#8e9b80", trim: "#efe9dc", door: "#8a2f26", shutters: "#3c4d3b", roof: "Weathered gray", roofs: ["Charcoal", "Weathered gray", "Brown", "Cedar", "Black"], weight: 2 },
  { id: "navy", name: "Navy", siding: "lap", walls: "#2f3e55", trim: "#f4f2ec", door: "#c79a3d", roof: "Weathered gray", roofs: ["Weathered gray", "Light gray", "Charcoal", "Slate blue", "White"], weight: 2 },
  { id: "butter", name: "Butter yellow", siding: "lap", walls: "#e6d08a", trim: "#f4f2ec", door: "#2f3e55", shutters: "#3c4d3b", roof: "Weathered gray", roofs: ["Weathered gray", "Charcoal", "Light gray", "Barn red"], weight: 1 },
  { id: "farmhouse", name: "Farmhouse", siding: "board", walls: "#efe9dc", trim: "#222326", door: "#222326", roof: "Black", roofs: ["Black", "Charcoal", "Light gray", "White"], weight: 2 },
  { id: "brick", name: "Red brick", siding: "brick", trim: "#f4f2ec", door: "#3c4d3b", shutters: "#222326", roof: "Charcoal", roofs: ["Charcoal", "Black", "Weathered gray", "Brown"], weight: 4 },
  { id: "cream", name: "Cream and brown", siding: "lap", walls: "#e8dcc0", trim: "#f4f2ec", door: "#4c3a2f", shutters: "#4c3a2f", roof: "Brown", roofs: ["Brown", "Cedar", "Tan", "Terracotta"], weight: 3 },
  { id: "stucco", name: "Tan stucco", siding: "stucco", walls: "#ddd3c0", trim: "#efe9dc", door: "#4c3a2f", roof: "Terracotta", roofs: ["Terracotta", "Brown", "Cedar", "Tan", "Barn red"], weight: 2 },
  { id: "stone", name: "Stone and cedar", siding: "stone", trim: "#efe9dc", door: "#4c3a2f", roof: "Brown", roofs: ["Brown", "Cedar", "Charcoal", "Forest"], weight: 1 },
  { id: "barn", name: "Barn red", siding: "board", walls: "#8a2f26", trim: "#f4f2ec", door: "#f4f2ec", roof: "Light gray", roofs: ["Light gray", "Weathered gray", "White", "Charcoal", "Black"], weight: 1 }
];
const roofHex = (name: string) => ROOF_COLORS.find(r => r.name === name)?.color;
/** The settings a scheme gives a building (its roof's color too, unless `keepRoof`). */
export const schemePatch = (s: Scheme, keepRoof = false): Partial<StructureItem> => ({
  siding: s.siding, wallColor: s.walls ?? NATURAL, wallColors: undefined, trimColor: s.trim, frameColor: undefined, doorColor: s.door, shutterColor: s.shutters,
  windowStyle: s.shutters ? "shutters" : "grid", ...(keepRoof ? {} : { roofColor: roofHex(s.roof) })
});
/** The scheme a building is painted in, if it's one of them. */
export const schemeOf = (st: StructureItem) => SCHEMES.find(s => sidingOf(st) === s.siding && (buildingColors(st).walls ?? NATURAL) === (s.walls ?? NATURAL) && (st.trimColor ?? DEFAULT_COLORS.trim) === s.trim && (st.doorColor ?? DEFAULT_COLORS.door) === s.door);
/** A scheme that suits a roof color, picked at random by `seed` (the same each time), commoner
 * ones more often. */
export const schemeForRoof = (roof: string, seed: number) => {
  const fits = SCHEMES.filter(s => s.roofs.includes(roof));
  const pool = fits.length ? fits : SCHEMES;
  const total = pool.reduce((a, s) => a + s.weight, 0);
  let t = (((seed * 2654435761) >>> 0) / 4294967296) * total;
  for (const s of pool) if ((t -= s.weight) < 0) return s;
  return pool[0];
};

// ------------------------------------------------------------------ a building as it stands

/** An outline without repeated points (and not closed back on itself). */
export const outlineOf = (st: Pick<StructureItem, "points">) => {
  const pts = st.points.filter((p, i) => i === 0 || Math.hypot(p.x - st.points[i - 1].x, p.y - st.points[i - 1].y) > 1e-3);
  if (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-3) pts.pop();
  return pts;
};

/** A wall: its ends, length, and the level way out of it (plan coordinates). */
export type Wall = { a: P; b: P; len: number; dir: P; out: P };
/** An opening where it is on its wall: ft along it (x0..x1) and up (y0..y1, world heights). */
export type Placed = Laid & { x0: number; x1: number; y1: number; bottom: number };

/**
 * A building as it stands on the ground (`groundAt`): its outline, floor and eaves, the roof over
 * it, its walls, and every door and window where it is (only those that fit under the roof).
 */
export const buildingFrame = (st: StructureItem, groundAt: (x: number, y: number) => number) => {
  const outline = outlineOf(st);
  const H = Math.max(6, structureHeight(st));
  // (the ground round the walls, every 6 ft or so, and under its middle)
  const samples: P[] = [orientedBox(outline).c];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
    for (let j = 0; j < k; j++) samples.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  });
  const gs = samples.map(p => groundAt(p.x, p.y));
  const gMin = Math.min(...gs), gMax = Math.max(...gs);
  const floor = gMax + floorOf(st), eave = floor + H;
  const roof = roofFor(st, 1.5, 0.5, outline);
  const roofY = (p: P) => eave + roof.pitch * roof.run(p);
  let area = 0;
  outline.forEach((a, i) => { const b = outline[(i + 1) % outline.length]; area += a.x * b.y - b.x * a.y; });
  const sgn = area > 0 ? 1 : -1;
  const walls: Wall[] = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length], len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { a, b, len, dir, out: { x: sgn * dir.y, y: -sgn * dir.x } };
  });
  const along = (w: number, s: number): P => { const e = walls[w], t = Math.min(1, Math.max(0, s / e.len)); return { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t }; };
  // (an opening fits where the roof clears its top on both sides)
  const fits = (w: number, s: number, top: number) => [s - 2, s + 2].every(x => roofY(along(w, x)) > floor + top);
  // (its front door, unless it's set: on its longest wall, or on a hill the long wall where the
  // ground is highest, as a house on a hill has its door on the high side, not up a long stair)
  let front = st.front;
  if (front === undefined && gMax - gMin > 1.5) {
    const rise = walls.map(w => floor - groundAt((w.a.x + w.b.x) / 2 + w.out.x * 3, (w.a.y + w.b.y) / 2 + w.out.y * 3));
    const longest = Math.max(...walls.map(w => w.len));
    front = walls.reduce((best, w, i) => (w.len >= Math.min(12, longest * 0.6) && (best < 0 || rise[i] < rise[best] - 1 || (rise[i] <= rise[best] + 1 && w.len > walls[best].len)) ? i : best), -1);
    if (front < 0) front = undefined;
  }
  const placed: Placed[] = openingsOf(front === st.front ? st : { ...st, front }, outline, fits).map(o => {
    const bottom = floor + o.y0 + (o.kind === "window" ? o.sill ?? 3 : 0);
    return { ...o, x0: o.at - o.width / 2, x1: o.at + o.width / 2, bottom, y1: bottom + o.height };
  }).filter(o => o.x0 > 0.3 && o.x1 < walls[o.wall].len - 0.3 && fits(o.wall, o.at, o.y1 - floor + 0.3));
  /** The roof line along a wall: s ft along it and the roof's height there. */
  const tops = (w: number) => roofBreaks(walls[w].a, walls[w].b, roof).map(p => ({ s: Math.hypot(p.x - walls[w].a.x, p.y - walls[w].a.y), y: roofY(p) }));
  return { outline, H, gMin, gMax, floor, eave, roof, roofY, walls, along, fits, placed, tops, front };
};
export type Frame = ReturnType<typeof buildingFrame>;

// ------------------------------------------------------------------ editing doors and windows

let nextId = 0;
const newId = () => `op${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** A wall's name: the front, the back, a side (as you face the front), or which way it faces. */
export const wallName = (st: StructureItem, F: { walls: Wall[]; front?: number }, w: number) => {
  const walls = F.walls, f = F.front ?? frontWall(st, walls.map(x => x.a));
  if (w === f) return "Front wall";
  const fo = walls[f].out, o = walls[w].out;
  const dot = fo.x * o.x + fo.y * o.y, cross = fo.x * o.y - fo.y * o.x;
  if (dot < -0.7) return "Back wall";
  if (Math.abs(dot) <= 0.7) return cross > 0 ? "Left side" : "Right side";
  return "Front wall, set back";
};
export const OPENING_LABEL: Record<Opening["kind"], string> = { window: "Window", door: "Door", garage: "Garage door" };

/** Its openings with this wall's laid-out ones made its own (each with an id, as they stand), so
 * one can be picked, moved or removed; the other walls as they are. */
export const ownWall = (st: StructureItem, frame: Frame, w: number): Opening[] => {
  if ((st.handWalls ?? []).includes(w) || (st.openings ?? []).some(o => o.wall === w)) return st.openings ?? [];
  const laid = frame.placed.filter(o => o.wall === w).map(({ kind, wall, at, width, height, sill, story }) => ({ id: newId(), kind, wall, at, width, height, ...(kind === "window" ? { sill, story } : {}) }));
  return [...(st.openings ?? []), ...laid];
};

/** A new door or window on a wall: at `near` (ft along it) where there's room, else the nearest
 * spot clear of the others (without `near`: the middle of its widest clear stretch); null where
 * there's no room on that wall. */
export const addOpening = (st: StructureItem, frame: Frame, w: number, kind: Opening["kind"], near?: number): { openings: Opening[]; id: string } | null => {
  const list = ownWall(st, frame, w);
  const size = kind === "window" ? { width: WINDOW.width, height: WINDOW.height, sill: WINDOW.sill } : kind === "door" ? DOOR : GARAGE;
  const len = frame.walls[w].len, half = size.width / 2;
  const taken = list.filter(o => o.wall === w && (kind === "window" ? true : (o.story ?? 0) === 0)).map(o => [o.at - o.width / 2 - 1, o.at + o.width / 2 + 1] as [number, number]).sort((a, b) => a[0] - b[0]);
  // (the clear stretches, each where a middle can go)
  const free: [number, number][] = [];
  let from = 1.5;
  for (const [a, b] of [...taken, [len - 1.5, len] as [number, number]]) {
    if (a - from >= size.width) free.push([from + half, a - half]);
    from = Math.max(from, b);
  }
  const top = (kind === "window" ? WINDOW.sill : 0) + size.height + 0.6;
  const spots = free.map(([a, b]) => (near === undefined ? (a + b) / 2 : Math.min(b, Math.max(a, near))));
  const order = spots.map((at, k) => ({ at, k, d: near === undefined ? -(free[k][1] - free[k][0]) : Math.abs(at - near) })).sort((x, y) => x.d - y.d);
  const pick = order.find(o => frame.fits(w, o.at, top));
  if (!pick) return null;
  const id = newId();
  return { openings: [...list, { id, kind, wall: w, at: pick.at, width: size.width, height: size.height, ...(kind === "window" ? { sill: WINDOW.sill } : {}) }], id };
};

// ------------------------------------------------------------------ porches, carports, decks, patios

export const ADDON_LABEL: Record<AddOn["kind"], string> = { porch: "Porch", carport: "Carport", deck: "Deck", patio: "Patio" };
/** Each kind's usual size, ft: along the wall (at most the wall less a foot each side), and out. */
export const ADDON_SIZE: Record<AddOn["kind"], { width: number; depth: number }> = { porch: { width: 20, depth: 8 }, carport: { width: 20, depth: 20 }, deck: { width: 14, depth: 12 }, patio: { width: 12, depth: 10 } };

/** A porch, carport, deck or patio put against a wall, its middle at `near` (ft along it) or the
 * wall's middle, kept on the wall; null where the wall's too short for one. */
export const addAddOn = (st: StructureItem, frame: Frame, w: number, kind: AddOn["kind"], near?: number): { addOns: AddOn[]; id: string } | null => {
  const len = frame.walls[w]?.len ?? 0;
  if (len < 6) return null;
  const size = ADDON_SIZE[kind], width = Math.min(size.width, len - 2);
  const at = Math.min(len - width / 2 - 1, Math.max(width / 2 + 1, near ?? len / 2));
  const id = `ad${Date.now().toString(36)}${(nextId++).toString(36)}`;
  return { addOns: [...(st.addOns ?? []), { id, kind, wall: w, at: Math.round(at * 4) / 4, width, depth: size.depth }], id };
};

// ------------------------------------------------------------------ corners added or taken away

/** What's kept by wall (doors and windows, walls set by hand, a wall's own color, the front),
 * after the wall from corner `i` is split in two at its middle (`split`) or corner `i` is taken
 * away (`merge`): each thing stays on the wall it was on, now numbered as it is. */
export const wallsAfter = (st: StructureItem, change: "split" | "merge", i: number): Partial<StructureItem> => {
  if (st.kind !== "building" || (!st.openings?.length && !st.addOns?.length && !st.handWalls?.length && !st.wallColors && st.front === undefined)) return {};
  const pts = outlineOf(st), n = pts.length;
  const len = (k: number) => { const a = pts[((k % n) + n) % n], b = pts[(((k + 1) % n) + n) % n]; return Math.hypot(b.x - a.x, b.y - a.y); };
  // (where a point `at` ft along wall `w` is now)
  const map = (w: number, at = 0): { wall: number; at: number } => {
    if (change === "split") {
      if (w < i) return { wall: w, at };
      if (w > i) return { wall: w + 1, at };
      const half = len(i) / 2;
      return at > half ? { wall: i + 1, at: at - half } : { wall: i, at };
    }
    // (corner i gone: the wall before it and the one from it are one, numbered as the one before)
    const before = (i - 1 + n) % n;
    if (w === i) return { wall: i === 0 ? n - 2 : i - 1, at: at + len(before) };
    if (w === before) return { wall: i === 0 ? n - 2 : i - 1, at };
    return { wall: w > i ? w - 1 : w, at };
  };
  const out: Partial<StructureItem> = {};
  if (st.openings?.length) out.openings = st.openings.map(o => ({ ...o, ...map(o.wall, o.at) }));
  if (st.addOns?.length) out.addOns = st.addOns.map(o => ({ ...o, ...map(o.wall, o.at) }));
  if (st.handWalls?.length) out.handWalls = [...new Set(st.handWalls.flatMap(w => (change === "split" && w === i ? [i, i + 1] : [map(w).wall])))];
  if (st.wallColors) {
    const c: Record<number, string> = {};
    for (const [k, v] of Object.entries(st.wallColors)) {
      const w = Number(k);
      if (change === "split" && w === i) { c[i] = v; c[i + 1] = v; } else if (c[map(w).wall] === undefined) c[map(w).wall] = v;
    }
    out.wallColors = c;
  }
  if (st.front !== undefined) out.front = map(st.front, len(st.front) / 2).wall;
  return out;
};

// ------------------------------------------------------------------ the import's guesses

/** A color as the eye sees it (CIE Lab), from 0-255 sRGB. */
export const roofLab = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};

/**
 * A roof's color from its color on the photo: grays by how light (against `mid`, the site's middle
 * roof's lightness, taken as a mid-gray roof's), colors by their hue, with `cast` (the site's middle
 * roof's tint) taken out. Red metal fades to pink from the air; brown shingles show only a little
 * color. (Checked on 650 roofs in Raleigh: about nine in ten right on the state's 6 in photo.)
 */
export const snapRoof = (rgb: [number, number, number], mid: number, cast: [number, number] = [0, 0]) => {
  const [L0, a0, b0] = roofLab(rgb);
  const L = L0 - mid + 56, a = a0 - cast[0], b = b0 - cast[1];
  const C = Math.hypot(a, b), h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  if (C >= 13 && (h < 55 || h >= 340)) return L < 52 ? "Barn red" : "Terracotta";
  if (C >= 9 && h >= 55 && h < 105) return L < 52 ? "Brown" : L < 64 ? "Cedar" : "Tan";
  if (C >= 12 && h >= 105 && h < 190) return "Forest";
  if (C >= 12 && h >= 190) return "Slate blue";
  return L < 36 ? "Black" : L < 48 ? "Charcoal" : L < 64 ? "Weathered gray" : L < 80 ? "Light gray" : "White";
};

/** What a building is, from what the maps call it (OpenStreetMap's building or amenity tag,
 * Overture's class or subtype); unset where they don't say. */
export const typeFromMap = (...names: (string | undefined)[]): BuildingType | undefined => {
  for (const n of names) {
    const v = (n ?? "").toLowerCase();
    if (!v || v === "yes" || v === "building") continue;
    if (/^(house|detached|residential|semidetached_house|semi|terrace|bungalow|cabin|apartments|dormitory|farm|static_caravan)$/.test(v)) return "house";
    if (/^(garage|garages|carport|parking)$/.test(v)) return "garage";
    if (/^(barn|farm_auxiliary|stable|cowshed|agricultural|greenhouse|sty)$/.test(v)) return "barn";
    if (/^(shed|hut|storage_tank|service|outbuilding)$/.test(v)) return "shed";
    if (/^(toilets|restroom|restrooms)$/.test(v)) return "restrooms";
    if (/^(church|chapel|cathedral|mosque|synagogue|temple|religious|place_of_worship)$/.test(v)) return "church";
    if (/^(school|university|college|kindergarten|education)$/.test(v)) return "school";
    if (/^(retail|commercial|supermarket|shop|kiosk|office|industrial|warehouse)$/.test(v)) return "store";
    if (/^(clubhouse|pavilion|sports_hall|sports_centre|civic|public|community_centre|recreation)$/.test(v)) return "clubhouse";
  }
  return undefined;
};

/** A roof color's likely covering, in the US: metal where shingles rarely are that color. */
const METAL_ROOFS = new Set(["Terracotta", "Barn red", "White", "Forest", "Slate blue"]);
const seedOf = (pts: P[]) => {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  return (Math.round(c.x) * 73856093) ^ (Math.round(c.y) * 19349663);
};

/**
 * A building as the import guesses it: a color scheme that goes with its roof (`roof`: the roof
 * color read from the photo, if it was), picked at random among those but the same each time for
 * that spot; its roofing metal where its color says so; its front door toward `toward` (the
 * nearest path, road or parking, where there's one). One already painted is left as it is.
 */
export const dressBuilding = (st: StructureItem, roof: string | undefined, toward?: (p: P) => number): StructureItem => {
  if (st.kind !== "building" || st.siding || st.wallColor || st.roofColor || st.trimColor) return st;
  const seed = seedOf(st.points);
  const type = st.buildingType ?? "house";
  const roofName = roof ?? ["Charcoal", "Weathered gray", "Weathered gray", "Black", "Brown"][Math.abs(seed) % 5];
  const s = type === "barn" ? SCHEMES.find(x => x.id === "barn")! : schemeForRoof(roofName, seed);
  const out: StructureItem = { ...st, ...schemePatch(s, true), roofColor: ROOF_COLORS.find(r => r.name === roofName)!.color, guessed: [...new Set([...(st.guessed ?? []), "colors" as const])] };
  if (METAL_ROOFS.has(roofName) || type === "barn") out.roofing = "metal";
  if (toward) {
    const walls = buildingFrame(st, () => 0).walls;
    let best = -1, bd = Infinity;
    walls.forEach((w, i) => {
      if (w.len < 8) return;
      const d = toward({ x: (w.a.x + w.b.x) / 2 + w.out.x * 10, y: (w.a.y + w.b.y) / 2 + w.out.y * 10 });
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd < 300) out.front = best;
  }
  return out;
};
