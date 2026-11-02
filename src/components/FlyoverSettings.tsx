// A hole's Flyover section in its panel on a computer, with the same labels, in the same order, as
// the flyover's bar (FlyoverBar): Camera path, Automatic (altitude, speed, field of view, where it
// starts) or Custom (the timeline and its keyframes, the selected one's altitude, field of view and
// time, Edit camera path, Edit on map); Apply to; and Overlays.
import { ChevronLeft, ChevronRight, Map as MapIcon, Play, Plus, Trash2, Video } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LENS, flyoverOf, insertKey } from "../lib/flight";
import { holeLabel } from "../lib/course";
import { fmtDist } from "../lib/units";
import { changeDoc, updateHole, useCourse, useEditor } from "../state/course";
import { select } from "../state/actions";
import type { FlyKey, FlyoverSettings, FlyShow, Hole } from "../types";
import { getView } from "../state/view";
import { ApplyToHoles } from "./ApplyToHoles";
import { Button, Field, Segmented, Slider, Toggle } from "./ui";
import { FlightLine, clock, retimeKeys, setCameraPath, useFlight } from "./FlyoverBar";

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

/** A part folded away, its name and a few words on what's in it. */
const Fold = ({ title, note, testid, children }: { title: string; note?: string; testid?: string; children: ReactNode }) => (
  <details className="mt-3 rounded-[14px] bg-white/[0.06] group" data-testid={testid}>
    <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-2.5 py-2 text-[13px] font-medium text-zinc-100">
      {title}
      <span className="flex items-center gap-2 text-xs text-zinc-500">{note}<span className="group-open:rotate-90 transition-transform">›</span></span>
    </summary>
    <div className="px-2.5 pb-2.5">{children}</div>
  </details>
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
const APPLY_TO = (doc: { holes: Hole[] }, hole: Hole) => [{ value: "course" as const, label: "All holes" }, { value: "hole" as const, label: "This hole", title: `Only hole ${holeLabel(doc as never, hole.id)}` }];

/** The overlays: a switch each, for all holes or this hole (`scope`; its choice here unless `chosen`
 * says it's chosen above), Apply to holes and Reset. */
function OnScreen({ hole, scope, setScope, chosen = false }: { hole: Hole; scope: "hole" | "course"; setScope: (v: "hole" | "course") => void; chosen?: boolean }) {
  const doc = useCourse(s => s.doc);
  const forHole = scope === "hole";
  const f = flyoverOf(doc, forHole ? hole : undefined);
  // A switch: one undo step
  const showPart = (k: FlyShow, v: boolean) =>
    changeDoc(d => (forHole ? { holes: d.holes.map(h => (h.id === hole.id ? { ...h, flyover: { ...h.flyover, [k]: v } } : h)) } : { flyover: { ...d.flyover, [k]: v } }));
  const on = FLY_SHOW.filter(([k]) => f[k]).length;
  return (
    <Fold title="Overlays" note={`${on} of ${FLY_SHOW.length}`} testid="flyover-onscreen">
      {!chosen && <Field label="Apply to"><Segmented label="Apply to" value={scope} onChange={setScope} options={APPLY_TO(doc, hole)} /></Field>}
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

/** Camera path Automatic: altitude, speed and field of view (this hole's own or for all holes),
 * where it starts folded under them, and Edit camera path to set keyframes yourself. */
function AutoFlight({ hole }: { hole: Hole }) {
  const doc = useCourse(s => s.doc);
  const [scope, setScope] = useScope(hole);
  const forHole = scope === "hole";
  const f = flyoverOf(doc, forHole ? hole : undefined);
  const ft = (v: number) => fmtDist(v, doc.units);
  // (live while a slider moves; one undo step when it is let go)
  const set = (patch: Partial<FlyoverSettings>) =>
    forHole
      ? changeDoc(d => ({ holes: d.holes.map(h => (h.id === hole.id ? { ...h, flyover: { ...h.flyover, ...patch } } : h)) }), false)
      : changeDoc(d => ({ flyover: { ...d.flyover, ...patch } }), false);
  const done = () => useCourse.getState().commit();
  const all = hole.flyKeys ?? [];
  return (
    <div className="mt-3">
      <Field label="Apply to"><Segmented label="Apply to" value={scope} onChange={setScope} options={APPLY_TO(doc, hole)} /></Field>
      <Slider label="Altitude" min={4} max={250} step={1} value={f.height} onChange={v => set({ height: v })} onDone={done} format={ft} />
      <Slider label="Speed" min={0.25} max={3} step={0.05} value={f.speed} onChange={v => set({ speed: v })} onDone={done} format={v => `${Math.round(v * 100) / 100}×`} />
      <Slider label="Field of view" min={LENS.min} max={LENS.max} value={f.fov} onChange={v => set({ fov: v })} onDone={done} format={v => `${Math.round(v)}°`} />
      <Fold title="Where it starts" note="Start offset, side offset, look ahead" testid="flyover-start">
        <Slider label="Start offset (behind the tee)" min={0} max={400} step={5} value={f.behind} onChange={v => set({ behind: v })} onDone={done} format={ft} />
        <Slider label="Side offset" min={-200} max={200} step={5} value={f.side} onChange={v => set({ side: v })} onDone={done} format={v => (v === 0 ? "Centered" : `${ft(Math.abs(v))} ${v > 0 ? "right" : "left"}`)} />
        <Slider label="Look ahead" min={30} max={500} step={10} value={f.lookAhead} onChange={v => set({ lookAhead: v })} onDone={done} format={ft} />
      </Fold>
      <div className="mt-2.5"><Button full onClick={() => cameraFrom(hole.id, all.length ? all.length - 1 : null)} testid="fly-camera" title="Move the camera yourself and set keyframes"><Video size={15} /> Edit camera path</Button></div>
      <OnScreen hole={hole} scope={scope} setScope={setScope} chosen />
    </div>
  );
}

/** Camera path Custom: the flyover's timeline with its keyframes (select one; drag it to change
 * when it happens), the selected one's altitude, field of view and time, Edit camera path, Edit on
 * map, Add keyframe, and playing it. */
function KeyFlight({ hole, keys }: { hole: Hole; keys: FlyKey[] }) {
  const doc = useCourse(s => s.doc);
  const pickedRaw = useEditor(e => e.flyKey);
  const setEd = useEditor(e => e.set);
  const [scope, setScope] = useScope(hole);
  const { fs, times } = useFlight(hole);
  const ground = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;
  const p = pickedRaw !== null ? Math.min(pickedRaw, keys.length - 1) : null;
  const k = p !== null ? keys[p] : null;
  const setKeys = (next: FlyKey[], history = true) => updateHole(hole.id, { flyKeys: next }, history);
  // (live while a slider or mark moves; one undo step when it's let go)
  const edit = (i: number, patch: Partial<FlyKey>) => setKeys(keys.map((k, j) => (j === i ? { ...k, ...patch } : k)), false);
  const done = () => useCourse.getState().commit();
  const add = () => {
    const r = insertKey(keys, p ?? keys.length - 2, fs, ground);
    setKeys(r.keys);
    setEd({ flyKey: r.at });
  };
  const remove = () => {
    if (p === null || keys.length <= 2) return;
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
    <div className="mt-2" data-testid="fly-keys">
      <div className="pt-1 pb-0.5"><FlightLine playing={false} onPlay={play} onStop={() => {}} length={times[times.length - 1]} keys={times} picked={p} onPick={i => setEd({ flyKey: i })} onRetime={retime} playId="fly-preview" /></div>
      {k && p !== null && (
        <div className="mt-1.5 rounded-[14px] bg-white/[0.06] px-2.5 pt-1.5 pb-0.5" data-testid="fly-key-card">
          <div className="flex items-center gap-0.5 mb-1.5">
            <button className={step} aria-label="Previous keyframe" disabled={p === 0} onClick={() => setEd({ flyKey: p - 1 })}><ChevronLeft size={17} /></button>
            <span className="flex-1 text-center text-[13px] font-semibold text-zinc-100"><span data-testid="fly-key-title">Keyframe {p + 1}</span> <span className="font-normal text-zinc-400 tabular-nums">· {clock(times[p], true)}</span></span>
            <button className={step} aria-label="Next keyframe" disabled={p === keys.length - 1} onClick={() => setEd({ flyKey: p + 1 })}><ChevronRight size={17} /></button>
            <button className={`${step} hover:!text-red-400`} aria-label={`Delete keyframe ${p + 1}`} title={keys.length <= 2 ? "A custom camera path needs two keyframes" : `Delete keyframe ${p + 1}`} disabled={keys.length <= 2} onClick={remove}><Trash2 size={15} /></button>
          </div>
          <Slider label="Altitude" min={2} max={Math.max(400, Math.round(k.alt))} value={Math.round(k.alt)} onChange={v => edit(p, { alt: v })} onDone={done} format={v => fmtDist(v, doc.units)} />
          <Slider label="Field of view" min={LENS.min} max={LENS.max} value={k.fov ?? fs.fov} onChange={v => edit(p, { fov: v })} onDone={done} format={v => `${Math.round(v)}°`} />
          {p > 0 && <Slider label="Time" min={Math.round((times[p - 1] + 0.5) * 10) / 10} max={Math.round((p + 1 < keys.length ? times[p + 1] - 0.5 : times[p] + 30) * 10) / 10} step={0.1} value={Math.round(times[p] * 10) / 10} onChange={v => retime(p, v, false)} onDone={done} format={v => clock(v, true)} />}
        </div>
      )}
      <div className="mt-2.5"><Button full tone="primary" onClick={() => cameraFrom(hole.id, p ?? 0)} testid="fly-camera" title="Move the camera yourself and set keyframes"><Video size={15} /> Edit camera path</Button></div>
      <div className="grid grid-cols-3 gap-1.5 mt-1.5">
        <Button small onClick={() => keysIn3D(hole.id)} testid="fly-in-3d" title="On the map, tilted: drag each camera up, down or along"><MapIcon size={13} /> Edit on map</Button>
        <Button small onClick={add} testid="fly-key-add" title={p !== null ? `A new one after keyframe ${p + 1}` : undefined}><Plus size={13} /> Add keyframe</Button>
        <Button small onClick={play} testid="fly-play-flyover"><Play size={13} /> Play flyover</Button>
      </div>
      <OnScreen hole={hole} scope={scope} setScope={setScope} />
    </div>
  );
}

/** A hole's Flyover section: Camera path (Automatic or Custom), its settings, and Overlays. */
export function HoleFlight({ hole }: { hole: Hole }) {
  const all = hole.flyKeys ?? [];
  const keys = all.length >= 2 ? all : null;
  return (
    <div data-testid="hole-flight">
      <div data-testid="flyover-settings">
        <Field label="Camera path"><Segmented label="Camera path" value={keys ? "custom" : "auto"} onChange={v => setCameraPath(hole, v === "custom")} options={[{ value: "auto", label: "Automatic", title: "The camera follows the hole by itself" }, { value: "custom", label: "Custom", title: "The camera flies through keyframes you set" }]} /></Field>
        {/* (a new hole, or keys gone: its own settings start again) */}
        {keys ? <KeyFlight key={hole.id} hole={hole} keys={keys} /> : <AutoFlight key={hole.id} hole={hole} />}
      </div>
    </div>
  );
}
