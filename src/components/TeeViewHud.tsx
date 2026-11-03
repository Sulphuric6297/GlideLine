// What shows over tee view and a flyover: the hole's card, View, Tap mode, and the flyover's bar (the
// map's glass bar, mobile/GlassBar): the flyover's timeline (across the bar, over the pill, once it
// has keyframes or plays), the hole's name with the holes either side and its menu, and every
// flyover setting in its row; ✓ back to the map. A keyframe selected (on the timeline, or the
// playhead dragged onto it), the flyover holds on its moment and the bar is the keyframe's, as a
// selected thing's is: Keyframe 2 with ‹ ›, its settings, ✓ done with it. Add keyframe beside the
// pill. On a computer the settings are in the side panel and the bar over the view keeps the hole,
// the timeline, Add keyframe and Back to map. While a flyover plays the card goes, and left alone
// for a few seconds the bar folds to just its timeline. Someone viewing sees no keyframes: just
// the flyover, and a scrub bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clapperboard, HelpCircle, Home, Maximize2, Minimize2, Settings2, Square, Trash2, Video, X } from "lucide-react";
import { useAllowed } from "../auth/perms";
import { STAND_HERE, TEE_LEVELS } from "../constants";
import { activeLayout } from "../lib/course";
import { courseStats, holeStats } from "../lib/holeStats";
import { fmtDist, fmtElev } from "../lib/units";
import { updateHole, useCourse, useEditor } from "../state/course";
import { useExportJob } from "../state/exportJob";
import { recordVideo, useVideoSettings } from "../state/video";
import { VIDEO_SIZES } from "../lib/video";
import type { Hole, TeeItem } from "../types";
import { ElevationProfile } from "./ElevationProfile";
import { SceneButton } from "./ScenePanel";
import { HoleFlight, cameraFrom } from "./FlyoverSettings";
import { AddKeyframe, FlightLine, TapModes, addKeyframe, addWhere, retimeKeys, useFlight, useFlyoverSettings, useKeyframeSettings } from "./FlyoverBar";
import { askHelp } from "./ui";
import { getView } from "../state/view";
import { useSelection } from "./Inspector";
import { useToolbarRoom } from "./Toolbar";
import { ActRow, GlassBar } from "./mobile/GlassBar";

/** While a flyover waits for its pictures: the hole's name and numbers and a thin moving bar,
 * over the view (shown at once; it fades as the flight begins), and Cancel (it covers the bar
 * along the bottom, and the wait can be long). */
const STAGE = { map: "Painting the map", detail: "Sharpening the hole", textures: "Loading textures" } as const;
function FlyoverLoading({ title, facts, on, stage, onCancel }: { title: string; facts: string; on: boolean; stage: keyof typeof STAGE | null; onCancel: () => void }) {
  // (how long each stage takes: so a slow one can be told)
  const [secs, setSecs] = useState(0);
  useEffect(() => { setSecs(0); const t0 = performance.now(); const t = window.setInterval(() => setSecs(Math.round((performance.now() - t0) / 1000)), 1000); return () => window.clearInterval(t); }, [stage]);
  return (
    <div className={`absolute inset-0 z-[40] flex flex-col items-center justify-center bg-zinc-950 transition-opacity duration-300 ${on ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`} data-testid="flyover-loading" role="status" aria-live="polite">
      <div className="text-xl font-semibold text-zinc-50 tracking-tight">{title}</div>
      <div className="mt-1 text-sm text-zinc-400">{facts}</div>
      <div className="mt-6 w-40 h-0.5 rounded-full bg-white/[0.07] overflow-hidden">
        <div className="h-full w-1/3 rounded-full bg-orange-500 animate-[dgslide_1.2s_ease-in-out_infinite]" />
      </div>
      <div className="mt-3 text-xs text-zinc-500" data-testid="flyover-loading-line">{stage ? STAGE[stage] : "Preparing the flyover"}{secs >= 2 ? ` · ${secs} s` : ""}</div>
      <button className="mt-6 h-11 px-5 rounded-full bg-white/[0.08] text-sm font-semibold text-zinc-200 hover:bg-white/[0.14] active:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={onCancel} data-testid="flyover-loading-cancel">Cancel</button>
    </div>
  );
}

/** The bar's height as it rests (the pill's line over the row), for what sits above it. */
const BAR_H = 44 + 8 + 64 + 18;

export function TeeViewHud({ compact = false }: { compact?: boolean }) {
  const doc = useCourse(s => s.doc);
  const teeView = useEditor(e => e.teeView);
  if (teeView === STAND_HERE) return <StandHere compact={compact} />;
  const hole = doc.holes.find(h => h.id === teeView);
  if (!hole) return null;
  return <HoleHud key={hole.id} hole={hole} compact={compact} />;
}

