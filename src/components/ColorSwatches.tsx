// Picking a color, the same everywhere a color is picked (the map's look, a printout's colors, a
// page piece, a building's parts): swatches first (a building's palette where it has one, then the
// course's own colors), Natural or None where the setting has one, and Custom: hue, saturation and
// lightness, each a slider painted with the colors it goes through, and the color's code. With a
// mouse, pointing at a swatch shows it at once and a click keeps it.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { TEE_LEVELS, TEE_ORDER } from "../constants";
import { cardStyle } from "../lib/teeSign";
import { useCourse, useEditor } from "../state/course";
import type { CourseDoc, TeeItem } from "../types";
import { FOCUS } from "./ui";

/** The course's own colors, by name (each once). */
export const courseColors = (doc: CourseDoc) => {
  const c = cardStyle(doc);
  const tees = new Set(doc.items.filter((i): i is TeeItem => i.type === "tee").map(t => t.level));
  const out: { label: string; value: string }[] = [
    { label: "Header", value: c.header }, { label: "Header lettering", value: c.accent }, { label: "Page color", value: c.paper },
    { label: "Text color", value: c.ink }, { label: "Basket", value: doc.style.basket },
    ...TEE_ORDER.filter(l => !tees.size || tees.has(l)).map(l => ({ label: `${TEE_LEVELS[l].label} tee`, value: TEE_LEVELS[l].color }))
  ];
  return out.filter((x, i) => out.findIndex(y => y.value.toLowerCase() === x.value.toLowerCase()) === i);
};

// (color by hue 0..360, saturation and lightness 0..100)
export const hexHsl = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, Math.round(l * 100)];
  const sat = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(sat * 100), Math.round(l * 100)];
};
export const hslHex = (h: number, sat: number, l: number) => {
  const S = sat / 100, L = l / 100, c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
};

