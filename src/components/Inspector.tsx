import type { AmenityMarks } from "../lib/course";
import { AmenityItem } from "../types";
// The panel for what is selected: a hole (par, fairway, OB, tees and baskets, profile, notes,
// flyover) or one item.
import { PlaceByGps } from "./PlaceByGps";
import { OnSiteButton } from "./OnSite";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Brush, ChevronDown, ChevronLeft, Copy, Eye, EyeOff, Lock, Maximize2, RotateCcw, RotateCw, Trash2, TreeDeciduous, Unlock, X, Plus } from "lucide-react";
import { AMENITY_KINDS, AMENITY_ORDER, AREA_KINDS, AREA_ORDER, CIRCLE_ONE_FT, FIELD_KINDS, LINE_KINDS, PATH_SURFACES, PIN_POSITIONS, STRUCTURE_KINDS, STRUCTURE_ORDER, TEE_LEVELS, TEE_ORDER, TEE_SURFACES } from "../constants";
import { areaPath, areaRing, obFor, obSides, sideCompass, holeBaskets, holeLabel, holeNumber, holeTees, ITEM_LABELS, linePath, obPicked, parseHoleNumbers, teeAim, wholeHoles, widthFactors, widthVaries, AMENITY_ROLE } from "../lib/course";
import { pathLength, polygonArea } from "../lib/geom";
import { BUILDING_LOOKS, boxOutline, gazeboOutline, structureHeight, structurePath, structureRoof, structureWidth, turnShape } from "../lib/structures";
import { amenitySymbol, STRUCTURE_INK, structureLegend, symbolSvg } from "../lib/symbols";
import { courseStats, holeStats } from "../lib/holeStats";
import { COURT_FIELDS, FIELD_ORDER, MARKED_FIELDS, courtCount, fieldHome, fieldKindOf, isBallField } from "../lib/fields";
import { fieldIcon } from "./fieldIcons";
import { fmtArea, fmtDist } from "../lib/units";
import { fairwayTrees } from "../lib/lidar";
import { toast } from "../state/toast";
import { turnable } from "../lib/turn";
import { conifersOf } from "../lib/landscapes";
import { addHoleOb, deleteSelection, duplicateSelection, forgetNewLabel, isNewLabel, nextHomeCorner, obChoiceOf, pinsFull, setCourtCount, setFieldKind, setFieldLeague, setFieldPart, setFieldPlay, setLineKind, setObChoice, setPinPosition, startAnotherPin, startAnotherTee, startHoleToBasket, select, setTeeLevel, shareBasket, teesFull, type ObChoice } from "../state/actions";
import { changeDoc, setHoleNumber, updateHole, updateItem, useCourse, useEditor } from "../state/course";
import { standShape } from "../lib/treeMix";
import { SPECIES } from "../three/ezShapes";
import type { AmenityKind, AreaItem, CourseDoc, CourseItem, FenceStyle, FieldKind, FieldLeague, FieldPart, Hole, LabelItem, LineItem, LineKind, P, PathSurface, PinPosition, RoofKind, StructureItem, StructureKind, TeeLevel, TeeSurface } from "../types";
import { fieldInks, fieldPlan, LEAGUE_ORDER, LEAGUES } from "../lib/fieldPlan";
import { ElevationProfile } from "./ElevationProfile";
import { TreeSettings } from "./TreeSettings";
import { FlyoverRow } from "./FlyoverSettings";
import { HoleChips } from "./ApplyToHoles";
import { HoleSteps } from "./HoleSteps";
import { getView } from "../state/view";
import { useLayout } from "./useLayout";
import { Button, ChipPick, chipCls, ColorInput, Field, HelpLink, NumberInput, Section, Segmented, Select, Slider, Stat, TextInput, Toggle } from "./ui";

const shapeText = { straight: "Straight", left: "Turns left", right: "Turns right", "s-curve": "S-curve" };
/** A small size to the half foot (or tenth of a meter): "2.5 ft". */
export const fmtSize = (ft: number, units: "ft" | "m") => (units === "m" ? `${(ft / 3.28084).toFixed(1)} m` : `${Math.round(ft * 2) / 2} ft`);
/** The end of an edit made live (typing, a slider): its one undo step. */
const commit = () => useCourse.getState().commit();

/** A gentle curve for a hole: one turn halfway along, off to the left (-1) or right (1) by a
 * sixth of its length (its handle drags it on from there). */
export const bendHole = (line: P[], side: 1 | -1): P[] => {
  const a = line[0], b = line[line.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const off = (len / 6) * side;
  return [{ x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * off, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * off }];
};

/** A hole's number in its badge, typed in (kept on Enter or when the field is left; Esc puts it back). */
export function HoleNumberInput({ holeId, value }: { holeId: string; value: string }) {
  const [text, setText] = useState(value);
  // (Esc: the field is left without keeping what was typed)
  const cancelled = useRef(false);
  useEffect(() => { setText(value); }, [value]);
  // (more than one number: "3/12")
  const keep = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const [first, ...more] = parseHoleNumbers(text);
    if (first) setHoleNumber(holeId, first, more);
    else setText(value);
  };
  return (
    <input
      aria-label="Hole number"
      data-testid="hole-number"
      inputMode="numeric"
      title="Hole number"
      className={`shrink-0 h-10 touch:h-11 min-w-10 touch:min-w-11 px-1.5 rounded-full bg-orange-500 text-zinc-950 text-center ${text.length > 3 ? "text-sm" : "text-lg"} touch:text-lg font-bold cursor-text focus:outline-none focus:ring-2 focus:ring-sky-400/80`}
      style={{ fontFamily: "Oswald, Inter", width: `calc(${Math.max(2, text.length)}ch + 1.25rem)` }}
      value={text}
      onChange={e => setText(e.target.value.replace(/[^0-9/, &]/g, "").slice(0, 16))}
      onFocus={e => e.target.select()}
      onBlur={keep}
      onKeyDown={e => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") { cancelled.current = true; setText(value); (e.target as HTMLInputElement).blur(); }
        e.stopPropagation();
      }}
    />
  );
}

/** The measured trees on this hole's fairway (where it plays): how many are cut down, kept or in
 * the way, and the button to bring them back, clear them, or cut them again. Near the top of the
 * hole's panel, and a chip on a phone. */
export const useHoleTrees = (hole: Hole, line: P[] | null) => {
  const lidar = useCourse(s => s.doc.lidar);
  return useMemo(() => (lidar && line ? fairwayTrees({ lidar }, hole, line) : { cut: [], kept: [], standing: [] }), [lidar, hole, line]);
};
export function HoleTrees({ hole, line }: { hole: Hole; line: P[] }) {
  const lidar = useCourse(s => s.doc.lidar);
  const { cut, kept, standing } = useHoleTrees(hole, line);
  if (!cut.length && !kept.length && !standing.length) return null;
  const setLidar = (patch: { kept?: number[]; removed?: number[] }) => changeDoc(d => (d.lidar ? { lidar: { ...d.lidar, ...patch } } : {}));
  const list = (v: number[]) => (v.length ? [...new Set(v)].sort((a, b) => a - b) : undefined);
  const back = () => {
    // (kept, so the fairways' clearing leaves them, only where the course clears its fairways)
    setLidar({ ...(lidar?.clearFairways === true ? { kept: list([...(lidar?.kept ?? []), ...cut]) } : {}), removed: list((lidar?.removed ?? []).filter(k => !cut.includes(k))) });
    toast(`${cut.length === 1 ? "1 tree" : `${cut.length} trees`} back on hole ${holeLabel(useCourse.getState().doc, hole.id)}.`, "success", true);
  };
  // (trees left standing in the way: cut down only when asked, and said)
  const clear = () => {
    setLidar({ removed: list([...(lidar?.removed ?? []), ...standing]) });
    toast(`Cut down ${standing.length === 1 ? "1 tree" : `${standing.length} trees`} on hole ${holeLabel(useCourse.getState().doc, hole.id)}. Bring them back here, or click a stump.`, "info", true);
  };
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-white/[0.06] ring-1 ring-white/[0.08] px-3 py-2.5 mt-2" data-testid="fairway-trees">
      <TreeDeciduous size={20} className="text-[#a2cf6a] shrink-0" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[13.5px] font-semibold text-zinc-50 flex items-center gap-1.5">{cut.length ? `${cut.length.toLocaleString()} ${cut.length === 1 ? "tree" : "trees"} cut down` : standing.length ? `${standing.length.toLocaleString()} ${standing.length === 1 ? "tree" : "trees"} in the way` : `${kept.length.toLocaleString()} ${kept.length === 1 ? "tree" : "trees"} kept`}<HelpLink topic="lidar-settings" label="Trees cut for holes" /></div>
        {cut.length > 0 && kept.length > 0 && <div className="text-[11.5px] text-zinc-400">{kept.length.toLocaleString()} kept</div>}
        {cut.length > 0 && standing.length > 0 && <div className="text-[11.5px] text-zinc-400">{standing.length.toLocaleString()} still in the way</div>}
      </div>
      {cut.length > 0
        ? <Button small onClick={back} testid="trees-back"><RotateCcw size={14} /> Bring them back</Button>
        : standing.length > 0
          ? <Button small onClick={clear} testid="trees-clear">Clear them</Button>
          : <Button small onClick={() => setLidar({ kept: list((lidar?.kept ?? []).filter(k => !kept.includes(k))) })} testid="trees-down">Cut them down</Button>}
    </div>
  );
}

/** A hole's tees and baskets, a row each (its color or pin, how long the hole is from it): one
 * picked opens up in place with its own settings; another click on it closes it. Under them
 * (`children`), the ways to add more. */
