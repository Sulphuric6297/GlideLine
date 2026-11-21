// A building's settings: what it is, its size and floor, its roof, its outside (a color scheme,
// its siding and roofing, each part's color) and its doors and windows. On a computer, parts of
// its panel; on a phone, settings in the glass bar's row (the same controls).
import type { CSSProperties, ReactNode } from "react";
import { useCourse, useEditor, updateItem } from "../state/course";
import { getView } from "../state/view";
import { removeAddOn, removeOpening } from "../state/actions";
import type { AddOn, Opening, BuildingType, CourseItem, FoundationKind, RoofingKind, RoofKind, SidingKind, StructureItem, WindowAmount, WindowStyle } from "../types";
import { ADDON_LABEL, ADDON_ROOF_LABEL, ADDON_SIZE, addAddOn, addOnLevels, addOnRoof, maxSetIn, frontWall, NATURAL, addOpening, buildingFrame, OPENING_LABEL, ownWall, wallName, buildingColors, colorName, DEFAULT_COLORS, heightForStories, HOUSE_COLORS, ROOF_COLORS, roofingOf, SCHEMES, schemeOf, schemePatch, sidingOf, storiesOf, windowAmountOf, windowStyleOf, type Scheme } from "../lib/buildingParts";
import { structureHeight, structureRoof } from "../lib/structures";
import { ROOF_SHADE_CSS, ROOFING_SCAN, SIDING_SCAN } from "../three/buildingLook";
import { ColorInput } from "./ColorSwatches";
import { fmtSize, IconPick } from "./Inspector";
import { Button, Field, FOCUS, Segmented, Slider } from "./ui";
import { AppWindow, CarFront, Copy, DoorOpen, Fence, Grid2x2, Home, Plus, Trash2, Warehouse } from "lucide-react";
import { toast } from "../state/toast";
import { ActRow } from "./mobile/GlassBar";
const ADD_ICON: Record<string, JSX.Element> = { window: <AppWindow size={18} />, door: <DoorOpen size={18} />, garage: <Warehouse size={18} />, porch: <Home size={18} />, carport: <CarFront size={18} />, deck: <Fence size={18} />, patio: <Grid2x2 size={18} /> };

export const BUILDING_TYPES: { value: BuildingType; label: string }[] = [
  { value: "house", label: "House" }, { value: "garage", label: "Garage" }, { value: "barn", label: "Barn" }, { value: "shed", label: "Shed" },
  { value: "restrooms", label: "Restrooms" }, { value: "clubhouse", label: "Clubhouse" }, { value: "church", label: "Church" }, { value: "school", label: "School" }, { value: "store", label: "Store" }
];
export const SIDINGS: { value: SidingKind; label: string }[] = [
  { value: "lap", label: "Lap siding" }, { value: "board", label: "Board" }, { value: "brick", label: "Brick" }, { value: "stone", label: "Stone" }, { value: "stucco", label: "Stucco" }, { value: "metal", label: "Metal" }
];
export const ROOFINGS: { value: RoofingKind; label: string }[] = [
  { value: "shingles", label: "Shingles" }, { value: "slate", label: "Slate" }, { value: "clay", label: "Clay tile" }, { value: "metal", label: "Metal" }, { value: "shakes", label: "Wood shakes" }
];
const STORIES = [{ value: "1", label: "1" }, { value: "1.5", label: "1½" }, { value: "2", label: "2" }, { value: "3", label: "3" }];
const FOUNDATIONS: { value: FoundationKind; label: string }[] = [{ value: "slab", label: "Slab" }, { value: "crawl", label: "Crawl space" }, { value: "raised", label: "Raised" }];
const AMOUNTS: { value: WindowAmount; label: string }[] = [{ value: "none", label: "None" }, { value: "few", label: "Few" }, { value: "even", label: "Even" }, { value: "many", label: "Many" }];
const STYLES: { value: WindowStyle; label: string }[] = [{ value: "plain", label: "Plain" }, { value: "grid", label: "Grid" }, { value: "shutters", label: "Shutters" }];

const base = import.meta.env.BASE_URL;
/** A scan's picture as it is (a tile's, Natural's). */
export const scanStyle = (scan: string): CSSProperties => ({ backgroundImage: `url(${base}buildings/${scan}.jpg)`, backgroundSize: "cover", backgroundPosition: "center" });
/** A color painted on a scan, for a swatch: the scan's light and dark over the color. */
export const paintedStyle = (scan: string) => (c: string): CSSProperties => ({ backgroundColor: c, backgroundImage: `url(${base}buildings/${scan}-detail.jpg)`, backgroundSize: "cover", backgroundBlendMode: "overlay" });
/** A roof's color on its roofing, as the 3D roof shows it (a roof reads darker than its paint chip). */
export const roofStyle = (scan: string) => (c: string): CSSProperties => ({ ...paintedStyle(scan)(c), filter: `brightness(${ROOF_SHADE_CSS})` });

/** A small house in a scheme's colors: its roof, walls, trim and door. */
export const SchemeIcon = ({ s, size = 40 }: { s: Scheme; size?: number }) => {
  const walls = s.walls ?? (s.siding === "brick" ? "#8b4a3a" : "#9a8a72"), roof = ROOF_COLORS.find(r => r.name === s.roof)?.color ?? "#555";
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 40 29" aria-hidden>
      <path d="M3 13 L20 3 L37 13 Z" fill={roof} stroke={s.trim} strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="7" y="13" width="26" height="14" fill={walls} stroke={s.trim} strokeWidth="1.2" />
      <rect x="17.5" y="18" width="5" height="9" fill={s.door} />
      <rect x="10" y="17" width="4.5" height="4.5" fill="#2a3440" stroke={s.trim} strokeWidth=".9" />
      <rect x="25.5" y="17" width="4.5" height="4.5" fill="#2a3440" stroke={s.trim} strokeWidth=".9" />
    </svg>
  );
};

