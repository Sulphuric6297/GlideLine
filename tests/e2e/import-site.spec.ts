import { test as plain, expect as plainExpect, type Page } from "@playwright/test";
import { test, expect, addHole, course, editorState, geoAt, importSite, noSurvey, SITE, STAND } from "./fixtures";
import { mappedCourse, osmFeaturesFrom, overpassQuery } from "../../src/lib/geo/osm";
import { getGeoBounds } from "../../src/lib/geo/core";
import { outlineFrom } from "../../src/lib/geo/parks";
import { kindFromName, rankSuggestions } from "../../src/lib/geo/geocode";
import { clipPathToRect, clipPolygonToRect, pointInPolygon as inPoly, polygonArea as polyArea } from "../../src/lib/geom";
import { boxFill, traceOutline, waterRegions, woodsRegions, type Canopy } from "../../src/lib/geo/detect";
import { decodeMvt, joinLines, tileFeatures, withoutTwins } from "../../src/lib/geo/vectorTiles";
import { courseFromMap, osmFeatureItems, parkSummary, reframeDesign, wallsFt } from "../../src/lib/importSite";
import { requiredCredit } from "../../src/lib/mapSvg";

/** A point given in meters east and north of the site's center, on the plan (ft from its north-west corner). */
const planOf = (doc: any, e: number, n: number) => ({ x: doc.canvas.width / 2 + e * 3.28084, y: doc.canvas.height / 2 - n * 3.28084 });

/** OpenStreetMap's servers answer with these elements (or `fail` for a server that can't be reached). */
const overpass = (page: Page, answer: (host: string) => object | "fail" | number, asked: string[] = []) =>
  page.route(/overpass|maps\.mail\.ru/, route => {
    const host = new URL(route.request().url()).host;
    asked.push(host);
    const a = answer(host);
    if (a === "fail") return route.abort();
    if (typeof a === "number") return route.fulfill({ status: a, body: "busy" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(a) });
  });
const footway = { type: "way", tags: { highway: "footway" }, geometry: [geoAt(-200, -80), geoAt(0, -20), geoAt(200, 40)] };
const pond = { type: "way", tags: { natural: "water" }, geometry: Array.from({ length: 13 }, (_, i) => geoAt(-150 + Math.cos((i / 12) * Math.PI * 2) * 35, -60 + Math.sin((i / 12) * Math.PI * 2) * 35)) };
const osmCount = async (page: Page) => (await course(page)).items.filter((i: any) => i.importSource === "osm").length;

test("bringing in a site: photo, elevation, trees, and OpenStreetMap paths and water", async ({ page }) => {
  const summary = await importSite(page);
  expect(summary).toMatch(/ft of elevation change across the site/);
  expect(summary).toMatch(/From OpenStreetMap: 1 path, 1 road, 1 stream|From OpenStreetMap: 1 path, 1 road, 1 water area, 1 parking lot/);
  const doc = await course(page);
  expect(doc.background).toMatch(/^data:image\/jpeg/);
  expect(doc.terrainHeights).toBeGreaterThan(1000);
  expect(doc.site.location.label).toMatch(/Springfield Park/);
  expect(doc.site.baseElevationFt).toBeGreaterThan(1900);
  expect(doc.site.elevationSource).toMatch(/global terrain tiles/);
  // About 1,500 x 1,000 ft framed around the place found
  expect(doc.canvas.width).toBeGreaterThan(1300);
  expect(doc.canvas.width).toBeLessThan(1700);
  const kinds = doc.items.map((i: any) => `${i.type}:${i.kind ?? ""}`);
  expect(kinds).toContain("area:water");
  expect(kinds).toContain("line:path");
  expect(kinds).toContain("line:road");
  expect(kinds).toContain("area:parking");
  expect(doc.items.find((i: any) => i.type === "area" && i.kind === "water").label).toBe("Mill Pond");
  expect(doc.items.filter((i: any) => i.type === "tree").length).toBeGreaterThan(0);
  // The stand of trees comes in as one wooded area, without trees of its own; the pond on the
  // photo is OpenStreetMap's Mill Pond, so it isn't there twice
  const woods = doc.items.filter((i: any) => i.type === "area" && i.kind === "woods" && i.importSource === "photo");
  expect(woods).toHaveLength(1);
  const stand = planOf(doc, STAND.e, STAND.n);
  expect(inPoly(stand, woods[0].points)).toBe(true);
  expect(Math.abs(polyArea(woods[0].points)) * 0.0929).toBeGreaterThan(900);
  expect(doc.items.filter((i: any) => i.type === "tree" && inPoly(i, woods[0].points))).toHaveLength(0);
  expect(doc.items.filter((i: any) => i.type === "area" && i.kind === "water")).toHaveLength(1);
  expect(summary).toMatch(/On the photo: 1 wooded area, \d+ trees?\./);
  expect(doc.name).toBe("Springfield Park Disc Golf Course");
  // On the Design step with the pointer: a look around first, not a hole at the first click
  await expect.poll(async () => (await editorState(page)).tool).toBe("select");
  await expect(page.getByTestId("tool-hint")).toHaveCount(0);
  // Listed with what came in by itself, to take out at once
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  await expect(page.getByTestId("photo-found")).toContainText(/^1 area and \d+ trees? from the photo/);
});

test("a hole up the hill: elevation change and par on the real terrain", async ({ page }) => {
  await importSite(page, { trees: false, osm: false });
  const doc = await course(page);
  // The stub hill rises to the north-east of the middle: tee south-west of it, basket on top
  const mid = { x: doc.canvas.width / 2, y: doc.canvas.height / 2 };
  const top = { x: mid.x + 120 * 3.28084, y: mid.y - 120 * 3.28084 };
  await addHole(page, { x: top.x - 300, y: top.y + 150 }, top);
  const row = page.getByTestId("hole-row");
  await page.keyboard.press("Escape");
  await row.click();
  // (the climb without its sign, in whole feet: the word under it says which way)
  await expect(page.getByTestId("hole-stats")).toContainText(/\d+ ft\s*Uphill/);
  await expect(page.getByTestId("hole-stats")).not.toContainText(/\+\d/);
  await expect(page.getByTestId("elevation-profile")).toBeVisible();
  // (its heights with their unit: bare four-figure heights read as years)
  await expect(page.getByTestId("elevation-profile").locator("text").first()).toHaveText(/^-?[\d,]+ ft$/);
  // The hover readout gives the real elevation above sea level (the mouse moved again while a busy
  // page catches up)
  let nudge = 0;
  await expect.poll(async () => {
    await page.mouse.move(800 + (nudge++ % 2) * 4, 500);
    return page.getByTestId("hover-readout").textContent();
  }, { timeout: 20_000 }).toMatch(/Elevation (19|20)\d\d ft/);
});

test("re-importing replaces the trees and shapes it brought in, and keeps the holes", async ({ page }) => {
  // (two whole imports)
  test.setTimeout(180_000);
  await noSurvey(page);
  await importSite(page);
  const before = await course(page);
  expect(before.items.filter((i: any) => i.type === "tree").length).toBeGreaterThan(0);
  await addHole(page, { x: 300, y: 600 }, { x: 600, y: 600 });
  await page.keyboard.press("Escape");
  await importSite(page);
  const after = await course(page);
  expect(after.holes).toHaveLength(1);
  expect(after.items.filter((i: any) => i.type === "area" && i.kind === "water")).toHaveLength(1);
  expect(after.items.filter((i: any) => i.type === "tree").length).toBe(before.items.filter((i: any) => i.type === "tree").length);
});

