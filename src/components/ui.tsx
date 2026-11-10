// Small building blocks shared by the panels, and the look they share: surfaces in three greys
// (zinc-950 behind, zinc-900 panels, zinc-800 controls) told apart by spacing rather than lines,
// text-sm with zinc-400 for the quieter words, one orange button per view (dark words on it),
// and a sky-blue ring where the keyboard focus is.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { TOPICS } from "../lib/guide";
import { useEditor } from "../state/course";

/** The nearest box that scrolls (or the page). */
const scrollerOf = (el: HTMLElement | null): HTMLElement | null => {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement as HTMLElement | null;
};
/**
 * Keeps a clicked row where it was when what's around it opens or closes (one part of a list
 * opened, another closing above it): `keep(row)` before the change, and after it the list scrolls
 * by however far the row moved, so it stays under the pointer.
 */
export function useKeepInPlace() {
  const pending = useRef<{ el: HTMLElement; top: number } | null>(null);
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const moved = p.el.getBoundingClientRect().top - p.top;
    const box = scrollerOf(p.el);
    if (box && Math.abs(moved) > 0.5) box.scrollTop += moved;
  });
  return (el: HTMLElement | null) => { if (el) pending.current = { el, top: el.getBoundingClientRect().top }; };
}

/** The focus ring (keyboard only). */
export const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";
/** A floating surface: a menu, a popover, a card over the map. */
export const POPOVER = "glass-solid rounded-2xl shadow-xl shadow-black/40 ring-1 ring-white/10";
/** A row in a menu. */
export const MENU_ROW = `w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-white/[0.07] rounded-lg text-left disabled:opacity-40 ${FOCUS}`;
/** A quiet heading inside a menu or a list. */
export const MENU_HEAD = "px-3 pt-2 pb-1 text-[11px] font-semibold text-zinc-500";

export const MenuRow = ({ icon, children, onClick, testid, danger, disabled, role = "menuitem", checked }: { icon?: ReactNode; children: ReactNode; onClick: () => void; testid?: string; danger?: boolean; disabled?: boolean; role?: string; checked?: boolean }) => (
  <button className={`${MENU_ROW} ${danger ? "text-red-300" : ""}`} role={role} aria-checked={checked} onClick={onClick} data-testid={testid} disabled={disabled}>{icon}{children}</button>
);

/** One part of a panel shown by itself (a phone's tool row opens one setting at a time): the
 * `testid` of the Section or Fold to show, and none of the others. Inside it, everything shows. */
export const OnlyGroup = createContext<string | null>(null);
/** Whether a panel's part shows, and the context its own parts get. */
const useOnly = (testid?: string) => {
  const only = useContext(OnlyGroup);
  return { shown: !only || only === testid, alone: !!only && only === testid };
};

export const Section = ({ title, children, right, testid, help }: { title?: ReactNode; children: ReactNode; right?: ReactNode; testid?: string; help?: string }) => {
  const { shown, alone } = useOnly(testid);
  if (!shown) return null;
  return (
    <section className="px-4 py-3" data-testid={testid}>
      {/* (shown alone, the panel's own heading names it: only what's beside the title stays) */}
      {title && !alone && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">{title}{help && <HelpLink topic={help} label={typeof title === "string" ? title : help} />}</h3>
          {right}
        </div>
      )}
      {alone && right && <div className="flex justify-end mb-2">{right}</div>}
      <OnlyGroup.Provider value={null}>{children}</OnlyGroup.Provider>
    </section>
  );
};

