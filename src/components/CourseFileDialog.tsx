// Holes from a GPS file: the button that opens one (on the Site step and with the holes), and the
// dialog that shows what it found, lets each point be fixed (a tee or a basket, which hole), and
// brings the holes in, replacing the holes there or added to them, in one undo step.
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { FileUp, MapPinned } from "lucide-react";
import { Dialog } from "../auth/parts";
import { fileCourse, fileExtent, needsLook, readCourseFile, withFileLayouts, type CourseFile, type FilePoint } from "../lib/courseFile";
import { courseFromMap, pinPositions } from "../lib/importSite";
import { geoRefOf } from "../lib/geoRef";
import { holeNumbers } from "../lib/course";
import type { GeoBounds } from "../lib/geo/core";
import type { CourseDoc, CourseItem } from "../types";
import { changeDoc, getDoc, useCourse, useEditor } from "../state/course";
import { toast } from "../state/toast";
import { getView } from "../state/view";
import { Button, FOCUS, HelpLink, Segmented, Select } from "./ui";

/** The file being looked at (null: none), and whether it waits for a site to be brought in. */
export const useCourseFile = create<{ file: CourseFile | null; fileName: string; waiting: boolean }>(() => ({ file: null, fileName: "", waiting: false }));

/** Asks for the site import to open at the park round the file (App opens it). */
export const FIND_PARK_EVENT = "dg-find-park-near";
export type FindParkNear = { bounds: GeoBounds };

const ACCEPT = ".gpx,.kml,.kmz,.geojson,.json,.csv,.txt,.tsv";

const openFile = async (f: File) => {
  try {
    const file = await readCourseFile(f);
    useCourseFile.setState({ file, fileName: f.name, waiting: false });
  } catch (err) {
    toast(err instanceof Error ? err.message : "This file couldn't be read.", "error");
  }
};

/** The button that opens a GPS file of the course's tees and baskets. */
/** `row`: a row of a hole list, under New hole (`short`: "From a GPS file", in the narrow column). */
export function CourseFileButton({ small = true, full = false, row = false, short = false }: { small?: boolean; full?: boolean; row?: boolean; short?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const readOnly = useCourse(s => s.readOnly);
  if (readOnly) return null;
  const pick = () => input.current?.click();
  return (
    <>
      {row ? (
        <button data-testid="course-file" title="Holes from a GPS file (GPX, KML, KMZ, GeoJSON or CSV)" onClick={pick}
          className={`w-full flex items-center gap-2 rounded-[14px] px-2 py-1.5 touch:min-h-[44px] text-[12.5px] font-semibold text-orange-300 ${FOCUS}`}>
          <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-white/[0.1]"><FileUp size={13} /></span>{short ? "From a GPS file" : "Holes from a GPS file"}
        </button>
      ) : (
        <Button small={small} full={full} onClick={pick} testid="course-file" title="GPX, KML, KMZ, GeoJSON or CSV"><FileUp size={14} /> Holes from a GPS file</Button>
      )}
      <input ref={input} type="file" accept={ACCEPT} className="hidden" aria-label="GPS file of the course" data-testid="course-file-input"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openFile(f); }} />
    </>
  );
}

/** Takes every hole off the course with its tees and baskets; what pointed to a hole (a mando, an
 * OB line) stays, belonging to none. */
const withoutHoles = (d: CourseDoc): Pick<CourseDoc, "holes" | "items"> => ({
  holes: [],
  items: d.items.filter(i => i.type !== "tee" && i.type !== "basket").map(i => {
    if (!("holeId" in i) || (!i.holeId && !("alsoHoles" in i && i.alsoHoles?.length))) return i;
    return { ...i, holeId: undefined, ...("alsoHoles" in i ? { alsoHoles: undefined } : {}) } as CourseItem;
  })
});

