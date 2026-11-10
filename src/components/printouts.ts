// The printouts laid out by hand, all edited one way: the course map, the tee signs, the hole
// pages and the scorecard. Each is a "target" here, with the same actions for what's picked on
// its page (its look's own pieces, and the text, pictures, QR codes and sponsors added to it):
// what it is and how it's styled, move, size, restyle, hide, delete, duplicate, reset. The
// editor (MapDesigner), its toolbar and its panel only talk to these.
import { generateId } from "../constants";
import { byNumber, holeLabel, taglineOf } from "../lib/course";
import { holePageOf } from "../lib/holePage";
import { playedHoles } from "../lib/holeStats";
import { requiredCredit, taglineFits } from "../lib/mapSvg";
import { followName, keepsItsSize, keepsItsTurn, sizedPlace, type Extra, type Place } from "../lib/pieces";
import { autoRules, hiddenAtFirst, isSheet, scorecardPlace, signOf, STAT_WORDS, type SignSize } from "../lib/teeSign";
import { changeDoc, getDoc, updateHole, useEditor } from "../state/course";
import type { CourseDoc, PrintExtra, SignPart } from "../types";
import { duplicateDesignSel, elementOf, elementLabel, isShown, moveDesignEl, patchImage, patchLabel, patchPage, patchText, removeDesignSel, setShown, sizeDesignEl } from "./PageEditor";

export type TargetKey = "map" | "sign" | "page" | "card";
type Box = { x: number; y: number; w: number; h: number };

/** Which printout the Design step shows. */
export const targetKey = (): TargetKey => {
  const t = useEditor.getState().designTab;
  return t === "sign" ? "sign" : t === "page" ? "page" : t === "scorecard" ? "card" : "map";
};

/** What's picked, as the toolbar shows it: what it is, and which of its settings it has (each
 * unset where it has none). */
export type Picked = {
  label: string;
  kind: "piece" | "text" | "image" | "qr" | "sponsor" | "label";
  /** Its size: times its own, or (`pt`) the letters' size. */
  scale?: number;
  pt?: number;
  font?: string;
  color?: string;
  fill?: string;
  bold?: boolean;
  align?: "start" | "middle" | "end";
  text?: string;
  url?: string;
  opacity?: number;
  italic?: boolean;
  /** Turned about its middle, degrees clockwise. */
  rot?: number;
  /** The holes something added is on (unset: every hole). */
  holes?: string[];
  /** It can have a font, lettering color, panel color (each settable even when unset)... */
  has: { font: boolean; color: boolean; fill: boolean; bold: boolean; italic: boolean; align: boolean; text: boolean; url: boolean; opacity: boolean; size: boolean; turn: boolean; holes: boolean };
  /** Delete takes it away (what was added) rather than hiding it. */
  removable: boolean;
  /** Whether it can be hidden (false: the map's credits while they hold only what the map's sources ask for). */
  hideable?: boolean;
  duplicable: boolean;
  /** It's been moved, sized or restyled (Reset puts it back). */
  changed: boolean;
  /** What its font is when none is picked for it, by name. */
  inherit: string;
  /** Its words can be more than one line. */
  lines: boolean;
  /** What its words box shows while it's empty. */
  placeholder?: string;
};
/** A row in Layers; `note`: why it isn't on the page shown, and `hole`, a hole it is on; `fixed`:
 * it can't be hidden (no eye); `typable`: its words can be typed (on the page, even while there
 * are none to show). */
export type Layer = { id: string; label: string; shown: boolean; changed: boolean; added: boolean; note?: string; hole?: string; fixed?: boolean; typable?: boolean };
export type Patch = Partial<Pick<Picked, "font" | "color" | "fill" | "bold" | "italic" | "align" | "text" | "url" | "opacity" | "rot" | "holes">>;

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const none = { font: false, color: false, fill: false, bold: false, italic: false, align: false, text: false, url: false, opacity: true, size: true, turn: true, holes: false };
const LABELS_FONT = "The map's labels font";

// ---------------------------------------------------------------- the hole shown, and "this hole only"

/** The hole whose sign or page the Design step shows. */
export const shownHole = (doc: CourseDoc) => {
  const { designHole, activeHoleId } = useEditor.getState();
  return [designHole, activeHoleId].find(id => id && doc.holes.some(h => h.id === id)) ?? doc.holes[0]?.id ?? null;
};
const thisHoleOnly = () => useEditor.getState().signScope === "hole";

/** The last tee sign size that isn't a sheet of paper (a look other than Classic goes back to it). */
let lastBoard: SignSize = "18x12";
export const rememberBoard = (s: SignSize) => { if (!isSheet(s)) lastBoard = s; };
export const boardSize = () => lastBoard;

/** A piece's words to type on the page, asked for by Layers (the editor opens its box). */
let askedTyping: string | null = null;
const typingSubs = new Set<() => void>();
export const askTyping = (id: string) => { askedTyping = id; typingSubs.forEach(f => f()); };
export const onAskTyping = (f: () => void) => { typingSubs.add(f); return () => { typingSubs.delete(f); }; };
export const takeTyping = () => { const id = askedTyping; askedTyping = null; return id; };

// ---------------------------------------------------------------- the pieces of each look

