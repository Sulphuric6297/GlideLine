// The import's sound: music played softly from the moment a site is asked for till it's brought
// in (quieter once the build is done, fading out as Design begins), a rush of air as the trees
// come up, and a chime as the build ends. Off with one switch, remembered. A sound that isn't
// there (the music and the chime are kept out of the public code: see public/sound/README.md) is
// simply not played.
//
// The music is a file played as it loads. The two effects are fetched and made ready at the
// import's press, so each sounds the instant it's asked for (and from where its sound begins, past
// the silence at its start).
const KEY = "dg-import-sound";
const MUSIC = `${import.meta.env.BASE_URL}zz-import-music.mp3`, TREES = `${import.meta.env.BASE_URL}sound/import-trees.mp3`;
const CHIME = `${import.meta.env.BASE_URL}zz-import-chime.mp3`;
const MUSIC_VOLUME = 0.12, MUSIC_DIMMED = 0.05;
/** Each effect: where its sound begins in its file (s), and how loud (all of it subtle: under the
 * music, never over it). */
const FX = { [TREES]: { from: 0.3, gain: 0.11 }, [CHIME]: { from: 0.42, gain: 1.0 } };

/** How many of each sound have been asked for, for tests. */
const made: Record<string, number> = {};
const count = (k: string) => { made[k] = (made[k] ?? 0) + 1; };

export const importSoundOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };

/** A sound's loudness eased to `to` over `ms` (one easing at a time for each sound). */
const fades = new WeakMap<HTMLAudioElement, number>();
const fade = (el: HTMLAudioElement, to: number, ms: number, then?: () => void) => {
  window.clearInterval(fades.get(el));
  const from = el.volume, t0 = performance.now();
  const id = window.setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
    el.volume = Math.max(0, Math.min(1, from + (to - from) * u));
    if (u >= 1) { window.clearInterval(id); then?.(); }
  }, 40);
  fades.set(el, id);
};

// --- the effects, ready before they're wanted
let ctx: AudioContext | null = null;
const ready = new Map<string, AudioBuffer>(), asked = new Set<string>();
const sounding = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();
const prepare = () => {
  const AC = typeof window === "undefined" ? undefined : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  void ctx.resume().catch(() => { /* not allowed yet */ });
  for (const url of [TREES, CHIME]) {
    if (asked.has(url)) continue;
    asked.add(url);
    fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("not there")))).then(b => ctx!.decodeAudioData(b)).then(buf => { ready.set(url, buf); }).catch(() => { asked.delete(url); });
  }
};
/** An effect, at once; `hold`: faded out after that many seconds, over `out`. */
const play = (url: string, hold?: number, out = 1.6) => {
  const buf = ready.get(url), fx = FX[url];
  if (!ctx || !buf || !fx || !importSoundOn()) return null;
  const src = ctx.createBufferSource(), gain = ctx.createGain(), one = { src, gain };
  src.buffer = buf; gain.gain.value = fx.gain;
  src.connect(gain); gain.connect(ctx.destination);
  src.onended = () => { sounding.delete(one); };
  sounding.add(one);
  src.start(0, Math.min(fx.from, Math.max(0, buf.duration - 0.1)));
  if (hold !== undefined) { const t = ctx.currentTime + hold; gain.gain.setValueAtTime(fx.gain, t); gain.gain.linearRampToValueAtTime(0, t + out); src.stop(t + out + 0.05); }
  return one;
};

// --- the music
let music: HTMLAudioElement | null = null, leaving = false;
/** The music, from quiet, round and round, and the effects made ready (asked for from a press, as
 * browsers want). */
export const startImportMusic = () => {
  if (!importSoundOn() || typeof Audio === "undefined") return;
  prepare();
  if (music && !leaving) return;
  if (music) { window.clearInterval(fades.get(music)); music.pause(); }
  const el = new Audio(MUSIC);
  el.loop = true; el.volume = 0; leaving = false; music = el;
  void el.play().then(() => fade(el, MUSIC_VOLUME, 2600)).catch(() => { if (music === el) music = null; });
};
/** The music faded away over `ms` (asked for again while it's fading: left to fade as it is). */
export const stopImportMusic = (ms = 3000) => {
  const el = music;
  if (!el || leaving) return;
  leaving = true;
  fade(el, 0, ms, () => { el.pause(); if (music === el) { music = null; leaving = false; } });
};

/** The build's end: a chime, as the music dims (it plays on, quieter, while the site is looked over). */
export const playImportChime = () => {
  if (!importSoundOn()) return;
  count("chime");
  if (music && !leaving) fade(music, MUSIC_DIMMED, 2800);
  // (the note itself, then quickly away: the recording has people talking behind it as it rings on)
  play(CHIME, 1.4, 1.8);
};

let rush: object | null = null;
/** The rush of air as trees come up, swelling for about as long as they take (not over one still
 * sounding). */
export const playTreesSound = (seconds: number) => {
  if (rush && sounding.has(rush as never)) return;
  count("trees");
  // (fading over the last of their growing: silent as the last tree is up)
  const out = Math.min(0.8, seconds * 0.4);
  rush = play(TREES, Math.max(0.1, seconds - out), out);
};

/** The import's sound on or off, remembered; off, whatever is sounding stops. */
export const setImportSound = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* no storage */ }
  if (on) { startImportMusic(); return; }
  if (music) { leaving = false; stopImportMusic(350); }
  if (bus && ctx) { const b = bus; b.gain.setValueAtTime(0, ctx.currentTime); window.setTimeout(() => { b.gain.value = 1; }, 3000); }
  for (const one of sounding) { try { one.gain.gain.cancelScheduledValues(0); one.gain.gain.value = 0; one.src.stop(); } catch { /* ended already */ } }
};

