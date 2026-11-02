// The toolbar over what's picked on a printout's page, right beside it (on a phone, in the tool
// bar's place at the bottom, Done first, its settings in a few tools that open a low sheet): what it is, then
// only the settings it has. Font, size, lettering and panel color, bold, italic and alignment for
// text, its words or link, which holes it's on, how solid it is, how far it's turned, its place
// among what was added, then Reset, Duplicate and Hide or Delete. The same for the course map, tee
// signs, hole pages and the scorecard.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Blend, Bold, BringToFront, Check, Copy, EyeOff, Flag, Italic, Link2, Minus, MoreHorizontal, Palette, Pencil, Plus, RotateCcw, Scaling, SendToBack, Trash2, Type, Undo2 } from "lucide-react";
import { fontsIn } from "../lib/fontLoad";
import { useCourse } from "../state/course";
import { api, SERVER } from "../auth/api";
import { useServerCourse } from "../auth/courses";
import { ColorSwatches } from "./ColorSwatches";
import { FontPicker } from "./FontPicker";
import { HolePicker } from "./PrintPanel";
import { SHEET, SheetFold, tileCls, useUnfold } from "./mobile/SheetFold";
import { duplicatePicked, moreOf, orderOf, patchPicked, pickedOf, removePicked, reorderPicked, resetPicked, takeOpening, type TargetKey } from "./printouts";

const commit = () => useCourse.getState().commit();

/** How the picked piece is drawn on the page right now (the editor reads it off the page): its
 * lettering's color and weight, its panel's color, and whether it has lettering or a panel at all. */
export type Drawn = { color?: string; fill?: string; bold?: boolean; text: boolean; panel: boolean };

/** A color's button: the lettering's (an A over its color) or the panel's (a square of it). */
function Swatch({ value, label, icon, on, onClick }: { value: string; label: string; icon: "letters" | "panel"; on: boolean; onClick: () => void }) {
  return (
    <button className={`relative h-8 w-8 touch:h-11 touch:w-11 shrink-0 flex items-center justify-center rounded-full hover:bg-white/[0.12] ${on ? "bg-white/[0.18]" : ""}`} title={label} aria-label={label} aria-expanded={on} onClick={onClick} data-testid={icon === "letters" ? "piece-color" : "piece-fill"}>
      {icon === "letters"
        ? <span className="flex flex-col items-center leading-none"><span className="text-[14px] font-bold text-zinc-50">A</span><span className="mt-0.5 h-[4px] w-4 rounded-full ring-1 ring-white/30" style={{ background: value }} /></span>
        : <span className="h-4 w-4 rounded-[5px] ring-1 ring-white/40" style={{ background: value }} />}
    </button>
  );
}

/** A phone's Size: the piece's size from small to big, shown on the page as the slider moves and
 * kept when it's let go (one undo step). */
function SizeSlider({ pt, scale, onGrow, onGrowLive }: { pt?: number; scale?: number; onGrow: (f: number) => void; onGrowLive?: (f: number | null) => void }) {
  const now = pt ?? (scale ?? 1) * 100;
  const [min, max] = pt !== undefined ? [4, Math.max(120, Math.ceil(now * 2))] : [20, Math.max(400, Math.ceil(now * 2))];
  const [held, setHeld] = useState<number | null>(null);
  const v = held ?? now;
  const done = () => {
    if (held === null) return;
    onGrowLive?.(null);
    setHeld(null);
    if (Math.abs(held / now - 1) > 0.005) onGrow(held / now);
  };
  return (
    <div className="mt-3" data-testid="piece-size">
      <div className="flex justify-between text-[13px] text-zinc-300 mb-1"><span>{pt !== undefined ? "Size of the words" : "Size"}</span><span className="tabular-nums font-semibold text-zinc-50">{pt !== undefined ? `${Math.round(v)} pt` : `${Math.round(v)}%`}</span></div>
      <div className="flex items-center gap-2">
        <button className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full bg-white/[0.08] active:bg-white/[0.16] text-zinc-100" aria-label="Smaller" onClick={() => onGrow(1 / 1.12)}><Minus size={17} /></button>
        <input type="range" min={min} max={max} step={pt !== undefined ? 0.5 : 1} value={Math.max(min, Math.min(max, v))} aria-label="Size" className="slider flex-1 touch:h-7"
          onChange={e => { const x = Number(e.target.value); setHeld(x); onGrowLive?.(x / now); }} onPointerUp={done} onKeyUp={done} onBlur={done} />
        <button className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full bg-white/[0.08] active:bg-white/[0.16] text-zinc-100" aria-label="Bigger" onClick={() => onGrow(1.12)}><Plus size={17} /></button>
      </div>
    </div>
  );
}

