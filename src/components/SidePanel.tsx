// The side panel follows the steps: what to do now, and the lists for it. The map stays the one
// canvas; the steps never lock anything.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ChevronUp, Link2, Info, Loader2, X, ClipboardCheck, Download, Eye, EyeOff, MapPinned, Palette, Plus, Route, Trash2, Users, type LucideIcon } from "lucide-react";
import { TEE_LEVELS, TEE_ORDER, generateId, FT_PER_M } from "../constants";
import { activeLayout, holeBaskets, holeTees } from "../lib/course";
import { EXAMPLE_ID } from "../lib/example";
import { asItCame } from "../lib/importSite";
import { courseIssues, courseStats, courseTotals, levelsOnCourse, openIssues, playsOf, swapped, type HoleStats, type SafetyIssue } from "../lib/holeStats";
import { fmtArea, fmtDist, fmtElev, toUnits } from "../lib/units";
import { addLayoutTees, pickLayout, select, uncutTrees } from "../state/actions";
import { toast } from "../state/toast";
import { changeDoc, useCourse, useEditor, type Step } from "../state/course";
import { SHOW_EVENT, askOpen } from "./showSetting";
import type { CourseDoc, Layout, PinPosition, TeeLevel } from "../types";
import { refreshOsm, useOsm } from "../state/osm";
import { measureLidar } from "../state/lidar";
import { newCourse } from "../state/files";
import { sourceOf } from "../lib/importReview";
import { photoDateText } from "../lib/geo/photoSources";
import { holeLabel } from "../lib/course";
import { MeasuredTuning, type MeasuredTune } from "./MeasuredTrees";
import { getView } from "../state/view";
import { Button, FOCUS, Facts, Field, Fold, HelpLink, Section, Segmented, TextInput } from "./ui";
import { DesignPanel, TreeKinds, WoodsOptions } from "./DesignPanel";
import { CourseFileButton } from "./CourseFileDialog";
import { OnSiteButton } from "./OnSite";
import { useToolbarRoom } from "./Toolbar";
import { ExportPanel } from "./ExportPanel";
import { useLayout } from "./useLayout";
import { LockedRow } from "./DemoNote";
import { InspectorBody, PANEL_INSET, SelectionHeader, useSelection } from "./Inspector";
import { SERVER } from "../auth/api";
import { holeOf, useComments } from "../auth/Comments";
import { NearbyCourses, NearbySafety } from "../auth/Nearby";

export const STEPS: { id: Step; label: string; title: string }[] = [
  { id: "site", label: "Site", title: "Your site" },
  { id: "design", label: "Design", title: "Design" },
  { id: "map", label: "Map", title: "Map" },
  { id: "export", label: "Export", title: "Export" }
];

/** The steps' icons (the phone's step bar and rail). */
export const STEP_ICONS: Record<Step, LucideIcon> = { site: MapPinned, design: Route, map: Palette, export: Download };

/** Mouse words for a touch screen: tap instead of click, hold instead of right-click, no key letters. */
export const touchWords = (text: string) =>
  text
    .replace(/,? then double-click the other/g, ", then the other and Done")
    .replace(/Right-click/g, "Hold a finger on")
    .replace(/\b([Cc])lick(s|ing)?\b/g, (_m, c: string, end?: string) => `${c === "C" ? "T" : "t"}ap${end === "ing" ? "ping" : end ?? ""}`)
    .replace(/ \((?:[A-Z]|[A-Z] \/ [A-Z])\)$/, "");

const NextButton = ({ step }: { step: Step }) => {
  const i = STEPS.findIndex(s => s.id === step);
  const next = STEPS[i + 1];
  if (!next) return null;
  return (
    <div className="px-4 py-3 flex justify-end">
      <Button tone="ghost" onClick={() => useEditor.getState().set({ step: next.id, tool: "select" })} testid="next-step">Next: {next.label} <ArrowRight size={15} /></Button>
    </div>
  );
};

const many = (n: number, one: string, more: string) => `${n.toLocaleString()} ${n === 1 ? one : more}`;

/** The example's way to a course of your own: a new, empty one, with Find your park opened for it
 * (the example stays on the Courses page). */
const ownCourse = async () => {
  await newCourse();
  askOpen("find-site");
};

/** How far along something is: the import dialog's bar. */
const ProgressBar = ({ fraction, label }: { fraction: number; label: string }) => (
  <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.07] overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={Math.round(fraction * 100)}>
    <div className="h-full bg-orange-500 transition-[width] duration-500" style={{ width: `${fraction * 100}%` }} />
  </div>
);

/** One source in What came in: what it brought (or, in amber, what went wrong) and its actions. */
const CameRow = ({ text, sub, warn, children, testid }: { text: ReactNode; sub?: ReactNode; warn?: boolean; children?: ReactNode; testid?: string }) => (
  <div className="py-1.5 border-t border-white/[0.07] first:border-t-0" data-testid={testid}>
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className={`text-xs flex items-center gap-1.5 ${warn ? "text-amber-200" : "text-zinc-200"}`}>{warn && <AlertTriangle size={13} className="text-amber-400 shrink-0" />}{text}</div>
        {sub && <div className="text-[11px] text-zinc-500 truncate">{sub}</div>}
      </div>
      {children && <div className="flex gap-1 shrink-0">{children}</div>}
    </div>
  </div>
);

/** What came in by itself (from the measured trees, the photo, OpenStreetMap, traced from the
 * air), worked out from the course as it is now: a row each, with what can be done about it.
 * Remove takes out what is as it came (changed by hand, it's yours); Undo puts it back. */
