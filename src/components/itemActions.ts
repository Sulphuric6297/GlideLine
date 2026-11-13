// The map's menu for a hole or a thing on it, and for open ground (a right-click on a computer, a
// finger held on a phone): one list, so both menus offer the same rows in the same words.
import { ClipboardPaste, Copy, Eye, ListChecks, Lock, Maximize2, MessageSquarePlus, Plane, Ruler, Trash2, Unlock, type LucideIcon } from "lucide-react";
import { SERVER } from "../auth/api";
import { startComment } from "../auth/Comments";
import { useServerCourse } from "../auth/courses";
import { AREA_KINDS, LINE_KINDS, STRUCTURE_KINDS } from "../constants";
import { holeLabel, amenityPlural } from "../lib/course";
import { holeStats } from "../lib/holeStats";
import { bendHoleAt, canPaste, copySelection, deleteSelection, duplicateSelection, markObBeyond, pasteClipboard, pickGroup, placeAt, select, setFieldPlay, setObChoice } from "../state/actions";
import { GROUPS, SOURCES, sourceOf } from "../lib/importReview";
import { changeDoc, getDoc, updateItem, useCourse, useEditor } from "../state/course";
import { toast } from "../state/toast";
import { getView } from "../state/view";
import type { CourseItem, P } from "../types";
import { itemTitle } from "./Inspector";

/** One row of the menu (`icon`: on a phone's sheet). */
export type ItemAction = { label: string; run: () => void; testid?: string; icon?: LucideIcon; danger?: boolean };

/** A comment's row (on a GlideLine Studio server, a course saved there): on this spot, or on this thing. */
const commentRow = (label: string, p: P | null, on?: { kind: "hole" | "item"; id: string; x?: number; y?: number }): ItemAction[] =>
  SERVER && useServerCourse.getState().id && p ? [{ label, icon: MessageSquarePlus, run: () => startComment({ p, on }), testid: "menu-comment" }] : [];

/** A thing named by its kind, for a menu row: "the bridge", "the woods", "the OB line". */
export const kindName = (item: CourseItem) => {
  const s = item.type === "area" ? (item.kind === "field" ? itemTitle(item) : AREA_KINDS[item.kind].label) : item.type === "line" ? LINE_KINDS[item.kind].label : item.type === "structure" ? STRUCTURE_KINDS[item.kind].label : itemTitle(item);
  return /^[A-Z]{2}/.test(s) ? s : s[0].toLowerCase() + s.slice(1);
};

/** The things picked together: copy, duplicate, lock and delete them all (one undo step each). */
export const groupActions = (): ItemAction[] => {
  const group = useEditor.getState().group;
  const n = group.length;
  const items = getDoc().items.filter(i => group.includes(i.id));
  const locked = items.length > 0 && items.every(i => i.locked);
  const lock = (on: boolean) => { const ids = new Set(group); changeDoc(d => ({ items: d.items.map(i => (ids.has(i.id) ? ({ ...i, locked: on } as CourseItem) : i)) })); };
  return [
    { label: `Copy ${n}`, icon: Copy, run: () => { if (copySelection()) toast("Copied."); } },
    { label: `Duplicate ${n}`, icon: Copy, run: duplicateSelection },
    { label: locked ? "Unlock all" : "Lock all", icon: locked ? Unlock : Lock, run: () => lock(!locked), testid: "menu-lock-all" },
    { label: `Delete ${n}`, icon: Trash2, danger: true, run: deleteSelection, testid: "menu-delete" }
  ];
};

/** A hole's or a thing's rows; `ground`: the spot under the pointer or finger, if any; `named`:
 * the thing's own rows say what it is ("Copy the woods"), when trees there have rows too. */
