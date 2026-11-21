import { test as plain, expect as plainExpect } from "@playwright/test";
import { readFileSync } from "fs";
import { createLazPerf } from "laz-perf";
import { test, expect, addHole, blankCourse, importSite, course, editorState, screenOf, withLidar, SITE } from "./fixtures";
import { createEmptyCourse, newHole, normalizeCourse } from "../../src/lib/course";
import { getGeoBounds } from "../../src/lib/geo/core";
import { claim, flownOn, gather, gatherer, growthSaid, surveyWhen, grownTree, grownTrees, holeClears, leafOnAt, playClearing, roofHeights, saplings, fairwayTrees, findTrees, groundOnGrid, measureSite, readTile, siteBox, standingTrees, surveyYear, tilesFor, tilesOver, depthFor, withoutWires, type LazReader, type TilePoints } from "../../src/lib/lidar";
import { canopyStands } from "../../src/lib/canopy";
import { summerFills, treesFromSummer } from "../../src/lib/summerTrees";
import type { CourseItem, LidarTree } from "../../src/types";
import { postsAmong } from "../../src/lib/importSite";
import { treeStands } from "../../src/lib/geo/detect";
import { pointInPolygon } from "../../src/lib/geom";

const FT = 3.28084;
// The made-up survey's trees (tests/fixtures/lidar/make.py): meters east and north of the site's
// middle, height and crown radius (m), a conifer
const TREES = [[30, 20, 18, 4.5, 0], [-40, -10, 25, 2.6, 1], [60, -70, 22, 5, 0], ...[-60, -40, -20, 0, 20].map(x => [x, -40, 16, 3.5, 0])];
const W = 1200, H = 1000;
/** The survey the app picks over a site: the newest in the index whose box reaches it (by the year
 * the index has, or the one in its name). */
const newestOver = (b: { north: number; south: number; west: number; east: number }) => {
  const index = JSON.parse(readFileSync(new URL("../../public/lidar-index.json", import.meta.url), "utf8")) as { surveys: [string, number, number, number, number, number?][] };
  const over = index.surveys.filter(([, w, s, e, n]) => w < b.east && e > b.west && s < b.north && n > b.south).map(x => x[5] ?? surveyYear(x[0])).sort((a, c) => c - a);
  return `USGS LiDAR ${over[0]}`;
};
const ref = { ...getGeoBounds({ lat: SITE.lat, lon: SITE.lon, label: "" }, W, H), width: W, height: H };
const plan = (e: number, n: number) => ({ x: W / 2 + e * FT, y: H / 2 - n * FT });

plain("trees and ground from a LiDAR tile: each tree where it stands, as tall and wide as it is (leafy: the survey keeps no date); the ground's slope (pure logic)", async () => {
  const lp = (await createLazPerf()) as unknown as LazReader;
  const pts = readTile(lp, new Uint8Array(readFileSync(new URL("../fixtures/lidar/ept-data/0-0-0-0.laz", import.meta.url))), ref, siteBox(ref));
  plainExpect(pts.n).toBeGreaterThan(50_000);
  const g = gatherer(W, H);
  gather(g, pts);
  plainExpect(g.classes.flatMap((n, c) => (n ? [c] : []))).toEqual([2, 5]);
  const m = measureSite(g);
  // (no telling when it flew: a conifer only from a very narrow, pointed crown, and the made-up
  // one is a round-topped column)
  plainExpect(m.leafOn).toBeNull();
  const trees = findTrees(m);
  plainExpect(trees).toHaveLength(TREES.length);
  for (const [e, n, h, r] of TREES) {
    const p = plan(e, n);
    const t = trees.reduce((a, b) => (Math.hypot(b[0] - p.x, b[1] - p.y) < Math.hypot(a[0] - p.x, a[1] - p.y) ? b : a));
    plainExpect(Math.hypot(t[0] - p.x, t[1] - p.y)).toBeLessThan(5);
    plainExpect(Math.abs(t[2] - h * FT)).toBeLessThan(2.5);
    plainExpect(Math.abs(t[3] - r * FT)).toBeLessThan(5);
    plainExpect(t[4]).toBe(0);
  }
  // The ground: rising 2 ft in every 100 east, on the plan's grid (ft over its lowest point)
  const gg = groundOnGrid(m, W, H, 10);
  plainExpect((gg.heights["1000,500"] ?? 0) - (gg.heights["200,500"] ?? 0)).toBeCloseTo(16, 0);
  plainExpect(gg.min).toBeGreaterThan(180 * FT - 30);
  // Which tiles to read, how deep, and a survey's year from its name
  plainExpect(depthFor({ bounds: [0, 0, 0, 69934, 69934, 69934], span: 128, dataType: "laszip" })).toBe(9);
  const asked: string[] = [];
  const tiles = await tilesOver({ bounds: [0, 0, 0, 1024, 1024, 1024], span: 128, dataType: "laszip" }, [0, 0, 100, 100], 1, async key => {
    asked.push(key);
    return key === "0-0-0-0" ? { "0-0-0-0": 10, "1-0-0-0": -1, "1-1-1-0": 5 } : { "1-0-0-0": 7, "2-0-0-0": 3 };
  });
  plainExpect(tiles).toEqual([{ key: "0-0-0-0", points: 10 }, { key: "1-0-0-0", points: 7 }]);
  plainExpect(asked).toEqual(["0-0-0-0", "1-0-0-0"]);
  // (down only as deep as it takes for about half a meter between points: 3 a square meter by
  // the tiles' own count, here at the second depth)
  const deep = { bounds: [0, 0, 0, 400, 400, 400], span: 128, dataType: "laszip" };
  const box: [number, number, number, number] = [0, 0, 100, 100];
  plainExpect(tilesFor(deep, box, [{ key: "0-0-0-0", points: 1e5 }, { key: "1-0-0-0", points: 2e5 }, { key: "2-0-0-0", points: 9e4 }, { key: "3-0-0-0", points: 3e4 }]).map(t => t.key)).toEqual(["0-0-0-0", "1-0-0-0"]);
  plainExpect(surveyYear("USGS_LPC_IL_WestCentral_2017_LAS_2019")).toBe(2019);
  // (USGS's newer names carry a work code: A22 is 2022; none at all is the oldest)
  plainExpect(surveyYear("KY_Western_1_A22")).toBe(2022);
  plainExpect(surveyYear("CA_CaliforniaGaps_3_B23")).toBe(2023);
  plainExpect(surveyYear("KY_FullState")).toBe(0);
  plainExpect(surveyYear("CA_FEMA_Z4_B1_2018")).toBe(2018);
});

