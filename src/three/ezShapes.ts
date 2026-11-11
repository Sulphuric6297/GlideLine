// The course's tree shapes, grown by ez-tree (MIT, github.com/dgreenheck/ez-tree): oaks and
// ashes, pines and bushes from its presets, each seed its own tree, made once at unit height and
// shared (woods draw them instanced). Its photographed bark and leaves, lit like its demo.
//
// A tree is grown once for what it is (its preset, seed and own settings) and gives three
// versions: the full tree close by; the same branches without the small twigs and one leaf in
// six, bigger, in the middle distance; trunk, main limbs and a few big leaf clusters far off.
import * as THREE from "three";
import type { Tree as EzTree } from "@dgreenheck/ez-tree";
import type { Detail, TreeProto, TreeShape } from "./treeKit";
import { timed } from "../lib/perfLog";

// ez-tree, loaded in the browser before the app starts (it loads its textures as soon as it is
// imported: tests outside a browser, and anything else without a page, never load it)
let Tree: (new () => EzTree) | null = null;
let PRESETS_EZ: Record<string, unknown> = {};
export const ezReady: Promise<void> = typeof document === "undefined"
  ? Promise.resolve()
  : Promise.all([import("@dgreenheck/ez-tree").then(m => { Tree = m.Tree as unknown as new () => EzTree; PRESETS_EZ = m.TreePreset as Record<string, unknown>; }), Promise.resolve().then(() => loadKept())]).then(() => undefined);
/** Whether ez-tree is there to grow trees (else the hand-built shapes stand in). */
export const ezLoaded = () => Tree !== null;

/** ez-tree's presets behind each kind's variants (a variant picks one, and its seed). */
const PRESETS: Record<TreeShape, string[]> = {
  // (after the first six: the region's species, picked by the county's mix: lib/treeMix's LOOK_VARIANTS
  // names these by place, so a new one goes at the end)
  broadleaf: ["Oak Medium", "Ash Medium", "Oak Large", "Ash Large", "Oak Small", "Ash Small",
    "Aspen Medium", "Aspen Large", "Birch Medium", "Birch Large", "Maple Medium", "Maple Large", "Willow Medium", "Bradford pear Medium", "Bradford pear Small"],
  conifer: ["Pine Medium", "Pine Large", "Pine Small", "Pine Large", "Spruce Medium", "Spruce Large", "Cedar Medium", "Cedar Small", "Tall pine Medium", "Tall pine Large"],
  // (the first six: bushes; then the underbrush's own: briars, weeds, thicket shrubs, two each)
  bush: ["Bush 1", "Bush 3", "Bush 1", "Bush 3", "Bush 2", "Bush 2", "Briars", "Briars", "Weeds", "Ferns", "Thicket", "Thicket"]
};
/** How many variants a kind picks from when nothing says which (bushes: not the underbrush's own). */
export const EZ_VARIANTS: Record<TreeShape, number> = { broadleaf: 6, conifer: 4, bush: 6 };
/** The underbrush's own bush variants: briars, weeds and thicket shrubs. */
export const BRUSH_VARIANTS = { briars: [6, 7], weeds: [8, 9], thicket: [10, 11] } as const;

type Options = {
  /** "deciduous": each limb ends in a leader of the next level; "evergreen": one leader to a point,
   * the lower limbs longest. */
  type: string;
  branch: Record<"angle" | "children" | "gnarliness" | "length" | "radius" | "sections" | "segments" | "start" | "taper" | "twist", Record<number, number>> & { levels: number; force: { direction: { x: number; y: number; z: number }; strength: number } };
  bark: { type: string; tint: number; textureScale: { x: number; y: number } };
  leaves: { type: string; count: number; size: number; sizeVariance: number; angle: number; start: number; billboard: string };
};
/** Growths of our own, each from one of ez-tree's bushes reshaped. */
/** A growth of our own: the ez-tree bush it starts from, how it's reshaped, and (for the light
 * ones) how its leaves thin with distance: one in how many kept, how much bigger, middle to farthest. */
