// Trees in 3D that read as real trees: a branching skeleton (trunk, limbs, branches) of tapered
// bark tubes, and foliage of leaf-cluster cards (drawn leaves on transparent textures) gathered
// at the branch tips, lit as one soft crown (each card's light comes mostly from where it sits on
// the crown, so the crown shades like a real one: bright on the sunny side, dark inside and
// underneath). A few shapes of each kind are made once, at unit height, and shared by every tree:
// woods draw them instanced, a close version near the camera and a lighter one farther away.
import * as THREE from "three";
import { EZ_VARIANTS, LOD_BAND, ezLoaded, ezProto, ezTint, ezTree, treeLodZoom, type TreeSpec } from "./ezShapes";

export type TreeShape = "broadleaf" | "conifer" | "bush";
export type Detail = "near" | "mid" | "far" | "brush";

/** Shapes made of each kind (trees pick one by their id, so each keeps its own). */
export const VARIANTS: Record<TreeShape, number> = EZ_VARIANTS;
/** The hand-built shapes from before ez-tree (the tree lab shows them beside the new ones). */
export const CLASSIC_VARIANTS: Record<TreeShape, number> = { broadleaf: 4, conifer: 3, bush: 2 };

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------------- textures (drawn once)

let leafAtlas: THREE.Texture | null = null;
let needleAtlas: THREE.Texture | null = null;
let barkTex: THREE.Texture | null = null;

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
};

const shareTexture = (c: HTMLCanvasElement, repeat = false) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.shared = true;
  return t;
};

/**
 * Leaf clusters: four sprays of leaves on twigs (2 x 2 cells), light gray-green so each tree's own
 * color tints them. The leaves are small (a few inches on a grown tree) and many, each a little
 * lighter, darker, yellower or bluer than the next, darker toward the middle of the spray where
 * they shade each other: up close a crown reads as leaves, not as cards.
 */
const getLeafAtlas = () => {
  if (leafAtlas || typeof document === "undefined") return leafAtlas;
  const S = 512;
  const { c, g } = canvas(S * 2, S * 2);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
    const rnd = seeded(101 + cell * 977);
    g.save();
    g.beginPath();
    g.rect(ox, oy, S, S);
    g.clip();
    const cx = ox + S / 2;
    // Twigs fanning up and out from the bottom middle, each with side twiglets
    const twigs: { x: number; y: number; ex: number; ey: number }[] = [];
    const n = 7 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.6 + (rnd() - 0.5) * 0.3, len = S * (0.36 + rnd() * 0.12);
      const x = cx + (rnd() - 0.5) * 30, y = oy + S * 0.95;
      twigs.push({ x, y, ex: x + Math.cos(a) * len, ey: y + Math.sin(a) * len });
      for (let k = 0.3; k < 0.95; k += 0.2 + rnd() * 0.1) {
        const bx = x + (Math.cos(a) * len) * k, by = y + (Math.sin(a) * len) * k;
        const side = rnd() < 0.5 ? -1 : 1, b = a + side * (0.5 + rnd() * 0.4), bl = len * (0.22 + rnd() * 0.15);
        twigs.push({ x: bx, y: by, ex: bx + Math.cos(b) * bl, ey: by + Math.sin(b) * bl });
      }
    }
    g.strokeStyle = "rgb(84,72,56)";
    g.lineCap = "round";
    for (const t of twigs) {
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(t.x, t.y);
      g.lineTo(t.ex, t.ey);
      g.stroke();
    }
    // Leaves all along the twigs and thick at their tips
    const leaves: { x: number; y: number; a: number; s: number }[] = [];
    for (const t of twigs) {
      const a = Math.atan2(t.ey - t.y, t.ex - t.x), len = Math.hypot(t.ex - t.x, t.ey - t.y);
      for (let k = 0.15; k <= 1.0001; k += 18 / len) {
        for (const side of [-1, 1]) leaves.push({ x: t.x + (t.ex - t.x) * k, y: t.y + (t.ey - t.y) * k, a: a + side * (0.5 + rnd() * 0.7), s: 0.8 + rnd() * 0.45 });
      }
      for (let k = 0; k < 5; k++) leaves.push({ x: t.ex + (rnd() - 0.5) * 14, y: t.ey + (rnd() - 0.5) * 14, a: a + (rnd() - 0.5) * 2.2, s: 0.85 + rnd() * 0.35 });
    }
    // Back to front: leaves lower in the spray drawn first
    leaves.sort((p, q) => q.y - p.y);
    for (const l of leaves) {
      const len = 30 * l.s, w = 12 * l.s;
      // (darker toward the middle of the spray and its bottom, where leaves shade each other)
      const inner = Math.min(1, Math.hypot(l.x - cx, l.y - (oy + S * 0.55)) / (S * 0.45));
      const lum = (0.62 + rnd() * 0.34) * (0.8 + 0.2 * inner) + (rnd() < 0.12 ? 0.14 : 0);
      const warm = (rnd() - 0.5) * 0.16;
      const r = Math.round(Math.min(255, 186 * lum * (1 + warm))), gg = Math.round(Math.min(255, 220 * lum)), b = Math.round(Math.min(255, 160 * lum * (1 - warm)));
      g.save();
      g.translate(l.x, l.y);
      g.rotate(l.a + Math.PI / 2);
      const grad = g.createLinearGradient(-w, 0, w, 0);
      grad.addColorStop(0, `rgb(${Math.round(r * 0.74)},${Math.round(gg * 0.74)},${Math.round(b * 0.74)})`);
      grad.addColorStop(0.5, `rgb(${r},${gg},${b})`);
      grad.addColorStop(1, `rgb(${Math.round(r * 0.88)},${Math.round(gg * 0.88)},${Math.round(b * 0.88)})`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(w, -len * 0.22, w * 0.75, -len * 0.78, 0, -len);
      g.bezierCurveTo(-w * 0.75, -len * 0.78, -w, -len * 0.22, 0, 0);
      g.fill();
      g.restore();
    }
    g.restore();
  }
  return (leafAtlas = shareTexture(c));
};

