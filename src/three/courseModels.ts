// 3D models of the course's furniture at real size (feet): tee pads, baskets, mando and drop
// zone signs, benches, cans, kiosks and so on. Built from simple shapes; materials are shared.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AMENITY_KINDS, TEE_LEVELS, TEE_SURFACES } from "../constants";
import type { AmenityKind, TeeItem } from "../types";

const mats = new Map<string, THREE.Material>();
const mat = (key: string, make: () => THREE.Material) => {
  let m = mats.get(key);
  if (!m) {
    m = make();
    m.userData.shared = true;
    mats.set(key, m);
  }
  return m;
};
const std = (color: string | number, roughness = 0.8, metalness = 0) =>
  mat(`std:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};
const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16, open = false) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg, 1, open), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

/** A sign face with text, as a texture (for tee signs, mando arrows, DZ plates). */
const signTexture = (key: string, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 128) => {
  if (typeof document === "undefined") return null;
  const k = `tex:${key}`;
  const cached = mats.get(k) as THREE.MeshStandardMaterial | undefined;
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  m.userData.shared = true;
  mats.set(k, m);
  return m;
};

/**
 * A tee pad: a slab facing +x (its length along x), the tee color painted at its front edge, and
 * the tee sign on a post behind it.
 */
export const createTeePad = (tee: TeeItem, holeNumber: number | string) => {
  const g = new THREE.Group();
  const L = tee.padLength, W = tee.padWidth;
  const thick = tee.surface === "natural" ? 0.05 : 0.35;
  // (the pad and what is painted on it, tilted with the ground: see fitTeePad)
  const deck = new THREE.Group();
  deck.name = "tee-deck";
  g.add(deck);
  const slab = box(L, thick, W, std(TEE_SURFACES[tee.surface].color, tee.surface === "rubber" ? 0.95 : 0.9), 0, thick / 2 - 0.05, 0);
  slab.name = "tee-pad";
  deck.add(slab);
  // Painted tee color: a band across the front, plus the hole number on the pad
  const lvl = TEE_LEVELS[tee.level];
  const band = box(0.8, 0.02, W * 0.96, std(lvl.color, 0.7), L / 2 - 0.6, thick - 0.04, 0);
  deck.add(band);
  const onTop: THREE.Object3D[] = [band];
  const plate = signTexture(`pad:${holeNumber}:${tee.level}`, (c, w, h) => {
    c.fillStyle = lvl.color;
    c.fillRect(0, 0, w, h);
    c.fillStyle = lvl.ink;
    c.font = `bold ${h * 0.8}px Oswald, Inter, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(holeNumber), w / 2, h / 2 + 4);
  }, 128, 128);
  if (plate) {
    const num = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2, W * 0.5), Math.min(2, W * 0.5)), plate);
    num.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    num.position.set(-L / 2 + 1.4, thick - 0.03, 0);
    deck.add(num);
    onTop.push(num);
  }
  // The tee sign: behind the pad, a little to the side, facing the player (toward -x): a board on
  // two posts behind it
  const sign = new THREE.Group();
  const wood = std("#5b4636", 0.9);
  for (const z of [-0.7, 0.7]) sign.add(cyl(0.12, 0.12, 4.15, wood, 0.19, 0, z, 8));
  const face = signTexture(`tee-sign:${holeNumber}`, (c, w, h) => {
    c.fillStyle = "#14532d";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#fefce8";
    c.lineWidth = 6;
    c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = "#fefce8";
    c.font = `bold ${h * 0.55}px Oswald, Inter, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(`HOLE ${holeNumber}`, w / 2, h / 2 + 4);
  });
  const board = box(0.12, 1.2, 1.8, face ?? std("#14532d"), 0, 3.6, 0);
  sign.add(board);
  sign.position.set(-L / 2 - 2.5, 0, W / 2 + 1.5);
  g.add(sign);
  for (const o of onTop) o.userData.y0 = o.position.y;
  g.userData.pad = { deck, slab, onTop, sign, thick };
  return g;
};

/** How steep a tee pad can lie with the ground (about 8°); steeper ground is built up under it. */
const PAD_TILT = Math.tan((8 * Math.PI) / 180);

/**
 * A tee pad on sloping ground (placed at its middle's ground height, facing `aim` degrees): tilted
 * with the ground as far as a pad can be, raised just clear of the highest ground under it and
 * built down into the lowest, so the ground never cuts through it; the sign's posts on their own
 * ground.
 */
export const fitTeePad = (obj: THREE.Object3D, tee: Pick<TeeItem, "x" | "y" | "padLength" | "padWidth">, aim: number, ground: (x: number, y: number) => number) => {
  const pad = obj.userData.pad as { deck: THREE.Object3D; slab: THREE.Object3D; onTop: THREE.Object3D[]; sign: THREE.Object3D; thick: number } | undefined;
  if (!pad) return;
  const a = (aim * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const L = tee.padLength, W = tee.padWidth;
  const at = (lx: number, lz: number) => ground(tee.x + lx * c - lz * s, tee.y + lx * s + lz * c);
  const g0 = ground(tee.x, tee.y);
  // The ground under it, every couple of feet (along its length x and across it z)
  const nx = Math.max(2, Math.ceil(L / 2)), nz = Math.max(2, Math.ceil(W / 2));
  const pts: { x: number; z: number; d: number }[] = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const x = (i / nx - 0.5) * L, z = (j / nz - 0.5) * W;
    pts.push({ x, z, d: at(x, z) - g0 });
  }
  // Its slope each way (the ground's, as far as a pad can lie)
  const fit = (k: "x" | "z") => pts.reduce((t, p) => t + p[k] * p.d, 0) / (pts.reduce((t, p) => t + p[k] * p[k], 0) || 1);
  const tx = Math.max(-PAD_TILT, Math.min(PAD_TILT, fit("x"))), tz = Math.max(-PAD_TILT, Math.min(PAD_TILT, fit("z")));
  pad.deck.rotation.set(-Math.atan(tz), 0, Math.atan(tx), "XYZ");
  // What is left above and below that slope
  let hi = 0, lo = 0;
  for (const p of pts) {
    const r = p.d - (p.x * tx + p.z * tz);
    hi = Math.max(hi, r);
    lo = Math.min(lo, r);
  }
  const top0 = pad.thick - 0.05;
  const top = hi + top0, bottom = lo - 0.2;
  pad.slab.scale.y = (top - bottom) / pad.thick;
  pad.slab.position.y = (top + bottom) / 2;
  for (const o of pad.onTop) o.position.y = (o.userData.y0 as number) + hi;
  pad.sign.position.y = at(pad.sign.position.x, pad.sign.position.z) - g0;
};

/** A basket's shapes (ft, its foot at 0), the same for every basket: made once. A championship
 * chain basket at its real size (as PDGA-certified ones measure): a 4.8 cm galvanized pole; a wire
 * tray 65 cm across inside and 23 cm deep, its rolled rim 81 cm off the ground, a wire grid for
 * its bottom; chains (16 outer, 8 inner) hanging from rings under a 57 cm band about 52 cm over
 * the tray, gathered to a collar just above its rim; spokes and a cap on top. Three versions:
 * up close the chains are links; in the middle distance smooth strands; far off a see-through
 * cone (thin wire would only glitter) and the tray solid. */
let basketShapes: ReturnType<typeof makeBasketShapes> | null = null;
/** Heights (ft): the tray's bottom and rim, the chains' collar, the band's bottom and top; radii. */
export const BASKET = { TRAY: 1.88, RIM: 2.66, COLLAR: 2.9, BAND: 4.36, TOP: 4.62, TRAY_R: 1.1, BAND_R: 0.94, POLE_R: 0.079 };
const makeBasketShapes = () => {
  const { TRAY, RIM, COLLAR, BAND, TOP, TRAY_R, BAND_R, POLE_R } = BASKET;
  const up = new THREE.Vector3(0, 1, 0);
  // A rod from a to b
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 5) => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  const ring = (r: number, tube: number, y: number, seg = 48, sides = 6) => new THREE.TorusGeometry(r, tube, sides, seg).rotateX(Math.PI / 2).translate(0, y, 0);
  const at = (a: number, r: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  const shared = (g: THREE.BufferGeometry) => {
    g.userData.shared = true;
    return g;
  };
  // (all of a kind merged: drop what one of the shapes has and another hasn't)
  const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k); return n; }))!;
  const BOTTOM_R = TRAY_R - 0.09;
  // The pole (into the ground), a sleeve under the tray, the collar the chains gather to, a cap
  const pole = merge([
    new THREE.CylinderGeometry(POLE_R, POLE_R, TOP + 0.4, 14).translate(0, (TOP + 0.4) / 2 - 0.4, 0),
    new THREE.CylinderGeometry(0.11, 0.11, 0.32, 14).translate(0, TRAY - 0.16, 0),
    new THREE.CylinderGeometry(0.115, 0.115, 0.12, 14).translate(0, COLLAR, 0),
    new THREE.SphereGeometry(0.1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, TOP + 0.01, 0)
  ]);
  // The tray: a rolled rim, a ring halfway down, the bottom ring, upright wires; its bottom a grid
  const steel: THREE.BufferGeometry[] = [ring(TRAY_R, 0.045, RIM, 64, 8), ring((TRAY_R + BOTTOM_R) / 2, 0.02, (TRAY + RIM) / 2), ring(BOTTOM_R, 0.03, TRAY), ring(0.16, 0.02, TRAY, 16)];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    steel.push(rod(at(a, BOTTOM_R, TRAY), at(a, TRAY_R, RIM), 0.016));
  }
  for (let k = -5; k <= 5; k++) {
    const u = (k / 5.5) * BOTTOM_R, half = Math.sqrt(BOTTOM_R * BOTTOM_R - u * u);
    if (Math.abs(u) < 0.14) {
      // (by the pole: the wire stops at the small ring)
      for (const s of [-1, 1]) {
        steel.push(rod(new THREE.Vector3(u, TRAY, s * 0.16), new THREE.Vector3(u, TRAY, s * half), 0.012, 4));
        steel.push(rod(new THREE.Vector3(s * 0.16, TRAY + 0.012, u), new THREE.Vector3(s * half, TRAY + 0.012, u), 0.012, 4));
      }
      continue;
    }
    steel.push(rod(new THREE.Vector3(u, TRAY, -half), new THREE.Vector3(u, TRAY, half), 0.012, 4));
    steel.push(rod(new THREE.Vector3(-half, TRAY + 0.012, u), new THREE.Vector3(half, TRAY + 0.012, u), 0.012, 4));
  }
  // Up top: the rings the chains hang from, six spokes from the pole out to the band
  const OUTER_R = BAND_R - 0.07, INNER_R = 0.5;
  steel.push(ring(OUTER_R, 0.02, BAND + 0.04, 48), ring(INNER_R, 0.02, BAND + 0.12, 32));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    steel.push(rod(at(a, POLE_R, TOP - 0.05), at(a, BAND_R - 0.01, TOP - 0.05), 0.022));
    steel.push(rod(at(a, INNER_R, BAND + 0.12), at(a, INNER_R, TOP - 0.05), 0.016));
  }
  // The chains: each hangs straight down from its ring at first, then swings in to the collar (a
  // little twisted round), as a slack chain does; up close link by link, crossed in turn
  const chainCurves: THREE.CatmullRomCurve3[] = [];
  for (const [n, r0, y0, r1, twist] of [[16, OUTER_R, BAND + 0.04, 0.12, 0.32], [8, INNER_R, BAND + 0.12, 0.12, -0.36]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (n === 8 ? Math.PI / 8 : 0);
      const drop = y0 - COLLAR;
      chainCurves.push(new THREE.CatmullRomCurve3([
        at(a, r0, y0),
        at(a + twist * 0.15, r0 * 0.97, y0 - drop * 0.4),
        at(a + twist * 0.55, r0 * 0.72 + r1 * 0.28, y0 - drop * 0.78),
        at(a + twist, r1, COLLAR + 0.03)
      ], false, "centripetal"));
    }
  }
  const links: THREE.BufferGeometry[] = [];
  // (a link: an oval of 5 mm wire, about 2.8 cm long and 1.7 cm wide, one every 2 cm)
  const LINK = new THREE.TorusGeometry(0.03, 0.0085, 4, 10).scale(0.95, 1.55, 1);
  const PITCH = 0.066;
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  for (const curve of chainCurves) {
    const n = Math.max(2, Math.floor(curve.getLength() / PITCH));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      q.setFromUnitVectors(up, tan);
      // (every other link turned a quarter round its length)
      q2.setFromAxisAngle(up, k % 2 ? Math.PI / 2 : 0);
      m4.compose(p, q.clone().multiply(q2), one);
      links.push(LINK.clone().applyMatrix4(m4));
    }
  }
  const strands = chainCurves.map(c => new THREE.TubeGeometry(c, 10, 0.016, 4, false));
  // The band: a colored hoop (its number plates painted on), its edges rolled
  const band = new THREE.CylinderGeometry(BAND_R, BAND_R, TOP - BAND, 64, 1, true).translate(0, (BAND + TOP) / 2, 0);
  const lips = merge([ring(BAND_R, 0.028, TOP, 64), ring(BAND_R, 0.028, BAND, 64)]);
  return {
    pole: shared(pole),
    steel: shared(merge(steel)),
    links: shared(merge(links)),
    strands: shared(merge(strands)),
    band: shared(band),
    lips: shared(lips),
    // (farther off)
    cone: shared(merge([new THREE.CylinderGeometry(OUTER_R, 0.13, BAND - COLLAR, 24, 1, true).translate(0, (BAND + COLLAR) / 2, 0), new THREE.CylinderGeometry(INNER_R, 0.13, BAND - COLLAR, 16, 1, true).translate(0, (BAND + COLLAR) / 2 + 0.06, 0)])),
    tray: shared(new THREE.CylinderGeometry(TRAY_R, BOTTOM_R, RIM - TRAY, 24, 1, true).translate(0, (RIM + TRAY) / 2, 0)),
    bottom: shared(new THREE.CircleGeometry(BOTTOM_R, 24).rotateX(-Math.PI / 2).translate(0, TRAY + 0.01, 0)),
    rim: shared(ring(TRAY_R, 0.045, RIM, 24))
  };
};

/** A basket band's usual color: safety yellow. */
export const BASKET_BAND = "#f2c318";
/** The band colors offered. */
export const BAND_COLORS: [string, string][] = [["#f2c318", "Yellow"], ["#f07a1c", "Orange"], ["#d63a2f", "Red"], ["#2f6fd6", "Blue"], ["#3a9d4f", "Green"], ["#e8e8e4", "White"]];

/** How near (ft) a basket's chains are drawn link by link, and how near in any detail. */
export const BASKET_LINKS = 28;
export const BASKET_NEAR = 80;

/** The band's paint, with the hole's number on a white plate front and back. */
const bandMaterial = (color: string, number?: string) =>
  mat(`basket:band:${color}:${number ?? ""}`, () => {
    const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0.1 });
    if (typeof document === "undefined") { m.color.set(color); return m; }
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    if (number) {
      for (const u of [0.25, 0.75]) {
        const x = u * c.width;
        g.fillStyle = "#f8fafc";
        g.beginPath();
        g.roundRect(x - 40, 7, 80, 50, 6);
        g.fill();
        g.fillStyle = "#111827";
        g.font = "bold 44px Oswald, Inter, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `bold ${number.length > 2 ? 34 : 44}px Oswald, Inter, sans-serif`;
        g.fillText(number, x, 35);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    m.map = t;
    return m;
  });

/** A basket at real size (about 4.7 ft tall): pole, wire tray, chains and a colored top band
 * with the hole's number. */
export const createBasket = (bandColor: string, number?: string) => {
  const shapes = (basketShapes ??= makeBasketShapes());
  // (galvanized steel, matte enough not to glare under a bright sky; chains a little brighter)
  const steel = std("#868d93", 0.48, 0.7);
  const chain = std("#a7adb2", 0.36, 0.85);
  const zinc = mat("basket:tray", () => new THREE.MeshStandardMaterial({ color: "#80878d", roughness: 0.55, metalness: 0.65, side: THREE.DoubleSide }));
  const color = bandMaterial(bandColor, number);
  const lip = std(bandColor, 0.5, 0.1);
  // (the band's inside: its paint alone, the numbers read from outside only)
  const inside = mat(`basket:band-in:${bandColor}`, () => new THREE.MeshStandardMaterial({ color: bandColor, roughness: 0.5, metalness: 0.1, side: THREE.BackSide }));
  const mesh = (name: string, g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const o = new THREE.Mesh(g, m);
    o.name = name;
    o.castShadow = shadow;
    o.receiveShadow = true;
    return o;
  };
  const near = new THREE.Group();
  near.add(mesh("pole", shapes.pole, steel), mesh("wires", shapes.steel, steel), mesh("chains", shapes.links, chain), mesh("band", shapes.band, color), mesh("band-inside", shapes.band, inside), mesh("band-lips", shapes.lips, lip));
  const mid = new THREE.Group();
  mid.add(mesh("pole", shapes.pole, steel), mesh("wires", shapes.steel, steel, false), mesh("chains", shapes.strands, chain, false), mesh("band", shapes.band, color), mesh("band-inside", shapes.band, inside), mesh("band-lips", shapes.lips, lip));
  const far = new THREE.Group();
  const veil = mat("basket:chains-far", () => new THREE.MeshStandardMaterial({ color: "#aab0b5", roughness: 0.45, metalness: 0.6, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  far.add(mesh("pole", shapes.pole, steel), mesh("chains", shapes.cone, veil), mesh("tray", shapes.tray, zinc), mesh("rim", shapes.rim, steel), mesh("band", shapes.band, color), mesh("band-inside", shapes.band, inside), mesh("band-lips", shapes.lips, lip), mesh("tray-bottom", shapes.bottom, zinc));
  const lod = new THREE.LOD();
  lod.addLevel(near, 0);
  lod.addLevel(mid, BASKET_LINKS);
  lod.addLevel(far, BASKET_NEAR);
  const g = new THREE.Group();
  g.add(lod);
  return g;
};

/** A mando: a post with an orange arrow pointing to the side the disc must pass. Faces +x (play direction). */
export const createMando = (side: "left" | "right") => {
  const g = new THREE.Group();
  g.add(box(0.33, 6, 0.33, std("#7c5a3c", 0.95), 0, 3, 0));
  const face = signTexture(`mando:${side}`, (c, w, h) => {
    c.fillStyle = "#f97316";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#ffffff";
    c.beginPath();
    // Arrow toward the pass side (as seen by a player throwing along +x)
    const dir = side === "right" ? 1 : -1;
    const cx = w / 2;
    c.moveTo(cx - dir * w * 0.35, h * 0.38);
    c.lineTo(cx + dir * w * 0.05, h * 0.38);
    c.lineTo(cx + dir * w * 0.05, h * 0.18);
    c.lineTo(cx + dir * w * 0.38, h * 0.5);
    c.lineTo(cx + dir * w * 0.05, h * 0.82);
    c.lineTo(cx + dir * w * 0.05, h * 0.62);
    c.lineTo(cx - dir * w * 0.35, h * 0.62);
    c.closePath();
    c.fill();
  });
  // The board faces back down the hole (-x), toward the player
  const board = box(0.1, 1.0, 2.0, face ?? std("#f97316"), -0.22, 5.3, 0);
  g.add(board);
  return g;
};

/** A drop zone: a small orange "DZ" sign and a disc-sized orange mark. */
export const createDropZone = () => {
  const g = new THREE.Group();
  g.add(cyl(0.08, 0.08, 2.6, std("#4b5563", 0.6, 0.4), 0, 0, 0, 8));
  const face = signTexture("dz", (c, w, h) => {
    c.fillStyle = "#f97316";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#ffffff";
    c.font = `bold ${h * 0.7}px Oswald, Inter, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("DZ", w / 2, h / 2 + 4);
  }, 128, 96);
  g.add(box(0.08, 0.75, 1.0, face ?? std("#f97316"), 0, 2.6, 0));
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 32), mat("dz-ring", () => new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85, depthWrite: false })));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  g.add(ring);
  return g;
};

