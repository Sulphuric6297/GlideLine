// A phone's Kind picker: a row of tiles, each a small picture of the kind with its name under it
// (an area as a patch of it, a line as a stretch of it; fields, built things, amenities and trees
// with their own map symbols, bigger). A tap changes it at once, so the map above shows it.
import { useEffect, useRef, type ReactNode } from "react";
import { AREA_KINDS, LINE_KINDS } from "../../constants";
import type { AreaKind, LineKind } from "../../types";

const BLOB = "M6 8 Q14 2 26 5 Q40 6 38 17 Q37 27 22 26 Q6 27 5 18 Q3 12 6 8Z";

/** An area of this kind, drawn small: its color, and what marks it on the map. */
export function areaPicture(k: AreaKind): ReactNode {
  const c = AREA_KINDS[k].color;
  const edge = (dash?: string) => <path d={BLOB} fill={c} fillOpacity={0.22} stroke={c} strokeWidth={2} strokeDasharray={dash} />;
  let inside: ReactNode = null;
  let shape: ReactNode = <path d={BLOB} fill={c} />;
  if (k === "ob") shape = edge();
  else if (k === "hazard" || k === "casual") shape = edge("4 2.5");
  else if (k === "nogo") shape = edge("1.5 2.5");
  else if (k === "water") inside = <path d="M10 13 q3 -2.5 6 0 t6 0 t6 0 M13 19 q3 -2.5 6 0 t6 0" fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={1.4} />;
  else if (k === "woods") inside = [[13, 12, 4.5], [22, 10, 5], [30, 14, 4.5], [17, 20, 4.5], [27, 21, 4.5]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#5a8f45" stroke="#1f3d1a" strokeWidth={0.8} />);
  else if (k === "rough") inside = <path d="M11 18 l2 -5 l2 5 M19 14 l2 -5 l2 5 M27 19 l2 -5 l2 5 M15 23 l1.5 -4 l1.5 4" fill="none" stroke="#3f4f1a" strokeWidth={1.2} />;
  else if (k === "fairway") inside = <path d="M9 9 L17 26 M17 5 L26 26 M26 5 L34 23" stroke="#fff" strokeOpacity={0.25} strokeWidth={3.5} />;
  else if (k === "green") inside = <circle cx={22} cy={16} r={5} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.4} />;
  else if (k === "sand") inside = [[12, 12], [18, 18], [24, 11], [30, 17], [16, 23], [26, 22], [21, 15]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.9} fill="#7a5a2a" />);
  else if (k === "parking") inside = <path d="M12 9 V22 M18 9 V22 M24 9 V22 M30 9 V22" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.2} />;
  return <svg width="44" height="30" viewBox="0 0 44 30" aria-hidden>{shape}{inside}</svg>;
}

/** A line of this kind, drawn small. */
export function linePicture(k: LineKind): ReactNode {
  const c = LINE_KINDS[k].color, d = "M3 22 C14 4, 28 30, 41 9";
  let body: ReactNode;
  if (k === "path") body = <path d={d} fill="none" stroke={c} strokeWidth={5} strokeLinecap="round" />;
  else if (k === "walk") body = <path d={d} fill="none" stroke={c} strokeWidth={2} strokeDasharray="3 3" />;
  else if (k === "road") body = <><path d={d} fill="none" stroke={c} strokeWidth={8} /><path d={d} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="3 3" /></>;
  else if (k === "stream") body = <path d={d} fill="none" stroke={c} strokeWidth={5} strokeLinecap="round" />;
  else if (k === "hedge") body = <><path d={d} fill="none" stroke={c} strokeWidth={6} strokeLinecap="round" />{[[8, 15], [17, 13], [26, 17], [35, 13]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.6} fill="#5a8f45" />)}</>;
  else if (k === "fence") body = <><path d={d} fill="none" stroke={c} strokeWidth={1.6} />{[[6, 17], [14, 12], [22, 16], [30, 17], [38, 11]].map(([x, y], i) => <path key={i} d={`M${x} ${y - 4} V${y + 4}`} stroke={c} strokeWidth={2} />)}</>;
  // (a wall: a band of stone, its stones' joints across it)
  else if (k === "wall") body = <><path d={d} fill="none" stroke={c} strokeWidth={7} /><path d={d} fill="none" stroke="#4b463f" strokeWidth={7} strokeDasharray="1 5.5" /></>;
  else if (k === "power") body = <><path d={d} fill="none" stroke={c} strokeWidth={1.2} />{[[3, 22], [22, 16], [41, 9]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.2} fill={c} />)}</>;
  else body = <path d={d} fill="none" stroke={c} strokeWidth={2.5} strokeLinecap="round" />;
  return <svg width="44" height="30" viewBox="0 0 44 30" aria-hidden>{body}</svg>;
}

/** A map symbol made big enough for a tile. */
export const bigIcon = (icon: ReactNode) => <span className="inline-flex scale-[1.6]">{icon}</span>;

/** The row of kind tiles: one picked, the rest a tap away. */
export function KindTiles<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; picture: ReactNode }[]; onChange: (v: T) => void }) {
  const box = useRef<HTMLDivElement>(null);
  // (the one picked brought into view as the row shows)
  useEffect(() => { box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ inline: "center", block: "nearest" }); }, []);
  return (
    <div ref={box} className="flex gap-1.5 overflow-x-auto touch-pan-x touch-pan-y dg-scroll -mx-3 px-3 pb-1" role="radiogroup" aria-label={label} data-testid="kind-tiles">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} data-testid={`kind-${o.value}`}
            className={`shrink-0 w-[68px] flex flex-col items-center gap-1 rounded-2xl px-1 pt-1.5 pb-1 text-[11px] font-semibold leading-tight text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.07] text-zinc-200 active:bg-white/[0.14]"}`}>
            <span className={`w-[52px] h-[34px] rounded-xl flex items-center justify-center ${on ? "bg-zinc-900/85" : "bg-black/25"}`}>{o.picture}</span>
            <span className="line-clamp-2">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
