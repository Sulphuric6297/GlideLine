// What the tools and menus do to the course.
import { grownTree } from "../lib/lidar";
import { woodsCrownWidth } from "../three/treeKit";
import { CIRCLE_ONE_FT, FIELD_KINDS, PIN_POSITIONS, TEE_ORDER, generateId } from "../constants";
import { MARKED_FIELDS, createField, fieldHome, fieldKindOf, fieldOutline, isBallField } from "../lib/fields";
import {
  createAmenity, createArea, createBasket, createDropZone, createLabel, createLine, createMando, createStructure, createTee, createTree,
  insertHole, autoWalks, basketHoles, belongsTo, closestHole, holeBaskets, holeTees, itemHoleId, movedGroup, newHole, obPicked, obPieces, teeFor, wholeHoles, withoutStretch, holeLabel, fairwayShiftAt, fairwayWidthAt
} from "../lib/course";
import { centroid, nearestOnSegment, pathLength, pointAlong, simplify, smoothPath } from "../lib/geom";
import { courseStats, holeStats } from "../lib/holeStats";
import type { AreaItem, BasketItem, CourseDoc, CourseItem, FieldKind, FieldLeague, FieldPart, FieldPartSet, Hole, LineItem, LineKind, P, PinPosition, TeeLevel, ToolMode, TreeItem, TreeKind } from "../types";
import { LEAGUES, fieldPlan } from "../lib/fieldPlan";
import { orientedBox } from "../lib/structures";
import { changeDoc, editor, getDoc, removeHole, removeItems, updateHole, updateItem, useEditor, useCourse } from "./course";
import { toast } from "./toast";
import { keepsTreesOut, treeFree } from "../lib/treeFree";

/** Selects an item or a hole; selecting a hole's part makes that hole the one being worked on. */
export const select = (id: string | null, add = false) => {
  const doc = getDoc();
  if (add && id) {
    // Shift+click: into the things picked together, or out of them (a hole with its tees and baskets)
    const ed = editor();
    const now = new Set(ed.group.length ? ed.group : partsOf(ed.selectedId));
    const ids = partsOf(id);
    const all = ids.every(x => now.has(x));
    for (const x of ids) {
      if (all) now.delete(x);
      else now.add(x);
    }
    pickGroup([...now]);
    return;
  }
  const hole = doc.holes.find(h => h.id === id);
  const item = doc.items.find(i => i.id === id);
  const holeId = hole?.id ?? itemHoleId(item);
  useEditor.getState().set({ selectedId: id, group: [], ...(holeId ? { activeHoleId: holeId } : {}) });
};

/** The things a selection stands for: a hole's tees and baskets, or the item. */
const partsOf = (id: string | null) => {
  if (!id) return [];
  const doc = getDoc();
  if (doc.holes.some(h => h.id === id)) return [...holeTees(doc, id), ...holeBaskets(doc, id)].map(i => i.id);
  return doc.items.some(i => i.id === id) ? [id] : [];
};

/** Things picked together; one alone is simply selected. */
export const pickGroup = (ids: string[]) => {
  const doc = getDoc();
  const live = [...new Set(ids)].filter(id => doc.items.some(i => i.id === id));
  if (live.length <= 1) {
    select(live[0] ?? null);
    return;
  }
  useEditor.getState().set({ group: live, selectedId: null });
};

/** Most trees a drag box makes the course's own at once. */
const BOX_TREES = 400;

/** What a drag box took in, alone or (Shift) with what was picked already; the measured trees
 * and saplings inside too, made the course's own in one undo step (and given back, as a click's
 * are, if the pick is let go without a change). */
export const boxSelect = (ids: string[], add: boolean, trees: { tree: AnyTree; look: TreeLook }[] = []) => {
  const ed = editor();
  if (lookedAt) letGoUntouched();
  if (lookedAtGroup) letGroupGoUntouched();
  const before = [...(add ? (ed.group.length ? ed.group : partsOf(ed.selectedId)) : []), ...ids];
  let made: string[] = [];
  if (trees.length) {
    if (trees.length > BOX_TREES) toast(`${trees.length.toLocaleString()} trees in the box: the first ${BOX_TREES} are picked. Draw a smaller box for the rest.`, "info");
    made = adoptTrees(trees.slice(0, BOX_TREES));
  }
  pickGroup([...before, ...made]);
  if (!made.length) return;
  // (one tree alone ends up simply picked: given back as a click's is)
  const now = editor(), doc = useCourse.getState().doc;
  if (now.group.length) lookedAtGroup = { ids: made, doc };
  else if (now.selectedId && made.includes(now.selectedId)) lookedAt = { id: now.selectedId, doc };
};

/** Everything on the course that isn't locked (Ctrl+A). */
export const selectAll = () => pickGroup(getDoc().items.filter(i => !i.locked).map(i => i.id));

/** The things picked together, moved by (dx, dy) (one undo step unless `history` is false). */
export const moveGroup = (base: CourseDoc, ids: string[], dx: number, dy: number, history = true) =>
  changeDoc(() => movedGroup(base, ids, dx, dy), history);

/** The hole the new tee, basket or mando goes with: the one being worked on. */
const workingHole = (): Hole | null => {
  const doc = getDoc();
  const id = editor().activeHoleId;
  return doc.holes.find(h => h.id === id) ?? null;
};

/** The hole whose line passes close to `p` (a mando or drop zone placed beside it belongs to it),
 * else the hole being worked on. */
const holeBeside = (p: P): Hole | null => {
  const doc = getDoc();
  let best: { hole: Hole; d: number } | null = null;
  for (const hole of doc.holes) {
    const s = holeStats(doc, hole);
    if (!s.complete) continue;
    const d = Math.min(...s.line.slice(1).map((b, i) => nearestOnSegment(p, s.line[i], b).distance));
    if (d < 60 && (!best || d < best.d)) best = { hole, d };
  }
  return best?.hole ?? workingHole();
};

/** The hole line's direction where it passes `p` (degrees), which side of it `p` is, and the
 * nearest point on it (for mandos placed beside it). */
