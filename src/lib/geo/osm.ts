// Paths, roads, streams, water, woods, grass, wetlands, parking, playgrounds, buildings and
// shelters from OpenStreetMap (free, no key), so the map shows what is around the holes and the
// safety checks know about it; and what stands about the park (benches, picnic tables, toilets,
// drinking water, trash cans, grills, gates, lights and poles, parking signs, single trees, tree
// rows, hedges, power lines, and its ball fields, courts and play areas as fields), and a disc golf
// course mapped there (its tees, baskets and holes).
import type { AmenityKind, ParkDetail, ParkKind, PathSurface } from "../../types";
import { abortError, anySignal, type GeoBounds } from "./core";
import { amenityOf, fieldKindOfTags, lineOf } from "./parkKinds";

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  // (the server once at overpass.kumi.systems)
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];
/** How long to wait for one Overpass server before trying the next (a busy one can take half a
 * minute to answer, or stall). */
export const OVERPASS_TIMEOUT_MS = 35000;

export type LatLon = { lat: number; lon: number };
/** A tree mapped on its own: its height and crown (m) and leaves, where mapped. */
export type OsmTree = { heightM?: number; crownM?: number; conifer?: boolean };
/** Each feature keeps its raw OpenStreetMap `tags` (the tiles': what they carry), for what's
 * worked out from them later (a field's kind, a power line's height). */
export type OsmFeature = (
  /** (`line`: a power line's or a hedge's height and a hedge's width, ft, where tagged) */
  | { geom: "line"; kind: "path" | "road" | "stream" | "fence" | "power" | "hedge"; points: LatLon[]; name?: string; surface?: PathSurface; widthM?: number; park?: ParkDetail; line?: { height?: number; width?: number } }
  /** A row of trees. */
  | { geom: "line"; kind: "treeRow"; points: LatLon[]; name?: string; tree?: OsmTree }
  /** A disc golf hole drawn from its tee to its basket (or a golf-style hole inside a disc golf course). */
  | { geom: "line"; kind: "dgHole"; points: LatLon[]; name?: string; ref?: string; par?: number; golf?: boolean }
  /** (`park`: what a park's thing is there, a ball field or a playground, whatever kind it's drawn
   * as; a field is one of the app's fields, its kind worked out from its tags and outline) */
  | { geom: "area"; kind: "water" | "parking" | "building" | "nogo" | "woods" | "sand" | "rough" | "shelter" | "field"; points: LatLon[]; name?: string; building?: OsmBuilding; park?: ParkDetail }
  /** A park's thing mapped on one spot that the app has nothing to draw as (a ball field or a
   * flagpole mapped as a point): kept, and counted. */
  | { geom: "point"; kind: "park"; points: [LatLon]; name?: string; park: ParkDetail }
  /** A disc golf course's outline. */
  | { geom: "area"; kind: "dgCourse"; points: LatLon[]; name?: string }
  /** Something standing on one spot (`points` holds that one spot). */
  | { geom: "point"; kind: "amenity"; amenity: AmenityKind; points: [LatLon]; name?: string }
  | { geom: "point"; kind: "tree"; points: [LatLon]; tree: OsmTree; name?: string }
  | { geom: "point"; kind: "shelter"; points: [LatLon]; name?: string; small?: boolean }
  /** A disc golf tee or basket (`golf`: mapped as a golf tee or pin, so only inside a disc golf course). */
  | { geom: "point"; kind: "dgTee" | "dgBasket"; points: [LatLon]; ref?: string; name?: string; golf?: boolean }
  /** A spot marked as a disc golf course ("Disc golf hole 3"): a hole somewhere near, with no tee or basket said. */
  | { geom: "point"; kind: "dgHint"; points: [LatLon]; name?: string }
) & { tags?: Record<string, string> };

/** What OpenStreetMap says about a building's shape: its height to the top of the roof and the
 * roof's own height (m, where mapped), its walls' height from its floors (m), and its roof. */
export type OsmBuilding = { topM?: number; roofM?: number; heightM?: number; roof?: "gable" | "hip" | "flat" | "shed" | "pyramid" };

