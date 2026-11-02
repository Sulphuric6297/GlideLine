// The flyover's parts for the glass bar (mobile/GlassBar), the same in tee view, while it plays, in
// Edit camera path and from a hole's bar on the map, on a phone and a computer: the timeline beside
// the hole's name (Play flyover; playing, the playhead and Stop; a custom camera path's keyframes on
// it), every flyover setting for the bar's row, and Tap mode (Walk or Select) over the bar.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Clapperboard, Footprints, Map as MapIcon, MousePointer2, Pause, Play, Plus, Trash2, Video } from "lucide-react";
import { LENS, flyoverOf, insertKey, keyTimes } from "../lib/flight";
import { fmtDist } from "../lib/units";
import { changeDoc, updateHole, useCourse, useEditor } from "../state/course";
import { getView } from "../state/view";
import { toast } from "../state/toast";
import { VIDEO_SIZES } from "../lib/video";
import { useVideoSettings } from "../state/video";
import type { FlyKey, FlyShow, FlyoverSettings, Hole } from "../types";
import { ApplyToHoles } from "./ApplyToHoles";
import { cameraFrom, FLY_SHOW, keysIn3D } from "./FlyoverSettings";
import { Rows, Dial } from "./mobile/HoleStrip";
import type { BarSetting } from "./mobile/GlassBar";
import { Button, Toggle } from "./ui";

/** A moment of a flyover as its timeline reads: 0:04, or 0:03.2 for a keyframe's own time. */
export const clock = (t: number, tenths = false) => {
  const m = Math.floor(t / 60), sec = t - m * 60;
  return `${m}:${tenths ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0")}`;
};

/** The flyover's timeline, beside the hole's name: ▶ Play flyover and how long it is; playing, or
 * with keyframes, ▶ or ❚❚ Pause at its start, the line with its keyframes (tap one to select it;
 * drag one to change when it happens), the playhead (drag along the line to go to that moment) and
 * the time. `playing`: a flyover under way, `paused` or not. */