test("rivers and lakes mapped as outlines in pieces come in, roads and rivers are cut to the site's edges, buildings come in as buildings", async ({ page }) => {
  // A wide river across the whole site, mapped as a multipolygon in two pieces (one drawn the
  // other way round), its center line, and a road running a mile on past the site each way
  await overpass(page, () => ({
    elements: [
      { type: "relation", tags: { type: "multipolygon", natural: "water", water: "river", name: "Big River" }, members: [
        { type: "way", role: "outer", geometry: [geoAt(-3000, 20), geoAt(3000, 20), geoAt(3000, 60)] },
        { type: "way", role: "outer", geometry: [geoAt(-3000, 20), geoAt(-3000, 60), geoAt(3000, 60)] }
      ] },
      { type: "way", tags: { waterway: "river", name: "Big River" }, geometry: [geoAt(-3000, 40), geoAt(3000, 40)] },
      { type: "way", tags: { highway: "primary", name: "County Rd" }, geometry: [geoAt(-1500, -100), geoAt(1800, -100)] },
      // A clubhouse: two floors, a hipped roof
      { type: "way", tags: { building: "yes", "building:levels": "2", "roof:shape": "hipped", name: "Clubhouse" }, geometry: [geoAt(100, -50), geoAt(120, -50), geoAt(120, -40), geoAt(100, -40), geoAt(100, -50)] }
    ]
  }));
  const summary = await importSite(page, { trees: false });
  expect(summary).toMatch(/From OpenStreetMap: 1 road, 1 stream, 1 water area, 1 building\./);
  const doc = await course(page);
  const W = doc.canvas.width, H = doc.canvas.height;
  const onSite = (pts: { x: number; y: number }[]) => pts.every(p => p.x >= -21 && p.x <= W + 21 && p.y >= -21 && p.y <= H + 21);
  const river = doc.items.find((i: any) => i.type === "area" && i.kind === "water");
  expect(river.label).toBe("Big River");
  expect(onSite(river.points)).toBe(true);
  // Across the whole site, 40 m (131 ft) wide
  const xs = river.points.map((p: any) => p.x), ys = river.points.map((p: any) => p.y);
  expect(Math.min(...xs)).toBeLessThan(0);
  expect(Math.max(...xs)).toBeGreaterThan(W);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(125);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(137);
  for (const kind of ["road", "stream"]) {
    const line = doc.items.find((i: any) => i.type === "line" && i.kind === kind);
    expect(onSite(line.points), kind).toBe(true);
  }
  expect(doc.items.find((i: any) => i.kind === "road").label).toBe("County Rd");
  // The building comes in as one to edit: walls, its roof, its height
  const club = doc.items.find((i: any) => i.type === "structure");
  expect(club.kind).toBe("building");
  expect(club.roof).toBe("hip");
  expect(club.height).toBe(19.5);
  expect(club.label).toBe("Clubhouse");
  expect(club.importSource).toBe("osm");
});

test("the US maps add what OpenStreetMap hasn't got: a creek, a marsh and a building; its own pond isn't doubled; each credited on the map", async ({ page }) => {
  const ll = (e: number, n: number) => { const g = geoAt(e, n); return [g.lon, g.lat]; };
  const ring = (e: number, n: number, r: number) => Array.from({ length: 13 }, (_, i) => ll(e + Math.cos((i / 12) * Math.PI * 2) * r, n + Math.sin((i / 12) * Math.PI * 2) * r));
  const box = (e: number, n: number, w: number, h: number) => [ll(e, n), ll(e + w, n), ll(e + w, n + h), ll(e, n + h), ll(e, n)];
  // USGS: a creek across the north of the site, and OpenStreetMap's own pond (Mill Pond) again
  await page.route(/hydro\.nationalmap\.gov.*\/50\/query/, route => route.fulfill({ json: { features: [{ attributes: { featuretypelabel: "Channel Line", streamorder: 2, gnisidlabel: "Spring Creek" }, geometry: { paths: [[ll(-250, 100), ll(0, 110), ll(250, 120)]] } }] } }));
  await page.route(/hydro\.nationalmap\.gov.*\/60\/query/, route => route.fulfill({ json: { features: [{ attributes: { featuretypelabel: "Lake/Pond" }, geometry: { rings: [ring(-150, -60, 34)] } }] } }));
  // USFWS: a marsh east of the middle; FEMA: a building nobody has mapped
  await page.route(/wetlandsmapservice/, route => route.fulfill({ json: { features: [{ attributes: { WETLAND_TYPE: "Freshwater Emergent Wetland", ATTRIBUTE: "PEM1C" }, geometry: { rings: [ring(150, 70, 30)] } }] } }));
  await page.route(/USA_Structures_View/, route => route.fulfill({ json: { features: [{ attributes: { OCC_CLS: "Government", PRIM_OCC: "Public Restroom", HEIGHT: null }, geometry: { rings: [box(90, -40, 12, 9)] } }] } }));
  const summary = await importSite(page, { review: async p => {
    // Looked at first: the groups and their counts on the panel; the US maps' water on, as found
    await expect(p.getByTestId("review-buildings")).toContainText("FEMA");
    await expect(p.getByTestId("review-water")).toContainText("USGS and USFWS");
    await expect(p.getByTestId("review-govWater")).toHaveAttribute("aria-checked", "true");
  } });
  expect(summary).toMatch(/From the US maps, not on OpenStreetMap: 1 creek, 1 wetland, 1 building/);
  const items = (await course(page)).items;
  const creek = items.find((i: any) => i.type === "line" && i.importSource === "usgs");
  expect(creek).toMatchObject({ kind: "stream", label: "Spring Creek" });
  expect(items.filter((i: any) => i.type === "area" && i.kind === "water")).toHaveLength(1);
  expect(items.find((i: any) => i.type === "area" && i.importSource === "nwi")).toMatchObject({ kind: "rough", label: "Wetland" });
  expect(items.find((i: any) => i.type === "structure" && i.importSource === "fema")).toMatchObject({ kind: "building" });
  // Each credited on the printed map
  expect(requiredCredit(await course(page))).toMatch(/3D Hydrography.*National Wetlands Inventory.*USA Structures/);
});

test("a busy OpenStreetMap server: the next one is asked", async ({ page }) => {
  const asked: string[] = [];
  // The main one busy, the second out of time (it still answers, with a remark), the third answers
  await overpass(page, host => (host === "overpass-api.de" ? 504 : host === "overpass.private.coffee" ? { remark: "runtime error: Query timed out in \"query\" at line 1 after 31 seconds.", elements: [] } : { elements: [footway] }), asked);
  const summary = await importSite(page, { trees: false });
  expect(summary).toMatch(/From OpenStreetMap: 1 path\./);
  // (the import's own asks, last: the park's outline is looked up first, when it's picked)
  expect(asked.slice(-3)).toEqual(["overpass-api.de", "overpass.private.coffee", "maps.mail.ru"]);
});

