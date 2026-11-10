// Flyovers: the camera's path over a hole, flown by itself (from behind the tee, along the line of
// play, under the trees like a drone, toward the basket) or through keyframes made by hand. Pure: the
// map view draws the pictures, the Export step works out a video's length.
import type { CourseDoc, FlyKey, FlyoverSettings, P } from "../types";
import { pathLength, pointAlong } from "./geom";

export const FLYOVER_DEFAULTS: FlyoverSettings = { height: 10, speed: 1, fov: 62, behind: 60, side: 0, lookAhead: 120,
  title: true, badge: true, pinDistance: true, courseName: true, playLine: true, circle: true, ob: true, otherHoles: true, walks: true
};

/** The lens (field of view, degrees): its range everywhere it's set, from zoomed in to wide. */
export const LENS = { min: 15, max: 110 } as const;
/** A lens as it reads: "30° (zoomed in)", "62°", "95° (wide)". */
export const lensLabel = (v: number) => `${Math.round(v)}°${v < 40 ? " (zoomed in)" : v > 80 ? " (wide)" : ""}`;

/** A course's flyover settings, filled in (with a hole's own over them). */
export const flyoverOf = (doc: Pick<CourseDoc, "flyover">, hole?: { flyover?: Partial<FlyoverSettings> } | null): FlyoverSettings => ({ ...FLYOVER_DEFAULTS, ...doc.flyover, ...hole?.flyover });

/**
 * How a flight of `dur` seconds plays: its motion slowing gently to a stop over the end (the last
 * 2 s of it, at most a third, played over twice as long) and, by itself (`easeIn`), getting going
 * gently too. `play` is how long it plays; `at(t)` is where along the flight (s of its own time)
 * it is `t` s into playing. Speeds change smoothly: no jolt where the slowing starts or stops.
 */
export const flightClock = (dur: number, easeIn: boolean) => {
  const out = Math.min(2, dur / 3), into = easeIn ? Math.min(1, dur * 0.15) : 0;
  const cruise = dur - out - into;
  const play = dur + out + into;
  const at = (t: number) => {
    if (t <= 0) return 0;
    if (t >= play) return dur;
    // Getting going: speed rising 0 to 1 over 2 * into
    if (t < 2 * into) {
      const u = t / (2 * into);
      return 2 * into * (u / 2 - Math.sin(Math.PI * u) / (2 * Math.PI));
    }
    if (t < 2 * into + cruise) return into + (t - 2 * into);
    // Slowing: speed falling 1 to 0 over 2 * out
    const u = (t - 2 * into - cruise) / (2 * out);
    return into + cruise + 2 * out * (u / 2 + Math.sin(Math.PI * u) / (2 * Math.PI));
  };
  return { play, at };
};

/** A point in the air: plan x, y and its height z (ft, the terrain's datum). */
export type Air = { x: number; y: number; z: number };

/** A flight sampled evenly in time: where the camera is, what it looks at, its field of view. */
export type Flight = { cam: Air[]; look: Air[]; fov: number[]; dur: number };

/** A tree's crown: where its trunk stands, how far its leaves reach round it, and how high they
 * hang (from `base` to `top`, ft on the terrain's datum). */
export type Crown = { x: number; y: number; r: number; base: number; top: number };
/** What stands over a spot: the lowest foliage (ft, the terrain's datum: a building starts at the
 * ground), the highest top, the trunks close by, (when known) each tree's crown, and how high
 * anything built there stands (its roof, with room over it). */
export type Canopy = { base: number; top: number; trunks: P[]; crowns?: Crown[]; built?: number };
/** What stands over a point, within `reach` ft of it (null: open sky). */
export type Obstacles = (p: P, reach: number) => Canopy | null;

/** Seconds a hole of this length takes to fly over by itself. */
export const autoSeconds = (length: number, set: FlyoverSettings) => Math.min(14, Math.max(6, length / 70)) / Math.max(0.1, set.speed);

/** Samples a second of flight. */
const RATE = 30;

/** How far it keeps from leaves (ft) and from trunks; how far it slips sideways round a crown it
 * can't pass under (more than that: over it). */
const LEAVES = 5, TRUNKS = 7, AROUND = 15;
/** Flying under the trees, as a drone does (the flights made by themselves): how far it keeps under
 * the leaves, and how near the ground it goes to get under the lowest. */
