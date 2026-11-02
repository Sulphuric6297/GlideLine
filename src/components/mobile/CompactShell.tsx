// The app on a phone (and a phone turned on its side). The map is the screen; everything else
// is within reach of a thumb:
// - upright: a floating top bar (name, 2D/3D, menu), map controls on the right, a bottom
//   sheet with the step's panel, the selection or the active tool, and the four steps along the
//   bottom;
// - on its side: the steps in a rail on the left, the panel beside it, the map on the right.
// Tools are a row of labelled buttons at the top of the panel; drawing gets Undo, Cancel and Done
// buttons over the map (there is no Enter, Backspace or Esc on a phone), and holding a finger on
// a thing opens its menu (the right-click), or on open ground what can start there.
import { Woods } from "../Woods";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type UIEvent } from "react";
import { Axe, Circle, Compass, Flag, Gauge, LayoutGrid, Menu, ChevronDown, ListChecks, ChevronLeft, Copy, Ellipsis, Eye, FilePlus, FolderOpen, HelpCircle, LocateFixed, PanelLeftClose, PanelLeftOpen, Redo2, Save, Search, Trash2, TreeDeciduous, Undo2, X } from "lucide-react";
import { holeLabel } from "../../lib/course";
import { AREA_KINDS } from "../../constants";
import { EXAMPLE_ID } from "../../lib/example";
import { courseIssues, courseStats, courseTotals, holeStats, openIssues, playsOf } from "../../lib/holeStats";
import { fmtArea, fmtDist, fmtElev } from "../../lib/units";
import { deleteSelection, duplicateSelection, select } from "../../state/actions";
import { getDoc, useCourse, useEditor, type Step } from "../../state/course";
import { deleteRecent, newCourse, openCourseFile, openRecent, recentCourses, saveCourseFile } from "../../state/files";
import type { PlanMeta } from "../../lib/storage";
import type { CourseItem, Hole, P } from "../../types";
import { HoleSteps, stepHole } from "../HoleSteps";
import { InspectorBody, groupSummary, itemTitle, useSelection } from "../Inspector";
import { MapViewport } from "../MapViewport";
import { getView } from "../../state/view";
import { MapDesigner, PageChips } from "../MapDesigner";
import { ProblemsCount, ReviewStep, STEPS, STEP_ICONS, StepContent, touchWords } from "../SidePanel";
import { SHOW_EVENT } from "../showSetting";
import { TeeViewHud } from "../TeeViewHud";
import { OnSite } from "../OnSite";
import { useOnSite } from "../../state/onSite";
import { CameraHud } from "../CameraHud";
import { STEP_TOOLS, TOOLS, phoneToolSettings, pickTool, toolHelp, toolHint, toolOf, toolOptions, toolShapes } from "../Toolbar";
import { ExportProgressPill } from "../ExportProgress";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { BottomSheet, type Detent } from "./BottomSheet";
import { PageTools } from "./PageTools";
import { useHoleSettings, useItemSettings } from "./HoleStrip";
import { ActRow, EdgeSlider, GlassBar, useBarNav, type BarSetting } from "./GlassBar";
import { MoveCornerHere } from "../PlaceByGps";
import { GettingStarted, openGettingStarted } from "../GettingStarted";
import { accountActions, CourseChip, SaveAlert } from "../../auth/AccountMenu";
import { LOCKED, LockBadge, showLocked, type LockedId } from "../DemoNote";
import { DrawBar, useDrawBarShown } from "../DrawBar";
import { useExportJob } from "../../state/exportJob";
import { ViewToggle } from "../ViewToggle";
import { groupActions, groundActions, itemActions, type ItemAction } from "../itemActions";
import { treeActions, treesAt, treeTitle, underAction } from "../treeActions";
import { HelpLink, askHelp } from "../ui";
import { ago } from "../../auth/Home";
import { goDemoHome } from "../DemoHome";
import { startTour } from "../Tour";

import { ViewerPanelBody } from "../../auth/ViewerPanel";
import { SERVER } from "../../auth/api";
import { useAllowed } from "../../auth/perms";
import { CoursePageButton, SITE_TOKEN } from "../../auth/PublicSite";

/** The phone menu's first rows in the demo: its own Courses page, the walk around its example, and
 * what the demo is. */
const demoFirst = () => {
  const Icon = LOCKED.demo.icon;
  return [
    { label: "Courses", icon: <LayoutGrid size={19} />, run: goDemoHome, testid: "menu-courses" },
    { label: "A walk around the example", icon: <Compass size={19} />, run: () => void startTour(), testid: "menu-tour" },
    { label: "About the demo", icon: <Icon size={19} />, run: () => showLocked("demo"), testid: "menu-locked-demo" }
  ];
};
/** Its last rows: what a server adds, there with a lock, as on a computer. */
const demoLocked = () =>
  (["comments", "history", "share", "account"] as LockedId[]).map(id => {
    const Icon = LOCKED[id].icon;
    return { label: LOCKED[id].title, icon: <span className="relative flex"><Icon size={19} /><LockBadge /></span>, run: () => showLocked(id), testid: `menu-locked-${id}` };
  });

export type MenuInfo = { clientX: number; clientY: number; itemId: string | null; ground: P | null; under?: string | null };

type ShellProps = {
  layout: "phone" | "rail";
  onFindSite: () => void;
  onHelp: () => void;
  /** Search: holes, tools, settings and help. */
  onGoTo: () => void;
  onContextMenu: (info: MenuInfo) => void;
  /** The welcome card for an empty course, when it shows. */
  welcome: ReactNode;
  /** The toasts, kept clear of the panel by `bottom` pixels. */
  toasts: (bottom: number) => ReactNode;
};

/** What the panel calls the tool in use, by the tool's id (its button's name otherwise). */
const TOOL_TITLES: Record<string, string> = {
  hole: "New hole", tee: "Another tee", pin: "Another pin", label: "Text label", ground: "Shape the ground",
  // (the tools named for what they put down)
  rules: "OB and rules", paths: "Paths and roads", water: "Water", trees: "Trees and woods", grass: "Grass and ground", build: "Build",
  park: "Park"
};
const toolTitle = (t: (typeof TOOLS)[number] | undefined) => (t ? TOOL_TITLES[t.id] ?? t.short : "");

/** The shell never scrolls (it can't with `overflow: clip`; older Safari only has `hidden`, which
 * the browser can still scroll to bring something into view): put it back. */
const keepPut = (e: UIEvent<HTMLElement>) => {
  const el = e.currentTarget;
  if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
};

/** How tall the sheet is when a step opens (the map first where the step is about the map). */
const STEP_DETENT: Record<Step, Detent> = { site: "half", design: "peek", map: "peek", export: "half" };

const Logo = ({ size = 30 }: { size?: number }) => (
  // (the badge: a fairway through the woods at sunrise)
  <img src={`${import.meta.env.BASE_URL}logo-128.png`} width={size} height={size} alt="" aria-hidden className="block rounded-full shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]" draggable={false} />
);

const iconBtn = "w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-zinc-300 active:bg-white/[0.13] hover:bg-white/[0.09] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-30";

/** What the panel shows: the active tool, the selection (on the steps with the map), or the step. */
function useMode() {
  const tool = useEditor(e => e.tool);
  const onMap = useEditor(e => e.step === "site" || e.step === "design");
  const { open } = useSelection();
  return tool !== "select" ? "tool" : open && onMap ? "selection" : "step";
}

/** The course's one-line summary: holes and par. */
function useSummary() {
  const doc = useCourse(s => s.doc);
  return useMemo(() => {
    const stats = courseStats(doc);
    const t = courseTotals(doc, stats);
    // (a hole with two numbers counts twice, as on the scorecard)
    return { holes: doc.holes.reduce((n, h) => n + playsOf(doc, h.id), 0), par: t.par, complete: t.complete, length: t.length, issues: openIssues(doc, courseIssues(doc)).open.length, units: doc.units };
  }, [doc]);
}

// ---------------------------------------------------------------------------------- steps

/** Drops a drawing under way (only then: clearing redraws the map, a frame a slow phone pays for). */
const stopDrawing = () => {
  if (useEditor.getState().drawPoints > 0) getView()?.cancelDrawing();
};

function goStep(id: Step, setDetent: (d: Detent) => void, toggle: () => void) {
  const ed = useEditor.getState();
  if (ed.step === id && ed.tool === "select" && !ed.selectedId && !ed.problemsOpen) { toggle(); return; }
  stopDrawing();
  select(null);
  ed.set({ step: id, tool: "select", problemsOpen: false });
  setDetent(STEP_DETENT[id]);
}

/** Whether each step's own panel is out when the step opens: Site's and Export's are what those
 * steps are for; Design and Map are about the map and the page, their tools in the row. */
const STEP_OPEN: Record<Step, boolean> = { site: true, design: false, map: false, export: true };