/** Every piece a sign, page or scorecard can have, by name (in the order Layers lists them). */
export const PIECES: { id: string; label: string; part?: SignPart }[] = [
  { id: "band", label: "Header band" }, { id: "card", label: "Info panel" },
  { id: "courseName", label: "Course name", part: "courseName" }, { id: "tagline", label: "Tagline" }, { id: "rule", label: "Divider under the name" },
  { id: "number", label: "Hole number", part: "number" }, { id: "numberTag", label: "Hole number tag" },
  { id: "holeTitle", label: "Hole title" }, { id: "par", label: "Par", part: "par" }, { id: "length", label: "Length" },
  { id: "holeName", label: "Hole name" }, { id: "facts", label: "Elevation and plays like" },
  { id: "lengths", label: "Lengths (each tee)", part: "lengths" }, { id: "elevation", label: "Elevation", part: "elevation" },
  { id: "elevationStrip", label: "Elevation strip" }, { id: "notes", label: "Hole notes", part: "notes" },
  { id: "spot", label: "Extra panel" }, { id: "map", label: "Hole picture" }, { id: "north", label: "North arrow", part: "north" },
  { id: "scale", label: "Scale bar", part: "scale" }, { id: "nextTee", label: "Way to the next tee", part: "nextTee" },
  { id: "footRule", label: "Divider over the notes" }, { id: "footer", label: "Footer panel" }, { id: "legend", label: "Legend", part: "legend" },
  { id: "holeOf", label: "Hole N of M", part: "holeOf" }, { id: "designer", label: "Designer", part: "designer" },
  { id: "logo", label: "Logo or name" }, { id: "fields", label: "Date, par and course lines" }, { id: "location", label: "Where the course is" },
  { id: "table", label: "Score table" }, { id: "cutLine", label: "Cut line" }
];
const byId = new Map(PIECES.map(p => [p.id, p]));
const LOOK_PIECES: Record<string, string[]> = {
  "classic-wide": ["map", "band", "courseName", "tagline", "number", "par", "holeName", "lengths", "elevation", "notes", "spot", "holeOf", "designer", "north", "nextTee", "elevationStrip"],
  "classic-tall": ["band", "number", "courseName", "tagline", "par", "holeName", "lengths", "map", "north", "scale", "nextTee", "elevation", "notes", "legend", "holeOf"],
  trailhead: ["map", "north", "scale", "nextTee", "number", "courseName", "tagline", "par", "holeName", "lengths", "spot", "elevation", "notes", "holeOf", "designer"],
  fieldguide: ["courseName", "rule", "tagline", "numberTag", "number", "par", "holeName", "map", "north", "scale", "lengths", "spot", "elevation", "footRule", "notes", "nextTee"],
  openview: ["map", "courseName", "tagline", "north", "card", "number", "par", "holeName", "lengths", "notes", "nextTee"],
  page: ["map", "band", "number", "courseName", "tagline", "holeTitle", "holeName", "par", "length", "lengths", "facts", "north", "scale", "nextTee", "footer", "elevation", "notes", "legend", "holeOf"],
  card: ["logo", "tagline", "fields", "location", "table", "cutLine"]
};
/** Which look's pieces the printout has (a sign on letter or A4 paper: always Classic). */
const lookKey = (doc: CourseDoc, t: TargetKey) => {
  if (t === "page" || t === "card") return t;
  const look = doc.style.sign?.look ?? "classic", size = doc.style.signSize ?? "18x12";
  return look !== "classic" && !isSheet(size) ? look : size === "18x12" ? "classic-wide" : "classic-tall";
};
const lookPieces = (doc: CourseDoc, t: TargetKey) => LOOK_PIECES[lookKey(doc, t)];

/** A piece's own printed words that can be typed, as its look prints them: its heading (`key`
 * "", kept as the place's `text`) and any other (kept by `key` in its `words`). */
type Word = { key: string; label: string; own: string };
const wordsIn = (doc: CourseDoc, t: TargetKey, id: string): Word[] => {
  const head = (own: string, label = "Heading"): Word => ({ key: "", label, own });
  const word = (key: string, own: string, label: string): Word => ({ key, label, own });
  if (t === "card") {
    if (id === "fields") return [word("date", "Date", "Date"), word("par", "Par", "Par"), word("course", "Course", "Course")];
    if (id !== "table") return [];
    const split = playedHoles(doc, doc.holes.map(h => ({ holeId: h.id, label: "" }))).length > 9;
    return [word("par", "Par", "Par row"), word("name", "Name", "Name row"), ...(split ? [word("front", "Front", "Front nine"), word("back", "Back", "Back nine")] : []), word("total", "Total", "Total")];
  }
  if (t === "page") {
    if (id === "notes") return [head("HOLE NOTES")];
    if (id === "elevation") return [head("ELEVATION"), word("tee", "Tee", "Tee end"), word("basket", "Basket", "Basket end")];
    if (id === "length") return [head("UNFINISHED", "Words while the hole isn't finished")];
    return [];
  }
  if (t !== "sign") return [];
  const k = lookKey(doc, t), h = shownHole(doc);
  const stats = h && signOf(doc, h).spot === "stats";
  const tiles = STAT_WORDS.map(([key, own]) => word(key, own, own.charAt(0) + own.slice(1).toLowerCase()));
  if ((k === "classic-wide" || k === "classic-tall") && id === "notes") return [head("HOLE NOTES")];
  if (k === "classic-wide") {
    if (id === "elevation") return [head("ELEVATION"), word("plays", "PLAYS LIKE", "Plays like")];
    if (id === "elevationStrip") return [head("ELEVATION CHANGE FROM TEE"), word("plays", "PLAYS LIKE", "Plays like")];
    if (id === "number") return [head("HOLE")];
    if (id === "spot") return stats ? tiles : [head("THE GREEN")];
    if (id === "designer") return [head("DESIGNED BY")];
  }
  if (k === "classic-tall" && id === "elevation") return [head("ELEVATION"), word("tee", "Tee", "Tee end"), word("basket", "Basket · plays like", "Basket end")];
  if (k === "trailhead") {
    if (id === "spot") return stats ? tiles : [head("THE GREEN")];
    if (id === "lengths") return [word("plays", "PLAYS LIKE", "Plays like")];
    if (id === "designer") return [head("DESIGNED BY")];
  }
  if (k === "fieldguide") {
    if (id === "numberTag") return [head("No.")];
    if (id === "nextTee") return [head("Next:")];
  }
  return [];
};

