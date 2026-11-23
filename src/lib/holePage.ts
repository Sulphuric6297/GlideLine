// Hole pages: one page per hole, like a yardage book or a scoring app's hole map. The hole drawn
// in the map's style with the tee at the bottom (the tee signs' hole map), its number, par, the
// length from each tee color, the elevation change and how long it plays, the hole notes and a
// small elevation profile. Pages for print (Letter, A4, a 4 × 6 in card) and a square picture for
// sharing; pure SVG, like the course map.
import { fitAttr, capAttr } from "./fitText";
import { FT_PER_M, TEE_LEVELS } from "../constants";
import type { CourseDoc, PinPosition, TeeLevel, Units } from "../types";
import { activeLayout, holeBaskets, holeTees, taglineOf, throwLine } from "./course";
import { dist, rotatePoint } from "./geom";
import { holeStats } from "./holeStats";
import { markingsInView, northArrow, palette, scaleBar, wrapSvg } from "./mapSvg";
import { autoRules, cardStyle, teeName, courseNameAs, elevationProfile as profile, holeFacts, holeMap, holeOfText, obKey, type SignArt } from "./teeSign";
import { fmtDist, fmtElev } from "./units";
import { extrasSvg, followName, piecer } from "./pieces";

export type HolePageSize = "letter" | "a4" | "card" | "square";
/** Page sizes (inches) and the resolution of their pictures (the square one is 1080 px). */
export const HOLE_PAGES: Record<HolePageSize, { label: string; w: number; h: number; dpi: number }> = {
  letter: { label: "Letter, 8.5 × 11 in", w: 8.5, h: 11, dpi: 300 },
  a4: { label: "A4, 210 × 297 mm", w: 8.27, h: 11.69, dpi: 300 },
  card: { label: "Yardage book card, 4 × 6 in", w: 4, h: 6, dpi: 300 },
  square: { label: "Square picture, 1080 px (social media)", w: 7.5, h: 7.5, dpi: 144 }
};

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** "350 FT" / "107 M". */
const big = (ft: number, units: Units) => `${Math.round(units === "m" ? ft / FT_PER_M : ft).toLocaleString()} ${units === "m" ? "M" : "FT"}`;

/** Each tee's length to the layout's pin (longest tee first), and each pin's from the layout's tee
 * when the hole has more than one. */
export const holeLengths = (doc: CourseDoc, holeId: string) => {
  const hole = doc.holes.find(h => h.id === holeId)!;
  const layout = activeLayout(doc);
  const baskets = holeBaskets(doc, holeId);
  const basket = baskets.find(b => b.position === layout?.pin) ?? baskets[0];
  const st = holeStats(doc, hole, layout);
  const len = (tee: TeeLevel, pin: PinPosition) => holeStats(doc, hole, { id: "page", name: "", tee, pin }).length;
  return {
    tees: basket ? holeTees(doc, holeId).map(t => ({ level: t.level, length: len(t.level, basket.position) })) : [],
    pins: baskets.length > 1 ? baskets.map(b => ({ position: b.position, length: len(st.level, b.position) })) : []
  };
};

/** Wraps text into lines of at most `max` characters. */
const wrap = (text: string, max: number) => {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
};

/** Hole page looks: everything (the usual page), or just the hole (its picture across the page and
 * its number; every other piece left out to start with, a click away in Layers). */
export const HOLE_PAGE_LOOKS = [{ id: "standard", label: "Everything" }, { id: "justhole", label: "Just the hole" }] as const;
const JUST_THE_HOLE = new Set(["map", "number"]);

/** A hole's page settings: its look, and each piece's place (the hole's own over the course's;
 * just the hole leaves out what it doesn't show until it's asked for). */
export const holePageOf = (doc: Pick<CourseDoc, "style" | "holes"> & Partial<Pick<CourseDoc, "items">>, holeId: string) => {
  const g = doc.style.holePage ?? {}, h = doc.holes.find(x => x.id === holeId)?.page ?? {};
  const look = g.look ?? "standard";
  // (left out until asked for: "HOLE 3" beside the number's disc, and the length in the header
  // when the one tee's chip has it)
  const oneTee = () => !!doc.items && holeTees(doc as CourseDoc, holeId).length === 1 && holeBaskets(doc as CourseDoc, holeId).length > 0;
  return {
    look,
    place: followName((id: string) => {
      const p = h.layout?.[id] ?? g.layout?.[id];
      if (p?.hidden !== undefined) return p;
      if (look === "justhole" ? !JUST_THE_HOLE.has(id) : id === "holeTitle" || (id === "length" && oneTee())) return { ...p, hidden: true };
      return p;
    })
  };
};

