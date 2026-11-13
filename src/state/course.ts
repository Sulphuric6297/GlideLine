// The open course (the saved document) with undo and redo, and the editor's own state.
import { create } from "zustand";
import type { CourseDoc, CourseItem, Hole, TeeLevel, ToolMode, AreaKind, LineKind, AmenityKind, TreeKind, DrawShape, StructureKind, FieldKind, FieldPart } from "../types";
import { byNumber, createEmptyCourse, holeNumber, holeNumbers } from "../lib/course";

const HISTORY = 120;

/** Brings a document from the undo history up to date before it's put back (editing live: what
 * others changed since stays, so only your own changes are undone). */
let catchUp: (doc: CourseDoc) => CourseDoc = d => d;
export const setCatchUp = (f: (doc: CourseDoc) => CourseDoc) => { catchUp = f; };

type CourseStore = {
  doc: CourseDoc;
  past: CourseDoc[];
  future: CourseDoc[];
  /** The document before the gesture now under way (dragging), for its single undo step. */
  gestureStart: CourseDoc | null;
  /** View only (a course shared with you to look at): nothing changes it but opening another. */
  readOnly: boolean;
  /** Changes the document. With history (the default) it is one undo step. */
  change: (fn: (doc: CourseDoc) => Partial<CourseDoc>, history?: boolean) => void;
  /** Ends a gesture of live changes as one undo step. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  /** Replaces the document (open, new, shared link): no undo back into the old one. */
  load: (doc: CourseDoc) => void;
};

export const useCourse = create<CourseStore>()((set, get) => ({
  doc: createEmptyCourse(),
  past: [],
  future: [],
  gestureStart: null,
  readOnly: false,
  change: (fn, history = true) => {
    const { doc, past, gestureStart, readOnly } = get();
    if (readOnly) return;
    const next = { ...doc, ...fn(doc) };
    if (history) set({ doc: next, past: [...past.slice(-HISTORY + 1), gestureStart ?? doc], future: [], gestureStart: null });
    else set({ doc: next, gestureStart: gestureStart ?? doc });
  },
  commit: () => {
    const { gestureStart, past, doc } = get();
    if (!gestureStart) return;
    if (gestureStart === doc) { set({ gestureStart: null }); return; }
    set({ past: [...past.slice(-HISTORY + 1), gestureStart], future: [], gestureStart: null });
  },
  undo: () => {
    const { past, future, doc, gestureStart, readOnly } = get();
    if (readOnly) return;
    // (a gesture not ended yet, a color picker still open: back to where it started, one step)
    if (gestureStart && gestureStart !== doc) { set({ doc: catchUp(gestureStart), future: [doc, ...future], gestureStart: null }); return; }
    if (!past.length) return;
    set({ doc: catchUp(past[past.length - 1]), past: past.slice(0, -1), future: [doc, ...future], gestureStart: null });
  },
  redo: () => {
    const { past, future, doc, readOnly } = get();
    if (readOnly) return;
    if (!future.length) return;
    set({ doc: catchUp(future[0]), future: future.slice(1), past: [...past, doc], gestureStart: null });
  },
  load: doc => set({ doc, past: [], future: [], gestureStart: null })
}));

export const getDoc = () => useCourse.getState().doc;
export const changeDoc = (fn: (doc: CourseDoc) => Partial<CourseDoc>, history = true) => useCourse.getState().change(fn, history);

// --- Item and hole edits (each one undo step unless `history` is false) ---

export const updateItem = (id: string, patch: Partial<CourseItem>, history = true) =>
  changeDoc(d => ({ items: d.items.map(i => (i.id === id ? ({ ...i, ...patch } as CourseItem) : i)) }), history);

export const addItems = (items: CourseItem[]) => changeDoc(d => ({ items: [...d.items, ...items] }));

export const updateHole = (id: string, patch: Partial<Hole>, history = true) =>
  changeDoc(d => ({ holes: d.holes.map(h => (h.id === id ? { ...h, ...patch } : h)) }), history);

/** Removes items; removing a hole's last tee or basket keeps the hole (it shows as unfinished). */
export const removeItems = (ids: string[]) => {
  const set = new Set(ids);
  changeDoc(d => ({ items: d.items.filter(i => !set.has(i.id) || i.locked) }));
};