/** A piece's place on the shown hole's sign or page, or the scorecard. */
const placeOf = (doc: CourseDoc, t: TargetKey, id: string): Place | undefined => {
  if (t === "card") return scorecardPlace(doc)(id);
  const h = shownHole(doc);
  if (!h) return (t === "page" ? doc.style.holePage : doc.style.sign)?.layout?.[id];
  return t === "page" ? holePageOf(doc, h).place(id) : signOf(doc, h).place(id);
};
/** A piece's place changed (null: back to where its look puts it); every hole, or the shown one. */
const setPlace = (t: TargetKey, id: string, patch: Partial<Place> | null, history = true) => {
  const doc = getDoc(), h = shownHole(doc);
  const next = (lay: Record<string, Place> | undefined, now: Place | undefined) => {
    const all = { ...lay };
    if (patch === null) delete all[id];
    else all[id] = Object.fromEntries(Object.entries({ ...now, ...patch }).filter(([, v]) => v !== undefined)) as Place;
    return Object.keys(all).length ? all : undefined;
  };
  // (the tagline, until it's moved on its own, where its course name or logo is)
  const own = (lay: Record<string, Place> | undefined) => followName(k => lay?.[k], t === "card" ? "logo" : "courseName")(id);
  if (t === "card") return changeDoc(d => ({ style: { ...d.style, scorecard: { ...d.style.scorecard, layout: next(d.style.scorecard?.layout, own(d.style.scorecard?.layout)) } } }), history);
  const key = t === "page" ? "page" : "sign";
  if (thisHoleOnly() && h) {
    return changeDoc(d => ({ holes: d.holes.map(x => (x.id === h ? { ...x, [key]: { ...x[key], layout: next(x[key]?.layout, placeOf(d, t, id)) } } : x)) }), history);
  }
  const sk = t === "page" ? "holePage" : "sign";
  changeDoc(d => ({ style: { ...d.style, [sk]: { ...d.style[sk], layout: next(d.style[sk]?.layout, own(d.style[sk]?.layout)) } } }), history);
};
const pieceShown = (doc: CourseDoc, t: TargetKey, id: string) => {
  const h = shownHole(doc), part = t === "sign" ? byId.get(id)?.part : undefined;
  if (part && h && !signOf(doc, h).show(part)) return false;
  return !placeOf(doc, t, id)?.hidden;
};
const setPieceShown = (t: TargetKey, id: string, v: boolean) => {
  // (a hole page's and the scorecard's pieces through their place alone)
  if (t !== "sign") return setPlace(t, id, { hidden: v ? (t === "page" ? false : undefined) : true });
  const part = byId.get(id)?.part, doc = getDoc(), h = shownHole(doc);
  if (part && (!v || (h && !signOf(doc, h).show(part)))) {
    if (thisHoleOnly() && h) changeDoc(d => ({ holes: d.holes.map(x => (x.id === h ? { ...x, sign: { ...x.sign, show: { ...x.sign?.show, [part]: v } } } : x)) }));
    else changeDoc(d => ({ style: { ...d.style, sign: { ...d.style.sign, show: { ...d.style.sign?.show, [part]: v } } } }));
    if (v && placeOf(getDoc(), t, id)?.hidden) setPlace(t, id, { hidden: undefined });
    return;
  }
  // (one left out until asked for stays shown once it is)
  setPlace(t, id, { hidden: v ? (hiddenAtFirst(id) ? false : undefined) : true });
};
const placeChanged = (p?: Place) => !!p && Object.entries(p).some(([k, v]) => k !== "hidden" && v !== undefined);

// ---------------------------------------------------------------- what's added to each printout

/** The text, pictures, QR codes and sponsors added to a printout. */
export const extrasOf = (doc: CourseDoc, t: TargetKey = targetKey()): Extra[] =>
  (t === "map" ? doc.style.mapExtras : t === "card" ? doc.style.scorecard?.extras : t === "page" ? doc.style.holePage?.extras : doc.style.sign?.extras) ?? [];
const setExtras = (t: TargetKey, f: (xs: Extra[]) => Extra[], history = true) =>
  changeDoc(d => {
    const s = d.style;
    if (t === "map") return { style: { ...s, mapExtras: f(s.mapExtras ?? []) } };
    if (t === "card") return { style: { ...s, scorecard: { ...s.scorecard, extras: f(s.scorecard?.extras ?? []) } } };
    if (t === "page") return { style: { ...s, holePage: { ...s.holePage, extras: f(s.holePage?.extras ?? []) } } };
    return { style: { ...s, sign: { ...s.sign, extras: f(s.sign?.extras ?? []) } } };
  }, history);
const extraOf = (doc: CourseDoc, t: TargetKey, id: string) => (id.startsWith("x:") ? extrasOf(doc, t).find(x => x.id === id.slice(2)) : undefined);
export const patchExtra = (t: TargetKey, id: string, patch: Partial<Extra>, history = true) => setExtras(t, xs => xs.map(x => (x.id === id ? { ...x, ...patch } : x)), history);
const EXTRA_LABEL: Record<PrintExtra["kind"], string> = { text: "Text", image: "Picture", sponsors: "Hole sponsor", sponsor: "Sponsor", qr: "QR code" };
const extraLabel = (doc: CourseDoc, e: PrintExtra) =>
  e.kind === "text" ? (e.text ?? "").split("\n")[0].slice(0, 28) || "Text" : e.kind === "sponsor" ? doc.style.sponsors?.find(s => s.id === e.sponsorId)?.name ?? "Sponsor" : EXTRA_LABEL[e.kind];
/** A hole sponsor piece's heading as it prints without one typed. */
const sponsorsHead = (doc: CourseDoc, t: TargetKey) => {
  const h = t === "sign" || t === "page" ? shownHole(doc) : null;
  const here = (doc.style.sponsors ?? []).filter(sp => !h || !sp.holes?.length || sp.holes.includes(h));
  return here.length > 1 ? "HOLE SPONSORS" : "HOLE SPONSOR";
};

