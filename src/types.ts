// The course document. Plan units are feet; plan (x, y) is east and south from the site's
// north-west corner (north is up), and maps to 3D world (x, z) with Y up.

export type P = { x: number; y: number };

/** Tee colors, longest to shortest (the PDGA's Gold / Blue / White / Red skill levels, plus Green). */
export type TeeLevel = "gold" | "blue" | "white" | "red" | "green" | "purple";
export type TeeSurface = "concrete" | "turf" | "rubber" | "pavers" | "gravel" | "natural";
export type PinPosition = "A" | "B" | "C" | "D";

export interface BaseItem {
  id: string;
  x: number;
  y: number;
  /** Degrees, clockwise on screen from east (+x). */
  rotation: number;
  /** Locked in place: it can be picked, but not moved, reshaped or deleted. */
  locked?: boolean;
  /** Brought in by an import: what it was like when it came (`signOf` in lib/importSite). One
   * changed since is yours: a new lookup, bringing the site in again or Remove leave it alone. */
  importSig?: string;
}

/** A tee pad (one hole can have several, one per tee color). */
export interface TeeItem extends BaseItem {
  type: "tee";
  holeId: string;
  level: TeeLevel;
  /** Pad size in feet (width across the throw, length along it). */
  padWidth: number;
  padLength: number;
  surface: TeeSurface;
  /** Turned by hand; otherwise the pad faces down its hole. */
  aimFixed?: boolean;
}

/** A basket (target). A hole can have several pin positions (A, B, C...). */
export interface BasketItem extends BaseItem {
  type: "basket";
  holeId: string;
  /** Other holes played to this basket too (each from its own tee, with its own number). */
  alsoHoles?: string[];
  position: PinPosition;
  /** Raised on a platform or slope above the ground, ft (an elevated basket). */
  raised?: number;
}

/** A mandatory: the disc must pass on this side of it (an arrow sign on a post or a tree). */
export interface MandoItem extends BaseItem {
  type: "mando";
  holeId?: string;
  /** The side the disc must pass: as seen looking along the arrow (rotation = direction of play). */
  side: "left" | "right";
  /** A one-way gate for a double mando: its partner. */
  pairId?: string;
}

/** Where a player throws from after missing a mando or going OB. */
export interface DropZoneItem extends BaseItem {
  type: "dropzone";
  holeId?: string;
}

export type TreeKind = "deciduous" | "conifer" | "bush";
export interface TreeItem extends BaseItem {
  type: "tree";
  /** Crown radius, ft. */
  radius: number;
  height?: number;
  width?: number;
  treeType?: TreeKind;
  color: string;
  /** Its shape among the kind's variants, and its exact leaf color: a tree made the course's own
   * from a wood or the survey keeps the look it had there. */
  variant?: number;
  leaf?: string;
  /** Its species within the kind (an oak or an ash, a round or an airy bush…) and its seed: a new
   * seed grows a different tree of the same species. */
  species?: string;
  seed?: number;
  /** Where its branches start, a share of the trunk (unset: the species' own). */
  crownBase?: number;
  /** Lean from upright, degrees, toward `leanDir` (degrees clockwise from north). */
  lean?: number;
  leanDir?: number;
  /** Main limbs off the trunk (a pine: its branches up the trunk). */
  limbs?: number;
  /** Trunk thickness and leaves, 1 = the species' own. */
  trunk?: number;
  fullness?: number;
  /** Found on the imported aerial photo, or mapped on OpenStreetMap (one by one, in a row, or a
   * hedge's bushes): replaced on re-import. */
  importSource?: "photo" | "osm" | "lidar";
}

/** What a park's thing is on OpenStreetMap (a ball field, a playground, a pool…), kept with it
 * as it came, whatever kind it's drawn as. */
export type ParkKind = "pitch" | "playground" | "pool" | "dog_park" | "court" | "garden" | "sports_centre" | "track" | "skatepark" | "fountain" | "splash_pad" | "water_tower" | "shed" | "flagpole" | "goal" | "backstop" | "infield" | "outfield";
export type ParkDetail = { what: ParkKind; sport?: string; surface?: string };

export type AmenityKind = "bench" | "trash" | "sign" | "kiosk" | "restroom" | "parking" | "water" | "practice" | "shelter" | "bridge" | "firstaid" | "picnic" | "here"
  | "grill" | "fitness" | "flagpole" | "light" | "pole" | "bikerack" | "fountain" | "gate";
export interface AmenityItem extends BaseItem {
  type: "amenity";
  kind: AmenityKind;
  label?: string;
  /** Brought in from OpenStreetMap (replaced on re-import). */
  importSource?: "osm";
  /** Its mark shown on the map and in 3D (unset: shown). */
  mark?: boolean;
  /** How far it spans, ft (a gate: across the road or path it closes). */
  width?: number;
}

export interface LabelItem extends BaseItem {
  type: "label";
  text: string;
  fontSize: number;
  color: string;
}