plain("trees on a fairway stand unless taken out; with the fairways cleared, cut down unless kept; a hole's fairway trees counted (pure logic)", () => {
  const trees: LidarTree[] = [[100, 300, 50, 12, 0], [200, 302, 50, 12, 0], [300, 298, 50, 12, 0], [200, 400, 50, 12, 0]];
  const doc: any = { ...createEmptyCourse(), lidar: { source: "USGS LiDAR 2019", trees } };
  // (the fairway: a strip along y = 300)
  const cleared = (p: { x: number; y: number }, reach: number) => Math.abs(p.y - 300) < 15 + reach;
  const hole = newHole({ fairwayWidth: 30 });
  const line = [{ x: 50, y: 300 }, { x: 350, y: 300 }];
  // (left alone by default: every one stands, those on the fairway in the way; where nothing is
  // cleared the view hands no clearing in, see playClearing)
  const none = () => false;
  plainExpect(standingTrees(doc.lidar, none)).toEqual({ stand: [0, 1, 2, 3], cut: [] });
  plainExpect(fairwayTrees(doc, hole, line)).toEqual({ cut: [], kept: [], standing: [0, 1, 2] });
  doc.lidar = { ...doc.lidar, removed: [0, 3] };
  plainExpect(standingTrees(doc.lidar, none)).toEqual({ stand: [1, 2], cut: [0, 3] });
  plainExpect(fairwayTrees(doc, hole, line)).toEqual({ cut: [0], kept: [], standing: [1, 2] });
  // (the fairways cleared: cut down unless kept)
  doc.lidar = { ...doc.lidar, clearFairways: true, kept: [1], removed: [3] };
  plainExpect(standingTrees(doc.lidar, cleared)).toEqual({ stand: [1], cut: [0, 2, 3] });
  plainExpect(fairwayTrees(doc, hole, line)).toEqual({ cut: [0, 2], kept: [1], standing: [] });
});

test("trees measured from the air on import: left standing on a fairway, cleared by the hole's own switch; with the fairways cleared, cut down, a stump to bring each back, the hole's switch standing its own again; cut down by hand; flyovers keep clear", async ({ page }) => {
  test.setTimeout(240_000);
  await withLidar(page);
  await importSite(page);
  const doc = await course(page);
  // (the newest survey over the site, read by its year or its work code: the made-up one is served for it)
  expect(doc.lidar.source).toBe(newestOver(doc.site.bounds));
  expect(doc.lidar.trees).toHaveLength(TREES.length);
  expect(doc.site.elevationSource).toBe(newestOver(doc.site.bounds));
  // (none guessed from the photo as well)
  expect(doc.items.filter((i: any) => i.type === "tree" || (i.type === "area" && i.kind === "woods"))).toHaveLength(0);
  const W2 = doc.canvas.width, H2 = doc.canvas.height;
  const at = (e: number, n: number) => ({ x: W2 / 2 + e * FT, y: H2 / 2 - n * FT });
  const nearest = (p: { x: number; y: number }) => doc.lidar.trees.findIndex((t: number[]) => Math.hypot(t[0] - p.x, t[1] - p.y) < 6);
  // A hole down the row of five trees: they're cut down, stumps where they stood
  const forest = () => page.evaluate(() => (window as any).__dgView.forestInfo().trees);
  const row = [-60, -40, -20, 0, 20].map(e => nearest(at(e, -40)));
  expect(row.every(k => k >= 0)).toBe(true);
  const hole = await addHole(page, at(-75, -40), at(35, -40));
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  // (left standing: the hole says so, and its own switch clears them, for this hole alone; off again)
  await expect(page.getByTestId("fairway-trees")).toContainText("5 trees stand on this fairway");
  await expect(page.locator("[data-stump]")).toHaveCount(0);
  await page.getByTestId("hole-clear-trees").check();
  // (said: on a slow machine other messages can take its place on screen before it's looked for)
  await expect.poll(() => page.evaluate(() => ((window as any).__dgSaid as string[]).some(t => /^Trees on hole 1's fairway, tees and basket are cut down/.test(t)))).toBe(true);
  await expect.poll(async () => (await course(page)).holes[0].clearTrees).toBe(true);
  // (the hole's own setting, not a list of trees taken out: they follow the fairway if it moves)
  expect((await course(page)).lidar.removed).toBeUndefined();
  expect((await course(page)).lidar.clearFairways).toBeUndefined();
  await expect(page.getByTestId("fairway-trees")).toContainText("5 trees cut down on this hole");
  for (const k of row) await expect(page.locator(`[data-stump="${k}"]`)).toHaveAttribute("data-testid", "stump");
  await page.getByTestId("hole-clear-trees").uncheck();
  await expect.poll(async () => (await course(page)).holes[0].clearTrees).toBeUndefined();
  await expect(page.getByTestId("fairway-trees")).toContainText("5 trees stand on this fairway");
  await expect(page.locator("[data-stump]")).toHaveCount(0);
  // (trees cut down by hand on a hole that isn't cleared: said under its switch, with the way back)
  await page.evaluate(r => (window as any).__dgActions.lidar({ removed: r }), [row[0], row[1]].sort((a, b) => a - b));
  await expect(page.getByTestId("fairway-trees")).toContainText("3 trees stand on this fairway");
  await expect(page.getByTestId("fairway-trees")).toContainText("2 cut down by hand");
  await page.getByTestId("trees-back").click();
  await expect.poll(async () => (await course(page)).lidar.removed).toBeUndefined();
  await expect(page.getByTestId("fairway-trees")).toContainText("5 trees stand on this fairway");
  // The fairways cleared for the whole course
  await page.evaluate(() => (window as any).__dgActions.lidar({ clearFairways: true }));
  for (const k of row) await expect(page.locator(`[data-stump="${k}"]`)).toHaveAttribute("data-testid", "stump");
  await expect(page.getByTestId("fairway-trees")).toContainText("5 trees cut down on this hole");
  await expect(page.getByTestId("hole-clear-trees")).toBeChecked();
  const before = await forest() + 5;
  // One brought back with a click on its stump (one undo step); one not under the hole's label or handles
  const free = await page.evaluate(row => row.find(k => {
    const el = document.querySelector(`[data-stump="${k}"]`) as HTMLElement | null;
    if (!el || el.offsetParent === null || getComputedStyle(el).visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
  }) ?? null, row);
  expect(free).not.toBeNull();
  await page.locator(`[data-stump="${free}"]`).click();
  await expect.poll(async () => (await course(page)).lidar.kept).toEqual([free]);
  await expect.poll(forest).toBe(before - 4);
  await expect(page.getByTestId("kept-tree")).toHaveCount(1);
  await expect(page.getByTestId("fairway-trees")).toContainText("4 trees cut down");
  await expect(page.getByTestId("fairway-trees")).toContainText("1 kept");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).lidar.kept).toBeUndefined();
  // The hole's own switch off while the course clears: its trees stand again; on, as the course's
  await page.getByTestId("hole-clear-trees").uncheck();
  await expect.poll(async () => (await course(page)).holes[0].clearTrees).toBe(false);
  await expect.poll(forest).toBe(before);
  await expect(page.getByTestId("fairway-trees")).toContainText("5 trees stand on this fairway");
  await page.getByTestId("hole-clear-trees").check();
  await expect.poll(async () => (await course(page)).holes[0].clearTrees).toBeUndefined();
  await expect.poll(forest).toBe(before - 5);
  // One kept by its stump, and cut down again from the hole
  await page.locator(`[data-stump="${free}"]`).click();
  await expect.poll(async () => (await course(page)).lidar.kept).toEqual([free]);
  await page.getByTestId("trees-down").click();
  await expect.poll(async () => (await course(page)).lidar.kept).toBeUndefined();
  await expect.poll(forest).toBe(before - 5);
  // A tree off the fairway cut down from its right-click menu, and back with its stump
  await page.keyboard.press("Escape");
  // (one standing: not on the footpath across the site)
  const spots = [at(60, -70), at(-40, -10), at(30, 20)];
  const standing = await page.evaluate(qs => qs.map(q => (window as any).__dgView.lidarTreeAt(q)), spots);
  const here = spots[standing.findIndex((k: number | null) => k !== null)];
  expect(here).toBeTruthy();
  const lone = nearest(here);
  const p = await screenOf(page, here.x, here.y);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Cut down this tree" }).click();
  await expect.poll(async () => (await course(page)).lidar.removed).toEqual([lone]);
  await expect.poll(forest).toBe(before - 6);
  // (stumps away from the hole picked show close up when asked for, in Layers; never on a map only looked at)
  await page.evaluate(([x, y]) => { const v = (window as any).__dgView; v.controls.moveTo(x, v.h(x, y), y, false); v.controls.dollyTo(120, false); v.invalidate(); }, [here.x, here.y]);
  await expect(page.locator(`[data-stump="${lone}"]`)).toBeHidden();
  await page.getByTestId("scene-button").click();
  await page.getByTestId("scene-panel").getByRole("checkbox", { name: "Stumps where trees were cut" }).check();
  await page.getByTestId("scene-button").click();
  await page.locator(`[data-stump="${lone}"]`).click();
  await expect.poll(async () => (await course(page)).lidar.removed).toBeUndefined();
  // Flyovers keep clear of the trees standing: one measured tree's crown, as tall as it is
  // (once the view has stood it up again)
  await expect.poll(() => page.evaluate(p => !!(window as any).__dgView.canopyAt(p, 4), here), { timeout: 30_000 }).toBe(true);
  const crown = await page.evaluate(p => (window as any).__dgView.canopyAt(p, 4), here);
  expect(crown.top - (await page.evaluate(p => (window as any).__dgView.h(p.x, p.y), here))).toBeGreaterThan(55);
  expect((await editorState(page)).step).toBe("design");
});

test("an existing course measured from the air from the Site step (Undo takes it back)", async ({ page }) => {
  test.setTimeout(180_000);
  await importSite(page, { trees: false, osm: false });
  expect((await course(page)).lidar).toBeUndefined();
  await withLidar(page);
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  // (no survey read on the import: its row under What came in, folded, says so and looks again)
  await page.getByTestId("came-in").locator(":scope > summary").click();
  await page.getByTestId("lidar-info").getByTestId("measure-lidar").click();
  await expect.poll(async () => (await course(page)).lidar?.trees.length ?? 0, { timeout: 60_000 }).toBe(TREES.length);
  await expect(page.getByTestId("lidar-info")).toContainText(`${TREES.length} measured trees`);
  await expect(page.getByTestId("lidar-info")).toContainText(newestOver((await course(page)).site.bounds));
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).lidar).toBeUndefined();
});

