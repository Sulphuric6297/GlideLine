// The Design step's controls: how the printed map looks (its style, colors, title block, what shows).
import { ArrowRight, Ban, FileText, Hash, ListTree, Palette, PenLine, Plus, RotateCcw, Target, Type, type LucideIcon } from "lucide-react";
import { ApplyToHoles } from "./ApplyToHoles";
import { BASKET_MARKS, basketMark, bestRotation } from "../lib/mapSvg";
import { CARD_DEFAULTS, SIGN_LOOKS, SIGN_PARTS, SIGN_SPOTS, isSheet, signOf } from "../lib/teeSign";
import { changeDoc, useCourse, useEditor } from "../state/course";
import { toast } from "../state/toast";
import { AREA_KINDS } from "../constants";
import { RESTRICTED } from "../lib/symbols";
import { MapLookPanel } from "./MapLookPanel";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MapStyle, ReliefLook, SignLook, SignSettings, SignSpot } from "../types";
import { Button, ChipPick, chipCls, Field, Fold, HelpLink, OnlyGroup, Section, Segmented, Slider, TextInput, Toggle, WholePanelOnly } from "./ui";
import { LOOK_LABEL, TREE_LOOKS, kindsOf, regionAt, sharesOf, type TreeLookId } from "../lib/treeMix";
import { ChangeScope, HolePageLook, OwnHoles, PrintPanel, ScorecardSettings, Sponsors } from "./PrintPanel";
import { boardSize } from "./printouts";
import { FontPicker } from "./FontPicker";
import { ColorField } from "./ColorSwatches";
import { SHOW_EVENT } from "./showSetting";
import { fontsIn } from "../lib/fontLoad";

export const setStyle = (patch: Partial<MapStyle>, history = true) => {
  // View only: the look changes on this screen (sun, landscape…), never saved
  if (useCourse.getState().readOnly) { useCourse.setState(s => ({ doc: { ...s.doc, style: { ...s.doc.style, ...patch } } })); return; }
  changeDoc(d => ({ style: { ...d.style, ...patch } }), history);
};

/** How thick the painted woods are. The map repaints when the slider is let go (painting takes a moment). */
/** A slider for a style setting that repaints the map: it changes the map when let go. */
/** `live`: the change shows while dragging (the 3D view's light: quick), one undo step at the end. */
export function StyleSlider<K extends keyof MapStyle>({ k, value, label, min, max, step, format, live }: { k: K; value: number; label: string; min: number; max: number; step: number; format: (v: number) => string; live?: boolean }) {
  const [v, setV] = useState(value);
  // Only a slider that was moved commits (a key let go on it, like Ctrl+Z's, must not)
  const moved = useRef(false);
  useEffect(() => { setV(value); }, [value]);
  const done = () => {
    if (live) { if (moved.current) useCourse.getState().commit(); }
    else if (moved.current && v !== value) setStyle({ [k]: v } as Partial<MapStyle>);
    moved.current = false;
  };
  return <Slider label={label} min={min} max={max} step={step} value={v} onChange={x => { moved.current = true; setV(x); if (live) setStyle({ [k]: x } as Partial<MapStyle>, false); }} onDone={done} format={format} />;
}

/** Ways to draw elevation on the painted map, each with a picture of a canyon drawn that way. */
export const ELEVATION_LOOKS: { id: ReliefLook | "off"; label: string; hint: string }[] = [
  { id: "shaded", label: "Shaded", hint: "Soft light and shadow, with bare rock on cliffs. Easy on the eye." },
  { id: "cliffs", label: "Cliff edges", hint: "Every drop's top edge inked, with the walls below it in shadow. Canyons and ledges stand out." },
  { id: "contours", label: "Contours", hint: "Lines at round heights with the heights written on them, so you can read how high anything is." },
  { id: "terraces", label: "Terraces", hint: "The land in stepped layers, each one a bit lighter than the one below." },
  { id: "off", label: "Off", hint: "No elevation drawn. The ground looks flat." }
];