function HoleParts({ hole, part, children }: { hole: Hole; part?: CourseItem; children?: ReactNode }) {
  const doc = useCourse(s => s.doc);
  const u = doc.units;
  const tees = holeTees(doc, hole.id);
  const baskets = holeBaskets(doc, hole.id);
  const s = holeStats(doc, hole);
  // (each tee's length to the pin played, each pin's from the tee played)
  const playedTee = tees.find(t => t.id === s.teeId) ?? tees[0];
  const playedPin = baskets.find(b => b.id === s.basketId) ?? baskets[0];
  const lengthOf = (tee: TeeLevel | undefined, pin: PinPosition | undefined) => (tee && pin ? fmtDist(holeStats(doc, hole, { id: "x", name: "", tee, pin }).length, u) : null);
  const played = (id: string) => (id === s.teeId || id === s.basketId ? " · played" : "");
  const open = useRef<HTMLDivElement>(null);
  useEffect(() => { open.current?.scrollIntoView?.({ block: "nearest" }); }, [part?.id]);
  const row = (id: string, mark: JSX.Element, label: string, sub: string | null, item: CourseItem) => {
    const on = part?.id === id;
    return (
      <div key={id} ref={on ? open : undefined} className={`rounded-[12px] ${on ? "bg-white/[0.09] ring-1 ring-orange-400/50" : ""}`} data-testid="hole-part">
        <button className={`w-full flex items-center gap-2 rounded-[12px] px-2.5 py-1.5 touch:py-3 text-left ${on ? "" : "hover:bg-white/[0.07]"}`} onClick={() => select(on ? hole.id : id)} aria-expanded={on} title={on ? "Close it" : "Open its settings (and pick it on the map)"} data-testid={`hole-part-${item.type}`}>
          {mark}
          <span className="flex-1 min-w-0 text-[13px] text-zinc-100 truncate">{label}</span>
          {sub && <span className="text-[12px] text-zinc-400 tabular-nums">{sub}</span>}
          <ChevronDown size={15} className={`text-zinc-500 transition-transform ${on ? "rotate-180" : ""}`} />
        </button>
        {on && (
          <div className="px-2.5 pb-1" data-testid="hole-part-settings">
            <ItemInspector item={item} bare />
            {"x" in item && <PlaceByGps item={item as never} inline />}
          </div>
        )}
      </div>
    );
  };
  return (
    <Section title="Tees and baskets" help="tees-pins" testid="hole-parts">
      <div className="flex flex-col gap-0.5" data-testid="hole-tees">
        {tees.map(t => row(t.id, <span className="w-3 h-3 rounded-full ring-1 ring-black/40 shrink-0" style={{ background: TEE_LEVELS[t.level].color }} />, `${TEE_LEVELS[t.level].label} tee${played(t.id)}`, lengthOf(t.level, playedPin?.position), t))}
        {baskets.map(b => row(b.id, <span className="w-3 h-3 rounded-full border-2 shrink-0" style={{ borderColor: doc.style.basket }} />, `Pin ${b.position}${played(b.id)}`, [b.holeId !== hole.id ? `hole ${holeLabel(doc, b.holeId ?? "")}'s` : "", lengthOf(playedTee?.level, b.position) ?? ""].filter(Boolean).join(" · ") || null, b))}
        {!tees.length && !baskets.length && <p className="text-[12px] text-zinc-400 px-1">None yet.</p>}
      </div>
      {children}
    </Section>
  );
}

/** A button that starts adding something to a hole. */
const GrowButton = ({ mark, title, onClick, testid }: { mark: ReactNode; title: string; onClick: () => void; testid: string }) => (
  <button className="flex items-center gap-2.5 text-left rounded-[12px] bg-white/[0.06] hover:bg-white/[0.11] px-2.5 py-2 touch:min-h-[44px]" onClick={onClick} data-testid={testid}>
    {mark}
    <span className="text-[13px] font-semibold text-zinc-100">{title}</span>
  </button>
);