/** Needle sprays: twigs thick with needles on both sides, drooping a little at the ends. */
const getNeedleAtlas = () => {
  if (needleAtlas || typeof document === "undefined") return needleAtlas;
  const S = 512;
  const { c, g } = canvas(S * 2, S * 2);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
    const rnd = seeded(331 + cell * 613);
    g.save();
    g.beginPath();
    g.rect(ox, oy, S, S);
    g.clip();
    // One branchlet from the left middle to the right, with side shoots, each thick with short,
    // fine needles (darker toward the stem, where they shade each other)
    const stems: { x: number; y: number; a: number; len: number }[] = [{ x: ox + 20, y: oy + S / 2, a: (rnd() - 0.5) * 0.2, len: S * 0.9 }];
    for (let i = 0; i < 10; i++) {
      const k = 0.1 + i * 0.085;
      stems.push({ x: ox + 20 + S * 0.9 * k, y: oy + S / 2, a: (i % 2 ? 1 : -1) * (0.5 + rnd() * 0.35), len: S * (0.3 - k * 0.14) * (0.85 + rnd() * 0.3) });
    }
    for (const st of stems) {
      const ex = st.x + Math.cos(st.a) * st.len, ey = st.y + Math.sin(st.a) * st.len;
      g.strokeStyle = "rgb(78,64,48)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(st.x, st.y);
      g.lineTo(ex, ey);
      g.stroke();
      for (let k = 0.02; k < 1; k += 0.009) {
        const px = st.x + (ex - st.x) * k, py = st.y + (ey - st.y) * k;
        for (const side of [-1, 1]) {
          const a = st.a + side * (0.7 + rnd() * 0.45);
          const len = (22 + rnd() * 14) * (1 - k * 0.3);
          const lum = (0.55 + rnd() * 0.4) * (rnd() < 0.4 ? 0.85 : 1) + (rnd() < 0.08 ? 0.15 : 0);
          g.strokeStyle = `rgb(${Math.round(160 * lum)},${Math.round(206 * lum)},${Math.round(176 * lum)})`;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len + len * 0.12);
          g.stroke();
        }
      }
    }
    g.restore();
  }
  return (needleAtlas = shareTexture(c));
};

/** Bark: gray-brown with long dark furrows and lighter ridges (repeats around and along). */
const getBark = () => {
  if (barkTex || typeof document === "undefined") return barkTex;
  const { c, g } = canvas(256, 512);
  g.fillStyle = "rgb(104,92,80)";
  g.fillRect(0, 0, 256, 512);
  const rnd = seeded(77);
  for (let i = 0; i < 70; i++) {
    let x = rnd() * 256;
    const dark = rnd() < 0.6;
    g.strokeStyle = dark ? `rgba(40,32,26,${0.35 + rnd() * 0.4})` : `rgba(170,158,140,${0.2 + rnd() * 0.3})`;
    g.lineWidth = dark ? 2 + rnd() * 4 : 1 + rnd() * 2;
    g.beginPath();
    let y = rnd() * 512;
    g.moveTo(x, y);
    const len = 80 + rnd() * 300;
    for (let k = 0; k < len; k += 12) {
      x += (rnd() - 0.5) * 6;
      y += 12;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return (barkTex = shareTexture(c, true));
};

// ---------------------------------------------------------------- materials (shared)

const mats = new Map<string, THREE.Material>();

/** Leaf cards: alpha-cut, both sides lit the same (from where they sit on the crown). */
export const leafMaterial = (needles: boolean) => {
  const key = needles ? "needles" : "leaves";
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: needles ? getNeedleAtlas() : getLeafAtlas(),
    vertexColors: true,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0
  });
  m.onBeforeCompile = shader => {
    // The crown's normal on both faces (no dark backs), and a little light through the leaves
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <normal_fragment_begin>", "float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.06;");
  };
  m.customProgramCacheKey = () => `dg-foliage-${key}`;
  m.userData.shared = true;
  mats.set(key, m);
  return m;
};

export const barkMaterial = () => {
  let m = mats.get("bark") as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ map: getBark(), vertexColors: true, roughness: 0.95, metalness: 0 });
  m.userData.shared = true;
  mats.set("bark", m);
  return m;
};

// ---------------------------------------------------------------- geometry builders

export class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(p: V3, n: V3, u: number, v: number, c: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c, c, c);
    return this.pos.length / 3 - 1;
  }
  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    geo.userData.shared = true;
    return geo;
  }
}