/** A setting the toolbar opens once a piece is picked (a new QR code's link, to type). */
let opening: { id: string; pop: "link" } | null = null;
export const takeOpening = (id: string) => { const o = opening?.id === id ? opening.pop : null; if (o) opening = null; return o; };

/** Something added near the middle of the page (each a step down and right of the one before, so
 * none lands on another), and picked. With "Hole N only" on, it's on that hole alone. */
export const addExtra = (e: Omit<PrintExtra, "id" | "x" | "y" | "w"> & Partial<PrintExtra>, t: TargetKey = targetKey()) => {
  const id = generateId(), h = shownHole(getDoc());
  const own = (t === "sign" || t === "page") && thisHoleOnly() && h && e.kind !== "sponsor" ? { holes: [h] } : {};
  setExtras(t, xs => { const k = xs.length % 6; return [...xs, { x: 0.3 + k * 0.05, y: 0.3 + k * 0.08, w: 0.24, ...own, ...e, id }]; });
  if (e.kind === "qr" && !e.url) opening = { id: `x:${id}`, pop: "link" };
  useEditor.getState().set({ designSel: `x:${id}` });
};

/** A sponsor taken off the course: off every printout too (none left behind with no one in it). */
export const removeSponsor = (sid: string) =>
  changeDoc(d => {
    const s = d.style, keep = (xs?: PrintExtra[]) => xs?.filter(x => !(x.kind === "sponsor" && x.sponsorId === sid));
    return {
      style: {
        ...s, sponsors: (s.sponsors ?? []).filter(x => x.id !== sid), mapExtras: keep(s.mapExtras),
        sign: s.sign && { ...s.sign, extras: keep(s.sign.extras) }, holePage: s.holePage && { ...s.holePage, extras: keep(s.holePage.extras) },
        scorecard: s.scorecard && { ...s.scorecard, extras: keep(s.scorecard.extras) }
      }
    };
  });

// ---------------------------------------------------------------- what the page shows

/** The pieces drawn on the page as it shows now (the editor says, once it's drawn): Layers tells
 * which of the rest aren't on it, and why. */
let drawnIds = new Set<string>(), drawnKey = "";
const drawnSubs = new Set<() => void>();
export const setDrawn = (ids: string[]) => {
  const k = ids.join("|");
  if (k === drawnKey) return;
  drawnKey = k;
  drawnIds = new Set(ids);
  drawnSubs.forEach(f => f());
};
export const onDrawn = (f: () => void) => { drawnSubs.add(f); return () => { drawnSubs.delete(f); }; };
export const drawnNow = () => drawnKey;

/** Why a piece of a look isn't on this page. */
const WHY: Record<string, string> = { holeName: "This hole has no name", designer: "No designer set", nextTee: "No next tee from here", notes: "No notes for this hole", location: "No place set", credit: "Nothing to credit yet" };

// ---------------------------------------------------------------- the actions

const textual = (e: PrintExtra) => e.kind === "text" || e.kind === "qr" || e.kind === "sponsor" || e.kind === "sponsors";

