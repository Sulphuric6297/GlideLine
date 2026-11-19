import type { AmenityKind, AreaKind, FieldKind, LineKind, PathSurface, PinPosition, RockKind, RockLook, RockStone, RoofKind, StructureKind, TeeLevel, TeeSurface } from "./types";

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const generateId = () => Math.random().toString(36).slice(2, 11);

export const FT_PER_M = 3.28084;

/** A new blank course: a rectangle of open ground, ft. */
export const DEFAULT_CANVAS = { width: 1600, height: 1100 };
export const OBJECT_ELEVATION_OFFSET = 0.08;
export const MAP_OVERLAY_OFFSET = 0.02;

/** Eye height of a player on the tee, ft (tee views and flyovers). */
export const EYE_HEIGHT_FT = 5.5;
/** The tee view's "hole" when standing somewhere away from every hole (the person dropped there). */
export const STAND_HERE = "here";
/** How near a hole's line the person must land to stand on that hole (feet); farther, it stands on its own. */
export const STAND_NEAR_FT = 150;
/** The putting circle ("Circle 1"): 10 m around the basket. */
export const CIRCLE_ONE_FT = 10 * FT_PER_M;
/** Circle 2: 20 m. */
export const CIRCLE_TWO_FT = 20 * FT_PER_M;

/** Tee colors: the PDGA's skill levels, with the player ratings they are for. */
export const TEE_LEVELS: Record<TeeLevel, { label: string; skill: string; rating: string; color: string; ink: string }> = {
  gold: { label: "Gold", skill: "Pro", rating: "970+", color: "#e3b505", ink: "#1c1917" },
  blue: { label: "Blue", skill: "Advanced", rating: "925+", color: "#2563eb", ink: "#ffffff" },
  white: { label: "White", skill: "Intermediate", rating: "875+", color: "#f8fafc", ink: "#1c1917" },
  red: { label: "Red", skill: "Recreational", rating: "825+", color: "#dc2626", ink: "#ffffff" },
  green: { label: "Green", skill: "Novice", rating: "under 825", color: "#16a34a", ink: "#ffffff" },
  purple: { label: "Purple", skill: "Beginners / juniors", rating: "under 750", color: "#7c3aed", ink: "#ffffff" }
};
export const TEE_ORDER: TeeLevel[] = ["gold", "blue", "white", "red", "green", "purple"];

export const TEE_SURFACES: Record<TeeSurface, { label: string; color: string }> = {
  concrete: { label: "Concrete", color: "#cfcac0" },
  turf: { label: "Artificial turf", color: "#3f8f4a" },
  rubber: { label: "Rubber mat", color: "#2b2b2e" },
  pavers: { label: "Pavers", color: "#b7a08a" },
  gravel: { label: "Gravel", color: "#a7a195" },
  natural: { label: "Grass or dirt", color: "#8b7b5c" }
};

/** Typical tee pad: 5 ft wide, 12 ft long (PDGA: at least 4 x 10 ft; 6 x 13 ft at long tees). */
export const DEFAULT_PAD = { width: 5, length: 12 };
export const MIN_PAD = { width: 4, length: 10 };
/** Nothing in the way this close in front of a tee (PDGA design guide), ft. */
export const CLEAR_IN_FRONT_FT = 20;
/** Usual fairway width in the woods (PDGA: 15 ft pinch points up to 40 ft), ft. */
export const DEFAULT_FAIRWAY_FT = 30;

export const PIN_POSITIONS: PinPosition[] = ["A", "B", "C", "D"];

/** The compass's eight points, from north round to the east (a tree's lean, a tee's facing). */
export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** A bearing (degrees from north, clockwise) as its nearest compass point: "NE". */
export const compassPoint = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Each kind of area: one short name (the same on the tool bar's chips, in its panel and in
 * Search), and a line on what it is (the tooltip on its tool bar chip). */
