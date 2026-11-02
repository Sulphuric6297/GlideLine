// The site just brought in: what came, in a card over the 3D view of it, and two ways on.
import { Flag, Image as ImageIcon, LandPlot, MapPin, Mountain, Route, Shrub, Trees, Warehouse, Waves } from "lucide-react";
import type { ReactNode } from "react";
import type { ImportedSite } from "../lib/importSite";
import { fmtArea, fmtDist } from "../lib/units";
import { polygonArea } from "../lib/geom";
import type { CourseItem, Units } from "../types";
import { useLayout } from "./useLayout";

export type ReadyFact = { icon: ReactNode; label: string; value: string; note?: string };

const from = (i: CourseItem) => (i as { importSource?: string }).importSource;
const lengthOf = (pts: { x: number; y: number }[]) => pts.reduce((s, p, k) => (k ? s + Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y) : 0), 0);

/** What came in, a row each (the parts that didn't come left out). */
export const readyFacts = (site: ImportedSite, units: Units, holes: number): ReadyFact[] => {
  const facts: ReadyFact[] = [];
  const all = [...site.mapped, ...site.trees];
  const photo = site.site.photo;
  if (site.background) facts.push({ icon: <ImageIcon size={17} />, label: /^OpenStreetMap/.test(site.site.imagerySource ?? "") ? "Street map" : "Photo", value: photo?.date ? photo.date.slice(0, 7).replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1]} ${y}`) : site.site.imagerySource ?? "", note: photo?.metersPerPx ? `${Math.round(photo.metersPerPx * 3.28 * 10) / 10} ft` : undefined });
  const h = Object.values(site.terrainHeights);
  if (h.length) facts.push({ icon: <Mountain size={17} />, label: "Ground", value: fmtDist(Math.max(...h) - Math.min(0, ...h), units), note: "of climb" });
  const measured = site.standing ?? site.lidar?.trees.length ?? 0;
  const photoTrees = site.trees.filter(i => from(i) === "photo").length;
  if (measured) facts.push({ icon: <Trees size={17} />, label: "Trees", value: measured.toLocaleString(), note: "measured" });
  else if (photoTrees) facts.push({ icon: <Trees size={17} />, label: "Trees", value: photoTrees.toLocaleString(), note: "from the photo" });
  // (the brush: its light patches hold the medium and heavy ones)
  const brush = all.filter(i => i.type === "area" && i.kind === "woods" && from(i) === "lidar" && (i.bushes ?? 0) >= 1 && i.density === 0.5) as { points: { x: number; y: number }[] }[];
  if (brush.length) facts.push({ icon: <Shrub size={17} />, label: "Underbrush", value: fmtArea(brush.reduce((s, a) => s + Math.abs(polygonArea(a.points)), 0), units) });
  const roads = all.filter(i => i.type === "line" && (i.kind === "road" || i.kind === "path")) as { points: { x: number; y: number }[] }[];
  if (roads.length) facts.push({ icon: <Route size={17} />, label: "Paths and roads", value: fmtDist(roads.reduce((s, l) => s + lengthOf(l.points), 0), units) });
  const water = all.filter(i => (i.type === "area" && i.kind === "water") || (i.type === "line" && i.kind === "stream")).length;
  if (water) facts.push({ icon: <Waves size={17} />, label: "Water", value: water.toLocaleString() });
  const buildings = all.filter(i => (i.type === "area" && i.kind === "building") || (i.type === "structure" && (i.kind === "building" || i.kind === "shelter"))).length;
  if (buildings) facts.push({ icon: <Warehouse size={17} />, label: "Buildings", value: buildings.toLocaleString() });
  const fields = all.filter(i => i.type === "area" && i.kind === "field").length;
  if (fields) facts.push({ icon: <LandPlot size={17} />, label: "Fields and courts", value: fields.toLocaleString() });
  if (holes) facts.push({ icon: <Flag size={17} />, label: "Holes", value: holes.toLocaleString(), note: "from OpenStreetMap" });
  facts.push({ icon: <MapPin size={17} />, label: "Site", value: fmtArea(site.canvas.width * site.canvas.height, units) });
  return facts;
};

/** The card. `said` is the same in a sentence (for screen readers and tests). */
export function SiteReady({ name, facts, said, onLook, onStart }: { name: string; facts: ReadyFact[]; said: string; onLook: () => void; onStart: () => void }) {
  const phone = useLayout() === "phone";
  return (
    <div className={phone ? "fixed left-0 right-0 bottom-0 z-[60] glass rounded-t-[28px] px-[18px] pt-2.5 pb-[max(18px,env(safe-area-inset-bottom))]" : "fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] w-[min(660px,calc(100%-32px))] glass rounded-[24px] px-6 py-5"}
      role="dialog" aria-label={said} data-testid="site-ready">
      {phone && <div className="w-[38px] h-[5px] rounded-full bg-white/25 mx-auto mb-2" />}
      <div className="font-bold text-[19px] text-zinc-50 mb-1.5">{name} is in</div>
      <div className={`grid ${phone ? "grid-cols-1" : "grid-cols-2 gap-x-7"}`}>
        {facts.map(f => (
          <div key={f.label} className="flex items-center gap-2.5 py-2 border-b border-white/[0.06] text-[14px]">
            <span className="text-[#a2cf6a]">{f.icon}</span>
            <span className="text-zinc-200">{f.label}</span>
            <span className="ml-auto font-semibold text-zinc-50">{f.value}{f.note && <span className="font-normal text-zinc-500 text-[12px] ml-1.5">{f.note}</span>}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2.5 mt-4">
        <button className={`h-12 px-5 rounded-[14px] bg-white/[0.08] hover:bg-white/[0.12] text-[15px] font-semibold text-zinc-100 ${phone ? "flex-1" : ""}`} onClick={onLook} data-testid="site-ready-look">Look around</button>
        <button className={`h-12 px-5 rounded-[14px] bg-[#a2cf6a] hover:bg-[#b3db80] text-[15px] font-bold text-zinc-950 ${phone ? "flex-[1.4]" : ""}`} onClick={onStart} data-testid="site-ready-start">Start designing</button>
      </div>
    </div>
  );
}
