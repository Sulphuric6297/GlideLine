// Tee signs and hole sheets: one page per hole with its number, par, the distance from each tee,
// the hole drawn with the tee at the bottom, its elevation profile, the hole's rules, and an arrow
// to the next tee.
import { fitAttr, capAttr } from "./fitText";
import { AREA_KINDS, CIRCLE_ONE_FT, FIELD_KINDS, FT_PER_M, LINE_KINDS, TEE_LEVELS } from "../constants";
import { fieldKindOf } from "./fields";
import type { AreaItem, BasketItem, CourseDoc, CourseItem, LineItem, MapStyle, P, SignLook, SignPart, SignSpot, TeeLevel, Units } from "../types";
import { renderFieldGuide, renderOpenView, renderTrailhead } from "./signLooks";
import { activeLayout, belongsTo, fairwayOutline, holeBaskets, holeTees, linePath, obFor, obPieces, throwLine, taglineOf, titleFontOf } from "./course";
import { boundsOf, dist, distanceToPath, pathLength, pointAlong, pointInPolygon, rotatePoint, smoothPath } from "./geom";
import { holeStats, isOutOfPlay, playedHoles, type HoleStats } from "./holeStats";
import { keepsCase, markingsInView, northArrow, palette, renderMapLayers, scaleBar, titleStack, wrapSvg, type MapView, teeLevelOf } from "./mapSvg";
import type { CanopyGrid } from "./forest";
import type { Contours } from "./relief";
import { profileAlong } from "./terrainGrid";
import { fmtDist, fmtElev } from "./units";
import { extrasSvg, followName, piecer, type HoleFacts } from "./pieces";

export type SignSize = "18x12" | "12x18" | "18x24" | "letter" | "a4";
export const SIGN_SIZES: Record<SignSize, { label: string; w: number; h: number }> = {
  "18x12": { label: "18 × 12 in, wide", w: 18, h: 12 },
  "12x18": { label: "12 × 18 in, tall", w: 12, h: 18 },
  "18x24": { label: "18 × 24 in", w: 18, h: 24 },
  letter: { label: "Letter paper, 8.5 × 11 in", w: 8.5, h: 11 },
  a4: { label: "A4 paper, 210 × 297 mm", w: 8.27, h: 11.69 }
};
/** A sign on letter or A4 paper: always the Classic look, on a page of its own. */
export const isSheet = (size: SignSize) => size === "letter" || size === "a4";