const lineAngleNear = (hole: Hole, p: P) => {
  const s = holeStats(getDoc(), hole);
  let best = { d: Infinity, angle: 0, right: false, point: p };
  for (let i = 1; i < s.line.length; i++) {
    const a = s.line[i - 1], b = s.line[i];
    const n = nearestOnSegment(p, a, b);
    // (With y pointing down, a positive cross product is to the right of a→b)
    if (n.distance < best.d) best = { d: n.distance, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, right: (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0, point: n.point };
  }
  return best;
};

/** A new hole from its tee and basket spots (added at the end; no other hole's number changes). */
export const addHole = (tee: P, basket: P, level: TeeLevel = editor().teeLevel) => {
  const hole = newHole();
  const t = createTee(hole.id, tee, level);
  // The basket spot on (or right by) a basket already there: the new hole plays to that one too
  const shared = (getDoc().items.filter(i => i.type === "basket") as BasketItem[])
    .map(b => ({ b, d: Math.hypot(b.x - basket.x, b.y - basket.y) }))
    .filter(x => x.d < 10)
    .sort((x, y) => x.d - y.d)[0]?.b;
  const b = shared ? null : createBasket(hole.id, basket, "A");
  changeDoc(d => {
    const holes = insertHole(d.holes, hole, d.holes.length);
    const items = shared ? d.items.map(i => (i.id === shared.id && i.type === "basket" ? { ...i, alsoHoles: [...(i.alsoHoles ?? []), hole.id] } : i)) : [...d.items];
    return { holes, items: [...items, t, ...(b ? [b] : [])] };
  });
  useEditor.getState().set({ selectedId: hole.id, activeHoleId: hole.id });
  return hole;
};

/** Another tee for a hole (shorter or longer, the same hole number): the Tee tool, in the first
 * color it doesn't have yet. */
export const startAnotherTee = (holeId: string) => {
  const taken = new Set(holeTees(getDoc(), holeId).map(t => t.level));
  const level = TEE_ORDER.find(l => !taken.has(l));
  if (!level) return void teesFull(holeId);
  useEditor.getState().set({ tool: "add-tee", teeLevel: level, activeHoleId: holeId, holeToBasket: null });
};
/** Whether a hole has a tee of every color, or pins A to D (no more to add). */
export const teesFull = (holeId: string, quiet = false) => {
  const taken = new Set(holeTees(getDoc(), holeId).map(t => t.level));
  const full = TEE_ORDER.every(l => taken.has(l));
  if (full && !quiet) toast(`Hole ${holeLabel(getDoc(), holeId)} has a tee of every color already.`, "info");
  return full;
};
export const pinsFull = (holeId: string, quiet = false) => {
  const taken = new Set(holeBaskets(getDoc(), holeId).map(b => b.position));
  const full = PIN_POSITIONS.every(p => taken.has(p));
  if (full && !quiet) toast(`Hole ${holeLabel(getDoc(), holeId)} has pins A to D already.`, "info");
  return full;
};
/** A new hole that finishes at a hole's basket: the Tee tool places its tee, and it's made. */
export const startHoleToBasket = (holeId: string) => {
  const basket = holeBaskets(getDoc(), holeId)[0];
  if (!basket) return;
  useEditor.getState().set({ tool: "add-tee", holeToBasket: basket.id });
};
/** Another pin position for a hole: the Pin tool. */
export const startAnotherPin = (holeId: string) => {
  if (!pinsFull(holeId)) useEditor.getState().set({ tool: "add-basket", activeHoleId: holeId, holeToBasket: null });
};

/** A click with a placing tool. */
export const placeAt = (mode: ToolMode, p: P) => {
  const ed = editor();
  // (a new hole's tee, to a basket already there: the hole is made at once)
  if (mode === "add-tee" && ed.holeToBasket) {
    const b = getDoc().items.find(i => i.id === ed.holeToBasket && i.type === "basket") as BasketItem | undefined;
    useEditor.getState().set({ holeToBasket: null });
    if (b) {
      const from = getDoc().holes.find(h => h.id === b.holeId);
      const made = addHole(p, { x: b.x, y: b.y });
      useEditor.getState().set({ tool: "select" });
      const d = getDoc();
      toast(`Hole ${holeLabel(d, made.id)} added. It plays to the same basket as hole ${from ? holeLabel(d, from.id) : ""}.`, "success", true);
      return;
    }
  }
  const hole = mode === "add-mando" || mode === "add-dropzone" ? holeBeside(p) : workingHole();
  let item: CourseItem | null = null;
  if (mode === "add-tee") {
    if (!hole) {
      toast("Pick a hole first.", "info");
      return;
    }
    if (teesFull(hole.id)) return;
    const taken = new Set(holeTees(getDoc(), hole.id).map(t => t.level));
    const level = taken.has(ed.teeLevel) ? TEE_ORDER.find(l => !taken.has(l)) ?? ed.teeLevel : ed.teeLevel;
    item = createTee(hole.id, p, level);
  } else if (mode === "add-basket") {
    if (!hole) {
      toast("Pick a hole first.", "info");
      return;
    }
    const taken = new Set(holeBaskets(getDoc(), hole.id).map(b => b.position));
    const position = PIN_POSITIONS.find(x => !taken.has(x));
    if (!position) {
      pinsFull(hole.id);
      return;
    }
    item = createBasket(hole.id, p, position);
  } else if (mode === "add-mando") {
    // Facing down the hole, with the disc passing on the side of the line: a post to the right of
    // the line is passed on its left
    const near = hole ? lineAngleNear(hole, p) : null;
    if (ed.mandoKind === "gate") {
      // A gate: two posts across the line where clicked, each passed on the inside
      const a = ((near?.angle ?? 0) * Math.PI) / 180;
      const at = near ? near.point : p;
      const half = 9;
      const right = { x: -Math.sin(a), y: Math.cos(a) };
      const l = { ...createMando({ x: at.x - right.x * half, y: at.y - right.y * half }, hole?.id, near?.angle ?? 0), side: "right" as const };
      const r = { ...createMando({ x: at.x + right.x * half, y: at.y + right.y * half }, hole?.id, near?.angle ?? 0), side: "left" as const };
      l.pairId = r.id;
      r.pairId = l.id;
      changeDoc(d => ({ items: [...d.items, l, r] }));
      select(r.id);
      return;
    }
    item = { ...createMando(p, hole?.id, near?.angle ?? 0), side: near?.right ? "left" : "right" };
  }
  else if (mode === "add-dropzone") item = createDropZone(p, hole?.id);
  else if (mode === "add-tree") {
    const kind = ed.treeKind, species = kind === "bush" ? undefined : ed.treeSpecies[kind];
    item = createTree(p, kind === "conifer" ? { treeType: kind, radius: 10, height: 50, color: "#2f5d34" } : kind === "bush" ? { treeType: kind, radius: 5, height: 6 } : { treeType: kind });
    // (the species picked in the tool bar)
    if (species) item = { ...item, species } as CourseItem;
  } else if (mode === "add-amenity") item = createAmenity(p, ed.amenityKind);
  else if (mode === "add-label") item = createLabel(p, "Label");
  else if (mode === "add-field") {
    // (at its usual size, north up; then picked, its panel open, as one drawn is)
    addField(createField(ed.fieldKind, fieldOutline(ed.fieldKind, p)));
    return;
  }
  if (!item) return;
  changeDoc(d => ({ items: [...d.items, item!] }));
  // Trees and benches go down one after another; the rest are picked to edit
  if (mode !== "add-tree") select(item.id);
  // (a label: back to Select, its panel open with its text ready to type over)
  if (mode === "add-label") {
    newLabel = item.id;
    useEditor.getState().set({ tool: "select" });
  }
};

// The label just put down, whose text field takes the focus when its panel opens
let newLabel: string | null = null;
/** Whether this label was just put down (its panel's text field takes the focus, then forgets it). */
export const isNewLabel = (id: string) => newLabel === id;
export const forgetNewLabel = () => { newLabel = null; };

/** A field put down, the trees standing in it (on a ball field or a court) gone in the same step; then picked. */
const addField = (item: AreaItem) => {
  const under = keepsTreesOut(item) ? new Set(getDoc().items.filter(i => i.type === "tree" && !i.locked && treeFree([item])(i)).map(i => i.id)) : new Set<string>();
  changeDoc(d => ({ items: [...d.items.filter(i => !under.has(i.id)), item] }));
  useEditor.getState().set({ tool: "select" });
  select(item.id);
  if (under.size) toast(`Took out ${under.size} tree${under.size === 1 ? "" : "s"} standing in it.`, "info", true);
};

/** A stand of one kind of tree drawn with the Trees tool: woods that grow only pines, only bushes
 * or only leafy trees (in the gaps between any measured there, as any wood drawn by hand). */
const standOf = (k: TreeKind): Partial<AreaItem> => ({ pines: k === "conifer" ? 1 : 0, bushes: k === "bush" ? 1 : undefined });

/** An area, line or built thing (bridge, building...) drawn with the drawing tools. */
export const addDrawn = (kind: "area" | "line" | "structure", points: P[], opts: { straight?: boolean; pick?: boolean } = {}) => {
  const ed = editor();
  // (a field by its corners: the Park tool's kind; fields are straight between their corners anyway)
  if (kind === "area" && ed.areaKind === "field") return addField(createField(ed.fieldKind, points));
  const made = kind === "area" ? createArea(ed.areaKind, points) : kind === "structure" ? createStructure(ed.structureKind, points) : createLine(ed.lineKind, points);
  const drawn = opts.straight && made.type !== "structure" ? { ...made, straight: true } : made;
  const sp = ed.standOf && ed.standOf !== "bush" ? ed.treeSpecies[ed.standOf] : undefined;
  const item = drawn.type === "area" && drawn.kind === "woods" && ed.standOf ? { ...drawn, ...standOf(ed.standOf), ...(sp ? { species: sp } : {}) } : drawn;
  // (a building, road, parking or water drawn over trees: those standing in it go, the same step)
  const under = keepsTreesOut(item) ? new Set(getDoc().items.filter(i => i.type === "tree" && !i.locked && treeFree([item])(i)).map(i => i.id)) : new Set<string>();
  changeDoc(d => ({ items: [...d.items.filter(i => !under.has(i.id)), item] }));
  // (painted: not picked, the brush still in hand)
  if (opts.pick !== false) select(item.id);
  if (under.size) toast(`Took out ${under.size} tree${under.size === 1 ? "" : "s"} standing in it.`, "info", true);
};

export const deleteSelection = () => {
  const { selectedId, group } = editor();
  if (group.length) return deleteGroup(group);
  if (!selectedId) return;
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === selectedId);
  if (hole) {
    const n = holeLabel(doc, hole.id);
    removeHole(hole.id);
    toast(`Deleted hole ${n}.`, "info", true);
  } else {
    const item = doc.items.find(i => i.id === selectedId);
    if (!item) return;
    if (item.locked) {
      toast("It's locked. Unlock it first.", "info");
      return;
    }
    removeItems([selectedId]);
    toast("Deleted.", "info", true);
  }
  useEditor.getState().set({ selectedId: null });
};

