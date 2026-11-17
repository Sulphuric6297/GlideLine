// Data exports: GPS files (GeoJSON, KML for Google Earth, GPX for a phone or GPS when staking out
// positions), the hole list as CSV, the stake-out list, and the parts list with a cost estimate.
import { AMENITY_KINDS, AREA_KINDS, FT_PER_M, LINE_KINDS, TEE_LEVELS, TEE_SURFACES } from "../constants";
import type { AmenityItem, AreaItem, BasketItem, CourseDoc, CourseItem, CourseRules, DropZoneItem, Hole, Layout, LineItem, MandoItem, P, TeeItem, TreeItem, Units } from "../types";
import { areaPath, belongsTo, fairwayOutline, holeBaskets, holeNumber, holeTees, linePath, obRanges } from "./course";
import { pathLength, pathTouchesPolygon, pointInPolygon, smoothPath } from "./geom";
import { bearing, compassPoint, geoRefOf, toLatLon, type GeoRef } from "./geoRef";
import { holeStats, isOb } from "./holeStats";
import { heightAt } from "./terrainGrid";
import { fmtDist, fmtElev } from "./units";

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A plan point as [lon, lat] (GeoJSON order). */
const ll = (ref: GeoRef, p: P) => { const g = toLatLon(ref, p); return [r6(g.lon), r6(g.lat)]; };

const needRef = (doc: CourseDoc) => {
  const ref = geoRefOf(doc);
  if (!ref) throw new Error("GPS files need a real site.");
  return ref;
};

const elevationFt = (doc: CourseDoc, p: P) => r1(heightAt(doc.terrainHeights, doc.gridSize, p.x, p.y) + doc.site.baseElevationFt);

type Feature = { type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };

/** A hole's tees, baskets and throw line (one per layout) as GeoJSON features. */
const holeFeatures = (doc: CourseDoc, ref: GeoRef, hole: Hole): Feature[] => {
  const features: Feature[] = [];
  const point = (p: P, props: Record<string, unknown>) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: ll(ref, p) }, properties: props });
  const num = holeNumber(doc, hole.id);
  for (const t of holeTees(doc, hole.id)) {
    point(t, { kind: "tee", hole: num, tee: TEE_LEVELS[t.level].label, pad_ft: `${t.padWidth}x${t.padLength}`, surface: TEE_SURFACES[t.surface].label, elevation_ft: elevationFt(doc, t) });
  }
  for (const b of holeBaskets(doc, hole.id)) point(b, { kind: "basket", hole: num, pin: b.position, ...(b.model ? { model: b.model } : {}), elevation_ft: elevationFt(doc, b) });
  // (a line for each layout, and one from each tee no layout plays, each with its own par)
  const played = new Set<string>();
  const plays = [...doc.layouts.map(l => ({ layout: l as Layout | null, l })), ...holeTees(doc, hole.id).map(t => ({ layout: null as Layout | null, l: { id: `tee-${t.id}`, name: "", tee: t.level, pin: doc.layouts[0]?.pin ?? "A" } as Layout }))];
  for (const { layout, l } of plays) {
    const s = holeStats(doc, hole, l);
    if (!s.complete || (!layout && played.has(s.teeId ?? ""))) continue;
    played.add(s.teeId ?? "");
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: s.line.map(p => ll(ref, p)) },
      properties: {
        kind: "hole", hole: num, name: hole.name ?? null, layout: layout?.name ?? null, tee: TEE_LEVELS[s.level].label, par: s.par,
        length_ft: Math.round(s.length), length_m: Math.round(s.length / FT_PER_M), elevation_change_ft: r1(s.elevationChange), plays_like_ft: Math.round(s.playsLike), notes: hole.notes ?? null,
        // OpenStreetMap tags for a disc golf hole
        disc_golf: "hole", ref: String(num), par_tag: String(s.par)
      }
    });
  }
  return features;
};