export const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** The look of tee signs and hole cards (the course's own, or a dark green header on light paper):
 * the header band, its light lettering (accent), the paper, the ink, a softer ink, the heading and
 * body fonts. */
export const CARD_DEFAULTS = { header: "#13311d", accent: "#d9f99d", paper: "#f5f4ee", ink: "#0f1f12", font: "Oswald" };
export const cardStyle = (doc: Pick<CourseDoc, "style">) => {
  const c = { ...CARD_DEFAULTS, ...(doc.style.card ?? {}) };
  const mix = (a: string, b: string, t: number) => {
    const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
  };
  return { header: c.header, accent: c.accent, paper: c.paper, ink: c.ink, soft: mix(c.ink, c.paper, 0.38), head: titleStack(c.font), body: "Inter, Arial, sans-serif", font: c.font };
};

/** The course's name as a look sets it: in the course name font when one is picked (a script
 * keeps its own capitals and spacing), else in the look's own font (`own`). */
export const courseNameAs = (sty: Pick<MapStyle, "titleFont">, own: string) => {
  const f = sty.titleFont, script = !!f && keepsCase(f);
  return { font: f ? titleStack(f) : own, caps: (t: string) => (script ? t : t.toUpperCase()), spaced: !script };
};

/** "350 FT" / "107 M". */
/** A tee's name on the signs and pages: the layout played from it, where the course names tees by
 * layout and one layout plays that color, else its color. */
export const teeName = (doc: Pick<CourseDoc, "layouts" | "style">, level: TeeLevel) => {
  const by = doc.style.teeNames === "layouts" ? doc.layouts.filter(l => l.tee === level) : [];
  return by.length === 1 && by[0].name.trim() ? by[0].name.trim() : TEE_LEVELS[level].label;
};

export const bigLength = (ft: number, units: Units) => `${Math.round(units === "m" ? ft / FT_PER_M : ft).toLocaleString()} ${units === "m" ? "M" : "FT"}`;

/** The OB square in a key: red, or (PDGA colors) white with a dark edge. */
export const obKey = (sty: Pick<MapStyle, "ob" | "markings">) => (sty.markings === "pdga" ? `<tspan fill="#ffffff" stroke="#1b1d1a" stroke-width="0.6">■</tspan>` : `<tspan fill="${sty.ob}">■</tspan>`);

/** Rules written out from what is drawn on and around the hole (used when it has no notes of its own). */
export const autoRules = (doc: CourseDoc, holeId: string) => {
  const hole = doc.holes.find(h => h.id === holeId)!;
  const s = holeStats(doc, hole);
  const out: string[] = [];
  if (!s.complete) return out;
  const fairway = fairwayOutline(hole, smoothPath(s.line, 8), 20, 8);
  const near = (a: AreaItem) => (!a.holeId || belongsTo(a, holeId)) && (a.points.some(p => pointInPolygon(p, fairway)) || fairway.some(p => pointInPolygon(p, a.points)));
  const areas = doc.items.filter(i => i.type === "area") as AreaItem[];
  const obLine = doc.items.some(i => i.type === "line" && i.kind === "ob" && (!i.holeId || belongsTo(i, holeId)) && i.points.some(p => pointInPolygon(p, fairway)));
  if (areas.some(a => a.kind === "ob" && near(a)) || obLine) out.push("OB in play.");
  if (areas.some(a => a.kind === "water" && a.ob !== false && a.hazard !== true && near(a))) out.push("Water is OB.");
  if (areas.some(a => a.kind === "water" && a.hazard === true && near(a))) out.push("Water is a hazard.");
  if (areas.some(a => a.kind === "hazard" && near(a))) out.push("Hazard in play.");
  // (anything else made a hazard, by its name)
  for (const a of areas.filter(a => a.hazard === true && a.kind !== "water" && a.kind !== "hazard" && near(a))) {
    const text = `${a.label?.trim() || (a.kind === "field" ? FIELD_KINDS[fieldKindOf(a)].label : AREA_KINDS[a.kind].label)} is a hazard.`;
    if (!out.includes(text)) out.push(text);
  }
  // Fields, courts and play areas by the hole that players stay out of, or that are OB
  for (const a of areas.filter(a => a.kind === "field" && near(a) && (a.ob === true || isOutOfPlay(a)))) {
    const text = `${a.label?.trim() || FIELD_KINDS[fieldKindOf(a)].label} is ${a.ob === true ? "OB" : "out of play"}.`;
    if (!out.includes(text)) out.push(text);
  }
  // Roads, paths, fences and creeks marked OB near the hole (all along them or a stretch)
  const reach = hole.fairwayWidth / 2 + 40, line = smoothPath(s.line, 8);
  const close = (piece: P[]) => Array.from({ length: Math.ceil(pathLength(piece) / 10) + 1 }, (_, k) => pointAlong(piece, k * 10).point).some(p => distanceToPath(p, line) < reach);
  const said = new Set<string>();
  for (const l of doc.items.filter(i => i.type === "line" && i.kind !== "ob" && i.kind !== "walk" && i.ob === true && obFor(doc, i, holeId)) as LineItem[]) {
    if (!obPieces(l).some(close)) continue;
    const name = l.label?.trim() || { road: "Road", path: "Path", fence: "Fence", stream: "Creek", ob: "", walk: "", power: "Power line", hedge: "Hedge", wall: "Wall" }[l.kind];
    const text = `${name}${l.obBeyond ? " and beyond" : ""} is OB.`;
    if (!said.has(text)) out.push(text);
    said.add(text);
  }
  for (const l of doc.items.filter(i => i.type === "line" && i.kind !== "ob" && i.hazard === true && (!i.holeId || belongsTo(i, holeId))) as LineItem[]) {
    if (!close(linePath(l))) continue;
    const name = l.label?.trim() || LINE_KINDS[l.kind].label;
    const text = `${name} is a hazard.`;
    if (!said.has(text)) out.push(text);
    said.add(text);
  }
  const mandos = doc.items.filter(i => i.type === "mando" && i.holeId === holeId);
  const dz = doc.items.filter(i => i.type === "dropzone" && i.holeId === holeId);
  if (mandos.length) out.push(mandos.length === 1 ? `Mando: pass ${(mandos[0] as { side: string }).side}.` : `${mandos.length} mandos.`);
  if (dz.length) out.push(`Drop zone for a missed mando${s.obInPlay ? " or OB" : ""}.`);
  if (s.obNearBasket) out.push("OB within 10 m of the basket.");
  return out;
};

/** The ground along a hole, tee to basket, as a filled profile in `box`. */
export const elevationProfile = (doc: CourseDoc, line: P[], box: { x: number; y: number; w: number; h: number }, c: { fill: string; stroke: string; tee: string; basket: string; width: number }) => {
  if (line.length < 2) return "";
  const prof = profileAlong(doc.terrainHeights, doc.gridSize, smoothPath(line, 6), 60);
  if (prof.length < 2) return "";
  const hs = prof.map(p => p.h);
  const lo = Math.min(...hs), hi = Math.max(...hs);
  const span = Math.max(8, hi - lo) * 1.3;
  const mid = (lo + hi) / 2;
  const total = prof[prof.length - 1].d || 1;
  const X = (d: number) => box.x + (d / total) * box.w;
  const Y = (h: number) => box.y + box.h * (0.5 - (h - mid) / span);
  const d = prof.map((p, i) => `${i ? "L" : "M"}${n(X(p.d))} ${n(Y(p.h))}`).join("");
  return `<g data-part="profile"><path d="${d}L${n(X(total))} ${n(box.y + box.h)}L${n(box.x)} ${n(box.y + box.h)}Z" fill="${c.fill}" opacity="0.75"/><path d="${d}" fill="none" stroke="${c.stroke}" stroke-width="${n(c.width)}" stroke-linejoin="round"/>`
    + `<circle cx="${n(X(0))}" cy="${n(Y(prof[0].h))}" r="${n(c.width * 2)}" fill="${c.tee}" stroke="#111"/><circle cx="${n(X(total))}" cy="${n(Y(prof[prof.length - 1].h))}" r="${n(c.width * 2)}" fill="${c.basket}" stroke="#111"/></g>`;
};

export type SignArt = { contours: Contours | null; hillshade: string | null; canopy?: CanopyGrid | null };

/** What a tee sign shows by default (all of it, but the distances on its map). */
const SIGN_SHOW: Record<SignPart, boolean> = {
  courseName: true, number: true, par: true, lengths: true, elevation: true, notes: true, courseMap: true, nextTee: true,
  north: true, scale: true, throwLine: true, circle: true, distances: false, holeOf: true, designer: true, legend: true
};

/** How tee signs can look (each with its picture: public/signs/<id>.jpg). */
export const SIGN_LOOKS: { id: SignLook; label: string }[] = [{ id: "classic", label: "Classic" }, { id: "trailhead", label: "Trailhead" }, { id: "fieldguide", label: "Field guide" }, { id: "openview", label: "Open view" }];

/** What a wide sign's extra panel (under the notes, or beside the climb) can hold. */
export const SIGN_SPOTS: { id: SignSpot; label: string }[] = [
  { id: "green", label: "Green" }, { id: "stats", label: "Numbers" }, { id: "none", label: "None" }
];

/** The parts of a tee sign, in the order they are set. */
export const SIGN_PARTS: { id: SignPart; label: string }[] = [
  { id: "courseName", label: "Course name" }, { id: "number", label: "Hole number" }, { id: "par", label: "Par" },
  { id: "lengths", label: "Lengths" }, { id: "elevation", label: "Elevation" }, { id: "notes", label: "Hole notes" },
  { id: "courseMap", label: "Course map" }, { id: "nextTee", label: "Way to the next tee" }, { id: "north", label: "North arrow" },
  { id: "scale", label: "Scale bar" }, { id: "throwLine", label: "Throw lines" }, { id: "circle", label: "Putting circle" },
  { id: "distances", label: "Distances" }, { id: "holeOf", label: "Hole N of M" }, { id: "designer", label: "Designer" },
  { id: "legend", label: "Legend" }
];

/** A hole's tee sign settings: its own over the course's, over the defaults. */
export const signOf = (doc: Pick<CourseDoc, "style" | "holes">, holeId: string) => {
  const g = doc.style.sign ?? {}, h = doc.holes.find(x => x.id === holeId)?.sign ?? {};
  const show = (p: SignPart) => h.show?.[p] ?? g.show?.[p] ?? SIGN_SHOW[p];
  return {
    others: h.others ?? g.others ?? "faded",
    fade: h.fade ?? g.fade ?? 0.3,
    show,
    // (the small course map is gone from signs, too rough to be of use: the green in its place)
    spot: (() => { const s = h.spot ?? g.spot ?? ((h.show?.courseMap ?? g.show?.courseMap) === false ? "none" : "green"); return (s === "courseMap" ? "green" : s) as SignSpot; })(),
    look: (g.look ?? "classic") as SignLook,
    /** A piece's place on this hole's sign: the hole's own, else the course's (the wide sign's
     * elevation strip left out while the column has the elevation, until it's asked for). */
    place: followName((id: string) => {
      const p = h.layout?.[id] ?? g.layout?.[id];
      return id === "elevationStrip" && p?.hidden === undefined && show("elevation") ? { ...p, hidden: true } : p;
    })
  };
};
/** The pieces a printout leaves out until they're asked for (shown again, they're kept shown). */
export const hiddenAtFirst = (id: string) => id === "elevationStrip" || id === "holeTitle" || id === "length";

/** What a hole's own text fills in on its sign or page. */
export const holeFacts = (doc: CourseDoc, holeId: string, st: { label: string; par: number; length: number; complete: boolean }): HoleFacts => ({
  hole: st.label, par: st.complete ? String(st.par) : "–",
  length: st.complete ? `${Math.round(doc.units === "m" ? st.length / FT_PER_M : st.length)} ${doc.units}` : "–",
  course: (doc.style.title || doc.name || "").trim(), name: doc.holes.find(h => h.id === holeId)?.name ?? ""
});
/** A sign's extras, its last pieces (in the headings font unless they have their own; lettering
 * with no color of its own in the look's ink, `ink`: the paper's color on a dark look). */
export const signExtras = (doc: CourseDoc, holeId: string, st: Parameters<typeof holeFacts>[2], W: number, H: number, wrap: (id: string, c: string) => string, ink = cardStyle(doc).ink) =>
  extrasSvg(doc.style.sign?.extras, doc.style.sponsors, holeId, holeFacts(doc, holeId, st), W, H, cardStyle(doc).font, wrap, ink);
type Words = { head: (id: string, own: string) => string; word: (id: string, key: string, own: string) => string };
/** The hole's numbers' tiles (the extra panel's): each its heading as typed, and its value. */
export const STAT_WORDS: [key: string, own: string][] = [["plays", "PLAYS LIKE"], ["updown", "UP / DOWN"], ["fairway", "FAIRWAY"], ["next", "TO THE NEXT TEE"]];
export const statTiles = (P: Words, values: string[]): [string, string][] => STAT_WORDS.map(([k, own], i) => [P.word("spot", k, own).trim(), values[i]]);
/** "DESIGNED BY NAME", its heading as typed. */
export const designedBy = (P: Words, who: string) => [P.head("designer", "DESIGNED BY").trim(), who.toUpperCase()].filter(Boolean).join(" ");
/** "HOLE 3 OF 18" (the holes played: a hole played as two numbers counts twice), and the layout
 * when there's more than one. */
export const holeOfText = (doc: CourseDoc, label: string, stats: { holeId: string; label: string }[]) => {
  const layout = activeLayout(doc);
  return `HOLE ${label} OF ${playedHoles(doc, stats).length}${layout && doc.layouts.length > 1 ? ` · ${layout.name.toUpperCase()} LAYOUT` : ""}`;
};

/** The course as a sign's map draws it: with only this hole when the others are left out (their
 * fairways, tees, baskets, mandos and drop zones gone; a basket it shares stays, as its own). */
export const signMapDoc = (doc: CourseDoc, holeId: string): CourseDoc => {
  const sign = signOf(doc, holeId);
  const style = { ...doc.style, throwLines: sign.show("throwLine"), circle: sign.show("circle"), distances: sign.show("distances") };
  if (sign.others !== "hidden") return { ...doc, style };
  const items = doc.items.flatMap((i): CourseItem[] => {
    if (i.type === "basket") {
      const holes = [i.holeId, ...(i.alsoHoles ?? [])];
      return holes.includes(holeId) ? [{ ...i, holeId, alsoHoles: undefined } as BasketItem] : [];
    }
    if ((i.type === "tee" || i.type === "mando" || i.type === "dropzone") && i.holeId && i.holeId !== holeId) return [];
    return [i];
  });
  return { ...doc, style, holes: doc.holes.filter(h => h.id === holeId), items };
};

export const renderTeeSign = (doc: CourseDoc, holeId: string, size: SignSize, opts: SignArt) => {
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return null;
  // (the hole sheets keep their own page)
  const look = signOf(doc, holeId).look;
  if (!isSheet(size)) {
    if (look === "trailhead") return renderTrailhead(doc, holeId, size, opts);
    if (look === "fieldguide") return renderFieldGuide(doc, holeId, size, opts);
    if (look === "openview") return renderOpenView(doc, holeId, size, opts);
  }
  if (SIGN_SIZES[size].w > SIGN_SIZES[size].h) return renderWideSign(doc, holeId, size, opts);
  const layout = activeLayout(doc);
  const stats = doc.holes.map(h => holeStats(doc, h, layout));
  const st = stats.find(s => s.holeId === holeId)!;
  const st0 = doc.style;
  const pal = palette(st0);
  const page = SIGN_SIZES[size];
  const W = page.w * 72, H = page.h * 72;
  const ts = W / (12 * 72) * 1.9;
  const m = 0.45 * 72 * (W / (12 * 72));
  // (the General tab's colors and lettering, as every look has them)
  const card = cardStyle(doc);
  const F = card.head;
  const parts: string[] = [];
  const sheet = isSheet(size);
  const header = { h: H * (sheet ? 0.17 : 0.2) };
  const tees = holeTees(doc, holeId);
  const mainTee = tees.find(t => t.id === st.teeId) ?? tees[0];
  const lvl = teeLevelOf(doc.style, mainTee?.level ?? "blue");
  const dark = card.header;
  const sign = signOf(doc, holeId), show = sign.show;
  // (each piece its own, to move, size or restyle on the page)
  const P = piecer(sign.place, W, H, `tt${holeId}`);
  let at = 0;

  parts.push(`<rect width="${n(W)}" height="${n(H)}" fill="${card.paper}"/>`);
  // Header band
  parts.push(P.wrap("band", `<rect width="${n(W)}" height="${n(header.h)}" fill="${dark}" data-fill="1"/><rect y="${n(header.h - 6 * ts)}" width="${n(W)}" height="${n(6 * ts)}" fill="${lvl.color}"/>`));
  const r = header.h * 0.36;
  if (show("number")) parts.push(P.wrap("number", `<circle cx="${n(m + r)}" cy="${n(header.h * 0.5)}" r="${n(r)}" fill="${lvl.color}" data-fill="1" stroke="#ffffff" stroke-width="${n(4 * ts)}"/><text${fitAttr(r * 1.7)} x="${n(m + r)}" y="${n(header.h * 0.5 + r * 0.06)}" text-anchor="middle" dominant-baseline="central" font-family="${F}" font-weight="700" font-size="${n(r * 1.25)}" fill="${lvl.ink}">${st.label}</text>`));
  const tx = m + 2 * r + 16 * ts;
  // The course name across the top (in its own font, the line under it below), the par under it
  // on the left, the distances on the right
  const tf = titleFontOf(st0), script = keepsCase(tf);
  const course = (st0.title || doc.name || "").trim(), name = script ? course : course.toUpperCase();
  const nameSize = Math.min(10 * ts, ((W - tx - m) / Math.max(1, name.length)) * (script ? 2 : 1.55));
  // (the tagline a piece of its own, only with the name)
  const nameSvg = show("courseName") ? P.wrap("courseName", `<text${fitAttr(W - tx - m)} x="${n(tx)}" y="${n(header.h * 0.2)}" font-family="${titleStack(tf)}" font-weight="700" font-size="${n(nameSize)}" fill="${card.accent}" letter-spacing="${n(script ? 0 : nameSize * 0.12)}">${esc(name)}</text>`) : "";
  parts.push(nameSvg);
  if (nameSvg && taglineOf(st0)) parts.push(P.wrap("tagline", `<text${fitAttr(W - tx - m)} x="${n(tx)}" y="${n(header.h * 0.2 + nameSize * 0.8 + 3 * ts)}" font-family="${card.body}" font-weight="800" font-size="${n(4.5 * ts)}" letter-spacing="${n(1.6 * ts)}" fill="${card.accent}" fill-opacity="0.75">${esc(taglineOf(st0))}</text>`));
  if (show("par")) parts.push(P.wrap("par", `<text${fitAttr((W - tx - m) * 0.45)} x="${n(tx)}" y="${n(header.h * 0.6)}" font-family="${F}" font-weight="700" font-size="${n(34 * ts)}" fill="${card.accent}">PAR ${st.complete ? st.par : "–"}</text>`));
  if (hole.name) parts.push(P.wrap("holeName", `<text${fitAttr((W - tx - m) * 0.55)} x="${n(tx)}" y="${n(header.h * 0.83)}" font-family="${F}" font-weight="500" font-size="${n(13 * ts)}" fill="${card.accent}">${esc(hole.name)}</text>`));
  // Distances per tee (each tee to the layout's pin)
  const basket = holeBaskets(doc, holeId).find(b => b.position === layout?.pin) ?? holeBaskets(doc, holeId)[0];
  const rowsX = W - m;
  at = parts.length;
  if (show("lengths")) tees.forEach((t, i) => {
    const len = basket ? holeStats(doc, hole, { id: "sign", name: "", tee: t.level, pin: basket.position }).length : 0;
    const y = header.h * 0.4 + i * 17 * ts * (tees.length > 3 ? 0.75 : 1);
    const L = teeLevelOf(doc.style, t.level);
    parts.push(`<rect x="${n(rowsX - 150 * ts)}" y="${n(y - 7 * ts)}" width="${n(150 * ts)}" height="${n(14 * ts)}" rx="${n(7 * ts)}" fill="${L.color}"/>`);
    parts.push(`<text${fitAttr(75 * ts)} x="${n(rowsX - 142 * ts)}" y="${n(y)}" dominant-baseline="central" font-family="${F}" font-weight="700" font-size="${n(10 * ts)}" fill="${L.ink}">${esc(teeName(doc, t.level).toUpperCase())}</text>`);
    parts.push(`<text${fitAttr(70 * ts)} x="${n(rowsX - 8 * ts)}" y="${n(y)}" text-anchor="end" dominant-baseline="central" font-family="${F}" font-weight="700" font-size="${n(10.5 * ts)}" fill="${L.ink}">${len ? bigLength(len, doc.units) : "–"}</text>`);
  });
  P.group(parts, at, "lengths");

  // The hole map, turned so the throw goes up the sign
  const footerH = H * (sheet ? 0.3 : 0.27);
  const box = { x: m, y: header.h + m * 0.7, w: W - 2 * m, h: H - header.h - m * 0.7 - footerH };
  const line = st.line.length >= 2 ? st.line : [{ x: hole.doglegs[0]?.x ?? 0, y: 0 }, { x: 0, y: 1 }];
  const a = Math.atan2(line[line.length - 1].y - line[0].y, line[line.length - 1].x - line[0].x) * 180 / Math.PI;
  const rotation = a + 90;
  const pts: P[] = [...fairwayOutline(hole, smoothPath(line, 8), 30, 8), ...tees, ...holeBaskets(doc, holeId).map(b => ({ x: b.x + CIRCLE_ONE_FT, y: b.y })), ...holeBaskets(doc, holeId).map(b => ({ x: b.x - CIRCLE_ONE_FT, y: b.y - CIRCLE_ONE_FT }))];
  doc.items.forEach(i => { if ((i.type === "mando" || i.type === "dropzone") && i.holeId === holeId) pts.push(i); });
  const rot = pts.map(p => rotatePoint(p, -rotation));
  const rb = boundsOf(rot);
  const pad = 40;
  const scale = Math.min(box.w / (rb.maxX - rb.minX + pad * 2), box.h / (rb.maxY - rb.minY + pad * 2));
  const c = rotatePoint({ x: (rb.minX + rb.maxX) / 2, y: (rb.minY + rb.maxY) / 2 }, rotation);
  const view: MapView = { cx: c.x, cy: c.y, rotation, scale, width: box.w, height: box.h };
  const md = signMapDoc(doc, holeId);
  const mapStats = md.holes.length === doc.holes.length ? stats : md.holes.map(h => holeStats(md, h, layout));
  const map = renderMapLayers(md, view, { stats: mapStats, contours: opts.contours, hillshade: opts.hillshade, focusHole: holeId, fade: sign.others === "shown" ? 1 : sign.fade, textScale: ts * 0.75, fontFamily: st0.font, canopy: opts.canopy }, `ts${st.label}`);
  at = parts.length;
  parts.push(`<clipPath id="sign-clip"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="${n(8 * ts)}"/></clipPath>`);
  parts.push(`<g clip-path="url(#sign-clip)"><g transform="translate(${n(box.x)} ${n(box.y)})">${map.svg}</g></g>`);
  parts.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="${n(8 * ts)}" fill="none" stroke="${dark}" stroke-width="${n(2 * ts)}"/>`);
  P.group(parts, at, "map");
  // North, scale
  if (show("north")) parts.push(P.wrap("north", `<g transform="translate(${n(box.x + box.w - 22 * ts)} ${n(box.y + 26 * ts)}) rotate(${n(-rotation)})">${northArrow(0, 0, 13 * ts, pal)}</g>`));
  if (show("scale")) parts.push(P.wrap("scale", scaleBar(box.x + 10 * ts, box.y + box.h - 12 * ts, scale * P.sizeOf("map"), ts * 0.85, pal, doc.units)));
  // Next tee arrow
  const next = stats[stats.indexOf(st) + 1];
  if (show("nextTee") && next?.complete && st.complete) {
    const from = st.line[st.line.length - 1], to = next.line[0];
    const d = dist(from, to);
    const dir = rotatePoint({ x: to.x - from.x, y: to.y - from.y }, -rotation);
    const ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
    const cx = box.x + box.w - 70 * ts, cy = box.y + box.h - 26 * ts;
    parts.push(P.wrap("nextTee", `<g><rect x="${n(cx - 62 * ts)}" y="${n(cy - 16 * ts)}" width="${n(124 * ts)}" height="${n(32 * ts)}" rx="${n(16 * ts)}" fill="${dark}"/><g transform="translate(${n(cx - 42 * ts)} ${n(cy)}) rotate(${n(ang)})"><path d="M${n(-9 * ts)} 0H${n(7 * ts)}M${n(1 * ts)} ${n(-6 * ts)}L${n(8 * ts)} 0L${n(1 * ts)} ${n(6 * ts)}" stroke="#fff" stroke-width="${n(3 * ts)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g><text${fitAttr(84 * ts)} x="${n(cx - 26 * ts)}" y="${n(cy)}" dominant-baseline="central" font-family="${F}" font-weight="700" font-size="${n(10 * ts)}" fill="#fff">HOLE ${next.number} · ${Math.round(doc.units === "m" ? d / FT_PER_M : d)} ${doc.units.toUpperCase()}</text></g>`));
  }

  // Footer: elevation profile, numbers and rules
  const fy = H - footerH + m * 0.3;
  const prof = st.complete ? profileAlong(doc.terrainHeights, doc.gridSize, smoothPath(throwLine(hole, mainTee ?? null, basket ?? null), 6), 60) : [];
  const pw = (W - 2 * m) * 0.48, ph = footerH * 0.42;
  at = parts.length;
  // (the footer is on the sign's own paper: its ink, not the map's)
  const elevHead = [P.head("elevation", "ELEVATION"), st.complete ? fmtElev(st.elevationChange, doc.units).toUpperCase() : ""].filter(Boolean).join(" ");
  if (show("elevation") && elevHead) parts.push(`<text${fitAttr(pw)} x="${n(m)}" y="${n(fy + 6 * ts)}" font-family="${F}" font-weight="700" font-size="${n(11 * ts)}" fill="${card.ink}">${esc(elevHead)}</text>`);
  if (show("elevation") && prof.length > 1) {
    const hs = prof.map(p => p.h);
    const lo = Math.min(...hs), hi = Math.max(...hs);
    const span = Math.max(8, hi - lo) * 1.3;
    const mid = (lo + hi) / 2;
    const X = (d: number) => m + (d / prof[prof.length - 1].d) * pw;
    const Y = (h: number) => fy + 14 * ts + ph * (0.5 - (h - mid) / span);
    const d = prof.map((p, i) => `${i ? "L" : "M"}${n(X(p.d))} ${n(Y(p.h))}`).join("");
    parts.push(`<path d="${d}L${n(X(prof[prof.length - 1].d))} ${n(fy + 14 * ts + ph)}L${n(m)} ${n(fy + 14 * ts + ph)}Z" fill="${st0.fairway}" opacity="0.7"/><path d="${d}" fill="none" stroke="${dark}" stroke-width="${n(2 * ts)}"/>`);
    parts.push(`<circle cx="${n(X(0))}" cy="${n(Y(prof[0].h))}" r="${n(4 * ts)}" fill="${lvl.color}" stroke="#111"/><circle cx="${n(X(prof[prof.length - 1].d))}" cy="${n(Y(prof[prof.length - 1].h))}" r="${n(4 * ts)}" fill="${st0.basket}" stroke="#111"/>`);
    const teeWord = P.word("elevation", "tee", "Tee").trim(), basketWord = P.word("elevation", "basket", "Basket · plays like").trim();
    if (teeWord) parts.push(`<text x="${n(m)}" y="${n(fy + 14 * ts + ph + 11 * ts)}" font-family="${card.body}" font-size="${n(8 * ts)}" fill="${card.soft}">${esc(teeWord)}</text>`);
    parts.push(`<text x="${n(m + pw)}" y="${n(fy + 14 * ts + ph + 11 * ts)}" text-anchor="end" font-family="${card.body}" font-size="${n(8 * ts)}" fill="${card.soft}">${esc([basketWord, fmtDist(st.playsLike, doc.units)].filter(Boolean).join(" "))}</text>`);
  }
  P.group(parts, at, "elevation");
  // Rules and notes (none: nothing there, rather than words the hole doesn't have)
  const nx = m + pw + 20 * ts, nw = W - m - nx;
  const rules = [hole.notes ?? "", ...(hole.notes ? [] : autoRules(doc, holeId))].filter(Boolean);
  at = parts.length;
  const notesHead = P.head("notes", "HOLE NOTES");
  if (show("notes") && rules.length && notesHead) parts.push(`<text${fitAttr(nw)} x="${n(nx)}" y="${n(fy + 6 * ts)}" font-family="${F}" font-weight="700" font-size="${n(11 * ts)}" fill="${card.ink}">${esc(notesHead)}</text>`);
  const words = rules.join(" ").split(/\s+/).filter(Boolean);
  const fs = 9.5 * ts;
  const maxChars = Math.max(10, Math.floor(nw / (fs * 0.52)));
  const wrapped: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) { wrapped.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) wrapped.push(cur);
  if (show("notes")) wrapped.slice(0, 7).forEach((l, i) => parts.push(`<text${fitAttr(nw)} x="${n(nx)}" y="${n(fy + (notesHead ? 24 : 6) * ts + i * fs * 1.35)}" font-family="${card.body}" font-size="${n(fs)}" fill="${card.ink}">${esc(l)}</text>`));
  P.group(parts, at, "notes");
  // Bottom strip
  const by = H - m * 0.6;
  const shown = markingsInView(doc, view);
  const legend = [shown.ob && `${obKey(st0)} OB`, shown.hazard && `<tspan fill="${st0.hazard}">■</tspan> Hazard`, shown.mando && `<tspan fill="#f97316">●</tspan> Mando / DZ`, `<tspan fill="${st0.basket}">●</tspan> Basket`].filter(Boolean).join("   ");
  if (show("legend")) parts.push(P.wrap("legend", `<text${fitAttr(W * 0.62)} x="${n(m)}" y="${n(by)}" font-family="${card.body}" font-size="${n(8 * ts)}" fill="${card.soft}">${legend}</text>`));
  if (show("holeOf")) parts.push(P.wrap("holeOf", `<text${fitAttr(W * 0.36)} x="${n(W - m)}" y="${n(by)}" text-anchor="end" font-family="${card.body}" font-size="${n(8 * ts)}" fill="${card.soft}">${esc(holeOfText(doc, st.label, stats))}</text>`));
  parts.push(signExtras(doc, holeId, st, W, H, P.wrap));
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};