plain("measured trees never stand where no tree does (in water, on a road): cut, unless kept (pure logic)", () => {
  const lidar = { source: "test", trees: [[10, 10, 40, 12, 0], [100, 100, 40, 12, 0], [200, 200, 40, 12, 0]] as LidarTree[], kept: [2] };
  // (the second is in a river, the third on a road but kept by hand)
  const inRiverOrRoad = (p: { x: number; y: number }) => p.x > 50;
  const { stand, cut } = standingTrees(lidar, () => false, inRiverOrRoad);
  plainExpect(stand).toEqual([0, 2]);
  plainExpect(cut).toEqual([1]);
});

plain("a tree the survey found twice stands once; the taller taken out by hand (cut, or made the course's own to move or delete), the shorter doesn't stand up in its place (pure logic)", () => {
  const trees: LidarTree[] = [[100, 100, 60, 12, 0], [103, 100, 57, 10, 0], [300, 300, 40, 9, 0]];
  const lidar = { trees, year: 2020 } as any;
  plainExpect(standingTrees(lidar, () => false).stand).toEqual([0, 2]);
  plainExpect(standingTrees({ ...lidar, removed: [0] }, () => false)).toEqual({ stand: [2], cut: [0] });
});

plain("measured trees smaller than the course keeps are cut, unless kept by hand (pure logic)", () => {
  const lidar = { source: "test", trees: [[10, 10, 12, 6, 0], [100, 100, 40, 12, 0], [200, 200, 8, 4, 0]] as LidarTree[], kept: [2], minHeight: 15 };
  const { stand, cut } = standingTrees(lidar, () => false);
  plainExpect(stand).toEqual([1, 2]);
  plainExpect(cut).toEqual([0]);
});

plain("measured trees grown since the survey: small ones the most, tall ones hardly, crowns with them (pure logic)", () => {
  const small = grownTree([0, 0, 10, 4, 0], 9), mid = grownTree([0, 0, 50, 15, 0], 9), tall = grownTree([0, 0, 95, 25, 0], 9);
  plainExpect(small[2] - 10).toBeGreaterThan(mid[2] - 50);
  plainExpect(mid[2] - 50).toBeGreaterThan(tall[2] - 95);
  plainExpect(small[2]).toBeGreaterThan(25);
  plainExpect(tall[2]).toBeLessThan(100);
  plainExpect(mid[3]).toBeGreaterThan(15);
  plainExpect(grownTree([0, 0, 40, 12, 1], 0)).toEqual([0, 0, 40, 12, 1]);
});

plain("crown size: every measured crown as much wider or narrower, the list kept as it is otherwise (pure logic)", () => {
  const trees: LidarTree[] = [[10, 10, 40, 12, 0], [60, 10, 30, 8, 1]];
  plainExpect(grownTrees({ source: "x", trees })).toBe(trees);
  const wider = grownTrees({ source: "x", trees, crownSize: 1.5 });
  plainExpect(wider.map(t => t[3])).toEqual([18, 12]);
  plainExpect(wider.map(t => [t[0], t[1], t[2], t[4]])).toEqual(trees.map(t => [t[0], t[1], t[2], t[4]]));
});

plain("trees from the summer photo where a bare survey missed them: in the leafy gaps with height measured near, none under a measured crown, on the lawn or where they may not stand (pure logic)", () => {
  // (a 400 x 200 ft site, 1 ft a cell: woods 20 to 60 ft high over its left half, bare limbs
  // standing 8 ft over the rest of the left half too; the photo leafy over the left half)
  const W2 = 400, H2 = 200, nx = W2, ny = H2;
  const canopy = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < 200; x++) canopy[y * nx + x] = x < 100 ? 40 : 8;
  const mask = new Uint8Array(W2 * H2);
  for (let y = 0; y < H2; y++) for (let x = 0; x < 200; x++) mask[y * W2 + x] = 1;
  // (the survey picked out three trees, all in the first 100 ft)
  const measured: LidarTree[] = [[30, 50, 45, 18, 0], [70, 100, 50, 20, 0], [30, 150, 40, 16, 0]];
  const added = treesFromSummer(measured, { nx, ny, cell: 1, canopy }, { mask, w: W2, h: H2 }, W2, H2, p => p.x > 160 && p.y < 60);
  plainExpect(added.length).toBeGreaterThan(10);
  for (const t of added) {
    // (on the leafy half, clear of the measured crowns' middles, not where none may stand)
    plainExpect(t[0]).toBeLessThan(200);
    for (const m of measured) plainExpect(Math.hypot(t[0] - m[0], t[1] - m[1])).toBeGreaterThan(m[3] * 0.85);
    plainExpect(t[0] > 160 && t[1] < 60).toBe(false);
    // (a crown sized from the height near it: never tiny, never past 30 ft)
    plainExpect(t[3]).toBeGreaterThanOrEqual(7);
    plainExpect(t[3]).toBeLessThanOrEqual(30);
    plainExpect(t[4]).toBe(0);
  }
  // (where the woods stand tall, trees as tall as them; out on the limbs, at least a grown tree's)
  plainExpect(added.filter(t => t[0] < 90).every(t => t[2] >= 39)).toBe(true);
  plainExpect(added.every(t => t[2] >= 12)).toBe(true);
  // (the added trees don't pile up on each other)
  for (let i = 0; i < added.length; i++) for (let j = i + 1; j < added.length; j++)
    plainExpect(Math.hypot(added[i][0] - added[j][0], added[i][1] - added[j][1])).toBeGreaterThan(Math.min(added[i][3], added[j][3]) * 0.8);
  // Only a bare survey under a photo taken in leaf (or one whose season isn't known)
  plainExpect(summerFills(false, "leaf-on")).toBe(true);
  plainExpect(summerFills(null, undefined)).toBe(true);
  plainExpect(summerFills(true, "leaf-on")).toBe(false);
  plainExpect(summerFills(false, "leaf-off")).toBe(false);
});

