// A fetched site looked over in the 3D view before it comes in: on a computer a glass card over
// the view, on a phone the one glass bar. The satellite photo lies under the model (a switch), the
// trees' colour can be picked (shown once, turning through the seasons, the first time), and what
// isn't wanted is left out at any size: a whole group, one source, one thing (pick it), or
// everything inside a box dragged on the view. It only decides what's in and what's out; changing
// a thing is Design's work, after.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Vector3 } from "three";
import { BoxSelect, Undo2 } from "lucide-react";
import { SOURCES, GROUPS, sourceOf, type LeftOut, type SourceGroup } from "../lib/importReview";
import { isImported, type ImportedSite } from "../lib/importSite";
import { COLOR_PICKS } from "../lib/landscapes";
import { getDoc, useCourse, useEditor } from "../state/course";
import { getView } from "../state/view";
import { select } from "../state/actions";
import { coach } from "./showSetting";
import { HelpLink, PickRow } from "./ui";
import { GlassBar, type BarSetting } from "./mobile/GlassBar";
import type { AreaItem, CourseItem } from "../types";
import { UG_BLOCK, brushLevels, type BrushTune, type Underbrush } from "../lib/undergrowth";
import { levelOf } from "../lib/areaBrush";
import { pointInPolygon } from "../lib/geom";

export type TreeLook3d = { trees: string; treeMix: string[] };
export type ReviewGroup = { id: SourceGroup; label: string; total: number; el: ReactNode };
/** The underbrush as found and as tuned (see lib/undergrowth). */
export type ReviewBrush = { u: Underbrush; on: boolean; tune: BrushTune; onTune: (t: BrushTune) => void; onSwitch: (on: boolean) => void };
const LEVELS = ["None", "Light", "Medium", "Heavy"], LEVEL_COLOR = ["#71717a", "#fde68a", "#f59e0b", "#b45309"];

/** The tree colours as dots (the leaves' own colours are too dark to tell apart that small). */
const DOT: Record<string, string> = { summer: "#4a7a3a", deep: "#2f5a3c", early: "#93923a", autumn: "#b5602a", late: "#6f7c3c" };
const SEEN_COLORS = "dg-review-colors-shown", SEEN_PHOTO = "dg-review-photo-hint", SEEN_TAP = "dg-review-tap-hint";
const seen = (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return true; } };
const markSeen = (k: string) => { try { localStorage.setItem(k, "1"); } catch { /* no storage */ } };

type Box = { x0: number; y0: number; x1: number; y1: number };

/** What of the site lies wholly inside a box on the screen (not what's left out already, and not
 * the underbrush, which has its own tuning). */
const insideBox = (site: ImportedSite, left: LeftOut[], r: Box): LeftOut => {
  const v: any = getView(), out: LeftOut = { ids: [], trees: [] };
  if (!v?.camera) return out;
  const cb = v.container.getBoundingClientRect(), W = v.doc.canvas.width, H = v.doc.canvas.height, p = new Vector3();
  const inside = (x: number, y: number) => {
    p.set(x, v.h(Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))) + 2, y).project(v.camera);
    if (p.z > 1) return false;
    const sx = cb.left + ((p.x + 1) / 2) * cb.width, sy = cb.top + ((1 - p.y) / 2) * cb.height;
    return sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1;
  };
  const gone = new Set(left.flatMap(l => l.ids)), cut = new Set(left.flatMap(l => l.trees));
  for (const i of [...site.mapped, ...site.trees]) {
    if (gone.has(i.id) || sourceOf(i) === "underbrush") continue;
    const pts = (i as { points?: { x: number; y: number }[] }).points;
    if (pts?.length ? pts.every(q => inside(q.x, q.y)) : "x" in i && inside((i as { x: number }).x, (i as { y: number }).y)) out.ids.push(i.id);
  }
  const lt = site.lidar?.trees ?? [];
  for (let k = 0; k < lt.length; k++) if (!cut.has(k) && inside(lt[k][0], lt[k][1])) out.trees.push(k);
  return out;
};

/** The measured tree under a click on the view, by its place in the survey's list (none of the
 * ones left out already, or too short to stand). */