/** Tiles of a scan each (siding, roofing): its picture and its name. */
function ScanTiles<T extends string>({ value, options, scanOf, onChange, label, testid }: { value: T; options: { value: T; label: string }[]; scanOf: (v: T) => string; onChange: (v: T) => void; label: string; testid: string }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }} role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.label} onClick={() => onChange(o.value)} data-testid={`${testid}-${o.value}`}
            className={`flex flex-col items-center gap-1 rounded-lg p-1 ${on ? "bg-white/[0.1] ring-1 ring-zinc-100" : "hover:bg-white/[0.06]"} ${FOCUS}`}>
            <span className="w-full aspect-square rounded-md ring-1 ring-white/20" style={scanStyle(scanOf(o.value))} />
            <span className={`text-[10.5px] leading-tight font-semibold text-center ${on ? "text-zinc-50" : "text-zinc-300"}`}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mt-3 pt-3 border-t border-white/[0.06]">
    <h3 className="text-xs font-semibold text-zinc-400 mb-2">{title}</h3>
    {children}
  </div>
);

/** A scheme picked: its colors and siding; the roof's color kept where it suits the scheme (read
 * from the photo, say), else the scheme's. */
const schemeOn = (st: StructureItem, s: Scheme) => {
  const roof = ROOF_COLORS.find(r => r.color === st.roofColor)?.name;
  return schemePatch(s, !!roof && s.roofs.includes(roof));
};

/** Its color scheme, as tiles. */
export function Schemes({ item, set }: { item: StructureItem; set: (p: Partial<StructureItem>) => void }) {
  const on = schemeOf(item)?.id;
  return (
    <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Color scheme" data-testid="building-schemes">
      {SCHEMES.map(s => (
        <button key={s.id} type="button" role="radio" aria-checked={on === s.id} onClick={() => set(schemeOn(item, s))} data-testid={`scheme-${s.id}`}
          className={`rounded-md border px-1 py-1.5 flex flex-col items-center gap-0.5 text-[11px] font-semibold ${on === s.id ? "border-zinc-100 bg-white/[0.1] text-zinc-50" : "border-white/[0.12] text-zinc-300 hover:border-zinc-500"} ${FOCUS}`}>
          <SchemeIcon s={s} />{s.name}
        </button>
      ))}
    </div>
  );
}

/** Each part's color: walls and roof painted on their scans (or Natural), the rest plain paint. */
export function BuildingColors({ item, set, commit }: { item: StructureItem; set: (p: Partial<StructureItem>, history?: boolean) => void; commit: () => void }) {
  const C = buildingColors(item);
  const wallScan = SIDING_SCAN[sidingOf(item)], roofScan = ROOFING_SCAN[roofingOf(item)];
  const flat = structureRoof(item) === "flat";
  const house = [{ title: "House colors", list: HOUSE_COLORS }];
  const row = (label: string, key: keyof StructureItem, value: string | undefined, usual: string | undefined, extra: Partial<Parameters<typeof ColorInput>[0]> = {}) => (
    <ColorInput key={label} label={label} value={value} name={value === undefined && usual === undefined ? "Natural" : colorName(value ?? usual)} testid={`color-${String(key)}`}
      onChange={(v, live) => set({ [key]: v } as Partial<StructureItem>, live ? false : true)} onDone={commit} palettes={house} {...extra} />
  );
  return (
    <div data-testid="building-colors">
      {row("Walls", "wallColor", C.walls, undefined, { swatch: paintedStyle(wallScan), natural: { on: () => set({ wallColor: NATURAL }), style: scanStyle(wallScan) } })}
      {row("Roof", "roofColor", C.roof, undefined, flat ? { palettes: [{ title: "Roof colors", list: ROOF_COLORS }] } : { palettes: [{ title: "Roof colors", list: ROOF_COLORS }], swatch: roofStyle(roofScan), natural: { on: () => set({ roofColor: NATURAL }), style: scanStyle(roofScan) } })}
      {row("Trim", "trimColor", C.trim, DEFAULT_COLORS.trim)}
      {row("Door", "doorColor", C.door, DEFAULT_COLORS.door)}
      {windowStyleOf(item) === "shutters" && row("Shutters", "shutterColor", C.shutters, DEFAULT_COLORS.shutters)}
      {row("Window frames", "frameColor", C.frames, C.trim)}
      {row("Foundation", "foundationColor", C.foundation, undefined, { swatch: paintedStyle("stone"), natural: { on: () => set({ foundationColor: NATURAL }), style: scanStyle("stone") } })}
    </div>
  );
}

/** A building's panel parts (under its kind). */
/** The colors' settings: a change to one takes away the import's "guessed". */
const COLOR_KEYS = ["wallColor", "roofColor", "trimColor", "frameColor", "doorColor", "shutterColor", "foundationColor", "siding", "roofing", "wallColors"];
const ownColors = (item: StructureItem, patch: Partial<StructureItem>): Partial<StructureItem> =>
  item.guessed?.includes("colors") && Object.keys(patch).some(k => COLOR_KEYS.includes(k)) ? { ...patch, guessed: item.guessed.filter(g => g !== "colors").length ? item.guessed.filter(g => g !== "colors") : undefined } : patch;

