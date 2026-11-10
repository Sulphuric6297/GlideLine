// Tufts of grass and wildflowers like ez-tree's demo (its grass and flower models, MIT): clumps
// of photographed grass in the lawn and the rough, thicker and taller where the grass grows long,
// none on fairways, greens, tees or paths, and flowers scattered in the long grass. They travel
// with the camera in whole tiles (as the blades do) and read where they stand from the same maps
// as the blades: the ground's height, how long the grass grows there, its color.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GRASS_VERT_HEAD, GRASS, SpotBlocks, type GrassUniformSource } from "./grass";

/** Size of the repeating pattern of tuft spots, ft. */
const TILE = 12;

const VERT_BODY = /* glsl */ `
  vec2 wp = uOrigin + aSpot;
  vec2 j = vec2( gHash( wp * 0.613 + 2.1 ), gHash( wp * 1.317 + 5.3 ) );
  wp += ( j - 0.5 ) * ${(TILE / 3).toFixed(1)};
  float r1 = gHash( wp * 1.13 + 0.7 ), r2 = gHash( wp * 2.37 + 4.1 ), r3 = gHash( wp * 0.91 + 8.3 );
  vec2 fuv = ( wp - uRect.xy ) / uRect.zw;
  float inside = step( 0.0, fuv.x ) * step( fuv.x, 1.0 ) * step( 0.0, fuv.y ) * step( fuv.y, 1.0 );
  vec4 fld = texture2D( uField, fuv );
  float d = distance( wp, uEye.xz );
  float tall = fld.r * ${GRASS.max.toFixed(1)};
  // (lawn and rough only, none where it's mown: a scattering in the lawn, thick in the rough;
  // patchy, in drifts, as the demo's)
  float wild = smoothstep( uMinTall, uMinTall + 0.6, tall );
  float lawn = step( uMinTall, tall );
  float drift = gNoise( wp * 0.035 + 3.0 );
  float keep = fld.g * ( 0.3 * lawn + 0.7 * wild ) * uDensity * smoothstep( 0.25, 0.75, drift + 0.25 * wild ) * ( 1.0 - smoothstep( uFar * 0.7, uFar, d ) );
  float alive = inside * step( r2, keep );
  // (toward their reach they sink into the ground, never there one frame and gone the next)
  float s = uSize * ( 0.65 + 0.7 * r1 ) * mix( 0.8, 1.6, smoothstep( 0.6, 2.5, tall ) ) * ( 1.0 - smoothstep( uFar * 0.5, uFar * 0.95, d ) ) * alive;
  float yaw = r3 * 6.2832;
  float c = cos( yaw ), sn = sin( yaw );
  vec3 p = position * s;
  p.xz = vec2( c * p.x - sn * p.z, sn * p.x + c * p.z );
  // The wind leans the tops over, in waves
  float up = clamp( position.y / uTop, 0.0, 1.0 );
  vec2 gust = vec2( 0.8, 0.6 ) * uWind * 2.2 * ( 0.55 + 0.45 * sin( uTime * 1.7 + dot( wp, vec2( 0.13, 0.09 ) ) + r1 * 1.5 ) );
  p.xz += gust * up * up * s;
  float base = gHeight( wp );
  vec3 grassPos = vec3( wp.x + p.x, base + p.y, wp.y + p.z );
  vec3 objectNormal = normalize( mix( vec3( c * normal.x - sn * normal.z, normal.y, sn * normal.x + c * normal.z ), vec3( 0.0, 1.0, 0.0 ), 0.55 ) );
  vec3 tint = texture2D( uTint, fuv ).rgb;
  // (the clump's photo is black and white, mid grey: it takes the ground's grass color, as
  // bright as the blades; the flowers keep their own colors)
  vGrass = mix( vec3( 1.15 ), tint * 3.3, uTintMix ) * ( 0.85 + 0.3 * r1 );
  vTip = up;
`;

type Part = { geo: THREE.BufferGeometry; map: THREE.Texture | null; color: THREE.Color; top: number };
let models: Promise<{ grass: Part[]; flowers: Part[][] }> | null = null;
/** The demo's grass clump and its three flowers, loaded once (unit height). */
const loadModels = () =>
  (models ??= (async () => {
    const loader = new GLTFLoader();
    const parts = async (url: string): Promise<Part[]> => {
      const scene = (await loader.loadAsync(url)).scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const h = Math.max(1e-3, box.max.y - box.min.y);
      const out: Part[] = [];
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
        geo.translate(0, -box.min.y, 0);
        geo.scale(1 / h, 1 / h, 1 / h);
        const mat = m.material as THREE.MeshStandardMaterial;
        out.push({ geo, map: mat.map ?? null, color: mat.color?.clone() ?? new THREE.Color(1, 1, 1), top: 1 });
      });
      return out;
    };
    const base = `${import.meta.env.BASE_URL}ez/`;
    const [grass, white, blue, yellow] = await Promise.all(["grass.glb", "flower_white.glb", "flower_blue.glb", "flower_yellow.glb"].map(f => parts(base + f)));
    return { grass, flowers: [white, blue, yellow] };
  })());

