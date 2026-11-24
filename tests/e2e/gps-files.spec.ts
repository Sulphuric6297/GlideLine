import { readFileSync } from "fs";
import { test as plain, expect as plainExpect, type Page } from "@playwright/test";
import { test, expect, addHole, blankCourse, course, geoAt, SITE } from "./fixtures";
import { fileCourse, readCsv, readGeoJson, readName, readSurface, settle, teeNameLayouts, withFileLayouts } from "../../src/lib/courseFile";
import JSZip from "jszip";
import { bendOwner, createBasket, createEmptyCourse, createTee, defaultLayouts, newHole, teeLines } from "../../src/lib/course";
import { holeStats } from "../../src/lib/holeStats";
import { holeHints, mappedCourse, osmFeaturesFrom } from "../../src/lib/geo/osm";
import { pinPositions, teeLevels } from "../../src/lib/importSite";
import { EXAMPLE_CSV, EXAMPLE_GEOJSON, EXAMPLE_GPX, EXAMPLE_KML } from "../../src/lib/courseFileExamples";

// Holes from a GPS file (lib/courseFile, components/CourseFileDialog): GPX, KML, GeoJSON and CSV
// files of a course's tees and baskets, each point worked out from its name, every pin position
// and tee a hole has kept; and OpenStreetMap's own alternate pins.

plain("a point's name says what it is: tee or basket, which hole, which pin (pure logic)", () => {
  plainExpect(readName("Hole 3 Tee")).toMatchObject({ role: "tee", hole: 3 });
  plainExpect(readName("3T")).toMatchObject({ role: "tee", hole: 3 });
  plainExpect(readName("T12")).toMatchObject({ role: "tee", hole: 12 });
  plainExpect(readName("Basket 7")).toMatchObject({ role: "basket", hole: 7 });
  plainExpect(readName("Target 7")).toMatchObject({ role: "basket", hole: 7 });
  plainExpect(readName("5A")).toMatchObject({ role: "basket", hole: 5, tag: "A" });
  plainExpect(readName("Pin 4 long")).toMatchObject({ role: "basket", hole: 4, tag: "long" });
  plainExpect(readName("Hole 2 blue tee")).toMatchObject({ role: "tee", hole: 2, tag: "blue" });
  plainExpect(readName("Bench by 4").other).toBe(true);
  // Pins: a letter said keeps it, the rest short before long; tees longest at the back
  plainExpect(pinPositions(["long", "short"])).toEqual(["B", "A"]);
  plainExpect(pinPositions(["B", undefined])).toEqual(["B", "A"]);
  plainExpect(teeLevels([{ far: 100 }, { far: 250 }])).toEqual(["red", "blue"]);
});

plain("a CSV with a row a hole and two targets; GeoJSON with OpenStreetMap's tags (pure logic)", () => {
  const csv = readCsv([
    "Hole,Par,Tee Latitude,Tee Longitude,Target A Latitude,Target A Longitude,Target B Latitude,Target B Longitude",
    "1,3,35.2900,-83.1800,35.2905,-83.1795,35.2907,-83.1792",
    "2,4,35.2910,-83.1790,35.2920,-83.1780,,"
  ].join("\n"));
  const c = fileCourse(settle(csv));
  plainExpect(c.holes.map(h => [h.number, h.tees?.length, h.baskets?.map(b => b.tag)])).toEqual([[1, 1, ["A", "B"]], [2, 1, ["A"]]]);
  const geo = readGeoJson(JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", properties: { disc_golf: "tee", ref: "1" }, geometry: { type: "Point", coordinates: [-83.18, 35.29] } },
    { type: "Feature", properties: { disc_golf: "basket", ref: "1A" }, geometry: { type: "Point", coordinates: [-83.179, 35.291] } },
    { type: "Feature", properties: { disc_golf: "basket", ref: "1B" }, geometry: { type: "Point", coordinates: [-83.1788, 35.2912] } },
    { type: "Feature", properties: { highway: "footway" }, geometry: { type: "LineString", coordinates: [[-83.18, 35.29], [-83.17, 35.28]] } }
  ] }));
  const g = fileCourse(settle(geo));
  plainExpect(g.holes.length).toBe(1);
  plainExpect(g.holes[0].baskets?.map(b => b.tag)).toEqual(["A", "B"]);
  // (a footpath isn't a hole)
  plainExpect(geo.lines.length).toBe(0);
});