/** Deletes the things picked together in one step (whole holes among them go as holes; a basket
 * another hole still plays to stays, as that hole's). */
const deleteGroup = (group: string[]) => {
  const doc = getDoc();
  const ids = new Set(group);
  const picked = doc.items.filter(i => ids.has(i.id));
  const gone = picked.filter(i => !i.locked);
  if (!gone.length) {
    toast(picked.length ? "They're locked. Unlock them first." : "Nothing to delete.", "info");
    return;
  }
  const holeIds = new Set(wholeHoles(doc, new Set(gone.map(i => i.id))).map(h => h.id));
  changeDoc(d => ({
    holes: d.holes.filter(h => !holeIds.has(h.id)),
    items: d.items.flatMap((i): CourseItem[] => {
      if (i.type === "basket" && ids.has(i.id) && !i.locked) {
        const holes = basketHoles(i);
        const stay = holes.filter(h => !holeIds.has(h));
        if (stay.length && stay.length < holes.length) return [{ ...i, holeId: stay[0], alsoHoles: stay.length > 1 ? stay.slice(1) : undefined }];
        return [];
      }
      if (ids.has(i.id) && !i.locked) return [];
      if ("alsoHoles" in i && i.alsoHoles?.length) {
        const rest = [i.holeId, ...i.alsoHoles].filter((h): h is string => !!h && !holeIds.has(h));
        return [{ ...i, holeId: rest[0], alsoHoles: rest.length > 1 ? rest.slice(1) : undefined } as CourseItem];
      }
      return ["holeId" in i && i.holeId && holeIds.has(i.holeId) && i.type !== "tee" && i.type !== "basket" ? ({ ...i, holeId: undefined } as CourseItem) : i];
    })
  }));
  const n = holeIds.size;
  const rest = gone.filter(i => !((i.type === "tee" || i.type === "basket") && basketOrTeeHoles(i).some(h => holeIds.has(h)))).length;
  toast(`Deleted ${[n ? `${n} hole${n > 1 ? "s" : ""}` : "", rest ? `${rest} thing${rest > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")}.`, "info", true);
  useEditor.getState().set({ group: [], selectedId: null });
};

const basketOrTeeHoles = (i: CourseItem) => (i.type === "basket" ? basketHoles(i) : i.type === "tee" ? [i.holeId] : []);

/** Copies of the things picked together, a little to the side; whole holes among them copy as new
 * holes (a tee or pin on its own stays out). */
/** Things to copy: the items and the whole holes among them (a tee or pin on its own stays out,
 * as it belongs to its hole). */
type Parts = { items: CourseItem[]; holes: Hole[] };
const partsFrom = (doc: CourseDoc, ids: Set<string>): Parts => {
  const holes = wholeHoles(doc, ids);
  const whole = new Set(holes.map(h => h.id));
  const items = doc.items.filter(i => ids.has(i.id) && !((i.type === "tee" || i.type === "basket") && !basketOrTeeHoles(i).some(h => whole.has(h))));
  return { items: items.map(i => structuredClone(i)), holes: holes.map(h => structuredClone(h)) };
};

/** Copies of parts, moved by (dx, dy), with ids and holes of their own, added and picked. */
const placeParts = (parts: Parts, dx: number, dy: number) => {
  const holeMap = new Map(parts.holes.map(h => [h.id, `hole-${generateId()}`]));
  const copies: CourseItem[] = [];
  for (const i of parts.items) {
    const own = basketOrTeeHoles(i).filter(h => holeMap.has(h));
    if ((i.type === "tee" || i.type === "basket") && !own.length) continue;
    const c = { ...structuredClone(i), id: generateId(), x: i.x + dx, y: i.y + dy, locked: false } as CourseItem;
    if (c.type === "area" || c.type === "line" || c.type === "structure") c.points = c.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    if (c.type === "tee") c.holeId = holeMap.get(own[0])!;
    else if (c.type === "basket") {
      c.holeId = holeMap.get(own[0])!;
      c.alsoHoles = own.length > 1 ? own.slice(1).map(h => holeMap.get(h)!) : undefined;
    } else if ("holeId" in c && c.holeId) {
      const keep = (h: string) => holeMap.get(h) ?? (getDoc().holes.some(x => x.id === h) ? h : undefined);
      (c as { holeId?: string }).holeId = keep(c.holeId);
      if ("alsoHoles" in c && c.alsoHoles) c.alsoHoles = c.alsoHoles.map(keep).filter((h): h is string => !!h);
    }
    copies.push(c);
  }
  if (!copies.length) return false;
  const shift = (p: P) => ({ x: p.x + dx, y: p.y + dy });
  changeDoc(d => ({
    holes: parts.holes.reduce((hs, h) => insertHole(hs, { ...structuredClone(h), id: holeMap.get(h.id)!, doglegs: h.doglegs.map(shift), flyKeys: h.flyKeys?.map(k => ({ ...k, x: k.x + dx, y: k.y + dy, lookX: k.lookX + dx, lookY: k.lookY + dy })) }), d.holes),
    items: [...d.items, ...copies]
  }));
  const holeIds = [...holeMap.values()];
  if (copies.length === parts.items.length && holeIds.length === 1 && copies.every(c => (c.type === "tee" || c.type === "basket") && c.holeId === holeIds[0])) select(holeIds[0]);
  else pickGroup(copies.map(c => c.id));
  return true;
};

/** How far down and to the right copies go from what they copy (ft): the first place, `from`
 * steps of 30 ft on, where no copy already sits (duplicating twice never stacks two copies). */
const freeOffset = (items: CourseItem[], from = 1, step = 30) => {
  const key = (i: CourseItem, d: number) => `${i.type}:${Math.round(i.x + d)}:${Math.round(i.y + d)}`;
  const taken = new Set(getDoc().items.map(i => key(i, 0)));
  for (let k = from; k < from + 30; k++) if (!items.some(i => taken.has(key(i, step * k)))) return step * k;
  return step * from;
};

const duplicateGroup = (group: string[]) => {
  const parts = partsFrom(getDoc(), new Set(group));
  const d = freeOffset(parts.items);
  placeParts(parts, d, d);
};

// ------------------------------------------------------------------ copy and paste

let clipboard: (Parts & { center: P }) | null = null;

/** The selection's parts: a hole with its tees and baskets, a thing, or the things picked together. */
const selectedParts = (): Parts | null => {
  const { selectedId, group } = editor();
  const doc = getDoc();
  if (group.length) return partsFrom(doc, new Set(group));
  if (!selectedId) return null;
  const hole = doc.holes.find(h => h.id === selectedId);
  if (hole) return partsFrom(doc, new Set([...holeTees(doc, hole.id), ...holeBaskets(doc, hole.id)].map(i => i.id)));
  const item = doc.items.find(i => i.id === selectedId);
  return item ? { items: [structuredClone(item)], holes: [] } : null;
};

/** Ctrl+C: the selection, kept to paste (in this course or another). */
export const copySelection = () => {
  const parts = selectedParts();
  if (!parts || !parts.items.length) return false;
  const pts = parts.items.flatMap(i => (i.type === "area" || i.type === "line" || i.type === "structure" ? i.points : [{ x: i.x, y: i.y }]));
  const b = { minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)) };
  clipboard = { ...parts, center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } };
  return true;
};