/** A part of a panel that folds away under its title (open by itself when shown alone). */
export const Fold = ({ title, children, testid }: { title: ReactNode; children: ReactNode; testid: string }) => {
  const { shown, alone } = useOnly(testid);
  if (!shown) return null;
  if (alone) return <div className="px-4 py-3" data-testid={testid}><OnlyGroup.Provider value={null}>{children}</OnlyGroup.Provider></div>;
  return (
    <details className="mx-4 my-2 rounded-[16px] bg-white/[0.06] group" data-testid={testid}>
      <summary className="cursor-pointer list-none flex items-center justify-between px-3 py-2.5 text-[13.5px] font-medium text-zinc-100">{title} <span className="text-zinc-500 group-open:rotate-90 transition-transform">›</span></summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
};

/** Shown only with the whole panel (not when one part of it is shown alone). */
export const WholePanelOnly = ({ children }: { children: ReactNode }) => (useContext(OnlyGroup) ? null : <>{children}</>);

/** The help guide opened at a topic (a panel's ? button): the app listens for this. */
export const HELP_EVENT = "dg-help";
export const askHelp = (topic: string) => window.dispatchEvent(new CustomEvent(HELP_EVENT, { detail: topic }));

/** A small ? beside a setting: a tip about it (the help guide's own words), and the way on to its
 * page in the guide. */
export function HelpLink({ topic, label }: { topic: string; label: string }) {
  const [at, setAt] = useState<{ x: number; y?: number; above?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const t = TOPICS.find(x => x.id === topic);
  useEffect(() => {
    if (!at) return;
    const down = (e: PointerEvent) => { if (!tip.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAt(null); } };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", key, true); };
  }, [at]);
  // (inside a glassy or moved box, "fixed" is that box's, not the screen's: once drawn, the tip is
  // moved onto the spot it was meant for. It stays in its panel, so a click on it is in the panel.)
  useLayoutEffect(() => {
    const el = tip.current;
    if (!at || !el) return;
    const r = el.getBoundingClientRect();
    const top = at.above !== undefined ? window.innerHeight - at.above - r.height : at.y ?? 0;
    el.style.left = `${parseFloat(el.style.left) + at.x - r.left}px`;
    el.style.top = `${parseFloat(el.style.top) + top - r.top}px`;
  }, [at]);
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (at) return setAt(null);
    const r = btn.current!.getBoundingClientRect();
    // (under the ?, or over it where there's no room under it: down by a phone's tool bar, say)
    // (kept whole inside whatever would cut it off: a panel's edge, a rounded box in it)
    let lo = 8, hi = window.innerWidth - 12;
    for (let e = btn.current!.parentElement; e; e = e.parentElement) {
      if (getComputedStyle(e).overflowX === "visible") continue;
      const b = e.getBoundingClientRect();
      lo = Math.max(lo, b.left + 4); hi = Math.min(hi, b.right - 4);
    }
    const x = Math.max(lo, Math.min(r.left - 12, hi - 288));
    setAt(r.bottom + 240 > window.innerHeight && r.top > 240 ? { x, above: window.innerHeight - r.top + 6 } : { x, y: Math.min(r.bottom + 6, window.innerHeight - 220) });
  };
  // (its first paragraph: the tip; the rest is in the guide)
  const text = t?.body.split("\n\n")[0] ?? "";
  return (
    <>
      <button ref={btn} type="button" aria-label={`Help: ${label}`} aria-expanded={!!at} data-testid={`help-${topic}`} onClick={open}
        className={`relative w-[18px] h-[18px] touch:w-7 touch:h-7 touch:before:content-[''] touch:before:absolute touch:before:-inset-2 shrink-0 rounded-full inline-flex items-center justify-center text-[11px] font-bold align-middle ${at ? "bg-orange-300 text-zinc-950" : "text-zinc-300 bg-white/[0.09] hover:bg-white/[0.16] hover:text-zinc-50"} ${FOCUS}`}>?</button>
      {at && t && (
        <div ref={tip} role="dialog" aria-label={t.title} data-testid="help-tip" className="fixed z-[60] w-[288px] glass-solid rounded-[16px] shadow-xl shadow-black/40 ring-1 ring-white/10 p-3 text-left normal-case tracking-normal" style={{ left: at.x, top: at.y ?? 0 }}>
          <div className="text-[13px] font-bold text-zinc-50 mb-1">{t.title}</div>
          <p className="text-[12.5px] leading-relaxed text-zinc-300 font-normal">{text}</p>
          <button className="mt-2 text-[12.5px] font-semibold text-orange-300 hover:text-orange-200" onClick={() => { setAt(null); askHelp(topic); }} data-testid="help-tip-more">More in the help guide ›</button>
        </div>
      )}
    </>
  );
}

/** A labelled control. A group, not a <label>: the controls inside carry their own names (a
 * <label> would also name every button in a button group after the whole field). `help`: a
 * guide topic, for a ? beside the label. */
export const Field = ({ label, children, hint, help }: { label: string; children: ReactNode; hint?: string; help?: string }) => (
  <div className="block mb-3" role="group" aria-label={label}>
    <span className="flex items-center gap-1.5 text-xs touch:text-[13px] text-zinc-400 mb-1">{label}{help && <HelpLink topic={help} label={label} />}</span>
    {children}
    {hint && <span className="block text-[11px] text-zinc-500 mt-1">{hint}</span>}
  </div>
);

// (16 px text on touch screens: phones zoom into smaller text fields when they get the focus)
export const inputCls = "w-full bg-white/[0.07] rounded-[10px] px-2.5 py-1.5 text-sm touch:py-2.5 touch:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-400/80";

/** A line (or `area`: a box) of text. `onDone` once the field is left: with the typing done live
 * (no undo step a key), that's where its one undo step goes. `autoSelect`: focused when it
 * shows, its text selected to type over (a label just put down). */
export function TextInput({ value, onChange, placeholder, label, area, onDone, autoSelect, testid }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; area?: boolean; onDone?: () => void; autoSelect?: boolean; testid?: string }) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (autoSelect) { ref.current?.focus(); ref.current?.select(); } }, [autoSelect]);
  return area ? (
    <textarea ref={ref} aria-label={label} data-testid={testid} className={`${inputCls} min-h-[64px] resize-y`} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onDone} />
  ) : (
    <input ref={ref} aria-label={label} data-testid={testid} className={inputCls} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} onBlur={onDone} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/** A drop-down list in the panels' look (16 px text on touch screens, as the text fields). */