/** A tapered tube from a to b (radius ra to rb), `sides` around. */
export const tube = (b: Builder, a: V3, e: V3, ra: number, rb: number, sides: number, shadeA = 0.75, shadeB = 1) => {
  const dir = e.clone().sub(a);
  const len = dir.length();
  if (len < 1e-5) return;
  dir.normalize();
  const side = Math.abs(dir.y) < 0.95 ? v3(0, 1, 0).cross(dir).normalize() : v3(1, 0, 0).cross(dir).normalize();
  const up = dir.clone().cross(side).normalize();
  const base = b.pos.length / 3;
  for (let ring = 0; ring < 2; ring++) {
    const c = ring ? e : a, r = ring ? rb : ra;
    for (let i = 0; i <= sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(t)).addScaledVector(up, Math.sin(t));
      b.vert(c.clone().addScaledVector(n, r), n, i / sides, ring ? len * 6 : 0, ring ? shadeB : shadeA);
    }
  }
  for (let i = 0; i < sides; i++) {
    const p = base + i, q = base + sides + 1 + i;
    b.idx.push(p, q, p + 1, p + 1, q, q + 1);
  }
};

/**
 * A leaf card at p, roughly facing `facing`, `size` across, lit with `normal` (the crown's),
 * shaded `shade` (darker inside the crown), one of the atlas's four sprays.
 */
export const card = (b: Builder, p: V3, facing: V3, size: number, spin: number, normal: V3, shade: number, cell: number) => {
  const n = facing.clone().normalize();
  const t1 = (Math.abs(n.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0)).cross(n).normalize();
  const t2 = n.clone().cross(t1).normalize();
  const c = Math.cos(spin), s = Math.sin(spin);
  const ax = t1.clone().multiplyScalar(c).addScaledVector(t2, s).multiplyScalar(size / 2);
  const ay = t2.clone().multiplyScalar(c).addScaledVector(t1, -s).multiplyScalar(size / 2);
  const u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
  const base = b.pos.length / 3;
  b.vert(p.clone().sub(ax).sub(ay), normal, u0, v0, shade * 0.9);
  b.vert(p.clone().add(ax).sub(ay), normal, u0 + 0.5, v0, shade * 0.9);
  b.vert(p.clone().add(ax).add(ay), normal, u0 + 0.5, v0 + 0.5, shade);
  b.vert(p.clone().sub(ax).add(ay), normal, u0, v0 + 0.5, shade);
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A shape: its bark and leaves (and their own materials, for ez-tree's), and how wide it is
 * for its height. */
export type TreeProto = { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry; needles: boolean; barkMat?: THREE.Material; leafMat?: THREE.Material; natural?: number };

/**
 * A broadleaf tree (or a bush) of height 1: trunk, limbs forking toward the crown's edge, and
 * leaf sprays at the branch tips filling out an irregular crown.
 */
const broadleaf = (variant: number, detail: Detail, bush: boolean): TreeProto => {
  const rnd = seeded(1000 + variant * 7919 + (bush ? 31 : 0));
  const near = detail === "near";
  const bark = new Builder(), leaves = new Builder();
  const crown = bush
    ? { cx: 0, cy: 0.5, cz: 0, rx: 0.62 + rnd() * 0.1, ry: 0.48 }
    : { cx: (rnd() - 0.5) * 0.04, cy: 0.62 + rnd() * 0.06, cz: (rnd() - 0.5) * 0.04, rx: 0.3 + rnd() * 0.1, ry: 0.3 + rnd() * 0.05 };
  const center = v3(crown.cx, crown.cy, crown.cz);
  const sides = near ? 6 : 4;
  const r0 = bush ? 0.02 : 0.02 + rnd() * 0.006;
  const forkY = bush ? 0.12 : crown.cy - crown.ry * (0.55 + rnd() * 0.25);
  const fork = v3((rnd() - 0.5) * 0.03, forkY, (rnd() - 0.5) * 0.03);
  tube(bark, v3(0, -0.02, 0), fork, r0 * 1.25, r0 * 0.85, sides, 0.6, 0.85);
  const tips: V3[] = [];
  // Limbs out toward the crown's edge, each forking twice
  const limbs = (bush ? 6 : 4) + Math.floor(rnd() * 3);
  const grow = (from: V3, to: V3, r: number, depth: number) => {
    // A slight bend: through a point pushed up and out
    const mid = from.clone().lerp(to, 0.5).add(v3((rnd() - 0.5) * 0.04, 0.03 + rnd() * 0.03, (rnd() - 0.5) * 0.04));
    tube(bark, from, mid, r, r * 0.8, sides, 0.8, 0.9);
    tube(bark, mid, to, r * 0.8, r * 0.55, depth > 1 ? Math.max(3, sides - 2) : sides, 0.9, 1);
    if (depth >= (near ? 3 : 2)) {
      tips.push(to);
      return;
    }
    const kids = 2 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const out = to.clone().sub(center);
      out.y *= 0.6;
      out.normalize();
      const jitter = v3(rnd() - 0.5, rnd() * 0.8 - 0.2, rnd() - 0.5).multiplyScalar(0.9);
      const dir = out.add(jitter).normalize();
      const len = (crown.rx * 0.42) / (depth * 0.8 + 0.6) * (0.75 + rnd() * 0.5);
      const end = to.clone().addScaledVector(dir, len);
      // Kept inside the crown (pulled back if past its edge)
      const q = v3((end.x - crown.cx) / crown.rx, (end.y - crown.cy) / crown.ry, (end.z - crown.cz) / crown.rx);
      if (q.length() > 0.95) end.copy(center).add(v3(q.x * crown.rx, q.y * crown.ry, q.z * crown.rx).multiplyScalar(0.95 / q.length()));
      grow(to, end, r * 0.55, depth + 1);
    }
  };
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rnd() * 0.8;
    const reach = crown.rx * (0.45 + rnd() * 0.3);
    const to = v3(crown.cx + Math.cos(a) * reach, crown.cy + crown.ry * (rnd() * 0.5 - 0.15), crown.cz + Math.sin(a) * reach);
    grow(fork, to, r0 * 0.62, 1);
  }
  // A leader up the middle
  grow(fork, v3(crown.cx, crown.cy + crown.ry * 0.55, crown.cz), r0 * 0.6, near ? 2 : 1);

  // Leaves: sprays around each tip, and more over the crown's shell to fill its outline
  const shadeAt = (p: V3) => {
    const q = Math.sqrt(((p.x - crown.cx) / crown.rx) ** 2 + ((p.y - crown.cy) / crown.ry) ** 2 + ((p.z - crown.cz) / crown.rx) ** 2);
    const under = smooth(-0.9, 0.4, (p.y - crown.cy) / crown.ry);
    return Math.max(0.18, (0.32 + 0.68 * smooth(0.25, 1, q)) * (0.62 + 0.38 * under));
  };
  const normalAt = (p: V3, facing: V3) => {
    const radial = v3((p.x - crown.cx) / crown.rx, (p.y - crown.cy) / crown.ry, (p.z - crown.cz) / crown.rx).normalize();
    return radial.multiplyScalar(0.8).addScaledVector(facing, 0.2).normalize();
  };
  const size = (near ? 0.13 : 0.27) * (bush ? 1.3 : 1) * (crown.rx / 0.36);
  const place = (p: V3, s: number) => {
    const out = p.clone().sub(center).normalize();
    const facing = out.add(v3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(1.1)).normalize();
    card(leaves, p, facing, s * (0.75 + rnd() * 0.5), rnd() * Math.PI * 2, normalAt(p, facing), shadeAt(p), Math.floor(rnd() * 4));
  };
  const perTip = near ? 8 : 2;
  for (const t of tips) {
    for (let k = 0; k < perTip; k++) place(t.clone().add(v3(rnd() - 0.5, rnd() - 0.4, rnd() - 0.5).multiplyScalar(crown.rx * 0.4)), size);
  }
  const shell = near ? 130 : 34;
  for (let k = 0; k < shell; k++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    // Bumpy outline: lobes where the shell pushes out
    const lobe = 0.72 + 0.28 * Math.pow(Math.abs(Math.sin(th * 2.5 + variant) * Math.cos(u * 3 + variant)), 0.5) + rnd() * 0.1;
    const p = v3(crown.cx + Math.cos(th) * rr * crown.rx * lobe, crown.cy + Math.max(-0.75, u) * crown.ry * lobe, crown.cz + Math.sin(th) * rr * crown.rx * lobe);
    place(p, size * 1.1);
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), needles: false };
};

