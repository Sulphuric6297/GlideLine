// The map view: one 3D scene that is a flat-looking map when you look straight down and a 3D
// model of the course when you tilt it (from the Security Camera Planner's map view). Navigation
// works like a web map (drag to pan, scroll or pinch to zoom at the cursor, right-drag or
// Ctrl/Shift-drag to rotate and tilt); editing works the same at any angle: click to place, drag
// things to move them, and drag the handles on the selection (doglegs, fairway width, corners).
// It can also look from a tee down its hole, and fly over a hole.
//
// Plan (x, y) is world (x, z) with Y up; plan units are feet.
import * as THREE from "three";
import CameraControls from "camera-controls";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { INK, MANDO, RESTRICTED, amenitySymbol, dropZoneSymbol, symbolSvg } from "../lib/symbols";
import { AMENITY_KINDS, AREA_KINDS, CIRCLE_ONE_FT, EYE_HEIGHT_FT, LINE_KINDS, OBJECT_ELEVATION_OFFSET, PATH_SURFACES, STAND_HERE, STAND_NEAR_FT, STRUCTURE_KINDS, TEE_LEVELS, clamp } from "../constants";
import { FAIRWAY_STATIONS, beyondSides, areaObEdges, areaRing, isRing, ringStretch, sharedWalks, teeLines, walkRoutes, autoWalks, areaCurves, areaPath, basketFor, basketHoles, curves, fairwayOutline, mergeStretches, obFor, obPicked, obRanges, widthAlong, widthFactors, widthsWithEnd, widthsWithPoint, widthsWithout, widthVaries, holeLabel, fairwayShiftAt, fairwayWidthAt, linePath, stationsOf, withStation, withoutStation, holeBaskets, holeNumber, holeTees, teeAim, throwLine } from "../lib/course";
import { boundsOf, centroid, dist, distanceToPath, distanceToPolygon, inBounds, nearestAlong, offsetPath, pathLength, pointAlong, pointBoundsGap, pointInPolygon, polygonArea, simplify, smoothPath, subPath } from "../lib/geom";
import { isOutOfPlay, parForDistance } from "../lib/holeStats";
import { heightAt } from "../lib/terrainGrid";
import { conifersOf, treeMixOf } from "../lib/landscapes";
import { LOOK_LABEL, sharesOf, standShares, type TreeLookId } from "../lib/treeMix";
import { fmtArea, fmtDist, fmtElev } from "../lib/units";
import { BASKET_BAND, createAmenity, createBasket, createDropZone, createMando, createTeePad, fitTeePad } from "../three/courseModels";
import { drapedPoints, drapedPolygon, drapedRibbon } from "../three/drape";
import { dab, strokeOutline } from "../lib/brush";
import { disposeObjectDeep } from "../three/dispose";
import { create3dTree, getTreeSignature, retuneTrees } from "../three/trees";
import { createMeasuredWoods, createUnderbrush, createWoods, createWoodsWhere } from "../three/woods";
import { standingTrees, grownTree, grownTrees } from "../lib/lidar";
import type { WoodedGrid } from "../lib/forest";
import { autoFlight, flightClock, flyoverOf, insertKey, keyFlight, keyTimes, keysFromFlight, type Air, type Canopy, type Crown, LENS } from "../lib/flight";
import { VIDEO_HOLD, titleStrength } from "../lib/video";
import { drawOverlay, holeTitle, overlayShow, type HoleTitle } from "./flyTitle";
import { forestDetail, type Forest, type TreeSpot, woodsCrownWidth } from "../three/treeKit";
import { brushOnly } from "../lib/brushSpots";
import { applyEdit, brushStroke, kindOf, levelOf, type BrushKind as PaintKind } from "../lib/areaBrush";
import { foundAreas } from "../lib/undergrowth";
import { GRASS, Grass, type GrassQuality } from "../three/grass";
import { Tufts } from "../three/tufts";
import { setWaterSky, waterMaterial, waterUniforms } from "../three/water";
import { addSurfaceDetail, layerOf, type SurfaceLayer } from "../three/groundDetail";
import { softenShadows } from "../three/softShadows";
import { treeNearFade } from "../three/ezShapes";
import { createFence, createStructure, onPartLoaded } from "../three/structures";
import { measuredStanding, setMeasuredStanding } from "../lib/standing";
import { createFieldGround, createFieldProps, createHedge, createPowerLine } from "../three/parkProps";
import { LEAGUES, cornerFrame, fieldInks, fieldPartAt, fieldPartShape, fieldPlan } from "../lib/fieldPlan";
import { fieldHome, fieldKeepsTreesOut, fieldKindOf, fieldOutline, isBallField } from "../lib/fields";
import { isLineKind, orientedBox, roofFor, structureBounds, structureHeight, structurePath, structureWidth, turnShape } from "../lib/structures";
import type { AmenityItem, AmenityKind, AreaItem, BasketItem, CourseItem, FlyKey, Hole, LabelItem, LineItem, MandoItem, StructureItem, TeeItem, TeeLevel, TreeItem, BrushKind, PathTier, FieldPart } from "../types";
import { Ground } from "./ground";
import { grassMaps, grassTerrain } from "./grassMaps";
import type { FlightFrames, FlyoverVideo, FrameInfo, RecordOptions } from "./flyoverVideo";
import type { LocationMark, P, ViewCallbacks, ViewDoc, ViewInfo, ViewTool } from "./types";
import { toast } from "../state/toast";
import { turnable } from "../lib/turn";
import { timed } from "../lib/perfLog";

CameraControls.install({ THREE });
const { ACTION } = CameraControls;

const DEG = Math.PI / 180;
// The light of ez-tree's demo (photographed leaves and bark read true under it): a strong sun, a
// soft even sky, and Neutral tone mapping at twice the exposure
const SUN_INTENSITY = 5;
/** How far inside the map's edge standing stays, ft. */
const STAND_EDGE_FT = 4;
const HEMI_INTENSITY = 0.7;
/** How wide shadows' soft edges are, in texels of the shadow picture (three/softShadows). */
const SHADOW_SOFT = 3;
/** How much the sky itself lights things (its picture as the environment: blue from above, the
 * ground's color from below), with Shadows at 65%. A studio's even light made every side as bright,
 * washing the shade out of the ground and the tee pads. */
const SKY_FILL = 0.5;
/** Told when a corner of a line or an area is pressed (its id and which corner). */
export const CORNER_EVENT = "dg-corner";
const EXPOSURE = 2;
/** How much closer underbrush grows in tall grass than under trees (out in the sun, it fills in). */
const TALL_GRASS_BRUSH = 1.8;
const CLICK_PX = 4;
/** A finger moves a little in a tap (more than a mouse in a click). */
const TOUCH_SLOP = 10;
/** Holding a finger this long on an item opens its menu (the touch right-click). */
const LONG_PRESS_MS = 500;
/** A fling's slowing, as on Google Maps: its speed falls to about a third every this many seconds. */
const GLIDE_TAU = 0.32;
/** How far two fingers twist before the map turns with them (a pinch to zoom stays as it was). */
const TWIST = 12 * DEG;
const TILT_TOP = 8 * DEG;
const DEFAULT_TILT = 55 * DEG;
const MAX_TILT = 84 * DEG;
/** The map's lens: narrow looking straight down (map-like), wider tilted (a real perspective). */
const FOV_TOP = 30, FOV_TILT = 45;
const SELECT = "#22d3ee";
type Rect = { x: number; y: number; width: number; height: number };
/** A picture on screen: the camera it's drawn with, and where (the container's pixels). */
type Eye = { cam: THREE.PerspectiveCamera; rect: Rect };
const LIFT = 0.45;

type Drag = { move: (e: PointerEvent) => void; end: (e: PointerEvent) => void };
type Handle = {
  el: HTMLDivElement;
  kind: string;
  index?: number;
  world: () => THREE.Vector3 | null;
  start: (e: PointerEvent) => Drag | null;
  visible?: () => boolean;
  /** A finger's tap on it (no double-tap for a finger): a button by it, or what a click does. */
  tap?: (h: Handle, e: PointerEvent) => void;
};
type Overlay = { el: HTMLDivElement; anchor: THREE.Vector3; dy: number; sig: string; rank: number; w?: number; h?: number; minPx?: number; key?: string };

const STYLE = `
.dg-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.dg-ov{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap}
.dg-tee{pointer-events:auto;cursor:move;min-width:22px;height:22px;padding:0 5px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--c);color:var(--ink);font:800 12px/1 Oswald,Inter,system-ui,sans-serif;border:2px solid rgba(15,23,42,.85);box-shadow:0 1px 4px rgba(0,0,0,.5)}
.dg-basket .dg-shared{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font:800 10px/1 Oswald,Inter,system-ui,sans-serif;font-style:normal;color:#fff;background:#0f172a;border-radius:6px;padding:2px 4px;white-space:nowrap}
.dg-tee.alt{min-width:15px;height:15px;font-size:9px;padding:0 3px;opacity:.9}
.dg-tee.off{min-width:11px;height:11px;font-size:0;padding:0;border-width:1.5px;opacity:.5}
.dg-basket.off{opacity:.45;scale:.7}
.dg-tee.sel,.dg-basket.sel,.dg-chip.sel{outline:3px solid ${SELECT};outline-offset:1px}
.dg-basket{pointer-events:auto;cursor:move;width:20px;height:20px;border-radius:50%;background:#0f172a;border:2.5px solid var(--c);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.dg-basket::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--c)}
.dg-basket b{position:absolute;left:15px;top:-7px;font:800 9px/1 Inter,system-ui,sans-serif;color:#fff;background:#0f172a;border-radius:4px;padding:2px 3px}
.dg-dist{pointer-events:none;padding:2px 7px;border-radius:6px;background:rgba(15,23,42,.82);color:#f8fafc;font:700 11px Inter,system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.dg-dist i{font-style:normal;color:#fde68a;margin-left:5px}
.dg-sym{pointer-events:auto;cursor:move;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55));border-radius:6px}
.dg-sym.sel{outline:3px solid ${SELECT};outline-offset:2px}
.dg-chip{pointer-events:auto;cursor:move;min-width:18px;height:18px;padding:0 4px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#fff;font:800 10px/1 Inter,system-ui,sans-serif;border:1.5px solid rgba(255,255,255,.9);box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-text{pointer-events:auto;cursor:move;font-weight:700;font-family:Inter,system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 2px #000}
.dg-area{pointer-events:none;font:700 11px Inter,system-ui,sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000;opacity:.9}
.dg-issue{pointer-events:auto;cursor:pointer;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:900 12px/1 Inter,system-ui,sans-serif;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.55)}
.dg-measure{pointer-events:none;padding:1px 6px;border-radius:6px;background:#facc15;color:#1c1917;font:700 11px Inter,system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.dg-ptmenu{position:absolute;z-index:40;transform:translate(-50%,-100%);min-height:44px;padding:0 16px;display:flex;align-items:center;border-radius:999px;background:rgba(24,24,27,.92);color:#fca5a5;font:700 14px/1 Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);white-space:nowrap;border:1px solid rgba(255,255,255,.12);pointer-events:auto}
.dg-ptmenu:disabled{color:#a1a1aa}
.dg-measure.total{background:#1c1917;color:#facc15}
.dg-me{pointer-events:none;width:20px;height:20px;border-radius:50%;background:#0a84ff;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.55);position:absolute}
.dg-me::after{content:"";position:absolute;inset:-9px;border-radius:50%;background:rgba(10,132,255,.35);animation:dgme 2s ease-out 3;opacity:0;z-index:-1}
.dg-me.dim{background:#8e8e93}.dg-me.dim::after{display:none}
.dg-me i{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:conic-gradient(from -28deg,rgba(10,132,255,.55),rgba(10,132,255,0) 56deg,rgba(10,132,255,0) 304deg,rgba(10,132,255,.55));-webkit-mask:radial-gradient(circle,#000 30%,transparent 72%);mask:radial-gradient(circle,#000 30%,transparent 72%);z-index:-2}
.dg-me.dim i{display:none}
@keyframes dgme{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.6);opacity:0}}
.dg-me-tag{pointer-events:none;padding:3px 8px;border-radius:999px;background:rgba(15,23,20,.9);color:#f8fafc;font:700 11.5px Inter,system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.dg-measure.live{background:rgba(28,25,23,.72);color:#fde68a;box-shadow:none}
.dg-mpt{pointer-events:none;width:12px;height:12px;border-radius:50%;background:#facc15;border:2.5px solid #1c1917;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.dg-mpt.live{background:#fff;opacity:.85}
.dg-h{position:absolute;left:0;top:0;pointer-events:auto;will-change:translate;box-sizing:border-box;touch-action:none}
.dg-h[data-handle=corner],.dg-h[data-handle=dogleg]{width:14px;height:14px;border-radius:50%;background:#fff;border:2.5px solid #0891b2;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=dogleg]{border-color:#f59e0b}
.dg-h[data-handle=extend]{width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #f97316;cursor:copy;display:flex;align-items:center;justify-content:center;font:700 12px/1 Inter,sans-serif;color:#f97316}.dg-h[data-handle=extend]::after{content:"+"}
.dg-h[data-handle=walkout],.dg-h[data-handle=walkin]{width:13px;height:13px;border-radius:3px;background:#e2e8f0;border:2px dashed #475569;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=flykey]{width:20px;height:20px;border-radius:6px;background:#0284c7;border:2px solid #fff;color:#fff;font:800 11px/16px Inter,system-ui,sans-serif;text-align:center;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.dg-h[data-handle=flykey]::after{content:attr(data-n)}
/* (a keyframe's camera over the + between two, when they're close: it's the one to take hold of) */
.dg-h[data-handle=flykey]{z-index:2}
.dg-h[data-handle=flyfoot]{width:12px;height:12px;border-radius:50%;background:#e0f2fe;border:2px solid #0284c7;cursor:move;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=flylook]{width:12px;height:12px;border-radius:50%;border:2.5px solid #38bdf8;background:rgba(15,23,42,.35);cursor:grab}
.dg-h[data-handle=flykey][data-on]{background:#f97316;width:24px;height:24px;font-size:12.5px;line-height:20px;box-shadow:0 0 0 3px rgba(249,115,22,.35),0 1px 4px rgba(0,0,0,.5)}
.dg-h[data-handle=flylook][data-on]{border-color:#f97316}
.dg-h[data-handle=flyadd]{width:16px;height:16px;border-radius:50%;background:rgba(2,132,199,.85);border:2px solid #fff;cursor:copy;display:flex;align-items:center;justify-content:center;font:800 13px/1 Inter,sans-serif;color:#fff;opacity:.8;box-shadow:0 1px 3px rgba(0,0,0,.5)}.dg-h[data-handle=flyadd]::after{content:"+"}.dg-h[data-handle=flyadd]:hover{opacity:1}
.dg-h[data-handle=mid]{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.6);border:2px solid #0891b2;cursor:copy}
.dg-h[data-handle=mid][data-kind=line]{border-color:#f59e0b}
.dg-h[data-handle=width]{width:13px;height:13px;border-radius:3px;background:#fff;border:2.5px solid #16a34a;cursor:ew-resize;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=linewidth]{width:12px;height:12px;border-radius:3px;background:#fff;border:2.5px solid #0284c7;cursor:ew-resize;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=widen]{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.85);border:1.5px solid #16a34a;cursor:copy;display:flex;align-items:center;justify-content:center;font:700 10px/1 Inter,sans-serif;color:#16a34a}.dg-h[data-handle=widen]::after{content:"+"}
.dg-h[data-handle=rotate]{width:24px;height:24px;border-radius:50%;background:#fff;border:2.5px solid #2563eb;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#2563eb;font:900 14px system-ui}
.dg-h[data-handle=part]{width:18px;height:18px;cursor:grab;background:#fff;border:3px solid #22d3ee;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,.55)}
.dg-h[data-handle=plate]{width:20px;height:20px;cursor:grab;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M3 3h14v8l-7 6.5L3 11z' fill='white' stroke='%230891b2' stroke-width='2.5' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
.dg-h[data-handle=radius]{width:15px;height:15px;border-radius:50%;background:#16a34a;border:2.5px solid #fff;cursor:ew-resize;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=height]{width:16px;height:22px;border-radius:5px;background:#f59e0b;border:2.5px solid #fff;cursor:ns-resize;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-marquee{position:absolute;left:0;top:0;pointer-events:none;border:1.5px dashed #f59e0b;background:rgba(245,158,11,.12);border-radius:2px;z-index:5}
.dg-stump{width:12px;height:12px;border-radius:50%;background:#8b5e3c;border:2.5px solid #f3dfc1;box-shadow:0 1px 3px rgba(0,0,0,.55);cursor:pointer;pointer-events:auto}
.dg-stump:hover{transform:scale(1.25)}
.dg-stump.kept{background:rgba(34,197,94,.35);border-color:#22c55e}
.dg-h[data-handle=obend]{width:13px;height:13px;border-radius:3px;background:#fff;border:3px solid #dc2626;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=obmark]{width:13px;height:13px;border-radius:50%;background:#dc2626;border:2.5px solid #fff;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.dg-h[data-handle=draw]{width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #f59e0b;pointer-events:none}
.dg-h[data-handle=draw][data-index="0"]{width:14px;height:14px;pointer-events:auto;cursor:pointer;border-width:3px}
@media (pointer:coarse){.dg-h{transform-origin:center}.dg-h[data-handle]{scale:1.5}.dg-h[data-handle]::before{content:"";position:absolute;left:50%;top:50%;width:30px;height:30px;translate:-50% -50%;border-radius:50%}.dg-tee::before,.dg-basket::before,.dg-sym::before,.dg-chip::before{content:"";position:absolute;inset:-10px}}
`;

const lineMats = new Set<LineMaterial>();
/** A finger is the main pointer (handles are drawn bigger there). */
const COARSE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** How high woods' trees reach, ft (the tallest of three/woods). */
/** How close to a trunk counts, ft (flyovers ease around trunks). */
const TRUNK_ROOM = 8;
/** A basket's height, ft, and how tall it shows on screen (px) once its badge gives way to it in 3D. */
const BASKET_FT = 4.6, BASKET_SEEN_PX = 24;
/** Squares the trees are filed by for flyovers, ft. */
const CROWN_CELL = 40;

/** A point on a smooth curve (Catmull-Rom) through points, `u` (0..1) of the way from point i to the next. */
const curveBetween = (pts: THREE.Vector3[], i: number, u: number, out: THREE.Vector3) => {
  const n = pts.length - 1;
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i)], c = pts[Math.min(n, i + 1)], d = pts[Math.min(n, i + 2)];
  const f = (p0: number, p1: number, p2: number, p3: number) => p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
  return out.set(f(a.x, b.x, c.x, d.x), f(a.y, b.y, c.y, d.y), f(a.z, b.z, c.z, d.z));
};

/** The painted map for the ground (a picture's URL) and where it shows woods. */
export type PaintedLook = { url: string; wooded: WoodedGrid | null };
/** A sharper painting of part of the site (see state/paintedGround: paintedDetail). */
export type PaintedDetailLook = { canvas: HTMLCanvasElement; rect: { x: number; y: number; width: number; height: number } };

const gridIds = new WeakMap<object, number>();
let nextGridId = 1;
/** A short name for a woods grid (it is only ever replaced, never changed). */
const idOfGrid = (g: object) => {
  if (!gridIds.has(g)) gridIds.set(g, nextGridId++);
  return gridIds.get(g)!;
};

/** The longest a flyover waits for the course to load before it flies anyway. */
const FLY_WAIT_MS = 15_000;
// Whether three.js's loaders still have textures on their way
let loadingTextures = 0;
THREE.DefaultLoadingManager.onStart = () => { loadingTextures++; };
THREE.DefaultLoadingManager.onLoad = () => { loadingTextures = 0; };
const texturesLoading = () => loadingTextures > 0;

export class CourseView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: CameraControls;
  private sun = new THREE.DirectionalLight(0xfff6e5, SUN_INTENSITY);
  private hemi = new THREE.HemisphereLight(0xeef4ff, 0x6b6250, HEMI_INTENSITY);
  private ground: Ground;
  private itemsGroup = new THREE.Group();
  private shapesGroup = new THREE.Group();
  /** Other courses on the same ground: their holes, drawn faintly over this one's map. */
  private nearbyGroup = new THREE.Group();
  private fx = new THREE.Group();
  private labelsLayer: HTMLDivElement;
  private handlesLayer: HTMLDivElement;
  private objects = new Map<string, { obj: THREE.Object3D; sig: string }>();
  private shapes = new Map<string, { obj: THREE.Object3D; sig: string }>();
  private overlays = new Map<string, Overlay>();
  private handles: Handle[] = [];
  private handleKey = "";
  private selectionFx: THREE.Object3D | null = null;
  /** Things picked together (each outlined; dragging one moves them all). */
  private group: string[] = [];
  /** The box being drawn to pick things with. */
  private marquee: HTMLDivElement | null = null;
  private hoverFx: THREE.Object3D | null = null;
  /** Tee view, editing: a press on a thing picks or drags it as on the map; on open ground it
   * looks around. With the map from above in a corner ("small", "big"), or none. */
  private teeEdit = false;
  /** Standing, editing: what a tap does, walk there or pick the thing tapped (never both). */
  private standTap: "walk" | "edit" = "walk";
  private miniSize: "small" | "big" | "corner" | null = null;
  /** The corner map's place (the container's pixels; null: none shown) and its camera. */
  private miniRect: Rect | null = null;
  private miniCam = new THREE.PerspectiveCamera(40, 1, 1, 200000);
  /** Standing somewhere other than the tee (and which way: radians on the plan), and a walk there. */
  private povStand: { x: number; y: number; face: number } | null = null;
  private walk: { from: P; to: P; t0: number } | null = null;
  /** Standing: the ring where a click would step, the ring where the person would land (on the
   * map), and the tip by the pointer saying what a click does. */
  private stepRing: THREE.Object3D | null = null;
  private dropRingFx: THREE.Object3D | null = null;
  private povTip: HTMLDivElement | null = null;
  /** The picture a drag began in (its camera and place), kept until it's let go. */
  private dragEye: Eye | null = null;
  /** The picture being looked at by what's worked out now (a pick at a pointer). */
  private eye: Eye | null = null;
  /** What others in the course have picked (their color; strong while they drag it), outlined. */
  private others: { id: string; color: string; strong: boolean }[] = [];
  private othersFx: THREE.Object3D | null = null;
  private ghost: THREE.Object3D | null = null;
  private ghostKey = "";
  private lastCorner: { id: string; index: number; time: number } | null = null;
  private doc: ViewDoc | null = null;
  private heightsVersion = 0;
  private heightsRef: unknown = null;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private tool: ViewTool = { mode: "select", areaKind: "ob", lineKind: "ob", shape: "points" };
  private teeLevel: TeeLevel = "blue";
  /** What the Amenities tool places (its preview is one). */
  private amenityKind: AmenityKind = "bench";
  private raycaster = new THREE.Raycaster();
  private dirty = true;
  private shadowsDirty = true;
  private raf = 0;
  private clock = new THREE.Clock();
  private size = { width: 1, height: 1 };
  private pose: "top" | "tilt" = "top";
  private posePinned = false;
  private dragging = false;
  private spaceDown = false;
  private restoreLeft: (() => void) | null = null;
  private viewListeners = new Set<(info: ViewInfo) => void>();
  private lastViewKey = "";
  private fitted = false;
  private ro: ResizeObserver;
  private hoverFrame = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private disposers: (() => void)[] = [];
  private sky: THREE.Texture;
  // Drawing a new hole, area or line
  private holeStart: P | null = null;
  private drawPts: P[] = [];
  private cursor: P | null = null;
  /** A rectangle or circle being made with two clicks: where the first click was. */
  private shapeAnchor: { x: number; y: number; shape: "box" | "circle" } | null = null;
  private draft: THREE.Object3D | null = null;
  private draftLabel: HTMLDivElement | null = null;
  /** Said by the drawing instead of its length, until the next point (a basket too close to the
   * tee, a shape finished with too few points). */
  private draftNote = "";
  // Tee view and flyover
  private povCam = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 30000);
  private povHole: string | null = null;
  /** The tee the tee view stands on, when it isn't the layout's. */
  private povTee: string | null = null;
  private povLook = { yaw: 0, pitch: 0 };
  /** The camera flown by hand, first person (making keyframes): where it is, which way it faces
   * (plan angle and up/down, radians), and what moves it (the keys held, the joystick: forward,
   * right, up, each -1 to 1; faster). */
  private free: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
  private freeIn = { f: 0, s: 0, u: 0, fast: false };
  /** The tee view's lens before flying by hand (put back after). */
  private freeWas = 62;
  /** The selected hole's picked keyframe (its handle stands out). */
  private flyKeyOn: number | null = null;
  /** The keyframe camera last taken hold of, and when (twice quickly looks through it). */
  private keyTap: { i: number; t: number } | null = null;
  /** A flight under way: `dur` s of path, played over `play` s (`at`: path time at a moment; see flightClock). */
  /** A flyover holds its first picture until the hole's detail and textures are in and a few
   * frames are drawn (so it looks right from the start), ten seconds at most. */
  private flyWait: { since: number; loaded: boolean; frames: number } | null = null;
  /** Slow pieces (woods, underbrush, the measured trees) waiting to be made: a few each frame
   * while the view is still, so opening a course or changing it never holds the page for the whole
   * lot at once (on a phone that was half a minute); what was there stays until its new one's in. */
  private slowQueue = new Map<string, { sig: string; make: () => THREE.Object3D | null; group: THREE.Group }>();
  /** Something new made, not yet drawn once with every level of detail showing (see warmUp). */
  private needWarm = true;
  private warmed = new WeakSet<THREE.Object3D>();
  private detailReady: Promise<unknown> = Promise.resolve();
  private fly: { pts: THREE.Vector3[]; look: THREE.Vector3[]; fov: number[]; t: number; dur: number; play: number; at: (t: number) => number; done?: () => void; title?: HoleTitle } | null = null;
  /** A hole whose line is being plotted by hand, and its turns so far (from the tee). */
  private plotHole: string | null = null;
  /** Marking a stretch of OB along a line: the line, and where along it the stretch starts (0..1). */
  private obPick: { id: string; from: number | null; cut: boolean } | null = null;
  /** While marking a stretch round a ring: how far round the pointer has gone from its start (and
   * where it was last), which way the stretch goes; and the stretch shown so far. */
  private obTravel = { sum: 0, last: 0 };
  private obPreview: THREE.Object3D | null = null;
  /** The trees measured from the air that are cut down (cleared for play, or taken out), and those
   * kept standing where they would be (by index). */
  private lidarState: { stand: number[]; cut: number[]; kept: number[] } | null = null;
  /** Slow things (woods planted round the clearings) put off while dragging: done at its end. */
  private afterDrag = false;
  /** Shadows to draw again once a drag ends (held while dragging). */
  private shadowsAfterDrag = false;
  /** Woods planted so far (for tests: none while dragging, only those near what moved). */
  private plantings = 0;
  private lidarKey = "";
  /** Where the course clears the ground for play (fairways, tees, baskets, water, paths). */
  private clearedAt: (p: P, reach: number) => boolean = () => false;
  private plotPts: P[] = [];
  private lastPlotClick: { x: number; y: number; time: number } | null = null;
  /** The last press on a walk's end (a second one soon after resets it). */
  private lastWalkTap: { key: string; time: number } | null = null;
  /** The tee view's field of view, kept while a flight sets its own. */
  private povFov = 62;
  private skyBox: Sky;
  /** The photographed sky (public/sky), in place of the sky model while the sun is up: the one
   * whose own sun is nearest the course's in height, turned so its sun is where the light comes
   * from (see photoSkyFor). Null until its picture has come. */
  private photoSky: THREE.Mesh | null = null;
  private photoSkyName = "";
  private skyAsked = false;
  /** The photo sky's own color at the horizon: the haze takes it, so the land far off fades into it. */
  private skyHorizon: THREE.Color | null = null;
  private skyPhotos: Record<string, { sunU: number; sunV: number; average: string }> | null = null;
  /** Grass blades near the camera, in 3D (see three/grass). */
  readonly grass = new Grass();
  /** Tufts of grass and wildflowers (ez-tree's demo's) among the blades. */
  readonly tufts = new Tufts(this.grass);
  private grassInputs: unknown[] = [];
  /** The sky as an environment for water to reflect (made again when the sun moves). */
  private skyEnv: THREE.WebGLRenderTarget | null = null;
  private skyEnvKey = "";
  /** Ponds, for the pictures of all round them they mirror (see pictureStep), the biggest first. */
  private ponds = new Map<THREE.Mesh, { color: string; shore: [string, number]; bottom: string; at: THREE.Vector3; size: number; done: boolean; env?: THREE.WebGLRenderTarget }>();
  private pondsDirty = false;
  /** A pond's picture being taken: a side at a time, while the view is still. */
  private picturing: { mesh: THREE.Mesh; cube: THREE.CubeCamera; rt: THREE.WebGLCubeRenderTarget; face: number } | null = null;
  private pictureAt = 0;
  private grassBuilt = 0;
  private grassTimer = 0;
  private lastSky = false;
  private readonly haze = new THREE.FogExp2(0xffffff, 0);
  private grassTerrainRef: unknown = null;
  private grassPhoto: unknown = null;
  private grassSetting: GrassQuality | "auto" = "auto";
  private wind = true;
  /** Drawn without a graphics card (software rendering): the grass starts off. */
  readonly software: boolean;
  /** A phone or small tablet (touch first, small screen). */
  readonly mobile: boolean;
  private maxRatio = 1;
  private tier = 0;
  private perfSamples: number[] = [];
  private fastWindows = 0;
  private lastRender = 0;
  /** The last tick drew a picture (two in a row: the gap between them is a real frame time). */
  private drewLastTick = false;
  /** Recordings under way (their frames come first: the screen is drawn less often meanwhile). */
  private recordings = 0;
  private adaptiveForced = false;
  private paused = false;
  private frames = 0;
  private povMarker: HTMLDivElement | null = null;
  private disposed = false;

  private offParts = onPartLoaded(() => this.invalidate(true));

  constructor(private container: HTMLDivElement, private cb: ViewCallbacks) {
    // (no preserveDrawingBuffer: snapshots render and read in one go, and keeping the buffer
    // costs frame rate on phone GPUs)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    // Phones and tablets: a little less sharp (their screens are dense; every pixel costs)
    this.mobile = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2);
    this.renderer.setPixelRatio(this.maxRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    // (PCF soft, widened with a graphics card: three/softShadows, below. VSM, the shadow picture
    // blurred as it's made, put a phone's whole ground in shade on the live demo)
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.display = "block";
    container.appendChild(canvas);

    if (!document.getElementById("dg-view-style")) {
      const style = document.createElement("style");
      style.id = "dg-view-style";
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.labelsLayer = document.createElement("div");
    this.labelsLayer.className = "dg-layer";
    this.handlesLayer = document.createElement("div");
    this.handlesLayer.className = "dg-layer";
    container.appendChild(this.labelsLayer);
    container.appendChild(this.handlesLayer);

    // A dusky backdrop behind the site, the deep green of the woods (the app's palette)
    {
      const c = document.createElement("canvas");
      c.width = 2;
      c.height = 256;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#0e1810");
      grad.addColorStop(0.6, "#16261a");
      grad.addColorStop(1, "#203524");
      g.fillStyle = grad;
      g.fillRect(0, 0, 2, 256);
      this.sky = new THREE.CanvasTexture(c);
      this.sky.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = this.sky;
    }
    // Daylight sky (a physical sky model lit by the course's sun) and the ground out to the
    // horizon, for the tilted view and the view from a tee
    {
      this.skyBox = new Sky();
      const sm = this.skyBox.material as THREE.ShaderMaterial;
      Object.assign(sm.uniforms, { turbidity: { value: 3.2 }, rayleigh: { value: 1.1 }, mieCoefficient: { value: 0.004 }, mieDirectionalG: { value: 0.82 } });
      // The model is bright: brought down to the scene's exposure
      sm.uniforms.uHaze = { value: new THREE.Color("#c4d0d9") };
      // Brought down to the scene's exposure, and melting into the haze at the horizon (where the
      // land fades into the same haze)
      sm.fragmentShader = sm.fragmentShader
        .replace("uniform vec3 up;", "uniform vec3 up;\nuniform vec3 uHaze;")
        .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb = mix( uHaze, gl_FragColor.rgb * 0.46, smoothstep( -0.02, 0.2, direction.y ) );\n#include <tonemapping_fragment>");
      this.skyBox.renderOrder = -10;
      this.skyBox.visible = false;
      this.skyBox.frustumCulled = false;
      this.skyBox.raycast = () => {};
    }
    // (the sky's own light once it's pictured, updateSkyEnv; none before)
    this.scene.environment = null;
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    // (how wide the soft edge is, in texels of the shadow picture: three/softShadows)
    this.sun.shadow.radius = SHADOW_SOFT;
    this.sun.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    this.scene.add(this.sun, this.sun.target);
    // Two lines no one sees, kept for good: three.js drops a shader once nothing uses it, and a
    // lone outline (a selected shape's, redrawn as it is dragged) would otherwise have the fat
    // lines' shaders built again on every move, seconds each on a slow graphics chip
    for (const dashed of [undefined, 1]) {
      const keep = this.fatLine([new THREE.Vector3(0, -5000, 0), new THREE.Vector3(0.01, -5000, 0)], "#000000", 1, { dashed, opacity: 0 });
      keep.frustumCulled = false;
      this.scene.add(keep);
    }

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 40000);
    this.controls = new CameraControls(this.camera, canvas);
    const c = this.controls;
    void c.setLookAt(800, 2400, 550, 800, 0, 550, false);
    c.mouseButtons.left = ACTION.NONE;
    c.mouseButtons.middle = ACTION.ROTATE;
    c.mouseButtons.right = ACTION.ROTATE;
    c.mouseButtons.wheel = ACTION.NONE;
    c.touches.one = ACTION.NONE; // (one finger is handled here too: see panDrag)
    c.touches.two = ACTION.NONE; // (two fingers are handled here: see twoFingers)
    c.touches.three = ACTION.TOUCH_TRUCK;
    c.minPolarAngle = 0;
    c.maxPolarAngle = MAX_TILT;
    c.smoothTime = 0.16;
    c.draggingSmoothTime = 0.06;
    c.azimuthRotateSpeed = 0.7;
    c.polarRotateSpeed = 0.7;
    c.dollyToCursor = true;
    c.addEventListener("controlend", () => this.snapNorth());
    c.addEventListener("controlstart", () => { this.posePinned = false; this.autoFit = null; this.onUserMove?.(); });
    c.addEventListener("rest", () => { this.posePinned = false; });

    this.ground = new Ground(this.renderer, () => this.invalidate(true));
    this.scene.add(this.ground.group, this.shapesGroup, this.itemsGroup, this.nearbyGroup, this.fx, this.skyBox, this.grass.group, this.tufts.group);
    // (the scene and the items' group never move. A frame works out again only the woods' matrices
    // (their trees near the camera change); each item's are set as it's placed)
    this.scene.matrixAutoUpdate = false;
    this.itemsGroup.matrixAutoUpdate = false;
    this.itemsGroup.updateMatrixWorld = force => {
      for (const c of this.itemsGroup.children) if (!c.userData.placed || force) c.updateMatrixWorld(force);
    };
    {
      const gl = this.renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      // (hyzerlab-gpu=1 in the browser: drawn as with a graphics card anyway, for a picture of it on a test machine)
      let asIf = false;
      try { asIf = localStorage.getItem("hyzerlab-gpu") === "1"; } catch { /* no storage */ }
      this.software = !asIf && /swiftshader|llvmpipe|software|basic render/i.test(name);
      // Without a graphics card, or on a phone, fewer trees in full detail
      if (this.software) forestDetail.nearFt = 70;
      // (soft shadow edges: 32 looks a pixel, too many to do in software every frame)
      if (!this.software) softenShadows(this.mobile);
      else if (this.mobile) forestDetail.nearFt = 150;
    }

    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(container, "pointerdown", e => this.onPointerDown(e), { capture: true });
    on(container, "wheel", e => this.onWheel(e), { capture: true, passive: false });
    on(container, "pointermove", e => this.onHoverMove(e));
    on(container, "pointerleave", () => { this.lastPointer = null; this.cb.onHover(null); this.setHover(null); this.restKey = ""; window.clearTimeout(this.restTimer); this.updateGhost(null); this.showStep(null); this.tip(null); this.invalidate(); });
    on(container, "dblclick", e => this.onDoubleClick(e));
    on(window, "pointerup", e => this.touchUp(e));
    on(window, "pointercancel", e => this.touchUp(e));
    on(container, "contextmenu", e => e.preventDefault());
    // (Space held with the pointer over the map moves it with a drag: the button last clicked,
    // which still has the focus, isn't pressed by it)
    on(window, "keydown", e => {
      if (e.key !== " " || (e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable=true]")) return;
      this.spaceDown = true;
      if (this.lastPointer && !(e.target as HTMLElement)?.closest?.("[role=dialog]")) e.preventDefault();
    });
    on(window, "keyup", e => {
      if (e.key !== " ") return;
      if (this.spaceDown && this.lastPointer && !(e.target as HTMLElement)?.closest?.("[role=dialog]")) e.preventDefault();
      this.spaceDown = false;
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ public API

  setDoc(doc: ViewDoc) {
    const prev = this.doc;
    this.doc = doc;
    if (doc.heights !== this.heightsRef) {
      this.heightsRef = doc.heights;
      this.heightsVersion++;
    }
    const groundChanged = this.ground.update(doc);
    this.syncItems();
    this.syncShapes();
    this.syncSelection();
    this.syncOthers();
    this.syncOverlays();
    this.syncHandles();
    this.updateLimits();
    this.placeSun();
    // (while a point or a shape is dragged, the shadows stay as they were until it's let go: every
    // tree and bush drawn again into them at each step makes a big wood crawl)
    if (groundChanged || !prev || prev.sun !== doc.sun) this.shadowsDirty = true;
    else if (prev.course.items !== doc.course.items) { if (this.dragging) this.shadowsAfterDrag = true; else this.shadowsDirty = true; }
    if (!this.fitted && this.size.width > 1) {
      this.fitted = true;
      this.fitCourse(false);
    }
    if (this.holeStart || this.drawPts.length) this.drawDraft();
    this.invalidate();
  }

  setGroup(ids: string[]) {
    if (ids.length === this.group.length && ids.every((x, i) => x === this.group[i])) return;
    this.group = ids;
    this.syncSelection();
    this.syncOverlays();
    this.invalidate();
  }

  /** Other courses on the same ground: each one's holes (tee to basket, in this course's plan
   * coordinates) in its color. */
  setNearby(courses: { color: string; lines: P[][] }[]) {
    for (const o of [...this.nearbyGroup.children]) { this.nearbyGroup.remove(o); disposeObjectDeep(o); }
    // (a hole's number, beside its tee, in the course's color)
    const number = (n: number, color: string, p: P) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d")!;
      g.fillStyle = color;
      g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#111"; g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(n), 32, 34);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
      s.scale.set(16, 16, 1);
      s.position.set(p.x, this.h(p.x, p.y) + 10, p.y);
      s.renderOrder = 8;
      return s;
    };
    for (const c of courses) {
      c.lines.forEach((l, i) => { if (l.length >= 2) this.nearbyGroup.add(number(i + 1, c.color, l[0])); });
      for (const l of c.lines) {
        if (l.length < 2) continue;
        this.nearbyGroup.add(this.fatLine(this.drapeLine(l, LIFT + 0.3), c.color, 3, { dashed: 10, opacity: 0.9, order: 6 }));
        for (const [p, r] of [[l[0], 5], [l[l.length - 1], 4]] as const) {
          const dot = new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.95, depthTest: false }));
          dot.rotation.x = -Math.PI / 2;
          dot.position.set(p.x, this.h(p.x, p.y) + LIFT + 0.4, p.y);
          dot.renderOrder = 7;
          this.nearbyGroup.add(dot);
        }
      }
    }
    this.invalidate();
  }

  /** View only (a course shared to look at): no handles on the selection. */
  private readOnly = false;
  setReadOnly(on: boolean) {
    if (on === this.readOnly) return;
    this.readOnly = on;
    if (on) {
      // (nothing half drawn, plotted or marked goes on)
      if (this.plotHole) this.endPlot();
      if (this.obPick) this.endObPick();
      this.clearDrawing();
      this.setTool(this.tool);
    }
    this.syncHandles();
    if (this.doc) { this.syncShapes(); this.syncOverlays(); this.invalidate(); }
  }

  /** Every tree out of sight (placed, measured, the woods' and their underbrush), to see the photo
   * under them while mapping; none picked while they're hidden. */
  private treesHidden = false;
  private treesShownAt = false;
  setTreesHidden(on: boolean) {
    if (on === this.treesHidden) return;
    this.treesHidden = on;
    this.shadowsDirty = true;
    this.invalidate();
  }
  private showTrees() {
    const hide = this.treesHidden;
    for (const [key, entry] of this.shapes) {
      const under = /:under(:|$)/.test(key);
      if (under || key.startsWith("woods:") || key === "painted-woods") entry.obj.visible = !hide && !(under && this.dragging);
    }
    const doc = this.doc;
    if (doc) for (const item of doc.course.items) if (item.type === "tree") { const e = this.objects.get(item.id); if (e) e.obj.visible = !hide; }
  }

  /** The stumps of cut-down trees everywhere (close enough to see), not only on the hole picked. */
  private showStumps = false;
  setShowStumps(on: boolean) {
    if (on === this.showStumps) return;
    this.showStumps = on;
    this.invalidate();
  }

  /** The hole a thing is part of (its tee, its basket), for a map only looked at: only holes are
   * picked there. */
  private holeFor(id: string | null): string | null {
    if (!id) return null;
    if (this.hole(id)) return id;
    const it = this.item(id);
    return it && (it.type === "tee" || it.type === "basket") ? it.holeId ?? null : null;
  }

  setSelection(id: string | null) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.syncSelection();
    this.syncOverlays();
    this.syncHandles();
    this.syncShapes();
    this.invalidate();
  }

  /** The tool in use; `teeLevel`: the color a tee goes down in, `amenityKind`: what an amenity is
   * (both for the preview under the pointer). */
  setTool(tool: ViewTool, teeLevel = this.teeLevel, amenityKind = this.amenityKind) {
    // (view only: Select, and Measure, which changes nothing)
    if (this.readOnly && tool.mode !== "select" && tool.mode !== "measure") tool = { ...tool, mode: "select" };
    const leaving = tool.mode !== this.tool.mode || this.drawn(tool) !== this.drawn();
    this.teeLevel = teeLevel;
    this.amenityKind = amenityKind;
    if (leaving && this.tool.mode === "measure") this.clearMeasure();
    if (leaving || tool.shape !== this.tool.shape) {
      if (this.plotHole) this.endPlot();
      // (marking a stretch of OB goes on in Select, which it starts in)
      if (this.obPick && tool.mode !== "select") this.endObPick();
      this.clearDrawing();
    }
    this.tool = tool;
    if (tool.mode === "select") this.updateGhost(null);
    // (painting underbrush: each patch tinted by how thick it is, as Look first shows it)
    const k = this.paintKind(), tint = !!k?.brush;
    if (tint !== this.brushTint) { this.brushTint = tint; if (this.doc) this.syncShapes(); }
    if (this.doc) this.syncSelection();
    this.updateCursor();
    this.handleKey = "";
    this.syncHandles();
    this.invalidate();
  }

  /** Underbrush tinted by its level (while it's being painted). */
  private brushTint = false;
  /** What the brush paints: the area being reshaped's kind, or the tool's (a stand of bushes is
   * underbrush); null when it isn't painting areas. */
  private paintKind(): PaintKind | null {
    const t = this.tool;
    if (t.mode !== "draw-area" || t.shape !== "paint") return null;
    const own = t.reshape ? this.item(t.reshape) : null;
    if (own && own.type === "area") return kindOf(own);
    return { kind: t.areaKind, brush: t.areaKind === "woods" && t.standOf === "bush" };
  }

  onView(fn: (info: ViewInfo) => void) {
    this.viewListeners.add(fn);
    fn(this.viewInfo());
    return () => this.viewListeners.delete(fn);
  }

  invalidate(shadows = false) {
    this.dirty = true;
    if (shadows) this.shadowsDirty = true;
  }

  /** Look straight down (2D) or tilt into 3D, animated. */
  setPose(pose: "top" | "tilt", animate = true, fromUser = false) {
    const polar = this.controls.polarAngle;
    this.pose = pose;
    this.posePinned = true;
    if (fromUser) this.cb.onPose(pose);
    if (pose === "top") {
      if (polar < 1e-3 && Math.abs(this.wrappedAzimuth()) < 1e-3) return;
      void this.controls.rotateTo(this.northAzimuth(), 0, animate);
    } else if (polar <= TILT_TOP) {
      void this.controls.rotatePolarTo(DEFAULT_TILT, animate);
    }
    this.invalidate();
  }

  resetNorth() {
    void this.controls.rotateAzimuthTo(this.northAzimuth(), true);
  }

  private northAzimuth() {
    return this.controls.azimuthAngle - this.wrappedAzimuth();
  }

  /** Turn the view; positive turns the heading clockwise (the map turns the other way). */
  rotateBy(deg: number) {
    void this.controls.rotate(-deg * DEG, 0, true);
  }

  tiltBy(deg: number) {
    void this.controls.rotate(0, -deg * DEG, true);
  }

  /** How far in the map is zoomed: 0 all the way out, 1 all the way in (even steps for even
   * changes of scale). */
  zoomLevel() {
    const lo = this.controls.minDistance, hi = this.controls.maxDistance;
    return clamp(Math.log(hi / this.controls.distance) / Math.log(hi / lo), 0, 1);
  }

  /** Zooms to a level (see zoomLevel), about the middle of the open map, at once (a slider). */
  setZoomLevel(t: number) {
    const lo = this.controls.minDistance, hi = this.controls.maxDistance;
    const want = hi * Math.pow(lo / hi, clamp(t, 0, 1));
    const m = this.openMap(), r = this.container.getBoundingClientRect();
    this.userMoved();
    this.zoomAt(r.left + (m.left + m.right) / 2, r.top + (m.top + m.bottom) / 2, want / this.controls.distance, false);
  }

  zoomBy(factor: number) {
    const d = this.controls.distance / factor;
    void this.controls.dollyTo(clamp(d, this.controls.minDistance, this.controls.maxDistance), true);
  }

  /** Fit plan bounds in view, keeping the current rotation and tilt. */
  /** Pixels on the right covered by a panel: fitting keeps things clear of them. */
  rightInset = 0;
  /** Pixels on the left covered by a panel (the holes column). */
  leftInset = 0;
  /** The fit the map was last put at, until it is moved by hand. */
  private autoFit: (() => void) | null = null;
  /** A panel over the map's left side shown or gone: the map slides over by half of it, so what
   * was in the middle stays in the middle of what can be seen. */
  setLeftInset(px: number) {
    const delta = px - this.leftInset;
    this.leftInset = px;
    if (!delta || !this.fitted || this.size.height < 2) return;
    // (still as fitted, untouched: fitted again, around the panel)
    if (this.autoFit) return this.autoFit();
    const worldPerPx = (2 * this.controls.distance * Math.tan((this.camera.fov * DEG) / 2)) / this.size.height;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < 1e-6) return;
    right.normalize().multiplyScalar(-(delta / 2) * worldPerPx);
    const t = this.controls.getTarget(new THREE.Vector3(), true).add(right);
    void this.controls.moveTo(t.x, t.y, t.z, false);
    this.controls.update(0);
    this.camera.updateMatrixWorld();
    this.invalidate();
  }
  /** Pixels at the bottom and top covered by panels (a phone's bottom sheet; its top bar). */
  bottomInset = 0;
  topInset = 0;

  /** The plan offset that moves a point from the screen's middle to the middle of the part of the
   * map between the top and bottom panels, at `dist` from the camera. */
  private insetShift(dist: number) {
    const below = clamp(this.bottomInset, 0, this.size.height * 0.6), above = clamp(this.topInset, 0, this.size.height * 0.3);
    if (below === above) return { x: 0, y: 0 };
    const worldPerPx = (2 * dist * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, this.size.height);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    up.y = 0;
    if (up.lengthSq() > 1e-6) up.normalize();
    const k = ((below - above) / 2) * worldPerPx / Math.max(0.35, Math.cos(this.controls.polarAngle));
    return { x: -up.x * k, y: -up.z * k };
  }

  fitBounds(b: { minX: number; minY: number; maxX: number; maxY: number }, opts: { minSpan?: number; margin?: number; animate?: boolean } = {}) {
    const doc = this.doc;
    if (!doc) return;
    this.autoFit = null;
    this.glide = null;
    const margin = opts.margin ?? 1.2;
    const minSpan = opts.minSpan ?? 0;
    const w = Math.max(b.maxX - b.minX, minSpan, 1) * margin;
    const d = Math.max(b.maxY - b.minY, minSpan * 0.6, 1) * margin;
    const inset = clamp(this.rightInset, 0, this.size.width * 0.5);
    const leftIn = clamp(this.leftInset, 0, this.size.width * 0.3);
    const covered = clamp(this.bottomInset, 0, this.size.height * 0.6) + clamp(this.topInset, 0, this.size.height * 0.3);
    const H = Math.max(1, this.size.height);
    const aspect = Math.max(1, this.size.width - inset - leftIn) / H;
    const t = Math.tan((this.camera.fov * DEG) / 2);
    const dist = clamp(Math.max(d / (2 * t), w / (2 * t * aspect)) * (H / Math.max(1, H - covered)), this.controls.minDistance, this.controls.maxDistance);
    let cx = (b.minX + b.maxX) / 2;
    let cy = (b.minY + b.maxY) / 2;
    const worldPerPx = (2 * dist * t) / H;
    if (inset !== leftIn) {
      // Look a little off the middle, so the middle lands in the visible part
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      right.y = 0;
      if (right.lengthSq() > 1e-6) right.normalize();
      const off = (inset - leftIn) / 2;
      cx += right.x * off * worldPerPx;
      cy += right.z * off * worldPerPx;
    }
    // (And between the top and bottom panels)
    const shift = this.insetShift(dist);
    cx += shift.x;
    cy += shift.y;
    const animate = opts.animate ?? true;
    void this.controls.moveTo(cx, this.h(cx, cy), cy, animate);
    void this.controls.dollyTo(dist, animate);
    // (not animated: there at once, not at the next frame)
    if (!animate) {
      this.controls.update(0);
      this.camera.updateMatrixWorld();
    }
    this.invalidate();
  }

  fitSite(animate = true) {
    const doc = this.doc;
    if (!doc) return;
    this.fitBounds({ minX: 0, minY: 0, maxX: doc.canvas.width, maxY: doc.canvas.height }, { margin: 1, animate });
    this.autoFit = () => this.fitSite(false);
  }

  /** Fit the holes (or the whole site when there are none). */
  fitCourse(animate = true) {
    const doc = this.doc;
    if (!doc) return;
    const pts = doc.course.items.filter(i => i.type === "tee" || i.type === "basket") as P[];
    if (pts.length < 2) return this.fitSite(animate);
    this.fitBounds(boundsOf(pts), { margin: 1.25, minSpan: 300, animate });
    this.autoFit = () => this.fitCourse(false);
  }

  /** Fit one hole (tee to basket, with its fairway). */
  fitHole(holeId: string, animate = true) {
    const doc = this.doc;
    const s = doc?.stats.find(x => x.holeId === holeId);
    if (!doc || !s || !s.line.length) return;
    const hole = doc.course.holes.find(h => h.id === holeId);
    const pad = (hole?.fairwayWidth ?? 30) / 2 + 30;
    const b = boundsOf(s.line);
    this.fitBounds({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, { margin: 1.15, minSpan: 160, animate });
  }

  /** Brings a picked item or hole into view: the map slides, it never zooms (the owner's rule:
   * picking, from the map, a list, Search or the arrows, keeps the zoom it's at). */
  reveal(id: string) {
    this.frame(id);
  }

  /** Zooms to show the whole of an item, only when that's asked for (Zoom to it, F). */
  zoomTo(id: string) {
    const b = this.itemBounds(id);
    if (b) this.fitBounds(b, { margin: 1.3, minSpan: 120 });
  }


  /** The part of the map between the panels (container pixels). */
  private openMap() {
    const top = clamp(this.topInset, 0, this.size.height * 0.3), bottom = this.size.height - clamp(this.bottomInset, 0, this.size.height * 0.6);
    return { left: this.leftInset, top, right: this.size.width - this.rightInset, bottom };
  }

  /** Whether any of an item or hole shows on the open part of the map. */
  inView(id: string) {
    const box = this.screenBox(id), m = this.openMap();
    return !!box && box.x + box.width > m.left && box.x < m.right && box.y + box.height > m.top && box.y < m.bottom;
  }

  /** A thing picked on a phone, brought onto the open part of the map at the zoom it's at: picking
   * never zooms, in or out (the owner's rule: what you tapped stays the size it was). Out from under
   * a panel or in from off screen, its middle to the open map's middle; a thing bigger than the open
   * map that partly shows already stays put. */
  frame(id: string) {
    const b = this.itemBounds(id);
    if (!b) return;
    const box = this.screenBox(id), m = this.openMap();
    if (box && box.x >= m.left && box.y >= m.top && box.x + box.width <= m.right && box.y + box.height <= m.bottom) return;
    const big = !!box && (box.width > m.right - m.left || box.height > m.bottom - m.top);
    if (big && this.inView(id)) return;
    // (tilted, a thing partly showing above the panel stays put: sliding it up a tilted view sends
    // it off toward the horizon, smaller, which looks like a zoom out)
    if (this.controls.polarAngle > TILT_TOP && this.inView(id)) return;
    const ix = (b.minX + b.maxX) / 2, iy = (b.minY + b.maxY) / 2;
    const to = this.targetPutting({ x: ix, y: iy }, (m.left + m.right) / 2, (m.top + m.bottom) / 2);
    this.glide = null;
    void this.controls.moveTo(to.x, this.h(to.x, to.y), to.y, true);
    this.invalidate();
  }

  /** Where the camera's target goes so a ground spot shows at a screen point (container pixels),
   * the camera keeping its height, tilt and turn: exactly, from a ray through that point (on the
   * target's own level), so it's slid no farther than it needs. */
  private targetPutting(at: P, px: number, py: number) {
    const t = this.controls.getTarget(new THREE.Vector3(), true);
    const r = this.container.getBoundingClientRect();
    const hit = this.ray(r.left + px, r.top + py).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -t.y), new THREE.Vector3());
    if (!hit) { const sh = this.insetShift(this.controls.distance); return { x: at.x + sh.x, y: at.y + sh.y }; }
    return { x: at.x - (hit.x - t.x), y: at.y - (hit.z - t.z) };
  }

  /** The camera before a height was looked at from the side (to go back to). */
  private sidePose: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** A thing's height being changed: the camera turns to look at it from the side, close, so the
   * height shows (null: back to where it was). */
  lookAtHeight(id: string | null) {
    if (!id) {
      const was = this.sidePose;
      this.sidePose = null;
      if (was) void this.controls.setLookAt(was.pos.x, was.pos.y, was.pos.z, was.target.x, was.target.y, was.target.z, true);
      this.invalidate();
      return;
    }
    const b = this.itemBounds(id), it = this.item(id);
    if (!b || !it || this.povHole) return;
    if (!this.sidePose) this.sidePose = { pos: this.controls.getPosition(new THREE.Vector3(), true), target: this.controls.getTarget(new THREE.Vector3(), true) };
    const tall = it.type === "tree" ? it.height ?? it.radius * 2.6 : it.type === "structure" ? structureHeight(it) : it.type === "line" ? it.fenceHeight ?? LINE_KINDS[it.kind].height ?? 8 : it.type === "basket" ? (it.raised ?? 0) + 6 : 10;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const d = clamp(Math.max(tall * 3.2, span * 1.4, 40), this.controls.minDistance, this.controls.maxDistance);
    const polar = 76 * DEG, az = this.controls.azimuthAngle;
    const ty = this.h(cx, cy) + tall * 0.45;
    const off = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(d);
    // (in the middle of the open map, above the panel)
    const worldPerPx = (2 * d * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, this.size.height);
    const lift = ((clamp(this.bottomInset, 0, this.size.height * 0.6) - clamp(this.topInset, 0, this.size.height * 0.3)) / 2) * worldPerPx;
    const target = new THREE.Vector3(cx, ty - lift * Math.sin(polar), cy).addScaledVector(new THREE.Vector3(Math.sin(az), 0, Math.cos(az)), lift * Math.cos(polar));
    const pos = target.clone().add(off);
    void this.controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, true);
    this.invalidate();
  }

  /** Bounds of an item (or a hole's throw line) on the plan. */
  itemBounds(id: string) {
    const doc = this.doc;
    if (!doc) return null;
    const hole = doc.course.holes.find(h => h.id === id);
    if (hole) {
      const s = doc.stats.find(x => x.holeId === id);
      return s?.line.length ? boundsOf(s.line) : null;
    }
    const item = doc.course.items.find(i => i.id === id);
    if (!item) return null;
    if (item.type === "area" || item.type === "line") return boundsOf(item.points);
    if (item.type === "structure") return structureBounds(item);
    const r = item.type === "tree" ? item.radius : item.type === "tee" ? item.padLength / 2 : 4;
    return { minX: item.x - r, minY: item.y - r, maxX: item.x + r, maxY: item.y + r };
  }

  /** Plan point (on the ground) -> client (page) coordinates. */
  /** The camera still on its way somewhere (a fit or a zoom easing in): what's on screen is about
   * to move. */
  private gliding = false;
  /** Whether the map has come to rest (for tests: a click lands where it was aimed). */
  settled() {
    return this.paused || (!this.gliding && !this.glide && !this.lookGlide);
  }
  /** When the camera last moved (dragged, zoomed, gliding), ms on performance.now(). */
  private movedAt = 0;
  private lastEye = new THREE.Vector3();
  private lastLook = new THREE.Quaternion();
  /** How long the view has been still, ms (work that can wait waits for it); a drag under way is
   * never still. */
  stillFor() {
    if (this.dragging) { this.movedAt = performance.now(); return 0; }
    return this.paused ? Infinity : performance.now() - this.movedAt;
  }

  toClient(x: number, y: number, lift = 0) {
    const s = this.project(new THREE.Vector3(x, this.h(x, y) + lift, y));
    const r = this.container.getBoundingClientRect();
    return s ? { x: r.left + s.x, y: r.top + s.y } : null;
  }

  /** Client point -> plan point on the ground (null if it misses the ground). */
  toPlan(clientX: number, clientY: number) {
    const g = this.groundAt(clientX, clientY);
    return g ? { x: g.x, y: g.z } : null;
  }

  /** Screen rectangle of an item or hole (container pixels). */
  screenBox(id: string) {
    const b = this.itemBounds(id);
    if (!b) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]) {
      const s = this.project(new THREE.Vector3(x, this.h(x, y), y));
      if (!s) continue;
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  }

  viewInfo(): ViewInfo {
    const az = this.wrappedAzimuth();
    const dist = this.controls.distance;
    const pxPerUnit = this.size.height / (2 * dist * Math.tan((this.camera.fov * DEG) / 2));
    return { heading: ((-az / DEG) % 360 + 360) % 360, tiltDeg: this.controls.polarAngle / DEG, pxPerUnit, width: this.size.width, height: this.size.height };
  }

  /** A picture of the view as it is (`width` × `height`: at that size, in full detail, the same
   * framing widened or narrowed to fit; otherwise at the screen's size). */
  capture(width?: number, height?: number) {
    this.finishBuilding();
    const map = !this.povHole;
    this.capturing = true;
    // (looking straight down: taken from the tilted pose, then put back)
    const top = map && this.controls.polarAngle <= TILT_TOP ? { polar: this.controls.polarAngle, distance: this.controls.distance, fov: this.camera.fov } : null;
    if (top) {
      void this.controls.rotatePolarTo(DEFAULT_TILT, false);
      this.controls.update(0);
    }
    // (without the selection's outline, or the one under the pointer)
    const outlines = [this.selectionFx, this.hoverFx].filter((o): o is THREE.Object3D => !!o && o.visible);
    outlines.forEach(o => (o.visible = false));
    let url: string;
    if (!width || !height) {
      this.render();
      url = this.snapshot(map, this.renderer.getPixelRatio());
    } else {
      const ratio = this.renderer.getPixelRatio(), detail = this.videoDetail;
      this.setVideoDetail(true);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      lineMats.forEach(m => m.resolution.set(width, height));
      this.render();
      url = this.snapshot(map, clamp(height / Math.max(1, this.size.height), 0.5, 3));
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.size.width, this.size.height, false);
      this.camera.aspect = this.size.width / Math.max(1, this.size.height);
      this.camera.updateProjectionMatrix();
      lineMats.forEach(m => m.resolution.set(this.size.width, this.size.height));
      if (!detail) this.setVideoDetail(false);
    }
    outlines.forEach(o => (o.visible = true));
    if (top) {
      void this.controls.rotatePolarTo(top.polar, false);
      this.camera.fov = top.fov;
      this.camera.updateProjectionMatrix();
      void this.controls.dollyTo(top.distance, false);
      this.controls.update(0);
    }
    this.capturing = false;
    this.render();
    return url;
  }

  /** While `capture` takes its picture: the view as it was, to the rest of the app. */
  private capturing = false;

  /** The picture just drawn, with each hole's number on its tee and a mark on its basket (on the
   * map they are labels over the picture, not in it), `k` times their size on screen. */
  private snapshot(marks: boolean, k: number) {
    const src = this.renderer.domElement, doc = this.doc;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext("2d");
    if (!g) return src.toDataURL("image/png");
    g.drawImage(src, 0, 0);
    if (marks && doc) {
      const W = out.width, H = out.height, items = new Map(doc.course.items.map(i => [i.id, i]));
      const spots: { z: number; draw: () => void }[] = [];
      const spot = (p: P, lift: number, draw: (x: number, y: number) => void) => {
        const q = new THREE.Vector3(p.x, this.h(p.x, p.y) + lift, p.y).project(this.camera);
        if (q.z > 1 || Math.abs(q.x) > 1.05 || Math.abs(q.y) > 1.05) return;
        const x = ((q.x + 1) / 2) * W, y = ((1 - q.y) / 2) * H;
        spots.push({ z: q.z, draw: () => draw(x, y) });
      };
      const basket = doc.course.style.basket;
      for (const s of doc.stats) {
        const t = items.get(s.teeId ?? ""), b = items.get(s.basketId ?? "");
        const n = this.num(s.holeId);
        if (b?.type === "basket") spot(b, 2, (x, y) => {
          g.beginPath();
          g.arc(x, y, 9 * k, 0, Math.PI * 2);
          g.fillStyle = "#0f172a";
          g.fill();
          g.lineWidth = 2.5 * k;
          g.strokeStyle = basket;
          g.stroke();
          g.beginPath();
          g.arc(x, y, 4 * k, 0, Math.PI * 2);
          g.fillStyle = basket;
          g.fill();
        });
        if (t?.type === "tee" && n) spot(t, 1, (x, y) => {
          const lvl = TEE_LEVELS[t.level];
          g.font = `800 ${12 * k}px Oswald, Inter, system-ui, sans-serif`;
          const h = 22 * k, w = Math.max(h, g.measureText(n).width + 10 * k);
          g.beginPath();
          g.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
          g.fillStyle = lvl.color;
          g.fill();
          g.lineWidth = 2 * k;
          g.strokeStyle = "rgba(15,23,42,.85)";
          g.stroke();
          g.fillStyle = lvl.ink;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(n, x, y + k);
        });
      }
      // (the farthest first, so a nearer one is on top)
      spots.sort((a, b) => b.z - a.z).forEach(s => s.draw());
    }
    return out.toDataURL("image/png");
  }

  /** A picture of the scene from a tee (for the hole sheets), at the given size. */
  renderTeeView(holeId: string, width: number, height: number): HTMLCanvasElement | null {
    if (!this.doc) return null;
    const prev = { hole: this.povHole, look: { ...this.povLook } };
    this.povHole = holeId;
    this.povLook = { yaw: 0, pitch: 0 };
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.lastRender = 0;
    this.drawPov({ x: 0, y: 0, width, height });
    out.getContext("2d")?.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.size.width, this.size.height, false);
    this.povHole = prev.hole;
    this.povLook = prev.look;
    this.render();
    return out;
  }

  dispose() {
    this.disposed = true;
    this.offParts();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.grassTimer);
    this.grass.dispose();
    this.tufts.dispose();
    this.skyEnv?.dispose();
    this.ro.disconnect();
    this.disposers.forEach(d => d());
    this.endDragListeners?.();
    this.controls.dispose();
    this.ground.dispose();
    disposeObjectDeep(this.scene);
    this.sky.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.innerHTML = "";
  }

  // ------------------------------------------------------------------ tee view and flyover

  /** Look from a hole's tee down the hole (null: back to the map); `teeId`: from that tee of it
   * (another skill level's), not the one the layout plays. */
  setTeeView(holeId: string | null, teeId: string | null = null, at: { x: number; y: number; face?: number } | null = null) {
    this.fly = null;
    // (never past the map's edge)
    const stand = at ? { ...at, ...this.inMap(at) } : null;
    const tee = teeId && holeId ? this.doc?.course.items.find(i => i.id === teeId && i.type === "tee" && i.holeId === holeId) : null;
    const nextTee = tee ? tee.id : null;
    // (standing somewhere: facing down the hole, unless told otherwise; the same spot again: as it is)
    const same = (a: typeof this.povStand, b: typeof stand) => (!a && !b) || (!!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01);
    if (holeId === this.povHole && nextTee === this.povTee && same(this.povStand, stand)) return;
    if (holeId === this.povHole && nextTee === this.povTee && stand && !this.walk) {
      this.povStand = { x: stand.x, y: stand.y, face: stand.face ?? this.faceDownHole(holeId!, stand) };
      this.povLook = { yaw: 0, pitch: 0 };
      this.invalidate();
      return;
    }
    this.walk = null;
    this.glide = null;
    this.lookGlide = null;
    this.povStand = holeId && stand ? { x: stand.x, y: stand.y, face: stand.face ?? this.faceDownHole(holeId, stand) } : null;
    if (holeId === this.povHole && nextTee === this.povTee) return;
    this.povTee = nextTee;
    if (holeId === this.povHole) { this.povLook = { yaw: 0, pitch: 0 }; this.invalidate(); return; }
    this.povHole = holeId;
    this.povLook = { yaw: 0, pitch: 0 };
    if (!holeId) this.freeCam(false);
    this.detailReady = this.updateDetail().catch(() => {});
    this.controls.enabled = !holeId;
    this.labelsLayer.style.display = holeId ? "none" : "";
    this.handlesLayer.style.display = holeId ? "none" : "";
    // (back on the map: nothing of the tee view or a flight left over it)
    if (!holeId && this.povMarker) this.povMarker.style.display = "none";
    if (!holeId && this.flyCanvas) this.flyCanvas.style.display = "none";
    this.updateCursor();
    this.invalidate();
  }

  /** Which way to face from a spot on a hole: toward its basket (from close to it, back to its tee). */
  private faceDownHole(holeId: string, p: P) {
    const s = this.doc?.stats.find(x => x.holeId === holeId);
    if (!s || s.line.length < 2) return this.mapFacing();
    const a = s.line[0], z = s.line[s.line.length - 1];
    const to = dist(p, z) < 40 ? a : z;
    return Math.atan2(to.y - p.y, to.x - p.x);
  }

  /** The way the map looks, along the ground (the angle in plan): up the screen, tilted or not. */
  private mapFacing() {
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const fwd = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    // (looking straight down: up the screen; tilted: where it looks)
    const v = Math.hypot(fwd.x, fwd.z) > 0.2 ? fwd : up;
    return Math.atan2(v.z, v.x);
  }

  /** The hole whose line is nearest a spot (for standing there), if any is complete; with `within`,
   * only one that near (feet). */
  holeNear(p: P, within = Infinity): string | null {
    let best: { id: string; d: number } | null = null;
    for (const s of this.doc?.stats ?? []) {
      if (!s.complete || s.line.length < 2) continue;
      const d = distanceToPath(p, s.line);
      if (!best || d < best.d) best = { id: s.holeId, d };
    }
    return best && best.d <= within ? best.id : null;
  }

  /** What standing at a spot stands on: the hole whose line is near it, or (none near, or none at
   * all) the spot on its own. */
  standOn(p: P): string {
    return this.holeNear(p, STAND_NEAR_FT) ?? STAND_HERE;
  }

  /** A spot to stand on kept on the map: past its edge (the open plane round it), the nearest
   * spot a step inside. */
  inMap(p: P): P {
    const c = this.doc?.course.canvas;
    if (!c) return p;
    const m = Math.min(STAND_EDGE_FT, c.width / 4, c.height / 4);
    return { x: Math.min(c.width - m, Math.max(m, p.x)), y: Math.min(c.height - m, Math.max(m, p.y)) };
  }

  /** Where the person would land dropped at a screen point (the map's ground there), with a ring
   * there; null: none (the ring goes). */
  dropPreview(clientX: number | null, clientY = 0): P | null {
    if (this.dropRingFx) { this.fx.remove(this.dropRingFx); disposeObjectDeep(this.dropRingFx); this.dropRingFx = null; }
    if (clientX === null || this.povHole) { this.invalidate(); return null; }
    const g = this.groundAt(clientX, clientY);
    if (!g) { this.invalidate(); return null; }
    const p = this.inMap({ x: g.x, y: g.z });
    // (6 ft across, or about 16 px when zoomed out: a ring to see)
    const worldPerPx = (2 * this.controls.distance * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, this.size.height);
    this.dropRingFx = this.groundRing(p, Math.max(6, 16 * worldPerPx), SELECT, 0.95, 3);
    this.fx.add(this.dropRingFx);
    this.invalidate();
    return p;
  }

  /** A ring lying on the ground (radius in feet). */
  private groundRing(p: P, r: number, color: string, opacity: number, width: number) {
    const ring: P[] = [];
    for (let i = 0; i < 48; i++) ring.push({ x: p.x + Math.cos((i / 48) * Math.PI * 2) * r, y: p.y + Math.sin((i / 48) * Math.PI * 2) * r });
    const g = new THREE.Group();
    g.add(this.fatLine(this.drapeLine(ring, 0.4, true), "#000000", width + 2, { opacity: opacity * 0.4, order: 8 }));
    g.add(this.fatLine(this.drapeLine(ring, 0.45, true), color, width, { opacity, order: 9 }));
    return g;
  }

  /** Standing: walks to a spot (a glide there), still looking the way you were. */
  private walkTo(to: P) {
    const pose = this.povPose();
    if (!pose || !this.povHole) return;
    const p = this.inMap(to);
    const dir = new THREE.Vector3().subVectors(pose.target, pose.eye);
    const face = Math.atan2(dir.z, dir.x);
    const from = { x: pose.eye.x, y: pose.eye.z };
    this.povLook = { yaw: 0, pitch: this.povLook.pitch };
    this.povStand = { x: p.x, y: p.y, face };
    this.walk = { from, to: p, t0: performance.now() };
    this.showStep(null);
    this.invalidate();
  }

  /** The ring where a click would step (null: none). */
  private showStep(p: P | null) {
    if (this.stepRing) { this.fx.remove(this.stepRing); disposeObjectDeep(this.stepRing); this.stepRing = null; }
    if (p) { this.stepRing = this.groundRing(p, 3, "#ffffff", 0.85, 2.5); this.fx.add(this.stepRing); }
    this.invalidate();
  }

  /** The tip by the pointer, standing: what a click does, or where a dragged thing is. */
  private tip(text: string | null, clientX = 0, clientY = 0) {
    if (!text) { if (this.povTip) this.povTip.style.display = "none"; return; }
    if (!this.povTip) {
      const el = document.createElement("div");
      el.dataset.testid = "stand-tip";
      el.style.cssText = "position:absolute;z-index:6;pointer-events:none;padding:6px 11px;border-radius:9px;background:rgba(24,24,27,.92);color:#f4f4f5;font:500 13px Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 6px 16px rgba(0,0,0,.4)";
      this.container.appendChild(el);
      this.povTip = el;
    }
    const r = this.container.getBoundingClientRect();
    this.povTip.textContent = text;
    this.povTip.style.display = "";
    this.povTip.style.left = `${clientX - r.left + 16}px`;
    this.povTip.style.top = `${clientY - r.top + 18}px`;
  }

  /** What a thing is called, for the tip. */
  private nameOf(id: string) {
    const it = this.item(id);
    if (!it) return "It";
    // (its species when it has one: a Bradford pear, a spruce)
    if (it.type === "tree") return it.species && it.species in LOOK_LABEL ? LOOK_LABEL[it.species as TreeLookId] : it.treeType === "conifer" ? "Conifer" : it.treeType === "bush" ? "Bush" : "Tree";
    if (it.type === "basket") return "Basket";
    if (it.type === "tee") return "Tee";
    if (it.type === "structure") return it.label || "Building";
    if (it.type === "amenity") return it.label || "Amenity";
    return it.type[0].toUpperCase() + it.type.slice(1);
  }

  /** Standing, the pointer over the view: a thing's outline and name (a click picks it), or a ring
   * where you'd step (a click walks there). */
  private povHover(p: { x: number; y: number }, g: THREE.Vector3 | null) {
    const edits = this.tapsEdit();
    const id = edits ? this.pick(p.x, p.y) : null;
    this.setHover(id);
    if (id) { this.showStep(null); this.tip(`${this.nameOf(id)} · click to pick it`, p.x, p.y); return; }
    const eye = this.povPose()?.eye;
    if (!edits && g && eye && this.eyeAt(p.x, p.y).cam === this.povCam) {
      // (the ring alone: words following the pointer everywhere got in the way; the line along the
      // bottom says a click walks)
      this.showStep(this.inMap({ x: g.x, y: g.z }));
      this.tip(null);
    } else { this.showStep(null); this.tip(null); }
  }

  /** Standing, a thing dragged: how far off the hole's line it is, and whether it's on the throw line. */
  private povDragTip(id: string, at: P, clientX: number, clientY: number) {
    const s = this.doc?.stats.find(x => x.holeId === this.povHole);
    const it = this.item(id);
    if (!s || s.line.length < 2 || !it) return;
    const off = distanceToPath(at, s.line);
    // (which side: of the nearest leg, looking down the hole)
    let side = "", best = Infinity;
    for (let i = 1; i < s.line.length; i++) {
      const a = s.line[i - 1], b = s.line[i];
      const d = distanceToPath(at, [a, b]);
      if (d < best) { best = d; side = (b.x - a.x) * (at.y - a.y) - (b.y - a.y) * (at.x - a.x) < 0 ? "left" : "right"; }
    }
    const reach = it.type === "tree" ? it.radius * (it.width ?? 1) : 2;
    const metric = this.doc?.course.units === "m";
    const n = (v: number) => `${Math.round(metric ? v * 0.3048 : v)} ${metric ? "m" : "ft"}`;
    this.tip(`${off < 1 ? "On the line" : `${n(off)} ${side} of the line`}${off < reach + 3 ? " · on the throw line" : ""}`, clientX, clientY);
  }

  /** Standing, editing: a tap walks there, or picks the thing tapped (a tool that places things
   * places, either way). */
  setStandTap(mode: "walk" | "edit") {
    if (mode === this.standTap) return;
    this.standTap = mode;
    this.setHover(null);
    this.showStep(null);
    this.tip(null);
    this.updateCursor();
    this.invalidate();
  }
  /** Standing, whether a tap goes to things (picking, placing) rather than walking. */
  private tapsEdit() {
    return this.teeEdit && !this.readOnly && (this.standTap === "edit" || this.tool.mode !== "select");
  }

  /** Tee view, editing (a press on a thing picks or drags it; on open ground, looks around), with
   * the map from above in a corner ("small", "big") or none. */
  setTeeEdit(on: boolean, mini: "small" | "big" | "corner" | null = "small") {
    if (on === this.teeEdit && mini === this.miniSize) return;
    this.teeEdit = on;
    this.miniSize = mini;
    if (!on) this.setHover(null);
    this.updateCursor();
    this.invalidate();
  }

  /** The corner map's place now, and where on it the tee is and which way the view looks (for
   * what's drawn over it); null when there's none. */
  teeMini() {
    const m = this.miniRect, pose = this.povHole ? this.povPose() : null;
    if (!m || !pose) return null;
    const was = this.eye;
    this.eye = { cam: this.miniCam, rect: m };
    try {
      const tee = this.project(pose.eye.clone().setY(this.h(pose.eye.x, pose.eye.z)));
      const dir = new THREE.Vector3();
      this.povCam.getWorldDirection(dir);
      const far = pose.eye.clone().addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 60);
      const ahead = this.project(far.setY(this.h(far.x, far.z)));
      return { rect: { ...m }, tee, ahead, fov: this.povCam.fov * this.povCam.aspect };
    } finally { this.eye = was; }
  }

  /** The corner map's place in the view (the container's pixels). */
  private miniPlace(): Rect | null {
    if (!this.miniSize || !this.povHole || this.fly) return null;
    const W = this.size.width, H = this.size.height;
    // (on site: a square under the top bar, on a phone too)
    if (this.miniSize === "corner") { const w = Math.round(Math.min(150, W * 0.36)); return { x: W - w - 10, y: 118, width: w, height: w }; }
    if (W < 500 || H < 360) return null;
    const big = this.miniSize === "big";
    const w = Math.round(big ? Math.min(560, W * 0.42) : Math.min(260, W * 0.24)), h = Math.round(big ? Math.min(420, H * 0.5) : w * 0.72);
    return { x: W - w - 12, y: 12, width: w, height: h };
  }

  /** The corner map's camera: straight down on the hole, its line pointing up the picture. */
  private placeMini(m: Rect) {
    const doc = this.doc, s = doc?.stats.find(x => x.holeId === this.povHole);
    const pose = this.povPose();
    if (!pose) return false;
    // (standing on its own: 300 ft round the spot, the way you face up the picture)
    const look = new THREE.Vector3().subVectors(pose.target, pose.eye);
    const spot = { x: pose.eye.x, y: pose.eye.z }, ahead = Math.hypot(look.x, look.z) > 1e-6 ? { x: look.x / Math.hypot(look.x, look.z), y: look.z / Math.hypot(look.x, look.z) } : { x: 0, y: -1 };
    const pts = s && s.line.length > 1 ? s.line : [{ x: spot.x - ahead.x * 100, y: spot.y - ahead.y * 100 }, { x: spot.x + ahead.x * 200, y: spot.y + ahead.y * 200 }];
    const b = boundsOf(pts);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const a = pts[0], z = pts[pts.length - 1];
    const len = Math.max(1, Math.hypot(z.x - a.x, z.y - a.y));
    const cam = this.miniCam;
    cam.aspect = m.width / Math.max(1, m.height);
    // (the hole's length up the picture, with room round it)
    const span = Math.max(len * 1.35, (Math.max(b.maxX - b.minX, b.maxY - b.minY) + 120) / Math.max(1, Math.min(cam.aspect, 1)), 160);
    const height = span / 2 / Math.tan((cam.fov * DEG) / 2);
    const ground = this.h(cx, cy);
    cam.position.set(cx, ground + height, cy);
    cam.up.set((z.x - a.x) / len, 0, (z.y - a.y) / len);
    cam.lookAt(cx, ground, cy);
    cam.near = Math.max(1, height * 0.05);
    cam.far = height * 4;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return true;
  }

  /** Fly over a hole from behind the tee to the basket; `done` runs when it lands. */
  /** Flies over a hole just as a recording shows it: its title held a moment on the first
   * picture, the flight (the title fading), a moment at the basket. */
  flyover(holeId: string, done?: () => void) {
    const path = this.flightPath(holeId);
    if (!path || !this.doc) {
      this.fly = null;
      this.flyWait = null;
      this.cb.onFlyWait(null);
      done?.();
      return;
    }
    this.setTeeView(holeId);
    if (!this.fly) this.povFov = this.povCam.fov;
    this.fly = { ...path, t: -VIDEO_HOLD.intro, done, title: holeTitle(this.doc.course, holeId) };
    const wait: { since: number; loaded: boolean; frames: number } = { since: performance.now(), loaded: false, frames: 0 };
    this.flyWait = wait;
    this.cb.onFlyWait("map");
    void (async () => {
      const left = () => performance.now() - wait.since < FLY_WAIT_MS;
      const pause = () => new Promise(r => setTimeout(r, 100));
      // (the painted ground still being painted, then its sharp close-up, then any textures
      // still on their way: the photo, the trees' leaves)
      await new Promise(r => setTimeout(r, 150));
      while (this.paintedPending && left()) await pause();
      // (and the woods and the rest still being made)
      while (this.slowQueue.size && left()) await pause();
      if (this.flyWait === wait) this.cb.onFlyWait("detail");
      await this.detailReady;
      if (this.flyWait === wait) this.cb.onFlyWait("textures");
      while (texturesLoading() && left()) await pause();
      wait.loaded = true;
    })();
    this.invalidate();
  }

  /** The flight over a hole: camera and look-at points (by itself from behind the tee to the
   * basket, over the trees; or through the hole's keyframes), fields of view, and how long it
   * takes (s). */
  private flightPath(holeId: string): { pts: THREE.Vector3[]; look: THREE.Vector3[]; fov: number[]; dur: number; play: number; at: (t: number) => number } | null {
    const doc = this.doc;
    const s = doc?.stats.find(x => x.holeId === holeId);
    if (!doc || !s?.complete) return null;
    const hole = doc.course.holes.find(h => h.id === holeId);
    const set = flyoverOf(doc.course, hole);
    const ground = (x: number, y: number) => this.h(x, y);
    const byHand = !!hole?.flyKeys && hole.flyKeys.length >= 2;
    const trees = (p: P, r: number) => this.canopyAt(p, r);
    const f = byHand ? keyFlight(hole!.flyKeys!, set, ground, trees) : autoFlight(smoothPath(s.line, 16), set, ground, trees);
    if (!f) return null;
    const v = (a: Air) => new THREE.Vector3(a.x, a.z, a.y);
    // (slowing to a stop at the end; by itself, getting going gently too)
    const clock = flightClock(f.dur, !byHand);
    return { pts: f.cam.map(v), look: f.look.map(v), fov: f.fov, dur: f.dur, play: clock.play, at: clock.at };
  }

  /** Keyframes to start a hand-made flyover from: the flight it flies by itself, at a few moments. */
  autoKeys(holeId: string): FlyKey[] | null {
    const doc = this.doc;
    const s = doc?.stats.find(x => x.holeId === holeId);
    if (!doc || !s?.complete) return null;
    const ground = (x: number, y: number) => this.h(x, y);
    const set = flyoverOf(doc.course, doc.course.holes.find(h => h.id === holeId));
    const canopy = (p: P, r: number) => this.canopyAt(p, r);
    const f = autoFlight(smoothPath(s.line, 16), set, ground, canopy);
    // (each at the flyover's height, out of the trees)
    return f ? keysFromFlight(f, ground, 4, set.height, canopy) : null;
  }

  // Drawn curves and outlines, kept while what they come from is the same (a course's items and
  // holes are replaced when they change, never changed in place): hovering and redrawing after a
  // change work them out again only for what changed
  private drawnOf = new WeakMap<object, { pts: P[]; box: ReturnType<typeof boundsOf> }>();
  private shapeOf(i: AreaItem | LineItem) {
    let d = this.drawnOf.get(i);
    if (!d) {
      const pts = i.type === "area" ? areaPath(i) : linePath(i);
      this.drawnOf.set(i, (d = { pts, box: boundsOf(pts) }));
    }
    return d;
  }
  private kept = new Map<string, { dep: unknown; key: string; val: unknown }>();
  /** `make()`'s answer, kept in `slot` while `dep` is the same object and `key` the same text. */
  private keep<T>(slot: string, dep: unknown, key: string, make: () => T): T {
    const m = this.kept.get(slot);
    if (m && m.dep === dep && m.key === key) return m.val as T;
    const val = make();
    this.kept.set(slot, { dep, key, val });
    return val;
  }
  /** A hole's fairway round one of its throw lines (curved `per` points a leg), kept. */
  private outline(hole: Hole, line: P[], slot: string, per: number, extra: number, steps: number) {
    return this.keep(`fair:${hole.id}:${slot}:${per}:${extra}:${steps}`, hole, JSON.stringify(line), () => fairwayOutline(hole, smoothPath(line, per), extra, steps));
  }
  /** Every tree standing on the course as a crown (placed ones, and those of the woods and of the
   * painted map), filed by 40 ft squares; made again when they change. */
  private crownFile: { key: unknown[]; cells: Map<string, Crown[]>; widest: number } | null = null;
  private crownsFiled() {
    const doc = this.doc!;
    const forests = [...this.shapes].filter(([k]) => k.startsWith("woods:") || k === "painted-woods").map(([, e]) => e.obj);
    const key = [doc.course.items, this.heightsVersion, ...forests];
    const f = this.crownFile;
    if (f && f.key.length === key.length && f.key.every((k, i) => k === key[i])) return f;
    const cells = new Map<string, Crown[]>();
    let widest = 0;
    const add = (c: Crown) => {
      const k = `${Math.floor(c.x / CROWN_CELL)},${Math.floor(c.y / CROWN_CELL)}`;
      const list = cells.get(k);
      if (list) list.push(c); else cells.set(k, [c]);
      widest = Math.max(widest, c.r);
    };
    // (leaves from about a third of the way up a broadleaf, lower on a pine, the ground for a bush)
    const low = (shape?: string) => (shape === "bush" ? 0 : shape === "conifer" ? 0.12 : 0.3);
    for (const i of doc.course.items) {
      if (i.type !== "tree") continue;
      const g = this.h(i.x, i.y), h = i.height ?? i.radius * 2.6;
      add({ x: i.x, y: i.y, r: i.radius * (i.width ?? 1), base: g + h * low(i.treeType), top: g + h });
    }
    for (const obj of forests) for (const t of (obj.userData.spots ?? []) as TreeSpot[]) add({ x: t.x, y: t.y, r: t.width / 2, base: t.ground + t.height * low(t.shape), top: t.ground + t.height });
    return (this.crownFile = { key, cells, widest });
  }

  /** What stands over a point, within `reach` ft (for flyovers): the trees whose leaves reach that
   * near (each one's crown, its trunk close by) and built things from the ground up. Ft on the
   * terrain's datum. */
  private canopyAt(p: P, reach: number): Canopy | null {
    const doc = this.doc;
    if (!doc) return null;
    let base = Infinity, top = -Infinity;
    const trunks: P[] = [], crowns: Crown[] = [];
    const { cells, widest } = this.crownsFiled();
    const R = reach + Math.max(widest, TRUNK_ROOM);
    for (let cx = Math.floor((p.x - R) / CROWN_CELL); cx <= Math.floor((p.x + R) / CROWN_CELL); cx++) {
      for (let cy = Math.floor((p.y - R) / CROWN_CELL); cy <= Math.floor((p.y + R) / CROWN_CELL); cy++) {
        for (const c of cells.get(`${cx},${cy}`) ?? []) {
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < reach + c.r) {
            base = Math.min(base, c.base);
            top = Math.max(top, c.top);
            crowns.push(c);
          }
          if (d < reach + TRUNK_ROOM) trunks.push({ x: c.x, y: c.y });
        }
      }
    }
    for (const i of doc.course.items) {
      if (i.type !== "structure" || isLineKind(i.kind)) continue;
      const b = boundsOf(i.points);
      if (p.x < b.minX - reach || p.x > b.maxX + reach || p.y < b.minY - reach || p.y > b.maxY + reach) continue;
      if (pointInPolygon(p, i.points) || distanceToPath(p, [...i.points, i.points[0]]) < reach) {
        base = Math.min(base, this.h(p.x, p.y));
        top = Math.max(top, this.h(p.x, p.y) + structureHeight(i) + 10);
      }
    }
    return Number.isFinite(top) || trunks.length ? { base, top, trunks, crowns } : null;
  }

  stopFlyover() {
    if (this.fly) this.povCam.fov = this.povFov;
    this.fly = null;
    this.invalidate();
  }

  // ------------------------------------------------------------------ the camera by hand

  /** Flies the camera by hand, first person (over the tee view's hole), from keyframe `from` of
   * it, or (null) from where the tee view stands; `false` back to the tee view. */
  freeCam(from: FlyKey | null | false) {
    if (from === false) {
      if (this.free) this.povCam.fov = this.freeWas;
      this.free = null;
      this.freeIn = { f: 0, s: 0, u: 0, fast: false };
      this.invalidate();
      return;
    }
    if (!this.free) this.freeWas = this.povCam.fov;
    this.freeGo(from);
  }

  /** The camera by hand put at keyframe `k` (null: where the tee view stands). */
  freeGo(k: FlyKey | null) {
    const doc = this.doc;
    let eye: THREE.Vector3, target: THREE.Vector3, fov: number;
    if (k) {
      eye = new THREE.Vector3(k.x, this.h(k.x, k.y) + k.alt, k.y);
      target = new THREE.Vector3(k.lookX, this.h(k.lookX, k.lookY) + (k.lookAlt ?? 3), k.lookY);
      fov = k.fov ?? (doc ? flyoverOf(doc.course, doc.course.holes.find(h => h.id === this.povHole)).fov : 60);
    } else {
      const pose = this.povPose();
      if (!pose) return;
      eye = pose.eye;
      target = pose.target;
      fov = this.povCam.fov;
    }
    const d = target.clone().sub(eye);
    const flat = Math.hypot(d.x, d.z);
    this.free = { x: eye.x, y: eye.z, z: eye.y, yaw: Math.atan2(d.z, d.x), pitch: Math.atan2(d.y, Math.max(1e-3, flat)) };
    this.povCam.fov = clamp(fov, LENS.min, LENS.max);
    this.invalidate();
  }

  /** What moves the camera by hand: forward, right, up (each -1 to 1), and faster. */
  freeMove(m: Partial<{ f: number; s: number; u: number; fast: boolean }>) {
    Object.assign(this.freeIn, m);
    this.invalidate();
  }

  /** The camera by hand's lens (field of view, degrees) set to `fov`; returns what it is. */
  freeLens(fov?: number) {
    if (fov !== undefined) { this.povCam.fov = clamp(fov, LENS.min, LENS.max); this.invalidate(); }
    return Math.round(this.povCam.fov);
  }

  /** Where the camera by hand is, as a keyframe: its spot and height over the ground, what it
   * looks at (where the middle of the picture meets the ground, or a way off along it when it
   * looks over the horizon) and its lens. Null: not flying by hand. */
  freeKey(): FlyKey | null {
    const f = this.free;
    if (!f) return null;
    const dir = { x: Math.cos(f.yaw) * Math.cos(f.pitch), y: Math.sin(f.yaw) * Math.cos(f.pitch), z: Math.sin(f.pitch) };
    // (out along the middle of the picture to the ground, 5 ft at a time; none in 1500 ft, 400 ft out)
    let d = 400;
    for (let s = 5; s <= 1500; s += 5) {
      if (f.z + dir.z * s <= this.h(f.x + dir.x * s, f.y + dir.y * s)) { d = s; break; }
    }
    const lx = f.x + dir.x * d, ly = f.y + dir.y * d, lz = f.z + dir.z * d;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return { x: r1(f.x), y: r1(f.y), alt: r1(f.z - this.h(f.x, f.y)), lookX: r1(lx), lookY: r1(ly), lookAlt: r1(Math.max(0, lz - this.h(lx, ly))), fov: Math.round(this.povCam.fov) };
  }

  /** Moves the camera by hand on by `dt` s: level forward and to the side, the way it faces, and
   * straight up or down (faster the higher it is); never into the ground. */
  private stepFree(dt: number) {
    const f = this.free, m = this.freeIn;
    if (!f || (!m.f && !m.s && !m.u)) return false;
    const alt = f.z - this.h(f.x, f.y);
    const speed = clamp(alt * 0.6, 20, 150) * (m.fast ? 3 : 1) * Math.min(dt, 0.1);
    f.x += (Math.cos(f.yaw) * m.f - Math.sin(f.yaw) * m.s) * speed;
    f.y += (Math.sin(f.yaw) * m.f + Math.cos(f.yaw) * m.s) * speed;
    f.z += m.u * speed * 0.7;
    f.z = clamp(f.z, this.h(f.x, f.y) + 2, this.h(f.x, f.y) + 2000);
    return true;
  }

  /** The selected hole's keyframe picked (null: none); its handle stands out on the map. */
  setFlyKey(i: number | null) {
    this.flyKeyOn = i;
    this.markFlyKey();
  }
  private markFlyKey() {
    for (const h of this.handles) {
      if (h.kind !== "flykey" && h.kind !== "flylook") continue;
      if (h.index === this.flyKeyOn) h.el.dataset.on = "";
      else delete h.el.dataset.on;
    }
  }

  private flyMidCache: { key: string; pts: THREE.Vector3[] } | null = null;
  /** Halfway (in time) between each two keyframes of a hole: where the flight is there. */
  private flyMids(holeId: string): THREE.Vector3[] {
    const doc = this.doc, hole = doc?.course.holes.find(h => h.id === holeId);
    const keys = hole?.flyKeys;
    if (!doc || !hole || !keys || keys.length < 2) return [];
    const set = flyoverOf(doc.course, hole);
    const key = JSON.stringify([keys, set.speed, set.fov]);
    if (this.flyMidCache?.key === key) return this.flyMidCache.pts;
    const ground = (x: number, y: number) => this.h(x, y);
    const f = keyFlight(keys, set, ground), at = keyTimes(keys, set, ground);
    const pts = f ? at.slice(1).map((t, i) => {
      const c = f.cam[Math.round((((at[i] + t) / 2) / f.dur) * (f.cam.length - 1))];
      return new THREE.Vector3(c.x, c.z, c.y);
    }) : [];
    this.flyMidCache = { key, pts };
    return pts;
  }

  /** Where the tee view stands and looks (tee + eye height, toward the first point of the line). */
  private povPose(): { eye: THREE.Vector3; target: THREE.Vector3 } | null {
    const doc = this.doc;
    if (!doc || !this.povHole) return null;
    const found = doc.stats.find(x => x.holeId === this.povHole);
    const s = found && found.line.length >= 2 ? found : null;
    // (standing on its own, away from every hole: only where the person stands)
    if (!s && !this.povStand) return null;
    const own = this.povTee ? doc.course.items.find(i => i.id === this.povTee) : null;
    // (standing somewhere else: there, the way it faces; walking: on the way, eased)
    let tee: P = own ? { x: own.x, y: own.y } : s ? s.line[0] : { x: this.povStand!.x, y: this.povStand!.y };
    let face: number | null = null;
    if (this.povStand) {
      tee = { x: this.povStand.x, y: this.povStand.y };
      face = this.povStand.face;
      const w = this.walk;
      if (w) {
        const k = clamp((performance.now() - w.t0) / 550, 0, 1), e = k * k * (3 - 2 * k);
        tee = { x: w.from.x + (w.to.x - w.from.x) * e, y: w.from.y + (w.to.y - w.from.y) * e };
        if (k >= 1) { this.walk = null; this.cb.onStand?.({ x: w.to.x, y: w.to.y, face: this.povStand.face }); } else this.invalidate();
      }
    }
    const next = face === null && s ? s.line[1] : { x: tee.x + Math.cos(face ?? 0) * 60, y: tee.y + Math.sin(face ?? 0) * 60 };
    const eye = new THREE.Vector3(tee.x, this.h(tee.x, tee.y) + EYE_HEIGHT_FT + 0.35, tee.y);
    const base = (face ?? Math.atan2(next.y - tee.y, next.x - tee.x)) + this.povLook.yaw;
    const d = Math.max(60, dist(tee, next));
    const tx = tee.x + Math.cos(base) * d, ty = tee.y + Math.sin(base) * d;
    const ground = this.h(next.x, next.y) + 3;
    const flatPitch = Math.atan2(ground - eye.y, dist(tee, next));
    const pitch = clamp(flatPitch + this.povLook.pitch, -80 * DEG, 60 * DEG);
    return { eye, target: new THREE.Vector3(tx, eye.y + Math.tan(pitch) * d, ty) };
  }

  /** Draws the tee view or flyover into `rect` on screen, or (a recording) into all of `target`. */
  private drawPov(rect: { x: number; y: number; width: number; height: number }, target?: THREE.WebGLRenderTarget) {
    const doc = this.doc;
    if (!doc) return;
    const cam = this.povCam;
    if (this.fly) {
      const f = this.fly;
      // (where along the flight: its motion easing in and out; see flightClock)
      const e = f.dur > 0 ? clamp(f.at(f.t) / f.dur, 0, 1) : 1;
      const idx = e * (f.pts.length - 1);
      const i0 = Math.floor(idx), i1 = Math.min(f.pts.length - 1, i0 + 1);
      // (on a smooth curve through the flight's points, not straight from one to the next)
      curveBetween(f.pts, i0, idx - i0, cam.position);
      cam.lookAt(curveBetween(f.look, i0, idx - i0, new THREE.Vector3()));
      cam.fov = f.fov[i0] + (f.fov[i1] - f.fov[i0]) * (idx - i0);
    } else if (this.free) {
      const f = this.free;
      cam.position.set(f.x, f.z, f.y);
      cam.lookAt(f.x + Math.cos(f.yaw) * Math.cos(f.pitch), f.z + Math.sin(f.pitch), f.y + Math.sin(f.yaw) * Math.cos(f.pitch));
    } else {
      const pose = this.povPose();
      if (!pose) return;
      cam.position.copy(pose.eye);
      cam.lookAt(pose.target);
    }
    cam.aspect = rect.width / Math.max(1, rect.height);
    const span = this.siteSpan();
    cam.far = span * 12;
    cam.near = 0.3;
    cam.updateProjectionMatrix();
    // Sky, the land out to the horizon, haze and grass, only for this picture
    const restore = this.atmosphere(cam, true);
    this.ground.extras.visible = false;
    this.updateGrass(cam, true);
    // (the corner map from above draws the same trees: all of them, then)
    // (every tree, in view or not: each casts its shadow, and the shadows are drawn only now and then)
    this.updateForests(cam.position);
    waterUniforms.uTime.value = this.clock.elapsedTime;
    waterUniforms.uWind.value = this.wind ? 1 : 0.25;
    // (editing: what's picked and what's under the pointer outlined, as on the map)
    this.fx.visible = this.teeEdit && !target && !this.fly;
    // (the hole's On screen switches: flying, and from the tee)
    const hidden = this.povHole ? this.hideForFlight() : [];
    // (the ground's scans: not without a graphics card, where every pixel's work is the processor's)
    this.ground.detailActive(!this.software && this.tier < 4);
    // (standing under a tree, the leaves right in front of the eye melt away, those overhead stay;
    // a flyover never fades anything: it's for seeing what's really there)
    treeNearFade.value = this.fly ? 0 : 8;
    if (this.shadowsDirty) {
      this.placeSun();
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    this.nearShadows(cam);
    if (target) {
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      this.renderer.setRenderTarget(null);
    } else {
      this.renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
      this.renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.scene, cam);
      this.renderer.setScissorTest(false);
    }
    restore();
    treeNearFade.value = 0;
    for (const o of hidden) o.visible = true;
    this.ground.extras.visible = true;
    this.fx.visible = true;
    if (!target) {
      this.placePovMarker(cam, rect);
      this.placeFlyOverlay(cam, rect);
    }
  }

  /** Hides what the flown (or viewed) hole's flyover is set not to show (the disc's flight, lines of play,
   * putting circles, OB, other holes' lines, walks); returns what it hid, to show again. */
  private hideForFlight(): THREE.Object3D[] {
    const doc = this.doc, holeId = this.povHole;
    if (!doc || !holeId) return [];
    const f = flyoverOf(doc.course, doc.course.holes.find(h => h.id === holeId));
    const items = new Map(doc.course.items.map(i => [i.id, i]));
    const hidden: THREE.Object3D[] = [];
    for (const [key, { obj }] of this.shapes) {
      const at = key.indexOf(":");
      const kind = key.slice(0, at), id = key.slice(at + 1);
      const it = items.get(id);
      // (whose it is: the flown hole's, or another's)
      const own = (holes: (string | undefined)[]) => holes.includes(holeId);
      let show = true;
      // (a course's public page flies over the hole as it is: no line of play drawn down it)
      if (kind === "throw") show = !(this.readOnly && this.fly) && f.playLine && (!!it && it.type === "tee" && (own([it.holeId]) || f.otherHoles));
      else if (kind === "circle") show = f.circle && (!!it && it.type === "basket" && (own(basketHoles(it)) || f.otherHoles));
      else if (kind === "walk") show = f.walks;
      else if ((kind === "line" || kind === "area") && it && (it.type === "line" || it.type === "area")) {
        if (it.kind === "ob") show = f.ob;
        else if (it.kind === "walk") show = f.walks;
      }
      if (!show && obj.visible) {
        obj.visible = false;
        hidden.push(obj);
      }
    }
    return hidden;
  }

  private flyCanvas: HTMLCanvasElement | null = null;
  /** Over a flyover on screen: what a recording shows over it (the hole's badge and title, the
   * basket with the distance left, the course's name), drawn the same way. */
  private placeFlyOverlay(cam: THREE.PerspectiveCamera, rect: { x: number; y: number; width: number; height: number }) {
    const f = this.fly, doc = this.doc;
    if (!f?.title || !doc || !this.povHole) {
      if (this.flyCanvas) this.flyCanvas.style.display = "none";
      return;
    }
    if (!this.flyCanvas) {
      this.flyCanvas = document.createElement("canvas");
      this.flyCanvas.setAttribute("data-testid", "fly-overlay");
      this.flyCanvas.style.cssText = "position:absolute;pointer-events:none;z-index:1";
      this.container.appendChild(this.flyCanvas);
    }
    const c = this.flyCanvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = rect.width, h = rect.height;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    Object.assign(c.style, { display: "block", left: `${rect.x}px`, top: `${this.size.height - rect.y - h}px`, width: `${w}px`, height: `${h}px` });
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const s = doc.stats.find(x => x.holeId === this.povHole);
    let info: FrameInfo | null = null;
    if (s?.complete) {
      const b = s.line[s.line.length - 1];
      const q = new THREE.Vector3(b.x, this.h(b.x, b.y) + 5, b.y).project(cam);
      const inside = q.z <= 1 && Math.abs(q.x) <= 1.05 && Math.abs(q.y) <= 1.05;
      info = { basket: inside ? { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h } : null, toBasket: dist({ x: cam.position.x, y: cam.position.z }, b) };
    }
    // (what it shows as set now, if changed mid-flight)
    drawOverlay(g, w, h, { ...f.title, show: overlayShow(doc.course, this.povHole ?? "") }, titleStrength(f.t), info, doc.course);
  }

  /** In the tee view: a marker over the basket (too small to see from far away) with the distance. */
  private placePovMarker(cam: THREE.PerspectiveCamera, rect: { x: number; y: number; width: number; height: number }) {
    const doc = this.doc;
    const s = doc?.stats.find(x => x.holeId === this.povHole);
    if (!this.povMarker) {
      this.povMarker = document.createElement("div");
      this.povMarker.setAttribute("data-testid", "pov-basket");
      this.povMarker.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;font:700 12px Inter,system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)";
      this.container.appendChild(this.povMarker);
    }
    const el = this.povMarker;
    if (!doc || !s?.complete || rect.width !== this.size.width || this.fly?.title) { el.style.display = "none"; return; }
    const b = s.line[s.line.length - 1];
    const p = new THREE.Vector3(b.x, this.h(b.x, b.y) + 5, b.y).project(cam);
    if (p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1) { el.style.display = "none"; return; }
    el.style.display = "flex";
    // (from a tee other than the layout's: how far that tee is from the basket)
    const own = !this.fly && this.povTee ? doc.course.items.find(i => i.id === this.povTee) : null;
    const d = this.fly ? dist({ x: cam.position.x, y: cam.position.z }, b) : own ? dist(own, b) : s.length;
    const text = fmtDist(d, doc.course.units), color = doc.course.style.basket;
    if (el.dataset.text !== text || el.dataset.color !== color) {
      el.dataset.text = text;
      el.dataset.color = color;
      el.innerHTML = `<span style="background:${color};color:#111;border-radius:999px;padding:2px 8px;text-shadow:none;box-shadow:0 1px 4px rgba(0,0,0,.5)">${text}</span><span style="font-size:16px;line-height:14px;color:${color}">▼</span>`;
    }
    const x = ((p.x + 1) / 2) * rect.width, y = ((1 - p.y) / 2) * rect.height;
    el.style.transform = `translate(${Math.round(x - el.offsetWidth / 2)}px, ${Math.round(y - el.offsetHeight)}px)`;
  }

  /** Where the tee view is (for the HUD): progress of a flyover 0..1, or null. */
  flyProgress() {
    return this.fly ? clamp(this.fly.t / this.fly.play, 0, 1) : null;
  }

  // ------------------------------------------------------------------ flyover videos

  /** Records flyovers of the holes, one after another, to a video file: rendered offline, frame by
   * frame at a steady 1/fps step, into an offscreen picture of the asked size (the view on screen
   * keeps its size and goes on as before). See flyoverVideo.ts. */
  async recordFlyover(holeIds: string[], opts: RecordOptions & { ground?: PaintedLook | null }): Promise<FlyoverVideo> {
    if (!this.doc || this.disposed) throw new Error("The map isn't ready yet.");
    const doc = this.doc.course;
    const { recordFlights } = await import("./flyoverVideo");
    // The ground the video shows (the painted map, or the photo), whatever the screen shows
    if (opts.ground !== undefined) {
      this.paintedRecord = opts.ground;
      await this.applyPainted();
    }
    try {
      return await recordFlights(this.flightFrames(opts.width, opts.height), doc, holeIds, opts);
    } finally {
      if (opts.ground !== undefined) {
        this.paintedRecord = undefined;
        void this.applyPainted();
      } else void this.updateDetail();
    }
  }

  /** The painted map on the ground for the tee view and flyovers, with trees where it paints
   * woods (null: the photo). */
  setPaintedGround(look: PaintedLook | null) {
    this.paintedScreen = look;
    const done = this.applyPainted();
    this.detailReady = done.catch(() => {});
    return done;
  }

  /** A painted ground on its way (the tee view's Design look being painted): a flyover waits. */
  private paintedPending = false;
  setPaintedPending(on: boolean) { this.paintedPending = on; }

  private paintedScreen: PaintedLook | null = null;
  /** While recording: the ground the video shows (undefined: as on screen). */
  private paintedRecord: PaintedLook | null | undefined = undefined;
  /** Where the painting on the ground shows woods (3D trees stand there). */
  private paintedWoods: WoodedGrid | null = null;

  /** Paints the sharp picture round a hole (set by the app; null: none). */
  private detailPainter: ((holeId: string, maxPx: number) => Promise<PaintedDetailLook | null>) | null = null;
  setDetailPainter(fn: ((holeId: string, maxPx: number) => Promise<PaintedDetailLook | null>) | null) {
    this.detailPainter = fn;
    void this.updateDetail();
  }
  /** The longest side of the sharp painting (what the graphics card takes, at most 4096). */
  detailPx() {
    return Math.min(4096, this.renderer.capabilities.maxTextureSize, COARSE ? 2048 : 3072);
  }
  private detailAsk = 0;
  /** The sharp painting round `holeId` (default: the hole looked at), while the painted map shows.
   * While a video records, only the recording sets it (for each hole before its frames). */
  private async updateDetail(holeId = this.povHole, forVideo = false) {
    if (this.recordings > 0 && !forVideo) return;
    const ask = ++this.detailAsk;
    const look = this.paintedRecord !== undefined ? this.paintedRecord : this.paintedScreen;
    if (!holeId || holeId === STAND_HERE || !look || !this.detailPainter) {
      this.ground.setPaintedDetail(null);
      return;
    }
    const d = await this.detailPainter(holeId, this.detailPx());
    // (still wanted: asked for last, the same hole, the painted map still on)
    if (this.disposed || ask !== this.detailAsk) return;
    const now = this.paintedRecord !== undefined ? this.paintedRecord : this.paintedScreen;
    if (now && (forVideo || holeId === this.povHole)) this.ground.setPaintedDetail(d);
  }

  private async applyPainted() {
    const look = this.paintedRecord !== undefined ? this.paintedRecord : this.paintedScreen;
    await this.ground.setPainted(look?.url ?? null);
    if (this.disposed) return;
    if (!look) this.ground.setPaintedDetail(null);
    else await this.updateDetail();
    const woods = this.ground.paintedTexture ? look?.wooded ?? null : null;
    if (woods !== this.paintedWoods || this.shapesPainted !== !!this.ground.paintedTexture) {
      this.paintedWoods = woods;
      this.syncShapes();
    }
    this.invalidate(true);
  }
  /** Whether the shapes on the ground were last drawn for the painted map. */
  private shapesPainted = false;

  /** Flights over holes drawn offscreen at a fixed size, one moment at a time (for a recording):
   * like the flyover on screen, into a render target of its own. */
  flightFrames(width: number, height: number): FlightFrames {
    const gl = this.renderer.getContext();
    if (Math.max(width, height) > Math.min(this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number)) {
      throw new Error("This device's graphics can't draw a video that big: pick a smaller size.");
    }
    // Smooth edges (fewer samples on very big pictures, where they matter less and cost the most)
    const rt = new THREE.WebGLRenderTarget(width, height, { samples: width * height > 4e6 ? 2 : 4, type: THREE.UnsignedByteType, stencilBuffer: true });
    // Rendered exactly like the screen (tone mapping, sRGB colors) and with the same shaders: three
    // only does that for the screen and XR targets, so this target says it is one; its plain RGBA8
    // storage then holds the finished sRGB colors
    rt.texture.internalFormat = "RGBA8";
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    const raw = new Uint8Array(width * height * 4);
    this.recordings++;
    this.setVideoDetail(true);
    let open = true;
    const paths = new Map<string, ReturnType<CourseView["flightPath"]>>();
    const path = (id: string) => {
      if (!paths.has(id)) paths.set(id, this.flightPath(id));
      return paths.get(id) ?? null;
    };
    return {
      duration: id => path(id)?.play ?? 0,
      prepare: id => this.updateDetail(id, true),
      draw: (id, t, out): FrameInfo => {
        const p = path(id);
        if (!p) throw new Error("That hole can't be flown over.");
        if (this.disposed || !this.doc) throw new Error("The map view closed.");
        const cam = this.povCam;
        const saved = { fly: this.fly, hole: this.povHole, look: this.povLook, pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect, near: cam.near, far: cam.far };
        let info: FrameInfo = { basket: null, toBasket: 0 };
        try {
          this.fly = { ...p, t };
          this.povHole = id;
          this.povLook = { yaw: 0, pitch: 0 };
          cam.fov = 62;
          this.drawPov({ x: 0, y: 0, width, height }, rt);
          this.renderer.readRenderTargetPixels(rt, 0, 0, width, height, raw);
          const s = this.doc.stats.find(x => x.holeId === id);
          if (s?.complete) {
            const b = s.line[s.line.length - 1];
            const q = new THREE.Vector3(b.x, this.h(b.x, b.y) + 5, b.y).project(cam);
            const inside = q.z <= 1 && Math.abs(q.x) <= 1.05 && Math.abs(q.y) <= 1.05;
            info = { basket: inside ? { x: ((q.x + 1) / 2) * width, y: ((1 - q.y) / 2) * height } : null, toBasket: dist({ x: cam.position.x, y: cam.position.z }, b) };
          }
        } finally {
          this.fly = saved.fly;
          this.povHole = saved.hole;
          this.povLook = saved.look;
          cam.position.copy(saved.pos);
          cam.quaternion.copy(saved.quat);
          Object.assign(cam, { fov: saved.fov, aspect: saved.aspect, near: saved.near, far: saved.far });
          cam.updateProjectionMatrix();
        }
        // WebGL reads the bottom row first; the picture is opaque
        const row = width * 4;
        for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
        for (let i = 3; i < out.length; i += 4) out[i] = 255;
        return info;
      },
      dispose: () => {
        rt.dispose();
        if (open) this.recordings--;
        open = false;
        if (this.recordings === 0) this.setVideoDetail(false);
        this.invalidate();
      }
    };
  }

  // ------------------------------------------------------------------ frame loop

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    if (this.slowQueue.size && (this.flyWait || this.stillFor() > 150)) this.drainSlow();
    else if (this.needWarm && !this.slowQueue.size && !this.capturing && this.stillFor() > 300) { this.needWarm = false; this.warmUp(); }
    else if ((this.pondsDirty || this.picturing) && !this.slowQueue.size && !this.needWarm && !this.warming && !this.capturing && !this.fly && this.stillFor() > 600) this.pictureStep();
    this.gliding = this.controls.update(dt);
    if (this.gliding) this.dirty = true;
    if (this.glide) { this.stepGlide(dt); this.dirty = true; }
    if (this.lookGlide) { this.stepLookGlide(dt); this.dirty = true; }
    if (!this.fly && this.stepFree(dt)) this.dirty = true;
    if (this.fly) {
      // Held on its first picture until everything's in (a few frames drawn after), then at most
      // a quarter second per frame: a slow first frame (or a tab coming back from the background)
      // must not skip the flight
      const w = this.flyWait;
      if (w && (w.loaded ? ++w.frames < 4 : true) && performance.now() - w.since < FLY_WAIT_MS) { /* waiting */ }
      else {
        if (w) this.cb.onFlyWait(null);
        this.flyWait = null;
        this.fly.t += Math.min(dt, 0.25);
      }
      this.dirty = true;
      // (a moment at the basket before it ends, as in a recording)
      if (this.fly.t >= this.fly.play + (this.fly.title ? VIDEO_HOLD.outro : 0)) {
        const done = this.fly.done;
        this.fly = null;
        this.povCam.fov = this.povFov;
        done?.();
      }
    }
    if (this.draftPending) {
      this.draftPending = false;
      this.drawDraft();
    }
    // Grass swaying and water rippling in the wind, from the tee (at most 30 frames a second on a
    // phone when nothing else moves: the battery matters more than the breeze; and still while a
    // video records, whose frames would otherwise wait on the screen's)
    const breeze = !!this.povHole && this.wind && this.recordings === 0;
    // (standing on the course, not flying: always the full render, whatever the device)
    const street = !!this.povHole && !this.fly && !this.software;
    if (street !== this.streetDetail) this.setStreetDetail(street);
    if (breeze && !(this.mobile && !this.dirty && performance.now() - this.lastRender < 33)) this.dirty = true;
    // (While a video records, the screen at most 8 times a second: on a slow device its pictures
    // would take the recording's time, and the recording is what is being waited for)
    if (!this.dirty || this.size.width <= 1 || this.paused || (this.recordings > 0 && performance.now() - this.lastRender < 125)) {
      this.drewLastTick = false;
      return;
    }
    this.dirty = false;
    const now = performance.now();
    // Frame after frame (something moving, a picture on every tick): how long each took, to keep
    // the frame rate up. Only ticks that drew one after the other count, so the pauses between
    // two separate changes are never taken for slow frames, and frames however slow always count
    // (not a gap of minutes, though: a tab coming back from the background)
    if (this.drewLastTick && now - this.lastRender < 2000) this.perfSample(now - this.lastRender);
    this.drewLastTick = true;
    this.lastRender = now;
    this.frames++;
    this.render();
  };

  /**
   * Quality that keeps the view smooth: frame times are watched while the view moves, and when
   * frames run slow (under 30 a second) the picture gets a step less sharp (pixel ratio), then
   * less grass, softer shadows and fewer trees in full detail; it steps back up when there is
   * room again. Software rendering (no graphics card) keeps its own fixed, lower settings.
   */
  perfSample(ms: number) {
    if (this.software && !this.adaptiveForced) return;
    const s = this.perfSamples;
    s.push(ms);
    // A window of 24 frames, or a second and a half on a slow device (24 frames at 5 a second
    // would be five seconds of a juddering view for every step)
    if (s.length < 6 || (s.length < 24 && s.reduce((a, b) => a + b, 0) < 1500)) return;
    const sorted = [...s].sort((a, b) => a - b);
    const median = sorted[s.length >> 1];
    s.length = 0;
    // Standing: the full render while the device keeps up; stepped down only when it truly can't
    // (under about 20 frames a second), and never below the middle step
    const street = this.streetDetail;
    const slow = street ? 50 : 34, most = street ? 2 : 4;
    if (median > slow && this.tier < most) {
      this.fastWindows = 0;
      // (Very slow, under about 14 frames a second: two steps at once)
      this.setTier(Math.min(most, this.tier + (median > 70 ? 2 : 1)));
    } else if (median < (street ? 25 : 17) && this.tier > 0) {
      // (only after a few quick windows in a row: no flickering between two levels)
      if (++this.fastWindows >= 3) {
        this.fastWindows = 0;
        this.setTier(this.tier - 1);
      }
    } else this.fastWindows = 0;
  }

  /**
   * Standing on the course (street view, from a tee or anywhere): always the full render, as a
   * computer draws it, on a phone too: the sharpest picture, a computer's grass, shadows and trees
   * in full detail, and nothing stepped down when frames run slow (standing, the view is drawn
   * only when it moves). Back to what keeps this device smooth once it's left.
   */
  private streetDetail = false;
  private setStreetDetail(on: boolean) {
    this.streetDetail = on;
    this.fastWindows = 0;
    this.perfSamples.length = 0;
    // (starting at the full render; a device that can't keep up steps down from it, see perfSample)
    this.setTier(on ? 0 : this.tier);
  }

  /** A quality level: 0 full .. 4 the lightest. */
  setTier(tier: number) {
    this.tier = Math.max(0, Math.min(4, tier));
    const ratio = this.streetDetail ? Math.min(window.devicePixelRatio || 1, 2) * [1, 0.85, 0.72][Math.min(2, this.tier)] : Math.max(0.75, this.maxRatio * [1, 0.85, 0.72, 0.6, 0.5][this.tier]);
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > 0.01) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.size.width, this.size.height, false);
    }
    // (a video records with its own: see setVideoDetail)
    if (this.videoDetail) return this.invalidate();
    const shadow = this.streetDetail ? (this.tier >= 2 ? 1024 : 2048) : this.tier >= 3 ? 512 : this.mobile || this.tier >= 2 ? 1024 : 2048;
    // (soft shadow edges: a few looks a pixel while frames keep up, one when they don't: no shader
    // made again, three/softShadows reads the radius)
    this.sun.shadow.radius = this.tier >= 2 ? 1 : SHADOW_SOFT;
    if (this.sun.shadow.mapSize.x !== shadow) {
      this.sun.shadow.mapSize.set(shadow, shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.shadowsDirty = true;
    }
    forestDetail.nearFt = this.streetDetail ? 260 : (this.software ? 70 : this.mobile ? 150 : 260) * (this.tier >= 3 ? 0.6 : 1);
    forestDetail.all = false;
    forestDetail.version++;
    retuneTrees(this.itemsGroup);
    this.invalidate();
  }

  /** While a video records: drawn finer than on screen (each frame can take its time): every
   * tree in full detail however far off, so none changes as the camera comes up to it, the most
   * grass, finer shadows, thinner haze. */
  private videoDetail = false;
  private setVideoDetail(on: boolean) {
    if (on === this.videoDetail) return;
    this.videoDetail = on;
    if (!on) {
      // (back to what this device draws on screen)
      this.setTier(this.tier);
      return;
    }
    // (without a graphics card, only the thinner haze: each frame is slow enough already)
    if (this.software) return;
    forestDetail.all = true;
    forestDetail.version++;
    retuneTrees(this.itemsGroup);
    const shadow = Math.min(this.mobile ? 2048 : 4096, this.renderer.capabilities.maxTextureSize);
    if (this.sun.shadow.mapSize.x !== shadow) {
      this.sun.shadow.mapSize.set(shadow, shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.shadowsDirty = true;
    }
  }

  /**
   * Covered by another screen (the Design step's page): draw nothing until shown again (it would
   * only cost a phone its battery). Changes made meanwhile are drawn when it comes back.
   */
  setPaused(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    this.lastRender = 0;
    if (!on) this.invalidate();
  }

  /** For tests: whether the view is drawing, how many pictures it has drawn, and whether a video records. */
  drawInfo() {
    return { paused: this.paused, frames: this.frames, recording: this.recordings > 0 };
  }

  /** For tests: the quality level now. */
  qualityInfo() {
    return { tier: this.tier, pixelRatio: this.renderer.getPixelRatio(), shadow: this.sun.shadow.mapSize.x, nearFt: forestDetail.nearFt, allTrees: forestDetail.all, grass: this.grassQuality(), mobile: this.mobile, software: this.software, video: this.videoDetail, haze: this.videoDetail ? 0.5 : 1 };
  }

  /** For tests: let the frame-rate watch work under software rendering too (a fresh window). */
  forceAdaptive(on = true) {
    this.adaptiveForced = on;
    this.perfSamples.length = 0;
  }

  private render() {
    timed("3D frame drawn", () => this.renderFrame());
  }
  private renderFrame() {
    if (this.povHole) {
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      this.drawPov({ x: 0, y: 0, width: this.size.width, height: this.size.height });
      // (editing: the map from above in a corner, drawn with its own camera)
      const m = this.miniPlace();
      this.miniRect = m && this.placeMini(m) ? m : null;
      if (this.miniRect) {
        const H = this.size.height;
        this.renderer.setViewport(m!.x, H - m!.y - m!.height, m!.width, m!.height);
        this.renderer.setScissor(m!.x, H - m!.y - m!.height, m!.width, m!.height);
        this.renderer.setScissorTest(true);
        this.renderer.render(this.scene, this.miniCam);
        this.renderer.setScissorTest(false);
      }
      this.renderer.setViewport(0, 0, this.size.width, this.size.height);
      // (what's placed over the view, comment pins and the like, follows it as it looks round and walks)
      const c = this.povCam, key = `pov|${c.position.x.toFixed(2)}|${c.position.y.toFixed(2)}|${c.position.z.toFixed(2)}|${c.quaternion.x.toFixed(4)}|${c.quaternion.y.toFixed(4)}|${c.quaternion.z.toFixed(4)}|${c.fov.toFixed(2)}|${this.size.width}|${this.size.height}`;
      if (key !== this.lastViewKey && !this.capturing) {
        this.lastViewKey = key;
        const info = this.viewInfo();
        this.viewListeners.forEach(fn => fn(info));
      }
      return;
    }
    // Tilting widens the lens; the camera moves in to keep the scale where it looks
    {
      const t = clamp((this.controls.polarAngle - TILT_TOP) / (55 * DEG - TILT_TOP), 0, 1);
      const fov = FOV_TOP + (FOV_TILT - FOV_TOP) * t * t * (3 - 2 * t);
      if (Math.abs(this.camera.fov - fov) > 0.05) {
        const k = Math.tan((this.camera.fov * DEG) / 2) / Math.tan((fov * DEG) / 2);
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
        void this.controls.dollyTo(this.controls.distance * k, false);
        this.controls.update(0);
      }
    }
    const dist = this.controls.distance;
    const near = clamp(dist * 0.01, 0.05, 20);
    const far = dist * 6 + this.siteSpan() * 4;
    if (Math.abs(this.camera.near - near) > near * 0.2 || Math.abs(this.camera.far - far) > far * 0.2) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    if (this.shadowsDirty || this.nearShadowAt) {
      this.placeSun();
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    this.camera.updateMatrixWorld();
    if (!this.lastEye.equals(this.camera.position) || !this.lastLook.equals(this.camera.quaternion)) {
      this.movedAt = performance.now();
      this.lastEye.copy(this.camera.position);
      this.lastLook.copy(this.camera.quaternion);
    }
    const tilted = this.controls.polarAngle > TILT_TOP;
    this.ground.detailActive(dist < 250 && !this.software && this.tier < 4);
    // Tilted, the course is a place: sky, haze, land to the horizon and grass up close
    this.lastSky = false;
    const restore = tilted ? this.atmosphere(this.camera, false) : null;
    this.updateGrass(this.camera, tilted);
    this.updateForests(this.camera.position);
    if (this.treesHidden || this.treesShownAt !== this.treesHidden) { this.showTrees(); this.treesShownAt = this.treesHidden; }
    waterUniforms.uTime.value = this.clock.elapsedTime;
    this.renderer.render(this.scene, this.camera);
    restore?.();
    this.layout();
    const info = this.viewInfo();
    const key = `${info.heading.toFixed(2)}|${info.tiltDeg.toFixed(2)}|${info.pxPerUnit.toFixed(5)}|${info.width}|${info.height}|${this.camera.position.x.toFixed(2)}|${this.camera.position.z.toFixed(2)}`;
    if (key !== this.lastViewKey && !this.capturing) {
      this.lastViewKey = key;
      this.viewListeners.forEach(fn => fn(info));
      const pose = this.controls.polarAngle > TILT_TOP ? "tilt" : "top";
      if (pose !== this.pose && !this.posePinned) {
        this.pose = pose;
        this.cb.onPose(pose);
      }
    }
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(r.width));
    const height = Math.max(1, Math.round(r.height));
    if (width === this.size.width && height === this.size.height) return;
    const was = this.size.height;
    this.size = { width, height };
    // (the map keeping its scale as its box grows or shrinks, a phone's steps making way for a bar
    // say: more of it shows, nothing zooms; not standing on the course, where the view is the eye's)
    if (this.fitted && was > 1 && !this.povHole && !this.eye) {
      const d = clamp(this.controls.distance * (height / was), this.controls.minDistance, this.controls.maxDistance);
      void this.controls.dollyTo(d, false);
    }
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    lineMats.forEach(m => m.resolution.set(width, height));
    if (!this.fitted && this.doc && width > 1) {
      this.fitted = true;
      this.fitCourse(false);
    }
    this.invalidate();
  }

  private siteSpan() {
    return this.doc ? Math.max(this.doc.canvas.width, this.doc.canvas.height) : 1500;
  }

  /**
   * Sky, haze and the land out to the horizon around a camera, for one picture (`eyeLevel`: seen
   * from the ground, where the haze thickens sooner). Returns how to put the map's backdrop back.
   */
  private atmosphere(cam: THREE.PerspectiveCamera, eyeLevel: boolean) {
    const span = this.siteSpan();
    const sm = this.skyBox.material as THREE.ShaderMaterial;
    this.skyBox.scale.setScalar(cam.far * 1.05);
    this.skyBox.position.copy(cam.position);
    const photo = this.photoSky;
    if (photo) {
      photo.scale.setScalar(cam.far * 0.9);
      photo.position.copy(cam.position);
      photo.visible = true;
      photo.updateMatrixWorld();
      // (as bright as the rest of the picture is set to be)
      const light = (photo.material as THREE.Material).userData.light as { value: number } | undefined;
      if (light) light.value = clamp(this.renderer.toneMappingExposure / EXPOSURE, 0.6, 1.5);
    }
    // (the model only where there's no photo: at night, or before the photo has come)
    this.skyBox.visible = !photo;
    this.lastSky = true;
    this.skyBox.updateMatrixWorld();
    this.ground.landscape(true);
    const prevFog = this.scene.fog;
    const prevBg = this.scene.background;
    const haze = sm.uniforms.uHaze.value as THREE.Color;
    // Thin haze over the site, thick toward the horizon: distance reads as distance
    // (thinner in a video: it reaches farther)
    const thin = this.videoDetail ? 0.5 : 1;
    // (one haze, its density and color set each picture: a new one would have every material
    // worked out again, each frame)
    this.haze.density = (eyeLevel ? 0.8 / (span * 2.4) : 0.7 / (span * 3.2)) * thin;
    this.haze.color.copy(haze);
    this.scene.fog = this.haze;
    this.scene.background = haze;
    return () => {
      this.scene.fog = prevFog;
      this.scene.background = prevBg;
      this.skyBox.visible = false;
      if (this.photoSky) this.photoSky.visible = false;
      this.ground.landscape(false);
    };
  }

  /** Grass blades near the camera: in 3D only (looking straight down they can't be seen). */
  private updateGrass(cam: THREE.PerspectiveCamera, on: boolean) {
    const doc = this.doc;
    const q = this.grassQuality();
    this.grass.setQuality(on && doc ? q : 0);
    this.tufts.setQuality(on && doc ? q : 0);
    if (!doc || !on || !q) {
      this.grass.group.visible = false;
      this.tufts.group.visible = false;
      return;
    }
    // What grows where: painted again when the course changed (at most a few times a second
    // while something is dragged)
    const key = [doc.course.items, doc.stats, doc.groundPaint, doc.course.style, doc.groundColor, doc.canvas, doc.course.holes];
    if (key.some((k, i) => (this.grassInputs[i] ?? null) !== k)) {
      const now = performance.now();
      if (now - this.grassBuilt > 300 || !this.grassInputs.length) {
        this.grassInputs = key;
        this.grassBuilt = now;
        const maps = grassMaps(doc);
        if (maps) this.grass.setMaps(maps);
      } else {
        clearTimeout(this.grassTimer);
        this.grassTimer = window.setTimeout(() => this.invalidate(), 320);
      }
    }
    if (this.grassTerrainRef !== doc.heights) {
      this.grassTerrainRef = doc.heights;
      this.grass.setTerrain(grassTerrain(doc));
    }
    const photo = this.ground.paintedTexture ?? (this.ground.photo && doc.background.opacity > 0.3 ? this.ground.photo : null);
    if (this.grassPhoto !== photo) {
      this.grassPhoto = photo;
      this.grass.setPhoto(photo, doc.background.rect, 0.8);
    }
    const p = cam.position;
    const t = this.clock.elapsedTime;
    const wind = this.wind && this.povHole ? 0.14 : 0.05;
    this.grass.update(p, this.h(clamp(p.x, 0, doc.canvas.width), clamp(p.z, 0, doc.canvas.height)), t, wind);
    this.tufts.update(p, t, wind, this.grass.group.visible);
  }

  /** What a stretch of water mirrors on its banks: woods close by (high and dark) or open grass. */
  private waterShore(pts: P[]): [string, number] {
    const doc = this.doc;
    if (!doc) return ["#2a3a24", 0.08];
    const b = boundsOf(pts);
    const near = (p: P) => p.x > b.minX - 60 && p.x < b.maxX + 60 && p.y > b.minY - 60 && p.y < b.maxY + 60;
    const st = doc.course.style;
    const wooded = doc.course.items.some(i => (i.type === "area" && i.kind === "woods" && i.points.some(near)) || (i.type === "tree" && near(i)));
    return wooded || st.forest === "everywhere" ? [st.trees, 0.26] : [doc.groundColor, 0.06];
  }

  /**
   * The photographed sky for a sun (its direction): midday's for a high sun, the late afternoon's,
   * or the sunset's for a low one (by the height of each photo's own sun); none at night, where
   * the sky model's dark sky stays. Turned so the photo's sun is where the course's sun is. Its
   * picture comes once (a phone's smaller), then stays.
   */
  private photoSkyFor(dir: THREE.Vector3) {
    // (without a graphics card the sky model stays: decoding and drawing the photo is the processor's work)
    if (this.software) return;
    if (!this.skyPhotos) {
      if (this.skyAsked) return;
      this.skyAsked = true;
      void fetch(`${import.meta.env.BASE_URL}sky/skies.json`).then(r => r.json()).then(j => { if (this.disposed) return; this.skyPhotos = j; this.photoSkyFor(dir); }).catch(() => {});
      return;
    }
    const alt = Math.asin(clamp(dir.y, -1, 1)) / DEG;
    const name = alt <= 1 ? "" : alt >= 34 ? "midday" : alt >= 12 ? "afternoon" : "sunset";
    const info = name ? this.skyPhotos[name] : null;
    if (!info) {
      if (this.photoSky) { this.scene.remove(this.photoSky); this.photoSky = null; this.photoSkyName = ""; this.skyEnvKey = ""; }
      return;
    }
    const turn = () => {
      // (the photo's sun, as three.js lays out a photo of all round: its angle round from +x; the
      // sky turned by the difference to the course's)
      const a = (info.sunU - 0.5) * Math.PI * 2, want = Math.atan2(dir.z, dir.x);
      if (this.photoSky) this.photoSky.rotation.y = a - want;
    };
    if (this.photoSkyName === name) { turn(); return; }
    this.photoSkyName = name;
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}sky/${name}-${this.mobile ? "2k" : "4k"}.jpg`, tex => {
      if (this.disposed || this.photoSkyName !== name) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      // (its color just over the horizon, all the way round: the haze's)
      try {
        const img = tex.image as HTMLImageElement, c = document.createElement("canvas");
        c.width = 64; c.height = 2;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, img.height * 0.9, img.width, img.height * 0.08, 0, 0, 64, 2);
        const px = g.getImageData(0, 0, 64, 2).data;
        let r = 0, gg = 0, b = 0;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
        const n = px.length / 4;
        this.skyHorizon = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
      } catch { this.skyHorizon = null; }
      // (the picture is the upper half, horizon to overhead; three.js's sphere runs the other way round)
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(-1, 2);
      tex.offset.set(1, -1);
      tex.anisotropy = 4;
      const sm = this.skyBox.material as THREE.ShaderMaterial;
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
      mat.onBeforeCompile = shader => {
        shader.uniforms.uHaze = sm.uniforms.uHaze;
        shader.uniforms.uSkyLight = { value: 1 };
        mat.userData.light = shader.uniforms.uSkyLight;
        // (pinned to the far limit, as three.js's own sky is: never cut away by it, whatever its size)
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSkyDir;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkyDir = position;").replace("#include <project_vertex>", "#include <project_vertex>\ngl_Position.z = gl_Position.w;");
        // (melting into the haze at the horizon, as the land does; under it, the haze)
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vSkyDir;\nuniform vec3 uHaze;\nuniform float uSkyLight;")
          .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix( uHaze, diffuseColor.rgb * uSkyLight, smoothstep( -0.01, 0.1, normalize( vSkyDir ).y ) );");
      };
      mat.customProgramCacheKey = () => "dg-photo-sky";
      const old = this.photoSky;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
      mesh.renderOrder = -9;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.raycast = () => {};
      this.photoSky = mesh;
      turn();
      this.scene.add(mesh);
      if (old) { this.scene.remove(old); (old.material as THREE.MeshBasicMaterial).map?.dispose(); (old.material as THREE.Material).dispose(); old.geometry.dispose(); }
      // (the light from the sky takes a little of its color; the water mirrors it)
      this.hemi.color.set(0xeef4ff).lerp(new THREE.Color(info.average), 0.3);
      this.skyEnvKey = "";
      this.placeSun();
      this.invalidate();
    }, undefined, () => { if (this.photoSkyName === name) this.photoSkyName = ""; });
  }

  /** The sky as an environment map, for water to reflect (only when the sun has moved). */
  private updateSkyEnv(dir: THREE.Vector3) {
    const key = `${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)},${this.photoSky ? this.photoSkyName : ""}`;
    if (key === this.skyEnvKey) return;
    this.skyEnvKey = key;
    const sky = new Sky();
    const src = this.skyBox.material as THREE.ShaderMaterial;
    const mat = src.clone();
    for (const k of Object.keys(src.uniforms)) {
      const v = src.uniforms[k].value;
      mat.uniforms[k] = { value: v && typeof v.clone === "function" ? v.clone() : v };
    }
    sky.material = mat;
    sky.scale.setScalar(1000);
    const scene = new THREE.Scene();
    scene.add(sky);
    if (this.photoSky) {
      const photo = new THREE.Mesh(this.photoSky.geometry, this.photoSky.material);
      photo.rotation.copy(this.photoSky.rotation);
      photo.scale.setScalar(900);
      scene.add(photo);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(scene, 0, 1, 3000);
    pmrem.dispose();
    mat.dispose();
    sky.geometry.dispose();
    this.skyEnv?.dispose();
    this.skyEnv = rt;
    this.scene.environment = rt.texture;
    setWaterSky(rt.texture);
    waterUniforms.uSunDir.value.copy(dir).normalize();
    waterUniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.min(1.3, this.sun.intensity / SUN_INTENSITY));
    this.pondsAgain();
  }

  /** Woods: the trees near the camera in full detail. */
  private updateForests(eye: THREE.Vector3, cam?: THREE.PerspectiveCamera) {
    for (const o of this.itemsGroup.children) {
      (o.userData.forest as Forest | undefined)?.update(eye, cam);
      // (a hedge's bushes, inside its line's group)
      for (const c of o.children) (c.userData.forest as Forest | undefined)?.update(eye, cam);
    }
  }

  /** How much grass to draw: as set, or (automatically) none without a graphics card. */
  private grassQuality(): GrassQuality {
    // (a video: the most grass, but where there is no graphics card or it is switched off)
    if (this.videoDetail && !this.software && this.grassSetting !== 0) return 3;
    if (this.grassSetting !== "auto") return this.grassSetting;
    // Automatic: off without a graphics card, low on a phone, and less while frames run slow
    // (standing: a computer's, on a phone too)
    if (this.streetDetail) return this.tier >= 2 ? 1 : 2;
    const base = this.software ? 0 : this.mobile ? 1 : 2;
    return Math.max(0, base - (this.tier >= 4 ? 2 : this.tier >= 2 ? 1 : 0)) as GrassQuality;
  }

  /** Grass detail (0 off .. 3 high, or automatic) and whether it sways in the wind. */
  setGrass(quality: GrassQuality | "auto", wind = this.wind) {
    this.grassSetting = quality;
    this.wind = wind;
    this.invalidate();
  }

  /** Ground height at a plan point, ft (for tests and scripted views). */
  groundHeight(x: number, y: number) {
    return this.h(x, y);
  }

  /** For tests: how tall the 3D grass grows at plan points, ft (0: none grows there). */
  grassHeights(pts: P[]) {
    const maps = this.doc ? grassMaps(this.doc) : null;
    if (!maps) return [];
    const g = maps.field.getContext("2d", { willReadFrequently: true })!;
    const kx = maps.field.width / maps.rect.width, ky = maps.field.height / maps.rect.height;
    return pts.map(p => {
      const d = g.getImageData(Math.floor((p.x - maps.rect.x) * kx), Math.floor((p.y - maps.rect.y) * ky), 1, 1).data;
      return d[1] > 12 ? (d[0] / 255) * GRASS.max : 0;
    });
  }

  /** For tests: trees in the woods, and how many are drawn in full detail (as seen from `eye`). */
  forestInfo(eye?: { x: number; y: number; z: number }) {
    if (eye) this.updateForests(new THREE.Vector3(eye.x, eye.y, eye.z));
    let trees = 0, near = 0, conifers = 0;
    for (const o of this.itemsGroup.children) {
      const c = (o.userData.forest as Forest | undefined)?.counts();
      if (c) { trees += c.trees; near += c.near; conifers += c.conifers; }
    }
    return { trees, near, conifers, plantings: this.plantings };
  }

  /** For tests: trees of the woods standing within `r` ft of a plan point. */
  treesNear(x: number, y: number, r: number) {
    let n = 0;
    for (const o of this.itemsGroup.children) n += (o.userData.forest as Forest | undefined)?.treesNear(x, y, r) ?? 0;
    return n;
  }

  /** For tests: the last picture's sky, sun and grass. */
  sceneInfo() {
    const d = this.sun.position.clone().sub(this.sun.target.position).normalize();
    return {
      sky: this.lastSky,
      sun: { x: d.x, y: d.y, z: d.z },
      exposure: this.renderer.toneMappingExposure,
      grass: { quality: this.grass.getQuality(), visible: this.grass.group.visible, blades: this.grass.blades },
      software: this.software
    };
  }

  private placeSun() {
    const doc = this.doc;
    if (!doc) return;
    const span = this.siteSpan();
    const center = new THREE.Vector3(doc.canvas.width / 2, 0, doc.canvas.height / 2);
    let dir = new THREE.Vector3(-0.45, 1, 0.55).normalize();
    let strength = 1;
    if (doc.sun) {
      const az = doc.sun.azimuth * DEG, alt = Math.max(4, doc.sun.altitude) * DEG;
      dir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
      strength = doc.sun.altitude <= 0 ? 0.08 : Math.min(1, 0.35 + doc.sun.altitude / 25);
    }
    // Darker shadows: less light from the sky filling them in
    const shadows = clamp(doc.sun?.shadows ?? 0.65, 0, 1);
    this.sun.intensity = SUN_INTENSITY * strength;
    this.hemi.intensity = HEMI_INTENSITY * (0.45 + 0.55 * Math.min(1, strength * 1.2)) * (1.55 - 0.85 * shadows);
    this.scene.environmentIntensity = SKY_FILL * Math.min(1, strength * 1.2) * (1.55 - 0.85 * shadows);
    this.renderer.toneMappingExposure = EXPOSURE * Math.pow(2, (doc.sun?.light ?? 0) * 1.6);
    // The sky's sun, and its haze: blue-grey at midday, warmer when the sun is low
    {
      const sm = this.skyBox.material as THREE.ShaderMaterial;
      (sm.uniforms.sunPosition.value as THREE.Vector3).copy(dir);
      const low = 1 - clamp((Math.asin(clamp(dir.y, -1, 1)) / DEG - 8) / 40, 0, 1);
      (sm.uniforms.uHaze.value as THREE.Color).set("#c4d0d9").lerp(new THREE.Color("#dcc8ae"), low * 0.65);
      this.photoSkyFor(dir);
      if (this.photoSky && this.skyHorizon) (sm.uniforms.uHaze.value as THREE.Color).lerp(this.skyHorizon, 0.85);
      this.updateSkyEnv(dir);
    }
    this.sunDir.copy(dir);
    // (the shadows of the whole site again; standing or flying, they're redone round the eye)
    this.nearShadowAt = null;
    this.sun.position.copy(center).add(dir.multiplyScalar(span * 1.5));
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = -span * 0.8;
    cam.right = span * 0.8;
    cam.top = span * 0.8;
    cam.bottom = -span * 0.8;
    cam.near = 1;
    cam.far = span * 4;
    cam.updateProjectionMatrix();
    const texel = (span * 1.6) / this.sun.shadow.mapSize.x;
    this.sun.shadow.normalBias = Math.max(0.6, texel * 2.5);
    this.sun.shadow.bias = -0.001;
  }

  /** The sun's direction (toward it), as placeSun last set it. */
  private sunDir = new THREE.Vector3(-0.45, 1, 0.55).normalize();
  /** Where the shadows round the eye were last drawn (null: the whole site's are). */
  private nearShadowAt: THREE.Vector3 | null = null;
  /**
   * Standing or flying, the sun's shadows only round the eye and ahead of it (about 500 ft across,
   * 700 flying), so the same shadow picture gives each tree and trunk a crisp shadow, half a foot a
   * pixel on a phone, where the whole site's would smear them to blobs. Drawn again only once the
   * eye has moved on a fair way (30 ft, 70 flying), never every frame.
   */
  private nearShadows(cam: THREE.PerspectiveCamera) {
    // (big enough that its edge is well off, and moved on only after a fair walk: each move redraws
    // the shadows. Its edge fades out, three/softShadows, so a move shows no line)
    const R = this.fly ? 360 : 400;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const c = cam.position.clone().addScaledVector(fwd, R * 0.4);
    if (this.nearShadowAt && this.nearShadowAt.distanceTo(c) < (this.fly ? 70 : 60)) return;
    // Held to the shadow picture's own grid (whole texels across the sun's view), so moving on never
    // shifts a shadow's edge by part of a texel: the shadows stay put, not crawling
    const texel = (2 * R) / this.sun.shadow.mapSize.x;
    const right = new THREE.Vector3(0, 1, 0).cross(this.sunDir).normalize(), up = this.sunDir.clone().cross(right).normalize();
    const a = c.dot(right), b = c.dot(up);
    c.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up, Math.round(b / texel) * texel - b);
    this.nearShadowAt = c;
    this.sun.position.copy(c).addScaledVector(this.sunDir, R * 3);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
    sc.near = 1; sc.far = R * 6;
    sc.updateProjectionMatrix();
    this.sun.shadow.normalBias = Math.max(0.25, texel * 1.5);
    this.sun.shadow.bias = -0.0005;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private updateLimits() {
    const doc = this.doc;
    if (!doc) return;
    const span = this.siteSpan();
    this.controls.minDistance = 8;
    this.controls.maxDistance = span * 3;
    const pad = span * 0.25;
    this.controls.setBoundary(new THREE.Box3(new THREE.Vector3(-pad, -1e4, -pad), new THREE.Vector3(doc.canvas.width + pad, 1e4, doc.canvas.height + pad)));
  }

  private wrappedAzimuth() {
    const a = this.controls.azimuthAngle % (Math.PI * 2);
    return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a;
  }

  private snapNorth() {
    const a = this.wrappedAzimuth();
    if (Math.abs(a) > 1e-4 && Math.abs(a) < 7 * DEG) void this.controls.rotateAzimuthTo(this.northAzimuth(), true);
  }

  // ------------------------------------------------------------------ geometry helpers

  /** The whole view's picture: the map, or the tee view's. */
  private mainEye(): Eye {
    return { cam: this.povHole ? this.povCam : this.camera, rect: { x: 0, y: 0, width: this.size.width, height: this.size.height } };
  }

  /** The picture a point on screen is in: the corner map in tee view, else the whole view's. */
  private eyeAt(clientX: number, clientY: number): Eye {
    const m = this.miniRect;
    if (this.povHole && m) {
      const r = this.container.getBoundingClientRect();
      const x = clientX - r.left, y = clientY - r.top;
      if (x >= m.x && x <= m.x + m.width && y >= m.y && y <= m.y + m.height) return { cam: this.miniCam, rect: m };
    }
    return this.mainEye();
  }

  private project(v: THREE.Vector3) {
    const { cam, rect } = this.eye ?? this.mainEye();
    const p = v.clone().project(cam);
    if (p.z > 1 || p.z < -1) return null;
    return { x: rect.x + ((p.x + 1) / 2) * rect.width, y: rect.y + ((1 - p.y) / 2) * rect.height };
  }

  /** World units per screen pixel at a point. */
  private upp(v: THREE.Vector3) {
    const { cam, rect } = this.eye ?? this.mainEye();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const depth = Math.max(0.01, v.clone().sub(cam.position).dot(dir));
    return (2 * depth * Math.tan((cam.fov * DEG) / 2)) / rect.height;
  }

  private ray(clientX: number, clientY: number) {
    // (through the picture it's in: the map's, the tee view's, or the corner map's; a drag stays in its own)
    const { cam, rect } = this.dragEye ?? this.eyeAt(clientX, clientY);
    const r = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left - rect.x) / rect.width) * 2 - 1, -((clientY - r.top - rect.y) / rect.height) * 2 + 1);
    cam.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, cam);
    return this.raycaster.ray;
  }

  private groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const ray = this.ray(clientX, clientY);
    const hit = this.ground.rayHit(ray);
    if (hit) return hit;
    const out = new THREE.Vector3();
    return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out) ? out : null;
  }

  private planeAt(clientX: number, clientY: number, y: number): THREE.Vector3 | null {
    const out = new THREE.Vector3();
    return this.ray(clientX, clientY).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out) ? out : null;
  }

  private h(x: number, y: number) {
    return this.doc ? heightAt(this.doc.heights, this.doc.gridSize, x, y) : 0;
  }

  private item(id: string | null): CourseItem | null {
    return id ? this.doc?.course.items.find(i => i.id === id) ?? null : null;
  }

  private hole(id: string | null): Hole | null {
    return id ? this.doc?.course.holes.find(h => h.id === id) ?? null : null;
  }

  private num(holeId: string | undefined) {
    return holeId && this.doc ? holeLabel(this.doc.course, holeId) : "";
  }

  // ------------------------------------------------------------------ fat lines

  private fatLine(pts: THREE.Vector3[], color: string, widthPx: number, opts: { dashed?: number; opacity?: number; depthTest?: boolean; order?: number } = {}) {
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap(p => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: widthPx,
      transparent: true,
      opacity: opts.opacity ?? 1,
      dashed: !!opts.dashed,
      dashSize: opts.dashed ?? 1,
      gapSize: (opts.dashed ?? 1) * 0.7,
      depthTest: opts.depthTest ?? true,
      depthWrite: false
    });
    mat.resolution.set(this.size.width, this.size.height);
    lineMats.add(mat);
    const origDispose = mat.dispose.bind(mat);
    mat.dispose = () => { lineMats.delete(mat); origDispose(); };
    const line = new Line2(geo, mat);
    if (opts.dashed) line.computeLineDistances();
    line.renderOrder = opts.order ?? 3;
    line.raycast = () => {};
    return line;
  }

  private drapeLine(pts: P[], lift = LIFT, closed = false) {
    const grid = this.doc?.gridSize || 20;
    return drapedPoints(pts, (x, y) => this.h(x, y), Math.max(4, grid / 2), lift, closed);
  }

  /** The tee colors and pins only the other layouts play (faded while this one is worked on). */
  private otherLayouts() {
    const course = this.doc!.course;
    const on = course.layouts.find(l => l.id === course.activeLayout) ?? course.layouts[0];
    const rest = course.layouts.filter(l => l !== on);
    return { tees: new Set(rest.map(l => l.tee).filter(t => t !== on?.tee)), pins: new Set(rest.map(l => l.pin).filter(p => p !== on?.pin)) };
  }

  // ------------------------------------------------------------------ scene sync: 3D objects

  private signature(item: CourseItem) {
    const doc = this.doc!;
    switch (item.type) {
      case "tee": return JSON.stringify([item.level, item.padLength, item.padWidth, item.surface, this.num(item.holeId)]);
      case "basket": return JSON.stringify([doc.course.style.basketBand ?? BASKET_BAND, this.num(item.holeId)]);
      case "mando": return item.side;
      case "dropzone": return "dz";
      case "tree": return getTreeSignature(item as TreeItem) + item.id + (this.doc ? `|${this.doc.course.style.trees}|${this.doc.course.style.landscape ?? ""}|${this.doc.course.style.treeMix?.join() ?? ""}` : "");
      case "amenity": return item.kind;
      default: return "";
    }
  }

  private buildObject(item: CourseItem): THREE.Object3D | null {
    const doc = this.doc!;
    switch (item.type) {
      case "tee": return createTeePad(item, this.num(item.holeId));
      case "basket": return createBasket(doc.course.style.basketBand ?? BASKET_BAND, this.num(item.holeId));
      case "mando": return createMando(item.side);
      case "dropzone": return createDropZone();
      case "tree": { const st = doc.course.style; return create3dTree(item, { color: st.trees, mix: treeMixOf(st) }); }
      case "amenity": return createAmenity(item.kind);
      default: return null;
    }
  }

  private place(obj: THREE.Object3D, item: CourseItem) {
    const doc = this.doc!;
    const g = this.h(item.x, item.y);
    if (item.type === "tee") {
      const aim = teeAim(doc.course, item);
      obj.position.set(item.x, g, item.y);
      obj.rotation.set(0, -aim * DEG, 0);
      // (level on sloping ground, never cut by it)
      fitTeePad(obj, item, aim, (x, y) => this.h(x, y));
    } else if (item.type === "basket") {
      obj.position.set(item.x, g + (item.raised ?? 0), item.y);
      obj.rotation.set(0, 0, 0);
    } else {
      obj.position.set(item.x, g + OBJECT_ELEVATION_OFFSET, item.y);
      obj.rotation.set(0, -item.rotation * DEG, 0);
    }
  }

  private tagObject(obj: THREE.Object3D, id: string) {
    obj.userData.itemId = id;
    obj.traverse(o => {
      o.userData.itemId = id;
      if ((o as THREE.Mesh).isMesh && !(o as THREE.Mesh).castShadow && o.parent === obj) (o as THREE.Mesh).castShadow = true;
    });
  }

  private syncItems() {
    timed("3D things made again", () => this.syncItemsAll());
  }
  private syncItemsAll() {
    const doc = this.doc!;
    const seen = new Set<string>();
    for (const item of doc.course.items) {
      if (item.type === "label" || item.type === "area" || item.type === "line") continue;
      seen.add(item.id);
      const sig = this.signature(item);
      let entry = this.objects.get(item.id);
      if (!entry || entry.sig !== sig) {
        if (entry) {
          this.itemsGroup.remove(entry.obj);
          disposeObjectDeep(entry.obj);
        }
        const obj = this.buildObject(item);
        if (!obj) continue;
        this.tagObject(obj, item.id);
        entry = { obj, sig };
        this.objects.set(item.id, entry);
        this.itemsGroup.add(obj);
        this.shadowsDirty = true;
      }
      this.place(entry.obj, item);
      // (an item stays where it's placed: its matrices worked out here, not again every frame for
      // the thousands of parts the trees, tees and baskets are made of)
      entry.obj.userData.placed = true;
      entry.obj.updateMatrixWorld(true);
    }
    for (const [id, entry] of this.objects) {
      if (seen.has(id)) continue;
      this.itemsGroup.remove(entry.obj);
      disposeObjectDeep(entry.obj);
      this.objects.delete(id);
      this.shadowsDirty = true;
    }
  }

  // ------------------------------------------------------------------ scene sync: drawn shapes

  /**
   * Everything drawn on the ground: areas, lines, fairways, throw lines (and their flight arcs in
   * 3D), putting circles, next-tee walks and mando lines. Each piece is rebuilt only when what it
   * depends on changes.
   */
  private syncShapes() {
    timed("3D shapes made again", () => this.syncShapesAll());
  }
  private syncShapesAll() {
    const doc = this.doc!;
    const course = doc.course;
    const st = course.style;
    // (the course's kinds of trees: the woods' and the measured trees'; lib/treeMix)
    const shares = sharesOf(st);
    const seen = new Set<string>();
    const hv = this.heightsVersion;
    const put = (key: string, sig: string, make: () => THREE.Object3D | null, group: THREE.Group = this.shapesGroup, slow = false) => {
      seen.add(key);
      const entry = this.shapes.get(key);
      if (entry && entry.sig === sig) return;
      // (slow to make, such as woods: kept as they are while dragging, made again at its end)
      if (slow && entry && this.dragging) { this.afterDrag = true; return; }
      // (and made a few at a time, over the frames after: see drainSlow)
      if (slow) { this.slowQueue.set(key, { sig, make, group }); this.dirty = true; return; }
      if (entry) {
        entry.obj.parent?.remove(entry.obj);
        disposeObjectDeep(entry.obj);
        this.shapes.delete(key);
      }
      const obj = make();
      if (!obj) return;
      obj.traverse(o => { o.raycast = () => {}; });
      if (!obj.name) obj.name = key;
      group.add(obj);
      this.shapes.set(key, { obj, sig });
    };
    /** A slow thing (woods, underbrush) already made, while a drag is under way: kept as it is,
     * without working out what it depends on; made again at the drag's end. */
    const held = (key: string) => {
      if (!this.dragging || !this.shapes.has(key)) return false;
      seen.add(key);
      this.afterDrag = true;
      return true;
    };
    const pdga = st.markings === "pdga";
    const color = (kind: string) => (kind === "ob" ? (pdga ? "#ffffff" : st.ob) : kind === "nogo" && pdga ? RESTRICTED : kind === "hazard" ? st.hazard : kind === "water" ? st.water : kind === "fairway" ? st.fairway : kind === "woods" ? st.trees : kind === "parking" ? st.look3d?.paving ?? null : null);
    const photo = !!doc.background.url && doc.background.opacity > 0.3;
    // The painted map on the ground (flyovers, the tee view): it has the fairways, grass, woods,
    // paths and roads painted already; the rules (OB, hazards), water and what stands up stay
    const painted = !!this.ground.paintedTexture;
    this.shapesPainted = painted;
    // A map only looked at (shared to view, the public page): what stands there, rendered, and
    // the rules (OB, hazards, mandos); not the editor's outlines and dashes
    const clean = this.readOnly;
    // Paths and roads stack where they cross as the style says (bottom first): each tier drawn
    // after the ones under it
    const tiers: PathTier[] = st.pathOrder?.length === 4 ? st.pathOrder : ["dirt", "gravel", "walkway", "road"];
    const tierOf = (kind: string, surface?: string): PathTier => (kind === "road" ? "road" : surface === "paved" ? "walkway" : surface === "gravel" || surface === "woodchips" ? "gravel" : "dirt");
    const tierOrder = (t: PathTier) => 2.05 + tiers.indexOf(t) * 0.15;

    // Fairways (under everything else): one from each tee of a hole, and where fairways meet (a
    // hole's tees, holes sharing a basket) they make one: drawn once where they overlap, their
    // edges only where they aren't inside another
    const fairways = doc.stats.flatMap(s => {
      const hole = course.holes.find(h => h.id === s.holeId);
      if (!hole || !s.complete || !hole.fairway || painted) return [];
      return [{ hole, polys: teeLines(course, hole, s.line, s.teeId).map((l, k) => this.outline(hole, l, `tee${k}`, 10, 0, 12)) }];
    });
    const allFair = fairways.flatMap(f => f.polys.map(p => ({ p, box: boundsOf(p) })));
    for (const { hole, polys } of fairways) {
      const boxes = polys.map(boundsOf);
      const near = allFair.filter(o => !polys.includes(o.p) && boxes.some(b => o.box.minX < b.maxX && o.box.maxX > b.minX && o.box.minY < b.maxY && o.box.maxY > b.minY));
      put(`fair:${hole.id}`, JSON.stringify([polys, near.map(o => o.p), hv, st.fairway, photo]), () => {
        const g = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: st.fairway, transparent: true, opacity: photo ? 0.22 : 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
        // (each spot drawn once, however many fairways cover it)
        Object.assign(mat, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
        // (up close, mown grass; a copy keeps no shader of its own, so each gets it)
        // (its edge soft, fading into the grass over about 8 ft as a mown fairway does)
        const mown = (m: THREE.MeshLambertMaterial) => { addSurfaceDetail(m, this.ground.detail, layerOf("grass"), 0.9, true, 8); return m; };
        mown(mat);
        polys.forEach((poly, k) => {
          // Its edge, but where it runs inside another fairway
          const others = [...polys.filter((_, j) => j !== k), ...near.map(o => o.p)];
          const runs: P[][] = [];
          let run: P[] = [];
          const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
          for (const p of [...poly, poly[0]]) {
            if (others.some(o => pointInPolygon(p, o))) flush();
            else run.push(p);
          }
          flush();
          const mesh = new THREE.Mesh(drapedPolygon(poly, (x, y) => this.h(x, y), doc.gridSize, 0.12, runs, 8), k ? mown(mat.clone()) : mat);
          mesh.renderOrder = 1;
          mesh.receiveShadow = true;
          g.add(mesh);
          // (a line along it over the photo only, where the fill is faint: on the ground's own
          // colors the soft edge shows it)
          if (photo) for (const r of runs) g.add(this.fatLine(this.drapeLine(r, 0.2), st.fairway, 1.5, { opacity: 0.8, order: 2 }));
        });
        return g;
      });
    }
    // Where woods have no trees: fairways, water, open areas, paths, roads, creeks, tees, baskets
    // and built things (as on the painted map)
    // (`play`: only what's cleared for play, fairways, tees and baskets: the trees measured from the
    // air are real, and a crown over a path or a road doesn't stand on it)
    // (`tallGrass`: tall grass clears too, for the painted woods; a wood or underbrush drawn over
    // it grows there all the same)
    const clearingsFor = (play: boolean, tallGrass = true) => {
      const polys: P[][] = [], lines: { pts: P[]; half: number }[] = [], discs: { p: P; r: number }[] = [];
      for (const s of doc.stats) {
        const hole = course.holes.find(h => h.id === s.holeId);
        if (s.complete && hole) teeLines(course, hole, s.line, s.teeId).forEach((l, k) => polys.push(this.outline(hole, l, `tee${k}`, 8, hole.fairway ? 0 : -hole.fairwayWidth * 0.4, 6)));
      }
      for (const it of course.items) {
        if (it.type === "area" && (play ? ["fairway", "green"] : ["fairway", "green", "water", "parking", "building", "sand", ...(tallGrass ? ["rough"] : []), "nogo", "field"]).includes(it.kind)) polys.push(this.shapeOf(it).pts);
        else if (it.type === "line" && !play && it.kind !== "ob" && it.kind !== "fence") lines.push({ pts: this.shapeOf(it).pts, half: ((it.width ?? LINE_KINDS[it.kind].width) * Math.max(...widthFactors(it))) / 2 + 3 });
        else if (it.type === "tee") discs.push({ p: it, r: Math.max(12, it.padLength) });
        else if (it.type === "basket") discs.push({ p: it, r: CIRCLE_ONE_FT * 0.6 });
        else if (it.type === "structure" && !play) {
          // (a building, shelter or deck: none inside it, nor right against its walls)
          if (STRUCTURE_KINDS[it.kind].shape === "outline") { polys.push(it.points); lines.push({ pts: [...it.points, it.points[0]], half: 4 }); }
          else lines.push({ pts: it.points, half: (it.width ?? 6) / 2 + 6 });
        }
      }
      type Box = { minX: number; minY: number; maxX: number; maxY: number };
      const shapes = polys.filter(pp => pp.length >= 3).map(pts => ({ pts, closed: [...pts, pts[0]], box: boundsOf(pts) }));
      const paths = lines.filter(l => l.pts.length > 1).map(l => ({ ...l, box: boundsOf(l.pts) }));
      const meets = (b: Box, c: Box, m: number) => b.minX - m <= c.maxX && b.maxX + m >= c.minX && b.minY - m <= c.maxY && b.maxY + m >= c.minY;
      const r = (v: number) => Math.round(v);
      /** The clearings near a box (all of them: none given): a test of a spot, and a key that
       * changes only when one of them really moved (rounded to a foot). */
      const near = (box?: Box) => {
        // (a tree's crown reaches out: what's this far outside the box still matters)
        const M = 80;
        const ss = box ? shapes.filter(x => meets(x.box, box, M)) : shapes;
        const ls = box ? paths.filter(x => meets(x.box, box, x.half + M)) : paths;
        const ds = box ? discs.filter(d => d.p.x > box.minX - d.r - M && d.p.x < box.maxX + d.r + M && d.p.y > box.minY - d.r - M && d.p.y < box.maxY + d.r + M) : discs;
        const every = (p: P, reach: number) => {
          for (const x of ss) {
            const b = x.box;
            if (p.x < b.minX - reach || p.x > b.maxX + reach || p.y < b.minY - reach || p.y > b.maxY + reach) continue;
            if (pointInPolygon(p, x.pts) || (reach > 0 && distanceToPath(p, x.closed) < reach)) return true;
          }
          for (const l of ls) {
            const b = l.box, m = l.half + reach;
            if (p.x < b.minX - m || p.x > b.maxX + m || p.y < b.minY - m || p.y > b.maxY + m) continue;
            if (distanceToPath(p, l.pts) < m) return true;
          }
          for (const d of ds) if (Math.hypot(p.x - d.p.x, p.y - d.p.y) < d.r + reach) return true;
          return false;
        };
        // The same answer, from a grid of what's near each 32 ft square (made at the first spot
        // asked about): a spot looks only at the outlines' edges, lines' pieces and discs round
        // its own square, not every outline's whole length (a wood asks thousands of times, and
        // an imported road can have hundreds of points). Reaches past the grid's margin ask
        // `every` instead.
        const CELL = 32, RMAX = 32;
        type Seg = { ax: number; ay: number; bx: number; by: number; m: number };
        let grid: { x0: number; y0: number; nx: number; ny: number; segs: Seg[][]; polys: number[][]; discs: number[][] } | null = null;
        const makeGrid = () => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          const grow = (bx: Box, m: number) => { x0 = Math.min(x0, bx.minX - m); y0 = Math.min(y0, bx.minY - m); x1 = Math.max(x1, bx.maxX + m); y1 = Math.max(y1, bx.maxY + m); };
          ss.forEach(x => grow(x.box, RMAX));
          ls.forEach(l => grow(l.box, l.half + RMAX));
          ds.forEach(d => grow({ minX: d.p.x, minY: d.p.y, maxX: d.p.x, maxY: d.p.y }, d.r + RMAX));
          const nx = Math.max(1, Math.ceil((x1 - x0) / CELL)), ny = Math.max(1, Math.ceil((y1 - y0) / CELL));
          if (!Number.isFinite(x0) || nx * ny > 400_000) return null;
          const g = { x0, y0, nx, ny, segs: [] as Seg[][], polys: [] as number[][], discs: [] as number[][] };
          const each = (minX: number, minY: number, maxX: number, maxY: number, fn: (k: number) => void) => {
            const i0 = Math.max(0, Math.floor((minX - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((maxX - x0) / CELL));
            const j0 = Math.max(0, Math.floor((minY - y0) / CELL)), j1 = Math.min(ny - 1, Math.floor((maxY - y0) / CELL));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * nx + i);
          };
          const seg = (a: P, b: P, m: number) => {
            const s: Seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y, m };
            each(Math.min(a.x, b.x) - m - RMAX, Math.min(a.y, b.y) - m - RMAX, Math.max(a.x, b.x) + m + RMAX, Math.max(a.y, b.y) + m + RMAX, k => (g.segs[k] ??= []).push(s));
          };
          ss.forEach((x, n) => {
            each(x.box.minX - RMAX, x.box.minY - RMAX, x.box.maxX + RMAX, x.box.maxY + RMAX, k => (g.polys[k] ??= []).push(n));
            for (let i = 0; i + 1 < x.closed.length; i++) seg(x.closed[i], x.closed[i + 1], 0);
          });
          ls.forEach(l => { for (let i = 0; i + 1 < l.pts.length; i++) seg(l.pts[i], l.pts[i + 1], l.half); });
          ds.forEach((d, n) => each(d.p.x - d.r - RMAX, d.p.y - d.r - RMAX, d.p.x + d.r + RMAX, d.p.y + d.r + RMAX, k => (g.discs[k] ??= []).push(n)));
          return g;
        };
        let tried = false;
        const test = (p: P, reach: number) => {
          if (reach > RMAX || ss.length + ls.length + ds.length < 6) return every(p, reach);
          if (!tried) { tried = true; grid = makeGrid(); }
          const g = grid;
          if (!g) return every(p, reach);
          const i = Math.floor((p.x - g.x0) / CELL), j = Math.floor((p.y - g.y0) / CELL);
          if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return false;
          const k = j * g.nx + i;
          for (const n of g.polys[k] ?? []) if (pointInPolygon(p, ss[n].pts)) return true;
          for (const s of g.segs[k] ?? []) {
            const m = s.m + reach;
            if (m <= 0) continue;
            // (the distance to the piece, squared, against the reach)
            const dx = s.bx - s.ax, dy = s.by - s.ay, len = dx * dx + dy * dy;
            const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / len)) : 0;
            const ex = s.ax + t * dx - p.x, ey = s.ay + t * dy - p.y;
            if (ex * ex + ey * ey < m * m) return true;
          }
          for (const n of g.discs[k] ?? []) { const d = ds[n]; if (Math.hypot(p.x - d.p.x, p.y - d.p.y) < d.r + reach) return true; }
          return false;
        };
        let key: string | null = null;
        return { test, get key() { return (key ??= JSON.stringify([ss.map(x => x.pts.map(q => [r(q.x), r(q.y)])), ls.map(l => [l.half, l.pts.map(q => [r(q.x), r(q.y)])]), ds.map(d => [r(d.p.x), r(d.p.y), d.r])])); } };
      };
      const all = near();
      return { test: all.test, get key() { return all.key; }, near };
    };
    // (worked out only when something asks: during a drag, nothing may)
    let clearingsMade: ReturnType<typeof clearingsFor> | null = null;
    const clearings = () => (clearingsMade ??= clearingsFor(false));
    // (a drawn wood's trees and bushes, and underbrush: tall grass doesn't clear them)
    let growMade: ReturnType<typeof clearingsFor> | null = null;
    const growClearings = () => (growMade ??= clearingsFor(false, false));
    // Where no tree stands, whatever the survey found: in water, on roads, paths, creeks and walks,
    // on buildings, parking and built things (a trunk there is a bridge, a car, a wire or noise)
    const nowhereFor = () => {
      const polys: P[][] = [], lines: { pts: P[]; half: number }[] = [];
      for (const it of course.items) {
        // (and woods given drawn trees or none: no measured ones there)
        if (it.type === "area" && (["water", "parking", "building"].includes(it.kind) || fieldKeepsTreesOut(it) || (it.kind === "woods" && (it.trees === "drawn" || it.trees === "none")))) polys.push(this.shapeOf(it).pts);
        else if (it.type === "line" && ["road", "path", "walk", "stream", "hedge"].includes(it.kind)) lines.push({ pts: this.shapeOf(it).pts, half: ((it.width ?? LINE_KINDS[it.kind].width) * Math.max(...widthFactors(it))) / 2 });
        else if (it.type === "structure") {
          // (a building's outline: none inside it, nor with its trunk against the walls)
          if (STRUCTURE_KINDS[it.kind].shape === "outline") { polys.push(it.points); lines.push({ pts: [...it.points, it.points[0]], half: 3 }); }
          else lines.push({ pts: it.points, half: (it.width ?? 6) / 2 + 2 });
        }
      }
      const shapes = polys.filter(pp => pp.length >= 3).map(pts => ({ pts, box: boundsOf(pts) }));
      const paths = lines.filter(l => l.pts.length > 1).map(l => ({ ...l, box: boundsOf(l.pts) }));
      const test = (p: P) => {
        for (const x of shapes) if (p.x >= x.box.minX && p.x <= x.box.maxX && p.y >= x.box.minY && p.y <= x.box.maxY && pointInPolygon(p, x.pts)) return true;
        for (const l of paths) {
          const b = l.box, m = l.half;
          if (p.x < b.minX - m || p.x > b.maxX + m || p.y < b.minY - m || p.y > b.maxY + m) continue;
          if (distanceToPath(p, l.pts) < m) return true;
        }
        return false;
      };
      const r = (v: number) => Math.round(v);
      return { test, key: JSON.stringify([shapes.map(x => x.pts.map(q => [r(q.x), r(q.y)])), paths.map(l => [r(l.half), l.pts.map(q => [r(q.x), r(q.y)])])]) };
    };
    // Trees measured from the air: cut down where the course clears the ground for play, unless
    // kept (in place of the woods' made-up trees)
    // (grown to today, as many years as the course asks)
    // Where trees were cut down by hand (saplings, planted ones): nothing grows or is planted there
    const cut = course.cutTrees ?? [];
    const cutAt = (p: P) => cut.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 4);
    const cutKey = cut.length ? JSON.stringify(cut) : "";
    const measuredCount = course.lidar?.trees.length ?? 0;
    // (the same list while the measured trees, the growth and the cut spots are the same: the
    // forest is only rebuilt when one of them changes, not on every change to the course)
    const grownList = course.lidar?.trees.length
      ? this.keep("lidar:list", course.lidar.trees, JSON.stringify([course.lidar.growYears ?? 0, course.lidar.saplings === true, course.lidar.crownSize ?? 1, cutKey]), () => grownTrees(course.lidar!).filter((t, k) => k < measuredCount || !cutAt({ x: t[0], y: t[1] })))
      : null;
    const lidar = grownList ? { ...course.lidar!, trees: grownList } : null;
    const measured = !!lidar;
    this.lidarState = null;
    if (lidar) {
      // (while a drag is under way: the trees standing as they were, worked out again at its end)
      const held = this.dragging && !!this.lidarKey;
      let forPlayMade: ReturnType<typeof clearingsFor> | null = null, nowhereMade: ReturnType<typeof nowhereFor> | null = null;
      const forPlay = () => (forPlayMade ??= clearingsFor(true)), nowhere = () => (nowhereMade ??= nowhereFor());
      const cleared = (p: P, reach: number) => forPlay().test(p, reach);
      const clearing = lidar.clearFairways === true;
      if (!held) this.clearedAt = (p, reach) => (clearing && cleared(p, reach)) || nowhere().test(p);
      // (the woods over the trees that belong to woods)
      const woodsShapes = lidar.bound?.length ? course.items.filter((i): i is AreaItem => i.type === "area" && i.kind === "woods" && i.points.length >= 3).map(i => { const pts = this.shapeOf(i).pts; return { pts, box: boundsOf(pts) }; }) : [];
      const inWoods = (p: P) => woodsShapes.some(w => p.x >= w.box.minX && p.x <= w.box.maxX && p.y >= w.box.minY && p.y <= w.box.maxY && pointInPolygon(p, w.pts));
      const woodsKey = woodsShapes.length ? JSON.stringify(woodsShapes.map(w => w.pts.map(q => [Math.round(q.x), Math.round(q.y)]))) : "";
      if (held) this.afterDrag = true;
      else this.lidarKey = JSON.stringify([lidar.kept, lidar.removed, lidar.bound, lidar.minHeight ?? 0, lidar.growYears ?? 0, lidar.saplings === true, lidar.crownSize ?? 1, lidar.clearFairways === true, forPlay().key, nowhere().key, cutKey, woodsKey]);
      const state = this.keep("lidar", lidar.trees, this.lidarKey!, () => {
        const { stand, cut } = standingTrees(lidar, cleared, p => nowhere().test(p), inWoods);
        const keptSet = new Set(lidar.kept ?? []);
        return { stand, cut, kept: clearing ? stand.filter(k => keptSet.has(k) && forPlay().test({ x: lidar.trees[k][0], y: lidar.trees[k][1] }, lidar.trees[k][3] * 0.3)) : [] };
      });
      this.lidarState = state;
      // (the painted map paints the same standing trees)
      // (told by which trees stand, so two views over the same course agree and never take turns)
      let sig = state.stand.length;
      for (const k of state.stand) sig = (sig * 31 + k) % 2147483647;
      const standKey = `${state.stand.length}:${sig}:${lidar.growYears ?? 0}:${lidar.saplings === true}:${lidar.crownSize ?? 1}`;
      if (measuredStanding()?.key !== standKey) setMeasuredStanding({ key: standKey, trees: state.stand.map(k => lidar.trees[k]) });
      put("woods:lidar", JSON.stringify([idOfGrid(lidar.trees), lidar.growYears ?? 0, lidar.saplings === true, lidar.crownSize ?? 1, state.cut, hv, st.trees, st.landscape, st.treeMix, st.conifers, shares]), () => {
        const woods = createMeasuredWoods(state.stand.map(k => ({ tree: lidar.trees[k], index: k })), (x, y) => this.h(x, y), st.trees, treeMixOf(st), shares);
        this.shadowsDirty = true;
        return woods;
      }, this.itemsGroup, true);
    }
    // Areas: fill plus outline (and a red OB edge, all round or along its stretches)
    const obEdge = (a: AreaItem, g: THREE.Group) => {
      for (const piece of areaObEdges({ ...a, straight: true })) g.add(this.fatLine(this.drapeLine(piece, LIFT + 0.05), color("ob")!, 3, { order: 5 }));
    };
    // (an area made a hazard: the hazard's dashed edge round it)
    const hazardEdge = (a: AreaItem, g: THREE.Group) => {
      if (a.hazard === true && a.kind !== "hazard") g.add(this.fatLine(this.drapeLine(a.points, LIFT + 0.05, true), color("hazard")!, 3, { order: 5, dashed: 6 }));
    };
    // (biggest first: each one's size worked out once, not at every comparison)
    const areas = (course.items.filter(i => i.type === "area") as AreaItem[]).map(a => { const points = this.shapeOf(a).pts; return { a: { ...a, points }, size: polygonArea(points) }; }).sort((x, y) => y.size - x.size).map(x => x.a);
    // (fields in their real colors, their grass leaning toward the map's)
    const inks = fieldInks("natural", st.fairway);
    const nogoColor = pdga ? RESTRICTED : AREA_KINDS.nogo.color;
    // (woods of bushes only, biggest first: where they overlap, the smaller one's brush grows, as
    // the measured brush's medium and heavy patches lie inside its light)
    const brushWoods = areas.filter(a => a.kind === "woods" && (a.bushes ?? 0) >= 1);
    const brushInside = (a: AreaItem) => {
      const k = brushWoods.indexOf(a), box = boundsOf(a.points);
      if (k < 0) return [];
      return brushWoods.slice(k + 1).filter(o => { const b = boundsOf(o.points); return b.minX < box.maxX && b.maxX > box.minX && b.minY < box.maxY && b.maxY > box.minY; }).map(o => o.points);
    };
    areas.forEach((a, order) => {
      if (a.kind === "field") {
        // A field, court or play area: its ground painted as it is (on the painted map and when
        // only looked at, too), the dashed edge of an out-of-play area or a red OB edge; and what
        // stands on it (goals, nets, hoops, fences, play structures)
        const out = isOutOfPlay(a);
        const shape = [a.points, a.field, a.fieldTurn, a.home, a.plate, a.league, a.parts, a.courtColors];
        put(`area:${a.id}`, JSON.stringify([...shape, hv, order, inks.grass, out, nogoColor, a.ob, a.obStretches, a.hazard]), () => {
          const g = new THREE.Group();
          const plan = fieldPlan(a);
          if (plan) {
            const mesh = createFieldGround(plan, inks, (x, y) => this.h(x, y), doc.gridSize, 0.15 + order * 0.01);
            mesh.renderOrder = 2 + order * 0.001;
            g.add(mesh);
          }
          if (out) g.add(this.fatLine(this.drapeLine(a.points, LIFT, true), nogoColor, 3, { order: 4, dashed: 6 }));
          if (a.ob === true) obEdge(a, g);
          hazardEdge(a, g);
          return g;
        });
        put(`field:${a.id}`, JSON.stringify([...shape, hv]), () => {
          const plan = fieldPlan(a);
          if (!plan?.props.length) return new THREE.Group();
          const props = createFieldProps(plan, (x, y) => this.h(x, y));
          props.traverse(o => { o.userData.itemId = a.id; });
          this.shadowsDirty = true;
          return props;
        }, this.itemsGroup);
        return;
      }
      const meta = AREA_KINDS[a.kind];
      const c = color(a.kind) ?? meta.color;
      // (woods: no fill, the ground under the trees as it is; the trees show it, its edge line only)
      const bare = a.kind === "woods";
      const tinted = this.brushTint && a.kind === "woods" && (a.bushes ?? 0) >= 1 ? levelOf(a) : 0;
      put(`area:${a.id}`, JSON.stringify([a.points, a.kind, hv, c, photo, order, a.ob, a.obStretches, a.hazard, a.kind === "water" ? this.waterShore(a.points) : 0, painted, clean, bare, tinted]), () => {
        const g = new THREE.Group();
        // (underbrush being painted: tinted light, medium or heavy, the heavier over the lighter)
        if (tinted) {
          const tc = ["", "#fde68a", "#f59e0b", "#b45309"][tinted];
          const geo = drapedPolygon(a.points, (x, y) => this.h(x, y), doc.gridSize, 0.2 + tinted * 0.02);
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: tc, transparent: true, opacity: 0.13, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
          mesh.renderOrder = 3 + tinted * 0.01;
          g.add(mesh);
          g.add(this.fatLine(this.drapeLine(a.points, LIFT + 0.1, true), tc, 2, { order: 5 }));
        }
        const fill = photo ? meta.fill : Math.min(0.9, meta.fill + 0.35);
        const rule = a.kind === "ob" || a.kind === "hazard" || a.kind === "casual" || a.kind === "nogo";
        // (on the painted ground, or looked at only: no translucent fills, only the rules' edges)
        if ((painted || clean) && a.kind !== "water") {
          if (rule) g.add(this.fatLine(this.drapeLine(a.points, LIFT, true), c, 3, { order: 4, dashed: a.kind === "ob" ? undefined : 6 }));
          if (a.ob === true && a.kind !== "ob") obEdge(a, g);
          hazardEdge(a, g);
          return g;
        }
        if (a.kind === "water") {
          // Water lies at the level of its banks nearby (a pond level, a river sloping down its
          // length), and never under the ground: over the highest corner of the ground's cell it's
          // in (ground measured from the air is bumpy, and its triangles rise between samples)
          const cell = doc.gridSize || 20;
          const banks: { x: number; y: number; h: number }[] = [];
          for (let i = 0; i < a.points.length; i++) {
            const p = a.points[i], q = a.points[(i + 1) % a.points.length];
            const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
            for (let k = 0; k < n; k++) { const x = p.x + ((q.x - p.x) * k) / n, y = p.y + ((q.y - p.y) * k) / n; banks.push({ x, y, h: this.h(x, y) }); }
          }
          const lowest = Math.min(...banks.map(b => b.h));
          const REACH = 90;
          const bankLevel = (x: number, y: number) => {
            let m = Infinity;
            for (const b of banks) if (Math.abs(b.x - x) < REACH && Math.abs(b.y - y) < REACH && b.h < m) m = b.h;
            return Number.isFinite(m) ? m : lowest;
          };
          const cellTop = (x: number, y: number) => {
            const i = Math.floor(x / cell) * cell, j = Math.floor(y / cell) * cell;
            return Math.max(this.h(i, j), this.h(i + cell, j), this.h(i, j + cell), this.h(i + cell, j + cell));
          };
          const surface = (x: number, y: number) => Math.max(bankLevel(x, y) + 0.2, cellTop(x, y) + 0.3);
          // (its depth: shelving from the bank, a foot every 2 ft out, to 9 ft; the survey
          // can't see under water, so the ground there is only the water's own level)
          const geo = drapedPolygon(a.points, surface, cell / 2, 0), pa = geo.attributes.position, depth = new Float32Array(pa.count);
          for (let i = 0; i < pa.count; i++) depth[i] = Math.min(9, distanceToPolygon({ x: pa.getX(i), y: pa.getZ(i) }, a.points) * 0.5);
          geo.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
          const shore = this.waterShore(a.points), bottom = `#${new THREE.Color(c).multiplyScalar(0.8).lerp(new THREE.Color(doc.groundColor), 0.2).getHexString()}`;
          const pond = new THREE.Mesh(geo, waterMaterial(c, ...shore, { bottom }));
          pond.userData.water = true;
          const mid = centroid(a.points);
          this.ponds.set(pond, { color: c, shore, bottom, at: new THREE.Vector3(mid.x, surface(mid.x, mid.y) + 2.5, mid.y), size: Math.abs(polygonArea(a.points)), done: false });
          this.pondsDirty = true;
          pond.renderOrder = 2;
          pond.receiveShadow = true;
          g.add(pond);
          if (a.ob === true) obEdge(a, g);
          return g;
        }
        // (A woods' floor goes under the fairways and paths through it, and under its ponds)
        const floor = a.kind === "woods";
        if (!bare) {
          // (grass, sand and dirt fade into the ground around them; paving keeps a crisp edge)
          const soft = photo ? 0 : a.kind === "fairway" ? 8 : a.kind === "rough" ? 10 : a.kind === "green" ? 4 : a.kind === "sand" ? 3 : 0;
          const geo = drapedPolygon(a.points, (x, y) => this.h(x, y), doc.gridSize, floor ? 0.08 : 0.15 + order * 0.01, soft ? [[...a.points, a.points[0]]] : undefined, soft);
          const mat = new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: floor ? Math.min(fill, 0.45) : fill, depthWrite: false, polygonOffset: true, polygonOffsetFactor: floor ? -1 : -4, polygonOffsetUnits: floor ? -2 : -8 });
          // (up close, what it's made of: a fairway's mown grass, a parking lot's asphalt, a woods' floor)
          const scan: [SurfaceLayer, number] | null = a.kind === "fairway" || a.kind === "green" ? ["grass", 0.9] : a.kind === "rough" ? ["grass", 1] : a.kind === "sand" ? ["sand", 1]
            : a.kind === "parking" ? ["asphalt", 1] : null;
          if (scan) addSurfaceDetail(mat, this.ground.detail, layerOf(scan[0]), scan[1], a.kind === "fairway" || a.kind === "green", soft);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.renderOrder = floor ? 0.5 : a.kind === "parking" ? tierOrder("road") : 2 + order * 0.001;
          mesh.receiveShadow = true;
          g.add(mesh);
        }
        const w = a.kind === "ob" || a.kind === "hazard" || a.kind === "casual" || a.kind === "nogo" ? 3 : 1.5;
        // (grass and sand with a soft edge: no hard line round them, unless over the photo)
        const softKind = !photo && (a.kind === "fairway" || a.kind === "rough" || a.kind === "green" || a.kind === "sand");
        if (w === 3 || (!clean && !softKind)) g.add(this.fatLine(this.drapeLine(a.points, LIFT, true), c, w, { order: 4, dashed: a.kind === "hazard" || a.kind === "casual" || a.kind === "nogo" ? 6 : undefined }));
        // Marked OB (water, say): its red OB edge; a hazard, its dashed hazard edge
        if (a.ob === true && a.kind !== "ob") obEdge(a, g);
        hazardEdge(a, g);
        return g;
      });
      // Woods: trees standing in it (shadows and all)
      // (what it grows, all through it: in the gaps between the measured trees, unless it clears
      // them; none when it says so; a wood of bushes only grows as brush, below)
      const fillsIn = measured && a.trees !== "drawn";
      const brushOnly = a.kind === "woods" && (a.bushes ?? 0) >= 1;
      if (a.kind === "woods" && a.trees !== "none" && !brushOnly && !held(`woods:${a.id}`)) {
        const here = growClearings().near(boundsOf(a.points));
        // (a stand of one species grows only it)
        const own = standShares(a, shares);
        put(`woods:${a.id}`, JSON.stringify([a.points, hv, st.trees, st.landscape, st.treeMix, st.conifers, here.key, cutKey, a.pines, a.bushes, a.density, a.heights, fillsIn && this.lidarKey, own]), () => {
          this.plantings++;
          const box = boundsOf(a.points), standing = this.lidarState?.stand ?? [], trees = lidar?.trees ?? [];
          const near = fillsIn ? standing.map(k => trees[k]).filter(t => t && t[0] >= box.minX - 40 && t[0] <= box.maxX + 40 && t[1] >= box.minY - 40 && t[1] <= box.maxY + 40) : [];
          const keepOut = (p: P, r: number) => here.test(p, r) || cutAt(p) || near.some(t => Math.hypot(t[0] - p.x, t[1] - p.y) < t[3] * 0.8 + 4);
          const woods = createWoods(a.points, (x, y) => this.h(x, y), st.trees, conifersOf(st), treeMixOf(st), keepOut, 22 / Math.sqrt(Math.max(0.2, a.density ?? 1)), { pines: a.pines, bushes: a.bushes, heights: a.heights }, own);
          woods.traverse(o => { o.userData.itemId = a.id; });
          this.shadowsDirty = true;
          return woods;
        }, this.itemsGroup, true);
      }
      // Underbrush beneath a wood (measured or drawn), or up through tall grass when it asks for
      // some: its own bushes and young trees, kept off the fairways, paths and water, and off the
      // spots cut by hand
      const brushLevel = brushOnly ? (["light", "medium", "heavy"] as const)[["sparse", "usual", "thick"].indexOf((a.density ?? 1) < 0.75 ? "sparse" : (a.density ?? 1) > 1.4 ? "thick" : "usual")] : a.underbrush;
      if (((a.kind === "woods" && a.trees !== "none") || a.kind === "rough") && (brushLevel || a.brush?.some(b => b.level !== "none"))) {
        let hereMade: ReturnType<ReturnType<typeof clearingsFor>["near"]> | null = null;
        const here = () => (hereMade ??= growClearings().near(boundsOf(a.points)));
        const sections = (a.brush ?? []).filter(b => b.points.length >= 3);
        const inSection = (p: P) => sections.some(b => pointInPolygon(p, b.points));
        // (tall grass is all in the sun: as thick through the middle as at its edge, and closer set)
        const grass = a.kind === "rough";
        const edge = brushOnly || grass ? 0 : Math.min(1, Math.max(0, a.brushEdge ?? 0.6));
        // (`over`: the sections drawn after this one, which have their say where they overlap it)
        const plant = (key: string, outline: P[], level: "light" | "medium" | "heavy", kind: BrushKind, outside: boolean, over: P[][] = []) =>
          held(key) || put(key, JSON.stringify([outline, level, kind, hv, st.trees, st.landscape, st.treeMix, st.conifers, here().key, cutKey, outside ? sections.map(b => b.points) : 0, over, edge, a.points]), () => {
            this.plantings++;
            // (the wood's own level stays out of its sections; a section keeps to the wood)
            const keepOut = (p: P, r: number) => here().test(p, r) || cutAt(p) || over.some(o => pointInPolygon(p, o)) || (outside ? inSection(p) : !pointInPolygon(p, a.points));
            const brush = createUnderbrush(outline, (x, y) => this.h(x, y), st.trees, treeMixOf(st), keepOut, level, edge, a.points, kind, grass ? TALL_GRASS_BRUSH : 1);
            brush.traverse(o => { o.userData.itemId = a.id; });
            this.shadowsDirty = true;
            return brush;
          }, this.itemsGroup, true);
        const kind = a.brushKind ?? "mixed";
        if (brushLevel) plant(`woods:${a.id}:under`, a.points, brushLevel, kind, true, brushOnly ? brushInside(a) : []);
        sections.forEach((b, i) => { if (b.level !== "none") plant(`woods:${a.id}:under:${i}`, b.points, b.level, b.kind ?? kind, false, sections.slice(i + 1).map(s => s.points)); });
      }
    });
    // A hand-made flyover of the selected hole: its path over the ground, and where each keyframe looks
    // (for its editors: a course's public page never shows it)
    const flyHole = this.hole(this.selectedId);
    if (flyHole?.flyKeys && flyHole.flyKeys.length >= 2 && !this.povHole && !this.readOnly) {
      const keys = flyHole.flyKeys;
      put(`flykeys:${flyHole.id}`, JSON.stringify([keys, hv, course.flyover, flyHole.flyover]), () => {
        const g = new THREE.Group();
        const f = keyFlight(keys, flyoverOf(course, flyHole), (x, y) => this.h(x, y));
        // (the flight where it flies, at its own heights; its shadow on the ground; and each
        // keyframe's camera on a stem from the ground, looking where it looks)
        if (f) {
          g.add(this.fatLine(f.cam.map(c => new THREE.Vector3(c.x, c.z, c.y)), "#38bdf8", 3, { order: 9 }));
          g.add(this.fatLine(this.drapeLine(f.cam.map(c => ({ x: c.x, y: c.y })), 0.6), "#38bdf8", 1.5, { order: 8, dashed: 8, opacity: 0.55 }));
        }
        for (const k of keys) {
          const ground = this.h(k.x, k.y), air = new THREE.Vector3(k.x, ground + k.alt, k.y);
          g.add(this.fatLine([new THREE.Vector3(k.x, ground + 0.3, k.y), air], "#e0f2fe", 1.5, { opacity: 0.85, order: 9, dashed: 4 }));
          g.add(this.fatLine([air, new THREE.Vector3(k.lookX, this.h(k.lookX, k.lookY) + 3, k.lookY)], "#38bdf8", 1.2, { opacity: 0.6, order: 8 }));
        }
        return g;
      });
    }
    // The painted map's own woods: trees standing on it
    const pw = painted && !measured ? this.paintedWoods : null;
    if (pw) {
      put("painted-woods", JSON.stringify([idOfGrid(pw), hv, st.trees, st.landscape, st.treeMix, st.conifers, clearings().key, cutKey, shares]), () => {
        const inside = (p: P) => {
          const c = Math.floor((p.x - pw.x0) / pw.ftPerCell), r = Math.floor((p.y - pw.y0) / pw.ftPerCell);
          return c >= 0 && r >= 0 && c < pw.cols && r < pw.rows && pw.data[r * pw.cols + c] === 1;
        };
        // (as thick as the painting's tree cover)
        const woods = createWoodsWhere({ minX: 0, minY: 0, maxX: doc.canvas.width, maxY: doc.canvas.height }, inside, (x, y) => this.h(x, y), st.trees, conifersOf(st), treeMixOf(st), (p, r) => clearings().test(p, r) || cutAt(p), 22 / Math.sqrt(Math.max(0.15, pw.cover)), {}, shares);
        this.shadowsDirty = true;
        return woods;
      }, this.itemsGroup, true);
    }
    // Lines
    for (const l of course.items.filter(i => i.type === "line") as LineItem[]) {
      if (painted && (l.kind === "path" || l.kind === "road" || l.kind === "walk") && l.ob !== true) continue;
      const meta = LINE_KINDS[l.kind];
      // (paths and walks in their surface's color; dirt in the map's path color)
      const surfaced = (l.kind === "path" || l.kind === "walk") && l.surface && l.surface !== "dirt" ? PATH_SURFACES[l.surface].color : null;
      const c = l.kind === "ob" ? color("ob")! : surfaced ?? (l.kind === "path" || (l.kind === "walk" && l.width) ? st.path : l.kind === "stream" ? st.water : l.kind === "power" ? "#3b3733" : l.kind === "hedge" ? "#2f4f28" : l.kind === "road" ? st.look3d?.paving ?? meta.color : meta.color);
      const width = l.width ?? meta.width;
      // Marked OB: along all of it or its stretches; OB "and beyond" from its edge on the holes' side
      const obParts = l.ob === true && l.kind !== "ob" && l.points.length >= 2 ? obRanges(l).map(([a, b]) => {
        const piece = subPath(this.shapeOf(l).pts, a, b);
        return { a, b, piece, sides: l.obBeyond ? beyondSides(l, piece, doc.stats.filter(st => st.complete && obFor(course, l, st.holeId)).map(st => st.line), !obPicked(course, l).length) : null };
      }).filter(o => o.piece.length >= 2) : [];
      put(`line:${l.id}`, JSON.stringify([l.points, l.straight, l.kind, width, l.widths, hv, c, l.ob, l.obToward, l.kind === "stream" ? this.waterShore(l.points) : 0, obParts.map(o => [o.a, o.b, o.sides]), st.pathOrder, l.fenceStyle, l.fenceHeight, l.hazard]), () => {
        const g = new THREE.Group();
        const pts = this.shapeOf(l).pts;
        // (wider or narrower along the way: a creek that opens out)
        const along = widthAlong(l, width);
        // A hazard: the hazard's dashed edge along it (either side of a creek, road or path)
        if (l.hazard === true && l.kind !== "ob" && pts.length >= 2) {
          for (const side of width > 0 ? [1, -1] : [0]) {
            const edge = side ? offsetPath(pts, u => side * (along(u) / 2 + 2)) : pts;
            g.add(this.fatLine(this.drapeLine(edge, LIFT + 0.05), color("hazard")!, 3, { order: 5, dashed: 6 }));
          }
        }
        // Marked OB (a creek, a road): a red edge either side (or on the holes' side only)
        const obMat = () => new THREE.MeshLambertMaterial({ color: color("ob")!, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
        for (const { a, b, piece, sides } of obParts) {
          const at = (u: number) => along(a + (b - a) * u);
          if (width > 0 && !sides) {
            const edge = new THREE.Mesh(drapedRibbon(piece, u => at(u) + 5, (x, y) => this.h(x, y), Math.max(3, doc.gridSize / 2), 0.16), obMat());
            edge.renderOrder = 1.9;
            g.add(edge);
          } else if (width > 0 && sides) {
            for (const side of sides) {
              const edge = new THREE.Mesh(drapedRibbon(offsetPath(piece, u => side * (at(u) / 2 + 2)), () => 4, (x, y) => this.h(x, y), Math.max(3, doc.gridSize / 2), 0.16), obMat());
              edge.renderOrder = 1.9;
              g.add(edge);
            }
          } else g.add(this.fatLine(this.drapeLine(piece), color("ob")!, 5, { order: 4.9 }));
        }
        if (width > 0 && l.points.length >= 2) {
          const ribbon = new THREE.Mesh(
            drapedRibbon(pts, along, (x, y) => this.h(x, y), Math.max(3, doc.gridSize / 2), 0.18),
            l.kind === "stream" ? waterMaterial(c, ...this.waterShore(l.points)) : this.surfaceMaterial(c, l.kind === "road" ? "asphalt" : l.kind === "path" || l.kind === "walk" ? ({ gravel: "gravel", woodchips: "chips", paved: "concrete", grass: "grass" } as Record<string, SurfaceLayer>)[l.surface ?? ""] ?? "dirt" : null)
          );
          // (walks to the next hole over every other path)
          // (a walk to the next hole over the paths of its own kind it crosses)
          ribbon.renderOrder = l.kind === "stream" ? 2 : tierOrder(tierOf(l.kind, l.surface)) + (l.kind === "walk" ? 0.07 : 0);
          if (l.kind === "stream") ribbon.userData.water = true;
          ribbon.receiveShadow = true;
          g.add(ribbon);
        } else {
          g.add(this.fatLine(this.drapeLine(pts, l.kind === "walk" ? LIFT + 0.15 : LIFT), c, l.kind === "ob" ? 3.5 : l.kind === "power" ? 1.4 : 2.5, { order: l.kind === "walk" ? 6 : 5, dashed: l.kind === "walk" ? 5 : l.kind === "fence" ? 2 : undefined, opacity: l.kind === "power" ? 0.8 : undefined }));
        }
        // (a power line's poles and wires overhead; a hedge's row of bushes)
        if (l.kind === "power") { g.add(createPowerLine(pts, (x, y) => this.h(x, y), l.fenceHeight ?? meta.height ?? 30)); this.shadowsDirty = true; }
        if (l.kind === "hedge") { g.add(createHedge(pts, (x, y) => this.h(x, y), width || 4, l.fenceHeight ?? meta.height ?? 5, l.id.split("").reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483646, 7) + 1)); this.shadowsDirty = true; }
        // (a fence stands up along its line: posts and rails, boards, or chain link)
        if (l.kind === "fence") { const fence = createFence(pts, (x, y) => this.h(x, y), l.fenceHeight ?? 4, l.fenceStyle ?? "rail"); this.shadowsDirty = true; g.add(fence); }
        // (a walk with a width: its dashes along the middle too)
        if (l.kind === "walk" && width > 0) g.add(this.fatLine(this.drapeLine(pts, LIFT + 0.15), "#e2e8f0", 1.6, { dashed: 2.5, opacity: 0.85, order: 6 }));
        return g;
      });
    }
    // Built things: bridges, boardwalks, stairs, walls, buildings, shelters and decks, as models
    // at real size on the ground (each one rebuilt only when it or the ground changes)
    for (const st of course.items.filter(i => i.type === "structure") as StructureItem[]) {
      // (rebuilt on any change to it: its shape, size, roof, look or colors)
      put(`struct:${st.id}`, JSON.stringify([{ ...st, label: undefined, locked: undefined }, hv]), () => {
        const model = createStructure(st, (x, y) => this.h(x, y));
        model.traverse(o => { o.userData.itemId = st.id; });
        this.shadowsDirty = true;
        return model;
      }, this.itemsGroup);
    }
    // Throw lines, flight arcs and putting circles
    const tees = new Map(doc.stats.map(s => [s.holeId, s]));
    const off = this.otherLayouts();
    for (const hole of course.holes) {
      const s = tees.get(hole.id);
      const sel = this.selectedId === hole.id || doc.activeHoleId === hole.id;
      // Every tee's line (other tees fainter)
      for (const tee of holeTees(course, hole.id)) {
        const basket = basketFor(course, hole.id, doc.course.layouts.find(l => l.id === course.activeLayout)?.pin);
        if (!basket) continue;
        const main = s?.teeId === tee.id;
        // (another layout's tee: its line only while its hole is picked)
        const faded = !main && off.tees.has(tee.level);
        const line = smoothPath(throwLine(hole, tee, basket), 12);
        put(`throw:${tee.id}`, JSON.stringify([line, hv, main, sel, faded, clean && this.selectedId === hole.id]), () => {
          const g = new THREE.Group();
          if (clean ? this.selectedId !== hole.id : (!st.throwLines || faded) && !sel) return g;
          g.add(this.fatLine(this.drapeLine(line, LIFT + 0.1), sel ? SELECT : main ? "#ffffff" : TEE_LEVELS[tee.level].color, sel ? 3.5 : main ? 2.5 : 1.5, { dashed: main ? undefined : 7, opacity: main ? 0.95 : 0.75, order: 6 }));
          return g;
        });
      }
      for (const b of holeBaskets(course, hole.id)) {
        put(`circle:${b.id}`, JSON.stringify([b.x, b.y, hv, st.circle, clean]), () => {
          const g = new THREE.Group();
          if (!st.circle || clean) return g;
          const ring: P[] = [];
          for (let i = 0; i < 64; i++) ring.push({ x: b.x + Math.cos((i / 64) * Math.PI * 2) * CIRCLE_ONE_FT, y: b.y + Math.sin((i / 64) * Math.PI * 2) * CIRCLE_ONE_FT });
          g.add(this.fatLine(this.drapeLine(ring, 0.3, true), "#ffffff", 1.2, { opacity: 0.55, dashed: 3, order: 3 }));
          return g;
        });
      }
    }
    // Walks to the next tee
    if (st.nextTee) {
      // (from outside the putting circle to behind the next tee: see walkEnds)
      for (const { from, to, a } of autoWalks(doc.course.items, doc.stats, course.holes)) {
        const hole = course.holes.find(h => h.id === a.holeId);
        const wide = hole?.walkWidth ?? st.walkWidth, surface = hole?.walkSurface;
        put(`walk:${a.holeId}`, JSON.stringify([from, to, hv, wide, surface, painted, st.path, clean]), () => {
          const g = new THREE.Group();
          if (dist(from, to) < 10) return g;
          // (a path on the ground, as wide as walks are set, in its surface's color; on the painted
          // ground the painting has it)
          if (!painted) {
            const mesh = new THREE.Mesh(
              drapedRibbon([from, to], wide ?? 6, (x, y) => this.h(x, y), Math.max(3, doc.gridSize / 2), 0.17),
              (() => {
                const m = new THREE.MeshLambertMaterial({ color: surface && surface !== "dirt" ? PATH_SURFACES[surface].color : st.path, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
                addSurfaceDetail(m, this.ground.detail, layerOf(({ gravel: "gravel", woodchips: "chips", paved: "concrete", grass: "grass" } as Record<string, SurfaceLayer>)[surface ?? ""] ?? "dirt"));
                return m;
              })()
            );
            // (walks to the next hole over the paths of their own kind they cross, under the kinds above)
            mesh.renderOrder = tierOrder(tierOf("walk", surface)) + 0.07;
            g.add(mesh);
          }
          return g;
        });
      }
    }
    // Mandos, on the ground: the restricted line out to the side the disc must not pass (red),
    // and an arrow curving past the post on the side it must pass, in the direction of play
    const mandos = course.items.filter(i => i.type === "mando") as MandoItem[];
    for (const m of mandos) {
      const pair = m.pairId ? mandos.find(o => o.id === m.pairId) : undefined;
      if (pair) {
        // A gate: each post's restricted line points away from the other; one arrow through the gap
        put(`mando:${m.id}`, JSON.stringify([m.x, m.y, pair.x, pair.y, m.rotation, hv]), () => {
          const g = new THREE.Group();
          const dx = m.x - pair.x, dy = m.y - pair.y, l = Math.hypot(dx, dy) || 1;
          const out = [{ x: m.x + (dx / l) * 2.5, y: m.y + (dy / l) * 2.5 }, { x: m.x + (dx / l) * 30, y: m.y + (dy / l) * 30 }];
          g.add(this.fatLine(this.drapeLine(out, 0.4), "#ffffff", 5, { order: 5, opacity: 0.85 }));
          g.add(this.fatLine(this.drapeLine(out, 0.45), "#e11d2e", 3, { order: 6 }));
          if (m.id < pair.id) {
            const a = m.rotation * DEG, f = { x: Math.cos(a), y: Math.sin(a) };
            const mid = { x: (m.x + pair.x) / 2, y: (m.y + pair.y) / 2 };
            const tail = { x: mid.x - f.x * 16, y: mid.y - f.y * 16 }, tip = { x: mid.x + f.x * 16, y: mid.y + f.y * 16 };
            const w1 = { x: tip.x - Math.cos(a - 0.5) * 6, y: tip.y - Math.sin(a - 0.5) * 6 }, w2 = { x: tip.x - Math.cos(a + 0.5) * 6, y: tip.y - Math.sin(a + 0.5) * 6 };
            g.add(this.fatLine(this.drapeLine([tail, tip], 0.4), "#ffffff", 5, { order: 5, opacity: 0.85 }));
            g.add(this.fatLine(this.drapeLine([tail, tip], 0.45), "#f97316", 3, { order: 6 }));
            g.add(this.fatLine(this.drapeLine([w1, tip, w2], 0.45), "#f97316", 3, { order: 6 }));
          }
          return g;
        });
        continue;
      }
      put(`mando:${m.id}`, JSON.stringify([m.x, m.y, m.rotation, m.side, hv]), () => {
        const a = m.rotation * DEG;
        // Looking along the play direction (+angle), "right" on screen is +90° (plan y points down)
        const f = { x: Math.cos(a), y: Math.sin(a) };
        const right = { x: -f.y, y: f.x };
        const s = m.side === "left" ? -1 : 1;
        const at = (along: number, across: number) => ({ x: m.x + f.x * along + right.x * s * across, y: m.y + f.y * along + right.y * s * across });
        const g = new THREE.Group();
        g.add(this.fatLine(this.drapeLine([at(0, -2.5), at(0, -38)], 0.4), "#ffffff", 5, { order: 5, opacity: 0.85 }));
        g.add(this.fatLine(this.drapeLine([at(0, -2.5), at(0, -38)], 0.45), "#e11d2e", 3, { order: 6 }));
        // The pass arrow: a curve round the post, then its head
        const curve: P[] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const p0 = at(-22, 6), c = at(0, 20), p1 = at(18, 8);
          curve.push({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y });
        }
        const end = curve[curve.length - 1], before = curve[curve.length - 3];
        const ha = Math.atan2(end.y - before.y, end.x - before.x);
        const tip = { x: end.x + Math.cos(ha) * 5, y: end.y + Math.sin(ha) * 5 };
        const w1 = { x: end.x - Math.cos(ha - 1.1) * 6, y: end.y - Math.sin(ha - 1.1) * 6 };
        const w2 = { x: end.x - Math.cos(ha + 1.1) * 6, y: end.y - Math.sin(ha + 1.1) * 6 };
        g.add(this.fatLine(this.drapeLine(curve, 0.4), "#ffffff", 5, { order: 5, opacity: 0.85 }));
        g.add(this.fatLine(this.drapeLine(curve, 0.45), "#f97316", 3, { order: 6 }));
        g.add(this.fatLine(this.drapeLine([w1, tip, w2], 0.45), "#f97316", 3, { order: 6 }));
        return g;
      });
    }
    for (const [key, entry] of this.shapes) {
      if (seen.has(key)) continue;
      entry.obj.parent?.remove(entry.obj);
      disposeObjectDeep(entry.obj);
      this.shapes.delete(key);
    }
    // (a slow piece no longer wanted: not made)
    for (const key of this.slowQueue.keys()) if (!seen.has(key)) this.slowQueue.delete(key);
  }

  /** Makes the slow pieces waiting, until `budget` ms have gone (Infinity: all of them). */
  private drainSlow(budget = 8) {
    const t0 = performance.now();
    for (const [key, job] of this.slowQueue) {
      this.slowQueue.delete(key);
      const entry = this.shapes.get(key);
      if (entry && entry.sig === job.sig) continue;
      if (entry) {
        entry.obj.parent?.remove(entry.obj);
        disposeObjectDeep(entry.obj);
        this.shapes.delete(key);
      }
      const obj = timed(`3D ${key.split(":")[0]} made`, job.make);
      this.needWarm = true;
      this.pondsAgain();
      if (obj) {
        obj.traverse(o => { o.raycast = () => {}; });
        if (!obj.name) obj.name = key;
        job.group.add(obj);
        this.shapes.set(key, { obj, sig: job.sig });
      }
      this.dirty = true;
      if (performance.now() - t0 > budget) break;
    }
  }
  /** Everything new drawn once, out of sight, with every level of detail showing: its shaders
   * compiled and its shapes sent to the graphics card while the view is still, not the first time
   * a tree comes close or goes far while moving round (a hitch then, a second or more on a phone). */
  private warmUp() {
    // (their shaders first, compiled by the graphics driver in the background where it can: the page
    // isn't held up waiting for each; then the drawing, which only sends their shapes)
    if (this.warming) return;
    this.warming = true;
    const done = () => { this.warming = false; if (!this.disposed) this.warmDraw(); };
    // (three's own compileAsync trips over a material let go while it waits, as when the course is
    // made again meanwhile: the same wait here, the ones let go passed over)
    let waiting: Set<THREE.Material>;
    try { waiting = this.renderer.compile(this.scene, this.camera) as Set<THREE.Material>; } catch { done(); return; }
    const parallel = this.renderer.extensions.has("KHR_parallel_shader_compile");
    const check = () => {
      if (this.disposed) { this.warming = false; return; }
      for (const m of waiting) {
        const p = (this.renderer.properties.get(m) as { currentProgram?: { isReady: () => boolean } }).currentProgram;
        if (!p || p.isReady()) waiting.delete(m);
      }
      if (waiting.size) window.setTimeout(check, 10);
      else done();
    };
    if (parallel) check();
    else window.setTimeout(check, 10);
  }
  private warming = false;
  private warmDraw() {
    const meshes: THREE.Mesh[] = [];
    this.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && !this.warmed.has(o)) meshes.push(o as THREE.Mesh); });
    if (!meshes.length) return;
    const was = meshes.map(m => ({ m, visible: m.visible, count: (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : -1 }));
    for (const { m } of was) { m.visible = true; if ((m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count === 0) (m as THREE.InstancedMesh).count = 1; }
    const target = new THREE.WebGLRenderTarget(4, 4);
    // (only the new ones drawn: on a layer of their own for the moment, the camera seeing only it)
    const WARM = 31, mask = this.camera.layers.mask;
    for (const { m } of was) m.layers.enable(WARM);
    try {
      timed("3D warmed up", () => {
        this.camera.layers.set(WARM);
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
      });
    } finally {
      this.camera.layers.mask = mask;
      this.renderer.setRenderTarget(null);
      target.dispose();
      for (const w of was) { w.m.layers.disable(WARM); w.m.visible = w.visible; if (w.count >= 0) (w.m as THREE.InstancedMesh).count = w.count; this.warmed.add(w.m); }
      this.dirty = true;
    }
  }

  /** A path's or road's material: its color, and up close the scan of what it's made of. */
  private surfaceMaterial(color: string, scan: SurfaceLayer | null) {
    const m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    if (scan) addSurfaceDetail(m, this.ground.detail, layerOf(scan), scan === "grass" ? 0.7 : 1);
    return m;
  }

  /** Every pond pictured again, in the next still moments (what stands round them, or the sky, changed). */
  private pondsAgain() {
    if (!this.ponds.size) return;
    for (const p of this.ponds.values()) p.done = false;
    this.pondsDirty = true;
  }
  /**
   * A pond's picture of all round it (its banks, the trees on them, the sky), taken from just over
   * its middle, which its water then mirrors: a side of it each still moment (the side looking down
   * isn't needed: water mirrors what's above it), so it never holds the view up. The biggest ponds
   * first, six of them (three on a phone); the rest mirror the sky and a band for their banks.
   */
  private pictureStep() {
    const r = this.renderer;
    // (without a graphics card each side would hold the page up for seconds: the sky and a band
    // for the banks, as before)
    if (this.software) { this.pondsDirty = false; this.picturing = null; return; }
    // (a side at most every 0.7 s, never two frames running; none on a phone already running slow)
    if (this.mobile && this.tier >= 2) return;
    const now = performance.now();
    if (now - this.pictureAt < 700) return;
    this.pictureAt = now;
    if (!this.picturing) {
      // (ponds no longer standing: their pictures let go)
      for (const [m, p] of this.ponds) {
        let o: THREE.Object3D = m;
        while (o.parent) o = o.parent;
        if (o !== this.scene) { p.env?.dispose(); this.ponds.delete(m); }
      }
      const lean = this.mobile && !this.streetDetail;
      const most = lean ? 3 : 6;
      const next = [...this.ponds].sort((a, b) => b[1].size - a[1].size).slice(0, most).find(([, p]) => !p.done);
      if (!next) { this.pondsDirty = false; return; }
      const size = lean ? 128 : 256;
      const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cube = new THREE.CubeCamera(1, 3000, rt);
      cube.position.copy(next[1].at);
      cube.updateMatrixWorld(true);
      if (cube.coordinateSystem !== r.coordinateSystem) { cube.coordinateSystem = r.coordinateSystem; cube.updateCoordinateSystem(); }
      this.picturing = { mesh: next[0], cube, rt, face: 0 };
    }
    const job = this.picturing, pond = this.ponds.get(job.mesh);
    if (!pond) { job.rt.dispose(); this.picturing = null; return; }
    // (the water itself, the grass and anything shown over the view: out of the picture)
    const hidden: THREE.Object3D[] = [];
    this.itemsGroup.traverse(o => { if (o.userData.water && o.visible) { o.visible = false; hidden.push(o); } });
    for (const o of [this.grass.group, this.tufts.group, this.fx]) if (o.visible) { o.visible = false; hidden.push(o); }
    const was = r.getRenderTarget(), wasClear = r.getClearColor(new THREE.Color()), wasAlpha = r.getClearAlpha();
    // (the sky, haze and land round it as seen from the ground, whatever the view is now)
    const eye = new THREE.PerspectiveCamera(90, 1, 1, 3000);
    eye.position.copy(pond.at);
    const back = this.atmosphere(eye, true);
    try {
      timed("a pond pictured", () => {
        if (job.face === 3) {
          // (looking down: never seen in the water, filled with its banks' color)
          r.setRenderTarget(job.rt, 3);
          r.setClearColor(new THREE.Color(pond.shore[0]), 1);
          r.clear();
        } else {
          r.setRenderTarget(job.rt, job.face);
          r.render(this.scene, job.cube.children[job.face] as THREE.Camera);
        }
      });
    } finally {
      r.setRenderTarget(was);
      r.setClearColor(wasClear, wasAlpha);
      back();
      for (const o of hidden) o.visible = true;
    }
    if (++job.face < 6) return;
    // All six sides: blurred as the water needs (its ripples), and mirrored
    this.picturing = null;
    const pm = new THREE.PMREMGenerator(r);
    const env = pm.fromCubemap(job.rt.texture);
    pm.dispose();
    job.rt.dispose();
    pond.env?.dispose();
    pond.env = env;
    pond.done = true;
    const old = job.mesh.material as THREE.Material;
    job.mesh.material = waterMaterial(pond.color, ...pond.shore, { bottom: pond.bottom, mirror: env.texture });
    if (!old.userData.shared) old.dispose();
    this.dirty = true;
  }

  /** Every slow piece made now (a flight, a picture: all of it in). */
  finishBuilding() {
    if (this.slowQueue.size) { this.drainSlow(Infinity); this.invalidate(); }
  }
  /** Whether slow pieces are still waiting to be made (for tests). */
  building() {
    return this.slowQueue.size > 0;
  }

  // ------------------------------------------------------------------ selection and hover

  private syncSelection() {
    if (this.selectionFx) {
      this.fx.remove(this.selectionFx);
      disposeObjectDeep(this.selectionFx);
      this.selectionFx = null;
    }
    // (the area being reshaped with the brush stays outlined, as picked)
    const fx = this.outlineFor(this.selectedId ?? this.tool.reshape ?? null, SELECT, 1);
    if (this.group.length) {
      const g = new THREE.Group();
      for (const id of this.group.slice(0, 400)) {
        const o = this.outlineFor(id, SELECT, 1);
        if (o) g.add(o);
      }
      if (fx) g.add(fx);
      this.selectionFx = g;
      this.fx.add(g);
    } else if (fx) {
      this.selectionFx = fx;
      this.fx.add(fx);
    }
  }

  private outlineFor(id: string | null, color: string, opacity: number, grow = 0, order = 9): THREE.Object3D | null {
    const doc = this.doc;
    if (!doc || !id) return null;
    const g = new THREE.Group();
    const hole = this.hole(id);
    if (hole) {
      const s = doc.stats.find(x => x.holeId === hole.id);
      if (!s || s.line.length < 2) return null;
      const line = smoothPath(s.line, 10);
      g.add(this.fatLine(this.drapeLine(fairwayOutline(hole, line, 0, 12), 0.5, true), color, 2 + grow, { opacity: opacity * 0.9, dashed: 5, order }));
      return g;
    }
    const item = this.item(id);
    if (!item || item.type === "label") return null;
    if (item.type === "structure") {
      // Its outline (or both edges of a bridge or wall), seen through whatever stands over it
      const pts = isLineKind(item.kind) ? structurePath(item) : item.points;
      const w = isLineKind(item.kind) ? structureWidth(item) / 2 + 0.6 : 0;
      const edge = (off: number) => pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: p.x - ((b.y - a.y) / l) * off, y: p.y + ((b.x - a.x) / l) * off };
      });
      const rings = w ? [[...edge(w), ...edge(-w).reverse()]] : [pts];
      for (const r of rings) g.add(this.fatLine(this.drapeLine(r, LIFT + 0.3, true), color, 3 + grow, { opacity, order, depthTest: false }));
    } else if (item.type === "area") {
      g.add(this.fatLine(this.drapeLine(item.points, LIFT + 0.2, true), color, 3.5 + grow, { opacity, order }));
    }
    else if (item.type === "line") g.add(this.fatLine(this.drapeLine(item.points, LIFT + 0.2), color, 5 + grow, { opacity: opacity * 0.6, order }));
    else {
      const r = item.type === "tree" ? item.radius * (item.width ?? 1) * 1.05 : item.type === "tee" ? item.padLength * 0.62 : item.type === "basket" ? 3 : 3.5;
      const ring: P[] = [];
      for (let i = 0; i < 48; i++) ring.push({ x: item.x + Math.cos((i / 48) * Math.PI * 2) * r, y: item.y + Math.sin((i / 48) * Math.PI * 2) * r });
      g.add(this.fatLine(this.drapeLine(ring, 0.4, true), color, 2.5 + grow, { opacity, order }));
    }
    return g;
  }

  /** What the others in the course have picked: each outlined as your own pick is, thin, in their
   * color, over a faint dark edge so it reads on the photo (stronger while they drag it). */
  setOthersPicked(picks: { id: string; color: string; strong: boolean }[]) {
    if (JSON.stringify(picks) === JSON.stringify(this.others)) return;
    this.others = picks;
    this.syncOthers();
    this.invalidate();
  }

  /** (for tests: the ids others have picked, as outlined) */
  othersPicked() { return this.othersFx ? this.others.map(p => p.id) : []; }

  /** Whether something is being dragged on the map now. */
  isDragging() { return this.dragging; }

  private syncOthers() {
    if (this.othersFx) {
      this.fx.remove(this.othersFx);
      disposeObjectDeep(this.othersFx);
      this.othersFx = null;
    }
    if (!this.others.length) return;
    const g = new THREE.Group();
    for (const p of this.others) {
      const under = this.outlineFor(p.id, "#000000", 0.35, 2, 8);
      const line = this.outlineFor(p.id, p.color, p.strong ? 0.95 : 0.75, -0.5, 9);
      if (under) g.add(under);
      if (line) g.add(line);
    }
    if (!g.children.length) return;
    this.othersFx = g;
    this.fx.add(g);
  }

  /** What a click at a client point picks, as the select click works it out: a tree or bush
   * drawn there when the pointer is over an area, a line or a hole's line (most trees stand in a
   * wood) but not on an area's edge; otherwise the thing itself. */
  clickTarget(clientX: number, clientY: number, dom: string | null = null): { id: string | null; tree: ReturnType<CourseView["treeAt"]> } {
    const hit = dom ?? this.pick(clientX, clientY);
    const it = hit ? this.item(hit) : null;
    const big = (!hit || (!!it && (it.type === "area" || it.type === "line" || it.type === "structure")) || (!it && !!this.hole(hit))) && !(hit && !dom && this.pickedEdge);
    const tree = big && !this.readOnly ? this.treeAtScreen(clientX, clientY) : null;
    return tree ? { id: null, tree } : { id: hit, tree: null };
  }

  /** The tree or bush the pointer is over (not an item of its own), outlined as a hovered thing is. */
  private hoverTree: ReturnType<CourseView["treeAt"]> = null;
  /** Whether the pointer is on the hovered area's edge (where a picked area is moved from). */
  private hoverEdge = false;
  private setHover(id: string | null, tree: ReturnType<CourseView["treeAt"]> = null) {
    const edge = !!id && this.pickedEdge;
    if (id === this.hoverId && JSON.stringify(tree) === JSON.stringify(this.hoverTree)) {
      if (edge !== this.hoverEdge) { this.hoverEdge = edge; this.updateCursor(); }
      return;
    }
    this.hoverId = id;
    this.hoverTree = tree;
    this.hoverEdge = edge;
    if (this.hoverFx) {
      this.fx.remove(this.hoverFx);
      disposeObjectDeep(this.hoverFx);
      this.hoverFx = null;
    }
    if (id && id !== this.selectedId && !this.group.includes(id)) {
      this.hoverFx = this.outlineFor(id, "#ffffff", 0.5);
      if (this.hoverFx) this.fx.add(this.hoverFx);
    } else if (tree) {
      // (a ring round its crown, on the ground)
      const at = this.treeSpotOf(tree);
      if (at) {
        const ring: P[] = [];
        for (let i = 0; i < 48; i++) ring.push({ x: at.x + Math.cos((i / 48) * Math.PI * 2) * at.r, y: at.y + Math.sin((i / 48) * Math.PI * 2) * at.r });
        const g = new THREE.Group();
        g.add(this.fatLine(this.drapeLine(ring, 0.4, true), "#ffffff", 2.5, { opacity: 0.5, order: 9 }));
        this.hoverFx = g;
        this.fx.add(g);
      }
    }
    this.updateCursor();
    this.invalidate();
  }

  /** Where a tree that isn't an item of its own stands, and how wide its crown is. */
  private treeSpotOf(tree: NonNullable<ReturnType<CourseView["treeAt"]>>): { x: number; y: number; r: number } | null {
    if (tree.kind === "spot") return { x: tree.x, y: tree.y, r: Math.max(1.5, tree.width / 2) };
    const lidar = this.doc?.course.lidar, t = lidar?.trees[tree.k];
    if (!t) return null;
    const [x, y, , r] = grownTree(t, lidar!.growYears ?? 0);
    return { x, y, r: Math.max(1.5, r) };
  }

  /** What a hovered thing is called, for the tip after the pointer rests on it. */
  private hoverName(id: string | null, tree: ReturnType<CourseView["treeAt"]>) {
    if (tree) return tree.kind === "measured" ? "Measured tree" : tree.conifer ? "Pine" : tree.height < 9 ? "Bush" : "Tree";
    if (!id) return null;
    const it = this.item(id);
    if (!it) { const h = this.hole(id); return h ? `Hole ${this.num(h.id)}` : null; }
    if (it.type === "area") {
      const name = brushOnly(it) ? `${(it.density ?? 1) < 0.75 ? "Light" : (it.density ?? 1) > 1.4 ? "Heavy" : "Medium"} underbrush` : it.label || AREA_KINDS[it.kind].label;
      return this.pickedEdge ? `${name} edge` : name;
    }
    if (it.type === "line") return it.label || LINE_KINDS[it.kind].label;
    return this.nameOf(id);
  }

  /** After the pointer rests a moment on something, its name beside it (what a click picks); it
   * goes as soon as the pointer moves on. */
  private restTimer = 0;
  private restKey = "";
  private restTip(p: { x: number; y: number }, id: string | null, tree: ReturnType<CourseView["treeAt"]>) {
    const key = id ?? (tree ? JSON.stringify(tree) : "");
    if (key === this.restKey && key) return;
    this.restKey = key;
    window.clearTimeout(this.restTimer);
    this.tip(null);
    if (!key || id === this.selectedId) return;
    const name = this.hoverName(id, tree);
    if (!name) return;
    this.restTimer = window.setTimeout(() => { const q = this.lastPointer; if (q && this.restKey === key) this.tip(name, q.x, q.y); }, 450);
  }

  // ------------------------------------------------------------------ labels and badges (DOM)

  private syncOverlays() {
    const doc = this.doc;
    if (!doc) return;
    const course = doc.course;
    const seen = new Set<string>();
    const put = (key: string, sig: string, rank: number, make: () => HTMLDivElement, anchor: THREE.Vector3, dy: number, minPx = 0) => {
      seen.add(key);
      let o = this.overlays.get(key);
      if (!o || o.sig !== sig) {
        o?.el.remove();
        const el = make();
        el.classList.add("dg-ov");
        this.labelsLayer.appendChild(el);
        o = { el, anchor, dy, sig, rank, minPx, key };
        this.overlays.set(key, o);
      }
      o.anchor = anchor;
      o.dy = dy;
    };
    const at = (p: P, lift = 0) => new THREE.Vector3(p.x, this.h(p.x, p.y) + lift, p.y);
    const mainTees = new Set(doc.stats.map(s => s.teeId));
    const mainBaskets = new Set(doc.stats.map(s => s.basketId));
    const off = this.otherLayouts();
    const picked = new Set(this.group);
    const clean = this.readOnly;
    for (const item of course.items) {
      const sel = item.id === this.selectedId || picked.has(item.id);
      if (clean && (item.type === "tee" || item.type === "basket") && !(item.type === "tee" ? mainTees : mainBaskets).has(item.id)) continue;
      if (clean && (item.type === "mando" || item.type === "dropzone" || item.type === "amenity")) continue;
      if (item.type === "tee") {
        const t = item as TeeItem;
        const lvl = TEE_LEVELS[t.level];
        const n = this.num(t.holeId);
        const main = mainTees.has(t.id);
        // (another layout's tee: small and faint while this one is worked on)
        const faded = !main && !sel && off.tees.has(t.level);
        put(`tee:${t.id}`, `${n}|${t.level}|${sel}|${main}|${faded}|${clean}`, main ? 0 : 2, () => {
          const el = document.createElement("div");
          el.className = `dg-tee${main ? "" : " alt"}${faded ? " off" : ""}${sel ? " sel" : ""}`;
          el.dataset.itemId = t.id;
          el.setAttribute("data-testid", "tee-badge");
          el.style.setProperty("--c", lvl.color);
          el.style.setProperty("--ink", lvl.ink);
          el.title = clean ? `Hole ${n}` : `Hole ${n} · ${lvl.label} tee: drag to move`;
          if (clean) el.style.cursor = "pointer";
          el.textContent = String(n);
          return el;
        }, at(t, 1), 0);
      } else if (item.type === "basket") {
        const b = item as BasketItem;
        // (a basket several holes play to: each one's number)
        const n = basketHoles(b).filter(h => this.num(h)).sort((x, y) => holeNumber(this.doc!.course, x) - holeNumber(this.doc!.course, y)).map(h => this.num(h)).join(" & ");
        const shared = !!b.alsoHoles?.length;
        const multi = holeBaskets(course, b.holeId).length > 1;
        const main = mainBaskets.has(b.id);
        const faded = !main && !sel && off.pins.has(b.position);
        put(`basket:${b.id}`, `${n}|${b.position}|${multi}|${sel}|${main}|${faded}|${course.style.basket}|${clean}`, main ? 1 : 3, () => {
          const el = document.createElement("div");
          el.className = `dg-basket${faded ? " off" : ""}${sel ? " sel" : ""}`;
          el.dataset.itemId = b.id;
          el.setAttribute("data-testid", "basket-badge");
          el.style.setProperty("--c", course.style.basket);
          el.style.opacity = main ? "1" : "0.75";
          el.title = clean ? `Hole ${n}` : `Hole ${n} basket${multi ? ` (pin ${b.position})` : ""}: drag to move`;
          if (clean) el.style.cursor = "pointer";
          if (multi) {
            const tag = document.createElement("b");
            tag.textContent = b.position;
            el.appendChild(tag);
          }
          if (shared) {
            const tag = document.createElement("i");
            tag.className = "dg-shared";
            tag.textContent = n;
            el.appendChild(tag);
          }
          return el;
        }, at(b, 2), 0);
      } else if (item.type === "mando" || item.type === "dropzone" || item.type === "amenity") {
        // The same symbols as the printed map (the mando's arrow and line are drawn on the ground)
        const isM = item.type === "mando", isDz = item.type === "dropzone";
        const kind = item.type === "amenity" ? (item as AmenityItem).kind : null;
        put(`chip:${item.id}`, `${kind ?? item.type}|${sel}`, 2, () => {
          const el = document.createElement("div");
          el.className = `dg-sym${sel ? " sel" : ""}`;
          el.dataset.itemId = item.id;
          el.setAttribute("data-testid", `${item.type}-chip`);
          el.title = `${isM ? `Mando, pass on the ${item.side}` : isDz ? "Drop zone" : AMENITY_KINDS[kind!].label}: drag to move`;
          el.innerHTML = isM
            ? symbolSvg(`<circle r="5.5" fill="#fff" stroke="${INK}" stroke-width="1.6"/><circle r="2.4" fill="${MANDO}"/>`, 18)
            : isDz ? symbolSvg(dropZoneSymbol({ x: 0, y: 0 }, 1.15), 24) : symbolSvg(amenitySymbol(kind!, { x: 0, y: 0 }, 1), kind === "here" ? 34 : 22, kind === "here" ? 22 : 16);
          return el;
        }, at(item, 3), isM ? 0 : -10, 0);
      } else if (item.type === "label") {
        const l = item as LabelItem;
        put(`txt:${l.id}`, `${l.text}|${l.color}|${l.fontSize}|${sel}|${clean}`, 2, () => {
          const el = document.createElement("div");
          el.className = "dg-text";
          if (clean) el.style.pointerEvents = "none";
          else el.dataset.itemId = l.id;
          el.style.color = l.color;
          el.style.fontSize = `${clamp(l.fontSize, 9, 40)}px`;
          if (sel) el.style.outline = `2px solid ${SELECT}`;
          el.textContent = l.text;
          return el;
        }, at(l, 0.5), 0);
      } else if ((item.type === "area" || item.type === "structure") && item.label) {
        put(`area:${item.id}`, item.label, 4, () => {
          const el = document.createElement("div");
          el.className = "dg-area";
          el.textContent = item.label!;
          return el;
        }, at(item, 0.5), 0, 0);
      }
    }
    // Distance chips on each throw line (on a map looked at: the hole picked only)
    for (const s of doc.stats) {
      if (!s.complete || (clean && s.holeId !== this.selectedId)) continue;
      // Halfway, or nearby where no mando or drop zone sits (nor, on the selected hole, the dot
      // halfway along each leg that bends it)
      const marks: { p: P; r: number }[] = course.items.filter(i => i.type === "mando" || i.type === "dropzone").map(p => ({ p, r: 28 }));
      // (a dot's clearance at least the chip's half width on screen, zoomed out too)
      const chipR = (60 * 2 * this.controls.distance * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, this.size.height);
      if (s.holeId === this.selectedId) for (let i = 1; i < s.line.length; i++) marks.push({ p: { x: (s.line[i - 1].x + s.line[i].x) / 2, y: (s.line[i - 1].y + s.line[i].y) / 2 }, r: Math.max(28, s.length * 0.1, chipR) });
      // (the selected hole's width squares too: the chip never on one)
      const picked = s.holeId === this.selectedId ? course.holes.find(h => h.id === s.holeId) : undefined;
      if (picked?.fairway) for (const t of stationsOf(picked)) marks.push({ p: pointAlong(s.line, s.length * t).point, r: chipR * 0.6 });
      let mid = [0.5, 0.35, 0.65, 0.25, 0.75].map(f => pointAlong(s.line, s.length * f).point).find(q => marks.every(m => dist(m.p, q) > m.r));
      // (no room on the line, zoomed out: halfway, beside the fairway, clear of its squares)
      if (!mid && picked) {
        const half = pointAlong(s.line, s.length / 2), off = (picked.fairway ? picked.fairwayWidth / 2 : 0) + chipR * 0.9;
        mid = { x: half.point.x - Math.sin(half.angle) * off, y: half.point.y + Math.cos(half.angle) * off };
      }
      mid ??= pointAlong(s.line, s.length / 2).point;
      const text = `${fmtDist(s.length, course.units)}`;
      const extra = `P${s.par}${Math.abs(s.elevationChange) >= 3 ? ` · ${fmtElev(s.elevationChange, course.units)}` : ""}`;
      put(`dist:${s.holeId}`, `${text}|${extra}`, 3, () => {
        const el = document.createElement("div");
        el.className = "dg-dist";
        el.setAttribute("data-testid", "hole-distance");
        el.textContent = text;
        const i = document.createElement("i");
        i.textContent = extra;
        el.appendChild(i);
        return el;
      }, at(mid, 1), 0, 110);
    }
    // Walks leaving a basket that holes share: which hole each goes to
    if (course.style.nextTee && !clean) {
      for (const r of sharedWalks(walkRoutes(course.items, doc.stats, course.holes))) {
        const len = pathLength(r.points);
        const text = `→ ${r.b.label}`;
        put(`walk:${r.a.holeId}`, text, 2, () => {
          const el = document.createElement("div");
          el.className = "dg-dist";
          el.setAttribute("data-testid", "walk-tag");
          el.textContent = text;
          return el;
        }, at(pointAlong(r.points, len * 0.32).point, 1), 0, 60);
      }
    }
    // Problems (Review step)
    (doc.issues ?? []).forEach((issue, i) => {
      if (clean || (issue.level === "info" && !issue.holes.length)) return;
      put(`issue:${i}`, `${issue.text}|${issue.level}`, 0, () => {
        const el = document.createElement("div");
        el.className = "dg-issue";
        el.setAttribute("data-testid", "issue-marker");
        el.style.background = issue.level === "danger" ? "#dc2626" : issue.level === "warning" ? "#d97706" : "#2563eb";
        el.title = `Checks: ${issue.text}`;
        el.dataset.issue = String(i);
        el.textContent = issue.level === "info" ? "i" : "!";
        return el;
      }, at(issue.at, 2), -18);
    });
    // Trees measured from the air that are cut down: a stump to bring each back; those kept where
    // they'd be cut, a ring to cut them down after all
    const lidar = course.lidar, ls = this.lidarState;
    if (lidar && ls && !clean) {
      const mark = (k: number, kept: boolean) => {
        // (a sapling grown since the survey isn't in the list: no stump for it)
        const t = lidar.trees[k];
        if (!t) return;
        const [x, y] = t;
        put(`stump:${k}`, String(kept), 4, () => {
          const el = document.createElement("div");
          el.className = kept ? "dg-stump kept" : "dg-stump";
          el.dataset.stump = String(k);
          el.setAttribute("data-testid", kept ? "kept-tree" : "stump");
          el.title = kept ? "Cut down" : "Bring back";
          return el;
        }, at({ x, y }, 0.5), 0);
      };
      ls.cut.forEach(k => mark(k, false));
      ls.kept.forEach(k => mark(k, true));
    }
    for (const [key, o] of this.overlays) {
      if (!seen.has(key)) {
        o.el.remove();
        this.overlays.delete(key);
      }
    }
  }

  /** Whether a stump (or a kept tree's ring) shows: close enough to see, or on the hole picked. */
  private stumpShown(o: Overlay, picked: { line: P[]; half: number } | null) {
    if (this.readOnly) return false;
    if (picked && distanceToPath({ x: o.anchor.x, y: o.anchor.z }, picked.line) < picked.half) return true;
    return this.showStumps && 1 / this.upp(o.anchor) >= 0.8;
  }

  /** A measured tree cut down (taken out, or cleared for play) or brought back, one undo step. */
  toggleLidarTree(k: number) {
    const lidar = this.doc?.course.lidar, ls = this.lidarState;
    if (!lidar || !ls || !lidar.trees[k] || this.readOnly) return;
    const kept = new Set(lidar.kept ?? []), removed = new Set(lidar.removed ?? []);
    const [x, y, , r] = lidar.trees[k];
    if (ls.stand.includes(k)) {
      if (kept.has(k)) kept.delete(k);
      else removed.add(k);
    } else {
      removed.delete(k);
      if (this.clearedAt({ x, y }, r * 0.3)) kept.add(k);
    }
    const list = (set: Set<number>) => (set.size ? [...set].sort((a, b) => a - b) : undefined);
    this.cb.onLidar({ kept: list(kept), removed: list(removed) });
  }

  /** The measured tree standing at a spot (its trunk within reach), if any. */
  /** The trees under the pointer, nearest the eye first, by the shapes they're drawn with: a
   * trunk, and a crown round its upper part (a crown seen from the side or tilted is far from the
   * ground behind it). Measured trees, the saplings grown since the survey and the trees planted in
   * woods; not the tree items (they're picked as items). A sapling under a big crown is in the list
   * too, after the big tree. */
  /** The tree placed by hand that the pointer is on: the nearest whose drawn leaves or trunk the
   * ray meets (so a tree seen past the edge of a nearer one's crown is the one picked, not the
   * nearer). The trees whose rough shape the ray passes through are tried; a finger, or a tree
   * drawn too thin to hit, falls back to that shape. */
  /** The building, shelter or deck `ray` first meets (its roof or walls, by their real shape),
   * and how far along. */
  private builtUnder(ray: THREE.Ray): { id: string; t: number } | null {
    const doc = this.doc;
    if (!doc) return null;
    let best: { id: string; t: number } | null = null;
    const o = ray.origin, d = ray.direction;
    for (const st of doc.course.items) {
      if (st.type !== "structure" || isLineKind(st.kind) || st.points.length < 3) continue;
      const tall = structureHeight(st), house = st.kind === "building" || st.kind === "shelter";
      const roof = house ? roofFor(st) : null;
      const shape = roof ? roof.eaves : st.points;
      const base = Math.max(...st.points.map(p => this.h(p.x, p.y)));
      const top = (p: { x: number; y: number }) => base + (roof ? tall + roof.pitch * roof.run(p) : tall + (st.kind === "deck" && tall > 2 ? 3 : 0));
      // (where the ray is over its outline's box and below its highest point: stepped through)
      const b = boundsOf(shape), peak = base + tall + (roof ? roof.rise : 3) + 1;
      let t0 = 0, t1 = Infinity;
      for (const [lo, hi, oo, dd] of [[b.minX, b.maxX, o.x, d.x], [base - 1, peak, o.y, d.y], [b.minY, b.maxY, o.z, d.z]]) {
        if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) t1 = -1; continue; }
        const a = (lo - oo) / dd, c = (hi - oo) / dd;
        t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
      }
      if (!(t1 > t0) || t0 >= (best?.t ?? Infinity)) continue;
      for (let t = t0; t <= t1; t += 0.25) {
        const p = { x: o.x + d.x * t, y: o.z + d.z * t };
        if (pointInPolygon(p, shape) && o.y + d.y * t <= top(p)) { best = { id: st.id, t }; break; }
      }
    }
    return best;
  }

  private treeUnder(ray: THREE.Ray): { id: string; t: number; drawn?: boolean } | null {
    const doc = this.doc;
    if (!doc || this.treesHidden) return null;
    const near: { id: string; t: number }[] = [];
    for (const item of doc.course.items) {
      if (item.type !== "tree") continue;
      const t = this.rayHitsTree(ray, item.x, item.y, this.h(item.x, item.y), item.height ?? 30, item.radius * (item.width ?? 1) * 1.25);
      if (t < Infinity) near.push({ id: item.id, t });
    }
    if (!near.length) return null;
    // (shown, all the way up)
    const shown = (o: THREE.Object3D | null) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const caster = new THREE.Raycaster(ray.origin.clone(), ray.direction.clone());
    let best: { id: string; t: number; drawn?: boolean } | null = null;
    for (const n of near) {
      const obj = this.objects.get(n.id)?.obj;
      if (!obj) continue;
      const hit = caster.intersectObject(obj, true).find(h => shown(h.object));
      if (hit && hit.distance < (best?.t ?? Infinity)) best = { id: n.id, t: hit.distance, drawn: true };
    }
    if (best) return best;
    // (none drawn under it: by the shape round each, a little tighter for a mouse than a finger)
    const tight = this.fingers ? 1.25 : 0.85;
    for (const item of doc.course.items) {
      if (item.type !== "tree") continue;
      const t = this.rayHitsTree(ray, item.x, item.y, this.h(item.x, item.y), item.height ?? 30, item.radius * (item.width ?? 1) * tight);
      if (t < (best?.t ?? Infinity)) best = { id: item.id, t };
    }
    return best;
  }

  /** Where along `ray` it first meets a tree standing at (x, y): its crown (an ellipsoid round
   * the upper part, at least 3 ft across) or its trunk; Infinity if it misses. */
  private rayHitsTree(ray: THREE.Ray, x: number, y: number, ground: number, height: number, radius: number) {
    const rx = Math.max(1.5, radius), ry = Math.max(1.5, height * 0.34);
    const o = new THREE.Vector3(ray.origin.x - x, ray.origin.y - (ground + height * 0.64), ray.origin.z - y), d = ray.direction.clone();
    o.x /= rx; o.z /= rx; o.y /= ry; d.x /= rx; d.z /= rx; d.y /= ry;
    const A = d.dot(d), B = 2 * o.dot(d), C = o.dot(o) - 1, disc = B * B - 4 * A * C;
    let t = Infinity;
    if (disc >= 0) { const tt = (-B - Math.sqrt(disc)) / (2 * A); if (tt > 0) t = tt; }
    const a = new THREE.Vector3(x, ground, y), b = new THREE.Vector3(x, ground + height * 0.4, y), on = new THREE.Vector3();
    const r = Math.max(1, radius * 0.12);
    if (ray.distanceSqToSegment(a, b, on) <= r * r) t = Math.min(t, on.distanceTo(ray.origin));
    return t;
  }

  treesAtScreen(clientX: number, clientY: number, max = 6): NonNullable<ReturnType<CourseView["treeAt"]>>[] {
    const ray = this.ray(clientX, clientY).clone();
    const hits: { t: number; core: number; tree: NonNullable<ReturnType<CourseView["treeAt"]>> }[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), onRay = new THREE.Vector3(), c = new THREE.Vector3(), o = new THREE.Vector3(), d = new THREE.Vector3();
    // (a crown: an ellipsoid round the upper part; at least 3 ft across, so a sprout can be hit)
    // (and how near its middle the pointer passes: 0 dead center, 1 just grazing its edge, where
    // a crown is thin and the tree behind shows through)
    const crownHit = (x: number, y: number, ground: number, height: number, radius: number) => {
      const rx = Math.max(1.5, radius), ry = Math.max(1.5, height * 0.34);
      c.set(x, ground + height * 0.64, y);
      o.copy(ray.origin).sub(c); d.copy(ray.direction);
      o.x /= rx; o.z /= rx; o.y /= ry; d.x /= rx; d.z /= rx; d.y /= ry;
      const A = d.dot(d), B = 2 * o.dot(d), C = o.dot(o) - 1, disc = B * B - 4 * A * C;
      if (disc < 0) return { t: Infinity, core: 1 };
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      const s = -B / (2 * A), core = Math.sqrt(Math.max(0, o.clone().addScaledVector(d, s).lengthSq()));
      return { t: t > 0 ? t : Infinity, core };
    };
    const test = (x: number, y: number, ground: number, height: number, radius: number, tree: NonNullable<ReturnType<CourseView["treeAt"]>>) => {
      const hit = crownHit(x, y, ground, height, radius);
      let t = hit.t, core = hit.core;
      // (its trunk, below the crown: right on it)
      a.set(x, ground, y); b.set(x, ground + height * 0.4, y);
      const r = Math.max(1, radius * 0.12);
      if (ray.distanceSqToSegment(a, b, onRay) <= r * r) { t = Math.min(t, onRay.distanceTo(ray.origin)); core = 0; }
      if (t < Infinity) hits.push({ t, core, tree });
    };
    // (each crown as wide as the woods draw it)
    const drawnR = (conifer: boolean | number, variant: number, height: number, width: number) => woodsCrownWidth(conifer ? "conifer" : "broadleaf", variant, height, width) / 2;
    // (only what's drawn just now can be picked: none with the trees hidden, none of a wood or its
    // underbrush out of sight, and none past where a forest stops drawing them)
    if (this.treesHidden) return [];
    const shown = (o: THREE.Object3D | null) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const measuredShown = this.itemsGroup.children.some(g => g.userData.measured && shown(g));
    const lidar = this.doc?.course.lidar, ls = this.lidarState;
    if (lidar && ls && measuredShown) {
      for (const k of ls.stand) {
        const tr = lidar.trees[k];
        if (!tr) continue;
        const [x, y, h, r, conifer] = grownTree(tr, lidar.growYears ?? 0);
        test(x, y, this.h(x, y), h, drawnR(conifer, 0, h, r * 2), { kind: "measured", k });
      }
    }
    for (const g of this.itemsGroup.children) {
      const spots = g.userData.spots as TreeSpot[] | undefined;
      if (!spots || !shown(g)) continue;
      // (the measured forest: its measured trees are tested above by index; its saplings here)
      const measuredCount = g.userData.measured ? (lidar?.trees.length ?? 0) : 0;
      const indexOf = g.userData.indexes as number[] | undefined;
      const one = (s: TreeSpot, i: number) => {
        if (measuredCount && indexOf && indexOf[i] < measuredCount) return;
        test(s.x, s.y, s.ground, s.height, s.shape === "bush" ? s.width / 2 : drawnR(s.shape === "conifer", s.variant, s.height, s.width), { kind: "spot", x: s.x, y: s.y, height: s.height, width: s.width, conifer: s.shape === "conifer" });
      };
      const forest = g.userData.forest as Forest | undefined;
      if (forest && !measuredCount) forest.eachDrawn(s => one(s, -1));
      else spots.forEach(one);
    }
    // Nearest first; but a nearer crown only grazed at its thin edge gives way to one behind that
    // the pointer is well into
    hits.sort((p, q) => p.t - q.t);
    const firm = hits.findIndex(h => h.core < 0.72);
    if (firm > 0) hits.unshift(...hits.splice(firm, 1));
    return hits.slice(0, max).map(h => h.tree);
  }

  /** How a tree looks where it stands (its shape variant, turn and leaf color), so a tree made the
   * course's own looks just the same. */
  lookOf(tree: NonNullable<ReturnType<CourseView["treeAt"]>>): { variant: number; rotation: number; leaf: string } | null {
    for (const g of this.itemsGroup.children) {
      const spots = g.userData.spots as TreeSpot[] | undefined;
      if (!spots) continue;
      const indexOf = g.userData.indexes as number[] | undefined;
      const i = tree.kind === "measured" ? (g.userData.measured && indexOf ? indexOf.indexOf(tree.k) : -1) : spots.findIndex(s => Math.abs(s.x - tree.x) < 0.05 && Math.abs(s.y - tree.y) < 0.05);
      if (i >= 0) { const s = spots[i]; return { variant: s.variant, rotation: Math.round((-s.turn / DEG) * 10) / 10, leaf: `#${s.tint.getHexString()}` }; }
    }
    return null;
  }

  /** The nearest tree under the pointer (see treesAtScreen). */
  treeAtScreen(clientX: number, clientY: number): ReturnType<CourseView["treeAt"]> {
    return this.treesAtScreen(clientX, clientY, 1)[0] ?? null;
  }

  /** Any tree standing at a spot that isn't an item of its own: a measured one (its index), or a
   * sapling or planted tree (where it stands and its size). */
  treeAt(p: P): { kind: "measured"; k: number } | { kind: "spot"; x: number; y: number; height: number; width: number; conifer: boolean } | null {
    const k = this.lidarTreeAt(p);
    if (k !== null) return { kind: "measured", k };
    let best: TreeSpot | null = null, bestD = Infinity;
    const look = (g: THREE.Object3D) => {
      const spots = g.userData.spots as TreeSpot[] | undefined;
      if (!spots) return;
      for (const s of spots) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < Math.max(4, s.width * 0.3) && d < bestD) { best = s; bestD = d; }
      }
    };
    this.itemsGroup.children.forEach(look);
    const b = best as TreeSpot | null;
    return b ? { kind: "spot", x: b.x, y: b.y, height: b.height, width: b.width, conifer: b.shape === "conifer" } : null;
  }

  lidarTreeAt(p: P): number | null {
    const lidar = this.doc?.course.lidar, ls = this.lidarState;
    if (!lidar || !ls) return null;
    let best: number | null = null, bestD = Infinity;
    for (const k of ls.stand) {
      const t = lidar.trees[k];
      if (!t) continue; // (a sapling since the survey: not one to cut by hand)
      const [x, y, , r] = t, d = Math.hypot(x - p.x, y - p.y);
      if (d < Math.max(4, r * 0.6) && d < bestD) { best = k; bestD = d; }
    }
    return best;
  }

  // ------------------------------------------------------------------ handles

  private syncHandles() {
    const doc = this.doc;
    if (!doc) return;
    const editing = this.tool.mode === "select" && !this.readOnly;
    const sel = editing ? this.item(this.selectedId) : null;
    const holeId = editing ? (this.hole(this.selectedId)?.id ?? doc.activeHoleId) : null;
    const hole = this.hole(holeId);
    const drawing = this.drawn() ? this.drawPts.length : -1;
    const key = `${sel?.id ?? ""}|${sel?.locked ?? ""}|${sel && (sel.type === "area" || sel.type === "line" || sel.type === "structure") ? `${sel.points.length}${sel.kind}${sel.type === "area" ? (sel.field ?? "") : ""}` : ""}|${hole ? `${hole.id}:${hole.doglegs.length}:${doc.stats.find(s => s.holeId === hole.id)?.complete}:${hole.flyKeys?.length ?? 0}:${hole.fairwayStations?.length ?? 0}:${this.selectedId === hole.id}:${doc.course.holes.length}:${doc.course.style.nextTee}` : ""}|${drawing}`;
    const obKey = `${sel?.type === "line" || sel?.type === "area" ? `${sel.ob}:${sel.obStretches?.length ?? 0}` : ""}|${this.obPick ? `${this.obPick.id}:${this.obPick.from}:${this.obPick.cut}` : ""}|${this.partPick ? `${this.partPick.id}:${this.partPick.part}` : ""}`;
    if (`${this.readOnly}${key}${obKey}` === this.handleKey) return;
    this.handleKey = `${this.readOnly}${key}${obKey}`;
    this.handles.forEach(h => h.el.remove());
    this.handles = [];
    const add = (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts: { index?: number; title?: string; data?: Record<string, string>; visible?: () => boolean; tap?: Handle["tap"] } = {}) => {
      const el = document.createElement("div");
      el.className = "dg-h";
      el.dataset.handle = kind;
      el.setAttribute("data-testid", `handle-${kind}`);
      if (opts.index !== undefined) el.dataset.index = String(opts.index);
      if (opts.title) el.title = opts.title;
      Object.entries(opts.data ?? {}).forEach(([k, v]) => (el.dataset[k] = v));
      if ((kind === "flykey" || kind === "flylook") && opts.index === this.flyKeyOn) el.dataset.on = "";
      this.handlesLayer.appendChild(el);
      this.handles.push({ el, kind, index: opts.index, world, start, visible: opts.visible, tap: opts.tap });
    };
    // Marking a stretch of OB: where it starts, once clicked
    const pick = this.obPick, picked = pick && pick.from !== null ? (this.item(pick.id) as LineItem | AreaItem | null) : null;
    if (pick && (picked?.type === "line" || picked?.type === "area")) {
      add("obmark", () => {
        const pts = this.obPath(picked), p = pointAlong(pts, (pick.from ?? 0) * pathLength(pts)).point;
        return new THREE.Vector3(p.x, this.h(p.x, p.y) + 0.3, p.y);
      }, () => null);
    }
    if (drawing > 0) {
      for (let i = 0; i < this.drawPts.length; i++) {
        add("draw", () => { const p = this.drawPts[i]; return p ? new THREE.Vector3(p.x, this.h(p.x, p.y), p.y) : null; }, () => {
          // Clicking the first point closes an area
          if (i === 0 && this.drawn() === "area") this.finishDrawing();
          return null;
        }, { index: i, title: i === 0 ? "Click to close the shape" : undefined });
      }
      if (this.size.width > 1) this.layout();
      return;
    }
    if (hole) this.holeHandles(hole.id, add);
    if (sel && !sel.locked) this.itemHandles(sel, add);
    // Place them now (not on the next frame), so a quick second click finds them where they were
    if (this.size.width > 1) this.layout();
  }

  private itemHandles(sel: CourseItem, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    if (sel.type === "area" || sel.type === "line" || sel.type === "structure") {
      this.pointHandles(sel.id, add);
      if (turnable(sel)) this.turnHandle(sel.id, add);
    }
    if (sel.type === "area" && sel.kind === "field" && isBallField(fieldKindOf(sel))) {
      this.plateHandle(sel.id, add);
      if (this.partPick?.id === sel.id && !sel.locked) this.partHandle(sel.id, this.partPick.part, add);
    }
    if (!sel.locked) this.heightHandle(sel, add);
    if (sel.type === "line" && sel.kind === "stream") this.lineWidthHandles(sel.id, add);
    if ((sel.type === "line" || sel.type === "area") && sel.ob === true && sel.obStretches?.length && !sel.locked) this.obStretchHandles(sel.id, add);
    if (sel.type === "structure" && !isLineKind(sel.kind)) this.outlineHandles(sel.id, add);
    else if (sel.type === "tree") {
      const id = sel.id;
      add("radius", () => {
        const t = this.item(id) as TreeItem | null;
        if (!t) return null;
        const r = t.radius * (t.width ?? 1);
        return new THREE.Vector3(t.x + r, this.h(t.x + r, t.y) + 0.2, t.y);
      }, e => this.planeDrag(e, id, (p, t) => ({ radius: Math.max(2, Math.hypot(p.x - t.x, p.y - t.y) / ((t as TreeItem).width ?? 1)) })), { title: "Drag to resize the crown" });
    } else if (sel.type === "mando" || sel.type === "tee" || sel.type === "amenity") {
      const id = sel.id;
      const reach = sel.type === "tee" ? sel.padLength / 2 + 6 : 14;
      add("rotate", () => {
        const it = this.item(id);
        if (!it) return null;
        const a = (it.type === "tee" ? teeAim(this.doc!.course, it) : it.rotation) * DEG;
        // (On a touch screen, where handles are bigger, never on top of the thing itself when
        // zoomed out: a little way off on screen)
        const r = COARSE ? Math.max(reach, 40 * this.upp(new THREE.Vector3(it.x, this.h(it.x, it.y), it.y))) : reach;
        const x = it.x + Math.cos(a) * r, y = it.y + Math.sin(a) * r;
        return new THREE.Vector3(x, this.h(x, y) + 0.3, y);
      }, e => this.planeDrag(e, id, (p, it, ev) => {
        let deg = (Math.atan2(p.y - it.y, p.x - it.x) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((deg % 360) + 360) % 360;
        return it.type === "tee" ? { rotation: deg, aimFixed: true } : { rotation: deg };
      }), { title: sel.type === "mando" ? "Drag to turn the arrow · Shift snaps to 15°" : "Drag to turn it · Shift snaps to 15°" });
      // (a tee's pad: its length from its back edge, its width from its side, drawn as it is)
      if (sel.type === "tee") {
        const axes = (t: TeeItem) => { const a = teeAim(this.doc!.course, t) * DEG; return { f: { x: Math.cos(a), y: Math.sin(a) }, s: { x: -Math.sin(a), y: Math.cos(a) } }; };
        const at = (t: TeeItem, v: P, d: number) => { const x = t.x + v.x * d, y = t.y + v.y * d; return new THREE.Vector3(x, this.h(x, y) + 0.3, y); };
        add("radius", () => { const t = this.item(id) as TeeItem | null; return t ? at(t, axes(t).f, -t.padLength / 2) : null; },
          e => this.planeDrag(e, id, (p, it) => { const t = it as TeeItem, f = axes(t).f; return { padLength: Math.max(4, Math.min(30, Math.round(Math.abs((p.x - t.x) * f.x + (p.y - t.y) * f.y) * 4) / 2)) }; }),
          { title: "Drag to make the pad longer or shorter" });
        add("radius", () => { const t = this.item(id) as TeeItem | null; return t ? at(t, axes(t).s, t.padWidth / 2) : null; },
          e => this.planeDrag(e, id, (p, it) => { const t = it as TeeItem, sv = axes(t).s; return { padWidth: Math.max(2, Math.min(20, Math.round(Math.abs((p.x - t.x) * sv.x + (p.y - t.y) * sv.y) * 4) / 2)) }; }),
          { title: "Drag to make the pad wider or narrower" });
      }
    }
  }

  /** A ball field's home plate: dragged to where it really is, the field turning to face the middle
   * of its outline from there. */
  private plateHandle(id: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    // (laid out again only when the field changes, not every frame)
    let seen: AreaItem | null = null, at: P | null = null;
    add("plate", () => {
      const a = this.item(id) as AreaItem | null;
      if (!a || a.type !== "area") return null;
      if (a !== seen) { seen = a; at = fieldPlan(a)?.home ?? null; }
      return at ? new THREE.Vector3(at.x, this.h(at.x, at.y) + 0.3, at.y) : null;
    }, e => this.planeDrag(e, id, (p, it) => {
      const a = it as AreaItem, hi = fieldHome(a), { corner, f, right } = cornerFrame(a.points, hi);
      const dx = p.x - corner.x, dy = p.y - corner.y;
      return { home: hi, plate: { x: Math.round((dx * f.x + dy * f.y) * 10) / 10, y: Math.round((dx * right.x + dy * right.y) * 10) / 10 } };
    }), { title: "Drag home plate to where it is · the field turns to follow" });
  }

  /** A ball field's part picked, dragged where it really is along the field's middle line: the mound
   * (home to the rubber), the infield's edge (its reach from the rubber), second base (the bases
   * apart), and the backstop (behind home) once home plate is placed by hand (till then home sits
   * in from the corner by the backstop's distance: the backstop would stay and home move); a tip
   * says the distance. */
  private partHandle(id: string, part: FieldPart, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    // (from home along the way it faces: `base` + d × `k` ft, behind home for the backstop)
    const spec = (a: AreaItem) => {
      const plan = fieldPlan(a), L = plan?.league ? LEAGUES[plan.league] : null;
      if (!plan?.home || !plan.facing || !L) return null;
      const d = (p: FieldPart, dflt: number) => a.parts?.[p]?.d ?? dflt;
      const pitch = d("mound", L.pitch);
      const s = part === "mound" ? { d: pitch, base: 0, k: 1, min: 30, max: 61, say: (v: number) => `${v} ft from home to the rubber` }
        : part === "backstop" && a.plate ? { d: d("backstop", L.backstop), base: 0, k: -1, min: 15, max: 70, say: (v: number) => `${v} ft behind home` }
        : part === "infield" ? { d: d("infield", L.arc), base: pitch, k: 1, min: 30, max: 130, say: (v: number) => `${v} ft from the rubber` }
        : part === "lines" ? { d: d("lines", L.bases), base: 0, k: Math.SQRT2, min: 40, max: 90, say: (v: number) => `Bases ${v} ft apart` }
        : null;
      return s ? { ...s, H: plan.home, f: plan.facing } : null;
    };
    let seen: AreaItem | null = null, at: P | null = null;
    add("part", () => {
      const a = this.item(id) as AreaItem | null;
      if (!a || a.type !== "area") return null;
      if (a !== seen) { seen = a; const s = spec(a); at = s ? { x: s.H.x + s.f.x * (s.base + s.d * s.k), y: s.H.y + s.f.y * (s.base + s.d * s.k) } : null; }
      return at ? new THREE.Vector3(at.x, this.h(at.x, at.y) + 0.4, at.y) : null;
    }, e => {
      // (measured from where home was as the drag began: a ball field's plate sits in from its
      // corner by the backstop's distance, so it moves as the backstop does)
      const a0 = this.item(id) as AreaItem | null, s = a0 ? spec(a0) : null;
      if (!s) return null;
      const drag = this.planeDrag(e, id, (p, it, ev) => {
        const a = it as AreaItem;
        const along = (p.x - s.H.x) * s.f.x + (p.y - s.H.y) * s.f.y;
        const v = clamp(Math.round(((along - s.base) / s.k) * 2) / 2, s.min, s.max);
        this.tip(s.say(v), ev.clientX, ev.clientY);
        return { parts: { ...a.parts, [part]: { ...a.parts?.[part], d: v } } };
      });
      return drag && { move: drag.move, end: ev => { this.tip(null); drag.end(ev); } };
    }, { title: "Drag it to where it really is" });
  }

  /** In 3D, a handle at the top of a tree, a fence, a hedge, a power line's wires or a wall: dragged
   * up or down, it sets the height (a tip says it). Buildings, shelters and decks have their own
   * (see outlineHandles), the same to look at. */
  private heightHandle(sel: CourseItem, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const spec = (it: CourseItem | null) => {
      if (!it) return null;
      if (it.type === "tree") {
        const h = it.height ?? it.radius * 2.6;
        return { at: { x: it.x, y: it.y }, h, min: 2, max: Math.max(120, Math.round(h)), patch: (v: number) => ({ height: v, radius: Math.max(1, Math.min(45, Math.round(it.radius * (v / h) * 10) / 10)) }) };
      }
      if (it.type === "structure" && isLineKind(it.kind) && STRUCTURE_KINDS[it.kind].heightLabel) {
        const meta = STRUCTURE_KINDS[it.kind], h = structureHeight(it), c = centroid(it.points);
        return { at: c, h, min: meta.heights[0], max: Math.max(meta.heights[1], h), patch: (v: number) => ({ height: v }) };
      }
      if (it.type === "line" && LINE_KINDS[it.kind].heights) {
        const meta = LINE_KINDS[it.kind], h = it.fenceHeight ?? meta.height!, pts = linePath(it);
        return { at: pts[Math.floor(pts.length / 2)] ?? it.points[0], h, min: meta.heights![0], max: meta.heights![1], patch: (v: number) => ({ fenceHeight: v }) };
      }
      return null;
    };
    if (!spec(sel)) return;
    const itemId = sel.id;
    add("height", () => {
      // (only in 3D: from straight above, a height has no up or down to drag)
      if (this.controls.polarAngle < 25 * DEG) return null;
      const s = spec(this.item(itemId));
      return s ? new THREE.Vector3(s.at.x, this.h(s.at.x, s.at.y) + s.h, s.at.y) : null;
    }, () => {
      const s0 = spec(this.item(itemId));
      if (!s0) return null;
      const base = this.h(s0.at.x, s0.at.y);
      const metric = this.doc?.course.units === "m";
      return {
        move: ev => {
          // (on an upright plane through it, facing the camera)
          const dir = new THREE.Vector3();
          this.camera.getWorldDirection(dir);
          dir.y = 0;
          if (dir.lengthSq() < 1e-6) return;
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir.normalize(), new THREE.Vector3(s0.at.x, base, s0.at.y));
          const hit = this.ray(ev.clientX, ev.clientY).intersectPlane(plane, new THREE.Vector3());
          const s = spec(this.item(itemId));
          if (!hit || !s) return;
          const v = clamp(Math.round((hit.y - base) * 2) / 2, s.min, s.max);
          this.cb.onChange(itemId, s.patch(v));
          this.tip(`${metric ? Math.round(v * 0.3048 * 10) / 10 : v} ${metric ? "m" : "ft"} tall`, ev.clientX, ev.clientY);
        },
        end: () => { this.tip(null); this.cb.onCommit(); }
      };
    }, { title: "Drag up or down to change its height" });
  }

  /** A hole's doglegs: drag a dot to move a turn, pull a mid dot to add one, double-click to remove one; and a square for the fairway width. */
  private holeHandles(holeId: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const stats = () => this.doc?.stats.find(s => s.holeId === holeId) ?? null;
    const hole = () => this.hole(holeId);
    const at = (p: P) => new THREE.Vector3(p.x, this.h(p.x, p.y) + 0.3, p.y);
    const h0 = hole();
    const s0 = stats();
    if (!h0 || !s0?.complete) return;
    const dragPoint = (index: number, start: P[]): Drag => {
      const pts = start.map(p => ({ ...p }));
      const y = this.h(pts[index].x, pts[index].y);
      return {
        move: ev => {
          const hit = this.planeAt(ev.clientX, ev.clientY, y);
          if (!hit) return;
          pts[index] = { x: hit.x, y: hit.z };
          this.cb.onHoleChange(holeId, { doglegs: pts.map(p => ({ ...p })) });
        },
        end: () => this.cb.onCommit()
      };
    };
    h0.doglegs.forEach((_, i) => {
      add("dogleg", () => { const p = hole()?.doglegs[i]; return p ? at(p) : null; }, e => {
        const h = hole();
        if (!h) return null;
        const now = performance.now();
        const last = this.lastCorner;
        this.lastCorner = { id: holeId, index: i, time: now };
        if (e.altKey || (last && last.id === holeId && last.index === i && now - last.time < 400)) {
          this.lastCorner = null;
          this.cb.onHoleChange(holeId, { doglegs: h.doglegs.filter((_, k) => k !== i) });
          this.cb.onCommit();
          return null;
        }
        return dragPoint(i, h.doglegs);
      }, { index: i, title: "Drag to move this turn · double-click to remove it" });
    });
    // The walks on to the next tee and in from the hole before (while the hole is selected): where
    // each starts and ends, to drag (double-click: back where it goes by itself)
    if (this.selectedId === holeId && this.doc?.course.style.nextTee) {
      const walks = () => (this.doc ? autoWalks(this.doc.course.items, this.doc.stats, this.doc.course.holes) : []);
      const end = (which: "out" | "in") => {
        const w = walks().find(x => (which === "out" ? x.a.holeId : x.b.holeId) === holeId);
        return w ? { at: which === "out" ? w.from : w.to, anchor: which === "out" ? w.basket : w.tee } : null;
      };
      for (const which of ["out", "in"] as const) {
        if (!end(which)) continue;
        const reset = () => {
          this.cb.onHoleChange(holeId, which === "out" ? { walkOut: undefined } : { walkIn: undefined });
          this.cb.onCommit();
        };
        const moved = () => { const h = hole(); return !!(which === "out" ? h?.walkOut : h?.walkIn); };
        add(which === "out" ? "walkout" : "walkin", () => { const e = end(which); return e ? at(e.at) : null; }, () => {
          const e0 = end(which);
          if (!e0) return null;
          const now = performance.now();
          const key = `${holeId}:${which}`;
          if (this.lastWalkTap && this.lastWalkTap.key === key && now - this.lastWalkTap.time < 400) {
            this.lastWalkTap = null;
            reset();
            return null;
          }
          this.lastWalkTap = { key, time: now };
          const y = this.h(e0.at.x, e0.at.y);
          const r1 = (v: number) => Math.round(v * 10) / 10;
          return {
            move: ev => {
              const hit = this.planeAt(ev.clientX, ev.clientY, y);
              if (!hit) return;
              const off = { x: r1(hit.x - e0.anchor.x), y: r1(hit.z - e0.anchor.y) };
              this.cb.onHoleChange(holeId, which === "out" ? { walkOut: off } : { walkIn: off });
            },
            end: () => this.cb.onCommit()
          };
        }, {
          title: which === "out" ? "Drag to move where the walk to the next tee starts · double-click to reset it" : "Drag to move where the walk from the hole before ends · double-click to reset it",
          tap: (h: Handle) => this.handleButton(h, "reset-walk", "Reset walk", moved(), () => { if (moved()) reset(); })
        });
      }
    }
    // A hand-made flyover (while the hole is selected): each keyframe's camera spot (numbered) and
    // what it looks at, to drag
    const keys = h0.flyKeys;
    if (keys && keys.length >= 2 && this.selectedId === holeId) {
      const dragKey = (index: number, look: boolean): Drag | null => {
        const list = hole()?.flyKeys?.map(k => ({ ...k }));
        const k0 = list?.[index];
        if (!list || !k0) return null;
        const y = look ? this.h(k0.lookX, k0.lookY) : this.h(k0.x, k0.y);
        const r1 = (v: number) => Math.round(v * 10) / 10;
        return {
          move: ev => {
            const hit = this.planeAt(ev.clientX, ev.clientY, y);
            if (!hit) return;
            list[index] = look ? { ...list[index], lookX: r1(hit.x), lookY: r1(hit.z) } : { ...list[index], x: r1(hit.x), y: r1(hit.z) };
            this.cb.onHoleChange(holeId, { flyKeys: list.map(k => ({ ...k })) });
          },
          end: () => this.cb.onCommit()
        };
      };
      // In 3D each keyframe's camera floats at its height: drag it up or down for the height, and
      // the dot on the ground under it to move it. Seen from straight above, the camera moves.
      const tilted = () => this.controls.polarAngle > 15 * DEG;
      const dragHeight = (index: number): Drag | null => {
        const list = hole()?.flyKeys?.map(k => ({ ...k }));
        const k0 = list?.[index];
        if (!list || !k0) return null;
        const ground = this.h(k0.x, k0.y), foot = new THREE.Vector3(k0.x, ground, k0.y);
        const facing = new THREE.Vector3().subVectors(this.camera.position, foot).setY(0);
        if (facing.lengthSq() < 1e-6) return null;
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize(), foot);
        return {
          move: ev => {
            const hit = new THREE.Vector3();
            if (!this.ray(ev.clientX, ev.clientY).intersectPlane(plane, hit)) return;
            list[index] = { ...list[index], alt: Math.round(clamp(hit.y - ground, 2, 1000)) };
            this.cb.onHoleChange(holeId, { flyKeys: list.map(k => ({ ...k })) });
          },
          end: () => this.cb.onCommit()
        };
      };
      // (taking hold of any of a keyframe's handles picks it; a camera taken hold of twice quickly,
      // a double-click or double-tap, is looked through)
      const picked = (i: number, d: Drag | null, cam = false) => {
        const now = performance.now(), last = this.keyTap;
        this.keyTap = cam ? { i, t: now } : null;
        if (cam && last && last.i === i && now - last.t < 400) {
          this.keyTap = null;
          this.cb.onFlyCam?.(i);
          return null;
        }
        this.cb.onFlyKey?.(i);
        return d;
      };
      // (a finger's tap does what taking hold of it does: picks it, looks through it, adds one)
      const tap = (h: Handle, e: PointerEvent) => { h.start(e); };
      keys.forEach((_, i) => {
        add("flylook", () => { const k = hole()?.flyKeys?.[i]; return k ? at({ x: k.lookX, y: k.lookY }) : null; }, () => picked(i, dragKey(i, true)), { index: i, title: `Drag to move where keyframe ${i + 1} looks`, tap });
        add("flyfoot", () => { const k = hole()?.flyKeys?.[i]; return k ? at(k) : null; }, () => picked(i, dragKey(i, false)), { index: i, title: `Drag to move keyframe ${i + 1}`, visible: tilted, tap });
        add("flykey", () => { const k = hole()?.flyKeys?.[i]; return k ? (tilted() ? new THREE.Vector3(k.x, this.h(k.x, k.y) + k.alt, k.y) : at(k)) : null; }, () => picked(i, tilted() ? dragHeight(i) : dragKey(i, false), true), { index: i, title: `Drag to move keyframe ${i + 1} (in 3D: up or down for its height) · double-click to look through it`, data: { n: String(i + 1) }, tap });
      });
      // A + halfway (in time) between each two: a click adds a keyframe there, right where the
      // flight already goes
      for (let i = 0; i + 1 < keys.length; i++) {
        add("flyadd", () => {
          const p = this.flyMids(holeId)[i];
          return p ? (tilted() ? p.clone() : at({ x: p.x, y: p.z })) : null;
        }, () => {
          const doc = this.doc, h = hole();
          if (!doc || !h?.flyKeys) return null;
          const r = insertKey(h.flyKeys, i, flyoverOf(doc.course, h), (x, y) => this.h(x, y));
          this.cb.onHoleChange(holeId, { flyKeys: r.keys });
          this.cb.onCommit();
          this.cb.onFlyKey?.(r.at);
          return null;
        }, { index: i, title: "Click to add a keyframe here", tap });
      }
    }
    // Mid dots between each pair of line points: pulling one adds a turn there
    const n = s0.line.length;
    for (let i = 0; i + 1 < n; i++) {
      add("mid", () => {
        const s = stats();
        if (!s || s.line.length !== n) return null;
        const a = s.line[i], b = s.line[i + 1];
        return at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }, () => {
        const s = stats(), h = hole();
        if (!s || !h) return null;
        const a = s.line[i], b = s.line[i + 1];
        const doglegs = [...h.doglegs];
        // Line point i+1 is dogleg i (point 0 is the tee)
        doglegs.splice(i, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        this.cb.onHoleChange(holeId, { doglegs });
        return dragPoint(i, doglegs);
      }, {
        index: i,
        title: "Drag to bend the hole here",
        data: { kind: "line" },
        visible: () => {
          const s = stats();
          if (!s || s.line.length !== n) return false;
          const a = this.project(at(s.line[i])), b = this.project(at(s.line[i + 1]));
          return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) > 36;
        }
      });
    }
    // Fairway width: squares on both edges at points along the hole (to start with: just off the
    // tee, the landing zones, round the basket); each moves its own edge (Shift: both), blending
    // smoothly into the rest; a + between them adds a point there, a double-click takes one out
    const along = (t: number, flip: 1 | -1) => {
      const s = stats();
      if (!s || s.line.length < 2) return null;
      const line = smoothPath(s.line, 10);
      const { point, angle } = pointAlong(line, pathLength(line) * t);
      return { point, n: { x: -Math.sin(angle) * flip, y: Math.cos(angle) * flip } };
    };
    // (this side's edge: the middle, moved off the line maybe, plus half the width)
    const edgeAt = (h: Hole, t: number, flip: 1 | -1) => {
      const sd = along(t, flip);
      if (!sd || !h.fairway) return null;
      const e = fairwayShiftAt(h)(t) * flip + fairwayWidthAt(h)(t) / 2;
      return at({ x: sd.point.x + sd.n.x * e, y: sd.point.y + sd.n.y * e });
    };
    const widthDrag = (index: number, t: number, flip: 1 | -1, h0: Hole): Drag | null => {
      const sd = along(t, flip);
      if (!sd) return null;
      const y = this.h(sd.point.x, sd.point.y);
      // (across the hole, toward this side: the middle and the far edge when picked up)
      const mid0 = fairwayShiftAt(h0)(t) * flip, far0 = mid0 - fairwayWidthAt(h0)(t) / 2;
      return {
        move: ev => {
          const h = hole();
          const hit = this.planeAt(ev.clientX, ev.clientY, y);
          if (!hit || !h) return;
          const d = (hit.x - sd.point.x) * sd.n.x + (hit.z - sd.point.y) * sd.n.y;
          // This side only (the other edge stays), or both sides alike with Shift
          const w = ev.shiftKey ? clamp(2 * Math.abs(d - mid0), 8, 300) : clamp(d - far0, 8, 300);
          const mid = ev.shiftKey ? mid0 : far0 + w / 2;
          const S = stationsOf(h);
          const shape = h.fairwayShape?.length === S.length ? [...h.fairwayShape] : S.map(() => 1);
          const shift = h.fairwayShift?.length === S.length ? [...h.fairwayShift] : S.map(() => 0);
          shape[index] = Math.round((w / h.fairwayWidth) * 100) / 100;
          shift[index] = Math.round(((mid * flip) / h.fairwayWidth) * 100) / 100;
          this.cb.onHoleChange(holeId, { fairwayShape: shape, fairwayShift: shift.some(v => v !== 0) ? shift : undefined });
        },
        end: () => this.cb.onCommit()
      };
    };
    // Only where it stands clear of the tee, the basket and the hole's distance label on screen
    // (a short hole seen from far, or a touch screen's bigger handles: a square on the tee would
    // take the tee's taps and its long-press menu, one on the label would hide it)
    const clear = (p: THREE.Vector3 | null) => {
      const s = stats();
      const me = p && this.project(p);
      if (!s || !me || s.line.length < 2) return false;
      const room = COARSE ? 44 : 24;
      const chip = this.overlays.get(`dist:${holeId}`);
      const c = chip && chip.el.style.display !== "none" && chip.w && chip.h ? this.project(chip.anchor) : null;
      // (the square on the label: within the label's box grown by the square's own half size)
      const half = COARSE ? 11 : 6;
      if (c && Math.abs(me.x - c.x) < chip!.w! / 2 + half && Math.abs(me.y - c.y - chip!.dy) < chip!.h! / 2 + half) return false;
      return [s.line[0], s.line[s.line.length - 1]].every(q => {
        const e = this.project(at(q));
        return !!e && Math.hypot(e.x - me.x, e.y - me.y) >= room;
      });
    };
    const h1 = hole();
    const S0 = h1 ? stationsOf(h1) : FAIRWAY_STATIONS;
    S0.forEach((_, i) => {
      for (const flip of [1, -1] as const) {
        const tOf = () => { const h = hole(); return h ? stationsOf(h)[i] : undefined; };
        const pos = () => { const h = hole(), t = tOf(); return h && t !== undefined ? edgeAt(h, t, flip) : null; };
        add("width", pos, e => {
          const h0 = hole(), t = tOf();
          if (!h0 || t === undefined) return null;
          // (a double-click takes the point out)
          const now = performance.now(), last = this.lastCorner;
          this.lastCorner = { id: `${holeId}:w`, index: i, time: now };
          if (e.altKey || (last && last.id === `${holeId}:w` && last.index === i && now - last.time < 400)) {
            this.lastCorner = null;
            this.cb.onHoleChange(holeId, withoutStation(h0, i));
            this.cb.onCommit();
            return null;
          }
          return widthDrag(i, t, flip, h0);
        }, {
          index: i * 2 + (flip === 1 ? 0 : 1),
          title: "Drag to make this side wider or narrower · Shift-drag for both sides · double-click to remove the point",
          data: { station: String(i), side: String(flip) },
          visible: () => clear(pos()),
          tap: (h: Handle) => this.handleButton(h, "remove-width-point", "Remove point", true, () => {
            const h0 = hole();
            if (h0 && tOf() !== undefined) { this.cb.onHoleChange(holeId, withoutStation(h0, i)); this.cb.onCommit(); }
          })
        });
      }
    });
    // (between the points, and between them and the tee and the basket)
    const gaps = [0, ...S0, 1];
    for (let g = 0; g + 1 < gaps.length; g++) {
      for (const flip of [1, -1] as const) {
        const mid = () => {
          const h = hole();
          if (!h) return null;
          const S = [0, ...stationsOf(h), 1];
          return S.length === gaps.length ? (S[g] + S[g + 1]) / 2 : null;
        };
        const pos = () => { const h = hole(), t = mid(); return h && t !== null ? edgeAt(h, t, flip) : null; };
        add("widen", pos, () => {
          const h0 = hole(), t = mid();
          if (!h0 || t === null) return null;
          const { index, patch } = withStation(h0, t);
          this.cb.onHoleChange(holeId, patch);
          return widthDrag(index, t, flip, { ...h0, ...patch });
        }, {
          index: g * 2 + (flip === 1 ? 0 : 1),
          title: "Drag to make the fairway wider or narrower here",
          data: { side: String(flip) },
          visible: () => {
            const h = hole(), t = mid();
            if (!h || t === null) return false;
            const S = [0, ...stationsOf(h), 1];
            const a = edgeAt(h, S[g], flip), b = edgeAt(h, S[g + 1], flip), me = pos();
            const pa = a && this.project(a), pb = b && this.project(b);
            return !!pa && !!pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) > 70 && clear(me);
          }
        });
      }
    }
  }

  /** An area's corners or a line's points: drag to move, double-click to remove, pull a mid dot to add one. */
  private pointHandles(id: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const it = () => this.item(id) as AreaItem | LineItem | StructureItem | null;
    const at = (p: P) => new THREE.Vector3(p.x, this.h(p.x, p.y) + 0.3, p.y);
    const first = it();
    if (!first) return;
    const closed = first.type === "area" || (first.type === "structure" && !isLineKind(first.kind));
    const min = closed ? 3 : 2;
    const drag = (index: number, start: P[]): Drag => {
      const pts = start.map(p => ({ ...p }));
      const y = this.h(pts[index].x, pts[index].y);
      return {
        move: ev => {
          const hit = this.planeAt(ev.clientX, ev.clientY, y);
          if (!hit) return;
          pts[index] = { x: hit.x, y: hit.z };
          this.cb.onChange(id, { points: pts.map(p => ({ ...p })) });
        },
        end: () => this.cb.onCommit()
      };
    };
    const n = first.points.length;
    // (on a touch screen, a corner closer than 28 px on screen to the last one shown is left out,
    // so a woods' many corners aren't a wall of dots; zoomed in, they all show)
    let shownAt: { x: number; y: number } | null = null, firstAt: { x: number; y: number } | null = null;
    const spaced = (i: number) => {
      const p = it()?.points[i], s = p ? this.project(at(p)) : null;
      if (i === 0) shownAt = firstAt = s;
      else if (!s || (shownAt && Math.hypot(s.x - shownAt.x, s.y - shownAt.y) < 28) || (closed && i === n - 1 && firstAt && Math.hypot(s.x - firstAt.x, s.y - firstAt.y) < 28)) return false;
      else shownAt = s;
      return !!s;
    };
    for (let i = 0; i < n; i++) {
      add("corner", () => { const p = it()?.points[i]; return p ? at(p) : null; }, e => {
        const cur = it();
        if (!cur) return null;
        const now = performance.now();
        const last = this.lastCorner;
        this.lastCorner = { id, index: i, time: now };
        // (the corner picked: where you stand can take it, Move this corner here)
        window.dispatchEvent(new CustomEvent(CORNER_EVENT, { detail: { id, index: i } }));
        if (e.altKey || (last && last.id === id && last.index === i && now - last.time < 400)) {
          this.lastCorner = null;
          if (cur.points.length > min) {
            this.cb.onChange(id, { points: cur.points.filter((_, k) => k !== i), ...(cur.type === "line" ? { widths: widthsWithout(cur, i) } : {}) });
            this.cb.onCommit();
          } else toast(`Needs at least ${min} points.`, "info");
          return null;
        }
        return drag(i, cur.points);
      }, { index: i, title: "Drag to move this point · double-click to remove it", visible: COARSE ? () => spaced(i) : undefined });
      if (!closed && i + 1 >= n) continue;
      add("mid", () => {
        const pts = it()?.points;
        if (!pts || pts.length !== n) return null;
        const a = pts[i], b = pts[(i + 1) % n];
        return at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }, () => {
        const cur = it();
        if (!cur) return null;
        const a = cur.points[i], b = cur.points[(i + 1) % cur.points.length];
        const next = [...cur.points.slice(0, i + 1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...cur.points.slice(i + 1)];
        this.cb.onChange(id, { points: next, ...(cur.type === "line" ? { widths: widthsWithPoint(cur, i) } : {}) });
        return drag(i + 1, next);
      }, {
        index: i,
        title: "Drag to add a point here",
        visible: () => {
          const pts = it()?.points;
          if (!pts || pts.length !== n) return false;
          const a = this.project(at(pts[i])), b = this.project(at(pts[(i + 1) % n]));
          return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) > 40;
        }
      });
    }
    // A line goes on from either end: pull the + beyond an end for another point there
    if (closed) return;
    for (const end of [0, 1] as const) {
      const spot = () => {
        const pts = it()?.points;
        if (!pts || pts.length < 2) return null;
        const a = end ? pts[pts.length - 1] : pts[0], b = end ? pts[pts.length - 2] : pts[1];
        const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const reach = Math.max(4, 26 * this.upp(at(a)));
        return { x: a.x + ((a.x - b.x) / len) * reach, y: a.y + ((a.y - b.y) / len) * reach };
      };
      add("extend", () => { const p = spot(); return p ? at(p) : null; }, () => {
        const cur = it(), p = spot();
        if (!cur || !p) return null;
        const next = end ? [...cur.points, p] : [p, ...cur.points];
        this.cb.onChange(id, { points: next, ...(cur.type === "line" ? { widths: widthsWithEnd(cur, end) } : {}) });
        return drag(end ? next.length - 1 : 0, next);
      }, { index: end, title: "Drag to make it longer" });
    }
  }

  /** A stream's width at each of its points: a square on either bank, dragged out or in (the rest of
   * it keeps its width); double-click (a finger: Reset width): back to the stream's width. */
  private lineWidthHandles(id: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const it = () => this.item(id) as LineItem | null;
    const first = it();
    if (!first || first.points.length < 2) return;
    const n = first.points.length;
    // (across the line at point i, from the points either side of it)
    const across = (pts: P[], i: number) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    };
    const base = (l: LineItem) => l.width ?? LINE_KINDS[l.kind].width;
    // (point i back to the stream's own width)
    const reset = (l: LineItem, i: number) => {
      const f = widthFactors(l).map((v, k) => (k === i ? 1 : v));
      this.cb.onChange(id, { widths: widthVaries({ kind: "stream", points: l.points, widths: f }) ? f : undefined });
      this.cb.onCommit();
    };
    for (let i = 0; i < n; i++) {
      for (const side of [1, -1] as const) {
        // (on the bank, or clear of the point's own handle on a narrow creek)
        const pos = () => {
          const l = it();
          if (!l || l.points.length !== n) return null;
          const p = l.points[i], nm = across(l.points, i), y = this.h(p.x, p.y);
          const half = Math.max((base(l) * widthFactors(l)[i]) / 2, 16 * this.upp(new THREE.Vector3(p.x, y, p.y)));
          const q = { x: p.x + nm.x * half * side, y: p.y + nm.y * half * side };
          return new THREE.Vector3(q.x, this.h(q.x, q.y) + 0.3, q.y);
        };
        add("linewidth", pos, e => {
          const l0 = it();
          if (!l0 || l0.points.length !== n) return null;
          const now = performance.now(), last = this.lastCorner;
          this.lastCorner = { id: `${id}:lw`, index: i, time: now };
          if (e.altKey || (last && last.id === `${id}:lw` && last.index === i && now - last.time < 400)) {
            this.lastCorner = null;
            reset(l0, i);
            return null;
          }
          const p = l0.points[i], nm = across(l0.points, i), w0 = base(l0);
          const y = this.h(p.x, p.y);
          // (by how far it is pulled out or in from where it was taken)
          const out = (x: number, z: number) => ((x - p.x) * nm.x + (z - p.y) * nm.y) * side;
          const g0 = this.planeAt(e.clientX, e.clientY, y);
          if (!g0) return null;
          const from = out(g0.x, g0.z), half0 = (w0 * widthFactors(l0)[i]) / 2;
          return {
            move: ev => {
              const hit = this.planeAt(ev.clientX, ev.clientY, y);
              if (!hit || w0 <= 0) return;
              const half = Math.max(0.5, half0 + out(hit.x, hit.z) - from);
              const f = widthFactors(it() ?? l0).slice();
              f[i] = Math.round((2 * half / w0) * 100) / 100;
              this.cb.onChange(id, { widths: widthVaries({ kind: "stream", points: l0.points, widths: f }) ? f : undefined });
            },
            end: () => this.cb.onCommit()
          };
        }, {
          index: i * 2 + (side === 1 ? 0 : 1),
          title: "Drag to make the stream wider or narrower here · double-click to reset it",
          data: { point: String(i), side: String(side) },
          tap: (h: Handle) => {
            const l = it(), can = !!l && l.points.length === n && widthFactors(l)[i] !== 1;
            this.handleButton(h, "reset-width", "Reset width", can, () => { const l1 = it(); if (l1 && l1.points.length === n) reset(l1, i); });
          }
        });
      }
    }
  }

  /** The ends of a line's OB stretches: each dragged along the line (a stretch dragged to nothing
   * goes). */
  private obStretchHandles(id: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const it = () => this.item(id) as LineItem | AreaItem | null;
    const first = it();
    if (!first?.obStretches) return;
    const at = (l: LineItem | AreaItem, t: number) => {
      const pts = this.obPath(l);
      return pointAlong(pts, t * pathLength(pts)).point;
    };
    first.obStretches.forEach((_, k) => {
      for (const end of [0, 1] as const) {
        add("obend", () => {
          const l = it(), st = l?.obStretches?.[k];
          if (!l || !st) return null;
          const p = at(l, st[end]);
          return new THREE.Vector3(p.x, this.h(p.x, p.y) + 0.3, p.y);
        }, () => {
          const l0 = it();
          if (!l0?.obStretches?.[k]) return null;
          return {
            move: ev => {
              const l = it(), g = this.groundAt(ev.clientX, ev.clientY);
              if (!l?.obStretches?.[k] || !g) return;
              const t = nearestAlong(this.obPath(l), { x: g.x, y: g.z }).t;
              this.cb.onChange(id, { obStretches: l.obStretches.map((st, j) => (j === k ? (end ? [st[0], t] : [t, st[1]]) : st)) });
            },
            end: () => {
              const l = it();
              if (l?.obStretches) {
                const kept = mergeStretches(l.obStretches);
                this.cb.onChange(id, kept.length ? { obStretches: kept } : { obStretches: undefined, ob: undefined });
              }
              this.cb.onCommit();
            }
          };
        }, { index: k * 2 + end, title: "Drag to move this end of the OB stretch", data: { stretch: String(k), end: String(end) } });
      }
    });
  }

  /** Mark a stretch of OB along a line (a road, a path...), or (`cut`) a stretch to take out of it:
   * click where it starts, then where it ends. */
  setObPick(id: string | null, cut = false) {
    if (id && this.readOnly) return;
    if ((this.obPick?.id ?? null) === id && (this.obPick?.cut ?? false) === cut) return;
    this.obPick = id ? { id, from: null, cut } : null;
    this.onObPick?.({ started: false, missed: false });
    this.syncHandles();
    this.updateCursor();
    this.invalidate();
  }

  /** Mark a stretch of OB along a line starting at a spot on it (from its right-click menu): then
   * a click where it ends. */
  startObPick(id: string, from: P, cut = false) {
    const l = this.item(id) as LineItem | AreaItem | null;
    if ((l?.type !== "line" && l?.type !== "area") || this.readOnly) return;
    this.obPick = { id, from: nearestAlong(this.obPath(l), from).t, cut: cut && l.type === "line" };
    this.obTravel = { sum: 0, last: this.obPick.from ?? 0 };
    this.onObPick?.({ started: true, missed: false });
    this.syncHandles();
    this.updateCursor();
    this.invalidate();
  }

  /** Whether the stretch of OB being marked has its start (and waits for its end). */
  obPickStarted() {
    return !!this.obPick && this.obPick.from !== null;
  }

  /** A click while marking a stretch of OB: on the line, its start, then its end (then done). */
  private obPickClick(p: P) {
    const pick = this.obPick, l = pick ? (this.item(pick.id) as LineItem | AreaItem | null) : null;
    if (!pick || (l?.type !== "line" && l?.type !== "area")) return this.endObPick();
    const pts = this.obPath(l), near = nearestAlong(pts, p);
    // (near the line or the edge: within its width, a few steps, or a few pixels of it)
    const reach = Math.max((l.type === "line" ? (l.width ?? LINE_KINDS[l.kind].width) / 2 : 0) + 12, 20 * this.upp(new THREE.Vector3(p.x, this.h(p.x, p.y), p.y)));
    if (near.distance > reach) { this.onObPick?.({ started: pick.from !== null, missed: true }); return; }
    if (pick.from === null) {
      this.obPick = { ...pick, from: near.t };
      this.obTravel = { sum: 0, last: near.t };
      this.onObPick?.({ started: true, missed: false });
      this.syncHandles();
      this.invalidate();
      return;
    }
    if (Math.abs(near.t - pick.from) * pathLength(pts) < 2) return;
    // Round a ring: the way the pointer went round from the start (a finger: the shorter way)
    const ring = isRing(pts);
    const added: [number, number][] = ring ? ringStretch(pick.from, near.t, Math.abs(this.obTravel.sum) > 0.01 ? Math.sign(this.obTravel.sum) : 0) : [[pick.from, near.t]];
    if (pick.cut && l.type === "line") {
      this.endObPick();
      this.cb.onCutLine(l.id, pick.from, near.t);
      return;
    }
    // (only along its stretches from now: marked OB all along, it was OB everywhere)
    const had = l.ob === true ? l.obStretches ?? [] : [];
    this.cb.onChange(l.id, { ob: true, obStretches: mergeStretches([...had, ...added]) });
    this.cb.onCommit();
    this.endObPick();
  }

  /** What OB stretches run along: a line as drawn, or an area's edge all the way round. */
  private obPath(i: LineItem | AreaItem) {
    return i.type === "line" ? this.shapeOf(i).pts : areaRing({ ...i, straight: true, points: this.shapeOf(i).pts });
  }

  /** The stretch so far while marking one round a ring (from its start to the pointer, the way it went). */
  private obPickHover(p: P) {
    const pick = this.obPick, l = pick ? (this.item(pick.id) as LineItem | AreaItem | null) : null;
    if (this.obPreview) { this.fx.remove(this.obPreview); disposeObjectDeep(this.obPreview); this.obPreview = null; }
    if (!pick || pick.from === null || (l?.type !== "line" && l?.type !== "area")) return;
    const pts = this.obPath(l);
    const t = nearestAlong(pts, p).t;
    let d = t - this.obTravel.last;
    const ring = isRing(pts);
    if (ring) d = ((d + 1.5) % 1) - 0.5;
    this.obTravel = { sum: this.obTravel.sum + d, last: t };
    const parts = ring ? ringStretch(pick.from, t, Math.abs(this.obTravel.sum) > 0.01 ? Math.sign(this.obTravel.sum) : 0) : [[Math.min(pick.from, t), Math.max(pick.from, t)] as [number, number]];
    const g = new THREE.Group();
    for (const [a, b] of parts) {
      const piece = subPath(pts, a, b);
      if (piece.length >= 2) g.add(this.fatLine(this.drapeLine(piece, LIFT + 0.4), pick.cut ? "#f8fafc" : "#ef4444", 4, { dashed: 6, depthTest: false, order: 29, opacity: 0.9 }));
    }
    this.obPreview = g;
    this.fx.add(g);
    this.invalidate();
  }

  private endObPick() {
    if (this.obPreview) { this.fx.remove(this.obPreview); disposeObjectDeep(this.obPreview); this.obPreview = null; }
    if (!this.obPick) return;
    this.obPick = null;
    this.syncHandles();
    this.updateCursor();
    this.cb.onObPickEnd();
    this.invalidate();
  }

  /** A drawn shape's round handle (an area, a line, anything built): turn it about its middle
   * (Shift: 15° steps). */
  private turnHandle(id: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const it = () => this.item(id) as AreaItem | LineItem | StructureItem | null;
    // (on a touch screen, on whichever side of it stays on the map: clear of the map's buttons on
    // the right, the bar above and the sheet below)
    const fits = (v: THREE.Vector3) => {
      const s = this.project(v), m = 24;
      return !!s && s.x >= m && s.x <= this.size.width - 64 - m && s.y >= this.topInset + m && s.y <= this.size.height - this.bottomInset - m;
    };
    add("rotate", () => {
      const st = it();
      if (!st || st.points.length < 2) return null;
      const box = orientedBox(st.points);
      const room = Math.max(6, 34 * this.upp(new THREE.Vector3(box.c.x, this.h(box.c.x, box.c.y), box.c.y)));
      const off = (dx: number, dy: number, half: number) => {
        const p = { x: box.c.x + dx * (half + room), y: box.c.y + dy * (half + room) };
        return new THREE.Vector3(p.x, this.h(p.x, p.y) + 0.3, p.y);
      };
      const first = off(-box.v.x, -box.v.y, box.b);
      if (!COARSE || fits(first)) return first;
      for (const [dx, dy, half] of [[box.v.x, box.v.y, box.b], [-box.u.x, -box.u.y, box.a], [box.u.x, box.u.y, box.a]]) {
        const p = off(dx, dy, half);
        if (fits(p)) return p;
      }
      return first;
    }, e => {
      const st0 = it();
      if (!st0 || st0.locked) return null;
      const c = orientedBox(st0.points).c;
      const y = this.h(c.x, c.y);
      const g0 = this.planeAt(e.clientX, e.clientY, y);
      if (!g0) return null;
      const a0 = Math.atan2(g0.z - c.y, g0.x - c.x);
      const start = st0.points.map(p => ({ ...p })), at0 = { x: st0.x, y: st0.y };
      return {
        move: ev => {
          const hit = this.planeAt(ev.clientX, ev.clientY, y);
          if (!hit) return;
          let d = Math.atan2(hit.z - c.y, hit.x - c.x) - a0;
          if (ev.shiftKey) d = Math.round(d / (15 * DEG)) * 15 * DEG;
          this.cb.onChange(id, turnShape(start, at0, d, c));
        },
        end: () => this.cb.onCommit()
      };
    }, { title: "Drag to turn it · Shift snaps to 15°" });
  }

  /** A building's, shelter's or deck's height handle (as in the Security Camera Planner), in the tilted view. */
  private outlineHandles(id: string, add: (kind: string, world: () => THREE.Vector3 | null, start: Handle["start"], opts?: any) => void) {
    const it = () => this.item(id) as StructureItem | null;
    add("height", () => {
      const st = it();
      if (!st || st.points.length < 3) return null;
      const c = orientedBox(st.points).c;
      return new THREE.Vector3(c.x, Math.max(...st.points.map(p => this.h(p.x, p.y))) + structureHeight(st), c.y);
    }, e => {
      const st0 = it();
      if (!st0 || st0.locked) return null;
      const c = orientedBox(st0.points).c;
      const base = Math.max(...st0.points.map(p => this.h(p.x, p.y)));
      // Up and down a wall through the middle, facing the camera
      const at = new THREE.Vector3(c.x, base, c.y);
      const facing = new THREE.Vector3().subVectors(this.camera.position, at).setY(0);
      if (facing.lengthSq() < 1e-6) return null;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize(), at);
      void e;
      const max = st0.kind === "building" ? 40 : st0.kind === "shelter" ? 20 : 10;
      return {
        move: ev => {
          const hit = new THREE.Vector3();
          if (!this.ray(ev.clientX, ev.clientY).intersectPlane(plane, hit)) return;
          this.cb.onChange(id, { height: Math.round(clamp(hit.y - base, st0.kind === "deck" ? 0.5 : 6, max) * 2) / 2 });
        },
        end: () => this.cb.onCommit()
      };
    }, { title: "Drag up or down for the height", visible: () => this.controls.polarAngle > 15 * DEG });
  }

  private planeDrag(e: PointerEvent, id: string, patch: (p: P, item: CourseItem, ev: PointerEvent) => Record<string, unknown> | null): Drag | null {
    const item = this.item(id);
    if (!item) return null;
    const planeY = this.h(item.x, item.y);
    void e;
    return {
      move: ev => {
        const cur = this.item(id);
        const hit = this.planeAt(ev.clientX, ev.clientY, planeY);
        if (!cur || !hit) return;
        const next = patch({ x: hit.x, y: hit.z }, cur, ev);
        if (next) this.cb.onChange(id, next);
      },
      end: () => this.cb.onCommit()
    };
  }

  // ------------------------------------------------------------------ per-frame layout of DOM bits

  private layoutOverlays() {
    const list = [...this.overlays.values()].sort((a, b) => a.rank - b.rank);
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const hits = (r: { x0: number; y0: number; x1: number; y1: number }) => taken.some(t => r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0);
    const doc = this.doc;
    const tilted = this.controls.polarAngle > 15 * DEG;
    // (the hole picked: the stumps on its fairway show however far out)
    const pickedHole = this.hole(this.selectedId), pickedStats = pickedHole && doc?.stats.find(x => x.holeId === pickedHole.id);
    const picked = pickedHole && pickedStats?.complete ? { line: pickedStats.line, half: pickedHole.fairwayWidth / 2 + 25 } : null;
    const focusHole = this.holeFor(this.selectedId) ?? this.holeFor(this.hoverId) ?? this.doc?.activeHoleId ?? null;
    for (const o of list) {
      const s = this.project(o.anchor);
      if (!s || s.x < -60 || s.y < -60 || s.x > this.size.width + 60 || s.y > this.size.height + 60 || (o.key?.startsWith("stump:") && !this.stumpShown(o, picked))) {
        o.el.style.display = "none";
        continue;
      }
      // In 3D, a basket close enough to see is itself (at its real size), not its badge
      if (tilted && o.key?.startsWith("basket:")) {
        const foot = o.anchor.clone().setY(o.anchor.y - 2), top = this.project(foot.clone().setY(foot.y + BASKET_FT)), low = this.project(foot);
        if (top && low && Math.hypot(top.x - low.x, top.y - low.y) >= BASKET_SEEN_PX) { o.el.style.display = "none"; continue; }
      }
      // In 3D, a hole's distance chip only for the hole picked or pointed at (they crowd the view)
      if (tilted && o.key?.startsWith("dist:") && o.key !== `dist:${focusHole}`) { o.el.style.display = "none"; continue; }
      // Distance chips only when their hole is long enough on screen
      if (o.minPx && doc) {
        const key = [...this.overlays.entries()].find(([, v]) => v === o)?.[0] ?? "";
        const st = doc.stats.find(x => key === `dist:${x.holeId}`);
        if (st) {
          const a = this.project(new THREE.Vector3(st.line[0].x, this.h(st.line[0].x, st.line[0].y), st.line[0].y));
          const end = st.line[st.line.length - 1];
          const b = this.project(new THREE.Vector3(end.x, this.h(end.x, end.y), end.y));
          if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < o.minPx) { o.el.style.display = "none"; continue; }
        }
      }
      o.el.style.display = "";
      if (!o.w || !o.h) { o.w = o.el.offsetWidth; o.h = o.el.offsetHeight; }
      const w = o.w, h = o.h;
      const x = s.x - w / 2, y = s.y - h / 2 + o.dy;
      const box = (dy: number) => ({ x0: x, y0: y + dy, x1: x + w, y1: y + dy + h });
      let dy = 0;
      if (o.rank >= 3) {
        const covered = hits(box(0));
        o.el.style.visibility = covered ? "hidden" : "";
        if (covered) continue;
      } else {
        o.el.style.visibility = "";
        const step = h + 2;
        dy = [0, step, -step, 2 * step, -2 * step].find(d => !hits(box(d))) ?? 0;
      }
      taken.push(box(dy));
      o.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + dy)}px)`;
    }
  }

  private layout() {
    const place = (el: HTMLElement, world: THREE.Vector3 | null, dy = 0) => {
      const s = world ? this.project(world) : null;
      if (!s || s.x < -60 || s.y < -60 || s.x > this.size.width + 60 || s.y > this.size.height + 60) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      el.style.translate = `${Math.round(s.x - el.offsetWidth / 2)}px ${Math.round(s.y - el.offsetHeight / 2 + dy)}px`;
    };
    this.layoutOverlays();
    for (const m of this.measureLabels) place(m.el, m.at, m.el.classList.contains("dg-mpt") ? 0 : -14);
    this.placeMe(place);
    if (this.draftLabel && this.draftAt) place(this.draftLabel, this.draftAt, -22);
    for (const h of this.handles) {
      let w: THREE.Vector3 | null = null;
      try { w = h.visible && !h.visible() ? null : h.world(); } catch { w = null; }
      if (!w) {
        h.el.style.display = "none";
        continue;
      }
      place(h.el, w);
    }
  }

  // ------------------------------------------------------------------ picking

  /**
   * What is under a client point: what the pointer sees first. Small marks by screen distance
   * (badges are DOM and pick themselves) unless leaves or a roof stand in front of them; then the
   * leaves or roof nearest the eye; then, on the ground, built lines, drawn lines and throw lines
   * (within a few pixels), areas (smallest first) and fairways; last, a tree whose leaves are only
   * near the pointer.
   */
  private pick(clientX: number, clientY: number): string | null {
    const was = this.eye;
    this.eye = this.dragEye ?? this.eyeAt(clientX, clientY);
    try { return this.pickIn(clientX, clientY); } finally { this.eye = was; }
  }

  /** Whether the last pick was an area's edge (a click there picks the area, not a tree on it). */
  private pickedEdge = false;

  private pickIn(clientX: number, clientY: number): string | null {
    this.pickedEdge = false;
    const doc = this.doc;
    if (!doc) return null;
    const r = this.container.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    let best: { id: string; score: number } | null = null;
    // A fingertip is less exact than a mouse pointer: reach a little further
    const reach = this.fingers ? 1.6 : 1;
    // What stands up in front: a tree's drawn leaves or trunk, or a roof or wall, whichever is
    // nearest the eye (tested in 3D: in a tilted view a crown stands well above its foot, and a
    // line of sight that meets a roof goes no further, to the tree behind it)
    const ray = this.ray(clientX, clientY);
    const roof = this.builtUnder(ray), leaves = this.treeUnder(ray);
    const seen = leaves?.drawn && !(roof && roof.t < leaves.t) ? leaves : roof;
    // (leaves only near the pointer, none drawn right there: only when nothing is on the ground there)
    const guessed = leaves && !leaves.drawn && !roof ? leaves : null;
    // (from the tee view: the camera stands on a pad, close enough to fill the view; that pad isn't
    // what a click means, and nothing near the eye gets a target bigger than a thumb)
    const eye = this.eye ?? this.mainEye();
    const pov = eye.cam === this.povCam;
    for (const item of doc.course.items) {
      if (item.type === "area" || item.type === "line" || item.type === "label" || item.type === "structure" || item.type === "tree") continue;
      const a = new THREE.Vector3(item.x, this.h(item.x, item.y) + 1, item.y);
      if (pov && Math.hypot(a.x - eye.cam.position.x, a.z - eye.cam.position.z) < 15) continue;
      const s = this.project(a);
      if (!s) continue;
      const upp = this.upp(a);
      const real = item.type === "tee" ? item.padLength / 2 : item.type === "amenity" ? 4 : 2;
      const radius = pov ? Math.min(40 * reach, Math.max(16 * reach, real / upp)) : Math.max(13 * reach, real / upp);
      const d = Math.hypot(s.x - sx, s.y - sy);
      // (a mark hidden behind leaves or a roof isn't what the pointer is on)
      if (d <= radius && !(seen && seen.t < a.distanceTo(ray.origin) - 3)) {
        const score = d / radius;
        if (!best || score < best.score) best = { id: item.id, score };
      }
    }
    // (from the tee: a tree or roof right under the pointer comes before a mark beside it)
    if (pov && seen && (!best || best.score > 0.45)) return seen.id;
    if (best) return best.id;
    if (seen) return seen.id;
    if (pov) return guessed?.id ?? null;
    const g = this.groundAt(clientX, clientY);
    if (!g) return guessed?.id ?? null;
    const p = { x: g.x, y: g.z };
    const upp = this.upp(g);
    const tol = 7 * reach * upp;
    // Built things (they stand over what is drawn on the ground): on a bridge or wall, or inside a
    // building's outline
    let near: { id: string; d: number } | null = null;
    const built = doc.course.items.filter(i => i.type === "structure") as StructureItem[];
    for (const st of built) {
      // (Lines first: stairs up to a deck, a bridge by a shelter; then the smallest outline)
      const d = isLineKind(st.kind) ? distanceToPath(p, structurePath(st)) - structureWidth(st) / 2 : st.points.length >= 3 && pointInPolygon(p, st.points) ? tol + polygonArea(st.points) * 1e-9 : Infinity;
      if (d < tol * 1.01 + 1 && (!near || d < near.d)) near = { id: st.id, d };
    }
    if (near) return near.id;
    // Drawn lines, then throw lines
    for (const l of doc.course.items.filter(i => i.type === "line") as LineItem[]) {
      const drawn = this.shapeOf(l), half = (l.width ?? LINE_KINDS[l.kind].width) / 2;
      if (pointBoundsGap(p, drawn.box) - half >= tol) continue;
      const d = distanceToPath(p, drawn.pts) - half;
      if (d < tol && (!near || d < near.d)) near = { id: l.id, d };
    }
    if (near) return near.id;
    // An automatic walk to the next tee: its hole (whose panel can take it away)
    if (doc.course.style.nextTee) {
      for (const w of this.keep("walks", doc, "", () => autoWalks(doc.course.items, doc.stats, doc.course.holes))) {
        const d = distanceToPath(p, [w.from, w.to]);
        if (d < tol && (!near || d < near.d)) near = { id: w.a.holeId, d };
      }
      if (near) return near.id;
    }
    for (const s of doc.stats) {
      if (!s.complete) continue;
      const d = distanceToPath(p, this.keep(`line:${s.holeId}`, null, JSON.stringify(s.line), () => smoothPath(s.line, 8)));
      if (d < tol && (!near || d < near.d)) near = { id: s.holeId, d };
    }
    if (near) return near.id;
    // An area's edge, within a few pixels (its edge is what's drawn of it): the nearest, the smaller
    // where two run together; then the inside of the smallest round the pointer
    const shapes = (doc.course.items.filter(i => i.type === "area") as AreaItem[]).map(a => ({ id: a.id, ...this.shapeOf(a) }));
    const edgeTol = 6 * reach * upp;
    let edge: { id: string; d: number; size: number } | null = null;
    for (const a of shapes) {
      if (a.pts.length < 3 || pointBoundsGap(p, a.box) >= edgeTol) continue;
      const d = distanceToPath(p, [...a.pts, a.pts[0]]), size = Math.abs(polygonArea(a.pts));
      if (d < edgeTol && (!edge || d < edge.d - upp || (d < edge.d + upp && size < edge.size))) edge = { id: a.id, d, size };
    }
    if (edge) { this.pickedEdge = true; return edge.id; }
    const areas = shapes.filter(a => inBounds(p, a.box) && pointInPolygon(p, a.pts));
    if (areas.length) return areas.sort((a, b) => polygonArea(a.pts) - polygonArea(b.pts))[0].id;
    // Inside a fairway: its hole
    for (const s of doc.stats) {
      const hole = this.hole(s.holeId);
      if (!hole?.fairway || !s.complete) continue;
      if (pointInPolygon(p, this.outline(hole, s.line, "line", 8, 0, 8))) return hole.id;
    }
    // (nothing on the ground there: a tree whose leaves are near the pointer, through a gap in them)
    return guessed?.id ?? null;
  }

  // ------------------------------------------------------------------ pointer input

  private endDragListeners: (() => void) | null = null;
  /** When two fingers were last on the map (a pinch): a tap then is no tap. */
  private pinchAt = 0;

  /** Press that becomes a click (no movement) or a drag. */
  private gesture(e: PointerEvent, h: { click?: (ev: PointerEvent) => void; drag?: (start: PointerEvent) => Drag | null }) {
    const sx = e.clientX;
    const sy = e.clientY;
    const id = e.pointerId;
    const slop = e.pointerType === "touch" ? TOUCH_SLOP : CLICK_PX;
    const began = performance.now();
    let drag: Drag | null = null;
    let moved = false;
    let lastEv: PointerEvent = e;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      lastEv = ev;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > slop) {
        moved = true;
        drag = h.drag?.(e) ?? null;
        if (drag) this.setDragging(true);
      }
      if (drag) {
        drag.move(ev);
        this.invalidate();
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      cleanup();
      // (a finger that was part of a pinch, or lifted just after one, taps nothing)
      const pinched = ev.pointerType === "touch" && (this.touchIds.size > 0 || this.pinchAt >= began - 50 || performance.now() - this.pinchAt < 350);
      if (drag) {
        drag.end(ev);
        this.setDragging(false);
      } else if (!moved && !pinched) h.click?.(ev);
      this.invalidate();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.endDragListeners = null;
    };
    this.endDragListeners?.();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    // (ended from outside, by a second finger say: a drag under way is ended, so its change lands)
    this.endDragListeners = () => {
      cleanup();
      if (drag) { drag.end(lastEv); this.setDragging(false); drag = null; }
    };
  }

  private setDragging(on: boolean) {
    if (this.dragging === on) return;
    this.dragging = on;
    // (underbrush out of sight while dragging: a big wood's thousands of bushes drawn at every step
    // make the drag crawl, and they're mostly under the crowns anyway)
    for (const [key, entry] of this.shapes) if (/:under(:|$)/.test(key)) entry.obj.visible = !on;
    if (!on) {
      this.handleKey = "";
      this.syncHandles();
      if (this.afterDrag && this.doc) { this.afterDrag = false; this.syncShapes(); this.invalidate(); }
      if (this.shadowsAfterDrag) { this.shadowsAfterDrag = false; this.shadowsDirty = true; this.invalidate(); }
    }
    this.updateCursor();
  }

  /** Map-style pan, with a mouse or a finger: the ground point under it stays under it; let go
   * while it's still moving and the map slides on, slowing, as on Google Maps. */
  private panDrag(e: { clientX: number; clientY: number; timeStamp?: number }): Drag | null {
    const g0 = this.groundAt(e.clientX, e.clientY);
    if (!g0) return null;
    this.userMoved();
    this.container.style.cursor = "grabbing";
    // (where the map was over the last moments: the fling's speed)
    // (by when each move happened, not when it was handled: a busy frame doesn't skew it)
    const trail: { t: number; x: number; z: number }[] = [];
    const mark = (t: number) => {
      const g = this.controls.getTarget(new THREE.Vector3(), false);
      trail.push({ t, x: g.x, z: g.z });
      if (trail.length > 8) trail.shift();
    };
    mark(e.timeStamp ?? performance.now());
    return {
      move: ev => {
        const g1 = this.planeAt(ev.clientX, ev.clientY, g0.y);
        if (!g1) return;
        this.shift(g0.x - g1.x, g0.z - g1.z);
        mark(ev.timeStamp);
      },
      // (not when a second finger took over, or the press was cancelled)
      end: ev => {
        this.updateCursor();
        if (ev.type === "pointerup" && this.touchIds.size === 0) this.fling(trail, ev.timeStamp);
      }
    };
  }

  /** The map moved by hand: it stops following you and keeps its place when the window changes
   * size; a fling under way stops. */
  private userMoved() {
    this.glide = null;
    this.posePinned = false;
    this.autoFit = null;
    this.onUserMove?.();
  }

  /** The map sliding on after a pan let go of while moving (plan ft a second). */
  private glide: { vx: number; vz: number } | null = null;
  /** A fling, at the speed the map moved over the last tenth of a second (none if it was held
   * still before letting go, or moved slowly). */
  private fling(trail: { t: number; x: number; z: number }[], at: number) {
    const last = trail[trail.length - 1];
    if (!last || at - last.t > 60) return;
    const first = trail.find(s => last.t - s.t <= 100);
    if (!first || last.t - first.t < 16) return;
    const sec = (last.t - first.t) / 1000;
    let vx = (last.x - first.x) / sec, vz = (last.z - first.z) / sec;
    const px = Math.hypot(vx, vz) / this.worldPerPx();
    if (px < 250) return;
    if (px > 4000) { vx *= 4000 / px; vz *= 4000 / px; }
    this.glide = { vx, vz };
    this.invalidate();
  }
  private stepGlide(dt: number) {
    const g = this.glide!;
    const k = Math.exp(-Math.min(dt, 0.1) / GLIDE_TAU);
    this.shift(g.vx * GLIDE_TAU * (1 - k), g.vz * GLIDE_TAU * (1 - k));
    g.vx *= k;
    g.vz *= k;
    if (Math.hypot(g.vx, g.vz) / this.worldPerPx() < 20) this.glide = null;
  }
  /** Plan ft per screen pixel at the point looked at. */
  private worldPerPx() {
    return (2 * this.controls.distance * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, this.size.height);
  }

  /** The finger left on the map when the other of two lifts: it goes on moving the map. */
  private followFinger(id: number, x: number, y: number) {
    const drag = this.panDrag({ clientX: x, clientY: y });
    if (!drag) return;
    const move = (ev: PointerEvent) => { if (ev.pointerId === id) { drag.move(ev); this.invalidate(); } };
    const up = (ev: PointerEvent) => { if (ev.pointerId === id) { cleanup(); drag.end(ev); } };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.endDragListeners = null;
    };
    this.endDragListeners?.();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.endDragListeners = cleanup;
  }

  private shift(dx: number, dz: number) {
    const t = this.controls.getTarget(new THREE.Vector3(), false);
    void this.controls.moveTo(t.x + dx, t.y, t.z + dz, false);
    this.controls.update(0);
    this.camera.updateMatrixWorld();
    this.invalidate();
  }

  private itemDrag(e: PointerEvent, id: string): Drag | null {
    const item = this.item(id);
    if (!item) return null;
    const planeY = this.h(item.x, item.y);
    const hit0 = this.planeAt(e.clientX, e.clientY, planeY);
    if (!hit0) return null;
    const start = { x: hit0.x, y: hit0.z };
    const shape = item.type === "area" || item.type === "line" || item.type === "structure" ? item.points.map(p => ({ ...p })) : null;
    const off = { x: item.x - hit0.x, y: item.y - hit0.z };
    return {
      move: ev => {
        const hit = this.planeAt(ev.clientX, ev.clientY, planeY);
        if (!hit) return;
        if (shape) {
          const dx = hit.x - start.x, dy = hit.z - start.y;
          this.cb.onChange(id, { points: shape.map(p => ({ x: p.x + dx, y: p.y + dy })), x: item.x + dx, y: item.y + dy });
        } else {
          this.cb.onChange(id, { x: hit.x + off.x, y: hit.z + off.y });
        }
        if (this.povHole) this.povDragTip(id, { x: hit.x + off.x, y: hit.z + off.y }, ev.clientX, ev.clientY);
      },
      end: () => { this.tip(null); this.cb.onCommit(); }
    };
  }

  // ------------------------------------------------------------------ touch: two fingers, long-press

  /** Fingers on the map now. */
  private touchIds = new Set<number>();
  private longPress: { id: number; t0: number; fire: () => void; stop: () => void } | null = null;
  /** Whether the last press was a finger (taps get a bigger reach for picking things). */
  private fingers = false;

  /** Where each finger is now (screen px). */
  private fingerAt = new Map<number, { x: number; y: number }>();
  /** Two fingers on the map, as on Google Maps: they hold the ground between them, so sliding them
   * moves the map, spreading them zooms and twisting them turns it (once twisted a little: a pinch
   * doesn't turn the map by accident); both sliding up or down together, side by side, tilt it. */
  private pinch: { d: number; a: number; cx: number; cy: number; p0: P; q0: P; d0: number; a0: number; mode: "" | "tilt" | "map"; turning: boolean } | null = null;
  /** Two fingers that came down on the thing picked: they size and turn it, not the map. */
  private pinchItem: { id: string; base: CourseItem; d0: number; a0: number; aim: number } | null = null;
  private readonly twoFingers = (e: PointerEvent) => {
    const f = this.fingerAt.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX; f.y = e.clientY;
    if (this.touchIds.size !== 2 || !this.pinch) return;
    const [p, q] = [...this.touchIds].map(id => this.fingerAt.get(id)!);
    if (!p || !q) return;
    const d = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)), a = Math.atan2(q.y - p.y, q.x - p.x), cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2;
    const was = this.pinch;
    if (this.pinchItem) {
      this.pinch = { ...was, d, a, cx, cy };
      const patch = this.pinchedPatch(this.pinchItem, d / this.pinchItem.d0, ((a - this.pinchItem.a0) * 180) / Math.PI);
      if (patch) this.cb.onChange(this.pinchItem.id, patch);
      return;
    }
    // (standing, or a flight: two fingers zoom the view in and out, as the wheel does)
    if (this.povHole) {
      this.pinch = { ...was, d, a, cx, cy };
      if (!this.fly && Math.abs(d / was.d - 1) > 1e-3) {
        this.povCam.fov = clamp(this.povCam.fov * (was.d / d), LENS.min, LENS.max);
        this.invalidate();
      }
      return;
    }
    // (what the fingers do, once they've moved a little: both sliding up or down side by side
    // tilts; anything else holds the ground)
    if (!was.mode) {
      const dp = { x: p.x - was.p0.x, y: p.y - was.p0.y }, dq = { x: q.x - was.q0.x, y: q.y - was.q0.y };
      if (Math.max(Math.hypot(dp.x, dp.y), Math.hypot(dq.x, dq.y)) < TOUCH_SLOP) return;
      const sideBySide = Math.abs(Math.sin(was.a0)) < 0.6;
      const slides = (v: P) => Math.abs(v.y) > 2 * Math.abs(v.x);
      was.mode = sideBySide && slides(dp) && slides(dq) && Math.sign(dp.y) === Math.sign(dq.y) && Math.abs(d / was.d0 - 1) < 0.15 ? "tilt" : "map";
      this.userMoved();
    }
    const now = (this.pinch = { ...was, d, a, cx, cy });
    if (was.mode === "tilt") {
      if (Math.abs(was.cy - cy) > 0.5) void this.controls.rotate(0, (was.cy - cy) * (MAX_TILT / Math.max(300, this.size.height * 0.6)), false);
      this.invalidate();
      return;
    }
    // (the ground that was between the fingers, back between them)
    const g0 = this.groundAt(was.cx, was.cy), g1 = g0 && this.planeAt(cx, cy, g0.y);
    if (g0 && g1) this.shift(g0.x - g1.x, g0.z - g1.z);
    const wrap = (r: number) => (r > Math.PI ? r - 2 * Math.PI : r < -Math.PI ? r + 2 * Math.PI : r);
    let da = wrap(a - was.a);
    if (!now.turning) {
      now.turning = Math.abs(wrap(a - was.a0)) > TWIST;
      da = 0;
    }
    // (the map turns with the fingers and stays under them: around the ground between them)
    if (Math.abs(da) > 1e-4) {
      const under = this.groundAt(cx, cy);
      if (under) {
        // (camera and target turned together about the vertical through that ground point)
        const pos = this.controls.getPosition(new THREE.Vector3(), true), tgt = this.controls.getTarget(new THREE.Vector3(), true);
        const up = new THREE.Vector3(0, 1, 0);
        const np = pos.sub(under).applyAxisAngle(up, da).add(under), nt = tgt.sub(under).applyAxisAngle(up, da).add(under);
        void this.controls.setLookAt(np.x, np.y, np.z, nt.x, nt.y, nt.z, false);
      } else void this.controls.rotate(da, 0, false);
    }
    if (Math.abs(d / was.d - 1) > 1e-3) this.zoomAt(cx, cy, was.d / d, false);
    this.invalidate();
  };
  private startPinch() {
    const [p, q] = [...this.touchIds].map(id => this.fingerAt.get(id)!);
    if (!p || !q) return;
    const d = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)), a = Math.atan2(q.y - p.y, q.x - p.x);
    this.glide = null;
    this.pinch = { d, a, cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, p0: { ...p }, q0: { ...q }, d0: d, a0: a, mode: "", turning: false };
    // (both fingers on or right by the thing picked: it's the thing they size and turn; only a
    // thing that turns, or a tree, and a shape well inside the view: on a wood, a pond or a road
    // that fills it, two fingers move the map)
    this.pinchItem = null;
    const it = this.selectedId && !this.readOnly ? this.item(this.selectedId) : null;
    if (it && !it.locked && (turnable(it) || it.type === "tree")) {
      const box = this.screenBox(it.id);
      const shape = it.type === "area" || it.type === "line" || it.type === "structure";
      if (shape && (!box || box.width >= this.size.width * 0.6 || box.height >= this.size.height * 0.6)) return;
      const near = (f: { x: number; y: number }) => {
        const r = this.container.getBoundingClientRect();
        const x = f.x - r.left, y = f.y - r.top, m = 48;
        return !!box && x >= box.x - m && x <= box.x + box.width + m && y >= box.y - m && y <= box.y + box.height + m;
      };
      if (near(p) && near(q)) this.pinchItem = { id: it.id, base: structuredClone(it), d0: this.pinch.d, a0: this.pinch.a, aim: it.type === "tee" ? teeAim(this.doc!.course, it) : 0 };
    }
  }
  /** What two fingers on a thing make of it: bigger or smaller by `k`, turned by `turn` degrees. */
  private pinchedPatch(pi: NonNullable<CourseView["pinchItem"]>, k: number, turn: number): Record<string, unknown> | null {
    const b = pi.base;
    const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const round1 = (v: number) => Math.round(v * 10) / 10;
    const spin = (p: P, c: P) => {
      const r = (turn * Math.PI) / 180, dx = (p.x - c.x) * k, dy = (p.y - c.y) * k;
      return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) };
    };
    switch (b.type) {
      case "tree": {
        const h = b.height ?? b.radius * 2.6;
        return { radius: round1(clampTo(b.radius * k, 1, 45)), height: Math.round(clampTo(h * k, 2, 120)) };
      }
      case "tee": return { padLength: round1(clampTo(b.padLength * k, 4, 30)), padWidth: round1(clampTo(b.padWidth * k, 2, 20)), rotation: Math.round(pi.aim + turn), aimFixed: true };
      case "mando": case "amenity": case "dropzone": case "label": return { rotation: Math.round((b.rotation ?? 0) + turn) };
      case "area": case "line": case "structure": {
        const c = centroid(b.points);
        return { points: b.points.map(p => spin(p, c)) };
      }
      default: return null;
    }
  }
  private endPinch() {
    if (this.touchIds.size === 0) window.removeEventListener("pointermove", this.twoFingers);
    if (this.pinchItem) { this.pinchItem = null; this.cb.onCommit(); }
    if (!this.pinch) return;
    this.pinch = null;
    this.snapNorth();
  }

  /** The last quick tap of one finger (a second, soon after and close by, is a double tap). */
  private lastTap: { t: number; x: number; y: number } | null = null;
  /** The finger down now, if it's one finger alone (to tell a tap). */
  private tapDown: { id: number; t: number; x: number; y: number } | null = null;

  /** A double tap with a finger, as on Google Maps: the map zooms in twice over where it lands (the
   * view's lens, standing). Whatever the first tap did stands; the second does nothing else. */
  private doubleTap(e: PointerEvent) {
    this.lastTap = null;
    this.tapDown = null;
    this.cancelLongPress();
    this.userMoved();
    if (this.povHole) {
      if (!this.fly) this.povCam.fov = clamp(this.povCam.fov * 0.6, LENS.min, LENS.max);
    } else this.zoomAt(e.clientX, e.clientY, 0.5);
    this.invalidate();
  }

  private touchUp(e: PointerEvent) {
    // (a quick tap of one finger that hardly moved: remembered, for a double tap)
    const d = this.tapDown;
    if (d && d.id === e.pointerId) {
      this.tapDown = null;
      const quick = e.type === "pointerup" && e.timeStamp - d.t < 300 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12 && this.touchIds.size === 1;
      this.lastTap = quick ? { t: e.timeStamp, x: e.clientX, y: e.clientY } : null;
    }
    this.fingerAt.delete(e.pointerId);
    const mapPinch = !this.povHole && !!this.pinch && !this.pinchItem && this.touchIds.size === 2;
    if (this.touchIds.delete(e.pointerId) && this.touchIds.size >= 1) this.pinchAt = performance.now();
    if (this.touchIds.size < 2) this.endPinch();
    else if (this.touchIds.size === 2 && !this.pinch) this.startPinch();
    if (this.touchIds.size === 0) window.removeEventListener("pointermove", this.twoFingers);
    // (one of two fingers lifted: the other goes on moving the map, as on Google Maps)
    if (mapPinch && this.touchIds.size === 1 && e.type === "pointerup") {
      const id = [...this.touchIds][0], f = this.fingerAt.get(id);
      if (f) this.followFinger(id, f.x, f.y);
    }
    const lp = this.longPress;
    if (lp?.id !== e.pointerId) return;
    // (Held long enough, even if a busy page ran the timer late: still the long-press)
    if (e.type === "pointerup" && e.timeStamp - lp.t0 >= LONG_PRESS_MS) lp.fire();
    else this.cancelLongPress();
  }

  private cancelLongPress() {
    this.longPress?.stop();
    this.longPress = null;
  }

  /** A second finger on the map: the camera pinches, turns and tilts; nothing is placed or picked. */
  private secondFinger() {
    this.cancelLongPress();
    this.marquee?.remove();
    this.marquee = null;
    if (this.shaping) {
      this.shaping = false;
      this.draftPending = false;
      this.cancelDrawing();
    }
    this.endDragListeners?.();
    this.setDragging(false);
  }

  /** A small Delete point button by a corner tapped with a finger (an area keeps 3, a line 2). */
  private pointMenu(h: Handle, id: string, index: number) {
    const it = this.item(id) as AreaItem | LineItem | StructureItem | null;
    if (!it || !("points" in it) || it.locked) return;
    const min = it.type === "line" || (it.type === "structure" && STRUCTURE_KINDS[it.kind].shape !== "outline") ? 2 : 3;
    const can = it.points.length > min;
    this.handleButton(h, "delete-point", can ? "Delete point" : `Needs at least ${min} points`, can, () => {
      const cur = this.item(id) as AreaItem | LineItem | StructureItem | null;
      if (cur && "points" in cur && cur.points.length > min) {
        this.cb.onChange(id, { points: cur.points.filter((_, k) => k !== index), ...(cur.type === "line" ? { widths: widthsWithout(cur, index) } : {}) });
        this.cb.onCommit();
      }
    });
  }

  /** The same for a turn in a hole's line tapped with a finger: Remove this turn. */
  private turnMenu(h: Handle, holeId: string, index: number) {
    if (!this.hole(holeId)) return;
    this.handleButton(h, "remove-turn", "Remove this turn", true, () => {
      const hole = this.hole(holeId);
      if (!hole || !hole.doglegs[index]) return;
      this.cb.onHoleChange(holeId, { doglegs: hole.doglegs.filter((_, k) => k !== index) });
      this.cb.onCommit();
    });
  }

  /** A button over a handle tapped with a finger, gone on the next touch elsewhere or after a while. */
  private handleButton(h: Handle, testid: string, text: string, can: boolean, run: () => void) {
    document.querySelectorAll(".dg-ptmenu").forEach(n => n.remove());
    const btn = document.createElement("button");
    btn.className = "dg-ptmenu";
    btn.setAttribute("data-testid", testid);
    btn.textContent = text;
    btn.disabled = !can;
    const r = h.el.getBoundingClientRect(), box = this.container.getBoundingClientRect();
    btn.style.left = `${r.left + r.width / 2 - box.left}px`;
    btn.style.top = `${r.top - box.top - 10}px`;
    const gone = () => { btn.remove(); window.removeEventListener("pointerdown", away, true); };
    const away = (ev: PointerEvent) => { if (ev.target !== btn) gone(); };
    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      run();
      gone();
    });
    this.container.appendChild(btn);
    window.setTimeout(() => window.addEventListener("pointerdown", away, true), 0);
    window.setTimeout(gone, 6000);
  }

  /** A finger on a handle: it moves once the finger does (a handle's hit area is big for a finger,
   * so a tap on a hole's line often lands on one); a tap selects what the handle belongs to, or
   * does the handle's own tap. */
  private fingerOnHandle(e: PointerEvent, h: Handle) {
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId, began = performance.now();
    let drag: Drag | null = null, moved = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= TOUCH_SLOP) return;
        moved = true;
        drag = h.start(e);
        if (!drag) { cleanup(); this.invalidate(); return; }
        this.setDragging(true);
      }
      drag?.move(ev);
      this.invalidate();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      cleanup();
      const pinched = this.touchIds.size > 0 || this.pinchAt >= began - 50 || performance.now() - this.pinchAt < 350;
      if (drag) {
        drag.end(ev);
        this.setDragging(false);
      } else if (!moved && !pinched && ev.type === "pointerup") {
        const owner = this.selectedId ?? this.doc?.activeHoleId ?? null;
        if (owner && owner !== this.selectedId) this.cb.onSelect(owner);
        // (a corner of the thing picked, tapped: a Delete point button by it, as a finger can't double-tap it reliably;
        // a turn of the hole's line: Remove this turn; others their own, see Handle.tap)
        else if (h.kind === "corner" && h.index !== undefined && this.selectedId) this.pointMenu(h, this.selectedId, h.index);
        else if (h.kind === "dogleg" && h.index !== undefined) { const hole = this.hole(this.selectedId)?.id ?? this.doc?.activeHoleId; if (hole) this.turnMenu(h, hole, h.index); }
        else h.tap?.(h, e);
      }
      this.invalidate();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.endDragListeners = null;
    };
    // (a second finger ends this: see secondFinger)
    this.endDragListeners?.();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.endDragListeners = cleanup;
  }

  /** What a menu at that point is for: the thing there; or, where a tree stands over an area, a
   * line, a built thing or a hole's line (most trees stand in a wood), the tree's menu, with that
   * thing `under` it to pick from there (its Copy and Delete would be the whole wood's). */
  private menuFor(x: number, y: number, domItem: string | null): { itemId: string | null; under: string | null } {
    const hit = domItem ?? this.pick(x, y);
    const it = hit ? this.item(hit) : null;
    const big = !!hit && !domItem && !this.pickedEdge && (it ? it.type === "area" || it.type === "line" || it.type === "structure" : !!this.hole(hit));
    return big && !this.readOnly && this.treeAtScreen(x, y) ? { itemId: null, under: hit } : { itemId: hit, under: null };
  }

  /** Holding a finger still on an item opens its menu, like a right-click (on open ground: what
   * can start there). */
  private startLongPress(e: PointerEvent, target: HTMLElement) {
    this.cancelLongPress();
    const id = e.pointerId, x = e.clientX, y = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === id && Math.hypot(ev.clientX - x, ev.clientY - y) > TOUCH_SLOP) this.cancelLongPress();
    };
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
    };
    const fire = () => {
      this.cancelLongPress();
      const domItem = (target.closest?.("[data-item-id]") as HTMLElement | null)?.dataset.itemId ?? null;
      const { itemId, under } = this.menuFor(x, y, domItem);
      // (open ground too, to change: what can start there)
      if (!itemId && !under && !this.treeAtScreen(x, y) && (this.readOnly || !this.groundAt(x, y))) return;
      // The press is now the menu's: no tap, no drag, and the map stops following the finger
      this.endDragListeners?.();
      this.setDragging(false);
      this.controls.cancel();
      try { navigator.vibrate?.(12); } catch { /* not allowed */ }
      const g = this.groundAt(x, y);
      this.cb.onContextMenu({ clientX: x, clientY: y, itemId, under, ground: g ? { x: g.x, y: g.z } : null });
    };
    window.addEventListener("pointermove", move);
    const timer = window.setTimeout(fire, LONG_PRESS_MS);
    this.longPress = { id, t0: e.timeStamp, fire, stop };
  }

  private onPointerDown(e: PointerEvent) {
    window.clearTimeout(this.restTimer);
    this.restKey = "";
    this.tip(null);
    const target = e.target as HTMLElement;
    if (!this.doc) return;
    this.glide = null;
    this.lookGlide = null;
    this.fingers = e.pointerType === "touch";
    if (this.fingers) {
      this.touchIds.add(e.pointerId);
      this.fingerAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touchIds.size === 1) window.addEventListener("pointermove", this.twoFingers);
      if (this.touchIds.size > 1) {
        this.lastTap = null;
        this.tapDown = null;
        this.pinchAt = performance.now();
        this.secondFinger();
        if (this.touchIds.size === 2) this.startPinch();
        else this.endPinch();
        return;
      }
      // (a second quick tap close by: a double tap, which zooms; not on the buttons over the view,
      // and never on a thing on the map or its handles: two taps on a thing are two picks, a tap
      // taking it out of a group again, and picking never zooms)
      const last = this.lastTap;
      if (last && e.timeStamp - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40 && !target.closest?.("button,input,select,textarea,a,[data-pov-ui],[role=dialog],[data-item-id],[data-handle]")) {
        e.preventDefault();
        e.stopPropagation();
        this.doubleTap(e);
        return;
      }
      this.tapDown = { id: e.pointerId, t: e.timeStamp, x: e.clientX, y: e.clientY };
      // (Not on a handle that moves something: holding one still before dragging it slowly is no
      // menu; a line's middle dot is fine, it is where a finger lands to hold a hole)
      const handle = (target.closest?.("[data-handle]") as HTMLElement | null)?.dataset.handle;
      if (!this.povHole && this.tool.mode === "select" && e.button === 0 && (!handle || handle === "mid")) this.startLongPress(e, target);
    }
    if (this.povHole) {
      if (target.closest?.("button,input,select,[data-pov-ui]")) return;
      // (the right button, or Space held: looking around, whatever the tool)
      if ((e.button === 2 || this.spaceDown) && !this.fly) { e.preventDefault(); e.stopPropagation(); this.povDrag(e, true); return; }
      if (e.button !== 0) return;
      // (editing: a press on a thing, or with a tool that places one, goes on as on the map,
      // through the picture it's in; on open ground it looks around; on the corner map's open
      // ground, nothing)
      // (Walk: a tap walks, on a thing or not. Edit: a drag looks around, as in Walk, unless it
      // starts on the thing picked (a tree, a basket…: it moves) or a tool places things; a tap
      // picks what's there. On the corner map, a press on a thing goes to it as on the map)
      if (this.tapsEdit() && !this.fly && !this.free) {
        const eye = this.eyeAt(e.clientX, e.clientY);
        const hit = this.tool.mode === "select" ? this.pick(e.clientX, e.clientY) : null;
        const it = hit ? this.item(hit) : null;
        const movesPicked = !!it && hit === this.selectedId && it.type !== "area" && it.type !== "line" && it.type !== "structure";
        const onThing = this.tool.mode !== "select" || movesPicked || (eye.cam === this.miniCam && !!hit);
        if (onThing) {
          this.dragEye = eye;
          const done = () => { window.removeEventListener("pointerup", done, true); window.removeEventListener("pointercancel", done, true); setTimeout(() => { this.dragEye = null; }, 0); };
          window.addEventListener("pointerup", done, true);
          window.addEventListener("pointercancel", done, true);
        } else if (eye.cam === this.miniCam) {
          e.preventDefault();
          return;
        } else {
          e.preventDefault();
          e.stopPropagation();
          this.povDrag(e, true, ev => this.povTapPick(ev));
          return;
        }
      } else {
        e.preventDefault();
        e.stopPropagation();
        this.povDrag(e);
        return;
      }
    }
    if (e.button === 2) {
      const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        window.removeEventListener("pointerup", up, true);
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5 && !this.readOnly) {
          const domItem = (target.closest?.("[data-item-id]") as HTMLElement | null)?.dataset.itemId ?? null;
          const g = this.groundAt(ev.clientX, ev.clientY);
          this.cb.onContextMenu({ clientX: ev.clientX, clientY: ev.clientY, ...this.menuFor(ev.clientX, ev.clientY, domItem), ground: g ? { x: g.x, y: g.z } : null });
        }
      };
      window.addEventListener("pointerup", up, true);
      return;
    }
    // A stump: the tree back (or a kept tree's ring: cut down after all). Not while an area or
    // line is being drawn: a loop round the stumps starts on one as often as not
    const stumpEl = target.closest?.("[data-stump]") as HTMLElement | null;
    if (stumpEl && e.button === 0 && !this.drawn(this.tool)) {
      e.stopPropagation();
      e.preventDefault();
      this.gesture(e, { click: () => this.toggleLidarTree(Number(stumpEl.dataset.stump)) });
      return;
    }
    // A check's mark (with Select): the checks open, at it
    const issueEl = target.closest?.("[data-issue]") as HTMLElement | null;
    if (issueEl && e.button === 0 && this.tool.mode === "select") {
      e.stopPropagation();
      e.preventDefault();
      this.gesture(e, { click: () => { const t = this.doc?.issues?.[Number(issueEl.dataset.issue)]?.text; if (t) this.onIssue?.(t); } });
      return;
    }
    const handleEl = target.closest?.("[data-handle]") as HTMLElement | null;
    if (handleEl && e.button === 0) {
      const h = this.handles.find(x => x.el === handleEl);
      if (!h) return;
      if (e.pointerType === "touch" && h.kind !== "draw") {
        // (the handles of the hole in hand while it isn't picked: a tap picks it, a drag moves
        // the map, not the hole; nothing moves by accident while panning or pinching)
        const owner = this.selectedId ?? this.doc?.activeHoleId ?? null;
        if (owner !== this.selectedId) {
          this.gesture(e, { click: () => { if (owner) this.cb.onSelect(owner); }, drag: s => this.panDrag(s) });
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        this.fingerOnHandle(e, h);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const drag = h.start(e);
      if (!drag) { this.invalidate(); return; }
      const id = e.pointerId;
      this.setDragging(true);
      const move = (ev: PointerEvent) => { if (ev.pointerId === id) { drag.move(ev); this.invalidate(); } };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        drag.end(ev);
        this.setDragging(false);
        this.invalidate();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }
    const touch = e.pointerType === "touch";
    if (this.spaceDown && e.button === 0) {
      e.stopPropagation();
      this.gesture(e, { drag: s => this.panDrag(s) });
      return;
    }
    // Tilting and turning: the middle button, or Ctrl / Alt (Cmd) + drag, whatever is under the
    // pointer (zoomed in, something always is); Shift + drag too, except where it draws a box
    const held = e.ctrlKey || e.metaKey || e.altKey;
    const shiftTurn = e.shiftKey && this.tool.mode !== "measure" && this.tool.mode !== "select";
    // (the middle button: the camera's own, set to turn and tilt)
    if (e.button !== 0) return;
    const domItem = (target.closest?.("[data-item-id]") as HTMLElement | null)?.dataset.itemId ?? null;
    if (held || (shiftTurn && !domItem && !(this.tool.mode === "select" && this.pick(e.clientX, e.clientY)))) {
      this.controls.mouseButtons.left = ACTION.ROTATE;
      const restore = () => {
        this.controls.mouseButtons.left = ACTION.NONE;
        window.removeEventListener("pointerup", restore);
        this.restoreLeft = null;
      };
      this.restoreLeft?.();
      this.restoreLeft = restore;
      window.addEventListener("pointerup", restore);
      return;
    }
    const stop = () => { if (!touch) e.stopPropagation(); };
    const tool = this.tool;
    const groundClick = (fn: (p: P, ev: PointerEvent) => void) => (ev: PointerEvent) => {
      const g = this.groundAt(ev.clientX, ev.clientY);
      if (g) fn({ x: g.x, y: g.z }, ev);
    };
    if (tool.mode === "measure") {
      stop();
      this.gesture(e, { click: ev => { const g = this.groundAt(ev.clientX, ev.clientY); if (g) this.addMeasurePoint(g, ev.shiftKey); }, drag: s => this.panDrag(s) });
      return;
    }
    if (this.obPick) {
      stop();
      this.gesture(e, { click: groundClick(p => this.obPickClick(p)), drag: s => this.panDrag(s) });
      return;
    }
    if (this.plotHole) {
      // Plotting a hole's line: clicks add turns; a drag draws it freehand
      e.stopPropagation();
      this.gesture(e, { click: groundClick((p, ev) => this.plotClick(p, ev)), drag: s => this.plotDrag(s) });
      return;
    }
    if (tool.mode === "add-hole") {
      stop();
      this.gesture(e, {
        click: groundClick(g => {
          // (a click on a basket already there plays the new hole to it)
          const onBasket = domItem ? this.doc?.course.items.find(i => i.id === domItem && i.type === "basket") : undefined;
          const p = this.holeStart && onBasket ? { x: onBasket.x, y: onBasket.y } : g;
          if (!this.holeStart) {
            this.holeStart = p;
            this.cursor = p;
            this.drawDraft();
            this.cb.onDrawProgress(1);
          } else if (dist(this.holeStart, p) <= 10) {
            // (too close for a hole: the tee stays, waiting for a basket farther off)
            this.draftNote = `Too close to the tee. ${this.fingers ? "Tap" : "Click"} farther away.`;
            this.cursor = p;
            this.drawDraft();
          } else {
            const start = this.holeStart;
            this.holeStart = null;
            this.clearDraft();
            this.cb.onDrawProgress(0);
            this.cb.onHole(start, p);
          }
        }),
        drag: s => this.panDrag(s)
      });
      return;
    }
    if (tool.mode === "sculpt") {
      // The ground tool: a drag paints, a tap is one dab (two fingers still move the map)
      e.stopPropagation();
      this.gesture(e, { drag: s => this.sculptDrag(s), click: groundClick(p => { const d = this.sculptDrag(e, p); d?.end(e); }) });
      return;
    }
    if (this.drawn(tool)) {
      // A rectangle, circle or freehand shape is dragged out (clicking still adds points); with a
      // finger too, so the map stays put (two fingers still move it)
      const shape = this.drawn(tool) === "line" && (tool.shape === "box" || tool.shape === "circle") ? "freehand" : tool.shape;
      const shaped = shape !== "points" && !this.drawPts.length && !this.shapeAnchor;
      // (painting onto an area that's there, or taking from it, stepping it or putting it back: the
      // areas themselves changed; painting on open ground makes a new one, as it always has)
      if (shape === "paint" && this.paintsOver(e)) {
        e.stopPropagation();
        this.gesture(e, { drag: s => this.areaBrushDrag(s), click: ev => { const d = this.areaBrushDrag(ev); d?.end(ev); } });
        return;
      }
      if (shaped) e.stopPropagation();
      else stop();
      this.gesture(e, {
        drag: shaped ? s => this.shapeDrag(s, shape) : s => this.panDrag(s),
        click: groundClick(p0 => {
          // (painting: a tap paints a round spot)
          if (shape === "paint") {
            const out = strokeOutline([p0], this.tool.brush?.size ?? 20);
            if (out) { this.drawPts = out; if (!this.finishDrawing()) this.cancelDrawing(); }
            return;
          }
          // A rectangle or a circle by clicks: one corner (or the middle), then the other corner
          // (or the edge); dragging one out works too
          if (shape === "box" || shape === "circle") {
            const a = this.shapeAnchor;
            if (!a) {
              this.shapeAnchor = { x: e.clientX, y: e.clientY, shape };
              this.drawPts = [];
              this.cursor = null;
              this.cb.onDrawProgress(1);
              return;
            }
            this.shapeAnchor = null;
            const pts = this.shapePoints(a.shape, a, { x: e.clientX, y: e.clientY });
            if (pts) {
              this.drawPts = pts;
              if (!this.finishDrawing()) this.cancelDrawing();
            }
            return;
          }
          const p = this.snap(p0);
          const last = this.drawPts[this.drawPts.length - 1];
          if (last && dist(last, p) < 1) return;
          this.drawPts.push(p);
          this.draftNote = "";
          this.cursor = p;
          this.drawDraft();
          this.cb.onDrawProgress(this.drawPts.length);
          this.handleKey = "";
          this.syncHandles();
        })
      });
      return;
    }
    if (tool.mode !== "select") {
      stop();
      this.gesture(e, {
        click: groundClick(p => {
          this.updateGhost(null);
          this.cb.onPlace(tool.mode, p);
        }),
        drag: s => this.panDrag(s)
      });
      return;
    }
    // Select mode (on a map only looked at, a hole or nothing)
    const hit = this.readOnly ? this.holeFor(domItem ?? this.pick(e.clientX, e.clientY)) : domItem ?? this.pick(e.clientX, e.clientY);
    // A tree under the pointer, over nothing or over an area or line (most trees stand in a wood):
    // a click opens the tree's menu (cut it, make it the course's own, or select the wood)
    const hitItem = hit ? this.item(hit) : null;
    // (over a hole's line or fairway too: a tree stands above it; tees, baskets, signs and the
    // course's own trees still come first; on an area's edge, the area)
    const overBig = (!hit || (!!hitItem && (hitItem.type === "area" || hitItem.type === "line" || hitItem.type === "structure")) || (!hitItem && !!this.hole(hit))) && !(hit && !domItem && this.pickedEdge);
    if (overBig && !e.shiftKey && !tool.dragSelect && !this.readOnly) {
      const tree = this.treeAtScreen(e.clientX, e.clientY);
      if (tree) {
        // (a press on a tree or bush never moves the area it stands in, picked or not: a drag from
        // it moves the map, and a picked area moves from its edge; a picked house or line under
        // the leaves moves, as it's what's picked there)
        const moves = !!hitItem && hit === this.selectedId && !hitItem.locked && hitItem.type !== "area";
        if (moves) e.stopPropagation(); else stop();
        this.gesture(e, {
          // (picked like any tree: the same panel, moved once picked, deleted with Del)
          click: () => this.cb.onAdoptTree(tree, this.lookOf(tree)),
          drag: moves ? s => this.itemDrag(s, hit!) : s => this.panDrag(s)
        });
        return;
      }
    }
    // Shift (or the Drag to select option): a drag draws a box to pick things with; Shift+click
    // adds a thing to the ones picked (or takes it out)
    const add = e.shiftKey && !touch && !this.readOnly;
    const boxing = !this.readOnly && (add || !!tool.dragSelect);
    if (!hit) {
      if (boxing) {
        e.stopPropagation();
        this.gesture(e, { click: () => { if (!add) this.cb.onSelect(null); }, drag: s => this.boxDrag(s, add) });
        return;
      }
      stop();
      this.gesture(e, {
        click: () => this.cb.onSelect(null),
        drag: s => this.panDrag(s)
      });
      return;
    }
    if (add) {
      e.stopPropagation();
      this.gesture(e, { click: () => this.cb.onSelect(hit, true), drag: s => this.boxDrag(s, true) });
      return;
    }
    const item = this.item(hit);
    // (with a finger, while Drag to select is on, a tap puts a thing in with the ones picked or
    // takes it out)
    const tapAdds = touch && !!tool.dragSelect;
    // One of the things picked together: dragging it moves them all (a click picks it alone)
    if (item && this.group.includes(hit)) {
      e.stopPropagation();
      this.gesture(e, { click: () => this.cb.onSelect(hit, tapAdds), drag: s => this.groupDrag(s, hit) });
      return;
    }
    if (tapAdds) {
      e.stopPropagation();
      this.gesture(e, { click: () => this.cb.onSelect(hit, true), drag: s => this.boxDrag(s, false) });
      return;
    }
    // Holes, areas and lines move only once selected (dragging across the map still pans, or
    // draws a box); a hole itself never moves (move its tee or basket); a locked item never moves
    // With a finger, everything moves only once picked: a drag across a thing pans the map
    const big = !item || item.type === "area" || item.type === "line" || item.type === "structure" || item.type === "tree" || touch;
    if ((big && hit !== this.selectedId) || !item || item.locked) {
      if (boxing) e.stopPropagation();
      else stop();
      this.gesture(e, { click: () => this.cb.onSelect(hit), drag: boxing ? s => this.boxDrag(s, false) : s => this.panDrag(s) });
      return;
    }
    // An area picked moves only from its edge (its line, within a few pixels): a drag from inside
    // it moves the map, so a wood, the tall grass or a fairway is never slid by accident
    const picked = hit === this.selectedId;
    // (the field already picked: a click picks the part of it there)
    const field = picked && item.type === "area" && item.kind === "field" ? item : null;
    if (picked && item.type === "area" && !(this.pickedEdge && !domItem)) {
      stop();
      this.gesture(e, {
        drag: s => this.panDrag(s),
        ...(field ? { click: (ev: PointerEvent) => { const g = this.groundAt(ev.clientX, ev.clientY); this.cb.onFieldPart?.(g ? fieldPartAt(field, { x: g.x, y: g.z }) : null); } } : {})
      });
      return;
    }
    e.stopPropagation();
    if (!picked) this.cb.onSelect(hit);
    this.gesture(e, {
      drag: s => this.itemDrag(s, hit),
      ...(field ? { click: (ev: PointerEvent) => { const g = this.groundAt(ev.clientX, ev.clientY); this.cb.onFieldPart?.(g ? fieldPartAt(field, { x: g.x, y: g.z }) : null); } } : {})
    });
  }

  /** The picked field's part outlined, as a pick is (none: null). */
  setFieldPart(id: string | null, part: FieldPart | null) {
    if (this.partFx) { this.fx.remove(this.partFx); disposeObjectDeep(this.partFx); this.partFx = null; }
    const pick = id && part ? { id, part } : null;
    if (pick?.id !== this.partPick?.id || pick?.part !== this.partPick?.part) { this.partPick = pick; this.syncHandles(); }
    const a = id && part ? this.doc?.course.items.find(i => i.id === id) : null;
    if (a && a.type === "area" && a.kind === "field" && part) {
      const g = new THREE.Group();
      for (const s of fieldPartShape(a, part)) {
        g.add(this.fatLine(this.drapeLine(s.pts, 0.5, s.closed), "#000000", 5, { opacity: 0.35, order: 9 }));
        g.add(this.fatLine(this.drapeLine(s.pts, 0.55, s.closed), SELECT, 3, { order: 10 }));
      }
      this.partFx = g;
      this.fx.add(g);
    }
    this.invalidate();
  }
  private partFx: THREE.Group | null = null;
  /** The field part picked (its handle on the map). */
  private partPick: { id: string; part: FieldPart } | null = null;

  /** Draws a box on the screen; what lies inside it when let go is picked (a shape when all of it
   * is inside, so a big area under everything doesn't come along). */
  private boxDrag(start: PointerEvent, add: boolean): Drag | null {
    const rect = this.container.getBoundingClientRect();
    const x0 = start.clientX - rect.left, y0 = start.clientY - rect.top;
    const box = document.createElement("div");
    box.className = "dg-marquee";
    box.setAttribute("data-testid", "select-box");
    this.marquee?.remove();
    this.marquee = box;
    this.labelsLayer.appendChild(box);
    let x1 = x0, y1 = y0;
    const draw = () => {
      box.style.transform = `translate(${Math.min(x0, x1)}px, ${Math.min(y0, y1)}px)`;
      box.style.width = `${Math.abs(x1 - x0)}px`;
      box.style.height = `${Math.abs(y1 - y0)}px`;
    };
    draw();
    return {
      move: ev => {
        x1 = ev.clientX - rect.left;
        y1 = ev.clientY - rect.top;
        draw();
      },
      end: () => {
        box.remove();
        this.marquee = null;
        const r = { l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1) };
        if (r.r - r.l < 3 && r.b - r.t < 3) return;
        this.cb.onBoxSelect(this.itemsIn(r), add, this.treesIn(r));
      }
    };
  }

  /** The measured trees and the saplings grown since the survey standing inside a rectangle on
   * the screen (their trunks), each with its look: to be made the course's own and picked. */
  private treesIn(r: { l: number; r: number; t: number; b: number }) {
    const lidar = this.doc?.course.lidar, ls = this.lidarState;
    const out: { tree: NonNullable<ReturnType<CourseView["treeAt"]>>; look: ReturnType<CourseView["lookOf"]> }[] = [];
    if (!lidar || !ls) return out;
    const inside = (x: number, y: number) => {
      const s = this.project(new THREE.Vector3(x, this.h(x, y), y));
      return !!s && s.x >= r.l && s.x <= r.r && s.y >= r.t && s.y <= r.b;
    };
    for (const g of this.itemsGroup.children) {
      if (!g.userData.measured) continue;
      const spots = g.userData.spots as TreeSpot[], indexOf = g.userData.indexes as number[] | undefined;
      spots.forEach((s, i) => {
        if (!inside(s.x, s.y)) return;
        const k = indexOf?.[i] ?? -1;
        const look = { variant: s.variant, rotation: Math.round((-s.turn / DEG) * 10) / 10, leaf: `#${s.tint.getHexString()}` };
        out.push({ tree: k >= 0 && k < lidar.trees.length ? { kind: "measured", k } : { kind: "spot", x: s.x, y: s.y, height: s.height, width: s.width, conifer: s.shape === "conifer" }, look });
      });
    }
    return out;
  }

  /** The things inside a rectangle on the screen (container pixels). */
  private itemsIn(r: { l: number; r: number; t: number; b: number }): string[] {
    const doc = this.doc;
    if (!doc) return [];
    const inside = (p: P) => {
      const s = this.project(new THREE.Vector3(p.x, this.h(p.x, p.y), p.y));
      return !!s && s.x >= r.l && s.x <= r.r && s.y >= r.t && s.y <= r.b;
    };
    return doc.course.items
      .filter(i => (i.type === "area" || i.type === "line" || i.type === "structure" ? i.points.length > 0 && i.points.every(inside) : inside(i)))
      .map(i => i.id);
  }

  /** Drags the things picked together (and the bends of holes that go with them). */
  private groupDrag(e: PointerEvent, id: string): Drag | null {
    const item = this.item(id);
    const doc = this.doc;
    if (!item || !doc) return null;
    const planeY = this.h(item.x, item.y);
    const hit0 = this.planeAt(e.clientX, e.clientY, planeY);
    if (!hit0) return null;
    const base = doc.course;
    const ids = [...this.group];
    return {
      move: ev => {
        const hit = this.planeAt(ev.clientX, ev.clientY, planeY);
        if (hit) this.cb.onMoveGroup(base, ids, hit.x - hit0.x, hit.z - hit0.z);
      },
      end: () => this.cb.onCommit()
    };
  }

  // ------------------------------------------------------------------ drawing new holes, areas and lines

  private draftAt: THREE.Vector3 | null = null;

  private shaping = false;
  private draftPending = false;

  /** What a drawing tool draws: an outline ("area": areas, buildings, shelters, decks), a line
   * (lines, bridges, boardwalks, stairs, walls), or nothing. */
  private drawn(tool = this.tool): "area" | "line" | null {
    if (tool.mode === "draw-area") return "area";
    if (tool.mode === "draw-line") return "line";
    if (tool.mode === "draw-structure") return STRUCTURE_KINDS[tool.structureKind ?? "bridge"].shape === "outline" ? "area" : "line";
    return null;
  }

  /** A point being drawn, moved onto a corner of a shape already drawn when it is within a few
   * pixels of one (so OB lines and areas meet without gaps). */
  private snap(p: P): P {
    const doc = this.doc;
    if (!doc) return p;
    const tol = 9 * this.upp(new THREE.Vector3(p.x, this.h(p.x, p.y), p.y));
    let best: P | null = null, bd = tol;
    for (const i of doc.course.items) {
      if (i.type !== "area" && i.type !== "line" && i.type !== "structure") continue;
      for (const q of i.points) {
        const d = dist(p, q);
        if (d < bd) { bd = d; best = q; }
      }
    }
    return best ? { x: best.x, y: best.y } : p;
  }

  /** Drags out a new area or line: a rectangle (square to the screen), a circle from its middle, or freehand. */
  private shapeDrag(start: PointerEvent, shape: "box" | "circle" | "freehand" | "paint"): { move: (ev: PointerEvent) => void; end: (ev: PointerEvent) => void } | null {
    const g0 = this.groundAt(start.clientX, start.clientY);
    if (!g0) return null;
    const a = { x: g0.x, y: g0.z };
    const free: P[] = [a];
    const ground = (x: number, y: number) => {
      const g = this.groundAt(x, y);
      return g ? { x: g.x, y: g.z } : null;
    };
    // Freehand points every few pixels (in feet at this zoom)
    const step = Math.max(1.5, 6 / Math.max(0.01, this.viewInfo().pxPerUnit));
    const build = (ev: PointerEvent) => {
      if (shape === "box" || shape === "circle") {
        const pts = this.shapePoints(shape, { x: start.clientX, y: start.clientY }, { x: ev.clientX, y: ev.clientY });
        if (!pts) return;
        this.drawPts = pts;
      } else if (shape === "paint") {
        // (painted: the brush's track, its outline shown as it goes)
        const b = ground(ev.clientX, ev.clientY);
        const r = this.tool.brush?.size ?? 20;
        if (b && dist(free[free.length - 1], b) >= Math.max(step, r / 5)) free.push(b);
        this.drawPts = strokeOutline(free, r) ?? [];
        this.showBrush(b, r);
      } else {
        const b = ground(ev.clientX, ev.clientY);
        if (b && dist(free[free.length - 1], b) >= step) free.push(b);
        this.drawPts = [...free];
      }
      this.cursor = null;
      // Redrawn once per frame (moves can come faster than the draped shape is rebuilt)
      this.draftPending = true;
      this.invalidate();
    };
    this.shaping = true;
    return {
      move: build,
      end: ev => {
        build(ev);
        this.draftPending = false;
        this.shaping = false;
        if (shape === "freehand") this.drawPts = simplify(this.drawPts, step * 0.5);
        if (!this.finishDrawing()) this.cancelDrawing();
      }
    };
  }

  // ------------------------------------------------------------------ the brush (ground, painting)

  /** Whether a press with the brush changes areas that are there (not a new one): anything but
   * Add, Reshape, or an Add from inside an area of the kind. */
  private paintsOver(e: { clientX: number; clientY: number }) {
    const k = this.paintKind(), t = this.tool, doc = this.doc;
    if (!k || !doc || this.readOnly) return false;
    if (this.brushMode(k) !== "add" || t.reshape) return true;
    const g = this.groundAt(e.clientX, e.clientY);
    if (!g) return false;
    const p = { x: g.x, y: g.z };
    return doc.course.items.some(i => i.type === "area" && !i.locked && kindOf(i).kind === k.kind && kindOf(i).brush === k.brush && pointInPolygon(p, i.points));
  }

  /** What the brush does to this kind, as its row shows it: a level only for kinds with levels,
   * Restore only for underbrush the import found; otherwise Add. */
  private brushMode(k: PaintKind) {
    const m = this.tool.areaBrush ?? "add";
    if ((m === "thinner" || m === "thicker") && k.kind !== "woods") return "add";
    if (m === "restore" && !(k.brush && this.doc?.course.site.brushFound)) return "add";
    return m;
  }

  /** What the import found, as areas by level (for Restore), worked out once a course. */
  private found: { key: unknown; areas: AreaItem[] } | null = null;

  /** While a stroke is under way: the outlines it leaves, drawn over the map (the course itself
   * changed only when it's let go: a wood's trees grown again at every step would stall it). */
  private brushPreview: THREE.Object3D | null = null;
  private showPreview(areas: AreaItem[] | null) {
    if (this.brushPreview) { this.fx.remove(this.brushPreview); disposeObjectDeep(this.brushPreview); this.brushPreview = null; }
    if (areas?.length) {
      const g = new THREE.Group();
      for (const a of areas) {
        g.add(this.fatLine(this.drapeLine(a.points, LIFT + 0.3, true), "#000000", 4.5, { opacity: 0.35, order: 28, depthTest: false }));
        g.add(this.fatLine(this.drapeLine(a.points, LIFT + 0.35, true), SELECT, 2.5, { order: 29, depthTest: false }));
      }
      this.brushPreview = g;
      this.fx.add(g);
    }
    this.invalidate();
  }

  /** A stroke that changes the areas of a kind: the brush's track, and the outlines it leaves shown
   * as it goes (worked out from the areas as they were when it began); when let go, the course
   * changed, as one undo step. */
  private areaBrushDrag(start: PointerEvent): { move: (ev: PointerEvent) => void; end: (ev: PointerEvent) => void } | null {
    const doc = this.doc, k = this.paintKind();
    if (!doc || !k || this.readOnly) return null;
    const g0 = this.groundAt(start.clientX, start.clientY);
    if (!g0) return null;
    const t = this.tool, mode = this.brushMode(k), r = t.brush?.size ?? 20;
    const base = doc.course.items, a = { x: g0.x, y: g0.z }, path: P[] = [a];
    const bf = doc.course.site.brushFound;
    if (mode === "restore" && bf && this.found?.key !== bf) this.found = { key: bf, areas: foundAreas(bf) };
    const found = mode === "restore" ? this.found?.areas ?? [] : [];
    const step = Math.max(1.5, 6 / Math.max(0.01, this.viewInfo().pxPerUnit), r / 5);
    let sent = 0;
    const run = (done: boolean) => {
      const out = strokeOutline(path, r);
      let edit: ReturnType<typeof brushStroke> = null;
      if (out) {
        try { edit = brushStroke(base, k, mode, simplify(out, Math.max(0.4, r / 14)), a, t.reshape ?? null, found); }
        catch { /* (a shape the cutting couldn't make sense of: this step left out) */ }
      }
      if (!done) { this.showPreview(edit ? [...edit.update, ...edit.add] : null); return; }
      this.showPreview(null);
      if (edit) this.cb.onAreas?.(applyEdit(base, edit), true);
    };
    this.showBrush(a, r);
    return {
      move: ev => {
        const g = this.groundAt(ev.clientX, ev.clientY);
        if (!g) return;
        const b = { x: g.x, y: g.z };
        if (dist(path[path.length - 1], b) >= step) path.push(b);
        this.showBrush(b, r);
        const now = performance.now();
        if (now - sent > 60) { sent = now; run(false); }
      },
      end: () => { run(true); }
    };
  }

  /** The brush's ring in the middle of the map at its true size, while its size is being slid on a
   * phone's edge (null: hidden). */
  previewBrush(r: number | null) {
    if (r === null) { this.showBrush(null, 0); return; }
    const box = this.container.getBoundingClientRect();
    const g = this.groundAt(box.left + box.width / 2, box.top + this.topInset + (box.height - this.topInset - this.bottomInset) / 2);
    if (g) this.showBrush({ x: g.x, y: g.z }, r);
  }

  private brushRing: { obj: THREE.Object3D; r: number } | null = null;
  /** The brush's circle on the ground under the pointer (null: hidden). Made once for a size and
   * moved after (made again every move, its line's material went with it, and that's slow). */
  private showBrush(at: P | null, r: number) {
    if (!at) {
      if (this.brushRing?.obj.visible) { this.brushRing.obj.visible = false; this.invalidate(); }
      return;
    }
    if (!this.brushRing || this.brushRing.r !== r) {
      if (this.brushRing) { this.fx.remove(this.brushRing.obj); disposeObjectDeep(this.brushRing.obj); }
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) ring.push(new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2) * r, 0, Math.sin((i / 48) * Math.PI * 2) * r));
      const g = new THREE.Group();
      g.add(this.fatLine(ring, "#1c1917", 4, { depthTest: false, order: 29, opacity: 0.45 }));
      g.add(this.fatLine(ring, "#fafaf9", 2, { depthTest: false, order: 30, opacity: 0.95 }));
      this.brushRing = { obj: g, r };
      this.fx.add(g);
    }
    this.brushRing.obj.position.set(at.x, this.h(at.x, at.y) + LIFT + 0.4, at.y);
    this.brushRing.obj.visible = true;
    this.invalidate();
  }

  /** The ground tool's stroke: dabs along the drag and, held still, again and again where it is;
   * the ground sent on live (a few times a second) and once more when let go, as one undo step. */
  private sculptDrag(start: PointerEvent, at0?: P): { move: (ev: PointerEvent) => void; end: (ev: PointerEvent) => void } | null {
    const doc = this.doc;
    if (!doc || this.readOnly) return null;
    const g0 = at0 ? { x: at0.x, z: at0.y } : this.groundAt(start.clientX, start.clientY);
    if (!g0) return null;
    const b = this.tool.brush ?? { size: 25, strength: 5, ground: "raise" as const };
    const heights: Record<string, number> = { ...doc.heights };
    const original: Record<string, number> = { ...(doc.course.terrainOriginal ?? {}) };
    const W = doc.course.canvas.width, H = doc.course.canvas.height;
    // (raise and lower: a quarter foot a dab at strength 1; flatten and smooth: how far a dab goes)
    const amount = b.ground === "raise" || b.ground === "lower" ? b.strength * 0.12 : Math.min(1, b.strength * 0.05);
    const level = heightAt(doc.heights, doc.gridSize, g0.x, g0.z);
    let last: P = { x: g0.x, y: g0.z }, frame = 0;
    const put = (p: P) => dab(heights, doc.gridSize, W, H, p, b.size, b.ground, amount, level, original);
    // (while painting, only the ground itself reshapes, once a frame at most: the trees, lines,
    // contours and the painted map follow once, when the stroke ends)
    const show = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; this.ground.previewHeights(heights); this.invalidate(); });
    };
    const send = (done: boolean) => { if (done) this.cb.onTerrain?.({ ...heights }, true, { ...original }); else show(); };
    put(last);
    show();
    this.setDragging(true);
    // (held still: it keeps working where the brush is)
    const hold = window.setInterval(() => { put(last); show(); }, 90);
    return {
      move: ev => {
        const g = this.groundAt(ev.clientX, ev.clientY);
        if (!g) return;
        const p = { x: g.x, y: g.z };
        const d = dist(last, p), step = Math.max(1, b.size / 4);
        for (let k = 1; k <= Math.floor(d / step); k++) put({ x: last.x + ((p.x - last.x) * k * step) / d, y: last.y + ((p.y - last.y) * k * step) / d });
        if (d >= step) last = p;
        this.showBrush(p, b.size);
        send(false);
      },
      end: () => {
        window.clearInterval(hold);
        if (frame) cancelAnimationFrame(frame);
        this.setDragging(false);
        send(true);
      }
    };
  }

  /** A rectangle (square to the screen) between two screen points, or a circle from its middle to
   * its edge, on the ground. */
  private shapePoints(shape: "box" | "circle", from: { x: number; y: number }, to: { x: number; y: number }): P[] | null {
    const ground = (x: number, y: number) => {
      const g = this.groundAt(x, y);
      return g ? { x: g.x, y: g.z } : null;
    };
    if (shape === "box") {
      // (a few pixels each way at least: two clicks in a line make no rectangle)
      if (Math.abs(to.x - from.x) < 4 || Math.abs(to.y - from.y) < 4) return null;
      const c = [[from.x, from.y], [to.x, from.y], [to.x, to.y], [from.x, to.y]].map(([x, y]) => ground(x, y));
      return c.every(Boolean) && dist(c[0]!, c[2]!) > 1 ? (c as P[]) : null;
    }
    const a = ground(from.x, from.y), b = ground(to.x, to.y);
    if (!a || !b || dist(a, b) < 1) return null;
    const r = dist(a, b);
    return Array.from({ length: 36 }, (_, i) => ({ x: a.x + Math.cos((i / 36) * Math.PI * 2) * r, y: a.y + Math.sin((i / 36) * Math.PI * 2) * r }));
  }

  /** Ends drawing an area or line (Enter, double-click, or clicking the first point). */
  finishDrawing() {
    if (this.plotHole) return this.finishPlot();
    const kind = this.drawn();
    const pts = this.drawPts;
    if (kind && pts.length >= (kind === "area" ? 3 : 2)) {
      this.drawPts = [];
      this.clearDraft();
      this.cb.onDrawProgress(0);
      // (a rectangle stays square-cornered)
      this.cb.onDrawn(this.tool.mode === "draw-structure" ? "structure" : kind, pts, { straight: this.tool.shape === "box" });
      this.handleKey = "";
      this.syncHandles();
      return true;
    }
    // (begun, but too short to be a shape yet: said where it's being drawn)
    if (kind && pts.length) {
      this.draftNote = `Needs at least ${kind === "area" ? 3 : 2} points`;
      this.drawDraft();
    }
    return false;
  }

  /** Plot a hole's line by hand: clicks along it from the tee (or a freehand drag), to the basket. */
  setPlotLine(holeId: string | null) {
    if (holeId === this.plotHole || (holeId && this.readOnly)) return;
    this.plotHole = holeId;
    this.plotPts = [];
    this.lastPlotClick = null;
    this.cursor = null;
    if (holeId) this.drawDraft();
    else this.clearDraft();
    this.invalidate();
  }

  /** The line plotted so far becomes the hole's (Enter, double-click, the basket, Done). */
  finishPlot() {
    const holeId = this.plotHole;
    if (!holeId) return false;
    this.cb.onHoleChange(holeId, { doglegs: this.plotPts.map(p => ({ ...p })) });
    this.cb.onCommit();
    this.endPlot();
    return true;
  }

  private endPlot() {
    this.plotHole = null;
    this.plotPts = [];
    this.cursor = null;
    this.clearDraft();
    this.cb.onPlotEnd();
    this.invalidate();
  }

  /** A click while plotting: a turn there, or done (on the basket, or a second click on the same spot). */
  private plotClick(p: P, ev: PointerEvent) {
    const s = this.doc?.stats.find(x => x.holeId === this.plotHole);
    if (!s?.complete) return;
    const basket = s.line[s.line.length - 1];
    const bs = this.project(new THREE.Vector3(basket.x, this.h(basket.x, basket.y), basket.y));
    const rect = this.container.getBoundingClientRect();
    const onBasket = !!bs && Math.hypot(bs.x - (ev.clientX - rect.left), bs.y - (ev.clientY - rect.top)) < 16;
    const last = this.lastPlotClick;
    const again = !!last && ev.timeStamp - last.time < 400 && Math.hypot(last.x - ev.clientX, last.y - ev.clientY) < 8;
    this.lastPlotClick = { x: ev.clientX, y: ev.clientY, time: ev.timeStamp };
    if (onBasket || again) {
      this.finishPlot();
      return;
    }
    this.plotPts.push(p);
    this.drawDraft();
  }

  /** A drag while plotting: the line drawn freehand from wherever it starts (then done). */
  private plotDrag(start: PointerEvent): Drag | null {
    const s = this.doc?.stats.find(x => x.holeId === this.plotHole);
    const g0 = this.groundAt(start.clientX, start.clientY);
    if (!s?.complete || !g0) return null;
    const tee = s.line[0], basket = s.line[s.line.length - 1];
    const free: P[] = [...this.plotPts, { x: g0.x, y: g0.z }];
    const step = Math.max(2, 6 / Math.max(0.01, this.viewInfo().pxPerUnit));
    return {
      move: ev => {
        const g = this.groundAt(ev.clientX, ev.clientY);
        if (g && dist(free[free.length - 1], { x: g.x, y: g.z }) >= step) free.push({ x: g.x, y: g.z });
        this.plotPts = free;
        this.cursor = null;
        this.drawDraft();
      },
      end: () => {
        // Smoothed into turns, none right at the tee or the basket
        const turns = simplify([tee, ...free, basket], step * 1.5).slice(1, -1).filter(p => dist(p, tee) > 12 && dist(p, basket) > 12);
        this.plotPts = turns;
        this.finishPlot();
      }
    };
  }

  /** Takes back the last point drawn (Backspace). */
  undoPoint() {
    if (this.plotHole) {
      if (!this.plotPts.length) return false;
      this.plotPts.pop();
      this.drawDraft();
      return true;
    }
    if (this.holeStart) { this.cancelDrawing(); return true; }
    if (!this.drawPts.length) return false;
    this.drawPts.pop();
    this.draftNote = "";
    this.drawDraft();
    this.cb.onDrawProgress(this.drawPts.length);
    this.handleKey = "";
    this.syncHandles();
    return true;
  }

  /** Drops what is being drawn (Esc). Returns whether there was anything. */
  cancelDrawing() {
    if (this.plotHole) {
      this.endPlot();
      return true;
    }
    if (this.obPick) {
      this.endObPick();
      return true;
    }
    return this.clearDrawing();
  }

  /** Whatever is half drawn let go of. */
  private clearDrawing() {
    const had = !!this.holeStart || this.drawPts.length > 0 || !!this.shapeAnchor;
    this.holeStart = null;
    this.shapeAnchor = null;
    this.drawPts = [];
    this.clearDraft();
    if (had) {
      this.cb.onDrawProgress(0);
      this.handleKey = "";
      this.syncHandles();
    }
    return had;
  }

  private clearDraft() {
    if (this.draft) {
      this.fx.remove(this.draft);
      disposeObjectDeep(this.draft);
      this.draft = null;
    }
    this.draftLabel?.remove();
    this.draftLabel = null;
    this.draftAt = null;
    this.draftNote = "";
    this.invalidate();
  }

  private drawDraft() {
    const doc = this.doc;
    if (this.draft) {
      this.fx.remove(this.draft);
      disposeObjectDeep(this.draft);
      this.draft = null;
    }
    if (!doc) return;
    const g = new THREE.Group();
    let label = "";
    if (this.holeStart) {
      const a = this.holeStart, b = this.cursor ?? a;
      g.add(this.fatLine(this.drapeLine([a, b], LIFT + 0.2), "#ffffff", 3, { dashed: 6, depthTest: false, order: 20 }));
      const len = dist(a, b);
      const dh = this.h(b.x, b.y) - this.h(a.x, a.y);
      const eff = len + (doc.course.rules?.elevationFactor ?? 3) * dh;
      label = this.draftNote && len <= 10 ? this.draftNote
        : len > 1 ? `${fmtDist(len, doc.course.units)}${Math.abs(dh) >= 1 ? ` · ${fmtElev(dh, doc.course.units)}` : ""} · par ${parForDistance(eff, this.teeLevel)}` : this.fingers ? "Tap where the basket goes" : "Click where the basket goes";
      this.draftAt = new THREE.Vector3(b.x, this.h(b.x, b.y), b.y);
    } else if (this.plotHole) {
      const s = doc.stats.find(x => x.holeId === this.plotHole);
      if (s?.complete) {
        const tee = s.line[0], basket = s.line[s.line.length - 1];
        const done = [tee, ...this.plotPts];
        const reach = this.cursor ? [...done, this.cursor] : done;
        // (the curve the hole's line will take through the turns so far, on to the basket)
        g.add(this.fatLine(this.drapeLine(smoothPath([...reach, basket], 10), LIFT + 0.2), "#fde68a", 3, { depthTest: false, order: 20 }));
        for (const p of this.plotPts) {
          const ring: P[] = [];
          for (let i = 0; i < 16; i++) ring.push({ x: p.x + Math.cos((i / 16) * Math.PI * 2) * 2.5, y: p.y + Math.sin((i / 16) * Math.PI * 2) * 2.5 });
          g.add(this.fatLine(this.drapeLine(ring, LIFT + 0.3, true), "#f59e0b", 3, { depthTest: false, order: 21 }));
        }
        const len = pathLength([...reach, basket]);
        label = `${fmtDist(len, doc.course.units)} · ${this.plotPts.length} turn${this.plotPts.length === 1 ? "" : "s"}`;
        const last = reach[reach.length - 1];
        this.draftAt = new THREE.Vector3(last.x, this.h(last.x, last.y), last.y);
      }
    } else if (this.drawPts.length) {
      let pts = [...this.drawPts];
      if (this.cursor) pts.push(this.cursor);
      const area = this.drawn() === "area";
      // (a path, walk, creek or road curves through its points as they are added)
      if (this.tool.mode === "draw-line" && curves({ kind: this.tool.lineKind })) pts = linePath({ kind: this.tool.lineKind, points: pts });
      const color = this.tool.mode === "draw-structure" ? STRUCTURE_KINDS[this.tool.structureKind ?? "bridge"].color : area ? AREA_KINDS[this.tool.areaKind].color : LINE_KINDS[this.tool.lineKind].color;
      // (an area curves through its corners as they are added, but a rectangle)
      const outline = area && pts.length >= 3 && this.tool.mode === "draw-area" && this.tool.shape !== "box" && areaCurves({ kind: this.tool.areaKind }) ? areaPath({ kind: this.tool.areaKind, points: pts }) : pts;
      if (area && pts.length >= 3) {
        const mesh = new THREE.Mesh(drapedPolygon(outline, (x, y) => this.h(x, y), doc.gridSize, 0.3), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, depthTest: false }));
        mesh.renderOrder = 19;
        g.add(mesh);
      }
      g.add(this.fatLine(this.drapeLine(area && pts.length >= 3 ? [...outline, outline[0]] : pts, LIFT + 0.2), color === "#ffffff" ? "#fde68a" : color, 3, { depthTest: false, order: 20 }));
      const len = pathLength(pts);
      // (the bar by the map finishes: the label only counts)
      const size = fmtArea(Math.abs(polygonArea(pts)), doc.course.units);
      const n = pts.length - (this.cursor ? 1 : 0);
      label = this.draftNote ? this.draftNote
        : this.shaping
        ? area ? `${size} · ${this.fingers ? "lift" : "let go"} to finish` : `${fmtDist(len, doc.course.units)} · ${this.fingers ? "lift" : "let go"} to finish`
        // (a rectangle or circle by two clicks: its first one made, the other to come)
        : this.shapeAnchor
        ? `${size} · ${this.fingers ? "tap" : "click"} ${this.shapeAnchor.shape === "circle" ? "the edge" : "the opposite corner"}`
        : area
        ? `${n >= 3 ? `${size} · ` : ""}${n} point${n === 1 ? "" : "s"}`
        : fmtDist(len, doc.course.units);
      const last = pts[pts.length - 1];
      this.draftAt = new THREE.Vector3(last.x, this.h(last.x, last.y), last.y);
    }
    g.traverse(o => { o.raycast = () => {}; });
    this.draft = g;
    this.fx.add(g);
    if (!this.draftLabel) {
      this.draftLabel = document.createElement("div");
      this.draftLabel.className = "dg-ov dg-measure total";
      this.draftLabel.setAttribute("data-testid", "draft-label");
      this.draftLabel.style.position = "absolute";
      this.labelsLayer.appendChild(this.draftLabel);
    }
    this.draftLabel.textContent = label;
    this.invalidate();
  }

  // ------------------------------------------------------------------ wheel, measure, hover

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.glide = null;
    this.lookGlide = null;
    e.stopPropagation();
    if (this.povHole) {
      const delta = (e.deltaMode !== 0 ? e.deltaY * 33 : e.deltaY) * 0.0015;
      this.povCam.fov = clamp(this.povCam.fov * Math.exp(delta), LENS.min, LENS.max);
      this.invalidate();
      return;
    }
    const line = e.deltaMode !== 0;
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const g0 = this.groundAt(e.clientX, e.clientY);
      const g1 = g0 && this.planeAt(e.clientX - e.deltaX, e.clientY, g0.y);
      if (g0 && g1) this.shift(g0.x - g1.x, g0.z - g1.z);
      return;
    }
    const delta = (line ? e.deltaY * 33 : e.deltaY) * (e.ctrlKey ? 0.01 : 0.002);
    this.zoomAt(e.clientX, e.clientY, Math.exp(delta));
  }

  // ------------------------------------------------------------------ you, on the map (GPS)

  /** Called when someone moves the map by hand (the map stops following you). */
  onUserMove: (() => void) | null = null;
  /** Marking a stretch of OB: whether its start is set (it waits for its end), or a click missed the line. */
  onObPick: ((at: { started: boolean; missed: boolean }) => void) | null = null;
  /** A check's mark on the map clicked (its text). */
  onIssue: ((text: string) => void) | null = null;

  /** The ground under the pointer, while it is over the map (Ctrl+V pastes there). */
  pointerGround(): P | null {
    const p = this.lastPointer;
    const g = p ? this.groundAt(p.x, p.y) : null;
    return g ? { x: g.x, y: g.z } : null;
  }
  private me: { mark: LocationMark; dot: HTMLDivElement; cone: HTMLElement; tag: HTMLDivElement; at: THREE.Vector3; ring: THREE.Object3D | null } | null = null;

  /** Whether you're shown on the map. */
  hasLocation() { return !!this.me; }

  /** You on the map (null: not shown); `follow`: the map keeps you in the middle of what's visible. */
  setLocation(mark: LocationMark | null, follow = false) {
    if (!mark) {
      if (this.me) {
        this.me.dot.remove();
        this.me.tag.remove();
        if (this.me.ring) { this.fx.remove(this.me.ring); disposeObjectDeep(this.me.ring); }
        this.me = null;
        this.invalidate();
      }
      return;
    }
    if (!this.me) {
      const dot = document.createElement("div");
      dot.className = "dg-ov dg-me";
      dot.setAttribute("data-testid", "my-location");
      const cone = document.createElement("i");
      dot.appendChild(cone);
      const tag = document.createElement("div");
      tag.className = "dg-ov dg-me-tag";
      tag.setAttribute("data-testid", "my-location-tag");
      this.labelsLayer.append(dot, tag);
      this.me = { mark, dot, cone, tag, at: new THREE.Vector3(), ring: null };
    }
    const me = this.me;
    const was = me.mark;
    me.mark = mark;
    me.at.set(mark.at.x, this.h(mark.at.x, mark.at.y) + 1, mark.at.y);
    me.dot.classList.toggle("dim", mark.dim);
    me.tag.textContent = mark.tag;
    me.tag.style.visibility = mark.tag ? "" : "hidden";
    // The circle of how sure it is, and the dashed line on to the basket: made again only when
    // either really changed (each reading moves them a hair, and the scene drawn again for that
    // kept a phone's screen busy the whole time the GPS was on)
    const near = (a: P | null | undefined, b: P | null | undefined, d = 1) => (!a && !b) || (!!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < d);
    // (a change worth it: a fair share of the circle's own size, at least 2 ft)
    const worth = Math.max(2, mark.acc * 0.25);
    const moved = !me.ring || Math.abs(was.acc - mark.acc) > worth || !near(was.at, mark.at, worth) || !near(was.to, mark.to, worth) || was.dim !== mark.dim;
    if (moved) {
      if (me.ring) { this.fx.remove(me.ring); disposeObjectDeep(me.ring); }
      const g = new THREE.Group();
      const r = Math.max(4, mark.acc);
      const ring: P[] = [];
      for (let i = 0; i < 72; i++) ring.push({ x: mark.at.x + Math.cos((i / 72) * Math.PI * 2) * r, y: mark.at.y + Math.sin((i / 72) * Math.PI * 2) * r });
      const color = mark.dim ? "#8e8e93" : "#0a84ff";
      const disc = new THREE.Mesh(drapedPolygon(ring, (x, y) => this.h(x, y), this.doc?.gridSize ?? 20, 0.4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, depthTest: false }));
      disc.renderOrder = 27;
      g.add(disc);
      g.add(this.fatLine(this.drapeLine(ring, 0.5, true), color, 1.5, { opacity: 0.55, depthTest: false, order: 28 }));
      if (mark.to) g.add(this.fatLine(this.drapeLine([mark.at, mark.to], LIFT + 0.35), "#ffffff", 2, { dashed: 6, opacity: 0.85, depthTest: false, order: 28 }));
      me.ring = g;
      this.fx.add(g);
    }
    if (follow) {
      const shift = this.insetShift(this.controls.distance);
      const cx = mark.at.x + shift.x, cy = mark.at.y + shift.y;
      void this.controls.moveTo(cx, this.h(cx, cy), cy, true);
    }
    // (only the circle or the map moving needs the scene drawn; the dot, its cone and its words lie
    // over it on the page)
    if (moved || follow) this.invalidate();
    else if (this.size.width > 1) this.layout();
  }

  /** A spot for the tool in hand, as if tapped there (where you stand, from the GPS): a new hole's
   * tee and then its basket, another tee or pin. False: not taken (the basket right by the tee). */
  toolPoint(p: P) {
    const mode = this.tool.mode;
    if (mode === "add-hole") {
      if (!this.holeStart) {
        this.holeStart = p;
        this.cursor = p;
        this.drawDraft();
        this.cb.onDrawProgress(1);
        return true;
      }
      if (dist(this.holeStart, p) <= 10) return false;
      const start = this.holeStart;
      this.holeStart = null;
      this.clearDraft();
      this.cb.onDrawProgress(0);
      this.cb.onHole(start, p);
      return true;
    }
    if (mode === "add-tee" || mode === "add-basket") { this.cb.onPlace(mode, p); return true; }
    // (a line or an area drawn point by point: the next corner; a rectangle, circle or freehand
    // shape is drawn on the map, not walked)
    if (this.drawn()) {
      if (this.tool.shape && this.tool.shape !== "points") return false;
      const last = this.drawPts[this.drawPts.length - 1];
      if (last && dist(last, p) < 1) return false;
      this.drawPts.push(p);
      this.draftNote = "";
      this.cursor = p;
      this.drawDraft();
      this.cb.onDrawProgress(this.drawPts.length);
      this.handleKey = "";
      this.syncHandles();
      this.invalidate();
      return true;
    }
    // (any other tool that puts a thing down where it's tapped: a bench, a sign, a mando, a tree)
    if (mode !== "select" && mode !== "sculpt" && mode !== "measure") {
      this.updateGhost(null);
      this.cb.onPlace(mode, p);
      return true;
    }
    return false;
  }

  /** The tool in hand: whether it puts something down from a spot (where you stand, say), and how:
   * one thing, or the next corner of a line or area drawn point by point. */
  toolTakesPoint(): "place" | "corner" | null {
    const mode = this.tool.mode;
    if (this.drawn()) return !this.tool.shape || this.tool.shape === "points" ? "corner" : null;
    return mode !== "select" && mode !== "sculpt" && mode !== "measure" && mode !== "add-hole" ? "place" : null;
  }

  /** The measure tool started at a spot (from the map's menu): the next tap measures from there. */
  measureFrom(p: P) {
    this.measurePts = [new THREE.Vector3(p.x, this.h(p.x, p.y), p.y)];
    this.measureCursor = null;
    this.drawMeasure();
  }

  /** Puts the dot (and its cone, turned the way you face on the screen) where you are. */
  private placeMe(place: (el: HTMLElement, world: THREE.Vector3 | null, dy?: number) => void) {
    const me = this.me;
    if (!me) return;
    place(me.dot, me.at);
    place(me.tag, me.at, 26);
    const f = me.mark.facing;
    if (f === null) { me.cone.style.display = "none"; return; }
    // (the way you face, as the screen shows it: north is -y on the plan, east +x)
    const a = this.project(me.at);
    const ahead = new THREE.Vector3(me.mark.at.x + Math.sin(f * DEG) * 30, me.at.y, me.mark.at.y - Math.cos(f * DEG) * 30);
    const b = this.project(ahead);
    if (!a || !b) { me.cone.style.display = "none"; return; }
    me.cone.style.display = "";
    me.cone.style.transform = `rotate(${Math.atan2(b.x - a.x, -(b.y - a.y))}rad)`;
  }

  private measurePts: THREE.Vector3[] = [];
  private measureCursor: THREE.Vector3 | null = null;
  private measureLine: THREE.Object3D | null = null;
  private measureLabels: { el: HTMLDivElement; at: THREE.Vector3 }[] = [];

  /** Points measured so far (plan coordinates), and the total length. */
  measurement() {
    const pts = this.measurePts.map(v => ({ x: v.x, y: v.z }));
    return { points: pts, total: pathLength(pts) };
  }

  /** What's measured taken off the map (the tool's Clear; Esc, another tool). */
  clearMeasure() {
    this.measurePts = [];
    this.measureCursor = null;
    this.drawMeasure();
  }

  /** From one spot (each click moves the other end) or along a path (each click adds a turn). */
  private measureMode: "spot" | "path" = "spot";
  setMeasureMode(mode: "spot" | "path") {
    if (mode === this.measureMode) return;
    this.measureMode = mode;
    if (this.measurePts.length) this.drawMeasure();
  }

  /** A click: the first point stays where it was put, each click after it moves the other end
   * (Shift+click, or along a path, adds a turn instead); Esc or another tool ends it. */
  private addMeasurePoint(p: THREE.Vector3, keepGoing: boolean) {
    if (this.measurePts.length >= 2 && !keepGoing && this.measureMode === "spot") this.measurePts = [this.measurePts[0]];
    this.measurePts.push(p.clone());
    this.drawMeasure();
  }

  private drawMeasure() {
    if (this.measureLine) {
      this.fx.remove(this.measureLine);
      disposeObjectDeep(this.measureLine);
      this.measureLine = null;
    }
    this.measureLabels.forEach(l => l.el.remove());
    this.measureLabels = [];
    const pts = [...this.measurePts];
    if (this.measureCursor && pts.length === 1) pts.push(this.measureCursor);
    const units = this.doc?.course.units ?? "ft";
    // (two points put down: where the next click would move the end to, faint, from the first;
    // along a path, the next turn from the last)
    const m = this.measurePts.length, path = this.measureMode === "path", last = this.measurePts[m - 1];
    const ahead = this.measureCursor && (path ? m >= 2 : m === 2) ? [path ? last : this.measurePts[0], this.measureCursor] : null;
    if (ahead && Math.hypot(ahead[1].x - last.x, ahead[1].z - last.z) < 0.5) ahead.length = 0;
    // A dot at each point (the pointer's end fainter)
    pts.forEach((v, i) => {
      const el = document.createElement("div");
      el.className = `dg-ov dg-mpt${i >= this.measurePts.length ? " live" : ""}`;
      el.setAttribute("data-testid", "measure-point");
      this.labelsLayer.appendChild(el);
      this.measureLabels.push({ el, at: v.clone() });
    });
    if (pts.length >= 2) {
      // (a thin line on a dark casing: it reads over grass, photo and woods alike)
      const line = this.drapeLine(pts.map(v => ({ x: v.x, y: v.z })), LIFT + 0.3);
      const g = new THREE.Group();
      g.add(this.fatLine(line, "#1c1917", 4.5, { depthTest: false, order: 29, opacity: 0.55 }));
      g.add(this.fatLine(line, "#facc15", 2, { depthTest: false, order: 30 }));
      if (ahead?.length) {
        const next = this.drapeLine(ahead.map(v => ({ x: v.x, y: v.z })), LIFT + 0.3);
        g.add(this.fatLine(next, "#facc15", 1.5, { depthTest: false, order: 30, opacity: 0.6, dashed: 4 }));
        const d = Math.hypot(ahead[1].x - ahead[0].x, ahead[1].z - ahead[0].z);
        const dh = ahead[1].y - ahead[0].y;
        const dot = document.createElement("div");
        dot.className = "dg-ov dg-mpt live";
        this.labelsLayer.appendChild(dot);
        this.measureLabels.push({ el: dot, at: ahead[1].clone() });
        if (d >= 0.5) {
          const el = document.createElement("div");
          el.className = "dg-ov dg-measure live";
          el.setAttribute("data-testid", "measure-next");
          el.textContent = `${fmtDist(d, units)}${Math.abs(dh) >= 1 ? ` · ${fmtElev(dh, units)}` : ""}`;
          this.labelsLayer.appendChild(el);
          this.measureLabels.push({ el, at: ahead[1].clone() });
        }
      }
      this.measureLine = g;
      this.fx.add(this.measureLine);
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        total += d;
        const dh = pts[i].y - pts[i - 1].y;
        // (the pointer still on the point just put down: no "0 ft" tag)
        if (d < 0.5) continue;
        const el = document.createElement("div");
        el.className = "dg-ov dg-measure";
        el.setAttribute("data-testid", "measure-label");
        el.textContent = `${fmtDist(d, units)}${Math.abs(dh) >= 1 ? ` · ${fmtElev(dh, units)}` : ""}`;
        this.labelsLayer.appendChild(el);
        this.measureLabels.push({ el, at: pts[i - 1].clone().lerp(pts[i], 0.5) });
      }
      if (pts.length > 2) {
        const el = document.createElement("div");
        el.className = "dg-ov dg-measure total";
        el.textContent = `Total ${fmtDist(total, units)}`;
        this.labelsLayer.appendChild(el);
        this.measureLabels.push({ el, at: pts[pts.length - 1].clone() });
      }
    }
    this.invalidate();
  }

  /** Drag in the tee view to look around. */
  /** Standing, editing: a tap picks what's there, as a click on the map does (a tree standing over
   * a big shape first: most trees stand in a wood); a tap on open ground lets go. */
  private povTapPick(ev: PointerEvent) {
    const hit = this.pick(ev.clientX, ev.clientY);
    const it = hit ? this.item(hit) : null;
    const big = (!hit || (!!it && (it.type === "area" || it.type === "line" || it.type === "structure")) || (!it && !!this.hole(hit))) && !(hit && this.pickedEdge);
    const tree = big && !this.readOnly ? this.treeAtScreen(ev.clientX, ev.clientY) : null;
    if (tree) this.cb.onAdoptTree(tree, this.lookOf(tree));
    else this.cb.onSelect(hit);
  }

  /** Standing: a drag looks around; a tap (`onTap`, or else) walks there, unless `lookOnly`. */
  private povDrag(e: PointerEvent, lookOnly = false, onTap?: (ev: PointerEvent) => void) {
    if (this.fly) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const start = { ...this.povLook };
    const degPerPx = this.povCam.fov / Math.max(1, this.size.height);
    const free = this.free, from = free ? { yaw: free.yaw, pitch: free.pitch } : null;
    // (where the look was over the last moments, by when each move happened: the flick's speed)
    const trail: { t: number; yaw: number; pitch: number }[] = [{ t: e.timeStamp, yaw: free ? free.yaw : start.yaw, pitch: free ? free.pitch : start.pitch }];
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) moved = true;
      // (by hand: the camera turns the same way the view from a tee does)
      if (free && from) {
        if (this.free !== free) return;
        free.yaw = from.yaw - (ev.clientX - x0) * degPerPx * DEG;
        free.pitch = clamp(from.pitch + (ev.clientY - y0) * degPerPx * DEG, -85 * DEG, 85 * DEG);
        trail.push({ t: ev.timeStamp, yaw: free.yaw, pitch: free.pitch });
      } else {
        this.povLook = {
          yaw: start.yaw - (ev.clientX - x0) * degPerPx * DEG,
          pitch: clamp(start.pitch + (ev.clientY - y0) * degPerPx * DEG, -70 * DEG, 50 * DEG)
        };
        trail.push({ t: ev.timeStamp, ...this.povLook });
      }
      if (trail.length > 8) trail.shift();
      this.invalidate();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.endDragListeners = null;
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      // (let go while turning, one finger lifted last: the view turns on, slowing, as the map does)
      if (moved && ev.type === "pointerup" && this.touchIds.size === 0) this.lookFling(trail, ev.timeStamp, degPerPx * DEG);
      if (!moved && onTap) { onTap(ev); return; }
      // (a press that didn't move, on open ground in the view: a step there)
      if (!moved && !lookOnly && !this.fly && !free && this.tool.mode === "select" && this.eyeAt(ev.clientX, ev.clientY).cam === this.povCam) {
        const g = this.groundAt(ev.clientX, ev.clientY);
        if (g) this.walkTo({ x: g.x, y: g.z });
      }
    };
    // (a second finger ends it: see secondFinger)
    this.endDragListeners?.();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.endDragListeners = cleanup;
  }

  /** Standing (or the free camera), the view still turning after a look let go of while turning
   * (radians a second). */
  private lookGlide: { yaw: number; pitch: number } | null = null;
  /** A flick of the look: its speed over the last tenth of a second (none if held still before
   * letting go, or turning slowly); `radPerPx`, how far a pixel turns it. */
  private lookFling(trail: { t: number; yaw: number; pitch: number }[], at: number, radPerPx: number) {
    const last = trail[trail.length - 1];
    if (!last || at - last.t > 60) return;
    const first = trail.find(s => last.t - s.t <= 100);
    if (!first || last.t - first.t < 16) return;
    const sec = (last.t - first.t) / 1000;
    let yaw = (last.yaw - first.yaw) / sec, pitch = (last.pitch - first.pitch) / sec;
    const px = Math.hypot(yaw, pitch) / radPerPx;
    if (px < 250) return;
    if (px > 4000) { yaw *= 4000 / px; pitch *= 4000 / px; }
    this.lookGlide = { yaw, pitch };
    this.invalidate();
  }
  private stepLookGlide(dt: number) {
    const g = this.lookGlide!;
    const k = Math.exp(-Math.min(dt, 0.1) / GLIDE_TAU), f = GLIDE_TAU * (1 - k);
    const free = this.free;
    if (free) {
      free.yaw += g.yaw * f;
      const p = clamp(free.pitch + g.pitch * f, -85 * DEG, 85 * DEG);
      if (p !== free.pitch + g.pitch * f) g.pitch = 0;
      free.pitch = p;
    } else if (this.povHole) {
      const p = clamp(this.povLook.pitch + g.pitch * f, -70 * DEG, 50 * DEG);
      // (at the top or bottom of the look: no more up or down, still turning)
      if (p !== this.povLook.pitch + g.pitch * f) g.pitch = 0;
      this.povLook = { yaw: this.povLook.yaw + g.yaw * f, pitch: p };
    } else { this.lookGlide = null; return; }
    g.yaw *= k;
    g.pitch *= k;
    const radPerPx = (this.povCam.fov * DEG) / Math.max(1, this.size.height);
    if (Math.hypot(g.yaw, g.pitch) / radPerPx < 20) this.lookGlide = null;
  }

  /** Zoom keeping the ground point under the cursor fixed. */
  private zoomAt(clientX: number, clientY: number, factor: number, smooth = true) {
    const pos = this.controls.getPosition(new THREE.Vector3(), true);
    const target = this.controls.getTarget(new THREE.Vector3(), true);
    const d = pos.distanceTo(target);
    const f = clamp(d * factor, this.controls.minDistance, this.controls.maxDistance) / d;
    if (Math.abs(f - 1) < 1e-4) return;
    const p = this.groundAt(clientX, clientY) ?? target.clone();
    const np = p.clone().add(pos.sub(p).multiplyScalar(f));
    const nt = p.clone().add(target.sub(p).multiplyScalar(f));
    void this.controls.setLookAt(np.x, np.y, np.z, nt.x, nt.y, nt.z, smooth);
    this.controls.normalizeRotations();
    this.invalidate();
  }

  private onDoubleClick(e: MouseEvent) {
    if (this.povHole) return;
    if (this.drawn()) {
      // The double-click's two clicks each added a point: drop the repeat, then finish
      if (this.drawPts.length >= 2 && dist(this.drawPts[this.drawPts.length - 1], this.drawPts[this.drawPts.length - 2]) < 3) this.drawPts.pop();
      this.finishDrawing();
      return;
    }
    if (this.tool.mode !== "select") return;
    if ((e.target as HTMLElement).closest?.("[data-handle],[data-item-id]")) return;
    if (this.pick(e.clientX, e.clientY)) return;
    this.zoomAt(e.clientX, e.clientY, 0.5);
  }

  private onHoverMove(e: PointerEvent) {
    if (e.buttons || this.dragging || (this.povHole && (this.fly || this.free))) return;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const p = this.lastPointer;
      if (!p || !this.doc) return;
      const g = this.groundAt(p.x, p.y);
      this.cb.onHover(g ? { x: g.x, y: g.z } : null);
      if (this.obPick && g) { this.obPickHover({ x: g.x, y: g.z }); return; }
      // (standing, picking or walking: the pointer says which)
      if (this.povHole && this.tool.mode === "select") { this.povHover(p, g); return; }
      if (this.povHole) { this.showStep(null); this.tip(null); }
      // (the brush's circle where it would paint)
      const painting = this.tool.mode === "sculpt" || (this.tool.mode === "draw-area" && this.tool.shape === "paint");
      if (painting) this.showBrush(g ? { x: g.x, y: g.z } : null, this.tool.brush?.size ?? 20);
      else if (this.brushRing?.obj.visible) this.showBrush(null, 0);
      if (this.tool.mode === "measure") {
        // (only over the site: a tilted view's horizon would stretch the line across the screen)
        const w = this.doc.course.canvas;
        const over = !!g && g.x >= 0 && g.z >= 0 && g.x <= w.width && g.z <= w.height;
        const m = this.measurePts.length;
        if (m >= 1 && (m <= 2 || this.measureMode === "path") && (over || this.measureCursor)) {
          this.measureCursor = over ? g : null;
          this.drawMeasure();
        }
        return;
      }
      if (this.shapeAnchor) {
        const pts = this.shapePoints(this.shapeAnchor.shape, this.shapeAnchor, p);
        if (pts) {
          this.drawPts = pts;
          this.cursor = null;
          this.drawDraft();
          this.drawPts = [];
        }
        return;
      }
      if (this.holeStart || this.drawPts.length || this.plotHole) {
        if (g) {
          this.cursor = { x: g.x, y: g.z };
          this.drawDraft();
        }
        return;
      }
      const target = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      if (this.tool.mode === "select") {
        const dom = (target?.closest?.("[data-item-id]") as HTMLElement | null)?.dataset.itemId ?? null;
        if (this.readOnly) this.setHover(this.holeFor(dom ?? (target?.closest?.("[data-handle]") ? null : this.pick(p.x, p.y))));
        else if (target?.closest?.("[data-handle]")) this.setHover(null);
        else { const t = this.clickTarget(p.x, p.y, dom); this.setHover(t.id, t.tree); this.restTip(p, t.id, t.tree); }
      } else {
        this.setHover(null);
        this.updateGhost(g);
      }
    });
  }

  private updateCursor() {
    const t = this.tool;
    let c = t.dragSelect && t.mode === "select" ? "crosshair" : "grab";
    if (this.povHole) c = this.teeEdit && this.hoverId ? "pointer" : this.teeEdit && t.mode !== "select" ? "crosshair" : "move";
    else if (this.obPick) c = "crosshair";
    else if (t.mode !== "select") c = "crosshair";
    else if (this.hoverId) {
      const it = this.item(this.hoverId);
      c = !it || ((it.type === "area" || it.type === "line" || it.type === "structure") && this.hoverId !== this.selectedId && !this.group.includes(this.hoverId)) ? "pointer" : it.type === "area" && !this.hoverEdge && !this.group.includes(this.hoverId) ? "grab" : "move";
    } else if (this.hoverTree) c = "pointer";
    this.container.style.cursor = c;
  }

  // ------------------------------------------------------------------ placement preview

  private updateGhost(at: THREE.Vector3 | null) {
    const mode = this.tool.mode;
    const kind = mode === "add-tee" ? "tee" : mode === "add-basket" ? "basket" : mode === "add-mando" ? "mando" : mode === "add-dropzone" ? "dropzone" : mode === "add-tree" ? "tree" : mode === "add-amenity" ? "amenity" : mode === "add-field" ? "field" : "";
    if (!at || !kind || !this.doc) {
      if (this.ghost) {
        this.fx.remove(this.ghost);
        disposeObjectDeep(this.ghost);
        this.ghost = null;
        this.ghostKey = "";
      }
      this.invalidate();
      return;
    }
    // (the Tree tool's preview: the kind it plants, as big as it plants it)
    const tk = this.tool.treeKind ?? "deciduous";
    const fk = this.tool.fieldKind ?? "baseball";
    const key = kind === "tree" ? `tree:${tk}` : kind === "tee" ? `tee:${this.teeLevel}` : kind === "amenity" ? `amenity:${this.amenityKind}` : kind === "field" ? `field:${fk}` : kind;
    if (this.ghostKey !== key) {
      if (this.ghost) {
        this.fx.remove(this.ghost);
        disposeObjectDeep(this.ghost);
      }
      this.ghostKey = key;
      const obj = kind === "field" ? this.fieldGhost(fk)
        : kind === "basket" ? createBasket(this.doc.course.style.basketBand ?? BASKET_BAND)
        : kind === "mando" ? createMando("right")
        : kind === "dropzone" ? createDropZone()
        : kind === "amenity" ? createAmenity(this.amenityKind)
        : kind === "tree" ? create3dTree(tk === "bush" ? { id: "ghost", type: "tree", x: 0, y: 0, rotation: 0, radius: 5, height: 6, treeType: "bush", color: "#4a7a3a" } : tk === "conifer" ? { id: "ghost", type: "tree", x: 0, y: 0, rotation: 0, radius: 10, height: 50, treeType: "conifer", color: "#2f5d34" } : { id: "ghost", type: "tree", x: 0, y: 0, rotation: 0, radius: 14, height: 40, color: "#4a7a3a" })
        : createTeePad({ id: "ghost", type: "tee", holeId: "", level: this.teeLevel, x: 0, y: 0, rotation: 0, padWidth: 5, padLength: 12, surface: "concrete" }, 0);
      obj.traverse(o => {
        const mesh = o as THREE.Mesh;
        const see = (m: THREE.Material) => { const c = m.clone(); c.userData = { ...c.userData, shared: false }; c.transparent = true; c.opacity = 0.55; c.depthWrite = false; return c; };
        if (mesh.material) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(see) : see(mesh.material);
        o.raycast = () => {};
      });
      this.ghost = obj;
      this.fx.add(obj);
    }
    this.ghost!.position.set(at.x, at.y + (kind === "field" ? 0.6 : OBJECT_ELEVATION_OFFSET), at.z);
    this.invalidate();
  }

  /** The Park tool's preview: the field at its usual size, flat, round the pointer. */
  private fieldGhost(k: NonNullable<ViewTool["fieldKind"]>) {
    const g = new THREE.Group();
    const plan = fieldPlan({ id: "ghost", points: fieldOutline(k, { x: 0, y: 0 }), field: k });
    if (!plan) return g;
    const mesh = createFieldGround(plan, fieldInks("natural", this.doc?.course.style.fairway), () => 0, 1000, 0);
    (mesh.material as THREE.Material).depthTest = false;
    mesh.renderOrder = 9;
    g.add(mesh);
    return g;
  }
}