/** Ctrl+X: copied, then deleted. */
export const cutSelection = () => {
  if (copySelection()) deleteSelection();
};

/** Ctrl+V: what was copied, next to where it was (where it was, after a cut), or at `at` ("Paste here"). */
export const pasteClipboard = (at?: P | null) => {
  if (!clipboard) return false;
  const c = clipboard;
  if (at) return placeParts(c, at.x - c.center.x, at.y - c.center.y);
  const d = freeOffset(c.items, 0);
  return placeParts(c, d, d);
};

/** Whether anything was copied. */
export const canPaste = () => !!clipboard;

/** A copy of the selection, a little to the side (a hole copies with its tees and baskets). */
export const duplicateSelection = () => {
  const { selectedId, group } = editor();
  if (group.length) return duplicateGroup(group);
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === selectedId);
  const item = hole ? null : doc.items.find(i => i.id === selectedId);
  const off = hole ? freeOffset([...holeTees(doc, hole.id), ...holeBaskets(doc, hole.id)]) : item ? freeOffset([item]) : 30;
  if (hole) {
    const copy: Hole = { ...hole, id: `hole-${generateId()}`, doglegs: hole.doglegs.map(p => ({ x: p.x + off, y: p.y + off })) };
    // (a basket it shares with other holes is copied as the copy's own)
    const parts = [...holeTees(doc, hole.id), ...holeBaskets(doc, hole.id)].map(i => ({ ...i, id: generateId(), holeId: copy.id, ...(i.type === "basket" ? { alsoHoles: undefined } : {}), x: i.x + off, y: i.y + off }) as CourseItem);
    changeDoc(d => ({ holes: insertHole(d.holes, copy, d.holes.indexOf(hole) + 1), items: [...d.items, ...parts] }));
    select(copy.id);
    return;
  }
  if (!item) return;
  const copy = { ...item, id: generateId(), x: item.x + off, y: item.y + off, locked: false } as CourseItem;
  if (copy.type === "area" || copy.type === "line" || copy.type === "structure") copy.points = copy.points.map(p => ({ x: p.x + off, y: p.y + off }));
  if (copy.type === "tee" || copy.type === "basket") {
    // Another tee or pin for the same hole (a free color or letter)
    if (copy.type === "tee") {
      const taken = new Set(holeTees(doc, copy.holeId).map(t => t.level));
      const free = TEE_ORDER.find(l => !taken.has(l));
      if (!free) return void teesFull(copy.holeId);
      copy.level = free;
    } else {
      const taken = new Set(holeBaskets(doc, copy.holeId).map(b => b.position));
      const free = PIN_POSITIONS.find(x => !taken.has(x));
      if (!free) return void pinsFull(copy.holeId);
      copy.position = free;
    }
  }
  changeDoc(d => ({ items: [...d.items, copy] }));
  select(copy.id);
};