export const createAmenity = (kind: AmenityKind, width?: number) => {
  const g = new THREE.Group();
  const wood = std("#8b6a4a", 0.9);
  const dark = std("#3f3f46", 0.7, 0.3);
  switch (kind) {
    case "bench":
      g.add(box(5, 0.15, 1.4, wood, 0, 1.5, 0));
      g.add(box(5, 1, 0.12, wood, 0, 2.3, -0.65));
      [-2, 2].forEach(x => g.add(box(0.2, 1.5, 1.2, dark, x, 0.75, 0)));
      break;
    case "trash":
      g.add(cyl(1.0, 1.05, 3, std("#14532d", 0.6, 0.2), 0, 0, 0, 16));
      g.add(cyl(1.1, 1.1, 0.2, dark, 0, 3, 0, 16));
      break;
    case "sign":
    case "kiosk": {
      const wide = kind === "kiosk";
      const w = wide ? 6 : 2.5;
      [-w / 2 + 0.2, w / 2 - 0.2].forEach(x => g.add(box(0.33, wide ? 7 : 5, 0.33, wood, x, wide ? 3.5 : 2.5, 0)));
      g.add(box(w, wide ? 3.5 : 1.8, 0.15, std(wide ? "#0e7490" : "#14532d", 0.6), 0, wide ? 4.6 : 3.8, 0));
      if (wide) g.add(box(w + 1.5, 0.2, 2, std("#7c2d12", 0.9), 0, 7.1, 0));
      break;
    }
    case "restroom":
      g.add(box(8, 8, 6, std("#d6d3d1", 0.9), 0, 4, 0));
      g.add(box(9, 0.5, 7, std("#57534e", 0.9), 0, 8.25, 0));
      break;
    case "shelter":
      [[-7, -5], [7, -5], [-7, 5], [7, 5]].forEach(([x, z]) => g.add(box(0.5, 8, 0.5, wood, x, 4, z)));
      g.add(box(17, 0.6, 13, std("#7c2d12", 0.9), 0, 8.3, 0));
      g.add(box(8, 0.2, 3, wood, 0, 2.5, 0));
      break;
    case "parking":
    case "water":
    case "practice": {
      if (kind === "practice") return createBasket("#f97316");
      if (kind === "water") {
        g.add(cyl(0.6, 0.5, 3, std("#64748b", 0.5, 0.5), 0, 0, 0, 12));
        g.add(cyl(0.9, 0.9, 0.3, std("#94a3b8", 0.4, 0.6), 0, 3, 0, 16));
        break;
      }
      g.add(cyl(0.1, 0.1, 7, std("#9ca3af", 0.4, 0.6), 0, 0, 0, 8));
      const face = signTexture("parking", (c, w, h) => {
        c.fillStyle = "#1d4ed8";
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#ffffff";
        c.font = `bold ${h * 0.75}px Inter, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("P", w / 2, h / 2 + 4);
      }, 128, 128);
      g.add(box(0.1, 1.6, 1.6, face ?? std("#1d4ed8"), 0, 6.3, 0));
      break;
    }
    case "bridge":
      g.add(box(16, 0.6, 5, wood, 0, 0.8, 0));
      [-2.4, 2.4].forEach(z => g.add(box(16, 0.2, 0.2, wood, 0, 3.4, z)));
      [-7.5, 0, 7.5].forEach(x => [-2.4, 2.4].forEach(z => g.add(box(0.3, 2.6, 0.3, wood, x, 2.1, z))));
      break;
    case "grill": {
      // A park grill: a firebox on a post, its grate and a handle
      const black = std("#26272a", 0.55, 0.45);
      g.add(box(0.3, 3, 0.3, black, 0, 1.5, 0));
      g.add(box(2.4, 0.7, 1.7, black, 0, 3.25, 0));
      g.add(box(2.5, 0.08, 1.8, std("#4b4d50", 0.5, 0.6), 0, 3.64, 0));
      g.add(box(0.1, 0.1, 1, std("#9ca3af", 0.4, 0.6), 1.35, 3.5, 0));
      break;
    }
    case "fitness": {
      // A pull-up bar on two posts and a sit-up bench
      const post = std("#3f6e46", 0.6, 0.3), steel = std("#9ca3af", 0.4, 0.6);
      [-2.2, 2.2].forEach(z => g.add(cyl(0.18, 0.18, 7.5, post, 0, 0, z, 10)));
      g.add(box(0.14, 0.14, 4.4, steel, 0, 7.2, 0));
      g.add(box(4, 0.35, 1.2, wood, 3.5, 1.4, 0));
      [2, 5].forEach(x => g.add(box(0.3, 1.4, 1, post, x, 0.7, 0)));
      break;
    }
    case "flagpole": {
      g.add(cyl(0.25, 0.12, 30, std("#d4d4d8", 0.35, 0.7), 0, 0, 0, 12));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), std("#c9a227", 0.3, 0.8));
      ball.position.set(0, 30.3, 0);
      g.add(ball);
      const flag = signTexture("flag", (c, w, h) => {
        // Stripes and a field of blue
        for (let i = 0; i < 13; i++) { c.fillStyle = i % 2 ? "#ffffff" : "#b91c1c"; c.fillRect(0, (i * h) / 13, w, h / 13 + 1); }
        c.fillStyle = "#1e3a8a";
        c.fillRect(0, 0, w * 0.4, (h * 7) / 13);
      }, 190, 100);
      g.add(box(5.7, 3, 0.03, flag ?? std("#b91c1c"), 2.95, 28.2, 0));
      break;
    }
    case "light": {
      // A light pole: its arm and the lamp at the end
      const paint = std("#2f3b35", 0.5, 0.4);
      g.add(cyl(0.28, 0.18, 18, paint, 0, 0, 0, 12));
      g.add(box(3, 0.2, 0.2, paint, 1.4, 17.9, 0));
      g.add(box(1.5, 0.45, 0.9, paint, 2.9, 17.7, 0));
      g.add(box(1.3, 0.05, 0.75, mat("lamp", () => new THREE.MeshStandardMaterial({ color: "#fff6dc", emissive: "#fff1c4", emissiveIntensity: 0.6, roughness: 0.4 })), 2.9, 17.45, 0));
      break;
    }
    case "pole": {
      // A wooden utility pole, its crossarm and insulators
      const timber = std("#4f3b29", 0.95);
      g.add(cyl(0.45, 0.35, 32, timber, 0, 0, 0, 10));
      g.add(box(0.35, 0.35, 8, std("#5a4330", 0.95), 0, 29.5, 0));
      [-3.6, 0, 3.6].forEach(z => g.add(cyl(0.12, 0.12, 0.7, std("#7e8b82", 0.4, 0.2), 0, z ? 29.7 : 32, z, 8)));
      break;
    }
    case "bikerack": {
      // Three hoops to lock bikes to
      const steel = std("#a1a1aa", 0.35, 0.7);
      [-2.5, 0, 2.5].forEach(z => {
        [-1, 1].forEach(x => g.add(cyl(0.09, 0.09, 2.2, steel, x, 0, z, 8)));
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 6, 14, Math.PI), steel);
        hoop.position.set(0, 2.2, z);
        hoop.castShadow = true;
        g.add(hoop);
      });
      break;
    }
    case "fountain": {
      // A stone basin of water, a column and a smaller bowl on it
      const stone = std("#b8b2a6", 0.85);
      g.add(cyl(4, 4.1, 1.6, stone, 0, 0, 0, 28));
      g.add(cyl(3.6, 3.6, 0.1, mat("fountain-water", () => new THREE.MeshStandardMaterial({ color: "#3d8fc4", roughness: 0.08, metalness: 0.1 })), 0, 1.35, 0, 28));
      g.add(cyl(0.45, 0.45, 3.2, stone, 0, 0, 0, 12));
      g.add(cyl(1.2, 1.6, 0.5, stone, 0, 3.2, 0, 18));
      break;
    }
    case "gate": {
      // Two posts and a barred gate between them, as wide as it's set (a road's: two leaves meeting
      // at a middle post)
      const steel = std("#3f4549", 0.5, 0.5);
      const w = Math.max(6, Math.min(60, width ?? 6)), half = w / 2, leaves = w > 16 ? 2 : 1;
      [-half, half].forEach(z => g.add(box(0.45, 5, 0.45, steel, 0, 2.5, z)));
      if (leaves === 2) g.add(box(0.3, 4.6, 0.3, steel, 0, 2.3, 0));
      [0.6, 4.2].forEach(y => g.add(box(0.12, 0.12, w - 0.4, steel, 0, y, 0)));
      const bars = Math.max(7, Math.round(w / 0.8));
      for (let k = 0; k <= bars; k++) g.add(box(0.08, 3.6, 0.08, steel, 0, 2.4, -half + 0.2 + (k * (w - 0.4)) / bars));
      break;
    }
  }
  g.userData.kind = AMENITY_KINDS[kind].label;
  return g;
};
