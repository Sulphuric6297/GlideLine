// The Design step's map style: pick one of the styles, then change any part of the map on its own
// (its trees, grass, fairways, paths and roads, water and light), each choice shown as a picture.
// A part changed shows a dot, and the style card says "Changed"; each part goes back to its style's
// own in one click. Each part's colors are the course's own: kept when the style changes.
import { useContext, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, RotateCcw } from "lucide-react";
import { defaultStyle } from "../lib/course";
import { COLOR_PICKS, tallGrassOf, treeMixOf } from "../lib/landscapes";
import { LIGHT_MODES, LOOK_THEMES, PART_CHOICES, compassName, latitudeOf, lightOf, lookParts, partChanged, sunArc, sunFromOf, themeOf, type LookPart, type LookParts } from "../lib/mapLook";
import { changeDoc, useCourse } from "../state/course";
import { brushOnly } from "../lib/brushSpots";
import type { MapStyle, PathTier } from "../types";
import { ELEVATION_LOOKS, FineTuning, setStyle } from "./DesignPanel";
import { ColorInput, Slider, Toggle, useKeepInPlace } from "./ui";
import { HoleChips } from "./ApplyToHoles";
import { SHOW_EVENT } from "./showSetting";
import { InToolSheet } from "./pageToolState";

/** A slider that changes the map when let go (painting takes a moment). */
function LookSlider({ value, label, min, max, step, format, onDone }: { value: number; label: string; min: number; max: number; step: number; format: (v: number) => string; onDone: (v: number) => void }) {
  const [v, setV] = useState(value);
  const moved = useRef(false);
  useEffect(() => { setV(value); }, [value]);
  return <Slider label={label} min={min} max={max} step={step} value={v} onChange={x => { moved.current = true; setV(x); }} onDone={() => { if (moved.current && v !== value) onDone(v); moved.current = false; }} format={format} />;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Where the sun shines from, by the compass: only along the sun's real path at the course's
 * latitude (never from the north, north of the tropics). */
/** Where the sun shines from: the map's (`sunFrom`), or with `value` and `put`, another's (the 3D
 * view's own, in the View panel). */
export function SunFromSlider({ s, live, value, put }: { s: MapStyle; live?: boolean; value?: number; put?: (bearing: number, history: boolean) => void }) {
  const site = useCourse(c => c.doc.site);
  const lat = latitudeOf(site);
  const { mid, half } = sunArc(lat);
  const bearing = value ?? sunFromOf(s, lat);
  const set = (b: number, history = true) => (put ? put(b, history) : setStyle({ sunFrom: b }, history));
  const off = ((bearing - mid + 540) % 360) - 180;
  const [v, setV] = useState(off);
  useEffect(() => { setV(off); }, [off]);
  const toBearing = (o: number) => Math.round((mid + o + 360) % 360);
  return (
    <Slider label="Sun from the" min={-half} max={half} step={5} value={v}
      onChange={x => { setV(x); if (live) set(toBearing(x), false); }}
      onDone={() => { if (live) useCourse.getState().commit(); else if (toBearing(v) !== bearing) set(toBearing(v)); }}
      format={x => compassName(toBearing(x))} />
  );
}

const TIER_LABEL: Record<PathTier, string> = { dirt: "Dirt trails", gravel: "Gravel and wood chips", walkway: "Paved walkways", road: "Roads and parking" };
const DEFAULT_ORDER: PathTier[] = ["dirt", "gravel", "walkway", "road"];

/** How paths and roads stack where they cross: top of the list is drawn on top. */
function PathOrder({ s }: { s: MapStyle }) {
  const order = s.pathOrder?.length === 4 ? s.pathOrder : DEFAULT_ORDER;
  const top = [...order].reverse();
  const move = (t: PathTier, by: number) => {
    const list = [...top], i = list.indexOf(t), j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const next = list.reverse();
    setStyle({ pathOrder: next.join() === DEFAULT_ORDER.join() ? undefined : next });
  };
  return (
    <div className="mt-2" data-testid="path-order">
      <div className="text-xs text-zinc-400 mb-1">Where they cross, on top first</div>
      {top.map((t, i) => (
        <div key={t} className="flex items-center gap-2 px-2 py-1.5 rounded-md glass mb-1">
          <span className="text-xs text-zinc-200 flex-1">{TIER_LABEL[t]}</span>
          <button className="p-1 touch:w-11 touch:h-11 touch:-my-1.5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${TIER_LABEL[t]} up`} onClick={() => move(t, -1)}><ArrowUp size={13} /></button>
          <button className="p-1 touch:w-11 touch:h-11 touch:-my-1.5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:opacity-30" disabled={i === top.length - 1} aria-label={`Move ${TIER_LABEL[t]} down`} onClick={() => move(t, 1)}><ArrowDown size={13} /></button>
        </div>
      ))}
    </div>
  );
}

type Part = LookPart | "light" | "elevation";
const PART_LABEL: Record<Part, string> = { trees: "Trees", grass: "Grass", fairway: "Fairways", paths: "Paths and roads", water: "Water", light: "Light and shadow", elevation: "Elevation" };
const PARTS = Object.keys(PART_LABEL) as Part[];
/** The light's own settings and its tone: changed when set to anything but the course's default. */
const DEF = defaultStyle();
const LIGHT_KEYS = ["sunHeight", "shadows", "light", "contrast", "colorStrength", "paint"] as const;
const LIGHT_RESET: Partial<MapStyle> = { lightMode: undefined, goldenSun: undefined, sunFrom: undefined, sunHeight: undefined, shadows: undefined, light: undefined, contrast: undefined, colorStrength: undefined, paint: undefined };
const ELEVATION_RESET: Partial<MapStyle> = { hillshade: true, reliefLook: undefined, reliefScale: undefined };
/** The woods' own settings beside the tree style (pines, where to paint them, how thick). */
const WOODS_RESET: Partial<MapStyle> = { conifers: undefined, autumnVivid: undefined, treeKinds: undefined, treeCover: DEF.treeCover, forest: DEF.forest };
/** Each part's color on the map (its field in the style), and its own color's label. */
const COLOR_FIELD = { trees: "trees", grass: "rough", fairway: "fairway", paths: "path", water: "water" } as const;
const COLOR_LABEL: Record<LookPart, string> = { trees: "Trees", grass: "Grass", fairway: "Fairway", paths: "Paths", water: "Water" };
const commit = () => useCourse.getState().commit();

type Thumb = { id: string; label: string; img: string; on: boolean; pick: () => void };
/** Pictures to pick from: two to a row, or in a phone's tool sheet one row to swipe. */
const pickRow = (row: boolean, grid: string) => (row ? "flex gap-2 overflow-x-auto dg-noscrollbar touch-pan-x touch-pan-y snap-x -mx-3 px-3 pb-1" : grid);
const pickItem = (row: boolean) => (row ? "shrink-0 w-[118px] snap-start" : "");

/** Choices as pictures (each a small painting of the map with it), two to a row. */
function Thumbs({ label, items, testid }: { label: string; items: Thumb[]; testid?: string }) {
  const row = useContext(InToolSheet);
  return (
    <div className={`${pickRow(row, "grid grid-cols-2 gap-x-2 gap-y-2.5")} mb-2.5`} role="radiogroup" aria-label={label} data-testid={testid}>
      {items.map(c => (
        <button key={c.id} role="radio" aria-checked={c.on} onClick={c.pick} data-testid={testid && `${testid}-${c.id}`} className={`group text-center rounded-[12px] ${pickItem(row)}`}>
          <img src={c.img} alt="" loading="lazy" className={`block w-full aspect-[3/2] object-cover rounded-[12px] transition ${c.on ? "ring-[2.5px] ring-orange-400" : "ring-1 ring-white/15 group-hover:ring-white/35"}`} draggable={false} />
          <span className={`block px-1 pt-1 text-[11px] leading-tight ${c.on ? "text-zinc-50 font-semibold" : "text-zinc-400"}`}>{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A part's colors: a few to pick (as pictures), or its own. */
function PartColors({ p, s }: { p: LookPart; s: MapStyle }) {
  const field = COLOR_FIELD[p], value = s[field], base = import.meta.env.BASE_URL;
  const mix = treeMixOf(s).join();
  const picks = COLOR_PICKS[p] as { id: string; label: string; color: string; mix?: string[] }[];
  return (
    <>
      <div className="text-xs text-zinc-400 mt-1 mb-1">{p === "trees" ? "Leaf colors" : "Colors"}</div>
      <Thumbs label={`${PART_LABEL[p]} colors`} testid={`colors-${p}`} items={picks.map(c => ({
        id: c.id, label: c.label, img: `${base}parts/${p}-color-${c.id}.jpg`,
        on: c.color.toLowerCase() === value.toLowerCase() && (p !== "trees" || (c.mix ?? []).join() === mix),
        pick: () => setStyle({ [field]: c.color, ...(p === "trees" ? { treeMix: c.mix ?? [] } : {}) })
      }))} />
      <ColorInput label={COLOR_LABEL[p]} value={value} onChange={v => setStyle({ [field]: v, ...(p === "trees" ? { treeMix: [] } : {}) }, false)} onDone={commit} />
      {p === "grass" && <ColorInput label="Tall grass" value={tallGrassOf(s)} onChange={v => setStyle({ tallGrass: v }, false)} onDone={commit} />}
    </>
  );
}

/** Which holes have a fairway: each hole's own Draw the fairway (its panel in Design), here for
 * them all, on the map and in 3D alike. */
function FairwayHoles() {
  const holes = useCourse(c => c.doc.holes);
  if (!holes.length) return null;
  return (
    <div className="mt-2.5" data-testid="fairway-holes">
      <div className="text-xs text-zinc-400 mb-1.5">Holes with a fairway</div>
      <HoleChips label="Holes with a fairway" all={null} picked={holes.filter(h => h.fairway).map(h => h.id)}
        onChange={v => changeDoc(d => ({ holes: d.holes.map(h => (h.fairway === v.includes(h.id) ? h : { ...h, fairway: v.includes(h.id) })) }))} />
    </div>
  );
}

/** A part to show open the next time the panel opens (from the 3D view's light link). */
let wanted: Part | null = null;
export const openLookPart = (p: Part) => { wanted = p; };

export function MapLookPanel() {
  const s = useCourse(c => c.doc.style);
  const hasBrush = useCourse(c => c.doc.items.some(i => i.type === "area" && brushOnly(i)));
  // (the trees open to start with: the part most changed)
  const [open, setOpen] = useState<Part | null>(() => { const w = wanted; wanted = null; return w ?? "trees"; });
  // (asked for by search or the 3D view's light link while it's up)
  useEffect(() => {
    const on = (e: Event) => { const d = String((e as CustomEvent).detail); if (d.startsWith("look:")) { wanted = null; setOpen(d.slice(5) as Part); } };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  // (the part opened stays under the pointer while the one open before closes above it)
  const keep = useKeepInPlace();
  const theme = themeOf(s), parts = lookParts(s), lt = lightOf(s);
  // (how the ground's shape is drawn: Shaded unless picked)
  const relief = !s.hillshade ? "off" : s.reliefLook === "sketched" ? "cliffs" : s.reliefLook ?? "shaded";
  /** One part's setting changed (kept apart from its style's own). */
  const setPart = <K extends LookPart>(part: K, patch: Partial<LookParts[K]>) => setStyle({ lookParts: { ...s.lookParts, [part]: { ...s.lookParts?.[part], ...patch } } });
  const resetPart = (part: Part) => {
    if (part === "light") { setStyle(LIGHT_RESET); return; }
    if (part === "elevation") { setStyle(ELEVATION_RESET); return; }
    const own = { ...s.lookParts };
    delete own[part];
    setStyle({ lookParts: Object.keys(own).length ? own : undefined, ...(part === "paths" ? { pathOrder: undefined } : {}), ...(part === "trees" ? WOODS_RESET : {}) });
  };
  const pickTheme = (id: string) => setStyle({ mapLook: id === "classic" ? undefined : (id as MapStyle["mapLook"]), lookParts: undefined, lightMode: undefined, goldenSun: undefined });
  // (every part back to the style's own, in one undo step)
  const resetAll = () => setStyle({ ...LIGHT_RESET, ...ELEVATION_RESET, ...WOODS_RESET, lookParts: undefined, pathOrder: undefined });
  const current = (p: Part) => (p === "elevation" ? ELEVATION_LOOKS.find(l => l.id === relief)!.label : p === "light" ? LIGHT_MODES.find(m => m.id === lt.mode)!.label : (PART_CHOICES[p] as { id: string; label: string }[]).find(c => c.id === parts[p].style)?.label ?? "");
  const lightChanged = !!s.lightMode || s.goldenSun !== undefined || s.sunFrom !== undefined || LIGHT_KEYS.some(k => s[k] !== undefined && s[k] !== DEF[k]);
  const woodsChanged = s.conifers !== undefined || s.autumnVivid !== undefined || !!s.treeKinds || (s.treeCover ?? DEF.treeCover) !== DEF.treeCover || (s.forest ?? DEF.forest) !== DEF.forest;
  const changed = (p: Part) => (p === "elevation" ? relief !== "shaded" || (s.reliefScale ?? 1) !== 1 : p === "light" ? lightChanged : partChanged(s, p) || (p === "paths" && !!s.pathOrder) || (p === "trees" && woodsChanged));
  // (the style card says Changed when any part shows its dot; Reset all takes every dot away)
  const mixed = PARTS.some(changed);
  const base = import.meta.env.BASE_URL;
  const row = useContext(InToolSheet);

  return (
    <div data-testid="map-look">
      <div className={pickRow(row, "grid grid-cols-2 gap-x-2.5 gap-y-3")} role="radiogroup" aria-label="Map style" data-testid="map-styles">
        {LOOK_THEMES.map(t => {
          const on = theme.id === t.id;
          return (
            <button key={t.id} role="radio" aria-checked={on} onClick={() => pickTheme(t.id)} title={t.hint} data-testid={`map-style-${t.id}`} className={`group relative text-center rounded-[14px] ${pickItem(row)}`}>
              <img src={`${base}looks/${t.id}.jpg`} alt="" className={`block w-full aspect-[3/2] object-cover rounded-[14px] transition ${on ? "ring-[2.5px] ring-orange-400" : "ring-1 ring-white/15 group-hover:ring-white/35"}`} draggable={false} />
              <span className={`block pt-1.5 text-xs ${on ? "text-zinc-50 font-semibold" : "text-zinc-400"}`}>{t.label}</span>
              {on && mixed && <span className="absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur text-orange-200">Changed</span>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-1.5 mt-3">
        <div className="text-[12px] font-semibold text-zinc-400 px-1">Parts of the map</div>
        {mixed && <button className="text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1 touch:py-2.5 touch:-my-2.5" onClick={resetAll} title="Every part back to the map style's own"><RotateCcw size={12} /> Reset all</button>}
      </div>
      <div className="rounded-[16px] bg-white/[0.06] overflow-hidden">
      {PARTS.map(p => {
        const isOpen = open === p;
        const pic = p === "elevation" ? `${base}relief/${relief}.jpg` : p === "light" ? `${base}parts/light-${lt.mode}.jpg` : `${base}parts/${p}-${parts[p].style}.jpg`;
        return (
          <div key={p} className="relative before:absolute before:left-[52px] before:right-0 before:top-0 before:h-px before:bg-white/[0.07] first:before:hidden" data-testid={`look-part-${p}`}>
            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.04]" aria-expanded={isOpen} onClick={e => { keep(e.currentTarget); setOpen(isOpen ? null : p); }} data-testid={`part-${p}`}>
              <img src={pic} alt="" className="w-7 h-7 rounded-[8px] object-cover ring-1 ring-white/10" draggable={false} />
              <span className="text-[13.5px] font-medium text-zinc-100 flex-1">{PART_LABEL[p]}</span>
              {changed(p) && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" aria-label="Changed" />}
              {p !== "light" && p !== "elevation" && <span className="w-3 h-3 rounded-[4px] ring-1 ring-white/20" style={{ background: s[COLOR_FIELD[p]] }} />}
              <span className="text-[12.5px] text-zinc-400">{current(p)}</span>
              <ChevronRight size={15} className={`text-zinc-500 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
            {isOpen && (
              <div className="px-3 pb-3.5 pt-0.5">
                {p === "elevation" ? (
                  <div>
                    <Thumbs label="Elevation" testid="elevation" items={ELEVATION_LOOKS.map(l => ({ id: l.id, label: l.label, img: `${base}relief/${l.id}.jpg`, on: relief === l.id, pick: () => setStyle(l.id === "off" ? { hillshade: false } : { hillshade: true, reliefLook: l.id === "shaded" ? undefined : l.id }) }))} />
                    {relief !== "off" && <LookSlider value={s.reliefScale ?? 1} label="Hills" min={0} max={3} step={0.05} format={x => (x === 0 ? "Flat" : `${x.toFixed(2).replace(/0$/, "")}×`)} onDone={v => setStyle({ reliefScale: v })} />}
                    {/* (the Contours look draws its own lines) */}
                    {relief !== "contours" && <Toggle label="Contour lines" checked={s.contours} onChange={v => setStyle({ contours: v })} />}
                  </div>
                ) : p === "light" ? (
                  <>
                    <Thumbs label="Light" items={LIGHT_MODES.map(m => ({ id: m.id, label: m.label, img: `${base}parts/light-${m.id}.jpg`, on: lt.mode === m.id, pick: () => setStyle({ lightMode: m.id }) }))} />
                    {lt.mode === "golden" && <LookSlider value={lt.sun} label="Golden sun" min={0} max={1} step={0.05} format={x => (x < 0.05 ? "The style's daylight" : pct(x))} onDone={v => setStyle({ goldenSun: v, lightMode: "golden" })} />}
                    <SunFromSlider s={s} />
                    {lt.mode === "midday" && <LookSlider value={s.sunHeight ?? 38} label="Sun height" min={12} max={80} step={2} format={x => `${Math.round(x)}° · ${x < 25 ? "long shadows" : x < 50 ? "afternoon" : "midday"}`} onDone={v => setStyle({ sunHeight: v })} />}
                    <LookSlider value={s.shadows ?? 0.65} label="Shadows" min={0} max={1} step={0.05} format={pct} onDone={v => setStyle({ shadows: v })} />
                    <div className="-mx-4"><FineTuning s={s} /></div>
                  </>
                ) : (
                  <>
                    <Thumbs label={PART_LABEL[p]} items={(PART_CHOICES[p] as { id: string; label: string }[]).map(c => ({ id: c.id, label: c.label, img: `${base}parts/${p}-${c.id}.jpg`, on: parts[p].style === c.id, pick: () => setPart(p, { style: c.id } as never) }))} />
                    <PartColors p={p} s={s} />
                    {p === "trees" && (
                      <>
                        {/* (autumn's colours: how vivid, only while the leaves are autumn's) */}
                        {treeMixOf(s).length > 0 && <LookSlider value={s.autumnVivid ?? 1} label="Autumn colors" min={0.4} max={1.6} step={0.05} format={x => (x < 0.95 ? "Softer" : x > 1.05 ? "More vivid" : "As they are")} onDone={v => setStyle({ autumnVivid: Math.abs(v - 1) < 0.01 ? undefined : v })} />}
                        {/* (the trees themselves, their kinds, where they stand and how close, are the 3D
                        map's: Site, Trees. Here only how big the map draws them, in every look) */}
                        <LookSlider value={parts.trees.size} label="Size" min={0.6} max={1.5} step={0.05} format={pct} onDone={v => setPart("trees", { size: v })} />
                        {/* (and the brush's bushes, where the course has brush) */}
                        {hasBrush && <LookSlider value={parts.trees.brush ?? 1} label="Brush size" min={0.5} max={2} step={0.05} format={pct} onDone={v => setPart("trees", { brush: v })} />}
                      </>
                    )}
                    {p === "grass" && (
                      <>
                        <LookSlider value={parts.grass.bright} label="Brightness" min={0.7} max={1.5} step={0.02} format={pct} onDone={v => setPart("grass", { bright: v })} />
                        <LookSlider value={parts.grass.texture} label="Texture" min={0} max={2} step={0.05} format={pct} onDone={v => setPart("grass", { texture: v })} />
                      </>
                    )}
                    {p === "fairway" && <LookSlider value={parts.fairway.bright} label="Brightness" min={0.8} max={1.3} step={0.02} format={pct} onDone={v => setPart("fairway", { bright: v })} />}
                    {p === "fairway" && <FairwayHoles />}
                    {p === "paths" && <PathOrder s={s} />}
                  </>
                )}
                {changed(p) && <button className="mt-2 text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1 touch:py-2.5" onClick={() => resetPart(p)} title="The map style's own again" data-testid="part-reset"><RotateCcw size={12} /> Reset</button>}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
