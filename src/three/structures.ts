// Built things in 3D at real size (feet): bridges, boardwalks, stairs, walls, buildings, shelters
// and decks. Each is a few meshes, one per material, with every board, post and stone merged into
// it, so a course with many of them stays quick. The materials (weathered deck boards, timber,
// stone, concrete) and their textures are made once and shared; a building's walls, roof, trim,
// doors and windows, and a shelter's roof, are three/buildingLook's (scans painted any color).
// Texture coordinates are in feet, so every texture is at its real size.
import * as THREE from "three";
import type { AddOn, FenceStyle, P, StructureItem } from "../types";
import { pointInPolygon } from "../lib/geom";
import { clamp } from "../constants";
import { buildingColors, buildingFrame, outlineOf, roofingOf, sidingOf, stepsUp, windowStyleOf, type Frame } from "../lib/buildingParts";
import { STRUCTURE_INK } from "../lib/symbols";
import { glass, onLookLoaded, paint as paintOf, ROOF_SHADE, ROOFING_SCAN, room, SIDING_SCAN, surface } from "./buildingLook";
import {
  boardwalkDeck, bridgeDeck, isLineKind, offsetPolygon, orientedBox, roofBreaks, roofFor, samplePath, stairSteps,
  structureHeight, structurePath, structureRoof, structureWidth, type Roof
} from "../lib/structures";

type Ground = (x: number, y: number) => number;
const V3 = THREE.Vector3;
type V = THREE.Vector3;

// ------------------------------------------------------------------ materials

type MatKey = "deck" | "timber" | "stone" | "concrete";

/** A small seeded random generator, so the textures come out the same every time. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A texture painted on a canvas, `fu` × `fv` feet, repeating. */
const paint = (w: number, h: number, fu: number, fv: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number) => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g, rng(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / fu, 1 / fv);
  tex.anisotropy = 8;
  tex.userData.shared = true;
  return tex;
};

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;

/** Fine streaks along a board (its grain), across `len` pixels, between `a` and `b` on the other axis. */
const grain = (g: CanvasRenderingContext2D, r: () => number, along: "x" | "y", a: number, b: number, len: number, n: number) => {
  for (let i = 0; i < n; i++) {
    const at = a + r() * (b - a);
    const dark = r() < 0.6;
    g.strokeStyle = dark ? `rgba(40,26,14,${0.05 + r() * 0.12})` : `rgba(255,240,215,${0.04 + r() * 0.08})`;
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    const wav = r() * 2.5, ph = r() * 6.3, fr = 0.004 + r() * 0.02;
    for (let t = 0; t <= len; t += 8) {
      const off = at + Math.sin(t * fr + ph) * wav;
      if (along === "x") (t ? g.lineTo(t, off) : g.moveTo(t, off));
      else (t ? g.lineTo(off, t) : g.moveTo(off, t));
    }
    g.stroke();
  }
};

const painters: Record<MatKey, () => THREE.Texture | null> = {
  // Deck boards across a bridge (seams across u): weathered gray-brown, a few butt joints and knots
  deck: () => paint(512, 256, 8, 4, (g, r) => {
    const bw = 32;
    for (let x = 0; x < 512; x += bw) {
      const l = 0.43 + r() * 0.17;
      g.fillStyle = hsl(30 + r() * 10, 0.16 + r() * 0.12, l);
      g.fillRect(x, 0, bw, 256);
      grain(g, r, "y", x + 2, x + bw - 2, 256, 14);
      if (r() < 0.5) { const y = r() * 256; g.fillStyle = "rgba(30,20,12,.65)"; g.fillRect(x, y, bw, 2); }
      if (r() < 0.35) { g.fillStyle = "rgba(60,38,20,.45)"; g.beginPath(); g.ellipse(x + 6 + r() * (bw - 12), r() * 256, 2.5, 4.5, 0, 0, 7); g.fill(); }
      // The gap between boards, and the light on each board's edge
      g.fillStyle = "rgba(24,16,10,.9)";
      g.fillRect(x, 0, 3, 256);
      g.fillStyle = "rgba(255,245,225,.12)";
      g.fillRect(x + 3, 0, 2, 256);
    }
  }, 11),
  // Timber: posts, rails and beams, the grain along u
  timber: () => paint(512, 64, 8, 1, (g, r) => {
    g.fillStyle = hsl(28, 0.26, 0.33);
    g.fillRect(0, 0, 512, 64);
    grain(g, r, "x", 0, 64, 512, 40);
  }, 12),
  // Stone: courses of blocks of many lengths, mortar between, each block lit from above
  stone: () => paint(512, 512, 6, 6, (g, r) => {
    g.fillStyle = "#4a443c";
    g.fillRect(0, 0, 512, 512);
    const heights: number[] = [];
    let y = 0;
    while (y < 512) {
      let hh = 46 + Math.floor(r() * 36);
      if (512 - (y + hh) < 40) hh = 512 - y;
      heights.push(hh);
      y += hh;
    }
    y = 0;
    for (const hh of heights) {
      let x = -Math.floor(r() * 120);
      const start = x;
      while (x < start + 512) {
        const bl = Math.min(start + 512 - x, 70 + Math.floor(r() * 120));
        const tone = 0.33 + r() * 0.16, hue = 30 + r() * 14, sat = 0.04 + r() * 0.08;
        for (const sx of [x, x + 512, x - 512]) {
          g.fillStyle = hsl(hue, sat, tone);
          g.fillRect(sx + 3, y + 3, bl - 6, hh - 6);
          g.fillStyle = "rgba(255,255,255,.14)";
          g.fillRect(sx + 3, y + 3, bl - 6, 4);
          g.fillStyle = "rgba(0,0,0,.18)";
          g.fillRect(sx + 3, y + hh - 7, bl - 6, 4);
        }
        x += bl;
      }
      y += hh;
    }
    // Grit
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.12})` : `rgba(255,255,255,${r() * 0.1})`;
      g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
    }
  }, 13),
  // Concrete: light, a little mottled and speckled
  concrete: () => paint(256, 256, 8, 8, (g, r) => {
    g.fillStyle = "#b8b3a9";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "60,55,48" : "255,255,250"},${r() * 0.05})`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 4 + r() * 18, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"},${r() * 0.12})`;
      g.fillRect(r() * 256, r() * 256, 1, 1);
    }
  }, 17)
};

const mats = new Map<MatKey, THREE.Material>();
const material = (key: MatKey) => {
  let m = mats.get(key);
  if (m) return m;
  const map = painters[key]();
  const fallback: Record<MatKey, string> = { deck: "#8d7a62", timber: "#5a4330", stone: "#8c857a", concrete: "#b8b3a9" };
  m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : fallback[key], map, roughness: 0.92 });
  m.userData.shared = true;
  mats.set(key, m);
  return m;
};

// ------------------------------------------------------------------ geometry