function HoleHud({ hole, compact }: { hole: Hole; compact: boolean }) {
  const doc = useCourse(s => s.doc);
  const ed = useEditor();
  const job = useExportJob(s => s.job);
  const video = useVideoSettings();
  // (from another tee of the hole: its own numbers, as the layout with that tee would play it)
  const viewed = ed.teeViewTee ? doc.items.find((i): i is TeeItem => i.id === ed.teeViewTee && i.type === "tee" && i.holeId === hole.id) : undefined;
  const s = useMemo(() => holeStats(doc, hole, viewed ? { ...activeLayout(doc), tee: viewed.level } : undefined), [doc, hole, viewed]);
  // (view only: nothing to change; a video only for those who may have downloads)
  const readOnly = useCourse(c => c.readOnly);
  const mayRecord = useAllowed("downloads");
  // (a flyover under way, paused or not; running: not paused)
  const playing = ed.flyover;
  const running = playing && !ed.flyPaused;
  // The loading screen while the view says the flight is waiting, and from the very moment a
  // flyover is asked for until the view has said anything (two seconds at most); only once the wait
  // is long enough to notice: with everything already in, the flyover just starts
  const [bridge, setBridge] = useState(false);
  const wasFlying = useRef<string | null>(null);
  const flightKey = ed.flyover ? ed.teeView : null;
  if (flightKey !== wasFlying.current) { wasFlying.current = flightKey; if (flightKey && !bridge) setBridge(true); }
  useEffect(() => {
    if (!ed.flyover || ed.flyLoading) { setBridge(false); return; }
    const t = window.setTimeout(() => setBridge(false), 2000);
    return () => window.clearTimeout(t);
  }, [ed.flyover, ed.flyLoading]);
  const waiting = ed.flyover && (ed.flyLoading !== null || bridge);
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShowLoading(waiting), waiting ? 450 : 320);
    return () => window.clearTimeout(t);
  }, [waiting]);
  // (a computer: the side panel beside the view when something is picked, the drawing tools under
  // it in Tap mode Select)
  const editing = !playing && !readOnly && !compact;
  const selection = useSelection();
  const picked3 = selection.item;
  const pickedGroup = selection.group.length > 0;
  const [panelOn, setPanelOn] = useState(true);
  const toolbar = useToolbarRoom(r => r.height);
  const select = useEditor(e => e.standTap === "edit");
  const toolsUp = editing && select;
  // (a phone, a thing picked: its own bar in the flyover bar's place)
  const sheetUp = compact && !readOnly && !playing && !!ed.selectedId && doc.items.some(i => i.id === ed.selectedId);
  const [cardOpen, setCardOpen] = useState(false);
  // The flyover's timeline: its keyframes (a custom camera path; someone viewing sees none), the one
  // selected, the playhead as it plays
  const flight = useFlight(hole);
  const keys = readOnly ? null : flight.keys;
  const picked = keys && ed.flyKey !== null ? Math.min(ed.flyKey, keys.length - 1) : null;
  const pickedT = picked !== null ? flight.times[picked] ?? null : null;
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) { setAt(null); return; }
    if (!running) { setAt(getView()?.flyClock()?.t ?? 0); return; }
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last > 90) { last = now; setAt(getView()?.flyClock()?.t ?? 0); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, running]);
  // (a keyframe or a setting changed while it plays or is paused: its path made again, there)
  const sig = JSON.stringify([hole.flyKeys, hole.flyover, doc.flyover]);
  const firstSig = useRef(sig);
  useEffect(() => { if (sig !== firstSig.current) { firstSig.current = sig; if (useEditor.getState().flyover) getView()?.flyRefresh(); } }, [sig]);
  // A keyframe selected: the flyover held on its moment, the playhead there (standing, it starts,
  // held there; held already, it goes there; its time changed, with it)
  useEffect(() => {
    if (pickedT === null || running) return;
    if (!playing) { useEditor.getState().set({ flyover: true, flyPaused: true, flyFrom: pickedT }); return; }
    const now = getView()?.flyClock()?.t ?? null;
    if (now !== null && Math.abs(now - pickedT) > 0.05) getView()?.flySeek(pickedT);
    setAt(pickedT);
  }, [pickedT, playing, running]);
  const pick = (k: number) => {
    if (!keys) return;
    const i = Math.max(0, Math.min(keys.length - 1, k));
    ed.set(running ? { flyKey: i, flyPaused: true } : { flyKey: i });
  };
  // (the playhead dragged: onto a keyframe, it's selected and the playhead is on it; off them, none
  // is; standing, the flyover starts held there)
  const scrub = (t: number) => {
    const near = Math.max(0.15, (flight.length ?? 10) / 60);
    const k = keys && !running ? flight.times.findIndex(x => Math.abs(x - t) < near) : -1;
    const to = k >= 0 ? flight.times[k] : t;
    setAt(to);
    if (playing) { getView()?.flySeek(to); if (keys && !running) ed.set({ flyKey: k >= 0 ? k : null }); }
    else if (keys) ed.set({ flyover: true, flyPaused: true, flyFrom: to, flyKey: k >= 0 ? k : null });
  };
  // (the playhead: as it plays; standing with keyframes, at the start)
  const playhead = playing ? at : keys ? 0 : null;
  const addNow = () => { if (keys) addKeyframe(hole.id, addWhere(flight.times, picked, playhead)); };
  // (a computer: K adds a keyframe, [ and ] go to the keyframe before or after; before the map's
  // own keys, which would go to other holes)
  const keyRef = useRef({ addNow, pick, picked, n: keys?.length ?? 0 });
  keyRef.current = { addNow, pick, picked, n: keys?.length ?? 0 };
  useEffect(() => {
    if (compact || !keys) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ((el.tagName === "INPUT" && !["range", "checkbox", "radio"].includes((el as HTMLInputElement).type)) || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || useEditor.getState().flyCam) return;
      const r = keyRef.current;
      if (e.key === "k" || e.key === "K") { e.preventDefault(); e.stopPropagation(); r.addNow(); }
      else if (e.key === "[" || e.key === "]") { e.preventDefault(); e.stopPropagation(); r.pick(r.picked === null ? (e.key === "]" ? 0 : r.n - 1) : r.picked + (e.key === "]" ? 1 : -1)); }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [compact, !!keys]); // eslint-disable-line react-hooks/exhaustive-deps
  // Left alone while it plays, the bar folds to its timeline; a touch, a move of the mouse or a key
  // brings it back (not while a menu or dial is open). The touch that brings it back does only that:
  // it doesn't also press what comes up under the finger (the timeline, still there, works at once)
  const [idle, setIdle] = useState(false);
  const idleNow = useRef(false);
  idleNow.current = idle;
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!running) { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), 3000);
    const wakeNow = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 3000); };
    const wake = (e: Event) => {
      // (folded, a finger on the line itself: the bar comes back once it lifts, so the line doesn't
      // move from under it, and Pause or a drag along it does what it touched)
      if (idleNow.current && (e.target as HTMLElement | null)?.closest?.('[data-testid="fly-line"]')) {
        if (e.type !== "pointerdown") return;
        const lifted = () => {
          window.removeEventListener("pointerup", lifted, true);
          window.removeEventListener("pointercancel", lifted, true);
          window.setTimeout(wakeNow, 80);
        };
        window.addEventListener("pointerup", lifted, true);
        window.addEventListener("pointercancel", lifted, true);
        return;
      }
      // (only that tap's own click, under the same finger: a tap the view keeps to itself makes no
      // click, and the next tap somewhere else, Pause say, must still work)
      if (idleNow.current && e.type === "pointerdown" && !(e.target as HTMLElement | null)?.closest?.('[data-testid="fly-line"]')) {
        const at = e as PointerEvent;
        const swallow = (c: Event) => {
          const m = c as MouseEvent;
          if (Math.hypot(m.clientX - at.clientX, m.clientY - at.clientY) > 12) return;
          c.preventDefault(); c.stopPropagation();
          window.removeEventListener("click", swallow, { capture: true });
        };
        window.addEventListener("click", swallow, { capture: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 500);
      }
      wakeNow();
    };
    window.addEventListener("pointerdown", wake, true);
    window.addEventListener("pointermove", wake, true);
    window.addEventListener("keydown", wake, true);
    return () => { window.clearTimeout(t); window.removeEventListener("pointerdown", wake, true); window.removeEventListener("pointermove", wake, true); window.removeEventListener("keydown", wake, true); };
  }, [running]);
  const tucked = running && idle && !menuOpen;
  // (a few seconds' hint on what a tap does, as tool hints have, as tee view or Tap mode starts)
  const [hint, setHint] = useState(true);
  useEffect(() => { setHint(true); const t = window.setTimeout(() => setHint(false), 4500); return () => window.clearTimeout(t); }, [select]);
  const record = () => void recordVideo([hole.id]);
  const recPct = job?.kind === "video" && job.progress !== null ? `${Math.round(job.progress * 100)}%` : null;
  const all = useFlyoverSettings(hole, { exportVideo: mayRecord ? record : undefined });
  const settings = (readOnly ? all.filter(x => x.id === "export") : all).map(x => (x.id === "export" ? { ...x, disabled: !!job, value: job?.kind === "video" ? `Exporting ${recPct ?? "…"}` : x.value } : x));
  const stats = courseStats(doc);
  const done = doc.holes.filter((_, k) => stats[k].complete);
  const i = done.findIndex(h => h.id === hole.id);
  const go = (d: number) => {
    const next = done[(i + d + done.length) % done.length];
    if (next) ed.set({ teeView: next.id, teeViewTee: null, flyover: ed.flyover, flyKey: null });
  };
  const lvl = TEE_LEVELS[s.level];
  // (beside the big number: the hole's name, or the tee it's seen from; standing away from the tee,
  // how far the basket is from there)
  const basket = ed.teeStand && s.basketId ? doc.items.find(i => i.id === s.basketId) : undefined;
  const sub = basket && ed.teeStand ? `${fmtDist(Math.hypot(basket.x - ed.teeStand.x, basket.y - ed.teeStand.y), doc.units)} to the basket` : hole.name || `${lvl.label} tee`;
  const loading = showLoading && ed.flyover ? <FlyoverLoading on={waiting} stage={ed.flyLoading} onCancel={() => ed.set({ flyover: false })} title={`Hole ${s.label}${hole.name ? ` · ${hole.name}` : ""}`} facts={`${fmtDist(s.length, doc.units)} · Par ${s.par}${s.elevationChange ? ` · ${fmtElev(s.elevationChange, doc.units)}` : ""}`} /> : null;

  const pillMenu = (
    <div className="flex flex-col gap-0.5">
      {playing && <ActRow icon={<Square size={17} />} label="Stop flyover" hint="Back to the tee" onClick={() => ed.set({ flyover: false })} testid="hud-stop" />}
      {ed.teeStand && !playing && <ActRow icon={<Home size={18} />} label="Return to tee" hint="Back where the hole starts" onClick={() => ed.set({ teeStand: null })} testid="hud-to-tee" />}
      {mayRecord && !job && <ActRow icon={<Clapperboard size={18} />} label="Export video" hint={`${VIDEO_SIZES[video.resolution].label} · ${video.fps} fps`} onClick={record} testid="hud-record" />}
      {!readOnly && <ActRow icon={<Video size={18} />} label="Edit camera path" hint="Move the camera yourself and set keyframes" onClick={() => cameraFrom(hole.id, null)} testid="hud-freecam" />}
      <ActRow icon={<HelpCircle size={18} />} label="Flyover help" hint="How flyovers and camera paths work" onClick={() => askHelp("flyover")} testid="hud-help" />
    </div>
  );
  const retime = (k: number, t: number, end: boolean) => {
    if (!flight.keys) return;
    updateHole(hole.id, { flyKeys: retimeKeys(flight.keys, flight.times, k, t) }, false);
    if (end) useCourse.getState().commit();
  };
  const lineProps = {
    playing, paused: ed.flyPaused, onPlay: () => ed.set(playing ? { flyPaused: false } : { flyover: true }), onPause: () => ed.set({ flyPaused: true }), length: flight.length, at: playhead,
    keys: keys ? flight.times : undefined, picked, onRetime: keys ? retime : undefined, onPick: pick, onScrub: playing || keys ? scrub : undefined
  };
  const line = <FlightLine {...lineProps} />;
  const lineBare = <FlightLine bare {...lineProps} />;
  // (a keyframe selected: the bar is the keyframe's, with ‹ › to the ones either side)
  const keySettings = useKeyframeSettings(hole, picked ?? 0);
  const keyBar = picked !== null && !!keys;
  const keyMenu = keys && picked !== null && (
    <div className="flex flex-col gap-0.5">
      <ActRow icon={<Video size={18} />} label="Move camera" hint={`Move keyframe ${picked + 1}'s camera yourself`} onClick={() => cameraFrom(hole.id, picked)} testid="key-move" />
      {keys.length > 2 && <ActRow icon={<Trash2 size={18} />} label={`Delete keyframe ${picked + 1}`} danger onClick={() => { updateHole(hole.id, { flyKeys: keys.filter((_, j) => j !== picked) }); ed.set({ flyKey: Math.max(0, picked - 1) }); }} testid="key-delete" />}
      <ActRow icon={<HelpCircle size={18} />} label="Flyover help" hint="How flyovers and camera paths work" onClick={() => askHelp("flyover")} testid="hud-help" />
    </div>
  );
  const many = done.length > 1;
  // (a computer: along the foot of the view, over the drawing tools when they're up)
  const base = compact ? 0 : toolsUp ? toolbar + 6 : 0;
  // (a phone: the timeline across the bar once there's one to use, keyframes or a flyover under way)
  const fullLine = !!keys || playing;
  const barH = BAR_H + (fullLine ? 46 + 8 : 0);
  const bar = !sheetUp && (
    <GlassBar remember={keyBar ? "flyover-key" : "flyover"}
      pill={keyBar ? { name: `Keyframe ${picked! + 1}`, prev: () => pick(picked! - 1), next: () => pick(picked! + 1), prevOff: picked === 0, nextOff: picked === keys!.length - 1, prevLabel: "The keyframe before", nextLabel: "The keyframe after", testid: "flyover-pill" }
        : { name: `Hole ${s.label}`, prev: many ? () => go(-1) : undefined, next: many ? () => go(1) : undefined, testid: "flyover-pill" }}
      pillMenu={keyBar ? keyMenu : pillMenu} settings={keyBar ? keySettings : settings} line={line} lineAbove={fullLine} tucked={tucked}
      beside={keys ? <AddKeyframe times={flight.times} picked={picked} at={playhead} onAdd={addNow} /> : undefined}
      onDone={keyBar ? () => ed.set({ flyKey: null }) : () => ed.set({ teeView: null, flyover: false })} doneLabel={keyBar ? "Done with the keyframe" : "Done: back to the map"}
      bottom={base} onOpen={id => setMenuOpen(!!id)} testid="tee-bar" />
  );
  const wide = typeof window !== "undefined" && window.innerWidth >= 1200;
  const taps = !readOnly && !playing && !menuOpen && (compact ? <TapModes bottom={barH + 12} /> : <TapModes bottom={base + (wide ? 18 : 84)} right={16} />);
  // (the overlay's course name above the bar while the flyover shows; a video has no bar)
  const foot = !playing ? 0 : compact ? (tucked ? 18 + 46 + 8 : barH + 8) : base + 18 + 52 + 8;
  useEffect(() => { getView()?.setFlyFoot(foot); }, [foot]);
  useEffect(() => () => getView()?.setFlyFoot(0), []);
  const hintText = select ? (compact ? "Tap to select · drag to look" : "Click something to select it · drag to look around · Esc back to the map") : compact ? "Tap to walk · drag to look" : `Click the ground to walk · drag to look around${many ? " · ← → other holes" : ""} · Space plays the flyover`;

  if (compact) {
    return (
      <div className="absolute inset-0 pointer-events-none z-20" data-pov-ui>
        {loading}
        {ed.teeCardHidden && !playing && <CardChip label={s.label} color={lvl.color} ink={lvl.ink} big />}
        <div className={`absolute left-2 right-[66px] top-[max(8px,env(safe-area-inset-top))] pointer-events-auto glass rounded-[24px] px-3 py-2.5 text-white shadow-2xl border border-white/10 max-w-[420px] ${playing || ed.teeCardHidden ? "hidden" : ""}`} data-testid="tee-view-hud">
          <div className="flex items-center gap-3">
            {/* (a tap on the hole's number and numbers opens its profile and notes; again, closes them) */}
            <button className="flex-1 min-w-0 flex items-center gap-3 text-left focus:outline-none" onClick={() => setCardOpen(o => !o)} aria-expanded={cardOpen} data-testid="hud-card-open">
              <div className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-[22px] font-bold" style={{ background: lvl.color, color: lvl.ink, fontFamily: "Oswald, Inter" }}>{s.label}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] uppercase tracking-wider text-zinc-300 truncate">{sub}</div>
                <div className="text-[20px] font-bold leading-tight" style={{ fontFamily: "Oswald, Inter" }}>Par {s.par} · {fmtDist(s.length, doc.units)}</div>
                <div className="text-[13px] text-zinc-300 flex items-center gap-1">{fmtElev(s.elevationChange, doc.units)} · plays like {fmtDist(s.playsLike, doc.units)} <ChevronDown size={14} className={`transition-transform ${cardOpen ? "rotate-180" : ""}`} /></div>
              </div>
            </button>
            <HideCard big />
          </div>
          {cardOpen && <div className="mt-1.5"><ElevationProfile doc={doc} line={s.line} height={56} teeColor={lvl.color} /></div>}
          {cardOpen && hole.notes && <p className="text-[13px] text-zinc-200 mt-1 line-clamp-3">{hole.notes}</p>}
        </div>
        <div className="absolute right-2 top-[max(8px,env(safe-area-inset-top))] pointer-events-auto glass rounded-[20px] p-1 border border-white/10 shadow-2xl"><SceneButton label="View" /></div>
        {hint && !playing && !sheetUp && !menuOpen && <div className="absolute z-[33] max-w-[calc(100%-96px)] px-3.5 py-1.5 rounded-full bg-black/45 text-[13px] font-semibold text-white/90 text-center whitespace-nowrap truncate pointer-events-none dg-fade-in" style={{ bottom: barH + 12, left: "calc(50% - 28px)", transform: "translateX(-50%)" }} data-testid="tee-hint">{hintText}</div>}
        {taps}
        {bar}
      </div>
    );
  }
  // A computer: the flyover's settings in the side panel (the side panel's own card, as anything
  // selected has), the hole's card at its top; over the view only what's done while watching: the
  // hole, Play or Pause and the timeline, Back to map. Something selected (Select): its own panel in
  // that place, the hole's card floating beside it, as on the map
  const thing = !!picked3 || pickedGroup;
  const flyPanel = !readOnly && panelOn && !thing;
  const offset = flyPanel || (editing && thing) ? 162 : 0;
  const card = (
    <div className="relative flex items-center gap-3">
      <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold shrink-0" style={{ background: lvl.color, color: lvl.ink, fontFamily: "Oswald, Inter" }}>{s.label}</div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-zinc-300 truncate">{sub}</div>
        <div className="text-2xl font-bold leading-tight" style={{ fontFamily: "Oswald, Inter" }}>Par {s.par} · {fmtDist(s.length, doc.units)}</div>
        <div className="text-xs text-zinc-300">{fmtElev(s.elevationChange, doc.units)} · plays like {fmtDist(s.playsLike, doc.units)}</div>
      </div>
    </div>
  );
  const head = "w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-50 hover:bg-white/[0.09] disabled:opacity-30";
  const pill = "h-10 px-3 rounded-full text-[13.5px] font-semibold flex items-center gap-1.5 text-zinc-50 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";
  return (
    <div className="absolute inset-0 pointer-events-none z-20" data-pov-ui>
      {loading}
      {flyPanel && (
        <aside className="absolute top-3 left-3 w-[300px] max-h-[calc(100%-24px)] flex flex-col glass rounded-[22px] shadow-xl shadow-black/40 z-20 pointer-events-auto" data-testid="fly-panel" aria-label="Flyover">
          <div className="flex items-center gap-0.5 px-2 pt-2">
            <button className={head} aria-label="Previous hole" title="Previous hole (←)" disabled={!many} onClick={() => go(-1)}><ChevronLeft size={16} /></button>
            <button className={head} aria-label="Next hole" title="Next hole (→)" disabled={!many} onClick={() => go(1)}><ChevronRight size={16} /></button>
            <span className="flex-1 pl-1.5 text-[14px] font-bold text-zinc-50">Flyover</span>
            <button className={head} aria-label="Close the Flyover panel" title="Close" onClick={() => setPanelOn(false)} data-testid="fly-panel-close"><X size={15} /></button>
          </div>
          <div className="overflow-y-auto min-h-0 dg-scroll px-4 pb-4 pt-1">
            <div className="text-white">{card}</div>
            <div className="mt-2 mb-4"><ElevationProfile doc={doc} line={s.line} height={56} teeColor={lvl.color} /></div>
            <HoleFlight key={hole.id} hole={hole} inTee exportVideo={mayRecord ? { label: `${VIDEO_SIZES[video.resolution].label}, ${video.fps} fps`, run: record, busy: job?.kind === "video" ? `Exporting ${recPct ?? "…"}` : job ? "Exporting…" : null } : undefined} />
          </div>
        </aside>
      )}
      {/* (no Flyover panel: the hole's card floating, beside a selected thing's panel) */}
      {!flyPanel && ed.teeCardHidden && !playing && <div className={`absolute top-4 ${editing && thing ? "left-[324px]" : "left-4"}`}><CardChip label={s.label} color={lvl.color} ink={lvl.ink} /></div>}
      {!flyPanel && (
        <div className={`absolute top-4 pointer-events-auto glass backdrop-blur rounded-[24px] px-4 py-3 text-white shadow-2xl border border-white/10 w-[300px] ${playing || ed.teeCardHidden ? "hidden" : ""} ${editing && thing ? "left-[324px]" : "left-4"}`} data-testid="tee-view-hud">
          <div className="absolute right-2 top-2 flex items-center gap-0.5">
            {!readOnly && !thing && <button className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10" aria-label="Flyover settings" title="Flyover settings" onClick={() => setPanelOn(true)} data-testid="fly-panel-open"><Settings2 size={15} /></button>}
            <HideCard />
          </div>
          {card}
          <div className="mt-2"><ElevationProfile doc={doc} line={s.line} height={70} teeColor={lvl.color} /></div>
          {hole.notes && <p className="text-xs text-zinc-200 mt-1">{hole.notes}</p>}
        </div>
      )}
      {editing && <TeeMap big={ed.teeMap === "big"} off={ed.teeMap === "off"} />}
      <div className="absolute top-4 right-4 pointer-events-auto"><SceneButton /></div>
      {!playing && <div className="absolute text-xs text-white/80 bg-black/40 rounded-lg px-2.5 py-1 whitespace-nowrap" style={{ bottom: base + 84, left: `calc(50% + ${offset}px)`, transform: "translateX(-50%)" }} data-testid="tee-hint">{hintText}</div>}
      {taps}
      <div className="absolute pointer-events-auto glass rounded-full border border-white/10 shadow-2xl h-[52px] px-1.5 flex items-center gap-1 whitespace-nowrap" style={{ bottom: base + 18, left: `calc(50% + ${offset}px)`, transform: "translateX(-50%)" }} data-testid="tee-bar">
        {ed.teeStand && !playing && <button className={pill} onClick={() => ed.set({ teeStand: null })} title="Return to tee" data-testid="hud-to-tee"><Home size={15} /> Tee</button>}
        <button className={`${pill} !px-0 w-9 justify-center text-zinc-300`} aria-label="Previous hole" title="Previous hole (←)" disabled={!many} onClick={() => go(-1)} data-testid="hole-prev"><ChevronLeft size={18} /></button>
        <span className="text-[14px] font-bold text-zinc-50 px-0.5" data-testid="sheet-title">Hole {s.label}</span>
        <button className={`${pill} !px-0 w-9 justify-center text-zinc-300`} aria-label="Next hole" title="Next hole (→)" disabled={!many} onClick={() => go(1)} data-testid="hole-next"><ChevronRight size={18} /></button>
        <span className="w-px h-6 bg-white/[0.12] mx-1" />
        <div className="w-[min(480px,34vw)]">{lineBare}</div>
        {keys && <AddKeyframe compact={false} times={flight.times} picked={picked} at={playhead} onAdd={addNow} />}
        <span className="w-px h-6 bg-white/[0.12] mx-1" />
        {playing && <button className={pill} onClick={() => ed.set({ flyover: false })} title="Stop and go back to the tee (Esc)" data-testid="hud-stop"><Square size={13} /> Stop</button>}
        <button className={`${pill} bg-white/[0.07]`} onClick={() => ed.set({ teeView: null, flyover: false })} title="Back to the map (Esc)" data-testid="bar-done"><X size={15} /> Back to map</button>
      </div>
    </div>
  );
}