test("OpenStreetMap out of reach: said plainly, with Try again; the Site step looks again any time", async ({ page }) => {
  let up = false;
  await overpass(page, () => (up ? { elements: [footway, pond] } : "fail"));
  await importSite(page, { trees: false });
  const warning = page.getByRole("status").filter({ hasText: "Couldn't reach OpenStreetMap" });
  await expect(warning).toBeVisible();
  expect(await osmCount(page)).toBe(0);
  up = true;
  await warning.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => osmCount(page)).toBe(2);
  await expect(page.getByRole("status").filter({ hasText: /From OpenStreetMap: 1 path/ })).toBeVisible();
  // Again from the Site step: what came before is replaced, not doubled, and Undo brings it back
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  // (under What came in, folded)
  await page.getByTestId("came-in").locator(":scope > summary").click();
  await expect(page.getByTestId("refresh-osm")).toHaveText("Update");
  await page.getByTestId("refresh-osm").click();
  await expect(page.getByRole("status").filter({ hasText: "From OpenStreetMap: 1 path, 1 water area." })).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await osmCount(page)).toBe(2);
});

plain("OpenStreetMap answers: ways, multipolygon outlines joined from their pieces, riverbanks, more road kinds (pure logic)", () => {
  const p = (lat: number, lon: number) => ({ lat, lon });
  const found = osmFeaturesFrom({
    elements: [
      // A lake in three pieces, out of order and one reversed, with an island
      { type: "relation", tags: { type: "multipolygon", natural: "water", name: "Lake" }, members: [
        { type: "way", role: "outer", geometry: [p(1, 1), p(1, 0)] },
        { type: "way", role: "outer", geometry: [p(0, 0), p(0, 1)] },
        { type: "way", role: "outer", geometry: [p(1, 0), p(0, 0)] },
        { type: "way", role: "outer", geometry: [p(0, 1), p(1, 1)] },
        { type: "way", role: "inner", geometry: [p(0.4, 0.4), p(0.4, 0.6), p(0.6, 0.6), p(0.4, 0.4)] }
      ] },
      // A riverbank as a closed way, a motorway ramp, a brook
      { type: "way", tags: { waterway: "riverbank" }, geometry: [p(2, 2), p(2, 3), p(3, 3), p(2, 2)] },
      { type: "way", tags: { highway: "motorway_link" }, geometry: [p(4, 4), p(5, 5)] },
      { type: "way", tags: { waterway: "brook" }, geometry: [p(6, 6), p(7, 7)] },
      // A river's route relation (its own ways come separately) and an unclosable outline: skipped
      { type: "relation", tags: { type: "waterway", waterway: "river" }, members: [{ type: "way", role: "", geometry: [p(8, 8), p(9, 9)] }] },
      { type: "relation", tags: { type: "multipolygon", natural: "wood" }, members: [{ type: "way", role: "outer", geometry: [p(8, 8), p(9, 9), p(9, 8)] }] }
    ]
  });
  plainExpect(found.map(f => `${f.geom}:${f.kind}`)).toEqual(["area:water", "area:water", "line:road", "line:stream"]);
  const lake = found[0];
  plainExpect(lake.name).toBe("Lake");
  plainExpect(lake.points).toHaveLength(4);
  plainExpect(new Set(lake.points.map(q => `${q.lat},${q.lon}`))).toEqual(new Set(["0,0", "0,1", "1,1", "1,0"]));
  // The query asks for multipolygons too
  plainExpect(overpassQuery({ south: 1, west: 2, north: 3, east: 4 } as any)).toContain('relation["type"="multipolygon"]["natural"');
});

plain("cutting lines and shapes to the site (pure logic)", () => {
  const r = { x0: 0, y0: 0, x1: 100, y1: 50 };
  const round = (pieces: { x: number; y: number }[][]) => pieces.map(piece => piece.map(q => ({ x: Math.round(q.x * 1e6) / 1e6, y: Math.round(q.y * 1e6) / 1e6 })));
  // A road straight across: one piece from edge to edge
  plainExpect(round(clipPathToRect([{ x: -500, y: 25 }, { x: 600, y: 25 }], r))).toEqual([[{ x: 0, y: 25 }, { x: 100, y: 25 }]]);
  // A path that leaves and comes back: two pieces
  const pieces = clipPathToRect([{ x: 10, y: 10 }, { x: 10, y: 80 }, { x: 90, y: 80 }, { x: 90, y: 10 }], r);
  plainExpect(round(pieces)).toEqual([[{ x: 10, y: 10 }, { x: 10, y: 50 }], [{ x: 90, y: 50 }, { x: 90, y: 10 }]]);
  // Wholly outside: nothing
  plainExpect(clipPathToRect([{ x: -10, y: -10 }, { x: -5, y: 200 }], r)).toEqual([]);
  // A lake bigger than the site: the site
  const big = clipPolygonToRect([{ x: -100, y: -100 }, { x: 300, y: -100 }, { x: 300, y: 300 }, { x: -100, y: 300 }], r);
  plainExpect(big.map(q => `${Math.round(q.x)},${Math.round(q.y)}`).sort()).toEqual(["0,0", "0,50", "100,0", "100,50"]);
  // A pond wholly inside stays as it is; one wholly outside goes
  const pond = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }];
  plainExpect(clipPolygonToRect(pond, r)).toEqual(pond);
  plainExpect(clipPolygonToRect(pond.map(q => ({ x: q.x + 500, y: q.y })), r)).toEqual([]);
});