/** Areas drawn on the map. OB and hazards are what play cares about; the rest make the map read. */
export type AreaKind = "ob" | "hazard" | "casual" | "water" | "fairway" | "green" | "woods" | "rough" | "nogo" | "parking" | "building" | "sand" | "field";
/** A ball field's size, by who plays on it. */
export type FieldLeague = "teeball" | "little" | "softball" | "high";
/** The pieces a field or court is made of, each picked and set on its own. */
export type FieldPart = "grass" | "infield" | "mound" | "lines" | "backstop" | "fence" | "dugouts" | "track" | "courts" | "surround" | "nets";
/** A part's own settings: off; its height, distance and width (ft; what each is for depends on
 * the part: a backstop's height and how far behind home, a dugout's length and how far out); a
 * color by name; mown bands (0: none). */
export type FieldPartSet = { off?: boolean; h?: number; d?: number; w?: number; c?: string; n?: number };
export type CourtColors = "blue" | "green" | "red";
/** What a park's field, court or play area is (an area of kind "field"). */
export type FieldKind = "baseball" | "softball" | "soccer" | "football" | "multi" | "tennis" | "pickleball" | "basketball" | "volleyball"
  | "playground" | "pool" | "splash" | "dog" | "skate" | "track" | "garden";
/** What a wood's underbrush is: a mix, or mostly thicket shrubs, briars and thorns, or weeds. */
export type BrushKind = "mixed" | "thicket" | "briars" | "weeds";

export interface AreaItem extends BaseItem {
  /** Straight between its corners (unset: a smooth curve through them, but parking and buildings). */
  straight?: boolean;
  /** More holes it belongs to (an OB line along two fairways): with `holeId`, all of them. */
  alsoHoles?: string[];
  type: "area";
  kind: AreaKind;
  /** A field, court or play area: what it is (unset: a plain sports field). */
  field?: FieldKind;
  /** Out of play (a field's own rule; playgrounds, pools and the like start out of play): players
   * stay out of it, as with an Out of play area. */
  outOfPlay?: boolean;
  /** Its markings turned this many degrees from the outline's own long side (unset: lined up with it);
   * a ball field's home plate at corner `home` of its outline (unset: the corner nearest a right angle). */
  fieldTurn?: number;
  home?: number;
  /** A ball field's home plate placed by hand: from corner `home`, this far along the corner's
   * middle line (x) and across it (y) (ft); the field faces the middle of its outline from there
   * (unset: just in from the corner). */
  plate?: P;
  /** A ball field's size, by who plays on it (unset: worked out from the outline). */
  league?: FieldLeague;
  /** Its parts' own settings: one switched off, a backstop's height and how far behind home it
   * stands, a fence's height (by part). */
  parts?: Partial<Record<FieldPart, FieldPartSet>>;
  /** Courts' colors (unset: blue courts in green). */
  courtColors?: CourtColors;
  /** Outline in plan coordinates (x, y of the item is its middle). */
  points: P[];
  /** For one hole only (unset: the whole course). */
  holeId?: string;
  label?: string;
  /** Out of bounds: water is unless set false; true also draws the red OB edge on the map. */
  ob?: boolean;
  /** A hazard (a stroke's penalty, played from where it went in): its dashed hazard edge on the
   * map. Never OB as well. */
  hazard?: boolean;
  /** The stretches of its edge that are OB, each from-to as fractions round it from its first
   * point (unset: all the way round). */
  obStretches?: [number, number][];
  /** Woods: which trees stand in it in 3D: those measured from the air (the default, when the
   * course has them), custom (the measured ones, plus `patches` of drawn trees filling in where
   * the survey saw none or they've grown since), drawn trees only, or none (measured ones inside
   * cut down). */
  trees?: "measured" | "custom" | "drawn" | "none";
  /** Custom: patches drawn inside the wood where drawn trees fill in between the measured ones,
   * each as thickly as its `fill` says (0.1 to 1). */
  patches?: { points: P[]; fill: number }[];
  /** Woods filled by the app: its mix (shares of pines and of bushes; the rest leafy), how thick
   * (1 = usual), and its trees' heights (ft). Unset: the landscape's. */
  pines?: number;
  /** A stand's one species (lib/treeMix: oak, pear, spruce…), the Trees tool's or set in its panel;
   * unset: the course's kinds of trees. */
  species?: string;
  bushes?: number;
  density?: number;
  heights?: [number, number];
  /** Underbrush beneath its trees: bushes and young trees, light to heavy (unset: none). */
  underbrush?: "light" | "medium" | "heavy";
  /** What the underbrush is: a mix (unset), thicket shrubs, briars and thorns, or weeds. */
  brushKind?: BrushKind;
  /** Sections of the wood with underbrush of their own (none, or light to heavy, and its own
   * kind, unset: the wood's): the wood's own setting covers the rest. */
  brush?: { points: P[]; level: "none" | "light" | "medium" | "heavy"; kind?: BrushKind }[];
  /** How much thicker underbrush grows along the wood's edge, where light gets in, than deep
   * inside: 0 even everywhere, 1 almost none deep inside (unset: 0.6). */
  brushEdge?: number;
  /** Brought in from OpenStreetMap, or found on the satellite photo (replaced on re-import). */
  importSource?: "osm" | "photo" | "lidar" | "usgs" | "nwi";
  /** From OpenStreetMap: what it is there (a ball field, a playground), whatever kind it's drawn as. */
  park?: ParkDetail;
}