plain("saplings since the survey: none at once, more with the years, in the gaps (never under or against a crown), fast and narrow (pure logic)", () => {
  // (a wood with gaps: trees 50 ft apart, crowns 15 ft round)
  const woods: [number, number, number, number, 0 | 1][] = Array.from({ length: 200 }, (_, k) => [(k % 20) * 50, Math.floor(k / 20) * 50, 50, 15, 0]);
  plainExpect(saplings(woods, 0)).toEqual([]);
  const ten = saplings(woods, 10), twenty = saplings(woods, 20);
  plainExpect(ten.length).toBeGreaterThan(10);
  plainExpect(twenty.length).toBeGreaterThan(ten.length);
  const grownWoods = woods.map(t => grownTree(t, 10));
  for (const s of ten) {
    plainExpect(s[2]).toBeGreaterThanOrEqual(6);
    plainExpect(s[2]).toBeLessThan(40);
    plainExpect(s[3] / s[2]).toBeLessThan(15 / 50);
    // (clear of every crown, and near the wood it grows from)
    for (const t of grownWoods) plainExpect(Math.hypot(t[0] - s[0], t[1] - s[1])).toBeGreaterThanOrEqual(t[3] + 3 - 0.2);
    plainExpect(grownWoods.some(t => Math.hypot(t[0] - s[0], t[1] - s[1]) <= t[3] * 2 + 18.5)).toBe(true);
    for (const q of ten) if (q !== s) plainExpect(Math.hypot(q[0] - s[0], q[1] - s[1])).toBeGreaterThanOrEqual(8 - 0.2);
  }
  plainExpect(saplings(woods, 10)).toEqual(ten);
  // (a wood with no gaps: none)
  const dense: [number, number, number, number, 0 | 1][] = Array.from({ length: 100 }, (_, k) => [(k % 10) * 12 + 200, Math.floor(k / 10) * 12 + 200, 50, 15, 0]);
  plainExpect(saplings(dense, 10).filter(s => s[0] > 215 && s[0] < 293 && s[1] > 215 && s[1] < 293)).toEqual([]);
});

plain("growth since the survey: the trees aged, and saplings in the gaps only when asked for (pure logic)", () => {
  const woods: [number, number, number, number, 0 | 1][] = Array.from({ length: 200 }, (_, k) => [(k % 20) * 50, Math.floor(k / 20) * 50, 50, 15, 0]);
  const aged = grownTrees({ source: "x", trees: woods, growYears: 10 });
  plainExpect(aged).toHaveLength(woods.length);
  plainExpect(aged[0][2]).toBeGreaterThan(woods[0][2]);
  const young = grownTrees({ source: "x", trees: woods, growYears: 10, saplings: true });
  plainExpect(young.length).toBe(woods.length + saplings(woods, 10).length);
  plainExpect(young.length).toBeGreaterThan(woods.length);
});

test("any tree the app planted in a wood acts like a tree placed by hand: picked by a click, the same panel, deleted; a look only is no change", async ({ page }) => {
  test.setTimeout(180_000);
  await blankCourse(page);
  await page.evaluate(() => {
    (window as any).__dgEditor().set({ areaKind: "woods" });
    (window as any).__dgActions.addDrawn("area", [{ x: 300, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 700 }, { x: 300, y: 700 }]);
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const forest = () => page.evaluate(() => (window as any).__dgView.forestInfo().trees as number);
  await expect.poll(forest, { timeout: 40_000 }).toBeGreaterThan(50);
  const spot = async (cx: number, cy: number) => page.evaluate(([cx, cy]) => {
    const v = (window as any).__dgView;
    const spots = v.itemsGroup.children.flatMap((g: any) => g.userData.spots ?? []);
    const s = spots.sort((a: any, b: any) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
    return { x: s.x, y: s.y, height: s.height, at: v.toClient(s.x, s.y, s.height * 0.6) };
  }, [cx, cy]);
  const trees = async () => (await course(page)).items.filter((i: any) => i.type === "tree");
  const before = await forest();
  // (a step to redo, from before: looking at a tree leaves it there, and adds none of its own)
  await page.evaluate(() => { const w = window as any; w.__dgActions.style({ treeCover: 0.6 }); w.__dgStore.getState().undo(); });
  const hist = () => page.evaluate(() => (window as any).__dgHistory() as { past: number; future: number });
  const was = await hist();
  expect(was.future).toBe(1);
  // A click: the tree is picked, with the Tree panel, where it stood and as tall
  const a = await spot(550, 500);
  await page.mouse.click(a.at.x, a.at.y);
  await expect.poll(async () => (await trees()).length).toBe(1);
  const item = (await trees())[0];
  expect(Math.hypot(item.x - a.x, item.y - a.y)).toBeLessThan(0.5);
  expect(Math.abs(item.height - a.height)).toBeLessThanOrEqual(0.5);
  expect((await editorState(page)).selectedId).toBe(item.id);
  await expect(page.getByTestId("inspector")).toContainText("Tree");
  await expect.poll(forest).toBe(before - 1);
  // Let go without a change: as it was (looking isn't an edit)
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await trees()).length).toBe(0);
  await expect.poll(forest).toBe(before);
  // (Undo and Redo as they were: nothing to redo from the look, and the step from before still there)
  expect(await hist()).toEqual(was);
  // Picked and deleted: it stays gone
  await page.mouse.click(a.at.x, a.at.y);
  await expect.poll(async () => (await trees()).length).toBe(1);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await trees()).length).toBe(0);
  await expect.poll(forest).toBe(before - 1);
  await expect.poll(async () => (await course(page)).cutTrees?.length ?? 0).toBe(1);
  // Picked and made taller: kept, as a tree of the course's own
  const b = await spot(380, 380);
  await page.mouse.click(b.at.x, b.at.y);
  await expect.poll(async () => (await trees()).length).toBe(1);
  await page.getByRole("slider", { name: "Height" }).fill("60");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await trees()).map((t: any) => t.height)).toEqual([60]);
});

