// Tee sign looks beyond the first (lib/teeSign). Trailhead: the sign as a trail's marker, a
// forest-green panel with the hole's number on a cream tab, the painted hole in a cream frame, each
// tee's length on a chip, then the climb, the rules and the way on. Tall signs stack it; wide ones
// set the hole on the left and the rest beside it, with the spot under the chips as picked.
import { fitAttr } from "./fitText";
import { FT_PER_M, TEE_LEVELS } from "../constants";
import type { BasketItem, CourseDoc } from "../types";
import { holeTees, taglineOf } from "./course";
import { dist, rotatePoint } from "./geom";
import { holeStats, type HoleStats } from "./holeStats";
import { northArrow, palette, scaleBar, wrapSvg } from "./mapSvg";
import { fmtElev } from "./units";
import { piecer } from "./pieces";
import { autoRules, bigLength, teeName, cardStyle, courseNameAs, designedBy, elevationProfile, esc, greenView, holeMap, holeOfText, miniCourseMap, signExtras, signOf, SIGN_SIZES, statTiles, wrap, type SignArt, type SignSize } from "./teeSign";

const n = (v: number) => (Math.round(v * 100) / 100).toString();
type Box = { x: number; y: number; w: number; h: number };

/** Each tee's length to the hole's basket (the main tee's as the hole's own). */
const teeLengths = (doc: CourseDoc, holeId: string, st: HoleStats) => {
  const hole = doc.holes.find(h => h.id === holeId)!, tees = holeTees(doc, holeId);
  const basket = doc.items.find(i => i.id === st.basketId && i.type === "basket") as BasketItem | undefined;
  const main = tees.find(t => t.id === st.teeId) ?? tees[0];
  return tees.map(t => ({ t, main: t.id === main?.id, len: t.id === main?.id ? st.length : basket ? holeStats(doc, hole, { id: "x", name: "", tee: t.level, pin: basket.position }).length : 0 }));
};