/** Lines drawn on the map: OB lines (the line itself is OB), paths, roads, fences, streams. */
/** The tiers paths and roads stack in where they cross. */
export type PathTier = "dirt" | "gravel" | "walkway" | "road";
export type LineKind = "ob" | "path" | "road" | "fence" | "stream" | "walk" | "power" | "hedge";
/** A fence in 3D: wooden posts with two rails, solid boards, or chain link on metal posts. */
export type FenceStyle = "rail" | "boards" | "chain";
/** What a path or a walk between holes is made of. */
export type PathSurface = "dirt" | "gravel" | "woodchips" | "grass" | "paved";
export interface LineItem extends BaseItem {
  /** More holes it belongs to (an OB line along two fairways): with `holeId`, all of them. */
  alsoHoles?: string[];
  type: "line";
  kind: LineKind;
  points: P[];
  /** Drawn width in feet (paths, roads and streams). */
  width?: number;
  /** How much wider or narrower than `width` it is at each point (1: as wide; one per point; unset:
   * the same width all along). */
  widths?: number[];
  /** What a path or a walk is made of (unset: dirt). */
  surface?: PathSurface;
  /** Straight between its points (paths, walks, streams and roads curve through them unless set). */
  straight?: boolean;
  /** A fence: how it's built in 3D (unset: posts and rails). How tall a fence, a hedge or a power
   * line's wires are, ft (unset: the kind's usual, LINE_KINDS). */
  fenceStyle?: FenceStyle;
  fenceHeight?: number;
  holeId?: string;
  label?: string;
  /** Out of bounds: a stream is unless set false; a road, fence or path is when true (and then
   * its red OB edge is drawn on the map). */
  ob?: boolean;
  /** A hazard (a stroke's penalty): its dashed hazard edge along it on the map. Never OB as well. */
  hazard?: boolean;
  /** Out of bounds beyond it too (the road and beyond): OB from its edge on the holes' side. */
  obBeyond?: boolean;
  /** OB and beyond: the side that is out (1: right of the way it was drawn, -1: left); unset: the
   * app's guess, away from the holes. */
  obToward?: 1 | -1;
  /** The holes it is OB for (unset: every hole it belongs to). OB and beyond starts at its edge
   * on their side. */
  obHoles?: string[];
  /** The stretches of it that are out of bounds, each from-to as fractions of it as drawn (0 its
   * start, 1 its end; unset: all of it). */
  obStretches?: [number, number][];
  /** Brought in from OpenStreetMap (replaced on re-import). */
  importSource?: "osm" | "usgs";
  /** From OpenStreetMap: what it is there (a ball field's backstop), whatever kind it's drawn as. */
  park?: ParkDetail;
}

/** Built things: drawn along a line (bridges, boardwalks, stairs, walls) or as an outline
 * (buildings, shelters, decks). Real-scale models in 3D, drawn to scale on the printed map. */
export type StructureKind = "bridge" | "boardwalk" | "stairs" | "wall" | "building" | "shelter" | "deck";
export type RoofKind = "gable" | "hip" | "flat" | "shed" | "pyramid";
export interface StructureItem extends BaseItem {
  /** More holes it belongs to (an OB line along two fairways): with `holeId`, all of them. */
  alsoHoles?: string[];
  type: "structure";
  kind: StructureKind;
  /** Along the line from one end to the other, or the outline (plan coordinates; x, y of the item
   * is its middle). */
  points: P[];
  /** Width of a bridge, boardwalk or stairs, or a wall's thickness, ft (unset: the kind's usual). */
  width?: number;
  /** Ft (unset: the kind's usual): a building's walls, a shelter's posts, how high a deck or a
   * boardwalk stands, a bridge's deck above its banks, a wall's height. */
  height?: number;
  /** Buildings and shelters (unset: gable for a building, hip for a shelter). */
  roof?: RoofKind;
  /** The roof's slope, rise over run, as measured from the air (unset: about 6 in 12). */
  roofPitch?: number;
  /** The ridge runs across the building, between its long sides (unset: along its length). */
  ridgeAcross?: boolean;
  /** Its own colors (unset: the map's): the roof, and a building's walls. */
  roofColor?: string;
  wallColor?: string;
  /** Brought in from OpenStreetMap, or (a building nobody's mapped) traced from the air: looking
   * the maps up again replaces it. */
  importSource?: "osm" | "traced" | "fema" | "lidar";
  /** From OpenStreetMap: what it is there (a shed, a water tower), whatever kind it's drawn as. */
  park?: ParkDetail;
  holeId?: string;
  label?: string;
}

export type CourseItem = TeeItem | BasketItem | MandoItem | DropZoneItem | TreeItem | AmenityItem | LabelItem | AreaItem | LineItem | StructureItem;
export type ItemType = CourseItem["type"];

/** A hole. Its tees and baskets are items that point back to it; the order in `holes` is the
 * order of play. */
