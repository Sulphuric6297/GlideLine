// A hole's flyover settings on a computer, in the side panel's own parts (sections of fields,
// sliders, two-way switches and folds), the same in the hole's panel on the map and in tee view's
// Flyover panel, with the same labels, in the same order, as the phone's flyover bar (FlyoverBar):
// Camera path (Automatic or Custom, Edit camera path, and Edit on map when Custom), Camera
// (altitude, speed, field of view, where it starts) or the selected Keyframe (its altitude, field of
// view and time, Move camera; on the map Add keyframe and Play flyover too), Apply to, and On the
// video (Overlays).
import { ChevronLeft, ChevronRight, Clapperboard, Map as MapIcon, Play, Plus, Trash2, Video } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LENS, flyoverOf } from "../lib/flight";
import { holeLabel } from "../lib/course";
import { fmtDist } from "../lib/units";
import { changeDoc, updateHole, useCourse, useEditor } from "../state/course";
import { select } from "../state/actions";
import type { FlyKey, FlyoverSettings, FlyShow, Hole } from "../types";
import { getView } from "../state/view";
import { ApplyToHoles } from "./ApplyToHoles";
import { Button, HelpLink, Segmented, Slider, Toggle } from "./ui";
import { FlightLine, addKeyframe, addWhere, clock, retimeKeys, setCameraPath, useFlight } from "./FlyoverBar";

/** The flyover's overlays, in the order the switches are listed. */
export const FLY_SHOW: [FlyShow, string][] = [
  ["title", "Hole title at the start"],
  ["badge", "Hole number in the corner"],
  ["pinDistance", "Distance to the pin"],
  ["courseName", "Course name"],
  ["playLine", "Throw line"],
  ["circle", "Putting circle"],
  ["ob", "OB"],
  ["otherHoles", "Other holes"],
  ["walks", "Path to the next tee"]
];

/** A part folded away, its name and how many are in it. */
const Fold = ({ title, note, testid, children }: { title: string; note?: string; testid?: string; children: ReactNode }) => (
  <details className="rounded-[14px] bg-white/[0.06] group" data-testid={testid}>
    <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-3 py-2.5 text-[13px] font-medium text-zinc-100">
      {title}
      <span className="flex items-center gap-2 text-xs text-zinc-500">{note}<span className="group-open:rotate-90 transition-transform">›</span></span>
    </summary>
    <div className="px-3 pb-3">{children}</div>
  </details>
);

/** One group of the flyover's settings, under its small title (the panel's Section look). */
const Group = ({ title, help, children, testid }: { title: string; help?: string; children: ReactNode; testid?: string }) => (
  <div className="mt-4 first:mt-0" data-testid={testid}>
    <h4 className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5 mb-2">{title}{help && <HelpLink topic={help} label={title} />}</h4>
    {children}
  </div>
);

/** Edit camera path: the camera moved yourself, from keyframe `at` of a hole (null: from the tee). */
export const cameraFrom = (holeId: string, at: number | null) => useEditor.getState().set({ teeView: holeId, teeViewTee: null, flyover: false, flyCam: true, flyKey: at });

/** A hole's keyframes on the map, tilted into 3D: each camera at its height, to drag. */
export const keysIn3D = (holeId: string) => {
  const ed = useEditor.getState();
  ed.set({ teeView: null, flyover: false, flyCam: false, teeSettings: false, view: "3d", ...(ed.step !== "design" ? { step: "design" as const } : {}) });
  select(holeId);
  requestAnimationFrame(() => getView()?.fitHole(holeId));
};

/** Which flyover settings change: this hole's own, or the ones for all holes. They start on the
 * hole's own when it has some. */
const useScope = (hole: Hole) => useState<"hole" | "course">(hole.flyover ? "hole" : "course");
type Scope = "hole" | "course";