/** Mandos, drop zones, amenities, trees placed by hand, areas and lines as GeoJSON features. */
const itemFeature = (doc: CourseDoc, ref: GeoRef, i: CourseItem): Feature | null => {
  const point = (p: P, props: Record<string, unknown>): Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: ll(ref, p) }, properties: props });
  if (i.type === "mando") return point(i, { kind: "mando", hole: i.holeId ? holeNumber(doc, i.holeId) : null, pass: (i as MandoItem).side, direction_deg: Math.round(bearing(i, { x: i.x + Math.cos((i.rotation * Math.PI) / 180), y: i.y + Math.sin((i.rotation * Math.PI) / 180) })) });
  if (i.type === "dropzone") return point(i, { kind: "drop_zone", hole: (i as DropZoneItem).holeId ? holeNumber(doc, (i as DropZoneItem).holeId!) : null });
  if (i.type === "amenity") return point(i, { kind: (i as AmenityItem).kind, name: (i as AmenityItem).label ?? AMENITY_KINDS[(i as AmenityItem).kind].label });
  if (i.type === "tree" && !(i as TreeItem).importSource) return point(i, { kind: "tree", crown_radius_ft: Math.round((i as TreeItem).radius) });
  if (i.type === "area") {
    const a = i as AreaItem, pts = areaPath(a);
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]].map(p => ll(ref, p))] }, properties: { kind: a.kind, label: AREA_KINDS[a.kind].label, name: a.label ?? null, hole: a.holeId ? holeNumber(doc, a.holeId) : null } };
  }
  if (i.type === "line") {
    const l = i as LineItem;
    return { type: "Feature", geometry: { type: "LineString", coordinates: linePath(l).map(p => ll(ref, p)) }, properties: { kind: `${l.kind}_line`, label: LINE_KINDS[l.kind].label, name: l.label ?? null, hole: l.holeId ? holeNumber(doc, l.holeId) : null, ...(l.kind !== "ob" && l.ob === true ? { ob: l.obBeyond ? "and_beyond" : "yes", ...(l.obStretches?.length ? { ob_stretches: obRanges(l) } : {}) } : {}) } };
  }
  return null;
};

/** Everything with its real position, as a GeoJSON FeatureCollection. */
export const toGeoJSON = (doc: CourseDoc) => {
  const ref = needRef(doc);
  const features: Feature[] = doc.holes.flatMap(h => holeFeatures(doc, ref, h));
  for (const i of doc.items) {
    const f = itemFeature(doc, ref, i);
    if (f) features.push(f);
  }
  // (the layouts too, so the file brings them back in)
  const layouts = doc.layouts.map(l => ({ layout: l.name, tee: TEE_LEVELS[l.tee].label, pin: l.pin }));
  return JSON.stringify({ type: "FeatureCollection", name: doc.name, layouts, features }, null, 1);
};

/** One hole as GeoJSON: its tees, baskets and throw line, its mandos and drop zones, the shapes
 * that belong to it, and the course's OB, water and hazards that come into play on it (those are
 * marked `in_play`). */
export const holeGeoJSON = (doc: CourseDoc, holeId: string) => {
  const ref = needRef(doc);
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) throw new Error("That hole isn't in the course.");
  const s = holeStats(doc, hole);
  // In play: within the fairway and a little either side of it
  const zone = s.complete ? fairwayOutline(hole, smoothPath(s.line, 8), 40, 8) : [];
  const inPlay = (pts: P[], area: boolean) => zone.length > 2 && (pathTouchesPolygon(area ? [...pts, pts[0]] : pts, zone) || (area && zone.some(p => pointInPolygon(p, pts))));
  const features = holeFeatures(doc, ref, hole);
  for (const i of doc.items) {
    if (i.type === "tee" || i.type === "basket") continue;
    const own = belongsTo(i, holeId);
    const shared = !own && (i.type === "area" || i.type === "line") && !i.holeId && (isOb(i) || i.kind === "hazard") && inPlay(i.type === "area" ? areaPath(i) : linePath(i), i.type === "area");
    if (!own && !shared) continue;
    const f = itemFeature(doc, ref, i);
    if (f) features.push(shared ? { ...f, properties: { ...f.properties, in_play: true } } : f);
  }
  return JSON.stringify({ type: "FeatureCollection", name: `${doc.name} · Hole ${holeNumber(doc, holeId)}`, features }, null, 1);
};