export const Select = ({ value, onChange, label, testid, children, className = "" }: { value: string; onChange: (v: string) => void; label: string; testid?: string; children: ReactNode; className?: string }) => (
  <select aria-label={label} data-testid={testid} className={`w-full bg-white/[0.07] rounded-[10px] px-2.5 py-1.5 text-sm touch:py-2.5 touch:text-base text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/80 ${className}`} value={value} onChange={e => onChange(e.target.value)}>
    {children}
  </select>
);

/** Inside a phone's glass menu (mobile/GlassBar): choices as the menu's rows, one under another,
 * the picked one lit, instead of chips or a segmented strip. */
export const MenuRows = createContext(false);
/** One choice as a glass menu's row: its dot or icon, its words, and a line on what it does. */
export const PickRow = ({ on, onClick, color, icon, label, hint, testid }: { on: boolean; onClick: () => void; color?: string; icon?: ReactNode; label: ReactNode; hint?: string; testid?: string }) => (
  <button type="button" role="radio" aria-checked={on} onClick={onClick} data-testid={testid}
    className={`w-full flex items-center gap-3 text-left rounded-[18px] px-3 min-h-[46px] py-2 transition-colors ${FOCUS} ${on ? "bg-orange-300 text-zinc-950" : "text-zinc-100 active:bg-white/[0.1]"}`}>
    {color && <span className="w-3 h-3 rounded-full border border-black/30 ring-1 ring-white/40 shrink-0" style={{ background: color }} />}
    {icon && <span className="shrink-0 flex">{icon}</span>}
    <span className="min-w-0 flex flex-col">
      <span className="text-[15px] font-semibold leading-tight">{label}</span>
      {hint && <span className={`text-[12.5px] leading-snug mt-0.5 ${on ? "text-zinc-800" : "text-zinc-400"}`}>{hint}</span>}
    </span>
  </button>
);

/** A small chip, picked or not (ChipPick's, and the hole chips'): 44 px tall on touch. */
export const chipCls = (on: boolean) => `flex items-center gap-1.5 shrink-0 whitespace-nowrap px-2.5 py-1 touch:py-2 touch:px-3 touch:text-[13px] touch:min-h-[44px] rounded-full text-xs font-semibold transition-colors ${FOCUS} ${on ? "bg-zinc-100 text-zinc-900" : "bg-white/[0.07] text-zinc-300 hover:bg-white/[0.12] hover:text-zinc-50"}`;

/** One of several kinds, as a wrap of small chips (the tool bar's look): a kind of area or line,
 * a tee color, a surface. Each can have a color dot or an icon, and a tooltip. `row`: one row
 * that scrolls sideways (a phone's strip). */
