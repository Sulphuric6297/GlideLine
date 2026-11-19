// The measured trees' own settings, the same wherever they're set: Site's Trees fold (straight to
// the course) and the import's Trees step (kept till the site is brought in). Which are left out,
// how wide the crowns, how many years they're grown since the survey (with why that's there said
// under it), saplings in the gaps, and whether the holes' fairways are cleared.
import type { ReactNode } from "react";
import { growthSaid, saplings } from "../lib/lidar";
import { fmtElev } from "../lib/units";
import type { LidarTree, Units } from "../types";
import { Slider, Toggle } from "./ui";

/** The settings as they're set (unset: as measured, none, off). */
export type MeasuredTune = { minHeight?: number; crownSize?: number; growYears?: number; saplings?: boolean; clearFairways?: boolean };

const asMeasured = (v: number | undefined) => v === undefined || Math.abs(v - 1) < 0.001;
const height = (v: number, u: Units) => fmtElev(v, u).replace(/^[+−-]/, "");

/** The settings in a few words, for a row or a button that opens them: "As measured", or what was
 * changed (the first, and how many more). */
export const measuredSaid = (t: MeasuredTune, u: Units) => {
  const said = [
    t.growYears ? `Grown ${t.growYears} year${t.growYears === 1 ? "" : "s"}` : "",
    t.minHeight ? `Over ${height(t.minHeight, u)}` : "",
    asMeasured(t.crownSize) ? "" : `Crowns ${Math.round(t.crownSize! * 100)}%`,
    t.clearFairways ? "Fairways cleared" : ""
  ].filter(Boolean);
  return !said.length ? "As measured" : said.length === 1 ? said[0] : `${said[0]} +${said.length - 1}`;
};

/** A switch as the panel draws one (the import's card passes its own). */
export type SwitchRow = (o: { label: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) => ReactNode;
const panelSwitch: SwitchRow = o => <div className="mt-2" data-testid={o.testid} key={o.testid}><Toggle label={o.label} checked={o.checked} onChange={o.onChange} /></div>;

export function MeasuredTuning({ trees, source, value, units, onChange, onDone, switchRow = panelSwitch, tight = false, notes, after }: {
  /** The measured trees (for the counts), and the survey they're from (for its year). */
  trees: LidarTree[]; source: string;
  value: MeasuredTune; units: Units;
  /** `done`: false while a slider is still moving. */
  onChange: (patch: MeasuredTune, done: boolean) => void;
  /** A slider let go. */
  onDone?: () => void;
  switchRow?: SwitchRow;
  /** Closer together (the import's card and the phone's menu, which have less room). */
  tight?: boolean;
  /** Between Saplings in the gaps and Clear trees from the fairways; and after that. */
  notes?: ReactNode; after?: ReactNode;
}) {
  const m = value.minHeight ?? 0, grown = value.growYears ?? 0;
  const keptN = m ? trees.filter(t => t[2] >= m).length : trees.length;
  const why = growthSaid(source, grown);
  const row = tight ? "-mb-1" : "mt-2";
  return (
    <>
      <div data-testid="lidar-min" className={tight ? "-mb-1" : ""}>
        <Slider label="Leave out trees shorter than" min={0} max={60} step={1} value={m}
          format={v => (v ? height(v, units) : "None")}
          onChange={v => onChange({ minHeight: v || undefined }, false)} onDone={onDone} />
        <div className={`text-[11px] touch:text-[12.5px] text-zinc-500 ${tight ? "-mt-1.5 mb-2" : ""}`}>{`${keptN.toLocaleString()} of ${trees.length.toLocaleString()} kept`}</div>
      </div>
      <div className={row} data-testid="lidar-crown">
        <Slider label="Crown size" min={0.6} max={1.5} step={0.05} value={value.crownSize ?? 1}
          format={v => (Math.abs(v - 1) < 0.001 ? "As measured" : `${Math.round(v * 100)}%`)}
          onChange={v => onChange({ crownSize: Math.abs(v - 1) < 0.001 ? undefined : v }, false)} onDone={onDone} />
      </div>
      <div className={tight ? "" : "mt-2"} data-testid="lidar-grow">
        <Slider label="Growth since the survey" min={0} max={25} step={1} value={grown}
          format={v => (v ? `${v} year${v === 1 ? "" : "s"}${value.saplings ? ` · ${saplings(trees, v).length.toLocaleString()} new` : ""}` : "As measured")}
          onChange={v => onChange({ growYears: v || undefined }, false)} onDone={onDone} />
        {/* (why it's there: the survey is from a while ago, and this grows the trees since) */}
        <div className="text-[11px] touch:text-[12.5px] leading-snug text-zinc-400 -mt-1.5 mb-2" data-testid="growth-why">
          {why.text}
          {why.today > 0 && <> <button type="button" className="text-orange-300 hover:text-orange-200 font-semibold" onClick={() => onChange({ growYears: why.today }, true)} data-testid="grow-today">Grow them to today ({why.today} year{why.today === 1 ? "" : "s"})</button></>}
        </div>
      </div>
      {grown > 0 && switchRow({ label: "Saplings in the gaps", checked: value.saplings === true, onChange: v => onChange({ saplings: v }, true), testid: "lidar-saplings" })}
      {notes}
      {switchRow({ label: "Clear trees from the fairways", checked: value.clearFairways === true, onChange: v => onChange({ clearFairways: v }, true), testid: "lidar-clear" })}
      {after}
    </>
  );
}