export function FlightLine({ playing, paused = false, canPlay = true, onPlay, onPause, length, at = null, keys, picked = null, onPick, onRetime, onScrub, moved = false, short = false, bare = false, playId = "hud-flyover" }: {
  playing: boolean; paused?: boolean; canPlay?: boolean; onPlay: () => void; onPause: () => void;
  /** How long it plays (s), if known. */
  length: number | null;
  /** The playhead (s), or none. */
  at?: number | null;
  /** Each keyframe's time (s): a custom camera path's. */
  keys?: number[];
  picked?: number | null;
  onPick?: (i: number) => void;
  onRetime?: (i: number, t: number, end: boolean) => void;
  onScrub?: (t: number) => void;
  /** The camera moved since the selected keyframe (a dot on it). */
  moved?: boolean;
  /** Room for the keyframes on a phone: the playhead's time alone, not "of" how long. */
  short?: boolean;
  /** Inside a bar of its own (a computer's): no glass of its own. */
  bare?: boolean;
  playId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dur = Math.max(0.1, length ?? (keys?.length ? keys[keys.length - 1] : 0));
  const running = playing && !paused;
  const go = (
    <button type="button" className="shrink-0 w-8 h-8 rounded-full bg-orange-300 text-zinc-950 flex items-center justify-center active:bg-orange-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      aria-label={running ? "Pause" : playing ? "Play" : "Play flyover"} title={running ? "Pause (Space)" : canPlay ? "Play (Space)" : "Add a second keyframe to play it"} disabled={!playing && !canPlay}
      onClick={running ? onPause : onPlay} data-testid={playId}>
      {running ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
    </button>
  );
  const box = bare ? "h-10 rounded-full flex items-center gap-2.5 pl-1 pr-2" : "h-11 rounded-full glass border border-white/10 shadow-xl flex items-center gap-2.5 pl-1.5 pr-3.5";
  const time = <span className="shrink-0 text-[12.5px] font-semibold text-zinc-300 tabular-nums whitespace-nowrap" data-testid="fly-time">{playing || at !== null ? (short ? clock(at ?? 0) : `${clock(at ?? 0)} / ${clock(dur)}`) : clock(dur)}</span>;
  // (standing, flying by itself: just Play flyover; the whole of it plays)
  if (!playing && !keys?.length) return (
    <button type="button" className={`${box} w-full text-left active:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`} onClick={onPlay} title="Play flyover (Space)" data-testid={playId}>
      <span className="shrink-0 w-8 h-8 rounded-full bg-orange-300 text-zinc-950 flex items-center justify-center"><Play size={14} fill="currentColor" className="ml-0.5" /></span>
      <span className="flex-1 min-w-0 text-[15px] font-bold text-zinc-50 truncate">Play flyover</span>
      {length !== null && time}
    </button>
  );
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`;
  // A keyframe dragged along the line: when it happens (not the first; never past its neighbours)
  const down = (i: number) => (e: RPointerEvent) => {
    e.stopPropagation();
    onPick?.(i);
    const el = ref.current;
    if (!i || !el || !keys || !onRetime) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const lo = keys[i - 1] + 0.5, hi = i + 1 < keys.length ? keys[i + 1] - 0.5 : keys[i] + 30;
    const tAt = (x: number) => Math.round(Math.min(hi, Math.max(lo, ((x - r.left) / r.width) * dur)) * 10) / 10;
    let t = keys[i];
    const move = (ev: PointerEvent) => { t = tAt(ev.clientX); onRetime(i, t, false); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onRetime(i, t, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div className={box} data-testid="fly-line">
      {go}
      <div ref={ref} className="relative flex-1 min-w-0 h-8 mx-2.5">
        <div className="absolute inset-x-0 top-1/2 -mt-0.5 h-1 rounded-full bg-white/[0.16]" />
        {at !== null && <div className="absolute left-0 top-1/2 -mt-0.5 h-1 rounded-full bg-orange-300" style={{ width: pct(at) }} />}
        {/* (dragged along: the playhead goes there; under the keyframes, which take their own taps) */}
        {onScrub && <input type="range" aria-label="Timeline" min={0} max={dur} step={0.05} value={at ?? 0} onChange={e => onScrub(Number(e.target.value))}
          className="absolute -inset-x-2.5 inset-y-0 w-[calc(100%+20px)] h-full opacity-0 cursor-pointer touch-none" data-testid="fly-scrub" />}
        {at !== null && <div className="absolute top-0.5 bottom-0.5 w-[3px] -ml-[1.5px] rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,.5)] pointer-events-none" style={{ left: pct(at) }} data-testid="fly-head" />}
        {keys?.map((t, i) => {
          const on = i === picked;
          return (
            <button key={i} type="button" className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full font-extrabold flex items-center justify-center shadow-[0_1px_4px_rgba(0,0,0,.45)] touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "z-[3] w-[26px] h-[26px] text-[12.5px] bg-orange-300 text-zinc-950 ring-[3px] ring-orange-300/30" : "z-[2] w-[22px] h-[22px] text-[11.5px] bg-zinc-100 text-zinc-900"} ${i ? "cursor-ew-resize" : ""}`}
              style={{ left: pct(t) }} onPointerDown={down(i)}
              onKeyDown={e => {
                // (the arrows: a tenth of a second sooner or later)
                if (!i || !keys || !onRetime || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                e.preventDefault();
                const lo = keys[i - 1] + 0.5, hi = i + 1 < keys.length ? keys[i + 1] - 0.5 : t + 30;
                onRetime(i, Math.round(Math.min(hi, Math.max(lo, t + (e.key === "ArrowLeft" ? -0.1 : 0.1))) * 10) / 10, true);
              }}
              aria-label={`Keyframe ${i + 1}, at ${clock(t, true)}`} aria-pressed={on} title={i ? `Keyframe ${i + 1} at ${clock(t, true)}: drag to change when it happens` : "Keyframe 1: the start"} data-testid="fly-key">
              {i + 1}
              {on && moved && <span className="absolute -top-1 -right-1 w-[9px] h-[9px] rounded-full bg-yellow-300 ring-2 ring-zinc-900" aria-hidden />}
            </button>
          );
        })}
      </div>
      {time}
    </div>
  );
}

/** Which flyover settings change: this hole's own, or the ones for all holes (starting on the hole's
 * own when it has some). */
export const useApplyTo = (hole: Hole) => useState<"hole" | "course">(hole.flyover ? "hole" : "course");

/** A hole's flyover as it is: its keyframes (a custom camera path, two or more), how long it plays,
 * and each keyframe's time. */