plain("OpenStreetMap: a hole's second basket kept as another pin; a course mapped only as hole points said, no holes made (pure logic)", () => {
  const node = (tags: Record<string, string>, e: number, n: number) => ({ type: "node", id: Math.round(e * 1000 + n), ...geoAt(e, n), tags });
  const mc = mappedCourse(osmFeaturesFrom({ elements: [
    node({ disc_golf: "tee", ref: "5" }, 0, 0),
    node({ disc_golf: "basket", ref: "5A" }, 60, 20),
    node({ disc_golf: "basket", ref: "5B" }, 75, 30)
  ] }))!;
  plainExpect(mc.holes.length).toBe(1);
  plainExpect(mc.holes[0].baskets?.map(b => b.tag)).toEqual(["A", "B"]);
  const hints = osmFeaturesFrom({ elements: [1, 2, 3].map(i => node({ leisure: "disc_golf_course", name: `Disc golf hole ${i}` }, i * 40, 0)) });
  plainExpect(mappedCourse(hints)).toBeNull();
  plainExpect(holeHints(hints)).toBe(3);
});

/** A site round the made-up park (no import: just its place and frame). */
async function siteHere(page: Page) {
  await page.evaluate(s => (window as any).__dgActions.site({ location: { lat: s.lat, lon: s.lon, label: "Springfield Park" }, bounds: { north: s.lat + 0.003, south: s.lat - 0.003, west: s.lon - 0.004, east: s.lon + 0.004 } }), SITE);
  await expect.poll(async () => !!(await course(page)).site.bounds).toBe(true);
}
const open = (page: Page, name: string, text: string) =>
  page.getByTestId("course-file-input").first().setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(text) });
const ll = (e: number, n: number) => { const g = geoAt(e, n); return { lat: g.lat.toFixed(7), lon: g.lon.toFixed(7) }; };
const wpt = (name: string, e: number, n: number) => { const g = ll(e, n); return `<wpt lat="${g.lat}" lon="${g.lon}"><name>${name}</name></wpt>`; };

test("a GPX of waypoints: two holes, one with pins A and B; a bench left out; brought in as one undo step", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await siteHere(page);
  await open(page, "course.gpx", `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
    ${wpt("1T", -100, -50)}${wpt("1A", -40, -20)}${wpt("1B", -30, -5)}
    ${wpt("Hole 2 Tee", 0, 0)}${wpt("Hole 2 Basket", 70, 30)}${wpt("Bench", 10, 10)}</gpx>`);
  const dialog = page.getByTestId("course-file-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("course-file-summary")).toContainText("course.gpx: 2 holes, 1 with more than one pin");
  await expect(page.getByTestId("course-file-hole-row").first()).toContainText("Hole 1: pins A, B");
  await page.getByTestId("course-file-bring").click();
  await expect(dialog).toBeHidden();
  const c = await course(page);
  plainExpect(c.holes.length).toBe(2);
  const first = c.holes.find((h: any) => h.number === 1);
  plainExpect(c.items.filter((i: any) => i.type === "basket" && i.holeId === first.id).map((i: any) => i.position).sort()).toEqual(["A", "B"]);
  plainExpect(c.items.filter((i: any) => i.type === "tee").length).toBe(2);
  // One undo step
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).holes.length).toBe(0);
});

test("a KML from Google Earth: folders per hole, and a hole drawn as a line with a bend", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await siteHere(page);
  const pm = (name: string, e: number, n: number) => { const g = ll(e, n); return `<Placemark><name>${name}</name><Point><coordinates>${g.lon},${g.lat},0</coordinates></Point></Placemark>`; };
  const [a, b, c] = [ll(0, 0), ll(40, 60), ll(90, 70)];
  await open(page, "course.kml", `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Test DGC</name>
    <Folder><name>Hole 1</name>${pm("Tee", -120, -80)}${pm("Basket", -60, -60)}</Folder>
    <Placemark><name>Hole 2</name><LineString><coordinates>${a.lon},${a.lat},0 ${b.lon},${b.lat},0 ${c.lon},${c.lat},0</coordinates></LineString></Placemark>
    </Document></kml>`);
  await expect(page.getByTestId("course-file-summary")).toContainText("course.kml: 2 holes");
  await page.getByTestId("course-file-bring").click();
  const d = await course(page);
  plainExpect(d.holes.length).toBe(2);
  plainExpect(d.holes.find((h: any) => h.number === 2).doglegs.length).toBe(1);
});

