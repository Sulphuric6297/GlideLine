// The Export step, as an export dialog is: what can be made, in one list; the one picked shows only
// its own choices and one button that makes it. The preview beside it (a page, or the 3D view for a
// picture or a video) is the thing picked. A computer has the list in the side panel (ExportPanel),
// a phone the thing in the glass bar's pill, its choices along the bar and Download at its end
// (ExportBar). The course file and sharing are first, on both.
import { useContext, useEffect, type ReactNode } from "react";
import { BookOpen, Calculator, ChevronRight, Clapperboard, Download, FileDown, Image as ImageIcon, Map as MapIcon, MapPin, Share2, Signpost, Table2, type LucideIcon } from "lucide-react";
import { showLocked } from "./DemoNote";
import { SERVER, useAuth } from "../auth/api";
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
import { IN_3D, useExportPick, type DataFormat, type ExportThing, type MapFormat, type SheetFormat } from "../state/exportPick";
import { toast } from "../state/toast";
import type { CourseDoc, PaperSize } from "../types";
import { getView } from "../state/view";
import { select } from "../state/actions";
import { reliefOf } from "./useRelief";
import { canopyFor } from "../lib/forest";
import { setStyle } from "./DesignPanel";
import { ExportBanner } from "./ExportProgress";
import { ChipPick, Field, HelpLink, MenuRows, NumberInput, Section, Segmented } from "./ui";
import { ActRow, GlassBar, type BarSetting } from "./mobile/GlassBar";

const svgBlob = (svg: string) => new Blob([svg], { type: "image/svg+xml" });
const two = (i: number) => String(i).padStart(2, "0");

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

// (sizes by their short names: the full one is the chip's tooltip and the menu row's line)
const PAPER_SHORT: Record<PaperSize, string> = { letter: "Letter", tabloid: "Tabloid", "18x24": "18 × 24", "24x36": "24 × 36", "36x48": "36 × 48", a4: "A4", a3: "A3" };
const SIGN_SHORT: Record<SignSize, string> = { "18x12": "18 × 12", "12x18": "12 × 18", "18x24": "18 × 24", letter: "Letter", a4: "A4" };
const PAGE_SHORT: Record<HolePageSize, string> = { letter: "Letter", a4: "A4", card: "4 × 6 card", square: "Square" };
const VIDEO_SHORT: Record<VideoResolution, string> = { "720p": "720p", "1080p": "1080p", "1440p": "1440p", "4k": "4K" };
const sizes = <K extends string>(all: Record<K, { label: string }>, short: Record<K, string>) => (Object.keys(all) as K[]).map(k => ({ value: k, label: short[k], title: all[k].label }));

/** The page each thing shows beside the list (the 3D view for a picture or a video). */
const PAGE_OF: Record<ExportThing, "map" | "sign" | "page" | "scorecard"> = { map: "map", signs: "sign", pages: "page", scorecard: "scorecard", picture: "map", video: "map", data: "map", parts: "map" };

/** Picks the thing to make, its page turned to in the preview. */
export const pickThing = (t: ExportThing) => {
  useExportPick.getState().set({ thing: t });
  const ed = useEditor.getState();
  if (ed.designTab !== PAGE_OF[t]) ed.set({ designTab: PAGE_OF[t] });
  // (a picture or a video of the 3D view: shown in 3D, as it's made)
  if (IN_3D.has(t) && ed.view !== "3d") ed.set({ view: "3d" });
};

/** Every hole, or one: chips on a computer (the hole's number), the menu's rows on a phone. */
function HolePick({ value, onChange, label, testid }: { value: string; onChange: (v: string) => void; label: string; testid: string }) {
  const doc = useCourse(s => s.doc);
  const holes = playable(doc);
  const menu = useContext(MenuRows);
  const options = [{ value: "all", label: menu ? `All ${holes.length} holes` : `All ${holes.length}` }, ...holes.map(h => ({ value: h.id, label: menu ? `Hole ${holeLabel(doc, h.id)}` : holeLabel(doc, h.id), title: h.name || undefined }))];
  return <ChipPick label={label} testid={testid} value={holes.some(h => h.id === value) ? value : "all"} options={options} onChange={onChange} />;
}

