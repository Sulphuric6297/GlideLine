// The view: what this device shows while working (the photo, lines, grass), and the 3D view's own
// look: its landscape, colors, sun, shadows and basket band. The printed map has its own (Map style).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import { FOCUS, HelpLink, POPOVER, Slider } from "./ui";
import { COLOR_PICKS, landscape3dOf, treeMixOf } from "../lib/landscapes";
import { paintLight } from "../lib/mapLook";
import type { MapStyle } from "../types";
import { useCourse, useEditor } from "../state/course";
import { setStyle } from "./DesignPanel";
import { Segmented, Toggle } from "./ui";
import { LandscapePicker } from "./LandscapePicker";
import { SunFromSlider } from "./MapLookPanel";
import { SHOW_EVENT } from "./showSetting";
import { BAND_COLORS, BASKET_BAND } from "../three/courseModels";
import { useLayout } from "./useLayout";

/** The View button. `big`: a thumb's size, its panel opening to its left (beside it) rather than
 * below; `size` sets the button's size alone (44 px beside other 44 px buttons); `label`: a tile,
 * the icon over a 12 px label (a phone's tee view card). */
export function SceneButton({ className = "", big = false, size, label }: { className?: string; big?: boolean; size?: "small" | "big"; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // (on a phone it rises from the bottom over everything, as the phone's menus do: beside its
  // button the bottom panel hid most of it)
  const phone = useLayout() === "phone";
  // (opened by search: a setting in it asked for)
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === "view") setOpen(true); };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-scene-sheet]")) setOpen(false); };
    // (Esc closes just this, before the map hears it)
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  // (no backdrop blur: on a touch screen it turns near-black, index.css)
  const large = (size ?? (big ? "big" : "small")) === "big";
  return (
    <div className={`relative pointer-events-auto ${className}`} ref={ref}>
      {label ? (
        <button
          className={`w-14 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold text-white ${FOCUS} ${open ? "bg-white/15" : "bg-white/[0.07] active:bg-white/15"}`}
          title="View: photo, lines, grass, landscape"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          data-testid="scene-button"
        >
          <Layers size={17} /><span className="leading-none">{label}</span>
        </button>
      ) : (
        <button
          className={`glass ${large ? "rounded-2xl w-11 h-11" : "rounded-lg w-8 h-8"} flex items-center justify-center shadow-lg shadow-black/30 ring-1 transition-colors ${FOCUS} ${open ? "ring-sky-400 text-zinc-50" : "ring-white/10 text-zinc-300 hover:text-zinc-50"}`}
          title="View: photo, lines, grass, landscape"
          aria-label="View"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          data-testid="scene-button"
        >
          <Layers size={large ? 20 : 16} />
        </button>
      )}
      {open && phone && createPortal(
        <div data-scene-sheet className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 animate-[dgfade_160ms_ease-out]" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <ScenePanel onClose={() => setOpen(false)} big sheet place="" />
        </div>,
        document.body
      )}
      {open && !phone && <ScenePanel onClose={() => setOpen(false)} big={big || !!label} place={label ? "right-0 top-[52px]" : big ? "right-[52px] top-0" : "right-0 top-10"} />}
    </div>
  );
}

const HEAD = "text-[11px] font-semibold text-zinc-500 mb-1.5";

/** Design's own colors, sun and shadows, from above and in 3D (MapStyle.look3d): changed here, the illustrated map
 * keeps its own; unset, each starts from the 3D landscape's (the colors) or the map's (the sun). */
