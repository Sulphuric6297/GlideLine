// The Design step's page: the printed course map (or a tee sign, a hole page, or the scorecard)
// exactly as it will print, updating as the style changes, and laid out by hand right on it.
import { Woods } from "./Woods";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Maximize2, Minus, Plus, RotateCw, Scan } from "lucide-react";
import { PAPER, onPaintProgress, onPainted, renderPoster, withLivePaint } from "../lib/mapSvg";
import { SIGN_SIZES, renderScorecard, renderTeeSign, type SignSize } from "../lib/teeSign";
import { HOLE_PAGES, renderHolePage, type HolePageSize } from "../lib/holePage";
import { changeDoc, useCourse, useEditor, getDoc } from "../state/course";
import { byNumber, holeLabel } from "../lib/course";
import { useCanopy, useRelief } from "./useRelief";
import { moveLabel } from "./PageEditor";
import { duplicatePicked, extrasOf, movePicked, noteOf, onAskTyping, patchPicked, pickedOf, rememberBoard, removePicked, setDrawn, sizePicked, sizeWordsPicked, takeTyping, type TargetKey } from "./printouts";
import { useToolOpen } from "./pageToolState";
import { askOpen } from "./showSetting";

/** A size's short name, for a phone's row over the page. */
const SHORT: Record<string, string> = { "18x12": "18 × 12", "12x18": "12 × 18", "18x24": "18 × 24", letter: "Letter", a4: "A4", card: "4 × 6", square: "Square" };
import { PieceToolbar, type Drawn } from "./PieceToolbar";
import { fontsIn, loadFont } from "../lib/fontLoad";
import { fitTexts } from "../lib/fitText";
import { pieceFont } from "../lib/pieces";
import type { PaperSize } from "../types";

/** A phone or small tablet (touch first, small screen). */
const PHONE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && typeof screen !== "undefined" && Math.min(screen.width, screen.height) < 900;

type Preview = "map" | "sign" | "page" | "scorecard";
type Box = { x: number; y: number; w: number; h: number };
const parseBox = (s: string): Box => { const [x, y, w, h] = s.split(" ").map(Number); return { x, y, w, h }; };
/** A color as the page draws it ("rgb(…)"), as #rrggbb (none: not a plain color). */
const hex = (c: string) => {
  const m = c.startsWith("rgb") ? c.match(/[\d.]+/g) : null;
  return m && m.length >= 3 ? `#${m.slice(0, 3).map(v => Math.round(Number(v)).toString(16).padStart(2, "0")).join("")}` : undefined;
};

/** `compact`: a phone's layout (two rows of controls, the page fitted edge to edge, pinch to zoom);
 * `topInset` keeps the controls clear of a top bar over it. */
