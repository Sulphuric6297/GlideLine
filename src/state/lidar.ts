// Measuring the trees and the ground from the air (LiDAR) for the site already brought in: the
// trees measured before (and any kept or taken out) are replaced, the ground too (the survey's,
// checked against USGS 3DEP's), the buildings without a height get the survey's, and the import's
// last step follows (the stands of woods, the photo's trees and woods taken out where the survey
// has them); Undo brings it all back.
import { usgsDem } from "../lib/geo/elevation";
import { withMeasuredHeights } from "../lib/geo/buildings";
import { fetchLidar } from "../lib/geo/lidarFetch";
import { findBushes, groundOnGrid } from "../lib/lidar";
import { signed, withMeasuredTrees } from "../lib/importSite";
import { natureFromPhoto } from "../lib/geo/photoNature";
import { summerFills, treesFromSummer } from "../lib/summerTrees";
import { treeFree } from "../lib/treeFree";
import type { P } from "../types";
import { changeDoc, getDoc, useEditor } from "./course";
import { toast } from "./toast";

export const measureLidar = async () => {
  const d = getDoc();
  if (!d.site.bounds || useEditor.getState().lidarBusy !== null) return;
  const busy = (f: number | null) => useEditor.getState().set({ lidarBusy: f });
  busy(0);
  try {
    const ref = { ...d.site.bounds, width: d.canvas.width, height: d.canvas.height };
    // (no tree stands on a building the course has)
    const outlines = d.items.filter(i => i.type === "structure" && (i.kind === "building" || i.kind === "shelter")).map(i => (i as { points: P[] }).points);
    const got = await fetchLidar(ref, f => busy(f), { dem: usgsDem(d.site.bounds, d.canvas.width, d.canvas.height), outlines });
    if (!got) {
      // (remembered: the Site step says so, with Check again)
      changeDoc(doc => ({ site: { ...doc.site, noLidar: true, lidarFailed: undefined } }), false);
      toast("No aerial survey covers this site.", "info", false, undefined, 8000);
      return;
    }
    const g = groundOnGrid(got.measured, d.canvas.width, d.canvas.height, d.gridSize);
    // (flown bare, under a photo taken in leaf: the trees it couldn't pick out, from the photo, as on
    // the import)
    const photo = d.background && summerFills(got.measured.leafOn, d.site.photo?.season) ? await natureFromPhoto(d.background, d.canvas.width, d.canvas.height, undefined, { waterOnly: true, canopy: true }).catch(() => null) : null;
    changeDoc(doc => {
      const items = withMeasuredHeights(doc.items, got.measured, signed);
      const summer = photo?.leaf ? treesFromSummer(got.trees, got.measured, photo.leaf, doc.canvas.width, doc.canvas.height, treeFree(items)) : [];
      const trees = summer.length ? [...got.trees, ...summer] : got.trees;
      return {
        lidar: { source: got.source, ...(got.surveys[0]?.flown ? { flown: got.surveys[0].flown } : {}), trees, ...(summer.length ? { fromPhoto: summer.length } : {}) },
        terrainHeights: g.heights,
        terrainOriginal: undefined,
        items: withMeasuredTrees(items, trees, findBushes(got.measured), p => !treeFree(items)(p)).items,
        site: { ...doc.site, baseElevationFt: Math.round(g.min * 10) / 10, elevationSource: got.source, noLidar: undefined, lidarFailed: undefined }
      };
    });
    toast(`${got.trees.length.toLocaleString()} trees measured from the air (${got.source}).`, "success", true, undefined, 8000);
  } catch (err) {
    console.warn("LiDAR failed", err);
    changeDoc(doc => ({ site: { ...doc.site, lidarFailed: true } }), false);
    toast("Couldn't read the aerial survey.", "error", false, { label: "Try again", run: () => void measureLidar() }, 20000);
  } finally {
    busy(null);
  }
};
