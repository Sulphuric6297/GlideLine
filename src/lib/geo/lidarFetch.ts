// Trees and ground measured from the air for a site: the newest USGS LiDAR survey over it, and,
// where it stops short of the site's edges, the next newest for the rest, read straight from AWS
// (its tiles allow any website). The tiles come down a few at a time and are decoded (laz-perf)
// and measured in background workers, so the page keeps moving; where there are none, here.
import type { LidarTree, P } from "../../types";
import type { GeoRef } from "../geoRef";
import { toPlanXY } from "../geoRef";
import { claim, findTrees, flownOn, gather, gatherer, leafOnAt, measureSite, readTile, siteBox, surveyYear, tilesFor, tilesOver, depthFor, mercX, mercY, type Box, type Dem, type Ept, type Gathered, type LazReader, type Measured, type TilePoints } from "../lidar";
import type { GeoBounds } from "./core";
import { allBuildings } from "./buildings";
import type { LidarJob } from "./lidarWorker";
import { demHeights, ugDem, ugFeed, ugGatherer, ugSurvey, type UgSurvey } from "../undergrowth";

/** A survey read for a site: its name on AWS, the year it was flown, when it flew over the site
 * (from its points' own times) and whether the trees were in leaf then. */
export type SurveyUsed = { name: string; year: number; flown: string | null; leafOn: boolean | null };

export type LidarSite = {
  /** What the course keeps as the trees' source ("USGS LiDAR 2022"; two years where two surveys
   * each covered part of the site, the newest first). */
  source: string;
  /** The same, as a progress list or the Site step names it ("USGS 3DEP 2022 survey"). */
  label: string;
  surveys: SurveyUsed[];
  trees: LidarTree[];
  /** The ground, the canopy and what stands on a fine grid (see measureSite). */
  measured: Measured;
  /** What grows low, for the brush (see lib/undergrowth; null without the USGS ground). */
  undergrowth: UgSurvey | null;
};

export type LidarOptions = {
  /** The ground's elevation from USGS 3DEP (the import's own download; not the coarser terrain
   * tiles), to check the survey's ground against; awaited only once the points are in. */
  dem?: Dem | null | Promise<Dem | null>;
  /** More building outlines (plan ft) where no tree stands: OpenStreetMap's, say. Overture's
   * buildings (traced from the air, and OpenStreetMap's) are looked up here anyway. */
  outlines?: P[][] | Promise<P[][]>;
  signal?: AbortSignal;
  /** Each tile's points as they're read, for a closer look than the trees (the undergrowth). */
  onPoints?: (p: TilePoints) => void;
};

/** The local list of surveys: [name, west, south, east, north, year?, in leaf? (1, 0, null)]. */
type IndexRow = [string, number, number, number, number, number?, (0 | 1 | null)?];
type Index = { base: string; surveys: IndexRow[] };
let indexP: Promise<Index> | null = null;
const lidarIndex = (): Promise<Index> =>
  (indexP ??= (getJson(new URL("lidar-index.json", document.baseURI).href) as Promise<Index>).catch(err => { indexP = null; throw err; }));

const getJson = async (url: string, signal?: AbortSignal) => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const yearOf = (row: IndexRow) => row[5] ?? surveyYear(row[0]);

/** How a survey reads in a list: "USGS 3DEP 2022 survey". */
export const surveyLabel = (year: number) => `USGS 3DEP ${year ? `${year} ` : ""}survey`;

/**
 * Which surveys reach a frame, from the local list alone (nothing downloaded; it's quick enough to
 * run as the frame is dragged): each with its year, whether the trees were in leaf when it flew
 * (null: no telling), and whether its box takes in the whole frame or part of it; and whether
 * together they look to cover it all. Surveys' boxes are bigger than what they flew, so "full" is
 * what's likely, and the import finds out for sure.
 */
export const lidarCoverage = async (bounds: GeoBounds) => {
  const index = await lidarIndex();
  const surveys = index.surveys
    .filter(([, w, s, e, n]) => w < bounds.east && e > bounds.west && s < bounds.north && n > bounds.south)
    .map(row => ({ name: row[0], year: yearOf(row), leafOn: row[6] === undefined || row[6] === null ? null : row[6] === 1, full: row[1] <= bounds.west && row[3] >= bounds.east && row[2] <= bounds.south && row[4] >= bounds.north, label: surveyLabel(yearOf(row)) }))
    .sort((a, b) => b.year - a.year);
  // (together: every spot of a 9 x 9 sampling of the frame in one survey's box or another's)
  let inside = 0;
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
    const lat = bounds.south + ((j + 0.5) / 9) * (bounds.north - bounds.south), lon = bounds.west + ((i + 0.5) / 9) * (bounds.east - bounds.west);
    if (index.surveys.some(([, w, s, e, n]) => w <= lon && e >= lon && s <= lat && n >= lat)) inside++;
  }
  const covered: "full" | "partial" | "none" = inside === 81 ? "full" : inside ? "partial" : "none";
  return { covered, surveys };
};

