// Buildings traced from aerial imagery, for the ones OpenStreetMap hasn't mapped: Overture Maps'
// buildings (Microsoft's and Google's footprints, Esri's community maps, OpenStreetMap), read
// straight from its tile file (PMTiles, any website may read it) a few tiles at a time. No library:
// the tile file's directory and the tiles themselves are small formats, read here.
//
// Data © OpenStreetMap contributors, Overture Maps Foundation, Microsoft, Esri, Google (ODbL).
import type { CourseItem, P, RoofKind, StructureItem } from "../../types";
import type { GeoBounds } from "./core";
import { roofHeights, type Measured } from "../lidar";
import { boundsOf, nearestOnSegment, pointInPolygon } from "../geom";
import { roofOf } from "../structures";

export type TracedBuilding = {
  /** Its outline (the outer ring), lat/lon. */
  points: { lat: number; lon: number }[];
  /** Its height, m, when known (often measured from the air). */
  heightM?: number;
  /** Who traced it ("Microsoft ML Buildings", "Esri Community Maps", ...), and how sure they are (0-1). */
  source: string;
  confidence: number | null;
  /** What Overture calls it (its class, as "house" or "garage", and subtype, as "residential"), where it says. */
  cls?: string;
  subtype?: string;
};

const CATALOG = "https://stac.overturemaps.org/catalog.json";
const FILE = (release: string) => `https://tiles.overturemaps.org/${release}/buildings.pmtiles`;
/** The zoom the buildings are kept at, whole (a tile ~2 km across at mid latitudes). */
const Z = 14;

// ---------------------------------------------------------------- reading bytes

/** Bytes `from` to `to` (inclusive) of the file. (Only a Range header: no preflight needed.) */
const range = async (url: string, from: number, to: number) => {
  // (a request that stalls gives up after 20 s, so the import never waits on it for ever)
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
const gunzip = async (b: Uint8Array) => new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
/** Decompressed as the file says it's compressed (1 none, 2 gzip). */
const inflate = (b: Uint8Array, how: number) => (how === 2 ? gunzip(b) : Promise.resolve(b));

/** A little-endian whole number of up to 53 bits at `at`. */
const u64 = (b: Uint8Array, at: number) => {
  let v = 0;
  for (let i = 7; i >= 0; i--) v = v * 256 + b[at + i];
  return v;
};

/** A reader of protobuf-style varints. */
class Bytes {
  pos = 0;
  constructor(public b: Uint8Array) {}
  varint() {
    let v = 0, shift = 1, byte: number;
    do { byte = this.b[this.pos++]; v += (byte & 0x7f) * shift; shift *= 128; } while (byte & 0x80);
    return v;
  }
  get done() { return this.pos >= this.b.length; }
}

// ---------------------------------------------------------------- the tile file's directory

type Header = { rootOffset: number; rootLength: number; leafOffset: number; tileOffset: number; internal: number; tiles: number };
type Entry = { id: number; offset: number; length: number; run: number };

const headerOf = (b: Uint8Array): Header => {
  if (String.fromCharCode(...b.slice(0, 7)) !== "PMTiles" || b[7] !== 3) throw new Error("not a PMTiles v3 file");
  return { rootOffset: u64(b, 8), rootLength: u64(b, 16), leafOffset: u64(b, 40), tileOffset: u64(b, 56), internal: b[97], tiles: b[98] };
};

const directory = (b: Uint8Array): Entry[] => {
  const r = new Bytes(b), n = r.varint(), out: Entry[] = [];
  let id = 0;
  for (let i = 0; i < n; i++) { id += r.varint(); out.push({ id, offset: 0, length: 0, run: 0 }); }
  for (let i = 0; i < n; i++) out[i].run = r.varint();
  for (let i = 0; i < n; i++) out[i].length = r.varint();
  for (let i = 0; i < n; i++) {
    const v = r.varint();
    out[i].offset = v === 0 && i > 0 ? out[i - 1].offset + out[i - 1].length : v - 1;
  }
  return out;
};

/** The entry for tile `id` (a tile, a run of the same tile, or a leaf directory to look in). */
const find = (dir: Entry[], id: number) => {
  let lo = 0, hi = dir.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (dir[m].id < id) lo = m + 1;
    else if (dir[m].id > id) hi = m - 1;
    else return dir[m];
  }
  if (hi >= 0) {
    const e = dir[hi];
    if (e.run === 0 || id - e.id < e.run) return e;
  }
  return null;
};