/** Triangles for one material, merged into one geometry. Coordinates are world (x, y up, z). */
class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];

  /** A triangle, turned to face `out` if given; `uv` per corner (feet). */
  tri(a: V, b: V, c: V, uv: [number, number][], out?: V) {
    const n = new V3().subVectors(b, a).cross(new V3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    n.normalize();
    let ua = uv[0], ub = uv[1], uc = uv[2];
    if (out && n.dot(out) < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
      n.negate();
    }
    for (const [p, t] of [[a, ua], [b, ub], [c, uc]] as [V, [number, number]][]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(t[0], t[1]);
    }
  }

  /** A triangle with a normal at each corner (round things, shaded smooth), turned to face them. */
  smooth(p: [V, V, V], n: [V, V, V], uv: [number, number][]) {
    const f = new V3().subVectors(p[1], p[0]).cross(new V3().subVectors(p[2], p[0]));
    if (f.lengthSq() < 1e-12) return;
    for (const i of f.dot(n[0].clone().add(n[1]).add(n[2])) < 0 ? [0, 2, 1] : [0, 1, 2]) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nor.push(n[i].x, n[i].y, n[i].z);
      this.uv.push(uv[i][0], uv[i][1]);
    }
  }

  /** A four-cornered face a-b-c-d (in order round its edge). */
  quad(a: V, b: V, c: V, d: V, uv: [number, number][], out?: V) {
    this.tri(a, b, c, [uv[0], uv[1], uv[2]], out);
    this.tri(a, c, d, [uv[0], uv[2], uv[3]], out);
  }

  /** A box around `c`: half sizes along `ex`, `ey` and `ez` (unit vectors at right angles). */
  box(c: V, ex: V, ey: V, ez: V, hx: number, hy: number, hz: number) {
    const ax: [V, number][] = [[ex, hx], [ey, hy], [ez, hz]];
    for (let i = 0; i < 3; i++) {
      const [A, ha] = ax[i], [B, hb] = ax[(i + 1) % 3], [C, hc] = ax[(i + 2) % 3];
      for (const s of [-1, 1]) {
        const f = (sb: number, sc: number) => c.clone().addScaledVector(A, s * ha).addScaledVector(B, sb * hb).addScaledVector(C, sc * hc);
        // Texture along the face's longer side
        const uvs: [number, number][] = hb >= hc
          ? [[0, 0], [2 * hb, 0], [2 * hb, 2 * hc], [0, 2 * hc]]
          : [[0, 0], [0, 2 * hb], [2 * hc, 2 * hb], [2 * hc, 0]];
        this.quad(f(-1, -1), f(1, -1), f(1, 1), f(-1, 1), uvs, A.clone().multiplyScalar(s));
      }
    }
  }

  get empty() {
    return !this.pos.length;
  }

  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}

const UP = new V3(0, 1, 0);
const w3 = (p: P, y: number) => new V3(p.x, y, p.y);

/**
 * A solid along a path: at each point a cross-section from `lo[i]` to `hi[i]` high, `off` to the
 * side of the path and `half` either way of that (mitered at corners). Open paths get end caps;
 * `closed` runs round a loop.
 */
const sweep = (m: Mesher, pts: P[], lo: number[], hi: number[], off: number, half: number, closed = false, top = true) => {
  const n = pts.length;
  if (n < 2) return;
  const dirOf = (a: P, b: P) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  const L: V[] = [], R: V[] = [], LH: V[] = [], RH: V[] = [], nrm: V[] = [], s: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i + n - 1) % n] : pts[Math.max(0, i - 1)], next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const d1 = dirOf(i === 0 && !closed ? pts[0] : prev, i === 0 && !closed ? next : pts[i]);
    const d2 = dirOf(i === n - 1 && !closed ? prev : pts[i], i === n - 1 && !closed ? pts[i] : next);
    const n1 = { x: -d1.y, y: d1.x }, n2 = { x: -d2.y, y: d2.x };
    let nx = n1.x + n2.x, ny = n1.y + n2.y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const k = 1 / Math.max(0.35, nx * n1.x + ny * n1.y);
    const p = pts[i];
    const at = (o: number) => ({ x: p.x + nx * o * k, y: p.y + ny * o * k });
    L.push(w3(at(off + half), lo[i])); R.push(w3(at(off - half), lo[i]));
    LH.push(w3(at(off + half), hi[i])); RH.push(w3(at(off - half), hi[i]));
    nrm.push(new V3(nx, 0, ny));
    if (i) acc += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    s.push(acc);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const s0 = s[i], s1 = j === 0 ? acc + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y) : s[j];
    const out = nrm[i].clone().add(nrm[j]).normalize();
    if (top) m.quad(LH[i], LH[j], RH[j], RH[i], [[s0, half], [s1, half], [s1, -half], [s0, -half]], UP);
    m.quad(L[i], L[j], LH[j], LH[i], [[s0, lo[i]], [s1, lo[j]], [s1, hi[j]], [s0, hi[i]]], out);
    m.quad(R[i], R[j], RH[j], RH[i], [[s0, lo[i]], [s1, lo[j]], [s1, hi[j]], [s0, hi[i]]], out.clone().negate());
    m.quad(L[i], L[j], R[j], R[i], [[s0, half], [s1, half], [s1, -half], [s0, -half]], UP.clone().negate());
  }
  if (!closed) {
    for (const [i, sgn] of [[0, -1], [n - 1, 1]] as [number, number][]) {
      const t = new V3(pts[Math.min(n - 1, i + 1)].x - pts[Math.max(0, i - 1)].x, 0, pts[Math.min(n - 1, i + 1)].y - pts[Math.max(0, i - 1)].y).normalize().multiplyScalar(sgn);
      m.quad(L[i], R[i], RH[i], LH[i], [[half, lo[i]], [-half, lo[i]], [-half, hi[i]], [half, hi[i]]], t);
    }
  }
};

const signedArea = (poly: P[]) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2;

/** The way out of a polygon across its edge a→b (level, unit). */
const outward = (poly: P[], a: P, b: P) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const sgn = signedArea(poly) > 0 ? 1 : -1;
  return new V3((sgn * (b.y - a.y)) / l, 0, (-sgn * (b.x - a.x)) / l);
};

/** A flat-topped solid on an outline: its top (texture by `uvOf`), and its sides from `lo` up. */
const prism = (m: Mesher, poly: P[], lo: number, hi: number, uvOf: (p: P) => [number, number], sides = true, bottom = false) => {
  if (poly.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(p => new THREE.Vector2(p.x, p.y)), []);
  for (const [a, b, c] of tris) {
    m.tri(w3(poly[a], hi), w3(poly[b], hi), w3(poly[c], hi), [uvOf(poly[a]), uvOf(poly[b]), uvOf(poly[c])], UP);
    if (bottom) m.tri(w3(poly[a], lo), w3(poly[b], lo), w3(poly[c], lo), [uvOf(poly[a]), uvOf(poly[b]), uvOf(poly[c])], UP.clone().negate());
  }
  if (!sides) return;
  let s = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    m.quad(w3(a, lo), w3(b, lo), w3(b, hi), w3(a, hi), [[s, lo], [s + l, lo], [s + l, hi], [s, hi]], outward(poly, a, b));
    s += l;
  });
};

/** Points along each edge of a closed outline, no more than `step` ft apart (corners included). */
const alongEdges = (poly: P[], step: number) => {
  const out: P[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  });
  return out;
};

const post = (m: Mesher, p: P, y0: number, y1: number, size: number, angle = 0) =>
  m.box(w3(p, (y0 + y1) / 2), new V3(Math.cos(angle), 0, Math.sin(angle)), UP, new V3(-Math.sin(angle), 0, Math.cos(angle)), size / 2, (y1 - y0) / 2, size / 2);

/** A point `off` ft to the side of a path sample (the same side as `sweep`'s positive offset). */
const aside = (p: { x: number; y: number; angle: number }, off: number): P => ({ x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off });

/** Railings along a deck: posts every 6 ft or so, a top rail and a middle rail, on both sides. */
const railings = (timber: Mesher, deck: { x: number; y: number; s: number; angle: number; top: number }[], half: number) => {
  const pts = deck.map(d => ({ x: d.x, y: d.y }));
  const L = deck[deck.length - 1].s;
  const posts = Math.max(2, Math.round(L / 6) + 1);
  for (const side of [-1, 1]) {
    for (let k = 0; k < posts; k++) {
      const s = Math.min(L - 0.25, Math.max(0.25, (k * L) / (posts - 1)));
      const d = deck.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best), deck[0]);
      post(timber, aside(d, side * (half - 0.2)), d.top - 0.7, d.top + 3.45, 0.36, d.angle);
    }
    sweep(timber, pts, deck.map(d => d.top + 3.15), deck.map(d => d.top + 3.47), side * (half - 0.2), 0.2);
    sweep(timber, pts, deck.map(d => d.top + 1.55), deck.map(d => d.top + 1.8), side * (half - 0.2), 0.08);
  }
};

