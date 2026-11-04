// A course shared with you to look at: its totals, its holes (one click goes to a hole) and the
// picked hole's numbers. Nothing in it changes the course.
import { useMemo } from "react";
import { Copy, Eye } from "lucide-react";
import { TEE_LEVELS } from "../constants";
import { holeTees } from "../lib/course";
import { courseStats, courseTotals } from "../lib/holeStats";
import { fmtDist, fmtElev } from "../lib/units";
import { select } from "../state/actions";
import { useCourse, useEditor } from "../state/course";
import { getView } from "../state/view";
import { Section, Facts } from "../components/ui";
import { copyCourse, holesOf } from "./courses";
import { useAllowed } from "./perms";
import { Downloads } from "./Downloads";
import { holeFacts } from "./holeFacts";

export function ViewerPanelBody() {
  const doc = useCourse(s => s.doc);
  const ed = useEditor();
  const stats = useMemo(() => courseStats(doc), [doc]);
  const totals = useMemo(() => courseTotals(doc, stats), [doc, stats]);
  const u = doc.units;
  const picked = stats.find(s => s.holeId === ed.selectedId || s.holeId === ed.activeHoleId) ?? null;
  const mayCopy = useAllowed("copy"), mayStats = useAllowed("stats"), may3d = useAllowed("view3d"), mayFly = useAllowed("flyovers");
  const hole = picked ? doc.holes.find(h => h.id === picked.holeId) : null;
  return (
    <div data-testid="viewer-panel">
      <div className="px-4 pt-4 pb-3">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-900/60 text-sky-200 text-[11px] font-semibold mb-2"><Eye size={12} /> View only</span>
        <h2 className="text-lg font-bold text-zinc-50 leading-tight">{doc.name || "Untitled course"}</h2>
        {doc.designer && <p className="text-sm text-zinc-400">{doc.designer}</p>}
        {mayCopy && (
          <button className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-sm font-semibold bg-white/[0.07] hover:bg-white/[0.13] text-zinc-100 border border-white/[0.12]" onClick={() => void copyCourse()} data-testid="copy-course">
            <Copy size={14} /> Make a copy
          </button>
        )}
      </div>
      {mayStats && totals.complete > 0 && (
        <Section>
          <Facts testid="course-totals" items={[["Holes", holesOf(doc)], ["Par", totals.par], ["Length", fmtDist(totals.length, u)]]} />
        </Section>
      )}
      {picked && hole && picked.complete && (may3d || mayFly) && (
        <Section testid="viewer-views">
          <div className="flex flex-wrap gap-2">
            {may3d && <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-sm font-semibold bg-white/[0.07] hover:bg-white/[0.13] text-zinc-100 border border-white/[0.12]" onClick={() => useEditor.getState().set({ teeView: picked.holeId, flyover: false })} data-testid="viewer-tee">From the tee</button>}
            {mayFly && <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-zinc-950" onClick={() => useEditor.getState().set({ view: "3d", teeView: picked.holeId, flyover: true })} data-testid="viewer-fly">▶ Play flyover</button>}
          </div>
        </Section>
      )}
      {mayStats && picked && hole && (
        <Section title={hole.name || `Hole ${picked.label}`} testid="viewer-hole">
          {picked.complete ? (
            <dl className="grid grid-cols-2 gap-1.5">
              {holeFacts({ ...picked, elevation: picked.elevationChange }, u).map(([k, v]) => (
                <div key={k} className="bg-white/[0.07] rounded-lg px-2 py-1.5"><dt className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">{k}</dt><dd className="text-sm font-semibold text-zinc-100">{v}</dd></div>
              ))}
            </dl>
          ) : <p className="text-xs text-zinc-400">Unfinished</p>}
        </Section>
      )}
      <Downloads />
      <Section title={`${stats.length} hole${stats.length === 1 ? "" : "s"}`} testid="hole-list">
        {stats.length === 0 ? <p className="text-xs text-zinc-400">No holes yet.</p> : (
          <ol className="space-y-0.5">
            {stats.map(s => {
              const h = doc.holes.find(x => x.id === s.holeId)!;
              const sel = picked?.holeId === s.holeId;
              const tees = holeTees(doc, s.holeId);
              return (
                <li key={s.holeId}>
                  <button data-testid="hole-row" onClick={() => { select(s.holeId); requestAnimationFrame(() => getView()?.reveal(s.holeId)); }}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 touch:py-2.5 text-left transition-colors ${sel ? "bg-orange-500/15 ring-1 ring-orange-400/60" : "hover:bg-white/[0.09]"}`}>
                    <span className="min-w-[1.5rem] h-6 px-1 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: TEE_LEVELS[s.level].color, color: TEE_LEVELS[s.level].ink }}>{s.label}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-zinc-100 truncate">{h.name || `Hole ${s.label}`}</span>
                      {mayStats && <span className="block text-[11px] text-zinc-400">{s.complete ? <>{fmtDist(s.length, u)} · {fmtElev(s.elevationChange, u)}{tees.length > 1 ? ` · ${tees.length} tees` : ""}</> : "unfinished"}</span>}
                    </span>
                    {mayStats && <span className="text-sm font-bold text-zinc-200 tabular-nums">P{s.par}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}

export const ViewerPanel = () => (
  <aside className="glass w-[340px] shrink-0 rounded-[24px] overflow-y-auto" aria-label="Course" data-testid="side-panel">
    <ViewerPanelBody />
  </aside>
);