test("a point that doesn't say what it is: listed to check, fixed by hand; the holes here kept and these added", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await siteHere(page);
  await addHole(page, { x: 300, y: 300 }, { x: 600, y: 300 });
  // (nothing picked: the hole list at its full width, with the GPS file button)
  await page.evaluate(() => { (window as any).__dgEditor().set({ tool: "select" }); (window as any).__dgActions.select(null); });
  await open(page, "walk.gpx", `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
    ${wpt("Tee 4", 20, -60)}${wpt("4", 80, -30)}${wpt("Tee 5", 100, 40)}${wpt("Basket 5", 150, 80)}</gpx>`);
  // (hole 4's one other point, a bare "4": worked out as its basket, and listed to check)
  const check = page.getByTestId("course-file-check");
  await expect(check.getByTestId("course-file-point")).toHaveCount(1);
  await expect(page.getByTestId("course-file-summary")).toContainText("2 holes");
  // Left out by hand: hole 4 has no basket, so it doesn't come; put back as a basket, it does
  await check.getByTestId("course-file-role").selectOption("skip");
  await expect(page.getByTestId("course-file-summary")).toContainText("walk.gpx: 1 hole");
  await check.getByTestId("course-file-role").selectOption("basket");
  await expect(page.getByTestId("course-file-summary")).toContainText("walk.gpx: 2 holes");
  // Add these to the hole here
  await page.getByTestId("course-file-mode").getByText("Add these to them").click();
  await page.getByTestId("course-file-bring").click();
  const c = await course(page);
  plainExpect(c.holes.length).toBe(3);
});

test("no site yet: Find the park there opens Find your park on the file's spot", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await open(page, "course.gpx", `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${wpt("1T", 0, 0)}${wpt("1B", 60, 20)}</gpx>`);
  await expect(page.getByTestId("course-file-no-site")).toBeVisible();
  await expect(page.getByTestId("course-file-bring")).toBeDisabled();
  await page.getByTestId("course-file-find-park").click();
  await expect(page.getByTestId("site-size")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("course-file-dialog")).toBeHidden();
});

// A whole course in a file (docs/COURSE-FILES.md): three tees on a hole, each with its own line,
// surface, par, name and notes; a basket's model; the layouts.
const g = (e: number, n: number) => { const p = geoAt(e, n); return [p.lon, p.lat]; };
const wholeHole = () => JSON.stringify({ type: "FeatureCollection", name: "Springfield Park", layouts: [{ layout: "Long", tee: "Blue", pin: "A" }, { layout: "Short", tee: "red", pin: "A" }], features: [
  { type: "Feature", properties: { kind: "tee", hole: 1, tee: "Blue", surface: "turf" }, geometry: { type: "Point", coordinates: g(0, 0) } },
  { type: "Feature", properties: { kind: "tee", hole: 1, tee: "White", surface: "dirt" }, geometry: { type: "Point", coordinates: g(40, 10) } },
  { type: "Feature", properties: { kind: "tee", hole: 1, tee: "Red", surface: "Concrete" }, geometry: { type: "Point", coordinates: g(90, 20) } },
  { type: "Feature", properties: { kind: "basket", hole: 1, pin: "A", model: "Springfield 24" }, geometry: { type: "Point", coordinates: g(300, 160) } },
  { type: "Feature", properties: { kind: "hole", hole: 1, tee: "Red", par: 3 }, geometry: { type: "LineString", coordinates: [g(90, 20), g(300, 160)] } },
  { type: "Feature", properties: { kind: "hole", hole: 1, tee: "Blue", par: 4, name: "The Long Way", notes: "OB left of the path." }, geometry: { type: "LineString", coordinates: [g(0, 0), g(160, 40), g(300, 160)] } },
  { type: "Feature", properties: { kind: "hole", hole: 1, tee: "White", par: 4 }, geometry: { type: "LineString", coordinates: [g(40, 10), g(120, 30), g(200, 90), g(300, 160)] } }
] });