/** A conifer of height 1: a straight trunk and whorls of drooping branches, shorter toward the top. */
const conifer = (variant: number, detail: Detail): TreeProto => {
  const rnd = seeded(5000 + variant * 6151);
  const near = detail === "near";
  const bark = new Builder(), leaves = new Builder();
  const r0 = 0.018;
  tube(bark, v3(0, -0.02, 0), v3(0, 0.55, 0), r0, r0 * 0.6, near ? 6 : 4, 0.6, 0.85);
  tube(bark, v3(0, 0.55, 0), v3(0, 1, 0), r0 * 0.6, r0 * 0.08, near ? 5 : 3, 0.85, 1);
  const bare = 0.1 + rnd() * 0.08;
  const step = near ? 0.034 : 0.07;
  const width = 0.27 + rnd() * 0.07;
  for (let y = bare, w = 0; y < 0.97; y += step * (0.85 + rnd() * 0.3), w++) {
    const t = (y - bare) / (1 - bare);
    const L = width * Math.pow(1 - t, 0.85) + 0.025;
    const count = (near ? 6 : 5) + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + w * 2.4 + rnd() * 0.5;
      const dir = v3(Math.cos(a), -0.18 - rnd() * 0.15 + t * 0.3, Math.sin(a)).normalize();
      const from = v3(0, y, 0);
      const to = from.clone().addScaledVector(dir, L);
      to.y -= L * 0.12;
      if (near) tube(bark, from, to, 0.005, 0.0015, 3, 0.7, 0.9);
      // Needle sprays along the branch, lying flat-ish and drooping at the tips
      const sprays = near ? 4 : 2;
      for (let k = 0; k < sprays; k++) {
        const f = 0.25 + (k / (sprays - 1)) * 0.75;
        const p = from.clone().lerp(to, f);
        const out = v3(p.x, 0, p.z).normalize();
        const facing = v3(0, 1, 0).addScaledVector(out, 0.35 + rnd() * 0.3).add(v3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(0.5)).normalize();
        const s = near ? Math.max(0.065, Math.min(0.17, L * 0.78)) : Math.max(0.1, Math.min(0.3, L * 1.5));
        const radial = v3(p.x / width, (p.y - 0.5) * 0.6, p.z / width);
        const normal = radial.lengthSq() > 1e-6 ? radial.normalize().multiplyScalar(0.6).add(v3(0, 0.55, 0)).normalize() : v3(0, 1, 0);
        const inner = smooth(0, 1, Math.hypot(p.x, p.z) / Math.max(0.03, L));
        const shade = Math.max(0.2, (0.35 + 0.65 * inner) * (0.7 + 0.3 * t));
        const spin = Math.atan2(to.z - from.z, to.x - from.x) + (rnd() - 0.5) * 0.4;
        card(leaves, p, facing, s * (0.85 + rnd() * 0.3), spin, normal, shade, Math.floor(rnd() * 4));
        // (and one across it, tilted down the branch, so a branch has depth seen from the side)
        if (near && k % 2 === 0) {
          const across = facing.clone().cross(v3(Math.cos(spin), 0, Math.sin(spin))).normalize().lerp(out, 0.4).normalize();
          card(leaves, p, across, s * (0.7 + rnd() * 0.25), spin + Math.PI / 2 * (rnd() < 0.5 ? 1 : -1), normal, shade * 0.92, Math.floor(rnd() * 4));
        }
      }
    }
  }
  return { bark: bark.geometry(), leaves: leaves.geometry(), needles: true };
};