export function useFlight(hole: Hole) {
  const doc = useCourse(s => s.doc);
  const keys = (hole.flyKeys?.length ?? 0) >= 2 ? hole.flyKeys! : null;
  const fs = flyoverOf(doc, hole);
  const ground = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;
  const times = keys ? keyTimes(keys, fs, ground) : [];
  // (how long it plays: the view works it out from the hole and its settings, as it'll fly)
  const sig = JSON.stringify([hole.flyKeys, hole.flyover, doc.flyover, doc.items.length, hole.doglegs]);
  const [length, setLength] = useState<number | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setLength(getView()?.flyLength(hole.id) ?? null), 60);
    return () => window.clearTimeout(t);
  }, [sig, hole.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { keys, times, length: keys ? times[times.length - 1] : length, fs };
}

/** A custom camera path's keyframe moved to time `t`: it and the one after share the time between
 * their neighbours. */
export const retimeKeys = (keys: FlyKey[], times: number[], i: number, t: number): FlyKey[] => {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return keys.map((k, j) => (j === i ? { ...k, secs: r1(t - times[i - 1]) } : j === i + 1 ? { ...k, secs: r1(times[i + 1] - t) } : k));
};

/** Camera path: Automatic (keyframes deleted, said so, with Undo) or Custom (keyframes from the
 * flight it flies by itself, the first selected). */
export function setCameraPath(hole: Hole, custom: boolean) {
  const has = (hole.flyKeys?.length ?? 0) >= 2;
  if (custom === has) return;
  if (custom) {
    const start = getView()?.autoKeys(hole.id);
    if (start) { updateHole(hole.id, { flyKeys: start }); useEditor.getState().set({ flyKey: 0 }); }
    return;
  }
  updateHole(hole.id, { flyKeys: undefined });
  toast("Keyframes deleted. The camera path is Automatic again.", "info", true);
}

/** Every flyover setting a hole has, for the glass bar's row, the everyday ones first: the camera
 * path, then (Automatic) its altitude, speed and field of view, who they apply to, where it starts
 * and Overlays; or (Custom) the selected keyframe's, and the keyframes' own actions. `exportVideo`
 * (tee view) adds Export video at the end. */