plain("GeoJSON with every part: a line from each tee, the back tee's bends and par, surfaces, a basket's model, name, notes and layouts (pure logic)", () => {
  const file = settle(readGeoJson(wholeHole()));
  const c = fileCourse(file);
  plainExpect(c.holes.length).toBe(1);
  const h = c.holes[0];
  plainExpect(h.tees?.map(t => [t.tag, t.surface])).toEqual([["blue", "turf"], ["white", "natural"], ["red", "concrete"]]);
  plainExpect(h.baskets?.map(b => b.model)).toEqual(["Springfield 24"]);
  plainExpect([h.par, h.name, h.notes, h.doglegs.length]).toEqual([4, "The Long Way", "OB left of the path.", 1]);
  // (White's line turns twice: its own; Red's goes straight to a par 3: its own line and par)
  plainExpect(h.tees?.map(t => [t.tag, t.doglegs?.length, t.par])).toEqual([["blue", undefined, undefined], ["white", 2, undefined], ["red", 0, 3]]);
  plainExpect(file.layouts).toEqual([{ name: "Long", tee: "blue", pin: "A" }, { name: "Short", tee: "red", pin: "A" }]);
  // (the layout every course starts with gives way to the file's; one of the same name is updated)
  const mine = withFileLayouts(defaultLayouts(), "layout-main", file.layouts);
  plainExpect(mine.layouts.map(l => l.name)).toEqual(["Long", "Short"]);
  plainExpect(mine.activeLayout).toBe(mine.layouts[0].id);
  const kept = withFileLayouts([{ id: "x", name: "short", tee: "white", pin: "B" }], "x", file.layouts);
  plainExpect(kept.layouts.map(l => [l.name, l.tee, l.pin])).toEqual([["short", "red", "A"], ["Long", "blue", "A"]]);
  plainExpect([readSurface("artificial_turf"), readSurface("Rubber mat"), readSurface("paving_stones"), readSurface("Grass or dirt"), readSurface("")]).toEqual(["turf", "rubber", "pavers", "natural", undefined]);
});

plain("CSV with a row a point: bends in order make each tee's line; a layout row; the hole list GlideLine Studio exports reads back (pure logic)", () => {
  const ll = (e: number, n: number) => { const p = geoAt(e, n); return `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`; };
  const csv = readCsv([
    "hole,kind,tee,pin,surface,par,hole_name,hole_notes,model,layout,lat,lon",
    `1,tee,blue,,rubber,4,The Bend,Mando right of the oak.,,,${ll(0, 0)}`,
    `1,tee,red,,gravel,,,,,,${ll(60, 30)}`,
    `1,basket,,A,,,,,Springfield 24,,${ll(300, 160)}`,
    `1,basket,,B,,,,,,,${ll(320, 120)}`,
    `1,bend,blue,,,,,,,,${ll(120, 20)}`,
    `1,bend,blue,,,,,,,,${ll(220, 80)}`,
    `,layout,blue,B,,,,,,Long to B,,`
  ].join("\n"));
  const c = fileCourse(settle(csv));
  const h = c.holes[0];
  plainExpect([h.par, h.name, h.notes, h.doglegs.length]).toEqual([4, "The Bend", "Mando right of the oak.", 2]);
  plainExpect(h.tees?.map(t => [t.tag, t.surface])).toEqual([["blue", "rubber"], ["red", "gravel"]]);
  plainExpect(h.baskets?.map(b => [b.tag, b.model])).toEqual([["A", "Springfield 24"], ["B", undefined]]);
  plainExpect(csv.layouts).toEqual([{ name: "Long to B", tee: "blue", pin: "B" }]);
  // The app's own hole list: a row a hole and layout, the same tee and pin on each layout's row
  const list = readCsv([
    "hole,name,layout,tee,par,length_ft,tee_lat,tee_lon,basket_pin,basket_lat,basket_lon,notes",
    `1,The Bend,Long,Blue,4,320,${ll(0, 0)},A,${ll(300, 160)},OB left.`,
    `1,The Bend,Short,Red,3,250,${ll(60, 30)},A,${ll(300, 160)},OB left.`
  ].join("\n"));
  const l = fileCourse(settle(list)).holes[0];
  plainExpect([l.name, l.notes, l.par, l.tees?.map(t => t.tag), l.baskets?.length]).toEqual(["The Bend", "OB left.", 4, ["blue", "red"], 1]);
});