/** The parts and what they cost, and the prices to change. */
function PartsTable() {
  const doc = useCourse(s => s.doc);
  const parts = partsList(doc);
  // (live while typed; one undo step when the field is left, not one a keystroke)
  const setPrice = (key: PriceKey, v: number) => changeDoc(d => ({ rules: { ...d.rules, prices: { ...d.rules.prices, [key]: v } } }), false);
  const pricesDone = () => useCourse.getState().commit();
  if (!parts.lines.length) return <p className="text-xs text-zinc-400">No holes yet.</p>;
  return (
    <div data-testid="parts">
      <table className="w-full text-xs text-zinc-300 tabular-nums">
        <tbody>
          {parts.lines.map(l => (
            <tr key={l.item}>
              <td className="py-0.5">{l.item}</td>
              <td className="text-right">{l.qty}</td>
              <td className="text-right text-zinc-400 whitespace-nowrap pl-1">× ${l.unitPrice}</td>
              <td className="text-right font-semibold text-zinc-100">${l.total.toLocaleString()}</td>
            </tr>
          ))}
          <tr className="border-t border-white/[0.12]"><td className="pt-1 font-bold text-zinc-100" colSpan={3}>Estimate</td><td className="text-right pt-1 font-bold text-zinc-50" data-testid="parts-total">${parts.total.toLocaleString()}</td></tr>
        </tbody>
      </table>
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
    </div>
  );
}

/** One of the thing's choices: a computer's field, a phone's bar setting. */
type Choice = { id: string; name: string; value: string; control: ReactNode; wide?: boolean };
type Thing = {
  id: ExportThing;
  name: string;
  icon: LucideIcon;
  /** Its choices in a line, under its name in the list and the pill. */
  summary: string;
  choices: Choice[];
  /** What it makes, on its button (`short`: the phone bar's). */
  go: { label: string; short: string; run: () => void; testid: string; off?: string };
  note?: string;
  help?: string;
};