/** Arrow presses this close together (ms) make one undo step. */
const NUDGE_MS = 600;
let nudgeEnd = 0;
/** Arrow keys: move the selection by `step` feet (a run of presses, one undo step). */
export const nudgeSelection = (dx: number, dy: number) => {
  const { selectedId, group } = editor();
  const doc = getDoc();
  if (group.length) moveGroup(doc, group, dx, dy, false);
  else {
    const item = doc.items.find(i => i.id === selectedId);
    if (!item || item.locked) return;
    const patch: Partial<CourseItem> = { x: item.x + dx, y: item.y + dy };
    if (item.type === "area" || item.type === "line" || item.type === "structure") (patch as { points: P[] }).points = item.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    changeDoc(d => ({ items: d.items.map(i => (i.id === item.id ? ({ ...i, ...patch } as CourseItem) : i)) }), false);
  }
  window.clearTimeout(nudgeEnd);
  nudgeEnd = window.setTimeout(() => useCourse.getState().commit(), NUDGE_MS);
};

/** Swaps a hole's tee to another color (or another tee to its place). */
export const setTeeLevel = (teeId: string, level: TeeLevel) => {
  const doc = getDoc();
  const tee = doc.items.find(i => i.id === teeId);
  if (!tee || tee.type !== "tee") return;
  const other = holeTees(doc, tee.holeId).find(t => t.level === level && t.id !== teeId);
  changeDoc(d => ({ items: d.items.map(i => (i.id === teeId ? { ...i, level } as CourseItem : other && i.id === other.id ? { ...i, level: tee.level } as CourseItem : i)) }));
};

/** Gives a basket another pin letter (the hole's pin with that letter takes this one's), so a
 * hole never has two pin Bs. */
export const setPinPosition = (basketId: string, position: PinPosition) => {
  const doc = getDoc();
  const b = doc.items.find(i => i.id === basketId);
  if (!b || b.type !== "basket" || b.position === position) return;
  const other = holeBaskets(doc, b.holeId).find(x => x.position === position && x.id !== basketId);
  changeDoc(d => ({ items: d.items.map(i => (i.id === basketId ? { ...i, position } as CourseItem : other && i.id === other.id ? { ...i, position: b.position } as CourseItem : i)) }));
};

/** A shape's penalty: none, OB with no red edge (water and streams, unless they're set otherwise),
 * OB with a red edge, (a line) OB and everything beyond it, or a hazard. */
export type ObChoice = "no" | "yes" | "edge" | "beyond" | "hazard";
const wetKind = (i: AreaItem | LineItem) => i.kind === "water" || i.kind === "stream";
export const obChoiceOf = (i: AreaItem | LineItem): ObChoice =>
  i.hazard === true ? "hazard" : i.ob === true ? (i.type === "line" && i.obBeyond ? "beyond" : "edge") : i.ob === false || !wetKind(i) ? "no" : "yes";
/** A shape's OB set to one of those (OB and beyond: for the hole beside it, as markObBeyond). One
 * undo step. Not OB on water is kept as such (water is OB unless it says not). */
export const setObChoice = (id: string, v: ObChoice) => {
  const item = getDoc().items.find(i => i.id === id);
  if (!item || (item.type !== "area" && item.type !== "line")) return;
  const line = item.type === "line";
  if (line && v === "beyond") { if (item.hazard) updateItem(id, { hazard: undefined } as Partial<CourseItem>, false); return markObBeyond(id); }
  updateItem(id, {
    // (a hazard is never OB: water made one is no longer OB)
    hazard: v === "hazard" ? true : undefined,
    ob: v === "edge" ? true : v === "no" || v === "hazard" ? (wetKind(item) ? false : undefined) : undefined,
    ...(line ? { obBeyond: undefined, obToward: undefined, ...(v === "edge" ? {} : { obStretches: undefined, obHoles: undefined }) } : v === "edge" ? {} : { obStretches: undefined })
  } as Partial<CourseItem>);
};

/** A line made another kind: what only the old kind had goes with it (a 22 ft road made a path is
 * a path's width; a creek's widths, a path's surface, a fence's look and height). One undo step. */
export const setLineKind = (id: string, kind: LineKind) => {
  const l = getDoc().items.find(i => i.id === id);
  if (!l || l.type !== "line" || l.kind === kind) return;
  updateItem(id, {
    kind, width: undefined,
    ...(kind === "stream" ? {} : { widths: undefined }),
    ...(kind === "path" || kind === "walk" ? {} : { surface: undefined }),
    // (a fence's, a hedge's or a power line's height starts at the new kind's usual)
    fenceHeight: undefined,
    ...(kind === "fence" ? {} : { fenceStyle: undefined })
  } as Partial<CourseItem>);
};

/** A field in play or out of play. One undo step. */
export const setFieldPlay = (id: string, out: boolean) => {
  const a = getDoc().items.find(i => i.id === id);
  if (a?.type === "area" && a.kind === "field") updateItem(id, { outOfPlay: out ? true : undefined } as Partial<CourseItem>);
};

/** A field made another kind: what only the old kind had goes (a ball field's home plate, the
 * markings' turn), and in or out of play goes with the new kind's usual, unless it had been set
 * the other way by hand (a playground made a ball field is in play). One undo step. */
export const setFieldKind = (id: string, kind: FieldKind) => {
  const a = getDoc().items.find(i => i.id === id);
  if (!a || a.type !== "area" || a.kind !== "field" || fieldKindOf(a) === kind) return;
  const usual = !!a.outOfPlay === !!FIELD_KINDS[fieldKindOf(a)].outOfPlay;
  updateItem(id, {
    field: kind,
    outOfPlay: usual ? (FIELD_KINDS[kind].outOfPlay ? true : undefined) : a.outOfPlay,
    ...(isBallField(kind) ? {} : { home: undefined, plate: undefined }),
    ...(MARKED_FIELDS.includes(kind) ? {} : { fieldTurn: undefined })
  } as Partial<CourseItem>);
};

/** A ball field set to a league's size: its outline grown or shrunk about home plate so the fence
 * stands as far out as that league's (and the backstop behind home has room). */