// ------------------------------------------------------------------ the models

/** A model's meshes by what they're made of: the materials' (MatKey), or a building's parts. */
type Parts = Record<string, Mesher | undefined>;

const bridge = (st: StructureItem, g: Ground, parts: Parts) => {
  const deck = bridgeDeck(structurePath(st), g, structureHeight(st), 1);
  if (deck.length < 2) return;
  const w = structureWidth(st), half = w / 2;
  const pts = deck.map(d => ({ x: d.x, y: d.y }));
  const top = deck.map(d => d.top);
  const deckM = (parts.deck ??= new Mesher()), timber = (parts.timber ??= new Mesher()), stone = (parts.stone ??= new Mesher());
  sweep(deckM, pts, top.map(t => t - 0.22), top, 0, half);
  // Two beams under the deck, and boards along its edges
  for (const side of [-1, 1]) {
    sweep(timber, pts, top.map(t => t - 1.15), top.map(t => t - 0.22), side * (half - 0.8), 0.25);
    sweep(timber, pts, top.map(t => t - 0.75), top.map(t => t + 0.06), side * (half + 0.08), 0.08);
  }
  railings(timber, deck, half);
  // Stone abutments on the banks, under each end
  for (const [d, nb] of [[deck[0], deck[1]], [deck[deck.length - 1], deck[deck.length - 2]]] as const) {
    const t = new V3(d.x - nb.x, 0, d.y - nb.y).normalize();
    const c = new V3(d.x, 0, d.y).addScaledVector(t, 0.4);
    const bottom = Math.min(d.ground, g(c.x, c.z)) - 1.8;
    const y1 = d.top - 0.22;
    stone.box(new V3(c.x, (bottom + y1) / 2, c.z), t, UP, new V3(-t.z, 0, t.x), 1.25, (y1 - bottom) / 2, half + 0.45);
  }
  // Piers where the deck stands well clear of the ground (over a creek, say)
  const L = deck[deck.length - 1].s;
  const spans = Math.max(1, Math.round(L / 14));
  for (let k = 1; k < spans; k++) {
    const s = (k * L) / spans;
    const d = deck.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best), deck[0]);
    if (d.top - d.ground < 2.2) continue;
    for (const side of [-1, 1]) post(timber, aside(d, side * (half - 0.8)), d.ground - 1, d.top - 1.15, 0.6, d.angle);
    const c = aside(d, 0);
    timber.box(w3(c, d.top - 1.45), new V3(-Math.sin(d.angle), 0, Math.cos(d.angle)), UP, new V3(Math.cos(d.angle), 0, Math.sin(d.angle)), half + 0.2, 0.3, 0.32);
  }
};

const boardwalk = (st: StructureItem, g: Ground, parts: Parts) => {
  const H = structureHeight(st);
  const deck = boardwalkDeck(structurePath(st), g, H, 1);
  if (deck.length < 2) return;
  const half = structureWidth(st) / 2;
  const pts = deck.map(d => ({ x: d.x, y: d.y }));
  const top = deck.map(d => d.top);
  const deckM = (parts.deck ??= new Mesher()), timber = (parts.timber ??= new Mesher());
  sweep(deckM, pts, top.map(t => t - 0.2), top, 0, half);
  for (const side of [-1, 1]) {
    // Rim boards down the sides, and a low curb along the edge
    sweep(timber, pts, top.map((t, i) => Math.max(deck[i].ground - 0.2, t - 0.75)), top.map(t => t - 0.2), side * (half - 0.08), 0.08);
    if (H <= 2.5) sweep(timber, pts, top, top.map(t => t + 0.3), side * (half - 0.16), 0.16);
  }
  if (H > 2.5) railings(timber, deck, half);
  // Posts every 8 ft or so
  const L = deck[deck.length - 1].s;
  const n = Math.max(2, Math.round(L / 8) + 1);
  for (let k = 0; k < n; k++) {
    const s = (k * L) / (n - 1);
    const d = deck.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best), deck[0]);
    if (d.top - d.ground < 0.45) continue;
    for (const side of [-1, 1]) post(timber, aside(d, side * (half - 0.25)), d.ground - 1, d.top - 0.2, 0.42, d.angle);
  }
};

/** Landscape steps: level treads of packed stone, each with a timber across its front (the riser)
 * and timbers along both sides. */
const stairs = (st: StructureItem, g: Ground, parts: Parts) => {
  const half = structureWidth(st) / 2;
  const steps = stairSteps(structurePath(st), g);
  if (!steps.length) return;
  const tread = (parts.concrete ??= new Mesher()), timber = (parts.timber ??= new Mesher());
  // The front of each step faces down the slope
  const up = steps[steps.length - 1].top >= steps[0].top;
  for (const step of steps) {
    const ex = new V3(Math.cos(step.angle), 0, Math.sin(step.angle)), ez = new V3(-ex.z, 0, ex.x);
    const lo = step.low - 0.6;
    const len = step.s1 - step.s0;
    tread.box(w3(step.at, (lo + step.top - 0.04) / 2), ex, UP, ez, len / 2 + 0.02, (step.top - 0.04 - lo) / 2, half - 0.3);
    const front = new V3(step.at.x, 0, step.at.y).addScaledVector(ex, (up ? -1 : 1) * (len / 2 - 0.25));
    timber.box(new V3(front.x, (lo + step.top + 0.05) / 2, front.z), ex, UP, ez, 0.25, (step.top + 0.05 - lo) / 2, half);
    for (const side of [-1, 1]) {
      const c = new V3(step.at.x, 0, step.at.y).addScaledVector(ez, side * (half - 0.15));
      timber.box(new V3(c.x, (lo + step.top + 0.1) / 2, c.z), ex, UP, ez, len / 2 + 0.02, (step.top + 0.1 - lo) / 2, 0.15);
    }
  }
};

/** A wall of mortared blocks along `pts`: its top the wall's height above the ground all along. */
const blockWall = (pts: P[], H: number, half: number, g: Ground, stone: Mesher) => {
  const samples = samplePath(pts, 2);
  if (samples.length < 2) return;
  const ground = samples.map(p => g(p.x, p.y));
  sweep(stone, samples, ground.map(y => y - 0.8), ground.map(y => y + H), 0, half);
  // Capstones, a little wider
  sweep(stone, samples, ground.map(y => y + H), ground.map(y => y + H + 0.3), 0, half + 0.14);
};
const wall = (st: StructureItem, g: Ground, parts: Parts) => blockWall(st.points, structureHeight(st), structureWidth(st) / 2, g, (parts.stone ??= new Mesher()));

/** A mortared wall along a line (a wall drawn as a line), as the built wall is made. */
export const createBlockWall = (pts: P[], groundAt: Ground, width: number, height: number) => {
  const group = new THREE.Group(), m = new Mesher();
  group.name = "wall";
  blockWall(pts, height, width / 2, groundAt, m);
  if (m.empty) return group;
  const mesh = new THREE.Mesh(m.geometry(), material("stone"));
  mesh.name = "stone";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
};

/** The roof over an outline: its faces at `eave + pitch × run`, and a fascia board round the eaves. */
const roofFaces = (roof: Roof, eave: number, cover: Mesher, fascia: Mesher) => {
  const y = (p: P) => eave + roof.pitch * roof.run(p);
  const slopeK = Math.sqrt(1 + roof.pitch * roof.pitch);
  for (const f of roof.facets) {
    const along = { x: -f.out.y, y: f.out.x };
    const uvOf = (p: P): [number, number] => [p.x * along.x + p.y * along.y, -(p.x * f.out.x + p.y * f.out.y) * slopeK];
    const tris = THREE.ShapeUtils.triangulateShape(f.poly.map(p => new THREE.Vector2(p.x, p.y)), []);
    for (const [a, b, c] of tris) cover.tri(w3(f.poly[a], y(f.poly[a])), w3(f.poly[b], y(f.poly[b])), w3(f.poly[c], y(f.poly[c])), [uvOf(f.poly[a]), uvOf(f.poly[b]), uvOf(f.poly[c])], UP);
  }
  roof.eaves.forEach((a, i) => {
    const b = roof.eaves[(i + 1) % roof.eaves.length];
    const out = outward(roof.eaves, a, b);
    const pts = roofBreaks(a, b, roof);
    let s = 0;
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k], l = Math.hypot(q.x - p.x, q.y - p.y);
      fascia.quad(w3(p, y(p) - 0.45), w3(q, y(q) - 0.45), w3(q, y(q) + 0.02), w3(p, y(p) + 0.02), [[s, 0], [s + l, 0], [s + l, 0.47], [s, 0.47]], out);
      s += l;
    }
  });
};