type Custom = { base: string; shape: (o: Options) => void; thin?: [number, number][] };
const CUSTOM: Record<string, Custom> = {
  // Briars: blackberry, greenbrier, multiflora rose. A mound of long, thin canes from the ground,
  // arching up and out and back down, twiggy side shoots all along, small dark leaves; reddish canes
  Briars: {
    base: "Bush 2",
    shape: o => {
      const b = o.branch;
      b.levels = 2;
      Object.assign(b.length, { 0: 0.1, 1: 26, 2: 5 });
      Object.assign(b.radius, { 0: 0.4, 1: 0.75, 2: 0.6 });
      Object.assign(b.children, { 0: 24, 1: 10 });
      Object.assign(b.angle, { 1: 42, 2: 55 });
      Object.assign(b.start, { 1: 0, 2: 0.15 });
      Object.assign(b.sections, { 0: 2, 1: 8, 2: 3 });
      Object.assign(b.segments, { 0: 3, 1: 3, 2: 3 });
      Object.assign(b.gnarliness, { 0: 0, 1: 0.1, 2: 0.4 });
      Object.assign(b.taper, { 1: 0.85, 2: 0.7 });
      Object.assign(b.twist, { 0: 0.4, 1: 0.03, 2: 0 });
      b.force.strength = -0.055;
      o.bark.type = "willow";
      o.bark.tint = 0x9a6458;
      o.bark.textureScale = { x: 0.5, y: 4 };
      Object.assign(o.leaves, { type: "oak", count: 5, size: 2.6, sizeVariance: 0.5, angle: 40, start: 0.3, billboard: "double" });
    },
    thin: [[2, 1.4], [3, 1.7], [7, 2.6]]
  },
  // Weeds: goldenrod, ironweed, pokeweed, broomsedge. A clump of thin stalks standing up, leaves
  // up their length; tan-green stems
  Weeds: {
    base: "Bush 2",
    shape: o => {
      const b = o.branch;
      b.levels = 1;
      Object.assign(b.length, { 0: 0.1, 1: 20 });
      Object.assign(b.radius, { 0: 0.35, 1: 0.32 });
      Object.assign(b.children, { 0: 32 });
      Object.assign(b.angle, { 1: 16 });
      Object.assign(b.start, { 1: 0 });
      Object.assign(b.sections, { 0: 2, 1: 6 });
      Object.assign(b.segments, { 0: 3, 1: 3 });
      Object.assign(b.gnarliness, { 0: 0, 1: 0.06 });
      Object.assign(b.taper, { 1: 0.9 });
      Object.assign(b.twist, { 0: 0.5, 1: 0 });
      b.force.strength = 0.006;
      o.bark.type = "birch";
      o.bark.tint = 0xa8ad7a;
      o.bark.textureScale = { x: 0.3, y: 3 };
      Object.assign(o.leaves, { type: "ash", count: 7, size: 2.1, sizeVariance: 0.6, angle: 55, start: 0.3, billboard: "double" });
    },
    thin: [[1, 1], [2, 1.3], [3, 1.6]]
  },
  // Ferns: bracken and Christmas fern in the shade, a clump of fronds (ez-tree's needle sprays)
  Ferns: {
    base: "Bush 2",
    shape: o => {
      const b = o.branch;
      b.levels = 1;
      Object.assign(b.length, { 0: 0.1, 1: 18 });
      Object.assign(b.radius, { 0: 0.3, 1: 0.18 });
      Object.assign(b.children, { 0: 40 });
      Object.assign(b.angle, { 1: 24 });
      Object.assign(b.start, { 1: 0 });
      Object.assign(b.sections, { 0: 2, 1: 5 });
      Object.assign(b.segments, { 0: 3, 1: 3 });
      Object.assign(b.gnarliness, { 0: 0, 1: 0.1 });
      Object.assign(b.taper, { 1: 0.9 });
      Object.assign(b.twist, { 0: 0.5, 1: 0 });
      b.force.strength = -0.004;
      o.bark.type = "birch";
      o.bark.tint = 0xb3a77a;
      o.bark.textureScale = { x: 0.3, y: 3 };
      Object.assign(o.leaves, { type: "pine", count: 5, size: 2.5, sizeVariance: 0.5, angle: 20, start: 0.1, billboard: "double" });
    },
    thin: [[1, 1], [2, 1.25], [3, 1.45]]
  },
  // Thicket shrubs: mountain laurel, rhododendron, privet. Big, many-stemmed, leafy to the ground
  // and packed tight
  Thicket: {
    base: "Bush 1",
    shape: o => {
      const b = o.branch;
      Object.assign(b.children, { 0: 13, 1: 4, 2: 3 });
      Object.assign(b.angle, { 1: 34 });
      Object.assign(b.start, { 1: 0.2, 2: 0.2 });
      Object.assign(b.gnarliness, { 1: 0.16, 2: 0.12 });
      o.leaves.type = "oak";
      o.leaves.count = 14;
      o.leaves.size *= 1.05;
    }
  }
};
// The region's species (lib/treeMix), each grown from one of ez-tree's trees reshaped, in its sizes
// (`Name Small`, `Name Medium`, `Name Large`), as tried in the species mockup
const regional = (name: string, bases: Record<"Small" | "Medium" | "Large", string>, shape: (o: Options) => void) => {
  for (const size of ["Small", "Medium", "Large"] as const) CUSTOM[`${name} ${size}`] = { base: bases[size], shape };
};
// Birch: the aspen slimmer and upright, white bark, light leaves
regional("Birch", { Small: "Aspen Small", Medium: "Aspen Medium", Large: "Aspen Large" }, o => {
  const b = o.branch;
  o.bark.type = "birch";
  o.bark.tint = 0xffffff;
  b.angle[1] = Math.max(25, b.angle[1] * 0.75);
  b.radius[0] *= 0.75;
  b.length[1] *= 0.85;
  o.leaves.type = "aspen";
  o.leaves.count = Math.round(o.leaves.count * 1.15);
});
// Maple: the oak rounder and fuller, smoother limbs
regional("Maple", { Small: "Oak Small", Medium: "Oak Medium", Large: "Oak Large" }, o => {
  const b = o.branch;
  b.angle[1] = 50;
  b.gnarliness[1] *= 0.6;
  b.gnarliness[2] *= 0.6;
  b.length[1] *= 0.9;
  b.children[1] = Math.round(b.children[1] * 1.15);
  o.leaves.type = "oak";
  o.leaves.count = Math.round(o.leaves.count * 1.35);
  o.leaves.size *= 1.1;
});
// Weeping willow: the ash with willow bark, long thin branches pulled down
regional("Willow", { Small: "Ash Small", Medium: "Ash Medium", Large: "Ash Large" }, o => {
  const b = o.branch;
  o.bark.type = "willow";
  b.force = { direction: { x: 0, y: -1, z: 0 }, strength: 0.06 };
  b.length[2] *= 1.7;
  b.length[3] *= 1.6;
  b.gnarliness[2] *= 0.4;
  b.gnarliness[3] *= 0.4;
  b.children[2] = Math.round(b.children[2] * 1.2);
  o.leaves.type = "ash";
  o.leaves.count = Math.round(o.leaves.count * 1.5);
  o.leaves.size *= 0.8;
});
// Bradford pear (callery pear): a slim trunk and small glossy leaves packed to the outside, no
// gaps. Young (Small): one straight leader to a point, the lower limbs longest, a narrow cone;
// grown (Medium, Large): a short trunk splitting into many steep limbs, a broad upright egg
const pearLeaves = (o: Options, count: number, size: number) => {
  o.leaves.type = "oak";
  o.leaves.count = count;
  o.leaves.size = size;
  o.leaves.sizeVariance = 0.3;
  o.leaves.start = 0;
  o.leaves.angle = 50;
};
CUSTOM["Bradford pear Small"] = {
  base: "Oak Small",
  shape: o => {
    const b = o.branch;
    o.type = "evergreen";
    b.levels = 3;
    b.length[0] = 30;
    b.radius[0] = 0.38;
    b.sections[0] = 16;
    b.start[1] = 0.12;
    b.children[0] = 36;
    b.angle[1] = 45;
    b.length[1] = 14;
    b.radius[1] = 0.6;
    b.gnarliness[0] = 0.02;
    b.gnarliness[1] = 0.04;
    b.twist[0] = 0;
    b.force = { direction: { x: 0, y: 1, z: 0 }, strength: 0.02 };
    b.children[1] = 4;
    b.angle[2] = 45;
    b.length[2] = 3.5;
    b.start[2] = 0.1;
    b.children[2] = 3;
    b.angle[3] = 40;
    b.length[3] = 2;
    b.start[3] = 0;
    pearLeaves(o, 9, 2.4);
  }
};
for (const [size, base, scale] of [["Medium", "Oak Medium", 1], ["Large", "Oak Large", 1.25]] as const) {
  CUSTOM[`Bradford pear ${size}`] = {
    base,
    shape: o => {
      const b = o.branch;
      o.type = "evergreen";
      b.levels = 3;
      b.length[0] = 24 * scale;
      b.radius[0] = 0.55 * scale;
      b.sections[0] = 16;
      b.start[1] = 0.08;
      b.children[0] = 44;
      b.angle[1] = 46;
      b.length[1] = 22 * scale;
      b.radius[1] = 0.6;
      b.gnarliness[0] = 0.02;
      b.gnarliness[1] = 0.03;
      b.gnarliness[2] = 0.08;
      b.twist[0] = 0;
      b.force = { direction: { x: 0, y: 1, z: 0 }, strength: 0.04 };
      b.children[1] = 6;
      b.angle[2] = 45;
      b.length[2] = 4.5 * scale;
      b.start[2] = 0.1;
      b.children[2] = 3;
      b.angle[3] = 40;
      b.length[3] = 2 * scale;
      b.start[3] = 0;
      pearLeaves(o, 7, 2.6 * scale);
    }
  };
}
// Tall pine (the South's loblolly, longleaf, slash and shortleaf; ponderosa; red pine): a tall,
// slim, bare trunk, and up top a short, open, crooked crown of upswept limbs with tufts of long
// needles at their ends
for (const [size, base, scale] of [["Small", "Pine Medium", 0.6], ["Medium", "Pine Large", 1], ["Large", "Pine Large", 1.3]] as const) {
  CUSTOM[`Tall pine ${size}`] = {
    base,
    shape: o => {
      const b = o.branch;
      o.type = "evergreen";
      b.levels = 2;
      b.length[0] = 70 * scale;
      b.radius[0] = 0.7 * scale;
      b.sections[0] = 14;
      b.gnarliness[0] = 0.03;
      b.start[1] = size === "Small" ? 0.45 : 0.6;
      b.children[0] = 24;
      b.angle[1] = 80;
      b.length[1] = 40 * scale;
      b.radius[1] = 0.5;
      b.gnarliness[1] = 0.22;
      b.sections[1] = 8;
      b.force = { direction: { x: 0, y: 1, z: 0 }, strength: 0.025 };
      b.children[1] = 5;
      b.angle[2] = 42;
      b.length[2] = 8 * scale;
      b.start[2] = 0.35;
      b.radius[2] = 0.6;
      b.gnarliness[2] = 0.1;
      o.leaves.type = "pine";
      o.leaves.count = 14;
      o.leaves.size = 3.4 * scale;
      o.leaves.start = 0.35;
      o.leaves.angle = 30;
    }
  };
}
// Spruce (and fir, hemlock): the pine's branches short and swept down, narrowing to a point
regional("Spruce", { Small: "Pine Small", Medium: "Pine Medium", Large: "Pine Large" }, o => {
  const b = o.branch;
  b.angle[1] = Math.min(115, b.angle[1] + 20);
  b.length[1] *= 0.7;
  b.start[1] = 0.12;
  o.leaves.count = Math.round(o.leaves.count * 1.3);
});
// Cedar (eastern red cedar, juniper): narrow, branched near the ground, small dense needles
regional("Cedar", { Small: "Pine Small", Medium: "Pine Medium", Large: "Pine Large" }, o => {
  const b = o.branch;
  b.length[1] *= 0.45;
  b.start[1] = 0.04;
  b.children[0] = Math.round(b.children[0] * 1.3);
  o.leaves.size *= 0.7;
  o.leaves.count = Math.round(o.leaves.count * 1.4);
});

