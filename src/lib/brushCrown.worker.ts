// Hand painted trees painted away from the page, a batch at a time, each on its own canvas,
// handed back as pictures for the page to lay on the map in order (lib/brushCrown).
import { listTrees, paintTree, setPxPerFt, type BrushTree } from "./brushCrown";

self.onmessage = (e: MessageEvent<{ id: number; trees: BrushTree[]; sun: number[]; scale?: number; list?: boolean }>) => {
  const { id, trees, sun, scale, list } = e.data;
  try {
    // (the map's scale, as the page paints its trees at)
    setPxPerFt(scale ?? 0);
    // (or only their strokes listed, for the page's graphics chip to paint)
    if (list) {
      const got = listTrees(trees, sun);
      (self as unknown as Worker).postMessage({ id, out: got }, [got.data.buffer]);
      return;
    }
    const out = trees.map(t => {
      const c = new OffscreenCanvas(Math.ceil(t.r * 3.4) + 24, Math.ceil(t.r * 3.4) + 24);
      const S = paintTree(c, t, sun);
      return { S, bm: c.transferToImageBitmap() };
    });
    (self as unknown as Worker).postMessage({ id, out }, out.map(o => o.bm));
  } catch {
    (self as unknown as Worker).postMessage({ id, out: null });
  }
};
