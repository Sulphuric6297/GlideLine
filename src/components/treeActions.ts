// A tree's part of the map's menu (a right-click, or a finger held on it), the same on a computer
// and a phone: what the tree is and how tall, and to edit it or cut it down; and the thing it
// stands over (its wood, a road, a hole's line), to pick from there.
import { holeLabel } from "../lib/course";
import { grownTree, heightWoods, inHeights } from "../lib/lidar";
import { fmtDist } from "../lib/units";
import { adoptLidarTree, adoptTreeAt, cutTreeAt, select } from "../state/actions";
import { getView } from "../state/view";
import type { CourseDoc, P } from "../types";
import type { CourseView } from "../viewport/CourseView";
import { kindName } from "./itemActions";

/** A tree that isn't an item of its own: measured from the air (its index), or a sapling or a
 * tree the app planted (where it stands and its size). */
export type MenuTree = NonNullable<ReturnType<CourseView["treeAt"]>>;
/** One row of the menu. */
export type TreeAction = { label: string; testid: string; run: () => void };

/** Every tree the menu's point passes through, nearest first (a sprout under a big crown is there
 * too); looking straight down, the one standing at `ground`. */
export const treesAt = (clientX: number, clientY: number, ground: P | null): MenuTree[] => {
  const trees = getView()?.treesAtScreen(clientX, clientY) ?? [];
  if (!trees.length && ground) { const t = getView()?.treeAt(ground); if (t) trees.push(t); }
  return trees;
};

/** What the tree is, with its height: "Measured tree · 45 ft", "Sapling · 12 ft". */
export const treeTitle = (doc: CourseDoc, t: MenuTree) => {
  if (t.kind === "measured") {
    const g = doc.lidar?.trees[t.k];
    // (as it stands: grown, and within its woods' own heights)
    return `Measured tree · ${fmtDist(g ? inHeights(grownTree(g, doc.lidar?.growYears ?? 0), heightWoods(doc.items), doc.lidar?.minHeight ?? 0)[2] : 0, doc.units)}`;
  }
  return `${t.height < 25 ? "Sapling" : "Planted tree"} · ${fmtDist(t.height, doc.units)}`;
};

/** What can be done with the tree: make it the course's own to change it (its panel opens), or
 * cut it down (Undo brings it back). */
export const treeActions = (t: MenuTree): TreeAction[] => [
  { label: "Edit this tree", testid: "tree-adopt", run: () => { const look = getView()?.lookOf(t) ?? null; if (t.kind === "measured") adoptLidarTree(t.k, look); else adoptTreeAt(t, look); } },
  { label: "Cut down this tree", testid: "tree-cut", run: () => (t.kind === "measured" ? getView()?.toggleLidarTree(t.k) : cutTreeAt(t)) }
];

/** The thing the tree stands over (`under`, from the map's menu), to pick instead: "Select the
 * woods", "Select the bridge", "Select hole 3". */
export const underAction = (doc: CourseDoc, under: string | null | undefined): TreeAction | null => {
  const item = under ? doc.items.find(i => i.id === under) : undefined;
  const hole = under && !item ? doc.holes.find(h => h.id === under) : undefined;
  if (!item && !hole) return null;
  return { label: hole ? `Select hole ${holeLabel(doc, hole.id)}` : `Select the ${kindName(item!)}`, testid: "tree-select-under", run: () => select(under!) };
};
