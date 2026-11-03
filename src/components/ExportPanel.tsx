// The Export step: printable maps, tee signs, scorecards and hole sheets, hole-by-hole pages and
// GPS files, flyover videos, GPS and data files, and the parts list.
import { useEffect, useState, type ReactNode } from "react";
import { Box, ChevronRight, Clapperboard, Crop, FileDown, FileJson, Image as ImageIcon, Link2, Map as MapIcon, Plane, Signpost, Table2, Users, Video } from "lucide-react";
import { editFlyover } from "./FlyoverSettings";
import { LockedRow } from "./DemoNote";
import { SERVER, useAuth } from "../auth/api";
import { useServerCourse } from "../auth/courses";
import JSZip from "jszip";
import { PAPER, paintedForPrint, renderPoster } from "../lib/mapSvg";
import { SIGN_SIZES, renderScorecard, renderTeeSign, type SignSize } from "../lib/teeSign";
import { HOLE_PAGES, renderHolePage, type HolePageSize } from "../lib/holePage";
import { PRICE_LABELS, fmtConcrete, holeGeoJSON, holesCsv, partsCsv, partsList, priceOf, stakeOutCsv, toGPX, toGeoJSON, toKML, type PriceKey } from "../lib/exports";
import { canvasBlob, pdfFromPages, pdfPage, pngUnder, printDpi, svgToCanvas } from "../lib/raster";
import { courseStats, holeStats } from "../lib/holeStats";
import { holeLabel, holeNumber } from "../lib/course";
import { VIDEO_SIZES, VIDEO_HOLD, type VideoResolution } from "../lib/video";
import { autoSeconds, flightClock, flyoverOf, keySeconds } from "../lib/flight";
import { changeDoc, getDoc, useCourse, useEditor } from "../state/course";
import { download, fileName, saveCourseFile } from "../state/files";
import { runExport, useExportJob, type JobControl } from "../state/exportJob";
import { recordVideo, useVideoSettings } from "../state/video";
import { toast } from "../state/toast";
import type { CourseDoc, PaperSize } from "../types";
import { getView } from "../state/view";
import { select } from "../state/actions";
import { reliefOf } from "./useRelief";
import { canopyFor } from "../lib/forest";
import { setStyle } from "./DesignPanel";
import { ExportBanner } from "./ExportProgress";
import { Button, Field, HelpLink, NumberInput, Section, Segmented } from "./ui";

const svgBlob = (svg: string) => new Blob([svg], { type: "image/svg+xml" });
const two = (i: number) => String(i).padStart(2, "0");
// (16 px and a finger's height on touch screens: a phone zooms into smaller text)
const selectCls = "bg-white/[0.07] rounded-lg px-2 py-1.5 touch:py-2.5 text-sm touch:text-base";
/** A row in a rounded list (the Share section's). */
const listRow = "w-full flex items-center gap-3 px-3 py-2.5 touch:py-3.5 text-left";
const rowIcon = "w-7 h-7 rounded-[8px] bg-white/[0.1] flex items-center justify-center text-zinc-200";

/** Hands the file to the browser, and says so (a download can go by unnoticed). */
const save = (blob: Blob, name: string) => {
  download(blob, name);
  toast(`Saved ${name}.`, "success");
};

/** A long export cancelled (its Cancel pressed): stops it between pages. */
const stopIfCancelled = (job: JobControl) => {
  if (job.signal.aborted) throw new DOMException("Cancelled", "AbortError");
};

/** Contours, hill shading and (Forest style) the photo's canopy, for drawing a page. */
const art = async (d: CourseDoc) => ({ ...reliefOf(d), canopy: await canopyFor(d) });

/** Holes with a tee and a basket, in the order of play. */
const playable = (d: CourseDoc) => {
  const stats = courseStats(d);
  return d.holes.filter((_, k) => stats[k].complete);
};

/** Seconds of video for the holes (each one's flight, by itself or through its keyframes, over the
 * ground as the map has it). */