/** Loads a preset (ez-tree's, or one of ours) into a tree's options. */
const loadInto = (t: EzTree, preset: string) => {
  const own = CUSTOM[preset];
  // (the preset's settings alone: ez-tree's own loadPreset grows the tree as well, a whole tree's
  // work thrown away, as it's grown again once its settings are all in)
  const json = PRESETS_EZ[own ? own.base : preset];
  if (json) (t.options as unknown as { copy: (o: unknown) => void }).copy(structuredClone(json));
  else t.loadPreset(own ? own.base : preset);
  if (own) own.shape(t.options as unknown as Options);
};

/** The species a tree can be, by kind (ez-tree's preset families). */
export const SPECIES: Record<TreeShape, { id: string; label: string; presets: [string, string, string] }[]> = {
  broadleaf: [
    { id: "oak", label: "Oak", presets: ["Oak Small", "Oak Medium", "Oak Large"] },
    { id: "ash", label: "Ash", presets: ["Ash Small", "Ash Medium", "Ash Large"] },
    { id: "maple", label: "Maple", presets: ["Maple Small", "Maple Medium", "Maple Large"] },
    { id: "aspen", label: "Aspen", presets: ["Aspen Small", "Aspen Medium", "Aspen Large"] },
    { id: "birch", label: "Birch", presets: ["Birch Small", "Birch Medium", "Birch Large"] },
    { id: "willow", label: "Weeping willow", presets: ["Willow Small", "Willow Medium", "Willow Large"] },
    { id: "pear", label: "Bradford pear", presets: ["Bradford pear Small", "Bradford pear Medium", "Bradford pear Large"] }
  ],
  conifer: [
    { id: "pine", label: "Pine", presets: ["Pine Small", "Pine Medium", "Pine Large"] },
    { id: "tallpine", label: "Tall pine", presets: ["Tall pine Small", "Tall pine Medium", "Tall pine Large"] },
    { id: "spruce", label: "Spruce", presets: ["Spruce Small", "Spruce Medium", "Spruce Large"] },
    { id: "cedar", label: "Cedar", presets: ["Cedar Small", "Cedar Medium", "Cedar Large"] }
  ],
  bush: [
    { id: "round", label: "Round", presets: ["Bush 1", "Bush 1", "Bush 1"] },
    { id: "dense", label: "Dense", presets: ["Bush 3", "Bush 3", "Bush 3"] },
    { id: "airy", label: "Airy", presets: ["Bush 2", "Bush 2", "Bush 2"] },
    { id: "briars", label: "Briars", presets: ["Briars", "Briars", "Briars"] },
    { id: "weeds", label: "Weeds", presets: ["Weeds", "Weeds", "Ferns"] },
    { id: "thicket", label: "Thicket", presets: ["Thicket", "Thicket", "Thicket"] }
  ]
};
/** A species' preset for a tree of this height (a young tree, a grown one, an old one). */
export const presetFor = (shape: TreeShape, species: string, height: number) => {
  const sp = SPECIES[shape].find(s => s.id === species) ?? SPECIES[shape][0];
  return sp.presets[shape === "bush" ? 0 : height < 30 ? 0 : height < 58 ? 1 : 2];
};
export const speciesOfPreset = (shape: TreeShape, preset: string) => (SPECIES[shape].find(s => s.presets.includes(preset)) ?? SPECIES[shape][0]).id;

