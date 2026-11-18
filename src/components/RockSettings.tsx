// A rock's own settings in its panel (and a rock surface's): what it is, its stone, its size and how
// deep it sits, its shape (a profile, an outline drawn on the map), then, folded away, its edges,
// moss and lichen. The phone's bar has the same names in the same order (mobile/HoleStrip).
import { Shuffle } from "lucide-react";
import { ROCK_KINDS, ROCK_LOOK_ORDER, ROCK_LOOKS, ROCK_ORDER, ROCK_STONES, STONE_ORDER, stoneShown } from "../constants";
/** A size to the half foot (or a tenth of a meter), as the panel's other sizes are. */
const fmtSize = (ft: number, units: "ft" | "m") => (units === "m" ? `${(ft / 3.28084).toFixed(1)} m` : `${Math.round(ft * 2) / 2} ft`);
import { toLineWall } from "../state/actions";
import { changeDoc, useCourse } from "../state/course";
import { ROCK_BURIED, rockSpan } from "../three/rocks";
import type { AreaItem, LineItem, P, RockItem, RockKind, RockLook, RockProfile, RockStone } from "../types";
import { Button, ChipPick, Field, Segmented, Slider } from "./ui";

const svg = (d: string, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden><path d={d} /></svg>
);
/** Each kind of rock's little drawing (the tool bar, its panel, a phone's strip). */
export const ROCK_ICONS: Record<RockKind | "surface", JSX.Element> = {
  boulder: svg("M2 13c0-4 2.5-7.5 6-7.5s6 3 6 7.5z"),
  block: svg("M2 13l1.5-6 5-3 5 2.5.5 6.5z M3.5 7l5 1.5 5-2 M8.5 8.5V13"),
  ledge: svg("M1.5 13h13 M2.5 13V10.5h11V13 M4 10.5V8h8v2.5 M5.5 8V6h5v2"),
  outcrop: svg("M1 13l3-5 3 2 3-5 5 8z M7 10l1 3"),
  cluster: svg("M1.5 13c0-2.5 1.5-4.5 3.5-4.5S8.5 10.5 8.5 13z M8 13c0-1.6 1-3 2.5-3S13 11.4 13 13z M11.5 13c.2-1 .8-1.6 1.5-1.6s1.3.6 1.5 1.6z"),
  wall: svg("M1 13h14 M1 13v-2.5h4.5V13 M5.5 13v-2.5H10V13 M10 13v-2.5h5V13 M3 10.5V8h4.5v2.5 M7.5 10.5V8H12v2.5"),
  surface: svg("M1 12c2-1 3.5-1.5 6-1.5s4.5.5 8 1.5 M3 10c1-.8 2.5-1 4-1 M9 9.5c1.5-.2 3 .2 4.5 1")
};
/** The Rocks tool's own drawing, at the tool bar's size. */
export const rocksToolIcon = svg("M1.5 13.5l2-5.5 3.5-2.5 3 1.5 2.5-1 2 7.5z M5 8.5l2 1.5 2.5-1", 18);

const stoneOptions = STONE_ORDER.map(k => ({ value: k, label: ROCK_STONES[k].label, color: stoneShown(k) }));
const amount = (v: number) => (v < 0.02 ? "None" : v < 0.25 ? "A little" : v < 0.55 ? "Some" : v < 0.8 ? "Lots" : "Covered");
const edges = (v: number) => (v < 0.3 ? "Rounded" : v < 0.7 ? "Weathered" : "Jagged");
/** Can it have a profile and a drawn outline (one rock, not a ledge's beds, a cluster or a wall). */
export const rockShapes = (k: RockKind) => k === "boulder" || k === "block";
/** An outline to start from: its oval, eight points round (where it meets the ground). */
export const ovalOutline = (r: RockItem): P[] => Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { x: Math.round(Math.cos(a) * r.length * 0.5 * 10) / 10, y: Math.round(Math.sin(a) * r.width * 0.5 * 10) / 10 };
});
/** Length or width changed: a drawn outline stretched with it. */
export const sizePatch = (r: RockItem, key: "length" | "width" | "height", v: number): Partial<RockItem> => {
  if (key === "height" || !r.outline) return { [key]: v };
  const f = v / Math.max(0.1, r[key]);
  return { [key]: v, outline: r.outline.map(p => (key === "length" ? { x: Math.round(p.x * f * 10) / 10, y: p.y } : { x: p.x, y: Math.round(p.y * f * 10) / 10 })) };
};
/** A kind picked: its usual size (a drawn outline kept only where it can be). */
export const kindPatch = (r: RockItem, k: RockKind): Partial<RockItem> => ({
  kind: k, length: ROCK_KINDS[k].length, width: ROCK_KINDS[k].width, height: ROCK_KINDS[k].height, buried: undefined,
  outline: rockShapes(k) ? r.outline : undefined, profile: rockShapes(k) ? r.profile : undefined
});