/** What's picked on printout `t`, for the toolbar (null: nothing there). */
export const pickedOf = (doc: CourseDoc, t: TargetKey, id: string): Picked | null => {
  const ex = extraOf(doc, t, id);
  if (ex) {
    const heads = ex.kind === "sponsors";
    return {
      label: extraLabel(doc, ex), kind: ex.kind === "sponsors" ? "sponsor" : ex.kind, pt: textual(ex) ? ex.size ?? (ex.kind === "qr" ? 12 : 24) : undefined,
      font: ex.font, color: ex.color, fill: ex.fill, bold: ex.bold, italic: ex.italic, align: ex.align, text: heads ? ex.text ?? sponsorsHead(doc, t) : ex.text, url: ex.url, opacity: ex.opacity, rot: ex.rot, holes: ex.holes,
      has: { font: textual(ex), color: textual(ex), fill: ex.kind === "text", bold: ex.kind === "text", italic: ex.kind === "text", align: ex.kind === "text", text: ex.kind === "text" || ex.kind === "qr" || heads, url: ex.kind === "qr", opacity: true, size: true, turn: true, holes: (t === "sign" || t === "page") && ex.kind !== "sponsor" },
      removable: true, duplicable: true, changed: !!ex.fill || !!ex.rot || ex.opacity !== undefined,
      inherit: t === "map" ? LABELS_FONT : "Headings font", lines: ex.kind === "text",
      placeholder: heads ? "A heading (or none)" : ex.kind === "qr" ? "Words under it (or none)" : "Type here"
    };
  }
  if (t === "map") {
    const e = elementOf(doc, id);
    if (!e) return null;
    if (e.kind === "label") return { label: elementLabel(doc, id), kind: "label", has: { ...none, size: false, opacity: false, turn: false }, removable: false, duplicable: false, changed: !!doc.style.labelAt?.[e.id], inherit: LABELS_FONT, lines: false };
    if (e.kind === "text") {
      const x = e.text;
      return { label: elementLabel(doc, id), kind: "text", pt: x.size, font: x.font, color: x.color, fill: x.bg, bold: x.bold, italic: x.italic, align: x.align, text: x.text, opacity: x.opacity, rot: x.rot, has: { ...none, font: true, color: true, fill: true, bold: true, italic: true, align: true, text: true }, removable: true, duplicable: true, changed: !!x.bg || !!x.rot || x.opacity !== undefined, inherit: LABELS_FONT, lines: true, placeholder: "Type here" };
    }
    if (e.kind === "image") return { label: "Picture", kind: "image", opacity: e.image.opacity, rot: e.image.rot, has: { ...none }, removable: true, duplicable: true, changed: !!e.image.rot || e.image.opacity !== undefined, inherit: LABELS_FONT, lines: false };
    const o = doc.style.page?.[e.id] ?? {}, s = doc.style;
    const panel = e.id === "holes" || e.id === "legend";
    // (its words: the title's lines, as they print, one each; the footer note; a panel's heading)
    const words = e.id === "title" ? titleLines(doc).join("\n") : e.id === "credit" ? s.footer : e.id === "legend" ? o.heading ?? "Legend" : e.id === "holes" ? o.heading ?? "" : undefined;
    const turn = e.id !== "map" && !keepsItsTurn(e.id);
    return {
      label: e.label, kind: "piece", scale: o.scale ?? 1, color: o.ink, fill: o.bg, text: words, opacity: o.opacity, rot: turn ? o.rot : undefined, font: e.id === "title" ? o.font : undefined,
      // (the map itself stays square and solid on its page; the title in a font of its own)
      has: { ...none, size: !keepsItsSize(e.id), font: e.id === "title", color: e.id === "title" || panel || e.id === "credit", fill: panel || e.id === "title", text: words !== undefined, opacity: e.id !== "map", turn },
      removable: false, hideable: e.id !== "credit" || !requiredCredit(doc) || !!s.footer?.trim(), duplicable: false,
      changed: o.x !== undefined || o.y !== undefined || o.scale !== undefined || !!o.ink || !!o.bg || (turn && !!o.rot) || o.opacity !== undefined || !!o.font,
      inherit: e.id === "title" ? "Course name font" : LABELS_FONT, lines: e.id === "title",
      placeholder: e.id === "title" ? "Name, tagline, and a line under them" : e.id === "holes" ? "A heading over the holes (or none)" : e.id === "legend" ? "A heading (or none)" : "Your own line (or none)"
    };
  }
  if (!byId.has(id)) return null;
  const p = placeOf(doc, t, id);
  const words = wordsOf(doc, t, id);
  // (the hole's picture and the extra panel hold the map's own labels: their lettering isn't the piece's)
  const lettered = id !== "map" && id !== "spot", turn = !keepsItsTurn(id);
  return {
    label: byId.get(id)!.label, kind: "piece", scale: p?.scale ?? 1, font: p?.font, color: p?.color, fill: p?.fill, bold: p?.bold, italic: p?.italic, opacity: p?.opacity, rot: turn ? p?.rot : undefined, text: words,
    has: { ...none, size: !keepsItsSize(id), font: lettered, color: lettered, fill: true, bold: lettered, italic: lettered, text: words !== undefined, turn }, removable: false, duplicable: false, changed: placeChanged(p),
    inherit: "The look's own", lines: id === "notes", placeholder: PLACEHOLDER[id]
  };
};
const PLACEHOLDER: Record<string, string> = { courseName: "The course's name", tagline: "A line under the course's name", holeName: "The hole's name", notes: "The hole's notes: OB, mandos, drop zones", designer: "Who designed the course", location: "Where the course is" };

/** The map title's last line as it shows: what's typed, or the place's name (none: " "). */
export const subtitleOf = (doc: CourseDoc) => (doc.style.subtitle?.trim() ? doc.style.subtitle.trim() : doc.style.subtitle ? "" : autoSubtitle(doc));
const autoSubtitle = (doc: CourseDoc) => [doc.site.location?.label, doc.designer ? `Designed by ${doc.designer}` : ""].filter(Boolean).join(" · ");
/** The course map title's lines, in order: the name, the tagline (where the name has room for
 * one), the line under them. */
const titleLines = (doc: CourseDoc) => [doc.style.title || doc.name, ...(taglineFits(doc) ? [doc.style.tagline ?? "Disc golf course"] : []), subtitleOf(doc)];

/** The words a sign's or page's piece shows, where they're kept (the course's name, the hole's
 * name and notes, the designer, the place): typed on the page, they change there. The course's
 * name as it prints: the map's title when it has one of its own, else the course's own name. */
const wordsOf = (doc: CourseDoc, t: TargetKey, id: string): string | undefined => {
  const hole = doc.holes.find(h => h.id === shownHole(doc));
  if (id === "courseName") return doc.style.title || doc.name;
  if (id === "tagline") return doc.style.tagline ?? "Disc golf course";
  if (t === "card") return id === "location" && doc.site.location ? doc.site.location.label : undefined;
  if (id === "holeName") return hole?.name ?? "";
  // (no notes of its own: the rules the sign works out from the map, as it prints them)
  if (id === "notes") return hole ? hole.notes ?? autoRules(doc, hole.id).join(" ") : undefined;
  if (id === "designer") return doc.designer ?? "";
  return undefined;
};
const setWords = (id: string, v: string, history: boolean) => {
  const hid = shownHole(getDoc());
  const text = id === "notes" ? v : v.replace(/\s*\n\s*/g, " ").trim();
  // (the name every printout shows: the printouts' own title, never the course's own name)
  if (id === "courseName") return changeDoc(d => ({ style: { ...d.style, title: text === d.name ? "" : text } }), history);
  if (id === "tagline") return changeDoc(d => (text.toLowerCase() === (d.style.tagline ?? "Disc golf course").toLowerCase() ? {} : { style: { ...d.style, tagline: text } }), history);
  if (id === "notes" && hid && text.trim() === autoRules(getDoc(), hid).join(" ")) return changeDoc(d => ({ holes: d.holes.map(h => (h.id === hid ? { ...h, notes: undefined } : h)) }), history);
  if (id === "designer") return changeDoc(() => ({ designer: text }), history);
  if (id === "location") return changeDoc(d => ({ site: { ...d.site, location: d.site.location ? { ...d.site.location, label: text } : null } }), history);
  if (hid) return changeDoc(d => ({ holes: d.holes.map(h => (h.id === hid ? { ...h, ...(id === "holeName" ? { name: text || undefined } : { notes: text || undefined }) } : h)) }), history);
};

