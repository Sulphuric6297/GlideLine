// The Flyover editor: the one place a hole's flyover is changed. The view is the camera, as the video
// shows it, moved by hand (the keyboard and a drag to look; on a phone a thumb stick and up and down
// buttons). One timeline along the foot: drag along it and the camera goes to that moment of the
// flight; a keyframe on it tapped, that keyframe; Add keyframe beside it puts the camera's shot in
// there (on an Automatic path, it turns Custom, from the path it flew by itself). The map from above
// in the corner, with the path and the keyframes to drag. With nothing selected, the settings are the
// whole flyover's (Camera path, the automatic camera or the keyframes, Apply to, Overlays, Export
// video); a keyframe selected, that keyframe's (Update keyframe once the camera has moved from it,
// Altitude, Field of view, Time, Delete). On a computer in the side panel, where a selected thing's
// panel goes; on a phone in the glass bar (mobile/GlassBar).
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, HelpCircle, RefreshCw, Trash2 } from "lucide-react";
import { useAllowed } from "../auth/perms";
import { holeLabel } from "../lib/course";
import { courseStats } from "../lib/holeStats";
import { LENS, flyoverOf, insertKeyAt, keyTimes } from "../lib/flight";
import { fmtDist } from "../lib/units";
import { VIDEO_SIZES } from "../lib/video";
import { getDoc, updateHole, useCourse, useEditor } from "../state/course";
import { useExportJob } from "../state/exportJob";
import { getView } from "../state/view";
import { toast } from "../state/toast";
import { recordVideo, useVideoSettings } from "../state/video";
import type { FlyKey, Hole } from "../types";
import { Button, HelpLink, Slider, askHelp } from "./ui";
import { ActRow, GlassBar, type BarSetting } from "./mobile/GlassBar";
import { Dial } from "./mobile/HoleStrip";
import { AddKeyframe, FlightLine, clock, keyAt, retimeKeys, useFlight, useFlyoverSettings } from "./FlyoverBar";
import { HoleFlight, editorFromMap } from "./FlyoverSettings";

/** The hole being edited and its keyframes, as they are now (a custom path: two or more). */
const now = () => {
  const ed = useEditor.getState();
  const hole = getDoc().holes.find(h => h.id === ed.teeView);
  const all = hole?.flyKeys ?? [];
  const keys = all.length >= 2 ? all : [];
  const at = ed.flyKey !== null && ed.flyKey < keys.length ? ed.flyKey : null;
  return { ed, hole, keys, at };
};

/** Where the camera is, as a keyframe, its lens too (each keyframe has its own). */
const keyHere = (hole: Hole): FlyKey | null => {
  const k = getView()?.freeKey();
  return k ? { ...k, fov: Math.round(k.fov ?? flyoverOf(getDoc(), hole).fov) } : null;
};

/** The playhead, seconds into the flight: where a keyframe added with none selected goes. */
let head = 0;
const ground = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;

/** The camera's shot added as a keyframe: after the one selected (halfway to the next), or at the
 * playhead. On an Automatic path, first its keyframes from the path it flies by itself (the shot at
 * its very start takes the first one's place). It's selected then. */
export const addKeyHere = () => {
  const { ed, hole, keys, at } = now();
  const k = hole ? keyHere(hole) : null;
  if (!hole || !k) return;
  const fs = flyoverOf(getDoc(), hole);
  const custom = keys.length >= 2;
  const base = custom ? keys : getView()?.autoKeys(hole.id) ?? null;
  if (!base || base.length < 2) return;
  const times = keyTimes(base, fs, ground);
  const on = at ?? keyAt(times, head);
  let r: { keys: FlyKey[]; at: number };
  if (!custom && head < 0.05) r = { keys: [{ ...k }, ...base.slice(1)], at: 0 };
  else if (on >= 0) {
    // (after it: the time to the next shared; past the last, a few seconds on)
    const t = on + 1 < times.length ? (times[on] + times[on + 1]) / 2 : times[on] + 3;
    r = on + 1 < times.length ? insertKeyAt(base, t, k, fs, ground) : { keys: [...base, { ...k, secs: 3 }], at: base.length };
  } else r = insertKeyAt(base, head, k, fs, ground);
  updateHole(hole.id, { flyKeys: r.keys });
  ed.set({ flyKey: r.at });
  if (!custom) toast("The camera path is Custom now, from the path it flew by itself.", "info", true);
};