const protos = new Map<string, TreeProto>();

/** A tree shape (made once, shared): unit height, standing on its base at the origin. ez-tree's,
 * or (`classic`) the hand-built ones from before. */
export const treeProto = (shape: TreeShape, variant: number, detail: Detail, classic = false): TreeProto => {
  const key = `${shape}|${variant}|${detail}|${classic}`;
  let p = protos.get(key);
  if (!p) {
    // (the classic shapes have two levels: their far one serves the middle distance too)
    const d = classic && (detail === "mid" || detail === "brush") ? "far" : detail;
    // (without ez-tree, outside a browser, the hand-built shapes stand in)
    const old = classic || !ezLoaded();
    p = old ? (shape === "conifer" ? conifer(variant % CLASSIC_VARIANTS.conifer, d as "near" | "far") : broadleaf(variant % CLASSIC_VARIANTS[shape], d as "near" | "far", shape === "bush")) : ezProto(shape, variant, detail);
    protos.set(key, p);
  }
  return p;
};

/** How wide a shape stands for its height (its own, or the kind's usual). */
const naturalOf = (shape: TreeShape, proto: TreeProto) => proto.natural ?? (shape === "conifer" ? 0.62 : shape === "bush" ? 1.3 : 0.75);
/** The color a tree's leaves take: ez-tree's photographed leaves gently, the classic ones fully. */
const leafTint = (proto: TreeProto, tint: THREE.Color) => (proto.leafMat ? ezTint(tint) : tint);

/** Which shape a tree takes (the same one every time for the same tree). */
export const variantOf = (id: string, shape: TreeShape) => {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % VARIANTS[shape];
};

/** How much wider (or narrower) than its natural shape a tree is drawn: as asked, whatever its
 * height (its crown as wide as set: a 2 ft crown on a 110 ft tree, a 40 ft one on a 10 ft tree). */
export const treeSpread = (asked: number) => Math.min(50, Math.max(0.02, asked));
/** The same for the trees of woods (made, not placed): kept to what looks like a natural tree. */
const woodsSpread = (asked: number) => Math.min(1.5, Math.max(0.72, asked));
/** How wide a tree of the woods (or measured from the air) is drawn, ft across its crown, asked
 * `width` at `height`: a tree taken from the woods to be the course's own keeps it, so it looks
 * the same picked as it did standing there. */
export const woodsCrownWidth = (shape: TreeShape, variant: number, height: number, width: number) => {
  const nat = naturalOf(shape, treeProto(shape, variant, "near"));
  return woodsSpread(width / Math.max(1, height) / nat) * height * nat;
};

/** One tree as meshes (shared shape and materials): `height` ft tall, `width` ft across the crown. */
export const treeMeshes = (shape: TreeShape, variant: number, height: number, width: number, tint: THREE.Color, detail: Detail = "near", classic = false, spec?: TreeSpec) => {
  const proto = spec && !classic && ezLoaded() ? ezTree(shape, spec, detail) : treeProto(shape, variant, detail, classic);
  const group = new THREE.Group();
  const sx = treeSpread(width / height / naturalOf(shape, proto));
  const leafMat = (proto.leafMat ?? leafMaterial(proto.needles)) as THREE.MeshStandardMaterial;
  const bark = new THREE.Mesh(proto.bark, proto.barkMat ?? barkMaterial());
  const leaves = new THREE.Mesh(proto.leaves, tintedFoliage(leafMat, leafTint(proto, tint)));
  for (const m of [bark, leaves]) {
    m.scale.set(height * sx, height, height * sx);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
};

/** Foliage tinted for one tree: a light copy of the shared material (same shader and texture). */
const tintCache = new Map<string, THREE.Material>();
const tintedFoliage = (base: THREE.MeshStandardMaterial, tint: THREE.Color) => {
  const key = `${base.name || base.customProgramCacheKey()}|${tint.getHexString()}`;
  let m = tintCache.get(key);
  if (!m) {
    const c = base.clone();
    c.onBeforeCompile = base.onBeforeCompile;
    c.customProgramCacheKey = base.customProgramCacheKey;
    c.color.copy(tint);
    c.userData.shared = true;
    m = c;
    tintCache.set(key, m);
  }
  return m;
};

// ---------------------------------------------------------------- woods: instanced, two levels of detail

export type TreeSpot = { x: number; y: number; ground: number; height: number; width: number; shape: TreeShape; variant: number; tint: THREE.Color; turn: number; lean: number;
  /** A tree placed by hand, drawn with the others: exactly where and how it stands (its meshes'
   * own matrix), and its leaves' own color. */
  matrix?: THREE.Matrix4; leaf?: THREE.Color };

/** Trees nearer than this to the camera use the close shapes, ft (less without a graphics card);
 * the middle ones out to `midOf(nearFt)`, the rest the far ones. `all`: every tree, bush and bit
 * of underbrush in its closest version however far off (a video recording: nothing changes as
 * the camera comes up to it). */
export const forestDetail = { nearFt: 260, version: 0, all: false,
  /** One version melting into the next (off without a graphics card: a tree in two versions at once is twice the work). */
  melt: true };
// (what a forest's camera sees, and the sun's shadow picture: worked out in these, kept to save
// making them every time)
const seeDir = new THREE.Vector3(), seeMatrix = new THREE.Matrix4(), seeFrustum = new THREE.Frustum(), seeBall = new THREE.Sphere();
const sunMatrix = new THREE.Matrix4(), sunFrustum = new THREE.Frustum();
/** The layers trees are drawn on: what a camera sees (1), and what throws the sun's shadows (2). A
 * camera that shows trees takes layer 1; the sun's shadow pass, the corner map and a pond's
 * reflection take layer 2. Seen from where you stand or fly, each is only what it needs: the trees
 * in sight for the picture, those under the shadow picture for the shadows. */
export const TREES_SEEN = 1, TREES_SHADOW = 2;
/** How far the camera turns before the trees it sees are worked out again (6 degrees). */
const TURN_COS = Math.cos((6 * Math.PI) / 180);
export const midOf = (nearFt: number) => nearFt * 3;
/** Past this far (ft), a tree the ground hides from the eye is left out of the picture. */
const HILL_FT = 400;
/** Whether a rise in the ground stands between the eye and the top of tree `s`, `d` ft off: the
 * line from the eye to a little above its top runs under the ground somewhere along the way (well
 * under: a tree just showing over a ridge, or showing a few steps on, is kept). */
const behindHill = (eye: THREE.Vector3, s: TreeSpot, d: number, ground: (x: number, z: number) => number) => {
  const topY = s.ground + s.height * 1.1 + 8;
  const steps = Math.min(16, Math.max(6, Math.round(d / 60)));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = eye.x + (s.x - eye.x) * t, z = eye.z + (s.y - eye.z) * t;
    const lineY = eye.y + (topY - eye.y) * t;
    // (6 ft of slack, and more farther along: the camera moves on a way before the trees are
    // sorted again)
    if (ground(x, z) > lineY + 6 + d * t * 0.03) return true;
  }
  return false;
};

