import { readFileSync } from "fs";
import JSZip from "jszip";
import { test as plain, expect as plainExpect, type Page } from "@playwright/test";
import { test, expect, addHole, importSite, course } from "./fixtures";
import { createArea, createBasket, createEmptyCourse, createTee, newHole } from "../../src/lib/course";
import { HOLE_PAGES, holeLengths, renderHolePage } from "../../src/lib/holePage";
import { renderTeeSign } from "../../src/lib/teeSign";

/** Each export button's thing in the Export list, and the format picked for it there. */
const VIA: Record<string, [thing: string, format?: string]> = {
  "export-map-pdf": ["map", "PDF"], "export-map-png": ["map", "PNG"], "export-map-svg": ["map", "SVG"],
  "export-signs-pdf": ["signs", "PDF"], "export-signs-zip": ["signs", "Pictures (ZIP)"], "export-sign-png": ["signs", "PNG"], "export-sign-svg": ["signs", "SVG"],
  "export-holes-pdf": ["pages", "PDF"], "export-holes-zip": ["pages", "Pictures (ZIP)"], "export-hole-png": ["pages", "PNG"], "export-hole-svg": ["pages", "SVG"], "export-hole-geojson": ["pages", "GeoJSON"],
  "export-scorecard": ["scorecard", "PDF"],
  "export-kml": ["data", "KML"], "export-gpx": ["data", "GPX"], "export-geojson": ["data", "GeoJSON"], "export-holes-csv": ["data", "Holes CSV"], "export-stakeout": ["data", "Stake-out CSV"],
  "export-parts": ["parts"]
};
/** Opens a thing in the Export list (its row: its choices and its button). */
const openThing = async (page: Page, id: string) => {
  const row = page.getByTestId(`export-thing-${id}`);
  if (!(await row.getAttribute("data-open"))) await row.getByRole("button").first().click();
  return row;
};

/** Opens the export's thing, picks its format, clicks its button and returns the downloaded file's
 * name and contents. */
const exported = async (page: Page, testid: string) => {
  const via = VIA[testid];
  if (via) {
    const row = await openThing(page, via[0]);
    if (via[1]) await row.getByRole("radio", { name: via[1], exact: true }).click();
  }
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), page.getByTestId(testid).click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), data: readFileSync(path!) };
};

/** An imported site with two holes, a mando and an OB area. */
async function setup(page: Page) {
  // (an import and two holes: slow on a machine drawing without a graphics card)
  test.setTimeout(Math.max(test.info().timeout, 240_000));
  await importSite(page, { trees: false, osm: false });
  const doc = await course(page);
  const W = doc.canvas.width, H = doc.canvas.height;
  await addHole(page, { x: W * 0.3, y: H * 0.7 }, { x: W * 0.5, y: H * 0.7 });
  await addHole(page, { x: W * 0.55, y: H * 0.65 }, { x: W * 0.55, y: H * 0.35 });
  await page.evaluate(() => {
    const a = (window as any).__dgActions;
    const d = (window as any).__dgCourse();
    (window as any).__dgEditor().set({ activeHoleId: d.holes[1].id, areaKind: "ob" });
    a.placeAt("add-mando", { x: d.canvas.width * 0.56, y: d.canvas.height * 0.5 });
    a.addDrawn("area", [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]);
    (window as any).__dgEditor().set({ tool: "select" });
  });
  await page.getByRole("button", { name: "4 Export" }).click();
  return { W, H };
}

test("GPS files: GeoJSON, KML and GPX hold the tees, baskets and holes with real coordinates", async ({ page }) => {
  await setup(page);
  const geo = await exported(page, "export-geojson");
  expect(geo.name).toBe("springfield-park-disc-golf-course.geojson");
  const fc = JSON.parse(geo.data.toString());
  const kinds = fc.features.map((f: any) => f.properties.kind);
  expect(kinds.filter((k: string) => k === "tee")).toHaveLength(2);
  expect(kinds.filter((k: string) => k === "basket")).toHaveLength(2);
  expect(kinds).toContain("mando");
  expect(kinds).toContain("ob");
  const hole = fc.features.find((f: any) => f.properties.kind === "hole" && f.properties.hole === 1);
  expect(hole.properties.par).toBe(3);
  expect(hole.properties.disc_golf).toBe("hole");
  const [lon, lat] = hole.geometry.coordinates[0];
  expect(Math.abs(lat - 39.78)).toBeLessThan(0.01);
  expect(Math.abs(lon + 89.68)).toBeLessThan(0.01);
  const kml = (await exported(page, "export-kml")).data.toString();
  expect(kml).toContain("<kml");
  expect(kml).toContain("<name>Hole 1</name>");
  expect(kml).toContain("1 basket A");
  // (each tee in its own color)
  expect(kml).toContain('<Style id="tee-blue">');
  expect(kml).toContain("<name>1 Blue tee</name><styleUrl>#tee-blue</styleUrl>");
  const gpx = (await exported(page, "export-gpx")).data.toString();
  expect((gpx.match(/<wpt /g) ?? []).length).toBe(5);
  expect(gpx).toContain("H2 Blue tee");
  expect(gpx).toContain("<rte><name>Hole 2</name>");
});