export const setFieldLeague = (id: string, league: FieldLeague) => {
  const a = getDoc().items.find(i => i.id === id);
  if (!a || a.type !== "area" || a.kind !== "field" || !isBallField(fieldKindOf(a))) return;
  // (about the plate where it was placed by hand, which stays put)
  const home = (a.plate && fieldPlan(a)?.home) || a.points[fieldHome(a)];
  const reach = Math.max(...a.points.map(p => Math.hypot(p.x - home.x, p.y - home.y)));
  const L = LEAGUES[league];
  const k = (L.fence + L.backstop + 2) / Math.max(1, reach);
  const points = a.points.map(p => ({ x: home.x + (p.x - home.x) * k, y: home.y + (p.y - home.y) * k }));
  const c = centroid(points);
  updateItem(id, { league, points, x: c.x, y: c.y, ...(a.plate ? { plate: { x: a.plate.x * k, y: a.plate.y * k } } : {}) } as Partial<CourseItem>);
};

/** Courts in a row, `n` of them: the outline made that many courts (with their run-off) side by
 * side, round its middle, the courts' length kept the way it runs. */
export const setCourtCount = (id: string, n: number) => {
  const a = getDoc().items.find(i => i.id === id);
  if (!a || a.type !== "area" || a.kind !== "field") return;
  const [cl, cw] = FIELD_KINDS[fieldKindOf(a)].size;
  const box = orientedBox(a.points);
  // (the courts' length: along the outline's long side when one court is longer than the row is wide)
  const lenDir = box.a * 2 >= cl * 0.8 && box.b * 2 < cl * 0.8 ? box.u : box.v;
  const side = { x: -lenDir.y, y: lenDir.x }, hl = cl / 2, hw = (n * cw) / 2;
  const at = (s: number, t: number) => ({ x: box.c.x + lenDir.x * s + side.x * t, y: box.c.y + lenDir.y * s + side.y * t });
  const points = [at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)];
  updateItem(id, { points, x: box.c.x, y: box.c.y, fieldTurn: undefined } as Partial<CourseItem>);
};

/** One part of a field set: switched off or on, its height, how far it stands. */
export const setFieldPart = (id: string, part: FieldPart, patch: FieldPartSet, history = true) => {
  const a = getDoc().items.find(i => i.id === id);
  if (!a || a.type !== "area" || a.kind !== "field") return;
  const now = { ...a.parts?.[part], ...patch };
  for (const k of Object.keys(now) as (keyof FieldPartSet)[]) if (now[k] === undefined || now[k] === false) delete now[k];
  const parts = { ...a.parts, [part]: now };
  if (!Object.keys(now).length) delete parts[part];
  updateItem(id, { parts: Object.keys(parts).length ? parts : undefined } as Partial<CourseItem>, history);
};

/** A ball field's home plate moved on to its outline's next corner (one placed by hand: back to
 * its own corner first). */
export const nextHomeCorner = (id: string) => {
  const a = getDoc().items.find(i => i.id === id);
  if (!a || a.type !== "area" || a.points.length < 3) return;
  updateItem(id, { home: a.plate ? fieldHome(a) : (fieldHome(a) + 1) % a.points.length, plate: undefined } as Partial<CourseItem>);
};

/** A turn put in a hole's line at a spot (between the turns either side of where it's nearest). */
export const bendHoleAt = (holeId: string, p: P) => {
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return;
  const s = holeStats(doc, hole);
  if (!s.complete || s.line.length < 2) return;
  let at = 0, best = Infinity;
  for (let i = 1; i < s.line.length; i++) {
    const d = nearestOnSegment(p, s.line[i - 1], s.line[i]).distance;
    if (d < best) { best = d; at = i - 1; }
  }
  const doglegs = [...hole.doglegs];
  doglegs.splice(at, 0, { x: p.x, y: p.y });
  changeDoc(d => ({ holes: d.holes.map(h => (h.id === holeId ? { ...h, doglegs } : h)) }));
};

/** The layout worked on: its tees and pins to the fore, new tees in its color. */
export const pickLayout = (id: string) => {
  const layout = getDoc().layouts.find(l => l.id === id);
  if (!layout) return;
  changeDoc(() => ({ activeLayout: id }));
  useEditor.getState().set({ teeLevel: layout.tee });
};

/** A tee of a color put on every finished hole that has none: back from the tee it plays now for
 * a longer color (gold behind blue), ahead for a shorter one, 50 ft a step, along the line. One
 * undo step; how many were added. */
export const addLayoutTees = (level: TeeLevel) => {
  const doc = getDoc();
  const made: CourseItem[] = [];
  for (const hole of doc.holes) {
    const tees = holeTees(doc, hole.id);
    if (!tees.length || tees.some(t => t.level === level)) continue;
    const s = holeStats(doc, hole);
    if (!s.complete || s.line.length < 2) continue;
    const from = tees.find(t => t.id === s.teeId) ?? tees[0];
    const next = s.line[1];
    const len = Math.hypot(next.x - from.x, next.y - from.y) || 1;
    const steps = TEE_ORDER.indexOf(from.level) - TEE_ORDER.indexOf(level);
    // (never past the first turn or the basket: at most most of the way there)
    const d = Math.max(-len * 0.6, Math.min(steps * 50, 400));
    made.push(createTee(hole.id, { x: from.x - ((next.x - from.x) / len) * d, y: from.y - ((next.y - from.y) / len) * d }, level));
  }
  if (made.length) changeDoc(d => ({ items: [...d.items, ...made] }));
  return made.length;
};

/** The tee a hole is played from in the current layout. */
export const layoutTee = (holeId: string) => {
  const doc = getDoc();
  const layout = doc.layouts.find(l => l.id === doc.activeLayout);
  return teeFor(doc, holeId, layout?.tee);
};

/** Recomputes an area's middle after its points changed (kept in step for labels and picking). */
export const withCentroid = <T extends { points: P[] }>(item: T): T & P => ({ ...item, ...centroid(item.points) });

// For the automated tests and screenshots: build a course quickly without clicking every spot.
if (typeof window !== "undefined") (window as any).__dgActions = { addHole, addDrawn, placeAt, select, pickGroup, updateItem, hole: updateHole, style: (patch: Partial<CourseDoc["style"]>) => changeDoc(d => ({ style: { ...d.style, ...patch } })), site: (patch: Partial<CourseDoc["site"]>) => changeDoc(d => ({ site: { ...d.site, ...patch } })), lidar: (patch: Partial<NonNullable<CourseDoc["lidar"]>>) => changeDoc(d => (d.lidar ? { lidar: { ...d.lidar, ...patch } } : {})), flyover: (patch: Partial<NonNullable<CourseDoc["flyover"]>>) => changeDoc(d => ({ flyover: { ...d.flyover, ...patch } as CourseDoc["flyover"] })) };

/**
 * An OB line for a hole, ready to fine-tune with its handles: along the left or right of the
 * fairway (a little outside its edge, from near the tee to past the basket), or "long": an arc
 * behind the basket.
 */