/** A piece's place on the scorecard (the tagline under the course's name, with it until moved). */
export const scorecardPlace = (doc: Pick<CourseDoc, "style">) => followName(id => doc.style.scorecard?.layout?.[id], "logo");

/**
 * A printable scorecard like the classic course card: the course's logo (or its name), Date, Par
 * and Course; a row of each hole's par (and each layout's lengths), then Name and the holes 1–9,
 * Front, 10–18, Back and Total, and rows for the players. Two cards to a letter page, with a cut
 * line between them.
 */
export const renderScorecard = (doc: CourseDoc, players = doc.style.scorecard?.players ?? 5) => {
  // (on the course map's paper: A4 where the map is on metric paper, else Letter)
  const a4 = doc.style.paper === "a4" || doc.style.paper === "a3";
  const W = (a4 ? 11.69 : 11) * 72, H = (a4 ? 8.27 : 8.5) * 72;
  const cardH = H / 2;
  const card = cardStyle(doc);
  const sty = doc.style;
  // (each piece its own, placed on the card's own corner: the second card is drawn alike)
  const P = piecer(scorecardPlace(doc), W, cardH, "card");
  // (one column for each number: a hole that is 3 and 13 in both)
  const stats = playedHoles(doc, doc.holes.map(h => holeStats(doc, h, activeLayout(doc))));
  const split = stats.length > 9;
  type Col = { label: string; holes: number[]; total?: boolean; extra?: boolean };
  const cols: Col[] = [];
  const front = split ? Math.ceil(stats.length / 2) : stats.length;
  const word = (key: string, own: string) => P.word("table", key, own);
  for (let i = 0; i < front; i++) cols.push({ label: stats[i].label, holes: [i] });
  if (split) {
    cols.push({ label: word("front", "Front"), holes: Array.from({ length: front }, (_, i) => i), total: true });
    for (let i = front; i < stats.length; i++) cols.push({ label: stats[i].label, holes: [i] });
    cols.push({ label: word("back", "Back"), holes: Array.from({ length: stats.length - front }, (_, i) => front + i), total: true });
  }
  cols.push({ label: word("total", "Total"), holes: stats.map((_, i) => i), total: true });
  cols.push({ label: "+/−", holes: [], extra: true });
  const par = (c: Col) => c.holes.reduce((t, i) => t + (stats[i]?.complete ? stats[i].par : 0), 0);
  const totalPar = stats.reduce((t, st) => t + (st.complete ? st.par : 0), 0);
  const fill = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
  const one = (top: number, copy: boolean) => {
    const out: string[] = [];
    const m = 26;
    let at = 0;
    // Top: the logo or the name; Date, Par and Course to fill in; where the course is
    const logoH = 50, logoW = 190;
    let named = false;
    if (sty.logo) out.push(`<image href="${sty.logo}" x="${m}" y="${n(top + 16)}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMinYMid meet"/>`);
    else {
      const name = (sty.title || doc.name || "").replace(/\s+disc\s+golf(\s+course)?$/i, "").trim() || "Disc Golf";
      const size = Math.min(30, (logoW / Math.max(4, name.length)) * (keepsCase(titleFontOf(sty)) ? 2.1 : 1.75));
      out.push(`<text${fitAttr(logoW)} x="${m}" y="${n(top + 44)}" font-family="${titleStack(titleFontOf(sty))}" font-weight="700" font-size="${n(size)}" fill="${card.header}">${esc(keepsCase(titleFontOf(sty)) ? name : name.toUpperCase())}</text>`);
      named = true;
    }
    P.group(out, at, "logo", copy);
    // (the tagline a piece of its own, under the course's name)
    if (named && !P.hidden("logo") && taglineOf(sty)) out.push(P.wrap("tagline", `<text x="${m}" y="${n(top + 60)}" font-family="${card.body}" font-weight="800" font-size="7" letter-spacing="2" fill="${card.header}">${esc(taglineOf(sty))}</text>`, copy));
    at = out.length;
    const fx = m + logoW + 30;
    const field = (key: string, own: string, x: number, y: number, w: number, value = "") => {
      const label = P.word("fields", key, own).trim();
      if (label) out.push(`<text x="${n(x)}" y="${n(y)}" text-anchor="end" font-family="${card.body}" font-size="10" fill="${card.ink}">${esc(label)}</text>`);
      out.push(`<rect x="${n(x + 6)}" y="${n(y - 12)}" width="${n(w)}" height="15" fill="${fill(card.header, 0.07)}"/><line x1="${n(x + 6)}" x2="${n(x + 6 + w)}" y1="${n(y + 3)}" y2="${n(y + 3)}" stroke="${card.ink}" stroke-width="0.8"/>`);
      if (value) out.push(`<text x="${n(x + 10)}" y="${n(y)}" font-family="${card.body}" font-size="10" fill="${card.ink}">${esc(value)}</text>`);
    };
    field("date", "Date", fx + 40, top + 34, 120);
    field("par", "Par", fx + 210, top + 34, 34, totalPar ? String(totalPar) : "");
    field("course", "Course", fx + 40, top + 58, 214, sty.title || doc.name);
    P.group(out, at, "fields", copy);
    if (doc.site.location) out.push(P.wrap("location", `<text${fitAttr(W * 0.33)} x="${W - m}" y="${n(top + 58)}" text-anchor="end" font-family="${card.head}" font-weight="700" font-size="15" fill="${card.header}">${esc(doc.site.location.label.split(",").slice(0, 2).join(",").trim())}</text>`, copy));
    at = out.length;
    // The grid
    const labelW = 112, gx = m, gw = W - 2 * m;
    // (the totals and +/− a little wider than a hole's column: "Total" never squeezed)
    const wide = (c: Col) => (c.total || c.extra ? 1.4 : 1);
    const cw = (gw - labelW) / cols.reduce((t, c) => t + wide(c), 0);
    const colX = (i: number) => gx + labelW + cw * cols.slice(0, i).reduce((t, c) => t + wide(c), 0);
    let y = top + 78;
    const rowH = 21;
    const row = (label: string, values: (string | number)[], o: { head?: boolean; name?: boolean; small?: boolean; dot?: string } = {}) => {
      out.push(`<rect x="${gx}" y="${n(y)}" width="${n(labelW)}" height="${rowH}" fill="${o.name ? fill(card.header, 0.09) : "#ffffff"}" stroke="${card.ink}" stroke-width="0.9"/>`);
      if (o.dot) out.push(`<circle cx="${gx + 10}" cy="${n(y + rowH / 2)}" r="4.5" fill="${o.dot}" stroke="${card.ink}" stroke-width="0.6"/>`);
      out.push(`<text${fitAttr(labelW - 8)} x="${gx + (o.dot ? 20 : 6)}" y="${n(y + rowH / 2)}" dominant-baseline="central" font-family="${card.body}" font-size="${o.small ? 9 : 11}" fill="${card.ink}">${esc(label)}</text>`);
      cols.forEach((c, i) => {
        const x = colX(i), w = cw * wide(c);
        out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${rowH}" fill="${c.extra || (o.name && c.total) ? fill(card.header, 0.09) : "#ffffff"}" stroke="${card.ink}" stroke-width="${c.total ? 1.4 : 0.9}"/>`);
        const v = values[i];
        if (v !== "" && v !== undefined) out.push(`<text${fitAttr(w - 3)} x="${n(x + w / 2)}" y="${n(y + rowH / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${card.body}" font-size="${o.small ? 8.5 : c.total && !o.head ? 11 : 12}" font-weight="${o.head || c.total ? 600 : 400}" fill="${o.head ? card.ink : fill(card.ink, 0.75)}">${esc(String(v))}</text>`);
      });
      y += rowH;
    };
    row(word("par", "Par"), cols.map(c => (c.extra ? "" : par(c) || "")));
    if (doc.layouts.length) for (const l of doc.layouts) {
      const ls = playedHoles(doc, doc.holes.map(h => holeStats(doc, h, l)));
      row(`${l.name} (${doc.units})`, cols.map(c => {
        if (c.extra) return "";
        const v = c.holes.reduce((t, i) => t + (ls[i]?.complete ? ls[i].length : 0), 0);
        return v ? Math.round(doc.units === "m" ? v / FT_PER_M : v) : "";
      }), { small: true, dot: teeLevelOf(doc.style, l.tee).color });
    }
    row(word("name", "Name"), cols.map(c => c.label), { head: true });
    for (let p = 0; p < players; p++) row("", cols.map(() => ""), { name: true });
    P.group(out, at, "table", copy);
    // (and what's added to the card)
    out.push(extrasSvg(sty.scorecard?.extras, sty.sponsors, "", holeFacts(doc, "", { label: "", par: totalPar, length: 0, complete: true }), W, cardH, card.font, (id, c) => P.wrap(id, c, copy), card.ink));
    return { svg: out.join(""), bottom: y };
  };
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  parts.push(`<g data-part="scorecard">${one(0, false).svg}</g>`);
  parts.push(P.wrap("cutLine", `<line x1="0" x2="${W}" y1="${n(cardH)}" y2="${n(cardH)}" stroke="#9ca3af" stroke-width="0.8" stroke-dasharray="6 5"/>`));
  parts.push(`<g data-part="scorecard" transform="translate(0 ${n(cardH)})">${one(0, true).svg}</g>`);
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};

