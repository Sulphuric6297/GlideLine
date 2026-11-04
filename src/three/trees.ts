// Trees: real-looking trees from the shared tree kit (three/treeKit: a branching skeleton and
// leaf-spray cards). (From the Security Camera Planner.)
import { LOOK_TINT, type TreeLookId } from "../lib/treeMix";
import * as THREE from "three";
import { presetFor, specOf, speciesOfPreset, type TreeSpec } from "./ezShapes";
import { clamp } from "../constants";
import type { TreeItem } from "../types";
import { treeMeshes, variantOf, type TreeShape, forestDetail, midOf } from "./treeKit";

/** Where a tree gives way to its middle and far versions, ft from the camera (never, while
 * forestDetail says all). */
const switchesAt = () => (forestDetail.all ? [Infinity, Infinity] : [forestDetail.nearFt, midOf(forestDetail.nearFt)]);

/** The trees under `root` switch where forestDetail says now (it changed since they were made). */
export function retuneTrees(root: THREE.Object3D) {
  const [mid, far] = switchesAt();
  root.traverse(o => {
    if (!(o as THREE.LOD).isLOD || !o.userData.tree) return;
    const levels = (o as THREE.LOD).levels;
    levels[1].distance = mid;
    levels[2].distance = far;
  });
}

export const getTreeSignature = (item: TreeItem) =>
  `${item.radius}|${item.height ?? 30}|${item.width ?? 1}|${item.treeType ?? 'deciduous'}|${item.color}|${item.variant ?? ""}|${item.leaf ?? ""}|` +
  JSON.stringify([item.species, item.seed, item.crownBase, item.lean, item.leanDir, item.limbs, item.trunk, item.fullness, item.rotation]);

/** What a tree item is grown from: its pool shape when untouched, else its own spec. */
export const itemSpec = (item: TreeItem, shape: TreeShape, variant: number, height: number): TreeSpec | undefined => {
  const own = item.species !== undefined || item.seed !== undefined || item.crownBase !== undefined || item.limbs !== undefined || item.trunk !== undefined || item.fullness !== undefined;
  if (!own) return undefined;
  const pool = specOf(shape, variant);
  // (its own preset until a species is picked: a setting changed doesn't grow it anew)
  const preset = item.species !== undefined && item.species !== speciesOfPreset(shape, pool.preset) ? presetFor(shape, item.species, height) : pool.preset;
  return { preset, seed: item.seed ?? pool.seed, crownBase: item.crownBase, limbs: item.limbs, trunk: item.trunk, fullness: item.fullness };
};

/** Leaf color for a tree from its (map) color: lifted to a real crown's lightness, varied a little. */
export const foliageTint = (color: string, rand: () => number) => {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h + (rand() - 0.5) * 0.04, clamp(hsl.s * (0.9 + rand() * 0.25), 0.22, 0.62), clamp(hsl.l * 1.3 + 0.07 + (rand() - 0.5) * 0.08, 0.2, 0.5));
};

/** The course's tree colors (its landscape's): the color, and the mix the woods vary through. A
 * tree placed by hand takes them like the woods and the measured trees do, each its own pick. */
export type TreeLook = { color: string; mix: string[] };

export const create3dTree = (item: TreeItem, look?: TreeLook): THREE.Group => {
  const treeHeight = item.height ?? 30;
  const widthMultiplier = item.width ?? 1;
  const treeType = item.treeType ?? "deciduous";
  // Deterministic per-tree variation
  const seed = item.id.split("").reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rand = (i: number) => {
    const x = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  let k = 70;
  const next = () => rand(k++);
  const shape: TreeShape = treeType === "conifer" ? "conifer" : treeType === "bush" ? "bush" : "broadleaf";
  const height = shape === "bush" ? Math.min(treeHeight, Math.max(3, item.radius * 1.2)) : treeHeight;
  // (the landscape's colors, one of its mix per tree as in the woods; a pine darker and bluer)
  let tint: THREE.Color;
  if (item.leaf) tint = new THREE.Color(item.leaf);
  else {
    const leaf = look ? (look.mix.length && shape !== "conifer" ? look.mix[Math.floor(next() * look.mix.length)] : look.color) : item.color;
    tint = foliageTint(leaf, next);
    if (shape === "conifer") tint.offsetHSL(0.03, -0.06, -0.08);
    if (item.species && item.species in LOOK_TINT) tint.offsetHSL(...LOOK_TINT[item.species as TreeLookId]);
  }
  // (close, middle and far versions, as the woods have, by distance from the camera)
  const variant = item.variant ?? variantOf(item.id, shape), w = item.radius * 2 * widthMultiplier;
  const spec = itemSpec(item, shape, variant, height);
  const lod = new THREE.LOD();
  const [mid, far] = switchesAt();
  lod.addLevel(treeMeshes(shape, variant, height, w, tint, "near", false, spec), 0);
  lod.addLevel(treeMeshes(shape, variant, height, w, tint, "mid", false, spec), mid);
  lod.addLevel(treeMeshes(shape, variant, height, w, tint, "far", false, spec), far);
  lod.userData.tree = true;
  // (a tree grown from the pool's shapes, nothing of its own: it can be drawn with the others,
  // standing and flying, see CourseView.syncPlacedBatch)
  if (!spec) lod.userData.pool = { shape, variant, height };
  // Its lean: tilted over about its foot (the map's north is -z; the turn is undone so the lean
  // keeps its compass direction whichever way the tree is turned)
  const tilt = new THREE.Group();
  if (item.lean) {
    const dir = ((item.leanDir ?? 0) + (item.rotation ?? 0)) * (Math.PI / 180);
    tilt.rotation.set(-Math.cos(dir) * item.lean * (Math.PI / 180), 0, -Math.sin(dir) * item.lean * (Math.PI / 180), "XZY");
  }
  tilt.add(lod);
  const group = new THREE.Group();
  group.add(tilt);
  group.position.set(item.x, 0, item.y);
  group.rotation.y = -THREE.MathUtils.degToRad(item.rotation);
  return group;
};