export function ChipPick<T extends string>({ value, options, onChange, label, testid, row = false }: { value: T; options: { value: T; label: string; color?: string; icon?: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; testid?: string; row?: boolean }) {
  const menu = useContext(MenuRows);
  const box = useRef<HTMLDivElement>(null);
  // (a row: the one picked scrolled into view when it shows)
  useEffect(() => { if (row || menu) box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ inline: "center", block: "nearest" }); }, [row, menu]);
  if (menu) return (
    <div ref={box} className="flex flex-col gap-0.5" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(o => <PickRow key={o.value} on={value === o.value} onClick={() => onChange(o.value)} color={o.color} icon={o.icon} label={o.label} hint={o.title} />)}
    </div>
  );
  return (
    <div ref={box} className={row ? "flex gap-1.5 overflow-x-auto touch-pan-x touch-pan-y dg-scroll -mx-1 px-1" : "flex flex-wrap gap-1"} role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} title={o.title} onClick={() => onChange(o.value)} className={chipCls(on)}>
            {/* (a light ring too, so a dark color's dot shows on the dark chip) */}
            {o.color && <span className="w-2.5 h-2.5 rounded-full border border-black/30 ring-1 ring-white/40 shrink-0" style={{ background: o.color }} />}
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A number typed freely (cleared, part-typed): kept as typed while it is in range, kept within
 * range when the field is left or Enter is pressed. `onDone` once it's left (its one undo step,
 * when the typing is live without one). */
export function NumberInput({ value, onChange, min, max, step = 1, label, unit, onDone }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string; unit?: string; onDone?: () => void }) {
  const shown = Number.isFinite(value) ? String(value) : "";
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(shown); }, [shown]);
  const within = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const keep = () => {
    editing.current = false;
    const v = parseFloat(text);
    if (Number.isFinite(v) && within(v) !== value) onChange(within(v));
    setText(Number.isFinite(v) ? String(within(v)) : shown);
    onDone?.();
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        aria-label={label}
        type="number"
        className={inputCls}
        value={text}
        min={min}
        max={max}
        step={step}
        onFocus={() => { editing.current = true; }}
        onChange={e => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          // (live while it's a number in range; the rest when the field is left)
          if (Number.isFinite(v) && v === within(v)) onChange(v);
        }}
        onBlur={keep}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      {unit && <span className="text-xs text-zinc-400">{unit}</span>}
    </div>
  );
}