export interface Hole {
  id: string;
  /** Its number, typed in (unset: the first number free, in course order). */
  number?: number;
  /** More numbers it is played as (e.g. 12 as well as 3: "3/12"). */
  alsoNumbers?: number[];
  /** No automatic walk from this hole on to the next. */
  walkOff?: boolean;
  /** This hole's own flyover settings (over the course's). */
  flyover?: Partial<FlyoverSettings>;
  /** This hole's own tee sign settings (over the course's). */
  sign?: SignSettings;
  /** This hole's own hole page pieces (over the course's). */
  page?: { layout?: Record<string, PiecePlace> };
  /** Shown name, e.g. "The Gauntlet" (optional). */
  name?: string;
  /** Par set by hand; unset: worked out from the hole's length, elevation and shape. */
  par?: number;
  /** Turning points of the throw line between the tee and the basket (plan coordinates). */
  doglegs: P[];
  /** Fairway width, ft (drawn along the throw line). */
  fairwayWidth: number;
  /** The fairway wider or narrower in places: its width at each of FAIRWAY_STATIONS along the
   * hole, as a share of `fairwayWidth` (unset: the same width all along). */
  fairwayShape?: number[];
  /** The fairway's middle moved off the throw line at each of FAIRWAY_STATIONS (toward the left of
   * the hole's normal, as a share of `fairwayWidth`): one side wider than the other (unset: centered). */
  fairwayShift?: number[];
  /** Where along the hole (0 the tee, 1 the basket) the fairway's width and middle are set: the
   * points `fairwayShape` and `fairwayShift` go with (unset: FAIRWAY_STATIONS). */
  fairwayStations?: number[];
  /** Draw the fairway along the throw line (off: only a drawn fairway area, or none). */
  fairway: boolean;
  /** Heavy foliage makes a hole play longer (PDGA par guidelines). Unset: worked out from the trees. */
  foliage?: "light" | "heavy";
  /** Notes for the tee sign and the hole sheet (hole rules: OB, mandos, drop zones). */
  notes?: string;
  /** A flyover made by hand: the camera's keyframes, in order (two or more; unset: flown by itself). */
  flyKeys?: FlyKey[];
  /** Where the walk to the next tee starts, moved by hand: ft from this hole's basket (unset: outside
   * the putting circle, away from the fairway, toward the next tee). */
  walkOut?: P;
  /** Where the walk from the hole before arrives, moved by hand: ft from this hole's tee (unset:
   * behind the tee). */
  walkIn?: P;
  /** The walk on to the next tee: its width (ft) and what it is made of (unset: a worn dirt trail). */
  walkWidth?: number;
  walkSurface?: PathSurface;
}

/** One moment of a hand-made flyover: where the camera is and what it looks at. */
export interface FlyKey {
  /** Where the camera is (plan, ft). */
  x: number;
  y: number;
  /** Its height above the ground there, ft. */
  alt: number;
  /** What it looks at (plan, ft), and how high over the ground there (unset: 3 ft). */
  lookX: number;
  lookY: number;
  lookAlt?: number;
  /** Field of view here, degrees (unset: the course's). */
  fov?: number;
  /** Seconds from the keyframe before (unset: from the distance, at the course's speed). */
  secs?: number;
}

/** How flyovers fly: on screen and in videos. */
export interface FlyoverSettings {
  /** Height above the ground, ft (higher where trees stand). */
  height: number;
  /** How fast it flies: 1 the usual pace (a hole takes 6 to 14 s), 2 twice as fast. */
  speed: number;
  /** Field of view, degrees. */
  fov: number;
  /** How far behind the tee it starts, ft. */
  behind: number;
  /** To the side of the line of play, ft (right, looking down the hole; negative: left). */
  side: number;
  /** How far down the hole it looks ahead, ft. */
  lookAhead: number;
  /** On screen (each one shown unless switched off): the hole's big title as the flight starts,
   * its badge in the corner, the marker over the basket with the distance left, the course's name;
   * in the picture, the disc's flight (the yellow arc), the line of play on the ground, the putting
   * circle, OB lines and areas, other holes' lines, and walks to the next tee. */
  title: boolean;
  badge: boolean;
  pinDistance: boolean;
  courseName: boolean;
  playLine: boolean;
  circle: boolean;
  ob: boolean;
  otherHoles: boolean;
  walks: boolean;
}

/** What a flyover can show or hide. */
export type FlyShow = "title" | "badge" | "pinDistance" | "courseName" | "playLine" | "circle" | "ob" | "otherHoles" | "walks";

/** A layout picks which tee and pin each hole uses (e.g. "Blue", long tees to B pins). */
export interface Layout {
  id: string;
  name: string;
  tee: TeeLevel;
  pin: PinPosition;
}

/** How a new area or line is drawn: point by point, a dragged rectangle or circle, or freehand. */
export type DrawShape = "points" | "box" | "circle" | "freehand" | "paint";

/** Ways to draw elevation: soft light and shadow; inked rims over darker walls; hand-drawn strokes
 * down the slopes; lit contour lines with their heights; the land in stepped layers. */
