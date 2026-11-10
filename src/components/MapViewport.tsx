// The map view (2D and 3D are one view): the CourseView engine, fed from the course store.
import { useOnSite } from "../state/onSite";
import { latitudeOf, paintLight, sunFromOf } from "../lib/mapLook";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxSelect, Compass, Maximize2, Minus, PersonStanding, Plus, RotateCcw, RotateCw } from "lucide-react";
import { FOCUS } from "./ui";
import { ViewToggle } from "./ViewToggle";
import { PlotPill } from "./DrawBar";
import { CourseView } from "../viewport/CourseView";
import type { ViewDoc, ViewInfo } from "../viewport/types";
import { changeDoc, useCourse, useEditor, updateItem, updateHole, useCourse as courseStore } from "../state/course";
import { addBrushSection, addDrawn, addPatch, adoptTree, addHole, boxSelect, cutStretch, moveGroup, placeAt, select } from "../state/actions";
import { courseIssues, courseStats, openIssues } from "../lib/holeStats";
import { activeLayout, holeLabel } from "../lib/course";
import { contoursOf, hillshadeUrl } from "../lib/relief";
import { terrainStats, heightAt } from "../lib/terrainGrid";
import { niceScaleBar } from "../lib/view";
import { centroid } from "../lib/geom";
import { fmtElev } from "../lib/units";
import { FT_PER_M, STAND_HERE } from "../constants";
import { spotlight } from "./showSetting";
import { teeLevelFor, useMapInsets } from "./Toolbar";
import { useTouch } from "./useLayout";
import type { MapStyle, P } from "../types";
import { SceneButton } from "./ScenePanel";
import { LocateButton, MyLocationDot } from "./MyLocation";
import { canShowLocation } from "../state/gps";
import { landscape3dOf, style3dOf } from "../lib/landscapes";
import { paintedDetail, usePaintedGround } from "../state/paintedGround";
import { getView, setLiveView } from "../state/view";
import { cameraFrom } from "./FlyoverSettings";


type MenuInfo = { clientX: number; clientY: number; itemId: string | null; ground: P | null };

/** The scale bar: a round length in the course's units (10, 20, 50 m, 1 km, as feet go 10, 20,
 * 50 ft, 1 mi) about `targetPx` long. */
const scaleBar = (pxPerFoot: number, targetPx: number, units: "ft" | "m") => {
  if (units === "ft") return niceScaleBar(pxPerFoot, targetPx);
  const s = niceScaleBar(pxPerFoot * FT_PER_M, targetPx);
  return s && { px: s.px, label: s.feet >= 1000 && s.feet % 1000 === 0 ? `${s.feet / 1000} km` : `${s.feet.toLocaleString()} m` };
};

/**
 * The map and its controls. `compact` lays the controls out for a phone (a column of 44 px
 * buttons under the top bar, `controlsTop` from the top, the turn buttons left out when less
 * than `controlsRoom` pixels are free above the panel) or a phone on its side (2D/3D with them).
 */