/** One point's row: its name, a tee or a basket (or left out), and its hole. */
function PointRow({ p, onChange }: { p: FilePoint; onChange: (patch: Partial<FilePoint>) => void }) {
  const role = p.skip ? "skip" : p.role ?? "";
  return (
    <li className="flex items-center gap-1.5 py-1" data-testid="course-file-point">
      <span className="flex-1 min-w-0 truncate text-[12.5px] text-zinc-200" title={p.name}>{p.name || "(no name)"}</span>
      <Select label={`What ${p.name || "this point"} is`} value={role} className="!w-[104px] shrink-0" testid="course-file-role"
        onChange={v => onChange(v === "skip" ? { skip: true, guessed: false } : { skip: false, role: (v || undefined) as FilePoint["role"], guessed: false })}>
        {!p.role && !p.skip && <option value="">Pick one</option>}
        <option value="tee">Tee</option>
        <option value="basket">Basket</option>
        <option value="skip">Leave out</option>
      </Select>
      <label className="shrink-0 flex items-center gap-1 text-[11.5px] text-zinc-400">Hole
        <input type="number" min={1} max={99} inputMode="numeric" aria-label={`Hole for ${p.name || "this point"}`} data-testid="course-file-hole"
          className="w-[52px] bg-white/[0.07] rounded-[10px] px-2 py-1.5 text-sm touch:py-2.5 touch:text-base text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-400/80"
          value={p.hole ?? ""} onChange={e => { const n = parseInt(e.target.value, 10); onChange({ hole: n > 0 && n < 100 ? n : undefined, guessed: false }); }} />
      </label>
    </li>
  );
}

/** The dialog, while a file is being looked at. */
export function CourseFileDialog() {
  const { file, fileName, waiting } = useCourseFile();
  const bounds = useCourse(s => s.doc.site.bounds);
  // (a site brought in for the file: the file again, to bring its holes onto it)
  useEffect(() => { if (waiting && bounds && file) useCourseFile.setState({ waiting: false }); }, [waiting, bounds, file]);
  if (!file || waiting) return null;
  return <Review key={`${fileName}:${file.points.length}`} file={file} fileName={fileName} />;
}