/** ("sketched", no longer offered, is read as "cliffs") */
export type ReliefLook = "shaded" | "cliffs" | "sketched" | "contours" | "terraces";
export type MapTheme = "forest" | "illustrated" | "satellite" | "topo" | "minimal" | "night";

/** A basket's mark on the printed map: side view, side view in a round badge, a pin flag, target
 * rings, or the hole number in a circle. */
export type BasketMark = "basket" | "badge" | "flag" | "target" | "number";
export type PaperSize = "letter" | "tabloid" | "18x24" | "24x36" | "36x48" | "a4" | "a3";

/** The parts of a tee sign that can be shown or left out. */
export type SignPart = "courseName" | "number" | "par" | "lengths" | "elevation" | "notes" | "courseMap" | "nextTee" | "north" | "scale" | "throwLine" | "circle" | "distances" | "holeOf" | "designer" | "legend";
/** How tee signs look (the course's, and a hole's own over them). */
/** A piece of a printout moved, sized or restyled by hand (lib/pieces): shifted by shares of the
 * page, sized times its own (about the page's corner), its lettering's font and color, its panel's
 * color, or hidden. */
export interface PiecePlace {
  /** Its heading's words (unset: the look's own; "": none), and its lettering bold or not. */
  text?: string;
  /** Its other printed words as typed, by name (unset: the look's own; "": none). */
  words?: Record<string, string>;
  bold?: boolean;
  dx?: number;
  dy?: number;
  scale?: number;
  hidden?: boolean;
  font?: string;
  color?: string;
  fill?: string;
  /** Turned about its middle, degrees clockwise; how solid it is (0 to 1); its lettering slanted. */
  rot?: number;
  opacity?: number;
  italic?: boolean;
}
/** Something put on a tee sign or hole page: text (its {hole}, {par}, {length}, {course} and
 * {name} filled in for each hole), a picture, the hole's sponsors, or a QR code. Where it was put,
 * as shares of the page (top-left corner, width); on every hole, or the holes listed. */
export interface PrintExtra {
  id: string;
  /** A panel behind its words. */
  fill?: string;
  kind: "text" | "image" | "sponsors" | "sponsor" | "qr";
  /** The sponsor a "sponsor" piece shows (only on that sponsor's holes). */
  sponsorId?: string;
  /** How solid a picture is (0..1). */
  opacity?: number;
  /** Left off the page for now (Layers' eye brings it back). */
  hidden?: boolean;
  x: number;
  y: number;
  w: number;
  text?: string;
  /** Letter size, points. */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  /** Turned about its middle, degrees clockwise. */
  rot?: number;
  align?: "start" | "middle" | "end";
  font?: string;
  /** A picture (a data URL) and its height to width. */
  src?: string;
  aspect?: number;
  /** Where a QR code takes you. */
  url?: string;
  holes?: string[];
}
/** A hole sponsor: a logo, a line of text, or both, on every hole or the holes listed. */
export interface Sponsor {
  id: string;
  name: string;
  logo?: string;
  aspect?: number;
  text?: string;
  url?: string;
  holes?: string[];
}
/** How hole pages look, and their pieces placed by hand (the course's; a hole's own over it). */
export interface HolePageSettings {
  /** The usual page, or the hole's picture across the whole page with its number (unset: usual). */
  look?: "standard" | "justhole";
  layout?: Record<string, PiecePlace>;
  extras?: PrintExtra[];
}
export interface SignSettings {
  /** The other holes on a sign's map: faded (unset), left out, or as clear as its own. */
  others?: "faded" | "hidden" | "shown";
  /** How much the other holes show when faded (0..1). */
  fade?: number;
  /** Parts shown or left out (unset: as by default). */
  show?: Partial<Record<SignPart, boolean>>;
  /** What fills a wide sign's spot under the notes (unset: the course map). */
  spot?: SignSpot;
  /** How the signs look, for the whole course (unset: the first look; lib/signLooks). */
  look?: SignLook;
  /** The sign's pieces moved, sized or restyled by hand (by piece; a hole's own over the course's). */
  layout?: Record<string, PiecePlace>;
  /** Text, pictures, sponsors and QR codes put on the signs. */
  extras?: PrintExtra[];
}
export type SignLook = "classic" | "trailhead" | "fieldguide" | "openview";
/** A wide sign's spot under the notes: the course in miniature, the green up close, the hole's
 * numbers, or nothing. */
export type SignSpot = "courseMap" | "green" | "stats" | "none";

/** What is on the course map's page besides the map, each one moved, sized, colored or hidden by
 * hand in the Design step ("map" is the map itself: moved and zoomed on the page). */
