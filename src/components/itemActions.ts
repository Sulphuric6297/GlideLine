// The map's menu for a hole or a thing on it, and for open ground (a right-click on a computer, a
// finger held on a phone): one list, so both menus offer the same rows in the same words.
import { AppWindow, CarFront, ClipboardPaste, Copy, DoorOpen, Eye, Fence, Grid2x2, Home, ListChecks, Lock, Maximize2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Plane, Plus, Ruler, Trash2, Unlock, Warehouse, type LucideIcon } from "lucide-react";
import { addAddOnToWall, addToWall, clipped, copyAddOn, endsOf, laidOutKind, levelsOf, pasteAddOn, putSteps, removeLaidOut, removeSteps, setAddOnEnd, toggleRail } from "./BuildingPanel";
import { ADDON_LABEL, OPENING_LABEL } from "../lib/buildingParts";
import { removeAddOn, removeOpening } from "../state/actions";
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
 * the thing's own rows say what it is ("Copy the woods"), when trees there have rows too; `screen`:
 * where on the screen (a building's wall there: a door or window added on it, there). */
export const itemActions = (itemId: string, ground: P | null, named = false, screen?: { clientX: number; clientY: number }): ItemAction[] => {
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
  // (a building's wall: a window, a door or a garage door put there; the one there taken off)
  if (item?.type === "structure" && item.kind === "building" && !item.locked && screen) {
    const spot = getView()?.buildingSpot(item.id, screen.clientX, screen.clientY);
    if (spot) {
      const add = (kind: "window" | "door" | "garage") => () => {
        select(item.id);
        const st = getDoc().items.find(i => i.id === item.id);
        if (st?.type === "structure" && !addToWall(st, spot.wall, kind, spot.along)) toast(`No room for a ${OPENING_LABEL[kind].toLowerCase()} on this wall.`, "info");
      };
      if (!spot.addOn) {
        a.push({ label: "Add a window here", icon: AppWindow, run: add("window"), testid: "menu-add-window" });
        a.push({ label: "Add a door here", icon: DoorOpen, run: add("door"), testid: "menu-add-door" });
        a.push({ label: "Add a garage door here", icon: Warehouse, run: add("garage"), testid: "menu-add-garage" });
      }
      const built = (kind: "porch" | "carport" | "deck" | "patio") => () => {
        select(item.id);
        const st = getDoc().items.find(i => i.id === item.id);
        if (st?.type === "structure" && !addAddOnToWall(st, spot.wall, kind, spot.along)) toast(`No room for a ${ADDON_LABEL[kind].toLowerCase()} on this wall.`, "info");
      };
      // (a porch set into the house: its end there opened round the corner, or closed again)
      const endAd = spot.end && item.addOns?.find(x => x.id === spot.end!.addOn);
      if (spot.end && endAd) {
        const ends = endsOf(item, endAd), k = spot.end.end === 0 ? 0 : 1;
        if (ends.open[k]) a.push({ label: "Close this side", icon: PanelLeftClose, run: () => { select(item.id); setAddOnEnd(getDoc().items.find(i => i.id === item.id) as typeof item, endAd.id, spot.end!.end, false); }, testid: "menu-close-side" });
        else if (ends.can[k]) a.push({ label: "Open this side", icon: PanelLeftOpen, run: () => { select(item.id); setAddOnEnd(getDoc().items.find(i => i.id === item.id) as typeof item, endAd.id, spot.end!.end, true); }, testid: "menu-open-side" });
      }
      if (spot.addOn) {
        const ad = item.addOns?.find(x => x.id === spot.addOn);
        if (ad) {
          const name = ADDON_LABEL[ad.kind].toLowerCase(), L = levelsOf(item, ad), cur = () => getDoc().items.find(i => i.id === item.id) as typeof item;
          // (its steps there, or steps put there; its railing on that side)
          if (spot.step !== undefined) a.push({ label: "Remove these steps", icon: Trash2, run: () => { select(item.id); removeSteps(cur(), ad.id, spot.step!); }, testid: "menu-remove-steps" });
          else if (spot.side && L.level && L.up >= 0.5) a.push({ label: "Put steps here", icon: Plus, run: () => { select(item.id); putSteps(cur(), ad.id, spot.side!.side, spot.side!.at); }, testid: "menu-put-steps" });
          if (spot.side && L.rail) a.push({ label: (ad.noRail ?? []).includes(spot.side.side) ? "Put the railing back on this side" : "No railing on this side", icon: Fence, run: () => { select(item.id); toggleRail(cur(), ad.id, spot.side!.side); }, testid: "menu-rail-side" });
          a.push({ label: `Copy this ${name}`, icon: Copy, run: () => copyAddOn(ad), testid: "menu-copy-addon" });
          a.push({ label: `Remove this ${name}`, icon: Trash2, danger: true, run: () => { select(item.id); removeAddOn(item.id, ad.id); }, testid: "menu-remove-addon" });
        }
      } else {
        const cl = clipped();
        if (cl) a.push({ label: `Paste the ${ADDON_LABEL[cl.kind].toLowerCase()} here`, icon: ClipboardPaste, run: () => { select(item.id); const st = getDoc().items.find(i => i.id === item.id); if (st?.type === "structure" && !pasteAddOn(st, spot.wall, spot.along)) toast(`No room for it on this wall.`, "info"); }, testid: "menu-paste-addon" });
        a.push({ label: "Add a porch here", icon: Home, run: built("porch"), testid: "menu-add-porch" });
        a.push({ label: "Add a carport here", icon: CarFront, run: built("carport"), testid: "menu-add-carport" });
        a.push({ label: "Add a deck here", icon: Fence, run: built("deck"), testid: "menu-add-deck" });
        a.push({ label: "Add a patio here", icon: Grid2x2, run: built("patio"), testid: "menu-add-patio" });
      }
      const there = spot.opening ? item.openings?.find(o => o.id === spot.opening) : undefined;
      if (there) a.push({ label: `Remove this ${OPENING_LABEL[there.kind].toLowerCase()}`, icon: Trash2, danger: true, run: () => { select(item.id); removeOpening(item.id, there.id); }, testid: "menu-remove-opening" });
      // (one laid out by itself: the same)
      const laid = !there && spot.laidAt !== undefined ? laidOutKind(item, spot.wall, spot.laidAt) : undefined;
      if (laid) a.push({ label: `Remove this ${OPENING_LABEL[laid].toLowerCase()}`, icon: Trash2, danger: true, run: () => { select(item.id); const st = getDoc().items.find(i => i.id === item.id); if (st?.type === "structure") removeLaidOut(st, spot.wall, spot.laidAt!); }, testid: "menu-remove-opening" });
    }
  }
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