export const renderTrailhead = (doc: CourseDoc, holeId: string, size: SignSize, opts: SignArt) => {
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return null;
  const page = SIGN_SIZES[size];
  const W = page.w * 72, H = page.h * 72, wide = W > H;
  const u = Math.min(W, H) / 864; // 1 on a 12 in side
  const card = cardStyle(doc), sign = signOf(doc, holeId), show = sign.show, sty = doc.style;
  const cream = card.paper, green = card.header;
  const pad = 26 * u, frame = 9 * u, T = (wide ? 124 : 118) * u;
  const big = (ft: number) => bigLength(ft, doc.units);
  const parts: string[] = [`<rect width="${n(W)}" height="${n(H)}" fill="${green}"/>`];
  // (each piece its own, to move, size or restyle on the page)
  const P = piecer(sign.place, W, H, `th${holeId}`);
  let at = 0;

  // Where things go: wide, the hole on the left and the rest beside it; tall, all stacked
  const chipH = 92 * u, footH = 74 * u;
  const mapBox: Box = wide
    ? { x: pad, y: pad, w: W * 0.4, h: H - 2 * pad }
    : { x: pad, y: pad + T + 22 * u, w: W - 2 * pad, h: H - (pad + T + 22 * u) - (chipH + 18 * u + footH) - pad };
  const col: Box = wide ? { x: mapBox.x + mapBox.w + 26 * u, y: pad, w: W - (mapBox.x + mapBox.w + 26 * u) - pad, h: H - 2 * pad } : { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };

  // The painted hole, in its cream frame
  const inner: Box = { x: mapBox.x + frame, y: mapBox.y + frame, w: mapBox.w - 2 * frame, h: mapBox.h - 2 * frame };
  const map = holeMap(doc, holeId, { w: inner.w, h: inner.h }, opts, 1.5 * u, `th${holeId.slice(-4)}`, true);
  const st = map.st;
  const lens = teeLengths(doc, holeId, st);
  const lvl = TEE_LEVELS[lens.find(l => l.main)?.t.level ?? "blue"];
  const clip = `thmap${holeId.slice(-4)}`;
  at = parts.length;
  parts.push(`<rect x="${n(mapBox.x)}" data-fill="1" y="${n(mapBox.y)}" width="${n(mapBox.w)}" height="${n(mapBox.h)}" rx="${n(20 * u)}" fill="${cream}"/>`);
  parts.push(`<clipPath id="${clip}"><rect x="${n(inner.x)}" y="${n(inner.y)}" width="${n(inner.w)}" height="${n(inner.h)}" rx="${n(13 * u)}"/></clipPath><g clip-path="url(#${clip})" data-part="hole-map"><g transform="translate(${n(inner.x)} ${n(inner.y)})">${map.svg}</g></g>`);
  P.group(parts, at, "map");
  if (show("north")) parts.push(P.wrap("north", `<g transform="translate(${n(inner.x + inner.w - 30 * u)} ${n(inner.y + 34 * u)}) rotate(${n(-map.rotation)})">${northArrow(0, 0, 18 * u, palette(sty))}</g>`));
  if (show("scale")) parts.push(P.wrap("scale", scaleBar(inner.x + 14 * u, inner.y + inner.h - 16 * u, map.scale * P.sizeOf("map"), 1.1 * u, palette(sty), doc.units)));
  // The way to the next tee, on the map's corner
  const next = map.stats[map.stats.indexOf(st) + 1];
  if (show("nextTee") && next?.complete && st.complete) {
    const from = st.line[st.line.length - 1], to = next.line[0];
    const dir = rotatePoint({ x: to.x - from.x, y: to.y - from.y }, -map.rotation);
    const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const cx = inner.x + inner.w - 96 * u, cy = inner.y + inner.h - 30 * u;
    at = parts.length;
    parts.push(`<g data-part="next-tee"><rect x="${n(cx - 80 * u)}" y="${n(cy - 19 * u)}" width="${n(160 * u)}" height="${n(38 * u)}" rx="${n(19 * u)}" fill="${green}" fill-opacity="0.92"/>`
      + `<g transform="translate(${n(cx - 56 * u)} ${n(cy)}) rotate(${n(ang)})"><path d="M${n(-11 * u)} 0H${n(9 * u)}M${n(3 * u)} ${n(-7 * u)}L${n(10 * u)} 0L${n(3 * u)} ${n(7 * u)}" fill="none" stroke="${cream}" stroke-width="${n(3 * u)}" stroke-linecap="round" stroke-linejoin="round"/></g>`
      + `<text${fitAttr(110 * u)} x="${n(cx - 36 * u)}" y="${n(cy)}" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(16 * u)}" letter-spacing="${n(1 * u)}" fill="${cream}">HOLE ${esc(next.label)} · ${esc(big(dist(from, to)))}</text></g>`);
    P.group(parts, at, "nextTee");
  }

  // The number on its cream tab; the course and par over the hole's name
  if (show("number")) {
    at = parts.length;
    parts.push(`<rect x="${n(col.x)}" y="${n(col.y)}" width="${n(T)}" height="${n(T)}" rx="${n(22 * u)}" fill="${cream}" data-fill="1"/>`);
    parts.push(`<text${fitAttr(T * 0.86)} x="${n(col.x + T / 2)}" y="${n(col.y + T / 2 + T * 0.03)}" text-anchor="middle" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(T * (st.label.length > 2 ? 0.5 : 0.72))}" fill="${green}">${esc(st.label)}</text>`);
    P.group(parts, at, "number");
  }
  const nx = col.x + (show("number") ? T + 20 * u : 0), nw = col.x + col.w - nx;
  const course = (sty.title || doc.name || "").trim().replace(/\s+disc\s+golf(\s+course)?$/i, "");
  // The hole's name big, the course's name and the par over it, each a piece of its own (typing
  // on the big title names the hole; on the line over it, the course). A hole without a name of
  // its own: the course's name as its title
  const named = hole.name?.trim() ?? "";
  const titleIsCourse = !named && show("courseName") && !!course;
  const title = named || (titleIsCourse ? course : `Hole ${st.label}`);
  const cn = courseNameAs(sty, card.head);
  const kick = show("courseName") && !titleIsCourse && course ? cn.caps(course) : "";
  const par = show("par") ? `PAR ${st.complete ? st.par : "–"}` : "";
  const kSize = Math.min(17 * u, (nw / Math.max(8, kick.length + par.length + 4)) * 1.6), ky = col.y + T * 0.36;
  // (the par at the line's end when the course's name is on it, else where the line starts)
  const parW = par.length * kSize * 0.86;
  if (kick) parts.push(P.wrap("courseName", `<text${fitAttr(par ? nw - parW - 16 * u : nw)} x="${n(nx)}" y="${n(ky)}" font-family="${cn.font}" font-weight="600" font-size="${n(kSize)}" letter-spacing="${n(cn.spaced ? kSize * 0.24 : 0)}" fill="${card.accent}" fill-opacity="0.85">${esc(kick)}</text>`));
  if (par) parts.push(P.wrap("par", `<text${fitAttr(parW)} x="${n(kick ? nx + nw : nx)}" y="${n(ky)}"${kick ? ` text-anchor="end"` : ""} font-family="${card.head}" font-weight="600" font-size="${n(kSize)}" letter-spacing="${n(kSize * 0.24)}" fill="${card.accent}" fill-opacity="0.85">${esc(par)}</text>`));
  const tSize = Math.min(52 * u, (nw / Math.max(4, title.length)) * 1.9);
  const titleSvg = P.wrap(titleIsCourse ? "courseName" : "holeName", `<text${fitAttr(nw)} x="${n(nx)}" y="${n(col.y + T * 0.82)}" font-family="${titleIsCourse ? cn.font : card.head}" font-weight="700" font-size="${n(tSize)}" fill="${cream}">${esc(title)}</text>`);
  parts.push(titleSvg);
  // The tagline under the course's name (a piece of its own, only with the name)
  const tag = taglineOf(sty);
  if (tag && (titleIsCourse ? titleSvg : kick && !P.hidden("courseName"))) {
    const tagY = titleIsCourse ? col.y + T * 0.82 + 16 * u : ky + 13 * u;
    parts.push(P.wrap("tagline", `<text${fitAttr(nw)} x="${n(nx)}" y="${n(tagY)}" font-family="${card.body}" font-weight="800" font-size="${n(8 * u)}" letter-spacing="${n(2.4 * u)}" fill="${card.accent}" fill-opacity="0.65">${esc(tag)}</text>`));
  }

  // Each tee's length on a chip (wide: and what it plays like, when that differs)
  const chips = show("lengths") ? lens.map(l => ({ label: teeName(doc, l.t.level).toUpperCase(), value: l.len ? big(l.len) : "–", color: TEE_LEVELS[l.t.level].color })) : [];
  const playsWord = P.word("lengths", "plays", "PLAYS LIKE").trim();
  if (st.complete && show("elevation") && Math.abs(st.playsLike - st.length) >= 10 && chips.length < 4 && !(wide && sign.spot === "stats")) chips.push({ label: playsWord, value: big(st.playsLike), color: sty.fairway });
  const chipY = wide ? col.y + T + 24 * u : mapBox.y + mapBox.h + 18 * u;
  at = parts.length;
  if (chips.length) {
    const gap = 12 * u, cw = Math.min(300 * u, (col.w - gap * (chips.length - 1)) / chips.length);
    chips.forEach((c, i) => {
      const x = col.x + i * (cw + gap);
      parts.push(`<g data-part="tee-chip"><rect x="${n(x)}" y="${n(chipY)}" width="${n(cw)}" height="${n(chipH)}" rx="${n(12 * u)}" fill="${cream}"/>`
        + `<rect x="${n(x + 10 * u)}" y="${n(chipY + 10 * u)}" width="${n(cw - 20 * u)}" height="${n(7 * u)}" rx="${n(3.5 * u)}" fill="${c.color}"${c.color === "#f8fafc" ? ` stroke="${card.ink}" stroke-opacity="0.3" stroke-width="${n(1 * u)}"` : ""}/>`
        + `<text${fitAttr(cw - 24 * u)} x="${n(x + 12 * u)}" y="${n(chipY + 38 * u)}" font-family="${card.head}" font-weight="600" font-size="${n(13 * u)}" letter-spacing="${n(2.6 * u)}" fill="${card.soft}">${esc(c.label)}</text>`
        + `<text${fitAttr(cw - 24 * u)} x="${n(x + 12 * u)}" y="${n(chipY + 78 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(Math.min(40 * u, cw * 0.3))}" fill="${card.ink}">${esc(c.value)}</text></g>`);
    });
  }
  P.group(parts, at, "lengths");

  // The climb and what it plays like; the rules
  const facts = [
    show("elevation") && st.complete && `${st.elevationChange >= 0 ? "▲" : "▼"} ${fmtElev(st.elevationChange, doc.units).replace(/^[+-]/, st.elevationChange >= 0 ? "+" : "−").toUpperCase()}`,
  ].filter(Boolean) as string[];
  const rules = show("notes") ? [hole.notes ?? "", ...(hole.notes ? [] : autoRules(doc, holeId))].filter(Boolean).join(" ") : "";
  const of = show("holeOf") ? holeOfText(doc, st.label, map.stats) : "";

  if (wide) {
    // The spot under the chips: the green or the course beside the climb, the hole's numbers, or the climb alone
    const top = chipY + (chips.length ? chipH + 22 * u : 0), bottom = col.y + col.h - footH;
    const panel = (b: Box, label: string, body: string, part: string) =>
      `<g data-part="${part}"><rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(14 * u)}" fill="${cream}" fill-opacity="0.07" stroke="${cream}" stroke-opacity="0.16" stroke-width="${n(1.2 * u)}"/>`
      + (label ? `<text${fitAttr(b.w - 28 * u)} x="${n(b.x + 14 * u)}" y="${n(b.y + 24 * u)}" font-family="${card.head}" font-weight="600" font-size="${n(12 * u)}" letter-spacing="${n(2.8 * u)}" fill="${card.accent}" fill-opacity="0.85">${esc(label)}</text>` : "") + `${body}</g>`;
    const inside = (b: Box): Box => ({ x: b.x + 12 * u, y: b.y + 36 * u, w: b.w - 24 * u, h: b.h - 48 * u });
    // (the climb no taller than half its width: a few feet never look like a mountain)
    const low = (b: Box): Box => { const h = Math.min(b.h, b.w * 0.5); return { ...b, y: b.y + b.h - h, h }; };
    const climb = (b: Box) => panel(b, `ELEVATION${st.complete ? ` · ${fmtElev(st.elevationChange, doc.units).toUpperCase()}` : ""}`, st.complete ? elevationProfile(doc, st.line, low(inside(b)), { fill: sty.fairway, stroke: cream, tee: lvl.color, basket: sty.basket, width: 1.8 * u }) : "", "climb");
    at = parts.length;
    if (bottom - top > 120 * u) {
      const h = bottom - top, half = (col.w - 14 * u) / 2;
      const left: Box = { x: col.x, y: top, w: half, h }, right: Box = { x: col.x + half + 14 * u, y: top, w: half, h };
      const done = map.stats.filter(x => x.complete);
      if (sign.spot === "green" && st.complete) {
        parts.push(panel(left, P.head("spot", "THE GREEN").trim(), greenView(doc, holeId, map, inside(left), opts, u, sign, cream), "spot-green"));
        if (show("elevation")) parts.push(climb(right));
      } else if (sign.spot === "courseMap" && done.length > 1) {
        parts.push(panel(left, "THE COURSE", miniCourseMap(doc, holeId, st, done, inside(left), card, lvl, u), "spot-course"));
        if (show("elevation")) parts.push(climb(right));
      } else if (sign.spot === "stats" && st.complete) {
        const walkTo = next?.complete ? dist(st.line[st.line.length - 1], next.line[0]) : null;
        const tiles = statTiles(P, [big(st.playsLike), fmtElev(st.elevationChange, doc.units).toUpperCase(), big(hole.fairwayWidth), walkTo === null ? "–" : big(walkTo)]);
        const gap = 14 * u, tw = (col.w - gap) / 2, th = (h - gap) / 2;
        parts.push(`<g data-part="hole-stats">${tiles.map(([k, v], i) => {
          const b: Box = { x: col.x + (i % 2) * (tw + gap), y: top + Math.floor(i / 2) * (th + gap), w: tw, h: th };
          return panel(b, k, `<text${fitAttr(b.w - 28 * u)} x="${n(b.x + 14 * u)}" y="${n(b.y + b.h - 18 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(Math.min(64 * u, b.h * 0.45))}" fill="${cream}">${esc(v)}</text>`, "stat");
        }).join("")}</g>`);
      } else if (show("elevation")) parts.push(climb({ x: col.x, y: top, w: col.w, h }));
    }
    P.group(parts, at, "spot");
    // Along the bottom: the climb, the rules, which hole of how many
    const line = [...facts, rules].filter(Boolean).join("   ·   ");
    const fs = 15 * u;
    const lines = wrap(line, Math.max(16, Math.floor((col.w - (of ? 150 * u : 0)) / (fs * 0.52)))).slice(0, 2);
    at = parts.length;
    lines.forEach((l, i) => parts.push(`<text${fitAttr(col.w - (of ? 160 * u : 0))} x="${n(col.x)}" y="${n(col.y + col.h - footH + 34 * u + i * fs * 1.45)}" font-family="${card.body}" font-weight="500" font-size="${n(fs)}" fill="${cream}" fill-opacity="0.88">${esc(l)}</text>`));
    P.group(parts, at, "notes");
    if (of) parts.push(P.wrap("holeOf", `<text${fitAttr(150 * u)} x="${n(col.x + col.w)}" y="${n(col.y + col.h - footH + 34 * u)}" text-anchor="end" font-family="${card.head}" font-weight="600" font-size="${n(12 * u)}" letter-spacing="${n(2.4 * u)}" fill="${card.accent}" fill-opacity="0.75">${esc(of)}</text>`));
  } else {
    // Under the chips: the climb and which hole of how many, then the rules
    const fy = chipY + chipH + 34 * u;
    if (facts.length) parts.push(P.wrap("elevation", `<text${fitAttr(col.w * 0.6)} x="${n(col.x)}" y="${n(fy)}" font-family="${card.head}" font-weight="600" font-size="${n(17 * u)}" letter-spacing="${n(1.4 * u)}" fill="${cream}">${esc(facts.join("    "))}</text>`));
    if (of) parts.push(P.wrap("holeOf", `<text${fitAttr(col.w * 0.35)} x="${n(col.x + col.w)}" y="${n(fy)}" text-anchor="end" font-family="${card.head}" font-weight="600" font-size="${n(13 * u)}" letter-spacing="${n(2.6 * u)}" fill="${card.accent}" fill-opacity="0.75">${esc(of)}</text>`));
    const fs = 14.5 * u;
    at = parts.length;
    wrap(rules, Math.max(16, Math.floor(col.w / (fs * 0.52)))).slice(0, 2).forEach((l, i) => parts.push(`<text${fitAttr(col.w)} x="${n(col.x)}" y="${n(fy + 26 * u + i * fs * 1.4)}" font-family="${card.body}" font-weight="500" font-size="${n(fs)}" fill="${cream}" fill-opacity="0.85">${esc(l)}</text>`));
    P.group(parts, at, "notes");
  }
  if (doc.designer && show("designer")) parts.push(P.wrap("designer", `<text${fitAttr(W * 0.4)} x="${n(W - pad)}" y="${n(H - 10 * u)}" text-anchor="end" font-family="${card.body}" font-weight="600" font-size="${n(9 * u)}" letter-spacing="${n(0.8 * u)}" fill="${cream}" fill-opacity="0.5">${esc(designedBy(P, doc.designer))}</text>`));
  parts.push(signExtras(doc, holeId, st, W, H, P.wrap, cream));
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};