/** Under the eaves: the overhang's underside (a soffit), from the eaves in to the walls. */
const soffit = (roof: Roof, walls: P[], eave: number, overhang: number, m: Mesher) => {
  const y = eave - roof.pitch * overhang - 0.45;
  const ring = [...roof.eaves, roof.eaves[0]];
  const inner = [...walls, walls[0]];
  if (ring.length !== inner.length) return;
  for (let i = 0; i + 1 < ring.length; i++) {
    m.quad(w3(ring[i], y), w3(ring[i + 1], y), w3(inner[i + 1], y), w3(inner[i], y), [[ring[i].x, ring[i].y], [ring[i + 1].x, ring[i + 1].y], [inner[i + 1].x, inner[i + 1].y], [inner[i].x, inner[i].y]], UP.clone().negate());
  }
};


/**
 * A porch, carport, deck or patio against a building's wall: a porch's floor at the house's floor
 * on a stone skirt, posts and a shed roof tied in under the eaves; a carport's slab on the ground,
 * posts and a metal roof; a deck's boards at the floor on posts, no roof; a patio's slab on the
 * ground. Raised ones get a railing and steps down at the front's middle.
 */
const addOnModel = (a: AddOn, F: Frame, g: Ground, at: (k: string) => Mesher) => {
  const w = F.walls[a.wall];
  if (!w || a.width < 2 || a.depth < 2) return;
  const dir = new V3(w.dir.x, 0, w.dir.y), out = new V3(w.out.x, 0, w.out.y);
  const mid = F.along(a.wall, a.at);
  const P = (s: number, d: number, y: number) => new V3(mid.x + w.dir.x * s + w.out.x * d, y, mid.y + w.dir.y * s + w.out.y * d);
  const box = (m: Mesher, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number) =>
    m.box(P((s0 + s1) / 2, (d0 + d1) / 2, (y0 + y1) / 2), dir, UP, out, Math.abs(s1 - s0) / 2, Math.max(0.01, Math.abs(y1 - y0) / 2), Math.abs(d1 - d0) / 2);
  const half = a.width / 2, D = a.depth;
  const gAt = (s: number, d: number) => { const p = P(s, d, 0); return g(p.x, p.z); };
  const spots = [[-half, 0], [half, 0], [-half, D], [half, D], [0, D / 2], [0, D]];
  const gs = spots.map(([s, d]) => gAt(s, d));
  const gMin = Math.min(...gs), gMax = Math.max(...gs);
  const onGround = a.kind === "patio" || a.kind === "carport";
  const top = onGround ? gMax + 0.3 : F.floor;
  const raised = top - gMin;
  // The floor: boards (a deck, a porch), or a slab
  if (onGround) box(at("pslab"), -half, half, gMin - 0.4, top, 0, D);
  else {
    box(at("pdeck"), -half, half, top - 0.2, top, 0, D);
    if (a.kind === "porch") box(at("found"), -half + 0.15, half - 0.15, gMin - 0.5, top - 0.2, 0.05, D - 0.15);
    else {
      // (a deck: its rim joist, and posts down to the ground every 6 ft or so)
      box(at("ptimber"), -half, half, top - 0.9, top - 0.2, D - 0.2, D);
      for (const s of [-half, half]) box(at("ptimber"), s - 0.1 * Math.sign(s) - 0.1, s - 0.1 * Math.sign(s) + 0.1, top - 0.9, top - 0.2, 0, D);
      const n = Math.max(1, Math.ceil(a.width / 6));
      for (let k = 0; k <= n; k++) for (const d of [D - 0.4, D / 2]) {
        const s = -half + 0.3 + ((a.width - 0.6) * k) / n;
        box(at("ptimber"), s - 0.25, s + 0.25, gAt(s, d) - 0.5, top - 0.9, d - 0.25, d + 0.25);
      }
    }
  }
  // Steps down at the front's middle, where it stands over the ground (as wide as a door's)
  const steps = !onGround ? stepsUp(top - gAt(0, D + 1)) : 0;
  const sw = Math.min(half - 0.3, 2.4);
  if (steps) {
    const riser = (top - gAt(0, D + 1)) / steps;
    for (let k = 1; k <= steps; k++) box(at("steps"), -sw, sw, gAt(0, D + 1) - 0.4, top - k * riser + 0.02, D, D + k * 0.95);
  }
  // A railing round a raised one (a porch over 2 ft, a deck over 1½), open at the steps
  if ((a.kind === "deck" && raised > 1.5) || (a.kind === "porch" && raised > 2)) {
    const rail = at("rail"), y0 = top, y1 = top + 3;
    const run = (pts: [number, number][]) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [s0, d0] = pts[i], [s1, d1] = pts[i + 1];
        const L = Math.hypot(s1 - s0, d1 - d0), n = Math.max(1, Math.round(L / 0.45));
        // (top rail and bottom rail, and balusters between)
        const e = P(0, 0, 0), u = P(s1 - s0, d1 - d0, 0).sub(e).normalize(), v = new V3(-u.z, 0, u.x);
        const c = (t: number, y: number) => P(s0 + (s1 - s0) * t, d0 + (d1 - d0) * t, y);
        rail.box(c(0.5, y1 - 0.1), u, UP, v, L / 2 + 0.1, 0.1, 0.15);
        rail.box(c(0.5, y0 + 0.4), u, UP, v, L / 2, 0.06, 0.08);
        for (let k = 0; k <= n; k++) rail.box(c(k / n, (y0 + y1) / 2), u, UP, v, 0.05, (y1 - y0) / 2 - 0.1, 0.05);
      }
    };
    const inset = 0.2;
    run([[-half + inset, 0.2], [-half + inset, D - inset], [steps ? -sw - 0.2 : half - inset, D - inset]]);
    if (steps) run([[sw + 0.2, D - inset], [half - inset, D - inset], [half - inset, 0.2]]);
    else run([[half - inset, D - inset], [half - inset, 0.2]]);
  }
  // A roof (a porch's, a carport's): a shed roof from under the eaves, out past the posts
  if (a.kind === "porch" || a.kind === "carport") {
    const yWall = Math.min(F.eave - 0.4, top + (a.kind === "carport" ? 10 : 9.5));
    // (3 in 12 where there's height for it, gentler over a deep one, down to 1 in 12; at least 7 ft
    // clear under its edge)
    const over = 1, pitch = clamp((yWall - top - 7.5) / (D + over), 1 / 12, 0.25), yOut = yWall - (D + over) * pitch;
    if (yOut < top + 6.5) return;
    const roof = at(a.kind === "carport" ? "proofm" : "proof");
    const p0 = P(-half - over, 0, yWall + 0.15), p1 = P(half + over, 0, yWall + 0.15), p2 = P(half + over, D + over, yOut), p3 = P(-half - over, D + over, yOut);
    const slope = Math.hypot(D + over, (D + over) * pitch);
    roof.quad(p0, p1, p2, p3, [[0, 0], [a.width + 2 * over, 0], [a.width + 2 * over, slope], [0, slope]], UP);
    // (its fascia, a beam over the posts, and the posts every 10 ft or so)
    const trim = at("post"), yAt = (d: number) => yWall - d * pitch;
    trim.quad(p3, p2, p2.clone().setY(yOut - 0.5), p3.clone().setY(yOut - 0.5), [[0, 0], [1, 0], [1, 1], [0, 1]], out);
    box(trim, -half, half, yAt(D - 0.4) - 0.9, yAt(D - 0.4) - 0.15, D - 0.65, D - 0.15);
    const n = Math.max(1, Math.ceil(a.width / 10));
    for (let k = 0; k <= n; k++) {
      const s = -half + 0.35 + ((a.width - 0.7) * k) / n;
      if (steps && Math.abs(s) < sw + 0.3) continue;
      box(trim, s - 0.25, s + 0.25, top, yAt(D - 0.4) - 0.8, D - 0.65, D - 0.15);
    }
  }
};

