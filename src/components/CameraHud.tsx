// Edit camera path: the camera moved yourself, first person, to set a hole's keyframes, on the
// flyover's own glass bar (mobile/GlassBar): the timeline with the keyframes beside its name (tap one
// to go to it, drag along it to see the flight at that moment), and the row: Add keyframe, Update,
// Field of view, Altitude, Time, Delete; ✓ Done. Moved with the keyboard (on a phone, a thumb stick
// and up and down buttons), turned by dragging the view.
import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronUp, HelpCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { holeLabel } from "../lib/course";
import { LENS, flightAt, flyoverOf, insertKeyAt, keyFlight, keyTimes } from "../lib/flight";
import { fmtDist } from "../lib/units";
import { getDoc, updateHole, useCourse, useEditor } from "../state/course";
import { getView } from "../state/view";
import { toast } from "../state/toast";
import type { FlyKey, Hole } from "../types";
import { useExportJob } from "../state/exportJob";
import { askHelp } from "./ui";
import { ActRow, GlassBar, type BarSetting } from "./mobile/GlassBar";
import { Dial } from "./mobile/HoleStrip";
import { FlightLine, clock, retimeKeys } from "./FlyoverBar";

/** The hole being flown and its keyframes, as they are now. */
const now = () => {
  const ed = useEditor.getState();
  const hole = getDoc().holes.find(h => h.id === ed.teeView);
  const keys = hole?.flyKeys ?? [];
  const at = ed.flyKey !== null && ed.flyKey < keys.length ? ed.flyKey : null;
  return { ed, hole, keys, at };
};

/** Where the camera is, as a keyframe, its lens too (each keyframe has its own). */
const keyHere = (hole: Hole): FlyKey | null => {
  const k = getView()?.freeKey();
  return k ? { ...k, fov: Math.round(k.fov ?? flyoverOf(getDoc(), hole).fov) } : null;
};

/** Where the timeline was scrubbed to, seconds into the flight (null: not scrubbed, or since moved
 * to a keyframe): a keyframe added then goes in at that moment. */
let scrubbed: number | null = null;
const ground = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;

/** A keyframe where the camera is: at the moment the timeline was scrubbed to, or after the picked
 * one (or at the end); it's picked then. */
export const addKeyHere = () => {
  const { ed, hole, keys, at } = now();
  const k = hole ? keyHere(hole) : null;
  if (!hole || !k) return;
  if (scrubbed !== null && keys.length >= 2) {
    const r = insertKeyAt(keys, scrubbed, k, flyoverOf(getDoc(), hole), ground);
    updateHole(hole.id, { flyKeys: r.keys });
    ed.set({ flyKey: r.at });
    scrubbed = null;
    return;
  }
  const i = at !== null ? at + 1 : keys.length;
  updateHole(hole.id, { flyKeys: [...keys.slice(0, i), k, ...keys.slice(i)] });
  ed.set({ flyKey: i });
  if (keys.length === 0) toast("Keyframe 1 added.");
};

/** The picked keyframe moved to where the camera is now (its time kept). */
const updateKeyHere = () => {
  const { hole, keys, at } = now();
  const k = hole ? keyHere(hole) : null;
  if (!hole || !k || at === null) return;
  updateHole(hole.id, { flyKeys: keys.map((o, j) => (j === at ? { ...k, ...(o.secs !== undefined ? { secs: o.secs } : {}) } : o)) });
};

/** The camera put at the keyframe `d` on from the picked one. */
const jump = (d: number) => {
  const { ed, keys, at } = now();
  if (!keys.length) return;
  scrubbed = null;
  const i = Math.max(0, Math.min(keys.length - 1, at === null ? (d > 0 ? 0 : keys.length - 1) : at + d));
  getView()?.freeGo(keys[i]);
  ed.set({ flyKey: i });
};

/** Whether the selected keyframe can be deleted: not one of a custom path's last two (the hole would
 * quietly go back to Automatic; the Flyover settings have the same rule). */
const removable = (count: number) => count !== 2;
const REMOVE_NO = "A custom camera path needs two keyframes";

const removeKey = () => {
  const { ed, hole, keys, at } = now();
  if (!hole || at === null || !removable(keys.length)) return;
  const next = keys.filter((_, j) => j !== at);
  updateHole(hole.id, { flyKeys: next.length ? next : undefined });
  ed.set({ flyKey: next.length ? Math.max(0, at - 1) : null });
};