export type PageElementId = "map" | "title" | "holes" | "legend" | "north" | "scale" | "credit";
export interface PageElementStyle {
  /** Its top-left corner, as shares of the page's width and height (unset: where it goes by itself;
   * for the map: how far it is moved, as shares of the page). */
  x?: number;
  y?: number;
  /** Its size, times its own. */
  scale?: number;
  /** Turned about its middle (degrees clockwise), and how solid it is (0 to 1). */
  rot?: number;
  opacity?: number;
  hidden?: boolean;
  /** Its panel's color and how solid it is (0 none, 1 solid), and its text color. */
  bg?: string;
  bgOpacity?: number;
  ink?: string;
  /** The hole guide's columns (unset: par and each layout's length). */
  columns?: ("par" | "lengths" | "elevation" | "names")[];
  /** A heading over it (the hole guide, the legend; unset: none, or LEGEND). */
  heading?: string;
  /** The title's own font (unset: the course name font). */
  font?: string;
  /** The title's par and length (unset: shown). */
  parLength?: boolean;
}
/** Text put on the course map's page. */
export interface PageText {
  id: string;
  text: string;
  /** Top-left corner, as shares of the page. */
  x: number;
  y: number;
  /** Letter size, points (on the page as printed). */
  size: number;
  color: string;
  /** The course's lettering, or any Google font by name. */
  font?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "start" | "middle" | "end";
  /** Turned about its middle (degrees clockwise), and how solid it is (0 to 1). */
  rot?: number;
  opacity?: number;
  /** A panel behind it. */
  bg?: string;
  bgOpacity?: number;
  hidden?: boolean;
}
/** A picture put on the course map's page (a logo, a sponsor's sign, a photo). */
export interface PageImage {
  id: string;
  /** The picture (a data URL). */
  src: string;
  x: number;
  y: number;
  /** Its width as a share of the page's, and its height to width. */
  w: number;
  aspect: number;
  opacity?: number;
  /** Turned about its middle, degrees clockwise. */
  rot?: number;
  hidden?: boolean;
}