const videoSeconds = (d: CourseDoc, ids: string[]) =>
  ids.reduce((t, id) => {
    const h = d.holes.find(x => x.id === id);
    if (!h) return t;
    const set = flyoverOf(d, h);
    const keyed = !!h.flyKeys && h.flyKeys.length >= 2;
    const ground = (x: number, y: number) => getView()?.groundHeight(x, y) ?? 0;
    const flight = keyed ? keySeconds(h.flyKeys!, set, ground).reduce((a, b) => a + b, 0) : autoSeconds(holeStats(d, h).length, set);
    // (as it plays: slowing to a stop at the end)
    return t + flightClock(flight, !keyed).play + VIDEO_HOLD.intro + VIDEO_HOLD.outro;
  }, 0);
const minSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

/** The page the preview beside the panel shows (the Map step's tab). */
type Preview = "map" | "sign" | "page" | "scorecard";
const showPage = (tab: Preview) => { if (useEditor.getState().designTab !== tab) useEditor.getState().set({ designTab: tab }); };

/** One kind of file: a size or hole to pick on its own line, the formats in a row under it, and a
 * line about it. Using any of it turns the preview to its page (`tab`). */
function Row({ icon, title, help, pick, hint, tab, children }: { icon: ReactNode; title: string; help?: string; pick?: ReactNode; hint?: string; tab?: Preview; children: ReactNode }) {
  const show = tab ? () => showPage(tab) : undefined;
  return (
    <div className="mb-3" onPointerDownCapture={show} onFocusCapture={show}>
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100 mb-1.5">{icon}{title}{help && <HelpLink topic={help} label={title} />}</div>
      {pick && <div className="mb-1.5">{pick}</div>}
      <div className="flex flex-wrap gap-1.5">{children}</div>
      {hint && <p className="text-[11px] text-zinc-500 mt-1.5">{hint}</p>}
    </div>
  );
}