test("a whole course file brought in: tee surfaces, a basket's model, the hole's name, notes and par, and the layouts", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await siteHere(page);
  await open(page, "springfield.geojson", wholeHole());
  await expect(page.getByTestId("course-file-summary")).toContainText("1 with more than one tee. Layouts: Long, Short.");
  await page.getByTestId("course-file-bring").click();
  await expect(page.getByTestId("course-file-dialog")).toBeHidden();
  const c = await course(page);
  const h = c.holes[0];
  plainExpect([h.name, h.notes, h.par, h.doglegs.length]).toEqual(["The Long Way", "OB left of the path.", 4, 1]);
  plainExpect(c.items.filter((i: any) => i.type === "tee").map((i: any) => [i.level, i.surface]).sort()).toEqual([["blue", "turf"], ["red", "concrete"], ["white", "natural"]]);
  plainExpect(c.items.find((i: any) => i.type === "basket").model).toBe("Springfield 24");
  const tee = (level: string) => c.items.find((i: any) => i.type === "tee" && i.level === level);
  plainExpect([tee("blue").doglegs, tee("white").doglegs?.length, tee("red").doglegs, tee("red").par]).toEqual([undefined, 2, [], 3]);
  plainExpect(c.layouts.map((l: any) => [l.name, l.tee, l.pin])).toEqual([["Long", "blue", "A"], ["Short", "red", "A"]]);
  plainExpect(c.activeLayout).toBe(c.layouts[0].id);
  // One undo step takes it all back, layouts too
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).layouts.map((l: any) => l.name)).toEqual(["Main"]);
});

plain("a tee's own bends and par: its line, its fairway, the par a layout playing it gets, and whose bends editing changes (pure logic)", () => {
  const hole = newHole({ doglegs: [{ x: 100, y: 0 }], par: 4 });
  const blue = createTee(hole.id, { x: 0, y: 0 }, "blue");
  const red = { ...createTee(hole.id, { x: 60, y: 40 }, "red"), doglegs: [], par: 3 };
  const doc = { ...createEmptyCourse(), holes: [hole], items: [blue, red, createBasket(hole.id, { x: 200, y: 100 })] };
  const play = (tee: "blue" | "red") => holeStats(doc, hole, { id: tee, name: tee, tee, pin: "A" });
  plainExpect([play("blue").par, play("red").par]).toEqual([4, 3]);
  plainExpect([play("blue").line.length, play("red").line.length]).toEqual([3, 2]);
  // (the red tee's fairway runs straight, the blue's through the hole's turn)
  plainExpect(teeLines(doc, hole, play("blue").line, blue.id).map(l => l.length)).toEqual([3, 2]);
  plainExpect([bendOwner(doc, hole, red.id)?.id, bendOwner(doc, hole, blue.id)]).toEqual([red.id, null]);
});

