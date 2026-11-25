// The kinds of trees a course grows: the ones allowed in its style (Site step › Trees › Kinds of
// trees; unset: oak, ash and pine, as before there was a choice), each tree of the woods and the
// measured trees taking one of them, the same every time it's drawn, in 3D and on the painted map
// alike. And a recommendation for the course's region: the trees the USDA Forest Service's forest
// survey (Forest Inventory and Analysis: live trees an inch thick and up on forest land, each
// state's latest survey) counts there, added up by region, every species grouped into the looks
// GlideLine Studio's tree engine can grow (hickory and walnut as ash, fir and hemlock as spruce, juniper as
// cedar…). The table (data/tree-regions.json) is built once from the survey's own web service and
// the Census Bureau's county centers (scripts/tree-mix.py); a course finds its state, and so its
// region, by the nearest county center, offline. In Denmark: the most common kinds in the national
// forest inventory.

import { inDenmark } from "./geo/dkArea";

/** The tree looks, and which of each kind's variants (three/ezShapes' PRESETS) are each. */
export const LOOK_VARIANTS = {
  oak: { shape: "broadleaf", variants: [0, 2, 4] }, ash: { shape: "broadleaf", variants: [1, 3, 5] },
  maple: { shape: "broadleaf", variants: [10, 11] }, aspen: { shape: "broadleaf", variants: [6, 7] },
  birch: { shape: "broadleaf", variants: [8, 9] }, willow: { shape: "broadleaf", variants: [12] },
  pear: { shape: "broadleaf", variants: [13, 14] }, beech: { shape: "broadleaf", variants: [15, 16] },
  pine: { shape: "conifer", variants: [0, 1, 2, 3] }, tallpine: { shape: "conifer", variants: [8, 9] }, spruce: { shape: "conifer", variants: [4, 5] }, cedar: { shape: "conifer", variants: [6, 7] }
} as const;
export type TreeLookId = keyof typeof LOOK_VARIANTS;
export const TREE_LOOKS = Object.keys(LOOK_VARIANTS) as TreeLookId[];
/** How much of each kind, by weight (a region's: percent). */
export type TreeShares = Partial<Record<TreeLookId, number>>;

/** Each look's name (the setting's chips; the survey's trees grouped into it, said in the help). */
export const LOOK_LABEL: Record<TreeLookId, string> = {
  oak: "Oak", ash: "Ash", maple: "Maple", aspen: "Aspen", birch: "Birch",
  willow: "Weeping willow", pear: "Bradford pear", beech: "Beech", pine: "Pine", tallpine: "Tall pine", spruce: "Spruce", cedar: "Cedar"
};

/** Each look's leaves against the course's tree color: hue, saturation and lightness moved a little
 * (a birch's and a willow's lighter, a spruce's bluer and darker). */
export const LOOK_TINT: Record<TreeLookId, [number, number, number]> = {
  oak: [0, 0, 0], ash: [0.01, 0, 0.02], maple: [-0.01, 0.04, 0], aspen: [0.02, 0.02, 0.05], birch: [0.02, -0.02, 0.07],
  willow: [0.03, 0.03, 0.07], pear: [-0.005, 0.06, 0.05], beech: [0.015, 0.05, 0.03], pine: [0, 0, 0], tallpine: [0.01, 0.02, 0.03], spruce: [0.04, -0.06, -0.04], cedar: [-0.01, -0.03, -0.02]
};

/** The kinds a course grows when none are picked: as before there was a choice. */
export const DEFAULT_KINDS: TreeLookId[] = ["oak", "ash", "pine"];
/** The kinds a style allows. */
export const kindsOf = (s: { treeKinds?: string[] }) => (s.treeKinds?.length ? s.treeKinds.filter((k): k is TreeLookId => k in LOOK_VARIANTS) : DEFAULT_KINDS);
/** The kinds as the woods weigh them, each as likely as the others of its shape; null for the usual
 * three (the woods then exactly as before there was a choice). */
export const sharesOf = (s: { treeKinds?: string[] }): TreeShares | null => {
  const kinds = kindsOf(s);
  if (kinds.length === DEFAULT_KINDS.length && DEFAULT_KINDS.every(k => kinds.includes(k))) return null;
  return Object.fromEntries(kinds.map(k => [k, 1])) as TreeShares;
};
const hasShape = (shares: TreeShares, shape: "broadleaf" | "conifer") => (Object.keys(shares) as TreeLookId[]).some(l => LOOK_VARIANTS[l].shape === shape && (shares[l] ?? 0) > 0);
/** The shape a wood grows when it grows one (all pines, or none and no bushes), else null. */
export const standShape = (a: { pines?: number; bushes?: number }): "broadleaf" | "conifer" | null =>
  (a.bushes ?? 0) >= 1 ? null : a.pines === 1 ? "conifer" : a.pines === 0 ? "broadleaf" : null;