/** "UPHILL 12 FT", "DOWNHILL 4 FT", or "FLAT". */
const climbOf = (ft: number, units: "ft" | "m" = "ft") => {
  const e = fmtElev(ft, units);
  return e === "level" ? "FLAT" : `${ft >= 0 ? "UPHILL" : "DOWNHILL"} ${e.replace(/^[+−-]/, "").toUpperCase()}`;
};

/** Field guide: cream paper and dark ink like a naturalist's guide: the course's name over a rule,
 * the hole's number big in a serif, each tee's length with a dotted leader, the green up close and
 * the climb beside the painted hole, the rules in italics at the foot. */
export const renderFieldGuide = (doc: CourseDoc, holeId: string, size: SignSize, opts: SignArt) => {
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return null;
  const page = SIGN_SIZES[size];
  const W = page.w * 72, H = page.h * 72, wide = W > H;
  const u = Math.min(W, H) / 864;
  const card = cardStyle(doc), sign = signOf(doc, holeId), show = sign.show, sty = doc.style;
  const paper = card.paper, ink = card.ink, green = card.header;
  // (its own serif, until the General tab's headings font is picked)
  const serif = sty.card?.font ? card.head : "Bitter, Georgia, serif";
  const pad = 34 * u;
  const parts: string[] = [`<rect width="${n(W)}" height="${n(H)}" fill="${paper}"/>`];
  // (each piece its own, to move, size or restyle on the page)
  const P = piecer(sign.place, W, H, `fg${holeId}`);
  let at = 0;
  // The head: the course's name in spaced capitals over a rule, the hole's number in italics
  const headY = pad + 26 * u;
  const course = (sty.title || doc.name || "").trim(), cn = courseNameAs(sty, card.body);
  const nameSvg = show("courseName") ? P.wrap("courseName", `<text${fitAttr((W - 2 * pad) * 0.7)} x="${n(pad)}" y="${n(headY)}" font-family="${cn.font}" font-weight="700" font-size="${n(15 * u)}" letter-spacing="${n(cn.spaced ? 4 * u : 0)}" fill="${ink}">${esc(cn.caps(course))}</text>`) : "";
  parts.push(nameSvg);
  parts.push(P.wrap("rule", `<line x1="${n(pad)}" x2="${n(W - pad)}" y1="${n(headY + 14 * u)}" y2="${n(headY + 14 * u)}" stroke="${ink}" stroke-width="${n(2 * u)}"/>`));
  // (the tagline under the rule: a piece of its own, only with the name)
  if (nameSvg && taglineOf(sty)) parts.push(P.wrap("tagline", `<text${fitAttr((W - 2 * pad) * 0.7)} x="${n(pad)}" y="${n(headY + 27 * u)}" font-family="${card.body}" font-weight="700" font-size="${n(8 * u)}" letter-spacing="${n(2.4 * u)}" fill="${ink}" fill-opacity="0.6">${esc(taglineOf(sty))}</text>`));
  // (the rules in two lines at most, "…" where they're cut; two lines take a little more of the foot)
  const rules = show("notes") ? [hole.notes ?? "", ...(hole.notes ? [] : autoRules(doc, holeId))].filter(Boolean).join(" ") : "";
  const ruleLines = wrap(rules, Math.floor((W - 2 * pad - 160 * u) / (15 * u * 0.5)));
  const noteLines = ruleLines.length > 2 ? [ruleLines[0], `${ruleLines[1].replace(/[\s.,;:]+$/, "")}…`] : ruleLines;
  const lh = 19 * u, two = noteLines.length > 1 ? lh : 0;
  const top = headY + 34 * u, foot = 50 * u + two;
  // The hole on the left (wide) or on top (tall), the column beside or under it
  const mapBox: Box = wide ? { x: pad, y: top, w: W * 0.5, h: H - top - pad - foot } : { x: pad, y: top, w: W - 2 * pad, h: (H - top - pad - foot) * 0.6 };
  const col: Box = wide ? { x: mapBox.x + mapBox.w + 30 * u, y: top, w: W - (mapBox.x + mapBox.w + 30 * u) - pad, h: mapBox.h } : { x: pad, y: mapBox.y + mapBox.h + 24 * u, w: W - 2 * pad, h: H - (mapBox.y + mapBox.h + 24 * u) - pad - foot };
  const map = holeMap(doc, holeId, { w: mapBox.w, h: mapBox.h }, opts, 1.5 * u, `fg${holeId.slice(-4)}`, true);
  const st = map.st;
  // (a piece of its own: hidden by its own eye, not with the big number)
  parts.push(P.wrap("numberTag", `<text${fitAttr(W * 0.25)} x="${n(W - pad)}" y="${n(headY)}" text-anchor="end" font-family="${serif}" font-style="italic" font-weight="700" font-size="${n(22 * u)}" fill="${ink}">${esc([P.head("numberTag", "No.").trim(), st.label].filter(Boolean).join(" "))}</text>`));
  const clip = `fgmap${holeId.slice(-4)}`;
  at = parts.length;
  parts.push(`<clipPath id="${clip}"><rect x="${n(mapBox.x)}" y="${n(mapBox.y)}" width="${n(mapBox.w)}" height="${n(mapBox.h)}" rx="${n(6 * u)}"/></clipPath><g clip-path="url(#${clip})" data-part="hole-map"><g transform="translate(${n(mapBox.x)} ${n(mapBox.y)})">${map.svg}</g></g>`);
  parts.push(`<rect x="${n(mapBox.x)}" y="${n(mapBox.y)}" width="${n(mapBox.w)}" height="${n(mapBox.h)}" rx="${n(6 * u)}" fill="none" stroke="${ink}" stroke-opacity="0.3" stroke-width="${n(1.2 * u)}"/>`);
  P.group(parts, at, "map");
  if (show("north")) parts.push(P.wrap("north", `<g transform="translate(${n(mapBox.x + mapBox.w - 28 * u)} ${n(mapBox.y + 30 * u)}) rotate(${n(-map.rotation)})">${northArrow(0, 0, 16 * u, palette(sty))}</g>`));
  if (show("scale")) parts.push(P.wrap("scale", scaleBar(mapBox.x + 12 * u, mapBox.y + mapBox.h - 14 * u, map.scale * P.sizeOf("map"), 1.1 * u, palette(sty), doc.units)));
  // The column: the number big, par and the hole's name, each tee's length with a dotted leader
  let y = col.y;
  const lens = teeLengths(doc, holeId, st);
  const lvl = TEE_LEVELS[lens.find(l => l.main)?.t.level ?? "blue"];
  const big = (ft: number) => `${Math.round(doc.units === "m" ? ft / FT_PER_M : ft).toLocaleString()} ${doc.units === "m" ? "m" : "ft"}`;
  if (wide) {
    const numSize = Math.min(150 * u, col.h * 0.3);
    if (show("number")) { parts.push(P.wrap("number", `<text${fitAttr(col.w)} x="${n(col.x)}" y="${n(y + numSize * 0.82)}" font-family="${serif}" font-weight="700" font-size="${n(numSize)}" fill="${green}">${esc(st.label)}</text>`)); y += numSize * 0.92; }
  }
  // (the par, and the hole's name under it in italics, each a piece of its own)
  if (show("par")) { parts.push(P.wrap("par", `<text${fitAttr(col.w)} x="${n(col.x)}" y="${n(y + 22 * u)}" font-family="${serif}" font-weight="700" font-size="${n(22 * u)}" fill="${ink}">Par ${st.complete ? st.par : "–"}</text>`)); y += 30 * u; }
  const hn = hole.name?.trim();
  if (hn) { parts.push(P.wrap("holeName", `<text${fitAttr(col.w)} x="${n(col.x)}" y="${n(y + 20 * u)}" font-family="${serif}" font-style="italic" font-weight="600" font-size="${n(19 * u)}" fill="${ink}" fill-opacity="0.85">${esc(hn)}</text>`)); y += 28 * u; }
  if (show("par") || hn) y += 14 * u;
  at = parts.length;
  if (show("lengths")) {
    for (const l of lens) {
      const L = TEE_LEVELS[l.t.level];
      parts.push(`<g data-part="tee-row"><circle cx="${n(col.x + 7 * u)}" cy="${n(y - 6 * u)}" r="${n(6 * u)}" fill="${L.color}" stroke="${ink}" stroke-opacity="0.4" stroke-width="${n(1 * u)}"/>`
        + `<text${fitAttr(56 * u)} x="${n(col.x + 20 * u)}" y="${n(y)}" font-family="${card.body}" font-weight="500" font-size="${n(15 * u)}" fill="${ink}">${esc(teeName(doc, l.t.level))}</text>`
        + `<line x1="${n(col.x + 80 * u)}" x2="${n(col.x + col.w - 90 * u)}" y1="${n(y - 2 * u)}" y2="${n(y - 2 * u)}" stroke="${ink}" stroke-opacity="0.45" stroke-width="${n(1.4 * u)}" stroke-dasharray="${n(1.5 * u)} ${n(4 * u)}"/>`
        + `<text${fitAttr(84 * u)} x="${n(col.x + col.w)}" y="${n(y)}" text-anchor="end" font-family="${card.body}" font-weight="700" font-size="${n(16 * u)}" fill="${ink}">${l.len ? esc(big(l.len)) : "–"}</text></g>`);
      y += 28 * u;
    }
    y += 8 * u;
  }
  P.group(parts, at, "lengths");
  // The green up close and the climb, side by side (wide) or the climb alone (tall)
  const left = col.y + col.h - y;
  if (wide && left > 140 * u && st.complete) {
    const half = (col.w - 14 * u) / 2, h = Math.min(left - 10 * u, half * 0.95);
    const gb: Box = { x: col.x, y, w: half, h }, eb: Box = { x: col.x + half + 14 * u, y, w: half, h };
    if (sign.spot !== "none") parts.push(P.wrap("spot", `<g data-part="spot-green">${greenView(doc, holeId, map, gb, opts, u, sign, ink)}</g>`));
    if (show("elevation")) {
      at = parts.length;
      parts.push(`<text${fitAttr(eb.w)} x="${n(eb.x)}" y="${n(eb.y + 14 * u)}" font-family="${card.body}" font-weight="700" font-size="${n(11 * u)}" letter-spacing="${n(2 * u)}" fill="${ink}">${esc(climbOf(st.elevationChange, doc.units))}</text>`);
      parts.push(elevationProfile(doc, st.line, { x: eb.x, y: eb.y + 26 * u, w: eb.w, h: Math.min(eb.h - 30 * u, eb.w * 0.5) }, { fill: sty.fairway, stroke: ink, tee: lvl.color, basket: sty.basket, width: 1.6 * u }));
      P.group(parts, at, "elevation");
    }
  } else if (!wide && show("elevation") && st.complete && left > 50 * u) {
    parts.push(P.wrap("elevation", elevationProfile(doc, st.line, { x: col.x, y, w: col.w, h: Math.min(left, 50 * u) }, { fill: sty.fairway, stroke: ink, tee: lvl.color, basket: sty.basket, width: 1.6 * u })));
  }
  // The foot: the rules in italics, the way on
  const next = map.stats[map.stats.indexOf(st) + 1];
  const fy = H - pad - 12 * u - two;
  parts.push(P.wrap("footRule", `<line x1="${n(pad)}" x2="${n(W - pad)}" y1="${n(fy - 26 * u)}" y2="${n(fy - 26 * u)}" stroke="${ink}" stroke-opacity="0.3" stroke-width="${n(1 * u)}"/>`));
  if (noteLines.length) parts.push(P.wrap("notes", noteLines.map((l, i) => `<text${fitAttr(W - 2 * pad - 170 * u)} x="${n(pad)}" y="${n(fy + i * lh)}" font-family="${serif}" font-style="italic" font-weight="600" font-size="${n(15 * u)}" fill="${ink}" fill-opacity="0.85">${esc(l)}</text>`).join("")));
  if (show("nextTee") && next?.complete && st.complete) {
    const to = [P.head("nextTee", "Next:").trim(), `${next.label} · ${big(dist(st.line[st.line.length - 1], next.line[0]))}`].filter(Boolean).join(" ");
    parts.push(P.wrap("nextTee", `<text${fitAttr(170 * u)} x="${n(W - pad)}" y="${n(fy)}" text-anchor="end" font-family="${serif}" font-style="italic" font-weight="600" font-size="${n(15 * u)}" fill="${ink}">${esc(to)}</text>`));
  }
  parts.push(signExtras(doc, holeId, st, W, H, P.wrap));
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};