test("making the site bigger keeps the design on the same ground", async ({ page }) => {
  test.setTimeout(180_000);
  await importSite(page, { trees: false, osm: false });
  const first = await course(page);
  const W = first.canvas.width, H = first.canvas.height;
  await addHole(page, { x: W * 0.3, y: H * 0.5 }, { x: W * 0.6, y: H * 0.5 });
  await page.keyboard.press("Escape");
  await page.evaluate(([w, h]) => {
    const a = (window as any).__dgActions, s = (window as any).__dgEditor();
    s.set({ areaKind: "ob" });
    a.addDrawn("area", [{ x: w * 0.2, y: h * 0.2 }, { x: w * 0.3, y: h * 0.2 }, { x: w * 0.3, y: h * 0.3 }]);
    s.set({ tool: "select" });
  }, [W, H]);
  // Where each thing drawn is on the ground (feet north and east of a fixed point)
  const ground = () => page.evaluate(() => {
    const d = (window as any).__dgCourse();
    const b = d.site.bounds, w = d.canvas.width, h = d.canvas.height;
    // (from a fixed spot, at a fixed scale: the same for both frames)
    const ftLon = 364000 * Math.cos((39.78 * Math.PI) / 180);
    const geo = (p: { x: number; y: number }) => ({ n: (b.north - (p.y / h) * (b.north - b.south) - 39.78) * 364000, e: (b.west + (p.x / w) * (b.east - b.west) + 89.68) * ftLon });
    return d.items.filter((i: any) => !i.importSource).map((i: any) => [geo(i), ...(i.points ?? []).map(geo)]);
  });
  const was = await ground();
  expect(was.length).toBe(3);
  // The site's frame opens as it is; its north-west corner dragged out
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  await page.getByTestId("resize-site").click();
  await expect(page.getByRole("dialog", { name: "Change the area" })).toBeVisible();
  // (the frame as it is, straight away: no search)
  await expect(page.getByTestId("site-size")).toContainText(/1,50\d × 99\d ft/);
  const corners = await page.locator(".site-handle-corner").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const nw = corners.reduce((a, b) => (b.x + b.y < a.x + a.y ? b : a));
  await page.mouse.move(nw.x, nw.y);
  await page.mouse.down();
  await page.mouse.move(nw.x - 90, nw.y - 60, { steps: 10 });
  await page.mouse.up();
  if (await page.getByTestId("bring-photo-trees").isVisible()) await page.getByTestId("bring-photo-trees").click();
  await page.getByTestId("bring-osm").click();
  await page.getByTestId("import-site").click();
  await page.getByTestId("review-bring").click({ timeout: 90_000 });
  await expect.poll(async () => (await course(page)).canvas.width, { timeout: 90_000 }).toBeGreaterThan(W + 100);
  expect((await course(page)).canvas.height).toBeGreaterThan(H + 50);
  // Everything within a foot of where it was
  const now = await ground();
  expect(now.length).toBe(3);
  now.forEach((pts: any[], i: number) => pts.forEach((p, k) => {
    expect(Math.hypot(p.n - was[i][k].n, p.e - was[i][k].e), `thing ${i}, point ${k}`).toBeLessThan(1);
  }));
  expect((await course(page)).holes).toHaveLength(1);
});

plain("a smaller frame keeps everything on its ground and counts what is left outside (pure logic)", () => {
  const from = { north: 40.01, south: 40, west: -90.01, east: -90, width: 2794, height: 3640 };
  // The east half only
  const to = { ...from, west: -90.005, width: 1397 };
  const hole = { id: "h", doglegs: [{ x: 2000, y: 100 }], fairwayWidth: 30, fairway: true };
  const items = [
    { id: "a", type: "label", x: 2500, y: 1000, rotation: 0 },
    { id: "b", type: "label", x: 200, y: 1000, rotation: 0 },
    { id: "c", type: "area", kind: "ob", x: 1500, y: 500, rotation: 0, points: [{ x: 1400, y: 500 }, { x: 1600, y: 500 }, { x: 1500, y: 700 }] }
  ] as any[];
  const out = reframeDesign({ holes: [hole as any], items }, from, to);
  plainExpect(out.items[0].x).toBeCloseTo(2500 - 1397, 6);
  plainExpect(out.items[0].y).toBeCloseTo(1000, 6);
  plainExpect(out.holes[0].doglegs[0].x).toBeCloseTo(2000 - 1397, 6);
  plainExpect((out.items[2] as any).points[0].x).toBeCloseTo(3, 6);
  // The label west of the new frame
  plainExpect(out.outside).toBe(1);
});

plain("OpenStreetMap's woods, meadows, grassland, scrub and lawns come in as areas (pure logic)", () => {
  const p = (lat: number, lon: number) => ({ lat, lon });
  const ring = (o: number) => [p(o, o), p(o, o + 1), p(o + 1, o + 1), p(o + 1, o), p(o, o)];
  const found = osmFeaturesFrom({
    elements: [
      { type: "way", tags: { landuse: "forest", name: "Oak Woods" }, geometry: ring(0) },
      { type: "way", tags: { landuse: "meadow" }, geometry: ring(2) },
      { type: "way", tags: { natural: "grassland" }, geometry: ring(4) },
      { type: "way", tags: { natural: "scrub" }, geometry: ring(6) },
      { type: "way", tags: { landuse: "grass" }, geometry: ring(8) },
      { type: "relation", tags: { type: "multipolygon", natural: "wood" }, members: [{ type: "way", role: "outer", geometry: ring(10) }] },
      // (the park itself is not one big area)
      { type: "way", tags: { leisure: "park" }, geometry: ring(12) }
    ]
  });
  plainExpect(found.map(f => `${f.geom}:${f.kind}`)).toEqual(["area:woods", "area:rough", "area:rough", "area:rough", "area:rough", "area:woods"]);
  plainExpect(found[0].name).toBe("Oak Woods");
  const q = overpassQuery({ south: 1, west: 2, north: 3, east: 4 } as any);
  plainExpect(q).toContain("meadow");
  plainExpect(q).toContain("grassland");
});

plain("tree stands and ponds traced into outlines; lone crowns, pools and courts left out (pure logic)", () => {
  const w = 200, h = 160;
  // A canopy mask: a stand of overlapping crowns, and a lone crown far off
  const mask = new Uint8Array(w * h);
  const disc = (m: Uint8Array, cx: number, cy: number, r: number) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
  };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) disc(mask, 30 + i * 14, 30 + j * 14, 8);
  disc(mask, 170, 130, 8);
  const canopy = { mask, mpp: 0.3, w, h } as unknown as Canopy;
  const stands = woodsRegions(canopy, 150);
  plainExpect(stands).toHaveLength(1);
  const o = stands[0].outline;
  const xs = o.map(q => q.x), ys = o.map(q => q.y);
  // Around the whole stand (and a little past the crowns' edges), not the lone crown
  plainExpect(Math.min(...xs)).toBeLessThan(23);
  plainExpect(Math.max(...xs)).toBeGreaterThan(80);
  plainExpect(Math.max(...ys)).toBeGreaterThan(65);
  plainExpect(Math.max(...xs)).toBeLessThan(110);
  plainExpect(Math.abs(polyArea(o))).toBeGreaterThan(stands[0].areaPx * 0.85);
  // The outline of a square: its corners, round once
  const sq: number[] = [];
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) sq.push(y * w + x);
  const edge = traceOutline(w, h, sq);
  plainExpect(edge).toHaveLength(36);
  plainExpect(boxFill(edge, sq.length)).toBeGreaterThan(0.95);
  // A photo with a round blue pond, a blue rectangle (a pool or a court) and a small blue spot
  const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const pond = (x - 60) ** 2 + ((y - 80) * 1.3) ** 2 < 40 ** 2;
    const pool = x > 130 && x < 185 && y > 20 && y < 70;
    const spot = (x - 160) ** 2 + (y - 130) ** 2 < 5 ** 2;
    const [r, g, b] = pond || pool || spot ? [40, 80, 125] : [92, 132, 64];
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  const water = waterRegions(img, { metersPerPx: 0.3 });
  plainExpect(water).toHaveLength(1);
  const wx = water[0].outline.map(q => q.x);
  plainExpect(Math.min(...wx)).toBeLessThan(28);
  plainExpect(Math.max(...wx)).toBeLessThan(110);
});