export function RockSettings({ item, set }: { item: RockItem; set: (patch: Partial<RockItem>, history?: boolean) => void }) {
  const u = useCourse(s => s.doc.units);
  const done = () => useCourse.getState().commit();
  const wall = item.kind === "wall";
  const buried = item.buried ?? ROCK_BURIED[item.kind];
  return (
    <div data-testid="rock-settings">
      <Field label="Kind" help="rocks">
        <ChipPick label="Rock kind" testid="rock-kind" value={item.kind} onChange={v => set(kindPatch(item, v))} options={ROCK_ORDER.filter(k => k !== "wall" || wall).map(k => ({ value: k, label: ROCK_KINDS[k].label, icon: ROCK_ICONS[k], title: ROCK_KINDS[k].help }))} />
      </Field>
      {wall && <OldWall id={item.id} level locked={item.locked} />}
      <Field label="Stone">
        <ChipPick label="Stone" testid="rock-stone" value={item.stone} onChange={v => set({ stone: v as RockStone })} options={stoneOptions} />
      </Field>
      <Slider label="Length" min={1} max={Math.max(wall ? 120 : 40, item.length)} step={0.5} value={item.length} onChange={v => set(sizePatch(item, "length", v), false)} onDone={done} format={v => fmtSize(v, u)} />
      <Slider label={wall ? "Thickness" : "Width"} min={wall ? 0.5 : 1} max={Math.max(wall ? 6 : 30, item.width)} step={0.5} value={item.width} onChange={v => set(sizePatch(item, "width", v), false)} onDone={done} format={v => fmtSize(v, u)} />
      <Slider label="Height" min={0.5} max={Math.max(wall ? 8 : 20, item.height)} step={0.5} value={item.height} onChange={v => set({ height: v }, false)} onDone={done} format={v => fmtSize(v, u)} />
      <Slider label="Buried" min={0} max={70} step={1} value={Math.round(buried * 100)} onChange={v => set({ buried: v / 100 }, false)} onDone={done} format={v => `${v}% in the ground`} />
      {rockShapes(item.kind) && (
        <div data-testid="rock-shape">
          <Field label="Profile">
            <Segmented label="Profile" value={item.profile ?? "round"} onChange={v => set({ profile: v === "round" ? undefined : (v as RockProfile) })}
              options={[{ value: "round", label: "Rounded" }, { value: "flat", label: "Flat top", title: "A flat top, to sit on or tee from" }, { value: "peak", label: "Peaked" }]} />
          </Field>
          <Field label="Outline">
            <Segmented label="Outline" value={item.outline ? "drawn" : "oval"} onChange={v => set(v === "drawn" ? { outline: ovalOutline(item), ...rockSpan(ovalOutline(item)) } : { outline: undefined })}
              options={[{ value: "oval", label: "Oval" }, { value: "drawn", label: "Drawn" }]} />
            {item.outline && <p className="text-[11.5px] text-zinc-400 mt-1.5 leading-snug" data-testid="rock-outline-note">Drag its points on the map. Drag a small dot to add one; double-click a point to remove it.</p>}
          </Field>
        </div>
      )}
      <details className="mb-2 group" data-testid="rock-look-details">
        <summary className="cursor-pointer list-none flex items-center justify-between py-1.5 text-xs font-semibold text-zinc-300 hover:text-zinc-50">Look details <span className="text-zinc-500 group-open:rotate-90 transition-transform">›</span></summary>
        <div className="pt-1.5">
          <Slider label="Edges" min={0} max={100} step={1} value={Math.round((item.edges ?? 0.5) * 100)} onChange={v => set({ edges: v / 100 }, false)} onDone={done} format={v => edges(v / 100)} />
          <Slider label="Moss" min={0} max={100} step={1} value={Math.round((item.moss ?? 0.2) * 100)} onChange={v => set({ moss: v / 100 }, false)} onDone={done} format={v => amount(v / 100)} />
          <Slider label="Lichen" min={0} max={100} step={1} value={Math.round((item.lichen ?? 0.25) * 100)} onChange={v => set({ lichen: v / 100 }, false)} onDone={done} format={v => amount(v / 100)} />
        </div>
      </details>
      <div className="mb-3">
        <Button small onClick={() => set({ seed: Math.floor(Math.random() * 9999) + 1 })} title="A different rock of the same size and stone" testid="rock-new-shape"><Shuffle size={13} /> New shape</Button>
      </div>
    </div>
  );
}