/** What a tree is grown from: its preset and seed, and its own settings (unset: the preset's). */
export type TreeSpec = {
  preset: string;
  seed: number;
  /** Where the branches start, as a share of the trunk (ez-tree's branch.start[1]). */
  crownBase?: number;
  /** Main limbs off the trunk (a pine: its branches up the trunk). */
  limbs?: number;
  /** Trunk thickness, 1 = the preset's. */
  trunk?: number;
  /** Leaves, 1 = the preset's. */
  fullness?: number;
};

/** A pool variant's spec (what an untouched tree of the woods or the survey is). */
export const specOf = (shape: TreeShape, variant: number): TreeSpec => {
  const list = PRESETS[shape];
  return { preset: list[variant % list.length], seed: 1000 + variant * 7919 };
};
const keyOf = (s: TreeSpec) => JSON.stringify([s.preset, s.seed, s.crownBase ?? null, s.limbs ?? null, s.trunk ?? null, s.fullness ?? null]);

/** The preset's own values of the settings (what the sliders start at). */
export const presetDefaults = (preset: string) => {
  if (!Tree) return { crownBase: 0.3, limbs: 6 };
  const t = new Tree();
  loadInto(t, preset);
  return { crownBase: t.options.branch.start[1] as number, limbs: t.options.branch.children[0] as number };
};

const mats = new Map<string, THREE.Material>();
/**
 * How near the camera trees fade out (feet; 0: never): from a standing or flying eye, the leaves and
 * branches right in front of it melt away (a fine dither, from this far in to half of it), so a
 * flight through the treetops or a walk under them shows the hole, not a wall of leaves (as games
 * do). CourseView sets it for each picture.
 */
