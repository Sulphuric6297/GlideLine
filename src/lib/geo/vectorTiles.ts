// OpenStreetMap's paths, roads, water, woods, grass and buildings from OpenFreeMap's vector tiles
// (free, no key, served from a CDN), for when every Overpass server is busy. The tiles follow the
// OpenMapTiles schema; this reads them (Mapbox Vector Tile protobufs) without a library.
import type { ParkDetail, ParkKind } from "../../types";
import { anySignal, pointInLatLonPolygon, type GeoBounds } from "./core";
import { clipPathToRect, clipPolygonToRect } from "../geom";
import { osmAmenity, osmBuilding, type LatLon, type OsmFeature } from "./osm";
import { amenityOf, fieldKindOfTags } from "./parkKinds";

export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
/** The tiles' most detailed zoom (each about 2.4 km across at the equator). */
const ZOOM = 14;

// ---------------------------------------------------------------- protobuf reading

class Pbf {
  pos = 0;
  constructor(private buf: Uint8Array, readonly end = buf.length) {}
  varint(): number {
    let result = 0, shift = 0, b: number;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b >= 0x80 && shift < 70);
    return result;
  }
  /** Each field of a message: its number, wire type and where its bytes are. */
  *fields(): Generator<{ field: number; type: number }> {
    while (this.pos < this.end) {
      const tag = this.varint();
      yield { field: Math.floor(tag / 8), type: tag & 7 };
    }
  }
  bytes(): Pbf {
    const len = this.varint();
    const sub = new Pbf(this.buf, this.pos + len);
    sub.pos = this.pos;
    this.pos += len;
    return sub;
  }
  string(): string {
    const sub = this.bytes();
    return new TextDecoder().decode(this.buf.subarray(sub.pos, sub.end));
  }
  packed(): number[] {
    const sub = this.bytes(), out: number[] = [];
    while (sub.pos < sub.end) out.push(sub.varint());
    return out;
  }
  skip(type: number) {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) this.pos += this.varint();
    else if (type === 5) this.pos += 4;
  }
  float(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return v;
  }
  double(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }
}

const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

export type TileFeature = { type: 1 | 2 | 3; tags: Record<string, string | number | boolean>; rings: { x: number; y: number }[][] };
export type TileLayer = { name: string; extent: number; features: TileFeature[] };

/** The layers of a vector tile: each feature's tags and its geometry (tile units, 0..extent). */
export const decodeMvt = (data: Uint8Array): TileLayer[] => {
  const tile = new Pbf(data);
  const layers: TileLayer[] = [];
  for (const { field, type } of tile.fields()) {
    if (field !== 3 || type !== 2) { tile.skip(type); continue; }
    const l = tile.bytes();
    const keys: string[] = [], values: (string | number | boolean)[] = [];
    const raw: { tags: number[]; type: number; geom: number[] }[] = [];
    let name = "", extent = 4096;
    for (const f of l.fields()) {
      if (f.field === 1) name = l.string();
      else if (f.field === 3) keys.push(l.string());
      else if (f.field === 5) extent = l.varint();
      else if (f.field === 4) {
        const v = l.bytes();
        let value: string | number | boolean = "";
        for (const g of v.fields()) {
          if (g.field === 1) value = v.string();
          else if (g.field === 2) value = v.float();
          else if (g.field === 3) value = v.double();
          else if (g.field === 4 || g.field === 5) value = v.varint();
          else if (g.field === 6) value = zigzag(v.varint());
          else if (g.field === 7) value = v.varint() !== 0;
          else v.skip(g.type);
        }
        values.push(value);
      } else if (f.field === 2) {
        const fe = l.bytes();
        const feat = { tags: [] as number[], type: 0, geom: [] as number[] };
        for (const g of fe.fields()) {
          if (g.field === 2) feat.tags = fe.packed();
          else if (g.field === 3) feat.type = fe.varint();
          else if (g.field === 4) feat.geom = fe.packed();
          else fe.skip(g.type);
        }
        raw.push(feat);
      } else l.skip(f.type);
    }
    const features: TileFeature[] = [];
    for (const r of raw) {
      if (r.type < 1 || r.type > 3) continue;
      const tags: TileFeature["tags"] = {};
      for (let i = 0; i + 1 < r.tags.length; i += 2) tags[keys[r.tags[i]]] = values[r.tags[i + 1]];
      // Commands: move to (1), line to (2), close (7), each with a count; then zigzag deltas
      const rings: { x: number; y: number }[][] = [];
      let x = 0, y = 0, cur: { x: number; y: number }[] = [];
      for (let i = 0; i < r.geom.length; ) {
        const cmd = r.geom[i] & 7, count = r.geom[i] >> 3;
        i++;
        if (cmd === 7) { if (cur.length) cur.push({ ...cur[0] }); continue; }
        for (let k = 0; k < count && i + 1 < r.geom.length + 1; k++) {
          x += zigzag(r.geom[i++]);
          y += zigzag(r.geom[i++]);
          if (cmd === 1) {
            if (cur.length) rings.push(cur);
            cur = [{ x, y }];
          } else cur.push({ x, y });
        }
      }
      if (cur.length) rings.push(cur);
      features.push({ type: r.type as 1 | 2 | 3, tags, rings });
    }
    layers.push({ name, extent, features });
  }
  return layers;
};