const building = (st: StructureItem, g: Ground, parts: Parts) => {
  if (outlineOf(st).length < 3) return;
  const F = buildingFrame(st, g);
  const { outline, gMin, floor, eave, roof, roofY } = F;
  const C = buildingColors(st);
  const at = (k: string) => (parts[k] ??= new Mesher());
  const trim = at("trim"), frames = at("frames"), found = at("found");
  const style = windowStyleOf(st), siding = sidingOf(st);
  // A foundation, a little proud of the walls
  prism(found, offsetPolygon(outline, 0.18), gMin - 0.6, floor + 0.15, p => [p.x, p.y]);
  const edges = F.walls.map(e => ({ ...e, dir: new V3(e.dir.x, 0, e.dir.y), out: new V3(e.out.x, 0, e.out.y) }));
  const along = F.along;
  let s0 = 0;
  edges.forEach((e, w) => {
    if (e.len < 1e-3) return;
    // (a point on this wall: s ft along it, y up, d ft out from its face)
    const pt = (s: number, y: number, d = 0) => { const p = along(w, s); return new V3(p.x, y, p.y).addScaledVector(e.out, d); };
    const box = (m: Mesher, sa: number, sb: number, ya: number, yb: number, da: number, db: number) =>
      m.box(pt((sa + sb) / 2, (ya + yb) / 2, (da + db) / 2), e.dir, UP, e.out, Math.abs(sb - sa) / 2, Math.abs(yb - ya) / 2, Math.abs(db - da) / 2);
    const mine = F.placed.filter(o => o.wall === w).map(o => ({ ...o, y0: o.bottom }));
    // The wall: up to the roof (a gable end's triangle too), its doors and windows cut out
    const tops = F.tops(w);
    const contour = [new THREE.Vector2(0, floor), new THREE.Vector2(e.len, floor), ...tops.reverse().map(t => new THREE.Vector2(t.s, t.y))];
    const doorsAtFloor = mine.filter(o => o.y0 <= floor + 0.01);
    // (a door opens the wall from the floor: its hole and the wall's foot are one, so the foot runs round it)
    const foot = [new THREE.Vector2(0, floor)];
    for (const o of [...doorsAtFloor].sort((x, y) => x.x0 - y.x0)) foot.push(new THREE.Vector2(o.x0, floor), new THREE.Vector2(o.x0, o.y1), new THREE.Vector2(o.x1, o.y1), new THREE.Vector2(o.x1, floor));
    const ring = [...foot, ...contour.slice(1)];
    const holes = mine.filter(o => !doorsAtFloor.includes(o)).map(o => [new THREE.Vector2(o.x0, o.y0), new THREE.Vector2(o.x1, o.y0), new THREE.Vector2(o.x1, o.y1), new THREE.Vector2(o.x0, o.y1)]);
    const pts = [...ring, ...holes.flat()];
    const wallM = at(`walls|${st.wallColors?.[w] ?? C.walls ?? ""}`);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring, holes))
      wallM.tri(pt(pts[i].x, pts[i].y), pt(pts[j].x, pts[j].y), pt(pts[k].x, pts[k].y), [[s0 + pts[i].x, pts[i].y], [s0 + pts[j].x, pts[j].y], [s0 + pts[k].x, pts[k].y]], e.out);
    s0 += e.len;
    // Corner boards (wood siding's)
    if (siding === "lap" || siding === "board") {
      box(trim, 0, 0.45, floor, roofY(e.a) - 0.1, 0, 0.1);
      box(trim, e.len - 0.45, e.len, floor, roofY(e.b) - 0.1, 0, 0.1);
    }
    for (const o of mine) {
      const { x0, x1, y0, y1 } = o;
      const sides = (m: Mesher, d0: number, d1: number, bottom: boolean) => {
        m.quad(pt(x0, y0, d0), pt(x0, y0, d1), pt(x0, y1, d1), pt(x0, y1, d0), [[0, 0], [1, 0], [1, 1], [0, 1]], e.dir);
        m.quad(pt(x1, y0, d0), pt(x1, y0, d1), pt(x1, y1, d1), pt(x1, y1, d0), [[0, 0], [1, 0], [1, 1], [0, 1]], e.dir.clone().negate());
        m.quad(pt(x0, y1, d0), pt(x1, y1, d0), pt(x1, y1, d1), pt(x0, y1, d1), [[0, 0], [1, 0], [1, 1], [0, 1]], UP.clone().negate());
        if (bottom) m.quad(pt(x0, y0, d0), pt(x1, y0, d0), pt(x1, y0, d1), pt(x0, y0, d1), [[0, 0], [1, 0], [1, 1], [0, 1]], UP);
      };
      const tw = o.kind === "garage" ? 0.4 : 0.36;
      // (its casing round it, a head over it)
      box(trim, x0 - tw, x0, o.kind === "window" ? y0 - 0.05 : y0, y1 + tw, 0, 0.1);
      box(trim, x1, x1 + tw, o.kind === "window" ? y0 - 0.05 : y0, y1 + tw, 0, 0.1);
      box(trim, x0 - tw - 0.1, x1 + tw + 0.1, y1, y1 + tw + 0.06, 0, 0.15);
      if (o.kind === "window") {
        const d = 0.45, f = 0.16, mid = (y0 + y1) / 2;
        sides(trim, 0, -d, true);
        // (the room behind: its sides dark, its back one of the four rooms)
        sides(at("dark"), -d, -d - 1.6, true);
        const v = Math.floor(Math.abs(Math.sin(w * 12.9898 + o.at * 78.233) * 43758.5453)) % 4;
        at("room").quad(pt(x0, y0, -d - 1.6), pt(x1, y0, -d - 1.6), pt(x1, y1, -d - 1.6), pt(x0, y1, -d - 1.6), [[v / 4, 0], [(v + 1) / 4, 0], [(v + 1) / 4, 1], [v / 4, 1]], e.out);
        at("glass").quad(pt(x0, y0, -d + 0.08), pt(x1, y0, -d + 0.08), pt(x1, y1, -d + 0.08), pt(x0, y1, -d + 0.08), [[0, 0], [1, 0], [1, 1], [0, 1]], e.out);
        // (two sashes: their frames and the rail where they meet; a grid of panes)
        box(frames, x0, x0 + f, y0, y1, -d + 0.04, -d + 0.18);
        box(frames, x1 - f, x1, y0, y1, -d + 0.04, -d + 0.18);
        box(frames, x0, x1, y1 - f, y1, -d + 0.04, -d + 0.18);
        box(frames, x0, x1, y0, y0 + f, -d + 0.04, -d + 0.18);
        box(frames, x0, x1, mid - 0.08, mid + 0.08, -d + 0.04, -d + 0.22);
        if (style !== "plain") {
          for (const k of [1, 2]) box(frames, x0 + ((x1 - x0) * k) / 3 - 0.03, x0 + ((x1 - x0) * k) / 3 + 0.03, y0, y1, -d + 0.18, -d + 0.22);
          for (const yy of [y0 + (y1 - y0) / 4, y0 + (3 * (y1 - y0)) / 4]) box(frames, x0, x1, yy - 0.03, yy + 0.03, -d + 0.18, -d + 0.22);
        }
        // (its sill, out over the wall)
        box(trim, x0 - tw - 0.15, x1 + tw + 0.15, y0 - 0.22, y0, -0.1, 0.3);
        if (style === "shutters") for (const [a, b] of [[x0 - tw - o.width / 2 - 0.05, x0 - tw - 0.05], [x1 + tw + 0.05, x1 + tw + o.width / 2 + 0.05]]) {
          box(at("shutters"), a, b, y0, y1, 0, 0.12);
          box(at("shutters"), a + 0.12, b - 0.12, (y0 + y1) / 2 - 0.12, (y0 + y1) / 2 + 0.12, 0.12, 0.17);
        }
      } else {
        // A door, or a garage's: set in, panels on it
        const d = 0.3, slab = at(o.kind === "garage" ? "garage" : "door");
        sides(trim, 0, -d, false);
        box(slab, x0, x1, y0, y1, -d - 0.15, -d);
        if (o.kind === "garage") for (let k = 1; k < 4; k++) box(slab, x0 + 0.1, x1 - 0.1, y0 + ((y1 - y0) * k) / 4 - 0.05, y0 + ((y1 - y0) * k) / 4 + 0.05, -d, -d + 0.05);
        else for (const [a, b] of [[0.18, 0.47], [0.53, 0.82]]) for (const [c, dd] of [[0.08, 0.42], [0.5, 0.78]]) box(slab, x0 + o.width * a, x0 + o.width * b, y0 + o.height * c, y0 + o.height * dd, -d, -d + 0.05);
        // Steps up to it where the floor stands over the ground: a landing, then steps down
        const ground = g(pt(o.at, 0, 3).x, pt(o.at, 0, 3).z), rise = y0 - ground;
        // (a porch or a deck in front of it: its own steps)
        const covered = (st.addOns ?? []).some(a => a.wall === w && (a.kind === "porch" || a.kind === "deck") && Math.abs(a.at - o.at) < a.width / 2);
        const n = covered ? 0 : stepsUp(rise);
        if (n && o.kind !== "garage") {
          const steps = at("steps"), wide = o.width / 2 + 1.1, land = 3.5, riser = rise / n;
          box(steps, o.at - wide, o.at + wide, ground - 0.4, y0 - 0.05, 0, land);
          for (let k = 1; k < n; k++) box(steps, o.at - wide, o.at + wide, ground - 0.4, y0 - 0.05 - k * riser, 0, land + k * 0.95);
        } else if (o.kind === "garage" && rise > 0.15) {
          // (a garage's: a concrete apron sloping down from its door to the ground)
          const apron = at("steps"), run = Math.max(4, rise * 6), a0 = x0 - 0.5, a1 = x1 + 0.5, lo = ground - 0.3;
          apron.quad(pt(a0, y0, 0), pt(a1, y0, 0), pt(a1, lo, run), pt(a0, lo, run), [[a0, 0], [a1, 0], [a1, run], [a0, run]], UP);
          for (const [x, sgn] of [[a0, -1], [a1, 1]] as [number, number][]) apron.tri(pt(x, y0, 0), pt(x, lo, run), pt(x, lo, 0), [[0, y0], [run, lo], [0, lo]], e.dir.clone().multiplyScalar(sgn));
        }
      }
    }
  });
  for (const a of st.addOns ?? []) addOnModel(a, F, g, at);
  if (structureRoof(st) === "flat") {
    // A flat roof: a membrane, and a low parapet round its edge
    roofFaces(roof, eave, at("flatroof"), trim);
    sweep(found, roof.eaves, roof.eaves.map(() => eave - 0.45), roof.eaves.map(() => eave + 1.1), 0, 0.28, true);
  } else roofFaces(roof, eave, at("roof"), trim);
  soffit(roof, outline, eave, 1.5, trim);
};

