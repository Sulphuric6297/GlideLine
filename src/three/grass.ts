// Grass in 3D: real blades, short on fairways and greens, longer between the holes, knee-high in
// the rough. Two patches of blades travel with the camera (a dense one close by, a thinner one of
// wider blades out to the middle distance), moved in whole tiles so the blades never swim. Each
// blade reads where it stands from textures: the ground's height, what grows there (the grass
// map: height and density) and its color (the course's colors, or the aerial photo's), so moving
// a patch costs nothing. Past the patches the ground alone carries on, in the same colors.
import * as THREE from "three";

/** What grows where, painted from the course (see grassMaps). Heights in feet. */
export const GRASS = {
  /** Mown fairways and greens. */
  fairway: 0.22,
  /** The rest of the ground, between holes. */
  lawn: 0.4,
  /** Rough / tall grass areas. */
  rough: 2.2,
  /** The tallest a blade can be (the map's red channel spans 0 to this). */
  max: 4
};

export type GrassQuality = 0 | 1 | 2 | 3;

/** Blades per square foot (inner patch, outer patch) and the patches' half-widths, per quality. */
const LEVELS: Record<Exclude<GrassQuality, 0>, { inner: number; outer: number; innerR: number; outerR: number }> = {
  1: { inner: 6, outer: 0.6, innerR: 28, outerR: 90 },
  2: { inner: 13, outer: 1.2, innerR: 36, outerR: 170 },
  3: { inner: 24, outer: 2, innerR: 44, outerR: 210 }
};
/** Size of the repeating pattern of blade spots, ft (the patches move by this much). */
const TILE = 8;

export type GrassMaps = {
  /** Red: blade height (0..GRASS.max ft), green: how many blades (0..1). */
  field: HTMLCanvasElement;
  /** The blades' color where they stand. */
  color: HTMLCanvasElement;
  /** Plan rectangle the two maps cover. */
  rect: { x: number; y: number; width: number; height: number };
};

/** The terrain as the ground mesh has it: heights at its vertices, cell by cell. */
export type GrassTerrain = { heights: Float32Array; cols: number; rows: number; x: number; y: number; width: number; height: number };