function Review({ file, fileName }: { file: CourseFile; fileName: string }) {
  const [points, setPoints] = useState(file.points);
  const [everything, setEverything] = useState(false);
  const doc = useCourse(s => s.doc);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const close = () => useCourseFile.setState({ file: null, fileName: "", waiting: false });
  const now = useMemo(() => ({ ...file, points }), [file, points]);
  const planned = useMemo(() => fileCourse(now), [now]);
  const ref = geoRefOf(doc);
  const made = useMemo(() => (ref ? courseFromMap(planned, ref) : null), [planned, ref?.north, ref?.west, ref?.width]);
  // (the ones to look at, as they were when the file opened: fixing one keeps it in the list)
  const [toCheck] = useState(() => new Set(file.points.filter(needsLook).map(p => p.id)));
  const change = (id: string, patch: Partial<FilePoint>) => setPoints(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const holes = planned.holes;
  const multiPin = holes.filter(h => (h.baskets?.length ?? 1) > 1).length, multiTee = holes.filter(h => (h.tees?.length ?? 1) > 1).length;
  const n = made ? made.holes.length : holes.length;
  const findPark = () => {
    useCourseFile.setState({ waiting: true });
    window.dispatchEvent(new CustomEvent<FindParkNear>(FIND_PARK_EVENT, { detail: { bounds: fileExtent(now).bounds } }));
  };
  const bring = () => {
    const d0 = getDoc(), r = geoRefOf(d0);
    if (!r) return;
    const replace = mode === "replace" || !d0.holes.length;
    const nums = holeNumbers(d0.holes);
    const out = courseFromMap(planned, r, replace ? new Set() : new Set(nums.values()));
    changeDoc(d => {
      const base = replace ? withoutHoles(d) : { holes: d.holes.map(h => ({ ...h, number: nums.get(h.id) ?? h.number })), items: d.items };
      // (the file's layouts, and its course name on a course that has none of its own yet)
      const named = file.name && d.name === "New Disc Golf Course" ? { name: file.name } : {};
      return { holes: [...base.holes, ...out.holes], items: [...base.items, ...out.items], ...withFileLayouts(d.layouts, d.activeLayout, file.layouts), ...named };
    });
    close();
    if (useEditor.getState().step === "site") useEditor.getState().set({ step: "design", tool: "select" });
    setTimeout(() => getView()?.fitSite(), 50);
    toast(`Brought in ${out.holes.length} ${out.holes.length === 1 ? "hole" : "holes"} from ${fileName}.`, "success", true);
  };
  const pinsOf = (h: (typeof holes)[number]) => pinPositions((h.baskets ?? [{ at: h.basket }]).map(b => b.tag)).filter(Boolean).join(", ");
  const checkList = points.filter(p => toCheck.has(p.id));
  return (
    <Dialog title="Holes from a GPS file" onClose={close} wide testid="course-file-dialog">
      <p className="text-[13px] text-zinc-300 mb-3" data-testid="course-file-summary">
        {`${fileName}: ${holes.length} ${holes.length === 1 ? "hole" : "holes"}`}
        {multiPin ? `, ${multiPin} with more than one pin` : ""}{multiTee ? `${multiPin ? " and" : ","} ${multiTee} with more than one tee` : ""}.
        {file.layouts?.length ? ` ${file.layouts.length === 1 ? "Layout" : "Layouts"}: ${file.layouts.map(l => l.name).join(", ")}.` : ""}
        {" "}<HelpLink topic="gps-holes" label="Holes from a GPS file" over />
      </p>
      {!ref && (
        <div className="rounded-[16px] bg-orange-500/[0.12] ring-1 ring-orange-400/30 p-3 mb-3" data-testid="course-file-no-site">
          <p className="text-[13px] text-orange-100 mb-2">This course has no site yet. Find the park first, then the holes go on it.</p>
          <Button small tone="primary" onClick={findPark} testid="course-file-find-park"><MapPinned size={14} /> Find the park there</Button>
        </div>
      )}
      {made && made.outside > 0 && <p className="text-[12.5px] text-amber-200 mb-2" data-testid="course-file-outside">{`${made.outside} ${made.outside === 1 ? "hole is" : "holes are"} past the site's edges and ${made.outside === 1 ? "stays" : "stay"} out. Change the area on the Site step to take ${made.outside === 1 ? "it" : "them"} in.`}</p>}
      {made && made.dropped > 0 && <p className="text-[12.5px] text-amber-200 mb-2">{`${made.dropped} ${made.dropped === 1 ? "tee or pin stays" : "tees or pins stay"} out: a hole has up to four pins (A to D) and one tee of each color.`}</p>}
      {checkList.length > 0 && (
        <div className="mb-3" data-testid="course-file-check">
          <h3 className="text-[12px] font-semibold text-zinc-400 mb-0.5">{`Check these (${checkList.length})`}</h3>
          <ul className="divide-y divide-white/[0.06]">{checkList.map(p => <PointRow key={p.id} p={p} onChange={patch => change(p.id, patch)} />)}</ul>
        </div>
      )}
      {holes.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-[12px] text-zinc-300 mb-3 tabular-nums" data-testid="course-file-holes">
          {holes.map(h => (
            <li key={h.number} data-testid="course-file-hole-row">{`Hole ${h.number}: ${(h.tees?.length ?? 1) > 1 ? `${h.tees!.length} tees, ` : ""}${(h.baskets?.length ?? 1) > 1 ? `pins ${pinsOf(h)}` : "1 pin"}`}</li>
          ))}
        </ul>
      )}
      <button className={`text-[12px] font-semibold text-orange-300 hover:text-orange-200 mb-2 touch:min-h-[44px] ${FOCUS}`} aria-expanded={everything} onClick={() => setEverything(e => !e)} data-testid="course-file-all">
        {`Every point (${points.length})`}
      </button>
      {everything && <ul className="divide-y divide-white/[0.06] mb-3 max-h-[40vh] overflow-y-auto">{points.map(p => <PointRow key={p.id} p={p} onChange={patch => change(p.id, patch)} />)}</ul>}
      {ref && doc.holes.length > 0 && (
        <div className="mb-3" data-testid="course-file-mode">
          <Segmented label="The holes here" value={mode} onChange={setMode} options={[
            { value: "replace", label: `Replace the ${doc.holes.length} ${doc.holes.length === 1 ? "hole" : "holes"} here` },
            { value: "add", label: "Add these to them" }
          ]} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <span className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-zinc-400" data-testid="course-file-format">What a file can hold <HelpLink topic="course-file-format" label="Course file format" over /></span>
        <Button small onClick={close}>Cancel</Button>
        <Button small tone="primary" disabled={!ref || !n} onClick={bring} testid="course-file-bring">{`Bring in ${n} ${n === 1 ? "hole" : "holes"}`}</Button>
      </div>
    </Dialog>
  );
}
