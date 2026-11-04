// The tools along the bottom of the map, with the active tool's options and a hint above them.
import { holeBaskets, holeLabel, holeTees } from "../lib/course";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { create } from "zustand";
import { Armchair, Brush, Mountain, Circle, CircleDot, Ellipsis, Fence, Footprints, House, LandPlot, MousePointer2, MousePointerClick, PenLine, RectangleHorizontal, Redo2, Route, Ruler, ShieldAlert, Shrub, Signpost, Spline, Sprout, Square, Tally2, Target, TreeDeciduous, Trees, Type, Undo2, UtilityPole, Waves, X } from "lucide-react";
import { amenitySymbol, structureLegend, symbolSvg } from "../lib/symbols";
import { AMENITY_KINDS, AMENITY_ORDER, AREA_KINDS, FIELD_KINDS, LINE_KINDS, PIN_POSITIONS, STRUCTURE_KINDS, TEE_LEVELS, TEE_ORDER } from "../constants";
import { FIELD_ORDER, fieldWord } from "../lib/fields";
import { fieldIcon } from "./fieldIcons";
import { getDoc, useCourse, useEditor } from "../state/course";
import { getView } from "../state/view";
import type { AmenityKind, AreaKind, CourseDoc, DrawShape, FieldKind, LineKind, StructureKind, TeeLevel, ToolMode, TreeKind } from "../types";
import { useTouch } from "./useLayout";
import { fmtDist } from "../lib/units";
import { HelpLink, PickRow } from "./ui";
import { PANEL_INSET, useSelection } from "./Inspector";
import { DrawBar } from "./DrawBar";
import { TREE_KINDS } from "./TreeSettings";
import { SPECIES } from "../three/ezShapes";

