// The help guide: every feature and setting, chapter by chapter, with pictures; searchable, and
// each setting a "Show me" away (the guide closes and the setting is opened and pointed at).
import { openGettingStarted } from "../GettingStarted";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Box, Download, Keyboard, Lock, MapPin, Palette, Route, Search, Share2, Smartphone, X, ArrowRight } from "lucide-react";
import { SECTIONS, TOPICS, type GuideSection, type Topic, type Where } from "../../lib/guide";
import { SERVER } from "../../auth/api";
import { showSetting } from "../showSetting";
import { download } from "../../state/files";
import { FlyArt, HoleArt, MapStepArt, PhoneArt, ScreenArt, ShareArt, StepsArt } from "./Illustrations";

const ICONS: Record<GuideSection, JSX.Element> = {
  start: <BookOpen size={16} />, site: <MapPin size={16} />, design: <Route size={16} />, view: <Box size={16} />, map: <Palette size={16} />,
  export: <Download size={16} />, share: <Share2 size={16} />, phone: <Smartphone size={16} />, keys: <Keyboard size={16} />
};
const ART: Partial<Record<GuideSection, (() => JSX.Element)[]>> = {
  start: [StepsArt, ScreenArt], design: [HoleArt], view: [FlyArt], map: [MapStepArt], share: [ShareArt], phone: [PhoneArt]
};

export const SHORTCUTS: [string, string][] = [
  ["V", "Select and move"], ["H", "New hole (tee, then basket)"], ["T / B", "Another tee / pin for the hole"], ["M / Z", "Mando / drop zone"],
  ["O", "OB and rules"], ["L", "Paths and roads"], ["W / U", "Water / grass"], ["R", "Trees and woods"],
  ["S", "Build: buildings, shelters, decks, bridges, boardwalks, stairs, walls, fences, power lines"], ["P", "Park: ball fields, courts, playgrounds, pools"], ["G", "Shape the ground"], ["A / K", "Amenity / label"], ["D", "Measure"],
  ["Enter", "Finish drawing · view from the tee of the hole, tee or basket picked"], ["Esc", "Cancel drawing · back to Select · clear the selection · close"], ["Backspace", "Remove the last point drawn · delete the selection"],
  ["Space+drag", "Move the map, whatever tool you're using"], ["Shift+drag", "With Select: draw a box to select (other tools: turn and tilt)"], ["Shift+click", "Add to the selection, or take out"], ["Ctrl+A", "Select everything"],
  ["Right-click", "The map's menu for what's under the pointer, or for open ground"], ["Alt+click", "Remove a point, a turn in a hole's line, or a width square"],
  ["Del", "Delete the selection"], ["Ctrl+D", "Duplicate"], ["Ctrl+C / X / V", "Copy / cut / paste (where the pointer is)"], ["Arrows", "Nudge 1 ft (Shift: 10 ft) · other holes in the tee view"],
  ["Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y", "Undo / redo (while drawing, Ctrl+Z takes out the last point)"], ["Ctrl+S", "Save now"], ["2 / 3", "Top-down / 3D"], ["0 / F", "Whole course / zoom to selection"], ["[ / ]", "Previous / next hole"],
  ["Ctrl+K or /", "Search: holes, tools, settings, help"], ["Q / E / N", "Turn left / right / north up"], ["+ / −", "Zoom"], ["?", "This guide"],
  ["W A S D or arrows", "In the camera: move (Shift: faster)"], ["Space or E / Q", "In the camera: up / down"], ["Enter / U", "In the camera: add a keyframe / move the picked one here"], ["[ / ] in the camera", "Keyframe before / after"]
];

export const GESTURES: [string, string][] = [
  ["One finger", "Pan the map; drag a selected thing or its handles to move or reshape it"],
  ["Pinch", "Zoom in and out (or the + and − buttons)"],
  ["Two fingers up or down", "Tilt into 3D and back"],
  ["Twist two fingers", "Turn the map (the compass puts north up)"],
  ["Pinch or twist a picked thing", "Size it or turn it: a tree, a tee, a shape"],
  ["Tap", "Select a hole or a thing; with a tool, place it"],
  ["Tap a corner or a turn", "Of the thing picked: Delete point comes up beside a corner, Remove this turn beside a turn in a hole's line"],
  ["Hold (with Select)", "A thing's menu: view from the tee, mark OB, duplicate, lock, delete; or, on open ground, what you can start there"],
  ["The box button, by the zoom buttons", "Drag a box around several things; tap one to add it or take it out"],
  ["Drag the panel", "Up for more, down for more map; tap its handle to step through"],
  ["In the camera", "The stick moves it, the arrows take it up and down, drag the view to look"]
];

/** The topics this app has (file saving only without a server). In the demo the server's topics
 * stay, each saying it's locked here. */
const shownTopics = TOPICS.filter(t => t.server !== false || !SERVER);