plain("no stray paths from OpenStreetMap: road crossings, sidewalks, squares, indoor and underground ways, parking aisles left out (pure logic)", () => {
  const p = (lat: number, lon: number) => ({ lat, lon });
  const way = (tags: Record<string, string>, closed = false) => ({ type: "way", tags, geometry: closed ? [p(0, 0), p(0, 1), p(1, 1), p(0, 0)] : [p(0, 0), p(0, 1)] });
  const found = osmFeaturesFrom({
    elements: [
      way({ highway: "footway" }),
      way({ highway: "path", name: "Ridge Trail" }),
      way({ highway: "service" }),
      way({ highway: "footway", footway: "crossing" }),
      way({ highway: "footway", footway: "sidewalk" }),
      way({ highway: "cycleway", cycleway: "crossing" }),
      way({ highway: "pedestrian", area: "yes" }, true),
      way({ highway: "footway", indoor: "yes" }),
      way({ highway: "footway", tunnel: "building_passage" }),
      way({ highway: "service", service: "parking_aisle" }),
      way({ highway: "service", service: "drive-through" }),
      // (a stream through a culvert stays)
      way({ waterway: "stream", tunnel: "culvert" })
    ]
  });
  plainExpect(found.map(f => `${f.kind}${f.name ? `:${f.name}` : ""}`)).toEqual(["path", "path:Ridge Trail", "road", "stream"]);
});

plain("map tiles: a path over two tiles comes in once, joined at the tiles' edge (each tile repeats a strip of the next) (pure logic)", () => {
  const E = 4096;
  const tile = (pts: [number, number][]) => [{ name: "transportation", extent: E, features: [{ type: 2 as const, tags: { class: "path" }, rings: [pts.map(([x, y]) => ({ x, y }))] }] }];
  // The path runs east from the middle of tile 100 to the middle of tile 101; each tile has it 80 units past its edge
  const a = tileFeatures(tile([[2048, 1000], [E + 80, 1000]]), 100, 200);
  const b = tileFeatures(tile([[-80, 1000], [2048, 1000]]), 101, 200);
  const n = 2 ** 14, edgeLon = (101 / n) * 360 - 180;
  plainExpect(a[0].points[a[0].points.length - 1].lon).toBeCloseTo(edgeLon, 9);
  plainExpect(b[0].points[0].lon).toBeCloseTo(edgeLon, 9);
  const joined = joinLines([...a, ...b]);
  plainExpect(joined).toHaveLength(1);
  const lons = joined[0].points.map(q => q.lon);
  plainExpect(lons).toHaveLength(3);
  plainExpect(lons[0]).toBeLessThan(lons[1]);
  plainExpect(lons[1]).toBeLessThan(lons[2]);
  // Thousands of pieces in any order join at once (a busy tile; checking every pair after every join froze the page)
  // (800 paths, each in four pieces)
  const pieces = Array.from({ length: 3200 }, (_, k) => {
    const lat = 40 + Math.floor(k / 4) * 1e-3, lon = (k % 4) * 1e-3;
    return { geom: "line" as const, kind: "path" as const, points: [{ lat, lon }, { lat: lat + 3e-4, lon: lon + 5e-4 }, { lat, lon: lon + 1e-3 }] };
  });
  for (let k = pieces.length - 1; k > 0; k--) { const r = (k * 7919) % (k + 1); [pieces[k], pieces[r]] = [pieces[r], pieces[k]]; }
  const t0 = performance.now();
  const paths = joinLines(pieces);
  plainExpect(performance.now() - t0).toBeLessThan(2000);
  plainExpect(paths).toHaveLength(800);
  for (const p of paths) plainExpect(p.points).toHaveLength(4 * 2 + 1);
  // Indoors and parking aisles are left out
  const skip = (tags: Record<string, string | number>) => tileFeatures([{ name: "transportation", extent: E, features: [{ type: 2, tags, rings: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]] }] }], 100, 200);
  plainExpect(skip({ class: "path", indoor: 1 })).toEqual([]);
  plainExpect(skip({ class: "service", service: "parking_aisle" })).toEqual([]);
  plainExpect(skip({ class: "path", brunnel: "tunnel" })).toEqual([]);
});

plain("OpenStreetMap from map tiles when Overpass is busy: a vector tile's paths, roads, streams, water, woods and buildings (pure logic)", () => {
  // A tiny Mapbox Vector Tile, written by hand
  const varint = (n: number) => { const out: number[] = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return out; };
  const field = (num: number, type: number, body: number[]) => [...varint(num * 8 + type), ...(type === 2 ? varint(body.length) : []), ...body];
  const str = (s: string) => [...new TextEncoder().encode(s)];
  const zz = (n: number) => (n < 0 ? -n * 2 - 1 : n * 2);
  const geom = (cmds: [number, [number, number][]][]) => {
    const out: number[] = [];
    let x = 0, y = 0;
    for (const [cmd, pts] of cmds) {
      out.push((pts.length << 3) | cmd);
      for (const [px, py] of pts) { out.push(zz(px - x), zz(py - y)); x = px; y = py; }
    }
    return out;
  };
  const packed = (nums: number[]) => nums.flatMap(varint);
  const layer = (name: string, keys: string[], values: string[], feats: { tags: number[]; type: number; geom: number[] }[]) => field(3, 2, [
    ...field(1, 2, str(name)),
    ...feats.flatMap(f => field(2, 2, [...field(2, 2, packed(f.tags)), ...field(3, 0, varint(f.type)), ...field(4, 2, packed(f.geom))])),
    ...keys.flatMap(k => field(3, 2, str(k))),
    ...values.flatMap(v => field(4, 2, field(1, 2, str(v)))),
    ...field(5, 0, varint(4096))
  ]);
  // A closed square, clockwise on the screen (an outer ring)
  const square = [...geom([[1, [[100, 100]]], [2, [[300, 100], [300, 300], [100, 300]]]]), 15];
  const tile = new Uint8Array([
    ...layer("transportation", ["class"], ["path", "minor", "rail"], [
      { tags: [0, 0], type: 2, geom: geom([[1, [[0, 2048]]], [2, [[4096, 2048]]]]) },
      { tags: [0, 1], type: 2, geom: geom([[1, [[2048, 0]]], [2, [[2048, 4096]]]]) },
      { tags: [0, 2], type: 2, geom: geom([[1, [[0, 0]]], [2, [[10, 10]]]]) }
    ]),
    ...layer("waterway", ["class"], ["stream"], [{ tags: [0, 0], type: 2, geom: geom([[1, [[0, 0]]], [2, [[4096, 4096]]]]) }]),
    ...layer("water", ["class"], ["lake"], [{ tags: [0, 0], type: 3, geom: square }]),
    ...layer("landcover", ["class", "subclass"], ["wood", "forest", "grass", "meadow"], [{ tags: [0, 0, 1, 1], type: 3, geom: square }, { tags: [0, 2, 1, 3], type: 3, geom: square }]),
    ...layer("building", [], [], [{ tags: [], type: 3, geom: square }])
  ]);
  const layers = decodeMvt(tile);
  plainExpect(layers.map(l => l.name)).toEqual(["transportation", "waterway", "water", "landcover", "building"]);
  plainExpect(layers[0].features[0].rings[0]).toEqual([{ x: 0, y: 2048 }, { x: 4096, y: 2048 }]);
  plainExpect(layers[2].features[0].rings[0]).toHaveLength(5);
  const feats = tileFeatures(layers, 4823, 6160);
  plainExpect(feats.map(f => `${f.geom}:${f.kind}`)).toEqual(["line:path", "line:road", "line:stream", "area:water", "area:woods", "area:rough", "area:building"]);
  // In latitude and longitude, inside the tile
  const n = 2 ** 14;
  const path = feats[0].points;
  plainExpect(path[0].lon).toBeCloseTo((4823 / n) * 360 - 180, 6);
  plainExpect(path[1].lon).toBeCloseTo((4824 / n) * 360 - 180, 6);
  plainExpect(feats[3].points).toHaveLength(4);
});