export function BuildingFields({ item }: { item: StructureItem }) {
  const u = useCourse(s => s.doc.units);
  const set = (patch: Partial<StructureItem>, history = true) => updateItem(item.id, ownColors(item, patch) as Partial<CourseItem>, history);
  const commit = () => useCourse.getState().commit();
  const roof = structureRoof(item), H = structureHeight(item), stories = storiesOf(item);
  return (
    <div data-testid="building-fields">
      <BuildingPart item={item} />
      <Field label="Type" help="buildings">
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Building type" data-testid="building-type">
          {BUILDING_TYPES.map(t => {
            const on = (item.buildingType ?? "house") === t.value;
            return <button key={t.value} type="button" role="radio" aria-checked={on} onClick={() => set({ buildingType: t.value === "house" ? undefined : t.value })} className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold ${on ? "border-zinc-100 bg-white/[0.1] text-zinc-50" : "border-white/[0.12] text-zinc-300 hover:border-zinc-500"} ${FOCUS}`}>{t.label}</button>;
          })}
        </div>
      </Field>
      <Part title="Size">
        <Field label="Stories"><Segmented label="Stories" value={String(item.stories ?? stories)} onChange={v => { const n = Number(v); set({ stories: n, height: heightForStories(n) }); }} options={STORIES} /></Field>
        <Slider label="Wall height" min={6} max={Math.max(40, H)} step={0.5} value={H} onChange={v => set({ height: v, stories: undefined }, false)} onDone={commit} format={v => `${fmtSize(v, u)} to the eaves`} />
        <Field label="Foundation"><Segmented label="Foundation" value={item.foundation ?? "slab"} onChange={v => set({ foundation: v === "slab" ? undefined : v })} options={FOUNDATIONS} /></Field>
      </Part>
      <Part title="Roof">
        <IconPick label="Roof" value={roof} onChange={v => set({ roof: v as RoofKind })} options={[{ value: "gable", label: "Gable" }, { value: "hip", label: "Hip" }, { value: "pyramid", label: "Pyramid" }, { value: "shed", label: "Shed" }, { value: "flat", label: "Flat" }]} />
        {roof !== "flat" && <div className="mt-3"><Slider label="Slope" min={2} max={14} step={1} value={Math.round((item.roofPitch ?? 0.5) * 12)} onChange={v => set({ roofPitch: v / 12 }, false)} onDone={commit} format={v => `${v} in 12`} /></div>}
      </Part>
      <Part title="Outside">
        {item.guessed?.includes("colors") && <p className="text-[11.5px] text-zinc-400 mb-2" data-testid="colors-guessed">Picked on import to go with its roof on the photo.</p>}
        <Field label="Color scheme"><Schemes item={item} set={set} /></Field>
        <Field label="Siding"><ScanTiles label="Siding" testid="building-siding" value={sidingOf(item)} options={SIDINGS} scanOf={v => SIDING_SCAN[v]} onChange={v => set({ siding: v === "lap" ? undefined : v })} /></Field>
        {roof !== "flat" && <Field label="Roofing"><ScanTiles label="Roofing" testid="building-roofing" value={roofingOf(item)} options={ROOFINGS} scanOf={v => ROOFING_SCAN[v]} onChange={v => set({ roofing: v === "shingles" ? undefined : v })} /></Field>}
        <Field label="Colors"><BuildingColors item={item} set={set} commit={commit} /></Field>
      </Part>
      <Part title="Doors and windows">
        <Field label="Windows"><Segmented label="Windows" value={windowAmountOf(item)} onChange={v => set({ windows: v === "even" ? undefined : v })} options={AMOUNTS} /></Field>
        <Field label="Window style"><Segmented label="Window style" value={windowStyleOf(item)} onChange={v => set({ windowStyle: v === "grid" ? undefined : v })} options={STYLES} /></Field>
      </Part>
      <Part title="Porches and more">
        {(item.addOns ?? []).map(a => (
          <div key={a.id} className="flex items-center gap-2 py-1.5 border-t border-white/[0.06] first:border-t-0">
            <button type="button" className={`min-w-0 flex-1 text-left ${FOCUS}`} onClick={() => setPart({ wall: a.wall, addOn: a.id })} data-testid="addon-row">
              <div className="text-xs text-zinc-100">{ADDON_LABEL[a.kind]}</div>
              <div className="text-[11px] text-zinc-400">{wallName(item, frameOf(item), a.wall)} · {a.width} × {a.depth} ft</div>
            </button>
            <button type="button" className={`text-[11px] text-zinc-400 hover:text-zinc-100 ${FOCUS}`} onClick={() => removeAddOn(item.id, a.id)}>Remove</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {ADDON_KINDS.map(k => <Button key={k.value} small onClick={() => addAddOnToWall(item, frontOf(item), k.value)} testid={`add-addon-${k.value}`}><Plus size={13} /> {k.label}</Button>)}
        </div>
      </Part>
    </div>
  );
}

/** The same settings for the phone's bar: one each, its control opening from the row. */
export function buildingSettings(item: StructureItem, set0: (patch: Partial<StructureItem>, history?: boolean) => void, commit: () => void, units: Parameters<typeof fmtSize>[1]) {
  const set = (patch: Partial<StructureItem>, history?: boolean) => set0(ownColors(item, patch), history);
  const roof = structureRoof(item), H = structureHeight(item);
  const C = buildingColors(item);
  const label = <T extends string>(list: { value: T; label: string }[], v: T) => list.find(o => o.value === v)?.label ?? v;
  const scheme = schemeOf(item);
  return [
    { id: "btype", name: "Type", value: label(BUILDING_TYPES, item.buildingType ?? "house"), control: <Segmented label="Building type" value={item.buildingType ?? "house"} onChange={v => set({ buildingType: v === "house" ? undefined : v })} options={BUILDING_TYPES} /> },
    { id: "stories", name: "Stories", value: STORIES.find(s => Number(s.value) === storiesOf(item))?.label ?? String(storiesOf(item)), control: <Segmented label="Stories" value={String(item.stories ?? storiesOf(item))} onChange={v => { const n = Number(v); set({ stories: n, height: heightForStories(n) }); }} options={STORIES} /> },
    { id: "roof", name: "Roof", value: roof[0].toUpperCase() + roof.slice(1), wide: true, control: <div className="p-1.5"><IconPick label="Roof" value={roof} onChange={v => set({ roof: v as RoofKind })} options={[{ value: "gable", label: "Gable" }, { value: "hip", label: "Hip" }, { value: "pyramid", label: "Pyramid" }, { value: "shed", label: "Shed" }, { value: "flat", label: "Flat" }]} />{roof !== "flat" && <div className="mt-3"><Slider label="Slope" min={2} max={14} step={1} value={Math.round((item.roofPitch ?? 0.5) * 12)} onChange={v => set({ roofPitch: v / 12 }, false)} onDone={commit} format={v => `${v} in 12`} /></div>}</div> },
    { id: "colors", name: "Colors", value: <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/40" style={C.walls ? paintedStyle(SIDING_SCAN[sidingOf(item)])(C.walls) : scanStyle(SIDING_SCAN[sidingOf(item)])} />{scheme?.name ?? colorName(C.walls)}</span>, wide: true, control: <div className="p-1.5"><Field label="Color scheme"><Schemes item={item} set={set} /></Field><BuildingColors item={item} set={set} commit={commit} /></div> },
    { id: "siding", name: "Siding", value: label(SIDINGS, sidingOf(item)), wide: true, control: <div className="p-1.5"><ScanTiles label="Siding" testid="building-siding" value={sidingOf(item)} options={SIDINGS} scanOf={v => SIDING_SCAN[v]} onChange={v => set({ siding: v === "lap" ? undefined : v })} /></div> },
    ...(roof !== "flat" ? [{ id: "roofing", name: "Roofing", value: label(ROOFINGS, roofingOf(item)), wide: true, control: <div className="p-1.5"><ScanTiles label="Roofing" testid="building-roofing" value={roofingOf(item)} options={ROOFINGS} scanOf={v => ROOFING_SCAN[v]} onChange={v => set({ roofing: v === "shingles" ? undefined : v })} /></div> }] : []),
    { id: "height", name: "Walls", value: fmtSize(H, units), wide: true, control: <div className="p-2"><Slider label="Wall height" min={6} max={Math.max(40, H)} step={0.5} value={H} onChange={v => set({ height: v, stories: undefined }, false)} onDone={commit} format={v => `${fmtSize(v, units)} to the eaves`} /></div> },
    { id: "foundation", name: "Foundation", value: label(FOUNDATIONS, item.foundation ?? "slab"), control: <Segmented label="Foundation" value={item.foundation ?? "slab"} onChange={v => set({ foundation: v === "slab" ? undefined : v })} options={FOUNDATIONS} /> },
    { id: "windows", name: "Windows", value: label(AMOUNTS, windowAmountOf(item)), control: <Segmented label="Windows" value={windowAmountOf(item)} onChange={v => set({ windows: v === "even" ? undefined : v })} options={AMOUNTS} /> },
    { id: "wstyle", name: "Window style", value: label(STYLES, windowStyleOf(item)), control: <Segmented label="Window style" value={windowStyleOf(item)} onChange={v => set({ windowStyle: v === "grid" ? undefined : v })} options={STYLES} /> },
    { id: "addons", name: "Porches and more", value: item.addOns?.length ? `${item.addOns.length}` : "Add", wide: true, control: (
      <div className="p-1.5">
        {(item.addOns ?? []).map(a => (
          <button key={a.id} type="button" className={`w-full text-left px-2 py-2.5 rounded-[12px] hover:bg-white/[0.06] ${FOCUS}`} onClick={() => setPart({ wall: a.wall, addOn: a.id })}>
            <div className="text-[14px] text-zinc-100 font-semibold">{ADDON_LABEL[a.kind]}</div>
            <div className="text-[12px] text-zinc-400">{wallName(item, frameOf(item), a.wall)} · {a.width} × {a.depth} ft</div>
          </button>
        ))}
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {ADDON_KINDS.map(k => <Button key={k.value} small onClick={() => addAddOnToWall(item, frontOf(item), k.value)}><Plus size={13} /> {k.label}</Button>)}
        </div>
      </div>) }
  ];
}

// ------------------------------------------------------------------ a wall, a door or a window picked

/** The building as it stands on the map's ground. */
const frameOf = (st: StructureItem) => buildingFrame(st, (x, y) => getView()?.standGround(x, y) ?? 0);
/** The wall its front door's on (as set, or as it's laid out). */
const frontOf = (st: StructureItem) => { const F = frameOf(st); return F.front ?? frontWall(st, F.walls.map(w => w.a)); };
const setPart = (part: { wall: number; opening?: string; addOn?: string } | null) => useEditor.getState().set({ buildingPart: part });
const ADDON_KINDS: { value: AddOn["kind"]; label: string }[] = [{ value: "porch", label: "Porch" }, { value: "deck", label: "Deck" }, { value: "carport", label: "Carport" }, { value: "patio", label: "Patio" }];

/** A porch's shape and heights as it stands on the map's ground. */
export const levelsOf = (st: StructureItem, a: AddOn) => addOnLevels(frameOf(st), a, (x, y) => getView()?.standGround(x, y) ?? 0);
const PLACES: { value: "out" | "in"; label: string }[] = [{ value: "out", label: "Out from the wall" }, { value: "in", label: "Set into the house" }];
const ROOFS: { value: "own" | "none"; label: string }[] = [{ value: "own", label: "Own roof" }, { value: "none", label: "No roof" }];
const STEP_COUNTS: { value: number; label: string }[] = [{ value: 0, label: "None" }, { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }];

/** Its steps, as they stand (each side and where along it). */
const stepsOf = (st: StructureItem, a: AddOn) => levelsOf(st, a).steps.map(e => ({ side: e.side, at: e.at }));
/** Steps put on it at a side's spot (the menu's Put steps here), or n of them in all (more go on
 * its front where it's clearest; fewer drop the last). */
export const putSteps = (st: StructureItem, aid: string, side: number, at: number) => {
  const a = st.addOns?.find(x => x.id === aid);
  if (a) setAddOn(st, aid, { steps: [...stepsOf(st, a), { side, at: Math.round(at * 100) / 100 }] });
};
export const removeSteps = (st: StructureItem, aid: string, k: number) => {
  const a = st.addOns?.find(x => x.id === aid);
  if (a) setAddOn(st, aid, { steps: stepsOf(st, a).filter((_, j) => j !== k) });
};
const countSteps = (st: StructureItem, a: AddOn, n: number) => {
  const list = stepsOf(st, a).slice(0, n);
  const L = levelsOf(st, a), front = L.sides.find(x => x.i === 1) ?? L.sides[0];
  while (front && list.length < n) {
    // (the spot on its front farthest from the steps there)
    const taken = list.filter(e => e.side === front.i).map(e => e.at);
    let best = 0.5, far = -1;
    for (let t = 0.15; t <= 0.851; t += 0.05) { const d = Math.min(1, ...taken.map(x => Math.abs(x - t))); if (d > far) { far = d; best = t; } }
    list.push({ side: front.i, at: Math.round(best * 100) / 100 });
  }
  setAddOn(st, a.id, { steps: list });
};
/** A railing taken off one side of it, or put back. */
export const toggleRail = (st: StructureItem, aid: string, side: number) => {
  const a = st.addOns?.find(x => x.id === aid);
  if (!a) return;
  const off = new Set(a.noRail ?? []);
  if (off.has(side)) off.delete(side); else off.add(side);
  setAddOn(st, aid, { noRail: off.size ? [...off].sort() : undefined, ...(a.railing === false ? { railing: true } : {}) });
};
const setAddOn = (st: StructureItem, aid: string, patch: Partial<AddOn>, history = true) =>
  updateItem(st.id, { addOns: (st.addOns ?? []).map(a => (a.id === aid ? { ...a, ...patch } : a)) } as Partial<CourseItem>, history);

// (a porch copied, to put on another wall)
let clip: AddOn | null = null;
export const copyAddOn = (a: AddOn) => { clip = { ...a }; toast(`${ADDON_LABEL[a.kind]} copied. Right-click a wall to put it there.`); };
export const clipped = () => clip;
export const pasteAddOn = (st: StructureItem, wall: number, near?: number) => (clip ? addAddOnToWall(st, wall, clip.kind, near, clip) : false);

/** A picked porch's (carport's, deck's, patio's) settings, as the Security Camera Planner's: its
 * kind, roof (the house's, its own, none) and its slope, floor height, railing, steps, size; Copy,
 * Remove. `rows`: as the phone's bar's rows. */
function addOnControls(item: StructureItem, addOn: AddOn, units: Parameters<typeof fmtSize>[1]) {
  const set = (patch: Partial<AddOn>, history = true) => setAddOn(item, addOn.id, patch, history);
  const commit = () => useCourse.getState().commit();
  const F = frameOf(item), len = F.walls[addOn.wall]?.len ?? 40, L = levelsOf(item, addOn);
  const roofKind = L.roofKind, deepest = maxSetIn(F, addOn.wall);
  const ft = (v: number) => fmtSize(v, units);
  const maxUp = Math.max(1, Math.floor((roofKind === "none" ? F.eave - L.gRef : F.eave - 8 - L.gRef) * 2) / 2);
  const rows: { id: string; name: string; value: ReactNode; control?: ReactNode; wide?: boolean; run?: () => void; icon?: ReactNode; testid?: string }[] = [
    { id: "akind", name: "Kind", value: ADDON_LABEL[addOn.kind], control: <Segmented label="Kind" value={addOn.kind} onChange={v => set({ kind: v, depth: roofKind === "house" ? Math.min(ADDON_SIZE[v].depth, deepest) : ADDON_SIZE[v].depth, floor: undefined, steps: undefined, roof: undefined })} options={ADDON_KINDS} /> },
    // (out from the wall, or set into the house under its roof, the wall set back behind it)
    ...(deepest >= 4 || roofKind === "house" ? [{ id: "aplace", name: "Placement", value: roofKind === "house" ? "Set in" : "Out", control: <Segmented label="Placement" value={roofKind === "house" ? "in" : "out"} onChange={v => set(v === "in" ? { roof: "house", depth: Math.max(4, Math.min(addOn.depth, deepest)), steps: undefined, noRail: undefined } : { roof: undefined, steps: undefined, noRail: undefined })} options={PLACES} /> }] : []),
    ...(roofKind !== "house" ? [{ id: "aroof", name: "Roof", value: ADDON_ROOF_LABEL[roofKind], control: <Segmented label="Roof" value={roofKind as "own" | "none"} onChange={v => set({ roof: v === addOnRoof({ ...addOn, roof: undefined }) ? undefined : v })} options={ROOFS} /> }] : []),
    ...(roofKind === "own" ? [{ id: "aslope", name: "Roof slope", value: `${addOn.pitch ?? 3} in 12`, wide: true, control: <div className="p-2"><Slider label="Roof slope" min={1} max={6} step={0.5} value={addOn.pitch ?? 3} onChange={v => set({ pitch: v === 3 ? undefined : v }, false)} onDone={commit} format={v => `${v} in 12`} /></div> }] : []),
    { id: "afloor", name: "Floor", value: L.level ? `${ft(Math.max(0, Math.round(L.up * 2) / 2))} up` : "On the ground", wide: true, control: <div className="p-2"><Slider label="Floor height" min={0} max={maxUp} step={0.5} value={L.level ? Math.max(0, Math.min(maxUp, Math.round(L.up * 2) / 2)) : 0} onChange={v => set({ floor: L.onGround && v < 0.5 ? undefined : v }, false)} onDone={commit} format={v => (L.onGround && v < 0.5 ? "On the ground" : `${ft(v)} up`)} /></div> },
    ...(L.level && L.up >= 0.5 ? [
      { id: "arail", name: "Railing", value: L.rail ? (addOn.noRail?.length ? "Some sides" : "On") : "Off", control: <Segmented label="Railing" value={L.rail ? "on" : "off"} onChange={v => set({ railing: v === "on", noRail: undefined })} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} /> },
      { id: "asteps", name: "Steps", value: L.steps.length ? String(L.steps.length) : "None", control: <Segmented label="Steps" value={Math.min(3, L.steps.length)} onChange={v => countSteps(item, addOn, v)} options={STEP_COUNTS} /> }
    ] : []),
    { id: "awidth", name: "Width", value: ft(addOn.width), wide: true, control: <div className="p-2"><Slider label="Width" min={4} max={Math.max(4, len - 2)} step={0.5} value={addOn.width} onChange={v => set({ width: v, at: Math.min(len - v / 2 - 1, Math.max(v / 2 + 1, addOn.at)) }, false)} onDone={commit} format={v => `${ft(v)} along the wall`} /></div> },
    { id: "adepth", name: "Depth", value: ft(L.D), wide: true, control: <div className="p-2"><Slider label="Depth" min={4} max={roofKind === "house" ? Math.max(4, deepest) : 40} step={0.5} value={L.D} onChange={v => set({ depth: v }, false)} onDone={commit} format={v => (roofKind === "house" ? `${ft(v)} in` : `${ft(v)} out`)} /></div> },
    { id: "acopy", name: "Copy", value: "To another wall", icon: <Copy size={16} />, run: () => copyAddOn(addOn), testid: "addon-copy" },
    { id: "aremove", name: "Remove", value: ADDON_LABEL[addOn.kind], icon: <Trash2 size={16} />, run: () => removeAddOn(item.id, addOn.id), testid: "addon-remove" }
  ];
  return rows;
}

function AddOnFields({ item, addOn }: { item: StructureItem; addOn: AddOn }) {
  const units = useCourse(s => s.doc.units);
  const rows = addOnControls(item, addOn, units);
  return (
    <div data-testid="addon-fields">
      {rows.filter(r => r.control).map(r => (r.wide ? <div key={r.id}>{r.control}</div> : <Field key={r.id} label={r.name}>{r.control}</Field>))}
      <div className="mt-2 flex gap-1.5">
        <Button small onClick={() => copyAddOn(addOn)} testid="addon-copy"><Copy size={13} /> Copy</Button>
        <Button small tone="danger" onClick={() => removeAddOn(item.id, addOn.id)} testid="addon-remove"><Trash2 size={13} /> Remove</Button>
      </div>
    </div>
  );
}
const KINDS: { value: Opening["kind"]; label: string }[] = [{ value: "window", label: "Window" }, { value: "door", label: "Door" }, { value: "garage", label: "Garage door" }];
/** The usual size for a kind (changing a window to a door, say). */
const sizeOf = (k: Opening["kind"]) => (k === "window" ? { width: 3, height: 4.75, sill: 2.75 } : k === "door" ? { width: 3.1, height: 6.9, sill: undefined } : { width: 9, height: 7.25, sill: undefined });

/** A door or window put on the picked wall (picked, ready to move). */
export const addToWall = (st: StructureItem, wall: number, kind: Opening["kind"], near?: number) => {
  const got = addOpening(st, frameOf(st), wall, kind, near);
  if (!got) return false;
  updateItem(st.id, { openings: got.openings, handWalls: [...new Set([...(st.handWalls ?? []), wall])] } as Partial<CourseItem>);
  setPart({ wall, opening: got.id });
  return true;
};

/** A porch, carport, deck or patio put against the wall (picked, ready to move or size). */
export const addAddOnToWall = (st: StructureItem, wall: number, kind: AddOn["kind"], near?: number, like?: AddOn) => {
  const got = addAddOn(st, frameOf(st), wall, kind, near, like);
  if (!got) return false;
  updateItem(st.id, { addOns: got.addOns } as Partial<CourseItem>);
  setPart({ wall, addOn: got.id });
  return true;
};

/** A door or window laid out by itself taken off (its wall's others kept as they stand). */
export const removeLaidOut = (st: StructureItem, wall: number, at: number) => {
  const list = ownWall(st, frameOf(st), wall);
  const o = list.find(q => q.wall === wall && Math.abs(q.at - at) < 0.01);
  if (!o) return;
  updateItem(st.id, { openings: list.filter(q => q.id !== o.id), handWalls: [...new Set([...(st.handWalls ?? []), wall])] } as Partial<CourseItem>);
  setPart({ wall });
};
/** What a laid-out door or window at a spot is (for its menu row). */
export const laidOutKind = (st: StructureItem, wall: number, at: number) => frameOf(st).placed.find(q => q.wall === wall && q.auto && Math.abs(q.at - at) < 0.01)?.kind;

/** A picked wall's or opening's name (for its heading and the phone's bar). */
export const partName = (st: StructureItem, part: { wall: number; opening?: string; addOn?: string }) => {
  const ad = part.addOn && st.addOns?.find(q => q.id === part.addOn);
  if (ad) return ADDON_LABEL[ad.kind];
  const o = part.opening && st.openings?.find(q => q.id === part.opening);
  return o ? OPENING_LABEL[o.kind] : wallName(st, frameOf(st), part.wall);
};

/** The picked wall's parts: add a door or window, make it the front, its own color, its doors and
 * windows (each to pick or remove), and back to laid out by itself. */
function WallFields({ item, wall }: { item: StructureItem; wall: number }) {
  const F = frameOf(item);
  const set = (patch: Partial<StructureItem>, history = true) => updateItem(item.id, patch as Partial<CourseItem>, history);
  const commit = () => useCourse.getState().commit();
  const mine = F.placed.filter(o => o.wall === wall);
  const own = (item.handWalls ?? []).includes(wall) || (item.openings ?? []).some(o => o.wall === wall);
  const front = (F.front ?? frontWall(item, F.walls.map(x => x.a))) === wall;
  const wallScan = SIDING_SCAN[sidingOf(item)];
  const ownColor = item.wallColors?.[wall];
  const C = buildingColors(item);
  return (
    <div data-testid="wall-fields">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {KINDS.map(k => <Button key={k.value} small onClick={() => addToWall(item, wall, k.value)} testid={`add-${k.value}`}><Plus size={13} /> {k.label}</Button>)}
      </div>
      {!front && <div className="mb-3"><Button small tone="ghost" onClick={() => set({ front: wall })} testid="wall-front">Make this the front</Button></div>}
      <ColorInput label="Color" value={ownColor} name={ownColor ? colorName(ownColor) : "As the walls"} testid="color-thiswall"
        onChange={(v, live) => set({ wallColors: { ...item.wallColors, [wall]: v } }, !live)} onDone={commit} palettes={[{ title: "House colors", list: HOUSE_COLORS }]} swatch={paintedStyle(wallScan)}
        natural={{ on: () => { const w = { ...item.wallColors }; delete w[wall]; set({ wallColors: Object.keys(w).length ? w : undefined }); }, style: C.walls ? paintedStyle(wallScan)(C.walls) : scanStyle(wallScan) }} />
      <div className="mt-2" data-testid="wall-openings">
        {mine.length === 0 && <p className="text-[11.5px] text-zinc-400">No doors or windows.</p>}
        {mine.map((o, i) => (
          <div key={o.id ?? `auto${i}`} className="flex items-center gap-2 py-1.5 border-t border-white/[0.06] first:border-t-0">
            <button type="button" className={`min-w-0 flex-1 text-left ${FOCUS}`} onClick={() => {
              // (a laid-out one: the wall's made its own first, as it stands)
              if (!o.id) { const list = ownWall(item, F, wall); const got = list.find(q => q.wall === wall && Math.abs(q.at - o.at) < 0.01); set({ openings: list, handWalls: [...new Set([...(item.handWalls ?? []), wall])] }, false); setPart({ wall, opening: got?.id }); }
              else setPart({ wall, opening: o.id });
            }}>
              <div className="text-xs text-zinc-100">{OPENING_LABEL[o.kind]}</div>
              <div className="text-[11px] text-zinc-400">{Math.round(o.width * 2) / 2} × {Math.round(o.height * 2) / 2} ft{o.story ? ` · story ${o.story + 1}` : ""}</div>
            </button>
            {o.id && <button type="button" className={`text-[11px] text-zinc-400 hover:text-zinc-100 ${FOCUS}`} onClick={() => removeOpening(item.id, o.id!)}>Remove</button>}
          </div>
        ))}
      </div>
      {own && <div className="mt-2"><Button small tone="ghost" onClick={() => { set({ openings: (item.openings ?? []).filter(o => o.wall !== wall), handWalls: (item.handWalls ?? []).filter(w => w !== wall) }); setPart({ wall }); }} testid="wall-auto">Lay them out evenly</Button></div>}
    </div>
  );
}

/** The picked door's or window's settings: its kind, size and (a window's) sill; Remove. */
function OpeningFields({ item, opening }: { item: StructureItem; opening: Opening }) {
  const set = (patch: Partial<Opening>, history = true) => updateItem(item.id, { openings: (item.openings ?? []).map(o => (o.id === opening.id ? { ...o, ...patch } : o)) } as Partial<CourseItem>, history);
  const commit = () => useCourse.getState().commit();
  return (
    <div data-testid="opening-fields">
      <Field label="Kind"><Segmented label="Kind" value={opening.kind} onChange={v => { const z = sizeOf(v); set({ kind: v, width: z.width, height: z.height, sill: z.sill, story: v === "window" ? opening.story : 0 }); }} options={KINDS} /></Field>
      <Slider label="Width" min={1.5} max={opening.kind === "garage" ? 20 : 12} step={0.25} value={opening.width} onChange={v => set({ width: v }, false)} onDone={commit} format={v => `${v} ft`} />
      <Slider label="Height" min={1.5} max={opening.kind === "garage" ? 14 : 10} step={0.25} value={opening.height} onChange={v => set({ height: v }, false)} onDone={commit} format={v => `${v} ft`} />
      {opening.kind === "window" && <Slider label="Sill height" min={0.5} max={8} step={0.25} value={opening.sill ?? 3} onChange={v => set({ sill: v }, false)} onDone={commit} format={v => `${v} ft off the floor`} />}
      <div className="mt-2"><Button small tone="danger" onClick={() => removeOpening(item.id, opening.id)} testid="opening-remove"><Trash2 size={13} /> Remove</Button></div>
    </div>
  );
}

/** The picked wall's or opening's part of the panel, at its top: its name, back to the whole
 * building (or its wall), and its settings. */
export function BuildingPart({ item }: { item: StructureItem }) {
  const part = useEditor(e => e.buildingPart);
  if (!part) return null;
  const opening = part.opening ? item.openings?.find(o => o.id === part.opening) : undefined;
  if (part.opening && !opening) return null;
  const addOn = part.addOn ? item.addOns?.find(a => a.id === part.addOn) : undefined;
  if (part.addOn && !addOn) return null;
  return (
    <div className="mb-3 rounded-xl bg-white/[0.05] ring-1 ring-white/10 p-2.5" data-testid="building-part">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[13px] font-semibold text-zinc-50" data-testid="building-part-name">{partName(item, part)}</span>
        <button type="button" className={`ml-auto text-[11px] text-orange-300 hover:text-orange-200 ${FOCUS}`} onClick={() => setPart(opening ? { wall: part.wall } : null)} data-testid="building-part-back">{opening ? "Its wall" : "Whole building"}</button>
      </div>
      {addOn ? <AddOnFields item={item} addOn={addOn} /> : opening ? <OpeningFields item={item} opening={opening} /> : <WallFields item={item} wall={part.wall} />}
    </div>
  );
}

/** The picked wall's or opening's settings for the phone's bar (the same as its panel part). */
export function buildingPartSettings(item: StructureItem, part: { wall: number; opening?: string; addOn?: string }) {
  const opening = part.opening ? item.openings?.find(o => o.id === part.opening) : undefined;
  const commit = () => useCourse.getState().commit();
  const addOn = part.addOn ? item.addOns?.find(a => a.id === part.addOn) : undefined;
  if (addOn) return addOnControls(item, addOn, useCourse.getState().doc.units).map(r => (r.wide ? r : r.run ? r : { ...r, control: <div className="p-1.5">{r.control}</div> }));
  if (opening) {
    const set = (patch: Partial<Opening>, history = true) => updateItem(item.id, { openings: (item.openings ?? []).map(o => (o.id === opening.id ? { ...o, ...patch } : o)) } as Partial<CourseItem>, history);
    return [
      { id: "okind", name: "Kind", value: OPENING_LABEL[opening.kind], control: <Segmented label="Kind" value={opening.kind} onChange={v => { const z = sizeOf(v); set({ kind: v, width: z.width, height: z.height, sill: z.sill, story: v === "window" ? opening.story : 0 }); }} options={KINDS} /> },
      { id: "owidth", name: "Width", value: `${opening.width} ft`, wide: true, control: <div className="p-2"><Slider label="Width" min={1.5} max={opening.kind === "garage" ? 20 : 12} step={0.25} value={opening.width} onChange={v => set({ width: v }, false)} onDone={commit} format={v => `${v} ft`} /></div> },
      { id: "oheight", name: "Height", value: `${opening.height} ft`, wide: true, control: <div className="p-2"><Slider label="Height" min={1.5} max={opening.kind === "garage" ? 14 : 10} step={0.25} value={opening.height} onChange={v => set({ height: v }, false)} onDone={commit} format={v => `${v} ft`} /></div> },
      ...(opening.kind === "window" ? [{ id: "osill", name: "Sill", value: `${opening.sill ?? 3} ft`, wide: true, control: <div className="p-2"><Slider label="Sill height" min={0.5} max={8} step={0.25} value={opening.sill ?? 3} onChange={v => set({ sill: v }, false)} onDone={commit} format={v => `${v} ft off the floor`} /></div> }] : []),
      { id: "oremove", name: "Remove", value: OPENING_LABEL[opening.kind], icon: <Trash2 size={16} />, run: () => removeOpening(item.id, opening.id), testid: "opening-remove" }
    ];
  }
  const w = part.wall;
  return [
    // (one Add, its list: on this wall, a door or window in its widest clear stretch, a porch or
    // the like in its middle)
    { id: "add", name: "Add", value: "Window, door, porch…", control: (
      <div className="flex flex-col gap-0.5" data-testid="wall-add">
        {KINDS.map(k => <ActRow key={k.value} label={k.label} icon={ADD_ICON[k.value]} onClick={() => { addToWall(item, w, k.value); }} testid={`add-${k.value}`} />)}
        {ADDON_KINDS.map(k => <ActRow key={k.value} label={k.label} icon={ADD_ICON[k.value]} onClick={() => { addAddOnToWall(item, w, k.value); }} testid={`add-addon-${k.value}`} />)}
      </div>) },
    { id: "wall", name: "This wall", value: "Color, doors, windows", wide: true, control: <div className="p-1.5"><WallFields item={item} wall={w} /></div> }
  ];
}