export const AREA_KINDS: Record<AreaKind, { label: string; color: string; fill: number; help: string }> = {
  ob: { label: "OB area", color: "#ef4444", fill: 0.22, help: "A disc that lands in here is out of bounds, and that's a penalty throw." },
  hazard: { label: "Hazard", color: "#eab308", fill: 0.2, help: "A penalty area that isn't OB. The disc is played where it lies, plus a penalty throw. The PDGA marks hazards yellow." },
  casual: { label: "Casual area", color: "#3b82f6", fill: 0.2, help: "Players can move their lie out of it with no penalty, like casual water. The PDGA marks these blue." },
  water: { label: "Water", color: "#2b8fd6", fill: 0.55, help: "A pond or a lake. It counts as OB unless you set Not OB. For a creek, use Stream in the Water tool." },
  fairway: { label: "Fairway", color: "#8fd16a", fill: 0.35, help: "A fairway shape you draw yourself, for when the hole's own fairway doesn't fit." },
  green: { label: "Landing zone", color: "#b7ec8a", fill: 0.4, help: "The mown area around a basket, or where a drive should end up." },
  woods: { label: "Woods", color: "#2f5d34", fill: 0.45, help: "A stand of trees, drawn as treetops on the map. What grows in it is set below." },
  rough: { label: "Tall grass", color: "#a8a35a", fill: 0.3, help: "Long grass, drawn taller in 3D than the grass around it." },
  nogo: { label: "Out of play", color: "#7c3aed", fill: 0.22, help: "Somewhere players have to stay out of: a playground, a garden, private land. The PDGA calls it a required relief area. It's played like OB, but with no penalty." },
  parking: { label: "Parking lot", color: "#6b7280", fill: 0.5, help: "A parking lot. Checks warn about a hole that throws over one, and about a first tee or a last basket that's a long walk from it." },
  building: { label: "Building", color: "#a8a29e", fill: 0.7, help: "A building as a flat shape on the map. For walls and a roof in 3D, use a Building from the Build tool." },
  field: { label: "Field or court", color: "#6aa84f", fill: 0.5, help: "A ball field, a court, a playground or a pool: drawn as itself on the map and in 3D." },
  sand: { label: "Sand or dirt", color: "#d9c48f", fill: 0.5, help: "Sand, dirt or bare ground. No grass or trees grow on it." },
  rock: { label: "Rock surface", color: "#9a948a", fill: 0.6, help: "Bare rock in the ground: bedrock, broken rock, rocky ground or a cliff face, in the stone you pick." }
};

/** The kinds of area offered in a shape's panel and a phone's strip, in this order (rules first,
 * then water, trees and grass; a flat building is an old course's, offered only to one that is one). */
export const AREA_ORDER: AreaKind[] = ["ob", "hazard", "casual", "nogo", "water", "woods", "rough", "fairway", "green", "sand", "rock", "parking"];

/** What paths and walks can be made of (dirt takes the map's path color). */
export const PATH_SURFACES: Record<PathSurface, { label: string; color: string }> = {
  dirt: { label: "Dirt", color: "#b08a5a" },
  gravel: { label: "Gravel", color: "#a39a86" },
  woodchips: { label: "Wood chips", color: "#7a5236" },
  grass: { label: "Mown grass", color: "#9cc46a" },
  paved: { label: "Paved", color: "#cfccc4" }
};

/** Each kind of line: its name, its usual width (0: drawn as a thin line) and the widest it goes,
 * ft, and a line on what it is; a fence its usual height and `heights` (the panel's slider and a
 * phone's dial). */