/** Puts the hole's card away (standing, so it doesn't cover the view). */
function HideCard({ big = false }: { big?: boolean }) {
  const set = useEditor(e => e.set);
  return (
    <button className={`${big ? "w-11 h-11" : "w-7 h-7"} shrink-0 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 active:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`}
      onClick={() => set({ teeCardHidden: true })} aria-label="Hide the hole's card" title="Hide the hole's card" data-testid="hud-card-hide">
      <ChevronUp size={big ? 20 : 15} />
    </button>
  );
}

/** The hole's card put away: its number in a small chip; a tap brings the card back. */
function CardChip({ label, color, ink, big = false }: { label: string; color: string; ink: string; big?: boolean }) {
  const set = useEditor(e => e.set);
  return (
    <button className={`${big ? "absolute left-2 top-[max(8px,env(safe-area-inset-top))] h-11" : "h-9"} pointer-events-auto glass rounded-full pl-1 pr-3 flex items-center gap-1.5 border border-white/10 shadow-2xl text-white text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`}
      onClick={() => set({ teeCardHidden: false })} aria-label="Show the hole's card" title="Show the hole's card" data-testid="hud-card-show">
      <span className={`${big ? "w-9 h-9 text-lg" : "w-7 h-7 text-base"} rounded-full flex items-center justify-center font-bold`} style={{ background: color, color: ink, fontFamily: "Oswald, Inter" }}>{label}</span>
      Hole
    </button>
  );
}

