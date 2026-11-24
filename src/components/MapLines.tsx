// The course map's throw lines, in the Lines tool: how they're drawn (Painted, Trail or Classic),
// the layout the map shows as its main line (its own, apart from the one Design is on), each tee
// color's own line (color, line, width, opacity, outline, shadow, arrowhead, its distance, shown or
// hidden), and where another tee's line meets the main one. A computer's side panel and a phone's
// Lines tool show the same parts.
import { useState } from "react";
import { ChevronRight, Eye, EyeOff, RotateCcw } from "lucide-react";
import { TEE_LEVELS, TEE_ORDER } from "../constants";
import { mapLayoutOf } from "../lib/course";
import { EARTH, LINE_CREAM, lineLookOf, lineStyleOf, mainLevelOf, teeColorOf } from "../lib/mapSvg";
import { changeDoc, useCourse } from "../state/course";
import type { LineStyle, MapStyle, TeeLevel } from "../types";
import { ColorInput } from "./ColorSwatches";
import { setStyle } from "./DesignPanel";
import { Thumbs } from "./MapLookPanel";
import { ChipPick, Field, Segmented, Slider, Toggle, useKeepInPlace } from "./ui";

const LOOKS = [
  { id: "painted", label: "Painted", hint: "Earthy colors, soft shadows" },
  { id: "trail", label: "Trail", hint: "Painted, other tees' lines in dashes" },
  { id: "classic", label: "Classic", hint: "Pure colors, dark outlines" }
] as const;
const DASH_LABEL = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" } as const;
const commit = () => useCourse.getState().commit();

/** A tee color's own line changed (`history` false: on its way, one undo step at `commit`). */
const setLine = (level: TeeLevel, patch: Partial<LineStyle>, history = true) =>
  changeDoc(d => {
    const own = Object.fromEntries(Object.entries({ ...d.style.lineStyles?.[level], ...patch }).filter(([, v]) => v !== undefined)) as LineStyle;
    const all = { ...d.style.lineStyles, [level]: own };
    if (!Object.keys(own).length) delete all[level];
    return { style: { ...d.style, lineStyles: Object.keys(all).length ? all : undefined } };
  }, history);

/** The line drawn small, as the map draws it, on a patch of woods. */
function LineSample({ s, level, main, multi }: { s: MapStyle; level: TeeLevel; main: boolean; multi: boolean }) {
  const ls = lineStyleOf(s, level, main, multi), d = "M5 22 C11 9 19 20 24 6";
  const dash = ls.dash === "dashed" ? "4.2 2.6" : ls.dash === "dotted" ? "0 4" : undefined;
  const w = 2.6 * ls.width;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="rounded-[8px] ring-1 ring-white/10 shrink-0" aria-hidden>
      <rect width="28" height="28" fill="#33502a" />
      <g opacity={ls.hidden ? 0.25 : ls.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {ls.outline === "soft" && !main && <path d={d} stroke={LINE_CREAM} strokeOpacity={0.38} strokeWidth={w + 3} />}
        {ls.outline === "soft" && <path d={d} stroke="#2e2416" strokeOpacity={0.7} strokeWidth={w + 1} strokeDasharray={dash} />}
        {ls.outline === "dark" && <path d={d} stroke="rgba(0,0,0,.6)" strokeWidth={w + 2} strokeDasharray={dash} />}
        <path d={d} stroke={ls.color} strokeWidth={w} strokeDasharray={dash} />
      </g>
    </svg>
  );
}