/** Wraps text into lines of at most `max` characters. */
export const wrap = (text: string, max: number) => {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
};

/** The hole drawn into a box with the tee at the bottom (for signs and hole pages). */
export const holeMap = (doc: CourseDoc, holeId: string, box: { w: number; h: number }, opts: SignArt, ts: number, uid: string, asSign = false) => {
  const hole = doc.holes.find(h => h.id === holeId)!;
  const stats = doc.holes.map(h => holeStats(doc, h, activeLayout(doc)));
  const st = stats.find(s => s.holeId === holeId)!;
  const tees = holeTees(doc, holeId);
  const line = st.line.length >= 2 ? st.line : [{ x: 0, y: 1 }, { x: 0, y: 0 }];
  const a = (Math.atan2(line[line.length - 1].y - line[0].y, line[line.length - 1].x - line[0].x) * 180) / Math.PI;
  const rotation = a + 90;
  const pts: P[] = [...fairwayOutline(hole, smoothPath(line, 8), 40, 8), ...tees];
  holeBaskets(doc, holeId).forEach(b => pts.push({ x: b.x + CIRCLE_ONE_FT * 1.5, y: b.y + CIRCLE_ONE_FT * 1.5 }, { x: b.x - CIRCLE_ONE_FT * 1.5, y: b.y - CIRCLE_ONE_FT * 1.5 }));
  doc.items.forEach(i => { if ((i.type === "mando" || i.type === "dropzone") && i.holeId === holeId) pts.push(i); });
  const rb = boundsOf(pts.map(p => rotatePoint(p, -rotation)));
  const scale = Math.min(box.w / (rb.maxX - rb.minX + 60), box.h / (rb.maxY - rb.minY + 60));
  const c = rotatePoint({ x: (rb.minX + rb.maxX) / 2, y: (rb.minY + rb.maxY) / 2 }, rotation);
  const view: MapView = { cx: c.x, cy: c.y, rotation, scale, width: box.w, height: box.h };
  // On a sign: as its settings say (the other holes faded, left out or shown; the line, circle and
  // distance); else the hole's own line shows, faintly, even when the course map leaves lines out
  const sign = asSign ? signOf(doc, holeId) : null;
  const md = sign ? signMapDoc(doc, holeId) : { ...doc, style: { ...doc.style, throwLines: true, circle: doc.style.circle } };
  const mapStats = md.holes.length === doc.holes.length ? stats : md.holes.map(h => holeStats(md, h, activeLayout(doc)));
  const map = renderMapLayers(md, view, { stats: mapStats, contours: opts.contours, hillshade: opts.hillshade, focusHole: holeId, fade: sign ? (sign.others === "shown" ? 1 : sign.fade) : undefined, textScale: ts, fontFamily: doc.style.font, canopy: opts.canopy }, uid);
  return { ...map, rotation, scale, st, stats, view };
};