export const treeNearFade = { value: 0 };
/**
 * One version of a tree giving way to the next as the eye draws back: over this share past the
 * distance where it changes, the nearer version melts out and the farther one in, in a fine dither
 * (each the other's gaps, so the tree is whole all the way), never a swap from one frame to the
 * next. A forest's meshes say where theirs come in and go out (`aLod`: feet; 0: no fade).
 */
export const LOD_BAND = 0.2;
/** How much the eye is zoomed in (1: not): a tree twice as large in the picture changes twice as
 * far off, so the melting stays where it is too small to see, never a stipple across a bush
 * brought close by the zoom. */
export const treeLodZoom = { value: 1 };
/** How a tree's leaves thin for its middle and far versions: 1 kept in so many, each so many times
 * larger. A computer's: fuller, so a tree far off looks like the tree it is up close. A phone's
 * and a machine's without a graphics card: lighter (CourseView sets them before any tree grows). */
export const leafThin: { mid: [number, number]; far: [number, number] } = { mid: [4, 1.9], far: [12, 3.2] };
/** The fade on a tree material (with whatever else its shader has). */
const withNearFade = (m: THREE.Material) => {
  const own = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, r) => {
    own(shader, r);
    shader.uniforms.uNearFade = treeNearFade;
    shader.uniforms.uLodZoom = treeLodZoom;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTreeW;\nattribute vec2 aLod;\nvarying vec2 vLod;\nuniform float uLodZoom;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        {
          vec4 tw = vec4( transformed, 1.0 );
          vLod = vec2( 1.0, 0.0 );
          #ifdef USE_INSTANCING
            tw = instanceMatrix * tw;
            // (the whole tree as one: how far its middle is)
            float ld = distance( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.5, 0.0, 1.0 ) ).xyz, cameraPosition ) / uLodZoom;
            if ( aLod.x > 0.0 ) vLod.x = smoothstep( aLod.x, aLod.x * ${(1 + LOD_BAND).toFixed(2)}, ld );
            if ( aLod.y > 0.0 ) vLod.y = smoothstep( aLod.y, aLod.y * ${(1 + LOD_BAND).toFixed(2)}, ld );
          #endif
          vTreeW = ( modelMatrix * tw ).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTreeW;\nvarying vec2 vLod;\nuniform float uNearFade;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if ( vLod.x < 1.0 || vLod.y > 0.0 ) {
          float ln = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
          if ( ln >= vLod.x || ln < vLod.y ) discard;
        }
        if ( uNearFade > 0.0 ) {
          float keep = smoothstep( uNearFade * 0.45, uNearFade, distance( vTreeW, cameraPosition ) );
          float n = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
          if ( keep < n ) discard;
        }`);
  };
};

/** One material per bark and leaf texture, shared; instancing-friendly (each tree's tint comes in
 * as its instance color, so it multiplies the photographed leaves gently). */
const materialFor = (kind: "bark" | "leaves", fromOf: () => THREE.MeshPhongMaterial, key: string, tint?: number) => {
  let m = mats.get(`${kind}|${key}`);
  if (m) return m;
  const from = fromOf();
  m = kind === "leaves"
    ? new THREE.MeshPhongMaterial({ name: `ez-leaves-${key}`, map: from.map, side: THREE.DoubleSide, alphaTest: from.alphaTest || 0.5, dithering: true, shininess: 4 })
    : new THREE.MeshPhongMaterial({ name: `ez-bark-${key}`, map: from.map, normalMap: from.normalMap, aoMap: from.aoMap, shininess: 2, color: tint ?? 0xffffff });
  if (kind === "leaves") {
    (m as THREE.MeshPhongMaterial).alphaToCoverage = true;
    // Leaves of a warm color (autumn's reds, oranges and golds; a dry landscape's browns): the
    // photo is of green leaves, which no tint turns orange, so they take the photo's light and
    // shade in that color instead; green ones keep the photo as it is, gently tinted
    m.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", /* glsl */ `
        vec3 leafTint = diffuse;
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
          leafTint *= vColor.rgb;
        #endif
        // (by the tint's hue: green keeps the photo, warm takes the color whole, olive between: dusty)
        float ltMax = max( leafTint.r, max( leafTint.g, leafTint.b ) ), ltD = ltMax - min( leafTint.r, min( leafTint.g, leafTint.b ) );
        float ltHue = 0.3;
        if ( ltD > 1e-4 ) {
          if ( ltMax == leafTint.r ) ltHue = mod( ( leafTint.g - leafTint.b ) / ltD, 6.0 ) / 6.0;
          else if ( ltMax == leafTint.g ) ltHue = ( ( leafTint.b - leafTint.r ) / ltD + 2.0 ) / 6.0;
          else ltHue = ( ( leafTint.r - leafTint.g ) / ltD + 4.0 ) / 6.0;
        }
        float greenish = ltD / max( ltMax, 1e-4 ) < 0.03 ? 1.0 : smoothstep( 0.19, 0.28, ltHue ) * ( 1.0 - smoothstep( 0.6, 0.7, ltHue ) );
        vec3 leafPhoto = diffuseColor.rgb / max( diffuse, vec3( 1e-3 ) );
        float leafLum = dot( leafPhoto, vec3( 0.299, 0.587, 0.114 ) );
        diffuseColor.rgb = mix( leafLum * 3.0 * leafTint, leafPhoto * leafTint, greenish );`)
        // A leaf's cut-out keeps its cover far off: the smaller copies of the picture the card
        // reads there average each leaf's edge away, till most of it falls under the cut and the
        // crown goes bare. Its cover is raised by how small a copy is being read.
        .replace("#include <alphatest_fragment>", /* glsl */ `
        #ifdef USE_MAP
        {
          vec2 lts = vec2( textureSize( map, 0 ) );
          vec2 ldx = dFdx( vMapUv * lts ), ldy = dFdy( vMapUv * lts );
          float llod = max( 0.0, 0.5 * log2( max( dot( ldx, ldx ), dot( ldy, ldy ) ) ) );
          diffuseColor.a = min( 1.0, diffuseColor.a * ( 1.0 + max( 0.0, llod - 1.0 ) * 0.3 ) );
        }
        #endif
        #include <alphatest_fragment>`);
    };
    m.customProgramCacheKey = () => "ez-leaves-cover";
  }
  withNearFade(m);
  m.userData.shared = true;
  mats.set(`${kind}|${key}`, m);
  return m;
};

