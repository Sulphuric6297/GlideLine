// How buildings look in 3D: their walls and roofs from CC0 scans (public/buildings, made by
// scripts/building-textures.py), each loaded once and shared by every building, and painted any
// color in the shader: its own light and dark kept round the color picked (so a color costs nothing
// but a material). Trim, doors and shutters are plain paint; windows have glass that reflects the
// sky and a dim room behind it.
import * as THREE from "three";
import type { RoofingKind, SidingKind } from "../types";

/** A scan: one tile's size, ft; its average brightness (linear); how much of its light and dark
 * it keeps painted; how metallic; its average color (shown until the scan has loaded). */
type Scan = { ft: number; avg: number; keep: number; metal?: number; rough?: number; natural: string };
// (from scripts/building-textures.py's textures.json)
const SCANS: Record<string, Scan> = {
  lap: { ft: 3.35, avg: 0.53, keep: 0.7, natural: "#d9d2b4" },
  board: { ft: 4.9, avg: 0.0596, keep: 0.45, natural: "#4a4744" },
  brick: { ft: 3.3, avg: 0.1086, keep: 0.55, natural: "#7d4a3c" },
  stone: { ft: 4.9, avg: 0.188, keep: 0.85, natural: "#8f7d66" },
  stucco: { ft: 6, avg: 0.6694, keep: 0.5, natural: "#dcdad3" },
  metal: { ft: 3.7, avg: 0.4353, keep: 0.5, metal: 0.55, rough: 0.5, natural: "#a8adb0" },
  shingles: { ft: 13, avg: 0.1041, keep: 0.6, natural: "#5d5a55" },
  slate: { ft: 9.8, avg: 0.2534, keep: 0.6, natural: "#8a857c" },
  clay: { ft: 8.2, avg: 0.1275, keep: 0.6, natural: "#9a4a2a" },
  roofmetal: { ft: 6.6, avg: 0.0443, keep: 0.45, metal: 0.5, rough: 0.45, natural: "#6a2420" },
  shakes: { ft: 13, avg: 0.192, keep: 0.6, natural: "#8b7a66" }
};
/** How much darker a painted roof is than its paint chip (linear; a roof faces the sky, and reads
 * darker than its color on the ground, as roofs always have here), and the same for a swatch (CSS). */
export const ROOF_SHADE = 0.45;
export const ROOF_SHADE_CSS = 0.7;
/** The scan a wall's siding is. */
export const SIDING_SCAN: Record<SidingKind, string> = { lap: "lap", board: "board", brick: "brick", stone: "stone", stucco: "stucco", metal: "metal" };
/** The scan a roof's roofing is. */
export const ROOFING_SCAN: Record<RoofingKind, string> = { shingles: "shingles", slate: "slate", clay: "clay", metal: "roofmetal", shakes: "shakes" };
/** A scan's own average color (a swatch's "Natural", before its picture is in). */
export const naturalColor = (scan: string) => SCANS[scan]?.natural ?? "#888888";
/** A scan's picture, for a swatch (its color file). */
export const scanUrl = (scan: string) => `${import.meta.env.BASE_URL}buildings/${scan}.jpg`;

// ------------------------------------------------------------------ the scans, loaded once

const loaded = new Map<string, { map: THREE.Texture; normal: THREE.Texture } | "loading">();
const waiting = new Map<string, Set<THREE.MeshStandardMaterial>>();
const looksLoaded = new Set<() => void>();
/** Calls back when a scan's picture has come in (the 3D view draws again); returns the call to stop. */
export const onLookLoaded = (f: () => void) => { looksLoaded.add(f); return () => { looksLoaded.delete(f); }; };

const tile = (t: THREE.Texture, ft: number, srgb: boolean) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / ft, 1 / ft);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  return t;
};

const fill = (m: THREE.MeshStandardMaterial, s: { map: THREE.Texture; normal: THREE.Texture }) => {
  m.map = s.map;
  m.normalMap = s.normal;
  m.color.set("#ffffff");
  m.needsUpdate = true;
};

/** Starts loading a scan (once); its materials take it when it's in. */
const want = (scan: string, m: THREE.MeshStandardMaterial) => {
  const got = loaded.get(scan);
  if (got && got !== "loading") return fill(m, got);
  let set = waiting.get(scan);
  if (!set) waiting.set(scan, (set = new Set()));
  set.add(m);
  if (got === "loading" || typeof document === "undefined") return;
  loaded.set(scan, "loading");
  const L = new THREE.TextureLoader(), ft = SCANS[scan].ft;
  Promise.all([L.loadAsync(scanUrl(scan)), L.loadAsync(`${import.meta.env.BASE_URL}buildings/${scan}-normal.jpg`)]).then(([map, normal]) => {
    const s = { map: tile(map, ft, true), normal: tile(normal, ft, false) };
    loaded.set(scan, s);
    for (const mm of waiting.get(scan) ?? []) fill(mm, s);
    waiting.delete(scan);
    for (const f of looksLoaded) f();
  }, () => { loaded.delete(scan); /* (its average color stays) */ });
};