function CameIn() {
  const doc = useCourse(s => s.doc);
  const lidarBusy = useEditor(e => e.lidarBusy);
  const osmBusy = useOsm(s => s.busy);
  type Item = (typeof doc.items)[number];
  const placed = !!doc.site.bounds;
  const came = (f: (i: Item) => boolean) => (i: Item) => f(i) && asItCame(i);
  const fromPhoto = came(i => (i.type === "tree" || i.type === "area") && i.importSource === "photo");
  const fromOsm = came(i => (i.type === "area" || i.type === "line" || i.type === "structure") && i.importSource === "osm");
  const traced = came(i => i.type === "structure" && i.importSource === "traced");
  // (underbrush: woods with bushes under them, from the survey and satellite; a stand: woods an
  // older import made from the measured trees)
  const brush = came(i => sourceOf(i) === "underbrush");
  const stand = came(i => i.type === "area" && i.importSource === "lidar" && sourceOf(i) !== "underbrush");
  const fromGov = came(i => (i.type === "area" || i.type === "line" || i.type === "structure") && (i.importSource === "usgs" || i.importSource === "nwi" || i.importSource === "fema"));
  const count = (f: (i: Item) => boolean) => doc.items.filter(f).length;
  const photoTrees = count(i => i.type === "tree" && fromPhoto(i));
  const photoAreas = count(i => i.type === "area" && fromPhoto(i));
  const stands = count(stand), brushN = count(brush), osm = count(fromOsm), air = count(traced), gov = count(fromGov);
  const notes = doc.site.notes ?? [];
  const remove = (out: (i: Item) => boolean, said: string) => { changeDoc(d => ({ items: d.items.filter(i => !out(i)) })); toast(said, "info", true); };
  const lidar = doc.lidar;
  const site = doc.site;
  const measuring = lidarBusy !== null;
  const lidarRow = lidar || (placed && (site.noLidar || site.lidarFailed));
  const osmRow = placed || osm > 0;
  if (!lidarRow && !stands && !brushN && !photoTrees && !photoAreas && !site.tilesMissing && !osmRow && !air && !gov && !notes.length) return null;
  const summer = lidar?.fromPhoto ?? 0;
  const warned = (!lidar && (site.noLidar || site.lidarFailed)) || site.tilesMissing || (site.osmFailed && !osm);
  return (
    <Fold testid="came-in" title={<span className="inline-flex items-center gap-1.5">What came in {warned && <AlertTriangle size={13} className="text-amber-400" aria-label="Something didn't come in" />}<HelpLink topic="brought-in" label="What came in" /></span>}>
      <div data-testid="brought-in">
        {lidarRow && (
          <CameRow testid="lidar-info"
            text={lidar ? many(lidar.trees.length, "measured tree", "measured trees") : site.noLidar ? "No aerial survey covers this spot" : "Couldn't read the aerial survey"}
            sub={lidar ? lidar.source : undefined} warn={!lidar}>
            {!measuring && placed && <Button small onClick={() => void measureLidar()} testid="measure-lidar">{lidar ? "Measure again" : site.noLidar ? "Check again" : "Try again"}</Button>}
            {!measuring && lidar && <Button small tone="danger" onClick={() => { changeDoc(d => ({ lidar: undefined, items: d.items.filter(i => !(i.type === "tree" && i.importSource === "lidar" && asItCame(i))), site: { ...d.site, noLidar: undefined, lidarFailed: undefined } })); toast("Took out the measured trees and bushes.", "info", true); }} testid="remove-lidar">Remove</Button>}
          </CameRow>
        )}
        {measuring && lidarRow && <div data-testid="lidar-busy" className="pb-1.5"><ProgressBar fraction={lidarBusy} label="Measuring trees and ground" /></div>}
        {summer > 0 && (
          <CameRow testid="from-photo" text={`${many(summer, "tree", "trees")} filled in from the summer photo`} sub="Bare trees the survey missed">
            <Button small tone="danger" onClick={() => {
              changeDoc(d => {
                if (!d.lidar?.fromPhoto) return {};
                // (they're the last ones: the measured trees, and which are kept or taken out, stay)
                const n = d.lidar.trees.length - d.lidar.fromPhoto, within = (k: number) => k < n;
                return { lidar: { ...d.lidar, trees: d.lidar.trees.slice(0, n), fromPhoto: undefined, kept: d.lidar.kept?.filter(within), removed: d.lidar.removed?.filter(within) } };
              });
              toast("Took out the trees from the summer photo.", "info", true);
            }}>Remove</Button>
          </CameRow>
        )}
        {brushN > 0 && (
          <CameRow testid="brush-found" text={`${many(brushN, "patch", "patches")} of underbrush`} sub="From the survey and satellite">
            <Button small tone="danger" onClick={() => remove(brush, "Took out the underbrush that came in.")}>Remove</Button>
          </CameRow>
        )}
        {stands > 0 && (
          <CameRow testid="stands-found" text={`${many(stands, "stand", "stands")} of woods from the measured trees`}>
            {/* (the measured trees stay, each on its own) */}
            <Button small tone="danger" onClick={() => remove(stand, "Took out the woods made from the measured trees. The trees stay.")}>Remove</Button>
          </CameRow>
        )}
        {(photoTrees > 0 || photoAreas > 0) && (
          <CameRow testid="photo-found" text={`${[photoAreas ? many(photoAreas, "area", "areas") : "", photoTrees ? many(photoTrees, "tree", "trees") : ""].filter(Boolean).join(" and ")} from the photo`}>
            <Button small tone="danger" onClick={() => remove(fromPhoto, "Took out what came from the photo.")}>Remove</Button>
          </CameRow>
        )}
        {site.tilesMissing && <CameRow testid="tiles-missing" warn text="Some map tiles were missing" />}
        {osmRow && (
          <CameRow testid="osm-found" warn={!!site.osmFailed && !osm} text={osm ? `${many(osm, "shape", "shapes")} from OpenStreetMap` : site.osmFailed ? "Couldn't reach OpenStreetMap" : "Nothing from OpenStreetMap"}>
            {osmBusy
              ? <span className="text-xs text-zinc-300 inline-flex items-center gap-1.5 px-1 py-1" data-testid="osm-busy"><Loader2 size={13} className="animate-spin text-orange-300" /> Looking up…</span>
              : placed && <Button small onClick={() => void refreshOsm()} testid="refresh-osm" title="Update paths, roads, water and buildings">{site.osmFailed && !osm ? "Try again" : "Update"}</Button>}
            {!osmBusy && osm > 0 && <Button small tone="danger" onClick={() => remove(fromOsm, "Took out what came from OpenStreetMap.")}>Remove</Button>}
          </CameRow>
        )}
        {air > 0 && (
          <CameRow testid="traced-found" text={`${many(air, "building", "buildings")} traced from the air`}>
            <Button small tone="danger" onClick={() => remove(traced, "Took out the buildings traced from the air.")}>Remove</Button>
          </CameRow>
        )}
        {gov > 0 && (
          <CameRow testid="gov-found" text={`${many(gov, "creek, wetland or building", "creeks, wetlands and buildings")} from the US maps`} sub="USGS, USFWS, FEMA">
            <Button small tone="danger" onClick={() => remove(fromGov, "Took out what came from the US maps.")}>Remove</Button>
          </CameRow>
        )}
        {notes.length > 0 && (
          <details className="py-1.5 border-t border-white/[0.07] first:border-t-0 text-xs text-zinc-400" data-testid="import-notes">
            <summary className="cursor-pointer text-zinc-200 hover:text-zinc-50">What the import found ({notes.length})</summary>
            <ul className="mt-1.5 flex flex-col gap-1 list-disc pl-4 leading-snug">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>
          </details>
        )}
      </div>
    </Fold>
  );
}