/** Spots for a square patch `half` ft each way: the same jittered pattern in every tile. */
const spots = (half: number, perTile: number, seed0: number) => {
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tile: number[] = [];
  for (let i = 0; i < perTile; i++) tile.push(rnd() * TILE, rnd() * TILE);
  const tiles = Math.ceil((half * 2) / TILE);
  const out = new Float32Array(tiles * tiles * perTile * 2);
  let k = 0;
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) for (let i = 0; i < perTile; i++) { out[k++] = tx * TILE + tile[i * 2]; out[k++] = ty * TILE + tile[i * 2 + 1]; }
  return { out, span: tiles * TILE, count: tiles * tiles * perTile };
};

type Layer = { blocks: SpotBlocks; mat: THREE.Material; span: number; uniforms: Record<string, THREE.IUniform>; far: number };

/** The tufts and flowers around the camera. */
export class Tufts {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private ready = false;
  private built = 0;

  constructor(private src: GrassUniformSource) {
    this.group.name = "tufts";
  }

  /** Builds them for a grass quality (0: none), once the models are in. */
  setQuality(q: number) {
    if (q === this.built) return;
    this.built = q;
    void loadModels().then(m => { this.ready = true; this.build(m, q); }).catch(err => console.warn("Grass tufts unavailable:", err));
  }

  private build(m: { grass: Part[]; flowers: Part[][] }, q: number) {
    if (q !== this.built) return;
    for (const l of this.layers) { l.blocks.dispose(); l.mat.dispose(); }
    this.layers = [];
    this.src.releaseUniforms(this);
    if (!q) return;
    const reach = q >= 3 ? 130 : q === 2 ? 100 : 70;
    const add = (part: Part, half: number, perTile: number, seed: number, opts: { size: number; minTall: number; density: number; tintMix: number; far: number }) => {
      const { out, span } = spots(half, perTile, seed);
      const geo = new THREE.BufferGeometry();
      geo.index = part.geo.index;
      for (const name of ["position", "normal", "uv"]) { const a = part.geo.getAttribute(name); if (a) geo.setAttribute(name, a); }
      const uniforms: Record<string, THREE.IUniform> = {
        ...this.src.uniformsFor(opts.far, this),
        uSize: { value: opts.size },
        uMinTall: { value: opts.minTall },
        uTop: { value: part.top },
        uTintMix: { value: opts.tintMix }
      };
      uniforms.uDensity = { value: opts.density };
      const mat = new THREE.MeshLambertMaterial({ map: part.map, color: part.color, side: THREE.DoubleSide, alphaTest: 0.5 });
      mat.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${GRASS_VERT_HEAD}\nuniform float uSize;\nuniform float uMinTall;\nuniform float uTop;\nuniform float uTintMix;`)
          .replace("#include <beginnormal_vertex>", VERT_BODY)
          .replace("#include <begin_vertex>", "vec3 transformed = grassPos;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vGrass;\nvarying float vTip;")
          .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vGrass * mix( 0.7, 1.08, vTip );")
          .replace("#include <normal_fragment_begin>", "float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;");
      };
      mat.customProgramCacheKey = () => `dg-tufts-${opts.tintMix}`;
      // (in blocks, as the grass: only those in sight and in reach drawn)
      const blocks = new SpotBlocks(this.group, geo, out, span, 32, g => {
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true;
        mesh.name = "tufts";
        mesh.raycast = () => {};
        return mesh;
      });
      this.layers.push({ blocks, mat, span, uniforms, far: opts.far });
    };
    // Grass clumps in the lawn and rough, a foot or two high, a good many (six triangles each)
    for (const part of m.grass) add(part, reach, q >= 3 ? 40 : q === 2 ? 26 : 14, 7151, { size: 1.6, minTall: 0.35, density: 1, tintMix: 1, far: reach });
    // Wildflowers in the long grass only, here and there, close by (each is a few hundred triangles)
    if (q >= 2) m.flowers.forEach((f, i) => { for (const part of f) add(part, 45, 1, 911 + i * 101, { size: 1.3, minTall: 1.2, density: 0.6, tintMix: 0, far: 45 }); });
  }

  update(eye: THREE.Vector3, time: number, wind: number, visible: boolean, height: (x: number, z: number) => number = () => 0) {
    this.group.visible = visible && this.ready;
    if (!this.group.visible) return;
    for (const l of this.layers) {
      const half = l.span / 2;
      const ox = Math.floor((eye.x - half) / TILE) * TILE, oz = Math.floor((eye.z - half) / TILE) * TILE;
      (l.uniforms.uOrigin.value as THREE.Vector2).set(ox, oz);
      l.blocks.update(ox, oz, eye, l.far, 0, height, 4);
      (l.uniforms.uEye.value as THREE.Vector3).copy(eye);
      l.uniforms.uTime.value = time;
      l.uniforms.uWind.value = wind;
    }
  }

  dispose() {
    for (const l of this.layers) { l.blocks.dispose(); l.mat.dispose(); }
    this.layers = [];
    this.src.releaseUniforms(this);
  }
}