plain("the trees measured from the air in stands: crowns close together are one woods, a clearing between splits them, a tree alone stands on its own (pure logic)", async () => {
  // Two stands of 3 by 3 trees, 18 ft apart in each, 200 ft between the stands; one tree alone
  const stand = (x0: number, y0: number) => Array.from({ length: 9 }, (_, k) => ({ x: x0 + (k % 3) * 18, y: y0 + Math.floor(k / 3) * 18, r: 10 }));
  const a = stand(100, 100), b = stand(360, 120), lone = { x: 600, y: 500, r: 10 };
  const { cell, stands } = treeStands([...a, ...b, lone], 800, 700);
  plainExpect(stands).toHaveLength(2);
  const outlines = stands.map(s => s.outline.map(p => ({ x: p.x * cell, y: p.y * cell })));
  const inStand = (t: { x: number; y: number }) => outlines.findIndex(o => pointInPolygon(t, o));
  const ia = inStand(a[4]), ib = inStand(b[4]);
  plainExpect(ia).toBeGreaterThanOrEqual(0);
  plainExpect(ib).toBeGreaterThanOrEqual(0);
  plainExpect(ia).not.toBe(ib);
  for (const t of a) plainExpect(inStand(t)).toBe(ia);
  for (const t of b) plainExpect(inStand(t)).toBe(ib);
  plainExpect(inStand(lone)).toBe(-1);
  plainExpect(stands.map(s => s.trees).sort()).toEqual([9, 9]);
});

test("a drag box takes in the measured trees inside it: each made the course's own and picked together; let go untouched, they're as they were", async ({ page }) => {
  test.setTimeout(180_000);
  await withLidar(page);
  await importSite(page);
  const doc = await course(page);
  const W2 = doc.canvas.width, H2 = doc.canvas.height;
  const at = (e: number, n: number) => ({ x: W2 / 2 + e * FT, y: H2 / 2 - n * FT });
  const trees = async () => (await course(page)).items.filter((i: any) => i.type === "tree");
  await page.keyboard.press("Escape");
  // The row of five, in a Shift+drag box
  const from = await screenOf(page, at(-75, -25).x, at(-75, -25).y), to = await screenOf(page, at(35, -55).x, at(35, -55).y);
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await trees()).length).toBe(5);
  const picked = ((await editorState(page)).group as string[]).slice().sort();
  plainExpect(picked).toEqual((await trees()).map((t: any) => t.id).sort());
  plainExpect((await course(page)).lidar.removed).toHaveLength(5);
  await expect(page.getByTestId("inspector-title")).toHaveText("5 selected");
  // Let go without a change: the measured trees again, no items
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await trees()).length).toBe(0);
  plainExpect((await course(page)).lidar.removed).toBeUndefined();
});

test("measured trees stand on their own: a wood drawn over them, its edge pulled in past them or the wood deleted, they all still stand", async ({ page }) => {
  test.setTimeout(180_000);
  await withLidar(page);
  await importSite(page);
  const doc = await course(page);
  const W2 = doc.canvas.width, H2 = doc.canvas.height;
  const at = (e: number, n: number) => ({ x: W2 / 2 + e * FT, y: H2 / 2 - n * FT });
  const standing = () => page.evaluate(() => (window as any).__dgView.lidarState?.stand.length ?? 0);
  await expect.poll(standing).toBeGreaterThan(5);
  const all = await standing();
  // A wood round the row of five (x -60 to 20 m)
  const box = (e0: number, e1: number) => [at(e0, -30), at(e1, -30), at(e1, -50), at(e0, -50)];
  const id = await page.evaluate(pts => {
    (window as any).__dgEditor().set({ areaKind: "woods", tool: "select" });
    (window as any).__dgActions.addDrawn("area", pts, { straight: true });
    const d = (window as any).__dgCourse();
    return d.items[d.items.length - 1].id;
  }, box(-70, 30));
  await expect.poll(standing).toBe(all);
  // Its edge pulled in to x -30 m: the two trees west of it still stand
  await page.evaluate(([id, pts]) => (window as any).__dgActions.updateItem(id, { points: pts }), [id, box(-30, 30)] as const);
  await page.waitForTimeout(500);
  await expect.poll(standing).toBe(all);
  // The wood deleted: every tree still stands
  await page.evaluate(id => { (window as any).__dgActions.select(id); }, id);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await course(page)).items.some((i: any) => i.id === id)).toBe(false);
  await page.waitForTimeout(500);
  await expect.poll(standing).toBe(all);
});

plain("two tops on one crown, close together with no dip between them, are one tree (pure logic)", () => {
  const nx = 40, ny = 40, cell = 3;
  const canopy = new Float32Array(nx * ny);
  // A broad 60 ft crown with two leaders 9 ft apart, and a second tree well off with a gap between
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const d1 = Math.hypot(i - 12, j - 20), d2 = Math.hypot(i - 15, j - 20), d3 = Math.hypot(i - 32, j - 20);
    canopy[j * nx + i] = Math.max(d1 < 7 ? 60 - d1 * 0.4 : 0, d2 < 7 ? 59.8 - d2 * 0.4 : 0, d3 < 5 ? 45 - d3 : 0);
  }
  const trees = findTrees({ nx, ny, cell, canopy });
  plainExpect(trees).toHaveLength(2);
});

/** Made-up survey points (plan ft): x, y, z, class, how many returns the pulse had. */
const pointsOf = (list: [number, number, number, number, number?][], times: number[] = []): TilePoints => {
  const n = list.length, p: TilePoints = { n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), cls: new Uint8Array(n), returns: new Uint8Array(n), times };
  list.forEach(([x, y, z, c, r = 1], k) => { p.x[k] = x; p.y[k] = y; p.z[k] = z; p.cls[k] = c; p.returns[k] = r; });
  return p;
};
/** GPS time as the surveys keep it (adjusted standard: seconds since 1980-01-06, less a billion). */
const gpsAt = (iso: string) => (Date.parse(iso) - Date.UTC(1980, 0, 6)) / 1000 - 1e9;

plain("a survey that sorted only the ground: a roof is no tree (flat, each pulse back once), a tree is (its pulses go on through), nor one inside a building's outline; the ground's spike on a roof left out; the building's height (pure logic)", () => {
  const W2 = 320, H2 = 200, list: [number, number, number, number, number?][] = [];
  const onRoof = (x: number, y: number) => x >= 40 && x <= 100 && y >= 40 && y <= 90;
  const onGable = (x: number, y: number) => x >= 130 && x <= 170 && y >= 120 && y <= 170;
  for (let x = 0; x < W2; x += 1.5) for (let y = 0; y < H2; y += 1.5) {
    if (onRoof(x, y)) list.push([x, y, 120, 1]);
    // (a gable: walls 15 ft, its ridge 10 ft over them along the middle)
    else if (onGable(x, y)) list.push([x, y, 115 + 10 * (1 - Math.abs(y - 145) / 25), 1]);
    else list.push([x, y, 100, 2]);
  }
  // (a few roof points the survey took for ground: a spike 20 ft up)
  for (let x = 60; x < 70; x += 1.5) for (let y = 60; y < 70; y += 1.5) list.push([x, y, 120.2, 2]);
  // Trees: a crown 15 ft round, 50 ft up, each pulse back from its leaves and again from deeper in
  const tree = (cx: number, cy: number) => {
    for (let x = cx - 15; x <= cx + 15; x += 1) for (let y = cy - 15; y <= cy + 15; y += 1) {
      const d = Math.hypot(x - cx, y - cy) / 15;
      if (d > 1) continue;
      list.push([x, y, 150 - 6 * d * d, 1, 2], [x + 0.3, y + 0.3, 130 - ((x * 7 + y * 3) % 12), 1, 2]);
    }
  };
  tree(240, 100);
  tree(280, 40);
  const g = gatherer(W2, H2);
  gather(g, pointsOf(list));
  const dem = { values: new Float32Array(16).fill(100 / FT), samplesX: 4, samplesY: 4 };
  const house = [{ x: 262, y: 22 }, { x: 298, y: 22 }, { x: 298, y: 58 }, { x: 262, y: 58 }];
  for (const withDem of [true, false]) {
    const m = measureSite(g, { dem: withDem ? dem : null, outlines: [house] });
    plainExpect(m.sorted).toBe(false);
    const trees = findTrees(m);
    plainExpect(trees).toHaveLength(1);
    plainExpect(Math.hypot(trees[0][0] - 240, trees[0][1] - 100)).toBeLessThan(4);
    plainExpect(Math.abs(trees[0][2] - 50)).toBeLessThan(2);
    plainExpect(Math.abs(trees[0][3] - 15)).toBeLessThan(4);
    // The ground level under the roof, its spike left out
    const gg = groundOnGrid(m, W2, H2, 10);
    plainExpect(gg.max - gg.min).toBeLessThan(1);
    // Heights: the flat roof 20 ft up, the gable's walls 15 ft and its ridge near 25
    const flat = roofHeights(m, [{ x: 40, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 90 }, { x: 40, y: 90 }])!;
    plainExpect(flat.flat).toBe(true);
    plainExpect(Math.abs(flat.eaves - 20)).toBeLessThan(1);
    const gable = roofHeights(m, [{ x: 130, y: 120 }, { x: 170, y: 120 }, { x: 170, y: 170 }, { x: 130, y: 170 }])!;
    plainExpect(gable.flat).toBe(false);
    plainExpect(gable.eaves).toBeGreaterThan(14);
    plainExpect(gable.eaves).toBeLessThan(19);
    plainExpect(gable.ridge).toBeGreaterThan(22);
    // (none where the survey shows only ground: built since it flew)
    plainExpect(roofHeights(m, [{ x: 180, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 60 }, { x: 180, y: 60 }])).toBeNull();
  }
});