/** A tree with its settings set, not grown yet. */
const prepare = (spec: TreeSpec) => {
  const t = new Tree!();
  loadInto(t, spec.preset);
  const o = t.options;
  o.seed = spec.seed;
  // (aspen leaves are autumn-yellow: the green landscapes take ash leaves on those bushes)
  if (o.leaves.type === "aspen") o.leaves.type = "ash";
  if (spec.crownBase !== undefined) o.branch.start[1] = Math.min(0.95, Math.max(0, spec.crownBase));
  if (spec.limbs !== undefined) o.branch.children[0] = Math.max(1, Math.round(spec.limbs));
  if (spec.trunk !== undefined) o.branch.radius[0] *= Math.max(0.3, spec.trunk);
  if (spec.fullness !== undefined) {
    o.leaves.count = Math.max(1, Math.round(o.leaves.count * spec.fullness));
    o.leaves.size *= 0.85 + 0.15 * Math.min(1.6, spec.fullness);
  }
  return t;
};

/** Grows a prepared tree, noting which bark indices belong to which branch level (for the lighter versions). */
const grow = (t: EzTree) => {
  const levels: { level: number; from: number; to: number }[] = [];
  const self = t as unknown as { generateBranch: (b: { level: number }) => void; branches: { indices: number[] } };
  const orig = self.generateBranch.bind(t);
  self.generateBranch = (b: { level: number }) => {
    const from = self.branches.indices.length;
    orig(b);
    levels.push({ level: b.level, from, to: self.branches.indices.length });
  };
  t.generate();
  return { t, levels };
};