const treeAt = (site: ImportedSite, left: LeftOut[], cx: number, cy: number, minH: number) => {
  const v: any = getView(), lt = site.lidar?.trees ?? [];
  if (!v?.camera || !lt.length) return null;
  const cb = v.container.getBoundingClientRect(), W = v.doc.canvas.width, H = v.doc.canvas.height, p = new Vector3();
  const scr = (x: number, y: number, z: number) => { p.set(x, y, z).project(v.camera); return p.z > 1 ? null : { x: cb.left + ((p.x + 1) / 2) * cb.width, y: cb.top + ((1 - p.y) / 2) * cb.height }; };
  const cut = new Set(left.flatMap(l => l.trees));
  let best: { k: number; sx: number; sy: number; h: number } | null = null, bd = Infinity;
  for (let k = 0; k < lt.length; k++) {
    const t = lt[k];
    if (cut.has(k) || t[2] < minH) continue;
    const g = v.h(Math.max(0, Math.min(W, t[0])), Math.max(0, Math.min(H, t[1])));
    const a = scr(t[0], g, t[1]);
    if (!a || Math.abs(a.x - cx) > 160 || Math.abs(a.y - cy) > 260) continue;
    const b = scr(t[0], g + t[2], t[1]), c = scr(t[0] + t[3], g + t[2] * 0.6, t[1]), m = scr(t[0], g + t[2] * 0.6, t[1]);
    if (!b || !m) continue;
    // (how near the click is to the tree, foot to top; within its crown's width)
    const dx = b.x - a.x, dy = b.y - a.y, u = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(cx - (a.x + u * dx), cy - (a.y + u * dy)), r = Math.max(10, c ? Math.hypot(c.x - m.x, c.y - m.y) : 10);
    if (d <= r && d < bd) { bd = d; best = { k, sx: m.x, sy: m.y, h: t[2] }; }
  }
  return best;
};

/** Underbrush painted on the view with a drag: the blocks under the stroke, handed over when it ends. */
function PaintLayer({ level, bx, by, onStroke, onDone }: { level: number; bx: number; by: number; onStroke: (blocks: number[]) => void; onDone: () => void }) {
  const v: any = getView(), cb: DOMRect | undefined = v?.container.getBoundingClientRect();
  const [dots, setDots] = useState<{ x: number; y: number; r: number }[]>([]);
  const [at, setAt] = useState<{ x: number; y: number; r: number } | null>(null);
  const hit = useRef(new Set<number>()), down = useRef(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDone(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onDone]);
  if (!cb || !v?.toPlan) return null;
  const R = 18;
  const add = (cx: number, cy: number) => {
    const q = v.toPlan(cx, cy) as { x: number; y: number } | null;
    if (!q) return;
    const q2 = v.toPlan(cx + 24, cy) as { x: number; y: number } | null;
    const r = q2 ? Math.max(8, Math.min(90, (24 * R) / Math.max(1, Math.hypot(q2.x - q.x, q2.y - q.y)))) : 20;
    setAt({ x: cx, y: cy, r });
    if (!down.current) return;
    for (let j = Math.max(0, Math.floor((q.y - R) / UG_BLOCK)); j <= Math.min(by - 1, Math.floor((q.y + R) / UG_BLOCK)); j++) for (let i = Math.max(0, Math.floor((q.x - R) / UG_BLOCK)); i <= Math.min(bx - 1, Math.floor((q.x + R) / UG_BLOCK)); i++)
      if (Math.hypot((i + 0.5) * UG_BLOCK - q.x, (j + 0.5) * UG_BLOCK - q.y) <= R) hit.current.add(j * bx + i);
    setDots(d => [...d, { x: cx, y: cy, r }]);
  };
  const end = () => { down.current = false; if (hit.current.size) onStroke([...hit.current]); hit.current = new Set(); setDots([]); };
  const c = LEVEL_COLOR[level];
  return (
    <div className="fixed z-[58] cursor-crosshair touch-none select-none overflow-hidden" style={{ left: cb.left, top: cb.top, width: cb.width, height: cb.height }} data-testid="review-paint"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); down.current = true; add(e.clientX, e.clientY); }}
      onPointerMove={e => add(e.clientX, e.clientY)} onPointerUp={end} onPointerCancel={end} onPointerLeave={() => setAt(null)}>
      {dots.map((d, k) => <div key={k} className="fixed rounded-full pointer-events-none" style={{ left: d.x - d.r, top: d.y - d.r, width: d.r * 2, height: d.r * 2, background: c, opacity: level ? 0.3 : 0.22 }} />)}
      {at && <div className="fixed rounded-full pointer-events-none border-2" style={{ left: at.x - at.r, top: at.y - at.r, width: at.r * 2, height: at.r * 2, borderColor: level ? c : "#fff", borderStyle: level ? "solid" : "dashed" }} />}
      <div className="absolute left-1/2 -translate-x-1/2 glass rounded-full pl-4 pr-1.5 py-1.5 text-[13px] font-semibold text-zinc-100 whitespace-nowrap flex items-center gap-3" style={{ top: Math.max(16, 144 - cb.top) > 100 ? 144 - cb.top : 16 }} onPointerDown={e => e.stopPropagation()}>
        <span className="pointer-events-none">{level ? `Drag to paint ${LEVELS[level].toLowerCase()} underbrush` : "Drag to erase underbrush"}</span>
        <button className="h-8 px-3 rounded-full bg-[#a2cf6a] text-zinc-950 font-bold" onClick={onDone} data-testid="review-paint-done">Done</button>
      </div>
    </div>
  );
}