/** The test site as a plan 1,000 ft each way (for OpenStreetMap's things on it). */
const planRef = { ...getGeoBounds({ lat: SITE.lat, lon: SITE.lon, label: "" }, 1000, 1000), width: 1000, height: 1000 };
const node = (tags: Record<string, string>, e = 0, n = 0) => ({ type: "node", tags, ...geoAt(e, n) });
const wayAt = (tags: Record<string, string>, pts: [number, number][]) => ({ type: "way", tags, geometry: pts.map(([e, n]) => geoAt(e, n)) });
const square = (e: number, n: number, r: number): [number, number][] => [[e - r, n - r], [e + r, n - r], [e + r, n + r], [e - r, n + r], [e - r, n - r]];

plain("OpenStreetMap's benches, picnic tables, toilets, drinking water, trash cans, parking, shelters, single trees, tree rows, hedges, wetlands, path surfaces and widths, and buildings' heights (pure logic)", () => {
  const features = osmFeaturesFrom({
    elements: [
      node({ amenity: "bench" }, -90), node({ leisure: "picnic_table" }, -80), node({ amenity: "toilets" }, -70), node({ amenity: "drinking_water" }, -60), node({ amenity: "waste_basket" }, -50), node({ amenity: "parking" }, -40),
      node({ amenity: "bbq" }, -30), node({ barrier: "gate" }, -20), node({ leisure: "fitness_station" }, -10),
      // (nothing of the app's for a bike repair stand: left out)
      node({ amenity: "bicycle_repair_station" }, -5),
      node({ amenity: "shelter", name: "Pavilion" }, 0, 60),
      node({ natural: "tree", height: "20", diameter_crown: "10", leaf_type: "needleleaved" }, 40, 60),
      wayAt({ natural: "tree_row" }, [[-100, -60], [0, -60]]),
      wayAt({ barrier: "hedge", height: "1.5" }, [[20, -60], [40, -60]]),
      wayAt({ power: "line", voltage: "138000" }, [[-100, 80], [100, 80]]),
      wayAt({ natural: "wetland", wetland: "marsh" }, square(-60, 30, 15)),
      wayAt({ natural: "wetland", wetland: "swamp" }, square(-20, 30, 15)),
      wayAt({ highway: "footway", surface: "gravel", width: "2" }, [[-100, -100], [100, -100]]),
      // A picnic shelter mapped as a roof: 5 m to its flat top
      wayAt({ amenity: "shelter", building: "roof", height: "5", "roof:shape": "flat" }, square(60, 0, 6)),
      // A house 10 m to its ridge (gabled), and a flat-topped hall 12 m tall with two floors (its height wins)
      wayAt({ building: "house", height: "10", "roof:shape": "gabled" }, square(80, 40, 6)),
      wayAt({ building: "yes", height: "12", "building:levels": "2", "roof:shape": "flat" }, square(80, -30, 8))
    ]
  });
  const { items, counts } = osmFeatureItems(features, planRef);
  const amenities = items.filter((i: any) => i.type === "amenity");
  plainExpect(amenities.map((a: any) => a.kind)).toEqual(["bench", "picnic", "restroom", "water", "trash", "parking", "grill", "gate", "fitness"]);
  plainExpect(amenities.every((a: any) => a.importSource === "osm")).toBe(true);
  const shelters = items.filter((i: any) => i.type === "structure" && i.kind === "shelter");
  plainExpect(shelters).toHaveLength(2);
  plainExpect(shelters[0].label).toBe("Pavilion");
  plainExpect(Math.abs(polyArea(shelters[0].points))).toBeCloseTo(400, 0);
  // (5 m to a flat top: 16.5 ft of posts)
  plainExpect(shelters[1].height).toBe(16.5);
  const trees = items.filter((i: any) => i.type === "tree");
  const lone = trees.find((t: any) => t.treeType === "conifer");
  plainExpect(lone).toMatchObject({ radius: 16.5, height: 66, importSource: "osm" });
  // A row of trees 100 m long, about every 22 ft; a hedge and a power line as lines of their own
  plainExpect(trees.filter((t: any) => t.treeType === "deciduous").length).toBeGreaterThanOrEqual(14);
  plainExpect(trees.filter((t: any) => t.treeType === "bush")).toHaveLength(0);
  plainExpect(items.find((i: any) => i.type === "line" && i.kind === "hedge")).toMatchObject({ fenceHeight: 5 });
  plainExpect(items.find((i: any) => i.type === "line" && i.kind === "power")).toMatchObject({ fenceHeight: 80, importSource: "osm" });
  const areas = items.filter((i: any) => i.type === "area").map((a: any) => a.kind);
  plainExpect(areas).toEqual(["rough", "woods"]);
  const path = items.find((i: any) => i.type === "line" && i.kind === "path");
  plainExpect(path).toMatchObject({ surface: "gravel", width: 6.5 });
  const [house, hall] = items.filter((i: any) => i.type === "structure" && i.kind === "building");
  // The house's walls are its height less its roof; the hall's height is all walls (flat), its floors not used
  plainExpect(house.height).toBeLessThan(32);
  plainExpect(house.height).toBeGreaterThan(17);
  plainExpect(hall.height).toBe(39.5);
  plainExpect(counts).toMatchObject({ bench: 1, picnic: 1, restroom: 1, drinking: 1, trash: 1, sign: 1, grill: 1, gate: 1, fitness: 1, shelter: 2, hedge: 1, power: 1, building: 2 });
  // Asked for, in the same query
  const q = overpassQuery({ south: 1, west: 2, north: 3, east: 4 } as any);
  for (const s of ['node["amenity"', 'node["natural"="tree"]', "tree_row", "wetland", "hedge", 'node["disc_golf"]', 'way["power"', 'node["power"="pole"]', "street_lamp", "bbq", "fitness_station"]) plainExpect(q).toContain(s);
  // Building heights: from the floors only where no height is mapped
  plainExpect(wallsFt({ heightM: 6 }, "building", [])).toBe(19.5);
  plainExpect(wallsFt({ topM: 6, heightM: 3 }, "building", [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }], "flat")).toBe(19.5);
});