/** The leaves thinned to one in `keep`, each one left `grow` times as big about its stem. */
const thinLeaves = (g: THREE.BufferGeometry, keep: number, growBy: number) => {
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv"), idx = g.getIndex()!;
  // (a leaf is one or two quads of four corners, six indices each, in order)
  const quads = idx.count / 6, P: number[] = [], U: number[] = [], I: number[] = [];
  for (let q = 0; q < quads; q++) {
    // (both quads of a crossed leaf go together)
    if (Math.floor(q / 2) % keep !== 0) continue;
    const v0 = idx.getX(q * 6);
    // stem: the middle of the quad's bottom edge (its corners 1 and 2)
    const ox = (pos.getX(v0 + 1) + pos.getX(v0 + 2)) / 2, oy = (pos.getY(v0 + 1) + pos.getY(v0 + 2)) / 2, oz = (pos.getZ(v0 + 1) + pos.getZ(v0 + 2)) / 2;
    const base = P.length / 3;
    for (let c = 0; c < 4; c++) {
      P.push(ox + (pos.getX(v0 + c) - ox) * growBy, oy + (pos.getY(v0 + c) - oy) * growBy, oz + (pos.getZ(v0 + c) - oz) * growBy);
      U.push(uv.getX(v0 + c), uv.getY(v0 + c));
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  out.setIndex(I);
  out.computeVertexNormals();
  return out;
};

/** The bark of branch levels up to `maxLevel` only. */
const barkUpTo = (g: THREE.BufferGeometry, levels: { level: number; from: number; to: number }[], maxLevel: number) => {
  const idx = g.getIndex()!, I: number[] = [];
  for (const l of levels) if (l.level <= maxLevel) for (let i = l.from; i < l.to; i++) I.push(idx.getX(i));
  // (the same corners, fewer of them drawn: none copied)
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, a);
  out.setIndex(I);
  out.boundingBox = g.boundingBox;
  out.boundingSphere = g.boundingSphere;
  return out;
};

type Grown = Record<Detail, TreeProto>;
const grown = new Map<string, Grown>();

// ---------------------------------------------------------------- trees grown before, kept
// Growing a tree is the slowest part of opening a course on a phone (a second or more each, and
// a course needs a few dozen); what it grows depends only on its settings, so each is kept in the
// browser (IndexedDB) under a fingerprint of them, and the next visit takes it from there: the
// very same tree. A new version of the tree engine (KEEP_V) grows them all again.
const KEEP_V = "1|ez-tree 1.1.0";
type Geo = { attrs: { name: string; size: number; data: ArrayBuffer }[]; index: ArrayBuffer; wide: boolean };
type Kept = { k: string; at: number; bark: Geo; leaves: Geo; levels: { level: number; from: number; to: number }[]; box: number[]; barkType: string; leafType: string };
const kept = new Map<string, Kept>();
const KEEP_MAX = 300;
let dbOpen: Promise<IDBDatabase | null> | null = null;
const keptDb = () => (dbOpen ??= new Promise<IDBDatabase | null>(res => {
  try {
    const r = indexedDB.open("hyzerlab-trees", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("trees", { keyPath: "k" });
    r.onsuccess = () => res(r.result);
    r.onerror = r.onblocked = () => res(null);
  } catch { res(null); }
}));
/** The kept trees, read before the app starts (a few seconds at most: without them, they grow). */
function loadKept() {
  return new Promise<void>(res => {
    const t = setTimeout(res, 4000);
    const done = () => { clearTimeout(t); res(); };
    void keptDb().then(db => {
      if (!db) return done();
      try {
        const q = db.transaction("trees").objectStore("trees").getAll();
        q.onsuccess = () => {
          const all = (q.result as Kept[]).sort((a, b) => b.at - a.at);
          all.slice(0, KEEP_MAX).forEach(x => kept.set(x.k, x));
          // (the oldest past the most kept: let go)
          if (all.length > KEEP_MAX) { const st = db.transaction("trees", "readwrite").objectStore("trees"); all.slice(KEEP_MAX).forEach(x => st.delete(x.k)); }
          done();
        };
        q.onerror = done;
      } catch { done(); }
    });
  });
}
// (written when the page is idle, one at a time: copying a megabyte or two into the browser's
// store, a few dozen times over, isn't done while the course is still being made)
const toKeep: Kept[] = [];
// (the course's own saving goes first: the trees' writes start well after the page opens, one at
// most every 1.5 s, in the browser's cheaper write mode; a tree lost to a closed page grows again)
const opened = typeof performance !== "undefined" ? performance.now() : 0;
const idle = (fn: () => void) => {
  // (soon enough that a short first visit leaves the next one its trees: all of a course's in
  // about half a minute, not three)
  const wait = Math.max(250, 6000 - (performance.now() - opened));
  setTimeout(() => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 5000 }) : fn()), wait);
};
const keepNext = () => {
  const x = toKeep.shift();
  if (!x) return;
  void keptDb().then(db => {
    try {
      if (!db) return;
      const tx = db.transaction("trees", "readwrite", { durability: "relaxed" });
      tx.objectStore("trees").put(x);
      tx.oncomplete = tx.onerror = () => { if (toKeep.length) idle(keepNext); };
    } catch { /* (full, or not allowed: grown next time) */ }
  });
};
const keepTree = (x: Kept) => { toKeep.push(x); if (toKeep.length === 1) idle(keepNext); };
/** A geometry as plain buffers, to keep (null: not one that can be). */
const toGeo = (g: THREE.BufferGeometry): Geo | null => {
  const idx = g.getIndex();
  if (!idx) return null;
  const attrs: Geo["attrs"] = [];
  for (const [name, a] of Object.entries(g.attributes)) {
    if (!(a.array instanceof Float32Array) || "isInterleavedBufferAttribute" in a) return null;
    attrs.push({ name, size: a.itemSize, data: a.array.slice().buffer });
  }
  return { attrs, index: (idx.array as Uint16Array | Uint32Array).slice().buffer, wide: idx.array instanceof Uint32Array };
};
const fromGeo = (x: Geo) => {
  const g = new THREE.BufferGeometry();
  for (const a of x.attrs) g.setAttribute(a.name, new THREE.BufferAttribute(new Float32Array(a.data), a.size));
  g.setIndex(new THREE.BufferAttribute(x.wide ? new Uint32Array(x.index) : new Uint16Array(x.index), 1));
  return g;
};
/** A fingerprint of everything a tree grows from. */
const fingerprint = (o: unknown) => {
  const text = `${KEEP_V}|${JSON.stringify(o)}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${text.length.toString(36)}`;
};
/** A bark's and a leaf's materials, from a tree with one bare stem (for a kept tree, not grown). */
const templateOf = (barkType: string, leafType: string) => {
  const t = new Tree!();
  const o = t.options as unknown as Options;
  o.bark.type = barkType;
  o.leaves.type = leafType;
  o.branch.levels = 0;
  o.leaves.count = 1;
  t.generate();
  return t;
};