export function MapViewport({ onContextMenu, compact, controlsTop = 0, controlsRoom = 999, controlsRight = 8 }: { onContextMenu: (info: MenuInfo) => void; compact?: "phone" | "rail"; controlsTop?: number; controlsRoom?: number; controlsRight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CourseView | null>(null);
  const [info, setInfo] = useState<ViewInfo | null>(null);
  const [hover, setHover] = useState<P | null>(null);
  const doc = useCourse(s => s.doc);
  const ed = useEditor();
  const touch = useTouch();
  const inset = useMapInsets();
  const menuRef = useRef(onContextMenu);
  menuRef.current = onContextMenu;

  useEffect(() => {
    if (!ref.current) return;
    const v = new CourseView(ref.current, {
      onSelect: (id, add) => select(id, add),
      onAdoptTree: (tree, look) => adoptTree(tree, look),
      onBoxSelect: (ids, add, trees) => boxSelect(ids, add, trees),
      onMoveGroup: (base, ids, dx, dy) => moveGroup(base, ids, dx, dy, false),
      onPlace: (mode, p) => placeAt(mode, p),
      // (a hole made: back to Select, the new hole picked)
      onHole: (tee, basket) => { addHole(tee, basket); useEditor.getState().set({ tool: "select" }); },
      onDrawn: (kind, pts, opts) => {
        // (drawn as a patch of a wood: no area of its own)
        const { patchFor, patchBrush, drawShape } = useEditor.getState();
        // (painted on open ground: the brush stays in hand for the next stroke, as on an area,
        // nothing picked, so a wood can be painted in as many strokes as it takes)
        const painting = !patchFor && kind === "area" && drawShape === "paint";
        if (patchFor && kind === "area") (patchBrush ? addBrushSection : addPatch)(patchFor, pts);
        else addDrawn(kind, pts, { ...opts, pick: !painting });
        if (!painting) useEditor.getState().set({ tool: "select", patchFor: null, patchBrush: false });
      },
      onChange: (id, patch) => {
        const next = { ...patch } as Record<string, unknown>;
        if (Array.isArray(next.points)) Object.assign(next, centroid(next.points as P[]));
        updateItem(id, next, false);
      },
      onHoleChange: (id, patch) => updateHole(id, patch, false),
      onCommit: () => courseStore.getState().commit(),
      // (a brush stroke on areas: live as it goes, one undo step when let go)
      onAreas: (items, done) => {
        changeDoc(() => ({ items }), false);
        if (done) courseStore.getState().commit();
      },
      onTerrain: (heights, done, original) => {
        changeDoc(() => ({ terrainHeights: heights, terrainOriginal: original && Object.keys(original).length ? original : undefined }), false);
        if (done) courseStore.getState().commit();
      },
      onHover: setHover,
      onPose: pose => useEditor.getState().set({ view: pose === "top" ? "2d" : "3d" }),
      onTeeView: id => useEditor.getState().set({ teeView: id }),
      onContextMenu: i => menuRef.current(i),
      // (a walk ended near another hole: on that hole now, still looking the same way)
      onStand: p => {
        const ed = useEditor.getState(), near = getView()?.standOn(p);
        if (near && near !== STAND_HERE && near !== ed.teeView && !ed.flyover) ed.set({ teeView: near, teeViewTee: null, teeStand: p });
        else ed.set({ teeStand: p });
      },
      onFieldPart: part => useEditor.getState().set({ fieldPart: part }),
      onDrawProgress: n => useEditor.getState().set({ drawPoints: n }),
      onPlotEnd: () => useEditor.getState().set({ plotLine: null }),
      onObPickEnd: () => useEditor.getState().set({ obPick: null, pickCut: false }),
      onCutLine: (id, a, b) => cutStretch(id, a, b),
      onLidar: patch => changeDoc(d => (d.lidar ? { lidar: { ...d.lidar, ...patch } } : {})),
      onFlyWait: waiting => useEditor.getState().set({ flyLoading: waiting }),
      onFlyKey: i => useEditor.getState().set({ flyKey: i }),
      onFlyCam: i => {
        const s = useEditor.getState();
        if (s.selectedId) cameraFrom(s.selectedId, i);
      }
    });
    setLiveView(v);
    (window as any).__dgView = v;
    setView(v);
    const off = v.onView(setInfo);
    return () => {
      off();
      v.dispose();
      if (getView() === v) setLiveView(null);
    };
  }, []);

  const stats = courseStats(doc);
  // Looked at only (shared, the public page): the course as its owner set it for viewers (the
  // painted ground, no contours, by default), not the editor's own display
  const viewOnly = useCourse(s => s.readOnly);
  const pv = doc.style.publicView ?? {};
  const show = viewOnly
    // (a viewer's map and 3D are the editor's own: the course's ground, or the photo)
    ? { photo: pv.ground === "photo", contours: !!pv.contours, shading: pv.shading ?? true, painted: false }
    : { photo: ed.photo, contours: ed.contours, shading: ed.shading, painted: false };
  const terrain = useMemo(() => terrainStats(doc.terrainHeights), [doc.terrainHeights]);
  const contours = useMemo(() => (show.contours ? contoursOf(doc.terrainHeights, doc.gridSize, doc.canvas.width, doc.canvas.height) : { segments: [], interval: 1 }), [show.contours, doc.terrainHeights, doc.gridSize, doc.canvas]);
  // (the hill shading: worked out just after the map's first picture, not in the way of it; a
  // phone took seconds over it there)
  const shadeOn = show.shading && !show.painted && terrain.relief > 1 && (doc.style.reliefScale ?? 1) > 0;
  const [shadeUrl, setShadeUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!shadeOn) { setShadeUrl(null); return; }
    const t = window.setTimeout(() => setShadeUrl(hillshadeUrl(doc.terrainHeights, doc.gridSize, doc.canvas.width, doc.canvas.height, doc.style.reliefScale ?? 1)), 60);
    return () => window.clearTimeout(t);
  }, [shadeOn, doc.terrainHeights, doc.gridSize, doc.canvas, doc.style.reliefScale]);
  const issues = useMemo(() => (ed.step === "design" ? openIssues(doc, courseIssues(doc)).open : null), [ed.step, doc]);
  // From a tee and in flyovers: the ground in the Design look (the painted map), not the photo
  // (from a tee: the editor's own pick, or for a viewer the course's look for viewers)
  const paintedOn = ((!!ed.teeView && !viewOnly && ed.flyGround === "painted") || show.painted) && !!doc.holes.length;
  // (from a tee, flying and in a video, on the course's own ground: the photo out of the picture)
  const bare = !viewOnly && ed.flyGround === "ground" && (!!ed.teeView || ed.recordingBare);
  // (painted ahead while the course rests with a hole picked, so a flyover has less to wait for;
  // not while it's being changed: that would paint it over and over)
  const [restingDoc, setRestingDoc] = useState(doc);
  useEffect(() => { const t = window.setTimeout(() => setRestingDoc(doc), 1500); return () => window.clearTimeout(t); }, [doc]);
  const warmHole = ed.selectedId && doc.holes.some(h => h.id === ed.selectedId) ? ed.selectedId : ed.activeHoleId;
  const warm = !ed.teeView && ed.flyGround === "painted" && restingDoc === doc && doc.holes.length > 0 && ed.step !== "map";
  // (painted ahead gently: only while the view is still, a few ms at a time)
  const [painted, paintedFresh] = usePaintedGround(paintedOn || warm, !paintedOn);
  useEffect(() => {
    if (!warm || !warmHole || !painted) return;
    // (only once the hole has stayed picked a few seconds: clicking through holes paints nothing)
    const id = window.setTimeout(() => void paintedDetail(doc, warmHole, view?.detailPx() ?? 3072), 4000);
    return () => window.clearTimeout(id);
  }, [warm, warmHole, painted, doc]);

  // The course in the 3D look (View panel), tilted or straight down (2D) alike: its landscape's
  // natural colors, any of its own colors picked there, its sun and shadows. Only the Map step's
  // illustrated map (printed and exported) keeps the map's own style. (The painted ground, from a
  // tee and in flyovers, is painted in the 3D look's colors too: state/paintedGround.)
  const l3 = doc.style.look3d;
  const natural = landscape3dOf(doc.style);
  const viewStyle = useMemo((): MapStyle => style3dOf(doc.style), [doc.style]);
  const viewDoc: ViewDoc = useMemo(() => ({
    course: { ...doc, style: viewStyle },
    stats,
    activeHoleId: ed.activeHoleId,
    issues,
    // (the sun where it really is: by the compass, at the height the map's light gives it)
    // (the 3D view's own sun when set, apart from the map's)
    sun: { azimuth: l3?.sunFrom ?? sunFromOf(doc.style, latitudeOf(doc.site)), altitude: l3?.sunHeight ?? paintLight(doc.style).height, shadows: l3?.shadows ?? doc.style.shadows ?? 0.65, light: doc.style.light ?? 0 },
    canvas: doc.canvas,
    unitsPerFoot: 1,
    gridSize: doc.gridSize,
    showGrid: !doc.background,
    heights: doc.terrainHeights,
    terrain,
    // (no photo while the painted map is on its way)
    background: { url: doc.background, rect: { x: 0, y: 0, width: doc.canvas.width, height: doc.canvas.height }, opacity: show.photo && !paintedOn && !bare ? 1 : 0 },
    overlay: shadeUrl ? "shaded" : contours.segments.length ? "contours" : "off",
    contours,
    shadeUrl,
    groundDetail: ed.groundDetail,
    groundPaint: doc.groundPaint,
    groundColor: l3?.rough ?? natural.colors.rough
  }), [doc, stats, ed.activeHoleId, issues, terrain, show.photo, shadeUrl, contours, ed.groundDetail, natural, viewStyle, paintedOn, l3, bare]);

  useEffect(() => { view?.setDoc(viewDoc); }, [view, viewDoc]);
  useEffect(() => { void view?.setPaintedGround(paintedOn ? painted : null); }, [view, paintedOn, painted]);
  // (a flyover waits for the painting it will fly over)
  useEffect(() => { view?.setPaintedPending(paintedOn && !paintedFresh); }, [view, paintedOn, paintedFresh]);
  // (and a sharper painting round the hole looked at, flown over or filmed)
  useEffect(() => { view?.setDetailPainter((holeId, maxPx) => paintedDetail(doc, holeId, maxPx)); }, [view, doc]);
  // (the close-up doesn't need the whole map painted first: both at once, from the moment a tee
  // view or flyover opens)
  useEffect(() => { if (paintedOn && ed.teeView && ed.teeView !== STAND_HERE) void paintedDetail(doc, ed.teeView, view?.detailPx() ?? 3072); }, [view, paintedOn, ed.teeView, doc]);
  useEffect(() => { view?.setSelection(ed.selectedId); }, [view, ed.selectedId]);
  // (new tees in the color of the layout worked on, whatever changed it: a pick, undo, another course)
  const layoutTee = activeLayout(doc)?.tee;
  useEffect(() => { if (layoutTee) useEditor.getState().set({ teeLevel: layoutTee }); }, [layoutTee]);
  useEffect(() => { view?.setReadOnly(viewOnly); }, [view, viewOnly]);
  useEffect(() => { view?.setShowStumps(ed.stumps); }, [view, ed.stumps]);
  useEffect(() => { view?.setTreesHidden(ed.hideTrees); }, [view, ed.hideTrees]);
  useEffect(() => { view?.setGroup(ed.group); }, [view, ed.group]);
  useEffect(() => { view?.setPlotLine(ed.plotLine); }, [view, ed.plotLine]);
  useEffect(() => { view?.setObPick(ed.obPick, ed.pickCut); }, [view, ed.obPick, ed.pickCut]);
  // (the Tee tool's preview in the color it will go down in: the hole's next one when it has the
  // picked color already)
  const ghostTee = ed.tool === "add-tee" && !ed.holeToBasket ? teeLevelFor(doc, ed.activeHoleId, ed.teeLevel) : ed.teeLevel;
  useEffect(() => {
    view?.setTool({ mode: ed.tool, areaKind: ed.areaKind, lineKind: ed.lineKind, structureKind: ed.structureKind, shape: ed.drawShape, dragSelect: ed.dragSelect, treeKind: ed.treeKind, fieldKind: ed.fieldKind, brush: { size: ed.brushSize, strength: ed.brushStrength, ground: ed.groundBrush }, standOf: ed.standOf, areaBrush: ed.areaBrush, reshape: ed.reshapeId }, ghostTee, ed.amenityKind);
  }, [view, ed.tool, ed.areaKind, ed.lineKind, ed.structureKind, ed.drawShape, ghostTee, ed.amenityKind, ed.dragSelect, ed.treeKind, ed.fieldKind, ed.brushSize, ed.brushStrength, ed.groundBrush, ed.standOf, ed.areaBrush, ed.reshapeId]);
  // (Measure: from one spot, or along a path)
  useEffect(() => { view?.setMeasureMode(ed.measureMode ?? "spot"); }, [view, ed.measureMode]);
  // A check's mark on the map clicked: the checks open, with its row lit up
  useEffect(() => {
    if (!view) return;
    view.onIssue = text => {
      useEditor.getState().set({ problemsOpen: true });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const row = [...document.querySelectorAll<HTMLElement>('[data-testid="issue-row"]')].find(r => r.textContent?.includes(text));
        if (row) spotlight(row);
      }));
    };
    return () => { view.onIssue = null; };
  }, [view]);
  useEffect(() => { view?.setPose(ed.view === "2d" ? "top" : "tilt"); }, [view, ed.view]);
  // (a patch is drawn as an area; leaving the tool drops the patch)
  useEffect(() => { if (ed.tool !== "draw-area" && ed.patchFor) useEditor.getState().set({ patchFor: null }); }, [ed.tool, ed.patchFor]);
  // (reshaping one area with the brush ends with the brush: another tool or way to draw)
  useEffect(() => { if (ed.reshapeId && (ed.tool !== "draw-area" || ed.drawShape !== "paint")) useEditor.getState().set({ reshapeId: null }); }, [ed.tool, ed.drawShape, ed.reshapeId]);
  // (going to another step, Map say, leaves the tee view and any flyover: they're the map's)
  const stepWas = useRef(ed.step);
  useEffect(() => {
    if (stepWas.current !== ed.step && useEditor.getState().teeView) useEditor.getState().set({ teeView: null, flyover: false });
    stepWas.current = ed.step;
  }, [ed.step]);
  // (and leaving the Tee tool drops a new hole on its way to a basket)
  useEffect(() => { if (ed.tool !== "add-tee" && ed.holeToBasket) useEditor.getState().set({ holeToBasket: null }); }, [ed.tool, ed.holeToBasket]);
  useEffect(() => { view?.setGrass(ed.grass, ed.wind); }, [view, ed.grass, ed.wind]);
  // Covered by the page on the Map and Export steps: the map view rests (a video records on its own)
  useEffect(() => { view?.setPaused((ed.step === "map" || ed.step === "export") && !ed.teeView); }, [view, ed.step, ed.teeView]);
  // (tee view, editing: picking and dragging there, the map from above in a corner)
  const readOnlyView = useCourse(s => s.readOnly);
  // (standing in 3D: editors pick as they walk; anyone walks; the map from above in a corner)
  useEffect(() => { view?.setStandTap(ed.standTap ?? "walk"); }, [view, ed.standTap]);
  // (on site: looking round only, the map from above in its corner)
  const onSite = useOnSite(s => !!s.on);
  // (the Flyover editor: its map from above, in the corner on a phone too)
  useEffect(() => { view?.setTeeEdit(!!ed.teeView && !ed.flyover && !readOnlyView && !onSite, onSite || (ed.flyCam && !!compact) ? "corner" : ed.flyCam ? "small" : ed.teeMap === "off" ? null : ed.teeMap ?? "small"); }, [view, ed.teeView, ed.teeMap, ed.flyover, ed.flyCam, readOnlyView, onSite, compact]);
  // (the picked field's part outlined; redrawn as the field changes)
  const partItem = useCourse(s => (ed.fieldPart && ed.selectedId ? s.doc.items.find(i => i.id === ed.selectedId) : undefined));
  useEffect(() => { view?.setFieldPart(partItem ? partItem.id : null, ed.fieldPart ?? null); }, [view, partItem, ed.fieldPart]);
  // (the picked keyframe stands out on the map; another hole picked, none is)
  useEffect(() => { view?.setFlyKey(ed.flyKey); }, [view, ed.flyKey]);
  useEffect(() => { if (!useEditor.getState().flyCam) useEditor.getState().set({ flyKey: null }); }, [ed.selectedId]);
  useEffect(() => {
    if (!view) return;
    // (standing on its own is only where the person is: without the spot, back to the map)
    if (ed.teeView === STAND_HERE && !ed.teeStand) { useEditor.getState().set({ teeView: null, flyover: false }); return; }
    // (it holds at its end, paused, as a video player does; the camera's own preview ends)
    if (ed.flyover && ed.teeView && ed.teeView !== STAND_HERE) {
      if (ed.flyCam) view.flyover(ed.teeView, () => useEditor.getState().set({ flyover: false }));
      else {
        // (asked for at a moment: it opens held there)
        const from = useEditor.getState().flyFrom ?? null;
        view.flyover(ed.teeView, () => useEditor.getState().set({ flyPaused: true }), true, from);
        if (from !== null) useEditor.getState().set({ flyFrom: null });
      }
    }
    else { view.setTeeView(ed.teeView, ed.teeViewTee ?? null, ed.teeStand ?? null); useEditor.getState().set({ flyLoading: null, ...(ed.teeView ? {} : { teeViewTee: null, teeStand: null }) }); }
  }, [view, ed.teeView, ed.teeViewTee, ed.flyover, ed.teeStand]);
  useEffect(() => { view?.flyPause(ed.flyPaused); }, [view, ed.flyPaused, ed.flyover]);
  useEffect(() => { view?.setColorPicking(ed.colorPicking > 0); }, [view, ed.colorPicking]);

  const scale = info ? scaleBar(info.pxPerUnit, 110, doc.units) : null;
  const elevation = hover ? heightAt(doc.terrainHeights, doc.gridSize, hover.x, hover.y) + doc.site.baseElevationFt : null;
  // (on a touch screen, a finger's 44 px)
  const btn = `w-8 h-8 touch:w-11 touch:h-11 flex items-center justify-center text-zinc-300 hover:text-zinc-50 hover:bg-white/[0.13] transition-colors ${FOCUS} focus-visible:ring-inset`;
  // (the floating controls share one surface)
  const pad = "pointer-events-auto glass backdrop-blur rounded-lg shadow-lg shadow-black/30 ring-1 ring-white/10";

  // (on a computer, clear of the Selection panel at the top right: 150 to 450 px from the edge)
  const obBar = ed.obPick && !ed.teeView && <ObPickBar view={view} id={ed.obPick} edge={doc.items.find(i => i.id === ed.obPick)?.type === "area"} cut={ed.pickCut} top={compact ? controlsTop + 8 : 12} right={8} />;
  const plotBar = ed.plotLine && !ed.teeView && doc.holes.some(h => h.id === ed.plotLine) && (
    <div className="absolute left-2 right-2 z-20 flex justify-center pointer-events-none" style={{ top: compact ? controlsTop + 8 : 12 }}><PlotPill hole={holeLabel(doc, ed.plotLine)} /></div>
  );
  // (the box select button: while the course can be changed, on Design and Site; lit while it's on
  // and Select is the tool)
  const boxable = !viewOnly && (ed.step === "design" || ed.step === "site");
  const boxing = ed.dragSelect && ed.tool === "select";
  // (the scale only looking straight down: tilted, it's true only at the middle)
  const flat = !info || info.tiltDeg < 1;
  if (compact) {
    return (
      <div className="absolute inset-0">
        <div ref={ref} data-testid="plan" className="absolute inset-0 overflow-hidden touch-none" />
        {/* (the comments' pins: on the map, under everything over it; auth/Comments) */}
        <div data-testid="map-pins" className="absolute inset-0 pointer-events-none isolate overflow-hidden" />
        <MyLocationDot view={view} stats={stats} />
        {plotBar}
        {obBar}
        {!ed.teeView && controlsRoom > 0 && <TouchControls view={view} info={info} scale={info && flat ? scaleBar(info.pxPerUnit, 72, doc.units) : null} phone={compact === "phone"} top={controlsTop} room={controlsRoom} right={controlsRight} threeD={ed.view === "3d"} editing={boxable} />}
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={ref} data-testid="plan" className="absolute inset-0 overflow-hidden touch-none" />
        {/* (the comments' pins: on the map, under everything over it; auth/Comments) */}
        <div data-testid="map-pins" className="absolute inset-0 pointer-events-none isolate overflow-hidden" />
      {/* (you on the map: its own small part, so each GPS reading and compass turn redraws only it) */}
      <MyLocationDot view={view} stats={stats} />
      {plotBar}
      {obBar}
      {!ed.teeView && (
        <>
          {/* (clear of the checks when they're open; the scale and the elevation under the pointer
              below them, clear of the tools) */}
          <div className="absolute top-3 flex flex-col gap-2 items-end pointer-events-none" style={{ right: inset.right }}>
            <ViewToggle look="map" />
            <div className="flex gap-2 items-start">
              <div className="flex flex-col gap-2">
                <button className={`${pad} w-11 h-11 flex flex-col items-center justify-center ${FOCUS}`} title="North up (N)" onClick={() => view?.resetNorth()} data-testid="compass">
                  <Compass size={18} className="text-red-400" style={{ transform: `rotate(${-(info?.heading ?? 0)}deg)` }} />
                  <span className="text-[9px] font-bold text-zinc-300">N</span>
                </button>
                {/* (what a plain drag does: move the map, or draw a box to pick things with) */}
                {boxable && (
                  <button className={`${pad} w-11 h-11 flex items-center justify-center ${FOCUS} ${boxing ? "!bg-orange-500 text-zinc-950" : "text-zinc-300 hover:text-zinc-50"}`} title="Select with a box (Shift+drag)" aria-label="Select with a box" aria-pressed={boxing}
                    onClick={() => useEditor.getState().set({ dragSelect: !boxing, tool: "select" })} data-testid="drag-select">
                    <BoxSelect size={18} />
                  </button>
                )}
              </div>
              <div className={`${pad} flex flex-col overflow-hidden`}>
                <button className={btn} title="Zoom in (+)" onClick={() => view?.zoomBy(1.4)}><Plus size={16} /></button>
                <ZoomSlider view={view} height={96} narrow />
                <button className={btn} title="Zoom out (−)" onClick={() => view?.zoomBy(1 / 1.4)}><Minus size={16} /></button>
                <button className={btn} title="Show the whole course (0)" onClick={() => view?.fitCourse()}><Maximize2 size={15} /></button>
                <LocateButton className={btn} size={15} />
              </div>
              <div className="flex flex-col gap-2 items-end">
                <div className={`${pad} flex flex-col overflow-hidden`}>
                  <button className={btn} title="Turn left (Q)" onClick={() => view?.rotateBy(-30)}><RotateCcw size={15} /></button>
                  <button className={btn} title="Turn right (E)" onClick={() => view?.rotateBy(30)}><RotateCw size={15} /></button>
                </div>
                <SceneButton big={touch} size="big" />
                <StandButton view={view} className={`${pad} w-11 h-11 flex items-center justify-center text-zinc-300 hover:text-zinc-50 ${FOCUS}`} size={19} />
              </div>
            </div>
            {hover && (
              <div className="text-[11px] text-zinc-200 glass rounded-md px-2 py-1" data-testid="hover-readout">
                {doc.site.bounds ? `Elevation ${Math.round(doc.units === "m" ? elevation! / FT_PER_M : elevation!)} ${doc.units}` : `Ground ${fmtElev(elevation!, doc.units)}`}
              </div>
            )}
            {scale && flat && (
              <div className="glass rounded-md px-2 py-1" data-testid="scale-bar">
                <div className="text-[11px] text-zinc-200 font-semibold mb-0.5">{scale.label}</div>
                <div className="h-1.5 border-x-2 border-b-2 border-white" style={{ width: scale.px }} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** While a stretch of OB is marked along a line or an area's edge (or one taken out of a line):
 * what to do next, and Cancel (for a finger too). */
function ObPickBar({ view, id, edge, cut, top, right }: { view: CourseView | null; id: string; edge: boolean; cut: boolean; top: number; right: number }) {
  const b = "px-3 h-9 touch:h-11 rounded-lg text-sm font-semibold shrink-0";
  const click = useTouch() ? "Tap" : "Click";
  // (where it's got to: its start set, or a click off the line)
  const [at, setAt] = useState<{ started: boolean; missed: boolean }>(() => ({ started: !!view?.obPickStarted(), missed: false }));
  useEffect(() => {
    if (!view) return;
    setAt({ started: view.obPickStarted(), missed: false });
    view.onObPick = setAt;
    return () => { view.onObPick = null; };
  }, [view, id]);
  const what = at.missed ? `${click} on the ${edge ? "edge" : "line"} itself` : at.started ? `${click} where it ends` : `${click} where it starts, then where it ends`;
  return (
    <div className="absolute left-2 z-20 flex justify-center pointer-events-none" style={{ top, right }}>
    <div className="pointer-events-auto flex items-center gap-2 glass-solid rounded-xl shadow-xl shadow-black/40 ring-1 ring-white/10 px-3 py-2 max-w-full" data-testid="ob-pick-bar">
      <span className="text-sm text-zinc-100 font-semibold whitespace-nowrap">{cut ? "Remove a stretch" : "OB stretch"}</span>
      <span className={`text-xs min-w-0 ${at.missed ? "text-amber-200" : "text-zinc-300"}`} data-testid="ob-pick-hint">{what}</span>
      <button className={`${b} text-zinc-300 hover:bg-white/[0.09]`} onClick={() => view?.cancelDrawing()} data-testid="ob-pick-cancel">Cancel</button>
    </div>
    </div>
  );
}

/** The map's controls for a finger: 44 px buttons (zoom and turn also work by pinching and
 * twisting; these are the one-finger way, and the way for anyone who can't pinch). `editing`: the
 * course can be changed here (Design or Site, not view only): box select is offered. */
function TouchControls({ view, info, scale, phone, top, room, right = 8, threeD, editing }: { view: CourseView | null; info: ViewInfo | null; scale: { px: number; label: string } | null; phone: boolean; top: number; room: number; right?: number; threeD: boolean; editing: boolean }) {
  const set = useEditor(e => e.set);
  const boxing = useEditor(e => e.dragSelect && e.tool === "select");
  const b = "w-11 h-11 flex items-center justify-center text-zinc-100 active:bg-white/[0.13] focus:outline-none focus-visible:bg-white/[0.13]";
  const group = "pointer-events-auto flex flex-col glass rounded-2xl border border-white/10 shadow-[0_6px_20px_rgba(0,0,0,0.35)] overflow-hidden divide-y divide-white/5";
  // On a phone the compass only once the map is turned (as in map apps), and only what fits above
  // the panel: zoom (88), the View button (always in 3D), then where you are, the person (to
  // stand somewhere), the zoom slider (in the zoom buttons' group), the whole course, box select
  // and turning, each with its 8 px gap
  const heading = info?.heading ?? 0;
  const compass = !phone || Math.min(heading, 360 - heading) > 1;
  let used = 88 + (compass ? 52 : 0) + (threeD ? 52 : 0);
  const fits = (h: number) => {
    if (phone && used + h > room) return false;
    used += h;
    return true;
  };
  // (the View button in 2D too: the photo and the lines are switched there; then where you are:
  // it's what you look for on the course)
  const scene = threeD || fits(52);
  const locate = canShowLocation() && fits(52);
  const stand = fits(52);
  const fit = fits(52);
  const box = editing && fits(52);
  // (the zoom slider between + and −, where there's room above the panel once the buttons with no
  // other way to them are in: shorter where it's tight, as pinching and a double tap zoom too)
  const slider = fits(112) ? 112 : fits(72) ? 72 : 0;
  const turn = fits(96);
  return (
    <>
      {scale && (
        <div className="absolute left-2 z-10 pointer-events-none glass rounded-lg px-2 py-1 border border-white/10" style={{ top: top + 2 }} data-testid="scale-bar">
          <div className="text-[11px] text-zinc-100 font-semibold leading-none mb-1">{scale.label}</div>
          <div className="h-1.5 border-x-2 border-b-2 border-white" style={{ width: scale.px }} />
        </div>
      )}
      <div className="absolute z-10 flex flex-col gap-2 items-end pointer-events-none" style={{ top, right }} data-testid="map-controls">
        {!phone && <ViewToggle look="rail" />}
        <div className={phone ? "flex flex-col gap-2 items-end" : "grid grid-cols-2 gap-2"}>
          <div className="flex flex-col gap-2">
            {compass && (
              <button className={`${group} ${b}`} aria-label="North up" title="North up" onClick={() => view?.resetNorth()} data-testid="compass">
                <Compass size={20} className="text-red-400" style={{ transform: `rotate(${-heading}deg)` }} />
              </button>
            )}
            <div className={group}>
              <button className={b} aria-label="Zoom in" onClick={() => view?.zoomBy(1.4)}><Plus size={20} /></button>
              {slider > 0 && <ZoomSlider view={view} height={slider} />}
              <button className={b} aria-label="Zoom out" onClick={() => view?.zoomBy(1 / 1.4)}><Minus size={20} /></button>
            </div>
            {locate && <div className={group}><LocateButton className={b} size={20} /></div>}
            {box && (
              <button className={`${group} ${b} ${boxing ? "!bg-orange-500 !text-zinc-950" : ""}`} aria-label="Select with a box" title="Select with a box" aria-pressed={boxing} onClick={() => set({ dragSelect: !boxing, tool: "select" })} data-testid="touch-drag-select">
                <BoxSelect size={19} />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {fit && <button className={`${group} ${b}`} aria-label="Show the whole course" onClick={() => view?.fitCourse()}><Maximize2 size={18} /></button>}
            {turn && (
              <div className={group}>
                <button className={b} aria-label="Turn left" onClick={() => view?.rotateBy(-30)}><RotateCcw size={18} /></button>
                <button className={b} aria-label="Turn right" onClick={() => view?.rotateBy(30)}><RotateCw size={18} /></button>
              </div>
            )}
          </div>
        </div>
        {scene && <SceneButton big />}
        {stand && <StandButton view={view} className={`${group} ${b}`} size={20} />}
      </div>
    </>
  );
}

/** Between + and −: slide up to zoom in, down to zoom out; where its knob sits says how far in.
 * A tap on its track zooms to there. (`narrow`: the computer's slimmer buttons.) */
function ZoomSlider({ view, height, narrow = false }: { view: CourseView | null; height: number; narrow?: boolean }) {
  const [t, setT] = useState(0.5);
  useEffect(() => {
    // (none while the view rests under a page: the knob stays where it was)
    const off = view?.onView(() => { const z = view.zoomLevel(); if (Number.isFinite(z)) setT(z); });
    return () => { off?.(); };
  }, [view]);
  const track = useRef<HTMLDivElement>(null);
  const at = (y: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, 1 - (y - r.top - 11) / Math.max(1, r.height - 22)));
  };
  return (
    <div ref={track} role="slider" tabIndex={0} aria-label="Zoom" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t * 100)}
      className={`relative ${narrow ? "w-9" : "w-11"} shrink-0 touch-none cursor-ns-resize focus:outline-none focus-visible:bg-white/[0.13]`} style={{ height }}
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); view?.setZoomLevel(at(e.clientY)); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) view?.setZoomLevel(at(e.clientY)); }}
      onKeyDown={e => {
        const by = e.key === "ArrowUp" ? 0.05 : e.key === "ArrowDown" ? -0.05 : 0;
        if (!by) return;
        e.preventDefault();
        e.stopPropagation();
        view?.setZoomLevel(t + by);
      }}
      data-testid="zoom-slider">
      <span className="absolute left-1/2 -translate-x-1/2 top-[11px] bottom-[11px] w-1 rounded-full bg-white/20" aria-hidden />
      <span className="absolute left-1/2 -translate-x-1/2 w-1 rounded-full bg-white/60" style={{ top: 11 + (1 - t) * (height - 22), bottom: 11 }} aria-hidden />
      <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)]" style={{ top: 11 + (1 - t) * (height - 22) }} aria-hidden />
    </div>
  );
}