// ---------------------------------------------------------------- tiles to course features

/** Signed area of a ring in tile units: an outer ring of a polygon is positive (clockwise on screen). */
const ringArea = (r: { x: number; y: number }[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x - r[i].x) * (r[j].y + r[i].y);
  return a / 2;
};

const ROAD_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "busway"]);
const STREAM_CLASSES = new Set(["stream", "river", "canal", "drain", "ditch"]);
const GRASS_CLASSES = new Set(["grass"]);
/** A park's things in the tiles (the landuse layer's classes, the poi layer's subclasses). */
const TILE_PARKS = new Set(["pitch", "playground", "track", "dog_park", "sports_centre", "swimming_pool", "skatepark", "water_park"]);
/** What a park's thing in the tiles is (its sport, where the tile says). */
const tilePark = (cls: string, tags: TileFeature["tags"]): ParkDetail => {
  const sport = typeof tags.sport === "string" && tags.sport ? tags.sport : undefined;
  const what = (cls === "swimming_pool" ? "pool" : cls === "water_park" ? "splash_pad" : TILE_PARKS.has(cls) ? cls : "pitch") as ParkKind;
  return { what, ...(sport ? { sport } : {}) };
};
/** A park's thing in the tiles as OpenStreetMap tags (what the tiles carry of them: its class, its
 * sport), for the fields worked out from tags. */
const tileTags = (cls: string, tags: TileFeature["tags"]): Record<string, string> => ({
  leisure: cls,
  ...(typeof tags.sport === "string" && tags.sport ? { sport: tags.sport } : {}),
  ...(typeof tags.name === "string" ? { name: tags.name } : {})
});

/** What a tile feature is for the course map (the OpenMapTiles schema), or null to leave it out. */
export const classifyTileFeature = (layer: string, f: TileFeature): { geom: "line" | "area"; kind: OsmFeature["kind"] } | null => {
  const cls = String(f.tags.class ?? ""), sub = String(f.tags.subclass ?? "");
  if (layer === "transportation" && f.type === 2) {
    // (not indoors or underground, nor a parking lot's aisles)
    if (f.tags.indoor === 1 || f.tags.indoor === true || f.tags.brunnel === "tunnel" || sub === "corridor" || sub === "platform" || f.tags.service === "parking_aisle" || f.tags.service === "drive_through") return null;
    if (cls === "path" || cls === "track") return { geom: "line", kind: "path" };
    if (ROAD_CLASSES.has(cls)) return { geom: "line", kind: "road" };
    return null;
  }
  if (layer === "waterway" && f.type === 2 && STREAM_CLASSES.has(cls)) return { geom: "line", kind: "stream" };
  // (a swimming pool's water: the pool, as a park's field)
  if (layer === "water" && f.type === 3) return { geom: "area", kind: cls === "swimming_pool" ? "field" : "water" };
  if (layer === "landcover" && f.type === 3) {
    if (cls === "wood") return { geom: "area", kind: "woods" };
    if (GRASS_CLASSES.has(cls) && sub !== "park") return { geom: "area", kind: "rough" };
    if (cls === "sand") return { geom: "area", kind: "sand" };
    return null;
  }
  if (layer === "building" && f.type === 3) return { geom: "area", kind: "building" };
  // Ball fields, playgrounds and running tracks: out of play, as from Overpass (what each is kept)
  if (layer === "landuse" && f.type === 3 && TILE_PARKS.has(cls)) return { geom: "area", kind: fieldKindOfTags(tileTags(cls, f.tags)) ? "field" : "nogo" };
  return null;
};