/** The page being designed (`preview`: shown only, as Export shows what goes out). */
export function MapDesigner({ compact = false, topInset = 0, bottomInset = 0, preview: only = false }: { compact?: boolean; topInset?: number; bottomInset?: number; preview?: boolean }) {
  const live = useCourse(s => s.doc);
  const doc = useDeferredValue(live);
  const relief0 = useRelief(doc);
  const canopy = useCanopy(doc);
  const relief = useMemo(() => ({ ...relief0, canopy }), [relief0, canopy]);
  // (the Google fonts the signs and pages use, put into the page so the preview shows them)
  const fonts = fontsIn(doc).join("|");
  useEffect(() => { for (const f of fonts.split("|")) if (f) loadFont(f); }, [fonts]);
  // (the Map step's tab: General shows a tee sign, where most of its settings go, to look at;
  // with no hole yet, the course map)
  const tabId = useEditor(e => e.designTab);
  const general = tabId === "general" && !only;
  const preview: Preview = tabId === "general" ? (general && doc.holes.length ? "sign" : "map") : tabId;
  const setPreview = (id: Preview | "general") => useEditor.getState().set({ designTab: id });
  const hole = useEditor(e => e.designHole);
  const setHole = (id: string) => useEditor.getState().set({ designHole: id });
  // (the course's sizes: the same ones Export prints)
  const signSize: SignSize = useCourse(c => c.doc.style.signSize) ?? "18x12";
  const pageSize: HolePageSize = useCourse(c => c.doc.style.holePageSize) ?? "letter";
  const paper: PaperSize = useCourse(c => c.doc.style.paper);
  const setSignSize = (v: SignSize) => { rememberBoard(v); changeDoc(d => ({ style: { ...d.style, signSize: v } })); };
  useEffect(() => { rememberBoard(signSize); }, [signSize]);
  const setPageSize = (v: HolePageSize) => changeDoc(d => ({ style: { ...d.style, holePageSize: v } }));
  const setPaper = (v: PaperSize) => changeDoc(d => ({ style: { ...d.style, paper: v } }));
  const [zoom, setZoom] = useState<number | null>(null);
  // (a phone's Map step: the whole page shown, by Fit, instead of filling the screen)
  const [whole, setWhole] = useState(false);
  // (another printout or size: as it first shows again)
  useEffect(() => { setZoom(null); setWhole(false); }, [tabId, signSize, pageSize, paper]);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const activeHole = useEditor(e => e.activeHoleId);
  const holeId = hole && doc.holes.some(h => h.id === hole) ? hole : activeHole && doc.holes.some(h => h.id === activeHole) ? activeHole : doc.holes[0]?.id ?? null;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // (how tall the controls over the page are: what shows over the page stays clear of them)
  const controls = useRef<HTMLDivElement>(null);
  const [controlsH, setControlsH] = useState(0);
  useEffect(() => {
    const el = controls.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setControlsH(el.offsetTop + el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // While a finger is on the page its picture stays as it is: a new painting put in under the finger
  // takes away what it touched, and the gesture never hears the finger lift (a pinch stuck scaled)
  const [held, setHeld] = useState<string | null>(null);
  const htmlRef = useRef("");
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const down = () => {
      const now = htmlRef.current;
      setHeld(h => h ?? now);
    };
    const up = (e: TouchEvent) => { if (!e.touches.length) setHeld(null); };
    el.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, []);

  // Pinching the page (a phone): scaled live, then drawn at the new zoom with the pinched spot kept
  const pageEl = useRef<HTMLDivElement>(null);
  const [pinchScale, setPinchScale] = useState<{ s: number; ox: number; oy: number } | null>(null);
  const anchor = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  const kRef = useRef(1);
  useEffect(() => {
    const el = box.current;
    if (!el || !compact) return;
    let start: { d: number; fx: number; fy: number; vx: number; vy: number; ox: number; oy: number } | null = null;
    let last = 1;
    const pair = (t: TouchList) => {
      const r = el.getBoundingClientRect(), a = t[0], b = t[1];
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), vx: (a.clientX + b.clientX) / 2 - r.left, vy: (a.clientY + b.clientY) / 2 - r.top };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pageEl.current) return;
      const p = pair(e.touches), pr = pageEl.current.getBoundingClientRect(), r = el.getBoundingClientRect();
      const ox = p.vx + r.left - pr.left, oy = p.vy + r.top - pr.top;
      start = { d: Math.max(1, p.d), fx: ox / pr.width, fy: oy / pr.height, vx: p.vx, vy: p.vy, ox, oy };
      last = 1;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const k = kRef.current;
      last = Math.min(6 / k, Math.max(0.1 / k, pair(e.touches).d / start.d));
      setPinchScale({ s: last, ox: start.ox, oy: start.oy });
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      anchor.current = { fx: start.fx, fy: start.fy, vx: start.vx, vy: start.vy };
      setZoom(Math.min(6, Math.max(0.1, kRef.current * last)));
      setPinchScale(null);
      start = null;
    };
    // A double tap where nothing is picked (the first tap let go of any piece): twice as close, the
    // spot tapped staying put. (On a piece, the first tap picks it and the second types its words)
    let down: { t: number; x: number; y: number } | null = null, tap: { t: number; x: number; y: number } | null = null;
    const onTapStart = (e: TouchEvent) => { const t = e.touches[0]; down = e.touches.length === 1 && t ? { t: e.timeStamp, x: t.clientX, y: t.clientY } : null; if (e.touches.length > 1) tap = null; };
    const onTapEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!down || !t || e.touches.length) return;
      const quick = e.timeStamp - down.t < 300 && Math.hypot(t.clientX - down.x, t.clientY - down.y) < 12;
      down = null;
      if (!quick) { tap = null; return; }
      if (tap && e.timeStamp - tap.t < 320 && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < 40 && !useEditor.getState().designSel && pageEl.current) {
        const r = el.getBoundingClientRect(), pr = pageEl.current.getBoundingClientRect();
        anchor.current = { fx: (t.clientX - pr.left) / pr.width, fy: (t.clientY - pr.top) / pr.height, vx: t.clientX - r.left, vy: t.clientY - r.top };
        setZoom(Math.min(6, kRef.current * 2));
        tap = null;
        e.preventDefault();
        return;
      }
      tap = { t: e.timeStamp, x: t.clientX, y: t.clientY };
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("touchstart", onTapStart, { passive: true });
    el.addEventListener("touchend", onTapEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("touchstart", onTapStart);
      el.removeEventListener("touchend", onTapEnd);
    };
  }, [compact]);
  // As in a design app: Ctrl (or ⌘) and the wheel, or a trackpad's pinch, zooms about the pointer,
  // the spot under it staying put; the wheel on its own scrolls the page
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!pageEl.current || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), pr = pageEl.current.getBoundingClientRect();
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // (a mouse wheel's notch is a big step, a pinch many small ones)
      const next = Math.min(6, Math.max(0.1, kRef.current * Math.exp(-step * (Math.abs(step) >= 40 ? 0.0025 : 0.01))));
      anchor.current = { fx: (e.clientX - pr.left) / pr.width, fy: (e.clientY - pr.top) / pr.height, vx: e.clientX - r.left, vy: e.clientY - r.top };
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  // A press and drag on the page's background, the map (not on a label), or around the page
  // moves the zoomed page about (a finger scrolls it by itself)
  const pan = useRef<{ x: number; y: number; sl: number; st: number; id: number } | null>(null);
  const onBoxDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" && useEditor.getState().designSel && !pageEl.current?.contains(e.target as Node)) { tapOut.current = { pid: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0 || e.pointerType === "touch" || !box.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, sl: box.current.scrollLeft, st: box.current.scrollTop, id: e.pointerId };
  };
  const onBoxMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current, el = box.current;
    if (!p || p.id !== e.pointerId || !el) return;
    el.scrollLeft = p.sl - (e.clientX - p.x);
    el.scrollTop = p.st - (e.clientY - p.y);
    el.style.cursor = "grabbing";
  };
  const onBoxUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const out = tapOut.current;
    if (out && out.pid === e.pointerId && !pageEl.current?.contains(e.target as Node)) {
      tapOut.current = null;
      if (Math.hypot(e.clientX - out.x, e.clientY - out.y) < 10) setEd({ designSel: null });
    }
    if (pan.current?.id !== e.pointerId) return;
    pan.current = null;
    if (box.current) box.current.style.cursor = "";
  };
  useLayoutEffect(() => {
    const a = anchor.current, el = box.current, pg = pageEl.current;
    if (!a || !el || !pg) return;
    anchor.current = null;
    const r = el.getBoundingClientRect(), pr = pg.getBoundingClientRect();
    el.scrollLeft += pr.left - r.left + a.fx * pr.width - a.vx;
    el.scrollTop += pr.top - r.top + a.fy * pr.height - a.vy;
  });

  // The preview paints between frames (the page never freezes), smaller on a phone (it is seen
  // small; quicker and lighter on memory), and is drawn again when a painting is ready
  const [painted, setPainted] = useState(0);
  useEffect(() => onPainted(() => setPainted(v => v + 1)), []);
  // How far the painting under way is (shown over the page while it paints)
  const [painting, setPainting] = useState<number | null>(null);
  useEffect(() => onPaintProgress(setPainting), []);
  const page = useMemo(() => withLivePaint(PHONE ? 1500 : 2400, () => {
    if (preview === "sign" && holeId) return renderTeeSign(doc, holeId, signSize, relief);
    if (preview === "page" && holeId) return renderHolePage(doc, holeId, pageSize, relief);
    if (preview === "scorecard") return renderScorecard(doc);
    return renderPoster(doc, relief);
  }), [doc, relief, preview, holeId, signSize, pageSize, painted]);

  // Everything on the page picked, moved and sized like in Canva, the same on the course map, a tee
  // sign, a hole page and the scorecard: a click picks (and the toolbar over it holds its
  // settings), a drag moves it (snapping to the page's edges and middle and to the other pieces,
  // pink guides showing where; Alt drags freely), the corner squares size it, a double-click on
  // text types on the page. A finger taps to pick, then drags, and pinches the picked piece to
  // size it. One undo step each. (General's sign is there to look at, not to lay out.)
  const designSel = useEditor(e => e.designSel);
  const setEd = useEditor(e => e.set);
  const toolOpen = useToolOpen();
  const t: TargetKey = preview === "map" ? "map" : preview === "sign" ? "sign" : preview === "page" ? "page" : "card";
  const editing = !only && !general;
  const svgHost = useRef<HTMLDivElement>(null);
  const [selBox, setSelBox] = useState<Box | null>(null);
  const [drawn, setDrawnOf] = useState<Drawn | undefined>(undefined);
  const [hover, setHover] = useState<{ id: string; box: Box; copies?: Box[] } | null>(null);
  // (the picked piece's copies' boxes: outlined with it)
  const [copyBoxes, setCopyBoxes] = useState<Box[]>([]);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [typing, setTyping] = useState<{ id: string; text: string; box: Box; font?: string; lines: boolean; placeholder?: string } | null>(null);
  const drag = useRef<{ mode: "move" | "size" | "turn"; cp?: [SVGGElement, string][]; finger?: boolean; rot0?: number; a0?: number; c?: { x: number; y: number }; rot?: number; id: string; el: SVGGElement; orig: string; cx: number; cy: number; pid: number; k: number; W: number; H: number; box: Box; nat: Box; anchor: { x: number; y: number }; corner: { x: number; y: number }; f: number; dx: number; dy: number; lines: { x: number[]; y: number[] } } | null>(null);
  const elOf = (id: string) =>
    svgHost.current?.querySelector(id.startsWith("label:") ? `[data-label="${CSS.escape(id.slice(6))}"]` : `[data-el="${CSS.escape(id)}"]`) as SVGGElement | null;
  /** Its other drawings (the scorecard's second card), placed and picked with it. */
  const copiesOf = (id: string) => (id.startsWith("label:") ? [] : Array.from(svgHost.current?.querySelectorAll<SVGGElement>(`[data-pc="${CSS.escape(id)}"]`) ?? []));
  const idOf = (g: Element) => g.getAttribute("data-el") ?? g.getAttribute("data-pc");
  /** A piece's box on the page: as its lettering measures (the course map's title and text), as the
   * page says it placed it, or as drawn. */
  const boxOf = (el: Element): Box => {
    const b = el.getAttribute("data-ink") ?? el.getAttribute("data-box");
    if (b) return parseBox(b);
    // (as drawn, moved and sized as it is)
    const r = el.getBoundingClientRect(), host = svgHost.current!.getBoundingClientRect(), k = kRef.current;
    return { x: (r.left - host.left) / k, y: (r.top - host.top) / k, w: r.width / k, h: r.height / k };
  };
  /** Where a piece is put from, for moving and sizing it (the box the page placed it by: a title's
   * lettering doesn't start at its corner). */
  const placedBox = (el: Element): Box => { const b = el.getAttribute("data-box"); return b ? parseBox(b) : boxOf(el); };
  /** The page's size as the pieces are placed on it (the scorecard: one card of the two). */
  const dims = () => ({ W: page?.width ?? 1, H: (page?.height ?? 1) / (t === "card" ? 2 : 1) });
  /** A move on the page as feet on the ground (the map's own scale and turn). */
  const groundShift = (dx: number, dy: number) => {
    const m = svgHost.current?.querySelector("[data-el=map]");
    const k = Number(m?.getAttribute("data-k")) || 1, rot = ((Number(m?.getAttribute("data-rot")) || 0) * Math.PI) / 180;
    const c = Math.cos(-rot), sn = Math.sin(-rot);
    return { x: (dx * c + dy * sn) / k, y: (-dx * sn + dy * c) / k };
  };
  // (what can be picked: the course map's map itself can't, so a drag on it pans)
  const pickable = (id: string | null) => !!id && !(t === "map" && id === "map");
  // (leaving the Design step, or another printout, lets go of what was picked)
  useEffect(() => { if (!editing) setEd({ designSel: null }); }, [editing, setEd]);
  // (another tab lets go of what was picked, unless something on it is picked as it opens)
  useEffect(() => useEditor.subscribe((s, was) => { if (s.designTab !== was.designTab && s.designSel === was.designSel && s.designSel) useEditor.getState().set({ designSel: null }); }), []);
  useEffect(() => { setHover(null); setTyping(null); }, [preview]);
  useEffect(() => () => setEd({ designSel: null }), [setEd]);
  // Each piece is picked anywhere in its outline, not only on its ink (an unseen box the size of
  // what it draws), lettering is kept inside its panels in the fonts it's set in, and the course
  // map's title and text are measured as they really draw (their boxes are guessed from how many
  // letters they have). Then Layers hears what's on the page
  const [fontsIn2, setFontsIn2] = useState(0);
  useEffect(() => {
    const on = () => setFontsIn2(v => v + 1);
    document.fonts?.addEventListener?.("loadingdone", on);
    return () => document.fonts?.removeEventListener?.("loadingdone", on);
  }, []);
  // (a new QR code with nowhere to go yet: "Add a link" over it, on this page only)
  const [noLink, setNoLink] = useState<Box[]>([]);
  const noLinkKey = useRef("");
  useLayoutEffect(() => {
    const host = svgHost.current;
    if (!host) return;
    fitTexts(host);
    setDrawn(Array.from(host.querySelectorAll("[data-el]")).map(g => g.getAttribute("data-el") ?? ""));
    if (!editing) return;
    for (const g of Array.from(host.querySelectorAll<SVGGElement>("[data-el]"))) {
      if (g.hasAttribute("data-box") || g.querySelector(":scope > rect[data-hit]")) continue;
      const b = g.getBBox();
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("data-hit", "1");
      r.setAttribute("x", String(b.x)); r.setAttribute("y", String(b.y)); r.setAttribute("width", String(b.width)); r.setAttribute("height", String(b.height));
      r.setAttribute("fill", "none"); r.setAttribute("pointer-events", "all");
      g.insertBefore(r, g.firstChild);
    }
    if (t === "map") {
      for (const g of Array.from(host.querySelectorAll<SVGGElement>('[data-el="title"],[data-el^="text:"]'))) {
        const placed = g.getAttribute("data-box"), hit = g.firstElementChild;
        if (!placed || hit?.tagName !== "rect") continue;
        // (its lettering's own box, in the units it's drawn in, then as the page places it)
        const N = parseBox(placed), R = { x: Number(hit.getAttribute("x")), y: Number(hit.getAttribute("y")), w: Number(hit.getAttribute("width")) };
        const k = R.w > 0 ? N.w / R.w : 1;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const el of Array.from(g.querySelectorAll<SVGGraphicsElement>("text, rect"))) {
          if (el === hit) continue;
          const b = el.getBBox();
          if (!b.width || !b.height) continue;
          x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
        }
        if (Number.isFinite(x0)) g.setAttribute("data-ink", `${N.x + (x0 - R.x) * k} ${N.y + (y0 - R.y) * k} ${(x1 - x0) * k} ${(y1 - y0) * k}`);
      }
    }
    const qr = extrasOf(doc, t).filter(x => x.kind === "qr" && !x.url?.trim() && !x.hidden).map(x => elOf(`x:${x.id}`)).filter(Boolean).map(el => boxOf(el!));
    const key = JSON.stringify(qr);
    if (key !== noLinkKey.current) { noLinkKey.current = key; setNoLink(qr); }
  }, [page, held, fontsIn2, editing]);
  // What's picked: its box (once the page is drawn and measured, above), and how it's drawn (its
  // colors and weight, whether it has lettering or a panel) for its toolbar
  useLayoutEffect(() => {
    const el = editing && designSel ? elOf(designSel) : null;
    setSelBox(el ? boxOf(el) : null);
    setCopyBoxes(el && designSel ? copiesOf(designSel).map(boxOf) : []);
    if (!el) return setDrawnOf(undefined);
    const tx = el.querySelector("text"), pn = el.querySelector("[data-fill]") ?? (t === "map" && (designSel === "holes" || designSel === "legend") ? el.querySelector("rect:not([data-hit]):not([fill=none])") : null);
    const cs = tx ? getComputedStyle(tx) : null;
    setDrawnOf({ text: !!tx, panel: !!pn, color: cs ? hex(cs.fill) : undefined, bold: cs ? Number(cs.fontWeight) >= 600 : undefined, fill: pn ? hex(getComputedStyle(pn).fill) : undefined });
  }, [page, designSel, editing, held, fontsIn2]);

  /** What's under the pointer: a label on the course map, or the smallest piece whose box takes in
   * the point (pieces overlap: a title over a panel, a panel's box reaching over its neighbor; the
   * one meant is the smaller, as in any design app). */
  const pieceAt = (target: EventTarget | null, cx: number, cy: number) => {
    const tag = t === "map" ? (target as Element).closest?.("[data-label]") : null;
    if (tag) return `label:${tag.getAttribute("data-label")}`;
    const host = svgHost.current;
    if (!host) return null;
    const hr = host.getBoundingClientRect(), k = kRef.current, px = (cx - hr.left) / k, py = (cy - hr.top) / k;
    let best: string | null = null, area = Infinity;
    // (a piece's copy, as on the scorecard's second card, picks the piece)
    for (const g of Array.from(host.querySelectorAll("[data-el],[data-pc]"))) {
      const id = idOf(g);
      if (!pickable(id)) continue;
      const b = boxOf(g);
      if (px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) continue;
      if (b.w * b.h < area) { area = b.w * b.h; best = id; }
    }
    return best;
  };
  /** Whether a pointer is on the page's drawing itself (not its toolbar, a list over it, or the
   * box being typed in). */
  const onDrawing = (target: EventTarget | null) => {
    const tg = target as Element | null;
    return !!tg && !tg.closest?.("[data-page-bar],[role=dialog]") && !!svgHost.current?.contains(tg);
  };
  /** A piece that fills most of the page (the map, a full-page panel or picture): a tap on it
   * while something else is picked lets go, the way a tap on a design's background does. */
  const fillsPage = (id: string) => {
    const el = elOf(id), { W, H } = dims();
    if (!el) return false;
    const b = boxOf(el);
    return b.w * b.h > W * H * 0.5;
  };
  /** Where things line up: the page's edges and middle, and every other piece's (for a finger,
   * only their middles: on a small page with pieces close together, every edge too would catch a
   * finger every few pixels and the piece would drag as if it weighed a ton). */
  const linesFor = (id: string, finger = false) => {
    const W = page!.width, H = page!.height, xs = [0, W / 2, W], ys = [0, H / 2, H];
    if (t === "card") ys.push(H / 4, (H * 3) / 4);
    // (a frame round the course map: its inside edge too)
    const inset = Number(svgHost.current?.querySelector("[data-part=frame]")?.getAttribute("data-inset")) || 0;
    if (inset) { xs.push(inset, W - inset); ys.push(inset, H - inset); }
    for (const g of Array.from(svgHost.current?.querySelectorAll("[data-el]") ?? [])) {
      const gid = g.getAttribute("data-el");
      if (!gid || gid === id || (t === "map" && gid === "map")) continue;
      const b = boxOf(g);
      if (b.w > W * 0.95 && b.h > H * 0.95) continue;
      if (finger) { xs.push(b.x + b.w / 2); ys.push(b.y + b.h / 2); continue; }
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { x: xs, y: ys };
  };
  /** The nearest line to any of `edges` within reach: the shift onto it, and the line. */
  const snap = (edges: number[], lines: number[], reach: number) => {
    let best: { d: number; at: number } | null = null;
    for (const e of edges) for (const l of lines) { const d = l - e; if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l }; }
    return best;
  };

  // (a finger off the piece lets go of it only when it lifts without moving: the first of two
  // fingers pinching a small piece often lands just beside it)
  // (the angle shown while a piece is being turned)
  const [turning, setTurning] = useState<number | null>(null);
  // (a phone: how tall the picked piece's toolbar is, with the setting it has open over it, so
  // the page fits the room above them)
  const [dockH, setDockH] = useState(64);
  const [panelOpen, setPanelOpen] = useState(false);
  // (watched from when it's drawn, a moment after the piece is picked)
  const dockSeen = useRef<ResizeObserver | null>(null);
  const dock = useCallback((el: HTMLDivElement | null) => {
    dockSeen.current?.disconnect();
    dockSeen.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setDockH(Math.round(el.getBoundingClientRect().height) + 8));
    ro.observe(el);
    dockSeen.current = ro;
  }, []);
  // (a phone, zoomed in: the picked piece slid into the room above its bar and whatever that has
  // open, as it's picked and as the sheet opens; slid, never zoomed)
  const hasBox = !!selBox;
  useEffect(() => {
    const el = box.current, host = svgHost.current;
    if (!compact || !designSel || !selBox || !el || !host || drag.current) return;
    const hr = host.getBoundingClientRect(), r = el.getBoundingClientRect(), k = kRef.current;
    const top = hr.top + selBox.y * k, bottom = top + selBox.h * k, left = hr.left + selBox.x * k, right = left + selBox.w * k;
    // (and its turning handle under it in sight too)
    const under = pickedOf(getDoc(), t, designSel)?.has.turn && !designSel.startsWith("label:") ? 56 : 12;
    // (clear of the zoom buttons down the right, where it's narrow enough to be)
    const clear = !only && selBox.w * k < r.width - 80 ? 64 : 12;
    const room = { top: r.top + (only ? 0 : topInset) + 12, bottom: r.bottom - dockH - under, left: r.left + 12, right: r.right - clear };
    const dy = bottom > room.bottom ? Math.min(bottom - room.bottom, top - room.top) : top < room.top ? top - room.top : 0;
    const dx = right > room.right ? Math.min(right - room.right, left - room.left) : left < room.left ? left - room.left : 0;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.scrollBy({ left: dx, top: dy, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designSel, dockH, hasBox]);
  const tapOut = useRef<{ pid: number; x: number; y: number } | null>(null);
  // (a finger picks a piece with a tap, when it lifts without moving: a drag across a piece not
  // picked scrolls the page, as on any phone)
  const tapPick = useRef<{ id: string; pid: number; x: number; y: number; tab?: boolean } | null>(null);
  const onPageDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // (General's sign, to look at: a piece clicked there opens the Tee sign tab with it picked)
    if (general && page && e.button === 0 && preview === "sign") {
      const id = pieceAt(e.target, e.clientX, e.clientY);
      // (a finger: on a tap, not a drag that scrolls the page)
      if (id && e.pointerType === "touch") tapPick.current = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, tab: true };
      else if (id) { e.preventDefault(); setHover(null); setEd({ designTab: "sign", designSel: id }); }
      return;
    }
    if (!editing || !page || e.button !== 0 || typing) return;
    if ((e.target as HTMLElement).closest?.("[data-page-bar],[role=dialog]")) return;
    // (a field in the panel lets go, so keys like Delete go to what's picked on the page)
    const active = document.activeElement as HTMLElement | null;
    if (active?.matches?.("input,textarea,select")) active.blur();
    const corner = (e.target as HTMLElement).closest?.("[data-corner]") as HTMLElement | null;
    const turn = !!(e.target as HTMLElement).closest?.("[data-turn-handle]");
    const finger = e.pointerType === "touch";
    let id = corner || turn || (finger && designSel && onPicked.current(e.clientX, e.clientY)) ? designSel : pieceAt(e.target, e.clientX, e.clientY);
    if (id && designSel && id !== designSel && !corner && !turn && fillsPage(id)) id = null;
    // (a finger, with something picked: a tap anywhere off it lets go, the way a design app does on
    // a phone; the next tap picks; a drag there moves the page)
    if (finger && designSel && id !== designSel) { tapOut.current = { pid: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (!id) { setEd({ designSel: null }); return; }
    const el = elOf(id);
    if (!el) return;
    const fresh = id !== designSel;
    if (!corner && !turn && fresh && e.pointerType === "touch") { tapPick.current = { id, pid: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (fresh) setEd({ designSel: id });
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = boxOf(el), nat = placedBox(el);
    const [sx, sy] = (corner?.dataset.corner ?? "1,1").split(",").map(Number);
    const { W, H } = dims();
    if (turn) {
      // (turned about its middle: the angle from the middle to the finger, from where it started)
      const hr = svgHost.current!.getBoundingClientRect(), k = kRef.current;
      const c = { x: hr.left + (b.x + b.w / 2) * k, y: hr.top + (b.y + b.h / 2) * k };
      drag.current = {
        mode: "turn", id, el, orig: el.getAttribute("style") ?? "", cx: e.clientX, cy: e.clientY, pid: e.pointerId, k, W, H, box: b, nat, corner: { x: 0, y: 0 }, anchor: { x: 0, y: 0 }, f: 1, dx: 0, dy: 0, lines: { x: [], y: [] },
        c, a0: Math.atan2(e.clientY - c.y, e.clientX - c.x), rot0: pickedOf(live, t, id)?.rot ?? 0, rot: pickedOf(live, t, id)?.rot ?? 0
      };
      setHover(null);
      return;
    }
    drag.current = {
      mode: corner ? "size" : "move", finger, id, el, orig: el.getAttribute("transform") ?? "", cx: e.clientX, cy: e.clientY, pid: e.pointerId, k: kRef.current, W, H, box: b, nat,
      corner: { x: b.x + sx * b.w, y: b.y + sy * b.h }, anchor: { x: b.x + (1 - sx) * b.w, y: b.y + (1 - sy) * b.h }, f: 1, dx: 0, dy: 0,
      lines: corner ? { x: [], y: [] } : linesFor(id, finger), cp: copiesOf(id).map(c => [c, c.getAttribute("transform") ?? ""])
    };
    setHover(null);
  };
  const onPageMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      // (the piece under the pointer, outlined: what a click picks; nothing over its toolbar or a
      // list open over the page)
      if (e.pointerType !== "mouse" || (!editing && !general) || typing) return;
      const id = onDrawing(e.target) ? pieceAt(e.target, e.clientX, e.clientY) : null;
      if (!id || id === designSel) { if (hover) setHover(null); return; }
      if (hover?.id !== id) { const el = elOf(id); if (el) setHover({ id, box: boxOf(el), copies: copiesOf(id).map(boxOf) }); }
      return;
    }
    if (d.pid !== e.pointerId) return;
    if (d.mode === "turn") {
      const a = Math.atan2(e.clientY - d.c!.y, e.clientX - d.c!.x);
      let r = d.rot0! + ((a - d.a0!) * 180) / Math.PI;
      r = ((((r + 180) % 360) + 360) % 360) - 180;
      // (straight, square and on the diagonals snap from a few degrees away; Shift: every 15)
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      else { const q = Math.round(r / 45) * 45; if (Math.abs(r - q) < 4) r = q; }
      r = Math.round(r);
      d.rot = r;
      // (live: on top of the turn it had, about its middle, until it's let go)
      d.el.style.setProperty("transform-box", "fill-box");
      d.el.style.setProperty("transform-origin", "center");
      d.el.style.setProperty("rotate", `${r - d.rot0!}deg`);
      setTurning(r);
      return;
    }
    let dx = (e.clientX - d.cx) / d.k, dy = (e.clientY - d.cy) / d.k;
    if (d.mode === "move") {
      // (snapped onto the nearest line within a few pixels, shown pink)
      const reach = (d.finger ? 4 : 6) / d.k, gx: number[] = [], gy: number[] = [];
      if (!e.altKey && !d.id.startsWith("label:")) {
        const b = d.box;
        const sxp = snap([b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w], d.lines.x, reach);
        const syp = snap([b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h], d.lines.y, reach);
        if (sxp) { dx += sxp.d; gx.push(sxp.at); }
        if (syp) { dy += syp.d; gy.push(syp.at); }
      }
      setGuides({ x: gx, y: gy });
      d.dx = dx;
      d.dy = dy;
      d.el.setAttribute("transform", `translate(${dx} ${dy}) ${d.orig}`);
      d.cp?.forEach(([c, o]) => c.setAttribute("transform", `translate(${dx} ${dy}) ${o}`));
      setSelBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy });
    } else {
      const A = d.anchor, C = d.corner;
      const v = { x: C.x - A.x, y: C.y - A.y }, w = { x: C.x + dx - A.x, y: C.y + dy - A.y };
      const f = Math.max(0.1, Math.min(10, (v.x * w.x + v.y * w.y) / Math.max(1e-6, v.x * v.x + v.y * v.y)));
      d.f = f;
      d.el.setAttribute("transform", `translate(${A.x} ${A.y}) scale(${f}) translate(${-A.x} ${-A.y}) ${d.orig}`);
      d.cp?.forEach(([c, o]) => c.setAttribute("transform", `translate(${A.x} ${A.y}) scale(${f}) translate(${-A.x} ${-A.y}) ${o}`));
      setSelBox({ x: A.x + (d.box.x - A.x) * f, y: A.y + (d.box.y - A.y) * f, w: d.box.w * f, h: d.box.h * f });
    }
  };
  const onPageUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const tp = tapPick.current;
    if (tp && tp.pid === e.pointerId) {
      tapPick.current = null;
      if (Math.hypot(e.clientX - tp.x, e.clientY - tp.y) < 10) setEd(tp.tab ? { designTab: "sign", designSel: tp.id } : { designSel: tp.id });
    }
    const out = tapOut.current;
    if (out && out.pid === e.pointerId) {
      tapOut.current = null;
      if (Math.hypot(e.clientX - out.x, e.clientY - out.y) < 10) setEd({ designSel: null });
    }
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    setGuides({ x: [], y: [] });
    if (d.mode === "turn") {
      setTurning(null);
      if (d.orig) d.el.setAttribute("style", d.orig); else d.el.removeAttribute("style");
      if (d.rot !== d.rot0) patchPicked(t, d.id, { rot: d.rot });
      return;
    }
    if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) < 3) {
      d.el.setAttribute("transform", d.orig);
      d.cp?.forEach(([c, o]) => c.setAttribute("transform", o));
      setSelBox(d.box);
      // (a finger tapping what's already picked: its words to type, as in any design app)
      if (e.pointerType === "touch" && d.mode === "move" && !d.id.startsWith("label:") && pickedOf(live, t, d.id)?.has.text) startTyping(d.id);
      return;
    }
    if (d.mode === "move" && d.id.startsWith("label:")) {
      const g = groundShift(d.dx, d.dy);
      moveLabel(d.id.slice(6), g.x, g.y);
    } else if (d.mode === "move") movePicked(t, d.id, d.dx, d.dy, d.nat, d.W, d.H);
    else sizePicked(t, d.id, d.f, d.anchor, d.nat, d.W, d.H);
  };
  /** Double-click on text: type on the page (on its drawing: not on its toolbar or a list over it). */
  const onPageDouble = (e: React.MouseEvent) => {
    if (!editing || typing || !onDrawing(e.target)) return;
    const id = pieceAt(e.target, e.clientX, e.clientY);
    if (id && pickedOf(doc, t, id)?.has.text) startTyping(id);
  };
  /** Its words typed in a box over it, in the font it's drawn in. */
  const startTyping = (id: string) => {
    const el = elOf(id), p = pickedOf(getDoc(), t, id);
    if (!p || !page) return;
    const tx = el?.querySelector("text");
    // (one with no words on the page yet: its box over the middle of the page)
    const { W, H } = dims();
    const box = el ? boxOf(el) : { x: W * 0.3, y: H * 0.42, w: W * 0.4, h: H * 0.06 };
    setEd({ designSel: id });
    setTyping({ id, text: p.text ?? "", box, font: tx ? getComputedStyle(tx).fontFamily : undefined, lines: p.lines, placeholder: p.placeholder });
  };
  // (Layers asks for a piece's words to be typed: once the page shows it, or with nothing to show)
  const typingRef = useRef(startTyping);
  typingRef.current = startTyping;
  useEffect(() => onAskTyping(() => { const id = takeTyping(); if (id) setTimeout(() => typingRef.current(id), 0); }), []);
  const doneTyping = (keep: boolean) => {
    if (typing && keep) patchPicked(t, typing.id, { text: typing.text });
    setTyping(null);
  };
  /** The toolbar's − and +: bigger or smaller about its middle. */
  const grow = (f: number) => {
    const el = designSel ? elOf(designSel) : null;
    if (!el || !designSel) return;
    // (a QR code's size buttons size its words, the number they show; its corners size it all)
    if (sizeWordsPicked(t, designSel, f)) return;
    const b = boxOf(el), { W, H } = dims();
    sizePicked(t, designSel, f, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, placedBox(el), W, H);
  };
  // (a phone's Size slider held: the piece scaled about its middle as it moves, as a pinch does)
  const growing = useRef<{ g: SVGGElement; orig: string; box: Box } | null>(null);
  const growLive = (f: number | null) => {
    const g = designSel ? (elOf(designSel) as SVGGElement | null) : null;
    if (!g) return;
    const s = (growing.current ??= { g, orig: g.getAttribute("transform") ?? "", box: boxOf(g) });
    if (f === null) { s.g.setAttribute("transform", s.orig); growing.current = null; return; }
    const A = { x: s.box.x + s.box.w / 2, y: s.box.y + s.box.h / 2 };
    s.g.setAttribute("transform", `translate(${A.x} ${A.y}) scale(${f}) translate(${-A.x} ${-A.y}) ${s.orig}`);
    setSelBox({ x: A.x + (s.box.x - A.x) * f, y: A.y + (s.box.y - A.y) * f, w: s.box.w * f, h: s.box.h * f });
  };
  /** A font shown on the picked piece while it's pointed at in the list (not kept). */
  const previewFont = (f: string | null) => {
    const el = designSel ? elOf(designSel) : null;
    if (!el) return;
    for (const x of Array.from(el.querySelectorAll<SVGElement>("text, tspan"))) {
      if (f) x.style.setProperty("font-family", pieceFont(f), "important");
      else x.style.removeProperty("font-family");
    }
    if (svgHost.current) fitTexts(svgHost.current);
  };
  // A finger on the picked piece (or its corners) moves it, never the page under it: the browser
  // is told not to scroll before it starts to (a style saying so isn't heard on a drawing's shapes).
  // On it is anywhere in its box, as picking has it: not only on its ink, and not lost to a panel
  // behind it (the number on a tee sign's band), or the page scrolls along under the finger and
  // the piece barely seems to move
  const onPicked = useRef<(x: number, y: number) => boolean>(() => false);
  onPicked.current = (x, y) => {
    const id = useEditor.getState().designSel, host = svgHost.current;
    const g = id ? elOf(id) : null;
    if (!g || !host) return false;
    const b = boxOf(g), hr = host.getBoundingClientRect(), k = kRef.current, px = (x - hr.left) / k, py = (y - hr.top) / k, m = 6 / k;
    return px >= b.x - m && px <= b.x + b.w + m && py >= b.y - m && py <= b.y + b.h + m;
  };
  useEffect(() => {
    const el = pageEl.current;
    if (!el || !editing) return;
    const onStart = (ev: TouchEvent) => {
      const id = useEditor.getState().designSel;
      if (!id || ev.touches.length > 1) return;
      const tg = ev.target as Element;
      if (tg.closest?.("[data-corner],[data-turn-handle]")) { ev.preventDefault(); return; }
      if (onPicked.current(ev.touches[0].clientX, ev.touches[0].clientY)) ev.preventDefault();
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    return () => el.removeEventListener("touchstart", onStart);
  }, [editing, page]);
  // A pinch on the picked piece (a phone) sizes it; anywhere else it zooms the page
  const pieceRef = useRef({ designSel, t, page });
  pieceRef.current = { designSel, t, page };
  useEffect(() => {
    const el = box.current;
    if (!el || !compact) return;
    let pinch: { id: string; g: SVGGElement; orig: string; d: number; box: Box; nat: Box; mid: { x: number; y: number }; f: number } | null = null;
    const spread = (tl: TouchList) => Math.hypot(tl[0].clientX - tl[1].clientX, tl[0].clientY - tl[1].clientY);
    const onStart = (ev: TouchEvent) => {
      const { designSel: id } = pieceRef.current;
      if (ev.touches.length !== 2 || !id || id.startsWith("label:")) return;
      // (what keeps its own size: the pinch zooms the page instead)
      if (pickedOf(getDoc(), pieceRef.current.t, id)?.has.size === false) return;
      const g = elOf(id), host = svgHost.current;
      if (!g || !host) return;
      const b = boxOf(g), hr = host.getBoundingClientRect(), k = kRef.current;
      const mx = ((ev.touches[0].clientX + ev.touches[1].clientX) / 2 - hr.left) / k, my = ((ev.touches[0].clientY + ev.touches[1].clientY) / 2 - hr.top) / k;
      // (both fingers on it, and it big enough on the screen for two: a small label or QR code
      // sizes by its corners and Size, and two fingers there move the page as anywhere else)
      if (Math.min(b.w, b.h) * k < 96) return;
      const near = 12 / k, on = (x: number, y: number) => x >= b.x - near && x <= b.x + b.w + near && y >= b.y - near && y <= b.y + b.h + near;
      const at = (i: number) => [(ev.touches[i].clientX - hr.left) / k, (ev.touches[i].clientY - hr.top) / k] as const;
      if (!on(...at(0)) || !on(...at(1)) || !on(mx, my)) return;
      ev.stopImmediatePropagation();
      // (not a tap off it or on another piece, and not a drag by the first finger)
      tapOut.current = null;
      tapPick.current = null;
      const dr = drag.current;
      if (dr) { dr.el.setAttribute("transform", dr.orig); drag.current = null; setGuides({ x: [], y: [] }); }
      pinch = { id, g, orig: g.getAttribute("transform") ?? "", d: Math.max(1, spread(ev.touches)), box: b, nat: placedBox(g), mid: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, f: 1 };
    };
    const onMove = (ev: TouchEvent) => {
      if (!pinch || ev.touches.length !== 2) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const f = Math.max(0.2, Math.min(6, spread(ev.touches) / pinch.d)), A = pinch.mid;
      pinch.f = f;
      pinch.g.setAttribute("transform", `translate(${A.x} ${A.y}) scale(${f}) translate(${-A.x} ${-A.y}) ${pinch.orig}`);
      setSelBox({ x: A.x + (pinch.box.x - A.x) * f, y: A.y + (pinch.box.y - A.y) * f, w: pinch.box.w * f, h: pinch.box.h * f });
    };
    const onEnd = (ev: TouchEvent) => {
      if (!pinch || ev.touches.length >= 2) return;
      ev.stopImmediatePropagation();
      const p = pinch, { t: tk, page: pg } = pieceRef.current;
      pinch = null;
      if (Math.abs(p.f - 1) > 0.02 && pg) sizePicked(tk, p.id, p.f, p.mid, p.nat, pg.width, pg.height / (tk === "card" ? 2 : 1));
      else p.g.setAttribute("transform", p.orig);
    };
    // (heard before the page's own pinch to zoom)
    el.addEventListener("touchstart", onStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onMove, { capture: true, passive: false });
    el.addEventListener("touchend", onEnd, { capture: true });
    el.addEventListener("touchcancel", onEnd, { capture: true });
    return () => {
      el.removeEventListener("touchstart", onStart, { capture: true });
      el.removeEventListener("touchmove", onMove, { capture: true });
      el.removeEventListener("touchend", onEnd, { capture: true });
      el.removeEventListener("touchcancel", onEnd, { capture: true });
    };
  }, [compact]);
  // Keys for what's picked: Delete hides it (or takes away what was added), arrows nudge it
  // (Shift: more), Ctrl+D copies what was added, Enter types into text, Esc lets go. Before the
  // map's own keys hear them (Enter on a button of its toolbar presses that button)
  useEffect(() => {
    if (!editing || !designSel || typing) return;
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg.closest?.("input,textarea,select,[contenteditable=true],[role=dialog]")) return;
      if ((e.key === "Enter" || e.key === " ") && tg.closest?.("button,a,[data-page-bar]")) return;
      const mod = e.ctrlKey || e.metaKey;
      let used = true;
      if (e.key === "Escape") setEd({ designSel: null });
      else if (!mod && (e.key === "Delete" || e.key === "Backspace")) removePicked(t, designSel);
      else if (mod && e.key.toLowerCase() === "d") duplicatePicked(t, designSel);
      else if (!mod && e.key === "Enter" && pickedOf(live, t, designSel)?.has.text) startTyping(designSel);
      else if (!mod && e.key.startsWith("Arrow") && page) {
        const el = elOf(designSel);
        if (!el) return;
        const step = e.shiftKey ? 10 : 1, { W, H } = dims();
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (designSel.startsWith("label:")) { const g = groundShift(dx, dy); moveLabel(designSel.slice(6), g.x, g.y); }
        else movePicked(t, designSel, dx, dy, placedBox(el), W, H);
      } else used = false;
      if (used) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, designSel, page, setEd, t, typing, live]);

  // The toolbar over the piece (under it when there's no room above), kept inside what shows of the
  // page however wide it is and wherever the page is scrolled (on a phone it's docked at the bottom)
  const barRef = useRef<HTMLDivElement>(null);
  const kNow = useRef(1);
  useLayoutEffect(() => {
    const bar = barRef.current, sc = box.current, pg = pageEl.current;
    if (!bar || !sc || !pg || !selBox || compact) return;
    const place = () => {
      const k = kNow.current, sr = sc.getBoundingClientRect(), pr = pg.getBoundingClientRect(), bw = bar.offsetWidth, bh = bar.offsetHeight;
      const minX = sr.left - pr.left + 8, maxX = sr.left - pr.left + sc.clientWidth - bw - 8;
      const minY = sr.top - pr.top + 8, maxY = sr.top - pr.top + sc.clientHeight - bh - 8;
      // (above it, or under it clear of its turning handle)
      let y = selBox.y * k - bh - 10;
      if (y < minY) y = (selBox.y + selBox.h) * k + 52;
      bar.style.left = `${Math.max(minX, Math.min(maxX, selBox.x * k))}px`;
      bar.style.top = `${Math.max(minY, Math.min(maxY, y))}px`;
    };
    place();
    sc.addEventListener("scroll", place, { passive: true });
    const ro = new ResizeObserver(place);
    ro.observe(bar);
    return () => { sc.removeEventListener("scroll", place); ro.disconnect(); };
  });

  // A phone's Map step, as the 3D map is: the page under the bars (the printouts are chips on the
  // top bar, PageChips), at first filling the room between them, a finger sliding it about and a
  // pinch zooming it; Fit shows it whole. What opens over it floats over it: nothing zooms
  const phonePage = compact && !only;
  const BAR = 76; // (the tools' sheet along the bottom, the same room kept whatever's open)
  const room = { top: topInset + 6, bottom: BAR + 8 };
  const visW = size.w - 20, visH = Math.max(80, size.h - room.top - room.bottom);
  // (filling: top to foot, under the bars and the tools as the 3D map is)
  const fillH = Math.max(80, size.h);
  // (as it first shows, or Fit and Fill: the page's middle in the middle of the room)
  const view = `${tabId}|${whole}|${page?.width}|${page?.height}|${size.w}|${size.h}|${zoom === null}`;
  useLayoutEffect(() => {
    const el = box.current, pg = pageEl.current;
    if (!phonePage || zoom !== null || !el || !pg) return;
    const r = el.getBoundingClientRect(), pr = pg.getBoundingClientRect();
    el.scrollLeft += pr.left + pr.width / 2 - (r.left + r.width / 2);
    // (filling the screen top to foot, under the bars as the 3D map is; smaller, in the middle of
    // the room between them)
    el.scrollTop += pr.height > visH + 2 ? pr.top + pr.height / 2 - (r.top + r.height / 2) : pr.top + pr.height / 2 - (r.top + room.top + visH / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  // (another printout or hole: the new page fades in, not swapped in at once)
  const shown = `${tabId}|${preview === "map" ? "" : holeId}`;
  useLayoutEffect(() => {
    const pg = pageEl.current;
    if (!pg || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pg.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
  }, [shown]);
  // A button's zoom (− and +, Fit and Fill) glides there, about the spot it keeps, instead of
  // jumping: the page drawn at its new size at once, scaled from the old and let go
  const glide = useRef<{ k: number; fx: number; fy: number } | null>(null);
  const glideEnd = useRef(0);
  // (the zoom slider held: where it started, the page scaled as it slides and drawn once let go)
  const slideFrom = useRef<{ k: number; m: { fx: number; fy: number; vx: number; vy: number } } | null>(null);
  useLayoutEffect(() => {
    const g = glide.current, pg = pageEl.current;
    glide.current = null;
    if (!g || !pg || Math.abs(g.k / kNow.current - 1) < 0.01 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pg.style.transition = "none";
    pg.style.transformOrigin = `${g.fx * 100}% ${g.fy * 100}%`;
    pg.style.transform = `scale(${g.k / kNow.current})`;
    void pg.offsetWidth;
    pg.style.transition = "transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1)";
    pg.style.transform = "";
    // (let go once it's there, so a pinch after it follows the fingers at once; a render meanwhile,
    // the painting's progress say, leaves it gliding)
    window.clearTimeout(glideEnd.current);
    glideEnd.current = window.setTimeout(() => { pg.style.transition = ""; pg.style.transformOrigin = ""; }, 320);
  });
  /** The spot in the middle of what's seen (of the room between the bars, on a phone's Map step). */
  const seenMiddle = () => {
    const el = box.current, pg = pageEl.current;
    if (!el || !pg) return null;
    const r = el.getBoundingClientRect(), pr = pg.getBoundingClientRect();
    const vx = r.width / 2, vy = phonePage ? room.top + visH / 2 : r.height / 2;
    return { fx: Math.max(0, Math.min(1, (r.left + vx - pr.left) / pr.width)), fy: Math.max(0, Math.min(1, (r.top + vy - pr.top) / pr.height)), vx, vy };
  };
  /** Zoomed by a button: about the middle of what's seen, gliding there. */
  const zoomTo = (next: number | null, opts: { whole?: boolean } = {}) => {
    const m = seenMiddle();
    if (m) {
      // (Fit and Fill bring the page's middle to the middle; − and + keep the spot in the middle)
      if (next !== null) anchor.current = m;
      glide.current = { k: kNow.current, ...(next === null ? { fx: 0.5, fy: 0.5 } : { fx: m.fx, fy: m.fy }) };
    }
    setZoom(next);
    if (opts.whole !== undefined) setWhole(opts.whole);
  };

  if (!page) return null;
  const margin = compact ? 20 : 48;
  // (a phone: the page fitted clear of the picked piece's toolbar, or of the zoom buttons)
  const pill = compact && !designSel && !toolOpen;
  const fit = phonePage ? Math.min(visW / page.width, visH / page.height) : Math.min((size.w - margin) / page.width, (size.h - margin - (compact && designSel ? dockH : pill ? 52 : 0)) / page.height);
  // (filling the room: as wide and as tall as it, the rest a slide away)
  const fill = phonePage ? Math.min(fit * 3, Math.max(visW / page.width, fillH / page.height)) : fit;
  // (the course map fills the screen, a poster looked about as the 3D map is; a sign, a page and
  // the card show whole, each a thing to see at once)
  const fills = phonePage && preview === "map";
  const k = zoom ?? (fills && !whole ? fill : fit);
  kRef.current = k;
  kNow.current = k;
  const html = page.svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${page.width * k}" height="${page.height * k}"`);
  htmlRef.current = html;
  const zb = compact ? "w-11 h-11 flex items-center justify-center rounded-full active:bg-white/[0.14] hover:bg-white/[0.08]" : "p-1.5 rounded-full hover:bg-white/[0.08]";
  const zoomGroup = (
    <div className="ml-auto flex items-center gap-1 text-zinc-300">
      <button className={zb} aria-label="Zoom out" onClick={() => zoomTo(Math.max(0.1, k / 1.25))}><Minus size={compact ? 19 : 16} /></button>
      <span className={`${compact ? "text-[13px] w-11" : "text-xs w-12"} text-center tabular-nums`} data-testid="design-zoom">{Math.round(k * 100)}%</span>
      <button className={zb} aria-label="Zoom in" onClick={() => zoomTo(Math.min(6, k * 1.25))}><Plus size={compact ? 19 : 16} /></button>
      {/* (a phone: the whole page, or back to filling the screen) */}
      {phonePage ? (zoom !== null || !whole
        ? <button className={zb} aria-label="Fit the page" title="The whole page" onClick={() => zoomTo(null, { whole: true })}><Scan size={19} /></button>
        : <button className={zb} aria-label="Fill the screen" title="Fill the screen" onClick={() => zoomTo(null, { whole: false })}><Maximize2 size={19} /></button>)
        : (!compact || zoom !== null) && <button className={zb} aria-label="Fit the page" onClick={() => zoomTo(null)}><Scan size={compact ? 19 : 16} /></button>}
    </div>
  );
  // (on a phone each tab as wide as its label, short ones: all five across the screen)
  const tab = (id: Preview | "general", label: string, short = label) => (
    <button key={id} role="tab" aria-selected={(only && tabId === "general" ? "map" : tabId) === id} onClick={() => { setPreview(id); setZoom(null); }} className={`${compact ? "flex-auto min-w-0 h-11 px-2 rounded-full text-[13px] whitespace-nowrap" : "px-3.5 py-1.5 rounded-full text-sm"} font-semibold ${(only && tabId === "general" ? "map" : tabId) === id ? "bg-white/[0.2] text-zinc-50" : "text-zinc-300 hover:bg-white/[0.09]"}`}>
      {compact ? short : label}
    </button>
  );
  const sel = (select: string) => `bg-white/[0.08] rounded-full px-3 ${compact ? "h-11 text-base min-w-0" : "py-1 text-sm"} ${select}`;
  // (the holes in the order they're played, a step either way beside the list)
  const ordered = byNumber(doc.holes), at = ordered.findIndex(h => h.id === holeId);
  const step = compact ? "w-11 h-11 flex items-center justify-center rounded-full text-zinc-200 bg-white/[0.08] active:bg-white/[0.14] disabled:opacity-35" : "p-1 rounded-full text-zinc-300 hover:bg-white/[0.09] disabled:opacity-35";
  const holeStep = (preview === "sign" || preview === "page") && doc.holes.length > 0 ? (
    <div className="flex items-center gap-0.5 min-w-0" data-testid="hole-step">
      <button className={step} aria-label="Hole before" title="Hole before" disabled={at <= 0} onClick={() => setHole(ordered[at - 1].id)}><ChevronLeft size={compact ? 18 : 15} /></button>
      <select aria-label={preview === "sign" ? "Hole for the tee sign" : "Hole for the hole page"} className={sel("")} value={holeId ?? ""} onChange={e => setHole(e.target.value)}>
        {ordered.map(h => <option key={h.id} value={h.id}>Hole {holeLabel(doc, h.id)}</option>)}
      </select>
      <button className={step} aria-label="Next hole" title="Next hole" disabled={at < 0 || at >= ordered.length - 1} onClick={() => setHole(ordered[at + 1].id)}><ChevronRight size={compact ? 18 : 15} /></button>
    </div>
  ) : null;
  // (a phone's Map step, at the page's foot: the hole, or the paper, which opens the Paper tool)
  const corner = !phonePage ? null : holeStep ? <div className="pointer-events-auto glass rounded-2xl border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,0.35)] p-0.5 min-w-0">{holeStep}</div>
    : preview === "map" && editing ? (
      <button className="pointer-events-auto glass rounded-2xl border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,0.35)] h-11 min-w-0 truncate px-3.5 text-[13px] font-semibold text-zinc-100 active:bg-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={() => askOpen("page-tool:fold-paper")} aria-label={`Paper: ${PAPER[paper].label}`} data-testid="paper-chip">
        {PAPER[paper].label}
      </button>
    ) : null;
  // (a phone's Map step: zoom down the right, as the 3D map's: + and −, the slider between them
  // where there's room, and the whole page or the screen filled)
  const kMin = fit, kMax = Math.max(fit * 8, fill * 3);
  const tOf = (kk: number) => Math.min(1, Math.max(0, Math.log(kk / kMin) / Math.log(kMax / kMin)));
  const kOf = (t: number) => kMin * Math.pow(kMax / kMin, Math.min(1, Math.max(0, t)));
  const slide = (t: number) => {
    if (!slideFrom.current) { const m = seenMiddle(); if (!m) return; slideFrom.current = { k, m }; }
    const s = slideFrom.current;
    setPinchScale({ s: kOf(t) / s.k, ox: s.m.fx * page.width * s.k, oy: s.m.fy * page.height * s.k });
  };
  const slid = (t: number) => {
    const s = slideFrom.current;
    slideFrom.current = null;
    setPinchScale(null);
    if (!s) return;
    anchor.current = s.m;
    setZoom(kOf(t));
  };
  const cb = "w-11 h-11 flex items-center justify-center text-zinc-100 active:bg-white/[0.13] focus:outline-none focus-visible:bg-white/[0.13]";
  const cg = "pointer-events-auto glass rounded-2xl border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden divide-y divide-white/5";
  const roomH = size.h - topInset - (designSel ? dockH : bottomInset) - 16;
  const sliderH = roomH >= 44 * 3 + 8 + 112 ? 112 : roomH >= 44 * 3 + 8 + 72 ? 72 : 0;
  const shownK = pinchScale && slideFrom.current ? slideFrom.current.k * pinchScale.s : k;
  const phoneControls = phonePage && (
    <div className="absolute right-2 z-20 flex flex-col gap-2 items-end pointer-events-none" style={{ top: topInset + 2 }} data-testid="page-controls">
      <div className={cg}>
        <button className={cb} aria-label="Zoom in" onClick={() => zoomTo(Math.min(6, k * 1.4))}><Plus size={20} /></button>
        {sliderH > 0 && <PageZoomSlider t={tOf(shownK)} height={sliderH} onSlide={slide} onDone={slid} onStep={d => zoomTo(kOf(tOf(k) + d))} />}
        <button className={cb} aria-label="Zoom out" onClick={() => zoomTo(Math.max(0.1, k / 1.4))}><Minus size={20} /></button>
        <span className="sr-only" data-testid="design-zoom">{Math.round(k * 100)}%</span>
      </div>
      {zoom !== null || (fills && !whole)
        ? <button className={`${cg} ${cb}`} aria-label="Fit the page" title="The whole page" onClick={() => zoomTo(null, { whole: true })}><Maximize2 size={18} /></button>
        : fills && <button className={`${cg} ${cb}`} aria-label="Fill the screen" title="Fill the screen" onClick={() => zoomTo(null, { whole: false })}><Expand size={18} /></button>}
    </div>
  );
  const toolbar = editing && designSel && selBox && !typing ? (
    <PieceToolbar t={t} id={designSel} onGrow={grow} onGrowLive={growLive} onPreviewFont={previewFont} onEditText={() => startTyping(designSel)} onDone={() => setEd({ designSel: null })} onPanel={setPanelOpen} docked={compact} drawn={drawn} />
  ) : null;
  const picked = editing && designSel ? pickedOf(live, t, designSel) : null;
  const note = editing && designSel ? noteOf(live, t, designSel) : null;
  // (a phone: what a finger does with the piece picked, as far as it goes)
  const hint = picked ? ["Drag it to move", picked.has.size && "a corner to size it", picked.has.text && "tap it again to type"].filter(Boolean).join(" · ") : "";
  return (
    <div className="absolute inset-0 z-20 bg-zinc-950 flex flex-col isolate overflow-clip" style={compact && !phonePage ? { paddingTop: topInset } : undefined} data-testid="map-designer">
      <Woods inset />
      {!phonePage && <div ref={controls} className={compact ? "flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-2" : "flex items-center gap-2 px-3 py-2.5 flex-wrap"}>
        <div role="tablist" className={compact ? "w-full flex gap-1" : "flex gap-1"}>{[...(only ? [] : [tab("general", "General")]), tab("map", "Course map", "Map"), tab("sign", "Tee sign", "Sign"), tab("page", "Hole page", "Page"), tab("scorecard", "Scorecard", "Card")]}</div>
        {/* (a phone: the hole and the size on one row, the size by its short name) */}
        <div className={compact ? "w-full flex items-center gap-2 min-w-0 empty:hidden" : "contents"}>
        {holeStep}
        {/* (Export shows the sizes in its own panel) */}
        {preview === "sign" && !general && !only && (
          <select aria-label="Tee sign size" className={sel("")} value={signSize} onChange={e => { setSignSize(e.target.value as SignSize); setZoom(null); }}>
            {(Object.keys(SIGN_SIZES) as SignSize[]).map(k => <option key={k} value={k}>{compact ? SHORT[k] : SIGN_SIZES[k].label}</option>)}
          </select>
        )}
        {preview === "page" && !only && (
          <select aria-label="Hole page size" className={sel("")} value={pageSize} onChange={e => { setPageSize(e.target.value as HolePageSize); setZoom(null); }}>
            {(Object.keys(HOLE_PAGES) as HolePageSize[]).map(k => <option key={k} value={k}>{compact ? SHORT[k] : HOLE_PAGES[k].label}</option>)}
          </select>
        )}
        {preview === "map" && editing && (
          <select aria-label="Paper size" className={sel("")} value={paper} onChange={e => { setPaper(e.target.value as PaperSize); setZoom(null); }}>
            {(Object.keys(PAPER) as PaperSize[]).map(p => <option key={p} value={p}>{PAPER[p].label}</option>)}
          </select>
        )}
        </div>
        {/* ("Changes go to" is at the top of the sign's and page's panel) */}
        {!compact && zoomGroup}
      </div>}
      {/* (A phone: the zoom buttons float over the page, in the thumb's reach, out of the way of a
          tool that's open; the picked piece's toolbar takes their place along the bottom) */}
      {pill && !phonePage && (
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-end gap-2 pointer-events-none">
          <div className="glass ml-auto shrink-0 rounded-[22px] p-0.5 pointer-events-auto">{zoomGroup}</div>
        </div>
      )}
      {/* (a phone's Map step, as the 3D map has them: the paper or the hole at the top left where
          the map's scale is, zoom down the right) */}
      {phonePage && corner && !designSel && <div className="absolute left-2 z-20 max-w-[calc(100%-76px)] flex" style={{ top: topInset + 2 }}>{corner}</div>}
      {phoneControls}
      {compact && toolbar && (
        <div ref={dock} className={phonePage ? "absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-1.5" : "absolute inset-x-2 bottom-2 z-30 flex flex-col items-center gap-1"}>
          {!panelOpen && (note || hint) && <div className="pointer-events-none rounded-full bg-black/55 px-2.5 py-0.5 text-[11.5px] text-zinc-200 text-center" data-testid="phone-hint">{note ?? hint}</div>}
          {toolbar}
        </div>
      )}
      <div ref={box} className={`flex-1 overflow-auto ${phonePage ? "dg-noscrollbar" : compact ? "dg-scroll" : ""} cursor-grab`} data-testid="design-scroll" onPointerDown={onBoxDown} onPointerMove={onBoxMove} onPointerUp={onBoxUp} onPointerCancel={onBoxUp}>
        {/* (as wide as the page when zoomed in past the window, so all of it scrolls into view) */}
        <div className={`w-max min-w-full min-h-full flex items-center justify-center ${compact ? "p-2.5" : "p-6"}`} style={phonePage ? { paddingTop: room.top, paddingBottom: Math.max(room.bottom, (designSel ? dockH : bottomInset) + 8), paddingRight: 64 } : compact && designSel ? { paddingBottom: dockH + 8 } : undefined}>
          <div
            ref={pageEl}
            className="relative shrink-0"
            onPointerDown={onPageDown}
            onPointerMove={onPageMove}
            onPointerUp={onPageUp}
            onPointerCancel={onPageUp}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={onPageDouble}
            style={{ width: page.width * k, height: page.height * k, ...(pinchScale ? { transform: `scale(${pinchScale.s})`, transformOrigin: `${pinchScale.ox}px ${pinchScale.oy}px` } : {}) }}
          >
            <div
              ref={svgHost}
              data-testid="design-page"
              className={`shadow-2xl bg-white ${editing || general ? (t === "map" ? "[&_[data-el]:not([data-el=map])]:cursor-pointer" : "[&_[data-el]]:cursor-pointer [&_[data-pc]]:cursor-pointer") : ""}`}
              style={{ width: page.width * k, height: page.height * k }}
              dangerouslySetInnerHTML={{ __html: held ?? html }}
            />
            {editing && <style>{`[data-testid=design-page] [data-label]{cursor:move}${designSel ? `[data-testid=design-page] ${designSel.startsWith("label:") ? `[data-label="${designSel.slice(6).replace(/"/g, "")}"]` : `[data-el="${designSel.replace(/"/g, "")}"]`}{cursor:move;touch-action:none}` : ""}`}</style>}
            {editing && noLink.map((b, i) => (
              <div key={i} className="absolute pointer-events-none flex items-center justify-center" style={{ left: b.x * k, top: b.y * k, width: b.w * k, height: Math.min(b.h, b.w) * k }} data-testid="qr-no-link">
                <span className="rounded-full bg-orange-500 text-zinc-950 text-[11px] font-bold px-2 py-0.5 shadow whitespace-nowrap">Add a link</span>
              </div>
            ))}
            {(editing || general) && hover && hover.id !== designSel && [hover.box, ...(hover.copies ?? [])].map((hb, i) => (
              <div key={i} className="absolute pointer-events-none rounded-[2px]" data-testid={i ? "page-hover-copy" : "page-hover"} style={{ left: hb.x * k - 2, top: hb.y * k - 2, width: hb.w * k + 4, height: hb.h * k + 4, outline: "1.5px solid rgba(56,189,248,.9)" }} />
            ))}
            {editing && designSel && selBox && copyBoxes.map((cb, i) => (
              <div key={i} className="absolute pointer-events-none" data-testid="page-selection-copy" style={{ left: cb.x * k, top: cb.y * k, width: cb.w * k, height: cb.h * k, outline: "2px solid #f97316", outlineOffset: 2, opacity: 0.6 }} />
            ))}
            {guides.x.map(x => <div key={`gx${x}`} className="absolute top-0 bottom-0 w-px pointer-events-none bg-pink-500" style={{ left: x * k }} data-testid="snap-guide" />)}
            {guides.y.map(y => <div key={`gy${y}`} className="absolute left-0 right-0 h-px pointer-events-none bg-pink-500" style={{ top: y * k }} data-testid="snap-guide" />)}
            {editing && designSel && selBox && (
              <div className="absolute pointer-events-none" data-testid="page-selection" style={{ left: selBox.x * k, top: selBox.y * k, width: selBox.w * k, height: selBox.h * k, outline: "2px solid #f97316", outlineOffset: 2 }}>
                {!designSel.startsWith("label:") && !typing && picked?.has.turn && (
                  /* (under it, as in other design apps: clear of whatever's above the page) */
                  <div className="absolute left-1/2 -bottom-9 touch:-bottom-12 -translate-x-1/2 flex flex-col items-center pointer-events-auto" style={{ touchAction: "none" }}>
                    <div className="w-px h-2.5 touch:h-3 bg-orange-500" />
                    <div data-turn-handle data-testid="page-turn" title="Turn it (Shift: 15° at a time)" className="w-6 h-6 touch:w-9 touch:h-9 rounded-full bg-white border-2 border-orange-500 shadow flex items-center justify-center text-orange-500 cursor-grab" style={{ touchAction: "none" }}>
                      <RotateCw size={compact ? 16 : 12} strokeWidth={2.6} />
                    </div>
                  </div>
                )}
                {turning !== null && <div className="absolute left-1/2 -translate-x-1/2 -top-10 glass rounded-full px-2.5 py-1 text-[12px] font-semibold text-zinc-50 tabular-nums" data-testid="page-turn-angle">{turning}°</div>}
                {/* (its corners, to size it: none on what keeps its own size) */}
                {!designSel.startsWith("label:") && !typing && picked?.has.size !== false && ["0,0", "1,0", "0,1", "1,1"].map(c => {
                  const [cx, cy] = c.split(",").map(Number);
                  return <div key={c} data-corner={c} data-testid="page-corner" className="absolute w-3 h-3 touch:w-[18px] touch:h-[18px] bg-white border-2 border-orange-500 rounded-full pointer-events-auto" style={{ left: `calc(${cx * 100}% - ${compact ? 9 : 6}px)`, top: `calc(${cy * 100}% - ${compact ? 9 : 6}px)`, cursor: cx === cy ? "nwse-resize" : "nesw-resize", touchAction: "none" }} />;
                })}
              </div>
            )}
            {!compact && toolbar && (
              <div ref={barRef} className="absolute z-30 flex flex-col items-start gap-1">
                {toolbar}
                {note && <div className="pointer-events-none rounded-full bg-black/65 px-2.5 py-0.5 text-[11.5px] text-zinc-100" data-testid="piece-note">{note}</div>}
              </div>
            )}
            {typing && (
              <>
                <textarea
                  autoFocus
                  aria-label="The words"
                  data-testid="page-typing"
                  placeholder={typing.placeholder}
                  className={`absolute z-40 rounded-[8px] bg-zinc-950/90 text-zinc-50 placeholder:text-zinc-500 ring-2 ring-orange-400 px-2 py-1.5 ${compact ? "text-[16px]" : "text-[15px]"} leading-snug resize-none focus:outline-none`}
                  style={{ left: typing.box.x * k - 4, top: typing.box.y * k - 4, width: Math.max(220, typing.box.w * k + 8), height: Math.max(64, typing.box.h * k + 8), fontFamily: typing.font }}
                  value={typing.text}
                  onChange={e => setTyping({ ...typing, text: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === "Escape") { e.preventDefault(); doneTyping(false); return; }
                    if (e.key !== "Enter") return;
                    // (a phone's Enter starts a new line where the words can have one; Done finishes.
                    // Elsewhere Enter finishes, and Shift+Enter starts a new line)
                    if (compact ? !typing.lines : !e.shiftKey || !typing.lines) { e.preventDefault(); doneTyping(true); }
                  }}
                  onBlur={() => doneTyping(true)}
                  onPointerDown={e => e.stopPropagation()}
                />
                <div className="absolute z-40 flex items-center gap-1.5" style={{ left: typing.box.x * k - 4, top: typing.box.y * k + Math.max(60, typing.box.h * k + 4) + 6 }} data-page-bar onPointerDown={e => e.stopPropagation()}>
                  {compact ? (
                    <>
                      <button className="h-11 flex items-center rounded-full px-4 bg-orange-500 text-zinc-950 text-[13.5px] font-bold" onPointerDown={e => e.preventDefault()} onClick={() => doneTyping(true)} data-testid="typing-done">Done</button>
                      <button className="h-11 flex items-center rounded-full px-4 glass text-zinc-100 text-[13.5px] font-semibold" onPointerDown={e => e.preventDefault()} onClick={() => doneTyping(false)}>Cancel</button>
                    </>
                  ) : (
                    <span className="rounded-full bg-black/70 px-2.5 py-0.5 text-[11.5px] text-zinc-100 whitespace-nowrap" data-testid="typing-hint">{typing.lines ? "Enter to finish, Shift+Enter for a new line, Esc to cancel." : "Enter to finish, Esc to cancel."}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {painting !== null && (
        // (just under the controls over the page, however many rows they take: never over them)
        <div className="absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-2.5 rounded-full glass shadow-lg px-3.5 py-1.5" style={phonePage ? { bottom: (designSel ? dockH : bottomInset) + 10 } : { top: (controlsH || (compact ? topInset + 104 : 48)) + 8 }} role="progressbar" aria-label="Painting the map" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(painting * 100)} data-testid="paint-progress">
          <span className="text-xs font-semibold text-zinc-200 whitespace-nowrap">Painting the map</span>
          <span className="w-32 h-1.5 rounded-full bg-white/[0.14] overflow-hidden"><span className="block h-full bg-orange-500 transition-[width] duration-200" style={{ width: `${Math.max(3, Math.round(painting * 100))}%` }} /></span>
          <span className="text-xs tabular-nums text-zinc-300 w-8 text-right">{Math.round(painting * 100)}%</span>
        </div>
      )}
      {/* (a map is a map without holes: only the pages made for a hole say there's none yet) */}
      {doc.holes.length === 0 && (preview === "sign" || preview === "page") && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="glass rounded-[18px] px-4 py-3 text-sm text-zinc-200">No holes yet: tee signs and hole pages show once there's a hole.</div></div>}
    </div>
  );
}

/** A phone's Map step: the printouts as chips on the top bar, each as wide as its short name. */
export function PageChips() {
  const tabId = useEditor(e => e.designTab);
  const tabs: [Preview | "general", string][] = [["general", "General"], ["map", "Map"], ["sign", "Sign"], ["page", "Page"], ["scorecard", "Card"]];
  // (short of room, Redo beside them or a narrow phone: they scroll, faded at the edge where more
  // are, the one picked kept in view)
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const look = () => setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const ro = new ResizeObserver(look);
    ro.observe(el);
    el.addEventListener("scroll", look, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", look); };
  }, []);
  useEffect(() => { row.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [tabId, edge.r]);
  const mask = edge.l || edge.r ? `linear-gradient(to right, ${edge.l ? "transparent, #000 18px" : "#000"}, ${edge.r ? "#000 calc(100% - 18px), transparent" : "#000"})` : undefined;
  return (
    <div ref={row} role="tablist" aria-label="Printouts" className="flex-1 min-w-0 flex bg-white/[0.07] rounded-xl p-0.5 overflow-x-auto dg-noscrollbar touch-pan-x" style={{ maskImage: mask, WebkitMaskImage: mask }} data-testid="page-chips">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tabId === id} onClick={() => useEditor.getState().set({ designTab: id })}
          className={`flex-auto shrink-0 min-w-[44px] h-11 px-1.5 rounded-[10px] text-[13.5px] font-bold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${tabId === id ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 active:bg-white/[0.09]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** A phone's page zoom, as the 3D map's slider between + and −: up to zoom in, down to zoom out, its
 * knob saying how far in; the page follows as it slides and is drawn sharp once let go. */
function PageZoomSlider({ t, height, onSlide, onDone, onStep }: { t: number; height: number; onSlide: (t: number) => void; onDone: (t: number) => void; onStep: (d: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const at = (y: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, 1 - (y - r.top - 11) / Math.max(1, r.height - 22)));
  };
  return (
    <div ref={track} role="slider" tabIndex={0} aria-label="Zoom" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t * 100)}
      className="relative w-11 shrink-0 touch-none cursor-ns-resize focus:outline-none focus-visible:bg-white/[0.13]" style={{ height }}
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); onSlide(at(e.clientY)); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onSlide(at(e.clientY)); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onDone(at(e.clientY)); }}
      onPointerCancel={e => onDone(at(e.clientY))}
      onKeyDown={e => {
        const by = e.key === "ArrowUp" ? 0.08 : e.key === "ArrowDown" ? -0.08 : 0;
        if (!by) return;
        e.preventDefault();
        e.stopPropagation();
        onStep(by);
      }}
      data-testid="zoom-slider">
      <span className="absolute left-1/2 -translate-x-1/2 top-[11px] bottom-[11px] w-1 rounded-full bg-white/20" aria-hidden />
      <span className="absolute left-1/2 -translate-x-1/2 w-1 rounded-full bg-white/60" style={{ top: 11 + (1 - t) * (height - 22), bottom: 11 }} aria-hidden />
      <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)]" style={{ top: 11 + (1 - t) * (height - 22) }} aria-hidden />
    </div>
  );
}