/** Removes a hole with its tees and baskets; mandos and drop zones on it stay, unlinked. */
export const removeHole = (holeId: string) =>
  changeDoc(d => ({
    holes: d.holes.filter(h => h.id !== holeId),
    items: d.items
      // (a basket another hole shares stays, as that hole's)
      .filter(i => !((i.type === "tee" || (i.type === "basket" && !i.alsoHoles?.length)) && i.holeId === holeId))
      .map(i => {
        if (i.type === "basket" && (i.holeId === holeId || i.alsoHoles?.includes(holeId))) {
          const holes = [i.holeId, ...(i.alsoHoles ?? [])].filter(h => h !== holeId);
          return { ...i, holeId: holes[0], alsoHoles: holes.length > 1 ? holes.slice(1) : undefined };
        }
        // (a shape shared by several holes stays theirs)
        if ("alsoHoles" in i && i.alsoHoles?.length && (i.holeId === holeId || i.alsoHoles.includes(holeId))) {
          const rest = [i.holeId, ...i.alsoHoles].filter((h): h is string => !!h && h !== holeId);
          return { ...i, holeId: rest[0], alsoHoles: rest.length > 1 ? rest.slice(1) : undefined } as CourseItem;
        }
        return "holeId" in i && i.holeId === holeId ? ({ ...i, holeId: undefined } as CourseItem) : i;
      })
  }));

/** A hole's number, typed in: every other hole keeps the number it has (they all keep them from
 * now on), and the holes go in the order of their numbers. */
export const setHoleNumber = (holeId: string, n: number, also: number[] = []) => {
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === holeId);
  const more = also.filter(v => v !== n);
  if (!hole || (holeNumber(doc, holeId) === n && (hole.alsoNumbers ?? []).join() === more.join())) return;
  changeDoc(d => {
    const nums = holeNumbers(d.holes);
    return { holes: byNumber(d.holes.map(h => (h.id === holeId ? { ...h, number: n, alsoNumbers: more.length ? more : undefined } : { ...h, number: nums.get(h.id)! }))) };
  });
};

// --- Editor state (not saved with the course) ---

/** The steps: the site, the course drawn on it (holes, features and their checks), the map's look
 * (and the signs and cards), and what goes out (downloads, the public link). */
export type Step = "site" | "design" | "map" | "export";