plain("a park's ball fields, courts, playgrounds and the rest keep what they are (sport, surface, name), drawn as today's kinds, and are counted; the map tiles keep pitches too (pure logic)", () => {
  const features = osmFeaturesFrom({
    elements: [
      wayAt({ leisure: "pitch", sport: "baseball", surface: "grass", name: "Field 1" }, square(-60, 0, 30)),
      // (its dirt infield mapped by itself)
      wayAt({ leisure: "pitch", sport: "baseball", surface: "dirt" }, square(-60, 0, 10)),
      wayAt({ leisure: "pitch", sport: "tennis", surface: "asphalt" }, square(40, 40, 15)),
      wayAt({ leisure: "dog_park" }, square(40, -40, 15)),
      wayAt({ amenity: "fountain" }, square(0, 60, 4)),
      wayAt({ barrier: "backstop" }, [[-80, 20], [-70, 25]]),
      node({ leisure: "playground", name: "Tot Lot" }, 10, -10),
      node({ man_made: "flagpole" }, 20, -10)
    ]
  });
  const field = features.find(f => f.name === "Field 1") as any;
  plainExpect(field).toMatchObject({ geom: "area", kind: "field", park: { what: "pitch", sport: "baseball", surface: "grass" }, tags: { leisure: "pitch", sport: "baseball" } });
  const { items, parks } = osmFeatureItems(features, planRef);
  const areas = items.filter((i: any) => i.type === "area");
  // The app's own fields (a ball field with its home plate on a corner, a court, a dog park out of play), the dirt infield as dirt, the fountain as water
  plainExpect(areas.map((a: any) => `${a.kind}:${a.field ?? ""}:${a.park?.what}`)).toEqual(["field:baseball:pitch", "sand::infield", "field:tennis:court", "field:dog:dog_park", "water::fountain"]);
  plainExpect(areas[0].label).toBe("Field 1");
  plainExpect(areas[0].home).toBeGreaterThanOrEqual(0);
  plainExpect(areas[3].outOfPlay).toBe(true);
  plainExpect(items.find((i: any) => i.type === "line")).toMatchObject({ kind: "fence", park: { what: "backstop" } });
  // (the flagpole is one of the app's amenities now; the playground mapped on a spot is counted)
  plainExpect(items.find((i: any) => i.type === "amenity")).toMatchObject({ kind: "flagpole" });
  plainExpect(parkSummary(parks)).toMatch(/^(?=.*1 ball field\b)(?=.*1 infield)(?=.*\d+ tennis courts?)(?=.*1 dog park)(?=.*1 fountain)(?=.*1 backstop)(?=.*1 playground)/);
  plainExpect(overpassQuery({ south: 1, west: 2, north: 3, east: 4 } as any)).toContain("dog_park");
  // The map tiles: a pitch and a playground in the landuse layer, the playground's point repeated as a point of interest
  const sq = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }, { x: 100, y: 100 }];
  const tiles = withoutTwins(tileFeatures([
    { name: "landuse", extent: 4096, features: [{ type: 3, tags: { class: "pitch" }, rings: [sq] }, { type: 3, tags: { class: "playground" }, rings: [sq.map(p => ({ x: p.x + 1000, y: p.y }))] }] },
    { name: "poi", extent: 4096, features: [{ type: 1, tags: { class: "playground", subclass: "playground" }, rings: [[{ x: 1200, y: 200 }]] }, { type: 1, tags: { class: "pitch", subclass: "pitch" }, rings: [[{ x: 3000, y: 3000 }]] }] }
  ], 4823, 6160));
  plainExpect(tiles.map(f => `${f.geom}:${f.kind}:${(f as any).park?.what}`)).toEqual(["area:field:pitch", "area:field:playground", "point:park:pitch"]);
});

plain("a disc golf course mapped on OpenStreetMap: its holes from hole ways, or tees and baskets with the same number; golf holes only inside a disc golf course (pure logic)", () => {
  const features = osmFeaturesFrom({
    elements: [
      wayAt({ leisure: "disc_golf_course", name: "Springfield DGC" }, square(0, 0, 120)),
      wayAt({ disc_golf: "hole", ref: "1", par: "3" }, [[-80, -80], [-60, -40], [-40, 0]]),
      node({ disc_golf: "tee", ref: "1" }, -80.5, -80.3),
      node({ disc_golf: "basket", ref: "1" }, -40, 0.6),
      node({ disc_golf: "tee", ref: "2" }, 0, 0),
      node({ disc_golf: "basket", ref: "2" }, 60, 30),
      // A ball golf course's hole next door: not one of these
      wayAt({ golf: "hole", ref: "3" }, [[200, 200], [260, 260]])
    ]
  });
  const mc = mappedCourse(features)!;
  plainExpect(mc.name).toBe("Springfield DGC");
  plainExpect(mc.holes.map(h => h.number)).toEqual([1, 2]);
  plainExpect(mc.holes[0].par).toBe(3);
  plainExpect(mc.holes[0].doglegs).toHaveLength(1);
  // (the tee where it's mapped, a little off the way's end)
  plainExpect(mc.holes[0].tee.lon).toBeCloseTo(geoAt(-80.5, -80.3).lon, 9);
  const ref = { ...getGeoBounds({ lat: SITE.lat, lon: SITE.lon, label: "" }, 1000, 1000), width: 1000, height: 1000 };
  const c = courseFromMap(mc, ref);
  plainExpect(c.holes.map((h: any) => [h.number, h.par ?? null])).toEqual([[1, 3], [2, null]]);
  plainExpect(c.items.map((i: any) => i.type)).toEqual(["tee", "basket", "tee", "basket"]);
  plainExpect(c.items.every((i: any) => c.holes.some((h: any) => h.id === i.holeId))).toBe(true);
  // Nothing mapped for disc golf: none
  plainExpect(mappedCourse(osmFeaturesFrom({ elements: [wayAt({ golf: "hole", ref: "1" }, [[0, 0], [50, 50]])] }))).toBeNull();
});

plain("OpenStreetMap credited on the map for anything from it: holes of a course mapped there, benches, trees (pure logic)", () => {
  const doc = (site: object, items: object[]) => ({ site, items, style: { theme: "forest" } }) as any;
  plainExpect(requiredCredit(doc({}, []))).toBe("");
  plainExpect(requiredCredit(doc({ holesFromOsm: true }, []))).toContain("© OpenStreetMap contributors");
  plainExpect(requiredCredit(doc({}, [{ type: "amenity", kind: "bench", importSource: "osm" }]))).toContain("© OpenStreetMap contributors");
  plainExpect(requiredCredit(doc({}, [{ type: "tree", importSource: "lidar" }]))).toBe("");
});

plain("the park or course at a spot: its outline, and the course mapped in it with how many holes (pure logic)", () => {
  const ring = (e: number, n: number, r: number) => square(e, n, r).map(([x, y]) => geoAt(x, y));
  const json = {
    elements: [
      { type: "way", tags: { leisure: "park", name: "Springfield Park" }, geometry: ring(0, 0, 300) },
      { type: "way", tags: { leisure: "disc_golf_course", name: "Springfield DGC" }, geometry: ring(50, 0, 120) },
      ...[0, 1, 2].map(k => ({ type: "way", tags: { disc_golf: "hole", ref: String(k + 1) }, center: geoAt(20 + k * 20, 10) }))
    ]
  };
  const o = outlineFrom(json, geoAt(0, 0))!;
  plainExpect(o.kind).toBe("park");
  plainExpect(o.name).toBe("Springfield Park");
  plainExpect(o.course).toEqual({ name: "Springfield DGC", holes: 3 });
  plainExpect(o.bounds.north).toBeCloseTo(geoAt(0, 300).lat, 9);
  // Just outside a course that isn't in a park: the course
  const alone = outlineFrom({ elements: [json.elements[1], ...json.elements.slice(2)] }, geoAt(200, 0))!;
  plainExpect(alone.kind).toBe("course");
  plainExpect(outlineFrom({ elements: [] }, geoAt(0, 0))).toBeNull();
});