/** The keys that move the camera: forward, right and up for each. */
const MOVES: Record<string, [number, number, number]> = {
  w: [1, 0, 0], arrowup: [1, 0, 0], s: [-1, 0, 0], arrowdown: [-1, 0, 0],
  d: [0, 1, 0], arrowright: [0, 1, 0], a: [0, -1, 0], arrowleft: [0, -1, 0],
  e: [0, 0, 1], " ": [0, 0, 1], q: [0, 0, -1], c: [0, 0, -1]
};

/** Which way a keyframe looks (a unit vector), over the ground as the map has it. */
const facing = (k: FlyKey) => {
  const g = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;
  const dx = k.lookX - k.x, dy = k.lookY - k.y, dz = g(k.lookX, k.lookY) + (k.lookAlt ?? 3) - (g(k.x, k.y) + k.alt);
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
    <div className="relative w-[118px] h-[118px] rounded-full glass border border-white/10 shadow-xl touch-none pointer-events-auto" onPointerDown={down} aria-label="Move the camera" role="application" data-testid="cam-stick">
      <div className="absolute left-1/2 top-1/2 w-[48px] h-[48px] -ml-[24px] -mt-[24px] rounded-full bg-white/[0.88] shadow-[0_3px_10px_rgba(0,0,0,.4)]" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** Held, the camera rises (1) or sinks (-1). */
function Lift({ dir }: { dir: 1 | -1 }) {
  const go = (on: boolean) => getView()?.freeMove({ u: on ? dir : 0 });
  return (
    <button
      className="w-[52px] h-[52px] rounded-[18px] glass border border-white/10 shadow-xl text-white flex items-center justify-center active:bg-white/25 touch-none pointer-events-auto"
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

export function CameraHud({ compact = false }: { compact?: boolean }) {
  const doc = useCourse(s => s.doc);
  const ed = useEditor();
  const job = useExportJob(s => s.job);
  const hole = doc.holes.find(h => h.id === ed.teeView);
  const keys = hole?.flyKeys ?? [];
  const at = ed.flyKey !== null && ed.flyKey < keys.length ? ed.flyKey : null;
  const [lens, setLens] = useState(60);
  const [alt, setAlt] = useState(0);
  const [moved, setMoved] = useState(false);
  const flying = ed.flyover;
  // The flight as the keyframes make it, and each keyframe's moment in it (for the timeline)
  const set = hole ? flyoverOf(doc, hole) : null;
  const flight = useMemo(() => (set && keys.length >= 2 ? keyFlight(keys, set, ground) : null), [keys, set?.speed, set?.fov]); // eslint-disable-line react-hooks/exhaustive-deps
  const times = useMemo(() => (set && keys.length >= 2 ? keyTimes(keys, set, ground) : []), [keys, set?.speed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [scrub, setScrub] = useState<number | null>(null);
  // (picking a keyframe puts the timeline at its moment)
  useEffect(() => { if (at !== null && times[at] !== undefined) { setScrub(times[at]); scrubbed = null; } }, [at, times]);
  // (from the picked keyframe, or from the tee; back to the plain view when done)
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      const v = getView();
      const { keys, at } = now();
      v?.freeCam(at !== null ? keys[at] : null);
      if (v) setLens(v.freeLens());
    });
    return () => {
      cancelAnimationFrame(raf);
      getView()?.freeCam(false);
      raf = 0;
    };
  }, [ed.teeView]);
  // (how high it is and its lens, and whether it's been moved off the picked keyframe)
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = getView(), k = v?.freeKey();
      if (!k) return;
      setAlt(k.alt);
      setLens(k.fov ?? 60);
      const { keys, at, hole } = now();
      setMoved(at !== null && !same(k, keys[at], flyoverOf(getDoc(), hole).fov));
    }, 150);
    return () => window.clearInterval(t);
  }, []);
  // The keyboard: held keys move it; Enter adds, U updates, [ and ] go to the keyframe before or
  // after, Esc is done. (Ahead of the app's own keys while this shows)
  useEffect(() => {
    const held = new Set<string>();
    let fast = false;
    const apply = () => {
      const m = [0, 0, 0];
      for (const k of held) MOVES[k].forEach((v, j) => (m[j] += v));
      getView()?.freeMove({ f: Math.sign(m[0]), s: Math.sign(m[1]), u: Math.sign(m[2]), fast });
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      fast = e.shiftKey;
      const busy = useEditor.getState().flyover;
      if (k === "escape") { e.preventDefault(); e.stopPropagation(); if (busy) useEditor.getState().set({ flyover: false }); else useEditor.getState().set({ flyCam: false, flyover: false }); return; }
      if (busy) return;
      if (MOVES[k]) { held.add(k); apply(); e.preventDefault(); e.stopPropagation(); return; }
      if (k === "shift") { apply(); return; }
      if (e.repeat) return;
      if (k === "enter" || k === "k") { e.preventDefault(); e.stopPropagation(); addKeyHere(); return; }
      if (k === "u") { e.preventDefault(); e.stopPropagation(); updateKeyHere(); return; }
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
  if (!hole) return null;
  const u = doc.units;
  // (the camera put away, standing on the hole's tee again: Back from there goes to the map)
  const done = () => ed.set({ flyCam: false, flyover: false, teeStand: null });
  const play = () => ed.set({ flyover: true });
  const setLensTo = (v: number) => setLens(getView()?.freeLens(v) ?? v);
  const go = (i: number) => { getView()?.freeGo(keys[i]); ed.set({ flyKey: i }); scrubbed = null; };
  // Scrubbing: the camera where the flight is at that moment, looking where it looks; on a
  // keyframe's moment, that keyframe picked
  const scrubTo = (t: number) => {
    if (!flight) return;
    setScrub(t);
    const near = times.findIndex(x => Math.abs(x - t) < Math.max(0.08, flight.dur / 200));
    if (near >= 0) { getView()?.freeGo(keys[near]); ed.set({ flyKey: near }); scrubbed = null; return; }
    getView()?.freeGo(flightAt(flight, t, ground));
    ed.set({ flyKey: null });
    scrubbed = t;
  };
  const canRemove = removable(keys.length);
  // (paused: the flyover stops where it is, and the camera stays at that moment, to move from there
  // and add or update a keyframe, as Add keyframe after a drag along the timeline does)
  const pauseHere = () => {
    const t = getView()?.flyClock()?.t ?? 0;
    ed.set({ flyover: false });
    requestAnimationFrame(() => requestAnimationFrame(() => scrubTo(t)));
  };
  // (a keyframe dragged along the timeline: it and the one after share the time between them)
  const retime = (i: number, t: number, end: boolean) => {
    updateHole(hole.id, { flyKeys: retimeKeys(keys, times, i, t) }, false);
    if (end) useCourse.getState().commit();
  };
  const line = (
    <FlightLine playing={flying} canPlay={keys.length >= 2} onPlay={play} onPause={pauseHere} length={flight?.dur ?? null}
      at={flying ? playAt : flight ? scrub ?? 0 : null} keys={times.length ? times : undefined} picked={at} onPick={go} onRetime={retime} moved={moved}
      onScrub={flying ? t => { setPlayAt(t); getView()?.flySeek(t); } : flight ? scrubTo : undefined} short={compact} playId="cam-play" />
  );
  // (what Add keyframe does, said over it: after the selected one, at the moment scrubbed to, or the first)
  const addWhere = at !== null ? `After keyframe ${at + 1}` : scrubbed !== null && scrub !== null ? `At ${clock(scrub, true)}` : keys.length ? "At the end" : "The first";
  const settings: BarSetting[] = [
    { id: "add", name: addWhere, value: "Add keyframe", icon: <Plus size={16} />, run: addKeyHere, testid: "cam-add", title: "Add a keyframe where the camera is, looking where it looks (Enter)" }
  ];
  if (at !== null) settings.push({ id: "update", name: `Keyframe ${at + 1}`, value: "Update", icon: <RefreshCw size={16} />, run: updateKeyHere, disabled: !moved, testid: "cam-update", title: moved ? `Move keyframe ${at + 1} to where the camera is (U)` : "The camera hasn't moved from it" });
  settings.push(
    { id: "fov", name: "Field of view", value: `${Math.round(lens)}°`, wide: true, testid: "cam-fov", control: <Dial label="Field of view" value={Math.round(lens)} min={LENS.min} max={LENS.max} step={1} format={v => `${Math.round(v)}°`} onChange={setLensTo} onDone={() => {}} /> },
    { id: "altitude", name: "Altitude", value: fmtDist(alt, u), wide: true, testid: "cam-altitude", control: <Dial label="Altitude" value={Math.round(alt)} min={2} max={400} step={1} format={v => fmtDist(v, u)} onChange={v => { const k = getView()?.freeKey(); if (k) { getView()?.freeGo({ ...k, alt: v }); setAlt(v); } }} onDone={() => {}} /> }
  );
  if (at !== null && at > 0 && times.length) {
    const lo = times[at - 1] + 0.5, hi = at + 1 < keys.length ? times[at + 1] - 0.5 : times[at] + 30;
    settings.push({ id: "time", name: "Time", value: clock(times[at], true), wide: true, testid: "cam-time", control: <Dial label="Time" value={Math.round(times[at] * 10) / 10} min={Math.round(lo * 10) / 10} max={Math.round(hi * 10) / 10} step={0.1} format={v => clock(v, true)} onChange={v => retime(at, v, false)} onDone={() => useCourse.getState().commit()} /> });
  }
  if (at !== null) settings.push({ id: "delete", name: `Keyframe ${at + 1}`, value: "Delete", icon: <Trash2 size={16} />, run: removeKey, disabled: !canRemove, testid: "cam-remove", title: canRemove ? `Delete keyframe ${at + 1}` : REMOVE_NO });
  const readout = <><span className="text-zinc-400">Altitude</span> <b className="text-zinc-50">{fmtDist(alt, u)}</b> <span className="text-zinc-500">·</span> <span className="text-zinc-400">Field of view</span> <b className="text-zinc-50">{Math.round(lens)}°</b></>;
  // (on a phone, the name short: the timeline beside it needs the room)
  const pill = { name: "Camera path", small: compact ? undefined : `Hole ${holeLabel(doc, hole.id)}`, testid: "cam-pill" };
  const pillMenu = (
    <div className="flex flex-col gap-0.5">
      <ActRow icon={<HelpCircle size={18} />} label="Camera path help" hint="Moving the camera and setting keyframes" onClick={() => askHelp("fly-camera")} testid="cam-help" />
    </div>
  );
  const bar = (
    <GlassBar remember="camera" pill={pill} pillMenu={pillMenu} settings={settings} line={line} tucked={flying} onDone={done} doneLabel="Done (Esc)"
      center={compact ? undefined : 1010} testid="camera-bar" />
  );
  return (
    <div className="absolute inset-0 pointer-events-none z-20" data-pov-ui data-testid="camera-hud">
      {!flying && <div className={`absolute left-1/2 -translate-x-1/2 ${compact ? "top-[max(12px,env(safe-area-inset-top))]" : "top-4"} h-[38px] px-4 rounded-full glass border border-white/10 shadow-xl flex items-center gap-1.5 text-[13.5px] whitespace-nowrap tabular-nums`} data-testid="cam-readout">{readout}</div>}
      {compact && !flying && <>
        {!job && <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(max(10px,env(safe-area-inset-bottom))+300px)] w-max max-w-[calc(100%-24px)] text-center text-[13px] font-semibold text-white/90 bg-black/45 rounded-full px-3.5 py-1.5" data-testid="cam-hint">Drag to look around</div>}
        <div className="absolute left-4 bottom-[calc(max(10px,env(safe-area-inset-bottom))+156px)] flex flex-col items-center gap-1"><Stick /><span className="text-[11.5px] font-bold text-white/80 pointer-events-none">Move</span></div>
        <div className="absolute right-4 bottom-[calc(max(10px,env(safe-area-inset-bottom))+168px)] flex flex-col gap-2"><Lift dir={1} /><Lift dir={-1} /></div>
      </>}
      {!compact && !flying && <div className="absolute left-1/2 -translate-x-1/2 bottom-[150px] text-[12.5px] text-zinc-200 bg-black/45 rounded-xl px-3.5 py-1.5 whitespace-nowrap" data-testid="cam-hint"><Key k="W" /><Key k="A" /><Key k="S" /><Key k="D" /> move · <Key k="E" /> up · <Key k="Q" /> down · <Key k="Shift" /> faster · drag to look · scroll to change field of view</div>}
      {bar}
    </div>
  );
}

/** A key, as the hint shows it. */
const Key = ({ k }: { k: string }) => <b className="inline-block min-w-[20px] px-1.5 mx-px rounded-md bg-white/[0.16] text-center font-bold text-white">{k}</b>;