/** The selected keyframe moved to where the camera is now (its time kept). */
const updateKeyHere = () => {
  const { hole, keys, at } = now();
  const k = hole ? keyHere(hole) : null;
  if (!hole || !k || at === null) return;
  updateHole(hole.id, { flyKeys: keys.map((o, j) => (j === at ? { ...k, ...(o.secs !== undefined ? { secs: o.secs } : {}) } : o)) });
};

/** The keyframe `d` on from the selected one (none selected: the first, or the last). */
const jump = (d: number) => {
  const { ed, keys, at } = now();
  if (!keys.length) return;
  ed.set({ flyKey: Math.max(0, Math.min(keys.length - 1, at === null ? (d > 0 ? 0 : keys.length - 1) : at + d)) });
};

/** Whether the selected keyframe can be deleted: a custom path keeps two at least. */
const removable = (count: number) => count > 2;
const REMOVE_NO = "A custom camera path needs two keyframes";

const removeKey = () => {
  const { ed, hole, keys, at } = now();
  if (!hole || at === null || !removable(keys.length)) return;
  updateHole(hole.id, { flyKeys: keys.filter((_, j) => j !== at) });
  ed.set({ flyKey: Math.max(0, at - 1) });
};

/** The keys that move the camera: forward, right and up for each. */
const MOVES: Record<string, [number, number, number]> = {
  w: [1, 0, 0], arrowup: [1, 0, 0], s: [-1, 0, 0], arrowdown: [-1, 0, 0],
  d: [0, 1, 0], arrowright: [0, 1, 0], a: [0, -1, 0], arrowleft: [0, -1, 0],
  e: [0, 0, 1], q: [0, 0, -1], c: [0, 0, -1]
};

/** Which way a keyframe looks (a unit vector), over the ground as the map has it. */
const facing = (k: FlyKey) => {
  const dx = k.lookX - k.x, dy = k.lookY - k.y, dz = ground(k.lookX, k.lookY) + (k.lookAlt ?? 3) - (ground(k.x, k.y) + k.alt);
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
};

/** Whether the camera (`cam`) is just where keyframe `k` puts it, looking the same way with the
 * same lens (nothing to update). The way it looks is compared, not the spot it looks at: the same
 * view can be aimed at a point nearer or farther along the same line. */
const same = (cam: FlyKey | null | undefined, k: FlyKey | null | undefined, lens: number) => {
  if (!cam || !k) return false;
  const a = facing(cam), b = facing(k);
  const turned = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * (180 / Math.PI);
  return Math.hypot(cam.x - k.x, cam.y - k.y) < 0.6 && Math.abs(cam.alt - k.alt) < 0.6 && turned < 0.6 && Math.round(cam.fov ?? lens) === Math.round(k.fov ?? lens);
};

/** A thumb stick: pushed, the camera moves that way (up is forward), faster the further. */
function Stick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const R = 42;
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const at = (ev: { clientX: number; clientY: number }) => {
      let dx = ev.clientX - cx, dy = ev.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      setKnob({ x: dx, y: dy });
      getView()?.freeMove({ f: -dy / R, s: dx / R });
    };
    at(e);
    const move = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) at(ev); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setKnob({ x: 0, y: 0 });
      getView()?.freeMove({ f: 0, s: 0 });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <div className="relative w-[104px] h-[104px] rounded-full glass border border-white/10 shadow-xl touch-none pointer-events-auto" onPointerDown={down} aria-label="Move the camera" role="application" data-testid="cam-stick">
      <div className="absolute left-1/2 top-1/2 w-[44px] h-[44px] -ml-[22px] -mt-[22px] rounded-full bg-white/[0.88] shadow-[0_3px_10px_rgba(0,0,0,.4)]" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** Held, the camera rises (1) or sinks (-1). */
function Lift({ dir }: { dir: 1 | -1 }) {
  const go = (on: boolean) => getView()?.freeMove({ u: on ? dir : 0 });
  return (
    <button
      className="w-[48px] h-[48px] rounded-[16px] glass border border-white/10 shadow-xl text-white flex items-center justify-center active:bg-white/25 touch-none pointer-events-auto"
      aria-label={dir > 0 ? "Up" : "Down"}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); go(true); }}
      onPointerUp={() => go(false)}
      onPointerCancel={() => go(false)}
      onContextMenu={e => e.preventDefault()}
      data-testid={dir > 0 ? "cam-up" : "cam-down"}
    >
      {dir > 0 ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
    </button>
  );
}