const VERT_HEAD = /* glsl */ `
attribute vec2 aSpot;
attribute float aK;
uniform vec2 uOrigin;
uniform sampler2D uField;
uniform sampler2D uTint;
uniform vec4 uRect;
uniform sampler2D uHeights;
uniform vec4 uTerrain;
uniform vec2 uCells;
uniform sampler2D uPhoto;
uniform vec4 uPhotoRect;
uniform float uPhotoMix;
uniform vec3 uEye;
uniform float uNear;
uniform float uFar;
uniform float uHole;
uniform float uWidth;
uniform float uDensity;
uniform float uTime;
uniform float uWind;
varying vec3 vGrass;
varying float vTip;
float gHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float gHeight( vec2 p ) {
  vec2 c = clamp( ( p - uTerrain.xy ) / uTerrain.zw, 0.0, 1.0 ) * uCells;
  vec2 i = min( floor( c ), uCells - 1.0 );
  vec2 t = c - i;
  ivec2 k = ivec2( i );
  float h00 = texelFetch( uHeights, k, 0 ).r;
  float h10 = texelFetch( uHeights, k + ivec2( 1, 0 ), 0 ).r;
  float h01 = texelFetch( uHeights, k + ivec2( 0, 1 ), 0 ).r;
  float h11 = texelFetch( uHeights, k + ivec2( 1, 1 ), 0 ).r;
  // The ground mesh's own triangles (split from bottom-left to top-right of each cell)
  if ( t.x + t.y <= 1.0 ) return h00 + ( h10 - h00 ) * t.x + ( h01 - h00 ) * t.y;
  return h11 + ( h01 - h11 ) * ( 1.0 - t.x ) + ( h10 - h11 ) * ( 1.0 - t.y );
}
// Smooth noise (0..1): stretches of drier and lusher grass, tufts within them
float gNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

/** The blades' shader head (their maps, the ground's height, noise), for the tufts to share. */
export const GRASS_VERT_HEAD = VERT_HEAD;

/** Where the tufts get the same maps as the blades (kept up to date with them). */
export type GrassUniformSource = {
  uniformsFor(far: number, owner: object): Record<string, THREE.IUniform>;
  releaseUniforms(owner: object): void;
};

const VERT_BODY = /* glsl */ `
  vec2 wp = uOrigin + aSpot;
  vec2 j = vec2( gHash( wp * 0.917 + 1.3 ), gHash( wp * 1.731 + 7.1 ) );
  wp += ( j - 0.5 ) * 0.7;
  float r1 = gHash( wp * 1.37 + 0.5 ), r2 = gHash( wp * 2.71 + 3.1 ), r3 = gHash( wp * 0.73 + 7.7 ), r4 = gHash( wp * 3.3 + 1.9 );
  vec2 fuv = ( wp - uRect.xy ) / uRect.zw;
  float inside = step( 0.0, fuv.x ) * step( fuv.x, 1.0 ) * step( 0.0, fuv.y ) * step( fuv.y, 1.0 );
  vec4 fld = texture2D( uField, fuv );
  float d = distance( wp, uEye.xz );
  // Fewer blades farther away (and none inside the inner patch, for the outer one)
  float keep = fld.g * uDensity * ( 1.0 - smoothstep( uFar * 0.72, uFar, d ) ) * step( uHole, d + r4 * 6.0 );
  float alive = inside * step( r2, keep );
  // How tall it grows here, read a little off to one side so long grass meets short grass along a
  // ragged edge, not a ruled line (where blades grow at all stays exact: none on pads or paths)
  vec2 wob = vec2( gNoise( wp * 0.23 ), gNoise( wp * 0.23 + 31.0 ) ) - 0.5;
  float tall = max( fld.r, texture2D( uField, fuv + wob * 4.0 / uRect.zw ).r * step( 0.05, fld.g ) ) * ${GRASS.max.toFixed(1)};
  float stretch = gNoise( wp * 0.03 );
  float tuft = gNoise( wp * 0.45 + 11.0 );
  // (0: mown, 1: long grass)
  float wild = smoothstep( 0.3, 1.2, tall );
  // (a spot grows a few blades, as grass does: each its own way round, the outer ones shorter)
  float rk = gHash( wp * 1.9 + aK * 3.7 );
  float ka = aK * 2.4 + r1 * 6.2832;
  vec2 off = vec2( cos( ka ), sin( ka ) ) * 0.17 * min( 1.0, aK ) * ( 0.5 + 0.9 * rk );
  float bh = tall * ( 0.6 + 0.8 * r1 ) * mix( 1.0, 0.4 + 1.2 * tuft, wild * 0.85 ) * ( 0.85 + 0.3 * stretch ) * ( 1.0 - 0.16 * aK * ( 0.4 + rk ) ) * alive;
  // (thin as a blade is; a little wider far off, where a true width would be less than a pixel and flicker)
  float bw = uWidth * ( 0.75 + 0.5 * r3 ) * ( 1.0 + d / uNear ) * min( 1.0, 0.55 + tall * 0.45 ) * mix( 1.0, 0.8, wild ) * alive;
  float yaw = r3 * 6.2832 + aK * 2.1 + rk * 1.5;
  vec2 dir = vec2( cos( yaw ), sin( yaw ) );
  // Long grass bends over more; the wind leans it all one way, in waves
  float lean = ( 0.12 + 0.35 * r1 ) * ( 0.5 + min( 1.0, tall / 1.5 ) );
  vec2 gust = vec2( 0.8, 0.6 ) * uWind * ( 0.55 + 0.45 * sin( uTime * 1.7 + dot( wp, vec2( 0.13, 0.09 ) ) + r1 * 1.5 ) );
  float t = position.y;
  vec2 bend = ( dir * lean + gust ) * t * t;
  vec2 side = vec2( -dir.y, dir.x );
  float base = gHeight( wp );
  vec3 grassPos = vec3( wp.x + off.x + side.x * position.x * bw + bend.x * bh, base + bh * t * ( 1.0 - 0.25 * dot( bend, bend ) ) + 0.04, wp.y + off.y + side.y * position.x * bw + bend.y * bh );
  // Rounded across the blade (lit a little differently edge to edge), mostly facing up
  vec3 bladeN = normalize( vec3( dir.x + side.x * position.x * 1.2, 0.0, dir.y + side.y * position.x * 1.2 ) );
  // (more up than out: a lawn is lit as one, not blade by blade light and dark)
  vec3 objectNormal = normalize( mix( bladeN, vec3( 0.0, 1.0, 0.0 ), 0.8 ) );
  // Color: the ground's grass color (or the photo's), drier or lusher in stretches
  vec3 tint = texture2D( uTint, fuv ).rgb;
  vec2 puv = ( wp - uPhotoRect.xy ) / uPhotoRect.zw;
  if ( uPhotoMix > 0.0 && puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0 ) {
    vec3 ph = texture2D( uPhoto, vec2( puv.x, 1.0 - puv.y ) ).rgb;
    tint = mix( tint, ph * 1.15, uPhotoMix );
  }
  tint = mix( tint * vec3( 0.86, 1.0, 0.94 ), tint * vec3( 1.12, 1.06, 0.74 ), smoothstep( 0.25, 0.85, stretch ) );
  vec3 straw = vec3( 0.66, 0.6, 0.36 );
  vGrass = tint * ( 0.93 + 0.14 * r4 );
  vGrass = max( vec3( 0.0 ), mix( vec3( dot( vGrass, vec3( 0.2126, 0.7152, 0.0722 ) ) ), vGrass, 1.25 ) ) * 0.94;
  // (long grass: some blades gone to straw)
  vGrass = mix( vGrass, straw * ( 0.75 + 0.25 * r1 ), wild * smoothstep( 0.55, 1.0, r3 ) * 0.55 );
  vTip = t;