/**
 * Many trees, drawn instanced by shape: close ones in full detail, the rest in a lighter
 * version. Call `update` with the camera's position when it moves.
 */
export class Forest {
  readonly group = new THREE.Group();
  private sets: { spots: TreeSpot[]; near: THREE.InstancedMesh[]; mid: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; tints: THREE.Color[]; shadow: THREE.InstancedMesh[][] }[] = [];
  /** Where the shadow picture was when the trees were last sorted (its matrix's position). */
  private lastSun = new THREE.Vector3(Infinity, 0, 0);
  private lastCull = false;
  private last = new THREE.Vector3(Infinity, 0, 0);
  private lastDir = new THREE.Vector3();
  private lastFov = 0;
  private version = -1;
  private matrices: THREE.Matrix4[][] = [];
  /** Which of each set's trees are drawn just now (in reach and in sight), for picking. */
  private drawnNow: Uint8Array[] = [];
  /** Where each level's meshes melt in and out (see ezShapes' LOD_BAND): each mesh's own, a pair
   * for every tree it can hold (one pair for them all would need a divisor graphics cards step
   * through on the processor), and the pair they hold now. */
  private lod: { at: THREE.InstancedBufferAttribute; level: number }[] = [];
  private lodNow = [[-1, -1], [-1, -1], [-1, -1]];
  private own: THREE.BufferGeometry[] = [];