plain("two surveys each over part of the site make one: the newest where it flew, the older only for the rest (pure logic)", () => {
  const g = gatherer(200, 100), first: [number, number, number, number][] = [], second: [number, number, number, number][] = [];
  for (let x = 0; x < 200; x += 1.5) for (let y = 0; y < 100; y += 1.5) {
    if (x < 120) first.push([x, y, 100, 2]);
    second.push([x, y, 103, 2]);
  }
  gather(g, pointsOf(first), 1);
  const c = claim(g, 1);
  plainExpect(c.open).toBeGreaterThan(0.2);
  plainExpect(c.box!.x0).toBeGreaterThanOrEqual(96);
  gather(g, pointsOf(second), 2);
  plainExpect(claim(g, 2).open).toBe(0);
  const m = measureSite(g);
  const at = (x: number, y: number) => m.ground[Math.floor(y / m.cell) * m.nx + Math.floor(x / m.cell)];
  plainExpect(at(50, 50)).toBeCloseTo(100, 1);
  plainExpect(at(180, 50)).toBeCloseTo(103, 1);
});

plain("when a survey flew, from its points' GPS times, and whether the trees were in leaf (pure logic)", () => {
  plainExpect(flownOn(Array.from({ length: 20 }, (_, k) => gpsAt("2022-02-19T15:00:00Z") + k * 60))?.toISOString().slice(0, 10)).toBe("2022-02-19");
  // (seconds of the GPS week, as older surveys keep it: no date)
  plainExpect(flownOn(Array.from({ length: 20 }, (_, k) => 3600 * k))).toBeNull();
  plainExpect(leafOnAt(new Date("2022-02-19"))).toBe(false);
  plainExpect(leafOnAt(new Date("2022-07-01"))).toBe(true);
  plainExpect(leafOnAt(new Date("2022-04-28"))).toBeNull();
  plainExpect(leafOnAt(null)).toBeNull();
});

plain("conifers only where they show: pointed in a survey flown in leaf, solid in one flown bare, very narrow and pointed with no telling (pure logic)", () => {
  const nx = 60, ny = 30, cell = 2, n = nx * ny;
  const canopy = new Float32Array(n), nUp = new Uint8Array(n), nGround = new Uint8Array(n);
  // A cone 50 ft up, 12 ft across at its foot; a round crown as tall, 30 ft round
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    const dc = Math.hypot(x - 29, y - 29), dd = Math.hypot(x - 85, y - 29);
    if (dc <= 6) canopy[c] = 50 - 7 * dc;
    else if (dd <= 15) canopy[c] = 50 - 6 * (dd / 15) ** 2;
  }
  const kinds = (leafOn: boolean | null, solidCone: boolean) => {
    for (let c = 0; c < n; c++) {
      const cone = Math.hypot(((c % nx) + 0.5) * cell - 29, (Math.floor(c / nx) + 0.5) * cell - 29) <= 8;
      nUp[c] = cone && solidCone ? 4 : 1;
      nGround[c] = cone && solidCone ? 0 : 3;
    }
    return findTrees({ nx, ny, cell, canopy, nUp, nGround, leafOn }).sort((a, b) => a[0] - b[0]).map(t => t[4]);
  };
  plainExpect(kinds(true, false)).toEqual([1, 0]);
  plainExpect(kinds(null, false)).toEqual([1, 0]);
  // (bare of leaves: the laser goes on through the round crown's twigs, and through the cone's
  // too unless it keeps its needles)
  plainExpect(kinds(false, true)).toEqual([1, 0]);
  plainExpect(kinds(false, false)).toEqual([0, 0]);
});

plain("woods from the canopy: crowns close together one wood, a clearing 40 ft across kept open, a gap of 8 ft filled, a road through it parts it, a tree alone stays a tree (pure logic)", () => {
  const nx = 200, ny = 100, cell = 2, canopy = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    const wood = x > 20 && x < 300 && y > 20 && y < 180 && Math.hypot(x - 100, y - 100) > 20 && !(Math.abs(x - 200) < 4 && Math.abs(y - 60) < 4);
    if (wood || Math.hypot(x - 360, y - 100) < 12) canopy[j * nx + i] = 40;
  }
  const trees: [number, number, number, number, 0][] = [[50, 50, 40, 10, 0], [150, 150, 40, 10, 0], [60, 150, 40, 10, 0], [270, 60, 40, 10, 0], [280, 150, 40, 10, 0], [260, 100, 40, 10, 0], [360, 100, 40, 12, 0]];
  const { stands, inStand } = canopyStands({ nx, ny, cell, canopy }, trees, { lines: [{ points: [{ x: 230, y: 0 }, { x: 230, y: 200 }], width: 22 }] });
  plainExpect(stands).toHaveLength(2);
  const west = stands.find(s => pointInPolygon({ x: 50, y: 50 }, s.outline))!;
  plainExpect(west.trees).toBe(3);
  plainExpect(pointInPolygon({ x: 100, y: 100 }, west.outline)).toBe(false);
  plainExpect(pointInPolygon({ x: 200, y: 60 }, west.outline)).toBe(true);
  plainExpect(pointInPolygon({ x: 230, y: 100 }, west.outline)).toBe(false);
  plainExpect(inStand).toEqual([1, 1, 1, 1, 1, 1, 0]);
});