/** A built thing's map symbol, small (for the tool's chips and the Features list). */
export const structureIcon = (kind: StructureKind, size: number, id: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" style="overflow:visible;display:block">${structureLegend(kind, 16, 16, 0.9, undefined, id)}</svg>`;

type Editor = ReturnType<typeof useEditor.getState>;

/** How a choice's color shows on its chip: a filled square for an area, a stroke for a line
 * (dashed for the next-tee route), a dot otherwise. */
type Swatch = "area" | "line" | "dashed";
/** One thing a tool puts on the course: how it's drawn (an area, a line, a spot) and of what kind;
 * `also`, another way it can be drawn (a field: at its usual size with a click, or by its corners). */
export type ToolChoice = { id: string; label: string; mode: ToolMode; also?: ToolMode; set: Partial<Editor>; color?: string; swatch?: Swatch; icon?: ReactNode; is?: (ed: Editor) => boolean };
/** A tool: named for what goes on the course (not for how it's drawn), so a fence is under Build and a
 * road under Paths and roads. `choices`: what it has, each drawn its own way; `mode` the first's. */
export type Tool = { id: string; mode: ToolMode; key: string; label: string; short: string; icon: ReactNode; group: number; choices?: ToolChoice[] };

const area = (k: AreaKind, label = AREA_KINDS[k].label): ToolChoice => ({ id: `area-kind-${k}`, label, mode: "draw-area", set: { areaKind: k }, color: AREA_KINDS[k].color, swatch: "area" });
const line = (k: LineKind, label: string, icon?: ReactNode): ToolChoice => ({ id: `line-kind-${k}`, label, mode: "draw-line", set: { lineKind: k }, color: icon ? undefined : LINE_KINDS[k].color, swatch: k === "walk" ? "dashed" : "line", icon });
const built = (k: StructureKind): ToolChoice => ({ id: `structure-kind-${k}`, label: STRUCTURE_KINDS[k].label, mode: "draw-structure", set: { structureKind: k }, icon: <span className="inline-block" dangerouslySetInnerHTML={{ __html: structureIcon(k, 16, `chip-${k}`) }} /> });
// (a tree at a time, or a stand of that kind drawn as woods)
const tree = (k: TreeKind, label: string, icon: ReactNode): ToolChoice => ({
  id: `tree-kind-${k}`, label, mode: "add-tree", also: "draw-area", set: { treeKind: k }, icon,
  is: ed => ed.treeKind === k && (ed.tool === "add-tree" || (ed.tool === "draw-area" && ed.areaKind === "woods" && ed.standOf === k))
});
const field = (k: FieldKind): ToolChoice => ({ id: `field-kind-${k}`, label: FIELD_KINDS[k].label, mode: "add-field", also: "draw-area", set: { areaKind: "field", fieldKind: k }, icon: fieldIcon(k) });

export const TOOLS: Tool[] = [
  { id: "select", mode: "select", key: "V", label: "Select and move", short: "Select", icon: <MousePointer2 size={18} />, group: 0 },
  { id: "hole", mode: "add-hole", key: "H", label: "New hole: click the tee, then the basket", short: "Hole", icon: <Route size={18} />, group: 1 },
  { id: "tee", mode: "add-tee", key: "T", label: "Another tee for this hole", short: "Tee", icon: <RectangleHorizontal size={18} />, group: 1 },
  { id: "pin", mode: "add-basket", key: "B", label: "Another pin position for this hole", short: "Pin", icon: <Target size={18} />, group: 1 },
  {
    id: "rules", mode: "draw-area", key: "O", label: "OB and rules: OB areas and lines, hazards, casual areas, out of play, mandos, drop zones", short: "OB & rules", icon: <ShieldAlert size={18} />, group: 2,
    choices: [
      area("ob"), line("ob", "OB line"), area("hazard"), area("casual"), area("nogo"),
      { id: "mando-kind-single", label: "Mando", mode: "add-mando", set: { mandoKind: "single" }, icon: <Signpost size={14} /> },
      { id: "mando-kind-gate", label: "Mando gate", mode: "add-mando", set: { mandoKind: "gate" }, icon: <Tally2 size={14} /> },
      { id: "dropzone-kind", label: "Drop zone", mode: "add-dropzone", set: {}, icon: <CircleDot size={14} /> }
    ]
  },
  { id: "paths", mode: "draw-line", key: "L", label: "Paths and roads: walking paths, next-tee routes, roads, parking", short: "Paths & roads", icon: <Footprints size={18} />, group: 3, choices: [line("path", "Walking path"), line("walk", "Next-tee route"), line("road", "Road"), area("parking")] },
  { id: "water", mode: "draw-area", key: "W", label: "Water: ponds, lakes and streams", short: "Water", icon: <Waves size={18} />, group: 3, choices: [area("water"), line("stream", "Stream")] },
  {
    id: "trees", mode: "add-tree", key: "R", label: "Trees and woods: a tree at a time, a stand of woods, or a hedge", short: "Trees", icon: <TreeDeciduous size={18} />, group: 3,
    choices: [
      ...TREE_KINDS.map(k => tree(k.value, k.label, k.icon)),
      { ...area("woods"), set: { areaKind: "woods", standOf: null }, color: undefined, swatch: undefined, icon: <Trees size={14} /> },
      line("hedge", "Hedge", <Shrub size={14} />)
    ]
  },
  { id: "grass", mode: "draw-area", key: "U", label: "Grass: fairways, landing zones, tall grass, sand and dirt", short: "Grass", icon: <Sprout size={18} />, group: 3, choices: [area("fairway"), area("green"), area("rough"), area("sand")] },
  {
    id: "build", mode: "draw-structure", key: "S", label: "Build: buildings, shelters, decks, bridges, boardwalks, stairs, walls, fences, power lines", short: "Build", icon: <House size={18} />, group: 3,
    choices: [built("building"), built("shelter"), built("deck"), built("bridge"), built("boardwalk"), built("stairs"), built("wall"), line("fence", "Fence", <Fence size={14} />), line("power", "Power line", <UtilityPole size={14} />)]
  },
  { id: "park", mode: "add-field", key: "P", label: "Park: ball fields, courts, playgrounds, pools and more", short: "Park", icon: <LandPlot size={18} />, group: 3, choices: FIELD_ORDER.map(field) },
  { id: "amenities", mode: "add-amenity", key: "A", label: "Amenities: bench, trash can, sign, parking…", short: "Amenities", icon: <Armchair size={18} />, group: 4 },
  { id: "label", mode: "add-label", key: "K", label: "Text label", short: "Label", icon: <Type size={18} />, group: 4 },
  { id: "ground", mode: "sculpt", key: "G", label: "Shape the ground: paint to raise, lower, flatten, smooth or restore it", short: "Ground", icon: <Mountain size={18} />, group: 5 },
  { id: "measure", mode: "measure", key: "D", label: "Measure distance and elevation", short: "Measure", icon: <Ruler size={18} />, group: 5 }
];

/** Keys that go straight to one of a tool's choices. */
export const CHOICE_KEYS: Record<string, string> = { M: "mando-kind-single", Z: "dropzone-kind" };

/** Each tool's page in the help guide (its ? beside the hint), and the choices with a page of their own. */
const TOOL_HELP: Record<string, string> = {
  select: "pointer", hole: "new-hole", tee: "tees-pins", pin: "tees-pins", rules: "ob", paths: "lines", water: "areas", trees: "trees",
  grass: "areas", build: "build", park: "park", amenities: "amenities", label: "amenities", ground: "ground", measure: "measure"
};
const CHOICE_HELP: Record<string, string> = {
  "mando-kind-single": "mando", "mando-kind-gate": "mando", "dropzone-kind": "mando", "area-kind-woods": "woods", "line-kind-stream": "lines", "line-kind-fence": "lines",
  "line-kind-hedge": "lines", "line-kind-power": "lines"
};
/** The help topic for the tool in use (for a ? by its hint): the choice's own page first. */
export const toolHelp = (ed: Editor) => {
  const t = toolOf(ed);
  const c = choiceOf(ed);
  return (c && CHOICE_HELP[c.id]) ?? (t ? TOOL_HELP[t.id] : undefined);
};

const matches = (ed: Editor, c: ToolChoice) => c.is ? c.is(ed) : (ed.tool === c.mode || ed.tool === c.also) && Object.entries(c.set).every(([k, v]) => (ed as Record<string, unknown>)[k] === v);
/** The tool in use: the one whose choice is being drawn (or, a kind no tool lists, the first that draws that way). */
export const toolOf = (ed: Editor): Tool | undefined =>
  TOOLS.find(t => (t.choices ? t.choices.some(c => matches(ed, c)) : t.mode === ed.tool)) ?? TOOLS.find(t => t.choices?.some(c => c.mode === ed.tool));
/** The choice of the tool in use being drawn. */
export const choiceOf = (ed: Editor) => toolOf(ed)?.choices?.find(c => matches(ed, c));

// (each tool picks up again with what it last drew, and a field the way it was last put down)
const lastChoice = new Map<string, ToolChoice>();
let fieldWay: { tool: ToolMode; shape?: DrawShape } = { tool: "add-field" };
// (and trees a tree at a time, or a stand drawn the way it was last)
let treeWay: DrawShape | null = null;
const plant = (k: TreeKind, shape: DrawShape | null): Partial<Editor> =>
  shape ? { tool: "draw-area", areaKind: "woods", standOf: k, treeKind: k, drawShape: shape } : { tool: "add-tree", treeKind: k, standOf: null };
/** Draw this choice (its tool comes forward); `remember`: the tool picks up with it next time
 * (not for a key that goes straight to it, like Z for a drop zone: O still gives what O last did). */
export const drawChoice = (c: ToolChoice, remember = true) => {
  const ed = useEditor.getState();
  const t = TOOLS.find(x => x.choices?.includes(c));
  if (t && remember) lastChoice.set(t.id, c);
  const set: Partial<Editor> = { tool: c.mode, ...c.set };
  if (c.also && c.mode === "add-field" && fieldWay.tool === c.also) Object.assign(set, { tool: c.also, drawShape: fieldWay.shape ?? "points" });
  if (c.mode === "add-tree" && c.set.treeKind) Object.assign(set, plant(c.set.treeKind, treeWay));
  // (built things: outlines by a box, a bridge or wall along its line, as before)
  if (c.mode === "draw-structure" && c.set.structureKind) set.drawShape = STRUCTURE_KINDS[c.set.structureKind].shape === "outline" ? "box" : "points";
  ed.set(set);
};
/** Take up a tool: what it last drew, or its first choice. */
export const pickTool = (t: Tool) => {
  if (!t.choices) { useEditor.getState().set({ tool: t.mode }); return; }
  drawChoice(lastChoice.get(t.id) ?? t.choices[0]);
};

/** The color a new tee for the hole goes down in, as placing it does: the one picked, or the first
 * the hole hasn't got when it has that one already. */
export const teeLevelFor = (doc: Pick<CourseDoc, "items">, holeId: string | null | undefined, wanted: TeeLevel): TeeLevel => {
  if (!holeId) return wanted;
  const taken = new Set(holeTees(doc, holeId).map(t => t.level));
  return taken.has(wanted) ? TEE_ORDER.find(l => !taken.has(l)) ?? wanted : wanted;
};

/** What to do first with each tool, with "Click" or "Tap" in front (the drawing bar has Undo,
 * Cancel and Done). */
const HINTS: Partial<Record<ToolMode, string>> = {
  "add-hole": "where the tee goes, then where the basket goes. Keep going for the next hole",
  "add-tee": "to add another tee to the selected hole",
  "add-basket": "to add another pin position (B, C…) to the selected hole",
  "add-mando": "beside the hole's line where the post or tree is",
  "add-dropzone": "to place a drop zone",
  "draw-area": "the corners",
  "draw-line": "along the line",
  "draw-structure": "along it, end to end",
  "add-label": "where the label goes"
};

const SHAPES: Record<DrawShape, { label: string; title: string; icon: ReactNode }> = {
  points: { label: "Points", title: "Click each corner or bend", icon: <Spline size={13} /> },
  box: { label: "Rectangle", title: "Drag a rectangle", icon: <Square size={13} /> },
  circle: { label: "Circle", title: "Drag from the middle out", icon: <Circle size={13} /> },
  freehand: { label: "Freehand", title: "Drag to draw", icon: <PenLine size={13} /> },
  paint: { label: "Paint", title: "Paint it on with a brush", icon: <Brush size={13} /> }
};

/** The brush's size and strength, small, beside the tool's other choices. */
const BrushSliders = ({ ed, strength = true }: { ed: Editor; strength?: boolean }) => {
  const units = useCourse(s => s.doc.units);
  return (
    <div key="brush" className="flex shrink-0 touch:flex-1 items-center gap-3 glass ring-1 ring-white/10 rounded-full px-3 py-1 touch:py-1.5 touch:min-h-[44px] touch:justify-between" data-testid="brush-sliders">
      <label className="flex items-center gap-1.5 text-xs touch:text-[13px] text-zinc-300 whitespace-nowrap">Brush
        <input type="range" aria-label="Brush size" min={4} max={150} step={1} value={ed.brushSize} onChange={e => ed.set({ brushSize: Number(e.target.value) })} className="slider w-20 touch:w-24" style={{ ["--fill" as string]: `${((ed.brushSize - 4) / 146) * 100}%` }} />
        <span className="tabular-nums w-12">{fmtDist(ed.brushSize * 2, units)}</span>
      </label>
      {strength && (
        <label className="flex items-center gap-1.5 text-xs touch:text-[13px] text-zinc-300 whitespace-nowrap">Strength
          <input type="range" aria-label="Brush strength" min={1} max={10} step={1} value={ed.brushStrength} onChange={e => ed.set({ brushStrength: Number(e.target.value) })} className="slider w-16 touch:w-20" style={{ ["--fill" as string]: `${((ed.brushStrength - 1) / 9) * 100}%` }} />
          <span className="tabular-nums w-4">{ed.brushStrength}</span>
        </label>
      )}
    </div>
  );
};

/** What the brush does to areas, as the Ground tool's row has for the ground. */
const AREA_BRUSHES = [
  { value: "add", label: "Add", title: "Paints it on: from inside an area it grows that one, from open ground it's a new one" },
  { value: "remove", label: "Remove", title: "Takes it away where you paint, however it was drawn" },
  { value: "thinner", label: "Thinner", title: "A step thinner where you paint (heavy to medium, medium to light, light to none)" },
  { value: "thicker", label: "Thicker", title: "A step thicker where you paint" },
  { value: "restore", label: "Restore", title: "Puts back the underbrush the import found, wherever you paint" }
] as const;
/** The brush's row for areas: what it does (levels only for underbrush and woods; Restore only for
 * underbrush that came in with the site), and, reshaping one area, which and a way out. */
function AreaBrushes({ ed }: { ed: Editor }) {
  const found = useCourse(s => !!s.doc.site.brushFound);
  const own = useCourse(s => (ed.reshapeId ? s.doc.items.find(i => i.id === ed.reshapeId) : undefined));
  const kind = own && own.type === "area" ? own.kind : ed.areaKind;
  const brush = own && own.type === "area" ? (own.bushes ?? 0) >= 1 : ed.standOf === "bush";
  const modes = AREA_BRUSHES.filter(m => (m.value !== "thinner" && m.value !== "thicker") || kind === "woods").filter(m => m.value !== "restore" || (brush && found));
  const now = modes.some(m => m.value === ed.areaBrush) ? ed.areaBrush : "add";
  return (
    <>
      <div className={`${GROUP} mr-1`} role="radiogroup" aria-label="What the brush does" data-testid="area-brushes">
        {modes.map(m => (
          <button key={m.value} role="radio" aria-checked={now === m.value} title={m.title} data-testid={`area-brush-${m.value}`} onClick={() => ed.set({ areaBrush: m.value })} className={`${radio(now === m.value)} px-2.5 touch:px-3`}>{m.label}</button>
        ))}
      </div>
      {own && (
        <div className={GROUP} data-testid="reshaping">
          <span className={`${RADIO} text-zinc-300`}>Just this {brush ? "underbrush" : kind === "woods" ? "wood" : AREA_KINDS[kind].label.toLowerCase()}</span>
          <button className={`${RADIO} text-orange-300 hover:bg-white/[0.09]`} onClick={() => ed.set({ tool: "select", reshapeId: null })} data-testid="reshape-done">Done</button>
        </div>
      )}
    </>
  );
}

const GROUND_BRUSHES = [
  { value: "raise", label: "Raise", title: "Builds the ground up under the brush" },
  { value: "lower", label: "Lower", title: "Digs the ground down under the brush" },
  { value: "flatten", label: "Flatten", title: "Levels the ground to the height where the stroke starts" },
  { value: "smooth", label: "Smooth", title: "Evens out bumps and steps, keeping the overall slope" },
  { value: "restore", label: "Restore", title: "Puts the ground back to its height as measured, wherever you've changed it" }
] as const;
const SHAPE_HINTS: Record<DrawShape, string> = {
  points: "",
  box: "Drag a rectangle",
  circle: "Drag from the middle out",
  freehand: "Drag to draw",
  paint: "Paint the area on with the brush"
};
const TOUCH_SHAPE_HINTS: Record<DrawShape, string> = {
  points: "",
  box: "Tap one corner, then the opposite corner",
  circle: "Tap the middle, then the edge",
  freehand: "Draw with one finger; lift it to finish",
  paint: "Paint the area on with one finger, a stroke at a time"
};

/** A color's mark on a chip: a filled square for an area, a stroke for a line, a dot otherwise. */
const SwatchMark = ({ color, swatch }: { color: string; swatch?: Swatch }) =>
  swatch === "area" ? <span className="w-2.5 h-2.5 rounded-[2px] border border-black/30" style={{ background: color }} />
  : swatch === "line" ? <span className="w-3 h-[3px] rounded-full" style={{ background: color }} />
  : swatch === "dashed" ? <span className="w-3 border-t-2 border-dashed" style={{ borderColor: color }} />
  : <span className="w-2.5 h-2.5 rounded-full border border-black/30" style={{ background: color }} />;

// (a finger's size on a touch screen: 44 px chips, 40 px buttons inside a group)
const Chip = ({ active, onClick, children, color, swatch, testid, title, dim }: { active: boolean; onClick: () => void; children: ReactNode; color?: string; swatch?: Swatch; testid?: string; title?: string; dim?: boolean }) => (
  <button
    onClick={onClick}
    data-testid={testid}
    title={title}
    className={`flex items-center gap-1.5 px-2.5 py-1 touch:py-2 touch:px-3 touch:min-h-[44px] touch:text-[13px] shrink-0 whitespace-nowrap rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${active ? "bg-zinc-100 text-zinc-900" : "glass text-zinc-300 ring-1 ring-white/10 hover:bg-white/[0.09]"} ${dim && !active ? "opacity-50" : ""}`}
  >
    {color && <SwatchMark color={color} swatch={swatch} />}
    {children}
  </button>
);

/** A choice inside a group of them (how to draw, what the brush does, how to measure). */
const RADIO = "flex items-center gap-1 px-2 py-0.5 touch:py-1.5 touch:px-2.5 touch:min-h-[40px] touch:text-[13px] whitespace-nowrap rounded-full text-xs font-semibold";
const radio = (on: boolean) => `${RADIO} ${on ? "bg-orange-500 text-zinc-950" : "text-zinc-300 hover:bg-white/[0.09]"}`;
const GROUP = "flex shrink-0 gap-0.5 glass ring-1 ring-white/10 rounded-full p-0.5";

/** The active tool's options (tee colors, kinds of area or line, the ground brush…), or null. */
export function toolOptions(ed: Editor): ReactNode[] | null {
  const set = ed.set;
  const kit = toolOf(ed);
  if (kit?.choices) return kit.choices.map(c => <Chip key={c.id} active={matches(ed, c)} color={c.color} swatch={c.swatch} onClick={() => drawChoice(c)} testid={c.id}>{c.icon}{c.label}</Chip>);
  switch (ed.tool) {
    case "add-hole":
    case "add-tee": {
      // (another tee: the colors the hole has already are dimmed, as a new one goes down in the
      // first color it hasn't got)
      const doc = getDoc();
      const hole = ed.tool === "add-tee" && !ed.holeToBasket ? doc.holes.find(h => h.id === ed.activeHoleId) : undefined;
      const has = new Set(hole ? holeTees(doc, hole.id).map(t => t.level) : []);
      return TEE_ORDER.map(l => <Chip key={l} active={ed.teeLevel === l} dim={has.has(l)} title={hole && has.has(l) ? `Hole ${holeLabel(doc, hole.id)} has a ${TEE_LEVELS[l].label.toLowerCase()} tee already` : `${TEE_LEVELS[l].skill} (${TEE_LEVELS[l].rating})`} color={TEE_LEVELS[l].color} onClick={() => set({ teeLevel: l })} testid={`tee-level-${l}`}>{TEE_LEVELS[l].label}</Chip>);
    }
    case "sculpt":
      return [
        <div key="ground" className={`${GROUP} mr-1`} role="radiogroup" aria-label="What the brush does">
          {GROUND_BRUSHES.map(g => (
            <button key={g.value} role="radio" aria-checked={ed.groundBrush === g.value} title={g.title} data-testid={`ground-${g.value}`} onClick={() => set({ groundBrush: g.value })} className={`${radio(ed.groundBrush === g.value)} px-2.5 touch:px-3`}>{g.label}</button>
          ))}
        </div>,
        <BrushSliders key="brush" ed={ed} />
      ];
    case "add-amenity":
      // (bridges and shelters are built with Build, so their old map signs aren't offered, unless
      // one is what's picked; a parking lot is drawn with Paths and roads, so here it's the sign)
      return [...AMENITY_ORDER, ...(AMENITY_ORDER.includes(ed.amenityKind) ? [] : [ed.amenityKind])].map(k => (
        <Chip key={k} active={ed.amenityKind === k} testid={`amenity-kind-${k}`} onClick={() => set({ amenityKind: k })}>
          <span className="inline-block" dangerouslySetInnerHTML={{ __html: symbolSvg(amenitySymbol(k, { x: 0, y: 0 }, 1), 16, k === "here" ? 22 : 16) }} />
          {k === "here" ? "You are here" : AMENITY_KINDS[k].pick ?? AMENITY_KINDS[k].label}
        </Chip>
      ));
    case "measure": {
      const mode = ed.measureMode ?? "spot";
      return [
        <div key="measure" className={GROUP} role="radiogroup" aria-label="How to measure">
          {(["spot", "path"] as const).map(m => (
            <button key={m} role="radio" aria-checked={mode === m} data-testid={`measure-${m}`} onClick={() => set({ measureMode: m })} className={radio(mode === m)}>{m === "spot" ? "From one spot" : "Along a path"}</button>
          ))}
        </div>,
        <Chip key="clear" active={false} onClick={() => getView()?.clearMeasure()} testid="measure-clear"><X size={13} />Clear</Chip>
      ];
    }
    default:
      return null;
  }
}

/** Which species the Trees tool plants, leafy or pine: any of the course's kinds, or one. */
function TreeSpeciesPick({ ed }: { ed: Editor }) {
  const kind = ed.treeKind;
  const list = SPECIES[kind === "conifer" ? "conifer" : "broadleaf"];
  const now = ed.treeSpecies[kind] ?? null;
  const pick = (id: string | null) => ed.set({ treeSpecies: { ...ed.treeSpecies, [kind]: id ?? undefined } });
  return (
    <div className={`${GROUP} max-w-full overflow-x-auto dg-noscrollbar`} role="radiogroup" aria-label="Species" data-testid="tree-species">
      <button role="radio" aria-checked={now === null} title="One of the course's kinds of trees, as the woods grow" onClick={() => pick(null)} className={radio(now === null)} data-testid="tree-species-any">Any kind</button>
      {list.map(sp => (
        <button key={sp.id} role="radio" aria-checked={now === sp.id} onClick={() => pick(sp.id)} className={`${radio(now === sp.id)} whitespace-nowrap`} data-testid={`tree-species-${sp.id}`}>{sp.label}</button>
      ))}
    </div>
  );
}

/** How the active tool draws (point by point, or a rectangle, a circle, freehand, painted), with
 * the brush's size while painting: a row of its own under the kinds. Null when it draws one way. */
export function toolShapes(ed: Editor): ReactNode[] | null {
  // (trees: one where you click, or a stand of them drawn like any area)
  if (ed.tool === "add-tree" || (ed.tool === "draw-area" && ed.areaKind === "woods" && ed.standOf)) {
    const ways: (DrawShape | null)[] = [null, "points", "box", "circle", "freehand", "paint"];
    const now = ed.tool === "add-tree" ? null : ed.drawShape;
    return [
      <div key="shapes" className={GROUP} role="radiogroup" aria-label="How to plant">
        {ways.map(w => (
          <button key={w ?? "one"} role="radio" aria-checked={now === w} data-testid={`draw-shape-${w ?? "one"}`} title={w ? `A stand of them: ${SHAPES[w].title.toLowerCase()}` : "Click where each tree goes"}
            onClick={() => { treeWay = w; ed.set(plant(ed.treeKind, w)); }} className={radio(now === w)}>
            {w ? <>{SHAPES[w].icon}{SHAPES[w].label}</> : <><MousePointerClick size={13} />One tree</>}
          </button>
        ))}
      </div>,
      ...(now === "paint" ? [<AreaBrushes key="modes" ed={ed} />, <BrushSliders key="brush" ed={ed} strength={false} />] : []),
      ...(ed.treeKind === "bush" ? [] : [<TreeSpeciesPick key="species" ed={ed} />])
    ];
  }
  // (a field: at its usual size with one click, or by its corners, or as a rectangle)
  if (ed.tool === "add-field" || (ed.tool === "draw-area" && ed.areaKind === "field")) {
    const ways: { id: string; tool: ToolMode; shape?: DrawShape; label: string; title: string; icon: ReactNode }[] = [
      { id: "usual", tool: "add-field", label: "Usual size", title: "Click where it goes", icon: <MousePointerClick size={13} /> },
      { id: "points", tool: "draw-area", shape: "points", ...SHAPES.points },
      { id: "box", tool: "draw-area", shape: "box", ...SHAPES.box }
    ];
    return [
      <div key="shapes" className={GROUP} role="radiogroup" aria-label="How to draw">
        {ways.map(w => {
          const on = ed.tool === w.tool && (!w.shape || ed.drawShape === w.shape);
          return (
            <button key={w.id} role="radio" aria-checked={on} data-testid={`draw-shape-${w.id}`} title={w.title} onClick={() => { fieldWay = { tool: w.tool, shape: w.shape }; ed.set({ tool: w.tool, ...(w.shape ? { drawShape: w.shape } : {}) }); }} className={radio(on)}>
              {w.icon}{w.label}
            </button>
          );
        })}
      </div>
    ];
  }
  const list: DrawShape[] | null = ed.tool === "draw-area" ? ["points", "box", "circle", "freehand", "paint"]
    : ed.tool === "draw-line" ? ["points", "freehand"]
    : ed.tool === "draw-structure" ? (STRUCTURE_KINDS[ed.structureKind].shape === "outline" ? ["points", "box", "circle", "freehand"] : ["points", "freehand"])
    : null;
  if (!list) return null;
  return [
    <div key="shapes" className={GROUP} role="radiogroup" aria-label="How to draw">
      {list.map(sh => {
        // (Lines can't be rectangles or circles: those draw freehand)
        const on = ed.drawShape === sh || (sh === "freehand" && !list.includes(ed.drawShape));
        return (
          <button key={sh} role="radio" aria-checked={on} data-testid={`draw-shape-${sh}`} title={SHAPES[sh].title} onClick={() => ed.set({ drawShape: sh })} className={radio(on)}>
            {SHAPES[sh].icon}{SHAPES[sh].label}
          </button>
        );
      })}
    </div>,
    ...(ed.tool === "draw-area" && ed.drawShape === "paint" ? [<AreaBrushes key="modes" ed={ed} />, <BrushSliders key="brush" ed={ed} strength={false} />] : [])
  ];
}

/** What a placed amenity is called in the hint ("Click where the bench goes"). */
const amenityName = (k: AmenityKind) =>
  k === "here" ? "You are here mark" : k === "parking" ? "parking sign" : k === "kiosk" ? "map board" : k === "firstaid" ? "first aid sign" : AMENITY_KINDS[k].label.toLowerCase();
const TREE_PLURAL: Partial<Record<TreeKind, string>> = { deciduous: "leafy trees", conifer: "conifers", bush: "bushes" };
const TREE_STAND: Partial<Record<TreeKind, string>> = { deciduous: "stand of leafy trees", conifer: "stand of conifers", bush: "patch of bushes" };

/** What to do with the active tool, worded for a mouse and keys or for a touch screen. */
export function toolHint(ed: Editor, touch = false): string | undefined {
  const click = touch ? "Tap" : "Click";
  if (ed.tool === "add-tee" || ed.tool === "add-basket") {
    const doc = getDoc();
    if (ed.tool === "add-tee" && ed.holeToBasket) {
      const b = doc.items.find(i => i.id === ed.holeToBasket);
      const of = b && "holeId" in b && b.holeId ? ` hole ${holeLabel(doc, b.holeId)}'s` : " that";
      return `${click} where the new hole's tee goes. It will play to${of} basket.`;
    }
    const hole = doc.holes.find(h => h.id === ed.activeHoleId);
    if (!hole) return `Pick a hole first, then ${click.toLowerCase()} where its ${ed.tool === "add-tee" ? "new tee" : "new pin"} goes`;
    const n = holeLabel(doc, hole.id);
    // (named as it will go down: a color the hole has already moves on to the next it hasn't)
    if (ed.tool === "add-tee") return `${click} where hole ${n}'s ${TEE_LEVELS[teeLevelFor(doc, hole.id, ed.teeLevel)].label.toLowerCase()} tee goes`;
    const taken = new Set(holeBaskets(doc, hole.id).map(b => b.position));
    const next = PIN_POSITIONS.find(x => !taken.has(x));
    return next ? `${click} where hole ${n}'s pin ${next} goes` : `Hole ${n} has pins ${PIN_POSITIONS[0]} to ${PIN_POSITIONS[PIN_POSITIONS.length - 1]} already`;
  }
  const drawing = ed.tool === "draw-area" || ed.tool === "draw-line" || ed.tool === "draw-structure";
  const lineDrawn = ed.tool === "draw-line" || (ed.tool === "draw-structure" && STRUCTURE_KINDS[ed.structureKind].shape === "line");
  const shape = lineDrawn && (ed.drawShape === "box" || ed.drawShape === "circle") ? "freehand" : ed.drawShape;
  // (the brush on areas: what a stroke does, as the Ground tool says)
  if (ed.tool === "draw-area" && shape === "paint") {
    const levels = ed.areaKind === "woods", restore = ed.standOf === "bush" && !!getDoc().site.brushFound;
    const mode = (ed.areaBrush === "thinner" || ed.areaBrush === "thicker") && !levels ? "add" : ed.areaBrush === "restore" && !restore ? "add" : ed.areaBrush;
    const what = ed.reshapeId
      ? { add: "add to it", remove: "take from it", thinner: "make part of it a step thinner", thicker: "make part of it a step thicker", restore: "put back what the import found in it" }[mode]
      : { add: "paint it on (inside one, it grows that one)", remove: "take it away", thinner: "make it a step thinner", thicker: "make it a step thicker", restore: "put back what the import found" }[mode];
    return touch ? `One finger to ${what} · two fingers move the map` : `Drag to ${what} · Space+drag moves the map`;
  }
  if (drawing && shape !== "points") return (touch ? TOUCH_SHAPE_HINTS : SHAPE_HINTS)[shape];
  if (ed.tool === "select") {
    // (none with Select itself on a computer: the map stays clear; its gestures are in the shortcuts dialog)
    if (ed.dragSelect) return touch ? "Drag a box around things · tap to add or take one out · two fingers move the map" : "Drag a box around things · Shift+click adds or takes one out · Space+drag moves the map";
    return touch ? "Drag to pan · pinch to zoom · two fingers to turn and tilt · hold on a thing for its menu" : undefined;
  }
  if (ed.tool === "add-mando" && ed.mandoKind === "gate") return `${click} on the hole's line where the gate is`;
  if (ed.tool === "draw-structure" && ed.structureKind === "bridge") return `${click} one bank, then the other`;
  if (ed.tool === "draw-structure" && !lineDrawn) return `${click} ${HINTS["draw-area"]}`;
  if (ed.tool === "add-tree") return `${click} to plant ${TREE_PLURAL[ed.treeKind] ?? "trees"}`;
  if (ed.tool === "draw-area" && ed.areaKind === "woods" && ed.standOf) return `${click} the corners of the ${TREE_STAND[ed.standOf] ?? "stand of trees"}`;
  if (ed.tool === "add-amenity") return `${click} where the ${amenityName(ed.amenityKind)} goes`;
  if (ed.tool === "add-field") return `${click} where the ${fieldWord(ed.fieldKind)} goes`;
  if (ed.tool === "measure") return (ed.measureMode ?? "spot") === "path" ? `${click} along the path` : `${click} a start point`;
  if (ed.tool === "sculpt") return touch ? "Paint the ground with one finger · two fingers move the map" : `Drag over the ground to paint it · Space+drag ${ed.teeView ? "looks around" : "moves the map"}`;
  const h = HINTS[ed.tool];
  return h && `${click} ${h}`;
}

/** The tools a step is about; the rest wait under More (and come forward while in use). */
export const STEP_TOOLS: Record<string, string[]> = {
  site: ["select", "paths", "water", "trees", "grass", "build", "park", "ground", "measure"],
  design: ["select", "hole", "tee", "pin", "rules", "paths", "water", "trees", "grass", "build", "park", "ground", "measure"],
  export: ["select"]
};
/** Under 1280 px wide, these wait under More too. */
const ROOMY_ONLY = ["ground", "measure"];

const WIDE = "(min-width: 1280px)";
const onWide = (fn: () => void) => { const m = window.matchMedia?.(WIDE); m?.addEventListener("change", fn); return () => m?.removeEventListener("change", fn); };
const isWide = () => !!window.matchMedia?.(WIDE).matches;
const useWide = () => useSyncExternalStore(onWide, isWide, () => true);

/** How much of the map the tools take at its bottom (the toasts and the checks sit above them; 0
 * while they're not shown). */
export const useToolbarRoom = create<{ height: number }>(() => ({ height: 0 }));

/** The part of the map the panels over it leave clear, from its left and right edges (px, with a
 * 12 px gap): on Design, the hole list (or the picked thing's panel next to it) and the checks. On
 * the Site step its panel sits beside the map, not over it. */
export function useMapInsets() {
  const step = useEditor(e => e.step);
  const checks = useEditor(e => e.problemsOpen);
  const teeView = useEditor(e => !!e.teeView);
  const readOnly = useCourse(s => s.readOnly);
  const open = useSelection().open;
  const design = step === "design" && !readOnly;
  // (from a tee, the hole list is put away)
  return { left: design && !teeView ? (open ? PANEL_INSET : 196) : 12, right: design && checks ? 364 : 12 };
}

// (on a wide screen, each tool's name under its icon, its key only in the tooltip)
const BAR_BTN = "dg-toolbtn relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

export function Toolbar() {
  const ed = useEditor();
  const canUndo = useCourse(s => s.past.length > 0);
  const canRedo = useCourse(s => s.future.length > 0);
  const undo = useCourse(s => s.undo);
  const redo = useCourse(s => s.redo);
  const touch = useTouch();
  const wide = useWide();
  const inset = useMapInsets();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    // (Esc closes the menu, and only the menu: the tool and the selection stay)
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMore(false); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc, true); };
  }, [more]);
  // (its height, for the toasts and the checks to sit above it)
  const watch = useRef<ResizeObserver | null>(null);
  const measured = useCallback((el: HTMLDivElement | null) => {
    watch.current?.disconnect();
    watch.current = null;
    if (!el) { useToolbarRoom.setState({ height: 0 }); return; }
    watch.current = new ResizeObserver(() => useToolbarRoom.setState({ height: el.offsetHeight }));
    watch.current.observe(el);
  }, []);
  // (standing in 3D: there too, while not flying)
  if (ed.teeView && ed.flyover) return null;
  const options = toolOptions(ed);
  const shapes = toolShapes(ed);
  const hint = toolHint(ed, touch);
  const help = toolHelp(ed);
  const main = (STEP_TOOLS[ed.step] ?? STEP_TOOLS.design).filter(id => wide || !ROOMY_ONLY.includes(id));
  const active = toolOf(ed)?.id;
  const shown = TOOLS.filter(t => main.includes(t.id) || t.id === active);
  const rest = TOOLS.filter(t => !shown.includes(t));
  const tool = (t: Tool, inMenu = false) => (
    <button
      key={t.id}
      title={`${t.label} (${t.key})`}
      aria-label={t.label}
      aria-pressed={active === t.id}
      data-tool={t.id}
      onClick={() => { pickTool(t); setMore(false); }}
      className={inMenu
        ? `flex items-center gap-2.5 px-3 py-2 touch:min-h-[44px] rounded-lg text-sm text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${active === t.id ? "bg-orange-500 text-zinc-950" : "text-zinc-200 hover:bg-white/[0.09]"}`
        : `${BAR_BTN} ${active === t.id ? "bg-orange-500 text-zinc-950" : "text-zinc-300 hover:bg-white/[0.09] hover:text-zinc-50"}`}
    >
      {t.icon}
      {inMenu ? <span className="flex-1">{t.short}</span> : <span className="dg-toolname">{t.short}</span>}
      <span className={inMenu ? "text-[11px] opacity-60 touch:hidden" : "absolute bottom-0.5 right-1 text-[8px] font-bold opacity-60 touch:hidden min-[1280px]:hidden"}>{t.key}</span>
    </button>
  );
  return (
    // (centred on the part of the map the panels leave clear; the checks stop above it)
    <div ref={measured} className="absolute bottom-4 flex flex-col items-center gap-2 z-20 pointer-events-none" style={{ left: inset.left, right: 12 }}>
      <DrawBar />
      {options && <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5 max-w-[760px]" data-testid="tool-options">{options}</div>}
      {shapes && <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5 max-w-[760px]" data-testid="tool-shapes">{shapes}</div>}
      {hint && (
        <div className="pointer-events-auto flex items-center gap-2 text-xs text-zinc-100 glass backdrop-blur rounded-lg px-3 py-1.5 ring-1 ring-white/10 text-center" data-testid="tool-hint">
          <span>{hint}</span>
          {help && <HelpLink topic={help} label={toolOf(ed)?.short ?? "This tool"} />}
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-0.5 max-w-full glass backdrop-blur rounded-2xl px-1.5 py-1.5 shadow-xl shadow-black/40 ring-1 ring-white/10" role="toolbar" aria-label="Tools" data-testid="tool-bar">
        {shown.map((t, i) => (
          <div key={t.id} className="flex items-center shrink-0">
            {i > 0 && shown[i - 1].group !== t.group && <div className="w-px h-5 bg-white/[0.12] mx-1" />}
            {tool(t)}
          </div>
        ))}
        {rest.length > 0 && (
          <div className="relative shrink-0" ref={moreRef}>
            <button className={`${BAR_BTN} ${more ? "bg-white/[0.07] text-zinc-50" : "text-zinc-300 hover:bg-white/[0.09] hover:text-zinc-50"}`} title="More tools" aria-label="More tools" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(m => !m)} data-testid="more-tools"><Ellipsis size={18} /><span className="dg-toolname">More</span></button>
            {more && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 glass-solid rounded-xl shadow-xl shadow-black/40 ring-1 ring-white/10 p-1 flex flex-col" role="menu" data-testid="more-tools-menu">
                {rest.map(t => tool(t, true))}
              </div>
            )}
          </div>
        )}
        <div className="w-px h-5 bg-white/[0.12] mx-1 shrink-0" />
        {/* (while drawing, the last point first, as Ctrl+Z does) */}
        <button title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo && !ed.drawPoints && !ed.plotLine} onClick={() => { if (!getView()?.undoPoint()) undo(); }} className={`${BAR_BTN} shrink-0 text-zinc-300 hover:bg-white/[0.09] disabled:opacity-30`}><Undo2 size={18} /></button>
        <button title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo} className={`${BAR_BTN} shrink-0 text-zinc-300 hover:bg-white/[0.09] disabled:opacity-30`}><Redo2 size={18} /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------- the phone's bar

/** A setting as the glass bar takes it (mobile/GlassBar's BarSetting). */
type BarSettingLike = { id: string; name: string; value?: ReactNode; control?: ReactNode; wide?: boolean; run?: () => void; on?: boolean; icon?: ReactNode; testid?: string };

/** The active tool's settings for a phone's glass bar (mobile/GlassBar): what it puts down, how it
 * draws or plants it, what the brush does, the species; each a setting with its word and what it's
 * set to, opening the same choices as a computer's chips, as menu rows. The brush's size and the
 * ground brush's strength slide on the screen's edge instead (`edge`). */
export function phoneToolSettings(ed: Editor): { settings: BarSettingLike[]; edge: { size: boolean; strength: boolean } } {
  const set = ed.set;
  const kit = toolOf(ed);
  const out: BarSettingLike[] = [];
  type Row = { key: string; on: boolean; label: string; hint?: string; color?: string; icon?: ReactNode; pick: () => void; testid?: string };
  const menu = (rows: Row[], radio: string) => (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label={radio}>
      {rows.map(r => <PickRow key={r.key} on={r.on} onClick={r.pick} label={r.label} hint={r.hint} color={r.color} icon={r.icon} testid={r.testid} />)}
    </div>
  );
  // What it puts down
  if (kit?.choices) {
    const now = choiceOf(ed);
    out.push({ id: "kind", name: "Kind", value: now?.label ?? "", testid: "tool-options", control: menu(kit.choices.map(c => ({ key: c.id, on: matches(ed, c), label: c.label, color: c.color, icon: c.icon, pick: () => drawChoice(c), testid: c.id })), "Kind") });
  } else if (ed.tool === "add-hole" || ed.tool === "add-tee") {
    const doc = getDoc();
    const hole = ed.tool === "add-tee" && !ed.holeToBasket ? doc.holes.find(h => h.id === ed.activeHoleId) : undefined;
    const has = new Set(hole ? holeTees(doc, hole.id).map(t => t.level) : []);
    out.push({
      id: "kind", name: ed.tool === "add-hole" ? "First tee" : "Color", value: TEE_LEVELS[ed.teeLevel].label, testid: "tool-options",
      control: menu(TEE_ORDER.map(l => ({ key: l, on: ed.teeLevel === l, label: TEE_LEVELS[l].label, hint: hole && has.has(l) ? `Hole ${holeLabel(doc, hole.id)} has one already` : `${TEE_LEVELS[l].skill} (${TEE_LEVELS[l].rating})`, color: TEE_LEVELS[l].color, pick: () => set({ teeLevel: l }), testid: `tee-level-${l}` })), "Tee color")
    });
  } else if (ed.tool === "add-amenity") {
    const kinds = [...AMENITY_ORDER, ...(AMENITY_ORDER.includes(ed.amenityKind) ? [] : [ed.amenityKind])];
    const name = (k: AmenityKind) => (k === "here" ? "You are here" : AMENITY_KINDS[k].pick ?? AMENITY_KINDS[k].label);
    out.push({
      id: "kind", name: "Kind", value: name(ed.amenityKind), testid: "tool-options",
      control: menu(kinds.map(k => ({ key: k, on: ed.amenityKind === k, label: name(k), icon: <span className="inline-block" dangerouslySetInnerHTML={{ __html: symbolSvg(amenitySymbol(k, { x: 0, y: 0 }, 1), 18, k === "here" ? 24 : 18) }} />, pick: () => set({ amenityKind: k }), testid: `amenity-kind-${k}` })), "Kind")
    });
  } else if (ed.tool === "measure") {
    const mode = ed.measureMode ?? "spot";
    out.push({
      id: "how", name: "Measure", value: mode === "spot" ? "From one spot" : "Along a path", testid: "tool-options",
      control: menu((["spot", "path"] as const).map(m => ({ key: m, on: mode === m, label: m === "spot" ? "From one spot" : "Along a path", hint: m === "spot" ? "How far and how much it climbs from where you start" : "Its length along every bend", pick: () => set({ measureMode: m }), testid: `measure-${m}` })), "How to measure")
    });
    out.push({ id: "clear", name: "Measure", value: "Clear", icon: <X size={16} />, run: () => getView()?.clearMeasure(), testid: "measure-clear" });
  } else if (ed.tool === "sculpt") {
    out.push({
      id: "brush", name: "Brush", value: GROUND_BRUSHES.find(g => g.value === ed.groundBrush)?.label ?? "", testid: "tool-modes",
      control: menu(GROUND_BRUSHES.map(g => ({ key: g.value, on: ed.groundBrush === g.value, label: g.label, hint: g.title, pick: () => set({ groundBrush: g.value }), testid: `ground-${g.value}` })), "What the brush does")
    });
  }
  // How it draws or plants
  const shapeMenu = (ways: { id: string; label: string; hint: string; icon: ReactNode; on: boolean; pick: () => void }[], name: string) =>
    out.push({ id: "draw", name, value: ways.find(w => w.on)?.label ?? "", testid: "tool-shapes", control: menu(ways.map(w => ({ key: w.id, on: w.on, label: w.label, hint: w.hint, icon: w.icon, pick: w.pick, testid: `draw-shape-${w.id}` })), name) });
  const stand = ed.tool === "draw-area" && ed.areaKind === "woods" && !!ed.standOf;
  if (ed.tool === "add-tree" || stand) {
    const now = ed.tool === "add-tree" ? null : ed.drawShape;
    const ways: (DrawShape | null)[] = [null, "points", "box", "circle", "freehand", "paint"];
    shapeMenu(ways.map(w => ({
      id: w ?? "one", label: w ? (w === "points" ? "Corners" : SHAPES[w].label) : "One tree", hint: w ? `A stand of them: ${(TOUCH_SHAPE_HINTS[w] || "tap each corner").toLowerCase()}` : "Tap where each tree goes",
      icon: w ? SHAPES[w].icon : <MousePointerClick size={13} />, on: now === w, pick: () => { treeWay = w; set(plant(ed.treeKind, w)); }
    })), "Plant");
  } else if (ed.tool === "add-field" || (ed.tool === "draw-area" && ed.areaKind === "field")) {
    const ways: { id: string; tool: ToolMode; shape?: DrawShape; label: string; title: string; icon: ReactNode }[] = [
      { id: "usual", tool: "add-field", label: "Usual size", title: "Tap where it goes", icon: <MousePointerClick size={13} /> },
      { id: "points", tool: "draw-area", shape: "points", ...SHAPES.points, label: "Corners", title: "Tap each corner" },
      { id: "box", tool: "draw-area", shape: "box", ...SHAPES.box, title: TOUCH_SHAPE_HINTS.box }
    ];
    shapeMenu(ways.map(w => ({ id: w.id, label: w.label, hint: w.title, icon: w.icon, on: ed.tool === w.tool && (!w.shape || ed.drawShape === w.shape), pick: () => { fieldWay = { tool: w.tool, shape: w.shape }; set({ tool: w.tool, ...(w.shape ? { drawShape: w.shape } : {}) }); } })), "Draw");
  } else {
    const list: DrawShape[] | null = ed.tool === "draw-area" ? ["points", "box", "circle", "freehand", "paint"]
      : ed.tool === "draw-line" ? ["points", "freehand"]
      : ed.tool === "draw-structure" ? (STRUCTURE_KINDS[ed.structureKind].shape === "outline" ? ["points", "box", "circle", "freehand"] : ["points", "freehand"])
      : null;
    if (list) shapeMenu(list.map(sh => ({
      id: sh, label: sh === "points" ? "Corners" : SHAPES[sh].label, hint: TOUCH_SHAPE_HINTS[sh] || "Tap each corner or bend", icon: SHAPES[sh].icon,
      on: ed.drawShape === sh || (sh === "freehand" && !list.includes(ed.drawShape)), pick: () => set({ drawShape: sh })
    })), "Draw");
  }
  // What the brush does to areas
  const painting = ed.tool === "draw-area" && ed.drawShape === "paint";
  if (painting) {
    const doc = getDoc();
    const own = ed.reshapeId ? doc.items.find(i => i.id === ed.reshapeId) : undefined;
    const kind = own && own.type === "area" ? own.kind : ed.areaKind;
    const brush = own && own.type === "area" ? (own.bushes ?? 0) >= 1 : ed.standOf === "bush";
    const modes = AREA_BRUSHES.filter(m => (m.value !== "thinner" && m.value !== "thicker") || kind === "woods").filter(m => m.value !== "restore" || (brush && !!doc.site.brushFound));
    const now = modes.some(m => m.value === ed.areaBrush) ? ed.areaBrush : "add";
    out.push({
      id: "brush", name: "Brush", value: modes.find(m => m.value === now)?.label ?? "", testid: "tool-modes",
      control: menu(modes.map(m => ({ key: m.value, on: now === m.value, label: m.label, hint: m.title, pick: () => set({ areaBrush: m.value }), testid: `area-brush-${m.value}` })), "What the brush does")
    });
  }
  // Which species
  if ((ed.tool === "add-tree" || stand) && ed.treeKind !== "bush") {
    const kind = ed.treeKind;
    const list = SPECIES[kind === "conifer" ? "conifer" : "broadleaf"];
    const now = ed.treeSpecies[kind] ?? null;
    const pick = (id: string | null) => set({ treeSpecies: { ...ed.treeSpecies, [kind]: id ?? undefined } });
    out.push({
      id: "species", name: "Species", value: now ? list.find(s => s.id === now)?.label ?? "" : "Any kind", testid: "tool-species",
      control: menu([{ key: "any", on: now === null, label: "Any kind", hint: "One of the course's kinds, as the woods grow", pick: () => pick(null), testid: "tree-species-any" }, ...list.map(sp => ({ key: sp.id, on: now === sp.id, label: sp.label, pick: () => pick(sp.id), testid: `tree-species-${sp.id}` }))], "Species")
    });
  }
  return { settings: out, edge: { size: painting || ed.tool === "sculpt", strength: ed.tool === "sculpt" } };
}