  /** `maxFt`: not drawn past this far from the eye; `ladder`: its versions close, middle and far
   * off, and where the first gives way (underbrush: lighter ones, the middle only close by). */
  constructor(spots: TreeSpot[], private maxFt = Infinity, private ladder: { levels: [Detail, Detail, Detail]; nearFt?: number; midFt?: number } = { levels: ["near", "mid", "far"] }) {
    this.group.name = "forest";
    const byShape = new Map<string, TreeSpot[]>();
    for (const s of spots) {
      const key = `${s.shape}|${s.variant}`;
      if (!byShape.has(key)) byShape.set(key, []);
      byShape.get(key)!.push(s);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [key, list] of byShape) {
      const [shape, variant] = key.split("|");
      const [l0, l1, l2] = this.ladder.levels;
      const near = treeProto(shape as TreeShape, +variant, l0), mid = treeProto(shape as TreeShape, +variant, l1), far = treeProto(shape as TreeShape, +variant, l2);
      // (the shape shared, with this level's own word on where it melts in and out)
      const withLod = (g: THREE.BufferGeometry, l: number) => {
        const geo = new THREE.BufferGeometry();
        geo.index = g.index;
        for (const [name, a] of Object.entries(g.attributes)) geo.setAttribute(name, a);
        const at = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 2), 2);
        this.lod.push({ at, level: l });
        geo.setAttribute("aLod", at);
        geo.boundingSphere = g.boundingSphere;
        geo.boundingBox = g.boundingBox;
        this.own.push(geo);
        return geo;
      };
      const make = (proto: TreeProto, l: number) => {
        const leafMat = proto.leafMat ?? leafMaterial(proto.needles);
        return [new THREE.InstancedMesh(withLod(proto.bark, l), proto.barkMat ?? barkMaterial(), list.length), new THREE.InstancedMesh(withLod(proto.leaves, l), leafMat, list.length)];
      };
      const nearMeshes = make(near, 0), midMeshes = make(mid, 1), farMeshes = make(far, 2);
      const mats: THREE.Matrix4[] = [];
      // (photographed leaves take each tree's tint gently)
      const tintOf = (s: TreeSpot) => s.leaf ?? leafTint(near, s.tint);
      list.forEach((s, i) => {
        if (s.matrix) mats.push(s.matrix.clone());
        else {
          const sx = woodsSpread(s.width / s.height / naturalOf(s.shape, near));
          e.set(s.lean * Math.cos(s.turn), s.turn, s.lean * Math.sin(s.turn));
          m.compose(p.set(s.x, s.ground, s.y), q.setFromEuler(e), sc.set(s.height * sx, s.height, s.height * sx));
          mats.push(m.clone());
        }
        for (const mesh of [...nearMeshes, ...midMeshes, ...farMeshes]) mesh.setColorAt(i, tintOf(s));
      });
      for (const mesh of [...nearMeshes, ...midMeshes, ...farMeshes]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.layers.set(TREES_SEEN);
        mesh.layers.enable(TREES_SHADOW);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.group.add(mesh);
      }
      // (the same trees again, only for the sun's shadows while the camera's own are only those in
      // sight: no colors, never in the picture)
      const shadowOf = (proto: TreeProto, pair: THREE.InstancedMesh[]) => pair.map((seen, k) => {
        const mesh = new THREE.InstancedMesh(k === 0 ? proto.bark : proto.leaves, seen.material, list.length);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.layers.set(TREES_SHADOW);
        mesh.visible = false;
        mesh.count = 0;
        this.group.add(mesh);
        return mesh;
      });
      const shadow = [shadowOf(near, nearMeshes), shadowOf(mid, midMeshes), shadowOf(far, farMeshes)];
      // Bark stays its own color (only the leaves take the tint)
      for (const mesh of [nearMeshes[0], midMeshes[0], farMeshes[0]]) {
        for (let i = 0; i < list.length; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      }
      // (each tree's leaf color worked out once, not at every move of the camera)
      this.sets.push({ spots: list, near: nearMeshes, mid: midMeshes, far: farMeshes, tints: list.map(tintOf), shadow });
      this.matrices.push(mats);
    }
    this.update(new THREE.Vector3(Infinity, 0, Infinity));
  }

  /**
   * Close trees in full detail, the rest lighter. With the camera (standing or flying), only the
   * trees in and round what it sees are in the picture, and the sun's shadows have their own set:
   * only the trees under its shadow picture (`sun`, the shadow camera), so the shadows of trees
   * just out of sight still fall into view. Redone when the camera moved a fair way or turned a
   * little, or the shadow picture moved on. Without the camera (the map), every tree, for both.
   */
  update(eye: THREE.Vector3, cam?: THREE.PerspectiveCamera, sun?: THREE.OrthographicCamera, ground?: (x: number, z: number) => number) {
    // (and again when the reach of full detail changed)
    const dir = cam ? cam.getWorldDirection(seeDir) : null;
    const turned = !!dir && (this.lastDir.dot(dir) < TURN_COS || Math.abs(cam!.fov - this.lastFov) > 1);
    const cull = !!cam && !forestDetail.all;
    let sunMoved = false;
    if (cull && sun) {
      seeDir.setFromMatrixPosition(sun.matrixWorld);
      sunMoved = this.lastSun.distanceToSquared(seeDir) > 1;
    }
    if (!turned && !sunMoved && cull === this.lastCull && this.last.distanceToSquared(eye) < 30 * 30 && Number.isFinite(this.last.x) && this.version === forestDetail.version) return;
    this.version = forestDetail.version;
    this.lastCull = cull;
    // (the trees' meshes never move, each tree's place is in its instance: their matrices worked out
    // here, not again every frame for the thousands of them)
    this.group.updateWorldMatrix(true, false);
    this.group.traverse(o => {
      if (o === this.group) return;
      o.matrixAutoUpdate = false;
      o.matrixWorld.multiplyMatrices(this.group.matrixWorld, o.matrix);
      o.matrixWorldAutoUpdate = false;
    });
    this.last.copy(eye);
    if (dir) { this.lastDir.copy(cam!.getWorldDirection(seeDir)); this.lastFov = cam!.fov; }
    if (sun) this.lastSun.setFromMatrixPosition(sun.matrixWorld);
    // (what the camera sees, the trees round its edges kept, enough for turning a little before
    // the next time round; and what the shadow picture covers)
    let see: THREE.Frustum | null = null, shade: THREE.Frustum | null = null;
    if (cull) {
      cam!.updateMatrixWorld();
      seeMatrix.multiplyMatrices(cam!.projectionMatrix, cam!.matrixWorldInverse);
      see = seeFrustum.setFromProjectionMatrix(seeMatrix);
      if (sun) shade = sunFrustum.setFromProjectionMatrix(sunMatrix.multiplyMatrices(sun.projectionMatrix, sun.matrixWorldInverse));
    }
    const nearFt = this.ladder.nearFt ?? forestDetail.nearFt, midFt = this.ladder.midFt ?? midOf(forestDetail.nearFt);
    const r2 = nearFt * nearFt, m2 = midFt * midFt, all = forestDetail.all;
    const zoom2 = treeLodZoom.value * treeLodZoom.value;
    // (one version melts into the next over a band past where it changes; a tree in a band is in
    // both, and a little more each side, for the way the eye goes before the trees are sorted again)
    const reach = Number.isFinite(this.maxFt) ? this.maxFt / (1 + LOD_BAND) : 0;
    const melt = forestDetail.melt && !all;
    const bands = !melt ? [[0, 0], [0, 0], [0, 0]] : [[0, nearFt], [nearFt, midFt], [midFt, reach]];
    if (bands.some(([a, b], l) => this.lodNow[l][0] !== a || this.lodNow[l][1] !== b)) {
      this.lodNow = bands;
      for (const { at, level } of this.lod) {
        const [a, b] = bands[level], arr = at.array as Float32Array;
        for (let i = 0; i < arr.length; i += 2) { arr[i] = a; arr[i + 1] = b; }
        at.needsUpdate = true;
      }
    }
    const SLACK = 40;
    const out1 = (nearFt * (1 + LOD_BAND) + SLACK) ** 2, in1 = Math.max(0, nearFt - SLACK) ** 2, out2 = (midFt * (1 + LOD_BAND) + SLACK) ** 2, in2 = Math.max(0, midFt - SLACK) ** 2;
    this.sets.forEach((set, si) => {
      const n = [0, 0, 0], ns = [0, 0, 0];
      const levels = [set.near, set.mid, set.far];
      const drawn = (this.drawnNow[si] = new Uint8Array(set.spots.length));
      set.spots.forEach((s, i) => {
        const dx = s.x - eye.x, dz = s.y - eye.z, dy = s.ground + s.height * 0.5 - eye.y;
        // (as far as it looks: zoomed in, a tree changes and ends that much farther off)
        const d2 = (dx * dx + dz * dz + dy * dy) / zoom2;
        if (!all && d2 > this.maxFt * this.maxFt) return;
        const l = all || d2 < r2 ? 0 : d2 < m2 ? 1 : 2;
        const mat = this.matrices[si][i];
        if (shade) {
          seeBall.center.set(s.x, s.ground + s.height * 0.5, s.y);
          seeBall.radius = s.height * 0.75;
          if (shade.intersectsSphere(seeBall)) {
            set.shadow[l][0].setMatrixAt(ns[l], mat);
            set.shadow[l][1].setMatrixAt(ns[l], mat);
            ns[l]++;
          }
        }
        if (see) {
          seeBall.center.set(s.x, s.ground + s.height * 0.5, s.y);
          const far = Math.sqrt(d2 * zoom2);
          seeBall.radius = s.height + 30 + far * 0.12;
          if (!see.intersectsSphere(seeBall)) return;
          // (far off, behind a rise: the ground stands between the eye and the tree's top)
          if (ground && far > HILL_FT && behindHill(eye, s, far, ground)) return;
        }
        drawn[i] = 1;
        for (let k = 0; k < 3; k++) {
          // (its own version, and the one it is melting into or out of)
          if (k !== l && (!melt || !(k === 0 ? d2 < out1 : k === 1 ? d2 > in1 && d2 < out2 : d2 > in2))) continue;
          levels[k][0].setMatrixAt(n[k], mat);
          levels[k][1].setMatrixAt(n[k], mat);
          levels[k][1].setColorAt(n[k], set.tints[i]);
          n[k]++;
        }
      });
      // (only the part in use sent to the graphics card: the bark's colors never change)
      const send = (mesh: THREE.InstancedMesh, count: number, colors: boolean) => {
        mesh.count = count;
        mesh.visible = count > 0;
        if (!count) return;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (colors && mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, count * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      };
      levels.forEach((meshes, l) => {
        meshes.forEach((mesh, k) => {
          // (culled: in the picture only, its shadows the shadow set's; otherwise both)
          mesh.castShadow = !shade;
          if (shade) mesh.layers.disable(TREES_SHADOW);
          else mesh.layers.enable(TREES_SHADOW);
          send(mesh, n[l], k === 1);
        });
        set.shadow[l].forEach(mesh => send(mesh, shade ? ns[l] : 0, false));
      });
    });
  }

  /** Each tree drawn just now (not past its reach or out of sight), for picking: only what you see
   * can be picked. */
  eachDrawn(f: (s: TreeSpot) => void) {
    this.sets.forEach((set, si) => { const on = this.drawnNow[si]; set.spots.forEach((s, i) => { if (on?.[i]) f(s); }); });
  }

  /** Its own buffers let go (the shapes and materials are shared, kept). */
  dispose() {
    this.group.traverse(o => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
    // (its own word on the shared shapes: only that let go, the shapes are kept)
    for (const g of this.own) { for (const name of Object.keys(g.attributes)) if (name !== "aLod") g.deleteAttribute(name); g.index = null; g.dispose(); }
    this.own = [];
  }

  /** Trees standing within `r` of a plan point (for tests). */
  treesNear(x: number, y: number, r: number) {
    return this.sets.reduce((a, s) => a + s.spots.filter(t => Math.hypot(t.x - x, t.y - y) < r).length, 0);
  }

  /** Trees in all, and in full detail just now (for tests). */
  counts() {
    return {
      trees: this.sets.reduce((a, s) => a + s.spots.length, 0),
      near: this.sets.reduce((a, s) => a + s.near[1].count, 0),
      conifers: this.sets.reduce((a, s) => a + s.spots.filter(x => x.shape === "conifer").length, 0),
      /** In the picture just now, and in the shadows' own set (standing or flying). */
      seen: this.sets.reduce((a, s) => a + s.near[1].count + s.mid[1].count + s.far[1].count, 0),
      shadow: this.sets.reduce((a, s) => a + s.shadow.reduce((b, l) => b + l[1].count, 0), 0)
    };
  }
}