export function useFlyoverSettings(hole: Hole, { exportVideo }: { exportVideo?: () => void } = {}): BarSetting[] {
  const doc = useCourse(s => s.doc);
  const pickedRaw = useEditor(e => e.flyKey);
  const setEd = useEditor(e => e.set);
  const video = useVideoSettings();
  const [scope, setScope] = useApplyTo(hole);
  const forHole = scope === "hole";
  const f = flyoverOf(doc, forHole ? hole : undefined);
  const ft = (v: number) => fmtDist(v, doc.units);
  const { keys, times, fs } = useFlight(hole);
  // (live while a dial turns; one undo step when it's let go)
  const set = (patch: Partial<FlyoverSettings>) =>
    forHole
      ? changeDoc(d => ({ holes: d.holes.map(h => (h.id === hole.id ? { ...h, flyover: { ...h.flyover, ...patch } } : h)) }), false)
      : changeDoc(d => ({ flyover: { ...d.flyover, ...patch } }), false);
  const done = () => useCourse.getState().commit();
  const dial = (id: string, name: string, value: string, d: Parameters<typeof Dial>[0]): BarSetting => ({ id, name, value, wide: true, control: <Dial {...d} /> });
  const out: BarSetting[] = [];
  out.push({ id: "path", name: "Camera path", value: keys ? "Custom" : "Automatic", testid: "fly-path", control: (
    <Rows value={keys ? "custom" : "auto"} onChange={v => setCameraPath(hole, v === "custom")} options={[
      { value: "auto", label: "Automatic", hint: "The camera follows the hole by itself" },
      { value: "custom", label: "Custom", hint: "The camera flies through keyframes you set" }
    ]} />
  ) });
  const applyTo: BarSetting = { id: "apply", name: "Apply to", value: forHole ? "This hole" : "All holes", testid: "fly-apply", control: (
    <Rows value={scope} onChange={setScope} options={[
      { value: "course", label: "All holes", hint: "Every hole's flyover, unless a hole has its own" },
      { value: "hole", label: "This hole", hint: "Only this hole's flyover" }
    ]} />
  ) };
  if (!keys) {
    out.push(
      dial("altitude", "Altitude", ft(f.height), { label: "Altitude", value: f.height, min: 4, max: 250, step: 1, format: ft, onChange: v => set({ height: v }), onDone: done }),
      dial("speed", "Speed", `${Math.round(f.speed * 100) / 100}×`, { label: "Speed", value: f.speed, min: 0.25, max: 3, step: 0.05, format: v => `${Math.round(v * 100) / 100}×`, onChange: v => set({ speed: v }), onDone: done }),
      dial("fov", "Field of view", `${Math.round(f.fov)}°`, { label: "Field of view", value: f.fov, min: LENS.min, max: LENS.max, step: 1, format: v => `${Math.round(v)}°`, onChange: v => set({ fov: v }), onDone: done }),
      applyTo,
      dial("start", "Start offset", ft(f.behind), { label: "Start offset", value: f.behind, min: 0, max: 400, step: 5, format: ft, onChange: v => set({ behind: v }), onDone: done }),
      dial("side", "Side offset", f.side === 0 ? "Centered" : `${ft(Math.abs(f.side))} ${f.side > 0 ? "right" : "left"}`, { label: "Side offset", value: f.side, min: -200, max: 200, step: 5, format: v => (v === 0 ? "Centered" : `${ft(Math.abs(v))} ${v > 0 ? "right" : "left"}`), onChange: v => set({ side: v }), onDone: done }),
      dial("look", "Look ahead", ft(f.lookAhead), { label: "Look ahead", value: f.lookAhead, min: 30, max: 500, step: 10, format: ft, onChange: v => set({ lookAhead: v }), onDone: done })
    );
  } else {
    const p = pickedRaw !== null ? Math.min(pickedRaw, keys.length - 1) : 0;
    const k = keys[p];
    const setKeys = (next: FlyKey[], history = true) => updateHole(hole.id, { flyKeys: next }, history);
    const edit = (patch: Partial<FlyKey>) => setKeys(keys.map((x, j) => (j === p ? { ...x, ...patch } : x)), false);
    const ground = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;
    out.push(
      { id: "key", name: "Keyframe", value: `${p + 1} of ${keys.length}`, testid: "fly-keyframe", control: (
        <Rows value={p} onChange={i => setEd({ flyKey: i })} options={keys.map((_, i) => ({ value: i, label: `Keyframe ${i + 1}`, hint: clock(times[i], true) }))} />
      ) },
      dial("altitude", "Altitude", ft(Math.round(k.alt)), { label: "Altitude", value: Math.round(k.alt), min: 2, max: Math.max(400, Math.round(k.alt)), step: 1, format: ft, onChange: v => edit({ alt: v }), onDone: done }),
      dial("fov", "Field of view", `${Math.round(k.fov ?? fs.fov)}°`, { label: "Field of view", value: Math.round(k.fov ?? fs.fov), min: LENS.min, max: LENS.max, step: 1, format: v => `${Math.round(v)}°`, onChange: v => edit({ fov: v }), onDone: done })
    );
    if (p > 0) {
      const lo = times[p - 1] + 0.5, hi = p + 1 < keys.length ? times[p + 1] - 0.5 : times[p] + 30;
      out.push(dial("time", "Time", clock(times[p], true), { label: "Time", value: Math.round(times[p] * 10) / 10, min: Math.round(lo * 10) / 10, max: Math.round(hi * 10) / 10, step: 0.1, format: v => clock(v, true), onChange: v => setKeys(retimeKeys(keys, times, p, v), false), onDone: done }));
    }
    out.push(
      { id: "edit", name: `From keyframe ${p + 1}`, value: "Edit camera path", icon: <Video size={16} />, run: () => cameraFrom(hole.id, p), testid: "fly-camera", title: "Move the camera yourself and set keyframes" },
      { id: "add", name: `After keyframe ${p + 1}`, value: "Add keyframe", icon: <Plus size={16} />, run: () => { const r = insertKey(keys, p === keys.length - 1 ? p - 1 : p, fs, ground); setKeys(r.keys); setEd({ flyKey: r.at }); }, testid: "fly-key-add" },
      { id: "onmap", name: "Drag keyframes", value: "Edit on map", icon: <MapIcon size={16} />, run: () => keysIn3D(hole.id), testid: "fly-in-3d", title: "On the map, tilted: drag each camera up, down or along" },
      { id: "delete", name: `Keyframe ${p + 1}`, value: "Delete", icon: <Trash2 size={16} />, disabled: keys.length <= 2, title: keys.length <= 2 ? "A custom camera path needs two keyframes" : undefined, run: () => { setKeys(keys.filter((_, j) => j !== p)); setEd({ flyKey: Math.max(0, p - 1) }); }, testid: "fly-key-delete" },
      // (no Speed: a custom path's timeline seconds are the flyover's own; Apply to for its overlays)
      applyTo
    );
  }
  out.push({ id: "overlays", name: "Overlays", value: `${FLY_SHOW.filter(([s]) => f[s]).length} of ${FLY_SHOW.length}`, testid: "fly-overlays", control: <Overlays hole={hole} forHole={forHole} /> });
  if (!keys) out.push({ id: "edit", name: "Set keyframes", value: "Edit camera path", icon: <Video size={16} />, run: () => cameraFrom(hole.id, (hole.flyKeys?.length ?? 0) ? hole.flyKeys!.length - 1 : null), testid: "fly-camera", title: "Move the camera yourself and set keyframes" });
  if (exportVideo) out.push({ id: "export", name: `${VIDEO_SIZES[video.resolution].label} · ${video.fps} fps`, value: "Export video", icon: <Clapperboard size={16} />, run: exportVideo, testid: "fly-export" });
  return out;
}

