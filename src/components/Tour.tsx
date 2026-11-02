// A walk around the example course for someone new: a card at the top of the screen, one stop at
// a time. Each stop takes the app there (the course, a hole, 3D, the view from a tee, the tools,
// Checks, the printed map, Export) and lights up what it's about. Back and Next, or the arrow keys;
// Esc or × leaves it, wherever it's got to. The last stop offers a course of your own.
import { useEffect } from "react";
import { create } from "zustand";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { getDoc, useEditor } from "../state/course";
import { getView } from "../state/view";
import { select } from "../state/actions";
import { newCourse, openExample } from "../state/files";
import { askOpen, spotlight } from "./showSetting";
import { useLayout, useTouch } from "./useLayout";

/** `title`: its heading (a function: it reads the course); `find`: what it lights up, by test id
 * (`compact`: a phone's or a tablet's controls). */
type Stop = { title: string | (() => string); say: (touch: boolean) => string; go: () => void; find?: (compact: boolean) => string };

const firstHole = () => getDoc().holes[0]?.id ?? null;
const editor = (p: Parameters<ReturnType<typeof useEditor.getState>["set"]>[0]) => useEditor.getState().set({ tool: "select", teeView: null, flyover: false, problemsOpen: false, ...p });
const fit = () => requestAnimationFrame(() => getView()?.fitCourse());
const holeView = () => { const id = firstHole(); if (!id) return; select(id); requestAnimationFrame(() => getView()?.reveal(id)); };

const STOPS: Stop[] = [
  {
    // (named as the example's own file names it)
    title: () => `This is ${getDoc().name || "the example"}`,
    say: t => { const n = getDoc().holes.length; return `An example course, made in GlideLine Studio: ${n} hole${n === 1 ? "" : "s"} laid out on real ground, with its woods, water, paths and buildings. Every hole is drawn on the map: the tee, the basket and the line of play between them, with OB in red. ${t ? "Drag to move around and pinch to zoom." : "Drag to move around and scroll to zoom."}`; },
    go: () => { editor({ step: "design", view: "2d", selectedId: null }); fit(); }
  },
  {
    title: "A hole",
    say: () => "Pick any hole and its panel shows how long it is, its par, how much it climbs, and its tees and pins. Everything there can be changed.",
    go: () => { editor({ step: "design", view: "2d" }); holeView(); },
    find: () => "inspector"
  },
  {
    title: "In 3D",
    say: t => `The same course in 3D, with the real shape of the ground and every tree. ${t ? "Two fingers turn and tilt it." : "Right-drag to turn and tilt it."} 2D and 3D are at the top right${t ? "" : " of the map"}.`,
    go: () => { editor({ step: "design", view: "3d" }); holeView(); }
  },
  {
    title: "From the tee",
    say: () => "Each hole can be seen from its tee, the way a player sees it. Play flyover plays the whole hole from tee to basket.",
    go: () => { const id = firstHole(); if (id) editor({ step: "design", view: "3d", teeView: id }); }
  },
  {
    title: "The tools",
    say: () => "The tools along the bottom are named for what you put on the course: OB & rules, Paths & roads, Water, Trees, Grass and Build. Pick one and its choices show up right next to it.",
    go: () => { editor({ step: "design", view: "2d", selectedId: null }); fit(); },
    find: compact => (compact ? "tool-strip" : "tool-bar")
  },
  {
    title: "Checks",
    say: () => "Checks looks over the course for problems as you go, like holes too close together or a tee with no path to it.",
    go: () => { editor({ step: "design", view: "2d", selectedId: null }); },
    find: () => "problems-button"
  },
  {
    title: "The printed map",
    say: () => "Map makes the course map, the tee signs, the hole pages and the scorecard, ready to print. Every piece on a page can be moved, sized and restyled.",
    go: () => editor({ step: "map", designTab: "map", selectedId: null })
  },
  {
    title: "Export",
    say: () => "Export makes the files: PDFs and pictures of the map and signs, the flyover video, and GPS files for the holes.",
    go: () => editor({ step: "export", selectedId: null })
  },
  {
    title: "Your own course",
    say: t => `Change anything you like here. It's all kept in this browser. Start your own course makes a new, empty one and takes you to finding your park. This example stays on the Courses page (${t ? "Courses, in the menu at the top left" : "the logo at the top left"}), along with everything else you make.`,
    go: () => { editor({ step: "design", view: "2d", selectedId: null }); fit(); }
  }
];