/** The features of one tile (x, y at ZOOM), in latitude and longitude: cut to the tile itself (a
 * tile repeats a strip of its neighbours' past its edge, which would come in twice). */
export const tileFeatures = (layers: TileLayer[], tx: number, ty: number, z = ZOOM): OsmFeature[] => {
  const n = 2 ** z;
  const out: OsmFeature[] = [];
  for (const layer of layers) {
    const box = { x0: 0, y0: 0, x1: layer.extent, y1: layer.extent };
    const ll = (p: { x: number; y: number }): LatLon => {
      const px = tx + p.x / layer.extent, py = ty + p.y / layer.extent;
      return { lon: (px / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI };
    };
    for (const f of layer.features) {
      // Benches, toilets, drinking water and the rest on one spot (the tiles keep OpenStreetMap's own tag as the subclass)
      if (layer.name === "poi" && f.type === 1) {
        const sub = String(f.tags.subclass ?? ""), cls = String(f.tags.class ?? "");
        const amenity = osmAmenity({ amenity: sub, leisure: sub, man_made: sub }) ?? amenityOf({ amenity: sub, leisure: sub, man_made: sub, highway: sub, barrier: sub });
        const p = f.rings[0]?.[0];
        if (!p || p.x < 0 || p.y < 0 || p.x > layer.extent || p.y > layer.extent) continue;
        const name = typeof f.tags.name === "string" ? f.tags.name : undefined;
        if (amenity && (cls !== "parking" || sub === "parking")) out.push({ geom: "point", kind: "amenity", amenity, points: [ll(p)], name });
        else if (sub === "shelter") out.push({ geom: "point", kind: "shelter", points: [ll(p)], name });
        else if (TILE_PARKS.has(sub)) out.push({ geom: "point", kind: "park", points: [ll(p)], name, park: tilePark(sub, f.tags) });
        continue;
      }
      const what = classifyTileFeature(layer.name, f);
      if (!what) continue;
      const name = typeof f.tags.name === "string" ? f.tags.name : undefined;
      if (what.geom === "line") {
        for (const r of f.rings) for (const piece of clipPathToRect(r, box)) out.push({ geom: "line", kind: what.kind as "path", points: piece.map(ll), name });
      } else {
        // Outer rings; water's islands (the rings wound the other way that follow an outer one)
        // cut out of it, each joined to it by a cut of no width where they're nearest, so it's
        // still one outline. (Other kinds' holes are left: a wood's clearing shows by its trees.)
        for (let k = 0; k < f.rings.length; k++) {
          let r = f.rings[k];
          if (r.length < 4 || ringArea(r) <= 0) continue;
          if (what.kind === "water") {
            let ring = r.slice(0, -1);
            for (let h = k + 1; h < f.rings.length && ringArea(f.rings[h]) <= 0; h++) {
              const hole = f.rings[h].slice(0, -1);
              if (hole.length < 3) continue;
              let bi = 0, bj = 0, bd = Infinity;
              for (let i = 0; i < hole.length; i++) for (let j = 0; j < ring.length; j++) { const d = (hole[i].x - ring[j].x) ** 2 + (hole[i].y - ring[j].y) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } }
              ring = [...ring.slice(0, bj + 1), ...hole.slice(bi), ...hole.slice(0, bi + 1), ...ring.slice(bj)];
            }
            r = [...ring, ring[0]];
          }
          const inside = clipPolygonToRect(r.slice(0, -1), box);
          if (inside.length < 3) continue;
          const pts = inside.map(ll);
          if (what.kind === "building") {
            // (its height to the top of the roof, as OpenStreetMap's own)
            const h = Number(f.tags.render_height);
            out.push({ geom: "area", kind: "building", points: pts, name, building: { ...osmBuilding({}), topM: Number.isFinite(h) && h > 0 ? h : undefined } });
          } else out.push({ geom: "area", kind: what.kind as "water", points: pts, name, ...(what.kind === "nogo" || what.kind === "field" ? { park: tilePark(String(f.tags.class ?? ""), f.tags), tags: tileTags(String(f.tags.class ?? ""), f.tags) } : {}) });
        }
      }
    }
  }
  return out;
};

