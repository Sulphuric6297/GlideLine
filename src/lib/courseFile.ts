// A disc golf course's tees and baskets from a GPS file: GPX (waypoints, routes and tracks), KML or
// KMZ (placemarks in folders), GeoJSON (OpenStreetMap's disc_golf tags, as Overpass Turbo exports,
// or GlideLine Studio's own) and CSV (a spreadsheet's lat and lon columns). Each point is worked out as a
// tee or a basket of a hole from its name, tags or folder ("Hole 3 Tee", "3T", "T3", "Basket 3",
// "3A", "Pin 3 long"...), a hole line's ends are its tee and basket, and every pin position and tee
// a hole has is kept. The columns and properties a file can have are in docs/COURSE-FILES.md.
import JSZip from "jszip";
import type { LatLon, MappedCourse, MappedHole } from "./geo/osm";
import type { Layout, PinPosition, TeeLevel, TeeSurface } from "../types";
import { PIN_POSITIONS, TEE_ORDER, generateId } from "../constants";

export type PointRole = "tee" | "basket";

/** What a point or a line can say about its whole hole. */
export type HoleSays = { holeName?: string; holeNotes?: string; par?: number };

/** A layout the file names: which tee color and pin position it plays. */
export type FileLayout = { name: string; tee: TeeLevel; pin: PinPosition };

/** A point in the file: where it is, its name as it came, and what it was worked out to be. */
export type FilePoint = HoleSays & {
  id: string;
  at: LatLon;
  name: string;
  role?: PointRole;
  hole?: number;
  /** What tells it from the hole's other tees or pins: a letter (A), a word (long, short) or a
   * tee color. */
  tag?: string;
  /** Worked out from what's round it (a hole's one other point, the end of a line, the order in the
   * file), so worth a look. */
  guessed?: boolean;
  /** Something else (a mando, a drop zone, a bench...), or left out by hand. */
  skip?: boolean;
  /** A tee's pad. */
  surface?: TeeSurface;
  /** A basket's make and model. */
  model?: string;
};

/** A line in the file: a hole's throw line, tee to basket (a route, a track, a hole way). `tag`:
 * the color of the tee it starts from, when it says. */
export type FileLine = HoleSays & { name: string; hole?: number; tag?: string; points: LatLon[] };

export type CourseFile = { format: "GPX" | "KML" | "KMZ" | "GeoJSON" | "CSV"; name?: string; points: FilePoint[]; lines: FileLine[]; layouts?: FileLayout[] };

// ---------------------------------------------------------------- names

const TEE_WORDS = /\b(tee|tees|teepad|tee pad|tee box|teebox)\b/;
const BASKET_WORDS = /\b(basket|baskets|target|targets|pin|pins|pin position|cup|chains)\b/;
/** Things on a course that aren't tees or baskets. */
const OTHER_WORDS = /\b(mando|mandatory|drop zone|dropzone|drop|ob|bench|parking|restroom|toilet|trash|kiosk|sign|shelter|practice|water|fountain|start|entrance|gate|bridge|hazard|tree|first ?aid|picnic|here|grill|fitness|flagpole|light|pole|bike ?rack|bikerack)\b/;
const COLORS = ["gold", "blue", "white", "red", "green", "purple"];
const LENGTH_WORDS = /\b(long|short|middle|mid|medium|pro|am|amateur|rec|recreational|back|front|championship|novice)\b/;
const holeNum = (s?: string) => { const n = parseInt(s ?? "", 10); return n > 0 && n < 100 ? n : undefined; };
const colorIn = (s: string) => COLORS.find(c => new RegExp(`\\b${c}\\b`, "i").test(s));

/** A tee pad's surface, in the words people use for it (OpenStreetMap's surface values too). */
const SURFACE_WORDS: [RegExp, TeeSurface][] = [
  [/turf|synthetic|astro/, "turf"],
  [/rubber|\bmat\b/, "rubber"],
  [/gravel|crushed|stone dust|decomposed|fine gravel/, "gravel"],
  [/paver|paving|brick|stone|sett/, "pavers"],
  [/concrete|cement|asphalt|paved/, "concrete"],
  [/natural|dirt|grass|ground|earth|soil|mulch|wood ?chips|compacted|unpaved|none/, "natural"]
];
export const readSurface = (v?: string): TeeSurface | undefined => {
  const s = (v ?? "").toLowerCase().replace(/[_-]+/g, " ");
  return s.trim() ? SURFACE_WORDS.find(([re]) => re.test(s))?.[1] : undefined;
};

