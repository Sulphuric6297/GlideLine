// The phone's one glass bar, floating over a map that keeps the whole screen: a pill naming what
// you're on (a tool, a tee, a hole) over a row of its settings, each with its word and what it's
// set to. A tool and a picked thing have the same bar. Tapping a setting grows its menu or dial out
// of the button, just above the bar (one at a time, never taller than a third of the screen);
// what's deeper opens in the same menu with ‹ to come back. A switch or an action acts at once. The
// pill opens the rest: every tool, or what can be done with the thing. A tap on the map closes
// what's open without drawing on it; the row slides sideways when it holds more than fits, with +N
// saying how many are past the edge, and opens where it was last left. While a finger works on the
// map the bar fades almost away (`faded`). Held sideways (`side`), it stands up the right edge.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { MenuRows } from "../ui";

export type BarSetting = {
  id: string;
  /** What it is (small, on top). */
  name: string;
  /** What it's set to (under it). */
  value?: ReactNode;
  /** What it opens: a menu's rows, tiles or a list, or (`wide`) a dial or a field across the bar. */
  control?: ReactNode;
  wide?: boolean;
  /** Acts at once instead: an action, or a switch (`on` its state). */
  run?: () => void;
  on?: boolean;
  testid?: string;
};

export type BarPill = {
  name: ReactNode;
  small?: ReactNode;
  icon?: ReactNode;
  /** A hole's arrows to the holes either side. */
  prev?: () => void;
  next?: () => void;
  testid?: string;
};

/** Going deeper inside a menu, and back (a setting with settings of its own). */
type Nav = { push: (title: string, node: ReactNode) => void; back: () => void; close: () => void };
const BarNav = createContext<Nav>({ push: () => {}, back: () => {}, close: () => {} });
export const useBarNav = () => useContext(BarNav);

/** A row of a glass menu that opens what's deeper (its own settings), in the same menu. */
export function DeeperRow({ title, value, icon, children, testid }: { title: string; value?: ReactNode; icon?: ReactNode; children: ReactNode; testid?: string }) {
  const nav = useBarNav();
  return (
    <button type="button" className="w-full flex items-center gap-3 text-left rounded-[18px] px-3 min-h-[46px] text-zinc-100 active:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      onClick={() => nav.push(title, children)} data-testid={testid}>
      {icon && <span className="shrink-0 flex text-zinc-300">{icon}</span>}
      <span className="flex-1 min-w-0 text-[15px] font-semibold truncate">{title}</span>
      {value !== undefined && <span className="shrink-0 text-[13.5px] text-zinc-400 flex items-center gap-1.5">{value}</span>}
      <ChevronRight size={16} className="shrink-0 text-zinc-500" />
    </button>
  );
}

/** A plain row of a glass menu that acts (an action, a thing to pick). */
export function ActRow({ label, hint, icon, onClick, danger = false, accent = false, testid }: { label: ReactNode; hint?: ReactNode; icon?: ReactNode; onClick: () => void; danger?: boolean; accent?: boolean; testid?: string }) {
  const nav = useBarNav();
  return (
    <button type="button" className={`w-full flex items-center gap-3 text-left rounded-[18px] px-3 min-h-[46px] py-2 active:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${danger ? "text-red-300" : accent ? "text-orange-300" : "text-zinc-100"}`}
      onClick={() => { nav.close(); onClick(); }} data-testid={testid}>
      {icon && <span className="shrink-0 flex">{icon}</span>}
      <span className="min-w-0 flex flex-col">
        <span className="text-[15px] font-semibold leading-tight">{label}</span>
        {hint && <span className="text-[12.5px] leading-snug text-zinc-400 mt-0.5">{hint}</span>}
      </span>
    </button>
  );
}

// (where each kind of row was left, slid sideways: it opens there again)
const leftAt = new Map<string, number>();

type Open = { id: string; from: DOMRect; wide: boolean; pill: boolean } | null;