const shelter = (st: StructureItem, g: Ground, parts: Parts) => {
  const outline = outlineOf(st);
  if (outline.length < 3) return;
  const H = Math.max(6.5, structureHeight(st));
  const gs = [...alongEdges(outline, 6), orientedBox(outline).c].map(p => g(p.x, p.y));
  const gMin = Math.min(...gs), gMax = Math.max(...gs);
  const floor = gMax + 0.35, eave = floor + H;
  const concrete = (parts.concrete ??= new Mesher()), timber = (parts.timber ??= new Mesher());
  // A concrete pad, posts round the edge and a beam on them, and the roof
  prism(concrete, offsetPolygon(outline, 0.6), gMin - 0.5, floor, p => [p.x, p.y]);
  const inset = offsetPolygon(outline, -0.6);
  for (const p of alongEdges(inset, 10)) post(timber, p, floor, eave, 0.6);
  sweep(timber, inset, inset.map(() => eave - 1.05), inset.map(() => eave), 0, 0.3, true);
  const roof = roofFor(st, 2, 0.42, outline);
  roofFaces(roof, eave + 0.2, (parts.shelterRoof ??= new Mesher()), timber);
  // Picnic tables under it
  const box = orientedBox(outline);
  if (box.a >= 5 && box.b >= 4) {
    const rows = box.b >= 9 ? [-box.b / 2, box.b / 2] : [0];
    const per = Math.max(1, Math.floor((2 * box.a - 2) / 9));
    for (const t of rows) for (let k = 0; k < per; k++) {
      const s = -box.a + (2 * box.a * (k + 0.5)) / per;
      const c = { x: box.c.x + box.u.x * s + box.v.x * t, y: box.c.y + box.u.y * s + box.v.y * t };
      if (!pointInPolygon(c, outline)) continue;
      const ex = new V3(box.u.x, 0, box.u.y), ez = new V3(box.v.x, 0, box.v.y);
      const at = (along: number, across: number, y: number) => new V3(c.x + box.u.x * along + box.v.x * across, y, c.y + box.u.y * along + box.v.y * across);
      timber.box(at(0, 0, floor + 2.45), ex, UP, ez, 3, 0.09, 1.3);
      for (const side of [-1, 1]) {
        timber.box(at(0, side * 1.95, floor + 1.45), ex, UP, ez, 3, 0.08, 0.45);
        timber.box(at(side * 2.2, 0, floor + 1.2), ex, UP, ez, 0.15, 1.2, 1.1);
        timber.box(at(side * 2.2, 0, floor + 1.3), ex, UP, ez, 0.16, 0.09, 2.3);
      }
    }
  }
};

const deckModel = (st: StructureItem, g: Ground, parts: Parts) => {
  const outline = outlineOf(st);
  if (outline.length < 3) return;
  const H = Math.max(0.3, structureHeight(st));
  const box = orientedBox(outline);
  const gs = [...alongEdges(outline, 6), box.c].map(p => g(p.x, p.y));
  const top = Math.max(...gs) + H;
  const deckM = (parts.deck ??= new Mesher()), timber = (parts.timber ??= new Mesher());
  // Boards along the deck's long side
  prism(deckM, outline, top - 0.2, top, p => [p.x * box.v.x + p.y * box.v.y, p.x * box.u.x + p.y * box.u.y], false, true);
  prism(timber, offsetPolygon(outline, 0.06), top - 0.85, top - 0.02, p => [p.x, p.y], true);
  for (const p of alongEdges(offsetPolygon(outline, -0.4), 6)) post(timber, p, g(p.x, p.y) - 1, top - 0.2, 0.5);
  if (H > 2) {
    const ring = offsetPolygon(outline, -0.2);
    for (const p of alongEdges(ring, 6)) post(timber, p, top, top + 3.4, 0.34);
    sweep(timber, ring, ring.map(() => top + 3.1), ring.map(() => top + 3.42), 0, 0.18, true);
    sweep(timber, ring, ring.map(() => top + 1.55), ring.map(() => top + 1.78), 0, 0.07, true);
  }
};