/** What a name says: a tee or a basket, which hole, and what tells it from the hole's others
 * (`color`: a tee color it names, whatever it is). */
export const readName = (text: string): { role?: PointRole; hole?: number; tag?: string; color?: string; other?: boolean } => {
  const s = ` ${text.toLowerCase().replace(/[_\-–—:,;#.()[\]/\\|·]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (!s.trim()) return {};
  let role: PointRole | undefined = TEE_WORDS.test(s) ? "tee" : BASKET_WORDS.test(s) ? "basket" : undefined;
  let hole: number | undefined, tag: string | undefined;
  let m: RegExpMatchArray | null;
  // (compact codes: 3T and T3 a tee, B3 and P3 a basket, 3A and 3B pin positions)
  if ((m = s.match(/ (\d{1,2}) ?t /)) || (m = s.match(/ t ?(\d{1,2}) /))) { role ??= "tee"; hole = holeNum(m[1]); }
  else if ((m = s.match(/ (\d{1,2}) ?([a-d]) /))) { role ??= "basket"; hole = holeNum(m[1]); tag = m[2].toUpperCase(); }
  else if ((m = s.match(/ [bp] ?(\d{1,2}) /))) { role ??= "basket"; hole = holeNum(m[1]); }
  // (a hole number: said as one, next to a tee or basket word, or the only number there)
  hole ??= holeNum(s.match(/\b(?:hole|h|no|number|num) ?(\d{1,2})\b/)?.[1])
    ?? holeNum(s.match(/\b(?:tee|basket|target|pin|cup) ?(\d{1,2})\b/)?.[1])
    ?? holeNum(s.match(/\b(\d{1,2}) ?(?:tee|basket|target|pin|cup)\b/)?.[1]);
  if (hole === undefined) {
    const nums = s.match(/(?<=\s)\d{1,2}(?=\s)/g);
    if (nums?.length === 1) hole = holeNum(nums[0]);
  }
  // (a letter on its own next to a tee or basket word: Basket A, Tee B)
  if (!tag && role && (m = s.match(/\b(?:basket|target|pin|tee|position) ([a-d])\b/) ?? s.match(/ ([a-d]) (?:basket|target|pin|tee)\b/) ?? s.match(/\b\d{1,2} ([a-d]) /))) tag = m[1].toUpperCase();
  const color = COLORS.find(c => new RegExp(`\\b${c}\\b`).test(s));
  const length = s.match(LENGTH_WORDS)?.[1];
  if (!tag) tag = role === "tee" ? color ?? length : length;
  const other = !role && OTHER_WORDS.test(s);
  return { ...(role ? { role } : {}), ...(hole !== undefined ? { hole } : {}), ...(tag ? { tag } : {}), ...(color ? { color } : {}), ...(other ? { other } : {}) };
};

/** What a feature's tags or a row's columns say (keys in any case), over what its name says.
 * `line`: a hole's throw line; `bend`: a point the line turns at (a spreadsheet's row);
 * `layout`: a layout's row, named `layoutName`. */
export const readTags = (props: Record<string, unknown>): ReturnType<typeof readName> & HoleSays & {
  line?: boolean; bend?: boolean; layout?: boolean; layoutName?: string; name?: string; surface?: TeeSurface; model?: string
} => {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) if (v !== null && v !== undefined && typeof v !== "object") p[k.toLowerCase().replace(/[\s#.]+/g, "_").replace(/_+$/, "")] = String(v).trim();
  const first = (...keys: string[]) => keys.map(k => p[k]).find(v => v !== undefined && v !== "");
  const name = first("name", "title", "label", "point_name", "description", "desc", "cmt", "comment", "notes");
  // (the name first; a description only fills in what the name doesn't say)
  const fromName = readName(name ?? "");
  const desc = first("description", "desc", "cmt");
  if (desc && desc !== name && (!fromName.role || fromName.hole === undefined)) {
    const d = readName(desc);
    fromName.role ??= d.role;
    if (fromName.hole === undefined && d.hole !== undefined) fromName.hole = d.hole;
    if (!fromName.tag && d.tag) fromName.tag = d.tag;
    fromName.color ??= d.color;
  }
  const out: ReturnType<typeof readTags> = { ...fromName, ...(name ? { name } : {}) };
  // OpenStreetMap's tags
  const dg = first("disc_golf", "golf");
  if (dg === "tee") out.role = "tee";
  else if (dg === "basket" || dg === "pin") out.role = "basket";
  else if (dg === "hole") out.line = true;
  const ref = first("ref", "ref_hole");
  if (ref) { const r = readName(ref); if (r.hole !== undefined) out.hole = r.hole; if (r.tag) out.tag = r.tag; }
  // A spreadsheet's or GlideLine Studio's own columns
  const kind = first("kind", "type", "role", "feature", "feature_type", "point_type", "category", "what", "object", "target_type", "item");
  if (kind && !dg) {
    const k = kind.toLowerCase().replace(/[_-]+/g, " ").trim();
    const said = readName(kind);
    if (/^(bend|bends|turn|turning point)$/.test(k)) out.bend = true;
    else if (k === "layout") out.layout = true;
    else if (said.role) out.role = said.role;
    else if (/\b(hole|line|throw line|play line|hole line|fairway)\b/.test(k)) out.line = true;
    else if (said.other) out.other = true;
    if (out.bend || out.layout) { delete out.role; delete out.other; }
  }
  const hole = holeNum(first("hole", "hole_number", "hole_no", "hole_num", "holenumber", "holenum", "hole_id", "number", "num", "no"));
  if (hole !== undefined) out.hole = hole;
  const pin = first("pin", "pin_position", "position", "basket_pin", "basket_position", "target_position", "pin_location");
  if (pin && out.role !== "tee") { const v = pin.toLowerCase(); out.tag = /^[a-d]$/.test(v) ? v.toUpperCase() : v.match(LENGTH_WORDS)?.[1] ?? out.tag; }
  const tee = first("tee", "tee_color", "tee_colour", "color", "colour", "level", "tee_level", "tee_position");
  if (tee) {
    const v = tee.toLowerCase();
    const c = COLORS.find(c => v.includes(c));
    if (c) out.color = c;
    if (out.role === "tee") out.tag = c ?? v.match(LENGTH_WORDS)?.[1] ?? (/^[a-d]$/.test(v) ? v.toUpperCase() : out.tag);
  }
  const par = parseInt(first("par", "hole_par", "par_tag") ?? "", 10);
  if (par >= 2 && par <= 7) out.par = par;
  const holeName = first("hole_name");
  if (holeName) out.holeName = holeName;
  const holeNotes = first("hole_notes", "hole_rules", "rules");
  if (holeNotes) out.holeNotes = holeNotes;
  const surface = readSurface(first("surface", "tee_surface", "pad_surface", "tee_pad"));
  if (surface) out.surface = surface;
  const layoutName = first("layout", "layout_name");
  if (layoutName) out.layoutName = layoutName;
  const model = first("model", "make_and_model");
  if (model) out.model = model;
  if (out.role) delete out.other;
  return out;
};

/** A layout from what a row or an entry says (its name, tee color and pin), or null. */
export const layoutOf = (said: { layoutName?: string; name?: string; color?: string; tag?: string }): FileLayout | null => {
  const name = said.layoutName ?? said.name;
  if (!name) return null;
  const tee = (TEE_ORDER as string[]).includes(said.color ?? "") ? (said.color as TeeLevel) : "blue";
  const pin = (PIN_POSITIONS as string[]).includes(said.tag ?? "") ? (said.tag as PinPosition) : "A";
  return { name, tee, pin };
};

// ---------------------------------------------------------------- reading each format

let nextId = 0;
const holeSays = (said: HoleSays): HoleSays => ({
  ...(said.par ? { par: said.par } : {}), ...(said.holeName ? { holeName: said.holeName } : {}), ...(said.holeNotes ? { holeNotes: said.holeNotes } : {})
});
const pointOf = (at: LatLon, name: string, said: ReturnType<typeof readTags>): FilePoint => ({
  id: `p${++nextId}`, at, name,
  ...(said.role ? { role: said.role } : {}), ...(said.hole !== undefined ? { hole: said.hole } : {}), ...(said.tag ? { tag: said.tag } : {}),
  ...(said.surface && said.role !== "basket" ? { surface: said.surface } : {}), ...(said.model && said.role !== "tee" ? { model: said.model } : {}), ...holeSays(said),
  // (something else, or nothing it says: left out, to bring in by hand if it's wanted)
  ...(said.other || (!said.role && said.hole === undefined) ? { skip: true } : {})
});
const okLatLon = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
/** A line's name read for its hole number and the tee color it starts from (a route named
 * "Hole 3 Blue"). */
const lineOf = (name: string, points: LatLon[], said: ReturnType<typeof readTags> = readName(name)): FileLine => {
  const tag = said.color ?? colorIn(name);
  return { name, points, ...(said.hole !== undefined ? { hole: said.hole } : {}), ...(tag ? { tag } : {}), ...holeSays(said) };
};

const xmlDoc = (text: string) => {
  const d = new DOMParser().parseFromString(text, "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new Error("This file isn't readable XML.");
  return d;
};
/** Child elements by local name (namespaces ignored: files come with and without them). */
const kids = (el: Element, name: string) => Array.from(el.children).filter(c => c.localName === name);
const kid = (el: Element, name: string) => kids(el, name)[0];
const textOf = (el: Element | undefined) => el?.textContent?.trim() ?? "";
const all = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS("*", name));

export const readGpx = (text: string): CourseFile => {
  const d = xmlDoc(text);
  const points: FilePoint[] = [], lines: FileLine[] = [];
  for (const w of all(d, "wpt")) {
    const lat = parseFloat(w.getAttribute("lat") ?? ""), lon = parseFloat(w.getAttribute("lon") ?? "");
    if (!okLatLon(lat, lon)) continue;
    const name = textOf(kid(w, "name"));
    const said = readTags({ name, desc: textOf(kid(w, "desc")) || textOf(kid(w, "cmt")), type: textOf(kid(w, "type")) });
    points.push(pointOf({ lat, lon }, name || textOf(kid(w, "desc")), said));
  }
  const pts = (els: Element[]) => els.map(p => ({ lat: parseFloat(p.getAttribute("lat") ?? ""), lon: parseFloat(p.getAttribute("lon") ?? "") })).filter(p => okLatLon(p.lat, p.lon));
  for (const r of all(d, "rte")) { const name = textOf(kid(r, "name")); lines.push(lineOf(name, pts(kids(r, "rtept")))); }
  for (const t of all(d, "trk")) {
    const name = textOf(kid(t, "name"));
    for (const seg of kids(t, "trkseg")) lines.push(lineOf(name, pts(kids(seg, "trkpt"))));
  }
  const meta = all(d, "metadata")[0];
  return { format: "GPX", name: meta ? textOf(kid(meta, "name")) || undefined : undefined, points, lines: lines.filter(l => l.points.length >= 2) };
};

const kmlCoords = (s: string): LatLon[] => s.trim().split(/\s+/).map(c => c.split(",").map(Number)).filter(c => c.length >= 2 && okLatLon(c[1], c[0])).map(([lon, lat]) => ({ lat, lon }));

export const readKml = (text: string, format: "KML" | "KMZ" = "KML"): CourseFile => {
  const d = xmlDoc(text);
  const points: FilePoint[] = [], lines: FileLine[] = [];
  for (const pm of all(d, "Placemark")) {
    const name = textOf(kid(pm, "name"));
    const props: Record<string, string> = { name, description: textOf(kid(pm, "description")).replace(/<[^>]*>/g, " ") };
    for (const data of all(pm, "Data")) props[data.getAttribute("name") ?? ""] = textOf(kid(data, "value"));
    for (const sd of all(pm, "SimpleData")) props[sd.getAttribute("name") ?? ""] = textOf(sd);
    const said = readTags(props);
    // (what the folders round it say fills in what its own name doesn't: a folder "Hole 3" with
    // "Tee" and "Basket" in it, or a folder "Tees" with "1", "2"... in it)
    for (let f = pm.parentElement; f && (said.role === undefined || said.hole === undefined); f = f.parentElement) {
      if (f.localName !== "Folder" && f.localName !== "Document") continue;
      const up = readName(textOf(kid(f, "name")));
      said.role ??= up.role;
      if (said.hole === undefined && up.hole !== undefined) said.hole = up.hole;
    }
    if (said.role) said.other = undefined;
    for (const p of all(pm, "Point")) {
      const at = kmlCoords(textOf(all(p, "coordinates")[0]))[0];
      if (at) points.push(pointOf(at, name, said));
    }
    for (const l of all(pm, "LineString")) {
      const pts = kmlCoords(textOf(all(l, "coordinates")[0]));
      if (pts.length >= 2) lines.push(lineOf(name, pts, said));
    }
  }
  const doc = all(d, "Document")[0];
  return { format, name: doc ? textOf(kid(doc, "name")) || undefined : undefined, points, lines };
};

/** A KMZ is a zip with a KML in it (doc.kml, or the first one there). */
export const readKmz = async (data: ArrayBuffer): Promise<CourseFile> => {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter(n => /\.kml$/i.test(n));
  const name = names.find(n => /(^|\/)doc\.kml$/i.test(n)) ?? names[0];
  if (!name) throw new Error("There's no KML file inside this KMZ.");
  return readKml(await zip.files[name].async("string"), "KMZ");
};

/** A property by its key in any case, as text (unset: none, or empty). */
const propOf = (props: Record<string, unknown>, key: string) => {
  const v = Object.entries(props).find(([k]) => k.toLowerCase() === key)?.[1];
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
};
/** A hole's line's or row's name as the hole's own ("The Gauntlet"): one that doesn't just say
 * which hole or tee it is. */
const holeNameIn = (name?: string) => {
  if (!name) return undefined;
  const r = readName(name);
  return r.role || r.hole !== undefined || r.other || colorIn(name) || /^\d+$/.test(name) ? undefined : name;
};

export const readGeoJson = (text: string): CourseFile => {
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error("This file isn't readable GeoJSON."); }
  const features: any[] = json?.type === "FeatureCollection" ? json.features ?? [] : json?.type === "Feature" ? [json] : [];
  const points: FilePoint[] = [], lines: FileLine[] = [];
  for (const f of features) {
    const g = f?.geometry, props = f?.properties ?? {};
    if (!g) continue;
    // (Overpass Turbo puts the tags under properties.tags in some exports)
    const said = readTags({ ...props, ...(props.tags && typeof props.tags === "object" ? props.tags : {}) });
    const name = said.name ?? "";
    const pt = (c: number[]) => (okLatLon(c[1], c[0]) ? { lat: c[1], lon: c[0] } : null);
    if (g.type === "Point") { const at = pt(g.coordinates); if (at) points.push(pointOf(at, name, said)); }
    else if (g.type === "MultiPoint") for (const c of g.coordinates) { const at = pt(c); if (at) points.push(pointOf(at, name, said)); }
    else if (g.type === "LineString" || g.type === "MultiLineString") {
      for (const part of g.type === "LineString" ? [g.coordinates] : g.coordinates) {
        const pts = (part as number[][]).map(pt).filter((p): p is LatLon => !!p);
        // (a line that isn't a hole: a path, a road, OB, only where it says it's one)
        // (a hole's line names the hole and holds its notes, as GlideLine Studio's own file has them)
        const own = { ...said, holeName: said.holeName ?? holeNameIn(propOf(props, "name")), holeNotes: said.holeNotes ?? propOf(props, "notes") };
        if (pts.length >= 2 && (said.line || said.hole !== undefined) && !said.other) lines.push(lineOf(name, pts, own));
      }
    }
  }
  // (the course's layouts, in a list beside the features)
  const layouts = (Array.isArray(json.layouts) ? json.layouts : []).map((l: unknown) => (l && typeof l === "object" ? layoutOf(readTags(l as Record<string, unknown>)) : null)).filter((l: FileLayout | null): l is FileLayout => !!l);
  return { format: "GeoJSON", name: typeof json.name === "string" ? json.name : undefined, points, lines, ...(layouts.length ? { layouts } : {}) };
};

/** A CSV's rows (quoted fields, commas, semicolons or tabs). */
export const csvRows = (text: string): string[][] => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim())) rows.push(row);
  return rows.map(r => r.map(v => v.trim()));
};

/**
 * A CSV: a row a point (lat and lon columns, with a hole number and a tee/basket column or a name
 * that says), or a row a hole (tee lat and lon, basket or target lat and lon, maybe more than one
 * pair of each: "Target A Latitude"). A row of kind "bend" is a point a hole's line turns at (in
 * order from the tee; with a tee color, that tee's line), and a row of kind "layout" names a
 * layout with its tee color and pin.
 */
export const readCsv = (text: string): CourseFile => {
  const rows = csvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new Error("This CSV has no rows to read.");
  const head = rows[0].map(h => h.toLowerCase());
  const isLat = (h: string) => /(^|[^a-z])(lat|latitude)([^a-z]|$)/.test(h) || h === "y";
  const isLon = (h: string) => /(^|[^a-z])(lon|lng|long|longitude)([^a-z]|$)/.test(h) || h === "x";
  const rest = (h: string) => h.replace(/latitude|longitude|lat|lng|lon|long|^[xy]$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // Each lat column with the lon column that has the same words round it
  const pairs: { lat: number; lon: number; words: string }[] = [];
  head.forEach((h, i) => {
    if (!isLat(h)) return;
    const words = rest(h);
    const j = head.findIndex((o, k) => k !== i && isLon(o) && rest(o) === words);
    if (j >= 0) pairs.push({ lat: i, lon: j, words });
  });
  if (!pairs.length) throw new Error("This CSV has no latitude and longitude columns.");
  const points: FilePoint[] = [], lines: FileLine[] = [], layouts: FileLayout[] = [];
  const bends = new Map<string, { hole: number; tag?: string; at: LatLon[] }>();
  for (const r of rows.slice(1)) {
    const props: Record<string, string> = {};
    head.forEach((h, i) => { if (!pairs.some(p => p.lat === i || p.lon === i)) props[rows[0][i]] = r[i] ?? ""; });
    const said = readTags(props);
    if (said.layout) { const l = layoutOf(said); if (l) layouts.push(l); continue; }
    // (a row a hole names the hole and holds its notes, as GlideLine Studio's hole list has them)
    if (pairs.length > 1) { said.holeName ??= holeNameIn(propOf(props, "name")); said.holeNotes ??= propOf(props, "notes"); }
    for (const p of pairs) {
      const lat = parseFloat(r[p.lat]), lon = parseFloat(r[p.lon]);
      if (!okLatLon(lat, lon)) continue;
      if (said.bend) {
        if (said.hole === undefined) continue;
        const key = `${said.hole}:${said.color ?? ""}`;
        const b = bends.get(key) ?? { hole: said.hole, ...(said.color ? { tag: said.color } : {}), at: [] };
        b.at.push({ lat, lon });
        bends.set(key, b);
        continue;
      }
      // (the pair's own words, "Tee" or "Target B", say what it is on a row a hole)
      const own = pairs.length > 1 || p.words ? readName(p.words) : {};
      const s = { ...said, ...(own.role ? { role: own.role, other: undefined } : {}), ...(own.tag ? { tag: own.tag } : {}) };
      // (on a row a hole, the tee's color is its tag; the pin column is the basket's)
      if (own.role === "tee" && !own.tag) { if (said.color) s.tag = said.color; else delete s.tag; }
      const name = [said.name ?? (said.hole !== undefined ? `Hole ${said.hole}` : ""), pairs.length > 1 ? p.words : ""].filter(Boolean).join(" ");
      points.push(pointOf({ lat, lon }, name, s));
    }
  }
  // Each hole's bends as its line: from its tee (the one of that color), through them, to its
  // first pin
  for (const b of bends.values()) {
    const tees = points.filter(p => p.role === "tee" && p.hole === b.hole && !p.skip);
    const tee = (b.tag ? tees.find(p => p.tag === b.tag) : undefined) ?? tees[0];
    const pins = points.filter(p => p.role === "basket" && p.hole === b.hole && !p.skip);
    const pin = pins.find(p => p.tag === "A") ?? pins[0];
    if (tee && pin) lines.push({ name: `Hole ${b.hole}${b.tag ? ` ${b.tag}` : ""}`, hole: b.hole, ...(b.tag ? { tag: b.tag } : {}), points: [tee.at, ...b.at, pin.at] });
  }
  return { format: "CSV", points, lines, ...(layouts.length ? { layouts } : {}) };
};

/** Any of the four, by its name and what's in it. */
export const readCourseFile = async (file: { name: string; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<CourseFile> => {
  const ext = file.name.toLowerCase().match(/\.([a-z]+)$/)?.[1] ?? "";
  let out: CourseFile;
  if (ext === "kmz") out = await readKmz(await file.arrayBuffer());
  else {
    const text = await file.text();
    const t = text.trimStart();
    if (ext === "gpx" || /^<\?xml[^>]*>\s*<gpx|^<gpx/i.test(t)) out = readGpx(text);
    else if (ext === "kml" || /<kml[\s>]/i.test(t.slice(0, 500))) out = readKml(text);
    else if (ext === "geojson" || ext === "json" || t.startsWith("{")) out = readGeoJson(text);
    else if (ext === "csv" || ext === "txt" || ext === "tsv") out = readCsv(text);
    else throw new Error("GlideLine Studio reads GPX, KML, KMZ, GeoJSON and CSV files.");
  }
  if (!out.points.length && !out.lines.length) throw new Error("No points or lines in this file.");
  return settle(out);
};

// ---------------------------------------------------------------- working out what's what

const metersApart = (a: LatLon, b: LatLon) => {
  const cos = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * cos);
};
/** How near a named tee or basket must be to a line's end to be that end, m. */
const SNAP_M = 15;

/**
 * What can be worked out from what's round each point: a line's ends as its hole's tee and basket
 * (the named point there, when there is one), a hole's one point that doesn't say as the tee or
 * basket it's missing, and a file with no numbers anywhere numbered in its order.
 */
export const settle = (file: CourseFile): CourseFile => {
  const points = file.points.map(p => ({ ...p }));
  const lines = file.lines.map(l => ({ ...l }));
  // Lines with no numbers, in a file with none anywhere: numbered in their order
  const numbered = points.some(p => p.hole !== undefined) || lines.some(l => l.hole !== undefined);
  if (!numbered) lines.forEach((l, i) => { l.hole = i + 1; });
  // A line's ends: the named tee or basket there (given the line's number), or new ones
  for (const l of lines) {
    const ends: [PointRole, LatLon][] = [["tee", l.points[0]], ["basket", l.points[l.points.length - 1]]];
    for (const [role, at] of ends) {
      const near = points.filter(p => !p.skip && (p.role === role || !p.role) && (p.hole === undefined || p.hole === l.hole) && metersApart(p.at, at) < SNAP_M)
        .sort((a, b) => metersApart(a.at, at) - metersApart(b.at, at))[0];
      if (near) {
        if (!near.role) { near.role = role; near.guessed = true; }
        if (near.hole === undefined && l.hole !== undefined) near.hole = l.hole;
      } else if (!points.some(p => !p.skip && p.role === role && p.hole !== undefined && p.hole === l.hole && metersApart(p.at, at) < SNAP_M)) {
        points.push({ id: `p${++nextId}`, at, name: `${role === "tee" ? "Start" : "End"} of ${l.name || "a line"}`, role, ...(l.hole !== undefined ? { hole: l.hole } : {}), ...(role === "tee" && l.tag ? { tag: l.tag } : {}) });
      }
    }
  }
  // A hole's one point that doesn't say: the tee or the basket it's missing
  const byHole = new Map<number, FilePoint[]>();
  for (const p of points) if (!p.skip && p.hole !== undefined) byHole.set(p.hole, [...(byHole.get(p.hole) ?? []), p]);
  for (const list of byHole.values()) {
    const unknown = list.filter(p => !p.role);
    if (unknown.length !== 1) continue;
    const tees = list.some(p => p.role === "tee"), baskets = list.some(p => p.role === "basket");
    if (tees !== baskets) { unknown[0].role = tees ? "basket" : "tee"; unknown[0].guessed = true; }
  }
  // No numbers anywhere: each tee starts the next hole, the baskets after it are its own
  if (!numbered && !lines.length) {
    let n = 0, sawBasket = true;
    for (const p of points) {
      if (p.skip || !p.role) continue;
      if (p.role === "tee" && sawBasket) { n++; sawBasket = false; }
      if (p.role === "basket") { if (!n) n = 1; sawBasket = true; }
      p.hole = n; p.guessed = true;
    }
  }
  return { ...file, points, lines };
};

/** A point that needs a look before it comes in: it doesn't say what it is or which hole, or that
 * was worked out from what's round it. */
export const needsLook = (p: FilePoint) => !p.skip && (!p.role || p.hole === undefined || !!p.guessed);

/** Douglas-Peucker in meters: a walked track's wiggles out, its real bends kept. */
const simplifyM = (pts: LatLon[], tol: number): LatLon[] => {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const xy = (p: LatLon) => ({ x: (p.lon - a.lon) * 111320 * cos, y: (p.lat - a.lat) * 111320 });
  const B = xy(b), len = Math.hypot(B.x, B.y) || 1;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = xy(pts[i]);
    const d = Math.abs(B.y * p.x - B.x * p.y) / len;
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [a, b];
  return [...simplifyM(pts.slice(0, at + 1), tol).slice(0, -1), ...simplifyM(pts.slice(at), tol)];
};

/** How far off a straight line a bend must be to stay one, m (a track walked with a phone wanders). */
const BEND_M = 4;

/** Back tees first (gold, blue...), then ones with no color. */
const teeRank = (tag?: string) => { const i = (TEE_ORDER as string[]).indexOf(tag ?? ""); return i < 0 ? TEE_ORDER.length : i; };

/**
 * The holes the file makes as it stands: each hole number with its tees and pins (every one, in the
 * file's order) and its bends from its line (with a line from each tee, the back tee's; another
 * tee whose line turns elsewhere keeps its own turns), its par (that line's, else the back tee's;
 * another tee's own, from its line or its own point, where it differs), name and notes. Points that don't say what they are, or
 * which hole, stay out until they're given both.
 */
export const fileCourse = (file: CourseFile): MappedCourse & { left: FilePoint[] } => {
  const groups = new Map<number, FilePoint[]>();
  const left: FilePoint[] = [];
  for (const p of file.points) {
    if (p.skip) continue;
    if (!p.role || p.hole === undefined) { left.push(p); continue; }
    const list = groups.get(p.hole) ?? [];
    // (the same tee or pin again, as a list with a row a hole and layout has it: once)
    const twin = list.find(q => q.role === p.role && (q.tag ?? "") === (p.tag ?? "") && metersApart(q.at, p.at) < 0.5);
    if (twin) { Object.assign(twin, { ...holeSays(p), ...holeSays(twin) }); continue; }
    groups.set(p.hole, [...list, { ...p }]);
  }
  const holes: MappedHole[] = [];
  for (const [number, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const tees = list.filter(p => p.role === "tee"), baskets = list.filter(p => p.role === "basket");
    if (!tees.length || !baskets.length) { left.push(...list); continue; }
    const ownLines = file.lines.filter(l => l.hole === number);
    const line = [...ownLines].sort((a, b) => teeRank(a.tag) - teeRank(b.tag))[0];
    const doglegs = line ? simplifyM(line.points, line.points.length > 8 ? BEND_M : 0.5).slice(1, -1) : [];
    const backTees = [...tees].sort((a, b) => teeRank(a.tag) - teeRank(b.tag));
    const says: HoleSays[] = [line, ...ownLines, ...backTees, ...baskets].filter(s => !!s);
    const par = line?.par ?? says.find(s => s.par)?.par;
    const name = says.find(s => s.holeName)?.holeName, notes = says.find(s => s.holeNotes)?.holeNotes;
    // (each other tee's own line: its turns, where they aren't the hole's still ahead of it, and its
    // par, its line's or its own row's, where it isn't the hole's)
    const lineFrom = (t: FilePoint) => (t.tag ? ownLines.find(l => l.tag === t.tag) : undefined) ?? ownLines.find(l => metersApart(l.points[0], t.at) < SNAP_M);
    const own = (t: FilePoint) => {
      const l = lineFrom(t);
      if (l ? l === line : t === backTees[0]) return {};
      const tp = l?.par ?? t.par;
      const ownPar = tp && tp !== par ? { par: tp } : {};
      if (!l) return ownPar;
      const turns = simplifyM(l.points, l.points.length > 8 ? BEND_M : 0.5).slice(1, -1);
      // (a tee with none of its own plays through the hole's turns still ahead of it)
      const end = l.points[l.points.length - 1];
      let ahead = doglegs;
      while (ahead.length && metersApart(t.at, ahead[1] ?? end) < metersApart(ahead[0], ahead[1] ?? end)) ahead = ahead.slice(1);
      const same = turns.length === ahead.length && turns.every((p, i) => metersApart(p, ahead[i]) < 1.5);
      return { ...(same ? {} : { doglegs: turns }), ...ownPar };
    };
    holes.push({
      ref: String(number), number, ...(par ? { par } : {}), ...(name ? { name } : {}), ...(notes ? { notes } : {}),
      tee: tees[0].at, basket: baskets[0].at, doglegs,
      tees: tees.map(t => ({ at: t.at, tag: t.tag, ...(t.surface ? { surface: t.surface } : {}), ...own(t) })),
      baskets: baskets.map(b => ({ at: b.at, tag: b.tag, ...(b.model ? { model: b.model } : {}) }))
    });
  }
  return { name: file.name, holes, left };
};

/** The course's layouts with the file's: one of the same name takes the file's tee and pin, the
 * rest are added. A course that still has only the layout every course starts with takes the
 * file's in its place, the first one played. */
export const withFileLayouts = (layouts: Layout[], active: string, file?: FileLayout[]): { layouts: Layout[]; activeLayout: string } => {
  if (!file?.length) return { layouts, activeLayout: active };
  const untouched = layouts.length === 1 && layouts[0].id === "layout-main" && layouts[0].name === "Main" && layouts[0].tee === "blue" && layouts[0].pin === "A";
  const out = untouched ? [] : layouts.map(l => ({ ...l }));
  for (const f of file) {
    const same = out.find(l => l.name.trim().toLowerCase() === f.name.trim().toLowerCase());
    if (same) { same.tee = f.tee; same.pin = f.pin; }
    else out.push({ id: `layout-${generateId()}`, name: f.name, tee: f.tee, pin: f.pin });
  }
  return { layouts: out, activeLayout: untouched ? out[0].id : active };
};

/** The middle of what's in the file and the box round it (to find the park it's in). */
export const fileExtent = (file: CourseFile) => {
  const pts = [...file.points.filter(p => !p.skip).map(p => p.at), ...file.lines.flatMap(l => l.points)];
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const bounds = { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lons), west: Math.min(...lons) };
  return { center: { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 }, bounds };
};