// ------------------------------------------------------------------ materials

const surfaces = new Map<string, THREE.MeshStandardMaterial>();
/**
 * A wall's or a roof's surface: `scan` painted `color` (unset: its own colors). Shared by every
 * building in that color. Roofs are seen from under the eaves too (`twoSided`).
 */
export const surface = (scan: string, color?: string, twoSided = false, shade = 1) => {
  const s = SCANS[scan] ?? SCANS.lap;
  const id = `${scan}|${color ?? ""}|${twoSided ? 2 : 1}|${shade}`;
  let m = surfaces.get(id);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: color ?? s.natural, roughness: s.rough ?? 0.9, metalness: s.metal ?? 0, side: twoSided ? THREE.DoubleSide : THREE.FrontSide });
  const tint = new THREE.Color(color ?? "#ffffff").multiplyScalar(shade);
  const on = color ? 1 : 0;
  // (painted: the scan's brightness over its average, `keep` of it, times the color; its own
  // colors when not painted)
  m.onBeforeCompile = sh => {
    sh.uniforms.lookTint = { value: tint };
    sh.uniforms.lookOn = { value: on };
    sh.uniforms.lookAvg = { value: s.avg };
    sh.uniforms.lookKeep = { value: s.keep };
    sh.fragmentShader = "uniform vec3 lookTint;\nuniform float lookOn, lookAvg, lookKeep;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec4 lookTx = texture2D( map, vMapUv );
        float lookL = dot( lookTx.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        vec3 lookPaint = lookTint * clamp( mix( 1.0, lookL / lookAvg, lookKeep ), 0.0, 1.9 );
        diffuseColor.rgb *= mix( lookTx.rgb, lookPaint, lookOn );
      #endif`);
  };
  m.customProgramCacheKey = () => "building-look";
  m.userData.shared = true;
  surfaces.set(id, m);
  want(scan, m);
  return m;
};

const paints = new Map<string, THREE.MeshStandardMaterial>();
/** Plain paint (trim, a door, shutters, window frames), shared by color. */
export const paint = (color: string, rough = 0.6) => {
  const id = `${color}|${rough}`;
  let m = paints.get(id);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough });
    m.userData.shared = true;
    paints.set(id, m);
  }
  return m;
};

let glassMat: THREE.MeshStandardMaterial | null = null;
/** Window glass: the sky reflected over what's behind it (added, so the room shows through). */
export const glass = () => {
  if (glassMat) return glassMat;
  glassMat = new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 1, roughness: 0.06, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 1.3 });
  glassMat.userData.shared = true;
  return glassMat;
};

let roomMat: THREE.MeshBasicMaterial | null = null;
/** The room seen through a window: four of them side by side (curtains, blinds, a lamp's glow,
 * plain), a window's texture coordinates picking one. Dim, as a room is from outside by day. */
export const room = () => {
  if (roomMat) return roomMat;
  let map: THREE.Texture | null = null;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      for (let n = 0; n < 4; n++) {
        const x0 = n * 256;
        const bg = g.createLinearGradient(0, 0, 0, 256);
        bg.addColorStop(0, n === 2 ? "#6e5c48" : "#564c43");
        bg.addColorStop(1, "#231e1a");
        g.fillStyle = bg;
        g.fillRect(x0, 0, 256, 256);
        g.fillStyle = "#3a312a";
        g.fillRect(x0 + 40 + n * 25, 150, 120, 106);
        if (n === 1) for (let y = 0; y < 110; y += 7) { g.fillStyle = y % 14 ? "#d8d2c4" : "#bdb6a8"; g.fillRect(x0, y, 256, 5); }
        else if (n !== 3) for (const side of [0, 1]) for (let x = 0; x < 64; x++) {
          const f = 0.75 + 0.25 * Math.sin(x * 0.5);
          g.fillStyle = `rgb(${Math.round(232 * f)},${Math.round(226 * f)},${Math.round(212 * f)})`;
          g.fillRect(side ? x0 + 255 - x : x0 + x, 0, 1, 256);
        }
      }
      map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      map.userData.shared = true;
    }
  }
  roomMat = new THREE.MeshBasicMaterial({ map, color: map ? "#8a8a8a" : "#3a332d" });
  roomMat.userData.shared = true;
  return roomMat;
};