export const useTour = create<{ at: number | null }>(() => ({ at: null }));
// (for the tests: the walk's stop, set straight)
if (typeof window !== "undefined") (window as unknown as { __dgTour: typeof useTour }).__dgTour = useTour;

/** Whether the walk has been taken in this browser (the Courses page's main button is New course then). */
const WALKED_KEY = "hyzerlab-walked";
export const walked = () => {
  try { return localStorage.getItem(WALKED_KEY) === "1"; } catch { return false; }
};

/** The walk around the example, from the start (the example opened first). */
export const startTour = async () => {
  await openExample();
  useTour.setState({ at: 0 });
  try { localStorage.setItem(WALKED_KEY, "1"); } catch { /* (private window: kept for now only) */ }
};
const goTo = (n: number) => useTour.setState({ at: Math.max(0, Math.min(STOPS.length - 1, n)) });
const leave = () => { useTour.setState({ at: null }); editor({}); };
/** The walk's end: a new course, and Find your park opened for it (the welcome card has it too). */
const ownCourse = async () => {
  leave();
  await newCourse();
  askOpen("find-site");
};

export function Tour() {
  const at = useTour(s => s.at);
  const touch = useTouch();
  const compact = useLayout() !== "desktop";
  // (at each stop: the app taken there, then what it's about lit up once it's drawn)
  useEffect(() => {
    if (at === null) return;
    const s = STOPS[at];
    s.go();
    const id = s.find?.(compact);
    if (!id) return;
    const t = window.setTimeout(() => { const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`); if (el) spotlight(el); }, 450);
    return () => window.clearTimeout(t);
  }, [at, compact]);
  useEffect(() => {
    if (at === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.("input,textarea,select")) return;
      if (e.key === "Escape") { e.stopImmediatePropagation(); leave(); }
      else if (e.key === "ArrowRight") { e.stopImmediatePropagation(); goTo(at + 1); }
      else if (e.key === "ArrowLeft") { e.stopImmediatePropagation(); goTo(at - 1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at]);
  if (at === null) return null;
  const s = STOPS[at], last = at === STOPS.length - 1;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-[70px] touch:top-[76px] z-[70] w-[min(440px,calc(100%-16px))] glass-solid ring-1 ring-white/15 rounded-[22px] shadow-2xl shadow-black/50 p-4" role="dialog" aria-label="A walk around the example course" data-testid="tour">
      <div className="flex items-start gap-2">
        <Compass size={18} className="text-orange-300 mt-0.5 shrink-0" />
        <h2 className="flex-1 text-[15px] font-bold text-zinc-50" data-testid="tour-title">{typeof s.title === "function" ? s.title() : s.title}</h2>
        <button className="w-8 h-8 -m-1.5 touch:w-11 touch:h-11 touch:-m-3 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-50 hover:bg-white/[0.08]" aria-label="Leave the walk" onClick={leave} data-testid="tour-close"><X size={16} /></button>
      </div>
      <p className="text-[13.5px] leading-snug text-zinc-300 mt-1.5" data-testid="tour-text">{s.say(touch)}</p>
      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 flex gap-1" aria-label={`Stop ${at + 1} of ${STOPS.length}`}>
          {STOPS.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === at ? "w-4 bg-orange-300" : "w-1.5 bg-white/20"}`} />)}
        </div>
        {at > 0 && <button className="h-9 touch:h-11 px-3 rounded-full text-[13px] font-semibold text-zinc-200 hover:bg-white/[0.08] flex items-center gap-1" onClick={() => goTo(at - 1)} data-testid="tour-back"><ArrowLeft size={15} /> Back</button>}
        {last ? (
          <>
            <button className="h-9 touch:h-11 px-3 rounded-full text-[13px] font-semibold text-zinc-200 hover:bg-white/[0.08]" onClick={leave} data-testid="tour-next">Done</button>
            <button className="h-9 touch:h-11 px-4 rounded-full text-[13px] font-bold bg-orange-500 hover:bg-orange-400 text-zinc-950" onClick={() => void ownCourse()} data-testid="tour-own-course">Start your own course</button>
          </>
        ) : (
          <button className="h-9 touch:h-11 px-4 rounded-full text-[13px] font-bold bg-orange-500 hover:bg-orange-400 text-zinc-950 flex items-center gap-1" onClick={() => goTo(at + 1)} data-testid="tour-next">Next <ArrowRight size={15} /></button>
        )}
      </div>
    </div>
  );
}