export const LINE_KINDS: Record<LineKind, { label: string; color: string; width: number; maxWidth: number; height?: number; heights?: [number, number]; help: string }> = {
  ob: { label: "OB line", color: "#ef4444", width: 0, maxWidth: 60, help: "The line is OB, and so is everything past it on the side away from play." },
  path: { label: "Walking path", color: "#c8a06a", width: 5, maxWidth: 60, help: "A trail people walk on, between holes or through the park." },
  walk: { label: "Next-tee route", color: "#ffffff", width: 0, maxWidth: 60, help: "The way players walk from a basket to the next tee. With no width, it's a dashed line on the map." },
  road: { label: "Road", color: "#6b7280", width: 22, maxWidth: 60, help: "A road or a drive. Checks warn about any hole that throws across one." },
  fence: { label: "Fence", color: "#78716c", width: 0, maxWidth: 60, height: 4, heights: [2, 12], help: "A fence that stands up in 3D: posts and rails, boards or chain link." },
  stream: { label: "Stream", color: "#2b8fd6", width: 6, maxWidth: 200, help: "A creek or a ditch. It counts as OB unless you set Not OB. Drag the squares on its banks to make it wider in places." },
  power: { label: "Power line", color: "#a8a29e", width: 0, maxWidth: 60, height: 30, heights: [15, 80], help: "Wires on poles overhead." },
  hedge: { label: "Hedge", color: "#3f6b35", width: 4, maxWidth: 20, height: 5, heights: [2, 12], help: "A row of bushes grown close together." },
  wall: { label: "Wall", color: "#8d877c", width: 2, maxWidth: 6, height: 3, heights: [1, 12], help: "A stone wall that follows the ground: dry stone or mortared blocks." }
};

/** A park's fields, courts and play areas: the name, the usual size (ft, for one placed by hand),
 * whether players start out of it, and the ground it's drawn with. */
export const FIELD_KINDS: Record<FieldKind, { label: string; size: [number, number]; outOfPlay?: boolean; ground: "grass" | "dirt" | "court" | "sand" | "water" | "rubber" | "concrete" | "mulch" }> = {
  baseball: { label: "Baseball field", size: [330, 330], ground: "grass" },
  softball: { label: "Softball field", size: [250, 250], ground: "grass" },
  soccer: { label: "Soccer field", size: [345, 225], ground: "grass" },
  football: { label: "Football field", size: [360, 160], ground: "grass" },
  multi: { label: "Sports field", size: [300, 200], ground: "grass" },
  tennis: { label: "Tennis court", size: [120, 60], ground: "court" },
  pickleball: { label: "Pickleball court", size: [64, 34], ground: "court" },
  basketball: { label: "Basketball court", size: [94, 50], ground: "court" },
  volleyball: { label: "Volleyball court", size: [78, 46], ground: "sand" },
  playground: { label: "Playground", size: [90, 70], outOfPlay: true, ground: "mulch" },
  pool: { label: "Pool", size: [82, 50], outOfPlay: true, ground: "water" },
  splash: { label: "Splash pad", size: [50, 50], outOfPlay: true, ground: "concrete" },
  dog: { label: "Dog park", size: [200, 150], outOfPlay: true, ground: "grass" },
  skate: { label: "Skate park", size: [120, 90], outOfPlay: true, ground: "concrete" },
  track: { label: "Running track", size: [580, 300], ground: "rubber" },
  garden: { label: "Garden", size: [100, 60], outOfPlay: true, ground: "mulch" }
};

/** Amenities: the name on the map's legend, and `pick`, the name to pick it by where that's
 * clearer (the P sign, not the lot). A shelter and a bridge are built with the Build tool now:
 * those two (`retired`) stay for the ones already on a course, and aren't offered for new ones. */