/** A building's part's material: its walls (`walls|<color>`), roof, trim, doors and windows. */
const buildingMaterial = (key: string, st: StructureItem): THREE.Material => {
  const C = buildingColors(st);
  if (key.startsWith("walls|")) return surface(SIDING_SCAN[sidingOf(st)], key.slice(6) || undefined);
  switch (key) {
    case "roof": return surface(ROOFING_SCAN[roofingOf(st)], C.roof, true, C.roof ? ROOF_SHADE : 1);
    case "flatroof": return surface("stucco", C.roof ?? "#8d8b86");
    case "frames": return paintOf(C.frames, 0.5);
    case "door": return paintOf(C.door, 0.45);
    case "garage": return paintOf(C.trim, 0.5);
    case "shutters": return paintOf(C.shutters, 0.6);
    case "found": return surface("stone", C.foundation);
    case "steps": return surface("stucco", "#bdb8ae");
    case "pslab": return material("concrete");
    case "pdeck": return material("deck");
    case "ptimber": return material("timber");
    case "proof": return surface(ROOFING_SCAN[roofingOf(st)], C.roof, true, C.roof ? ROOF_SHADE : 1);
    case "proofm": return surface("roofmetal", C.roof, true, C.roof ? ROOF_SHADE : 1);
    case "post": case "rail": return paintOf(C.trim, 0.55);
    case "glass": return glass();
    case "room": return room();
    case "dark": return paintOf("#2a2622", 1);
    default: return paintOf(C.trim, 0.55);
  }
};

/**
 * A built thing as a 3D model on the ground (`groundAt` gives the ground's height). The group is
 * named "structure:<id>"; its meshes cast and catch shadows.
 */
export const createStructure = (st: StructureItem, groundAt: Ground) => {
  const group = new THREE.Group();
  group.name = `structure:${st.id}`;
  group.userData.structure = st.kind;
  if (st.points.length < (isLineKind(st.kind) ? 2 : 3)) return group;
  const parts: Parts = {};
  ({ bridge, boardwalk, stairs, wall, building, shelter, deck: deckModel })[st.kind](st, groundAt, parts);
  for (const [key, m] of Object.entries(parts) as [string, Mesher][]) {
    if (!m || m.empty) continue;
    const mesh = new THREE.Mesh(m.geometry(), st.kind === "building" ? buildingMaterial(key, st) : key === "shelterRoof" ? surface("roofmetal", st.roofColor ?? STRUCTURE_INK.shelter, true, ROOF_SHADE) : material(key as MatKey));
    mesh.name = key.split("|")[0];
    // (glass and the rooms behind it cast no shadow)
    mesh.castShadow = key !== "glass" && key !== "room";
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
};

// ------------------------------------------------------------------ fences

/** Chain link's wire: 2 in mesh (wire to wire), so its diamonds are 2.83 in from one to the next. */
const DIAMOND = (2 * Math.SQRT2) / 12;
/** Galvanized pipe, how far round (ft): line posts (2⅜ in), end and corner posts (2⅞ in), the top
 * rail (1⅝ in). */
const LINE_POST = 2.375 / 24, END_POST = 2.875 / 24, TOP_RAIL = 1.625 / 24;

/** A round pipe standing at `p` from `y0` up to `y1`, `r` ft round, with a low dome on top. */
const pipe = (m: Mesher, p: P, y0: number, y1: number, r: number, dome = r * 0.6) => {
  const N = 10;
  const dir = (k: number) => new V3(Math.cos((k / N) * Math.PI * 2), 0, Math.sin((k / N) * Math.PI * 2));
  const at = (d: V, y: number, rr = r) => new V3(p.x + d.x * rr, y, p.y + d.z * rr);
  const top = y1 + dome, mid = y1 + dome * 0.7, top0 = new V3(p.x, top, p.y);
  for (let k = 0; k < N; k++) {
    const d0 = dir(k), d1 = dir(k + 1), u0 = (k / N) * Math.PI * 2 * r, u1 = ((k + 1) / N) * Math.PI * 2 * r;
    m.smooth([at(d0, y0), at(d1, y0), at(d1, y1)], [d0, d1, d1], [[u0, y0], [u1, y0], [u1, y1]]);
    m.smooth([at(d0, y0), at(d1, y1), at(d0, y1)], [d0, d1, d0], [[u0, y0], [u1, y1], [u0, y1]]);
    if (dome <= 0) continue;
    // (the dome: round from the side up to a flat-ish top)
    const e0 = d0.clone().addScaledVector(UP, 0.4).normalize(), e1 = d1.clone().addScaledVector(UP, 0.4).normalize();
    const f0 = d0.clone().multiplyScalar(0.55).add(UP).normalize(), f1 = d1.clone().multiplyScalar(0.55).add(UP).normalize();
    m.smooth([at(d0, y1), at(d1, y1), at(d1, mid, r * 0.7)], [e0, e1, f1], [[u0, y1], [u1, y1], [u1, mid]]);
    m.smooth([at(d0, y1), at(d1, mid, r * 0.7), at(d0, mid, r * 0.7)], [e0, f1, f0], [[u0, y1], [u1, mid], [u0, mid]]);
    m.smooth([at(d0, mid, r * 0.7), at(d1, mid, r * 0.7), top0], [f0, f1, UP], [[u0, mid], [u1, mid], [(u0 + u1) / 2, top]]);
  }
};

/** A round rail through `pts` (rings square to the way it runs), `r` ft round. */
const tube = (m: Mesher, pts: V[], r: number) => {
  const N = 6, n = pts.length;
  const rings: V[][] = [], s: number[] = [];
  pts.forEach((c, i) => {
    const t = pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const side = new V3().crossVectors(t, UP).normalize(), up = new V3().crossVectors(side, t);
    rings.push(Array.from({ length: N + 1 }, (_, k) => side.clone().multiplyScalar(Math.cos((k / N) * Math.PI * 2)).addScaledVector(up, Math.sin((k / N) * Math.PI * 2))));
    s.push(i ? s[i - 1] + c.distanceTo(pts[i - 1]) : 0);
  });
  for (let i = 0; i + 1 < n; i++) {
    const A = rings[i], B = rings[i + 1], a = pts[i], b = pts[i + 1];
    const at = (c: V, d: V) => c.clone().addScaledVector(d, r);
    for (let k = 0; k < N; k++) {
      const v0 = (k / N) * Math.PI * 2 * r, v1 = ((k + 1) / N) * Math.PI * 2 * r;
      m.smooth([at(a, A[k]), at(b, B[k]), at(b, B[k + 1])], [A[k], B[k], B[k + 1]], [[s[i], v0], [s[i + 1], v0], [s[i + 1], v1]]);
      m.smooth([at(a, A[k]), at(b, B[k + 1]), at(a, A[k + 1])], [A[k], B[k + 1], A[k + 1]], [[s[i], v0], [s[i + 1], v1], [s[i], v1]]);
    }
  }
};

/** How far along a line its corners are (where it turns more than `deg` degrees). */
const cornersOf = (pts: P[], deg: number) => {
  const q = pts.filter((p, i) => !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6);
  const out: number[] = [];
  let s = 0;
  for (let i = 1; i + 1 < q.length; i++) {
    s += Math.hypot(q[i].x - q[i - 1].x, q[i].y - q[i - 1].y);
    let d = Math.abs(Math.atan2(q[i + 1].y - q[i].y, q[i + 1].x - q[i].x) - Math.atan2(q[i].y - q[i - 1].y, q[i].x - q[i - 1].x));
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > (deg * Math.PI) / 180) out.push(s);
  }
  return out;
};

/** The point `at` ft along a sampled path, and which way the path runs there. */
const alongAt = (samples: ReturnType<typeof samplePath>, at: number) => {
  let j = 0;
  while (j < samples.length - 2 && samples[j + 1].s < at) j++;
  const a = samples[j], b = samples[j + 1], t = Math.max(0, Math.min(1, (at - a.s) / Math.max(1e-6, b.s - a.s)));
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: a.angle };
};

