// Water in 3D: a surface that reflects the sky (the same sky the view shows, so a pond at sunset
// takes the sunset's colors), more mirror-like toward the horizon as real water is, rippled by two
// layers of small waves drifting in the wind, its own color showing through where you look down
// into it. Ponds lie level; creeks follow the ground downhill. A pond also mirrors its own banks and
// the trees on them (a picture of all round it, taken from its middle while the view is still: see
// CourseView's water pictures), shelves from a clear, shallow edge where its bottom shows to deep
// water in the middle, and glitters where the ripples catch the sun.
import * as THREE from "three";

let ripples: THREE.Texture | null = null;

/** Small waves as a normal map that repeats without a seam (drawn once, shared). */
const rippleTexture = () => {
  if (ripples || typeof document === "undefined") return ripples;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(S, S);
  // Heights: a few sine waves in different directions, wrapping exactly round the tile
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  let seed = 4217;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const kx = Math.round((rnd() - 0.5) * 16), ky = Math.round((rnd() - 0.5) * 16);
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 1 / Math.hypot(kx, ky), p: rnd() * Math.PI * 2 });
  }
  // (the heights worked out once for each pixel, the waves wrapping round the tile, then the
  // slopes from the neighbours: the same picture as from the waves at every neighbour, a quarter
  // of the work)
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) H[y * S + x] = waves.reduce((s, w) => s + w.a * Math.sin(((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.p), 0);
  const h = (x: number, y: number) => H[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = -(h(x + 1, y) - h(x - 1, y)) * 3, ny = -(h(x, y + 1) - h(x, y - 1)) * 3, len = Math.hypot(nx, ny, 1);
      const k = (y * S + x) * 4;
      img.data[k] = (nx / len * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[k + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.userData.shared = true;
  return (ripples = t);
};

export type WaterUniforms = { uTime: { value: number }; uWind: { value: number }; uSunDir: { value: THREE.Vector3 }; uSunColor: { value: THREE.Color } };
/** One clock, wind and sun for all water (CourseView moves them along). */
export const waterUniforms: WaterUniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.97, 0.9) } };

const materials = new Map<string, THREE.MeshStandardMaterial>();
let skyEnv: THREE.Texture | null = null;

/** The sky the water reflects (CourseView makes it from its sky whenever the sun moves). */
export const setWaterSky = (env: THREE.Texture | null) => {
  skyEnv = env;
  for (const m of materials.values()) {
    m.envMap = env;
    m.needsUpdate = true;
  }
};

/**
 * Water of a color (shared per kind of water). Round it, `shore` is what stands on the banks
 * (trees, or open grass) and `rise` how high it reaches as seen from the water (the sine of the
 * angle: about 0.3 for a pond in the woods, 0.05 in an open field): the water mirrors that band
 * dark and the sky above it. `bottom`: a pond's floor, showing in its shallows (its geometry then
 * has each point's depth, `aDepth`, in feet). `mirror`: the picture of all round it, taken from the
 * pond (banks, trees, sky): mirrored as it is, the band no longer needed; that water is its own.
 */
export const waterMaterial = (color: string, shore = "#2a3a24", rise = 0.08, opts: { bottom?: string; mirror?: THREE.Texture | null } = {}) => {
  const key = `${color}|${shore}|${rise.toFixed(2)}|${opts.bottom ?? ""}`;
  let m = opts.mirror ? undefined : materials.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.55),
    roughness: 0.06,
    metalness: 0,
    envMap: opts.mirror ?? skyEnv,
    // (the sky's reflection is added by hand below, with the Fresnel; not twice)
    envMapIntensity: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8
  });
  const tex = rippleTexture();
  // (with its depth known: clear where it's a few inches deep, so it meets its banks softly)
  if (opts.bottom) { m.defines = { ...m.defines, DG_DEPTH: "" }; m.transparent = true; }
  if (opts.mirror) m.defines = { ...m.defines, DG_MIRROR: "" };
  // (a pond's floor at its very edge: the water's own color a little darker, a touch of the bank's)
  const bottom = new THREE.Color(opts.bottom ?? "#5a5238").multiplyScalar(0.62);
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, waterUniforms, { uRipples: { value: tex }, uReflect: { value: 0.9 }, uShore: { value: new THREE.Color(shore).multiplyScalar(0.55) }, uRise: { value: rise }, uBottom: { value: bottom } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;\n#ifdef DG_DEPTH\nattribute float aDepth;\nattribute float aShore;\nvarying float vDepth;\nvarying float vShore;\n#endif")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\n#ifdef DG_DEPTH\nvDepth = aDepth;\nvShore = aShore;\n#endif");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;\nuniform sampler2D uRipples;\nuniform float uTime;\nuniform float uWind;\nuniform float uReflect;\nuniform vec3 uShore;\nuniform float uRise;\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nuniform vec3 uBottom;\n#ifdef DG_DEPTH\nvarying float vDepth;\nvarying float vShore;\n#endif")
      // The shallows: a thin band at the bank, the water's own color everywhere past it
      .replace("#include <color_fragment>", `#include <color_fragment>
        #ifdef DG_DEPTH
          diffuseColor.rgb = mix( uBottom, diffuseColor.rgb, smoothstep( 0.1, 2.0, vDepth ) );
          // (clear where it's inches deep, so the bank shows through; and thinning away past its
          // outline where the ground stays as low as it)
          diffuseColor.a *= smoothstep( 0.0, 0.55, vDepth ) * smoothstep( -26.0, -12.0, vShore );
        #endif`)
      // Two layers of ripples at different sizes, drifting different ways, tilting the surface
      .replace("#include <normal_fragment_maps>", `
        {
          vec2 p = vWaterXZ;
          vec3 a = texture2D( uRipples, p / 37.0 + vec2( 0.021, 0.013 ) * uTime * uWind ).xyz * 2.0 - 1.0;
          vec3 b = texture2D( uRipples, mat2( 0.8, -0.6, 0.6, 0.8 ) * p / 13.0 - vec2( 0.017, 0.029 ) * uTime * uWind ).xyz * 2.0 - 1.0;
          vec2 tilt = ( a.xy * 0.6 + b.xy * 0.4 ) * 0.11;
          vec3 nW = normalize( vec3( tilt.x, 1.0, tilt.y ) );
          normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
        }`)
      // The sky in the mirror direction, taking over toward the horizon (Fresnel) as on real water;
      // the water's own color looking straight down into it
      .replace("#include <opaque_fragment>", `
        #ifdef USE_ENVMAP
        {
          vec3 V = normalize( vViewPosition );
          vec3 R = inverseTransformDirection( reflect( -V, normal ), viewMatrix );
          R.y = abs( R.y );
          vec3 sky = textureCubeUV( envMap, R, 0.03 ).rgb * uReflect;
          #ifndef DG_MIRROR
          // The banks and the trees on them, mirrored low in the water (in the pond's own picture
          // they're there as they stand)
          sky = mix( sky, uShore, 1.0 - smoothstep( uRise * 0.55, uRise * 1.25, R.y ) );
          #endif
          float cosV = clamp( dot( normal, V ), 0.0, 1.0 );
          float fres = 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 );
          #ifdef DG_DEPTH
          // (at the very edge, a few inches deep, the bottom shows through more than the sky)
          fres *= mix( 0.4, 1.0, smoothstep( 0.1, 1.2, vDepth ) );
          #endif
          outgoingLight = mix( outgoingLight, sky, clamp( fres, 0.0, 0.85 ) );
          #ifdef DG_DEPTH
          // A thin lace of foam where it laps at the bank, broken up by the ripples
          {
            float lap = smoothstep( 0.04, 0.14, vDepth ) * ( 1.0 - smoothstep( 0.18, 0.45, vDepth ) );
            float n = texture2D( uRipples, vWaterXZ / 9.0 + vec2( 0.013, -0.009 ) * uTime * uWind ).z;
            outgoingLight = mix( outgoingLight, vec3( 0.8, 0.85, 0.8 ), lap * smoothstep( 0.55, 0.85, n ) * 0.22 );
          }
          #endif
          // The sun's glitter: where a ripple tilts the sun's mirror image right at the eye
          float glint = pow( max( dot( R, normalize( uSunDir ) ), 0.0 ), 900.0 );
          outgoingLight += uSunColor * glint * 7.0 * smoothstep( 0.0, 0.08, uSunDir.y );
        }
        #endif
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `dg-water${opts.bottom ? "-d" : ""}${opts.mirror ? "-m" : ""}`;
  // (a pond's own, with its picture: let go with the pond; the rest shared)
  if (opts.mirror) return m;
  m.userData.shared = true;
  materials.set(key, m);
  return m;
};