/** A box dragged on the view. */
function AreaPick({ onBox, onCancel }: { onBox: (r: Box) => void; onCancel: () => void }) {
  const [r, setR] = useState<Box | null>(null);
  const v: any = getView(), cb: DOMRect | undefined = v?.container.getBoundingClientRect();
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCancel]);
  if (!cb) return null;
  const n = r && { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
  return (
    <div className="fixed z-[58] cursor-crosshair touch-none select-none" style={{ left: cb.left, top: cb.top, width: cb.width, height: cb.height }} data-testid="review-area"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setR({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }); }}
      onPointerMove={e => { if (r) setR({ ...r, x1: e.clientX, y1: e.clientY }); }}
      onPointerUp={() => { if (n && n.x1 - n.x0 > 10 && n.y1 - n.y0 > 10) onBox(n); setR(null); }}
      onPointerCancel={() => setR(null)}>
      {n && <div className="fixed rounded-[8px] border-2 border-white bg-white/[0.12] pointer-events-none" style={{ left: n.x0, top: n.y0, width: n.x1 - n.x0, height: n.y1 - n.y0 }} />}
      {!r && <div className="absolute left-1/2 -translate-x-1/2 top-4 glass rounded-full px-4 py-2 text-[13px] font-semibold text-zinc-100 pointer-events-none whitespace-nowrap">Drag a box over what you don't want</div>}
    </div>
  );
}

const Switch = ({ on, onClick, label, testid }: { on: boolean; onClick: () => void; label: string; testid?: string }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testid} onClick={onClick} className={`relative w-[30px] h-[17px] rounded-full shrink-0 ${on ? "bg-[#a2cf6a]" : "bg-white/[0.14]"}`}>
    <span className={`absolute top-[2px] w-[13px] h-[13px] rounded-full ${on ? "right-[2px] bg-zinc-900" : "left-[2px] bg-zinc-400"}`} />
  </button>
);