test("a tee's own bends and par, set in its panel: the line and par follow, and Same as the hole puts them back", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 300 }, { x: 700, y: 300 });
  await page.evaluate(id => (window as any).__dgActions.hole(id, { doglegs: [{ x: 500, y: 200 }] }), hole.id);
  const tee = (await course(page)).items.find((i: any) => i.type === "tee" && i.holeId === hole.id);
  await page.evaluate(id => { (window as any).__dgEditor().set({ tool: "select" }); (window as any).__dgActions.select(id); }, tee.id);
  await page.getByRole("radiogroup", { name: "Bends" }).getByRole("radio", { name: "Its own" }).click();
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === tee.id).doglegs).toEqual([{ x: 500, y: 200 }]);
  await page.getByRole("radiogroup", { name: "Par from this tee" }).getByRole("radio", { name: "5" }).click();
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === tee.id).par).toBe(5);
  // (the hole's turn moved: this tee keeps its own)
  await page.evaluate(id => (window as any).__dgActions.hole(id, { doglegs: [{ x: 500, y: 400 }] }), hole.id);
  plainExpect((await course(page)).items.find((i: any) => i.id === tee.id).doglegs).toEqual([{ x: 500, y: 200 }]);
  await page.getByRole("radiogroup", { name: "Bends" }).getByRole("radio", { name: "The hole's" }).click();
  await page.getByRole("radiogroup", { name: "Par from this tee" }).getByRole("radio", { name: /^(Hole's|Auto) / }).click();
  await expect.poll(async () => { const t = (await course(page)).items.find((i: any) => i.id === tee.id); return [t.doglegs, t.par]; }).toEqual([undefined, undefined]);
});

plain("a tee past one of the hole's turns skips it: its line, length and the way its pad faces (pure logic)", () => {
  const hole = newHole({ doglegs: [{ x: 100, y: 0 }, { x: 200, y: 100 }] });
  const blue = createTee(hole.id, { x: 0, y: 0 }, "blue");
  const red = createTee(hole.id, { x: 150, y: 40 }, "red");
  const doc = { ...createEmptyCourse(), holes: [hole], items: [blue, red, createBasket(hole.id, { x: 300, y: 100 })] };
  const play = (tee: "blue" | "red") => holeStats(doc, hole, { id: tee, name: tee, tee, pin: "A" });
  plainExpect(play("blue").line.length).toBe(4);
  plainExpect(play("red").line.map(p => [p.x, p.y])).toEqual([[150, 40], [200, 100], [300, 100]]);
  plainExpect(play("red").length).toBeLessThan(play("blue").length);
});

plain("the help guide's example files bring in all they hold, CSV and GeoJSON alike (pure logic)", () => {
  for (const file of [readCsv(EXAMPLE_CSV), readGeoJson(EXAMPLE_GEOJSON)]) {
    const h = fileCourse(settle(file)).holes[0];
    plainExpect([h.par, h.name, h.notes, h.doglegs.length]).toEqual([4, "The Long Way", "OB left of the path.", 1]);
    plainExpect(h.tees?.map(t => [t.tag, t.surface, t.par])).toEqual([["blue", "turf", undefined], ["red", "natural", 3]]);
    plainExpect(h.baskets?.map(b => [b.tag, b.model])).toEqual([["A", "Springfield 24"], ["B", "Springfield 24"]]);
    plainExpect(file.layouts).toEqual([{ name: "Long", tee: "blue", pin: "A" }, { name: "Short", tee: "red", pin: "B" }]);
  }
  plainExpect(readGeoJson(EXAMPLE_GEOJSON).name).toBe("Springfield Park");
  // (GeoJSON's Red line goes straight at the basket: its own; a CSV's Red, with no bends of its own, plays the hole's)
  plainExpect(fileCourse(settle(readGeoJson(EXAMPLE_GEOJSON))).holes[0].tees?.[1].doglegs).toEqual([]);
  plainExpect(fileCourse(settle(readCsv(EXAMPLE_CSV))).holes[0].tees?.[1].doglegs).toBeUndefined();
});

test("Course file format in the help guide: every column, and an example file that opens in Holes from a GPS file", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await siteHere(page);
  // (the button's ? on the Site step says where the format is)
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "site" }));
  await page.getByTestId("site-info").getByTestId("help-gps-holes").click();
  await expect(page.getByTestId("help-tip")).toContainText("Course file format");
  await page.keyboard.press("Escape");
  await page.keyboard.press("?");
  const guide = page.getByRole("dialog", { name: "Help guide" });
  await guide.getByTestId("help-search").fill("course file format");
  const card = guide.getByTestId("help-topic").filter({ hasText: "Course file format" });
  await expect(card.getByTestId("help-table")).toContainText("hole_name, hole_notes");
  const [dl] = await Promise.all([page.waitForEvent("download"), card.getByTestId("help-file").filter({ hasText: "Example CSV" }).click()]);
  plainExpect(dl.suggestedFilename()).toBe("course-file-example.csv");
  const text = readFileSync(await dl.path(), "utf8");
  plainExpect(text).toBe(EXAMPLE_CSV);
  // (Escape clears the search, then closes the guide)
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  // (the made-up park is the test site's, so it lands on it)
  await open(page, "course-file-example.csv", text);
  await expect(page.getByTestId("course-file-summary")).toContainText("1 hole, 1 with more than one pin and 1 with more than one tee. Layouts: Long, Short.");
  await page.getByTestId("course-file-format").getByTestId("help-course-file-format").click();
  await expect(page.getByTestId("help-tip")).toContainText("laid out like the examples here");
});

test("the help guide's KML example brings in the whole hole, and its GPX example the points and the line", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await siteHere(page);
  await page.keyboard.press("?");
  const guide = page.getByRole("dialog", { name: "Help guide" });
  await guide.getByTestId("help-search").fill("course file format");
  const card = guide.getByTestId("help-topic").filter({ hasText: "Course file format" });
  await expect(card.getByTestId("help-file")).toHaveText(["Example CSV", "Example GeoJSON", "Example KML", "Example GPX"]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const bring = async (name: string, text: string) => {
    await open(page, name, text);
    await page.getByTestId("course-file-bring").click();
    await expect(page.getByTestId("course-file-dialog")).toBeHidden();
    const c = await course(page);
    const tee = (level: string) => c.items.find((i: any) => i.type === "tee" && i.level === level);
    return { c, h: c.holes[0], tee, baskets: c.items.filter((i: any) => i.type === "basket").map((b: any) => [b.position, b.model]) };
  };
  // KML: all of it, as the GeoJSON has it (Red's own straight line and par)
  const k = await bring("course-file-example.kml", EXAMPLE_KML);
  plainExpect([k.c.name, k.h.name, k.h.notes, k.h.par, k.h.doglegs.length]).toEqual(["Springfield Park", "The Long Way", "OB left of the path.", 4, 1]);
  plainExpect([k.tee("blue").surface, k.tee("red").surface, k.tee("red").par, k.tee("red").doglegs]).toEqual(["turf", "natural", 3, []]);
  plainExpect(k.baskets).toEqual([["A", "Springfield 24"], ["B", "Springfield 24"]]);
  plainExpect(k.c.layouts.map((l: any) => [l.name, l.tee, l.pin])).toEqual([["Long", "blue", "A"], ["Short", "red", "B"]]);
  // GPX, once the KML is undone: names only
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).holes.length).toBe(0);
  const g = await bring("course-file-example.gpx", EXAMPLE_GPX);
  plainExpect([g.h.doglegs.length, !!g.tee("blue"), !!g.tee("red"), g.h.name]).toEqual([1, true, true, undefined]);
  plainExpect(g.baskets.map(([pin]: any) => pin)).toEqual(["A", "B"]);
  plainExpect(g.c.layouts.map((l: any) => l.name)).toEqual(["Main"]);
});

