// A phone's Map step, the way a design app works on a phone: the page has the screen, and its
// settings are a row of tools along the bottom instead of a sheet pulled up over it. A tool opens
// just that setting in a low sheet in the row's place, an X to close it, floating over the page as
// the 3D map's sheet does: every change shows on the page as it's made. With a piece picked, the
// piece's own tools take the row's place (PieceToolbar).
import { SHOW_EVENT } from "../showSetting";
import { FileText, Flag, Handshake, ListTree, Palette, PenLine, Plus, Signpost, Table2, Type, BookOpen, type LucideIcon, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { changeDoc, useCourse, useEditor } from "../../state/course";
import { PAPER } from "../../lib/mapSvg";
import { SIGN_SIZES, type SignSize } from "../../lib/teeSign";
import { HOLE_PAGES, type HolePageSize } from "../../lib/holePage";
import { rememberBoard } from "../printouts";
import type { PaperSize } from "../../types";
import { DesignPanel } from "../DesignPanel";
import { InToolSheet, setToolOpen } from "../pageToolState";
import { Disc, SHEET, SheetFold, tileCls, useUnfold } from "./SheetFold";
import { Field, OnlyGroup, Select } from "../ui";

type Tool = { id: string; label: string; icon: LucideIcon };
type Tab = "general" | "map" | "sign" | "page" | "scorecard";

// (six tools at most, all in a row)
const ADD: Tool = { id: "print-add", label: "Add", icon: Plus };
const LAYERS: Tool = { id: "print-layers", label: "Layers", icon: ListTree };

/** Each printout's settings, a tool each (the panel's Section or Fold it opens), named as the
 * computer's panel names them. */
const TOOLS: Record<Tab, Tool[]> = {
  general: [{ id: "card-style", label: "Lettering and colors", icon: Palette }, { id: "markings", label: "Marks", icon: Flag }, { id: "print-sponsors", label: "Sponsors", icon: Handshake }],
  map: [{ id: "map-style", label: "Style", icon: Palette }, { id: "drawn-on-map", label: "Lines", icon: PenLine }, { id: "amenity-marks", label: "Marks", icon: MapPin }, { id: "fold-title", label: "Lettering", icon: Type }, { id: "fold-paper", label: "Paper", icon: FileText }, ADD, LAYERS],
  sign: [{ id: "sign-settings", label: "Sign", icon: Signpost }, ADD, LAYERS],
  page: [{ id: "page-settings", label: "Page", icon: BookOpen }, ADD, LAYERS],
  scorecard: [{ id: "card-settings", label: "Card", icon: Table2 }, ADD, LAYERS]
};

/** Settings that live inside a tool's panel: the tool they're in. */
const PART_OF: Record<string, string> = { "light-shadow": "map-style", "map-look": "map-style" };

/** The printout's size, first in the tool its other settings are in (the computer has it over the
 * page). */
function SizeOf({ tool }: { tool: string }) {
  const style = useCourse(c => c.doc.style);
  const holes = useCourse(c => c.doc.holes.length);
  const field = (label: string, value: string, options: [string, string][], set: (v: string) => void) => (
    <div className="px-4 pt-2 -mb-1"><Field label="Size"><Select label={label} value={value} onChange={set}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></div>
  );
  if (tool === "fold-paper") return field("Paper size", style.paper, Object.entries(PAPER).map(([k, p]) => [k, p.label]), v => changeDoc(d => ({ style: { ...d.style, paper: v as PaperSize } })));
  if (tool === "sign-settings" && holes) return field("Tee sign size", style.signSize ?? "18x12", Object.entries(SIGN_SIZES).map(([k, p]) => [k, p.label]), v => { rememberBoard(v as SignSize); changeDoc(d => ({ style: { ...d.style, signSize: v as SignSize } })); });
  if (tool === "page-settings") return field("Hole page size", style.holePageSize ?? "letter", Object.entries(HOLE_PAGES).map(([k, p]) => [k, p.label]), v => changeDoc(d => ({ style: { ...d.style, holePageSize: v as HolePageSize } })));
  return null;
}

export function PageTools() {
  const tab = useEditor(e => e.designTab);
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const tools = TOOLS[tab];
  // (another printout: its own tools, none open)
  useEffect(() => setOpen(null), [tab]);
  // (the page's zoom buttons stand aside while a tool is open)
  useEffect(() => { setToolOpen(!!open); return () => setToolOpen(false); }, [open]);
  // (Show me, from the help or the View panel: the tool its setting is in, opened)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d !== "string" || !d.startsWith("page-tool:")) return;
      const id = PART_OF[d.slice(10)] ?? d.slice(10);
      if (TOOLS[useEditor.getState().designTab].some(t => t.id === id)) setOpen(id);
    };
    window.addEventListener(SHOW_EVENT, on);
    return () => window.removeEventListener(SHOW_EVENT, on);
  }, []);
  // (what's unfolded under the tools, kept while it folds away)
  const [shownId, unfolded] = useUnfold(open);
  const tool = tools.find(t => t.id === shownId);
  return (
    <div className={`relative z-30 ${SHEET}`} data-testid="page-tools">
      <div role="toolbar" aria-label="Page settings" className="flex gap-1 px-1.5 py-[7px] overflow-x-auto dg-noscrollbar touch-pan-x">
        {tools.map(t => {
          const on = open === t.id;
          return (
            <button key={t.id} onClick={() => setOpen(on ? null : t.id)} aria-pressed={on} data-testid={`page-tool-${t.id}`} className={tileCls(on)}>
              <Disc on={on}><t.icon size={18} /></Disc>
              <span className="text-[11px] leading-none font-semibold whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>
      {/* (unfolding under the tools, as the 3D map's panel does: the page in sight above) */}
      {tool && (
        <SheetFold unfolded={unfolded && open === tool.id} title={tool.label} onClose={close} testid="page-tool-panel" closeTestid="page-tool-done">
          <SizeOf tool={tool.id} />
          <InToolSheet.Provider value={true}><OnlyGroup.Provider value={tool.id}><DesignPanel /></OnlyGroup.Provider></InToolSheet.Provider>
        </SheetFold>
      )}
    </div>
  );
}