export interface MapStyle {
  theme: MapTheme;
  /** The course map's page: the parts moved, sized, colored or hidden by hand. */
  page?: Partial<Record<PageElementId, PageElementStyle>>;
  texts?: PageText[];
  images?: PageImage[];
  /** Hills: how strongly the ground's relief shows on the map, times the automatic (0: flat). */
  reliefScale?: number;
  /** How the painted map draws the ground's shape when hill shading is on (unset: shaded). */
  reliefLook?: ReliefLook;
  /** Where the legend (and hole table) panel sits on the course map: its top-left corner as a
   * share of the page's width and height (unset: a free corner). */
  legendAt?: { x: number; y: number };
  /** Labels on the course map dragged on the Design page ("num:HOLE", "dist:HOLE", "name:ITEM",
   * "tag:ITEM", "text:ITEM"): moved by (dx, dy) feet on the ground, or hidden. */
  labelAt?: Record<string, { dx: number; dy: number; hidden?: boolean }>;
  /** How wide every walk to the next tee is, ft (a hole's own walk width wins; unset: 6). */
  walkWidth?: number;
  /** How tee signs look (a hole's own settings go over these). */
  sign?: SignSettings;
  /** Tee signs' and hole cards' own look (unset: dark green header, light paper, Oswald). */
  card?: { header?: string; accent?: string; paper?: string; ink?: string; font?: string };
  /** The course's logo (a small picture, as a data URL): on the scorecard. */
  logo?: string;
  /** Title block. */
  title: string;
  subtitle: string;
  /** The line under the course's name on the map and the signs (unset: "Disc golf course"; "": none). */
  tagline?: string;
  footer: string;
  /** Colors. */
  fairway: string;
  rough: string;
  /** Tall grass areas (unset: the grass color, lighter and straw yellow). */
  tallGrass?: string;
  ob: string;
  hazard: string;
  water: string;
  path: string;
  trees: string;
  basket: string;
  /** The baskets' band in 3D (unset: yellow, as most are). */
  basketBand?: string;
  /** How baskets are drawn on printed maps and tee signs. */
  basketMark: BasketMark;
  /** Colors for regulated areas: the common map habit (red OB, purple out of play) or the PDGA
   * course marking colors (white OB, red out of play). Hazards are yellow, casual areas blue, mando
   * lines and drop zones orange in both. */
  markings: "map" | "pdga";
  /** Satellite photo strength under the drawing (0..1). */
  photo: number;
  /** Contour lines and hill shading. */
  contours: boolean;
  hillshade: boolean;
  /** Throw lines, distance labels and walking arrows to the next tee. */
  throwLines: boolean;
  distances: boolean;
  nextTee: boolean;
  /** Putting circle (10 m) around each basket. */
  circle: boolean;
  legend: boolean;
  holeTable: boolean;
  north: boolean;
  scale: boolean;
  /** Lettering: "Script" sets the title in a brush script (the rest in Oswald). */
  /** The course's lettering: the app's own (Script, Oswald, Inter, Bitter) or any Google font. */
  font: string;
  /** The course's title in a font of its own (on the map and the signs; unset: `font`). */
  titleFont?: string;
  /** Forest style: where to paint woods (everywhere off the fairways, where the photo shows trees,
   * or only drawn woods and single trees). */
  forest: "everywhere" | "photo" | "woods";
  /** With measured trees: woods painted besides them (unset: only the woods drawn), where the photo
   * shows trees the survey missed or over all the open ground; never under a measured crown. */
  forestMeasured?: "everywhere" | "photo";
  /** Forest style: how thick the woods are, from a few scattered clumps (0.1) to solid canopy (1). */
  treeCover: number;
  /** The painted map's look (lib/mapLook): its style (unset: classic), and any part of it changed
   * on its own; the light: golden hour, midday or night (unset: the style's), the golden sun's
   * strength (0..1), and where the sun shines from by the compass (unset: the afternoon's). */
  mapLook?: import("./lib/mapLook").LookTheme;
  lookParts?: { [K in import("./lib/mapLook").LookPart]?: Partial<import("./lib/mapLook").LookParts[K]> };
  lightMode?: import("./lib/mapLook").LightMode;
  goldenSun?: number;
  sunFrom?: number;
  /** The 3D view's own look, apart from the printed map's (each unset: as the map has it, or for
   * the colors, the landscape's): where the sun shines from (compass degrees) and how high, how
   * dark the shadows, the leaves' color and autumn mix, the water's color. Set in the View panel's
   * Course look; the map's Light, Leaf colors and Water never move it, nor it them. */
  look3d?: { landscape?: MapStyle["landscape"]; sunFrom?: number; sunHeight?: number; shadows?: number; trees?: string; treeMix?: string[]; fairway?: string; rough?: string; path?: string; paving?: string; water?: string };
  /** How paths and roads stack where they cross, bottom first (unset: dirt, gravel and wood
   * chips, paved walkways, roads and parking): on the painted map and in 3D. */
  pathOrder?: PathTier[];
  /** How the course looks to those who only view it (shared, the public page), apart from the
   * editor's own display: the ground painted (unset) or the photo, contour lines, hill shading. */
  publicView?: { ground?: "painted" | "photo"; contours?: boolean; shading?: boolean };
  /** The tee signs' and hole pages' size: the one designed (Map) and printed (Export). */
  signSize?: "18x12" | "12x18" | "18x24" | "letter" | "a4";
  holePageSize?: "letter" | "a4" | "card" | "square";
  holePage?: HolePageSettings;
  /** The course's hole sponsors (each placed on tee signs, hole pages, the scorecard or the map). */
  sponsors?: Sponsor[];
  /** The scorecard's pieces placed by hand, and what's added to it. */
  scorecard?: { layout?: Record<string, PiecePlace>; extras?: PrintExtra[]; players?: number };
  /** Pictures, QR codes and sponsors added to the course map (its text has its own list). */
  mapExtras?: PrintExtra[];
  /** The course map's frame, even on all four sides (unset: none, the map to the paper's edge). */
  frame?: "mat" | "line" | "band";
  /** Forest style: the treetops as painted maps have them (unset), or natural ones, as the 3D
   * trees are seen from above: leaf clusters with gaps between, pines in tiers of boughs. */
  treeLook?: "classic" | "natural";
  /** What the land is like (lib/landscapes): its natural colors in 3D, and on the painted map
   * when picked. Unset: a wooded park. */
  landscape?: "woods" | "park" | "pines" | "dry" | "autumn" | "desert";
  /** The woods' leaf colors tree by tree (autumn's reds and golds; empty: one color), on the map
   * and in 3D. Unset: the landscape's. */
  treeMix?: string[];
  /** How vivid autumn's leaf colours are on the map (1: as they are; less, softer; more, brighter). */
  autumnVivid?: number;
  /** Share of the woods' trees that are pines (0..1), on the map and in 3D. Unset: the landscape's
   * (and on the painted styles, the style's own). */
  conifers?: number;
  /** Light on the painted map: where the sun comes from (degrees clockwise from the top of the
   * page) and how high it is (degrees; low sun, long shadows). */
  sunAngle: number;
  sunHeight: number;
  /** How dark the shadows are (0 none, 1 deep). */
  shadows: number;
  /** Brightness and contrast adjustments (-0.5..0.5) and color strength (0 gray .. 1.5). */
  light: number;
  contrast: number;
  colorStrength: number;
  /** Painted look: tones in crisp bands (1) or blended smoothly (0). */
  paint: number;
  /** The kinds of trees the woods and measured trees grow (lib/treeMix: oak, maple, spruce…; unset:
   * oak, ash and pine). */
  treeKinds?: string[];
  /** Turn of the map on the page, degrees (0: north up). */
  rotation: number;
  /** How big labels are (1 = normal). */
  labelScale: number;
  paper: PaperSize;
  orientation: "auto" | "portrait" | "landscape";
}

export type Units = "ft" | "m";