plain("a light pole is no tree: a lamp head the laser came back from once, hit here and there, left out; a small tree beside it kept (pure logic)", () => {
  const nx = 40, ny = 20, cell = 2, n = nx * ny;
  const canopy = new Float32Array(n), nUp = new Uint8Array(n), nMulti = new Uint8Array(n), nGround = new Uint8Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    const dp = Math.hypot(x - 15, y - 20), dt = Math.hypot(x - 55, y - 20);
    // A lamp 25 ft up, its head 8 ft across: solid, one return a pulse, a point in every other cell
    if (dp <= 4) { canopy[c] = 25 - dp * 0.2; nUp[c] = (i + j) % 2; nMulti[c] = 0; }
    // A small tree 25 ft up, 14 ft across: hit all over, its pulses going on through
    else if (dt <= 7) { canopy[c] = 25 - 2 * (dt / 7) ** 2 * 5; nUp[c] = 3; nMulti[c] = 2; nGround[c] = 1; }
  }
  const trees = findTrees({ nx, ny, cell, canopy, nUp, nMulti, nGround, leafOn: true });
  plainExpect(trees.length).toBe(1);
  plainExpect(trees[0][0]).toBeGreaterThan(45);
});

plain("a lamp post by a road is no tree in a survey flown bare; the same thing out in the park is a small tree and stays; a pole the map has is none either way (pure logic)", () => {
  const nx = 100, ny = 50, cell = 2, n = nx * ny;
  const canopy = new Float32Array(n), nUp = new Uint8Array(n), nMulti = new Uint8Array(n);
  const spots: [number, number][] = [[20, 20], [150, 40], [60, 80]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    // (each 25 ft up, 8 ft across, hit here and there, every pulse coming back once)
    if (spots.some(([sx, sy]) => Math.hypot(x - sx, y - sy) <= 4)) { canopy[c] = 25; nUp[c] = (i + j) % 2; nMulti[c] = 0; }
  }
  const trees: LidarTree[] = spots.map(([x, y]) => [x, y, 25, 4, 0]);
  const items = [
    { id: "r", type: "line", kind: "road", points: [{ x: 0, y: 34 }, { x: 60, y: 34 }] },
    { id: "p", type: "amenity", kind: "pole", x: 61, y: 79 }
  ] as unknown as CourseItem[];
  plainExpect([...postsAmong(trees, { nx, ny, cell, canopy, nUp, nMulti, leafOn: false }, items)].sort()).toEqual([0, 2]);
  // (flown in leaf, the survey tells a lamp from a tree itself: only the mapped pole here)
  plainExpect([...postsAmong(trees, { nx, ny, cell, canopy, nUp, nMulti, leafOn: true }, items)]).toEqual([2]);
});

plain("a power line is no row of trees: small crowns in a dead straight row, as high, thinly hit, left out; a row of trees along a road, hit all over, kept (pure logic)", () => {
  const wire: LidarTree[] = [0, 1, 2, 3, 4, 5].map(i => [100 + i * 40, 100 + i * 12, 28, 6, 0]);
  const row: LidarTree[] = [0, 1, 2, 3, 4].map(i => [100 + i * 30, 300, 30 + (i % 2) * 3, 8, 0]);
  const other: LidarTree[] = [[400, 400, 60, 25, 0]];
  const all = [...wire, ...row, ...other];
  const density = [...wire.map(() => 0.4), ...row.map(() => 2.2), 2.5];
  const kept = withoutWires(all, density);
  plainExpect(kept).toHaveLength(row.length + other.length);
  plainExpect(kept.every(t => t[1] !== 100 && !wire.includes(t))).toBe(true);
});

plain("which holes clear their trees: each by its own switch, or the course's; a hole's tees, basket and drawn fairway go with it, and what belongs to no hole with the course (pure logic)", () => {
  const doc = createEmptyCourse();
  const a = newHole(), b = newHole(), c = newHole();
  const trees: LidarTree[] = [[10, 10, 30, 6, 0]];
  const tee = (id: string, holeId: string) => ({ id, type: "tee", holeId, x: 0, y: 0, rotation: 0 }) as unknown as CourseItem;
  const basket = (id: string, holeId: string, alsoHoles?: string[]) => ({ id, type: "basket", holeId, alsoHoles, x: 0, y: 0, rotation: 0 }) as unknown as CourseItem;
  const loose = { id: "f", type: "area", kind: "fairway", points: [], x: 0, y: 0, rotation: 0 } as unknown as CourseItem;
  // (the course as it was before a hole had a switch: all or nothing, as ever)
  const off = playClearing({ holes: [a, b, c], lidar: { source: "s", trees } });
  plainExpect(off.any).toBe(false);
  plainExpect([a, b, c].map(h => off.hole(h.id))).toEqual([false, false, false]);
  plainExpect(off.item(loose)).toBe(false);
  const on = playClearing({ holes: [a, b, c], lidar: { source: "s", trees, clearFairways: true } });
  plainExpect([a, b, c].map(h => on.hole(h.id))).toEqual([true, true, true]);
  plainExpect(on.item(loose)).toBe(true);
  // (a tee whose hole is gone: with the course, as before)
  plainExpect(on.item(tee("t0", "gone"))).toBe(true);
  // (one hole cleared on a course that isn't)
  const one = playClearing({ holes: [a, { ...b, clearTrees: true }, c], lidar: { source: "s", trees } });
  plainExpect(one.any).toBe(true);
  plainExpect([a, b, c].map(h => one.hole(h.id))).toEqual([false, true, false]);
  plainExpect(one.item(tee("t1", b.id))).toBe(true);
  plainExpect(one.item(tee("t2", a.id))).toBe(false);
  plainExpect(one.item(loose)).toBe(false);
  // (a basket two holes play to: cleared while either does)
  plainExpect(one.item(basket("k1", a.id, [b.id]))).toBe(true);
  plainExpect(one.item(basket("k2", a.id, [c.id]))).toBe(false);
  // (one hole left standing on a course that clears)
  const but = playClearing({ holes: [a, { ...b, clearTrees: false }, c], lidar: { source: "s", trees, clearFairways: true } });
  plainExpect([a, b, c].map(h => but.hole(h.id))).toEqual([true, false, true]);
  plainExpect(but.item(tee("t1", b.id))).toBe(false);
  plainExpect(but.key).not.toBe(on.key);
  plainExpect(holeClears({ lidar: { source: "s", trees, clearFairways: true } }, { clearTrees: false })).toBe(false);
  plainExpect(holeClears({ lidar: { source: "s", trees } }, { clearTrees: true })).toBe(true);
  plainExpect(holeClears({ lidar: { source: "s", trees } }, {})).toBe(false);
  // (kept through a save and a load, either way round; a hole with none has none)
  const saved = normalizeCourse(JSON.parse(JSON.stringify({ ...doc, holes: [{ ...a, clearTrees: false }, { ...b, clearTrees: true }, c] })));
  plainExpect(saved.holes.map(h => h.clearTrees)).toEqual([false, true, undefined]);
  // (a hole's count of its trees follows its own switch)
  const hole = { ...newHole(), fairwayWidth: 30 }, line = [{ x: 0, y: 10 }, { x: 200, y: 10 }];
  const d = { ...doc, lidar: { source: "s", trees } };
  plainExpect(fairwayTrees(d, hole, line)).toEqual({ cut: [], kept: [], standing: [0] });
  plainExpect(fairwayTrees(d, { ...hole, clearTrees: true }, line)).toEqual({ cut: [0], kept: [], standing: [] });
  plainExpect(fairwayTrees({ ...d, lidar: { ...d.lidar, clearFairways: true as const } }, { ...hole, clearTrees: false }, line)).toEqual({ cut: [], kept: [], standing: [0] });
});