export const addHoleOb = (holeId: string, where: "left" | "right" | "long") => {
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return;
  const st = holeStats(doc, hole);
  if (!st.complete) return;
  const path = smoothPath(st.line, 10);
  const len = pathLength(path);
  const end = pointAlong(path, len);
  let pts: P[];
  if (where === "long") {
    const r = CIRCLE_ONE_FT + 12;
    pts = Array.from({ length: 11 }, (_, i) => {
      const a = end.angle + ((-75 + i * 15) * Math.PI) / 180;
      return { x: end.point.x + Math.cos(a) * r, y: end.point.y + Math.sin(a) * r };
    });
  } else {
    // (With y pointing down, the right of the direction of play is the direction turned +90°)
    const sign = where === "right" ? 1 : -1;
    // (12 ft outside the fairway's edge on that side, as wide and as far off the line as it is there)
    const width = fairwayWidthAt(hole), shift = fairwayShiftAt(hole);
    const along: P[] = [];
    for (let d = Math.min(25, len * 0.15); d <= len + 30; d += 12) {
      const at = d <= len ? pointAlong(path, d) : { point: { x: end.point.x + Math.cos(end.angle) * (d - len), y: end.point.y + Math.sin(end.angle) * (d - len) }, angle: end.angle };
      const t = Math.min(1, d / len);
      const off = shift(t) + sign * (width(t) / 2 + 12);
      along.push({ x: at.point.x - Math.sin(at.angle) * off, y: at.point.y + Math.cos(at.angle) * off });
    }
    pts = simplify(along, 2.5);
  }
  const item = { ...createLine("ob", pts), holeId };
  changeDoc(d => ({ items: [...d.items, item] }));
  select(item.id);
  toast(`OB line added ${where === "long" ? "behind the basket" : `along the ${where}`} of hole ${holeLabel(doc, hole.id)}.`, "success", true);
};

/** The walk from a hole's basket to the next hole's tee as a line of its own (points along the way
 * to pull), in place of the automatic one; `holeId` null for every hole's. Selected when one. */
export const editWalks = (holeId: string | null) => {
  const doc = getDoc();
  const stats = courseStats(doc);
  const lines = autoWalks(doc.items, stats, doc.holes)
    .filter(w => holeId === null || w.a.holeId === holeId)
    .map(({ from, to, a }) => {
      const line = createLine("walk", [0, 1 / 3, 2 / 3, 1].map(t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })));
      // (as wide and of what it was, on its own)
      const hole = doc.holes.find(h => h.id === a.holeId);
      const wide = hole?.walkWidth ?? doc.style.walkWidth;
      return { ...line, ...(wide ? { width: wide } : {}), ...(hole?.walkSurface ? { surface: hole.walkSurface } : {}) };
    });
  if (!lines.length) return [];
  changeDoc(d => ({ items: [...d.items, ...lines] }));
  if (lines.length === 1) select(lines[0].id);
  return lines;
};

/** A hole played to another hole's basket (its own baskets go), or to a basket of its own again
 * (set down a little short of the shared one, to drag where it belongs). */
export const shareBasket = (holeId: string, withHoleId: string | null) => {
  const doc = getDoc();
  const target = withHoleId ? holeBaskets(doc, withHoleId).find(b => b.holeId === withHoleId) ?? holeBaskets(doc, withHoleId)[0] : null;
  const current = holeBaskets(doc, holeId);
  if (withHoleId && !target) return;
  changeDoc(d => {
    let items = d.items.filter(i => !(i.type === "basket" && i.holeId === holeId && !i.alsoHoles?.length));
    items = items.map(i => {
      if (i.type !== "basket") return i;
      // Off any basket it shared before (or handing its own one on to the holes that share it)
      let holes = [i.holeId, ...(i.alsoHoles ?? [])].filter(h => h !== holeId);
      if (target && i.id === target.id) holes = [...holes, holeId];
      if (!holes.length) return i;
      return { ...i, holeId: holes[0], alsoHoles: holes.length > 1 ? holes.slice(1) : undefined };
    });
    if (!withHoleId) {
      const from = current[0];
      const tee = holeTees(d, holeId)[0];
      const spot = from && tee ? { x: from.x + (tee.x - from.x) * (25 / Math.max(25, Math.hypot(tee.x - from.x, tee.y - from.y))), y: from.y + (tee.y - from.y) * (25 / Math.max(25, Math.hypot(tee.x - from.x, tee.y - from.y))) } : from ?? { x: 0, y: 0 };
      items = [...items, createBasket(holeId, spot, "A")];
    }
    return { items };
  });
};

/** A road, path, fence or creek made OB and beyond it too: for the hole running closest along it,
 * unless holes were picked for it. */
export const markObBeyond = (id: string) => {
  const d = getDoc();
  const l = d.items.find(i => i.id === id);
  if (!l || l.type !== "line") return;
  const piece = obPieces(l)[0];
  const holes = courseStats(d).filter(st => st.complete && (!l.holeId || belongsTo(l, st.holeId))).map(st => ({ id: st.holeId, line: st.line }));
  const near = !obPicked(d, l).length && piece ? closestHole(piece, holes) : null;
  updateItem(id, { ob: true, obBeyond: true, ...(near ? { obHoles: [near] } : {}) } as Partial<CourseItem>);
};

/** A stretch taken out of a line (fractions of it as drawn): what is left either side stays (two
 * lines where it was cut in the middle), the first still picked. One undo step. */
export const cutStretch = (id: string, a: number, b: number) => {
  const l = getDoc().items.find(i => i.id === id);
  if (!l || l.type !== "line" || l.locked) return;
  const parts = withoutStretch(l, a, b);
  changeDoc(d => ({ items: d.items.flatMap(i => (i.id === id ? parts : [i])) }));
  select(parts[0]?.id ?? null);
};

/** An outline drawn as a patch of a woods area (trees: custom): drawn trees fill it in, as
 * thickly as the wood's last patch (half, for the first). One undo step; the wood stays selected. */
/** An outline drawn as a section of underbrush in a wood (its own level; the last one's, or
 * heavy for the first). One undo step; the wood stays selected. */
export const addBrushSection = (areaId: string, points: P[]) => {
  if (!getDoc().items.some(i => i.id === areaId && i.type === "area")) { toast("That area is gone: draw the section again on another.", "info"); return; }
  changeDoc(d => ({ items: d.items.map(i => (i.id === areaId && i.type === "area" ? { ...i, brush: [...(i.brush ?? []), { points, level: i.brush?.[i.brush.length - 1]?.level ?? "heavy" }] } : i)) }));
  select(areaId);
};