/** The course in miniature, in the map's colors, in a box: this hole picked out, "you are here" at
 * its tee (`done`: the holes drawn whole). */
export const miniCourseMap = (doc: CourseDoc, holeId: string, st: HoleStats, done: HoleStats[], box: { x: number; y: number; w: number; h: number }, card: ReturnType<typeof cardStyle>, lvl: { color: string }, u: number) => {
  const sty = doc.style;
  const out: string[] = [];
  const all = done.flatMap(x => x.line);
  const b0 = boundsOf(all);
  const pad = 80;
  const b = { minX: b0.minX - pad, minY: b0.minY - pad, maxX: b0.maxX + pad, maxY: b0.maxY + pad };
  const k = Math.min(box.w / (b.maxX - b.minX), box.h / (b.maxY - b.minY));
  const ox = box.x + box.w / 2 - ((b.minX + b.maxX) / 2) * k, oy = box.y + box.h / 2 - ((b.minY + b.maxY) / 2) * k;
  const P2 = (q: P) => `${n(ox + q.x * k)} ${n(oy + q.y * k)}`;
  const poly = (pts: P[]) => `M${pts.map(P2).join("L")}Z`;
  const pth = (pts: P[]) => `M${pts.map(P2).join("L")}`;
  const mw = (b.maxX - b.minX) * k, mh = (b.maxY - b.minY) * k;
  const mbox = { x: box.x + (box.w - mw) / 2, y: box.y + (box.h - mh) / 2, w: mw, h: mh };
  const clip = `mini${holeId.slice(-4)}`;
  const woodsEverywhere = (sty.forest ?? "everywhere") === "everywhere";
  const mini: string[] = [`<clipPath id="${clip}"><rect x="${n(mbox.x)}" y="${n(mbox.y)}" width="${n(mbox.w)}" height="${n(mbox.h)}" rx="${n(10 * u)}"/></clipPath>`];
  mini.push(`<rect x="${n(mbox.x)}" y="${n(mbox.y)}" width="${n(mbox.w)}" height="${n(mbox.h)}" fill="${woodsEverywhere ? sty.trees : sty.rough}"/>`);
  for (const a of doc.items) {
    if (a.type === "area" && (a.kind === "woods" && !woodsEverywhere)) mini.push(`<path d="${poly(a.points)}" fill="${sty.trees}"/>`);
    if (a.type === "area" && (a.kind === "fairway" || a.kind === "nogo" || a.kind === "parking" || a.kind === "field") && woodsEverywhere) mini.push(`<path d="${poly(a.points)}" fill="${sty.rough}"/>`);
  }
  for (const x of done) {
    const h = doc.holes.find(q => q.id === x.holeId);
    if (h?.fairway) mini.push(`<path d="${poly(fairwayOutline(h, smoothPath(x.line, 6), 0, 6))}" fill="${sty.fairway}"/>`);
  }
  for (const a of doc.items) {
    if (a.type === "area" && (a.kind === "water" || (a.kind === "field" && fieldKindOf(a) === "pool"))) mini.push(`<path d="${poly(a.points)}" fill="${sty.water}"/>`);
    if (a.type === "line" && a.kind === "stream") mini.push(`<path d="${pth(a.points)}" fill="none" stroke="${sty.water}" stroke-width="${n(2 * u)}" stroke-linecap="round"/>`);
    if (a.type === "line" && (a.kind === "path" || a.kind === "walk")) mini.push(`<path d="${pth(a.points)}" fill="none" stroke="${sty.path}" stroke-width="${n(1.4 * u)}" stroke-linecap="round"/>`);
  }
  for (const x of done) {
    const me = x.holeId === holeId;
    mini.push(`<path d="${pth(smoothPath(x.line, 6))}" fill="none" stroke="${me ? lvl.color : "#ffffff"}" stroke-opacity="${me ? 1 : 0.75}" stroke-width="${n((me ? 3.4 : 1.4) * u)}" stroke-linecap="round"/>`);
  }
  for (const x of done) {
    const t = x.line[0], me = x.holeId === holeId;
    if (!me) mini.push(`<circle cx="${n(ox + t.x * k)}" cy="${n(oy + t.y * k)}" r="${n(6.5 * u)}" fill="${card.header}" stroke="#ffffff" stroke-width="${n(0.8 * u)}"/><text x="${n(ox + t.x * k)}" y="${n(oy + t.y * k)}" text-anchor="middle" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(7 * u)}" fill="#ffffff">${x.number}</text>`);
  }
  out.push(`<g data-part="course-map"><g clip-path="url(#${clip})">${mini.join("")}</g><rect x="${n(mbox.x)}" y="${n(mbox.y)}" width="${n(mbox.w)}" height="${n(mbox.h)}" rx="${n(10 * u)}" fill="none" stroke="${card.ink}" stroke-opacity="0.35" stroke-width="${n(1.2 * u)}"/>`);
  // You are here
  const here = st.line[0];
  const hx = ox + here.x * k, hy = oy + here.y * k;
  out.push(`<path d="M${n(hx)} ${n(hy)}c${n(-9 * u)} ${n(-12 * u)} ${n(-9 * u)} ${n(-24 * u)} 0 ${n(-24 * u)}s${n(9 * u)} ${n(12 * u)} 0 ${n(24 * u)}z" fill="#dc2626" stroke="#ffffff" stroke-width="${n(1.4 * u)}"/><text x="${n(hx)}" y="${n(hy - 15 * u)}" text-anchor="middle" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(8.5 * u)}" fill="#ffffff">${st.label}</text>`);
  const tagX = Math.max(mbox.x + 40 * u, Math.min(mbox.x + mbox.w - 40 * u, hx));
  out.push(`<rect x="${n(tagX - 38 * u)}" y="${n(Math.min(hy + 6 * u, mbox.y + mbox.h - 18 * u))}" width="${n(76 * u)}" height="${n(14 * u)}" rx="${n(7 * u)}" fill="#dc2626"/><text x="${n(tagX)}" y="${n(Math.min(hy + 6 * u, mbox.y + mbox.h - 18 * u) + 7 * u)}" text-anchor="middle" dominant-baseline="central" font-family="${card.body}" font-weight="800" font-size="${n(6.5 * u)}" letter-spacing="${n(1 * u)}" fill="#ffffff">YOU ARE HERE</text></g>`);
  return out.join("");
};