export function ExportPanel() {
  const doc = useCourse(s => s.doc);
  const job = useExportJob(s => s.job);
  const busy = !!job;
  // (the course's sizes: the ones the Map step shows)
  const signSize: SignSize = doc.style.signSize ?? "18x12";
  const setSignSize = (v: SignSize) => setStyle({ signSize: v });
  const [pagePick, setPagePick] = useState<string>("all");
  const pageSize: HolePageSize = doc.style.holePageSize ?? "letter";
  const setPageSize = (v: HolePageSize) => setStyle({ holePageSize: v });
  const [videoPick, setVideoPick] = useState<string>("all");
  const [signPick, setSignPick] = useState<string>("all");
  const video = useVideoSettings();
  const flyLook = useEditor(e => e.flyLook);
  const readOnly = useCourse(s => s.readOnly);
  const geo = !!doc.site.bounds;
  const complete = playable(doc);
  const pageHole = complete.find(h => h.id === pagePick) ?? null;
  const signHole = complete.find(h => h.id === signPick) ?? null;
  const videoHoles = videoPick === "all" ? complete.map(h => h.id) : complete.some(h => h.id === videoPick) ? [videoPick] : complete.map(h => h.id);
  // (the 3D view's picture, small: taken again each time the step opens)
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => { try { setThumb(getView()?.capture(480, 270) ?? null); } catch { setThumb(null); } });
    return () => cancelAnimationFrame(raf);
  }, []);
  /** The hole's flyover, or the Flyover editor on it. */
  const fromTee = (edit: boolean) => {
    const id = videoHoles[0];
    if (id && edit) editFlyover(id);
    else if (id) useEditor.getState().set({ teeView: id, teeViewTee: null, flyCam: false, flyover: true });
  };

  // (a QR code on what's printed with no link yet: said, the export goes ahead)
  const warnQr = (label: string) => {
    const st = getDoc().style;
    const on: [RegExp, string, { kind: string; url?: string }[] | undefined][] = [[/^Course map/, "course map", st.mapExtras], [/^Tee sign/, "tee signs", st.sign?.extras], [/^Hole (pages|pictures)/, "hole pages", st.holePage?.extras], [/^Scorecard/, "scorecard", st.scorecard?.extras]];
    const hit = on.find(([re, , xs]) => re.test(label) && (xs ?? []).some(x => x.kind === "qr" && !x.url?.trim()));
    if (hit) toast(`A QR code on the ${hit[1]} has no link yet.`, "info", false, undefined, 8000);
  };
  const run = (label: string, fn: (job: JobControl) => Promise<void> | void) => () => { warnQr(label); void runExport(label, fn); };
  // (page after page: Cancel stops it between them)
  const runLong = (label: string, fn: (job: JobControl) => Promise<void> | void) => () => { warnQr(label); void runExport(label, fn, { cancellable: true }); };

  // Prints at print resolution: 300 dpi, less on big posters (see printDpi), the map painted to match
  const poster = async (d: CourseDoc, job: JobControl) => {
    const a = await art(d);
    job.progress(null, "Painting the map");
    const p = await paintedForPrint(page => printDpi(page.width, page.height), () => renderPoster(d, a));
    return { p, dpi: printDpi(p.width, p.height) };
  };
  const mapPdf = run("Course map PDF", async job => {
    const d = getDoc();
    const { p, dpi } = await poster(d, job);
    job.progress(null, "Making the PDF");
    save(await pdfFromPages([await pdfPage(await svgToCanvas(p.svg, p.width, p.height, dpi), p.width, p.height)]), fileName(d, "-map.pdf"));
  });
  const mapPng = run("Course map PNG", async job => {
    const d = getDoc();
    const { p, dpi } = await poster(d, job);
    job.progress(null, "Making the picture");
    save(await canvasBlob(await svgToCanvas(p.svg, p.width, p.height, dpi)), fileName(d, "-map.png"));
  });
  const mapSvg = run("Course map SVG", async job => {
    const d = getDoc();
    save(svgBlob((await poster(d, job)).p.svg), fileName(d, "-map.svg"));
  });
  /** The holes picked for the tee signs (every hole, or one), as they are now. */
  const pickedSigns = (d: CourseDoc) => (signHole ? d.holes.filter(h => h.id === signHole.id) : d.holes);
  const signsPdf = runLong(signHole ? "Tee sign PDF" : "Tee signs PDF", async job => {
    const d = getDoc();
    const holes = pickedSigns(d);
    if (!holes.length) throw new Error("No hole to export yet.");
    const relief = await art(d);
    const pages = [];
    for (const [i, h] of holes.entries()) {
      stopIfCancelled(job);
      job.progress(i / holes.length, `Tee sign ${i + 1} of ${holes.length}`);
      const s = await paintedForPrint(page => (page ? printDpi(page.width, page.height) : 72), () => renderTeeSign(d, h.id, signSize, relief));
      if (!s) continue;
      const dpi = printDpi(s.width, s.height);
      pages.push(await pdfPage(await svgToCanvas(s.svg, s.width, s.height, dpi), s.width, s.height));
    }
    stopIfCancelled(job);
    job.progress(null, "Making the PDF");
    save(await pdfFromPages(pages), fileName(d, holes.length === 1 ? `-tee-sign-${holeNumber(d, holes[0].id)}.pdf` : "-tee-signs.pdf"));
  });
  // (one hole's sign: a picture under UDisc's 5 MB, or the drawing)
  const oneSign = async (d: CourseDoc) => {
    if (!signHole) throw new Error("Pick a hole first.");
    const relief = await art(d);
    const s = await paintedForPrint(150, () => renderTeeSign(d, signHole.id, signSize, relief));
    if (!s) throw new Error("That hole has no tee sign yet.");
    return s;
  };
  const signPng = run("Tee sign PNG", async () => {
    const d = getDoc();
    const s = await oneSign(d);
    save(await pngUnder(s.svg, s.width, s.height, 4.8 * 1024 * 1024, 150), fileName(d, `-tee-sign-${holeNumber(d, signHole!.id)}.png`));
  });
  const signSvg = run("Tee sign SVG", async () => {
    const d = getDoc();
    save(svgBlob((await oneSign(d)).svg), fileName(d, `-tee-sign-${holeNumber(d, signHole!.id)}.svg`));
  });
  // (a hole picked: the preview shows its sign)
  const pickSign = (id: string) => {
    setSignPick(id);
    useEditor.getState().set({ designTab: "sign", ...(id !== "all" ? { designHole: id } : {}) });
  };
  const signsZip = runLong("Tee sign pictures", async job => {
    const d = getDoc();
    const relief = await art(d);
    const zip = new JSZip();
    for (let i = 0; i < d.holes.length; i++) {
      stopIfCancelled(job);
      job.progress(i / d.holes.length, `Tee sign ${i + 1} of ${d.holes.length}`);
      const s = await paintedForPrint(150, () => renderTeeSign(d, d.holes[i].id, signSize, relief));
      if (!s) continue;
      // UDisc takes tee sign pictures up to 5 MB
      const no = two(holeNumber(d, d.holes[i].id));
      zip.file(`hole-${no}.png`, await pngUnder(s.svg, s.width, s.height, 4.8 * 1024 * 1024, 150));
      zip.file(`hole-${no}.svg`, s.svg);
    }
    stopIfCancelled(job);
    job.progress(null, "Making the ZIP");
    save(await zip.generateAsync({ type: "blob" }), fileName(d, "-tee-signs.zip"));
  });
  const scorecardPdf = run("Scorecard PDF", async () => {
    const d = getDoc();
    const s = renderScorecard(d);
    save(await pdfFromPages([await pdfPage(await svgToCanvas(s.svg, s.width, s.height, 300), s.width, s.height)]), fileName(d, "-scorecard.pdf"));
  });
  // (the 3D view as it was left on the Design step, nothing picked)
  const snapshot = run("Picture of the 3D view", async () => {
    select(null);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const url = getView()?.capture(1920, 1080);
    if (!url) {
      toast("The 3D view isn't ready yet. Open the Design step once, then try again.", "info");
      return;
    }
    save(await (await fetch(url)).blob(), fileName(getDoc(), "-3d.png"));
  });
  const text = (label: string, content: () => string, suffix: string, type: string) => run(label, () => save(new Blob([content()], { type }), fileName(getDoc(), suffix)));

  // --- Hole by hole

  /** The holes picked for the hole pages (all of them, or one), as they are now. */
  const pickedPages = (d: CourseDoc) => (pagePick === "all" ? playable(d) : playable(d).filter(h => h.id === pagePick));
  const holeSuffix = (d: CourseDoc, id: string) => `-hole-${holeNumber(d, id)}`;
  const pagesPdf = runLong("Hole pages PDF", async job => {
    const d = getDoc();
    const holes = pickedPages(d);
    if (!holes.length) throw new Error("No hole to export yet.");
    const relief = await art(d);
    const pages = [];
    for (const [i, h] of holes.entries()) {
      stopIfCancelled(job);
      job.progress(i / holes.length, `Hole page ${i + 1} of ${holes.length}`);
      const dpi = HOLE_PAGES[pageSize].dpi;
      const p = (await paintedForPrint(dpi, () => renderHolePage(d, h.id, pageSize, relief)))!;
      pages.push(await pdfPage(await svgToCanvas(p.svg, p.width, p.height, dpi), p.width, p.height));
    }
    stopIfCancelled(job);
    job.progress(null, "Making the PDF");
    save(await pdfFromPages(pages), fileName(d, holes.length === 1 ? `${holeSuffix(d, holes[0].id)}.pdf` : "-hole-pages.pdf"));
  });
  const pagesZip = runLong("Hole pictures", async job => {
    const d = getDoc();
    const holes = pickedPages(d);
    if (!holes.length) throw new Error("No hole to export yet.");
    const relief = await art(d);
    const zip = new JSZip();
    for (const [i, h] of holes.entries()) {
      stopIfCancelled(job);
      job.progress(i / holes.length, `Hole picture ${i + 1} of ${holes.length}`);
      const p = (await paintedForPrint(HOLE_PAGES[pageSize].dpi, () => renderHolePage(d, h.id, pageSize, relief)))!;
      zip.file(`hole-${two(holeNumber(d, h.id))}.png`, await canvasBlob(await svgToCanvas(p.svg, p.width, p.height, HOLE_PAGES[pageSize].dpi)));
    }
    stopIfCancelled(job);
    job.progress(null, "Making the ZIP");
    save(await zip.generateAsync({ type: "blob" }), fileName(d, "-hole-pages.zip"));
  });
  const onePage = async (d: CourseDoc) => {
    if (!pageHole) throw new Error("Pick a hole first.");
    const relief = await art(d);
    return (await paintedForPrint(HOLE_PAGES[pageSize].dpi, () => renderHolePage(d, pageHole.id, pageSize, relief)))!;
  };
  const pagePng = run("Hole picture", async () => {
    const d = getDoc();
    const p = await onePage(d);
    save(await canvasBlob(await svgToCanvas(p.svg, p.width, p.height, HOLE_PAGES[pageSize].dpi)), fileName(d, `${holeSuffix(d, pageHole!.id)}.png`));
  });
  const pageSvg = run("Hole SVG", async () => {
    const d = getDoc();
    save(svgBlob((await onePage(d)).svg), fileName(d, `${holeSuffix(d, pageHole!.id)}.svg`));
  });
  const pageGeo = run("Hole GeoJSON", () => {
    const d = getDoc();
    if (!pageHole) throw new Error("Pick a hole first.");
    save(new Blob([holeGeoJSON(d, pageHole.id)], { type: "application/geo+json" }), fileName(d, `${holeSuffix(d, pageHole.id)}.geojson`));
  });
  // (a hole picked: the preview shows its page)
  const pickPage = (id: string) => {
    setPagePick(id);
    useEditor.getState().set({ designTab: "page", ...(id !== "all" ? { designHole: id } : {}) });
  };

  const parts = partsList(doc);
  // (live while typed; one undo step when the field is left, not one a keystroke)
  const setPrice = (key: PriceKey, v: number) => changeDoc(d => ({ rules: { ...d.rules, prices: { ...d.rules.prices, [key]: v } } }), false);
  const pricesDone = () => useCourse.getState().commit();

  const nothing = !complete.length;
  // (only the owner makes public links: others share with people)
  const owner = useServerCourse(s => s.role) === "owner";
  const shares = ([["public", <Link2 key="l" size={16} />, "Public link"], ["people", <Users key="u" size={16} />, "People"]] as const).filter(([t]) => owner || t === "people");
  // (the course file first: in the demo, the one way to share that works)
  const courseFile = (
    <div className={listRow}>
      <span className={rowIcon}><FileJson size={16} /></span>
      <span className="flex-1 min-w-0 text-[13.5px] text-zinc-100">Course file</span>
      <Button small onClick={() => { saveCourseFile(); toast(`Saved ${fileName(getDoc(), ".dgcourse.json")}.`, "success"); }} disabled={busy} testid="export-file"><FileDown size={13} /> Save</Button>
    </div>
  );
  const which = (label: string, testid: string, value: string, onChange: (v: string) => void, all = "All holes") => (
    <Field label="Which holes">
      <select aria-label={label} data-testid={testid} className={`${selectCls} w-full`} value={value} onChange={e => onChange(e.target.value)} disabled={nothing}>
        <option value="all">{all}{complete.length ? ` (${complete.length})` : ""}</option>
        {complete.map(h => <option key={h.id} value={h.id}>Hole {holeLabel(doc, h.id)}{h.name ? ` · ${h.name}` : ""}</option>)}
      </select>
    </Field>
  );
  return (
    <>
      <ExportBanner />
      {/* (why most of the buttons below are off) */}
      {nothing && <p className="mx-4 mb-2 rounded-[14px] bg-white/[0.06] px-3 py-2 text-[12.5px] text-zinc-300" data-testid="export-needs-hole">No hole has a tee and a basket yet.</p>}
      {SERVER && (
        <Section title="Share" testid="export-share">
          <div className="rounded-[16px] bg-white/[0.06] overflow-hidden divide-y divide-white/[0.07]">
            {courseFile}
            {shares.map(([t, icon, label]) => (
              <button key={t} data-testid={`export-share-${t}`} onClick={() => useAuth.getState().share(t)} className={listRow}>
                <span className={rowIcon}>{icon}</span>
                <span className="flex-1 min-w-0 text-[13.5px] text-zinc-100">{label}</span>
                <ChevronRight size={15} className="text-zinc-500" />
              </button>
            ))}
          </div>
        </Section>
      )}
      {!SERVER && (
        <Section title="Share" testid="export-share">
          <div className="rounded-[16px] bg-white/[0.06] overflow-hidden divide-y divide-white/[0.07]">
            {courseFile}
            <LockedRow id="site" icon={<Link2 size={16} />} label="Public link" />
            <LockedRow id="share" icon={<Users size={16} />} label="People" />
          </div>
        </Section>
      )}
      <Section title="Print" help="print">
        <Row icon={<MapIcon size={15} className="text-orange-300" />} title="Course map" tab="map" pick={
          <Field label="Paper size"><select aria-label="Map paper" className={`${selectCls} w-full`} value={doc.style.paper} onChange={e => setStyle({ paper: e.target.value as PaperSize })}>
            {(Object.keys(PAPER) as PaperSize[]).map(p => <option key={p} value={p}>{PAPER[p].label}</option>)}
          </select></Field>
        }>
          <Button small onClick={mapPdf} disabled={busy} testid="export-map-pdf"><FileDown size={13} /> PDF</Button>
          <Button small onClick={mapPng} disabled={busy} testid="export-map-png"><ImageIcon size={13} /> PNG</Button>
          <Button small onClick={mapSvg} disabled={busy} testid="export-map-svg">SVG</Button>
        </Row>
        <Row icon={<Signpost size={15} className="text-orange-300" />} title="Tee signs" tab="sign" pick={
          <>
            {which("Tee signs to export", "sign-pick", signHole ? signHole.id : "all", pickSign)}
            <Field label="Sign size"><select aria-label="Tee sign size" className={`${selectCls} w-full`} value={signSize} onChange={e => setSignSize(e.target.value as SignSize)}>
              {(Object.keys(SIGN_SIZES) as SignSize[]).map(p => <option key={p} value={p}>{SIGN_SIZES[p].label}</option>)}
            </select></Field>
          </>
        }>
          <Button small onClick={signsPdf} disabled={busy || nothing} testid="export-signs-pdf"><FileDown size={13} /> PDF</Button>
          {!signHole && <Button small onClick={signsZip} disabled={busy || nothing} testid="export-signs-zip"><ImageIcon size={13} /> Pictures (ZIP)</Button>}
          {signHole && (
            <>
              <Button small onClick={signPng} disabled={busy} testid="export-sign-png"><ImageIcon size={13} /> PNG</Button>
              <Button small onClick={signSvg} disabled={busy} testid="export-sign-svg">SVG</Button>
            </>
          )}
        </Row>
        <Row icon={<Table2 size={15} className="text-orange-300" />} title="Scorecard" tab="scorecard">
          <Button small onClick={scorecardPdf} disabled={busy || nothing} testid="export-scorecard"><FileDown size={13} /> PDF</Button>
          <Button small onClick={run("Scorecard SVG", () => save(svgBlob(renderScorecard(getDoc()).svg), fileName(getDoc(), "-scorecard.svg")))} disabled={busy || nothing}>SVG</Button>
        </Row>
      </Section>
      <Section title="Hole by hole" testid="hole-exports" help="hole-by-hole">
        <div onPointerDownCapture={() => showPage("page")} onFocusCapture={() => showPage("page")}>
          {which("Hole to export", "hole-pick", pageHole ? pageHole.id : "all", pickPage)}
          <Field label="Page size">
            <select aria-label="Hole page size" data-testid="hole-page-size" className={`${selectCls} w-full`} value={pageSize} onChange={e => setPageSize(e.target.value as HolePageSize)}>
              {(Object.keys(HOLE_PAGES) as HolePageSize[]).map(k => <option key={k} value={k}>{HOLE_PAGES[k].label}</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button small onClick={pagesPdf} disabled={busy || nothing} testid="export-holes-pdf"><FileDown size={13} /> PDF</Button>
            {!pageHole && <Button small onClick={pagesZip} disabled={busy || nothing} testid="export-holes-zip"><ImageIcon size={13} /> Pictures (ZIP)</Button>}
            {pageHole && (
              <>
                <Button small onClick={pagePng} disabled={busy} testid="export-hole-png"><ImageIcon size={13} /> PNG</Button>
                <Button small onClick={pageSvg} disabled={busy} testid="export-hole-svg">SVG</Button>
                <Button small onClick={pageGeo} disabled={busy || !geo} title={geo ? undefined : "Needs the course's real place"} testid="export-hole-geojson">GeoJSON</Button>
              </>
            )}
          </div>
          {pageHole && !geo && <p className="text-[11px] text-zinc-500 mt-1.5" data-testid="hole-geojson-why">Needs the site brought in.</p>}
        </div>
      </Section>
      <Section title="3D" testid="export-3d-section">
        <Row icon={<Box size={15} className="text-orange-300" />} title="Picture of the 3D view" help="picture-3d" pick={
          thumb
            ? <img src={thumb} alt="" className="block w-full max-w-[240px] aspect-video object-cover rounded-[12px] ring-1 ring-white/15" draggable={false} data-testid="export-3d-thumb" />
            : <div className="w-full max-w-[240px] aspect-video rounded-[12px] bg-white/[0.06] ring-1 ring-white/10 flex items-center justify-center text-zinc-500" data-testid="export-3d-thumb"><Box size={22} /></div>
        }>
          <Button small onClick={snapshot} disabled={busy} testid="export-3d"><ImageIcon size={13} /> PNG</Button>
          <Button small onClick={() => useEditor.getState().set({ step: "design", view: "3d", teeView: null, flyover: false })} testid="export-3d-frame"><Crop size={13} /> Frame it</Button>
        </Row>
        <div className="pt-1" data-testid="video-export">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100 mb-1.5"><Clapperboard size={15} className="text-orange-300" />Flyover video<HelpLink topic="video" label="Flyover video" /></div>
        {which("Holes to fly over", "video-holes", videoHoles.length === 1 && videoPick !== "all" ? videoPick : "all", setVideoPick)}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Field label="Size">
            <select aria-label="Video size" data-testid="video-resolution" className={`${selectCls} w-full`} value={video.resolution} onChange={e => video.set({ resolution: e.target.value as VideoResolution })}>
              {(Object.keys(VIDEO_SIZES) as VideoResolution[]).map(k => <option key={k} value={k}>{VIDEO_SIZES[k].label}</option>)}
            </select>
          </Field>
          <Field label="Frame rate">
            <Segmented label="Frame rate" value={video.fps} onChange={v => video.set({ fps: v })} options={[{ value: 30, label: "30 fps" }, { value: 60, label: "60 fps" }]} />
          </Field>
        </div>
        {/* (the same setting as the tee view's: the ground flyovers show, on screen and in videos) */}
        <Field label="Ground">
          <div data-testid="video-ground"><Segmented label="Ground" value={flyLook} onChange={v => useEditor.getState().set({ flyLook: v })} options={[{ value: "painted", label: "Painted map" }, { value: "photo", label: "Photo" }]} /></div>
        </Field>
        {/* (the camera is set where its flight is seen: the view from the tee, its Settings) */}
        <div className="flex flex-wrap gap-1.5 mb-3" data-testid="video-camera">
          <Button small onClick={() => fromTee(false)} disabled={nothing} testid="video-fly"><Plane size={13} /> Play flyover</Button>
          {!readOnly && <Button small onClick={() => fromTee(true)} disabled={nothing} testid="video-camera-settings"><Video size={13} /> Edit flyover</Button>}
        </div>
        {/* (its progress and Cancel: in the bar at the top of the step) */}
        <Button tone="primary" full onClick={() => void recordVideo(videoHoles)} disabled={busy || nothing} testid="video-record"><Clapperboard size={15} /> Export video of {videoHoles.length === 1 ? `hole ${holeLabel(doc, videoHoles[0])}` : "the course"}</Button>
        {!nothing && <p className="text-[11px] text-zinc-500 mt-1.5">About {minSec(videoSeconds(doc, videoHoles))} of video.</p>}
        </div>
      </Section>
      <Section title="GPS and data" help="gps-files">
        {!geo && (
          <button className="mb-3 w-full flex items-center justify-between rounded-[12px] bg-white/[0.06] px-3 py-2 touch:py-2.5 text-left text-[13px] text-zinc-200 hover:bg-white/[0.09]" onClick={() => useEditor.getState().set({ step: "site", teeView: null, flyover: false })} data-testid="export-bring-site">
            <span>Bring in the site</span>
            <ChevronRight size={15} className="text-zinc-500" />
          </button>
        )}
        <Row icon={<FileJson size={15} className="text-sky-300" />} title="GPS files">
          <Button small onClick={text("KML file", () => toKML(getDoc()), ".kml", "application/vnd.google-earth.kml+xml")} disabled={busy || !geo} testid="export-kml">KML</Button>
          <Button small onClick={text("GeoJSON file", () => toGeoJSON(getDoc()), ".geojson", "application/geo+json")} disabled={busy || !geo} testid="export-geojson">GeoJSON</Button>
          <Button small onClick={text("GPX file", () => toGPX(getDoc()), ".gpx", "application/gpx+xml")} disabled={busy || !geo} testid="export-gpx">GPX</Button>
        </Row>
        <Row icon={<FileJson size={15} className="text-sky-300" />} title="Spreadsheets">
          <Button small onClick={text("Holes spreadsheet", () => holesCsv(getDoc()), "-holes.csv", "text/csv")} disabled={busy || nothing} testid="export-holes-csv">Holes CSV</Button>
          <Button small onClick={text("Stake-out spreadsheet", () => stakeOutCsv(getDoc()), "-stake-out.csv", "text/csv")} disabled={busy || nothing} testid="export-stakeout">Stake-out CSV</Button>
        </Row>
      </Section>
      <Section title="Parts list and budget" testid="parts">
        {parts.lines.length === 0 ? <p className="text-xs text-zinc-400">No holes yet.</p> : (
          <>
            <table className="w-full text-xs text-zinc-300 tabular-nums">
              <tbody>
                {parts.lines.map(l => (
                  <tr key={l.item}>
                    <td className="py-0.5">{l.item}</td>
                    <td className="text-right">{l.qty}</td>
                    <td className="text-right text-zinc-400">× ${l.unitPrice}</td>
                    <td className="text-right font-semibold text-zinc-100">${l.total.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/[0.12]"><td className="pt-1 font-bold text-zinc-100" colSpan={3}>Estimate</td><td className="text-right pt-1 font-bold text-zinc-50" data-testid="parts-total">${parts.total.toLocaleString()}</td></tr>
              </tbody>
            </table>
            <p className="text-[11px] text-zinc-500 mt-1">Concrete for the pads: {fmtConcrete(parts.concreteYd3, doc.units)}</p>
            <details className="mt-2">
              <summary className="text-xs text-orange-300 cursor-pointer">Change prices</summary>
              <div className="grid grid-cols-2 gap-x-2 mt-2">
                {PRICE_LABELS.map(([k, name]) => (
                  <Field key={k} label={name}>
                    <div onBlur={pricesDone}><NumberInput label={`${name} price`} min={0} value={priceOf(doc, k)} onChange={v => setPrice(k, v)} /></div>
                  </Field>
                ))}
              </div>
            </details>
            <div className="mt-2"><Button small onClick={text("Parts list", () => partsCsv(getDoc()), "-parts.csv", "text/csv")} disabled={busy} testid="export-parts">Parts list CSV</Button></div>
          </>
        )}
      </Section>
    </>
  );
}