plain("suggestions: disc golf courses, then parks, then the rest; the same place from both services once; addresses as they came (pure logic)", () => {
  const esri = [{ text: "Springfield", detail: "IL, USA", magicKey: "a" }, { text: "Springfield Park", detail: "Springfield, IL", magicKey: "b" }, { text: "Springfield Disc Golf Course", detail: "Springfield, IL", magicKey: "c" }].map(s => ({ ...s, kind: kindFromName(`${s.text}, ${s.detail}`) }));
  const photon = [{ text: "Springfield Park", detail: "Springfield", lat: SITE.lat, lon: SITE.lon, kind: "park" as const, osmId: "W1" }];
  const out = rankSuggestions(esri, photon, "springfield", { lat: SITE.lat, lon: SITE.lon });
  plainExpect(out.map(s => s.text)).toEqual(["Springfield Disc Golf Course", "Springfield Park", "Springfield"]);
  plainExpect(out[1]).toMatchObject({ osmId: "W1", magicKey: "b" });
  const addr = rankSuggestions(esri, [], "12 Springfield", undefined);
  plainExpect(addr.map(s => s.text)).toEqual(["Springfield", "Springfield Park", "Springfield Disc Golf Course"]);
});

test("every source at once, each saying how it went; Stop lets go of all of it and the next import isn't held up", async ({ page }) => {
  test.setTimeout(120_000);
  await noSurvey(page);
  let hold = true;
  // OpenStreetMap holds the first import up (it never answers); the second gets its answer
  await page.route(/overpass|maps\.mail\.ru/, route => { if (!hold) void route.fulfill({ contentType: "application/json", body: JSON.stringify({ elements: [footway] }) }); });
  await page.getByTestId("welcome-find").click();
  await page.getByLabel("Search address").fill("Springfield Park");
  await page.getByRole("button", { name: /Springfield Park/ }).first().click();
  await expect(page.getByTestId("site-size")).toBeVisible();
  await page.getByTestId("import-site").click();
  // The photo and the ground are in while OpenStreetMap is still coming (all asked at once)
  const sources = () => page.evaluate(() => (window as any).__dgImportProgress?.sources ?? {});
  await expect.poll(async () => { const s = await sources(); return [s.photo?.state, s.elevation?.state, s.photoTrees?.state, s.osm?.state]; }, { timeout: 60_000 }).toEqual(["done", "done", "done", "coming"]);
  const s = await sources();
  plainExpect(s.photo.source).toMatch(/Esri/);
  plainExpect(s.elevation.source).toMatch(/terrain tiles/);
  plainExpect(s.photoTrees.state).toBe("done");
  plainExpect(s.photoTrees.count).toBeGreaterThan(0);
  await expect(page.getByTestId("import-status")).toContainText("OpenStreetMap");
  // Stop (asked first): the dialog goes, nothing is kept
  await page.keyboard.press("Escape");
  await page.getByTestId("import-stop-yes").click();
  await expect(page.getByRole("dialog", { name: "Find your park" })).toHaveCount(0);
  expect((await course(page)).site.bounds).toBeNull();
  // At once again: not held up by the one before, and what came then is used again
  hold = false;
  const summary = await importSite(page);
  expect(summary).toMatch(/From OpenStreetMap: 1 path\./);
  const end = await sources();
  plainExpect(end.osm).toMatchObject({ state: "done", source: "Overpass", count: 1 });
  plainExpect(end.photo.cached).toBe(true);
  plainExpect(await page.evaluate(() => (window as any).__dgImportProgress.fraction)).toBe(1);
});

test("no photo or no elevation: the rest still comes in (the street map under it, or flat ground), and each says so", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/arcgisonline\.com\/.*\/tile\//, route => route.abort());
  await page.route(/elevation-tiles-prod/, route => route.abort());
  const summary = await importSite(page, { trees: false });
  expect(summary).toMatch(/Couldn't download the satellite photo, so the street map is under the course\./);
  expect(summary).toMatch(/Couldn't download the elevation, so the ground is flat\./);
  expect(summary).toMatch(/From OpenStreetMap: 1 path, 1 road, 1 water area, 1 parking lot\./);
  const doc = await course(page);
  expect(doc.background).toMatch(/^data:image\/jpeg/);
  expect(doc.site.imagerySource).toBe("OpenStreetMap");
  expect(doc.terrainHeights).toBe(0);
  const s = await page.evaluate(() => (window as any).__dgImportProgress.sources);
  plainExpect(s.elevation.state).toBe("failed");
  plainExpect(s.photo).toMatchObject({ state: "done", source: "OpenStreetMap" });
});

test("the same spot brought in again asks for nothing it has already (photo, elevation, OpenStreetMap)", async ({ page }) => {
  test.setTimeout(180_000);
  // (the photo's tiles are the picker map's too: counted by the import's own word instead)
  const asked = { osm: 0, ground: 0 };
  page.on("request", r => {
    const u = r.url();
    // (the park's outline, looked up when it's picked, isn't the import's: left out)
    if (/overpass|maps\.mail\.ru/.test(u) && !/is_in/.test(decodeURIComponent(u + (r.postData() ?? "")))) asked.osm++;
    if (/elevation-tiles-prod/.test(u)) asked.ground++;
  });
  await importSite(page, { trees: false });
  const first = { ...asked };
  expect(first.osm).toBe(3);
  expect(first.ground).toBeGreaterThan(0);
  await importSite(page, { trees: false });
  expect(asked).toEqual(first);
  const s = await page.evaluate(() => (window as any).__dgImportProgress.sources);
  plainExpect([s.photo.cached, s.elevation.cached, s.osm.cached]).toEqual([true, true, true]);
});

test("looking first: a source switched off doesn't come in; the rest does", async ({ page }) => {
  const ll = (e: number, n: number) => { const g = geoAt(e, n); return [g.lon, g.lat]; };
  const box = (e: number, n: number, w: number, h: number) => [ll(e, n), ll(e + w, n), ll(e + w, n + h), ll(e, n + h), ll(e, n)];
  await page.route(/USA_Structures_View/, route => route.fulfill({ json: { features: [{ attributes: { OCC_CLS: "Residential" }, geometry: { rings: [box(90, -40, 12, 9)] } }, { attributes: { OCC_CLS: "Residential" }, geometry: { rings: [box(140, 60, 14, 10)] } }] } }));
  await importSite(page, { review: async p => {
    await expect(p.getByTestId("review-femaBuildings")).toHaveAttribute("aria-checked", "true");
    await p.getByTestId("review-femaBuildings").click();
    await expect(p.getByTestId("review-femaBuildings")).toHaveAttribute("aria-checked", "false");
  } });
  const items = (await course(page)).items;
  expect(items.filter((i: any) => i.importSource === "fema")).toHaveLength(0);
  expect(items.some((i: any) => i.importSource === "osm")).toBe(true);
});
