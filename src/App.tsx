// The app: header with the steps, the step panel, the map (2D and 3D in one view), the tools, the
// inspector for the selection, and the dialogs.
import { usePageToasts } from "./auth/Home";
import { SHOW_EVENT } from "./components/showSetting";
import { saveNow, useServerCourse } from "./auth/courses";
import { SERVER, useAuth } from "./auth/api";
import { goDemoHome, useDemoHome } from "./components/DemoHome";
import { keepPlace, placeBefore } from "./state/tabPlace";
import { HelpGuide } from "./components/help/HelpGuide";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MapPinned, Route, X } from "lucide-react";
import { Header } from "./components/Header";
import { ViewerPanel } from "./auth/ViewerPanel";
import { HolesColumn, ProblemsPanel, SidePanel } from "./components/SidePanel";
import { MapViewport } from "./components/MapViewport";
import { getView } from "./state/view";
import { Toolbar, TOOLS, CHOICE_KEYS, drawChoice, pickTool, useMapInsets, useToolbarRoom } from "./components/Toolbar";
import { treeActions, treesAt, treeTitle, underAction } from "./components/treeActions";
import { startTour } from "./components/Tour";
import { Inspector } from "./components/Inspector";
import { stepHole } from "./components/HoleSteps";
import { GoTo } from "./components/GoTo";
import { liveShowEnded, playImportShow } from "./viewport/importShow";
import { SiteImportDialog } from "./components/SiteImportDialog";
import { PerfPanel } from "./components/PerfPanel";
import { CourseFileDialog, FIND_PARK_EVENT, useCourseFile, type FindParkNear } from "./components/CourseFileDialog";
import type { GeoBounds } from "./lib/geo/core";
import { SiteReady, readyFacts, type ReadyFact } from "./components/SiteReady";
import { TeeViewHud } from "./components/TeeViewHud";
import { CameraHud } from "./components/CameraHud";
import { MapDesigner } from "./components/MapDesigner";
import { ExportProgressPill } from "./components/ExportProgress";
import { Button, HELP_EVENT } from "./components/ui";
import { GettingStarted, openGettingStarted } from "./components/GettingStarted";
import { useLayout, useTouch } from "./components/useLayout";
import { CompactShell, GroundMenu, ItemMenu } from "./components/mobile/CompactShell";
import { useCourse, useEditor, getDoc, changeDoc, type Step } from "./state/course";
import { copySelection, cutSelection, deleteSelection, duplicateSelection, nudgeSelection, pasteClipboard, select, selectAll } from "./state/actions";
import { groundActions, itemActions, type ItemAction } from "./components/itemActions";
import { allowed } from "./auth/perms";
import { osmFailedToast } from "./state/osm";
import { openExample, openRecent, restoreAutosave, startAutosave } from "./state/files";
import { EXAMPLE_ID } from "./lib/example";
import { goHome } from "./auth/AccountMenu";
import { SITE_TOKEN } from "./auth/PublicSite";
import { toast, useToasts } from "./state/toast";
import { courseStats, holeStats } from "./lib/holeStats";
import { STAND_HERE } from "./constants";
import { freshOnly, fromMaps, isImported, reframeDesign, type ImportedSite } from "./lib/importSite";
import { geoRefOf, reframe } from "./lib/geoRef";
import { Woods } from "./components/Woods";
import type { CourseDoc, CourseItem, P } from "./types";

