// What was changed by hand while a site was looked over, before it came in: a thing moved or
// reshaped in the view (water, woods, a path, a building), a hole, the ground, the measured trees'
// marks. The look-over's course is built again from the site each time a switch, a left-out thing
// or the tree colours change, and once more as the site is brought in; these changes are kept
// apart and laid on each time, so the site comes in exactly as it was left.
import type { CourseDoc, CourseItem, Hole } from "../types";

/** The parts of the course itself that the look-over can change (and nothing a switch picks). */
const GROUND = ["terrainHeights", "terrainOriginal", "groundPaint", "cutTrees"] as const;
type Ground = Partial<Pick<CourseDoc, (typeof GROUND)[number]>>;
type Lidar = NonNullable<CourseDoc["lidar"]>;

export type HandEdits = {
  /** Things changed by hand, as they were left (found again by id, or by what they were like when they came). */
  changed: CourseItem[];
  /** Things added by hand. */
  made: CourseItem[];
  /** Things taken away by hand. */
  gone: { id: string; sig?: string }[];
  /** Holes changed by hand, and ones made by hand. */
  holes: Hole[];
  holesMade: Hole[];
  holesGone: string[];
  ground: Ground;
  /** The measured trees' cut and kept marks, for a list of `n` trees (a list that changed since loses them). */
  lidar?: { n: number; kept?: number[]; removed?: number[] };
};

export const NO_HAND: HandEdits = { changed: [], made: [], gone: [], holes: [], holesMade: [], holesGone: [], ground: {} };

export const hasHand = (h: HandEdits) =>
  !!(h.changed.length || h.made.length || h.gone.length || h.holes.length || h.holesMade.length || h.holesGone.length || Object.keys(h.ground).length || h.lidar);

/** The thing in `items` that `x` is: the same id, or else one that came the same way. */
const twin = (items: CourseItem[], x: { id: string; importSig?: string; sig?: string }) => {
  const sig = "importSig" in x ? x.importSig : x.sig;
  return items.find(i => i.id === x.id) ?? (sig ? items.find(i => i.importSig === sig) : undefined);
};

/** What changed by hand from the look-over's course as it was built (`was`) to as it is (`now`),
 * with the changes from before (`before`) that this course had nothing to lay them on. */
export const handEdits = (was: CourseDoc, now: CourseDoc, before: HandEdits = NO_HAND): HandEdits => {
  const wasById = new Map(was.items.map(i => [i.id, i])), nowIds = new Set(now.items.map(i => i.id));
  const changed: CourseItem[] = [], made: CourseItem[] = [];
  for (const i of now.items) {
    const w = wasById.get(i.id);
    if (!w) made.push(i);
    else if (w !== i) changed.push(i);
  }
  const gone = was.items.filter(i => !nowIds.has(i.id)).map(i => ({ id: i.id, ...(i.importSig ? { sig: i.importSig } : {}) }));
  // (kept from before: the changes to things this course hasn't got, a source switched off say)
  for (const c of before.changed) if (!twin(was.items, c)) changed.push(c);
  for (const g of before.gone) if (!twin(was.items, g)) gone.push(g);
  const wasHoles = new Map(was.holes.map(h => [h.id, h])), nowHoles = new Set(now.holes.map(h => h.id));
  const holes = now.holes.filter(h => wasHoles.has(h.id) && wasHoles.get(h.id) !== h), holesMade = now.holes.filter(h => !wasHoles.has(h.id));
  for (const h of before.holes) if (!wasHoles.has(h.id)) holes.push(h);
  const holesGone = [...was.holes.filter(h => !nowHoles.has(h.id)).map(h => h.id), ...before.holesGone.filter(id => !wasHoles.has(id))];
  const ground: Ground = { ...before.ground };
  for (const k of GROUND) if (now[k] !== was[k]) (ground as Record<string, unknown>)[k] = now[k];
  let lidar = before.lidar;
  const wl = was.lidar, nl = now.lidar;
  if (wl && nl && nl.trees === wl.trees && (nl.kept !== wl.kept || nl.removed !== wl.removed)) lidar = { n: nl.trees.length, kept: nl.kept, removed: nl.removed };
  return { changed, made, gone, holes, holesMade, holesGone, ground, ...(lidar ? { lidar } : {}) };
};

/** The course with the changes made by hand laid on. */
export const withHand = (doc: CourseDoc, hand: HandEdits): CourseDoc => {
  if (!hasHand(hand)) return doc;
  const out = new Set<string>();
  for (const g of hand.gone) { const t = twin(doc.items, g); if (t) out.add(t.id); }
  const used = new Set<CourseItem>();
  const put = new Map<string, CourseItem>();
  for (const c of hand.changed) {
    const t = twin(doc.items, c);
    if (!t || used.has(t)) continue;
    used.add(t);
    put.set(t.id, { ...c, id: t.id } as CourseItem);
  }
  const items = doc.items.filter(i => !out.has(i.id)).map(i => put.get(i.id) ?? i);
  const ids = new Set(items.map(i => i.id));
  for (const m of hand.made) if (!ids.has(m.id)) items.push(m);
  const holeOut = new Set(hand.holesGone), holeBy = new Map(hand.holes.map(h => [h.id, h]));
  const holes = doc.holes.filter(h => !holeOut.has(h.id)).map(h => holeBy.get(h.id) ?? h);
  for (const h of hand.holesMade) if (!holes.some(x => x.id === h.id)) holes.push(h);
  const lidar: Lidar | undefined = doc.lidar && hand.lidar && doc.lidar.trees.length === hand.lidar.n ? { ...doc.lidar, kept: hand.lidar.kept, removed: hand.lidar.removed } : doc.lidar;
  return { ...doc, ...hand.ground, items, holes, lidar };
};