/** The green up close: the painted ground round the basket, turned as the hole's map is. */
export const greenView = (doc: CourseDoc, holeId: string, map: ReturnType<typeof holeMap>, box: { x: number; y: number; w: number; h: number }, opts: SignArt, u: number, sign: ReturnType<typeof signOf>, edge = cardStyle(doc).ink) => {
  const st = map.st, sty = doc.style;
  const end = st.line[st.line.length - 1];
  const view: MapView = { cx: end.x, cy: end.y, rotation: map.rotation, scale: Math.min(box.w, box.h) / 110, width: box.w, height: box.h };
  const md = signMapDoc(doc, holeId);
  const mstats = md.holes.length === doc.holes.length ? map.stats : md.holes.map(h => holeStats(md, h, activeLayout(doc)));
  const g = renderMapLayers(md, view, { stats: mstats, contours: opts.contours, hillshade: opts.hillshade, focusHole: holeId, fade: sign.others === "shown" ? 1 : sign.fade, textScale: 1.3 * u, fontFamily: sty.font, canopy: opts.canopy }, `gr${holeId.slice(-4)}`);
  const clip = `green${holeId.slice(-4)}`;
  return `<g data-part="green"><clipPath id="${clip}"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="${n(10 * u)}"/></clipPath><g clip-path="url(#${clip})"><g transform="translate(${n(box.x)} ${n(box.y)})">${g.svg}</g></g><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="${n(10 * u)}" fill="none" stroke="${edge}" stroke-opacity="0.35" stroke-width="${n(1.2 * u)}"/></g>`;
};