/** A wall's own settings: what it's built of and its stone. */
export function WallSettings({ item, set }: { item: LineItem; set: (patch: Partial<LineItem>, history?: boolean) => void }) {
  const dry = item.wallStyle !== "mortared";
  return (
    <div data-testid="wall-settings">
      <Field label="Wall" help="build">
        <ChipPick label="What the wall is" testid="wall-style" value={dry ? "dry" : "mortared"} onChange={v => set({ wallStyle: v === "dry" ? undefined : "mortared" })}
          options={[{ value: "dry", label: "Dry stone", title: "Stones stacked without mortar" }, { value: "mortared", label: "Mortared", title: "Cut blocks in mortar, with capstones" }]} />
      </Field>
      {dry && (
        <Field label="Stone">
          <ChipPick label="Stone" testid="wall-stone" value={item.stone ?? "fieldstone"} onChange={v => set({ stone: v as RockStone })} options={stoneOptions} />
        </Field>
      )}
    </div>
  );
}
/** A dry stone wall's look: moss, lichen, and another arrangement of its stones. */
export function WallLook({ item, set }: { item: LineItem; set: (patch: Partial<LineItem>, history?: boolean) => void }) {
  const done = () => useCourse.getState().commit();
  if (item.wallStyle === "mortared") return null;
  return (
    <>
      <details className="mb-2 group" data-testid="wall-look-details">
        <summary className="cursor-pointer list-none flex items-center justify-between py-1.5 text-xs font-semibold text-zinc-300 hover:text-zinc-50">Look details <span className="text-zinc-500 group-open:rotate-90 transition-transform">›</span></summary>
        <div className="pt-1.5">
          <Slider label="Moss" min={0} max={100} step={1} value={Math.round((item.moss ?? 0.2) * 100)} onChange={v => set({ moss: v / 100 }, false)} onDone={done} format={v => amount(v / 100)} />
          <Slider label="Lichen" min={0} max={100} step={1} value={Math.round((item.lichen ?? 0.25) * 100)} onChange={v => set({ lichen: v / 100 }, false)} onDone={done} format={v => amount(v / 100)} />
        </div>
      </details>
      <div className="mb-3">
        <Button small onClick={() => set({ seed: Math.floor(Math.random() * 9999) + 1 })} title="The same wall with its stones laid another way" testid="wall-new-shape"><Shuffle size={13} /> Shuffle stones</Button>
      </div>
    </>
  );
}
/** What an older wall says about the new one. */
export const oldWallNote = (level: boolean) => (level
  ? "This wall stays level, so on a slope it floats or digs in. Build's wall follows the ground. It can also curve, have gaps and be OB."
  : "This is an older wall. Build's wall can also be dry stone, curve, have gaps and be OB. Changed, it keeps its blocks until you pick Dry stone.");