export function MapLines() {
  const doc = useCourse(c => c.doc);
  const s = doc.style;
  const keep = useKeepInPlace();
  const [open, setOpen] = useState<TeeLevel | null>(null);
  // (the tee colors the course has, back tees first)
  const levels = TEE_ORDER.filter(l => doc.items.some(i => i.type === "tee" && i.level === l));
  if (!s.throwLines || !levels.length) return null;
  // (the main line's color: the map layout's, else the nearest there is, as each hole picks it)
  const mapLayout = mapLayoutOf(doc), mainLevel = mainLevelOf(levels, mapLayout.tee);
  const look = lineLookOf(s), base = import.meta.env.BASE_URL;
  // (more than one layout: each one's line in its own tee color, the main one too)
  const multi = doc.layouts.length > 1;
  const nameOf = (l: TeeLevel) => doc.layouts.find(x => x.tee === l)?.name ?? `${TEE_LEVELS[l].label} tees`;
  // (the colors a line can take: the look's cream and white, the tee colors, earthy and pure)
  const palette = [{ title: "Line colors", list: [{ name: "Cream", color: LINE_CREAM }, { name: "White", color: "#ffffff" }, ...TEE_ORDER.map(l => ({ name: TEE_LEVELS[l].label, color: EARTH[l] })), ...TEE_ORDER.filter(l => l !== "white").map(l => ({ name: `${TEE_LEVELS[l].label}, bright`, color: TEE_LEVELS[l].color }))] }];
  return (
    <div className="mt-3" data-testid="map-lines">
      <div className="text-xs touch:text-[13px] text-zinc-400 mb-1.5">Line look</div>
      <Thumbs label="Line look" testid="line-look" cols={3} items={LOOKS.map(l => ({ id: l.id, label: l.label, img: `${base}parts/lines-${l.id}.jpg`, on: look === l.id, pick: () => setStyle({ lineLook: l.id === "classic" ? undefined : l.id }) }))} />
      {doc.layouts.length > 1 && (
        <Field label="Main layout" hint="Drawn on top, with the distances. The other tees' lines join it.">
          <ChipPick label="Main layout" testid="map-layout" value={mapLayout.id} onChange={v => setStyle({ mapLayout: v })}
            options={doc.layouts.map(l => ({ value: l.id, label: l.name, color: teeColorOf(s, l.tee) }))} />
        </Field>
      )}
      {levels.length > 1 && (
        <Field label="Other tees' lines">
          <Segmented label="Other tees' lines" value={s.linesMeet ?? "join"} onChange={v => setStyle({ linesMeet: v === "alongside" ? "alongside" : undefined })}
            options={[{ value: "join", label: "Join the main line", title: "Each stops where it meets the main line" }, { value: "alongside", label: "Run beside it", title: "Each runs beside the main line to the basket" }]} />
        </Field>
      )}
      <div className="text-xs touch:text-[13px] text-zinc-400 mb-1.5">Each tee's line</div>
      <div className="rounded-[16px] bg-white/[0.06] overflow-hidden mb-3">
        {levels.map(l => {
          const main = l === mainLevel, ls = lineStyleOf(s, l, main, multi), own = s.lineStyles?.[l];
          const isOpen = open === l, changed = !!own && Object.keys(own).length > 0;
          const look0 = lineStyleOf({ ...s, lineStyles: undefined }, l, main, multi);
          const set = (patch: Partial<LineStyle>, history = true) => setLine(l, Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === look0[k as keyof LineStyle] ? undefined : v])), history);
          return (
            <div key={l} className="relative before:absolute before:left-[52px] before:right-0 before:top-0 before:h-px before:bg-white/[0.07] first:before:hidden" data-testid={`line-${l}`}>
              <div className="flex items-center hover:bg-white/[0.04]">
                <button className="flex-1 min-w-0 flex items-center gap-2.5 pl-3 py-2.5 text-left" aria-expanded={isOpen} onClick={e => { keep(e.currentTarget); setOpen(isOpen ? null : l); }} data-testid={`line-open-${l}`}>
                  <LineSample s={s} level={l} main={main} multi={multi} />
                  <span className="text-[13.5px] font-medium text-zinc-100 truncate">{nameOf(l)}</span>
                  {changed && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" role="img" aria-label="Changed" title="Changed" />}
                  <span className="ml-auto text-[12.5px] text-zinc-400 shrink-0">{main ? "Main" : ls.hidden ? "Hidden" : DASH_LABEL[ls.dash]}</span>
                </button>
                {/* (the main line always shows: its layout is the map's) */}
                {main ? <span className="w-9" /> : (
                  <button className="w-9 h-9 touch:w-11 touch:h-11 grid place-items-center text-zinc-300 hover:text-zinc-50" aria-label={ls.hidden ? `Show the ${nameOf(l)} line` : `Hide the ${nameOf(l)} line`} title={ls.hidden ? "Show its line" : "Hide its line"}
                    aria-pressed={ls.hidden} onClick={() => set({ hidden: !ls.hidden })} data-testid={`line-eye-${l}`}>
                    {ls.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
                <button className="pr-3 pl-1 py-2.5 touch:min-h-[44px]" aria-label={`${isOpen ? "Close" : "Open"} the ${nameOf(l)} line's settings`} aria-expanded={isOpen} onClick={e => { keep(e.currentTarget); setOpen(isOpen ? null : l); }}>
                  <ChevronRight size={15} className={`text-zinc-500 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
              </div>
              {isOpen && (
                <div className="px-3 pb-3.5 pt-0.5" data-testid={`line-settings-${l}`}>
                  <ColorInput label="Color" value={own?.color} onChange={(v, live) => set({ color: v }, !live)} onDone={commit} palettes={palette}
                    natural={{ on: () => setLine(l, { color: undefined }), style: { background: look0.color }, label: "As the look" }} testid="line-color" />
                  <Field label="Line">
                    <Segmented label="Line" value={ls.dash} onChange={v => set({ dash: v })} options={(["solid", "dashed", "dotted"] as const).map(v => ({ value: v, label: DASH_LABEL[v] }))} />
                  </Field>
                  <div className="grid grid-cols-2 gap-x-4">
                    <Slider label="Width" min={0.5} max={2} step={0.05} value={ls.width} format={v => `${Math.round(v * 100)}%`} onChange={v => set({ width: v }, false)} onDone={commit} />
                    <Slider label="Opacity" min={0.1} max={1} step={0.05} value={ls.opacity} format={v => `${Math.round(v * 100)}%`} onChange={v => set({ opacity: v }, false)} onDone={commit} />
                  </div>
                  <Field label="Outline">
                    <Segmented label="Outline" value={ls.outline} onChange={v => set({ outline: v })} options={[{ value: "soft", label: "Soft", title: "A warm edge and a soft light round it" }, { value: "dark", label: "Dark", title: "A dark outline, as Classic has" }, { value: "none", label: "None" }]} />
                  </Field>
                  <Toggle label="Shadow" checked={ls.shadow} onChange={v => set({ shadow: v })} />
                  <Toggle label="Arrowhead" checked={ls.arrow} onChange={v => set({ arrow: v })} />
                  {/* (the main line's length is Distances, above; another's shows where Distances is on) */}
                  {!main && <Toggle label="Distance" checked={ls.distance} onChange={v => set({ distance: v })} hint={s.distances ? undefined : "Shows with Distances on"} />}
                  {changed && <button className="mt-2 text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1 touch:py-2.5" onClick={() => setLine(l, { color: undefined, dash: undefined, width: undefined, opacity: undefined, outline: undefined, shadow: undefined, arrow: undefined, distance: undefined, hidden: undefined })} title="The line look's own again" data-testid="line-reset"><RotateCcw size={12} /> Reset</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