export function PieceToolbar({ t, id, onGrow, onGrowLive, onPreviewFont, onEditText, onDone, onPanel, docked = false, drawn }: {
  t: TargetKey;
  id: string;
  /** Bigger or smaller by `f` (about its middle). */
  onGrow: (f: number) => void;
  /** Shown `f` times its size on the page while a slider moves (null: as it was). */
  onGrowLive?: (f: number | null) => void;
  onPreviewFont: (font: string | null) => void;
  onEditText: () => void;
  onDone: () => void;
  /** Docked: whether one of its settings is open in the short panel over it. */
  onPanel?: (open: boolean) => void;
  docked?: boolean;
  drawn?: Drawn;
}) {
  const doc = useCourse(c => c.doc);
  const p = pickedOf(doc, t, id);
  const [pop, setPop] = useState<"link" | "opacity" | "more" | "order" | "holes" | "color" | "fill" | "font" | "size" | "arrange" | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => { onPanel?.(docked && !!pop); }, [docked, pop, onPanel]);
  // (a phone: what's unfolded under its tools, kept while it folds away)
  const [shownKey, unfolded] = useUnfold(docked ? pop : null);
  // (another piece picked: nothing of the last one's left open, but what a new one asks for: a
  // new QR code's link, to type straight away)
  useEffect(() => {
    const o = takeOpening(id);
    setPop(o);
    if (o === "link") setTimeout(() => linkRef.current?.focus(), 0);
  }, [id]);
  if (!p) return null;
  // (a piece of a look offers only what it draws: a font and lettering color where it has
  // lettering, a panel color where it has a panel)
  const has = p.kind === "piece" && t !== "map" && drawn ? { ...p.has, font: p.has.font && drawn.text, color: p.has.color && drawn.text, bold: p.has.bold && drawn.text, italic: p.has.italic && drawn.text, fill: p.has.fill && drawn.panel } : p.has;
  const bold = p.bold ?? (p.kind === "piece" ? drawn?.bold : undefined) ?? false;
  // (a pop-up: under its button; docked, in the short panel over the toolbar instead, see below)
  const float = (el: ReactNode) => (docked ? null : el);
  const popAt = (w: string) => `absolute left-0 top-full mt-2 ${w} z-[80] glass ring-1 ring-white/15 rounded-[14px]`;
  const linkInput = <input ref={linkRef} aria-label="Link" placeholder="https://" className="w-full rounded-[10px] bg-white/[0.1] px-2.5 py-2 text-sm touch:text-base text-zinc-50 placeholder:text-zinc-500 focus:outline-none" value={p.url ?? ""} onChange={e => patchPicked(t, id, { url: e.target.value }, false)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { commit(); setPop(null); } }} />;
  const linkBody = <>{linkInput}<PublicLinks onPick={url => { patchPicked(t, id, { url }); setPop(null); }} /></>;
  const opacityBody = (
    <>
      <div className="flex justify-between text-[12px] text-zinc-300 mb-1"><span>{docked ? "" : "How solid it is"}</span><span className="tabular-nums">{Math.round((p.opacity ?? 1) * 100)}%</span></div>
      <input type="range" min={0.05} max={1} step={0.05} aria-label="How solid it is" className="slider w-full touch:h-7" value={p.opacity ?? 1} onChange={e => patchPicked(t, id, { opacity: Number(e.target.value) }, false)} onPointerUp={commit} />
    </>
  );
  const holesBody = (
    <div data-testid="piece-holes-menu">
      <HolePicker holes={p.holes} onChange={v => patchPicked(t, id, { holes: v })} />
    </div>
  );
  const b = "h-8 min-w-8 touch:h-11 touch:min-w-11 shrink-0 flex items-center justify-center gap-1 rounded-full px-1.5 text-zinc-100 hover:bg-white/[0.12] disabled:opacity-40";
  const sep = <span className="w-px h-5 bg-white/15 shrink-0 mx-0.5" />;
  const size = p.pt !== undefined ? `${Math.round(p.pt)}` : p.scale !== undefined ? `${Math.round(p.scale * 100)}%` : null;
  const align = p.align ?? "start";
  const nextAlign = align === "start" ? "middle" : align === "middle" ? "end" : "start";
  const AlignIcon = align === "middle" ? AlignCenter : align === "end" ? AlignRight : AlignLeft;
  const order = orderOf(doc, t, id);
  const rot = Math.round(p.rot ?? 0);
  const more = moreOf(doc, t, id);
  const orderBody = (o: [number, number]) => (
    <div className="flex flex-col" data-testid="piece-order-menu">
      {([[2, "To the front", BringToFront], [1, "Forward", BringToFront], [-1, "Backward", SendToBack], [-2, "To the back", SendToBack]] as const).map(([d, label, Icon]) => (
        <button key={label} className="flex items-center gap-2.5 px-2.5 py-2 touch:py-3 rounded-[10px] hover:bg-white/[0.08] text-[13px] text-zinc-100 text-left disabled:opacity-40" disabled={d > 0 ? o[0] === o[1] - 1 : o[0] === 0} onClick={() => reorderPicked(t, id, d)}><Icon size={15} />{label}</button>
      ))}
    </div>
  );
  const moreBody = (
    <div data-testid="piece-more-menu">
      {more.map(m => m.kind === "switch" ? (
        <label key={m.label} className="flex items-center justify-between gap-3 px-2 py-1.5 touch:py-3 rounded-[10px] hover:bg-white/[0.08] text-[13px] text-zinc-100 cursor-pointer">
          {m.label}<input type="checkbox" checked={m.on} onChange={e => m.set(e.target.checked)} className="accent-orange-400 w-4 h-4" />
        </label>
      ) : (
        <label key={m.label} className="block px-1 py-1">
          <span className="block text-[12px] text-zinc-300 mb-1">{m.label}</span>
          <input aria-label={m.label} className="w-full rounded-[10px] bg-white/[0.1] px-2.5 py-2 text-sm touch:text-base text-zinc-50 placeholder:text-zinc-500 focus:outline-none" value={m.value} placeholder={m.placeholder} onChange={e => m.set(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { commit(); setPop(null); } }} data-testid="piece-heading" />
        </label>
      ))}
    </div>
  );
  // (the colors: the course's own and Custom, the panel's with a way to have none)
  const noPanel = p.kind === "text" && t === "map" ? "No panel" : "As the look has it";
  const colorBody = <ColorSwatches value={p.color ?? drawn?.color} onPick={(c, live) => patchPicked(t, id, { color: c }, !live)} onDone={commit} />;
  const fillBody = <ColorSwatches value={p.fill ?? drawn?.fill} onPick={(c, live) => patchPicked(t, id, { fill: c }, !live)} onDone={commit} none={p.fill ? { label: noPanel, on: () => { patchPicked(t, id, { fill: undefined }); setPop(null); } } : undefined} />;
  const hideable = p.removable || p.hideable !== false;
  const tools = (
    <>
      <span className="text-[12px] touch:text-[13px] font-semibold text-zinc-300 pl-1.5 pr-1 max-w-[130px] truncate shrink-0" data-testid="piece-name">{p.label}</span>
      {has.font && <div className="shrink-0"><FontPicker compact label="Font" value={p.font} inherit={p.inherit} onPick={f => patchPicked(t, id, { font: f })} onPreview={onPreviewFont} used={fontsIn(doc)} testid="piece-font" /></div>}
      {has.size && size !== null && (
        <span className="flex items-center shrink-0" data-testid="piece-size">
          <button className={b} aria-label="Smaller" title="Smaller" onClick={() => onGrow(1 / 1.12)}><Minus size={15} /></button>
          <span className="text-[12.5px] tabular-nums text-zinc-100 min-w-[38px] text-center">{size}</span>
          <button className={b} aria-label="Bigger" title="Bigger" onClick={() => onGrow(1.12)}><Plus size={15} /></button>
        </span>
      )}
      {(has.color || has.fill) && sep}
      {has.color && (
        <span className="relative shrink-0">
          <Swatch icon="letters" label="Lettering color" value={p.color ?? drawn?.color ?? "#ffffff"} on={pop === "color"} onClick={() => setPop(pop === "color" ? null : "color")} />
          {pop === "color" && float(<div className={`${popAt("w-64")} p-2.5`}>{colorBody}</div>)}
        </span>
      )}
      {has.fill && (
        <span className="relative shrink-0">
          <Swatch icon="panel" label="Panel color" value={p.fill ?? drawn?.fill ?? "#1b4332"} on={pop === "fill"} onClick={() => setPop(pop === "fill" ? null : "fill")} />
          {pop === "fill" && float(<div className={`${popAt("w-64")} p-2.5`}>{fillBody}</div>)}
        </span>
      )}
      {has.bold && <button className={`${b} ${bold ? "bg-white/[0.18]" : ""}`} aria-pressed={bold} aria-label="Bold" title="Bold" onClick={() => patchPicked(t, id, { bold: !bold })}><Bold size={15} /></button>}
      {has.italic && <button className={`${b} ${p.italic ? "bg-white/[0.18]" : ""}`} aria-pressed={!!p.italic} aria-label="Italic" title="Italic" onClick={() => patchPicked(t, id, { italic: !p.italic })} data-testid="piece-italic"><Italic size={15} /></button>}
      {has.align && <button className={b} aria-label={`Lines: ${align === "start" ? "left" : align === "middle" ? "centered" : "right"}`} title="Left, centered or right" onClick={() => patchPicked(t, id, { align: nextAlign })}><AlignIcon size={15} /></button>}
      {has.text && <button className={b} aria-label="Edit the words" title={docked ? "Edit the words (or tap it again)" : "Edit the words (or double-click it)"} onClick={onEditText} data-testid="piece-edit-text"><Pencil size={14} /></button>}
      {has.url && (
        <span className="relative shrink-0">
          <button className={`${b} ${pop === "link" ? "bg-white/[0.18]" : ""}`} aria-label="Where it takes you" title="Where it takes you" onClick={() => { setPop(pop === "link" ? null : "link"); setTimeout(() => linkRef.current?.focus(), 0); }}><Link2 size={15} /></button>
          {pop === "link" && float(<div className={`${popAt("w-72")} p-2`}>{linkBody}</div>)}
        </span>
      )}
      {has.holes && (
        <span className="relative shrink-0">
          <button className={`${b} px-2 text-[12px] font-semibold ${pop === "holes" ? "bg-white/[0.18]" : ""}`} aria-label="Holes it's on" title="Which holes it's on" onClick={() => setPop(pop === "holes" ? null : "holes")} data-testid="piece-holes"><Flag size={14} />{p.holes?.length ? p.holes.length : "All"}</button>
          {pop === "holes" && float(<div className={`${popAt("w-72")} p-2.5`}>{holesBody}</div>)}
        </span>
      )}
      {has.opacity && (
        <span className="relative shrink-0">
          <button className={`${b} ${pop === "opacity" ? "bg-white/[0.18]" : ""}`} aria-label="How solid it is" title="How solid it is" onClick={() => setPop(pop === "opacity" ? null : "opacity")} data-testid="piece-opacity"><Blend size={15} /></button>
          {pop === "opacity" && float(<div className={`${popAt("w-56")} px-3 py-2.5`}>{opacityBody}</div>)}
        </span>
      )}
      {has.turn && rot !== 0 && <button className={`${b} px-2 text-[12px] tabular-nums`} aria-label={`Turned ${rot}°: straighten it`} title="Straighten it" onClick={() => patchPicked(t, id, { rot: 0 })} data-testid="piece-straighten">{rot}°</button>}
      {order && order[1] > 1 && (
        <span className="relative shrink-0">
          <button className={`${b} ${pop === "order" ? "bg-white/[0.18]" : ""}`} aria-label="In front or behind" title="In front of or behind the other things you added" onClick={() => setPop(pop === "order" ? null : "order")} data-testid="piece-order"><BringToFront size={15} /></button>
          {pop === "order" && float(<div className={`${popAt("w-56")} p-1.5`}>{orderBody(order)}</div>)}
        </span>
      )}
      {more.length > 0 && (
        <span className="relative shrink-0">
          <button className={`${b} ${pop === "more" ? "bg-white/[0.18]" : ""}`} aria-label="More settings" title="More" onClick={() => setPop(pop === "more" ? null : "more")} data-testid="piece-more"><MoreHorizontal size={15} /></button>
          {pop === "more" && float(<div className={`${popAt(more.some(m => m.kind === "text") ? "w-72" : "w-56")} p-2`}>{moreBody}</div>)}
        </span>
      )}
      {sep}
      {p.changed && <button className={b} aria-label="Reset" title="Reset" onClick={() => resetPicked(t, id)} data-testid="piece-reset"><Undo2 size={14} /></button>}
      {p.duplicable && <button className={b} aria-label="Duplicate" title="Duplicate (Ctrl+D)" onClick={() => duplicatePicked(t, id)} data-testid="piece-duplicate"><Copy size={14} /></button>}
      {hideable && <button className={b} aria-label={p.removable ? "Delete" : "Hide"} title={p.removable ? "Delete" : "Hide"} onClick={() => removePicked(t, id)} data-testid="piece-remove">{p.removable ? <Trash2 size={14} /> : <EyeOff size={14} />}</button>}
    </>
  );
  if (docked) {
    // A phone, as its Map step's tools are: Done first, then a few tools, each opening its
    // settings in a low sheet over the bar (an X closes it), the page whole above it
    const fontish = has.font || has.bold || has.italic || has.align;
    const arrange = (order && order[1] > 1) || has.holes || has.opacity || (has.turn && rot !== 0);
    const extras = more.length > 0 || p.changed || p.duplicable || hideable;
    const row = "w-full flex items-center gap-3 px-3 min-h-11 rounded-[12px] hover:bg-white/[0.08] active:bg-white/[0.12] text-[14px] text-zinc-100 text-left";
    const styleRow = (has.bold || has.italic || has.align) && (
      <div className="flex gap-1.5 mt-2">
        {has.bold && <button className={`${b} flex-1 rounded-[12px] bg-white/[0.07] ${bold ? "!bg-white/[0.2]" : ""}`} aria-pressed={bold} aria-label="Bold" onClick={() => patchPicked(t, id, { bold: !bold })}><Bold size={17} /></button>}
        {has.italic && <button className={`${b} flex-1 rounded-[12px] bg-white/[0.07] ${p.italic ? "!bg-white/[0.2]" : ""}`} aria-pressed={!!p.italic} aria-label="Italic" onClick={() => patchPicked(t, id, { italic: !p.italic })} data-testid="piece-italic"><Italic size={17} /></button>}
        {has.align && <button className={`${b} flex-1 rounded-[12px] bg-white/[0.07]`} aria-label={`Lines: ${align === "start" ? "left" : align === "middle" ? "centered" : "right"}`} onClick={() => patchPicked(t, id, { align: nextAlign })}><AlignIcon size={17} /></button>}
      </div>
    );
    const sizeBody = has.size && size !== null && <SizeSlider pt={p.pt} scale={p.scale} onGrow={onGrow} onGrowLive={has.url ? undefined : onGrowLive} />;
    const panels: Record<string, [string, ReactNode]> = {
      link: ["Where it takes you", linkBody],
      font: [has.font ? "Font" : "Lettering", <>
        {has.font && <FontPicker label="Font" value={p.font} inherit={p.inherit} onPick={f => patchPicked(t, id, { font: f })} onPreview={onPreviewFont} used={fontsIn(doc)} testid="piece-font" />}
        {styleRow}
        {sizeBody}
      </>],
      size: ["Size", sizeBody],
      color: [has.color && has.fill ? "Colors" : has.color ? "Lettering color" : "Panel color", <>
        {has.color && <>{has.fill && <div className="text-[12px] text-zinc-400 mb-1.5">Lettering</div>}{colorBody}</>}
        {has.fill && <>{has.color && <div className="text-[12px] text-zinc-400 mt-3 mb-1.5">Panel</div>}{fillBody}</>}
      </>],
      arrange: ["Arrange", <>
        {order && order[1] > 1 && orderBody(order)}
        {has.holes && <div className={order && order[1] > 1 ? "mt-3" : ""}><div className="text-[12px] text-zinc-400 mb-1.5">Holes it's on</div>{holesBody}</div>}
        {has.opacity && <div className="mt-3">{opacityBody}</div>}
        {has.turn && rot !== 0 && <button className={`${row} mt-2`} onClick={() => patchPicked(t, id, { rot: 0 })} data-testid="piece-straighten"><RotateCcw size={17} />Straighten it ({rot}°)</button>}
      </>],
      more: ["More", <>
        {more.length > 0 && moreBody}
        <div className={more.length ? "mt-2 pt-2 border-t border-white/10" : ""}>
          {p.changed && <button className={row} onClick={() => resetPicked(t, id)} data-testid="piece-reset"><Undo2 size={17} />Reset</button>}
          {p.duplicable && <button className={row} onClick={() => duplicatePicked(t, id)} data-testid="piece-duplicate"><Copy size={17} />Duplicate</button>}
          {hideable && <button className={`${row} ${p.removable ? "text-red-300" : ""}`} onClick={() => removePicked(t, id)} data-testid="piece-remove">{p.removable ? <Trash2 size={17} /> : <EyeOff size={17} />}{p.removable ? "Delete" : "Hide"}</button>}
        </div>
      </>]
    };
    const shownPanel = shownKey ? panels[shownKey] ?? null : null;
    const tool = (key: string, label: string, icon: ReactNode, onClick?: () => void) => (
      <button key={key} onClick={onClick ?? (() => { setPop(pop === key ? null : (key as typeof pop)); if (key === "link") setTimeout(() => linkRef.current?.focus(), 0); })} aria-pressed={onClick ? undefined : pop === key} data-testid={`piece-tool-${key}`}
        className={tileCls(pop === key).replace("min-w-[58px]", "min-w-[46px]")}>
        {icon}<span className="text-[11px] leading-none font-semibold whitespace-nowrap">{label}</span>
      </button>
    );
    return (
      <div className={SHEET} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} data-testid="piece-sheet">
        <div className="flex items-center gap-1 px-2 pt-2.5 pb-2" data-page-bar data-testid="piece-toolbar" role="toolbar" aria-label={`${p.label} settings`}>
          <button className="shrink-0 min-w-[56px] h-[54px] px-1.5 rounded-xl flex flex-col items-center justify-center gap-1 bg-orange-500 text-zinc-950 shadow-lg shadow-orange-900/40 active:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={onDone} aria-label="Done" data-testid="piece-done"><Check size={20} strokeWidth={2.6} /><span className="text-[11px] leading-none font-bold">Done</span></button>
          {has.text && tool("words", "Words", <Pencil size={19} />, onEditText)}
          {has.url && tool("link", "Link", <Link2 size={19} />)}
          {fontish && tool("font", has.font ? "Font" : "Lettering", <Type size={19} />)}
          {has.size && !fontish && size !== null && tool("size", "Size", <Scaling size={19} />)}
          {(has.color || has.fill) && tool("color", "Color", <Palette size={19} />)}
          {arrange && tool("arrange", "Arrange", <BringToFront size={19} />)}
          {extras && tool("more", "More", <MoreHorizontal size={19} />)}
        </div>
        {/* (unfolding under its tools, as the page's tools do) */}
        {shownPanel && <SheetFold unfolded={unfolded && pop === shownKey} title={shownPanel[0]} onClose={() => setPop(null)} testid="piece-panel" closeTestid="piece-panel-done"><div className="px-3 pt-1">{shownPanel[1]}</div></SheetFold>}
      </div>
    );
  }
  return (
    <div className="glass ring-1 ring-white/15 shadow-xl flex items-center gap-0.5 rounded-full px-1.5 py-1" data-page-bar data-testid="piece-toolbar" role="toolbar" aria-label={`${p.label} settings`} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      {tools}
    </div>
  );
}

/** The course's public page links, to put in a QR code at a tap (on a hole's sign it then says
 * which sign was scanned, for the course's visitor stats). */
function PublicLinks({ onPick }: { onPick: (url: string) => void }) {
  const id = useServerCourse(s => s.id);
  const [links, setLinks] = useState<{ token: string; slug?: string | null; label: string; revoked: boolean }[]>([]);
  useEffect(() => {
    if (!SERVER || !id) return;
    void api<typeof links>("GET", `courses/${id}/links`).then(l => setLinks(l.filter(x => !x.revoked))).catch(() => {});
  }, [id]);
  if (!links.length) return null;
  return (
    <div className="mt-2" data-testid="qr-public-links">
      <div className="text-[11px] text-zinc-400 mb-1">This course's public page</div>
      <div className="flex flex-wrap gap-1.5">
        {links.map(l => (
          <button key={l.token} className="rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-2.5 py-1 touch:py-2 text-[12px] touch:text-[13px] font-semibold text-zinc-100" onClick={() => onPick(`${location.origin}/${l.slug || l.token}`)}>
            {l.label || l.slug || "Public link"}
          </button>
        ))}
      </div>
    </div>
  );
}