/** The overlays: a switch each, then Apply to holes… and Reset. */
function Overlays({ hole, scope }: { hole: Hole; scope: Scope }) {
  const doc = useCourse(s => s.doc);
  const forHole = scope === "hole";
  const f = flyoverOf(doc, forHole ? hole : undefined);
  // A switch: one undo step
  const showPart = (k: FlyShow, v: boolean) =>
    changeDoc(d => (forHole ? { holes: d.holes.map(h => (h.id === hole.id ? { ...h, flyover: { ...h.flyover, [k]: v } } : h)) } : { flyover: { ...d.flyover, [k]: v } }));
  const on = FLY_SHOW.filter(([k]) => f[k]).length;
  return (
    <Fold title="Overlays" note={`${on} of ${FLY_SHOW.length}`} testid="flyover-onscreen">
      <div className="flex flex-col mb-2" data-testid="flyover-show">
        {FLY_SHOW.map(([k, label]) => <Toggle key={k} label={label} checked={f[k]} onChange={v => showPart(k, v)} />)}
      </div>
      {/* (from a hole: its settings to the holes picked; for all holes: the picked holes follow them) */}
      <div className="flex flex-wrap items-start gap-2">
        <ApplyToHoles
          fromId={forHole ? hole.id : undefined}
          testid="flyover-apply"
          apply={ids => changeDoc(d => ({ holes: d.holes.map(h => (ids.includes(h.id) ? { ...h, flyover: forHole && hole.flyover ? { ...hole.flyover } : undefined } : h)) }))}
        />
        {/* (a hole's own back to the all-holes ones; those back to the app's own) */}
        {forHole
          ? <Button small onClick={() => updateHole(hole.id, { flyover: undefined })} disabled={!hole.flyover} testid="flyover-hole-reset">Reset</Button>
          : <Button small onClick={() => changeDoc(() => ({ flyover: undefined }))} disabled={!doc.flyover} testid="flyover-defaults">Reset</Button>}
      </div>
    </Fold>
  );
}

/** Camera path Automatic: the camera's altitude, speed and field of view (this hole's own or for all
 * holes), and where it starts, folded under them. */
function AutoFlight({ hole, scope }: { hole: Hole; scope: Scope }) {
  const doc = useCourse(s => s.doc);
  const forHole = scope === "hole";
  const f = flyoverOf(doc, forHole ? hole : undefined);
  const ft = (v: number) => fmtDist(v, doc.units);
  // (live while a slider moves; one undo step when it is let go)
  const set = (patch: Partial<FlyoverSettings>) =>
    forHole
      ? changeDoc(d => ({ holes: d.holes.map(h => (h.id === hole.id ? { ...h, flyover: { ...h.flyover, ...patch } } : h)) }), false)
      : changeDoc(d => ({ flyover: { ...d.flyover, ...patch } }), false);
  const done = () => useCourse.getState().commit();
  return (
    <Group title="Camera">
      <Slider label="Altitude" min={4} max={250} step={1} value={f.height} onChange={v => set({ height: v })} onDone={done} format={ft} />
      <Slider label="Speed" min={0.25} max={3} step={0.05} value={f.speed} onChange={v => set({ speed: v })} onDone={done} format={v => `${Math.round(v * 100) / 100}×`} />
      <Slider label="Field of view" min={LENS.min} max={LENS.max} value={f.fov} onChange={v => set({ fov: v })} onDone={done} format={v => `${Math.round(v)}°`} />
      <Fold title="Where it starts" note="3 settings" testid="flyover-start">
        <Slider label="Start offset" min={0} max={400} step={5} value={f.behind} onChange={v => set({ behind: v })} onDone={done} format={ft} />
        <Slider label="Side offset" min={-200} max={200} step={5} value={f.side} onChange={v => set({ side: v })} onDone={done} format={v => (v === 0 ? "Centered" : `${ft(Math.abs(v))} ${v > 0 ? "right" : "left"}`)} />
        <Slider label="Look ahead" min={30} max={500} step={10} value={f.lookAhead} onChange={v => set({ lookAhead: v })} onDone={done} format={ft} />
      </Fold>
    </Group>
  );
}

/** Camera path Custom: the selected keyframe (‹ › through them, Delete), its altitude, field of
 * view and time, and Move camera; none selected, the card says so. On the map (`timeline`) the
 * keyframes' timeline is here too, with Play flyover; in tee view it's in the bar over the view. */