type EditorStore = {
  step: Step;
  tool: ToolMode;
  selectedId: string | null;
  /** Things picked together (a drag box, Shift+clicks); `selectedId` is empty while there are. */
  group: string[];
  /** A drag on the map draws a box to pick things with (instead of moving the map). */
  dragSelect: boolean;
  /** A site just fetched is being looked over in 3D before it comes in: the tools, the panels and
   * the keys stand aside (see SiteImportDialog). */
  reviewing: boolean;
  /** Measure: from one spot (each click moves the far end; the default) or along a path (each click adds a turn). */
  measureMode?: "spot" | "path";
  /** The hole whose line is being plotted by hand, point by point. */
  plotLine: string | null;
  /** The line (a road, a path...) a stretch of OB is being marked along: where it starts, then ends. */
  obPick: string | null;
  /** What that stretch is for: taken out of the line (instead of marked OB). */
  pickCut: boolean;
  /** How far measuring the trees and ground from the air has got (0..1; null: not measuring). */
  lidarBusy: number | null;
  /** Drawing a patch of drawn trees inside this woods area (its id). */
  patchFor: string | null;
  /** The Tee tool placing a new hole's tee that plays to this basket (one already there). */
  holeToBasket: string | null;
  /** The brush (the ground tool and painting areas): radius (ft), strength (1 to 10), and what it does to the ground. */
  brushSize: number;
  brushStrength: number;
  /** Painting areas: what the brush does to the areas there. */
  areaBrush: "add" | "remove" | "thinner" | "thicker" | "restore";
  /** Reshaping just this area with the brush (from its panel). */
  reshapeId: string | null;
  groundBrush: "raise" | "lower" | "flatten" | "smooth" | "restore";
  /** Drawing a section of underbrush (not of trees) for `patchFor`. */
  patchBrush: boolean;
  /** What is picked on the Design page's course map: "title", "legend"... or "text:ID", "image:ID". */
  designSel: string | null;
  /** The hole whose tee sign or hole page the Design step shows. */
  designHole: string | null;
  /** Tee sign changes go to every hole, or to the shown hole alone. */
  signScope: "all" | "hole";
  /** The checks (problems on the course) open over the map. */
  problemsOpen: boolean;
  /** The Map step's tab: what's shared by every download, or one of them (its page shown). */
  designTab: "general" | "map" | "sign" | "page" | "scorecard";
  /** The hole being worked on (its parts get handles; new tees, baskets and mandos join it). */
  activeHoleId: string | null;
  view: "2d" | "3d";
  /** Options for the tools. */
  teeLevel: TeeLevel;
  areaKind: AreaKind;
  lineKind: LineKind;
  /** What the Build tool draws: a bridge, boardwalk, stairs, wall, building, shelter or deck. */
  structureKind: StructureKind;
  /** How areas and lines are drawn (points, rectangle, circle, freehand). */
  drawShape: DrawShape;
  /** The mando tool places one post, or a gate of two (pass between them). */
  mandoKind: "single" | "gate";
  amenityKind: AmenityKind;
  /** What the Park tool puts down: a ball field, a court, a playground… */
  fieldKind: FieldKind;
  treeKind: TreeKind;
  /** The species the Trees tool plants, for each kind (unset: the course's kinds of trees). */
  treeSpecies: Partial<Record<TreeKind, string>>;
  /** The Trees tool drawing a stand of one kind (woods that grow only it, around the trees
   * measured there); null: a tree at a time, or the Woods choice's own mix. */
  standOf: TreeKind | null;
  /** Looking from a tee down its hole (the hole's id), or flying over it. */
  teeView: string | null;
  /** The tee the tee view stands on (another skill level's), unset: the layout's. */
  teeViewTee?: string | null;
  /** Tee view, editing: a press on a thing picks or drags it as on the map (else: looking). */
  teeEdit?: boolean;
  /** Standing somewhere other than the tee (the person dropped there, or walked to), on `teeView`'s
   * hole; and which way, radians on the plan (unset: down the hole). */
  teeStand?: { x: number; y: number; face?: number } | null;
  /** The map from above in the tee view's corner while editing. */
  teeMap?: "small" | "big" | "off";
  /** Standing: the hole's card at the top left put away (a small chip with its number instead). */
  teeCardHidden?: boolean;
  /** Standing, an editor's tap: walks there, or picks the thing tapped (unset: walks). */
  standTap?: "walk" | "edit";
  /** A part of the picked field (its backstop, its fence…): outlined, its own settings shown. */
  fieldPart?: FieldPart | null;
  /** The tee view's flyover settings open over it. */
  teeSettings?: boolean;
  flyover: boolean;
  /** The flyover playing, paused: held on its moment, to look at it or change it (Play goes on). */
  flyPaused: boolean;
  /** A flyover asked for at a moment (s), held there: a keyframe picked, the timeline dragged. */
  flyFrom?: number | null;
  /** Colour pickers open now: what's selected shows solid meanwhile, to judge its colours. */
  colorPicking: number;
  /** The selected hole's keyframe picked (its place in the list; null: none). */
  flyKey: number | null;
  /** Flying the camera yourself, first person, over the tee view's hole (making keyframes). */
  flyCam: boolean;
  /** A flyover still waiting for its pictures (the loading screen shows): what it waits on. */
  flyLoading: "map" | "detail" | "textures" | null;
  /** Points placed so far while drawing (for the hint). */
  drawPoints: number;
  /** Map display: the satellite photo, contour lines, hill shading, ground texture up close. */
  photo: boolean;
  contours: boolean;
  shading: boolean;
  groundDetail: boolean;
  /** 3D grass blades: automatic (off without a graphics card), off, or low to high detail. */
  grass: "auto" | 0 | 1 | 2 | 3;
  /** Grass sways in the wind (from a tee and in flyovers). */
  wind: boolean;
  /** The stumps of the measured trees cut down, everywhere (not only on the hole picked). */
  stumps: boolean;
  /** Every tree hidden, to see the photo under them (this screen only, not kept). */
  hideTrees: boolean;
  /** Underbrush tinted and outlined by how thick it is, seen through the trees. */
  brushOutlines: boolean;
  /** The ground from a tee, in flyovers and videos: the course's own ground (as Design shows it
   * with the photo off), the painted map, or the photo. (Named anew when the ground's own became
   * the usual: a course's old pick, kept on this device, was only ever the old default.) */
  flyGround: "ground" | "painted" | "photo";
  /** While a video records on the course's own ground: the photo out of the picture. */
  recordingBare: boolean;
  set: (patch: Partial<Omit<EditorStore, "set">>) => void;
};