// ---------------------------------------------------------------- the tiles, decoded

let reader: Promise<LazReader> | null = null;
const lazReader = () =>
  (reader ??= (async () => {
    const [{ createLazPerf }, wasm] = await Promise.all([import("laz-perf"), import("laz-perf/lib/web/laz-perf.wasm?url")]);
    return (await createLazPerf({ locateFile: () => wasm.default })) as unknown as LazReader;
  })());

/** Background workers to decode tiles and measure in, as many as the computer has cores to
 * spare (up to 4); or, where there are none, the same done here. */
const workers = () => {
  const n = typeof Worker === "undefined" ? 0 : Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const pool: { w: Worker; busy: number }[] = [];
  const pending = new Map<number, { done: (v: any) => void; fail: (e: Error) => void }>();
  let jobs = 0, broken = !n;
  const start = () => {
    for (let k = 0; k < n; k++) {
      try {
        const w = new Worker(new URL("./lidarWorker.ts", import.meta.url), { type: "module" });
        w.onmessage = e => {
          const p = pending.get(e.data.id);
          pending.delete(e.data.id);
          const slot = pool.find(s => s.w === w);
          if (slot) slot.busy--;
          if (e.data.error) p?.fail(new Error(e.data.error));
          else p?.done(e.data);
        };
        // (a worker that can't start: the rest of it done here)
        w.onerror = () => { broken = true; pending.forEach(p => p.fail(new Error("LiDAR worker failed"))); pending.clear(); };
        pool.push({ w, busy: 0 });
      } catch {
        broken = true;
      }
    }
  };
  if (n) start();
  const run = <T,>(job: LidarJob extends infer J ? (J extends LidarJob ? Omit<J, "id"> : never) : never, transfer: Transferable[]): Promise<T> => {
    const slot = pool.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = ++jobs;
    slot.busy++;
    return new Promise<T>((done, fail) => {
      pending.set(id, { done, fail });
      slot.w.postMessage({ ...job, id }, transfer);
    });
  };
  return {
    /** A tile's points on the site. */
    tile: async (buf: ArrayBuffer, ref: GeoRef, box: Box): Promise<TilePoints> => {
      if (!broken) {
        try {
          return (await run<{ points: TilePoints }>({ kind: "tile", buf, ref, box }, [buf])).points;
        } catch (err) {
          // (a tile that won't decode stays an error; a worker that stopped, the rest done here)
          if (!broken) throw err;
        }
      }
      // (the buffer went to the worker that failed: fetched again by the caller)
      if (!buf.byteLength) throw new Error("tile lost to a failed worker");
      return readTile(await lazReader(), new Uint8Array(buf), ref, box);
    },
    /** The ground, the canopy and the trees from the gathered points. */
    measure: async (g: Gathered, dem: Dem | null, outlines: P[][], leafOn: boolean | null): Promise<{ measured: Measured; trees: LidarTree[] }> => {
      if (!broken) {
        // (copied over, not handed over: should the worker stop, it's all still here to do)
        try {
          return await run({ kind: "measure", g, dem, outlines, leafOn }, []);
        } catch (err) {
          if (!broken) throw err;
        }
      }
      const measured = measureSite(g, { dem, outlines, leafOn });
      return { measured, trees: findTrees(measured) };
    },
    close: () => pool.forEach(s => s.w.terminate())
  };
};

// ---------------------------------------------------------------- a site measured

/** The surveys over a site worth trying, newest first (their boxes reach it). */
const surveysOver = async (ref: GeoRef) => {
  const index = await lidarIndex();
  return { base: index.base, rows: index.surveys.filter(([, w, s, e, n]) => w < ref.east && e > ref.west && s < ref.north && n > ref.south).sort((a, b) => yearOf(b) - yearOf(a)) };
};

/** The most surveys read for one site. */
const MAX_SURVEYS = 4;

/**
 * The site's trees and ground from the air, or null where no survey covers it. The newest survey
 * first; where it leaves part of the site without points (it ends there), the next newest for that
 * part, and so on. `onProgress` gets how far along it is (0..1).
 */