const TreeCover = ({ value }: { value: number }) => (
  <StyleSlider k="treeCover" value={value} label="Tree cover" min={0.1} max={1} step={0.05} format={x => `${x < 0.35 ? "Sparse" : x < 0.7 ? "Open woods" : x < 0.95 ? "Thick" : "Dense"} · ${Math.round(x * 100)}%`} />
);

/** Where the painted map has woods, and how thick (the map style's Landscape part); with measured
 * trees, the woods painted besides them (Drawn only to start). */
export function WoodsOptions({ s, measured = false }: { s: MapStyle; measured?: boolean }) {
  const value = measured ? s.forestMeasured ?? "woods" : s.forest;
  const pick = (v: MapStyle["forest"]) => setStyle(measured ? { forestMeasured: v === "woods" ? undefined : v } : { forest: v });
  return (
    <div className="mt-3" data-testid="forest-options">
      <Field label="Where to paint the woods">
        <Segmented label="Woods" value={value} onChange={pick} options={[{ value: "photo", label: "From the photo" }, { value: "everywhere", label: "Everywhere" }, { value: "woods", label: "Drawn only" }]} />
      </Field>
      {(!measured || value !== "woods") && <TreeCover value={s.treeCover ?? 1} />}
    </div>
  );
}

/** "a, b and c". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The kinds of trees the woods and measured trees grow (lib/treeMix), at least one; with the kinds
 * the Forest Service counts most in the course's region, to use in one tap. */
export function TreeKinds({ s }: { s: MapStyle }) {
  const place = useCourse(c => c.doc.site?.location ?? null);
  const [region, setRegion] = useState<Awaited<ReturnType<typeof regionAt>>>(null);
  useEffect(() => {
    let live = true;
    setRegion(null);
    if (place) regionAt(place.lat, place.lon).then(r => { if (live) setRegion(r); }, () => {});
    return () => { live = false; };
  }, [place?.lat, place?.lon]);
  const kinds = kindsOf(s);
  // (the usual three: kept unset, so the woods stay exactly as before there was a choice)
  const save = (next: TreeLookId[]) => setStyle({ treeKinds: sharesOf({ treeKinds: next }) ? TREE_LOOKS.filter(k => next.includes(k)) : undefined });
  const toggle = (k: TreeLookId) => {
    const on = kinds.includes(k);
    if (on && kinds.length === 1) return;
    save(on ? kinds.filter(x => x !== k) : [...kinds, k]);
  };
  const rec = region?.recommended ?? [];
  const using = rec.length === kinds.length && rec.every(k => kinds.includes(k));
  return (
    <div className="mt-3" data-testid="tree-kinds">
      <Field label="Kinds of trees" help="site-trees">
        <div className="flex flex-wrap gap-1.5">
          {TREE_LOOKS.map(k => {
            const on = kinds.includes(k), last = on && kinds.length === 1;
            return (
              <button key={k} type="button" className={`${chipCls(on)} ${last ? "cursor-default" : ""}`} aria-pressed={on} title={last ? "At least one kind stays on" : undefined} onClick={() => toggle(k)}>
                {LOOK_LABEL[k]}
              </button>
            );
          })}
        </div>
      </Field>
      {region && rec.length > 0 && (
        <div className="mt-1.5 text-xs text-zinc-400 leading-relaxed" data-testid="tree-kinds-region">
          Most common in {region.name}: {andList(rec.map(k => LOOK_LABEL[k].toLowerCase()))}.{" "}
          {using ? <span className="text-zinc-300">In use.</span> : <button type="button" className="text-orange-300 hover:text-orange-200 font-semibold touch:py-2" onClick={() => save(rec)}>Use these</button>}
        </div>
      )}
    </div>
  );
}