/** Every thing the step makes, with its choices and how it's made. */
function useThings(): Thing[] {
  const doc = useCourse(s => s.doc);
  const busy = useExportJob(s => !!s.job);
  const pick = useExportPick();
  const video = useVideoSettings();
  const flyGround = useEditor(e => e.flyGround);
  const geo = !!doc.site.bounds;
  const complete = playable(doc);
  const nothing = !complete.length;
  const n = complete.length;
  const signSize: SignSize = doc.style.signSize ?? "18x12";
  const pageSize: HolePageSize = doc.style.holePageSize ?? "letter";
  const one = (id: string) => complete.find(h => h.id === id) ?? null;
  const signHole = one(pick.signHoles), pageHole = one(pick.pageHoles);
  const videoHoles = one(pick.videoHoles) ? [pick.videoHoles] : complete.map(h => h.id);
  const holesShown = (h: { id: string } | null) => (h ? `Hole ${holeLabel(doc, h.id)}` : `All ${n}`);
  // (a sheet's formats: every hole in a PDF or a ZIP of pictures; one hole's page as a picture or drawing too)
  const sheetFormats = (single: boolean, withGeo = false): { value: SheetFormat; label: string }[] =>
    single ? [{ value: "pdf", label: "PDF" }, { value: "png", label: "PNG" }, { value: "svg", label: "SVG" }, ...(withGeo ? [{ value: "geojson" as const, label: "GeoJSON" }] : [])] : [{ value: "pdf", label: "PDF" }, { value: "zip", label: "Pictures (ZIP)" }];
  const formatOf = (f: SheetFormat, ok: { value: SheetFormat }[]) => (ok.some(o => o.value === f) ? f : "pdf");

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

  // --- The course map: at print resolution, 300 dpi, less on big posters (see printDpi), painted to match
  const poster = async (d: CourseDoc, job: JobControl) => {
    const a = await art(d);
    job.progress(null, "Painting the map");
    const p = await paintedForPrint(page => printDpi(page.width, page.height), () => renderPoster(d, a));
    return { p, dpi: printDpi(p.width, p.height) };
  };
  const map: Record<MapFormat, () => void> = {
    pdf: run("Course map PDF", async job => {
      const d = getDoc();
      const { p, dpi } = await poster(d, job);
      job.progress(null, "Making the PDF");
      save(await pdfFromPages([await pdfPage(await svgToCanvas(p.svg, p.width, p.height, dpi), p.width, p.height)]), fileName(d, "-map.pdf"));
    }),
    png: run("Course map PNG", async job => {
      const d = getDoc();
      const { p, dpi } = await poster(d, job);
      job.progress(null, "Making the picture");
      save(await canvasBlob(await svgToCanvas(p.svg, p.width, p.height, dpi)), fileName(d, "-map.png"));
    }),
    svg: run("Course map SVG", async job => {
      const d = getDoc();
      save(svgBlob((await poster(d, job)).p.svg), fileName(d, "-map.svg"));
    })
  };

  // --- Tee signs
  const signsPdf = runLong(signHole ? "Tee sign PDF" : "Tee signs PDF", async job => {
    const d = getDoc();
    const holes = signHole ? d.holes.filter(h => h.id === signHole.id) : d.holes;
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
  const signs: Record<SheetFormat, () => void> = {
    pdf: signsPdf,
    zip: runLong("Tee sign pictures", async job => {
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
    }),
    png: run("Tee sign PNG", async () => {
      const d = getDoc();
      const s = await oneSign(d);
      save(await pngUnder(s.svg, s.width, s.height, 4.8 * 1024 * 1024, 150), fileName(d, `-tee-sign-${holeNumber(d, signHole!.id)}.png`));
    }),
    svg: run("Tee sign SVG", async () => {
      const d = getDoc();
      save(svgBlob((await oneSign(d)).svg), fileName(d, `-tee-sign-${holeNumber(d, signHole!.id)}.svg`));
    }),
    geojson: signsPdf
  };

  // --- Hole pages
  const pickedPages = (d: CourseDoc) => (pageHole ? playable(d).filter(h => h.id === pageHole.id) : playable(d));
  const holeSuffix = (d: CourseDoc, id: string) => `-hole-${holeNumber(d, id)}`;
  const onePage = async (d: CourseDoc) => {
    if (!pageHole) throw new Error("Pick a hole first.");
    const relief = await art(d);
    return (await paintedForPrint(HOLE_PAGES[pageSize].dpi, () => renderHolePage(d, pageHole.id, pageSize, relief)))!;
  };
  const pages: Record<SheetFormat, () => void> = {
    pdf: runLong("Hole pages PDF", async job => {
      const d = getDoc();
      const holes = pickedPages(d);
      if (!holes.length) throw new Error("No hole to export yet.");
      const relief = await art(d);
      const out = [];
      for (const [i, h] of holes.entries()) {
        stopIfCancelled(job);
        job.progress(i / holes.length, `Hole page ${i + 1} of ${holes.length}`);
        const dpi = HOLE_PAGES[pageSize].dpi;
        const p = (await paintedForPrint(dpi, () => renderHolePage(d, h.id, pageSize, relief)))!;
        out.push(await pdfPage(await svgToCanvas(p.svg, p.width, p.height, dpi), p.width, p.height));
      }
      stopIfCancelled(job);
      job.progress(null, "Making the PDF");
      save(await pdfFromPages(out), fileName(d, holes.length === 1 ? `${holeSuffix(d, holes[0].id)}.pdf` : "-hole-pages.pdf"));
    }),
    zip: runLong("Hole pictures", async job => {
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
    }),
    png: run("Hole picture", async () => {
      const d = getDoc();
      const p = await onePage(d);
      save(await canvasBlob(await svgToCanvas(p.svg, p.width, p.height, HOLE_PAGES[pageSize].dpi)), fileName(d, `${holeSuffix(d, pageHole!.id)}.png`));
    }),
    svg: run("Hole SVG", async () => {
      const d = getDoc();
      save(svgBlob((await onePage(d)).svg), fileName(d, `${holeSuffix(d, pageHole!.id)}.svg`));
    }),
    geojson: run("Hole GeoJSON", () => {
      const d = getDoc();
      if (!pageHole) throw new Error("Pick a hole first.");
      save(new Blob([holeGeoJSON(d, pageHole.id)], { type: "application/geo+json" }), fileName(d, `${holeSuffix(d, pageHole.id)}.geojson`));
    })
  };

  const scorecard = {
    pdf: run("Scorecard PDF", async () => {
      const d = getDoc();
      const s = renderScorecard(d);
      save(await pdfFromPages([await pdfPage(await svgToCanvas(s.svg, s.width, s.height, 300), s.width, s.height)]), fileName(d, "-scorecard.pdf"));
    }),
    svg: run("Scorecard SVG", () => save(svgBlob(renderScorecard(getDoc()).svg), fileName(getDoc(), "-scorecard.svg")))
  };
  // (the 3D view as it is in the preview, nothing picked)
  const snapshot = run("Picture of the 3D view", async () => {
    select(null);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const url = getView()?.capture(1920, 1080);
    if (!url) {
      toast("The 3D view isn't ready yet. Try again in a moment.", "info");
      return;
    }
    save(await (await fetch(url)).blob(), fileName(getDoc(), "-3d.png"));
  });
  const text = (label: string, content: () => string, suffix: string, type: string) => run(label, () => save(new Blob([content()], { type }), fileName(getDoc(), suffix)));
  const DATA: Record<DataFormat, { label: string; run: () => void; testid: string; gps: boolean }> = {
    kml: { label: "KML", run: text("KML file", () => toKML(getDoc()), ".kml", "application/vnd.google-earth.kml+xml"), testid: "export-kml", gps: true },
    gpx: { label: "GPX", run: text("GPX file", () => toGPX(getDoc()), ".gpx", "application/gpx+xml"), testid: "export-gpx", gps: true },
    geojson: { label: "GeoJSON", run: text("GeoJSON file", () => toGeoJSON(getDoc()), ".geojson", "application/geo+json"), testid: "export-geojson", gps: true },
    holes: { label: "Holes CSV", run: text("Holes spreadsheet", () => holesCsv(getDoc()), "-holes.csv", "text/csv"), testid: "export-holes-csv", gps: false },
    stakeout: { label: "Stake-out CSV", run: text("Stake-out spreadsheet", () => stakeOutCsv(getDoc()), "-stake-out.csv", "text/csv"), testid: "export-stakeout", gps: false }
  };
  const data = pick.dataFormat ?? (geo ? "kml" : "holes");

  // (why it can't be made just now)
  const off = (needsHole = true) => (busy ? "Another export is under way." : needsHole && nothing ? "No hole has a tee and a basket yet." : undefined);
  const parts = partsList(doc);

  const signFormats = sheetFormats(!!signHole), signFmt = formatOf(pick.signFormat, signFormats);
  const pageFormats = sheetFormats(!!pageHole, true), pageFmt = formatOf(pick.pageFormat, pageFormats);
  const fmtName = (f: string) => (f === "zip" ? "pictures" : f.toUpperCase());
  // (a hole picked: the preview shows its sign or page)
  const holeTo = (key: "signHoles" | "pageHoles", tab: "sign" | "page") => (id: string) => {
    pick.set({ [key]: id });
    useEditor.getState().set({ designTab: tab, ...(id !== "all" ? { designHole: id } : {}) });
  };

  return [
    {
      id: "map", name: "Course map", icon: MapIcon, help: "print",
      summary: `${PAPER_SHORT[doc.style.paper]} · ${pick.mapFormat.toUpperCase()}`,
      choices: [
        { id: "paper", name: "Paper", value: PAPER_SHORT[doc.style.paper], control: <ChipPick label="Map paper" testid="map-paper" value={doc.style.paper} options={sizes(PAPER, PAPER_SHORT)} onChange={v => setStyle({ paper: v })} /> },
        { id: "format", name: "Format", value: pick.mapFormat.toUpperCase(), control: <Segmented label="Map format" value={pick.mapFormat} onChange={v => pick.set({ mapFormat: v })} options={[{ value: "pdf", label: "PDF" }, { value: "png", label: "PNG" }, { value: "svg", label: "SVG" }]} /> }
      ],
      go: { label: `Download ${pick.mapFormat.toUpperCase()}`, short: "Download", run: map[pick.mapFormat], testid: `export-map-${pick.mapFormat}`, off: off(false) },
      note: PAPER[doc.style.paper].label
    },
    {
      id: "signs", name: "Tee signs", icon: Signpost, help: "print",
      summary: `${SIGN_SHORT[signSize]} · ${signHole ? `hole ${holeLabel(doc, signHole.id)}` : `all ${n}`}`,
      choices: [
        { id: "holes", name: "Holes", value: holesShown(signHole), control: <HolePick label="Tee signs to export" testid="sign-pick" value={pick.signHoles} onChange={holeTo("signHoles", "sign")} /> },
        { id: "size", name: "Size", value: SIGN_SHORT[signSize], control: <ChipPick label="Tee sign size" testid="sign-size" value={signSize} options={sizes(SIGN_SIZES, SIGN_SHORT)} onChange={v => setStyle({ signSize: v })} /> },
        { id: "format", name: "Format", value: signFmt === "zip" ? "ZIP" : signFmt.toUpperCase(), control: <Segmented label="Tee sign format" value={signFmt} onChange={v => pick.set({ signFormat: v })} options={signFormats} /> }
      ],
      go: {
        label: signHole ? `Download sign ${holeLabel(doc, signHole.id)} (${signFmt.toUpperCase()})` : `Download ${n} ${signFmt === "zip" ? "sign pictures" : "signs"}`,
        short: "Download", run: signs[signFmt],
        testid: signHole && signFmt !== "pdf" ? `export-sign-${signFmt}` : `export-signs-${signFmt}`, off: off()
      },
      note: signHole ? undefined : signFmt === "zip" ? "A PNG under 5 MB and an SVG a sign, for UDisc." : "One page a sign."
    },
    {
      id: "pages", name: "Hole pages", icon: BookOpen, help: "hole-by-hole",
      summary: `${PAGE_SHORT[pageSize]} · ${pageHole ? `hole ${holeLabel(doc, pageHole.id)}` : `all ${n}`}`,
      choices: [
        { id: "holes", name: "Holes", value: holesShown(pageHole), control: <HolePick label="Hole to export" testid="hole-pick" value={pick.pageHoles} onChange={holeTo("pageHoles", "page")} /> },
        { id: "size", name: "Size", value: PAGE_SHORT[pageSize], control: <div data-testid="hole-page-size"><ChipPick label="Hole page size" value={pageSize} options={sizes(HOLE_PAGES, PAGE_SHORT)} onChange={v => setStyle({ holePageSize: v })} /></div> },
        { id: "format", name: "Format", value: pageFmt === "zip" ? "ZIP" : pageFmt === "geojson" ? "GeoJSON" : pageFmt.toUpperCase(), control: <Segmented label="Hole page format" value={pageFmt} onChange={v => pick.set({ pageFormat: v })} options={pageFormats} /> }
      ],
      go: {
        label: pageHole ? `Download hole ${holeLabel(doc, pageHole.id)} (${pageFmt === "geojson" ? "GeoJSON" : pageFmt.toUpperCase()})` : `Download ${n} ${fmtName(pageFmt) === "pictures" ? "hole pictures" : "hole pages"}`,
        short: "Download", run: pages[pageFmt],
        testid: pageHole && pageFmt !== "pdf" ? `export-hole-${pageFmt}` : `export-holes-${pageFmt}`,
        off: pageFmt === "geojson" && !geo ? "GeoJSON needs the site brought in." : off()
      },
      note: pageFmt === "geojson" && !geo ? "Needs the site brought in." : undefined
    },
    {
      id: "scorecard", name: "Scorecard", icon: Table2, help: "print",
      summary: pick.cardFormat.toUpperCase(),
      choices: [{ id: "format", name: "Format", value: pick.cardFormat.toUpperCase(), control: <Segmented label="Scorecard format" value={pick.cardFormat} onChange={v => pick.set({ cardFormat: v })} options={[{ value: "pdf", label: "PDF" }, { value: "svg", label: "SVG" }]} /> }],
      go: { label: `Download ${pick.cardFormat.toUpperCase()}`, short: "Download", run: scorecard[pick.cardFormat], testid: pick.cardFormat === "pdf" ? "export-scorecard" : "export-scorecard-svg", off: off() }
    },
    {
      id: "picture", name: "3D picture", icon: ImageIcon, help: "picture-3d",
      summary: "1920 × 1080 · PNG",
      choices: [],
      go: { label: "Download PNG", short: "Download", run: snapshot, testid: "export-3d", off: off(false) },
      note: "The 3D view as it is. Move it to frame the picture."
    },
    {
      id: "video", name: "Flyover video", icon: Clapperboard, help: "video",
      summary: `${VIDEO_SHORT[video.resolution]} · ${videoHoles.length === 1 && n > 1 ? `hole ${holeLabel(doc, videoHoles[0])}` : `all ${n}`}${nothing ? "" : ` · ${minSec(videoSeconds(doc, videoHoles))}`}`,
      choices: [
        { id: "holes", name: "Holes", value: holesShown(one(pick.videoHoles)), control: <HolePick label="Holes to fly over" testid="video-holes" value={pick.videoHoles} onChange={v => pick.set({ videoHoles: v })} /> },
        { id: "size", name: "Size", value: VIDEO_SHORT[video.resolution], control: <div data-testid="video-resolution"><Segmented label="Video size" value={video.resolution} onChange={v => video.set({ resolution: v })} options={(Object.keys(VIDEO_SIZES) as VideoResolution[]).map(k => ({ value: k, label: VIDEO_SHORT[k], title: VIDEO_SIZES[k].label }))} /></div> },
        { id: "fps", name: "Frame rate", value: `${video.fps} fps`, control: <Segmented label="Frame rate" value={video.fps} onChange={v => video.set({ fps: v })} options={[{ value: 30, label: "30 fps" }, { value: 60, label: "60 fps" }]} /> },
        // (the same setting as the tee view's: the ground flyovers show, on screen and in videos)
        { id: "ground", name: "Ground", value: flyGround === "ground" ? "Course" : flyGround === "painted" ? "Painted" : "Photo", control: <div data-testid="video-ground"><Segmented label="Ground" value={flyGround} onChange={v => useEditor.getState().set({ flyGround: v })} options={[{ value: "ground", label: "Course", title: "The course's own ground" }, { value: "painted", label: "Painted", title: "The painted map" }, { value: "photo", label: "Photo", title: "The aerial photo" }]} /></div> }
      ],
      go: { label: `Make the video of ${videoHoles.length === 1 && n > 1 ? `hole ${holeLabel(doc, videoHoles[0])}` : "the course"}`, short: "Make", run: () => void recordVideo(videoHoles), testid: "video-record", off: off() },
      note: `${nothing ? "" : `About ${minSec(videoSeconds(doc, videoHoles))} of video. `}The flyovers are set in Design.`
    },
    {
      id: "data", name: "GPS and spreadsheets", icon: MapPin, help: "gps-files",
      summary: "KML, GPX, CSV",
      choices: [{ id: "format", name: "Format", value: DATA[data].label, control: <ChipPick label="GPS or spreadsheet format" testid="data-format" value={data} onChange={v => pick.set({ dataFormat: v })} options={(Object.keys(DATA) as DataFormat[]).map(k => ({ value: k, label: DATA[k].label, title: DATA[k].gps ? "GPS file" : "Spreadsheet" }))} /> }],
      go: { label: `Download ${DATA[data].label}`, short: "Download", run: DATA[data].run, testid: DATA[data].testid, off: DATA[data].gps && !geo ? "GPS files need the site brought in." : off() },
      note: DATA[data].gps && !geo ? "GPS files need the site brought in." : undefined
    },
    {
      id: "parts", name: "Parts and budget", icon: Calculator,
      summary: `$${parts.total.toLocaleString()} · CSV`,
      choices: [{ id: "budget", name: "Estimate", value: `$${parts.total.toLocaleString()}`, wide: true, control: <div className="px-1 py-1"><PartsTable /></div> }],
      go: { label: "Download parts list (CSV)", short: "Download", run: text("Parts list", () => partsCsv(getDoc()), "-parts.csv", "text/csv"), testid: "export-parts", off: off(false) },
      note: parts.lines.length ? `Concrete for the pads: ${fmtConcrete(parts.concreteYd3, doc.units)}` : undefined
    }
  ];
}

/** Saves the course file, and says so. */
const saveFile = () => { saveCourseFile(); toast(`Saved ${fileName(getDoc(), ".dgcourse.json")}.`, "success"); };
/** Sharing: the course's people and its public link (locked in the demo). */
const share = () => (SERVER ? useAuth.getState().share("people") : showLocked("share"));
/** The thing made, or why it can't be yet. */
const make = (t: Thing) => (t.go.off ? toast(t.go.off, "info") : t.go.run());

// (the page beside the list follows the thing picked, from the step's start)
const usePreviewFollows = () => useEffect(() => { pickThing(useExportPick.getState().thing); }, []);

export function ExportPanel() {
  const things = useThings();
  const thing = useExportPick(s => s.thing);
  const busy = useExportJob(s => !!s.job);
  const nothing = !playable(useCourse(s => s.doc)).length;
  usePreviewFollows();
  const top = "flex-1 h-9 touch:h-11 rounded-[11px] bg-white/[0.07] hover:bg-white/[0.11] disabled:opacity-40 flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";
  return (
    <>
      <ExportBanner />
      <div className="flex gap-1.5 px-4 pb-3" data-testid="export-share">
        <button className={top} onClick={saveFile} disabled={busy} data-testid="export-file"><FileDown size={14} /> Save course file</button>
        <button className={top} onClick={share} data-testid={SERVER ? "export-share-people" : "locked-share"}><Share2 size={14} /> Share</button>
      </div>
      {/* (why most of what's below can't be made yet) */}
      {nothing && <p className="mx-4 mb-2 rounded-[14px] bg-white/[0.06] px-3 py-2 text-[12.5px] text-zinc-300" data-testid="export-needs-hole">No hole has a tee and a basket yet.</p>}
      <Section title="Make" testid="export-things">
        <div className="flex flex-col gap-0.5 -mx-1.5">
          {things.map(t => <ThingRow key={t.id} t={t} open={t.id === thing} />)}
        </div>
      </Section>
    </>
  );
}

/** One thing in the list: its name and choices in a line; open, its choices and its button. */
function ThingRow({ t, open }: { t: Thing; open: boolean }) {
  const Icon = t.icon;
  return (
    <div className={`rounded-[14px] transition-colors ${open ? "bg-white/[0.07] ring-1 ring-inset ring-orange-300/35" : ""}`} data-testid={`export-thing-${t.id}`} data-open={open || undefined}>
      <div className="flex items-center pr-2">
        <button className={`flex-1 min-w-0 flex items-center gap-2.5 px-2.5 ${open ? "pt-2.5 pb-2" : "py-2 hover:bg-white/[0.05]"} rounded-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`} onClick={() => pickThing(t.id)} aria-expanded={open}>
          <span className={`w-[30px] h-[30px] shrink-0 rounded-[9px] flex items-center justify-center ${open ? "bg-orange-300/20 text-orange-200" : "bg-white/[0.07] text-zinc-300"}`}><Icon size={16} /></span>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className={`text-[13.5px] ${open ? "font-bold text-zinc-50" : "font-semibold text-zinc-100"}`}>{t.name}</span>
            <span className="text-[11.5px] text-zinc-400 truncate" data-testid={`export-summary-${t.id}`}>{t.summary}</span>
          </span>
          {!open && <ChevronRight size={15} className="shrink-0 text-zinc-500" />}
        </button>
        {open && t.help && <HelpLink topic={t.help} label={t.name} />}
      </div>
      {open && (
        <div className="dg-appear px-2.5 pb-3 flex flex-col gap-2.5">
          {t.choices.map(c => <div key={c.id}><Field label={c.name}>{c.control}</Field></div>)}
          <button className="w-full h-10 touch:h-12 rounded-[12px] bg-orange-500 hover:bg-orange-400 active:bg-orange-400 text-zinc-950 font-bold text-[13.5px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:bg-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            onClick={() => make(t)} disabled={!!t.go.off} title={t.go.off} data-testid={t.go.testid}>
            {t.id === "video" ? <Clapperboard size={15} /> : <Download size={15} />}{t.go.label}
          </button>
          {(t.go.off || t.note) && <p className="-mt-1 text-[11.5px] text-zinc-400 text-center" data-testid={t.go.off && t.go.off !== t.note ? "export-why" : `export-note-${t.id}`}>{t.go.off && t.go.off !== t.note ? t.go.off : t.note}</p>}
        </div>
      )}
    </div>
  );
}

/** A phone's Export step: the preview has the screen; the glass bar names the thing made in its
 * pill (which opens every other, the course file and Share), its choices along the bar, and the
 * button that makes it at its end. */
export function ExportBar({ onHeight, bottom = 0 }: { onHeight?: (px: number) => void; bottom?: number }) {
  const things = useThings();
  const id = useExportPick(s => s.thing);
  usePreviewFollows();
  const t = things.find(x => x.id === id) ?? things[0];
  const Icon = t.icon;
  const settings: BarSetting[] = t.choices.map(c => ({ id: c.id, name: c.name, value: c.value, control: c.control, wide: c.wide, testid: `export-set-${c.id}` }));
  // (a thing with nothing to choose: what it is, said where its choices would be)
  if (!settings.length && t.note) settings.push({ id: "note", name: t.note, run: () => toast(t.note!, "info"), testid: "export-set-note" });
  const menu = (
    <div className="flex flex-col gap-0.5" data-testid="export-menu">
      {things.map(x => <ActRow key={x.id} label={x.name} hint={x.summary} icon={<x.icon size={18} className={x.id === id ? "text-orange-300" : "text-zinc-300"} />} onClick={() => pickThing(x.id)} testid={`export-pick-${x.id}`} />)}
      <div className="h-px bg-white/[0.08] mx-3 my-1" />
      <ActRow label="Save course file" icon={<FileDown size={18} className="text-zinc-300" />} onClick={saveFile} testid="export-file" />
      <ActRow label="Share" icon={<Share2 size={18} className="text-zinc-300" />} onClick={share} testid={SERVER ? "export-share-people" : "locked-share"} />
    </div>
  );
  return (
    <GlassBar pill={{ name: t.name, icon: <Icon size={17} />, testid: "export-pill" }} pillMenu={menu}
      settings={settings} onDone={() => make(t)} doneText={t.go.short} doneLabel={t.go.label} doneTestid={t.go.testid}
      remember={`export-${t.id}`} bottom={bottom} onHeight={onHeight} testid="export-bar" />
  );
}