export const AMENITY_KINDS: Record<AmenityKind, { label: string; pick?: string; letter: string; color: string; retired?: boolean }> = {
  bench: { label: "Bench", letter: "B", color: "#a16207" },
  trash: { label: "Trash can", letter: "T", color: "#475569" },
  sign: { label: "Tee sign", letter: "S", color: "#0f766e" },
  kiosk: { label: "Course kiosk / map board", letter: "i", color: "#0e7490" },
  restroom: { label: "Restroom", letter: "WC", color: "#2563eb" },
  parking: { label: "Parking", pick: "Parking sign (P)", letter: "P", color: "#1d4ed8" },
  water: { label: "Drinking water", letter: "W", color: "#0284c7" },
  practice: { label: "Practice basket", letter: "PB", color: "#ea580c" },
  shelter: { label: "Shelter", pick: "Shelter (map symbol)", letter: "SH", color: "#7c2d12", retired: true },
  bridge: { label: "Bridge", pick: "Bridge (map symbol)", letter: "BR", color: "#78350f", retired: true },
  firstaid: { label: "First aid", letter: "+", color: "#dc2626" },
  picnic: { label: "Picnic table", letter: "PT", color: "#92400e" },
  here: { label: "\"You are here\" (on the map board)", pick: "You are here", letter: "★", color: "#ca8a04" },
  grill: { label: "Grill", letter: "G", color: "#b45309" },
  fitness: { label: "Fitness station", letter: "F", color: "#15803d" },
  flagpole: { label: "Flagpole", letter: "FL", color: "#64748b" },
  light: { label: "Light pole", letter: "L", color: "#ca8a04" },
  pole: { label: "Utility pole", letter: "UP", color: "#78716c" },
  bikerack: { label: "Bike rack", letter: "BK", color: "#0f766e" },
  fountain: { label: "Fountain", letter: "FT", color: "#0284c7" },
  gate: { label: "Gate", letter: "GT", color: "#78716c" }
};
/** The amenities offered for new ones, in order (the retired two left out). */
export const AMENITY_ORDER = (Object.keys(AMENITY_KINDS) as AmenityKind[]).filter(k => !AMENITY_KINDS[k].retired);

/** Built things: drawn along a line from end to end, or as an outline. Widths and heights are the
 * usual ones, in feet (each can be changed, within `widths` and `heights`: the same on a phone's
 * dials as in the panel's sliders). */
export const STRUCTURE_KINDS: Record<StructureKind, { label: string; shape: "line" | "outline"; width: number; widths: [number, number]; height: number; heights: [number, number]; heightLabel: string; roof?: RoofKind; color: string; help: string }> = {
  bridge: { label: "Bridge", shape: "line", width: 6, widths: [1, 24], height: 1, heights: [0, 10], heightLabel: "Deck above the banks", color: "#9a7b55", help: "A footbridge with railings. The deck runs straight from one bank to the other." },
  boardwalk: { label: "Boardwalk", shape: "line", width: 5, widths: [1, 24], height: 1.5, heights: [0, 10], heightLabel: "Deck above the ground", color: "#b49a74", help: "A low deck on posts over wet or soft ground. It follows the ground." },
  stairs: { label: "Stairs", shape: "line", width: 4, widths: [1, 24], height: 0, heights: [0, 0], heightLabel: "", color: "#a39b8e", help: "Stone steps up a slope. The steps follow the ground." },
  wall: { label: "Wall", shape: "line", width: 2, widths: [1, 6], height: 3, heights: [1, 12], heightLabel: "Wall height", color: "#8d877c", help: "A stone or retaining wall." },
  building: { label: "Building", shape: "outline", width: 0, widths: [0, 0], height: 12, heights: [6, 40], heightLabel: "Wall height", roof: "gable", color: "#a8653f", help: "A clubhouse, restroom, barn or shed, with walls and a roof." },
  shelter: { label: "Shelter", shape: "outline", width: 0, widths: [0, 0], height: 9, heights: [6, 20], heightLabel: "Eaves height", roof: "hip", color: "#4f7356", help: "An open pavilion: posts and a roof, with picnic tables under it." },
  deck: { label: "Deck", shape: "outline", width: 0, widths: [0, 0], height: 2.5, heights: [0, 10], heightLabel: "Deck above the ground", color: "#b8916a", help: "A raised wooden platform, like a tee deck or a viewing deck." }
};
export const STRUCTURE_ORDER: StructureKind[] = ["bridge", "boardwalk", "stairs", "wall", "building", "shelter", "deck"];