// --- the other parts' sounds: made here, not recorded (nothing to fetch, each as long as its part
// takes), in the music's own key (C major), all of them under it

let bus: GainNode | null = null, hiss: AudioBuffer | null = null;
/** Where the made sounds go: straight out, and through a soft, long echo of a room. */
const mix = () => {
  if (!ctx) return null;
  if (!bus) {
    bus = ctx.createGain(); bus.gain.value = 1; bus.connect(ctx.destination);
    const n = Math.floor(ctx.sampleRate * 2.6), room = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = room.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3.4; }
    const echo = ctx.createConvolver(), wet = ctx.createGain();
    echo.buffer = room; wet.gain.value = 0.5;
    bus.connect(echo); echo.connect(wet); wet.connect(ctx.destination);
  }
  return bus;
};
const air = () => {
  if (!hiss && ctx) { const n = ctx.sampleRate * 2; hiss = ctx.createBuffer(1, n, ctx.sampleRate); const d = hiss.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
  return hiss;
};
/** A loudness that rises to `peak`, holds, and falls away. */
const swell = (g: GainNode, t0: number, peak: number, up: number, hold: number, down: number) => {
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + up); g.gain.setValueAtTime(peak, t0 + up + hold); g.gain.linearRampToValueAtTime(0, t0 + up + hold + down);
};
/** Air through a filter, from `t0` for `len` seconds. */
const breath = (to: AudioNode, t0: number, len: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q = 0.8) => {
  const c = ctx!, src = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
  src.buffer = air(); src.loop = true; flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t0); flt.frequency.exponentialRampToValueAtTime(f1, t0 + len);
  swell(g, t0, peak, len * 0.35, len * 0.2, len * 0.45);
  src.connect(flt); flt.connect(g); g.connect(to);
  src.start(t0); src.stop(t0 + len + 0.05);
  return flt;
};
/** A plain tone, from `t0`: up in `up`, away over `down`. */
const tone = (to: AudioNode, t0: number, hz: number, peak: number, up: number, down: number, hz1 = hz) => {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(hz, t0); if (hz1 !== hz) o.frequency.exponentialRampToValueAtTime(hz1, t0 + up + down);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + up); g.gain.exponentialRampToValueAtTime(0.0001, t0 + up + down);
  o.connect(g); g.connect(to);
  o.start(t0); o.stop(t0 + up + down + 0.05);
};
// (C major's five easy notes, low to high)
const NOTES = [392, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];

let lastNote = 0;
/** One building's note, the next one up the scale each time (never two at once). */
export const playImportNote = (i: number) => {
  if (!importSoundOn()) return;
  const to = mix();
  if (!ctx || !to || ctx.currentTime - lastNote < 0.1) return;
  lastNote = ctx.currentTime;
  count("note");
  const hz = NOTES[i % NOTES.length], t0 = ctx.currentTime + 0.01;
  tone(to, t0, hz, 0.014, 0.006, 0.8); tone(to, t0, hz * 2, 0.0035, 0.006, 0.42);
};

/** A part's own sound as it comes in, for about as long as it takes (`n`: how many buildings):
 * the photo a far shimmer, the ground a low swell, the water a wash with a few drops, the paths a
 * stroke of air, the buildings a soft note each. */
export const playImportFx = (part: "photo" | "ground" | "water" | "paths" | "build", seconds: number, n = 0) => {
  if (!importSoundOn()) return;
  const to = mix();
  if (!ctx || !to) return;
  const t0 = ctx.currentTime + 0.02, len = Math.max(0.6, seconds);
  count(part);
  if (part === "photo") {
    for (const [hz, k] of [[659.25, 0], [783.99, 1], [1046.5, 2]] as const) tone(to, t0 + k * 0.12, hz, 0.005, 0.5, 1.5);
  } else if (part === "ground") {
    breath(to, t0, len, 0.03, "lowpass", 140, 330);
    tone(to, t0, 130.81, 0.012, len * 0.45, len * 0.55); tone(to, t0, 196, 0.008, len * 0.5, len * 0.5);
  } else if (part === "water") {
    const flt = breath(to, t0, len, 0.014, "bandpass", 1100, 1700, 0.9), lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 0.7; depth.gain.value = 380; lfo.connect(depth); depth.connect(flt.frequency); lfo.start(t0); lfo.stop(t0 + len + 0.05);
    for (let k = 0; k < 3; k++) tone(to, t0 + len * (0.18 + 0.27 * k), 1568 - k * 140, 0.007, 0.012, 0.22, 1046.5 - k * 90);
  } else if (part === "paths") {
    breath(to, t0, len, 0.013, "bandpass", 520, 2300, 1.3);
  } else {
    const k = Math.max(1, Math.min(NOTES.length, n || 1));
    for (let i = 0; i < k; i++) { const at = t0 + (len * 0.8 * i) / k; tone(to, at, NOTES[i], 0.014, 0.006, 0.75); tone(to, at, NOTES[i] * 2, 0.0035, 0.006, 0.4); }
  }
};

if (typeof window !== "undefined") (window as unknown as { __dgImportSound: unknown }).__dgImportSound = () => ({ made: { ...made }, music: music ? { volume: Math.round(music.volume * 1000) / 1000, paused: music.paused, leaving } : null, effectsReady: ready.size, sounding: sounding.size });
