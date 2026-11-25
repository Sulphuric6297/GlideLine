// The course map's page in the Design step: what's on it (the map, the title, the hole guide, the
// legend, the north arrow, the scale bar, the credits, and text and pictures put on it), and how
// each is moved, sized, colored or hidden. The editor shared by every printout (printouts.ts)
// works the course map through these.
import { generateId } from "../constants";
import { PAPER } from "../lib/mapSvg";
import { changeDoc, getDoc, useEditor } from "../state/course";
import type { CourseDoc, MapStyle, PageElementId, PageElementStyle, PageImage, PageText } from "../types";

const BUILT_IN: { id: PageElementId; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "holes", label: "Hole guide" },
  { id: "legend", label: "Legend" },
  { id: "north", label: "North arrow" },
  { id: "scale", label: "Scale bar" },
  { id: "credit", label: "Credits" }
];

const style = (patch: (s: MapStyle) => Partial<MapStyle>, history = true) => changeDoc(d => ({ style: { ...d.style, ...patch(d.style) } }), history);

/** A built-in element's settings, changed. */
export const patchPage = (id: PageElementId, patch: Partial<PageElementStyle>, history = true) =>
  // (moved or sized by hand: from now on the course map stays where it is for it)
  style(s => ({ page: { ...s.page, [id]: { ...s.page?.[id], ...patch } }, ...("x" in patch || "y" in patch || "scale" in patch ? { mapStays: true } : {}) }), history);
export const patchText = (id: string, patch: Partial<PageText>, history = true) =>
  style(s => ({ texts: (s.texts ?? []).map(t => (t.id === id ? { ...t, ...patch } : t)) }), history);
export const patchImage = (id: string, patch: Partial<PageImage>, history = true) =>
  style(s => ({ images: (s.images ?? []).map(t => (t.id === id ? { ...t, ...patch } : t)) }), history);

/** What a picked element is: a built-in one, a text or a picture. */
export const elementOf = (doc: CourseDoc, sel: string | null) => {
  if (!sel) return null;
  if (sel.startsWith("label:")) return { kind: "label", id: sel.slice(6) } as const;
  if (sel.startsWith("text:")) {
    const t = doc.style.texts?.find(x => x.id === sel.slice(5));
    return t ? ({ kind: "text", text: t } as const) : null;
  }
  if (sel.startsWith("image:")) {
    const im = doc.style.images?.find(x => x.id === sel.slice(6));
    return im ? ({ kind: "image", image: im } as const) : null;
  }
  const b = BUILT_IN.find(x => x.id === sel);
  return b ? ({ kind: "built", id: b.id, label: b.label } as const) : null;
};

export const elementLabel = (doc: CourseDoc, sel: string) => {
  const e = elementOf(doc, sel);
  if (!e) return "";
  if (e.kind === "text") return e.text.text.trim().split("\n")[0].slice(0, 28) || "Text";
  if (e.kind === "image") return "Picture";
  if (e.kind === "label") return LABEL_KINDS[e.id.split(":")[0]] ?? "Label";
  return e.label;
};

const LABEL_KINDS: Record<string, string> = { num: "Hole number", dist: "Distance", name: "Name", tag: "OB tag", text: "Text label", walk: "Walk to the next tee" };

/** A label on the map moved by (dx, dy) feet on the ground, hidden, or put back (null). */
export const patchLabel = (id: string, patch: { dx?: number; dy?: number; hidden?: boolean; placed?: boolean } | null) =>
  style(s => {
    const all = { ...s.labelAt };
    if (patch === null) delete all[id];
    else all[id] = { ...(all[id] ?? { dx: 0, dy: 0 }), ...patch };
    return { labelAt: Object.keys(all).length ? all : undefined };
  });
export const moveLabel = (id: string, dx: number, dy: number) => {
  const o = getDoc().style.labelAt?.[id];
  const r = (v: number) => Math.round(v * 10) / 10;
  // (first moved now: measured from where the label goes by itself, clear of the lines and pads)
  patchLabel(id, { dx: r((o?.dx ?? 0) + dx), dy: r((o?.dy ?? 0) + dy), ...(o && (o.dx || o.dy) && !o.placed ? {} : { placed: true }) });
};

/** Whether an element shows on the page. */
export const isShown = (doc: CourseDoc, sel: string) => {
  const s = doc.style, e = elementOf(doc, sel);
  if (!e) return false;
  if (e.kind === "text") return !e.text.hidden;
  if (e.kind === "image") return !e.image.hidden;
  if (e.kind === "label") return !s.labelAt?.[e.id]?.hidden;
  switch (e.id) {
    case "holes": return s.holeTable;
    case "legend": return s.legend;
    case "north": return s.north;
    case "scale": return s.scale;
    case "map": return true;
    default: return !s.page?.[e.id]?.hidden;
  }
};