export const addPatch = (areaId: string, points: P[]) => {
  if (!getDoc().items.some(i => i.id === areaId && i.type === "area")) { toast("That wood is gone: draw the patch again on another.", "info"); return; }
  changeDoc(d => ({ items: d.items.map(i => (i.id === areaId && i.type === "area" ? { ...i, trees: "custom" as const, patches: [...(i.patches ?? []), { points, fill: i.patches?.[i.patches.length - 1]?.fill ?? 0.5 }] } : i)) }));
  select(areaId);
};

type TreeLook = { variant: number; rotation: number; leaf: string } | null;

/** A tree of the woods as the course's own, as big as the woods drew it (they keep a crown to a
 * natural width; a tree of the course's own is drawn just as wide as it says). */
const asDrawn = (made: TreeItem, look: TreeLook): TreeItem => {
  const shape = made.treeType === "conifer" ? "conifer" : made.treeType === "bush" ? "bush" : "broadleaf";
  const w = woodsCrownWidth(shape, look?.variant ?? 0, made.height ?? 30, made.radius * 2);
  const out = { ...made, radius: Math.max(1, Math.round((w / 2) * 10) / 10) };
  return look ? { ...out, variant: look.variant, rotation: look.rotation, leaf: look.leaf } : out;
};

/** Trees made the course's own at once (see adoptTree), one undo step: their new ids. */
const adoptTrees = (list: { tree: AnyTree; look: TreeLook }[]) => {
  const doc = getDoc();
  const removed = new Set(doc.lidar?.removed ?? []), cut: P[] = [];
  const items: TreeItem[] = [];
  for (const { tree, look } of list) {
    let made: TreeItem;
    if (tree.kind === "measured") {
      const t = doc.lidar?.trees[tree.k];
      if (!doc.lidar || !t || removed.has(tree.k)) continue;
      const [x, y, h, r, conifer] = grownTree(t, doc.lidar.growYears ?? 0);
      made = createTree({ x, y }, { height: Math.round(h), radius: Math.round(r), treeType: conifer ? "conifer" : "deciduous" });
      removed.add(tree.k);
    } else {
      made = createTree({ x: tree.x, y: tree.y }, { height: Math.round(tree.height), radius: Math.round(tree.width / 2), treeType: tree.conifer ? "conifer" : "deciduous" });
      cut.push({ x: tree.x, y: tree.y });
    }
    items.push(asDrawn(made, look));
  }
  if (!items.length) return [];
  const taken = new Set(list.flatMap(({ tree }) => (tree.kind === "measured" ? [tree.k] : [])));
  changeDoc(d => ({
    ...(d.lidar ? { lidar: { ...d.lidar, removed: [...removed].sort((a, b) => a - b), kept: (d.lidar.kept ?? []).filter(i => !taken.has(i)) } } : {}),
    ...(cut.length ? { cutTrees: [...(d.cutTrees ?? []), ...cut] } : {}),
    items: [...d.items, ...items]
  }));
  return items.map(i => i.id);
};

// Trees a drag box made the course's own: let go without a change, that's undone
let lookedAtGroup: { ids: string[]; doc: CourseDoc } | null = null;
const letGroupGoUntouched = () => {
  const l = lookedAtGroup;
  lookedAtGroup = null;
  if (l && useCourse.getState().doc === l.doc) useCourse.getState().undo();
};
if (typeof window !== "undefined") {
  useEditor.subscribe(s => { if (lookedAtGroup && !lookedAtGroup.ids.every(id => s.group.includes(id))) letGroupGoUntouched(); });
}
type AnyTree = { kind: "measured"; k: number } | { kind: "spot"; x: number; y: number; height: number; width: number; conifer: boolean };

// A tree made the course's own by a click only (to look at it, or change it): when it's let go
// without a change, that's undone, so looking at a tree isn't an edit
let lookedAt: { id: string; doc: CourseDoc } | null = null;
const letGoUntouched = () => {
  const l = lookedAt;
  lookedAt = null;
  if (l && useCourse.getState().doc === l.doc) useCourse.getState().undo();
};
if (typeof window !== "undefined") {
  useEditor.subscribe((s, prev) => { if (lookedAt && prev.selectedId === lookedAt.id && s.selectedId !== lookedAt.id) letGoUntouched(); });
}

/** Any tree that isn't an item of its own (measured, a sapling grown since the survey, planted in
 * a wood or a patch) made the course's own: a tree item where it stands, as tall and wide, its
 * shape and leaf color as they were, picked to move and set like any other. Where it stood is
 * cut (a measured one taken out, a planted one's spot kept clear). One undo step. */
export const adoptTree = (tree: AnyTree, look: TreeLook = null, quiet = true) => {
  if (lookedAt) letGoUntouched();
  const doc = getDoc();
  let made: TreeItem | null = null, patch: Partial<CourseDoc> = {};
  if (tree.kind === "measured") {
    const t = doc.lidar?.trees[tree.k];
    if (!doc.lidar || !t) return;
    const [x, y, h, r, conifer] = grownTree(t, doc.lidar.growYears ?? 0);
    made = createTree({ x, y }, { height: Math.round(h), radius: Math.round(r), treeType: conifer ? "conifer" : "deciduous" });
    const k = tree.k;
    patch = { lidar: { ...doc.lidar, removed: [...new Set([...(doc.lidar.removed ?? []), k])].sort((a, b) => a - b), kept: (doc.lidar.kept ?? []).filter(i => i !== k) } };
  } else {
    made = createTree({ x: tree.x, y: tree.y }, { height: Math.round(tree.height), radius: Math.round(tree.width / 2), treeType: tree.conifer ? "conifer" : "deciduous" });
    patch = { cutTrees: [...(doc.cutTrees ?? []), { x: tree.x, y: tree.y }] };
  }
  const item: TreeItem = asDrawn(made, look);
  changeDoc(d => ({ ...patch, items: [...d.items, item] }));
  select(item.id);
  if (quiet) lookedAt = { id: item.id, doc: useCourse.getState().doc };
  return item.id;
};

/** A measured tree made the course's own (see adoptTree). */
export const adoptLidarTree = (k: number, look: TreeLook = null) => adoptTree({ kind: "measured", k }, look, false);

/** A sapling or planted tree cut down by hand: nothing stands there from now on. One undo step. */
export const cutTreeAt = (p: P) => {
  changeDoc(d => ({ cutTrees: [...(d.cutTrees ?? []), { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }] }));
  toast("Tree cut down.", "success", true);
};

/** A sapling or planted tree made the course's own (see adoptTree). */
export const adoptTreeAt = (spot: { x: number; y: number; height: number; width: number; conifer: boolean }, look: TreeLook = null) => adoptTree({ kind: "spot", ...spot }, look, false);

/** The trees cut down by hand (saplings, planted ones) all back. */
export const uncutTrees = () => changeDoc(() => ({ cutTrees: undefined }));