const NO_TOASTS: ReturnType<typeof useToasts.getState>["toasts"] = [];
/** The keys that only look (all a view-only course has), by `key` upper-cased. */
const VIEW_KEYS = ["2", "3", "0", "F", "Q", "E", "N", "+", "=", "-", "_", "[", "]", "ENTER", "?", "/", "ESCAPE"];
function Toasts({ bottom }: { bottom?: number }) {
  // (a Courses page up over the editor: its own show them)
  const paged = usePageToasts(s => s.on);
  const all = useToasts(s => s.toasts);
  const toasts = paged ? NO_TOASTS : all;
  const dismiss = useToasts(s => s.dismiss);
  const undo = useCourse(s => s.undo);
  // (on a computer: just above the tools, with their options and hint, and centred on the part of
  // the map the panels leave clear)
  const tools = useToolbarRoom(s => s.height);
  const inset = useMapInsets();
  return (
    <div className={`absolute flex flex-col items-center gap-2 z-40 pointer-events-none ${bottom !== undefined ? "left-1/2 -translate-x-1/2 w-max max-w-[calc(100%-16px)]" : ""}`} style={bottom !== undefined ? { bottom } : { bottom: tools ? 16 + tools + 10 : 120, left: inset.left, right: inset.right }}>
      {toasts.map(t => (
        <div key={t.id} role="status" className={`pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2.5 touch:py-3 shadow-2xl text-sm max-w-[560px] border ${t.tone === "error" ? "bg-red-950 border-red-800 text-red-100" : t.tone === "success" ? "bg-emerald-950 border-emerald-800 text-emerald-50" : "glass border-white/[0.12] text-zinc-100"}`}>
          <span className={bottom !== undefined ? "text-[13px] leading-snug line-clamp-3" : undefined}>{t.text}</span>
          {t.undo && <button className="font-bold text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => { undo(); dismiss(t.id); }}>Undo</button>}
          {t.action && <button className="font-bold text-orange-300 hover:text-orange-200 whitespace-nowrap touch:min-h-[44px]" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button aria-label="Dismiss" className="text-zinc-400 hover:text-zinc-50 touch:w-11 touch:h-11 touch:-mr-3 touch:-my-2 touch:flex touch:items-center touch:justify-center shrink-0" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}


/** A right-click on the map: the same rows as a finger held on a phone's (`itemActions`). */
function ContextMenu({ info, onClose }: { info: { clientX: number; clientY: number; itemId: string | null; ground: P | null; under?: string | null }; onClose: () => void }) {
  const doc = getDoc();
  const hole = doc.holes.find(h => h.id === info.itemId);
  const item = doc.items.find(i => i.id === info.itemId);
  // Where it opens: down and right of the pointer, or up or left of it where there's no room
  // (measured once drawn; a screen too short for it scrolls it)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // (a press anywhere outside it closes it, the map too: heard before the map takes it)
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    // (Esc closes the menu, and only the menu: the tool and the selection stay)
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", esc, true); };
  }, [onClose]);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setAt({
      left: info.clientX + w + 8 > window.innerWidth ? Math.max(8, info.clientX - w) : info.clientX,
      top: info.clientY + h + 8 > window.innerHeight ? Math.max(8, info.clientY - h) : info.clientY
    });
  }, [info.clientX, info.clientY]);
  // (every tree the click passed through, nearest first: a sprout under a big crown is there too;
  // and what the tree stands over, to pick instead)
  const readOnly = useCourse.getState().readOnly;
  const trees = readOnly ? [] : treesAt(info.clientX, info.clientY, info.ground);
  const under = trees.length ? underAction(doc, info.under) : null;
  // The thing's own rows (the same list as a phone's), or on open ground what can start there
  // (not on a tree standing over something: that's the tree's menu)
  const rows = hole || item ? itemActions(info.itemId!, info.ground, trees.length > 0) : [];
  const ground = !hole && !item && info.ground ? groundActions(info.ground, !info.under) : null;
  const here = !!ground && !info.under && !readOnly && useEditor.getState().step === "design";
  if (!rows.length && !trees.length && !ground?.rows.length) return null;
  const row = "w-full text-left px-3 py-1.5 touch:py-3 touch:text-[15px] text-sm text-zinc-200 hover:bg-white/[0.09]";
  const run = (fn: () => void) => () => { fn(); onClose(); };
  const button = (a: ItemAction) => <button key={a.label} className={`${row} ${a.danger ? "text-red-300" : ""}`} role="menuitem" onClick={run(a.run)} data-testid={a.testid}>{a.label}</button>;
  return (
    <div ref={box} className="fixed z-50 w-52 touch:w-56 max-h-[calc(100dvh-16px)] overflow-y-auto glass-solid rounded-xl touch:rounded-2xl shadow-xl shadow-black/40 ring-1 ring-white/10 py-1" style={at ?? { left: info.clientX, top: info.clientY, visibility: "hidden" }} role="menu" onPointerDown={e => e.stopPropagation()} data-testid="map-menu">
      {ground && ground.rows.length > 0 && (
        <div className={trees.length ? "border-b border-white/[0.08] mb-1 pb-1" : ""} data-testid={here ? "map-menu-here" : undefined}>
          {ground.hole && <div className="px-3 pt-1 pb-0.5 text-[11px] text-zinc-500">{ground.hole}</div>}
          {ground.rows.map(button)}
        </div>
      )}
      {trees.map((t, n) => {
        const label = treeTitle(doc, t);
        return (
          <div key={n} className={n ? "border-t border-white/[0.08] mt-1 pt-1" : ""} data-testid="tree-menu-tree">
            <div className="px-3 pt-1 pb-0.5 text-[11px] text-zinc-500">{n === 0 && trees.length > 1 ? `${label} · in front` : label}</div>
            {treeActions(t).map(a => <button key={a.testid} className={row} role="menuitem" onClick={run(a.run)} data-testid={a.testid}>{a.label}</button>)}
          </div>
        );
      })}
      {under && <button className={`${row} border-t border-white/[0.08]`} role="menuitem" onClick={run(under.run)} data-testid={under.testid}>{under.label}</button>}
      {rows.length > 0 && <div className={trees.length ? "border-t border-white/[0.08] mt-1 pt-1" : ""}>{rows.map(button)}</div>}
    </div>
  );
}

/** What an import brought, for its toast (": photo, ground, 1,329 measured trees and 42 shapes
 * from OpenStreetMap"; the parts that didn't come left out, nothing when none did). */
function cameIn(site: ImportedSite) {
  const many = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;
  const from = (i: CourseItem) => (i as { importSource?: string }).importSource;
  const parts: string[] = [];
  if (site.background) parts.push(/^OpenStreetMap/.test(site.site.imagerySource ?? "") ? "street map" : "photo");
  if (Object.keys(site.terrainHeights).length) parts.push("ground");
  const measured = site.standing ?? site.lidar?.trees.length ?? 0;
  if (measured) parts.push(many(measured, "measured tree"));
  const photoTrees = site.trees.filter(i => from(i) === "photo").length, photoAreas = site.mapped.filter(i => from(i) === "photo").length;
  if (photoTrees || photoAreas) parts.push(`${[photoTrees ? many(photoTrees, "tree") : "", photoAreas ? many(photoAreas, "area") : ""].filter(Boolean).join(" and ")} from the photo`);
  const osm = site.mapped.filter(i => from(i) === "osm").length, osmTrees = site.trees.filter(i => from(i) === "osm").length;
  if (osm || osmTrees) parts.push(`${[osm ? many(osm, "shape") : "", osmTrees ? many(osmTrees, "tree") : ""].filter(Boolean).join(" and ")} from OpenStreetMap`);
  const traced = site.mapped.filter(i => from(i) === "traced").length;
  if (traced) parts.push(`${many(traced, "building")} traced from the air`);
  if (!parts.length) return "";
  if (parts.length === 1) return `: ${parts[0]}`;
  // (a comma before the last "and" when a part has one of its own)
  const and = parts.some(p => p.includes(" and ")) ? ", and " : " and ";
  return `: ${parts.slice(0, -1).join(", ")}${and}${parts[parts.length - 1]}`;
}

/** Ctrl+S: saved now, and said so. */
function saveByHand() {
  if (!SERVER) { toast("Saved in this browser.", "success"); return; }
  if (useCourse.getState().readOnly) { toast("This course is view only.", "info"); return; }
  void saveNow().then(
    () => { if (useServerCourse.getState().status === "saved") toast("Saved.", "success"); else toast("Not saved yet: see the save status in the top bar.", "error"); },
    e => toast(`Couldn't save: ${e instanceof Error ? e.message : "try again"}.`, "error")
  );
}

/** How a fetched site comes in: with the course mapped there, the frame's turn, the tree colours
 * picked while looking it over; `live`/`shown`: it was built in front of you already. */
type SiteOpts = { course?: boolean; turn?: number; live?: boolean; shown?: boolean; look?: { trees: string; treeMix: string[] } };

export default function App() {
  const ed = useEditor();
  // (view only: no tools to change the course with)
  const readOnly = useCourse(s => s.readOnly);
  // (and none left chosen: the map acts as Select for a viewer)
  useEffect(() => { if (readOnly && useEditor.getState().tool !== "select") useEditor.getState().set({ tool: "select", dragSelect: false }); }, [readOnly]);
  // (?timing=1: how long Hand painted's trees took to paint, each time, for measuring on a device)
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("timing")) return;
    const said = (e: Event) => { const t = (e as CustomEvent<{ trees: number; strokes: number; listing: number; painting: number; total: number; how: string }>).detail; toast(`${t.trees.toLocaleString()} trees in ${(t.total / 1000).toFixed(1)} s (${t.how}${t.strokes ? `: ${t.strokes.toLocaleString()} strokes, listed ${(t.listing / 1000).toFixed(1)} s, painted ${(t.painting / 1000).toFixed(1)} s` : ""})`, "info", false, undefined, 12000); };
    window.addEventListener("dg-tree-timing", said);
    return () => window.removeEventListener("dg-tree-timing", said);
  }, []);
  const layout = useLayout();
  const doc = useCourse(s => s.doc);
  const [findSite, setFindSite] = useState(false);
  // (the site import framed on a GPS file's holes, for a course with no site yet)
  const [findNear, setFindNear] = useState<GeoBounds | undefined>();
  useEffect(() => {
    const on = (e: Event) => { setFindNear((e as CustomEvent<FindParkNear>).detail.bounds); setFindSite(true); };
    window.addEventListener(FIND_PARK_EVENT, on);
    return () => window.removeEventListener(FIND_PARK_EVENT, on);
  }, []);
  const closeFindSite = () => {
    setFindSite(false);
    setFindNear(undefined);
    // (closed with no site: the GPS file's holes shown again, still waiting for one)
    if (useCourseFile.getState().waiting) useCourseFile.setState({ waiting: false });
  };
  // The site just brought in: what came, over the 3D view of it
  const [siteReady, setSiteReady] = useState<{ name: string; facts: ReadyFact[]; said: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === "find-site") setFindSite(true); };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  // (the help guide, open at a topic when one is asked for)
  const [help, setHelp] = useState<false | { topic?: string }>(false);
  useEffect(() => {
    const on = (e: Event) => setHelp({ topic: (e as CustomEvent).detail });
    window.addEventListener(HELP_EVENT, on);
    return () => window.removeEventListener(HELP_EVENT, on);
  }, []);
  const touchUi = useTouch();
  const [goTo, setGoTo] = useState(false);
  const [menu, setMenu] = useState<{ clientX: number; clientY: number; itemId: string | null; ground: P | null; under?: string | null } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = startAutosave();
    void (async () => {
      await restoreAutosave();
      // (a tab refreshed in a course: on the step and printout it was on)
      if (placeBefore && !(SERVER ? useAuth.getState().home : useDemoHome.getState().open)) useEditor.getState().set({ step: placeBefore.step, designTab: placeBefore.tab, tool: "select" });
      setReady(true);
    })();
    return stop;
  }, []);
  // Where the tab is, kept as it changes, for a refresh to come back to
  useEffect(() => {
    if (!ready) return;
    const keep = () => {
      const listed = SERVER ? useAuth.getState().home : useDemoHome.getState().open;
      const id = SERVER ? useServerCourse.getState().id : getDoc().id;
      const e = useEditor.getState();
      keepPlace(listed || !id ? null : { course: id, step: e.step, tab: e.designTab });
    };
    keep();
    const stops = [useAuth.subscribe(keep), useServerCourse.subscribe(keep), useDemoHome.subscribe(keep), useEditor.subscribe(keep), useCourse.subscribe(keep)];
    return () => stops.forEach(f => f());
  }, [ready]);
  // The browser's Back and Forward (a phone's back gesture too): through the steps, between a
  // course and Courses, and back to the course open before (a printout's tab or a tool isn't a
  // place of its own: Back never takes a step to undo those)
  useEffect(() => {
    if (!ready || SITE_TOKEN) return;
    type Spot = { listed: boolean; course: string | null; step: Step };
    const here = (): Spot => ({ listed: SERVER ? useAuth.getState().home : useDemoHome.getState().open, course: (SERVER ? useServerCourse.getState().id : getDoc().id) ?? null, step: useEditor.getState().step });
    let at = here(), going = false;
    history.replaceState({ ...history.state, dgSpot: at }, "");
    const moved = () => {
      if (going) return;
      const now = here();
      if (now.listed === at.listed && now.step === at.step && now.course === at.course) return;
      // (the same place: a new course given its name when first saved, or Courses as it was)
      const same = (now.listed === at.listed && now.step === at.step && (!at.course || !now.course)) || (now.listed && at.listed);
      if (same) history.replaceState({ ...history.state, dgSpot: now }, "");
      else history.pushState({ dgSpot: now }, "");
      at = now;
    };
    const went = async (e: PopStateEvent) => {
      const to = (e.state as { dgSpot?: Spot } | null)?.dgSpot;
      if (!to) return;
      going = true;
      try {
        if (to.listed) {
          if (SERVER) goHome(); else goDemoHome();
        } else {
          if (to.course && to.course !== here().course) await (!SERVER && to.course === EXAMPLE_ID ? openExample() : openRecent(to.course));
          if (SERVER) useAuth.getState().showHome(false); else useDemoHome.setState({ open: false });
          useEditor.getState().set({ step: to.step, tool: "select", teeView: null, flyover: false });
        }
      } finally {
        at = here();
        going = false;
      }
    };
    window.addEventListener("popstate", went);
    const stops = [useAuth.subscribe(moved), useServerCourse.subscribe(moved), useDemoHome.subscribe(moved), useEditor.subscribe(moved), useCourse.subscribe(moved)];
    return () => { window.removeEventListener("popstate", went); stops.forEach(f => f()); };
  }, [ready]);

  // (the whole site in view, its top up: the way its frame was turned)
  const faceTheSite = () => {
    const v = getView();
    v?.resetNorth();
    const turn = getDoc().style.rotation ?? 0;
    if (turn) v?.rotateBy(turn);
    v?.fitSite();
  };
  /** A fetched site laid into a course: what changes, and what was carried over from the design. */
  const siteInto = (d0: CourseDoc, site: ImportedSite, opts?: SiteOpts) => {
    // (the disc golf course mapped there, when asked for: its holes after the ones here)
    const mappedCourse = opts?.course && site.course?.holes.length ? site.course : null;
    // What was designed stays on the same ground when the frame grows, shrinks or moves
    const from = geoRefOf(d0);
    // (OpenStreetMap out of reach this time: what it brought in before stays)
    const keptOsm = (i: CourseItem) => !!site.osmFailed && fromMaps(i);
    const designed = d0.items.filter(i => !isImported(i) || keptOsm(i));
    const carried = from && site.site.bounds ? reframeDesign({ holes: d0.holes, items: designed }, from, { ...site.site.bounds, ...site.canvas }) : { holes: d0.holes, items: designed, outside: 0 };
    const style = opts?.turn !== undefined || opts?.look ? { ...d0.style, ...(opts?.turn !== undefined ? { rotation: opts.turn } : {}), ...(opts?.look ? { look3d: { ...d0.style.look3d, ...opts.look } } : {}) } : undefined;
    const patch: Partial<CourseDoc> = {
      canvas: site.canvas,
      gridSize: site.gridSize,
      terrainHeights: site.terrainHeights,
      terrainOriginal: undefined,
      background: site.background,
      site: mappedCourse ? { ...site.site, holesFromOsm: true } : site.site,
      groundPaint: {},
      // (named for the park only when one was found by name)
      name: d0.name === "New Disc Golf Course" && site.site.location?.label ? `${site.site.location.label.split(",")[0]} Disc Golf Course` : d0.name,
      // (the trees cut down stay cut, on the same spot on the ground)
      cutTrees: from && site.site.bounds ? d0.cutTrees?.map(reframe(from, { ...site.site.bounds, ...site.canvas })) : d0.cutTrees,
      holes: mappedCourse ? [...carried.holes, ...mappedCourse.holes] : carried.holes,
      items: [...carried.items, ...freshOnly(carried.items, [...site.mapped, ...site.trees]), ...(mappedCourse?.items ?? [])],
      lidar: site.lidar,
      // (the frame turned on the way in: the course map turned to match; the site stays north up.
      // The tree colours picked while it was looked over come with it.)
      ...(style ? { style } : {})
    };
    return { patch, carried, mappedCourse };
  };
  /** The site as it would come in, shown in the course while it's looked over (no undo step: the
   * course as it was, `d0`, is put back if it isn't brought in). */
  const onPreview = (d0: CourseDoc, site: ImportedSite, opts?: SiteOpts) => {
    useCourse.setState({ doc: { ...d0, ...siteInto(d0, site, opts).patch }, gestureStart: null });
  };
  const onImported = (site: ImportedSite, opts?: SiteOpts) => {
    const { patch, carried, mappedCourse } = siteInto(getDoc(), site, opts);
    changeDoc(() => patch);
    setFindSite(false);
    setFindNear(undefined);
    useEditor.getState().set({ step: "design", tool: "select" });
    setTimeout(() => getView()?.fitSite(), 50);
    // (a first site, on a computer: built in front of you in 3D; see viewport/importShow)
    const outside = carried.outside ? ` ${carried.outside} ${carried.outside === 1 ? "thing you drew is" : "things you drew are"} now past the site's edges.` : "";
    const name = getDoc().name.replace(/ Disc Golf Course$/, "");
    // (what came in is said once the show is over, or at once where it doesn't play)
    const ready = { name, facts: readyFacts(site, getDoc().units, mappedCourse?.holes.length ?? 0), said: `Site brought in${cameIn(site)}.${outside}` };
    // (looked over in 3D first: it was built in front of you then)
    void (opts?.live ? liveShowEnded() : opts?.shown ? Promise.resolve() : playImportShow()).finally(() => setSiteReady(ready));
    if (outside) toast(outside.trim(), "info");
    if (site.osmFailed) osmFailedToast();
  };

  // Keyboard shortcuts
  useEffect(() => {
    // (what the pointer last pressed: a control focused by a click isn't one reached with the keyboard)
    let pointed: Element | null = null;
    const onPointer = (e: PointerEvent) => { pointed = e.target as Element; };
    window.addEventListener("pointerdown", onPointer, true);
    // (the last arrow nudge: the next one soon after joins its undo step)
    let nudged: { doc: CourseDoc; at: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      // (a site being looked over before it comes in: nothing of the course is worked meanwhile)
      if (useEditor.getState().reviewing) return;
      // (a dialog open over everything, the help guide say: its keys, except ? and Esc)
      if (document.querySelector('[aria-modal="true"]') && e.key !== "?" && e.key !== "Escape") return;
      const target = e.target as HTMLElement;
      // Keys go to text fields; sliders, checkboxes and color pickers keep the shortcuts (except
      // the keys a slider uses itself)
      const input = target.tagName === "INPUT" ? (target as HTMLInputElement) : null;
      const textual = !!target.closest?.("textarea,select,[contenteditable=true]") || (!!input && !["range", "checkbox", "radio", "color", "button"].includes(input.type));
      if (textual) return;
      if (input?.type === "range" && /^(Arrow|Home|End|Page)/.test(e.key)) return;
      const s = useEditor.getState();
      const view = getView();
      // (AltGr, which types [ and ] on many keyboards, comes as Ctrl+Alt on Windows: not a shortcut)
      const mod = (e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.altKey) && !e.getModifierState?.("AltGraph");
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setGoTo(g => !g); return; }
      // (view only: only the keys that look; Ctrl+S says it's view only)
      const viewOnly = useCourse.getState().readOnly;
      if (viewOnly && mod && e.key.toLowerCase() !== "s") return;
      // (while drawing, the last point first, as Backspace does)
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) useCourse.getState().redo(); else if (!view?.undoPoint()) useCourse.getState().undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); useCourse.getState().redo(); return; }
      // (Ctrl+S: saved now)
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveByHand(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); if (s.step !== "map") duplicateSelection(); return; }
      if (mod && e.key.toLowerCase() === "c" && !s.flyover && s.step !== "map") { if (copySelection()) { e.preventDefault(); toast("Copied."); } return; }
      if (mod && e.key.toLowerCase() === "x" && !s.flyover && s.step !== "map") { e.preventDefault(); cutSelection(); return; }
      // (where the pointer is over the map; off it, next to where it was copied from)
      if (mod && e.key.toLowerCase() === "v" && !s.flyover && s.step !== "map") { e.preventDefault(); s.set({ tool: "select" }); pasteClipboard(view?.pointerGround()); return; }
      if (mod && e.key.toLowerCase() === "a" && !s.flyover && s.step !== "map") { e.preventDefault(); s.set({ tool: "select" }); selectAll(); return; }
      if (mod) return;
      // (AltGr types characters: only the [ and ] it types go on to the shortcuts)
      if (((e.ctrlKey && e.altKey) || e.getModifierState?.("AltGraph")) && e.key !== "[" && e.key !== "]") return;
      if (s.teeView) {
        // (standing there: the map's keys go on to what's picked, Delete, the tools; Esc lets go of
        // what's picked first)
        const editing = !viewOnly && !s.flyover;
        // (a thing picked there; not the hole, picked on the map before: the arrows still go to the
        // other holes, and Esc back to the map)
        const picked = (!!s.selectedId && !getDoc().holes.some(h => h.id === s.selectedId)) || s.group.length > 0;
        const mapKey = e.key === "Escape" ? picked || s.tool !== "select" : !e.key.startsWith("Arrow") || picked;
        // (Space plays the flyover and pauses it, as a video player's does)
        if (e.key === " " && s.teeView !== STAND_HERE && !s.flyCam && !picked && !e.repeat) { e.preventDefault(); s.set(s.flyover ? { flyPaused: !s.flyPaused } : { flyover: true }); return; }
        if (!(editing && mapKey)) {
        // (Esc stops a flight first, back at the tee; then leaves the tee view)
        if (e.key === "Escape") s.set(s.flyover ? { flyover: false } : { teeView: null, flyover: false });
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && s.teeView !== STAND_HERE) {
          const d = getDoc();
          const stats = courseStats(d);
          const done = d.holes.filter((_, k) => stats[k].complete);
          const i = done.findIndex(h => h.id === s.teeView);
          const next = done[(i + (e.key === "ArrowLeft" ? -1 : 1) + done.length) % done.length];
          if (next) s.set({ teeView: next.id });
        }
        return;
        }
      }
      if (viewOnly && !VIEW_KEYS.includes(e.key.toUpperCase())) return;
      // (Esc, a step at a time: the drawing, the tool, the selection, box select, the checks)
      if (e.key === "Escape") {
        if (view?.cancelDrawing()) return;
        if (s.tool !== "select") { s.set({ tool: "select" }); return; }
        if (s.selectedId || s.group.length) { select(null); return; }
        if (s.dragSelect) { s.set({ dragSelect: false }); return; }
        if (s.problemsOpen) { s.set({ problemsOpen: false }); return; }
        return;
      }
      if (e.key === "Enter") {
        if (view?.finishDrawing()) { e.preventDefault(); return; }
        // (a shape begun but too short to finish: the drawing says so itself)
        if (s.drawPoints > 0) return;
        // (on a button, a link or a menu row reached with the keyboard, Enter is that control's)
        const control = target.closest?.("button,a,summary,[role=button],[role=menuitem],[role=option],[role=radio],[role=tab]");
        if (control && !control.contains(pointed)) return;
        // The view from the tee: of the hole picked, or of the tee or basket picked (from that tee);
        // a button just clicked (a hole's row, say) isn't pressed again by it
        const d = getDoc();
        const it = d.items.find(i => i.id === s.selectedId);
        const holeId = d.holes.some(h => h.id === s.selectedId) ? s.selectedId : it && (it.type === "tee" || it.type === "basket") ? it.holeId : null;
        const hole = d.holes.find(h => h.id === holeId);
        if (hole && holeStats(d, hole).complete) { e.preventDefault(); s.set({ teeView: hole.id, teeViewTee: it?.type === "tee" ? it.id : null, flyover: false }); }
        return;
      }
      // (on the Design page, these keys are the page's: the map's selection isn't seen there)
      if (s.step === "map" && (e.key === "Backspace" || e.key === "Delete" || e.key.startsWith("Arrow"))) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        if (e.key === "Backspace" && view?.undoPoint()) { e.preventDefault(); return; }
        if (s.selectedId || s.group.length) { e.preventDefault(); deleteSelection(); }
        return;
      }
      if (e.key.startsWith("Arrow") && (s.selectedId || s.group.length)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const before = useCourse.getState().doc;
        nudgeSelection(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
        // (nudges in quick succession are one undo step, back to where the first began)
        const c = useCourse.getState();
        if (c.doc !== before) {
          const now = performance.now();
          if (nudged && nudged.doc === before && now - nudged.at < 800 && c.past[c.past.length - 1] === before) useCourse.setState({ past: c.past.slice(0, -1) });
          nudged = { doc: c.doc, at: now };
        }
        return;
      }
      if (e.key === "?") { setHelp(h => (h ? false : {})); return; }
      if (e.key === "/") { e.preventDefault(); setGoTo(true); return; }
      if ((e.key === "[" || e.key === "]") && s.step !== "map") { stepHole(e.key === "[" ? -1 : 1); return; }
      // (a viewer only to the views they may)
      if (e.key === "2") { if (allowed("map")) s.set({ view: "2d" }); return; }
      if (e.key === "3") { if (allowed("view3d")) s.set({ view: "3d" }); return; }
      if (e.key === "0") { view?.fitCourse(); return; }
      if (e.key === "+" || e.key === "=") { view?.zoomBy(1.4); return; }
      if (e.key === "-" || e.key === "_") { view?.zoomBy(1 / 1.4); return; }
      const k = e.key.toUpperCase();
      if (k === "F") { if (s.selectedId) { const d = getDoc(); if (d.holes.some(h => h.id === s.selectedId)) view?.fitHole(s.selectedId); else view?.zoomTo(s.selectedId); } return; }
      if (k === "Q") { view?.rotateBy(-30); return; }
      if (k === "E") { view?.rotateBy(30); return; }
      if (k === "N") { view?.resetNorth(); return; }
      // (the tools' letters: only where the tools are, not on the Map and Export pages)
      if (s.step === "map" || s.step === "export") return;
      const choice = CHOICE_KEYS[k] ? TOOLS.flatMap(t => t.choices ?? []).find(c => c.id === CHOICE_KEYS[k]) : undefined;
      if (choice) { drawChoice(choice, false); return; }
      const tool = TOOLS.find(t => t.key === k);
      if (tool) pickTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPointer, true); };
  }, []);

  const empty = useMemo(() => !doc.background && !doc.holes.length && !doc.items.length, [doc]);
  const showWelcome = ready && empty && ed.step === "site";
  const onContextMenu = (i: { clientX: number; clientY: number; itemId: string | null; ground: P | null; under?: string | null }) => setMenu(i);
  const welcome = (
    <div className="pointer-events-auto glass-solid rounded-2xl shadow-2xl ring-1 ring-white/10 p-6 w-[440px] max-w-full text-center" data-testid="welcome">
      <div className="w-12 h-12 rounded-xl bg-orange-500/15 text-orange-400 flex items-center justify-center mx-auto mb-3"><Route size={24} /></div>
      <h2 className="text-xl font-bold text-zinc-50">Design your disc golf course</h2>
      <div className="mt-4 flex flex-col gap-2">
        <Button tone="primary" full onClick={() => setFindSite(true)} testid="welcome-find"><MapPinned size={16} /> Find your park</Button>
        <Button full onClick={() => useEditor.getState().set({ step: "design", tool: "add-hole" })} testid="welcome-blank">Start on open ground</Button>
      </div>
      <button className="mt-3 text-[13px] font-semibold text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => (SERVER ? openGettingStarted() : void startTour())} data-testid="welcome-tour">{SERVER ? "New here? Open Getting started" : "New here? Show me around"}</button>
    </div>
  );
  const dialogs = (
    <>
      {findSite && <SiteImportDialog near={findNear} onClose={closeFindSite} onImported={onImported} onPreview={onPreview} />}
      <CourseFileDialog />
      <PerfPanel />
      {siteReady && <SiteReady {...siteReady} onLook={() => { setSiteReady(null); useEditor.getState().set({ view: "3d" }); setTimeout(() => faceTheSite(), 50); }} onStart={() => { setSiteReady(null); setTimeout(() => faceTheSite(), 50); }} />}
      {help && <HelpGuide onClose={() => setHelp(false)} topic={help.topic} touch={touchUi} />}
      {goTo && <GoTo onClose={() => setGoTo(false)} onHelp={topic => setHelp({ topic })} />}
    </>
  );

  if (layout !== "desktop") {
    return (
      <>
        <CompactShell
          layout={layout}
          onFindSite={() => setFindSite(true)}
          onHelp={() => setHelp({})}
          onGoTo={() => setGoTo(true)}
          onContextMenu={onContextMenu}
          welcome={showWelcome ? welcome : null}
          toasts={bottom => <Toasts bottom={bottom} />}
        />
        {dialogs}
        {menu?.itemId && <ItemMenu itemId={menu.itemId} at={menu} onClose={() => setMenu(null)} />}
        {menu && !menu.itemId && menu.ground && <GroundMenu info={menu} onClose={() => setMenu(null)} />}
      </>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden relative isolate">
      <Woods />
      <Header onHelp={() => setHelp({})} onGoTo={() => setGoTo(true)} />
      {!ed.teeView && <div className="fixed inset-0 pointer-events-none z-30"><div className="relative w-full h-full"><GettingStarted /></div></div>}
      <div className="flex-1 flex min-h-0 gap-2.5 p-2.5 relative">
        {readOnly ? <ViewerPanel /> : ed.step !== "design" && <SidePanel onFindSite={() => setFindSite(true)} />}
        <main className="flex-1 relative min-w-0 rounded-[20px] overflow-hidden ring-1 ring-white/10">
          <MapViewport onContextMenu={onContextMenu} />
          {(ed.step === "map" || ed.step === "export") && !ed.teeView && <MapDesigner preview={ed.step === "export"} />}
          {ed.step === "design" && !readOnly && !ed.teeView && !ed.reviewing && <HolesColumn />}
          {ed.step === "design" && !readOnly && <ProblemsPanel />}
          {/* (from a tee, only in Tap mode Select: walking, playing a flyover and editing its camera path
              draw nothing) */}
          {(ed.step === "design" || ed.step === "site") && !(ed.teeView && (ed.flyCam || ed.flyover || ed.standTap !== "edit")) ? !readOnly && !ed.reviewing && <Toolbar /> : null}
          {ed.step === "design" && !readOnly && !ed.reviewing && <Inspector />}
          {ed.teeView && (ed.flyCam && !readOnly ? <CameraHud /> : <TeeViewHud />)}
          <ExportProgressPill />
          <Toasts />
          {showWelcome && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              {welcome}
            </div>
          )}
        </main>
      </div>
      {dialogs}
      {menu && <ContextMenu info={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