/** The person: dragged onto the map (or clicked, then a spot clicked), you stand there in 3D at eye
 * height, looking down the hole you're nearest. */
function StandButton({ view, className, size }: { view: CourseView | null; className: string; size: number }) {
  const [placing, setPlacing] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  // (waiting for the spot: a note beside the button, for a finger that has no pointer to follow)
  const [note, setNote] = useState<{ right: number; top: number } | null>(null);
  const standAt = (p: { x: number; y: number } | null) => {
    view?.dropPreview(null);
    setTip(null);
    setNote(null);
    setPlacing(false);
    if (!p || !view) return;
    // (by a hole: on it, looking down it; anywhere else, with or without holes: there, looking the
    // way the map does)
    useEditor.getState().set({ teeView: view.standOn(p), teeViewTee: null, teeStand: { x: p.x, y: p.y }, flyover: false });
  };
  // (clicked: the next click on the map picks the spot; Esc lets go)
  useEffect(() => {
    if (!placing || !view) return;
    const move = (e: PointerEvent) => { const p = view.dropPreview(e.clientX, e.clientY); setTip(p ? { x: e.clientX, y: e.clientY, text: "Click a spot to stand there" } : null); };
    const down = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!el.closest?.("[data-testid=plan]")) { standAt(null); return; }
      e.preventDefault();
      e.stopPropagation();
      standAt(view.dropPreview(e.clientX, e.clientY));
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); standAt(null); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", esc, true); };
  }, [placing, view]);
  return (
    <>
      <button className={`${className} pointer-events-auto touch-none ${placing ? "!bg-cyan-400 !text-zinc-950" : ""}`} title="Stand here: drag me onto the map, or click me, then a spot" aria-label="Stand on the map, in 3D" aria-pressed={placing} data-testid="stand-button"
        onPointerDown={e => {
          if (placing) return;
          const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
          (e.currentTarget as HTMLElement).setPointerCapture(id);
          let dragged = false;
          const move = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return;
            if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) dragged = true;
            if (!dragged || !view) return;
            const p = view.dropPreview(ev.clientX, ev.clientY);
            setTip({ x: ev.clientX, y: ev.clientY, text: p ? "Let go to stand here" : "Over the map" });
          };
          const up = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (dragged) standAt(view?.dropPreview(ev.clientX, ev.clientY) ?? null);
            else {
              const r = (e.target as HTMLElement).closest("button")!.getBoundingClientRect();
              setNote({ right: window.innerWidth - r.left + 8, top: r.top + r.height / 2 });
              setPlacing(true);
            }
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}>
        <PersonStanding size={size} />
      </button>
      {placing && note && !tip && (
        <div className="fixed z-50 pointer-events-none -translate-y-1/2 px-2.5 py-1.5 rounded-[9px] bg-zinc-900/90 text-[13px] text-zinc-100 whitespace-nowrap shadow-lg" style={{ right: note.right, top: note.top }} data-testid="stand-note">
          {matchMedia("(pointer: coarse)").matches ? "Tap a spot to stand there" : "Click a spot to stand there"}
        </div>
      )}
      {tip && (
        <div className="fixed z-50 pointer-events-none" style={{ left: tip.x - 14, top: tip.y - 34 }}>
          <PersonStanding size={28} className="text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]" />
          <div className="absolute left-9 top-6 px-2.5 py-1.5 rounded-[9px] bg-zinc-900/90 text-[13px] text-zinc-100 whitespace-nowrap shadow-lg">{tip.text}</div>
        </div>
      )}
    </>
  );
}