/**
 * A wide tee sign: a light column on the left with the course name, the hole number in a dark
 * box, the par on a tag in the tee color, the distance in big type and the hole notes; the hole's
 * map on the right with the tee at the bottom; the elevation change along the bottom.
 */
const renderWideSign = (doc: CourseDoc, holeId: string, size: SignSize, opts: SignArt) => {
  const hole = doc.holes.find(h => h.id === holeId)!;
  const page = SIGN_SIZES[size];
  const W = page.w * 72, H = page.h * 72;
  const u = H / (12 * 72); // 1 at 12 in tall
  const sty = doc.style;
  const col = { x: 0, w: W * 0.34 };
  const mapBox = { x: col.w, y: 0, w: W - col.w, h: H };
  const map = holeMap(doc, holeId, mapBox, opts, 1.6 * u, `ws${holeId.slice(-4)}`, true);
  const sign = signOf(doc, holeId), show = sign.show;
  const st = map.st;
  const tees = holeTees(doc, holeId);
  const mainTee = tees.find(t => t.id === st.teeId) ?? tees[0];
  const lvl = teeLevelOf(doc.style, mainTee?.level ?? "blue");
  const parts: string[] = [];
  const card = cardStyle(doc);
  // (each piece its own, to move, size or restyle on the page)
  const P = piecer(sign.place, W, H, `ws${holeId}`);
  let at = 0;
  parts.push(`<rect width="${n(W)}" height="${n(H)}" fill="${card.paper}"/>`);
  // The map, with the elevation strip along its bottom
  at = parts.length;
  parts.push(`<clipPath id="wide-map"><rect x="${n(mapBox.x)}" y="0" width="${n(mapBox.w)}" height="${n(H)}"/></clipPath>`);
  parts.push(`<g clip-path="url(#wide-map)"><g transform="translate(${n(mapBox.x)} 0)">${map.svg}</g></g>`);
  P.group(parts, at, "map");
  const stripH = 30 * u;
  at = parts.length;
  // (a piece of its own: hidden by its own eye, not with the column's elevation)
  const stripHead = P.head("elevationStrip", "ELEVATION CHANGE FROM TEE");
  parts.push(`<rect x="${n(mapBox.x)}" y="${n(H - stripH)}" width="${n(mapBox.w)}" height="${n(stripH)}" fill="#0b120a" fill-opacity="0.82" data-fill="1"/>`);
  parts.push(`<text${fitAttr(mapBox.w - 30 * u)} x="${n(mapBox.x + mapBox.w / 2)}" y="${n(H - stripH / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${card.head}" font-weight="600" font-size="${n(14 * u)}" letter-spacing="${n(1.5 * u)}" fill="#ffffff">${stripHead ? `${esc(stripHead)}: ` : ""}${st.complete ? esc(fmtElev(st.elevationChange, doc.units).toUpperCase()) : "–"}${st.complete && Math.abs(st.playsLike - st.length) >= 10 ? ` · ${esc([P.word("elevationStrip", "plays", "PLAYS LIKE").trim(), fmtDist(st.playsLike, doc.units).toUpperCase()].filter(Boolean).join(" "))}` : ""}</text>`);
  P.group(parts, at, "elevationStrip");
  if (show("north")) parts.push(P.wrap("north", `<g transform="translate(${n(W - 34 * u)} ${n(38 * u)}) rotate(${n(-map.rotation)})">${northArrow(0, 0, 20 * u, palette(sty))}</g>`));
  // The way to the next hole
  const next = map.stats[map.stats.indexOf(st) + 1];
  if (show("nextTee") && next?.complete && st.complete) {
    const from = st.line[st.line.length - 1], to = next.line[0];
    const d = dist(from, to);
    const dir = rotatePoint({ x: to.x - from.x, y: to.y - from.y }, -map.rotation);
    const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const cx = W - 92 * u, cy = H - stripH - 30 * u;
    at = parts.length;
    parts.push(`<rect x="${n(cx - 76 * u)}" y="${n(cy - 18 * u)}" width="${n(152 * u)}" height="${n(36 * u)}" rx="${n(18 * u)}" fill="#0b120a" fill-opacity="0.85"/><g transform="translate(${n(cx - 52 * u)} ${n(cy)}) rotate(${n(ang)})"><path d="M${n(-10 * u)} 0H${n(8 * u)}M${n(1 * u)} ${n(-7 * u)}L${n(9 * u)} 0L${n(1 * u)} ${n(7 * u)}" stroke="#fff" stroke-width="${n(3.4 * u)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g><text${fitAttr(104 * u)} x="${n(cx - 32 * u)}" y="${n(cy)}" dominant-baseline="central" font-family="${card.head}" font-weight="600" font-size="${n(13 * u)}" fill="#fff">HOLE ${next.number} · ${Math.round(doc.units === "m" ? d / FT_PER_M : d)} ${doc.units.toUpperCase()}</text>`);
    P.group(parts, at, "nextTee");
  }
  // The column, top to bottom: the course's name on the header band; the hole's number and par;
  // the length from each tee; the elevation along the hole; the hole notes; a little map of the
  // whole course with this hole picked out; which hole of how many
  const mx = 30 * u, cw = col.w - 2 * mx, cx = col.w / 2;
  const soft = card.soft;
  const lens = tees.map(t => {
    const basket = doc.items.find(i => i.id === st.basketId && i.type === "basket") as BasketItem | undefined;
    return { t, len: t.id === mainTee?.id ? st.length : basket ? holeStats(doc, hole, { id: "x", name: "", tee: t.level, pin: basket.position }).length : 0 };
  });
  const big = (ft: number) => `${Math.round(doc.units === "m" ? ft / FT_PER_M : ft).toLocaleString()} ${doc.units === "m" ? "M" : "FT"}`;
  // Header band: the course's name
  let name = (sty.title || doc.name || "").trim().replace(/\s+disc\s+golf(\s+course)?$/i, "");
  const bandH = 128 * u;
  parts.push(P.wrap("band", `<rect width="${n(col.w)}" height="${n(bandH)}" fill="${card.header}" data-fill="1"/><rect y="${n(bandH - 5 * u)}" width="${n(col.w)}" height="${n(5 * u)}" fill="${lvl.color}"/>`));
  const nameSize = Math.min(40 * u, ((cw * 0.95) / Math.max(4, name.length)) * (keepsCase(titleFontOf(sty)) ? 2.1 : 1.75));
  // (the tagline a piece of its own, only with the name)
  const nameSvg = show("courseName") ? P.wrap("courseName", `<text${fitAttr(cw)} x="${n(cx)}" y="${n(bandH * 0.52)}" text-anchor="middle" font-family="${titleStack(titleFontOf(sty))}" font-weight="700" font-size="${n(nameSize)}" fill="${card.accent}">${esc(keepsCase(titleFontOf(sty)) ? name : name.toUpperCase())}</text>`) : "";
  parts.push(nameSvg);
  if (nameSvg && taglineOf(sty)) parts.push(P.wrap("tagline", `<text${fitAttr(cw)} x="${n(cx)}" y="${n(bandH * 0.52 + 22 * u)}" text-anchor="middle" font-family="${card.body}" font-weight="800" font-size="${n(7.5 * u)}" letter-spacing="${n(2.6 * u)}" fill="${card.accent}" fill-opacity="0.75">${esc(taglineOf(sty))}</text>`));
  // The number, big, and its par on a tag in the tee's color (each when shown)
  let y = bandH + 34 * u;
  if (show("number")) {
    at = parts.length;
    const over = P.head("number", "HOLE").trim();
    if (over) parts.push(`<text${fitAttr(cw)} x="${n(cx)}" y="${n(y)}" text-anchor="middle" font-family="${card.head}" font-weight="700" font-size="${n(13 * u)}" letter-spacing="${n(3 * u)}" fill="${soft}">${esc(over)}</text>`);
    const numSize = 132 * u;
    // (kept under HOLE whatever the font: as tall as it can be with a little room under the word)
    parts.push(`<text${fitAttr(cw)}${capAttr(numSize * 0.86 - 6 * u)} x="${n(cx)}" y="${n(y + numSize * 0.86)}" text-anchor="middle" font-family="${card.head}" font-weight="700" font-size="${n(numSize)}" fill="${card.ink}">${st.label}</text>`);
    y += numSize * 0.86 + 14 * u;
    P.group(parts, at, "number");
  }
  const tagW = 112 * u, tagH = 30 * u;
  if (show("par")) {
  at = parts.length;
  parts.push(`<rect x="${n(cx - tagW / 2)}" y="${n(y)}" width="${n(tagW)}" height="${n(tagH)}" rx="${n(tagH / 2)}" data-fill="1" fill="${lvl.color}" stroke="${lvl.color === "#f8fafc" ? card.ink : lvl.color}" stroke-width="${n(1.2 * u)}"/>`);
  parts.push(`<text${fitAttr(tagW - 14 * u)} x="${n(cx)}" y="${n(y + tagH / 2)}" text-anchor="middle" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(17 * u)}" letter-spacing="${n(1 * u)}" fill="${lvl.ink}">PAR ${st.complete ? st.par : "–"}</text>`);
  y += tagH;
  P.group(parts, at, "par");
  } else y -= 30 * u;
  // The hole's name under the par, when it has one
  const hn = hole.name?.trim();
  if (hn) {
    parts.push(P.wrap("holeName", `<text${fitAttr(cw)} x="${n(cx)}" y="${n(y + 24 * u)}" text-anchor="middle" font-family="${card.head}" font-weight="600" font-size="${n(16 * u)}" letter-spacing="${n(0.6 * u)}" fill="${card.ink}">${esc(hn)}</text>`));
    y += 28 * u;
  }
  y += 30 * u;
  // The length from each tee
  const rule = (yy: number) => parts.push(`<line x1="${n(mx)}" x2="${n(col.w - mx)}" y1="${n(yy)}" y2="${n(yy)}" stroke="${card.ink}" stroke-opacity="0.18" stroke-width="${n(1 * u)}"/>`);
  // (a heading as its piece has it: typed in its settings, or none once cleared)
  const label = (text: string, yy: number) => { if (text.trim()) parts.push(`<text${fitAttr(cw * 0.6)} x="${n(mx)}" y="${n(yy)}" font-family="${card.head}" font-weight="700" font-size="${n(10.5 * u)}" letter-spacing="${n(1.8 * u)}" fill="${soft}">${esc(text.trim())}</text>`); };
  at = parts.length;
  rule(y - 14 * u);
  if (show("lengths")) {
  for (const { t, len } of lens) {
    const L = teeLevelOf(doc.style, t.level), main = t.id === mainTee?.id, rowH = main ? 30 * u : 24 * u;
    parts.push(`<circle cx="${n(mx + 8 * u)}" cy="${n(y + rowH / 2 - 4 * u)}" r="${n((main ? 8 : 6.5) * u)}" fill="${L.color}" stroke="${card.ink}" stroke-opacity="0.5" stroke-width="${n(1 * u)}"/>`);
    parts.push(`<text${fitAttr(cw * 0.45)} x="${n(mx + 24 * u)}" y="${n(y + rowH / 2 - 4 * u)}" dominant-baseline="central" font-family="${card.head}" font-weight="${main ? 700 : 600}" font-size="${n((main ? 15 : 12.5) * u)}" letter-spacing="${n(1 * u)}" fill="${card.ink}">${esc(teeName(doc, t.level).toUpperCase())}</text>`);
    parts.push(`<text${fitAttr(cw * 0.5)} x="${n(col.w - mx)}" y="${n(y + rowH / 2 - 4 * u)}" text-anchor="end" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n((main ? 22 : 15) * u)}" fill="${card.ink}">${len ? big(len) : "–"}</text>`);
    y += rowH;
  }
  y += 10 * u;
  rule(y);
  y += 22 * u;
  }
  P.group(parts, at, "lengths");
  // The ground along the hole
  if (st.complete && show("elevation")) {
    at = parts.length;
    label(`${P.head("elevation", "ELEVATION")} ${fmtElev(st.elevationChange, doc.units).toUpperCase()}`, y);
    parts.push(`<text${fitAttr(cw * 0.45)} x="${n(col.w - mx)}" y="${n(y)}" text-anchor="end" font-family="${card.head}" font-weight="600" font-size="${n(10.5 * u)}" letter-spacing="${n(1 * u)}" fill="${soft}">${esc([P.word("elevation", "plays", "PLAYS LIKE").trim(), big(st.playsLike)].filter(Boolean).join(" "))}</text>`);
    parts.push(elevationProfile(doc, st.line, { x: mx, y: y + 8 * u, w: cw, h: 40 * u }, { fill: sty.fairway, stroke: card.ink, tee: lvl.color, basket: sty.basket, width: 1.6 * u }));
    y += 66 * u;
    rule(y);
    y += 22 * u;
    P.group(parts, at, "elevation");
  }
  // Hole notes
  const notes = [hole.notes ?? "", ...(hole.notes ? [] : autoRules(doc, holeId))].filter(Boolean).join(" ");
  if (notes && show("notes")) {
    at = parts.length;
    label(P.head("notes", "HOLE NOTES"), y);
    const fs = 9.5 * u;
    const lines = wrap(notes, Math.max(12, Math.floor(cw / (fs * 0.5)))).slice(0, 4);
    lines.forEach((l, i) => parts.push(`<text${fitAttr(cw)} x="${n(mx)}" y="${n(y + 18 * u + i * fs * 1.4)}" font-family="${card.body}" font-weight="500" font-size="${n(fs)}" fill="${card.ink}">${esc(l)}</text>`));
    y += 18 * u + lines.length * fs * 1.4 + 12 * u;
    rule(y);
    y += 14 * u;
    P.group(parts, at, "notes");
  }
  at = parts.length;
  // The course in miniature, in the map's colors: this hole picked out, "you are here" at its tee
  const done = map.stats.filter(x => x.complete);
  const bottom = H - 44 * u;
  if (sign.spot === "courseMap" && done.length > 1 && bottom - y > 90 * u) {
    parts.push(miniCourseMap(doc, holeId, st, done, { x: mx, y, w: cw, h: bottom - y }, card, lvl, u));
  }
  // Or the green up close: the painted ground round the basket, turned as the hole's map is
  if (sign.spot === "green" && st.complete && bottom - y > 90 * u) {
    label(P.head("spot", "THE GREEN"), y);
    parts.push(greenView(doc, holeId, map, { x: mx, y: y + 10 * u, w: cw, h: bottom - y - 10 * u }, opts, u, sign));
  }
  // Or the hole's numbers, each on a tile
  if (sign.spot === "stats" && st.complete && bottom - y > 70 * u) {
    const walkTo = next?.complete ? dist(st.line[st.line.length - 1], next.line[0]) : null;
    const tiles = statTiles(P, [big(st.playsLike), fmtElev(st.elevationChange, doc.units).toUpperCase(), big(hole.fairwayWidth), walkTo === null ? "–" : big(walkTo)]);
    const gap = 10 * u, tw = (cw - gap) / 2, th = Math.min(74 * u, (bottom - y - gap) / 2);
    const out = tiles.map(([k, v], i) => {
      const tx = mx + (i % 2) * (tw + gap), ty = y + Math.floor(i / 2) * (th + gap);
      return `<rect x="${n(tx)}" y="${n(ty)}" width="${n(tw)}" height="${n(th)}" rx="${n(10 * u)}" fill="${card.ink}" fill-opacity="0.06" stroke="${card.ink}" stroke-opacity="0.14" stroke-width="${n(1 * u)}"/>`
        + `<text${fitAttr(tw - 24 * u)} x="${n(tx + 12 * u)}" y="${n(ty + 20 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(9 * u)}" letter-spacing="${n(1.6 * u)}" fill="${soft}">${esc(k)}</text>`
        + `<text${fitAttr(tw - 24 * u)} x="${n(tx + 12 * u)}" y="${n(ty + th - 14 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(Math.min(26 * u, th * 0.42))}" fill="${card.ink}">${esc(v)}</text>`;
    });
    parts.push(`<g data-part="hole-stats">${out.join("")}</g>`);
  }
  P.group(parts, at, "spot");
  // Which hole of how many, and who designed the course
  if (show("holeOf")) parts.push(P.wrap("holeOf", `<text${fitAttr(cw * 0.5)} x="${n(mx)}" y="${n(H - 20 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(9 * u)}" letter-spacing="${n(1.4 * u)}" fill="${soft}">${esc(holeOfText(doc, st.label, map.stats))}</text>`));
  if (doc.designer && show("designer")) parts.push(P.wrap("designer", `<text${fitAttr(cw * 0.5)} x="${n(col.w - mx)}" y="${n(H - 20 * u)}" text-anchor="end" font-family="${card.body}" font-weight="600" font-size="${n(7.5 * u)}" letter-spacing="${n(0.8 * u)}" fill="${soft}">${esc(designedBy(P, doc.designer))}</text>`));
  parts.push(signExtras(doc, holeId, st, W, H, P.wrap));
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};
