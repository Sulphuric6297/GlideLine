// A band of a painting's pixel pass, painted away from the page: the masks, treetops and light
// worked out as the page does, then only this band's rows, handed back (lib/forest: painted in bands).
import { forestBand } from "./forest";
import { setMeasuredStanding } from "./standing";

// (the ground's heights, sent once and kept: what's worked out from them is kept with them)
let ground: { id: number; heights: Record<string, number> } | null = null;

self.onmessage = (e: MessageEvent) => {
  const { id, doc, terrainId, terrain, view, stats, opts, standing } = e.data;
  try {
    if (terrain) ground = { id: terrainId, heights: terrain };
    if (!ground || ground.id !== terrainId) throw new Error("no ground");
    setMeasuredStanding(standing);
    const b = forestBand({ ...doc, terrainHeights: ground.heights }, view, stats, opts);
    if (!b) throw new Error("no band");
    (self as unknown as Worker).postMessage({ id, ...b }, [b.o.buffer, b.pre.buffer, b.bits.buffer]);
  } catch {
    (self as unknown as Worker).postMessage({ id });
  }
};