/**
 * A fence along a drawn line, standing on the ground: wooden posts every 8 ft with a top and a
 * middle rail; solid boards with a cap; or chain link (see-through wire mesh at its real size) on
 * round galvanized posts, end and corner posts and line posts no more than 10 ft apart, with a top
 * rail. Its meshes cast and catch shadows.
 */
export const createFence = (points: P[], groundAt: Ground, height = 4, style: FenceStyle = "rail", cap?: string) => {
  const group = new THREE.Group();
  group.name = "fence";
  const samples = samplePath(points, 2);
  if (samples.length < 2) return group;
  const H = Math.max(1.5, Math.min(30, height));
  const ground = samples.map(p => groundAt(p.x, p.y));
  const total = samples[samples.length - 1].s;
  if (style === "chain") {
    const metal = new Mesher(), wire = new Mesher();
    const rail = H - TOP_RAIL;
    // Posts: one at each end and corner (the bigger end posts), line posts evenly between
    const stops = [0, ...cornersOf(points, 20).filter(s => s > 1 && s < total - 1), total];
    const postAt = (s: number, end: boolean) => {
      const { p } = alongAt(samples, s), gy = groundAt(p.x, p.y);
      if (end) pipe(metal, p, gy - 0.6, gy + H + 0.12, END_POST);
      else {
        // (a line post's loop cap, the top rail through it)
        pipe(metal, p, gy - 0.6, gy + rail, LINE_POST, 0);
        pipe(metal, p, gy + rail - 0.1, gy + rail + 0.07, LINE_POST + 0.03, 0.05);
      }
    };
    stops.forEach((s0, i) => {
      postAt(s0, true);
      const len = (stops[i + 1] ?? s0) - s0, n = Math.ceil(len / 10);
      for (let k = 1; k < n; k++) postAt(s0 + (k * len) / n, false);
    });
    tube(metal, samples.map((p, i) => w3(p, ground[i] + rail)), TOP_RAIL);
    // The wire on the face of the posts, from just off the ground to the top rail; texture in feet
    // from its bottom edge, so the diamonds keep their size on a slope
    const off = LINE_POST + 0.012, lo = 0.15;
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = aside(samples[i], off), b = aside(samples[i + 1], off), s0 = samples[i].s, s1 = samples[i + 1].s;
      wire.quad(w3(a, ground[i] + lo), w3(b, ground[i + 1] + lo), w3(b, ground[i + 1] + H), w3(a, ground[i] + H), [[s0, 0], [s1, 0], [s1, H - lo], [s0, H - lo]]);
    }
    // A tension bar down each end of the wire, where it's fastened to the end post
    for (const [d, sgn] of [[samples[0], 1], [samples[samples.length - 1], -1]] as const) {
      const ex = new V3(Math.cos(d.angle), 0, Math.sin(d.angle)), ez = new V3(-ex.z, 0, ex.x);
      const c = aside(d, off + 0.015), gy = groundAt(d.x, d.y);
      metal.box(w3(c, gy + (lo + H) / 2).addScaledVector(ex, sgn * (END_POST + 0.05)), ex, UP, ez, 0.03, (H - lo) / 2, 0.012);
    }
    const posts = new THREE.Mesh(metal.geometry(), chainPost());
    posts.name = "metal";
    posts.castShadow = posts.receiveShadow = true;
    const sheet = new THREE.Mesh(wire.geometry(), chainLink());
    sheet.name = "chain";
    sheet.castShadow = true;
    sheet.customDepthMaterial = chainShadow!;
    // (drawn after the paint on the ground: seen through it, never hiding it)
    sheet.renderOrder = 7;
    group.add(posts, sheet);
    // (a colored cap along the top: a ball field's yellow, a court's green)
    if (cap) {
      const top = new Mesher();
      tube(top, samples.map((p, i) => w3(p, ground[i] + H + 0.08)), TOP_RAIL + 0.08);
      const capMesh = new THREE.Mesh(top.geometry(), new THREE.MeshStandardMaterial({ color: cap, roughness: 0.6 }));
      capMesh.name = "cap";
      group.add(capMesh);
    }
    return group;
  }
  const parts: Parts = {};
  const wood = (parts.timber ??= new Mesher());
  // (a post every 8 ft or so, one at each end, square to the line)
  const count = Math.max(1, Math.round(total / 8));
  for (let k = 0; k <= count; k++) {
    const { p, angle } = alongAt(samples, (total * k) / count), gy = groundAt(p.x, p.y);
    post(wood, p, gy - 0.8, gy + H + (style === "boards" ? 0.15 : 0.2), style === "boards" ? 0.4 : 0.36, angle);
  }
  if (style === "rail") {
    sweep(wood, samples, ground.map(y => y + H - 0.45), ground.map(y => y + H - 0.12), 0, 0.09);
    sweep(wood, samples, ground.map(y => y + H * 0.45), ground.map(y => y + H * 0.45 + 0.33), 0, 0.09);
  } else {
    sweep(wood, samples, ground.map(y => y + 0.15), ground.map(y => y + H), 0, 0.06);
    sweep(wood, samples, ground.map(y => y + H), ground.map(y => y + H + 0.18), 0, 0.12);
  }
  for (const [key, m] of Object.entries(parts) as [MatKey, Mesher][]) {
    if (m.empty) continue;
    const mesh = new THREE.Mesh(m.geometry(), material(key));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
};
// (the 3D view only draws when something changes: told when a part's picture arrives)
const partLoaded = new Set<() => void>();
/** Calls back when a part's real texture has loaded; returns the call to stop. */
export const onPartLoaded = (f: () => void) => { partLoaded.add(f); const off = onLookLoaded(f); return () => { partLoaded.delete(f); off(); }; };
let chainMat: THREE.MeshStandardMaterial | null = null, chainShadow: THREE.MeshDepthMaterial | null = null, chainPostMat: THREE.Material | null = null;
/** Galvanized posts and rails. */
const chainPost = () => (chainPostMat ??= Object.assign(new THREE.MeshStandardMaterial({ color: "#8a9296", roughness: 0.5, metalness: 0.55 }), { userData: { shared: true } }));
/**
 * Chain link: a diamond mesh you see through, blended (far off, the wire's mipmaps fade it to a
 * faint grey veil rather than flickering). Drawn on a canvas at first, one diamond, and then the
 * real wire from loafbrr's Chainlink Fence Modular Kit (CC0; public/parts/fence/chainlink.png, 4 ×
 * 4 diamonds) once it's in, in the same material, so fences already standing change with it. Its
 * shadow is the wire only where the shadow map is fine enough to show it.
 */
const chainLink = () => {
  if (chainMat) return chainMat;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(170,176,180,0.95)";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath(); g.stroke();
  const drawn = new THREE.CanvasTexture(c);
  const tile = (tex: THREE.Texture, ft: number) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / ft, 1 / ft);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.userData.shared = true;
    return tex;
  };
  const mat = (chainMat = new THREE.MeshStandardMaterial({ map: tile(drawn, DIAMOND), color: "#9aa1a5", transparent: true, opacity: 1.1, alphaTest: 0.02, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.45 }));
  const shadow = (chainShadow = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: drawn, alphaTest: 0.5, side: THREE.DoubleSide }));
  mat.userData.shared = shadow.userData.shared = true;
  // (opacity over 1: the wire a little stronger, so a far fence still reads as one. And read a
  // little softer than the mipmaps alone would, so the knots of wire, in rows, don't sparkle a
  // way off; close up it's as sharp)
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vMapUv, 0.75 )"));
  };
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}parts/fence/chainlink.png`, real => {
    mat.map = shadow.map = tile(real, 4 * DIAMOND);
    mat.needsUpdate = shadow.needsUpdate = true;
    drawn.dispose();
    for (const f of partLoaded) f();
  }, undefined, () => { /* (the drawn one stays) */ });
  return mat;
};