/** Each kind of rock: its name, usual size (ft: length, width, height) and a line on what it is
 * (the tool bar chip's tooltip and the help). The same sizes on a phone's dials as in the panel. */
export const ROCK_KINDS: Record<RockKind, { label: string; length: number; width: number; height: number; help: string }> = {
  boulder: { label: "Boulder", length: 6, width: 4.5, height: 3.5, help: "A rounded rock sitting in the grass." },
  block: { label: "Block", length: 5, width: 4, height: 3.5, help: "A broken, angular rock with flat faces." },
  ledge: { label: "Ledge", length: 10, width: 6, height: 2.5, help: "Flat beds of rock, each stepping back from the one below. Good to sit on, or for a tee." },
  outcrop: { label: "Outcrop", length: 16, width: 10, height: 4.5, help: "Bedrock breaking through the ground in tilted beds." },
  cluster: { label: "Cluster", length: 12, width: 8, height: 3.5, help: "A few rocks together, one big and some small." },
  wall: { label: "Rock wall", length: 22, width: 2, height: 2.5, help: "A dry-stone wall: flat stones stacked in rows." }
};
export const ROCK_ORDER: RockKind[] = ["boulder", "block", "ledge", "outcrop", "cluster", "wall"];
/** The stones, with the color a rock of it is on the map. */
export const ROCK_STONES: Record<RockStone, { label: string; color: string }> = {
  granite: { label: "Granite", color: "#a89b8c" },
  fieldstone: { label: "Fieldstone", color: "#8a7a66" },
  sandstone: { label: "Sandstone", color: "#a07a48" },
  basalt: { label: "Basalt", color: "#55504a" },
  redgranite: { label: "Red granite", color: "#8a5f4a" }
};
export const STONE_ORDER: RockStone[] = ["granite", "fieldstone", "sandstone", "basalt", "redgranite"];
/** A stone's color as it shows. The map paints a stone softened (a little warm gray in it, half
 * its saturation: lib/forest's stonePalOf); a rock, a wall, a rock surface and steep rock in 3D,
 * and the stone's swatch, are this same color, so a stone looks one way wherever it is. */
export const stoneShown = (stone: RockStone): string => {
  const n = parseInt(ROCK_STONES[stone].color.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => v * 0.85 + [186, 172, 152][i] * 0.15);
  const gray = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  return "#" + c.map(v => Math.round(gray + (v - gray) * 0.5).toString(16).padStart(2, "0")).join("");
};
/** What a rock surface is: its name, its ground scan (three/groundDetail's LAYERS) and how much
 * grass grows through it and how many loose stones lie on it by default. */
export const ROCK_LOOKS: Record<RockLook, { label: string; layer: "bedrock" | "broken" | "rocky" | "cliff"; grass: number; stones: number; help: string }> = {
  bedrock: { label: "Bedrock", layer: "bedrock", grass: 0.3, stones: 0.1, help: "Bare rock, smooth and cracked, lifting a little out of the turf." },
  broken: { label: "Broken rock", layer: "broken", grass: 0.1, stones: 0.8, help: "Loose broken stones, like scree under a cliff." },
  rocky: { label: "Rocky ground", layer: "rocky", grass: 0.4, stones: 0.3, help: "Soil full of stones, with a few loose on top." },
  cliff: { label: "Cliff", layer: "cliff", grass: 0.1, stones: 0, help: "The layered rock of a cliff face. Steep ground shows it by itself." }
};
export const ROCK_LOOK_ORDER: RockLook[] = ["bedrock", "broken", "rocky", "cliff"];
/** Steep ground shows bare rock from this slope up, degrees: a new course's steepRock. A course
 * saved without one shows none (STEEP_NEVER), as it did before. */
export const STEEP_ROCK = 40;
export const STEEP_NEVER = 90;

export const TREE_COLORS = ["#4a7a3a", "#3d6b2f", "#5c8a3c", "#2f5d34", "#7a9a3a"];