/** Custom: hue, saturation and lightness, and the color's code. */
function Custom({ value, onPick, onDone, label }: { value: string; onPick: (c: string, live?: boolean) => void; onDone?: () => void; label: string }) {
  const [hsl, setHsl] = useState(() => hexHsl(value));
  const [code, setCode] = useState(value);
  const set = (next: [number, number, number]) => { setHsl(next); const hex = hslHex(...next); setCode(hex); onPick(hex, true); };
  const [h, sat, l] = hsl;
  const bars: { name: string; v: number; max: number; bg: string; to: (v: number) => [number, number, number] }[] = [
    { name: "Hue", v: h, max: 359, bg: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(x => hslHex(x % 360, Math.max(30, sat), Math.min(70, Math.max(30, l)))).join(",")})`, to: v => [v, sat, l] },
    { name: "Saturation", v: sat, max: 100, bg: `linear-gradient(to right, ${hslHex(h, 0, l)}, ${hslHex(h, 100, l)})`, to: v => [h, v, l] },
    { name: "Lightness", v: l, max: 100, bg: `linear-gradient(to right, #000, ${hslHex(h, sat, 50)}, #fff)`, to: v => [h, sat, v] }
  ];
  return (
    <div className="mt-2.5 space-y-2.5" data-testid="color-picker">
      {bars.map(b => (
        <label key={b.name} className="block">
          <span className="flex justify-between text-[11px] text-zinc-400"><span>{b.name}</span><span className="tabular-nums">{b.v}{b.name === "Hue" ? "°" : "%"}</span></span>
          <input type="range" aria-label={`${label}: ${b.name.toLowerCase()}`} min={0} max={b.max} value={b.v} onChange={e => set(b.to(Number(e.target.value)))} onPointerUp={onDone} onKeyUp={onDone}
            className="dg-colorbar w-full h-5 touch:h-7 rounded-full appearance-none cursor-pointer" style={{ background: b.bg }} />
        </label>
      ))}
      <label className="flex items-center gap-2 text-[11px] text-zinc-400">Code
        <input aria-label={`${label}: code`} value={code} maxLength={7} spellCheck={false} onChange={e => { const v = e.target.value.trim(); setCode(v); if (/^#[0-9a-f]{6}$/i.test(v)) { setHsl(hexHsl(v)); onPick(v.toLowerCase(), true); } }} onBlur={onDone}
          className={`flex-1 min-w-0 rounded-md bg-white/[0.07] px-2 py-1 text-xs text-zinc-100 font-mono ${FOCUS}`} />
      </label>
    </div>
  );
}

export type Palette = { title: string; list: { name: string; color: string }[] };
const PILL = `relative flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 touch:min-h-11 text-[12.5px] font-semibold ${FOCUS}`;
const CONIC = "conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #ef4444)";

/**
 * The swatches, Natural or None, and Custom. `onPick`: a color (`live`: on its way, pointed at or
 * a slider moving: one undo step at `onDone`); `palettes`: named colors before the course's own;
 * `swatch`: how a swatch shows a color (painted on a wall's siding, say); `natural`: its own
 * colors (a wall's scan); `none`: a way to have no color; `top`: above it all (which walls).
 */
export function ColorSwatches({ value, onPick, onDone, none, palettes = [], swatch, natural, top, label = "Color" }: {
  value?: string; onPick: (c: string, live?: boolean) => void; onDone?: () => void; none?: { label: string; on: () => void };
  palettes?: Palette[]; swatch?: (c: string) => CSSProperties; natural?: { on: () => void; style: CSSProperties; picked: boolean }; top?: ReactNode; label?: string;
}) {
  const doc = useCourse(c => c.doc);
  const v = value?.toLowerCase();
  const [custom, setCustom] = useState(false);
  // (pointing at swatches shows each; leaving them puts back what it was)
  const before = useRef<string | undefined>(undefined);
  const point = (c: string | null) => {
    if (c) { if (before.current === undefined) before.current = value ?? ""; onPick(c, true); }
    else if (before.current !== undefined) { const b = before.current; before.current = undefined; if (b) onPick(b, true); else natural?.on(); }
  };
  const pick = (c: string) => { before.current = undefined; onPick(c); onDone?.(); };
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const grid = (list: { name: string; color: string }[], testid: string) => (
    <div className="grid gap-1.5 touch:gap-2" style={{ gridTemplateColumns: "repeat(8, minmax(0, 1fr))" }} onPointerLeave={() => !coarse && point(null)}>
      {list.map(c => {
        const on = v === c.color.toLowerCase();
        return (
          <button key={c.name + c.color} type="button" aria-label={c.name} title={c.name} aria-pressed={on} onPointerEnter={() => !coarse && point(c.color)} onClick={() => pick(c.color)}
            className={`aspect-square rounded-md touch:rounded-[9px] ring-1 ring-white/25 hover:ring-2 hover:ring-white ${on ? "outline outline-2 outline-orange-400 outline-offset-2" : ""} ${FOCUS}`}
            style={swatch ? swatch(c.color) : { background: c.color }} data-testid={testid} />
        );
      })}
    </div>
  );
  return (
    <div data-testid="color-swatches">
      {top}
      {palettes.map(p => (
        <div key={p.title} className="mb-2.5">
          <div className="text-[11.5px] font-semibold text-zinc-400 mb-1.5">{p.title}</div>
          {grid(p.list, "color-palette")}
        </div>
      ))}
      <div className="text-[11.5px] font-semibold text-zinc-400 mb-1.5">This course</div>
      {grid(courseColors(doc).map(c => ({ name: c.label, color: c.value })), "color-swatch")}
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {natural && (
          <button type="button" className={`${PILL} ${natural.picked ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100"}`} onClick={() => { before.current = undefined; natural.on(); onDone?.(); }} data-testid="color-natural">
            <span className="w-5 h-5 rounded-full ring-1 ring-white/30" style={natural.style} />Natural
          </button>
        )}
        <button type="button" aria-expanded={custom} className={`${PILL} ${custom ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100"}`} onClick={() => setCustom(o => !o)} data-testid="color-custom">
          <span className="w-5 h-5 rounded-full ring-1 ring-white/30" style={{ background: CONIC }} />Custom
        </button>
        {none && <button type="button" className={`${PILL} bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100 pl-3`} onClick={none.on} data-testid="color-none">{none.label}</button>}
      </div>
      {custom && <Custom value={value ?? "#808080"} onPick={onPick} onDone={onDone} label={label} />}
    </div>
  );
}

/**
 * A color in a panel: its name and its swatch; tapped, the picker under it, on the color it is now.
 * Live as it changes; `onDone` once a color's kept (one undo step).
 */
export function ColorInput({ label, value, onChange, onDone, name, palettes, swatch, natural, top, testid }: {
  label: string; value?: string; onChange: (v: string, live?: boolean) => void; onDone?: () => void; name?: string;
  palettes?: Palette[]; swatch?: (c: string) => CSSProperties; natural?: { on: () => void; style: CSSProperties }; top?: ReactNode; testid?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // (open, the thing it colors shows solid on the map, though it's selected: see-through, its
  // colors couldn't be judged)
  useEffect(() => {
    if (!open) return;
    const ed = useEditor.getState();
    ed.set({ colorPicking: ed.colorPicking + 1 });
    return () => { const e = useEditor.getState(); e.set({ colorPicking: Math.max(0, e.colorPicking - 1) }); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); onDone?.(); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); onDone?.(); } };
    window.addEventListener("pointerdown", away); window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc, true); };
  }, [open, onDone]);
  const shown: CSSProperties = value === undefined && natural ? natural.style : swatch && value ? swatch(value) : { background: value ?? "transparent" };
  return (
    <div ref={box} className="py-1">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => { if (open) onDone?.(); setOpen(o => !o); }} className={`w-full flex items-center gap-2 rounded-[8px] ${FOCUS}`} data-testid={testid ?? "color-input"}>
        <span className="text-xs text-zinc-300">{label}</span>
        {name && <span className="ml-auto text-[11px] text-zinc-400 truncate">{name}</span>}
        <span className={`${name ? "" : "ml-auto "}w-9 h-7 touch:w-11 touch:h-9 rounded-md ring-1 ${open ? "ring-zinc-100" : "ring-white/25"} shrink-0`} style={shown} data-testid="color-swatch-shown" />
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-black/25 ring-1 ring-white/10 p-2.5">
          <ColorSwatches value={value} onPick={onChange} onDone={onDone} palettes={palettes} swatch={swatch} label={label} top={top}
            natural={natural ? { ...natural, picked: value === undefined } : undefined} />
        </div>
      )}
    </div>
  );
}