export const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.round(Math.abs(x) * 100)}%`;

/** The picture's tone: brightness, contrast, color, how painted, the hills (in the Light part). */
export function FineTuning({ s }: { s: MapStyle }) {
  return (
    // (its Reset once something's changed, as every other part's)
    <Section title="Tone" testid="light-shadow" right={s.light !== undefined || s.contrast !== undefined || s.colorStrength !== undefined || s.paint !== undefined ? <button className="text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1" onClick={() => setStyle({ light: undefined, contrast: undefined, colorStrength: undefined, paint: undefined })}><RotateCcw size={12} /> Reset</button> : undefined}>
      <StyleSlider k="light" value={s.light ?? 0} label="Brightness" min={-0.3} max={0.3} step={0.02} format={signed} />
      <StyleSlider k="contrast" value={s.contrast ?? 0} label="Contrast" min={-0.3} max={0.4} step={0.02} format={signed} />
      <StyleSlider k="colorStrength" value={s.colorStrength ?? 1} label="Color strength" min={0.3} max={1.4} step={0.05} format={x => `${Math.round(x * 100)}%`} />
      <StyleSlider k="paint" value={s.paint ?? 0.8} label="Painted look" min={0} max={1} step={0.05} format={x => (x < 0.25 ? "Smooth" : x < 0.7 ? "Soft bands" : "Painted bands")} />
    </Section>
  );
}

/** The extra panel's choices, each with its little picture. */
const SPOT_ICON: Record<SignSpot, LucideIcon> = { green: Target, stats: Hash, none: Ban, courseMap: Target };

/** How tee signs look: for all holes, or a hole's own (the one the tee sign preview shows): the
 * other holes on its map faded, left out or shown, and each part shown or left out. */
function TeeSignSettings() {
  const doc = useCourse(s => s.doc);
  const designHole = useEditor(e => e.designHole);
  const active = useEditor(e => e.activeHoleId);
  const holeId = [designHole, active].find(id => id && doc.holes.some(h => h.id === id)) ?? doc.holes[0]?.id ?? null;
  const hole = doc.holes.find(h => h.id === holeId);
  const scope = useEditor(e => e.signScope);
  const forHole = scope === "hole" && !!hole;
  // (what shows: a hole's own over the course's, or the course's alone)
  const eff = forHole ? signOf(doc, hole!.id) : signOf({ style: doc.style, holes: [] }, "");
  const own = (forHole ? hole!.sign : doc.style.sign) ?? {};
  const patch = (p: SignSettings, history = true) =>
    changeDoc(d => (forHole ? { holes: d.holes.map(h => (h.id === hole!.id ? { ...h, sign: { ...h.sign, ...p } } : h)) } : { style: { ...d.style, sign: { ...d.style.sign, ...p } } }), history);
  // (Reset: the look and these settings back as they start; what was added to the signs, and
  // where their pieces were put, stay; a layout goes with a look, so a look put back starts it over)
  const sg = doc.style.sign;
  const resetting = !!sg && (sg.look !== undefined || sg.others !== undefined || sg.fade !== undefined || sg.show !== undefined || sg.spot !== undefined);
  const reset = forHole
    ? null
    : <button className="text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1 disabled:opacity-40" disabled={!resetting} onClick={() => setStyle({ sign: sg && (sg.extras || sg.layout) ? { extras: sg.extras, layout: sg.look ? undefined : sg.layout } : undefined })} data-testid="sign-reset"><RotateCcw size={12} /> Reset</button>;
  // (from a hole: its sign settings to the holes picked)
  const applyTo = (ids: string[]) => changeDoc(d => ({ holes: d.holes.map(h => (ids.includes(h.id) ? { ...h, sign: hole?.sign ? JSON.parse(JSON.stringify(hole.sign)) : undefined } : h)) }));
  // (a sign on letter or A4 paper is always Classic; the others look as picked on the signs' own sizes)
  const size = doc.style.signSize ?? "18x12", sheet = isSheet(size), look = doc.style.sign?.look ?? "classic";
  // (an extra panel only where the look has room for one: a wide sign, Classic, Trailhead or Field guide)
  const spots = size !== "18x12" || sheet || look === "openview" ? [] : look === "fieldguide" ? SIGN_SPOTS.filter(o => o.id !== "stats") : SIGN_SPOTS;
  // (another look starts every sign over, each hole's own layout too; on paper, one other than
  // Classic takes the signs back to their last size; Undo puts it all back)
  const pickLook = (id: SignLook) => {
    if (id === look && !(sheet && id !== "classic")) return;
    changeDoc(d => ({ style: { ...d.style, ...(sheet && id !== "classic" ? { signSize: boardSize() } : {}), sign: { ...d.style.sign, look: id === "classic" ? undefined : id, layout: undefined } }, holes: d.holes.map(h => (h.sign?.layout ? { ...h, sign: { ...h.sign, layout: undefined } } : h)) }));
    toast(`Every tee sign now has the ${SIGN_LOOKS.find(l => l.id === id)?.label ?? id} look.`, "info", true);
  };
  if (!doc.holes.length) return null;
  return (
    <Section title="Tee signs" testid="sign-settings" right={reset} help="tee-signs">
      <ChangeScope />
      <div className="text-[12px] text-zinc-400 mb-1.5 px-0.5">Start from</div>
      <div className="grid grid-cols-4 gap-1.5 mb-3" role="radiogroup" aria-label="Tee sign look" data-testid="sign-looks">
        {SIGN_LOOKS.map(l => {
          const on = look === l.id, off = sheet && l.id !== "classic";
          return (
            <button key={l.id} role="radio" aria-checked={on} data-testid={`sign-look-${l.id}`} onClick={() => pickLook(l.id)}
              className={`text-left rounded-lg overflow-hidden bg-white/[0.07] ring-1 transition ${on ? "ring-2 ring-orange-400" : "ring-white/10 hover:ring-white/30"} ${off ? "opacity-45 hover:opacity-80" : ""}`}>
              <img src={`${import.meta.env.BASE_URL}signs/${l.id}.jpg`} alt="" loading="lazy" className="block w-full aspect-[2/3] object-cover object-top" draggable={false} />
              <span className="block px-1 py-1 text-[10.5px] leading-tight font-semibold text-zinc-100 text-center">{l.label}</span>
            </button>
          );
        })}
      </div>
      <Field label="Other holes">
        <Segmented label="Other holes on the sign" value={eff.others} onChange={v => patch({ others: v })} options={[{ value: "faded", label: "Faded" }, { value: "hidden", label: "Hidden" }, { value: "shown", label: "Shown" }]} />
      </Field>
      {eff.others === "faded" && <Slider label="How much they show" min={0.05} max={0.9} step={0.05} value={eff.fade} onChange={v => patch({ fade: v }, false)} onDone={() => useCourse.getState().commit()} format={v => `${Math.round(v * 100)}%`} />}
      <div data-testid="sign-parts">
        {(["throwLine", "distances", "circle"] as const).map(id => <Toggle key={id} label={SIGN_PARTS.find(p => p.id === id)!.label} checked={eff.show(id)} onChange={v => patch({ show: { ...own.show, [id]: v } })} />)}
      </div>
      {spots.length > 0 && (
        <Field label="Extra panel">
          <ChipPick label="What goes in the extra panel" testid="sign-spot" value={spots.some(o => o.id === eff.spot) ? eff.spot : "green"} onChange={v => patch({ spot: v, show: { ...own.show, courseMap: undefined } })}
            options={spots.map(o => { const Icon = SPOT_ICON[o.id]; return { value: o.id, label: o.label, icon: <Icon size={13} /> }; })} />
        </Field>
      )}
      {forHole && <div className="mt-2"><ApplyToHoles fromId={hole!.id} apply={applyTo} testid="sign-apply" /></div>}
      <OwnHoles t="sign" />
    </Section>
  );
}

/** The course map's tools: one row, one part of its panel open at a time (as a phone has them). */
const MAP_TOOLS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "map-style", label: "Style", icon: Palette }, { id: "drawn-on-map", label: "Lines", icon: PenLine }, { id: "fold-title", label: "Lettering", icon: Type },
  { id: "fold-paper", label: "Paper", icon: FileText }, { id: "print-add", label: "Add", icon: Plus }, { id: "print-layers", label: "Layers", icon: ListTree }
];
/** Which of the course map's tools is open (the whole panel's: none while a phone opens one). */
const MapTool = createContext<string | null>(null);
function MapTools({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState("map-style");
  // (Show me, from the help: the tool its setting is in, opened)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d !== "string" || !d.startsWith("page-tool:")) return;
      const id = d.slice(10) === "light-shadow" || d.slice(10) === "map-look" ? "map-style" : d.slice(10);
      if (MAP_TOOLS.some(t => t.id === id)) setOpen(id);
    };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  return (
    <>
      <div role="toolbar" aria-label="Course map settings" className="mx-3 mt-2 flex gap-1 rounded-[18px] bg-white/[0.05] p-1" data-testid="map-tools">
        {MAP_TOOLS.map(t => {
          const on = open === t.id;
          return (
            <button key={t.id} onClick={() => setOpen(t.id)} aria-pressed={on} data-testid={`page-tool-${t.id}`}
              className={`flex-1 min-w-0 h-[48px] px-1 rounded-[14px] flex flex-col items-center justify-center gap-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-orange-500 text-zinc-950" : "text-zinc-300 hover:bg-white/[0.09]"}`}>
              <t.icon size={17} />
              <span className="text-[10.5px] leading-none font-semibold whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>
      <MapTool.Provider value={open}><OnlyGroup.Provider value={open}>{children}</OnlyGroup.Provider></MapTool.Provider>
    </>
  );
}
/** The open tool's name over its part (a part shown alone drops its own title). */
const ToolTitle = ({ help }: { help?: string }) => {
  const open = useContext(MapTool), t = MAP_TOOLS.find(x => x.id === open);
  if (!t) return null;
  return <h3 className="px-4 pt-3 -mb-2 text-xs font-semibold text-zinc-400 flex items-center gap-1.5">{t.label}{help && <HelpLink topic={help} label={t.label} />}</h3>;
};
const TOOL_HELP: Record<string, string> = { "map-style": "map-style", "drawn-on-map": "drawn-on-map", "fold-title": "lettering", "fold-paper": "paper", "print-add": "printout-editing", "print-layers": "printout-editing" };