type Props = {
  pill: BarPill;
  /** What the pill opens (every tool; what can be done with the thing); `pillWide`: across the bar. */
  pillMenu?: ReactNode;
  pillWide?: boolean;
  settings: BarSetting[];
  /** ✓ at the row's end: put the tool away, put the thing down. */
  onDone?: () => void;
  doneLabel?: string;
  /** In the row's place, as it is (drawing: room for the drawing's Undo, Cancel and Done). */
  replace?: ReactNode;
  /** The row's place is remembered under this name (a kind of thing, a tool). */
  remember: string;
  /** While a finger works on the map: almost gone. */
  faded?: boolean;
  /** Up the right edge (a phone on its side). */
  side?: boolean;
  /** How far up from the foot of the map (the on-screen keyboard's height is added). */
  bottom?: number;
  testid?: string;
  /** Its height as it rests, for what keeps clear of it. */
  onHeight?: (px: number) => void;
  /** Which setting's menu or dial is open ("pill": the pill's; null: none), as it changes. */
  onOpen?: (id: string | null) => void;
  /** A setting to open, asked for from outside (a field's part tapped on the map: its Parts). */
  want?: string | null;
};

export function GlassBar({ pill, pillMenu, pillWide = false, settings, onDone, doneLabel = "Done", replace, remember, faded = false, side = false, bottom = 0, testid = "glass-bar", onHeight, onOpen, want }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const [stack, setStack] = useState<{ title: string; node: ReactNode }[]>([]);
  const [closing, setClosing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(0);

  const close = useCallback(() => {
    if (!open) return;
    setClosing(true);
    window.setTimeout(() => { setOpen(null); setStack([]); setClosing(false); }, 130);
  }, [open]);
  // (another thing picked, another tool: nothing left open)
  useEffect(() => { setOpen(null); setStack([]); }, [remember]);
  useEffect(() => { onOpen?.(open?.id ?? null); }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!want) return;
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-setting="${want}"]`);
    const s = settings.find(x => x.id === want);
    if (!el || !s?.control) return;
    el.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    setStack([]);
    setOpen({ id: want, from: el.getBoundingClientRect(), wide: !!s.wide, pill: false });
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps
  // A choice picked from a menu of one set of choices closes it, after a moment to see it lit (a
  // menu with several sets, a wood's penalty and its OB side say, stays for the next)
  const picked = (e: React.MouseEvent) => {
    const radio = (e.target as HTMLElement).closest('[role="radio"]');
    const menu = e.currentTarget as HTMLElement;
    if (radio && menu.querySelectorAll('[role="radiogroup"]').length === 1) window.setTimeout(close, 160);
  };
  const toggle = (id: string, el: HTMLElement, wide: boolean, isPill = false) => {
    if (open?.id === id) { close(); return; }
    setStack([]);
    setClosing(false);
    setOpen({ id, from: el.getBoundingClientRect(), wide, pill: isPill });
  };

  // The on-screen keyboard: the bar and what's open ride above it
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setKb(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", on);
    return () => vv.removeEventListener("resize", on);
  }, []);

  // How many settings are past the row's edge, and where it was left
  const count = useCallback(() => {
    const r = rowRef.current;
    if (!r) return;
    const edge = side ? r.getBoundingClientRect().bottom : r.getBoundingClientRect().right;
    let n = 0;
    r.querySelectorAll<HTMLElement>("[data-setting]").forEach(b => { const box = b.getBoundingClientRect(); if ((side ? box.bottom : box.right) > edge + 2) n++; });
    setPast(n);
    leftAt.set(remember, side ? r.scrollTop : r.scrollLeft);
  }, [remember, side]);
  useLayoutEffect(() => {
    const r = rowRef.current;
    if (!r) return;
    const at = leftAt.get(remember) ?? 0;
    if (side) r.scrollTop = at; else r.scrollLeft = at;
    count();
  }, [remember, settings.length, side, count]);
  useEffect(() => {
    const ro = new ResizeObserver(() => { count(); const b = boxRef.current; if (b) onHeight?.(Math.round(b.getBoundingClientRect().height)); });
    if (rowRef.current) ro.observe(rowRef.current);
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [count, onHeight]);
  const more = () => {
    const r = rowRef.current;
    if (!r) return;
    if (side) r.scrollBy({ top: r.clientHeight * 0.8, behavior: "smooth" });
    else r.scrollBy({ left: r.clientWidth * 0.8, behavior: "smooth" });
  };

  const nav: Nav = { push: (title, node) => setStack(s => [...s, { title, node }]), back: () => setStack(s => s.slice(0, -1)), close };
  const openSetting = open && !open.pill ? settings.find(s => s.id === open.id) : null;
  // (a setting that changed into an action, say, while it was open: nothing to show)
  const root = open?.pill ? pillMenu : openSetting?.control;
  const deep = stack[stack.length - 1];

  // Where what's open sits: grown out of its button, just above the bar (the pill's above the pill)
  const W = typeof window !== "undefined" ? window.innerWidth : 400;
  const wide = !!open && open.wide;
  const width = side ? 300 : wide ? W - 20 : Math.min(W - 20, 300);
  // (a menu over its button; the pill's from the left edge, over the pill)
  const left = !open ? 10 : side ? undefined : wide || open.pill ? 10 : Math.max(10, Math.min(W - 10 - width, open.from.left + open.from.width / 2 - width / 2));
  const origin = open ? (side ? "right center" : `${Math.round(open.from.left + open.from.width / 2 - (left ?? 0))}px bottom`) : undefined;
  const rowH = 64, gap = 8, pillH = 44;
  const panelBottom = side ? undefined : bottom + kb + 18 + rowH + gap + (open?.pill ? pillH + gap : 0);

  const pillEl = (
    <div className={`flex items-center h-11 rounded-full border shadow-xl transition-opacity duration-200 ${open && !open.pill ? "opacity-0 pointer-events-none" : ""} ${open?.pill ? "bg-zinc-100 border-transparent text-zinc-900" : "glass border-white/10 text-zinc-50"}`} data-testid={pill.testid ?? "bar-pill"}>
      {pill.prev && <button className="w-10 h-11 flex items-center justify-center text-zinc-300 rounded-full active:bg-white/10" aria-label="The hole before" onClick={pill.prev} data-testid="hole-prev"><ChevronLeft size={19} /></button>}
      <button className={`h-11 ${pill.prev ? "px-1" : "pl-3.5"} pr-3 flex items-center gap-2 rounded-full min-w-0 ${side ? "flex-1 justify-center !px-2 gap-1" : "max-w-[calc(100vw-120px)]"} focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`}
        aria-haspopup={pillMenu ? "menu" : undefined} aria-expanded={!!open?.pill} disabled={!pillMenu}
        onClick={e => pillMenu && toggle("pill", e.currentTarget, pillWide, true)} data-testid="pill-open">
        {pill.icon && !side && <span className={`shrink-0 flex ${open?.pill ? "" : "text-orange-300"}`}>{pill.icon}</span>}
        <span className="text-[15px] font-bold truncate" data-testid="sheet-title">{pill.name}</span>
        {pill.small && !side && <span className={`text-[12.5px] truncate ${open?.pill ? "text-zinc-600" : "text-zinc-400"}`}>· {pill.small}</span>}
        {pillMenu && (open?.pill ? <ChevronUp size={15} className="shrink-0 text-zinc-500" /> : <ChevronDown size={15} className="shrink-0 text-zinc-400" />)}
      </button>
      {pill.next && <button className="w-10 h-11 flex items-center justify-center text-zinc-300 rounded-full active:bg-white/10" aria-label="The hole after" onClick={pill.next} data-testid="hole-next"><ChevronRight size={19} /></button>}
    </div>
  );

  const doneEl = onDone && (
    <button className="shrink-0 w-[50px] h-[50px] rounded-full bg-orange-300 text-zinc-950 flex items-center justify-center active:bg-orange-400 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label={doneLabel} title={doneLabel} onClick={() => { close(); onDone(); }} data-testid="bar-done">
      <Check size={23} strokeWidth={3} />
    </button>
  );

  const row = replace !== undefined ? replace : (
    <div className={`flex ${side ? "flex-col w-[98px] h-full py-1.5" : "h-[64px] px-1.5"} items-center gap-1 rounded-[26px] glass border border-white/10 shadow-2xl`}>
      <div ref={rowRef} onScroll={count} role="toolbar" aria-label="Settings"
        className={`flex-1 min-w-0 min-h-0 flex ${side ? "flex-col w-full overflow-y-auto touch-pan-y" : "overflow-x-auto touch-pan-x"} gap-1 dg-noscrollbar ${past ? (side ? "dg-fade-b" : "dg-fade-r") : ""}`} data-testid="bar-row">
        {settings.map(s => {
          const on = open?.id === s.id;
          const sw = s.on !== undefined;
          return (
            <button key={s.id} data-setting={s.id} data-testid={s.testid ?? `strip-${s.id}`}
              aria-expanded={s.control ? on : undefined} aria-pressed={sw ? s.on : undefined}
              onClick={e => (s.run ? (close(), s.run()) : s.control ? toggle(s.id, e.currentTarget, !!s.wide) : undefined)}
              className={`shrink-0 h-[50px] ${side ? "w-full items-center text-center" : "items-start text-left"} px-3 rounded-[18px] flex flex-col justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-zinc-100 text-zinc-900" : "text-zinc-50 active:bg-white/[0.1]"}`}>
              <span className={`text-[11px] font-semibold leading-none whitespace-nowrap ${on ? "text-zinc-600" : "text-zinc-400"}`}>{s.name}</span>
              {(s.value !== undefined || sw) && (
                <span className="mt-1 text-[15px] font-semibold leading-none whitespace-nowrap flex items-center gap-1.5">
                  {s.value}
                  {sw && <span className={`inline-block w-[30px] h-[18px] rounded-full relative transition-colors ${s.on ? "bg-orange-300" : "bg-white/20"}`}><span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${s.on ? "right-[2px]" : "left-[2px]"}`} /></span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {past > 0 && <button className="shrink-0 h-[30px] min-w-[34px] px-2 rounded-full bg-white/[0.13] text-[13px] font-bold text-zinc-100 tabular-nums" aria-label={`${past} more settings`} onClick={more} data-testid="bar-more">+{past}</button>}
      {doneEl}
    </div>
  );

  return (
    <BarNav.Provider value={nav}>
      {/* (what's open closes on a tap on the map, which goes no further) */}
      {open && <div className="absolute inset-0 z-[34]" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); close(); }} data-testid="bar-away" />}
      {open && root && (
        <div className={`absolute z-[36] bg-[rgba(20,27,20,0.96)] border border-white/10 shadow-2xl shadow-black/50 rounded-[26px] p-1.5 ${closing ? "dg-shrink" : "dg-grow"}`}
          style={side ? { right: 122, top: 12, maxHeight: "calc(100% - 24px)", width, transformOrigin: origin, display: "flex", flexDirection: "column" } : { left, width, bottom: panelBottom, maxHeight: "min(36dvh, 340px)", transformOrigin: origin, display: "flex", flexDirection: "column" }}
          role="dialog" aria-label={open.pill ? "More" : openSetting?.name} data-testid={open.pill ? "pill-menu" : "bar-menu"} onClick={picked}>
          {(deep || (!open.pill && !open.wide)) && (
            <div className="shrink-0 flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-[13px] font-semibold text-zinc-400">
              {deep && <button className="flex items-center text-orange-300 font-semibold text-[14.5px] -ml-1 pr-1 min-h-[34px]" onClick={nav.back} data-testid="menu-back"><ChevronLeft size={18} />{stack.length > 1 ? stack[stack.length - 2].title : openSetting?.name}</button>}
              <span className="text-zinc-100 text-[15px] font-bold truncate">{deep ? deep.title : openSetting?.name}</span>
            </div>
          )}
          <div className="min-h-0 overflow-y-auto overscroll-contain dg-scroll touch-pan-y px-0.5 pb-0.5" data-testid="strip-pane">
            <MenuRows.Provider value={true}>{deep ? deep.node : root}</MenuRows.Provider>
          </div>
        </div>
      )}
      {/* (only the pill and the row take a touch: the room kept for the drawing's buttons doesn't) */}
      <div ref={boxRef} className={`absolute z-[35] pointer-events-none [&>*]:pointer-events-auto transition-opacity duration-200 ${faded ? "opacity-[0.14]" : ""} ${side ? "right-3 top-3 bottom-3 flex flex-col gap-2 items-stretch w-[98px]" : "left-2.5 right-2.5 flex flex-col gap-2 items-start"}`}
        style={side ? undefined : { bottom: bottom + kb + 18 }} data-testid={testid}>
        {pillEl}
        <div className={`${side ? "flex-1 min-h-0" : "w-full"} ${replace !== undefined ? "!pointer-events-none" : ""}`}>{row}</div>
      </div>
    </BarNav.Provider>
  );
}

/** A slider up the screen's left edge (a brush's size, the ground brush's strength), as Procreate
 * has on a phone: thumb up for more, down for less, its number shown beside it while it slides.
 * `onSlide` says when it starts and stops sliding (the brush's ring shows meanwhile). */
export function EdgeSlider({ value, min, max, step = 1, label, format, icon, top, height, faded = false, onChange, onDone, onSlide, testid }: {
  value: number; min: number; max: number; step?: number; label: string; format: (v: number) => string; icon: ReactNode; top: number; height: number; faded?: boolean;
  onChange: (v: number) => void; onDone?: () => void; onSlide?: (on: boolean) => void; testid?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [sliding, setSliding] = useState(false);
  const f = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const at = (y: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    const t = 1 - Math.max(0, Math.min(1, (y - r.top) / r.height));
    const v = Math.round((min + t * (max - min)) / step) * step;
    if (v !== value) onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div className={`absolute left-4 z-[33] w-[46px] rounded-[23px] glass border border-white/10 shadow-xl select-none touch-none transition-opacity duration-200 ${faded ? "opacity-[0.14]" : ""}`} style={{ top, height }}
      role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={format(value)} tabIndex={0} data-testid={testid}
      onKeyDown={e => { const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? step : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -step : 0; if (by) { e.preventDefault(); onChange(Math.min(max, Math.max(min, value + by))); onDone?.(); } }}
      onPointerDown={e => { e.stopPropagation(); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* (a pointer that's gone already) */ } setSliding(true); onSlide?.(true); at(e.clientY); }}
      onPointerMove={e => { if (sliding) at(e.clientY); }}
      onPointerUp={() => { if (!sliding) return; setSliding(false); onSlide?.(false); onDone?.(); }}
      onPointerCancel={() => { if (!sliding) return; setSliding(false); onSlide?.(false); onDone?.(); }}>
      <span className="absolute top-2.5 left-1/2 -translate-x-1/2 text-zinc-300 flex">{icon}</span>
      <div ref={track} className="absolute left-1/2 top-[42px] bottom-[38px] w-[5px] -ml-[2.5px] rounded-full bg-white/20">
        <div className="absolute inset-x-0 bottom-0 rounded-full bg-orange-300" style={{ height: `${f * 100}%` }} />
        <div className={`absolute left-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.45)] transition-[width,height,margin] ${sliding ? "w-[34px] h-[34px] -ml-[17px] -mb-[17px]" : "w-7 h-7 -ml-3.5 -mb-3.5"}`} style={{ bottom: `${f * 100}%` }} />
      </div>
      <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[12px] font-bold text-zinc-50 whitespace-nowrap tabular-nums">{format(value)}</span>
      {sliding && <span className="absolute left-[56px] bg-[rgba(20,27,20,0.96)] border border-white/10 rounded-[14px] px-3 py-1.5 text-[17px] font-bold text-zinc-50 whitespace-nowrap tabular-nums pointer-events-none" style={{ bottom: `calc(38px + ${f} * (100% - 80px) - 18px)` }}>{format(value)}</span>}
    </div>
  );
}
