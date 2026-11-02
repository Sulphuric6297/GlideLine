// A phone's Map step: its tools along a sheet at the bottom, as the 3D map's are, and what a tool
// opens unfolding under them, the sheet growing and shrinking smoothly with it (the page and its
// picked piece both).
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What's open, kept while it folds away: [what to show, whether it's unfolded]. */
export function useUnfold<T>(open: T | null, ms = 260): [T | null, boolean] {
  const [shown, setShown] = useState<T | null>(open);
  const [unfolded, setUnfolded] = useState(open !== null);
  useEffect(() => {
    if (open !== null) {
      setShown(open);
      // (drawn folded first, so it unfolds; a screen that isn't drawing frames gets there anyway)
      const f = requestAnimationFrame(() => requestAnimationFrame(() => setUnfolded(true)));
      const t = window.setTimeout(() => setUnfolded(true), 80);
      return () => { cancelAnimationFrame(f); window.clearTimeout(t); };
    }
    setUnfolded(false);
    const t = window.setTimeout(() => setShown(null), reduced() ? 0 : ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);
  return [shown, unfolded];
}

/** The sheet itself: the phone's glass bar, floating over the foot of the page as a step's tools
 * and a tool's settings float over the map (mobile/GlassBar). */
export const SHEET = "glass rounded-[26px] mx-2.5 mb-2 border border-white/10 shadow-2xl overflow-hidden";

/** A tool as a step's row has them: its icon over its name, lit when it's the one open. */
export const tileCls = (on: boolean) =>
  `shrink-0 flex-1 min-w-[58px] h-[50px] px-1.5 rounded-[18px] flex flex-col items-center justify-center gap-[3px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 active:bg-white/[0.12]"}`;

/** The settings a tool opens, unfolding under the tools: its name, an X, and the settings. */
export function SheetFold({ unfolded, title, onClose, testid, closeTestid, children }: { unfolded: boolean; title: string; onClose: () => void; testid: string; closeTestid: string; children: ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-reduce:transition-none ${unfolded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col max-h-[min(320px,44dvh)]" data-testid={testid} role="region" aria-label={title} data-page-bar>
          <div className="flex items-center gap-2 pl-4 pr-2 pt-1.5 shrink-0">
            <span className="flex-1 text-[15px] font-bold text-zinc-50">{title}</span>
            <button className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full bg-white/[0.08] text-zinc-100 active:bg-white/[0.16] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={onClose} aria-label="Close" title="Close" data-testid={closeTestid}><X size={18} /></button>
          </div>
          <div className="overflow-y-auto dg-scroll overscroll-contain min-h-0 pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