export const setShown = (sel: string, v: boolean) => {
  const e = elementOf(getDoc(), sel);
  if (!e) return;
  if (e.kind === "text") return patchText(e.text.id, { hidden: v ? undefined : true });
  if (e.kind === "image") return patchImage(e.image.id, { hidden: v ? undefined : true });
  if (e.kind === "label") return patchLabel(e.id, { hidden: v ? undefined : true });
  if (e.id === "holes") return style(() => ({ holeTable: v }));
  if (e.id === "legend") return style(() => ({ legend: v }));
  if (e.id === "north") return style(() => ({ north: v }));
  if (e.id === "scale") return style(() => ({ scale: v }));
  if (e.id !== "map") patchPage(e.id, { hidden: v ? undefined : true });
};

/** Delete (or Backspace) on the page: text and pictures go, the rest is hidden (one undo step). */
export const removeDesignSel = () => {
  const { designSel, set } = useEditor.getState();
  if (!designSel) return;
  const e = elementOf(getDoc(), designSel);
  if (!e) return;
  if (e.kind === "text") style(s => ({ texts: (s.texts ?? []).filter(t => t.id !== e.text.id) }));
  else if (e.kind === "image") style(s => ({ images: (s.images ?? []).filter(t => t.id !== e.image.id) }));
  else if (e.kind === "label" || e.id !== "map") setShown(designSel, false);
  else return;
  set({ designSel: null });
};

/** Ctrl+D on the page: a copy of a text or picture, a little down and to the right. */
export const duplicateDesignSel = () => {
  const { designSel, set } = useEditor.getState();
  const e = designSel ? elementOf(getDoc(), designSel) : null;
  if (!e || e.kind === "built" || e.kind === "label") return;
  const id = generateId();
  if (e.kind === "text") {
    style(s => ({ texts: [...(s.texts ?? []), { ...e.text, id, x: e.text.x + 0.02, y: e.text.y + 0.02 }] }));
    set({ designSel: `text:${id}` });
  } else {
    style(s => ({ images: [...(s.images ?? []), { ...e.image, id, x: e.image.x + 0.02, y: e.image.y + 0.02 }] }));
    set({ designSel: `image:${id}` });
  }
};

/** An element moved by a share of the page across and down (`at`: its top-left corner, as a share of the page, before). */
export const moveDesignEl = (sel: string, at: { x: number; y: number }, dx: number, dy: number) => {
  const doc = getDoc();
  const e = elementOf(doc, sel);
  if (!e || e.kind === "label") return;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  if (e.kind === "text") return patchText(e.text.id, { x: r(e.text.x + dx), y: r(e.text.y + dy) });
  if (e.kind === "image") return patchImage(e.image.id, { x: r(e.image.x + dx), y: r(e.image.y + dy) });
  if (e.id === "map") {
    const m = doc.style.page?.map;
    return patchPage("map", { x: r((m?.x ?? 0) + dx), y: r((m?.y ?? 0) + dy) });
  }
  patchPage(e.id, { x: r(at.x + dx), y: r(at.y + dy) });
};

/** An element sized `f` times about a point that stays (`to`: its new top-left corner, as a share of the page). */
export const sizeDesignEl = (sel: string, f: number, to: { x: number; y: number }) => {
  const doc = getDoc();
  const e = elementOf(doc, sel);
  if (!e || e.kind === "label") return;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  if (e.kind === "text") return patchText(e.text.id, { size: Math.round(Math.max(4, Math.min(400, e.text.size * f)) * 10) / 10, x: r(to.x), y: r(to.y) });
  if (e.kind === "image") return patchImage(e.image.id, { w: r(Math.max(0.02, Math.min(1.5, e.image.w * f))), x: r(to.x), y: r(to.y) });
  if (e.id === "map") return;
  const k = Math.max(0.2, Math.min(6, (doc.style.page?.[e.id]?.scale ?? 1) * f));
  patchPage(e.id, { scale: Math.round(k * 1000) / 1000, x: r(to.x), y: r(to.y) });
};

/** A text size that reads well on the paper picked (points). */
export const textSize = (s: MapStyle) => {
  const p = PAPER[s.paper];
  return Math.round(Math.min(p.w, p.h) * 72 * 0.04);
};

/** Text put on the course map's page, picked (in the map's labels font, and following it, until
 * it's given a font of its own). */
export const addText = () => {
  const id = generateId();
  style(s => ({ texts: [...(s.texts ?? []), { id, text: "Text", x: 0.42, y: 0.45, size: textSize(s), color: "#ffffff", bold: true }] }));
  useEditor.getState().set({ designSel: `text:${id}` });
};

/** A picture picked from the device, made at most `max` px across (the course file stays light):
 * as a data URL, and its height to width. */
export const pictureFrom = async (file: File, max = 1200) => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL(file.type === "image/jpeg" ? "image/jpeg" : "image/png", 0.9), aspect: c.height / c.width };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** A picture picked from the device, put on the course map's page. */
export const addImage = async (file: File) => {
  const { src, aspect } = await pictureFrom(file);
  const id = generateId();
  // (a quarter of the page across, in its own shape)
  style(s => ({ images: [...(s.images ?? []), { id, src, x: 0.375, y: 0.4, w: 0.25, aspect }] }));
  useEditor.getState().set({ designSel: `image:${id}` });
};