// The View panel's This screen settings: each course's own (on this device), so a course looks
// as it was left, whatever another course was set to; a course not set yet starts from these
const DISPLAY = ["photo", "contours", "shading", "groundDetail", "grass", "wind", "flyGround"] as const;
type Display = Pick<EditorStore, (typeof DISPLAY)[number]>;
const DISPLAY_DEFAULTS: Display = { photo: true, contours: true, shading: true, groundDetail: true, grass: "auto", wind: true, flyGround: "ground" };
const displayKey = (id: string | undefined) => `dg.display:${id ?? "new"}`;
/** (one key for every course, before each had its own: the first course opened keeps it) */
const OLD_DISPLAY_KEY = "dg.display";
const savedDisplay = (id: string | undefined): Display => {
  try {
    const own = localStorage.getItem(displayKey(id));
    const old = own === null ? localStorage.getItem(OLD_DISPLAY_KEY) : null;
    if (old !== null) { localStorage.setItem(displayKey(id), old); localStorage.removeItem(OLD_DISPLAY_KEY); }
    const kept = JSON.parse(own ?? old ?? "{}") as Partial<Display>;
    return { ...DISPLAY_DEFAULTS, ...Object.fromEntries(DISPLAY.filter(k => k in kept).map(k => [k, kept[k]])) };
  } catch {
    return { ...DISPLAY_DEFAULTS };
  }
};

export const useEditor = create<EditorStore>()(set => ({
  step: "site",
  tool: "select",
  selectedId: null,
  group: [],
  dragSelect: false,
  reviewing: false,
  plotLine: null,
  obPick: null,
  pickCut: false,
  lidarBusy: null,
  patchFor: null,
  holeToBasket: null,
  brushSize: 25,
  brushStrength: 5,
  areaBrush: "add",
  reshapeId: null,
  groundBrush: "raise",
  patchBrush: false,
  designSel: null,
  signScope: "all",
  designHole: null,
  problemsOpen: false,
  designTab: "map",
  activeHoleId: null,
  view: "2d",
  teeLevel: "blue",
  areaKind: "ob",
  lineKind: "ob",
  structureKind: "bridge",
  drawShape: "points",
  mandoKind: "single",
  amenityKind: "bench",
  fieldKind: "baseball",
  treeKind: "deciduous",
  treeSpecies: {},
  standOf: null,
  teeView: null,
  flyover: false,
  flyPaused: false,
  colorPicking: 0,
  flyKey: null,
  flyCam: false,
  flyLoading: null,
  recordingBare: false,
  drawPoints: 0,
  ...DISPLAY_DEFAULTS,
  stumps: false,
  hideTrees: false,
  brushOutlines: false,
  set: patch => {
    set(patch);
    if (DISPLAY.some(k => k in patch)) {
      const s = useEditor.getState();
      try { localStorage.setItem(displayKey(useCourse.getState().doc.id), JSON.stringify(Object.fromEntries(DISPLAY.map(k => [k, s[k]])))); } catch { /* private mode */ }
    }
  }
}));

// (a course opened: its own This screen settings, and every tree shown again)
if (typeof localStorage !== "undefined") {
  let shown: string | null = null;
  const take = (id: string | undefined) => { if ((id ?? null) === shown) return; shown = id ?? null; useEditor.setState({ ...savedDisplay(id), hideTrees: false }); };
  take(useCourse.getState().doc.id);
  useCourse.subscribe(s => take(s.doc.id));
}

export const editor = () => useEditor.getState();

// Read access for the automated tests and debugging in the browser console.
if (typeof window !== "undefined") {
  (window as any).__dgCourse = () => useCourse.getState().doc;
  (window as any).__dgEditor = () => useEditor.getState();
  (window as any).__dgHistory = () => ({ past: useCourse.getState().past.length, future: useCourse.getState().future.length });
  (window as any).__dgStore = useCourse;
}

// (another hole, or back to the map: standing on its tee again, unless a spot came with it)
useEditor.subscribe((s, p) => { if (s.teeView !== p.teeView && s.teeStand && s.teeStand === p.teeStand) s.set({ teeStand: null }); });
// (another thing picked: no part of the last one)
useEditor.subscribe((s, p) => { if (s.selectedId !== p.selectedId && s.fieldPart) s.set({ fieldPart: null }); });
// (a flyover that ends, or another hole's, starts unpaused)
useEditor.subscribe((s, p) => { if (s.flyPaused && (!s.flyover || s.teeView !== p.teeView)) s.set({ flyPaused: false }); });
// (a keyframe is held selected while the flyover is paused on it: played on, stopped or another
// hole, none is, unless one was asked for just then; flying the camera keeps its own)
useEditor.subscribe((s, p) => {
  // (the camera put away: standing on the tee again, none held)
  if (p.flyCam && !s.flyCam && s.flyKey !== null && s.flyKey === p.flyKey) { s.set({ flyKey: null }); return; }
  if (s.flyKey === null || s.flyKey !== p.flyKey || s.flyCam || p.flyCam) return;
  if ((p.flyover && !s.flyover) || (s.flyover && p.flyPaused && !s.flyPaused) || s.teeView !== p.teeView) s.set({ flyKey: null });
});
