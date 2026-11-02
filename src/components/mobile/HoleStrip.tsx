// A hole or a thing picked on a phone: every one of its settings, for the glass bar's row
// (mobile/GlassBar). Each has its word and what it's set to; tapped, it grows its control out of
// the button: a short menu of choices, a dial for a number (dragged sideways under a fixed needle,
// the map following live), a field over the keyboard, or what's deeper in the same menu. The
// everyday ones come first and the rarer ones further along, so nothing is left to a long panel
// over the map.
import { useRef, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { AMENITY_KINDS, AMENITY_ORDER, AREA_KINDS, AREA_ORDER, FIELD_KINDS, LINE_KINDS, PATH_SURFACES, PIN_POSITIONS, STRUCTURE_KINDS, STRUCTURE_ORDER, TEE_LEVELS, TEE_ORDER, TEE_SURFACES, compassPoint } from "../../constants";
import { holeBaskets, holeLabel, holeTees, teeAim } from "../../lib/course";
import { holeStats } from "../../lib/holeStats";
import { MARKED_FIELDS, fieldKindOf, isBallField } from "../../lib/fields";
import { structureHeight, structureWidth } from "../../lib/structures";
import { standShape } from "../../lib/treeMix";
import { fmtDist } from "../../lib/units";
import { addHoleOb, nextHomeCorner, obChoiceOf, pinsFull, select, setFieldKind, setFieldPlay, setLineKind, setPinPosition, setTeeLevel, shareBasket, startAnotherPin, startAnotherTee, startHoleToBasket, teesFull } from "../../state/actions";
import { updateHole, updateItem, useCourse, useEditor } from "../../state/course";
import type { AmenityItem, AmenityKind, AreaItem, AreaKind, BasketItem, CourseItem, FieldKind, Hole, LabelItem, LineItem, LineKind, MandoItem, PathSurface, StructureItem, StructureKind, TeeItem, TeeSurface, TreeItem } from "../../types";
import { BRUSH_LEVELS, bendHole, FENCE_STYLES, FieldLooks, FieldParts, GrowsPick, HoleInspector, HoleNumberInput, HoleTrees, ObPick, PLAY_OPTIONS, RULE_AREAS, StandSpecies, StructureLook, SurfacePick, THICK, TurnButtons, densityFor, growsOf, growsText, hasFieldLooks, hasParts, thickOf, useHoleTrees, amenityIcon, builtIcon, fieldKindOptions, fmtSize, fmtTurn, hasObChoice, heightLabel, homeText, obOptions } from "../Inspector";
import { HoleChips } from "../ApplyToHoles";
import { HoleFlight } from "../FlyoverSettings";
import { OnSiteButton } from "../OnSite";
import { useTouch } from "../useLayout";
import { canShowLocation, useGps } from "../../state/gps";
import { MoveHere } from "../PlaceByGps";
import { KindTiles, areaPicture, bigIcon, linePicture } from "./KindTiles";
import { TREE_KINDS, speciesNow } from "../TreeSettings";
import { SPECIES } from "../../three/ezShapes";
import { ChipPick, ColorInput, OnlyGroup, PickRow, Segmented, Select, TextInput, Toggle } from "../ui";
import { ActRow, type BarSetting } from "./GlassBar";

/** A dial: drag it sideways (or the arrow keys) to change a number; the needle stays put and the
 * marks slide under it. `onChange` live while dragging, `onDone` once let go. */
export function Dial({ value, min, max, step, label, format, onChange, onDone }: { value: number; min: number; max: number; step: number; label: string; format: (v: number) => string; onChange: (v: number) => void; onDone: () => void }) {
  const PX = 9; // a step per this many pixels
  const drag = useRef<{ x: number; v: number } | null>(null);
  const clampV = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // (dragged left: the marks move left, the number goes up, as on a tape)
    const v = clampV(d.v + ((d.x - e.clientX) / PX) * step);
    if (v !== value) onChange(v);
  };
  const up = () => { if (drag.current) { drag.current = null; onDone(); } };
  const key = (e: React.KeyboardEvent) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
    if (!by) return;
    e.preventDefault();
    onChange(clampV(value + by));
    onDone();
  };
  const shift = -((value - min) / step) * PX;
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={format(value)}
      className="relative h-[58px] rounded-[20px] overflow-hidden touch-none cursor-ew-resize select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 flex items-center"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} data-testid="dial">
      <div className="shrink-0 w-[112px] pl-3 leading-tight pointer-events-none">
        <div className="text-[11.5px] font-semibold text-zinc-400 truncate">{label}</div>
        <div className="text-[16px] font-bold text-zinc-50 tabular-nums whitespace-nowrap">{format(value)}</div>
      </div>
      <div className="relative flex-1 h-full pointer-events-none">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-7" style={{
          backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,.75) 0 2px, transparent 2px 90px), repeating-linear-gradient(90deg, rgba(255,255,255,.35) 0 1.5px, transparent 1.5px 9px)",
          backgroundSize: "90px 28px, 9px 14px", backgroundRepeat: "repeat-x", backgroundPosition: `calc(50% + ${shift}px) 0, calc(50% + ${shift}px) 7px`,
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)", maskImage: "linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)"
        }} />
        <div className="absolute left-1/2 top-3 bottom-3 w-[3px] -ml-[1.5px] rounded bg-orange-300 shadow-[0_0_10px_rgba(163,217,119,0.7)]" />
      </div>
    </div>
  );
}