`;

/** How many blades grow from a spot. */
const BLADES = 3;
/** A spot's blades: each a tapered strip, base to tip (x across -0.5..0.5, y up 0..1), and which
 * of the spot's blades each corner belongs to (`k`: the shader sets each its own way). */
const bladeGeometry = () => {
  const pos: number[] = [], k: number[] = [];
  const index: number[] = [];
  const seg = 3;
  for (let b = 0; b < BLADES; b++) {
    const at = pos.length / 3;
    for (let i = 0; i < seg; i++) {
      // (full width low down, narrowing faster toward a point)
      const t = i / seg, w = 1 - Math.pow(t, 1.4) * 0.9;
      pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0);
      k.push(b, b);
    }
    pos.push(0, 1, 0);
    k.push(b);
    for (let i = 0; i < seg - 1; i++) {
      const a = at + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    index.push(at + (seg - 1) * 2, at + (seg - 1) * 2 + 1, at + seg * 2);
  }
  return { pos, k, index };
};

/** Blade spots for a square patch `half` ft each way: the same jittered pattern in every tile. */
const patchGeometry = (half: number, perSqFt: number): { geo: THREE.InstancedBufferGeometry; spots: Float32Array; span: number; count: number } => {
  const n = Math.max(1, Math.round(TILE * TILE * perSqFt));
  let seed = 9173;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // A jittered grid inside one tile (even cover, no clumps or holes)
  const side = Math.ceil(Math.sqrt(n));
  const tile: number[] = [];
  for (let i = 0; i < n; i++) {
    const gx = i % side, gy = Math.floor(i / side);
    tile.push(((gx + rnd()) / side) * TILE, ((gy + rnd()) / side) * TILE);
  }
  const tiles = Math.ceil((half * 2) / TILE);
  const spots = new Float32Array(tiles * tiles * n * 2);
  let k = 0;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      for (let i = 0; i < n; i++) {
        spots[k++] = tx * TILE + tile[i * 2];
        spots[k++] = ty * TILE + tile[i * 2 + 1];
      }
    }
  }
  const blade = bladeGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(blade.pos, 3));
  geo.setAttribute("aK", new THREE.Float32BufferAttribute(blade.k, 1));
  geo.setIndex(blade.index);
  geo.setAttribute("aSpot", new THREE.InstancedBufferAttribute(spots, 2));
  geo.instanceCount = tiles * tiles * n;
  return { geo, spots, span: tiles * TILE, count: tiles * tiles * n };
};

/**
 * A patch's spots in square blocks, each its own draw with its own bounds, so what's out of sight
 * (behind the camera, off to the sides), past the patch's reach or inside the patch within it is
 * never drawn: the patch follows the camera as a whole (its origin), the blocks with it.
 */
export class SpotBlocks {
  private blocks: { mesh: THREE.Mesh; cx: number; cz: number; count: number }[] = [];
  private at = new THREE.Vector2(NaN, NaN);
  /** Spots drawn in the last frame (in reach: the camera's own view culls more). */
  count = 0;
  constructor(group: THREE.Group, base: THREE.BufferGeometry, spots: Float32Array, span: number, private blockFt: number, make: (geo: THREE.InstancedBufferGeometry) => THREE.Mesh) {
    const per = Math.max(1, Math.ceil(span / blockFt));
    const lists: number[][] = Array.from({ length: per * per }, () => []);
    for (let i = 0; i < spots.length; i += 2) {
      const bx = Math.min(per - 1, Math.floor(spots[i] / blockFt)), bz = Math.min(per - 1, Math.floor(spots[i + 1] / blockFt));
      lists[bz * per + bx].push(spots[i], spots[i + 1]);
    }
    lists.forEach((list, b) => {
      if (!list.length) return;
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const [name, a] of Object.entries(base.attributes)) geo.setAttribute(name, a);
      geo.setAttribute("aSpot", new THREE.InstancedBufferAttribute(new Float32Array(list), 2));
      geo.instanceCount = list.length / 2;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), blockFt);
      const mesh = make(geo);
      mesh.frustumCulled = true;
      group.add(mesh);
      this.blocks.push({ mesh, cx: ((b % per) + 0.5) * blockFt, cz: (Math.floor(b / per) + 0.5) * blockFt, count: list.length / 2 });
    });
  }
  /** The patch at origin (`ox`, `oz`): each block placed over the ground (`height`, `tall` ft of
   * blades above it), drawn only where it can show between `hole` and `far` ft from the eye. */
  update(ox: number, oz: number, eye: THREE.Vector3, far: number, hole: number, height: (x: number, z: number) => number, tall: number) {
    const moved = ox !== this.at.x || oz !== this.at.y;
    this.at.set(ox, oz);
    const half = this.blockFt / 2, diag = half * Math.SQRT2;
    this.count = 0;
    for (const b of this.blocks) {
      const x = ox + b.cx, z = oz + b.cz;
      const d = Math.hypot(x - eye.x, z - eye.z);
      b.mesh.visible = d - diag < far && d + diag > hole;
      if (!b.mesh.visible) continue;
      this.count += b.count;
      if (!moved) continue;
      // (its bounds round the ground under it, corners and middle)
      const hs = [height(x, z), height(x - half, z - half), height(x + half, z - half), height(x - half, z + half), height(x + half, z + half)];
      const lo = Math.min(...hs), hi = Math.max(...hs) + tall;
      const s = b.mesh.geometry.boundingSphere!;
      s.center.set(x, (lo + hi) / 2, z);
      s.radius = Math.hypot(diag, (hi - lo) / 2) + 1;
    }
  }
  dispose() {
    for (const b of this.blocks) { b.mesh.geometry.dispose(); b.mesh.removeFromParent(); }
    this.blocks = [];
  }
}

type Patch = { blocks: SpotBlocks; mat: THREE.MeshLambertMaterial; span: number; count: number; uniforms: Record<string, THREE.IUniform>; far: number; hole: number };

export class Grass implements GrassUniformSource {
  readonly group = new THREE.Group();
  private patches: Patch[] = [];
  private quality: GrassQuality = 0;
  private field: THREE.CanvasTexture | null = null;
  private tint: THREE.CanvasTexture | null = null;
  private rect = new THREE.Vector4(0, 0, 1, 1);
  private heights: THREE.DataTexture | null = null;
  private terrain = new THREE.Vector4(0, 0, 1, 1);
  private cells = new THREE.Vector2(1, 1);
  private photo: THREE.Texture | null = null;
  private photoRect = new THREE.Vector4(0, 0, 1, 1);
  private photoMix = 0;
  /** Blades drawn in the last frame (both patches), for tests and the frame-rate guard. */
  blades = 0;
  /** Uniforms lent out (the tufts'), by who has them. */
  private lent = new Map<object, Record<string, THREE.IUniform>[]>();
  private allUniforms() {
    return [...this.patches.map(p => p.uniforms), ...[...this.lent.values()].flat()];
  }

  /** A set of the blades' uniforms (the same maps, kept up to date), thinning out toward `far`. */
  uniformsFor(far: number, owner: object) {
    const u = this.uniformSet(30, far, 0, 0);
    this.lent.set(owner, [...(this.lent.get(owner) ?? []), u]);
    return u;
  }
  releaseUniforms(owner: object) {
    this.lent.delete(owner);
  }
  private uniformSet(near: number, far: number, hole: number, width: number): Record<string, THREE.IUniform> {
    return {
      uOrigin: { value: new THREE.Vector2() },
      uField: { value: this.field },
      uTint: { value: this.tint },
      uRect: { value: this.rect },
      uHeights: { value: this.heights },
      uTerrain: { value: this.terrain },
      uCells: { value: this.cells },
      uPhoto: { value: this.photo },
      uPhotoRect: { value: this.photoRect },
      uPhotoMix: { value: this.photoMix },
      uEye: { value: new THREE.Vector3() },
      uNear: { value: near },
      uFar: { value: far },
      uHole: { value: hole },
      uWidth: { value: width },
      uDensity: { value: 1 },
      uTime: { value: 0 },
      uWind: { value: 0.12 }
    };
  }

  constructor() {
    this.group.name = "grass";
  }

  setQuality(q: GrassQuality) {
    if (q === this.quality) return;
    this.quality = q;
    this.build();
  }

  getQuality() {
    return this.quality;
  }

  /** The maps as textures (what grows where, its color) and the plan rectangle they cover: the
   * ground paints itself from the same ones (see groundDetail's growMap). */
  get maps() {
    return this.field && this.tint ? { field: this.field, tint: this.tint, rect: this.rect } : null;
  }

  setMaps(maps: GrassMaps) {
    const make = (c: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(c);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    this.field?.dispose();
    this.tint?.dispose();
    this.field = make(maps.field, false);
    this.tint = make(maps.color, true);
    this.rect.set(maps.rect.x, maps.rect.y, maps.rect.width, maps.rect.height);
    for (const u of this.allUniforms()) {
      u.uField.value = this.field;
      u.uTint.value = this.tint;
    }
  }

  setTerrain(t: GrassTerrain) {
    this.heights?.dispose();
    const tex = new THREE.DataTexture(t.heights, t.cols, t.rows, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.heights = tex;
    this.terrain.set(t.x, t.y, t.width, t.height);
    this.cells.set(t.cols - 1, t.rows - 1);
    for (const u of this.allUniforms()) u.uHeights.value = tex;
  }

  /** The aerial photo the blades take their color from (`mix` 0: the course's colors only). */
  setPhoto(photo: THREE.Texture | null, rect: { x: number; y: number; width: number; height: number }, mix: number) {
    this.photo = photo;
    this.photoRect.set(rect.x, rect.y, rect.width, rect.height);
    this.photoMix = photo ? mix : 0;
    for (const u of this.allUniforms()) {
      u.uPhoto.value = photo;
      u.uPhotoMix.value = this.photoMix;
    }
  }

  private build() {
    for (const p of this.patches) {
      p.blocks.dispose();
      p.mat.dispose();
    }
    this.patches = [];
    if (!this.quality) return;
    const lv = LEVELS[this.quality];
    const add = (half: number, perSqFt: number, width: number, near: number, far: number, hole: number) => {
      const { geo, spots, span, count } = patchGeometry(half, perSqFt);
      const uniforms = this.uniformSet(near, far, hole, width);
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      mat.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
          .replace("#include <beginnormal_vertex>", VERT_BODY)
          .replace("#include <begin_vertex>", "vec3 transformed = grassPos;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vGrass;\nvarying float vTip;")
          // (shaded toward the root, not black: the turf reads as one dense green)
          .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vGrass * mix( 0.5, 0.95, vTip );")
          // Tips catch the light
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGrass * vTip * vTip * 0.06;")
          // Lit like the ground under it from both sides (no dark backs)
          .replace("#include <normal_fragment_begin>", "float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;");
      };
      mat.customProgramCacheKey = () => "dg-grass";
      // (in blocks: close by small ones, the outer patch's bigger)
      const blocks = new SpotBlocks(this.group, geo, spots, span, hole ? 40 : 24, g => {
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.name = "grass-patch";
        mesh.raycast = () => {};
        return mesh;
      });
      this.patches.push({ blocks, mat, span, count, uniforms, far, hole });
    };
    add(lv.innerR, lv.inner, 0.034, 45, lv.innerR, 0);
    add(lv.outerR, lv.outer, 0.05, 50, lv.outerR, lv.innerR * 0.85);
  }

  /**
   * Moves the patches under the camera (in whole tiles) and shows them only when the ground is
   * close enough for blades to be seen. `time` sways them in the wind.
   */
  update(eye: THREE.Vector3, groundY: number, time: number, wind: number, height: (x: number, z: number) => number = () => groundY) {
    const above = eye.y - groundY;
    const show = this.quality > 0 && !!this.field && !!this.heights && above < 320;
    this.group.visible = show;
    this.blades = 0;
    if (!show) return;
    // The patches center a little ahead of nothing in particular: on the point under the eye
    for (const p of this.patches) {
      const half = p.span / 2;
      const ox = Math.floor((eye.x - half) / TILE) * TILE, oz = Math.floor((eye.z - half) / TILE) * TILE;
      (p.uniforms.uOrigin.value as THREE.Vector2).set(ox, oz);
      (p.uniforms.uEye.value as THREE.Vector3).copy(eye);
      p.uniforms.uTime.value = time;
      p.uniforms.uWind.value = wind;
      // Seen from higher up, fewer blades are needed
      p.uniforms.uDensity.value = above > 120 ? 0.5 : 1;
      p.blocks.update(ox, oz, eye, p.far, p.hole, height, GRASS.max);
      this.blades += p.blocks.count;
    }
  }

  dispose() {
    for (const p of this.patches) {
      p.blocks.dispose();
      p.mat.dispose();
    }
    this.patches = [];
    this.field?.dispose();
    this.tint?.dispose();
    this.heights?.dispose();
  }
}
