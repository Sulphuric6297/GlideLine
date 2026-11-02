// The satellite's seasons over a site: how green each 10 m spot is in winter, as the leaves come in
// April and in summer, from ESA's Sentinel-2 (its surface reflectance, as Microsoft's Planetary
// Computer serves it, open to any website). Each season the middle of up to four clear passes over
// the last two and a half years, so a cloud's edge, a snow day or a mowing isn't taken for the
// ground. Brush shows green where the lawn browns and greens late and bare woods stay grey.
import type { GeoBounds } from "./core";
import type { Seasons } from "../undergrowth";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox";

type Pass = { id: string; date: string; cloud: number };

/** Which season a pass is in (by month; null: none of the three). */
const seasonOf = (date: string): "winter" | "spring" | "summer" | null => {
  const m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  return m === 12 || m === 1 || m === 2 ? "winter" : m === 4 && d <= 25 ? "spring" : m >= 6 && m <= 8 ? "summer" : null;
};

/** One pass's greenness over the site, as a picture (NaN where it has none). */
const greenness = async (b: GeoBounds, id: string, signal?: AbortSignal) => {
  const expr = encodeURIComponent("(B08-B04)/(B08+B04)");
  const url = `${DATA}/${b.west},${b.south},${b.east},${b.north}.png?collection=sentinel-2-l2a&item=${id}&expression=${expr}&rescale=-1,1&asset_as_band=true&max_size=512`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data, v = new Float32Array(c.width * c.height);
  for (let k = 0; k < v.length; k++) v[k] = px[k * 4 + 3] ? (px[k * 4] / 255) * 2 - 1 : NaN;
  return { w: c.width, h: c.height, v };
};

/** The middle of several pictures, spot by spot (all brought to the first one's size). */
const middle = (pics: { w: number; h: number; v: Float32Array }[], w: number, h: number) => {
  const out = new Float32Array(w * h).fill(NaN), vals: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    vals.length = 0;
    for (const p of pics) {
      const v = p.v[Math.min(p.h - 1, Math.floor(((j + 0.5) / h) * p.h)) * p.w + Math.min(p.w - 1, Math.floor(((i + 0.5) / w) * p.w))];
      if (!Number.isNaN(v)) vals.push(v);
    }
    if (vals.length) { vals.sort((a, b) => a - b); out[j * w + i] = vals[vals.length >> 1]; }
  }
  return out;
};

/** The site's seasons from space; null where Sentinel-2 can't be had (or has too few clear passes). */
export const seasonsFromSpace = async (b: GeoBounds, signal?: AbortSignal): Promise<Seasons | null> => {
  const now = new Date(), from = new Date(now.getTime() - 2.5 * 365 * 86400000);
  const res = await fetch(STAC, {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collections: ["sentinel-2-l2a"], bbox: [b.west, b.south, b.east, b.north], datetime: `${from.toISOString()}/${now.toISOString()}`, limit: 300, query: { "eo:cloud_cover": { lt: 15 } } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const found = ((await res.json()).features ?? []) as { id: string; properties: { datetime: string; "eo:cloud_cover": number } }[];
  const passes: Pass[] = found.map(f => ({ id: f.id, date: f.properties.datetime.slice(0, 10), cloud: f.properties["eo:cloud_cover"] }));
  // (each season's four clearest, one a day: the same pass is often in two of the satellite's tiles)
  const pick = (s: "winter" | "spring" | "summer") => {
    const days = new Set<string>();
    return passes.filter(p => seasonOf(p.date) === s).sort((a, c) => a.cloud - c.cloud).filter(p => !days.has(p.date) && days.add(p.date)).slice(0, 4);
  };
  const chosen = { winter: pick("winter"), spring: pick("spring"), summer: pick("summer") };
  if (!chosen.summer.length || !chosen.winter.length) return null;
  const get = async (list: Pass[]) => (await Promise.all(list.map(p => greenness(b, p.id, signal).catch(() => null)))).filter((x): x is NonNullable<typeof x> => !!x);
  const [winter, spring, summer] = await Promise.all([get(chosen.winter), get(chosen.spring), get(chosen.summer)]);
  if (!winter.length || !summer.length) return null;
  const { w, h } = summer[0];
  const winterM = middle(winter, w, h), summerM = middle(summer, w, h);
  return { w, h, winter: winterM, spring: spring.length ? middle(spring, w, h) : winterM, summer: summerM, dates: [...chosen.winter, ...chosen.spring, ...chosen.summer].map(p => p.date).sort() };
};
