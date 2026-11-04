import type { FieldKind, AreaKind, CourseDoc, CourseItem, LineKind, P, ToolMode, DrawShape, StructureKind, TreeKind, FieldPart } from "../types";
import type { HoleStats, SafetyIssue } from "../lib/holeStats";

export type { P };
export type Rect = { x: number; y: number; width: number; height: number };
export type ContourSegment = { x1: number; y1: number; x2: number; y2: number; level: number };

/** What the ground layer draws. Plan units are feet; plan (x, y) is 3D (x, z), Y up. */
export type GroundDoc = {
  canvas: { width: number; height: number };
  unitsPerFoot: number;
  gridSize: number;
  showGrid: boolean;
  heights: Record<string, number>;
  terrain: { min: number; max: number; relief: number };
  background: { url: string | null; rect: Rect; opacity: number };
  overlay: "off" | "contours" | "shaded";
  contours: { segments: ContourSegment[]; interval: number };
  shadeUrl: string | null;
  /** Real-scale grass, paving and soil texture over the aerial photo, where the photo shows them. */
  groundDetail: boolean;
  groundPaint: Record<string, number>;
  /** Color of the ground where there is no photo (the map theme's rough). */
  groundColor: string;
};

/** Everything the map view draws. */
export type ViewDoc = GroundDoc & {
  course: CourseDoc;
  /** Numbers for each hole in the active layout (lengths, the throw line used). */
  stats: HoleStats[];
  /** The hole being edited: its doglegs and fairway width get handles. */
  activeHoleId: string | null;
  /** Problems to pin on the map (Review step), or none. */
  issues: SafetyIssue[] | null;
  /** The course's sun (its light settings): compass direction it shines from, height above the
   * horizon (degrees), how dark the shadows are (0..1) and the overall brightness (-0.3..0.3). */
  sun: { azimuth: number; altitude: number; shadows?: number; light?: number } | null;
};

/** The active tool, as far as the map view cares. */
export type ViewTool = {
  mode: ToolMode;
  areaKind: AreaKind;
  lineKind: LineKind;
  /** What the Build tool draws (along a line, or an outline). */
  structureKind?: StructureKind;
  /** What the Park tool puts down with a click. */
  fieldKind?: FieldKind;
  /** How areas and lines are drawn. */
  shape: DrawShape;
  /** Select: a drag on the map draws a box to pick things with (instead of moving the map). */
  dragSelect?: boolean;
  /** What the Tree tool plants (its preview is one). */
  treeKind?: TreeKind;
  /** The brush (the ground tool, and painting areas): its radius (ft), how strong, what it does to the ground. */
  brush?: { size: number; strength: number; ground: "raise" | "lower" | "flatten" | "smooth" | "restore" };
  /** A stand of this kind of tree drawn as woods (a stand of bushes: underbrush). */
  standOf?: string | null;
  /** Painting areas: what the brush does (add, remove, a level thinner or thicker, back as found). */
  areaBrush?: "add" | "remove" | "thinner" | "thicker" | "restore";
  /** Painting just this area (Reshape with the brush, from its panel). */
  reshape?: string | null;
};

export type ViewInfo = {
  /** Compass heading of the top of the screen, degrees clockwise from north. */
  heading: number;
  /** 0 = looking straight down. */
  tiltDeg: number;
  /** On-screen pixels per foot at the center of the view. */
  pxPerUnit: number;
  width: number;
  height: number;
};

/** You, on the map (the phone's GPS): where, how sure (ft), which way you face (degrees from
 * north), greyed when old or weak; `tag`: words under the dot; `to`: a dashed line to there. */
export type LocationMark = { at: P; acc: number; facing: number | null; dim: boolean; tag: string; to: P | null };

export type ViewCallbacks = {
  /** The ground painted with the ground tool: all its heights (live while painting; `done` once let go). */
  onTerrain?: (heights: Record<string, number>, done: boolean, original?: Record<string, number>) => void;
  /** The areas as a brush stroke leaves them, live as it goes (`done`: let go, one undo step). */
  onAreas?: (items: CourseItem[], done: boolean) => void;
  /** A thing picked (or nothing); `add`: Shift+click, into or out of the things picked together. */
  onSelect: (id: string | null, add?: boolean) => void;
  /** A tree that isn't an item (measured, a sapling, planted in a wood) clicked: made the course's
   * own and picked, looking as it did. */
  onAdoptTree: (tree: { kind: "measured"; k: number } | { kind: "spot"; x: number; y: number; height: number; width: number; conifer: boolean }, look: { variant: number; rotation: number; leaf: string } | null) => void;
  /** What a drag box took in; `add`: with what was picked already. */
  /** `trees`: the trees inside that aren't items yet (measured ones, saplings), with their looks. */
  onBoxSelect: (ids: string[], add: boolean, trees?: { tree: { kind: "measured"; k: number } | { kind: "spot"; x: number; y: number; height: number; width: number; conifer: boolean }; look: { variant: number; rotation: number; leaf: string } | null }[]) => void;
  /** Live: the things picked together moved by (dx, dy) from where they were in `base`. */
  onMoveGroup: (base: CourseDoc, ids: string[], dx: number, dy: number) => void;
  /** A click with a placing tool (tee, basket, mando, drop zone, tree, amenity, label). */
  onPlace: (mode: ToolMode, p: P) => void;
  /** A new hole: where its tee and basket go. */
  onHole: (tee: P, basket: P) => void;
  /** An area, line or built thing finished drawing. */
  onDrawn: (kind: "area" | "line" | "structure", points: P[], opts?: { straight?: boolean }) => void;
  /** Live edits while dragging (no undo step); onCommit ends the gesture. */
  onChange: (id: string, patch: Record<string, unknown>) => void;
  /** Live edits to a hole (doglegs, fairway width). */
  onHoleChange: (holeId: string, patch: Record<string, unknown>) => void;
  onCommit: () => void;
  onHover: (p: P | null) => void;
  /** Standing in the 3D view, a walk ended there (and faces this way: radians on the plan). */
  onStand?: (p: { x: number; y: number; face: number }) => void;
  /** A click on the picked field: the part of it there (null: none, the field as a whole). */
  onFieldPart?: (part: FieldPart | null) => void;
  onPose: (pose: "top" | "tilt") => void;
  /** Tee view: moved to another hole with the arrow keys, or closed. */
  onTeeView: (holeId: string | null) => void;
  /** `under`: an area or line under a tree that was clicked (to select it from the tree's menu). */
  onContextMenu: (info: { clientX: number; clientY: number; itemId: string | null; ground: P | null; under?: string | null }) => void;
  onDrawProgress: (points: number) => void;
  /** Plotting a hole's line by hand ended (finished or cancelled). */
  onPlotEnd: () => void;
  /** Marking a stretch of OB along a line ended (marked or cancelled). */
  onObPickEnd: () => void;
  /** A stretch of a line to take out (fractions of it as drawn). */
  onCutLine: (id: string, a: number, b: number) => void;
  /** Trees measured from the air kept standing where they'd be cleared, or taken out (one undo step). */
  onLidar: (patch: { kept?: number[]; removed?: number[] }) => void;
  /** A flyover waiting for everything to be drawn (what it waits on), then flying (null). */
  onFlyWait: (waiting: "map" | "detail" | "textures" | null) => void;
  /** A keyframe of the selected hole's flyover picked on the map (its place in the list). */
  onFlyKey?: (index: number) => void;
  /** Asked to look through a keyframe's camera (double-clicked on the map). */
  onFlyCam?: (index: number) => void;
};