/** The course's trees, on the Site step (what grows here belongs to the place): the kinds the woods
 * and measured trees grow, in 3D and on the map alike, then the measured trees' own settings. */
function SiteTrees() {
  const doc = useCourse(s => s.doc);
  const any = !!doc.lidar?.trees.length || !!doc.site.bounds || doc.items.some(i => i.type === "tree" || (i.type === "area" && i.kind === "woods"));
  // (always here: where the woods grow is set here even before there are any)
  return (
    <Fold testid="site-trees" title={<span className="inline-flex items-center gap-1.5">Trees <HelpLink topic="site-trees" label="Trees" /></span>}>
      {any && <div className="-mt-3"><TreeKinds s={doc.style} /></div>}
      {/* (where the woods grow and how thick: the 3D map's, and the illustrated map draws the same) */}
      <WoodsOptions s={doc.style} measured={!!doc.lidar?.trees.length} />
      <MeasuredSettings />
    </Fold>
  );
}

/** The measured trees' own settings: which are left out, growth since the survey, the ones cut
 * down by hand, the fairways cleared (the course's switch sets every hole; a hole's own can differ). */
function MeasuredSettings() {
  const doc = useCourse(s => s.doc);
  const lidar = doc.lidar;
  if (!lidar || !lidar.trees.length) return null;
  // (trees placed by hand standing on a measured one: the survey has them already)
  const doubled = doc.items.filter(i => i.type === "tree" && !i.importSource && lidar.trees.some(t => Math.hypot(t[0] - i.x, t[1] - i.y) < Math.max(6, t[3] * 0.5)));
  // (holes whose own switch differs from the course's)
  const own = doc.holes.filter(h => h.clearTrees !== undefined && h.clearTrees !== (lidar.clearFairways === true));
  const ownSaid = own.length > 3 ? `${own.length} holes` : `hole${own.length === 1 ? "" : "s"} ${own.map(h => holeLabel(doc, h.id)).join(", ").replace(/, ([^,]*)$/, " and $1")}`;
  const everyHole = (d: CourseDoc) => (d.holes.some(h => h.clearTrees !== undefined) ? { holes: d.holes.map(h => (h.clearTrees === undefined ? h : { ...h, clearTrees: undefined })) } : {});
  const change = (patch: MeasuredTune, done: boolean) => {
    if ("clearFairways" in patch) {
      // (the course's switch: every hole takes it)
      const v = patch.clearFairways === true;
      changeDoc(d => (d.lidar ? { lidar: { ...d.lidar, clearFairways: v ? true : undefined }, ...everyHole(d) } : {}));
      toast(v ? "Trees on every hole's fairway, tees and basket are cut down. A hole's own switch leaves its trees standing." : "Trees on the fairways are standing again.", "info", true);
      return;
    }
    const { saplings: young, clearFairways: _course, ...rest } = patch;
    changeDoc(d => (d.lidar ? { lidar: { ...d.lidar, ...rest, ...("saplings" in patch ? { saplings: young ? (true as const) : undefined } : {}) } } : {}), done);
  };
  return (
    <div className="mt-4" data-testid="lidar-settings">
      <div className="text-[13px] font-semibold text-zinc-200 mb-1.5 flex items-center gap-1.5">Measured trees <HelpLink topic="lidar-settings" label="Measured trees" /></div>
      <MeasuredTuning trees={lidar.trees} source={lidar.source} units={doc.units} onChange={change} onDone={() => useCourse.getState().commit()}
        value={{ minHeight: lidar.minHeight, crownSize: lidar.crownSize, growYears: lidar.growYears, saplings: lidar.saplings, clearFairways: lidar.clearFairways }}
        notes={<>
          {(doc.cutTrees?.length ?? 0) > 0 && (
            <div className="mt-2 text-[11px] text-zinc-400" data-testid="cut-by-hand">{doc.cutTrees!.length} sapling{doc.cutTrees!.length === 1 ? "" : "s"} or planted tree{doc.cutTrees!.length === 1 ? "" : "s"} cut down by hand · <button className="text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={uncutTrees}>Bring them back</button></div>
          )}
          {doubled.length > 0 && (
            <div className="mt-2 text-[11px] text-zinc-400" data-testid="doubled-trees">{doubled.length} tree{doubled.length === 1 ? "" : "s"} placed by hand stand{doubled.length === 1 ? "s" : ""} on a measured one · <button className="text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => { const ids = new Set(doubled.map(i => i.id)); changeDoc(d => ({ items: d.items.filter(i => !ids.has(i.id)) })); toast(`Took out ${doubled.length === 1 ? "the tree" : `${doubled.length} trees`} placed by hand.`, "info", true); }}>Remove those placed by hand</button></div>
          )}
        </>}
        after={own.length > 0 && (
          <div className="text-[11px] touch:text-[12.5px] text-zinc-400 -mt-1" data-testid="clear-own">{lidar.clearFairways === true ? "Not on" : "Only on"} {ownSaid} · <button className="text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => changeDoc(everyHole)} data-testid="clear-same">Same for every hole</button></div>
        )} />
    </div>
  );
}