export const Slider = ({ value, onChange, min, max, step = 1, label, format, onDone }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; format?: (v: number) => string; onDone?: () => void }) => (
  <div className="mb-3">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-200 tabular-nums">{format ? format(value) : value}</span>
    </div>
    <input aria-label={label} type="range" className={`slider w-full touch:h-7 ${FOCUS} rounded`} style={{ ["--fill" as string]: `${((value - min) / Math.max(1e-9, max - min)) * 100}%` }} min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} onPointerUp={onDone} onKeyUp={onDone} onBlur={onDone} />
  </div>
);

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  if (useContext(MenuRows)) return (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label={label}>
      {options.map(o => <PickRow key={String(o.value)} on={value === o.value} onClick={() => onChange(o.value)} label={o.label} hint={o.title} />)}
    </div>
  );
  return (
    <div className="flex flex-wrap gap-0.5 bg-white/[0.07] p-[3px] rounded-[11px]" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 min-w-[2.2rem] px-2 py-1 touch:py-2.5 touch:min-h-[44px] touch:text-[13px] rounded-[8px] text-xs font-semibold transition-colors ${FOCUS} ${value === o.value ? "bg-white/[0.18] text-zinc-50 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.25)]" : "text-zinc-300 hover:text-zinc-50 hover:bg-white/[0.06]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A few choices whose names alone wouldn't say what they do: each with a line that does. */
export function ChoiceList<T extends string>({ value, options, onChange, label, testid }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string; testid?: string }) {
  if (useContext(MenuRows)) return (
    <div className="flex flex-col gap-0.5" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(o => <PickRow key={o.value} on={value === o.value} onClick={() => onChange(o.value)} label={o.label} hint={o.hint} />)}
    </div>
  );
  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} role="radio" aria-checked={on} aria-label={o.label} onClick={() => onChange(o.value)}
            className={`flex items-start gap-2.5 text-left rounded-[12px] px-2.5 py-2 touch:py-3 transition-colors ${FOCUS} ${on ? "bg-white/[0.14] ring-1 ring-white/20" : "hover:bg-white/[0.06]"}`}>
            <span className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${on ? "border-orange-300" : "border-zinc-500"}`}>{on && <span className="w-2 h-2 rounded-full bg-orange-300" />}</span>
            <span className="min-w-0">
              <span className={`block text-[13px] font-semibold ${on ? "text-zinc-50" : "text-zinc-200"}`}>{o.label}</span>
              {o.hint && <span className="block text-[11.5px] leading-snug text-zinc-400">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A switch. Room under it before what comes next (none before another switch, or at the end). */
export const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
  <label className="dg-toggle flex items-start gap-2.5 py-1 touch:py-2.5 mb-2 last:mb-0 [&:has(+.dg-toggle)]:mb-0 cursor-pointer select-none">
    <input type="checkbox" className={`switch mt-0.5 ${FOCUS}`} checked={checked} onChange={e => onChange(e.target.checked)} />
    <span>
      <span className="block text-sm text-zinc-200">{label}</span>
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </span>
  </label>
);

/** Something on its way: a spinner and what it is, shown only once the wait is long enough to
 * notice (a quick load never flashes it). */
export const Loading = ({ label, className = "" }: { label: string; className?: string }) => (
  <div className={`flex items-center justify-center gap-2 text-sm text-zinc-300 animate-[dgfade_0.25s_ease_0.25s_both] ${className}`} role="status" aria-live="polite" aria-busy="true" data-testid="loading">
    <Loader2 size={16} className="animate-spin text-orange-300 shrink-0" />
    <span>{label}</span>
  </div>
);
/** A whole screen waiting (the app opening, a course page). */
export const LoadingScreen = ({ label }: { label: string }) => (
  <div className="min-h-[100dvh] bg-zinc-950 flex items-center justify-center"><Loading label={label} /></div>
);

/** A button. One that starts something taking a while (its onClick returns a promise) shows a
 * spinner and takes no second click until it's done. */
export const Button = ({ children, onClick, tone = "default", disabled, title, testid, full, small }: { children: ReactNode; onClick: () => unknown; tone?: "default" | "primary" | "danger" | "ghost"; disabled?: boolean; title?: string; testid?: string; full?: boolean; small?: boolean }) => {
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const click = () => {
    const r = onClick();
    if (r && typeof (r as Promise<unknown>).finally === "function") {
      setBusy(true);
      void (r as Promise<unknown>).catch(() => {}).finally(() => { if (live.current) setBusy(false); });
    }
  };
  const tones = {
    default: "bg-white/[0.09] hover:bg-white/[0.14] text-zinc-100",
    primary: "bg-orange-500 hover:bg-orange-400 text-zinc-950",
    danger: "bg-white/[0.09] hover:bg-red-500/20 text-red-300",
    ghost: "text-zinc-300 hover:text-zinc-50 hover:bg-white/[0.07]"
  };
  return (
    <button
      onClick={click}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={title}
      data-testid={testid}
      className={`${full ? "w-full" : ""} inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none ${FOCUS} ${small ? "px-2.5 py-1 text-xs touch:py-2.5 touch:min-h-[44px] touch:text-[13px]" : "px-3 py-2 text-sm touch:py-3"} ${tones[tone]}`}
    >
      {busy && <Loader2 size={small ? 12 : 14} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
};

/** A color, picked with the system's color picker. `onDone` once it's closed (its one undo step,
 * when the colors on the way there were live without one). */
// (colour by hue 0..360, saturation and lightness 0..100)
const hexHsl = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, Math.round(l * 100)];
  const sat = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(sat * 100), Math.round(l * 100)];
};
const hslHex = (h: number, sat: number, l: number) => {
  const S = sat / 100, L = l / 100, c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
};
/**
 * A colour: its swatch, and tapped, the app's own picker under it, starting on the colour it is
 * (a phone's own picker opens on its presets instead): hue, saturation and lightness, each a
 * slider painted with the colours it goes through, and the colour's code. Live as it moves;
 * `onDone` when a slider is let go or the picker closes.
 */
export function ColorInput({ value, onChange, label, onDone }: { value: string; onChange: (v: string) => void; label: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [hsl, setHsl] = useState(() => hexHsl(value));
  const [code, setCode] = useState(value);
  const box = useRef<HTMLDivElement>(null);
  // (opened: from the colour it is now)
  useEffect(() => { if (open) { setHsl(hexHsl(value)); setCode(value); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // (open, the thing it colours shows solid on the map, though it's selected: see-through, its
  // colours couldn't be judged)
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
  const set = (next: [number, number, number]) => { setHsl(next); const hex = hslHex(...next); setCode(hex); onChange(hex); };
  const [h, sat, l] = hsl;
  const bars: { name: string; v: number; max: number; bg: string; to: (v: number) => [number, number, number] }[] = [
    { name: "Hue", v: h, max: 359, bg: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(x => hslHex(x % 360, Math.max(30, sat), Math.min(70, Math.max(30, l)))).join(",")})`, to: v => [v, sat, l] },
    { name: "Saturation", v: sat, max: 100, bg: `linear-gradient(to right, ${hslHex(h, 0, l)}, ${hslHex(h, 100, l)})`, to: v => [h, v, l] },
    { name: "Lightness", v: l, max: 100, bg: `linear-gradient(to right, #000, ${hslHex(h, sat, 50)}, #fff)`, to: v => [h, sat, v] }
  ];
  return (
    <div ref={box} className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-300">{label}</span>
        <button type="button" aria-label={label} aria-expanded={open} onClick={() => { if (open) onDone?.(); setOpen(o => !o); }} className={`w-9 h-7 touch:w-11 touch:h-9 rounded-md ring-1 ring-white/25 ${FOCUS}`} style={{ background: value }} data-testid="color-swatch" />
      </div>
      {open && (
        <div className="mt-2 rounded-xl bg-black/25 ring-1 ring-white/10 p-2.5 space-y-2.5" data-testid="color-picker">
          {bars.map(b => (
            <label key={b.name} className="block">
              <span className="flex justify-between text-[11px] text-zinc-400"><span>{b.name}</span><span className="tabular-nums">{b.v}{b.name === "Hue" ? "°" : "%"}</span></span>
              <input type="range" aria-label={`${label}: ${b.name.toLowerCase()}`} min={0} max={b.max} value={b.v} onChange={e => set(b.to(Number(e.target.value)))} onPointerUp={onDone} onKeyUp={onDone}
                className="dg-colorbar w-full h-5 touch:h-7 rounded-full appearance-none cursor-pointer" style={{ background: b.bg }} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">Code
            <input aria-label={`${label}: code`} value={code} maxLength={7} spellCheck={false} onChange={e => { const v = e.target.value.trim(); setCode(v); if (/^#[0-9a-f]{6}$/i.test(v)) { setHsl(hexHsl(v)); onChange(v.toLowerCase()); } }} onBlur={onDone}
              className={`flex-1 min-w-0 rounded-md bg-white/[0.07] px-2 py-1 text-xs text-zinc-100 font-mono ${FOCUS}`} />
          </label>
        </div>
      )}
    </div>
  );
}

/** One number with its name under it (for a row of a few). */
export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="min-w-0">
    <div className="text-sm font-semibold text-zinc-50 tabular-nums leading-tight truncate">{value}</div>
    <div className="text-[11px] text-zinc-500">{label}{sub ? <span> · {sub}</span> : null}</div>
  </div>
);

/** The numbers that matter, in one line: "Par 54 · 5,210 ft · Walking 980 ft". */
export const Facts = ({ items, testid }: { items: [label: string, value: ReactNode][]; testid?: string }) => (
  <dl className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm" data-testid={testid}>
    {items.map(([label, value], i) => (
      <div key={label} className="flex items-baseline gap-1">
        {i > 0 && <span className="text-zinc-600 mr-1">·</span>}
        <dt className="text-zinc-500">{label}</dt>
        <dd className="font-semibold text-zinc-100 tabular-nums">{value}</dd>
      </div>
    ))}
  </dl>
);

/** Tabs over a panel's parts: one row of quiet labels, the open one lit and underlined. */
export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: ReactNode; testid?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex gap-1 shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)]" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} data-testid={t.testid}
          className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${FOCUS} rounded-t-md ${value === t.value ? "border-orange-500 text-zinc-50 font-semibold" : "border-transparent text-zinc-400 hover:text-zinc-100"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