/** A tile's number along the Hilbert curve the file orders its tiles by (PMTiles' tile id). */
export const tileId = (z: number, x: number, y: number) => {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0, rx: number, ry: number;
  for (let s = n / 2; s >= 1; s /= 2) {
    rx = (x & s) > 0 ? 1 : 0;
    ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return acc + d;
};

// ---------------------------------------------------------------- a tile's buildings

type Value = string | number | boolean | null;
/** A vector tile's `building` layer: each building's properties and outer rings, in tile units. */
const buildingsInTile = (b: Uint8Array) => {
  const tile = new Bytes(b);
  const out: { props: Record<string, Value>; rings: [number, number][][]; extent: number }[] = [];
  while (!tile.done) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { skip(tile, tag & 7); continue; }
    const len = tile.varint(), layer = new Bytes(tile.b.subarray(tile.pos, tile.pos + len));
    tile.pos += len;
    let name = "", extent = 4096;
    const keys: string[] = [], values: Value[] = [], feats: Uint8Array[] = [];
    while (!layer.done) {
      const t = layer.varint(), f = t >> 3;
      if (f === 1) name = str(layer);
      else if (f === 2) feats.push(sub(layer));
      else if (f === 3) keys.push(str(layer));
      else if (f === 4) values.push(valueOf(sub(layer)));
      else if (f === 5) extent = layer.varint();
      else skip(layer, t & 7);
    }
    if (name !== "building") continue;
    for (const fb of feats) {
      const f = new Bytes(fb);
      let tags: number[] = [], geom: number[] = [], type = 0;
      while (!f.done) {
        const t = f.varint(), k = t >> 3;
        if (k === 2) tags = packed(f);
        else if (k === 3) type = f.varint();
        else if (k === 4) geom = packed(f);
        else skip(f, t & 7);
      }
      if (type !== 3) continue;
      const props: Record<string, Value> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      out.push({ props, rings: ringsOf(geom), extent });
    }
  }
  return out;
};
const sub = (r: Bytes) => { const len = r.varint(), s = r.b.subarray(r.pos, r.pos + len); r.pos += len; return s; };
const str = (r: Bytes) => new TextDecoder().decode(sub(r));
const packed = (r: Bytes) => { const s = new Bytes(sub(r)), out: number[] = []; while (!s.done) out.push(s.varint()); return out; };
const skip = (r: Bytes, wire: number) => {
  if (wire === 0) r.varint();
  else if (wire === 1) r.pos += 8;
  else if (wire === 2) { const len = r.varint(); r.pos += len; }
  else if (wire === 5) r.pos += 4;
};
const valueOf = (b: Uint8Array): Value => {
  const r = new Bytes(b);
  while (!r.done) {
    const t = r.varint(), f = t >> 3;
    if (f === 1) return str(r);
    if (f === 2) { const v = new DataView(b.buffer, b.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; return v; }
    if (f === 3) { const v = new DataView(b.buffer, b.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; return v; }
    if (f === 4 || f === 5) return r.varint();
    if (f === 6) { const v = r.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
    if (f === 7) return r.varint() !== 0;
    skip(r, t & 7);
  }
  return null;
};
/** A polygon's rings from its drawing commands (MoveTo, LineTo, ClosePath; zigzag deltas). */
const ringsOf = (g: number[]) => {
  const rings: [number, number][][] = [];
  let x = 0, y = 0, ring: [number, number][] = [], i = 0;
  const zz = (v: number) => ((v >>> 1) ^ -(v & 1));
  while (i < g.length) {
    const cmd = g[i] & 7, count = g[i] >> 3;
    i++;
    if (cmd === 7) { if (ring.length >= 3) rings.push(ring); ring = []; continue; }
    for (let k = 0; k < count; k++) {
      x += zz(g[i++]);
      y += zz(g[i++]);
      if (cmd === 1) { if (ring.length >= 3) rings.push(ring); ring = [[x, y]]; }
      else ring.push([x, y]);
    }
  }
  return rings;
};
/** Twice a ring's signed area (in tile units, y down: an outer ring's is positive). */
const signedArea = (r: [number, number][]) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
  return s;
};

// ---------------------------------------------------------------- the site's buildings

const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
const lonOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOf = (y: number, z: number) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

/** The buildings over a site that weren't mapped by OpenStreetMap, traced from imagery, each its
 * outline (outer ring), height when known, who traced it and how sure. */
export const tracedBuildings = async (bounds: GeoBounds): Promise<TracedBuilding[]> => (await allBuildings(bounds)).filter(b => b.source !== "OpenStreetMap");

// (the last few sites' lookups, shared: the import and the trees measured from the air ask at once)
const lookups = new Map<string, Promise<TracedBuilding[]>>();
/** Every building Overture has over a site: those traced from the air and OpenStreetMap's. Looked
 * up once a site, however many ask. */
export const allBuildings = (bounds: GeoBounds): Promise<TracedBuilding[]> => {
  const key = [bounds.north, bounds.south, bounds.west, bounds.east].map(v => v.toFixed(6)).join(",");
  let got = lookups.get(key);
  if (!got) {
    got = overtureBuildings(bounds);
    got.catch(() => lookups.delete(key));
    lookups.set(key, got);
    if (lookups.size > 3) lookups.delete(lookups.keys().next().value!);
  }
  return got;
};

const overtureBuildings = async (bounds: GeoBounds): Promise<TracedBuilding[]> => {
  const release = ((await (await fetch(CATALOG, { signal: AbortSignal.timeout(15000) })).json()) as { latest?: string }).latest;
  if (!release) throw new Error("no Overture release");
  const url = FILE(release);
  const head = await range(url, 0, 16383);
  const h = headerOf(head);
  const root = directory(await inflate(head.slice(h.rootOffset, h.rootOffset + h.rootLength), h.internal));
  const leaves = new Map<number, Entry[]>();
  const entryFor = async (id: number): Promise<Entry | null> => {
    let dir = root;
    for (let depth = 0; depth < 4; depth++) {
      const e = find(dir, id);
      if (!e) return null;
      if (e.run > 0) return e;
      // (a leaf directory: read it once)
      let leaf = leaves.get(e.offset);
      if (!leaf) {
        leaf = directory(await inflate(await range(url, h.leafOffset + e.offset, h.leafOffset + e.offset + e.length - 1), h.internal));
        leaves.set(e.offset, leaf);
      }
      dir = leaf;
    }
    return null;
  };
  const out: TracedBuilding[] = [];
  const seen = new Set<string>();
  for (let x = lonToX(bounds.west, Z); x <= lonToX(bounds.east, Z); x++) {
    for (let y = latToY(bounds.north, Z); y <= latToY(bounds.south, Z); y++) {
      const e = await entryFor(tileId(Z, x, y));
      if (!e) continue;
      const data = await inflate(await range(url, h.tileOffset + e.offset, h.tileOffset + e.offset + e.length - 1), h.tiles);
      for (const b of buildingsInTile(data)) {
        const source = String(b.props["@geometry_source"] ?? "");
        const id = String(b.props.id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const outer = b.rings.find(r => signedArea(r) > 0) ?? b.rings[0];
        if (!outer) continue;
        const points = outer.map(([px, py]) => ({ lon: lonOf(x + px / b.extent, Z), lat: latOf(y + py / b.extent, Z) }));
        if (!points.some(p => p.lat <= bounds.north && p.lat >= bounds.south && p.lon >= bounds.west && p.lon <= bounds.east)) continue;
        let confidence: number | null = null;
        try { const s = JSON.parse(String(b.props.sources ?? "[]")); confidence = typeof s[0]?.confidence === "number" ? s[0].confidence : null; } catch { /* (no sources given) */ }
        const height = typeof b.props.height === "number" ? b.props.height : undefined;
        out.push({ points, heightM: height, source, confidence, cls: typeof b.props.class === "string" ? b.props.class : undefined, subtype: typeof b.props.subtype === "string" ? b.props.subtype : undefined });
      }
    }
  }
  return out;
};

/** The roof the survey shows over a building's outline: the kind whose slopes fit its heights best
 * (flat, a single slope, a gable or a hip, its ridge along the building or across it), its pitch
 * (rise over run) and its eaves (ft over the ground). Each kind is fitted as eaves + pitch × how far
 * in from the walls a spot is; a tree or a chimney over the roof (the highest tenth that misses the
 * fit) left out. Null where the survey shows too little of the roof, or no kind fits it within 2 ft. */
/** Whether the survey's top at square (i, j) lies on a roof: it and the eight round it on one
 * plane within 9 in (a tree over it is lumps and gaps). */
const roofLikeAt = (m: Pick<Measured, "surface" | "snx" | "sny">, i: number, j: number) => {
  if (i < 1 || j < 1 || i >= m.snx - 1 || j >= m.sny - 1) return false;
  let sz = 0, sxz = 0, syz = 0;
  const zs: number[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const z = m.surface[(j + dj) * m.snx + i + di];
    if (!Number.isFinite(z)) return false;
    zs.push(z); sz += z; sxz += di * z; syz += dj * z;
  }
  const a = sxz / 6, b = syz / 6, c = sz / 9;
  let rss = 0, k = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const r = zs[k++] - (c + a * di + b * dj); rss += r * r; }
  return Math.sqrt(rss / 9) < 0.75;
};

export const roofShape = (m: Pick<Measured, "nx" | "ny" | "cell" | "ground" | "surface" | "snx" | "sny">, outline: P[]) => {
  if (outline.length < 3) return null;
  const sc = m.cell * 2, b = boundsOf(outline), pts: P[] = [], hs: number[] = [];
  let spots = 0;
  for (let j = Math.max(0, Math.floor(b.minY / sc)); j <= Math.min(m.sny - 1, Math.floor(b.maxY / sc)); j++)
    for (let i = Math.max(0, Math.floor(b.minX / sc)); i <= Math.min(m.snx - 1, Math.floor(b.maxX / sc)); i++) {
      const p = { x: (i + 0.5) * sc, y: (j + 0.5) * sc };
      if (!pointInPolygon(p, outline) || outline.some((q, k) => nearestOnSegment(p, q, outline[(k + 1) % outline.length]).distance < sc * 0.75)) continue;
      spots++;
      // (only where it's a roof: a tree standing over part of it isn't its height)
      if (!roofLikeAt(m, i, j)) continue;
      const top = m.surface[j * m.snx + i], gi = Math.min(m.nx - 1, i * 2), gj = Math.min(m.ny - 1, j * 2);
      if (Number.isFinite(top) && Number.isFinite(m.ground[gj * m.nx + gi])) { pts.push(p); hs.push(top - m.ground[gj * m.nx + gi]); }
    }
  // (a dozen spots at least, about 200 sq ft of roof, and the roof seen over most of it)
  if (hs.length < 12 || hs.length < spots * 0.4) return null;
  const n = hs.length;
  // h = e + k × run, least squares over the spots kept (k = 0: flat)
  const fit = (runs: number[] | null, keep: boolean[]) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let q = 0; q < n; q++) if (keep[q]) { const x = runs ? runs[q] : 0; sw++; sx += x; sy += hs[q]; sxx += x * x; sxy += x * hs[q]; }
    const den = sw * sxx - sx * sx;
    const k = runs && Math.abs(den) > 1e-6 ? (sw * sxy - sx * sy) / den : 0;
    const e = (sy - k * sx) / Math.max(1, sw);
    let rss = 0;
    for (let q = 0; q < n; q++) if (keep[q]) { const r = hs[q] - e - k * (runs ? runs[q] : 0); rss += r * r; }
    return { e, k, rss, m: sw };
  };
  const kinds: { kind: RoofKind; across: boolean }[] = [
    { kind: "flat", across: false }, { kind: "shed", across: false }, { kind: "gable", across: false },
    { kind: "gable", across: true }, { kind: "hip", across: false }
  ];
  let best: { kind: RoofKind; across: boolean; e: number; k: number; rms: number; score: number } | null = null;
  for (const c of kinds) {
    const runs = c.kind === "flat" ? null : (() => { const r = roofOf(outline, c.kind, 0, 1, Infinity, c.across); return pts.map(p => r.run(p)); })();
    let keep = hs.map(() => true);
    let f = fit(runs, keep);
    // (once more without the highest tenth above the fit: a tree's leaves, a chimney)
    const res = hs.map((h, q) => h - f.e - f.k * (runs ? runs[q] : 0));
    const cut = [...res].sort((x, y) => x - y)[Math.floor(n * 0.9)];
    keep = res.map(r => r < cut || r <= 0.5);
    f = fit(runs, keep);
    // (a slope that falls inward, or one steeper than 18 in 12, isn't a roof)
    if (runs && (f.k < 0.08 || f.k > 1.5)) continue;
    const rms = Math.sqrt(f.rss / Math.max(1, f.m));
    // (more slopes have to fit enough better to be worth it)
    const score = f.m * Math.log(Math.max(1e-4, f.rss / Math.max(1, f.m))) + (runs ? 2 : 1) * Math.log(f.m) * 2;
    if (!best || score < best.score) best = { kind: c.kind, across: c.across, e: f.e, k: f.k, rms, score };
  }
  if (!best || best.rms > 2 || best.e < 6) return null;
  return {
    kind: best.kind, across: best.across,
    // (to the nearest inch in 12)
    pitch: best.kind === "flat" ? undefined : Math.round(best.k * 12) / 12,
    eaves: Math.min(80, best.e)
  };
};