function TopicCard({ t, onShow, lit }: { t: Topic; onShow: (t: Topic) => void; lit: boolean }) {
  return (
    <article id={`help-${t.id}`} className={`rounded-[18px] bg-white/[0.05] p-4 ${lit ? "dg-found" : ""}`} data-testid="help-topic">
      <h3 className="text-[15px] font-semibold text-zinc-50">{t.title}</h3>
      {t.server && !SERVER && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-[12px] bg-sky-500/10 px-2.5 py-1.5 text-[12.5px] leading-snug text-sky-100" data-testid="help-locked">
          <Lock size={13} className="mt-0.5 shrink-0" />This one's locked in the public demo. Host GlideLine Studio yourself and it works.
        </p>
      )}
      {t.body.split("\n\n").map((p, i) => <p key={i} className="text-[13.5px] leading-relaxed text-zinc-300 mt-1.5">{p}</p>)}
      {t.steps && (
        <ol className="mt-2 space-y-1.5">
          {t.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] text-zinc-200">
              <span className="w-5 h-5 shrink-0 rounded-full bg-orange-500/20 text-orange-200 text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
      {t.table && (
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 text-[13px]" data-testid="help-table">
          {t.table.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="mt-1.5 font-mono text-[12px] text-orange-200 whitespace-nowrap">{k}</dt>
              <dd className="sm:mt-1.5 text-zinc-300">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {t.files && (
        <div className="mt-3 flex flex-wrap gap-2">
          {t.files.map(f => (
            <button key={f.name} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 touch:min-h-[44px] touch:px-4 text-[12.5px] font-semibold bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100"
              onClick={() => download(new Blob([f.text], { type: f.type }), f.name)} data-testid="help-file">
              <Download size={13} /> {f.label}
            </button>
          ))}
        </div>
      )}
      {(t.path || t.where) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {t.path && <span className="text-[12px] text-zinc-400 rounded-full bg-white/[0.06] px-2.5 py-1">{t.path}</span>}
          {t.where && <button className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 touch:min-h-[44px] touch:px-4 text-[12.5px] font-semibold bg-orange-500 hover:bg-orange-400 text-zinc-950" onClick={() => onShow(t)} data-testid="help-show-me">Show me <ArrowRight size={13} /></button>}
        </div>
      )}
    </article>
  );
}

function KeysSection({ touch }: { touch: boolean }) {
  return (
    <>
      {touch && (
        <>
          <h3 className="text-[15px] font-semibold text-zinc-50 mb-2">Touch gestures</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 text-[14px] mb-5" data-testid="gestures">
            {GESTURES.map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold text-zinc-100 mt-2">{k}</dt><dd className="text-zinc-300 sm:mt-2">{v}</dd></div>)}
          </dl>
          <h3 className="text-[15px] font-semibold text-zinc-50 mb-2">Keys</h3>
        </>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt><kbd className="px-1.5 py-0.5 bg-white/[0.07] border border-white/[0.12] rounded text-xs text-zinc-200 font-mono whitespace-nowrap">{k}</kbd></dt>
            <dd className="text-zinc-300">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-[15px] font-semibold text-zinc-50 mt-5 mb-1">Moving around the map</h3>
      <p className="text-[13.5px] text-zinc-300">Drag to pan (or Space+drag, whatever tool you're using), scroll or pinch to zoom at the pointer, right-drag (or Ctrl+drag or Alt+drag) to turn and tilt, Shift+drag with Select to draw a box, double-click to zoom in.</p>
      <h3 className="text-[15px] font-semibold text-zinc-50 mt-5 mb-1">Credits</h3>
      <p className="text-xs text-zinc-500">Imagery © Esri, Maxar, Vexcel, Earthstar Geographics, and state programs like NC OneMap. Map data © OpenStreetMap contributors (and OpenFreeMap, OpenMapTiles). Building outlines: Overture Maps (Microsoft and others). Elevation and measured trees: USGS 3DEP and its LiDAR, and AWS Terrain Tiles (Mapzen). Fonts: Google Fonts. Trees grown with ez-tree (MIT). Chain-link fence by loafbrr (CC0).</p>
    </>
  );
}

/** `onShow`: before Show me or Getting started goes to the editor (a Courses page over it closes). */
export function HelpGuide({ onClose, topic, touch = false, onShow }: { onClose: () => void; topic?: string; touch?: boolean; onShow?: () => void }) {
  const start = topic ? TOPICS.find(t => t.id === topic)?.section : undefined;
  const [section, setSection] = useState<GuideSection>(start ?? "start");
  const [q, setQ] = useState("");
  const [lit, setLit] = useState(topic ?? "");
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Esc closes (before the editor's own Esc); the focus back where it was
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (q) setQ(""); else onClose(); } };
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("keydown", esc, true); before?.focus?.({ preventScroll: true }); };
  }, [onClose, q]);
  // (a topic asked for: scrolled to and lit up)
  useEffect(() => {
    if (!lit) return;
    requestAnimationFrame(() => document.getElementById(`help-${lit}`)?.scrollIntoView({ block: "center" }));
    const id = window.setTimeout(() => setLit(""), 2400);
    return () => window.clearTimeout(id);
  }, [lit]);
  useEffect(() => { if (!lit) body.current?.scrollTo({ top: 0 }); }, [section]);

  const found = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return shownTopics.filter(t => { const f = `${t.title} ${t.body} ${t.words ?? ""} ${t.path ?? ""} ${(t.steps ?? []).join(" ")} ${(t.table ?? []).flat().join(" ")}`.toLowerCase(); return words.every(w => f.includes(w)); });
  }, [q]);
  // (not found on screen: said where it is, by the topic's path or its title)
  const show = (t: Topic) => { onClose(); onShow?.(); if (t.where) void showSetting({ ...t.where, missing: t.path ?? t.title } as Where); };
  const toStart = () => { onShow?.(); openGettingStarted(); onClose(); };
  const sec = SECTIONS.find(s => s.id === section)!;
  const topics = shownTopics.filter(t => t.section === section);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center md:p-6" role="dialog" aria-modal="true" aria-label="Help guide" onClick={onClose} data-testid="help-guide">
      <div ref={box} className="glass-solid ring-1 ring-white/10 shadow-2xl w-full md:max-w-5xl h-[94dvh] md:h-[86vh] rounded-t-[24px] md:rounded-[24px] flex flex-col md:flex-row overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* The chapters (a row of chips on a phone) */}
        <nav className="md:w-[240px] shrink-0 md:border-r border-white/[0.07] flex flex-col min-h-0" aria-label="Help chapters">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <BookOpen size={18} className="text-orange-300" />
            <h2 className="flex-1 font-bold text-zinc-50 text-[17px]">Help</h2>
            <button className="text-[12.5px] font-semibold text-orange-300 hover:text-orange-200 touch:min-h-[44px] touch:px-1" onClick={toStart} data-testid="help-getting-started">Getting started</button>
            <button aria-label="Close" className="md:hidden w-11 h-11 -m-2 flex items-center justify-center text-zinc-400" onClick={onClose}><X size={20} /></button>
          </div>
          <label className="mx-3 mb-2 flex items-center gap-2 rounded-full bg-white/[0.07] px-3">
            <Search size={14} className="text-zinc-500 shrink-0" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the guide" aria-label="Search the guide" className="flex-1 bg-transparent py-2 touch:py-2.5 text-[13.5px] touch:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none" data-testid="help-search" />
          </label>
          <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto px-3 pb-3 dg-noscrollbar dg-fade-r-narrow" data-testid="help-chapters">
            {SECTIONS.map(s => (
              <li key={s.id} className="shrink-0">
                <button onClick={() => { setQ(""); setSection(s.id); }} aria-current={!found && section === s.id ? "page" : undefined}
                  className={`w-full flex items-center gap-2.5 rounded-[12px] px-3 py-2 touch:min-h-[44px] text-left text-[13.5px] whitespace-nowrap ${!found && section === s.id ? "bg-white/[0.14] text-zinc-50 font-semibold" : "text-zinc-300"}`}>
                  <span className={!found && section === s.id ? "text-orange-300" : "text-zinc-500"}>{ICONS[s.id]}</span>{s.short ?? s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {/* The chapter, or what the search found */}
        <div ref={body} className="flex-1 min-h-0 overflow-y-auto dg-scroll px-4 md:px-7 pt-2 md:pt-6 pb-8 relative">
          <button aria-label="Close" className="hidden md:flex absolute right-4 top-4 w-9 h-9 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-50" onClick={onClose}><X size={18} /></button>
          {found ? (
            <>
              <h2 className="text-[20px] font-bold text-zinc-50 mb-1">{found.length ? `${found.length} found` : "Nothing found"}</h2>
              <p className="text-[13px] text-zinc-400 mb-4">{found.length ? "Show me goes straight to the setting." : touch ? "Try another word, or use Search in the menu to find holes and names too." : "Try another word, or press Ctrl+K on the map to search holes and names too."}</p>
              <div className="space-y-3">{found.map(t => <TopicCard key={t.id} t={t} onShow={show} lit={false} />)}</div>
            </>
          ) : (
            <>
              <h2 className="text-[22px] font-bold text-zinc-50 pr-10">{sec.title}</h2>
              <p className="text-[14px] leading-relaxed text-zinc-300 mt-1.5 mb-4 max-w-[640px]">{sec.intro}</p>
              {ART[section]?.map((A, i) => <div key={i} className="mb-4 max-w-[640px]"><A /></div>)}
              {section === "keys" ? <KeysSection touch={touch} /> : (
                <div className="grid gap-3 lg:grid-cols-2">{topics.map(t => <TopicCard key={t.id} t={t} onShow={show} lit={lit === t.id} />)}</div>
              )}
              {/* (the next chapter, to read on) */}
              {(() => {
                const i = SECTIONS.findIndex(s => s.id === section), next = SECTIONS[i + 1];
                return next ? <button className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-4 py-2 text-[13.5px] font-semibold text-zinc-100" onClick={() => setSection(next.id)}>Next: {next.title} <ArrowRight size={14} /></button> : null;
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