/** Lines cut at the tiles' edges joined back up: pieces of the same kind and name that end where
 * another starts (within about a metre). */
export const joinLines = (features: OsmFeature[]): OsmFeature[] => {
  const close = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
  const lines = features.filter(f => f.geom === "line").map(f => ({ ...f, points: [...f.points] }));
  // Each line's first and last points filed by kind, name and a 1e-5° grid cell (one pass, not a
  // scan of every pair after every join: a tile can hold thousands of pieces)
  const key = (f: OsmFeature, p: LatLon, dy = 0, dx = 0) => `${f.kind}|${f.name ?? ""}|${Math.round(p.lat / 1e-5) + dy}|${Math.round(p.lon / 1e-5) + dx}`;
  const starts = new Map<string, number[]>(), ends = new Map<string, number[]>();
  const file = (to: Map<string, number[]>, i: number, p: LatLon) => {
    const k = key(lines[i], p);
    const at = to.get(k);
    if (at) at.push(i); else to.set(k, [i]);
  };
  const first = (l: OsmFeature) => l.points[0], last = (l: OsmFeature) => l.points[l.points.length - 1];
  lines.forEach((l, i) => { file(starts, i, first(l)); file(ends, i, last(l)); });
  const gone = new Set<number>();
  // A piece starting (or else ending) where line i ends
  const next = (i: number) => {
    const a = lines[i], end = last(a);
    for (const [from, reversed] of [[starts, false], [ends, true]] as const) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const j of from.get(key(a, end, dy, dx)) ?? []) {
          const b = lines[j];
          if (j !== i && !gone.has(j) && b.kind === a.kind && b.name === a.name && close(end, reversed ? last(b) : first(b))) return { j, reversed };
        }
      }
    }
    return null;
  };
  lines.forEach((a, i) => {
    if (gone.has(i)) return;
    for (let n = next(i); n; n = next(i)) {
      const b = lines[n.j];
      a.points.push(...(n.reversed ? [...b.points].reverse() : b.points).slice(1));
      gone.add(n.j);
      file(ends, i, last(a));
    }
  });
  return [...features.filter(f => f.geom !== "line"), ...lines.filter((_, i) => !gone.has(i))];
};

/** A park's thing given both as an area and as a point (the tiles' points of interest repeat an
 * area's middle): the area only. */
export const withoutTwins = (features: OsmFeature[]): OsmFeature[] => {
  const areas = features.flatMap(f => (f.geom === "area" && f.kind !== "dgCourse" && f.park ? [{ what: f.park.what, points: f.points }] : []));
  return features.filter(f => f.kind !== "park" || !areas.some(a => a.what === f.park.what && pointInLatLonPolygon(f.points[0], a.points)));
};

/** The tiles (x, y at ZOOM) covering a box. */
export const tilesFor = (b: GeoBounds, z = ZOOM) => {
  const n = 2 ** z;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const out: { x: number; y: number }[] = [];
  for (let x = tx(b.west); x <= tx(b.east); x++) for (let y = ty(b.north); y <= ty(b.south); y++) out.push({ x, y });
  return out;
};

/** What OpenFreeMap's tiles hold for a box. Throws when they can't be reached. */
export const fetchTileFeatures = async (bounds: GeoBounds, timeoutMs = 20000, signal?: AbortSignal): Promise<OsmFeature[]> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const stop = anySignal(ctrl.signal, signal);
  try {
    const tj = await (await fetch(OPENFREEMAP_TILEJSON, { signal: stop })).json();
    const template = String(tj.tiles?.[0] ?? "");
    if (!template) throw new Error("OpenFreeMap has no tiles.");
    const tiles = tilesFor(bounds);
    if (tiles.length > 16) throw new Error("Too big an area for the map tiles.");
    // (all the tiles at once: they come from a CDN)
    const each = await Promise.all(tiles.map(async t => {
      const res = await fetch(template.replace("{z}", String(ZOOM)).replace("{x}", String(t.x)).replace("{y}", String(t.y)), { signal: stop });
      if (res.status === 204 || res.status === 404) return [];
      if (!res.ok) throw new Error(`OpenFreeMap ${res.status}`);
      return tileFeatures(decodeMvt(new Uint8Array(await res.arrayBuffer())), t.x, t.y);
    }));
    return withoutTwins(joinLines(each.flat()));
  } finally {
    clearTimeout(timer);
  }
};