/** How much of an outline (moved by `dx`, `dy`) the survey shows standing 6 ft or more over the
 * ground: a share of its spots (4 ft apart). */
const raisedShare = (m: Pick<Measured, "nx" | "ny" | "cell" | "ground" | "surface" | "snx" | "sny">, outline: P[], dx = 0, dy = 0) => {
  const sc = m.cell * 2, b = boundsOf(outline);
  let n = 0, up = 0;
  for (let j = Math.max(0, Math.floor((b.minY + dy) / sc)); j <= Math.min(m.sny - 1, Math.floor((b.maxY + dy) / sc)); j++)
    for (let i = Math.max(0, Math.floor((b.minX + dx) / sc)); i <= Math.min(m.snx - 1, Math.floor((b.maxX + dx) / sc)); i++) {
      const p = { x: (i + 0.5) * sc - dx, y: (j + 0.5) * sc - dy };
      if (!pointInPolygon(p, outline)) continue;
      const top = m.surface[j * m.snx + i], gi = Math.min(m.nx - 1, i * 2), gj = Math.min(m.ny - 1, j * 2), gr = m.ground[gj * m.nx + gi];
      if (!Number.isFinite(top) || !Number.isFinite(gr)) continue;
      n++;
      if (top - gr > 6) up++;
    }
  return n ? up / n : null;
};