/** Over the corner map from above: the flight's path, the camera (a dot, and a line the way it
 * looks), and each keyframe, numbered as on the timeline. Click a keyframe to select it; drag it to
 * move it over the ground (where it looks moves with it, so its shot keeps its aim). */
function EditorMap({ hole, keys, at, onPick }: { hole: Hole; keys: FlyKey[]; at: number | null; onPick: (i: number) => void }) {
  type Drawn = { rect: { x: number; y: number; width: number; height: number }; path: string; keys: ({ x: number; y: number } | null)[]; cam: { x: number; y: number } | null; look: { x: number; y: number } | null };
  const [d, setD] = useState<Drawn | null>(null);
  const sig = JSON.stringify(keys);
  const path = useMemo(() => getView()?.flightPoints(hole.id) ?? [], [hole.id, sig, hole.flyover]); // eslint-disable-line react-hooks/exhaustive-deps
  const keysRef = useRef(keys);
  keysRef.current = keys;
  useEffect(() => {
    let raf = 0, last = "";
    const tick = () => {
      const v = getView(), m = v?.teeMini();
      if (v && m) {
        const pts = v.miniProject(path);
        const ks = v.miniProject(keysRef.current);
        const c = v.freeKey(), cl = c ? v.miniProject([{ x: c.x, y: c.y }, { x: c.lookX, y: c.lookY }]) : [null, null];
        const next: Drawn = { rect: m.rect, path: pts.filter(Boolean).map((q, i) => `${i ? "L" : "M"}${(q!.x - m.rect.x).toFixed(1)},${(q!.y - m.rect.y).toFixed(1)}`).join(""), keys: ks.map(q => (q ? { x: q.x - m.rect.x, y: q.y - m.rect.y } : null)), cam: cl[0] ? { x: cl[0].x - m.rect.x, y: cl[0].y - m.rect.y } : null, look: cl[1] ? { x: cl[1].x - m.rect.x, y: cl[1].y - m.rect.y } : null };
        const key = JSON.stringify(next);
        if (key !== last) { last = key; setD(next); }
      } else if (last) { last = ""; setD(null); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [path]);
  if (!d) return null;
  const r = d.rect;
  // (a keyframe taken hold of: a click selects it; a drag moves it, and where it looks, together)
  const down = (i: number) => (e: RPointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    onPick(i);
    const v = getView(), k0 = keysRef.current[i], g0 = v?.miniGround(e.clientX, e.clientY);
    if (!v || !k0 || !g0) return;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const g = v.miniGround(ev.clientX, ev.clientY);
      if (!g) return;
      const dx = g.x - g0.x, dy = g.y - g0.y;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      updateHole(hole.id, { flyKeys: keysRef.current.map((k, j) => (j === i ? { ...k0, x: r1(k0.x + dx), y: r1(k0.y + dy), lookX: r1(k0.lookX + dx), lookY: r1(k0.lookY + dy) } : k)) }, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved) { useCourse.getState().commit(); const k = now().keys[i]; if (k) getView()?.freeGo(k); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div className="absolute pointer-events-none rounded-2xl ring-1 ring-white/20 shadow-2xl overflow-hidden" style={{ left: r.x, top: r.y, width: r.width, height: r.height }} data-testid="fly-map">
      <svg className="absolute inset-0" width={r.width} height={r.height}>
        {d.path && <path d={d.path} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={4.5} strokeLinejoin="round" />}
        {d.path && <path d={d.path} fill="none" stroke="#fff" strokeWidth={2} strokeLinejoin="round" strokeDasharray={keys.length ? undefined : "5 4"} />}
        {d.cam && d.look && <line x1={d.cam.x} y1={d.cam.y} x2={d.cam.x + (d.look.x - d.cam.x) * 0.25} y2={d.cam.y + (d.look.y - d.cam.y) * 0.25} stroke="#fde047" strokeWidth={2.5} strokeLinecap="round" />}
        {d.cam && <circle cx={d.cam.x} cy={d.cam.y} r={5} fill="#fde047" stroke="#1c1917" strokeWidth={1.5} />}
      </svg>
      {d.keys.map((q, i) => q && (
        <button key={i} type="button" className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full font-extrabold flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,.5)] pointer-events-auto cursor-grab touch-none ${i === at ? "w-[24px] h-[24px] text-[12px] bg-orange-300 text-zinc-950 ring-[3px] ring-orange-300/30" : "w-[20px] h-[20px] text-[11px] bg-zinc-100 text-zinc-900"}`}
          style={{ left: q.x, top: q.y }} onPointerDown={down(i)} aria-label={`Keyframe ${i + 1}: drag to move it`} title={`Keyframe ${i + 1}: drag to move it`} data-testid="map-key">{i + 1}</button>
      ))}
      {/* (on a phone's small corner, the word alone: it'd cover the keyframes) */}
      <span className="absolute left-1.5 top-1.5 px-2 py-0.5 rounded-lg bg-black/60 text-[11px] text-zinc-100 pointer-events-none">From above{keys.length && r.width > 200 ? " · drag a keyframe" : ""}</span>
    </div>
  );
}

export function CameraHud({ compact = false }: { compact?: boolean }) {
  const doc = useCourse(s => s.doc);
  const ed = useEditor();
  const job = useExportJob(s => s.job);
  const video = useVideoSettings();
  const mayRecord = useAllowed("downloads");
  const hole = doc.holes.find(h => h.id === ed.teeView);
  // (a hole gone from under it meanwhile: nothing shows, below)
  const flight = useFlight(hole ?? ({ id: "" } as Hole));
  const keys = hole && flight.keys ? flight.keys : [];
  const times = keys.length ? flight.times : [];
  const at = ed.flyKey !== null && ed.flyKey < keys.length ? ed.flyKey : null;
  const [lens, setLens] = useState(60);
  const [alt, setAlt] = useState(0);
  const [moved, setMoved] = useState(false);
  const flying = ed.flyover;
  const [scrub, setScrub] = useState(0);
  const setHead = (t: number) => { head = t; setScrub(t); };
  // (opened, or another hole: the camera at its flight's start, or at the keyframe asked for)
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      const v = getView();
      const { hole, keys, at } = now();
      if (!v || !hole) return;
      v.freeCam(at !== null ? keys[at] : v.flightKeyAt(hole.id, 0));
      setHead(at !== null ? keyTimes(keys, flyoverOf(getDoc(), hole), ground)[at] ?? 0 : 0);
      setLens(v.freeLens());
    });
    return () => {
      cancelAnimationFrame(raf);
      getView()?.freeCam(false);
      raf = 0;
    };
  }, [ed.teeView]);
  // (a keyframe selected: the camera at its shot, the playhead at its moment)
  const atT = at !== null ? times[at] : null;
  useEffect(() => {
    if (at === null || atT === null) return;
    const k = now().keys[at];
    if (k && !useEditor.getState().flyover) getView()?.freeGo(k);
    setHead(atT);
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (atT !== null) setHead(atT); }, [atT]);
  // (how high it is and its lens, and whether it's been moved off the selected keyframe)
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = getView(), k = v?.freeKey();
      if (!k) return;
      setAlt(k.alt);
      setLens(k.fov ?? 60);
      const { keys, at, hole } = now();
      setMoved(at !== null && !!hole && !same(k, keys[at], flyoverOf(getDoc(), hole).fov));
    }, 150);
    return () => window.clearInterval(t);
  }, []);
  // The keyboard: held keys move it; Space plays and pauses; K (or Enter) adds a keyframe, U
  // updates the selected one, Delete deletes it, [ and ] go to the keyframe before or after; Esc
  // stops a flight, lets go of the keyframe, then leaves. (Ahead of the app's own keys while this
  // shows)
  const pauseRef = useRef<() => void>(() => {});
  useEffect(() => {
    const held = new Set<string>();
    let fast = false;
    const apply = () => {
      const m = [0, 0, 0];
      for (const k of held) MOVES[k].forEach((v, j) => (m[j] += v));
      getView()?.freeMove({ f: Math.sign(m[0]), s: Math.sign(m[1]), u: Math.sign(m[2]), fast });
    };
    // (typing, or a dial or a menu open: the keys are theirs, not the camera's)
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && !["range", "checkbox", "radio"].includes((t as HTMLInputElement).type)) || t.isContentEditable || t.getAttribute("role") === "slider" || !!t.closest?.('[role="dialog"]'));
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      fast = e.shiftKey;
      const s = useEditor.getState(), busy = s.flyover;
      if (k === "escape") {
        e.preventDefault(); e.stopPropagation();
        if (busy) s.set({ flyover: false });
        else if (s.flyKey !== null) s.set({ flyKey: null });
        else leave();
        return;
      }
      if (k === " ") { e.preventDefault(); e.stopPropagation(); if (!e.repeat) { if (busy) pauseRef.current(); else s.set({ flyover: true }); } return; }
      if (busy) return;
      if (MOVES[k]) { held.add(k); apply(); e.preventDefault(); e.stopPropagation(); return; }
      if (k === "shift") { apply(); return; }
      if (e.repeat) return;
      if (k === "enter" || k === "k") { e.preventDefault(); e.stopPropagation(); addKeyHere(); return; }
      if (k === "u") { e.preventDefault(); e.stopPropagation(); updateKeyHere(); return; }
      if (k === "delete" || k === "backspace") { e.preventDefault(); e.stopPropagation(); removeKey(); return; }
      if (k === "[" || k === "]") { e.preventDefault(); e.stopPropagation(); jump(k === "[" ? -1 : 1); }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      fast = e.shiftKey;
      if (MOVES[k]) { held.delete(k); e.preventDefault(); }
      apply();
    };
    const clear = () => { held.clear(); fast = false; apply(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);
  // (playing: the playhead from the view, as it flies)
  const [playAt, setPlayAt] = useState<number | null>(null);
  useEffect(() => {
    if (!flying) { setPlayAt(null); return; }
    let raf = 0, last = 0;
    const tick = (now: number) => { if (now - last > 90) { last = now; setPlayAt(getView()?.flyClock()?.t ?? 0); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flying]);
  // (a keyframe or a setting changed while it plays: its path made again, there)
  const sig = JSON.stringify([hole?.flyKeys, hole?.flyover, doc.flyover]);
  const firstSig = useRef(sig);
  useEffect(() => { if (sig !== firstSig.current) { firstSig.current = sig; if (useEditor.getState().flyover) getView()?.flyRefresh(); } }, [sig]);
  if (!hole) return null;
  const u = doc.units;
  const play = () => ed.set({ flyover: true });
  // Dragging the playhead: the camera where the flight is at that moment, looking where it looks;
  // onto a keyframe's moment, that keyframe selected; off them, none
  const scrubTo = (t: number) => {
    const near = times.findIndex(x => Math.abs(x - t) < Math.max(0.08, (flight.length ?? 10) / 200));
    if (near >= 0) { ed.set({ flyKey: near }); getView()?.freeGo(keys[near]); setHead(times[near]); return; }
    const k = getView()?.flightKeyAt(hole.id, t);
    if (k) getView()?.freeGo(k);
    ed.set({ flyKey: null });
    setHead(t);
  };
  // (paused: the flight stops where it is, and the camera stays at that moment)
  const pauseHere = () => {
    const t = getView()?.flyClock()?.t ?? 0;
    ed.set({ flyover: false });
    requestAnimationFrame(() => requestAnimationFrame(() => scrubTo(t)));
  };
  pauseRef.current = pauseHere;
  // (a keyframe dragged along the timeline: it and the one after share the time between them)
  const retime = (i: number, t: number, end: boolean) => {
    updateHole(hole.id, { flyKeys: retimeKeys(keys, times, i, t) }, false);
    if (end) useCourse.getState().commit();
  };
  const pick = (i: number) => { if (flying) pauseHere(); ed.set({ flyKey: i }); };
  // (the selected keyframe changed from its panel or bar: its shot shown as it changes)
  const editKey = (patch: Partial<FlyKey>) => {
    if (at === null) return;
    const next = keys.map((x, j) => (j === at ? { ...x, ...patch } : x));
    updateHole(hole.id, { flyKeys: next }, false);
    getView()?.freeGo(next[at]);
  };
  const commit = () => useCourse.getState().commit();
  const canRemove = removable(keys.length);
  // (the holes either side, as tee view goes to them)
  const stats = courseStats(doc);
  const holes = doc.holes.filter((_, i) => stats[i].complete);
  const hi = holes.findIndex(h => h.id === hole.id);
  const goHole = (d: number) => { const next = holes[(hi + d + holes.length) % holes.length]; if (next && next.id !== hole.id) ed.set({ teeView: next.id, flyKey: null, flyover: false }); };
  const many = holes.length > 1;
  // (Done: back where it was opened from, the map or tee view; standing on the hole's tee)
  const record = () => void recordVideo([hole.id]);
  const recPct = job?.kind === "video" && job.progress !== null ? `${Math.round(job.progress * 100)}%` : null;
  const exportVideo = mayRecord ? { label: `${VIDEO_SIZES[video.resolution].label}, ${video.fps} fps`, run: record, busy: job?.kind === "video" ? `Exporting ${recPct ?? "…"}` : job ? "Exporting…" : null } : undefined;
  const line = (bare: boolean) => (
    <FlightLine bare={bare} playing={flying} onPlay={play} onPause={pauseHere} length={flight.length}
      at={flying ? playAt : scrub} keys={times.length ? times : undefined} picked={at} onPick={pick} onRetime={retime} moved={moved}
      onScrub={flying ? t => { setPlayAt(t); getView()?.flySeek(t); } : scrubTo} playId="cam-play" />
  );
  const add = <AddKeyframe compact={compact} times={times} picked={at} at={scrub} onAdd={addKeyHere} testid="cam-add" />;
  const readout = <><span className="text-zinc-400">Altitude</span> <b className="text-zinc-50">{fmtDist(alt, u)}</b> <span className="text-zinc-500">·</span> <span className="text-zinc-400">Field of view</span> <b className="text-zinc-50">{Math.round(lens)}°</b>{moved && <span className="text-yellow-300"> · moved</span>}</>;
  const map = <EditorMap hole={hole} keys={keys} at={at} onPick={pick} />;
  const timeRange = at !== null && at > 0 ? { min: Math.round((times[at - 1] + 0.5) * 10) / 10, max: Math.round((at + 1 < keys.length ? times[at + 1] - 0.5 : times[at] + 30) * 10) / 10 } : null;

  // A computer: the side panel (the whole flyover's settings, or the selected keyframe's), the
  // camera's readout and keys over the view, the map from above, and the timeline along the foot
  if (!compact) {
    const head = "w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-50 hover:bg-white/[0.09] disabled:opacity-30";
    const k = at !== null ? keys[at] : null;
    return (
      <div className="absolute inset-0 pointer-events-none z-20" data-pov-ui data-testid="camera-hud">
        <aside className="absolute top-3 left-3 w-[300px] max-h-[calc(100%-24px)] flex flex-col glass rounded-[22px] shadow-xl shadow-black/40 z-20 pointer-events-auto" data-testid="cam-panel" aria-label="Flyover">
          <div className="flex items-center gap-0.5 px-2 pt-2">
            {k ? (
              <button className="h-8 pl-1 pr-2 rounded-lg flex items-center text-[13px] font-semibold text-orange-300 hover:bg-white/[0.07]" onClick={() => ed.set({ flyKey: null })} title="The whole flyover (Esc)" data-testid="key-back"><ChevronLeft size={16} /> Flyover</button>
            ) : (
              <>
                <button className={head} aria-label="Previous hole" title="Previous hole" disabled={!many} onClick={() => goHole(-1)}><ChevronLeft size={16} /></button>
                <button className={head} aria-label="Next hole" title="Next hole" disabled={!many} onClick={() => goHole(1)}><ChevronRight size={16} /></button>
                <span className="pl-1.5 text-[14px] font-bold text-zinc-50" data-testid="cam-title">Flyover · Hole {holeLabel(doc, hole.id)}</span>
                <HelpLink topic="flyover" label="Flyover" />
              </>
            )}
            <span className="flex-1" />
            <button className="h-8 px-3.5 rounded-full bg-orange-300 text-zinc-950 text-[12.5px] font-bold hover:bg-orange-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={leave} title="Done (Esc)" data-testid="cam-done">Done</button>
          </div>
          <div className="overflow-y-auto min-h-0 dg-scroll px-4 pb-4 pt-2">
            {k && at !== null ? (
              <div data-testid="fly-key-panel">
                <div className="flex items-center gap-0.5 rounded-[14px] bg-white/[0.06] p-1 mb-2.5" data-testid="cam-key">
                  <button className={head} aria-label="Keyframe before" title="Keyframe before ( [ )" disabled={at === 0} onClick={() => jump(-1)}><ChevronLeft size={16} /></button>
                  <span className="flex-1 text-center text-[13px] font-semibold text-zinc-100"><span data-testid="fly-key-title">Keyframe {at + 1}</span> <span className="font-normal text-zinc-400 tabular-nums">of {keys.length} · {clock(times[at] ?? 0, true)}</span></span>
                  <button className={head} aria-label="Keyframe after" title="Keyframe after ( ] )" disabled={at === keys.length - 1} onClick={() => jump(1)}><ChevronRight size={16} /></button>
                  <button className={`${head} hover:!text-red-400`} aria-label={`Delete keyframe ${at + 1}`} title={canRemove ? `Delete keyframe ${at + 1} (Delete)` : REMOVE_NO} disabled={!canRemove} onClick={removeKey} data-testid="cam-remove"><Trash2 size={15} /></button>
                </div>
                {moved && <div className="flex items-center gap-2 rounded-[12px] bg-yellow-300/[0.12] text-yellow-200 text-[12.5px] font-semibold px-2.5 py-2 mb-2" data-testid="cam-moved"><span className="w-2 h-2 rounded-full bg-yellow-300" />The camera moved from it</div>}
                <Button full tone="primary" onClick={updateKeyHere} disabled={!moved} testid="cam-update" title={moved ? `Keyframe ${at + 1} to the camera's shot (U)` : "The camera is on its shot"}><RefreshCw size={14} /> Update keyframe {at + 1}</Button>
                <h4 className="text-xs font-semibold text-zinc-400 mt-4 mb-2">Camera</h4>
                <Slider label="Altitude" min={2} max={Math.max(400, Math.round(k.alt))} value={Math.round(k.alt)} onChange={v => editKey({ alt: v })} onDone={commit} format={v => fmtDist(v, u)} />
                <Slider label="Field of view" min={LENS.min} max={LENS.max} value={Math.round(k.fov ?? flight.fs.fov)} onChange={v => editKey({ fov: v })} onDone={commit} format={v => `${Math.round(v)}°`} />
                {timeRange && <Slider label="Time" min={timeRange.min} max={timeRange.max} step={0.1} value={Math.round(times[at] * 10) / 10} onChange={v => retime(at, v, false)} onDone={commit} format={v => clock(v, true)} />}
              </div>
            ) : <HoleFlight key={hole.id} hole={hole} exportVideo={exportVideo} />}
          </div>
        </aside>
        {!flying && (
          // (between the panel and the map from above)
          <div className="absolute top-4 h-[38px] px-4 rounded-full glass border border-white/10 shadow-xl flex items-center gap-1.5 text-[13px] whitespace-nowrap tabular-nums max-w-[calc(100%-624px)] overflow-hidden" style={{ left: "calc(50% + 24px)", transform: "translateX(-50%)" }} data-testid="cam-readout">
            {readout}
            <span className="text-zinc-500 ml-2 truncate">Drag to look · <b className="text-zinc-300">W A S D</b> move · <b className="text-zinc-300">E Q</b> up, down</span>
          </div>
        )}
        {!flying && map}
        <div className="absolute pointer-events-auto glass rounded-full border border-white/10 shadow-2xl h-[56px] pl-2 pr-2 flex items-center gap-2" style={{ bottom: 16, left: 324, right: 16 }} data-testid="camera-bar">
          <div className="flex-1 min-w-0">{line(true)}</div>
          {!flying && add}
        </div>
      </div>
    );
  }

  // A phone: the glass bar (the whole flyover's settings, or the selected keyframe's), the stick and
  // the arrows over it, the map from above in the corner
  return <PhoneEditor hole={hole} keys={keys} at={at} times={times} timeRange={timeRange} moved={moved} flying={flying} readout={readout} line={line(false)} add={add} map={map}
    editKey={editKey} commit={commit} canRemove={canRemove} many={many} goHole={goHole} exportVideo={mayRecord ? record : undefined} />;
}

/** The camera put away: back where the editor was opened from (the map, or tee view, standing on the
 * hole's tee). */
const leave = () => useEditor.getState().set({ flyCam: false, flyover: false, teeStand: null, flyKey: null, ...(editorFromMap() ? { teeView: null } : {}) });

function PhoneEditor({ hole, keys, at, times, timeRange, moved, flying, readout, line, add, map, editKey, commit, canRemove, many, goHole, exportVideo }: {
  hole: Hole; keys: FlyKey[]; at: number | null; times: number[]; timeRange: { min: number; max: number } | null; moved: boolean; flying: boolean;
  readout: React.ReactNode; line: React.ReactNode; add: React.ReactNode; map: React.ReactNode;
  editKey: (patch: Partial<FlyKey>) => void; commit: () => void; canRemove: boolean; many: boolean; goHole: (d: number) => void; exportVideo?: () => void;
}) {
  const doc = useCourse(s => s.doc);
  const setEd = useEditor(e => e.set);
  const u = doc.units;
  const flyoverSettings = useFlyoverSettings(hole, { exportVideo });
  const k = at !== null ? keys[at] : null;
  const fs = flyoverOf(doc, hole);
  const keySettings: BarSetting[] = k && at !== null ? [
    { id: "altitude", name: "Altitude", value: fmtDist(Math.round(k.alt), u), wide: true, testid: "cam-altitude", control: <Dial label="Altitude" value={Math.round(k.alt)} min={2} max={Math.max(400, Math.round(k.alt))} step={1} format={v => fmtDist(v, u)} onChange={v => editKey({ alt: v })} onDone={commit} /> },
    { id: "fov", name: "Field of view", value: `${Math.round(k.fov ?? fs.fov)}°`, wide: true, testid: "cam-fov", control: <Dial label="Field of view" value={Math.round(k.fov ?? fs.fov)} min={LENS.min} max={LENS.max} step={1} format={v => `${Math.round(v)}°`} onChange={v => editKey({ fov: v })} onDone={commit} /> },
    ...(timeRange ? [{ id: "time", name: "Time", value: clock(times[at], true), wide: true, testid: "cam-time", control: <Dial label="Time" value={Math.round(times[at] * 10) / 10} min={timeRange.min} max={timeRange.max} step={0.1} format={v => clock(v, true)} onChange={v => { updateHole(hole.id, { flyKeys: retimeKeys(keys, times, at, v) }, false); }} onDone={commit} /> } as BarSetting] : []),
    { id: "delete", name: "", value: "Delete", icon: <Trash2 size={16} />, run: removeKey, disabled: !canRemove, testid: "cam-remove", title: canRemove ? `Delete keyframe ${at + 1}` : REMOVE_NO }
  ] : [];
  const pill = k && at !== null
    ? { name: `Keyframe ${at + 1}`, prev: () => jump(-1), next: () => jump(1), prevOff: at === 0, nextOff: at === keys.length - 1, prevLabel: "The keyframe before", nextLabel: "The keyframe after", testid: "cam-pill" }
    : { name: "Flyover", small: `Hole ${holeLabel(doc, hole.id)}`, prev: many ? () => goHole(-1) : undefined, next: many ? () => goHole(1) : undefined, testid: "cam-pill" };
  const pillMenu = (
    <div className="flex flex-col gap-0.5">
      <ActRow icon={<HelpCircle size={18} />} label="Flyover help" hint="The camera, keyframes and settings" onClick={() => askHelp("flyover")} testid="cam-help" />
    </div>
  );
  // (the camera moved off the selected keyframe: Update keyframe in Add keyframe's place)
  const beside = k && at !== null && moved ? (
    <button type="button" className="h-11 pl-1.5 pr-4 rounded-full bg-yellow-300 text-yellow-950 shadow-xl flex items-center gap-2 text-left active:bg-yellow-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={updateKeyHere} data-testid="cam-update">
      <span className="w-8 h-8 rounded-full bg-black/[0.14] flex items-center justify-center"><RefreshCw size={16} /></span>
      <span className="flex flex-col leading-tight"><span className="text-[14.5px] font-bold whitespace-nowrap">Update keyframe</span><span className="text-[11px] font-semibold opacity-70 whitespace-nowrap">to this shot</span></span>
    </button>
  ) : add;
  return (
    <div className="absolute inset-0 pointer-events-none z-20" data-pov-ui data-testid="camera-hud">
      {!flying && <div className="absolute left-2.5 top-[max(12px,env(safe-area-inset-top))] h-[34px] px-3.5 rounded-full glass border border-white/10 shadow-xl flex items-center gap-1 text-[12.5px] whitespace-nowrap tabular-nums" data-testid="cam-readout">{readout}</div>}
      {!flying && map}
      {!flying && <>
        <div className="absolute left-4 bottom-[calc(max(10px,env(safe-area-inset-bottom))+226px)]"><Stick /></div>
        <div className="absolute right-3.5 bottom-[calc(max(10px,env(safe-area-inset-bottom))+232px)] flex flex-col gap-2"><Lift dir={1} /><Lift dir={-1} /></div>
      </>}
      <GlassBar remember={k ? "fly-key" : "flyover-edit"} pill={pill} pillMenu={pillMenu} settings={k ? keySettings : flyoverSettings} line={line} lineAbove beside={flying ? undefined : beside} tucked={flying}
        onDone={k ? () => setEd({ flyKey: null }) : leave} doneLabel={k ? "Done with the keyframe" : "Done"} testid="camera-bar" />
    </div>
  );
}