function BottomNav({ onStep, motion = null }: { onStep: (s: Step) => void; motion?: "out" | "in" | null }) {
  const step = useEditor(e => e.step);
  // (the checks on Design's tab, as a count: its panel has the list)
  const issues = useSummary().issues;
  return (
    <nav aria-label="Steps" className={`glass shrink-0 relative z-40 mx-2 mt-1.5 mb-[max(8px,env(safe-area-inset-bottom))] rounded-[30px] ${motion === "out" ? "!absolute inset-x-0 bottom-0 !z-20 dg-tuck pointer-events-none" : motion === "in" ? "dg-untuck" : ""}`} data-testid={motion === "out" ? "bottom-nav-leaving" : "bottom-nav"}>
      <ol className="flex px-1">
        {STEPS.map((s, i) => {
          const Icon = STEP_ICONS[s.id];
          const on = step === s.id;
          return (
            <li key={s.id} className="flex-1 min-w-0">
              <button
                onClick={() => onStep(s.id)}
                aria-current={on ? "step" : undefined}
                className="w-full h-[60px] flex flex-col items-center justify-center gap-1 focus:outline-none focus-visible:bg-white/[0.08] rounded-[26px]"
              >
                <span className={`relative flex items-center justify-center w-[52px] h-[30px] rounded-full transition-colors ${on ? "bg-white/[0.12] text-orange-300" : "text-zinc-400"}`}><Icon size={21} strokeWidth={on ? 2.4 : 2} />
                  {s.id === "design" && issues > 0 && <span className="absolute -top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-[18px] text-center tabular-nums" aria-label={`${issues} checks`} data-testid="design-checks-badge">{issues}</span>}
                </span>
                <span className={`text-[12px] leading-none font-semibold tracking-tight ${on ? "text-zinc-50" : "text-zinc-400"}`}><span className="sr-only">Step {i + 1}: </span>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NavRail({ onStep, onMenu, panelOpen, onPanel }: { onStep: (s: Step) => void; onMenu: () => void; panelOpen: boolean; onPanel: () => void }) {
  const step = useEditor(e => e.step);
  return (
    <nav aria-label="Steps" className="glass w-[72px] shrink-0 relative z-40 flex flex-col items-center my-2 ml-[max(8px,env(safe-area-inset-left))] rounded-[26px] py-1" data-testid="nav-rail">
      <button className={`${iconBtn} [@media(max-height:400px)]:h-10`} aria-label="Menu: files, help" onClick={onMenu} data-testid="app-menu-button"><Logo size={28} /></button>
      <ol className="flex-1 min-h-0 flex flex-col justify-center w-full">
        {STEPS.map((s, i) => {
          const Icon = STEP_ICONS[s.id];
          const on = step === s.id;
          return (
            <li key={s.id} className="flex-1 min-h-0 max-h-[52px]">
              <button onClick={() => onStep(s.id)} aria-current={on ? "step" : undefined} className="w-full h-full flex flex-col items-center justify-center gap-0.5 focus:outline-none focus-visible:bg-white/[0.06]">
                <span className={`flex items-center justify-center w-[46px] h-[26px] rounded-full ${on ? "bg-orange-500/20 text-orange-300" : "text-zinc-400"}`}><Icon size={19} strokeWidth={on ? 2.4 : 2} /></span>
                <span className={`text-[11px] leading-none font-semibold ${on ? "text-zinc-50" : "text-zinc-400"}`}><span className="sr-only">Step {i + 1}: </span>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <UndoRedo vertical />
      <button className={`${iconBtn} [@media(max-height:400px)]:h-10`} aria-label={panelOpen ? "Hide the panel" : "Show the panel"} aria-expanded={panelOpen} onClick={onPanel} data-testid="panel-toggle">
        {panelOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
      </button>
    </nav>
  );
}

function StepHeader({ onFindSite }: { onFindSite: () => void }) {
  const step = useEditor(e => e.step);
  const site = useCourse(s => s.doc.site);
  const canvas = useCourse(s => s.doc.canvas);
  const sum = useSummary();
  const i = STEPS.findIndex(s => s.id === step);
  const meta = STEPS[i];
  const example = useCourse(s => s.doc.id === EXAMPLE_ID);
  const ground = useCourse(s => !!s.doc.background || !!s.doc.lidar);
  const chip = (text: string) => <span className="shrink-0 text-[13px] font-semibold text-zinc-200 bg-white/[0.07] rounded-full px-3 py-1.5 tabular-nums">{text}</span>;
  const area = chip(fmtArea(canvas.width * canvas.height, sum.units));
  // (Find your park here, the panel's own left out; the example: its panel says what to do instead)
  const right =
    step === "site" ? (site.bounds || (example && ground) ? area : example ? null : <button className="shrink-0 h-11 px-4 rounded-full bg-orange-500 text-zinc-950 text-[14px] font-bold active:bg-orange-600" onClick={onFindSite} data-testid="find-site">Find your park</button>)
    // (the holes and par are on the top bar: the checks here, as a computer has them under the holes)
    : step === "design" ? (sum.holes ? <ProblemsCount /> : null)
    : null;
  return (
    <div className="touch-none flex items-center gap-3 px-4 pb-3" data-testid="sheet-header">
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] font-semibold text-orange-300">Step {i + 1} of {STEPS.length}</div>
        <h2 className="text-[20px] font-bold text-zinc-50 leading-tight truncate" data-testid="sheet-title">{meta.title}</h2>
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------------- tools

// (view only: no tools to change the course with)
function ToolStrip() {
  return useCourse(s => s.readOnly) ? null : <Tools />;
}

function Tools() {
  const ed = useEditor();
  const tool = toolOf(ed)?.id;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the active tool in sight
    const el = row.current?.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
    const box = row.current;
    if (!el || !box) return;
    const l = el.offsetLeft - box.offsetLeft, r = l + el.offsetWidth;
    if (l < box.scrollLeft || r > box.scrollLeft + box.clientWidth) box.scrollTo({ left: l - 12, behavior: "smooth" });
  }, [tool]);
  const pick = (t: (typeof TOOLS)[number]) => {
    if (t.id !== tool) stopDrawing();
    pickTool(t);
  };
  // (the step's own tools, the rest under More, as on a computer; the one in use comes forward)
  const step = useEditor(e => e.step);
  const main = STEP_TOOLS[step] ?? STEP_TOOLS.design;
  const shown = TOOLS.filter(t => main.includes(t.id) || t.id === tool);
  const rest = TOOLS.filter(t => !shown.includes(t));
  const [more, setMore] = useState(false);
  const btn = "shrink-0 min-w-[56px] h-[54px] px-1.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";
  return (
    <div className="flex items-center gap-1 pl-2 pr-1.5 pb-2" data-testid="tool-strip">
      <div ref={row} role="toolbar" aria-label="Tools" className="flex-1 min-w-0 flex gap-1 overflow-x-auto dg-noscrollbar dg-fade-r touch-pan-x pr-6">
        {shown.map(t => {
          const on = tool === t.id;
          return (
            <button
              key={t.id}
              data-tool={t.id}
              data-testid={`tool-${t.id}`}
              aria-label={touchWords(t.label)}
              aria-pressed={on}
              onClick={() => pick(t)}
              className={`${btn} ${on ? "bg-orange-500 text-zinc-950 shadow-lg shadow-orange-900/40" : "text-zinc-300 active:bg-white/[0.13] bg-white/[0.07]"}`}
            >
              {t.icon}
              <span className="text-[11px] leading-none font-semibold whitespace-nowrap">{t.short}</span>
            </button>
          );
        })}
        {rest.length > 0 && (
          <button className={`${btn} text-zinc-300 active:bg-white/[0.13] bg-white/[0.07]`} aria-label="More tools" aria-haspopup="menu" onClick={() => setMore(true)} data-testid="more-tools">
            <Ellipsis size={18} />
            <span className="text-[11px] leading-none font-semibold whitespace-nowrap">More</span>
          </button>
        )}
      </div>
      {/* (the rest as tiles, as the strip shows its own: all of them in sight at once, no scrolling) */}
      {more && (
        <ActionSheet title="More tools" actions={[]} onClose={() => setMore(false)} testid="more-tools-menu">
          <div className="grid grid-cols-4 gap-1.5 p-2" role="menu">
            {rest.map(t => (
              <button key={t.id} role="menuitem" data-testid={`tool-${t.id}`} aria-label={touchWords(t.label)} onClick={() => { pick(t); setMore(false); }}
                className="min-h-[64px] px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 text-zinc-200 bg-white/[0.07] active:bg-white/[0.13] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                {t.icon}
                <span className="text-[11.5px] leading-tight font-semibold text-center">{t.short}</span>
              </button>
            ))}
          </div>
        </ActionSheet>
      )}
    </div>
  );
}

// (where the step's row was left, slid sideways: it opens there again)
const stepRowAt: Partial<Record<Step, number>> = {};

/** A step's tools on a phone, in the glass bar's row just over the steps (the look of a tool's
 * settings: a word under each), the rest past the edge with +N. A tool tapped rises into its bar's
 * pill (`onPick` with where it was); `back`, the tool coming back down into its place from the
 * pill, its neighbours sliding back in. */
function StepTools({ onPick, back }: { onPick: (from: DOMRect) => void; back: { tool: string; from: DOMRect } | null }) {
  const step = useEditor(e => e.step);
  const main = STEP_TOOLS[step] ?? STEP_TOOLS.design;
  // (no Select: outside a tool, a tap picks; the step's own tools first, then the rest)
  const list = [...TOOLS.filter(t => t.id !== "select" && main.includes(t.id)), ...TOOLS.filter(t => t.id !== "select" && !main.includes(t.id))];
  const row = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(0);
  const count = useCallback(() => {
    const r = row.current;
    if (!r) return;
    const edge = r.getBoundingClientRect().right;
    let n = 0;
    r.querySelectorAll<HTMLElement>("[data-tool]").forEach(b => { if (b.getBoundingClientRect().right > edge + 2) n++; });
    setPast(n);
    stepRowAt[step] = r.scrollLeft;
  }, [step]);
  useLayoutEffect(() => {
    const r = row.current;
    if (!r) return;
    r.scrollLeft = stepRowAt[step] ?? 0;
    // (coming back from a tool: it drops from the pill into its place, the rest sliding back in)
    const b = back && r.querySelector<HTMLElement>(`[data-tool="${back.tool}"]`);
    if (b) {
      b.scrollIntoView?.({ inline: "nearest", block: "nearest" });
      const to = b.getBoundingClientRect();
      b.animate?.([{ transform: `translate(${back.from.left - to.left}px, ${back.from.top - to.top}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
      r.animate?.([{ transform: "translateX(-36px)", opacity: 0.2 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    }
    count();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = () => row.current?.scrollBy({ left: row.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="absolute left-2.5 right-2.5 bottom-2 z-30 flex items-center gap-1 h-[64px] px-1.5 rounded-[26px] glass border border-white/10 shadow-2xl" data-testid="tool-strip">
      <div ref={row} onScroll={count} role="toolbar" aria-label="Tools" className={`flex-1 min-w-0 flex gap-1 overflow-x-auto dg-noscrollbar touch-pan-x ${past ? "dg-fade-r" : ""}`}>
        {list.map(t => (
          <button key={t.id} data-tool={t.id} data-testid={`tool-${t.id}`} aria-label={touchWords(t.label)}
            onClick={e => { onPick(e.currentTarget.getBoundingClientRect()); stopDrawing(); pickTool(t); }}
            className="shrink-0 min-w-[62px] h-[50px] px-2 rounded-[18px] flex flex-col items-center justify-center gap-[3px] text-zinc-300 active:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            <span className="text-zinc-50 flex">{t.icon}</span>
            <span className="text-[11.5px] leading-none font-semibold whitespace-nowrap">{t.short}</span>
          </button>
        ))}
      </div>
      {past > 0 && <button className="shrink-0 h-[30px] min-w-[34px] px-2 rounded-full bg-white/[0.13] text-[13px] font-bold text-zinc-100 tabular-nums" aria-label={`${past} more tools`} onClick={more} data-testid="tools-more">+{past}</button>}
    </div>
  );
}

/** A row of chips that scrolls sideways (a phone has no room to wrap them). */
const ChipRow = ({ children, testid }: { children: ReactNode; testid?: string }) => (
  <div className="mt-2 px-4 flex gap-1.5 overflow-x-auto dg-noscrollbar dg-fade-r touch-pan-x touch-pan-y" data-testid={testid}>{children}<span className="shrink-0 w-4" aria-hidden /></div>
);

function ToolHeader() {
  const ed = useEditor();
  const t = toolOf(ed);
  const help = toolHelp(ed);
  const hint = toolHint(ed, true);
  // (the kinds, then how to draw on a row of their own, then the brush's size and strength: there's
  // no room beside the rest)
  const all = [...(toolOptions(ed) ?? []), ...(toolShapes(ed) ?? [])];
  const isBrush = (o: ReactNode) => (o as { key?: string } | null)?.key === "brush";
  const isSpecies = (o: ReactNode) => (o as { key?: string } | null)?.key === "species";
  // (what the brush does to areas: a row of its own, over the brush's size)
  const isModes = (o: ReactNode) => (o as { key?: string } | null)?.key === "modes";
  const kinds = (toolOptions(ed) ?? []).filter(o => !isBrush(o));
  const shapes = (toolShapes(ed) ?? []).filter(o => !isBrush(o) && !isSpecies(o) && !isModes(o));
  const modes = (toolShapes(ed) ?? []).filter(isModes);
  const species = (toolShapes(ed) ?? []).filter(isSpecies);
  const brush = all.find(isBrush);
  return (
    <div className="pb-3" data-testid="tool-header">
      <div className="touch-none flex items-start gap-2 pl-4 pr-2">
        <div className="flex-1 min-w-0 pt-1">
          <div className="text-[16px] font-bold text-zinc-50 flex items-center gap-2" data-testid="sheet-title"><span className="text-orange-300">{t?.icon}</span>{toolTitle(t)}{help && <HelpLink topic={help} label={toolTitle(t)} />}</div>
          {hint && <p className="text-[14px] leading-snug text-zinc-300 mt-0.5" data-testid="tool-hint">{hint}</p>}
        </div>
        <button className={iconBtn} aria-label="Back to Select" title="Back to Select" onClick={() => { stopDrawing(); ed.set({ tool: "select" }); }} data-testid="tool-close"><X size={20} /></button>
      </div>
      {kinds.length > 0 && <ChipRow testid="tool-options">{kinds}</ChipRow>}
      {shapes.length > 0 && <ChipRow testid="tool-shapes">{shapes}</ChipRow>}
      {species.length > 0 && <ChipRow testid="tool-species">{species}</ChipRow>}
      {modes.length > 0 && <ChipRow testid="tool-modes">{modes}</ChipRow>}
      {brush && <div className="mt-2 px-4 flex">{brush}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------- selection

function SelectionHeader({ onMore }: { onMore: () => void }) {
  const doc = useCourse(s => s.doc);
  const step = useEditor(e => e.step);
  const { hole, item, group } = useSelection();
  const s = useMemo(() => (hole ? holeStats(doc, hole) : null), [doc, hole]);
  const u = doc.units;
  const holeId = hole?.id ?? (item && "holeId" in item ? item.holeId : undefined);
  // (a tee of a hole that's whole: it can be stood on)
  const teeOf = useMemo(() => {
    if (item?.type !== "tee") return null;
    const h = doc.holes.find(x => x.id === item.holeId);
    return h && holeStats(doc, h).complete ? item : null;
  }, [doc, item]);
  const title = hole ? `Hole ${holeLabel(doc, hole.id)}${hole.name ? ` · ${hole.name}` : ""}` : item ? itemTitle(item) : group.length ? `${group.length} selected` : "";
  const sub = hole
    ? s?.complete ? `${fmtDist(s.length, u)} · Par ${s.par} · ${fmtElev(s.elevationChange, u)}` : s?.teeId ? "Needs a basket" : "Needs a tee"
    : holeId ? `Hole ${holeLabel(doc, holeId)}` : item?.locked ? "Locked in place" : item ? "Whole course" : groupSummary(doc, group).join(" · ");
  const back = STEPS.find(x => x.id === step)?.label ?? "the step";
  return (
    <div className={`touch-none flex items-center gap-0.5 ${hole ? "pl-4" : "pl-1.5"} pr-2 pb-2`} data-testid="selection-header">
      {/* (a hole: its own arrows to the holes either side, and Close at the end) */}
      {!hole && <button className={iconBtn} aria-label={`Back to ${back}`} title={`Back to ${back}`} onClick={() => select(null)} data-testid="selection-back"><ChevronLeft size={26} /></button>}
      <div className="flex-1 min-w-0 pl-0.5">
        <div className="text-[17px] font-bold text-zinc-50 truncate leading-tight" data-testid="sheet-title">{title}</div>
        {holeId && !hole ? (
          <button className="text-[13px] text-orange-300 font-semibold min-h-[44px] -my-3 py-3 pr-3" onClick={() => select(holeId)}>{sub} ›</button>
        ) : (
          <div className="text-[13px] text-zinc-400 truncate tabular-nums">{sub}</div>
        )}
      </div>
      {hole && <HoleSteps holeId={hole.id} big />}
      {hole && s?.complete && <button className={iconBtn} aria-label="View from the tee" title="View from the tee" onClick={() => useEditor.getState().set({ teeView: hole.id, teeViewTee: null, flyover: false })}><Eye size={20} /></button>}
      {/* (a tee: the same eye, standing on that tee) */}
      {teeOf && <button className={iconBtn} aria-label="View from this tee" title="View from this tee" onClick={() => useEditor.getState().set({ teeView: teeOf.holeId, teeViewTee: teeOf.id, flyover: false })} data-testid="selection-tee-view"><Eye size={20} /></button>}
      {group.length > 0 && <button className={iconBtn} aria-label="Duplicate" title="Duplicate" onClick={duplicateSelection}><Copy size={19} /></button>}
      <button className={`${iconBtn} hover:text-red-400`} aria-label="Delete" title="Delete" onClick={deleteSelection} data-testid="selection-delete"><Trash2 size={19} /></button>
      <button className={iconBtn} aria-label="More actions" title="More actions" onClick={onMore} data-testid="selection-more"><Ellipsis size={22} /></button>
      {hole && <button className={iconBtn} aria-label="Close" title="Close" onClick={() => select(null)} data-testid="selection-close"><X size={20} /></button>}
    </div>
  );
}

/** The shared menu rows as a sheet's (their icons drawn). */
const sheetRows = (rows: ItemAction[]): SheetAction[] => rows.map(({ icon: Icon, ...a }) => ({ ...a, icon: Icon ? <Icon size={18} /> : undefined }));

/** The trees where a finger was held (every one it passed through, nearest first, up to three):
 * to edit or cut down each, as the right-click menu has them. */
function treeRows(at: MenuInfo | undefined): SheetAction[] {
  if (!at || useCourse.getState().readOnly) return [];
  const doc = getDoc();
  const trees = treesAt(at.clientX, at.clientY, at.ground).slice(0, 3);
  return trees.flatMap((t, n) => {
    const what = treeTitle(doc, t);
    const hint = n === 0 && trees.length > 1 ? `${what} · in front` : what;
    return treeActions(t).map(a => ({ label: a.label, hint, icon: a.testid === "tree-cut" ? <Axe size={18} /> : <TreeDeciduous size={18} />, run: a.run, testid: n ? undefined : a.testid }));
  });
}

/** A hole's or an item's menu (long-press on the map, or "More" on the selection); `at`: where the
 * finger was held (the trees there get rows too). The same rows as a right-click on a computer. */
export function ItemMenu({ itemId, at, onClose }: { itemId: string; at?: MenuInfo; onClose: () => void }) {
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === itemId);
  const item = doc.items.find(i => i.id === itemId);
  if (!hole && !item) return null;
  const holeId = hole?.id ?? (item && "holeId" in item ? item.holeId : undefined);
  const trees = hole ? [] : treeRows(at);
  // (the thing's own rows named for it, beside the trees')
  const a: SheetAction[] = [...trees, ...sheetRows(itemActions(itemId, at?.ground ?? null, trees.length > 0))];
  const title = hole ? `Hole ${holeLabel(doc, hole.id)}${hole.name ? ` · ${hole.name}` : ""}` : itemTitle(item!);
  const sub = holeId && !hole ? `Hole ${holeLabel(doc, holeId)}` : undefined;
  return <ActionSheet title={title} subtitle={sub} actions={a} onClose={onClose} testid="item-menu" />;
}

/** Things picked together: their menu ("More" on the selection). */
function GroupMenu({ onClose }: { onClose: () => void }) {
  const doc = getDoc();
  const group = useEditor.getState().group;
  const items = doc.items.filter(i => group.includes(i.id));
  if (!items.length) return null;
  return <ActionSheet title={`${group.length} selected`} subtitle={groupSummary(doc, items).join(" · ")} actions={sheetRows(groupActions())} onClose={onClose} testid="item-menu" />;
}

/** A finger held on open ground (or on trees with nothing else under them): what can start there,
 * as the right-click menu has it (a tee or pin for the hole being worked on, a bend in its line, a
 * new hole, measuring), and the trees there. A sheet from the bottom, like every phone menu. */
export function GroundMenu({ info, onClose }: { info: MenuInfo; onClose: () => void }) {
  const doc = getDoc();
  const ground = info.ground ? groundActions(info.ground, !info.under) : null;
  const here = !!ground && !info.under && !useCourse.getState().readOnly && useEditor.getState().step === "design";
  const a: SheetAction[] = sheetRows(ground?.rows ?? []);
  const trees = treeRows(info);
  a.push(...trees);
  // (the area or hole the trees stand in: to pick it instead)
  const under = trees.length ? underAction(doc, info.under) : null;
  if (under) a.push({ label: under.label, run: under.run, testid: under.testid });
  if (!a.length) return null;
  return <ActionSheet title={here ? "This spot" : "Trees here"} subtitle={ground?.hole} actions={a} onClose={onClose} testid={here ? "map-menu-here" : "map-menu"} />;
}

// ---------------------------------------------------------------------------------- the glass bar

/** Every tool, as a tool's pill opens them: the one in use lit, its help at the foot. */
function ToolGrid() {
  const ed = useEditor();
  const nav = useBarNav();
  const t = toolOf(ed);
  const help = toolHelp(ed);
  // (the step's own tools, and whichever is in use)
  const main = STEP_TOOLS[ed.step] ?? STEP_TOOLS.design;
  const list = TOOLS.filter(x => x.id !== "select" && (ed.step !== "site" || main.includes(x.id) || x.id === t?.id));
  return (
    <div className="p-1">
      <div className="grid grid-cols-4 gap-1.5" role="menu" aria-label="Tools" data-testid="tool-grid">
        {list.map(x => {
          const on = x.id === t?.id;
          return (
            <button key={x.id} role="menuitem" aria-current={on || undefined} aria-label={touchWords(x.label)} data-testid={`tool-${x.id}`}
              onClick={() => { if (!on) { stopDrawing(); pickTool(x); } nav.close(); }}
              className={`min-h-[66px] px-1 rounded-[18px] flex flex-col items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-orange-300 text-zinc-950" : "bg-white/[0.07] text-zinc-200 active:bg-white/[0.13]"}`}>
              {x.icon}
              <span className="text-[11.5px] leading-tight font-semibold text-center">{x.short}</span>
            </button>
          );
        })}
      </div>
      {help && t && <div className="mt-1.5"><ActRow icon={<HelpCircle size={18} />} label={`Help on ${toolTitle(t).toLowerCase()}`} hint="How it works, step by step" onClick={() => askHelp(help)} testid="tool-help" /></div>}
    </div>
  );
}

/** A thing's or a hole's own rows in its pill's menu: the same as holding a finger on it. */
const PillActions = ({ id }: { id: string }) => (
  <div className="flex flex-col gap-0.5">
    {itemActions(id, null).map(a => <ActRow key={a.label} label={a.label} icon={a.icon ? <a.icon size={18} /> : undefined} danger={a.danger} onClick={a.run} testid={a.testid} />)}
  </div>
);

/** What a finger working on the map does to the bar: it fades almost away, after a moment (a quick
 * tap doesn't flicker it), and comes back when the finger lifts. */
function useFingerDown(on: boolean) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (!on) { setDown(false); return; }
    let t = 0;
    const map = () => document.querySelector<HTMLElement>('[data-testid="plan"]');
    const press = (e: PointerEvent) => {
      const el = map();
      if (!el || !el.contains(e.target as Node)) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => setDown(true), 140);
    };
    const lift = () => { window.clearTimeout(t); setDown(false); };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", lift, true);
    window.addEventListener("pointercancel", lift, true);
    return () => { window.clearTimeout(t); window.removeEventListener("pointerdown", press, true); window.removeEventListener("pointerup", lift, true); window.removeEventListener("pointercancel", lift, true); };
  }, [on]);
  return down;
}

type BarProps = { faded: boolean; side?: boolean; onHeight: (px: number) => void; mainH: number; from?: DOMRect | null };

/** The tool in use: its pill (every tool from it), its settings, the brush's size (and the ground
 * brush's strength) on the edge, and its hint for a few seconds as it starts. */
function PhoneToolBar({ faded, side, onHeight, mainH, from }: BarProps) {
  const ed = useEditor();
  const units = useCourse(s => s.doc.units);
  const t = toolOf(ed);
  const { settings, edge } = phoneToolSettings(ed);
  const drawing = ed.drawPoints > 0;
  const own = useCourse(s => (ed.reshapeId ? s.doc.items.find(i => i.id === ed.reshapeId) : undefined));
  // The hint: for a few seconds as the tool, or how it draws, changes (not over an open menu)
  const [hint, setHint] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const said = toolHint(ed, true) ?? null;
  const changed = `${ed.tool}|${t?.id}|${ed.drawShape}|${ed.areaBrush}|${ed.groundBrush}|${ed.reshapeId}`;
  useEffect(() => {
    setHint(said);
    if (!said) return;
    const tm = window.setTimeout(() => setHint(null), 4500);
    return () => window.clearTimeout(tm);
  }, [changed]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = own && own.type === "area" ? (own.kind === "woods" ? ((own.bushes ?? 0) >= 1 ? "underbrush" : "wood") : AREA_KINDS[own.kind].label.toLowerCase()) : "";
  const pill = own
    ? { name: "Reshaping", small: `just this ${kind}`, icon: t?.icon }
    : { name: t ? t.short : "", icon: t?.icon, small: drawing ? `${ed.drawPoints} ${ed.drawPoints === 1 ? "point" : "points"}` : undefined };
  const done = () => { stopDrawing(); ed.set({ tool: "select", reshapeId: null }); };
  // (the sliders between the top bar and the bar, on the left)
  // (upright, the bar along the foot; sideways, up the right edge, the sliders the whole height)
  const top = side ? 76 : 128, room = Math.max(160, mainH - top - (side ? 16 : 160));
  const sizeH = Math.min(250, edge.strength ? room * 0.55 : room * 0.8);
  const ring = (v: number | null) => getView()?.previewBrush(v);
  // (the room kept for the drawing's buttons in the row's place: as tall as they are, two rows
  // while a line is walked, so the pill stays clear above them)
  const [drawH, setDrawH] = useState(64);
  useEffect(() => {
    if (!drawing) return;
    const el = document.querySelector<HTMLElement>('[data-testid="draw-bar"]');
    if (!el) return;
    const ro = new ResizeObserver(() => setDrawH(Math.max(64, Math.round(el.getBoundingClientRect().height))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawing]);
  return (
    <>
      {hint && !drawing && !faded && !menuOpen && <div className="absolute left-1/2 -translate-x-1/2 z-[33] max-w-[calc(100%-24px)] px-4 py-2 rounded-full glass border border-white/10 shadow-xl text-[13.5px] font-semibold text-zinc-50 text-center pointer-events-none dg-fade-in" style={side ? { bottom: 16, left: "calc(50% - 60px)" } : { bottom: 146 }} data-testid="tool-hint">{hint}</div>}
      {edge.size && (
        <EdgeSlider testid="brush-size" label="Brush size" value={ed.brushSize} min={4} max={150} step={1} format={v => fmtDist(v * 2, units)} icon={<Circle size={18} />}
          top={top} height={sizeH} faded={faded} onChange={v => { ed.set({ brushSize: v }); ring(v); }} onSlide={on => ring(on ? useEditor.getState().brushSize : null)} />
      )}
      {edge.strength && (
        <EdgeSlider testid="brush-strength" label="Brush strength" value={ed.brushStrength} min={1} max={10} step={1} format={v => `${v * 10}%`} icon={<Gauge size={18} />}
          top={top + sizeH + 16} height={Math.min(200, room - sizeH - 16)} faded={faded} onChange={v => ed.set({ brushStrength: v })} />
      )}
      <GlassBar remember={`tool:${t?.id ?? ed.tool}`} pill={pill} pillMenu={own ? undefined : <ToolGrid />} pillWide settings={drawing ? [] : settings} onDone={done} doneLabel={own ? "Done reshaping" : "Done: back to Select"}
        replace={drawing ? <div style={{ height: drawH }} aria-hidden /> : undefined} faded={faded} side={side} onHeight={onHeight} onOpen={id => setMenuOpen(!!id)} from={from} testid="tool-bar" />
    </>
  );
}

/** A hole picked: its pill (with the holes either side), every setting it has, and ✓. */
function PhoneHoleBar({ hole, faded, side, onHeight }: BarProps & { hole: Hole }) {
  const doc = useCourse(s => s.doc);
  const s = holeStats(doc, hole);
  const settings = useHoleSettings(hole);
  const many = doc.holes.length > 1;
  const pill = { name: `Hole ${holeLabel(doc, hole.id)}`, small: s.complete ? `${fmtDist(s.length, doc.units)} · Par ${s.par}` : s.teeId ? "Needs a basket" : "Needs a tee", prev: many ? () => stepHole(-1) : undefined, next: many ? () => stepHole(1) : undefined, testid: "selection-header" };
  return <GlassBar remember="hole" pill={pill} pillMenu={<PillActions id={hole.id} />} settings={settings} onDone={() => select(null)} doneLabel="Done: put it down" faded={faded} side={side} onHeight={onHeight} testid="hole-strip" />;
}

/** Anything else picked: its pill (its hole, and what can be done with it), every setting it has. */
function PhoneItemBar({ item, faded, side, onHeight }: BarProps & { item: CourseItem }) {
  const doc = useCourse(s => s.doc);
  const settings = useItemSettings(item);
  const holeId = "holeId" in item ? item.holeId : undefined;
  const kind = item.type === "area" || item.type === "line" || item.type === "structure" ? `${item.type}:${item.kind}` : item.type;
  const pill = { name: itemTitle(item), small: holeId ? `Hole ${holeLabel(doc, holeId)}` : item.locked ? "Locked in place" : undefined, testid: "selection-header" };
  // (a height opened in 3D: the camera looks at it from the side, close up, and back after; not as
  // the thing is picked, only when the setting is tapped)
  const [opened, setOpened] = useState<string | null>(null);
  const threeD = useEditor(e => e.view === "3d");
  const sideOn = threeD && (opened === "height" || opened === "raised");
  useEffect(() => {
    if (!sideOn) return;
    getView()?.lookAtHeight(item.id);
    return () => getView()?.lookAtHeight(null);
  }, [sideOn, item.id]);
  // (a part of a field tapped on the map: its Parts open)
  const part = useEditor(e => e.fieldPart);
  const menu = (
    <div className="flex flex-col gap-0.5">
      {holeId && <ActRow icon={<Flag size={18} />} label={`Hole ${holeLabel(doc, holeId)}`} hint="Its par, fairway, tees and pins" onClick={() => select(holeId)} testid="pill-hole" />}
      {(item.type === "area" || item.type === "line") && <div className="px-1.5 py-1 empty:hidden"><MoveCornerHere item={item} /></div>}
      <PillActions id={item.id} />
    </div>
  );
  return <GlassBar remember={kind} pill={pill} pillMenu={menu} settings={settings} onDone={() => select(null)} doneLabel="Done: put it down" faded={faded} side={side} onHeight={onHeight} onOpen={setOpened} want={part ? "parts" : null} testid="item-strip" />;
}

/** Things picked together: what they are, and what can be done with them all. */
function PhoneGroupBar({ group, faded, side, onHeight }: BarProps & { group: CourseItem[] }) {
  const doc = useCourse(s => s.doc);
  const parts = groupSummary(doc, group);
  const settings: BarSetting[] = groupActions().map((a, i) => ({ id: `g${i}`, name: `All ${group.length}`, value: a.label.replace(/ \d+$/, ""), run: a.run, testid: a.testid }));
  return <GlassBar remember="group" pill={{ name: `${group.length} selected`, small: parts.slice(0, 2).join(" · "), testid: "selection-header" }} settings={settings} onDone={() => select(null)} doneLabel="Done: put them down" faded={faded} side={side} onHeight={onHeight} testid="group-strip" />;
}

/** The bar for what the screen is on: the tool in use, or what's picked. */
function PhoneBar(props: BarProps) {
  const mode = useMode();
  const { hole, item, group } = useSelection();
  if (mode === "tool") return <PhoneToolBar {...props} />;
  if (hole) return <PhoneHoleBar key={hole.id} hole={hole} {...props} />;
  if (item) return <PhoneItemBar key={item.id} item={item} {...props} />;
  if (group.length) return <PhoneGroupBar group={group} {...props} />;
  return null;
}

// ---------------------------------------------------------------------------------- app menu

function AppMenu({ onClose, onHelp, onGoTo, onOpenFile }: { onClose: () => void; onHelp: () => void; onGoTo: () => void; onOpenFile: () => void }) {
  const [recent, setRecent] = useState<PlanMeta[]>([]);
  const name = useCourse(s => s.doc.name);
  // (a viewer the owner hasn't allowed downloads: no course file either, as on a computer)
  const mayFiles = useAllowed("downloads");
  useEffect(() => { void recentCourses().then(setRecent); }, []);
  const actions: SheetAction[] = [
    ...(SERVER ? [] : demoFirst()),
    { label: "Search holes, tools and help", icon: <Search size={19} />, run: onGoTo, testid: "menu-search" },
    { label: "Getting started", icon: <ListChecks size={19} />, run: openGettingStarted, testid: "menu-getting-started" },
    { label: "New course", icon: <FilePlus size={19} />, run: () => void newCourse() },
    { label: "Open a course file…", icon: <FolderOpen size={19} />, run: onOpenFile },
    ...(mayFiles ? [{ label: "Save as a file", icon: <Save size={19} />, run: () => saveCourseFile() }] : []),
    { label: "Help guide", icon: <HelpCircle size={19} />, run: onHelp, testid: "menu-help" },
    ...(SERVER ? accountActions() : demoLocked())
  ];
  return (
    <>
      <ActionSheet title={name} subtitle="GlideLine Studio" actions={actions} onClose={onClose} testid="app-menu">
        {recent.length > 0 && (
          <div className="border-b border-white/5">
            <div className="px-4 pt-2.5 pb-1 text-[12px] uppercase tracking-wider font-bold text-zinc-500">{SERVER ? "Courses" : "Recent courses"}</div>
            <div className="flex gap-2 overflow-x-auto dg-noscrollbar px-4 pb-3 touch-pan-x touch-pan-y">
              {recent.map(r => (
                <div key={r.id} className="shrink-0 flex items-center bg-white/[0.07] rounded-xl" data-testid="recent-course">
                  <button className="text-left pl-3 pr-1 py-2 min-h-[48px]" onClick={() => { onClose(); void openRecent(r.id); }}>
                    <span className="block text-[14px] text-zinc-100 max-w-[180px] truncate">{r.name}</span>
                    <span className="block text-[12px] text-zinc-400">{r.holes} hole{r.holes === 1 ? "" : "s"} · updated {ago(r.updatedAt)}</span>
                  </button>
                  {/* (the menu closes first: the toast with Undo is under it otherwise) */}
                  <button className="w-11 h-12 flex items-center justify-center text-zinc-500" aria-label={`Delete ${r.name}`} onClick={() => { onClose(); void deleteRecent(r.id); }}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </ActionSheet>
    </>
  );
}

/** Undo and Redo, always in reach: on the top bar of a phone and the rail of a tablet, whatever
 * step it's on and whatever is picked (none when the course is only for viewing). */
function UndoRedo({ vertical = false, lean = false }: { vertical?: boolean; lean?: boolean }) {
  const readOnly = useCourse(s => s.readOnly);
  const canUndo = useCourse(s => s.past.length > 0);
  const canRedo = useCourse(s => s.future.length > 0);
  // (while drawing, the last point first, as the drawing's own Undo does)
  const drawing = useEditor(e => e.drawPoints > 0 || !!e.plotLine);
  if (readOnly) return null;
  const btn = `w-11 h-11 ${vertical ? "[@media(max-height:400px)]:h-10" : ""} shrink-0 flex items-center justify-center rounded-[12px] text-zinc-100 active:bg-white/[0.13] disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`;
  return (
    <div className={`flex ${vertical ? "flex-col" : ""} shrink-0`} data-testid="undo-redo">
      <button className={btn} aria-label="Undo" disabled={!canUndo && !drawing} onClick={() => { if (!getView()?.undoPoint()) useCourse.getState().undo(); }} data-testid="undo"><Undo2 size={20} /></button>
      {/* (lean, beside the Map step's chips: Redo only once there's something to redo) */}
      {(!lean || canRedo) && <button className={btn} aria-label="Redo" disabled={!canRedo} onClick={() => useCourse.getState().redo()} data-testid="redo"><Redo2 size={20} /></button>}
    </div>
  );
}

function PhoneTopBar({ onMenu, pages = false }: { onMenu: () => void; pages?: boolean }) {
  const name = useCourse(s => s.doc.name);
  // (the page covers the map on Map and Export: 2D and 3D would do nothing there)
  const onMap = useEditor(e => e.step === "design" || e.step === "site");
  const sum = useSummary();
  const sub = sum.complete ? `${sum.complete} hole${sum.complete === 1 ? "" : "s"} · Par ${sum.par} · ${fmtDist(sum.length, sum.units)}` : "GlideLine Studio";
  return (
    <div className="absolute left-0 right-0 top-0 z-30 px-2 pt-[max(8px,env(safe-area-inset-top))] pointer-events-none" data-testid="top-bar">
      <div className="glass pointer-events-auto flex items-center gap-1 h-[56px] pl-1 pr-1 rounded-[22px]">
        {/* (the menu: a button that looks like one, and the course's name opens it too) */}
        {SITE_TOKEN ? <CoursePageButton /> : <button className="w-11 h-11 shrink-0 flex items-center justify-center rounded-[14px] bg-white/[0.1] active:bg-white/[0.18] text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label="Menu: files, help" onClick={onMenu} data-testid="app-menu-button"><Menu size={22} /></button>}
        {/* (the Map step: its printouts in the name's place, the page under them as big as it goes) */}
        {pages ? <PageChips /> : SITE_TOKEN ? (
          <div className="flex-1 min-w-0 pl-0.5">
            <div className="text-[15px] font-bold text-zinc-50 truncate leading-tight" data-testid="course-name">{name}</div>
            <div className="text-[12px] text-zinc-400 truncate tabular-nums">{sub}</div>
          </div>
        ) : (
          <button className="flex-1 min-w-0 min-h-11 pl-1.5 text-left rounded-[12px] active:bg-white/[0.07] focus:outline-none" onClick={onMenu} aria-label={`${name}: open the menu`}>
            <div className="text-[15px] font-bold text-zinc-50 truncate leading-tight flex items-center gap-1" data-testid="course-name"><span className="truncate">{name}</span><ChevronDown size={15} className="shrink-0 text-zinc-400" /></div>
            <div className="text-[12px] text-zinc-400 truncate tabular-nums">{sub}</div>
          </button>
        )}
        {SERVER && (pages ? <SaveAlert /> : <CourseChip />)}
        <UndoRedo lean={pages} />
        {onMap && <ViewToggle look="bar" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------- the panel

/** The panel's header and content, for the bottom sheet and the side panel. */
function usePanel({ onFindSite, onMore, phone = false }: { onFindSite: () => void; onMore: () => void; phone?: boolean }) {
  const readOnly = useCourse(s => s.readOnly);
  const mode = useMode();
  const step = useEditor(e => e.step);
  const tool = useEditor(e => e.tool);
  const selectedId = useEditor(e => e.selectedId);
  const meta = STEPS.find(s => s.id === step)!;
  // (a phone: the tool in use and what's picked are on its glass bar instead, PhoneBar, and the
  // step's tools in the row over the steps, StepTools; a tablet's side panel has the room for all
  // of it, beside the map)
  // (the checks, opened from Design's panel: the panel's page of their own, as a computer's panel over the map)
  const checks = useEditor(e => e.problemsOpen && e.step === "design") && mode === "step";
  // (the Site step has the tools too, as on a computer)
  const tools = (step === "design" || step === "site" || mode === "tool") && !checks && !phone;
  const header = (
    <>
      {tools && <ToolStrip />}
      {mode === "tool" ? <ToolHeader /> : mode === "selection" ? <SelectionHeader onMore={onMore} /> : checks ? <ChecksHeader /> : <StepHeader onFindSite={onFindSite} />}
    </>
  );
  const body = mode === "selection" ? (
    <div data-testid="inspector" aria-label="Selection" className="pb-4">
      <InspectorBody />
    </div>
  ) : checks ? (
    <div className="pb-4" data-testid="checks-sheet">
      <ReviewStep />
    </div>
  ) : (
    <div className="pb-4" data-testid="step-panel">
      <StepContent onFindSite={onFindSite} />
    </div>
  );
  // What changed in the panel, said to screen readers (the panel changes without the focus moving)
  const doc = useCourse(s => s.doc);
  const said = mode === "selection" && selectedId
    ? `${doc.holes.some(h => h.id === selectedId) ? `Hole ${holeLabel(doc, selectedId)}` : (() => { const it = doc.items.find(i => i.id === selectedId); return it ? itemTitle(it) : ""; })()} selected`
    : mode === "tool" ? `${toolTitle(toolOf(useEditor.getState())) || tool}: ${toolHint(useEditor.getState(), true) ?? ""}`
    : checks ? "Checks"
    : `Step ${STEPS.findIndex(s => s.id === step) + 1}: ${meta.title}`;
  const announce = <div aria-live="polite" className="sr-only" data-testid="announce">{said}</div>;
  // (view only: the course and its holes, nothing to change)
  if (readOnly) return { mode, header: null, body: <ViewerPanelBody />, announce, key: "viewer" };
  return { mode, checks, header, body, announce, key: mode === "selection" ? `sel:${selectedId}` : checks ? "checks" : `step:${step}:${mode === "tool" ? tool : ""}` };
}

/** The checks' header: back to Design's panel, and how many were found. */
function ChecksHeader() {
  const n = useSummary().issues;
  return (
    <div className="touch-none flex items-center gap-0.5 pl-1.5 pr-2 pb-2" data-testid="checks-header">
      <button className={iconBtn} aria-label="Back to Design" title="Back to Design" onClick={() => useEditor.getState().set({ problemsOpen: false })} data-testid="checks-back"><ChevronLeft size={26} /></button>
      <div className="flex-1 min-w-0 pl-0.5">
        <h2 className="text-[17px] font-bold text-zinc-50 truncate leading-tight" data-testid="sheet-title">Checks</h2>
        {n > 0 && <div className="text-[13px] text-zinc-400 truncate">{n} found</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------- shells

export function CompactShell(props: ShellProps) {
  return props.layout === "phone" ? <PhoneShell {...props} /> : <RailShell {...props} />;
}

function useMenus(onHelp: () => void, onGoTo: () => void) {
  const [appMenu, setAppMenu] = useState(false);
  const [more, setMore] = useState(false);
  const selectedId = useEditor(e => e.selectedId);
  const grouped = useEditor(e => e.group.length > 0);
  // (outside the menu: the menu closes while the file is being picked)
  const file = useRef<HTMLInputElement>(null);
  const menus = (
    <>
      <input ref={file} type="file" className="hidden" aria-label="Open course file" onChange={e => { const f = e.target.files?.[0]; if (f) void openCourseFile(f); e.target.value = ""; }} />
      {appMenu && <AppMenu onClose={() => setAppMenu(false)} onHelp={onHelp} onGoTo={onGoTo} onOpenFile={() => file.current?.click()} />}
      {more && (selectedId ? <ItemMenu itemId={selectedId} onClose={() => setMore(false)} /> : grouped ? <GroupMenu onClose={() => setMore(false)} /> : null)}
    </>
  );
  return { menus, openApp: () => setAppMenu(true), openMore: () => setMore(true) };
}

function PhoneShell({ onFindSite, onHelp, onGoTo, onContextMenu, welcome, toasts }: ShellProps) {
  const ed = useEditor();
  const readOnly = useCourse(s => s.readOnly);
  const [detent, setDetent] = useState<Detent>(() => STEP_DETENT[useEditor.getState().step]);
  const [restH, setRestH] = useState(180);
  const [mainH, setMainH] = useState(700);
  const main = useRef<HTMLDivElement>(null);
  const { menus, openApp, openMore } = useMenus(onHelp, onGoTo);
  const panel = usePanel({ onFindSite, onMore: openMore, phone: true });
  // (on site: the walk's own screen, over the 3D view or the map)
  const onSite = useOnSite(s => !!s.on);
  const immersive = !!ed.teeView || onSite;
  // (from a tee, a video recording's progress sits above the bottom bar, and the toasts above it)
  const exporting = useExportJob(s => !!s.job);
  // (No sheet under the welcome card: it is the first step's panel, with the same two choices;
  // and none on the Map step, where the page's settings are a row of tools under it)
  const pageTools = ed.step === "map" && !immersive && !readOnly;
  // (standing in 3D with a thing picked: its usual sheet, over the tee view's bar)
  const pickedInTee = immersive && !onSite && !readOnly && !ed.flyover && !ed.flyCam && !!ed.selectedId && getDoc().items.some(i => i.id === ed.selectedId);
  // (a tool in use, or a thing picked: the glass bar over a whole-screen map, not the sheet; view
  // only, a thing's numbers are in the sheet as before)
  const bar = !readOnly && !welcome && !pageTools && (panel.mode === "tool" || panel.mode === "selection") && (!immersive || pickedInTee);
  // (the step's own panel, out of its tab or back in it; view only, it's the course's numbers, out)
  const [panelOpen, setPanelOpen] = useState(() => STEP_OPEN[useEditor.getState().step]);
  const stepOnly = panel.mode === "step" && !readOnly;
  const sheet = (!immersive || pickedInTee) && !welcome && !pageTools && !bar && (!stepOnly || panelOpen);
  // (the step's tools in the row over the steps, the panel in its tab)
  const stepRow = stepOnly && !sheet && !welcome && !immersive && (ed.step === "design" || ed.step === "site");
  const [barH, setBarH] = useState(132);
  const sheetH = bar ? barH + 18 : sheet ? restH : stepRow ? 72 : 0;
  // Going into a tool and out again as one motion: the tool tapped rises into the bar's pill, the
  // steps tuck away under it; out, the tool drops back into its place and the steps come up
  const [from, setFrom] = useState<DOMRect | null>(null);
  const [back, setBack] = useState<{ tool: string; from: DOMRect } | null>(null);
  const [navMotion, setNavMotion] = useState<"out" | "in" | null>(null);
  const wasBar = useRef(bar);
  useLayoutEffect(() => {
    if (bar === wasBar.current) return;
    wasBar.current = bar;
    setNavMotion(bar ? "out" : "in");
    const t = window.setTimeout(() => setNavMotion(null), 280);
    if (!bar) {
      // (the pill's last place, for the tool to drop from; the tool it was)
      const pill = document.querySelector<HTMLElement>('[data-testid="bar-pill"], [data-testid="selection-header"]');
      const was = lastTool.current;
      setBack(pill && was ? { tool: was, from: pill.getBoundingClientRect() } : null);
      setFrom(null);
    }
    return () => window.clearTimeout(t);
  }, [bar]);
  const lastTool = useRef<string | null>(null);
  const toolNow = toolOf(ed)?.id ?? null;
  useEffect(() => { if (panel.mode === "tool") lastTool.current = toolNow; else if (panel.mode === "selection") lastTool.current = null; }, [panel.mode, toolNow]);
  // (the steps: shown with the step's row or panel; tucking away under a bar as it comes)
  const navShown = !immersive && !readOnly && (!bar || navMotion === "out");
  // (a tool's bar only: a picked thing's stays, its numbers following its handles as they're dragged)
  const faded = useFingerDown(bar && panel.mode === "tool");

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMainH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Picking a tool brings the sheet down so the map is free to tap on; picking something from a
  // full-height list brings it to half height, so the map shows it
  const prevMode = useRef(panel.mode);
  useLayoutEffect(() => {
    if (panel.mode === "tool" && prevMode.current !== "tool") setDetent("peek");
    prevMode.current = panel.mode;
  }, [panel.mode]);
  // (a hole or a thing picked: down to its strip, the map free above it)
  const holePicked = !readOnly && !!ed.selectedId && (getDoc().holes.some(h => h.id === ed.selectedId) || getDoc().items.some(i => i.id === ed.selectedId));
  useLayoutEffect(() => {
    // (a hole: down to its strip, the map free above it; view only: its numbers come up)
    if (holePicked) setDetent("peek");
    else if (ed.selectedId) setDetent(d => (d === "full" ? "half" : readOnly && d === "peek" ? "half" : d));
  }, [ed.selectedId]);
  // (a piece picked on a printout's page: the sheet down, the page and its toolbar free above it)
  useLayoutEffect(() => {
    if (ed.designSel && (ed.step === "map" || ed.step === "export")) setDetent("peek");
  }, [ed.designSel]);
  // (the checks opened: the panel out and up, a list to read; closed: Design's panel as it was)
  const checksOpen = ed.problemsOpen && ed.step === "design";
  const hadChecks = useRef(checksOpen);
  useLayoutEffect(() => {
    if (checksOpen === hadChecks.current) return;
    hadChecks.current = checksOpen;
    if (checksOpen) { setPanelOpen(true); setDetent("full"); }
    else if (useEditor.getState().step === "design") setDetent("half");
  }, [checksOpen]);
  // (something to point at in the panel, asked for by search or Getting started: the panel out)
  useEffect(() => {
    const on = (e: Event) => {
      const what = (e as CustomEvent).detail;
      if (what === "sheet:half") { setPanelOpen(true); setDetent(d => (d === "peek" ? "half" : d)); }
      else if (what === "sheet:full") { setPanelOpen(true); setDetent("full"); }
    };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  const drawBar = useDrawBarShown();
  // Fitting holes and items keeps them clear of the sheet (set before the fit that follows a
  // pick from the list)
  useLayoutEffect(() => {
    const v = getView();
    if (!v) return;
    v.rightInset = 0;
    v.bottomInset = sheetH;
    v.topInset = immersive ? 0 : 64;
  }, [sheetH, immersive]);
  useEffect(() => () => { const v = getView(); if (v) { v.bottomInset = 0; v.topInset = 0; } }, []);
  // (the thing picked brought between the top bar and the panel, as it's picked and whenever the
  // panel settles at another height; the map slides, it never zooms; not while it's still on its
  // way somewhere)
  useEffect(() => {
    const id = ed.selectedId;
    if (!id || immersive) return;
    // (waits for the map to come to rest, a few seconds at most: picked as the view turns into 3D, say)
    let tries = 0;
    const t = window.setInterval(() => {
      const v = getView();
      if (!v || (!v.settled() && ++tries < 25)) return;
      window.clearInterval(t);
      v.frame(id);
    }, 120);
    return () => window.clearInterval(t);
  }, [sheetH, ed.selectedId, immersive]);
  // (the map moved away from it: a button to go back to it)
  const [away, setAway] = useState(false);
  useEffect(() => {
    const id = ed.selectedId;
    if (!id || immersive) { setAway(false); return; }
    const t = window.setInterval(() => { const v = getView(); setAway(!!v && v.settled() && !v.inView(id)); }, 400);
    return () => window.clearInterval(t);
  }, [ed.selectedId, immersive]);

  // (the Map step's tools, floating over the page: how tall, with what they have open)
  const [toolsH, setToolsH] = useState(64);
  const toolsSeen = useRef<ResizeObserver | null>(null);
  const toolsAt = useCallback((el: HTMLDivElement | null) => {
    toolsSeen.current?.disconnect();
    toolsSeen.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolsH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    toolsSeen.current = ro;
  }, []);
  // The step's panel grows up out of its tab (from low, up to its height) and goes back into it
  const openPanel = useCallback(() => {
    setDetent("peek");
    setPanelOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setDetent("half")));
  }, []);
  const toggle = useCallback(() => { if (panelOpen) setPanelOpen(false); else openPanel(); }, [panelOpen, openPanel]);
  const onStep = (s: Step) => goStep(s, setDetent, toggle);
  // (another step, from its tab, search or anywhere: its panel out or in, as that step starts)
  const stepNow = ed.step;
  const firstStep = useRef(true);
  useLayoutEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    if (STEP_OPEN[stepNow]) openPanel(); else setPanelOpen(false);
  }, [stepNow]); // eslint-disable-line react-hooks/exhaustive-deps
  // (the panel dragged down to its smallest: back into its tab)
  const onDetent = (d: Detent) => { if (d === "peek" && stepOnly) setPanelOpen(false); else setDetent(d); };
  const top = 72; // below the top bar
  const design = (ed.step === "map" || ed.step === "export") && !ed.teeView;
  // (Room for the map's buttons: between the top bar and the sheet, less the drawing buttons;
  // none under the welcome card or the Design preview)
  const controlsRoom = welcome || design ? 0 : mainH - sheetH - top - 12 - (drawBar ? 64 : 0);

  return (
    <div className="dg-compact fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden isolate" data-layout="phone" onScroll={keepPut}>
      <Woods />
      {/* (clipped at its foot: the sheet runs on below it, and nothing of it shows under the steps) */}
      <main ref={main} className="relative flex-1 min-h-0 overflow-clip">
        <MapViewport onContextMenu={onContextMenu} compact="phone" controlsTop={top} controlsRoom={immersive ? 0 : controlsRoom} />
        {/* (the page over the whole map, so nothing of the 3D view shows: on the Map step with its
            tools under it, the page fitting the room above them and whatever they open; on Export
            over a low sheet, staying put as the sheet's pulled up) */}
        {design && pageTools && (
          <div className="absolute inset-0 z-20 bg-zinc-950" data-testid="design-layer">
            <MapDesigner compact topInset={top} bottomInset={toolsH} />
            {!ed.designSel && <div ref={toolsAt} className="absolute inset-x-0 bottom-0 z-30"><PageTools /></div>}
          </div>
        )}
        {design && !pageTools && (
          <div className="absolute inset-0 z-20 bg-zinc-950" data-testid="design-layer">
            <div className="absolute inset-x-0 top-0" style={{ bottom: Math.min(sheetH, Math.round(mainH * 0.55)) }}>
              <MapDesigner compact topInset={top} preview={ed.step === "export"} />
            </div>
          </div>
        )}
        {!immersive && <PhoneTopBar onMenu={openApp} pages={design && pageTools} />}
        {!immersive && <GettingStarted phone />}
        {!immersive && <DrawBar bottom={bar && ed.drawPoints > 0 ? 18 : sheetH + 12} />}
        {stepRow && <StepTools onPick={setFrom} back={back} />}
        {bar && <PhoneBar faded={faded} onHeight={setBarH} mainH={mainH} from={from} />}
        {onSite ? <OnSite /> : ed.teeView && (ed.flyCam && !useCourse.getState().readOnly ? <CameraHud compact /> : <TeeViewHud compact />)}
        <ExportProgressPill top={immersive ? undefined : top + 4} bottom={immersive ? 96 : undefined} />
        {/* (above the drawing buttons when they're up) */}
        {toasts(onSite ? 340 : immersive ? (exporting ? 156 : 96) : pageTools ? 84 : sheetH + 12 + (drawBar ? 64 : 0))}
        {welcome && !immersive && (
          <div className="absolute inset-0 z-10 flex items-end justify-center px-3 pb-3 pointer-events-none" style={{ paddingTop: top }}>{welcome}</div>
        )}
        {/* (the map moved away from what's picked: back to it, over the sheet or the bar) */}
        {(sheet || bar) && away && (
          <button className="absolute left-1/2 -translate-x-1/2 z-30 h-11 px-4 rounded-full glass border border-white/10 shadow-2xl text-[14px] font-semibold text-zinc-50 flex items-center gap-2 active:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            style={{ bottom: sheetH + 12 }} onClick={() => { const id = useEditor.getState().selectedId; if (id) getView()?.frame(id); }} data-testid="back-to-it">
            <LocateFixed size={17} /> Back to it
          </button>
        )}
        {sheet && (
          <>
          <BottomSheet detent={detent} onDetent={onDetent} header={panel.header} label={panel.mode === "selection" ? "Selection" : panel.mode === "tool" ? "Tool" : "Step panel"} topGap={top + 8} onHeight={setRestH} contentKey={panel.key} locked={panel.mode === "selection" && holePicked}>
            {panel.body}
          </BottomSheet>
          </>
        )}
      </main>
      {/* (tucking away: over the map's foot, under the bar, the map already the whole screen) */}
      {navShown && <BottomNav onStep={onStep} motion={navMotion} />}
      {panel.announce}
      {menus}
    </div>
  );
}

/** The course's name at the top of a tablet's side panel (it opens the menu), with its save state
 * on a server, as a phone's top bar has them. */
function RailCourse({ onMenu }: { onMenu: () => void }) {
  const name = useCourse(s => s.doc.name);
  return (
    <div className="shrink-0 flex items-center gap-1 pl-2 pr-2 pt-2" data-testid="rail-course">
      <button className="flex-1 min-w-0 min-h-11 pl-2 text-left rounded-[12px] active:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 flex items-center gap-1" onClick={onMenu} aria-label={`${name}: open the menu`}>
        <span className="text-[15px] font-bold text-zinc-50 truncate" data-testid="course-name">{name}</span>
        <ChevronDown size={15} className="shrink-0 text-zinc-400" />
      </button>
      {SERVER && <CourseChip />}
    </div>
  );
}

/** A phone on its side (not a tablet held upright): its tools and what's picked go up the right
 * edge in the glass bar, the map keeping its height. */
const SIDEWAYS = "(max-height: 500px) and (min-aspect-ratio: 3/2)";
const sidewaysNow = () => typeof window !== "undefined" && !!window.matchMedia?.(SIDEWAYS).matches;
const onSideways = (fn: () => void) => { const m = window.matchMedia?.(SIDEWAYS); m?.addEventListener("change", fn); return () => m?.removeEventListener("change", fn); };

function RailShell({ onFindSite, onHelp, onGoTo, onContextMenu, welcome, toasts }: ShellProps) {
  const ed = useEditor();
  const readOnly = useCourse(s => s.readOnly);
  const [open, setOpen] = useState(true);
  const sideways = useSyncExternalStore(onSideways, sidewaysNow, () => false);
  const drawBar = useDrawBarShown();
  const { menus, openApp, openMore } = useMenus(onHelp, onGoTo);
  const panel = usePanel({ onFindSite, onMore: openMore });
  // (on site: the walk's own screen, over the 3D view or the map)
  const onSite = useOnSite(s => !!s.on);
  const immersive = !!ed.teeView || onSite;
  // (sideways: a tool in use or a thing picked on the bar up the right edge, not in the panel)
  const bar = sideways && !readOnly && !welcome && (panel.mode === "tool" || panel.mode === "selection") && !immersive;
  const faded = useFingerDown(bar && panel.mode === "tool");
  const [mainH, setMainH] = useState(400);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMainH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { const v = getView(); if (v) v.rightInset = bar ? 120 : 0; }, [bar]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [panel.key]);
  useEffect(() => {
    const v = getView();
    if (v) { v.rightInset = 0; v.bottomInset = 0; v.topInset = 0; }
  }, []);
  const onStep = (s: Step) => {
    setOpen(true);
    goStep(s, () => {}, () => setOpen(o => !o));
  };
  const design = (ed.step === "map" || ed.step === "export") && !ed.teeView;
  return (
    <div className="dg-compact fixed inset-0 flex bg-zinc-950 text-zinc-100 overflow-hidden isolate" data-layout="rail" onScroll={keepPut}>
      <Woods />
      {!immersive && <NavRail onStep={onStep} onMenu={openApp} panelOpen={open} onPanel={() => setOpen(o => !o)} />}
      {!immersive && open && !bar && (
        <aside className="glass dg-side w-[300px] [@media(min-height:600px)]:w-[340px] shrink-0 flex flex-col m-2 ml-2 rounded-[24px] overflow-hidden relative z-30" aria-label={panel.mode === "selection" ? "Selection" : "Step panel"} data-testid="side-sheet">
          <RailCourse onMenu={openApp} />
          <div className="shrink-0 pt-2">{panel.header}</div>
          <div ref={body} className="dg-scroll flex-1 min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{panel.body}</div>
        </aside>
      )}
      <main ref={mainRef} className="relative flex-1 min-w-0">
        <MapViewport onContextMenu={onContextMenu} compact="rail" controlsTop={8} controlsRoom={immersive || design ? 0 : 999} controlsRight={bar ? 120 : 8} />
        {bar && <PhoneBar side faded={faded} onHeight={() => {}} mainH={mainH} />}
        {design && <div className="absolute inset-0 z-20"><MapDesigner compact topInset={0} preview={ed.step === "export"} /></div>}
        {!immersive && <GettingStarted rail />}
        {!immersive && <DrawBar bottom={12} />}
        {onSite ? <OnSite /> : ed.teeView && (ed.flyCam && !useCourse.getState().readOnly ? <CameraHud compact /> : <TeeViewHud compact />)}
        <ExportProgressPill />
        {toasts(onSite ? 340 : 16 + (drawBar ? 64 : 0))}
        {welcome && !immersive && <div className="absolute inset-0 z-10 flex items-center justify-center px-3 pointer-events-none">{welcome}</div>}
      </main>
      {panel.announce}
      {menus}
    </div>
  );
}