/** A picked thing's settings changed. */
export const patchPicked = (t: TargetKey, id: string, p: Patch, history = true) => {
  const doc = getDoc(), ex = extraOf(doc, t, id);
  if (ex) {
    // (a hole sponsor piece's heading left as it prints by itself stays that way: one sponsor or more)
    if (ex.kind === "sponsors" && p.text !== undefined && p.text.trim() === sponsorsHead(doc, t)) return patchExtra(t, ex.id, { ...p, text: undefined }, history);
    return patchExtra(t, ex.id, p, history);
  }
  if (t === "map") {
    const e = elementOf(doc, id);
    if (e?.kind === "text") return patchText(e.text.id, { ...(p.font !== undefined || "font" in p ? { font: p.font } : {}), ...(p.color ? { color: p.color } : {}), ...("fill" in p ? { bg: p.fill, bgOpacity: p.fill ? e.text.bgOpacity ?? 0.85 : undefined } : {}), ...("bold" in p ? { bold: p.bold || undefined } : {}), ...("italic" in p ? { italic: p.italic || undefined } : {}), ...("align" in p ? { align: p.align === "start" ? undefined : p.align } : {}), ...(p.text !== undefined ? { text: p.text } : {}), ...("rot" in p ? { rot: p.rot || undefined } : {}), ...("opacity" in p ? { opacity: p.opacity } : {}) }, history);
    if (e?.kind === "image") return patchImage(e.image.id, { ...("opacity" in p ? { opacity: p.opacity } : {}), ...("rot" in p ? { rot: p.rot || undefined } : {}) }, history);
    if (e?.kind === "built" && p.text !== undefined) {
      const v = p.text;
      // (each line to its own setting: the name, the tagline where it has room, the line under
      // them; that line taken out stays out: " " is none, where "" is the place and designer)
      if (e.id === "title") {
        const lines = v.split("\n").map(l => l.trim()), fits = taglineFits(doc);
        const first = lines[0] ?? "", tag = fits ? lines[1] ?? "" : undefined, rest = lines.slice(fits ? 2 : 1).join(" ").trim();
        return changeDoc(d => ({
          style: {
            ...d.style, title: first === d.name ? "" : first,
            ...(tag === undefined || tag.toLowerCase() === (d.style.tagline ?? "Disc golf course").toLowerCase() ? {} : { tagline: tag }),
            subtitle: rest === subtitleOf(d) ? d.style.subtitle : rest || " "
          }
        }), history);
      }
      if (e.id === "credit") return changeDoc(d => ({ style: { ...d.style, footer: v.trim() } }), history);
      return patchPage(e.id, { heading: v.trim() || undefined }, history);
    }
    // (the title's own font: the course name font stays every printout's)
    if (e?.kind === "built" && e.id === "title" && "font" in p) return patchPage("title", { font: p.font || undefined }, history);
    if (e?.kind === "built") return patchPage(e.id, { ...("color" in p ? { ink: p.color } : {}), ...("fill" in p ? { bg: p.fill } : {}), ...("rot" in p ? { rot: p.rot || undefined } : {}), ...("opacity" in p ? { opacity: p.opacity } : {}) }, history);
    return;
  }
  if (p.text !== undefined && wordsOf(doc, t, id) !== undefined) return setWords(id, p.text, history);
  setPlace(t, id, { ...("font" in p ? { font: p.font } : {}), ...("color" in p ? { color: p.color } : {}), ...("fill" in p ? { fill: p.fill } : {}), ...("bold" in p ? { bold: p.bold } : {}), ...("italic" in p ? { italic: p.italic || undefined } : {}), ...("rot" in p ? { rot: p.rot || undefined } : {}), ...("opacity" in p ? { opacity: p.opacity } : {}) }, history);
};

/** A picked thing's own settings, in the toolbar's ⋯: the hole guide's columns (switches), a
 * hole's fairway (its number or distance picked on the course map), or the words of a heading its
 * look prints (typed; cleared: no heading). */
export type MoreItem =
  | { kind: "switch"; label: string; on: boolean; set: (v: boolean) => void }
  | { kind: "text"; label: string; value: string; placeholder: string; set: (v: string) => void };
export const moreOf = (doc: CourseDoc, t: TargetKey, id: string): MoreItem[] => {
  if (t === "map") {
    if (id === "title") return [{ kind: "switch", label: "Par and length", on: doc.style.page?.title?.parLength !== false, set: (v: boolean) => patchPage("title", { parLength: v ? undefined : false }) }];
    // (a hole's number or distance: its fairway, the same switch as the hole's panel in Design)
    const hole = /^label:(num|dist):/.test(id) ? doc.holes.find(h => h.id === id.split(":")[2]) : undefined;
    if (hole) return [{ kind: "switch", label: "Fairway", on: hole.fairway, set: (v: boolean) => updateHole(hole.id, { fairway: v }) }];
    if (id !== "holes") return [];
    const cols = doc.style.page?.holes?.columns ?? ["par", "lengths"];
    return ([["names", "Hole names"], ["par", "Par"], ["lengths", "Lengths"], ["elevation", "Elevation"]] as const).map(([c, label]) => ({
      kind: "switch" as const, label, on: cols.includes(c), set: (v: boolean) => patchPage("holes", { columns: v ? [...cols, c] : cols.filter(x => x !== c) })
    }));
  }
  const p = placeOf(doc, t, id);
  return wordsIn(doc, t, id).map(w => ({
    kind: "text" as const, label: w.label, value: (w.key ? p?.words?.[w.key] : p?.text) ?? w.own, placeholder: "None",
    set: (v: string) => {
      if (!w.key) return setPlace(t, id, { text: v === w.own ? undefined : v }, false);
      const words = { ...placeOf(getDoc(), t, id)?.words };
      if (v === w.own) delete words[w.key]; else words[w.key] = v;
      setPlace(t, id, { words: Object.keys(words).length ? words : undefined }, false);
    }
  }));
};

