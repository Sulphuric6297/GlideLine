// The import's sound: music played softly from the moment a site is asked for till it's brought
// in (it fades out as Design begins), and a rush of air as the trees come up. Off with one switch,
// remembered. A sound that isn't there (the music is kept out of the public code: see
// public/sound/README.md) is simply not played.
const KEY = "dg-import-sound";
const MUSIC = `${import.meta.env.BASE_URL}zz-import-music.mp3`, TREES = `${import.meta.env.BASE_URL}sound/import-trees.mp3`;
const MUSIC_VOLUME = 0.16, TREES_VOLUME = 0.2;

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

let music: HTMLAudioElement | null = null, leaving = false;
/** The music, from quiet, round and round (asked for from a press, as browsers want). */
export const startImportMusic = () => {
  if (!importSoundOn() || typeof Audio === "undefined") return;
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

let rush: HTMLAudioElement | null = null;
/** The rush of air as trees come up, for about as long as they take (not over one still sounding). */
export const playTreesSound = (seconds: number) => {
  if (!importSoundOn() || typeof Audio === "undefined" || rush) return;
  const el = new Audio(TREES);
  el.volume = 0; rush = el;
  const done = () => { el.pause(); if (rush === el) rush = null; };
  void el.play().then(() => {
    fade(el, TREES_VOLUME, 350);
    window.setTimeout(() => fade(el, 0, 1600, done), Math.max(900, seconds * 1000 + 900));
  }).catch(done);
};

/** The import's sound on or off, remembered; off, whatever is sounding stops. */
export const setImportSound = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* no storage */ }
  if (on) { startImportMusic(); return; }
  if (music) { leaving = false; stopImportMusic(350); }
  if (rush) { const el = rush; fade(el, 0, 250, () => { el.pause(); if (rush === el) rush = null; }); }
};