plain("Growth since the survey says why it's there: the survey's year, that the trees have grown since, and what the setting did (pure logic)", () => {
  const src = "USGS LiDAR 2017";
  // (the day it flew, where the survey's points say: the month named, the years from its year)
  const flown = { source: src, flown: "2017-04-05" };
  plainExpect(growthSaid(flown, 0, 2026)).toEqual({ text: "These trees were measured from the air in April 2017. They've grown since.", today: 9 });
  plainExpect(growthSaid(flown, 9, 2026)).toEqual({ text: "Measured from the air in April 2017, then grown 9 years to match today. It's an estimate.", today: 0 });
  plainExpect([surveyWhen(flown), surveyWhen(flown, true), surveyWhen({ source: src }), surveyWhen({ source: "USGS LiDAR" })]).toEqual(["April 2017", "Apr 2017", "2017", ""]);
  // (a survey with no year in its name, dated by its points)
  plainExpect(growthSaid({ source: "USGS LiDAR", flown: "2012-10-05" }, 0, 2026)).toEqual({ text: "These trees were measured from the air in October 2012. They've grown since.", today: 14 });
  plainExpect(growthSaid(src, 0, 2026)).toEqual({ text: "These trees were measured from the air in 2017. They've grown since.", today: 9 });
  plainExpect(growthSaid(src, 9, 2026)).toEqual({ text: "Measured from the air in 2017, then grown 9 years to match today. It's an estimate.", today: 0 });
  plainExpect(growthSaid(src, 4, 2026)).toEqual({ text: "Measured from the air in 2017, then grown 4 years, to 2021. It's an estimate.", today: 9 });
  plainExpect(growthSaid(src, 15, 2026)).toEqual({ text: "Measured from the air in 2017, then grown 15 years, to 2032: 6 years from now. It's an estimate.", today: 9 });
  plainExpect(growthSaid(src, 1, 2026).text).toContain("grown 1 year, to 2018");
  plainExpect(growthSaid(src, 0, 2017)).toEqual({ text: "These trees were measured from the air this year, in 2017.", today: 0 });
  // (no date on record at all: said so, with what to do, and no step to today)
  plainExpect(growthSaid("Aerial survey", 0, 2026)).toEqual({ text: "These trees were measured from the air, but the survey's date isn't on record. They've grown since: set how many years.", today: 0 });
  plainExpect(growthSaid("Aerial survey", 6, 2026)).toEqual({ text: "Grown 6 years since they were measured from the air. It's an estimate.", today: 0 });
});

test("the import's Trees step has Site's tree settings, and they come in with the site; Site says why growth is there, names underbrush as underbrush, and keeps what the import found", async ({ page }) => {
  test.setTimeout(240_000);
  await withLidar(page);
  await importSite(page, { review: async p => {
    // (looked over in 3D where the machine can keep up: they're on its Trees step; on the flat map, in the panel)
    const step = p.getByTestId("review-step-trees");
    if (await step.isVisible().catch(() => false)) await step.click();
    await p.getByTestId("review-tree-measured-open").click();
    const why = p.getByTestId("growth-why");
    // (when the survey was flown: said beside the measured trees, and in the growth's line)
    await expect(p.getByTestId("review-survey-when")).toContainText(/LiDAR, flown (\w{3} )?\d{4}/);
    await expect(why).toContainText(/These trees were measured from the air in (\w+ )?\d{4}\. They've grown since\./);
    await expect(p.getByTestId("grow-today")).toHaveText(/^Grow to today · \d+ years?$/);
    await p.getByTestId("grow-today").click();
    await expect(why).toContainText(/then grown \d+ years? to match today\. It's an estimate\./);
    await p.getByTestId("review-lidar-clear").getByRole("switch").click();
    await p.getByTestId("review-tree-kinds-open").click();
    // (one row open at a time)
    await expect(p.getByTestId("growth-why")).toHaveCount(0);
    await p.getByTestId("review-tree-kinds").getByRole("button", { name: "Maple", exact: true }).click();
    await p.getByTestId("review-tree-woods-open").click();
    await p.getByTestId("review-tree-woods").getByRole("radio", { name: "Everywhere" }).click();
    // (said on its row once it's closed)
    await p.getByTestId("review-tree-woods-open").click();
    await expect(p.getByTestId("review-tree-woods")).toContainText("Everywhere");
    await expect(p.getByTestId("review-tree-measured")).toContainText(/Grown \d+ years? \+1/);
  } });
  const doc = await course(page);
  const since = new Date().getFullYear() - surveyYear(doc.lidar.source);
  expect(since).toBeGreaterThan(0);
  expect(doc.lidar.growYears).toBe(since);
  expect(doc.lidar.clearFairways).toBe(true);
  expect(doc.style.treeKinds).toContain("maple");
  expect(doc.style.forestMeasured).toBe("everywhere");
  // Site: the same settings as they came in, the growth's why, and what came in
  await page.evaluate(() => (window as any).__dgStore.getState().change((d: any) => ({ items: [...d.items, { id: "ub1", type: "area", kind: "woods", importSource: "lidar", bushes: 1, x: 60, y: 60, rotation: 0, points: [{ x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 80 }, { x: 40, y: 80 }] }] }), false));
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  await page.getByTestId("site-trees").locator("summary").click();
  await expect(page.getByTestId("lidar-settings").getByTestId("growth-why")).toContainText("to match today");
  await expect(page.getByTestId("lidar-settings").getByTestId("grow-today")).toHaveCount(0);
  await expect(page.getByTestId("lidar-clear").locator("input")).toBeChecked();
  await page.getByTestId("came-in").locator("summary").first().click();
  await expect(page.getByTestId("brush-found")).toContainText("1 patch of underbrush");
  await expect(page.getByTestId("stands-found")).toHaveCount(0);
  await expect(page.getByTestId("import-notes")).toContainText(/What the import found \(\d+\)/);
  // A hole that differs from the course: Site says which, and puts them back in step
  const W2 = doc.canvas.width, H2 = doc.canvas.height;
  await page.getByRole("button", { name: /^2\s*Design$/ }).click();
  const hole = await addHole(page, { x: W2 / 2 - 250, y: H2 / 2 + 130 }, { x: W2 / 2 + 110, y: H2 / 2 + 130 });
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await expect(page.getByTestId("hole-clear-trees")).toBeChecked();
  await page.getByTestId("hole-clear-trees").uncheck();
  await expect.poll(async () => (await course(page)).holes[0].clearTrees).toBe(false);
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  // (the fold is shut again on coming back to the step)
  await page.getByTestId("site-trees").locator("summary").click();
  await expect(page.getByTestId("clear-own")).toBeVisible();
  await expect(page.getByTestId("clear-own")).toContainText("Not on hole 1");
  await page.getByTestId("clear-same").click();
  await expect.poll(async () => (await course(page)).holes[0].clearTrees).toBeUndefined();
  await expect(page.getByTestId("clear-own")).toHaveCount(0);
  // (the course's switch: every hole takes it)
  await page.evaluate(id => (window as any).__dgActions.hole(id, { clearTrees: true }), hole.id);
  await page.getByTestId("lidar-clear").locator("input").uncheck();
  await expect.poll(async () => { const d = await course(page); return [d.lidar.clearFairways, d.holes[0].clearTrees]; }).toEqual([undefined, undefined]);
});