/** A tree's three versions, at height 1 standing on the origin (grown once per spec). */
export const ezTree = (shape: TreeShape, spec: TreeSpec, detail: Detail): TreeProto => {
  const key = keyOf(spec);
  let g = grown.get(key);
  if (!g) {
    const t = prepare(spec);
    // (grown before, the same settings: kept in the browser; else grown now, and kept)
    const fp = fingerprint(t.options);
    const hit = kept.get(fp);
    let bark0: THREE.BufferGeometry, leaves0: THREE.BufferGeometry, levels: Kept["levels"], box: THREE.Box3;
    let made: EzTree | null = null;
    const madeOrTemplate = () => (made ??= templateOf(t.options.bark.type, t.options.leaves.type));
    if (hit) {
      bark0 = fromGeo(hit.bark);
      leaves0 = fromGeo(hit.leaves);
      levels = hit.levels;
      box = new THREE.Box3(new THREE.Vector3(hit.box[0], hit.box[1], hit.box[2]), new THREE.Vector3(hit.box[3], hit.box[4], hit.box[5]));
    } else {
      levels = timed("a tree model grown", () => grow(t)).levels;
      made = t;
      bark0 = t.branchesMesh.geometry as THREE.BufferGeometry;
      leaves0 = t.leavesMesh.geometry as THREE.BufferGeometry;
      box = new THREE.Box3().setFromObject(t);
      const bk = toGeo(bark0), lv = toGeo(leaves0);
      if (bk && lv) { const k: Kept = { k: fp, at: Date.now(), bark: bk, leaves: lv, levels, box: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], barkType: t.options.bark.type, leafType: t.options.leaves.type }; kept.set(fp, k); keepTree(k); }
    }
    // (bark keeps ez-tree's own colors on our growths only: its presets' tints are near white)
    const ownBark = CUSTOM[spec.preset] ? t.options.bark.tint : undefined;
    const barkMat = materialFor("bark", () => madeOrTemplate().branchesMesh.material as THREE.MeshPhongMaterial, `${t.options.bark.type}${ownBark ?? ""}`, ownBark);
    const leafMat = materialFor("leaves", () => madeOrTemplate().leavesMesh.material as THREE.MeshPhongMaterial, t.options.leaves.type);
    // (stood on its trunk's foot, the grower's origin, not its lowest point: branches starting low
    // on the trunk hang below it, and lifting the tree till their tips touched left the trunk in
    // the air; they meet the ground instead. Its height is its top's above that foot.)
    const foot = Math.max(0, box.min.y);
    const h = Math.max(0.01, box.max.y - foot), w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const bush = shape === "bush", pine = shape === "conifer";
    const thin = CUSTOM[spec.preset]?.thin;
    // The grown tree stood on its foot at height 1, once, in one pass over its corners (its versions
    // are made from it after: none moved and measured again, eight times over)
    for (const geo of [bark0, leaves0]) {
      const at = geo.getAttribute("position") as THREE.BufferAttribute, a = at.array as Float32Array, k = 1 / h, step = at.itemSize;
      for (let i = 0; i < a.length; i += step) { a[i] *= k; a[i + 1] = (a[i + 1] - foot) * k; a[i + 2] *= k; }
      at.needsUpdate = true;
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
    }
    const versions: [Detail, THREE.BufferGeometry, THREE.BufferGeometry][] = [
      ["near", bark0, leaves0],
      ["mid", barkUpTo(bark0, levels, 1), thinLeaves(leaves0, ...(thin?.[0] ?? (bush ? [4, 1.9] : leafThin.mid)))],
      ["far", barkUpTo(bark0, levels, pine ? 0 : 1), thinLeaves(leaves0, ...(thin?.[1] ?? (bush ? [12, 3.2] : leafThin.far)))],
      // (underbrush past arm's reach: the main stems and a few big leaf clusters; our own thin
      // growths, their leaves alone)
      ["brush", barkUpTo(bark0, levels, bush && !thin ? 1 : 0), thinLeaves(leaves0, ...(thin?.[2] ?? (bush ? [30, 5] : [40, 5.6])))]
    ];
    g = {} as Grown;
    for (const [d, bark, leaves] of versions) {
      for (const geo of [bark, leaves]) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        geo.userData.shared = true;
      }
      g[d] = { bark, leaves, needles: pine, barkMat, leafMat, natural: w / h };
    }
    grown.set(key, g);
    // (a tree's own shapes, set by hand, don't pile up: the oldest of those go)
    if (grown.size > 400) for (const k of grown.keys()) { if (grown.size <= 360) break; if (!POOL.has(k)) grown.delete(k); }
  }
  return g[detail];
};
const POOL = new Set<string>();

/** A pool variant's shape (what an untouched tree of the woods or the survey is). */
export const ezProto = (shape: TreeShape, variant: number, detail: Detail): TreeProto => {
  const spec = specOf(shape, variant);
  POOL.add(keyOf(spec));
  return ezTree(shape, spec, detail);
};

/** A tree's tint, made gentle for photographed leaves: toward the landscape's color, never dark.
 * A warm color (not green: autumn's, a dry landscape's browns) stays rich, as the leaves take it
 * whole (see the leaf material). */
export const ezTint = (tint: THREE.Color) => {
  const hsl = { h: 0, s: 0, l: 0 };
  tint.getHSL(hsl);
  // (reds lean a little toward orange, as fall leaves do: crimson reads as paint)
  if (hsl.s > 0.2 && (hsl.h < 0.16 || hsl.h > 0.9)) return new THREE.Color().setHSL(hsl.h > 0.9 ? 0.02 : Math.max(0.025, hsl.h + 0.01), Math.min(0.78, hsl.s * 1.1), Math.min(0.6, Math.max(0.45, hsl.l * 1.7)));
  // (olive, a dry landscape's: a little richer, so its leaves go dusty)
  if (hsl.h < 0.25) return new THREE.Color().setHSL(Math.max(0.15, hsl.h - 0.02), Math.min(0.4, hsl.s * 1.15), 0.4);
  const c = new THREE.Color().setHSL(hsl.h, Math.min(0.55, hsl.s * 0.8), 0.72);
  return new THREE.Color(1, 1, 1).lerp(c, 0.45);
};