/** A line about what's picked, shown with its toolbar (null: none): on every hole while the
 * changes go to one hole, or that they go to it. */
export const noteOf = (doc: CourseDoc, t: TargetKey, id: string) => {
  const ex = extraOf(doc, t, id), h = shownHole(doc);
  if (!(t === "sign" || t === "page") || !thisHoleOnly() || !h) return null;
  if (ex && ex.kind !== "sponsor" && !ex.holes?.length) return "On every hole";
  return ex ? null : `Hole ${holeLabel(doc, h)} only`;
};

/** Moved by (dx, dy) page units; `box`: where it was, the page `W` × `H`. */
export const movePicked = (t: TargetKey, id: string, dx: number, dy: number, box: Box, W: number, H: number) => {
  const doc = getDoc(), ex = extraOf(doc, t, id);
  if (ex) return patchExtra(t, ex.id, { x: r4(ex.x + dx / W), y: r4(ex.y + dy / H) });
  if (t === "map") return moveDesignEl(id, { x: box.x / W, y: box.y / H }, dx / W, dy / H);
  const p = placeOf(doc, t, id);
  setPlace(t, id, { dx: r4((p?.dx ?? 0) + dx / W), dy: r4((p?.dy ?? 0) + dy / H) });
};

/** Sized `f` times about the page point `a` (which stays put); `box`: where it was. */
/** The size buttons on a QR code: its words only (its corners size the code and words together). */
export const sizeWordsPicked = (t: TargetKey, id: string, f: number) => {
  const ex = extraOf(getDoc(), t, id);
  if (!ex || ex.kind !== "qr") return false;
  patchExtra(t, ex.id, { size: Math.round(Math.max(4, Math.min(400, (ex.size ?? 12) * f)) * 10) / 10 });
  return true;
};

export const sizePicked = (t: TargetKey, id: string, f: number, a: { x: number; y: number }, box: Box, W: number, H: number) => {
  const doc = getDoc(), ex = extraOf(doc, t, id);
  if (pickedOf(doc, t, id)?.has.size === false) return;
  const to = { x: a.x + (box.x - a.x) * f, y: a.y + (box.y - a.y) * f };
  if (ex) {
    // (its own corner keeps its place in the drawn box, which grows from `to`)
    const ox = ex.x * W - box.x, oy = ex.y * H - box.y;
    const size = textual(ex) ? Math.round(Math.max(4, Math.min(400, (ex.size ?? 24) * f)) * 10) / 10 : ex.size;
    return patchExtra(t, ex.id, { x: r4((to.x + ox * f) / W), y: r4((to.y + oy * f) / H), w: r4(Math.max(0.01, Math.min(2, ex.w * f))), size });
  }
  if (t === "map") return sizeDesignEl(id, f, { x: to.x / W, y: to.y / H });
  setPlace(t, id, sizedPlace(placeOf(doc, t, id), f, a, W, H));
};

/** Hidden (the look's own pieces; Layers brings them back) or taken away (what was added). */
export const removePicked = (t: TargetKey, id: string) => {
  const doc = getDoc(), ex = extraOf(doc, t, id);
  if (ex) setExtras(t, xs => xs.filter(x => x.id !== ex.id));
  else if (t === "map") { removeDesignSel(); return; }
  else setPieceShown(t, id, false);
  useEditor.getState().set({ designSel: null });
};

export const duplicatePicked = (t: TargetKey, id: string) => {
  const doc = getDoc(), ex = extraOf(doc, t, id);
  if (ex) {
    const nid = generateId();
    setExtras(t, xs => [...xs, { ...ex, id: nid, x: ex.x + 0.02, y: ex.y + 0.02 }]);
    useEditor.getState().set({ designSel: `x:${nid}` });
  } else if (t === "map") duplicateDesignSel();
};

/** `x` moved up (`d` 1, drawn over the next) or down (-1) in its list; to the very top or bottom
 * with 2 or -2. */
const moveIn = <T extends { id: string }>(xs: T[], id: string, d: 1 | -1 | 2 | -2) => {
  const i = xs.findIndex(x => x.id === id);
  if (i < 0) return xs;
  const rest = xs.filter(x => x.id !== id);
  const to = d === 2 ? rest.length : d === -2 ? 0 : Math.max(0, Math.min(rest.length, i + d));
  return [...rest.slice(0, to), xs[i], ...rest.slice(to)];
};
/** An added piece moved in front of or behind the others added (the course map's own text among
 * its text, and its pictures among its pictures). The look's own pieces keep their places. */
export const reorderPicked = (t: TargetKey, id: string, d: 1 | -1 | 2 | -2) => {
  const doc = getDoc(), ex = extraOf(doc, t, id);
  if (ex) return setExtras(t, xs => moveIn(xs, ex.id, d));
  const e = t === "map" ? elementOf(doc, id) : null;
  if (e?.kind === "text") changeDoc(x => ({ style: { ...x.style, texts: moveIn(x.style.texts ?? [], e.text.id, d) } }));
  else if (e?.kind === "image") changeDoc(x => ({ style: { ...x.style, images: moveIn(x.style.images ?? [], e.image.id, d) } }));
};
/** Where an added piece is among the ones it's ordered with: [its place, how many]. */
export const orderOf = (doc: CourseDoc, t: TargetKey, id: string): [number, number] | null => {
  const ex = extraOf(doc, t, id);
  if (ex) {
    const xs = extrasOf(doc, t);
    return [xs.findIndex(x => x.id === ex.id), xs.length];
  }
  const e = t === "map" ? elementOf(doc, id) : null;
  if (e?.kind === "text") { const xs = doc.style.texts ?? []; return [xs.findIndex(x => x.id === e.text.id), xs.length]; }
  if (e?.kind === "image") { const xs = doc.style.images ?? []; return [xs.findIndex(x => x.id === e.image.id), xs.length]; }
  return null;
};