// A course list with a row a point: each tee named (Long, Short, Jr.), the pin named Main, each
// tee's line as bends that name the tee and pin they run between, numbered (and listed out of
// order); a tee marked removed and a pin marked temporary.
const HEAD = "course_name,hole_number,hole_status,type,label,latitude,longitude,position_type,position_name,basket_model,position_status,point_index,is_temporary";
const row = (hole: number, type: string, label: string, e: number, n: number, o: { status?: string; index?: number; temp?: boolean } = {}) => {
  const p = ll(e, n), tee = type === "tee", pin = type === "target";
  return [`"Springfield Park"`, hole, "active", type, `"${label}"`, p.lat, p.lon, tee ? "grass" : "", pin ? "Springfield 24" : "", pin ? "Springfield Champion 24" : "", o.status ?? "active", o.index ?? "", o.temp ? "true" : "false"].join(",");
};
const namedTees = () => [HEAD,
  row(1, "tee", "Long", 0, 0), row(1, "tee", "Short", 60, 20), row(1, "tee", "Jr.", 120, 30), row(1, "tee", "Pro", -30, 0, { status: "removed" }),
  row(1, "target", "Main", 400, 100), row(1, "target", "Event", 420, 130, { temp: true }),
  row(1, "dogleg", "Long -> Main", 250, 150, { index: 2 }), row(1, "dogleg", "Long -> Main", 150, 120, { index: 1 }),
  row(1, "dogleg", "Short -> Main", 250, 150, { index: 1 }),
  row(2, "tee", "Jr.", 580, 20), row(2, "tee", "Long", 500, 0), row(2, "tee", "Short", 540, 10), row(2, "target", "Main", 800, 0)
].join("\n");

plain("tees named the same on every hole make a layout each; bends that name their tee make its line, in their order; removed and temporary points stay out (pure logic)", () => {
  const f = teeNameLayouts(settle(readCsv(namedTees())));
  plainExpect(f.name).toBe("Springfield Park");
  plainExpect(f.layouts).toEqual([{ name: "Long", tee: "gold", pin: "A" }, { name: "Short", tee: "blue", pin: "A" }, { name: "Jr.", tee: "red", pin: "A" }]);
  plainExpect(f.teeLayouts).toBe(true);
  const c = fileCourse(f);
  plainExpect(c.left).toEqual([]);
  const [h1, h2] = c.holes;
  // (the back tee's line is the hole's, through both bends in their order; Short has its own; Jr. none, so straight)
  plainExpect(h1.doglegs.map(p => +p.lat.toFixed(6))).toEqual([ll(150, 120), ll(250, 150)].map(p => +(+p.lat).toFixed(6)));
  plainExpect(h1.tees?.map(t => [t.tag, t.surface, t.doglegs?.length])).toEqual([["gold", "natural", undefined], ["blue", "natural", 1], ["red", "natural", 0]]);
  plainExpect(h1.baskets?.map(b => b.model)).toEqual(["Springfield Champion 24"]);
  plainExpect(h2.tees?.map(t => [t.tag, t.doglegs])).toEqual([["red", undefined], ["gold", undefined], ["blue", undefined]]);
  // (tees named only by color: no layouts made of them)
  const colors = readCsv(["hole,kind,name,lat,lon", ...[1, 2].flatMap(h => [`${h},tee,Blue,${Object.values(ll(h * 300, 0)).join(",")}`, `${h},tee,Red,${Object.values(ll(h * 300 + 50, 0)).join(",")}`, `${h},basket,,${Object.values(ll(h * 300 + 200, 0)).join(",")}`])].join("\n"));
  plainExpect(teeNameLayouts(settle(colors)).layouts).toBeUndefined();
});