/** A wall made before walls were lines (a rock wall, or a built wall): the button that makes it the new wall. */
export function OldWall({ id, level, locked }: { id: string; level: boolean; locked?: boolean }) {
  return (
    <div className="mb-3 rounded-xl bg-white/[0.05] p-2.5" data-testid="old-wall">
      <p className="text-[11.5px] text-zinc-300 leading-snug mb-2">{oldWallNote(level)}</p>
      {!locked && <Button small onClick={() => toLineWall(id)} testid="to-line-wall">Change to Build's wall</Button>}
    </div>
  );
}

/** Steep ground's stone: one of the rocks' stones, or the cliff's own brown (as it was before it
 * had a choice, and as a course saved without one still shows it). */
export const STEEP_STONES = [{ value: "own", label: "Brown cliff", color: "#7c5331", title: "The usual color" }, ...stoneOptions];
export const steepStoneLabel = (s: RockStone | undefined) => (s ? ROCK_STONES[s].label : "Brown cliff");
export function SteepStonePick() {
  const stone = useCourse(st => st.doc.style.steepStone);
  return <ChipPick label="Steep rock's stone" testid="steep-stone" value={stone ?? "own"} onChange={v => changeDoc(d => ({ style: { ...d.style, steepStone: v === "own" ? undefined : (v as RockStone) } }))} options={STEEP_STONES} />;
}

/** Steep ground's rock: how steep ground must be to show it, and its stone. */
export function SteepRockSettings() {
  const s = useCourse(st => st.doc.style);
  const steep = s.steepRock ?? 90;
  const setStyle = (patch: Partial<typeof s>, history = true) => changeDoc(d => ({ style: { ...d.style, ...patch } }), history);
  return (
    <div data-testid="steep-rock-settings">
      <Field label="Stone" help="rocks">
        <SteepStonePick />
      </Field>
      <Slider label="Bare rock" min={20} max={90} step={1} value={steep} onChange={v => setStyle({ steepRock: v >= 89 ? undefined : v }, false)} onDone={() => useCourse.getState().commit()} format={v => (v >= 89 ? "Never" : `Steeper than ${Math.round(v)}°`)} />
      <p className="text-[11.5px] text-zinc-400 leading-snug mb-2">To give one cliff a different stone, draw a rock surface over it with the Rocks tool.</p>
    </div>
  );
}

/** A rock surface's own settings: what it is, its stone, grass through it and loose stones. */
export function RockSurfaceSettings({ item, set }: { item: AreaItem; set: (patch: Partial<AreaItem>, history?: boolean) => void }) {
  const done = () => useCourse.getState().commit();
  const look = item.rockLook ?? "bedrock", meta = ROCK_LOOKS[look];
  return (
    <div data-testid="rock-surface-settings">
      <Field label="Look" help="rocks">
        <ChipPick label="Rock surface look" testid="rock-look" value={look} onChange={v => set({ rockLook: v === "bedrock" ? undefined : (v as RockLook), grassBetween: undefined, looseStones: undefined })}
          options={ROCK_LOOK_ORDER.map(k => ({ value: k, label: ROCK_LOOKS[k].label, title: ROCK_LOOKS[k].help }))} />
      </Field>
      <Field label="Stone">
        <ChipPick label="Stone" testid="rock-surface-stone" value={item.stone ?? "granite"} onChange={v => set({ stone: v === "granite" ? undefined : (v as RockStone) })} options={stoneOptions} />
      </Field>
      <Slider label="Grass between" min={0} max={100} step={1} value={Math.round((item.grassBetween ?? meta.grass) * 100)} onChange={v => set({ grassBetween: v / 100 }, false)} onDone={done} format={v => amount(v / 100)} />
      {look !== "cliff" && <Slider label="Loose stones" min={0} max={100} step={1} value={Math.round((item.looseStones ?? meta.stones) * 100)} onChange={v => set({ looseStones: v / 100 }, false)} onDone={done} format={v => amount(v / 100)} />}
    </div>
  );
}