export const itemActions = (itemId: string, ground: P | null, named = false): ItemAction[] => {
  const doc = getDoc();
  const set = useEditor.getState().set;
  const readOnly = useCourse.getState().readOnly;
  const hole = doc.holes.find(h => h.id === itemId);
  const item = doc.items.find(i => i.id === itemId);
  if (!hole && !item) return [];
  const holeId = hole?.id ?? (item && "holeId" in item ? item.holeId : undefined);
  const done = !!holeId && holeStats(doc, doc.holes.find(h => h.id === holeId)!).complete;
  const a: ItemAction[] = [];
  if (holeId && done) {
    // (a tee: the view from that one, whatever color the layout plays)
    const tee = item?.type === "tee";
    a.push({ label: tee ? "View from this tee" : "View from the tee", icon: Eye, run: () => set({ teeView: holeId, teeViewTee: tee ? item.id : null, flyover: false }), testid: "menu-tee-view" });
    a.push({ label: "Play flyover", icon: Plane, run: () => set({ teeView: holeId, flyover: true }) });
  }
  a.push({ label: hole ? "Zoom to this hole" : "Zoom to it", icon: Maximize2, run: () => (hole ? getView()?.fitHole(hole.id) : getView()?.zoomTo(itemId)), testid: "menu-zoom" });
  // (a comment on it: a point thing's pin moves with it; on a hole, a shape or a line, on the spot)
  const at = item && "x" in item && typeof item.x === "number" && typeof item.y === "number" ? { x: item.x, y: item.y } : null;
  if (hole) a.push(...commentRow("Comment on this hole", ground, { kind: "hole", id: hole.id }));
  else if (item && at) a.push(...commentRow(`Comment on this ${kindName(item)}`, at, { kind: "item", id: item.id, x: at.x, y: at.y }));
  else a.push(...commentRow("Comment here", ground));
  // (view only: nothing that changes the course)
  if (readOnly) return a;
  // (a thing the import brought in: all that came from the same source picked together, to
  // copy, lock or delete as one)
  // (an amenity: every one of its kind, to set them all at once)
  if (item?.type === "amenity") {
    const same = doc.items.filter(i => i.type === "amenity" && i.kind === item.kind && !i.locked);
    if (same.length > 1) a.push({ label: `Select all ${same.length} ${amenityPlural(item.kind)}`, icon: ListChecks, run: () => pickGroup(same.map(i => i.id)), testid: "menu-select-kind" });
  }
  const src = item && item.type !== "amenity" ? sourceOf(item) : null;
  if (src) {
    const same = doc.items.filter(i => !i.locked && sourceOf(i) === src);
    if (same.length > 1) a.push({ label: `Select all ${same.length.toLocaleString()} from this source`, icon: ListChecks, run: () => { pickGroup(same.map(i => i.id)); toast(`${GROUPS.find(g => g.id === SOURCES[src].group)?.label ?? "Things"}: ${SOURCES[src].label}. ${same.length.toLocaleString()} selected.`, "info"); }, testid: "menu-select-source" });
  }
  if (hole && done && ground) a.push({ label: "Bend the hole here", run: () => bendHoleAt(hole.id, ground), testid: "menu-bend" });
  // Any area or line that isn't OB itself, a fairway or a landing zone can have an OB edge, all of it
  // or a stretch (from the spot when there is one)
  const shape = item && (item.type === "area" || item.type === "line") ? item : null;
  const obbable = !!shape && (shape.type === "area" ? shape.kind !== "ob" && shape.kind !== "fairway" && shape.kind !== "green" : shape.kind !== "ob" && shape.kind !== "walk");
  const stretch = (cut: boolean) => () => { if (ground) getView()?.startObPick(itemId, ground, cut); set({ obPick: itemId, pickCut: cut, tool: "select" }); };
  if (shape && obbable) {
    const wet = shape.kind === "water" || shape.kind === "stream";
    a.push({ label: shape.ob === true ? "Remove the red OB edge" : wet ? "Red OB edge" : "Mark as OB (red edge)", run: () => updateItem(shape.id, (shape.ob === true ? { ob: undefined, obBeyond: undefined, obHoles: undefined, obStretches: undefined } : { ob: true }) as Partial<CourseItem>), testid: "menu-ob" });
    if (shape.type === "line" && !(shape.ob === true && shape.obBeyond)) a.push({ label: "Mark as OB and beyond", run: () => markObBeyond(shape.id), testid: "menu-ob-beyond" });
    a.push({ label: "OB along a stretch", run: stretch(false), testid: shape.type === "area" ? "menu-ob-edge" : "menu-ob-stretch" });
    // (or a hazard instead: never both)
    a.push({ label: shape.hazard === true ? "No longer a hazard" : "Make it a hazard", run: () => setObChoice(shape.id, shape.hazard === true ? "no" : "hazard"), testid: "menu-hazard" });
  }
  if (item?.type === "line" && !item.locked) a.push({ label: "Remove a stretch", run: stretch(true), testid: "menu-cut-stretch" });
  // (a field, court or play area: in play or out of it)
  if (item?.type === "area" && item.kind === "field") {
    const out = !!item.outOfPlay;
    a.push({ label: out ? "Mark as in play" : "Mark as out of play", run: () => setFieldPlay(item.id, !out), testid: "menu-out-of-play" });
  }
  // (on one of the things picked together: for all of them)
  const group = useEditor.getState().group;
  if (item && group.includes(item.id)) return [...a, ...groupActions()];
  const the = named && item ? ` the ${kindName(item)}` : "";
  const here = ground ?? (item ? { x: item.x + 30, y: item.y + 30 } : null);
  a.push({ label: `Copy${the}`, icon: Copy, run: () => { select(itemId); if (copySelection()) toast("Copied."); }, testid: "menu-copy" });
  if (canPaste() && here) a.push({ label: ground ? "Paste here" : "Paste next to it", icon: ClipboardPaste, run: () => pasteClipboard(here) });
  a.push({ label: `Duplicate${the}`, icon: Copy, run: () => { select(itemId); duplicateSelection(); } });
  if (item) a.push({ label: item.locked ? "Unlock" : "Lock in place", icon: item.locked ? Unlock : Lock, run: () => updateItem(item.id, { locked: !item.locked } as Partial<CourseItem>) });
  a.push({ label: `Delete${the}`, icon: Trash2, danger: true, run: () => { select(itemId); deleteSelection(); }, testid: "menu-delete" });
  return a;
};