export const fetchLidar = async (ref: GeoRef, onProgress: (fraction: number) => void = () => {}, opts: LidarOptions = {}): Promise<LidarSite | null> => {
  const { signal } = opts;
  const box = siteBox(ref);
  const { base, rows } = await surveysOver(ref);
  if (!rows.length) return null;
  // (the buildings traced from the air, meanwhile: no tree stands on one)
  const traced = allBuildings(ref)
    .then(list => list.map(b => b.points.map(p => toPlanXY(ref, p.lat, p.lon))))
    .catch(err => { console.warn("Buildings lookup failed", err); return [] as P[][]; });
  const pool = workers();
  try {
    const g = gatherer(ref.width, ref.height);
    // (the low growth, for the brush: heights from the USGS ground, once it's in)
    const ug = ugGatherer(ref.width, ref.height);
    const demIn = Promise.resolve(opts.dem ?? null).catch(() => null);
    void demIn.then(d => { if (d) ugDem(ug, demHeights(d, ref.width, ref.height)); });
    const used: SurveyUsed[] = [];
    let open = { x0: 0, y0: 0, x1: ref.width, y1: ref.height };
    for (const row of rows) {
      if (used.length >= MAX_SURVEYS) break;
      const name = row[0], url = `${base}${name}`;
      let tiles: { key: string; points: number }[];
      // Only over what's left uncovered
      const part: Box = [mercX(ref.west + (open.x0 / ref.width) * (ref.east - ref.west)) - 15, mercY(ref.north - (open.y1 / ref.height) * (ref.north - ref.south)) - 15, mercX(ref.west + (open.x1 / ref.width) * (ref.east - ref.west)) + 15, mercY(ref.north - (open.y0 / ref.height) * (ref.north - ref.south)) + 15];
      try {
        const ept = (await getJson(`${url}/ept.json`, signal)) as Ept;
        if (ept.dataType !== "laszip" || (ept.srs?.horizontal && ept.srs.horizontal !== "3857")) continue;
        const all = await tilesOver(ept, part, depthFor(ept, 0.25), key => getJson(`${url}/ept-hierarchy/${key}.json`, signal));
        tiles = tilesFor(ept, part, all);
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn("LiDAR survey unreadable", name, err);
        continue;
      }
      if (!tiles.length) continue;
      const k = used.length + 1, total = tiles.reduce((t, x) => t + x.points, 0);
      let done = 0, next = 0, got = 0;
      // A few tiles coming down at once, each decoded as it comes
      const fetcher = async () => {
        while (next < tiles.length) {
          const tile = tiles[next++];
          const get = async () => {
            const res = await fetch(`${url}/ept-data/${tile.key}.laz`, { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          };
          const pts = await pool.tile(await get(), ref, box).catch(async () => pool.tile(await get(), ref, box));
          gather(g, pts, k);
          ugFeed(ug, pts);
          opts.onPoints?.(pts);
          got += pts.n;
          done += tile.points;
          // (the first survey's points most of the way, any after it the rest)
          onProgress(used.length ? 0.9 + 0.05 * (done / total) : 0.9 * (done / total));
        }
      };
      await Promise.all(Array.from({ length: 6 }, fetcher));
      const c = claim(g, k);
      // (a survey that gave the site nothing is not one of its sources)
      if (!got) continue;
      const flown = flownOn(g.times[k - 1] ?? []);
      used.push({ name, year: yearOf(row), flown: flown?.toISOString().slice(0, 10) ?? null, leafOn: leafOnAt(flown) ?? (row[6] === undefined || row[6] === null ? null : row[6] === 1) });
      if (!c.box || c.open < 0.01) break;
      open = c.box;
    }
    if (!used.length || !g.owner.some(Boolean)) return null;
    // Measured, once the DEM and the buildings are in (the buildings waited for 10 s at most)
    const [dem, more, outlines] = await Promise.all([
      Promise.resolve(opts.dem ?? null).catch(() => null),
      Promise.resolve(opts.outlines ?? []).catch(() => [] as P[][]),
      Promise.race([traced, new Promise<P[][]>(r => setTimeout(() => r([]), 10_000))])
    ]);
    const { measured, trees } = await pool.measure(g, dem, [...more, ...outlines], used[0].leafOn);
    onProgress(1);
    const years = [...new Set(used.map(s => s.year).filter(Boolean))];
    return {
      source: `USGS LiDAR${years.length ? ` ${years.join(" and ")}` : ""}`,
      label: surveyLabel(used[0].year),
      surveys: used,
      trees,
      measured,
      undergrowth: ugSurvey(ug)
    };
  } finally {
    pool.close();
  }
};