function SiteStep({ onFindSite }: { onFindSite: () => void }) {
  const doc = useCourse(s => s.doc);
  const lidarBusy = useEditor(e => e.lidarBusy);
  // (a phone's or a tablet's header has Find your park)
  const compact = useLayout() !== "desktop";
  const set = (patch: Partial<typeof doc>, history = true) => changeDoc(() => patch, history);
  const typed = () => useCourse.getState().commit();
  const relief = useMemo(() => {
    const v = Object.values(doc.terrainHeights);
    return v.length ? Math.max(0, ...v) - Math.min(0, ...v) : 0;
  }, [doc.terrainHeights]);
  const u = doc.units;
  // (the example: no real park behind it, so a course of your own is the way to one)
  const example = doc.id === EXAMPLE_ID;
  const placed = !!doc.site.bounds;
  // (ground to tell about: a site brought in, or the example's own)
  const facts = placed || !!doc.background || !!doc.lidar;
  // (nothing yet: the welcome card over the map has Find your park)
  const empty = !doc.background && !doc.holes.length && !doc.items.length;
  // (the picture under the map: a street map, or a photo; its pixel size no longer said)
  const picture = doc.site.imagerySource?.replace(/ \(~\d+ cm\/pixel\)$/, "");
  const street = !!picture && /^OpenStreetMap/.test(picture);
  // (measured trees not looked for yet: the way to them, before what came in)
  const offerLidar = placed && !doc.lidar && !doc.site.noLidar && !doc.site.lidarFailed;
  return (
    <>
      {example ? (
        <Section title="Example course" testid="example-site" help="example-course">
          {/* (it opens Find your park for the new course: the help's "Find your park" points here) */}
          <div data-testid="find-site">
            <Button tone="primary" full onClick={ownCourse} testid="example-new-course"><Plus size={16} /> Start your own course</Button>
          </div>
        </Section>
      ) : !placed && (
        <Section>
          <div className="flex flex-col items-start gap-1.5">
            {!compact && !empty && <Button tone="primary" full onClick={onFindSite} testid="find-site"><MapPinned size={16} /> Find your park</Button>}
            <span className="inline-flex items-center gap-1.5"><CourseFileButton /><HelpLink topic="gps-holes" label="Holes from a GPS file" /></span>
          </div>
        </Section>
      )}
      {facts && (
        <Section title="Site" testid="site-info">
          {placed && doc.site.location && (
            <Field label="Place name" help="place-name">
              <TextInput label="Place name" value={doc.site.location.label} placeholder="The park's name" onChange={v => changeDoc(d => ({ site: { ...d.site, location: d.site.location ? { ...d.site.location, label: v } : null } }), false)} onDone={typed} />
            </Field>
          )}
          <Facts testid="site-facts" items={[
            ["Size", `${fmtDist(doc.canvas.width, u, false)} × ${fmtDist(doc.canvas.height, u)}`],
            ["Area", fmtArea(doc.canvas.width * doc.canvas.height, u)],
            ["Lowest point", `${Math.round(toUnits(doc.site.baseElevationFt, u)).toLocaleString()} ${u}`],
            ["Climb", fmtDist(relief, u)]
          ]} />
          {(doc.site.elevationSource || picture) && (
            <div className="mt-1.5 text-xs text-zinc-400 space-y-0.5">
              {doc.site.elevationSource && <div>Elevation: {doc.site.elevationSource}</div>}
              {picture && <div data-testid="site-photo">{street ? "Street map" : `Photo: ${picture}${doc.site.photo?.date ? `, ${photoDateText(doc.site.photo)}` : ""}`}</div>}
            </div>
          )}
          {placed && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button small onClick={onFindSite} testid="resize-site">Change the area</Button>
              {!example && <span className="inline-flex items-center gap-1.5"><CourseFileButton /><HelpLink topic="gps-holes" label="Holes from a GPS file" /></span>}
            </div>
          )}
          {offerLidar && (
            <div className="mt-3 rounded-[16px] bg-orange-500/[0.12] ring-1 ring-orange-400/30 p-3" data-testid="lidar-offer">
              <div className="text-[13.5px] font-semibold text-orange-100 mb-1.5 flex items-center gap-1.5">Measured trees and ground <HelpLink topic="lidar" label="Measured trees and ground" /></div>
              {lidarBusy !== null
                ? <div data-testid="lidar-busy"><div className="text-xs text-zinc-300">Measuring trees and ground…</div><ProgressBar fraction={lidarBusy} label="Measuring trees and ground" /></div>
                : <Button small onClick={() => void measureLidar()} testid="measure-lidar">Measure trees and ground</Button>}
            </div>
          )}
        </Section>
      )}
      <CameIn />
      <SiteTrees />
      <Section title="Course">
        <Field label="Course name"><TextInput label="Course name" value={doc.name} onChange={v => set({ name: v }, false)} onDone={typed} /></Field>
        <Field label="Designer"><TextInput label="Designer" value={doc.designer} placeholder="Your name or club" onChange={v => set({ designer: v }, false)} onDone={typed} /></Field>
        <Field label="Distances in">
          <Segmented label="Units" value={doc.units} onChange={v => set({ units: v })} options={[{ value: "ft", label: "Feet" }, { value: "m", label: "Meters" }]} />
        </Field>
      </Section>
      {SERVER ? <NearbyCourses /> : (
        <Section title="Park" testid="nearby">
          <div className="rounded-[16px] bg-white/[0.06] overflow-hidden"><LockedRow id="park" icon={<Users size={16} />} label="Other courses in this park" sub="Shown on this map, with a warning when holes get too close" /></div>
        </Section>
      )}
      <NextButton step="site" />
    </>
  );
}

/** The layout picked, where its holes have no tee of its color: they play from another one (so the
 * layout plays like it), and its tees can be added to them all at once. */
function LayoutGaps({ compact = false }: { compact?: boolean }) {
  const doc = useCourse(s => s.doc);
  const layout = doc.layouts.length > 1 ? activeLayout(doc) : undefined;
  if (!layout) return null;
  const missing = doc.holes.filter(h => { const t = holeTees(doc, h.id); return t.length > 0 && !t.some(x => x.level === layout.tee); }).length;
  if (!missing) return null;
  const color = TEE_LEVELS[layout.tee].label.toLowerCase();
  const all = missing === doc.holes.length;
  return (
    <div className={`text-[11.5px] leading-snug text-zinc-300 ${compact ? "px-1 pt-1.5" : "mt-1 mb-2"}`} data-testid="layout-gaps">
      {`${missing} hole${missing === 1 ? " has" : "s have"} no ${color} tee`}
      <button className="block mt-1 font-semibold text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => { const n = addLayoutTees(layout.tee); if (n) toast(`Added ${n} ${color} tee${n === 1 ? "" : "s"}.`, "success", true); }} data-testid="layout-add-tees">Add {color} tees to {all ? "every hole" : missing === 1 ? "that hole" : "those holes"}</button>
    </div>
  );
}

/** The layouts to pick from (the one worked on: its tees and pins stand out on the map); `slim`:
 * just each one's tee color, its name in the tip. */
