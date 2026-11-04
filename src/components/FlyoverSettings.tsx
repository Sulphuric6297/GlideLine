// A hole's flyover settings on a computer, in the side panel's own parts (sections of fields,
// sliders, two-way switches and folds): the Flyover editor's panel with nothing selected (CameraHud),
// with the same labels, in the same order, as the phone's (FlyoverBar): Camera path (Automatic or
// Custom), Camera (altitude, speed, field of view, where it starts) or the keyframes, Apply to, On the
// video (Overlays), Export video. Where a hole's or a tee's other settings are, the flyover is only
// its Flyover row: what it is, how long, and Edit flyover (FlyoverRow).
import { Clapperboard, Play, Video } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LENS, flyoverOf } from "../lib/flight";
import { holeLabel } from "../lib/course";
import { fmtDist } from "../lib/units";
import { changeDoc, updateHole, useCourse, useEditor } from "../state/course";
import type { FlyKey, FlyoverSettings, FlyShow, Hole } from "../types";
import { ApplyToHoles } from "./ApplyToHoles";
import { Button, HelpLink, Segmented, Slider, Toggle } from "./ui";
import { clock, setCameraPath, useFlight } from "./FlyoverBar";

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

/** Whether the Flyover editor was opened from the map (Done goes back there) or from tee view. */
let fromMap = false;
export const editorFromMap = () => fromMap;

/** The Flyover editor opened on a hole, keyframe `at` selected (null: the whole flyover). */
export const cameraFrom = (holeId: string, at: number | null) => {
  fromMap = !useEditor.getState().teeView;
  useEditor.getState().set({ teeView: holeId, teeViewTee: null, flyover: false, flyCam: true, flyKey: at });
};
export const editFlyover = (holeId: string) => cameraFrom(holeId, null);

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

/** Camera path Custom: its keyframes, each with its moment; a click selects one (its own panel). */
function KeyList({ hole, keys }: { hole: Hole; keys: FlyKey[] }) {
  const { times } = useFlight(hole);
  const setEd = useEditor(e => e.set);
  return (
    <Group title="Keyframes" help="flyover" testid="fly-keys">
      <div className="flex flex-col gap-0.5">
        {keys.map((_, i) => (
          <button key={i} type="button" className="flex items-center gap-2.5 rounded-[11px] px-2 py-1.5 text-left text-[13px] font-semibold text-zinc-100 hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            onClick={() => setEd({ flyKey: i })} title={`Select keyframe ${i + 1}`} data-testid="fly-key-row">
            <span className="w-[22px] h-[22px] rounded-full bg-zinc-100 text-zinc-900 text-[11px] font-extrabold flex items-center justify-center">{i + 1}</span>
            Keyframe {i + 1}
            <span className="ml-auto font-normal text-zinc-400 tabular-nums">{clock(times[i] ?? 0, true)}</span>
          </button>
        ))}
      </div>
    </Group>
  );
}

/** A hole's flyover settings, the Flyover editor's with nothing selected: Camera path, the camera
 * (Automatic) or the keyframes (Custom), Apply to, On the video, and Export video. */
export function HoleFlight({ hole, exportVideo }: { hole: Hole; exportVideo?: { label: string; run: () => void; busy?: string | null } }) {
  const doc = useCourse(s => s.doc);
  const [scope, setScope] = useScope(hole);
  const all = hole.flyKeys ?? [];
  const keys = all.length >= 2 ? all : null;
  return (
    <div data-testid="hole-flight">
      <div data-testid="flyover-settings">
        <Group title="Camera path" help="flyover">
          <Segmented label="Camera path" value={keys ? "custom" : "auto"} onChange={v => setCameraPath(hole, v === "custom")} options={[{ value: "auto", label: "Automatic", title: "The camera follows the hole by itself" }, { value: "custom", label: "Custom", title: "The camera flies through keyframes you set" }]} />
        </Group>
        {/* (a new hole, or keys gone: its own settings start again) */}
        {keys ? <KeyList key={hole.id} hole={hole} keys={keys} /> : <AutoFlight key={hole.id} hole={hole} scope={scope} />}
        <Group title="Apply to">
          <Segmented label="Apply to" value={scope} onChange={setScope} options={[{ value: "course", label: "All holes" }, { value: "hole", label: "This hole", title: `Only hole ${holeLabel(doc, hole.id)}` }]} />
        </Group>
        <Group title="On the video"><Overlays hole={hole} scope={scope} /></Group>
        {exportVideo && <div className="mt-4"><Button full onClick={exportVideo.run} disabled={!!exportVideo.busy} testid="fly-export"><Clapperboard size={15} /> {exportVideo.busy ?? "Export video"}</Button><p className="mt-1 text-center text-[11.5px] text-zinc-500 tabular-nums">{exportVideo.label}</p></div>}
      </div>
    </div>
  );
}

/** A hole's flyover where its other settings are (its panel, or a tee's): what the camera path is,
 * how long it plays, Play flyover and Edit flyover, the one place it's changed. */
export function FlyoverRow({ hole }: { hole: Hole }) {
  const { keys, length } = useFlight(hole);
  const readOnly = useCourse(c => c.readOnly);
  return (
    <div data-testid="flyover-row">
      <div className="flex items-center gap-2.5 rounded-[14px] bg-white/[0.06] px-3 py-2.5 mb-2">
        <Video size={17} className="shrink-0 text-zinc-300" />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-zinc-100">{keys ? "Custom camera path" : "Automatic camera path"}</span>
          {keys && <span className="block text-xs text-zinc-400">{keys.length} keyframes</span>}
        </span>
        {length !== null && <span className="text-xs text-zinc-400 tabular-nums">{clock(length)}</span>}
      </div>
      <div className={`grid ${readOnly ? "grid-cols-1" : "grid-cols-2"} gap-1.5`}>
        <Button small onClick={() => useEditor.getState().set({ teeView: hole.id, teeViewTee: null, flyover: true, flyCam: false })} testid="flyover"><Play size={13} /> Play flyover</Button>
        {!readOnly && <Button small tone="primary" onClick={() => editFlyover(hole.id)} testid="fly-edit" title="The flyover's one editor: its camera, keyframes and settings"><Video size={13} /> Edit flyover</Button>}
      </div>
    </div>
  );
}