const ROOF_SHAPES: Record<string, OsmBuilding["roof"]> = { gabled: "gable", hipped: "hip", half_hipped: "hip", flat: "flat", skillion: "shed", lean_to: "shed", pyramidal: "pyramid", dome: "pyramid", onion: "pyramid" };

/** A length tag in meters ("12", "12 m", "40 ft", "40'"), or undefined. */
export const osmMeters = (v?: string) => {
  if (!v) return undefined;
  const n = parseFloat(v.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return /ft|'|feet/i.test(v) ? n * 0.3048 : n;
};

/** A building's heights and roof from its tags, where mapped: `height` is to the top of the roof
 * (the walls are that less the roof); floors (3 m each) give the walls only where it has none. */
export const osmBuilding = (tags: Record<string, string>): OsmBuilding => {
  const levels = parseFloat(tags["building:levels"] ?? "");
  return {
    topM: osmMeters(tags["building:height"] ?? tags.height),
    roofM: osmMeters(tags["roof:height"]),
    heightM: Number.isFinite(levels) && levels > 0 ? levels * 3 : undefined,
    roof: ROOF_SHAPES[tags["roof:shape"] ?? ""] ?? undefined
  };
};

/** What a path is made of, from its `surface` tag (unset where it isn't mapped or doesn't fit one). */
export const osmSurface = (surface?: string): PathSurface | undefined => {
  if (!surface) return undefined;
  if (/^(asphalt|concrete|paved|paving_stones|sett|concrete:plates|concrete:lanes|bricks|metal|wood)$/.test(surface)) return "paved";
  if (/^(gravel|fine_gravel|compacted|pebblestone|unhewn_cobblestone|rock)$/.test(surface)) return "gravel";
  if (/^(woodchips|bark)$/.test(surface)) return "woodchips";
  if (/^(grass|grass_paver)$/.test(surface)) return "grass";
  if (/^(dirt|ground|earth|mud|sand|unpaved)$/.test(surface)) return "dirt";
  return undefined;
};

/** A tree's height, crown and leaves from its tags. */
const osmTree = (tags: Record<string, string>): OsmTree => ({
  heightM: osmMeters(tags.height),
  crownM: osmMeters(tags.diameter_crown),
  conifer: tags.leaf_type === "needleleaved" ? true : tags.leaf_type === "broadleaved" ? false : undefined
});

/** Things on one spot the app has an amenity for (benches, picnic tables, toilets, drinking water,
 * trash cans, parking signs, a practice basket). BBQs, gates and fitness stations have none. */
export const osmAmenity = (tags: Record<string, string>): AmenityKind | null => {
  if (tags.amenity === "bench" || tags.leisure === "bench") return "bench";
  if (tags.leisure === "picnic_table" || tags.amenity === "picnic_table") return "picnic";
  if (tags.amenity === "toilets") return "restroom";
  if (tags.amenity === "drinking_water" || tags.man_made === "drinking_fountain") return "water";
  if (tags.amenity === "waste_basket") return "trash";
  if (tags.amenity === "parking") return "parking";
  if (tags.disc_golf === "practice_basket") return "practice";
  return null;
};

/** Sports played on courts (a pitch for them is a court). */
const COURTS = /^(tennis|basketball|pickleball|volleyball|beachvolleyball|padel|handball|netball|racquet|squash|badminton|shuffleboard|bocce|boules)$/;

/** What a park's thing is, from its tags (a ball field, a playground, a pool, a dog park, a
 * splash pad, a flagpole…), with its sport and surface where mapped; or undefined. A ball field's
 * infield (or outfield) mapped as its own area is told apart. */
export const parkDetail = (tags: Record<string, string>): ParkDetail | undefined => {
  const sport = tags.sport?.split(";")[0] || undefined;
  const surface = tags.surface || undefined;
  const of = (what: ParkKind): ParkDetail => ({ what, ...(sport ? { sport } : {}), ...(surface ? { surface } : {}) });
  const l = tags.leisure;
  if (l === "pitch") {
    const part = tags.pitch ?? tags.baseball ?? tags.softball;
    if (part === "infield" || part === "outfield") return of(part);
    // (a ball field's dirt infield mapped by itself, inside the field)
    if (/^(baseball|softball)$/.test(sport ?? "") && /^(dirt|clay|sand|earth|ground|fine_gravel)$/.test(surface ?? "")) return of("infield");
    return of(COURTS.test(sport ?? "") ? "court" : "pitch");
  }
  if (l === "playground" || l === "garden" || l === "dog_park" || l === "sports_centre" || l === "track" || l === "splash_pad") return of(l);
  if (l === "swimming_pool" || tags.amenity === "swimming_pool") return of("pool");
  if (l === "skatepark") return of("skatepark");
  if (tags.amenity === "fountain") return of(tags.fountain === "splash_pad" ? "splash_pad" : "fountain");
  if (tags.man_made === "water_tower") return of("water_tower");
  if (tags.man_made === "flagpole") return of("flagpole");
  if (tags.man_made === "goal" || tags.leisure === "goal") return of("goal");
  if (tags.barrier === "backstop" || tags.man_made === "backstop") return of("backstop");
  if (tags.building === "shed") return of("shed");
  return undefined;
};

/** A park's thing in words, one and many ("ball field", "tennis courts"). */
export const parkWords = (p: ParkDetail): [string, string] => {
  const sport = p.sport ?? "";
  const one =
    p.what === "pitch" ? (/^(baseball|softball)$/.test(sport) ? "ball field" : sport === "soccer" ? "soccer field" : sport === "american_football" ? "football field" : sport === "rugby" || sport === "rugby_union" ? "rugby field" : sport === "cricket" ? "cricket field" : sport === "golf" ? "golf green" : "sports field") :
    p.what === "court" ? `${sport === "beachvolleyball" ? "beach volleyball" : sport || "sports"} court` :
    ({ playground: "playground", pool: "pool", dog_park: "dog park", garden: "garden", sports_centre: "sports center", track: "track", skatepark: "skate park", fountain: "fountain", splash_pad: "splash pad", water_tower: "water tower", shed: "shed", flagpole: "flagpole", goal: "goal", backstop: "backstop", infield: "infield", outfield: "outfield" } as Record<string, string>)[p.what] ?? p.what;
  return [one, `${one}s`];
};

const PATHS = new Set(["footway", "path", "track", "cycleway", "bridleway", "steps", "pedestrian"]);
const ROADS = new Set(["residential", "service", "unclassified", "tertiary", "secondary", "primary", "trunk", "motorway", "living_street", "road", "tertiary_link", "secondary_link", "primary_link", "trunk_link", "motorway_link"]);
const GRASS_NATURAL = new Set(["grassland", "scrub", "heath"]);
const GRASS_LANDUSE = new Set(["meadow", "grass", "village_green"]);
const STREAMS = new Set(["stream", "river", "brook", "ditch", "canal", "drain", "tidal_channel"]);

/** Ways that aren't walked or driven across the ground there: road crossings and sidewalks
 * (drawn as part of the road), squares mapped as areas, ways indoors or underground, and the aisles
 * of a parking lot (the lot itself comes in). */
const notOnTheGround = (tags: Record<string, string>) =>
  ["crossing", "sidewalk", "traffic_island", "access_aisle"].some(v => tags.footway === v || tags.cycleway === v || tags.path === v) ||
  tags.area === "yes" || tags.indoor === "yes" || tags.indoor === "corridor" || tags.location === "underground" ||
  (!!tags.tunnel && tags.tunnel !== "no" && !tags.waterway) ||
  tags.service === "parking_aisle" || tags.service === "drive-through";

/** What an OSM way is, for the course map (or null to skip it). */
export const classifyOsm = (tags: Record<string, string>, closed: boolean): { geom: "line" | "area"; kind: OsmFeature["kind"] } | null => {
  if (tags.leisure === "disc_golf_course") return closed ? { geom: "area", kind: "dgCourse" } : null;
  if (tags.disc_golf === "hole") return { geom: "line", kind: "dgHole" };
  if (tags.golf === "hole") return { geom: "line", kind: "dgHole" };
  if (tags.highway && notOnTheGround(tags)) return null;
  // (a pool is a pool, whatever water it's also tagged as)
  if (closed && (tags.leisure === "swimming_pool" || tags.amenity === "swimming_pool" || tags.water === "pool") && fieldKindOfTags(tags)) return { geom: "area", kind: "field" };
  if (closed && (tags.natural === "water" || tags.landuse === "reservoir" || tags.landuse === "basin" || tags.water || tags.waterway === "riverbank")) return { geom: "area", kind: "water" };
  if (closed && tags.amenity === "parking") return { geom: "area", kind: "parking" };
  // (a picnic shelter is often mapped as a roof: a shelter, open at the sides)
  if (closed && tags.amenity === "shelter") return { geom: "area", kind: "shelter" };
  if (closed && (tags.building || tags.man_made === "water_tower")) return { geom: "area", kind: "building" };
  // A ball field's dirt infield, mapped by itself: dirt (inside the field, out of play as a whole)
  if (closed && parkDetail(tags)?.what === "infield" && /^(dirt|clay|sand|earth|ground|fine_gravel)$/.test(tags.surface ?? "")) return { geom: "area", kind: "sand" };
  // (a decorative fountain's basin is water)
  if (closed && tags.amenity === "fountain" && tags.fountain !== "splash_pad") return { geom: "area", kind: "water" };
  // Ball fields, courts, playgrounds, pools, dog parks, tracks, skate parks, gardens and splash
  // pads: the app's fields (what each is from its tags and outline, in osmFeatureItems)
  if (closed && fieldKindOfTags(tags)) return { geom: "area", kind: "field" };
  // (the rest of them, a back yard's pool or a sports centre's grounds, and homes: out of play)
  if (closed && (/^(playground|pitch|swimming_pool|garden|dog_park|sports_centre|track|skatepark|splash_pad|water_park)$/.test(tags.leisure ?? "") || tags.amenity === "fountain" || tags.landuse === "residential")) return { geom: "area", kind: "nogo" };
  if (closed && (tags.natural === "wood" || tags.landuse === "forest")) return { geom: "area", kind: "woods" };
  if (closed && (tags.natural === "sand" || tags.natural === "beach" || tags.golf === "bunker")) return { geom: "area", kind: "sand" };
  // Wetlands: a swamp is woods standing in water; a marsh, a wet meadow or reeds is tall grass
  if (closed && tags.natural === "wetland") return { geom: "area", kind: tags.wetland === "swamp" || tags.wetland === "mangrove" ? "woods" : "rough" };
  // Meadows, grassland, scrub and lawns: grass areas (rough)
  if (closed && (GRASS_NATURAL.has(tags.natural ?? "") || GRASS_LANDUSE.has(tags.landuse ?? ""))) return { geom: "area", kind: "rough" };
  if (tags.waterway && STREAMS.has(tags.waterway)) return { geom: "line", kind: "stream" };
  if (tags.highway && PATHS.has(tags.highway)) return { geom: "line", kind: "path" };
  if (tags.highway && ROADS.has(tags.highway)) return { geom: "line", kind: "road" };
  if (tags.barrier === "fence" || tags.barrier === "wall" || tags.barrier === "backstop" || tags.man_made === "backstop") return { geom: "line", kind: "fence" };
  // Power lines and hedges: lines of their own (overhead wires; a band of bushes)
  const lo = lineOf(tags);
  if (lo) return { geom: "line", kind: lo.kind as "power" | "hedge" };
  if (tags.natural === "tree_row") return { geom: "line", kind: "treeRow" };
  return null;
};

/** What an OSM node is, for the course map (or null to skip it). */
export const classifyOsmNode = (tags: Record<string, string>, at: LatLon): OsmFeature | null => {
  const name = tags.name;
  if (tags.disc_golf === "tee" || tags.golf === "tee") return { geom: "point", kind: "dgTee", points: [at], ref: tags.ref, name, ...(tags.disc_golf !== "tee" ? { golf: true } : {}) };
  if (tags.disc_golf === "basket" || tags.golf === "pin") return { geom: "point", kind: "dgBasket", points: [at], ref: tags.ref, name, ...(tags.disc_golf !== "basket" ? { golf: true } : {}) };
  if (tags.leisure === "disc_golf_course") return { geom: "point", kind: "dgHint", points: [at], name };
  if (tags.natural === "tree") return { geom: "point", kind: "tree", points: [at], tree: osmTree(tags) };
  if (tags.amenity === "shelter") return { geom: "point", kind: "shelter", points: [at], name, small: tags.shelter_type === "public_transport" || tags.shelter_type === "lean_to" };
  // (the older amenities, then the newer: grills, fitness stations, flagpoles, lights, poles, bike racks, fountains, gates)
  const amenity = osmAmenity(tags) ?? amenityOf(tags);
  if (amenity) return { geom: "point", kind: "amenity", amenity, points: [at], name };
  const park = parkDetail(tags);
  return park ? { geom: "point", kind: "park", points: [at], name, park } : null;
};

type OsmMember = { type: string; role?: string; geometry?: (LatLon | null)[] };

/**
 * A multipolygon's outer rings, joined from its member ways (they meet end to end, either way
 * round). Lakes and wide rivers are mapped like this, in pieces; `inner`: its islands instead.
 */
export const outerRings = (members: OsmMember[], inner = false): LatLon[][] => {
  const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;
  const parts = members
    .filter(m => m.type === "way" && (m.role === "inner") === inner && Array.isArray(m.geometry))
    .map(m => m.geometry!.filter((g): g is LatLon => !!g).map(g => ({ lat: g.lat, lon: g.lon })))
    .filter(p => p.length >= 2);
  const rings: LatLon[][] = [];
  while (parts.length) {
    let ring = parts.shift()!;
    for (let grew = true; grew && !same(ring[0], ring[ring.length - 1]); ) {
      grew = false;
      const end = ring[ring.length - 1];
      const i = parts.findIndex(p => same(p[0], end) || same(p[p.length - 1], end));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(same(p[0], end) ? p.slice(1) : p.slice(0, -1).reverse());
      grew = true;
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring.slice(0, -1));
  }
  return rings;
};

/**
 * An outline with its islands cut out of it, still one ring: each island joined to the outline by
 * a cut of no width where they're nearest (the ring goes in along it, round the island and back
 * out), so water with an island in it is drawn, measured and stood on as it is.
 */
export const withIslands = (outer: LatLon[], islands: LatLon[][]): LatLon[] => {
  const inside = (p: LatLon, ring: LatLon[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) c = !c; } return c; };
  let ring = outer;
  for (const hole of islands) {
    if (hole.length < 3 || !inside(hole[0], outer)) continue;
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < hole.length; i++) for (let j = 0; j < ring.length; j++) { const d = (hole[i].lat - ring[j].lat) ** 2 + ((hole[i].lon - ring[j].lon) * Math.cos((hole[i].lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; bi = i; bj = j; } }
    ring = [...ring.slice(0, bj + 1), ...hole.slice(bi), ...hole.slice(0, bi + 1), ...ring.slice(bj)];
  }
  return ring;
};

/** What an Overpass answer holds for the course map: its nodes, its ways, and its multipolygons' outlines. */
export const osmFeaturesFrom = (json: { elements?: any[] }): OsmFeature[] => {
  const out: OsmFeature[] = [];
  for (const el of json.elements ?? []) {
    const tags: Record<string, string> = el.tags ?? {};
    // (what a park's thing is, kept whatever it's drawn as)
    const park = el.type === "node" ? undefined : parkDetail(tags);
    if (el.type === "node") {
      if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
      const f = classifyOsmNode(tags, { lat: el.lat, lon: el.lon });
      if (f) out.push({ ...f, tags });
    } else if (el.type === "way") {
      if (!Array.isArray(el.geometry)) continue;
      const pts: LatLon[] = el.geometry.filter(Boolean).map((g: LatLon) => ({ lat: g.lat, lon: g.lon }));
      if (pts.length < 2) continue;
      const closed = pts.length >= 4 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon;
      const what = classifyOsm(tags, closed);
      if (!what) continue;
      const name = tags.name;
      if (what.geom === "area") out.push({ geom: "area", kind: what.kind as any, points: pts.slice(0, -1), name, tags, ...(what.kind === "building" || what.kind === "shelter" ? { building: osmBuilding(tags) } : {}), ...(park ? { park } : {}) });
      else if (what.kind === "dgHole") {
        const par = parseInt(tags.par ?? "", 10);
        out.push({ geom: "line", kind: "dgHole", points: pts, name, tags, ref: tags.ref, ...(par > 0 ? { par } : {}), ...(tags.golf === "hole" && tags.disc_golf !== "hole" ? { golf: true } : {}) });
      } else if (what.kind === "treeRow") out.push({ geom: "line", kind: "treeRow", points: pts, name, tags, tree: osmTree(tags) });
      else if (what.kind === "power" || what.kind === "hedge") {
        const lo = lineOf(tags);
        out.push({ geom: "line", kind: what.kind, points: pts, name, tags, line: { ...(lo?.height ? { height: lo.height } : {}), ...(lo?.width ? { width: lo.width } : {}) } });
      } else if (what.kind === "path" || what.kind === "road") {
        const surface = what.kind === "path" ? osmSurface(tags.surface) : undefined;
        const widthM = osmMeters(tags.width) ?? (what.kind === "road" && parseInt(tags.lanes ?? "", 10) > 0 ? parseInt(tags.lanes, 10) * 3.3 : undefined);
        out.push({ geom: "line", kind: what.kind, points: pts, name, tags, ...(surface ? { surface } : {}), ...(widthM ? { widthM } : {}) });
      } else out.push({ geom: "line", kind: what.kind as any, points: pts, name, tags, ...(park ? { park } : {}) });
    } else if (el.type === "relation" && (tags.type === "multipolygon" || tags.leisure === "disc_golf_course")) {
      const what = classifyOsm(tags, true);
      if (what?.geom !== "area") continue;
      // (water's islands cut out of it; a wood's clearings are left to the trees measured there)
      const islands = what.kind === "water" ? outerRings(el.members ?? [], true) : [];
      for (const ring of outerRings(el.members ?? [])) out.push({ geom: "area", kind: what.kind as any, points: islands.length ? withIslands(ring, islands) : ring, name: tags.name, tags, ...(park ? { park } : {}) });
    }
  }
  return out;
};

/** The Overpass query for a box: nodes, ways, and the multipolygons that lakes, rivers and woods
 * are often mapped as. */
export const overpassQuery = (bounds: GeoBounds) => {
  const box = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east});`;
  const parks = "playground|pitch|swimming_pool|garden|dog_park|sports_centre|track|skatepark|splash_pad|water_park";
  const nodes = ['node["amenity"~"^(bench|picnic_table|toilets|drinking_water|waste_basket|parking|shelter|fountain|bbq|bicycle_parking)$"]', `node["leisure"~"^(picnic_table|bench|goal|fitness_station|firepit|${parks})$"]`, 'node["man_made"~"^(drinking_fountain|flagpole|water_tower|goal|backstop|utility_pole|street_lamp)$"]', 'node["highway"="street_lamp"]', 'node["power"="pole"]', 'node["barrier"~"^(gate|lift_gate|swing_gate|kissing_gate)$"]', 'node["natural"="tree"]', 'node["disc_golf"]', 'node["golf"~"^(tee|pin)$"]', 'node["leisure"="disc_golf_course"]'];
  const ways = ['way["highway"]', 'way["waterway"]', 'way["natural"~"^(water|wood|sand|beach|grassland|scrub|heath|wetland|tree_row)$"]', 'way["landuse"~"^(reservoir|basin|forest|meadow|grass|village_green)$"]', 'way["amenity"~"^(parking|shelter|fountain|swimming_pool)$"]', 'way["building"]', 'way["man_made"~"^(water_tower|backstop)$"]', `way["leisure"~"^(${parks}|disc_golf_course)$"]`, 'way["barrier"~"^(fence|wall|hedge|backstop)$"]', 'way["power"~"^(line|minor_line)$"]', 'way["disc_golf"]', 'way["golf"="hole"]'];
  const mp = 'relation["type"="multipolygon"]';
  const relations = [`${mp}["natural"~"^(water|wood|sand|beach|grassland|scrub|heath|wetland)$"]`, `${mp}["landuse"~"^(reservoir|basin|forest|meadow|grass)$"]`, `${mp}["waterway"="riverbank"]`, `${mp}["amenity"="parking"]`, `${mp}["leisure"~"^(${parks})$"]`, 'relation["leisure"="disc_golf_course"]'];
  return `[out:json][timeout:30];(${[...nodes, ...ways, ...relations].map(q => q + box).join("")});out geom;`;
};

/** One Overpass question, asked of every server at once: the first good answer wins and the others
 * are dropped (one at a time, a busy main server made imports wait a minute or more, or fail).
 * `onBusy` hears when a server has failed and others are still being asked. */
export const askOverpass = async (query: string, opts: { timeoutMs?: number; onBusy?: () => void; signal?: AbortSignal } = {}): Promise<any> => {
  const timeoutMs = opts.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  const stops = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const one = async (index: number) => {
    const timer = setTimeout(() => stops[index].abort(), timeoutMs);
    try {
      const res = await fetch(OVERPASS_ENDPOINTS[index], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: anySignal(stops[index].signal, opts.signal)
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      if (typeof json.remark === "string" && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
      return json;
    } finally {
      clearTimeout(timer);
    }
  };
  return new Promise<any>((resolve, reject) => {
    let left = OVERPASS_ENDPOINTS.length, firstError: unknown = null;
    opts.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    OVERPASS_ENDPOINTS.forEach((_, i) => {
      one(i).then(out => { stops.forEach(s => s.abort()); resolve(out); }, err => {
        firstError ??= err;
        if (--left === 0) reject(firstError instanceof Error ? firstError : new Error("OpenStreetMap lookup failed."));
        else opts.onBusy?.();
      });
    });
  });
};

/**
 * Paths, roads, water and the rest from OpenStreetMap, asking every server at once (the main one
 * is often busy). `onBusy` hears when one has failed and the others are still being asked.
 */
export const fetchOsmFeatures = async (bounds: GeoBounds, timeoutMs = OVERPASS_TIMEOUT_MS, onBusy?: () => void, signal?: AbortSignal): Promise<OsmFeature[]> =>
  osmFeaturesFrom(await askOverpass(overpassQuery(bounds), { timeoutMs, onBusy, signal }));

// ---------------------------------------------------------------- a disc golf course mapped there

/** Spots marked as a disc golf course and named for a hole ("Disc golf hole 3"): some courses are
 * mapped only like this. They can't say which end is the tee, so they make no holes; the import
 * says how many there are. */
export const holeHints = (features: OsmFeature[]) =>
  features.filter(f => f.kind === "dgHint" && /\bhole\s*#?\s*\d{1,2}\b/i.test(f.name ?? "")).length;

/** A hole of a disc golf course as mapped: its number (from its `ref`), par, tee, basket and the
 * bends between them; and every tee and pin position it has, the first of each being `tee` and
 * `basket` (`tag`: what tells it from the others, a letter, "long" or "short", a tee color). */
export type MappedHole = { ref?: string; number?: number; par?: number; tee: LatLon; basket: LatLon; doglegs: LatLon[]; tees?: MappedSpot[]; baskets?: MappedSpot[] };
export type MappedSpot = { at: LatLon; tag?: string };
export type MappedCourse = { name?: string; outline?: LatLon[]; holes: MappedHole[] };
type DgPoint = Extract<OsmFeature, { geom: "point"; kind: "dgTee" | "dgBasket" }>;

const metersApart = (a: LatLon, b: LatLon) => {
  const cos = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * cos);
};
const inRing = (p: LatLon, ring: LatLon[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
};

/**
 * The disc golf course mapped among these features, or null: its holes from the hole ways (tee at
 * the start, basket at the end; golf-style holes only inside a disc golf course's outline), and
 * from tees and baskets with the same number where a hole has no way. Numbered by each one's
 * `ref`, in order.
 */
export const mappedCourse = (features: OsmFeature[]): MappedCourse | null => {
  const outlines = features.filter(f => f.kind === "dgCourse");
  const inCourse = (p: LatLon) => outlines.some(o => inRing(p, o.points));
  const ways = features.filter((f): f is Extract<OsmFeature, { kind: "dgHole" }> => f.kind === "dgHole" && (!f.golf || inCourse(f.points[0])));
  const tees = features.filter((f): f is DgPoint => f.kind === "dgTee" && (!f.golf || inCourse(f.points[0])));
  const baskets = features.filter((f): f is DgPoint => f.kind === "dgBasket" && (!f.golf || inCourse(f.points[0])));
  const num = (ref?: string) => { const n = parseInt(ref ?? "", 10); return n > 0 && n < 100 ? n : undefined; };
  // (what tells a pin or a tee from the hole's others: 5A's letter, or long or short in its name)
  const tagOf = (f?: DgPoint) => f?.ref?.match(/^\s*\d{1,2}\s*([a-d])\s*$/i)?.[1].toUpperCase() ?? f?.name?.match(/\b(long|short|gold|blue|white|red|green|purple)\b/i)?.[1].toLowerCase();
  const spot = (f: DgPoint | null | undefined, at: LatLon): MappedSpot => ({ at, ...(tagOf(f ?? undefined) ? { tag: tagOf(f ?? undefined) } : {}) });
  const holes: MappedHole[] = [];
  const used = new Set<OsmFeature>();
  // The nearest mapped tee or basket to a hole way's end (within 15 m): the way may stop short
  const near = (list: DgPoint[], at: LatLon) => {
    let best: DgPoint | null = null, d = 15;
    for (const f of list) { const m = metersApart(f.points[0], at); if (m < d && !used.has(f)) { d = m; best = f; } }
    return best;
  };
  for (const w of ways) {
    if (w.points.length < 2) continue;
    const t = near(tees, w.points[0]), b = near(baskets, w.points[w.points.length - 1]);
    if (t) used.add(t);
    if (b) used.add(b);
    const ref = w.ref ?? t?.ref ?? b?.ref;
    const tee = t?.points[0] ?? w.points[0], basket = b?.points[0] ?? w.points[w.points.length - 1];
    holes.push({ ref, number: num(ref), par: w.par, tee, basket, doglegs: w.points.slice(1, -1), tees: [spot(t, tee)], baskets: [spot(b, basket)] });
  }
  // Tees and baskets with no hole way: paired by number (a tee 5 with a basket 5 or 5A)
  for (const t of tees) {
    const n = num(t.ref);
    if (used.has(t) || n === undefined || holes.some(h => h.number === n)) continue;
    const b = baskets.find(x => !used.has(x) && num(x.ref) === n);
    if (!b) continue;
    used.add(t);
    used.add(b);
    holes.push({ ref: t.ref, number: n, tee: t.points[0], basket: b.points[0], doglegs: [], tees: [spot(t, t.points[0])], baskets: [spot(b, b.points[0])] });
  }
  // A hole's other pin positions and tees: more baskets or tees with its number (5A and 5B, or
  // two baskets numbered 5)
  for (const h of holes) {
    if (h.number === undefined) continue;
    for (const [list, into] of [[baskets, h.baskets!], [tees, h.tees!]] as const) {
      for (const f of list) {
        if (used.has(f) || num(f.ref) !== h.number) continue;
        used.add(f);
        into.push(spot(f, f.points[0]));
      }
    }
  }
  // (a golf course's holes only make a disc golf course when one is mapped there)
  if (!holes.length && !outlines.length) return null;
  holes.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const main = outlines.slice().sort((a, b) => b.points.length - a.points.length)[0];
  return { name: main?.name, outline: main?.points, holes };
};