/** Back where (and as) its look has it; what was added, without its panel, turn and fading. */
export const resetPicked = (t: TargetKey, id: string) => {
  const ex = extraOf(getDoc(), t, id);
  if (ex) return patchExtra(t, ex.id, { fill: undefined, rot: undefined, opacity: undefined });
  if (t === "map") {
    const e = elementOf(getDoc(), id);
    if (e?.kind === "label") return patchLabel(e.id, null);
    if (e?.kind === "text") return patchText(e.text.id, { bg: undefined, bgOpacity: undefined, rot: undefined, opacity: undefined });
    if (e?.kind === "image") return patchImage(e.image.id, { rot: undefined, opacity: undefined });
    if (e?.kind === "built") return changeDoc(d => ({ style: { ...d.style, page: { ...d.style.page, [e.id]: { ...d.style.page?.[e.id], x: undefined, y: undefined, scale: undefined, ink: undefined, bg: undefined, bgOpacity: undefined, rot: undefined, opacity: undefined } }, ...(e.id === "legend" || e.id === "holes" ? { legendAt: undefined } : {}) } }));
    return;
  }
  const keep = placeOf(getDoc(), t, id)?.hidden;
  setPlace(t, id, keep === undefined ? null : { dx: undefined, dy: undefined, scale: undefined, font: undefined, color: undefined, fill: undefined, bold: undefined, italic: undefined, rot: undefined, opacity: undefined, text: undefined });
};

/** Everything on a printout's page, for Layers (the look's own first, then what was added); each
 * one that isn't on the page shown says why (a hole it is on, for what's on other holes). */
export const layersOf = (doc: CourseDoc, t: TargetKey): Layer[] => {
  const h = t === "sign" || t === "page" ? shownHole(doc) : null, here = h ? `Not on hole ${holeLabel(doc, h)}` : "";
  const first = (holes?: string[]) => byNumber(doc.holes).find(x => holes?.includes(x.id))?.id;
  const added = extrasOf(doc, t).map((e): Layer => {
    const row: Layer = { id: `x:${e.id}`, label: extraLabel(doc, e), shown: !e.hidden, changed: !!e.fill || !!e.rot || e.opacity !== undefined, added: true };
    if (!h) return row;
    // (on other holes: its own, or its sponsor's)
    const sp = e.kind === "sponsor" ? doc.style.sponsors?.find(s => s.id === e.sponsorId) : undefined;
    if (e.holes?.length && !e.holes.includes(h)) return { ...row, note: here, hole: first(e.holes) };
    if (sp?.holes?.length && !sp.holes.includes(h)) return { ...row, note: here, hole: first(sp.holes) };
    return row;
  });
  const why = (id: string, shown: boolean) => {
    if (!shown || !drawnIds.size || drawnIds.has(id)) return undefined;
    if (id === "tagline") return taglineOf(doc.style) ? "Course name hidden" : "No tagline set";
    return extraOf(doc, t, id)?.kind === "sponsors" ? (h ? `No sponsor on hole ${holeLabel(doc, h)}` : "No sponsors yet") : WHY[id] ?? "Not on this page";
  };
  const typable = (id: string) => !!pickedOf(doc, t, id)?.has.text;
  if (t === "map") {
    const s = doc.style;
    const ids = ["title", "holes", "legend", "north", "scale", "credit", ...(s.texts ?? []).map(x => `text:${x.id}`), ...(s.images ?? []).map(x => `image:${x.id}`)];
    // (the credits always print what the map's sources ask for: shown, with no eye, while they do)
    const fixed = (id: string) => id === "credit" && !!requiredCredit(doc);
    return [...ids.map(id => { const shown = isShown(doc, id) || fixed(id); return { id, label: elementLabel(doc, id), shown, changed: !!pickedOf(doc, t, id)?.changed, added: id.includes(":"), note: why(id, shown), fixed: fixed(id), typable: typable(id) }; }), ...added.map(r => ({ ...r, note: r.note ?? why(r.id, r.shown), typable: typable(r.id) }))];
  }
  // ("Hole N of M" as this page prints it)
  const label = (id: string) => (id === "holeOf" && h ? `Hole ${holeLabel(doc, h)} of ${playedHoles(doc, doc.holes.map(x => ({ holeId: x.id, label: "" }))).length}` : byId.get(id)!.label);
  const own = lookPieces(doc, t).map(id => { const shown = pieceShown(doc, t, id); return { id, label: label(id), shown, changed: placeChanged(placeOf(doc, t, id)), added: false, note: why(id, shown), typable: typable(id) }; });
  return [...own, ...added.map(r => ({ ...r, note: r.note ?? why(r.id, r.shown), typable: typable(r.id) }))];
};

/** A layer's eye: shown or hidden. */
export const setLayerShown = (t: TargetKey, id: string, v: boolean) => {
  const ex = extraOf(getDoc(), t, id);
  if (ex) return patchExtra(t, ex.id, { hidden: v ? undefined : true });
  if (t === "map") return setShown(id, v);
  setPieceShown(t, id, v);
};

/** The holes with a sign (or page) of their own, over every hole's, in playing order. */
export const holesWithOwn = (doc: CourseDoc, t: "sign" | "page") =>
  byNumber(doc.holes).filter(h => (t === "sign" ? h.sign && Object.values(h.sign).some(v => v !== undefined) : h.page && Object.values(h.page).some(v => v !== undefined))).map(h => h.id);
/** Holes put back to every hole's sign (or page). */
export const putBack = (t: "sign" | "page", ids: string[]) =>
  changeDoc(d => ({ holes: d.holes.map(h => (ids.includes(h.id) ? { ...h, [t]: undefined } : h)) }));