export function ImportReview3d({ phone, again, site0, left, onLeave, onUndo, look, onLook, groups, photoChoice, brush, notes = [], failed = [], onRetry, onBack, onBring, onFlat }: {
  phone: boolean; again: boolean;
  /** The site with what's switched on (before anything was left out by hand). */
  site0: ImportedSite;
  left: LeftOut[]; onLeave: (b: LeftOut) => void; onUndo: () => void;
  look: TreeLook3d | null; onLook: (l: TreeLook3d | null) => void;
  groups: ReviewGroup[]; photoChoice: ReactNode;
  brush?: ReviewBrush;
  /** What the import said about what it found, and the sources that didn't come. */
  notes?: string[]; failed?: string[]; onRetry?: () => void;
  onBack: () => void; onBring: () => void; onFlat: () => void;
}) {
  const photo = useEditor(s => s.photo), selectedId = useEditor(s => s.selectedId);
  const doc = useCourse(s => s.doc);
  const [area, setArea] = useState(false);
  const [turning, setTurning] = useState(false);
  const [tapHint, setTapHint] = useState(() => !seen(SEEN_TAP));
  const picked = (selectedId ? doc.items.find(i => i.id === selectedId) : null) as CourseItem | null | undefined;
  const pickedKey = picked && isImported(picked) ? sourceOf(picked) : null;
  const canLeave = !!picked && !!pickedKey && pickedKey !== "underbrush";
  const pickedName = pickedKey ? `${GROUPS.find(g => g.id === SOURCES[pickedKey].group)?.label ?? "Thing"}: ${SOURCES[pickedKey].label}` : "";
  const leftN = left.reduce((n, l) => n + l.ids.length + l.trees.length, 0);
  const said = useRef<string>("");
  // (every change made here, newest last: Undo takes back the last one, whatever it was)
  const hist = useRef<("left" | { tune: BrushTune; on: boolean })[]>(left.map(() => "left" as const));
  const leave = (b: LeftOut, what: string) => { if (!b.ids.length && !b.trees.length) { said.current = "Nothing lies wholly inside that box."; setNote(n => n + 1); return; } onLeave(b); hist.current.push("left"); said.current = `${what} left out`; setNote(n => n + 1); };
  const [, setNote] = useState(0);
  const brushRef = useRef(brush); brushRef.current = brush;
  const undo = () => {
    const h = hist.current.pop();
    if (!h) return;
    if (h === "left") { onUndo(); said.current = "Put back"; }
    else { const b = brushRef.current; if (b) { b.onTune(h.tune); if (b.on !== h.on) b.onSwitch(h.on); } said.current = "Underbrush put back"; }
    setNote(n => n + 1);
  };
  const undoRef = useRef(undo); undoRef.current = undo;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !(e.target as HTMLElement)?.closest?.("input,textarea")) { e.preventDefault(); undoRef.current(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const leavePicked = () => { if (!picked || !canLeave) return; leave({ ids: [picked.id], trees: [] }, "1 thing"); select(null); if (tapHint) { setTapHint(false); markSeen(SEEN_TAP); } };
  // Underbrush: tinted and outlined by its level in the view, so it's plain what is underbrush;
  // one patch (picked in the view, with every level inside it) or all of it given a level
  // (the patch: the one under the last click or tap in the view, the thickest there; trees stand
  // over underbrush, so a click picks the tree and the patch under it both)
  // (picking a patch is its own thing: while it's on, a click picks the patch there and no tree
  // or anything else; while it's off, a click picks things, and never a patch)
  const [mode, setModeState] = useState<"all" | "patch" | "paint">("all");
  const pickRef = useRef(false);
  const setMode = (m: "all" | "patch" | "paint") => { pickRef.current = m === "patch"; setModeState(m); if (m !== "patch") setTapAt(null); if (m !== "all") { select(null); setTreePick(null); } };
  const pickPatch = mode === "patch", paint = mode === "paint";
  const setPickPatch = (on: boolean) => setMode(on ? "patch" : "all");
  const [paintLevel, setPaintLevel] = useState(2);
  // (a measured tree under a click: they're a list of their own, so the view can't pick one itself)
  const [treePick, setTreePick] = useState<{ k: number; sx: number; sy: number; h: number } | null>(null);
  const siteRef = useRef(site0); siteRef.current = site0;
  const leftRef = useRef(left); leftRef.current = left;
  const [tapAt, setTapAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const v = getView() as { container?: HTMLElement; toPlan?: (x: number, y: number) => { x: number; y: number } | null } | null, el = v?.container;
    if (!el || !v?.toPlan) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; setTreePick(null); };
    const onUp = (e: PointerEvent) => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return; if (!pickRef.current) { setTreePick(treeAt(siteRef.current, leftRef.current, e.clientX, e.clientY, getDoc().lidar?.minHeight ?? 0)); return; } setTapAt(v.toPlan!(e.clientX, e.clientY)); window.setTimeout(() => select(null), 0); };
    el.addEventListener("pointerdown", onDown, true); el.addEventListener("pointerup", onUp, true);
    return () => { el.removeEventListener("pointerdown", onDown, true); el.removeEventListener("pointerup", onUp, true); };
  }, []);
  let patch: AreaItem | null = null;
  if (brush?.on && pickPatch && tapAt) for (const i of doc.items) {
    if (i.type !== "area" || i.kind !== "woods" || ((i as AreaItem).bushes ?? 0) < 1 || sourceOf(i) !== "underbrush") continue;
    if (pointInPolygon(tapAt, (i as AreaItem).points) && (!patch || levelOf(i as AreaItem) >= levelOf(patch))) patch = i as AreaItem;
  }
  const patchId = patch?.id ?? null;
  useEffect(() => {
    const v = getView() as { setBrushShown?: (on: boolean, picked?: string | null) => void } | null;
    v?.setBrushShown?.(!!brush?.on, patchId);
  }, [brush?.on, patchId]);
  useEffect(() => () => (getView() as { setBrushShown?: (on: boolean) => void } | null)?.setBrushShown?.(false), []);
  const whole = mode === "all";
  const found = brush ? brushLevels(brush.u, { ...brush.tune, put: undefined }) : null;
  const nowLv = brush ? brushLevels(brush.u, brush.tune) : null;
  let allLevel = -1;
  if (nowLv) { let seenLv = 0; for (const l of nowLv) { if (!l) continue; if (!seenLv) seenLv = l; else if (seenLv !== l) { seenLv = -1; break; } } allLevel = seenLv; }
  const brushLevel = paint ? paintLevel : !brush?.on ? 0 : whole ? allLevel : patch ? levelOf(patch) : -1;
  const setBrush = (level: number) => {
    if (paint) { setPaintLevel(level); return; }
    if (!brush || !found || (!whole && !patch)) return;
    hist.current.push({ tune: brush.tune, on: brush.on });
    if (whole) {
      if (level === 0) { brush.onSwitch(false); said.current = "Underbrush off"; }
      else { if (!brush.on) brush.onSwitch(true); brush.onTune({ ...brush.tune, set: undefined, put: undefined, all: level }); said.current = `All underbrush ${LEVELS[level].toLowerCase()}`; }
    } else {
      const pts = patch!.points, put = { ...(brush.tune.put ?? {}) };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      for (let j = Math.max(0, Math.floor(y0 / UG_BLOCK)); j <= Math.min(brush.u.by - 1, Math.floor(y1 / UG_BLOCK)); j++) for (let i = Math.max(0, Math.floor(x0 / UG_BLOCK)); i <= Math.min(brush.u.bx - 1, Math.floor(x1 / UG_BLOCK)); i++)
        if (pointInPolygon({ x: (i + 0.5) * UG_BLOCK, y: (j + 0.5) * UG_BLOCK }, pts)) put[j * brush.u.bx + i] = level;
      brush.onTune({ ...brush.tune, put });
      said.current = level ? `Patch ${LEVELS[level].toLowerCase()}` : "Patch removed";
      setTapAt(null);
    }
    setNote(n => n + 1);
  };
  const brushPicks = (id: string) => <div className="flex flex-col" role="radiogroup" aria-label="Underbrush level">{LEVELS.map((l, k) => <PickRow key={l} on={k === brushLevel} onClick={() => setBrush(k)} color={LEVEL_COLOR[k]} label={l} testid={`${id}-${l.toLowerCase()}`} />)}</div>;
  const painted = (blocks: number[]) => {
    if (!brush) return;
    hist.current.push({ tune: brush.tune, on: brush.on });
    const put = { ...(brush.tune.put ?? {}) };
    for (const q of blocks) put[q] = paintLevel;
    if (!brush.on && paintLevel) brush.onSwitch(true);
    brush.onTune({ ...brush.tune, put });
    said.current = paintLevel ? `Painted ${LEVELS[paintLevel].toLowerCase()} underbrush` : "Underbrush erased"; setNote(n => n + 1);
  };
  const paintEl = paint && brush && <PaintLayer level={paintLevel} bx={brush.u.bx} by={brush.u.by} onStroke={painted} onDone={() => setMode("all")} />;
  const treeRow = treePick && !picked && mode === "all" && !area ? treePick : null;
  const leaveTree = () => { if (!treeRow) return; leave({ ids: [], trees: [treeRow.k] }, "1 tree"); setTreePick(null); };
  const treeMark = treeRow && <div className="fixed z-[57] pointer-events-none rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,.35)]" style={{ left: treeRow.sx - 12, top: treeRow.sy - 12, width: 24, height: 24 }} data-testid="review-tree-mark" />;
  const boxed = (r: Box) => { setArea(false); const b = insideBox(site0, left, r), n = b.ids.length + b.trees.length; leave(b, `${n.toLocaleString()} ${n === 1 ? "thing" : "things"}`); };

  // The trees' colours, once through the first time anyone sees this (not with motion reduced),
  // then the photo's hint. A colour picked meanwhile ends it.
  const lookRef = useRef(onLook); lookRef.current = onLook;
  const stopTurn = useRef(false);
  useEffect(() => {
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hint = () => { if (seen(SEEN_PHOTO)) return; const el = document.querySelector<HTMLElement>('[data-testid="review-photo-on"]'); if (el) { coach(el, "The satellite photo is on so you can see where things go. Switch it off to see the model alone."); markSeen(SEEN_PHOTO); } };
    if (seen(SEEN_COLORS) || reduced) { const t = window.setTimeout(hint, 900); return () => window.clearTimeout(t); }
    const by = (id: string) => { const c = COLOR_PICKS.trees.find(x => x.id === id)!; return { trees: c.color, treeMix: (c as { mix?: string[] }).mix ?? [] }; };
    const steps: [number, TreeLook3d | null][] = [[900, by("early")], [2300, by("autumn")], [3700, null]];
    setTurning(true);
    const ts = steps.map(([at, l]) => window.setTimeout(() => { if (!stopTurn.current) lookRef.current(l); }, at));
    ts.push(window.setTimeout(() => { setTurning(false); markSeen(SEEN_COLORS); hint(); }, 4600));
    return () => ts.forEach(t => window.clearTimeout(t));
  }, []);
  const pickLook = (c: { id: string; color: string; mix?: string[] }) => { stopTurn.current = true; setTurning(false); onLook({ trees: c.color, treeMix: c.mix ?? [] }); };
  // (none picked: the course's own, summer unless it was given another)
  const leaf = look?.trees ?? doc.style.look3d?.trees;
  const lookId = (leaf && COLOR_PICKS.trees.find(c => c.color === leaf)?.id) || "summer";
  const lookLabel = COLOR_PICKS.trees.find(c => c.id === lookId)?.label ?? "Summer";
  const setPhoto = (on: boolean) => useEditor.getState().set({ photo: on });
  const note = said.current && (
    <div className="flex items-center gap-2 text-[12.5px] text-zinc-200" role="status" data-testid="review-said">
      <span className="truncate">{said.current}</span>
      {hist.current.length > 0 && <button className="ml-auto shrink-0 inline-flex items-center gap-1 text-[#a2cf6a] font-semibold" onClick={undo} data-testid="review-undo"><Undo2 size={13} />Undo</button>}
    </div>
  );
  const notesEl = notes.length > 0 && (
    <details className="text-[12px] text-zinc-400" data-testid="review-notes">
      <summary className="cursor-pointer text-zinc-300 hover:text-zinc-100 py-0.5">What the import found ({notes.length})</summary>
      <ul className="mt-1 flex flex-col gap-1 list-disc pl-4 leading-snug">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
    </details>
  );
  const areaEl = area && <AreaPick onBox={boxed} onCancel={() => setArea(false)} />;

  if (phone) {
    const navTop = document.querySelector('nav[aria-label="Steps"]')?.getBoundingClientRect().top ?? window.innerHeight - 76;
    const settings: BarSetting[] = [
      ...(brush?.on ? [(pickPatch && patch
        ? { id: "patch", name: "This patch", value: LEVELS[levelOf(patch)], control: <div className="flex flex-col">{brushPicks("review-patch")}<button className="text-left px-3 py-2.5 text-[14px] font-semibold text-[#a2cf6a]" onClick={() => setPickPatch(false)} data-testid="review-patch-stop">Done with patches</button></div>, testid: "review-patch" }
        : { id: "patch", name: "Underbrush patch", value: pickPatch ? "Tap one" : "Pick one", run: () => setPickPatch(!pickPatch), testid: "review-patch-pick" }) as BarSetting] : []),
      ...(brush ? [{ id: "brushall", name: "All underbrush", value: !brush.on ? "Off" : allLevel > 0 ? LEVELS[allLevel] : "Mixed", control: <div onPointerDownCapture={() => setPickPatch(false)}>{brushPicks("review-brush-all")}</div>, testid: "review-brush-all" } as BarSetting] : []),
      ...(treeRow ? [{ id: "leavetree", name: "Measured tree", value: "Leave out", run: leaveTree, testid: "review-leave-tree" } as BarSetting] : []),
      ...(canLeave ? [{ id: "leave", name: SOURCES[pickedKey!].label, value: "Leave out", run: leavePicked, testid: "review-leave" } as BarSetting] : []),
      ...(brush?.on ? [{ id: "paint", name: "Paint underbrush", value: paint ? LEVELS[paintLevel] : "Off", testid: "review-paint-on", control: <div className="flex flex-col" role="radiogroup" aria-label="Paint underbrush">{LEVELS.map((l, k) => <PickRow key={l} on={paint && k === paintLevel} onClick={() => { setPaintLevel(k); setMode("paint"); }} color={LEVEL_COLOR[k]} label={k ? l : "Erase"} testid={`review-paint-${l.toLowerCase()}`} />)}{paint && <button className="text-left px-3 py-2.5 text-[14px] font-semibold text-[#a2cf6a]" onClick={() => setMode("all")}>Stop painting</button>}</div> } as BarSetting] : []),
      { id: "photo", name: "Photo", value: photo ? "On" : "Off", run: () => setPhoto(!photo), on: photo, testid: "review-photo-on" },
      { id: "colors", name: "Tree colors", value: lookLabel, testid: "review-tree-colors", control: <div className="flex flex-col" role="radiogroup" aria-label="Tree colors">{COLOR_PICKS.trees.map(c => <PickRow key={c.id} on={c.id === lookId} onClick={() => pickLook(c)} color={DOT[c.id]} label={c.label} testid={`review-color-${c.id}`} />)}</div> },
      ...groups.map(g => ({ id: g.id, name: g.label, value: g.total.toLocaleString(), wide: true, control: <div className="max-h-[30dvh] overflow-y-auto">{g.el}</div> }) as BarSetting),
      { id: "area", name: "Leave out", value: "An area", run: () => setArea(true), testid: "review-area-on" },
      ...(hist.current.length > 0 ? [{ id: "undo", name: "Last change", value: "Undo", run: undo, testid: "review-undo" } as BarSetting] : [])
    ];
    const row = "w-full flex items-center gap-3 text-left rounded-[18px] px-3 min-h-[46px] py-2 text-zinc-100 active:bg-white/[0.1] text-[15px] font-semibold";
    const menu = (
      <div className="flex flex-col">
        {(failed.length > 0 || notes.length > 0) && <div className="px-3 pb-1 max-h-[26dvh] overflow-y-auto">{failed.length > 0 && <div className="text-[13px] text-orange-300 pb-1">{failed.join(", ")} didn't come.{onRetry && <> <button className="underline text-[#a2cf6a] font-semibold" onClick={onRetry} data-testid="review-retry">Try again</button></>}</div>}{notesEl}</div>}
        {photoChoice}
        <button className={row} onClick={onFlat} data-testid="review-flat">Look at it on the flat map</button>
        <button className={`${row} !text-orange-300`} onClick={onBack} data-testid="review-back">Back to the frame</button>
      </div>
    );
    return (
      <>
        {areaEl}{paintEl}{treeMark}
        <div className="dg-compact fixed inset-x-0 top-0 z-[60] pointer-events-none" style={{ bottom: Math.max(0, window.innerHeight - navTop) }}>
          {area && <button className="absolute right-3 top-[max(76px,env(safe-area-inset-top))] pointer-events-auto glass rounded-full h-11 px-4 text-[14px] font-semibold text-zinc-100" onClick={() => setArea(false)}>Cancel</button>}
          {!area && <GlassBar remember="import-review" testid="import-review" pill={{ name: "What comes in", small: leftN ? `${leftN.toLocaleString()} left out` : undefined, back: onBack }} pillMenu={menu} settings={settings} onDone={onBring} doneLabel={again ? "Bring it in again" : "Bring it in"} doneTestid="review-bring" />}
        </div>
      </>
    );
  }

  return (
    <>
      {areaEl}{paintEl}{treeMark}
      <div className="fixed left-4 top-[72px] z-[60] w-[336px] max-h-[calc(100%-96px)] overflow-y-auto glass rounded-[22px] p-4 flex flex-col gap-2 text-zinc-100" data-testid="import-review">
        <div>
          <div className="font-bold text-[15.5px] flex items-center gap-1.5">What comes in <HelpLink topic="import-options" label="What comes in" /></div>
          <div className="text-[12.5px] text-zinc-400">{failed.length ? <><span className="text-orange-300">{failed.join(", ")} didn't come.</span>{onRetry && <> <button className="underline text-[#a2cf6a] font-semibold" onClick={onRetry} data-testid="review-retry">Try again</button></>} The rest is in.</> : "Everything's in."} Switch off what you don't want, then bring it in.</div>
          {notesEl}
        </div>
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <span>Photo</span>
          <span className="ml-auto" />
          <Switch on={photo} onClick={() => setPhoto(!photo)} label="Satellite photo under the model" testid="review-photo-on" />
        </div>
        <div className="flex items-center gap-2 text-[12.5px] font-semibold">
          <span>Tree colors</span>
          <div className={`ml-auto flex items-center gap-[7px] px-1.5 py-1 rounded-full ${turning ? "ring-2 ring-[#a2cf6a]/60 motion-safe:animate-pulse" : ""}`} role="radiogroup" aria-label="Tree colors" data-testid="review-tree-colors">
            {COLOR_PICKS.trees.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={c.id === lookId} aria-label={c.label} title={c.label} onClick={() => pickLook(c)} data-testid={`review-color-${c.id}`}
                className={`w-[17px] h-[17px] rounded-full ${c.id === lookId ? "ring-2 ring-white ring-offset-2 ring-offset-[#1c2a1b]" : "hover:ring-2 hover:ring-white/40"}`} style={{ background: DOT[c.id] }} />
            ))}
          </div>
          <span className="w-[68px] text-right font-normal text-zinc-400 text-[12px]" data-testid="review-color-name">{lookLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className={`h-[30px] px-3 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 ${area ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.09] hover:bg-white/[0.14]"}`} onClick={() => setArea(a => !a)} aria-pressed={area} data-testid="review-area-on"><BoxSelect size={14} />Leave out an area</button>
          {leftN > 0 && <span className="ml-auto text-[12px] text-zinc-400 tabular-nums" data-testid="review-left">{leftN.toLocaleString()} left out</span>}
        </div>
        {brush && (
          <div className="rounded-[14px] bg-amber-400/[0.08] ring-1 ring-amber-400/25 px-3 py-2.5 flex flex-col gap-2 text-[12.5px]" data-testid="review-brush">
            <div className="flex items-center gap-2 font-semibold">
              <span>Underbrush</span>
              <span className="ml-auto flex items-center gap-2 font-normal text-[11.5px] text-zinc-400">{[1, 2, 3].map(l => <span key={l} className="inline-flex items-center gap-1"><span className="w-[9px] h-[9px] rounded-[2px]" style={{ background: LEVEL_COLOR[l] }} />{LEVELS[l]}</span>)}</span>
            </div>
            <div className="flex p-[3px] gap-[2px] rounded-[10px] bg-white/[0.07]" role="radiogroup" aria-label="Change">
              <button type="button" role="radio" aria-checked={pickPatch} onClick={() => setPickPatch(true)} data-testid="review-brush-this" className={`flex-1 py-1.5 rounded-[8px] ${pickPatch ? "bg-white/[0.16] text-zinc-50 font-semibold" : "text-zinc-300 hover:text-zinc-100"}`}>A patch</button>
              <button type="button" role="radio" aria-checked={paint} onClick={() => setMode("paint")} data-testid="review-brush-paint" className={`flex-1 py-1.5 rounded-[8px] ${paint ? "bg-white/[0.16] text-zinc-50 font-semibold" : "text-zinc-300 hover:text-zinc-100"}`}>Paint</button>
              <button type="button" role="radio" aria-checked={whole} onClick={() => setMode("all")} data-testid="review-brush-all" className={`flex-1 py-1.5 rounded-[8px] ${whole ? "bg-white/[0.16] text-zinc-50 font-semibold" : "text-zinc-300 hover:text-zinc-100"}`}>All</button>
            </div>
            <div className="flex p-[3px] gap-[2px] rounded-[10px] bg-white/[0.07]" role="radiogroup" aria-label="Underbrush level">
              {LEVELS.map((l, k) => <button key={l} type="button" role="radio" aria-checked={k === brushLevel} disabled={pickPatch && !patch} onClick={() => setBrush(k)} data-testid={`review-brush-${l.toLowerCase()}`} className={`flex-1 py-1.5 rounded-[8px] disabled:text-zinc-600 ${k === brushLevel ? "bg-amber-400 text-zinc-950 font-semibold" : "text-zinc-300 hover:text-zinc-100"}`}>{l}</button>)}
            </div>
            {brush.on && <div className="text-[11.5px] text-zinc-400">{paint ? "Pick a level, then drag in the view. None erases." : pickPatch ? (patch ? "Pick its level, or click another patch." : "Click inside an outline. Trees aren't picked while this is on.") : "Sets every outlined patch. A patch changes one; Paint adds or erases by hand."}</div>}
          </div>
        )}
        {treeRow && (
          <div className="rounded-[14px] bg-white/[0.07] px-3 py-2 flex items-center gap-2 text-[12.5px]" data-testid="review-picked-tree">
            <span className="truncate">Trees: Measured · {Math.round(treeRow.h)} ft tall</span>
            <button className="ml-auto shrink-0 h-[28px] px-3 rounded-full bg-white/[0.12] hover:bg-white/[0.18] font-semibold" onClick={leaveTree} data-testid="review-leave-tree">Leave out</button>
          </div>
        )}
        {canLeave ? (
          <div className="rounded-[14px] bg-white/[0.07] px-3 py-2 flex items-center gap-2 text-[12.5px]" data-testid="review-picked">
            <span className="truncate">{pickedName}</span>
            <button className="ml-auto shrink-0 h-[28px] px-3 rounded-full bg-white/[0.12] hover:bg-white/[0.18] font-semibold" onClick={leavePicked} data-testid="review-leave">Leave out</button>
          </div>
        ) : tapHint ? (
          <div className="rounded-[14px] bg-white/[0.05] px-3 py-2 flex items-start gap-2 text-[12px] text-zinc-300" data-testid="review-tap-hint">
            <span>Click anything in the view to see where it came from and leave just it out.</span>
            <button className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-200" aria-label="Close this tip" onClick={() => { setTapHint(false); markSeen(SEEN_TAP); }}>✕</button>
          </div>
        ) : null}
        {note}
        {photoChoice}
        {groups.map(g => g.el)}
        <button className="self-start text-[12px] text-zinc-400 hover:text-zinc-100 py-0.5" onClick={onFlat} data-testid="review-flat">Look at it on the flat map ›</button>
        <div className="flex gap-2 sticky -bottom-4 -mx-4 -mb-4 px-4 pb-4 pt-2.5 rounded-b-[22px] bg-[rgba(22,31,21,0.94)] backdrop-blur-md">
          <button className="h-11 px-4 rounded-[14px] bg-white/[0.1] hover:bg-white/[0.14] text-[14px] font-semibold text-zinc-200 backdrop-blur" onClick={onBack} data-testid="review-back">Back</button>
          <button className="flex-1 h-11 rounded-[14px] bg-[#a2cf6a] hover:bg-[#b3db80] active:bg-[#93c05c] text-zinc-950 text-[15px] font-bold" onClick={onBring} data-testid="review-bring">{again ? "Bring it in again" : "Bring it in"}</button>
        </div>
      </div>
    </>
  );
}
