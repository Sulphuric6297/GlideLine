// The import's sound: music played softly from the moment a site is asked for till it's brought
// in (quieter once the build is done, fading out as Design begins), a rush of air as the trees
// come up, and a chime as the build ends. Off with one switch, remembered. A sound that isn't
// there (the chime is kept out of the public code: see public/sound/README.md) is simply not
// played.
//
// The music is a file played as it loads, from past its slow opening (MUSIC_FROM), faded in
// slowly; near its own ending it goes round to that spot again, never through the quiet at its end. The two effects are fetched and made ready at the
// import's press, so each sounds the instant it's asked for (and from where its sound begins, past
// the silence at its start).
const KEY = "dg-import-sound";
const MUSIC = `${import.meta.env.BASE_URL}sound/import-music.mp3`, TREES = `${import.meta.env.BASE_URL}sound/import-trees.mp3`;
const CHIME = `${import.meta.env.BASE_URL}zz-import-chime.mp3`;
const MUSIC_VOLUME = 0.12, MUSIC_DIMMED = 0.05;
/** Where the music starts (s: just past its slow build, at the quiet before it swells), where it
 * goes round to that spot (as its ending fades, already quiet), and how slowly it comes in (ms). */
const MUSIC_FROM = 88, MUSIC_ROUND = 250, MUSIC_IN = 8000;
/** Each effect: where its sound begins in its file (s), and how loud (all of it subtle: under the
 * music, never over it). */
const FX = { [TREES]: { from: 0.3, gain: 0.11 }, [CHIME]: { from: 0.42, gain: 1.0 } };

/** How many of each sound have been asked for, for tests. */
const made: Record<string, number> = {};
const count = (k: string) => { made[k] = (made[k] ?? 0) + 1; };

export const importSoundOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };

/** A sound's loudness eased to `to` over `ms` (one easing at a time for each sound). */
const fades = new WeakMap<HTMLAudioElement, number>();
const fade = (el: HTMLAudioElement, to: number, ms: number, then?: () => void, ease = false) => {
  window.clearInterval(fades.get(el));
  const from = el.volume, t0 = performance.now();
  const id = window.setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
    el.volume = Math.max(0, Math.min(1, from + (to - from) * (ease ? u * u : u)));
    if (u >= 1) { window.clearInterval(id); then?.(); }
  }, 40);
  fades.set(el, id);
};

// --- the effects, ready before they're wanted. Played as plain audio, as the music is (a sound
// made ready through the page's audio graph can be held back on a phone, unheard); fetched at the
// press, so each starts the moment it's asked for, from where its sound begins.
let ctx: AudioContext | null = null;
const loaded = new Map<string, HTMLAudioElement>();
type One = { el: HTMLAudioElement };
const sounding = new Set<One>();
const prepare = () => {
  const AC = typeof window === "undefined" ? undefined : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC && !ctx) ctx = new AC();
  if (ctx) void ctx.resume().catch(() => { /* not allowed yet */ });
  if (typeof Audio === "undefined") return;
  for (const url of [TREES, CHIME]) {
    if (loaded.has(url)) continue;
    const el = new Audio(url);
    el.preload = "auto";
    el.load();
    loaded.set(url, el);
  }
};
const ready = { get size() { return [...loaded.values()].filter(e => e.readyState >= 3).length; } };
/** An effect, at once; `hold`: faded out after that many seconds, over `out`. */
const play = (url: string, hold?: number, out = 1.6) => {
  const fx = FX[url];
  if (!fx || !importSoundOn() || typeof Audio === "undefined") return null;
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
  const first = loaded.get(url), el = first && first.paused ? first : new Audio(url);
  if (!loaded.has(url)) loaded.set(url, el);
  const one: One = { el };
  window.clearInterval(fades.get(el));
  el.volume = Math.min(1, fx.gain);
  try { el.currentTime = fx.from; } catch { /* not seekable yet: from its start */ }
  const done = () => { el.pause(); sounding.delete(one); };
  el.onended = done;
  sounding.add(one);
  void el.play().catch(done);
  if (hold !== undefined) window.setTimeout(() => { if (sounding.has(one)) fade(el, 0, out * 1000, done); }, hold * 1000);
  return one;
};

// --- the music
let music: HTMLAudioElement | null = null, leaving = false, musicTo = MUSIC_VOLUME;
/** The music, from quiet, round and round, and the effects made ready (asked for from a press, as
 * browsers want). */
export const startImportMusic = () => {
  if (!importSoundOn() || typeof Audio === "undefined") return;
  prepare();
  if (music && !leaving) return;
  if (music) { window.clearInterval(fades.get(music)); music.pause(); }
  // (the start as a media fragment: honoured before the file has loaded, as currentTime isn't)
  const el = new Audio(`${MUSIC}#t=${MUSIC_FROM}`);
  el.volume = 0; leaving = false; music = el; musicTo = MUSIC_VOLUME;
  const round = () => {
    if (music !== el || leaving) return;
    el.volume = 0; el.currentTime = MUSIC_FROM;
    if (el.paused) void el.play().catch(() => undefined);
    fade(el, musicTo, MUSIC_IN, undefined, true);
  };
  el.addEventListener("timeupdate", () => { if (el.currentTime >= MUSIC_ROUND) round(); });
  el.addEventListener("ended", round);
  void el.play().then(() => fade(el, MUSIC_VOLUME, MUSIC_IN, undefined, true)).catch(() => { if (music === el) music = null; });
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
  if (music && !leaving) { musicTo = MUSIC_DIMMED; fade(music, MUSIC_DIMMED, 2800); }
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
  for (const one of sounding) { const el = one.el; fade(el, 0, 250, () => { el.pause(); sounding.delete(one); }); }
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
 * the photo a far shimmer, the ground a low swell, the water a soft wash, the paths a
 * stroke of air, the buildings a soft note each. */
export const playImportFx = (part: "photo" | "ground" | "water" | "paths" | "build", seconds: number, n = 0) => {
  if (!importSoundOn()) return;
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
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
    // (no drops: falling notes that short sound like a bird)
    breath(to, t0 + len * 0.15, len * 0.85, 0.008, "lowpass", 420, 300, 0.7);
  } else if (part === "paths") {
    breath(to, t0, len, 0.013, "bandpass", 520, 2300, 1.3);
  } else {
    const k = Math.max(1, Math.min(NOTES.length, n || 1));
    for (let i = 0; i < k; i++) { const at = t0 + (len * 0.8 * i) / k; tone(to, at, NOTES[i], 0.014, 0.006, 0.75); tone(to, at, NOTES[i] * 2, 0.0035, 0.006, 0.4); }
  }
};

if (typeof window !== "undefined") (window as unknown as { __dgImportSound: unknown }).__dgImportSound = () => ({ made: { ...made }, music: music ? { volume: Math.round(music.volume * 1000) / 1000, at: Math.round(music.currentTime), paused: music.paused, leaving } : null, effectsReady: ready.size, sounding: sounding.size });