/** How many times, in words: "once", "twice", "3 times". */
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function HoleInspector({ hole, part }: { hole: Hole; part?: CourseItem }) {
  const doc = useCourse(s => s.doc);
  const s = useMemo(() => holeStats(doc, hole), [doc, hole]);
  const label = holeLabel(doc, hole.id);
  const u = doc.units;
  const tees = holeTees(doc, hole.id);
  const baskets = holeBaskets(doc, hole.id);
  // The hole whose basket this one plays to, when it shares one
  const sharing = baskets.find(b => b.holeId !== hole.id)?.holeId ?? null;
  // (open already when it does share one)
  const [shareOpen, setShareOpen] = useState(!!sharing);
  useEffect(() => { if (sharing) setShareOpen(true); }, [sharing]);
  const set = (patch: Partial<Hole>, history = true) => updateHole(hole.id, patch, history);
  const played = tees.find(t => t.id === s.teeId);
  // (the fairway's widths along it, when they aren't all the same, or its middle moved off the line)
  const widths = (hole.fairwayShape ?? []).map(f => f * hole.fairwayWidth);
  const lo = Math.min(...widths), hi = Math.max(...widths);
  const shifted = !!hole.fairwayShift?.some(v => Math.abs(v) > 1e-3);
  const shaped = widths.length > 0 && (hi - lo > 0.5 || Math.abs(lo - hole.fairwayWidth) > 0.5);
  const auto = (text: string) => <span className="whitespace-nowrap">{text}</span>;
  return (
    <>
      <Section>
        <div className="flex items-center gap-2 mb-2" data-insp-title>
          <HoleNumberInput holeId={hole.id} value={label} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-zinc-50 truncate" data-testid="inspector-title">Hole {label}{hole.name ? ` · ${hole.name}` : ""}</div>
            <div className="text-xs text-zinc-400">{s.complete ? `Par ${s.par} · ${shapeText[s.shape]}` : s.teeId ? "Needs a basket" : "Needs a tee"}</div>
          </div>
        </div>
        {(() => { const mine = label.split("/"); const clash = doc.holes.filter(h => h.id !== hole.id).flatMap(h => holeLabel(doc, h.id).split("/")).find(v => mine.includes(v)); return clash ? <div className="text-xs text-amber-300 -mt-1 mb-2" data-testid="hole-number-taken">Hole {clash} is taken.</div> : null; })()}
        {s.complete && (
          <div className="grid grid-cols-3 gap-2" data-testid="hole-stats">
            <Stat label="Length" value={fmtDist(s.length, u)} />
            <Stat label={Math.abs(s.elevationChange) < 0.5 ? "Flat" : s.elevationChange > 0 ? "Uphill" : "Downhill"} value={fmtDist(Math.abs(s.elevationChange), u)} />
            <Stat label="Plays like" value={fmtDist(s.playsLike, u)} />
          </div>
        )}
        {/* (Play flyover is in its Flyover row, with Edit flyover) */}
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          {s.complete && <Button small full onClick={() => useEditor.getState().set({ teeView: hole.id, flyover: false })} testid="tee-view"><Eye size={14} /> Tee view</Button>}
          <Button small full onClick={() => getView()?.fitHole(hole.id)} testid="zoom-hole"><Maximize2 size={14} /> Zoom to it</Button>
          <OnSiteButton holeId={hole.id} className="col-span-2 w-full" />
        </div>
        {doc.lidar && s.complete && <HoleTrees hole={hole} line={s.line} />}
      </Section>
      {/* (first, under the hole's name: the flyover is the hole's, and Edit flyover is never a scroll
          away) */}
      {s.complete && (
        <Section title="Flyover" help="flyover" testid="sec-flyover">
          <FlyoverRow hole={hole} />
        </Section>
      )}
      <HoleParts hole={hole} part={part}>
        {(() => {
          // (the layout worked on, on a hole with no tee of its color: played from the nearest)
          const layout = doc.layouts.length > 1 ? doc.layouts.find(l => l.id === doc.activeLayout) : undefined;
          if (!layout || !tees.length || tees.some(t => t.level === layout.tee)) return null;
          const lvl = TEE_LEVELS[layout.tee];
          return (
            <div className="flex items-center gap-2 mt-2 text-[11px] text-zinc-300 leading-snug" data-testid="layout-missing-tee">
              <span className="flex-1">No {lvl.label.toLowerCase()} tee yet: the {layout.name} layout plays this hole from the {TEE_LEVELS[tees.find(t => t.id === s.teeId)?.level ?? tees[0].level].label.toLowerCase()} one.</span>
              <Button small onClick={() => useEditor.getState().set({ tool: "add-tee", teeLevel: layout.tee, activeHoleId: hole.id })}>Add one</Button>
            </div>
          );
        })()}
        {(() => {
          // (which holes finish at its basket)
          const others = doc.holes.filter(h => h.id !== hole.id && holeBaskets(doc, h.id).some(b => baskets.some(x => x.id === b.id)));
          return others.length > 0 && <div className="text-[11.5px] text-zinc-400 mt-2" data-testid="shared-with">Its basket is shared with hole{others.length === 1 ? "" : "s"} {others.map(h => holeLabel(doc, h.id)).join(", ")}.</div>;
        })()}
        <div className="flex flex-col gap-1.5 mt-2" data-testid="hole-grow">
          {/* (none once the hole has a tee of every color, or pins A to D) */}
          {!teesFull(hole.id, true) && <GrowButton mark={<span className="w-4 h-2.5 rounded-sm shrink-0" style={{ background: TEE_LEVELS[TEE_ORDER.find(l => !tees.some(t => t.level === l)) ?? "red"].color }} />} title="Another tee for this hole" onClick={() => startAnotherTee(hole.id)} testid="another-tee" />}
          {s.complete && <GrowButton mark={<Plus size={16} className="shrink-0 text-orange-300" />} title="New hole to this basket" onClick={() => startHoleToBasket(hole.id)} testid="hole-to-basket" />}
          {!pinsFull(hole.id, true) && <GrowButton mark={<span className="w-3.5 h-3.5 rounded-full border-2 shrink-0" style={{ borderColor: doc.style.basket }} />} title="Another pin position" onClick={() => startAnotherPin(hole.id)} testid="another-pin" />}
        </div>
        {doc.holes.length > 1 && (
          <details className="mt-2" open={shareOpen} onToggle={e => setShareOpen((e.target as HTMLDetailsElement).open)}><summary className="cursor-pointer text-[11.5px] text-zinc-400 hover:text-zinc-200">Play to another hole's basket instead</summary>
            <Select label="Basket" testid="share-basket" className="mt-1.5" value={sharing ?? ""} onChange={v => shareBasket(hole.id, v || null)}>
              <option value="">Its own basket</option>
              {doc.holes.filter(h => h.id !== hole.id && holeBaskets(doc, h.id).some(b => b.holeId === h.id)).map(h => <option key={h.id} value={h.id}>Hole {holeLabel(doc, h.id)}'s basket</option>)}
            </Select>
          </details>
        )}
      </HoleParts>
      <Section title="Par and foliage" help="par">
        <Field label="Par">
          <Segmented
            label="Par"
            value={hole.par ?? 0}
            onChange={v => set({ par: v === 0 ? undefined : v })}
            options={[{ value: 0, label: auto(`Auto ${s.parAuto}`) }, ...[2, 3, 4, 5, 6].map(p => ({ value: p, label: String(p) }))]}
          />
        </Field>
        <Field label="Foliage">
          <Segmented label="Foliage" value={hole.foliage ?? "auto"} onChange={v => set({ foliage: v === "auto" ? undefined : (v as "light" | "heavy") })} options={[{ value: "auto", label: auto(`Auto · ${s.foliage}`) }, { value: "light", label: "Light" }, { value: "heavy", label: "Heavy" }]} />
        </Field>
      </Section>
      <Section title="Fairway and line of play" help="fairway" testid="sec-fairway">
        <Toggle label="Draw the fairway" checked={hole.fairway} onChange={v => set({ fairway: v })} />
        {hole.fairway && (
          <>
            <Slider label={hole.fairwayShape ? "Fairway width (all along)" : "Fairway width"} min={10} max={150} value={hole.fairwayWidth} onChange={v => set({ fairwayWidth: v }, false)} onDone={commit} format={v => fmtDist(v, u)} />
            {(shaped || shifted) && (
              <div className="flex items-center justify-between gap-2 -mt-1 mb-2" data-testid="fairway-shape">
                <p className="text-[11px] text-zinc-400 leading-snug tabular-nums">{shaped ? (hi - lo > 0.5 ? `${fmtDist(lo, u, false)} to ${fmtDist(hi, u)}` : fmtDist(lo, u)) : "Moved off the line"}</p>
                <button className="shrink-0 text-xs text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => set({ fairwayShape: undefined, fairwayShift: undefined, fairwayStations: undefined })}>Even width</button>
              </div>
            )}
          </>
        )}
        {s.complete && (
          <Field label="Line of play" help="line-of-play">
            <div className="flex flex-wrap gap-1.5">
              <Button small onClick={() => useEditor.getState().set({ plotLine: hole.id, tool: "select" })} testid="plot-line">Plot the line</Button>
              <Button small onClick={() => set({ doglegs: bendHole(s.line, -1) })} testid="bend-left">Bend left</Button>
              <Button small onClick={() => set({ doglegs: bendHole(s.line, 1) })} testid="bend-right">Bend right</Button>
              {hole.doglegs.length > 0 && <Button small onClick={() => set({ doglegs: [] })}>Straighten</Button>}
            </div>
          </Field>
        )}
        {s.complete && (
          <Field label="Add OB" help="ob">
            <div className="flex flex-wrap gap-1.5">
              <Button small onClick={() => addHoleOb(hole.id, "left")} testid="ob-left">Left side</Button>
              <Button small onClick={() => addHoleOb(hole.id, "right")} testid="ob-right">Right side</Button>
              <Button small onClick={() => addHoleOb(hole.id, "long")} testid="ob-long">Behind basket</Button>
            </div>
          </Field>
        )}
      </Section>
      {s.complete && (
        <Section title="In play" help="in-play" testid="sec-inplay">
          <ul className="text-xs text-zinc-300 space-y-1" data-testid="hole-in-play">
            <li>{s.treesOnLine ? `${s.treesOnLine} tree${s.treesOnLine === 1 ? "" : "s"} on the throw line` : "Clear throw line"} · {s.treesInFairway} tree{s.treesInFairway === 1 ? "" : "s"} in the fairway</li>
            <li>{s.obInPlay ? `OB in play${s.obCrossed ? `: the throw line crosses it ${times(s.obCrossed)}` : ""}` : "No OB in play"}{s.obNearBasket ? ` · OB within ${fmtDist(CIRCLE_ONE_FT, u)} of the basket` : ""}</li>
            <li title="Difficulty, 1 to 5">Difficulty <span role="img" aria-label={`${s.difficulty} out of 5`}>{"●".repeat(s.difficulty)}{"○".repeat(5 - s.difficulty)}</span></li>
          </ul>
          <div className="mt-3">
            <ElevationProfile doc={doc} line={s.line} teeColor={played ? TEE_LEVELS[played.level].color : undefined} />
            <div className="text-[11px] text-zinc-400 mt-1">
              Tee at {fmtDist(s.teeElevation, u)} · basket at {fmtDist(s.basketElevation, u)} · steepest slope {Math.round(s.maxSlope)}%
            </div>
          </div>
        </Section>
      )}
      <Section title="Name and notes">
        <Field label="Name (optional)"><TextInput label="Hole name" value={hole.name ?? ""} placeholder="e.g. The Gauntlet" onChange={v => set({ name: v || undefined }, false)} onDone={commit} /></Field>
        <Field label="Notes and hole rules"><TextInput area label="Hole notes" value={hole.notes ?? ""} placeholder="e.g. OB left of the path. Mando right of the big oak; drop zone by the bench." onChange={v => set({ notes: v || undefined }, false)} onDone={commit} /></Field>
      </Section>
    </>
  );
}

/** What a path or a walk is made of. */
export function SurfacePick({ value, onChange }: { value?: PathSurface; onChange: (v: PathSurface | undefined) => void }) {
  return (
    <Field label="Surface">
      <ChipPick label="Surface" testid="path-surface" value={value ?? "dirt"} onChange={v => onChange(v === "dirt" ? undefined : v)} options={(Object.keys(PATH_SURFACES) as PathSurface[]).map(k => ({ value: k, label: PATH_SURFACES[k].label, color: PATH_SURFACES[k].color }))} />
    </Field>
  );
}

/** How much underbrush (a wood's or tall grass's: none unless asked for). */
export const BRUSH_LEVELS = [{ value: "none", label: "None" }, { value: "light", label: "Light" }, { value: "medium", label: "Medium" }, { value: "heavy", label: "Heavy" }] as const;
/** How thick a wood grows (its density). */
export const THICK = [{ value: "sparse", label: "Sparse" }, { value: "usual", label: "Usual" }, { value: "thick", label: "Thick" }] as const;
type Thick = (typeof THICK)[number]["value"];
export const thickOf = (a: Pick<AreaItem, "density">): Thick => ((a.density ?? 1) < 0.75 ? "sparse" : (a.density ?? 1) > 1.4 ? "thick" : "usual");
export const densityFor = (t: Thick) => (t === "sparse" ? 0.5 : t === "thick" ? 2 : undefined);

/** What a wood grows: leafy trees, pines, bushes (any of them, in equal shares). */
export type Grows = { leafy: boolean; pine: boolean; bush: boolean };
export const growsOf = (a: Pick<AreaItem, "pines" | "bushes">, style: CourseDoc["style"]): Grows => {
  const b = a.bushes ?? 0, p = a.pines ?? conifersOf(style);
  return { bush: b > 0.05, pine: b < 0.999 && p > 0.05, leafy: b < 0.999 && p < 0.95 };
};
export const growsPatch = (g: Grows): Partial<AreaItem> => {
  const trees = +g.leafy + +g.pine, n = trees + +g.bush;
  return { bushes: g.bush ? (trees ? Math.round((1 / n) * 100) / 100 : 1) : undefined, pines: trees ? (g.pine ? (g.leafy ? 0.5 : 1) : 0) : undefined };
};
const GROWS: { key: keyof Grows; label: string }[] = [{ key: "leafy", label: "Leafy trees" }, { key: "pine", label: "Conifers" }, { key: "bush", label: "Bushes" }];
export const growsText = (g: Grows) => GROWS.filter(x => g[x.key]).map((x, i) => (i ? x.label.toLowerCase() : x.label)).join(", ");

/** What a wood grows, as chips that each turn on or off (one stays on). */
export function GrowsPick({ item, row = false }: { item: AreaItem; row?: boolean }) {
  const style = useCourse(s => s.doc.style);
  const g = growsOf(item, style);
  const flip = (k: keyof Grows) => {
    const next = { ...g, [k]: !g[k] };
    if (!next.leafy && !next.pine && !next.bush) return;
    updateItem(item.id, growsPatch(next) as Partial<CourseItem>);
  };
  return (
    <div className={row ? "flex gap-1.5" : "flex flex-wrap gap-1"} role="group" aria-label="What grows" data-testid="woods-grows">
      {GROWS.map(x => <button key={x.key} type="button" aria-pressed={g[x.key]} onClick={() => flip(x.key)} className={chipCls(g[x.key])} data-testid={`grows-${x.key}`}>{x.label}</button>)}
    </div>
  );
}

/** A stand's species, when it grows only leafy trees or only pines: any of the course's kinds, or one. */
export function StandSpecies({ item }: { item: AreaItem }) {
  const shape = standShape(item);
  if (!shape) return null;
  const list = SPECIES[shape];
  const now = item.species && list.some(s => s.id === item.species) ? item.species : "any";
  return (
    <Field label="Species" help="trees">
      <ChipPick label="Species" testid="stand-species" value={now} onChange={v => updateItem(item.id, { species: v === "any" ? undefined : v } as Partial<CourseItem>)}
        options={[{ value: "any", label: "Any kind", title: "The course's kinds of trees, as the woods grow" }, ...list.map(s => ({ value: s.id, label: s.label }))]} />
    </Field>
  );
}

/** A wood's settings: what grows, how thick, its underbrush, and (with measured trees) whether
 * those inside stay. Tall grass has the underbrush only. */
function WoodsSettings({ item }: { item: AreaItem }) {
  const measured = useCourse(s => !!s.doc.lidar?.trees.length);
  const set = (patch: Partial<AreaItem>) => updateItem(item.id, patch as Partial<CourseItem>);
  const woods = item.kind === "woods";
  const brushOnly = woods && (item.bushes ?? 0) >= 1;
  return (
    <div className="mb-3" data-testid="woods-settings">
      {woods && (
        <>
          <Field label="What grows" help="woods"><GrowsPick item={item} /></Field>
          <StandSpecies item={item} />
          <Field label="How thick"><Segmented label="How thick" value={thickOf(item)} onChange={v => set({ density: densityFor(v) })} options={[...THICK]} /></Field>
        </>
      )}
      {!brushOnly && (
        <Field label="Underbrush" help={woods ? "woods" : "areas"}>
          <Segmented label="Underbrush" value={item.underbrush ?? "none"} onChange={v => set({ underbrush: v === "none" ? undefined : v })} options={[...BRUSH_LEVELS]} />
        </Field>
      )}
      {woods && measured && (
        <Toggle label="Keep the measured trees in it" checked={item.trees !== "drawn" && item.trees !== "none"} onChange={v => set({ trees: v ? undefined : "drawn" })} />
      )}
    </div>
  );
}

/** A field's kinds, each with its picture (its panel and a phone's strip). */
export const fieldKindOptions = () => FIELD_ORDER.map(k => ({ value: k, label: FIELD_KINDS[k].label, icon: fieldIcon(k) }));
/** In play or out of play (a field's panel and a phone's strip). */
export const PLAY_OPTIONS = [{ value: "in", label: "In play" }, { value: "out", label: "Out of play" }] as const;
/** A field's markings turned, in words: "Lined up", "15°". */
export const fmtTurn = (v: number) => (v ? `${v > 0 ? "" : "−"}${Math.abs(v)}°` : "Lined up");
/** A ball field's home plate corner, in words: "Corner 1 of 8". */
export const homeText = (a: AreaItem) => (a.plate ? "Placed by hand" : `Corner ${fieldHome(a) + 1} of ${a.points.length}`);
/** A line's height, named for what it is (its panel and a phone's strip). */
export const heightLabel = (k: LineKind) => (k === "power" ? "Wire height" : "Height");

/** A field's or court's size, how many courts and their colors (its panel and a phone's bar). */
export function FieldLooks({ item, kind }: { item: AreaItem; kind: FieldKind }) {
  const set = (patch: Partial<AreaItem>, history = true) => updateItem(item.id, patch as Partial<CourseItem>, history);
  const league = useMemo(() => (isBallField(kind) ? fieldPlan(item)?.league : undefined), [item, kind]);
  const n = courtCount(kind, item.points);
  return (
    <>
      {league && (
        <Field label="Size" help="park">
          <ChipPick label="Size" testid="field-league" value={league} onChange={v => setFieldLeague(item.id, v)} options={LEAGUE_ORDER.map(k => ({ value: k, label: LEAGUES[k].label }))} />
        </Field>
      )}
      {(kind === "tennis" || kind === "pickleball") && (
        <Field label="Courts" help="park">
          <ChipPick label="Courts" testid="field-courts" value={String(Math.min(4, n))} onChange={v => setCourtCount(item.id, Number(v))} options={["1", "2", "3", "4"].map(v => ({ value: v, label: v === "2" ? "2 in a row" : v }))} />
        </Field>
      )}
      {(kind === "tennis" || kind === "pickleball" || kind === "basketball") && (
        <Field label="Colors" help="park">
          <ChipPick label="Colors" testid="field-colors" value={item.courtColors ?? "blue"} onChange={v => set({ courtColors: v === "blue" ? undefined : v })} options={[{ value: "blue", label: "Blue in green" }, { value: "green", label: "All green" }, { value: "red", label: "Red and green" }]} />
        </Field>
      )}
    </>
  );
}
/** Whether a field has any of those. */
export const hasFieldLooks = (kind: FieldKind) => isBallField(kind) || kind === "tennis" || kind === "pickleball" || kind === "basketball";

/** A field, court or play area's own settings: in or out of play, its markings turned, a ball
 * field's home plate. */
function FieldSettings({ item, kind }: { item: AreaItem; kind: FieldKind }) {
  const set = (patch: Partial<AreaItem>, history = true) => updateItem(item.id, patch as Partial<CourseItem>, history);
  const league = useMemo(() => (isBallField(kind) ? fieldPlan(item)?.league : undefined), [item, kind]);
  return (
    <>
      <FieldLooks item={item} kind={kind} />
      <FieldParts item={item} kind={kind} league={league} />
      <Field label="Play" help="park">
        <Segmented label="Play" value={item.outOfPlay ? "out" : "in"} onChange={v => setFieldPlay(item.id, v === "out")} options={[...PLAY_OPTIONS]} />
      </Field>
      {MARKED_FIELDS.includes(kind) && <Slider label="Markings turn" min={-90} max={90} step={1} value={item.fieldTurn ?? 0} onChange={v => set({ fieldTurn: v || undefined }, false)} onDone={commit} format={fmtTurn} />}
      {isBallField(kind) && (
        <Field label="Home plate" help="park">
          <div className="flex items-center justify-between gap-2" data-testid="field-home">
            <span className="text-sm text-zinc-200 tabular-nums">{homeText(item)}</span>
            {!item.locked && <Button small onClick={() => nextHomeCorner(item.id)} testid="field-home-next">Next corner</Button>}
          </div>
        </Field>
      )}
    </>
  );
}

/** A field's parts, each a row: its color, what it is, its size, a switch to show it or not; a
 * row (or a click on the part on the map) picks it, outlined, its own settings under the list. */
const PART_LIST: Partial<Record<FieldKind, FieldPart[]>> = {
  baseball: ["infield", "grass", "lines", "mound", "backstop", "fence", "dugouts", "track"],
  softball: ["infield", "grass", "lines", "mound", "backstop", "fence", "dugouts", "track"],
  tennis: ["courts", "surround", "lines", "nets", "fence"],
  pickleball: ["courts", "surround", "lines", "nets"],
  basketball: ["courts", "surround", "lines"]
};
/** Whether a field of this kind has parts to pick (its panel's Parts list). */
export const hasParts = (k: FieldKind) => !!PART_LIST[k];
export function FieldParts({ item, kind, league }: { item: AreaItem; kind: FieldKind; league?: FieldLeague }) {
  const picked = useEditor(e => e.fieldPart);
  const list = PART_LIST[kind];
  if (!list) return null;
  const L = league ? LEAGUES[league] : null;
  const ink = fieldInks("natural");
  const ball = isBallField(kind);
  const backH = item.parts?.backstop?.h ?? L?.backH ?? 16, back = item.parts?.backstop?.d ?? L?.backstop ?? 25;
  const fenceH = item.parts?.fence?.h ?? (ball ? (league === "high" ? 8 : 6) : 10);
  const [cl, cw] = FIELD_KINDS[kind].size;
  const row: Record<FieldPart, { label: string; color: string; value: string }> = {
    infield: { label: "Infield", color: ink.dirt, value: L ? `${L.arc} ft from the rubber` : "" },
    grass: { label: "Grass", color: ink.stripe, value: "mown in bands" },
    lines: { label: ball ? "Lines and bases" : "Lines", color: ink.chalk, value: L ? `${L.bases} ft bases` : FIELD_KINDS[kind].label.toLowerCase() },
    mound: { label: L?.circle ? "Pitcher's circle" : "Mound", color: ink.mound, value: L ? `${L.pitch} ft` : "" },
    backstop: { label: "Backstop", color: ink.fence, value: `${backH} ft tall` },
    fence: { label: ball ? "Outfield fence" : "Fence", color: ball ? "#f2c318" : ink.fence, value: `${fenceH} ft` },
    dugouts: { label: "Dugouts", color: ink.block, value: "2" },
    track: { label: "Warning track", color: ink.dirt, value: "" },
    courts: { label: "Courts", color: item.courtColors === "green" ? ink.courtG : item.courtColors === "red" ? ink.courtR : ink.court, value: kind === "tennis" ? "78 × 36 ft" : kind === "pickleball" ? "44 × 20 ft" : "94 × 50 ft" },
    surround: { label: "Surround", color: ink.courtOut, value: `${cl} × ${Math.round(courtCount(kind, item.points) * cw)} ft` },
    nets: { label: "Nets", color: ink.net, value: kind === "tennis" ? "3 ft" : "34 in" }
  };
  return (
    <Field label="Parts" help="park">
      <div className="grid gap-0.5" data-testid="field-parts">
        {list.map(p => {
          const off = !!item.parts?.[p]?.off;
          return (
            <div key={p} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] cursor-pointer ${picked === p ? "bg-white/[0.09] ring-[1.5px] ring-cyan-400" : "hover:bg-white/[0.05]"} ${off ? "text-zinc-500" : "text-zinc-100"}`}
              onClick={() => useEditor.getState().set({ fieldPart: picked === p ? null : p })} data-testid={`part-${p}`}>
              <span className="w-3.5 h-3.5 rounded shrink-0 border border-white/25" style={{ background: row[p].color, opacity: off ? 0.35 : 1 }} />
              <span className="truncate">{row[p].label}</span>
              <span className="ml-auto text-xs text-zinc-400 truncate">{row[p].value}</span>
              <button type="button" className="p-0.5 text-zinc-400 hover:text-zinc-100" aria-label={off ? `Show the ${row[p].label.toLowerCase()}` : `Hide the ${row[p].label.toLowerCase()}`} title={off ? "Show it" : "Hide it"}
                onClick={e => { e.stopPropagation(); setFieldPart(item.id, p, { off: !off }); }} data-testid={`part-${p}-eye`}>
                {off ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          );
        })}
      </div>
      {picked && list.includes(picked) && <PartSettings item={item} part={picked} ball={ball} L={L} backH={backH} back={back} fenceH={fenceH} />}
      <div className="text-[11.5px] text-zinc-500 mt-1.5">Click a part here or on the map to pick it.</div>
    </Field>
  );
}

/** A picked part's own settings: its sizes and colors, so a field can look like the real one. */
function PartSettings({ item, part, ball, L, backH, back, fenceH }: { item: AreaItem; part: FieldPart; ball: boolean; L: (typeof LEAGUES)[FieldLeague] | null; backH: number; back: number; fenceH: number }) {
  const ps = item.parts?.[part] ?? {};
  const set = (patch: Parameters<typeof setFieldPart>[2], history = false) => setFieldPart(item.id, part, patch, history);
  const ft = (v: number) => `${v} ft`;
  const slide = (label: string, key: "h" | "d" | "w", min: number, max: number, value: number) =>
    <Slider label={label} min={min} max={max} step={1} value={value} onChange={v => set({ [key]: v })} onDone={commit} format={ft} />;
  const colors = (label: string, options: { value: string; label: string }[], value: string) =>
    <Field label={label}><ChipPick label={label} value={value} onChange={v => set({ c: v }, true)} options={options} /></Field>;
  let body: ReactNode = null;
  if (part === "infield" && L) body = <>{slide("Reach from the rubber", "d", 30, 130, ps.d ?? L.arc)}{colors("Clay", [{ value: "red", label: "Red" }, { value: "tan", label: "Tan" }, { value: "brown", label: "Brown" }], ps.c ?? "red")}</>;
  else if (part === "grass" && L) body = <><Toggle label="Mown in bands" checked={ps.n !== 0} onChange={v => set({ n: v ? undefined : 0 }, true)} />{ps.n !== 0 && slide("Band width", "w", 4, 30, ps.w ?? L.band)}</>;
  else if (part === "lines" && L) body = slide("Bases apart", "d", 40, 90, ps.d ?? L.bases);
  else if (part === "mound" && L) body = slide("Home to the rubber", "d", 30, 61, ps.d ?? L.pitch);
  else if (part === "backstop") body = <>{slide("Backstop height", "h", 8, 30, backH)}{slide("Behind home plate", "d", 15, 70, back)}</>;
  else if (part === "fence") body = <>{slide("Fence height", "h", 4, 14, fenceH)}{ball && colors("Top", [{ value: "yellow", label: "Yellow" }, { value: "green", label: "Green" }, { value: "none", label: "None" }], ps.c ?? "yellow")}</>;
  else if (part === "dugouts" && L) body = <>{slide("Length", "w", 10, 60, ps.w ?? L.dugout)}{slide("Out from the foul line", "d", 6, 60, ps.d ?? Math.max(14, back * 0.6))}</>;
  else if (part === "track") body = slide("Width", "w", 4, 20, ps.w ?? 15);
  else if (part === "surround") body = colors("Color", [{ value: "green", label: "Green" }, { value: "blue", label: "Blue" }, { value: "tan", label: "Tan" }], ps.c ?? "green");
  if (!body) return null;
  return <div className="mt-2" data-testid="part-settings">{body}</div>;
}

/** What a fence is (its panel and a phone's strip). */
export const FENCE_STYLES: { value: FenceStyle; label: string }[] = [{ value: "rail", label: "Posts and rails" }, { value: "boards", label: "Boards" }, { value: "chain", label: "Chain link" }];

/** Areas with play rules of their own (not OB): no choice of OB, but which holes they count for. */
export const RULE_AREAS = new Set<string>(["hazard", "casual", "nogo"]);

/** Whether a shape gets a choice of OB in its panel: not one that's OB already (an OB area or
 * line), a next-tee route, a fairway or landing zone, or a rule area (unless it's been made OB before). */
export const hasObChoice = (i: AreaItem | LineItem) => i.kind !== "ob" && i.kind !== "walk" && ((i.kind !== "fairway" && i.kind !== "green" && !RULE_AREAS.has(i.kind)) || i.ob === true);

/** A little line for an OB choice: red, or (no red edge) the shape's own color; `beyond`, with
 * hatching on one side. */
const obMark = (color: string, beyond = false) => (
  <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden className="shrink-0">
    {beyond && <path d="M2 6 L4 10 M6 6 L8 10 M10 6 L12 10 M14 6 L16 10" stroke={color} strokeWidth="1.2" opacity="0.7" />}
    <path d="M1 4 H15" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/** A hazard's mark: a dashed yellow edge. */
const hazardMark = (
  <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden className="shrink-0">
    <path d="M1 5 H15" stroke="#f2c230" strokeWidth="2.2" strokeDasharray="3.5 2" />
  </svg>
);

/** A shape's choices of penalty, OB or hazard (the panel and the phone's strip). */
export const obOptions = (item: AreaItem | LineItem): { value: ObChoice; label: string; icon?: JSX.Element }[] => {
  const wet = item.kind === "water" || item.kind === "stream";
  const line = item.type === "line";
  const own = item.type === "line" ? LINE_KINDS[item.kind].color : AREA_KINDS[item.kind].color;
  return [
    { value: "no", label: "None" },
    { value: "edge", label: "OB", icon: obMark("#ef4444") },
    ...(wet ? [{ value: "yes" as const, label: "OB, no red edge", icon: obMark(own) }] : []),
    ...(line ? [{ value: "beyond" as const, label: "OB and beyond", icon: obMark("#ef4444", true) }] : []),
    { value: "hazard", label: "Hazard", icon: hazardMark }
  ];
};

/** Whether water, a creek, a road, a fence or a path is out of bounds (and shown so on the map);
 * a line OB beyond it too, and along all of it or stretches of it. */
export function ObPick({ item }: { item: AreaItem | LineItem }) {
  const doc = useCourse(s => s.doc);
  const units = doc.units;
  const line = item.type === "line" ? item : null;
  // (a line along its length, an area round its edge)
  const len = line ? pathLength(linePath(line)) : item.type === "area" ? pathLength(areaRing(item)) : 0;
  const stretches = item.obStretches;
  const markStretch = () => useEditor.getState().set({ obPick: item.id, pickCut: false, tool: "select" });
  // The holes it is OB for (none picked: all of them)
  const picked = line ? obPicked(doc, line) : [];
  const setObHoles = (ids: string[]) => updateItem(item.id, { obHoles: ids.length ? ids : undefined } as Partial<CourseItem>);
  return (
    <>
      <Field label="Penalty" help="ob">
        <ChipPick label="Penalty" testid="ob-choice" value={obChoiceOf(item)} onChange={v => setObChoice(item.id, v)} options={obOptions(item)} />
      </Field>
      {line?.obBeyond && item.ob === true && (() => {
        // Which side is out: the app's guess (away from the holes beside it), or either side
        const drawn = linePath(line);
        const lines = courseStats(doc).filter(st => st.complete && obFor(doc, line, st.holeId)).map(st => st.line);
        const guess = obSides(drawn, lines, 300, true)[0] === 1 ? -1 : 1;
        const name = (s: 1 | -1) => `${sideCompass(drawn, s)[0].toUpperCase()}${sideCompass(drawn, s).slice(1)}`;
        return (
          <Field label="OB side">
            <Segmented label="OB side" value={line.obToward ?? 0} onChange={v => updateItem(item.id, { obToward: v === 0 ? undefined : v } as Partial<CourseItem>)}
              options={[{ value: 0, label: `Auto (${sideCompass(drawn, guess)})` }, { value: 1, label: name(1) }, { value: -1, label: name(-1) }]} />
          </Field>
        );
      })()}
      {item.ob === true && (
        <Field label={line ? "OB along" : "OB along its edge"}>
          <div className="flex flex-col gap-1.5" data-testid="ob-stretches">
            {stretches?.length ? stretches.map(([a, b], k) => (
              <div key={k} className="flex items-center gap-2 text-sm text-zinc-200" data-testid="ob-stretch">
                <span className="flex-1 tabular-nums">{fmtDist(Math.min(a, b) * len, units, false)} to {fmtDist(Math.max(a, b) * len, units)}</span>
                <button className="p-1 rounded hover:bg-white/[0.09] text-zinc-400" aria-label={`Remove stretch ${k + 1}`} onClick={() => {
                  const rest = stretches.filter((_, j) => j !== k);
                  updateItem(item.id, (rest.length ? { obStretches: rest } : { obStretches: undefined, ob: undefined }) as Partial<CourseItem>);
                }}><X size={14} /></button>
              </div>
            )) : <span className="text-sm text-zinc-200">{line ? "All of it" : "All the way round"}</span>}
            <div className="flex gap-1.5">
              <Button small onClick={markStretch} testid="ob-mark-stretch">{stretches?.length ? "Add a stretch" : "Only a stretch"}</Button>
              {!!stretches?.length && <Button small onClick={() => updateItem(item.id, { obStretches: undefined } as Partial<CourseItem>)} testid="ob-all">{line ? "All of it" : "All the way round"}</Button>}
            </div>
          </div>
        </Field>
      )}
      {line && item.ob === true && (
        <Field label="OB for">
          <HoleChips label="OB for holes" testid="ob-for" picked={picked.length ? picked : "all"} onChange={v => setObHoles(v === "all" ? [] : v)} />
        </Field>
      )}
    </>
  );
}

/** Turn buttons: a drawn shape about its middle; a tee, a mando, a label or a bench where it
 * stands (a tee turned by hand stops facing down its hole). */
export function TurnButtons({ item }: { item: CourseItem }) {
  const doc = useCourse(s => s.doc);
  if (item.locked || !turnable(item)) return null;
  const turn = (deg: number) => {
    if (item.type === "area" || item.type === "line" || item.type === "structure") return updateItem(item.id, turnShape(item.points, item, (deg * Math.PI) / 180) as Partial<CourseItem>);
    const from = item.type === "tee" ? teeAim(doc, item) : item.rotation;
    updateItem(item.id, { rotation: from + deg, ...(item.type === "tee" ? { aimFixed: true } : {}) } as Partial<CourseItem>);
  };
  const b = "flex-1 h-8 touch:h-11 rounded-lg border border-white/[0.12] hover:border-zinc-500 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1";
  return (
    <Field label="Turn">
      <div className="flex gap-1.5" data-testid="turn-shape">
        <button className={b} aria-label="Turn left 15°" onClick={() => turn(-15)}><RotateCcw size={13} /> 15°</button>
        <button className={b} aria-label="Turn right 15°" onClick={() => turn(15)}><RotateCw size={13} /> 15°</button>
        <button className={b} aria-label="Turn right 90°" onClick={() => turn(90)}><RotateCw size={13} /> 90°</button>
      </div>
    </Field>
  );
}

/** How a building or a shelter looks: its look, a shelter's shape, the roof and its colors (its
 * panel and a phone's strip). */
export function StructureLook({ item }: { item: StructureItem }) {
  const set = (patch: Record<string, unknown>, history = true) => updateItem(item.id, patch as Partial<CourseItem>, history);
  const roofInk = item.kind === "shelter" ? STRUCTURE_INK.shelter : STRUCTURE_INK.roof;
  return (
    <>
      {item.kind === "building" && (
        <Field label="Looks like">
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Looks like" data-testid="building-looks">
            {BUILDING_LOOKS.map(l => {
              const on = structureRoof(item) === l.roof && item.wallColor === l.wallColor && item.roofColor === l.roofColor;
              return (
                <button key={l.id} role="radio" aria-checked={on} data-testid={`building-look-${l.id}`} onClick={() => set({ roof: l.roof as RoofKind, wallColor: l.wallColor, roofColor: l.roofColor })} className={`rounded-md border px-1.5 py-1 flex items-center gap-1.5 text-[11px] font-semibold ${on ? "border-orange-500 bg-orange-500/10 text-zinc-100" : "border-white/[0.12] text-zinc-300 hover:border-zinc-500"}`}>
                  <span className="w-3 h-3 rounded-sm" style={{ background: `linear-gradient(135deg, ${l.roofColor} 50%, ${l.wallColor} 50%)` }} />
                  {l.label}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {item.kind === "shelter" && (
        <Field label="Shape">
          {/* (its shape is its outline's: eight sides, a gazebo; whatever its roof) */}
          <IconPick label="Shelter shape" value={item.points.length === 8 ? "gazebo" : "rectangle"} onChange={v => set(v === "gazebo" ? { points: gazeboOutline(item.points), roof: "pyramid" } : { points: boxOutline(item.points), roof: "hip" })} options={[{ value: "rectangle", label: "Pavilion" }, { value: "gazebo", label: "Gazebo" }]} />
        </Field>
      )}
      {(item.kind === "building" || item.kind === "shelter") && (
        <>
          <Field label="Roof">
            <IconPick label="Roof" value={structureRoof(item)} onChange={v => set({ roof: v as RoofKind })} options={[{ value: "gable", label: "Gable" }, { value: "hip", label: "Hip" }, { value: "pyramid", label: "Pyramid" }, { value: "shed", label: "Shed" }, { value: "flat", label: "Flat" }]} />
          </Field>
          <div className="grid grid-cols-2 gap-x-3">
            <ColorInput label="Roof color" value={item.roofColor ?? roofInk} onChange={(v: string) => set({ roofColor: v }, false)} onDone={commit} />
            {item.kind === "building" && <ColorInput label="Wall color" value={item.wallColor ?? "#6e5036"} onChange={(v: string) => set({ wallColor: v }, false)} onDone={commit} />}
          </div>
          {(item.roofColor !== undefined || item.wallColor !== undefined) && (
            <div className="mb-2"><Button small tone="ghost" onClick={() => set({ roofColor: undefined, wallColor: undefined })} testid="structure-colors-reset" title="The usual colors for its kind again"><RotateCcw size={13} /> Reset the colors</Button></div>
          )}
        </>
      )}
    </>
  );
}

/** A built thing's map symbol, small, on its kind's chip (as on the tool bar's). */
export const builtIcon = (k: StructureKind) => <span className="inline-block" dangerouslySetInnerHTML={{ __html: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" style="overflow:visible;display:block">${structureLegend(k, 16, 16, 0.9, undefined, `kind-${k}`)}</svg>` }} />;
/** An amenity's map symbol, small, on its kind's chip. */
export const amenityIcon = (k: AmenityKind) => <span className="inline-block" dangerouslySetInnerHTML={{ __html: symbolSvg(amenitySymbol(k, { x: 0, y: 0 }, 1), 14, k === "here" ? 19 : 14) }} />;

/** Roofs and a shelter's shapes, drawn small from the side (stroked in the chip's text color). */
const ROOF_ICONS: Record<string, string> = {
  gable: "M4 15 V8 L12 3 L20 8 V15 Z",
  hip: "M2 8 L7 4 H17 L22 8 Z M4 8 V15 H20 V8",
  pyramid: "M3 8 L12 2.5 L21 8 Z M12 2.5 V8 M5 8 V15 H19 V8",
  shed: "M3 9.5 L21 4.5 M5 9 V15 H19 V5.5",
  flat: "M3 6.5 H21 V8.5 H3 Z M5 8.5 V15 H19 V8.5",
  rectangle: "M2 7 L6 3 H18 L22 7 Z M5 7 V15 M12 7 V15 M19 7 V15",
  gazebo: "M3 8 L12 2.5 L21 8 Z M6 8 V15 M18 8 V15"
};
/** One of a few, each a small picture with its name under it (roofs, a shelter's shape). */
function IconPick<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`flex flex-col items-center gap-0.5 rounded-[10px] px-1 py-1.5 touch:min-h-[44px] text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.07] text-zinc-300 hover:bg-white/[0.12] hover:text-zinc-50"}`}>
            <svg width="24" height="17" viewBox="0 0 24 17" aria-hidden><path d={ROOF_ICONS[o.value]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A label's settings; just put down, its text is ready to type over. */
function LabelSettings({ item, set }: { item: LabelItem; set: (patch: Record<string, unknown>, history?: boolean) => void }) {
  const fresh = isNewLabel(item.id);
  useEffect(() => { if (fresh) forgetNewLabel(); }, [fresh]);
  return (
    <>
      <Field label="Text" help="amenities"><TextInput label="Label text" testid="label-text" value={item.text} onChange={v => set({ text: v }, false)} onDone={commit} autoSelect={fresh} /></Field>
      <Slider label="Size" min={9} max={40} value={item.fontSize} onChange={v => set({ fontSize: v }, false)} onDone={commit} format={v => `${v} px`} />
      <div className="mb-3"><ColorInput label="Color" value={item.color} onChange={v => set({ color: v }, false)} onDone={commit} /></div>
      <TurnButtons item={item} />
    </>
  );
}

/** A thing's settings (`bare`: only them, with no title: a tee or basket in its hole's panel). */
function ItemInspector({ item, bare = false }: { item: CourseItem; bare?: boolean }) {
  const doc = useCourse(s => s.doc);
  // (on a phone or tablet, the sheet's own header names it already)
  const compact = useLayout() !== "desktop";
  const u = doc.units;
  const set = (patch: Record<string, unknown>, history = true) => updateItem(item.id, patch as Partial<CourseItem>, history);
  // (shapes and built things can belong to several holes: an OB line along two fairways)
  const shared = item.type === "area" || item.type === "line" || item.type === "structure";
  const ownHole = "holeId" in item ? item.holeId : undefined;
  const mine = ownHole ? [ownHole, ...((shared && item.alsoHoles) || [])] : [];
  const setHoles = (ids: string[]) => set(shared ? { holeId: ids[0], alsoHoles: ids.length > 1 ? ids.slice(1) : undefined } : { holeId: ids[0] });
  // The holes it's for: OB for them, counts for them (a hazard), or belongs to them
  const holePicker = (label: string, all: string, help?: string) => (
    <Field label={label} help={help}>
      <HoleChips label={`${label} ${shared ? "holes" : "hole"}`} testid="belongs-to" picked={mine.length ? mine : "all"} onChange={v => setHoles(v === "all" ? [] : v)} all={all} single={!shared} />
    </Field>
  );
  let body: JSX.Element | null = null;
  // A length typed in the course's units (kept in feet), one undo step once it's typed
  const M = 3.28084;
  const lenIn = (label: string, ft: number, min: number, max: number, onFt: (v: number) => void) => u === "m"
    ? <NumberInput label={label} value={Math.round((ft / M) * 10) / 10} min={Math.round((min / M) * 10) / 10} max={Math.round((max / M) * 10) / 10} step={0.1} unit="m" onChange={v => onFt(Math.round(v * M * 10) / 10)} onDone={commit} />
    : <NumberInput label={label} value={ft} min={min} max={max} step={0.5} unit="ft" onChange={onFt} onDone={commit} />;
  switch (item.type) {
    case "tee":
      body = (
        <>
          {holeStats(doc, doc.holes.find(h => h.id === item.holeId) ?? doc.holes[0]).complete && doc.holes.some(h => h.id === item.holeId) && (
            <div className="mb-3"><Button small onClick={() => useEditor.getState().set({ teeView: item.holeId, teeViewTee: item.id, flyover: false })} testid="tee-view-this"><Eye size={14} /> View from this tee</Button></div>
          )}
          <Field label="Tee color (skill level)" help="tee-basket">
            <ChipPick label="Tee color" value={item.level} onChange={v => setTeeLevel(item.id, v)} options={TEE_ORDER.map(l => ({ value: l, label: TEE_LEVELS[l].label, color: TEE_LEVELS[l].color, title: `${TEE_LEVELS[l].skill} (${TEE_LEVELS[l].rating})` }))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Pad width">{lenIn("Pad width", item.padWidth, 2, 20, v => set({ padWidth: v }, false))}</Field>
            <Field label="Pad length">{lenIn("Pad length", item.padLength, 4, 30, v => set({ padLength: v }, false))}</Field>
          </div>
          <Field label="Surface">
            <ChipPick label="Tee surface" value={item.surface} onChange={v => set({ surface: v })} options={(Object.keys(TEE_SURFACES) as TeeSurface[]).map(k => ({ value: k, label: TEE_SURFACES[k].label, color: TEE_SURFACES[k].color }))} />
          </Field>
          <TurnButtons item={item} />
          {item.aimFixed && <div className="mb-2"><Button small onClick={() => set({ aimFixed: false })}>Face down the hole again</Button></div>}
        </>
      );
      break;
    case "basket":
      body = (
        <>
          <Field label="Pin position" help="tee-basket">
            <Segmented label="Pin position" value={item.position} onChange={v => setPinPosition(item.id, v)} options={PIN_POSITIONS.map(p => ({ value: p, label: p }))} />
          </Field>
          <Field label="Raised above the ground">
            {lenIn("Raised", item.raised ?? 0, 0, 30, v => set({ raised: v || undefined }, false))}
          </Field>
        </>
      );
      break;
    case "mando":
      body = (
        <>
          <Field label="The disc must pass" help="mando">
            <Segmented label="Mando side" value={item.side} onChange={v => set({ side: v })} options={[{ value: "left", label: "Left of it" }, { value: "right", label: "Right of it" }]} />
          </Field>
          <TurnButtons item={item} />
          {holePicker("Belongs to", "Whole course")}
        </>
      );
      break;
    case "dropzone":
      body = (
        <>
          {holePicker("Belongs to", "Whole course", "mando")}
          <TurnButtons item={item} />
        </>
      );
      break;
    case "area": {
      // (a flat building is an old course's: offered only to one that is one)
      const kinds = item.kind === "building" ? [...AREA_ORDER, item.kind] : AREA_ORDER;
      // (a field, court or play area: its own kinds)
      const fk = item.kind === "field" ? fieldKindOf(item) : null;
      const courts = fk && COURT_FIELDS.includes(fk) ? courtCount(fk, item.points) : 1;
      body = (
        <>
          {fk ? (
            <Field label="Kind" help="park">
              <ChipPick label="Field kind" testid="field-kind" value={fk} onChange={v => setFieldKind(item.id, v)} options={fieldKindOptions()} />
            </Field>
          ) : (
            <Field label="Kind" help={item.kind === "ob" ? "ob" : "areas"}>
              <ChipPick label="Area kind" value={item.kind} onChange={v => set({ kind: v })} options={kinds.map(k => ({ value: k, label: AREA_KINDS[k].label, color: AREA_KINDS[k].color }))} />
            </Field>
          )}
          {fk && <FieldSettings item={item} kind={fk} />}
          {/* (its shape painted: added to or taken from with the brush, this one only) */}
          {!fk && item.kind !== "building" && !item.locked && (
            <Button small full testid="reshape-brush" title="Paint this area bigger or smaller, or a section thinner or thicker, with the brush" onClick={() => {
              const brush = item.kind === "woods" && (item.bushes ?? 0) >= 1;
              useEditor.getState().set({ tool: "draw-area", areaKind: item.kind, standOf: brush ? "bush" : null, ...(brush ? { treeKind: "bush" as const } : {}), drawShape: "paint", reshapeId: item.id, areaBrush: "add" });
            }}><Brush size={14} /> Reshape with the brush</Button>
          )}
          {(item.kind === "woods" || item.kind === "rough") && <WoodsSettings item={item} />}
          {hasObChoice(item) && <ObPick item={item} />}
          {item.kind === "ob" && holePicker("OB for", "All holes")}
          {(RULE_AREAS.has(item.kind) || (fk && item.outOfPlay)) && holePicker("Counts for", "All holes")}
          {item.kind !== "parking" && item.kind !== "building" && !fk && <Toggle label="Curved" checked={!item.straight} onChange={v => set({ straight: v ? undefined : true })} />}
          <TurnButtons item={item} />
          <Field label="Name on the map (optional)"><TextInput label="Area name" value={item.label ?? ""} onChange={v => set({ label: v || undefined }, false)} onDone={commit} /></Field>
          <div className="text-xs text-zinc-400" data-testid="area-size">{fmtArea(polygonArea(areaPath(item)), u)}{courts > 1 ? ` · ${courts} courts` : ""}</div>
        </>
      );
      break;
    }
    case "line": {
      const meta = LINE_KINDS[item.kind];
      // (a next-tee route can have none: a dashed line)
      const walk = item.kind === "walk";
      const factors = widthFactors(item), w = item.width ?? meta.width;
      body = (
        <>
          <Field label="Kind" help={item.kind === "ob" ? "ob" : "lines"}>
            <ChipPick label="Line kind" value={item.kind} onChange={v => setLineKind(item.id, v)} options={(Object.keys(LINE_KINDS) as LineKind[]).map(k => ({ value: k, label: LINE_KINDS[k].label, color: LINE_KINDS[k].color }))} />
          </Field>
          {(meta.width > 0 || walk) && <Slider label={widthVaries(item) ? "Width (all along)" : "Width"} min={walk ? 0 : 1} max={meta.maxWidth} step={0.5} value={w} onChange={v => set({ width: v || undefined }, false)} onDone={commit} format={v => (v ? fmtSize(v, u) : "Just a dashed line")} />}
          {item.kind === "stream" && widthVaries(item) && (
            <div className="flex items-center justify-between gap-2 -mt-1 mb-2" data-testid="line-widths">
              <p className="text-[11px] text-zinc-400 leading-snug tabular-nums">{fmtDist(Math.min(...factors) * w, u, false)} to {fmtDist(Math.max(...factors) * w, u)}</p>
              <button className="shrink-0 text-xs text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => set({ widths: undefined })}>Even width</button>
            </div>
          )}
          {(item.kind === "path" || walk) && <SurfacePick value={item.surface} onChange={v => set({ surface: v })} />}
          {item.kind === "fence" && (
            <Field label="Fence">
              <ChipPick label="What the fence is" testid="fence-style" value={item.fenceStyle ?? "rail"} onChange={v => set({ fenceStyle: v === "rail" ? undefined : v })} options={FENCE_STYLES} />
            </Field>
          )}
          {meta.heights && <Slider label={heightLabel(item.kind)} min={meta.heights[0]} max={meta.heights[1]} step={0.5} value={item.fenceHeight ?? meta.height!} onChange={v => set({ fenceHeight: v }, false)} onDone={commit} format={v => fmtSize(v, u)} />}
          {hasObChoice(item) && <ObPick item={item} />}
          {item.kind === "ob" && holePicker("OB for", "All holes")}
          <Toggle label="Curved" checked={!item.straight} onChange={v => set({ straight: v ? undefined : true })} />
          <TurnButtons item={item} />
          {!item.locked && <div className="mb-3"><Button small onClick={() => useEditor.getState().set({ obPick: item.id, pickCut: true, tool: "select" })} testid="line-cut">Remove a stretch</Button></div>}
          <Field label="Name on the map (optional)"><TextInput label="Line name" value={item.label ?? ""} onChange={v => set({ label: v || undefined }, false)} onDone={commit} /></Field>
          <div className="text-xs text-zinc-400">{fmtDist(pathLength(linePath(item)), u)} long</div>
        </>
      );
      break;
    }
    case "structure": {
      const meta = STRUCTURE_KINDS[item.kind];
      const line = meta.shape === "line";
      // (A line can only become another line, an outline another outline)
      const kinds = STRUCTURE_ORDER.filter(k => STRUCTURE_KINDS[k].shape === meta.shape);
      const width = structureWidth(item), height = structureHeight(item);
      body = (
        <>
          <Field label="Kind" help="build">
            <ChipPick label="Structure kind" value={item.kind} onChange={v => set({ kind: v as StructureKind })} options={kinds.map(k => ({ value: k, label: STRUCTURE_KINDS[k].label, icon: builtIcon(k) }))} />
          </Field>
          {line && <Slider label={item.kind === "wall" ? "Thickness" : "Width"} min={meta.widths[0]} max={Math.max(meta.widths[1], width)} step={0.5} value={width} onChange={v => set({ width: v }, false)} onDone={commit} format={v => fmtSize(v, u)} />}
          {meta.heightLabel && <Slider label={meta.heightLabel} min={meta.heights[0]} max={Math.max(meta.heights[1], height)} step={0.5} value={height} onChange={v => set({ height: v }, false)} onDone={commit} format={v => fmtSize(v, u)} />}
          {(item.kind === "building" || item.kind === "shelter") && <StructureLook item={item} />}
          <Field label="Name on the map (optional)"><TextInput label="Structure name" value={item.label ?? ""} placeholder={item.kind === "building" ? "e.g. Clubhouse" : item.kind === "bridge" ? "e.g. Mill Creek Bridge" : ""} onChange={v => set({ label: v || undefined }, false)} onDone={commit} /></Field>
          {holePicker("Belongs to", "Whole course")}
          <TurnButtons item={item} />
          <div className="text-xs text-zinc-400" data-testid="structure-size">{line ? `${fmtDist(pathLength(structurePath(item)), u)} long` : fmtArea(polygonArea(item.points), u)}</div>
        </>
      );
      break;
    }
    case "tree":
      body = <TreeSettings item={item} set={(patch, history = true) => set(patch as Record<string, unknown>, history)} />;
      break;
    case "amenity": {
      // (a bridge's or a shelter's sign is a course's from before: offered only to one that is one)
      const kinds = AMENITY_KINDS[item.kind].retired ? [...AMENITY_ORDER, item.kind] : AMENITY_ORDER;
      body = (
        <>
          <Field label="Kind" help="amenities">
            <ChipPick label="Amenity kind" value={item.kind} onChange={v => set({ kind: v as AmenityKind })} options={kinds.map(k => ({ value: k, label: AMENITY_KINDS[k].pick ?? AMENITY_KINDS[k].label, icon: amenityIcon(k) }))} />
          </Field>
          <Field label="Name (optional)"><TextInput label="Amenity name" value={item.label ?? ""} onChange={v => set({ label: v || undefined }, false)} onDone={commit} /></Field>
          <Field label="Mark on the map">
            <Segmented label="Mark on the map" value={item.mark === true ? "always" : item.mark === false ? "never" : "auto"} onChange={v => set({ mark: v === "always" ? true : v === "never" ? false : undefined })}
              options={[{ value: "auto", label: "Auto" }, { value: "always", label: "Always" }, { value: "never", label: "Never" }]} />
            <p className="text-[11.5px] text-zinc-400 mt-1.5 leading-snug" data-testid="mark-note">{markNote(item, doc.style.amenityMarks)}</p>
          </Field>
          {item.kind === "gate" && <Slider label="Width" min={4} max={60} step={1} value={item.width ?? 6} format={v => fmtDist(v, doc.units)} onChange={v => set({ width: v }, false)} onDone={commit} />}
          <TurnButtons item={item} />
        </>
      );
      break;
    }
    case "label":
      body = <LabelSettings item={item} set={set} />;
      break;
  }
  // (locked: why its Turn and Remove a stretch buttons aren't there)
  if (item.locked) {
    body = <><p className="text-[11.5px] text-zinc-400 mb-3" data-testid="locked-note">Locked in place.</p>{body}</>;
  }
  const holeId = "holeId" in item ? item.holeId : undefined;
  const title = itemTitle(item);
  if (bare) return body;
  return (
    <>
      {!compact && (
        <Section testid="item-title">
          <div className="text-sm font-bold text-zinc-50" data-testid="inspector-title">{title}</div>
          {holeId && (
            <button className="text-xs text-orange-300 hover:text-orange-200" onClick={() => select(holeId)}>
              Hole {holeLabel(doc, holeId)} →
            </button>
          )}
        </Section>
      )}
      <Section>{body}</Section>
    </>
  );
}

/** What a selected item is called ("Blue tee", "OB area", "Bridge"…). */
export function itemTitle(item: CourseItem) {
  return item.type === "tee" ? `${TEE_LEVELS[item.level].label} tee` : item.type === "basket" ? `Pin ${item.position}` : item.type === "area" ? (item.kind === "field" ? FIELD_KINDS[fieldKindOf(item)].label : AREA_KINDS[item.kind].label) : item.type === "line" ? LINE_KINDS[item.kind].label : item.type === "amenity" ? AMENITY_KINDS[item.kind].pick ?? AMENITY_KINDS[item.kind].label : item.type === "structure" ? STRUCTURE_KINDS[item.kind].label : ITEM_LABELS[item.type];
}

/** How much of the map's left side is covered on Design while something is picked: the slim hole
 * list and the panel next to it (fitting a hole keeps clear of them). */
export const PANEL_INSET = 388;

/** The selected hole or item, while it is shown (only with the Select tool: while placing things
 * the whole map stays clear to click on). */
export function useSelection() {
  const doc = useCourse(s => s.doc);
  const selectedId = useEditor(e => e.selectedId);
  const teeView = useEditor(e => e.teeView);
  // (tee view, editing: what's picked there has its panel too; not the hole, which has its card
  // in the view already; none in the Flyover editor, whose panel is its own)
  const teeEditing = useEditor(e => !e.flyover && !e.flyCam);
  const tool = useEditor(e => e.tool);
  const ids = useEditor(e => e.group);
  const hole = doc.holes.find(h => h.id === selectedId);
  const item = doc.items.find(i => i.id === selectedId);
  const group = useMemo(() => {
    const set = new Set(ids);
    return set.size ? doc.items.filter(i => set.has(i.id)) : [];
  }, [doc.items, ids]);
  return { hole, item, group, open: !!(hole || item || group.length) && (!teeView || (teeEditing && !hole)) && tool === "select" };
}

/** What things picked together are, by kind ("Tree ×12"), whole holes first. */
export function groupSummary(doc: CourseDoc, items: CourseItem[]) {
  const holes = wholeHoles(doc, new Set(items.map(i => i.id)));
  const inHoles = new Set(holes.flatMap(h => [...holeTees(doc, h.id), ...holeBaskets(doc, h.id)].map(i => i.id)));
  const counts = new Map<string, number>();
  for (const i of items) {
    if (inHoles.has(i.id)) continue;
    const k = i.type === "basket" ? "Basket" : itemTitle(i);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [
    ...(holes.length === 1 ? [`Hole ${holeLabel(doc, holes[0].id)}`] : holes.length ? [`Holes ${holes.map(h => holeNumber(doc, h.id)).sort((a, b) => a - b).join(", ")}`] : []),
    ...[...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
  ];
}

/** What Auto does for an amenity, in a few words. */
export const markNote = (a: AmenityItem, level?: AmenityMarks) => {
  const role = AMENITY_ROLE[a.kind];
  if (a.mark === true) return "A sign on the map, always.";
  if (a.mark === false) return role === 2 ? "Drawn as what it is, with no sign." : "No sign on the map.";
  return role === 2 ? "Auto: drawn as what it is, with no sign." : role === 0 ? "Auto: a sign, always (it's one players look for)." : level === "essentials" ? "Auto: no sign while the map shows essentials only." : "Auto: a sign when it's near the holes and there's room.";
};

/** Things picked together. */
function GroupInspector({ items }: { items: CourseItem[] }) {
  const doc = useCourse(s => s.doc);
  const parts = useMemo(() => groupSummary(doc, items), [doc, items]);
  // (all of them amenities: their mark set for all at once)
  const ams = items.every(i => i.type === "amenity") ? (items as AmenityItem[]) : null;
  const modes = ams ? new Set(ams.map(a => (a.mark === true ? "always" : a.mark === false ? "never" : "auto"))) : null;
  const setMark = (v: string) => { const ids = new Set(items.map(i => i.id)), mark = v === "always" ? true : v === "never" ? false : undefined; changeDoc(d => ({ items: d.items.map(i => (ids.has(i.id) && i.type === "amenity" ? ({ ...i, mark } as CourseItem) : i)) })); };
  return (
    <Section>
      <div className="text-sm font-bold text-zinc-50 mb-2" data-testid="inspector-title">{items.length} selected</div>
      <div className="flex flex-wrap gap-1.5" data-testid="group-kinds">
        {parts.map(p => <span key={p} className="px-2 py-0.5 rounded-full bg-white/[0.07] border border-white/[0.12] text-xs text-zinc-200">{p}</span>)}
      </div>
      {ams && modes && (
        <div className="mt-3" data-testid="group-mark">
          <Field label="Mark on the map">
            <Segmented label="Mark on the map" value={modes.size === 1 ? [...modes][0] : ""} onChange={setMark}
              options={[{ value: "auto", label: "Auto" }, { value: "always", label: "Always" }, { value: "never", label: "Never" }]} />
            {modes.size > 1 && <p className="text-[11.5px] text-zinc-400 mt-1.5">Mixed: pick one to set all {items.length}.</p>}
          </Field>
        </div>
      )}
    </Section>
  );
}

/** The selection's own content: the hole or the item, its numbers and settings. */
export function InspectorBody() {
  const { hole, item, group } = useSelection();
  const doc = useCourse(s => s.doc);
  // (a tee or basket: its hole's panel, with it opened up there)
  const owner = item && (item.type === "tee" || item.type === "basket") ? doc.holes.find(h => h.id === item.holeId) : undefined;
  return (
    <>
      {hole ? <HoleInspector hole={hole} /> : owner ? <HoleInspector hole={owner} part={item} /> : item ? <ItemInspector item={item} /> : group.length ? <GroupInspector items={group} /> : null}
      {item && !owner && "x" in item && "y" in item && item.type !== "area" && item.type !== "line" && item.type !== "structure" && <PlaceByGps item={item as never} />}
    </>
  );
}

/** Lock, duplicate, delete and close; `big` for touch (44 px targets). */
export function InspectorActions({ big = false, close = true }: { big?: boolean; close?: boolean }) {
  const { item, group } = useSelection();
  // (things picked together: locked once every one of them is)
  const locked = group.length ? group.every(i => i.locked) : !!item?.locked;
  const lock = () => {
    if (item) updateItem(item.id, { locked: !locked });
    else if (group.length) {
      const ids = new Set(group.map(i => i.id));
      changeDoc(d => ({ items: d.items.map(i => (ids.has(i.id) ? { ...i, locked: !locked } : i)) }));
    }
  };
  const base = big ? "w-11 h-11 flex items-center justify-center rounded-xl text-zinc-300 hover:bg-white/[0.09]" : "p-1.5 rounded text-zinc-400 hover:bg-white/[0.09]";
  const b = `${base} hover:text-zinc-50`;
  const sz = big ? 19 : 15;
  return (
    <>
      {(item || group.length > 0) && <button className={b} title={locked ? "Unlock" : "Lock in place"} aria-label={locked ? "Unlock" : "Lock"} onClick={lock}>{locked ? <Lock size={sz} /> : <Unlock size={sz} />}</button>}
      <button className={b} title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={duplicateSelection}><Copy size={sz} /></button>
      <button className={`${base} hover:text-red-400`} title="Delete (Del)" aria-label="Delete" onClick={deleteSelection}><Trash2 size={sz} /></button>
      {close && <button className={b} title="Close (Esc)" aria-label="Close" onClick={() => select(null)}><X size={sz} /></button>}
    </>
  );
}

/** The top of the selection's panel: back to the step (`back`: its name), or the holes before and
 * after; then lock, duplicate, delete and close. */
export function SelectionHeader({ back }: { back?: string }) {
  const { hole, item } = useSelection();
  // (a tee or basket open in its hole's panel: named here, by what acts on it)
  const part = item && (item.type === "tee" || item.type === "basket") ? itemTitle(item) : null;
  return (
    <div className="flex items-center gap-0.5 px-2 pt-2">
      {part && !back && <span className="pl-1.5 text-[12.5px] font-semibold text-zinc-300 truncate" data-testid="selection-part">{part}</span>}
      {back ? (
        <button className="flex items-center gap-1 pl-1 pr-2.5 py-1 touch:py-2.5 rounded-lg text-[13px] font-semibold text-zinc-300 hover:text-zinc-50 hover:bg-white/[0.09]" onClick={() => select(null)} data-testid="selection-back"><ChevronLeft size={17} />{back}</button>
      ) : hole && <HoleSteps holeId={hole.id} />}
      <div className="flex-1" />
      <InspectorActions close={!back} />
    </div>
  );
}

/** What's picked, on Design: down the map's left side next to the hole list (slim while this
 * shows), so the map's middle and right stay clear to work on. (On Site it takes the step's panel.) */
export function Inspector() {
  const { open, hole, item, group } = useSelection();
  const teeView = useEditor(e => !!e.teeView);
  // (tee view: the hole is in its Flyover panel; a thing selected there, its panel at the left edge)
  if (!open || (teeView && hole && !item && !group.length)) return null;
  return (
    <aside className={`absolute top-3 ${teeView ? "left-3" : "left-[76px]"} w-[300px] max-h-[calc(100%-24px)] flex flex-col glass rounded-[22px] shadow-xl shadow-black/40 z-20`} data-testid="inspector" aria-label="Selection">
      <SelectionHeader />
      <div className="overflow-y-auto min-h-0">
        <InspectorBody />
      </div>
    </aside>
  );
}