test("named tees from a file: the park found and brought in first, then a layout each, and Export makes every layout's sign", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 420_000));
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await open(page, "springfield.csv", namedTees());
  await page.getByTestId("course-file-find-park").click();
  await expect(page.getByTestId("site-size")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid=import-what][data-here=ready]')).toBeVisible({ timeout: 90_000 });
  // (no trees or map data: the signs paint sooner)
  const photoTrees = page.getByTestId("bring-photo-trees");
  if (await photoTrees.isVisible()) await photoTrees.click();
  await page.getByTestId("bring-osm").click();
  await page.getByTestId("import-site").click();
  await expect(page.getByTestId("import-review")).toBeVisible({ timeout: 120_000 });
  // (while the site is only looked over, the file waits: holes brought in then would lose its layouts)
  await expect(page.getByTestId("course-file-dialog")).toBeHidden();
  await page.getByTestId("review-bring").click();
  await expect(page.getByTestId("course-file-summary")).toContainText("2 holes, 2 with more than one tee. Layouts: Long, Short, Jr.", { timeout: 60_000 });
  await expect(page.getByTestId("course-file-check")).toHaveCount(0);
  await page.getByTestId("course-file-bring").click();
  await expect(page.getByTestId("course-file-dialog")).toBeHidden();
  const start = page.getByTestId("site-ready-start");
  if (await start.isVisible().catch(() => false)) await start.click();
  const c = await course(page);
  plainExpect(c.layouts.map((l: any) => [l.name, l.tee])).toEqual([["Long", "gold"], ["Short", "blue"], ["Jr.", "red"]]);
  plainExpect(c.style.teeNames).toBe("layouts");
  plainExpect(c.items.filter((i: any) => i.type === "tee").length).toBe(6);
  // (the Short tee's own bend on its hole, between it and the basket: on the ground with the rest, in the site's frame)
  const shortTee = c.items.find((i: any) => i.type === "tee" && i.level === "blue" && i.doglegs?.length);
  const pin = c.items.find((i: any) => i.type === "basket" && i.holeId === shortTee.holeId);
  const apart = (p: any, q: any) => Math.hypot(p.x - q.x, p.y - q.y);
  plainExpect(apart(shortTee.doglegs[0], pin)).toBeLessThan(apart(shortTee, pin));
  plainExpect(apart(shortTee.doglegs[0], shortTee)).toBeLessThan(apart(shortTee, pin));
  // Export: hole 1's sign for each layout, a folder each, the tees named by their layouts
  await page.getByRole("button", { name: "4 Export" }).click();
  const signs = page.getByTestId("export-thing-signs");
  if (!(await signs.getAttribute("data-open"))) await signs.getByRole("button").first().click();
  await signs.getByTestId("sign-pick").getByRole("radio", { name: "1", exact: true }).click();
  await signs.getByTestId("sign-layout").getByRole("radio", { name: "All 3" }).click();
  await signs.getByTestId("sign-size").getByRole("radio", { name: "Letter" }).click();
  await signs.getByRole("radio", { name: "Pictures (ZIP)", exact: true }).click();
  await expect(page.getByTestId("export-signs-zip")).toContainText("Download 3 sign pictures");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 240_000 }), page.getByTestId("export-signs-zip").click()]);
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  plainExpect(Object.keys(zip.files).filter(n => !n.endsWith("/")).sort()).toEqual(["jr/hole-01.png", "jr/hole-01.svg", "long/hole-01.png", "long/hole-01.svg", "short/hole-01.png", "short/hole-01.svg"]);
  const short = await zip.file("short/hole-01.svg")!.async("string");
  plainExpect(short).toContain("SHORT LAYOUT");
  plainExpect(short).toContain(">JR.<");
  plainExpect(short).not.toContain(">GOLD<");
  // (picking one layout again: the course's own, as the holes column picks it)
  await signs.getByTestId("sign-layout").getByRole("radio", { name: "Jr." }).click();
  await expect.poll(async () => { const d = await course(page); return d.layouts.find((l: any) => l.id === d.activeLayout)?.name; }).toBe("Jr.");
});