/** One hole's page. Null for a hole that isn't there. */
export const renderHolePage = (doc: CourseDoc, holeId: string, size: HolePageSize, art: SignArt) => {
  const { header: DARK, paper: PAPER, ink: INK, soft: SOFT, head: HEAD, body: BODY, accent: ACCENT } = cardStyle(doc);
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return null;
  const page = HOLE_PAGES[size];
  const W = page.w * 72, H = page.h * 72;
  const u = Math.min(W, H) / 612;
  const square = Math.abs(W - H) < 1;
  const m = 22 * u;
  const units = doc.units;
  const sty = doc.style;
  const pal = palette(sty);
  const parts: string[] = [];
  const tees = holeTees(doc, holeId);
  const lengths = holeLengths(doc, holeId);
  // (each piece its own, to move, size or restyle on the page)
  const setup = holePageOf(doc, holeId), justHole = setup.look === "justhole";
  const P = piecer(setup.place, W, H, `hp${holeId}`);
  let at = 0;

  // Where things go: a header band, a band of tee lengths, the map across the page, and the
  // footer (on the square picture the tee lengths go in the footer, beside the profile)
  const headH = (square ? 84 : 96) * u;
  const teeH = square ? 0 : 50 * u;
  const footH = square ? 92 * u : 146 * u;
  const box = justHole ? { x: 0, y: 0, w: W, h: H } : { x: 0, y: headH + teeH, w: W, h: H - headH - teeH - footH };
  const uid = `hp${holeId.replace(/[^a-zA-Z0-9]/g, "").slice(-6)}`;
  const map = holeMap(doc, holeId, { w: box.w, h: box.h }, art, 1.1 * u, uid);
  const st = map.st;
  const mainTee = tees.find(t => t.id === st.teeId) ?? tees[0];
  const lvl = TEE_LEVELS[mainTee?.level ?? st.level];
  const done = st.complete;

  parts.push(`<rect width="${n(W)}" height="${n(H)}" fill="${PAPER}"/>`);
  parts.push(P.wrap("map", `<clipPath id="${uid}-clip"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}"/></clipPath><g clip-path="url(#${uid}-clip)" data-part="map"><g transform="translate(${n(box.x)} ${n(box.y)})">${map.svg}</g></g>`));
  // Just the hole: its number, big, in the corner over the picture
  if (justHole) {
    const fs = 150 * u;
    parts.push(P.wrap("number", `<text${fitAttr(W * 0.6)}${capAttr(fs * 0.78 + m * 0.6)} x="${n(m * 1.4)}" y="${n(m * 1.2 + fs * 0.78)}" font-family="${HEAD}" font-weight="700" font-size="${n(fs)}" fill="#ffffff" stroke="#0b120a" stroke-opacity="0.35" stroke-width="${n(3 * u)}" paint-order="stroke">${st.label}</text>`));
  }

  // Header: the number on a disc in the tee's color, the course, "HOLE 7" and its name, the par
  // and the length
  parts.push(P.wrap("band", `<rect width="${n(W)}" height="${n(headH)}" fill="${DARK}" data-fill="1"/><rect y="${n(headH - 4 * u)}" width="${n(W)}" height="${n(4 * u)}" fill="${lvl.color}"/>`));
  const r = headH * 0.34;
  const cx = m + r, cy = headH * 0.48;
  if (!justHole) parts.push(P.wrap("number", `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${lvl.color}" data-fill="1" stroke="#ffffff" stroke-width="${n(3.5 * u)}"/><text${fitAttr(r * 1.7)} x="${n(cx)}" y="${n(cy + r * 0.04)}" text-anchor="middle" dominant-baseline="central" font-family="${HEAD}" font-weight="700" font-size="${n(r * 1.2)}" fill="${lvl.ink}">${st.label}</text>`));
  const tx = cx + r + 16 * u;
  const right = W - m;
  const parSize = 34 * u;
  const cn = courseNameAs(sty, BODY), course = cn.caps((sty.title || doc.name || "").trim());
  const room = right - tx - parSize * 3.2;
  const courseSize = Math.min(9.5 * u, (room / Math.max(1, course.length)) * 1.6);
  const nameSvg = course ? P.wrap("courseName", `<text${fitAttr(room)} x="${n(tx)}" y="${n(headH * 0.26)}" font-family="${cn.font}" font-weight="600" font-size="${n(courseSize)}" letter-spacing="${n(cn.spaced ? courseSize * 0.12 : 0)}" fill="${ACCENT}">${esc(course)}</text>`) : "";
  parts.push(nameSvg);
  // (the tagline under the course's name: a piece of its own, only with the name)
  if (nameSvg && taglineOf(sty)) parts.push(P.wrap("tagline", `<text${fitAttr(room)} x="${n(tx)}" y="${n(headH * 0.26 + 10 * u)}" font-family="${BODY}" font-weight="800" font-size="${n(6 * u)}" letter-spacing="${n(1.6 * u)}" fill="${ACCENT}" fill-opacity="0.7">${esc(taglineOf(sty))}</text>`));
  const titled = !P.hidden("holeTitle");
  parts.push(P.wrap("holeTitle", `<text${fitAttr(room)} x="${n(tx)}" y="${n(headH * (hole.name ? 0.6 : 0.68))}" font-family="${HEAD}" font-weight="700" font-size="${n(32 * u)}" fill="#ffffff">HOLE ${st.label}</text>`));
  if (hole.name) {
    // (under "HOLE 3"; or, without it, the hole's name big in its place)
    const nameSize = Math.min(titled ? 13 * u : 24 * u, (room / Math.max(1, hole.name.length)) * 1.8);
    parts.push(P.wrap("holeName", `<text${fitAttr(room)} x="${n(tx)}" y="${n(headH * (titled ? 0.84 : 0.72))}" font-family="${HEAD}" font-weight="${titled ? 500 : 700}" font-size="${n(nameSize)}" fill="${titled ? ACCENT : "#ffffff"}">${esc(hole.name)}</text>`));
  }
  parts.push(P.wrap("par", `<text${fitAttr(parSize * 3)} x="${n(right)}" y="${n(headH * 0.5)}" text-anchor="end" font-family="${HEAD}" font-weight="700" font-size="${n(parSize)}" fill="#ffffff">PAR ${done ? st.par : "–"}</text>`));
  parts.push(P.wrap("length", `<text${fitAttr(parSize * 4.5)} x="${n(right)}" y="${n(headH * 0.8)}" text-anchor="end" font-family="${HEAD}" font-weight="600" font-size="${n(15 * u)}" letter-spacing="${n(0.8 * u)}" fill="${ACCENT}">${done ? big(st.length, units) : esc(P.head("length", "UNFINISHED"))}</text>`));

  // Lengths from each tee (chips in the tee colors), the elevation change, how it plays, the pins
  const chips = (x0: number, y: number) => {
    let x = x0;
    const h = 18 * u, fs = 10 * u;
    for (const t of lengths.tees) {
      const L = TEE_LEVELS[t.level];
      const text = `${teeName(doc, t.level).toUpperCase()} ${big(t.length, units)}`;
      const w = text.length * fs * 0.52 + 18 * u;
      if (x + w > W - m) break;
      parts.push(`<g data-part="tee-length"><rect x="${n(x)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="${L.color}" stroke="#151a14" stroke-width="${n(0.8 * u)}" stroke-opacity="${L.color === "#f8fafc" ? 1 : 0.35}"/><text${fitAttr(w - 10 * u)} x="${n(x + w / 2)}" y="${n(y + 0.5 * u)}" text-anchor="middle" dominant-baseline="central" font-family="${HEAD}" font-weight="600" font-size="${n(fs)}" fill="${L.ink}">${esc(text)}</text></g>`);
      x += w + 6 * u;
    }
  };
  if (!square) { at = parts.length; chips(m, headH + 15 * u); P.group(parts, at, "lengths"); }
  const facts = done ? [`ELEVATION ${fmtElev(st.elevationChange, units).toUpperCase()}`, `PLAYS LIKE ${big(st.playsLike, units)}`] : [];
  if (lengths.pins.length) facts.push(`PINS ${lengths.pins.map(p => `${p.position} ${Math.round(units === "m" ? p.length / FT_PER_M : p.length)}`).join(" · ")}`);
  if (!square && facts.length) parts.push(P.wrap("facts", `<text${fitAttr(W - 2 * m)} x="${n(m)}" y="${n(headH + 38 * u)}" font-family="${BODY}" font-weight="700" font-size="${n(9.5 * u)}" letter-spacing="${n(0.4 * u)}" fill="${SOFT}">${esc(facts.join("   ·   "))}</text>`));

  // On the map: north, the scale, the way to the next tee
  const mapTop = box.y;
  const mapBottom = box.y + box.h;
  parts.push(P.wrap("north", `<g transform="translate(${n(W - 26 * u)} ${n(mapTop + 30 * u)}) rotate(${n(-map.rotation)})">${northArrow(0, 0, 13 * u, pal)}</g>`));
  parts.push(P.wrap("scale", scaleBar(12 * u, mapBottom - 12 * u, map.scale * P.sizeOf("map"), 0.9 * u, pal, units)));
  const next = map.stats[map.stats.indexOf(st) + 1];
  if (next?.complete && done) {
    const from = st.line[st.line.length - 1], to = next.line[0];
    const d = dist(from, to);
    const dir = rotatePoint({ x: to.x - from.x, y: to.y - from.y }, -map.rotation);
    const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const px = W - 74 * u, py = mapBottom - 24 * u;
    parts.push(P.wrap("nextTee", `<g data-part="next-tee"><rect x="${n(px - 62 * u)}" y="${n(py - 14 * u)}" width="${n(124 * u)}" height="${n(28 * u)}" rx="${n(14 * u)}" fill="#0b120a" fill-opacity="0.85"/><g transform="translate(${n(px - 42 * u)} ${n(py)}) rotate(${n(ang)})"><path d="M${n(-8 * u)} 0H${n(6 * u)}M${n(1 * u)} ${n(-5.5 * u)}L${n(7 * u)} 0L${n(1 * u)} ${n(5.5 * u)}" stroke="#fff" stroke-width="${n(2.8 * u)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g><text${fitAttr(88 * u)} x="${n(px - 26 * u)}" y="${n(py)}" dominant-baseline="central" font-family="${HEAD}" font-weight="600" font-size="${n(10.5 * u)}" fill="#fff">HOLE ${next.number} · ${esc(fmtDist(d, units).toUpperCase())}</text></g>`));
  }

  // Elevation profile and notes
  const line = done ? throwLine(hole, mainTee ?? null, holeBaskets(doc, holeId).find(b => b.id === st.basketId) ?? null) : [];
  // (none: nothing there, rather than words the hole doesn't have)
  const notes = [hole.notes ?? "", ...(hole.notes ? [] : autoRules(doc, holeId))].filter(Boolean).join(" ");
  const elevHead = P.head("elevation", "ELEVATION").trim(), notesHead = P.head("notes", "HOLE NOTES").trim();
  if (square) {
    const y = H - footH;
    parts.push(P.wrap("footer", `<rect y="${n(y)}" width="${n(W)}" height="${n(footH)}" fill="${DARK}" data-fill="1"/>`));
    const pw = W * 0.28;
    parts.push(P.wrap("elevation", profile(doc, line, { x: m, y: y + 16 * u, w: pw, h: footH - 32 * u }, { fill: sty.fairway, stroke: "#ffffff", tee: lvl.color, basket: sty.basket, width: 1.8 * u })));
    const nx = m + pw + 18 * u;
    at = parts.length;
    chips(nx, y + 20 * u);
    P.group(parts, at, "lengths");
    parts.push(P.wrap("facts", `<text${fitAttr(W - nx - m)} x="${n(nx)}" y="${n(y + 46 * u)}" font-family="${HEAD}" font-weight="600" font-size="${n(12 * u)}" letter-spacing="${n(0.6 * u)}" fill="#ffffff">${esc(facts.join("  ·  "))}</text>`));
    const maxChars = Math.max(12, Math.floor((W - m - nx) / (9.5 * u * 0.55)));
    at = parts.length;
    wrap(notes, maxChars).slice(0, 2).forEach((l, i) => parts.push(`<text${fitAttr(W - nx - m)} x="${n(nx)}" y="${n(y + 64 * u + i * 13 * u)}" font-family="${BODY}" font-size="${n(9.5 * u)}" fill="#e5e7eb">${esc(l)}</text>`));
    P.group(parts, at, "notes");
  } else {
    const y = H - footH;
    parts.push(P.wrap("footer", `<rect y="${n(y)}" width="${n(W)}" height="${n(footH)}" fill="${PAPER}" data-fill="1"/><line x1="0" x2="${n(W)}" y1="${n(y)}" y2="${n(y)}" stroke="${INK}" stroke-opacity="0.2"/>`));
    // (the profile across the footer when there are no notes beside it)
    const pw = (W - 2 * m) * (notes && !P.hidden("notes") ? 0.5 : 1);
    at = parts.length;
    const elev = [elevHead, done ? fmtElev(st.elevationChange, units).toUpperCase() : ""].filter(Boolean).join(" ");
    if (elev) parts.push(`<text${fitAttr(pw)} x="${n(m)}" y="${n(y + 22 * u)}" font-family="${HEAD}" font-weight="700" font-size="${n(12 * u)}" letter-spacing="${n(0.8 * u)}" fill="${INK}">${esc(elev)}</text>`);
    parts.push(profile(doc, line, { x: m, y: y + 32 * u, w: pw, h: 60 * u }, { fill: sty.fairway, stroke: DARK, tee: lvl.color, basket: sty.basket, width: 1.8 * u }));
    const teeWord = P.word("elevation", "tee", "Tee").trim(), basketWord = P.word("elevation", "basket", "Basket").trim();
    if (done && teeWord) parts.push(`<text x="${n(m)}" y="${n(y + 106 * u)}" font-family="${BODY}" font-size="${n(8 * u)}" fill="${SOFT}">${esc(teeWord)}</text>`);
    if (done && basketWord) parts.push(`<text x="${n(m + pw)}" y="${n(y + 106 * u)}" text-anchor="end" font-family="${BODY}" font-size="${n(8 * u)}" fill="${SOFT}">${esc(basketWord)}</text>`);
    P.group(parts, at, "elevation");
    const nx = m + pw + 22 * u, nw = W - m - nx;
    at = parts.length;
    if (notes && notesHead) parts.push(`<text${fitAttr(nw)} x="${n(nx)}" y="${n(y + 22 * u)}" font-family="${HEAD}" font-weight="700" font-size="${n(12 * u)}" letter-spacing="${n(0.8 * u)}" fill="${INK}">${esc(notesHead)}</text>`);
    const fs = 9.5 * u;
    wrap(notes, Math.max(10, Math.floor(nw / (fs * 0.52)))).slice(0, 6).forEach((l, i) => parts.push(`<text${fitAttr(nw)} x="${n(nx)}" y="${n(y + (notesHead ? 40 : 22) * u + i * fs * 1.35)}" font-family="${BODY}" font-size="${n(fs)}" fill="${INK}">${esc(l)}</text>`));
    P.group(parts, at, "notes");
    // Bottom line: what the colors mean, and which hole of how many
    const by = H - 10 * u;
    const shown = markingsInView(doc, map.view);
    const key = [shown.ob && `${obKey(sty)} OB`, shown.hazard && `<tspan fill="${sty.hazard}">■</tspan> Hazard`, shown.mando && `<tspan fill="#f97316">●</tspan> Mando / DZ`].filter(Boolean).join("   ");
    parts.push(P.wrap("legend", `<text${fitAttr(W * 0.6)} x="${n(m)}" y="${n(by)}" font-family="${BODY}" font-size="${n(7.5 * u)}" fill="${SOFT}">${key}</text>`));
    parts.push(P.wrap("holeOf", `<text${fitAttr(W * 0.35)} x="${n(W - m)}" y="${n(by)}" text-anchor="end" font-family="${BODY}" font-size="${n(7.5 * u)}" fill="${SOFT}">${esc(holeOfText(doc, st.label, map.stats))}</text>`));
  }
  parts.push(extrasSvg(sty.holePage?.extras, sty.sponsors, holeId, holeFacts(doc, holeId, st), W, H, cardStyle(doc).font, P.wrap, INK));
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};