test("spreadsheets: the hole list, the stake-out list and the parts list", async ({ page }) => {
  await setup(page);
  const holes = (await exported(page, "export-holes-csv")).data.toString().split("\n");
  expect(holes[0]).toMatch(/^hole,name,layout,tee,par,length_ft/);
  expect(holes).toHaveLength(3);
  expect(holes[1]).toMatch(/^1,,Main,Blue,3,/);
  const stake = (await exported(page, "export-stakeout")).data.toString();
  expect(stake).toContain("Blue tee (pad middle)");
  expect(stake).toContain("Basket A");
  // (East of a hole running north: passed on its left, on the line's side)
  expect(stake).toMatch(/Mando \(pass left\)/);
  await expect(page.getByTestId("parts")).toContainText("Baskets");
  await expect(page.getByTestId("parts-total")).toHaveText(/\$\d/);
  const parts = (await exported(page, "export-parts")).data.toString();
  expect(parts).toMatch(/Baskets,2,each,450,900/);
  expect(parts).toMatch(/Tee pads,2,each/);
});

test("printing: course map PDF and SVG, tee signs PDF and pictures, scorecard", async ({ page }) => {
  test.setTimeout(420_000);
  await setup(page);
  // One thing open at a time, with only its own choices; each of them inside the panel, none cut off
  for (const id of ["map", "signs", "pages", "video"]) {
    const row = await openThing(page, id);
    await expect(page.locator("[data-testid^=export-thing-][data-open]")).toHaveCount(1);
    const box = (await row.boundingBox())!;
    for (const r of await row.getByRole("radio").all()) {
      const b = (await r.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
  }
  const svg = await exported(page, "export-map-svg");
  expect(svg.name).toMatch(/-map\.svg$/);
  expect(svg.data.toString()).toContain("<svg");
  const pdf = await exported(page, "export-map-pdf");
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.data.toString("latin1")).toContain("/Count 1");
  const signs = await exported(page, "export-signs-pdf");
  expect(signs.data.toString("latin1")).toContain("/Count 2");
  const zip = await JSZip.loadAsync((await exported(page, "export-signs-zip")).data);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(["hole-01.png", "hole-01.svg", "hole-02.png", "hole-02.svg"]);
  const png = await zip.file("hole-01.png")!.async("uint8array");
  expect(Buffer.from(png.subarray(1, 4)).toString()).toBe("PNG");
  expect(png.length).toBeLessThan(5 * 1024 * 1024);
  const card = await exported(page, "export-scorecard");
  expect(card.data.subarray(0, 5).toString()).toBe("%PDF-");
});

/** A PNG's width and height (from its header). */
const pngSize = (png: Uint8Array) => { const b = Buffer.from(png); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
/** Pages in a PDF ("/Type /Page", not "/Type /Pages"). */
const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

test("hole by hole: a PDF page and a picture per hole, and one hole's PNG, SVG and GeoJSON", async ({ page }) => {
  test.setTimeout(180_000);
  const { W, H } = await setup(page);
  // An OB line across hole 2 for the whole course, and an OB area that belongs to hole 1
  await page.evaluate(([W, H]) => {
    const a = (window as any).__dgActions;
    (window as any).__dgEditor().set({ lineKind: "ob", areaKind: "ob" });
    a.addDrawn("line", [{ x: W * 0.5, y: H * 0.5 }, { x: W * 0.6, y: H * 0.5 }]);
    a.addDrawn("area", [{ x: W * 0.38, y: H * 0.73 }, { x: W * 0.42, y: H * 0.73 }, { x: W * 0.42, y: H * 0.76 }]);
  }, [W, H]);
  // (the inspector is the Design step's)
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.getByTestId("belongs-to").getByRole("button", { name: "Hole 1" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "4 Export" }).click();
  const holes = await openThing(page, "pages");
  await expect(holes.getByTestId("hole-pick").getByRole("radio", { name: "All 2" })).toHaveAttribute("aria-checked", "true");
  // All holes: one PDF page each, and a ZIP with a picture of each
  const pdf = await exported(page, "export-holes-pdf");
  expect(pdf.name).toBe("springfield-park-disc-golf-course-hole-pages.pdf");
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfPages(pdf.data)).toBe(2);
  const zip = await JSZip.loadAsync((await exported(page, "export-holes-zip")).data);
  expect(Object.keys(zip.files).sort()).toEqual(["hole-01.png", "hole-02.png"]);
  const letter = await zip.file("hole-01.png")!.async("uint8array");
  expect(Buffer.from(letter.subarray(1, 4)).toString()).toBe("PNG");
  // (printed at 300 dpi)
  expect(pngSize(letter)).toEqual({ width: 2550, height: 3300 });
  // One hole: its page as a square picture for sharing, as SVG, and its GPS file
  await holes.getByTestId("hole-pick").getByRole("radio", { name: "2", exact: true }).click();
  await holes.getByTestId("hole-page-size").getByRole("radio", { name: "Square" }).click();
  await expect(holes.getByRole("radio", { name: "Pictures (ZIP)" })).toHaveCount(0);
  const one = await exported(page, "export-holes-pdf");
  expect(one.name).toBe("springfield-park-disc-golf-course-hole-2.pdf");
  expect(pdfPages(one.data)).toBe(1);
  const png = await exported(page, "export-hole-png");
  expect(png.name).toBe("springfield-park-disc-golf-course-hole-2.png");
  expect(pngSize(png.data)).toEqual({ width: 1080, height: 1080 });
  const svg = (await exported(page, "export-hole-svg")).data.toString();
  // (the number on its disc; "HOLE 2" beside it only when asked for)
  expect(svg).toMatch(/data-el="number"><circle[^>]*\/><text[^>]*>2<\/text>/);
  expect(svg).not.toContain(">HOLE 2<");
  expect(svg).toContain(">PAR 3<");
  const geo = await exported(page, "export-hole-geojson");
  expect(geo.name).toBe("springfield-park-disc-golf-course-hole-2.geojson");
  const fc = JSON.parse(geo.data.toString());
  const kinds = fc.features.map((f: any) => f.properties.kind);
  expect(kinds.filter((k: string) => k === "tee")).toHaveLength(1);
  expect(kinds.filter((k: string) => k === "basket")).toHaveLength(1);
  expect(kinds).toContain("hole");
  expect(kinds).toContain("mando");
  // Nothing of hole 1's, nor the OB far away; the course's OB line across the hole is in play
  expect(fc.features.filter((f: any) => f.properties.hole === 1)).toEqual([]);
  expect(kinds).not.toContain("ob");
  const ob = fc.features.filter((f: any) => f.properties.kind === "ob_line");
  expect(ob).toHaveLength(1);
  expect(ob[0].properties.in_play).toBe(true);
  expect(fc.features.filter((f: any) => f.properties.kind !== "ob_line").every((f: any) => f.properties.hole === 2)).toBe(true);
});

plain("hole pages: number, par, the length from each tee, elevation, notes and the profile", () => {
  const doc = createEmptyCourse();
  doc.name = "The Hollow";
  const h1 = newHole({ notes: "Creek & beyond OB", name: "Long Way Round" });
  const h2 = newHole();
  doc.holes.push(h1, h2);
  doc.items.push(createTee(h1.id, { x: 100, y: 500 }, "gold"), createTee(h1.id, { x: 160, y: 500 }, "blue"), createBasket(h1.id, { x: 450, y: 500 }), createBasket(h1.id, { x: 450, y: 400 }, "B"));
  doc.items.push(createTee(h2.id, { x: 500, y: 450 }), createBasket(h2.id, { x: 500, y: 150 }));
  // The layout plays the blue tees to the A pins: 290 ft; the gold tee is 350 ft
  plainExpect(holeLengths(doc, h1.id).tees.map(t => [t.level, Math.round(t.length)])).toEqual([["gold", 350], ["blue", 290]]);
  const p = renderHolePage(doc, h1.id, "letter", { contours: null, hillshade: null })!;
  plainExpect([p.width, p.height]).toEqual([8.5 * 72, 11 * 72]);
  plainExpect(p.svg.startsWith("<svg")).toBe(true);
  // (the number on its disc; "HOLE 1" beside it left out until it's asked for)
  plainExpect(p.svg).not.toContain(">HOLE 1<");
  plainExpect(p.svg).toMatch(/data-el="number"><circle[^>]*\/><text[^>]*>1<\/text>/);
  plainExpect(p.svg).toContain(">Long Way Round<");
  plainExpect(p.svg).toContain(">THE HOLLOW<");
  plainExpect(p.svg).toContain(">PAR 3<");
  plainExpect(p.svg).toContain(">290 FT<");
  plainExpect(p.svg).toContain(">GOLD 350 FT<");
  plainExpect(p.svg).toContain(">BLUE 290 FT<");
  plainExpect(p.svg).toContain("ELEVATION LEVEL");
  plainExpect(p.svg).toContain("PLAYS LIKE 290 FT");
  plainExpect(p.svg).toMatch(/PINS A 290 · B 3\d\d/);
  plainExpect(p.svg).toContain("Creek &amp; beyond OB");
  plainExpect(p.svg).toContain('data-part="profile"');
  plainExpect(p.svg).toContain('data-part="map"');
  plainExpect(p.svg).toContain("HOLE 2 ·");
  plainExpect(p.svg).toContain("HOLE 1 OF 2");
  doc.style.holePage = { layout: { holeTitle: { hidden: false } } };
  plainExpect(renderHolePage(doc, h1.id, "letter", { contours: null, hillshade: null })!.svg).toContain(">HOLE 1<");
  doc.style.holePage = undefined;
  // Every size, in meters too
  doc.units = "m";
  for (const size of Object.keys(HOLE_PAGES) as (keyof typeof HOLE_PAGES)[]) {
    const s = renderHolePage(doc, h1.id, size, { contours: null, hillshade: null })!;
    plainExpect(s.width, size).toBe(HOLE_PAGES[size].w * 72);
    plainExpect(s.svg, size).toContain(">GOLD 107 M<");
    plainExpect(s.svg, size).toContain(">PAR 3<");
    plainExpect(s.svg, size).toContain("Creek &amp; beyond OB");
  }
  plainExpect(HOLE_PAGES.square.w * HOLE_PAGES.square.dpi).toBe(1080);
  // A hole without its basket yet
  const h3 = newHole();
  doc.holes.push(h3);
  doc.items.push(createTee(h3.id, { x: 800, y: 800 }));
  const open = renderHolePage(doc, h3.id, "card", { contours: null, hillshade: null })!;
  plainExpect(open.svg).toContain("UNFINISHED");
  plainExpect(open.svg).not.toContain('data-part="tee-length"');
  plainExpect(renderHolePage(doc, "nope", "letter", { contours: null, hillshade: null })).toBeNull();
});

plain("a hole page's key lists only the markings on its map", () => {
  const doc = createEmptyCourse();
  const h = newHole();
  doc.holes.push(h);
  doc.items.push(createTee(h.id, { x: 200, y: 500 }), createBasket(h.id, { x: 500, y: 500 }));
  // Nothing marked: no key entries
  const key = (svg: string) => ["OB", "Hazard", "Mando / DZ"].filter(k => svg.includes(`</tspan> ${k}`));
  plainExpect(key(renderHolePage(doc, h.id, "letter", { contours: null, hillshade: null })!.svg)).toEqual([]);
  // OB beside the fairway shows; a hazard far off the map doesn't
  doc.items.push(createArea("ob", [{ x: 250, y: 530 }, { x: 450, y: 530 }, { x: 450, y: 560 }, { x: 250, y: 560 }]));
  doc.items.push(createArea("hazard", [{ x: 3000, y: 3000 }, { x: 3100, y: 3000 }, { x: 3100, y: 3100 }]));
  plainExpect(key(renderHolePage(doc, h.id, "letter", { contours: null, hillshade: null })!.svg)).toEqual(["OB"]);
});

plain("tee signs and hole cards take the course's own card style: header, lettering, paper, text, font", () => {
  const doc = createEmptyCourse();
  const h = newHole();
  doc.holes.push(h);
  doc.items.push(createTee(h.id, { x: 200, y: 500 }), createBasket(h.id, { x: 500, y: 500 }));
  h.name = "The Chute";
  const plainCard = renderHolePage(doc, h.id, "letter", { contours: null, hillshade: null })!.svg;
  plainExpect(plainCard).toContain('fill="#13311d"');
  doc.style.card = { header: "#1e3a5f", accent: "#fde68a", paper: "#fffaf0", ink: "#222222", font: "Bitter" };
  for (const svg of [renderHolePage(doc, h.id, "letter", { contours: null, hillshade: null })!.svg, renderTeeSign(doc, h.id, "18x12", { contours: null, hillshade: null })!.svg, renderTeeSign(doc, h.id, "12x18", { contours: null, hillshade: null })!.svg]) {
    plainExpect(svg).toContain('fill="#fffaf0"');
    plainExpect(svg).not.toContain('fill="#f5f4ee"');
  }
  const card = renderHolePage(doc, h.id, "letter", { contours: null, hillshade: null })!.svg;
  plainExpect(card).toContain('fill="#1e3a5f"');
  plainExpect(card).toContain('fill="#fde68a"');
  plainExpect(card).toContain("Bitter");
});