const UNDER_LEAVES = 3, LOWEST = 4;

/** Where the camera must be in the air at a spot: no lower than `lo` (over a crown it can't pass
 * under, off the ground) and no higher than `hi` (under one it passes beneath), ft. `under`: never
 * over a tree, only over what's built; under the leaves, down to 4 ft off the ground when they
 * hang low (through the lowest of them, slipped round first where it can be). */
const limitsAt = (p: P, g: number, z: number, alt: number, obstacles: Obstacles, under = false) => {
  let lo = g + Math.min(4, alt), hi = Infinity, above = -Infinity;
  const c = obstacles(p, 4);
  if (under) {
    // (`through`: leaves hanging lower than it can get under)
    let through = false;
    if (c?.built !== undefined && z < c.built) lo = Math.max(lo, c.built);
    // (each crown, or where only how high they stand is known, all of them as one)
    const crowns = c ? c.crowns ?? (Number.isFinite(c.base) ? [{ x: p.x, y: p.y, r: 0, base: c.base, top: c.top }] : []) : [];
    for (const k of crowns) if (Math.hypot(p.x - k.x, p.y - k.y) < k.r + 4 && z + UNDER_LEAVES > k.base && z - UNDER_LEAVES < k.top) {
      if (k.base - UNDER_LEAVES < g + LOWEST) through = true;
      hi = Math.min(hi, Math.max(g + LOWEST, k.base - UNDER_LEAVES));
    }
    // (what's built wins: over a roof, whatever leaves hang there)
    if (hi < lo) hi = lo;
    return { lo, hi, above, through };
  }
  if (c && z + LEAVES > c.base && z - LEAVES < c.top) {
    // (`above`: how high it must be to go over them instead)
    above = c.top + LEAVES + 3;
    if (c.base - LEAVES >= g + 6) hi = c.base - LEAVES;
    else lo = Math.max(lo, above);
  }
  return { lo, hi, above, through: false };
};

/** How steeply it climbs or comes down round what's in the way (ft up per ft along), and how
 * sharply it slips aside (ft aside per ft along); how long (s) each bend into and out of them is
 * eased over (three times). */
const CLIMB = 0.3, SLIP = 0.2, EASE = 0.15;

/** How far apart a way's spots are (ft, from the one before). */
const steps = (spots: P[]) => spots.map((p, i) => (i ? Math.hypot(p.x - spots[i - 1].x, p.y - spots[i - 1].y) : 0));

/**
 * How far off its way the camera goes (ft, up or aside) to give each spot what it `need`s there:
 * that much for a moment either side of it, sloping off beyond (`slope` ft per ft along, at least
 * `least` ft a spot), its bends eased over `w` spots either side three times. Never less than
 * needed where it's needed (each held for as long as the easing reaches), and no sudden jolts.
 */
const swerve = (need: number[], ds: number[], slope: number, least: number, w: number) => {
  const n = need.length, hold = 3 * w;
  const env = need.map(() => 0);
  if (!need.some(v => v > 0)) return env;
  need.forEach((v, j) => {
    if (v > 0) for (let i = Math.max(0, j - hold); i <= Math.min(n - 1, j + hold); i++) env[i] = Math.max(env[i], v);
  });
  for (let i = 1; i < n; i++) env[i] = Math.max(env[i], env[i - 1] - Math.max(least, slope * ds[i]));
  for (let i = n - 2; i >= 0; i--) env[i] = Math.max(env[i], env[i + 1] - Math.max(least, slope * ds[i + 1]));
  // (held as it is past both ends: no bend where the easing meets them)
  let z = env;
  for (let pass = 0; pass < 3; pass++) {
    const ext = [...Array(w).fill(z[0]), ...z, ...Array(w).fill(z[n - 1])];
    z = smoothRun(ext, w, 1).slice(w, w + n);
  }
  return z;
};

/**
 * Heights along a camera's way, `rate` spots a second: `alt[i]` ft over the ground under it (the
 * ground's small bumps smoothed), under the leaves it passes beneath when there's room (a dip only
 * as deep as needed), over the ones it can't and never nearer the ground than 4 ft: climbing and
 * coming down in good time round each in smooth curves, then back to its height.
 */