export function DesignPanel() {
  const doc = useCourse(s => s.doc);
  const s = doc.style;
  // Color pickers change the map live while dragging; the change is one undo step when it ends
  const done = () => useCourse.getState().commit();
  // (the tab above the page: what's shared by every download, or one of them alone)
  const tab = useEditor(e => e.designTab);
  // (shown whole: the course map's parts as a row of tools; a phone's page tools show one already)
  const whole = !useContext(OnlyGroup);
  const toGeneral = (
    <Section>
      <button className="w-full flex items-center justify-between rounded-[14px] bg-white/[0.06] px-3 py-2.5 text-sm text-zinc-100" onClick={() => useEditor.getState().set({ designTab: "general" })} data-testid="to-general">
        Lettering and colors <ArrowRight size={15} className="text-zinc-400" />
      </button>
    </Section>
  );
  const mapPanel = (
    <PrintPanel t="map" top={<Section title="Map style" testid="map-style" help="map-style"><MapLookPanel /></Section>}>
      <Section title="Lines" help="drawn-on-map" testid="drawn-on-map">
        <Toggle label="Throw lines" checked={s.throwLines} onChange={v => setStyle({ throwLines: v })} />
        <Toggle label="Distances" checked={s.distances} onChange={v => setStyle({ distances: v })} />
        <Toggle label="Putting circle" checked={s.circle} onChange={v => setStyle({ circle: v })} />
      </Section>
      <Section title="Amenity marks" help="amenities" testid="amenity-marks">
        <Segmented label="Amenity marks" value={s.amenityMarks ?? "comforts"} onChange={v => setStyle({ amenityMarks: v === "comforts" ? undefined : v })}
          options={[{ value: "essentials", label: "Essentials" }, { value: "comforts", label: "+ Comforts" }, { value: "all", label: "Everything" }]} />
        <p className="text-[11.5px] text-zinc-400 mt-1.5 leading-snug">{s.amenityMarks === "essentials" ? "Parking, restrooms, water, the map board and the practice basket." : s.amenityMarks === "all" ? "A sign for every amenity, poles and lights too." : "Essentials, and benches, tables and trash cans near the holes, where there's room."} Poles, lights and gates are drawn as what they are.</p>
      </Section>
      {/* (the course name's font is on the General tab: it goes on every printout) */}
      <Fold title={<span className="flex items-center gap-1.5">Lettering <HelpLink topic="lettering" label="Lettering" /></span>} testid="fold-title">
        <Field label="Labels font">
          <FontPicker label="Labels font" value={s.font} onPick={f => setStyle({ font: f ?? "Script" })} used={fontsIn(doc)} testid="map-font" />
        </Field>
        <StyleSlider k="labelScale" value={s.labelScale} label="Label size" min={0.7} max={1.6} step={0.05} format={v => `${Math.round(v * 100)}%`} />
      </Fold>
      {/* (the paper's size is over the page, beside the tabs; a phone's Paper tool has it first) */}
      <Fold title={<span className="flex items-center gap-1.5">Paper <HelpLink topic="paper" label="Paper" /></span>} testid="fold-paper">
        <Field label="Frame">
          <Segmented label="Frame" value={s.frame ?? "none"} onChange={v => setStyle({ frame: v === "none" ? undefined : v })} options={[{ value: "none", label: "None" }, { value: "mat", label: "Mat" }, { value: "line", label: "Fine line" }, { value: "band", label: "Band" }]} />
        </Field>
        <Field label="Orientation">
          <Segmented label="Orientation" value={s.orientation} onChange={v => setStyle({ orientation: v })} options={[{ value: "auto", label: "Auto" }, { value: "landscape", label: "Landscape" }, { value: "portrait", label: "Portrait" }]} />
        </Field>
        <div className="mt-1">
          <Slider label="Turn the map" min={-180} max={180} value={s.rotation} onChange={v => setStyle({ rotation: v }, false)} onDone={done} format={v => (v === 0 ? "North up" : `${v}°`)} />
          <div className="flex gap-1.5 -mt-1">
            <Button small onClick={() => setStyle({ rotation: bestRotation(doc) })} testid="best-rotation">Turn to fill the page</Button>
            {s.rotation !== 0 && <Button small onClick={() => setStyle({ rotation: 0 })}>North up</Button>}
          </div>
        </div>
      </Fold>
    </PrintPanel>
  );
  return (
    <>
      {tab === "general" && (
        <>
      <Section title="Lettering and colors" testid="card-style" help="card-style" right={s.card ? <button className="text-xs text-orange-300 hover:text-orange-200 flex items-center gap-1" onClick={() => setStyle({ card: undefined })}><RotateCcw size={12} /> Reset</button> : undefined}>
        <div className="grid grid-cols-2 gap-x-3">
          {([["header", "Header"], ["accent", "Header lettering"], ["paper", "Page color"], ["ink", "Text color"]] as const).map(([key, label]) => (
            <ColorField key={key} label={label} value={s.card?.[key] ?? CARD_DEFAULTS[key]} onChange={(v, live) => setStyle({ card: { ...s.card, [key]: v } }, !live)} onDone={done} />
          ))}
        </div>
        <Field label="Tagline">
          <TextInput label="Tagline" value={s.tagline ?? "Disc golf course"} placeholder="None" onChange={v => setStyle({ tagline: v }, false)} onDone={done} />
        </Field>
        <Field label="Course name font">
          <FontPicker label="Course name font" value={s.titleFont} inherit="Each look's own" onPick={f => setStyle({ titleFont: f ?? undefined })} used={fontsIn(doc)} testid="title-font" />
        </Field>
        <Field label="Headings font">
          <FontPicker label="Headings font" value={s.card?.font ?? CARD_DEFAULTS.font} onPick={f => setStyle({ card: { ...s.card, font: f ?? CARD_DEFAULTS.font } })} used={fontsIn(doc)} testid="card-font" />
        </Field>
      </Section>
      <Section title="Marks" testid="markings" help="marks">
        {/* (which colors mark the areas first: PDGA colors set OB's own, so its swatch goes) */}
        <div className="text-xs text-zinc-400">Marking colors</div>
        <div className="mt-1 mb-3 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Marking colors">
          {([
            { value: "map", label: "Map colors", ob: s.ob, nogo: "#7c3aed" },
            { value: "pdga", label: "PDGA colors", ob: "#ffffff", nogo: RESTRICTED }
          ] as const).map(m => (
            <button
              key={m.value}
              role="radio"
              aria-checked={(s.markings ?? "map") === m.value}
              data-testid={`markings-${m.value}`}
              onClick={() => setStyle({ markings: m.value })}
              className={`rounded-lg border px-2 py-1.5 touch:py-3 flex items-center gap-2 text-xs font-semibold text-zinc-200 transition-colors ${(s.markings ?? "map") === m.value ? "border-orange-500 bg-orange-500/10" : "border-white/[0.12] hover:border-zinc-500"}`}
            >
              <span className="flex gap-0.5">
                {[m.ob, s.hazard, AREA_KINDS.casual.color, m.nogo].map((c, i) => <span key={i} className="w-2.5 h-4 rounded-sm border border-zinc-900" style={{ background: c }} />)}
              </span>
              {m.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Basket marks">
          {BASKET_MARKS.map(m => (
            <button
              key={m.value}
              role="radio"
              aria-checked={s.basketMark === m.value}
              data-testid={`basket-mark-${m.value}`}
              onClick={() => setStyle({ basketMark: m.value })}
              className={`rounded-lg border p-1 flex flex-col items-center gap-1 transition-colors ${s.basketMark === m.value ? "border-orange-500 bg-orange-500/10" : "border-white/[0.12] hover:border-zinc-500"}`}
            >
              <svg viewBox="0 0 40 40" className="w-10 h-10 rounded" style={{ background: s.fairway }} dangerouslySetInnerHTML={{ __html: basketMark(m.value, { x: 20, y: m.value === "flag" ? 30 : 20 }, 2, s.basket, "7") }} />
              <span className="text-[10px] font-semibold text-zinc-300">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-2">
          <ColorField label="Basket color" value={s.basket} onChange={(v, live) => setStyle({ basket: v }, !live)} onDone={done} />
          {s.markings !== "pdga" && <ColorField label="OB" value={s.ob} onChange={(v, live) => setStyle({ ob: v }, !live)} onDone={done} />}
          <ColorField label="Hazard" value={s.hazard} onChange={(v, live) => setStyle({ hazard: v }, !live)} onDone={done} />
        </div>
      </Section>
      <Section title="Sponsors" testid="print-sponsors" help="sponsors">
        <Sponsors />
      </Section>
        </>
      )}
      {tab === "map" && (whole ? <MapTools><ToolTitleFor />{mapPanel}</MapTools> : mapPanel)}
      {tab === "sign" && <PrintPanel t="sign" top={<TeeSignSettings />}>{toGeneral}</PrintPanel>}
      {tab === "page" && <PrintPanel t="page" top={<HolePageLook />}>{toGeneral}</PrintPanel>}
      {tab === "scorecard" && <PrintPanel t="card" top={<ScorecardSettings />}>{toGeneral}</PrintPanel>}
      <WholePanelOnly>
        <div className="px-4 py-3">
          <Button full onClick={() => useEditor.getState().set({ step: "export" })} testid="next-step">Next: Export <ArrowRight size={15} /></Button>
        </div>
      </WholePanelOnly>
    </>
  );
}

/** The open map tool's title and help, over its part. */
function ToolTitleFor() {
  const open = useContext(MapTool);
  return <OnlyGroup.Provider value={null}><ToolTitle help={open ? TOOL_HELP[open] : undefined} /></OnlyGroup.Provider>;
}