const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** KML colors are aabbggrr. */
const kmlColor = (hex: string, alpha = "ff") => { const h = hex.replace("#", ""); return `${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };

/** Google Earth: a folder per hole (tees, baskets, the throw line, its rules), then the rest. */
export const toKML = (doc: CourseDoc) => {
  const ref = needRef(doc);
  const c = (p: P) => { const g = toLatLon(ref, p); return `${r6(g.lon)},${r6(g.lat)},0`; };
  const out: string[] = [];
  // (a tee in its level's color; a throw line per layout, named for it when there are several)
  const multi = doc.layouts.length > 1;
  const styles = [
    ...(Object.keys(TEE_LEVELS) as (keyof typeof TEE_LEVELS)[]).map(l => `<Style id="tee-${l}"><IconStyle><color>${kmlColor(TEE_LEVELS[l].color)}</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle></Style>`),
    `<Style id="basket"><IconStyle><color>${kmlColor(doc.style.basket)}</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>`,
    `<Style id="mando"><IconStyle><color>ff1673f9</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/arrow.png</href></Icon></IconStyle></Style>`,
    `<Style id="line"><LineStyle><color>ffffffff</color><width>3</width></LineStyle></Style>`,
    `<Style id="ob"><LineStyle><color>${kmlColor(doc.style.ob)}</color><width>3</width></LineStyle><PolyStyle><color>${kmlColor(doc.style.ob, "40")}</color></PolyStyle></Style>`,
    `<Style id="area"><LineStyle><color>ffcccccc</color><width>1.5</width></LineStyle><PolyStyle><color>40ffffff</color></PolyStyle></Style>`
  ];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(doc.name)}</name>${styles.join("")}`);
  for (const hole of doc.holes) {
    const num = holeNumber(doc, hole.id);
    const s = holeStats(doc, hole);
    out.push(`<Folder><name>Hole ${num}${hole.name ? ` · ${xml(hole.name)}` : ""}</name><description>${s.complete ? `Par ${s.par} · ${fmtDist(s.length, doc.units)} · ${fmtElev(s.elevationChange, doc.units)}` : "unfinished"}${hole.notes ? ` · ${xml(hole.notes)}` : ""}</description>`);
    for (const t of holeTees(doc, hole.id)) out.push(`<Placemark><name>${num} ${TEE_LEVELS[t.level].label} tee</name><styleUrl>#tee-${t.level}</styleUrl><Point><coordinates>${c(t)}</coordinates></Point></Placemark>`);
    for (const b of holeBaskets(doc, hole.id)) out.push(`<Placemark><name>${num} basket ${b.position}</name><styleUrl>#basket</styleUrl><Point><coordinates>${c(b)}</coordinates></Point></Placemark>`);
    for (const layout of doc.layouts) {
      const ls = holeStats(doc, hole, layout);
      if (ls.complete) out.push(`<Placemark><name>Hole ${num}${multi ? ` · ${xml(layout.name)}` : ""} throw line</name><styleUrl>#line</styleUrl><LineString><tessellate>1</tessellate><coordinates>${smoothPath(ls.line, 6).map(c).join(" ")}</coordinates></LineString></Placemark>`);
    }
    for (const i of doc.items) {
      if (i.type === "mando" && i.holeId === hole.id) out.push(`<Placemark><name>${num} mando (pass ${i.side})</name><styleUrl>#mando</styleUrl><Point><coordinates>${c(i)}</coordinates></Point></Placemark>`);
      if (i.type === "dropzone" && i.holeId === hole.id) out.push(`<Placemark><name>${num} drop zone</name><styleUrl>#mando</styleUrl><Point><coordinates>${c(i)}</coordinates></Point></Placemark>`);
    }
    out.push(`</Folder>`);
  }
  out.push(`<Folder><name>OB, hazards and land</name>`);
  for (const i of doc.items) {
    if (i.type === "area") out.push(`<Placemark><name>${xml(i.label ?? AREA_KINDS[i.kind].label)}</name><styleUrl>#${isOb(i) ? "ob" : "area"}</styleUrl><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${[...areaPath(i), areaPath(i)[0]].map(c).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
    if (i.type === "line") out.push(`<Placemark><name>${xml(i.label ?? LINE_KINDS[i.kind].label)}</name><styleUrl>#${isOb(i) ? "ob" : "line"}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${linePath(i).map(c).join(" ")}</coordinates></LineString></Placemark>`);
    if (i.type === "amenity") out.push(`<Placemark><name>${xml(i.label ?? AMENITY_KINDS[i.kind].label)}</name><Point><coordinates>${c(i)}</coordinates></Point></Placemark>`);
  }
  out.push(`</Folder></Document></kml>`);
  return out.join("\n");
};