/** What's drawn on the flyover: a switch each, then Apply to holes… and Reset. */
function Overlays({ hole, forHole }: { hole: Hole; forHole: boolean }) {
  const doc = useCourse(s => s.doc);
  const f = flyoverOf(doc, forHole ? hole : undefined);
  // (a switch: one undo step)
  const show = (k: FlyShow, v: boolean) =>
    changeDoc(d => (forHole ? { holes: d.holes.map(h => (h.id === hole.id ? { ...h, flyover: { ...h.flyover, [k]: v } } : h)) } : { flyover: { ...d.flyover, [k]: v } }));
  return (
    <div className="px-2.5 pb-1.5" data-testid="flyover-show">
      <div className="flex flex-col">{FLY_SHOW.map(([k, label]) => <Toggle key={k} label={label} checked={f[k]} onChange={v => show(k, v)} />)}</div>
      <div className="flex flex-wrap items-start gap-2 mt-2">
        <ApplyToHoles fromId={forHole ? hole.id : undefined} testid="flyover-apply"
          apply={ids => changeDoc(d => ({ holes: d.holes.map(h => (ids.includes(h.id) ? { ...h, flyover: forHole && hole.flyover ? { ...hole.flyover } : undefined } : h)) }))} />
        {forHole
          ? <Button small onClick={() => updateHole(hole.id, { flyover: undefined })} disabled={!hole.flyover} testid="flyover-hole-reset">Reset</Button>
          : <Button small onClick={() => changeDoc(() => ({ flyover: undefined }))} disabled={!doc.flyover} testid="flyover-defaults">Reset</Button>}
      </div>
    </div>
  );
}

/** Tap mode, for someone who can edit, standing at a tee: what a tap on the view does, walk there
 * or select the thing tapped (never both: a tap meant to change something doesn't walk, and a step
 * doesn't pick what's in the way). At the bottom right just over the bar, in reach of a thumb. */
export function TapModes({ bottom, right = 10 }: { bottom: number; right?: number }) {
  const set = useEditor(e => e.set);
  const mode = useEditor(e => e.standTap ?? "walk");
  const b = (on: boolean) => `w-full h-[52px] rounded-2xl flex flex-col items-center justify-center gap-[3px] text-[10.5px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 active:bg-white/15 hover:bg-white/10"}`;
  return (
    <div className="absolute z-[33] pointer-events-auto w-12 p-1 flex flex-col gap-[3px] rounded-[20px] glass border border-white/10 shadow-xl" style={{ bottom, right }} role="radiogroup" aria-label="Tap mode" data-testid="tap-switch">
      <button type="button" role="radio" aria-checked={mode === "walk"} className={b(mode === "walk")} onClick={() => set({ standTap: "walk" })} title="Tap mode: Walk. A tap walks you there" data-testid="tap-walk"><Footprints size={18} />Walk</button>
      <button type="button" role="radio" aria-checked={mode === "edit"} className={b(mode === "edit")} onClick={() => set({ standTap: "edit" })} title="Tap mode: Select. A tap selects what's there, to change it" data-testid="tap-edit"><MousePointer2 size={18} />Select</button>
    </div>
  );
}