/** A wood's own kinds: its one species, where it grows only that species' shape (a stand of the
 * Trees tool's, or set in its panel); else the course's (`course`). */
export const standShares = (a: { species?: string; pines?: number; bushes?: number }, course: TreeShares | null): TreeShares | null =>
  a.species && a.species in LOOK_VARIANTS && LOOK_VARIANTS[a.species as TreeLookId].shape === standShape(a) ? ({ [a.species]: 1 } as TreeShares) : course;

/** The share of needle trees in woods: none when no needle kind is allowed, all when no leafy one
 * is, else `usual` (the wood's or the style's). */
export const conifersWith = (shares: TreeShares | null, usual: number) => (!shares ? usual : !hasShape(shares, "conifer") ? 0 : !hasShape(shares, "broadleaf") ? 1 : usual);
/** The shape a measured tree is drawn as: as measured, unless no kind of that shape is allowed. */
export const shapeWith = (shares: TreeShares | null, shape: "broadleaf" | "conifer"): "broadleaf" | "conifer" => {
  if (!shares || hasShape(shares, shape)) return shape;
  const other = shape === "conifer" ? "broadleaf" : "conifer";
  return hasShape(shares, other) ? other : shape;
};

/** The look a tree of a kind takes among the allowed, from a draw (0..1), weighted; null with the
 * usual kinds, or none of the shape allowed. */
export const lookFor = (shape: "broadleaf" | "conifer" | "bush", u: number, shares?: TreeShares | null): TreeLookId | null => {
  if (!shares || shape === "bush") return null;
  const mine = (Object.entries(shares) as [TreeLookId, number][]).filter(([l, v]) => v > 0 && LOOK_VARIANTS[l].shape === shape);
  const all = mine.reduce((s, [, v]) => s + v, 0);
  if (!all) return null;
  let x = u * all;
  for (const [l, v] of mine) { if ((x -= v) < 0) return l; }
  return mine[mine.length - 1][0];
};

/** One of a look's variants, from a draw (0..1). */
export const variantOf = (look: TreeLookId, u: number) => {
  const v = LOOK_VARIANTS[look].variants;
  return v[Math.min(v.length - 1, Math.floor(u * v.length))];
};

/** A draw (0..1) that is the same for the same number and salt: a measured tree's look by its
 * index, the same in 3D and on the painted map. */
export const drawOf = (n: number, salt: number) => {
  const s = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

type Region = { id: string; name: string; states: number[]; shares: TreeShares };
/** Denmark's woods, by area: Norway spruce 14 %, beech 13 %, oak 11 % (the national forest
 * inventory, Skovstatistik 2018). */
const DENMARK: TreeShares = { spruce: 14, beech: 13, oak: 11 };
type Table = { regions: Region[]; centers: [number, number, number][] };
let table: Promise<Table> | null = null;

/** The region a spot is in (its state's, by the nearest county's middle), with the kinds the survey
 * counts there and the ones to recommend (each at least a twentieth of its trees, most first); null
 * outside the US. */
export async function regionAt(lat: number, lon: number): Promise<{ id: string; name: string; shares: TreeShares; recommended: TreeLookId[] } | null> {
  if (inDenmark({ north: lat, south: lat, west: lon, east: lon })) return { id: "dk", name: "Denmark", shares: DENMARK, recommended: ["spruce", "beech", "oak"] };
  const t = await (table ??= import("../data/tree-regions.json").then(m => m.default as unknown as Table));
  let state = -1, bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const [la, lo, st] of t.centers) {
    const d = (la - lat) ** 2 + ((lo - lon) * k) ** 2;
    if (d < bestD) { bestD = d; state = st; }
  }
  // (more than about 60 miles from every county's middle: not in the US)
  if (bestD > 0.9 ** 2) return null;
  const r = t.regions.find(x => x.states.includes(state));
  if (!r) return null;
  const recommended = (Object.entries(r.shares) as [TreeLookId, number][]).filter(([, v]) => v >= 5).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return { id: r.id, name: r.name, shares: r.shares, recommended };
}