/** A list of things to go to (a hole's tees, its pins), each a row. */
const GoRow = ({ dot, label, hint, onClick, ring = false }: { dot: string; label: string; hint?: string; onClick: () => void; ring?: boolean }) => (
  <ActRow label={label} hint={hint} onClick={onClick} icon={ring ? <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: dot }} /> : <span className="w-3 h-3 rounded-full ring-1 ring-black/40" style={{ background: dot }} />} />
);
/** One part of the hole's own panel, by itself (a Section's `testid`). */
const HolePart = ({ hole, part }: { hole: Hole; part: string }) => (
  <div className="[&_section]:px-2 [&_section]:py-1.5"><OnlyGroup.Provider value={part}><HoleInspector hole={hole} /></OnlyGroup.Provider></div>
);
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/** Every setting a hole has, for the bar's row, the everyday ones first. */
export function useHoleSettings(hole: Hole): BarSetting[] {
  const doc = useCourse(s => s.doc);
  const s = holeStats(doc, hole);
  const u = doc.units;
  const tees = holeTees(doc, hole.id);
  const pins = holeBaskets(doc, hole.id);
  const holeTrees = useHoleTrees(hole, s.complete ? s.line : null);
  const set = (patch: Partial<Hole>, history = true) => updateHole(hole.id, patch, history);
  const commit = () => useCourse.getState().commit();
  // (on site, where it can be: walking the hole puts it on the map)
  const onSite = useTouch() && !useCourse.getState().readOnly && canShowLocation();
  // (each tee's length to the pin played, each pin's from the tee played)
  const tee = tees.find(t => t.id === s.teeId) ?? tees[0], pin = pins.find(b => b.id === s.basketId) ?? pins[0];
  const len = (t?: TeeItem, b?: BasketItem) => (t && b ? fmtDist(holeStats(doc, hole, { id: "x", name: "", tee: t.level, pin: b.position }).length, u) : undefined);
  const out: BarSetting[] = [];
  if (onSite) out.push({ id: "onsite", name: "On site", value: "Walk it", control: <div className="grid gap-1.5 p-1"><OnSiteButton holeId={hole.id} className="w-full" /><OnSiteButton className="w-full !bg-white/10" /></div>, wide: true });
  out.push(
    { id: "par", name: "Par", value: hole.par ?? `${s.parAuto} · auto`, control: <Segmented label="Par" value={hole.par ?? 0} onChange={v => set({ par: v === 0 ? undefined : v })} options={[{ value: 0, label: `Auto · ${s.parAuto}`, title: "From its length and how it plays" }, ...[2, 3, 4, 5, 6].map(p => ({ value: p, label: `Par ${p}` }))]} /> },
    // (drawn or not, how wide on a dial (the map following as it's dragged), back to an even width,
    // and the line of play)
    { id: "fairway", name: "Fairway", value: hole.fairway ? fmtDist(hole.fairwayWidth, u) : "Off", wide: true, control: (
      <div className="flex flex-col gap-0.5">
        {hole.fairway && <Dial label="Fairway width" value={hole.fairwayWidth} min={10} max={150} step={1} format={v => `${fmtDist(v, u)} wide`} onChange={v => set({ fairwayWidth: v }, false)} onDone={commit} />}
        <div className="px-3 py-1"><Toggle label="Draw the fairway" checked={hole.fairway} onChange={v => set({ fairway: v })} /></div>
        {hole.fairway && (hole.fairwayShape || hole.fairwayShift?.some(v => Math.abs(v) > 1e-3)) && <ActRow label="Even width" hint="One width all along, on the line" onClick={() => set({ fairwayShape: undefined, fairwayShift: undefined, fairwayStations: undefined })} />}
        {s.complete && <>
          <ActRow label="Plot the line" hint="Tap where it goes, turn by turn" onClick={() => useEditor.getState().set({ plotLine: hole.id, tool: "select" })} testid="plot-line" />
          <ActRow label="Bend left" onClick={() => set({ doglegs: bendHole(s.line, -1) })} testid="bend-left" />
          <ActRow label="Bend right" onClick={() => set({ doglegs: bendHole(s.line, 1) })} testid="bend-right" />
          {hole.doglegs.length > 0 && <ActRow label="Straighten" onClick={() => set({ doglegs: [] })} />}
        </>}
      </div>
    ) },
    { id: "tees", name: "Tees", value: String(tees.length), control: (
      <div className="flex flex-col gap-0.5">
        {tees.map(t => <GoRow key={t.id} dot={TEE_LEVELS[t.level].color} label={`${TEE_LEVELS[t.level].label} tee`} hint={[len(t, pin), t.id === s.teeId ? "played" : ""].filter(Boolean).join(" · ") || undefined} onClick={() => select(t.id)} />)}
        {!teesFull(hole.id, true) && <ActRow accent icon={<Plus size={18} />} label="Another tee" hint="Tap where it goes" onClick={() => startAnotherTee(hole.id)} testid="strip-add-tee" />}
        {s.complete && <ActRow accent icon={<Plus size={18} />} label="New hole to this basket" onClick={() => startHoleToBasket(hole.id)} testid="strip-hole-to-basket" />}
      </div>
    ) },
    { id: "pins", name: "Pins", value: String(pins.length), control: (
      <div className="flex flex-col gap-0.5">
        {pins.map(b => <GoRow key={b.id} ring dot={doc.style.basket} label={`Pin ${b.position}`} hint={[len(tee, b), b.id === s.basketId ? "played" : ""].filter(Boolean).join(" · ") || undefined} onClick={() => select(b.id)} />)}
        {!pinsFull(hole.id, true) && <ActRow accent icon={<Plus size={18} />} label="Another pin position" hint="Tap where it goes" onClick={() => startAnotherPin(hole.id)} testid="strip-add-pin" />}
        {doc.holes.length > 1 && (
          <div className="px-3 py-2">
            <div className="text-[12.5px] text-zinc-400 mb-1">Play to another hole's basket</div>
            <Select label="Basket" testid="share-basket" value={pins.find(b => b.holeId !== hole.id)?.holeId ?? ""} onChange={v => shareBasket(hole.id, v || null)}>
              <option value="">Its own basket</option>
              {doc.holes.filter(h => h.id !== hole.id && holeBaskets(doc, h.id).some(b => b.holeId === h.id)).map(h => <option key={h.id} value={h.id}>Hole {holeLabel(doc, h.id)}'s basket</option>)}
            </Select>
          </div>
        )}
      </div>
    ) },
    { id: "ob", name: "OB", value: "Add", control: s.complete
      ? <div className="flex flex-col gap-0.5">{(["left", "right", "long"] as const).map(w => <ActRow key={w} label={w === "left" ? "Left side" : w === "right" ? "Right side" : "Behind the basket"} hint="A line of OB along it" onClick={() => addHoleOb(hole.id, w)} testid={`ob-${w}`} />)}</div>
      : <p className="text-[13.5px] text-zinc-400 px-3 py-3">Needs a tee and a basket first.</p> },
    { id: "foliage", name: "Foliage", value: hole.foliage === "light" ? "Light" : hole.foliage === "heavy" ? "Heavy" : "Auto", control: <Segmented label="Foliage" value={hole.foliage ?? "auto"} onChange={v => set({ foliage: v === "auto" ? undefined : (v as "light" | "heavy") })} options={[{ value: "auto", label: `Auto · ${s.foliage}` }, { value: "light", label: "Light" }, { value: "heavy", label: "Heavy" }]} /> }
  );
  // (the measured trees it cut down: the way to bring them back)
  if (s.complete && (holeTrees.cut.length || holeTrees.kept.length || holeTrees.standing.length))
    out.push({ id: "trees", name: "Trees", value: holeTrees.cut.length ? `${holeTrees.cut.length} cut` : holeTrees.standing.length ? `${holeTrees.standing.length} in the way` : `${holeTrees.kept.length} kept`, wide: true, control: <div className="p-1.5"><HoleTrees hole={hole} line={s.line} /></div> });
  out.push(
    { id: "name", name: "Name", value: hole.name || "None", wide: true, control: <div className="p-1.5"><TextInput label="Hole name" value={hole.name ?? ""} placeholder="Name (optional)" onChange={v => set({ name: v || undefined }, false)} onDone={commit} /></div> },
    { id: "notes", name: "Notes", value: hole.notes ? "Written" : "None", wide: true, control: <div className="p-1.5"><TextInput area label="Hole notes" value={hole.notes ?? ""} placeholder="Notes and hole rules" onChange={v => set({ notes: v || undefined }, false)} onDone={commit} /></div> },
    { id: "number", name: "Number", value: holeLabel(doc, hole.id), wide: true, control: <div className="p-2 flex items-center gap-3"><HoleNumberInput holeId={hole.id} value={holeLabel(doc, hole.id)} /><span className="text-[13px] text-zinc-400">Its number on the scorecard and the map. Two numbers, like 3/21, play it twice.</span></div> }
  );
  if (s.complete) out.push(
    { id: "inplay", name: "In play", value: `${"●".repeat(s.difficulty)}`, wide: true, control: <HolePart hole={hole} part="sec-inplay" /> },
    { id: "flyover", name: "Flyover", value: "Settings", wide: true, control: <div className="p-1.5"><HoleFlight hole={hole} /></div> }
  );
  return out;
}

/** Every setting a thing has (a tree, a tee, a basket, a shape, a building…), for the bar's row,
 * the everyday ones first. Pinch or twist the thing itself on the map to size or turn it; these
 * are for exact numbers. */
export function useItemSettings(item: CourseItem): BarSetting[] {
  const doc = useCourse(s => s.doc);
  const u = doc.units;
  const set = (patch: Record<string, unknown>, history = true) => updateItem(item.id, patch as Partial<CourseItem>, history);
  const live = (patch: Record<string, unknown>) => set(patch, false);
  const done = () => useCourse.getState().commit();
  const deg = (v: number) => `${Math.round(((v % 360) + 360) % 360)}°`;
  const out: BarSetting[] = [];
  const dial = (id: string, name: string, value: ReactNode, d: Parameters<typeof Dial>[0]) => out.push({ id, name, value, wide: true, control: <Dial {...d} /> });
  // (with your location on, first: put it where you stand, saying how far it moves first)
  const located = useGps(g => g.mode !== "off") && canShowLocation();
  if (located && item.type !== "area" && item.type !== "line" && item.type !== "structure")
    out.push({ id: "movehere", name: "Where you stand", value: "Move here", wide: true, control: <div className="p-1.5"><MoveHere item={item} wide /></div> });
  if (item.type === "tree") {
    const t = item as TreeItem;
    const height = t.height ?? t.radius * 2.6;
    // (as far as the panel's sliders go: a survey's tree taller than that keeps its size)
    dial("height", "Height", fmtDist(height, u), { label: "Tree height", value: Math.round(height), min: 2, max: Math.max(120, Math.round(height)), step: 1, format: v => `${fmtDist(v, u)} tall`, onChange: v => live({ height: v, radius: Math.max(1, Math.min(45, Math.round(t.radius * (v / height) * 10) / 10)) }), onDone: done });
    dial("spread", "Spread", fmtDist(t.radius * 2, u), { label: "Crown spread", value: Math.round(t.radius * 2), min: 2, max: Math.max(90, Math.round(t.radius * 2)), step: 1, format: v => `${fmtDist(v, u)} across`, onChange: v => live({ radius: v / 2 }), onDone: done });
    // (its species among its kind's: oak, maple, birch… or pine, spruce, cedar)
    const { shape, species } = speciesNow(t);
    const list = SPECIES[shape];
    if (list.length > 1) out.push({ id: "species", name: "Species", value: list.find(s => s.id === species)?.label, control: <ChipPick label="Species" value={species} onChange={v => set({ species: v, leaf: undefined })} options={list.map(s => ({ value: s.id, label: s.label }))} /> });
    out.push({ id: "kind", name: "Kind", value: TREE_KINDS.find(k => k.value === (t.treeType ?? "deciduous"))?.label, wide: true, control: <KindTiles label="Tree kind" value={t.treeType ?? "deciduous"} onChange={v => set({ treeType: v, species: undefined, variant: undefined, leaf: undefined })} options={TREE_KINDS.map(k => ({ value: k.value, label: k.label, picture: bigIcon(k.icon) }))} /> });
    dial("lean", "Lean", t.lean ? `${t.lean}°` : "None", { label: "Lean", value: Math.round(t.lean ?? 0), min: 0, max: 30, step: 1, format: v => (v ? `Leans ${v}°` : "Upright"), onChange: v => live({ lean: v || undefined }), onDone: done });
    if (t.lean) dial("leanDir", "Leans toward", compassPoint(t.leanDir ?? 0), { label: "Leaning toward", value: Math.round(t.leanDir ?? 0), min: 0, max: 345, step: 15, format: v => `Toward ${compassPoint(v)}`, onChange: v => live({ leanDir: v }), onDone: done });
  } else if (item.type === "tee") {
    const t = item as TeeItem;
    // (the way it faces as a compass bearing: 0° north, 90° east; its aim is 0° east, 90° south)
    const aim = Math.round(teeAim(doc, t)) + 90;
    const bearing = (v: number) => `${compassPoint(v)} · ${deg(v)}`;
    out.push({ id: "color", name: "Color", value: <><span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/40" style={{ background: TEE_LEVELS[t.level].color }} />{TEE_LEVELS[t.level].label}</>,
      control: <ChipPick label="Tee color" value={t.level} onChange={v => setTeeLevel(t.id, v)} options={TEE_ORDER.map(l => ({ value: l, label: TEE_LEVELS[l].label, color: TEE_LEVELS[l].color, title: `${TEE_LEVELS[l].skill} (${TEE_LEVELS[l].rating})` }))} /> });
    dial("facing", "Facing", bearing(aim), { label: "Facing", value: aim, min: -720, max: 720, step: 1, format: v => `Points ${bearing(v)}`, onChange: v => live({ rotation: v - 90, aimFixed: true }), onDone: done });
    dial("length", "Length", fmtSize(t.padLength, u), { label: "Pad length", value: t.padLength, min: 4, max: 30, step: 0.5, format: v => `${fmtSize(v, u)} long`, onChange: v => live({ padLength: v }), onDone: done });
    dial("width", "Width", fmtSize(t.padWidth, u), { label: "Pad width", value: t.padWidth, min: 2, max: 20, step: 0.5, format: v => `${fmtSize(v, u)} wide`, onChange: v => live({ padWidth: v }), onDone: done });
    out.push({ id: "surface", name: "Surface", value: TEE_SURFACES[t.surface].label, control: <ChipPick label="Tee surface" value={t.surface} onChange={(v: TeeSurface) => set({ surface: v })} options={(Object.keys(TEE_SURFACES) as TeeSurface[]).map(k => ({ value: k, label: TEE_SURFACES[k].label, color: TEE_SURFACES[k].color }))} /> });
    if (t.aimFixed) out.push({ id: "aim", name: "Facing", value: "Down the hole", run: () => set({ aimFixed: false }) });
  } else if (item.type === "basket") {
    const b = item as BasketItem;
    out.push({ id: "pin", name: "Pin", value: b.position, control: <Segmented label="Pin position" value={b.position} onChange={v => setPinPosition(b.id, v)} options={PIN_POSITIONS.map(p => ({ value: p, label: `Pin ${p}` }))} /> });
    dial("raised", "Raised", b.raised ? fmtSize(b.raised, u) : "No", { label: "Raised above the ground", value: b.raised ?? 0, min: 0, max: 30, step: 0.5, format: v => (v ? `${fmtSize(v, u)} up` : "On the ground"), onChange: v => live({ raised: v || undefined }), onDone: done });
  } else if (item.type === "mando" || item.type === "amenity" || item.type === "dropzone" || item.type === "label") {
    if (item.type === "label") {
      const l = item as LabelItem;
      out.push({ id: "text", name: "Text", value: l.text.length > 14 ? `${l.text.slice(0, 13)}…` : l.text, wide: true, control: <div className="p-1.5"><TextInput label="Label text" testid="label-text" value={l.text} onChange={v => live({ text: v })} onDone={done} /></div> });
    }
    if (item.type === "amenity") {
      // (a bridge's or a shelter's sign is a course's from before: offered only to one that is one)
      const a = item as AmenityItem;
      const kinds = AMENITY_KINDS[a.kind].retired ? [...AMENITY_ORDER, a.kind] : AMENITY_ORDER;
      const name = (k: AmenityKind) => AMENITY_KINDS[k].pick ?? AMENITY_KINDS[k].label;
      out.push({ id: "kind", name: "Kind", value: name(a.kind), wide: true, control: <KindTiles label="Amenity kind" value={a.kind} onChange={v => set({ kind: v })} options={kinds.map(k => ({ value: k, label: name(k), picture: bigIcon(amenityIcon(k)) }))} /> });
    }
    if (item.type === "mando") out.push({ id: "side", name: "Pass", value: `${cap((item as MandoItem).side)} of it`, control: <Segmented label="Mando side" value={(item as MandoItem).side} onChange={v => set({ side: v })} options={[{ value: "left", label: "Left of it" }, { value: "right", label: "Right of it" }]} /> });
    const r = Math.round((item as { rotation?: number }).rotation ?? 0);
    dial("turn", "Turn", deg(r), { label: "Turn", value: r, min: -720, max: 720, step: 1, format: v => `Turned ${deg(v)}`, onChange: v => live({ rotation: v }), onDone: done });
    if (item.type === "label") {
      const l = item as LabelItem;
      dial("size", "Size", `${l.fontSize} px`, { label: "Size", value: l.fontSize, min: 9, max: 40, step: 1, format: v => `${v} px`, onChange: v => live({ fontSize: v }), onDone: done });
      out.push({ id: "color", name: "Color", value: <span className="w-3 h-3 rounded-full ring-1 ring-black/40" style={{ background: l.color }} />, wide: true, control: <div className="p-1.5"><ColorInput label="Color" value={l.color} onChange={(v: string) => live({ color: v })} onDone={done} /></div> });
    }
  } else if (item.type === "area" || item.type === "line") {
    // (a flat building is an old course's: offered only to one that is one)
    const kinds = item.type === "area"
      ? (item.kind === "building" ? [...AREA_ORDER, item.kind] : AREA_ORDER).map(k => ({ value: k as string, label: AREA_KINDS[k].label }))
      : (Object.keys(LINE_KINDS) as LineKind[]).map(k => ({ value: k as string, label: LINE_KINDS[k].label }));
    const kindLabel = item.type === "area" ? AREA_KINDS[item.kind].label : LINE_KINDS[item.kind].label;
    // (a field, court or play area: its own kinds, then in or out of play, its markings or its home plate)
    const fk = item.type === "area" && item.kind === "field" ? fieldKindOf(item) : null;
    if (fk && item.type === "area") {
      out.push({ id: "kind", name: "Kind", value: FIELD_KINDS[fk].label, wide: true, control: <KindTiles label="Field kind" value={fk} onChange={(v: FieldKind) => setFieldKind(item.id, v)} options={fieldKindOptions().map(o => ({ value: o.value, label: o.label, picture: bigIcon(o.icon) }))} /> });
      if (hasParts(fk)) out.push({ id: "parts", name: "Parts", value: "Each part", wide: true, control: <div className="p-1.5 [&>div]:mb-0"><FieldParts item={item} kind={fk} /></div> });
      if (hasFieldLooks(fk)) out.push({ id: "looks", name: "Size and colors", value: "Settings", wide: true, control: <div className="p-1.5"><FieldLooks item={item} kind={fk} /></div> });
      out.push({ id: "play", name: "Play", value: item.outOfPlay ? "Out of play" : "In play", control: <Segmented label="Play" value={item.outOfPlay ? "out" : "in"} onChange={v => setFieldPlay(item.id, v === "out")} options={[...PLAY_OPTIONS]} /> });
      if (MARKED_FIELDS.includes(fk)) dial("markings", "Markings", fmtTurn(item.fieldTurn ?? 0), { label: "Markings turn", value: item.fieldTurn ?? 0, min: -90, max: 90, step: 1, format: fmtTurn, onChange: v => live({ fieldTurn: v || undefined }), onDone: done });
      if (isBallField(fk)) out.push({ id: "home", name: "Home plate", value: homeText(item), run: item.locked ? undefined : () => nextHomeCorner(item.id), testid: "strip-home-next" });
    } else out.push({ id: "kind", name: "Kind", value: kindLabel, wide: true, control: (
      <KindTiles label={item.type === "area" ? "Area kind" : "Line kind"} value={item.kind as string} onChange={k => (item.type === "line" ? setLineKind(item.id, k as LineKind) : set({ kind: k }))} options={kinds.map(o => ({ value: o.value, label: o.label, picture: item.type === "area" ? areaPicture(o.value as AreaKind) : linePicture(o.value as LineKind) }))} />
    ) });
    // (a wood: how thick, its underbrush, what grows, whether the measured trees in it stay)
    if (item.type === "area" && item.kind === "woods") {
      const t = thickOf(item);
      out.push({ id: "thick", name: "Thick", value: THICK.find(x => x.value === t)!.label, control: <Segmented label="How thick" value={t} onChange={v => set({ density: densityFor(v) })} options={[...THICK]} /> });
    }
    // (woods, and tall grass when you want some; a wood of bushes only is brush already)
    if (item.type === "area" && (item.kind === "rough" || (item.kind === "woods" && (item.bushes ?? 0) < 1)))
      out.push({ id: "brush", name: "Underbrush", value: item.underbrush ? cap(item.underbrush) : "None", control: <Segmented label="Underbrush" value={item.underbrush ?? "none"} onChange={v => set({ underbrush: v === "none" ? undefined : v })} options={[...BRUSH_LEVELS]} /> });
    if (item.type === "area" && !item.locked && item.kind !== "field" && item.kind !== "building") out.push({ id: "reshape", name: "Reshape", value: "Brush", run: () => {
      const brush = item.kind === "woods" && (item.bushes ?? 0) >= 1;
      useEditor.getState().set({ tool: "draw-area", areaKind: item.kind, standOf: brush ? "bush" : null, ...(brush ? { treeKind: "bush" as const } : {}), drawShape: "paint", reshapeId: item.id, areaBrush: "add" });
    }, testid: "reshape-brush" });
    // (a next-tee route can have none: a dashed line)
    if (item.type === "line" && (LINE_KINDS[item.kind].width > 0 || item.kind === "walk")) {
      const meta = LINE_KINDS[item.kind];
      const w = item.width ?? meta.width;
      dial("width", "Width", w ? fmtSize(w, u) : "None", { label: "Width", value: w, min: item.kind === "walk" ? 0 : 1, max: meta.maxWidth, step: 0.5, format: v => (v ? `${fmtSize(v, u)} wide` : "Just a dashed line"), onChange: v => live({ width: v || undefined }), onDone: done });
    }
    if (item.type === "line" && (item.kind === "path" || item.kind === "walk")) {
      const l = item as LineItem;
      out.push({ id: "surface", name: "Surface", value: PATH_SURFACES[l.surface ?? "dirt"].label, control: <SurfacePick value={l.surface} onChange={(v: PathSurface | undefined) => set({ surface: v })} /> });
    }
    // (a fence: what it is, and a fence, hedge or power line how tall, as in its panel)
    if (item.type === "line" && item.kind === "fence") {
      const style = item.fenceStyle ?? "rail";
      out.push({ id: "fence", name: "Fence", value: FENCE_STYLES.find(f => f.value === style)?.label, control: <ChipPick label="What the fence is" value={style} onChange={v => set({ fenceStyle: v === "rail" ? undefined : v })} options={FENCE_STYLES} /> });
    }
    if (item.type === "line" && LINE_KINDS[item.kind].heights) {
      const meta = LINE_KINDS[item.kind], h = item.fenceHeight ?? meta.height!;
      const name = heightLabel(item.kind);
      dial("height", name.split(" ")[0], fmtSize(h, u), { label: name, value: h, min: meta.heights![0], max: meta.heights![1], step: 0.5, format: v => `${fmtSize(v, u)} ${item.kind === "power" ? "up" : "tall"}`, onChange: v => live({ fenceHeight: v }), onDone: done });
    }
    const a = item as AreaItem | LineItem;
    // (its penalty, and with OB which side, along how much of it and for which holes)
    if (hasObChoice(a)) {
      const ob = obChoiceOf(a);
      out.push({ id: "ob", name: "Penalty", value: ob === "no" ? "None" : obOptions(a).find(o => o.value === ob)?.label ?? "", control: <div className="p-1 [&_[role=group]]:mb-2 [&>[role=group]:first-child>span:first-child]:hidden"><ObPick item={a} /></div> });
    }
    if (item.type === "area" && item.kind === "woods") {
      out.push({ id: "grows", name: "Grows", value: growsText(growsOf(item, doc.style)), control: <div className="p-1 [&_[role=group]]:mb-1"><GrowsPick item={item} />{standShape(item) && <StandSpecies item={item} />}</div> });
      if (doc.lidar?.trees.length) {
        const keep = item.trees !== "drawn" && item.trees !== "none";
        out.push({ id: "trees", name: "Measured trees", value: keep ? "Kept" : "Cleared", on: keep, run: () => set({ trees: keep ? "drawn" : undefined }) });
      }
    }
  } else if (item.type === "structure") {
    // (the same ranges as the panel's sliders; stairs follow the ground, with no height of their own)
    const s = item as StructureItem;
    const meta = STRUCTURE_KINDS[s.kind];
    // (a line can only become another line, an outline another outline)
    const kinds = STRUCTURE_ORDER.filter(k => STRUCTURE_KINDS[k].shape === meta.shape);
    out.push({ id: "kind", name: "Kind", value: meta.label, wide: true, control: <KindTiles label="Structure kind" value={s.kind} onChange={(v: StructureKind) => set({ kind: v })} options={kinds.map(k => ({ value: k, label: STRUCTURE_KINDS[k].label, picture: bigIcon(builtIcon(k)) }))} /> });
    if (s.kind === "building" || s.kind === "shelter") out.push({ id: "look", name: "Look", value: "Roof and walls", wide: true, control: <div className="p-1.5"><StructureLook item={s} /></div> });
    if (meta.heightLabel) {
      const h = structureHeight(s);
      dial("height", meta.heightLabel.split(" ")[0], fmtSize(h, u), { label: meta.heightLabel, value: h, min: meta.heights[0], max: Math.max(meta.heights[1], h), step: 0.5, format: v => fmtSize(v, u), onChange: v => live({ height: v }), onDone: done });
    }
    if (meta.shape === "line") {
      const w = structureWidth(s);
      const name = s.kind === "wall" ? "Thickness" : "Width";
      dial("width", name, fmtSize(w, u), { label: name, value: w, min: meta.widths[0], max: Math.max(meta.widths[1], w), step: 0.5, format: v => `${fmtSize(v, u)} ${s.kind === "wall" ? "thick" : "wide"}`, onChange: v => live({ width: v }), onDone: done });
    }
  }
  // (drawn round or straight through its corners; a switch)
  if ((item.type === "area" && item.kind !== "parking" && item.kind !== "building" && item.kind !== "field") || item.type === "line") {
    const a = item as AreaItem | LineItem;
    out.push({ id: "curved", name: "Curved", on: !a.straight, run: () => set({ straight: a.straight ? undefined : true }) });
  }
  if ((item.type === "area" || item.type === "line" || item.type === "structure") && !item.locked) out.push({ id: "turnshape", name: "Turn", value: "15° · 90°", wide: true, control: <div className="p-1.5"><TurnButtons item={item} /></div> });
  if (item.type === "line" && !item.locked) out.push({ id: "cut", name: "Remove", value: "A stretch", run: () => useEditor.getState().set({ obPick: item.id, pickCut: true, tool: "select" }) });
  // (the holes it's for: belongs to, OB for, or counts for)
  const role = item.type === "mando" || item.type === "dropzone" || item.type === "structure" ? { label: "Belongs to", all: "Whole course" }
    : (item.type === "area" || item.type === "line") && item.kind === "ob" ? { label: "OB for", all: "All holes" }
    : item.type === "area" && (RULE_AREAS.has(item.kind) || (item.kind === "field" && item.outOfPlay)) ? { label: "Counts for", all: "All holes" } : null;
  if (role) {
    const shared = item.type === "area" || item.type === "line" || item.type === "structure";
    const own = "holeId" in item ? item.holeId : undefined;
    const mine = own ? [own, ...((shared && (item as AreaItem).alsoHoles) || [])] : [];
    out.push({ id: "holes", name: role.label, value: mine.length ? `${mine.length} hole${mine.length > 1 ? "s" : ""}` : role.all, wide: true, control: (
      <div className="p-1.5">
        <HoleChips label={`${role.label} ${shared ? "holes" : "hole"}`} testid="belongs-to" picked={mine.length ? mine : "all"} single={!shared} all={role.all}
          onChange={v => { const ids = v === "all" ? [] : v; set(shared ? { holeId: ids[0], alsoHoles: ids.length > 1 ? ids.slice(1) : undefined } : { holeId: ids[0] }); }} />
      </div>
    ) });
  }
  // (its name on the map)
  if (item.type === "area" || item.type === "line" || item.type === "structure" || item.type === "amenity") {
    const named = (item as { label?: string }).label;
    out.push({ id: "name", name: "Name", value: named || "None", wide: true, control: <div className="p-1.5"><TextInput label={`${item.type === "area" ? "Area" : item.type === "line" ? "Line" : item.type === "structure" ? "Structure" : "Amenity"} name`} value={named ?? ""} placeholder="Name on the map (optional)" onChange={v => live({ label: v || undefined })} onDone={done} /></div> });
  }
  return out;
}

/** A row of choices as the glass menu's own rows (a hole's par, its foliage), for anything that
 * isn't a ChipPick or Segmented already. */
export const Rows = <T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) => (
  <div className="flex flex-col gap-0.5" role="radiogroup">{options.map(o => <PickRow key={String(o.value)} on={value === o.value} onClick={() => onChange(o.value)} label={o.label} hint={o.hint} />)}</div>
);