function KeyFlight({ hole, keys, timeline }: { hole: Hole; keys: FlyKey[]; timeline: boolean }) {
  const doc = useCourse(s => s.doc);
  const pickedRaw = useEditor(e => e.flyKey);
  const setEd = useEditor(e => e.set);
  const { fs, times } = useFlight(hole);
  // (none selected: the timeline, and the card says so)
  const p = pickedRaw !== null ? Math.min(pickedRaw, keys.length - 1) : null;
  const k = p !== null ? keys[p] : null;
  const setKeys = (next: FlyKey[], history = true) => updateHole(hole.id, { flyKeys: next }, history);
  // (live while a slider moves; one undo step when it's let go)
  const edit = (patch: Partial<FlyKey>) => setKeys(keys.map((x, j) => (j === p ? { ...x, ...patch } : x)), false);
  const done = () => useCourse.getState().commit();
  // (a keyframe selected in tee view: the flyover held on its moment, see TeeViewHud)
  const pick = (i: number) => {
    const ed = useEditor.getState();
    setEd({ flyKey: Math.max(0, Math.min(keys.length - 1, i)), ...(ed.flyover && !ed.flyPaused ? { flyPaused: true } : {}) });
  };
  const add = () => addKeyframe(hole.id, addWhere(times, p, 0));
  const remove = () => {
    if (keys.length <= 2 || p === null) return;
    setKeys(keys.filter((_, j) => j !== p));
    setEd({ flyKey: Math.max(0, p - 1) });
  };
  // (a keyframe moved to time t: it and the one after share the time between their neighbours)
  const retime = (i: number, t: number, end: boolean) => {
    setKeys(retimeKeys(keys, times, i, t), false);
    if (end) done();
  };
  const play = () => setEd({ teeView: hole.id, flyover: true, flyCam: false, teeSettings: false });
  const step = "w-8 h-8 touch:w-11 touch:h-11 rounded-lg flex items-center justify-center text-zinc-300 hover:bg-white/[0.09] hover:text-zinc-50 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <Group title="Keyframe" help="flyover" testid="fly-keys">
      {timeline && <div className="mb-2"><FlightLine playing={false} onPlay={play} onPause={() => {}} length={times[times.length - 1]} at={p !== null ? times[p] : 0} keys={times} picked={p} onPick={pick} onRetime={retime} playId="fly-preview" /></div>}
      <div className={`flex items-center gap-0.5 rounded-[14px] bg-white/[0.06] p-1 ${k ? "mb-3" : ""}`} data-testid="fly-key-card">
        <button className={step} aria-label="Previous keyframe" title="Keyframe before ([)" disabled={p === 0} onClick={() => pick(p === null ? keys.length - 1 : p - 1)}><ChevronLeft size={17} /></button>
        {p !== null
          ? <span className="flex-1 text-center text-[13px] font-semibold text-zinc-100"><span data-testid="fly-key-title">Keyframe {p + 1}</span> <span className="font-normal text-zinc-400 tabular-nums">of {keys.length} · {clock(times[p] ?? 0, true)}</span></span>
          : <span className="flex-1 text-center text-[13px] text-zinc-400" data-testid="fly-key-title">No keyframe selected</span>}
        <button className={step} aria-label="Next keyframe" title="Keyframe after (])" disabled={p === keys.length - 1} onClick={() => pick(p === null ? 0 : p + 1)}><ChevronRight size={17} /></button>
        {p !== null && <button className={`${step} hover:!text-red-400`} aria-label={`Delete keyframe ${p + 1}`} title={keys.length <= 2 ? "A custom camera path needs two keyframes" : `Delete keyframe ${p + 1}`} disabled={keys.length <= 2} onClick={remove} data-testid="fly-key-delete"><Trash2 size={15} /></button>}
      </div>
      {k && p !== null && <>
        <Slider label="Altitude" min={2} max={Math.max(400, Math.round(k.alt))} value={Math.round(k.alt)} onChange={v => edit({ alt: v })} onDone={done} format={v => fmtDist(v, doc.units)} />
        <Slider label="Field of view" min={LENS.min} max={LENS.max} value={k.fov ?? fs.fov} onChange={v => edit({ fov: v })} onDone={done} format={v => `${Math.round(v)}°`} />
        {p > 0 && <Slider label="Time" min={Math.round((times[p - 1] + 0.5) * 10) / 10} max={Math.round((p + 1 < keys.length ? times[p + 1] - 0.5 : times[p] + 30) * 10) / 10} step={0.1} value={Math.round(times[p] * 10) / 10} onChange={v => retime(p, v, false)} onDone={done} format={v => clock(v, true)} />}
        <div className="mt-1"><Button full tone="primary" onClick={() => cameraFrom(hole.id, p)} testid="fly-move-camera" title={`Move keyframe ${p + 1}'s camera yourself`}><Video size={15} /> Move camera</Button></div>
      </>}
      {/* (in tee view, Add keyframe is in the bar beside the timeline) */}
      {timeline && <div className="grid grid-cols-2 gap-1.5 mt-1.5">
        <Button small onClick={add} testid="fly-key-add" title={p !== null ? `Add keyframe after keyframe ${p + 1}` : "Add keyframe after keyframe 1"}><Plus size={13} /> Add keyframe</Button>
        <Button small onClick={play} testid="fly-play-flyover"><Play size={13} /> Play flyover</Button>
      </div>}
    </Group>
  );
}