/** Open view: the painted hole edge to edge, the course's name on a tag, the numbers on a soft dark
 * card along the foot, the way to the next tee over the map. */
export const renderOpenView = (doc: CourseDoc, holeId: string, size: SignSize, opts: SignArt) => {
  const hole = doc.holes.find(h => h.id === holeId);
  if (!hole) return null;
  const page = SIGN_SIZES[size];
  const W = page.w * 72, H = page.h * 72, wide = W > H;
  const u = Math.min(W, H) / 864;
  const card = cardStyle(doc), sign = signOf(doc, holeId), show = sign.show, sty = doc.style;
  const map = holeMap(doc, holeId, { w: W, h: H }, opts, 1.6 * u, `ov${holeId.slice(-4)}`, true);
  const st = map.st;
  // (each piece its own, to move, size or restyle on the page)
  const P = piecer(sign.place, W, H, `ov${holeId}`);
  const parts: string[] = [P.wrap("map", `<g data-part="hole-map">${map.svg}</g>`)];
  const pad = 24 * u, cream = card.paper;
  const course = (sty.title || doc.name || "").trim(), cn = courseNameAs(sty, card.head);
  if (show("courseName") && course) {
    const fs = 14 * u, w = course.length * fs * 0.72 + 30 * u;
    const nameSvg = P.wrap("courseName", `<rect x="${n(pad)}" y="${n(pad)}" width="${n(w)}" height="${n(34 * u)}" rx="${n(17 * u)}" fill="#0e1610" fill-opacity="0.72" data-fill="1"/><text${fitAttr(w - 30 * u)} x="${n(pad + 15 * u)}" y="${n(pad + 17 * u)}" dominant-baseline="central" font-family="${cn.font}" font-weight="600" font-size="${n(fs)}" letter-spacing="${n(cn.spaced ? 2.6 * u : 0)}" fill="${cream}">${esc(cn.caps(course))}</text>`);
    parts.push(nameSvg);
    // (the tagline under its tag: a piece of its own, only with the name)
    if (nameSvg && taglineOf(sty)) parts.push(P.wrap("tagline", `<text${fitAttr(W * 0.5)} x="${n(pad + 15 * u)}" y="${n(pad + 50 * u)}" font-family="${card.body}" font-weight="800" font-size="${n(8 * u)}" letter-spacing="${n(2.4 * u)}" fill="${cream}" stroke="#0e1610" stroke-opacity="0.6" stroke-width="${n(2.4 * u)}" paint-order="stroke">${esc(taglineOf(sty))}</text>`));
  }
  if (show("north")) parts.push(P.wrap("north", `<g transform="translate(${n(W - pad - 22 * u)} ${n(pad + 24 * u)}) rotate(${n(-map.rotation)})">${northArrow(0, 0, 18 * u, palette(sty))}</g>`));
  // The card: the number big, par and the climb, the hole's name, each tee's length as a chip,
  // the rules in a line or two under them
  const cw = wide ? Math.min(W * 0.46, 620 * u) : W - 2 * pad;
  const rules = show("notes") && !P.hidden("notes") ? [hole.notes ?? "", ...(hole.notes ? [] : autoRules(doc, holeId))].filter(Boolean).join(" ") : "";
  const nfs = 13 * u, nlh = 17 * u;
  const allLines = wrap(rules, Math.max(16, Math.floor((cw - 52 * u) / (nfs * 0.5))));
  const noteLines = allLines.length > 2 ? [allLines[0], `${allLines[1].replace(/[\s.,;:]+$/, "")}…`] : allLines;
  const ch = 190 * u + (noteLines.length ? 10 * u + (noteLines.length - 1) * nlh : 0);
  const cx = wide ? W - pad - cw : pad, cy = H - pad - ch;
  parts.push(P.wrap("card", `<rect x="${n(cx)}" y="${n(cy)}" width="${n(cw)}" height="${n(ch)}" rx="${n(22 * u)}" fill="#0e1610" fill-opacity="0.84" data-fill="1"/>`));
  const nx = cx + 26 * u;
  if (show("number")) parts.push(P.wrap("number", `<text${fitAttr(120 * u)} x="${n(nx)}" y="${n(cy + 104 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(108 * u)}" fill="#f0c46a">${esc(st.label)}</text>`));
  const tx = nx + (show("number") ? (st.label.length > 1 ? 130 : 78) * u : 0);
  const kick = [show("par") && `PAR ${st.complete ? st.par : "–"}`, show("elevation") && st.complete && `${st.elevationChange >= 0 ? "+" : "−"}${fmtElev(Math.abs(st.elevationChange), doc.units).replace(/^[+−-]/, "").toUpperCase()}`].filter(Boolean).join("  ·  ");
  if (kick) parts.push(P.wrap("par", `<text${fitAttr(cx + cw - tx - 20 * u)} x="${n(tx)}" y="${n(cy + 50 * u)}" font-family="${card.head}" font-weight="600" font-size="${n(15 * u)}" letter-spacing="${n(3 * u)}" fill="${cream}" fill-opacity="0.75">${esc(kick)}</text>`));
  const title = hole.name?.trim() || `Hole ${st.label}`;
  parts.push(P.wrap("holeName", `<text${fitAttr(cx + cw - tx - 20 * u)} x="${n(tx)}" y="${n(cy + 92 * u)}" font-family="${card.head}" font-weight="700" font-size="${n(Math.min(36 * u, ((cx + cw - tx - 20 * u) / Math.max(4, title.length)) * 1.9))}" fill="${cream}">${esc(title)}</text>`));
  let at = parts.length;
  if (show("lengths")) {
    const lens = teeLengths(doc, holeId, st);
    const gap = 10 * u, w = (cw - 52 * u - gap * (lens.length - 1)) / Math.max(1, lens.length);
    lens.forEach((l, i) => {
      const L = TEE_LEVELS[l.t.level], x = nx + i * (w + gap), y = cy + 128 * u;
      const v = bigLength(l.len, doc.units);
      parts.push(`<g data-part="tee-chip"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(40 * u)}" rx="${n(10 * u)}" fill="${L.color}"/><text${fitAttr(w - 10 * u)} x="${n(x + w / 2)}" y="${n(y + 20 * u)}" text-anchor="middle" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(20 * u)}" fill="${L.ink}">${l.len ? esc(v) : "–"}</text></g>`);
    });
  }
  P.group(parts, at, "lengths");
  if (noteLines.length) parts.push(P.wrap("notes", noteLines.map((l, i) => `<text${fitAttr(cw - 52 * u)} x="${n(nx)}" y="${n(cy + 190 * u - 6 * u + i * nlh)}" font-family="${card.body}" font-weight="500" font-size="${n(nfs)}" fill="${cream}" fill-opacity="0.85">${esc(l)}</text>`).join("")));
  // The way to the next tee, over the map
  const next = map.stats[map.stats.indexOf(st) + 1];
  if (show("nextTee") && next?.complete && st.complete) {
    const from = st.line[st.line.length - 1], to = next.line[0];
    const dir = rotatePoint({ x: to.x - from.x, y: to.y - from.y }, -map.rotation);
    const ang = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const ax = wide ? pad + 90 * u : W - pad - 90 * u, ay = wide ? H - pad - 26 * u : cy - 34 * u;
    at = parts.length;
    parts.push(`<g data-part="next-tee"><rect x="${n(ax - 80 * u)}" y="${n(ay - 19 * u)}" width="${n(160 * u)}" height="${n(38 * u)}" rx="${n(19 * u)}" fill="#0e1610" fill-opacity="0.8"/>`
      + `<g transform="translate(${n(ax - 56 * u)} ${n(ay)}) rotate(${n(ang)})"><path d="M${n(-11 * u)} 0H${n(9 * u)}M${n(3 * u)} ${n(-7 * u)}L${n(10 * u)} 0L${n(3 * u)} ${n(7 * u)}" fill="none" stroke="${cream}" stroke-width="${n(3 * u)}" stroke-linecap="round" stroke-linejoin="round"/></g>`
      + `<text${fitAttr(110 * u)} x="${n(ax - 36 * u)}" y="${n(ay)}" dominant-baseline="central" font-family="${card.head}" font-weight="700" font-size="${n(16 * u)}" letter-spacing="${n(1 * u)}" fill="${cream}">HOLE ${esc(next.label)} · ${esc(bigLength(dist(from, to), doc.units))}</text></g>`);
    P.group(parts, at, "nextTee");
  }
  parts.push(signExtras(doc, holeId, st, W, H, P.wrap, cream));
  return { svg: wrapSvg(W, H, P.page(parts.join(""))), width: W, height: H };
};