function Look3d({ s }: { s: MapStyle }) {
  const l3 = s.look3d ?? {};
  const put = (patch: NonNullable<MapStyle["look3d"]>, history = true) => setStyle({ look3d: { ...useCourse.getState().doc.style.look3d, ...patch } }, history);
  const land = landscape3dOf(s), nature = land.colors;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const chip = (on: boolean) => `flex items-center gap-1.5 rounded-full px-2.5 py-1 touch:py-2 text-xs touch:text-[13px] font-semibold ${FOCUS} ${on ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.07] text-zinc-300 hover:bg-white/[0.12]"}`;
  const dot = (c: string) => <span className="w-3 h-3 rounded-full ring-1 ring-black/30" style={{ background: c }} />;
  // (the leaves: a color and its autumn mix; the 3D landscape's own mix until one is picked)
  const mix = l3.treeMix ?? treeMixOf({ landscape: l3.landscape ?? s.landscape, treeMix: l3.landscape ? undefined : s.treeMix });
  const row = (label: string, testid: string, picks: { id: string; label: string; color: string; mix?: string[] }[], on: (c: { color: string; mix?: string[] }) => boolean, pickIt: (c: { color: string; mix?: string[] }) => void) => (
    <>
      <div className="text-xs text-zinc-400 mt-2 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${label} in 3D`} data-testid={testid}>
        {picks.map(c => <button key={c.id} role="radio" aria-checked={on(c)} className={chip(on(c))} onClick={() => pickIt(c)}>{dot(c.color)}{c.label}</button>)}
      </div>
    </>
  );
  const color = (k: "fairway" | "rough" | "path" | "water", fallback: string) => ({ on: (c: { color: string }) => same(l3[k] ?? fallback, c.color), pick: (c: { color: string }) => put({ [k]: c.color }) });
  const fair = color("fairway", nature.fairway), grass = color("rough", nature.rough), path = color("path", nature.path), water = color("water", nature.water);
  return (
    <div data-testid="view-light">
      {row("Leaf colors", "leaves-3d", COLOR_PICKS.trees, c => same(l3.trees ?? nature.trees, c.color) && mix.join() === (c.mix ?? []).join(), c => put({ trees: c.color, treeMix: c.mix ?? [] }))}
      {row("Fairways", "fairways-3d", COLOR_PICKS.fairway, fair.on, fair.pick)}
      {row("Grass", "grass-3d", COLOR_PICKS.grass, grass.on, grass.pick)}
      {row("Paths", "paths-3d", COLOR_PICKS.paths, path.on, path.pick)}
      {row("Roads and parking", "paving-3d", COLOR_PICKS.paving, c => same(l3.paving ?? COLOR_PICKS.paving[0].color, c.color), c => put({ paving: c.color }))}
      {row("Water", "water-3d", COLOR_PICKS.water, water.on, water.pick)}
      <div className="h-1" />
      <SunFromSlider s={s} live value={l3.sunFrom} put={(b, h) => put({ sunFrom: b }, h)} />
      <Look3dSlider label="Sun height" value={l3.sunHeight ?? paintLight(s).height} min={8} max={80} step={2} format={x => `${Math.round(x)}°`} put={(x, h) => put({ sunHeight: x }, h)} />
      <Look3dSlider label="Shadows" value={l3.shadows ?? s.shadows ?? 0.65} min={0} max={1} step={0.05} format={x => `${Math.round(x * 100)}%`} put={(x, h) => put({ shadows: x }, h)} />
    </div>
  );
}

/** One of the 3D view's own sliders: live while dragged, one undo step when let go. */
function Look3dSlider({ label, value, min, max, step, format, put }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; put: (v: number, history: boolean) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return <Slider label={label} min={min} max={max} step={step} value={v} onChange={x => { setV(x); put(x, false); }} onDone={() => useCourse.getState().commit()} format={format} />;
}