/**
 * Buildings on the maps checked against the survey as they're brought in: FEMA's or one traced from
 * the air where the survey shows flat ground (a slab, a deck, a pool: under a third of it standing
 * 6 ft or more) left out. OpenStreetMap's are kept, as drawn; the maps' outlines are kept as they are.
 */
export const withoutSlabs = (items: CourseItem[], m: Measured) => {
  let dropped = 0;
  const out = items.filter(i => {
    if (i.type !== "structure" || i.kind !== "building" || (i.importSource !== "traced" && i.importSource !== "fema")) return true;
    const share = raisedShare(m, i.points);
    if (share !== null && share < 0.33) { dropped++; return false; }
    return true;
  });
  return { items: out, dropped };
};

/**
 * The buildings that came in without a height (OpenStreetMap's and those traced from the air),
 * given the one the survey measured over their roofs: the walls up to the eaves, and a flat roof
 * where the roof is level. A height the map has is kept. A building the survey doesn't show (built
 * since it flew) stays as it came. `sign` is called on each one changed (the import's `signed`).
 */
export const withMeasuredHeights = (items: CourseItem[], m: Measured, sign: (i: StructureItem) => StructureItem = i => i): CourseItem[] =>
  items.map(i => {
    if (i.type !== "structure" || i.kind !== "building" || (i.importSource !== "osm" && i.importSource !== "traced" && i.importSource !== "fema" && i.importSource !== "lidar")) return i;
    // The roof's own shape where the survey shows it clearly: its kind (unless the map names one, or
    // it's been measured before), its pitch and the way its ridge runs, the walls up to its eaves
    const shape = roofShape(m, i.points);
    const reshape = shape && i.roofPitch === undefined && i.ridgeAcross === undefined && (!i.roof || i.importSource === "traced" || i.roof === shape.kind);
    if (shape && (reshape || i.height === undefined)) {
      const out: StructureItem = { ...i };
      if (i.height === undefined) out.height = Math.round(shape.eaves * 2) / 2;
      if (reshape) {
        out.roof = shape.kind;
        if (shape.pitch) out.roofPitch = shape.pitch;
        if (shape.across) out.ridgeAcross = true;
      }
      return sign(out);
    }
    if (i.height !== undefined) return i;
    // (no roof the survey can see: trees over it, or built since; the map's height or the usual)
    if (shape === null) return i;
    const r = roofHeights(m, i.points);
    if (!r) return i;
    const out: StructureItem = { ...i, height: Math.round(r.eaves * 2) / 2 };
    if (r.flat && !i.roof) out.roof = "flat";
    return sign(out);
  });