const holdHeights = (spots: P[], alt: number[], rate: number, ground: (x: number, y: number) => number, obstacles: Obstacles, under = false) => {
  const g = spots.map(p => ground(p.x, p.y));
  const ds = steps(spots);
  const step = Math.max(0.5, ds.reduce((a, b) => a + b, 0) / Math.max(1, spots.length - 1));
  // (under the trees: the ground smoothed over longer, a drone's steady glide over its rises and
  // dips, never nearer it than 4 ft)
  const want = smoothEnds(g, Math.max(1, Math.round((under ? 30 : 8) / step)), 3).map((v, i) => v + alt[i]);
  const lim = spots.map((p, i) => limitsAt(p, g[i], want[i], alt[i], obstacles, under));
  const w = Math.max(1, Math.round(EASE * rate)), least = 6 / rate;
  const over = (i: number, above = lim[i].above) => {
    lim[i] = { lo: Math.max(lim[i].lo, above), hi: Infinity, above: Math.max(lim[i].above, above) };
  };
  let z = want;
  for (let round = 0; round < (under ? 1 : 12); round++) {
    const up = swerve(lim.map((l, i) => l.lo - want[i]), ds, CLIMB, least, w);
    const down = swerve(lim.map((l, i) => want[i] - l.hi), ds, CLIMB, least, w);
    z = want.map((v, i) => v + up[i] - down[i]);
    if (under) break;
    let changed = false;
    lim.forEach((l, i) => {
      // Where it climbs anyway it goes over the crowns there too, rather than dropping under them
      // between climbs; and over the ones whose dip would pull it under what it must go over
      if (Number.isFinite(l.hi) && up[i] > 1e-6) {
        over(i);
        changed = true;
      } else if (z[i] < l.lo - 1e-6) {
        for (const dir of [-1, 1]) for (let k = dir < 0 ? i : i + 1; k >= 0 && k < z.length && down[k] > 1e-6; k += dir) {
          if (Number.isFinite(lim[k].hi)) {
            over(k);
            changed = true;
          }
        }
      }
    });
    // (and over the leaves of anything at the height it now flies: climbing over a bush into a
    // tall tree's crown, say)
    if (!changed) spots.forEach((p, i) => {
      const at = limitsAt(p, g[i], z[i], alt[i], obstacles);
      if (at.above > z[i] + 1e-6 && (at.lo > z[i] + 1e-6 || at.hi < z[i] - 1e-6)) {
        over(i, at.above);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return z.map((v, i) => Math.max(Math.min(v, lim[i].hi), lim[i].lo));
};

/** The camera's way and heights: straight on, or slipped aside round what's in the way, whichever
 * keeps nearer its height over the ground all along (ducking under a crown, say, rather than
 * slipping aside into others it would have to climb over). */
const flyAlong = (spots: P[], alt: number[], rate: number, ground: (x: number, y: number) => number, obstacles: Obstacles, under = false) => {
  const off = (way: P[], z: number[]) => way.reduce((t, p, i) => t + Math.abs(z[i] - ground(p.x, p.y) - alt[i]), 0);
  const straight = { way: spots, z: holdHeights(spots, alt, rate, ground, obstacles, under) };
  const moved = slipAside(spots, alt, rate, ground, obstacles, under);
  if (moved === spots) return straight;
  const aside = { way: moved, z: holdHeights(moved, alt, rate, ground, obstacles, under) };
  return off(aside.way, aside.z) <= off(straight.way, straight.z) ? aside : straight;
};

/**
 * A camera's way moved aside round what's in the way at its height (`alt[i]` ft over the ground),
 * at most 15 ft: crowns whose leaves it would fly into (rather than duck under or climb over them)
 * and trunks of the trees it passes beneath. Aside in good time, as far as each needs, easing back
 * after, in smooth curves. Where there's no way round it stays put (to go under or over).
 */
const slipAside = (spots: P[], alt: number[], rate: number, ground: (x: number, y: number) => number, obstacles: Obstacles, under = false): P[] => {
  const w = Math.max(1, Math.round(EASE * rate)), least = 3 / rate;
  // (right of the way it flies, turning smoothly with it)
  const nrm = spots.map((_, i) => {
    const a = spots[Math.max(0, i - w)], b = spots[Math.min(spots.length - 1, i + w)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  });
  const push = spots.map((p, i) => {
    const g = ground(p.x, p.y), z = g + alt[i], n = nrm[i];
    const c = obstacles(p, AROUND + 4);
    if (c?.crowns) {
      const keep = c.crowns.map(k => (z + LEAVES > k.base && z - LEAVES < k.top ? k.r + 6 : z < k.top ? TRUNKS + 2 : 0));
      const clear = (l: number) => c.crowns!.every((k, j) => Math.hypot(p.x + n.x * l - k.x, p.y + n.y * l - k.y) >= keep[j]);
      if (clear(0)) return 0;
      for (let s = 1; s <= AROUND; s++) {
        const l = [s, -s].find(clear);
        if (l !== undefined) return l;
      }
      return 0;
    }
    // (only how high things stand known: eased off the trunks it passes beneath)
    let side = 0;
    if (c && z < c.top) for (const tr of obstacles(p, 4)?.trunks ?? []) {
      const dx = p.x - tr.x, dy = p.y - tr.y, dd = Math.hypot(dx, dy);
      if (dd < TRUNKS) side += (dx * n.x + dy * n.y >= 0 ? 1 : -1) * (TRUNKS - dd + 2);
    }
    return side;
  });
  if (push.every(v => !v)) return spots;
  const ds = steps(spots);
  const step = Math.max(0.5, ds.reduce((a, b) => a + b, 0) / Math.max(1, spots.length - 1));
  const place = () => {
    const right = swerve(push.map(v => Math.max(0, v)), ds, SLIP, least, w), left = swerve(push.map(v => Math.max(0, -v)), ds, SLIP, least, w);
    return spots.map((p, i) => ({ x: p.x + nrm[i].x * (right[i] - left[i]), y: p.y + nrm[i].y * (right[i] - left[i]) }));
  };
  // (how many spots a push moves it over, either side)
  const reaches = (v: number) => 6 * w + Math.ceil(Math.abs(v) / (SLIP * step));
  // (never aside into trees it would have to climb over where it went straight past them: then it
  // keeps its way there, to duck under what it slipped round)
  const over = (p: P, i: number) => {
    const g = ground(p.x, p.y);
    return limitsAt(p, g, g + alt[i], alt[i], obstacles, under).lo > g + alt[i] + 1e-6;
  };
  const was = spots.map(over);
  for (let round = 0; round < 12; round++) {
    const moved = place();
    let changed = false;
    moved.forEach((q, i) => {
      if (was[i] || !over(q, i)) return;
      push.forEach((v, j) => {
        if (v && Math.abs(i - j) <= reaches(v)) {
          push[j] = 0;
          changed = true;
        }
      });
    });
    if (!changed) return moved;
  }
  // (still into trees somewhere: its own way, then)
  return spots;
};

/** Eased from 0 (at `a`) to 1 (at `b`), no sudden start or stop. */
const smoothstep = (a: number, b: number, t: number) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** The view along a flight turning smoothly: what it looks at from each spot the same, its turns
 * (left and right, up and down) eased over about a third of a second. */
const finish = (cam: Air[], look: Air[], fov: number[], dur: number, rate: number): Flight => {
  const w = Math.max(1, Math.round(0.12 * rate));
  const yaw: number[] = [], pitch: number[] = [], far: number[] = [];
  look.forEach((l, i) => {
    const dx = l.x - cam[i].x, dy = l.y - cam[i].y, dz = l.z - cam[i].z;
    let a = Math.atan2(dy, dx);
    // (no jump where it turns past straight back)
    if (i) a += Math.round((yaw[i - 1] - a) / (2 * Math.PI)) * 2 * Math.PI;
    yaw.push(a);
    pitch.push(Math.atan2(dz, Math.hypot(dx, dy)));
    far.push(Math.max(1, Math.hypot(dx, dy, dz)));
  });
  const ys = smoothEnds(yaw, w, 3), ps = smoothEnds(pitch, w, 3);
  const seen = cam.map((c, i) => {
    const flat = Math.cos(ps[i]) * far[i];
    return { x: c.x + Math.cos(ys[i]) * flat, y: c.y + Math.sin(ys[i]) * flat, z: c.z + Math.sin(ps[i]) * far[i] };
  });
  return { cam, look: seen, fov, dur };
};

/**
 * The flight over a hole by itself, a low cinematic glide along its (smoothed) line of play, down
 * the fairway between the trees: from `behind` ft behind the tee, `side` ft off the line, `height`
 * ft over the ground the whole way, looking `lookAhead` ft down the hole, then (turning gently) at
 * the basket, like a drone: never over the trees, only over what's built. A crown in its way it
 * slips round (15 ft aside at most), else ducks under it (down to 4 ft off the ground); it eases
 * round trunks; all in smooth curves, back to its height after.
 */
export const autoFlight = (line: P[], set: FlyoverSettings, ground: (x: number, y: number) => number, obstacles: Obstacles = () => null): Flight | null => {
  if (line.length < 2) return null;
  const len = pathLength(line);
  if (len < 1) return null;
  const start = line[0], end = line[line.length - 1];
  const a0 = pointAlong(line, 0).angle;
  const H = Math.max(1, set.height);
  const back = (d: number) => {
    const p = { x: start.x + Math.cos(a0) * d - Math.sin(a0) * set.side, y: start.y + Math.sin(a0) * d + Math.cos(a0) * set.side };
    const g = ground(p.x, p.y);
    return { p, g, ...limitsAt(p, g, g + H, H, obstacles, true) };
  };
  // From behind the tee, unless something built stands there or leaves hang too low to get
  // under: then from just past them
  let behind = Math.max(0, set.behind);
  for (let d = -behind; d < 0; d += 8) {
    const b = back(d);
    if (b.lo > b.g + H + 1e-6 || b.through) behind = Math.max(0, -d - 8);
  }
  const dur = autoSeconds(len, set);
  const n = Math.max(60, Math.ceil(dur * RATE));
  // (to a few steps short of the basket: big in the picture at the end)
  const short = Math.min(16, len / 4);
  const step = (len - short + behind) / n;
  const reachAhead = Math.max(30, set.lookAhead) * Math.max(1, len / 350);
  const spots: P[] = [];
  const look: Air[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = -behind + t * (len - short + behind);
    const at = d < 0 ? { point: { x: start.x + Math.cos(a0) * d, y: start.y + Math.sin(a0) * d }, angle: a0 } : pointAlong(line, d);
    // Off to the side (right of the way it flies)
    const nrm = { x: -Math.sin(at.angle), y: Math.cos(at.angle) };
    const p = { x: at.point.x + nrm.x * set.side, y: at.point.y + nrm.y * set.side };
    spots.push(p);
    // (down the hole, then turning gently to the basket)
    const ahead = pointAlong(line, Math.min(len, Math.max(0, d) + reachAhead)).point;
    const b = smoothstep(0.55, 0.9, t);
    const toward = { x: ahead.x + (end.x - ahead.x) * b, y: ahead.y + (end.y - ahead.y) * b };
    look.push({ ...toward, z: ground(toward.x, toward.y) + 3 });
  }
  // (the line's corners rounded off)
  const sw = Math.max(1, Math.round(0.1 * RATE)), sx = smoothEnds(spots.map(p => p.x), sw, 3), sy = smoothEnds(spots.map(p => p.y), sw, 3);
  // Round what's in the way, then the height over the ground there
  const { way, z } = flyAlong(spots.map((_, i) => ({ x: sx[i], y: sy[i] })), spots.map(() => H), n / dur, ground, obstacles, true);
  const cam: Air[] = way.map((p, i) => ({ ...p, z: z[i] }));
  // (and what it looks at rises and falls gently with the ground)
  const lz = smoothEnds(look.map(l => l.z), Math.max(2, Math.round(Math.max(40, len * 0.1) / Math.max(1, step))), 3);
  look.forEach((l, i) => (l.z = lz[i]));
  return finish(cam, look, cam.map(() => set.fov), dur, n / dur);
};

/** Values smoothed over `w` samples either side (`passes` of a running mean). */
const smoothRun = (v: number[], w: number, passes = 3) => {
  let z = v;
  for (let pass = 0; pass < passes; pass++) {
    const sum = [0];
    for (const x of z) sum.push(sum[sum.length - 1] + x);
    z = z.map((_, i) => {
      const a = Math.max(0, i - w), b = Math.min(z.length - 1, i + w);
      return (sum[b + 1] - sum[a]) / (b - a + 1);
    });
  }
  return z;
};

/** The same, carried on past both ends as they run there (so the ends stay where they are and
 * aren't pulled up or down). */
const smoothEnds = (v: number[], w: number, passes = 3) => {
  const n = v.length;
  if (n < 3) return v.slice();
  const pad = Math.min(n - 1, w);
  let z = v;
  for (let pass = 0; pass < passes; pass++) {
    const first = z[0], last = z[n - 1];
    const ext = [...z.slice(1, pad + 1).reverse().map(x => 2 * first - x), ...z, ...z.slice(n - 1 - pad, n - 1).reverse().map(x => 2 * last - x)];
    z = smoothRun(ext, w, 1).slice(pad, pad + n);
  }
  return z;
};

/** Seconds from each keyframe to the next: its own (`secs`), as the timeline shows them (the
 * flyover's Speed is for a hole flying by itself), or at the pace a hole flies by itself. */
export const keySeconds = (keys: FlyKey[], _set: FlyoverSettings, ground: (x: number, y: number) => number) =>
  keys.slice(1).map((k, i) => {
    if (k.secs && k.secs > 0) return k.secs;
    const a = keys[i];
    const d = Math.hypot(k.x - a.x, k.y - a.y, ground(k.x, k.y) + k.alt - (ground(a.x, a.y) + a.alt));
    return Math.max(0.5, (d / 70) * 1.6);
  });

/**
 * A keyframed flight saved before Speed and the flyover's Lens stopped applying to keyframes:
 * each keyframe given the seconds and lens it flew with (Speed `speed`, Lens `fov`), so it flies
 * just as it did. (Seconds by the pace alone where a keyframe had none: the ground's rise
 * between them isn't known here.)
 */
export const keysAsTheyFlew = (keys: FlyKey[], speed: number, fov: number): FlyKey[] => {
  const sp = Math.max(0.1, speed), r1 = (v: number) => Math.round(v * 10) / 10;
  return keys.map((k, i) => {
    const out = { ...k, ...(k.fov === undefined ? { fov: Math.round(fov) } : {}) };
    if (!i || sp === 1) return out;
    const a = keys[i - 1];
    const secs = k.secs && k.secs > 0 ? k.secs : Math.max(0.5, (Math.hypot(k.x - a.x, k.y - a.y, k.alt - a.alt) / 70) * 1.6);
    return { ...out, secs: r1(secs / sp) };
  });
};

/** A smooth curve through values `ys` at `xs` (rising) that never overshoots between them
 * (Steffen's monotone cubic): its value at `x`. */
const monotone = (xs: number[], ys: number[]) => {
  const n = xs.length;
  const h = xs.slice(1).map((x, i) => x - xs[i]);
  const s = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi);
  const sign = Math.sign;
  const d = ys.map((_, i) => {
    if (n < 3) return s[0];
    if (i === 0 || i === n - 1) {
      const [a, b, ha, hb] = i === 0 ? [s[0], s[1], h[0], h[1]] : [s[n - 2], s[n - 3], h[n - 2], h[n - 3]];
      const p = a * (1 + ha / (ha + hb)) - (b * ha) / (ha + hb);
      return p * a <= 0 ? 0 : Math.abs(p) > 2 * Math.abs(a) ? 2 * a : p;
    }
    const p = (s[i - 1] * h[i] + s[i] * h[i - 1]) / (h[i - 1] + h[i]);
    return (sign(s[i - 1]) + sign(s[i])) * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p));
  });
  return (x: number) => {
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const u = Math.min(1, Math.max(0, (x - xs[k]) / h[k])), u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h[k] * d[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h[k] * d[k + 1];
  };
};

/** A point on a smooth curve through points (centripetal Catmull-Rom: no loops or kinks where they
 * bunch up), `u` (0..1) of the way from point i to point i + 1. */
const curveAt = (pts: P[], i: number, u: number): P => {
  const p1 = pts[i], p2 = pts[i + 1];
  // (past the ends: carried on straight)
  const p0 = i > 0 ? pts[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
  const p3 = i + 2 < pts.length ? pts[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
  const knot = (a: P, b: P) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const t = t1 + u * (t2 - t1);
  const mix = (a: P, b: P, ta: number, tb: number) => {
    const f = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const a1 = mix(p0, p1, 0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
  return mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2);
};

/** Travelling along a smooth curve through points, at each at its moment (`at`, s), the speed
 * changing smoothly through them: where it is at time t. */
const timed = (pts: P[], at: number[]) => {
  const m = 160;
  const curve: P[] = [pts[0]], along = [0];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 1; k <= m; k++) {
    const q = k === m ? pts[i + 1] : curveAt(pts, i, k / m), last = curve[curve.length - 1];
    along.push(along[along.length - 1] + Math.hypot(q.x - last.x, q.y - last.y));
    curve.push(q);
  }
  const travel = monotone(at, pts.map((_, i) => along[i * m]));
  return (t: number): P => {
    const s = travel(t);
    let lo = 0, hi = along.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = along[hi] > along[lo] ? (s - along[lo]) / (along[hi] - along[lo]) : 0;
    if (f >= 1) return curve[hi];
    if (f <= 0) return curve[lo];
    return { x: curve[lo].x + (curve[hi].x - curve[lo].x) * f, y: curve[lo].y + (curve[hi].y - curve[lo].y) * f };
  };
};

/** The flight through keyframes made by hand: a smooth curve through the camera's spots and one
 * through what it looks at, at each keyframe on its seconds, the speed changing smoothly through
 * them; its height and field of view eased from one to the next. */
export const keyFlight = (keys: FlyKey[], set: FlyoverSettings, ground: (x: number, y: number) => number, obstacles: Obstacles = () => null): Flight | null => {
  if (keys.length < 2) return null;
  const secs = keySeconds(keys, set, ground);
  const at = [0];
  for (const s of secs) at.push(at[at.length - 1] + s);
  const dur = at[at.length - 1];
  const n = Math.max(60, Math.ceil(dur * RATE));
  const camAt = timed(keys.map(k => ({ x: k.x, y: k.y })), at), lookAt = timed(keys.map(k => ({ x: k.lookX, y: k.lookY })), at);
  // (the camera goes exactly where each keyframe puts it, as high as it says, and between two it
  // goes smoothly from one height to the next, like a drone between waypoints: never lifted or
  // turned aside by what it thinks is in the way, so what's set is what flies. Only the ground
  // itself keeps it up: a rise between two keyframes, it stays a few feet over)
  const zAt = monotone(at, keys.map(k => ground(k.x, k.y) + k.alt)), fovAt = monotone(at, keys.map(k => k.fov ?? set.fov));
  const lookZ = monotone(at, keys.map(k => ground(k.lookX, k.lookY) + (k.lookAlt ?? 3)));
  const cam: Air[] = [], look: Air[] = [], fov: number[] = [];
  for (let j = 0; j <= n; j++) {
    const t = (j / n) * dur, p = camAt(t);
    cam.push({ ...p, z: Math.max(zAt(t), ground(p.x, p.y) + 4) });
    look.push({ ...lookAt(t), z: lookZ(t) });
    fov.push(fovAt(t));
  }
  return finish(cam, look, fov, dur, n / dur);
};

/** Keyframes to start from: the flight it flies by itself, at a few moments (to change by hand),
 * each `alt` ft up (the flyover's height; unset: as high as that flight is there), under or over
 * the leaves of what stands there as the flight itself goes. */
export const keysFromFlight = (f: Flight, ground: (x: number, y: number) => number, count = 4, alt?: number, obstacles: Obstacles = () => null): FlyKey[] =>
  Array.from({ length: count }, (_, k) => {
    const i = Math.round((k / (count - 1)) * (f.cam.length - 1));
    const c = f.cam[i], l = f.look[i];
    const g = ground(c.x, c.y);
    let up = alt ?? c.z - g;
    const o = alt === undefined ? null : obstacles(c, 4);
    if (o && g + up + LEAVES > o.base && g + up - LEAVES < o.top) up = o.base - LEAVES >= g + 6 ? o.base - LEAVES - g : o.top + LEAVES + 3 - g;
    return { x: round1(c.x), y: round1(c.y), alt: round1(up), lookX: round1(l.x), lookY: round1(l.y) };
  });

/** When each keyframe comes, s from the start (the first at 0). */
export const keyTimes = (keys: FlyKey[], set: FlyoverSettings, ground: (x: number, y: number) => number) => {
  const at = [0];
  for (const s of keySeconds(keys, set, ground)) at.push(at[at.length - 1] + s);
  return at;
};

/** The keyframes with one more after keyframe `i`: where the flight already is halfway to the
 * next, so the flight stays as it was (and the two halves take the time the whole did). After the
 * last, carried on a bit the way the flight was going. Returns the keys and the new one's place. */
export const insertKey = (keys: FlyKey[], i: number, set: FlyoverSettings, ground: (x: number, y: number) => number): { keys: FlyKey[]; at: number } => {
  if (keys.length < 2) return { keys, at: -1 };
  const r = (k: FlyKey): FlyKey => ({ ...k, x: round1(k.x), y: round1(k.y), alt: round1(k.alt), lookX: round1(k.lookX), lookY: round1(k.lookY), ...(k.lookAlt !== undefined ? { lookAlt: round1(k.lookAlt) } : {}) });
  if (i >= keys.length - 1) {
    const a = keys[keys.length - 2], b = keys[keys.length - 1];
    const next = r({ ...b, x: 2 * b.x - a.x, y: 2 * b.y - a.y, lookX: 2 * b.lookX - a.lookX, lookY: 2 * b.lookY - a.lookY, secs: undefined });
    return { keys: [...keys, next], at: keys.length };
  }
  const f = keyFlight(keys, set, ground);
  const times = keyTimes(keys, set, ground);
  if (!f) return { keys: [...keys.slice(0, i + 1), keyBetween(keys[i], keys[i + 1]), ...keys.slice(i + 1)], at: i + 1 };
  const t = (times[i] + times[i + 1]) / 2;
  const j = Math.round((t / f.dur) * (f.cam.length - 1));
  const c = f.cam[j], l = f.look[j];
  const fov = keys[i].fov === undefined && keys[i + 1].fov === undefined ? undefined : f.fov[j];
  const half = (times[i + 1] - times[i]) / 2;
  const mid = r({ x: c.x, y: c.y, alt: c.z - ground(c.x, c.y), lookX: l.x, lookY: l.y, lookAlt: l.z - ground(l.x, l.y), ...(fov !== undefined ? { fov: Math.round(fov) } : {}), secs: Math.round(half * 10) / 10 });
  const after = { ...keys[i + 1], secs: Math.round(half * 10) / 10 };
  return { keys: [...keys.slice(0, i + 1), mid, after, ...keys.slice(i + 2)], at: i + 1 };
};

/** Where a keyframed flight's camera is `t` seconds in, looking where it looks, as a keyframe (to
 * put the camera there, scrubbing the timeline). */
export const flightAt = (f: Flight, t: number, ground: (x: number, y: number) => number): FlyKey => {
  const j = Math.max(0, Math.min(f.cam.length - 1, Math.round((t / Math.max(0.001, f.dur)) * (f.cam.length - 1))));
  const c = f.cam[j], l = f.look[j];
  return { x: round1(c.x), y: round1(c.y), alt: round1(c.z - ground(c.x, c.y)), lookX: round1(l.x), lookY: round1(l.y), lookAlt: round1(l.z - ground(l.x, l.y)), fov: Math.round(f.fov[j]) };
};

/** The keyframes with `key` added `t` seconds into the flight: between the two either side, the
 * time between them split at `t`, so the rest of the flight keeps its timing; past the end, after
 * the last. Returns the keys and the new one's place. */
export const insertKeyAt = (keys: FlyKey[], t: number, key: FlyKey, set: FlyoverSettings, ground: (x: number, y: number) => number): { keys: FlyKey[]; at: number } => {
  const times = keyTimes(keys, set, ground);
  const i = times.findIndex((x, j) => j + 1 < times.length && t >= x && t < times[j + 1]);
  if (i < 0) return { keys: [...keys, key], at: keys.length };
  const r = (x: number) => Math.round(Math.max(0.2, x) * 10) / 10;
  const mid = { ...key, secs: r(t - times[i]) };
  const after = { ...keys[i + 1], secs: r(times[i + 1] - t) };
  return { keys: [...keys.slice(0, i + 1), mid, after, ...keys.slice(i + 2)], at: i + 1 };
};

/** A keyframe halfway between two (to add one). */
export const keyBetween = (a: FlyKey, b: FlyKey): FlyKey => ({
  x: round1((a.x + b.x) / 2), y: round1((a.y + b.y) / 2), alt: round1((a.alt + b.alt) / 2),
  lookX: round1((a.lookX + b.lookX) / 2), lookY: round1((a.lookY + b.lookY) / 2)
});

const round1 = (v: number) => Math.round(v * 10) / 10;