/** GPX waypoints for every tee, basket, mando and drop zone (to find the spots with a phone), and
 * a route per hole. */
export const toGPX = (doc: CourseDoc) => {
  const ref = needRef(doc);
  const wpt = (p: P, name: string, sym: string, desc = "") => {
    const g = toLatLon(ref, p);
    return `<wpt lat="${r6(g.lat)}" lon="${r6(g.lon)}"><ele>${r1(elevationFt(doc, p) / FT_PER_M)}</ele><name>${xml(name)}</name>${desc ? `<desc>${xml(desc)}</desc>` : ""}<sym>${sym}</sym></wpt>`;
  };
  const out: string[] = [`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GlideLine Studio" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(doc.name)}</name></metadata>`];
  for (const hole of doc.holes) {
    const num = holeNumber(doc, hole.id);
    for (const t of holeTees(doc, hole.id)) out.push(wpt(t, `H${num} ${TEE_LEVELS[t.level].label} tee`, "Flag, Blue", `Pad ${t.padWidth} x ${t.padLength} ft, ${TEE_SURFACES[t.surface].label}`));
    for (const b of holeBaskets(doc, hole.id)) out.push(wpt(b, `H${num} basket ${b.position}`, "Flag, Red"));
  }
  for (const i of doc.items) {
    if (i.type === "mando") out.push(wpt(i, `${i.holeId ? `H${holeNumber(doc, i.holeId)} ` : ""}mando (pass ${i.side})`, "Navaid, Orange"));
    if (i.type === "dropzone") out.push(wpt(i, `${i.holeId ? `H${holeNumber(doc, i.holeId)} ` : ""}drop zone`, "Navaid, Orange"));
    if (i.type === "amenity") out.push(wpt(i, i.label ?? AMENITY_KINDS[i.kind].label, "Waypoint"));
  }
  // (a route per layout, named for it when there are several)
  for (const hole of doc.holes) {
    for (const layout of doc.layouts) {
      const s = holeStats(doc, hole, layout);
      if (!s.complete) continue;
      out.push(`<rte><name>Hole ${holeNumber(doc, hole.id)}${doc.layouts.length > 1 ? ` · ${xml(layout.name)}` : ""}</name>${s.line.map(p => { const g = toLatLon(ref, p); return `<rtept lat="${r6(g.lat)}" lon="${r6(g.lon)}"/>`; }).join("")}</rte>`);
    }
  }
  out.push(`</gpx>`);
  return out.join("\n");
};

const csvCell = (v: unknown) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(",")).join("\n");