/**
 * The maps' buildings lined up with the survey, as 3D BAG and the research on it do, never reshaped:
 * the survey's roofs (6 ft or more up, on a plane, or sorted as a building's), one shift for the
 * whole site (up to 10 ft, 2 ft at a time) that lays all the outlines over them best, then each
 * building nudged (up to 4 ft) where that clearly fits it better. Nothing moves unless the survey
 * agrees by a clear margin. (Never to the photo: its roofs lean away from the camera.)
 */
export const alignedToSurvey = (items: CourseItem[], m: Measured) => {
  const sc = m.cell * 2;
  const roof = new Uint8Array(m.snx * m.sny);
  for (let j = 0; j < m.sny; j++) for (let i = 0; i < m.snx; i++) {
    const top = m.surface[j * m.snx + i], gi = Math.min(m.nx - 1, i * 2), gj = Math.min(m.ny - 1, j * 2), gr = m.ground[gj * m.nx + gi];
    if (!Number.isFinite(top) || !Number.isFinite(gr) || top - gr < 6) continue;
    if (m.bldg?.[gj * m.nx + gi] || roofLikeAt(m, i, j)) roof[j * m.snx + i] = 1;
  }
  const at = (x: number, y: number) => { const i = Math.floor(x / sc), j = Math.floor(y / sc); return i >= 0 && j >= 0 && i < m.snx && j < m.sny ? roof[j * m.snx + i] : 0; };
  // Each building's spots (2 ft apart)
  const mapped = items.map((i, k) => ({ i, k })).filter(({ i }) => i.type === "structure" && i.kind === "building" && (i.importSource === "osm" || i.importSource === "traced" || i.importSource === "fema")) as { i: StructureItem; k: number }[];
  const spots = mapped.map(({ i }) => {
    const b = boundsOf(i.points), out: P[] = [];
    for (let y = Math.ceil(b.minY / 2) * 2 + 1; y < b.maxY; y += 2) for (let x = Math.ceil(b.minX / 2) * 2 + 1; x < b.maxX; x += 2) if (pointInPolygon({ x, y }, i.points)) out.push({ x, y });
    return out;
  });
  const cover = (s: P[], dx: number, dy: number) => { let n = 0; for (const p of s) n += at(p.x + dx, p.y + dy); return s.length ? n / s.length : 0; };
  // One shift for the site: all the outlines over the roofs at once
  const total = (dx: number, dy: number) => { let n = 0, all = 0; for (const s of spots) { for (const p of s) n += at(p.x + dx, p.y + dy); all += s.length; } return all ? n / all : 0; };
  const was = total(0, 0);
  let site = { dx: 0, dy: 0, c: was };
  for (let dy = -10; dy <= 10; dy += 2) for (let dx = -10; dx <= 10; dx += 2) { const c = total(dx, dy); if (c > site.c + 1e-9) site = { dx, dy, c }; }
  if (site.c < was + 0.05) site = { dx: 0, dy: 0, c: was };
  // Then each one nudged, where it clearly fits better
  let moved = 0;
  const out = items.slice();
  mapped.forEach(({ i, k }, n) => {
    const s = spots[n];
    if (s.length < 6) return;
    let best = { dx: site.dx, dy: site.dy, c: cover(s, site.dx, site.dy) };
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const c = cover(s, site.dx + dx, site.dy + dy);
      if (c > best.c + 0.1) best = { dx: site.dx + dx, dy: site.dy + dy, c };
    }
    if (!best.dx && !best.dy) return;
    moved++;
    out[k] = { ...i, x: i.x + best.dx, y: i.y + best.dy, points: i.points.map(p => ({ x: p.x + best.dx, y: p.y + best.dy })) };
  });
  return { items: out, moved, site: { dx: site.dx, dy: site.dy } };
};