/** A hole's flyover settings: Camera path, Camera or Keyframe, Apply to, On the video. `inTee`: tee
 * view's Flyover panel (the timeline is in the bar over the view; Export video at the end). */
export function HoleFlight({ hole, inTee = false, exportVideo }: { hole: Hole; inTee?: boolean; exportVideo?: { label: string; run: () => void; busy?: string | null } }) {
  const doc = useCourse(s => s.doc);
  const [scope, setScope] = useScope(hole);
  const all = hole.flyKeys ?? [];
  const keys = all.length >= 2 ? all : null;
  return (
    <div data-testid="hole-flight">
      <div data-testid="flyover-settings">
        <Group title="Camera path" help="flyover">
          <Segmented label="Camera path" value={keys ? "custom" : "auto"} onChange={v => setCameraPath(hole, v === "custom")} options={[{ value: "auto", label: "Automatic", title: "The camera follows the hole by itself" }, { value: "custom", label: "Custom", title: "The camera flies through keyframes you set" }]} />
          {!keys && <div className="mt-2"><Button full small onClick={() => cameraFrom(hole.id, all.length ? all.length - 1 : null)} testid="fly-camera" title="Move the camera yourself and set keyframes"><Video size={14} /> Edit camera path</Button></div>}
          {/* (the whole path's: up here, not under one keyframe) */}
          {keys && <div className="flex flex-col gap-1.5 mt-2">
            <Button full small onClick={() => cameraFrom(hole.id, null)} testid="fly-camera" title="Move the camera yourself and set keyframes"><Video size={13} /> Edit camera path</Button>
            <Button full small onClick={() => keysIn3D(hole.id)} testid="fly-in-3d" title="On the map, tilted: drag each camera up, down or along"><MapIcon size={13} /> Edit on map</Button>
          </div>}
        </Group>
        {/* (a new hole, or keys gone: its own settings start again) */}
        {keys ? <KeyFlight key={hole.id} hole={hole} keys={keys} timeline={!inTee} /> : <AutoFlight key={hole.id} hole={hole} scope={scope} />}
        <Group title="Apply to">
          <Segmented label="Apply to" value={scope} onChange={setScope} options={[{ value: "course", label: "All holes" }, { value: "hole", label: "This hole", title: `Only hole ${holeLabel(doc, hole.id)}` }]} />
        </Group>
        <Group title="On the video"><Overlays hole={hole} scope={scope} /></Group>
        {exportVideo && <div className="mt-4"><Button full onClick={exportVideo.run} disabled={!!exportVideo.busy} testid="fly-export"><Clapperboard size={15} /> {exportVideo.busy ?? "Export video"}</Button><p className="mt-1 text-center text-[11.5px] text-zinc-500 tabular-nums">{exportVideo.label}</p></div>}
      </div>
    </div>
  );
}