export interface SiteInfo {
  /** How much brush and how thick, as the import last had it (lib/undergrowth). */
  brushTune?: { much: number; thick: number };
  /** The underbrush as the import found it (its level in each 10 ft block, base64), for Restore. */
  brushFound?: { bx: number; by: number; levels: string };
  /** The searched place (the middle of the imported area). */
  location: { lat: number; lon: number; label: string } | null;
  /** Real-world edges of the plan. */
  bounds: { north: number; south: number; west: number; east: number } | null;
  /** Real elevation (ft above sea level) of terrain height 0. */
  baseElevationFt: number;
  imagerySource?: string;
  /** The photo under the map: its source ("naip", "esri", a state's), when it was taken
   * (YYYY-MM-DD, or YYYY when only the year is known; `dateTo` the last day when the site takes
   * in more than one), whether the trees were in leaf, its pixel size on the ground (m) and its
   * provider's credit (for the printed map's credits; never drawn on the photo). */
  photo?: { id: string; date?: string; dateTo?: string; season?: "leaf-on" | "leaf-off" | "mixed"; metersPerPx?: number; credit?: string };
  elevationSource?: string;
  /** Trees planted by hand that came from another course sharing this ground (by id). One of
   * them no longer among the items was cut down here: sharing the ground again leaves it out. */
  sharedTrees?: string[];
  /** What the import said it brought in, as it said it then (the Site step works out its own
   * lines from the course). */
  notes?: string[];
  /** An aerial survey (LiDAR) was looked for and none covers the site. */
  noLidar?: boolean;
  /** The aerial survey couldn't be read the last time it was asked for. */
  lidarFailed?: boolean;
  /** OpenStreetMap couldn't be reached the last time it was asked. */
  osmFailed?: boolean;
  /** Holes came in from the course mapped on OpenStreetMap (its credit goes on the map). */
  holesFromOsm?: boolean;
  /** Some of the photo's map tiles were missing. */
  tilesMissing?: boolean;
}

/** A tree measured from the air: where it stands (plan ft), how tall and how far its crown
 * spreads (ft), and 1 for a conifer. */
export type LidarTree = [x: number, y: number, height: number, radius: number, conifer: 0 | 1];

export interface CourseDoc {
  version: 1;
  /** Stable name for the course library. */
  id?: string;
  /** What the painted woods are drawn from, kept when a copy gets a new id. */
  seed?: string;
  name: string;
  designer: string;
  site: SiteInfo;
  /** Plan size, ft. */
  canvas: { width: number; height: number };
  /** Terrain grid spacing, ft; heights are keyed "x,y" at grid points. */
  gridSize: number;
  /** The site's trees measured from the air (LiDAR): `removed` ones (by index) are taken out
   * wherever they stand. With `clearFairways: true`, those on fairways, tees and baskets' circles
   * are cut down too unless `kept`; unset, they stand (cut by hand, or a hole's Clear them). */
  /** `growYears`: the measured trees grown that many years (the survey is older than today);
   * `saplings: true`: young trees grown in the gaps and edges since, too (unset: none). */
  /** `bound`: measured trees that belong to woods. They stand only while a woods area covers them:
   * a wood's edge pulled in past one, or the wood deleted, takes it out; the edge pushed back
   * out over it brings it back. (A tree becomes bound the first time a woods it stood in changes
   * shape or goes; trees out on their own never do.) */
  /** `fromPhoto`: how many of the trees, the last ones, came from the summer photo where a survey
   * flown bare couldn't pick them out (lib/summerTrees). `crownSize`: every crown this much as wide,
   * in 3D and on the map (unset: as measured). */
  lidar?: { source: string; trees: LidarTree[]; fromPhoto?: number; crownSize?: number; kept?: number[]; removed?: number[]; minHeight?: number; growYears?: number; saplings?: true; clearFairways?: true; bound?: number[] };
  /** Where trees were cut down by hand that have no list of their own: saplings grown since the
   * survey and the trees the app plants in woods and patches. None stands within 4 ft of one. */
  cutTrees?: P[];
  terrainHeights: Record<string, number>;
  /** The heights as measured, for the grid points the Ground tool has changed (so its Restore
   * brush can put them back). Bringing the site's ground in again clears it. */
  terrainOriginal?: Record<string, number>;
  /** Painted ground (lib/groundPaint): a material per painted square foot, keyed "i,j". */
  groundPaint: Record<string, number>;
  /** The aerial photo covering the plan (a data URL), or none. */
  background: string | null;
  holes: Hole[];
  items: CourseItem[];
  layouts: Layout[];
  activeLayout: string;
  style: MapStyle;
  units: Units;
  rules: CourseRules;
  /** How flyovers fly (unset: FLYOVER_DEFAULTS). */
  flyover?: Partial<FlyoverSettings>;
  /** Checks set aside (their ids: see SafetyIssue). */
  ignoredChecks?: string[];
}

/** Settings for the checks and the par estimate. */
export interface CourseRules {
  /** Clear distance wanted between one hole's throw line and other holes, roads and paths, ft.
   * Unset: the larger of 50 ft and 15% of the hole's length (the PDGA gives no number). */
  safetyGapFt?: number;
  /** Feet of length one foot of climb adds (PDGA par guidelines: 3). */
  elevationFactor: number;
  /** Price list for the parts list (US dollars). */
  prices: { basket: number; teePad: number; sign: number; bench: number; trash: number; kiosk: number; sleeve: number };
}

export type ToolMode =
  | "select"
  | "add-hole"
  | "add-tee"
  | "add-basket"
  | "add-mando"
  | "add-dropzone"
  | "add-tree"
  | "add-amenity"
  /** A field, court or play area at its usual size, with one click. */
  | "add-field"
  | "add-label"
  | "draw-area"
  | "draw-line"
  | "draw-structure"
  | "sculpt"
  | "measure";
