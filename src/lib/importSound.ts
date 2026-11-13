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
const FX = { [TREES]: { from: 0.3, gain: 0.16 }, [CHIME]: { from: 0.42, gain: 1.0 } };

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
  if (music && !leaving) fade(music, MUSIC_DIMMED, 2800);
  // (the note itself, then quickly away: the recording has people talking behind it as it rings on)
  play(CHIME, 0.75, 0.8);
};

let rush: object | null = null;
/** The rush of air as trees come up, swelling for about as long as they take (not over one still
 * sounding). */
export const playTreesSound = (seconds: number) => {
  if (rush && sounding.has(rush as never)) return;
  // (fading over the last of their growing: silent as the last tree is up)
  const out = Math.min(0.8, seconds * 0.4);
  rush = play(TREES, Math.max(0.1, seconds - out), out);
};

/** The import's sound on or off, remembered; off, whatever is sounding stops. */
export const setImportSound = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* no storage */ }
  if (on) { startImportMusic(); return; }
  if (music) { leaving = false; stopImportMusic(350); }
  for (const one of sounding) { try { one.gain.gain.cancelScheduledValues(0); one.gain.gain.value = 0; one.src.stop(); } catch { /* ended already */ } }
};