/** Standing somewhere away from every hole (the person dropped there): View, Tap mode, and back to
 * the map; no hole's card, flyover or other holes. */
function StandHere({ compact }: { compact: boolean }) {
  const ed = useEditor();
  const doc = useCourse(c => c.doc);
  const readOnly = useCourse(c => c.readOnly);
  const toolbar = useToolbarRoom(r => r.height);
  const editing = !readOnly && !compact;
  const select = ed.standTap === "edit";
  const back = () => ed.set({ teeView: null, teeStand: null, flyover: false });
  const base = editing && select ? toolbar + 6 : 0;
  // (a thing picked on a phone: its own bar in this one's place)
  const sheetUp = compact && !readOnly && !!ed.selectedId && doc.items.some(i => i.id === ed.selectedId);
  const backBtn = (
    <div className="absolute pointer-events-auto flex items-center gap-1 glass rounded-full p-1.5 pl-4 border border-white/10 shadow-2xl left-1/2 -translate-x-1/2" style={{ bottom: base + 18 }} data-testid="stand-here-bar">
      <span className="text-[14px] font-semibold text-zinc-300 mr-1.5">Standing here</span>
      <button className="h-11 px-4 rounded-full bg-orange-300 text-zinc-950 text-[14px] font-bold flex items-center gap-1.5 active:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={back} data-testid="hud-close"><X size={17} /> Back to the map</button>
    </div>
  );
  return (
    <div className="absolute inset-0 pointer-events-none z-20" data-pov-ui>
      {editing && <TeeMap big={ed.teeMap === "big"} off={ed.teeMap === "off"} />}
      <div className={`absolute ${compact ? "right-2 top-[max(8px,env(safe-area-inset-top))] glass rounded-[20px] p-1 border border-white/10 shadow-2xl" : "top-4 right-4"} pointer-events-auto`}><SceneButton label={compact ? "View" : undefined} /></div>
      {!readOnly && <TapModes bottom={base + 84} right={compact ? 10 : 16} />}
      {!sheetUp && backBtn}
    </div>
  );
}