function ScenePanel({ onClose, big, place, sheet }: { onClose: () => void; big?: boolean; place: string; sheet?: boolean }) {
  const s = useCourse(c => c.doc.style);
  const grass = useEditor(e => e.grass);
  const wind = useEditor(e => e.wind);
  const stumps = useEditor(e => e.stumps);
  const measured = useCourse(c => !!c.doc.lidar?.trees.length && !c.readOnly);
  const editing = useCourse(c => !c.readOnly);
  const ed = useEditor();
  const set = useEditor(e => e.set);
  // (as tall as the room below it on screen, scrolling inside: never cut off at the bottom)
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => { const r = box.current?.getBoundingClientRect(); if (r) setRoom(Math.max(180, window.innerHeight - r.top - 16)); };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // (from a tee or in a flyover, the ground there: painted or the photo)
  const fromTee = !!ed.teeView;
  return (
    <div ref={box} className={sheet ? "relative w-full max-w-md max-h-[78dvh] overflow-y-auto dg-scroll overscroll-contain glass-solid rounded-t-[24px] ring-1 ring-white/10 shadow-2xl px-4 pt-3.5 pb-[max(16px,env(safe-area-inset-bottom))] text-left animate-[dgrise_220ms_cubic-bezier(0.2,0.9,0.3,1)]" : `absolute ${place} overflow-y-auto dg-scroll overscroll-contain w-72 ${POPOVER} p-3 z-30 text-left`} style={room && !sheet ? { maxHeight: room } : undefined} data-testid="scene-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">View <HelpLink topic="view-panel" label="View" /></div>
        <button className={`text-zinc-400 hover:text-zinc-50 ${big ? "w-9 h-9 -m-2 flex items-center justify-center" : ""}`} title="Close" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      {/* This device's view while working: not saved with the course (viewers' own look: Share) */}
      <div className={HEAD}>This screen</div>
      {editing && (
        <div className="mb-2" data-testid="map-display">
          {/* (from a tee the ground is the flight's: the same setting as the tee view's Settings) */}
          {fromTee ? (
            <div className="mb-2" data-testid="view-ground">
              <div className="text-xs text-zinc-400 mb-1">Ground</div>
              <Segmented label="Ground" value={ed.flyGround} onChange={v => set({ flyGround: v })} options={[{ value: "ground", label: "Course ground" }, { value: "painted", label: "Painted map" }, { value: "photo", label: "Photo" }]} />
            </div>
          ) : <Toggle label="Satellite photo" checked={ed.photo} onChange={v => set({ photo: v })} />}
          <Toggle label="Trees" checked={!ed.hideTrees} onChange={v => set({ hideTrees: !v })} />
          <Toggle label="Contour lines" checked={ed.contours} onChange={v => set({ contours: v })} />
          <Toggle label="Hill shading" checked={ed.shading} onChange={v => set({ shading: v })} />
          <Toggle label="Ground texture up close" checked={ed.groundDetail} onChange={v => set({ groundDetail: v })} />
        </div>
      )}
      <div className="text-xs text-zinc-400 mb-1">Grass blades</div>
      <Segmented
        label="Grass blades"
        value={grass}
        onChange={v => set({ grass: v })}
        options={[
          { value: "auto", label: "Auto" },
          { value: 0, label: "Off" },
          { value: 1, label: "Low" },
          { value: 2, label: "Medium" },
          { value: 3, label: "High" }
        ]}
      />
      {grass !== 0 && <Toggle label="Grass sways in the wind" checked={wind} onChange={v => set({ wind: v })} />}
      {measured && <Toggle label="Stumps where trees were cut" checked={stumps} onChange={v => set({ stumps: v })} />}
      {/* The 3D view's own look (everyone sees it in 3D; the 2D and printed map keep their own) */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-white/[0.07]" data-testid="course-look">
          <div className={HEAD}>3D look</div>
          <div className="text-xs text-zinc-400 mb-1">Landscape</div>
          <LandscapePicker />
          <Look3d s={s} />
          <div className="text-xs text-zinc-400 mt-2 mb-1">Basket band</div>
          {/* (a finger's 44 px round each swatch: six to the row, touching) */}
          <div className="flex gap-1.5 touch:gap-0" role="radiogroup" aria-label="Basket band" data-testid="basket-band">
            {BAND_COLORS.map(([c, name]) => {
              const on = (s.basketBand ?? BASKET_BAND) === c;
              return (
                <button key={c} role="radio" aria-checked={on} aria-label={name} title={name} onClick={() => setStyle({ basketBand: c === BASKET_BAND ? undefined : c })}
                  className={`group w-7 h-7 touch:w-11 touch:h-11 rounded-full flex items-center justify-center ${FOCUS}`}>
                  <span className={`block w-7 h-7 rounded-full ${on ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-white/15 group-hover:ring-white/40"}`} style={{ background: c }} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
