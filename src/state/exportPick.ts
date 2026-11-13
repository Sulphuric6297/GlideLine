// The Export step's picks: the thing being made (its row open on a computer, its name in the
// phone's bar), and each thing's own choices, kept while the step is left and come back to.
import { create } from "zustand";

export type ExportThing = "map" | "signs" | "pages" | "scorecard" | "picture" | "video" | "data" | "parts";
export type MapFormat = "pdf" | "png" | "svg";
export type SheetFormat = "pdf" | "zip" | "png" | "svg" | "geojson";
export type DataFormat = "kml" | "geojson" | "gpx" | "holes" | "stakeout";

type Picks = {
  thing: ExportThing;
  mapFormat: MapFormat;
  /** "all", or one hole's id. */
  signHoles: string;
  signFormat: SheetFormat;
  pageHoles: string;
  pageFormat: SheetFormat;
  cardFormat: "pdf" | "svg";
  videoHoles: string;
  dataFormat: DataFormat | null;
  set: (patch: Partial<Omit<Picks, "set">>) => void;
};

export const useExportPick = create<Picks>(set => ({
  thing: "map",
  mapFormat: "pdf",
  signHoles: "all",
  signFormat: "pdf",
  pageHoles: "all",
  pageFormat: "pdf",
  cardFormat: "pdf",
  videoHoles: "all",
  dataFormat: null,
  set: patch => set(patch)
}));

/** The things shown in the 3D view rather than as a page (the preview is the 3D view itself). */
export const IN_3D: ReadonlySet<ExportThing> = new Set(["picture", "video"]);

/** Whether a page covers the 3D view: the Map step's, or Export's for a page (not a picture or a
 * video, which show the 3D view itself). */
export const usePageShown = (step: string, teeView: unknown) => {
  const thing = useExportPick(s => s.thing);
  return !teeView && (step === "map" || (step === "export" && !IN_3D.has(thing)));
};