export function LayoutPicker({ compact = false, slim = false }: { compact?: boolean; slim?: boolean }) {
  const doc = useCourse(s => s.doc);
  if (doc.layouts.length < 2) return null;
  return (
    <>
    <div role="radiogroup" aria-label="Layout" data-testid="layout-picker" className={`flex flex-wrap gap-1 ${compact ? "" : "mb-2"}`}>
      {doc.layouts.map(l => {
        const on = l.id === doc.activeLayout;
        return (
          <button key={l.id} role="radio" aria-checked={on} onClick={() => pickLayout(l.id)}
            title={`${l.name}: ${TEE_LEVELS[l.tee].label.toLowerCase()} tees to pin ${l.pin}`} aria-label={slim ? l.name : undefined}
            className={`flex items-center gap-1.5 rounded-full py-1 text-[12px] font-semibold min-w-0 touch:py-2 ${slim ? "w-full justify-center px-1" : "px-2.5"} ${on ? "bg-white/[0.18] text-zinc-50 ring-1 ring-white/25" : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.07]"}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/40" style={{ background: TEE_LEVELS[l.tee].color }} />
            {!slim && <span className="truncate">{l.name}</span>}
          </button>
        );
      })}
    </div>
    {!slim && <LayoutGaps compact={compact} />}
    </>
  );
}

function LayoutEditor({ open, setOpen, picker = true }: { open: boolean; setOpen: (f: (o: boolean) => boolean) => void; picker?: boolean }) {
  const doc = useCourse(s => s.doc);
  const setLayouts = (layouts: Layout[], history = true) => changeDoc(() => ({ layouts }), history);
  const remove = (l: Layout) => {
    changeDoc(d => ({ layouts: d.layouts.filter(x => x.id !== l.id), activeLayout: d.activeLayout === l.id ? d.layouts.find(x => x.id !== l.id)!.id : d.activeLayout }));
    toast(`Removed the ${l.name || "unnamed"} layout.`, "info", true);
  };
  return (
    <Section title="Layouts" help="layouts" right={<button className="text-xs text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => setOpen(o => !o)}>{open ? "Done" : "Edit layouts"}</button>}>
      {picker && <LayoutPicker />}
      {open && (
        <div className="mt-2 space-y-2" data-testid="layout-editor">
          {doc.layouts.map(l => (
            <div key={l.id} className="bg-white/[0.07] rounded-lg p-2 space-y-1.5">
              <div className="flex gap-1.5">
                {/* (typed: one undo step for the whole name, once it's done) */}
                <TextInput label="Layout name" value={l.name} onChange={v => setLayouts(useCourse.getState().doc.layouts.map(x => (x.id === l.id ? { ...x, name: v } : x)), false)} onDone={() => useCourse.getState().commit()} />
                {doc.layouts.length > 1 && <button aria-label="Remove layout" className="text-zinc-400 hover:text-red-400 px-1 touch:min-w-[44px] touch:flex touch:items-center touch:justify-center" onClick={() => remove(l)}><Trash2 size={14} /></button>}
              </div>
              <Segmented label="Layout tees" value={l.tee} onChange={v => setLayouts(doc.layouts.map(x => (x.id === l.id ? { ...x, tee: v as TeeLevel } : x)))} options={TEE_ORDER.map(t => ({ value: t, label: <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full ring-1 ring-black/40 shrink-0" style={{ background: TEE_LEVELS[t].color }} />{TEE_LEVELS[t].label}</span>, title: `${TEE_LEVELS[t].label} tees` }))} />
              <Segmented label="Layout pins" value={l.pin} onChange={v => setLayouts(doc.layouts.map(x => (x.id === l.id ? { ...x, pin: v as PinPosition } : x)))} options={(["A", "B", "C", "D"] as PinPosition[]).map(p => ({ value: p, label: p, title: `Pin ${p}` }))} />
            </div>
          ))}
          <Button small onClick={() => {
            const id = `layout-${generateId()}`;
            const used = new Set(doc.layouts.map(l => l.tee));
            const tee = TEE_ORDER.find(t => !used.has(t)) ?? "white";
            changeDoc(d => ({ layouts: [...d.layouts, { id, name: TEE_LEVELS[tee].label, tee, pin: "A" }] }));
            pickLayout(id);
          }}><Plus size={14} /> Add a layout</Button>
        </div>
      )}
    </Section>
  );
}

/** A hole in a list (the computer's column, a phone's or a tablet's panel): its number in its tee
 * color, then its length and par once it has a tee and a basket (or what it needs), its worst
 * check, a dot for each tee color and a link when its basket is shared. `slim`:
 * just the number (the rest for the tooltip and screen readers); `roomy`: its name too, when it
 * has one. */
function HoleRow({ s, check, slim = false, roomy = false }: { s: HoleStats; check?: SafetyIssue; slim?: boolean; roomy?: boolean }) {
  const doc = useCourse(st => st.doc);
  const sel = useEditor(e => e.selectedId === s.holeId || e.activeHoleId === s.holeId);
  const hole = doc.holes.find(h => h.id === s.holeId);
  if (!hole) return null;
  const u = doc.units;
  const name = hole.name || `Hole ${s.label}`;
  const what = s.complete ? `${fmtDist(s.length, u)} · Par ${s.par}` : s.teeId ? "Needs a basket" : "Needs a tee";
  const tees = holeTees(doc, s.holeId);
  const shared = holeBaskets(doc, s.holeId).some(b => b.holeId !== s.holeId || !!b.alsoHoles?.length);
  // (its open comments, on a GlideLine Studio server: blue when one is new for you)
  const threads = useComments(c => c.threads);
  const talk = SERVER ? threads.filter(t => !t.resolvedAt && holeOf(t, doc) === s.holeId) : [];
  const fresh = talk.some(t => t.unread);
  return (
    <button data-testid="hole-row" title={`${name}${slim ? ` · ${what}` : ""}${check ? ` · ${check.text}` : ""}`}
      onClick={() => { select(s.holeId); requestAnimationFrame(() => getView()?.reveal(s.holeId)); }}
      className={`w-full flex items-center gap-2 rounded-[14px] text-left transition-colors ${FOCUS} ${roomy ? "px-2 py-1.5 touch:min-h-[44px]" : slim ? "py-1 justify-center px-1" : "py-1 pl-1 pr-2"} ${sel ? "bg-white/[0.16] text-zinc-50" : "text-zinc-300 hover:bg-white/[0.07]"}`}>
      <span className="relative shrink-0">
        <span className="min-w-[24px] h-6 px-1 rounded-full flex items-center justify-center text-[11.5px] font-bold whitespace-nowrap" style={{ background: TEE_LEVELS[s.level].color, color: TEE_LEVELS[s.level].ink }} data-testid="hole-badge">{s.label}</span>
        {talk.length > 0 && <span className={`absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-[3px] rounded-full grid place-items-center text-[9.5px] font-extrabold ring-2 ring-[#161c15] ${fresh ? "bg-sky-400 text-sky-950" : "bg-amber-100 text-amber-950"}`} title={`${talk.length} open comment${talk.length === 1 ? "" : "s"}${fresh ? ", new for you" : ""}`} data-testid="hole-comments">{talk.length}</span>}
      </span>
      <span className={slim ? "sr-only" : "flex-1 min-w-0"}>
        {roomy && hole.name && <span className="block text-sm text-zinc-100 truncate">{hole.name}</span>}
        <span className="block text-[12.5px] tabular-nums truncate">{what}</span>
      </span>
      {!slim && <CheckDot check={check} />}
      {!slim && (tees.length > 1 || shared) && (
        <span className="flex items-center gap-0.5 shrink-0" data-testid="hole-row-marks">
          {tees.length > 1 && tees.map(t => <span key={t.id} className="w-1.5 h-1.5 rounded-full ring-1 ring-black/40" style={{ background: TEE_LEVELS[t.level].color }} title={`${TEE_LEVELS[t.level].label} tee`} />)}
          {shared && <Link2 size={11} className="text-zinc-400 ml-0.5" aria-label="Shares its basket with another hole" />}
        </span>
      )}
    </button>
  );
}

/** The end of a hole list: a new hole (the Hole tool). */
function NewHoleRow({ slim = false, roomy = false }: { slim?: boolean; roomy?: boolean }) {
  const on = useEditor(e => e.tool === "add-hole");
  return (
    <button data-testid="new-hole" title="New hole (H)" aria-label="New hole" onClick={() => useEditor.getState().set({ tool: "add-hole" })}
      className={`w-full flex items-center gap-2 rounded-[14px] text-[12.5px] font-semibold ${FOCUS} ${roomy ? "px-2 py-1.5 touch:min-h-[44px]" : slim ? "py-1 justify-center px-1" : "py-1 pl-1 pr-2"} ${on ? "bg-orange-500 text-zinc-950" : "text-orange-300"}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${on ? "bg-zinc-950/20" : "bg-orange-500 text-zinc-950"}`}><Plus size={14} /></span>{!slim && "New hole"}
    </button>
  );
}

/** The course's numbers: holes, par, length, walking, climb, the average hole and the pars. */
function CourseFacts({ doc, stats }: { doc: CourseDoc; stats: HoleStats[] }) {
  const totals = courseTotals(doc, stats);
  const u = doc.units;
  if (!totals.complete) return null;
  return (
    <>
      <Facts testid="course-totals" items={[["Holes", totals.complete], ["Par", totals.par], ["Length", fmtDist(totals.length, u)], ["Walking", fmtDist(totals.walk, u)], ["Climb", fmtDist(totals.climb, u)]]} />
      <p className="text-xs text-zinc-500 mt-1">{`Average hole ${fmtDist(totals.length / totals.complete, u)} · ${Object.entries(totals.parCounts).sort(([a], [b]) => Number(a) - Number(b)).map(([p, n]) => `${n} par ${p}${n === 1 ? "" : "s"}`).join(", ")}`}</p>
    </>
  );
}

/** The holes as a table: par, length, plays like, elevation; a row flies to its hole. */
function HolesTable({ doc, stats }: { doc: CourseDoc; stats: HoleStats[] }) {
  const u = doc.units;
  const go = (id: string) => { select(id); requestAnimationFrame(() => getView()?.reveal(id)); };
  return (
    <table className="w-full text-xs text-zinc-300 tabular-nums" data-testid="review-table">
      <thead className="text-zinc-500 text-[10px] uppercase">
        <tr><th className="text-left font-semibold">#</th><th className="text-right font-semibold">Par</th><th className="text-right font-semibold">Length</th><th className="text-right font-semibold">Plays</th><th className="text-right font-semibold">Elev</th></tr>
      </thead>
      <tbody>
        {stats.map(s => (
          <tr key={s.holeId} tabIndex={0} aria-label={`Hole ${s.label}`} className={`hover:bg-white/[0.09] cursor-pointer touch:h-11 ${FOCUS}`} onClick={() => go(s.holeId)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); go(s.holeId); } }}>
            <td className="py-0.5">{s.label}</td>
            <td className="text-right">{s.complete ? s.par : "–"}</td>
            <td className="text-right">{s.complete ? fmtDist(s.length, u, false) : "–"}</td>
            <td className="text-right">{s.complete ? fmtDist(s.playsLike, u, false) : "–"}</td>
            <td className="text-right">{s.complete ? fmtElev(s.elevationChange, u).replace(` ${u}`, "") : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The holes: the layouts, each hole to pick, a new one, the course's numbers (a phone's or a
 * tablet's panel). `course`: only what is the whole course's, with the holes as a table (the
 * computer's totals card; its column has the list). */
export function HolesStep({ course = false }: { course?: boolean }) {
  const doc = useCourse(s => s.doc);
  const stats = useMemo(() => courseStats(doc), [doc]);
  // (a hole with two numbers counts twice, as on the scorecard)
  const played = doc.holes.reduce((n, h) => n + playsOf(doc, h.id), 0);
  // One layout: no switcher above the list, its editor a link in the list's header
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const oneLayout = doc.layouts.length < 2 && !layoutsOpen;
  const checks = useHoleChecks();
  const levels = levelsOnCourse(doc);
  return (
    <>
      {!oneLayout && <LayoutEditor open={layoutsOpen} setOpen={setLayoutsOpen} picker={!course} />}
      <Section title={`${played} hole${played === 1 ? "" : "s"}`} testid={course ? "course-holes" : "hole-list"} right={oneLayout ? <button className="text-xs text-orange-300 hover:text-orange-200 touch:min-h-[44px]" onClick={() => setLayoutsOpen(true)}>Edit layouts</button> : undefined}>
        {!course && (
          <ol className="space-y-0.5">
            {stats.map(s => <li key={s.holeId}><HoleRow s={s} check={checks.get(s.holeId)} roomy /></li>)}
            <li><NewHoleRow roomy /></li>
            <li><CourseFileButton row /></li>
            <li><OnSiteButton row /></li>
          </ol>
        )}
        <div className={course ? "" : "mt-3"}><CourseFacts doc={doc} stats={stats} /></div>
        {course && levels.length > 0 && <p className="text-[11px] text-zinc-500 mt-1">Tee colors: {levels.map(l => TEE_LEVELS[l].label).join(", ")}</p>}
      </Section>
      {course && doc.holes.length > 0 && <Section title="Holes"><HolesTable doc={doc} stats={stats} /></Section>}
    </>
  );
}

const IssueIcon = ({ level }: { level: SafetyIssue["level"] }) => (
  level === "info" ? <Info size={14} className="text-sky-400 shrink-0 mt-0.5" /> : <AlertTriangle size={14} className={`${level === "danger" ? "text-red-400" : "text-amber-400"} shrink-0 mt-0.5`} />
);

/** The worst first: problems, then warnings, then the heads-ups. */
const SEVERITY: Record<SafetyIssue["level"], number> = { danger: 0, warning: 1, info: 2 };

/** Each hole's worst open check (a problem or a warning; heads-ups don't count), with what it says. */
function useHoleChecks() {
  const doc = useCourse(s => s.doc);
  return useMemo(() => {
    const worst = new Map<string, SafetyIssue>();
    for (const i of openIssues(doc, courseIssues(doc)).open) {
      if (i.level === "info") continue;
      for (const h of i.holes) { const had = worst.get(h); if (!had || SEVERITY[i.level] < SEVERITY[had.level]) worst.set(h, i); }
    }
    return worst;
  }, [doc]);
}

/** A hole row's dot for its worst check (none when it has none). */
const CheckDot = ({ check }: { check?: SafetyIssue }) =>
  check ? <span className={`w-2 h-2 rounded-full shrink-0 ${check.level === "danger" ? "bg-red-400" : "bg-amber-400"}`} title={check.text} aria-label={`Check: ${check.text}`} data-testid="hole-check-dot" /> : null;

/** The small icon buttons beside a check (a finger's 44 px on a touch screen). */
const CHECK_BTN = `shrink-0 p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.09] touch:min-w-[44px] touch:min-h-[44px] touch:flex touch:items-center touch:justify-center ${FOCUS}`;

/** The safe distances offered (stored in feet: in meters, each is its feet). */
const gapOptions = (units: CourseDoc["units"]) => [{ value: 0, label: "Auto" }, ...(units === "m" ? [15, 20, 30, 45].map(m => ({ value: Math.round(m * FT_PER_M), label: `${m} m` })) : [50, 75, 100, 150].map(f => ({ value: f, label: `${f} ft` })))];

/** The course checked: the problems found (each shown on the map too), the ones ignored, and the
 * safe distance between holes. */
export function ReviewStep() {
  const doc = useCourse(s => s.doc);
  const all = courseIssues(doc);
  const { open, ignored } = openIssues(doc, all);
  // (the worst first)
  const issues = [...open].sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
  const ignore = (id: string, off: boolean) =>
    changeDoc(d => {
      const list = (d.ignoredChecks ?? []).filter(x => x !== id && x !== swapped(id));
      return { ignoredChecks: off ? [...list, id] : list.length ? list : undefined };
    });
  const [showIgnored, setShowIgnored] = useState(false);
  const set = (patch: Partial<typeof doc.rules>) => changeDoc(d => ({ rules: { ...d.rules, ...patch } }));
  const options = gapOptions(doc.units);
  // (set in the other units: the nearest one offered lights up)
  const gap = doc.rules.safetyGapFt ?? 0;
  const lit = gap ? options.slice(1).reduce((best, o) => (Math.abs(o.value - gap) < Math.abs(best.value - gap) ? o : best), options[1]).value : 0;
  return (
    <>
      <Section title={`Found (${issues.length})`} testid="issues" help="checks">
        {issues.length === 0 ? (
          <p className="text-xs text-emerald-300">No problems found.</p>
        ) : (
          <ul className="space-y-1">
            {issues.map(issue => (
              <li key={issue.id} className="flex items-start gap-1 group">
                <button
                  className={`flex-1 min-w-0 flex gap-2 items-start text-left text-xs text-zinc-200 hover:bg-white/[0.09] rounded px-1.5 py-1 touch:py-2.5 ${FOCUS}`}
                  data-testid="issue-row"
                  onClick={() => {
                    if (issue.holes[0]) select(issue.holes[0]);
                    getView()?.fitBounds({ minX: issue.at.x - 120, minY: issue.at.y - 120, maxX: issue.at.x + 120, maxY: issue.at.y + 120 });
                  }}
                >
                  <IssueIcon level={issue.level} />
                  {issue.text}
                </button>
                <button className={CHECK_BTN} title="Ignore" aria-label="Ignore" data-testid="issue-ignore" onClick={() => ignore(issue.id, true)}>
                  <EyeOff size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {ignored.length > 0 && (
          <div className="mt-2" data-testid="issues-ignored">
            <button className={`text-[11px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 touch:min-h-[44px] rounded ${FOCUS}`} aria-expanded={showIgnored} onClick={() => setShowIgnored(v => !v)}>
              Ignored ({ignored.length}) <span className={`text-zinc-500 transition-transform ${showIgnored ? "rotate-90" : ""}`} aria-hidden>›</span>
            </button>
            {showIgnored && (
              <ul className="space-y-1 mt-1">
                {ignored.map(issue => (
                  <li key={issue.id} className="flex items-start gap-1 text-xs text-zinc-500" data-testid="ignored-row">
                    <span className="flex-1 min-w-0 flex gap-2 items-start px-1.5 py-1"><IssueIcon level={issue.level} />{issue.text}</span>
                    <button className={CHECK_BTN} title="Check again" aria-label="Check again" onClick={() => ignore(issue.id, false)}>
                      <Eye size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-3 border-t border-white/[0.08] pt-2">
          <Field label="Safe distance between holes">
            <Segmented label="Safe distance" value={lit} onChange={v => set({ safetyGapFt: v || undefined })} options={options} />
          </Field>
        </div>
      </Section>
      {SERVER && <NearbySafety />}
    </>
  );
}

/** The step's own content (lists, settings and tools), under its heading. (Design on a big
 * screen has none: the map is the step, see HolesColumn and Problems. On a phone or a tablet the
 * Checks count is in the panel's header.) */
export function StepContent({ onFindSite }: { onFindSite: () => void }) {
  const step = useEditor(e => e.step);
  return (
    <>
      {step === "site" && <SiteStep onFindSite={onFindSite} />}
      {step === "design" && <div data-testid="holes-panel"><HolesStep /></div>}
      {step === "map" && <DesignPanel />}
      {step === "export" && <ExportPanel />}
    </>
  );
}

/** The checks found on the course, as a count to open them by: red for a problem, amber for a
 * warning, plain when there are only heads-ups, green when there's nothing. */
export function ProblemsCount({ full }: { full?: boolean }) {
  const doc = useCourse(s => s.doc);
  const open = useEditor(e => e.problemsOpen);
  const found = useMemo(() => openIssues(doc, courseIssues(doc)).open, [doc]);
  const n = found.length;
  const worst = found.reduce<SafetyIssue["level"] | null>((w, i) => (!w || SEVERITY[i.level] < SEVERITY[w] ? i.level : w), null);
  const tone = worst === "danger" ? "bg-red-500/[0.18] text-red-200 ring-1 ring-red-400/40" : worst === "warning" ? "bg-amber-500/[0.16] text-amber-100 ring-1 ring-amber-400/40" : worst === "info" ? "bg-white/[0.1] text-zinc-100 ring-1 ring-white/15" : "bg-emerald-500/[0.14] text-emerald-200";
  const badge = worst === "danger" ? "bg-red-400 text-red-950" : worst === "warning" ? "bg-amber-400 text-amber-950" : "bg-sky-400 text-sky-950";
  return (
    <button
      data-testid="problems-button"
      aria-expanded={open}
      onClick={() => useEditor.getState().set({ problemsOpen: !open })}
      className={`${full ? "w-full justify-center" : ""} inline-flex items-center gap-2 h-9 touch:h-11 px-3 rounded-full text-[12.5px] font-semibold ${tone}`}
    >
      {n ? <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-[18px] text-center ${badge}`}>{n}</span> : <ClipboardCheck size={15} />}
      {n ? "Checks" : "No problems"}
    </button>
  );
}

/** The checks, opened from the problems count: a glass panel over the map's right side, ending
 * above the tool bar (its height as measured, and 24 more: it sits 16 px up, so 8 px between). */
export function ProblemsPanel() {
  const open = useEditor(e => e.problemsOpen);
  const tools = useToolbarRoom(s => s.height);
  if (!open) return null;
  return (
    <div className="glass-solid absolute right-3 top-3 z-30 w-[340px] max-w-[calc(100%-24px)] rounded-[24px] overflow-y-auto" style={{ bottom: tools ? tools + 24 : 12 }} role="dialog" aria-label="Checks" data-testid="problems-panel">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <h2 className="text-[17px] font-bold text-zinc-50">Checks</h2>
        <button className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-50" aria-label="Close checks" onClick={() => useEditor.getState().set({ problemsOpen: false })}><X size={16} /></button>
      </div>
      <ReviewStep />
    </div>
  );
}

/** The holes, floating down the map's left side (Design): each to fly to and pick, a new one, the
 * course's totals and layouts behind a button. While something is picked its panel sits next to
 * the list, and the list is just the holes' numbers. */
export function HolesColumn() {
  const doc = useCourse(s => s.doc);
  const slim = useSelection().open;
  const stats = useMemo(() => courseStats(doc), [doc]);
  const totals = useMemo(() => courseTotals(doc, stats), [doc, stats]);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const checks = useHoleChecks();
  // (opened by search: a course setting asked for)
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === "course") setMore(true); };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  // (the course popover closes with Esc or a click elsewhere, like the other menus)
  useEffect(() => {
    if (!more) return;
    const down = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMore(false); } };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", key, true); };
  }, [more]);
  const u = doc.units;
  // (Fitting the map keeps clear of the column: its width and margins; and of the picked thing's
  // panel next to it, without the map moving when something is clicked)
  useEffect(() => {
    let raf = 0;
    const set = () => { const v = getView(); if (v) v.setLeftInset(196); else raf = requestAnimationFrame(set); };
    set();
    return () => { cancelAnimationFrame(raf); getView()?.setLeftInset(0); };
  }, []);
  useEffect(() => {
    const v = getView();
    if (v && v.leftInset) v.leftInset = slim ? PANEL_INSET : 196;
  }, [slim]);
  return (
    <div className={`absolute left-3 top-3 bottom-3 ${more ? "z-30" : "z-20"} flex flex-col gap-2 pointer-events-none`} data-testid="holes-column">
      <div className={`glass pointer-events-auto rounded-[22px] p-1.5 flex flex-col gap-0.5 max-h-full min-h-0 ${slim ? "w-[52px]" : "w-[172px]"}`} data-testid="hole-list">
        {doc.layouts.length > 1 && <div className="pb-1 mb-0.5 border-b border-white/10"><LayoutPicker compact slim={slim} /></div>}
        <div className="overflow-y-auto min-h-0 flex flex-col gap-0.5">
          {stats.map(s => <HoleRow key={s.holeId} s={s} check={checks.get(s.holeId)} slim={slim} />)}
        </div>
        <NewHoleRow slim={slim} />
        {!slim && <CourseFileButton row short />}
      </div>
      {/* (no holes yet: no totals to open) */}
      {doc.holes.length > 0 && <div className="glass pointer-events-auto rounded-[18px] mt-auto relative" ref={moreRef}>
        <button className={`w-full flex gap-3 items-end py-2 text-left ${slim ? "justify-center px-1" : "pl-3.5 pr-2.5"}`} onClick={() => setMore(m => !m)} aria-expanded={more} title={slim ? `${totals.complete} holes · par ${totals.par} · ${fmtDist(totals.length, u)}` : "Course totals and layouts"} data-testid="course-totals-button">
          {/* (slim: just the par; the rest for screen readers) */}
          {[[totals.complete, "holes"], [totals.par, "par"], [fmtDist(totals.length, u), "total"]].map(([v, k]) => (
            <span key={k as string} className={slim && k !== "par" ? "sr-only" : undefined}><span className="block text-[15px] font-bold text-zinc-50 leading-tight tabular-nums">{v}</span><span className="text-[11px] text-zinc-400">{k}</span></span>
          ))}
          {!slim && <ChevronUp size={15} className={`ml-auto self-center text-zinc-400 transition-transform ${more ? "rotate-180" : ""}`} aria-hidden />}
        </button>
        {more && (
          <div className="glass-solid absolute left-0 bottom-full mb-2 w-[340px] rounded-[20px] max-h-[70vh] overflow-y-auto" data-testid="course-more">
            <HolesStep course />
          </div>
        )}
      </div>}
    </div>
  );
}

export function SidePanel({ onFindSite }: { onFindSite: () => void }) {
  const step = useEditor(e => e.step);
  const i = STEPS.findIndex(s => s.id === step);
  const meta = STEPS[i];
  const { open } = useSelection();
  // (something picked on Site: its settings here, with a way back to the step's. Not what was
  // still picked when the step was opened: the step's own panel first)
  const selectedId = useEditor(e => e.selectedId), group = useEditor(e => e.group);
  const keyNow = selectedId ?? group.join(",");
  const seen = useRef({ step, carried: keyNow });
  if (seen.current.step !== step) seen.current = { step, carried: keyNow };
  else if (seen.current.carried && seen.current.carried !== keyNow) seen.current.carried = "";
  if (open && step === "site" && keyNow !== seen.current.carried)
    return (
      <aside className="glass w-[340px] shrink-0 rounded-[24px] overflow-y-auto" aria-label="Step panel" data-testid="side-panel">
        <div data-testid="inspector" aria-label="Selection">
          <SelectionHeader back={meta.title} />
          <InspectorBody />
        </div>
      </aside>
    );
  return (
    <aside className="glass w-[340px] shrink-0 rounded-[24px] overflow-y-auto" aria-label="Step panel" data-testid="side-panel">
      <div className="px-4 pt-4 pb-1">
        <div className="text-[11.5px] font-semibold text-orange-300">Step {i + 1} of {STEPS.length}</div>
        <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-zinc-50">{meta.title}</h2>
      </div>
      <StepContent onFindSite={onFindSite} />
    </aside>
  );
}
