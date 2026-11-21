// Each building's roof color, read from the aerial photo: its pixels a few feet in from its outline
// (not its edge or the ground beside it), shade and leaves left out (by the photo's near-infrared
// band where it has one), the sunlit half's middle color; then made a roof color by how it compares
// with the site's other roofs (a photo's exposure and tint differ from place to place; most roofs are
// gray), snapped to one of the roof colors (lib/buildingParts ROOF_COLORS).
import type { CourseItem, P, StructureItem } from "../../types";
import { pointInPolygon } from "../geom";
import { snapRoof, roofLab } from "../buildingParts";

const pixels = async (url: string, W: number, H: number) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, W, H);
  return g.getImageData(0, 0, W, H).data;
};

/** How far a point is from an outline's nearest side. */
const edgeDist = (p: P, poly: P[]) => {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    d = Math.min(d, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return d;
};

/**
 * The roof colors of the buildings among `items` that the photo shows clearly (by id, a roof
 * color's name): `photoUrl` and `nirUrl` over the site, `W` × `H` ft.
 */
export const roofColorsFromPhoto = async (items: CourseItem[], photoUrl: string, nirUrl: string | null | undefined, W: number, H: number) => {
  const w = Math.round(W), h = Math.round(H);
  const px = await pixels(photoUrl, w, h);
  const nir = nirUrl ? await pixels(nirUrl, w, h).catch(() => null) : null;
  const read = new Map<string, [number, number, number]>();
  for (const it of items) {
    if (it.type !== "structure" || it.kind !== "building") continue;
    const st = it as StructureItem, poly = st.points;
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    if (x1 - x0 < 6 || y1 - y0 < 6) continue;
    // (big ones read every few feet: enough to know the color)
    const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500)));
    let all = 0;
    const kept: [number, number, number, number][] = [];
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const p = { x: x + 0.5, y: y + 0.5 };
      if (!pointInPolygon(p, poly) || edgeDist(p, poly) < 3) continue;
      all++;
      const k = (y * w + x) * 4, R = px[k], G = px[k + 1], B = px[k + 2], L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (L < 28) continue;
      if (nir) { const n = nir[k]; if ((n - R) / (n + R + 1) > 0.22) continue; }
      else if (2 * G - R - B > 18 && G > R) continue;
      kept.push([R, G, B, L]);
    }
    if (all < 12 || kept.length / all < 0.35) continue;
    kept.sort((a, b) => b[3] - a[3]);
    const lit = kept.slice(0, Math.max(6, Math.ceil(kept.length / 2)));
    const med = (i: number) => { const v = lit.map(q => q[i]).sort((a, b) => a - b); return v[v.length >> 1]; };
    read.set(st.id, [med(0), med(1), med(2)]);
  }
  // (the site's middle roof: its lightness and tint taken as a mid-gray roof's)
  const labs = [...read.values()].map(roofLab);
  const out = new Map<string, string>();
  if (labs.length < 1) return out;
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  // (with only a few roofs, they're taken as they are)
  const mid = labs.length >= 5 ? median(labs.map(l => l[0])) : 56, cast: [number, number] = labs.length >= 5 ? [median(labs.map(l => l[1])), median(labs.map(l => l[2]))] : [0, 0];
  for (const [id, rgb] of read) out.set(id, snapRoof(rgb, mid, cast));
  return out;
};