/** Open ground (on Design, while the course can be changed): what can start there, a tee or pin
 * for the hole being worked on, a turn in its line, a new hole, measuring; and Paste. `hole`: the
 * hole being worked on, for the menu's heading. */
export const groundActions = (ground: P, onOpenGround: boolean): { hole?: string; rows: ItemAction[] } => {
  const doc = getDoc();
  const ed = useEditor.getState();
  const comment = commentRow("Comment here", ground);
  if (useCourse.getState().readOnly) return { rows: comment };
  const rows: ItemAction[] = [];
  const here = onOpenGround && ed.step === "design";
  const working = here ? doc.holes.find(h => h.id === (ed.activeHoleId ?? ed.selectedId)) : undefined;
  const toolThen = (tool: "add-hole" | "measure", then: (p: P) => void) => () => {
    useEditor.getState().set({ tool });
    requestAnimationFrame(() => requestAnimationFrame(() => then(ground)));
  };
  if (working) {
    rows.push({ label: "Add a tee here", run: () => placeAt("add-tee", ground) });
    rows.push({ label: "Add a pin here", run: () => placeAt("add-basket", ground) });
    if (holeStats(doc, working).complete) rows.push({ label: "Bend the hole here", run: () => bendHoleAt(working.id, ground) });
  }
  if (here) {
    rows.push({ label: "New hole, tee here", run: toolThen("add-hole", p => getView()?.toolPoint(p)) });
    rows.push({ label: "Measure from here", icon: Ruler, run: toolThen("measure", p => getView()?.measureFrom(p)) });
  }
  if (canPaste()) rows.push({ label: "Paste here", icon: ClipboardPaste, run: () => pasteClipboard(ground) });
  rows.push(...comment);
  return { hole: working ? `Hole ${holeLabel(doc, working.id)}` : undefined, rows };
};