/** Over the corner map while editing in tee view: what it is, bigger or smaller, and the view's
 * direction from the tee (a cone). The map itself is drawn by the view. */
function TeeMap({ big, off }: { big: boolean; off: boolean }) {
  const set = useEditor(e => e.set);
  const [m, setM] = useState<ReturnType<NonNullable<ReturnType<typeof getView>>["teeMini"]>>(null);
  useEffect(() => {
    let raf = 0;
    // (each frame, but drawn again only when it changed)
    let last = "";
    const tick = () => {
      const next = getView()?.teeMini() ?? null;
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setM(next); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (off) return <button className="absolute top-16 right-4 pointer-events-auto glass rounded-full px-3 py-1.5 text-xs font-semibold text-white border border-white/10" onClick={() => set({ teeMap: "small" })} data-testid="tee-map-show">Show the map from above</button>;
  if (!m) return null;
  const { rect: r, tee, ahead, fov } = m;
  // (the cone: from the tee, the view's width either side of where it looks)
  let cone = "";
  if (tee && ahead) {
    const a = Math.atan2(ahead.y - tee.y, ahead.x - tee.x), len = Math.max(r.width, r.height), half = Math.min(80, fov / 2) * Math.PI / 180;
    const p = (t: number) => `${tee.x - r.x + Math.cos(a + t) * len},${tee.y - r.y + Math.sin(a + t) * len}`;
    cone = `M${tee.x - r.x},${tee.y - r.y} L${p(-half)} L${p(half)} Z`;
  }
  return (
    <div className="absolute pointer-events-none rounded-2xl ring-1 ring-white/20 shadow-2xl" style={{ left: r.x, top: r.y, width: r.width, height: r.height }} data-testid="tee-map">
      <svg className="absolute inset-0 rounded-2xl" width={r.width} height={r.height}>
        {cone && <path d={cone} fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />}
        {tee && <circle cx={tee.x - r.x} cy={tee.y - r.y} r={5} fill="#2563eb" stroke="#fff" strokeWidth={2} />}
      </svg>
      <div className="absolute left-2 top-2 flex items-center gap-1 pointer-events-auto">
        <span className="px-2 py-0.5 rounded-lg bg-black/60 text-[11.5px] text-zinc-100">From above · drag here too</span>
        <button className="p-1 rounded-lg bg-black/60 text-zinc-100 hover:bg-black/75" aria-label={big ? "Smaller" : "Bigger"} title={big ? "Smaller" : "Bigger"} onClick={() => set({ teeMap: big ? "small" : "big" })} data-testid="tee-map-size">{big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button className="p-1 rounded-lg bg-black/60 text-zinc-100 hover:bg-black/75" aria-label="Hide the map from above" title="Hide" onClick={() => set({ teeMap: "off" })}><X size={13} /></button>
      </div>
    </div>
  );
}