/** The hole list: one row per hole and layout, with the tee and basket positions. */
export const holesCsv = (doc: CourseDoc) => {
  const ref = geoRefOf(doc);
  const rows: unknown[][] = [["hole", "name", "layout", "tee", "par", "length_ft", "length_m", "plays_like_ft", "elevation_change_ft", "tee_lat", "tee_lon", "tee_elevation_ft", "basket_pin", "basket_lat", "basket_lon", "basket_elevation_ft", "bearing_deg", "shape", "notes"]];
  for (const layout of doc.layouts) {
    for (const hole of doc.holes) {
      const s = holeStats(doc, hole, layout);
      const tee = doc.items.find(i => i.id === s.teeId) as TeeItem | undefined;
      const basket = doc.items.find(i => i.id === s.basketId) as BasketItem | undefined;
      const tg = ref && tee ? toLatLon(ref, tee) : null;
      const bg = ref && basket ? toLatLon(ref, basket) : null;
      rows.push([
        s.number, hole.name ?? "", layout.name, tee ? TEE_LEVELS[tee.level].label : "", s.complete ? s.par : "",
        s.complete ? Math.round(s.length) : "", s.complete ? Math.round(s.length / FT_PER_M) : "", s.complete ? Math.round(s.playsLike) : "", s.complete ? r1(s.elevationChange) : "",
        tg ? r6(tg.lat) : "", tg ? r6(tg.lon) : "", tee ? r1(s.teeElevation) : "",
        basket?.position ?? "", bg ? r6(bg.lat) : "", bg ? r6(bg.lon) : "", basket ? r1(s.basketElevation) : "",
        tee && basket ? Math.round(bearing(tee, basket)) : "", s.shape, hole.notes ?? ""
      ]);
    }
  }
  return toCsv(rows);
};

/** For the people installing it: where every tee and basket goes, with the bearing and distance
 * from the tee to the basket (to check on the ground), and the turns of each throw line. */
export const stakeOutCsv = (doc: CourseDoc) => {
  const ref = geoRefOf(doc);
  const rows: unknown[][] = [["hole", "what", "lat", "lon", "elevation_ft", "from_tee_bearing", "from_tee_ft", "notes"]];
  for (const hole of doc.holes) {
    const num = holeNumber(doc, hole.id);
    const tees = holeTees(doc, hole.id);
    const main = tees[0];
    const add = (what: string, p: P, notes = "") => {
      const g = ref ? toLatLon(ref, p) : null;
      const b = main && p !== main ? `${Math.round(bearing(main, p))}° ${compassPoint(bearing(main, p))}` : "";
      const d = main && p !== main ? Math.round(Math.hypot(p.x - main.x, p.y - main.y)) : "";
      rows.push([num, what, g ? r6(g.lat) : "", g ? r6(g.lon) : "", elevationFt(doc, p), b, d, notes]);
    };
    for (const t of tees) add(`${TEE_LEVELS[t.level].label} tee (pad middle)`, t, `${t.padWidth} x ${t.padLength} ft ${TEE_SURFACES[t.surface].label.toLowerCase()}`);
    for (const b of holeBaskets(doc, hole.id)) add(`Basket ${b.position}`, b, [b.model, b.raised ? `raised ${b.raised} ft` : ""].filter(Boolean).join(", "));
    hole.doglegs.forEach((p, i) => add(`Throw line turn ${i + 1}`, p, "flag only"));
    for (const t of tees) t.doglegs?.forEach((p, i) => add(`${TEE_LEVELS[t.level].label} tee's line turn ${i + 1}`, p, "flag only"));
    for (const i of doc.items) if ((i.type === "mando" || i.type === "dropzone") && i.holeId === hole.id) add(i.type === "mando" ? `Mando (pass ${i.side})` : "Drop zone", i);
  }
  return toCsv(rows);
};

export type PartLine = { item: string; qty: number; unit: string; unitPrice: number; total: number; note?: string };

/** A part's price: one of the course's own, or the OB stakes' and mando signs' (courses made
 * before those could be changed don't have them: these until they are). */
export type PriceKey = keyof CourseRules["prices"] | "obStake" | "mandoSign";
const LATER_PRICES = { obStake: 4, mandoSign: 35 } as const;
/** Each price's name, in the order Change prices lists them. */
export const PRICE_LABELS: [PriceKey, string][] = [
  ["basket", "Baskets"], ["sleeve", "Basket sleeves"], ["teePad", "Tee pads"], ["sign", "Tee signs"], ["bench", "Benches"],
  ["trash", "Trash cans"], ["kiosk", "Kiosks"], ["obStake", "OB stakes"], ["mandoSign", "Mando and drop zone signs"]
];
export const priceOf = (doc: Pick<CourseDoc, "rules">, k: PriceKey): number =>
  (doc.rules.prices as Partial<Record<PriceKey, number>>)[k] ?? (k in LATER_PRICES ? LATER_PRICES[k as keyof typeof LATER_PRICES] : 0);

/** Concrete as it's ordered: cubic yards, or cubic meters on a metric course. */
export const fmtConcrete = (yd3: number, units: Units) => (units === "m" ? `${(yd3 * 0.764555).toFixed(1)} m³` : `${yd3.toFixed(1)} cu yd`);

/** What to buy: baskets (and spare sleeves for other pin positions), tee pads with their
 * concrete, tee signs, benches, cans, a kiosk, and stakes for OB lines. */
export const partsList = (doc: CourseDoc): { lines: PartLine[]; total: number; concreteYd3: number } => {
  const p = doc.rules.prices;
  const u = doc.units;
  const baskets = doc.items.filter(i => i.type === "basket") as BasketItem[];
  const holesWithBaskets = new Set(baskets.map(b => b.holeId));
  const tees = doc.items.filter(i => i.type === "tee") as TeeItem[];
  const concreteTees = tees.filter(t => t.surface === "concrete");
  // A 4 in slab: width x length x 1/3 ft, in cubic yards
  const concreteYd3 = concreteTees.reduce((t, x) => t + (x.padWidth * x.padLength * (4 / 12)) / 27, 0);
  const amen = (k: AmenityItem["kind"]) => doc.items.filter(i => i.type === "amenity" && i.kind === k).length;
  const obFt = (doc.items.filter(i => i.type === "line" && i.kind === "ob") as LineItem[]).reduce((t, l) => t + pathLength(linePath(l)), 0);
  const lines: PartLine[] = [
    { item: "Baskets", qty: holesWithBaskets.size, unit: "each", unitPrice: p.basket, total: 0 },
    { item: "Basket sleeves (ground mounts)", qty: baskets.length, unit: "each", unitPrice: p.sleeve, total: 0 },
    { item: "Tee pads", qty: tees.length, unit: "each", unitPrice: p.teePad, total: 0, note: `${concreteTees.length} concrete (${fmtConcrete(concreteYd3, u)} at ${u === "m" ? "10 cm" : "4 in"}), ${tees.length - concreteTees.length} other` },
    { item: "Tee signs", qty: doc.holes.length, unit: "each", unitPrice: p.sign, total: 0 },
    { item: "Benches", qty: amen("bench"), unit: "each", unitPrice: p.bench, total: 0 },
    { item: "Trash cans", qty: amen("trash"), unit: "each", unitPrice: p.trash, total: 0 },
    { item: "Course kiosk / map board", qty: amen("kiosk"), unit: "each", unitPrice: p.kiosk, total: 0 },
    { item: "OB stakes", qty: Math.ceil(obFt / 30), unit: "each", unitPrice: priceOf(doc, "obStake"), total: 0, note: `${fmtDist(obFt, u)} of OB lines` },
    { item: "Mando and drop zone signs", qty: doc.items.filter(i => i.type === "mando" || i.type === "dropzone").length, unit: "each", unitPrice: priceOf(doc, "mandoSign"), total: 0 }
  ].filter(l => l.qty > 0).map(l => ({ ...l, total: l.qty * l.unitPrice }));
  return { lines, total: lines.reduce((t, l) => t + l.total, 0), concreteYd3 };
};

export const partsCsv = (doc: CourseDoc) => {
  const { lines, total } = partsList(doc);
  return toCsv([["item", "quantity", "unit", "unit_price_usd", "total_usd", "note"], ...lines.map(l => [l.item, l.qty, l.unit, l.unitPrice, l.total, l.note ?? ""]), ["Total", "", "", "", total, ""]]);
};

