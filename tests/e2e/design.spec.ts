import { test as plain, expect as plainExpect } from "@playwright/test";
import { test, expect, addHole, blankCourse, classicLook, course, editorState, importSite } from "./fixtures";
import { areaPath, autoWalks, createAmenity, createArea, createBasket, createDropZone, createEmptyCourse, createLine, createMando, createTee, createTree, curves, drawnAreas, linePath, newHole, normalizeCourse, widthAlong, widthsWithEnd, widthsWithout, widthsWithPoint, widthVaries } from "../../src/lib/course";
import { contourInterval, meander, paintedFrom, paintedLine } from "../../src/lib/forest";
import { contoursOf, reliefExaggeration } from "../../src/lib/relief";
import { dist, distanceToPath } from "../../src/lib/geom";
import { BASKET_MARKS, EARTH, LINE_CREAM, PRINT_EARTH, basketMark, bestRotation, lineStyleOf, renderMapLayers, renderPoster } from "../../src/lib/mapSvg";
import { holeStats } from "../../src/lib/holeStats";
import { renderScorecard, renderTeeSign } from "../../src/lib/teeSign";
import { renderHolePage } from "../../src/lib/holePage";
import { tallGrassOf } from "../../src/lib/landscapes";

/** Where the woods are painted, in Site, Trees (the 3D map's, the illustrated map drawing the same), and back to the Map step. */
/** Site, its Trees open: where the woods and their cover are set, for the 3D map and the illustrated one. */
const siteTrees = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: /^1\s*Site$/ }).click();
  const fold = page.getByTestId("site-trees");
  if (!(await fold.evaluate(d => (d as HTMLDetailsElement).open))) await fold.locator("summary").click();
};
const woodsAt = async (page: import("@playwright/test").Page, where: "From the photo" | "Everywhere" | "Drawn only") => {
  await siteTrees(page);
  await page.getByTestId("forest-options").getByRole("radio", { name: where }).click();
  await page.getByRole("button", { name: /^3\s*Map$/ }).click();
};


/** The map's painting finished (a quick draft shows first, then the sharp picture). */
const painted = (page: import("@playwright/test").Page) => expect.poll(() => page.evaluate(() => !(window as any).__dgPainting()), { timeout: 180_000 }).toBe(true);

test("the Design step shows the printed map; its styles are the painted map in each landscape", async ({ page }) => {
  await blankCourse(page);
  await classicLook(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await addHole(page, { x: 700, y: 650 }, { x: 700, y: 300 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const pageSvg = page.getByTestId("design-page");
  await expect(pageSvg.locator("svg")).toBeVisible();
  // Forest is the default: the title over the map, the layout's par and length on a chip
  await expect(pageSvg).toContainText("DISC GOLF COURSE");
  await expect(pageSvg).toContainText(/PAR 6 \| 700 FT/);
  await expect(pageSvg.locator("image").first()).toBeVisible();
  // The painted Forest map; the trees' part open, its leaf colors as pictures (autumn: several colors)
  await expect(page.getByTestId("colors-trees").getByRole("radio")).toHaveCount(5);
  await expect(page.getByTestId("theme-illustrated")).toHaveCount(0);
  // (early fall: still mostly green, a few trees turning)
  await page.getByTestId("colors-trees-early").click();
  await expect.poll(async () => (await course(page)).style.treeMix?.length).toBe(9);
  await expect(page.getByTestId("colors-trees-early")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("colors-trees-autumn").click();
  await expect.poll(async () => (await course(page)).style.trees).toBe("#7a4b26");
  const autumn = await course(page);
  expect(autumn.style.theme).toBe("forest");
  expect(autumn.style.treeMix?.length).toBeGreaterThan(2);
  await expect(page.getByTestId("colors-trees-autumn")).toHaveAttribute("aria-checked", "true");
  // Title and toggles go straight onto the map
  // (the title's words: picked in Layers, typed on the page)
  await page.getByTestId("page-tool-print-layers").click();
  await page.getByTestId("layer").filter({ hasText: /^Title$/ }).click();
  await page.getByTestId("piece-edit-text").click();
  await page.getByTestId("page-typing").fill("Ridge Run");
  await page.getByTestId("page-typing").press("Enter");
  await expect(pageSvg).toContainText("Ridge Run");
  await page.getByRole("button", { name: "Show Legend" }).click();
  await expect(pageSvg).toContainText("LEGEND");
  await page.getByRole("button", { name: "Show Hole guide" }).click();
  await expect(pageSvg).toContainText("TOTAL");
  // Tee sign and scorecard previews
  await page.getByRole("tab", { name: "Tee sign" }).click();
  await expect(pageSvg).toContainText("PAR 3");
  await expect(pageSvg).toContainText("350");
  await page.getByRole("tab", { name: "Scorecard" }).click();
  // (its Par row, and the +/− column only a scorecard has)
  await expect(pageSvg).toContainText("Par");
  await expect(pageSvg).toContainText("+/−");
});

test("turning the map to fill the page", async ({ page }) => {
  await blankCourse(page);
  // A course running diagonally
  await addHole(page, { x: 200, y: 900 }, { x: 500, y: 650 });
  await addHole(page, { x: 550, y: 600 }, { x: 850, y: 350 });
  await addHole(page, { x: 900, y: 300 }, { x: 1200, y: 100 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await page.getByTestId("page-tool-fold-paper").click();
  await page.getByTestId("best-rotation").click();
  await expect.poll(async () => Math.abs((await course(page)).style.rotation)).toBeGreaterThan(20);
  await page.getByRole("button", { name: "North up" }).click();
  await expect.poll(async () => (await course(page)).style.rotation).toBe(0);
});

test("tree cover: sparse woods leave grass between the trees", async ({ page }) => {
  test.setTimeout(300_000);
  await blankCourse(page);
  await classicLook(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await woodsAt(page, "Everywhere");
  const painting = page.getByTestId("design-page").locator("image").first();
  // How light the painted land is (dark canopy against lighter grass)
  const lightness = async () => {
    await painted(page);
    const href = await painting.getAttribute("href");
    return page.evaluate(async (url: string) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, 120, 80);
      const d = g.getImageData(0, 0, 120, 80).data;
      const l: number[] = [];
      for (let i = 0; i < d.length; i += 4) l.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      return l.sort((a, b) => a - b);
    }, href!);
  };
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
  await painted(page);
  const dense = await lightness();
  // (the share of the land lighter than all but a quarter of the thick woods)
  const light = dense[Math.floor(dense.length * 0.75)];
  const share = (l: number[]) => l.filter(v => v > light).length / l.length;
  const before = await painting.getAttribute("href");
  // (Tree cover is the 3D map's, in Site, Trees: the illustrated map draws the same)
  await siteTrees(page);
  const slider = page.getByLabel("Tree cover");
  await expect(page.getByTestId("forest-options")).toContainText("Dense");
  await slider.fill("0.2");
  await slider.dispatchEvent("pointerup");
  await expect.poll(async () => (await course(page)).style.treeCover).toBe(0.2);
  await expect(page.getByTestId("forest-options")).toContainText("Sparse");
  await page.getByRole("button", { name: /^3\s*Map$/ }).click();
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(before);
  await painted(page);
  // Grass between the trees: far more of the land is lighter
  expect(share(await lightness())).toBeGreaterThan(share(dense) + 0.2);
  // One undo step brings the thick woods back
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).style.treeCover).toBe(1);
  // Each map style repaints it; Classic again is as it was
  const styles = page.getByTestId("map-styles");
  for (const [name, id] of [["Brushwood", "brushwood"], ["Hollow", "hollow"], ["Golden hour", "golden"], ["Storybook", "storybook"], ["Gouache", "gouache"]]) {
    const before = await painting.getAttribute("href");
    await styles.getByRole("radio", { name }).click();
    await expect.poll(async () => (await course(page)).style.mapLook).toBe(id);
    // (Golden hour's trees are brushed: slower to paint on a test machine with no graphics chip)
    await expect.poll(async () => painting.getAttribute("href"), { timeout: 120_000 }).not.toBe(before);
  }
  await styles.getByRole("radio", { name: "Classic" }).click();
  await expect.poll(async () => (await course(page)).style.mapLook).toBeUndefined();
});

test("light and shadow: the sun, shadows and brightness repaint the Forest map, and Reset brings them back", async ({ page }) => {
  test.setTimeout(150_000);
  await blankCourse(page);
  await classicLook(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await woodsAt(page, "Everywhere");
  const painting = page.getByTestId("design-page").locator("image").first();
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
  await painted(page);
  const set = async (panel: import("@playwright/test").Locator, label: string, value: string) => {
    const slider = panel.getByLabel(label);
    await slider.fill(value);
    await slider.dispatchEvent("pointerup");
  };
  // The sun, in the map style's Light part: by the compass, along its real path (east to west)
  const light = page.getByTestId("look-part-light");
  await light.getByRole("button", { name: /Light and shadow/ }).click();
  let before = await painting.getAttribute("href");
  await set(light, "Sun from the", "90");
  await expect.poll(async () => (await course(page)).style.sunFrom).toBe(270);
  await expect(light).toContainText("west");
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(before);
  before = await painting.getAttribute("href");
  await set(light, "Shadows", "1");
  await expect.poll(async () => (await course(page)).style.shadows).toBe(1);
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(before);
  // Golden hour and night repaint it too
  for (const mode of ["Golden hour", "Night"]) {
    before = await painting.getAttribute("href");
    await light.getByRole("radio", { name: mode }).click();
    await expect.poll(async () => painting.getAttribute("href")).not.toBe(before);
  }
  await light.getByTestId("part-reset").click();
  await expect.poll(async () => { const s = (await course(page)).style; return [s.sunFrom, s.shadows, s.lightMode]; }).toEqual([undefined, undefined, undefined]);
  // Fine tuning: the picture's brightness, and its Reset
  const panel = page.getByTestId("light-shadow");
  before = await painting.getAttribute("href");
  await set(panel, "Brightness", "0.3");
  await expect.poll(async () => (await course(page)).style.light).toBe(0.3);
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(before);
  // (Reset shows once the tone is changed, and puts the style's own back)
  await panel.getByRole("button", { name: "Reset" }).click();
  await expect.poll(async () => (await course(page)).style.light ?? 0).toBe(0);
  await expect(panel.getByRole("button", { name: "Reset" })).toHaveCount(0);
});

test("picking a basket mark changes the map's baskets", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const pageSvg = page.getByTestId("design-page");
  // (the marks are shared by every page: the General tab, which shows a tee sign, its hole's
  // basket on its map and in its green up close)
  await page.getByRole("tab", { name: "General" }).click();
  await expect(page.getByTestId("basket-mark-basket")).toHaveAttribute("aria-checked", "true");
  await expect(pageSvg.locator('[data-mark="basket"]').first()).toBeAttached();
  await page.getByTestId("basket-mark-flag").click();
  await expect.poll(async () => (await course(page)).style.basketMark).toBe("flag");
  await expect(page.getByTestId("basket-mark-flag")).toHaveAttribute("aria-checked", "true");
  await expect(pageSvg.locator('[data-mark="flag"]').first()).toBeAttached();
  await expect(pageSvg.locator('[data-mark="basket"]')).toHaveCount(0);
  await page.getByTestId("basket-mark-number").click();
  await expect.poll(async () => (await course(page)).style.basketMark).toBe("number");
  await expect(pageSvg.locator('[data-mark="number"]').first()).toContainText("1");
  // The course map: its one basket with the mark chosen; another color keeps it
  await page.getByRole("tab", { name: "Course map" }).click();
  await expect(pageSvg.locator('[data-mark="number"]')).toHaveCount(1);
  await expect(pageSvg.locator('[data-mark="flag"]')).toHaveCount(0);
  await page.getByTestId("colors-trees-deep").click();
  await expect.poll(async () => (await course(page)).style.trees).toBe("#2a3d2e");
  expect((await course(page)).style.basketMark).toBe("number");
});

// The printed pages' contents (pure logic: the SVG is built without a browser)
const sample = () => {
  const doc = createEmptyCourse();
  doc.name = "The Hollow Disc Golf Course";
  const add = (t: [number, number], b: [number, number]) => {
    const h = newHole();
    doc.holes.push(h);
    doc.items.push(createTee(h.id, { x: t[0], y: t[1] }), createBasket(h.id, { x: b[0], y: b[1] }));
    return h;
  };
  add([100, 500], [450, 500]);
  const h2 = add([500, 450], [500, 150]);
  h2.notes = "Creek & beyond OB";
  doc.items.push(createArea("ob", [{ x: 300, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 400 }]), createLine("stream", [{ x: 0, y: 600 }, { x: 900, y: 650 }]));
  doc.layouts.push({ id: "gold", name: "Gold", tee: "gold", pin: "A" });
  return doc;
};

plain("course map: another tee's line in its color where it plays apart from the hole's, none for a tee on it", () => {
  const doc = sample();
  const h1 = doc.holes[0];
  // (the hole plays from its blue tee; a red one off to the side, a white one right on its line)
  doc.items.push(createTee(h1.id, { x: 160, y: 620 }, "red"), createTee(h1.id, { x: 250, y: 500 }, "white"));
  doc.style.throwLines = true;
  // (Classic, as maps first had their lines)
  doc.style.lineLook = undefined;
  const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  const red = [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#dc2626" stroke-width="[\d.]+" stroke-linecap="round"/g)];
  plainExpect(red).toHaveLength(1);
  // (outlined, as the hole's is: the same path under it, darker and wider)
  plainExpect(svg.split(`<path d="${red[0][1]}"`).length - 1).toBe(2);
  plainExpect(svg).not.toContain('stroke="#eef0f2"');
});

plain("line looks: Classic as maps had them, Painted and Trail; each tee color's own line; a new course Painted, an older one Classic", () => {
  const doc = sample();
  // (one layout: its main line white or cream)
  doc.layouts.length = 1;
  const h1 = doc.holes[0];
  doc.items.push(createTee(h1.id, { x: 160, y: 530 }, "red"));
  doc.style.throwLines = true;
  const map = (patch: Partial<typeof doc.style>) => renderPoster({ ...doc, style: { ...doc.style, ...patch } }, { contours: null, hillshade: null }).svg;
  // (a new course starts Painted; one saved before the looks stays Classic)
  plainExpect(createEmptyCourse().style.lineLook).toBe("painted");
  plainExpect(normalizeCourse({ ...JSON.parse(JSON.stringify(doc)), style: { ...doc.style, lineLook: undefined } }).style.lineLook).toBeUndefined();
  // Classic: white and pure red, dark outlines, no soft shadows
  const classic = map({ lineLook: undefined });
  plainExpect(classic).toContain('stroke="#dc2626"');
  plainExpect(classic).not.toContain("-lsh");
  // Painted: the main line cream, the red tee's line earthy, soft shadows; the red pad edged in cream
  const painted = map({ lineLook: "painted" });
  plainExpect(painted).toContain(`fill="${LINE_CREAM}"`);
  plainExpect(painted).toContain(`stroke="${EARTH.red}"`);
  plainExpect(painted).toContain("-lsh");
  plainExpect(painted).not.toContain('stroke="#dc2626"');
  // Trail: the other tees' lines in dashes
  plainExpect(map({ lineLook: "trail" })).toMatch(new RegExp(`stroke="${EARTH.red}" stroke-width="[\\d.]+" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray`));
  // Each line's own: hidden, dotted, see-through, its own length in its color, another color
  plainExpect(map({ lineLook: "painted", lineStyles: { red: { hidden: true } } })).not.toContain(`stroke="${EARTH.red}" stroke-width`);
  plainExpect(map({ lineLook: "painted", lineStyles: { red: { dash: "dotted" } } })).toMatch(/stroke-dasharray="0 [\d.]+"/);
  plainExpect(map({ lineLook: "painted", lineStyles: { red: { opacity: 0.5 } } })).toContain('<g opacity="0.5">');
  // (its own length: one more length on the map, where the map shows lengths)
  const lengths = (svg: string) => (svg.match(/>\d+'<\/text>/g) ?? []).length;
  plainExpect(lengths(map({ lineLook: "painted", distances: true, lineStyles: { red: { distance: true } } }))).toBe(lengths(map({ lineLook: "painted", distances: true })) + 1);
  plainExpect(lengths(map({ lineLook: "painted", distances: false, lineStyles: { red: { distance: true } } }))).toBe(0);
  plainExpect(map({ lineLook: "painted", lineStyles: { red: { color: "#8844cc" } } })).toContain('stroke="#8844cc"');
  // (Classic with one line set by hand: that line dashed, Classic's own outline round it)
  const classicSet = map({ lineLook: undefined, lineStyles: { red: { dash: "dashed" } } });
  plainExpect(classicSet).toMatch(/stroke="#dc2626" stroke-width="[\d.]+" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray/);
  // Other tees' lines: run beside the main one, the red line is another line, ending by the basket
  const redLine = (svg: string) => [...svg.matchAll(new RegExp(`<path d="([^"]+)" fill="none" stroke="${EARTH.red}" stroke-width`, "g"))].map(m => m[1])[0];
  const joined = redLine(map({ lineLook: "painted" })), beside = redLine(map({ lineLook: "painted", linesMeet: "alongside" }));
  plainExpect(beside).not.toBe(joined);
  const lastOf = (d: string) => { const xy = d.split(/[ML]/).filter(Boolean).pop()!.split(" ").map(Number); return { x: xy[0], y: xy[1] }; };
  const end = lastOf(beside), basket = doc.items.find(i => i.type === "basket" && i.holeId === h1.id)! as { x: number; y: number };
  plainExpect(Math.hypot(end.x - basket.x, end.y - basket.y)).toBeLessThan(60);
  plainExpect(Math.hypot(lastOf(joined).x - basket.x, lastOf(joined).y - basket.y)).toBeGreaterThan(Math.hypot(end.x - basket.x, end.y - basket.y));
});

plain("another tee's line joins the hole's where it runs into it, keeps its own way to the basket where it doesn't, and each layout's line is its own color", () => {
  const doc = sample();
  const h1 = doc.holes[0];
  doc.style.throwLines = true;
  doc.style.lineLook = undefined;
  doc.style.circle = true;
  const basket = doc.items.find(i => i.type === "basket" && i.holeId === h1.id)! as { x: number; y: number };
  const withRed = (x: number, y: number, patch: Partial<typeof doc.style> = {}) => renderPoster({ ...doc, items: [...doc.items, createTee(h1.id, { x, y }, "red")], style: { ...doc.style, ...patch } }, { contours: null, hillshade: null }).svg;
  const redPaths = (svg: string, color = "#dc2626") => [...svg.matchAll(new RegExp(`<path d="([^"]+)" fill="none" stroke="${color}" stroke-width`, "g"))].map(m => m[1].split(/[ML]/).filter(Boolean).map(q => { const [x, y] = q.split(" ").map(Number); return { x, y }; }));
  // Its line runs into the hole's (tee to basket along y = 500): it ends on that line, heading its
  // way, outside the putting circle; the same in every line look
  for (const [look, color] of [[undefined, "#dc2626"], ["painted", EARTH.red], ["trail", EARTH.red]] as const) {
    const [red] = redPaths(withRed(160, 512, { lineLook: look }), color);
    const end = red[red.length - 1], before = red[red.length - 4];
    plainExpect(Math.abs(end.y - 500), String(look)).toBeLessThan(0.6);
    plainExpect(Math.abs(end.y - before.y), String(look)).toBeLessThan(0.3);
    plainExpect(basket.x - end.x, String(look)).toBeGreaterThan(33);
    // (and it starts as the line the tee plays: straight at the basket)
    plainExpect(Math.abs((red[3].y - red[0].y) / (red[3].x - red[0].x) - (500 - 512) / (450 - 160))).toBeLessThan(0.01);
  }
  // A tee with its own way to the basket (off to one side, by it): its line straight there, never
  // bent out to the hole's, with its own arrowhead
  const own = withRed(430, 380);
  const [straight] = redPaths(own);
  for (const q of straight) plainExpect(Math.abs((q.x - 430) * (500 - 380) - (q.y - 380) * (450 - 430)) / Math.hypot(20, 120)).toBeLessThan(0.5);
  // (red shapes: its pad, and the arrowhead of a line of its own)
  const redShapes = (svg: string) => (svg.match(/<polygon points="[^"]*" fill="#dc2626"/g) ?? []).length;
  plainExpect(redShapes(own)).toBe(2);
  plainExpect(redShapes(withRed(160, 512))).toBe(1);
  // A tee on the hole's line, or nearly: no line of its own
  plainExpect(redPaths(withRed(250, 504))).toHaveLength(0);
  // More than one layout (the sample's two): the main line its tee's color, none of them white;
  // one layout: white, as maps had it
  const mainLevel = (doc.items.find(i => i.type === "tee" && i.holeId === h1.id)! as { level: keyof typeof EARTH }).level;
  const lineIn = (svg: string, color: string) => new RegExp(`<path d="[^"]+" fill="none" stroke="${color}" stroke-width`).test(svg);
  const two = renderPoster(doc, { contours: null, hillshade: null }).svg;
  const one = renderPoster({ ...doc, layouts: doc.layouts.slice(0, 1) }, { contours: null, hillshade: null }).svg;
  plainExpect(lineStyleOf(doc.style, "gold", true, true).color).toBe("#e3b505");
  plainExpect(lineStyleOf(doc.style, "gold", true).color).not.toBe("#e3b505");
  plainExpect(lineStyleOf({ ...doc.style, lineLook: "painted" }, "gold", true, true).color).toBe(EARTH.gold);
  plainExpect(lineStyleOf({ ...doc.style, lineLook: "painted" }, "gold", true).color).toBe(LINE_CREAM);
  plainExpect(lineIn(two, lineStyleOf(doc.style, mainLevel, true, true).color)).toBe(true);
  plainExpect(lineIn(one, lineStyleOf(doc.style, mainLevel, true, true).color)).toBe(false);
});

plain("a line's length and a hole's number keep clear of pads, lines and each other; one dragged before stays where it was put", () => {
  const doc = sample();
  const [h1] = doc.holes;
  doc.style.theme = "forest";
  doc.style.throwLines = true;
  doc.style.distances = true;
  // (the map alone, at a set size: 1.5 px to the foot, hole 1 from (100, 500) to (450, 500))
  const view = { cx: 300, cy: 450, rotation: 0, scale: 1.5, width: 900, height: 700 };
  const on = (q: { x: number; y: number }) => ({ x: 450 + (q.x - 300) * 1.5, y: 350 + (q.y - 450) * 1.5 });
  const off = (q: { x: number; y: number }) => ({ x: 300 + (q.x - 450) / 1.5, y: 450 + (q.y - 350) / 1.5 });
  const draw = (d: typeof doc) => renderMapLayers(d, view, { stats: d.holes.map(h => holeStats(d, h)), contours: null, hillshade: null, textScale: 1, fontFamily: d.style.font, labelAt: d.style.labelAt ?? {} }, "t").svg;
  const at = (svg: string, id: string) => { const m = svg.match(new RegExp(`<g data-label="${id}">(?:<g[^>]*>)?<text x="([-\\d.]+)" y="([-\\d.]+)"`))!; return { x: +m[1], y: +m[2] }; };
  const plainMap = draw(doc);
  const len = at(plainMap, `dist:${h1.id}`), num = at(plainMap, `num:${h1.id}`), tee1 = on({ x: 100, y: 500 });
  // (as they always went: the length above its line a little past the middle, the number beside its tee)
  plainExpect(Math.hypot(len.x - on({ x: 292.5, y: 500 }).x, len.y - (on({ x: 0, y: 500 }).y - 9))).toBeLessThan(0.2);
  plainExpect(Math.hypot(num.x - (tee1.x - 4), num.y - (tee1.y - 14))).toBeLessThan(0.2);
  // Another tee's pad right where the length goes: the length takes a clear place by its line
  const pad = createTee(h1.id, off(len), "red");
  const padded = { ...doc, items: [...doc.items, pad] };
  const moved = at(draw(padded), `dist:${h1.id}`);
  plainExpect(dist(moved, len)).toBeGreaterThan(8);
  // (still right by its line: 9 px off it, or a little nearer on its other side)
  plainExpect(Math.abs(moved.y - on({ x: 0, y: 500 }).y)).toBeGreaterThan(7.9);
  plainExpect(Math.abs(moved.y - on({ x: 0, y: 500 }).y)).toBeLessThan(9.2);
  // (one dragged before lengths kept clear: still that far from where it went then; dragged since: from its clear place)
  const key = `dist:${h1.id}`;
  const dragged = (placed?: boolean) => at(draw({ ...padded, style: { ...doc.style, labelAt: { [key]: { dx: 0, dy: -20, placed } } } }), key);
  plainExpect(dist(dragged(), { x: len.x, y: len.y - 30 })).toBeLessThan(0.2);
  plainExpect(dist(dragged(true), { x: moved.x, y: moved.y - 30 })).toBeLessThan(0.2);
  // Another hole's tee right where the number goes: the number moves to its own tee's other side,
  // nearer its own tee than that one, and the two numbers apart
  const h3 = newHole();
  const crowded = { ...doc, holes: [...doc.holes, h3], items: [...doc.items, createTee(h3.id, off(num)), createBasket(h3.id, { x: 100, y: 250 })] };
  const svg = draw(crowded), n1 = at(svg, `num:${h1.id}`), n3 = at(svg, `num:${h3.id}`);
  plainExpect(dist(n1, tee1)).toBeLessThan(dist(n1, num) / 1.2);
  plainExpect(dist(n3, num)).toBeLessThan(dist(n3, tee1) / 1.2);
  plainExpect(dist(n1, n3)).toBeGreaterThan(12);
  // (and no length lies on a number, a pad or another length)
  const l1 = at(svg, `dist:${h1.id}`), l3 = at(svg, `dist:${h3.id}`);
  for (const l of [l1, l3]) for (const q of [n1, n3, tee1, num]) plainExpect(dist(l, q)).toBeGreaterThan(9);
  plainExpect(dist(l1, l3)).toBeGreaterThan(9);
});

test("the Lines tool: Line look, each tee's line set its own way, and where lines meet, on the course map", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  // (a red tee beside the blue one, its line apart from the hole's)
  await page.evaluate(id => {
    const w = window as any;
    const tee = w.__dgCourse().items.find((i: any) => i.type === "tee" && i.holeId === id);
    w.__dgEditor().set({ activeHoleId: id, teeLevel: "red" });
    w.__dgActions.placeAt("add-tee", { x: tee.x + 60, y: tee.y + 120 });
    w.__dgActions.select(null);
  }, hole.id);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "tee").length).toBe(2);
  await page.getByRole("button", { name: "3 Map" }).click();
  const panel = page.getByTestId("drawn-on-map");
  await page.getByRole("button", { name: "Lines", exact: true }).first().click();
  // (its settings with the throw lines on)
  if (!(await course(page)).style.throwLines) await panel.getByText("Throw lines").click();
  const lines = panel.getByTestId("map-lines");
  await expect(lines).toBeVisible();
  // (a new course: Painted)
  await expect(lines.getByTestId("line-look-painted")).toHaveAttribute("aria-checked", "true");
  await lines.getByTestId("line-look-trail").click();
  await expect.poll(async () => (await course(page)).style.lineLook).toBe("trail");
  await lines.getByTestId("line-look-classic").click();
  await expect.poll(async () => (await course(page)).style.lineLook ?? null).toBeNull();
  await lines.getByTestId("line-look-painted").click();
  // The red tee's line: dotted, half see-through, its own length, then hidden, shown and put back
  await lines.getByTestId("line-open-red").click();
  const red = lines.getByTestId("line-settings-red");
  await red.getByRole("radio", { name: "Dotted" }).click();
  await red.getByLabel("Opacity").fill("0.5");
  await red.getByText("Distance", { exact: true }).click();
  await expect.poll(async () => (await course(page)).style.lineStyles?.red).toEqual({ dash: "dotted", opacity: 0.5, distance: true });
  await expect(lines.getByTestId("line-red")).toContainText("Dotted");
  await lines.getByTestId("line-eye-red").click();
  await expect.poll(async () => (await course(page)).style.lineStyles?.red?.hidden).toBe(true);
  await expect(lines.getByTestId("line-red")).toContainText("Hidden");
  await lines.getByTestId("line-eye-red").click();
  await expect.poll(async () => (await course(page)).style.lineStyles?.red?.hidden).toBeUndefined();
  // (Distance on and off again: nothing kept)
  await red.getByText("Distance", { exact: true }).click();
  await expect.poll(async () => (await course(page)).style.lineStyles?.red).toEqual({ dash: "dotted", opacity: 0.5 });
  await red.getByTestId("line-reset").click();
  await expect.poll(async () => (await course(page)).style.lineStyles ?? null).toBeNull();
  // (the main line, blue: no eye to hide it)
  await expect(lines.getByTestId("line-eye-blue")).toHaveCount(0);
  await expect(lines.getByTestId("line-blue")).toContainText("Main");
  // Other tees' lines
  await lines.getByRole("radio", { name: "Run beside it" }).click();
  await expect.poll(async () => (await course(page)).style.linesMeet).toBe("alongside");
});

plain("the course map plays its own layout, kept from Design's when saved before; signs and pages match the painted tee colors", () => {
  const doc = sample();
  doc.style.lineLook = "painted";
  // (two layouts, Design on the second: a course saved before the map had its own keeps that one)
  const raw = JSON.parse(JSON.stringify({ ...doc, activeLayout: "gold" }));
  delete raw.style.mapLayout;
  const kept = normalizeCourse(raw);
  plainExpect(kept.style.mapLayout).toBe("gold");
  // (Design picking another layout doesn't change the map's: the page says the map's own)
  const other = { ...kept, activeLayout: kept.layouts[0].id, style: { ...kept.style, theme: "illustrated" as const } };
  plainExpect(renderPoster(other, { contours: null, hillshade: null }).svg).toContain("· GOLD LAYOUT");
  plainExpect(renderPoster({ ...other, style: { ...other.style, mapLayout: kept.layouts[0].id } }, { contours: null, hillshade: null }).svg).toContain(`· ${kept.layouts[0].name.toUpperCase()} LAYOUT`);
  // (a tee sign's blue tee in the painted blue, deep enough for white lettering; Classic's own blue on one without)
  const h1 = doc.holes[0];
  plainExpect(renderTeeSign(doc, h1.id, "18x12", { contours: null, hillshade: null })!.svg).toContain(`fill="${PRINT_EARTH.blue}"`);
  const classicSign = renderTeeSign({ ...doc, style: { ...doc.style, lineLook: undefined } }, h1.id, "18x12", { contours: null, hillshade: null })!.svg;
  plainExpect(classicSign).not.toContain(PRINT_EARTH.blue);
  plainExpect(classicSign).toContain('fill="#2563eb"');
});

plain("course map: a piece moved or sized by hand doesn't move the map; an older map keeps its fit until one is", () => {
  const doc = sample();
  doc.style.theme = "forest";
  // (the map as drawn: everything up to the next piece on the page)
  const mapPart = (svg: string) => { const at = svg.indexOf('<g data-el="map"'); return svg.slice(at, svg.indexOf('<g data-el="', at + 10)); };
  const mapOf = (x: number, y: number, scale: number, stays?: boolean) => {
    doc.style.page = { title: { x, y, scale } };
    doc.style.mapStays = stays;
    return mapPart(renderPoster(doc, { contours: null, hillshade: null }).svg);
  };
  // (moved and sized by hand, over hole 1's tee: the map the same wherever it is, and as with the title hidden)
  const here = mapOf(0.12, 0.85, 1.4, true);
  plainExpect(mapOf(0.02, 0.02, 0.8, true)).toBe(here);
  doc.style.page = { title: { hidden: true } };
  plainExpect(mapPart(renderPoster(doc, { contours: null, hillshade: null }).svg)).toBe(here);
  // (a map from before: the course still kept clear of the title where it was put)
  plainExpect(mapOf(0.12, 0.85, 1.4)).not.toBe(here);
});

plain("course map page: title, layout chips, holes and credits", () => {
  const doc = sample();
  doc.style.theme = "illustrated";
  doc.style.font = "Oswald";
  doc.style.holeTable = true;
  doc.style.legend = true;
  const p = renderPoster(doc, { contours: null, hillshade: null });
  plainExpect(p.svg.startsWith("<svg")).toBe(true);
  plainExpect(p.svg).toContain("THE HOLLOW DISC GOLF COURSE");
  plainExpect(p.svg).toContain("2 HOLES · PAR 6 · 650 FT");
  plainExpect(p.svg).toContain("LEGEND");
  plainExpect(p.svg).toContain("Out of bounds");
  plainExpect(p.svg).not.toContain("Made with");
  // Forest: full-bleed with "The" split off, the name, and a chip per layout
  doc.style.theme = "forest";
  doc.style.font = "Script";
  const f = renderPoster(doc, { contours: null, hillshade: null });
  plainExpect(f.svg).toContain(">THE<");
  plainExpect(f.svg).toContain(">Hollow<");
  plainExpect(f.svg).toContain("MAIN LAYOUT");
  plainExpect(f.svg).toContain("GOLD LAYOUT");
});

plain("the course map's frame: even on all four sides, or none", () => {
  const doc = sample();
  plainExpect(renderPoster(doc, { contours: null, hillshade: null } as never).svg).not.toContain('data-part="frame"');
  for (const frame of ["mat", "line", "band"] as const) {
    doc.style.frame = frame;
    plainExpect(renderPoster(doc, { contours: null, hillshade: null } as never).svg).toContain('data-part="frame"');
  }
});

plain("tee signs: wide and tall layouts, notes, next hole", () => {
  const doc = sample();
  const wide = renderTeeSign(doc, doc.holes[1].id, "18x12", { contours: null, hillshade: null })!;
  plainExpect(wide.width).toBe(18 * 72);
  plainExpect(wide.svg).toContain("PAR 3");
  // The info column: the length from each tee, the hole notes, the green up close (the small
  // course map is gone from signs), which hole of how many
  plainExpect(wide.svg).toContain(">300 FT<");
  plainExpect(wide.svg).toContain("Creek &amp; beyond OB");
  plainExpect(wide.svg).toContain("HOLE NOTES");
  plainExpect(wide.svg).toContain('data-part="green"');
  plainExpect(wide.svg).not.toContain('data-part="course-map"');
  plainExpect(wide.svg).toContain("HOLE 2 OF 2");
  plainExpect(wide.svg).not.toContain("COURSE MAP<");
  // (the elevation strip under the map: left out while the column has the elevation, until asked for)
  plainExpect(wide.svg).not.toContain("ELEVATION CHANGE FROM TEE");
  doc.style.sign = { layout: { elevationStrip: { hidden: false } } };
  plainExpect(renderTeeSign(doc, doc.holes[1].id, "18x12", { contours: null, hillshade: null })!.svg).toContain("ELEVATION CHANGE FROM TEE");
  // The spot under the notes: the green up close, the hole's numbers, or nothing
  doc.style.sign = { spot: "green" };
  const green = renderTeeSign(doc, doc.holes[1].id, "18x12", { contours: null, hillshade: null })!;
  plainExpect(green.svg).toContain('data-part="green"');
  plainExpect(green.svg).not.toContain('data-part="course-map"');
  doc.style.sign = { spot: "stats" };
  const stats = renderTeeSign(doc, doc.holes[1].id, "18x12", { contours: null, hillshade: null })!;
  plainExpect(stats.svg).toContain('data-part="hole-stats"');
  plainExpect(stats.svg).toContain("TO THE NEXT TEE");
  doc.style.sign = { show: { courseMap: false } };
  const none = renderTeeSign(doc, doc.holes[1].id, "18x12", { contours: null, hillshade: null })!;
  plainExpect(none.svg).not.toContain('data-part="course-map"');
  // Trailhead: the number on its tab, each tee's length on a chip; wide, the spot beside the climb
  doc.style.sign = { look: "trailhead", spot: "green" };
  const trail = renderTeeSign(doc, doc.holes[1].id, "18x12", { contours: null, hillshade: null })!;
  plainExpect(trail.width).toBe(18 * 72);
  plainExpect(trail.svg).toContain('data-part="tee-chip"');
  plainExpect(trail.svg).toContain('data-part="spot-green"');
  plainExpect(trail.svg).toContain("HOLE 2 OF 2");
  const trailTall = renderTeeSign(doc, doc.holes[1].id, "12x18", { contours: null, hillshade: null })!;
  plainExpect(trailTall.svg).toContain('data-part="hole-map"');
  plainExpect(trailTall.svg).not.toContain('data-part="spot-green"');
  // (the hole sheets keep their own page)
  plainExpect(renderTeeSign(doc, doc.holes[1].id, "letter", { contours: null, hillshade: null })!.svg).not.toContain('data-part="tee-chip"');
  doc.style.sign = undefined;
  const first = renderTeeSign(doc, doc.holes[0].id, "12x18", { contours: null, hillshade: null })!;
  plainExpect(first.height).toBe(18 * 72);
  plainExpect(first.svg).toContain("HOLE 2 ·");
});

plain("scorecard like the classic course card: Date, Par, Course; par and lengths; Name and the holes; two to a page; the logo", () => {
  const doc = sample();
  const s = renderScorecard(doc);
  for (const t of [">Name<", "Main (ft)", "Gold (ft)", ">Total<", "+/−", ">Date<", ">Par<", ">Course<", "The Hollow Disc Golf Course"]) plainExpect(s.svg, t).toContain(t);
  // (Par twice on each card: beside Date at the top, and the row over the lengths)
  plainExpect(s.svg.match(/>Par</g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  plainExpect(s.svg).not.toContain("PLAYER");
  // Two cards on the page, a cut line between
  plainExpect(s.svg.match(/data-part="scorecard"/g)).toHaveLength(2);
  plainExpect(s.svg).toContain('stroke-dasharray="6 5"');
  // 18 holes: Front and Back
  for (let i = 0; i < 16; i++) {
    const h = newHole();
    doc.holes.push(h);
    doc.items.push(createTee(h.id, { x: 100 + i * 30, y: 100 }), createBasket(h.id, { x: 100 + i * 30, y: 400 }));
  }
  const s18 = renderScorecard(doc).svg;
  for (const t of [">Front<", ">Back<", ">18<"]) plainExpect(s18, t).toContain(t);
  // The course's logo in place of its name
  doc.style.logo = "data:image/png;base64,iVBORw0KGgo=";
  plainExpect(renderScorecard(doc).svg).toContain('<image href="data:image/png;base64,iVBORw0KGgo="');
});

plain("the best turn for a diagonal course is not north up", () => {
  const doc = createEmptyCourse();
  for (let i = 0; i < 4; i++) {
    const h = newHole();
    doc.holes.push(h);
    doc.items.push(createTee(h.id, { x: 100 + i * 300, y: 1000 - i * 300 }), createBasket(h.id, { x: 300 + i * 300, y: 850 - i * 300 }));
  }
  plainExpect(Math.abs(bestRotation(doc))).toBeGreaterThan(20);
});

plain("creeks and trails wind: straight stretches get bends, the ends stay put", () => {
  const straight = [{ x: 0, y: 0 }, { x: 600, y: 0 }];
  const wound = meander(straight, 12, 80, 7);
  plainExpect(dist(wound[0], straight[0])).toBeLessThan(0.5);
  plainExpect(dist(wound[wound.length - 1], straight[1])).toBeLessThan(0.5);
  const most = Math.max(...wound.map(p => Math.abs(p.y)));
  plainExpect(most).toBeGreaterThan(6);
  plainExpect(most).toBeLessThan(16);
  // A creek already traced point by point (from OpenStreetMap) only wobbles a little
  const traced = Array.from({ length: 61 }, (_, i) => ({ x: i * 10, y: Math.sin(i / 4) * 30 }));
  const kept = meander(traced, 12, 80, 7);
  const moved = Math.max(...kept.map(p => distanceToPath(p, traced)));
  plainExpect(moved).toBeLessThan(5);
});

plain("lines curve through their points, painted exactly where drawn (no wobble); Straight ones go straight", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 0 }, { x: 300, y: 60 }];
  const path = createLine("path", pts);
  const curve = linePath(path);
  plainExpect(curve.length).toBeGreaterThan(pts.length * 4);
  // (through every point it was drawn with)
  for (const p of pts) plainExpect(Math.min(...curve.map(q => dist(p, q)))).toBeLessThan(0.01);
  // Not straight between them: the middle of the first stretch is off the straight line
  const mid = curve.filter(q => q.x > 40 && q.x < 60);
  plainExpect(mid.some(q => Math.abs(q.y - q.x * 0.6) > 2)).toBe(true);
  // The painting follows that curve
  plainExpect(paintedLine(path, 2).points).toEqual(curve);
  // Every kind of line curves (OB lines and fences too); straight on request
  plainExpect(linePath({ ...path, straight: true })).toEqual(pts);
  plainExpect(linePath(createLine("ob", pts))).toEqual(curve);
  plainExpect(curves({ kind: "road" })).toBe(true);
  plainExpect(curves({ kind: "fence" })).toBe(true);
  plainExpect(curves({ kind: "fence", straight: true })).toBe(false);
});

plain("a creek's width along it: its factor at each point, eased between them; kept in step as points are added or taken out", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  const creek = { ...createLine("stream", pts), width: 10, widths: [1, 3, 1] };
  plainExpect(widthVaries(creek)).toBe(true);
  const w = widthAlong(creek);
  plainExpect(w(0)).toBeCloseTo(10, 6);
  plainExpect(w(0.5)).toBeCloseTo(30, 6);
  plainExpect(w(1)).toBeCloseTo(10, 6);
  // (halfway between: halfway in width; steady through each point)
  plainExpect(w(0.25)).toBeCloseTo(20, 6);
  plainExpect(Math.abs(w(0.49) - w(0.5))).toBeLessThan(0.05);
  // Unset, or one factor per point missing: the same all along
  plainExpect(widthAlong({ ...creek, widths: undefined })(0.5)).toBe(10);
  plainExpect(widthAlong({ ...creek, widths: [1, 3] })(0.5)).toBe(10);
  // A point put in after the first: between its neighbours; one at an end, as wide as that end
  plainExpect(widthsWithPoint(creek, 0)).toEqual([1, 2, 3, 1]);
  plainExpect(widthsWithEnd({ ...creek, widths: [2, 1, 1] }, 0)).toEqual([2, 2, 1, 1]);
  plainExpect(widthsWithout(creek, 2)).toEqual([1, 3]);
  // (the wide point taken out: the same all along again)
  plainExpect(widthsWithout(creek, 1)).toBeUndefined();
  plainExpect(widthsWithPoint({ ...creek, widths: undefined }, 0)).toBeUndefined();
  // Made a path for a while: the same path all along, its creek widths kept in step as it is edited
  const path = { ...creek, kind: "path" as const };
  plainExpect(widthVaries(path)).toBe(false);
  plainExpect(widthsWithPoint(path, 0)).toEqual([1, 2, 3, 1]);
  plainExpect(widthsWithEnd(path, 1)).toEqual([1, 3, 1, 1]);
  plainExpect(widthsWithout(path, 0)).toEqual([3, 1]);
});

plain("drawn areas curve round through their corners; rectangles, parking and buildings keep their corners", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const water = createArea("water", pts);
  const curve = areaPath(water);
  plainExpect(curve.length).toBeGreaterThan(pts.length * 4);
  for (const p of pts) plainExpect(Math.min(...curve.map(q => dist(p, q)))).toBeLessThan(0.01);
  // Bulges out between the corners instead of running straight along the side
  plainExpect(Math.min(...curve.map(q => q.y))).toBeLessThan(-2);
  // What gets drawn and painted
  const [drawn] = drawnAreas([water]);
  plainExpect(drawn.type === "area" && drawn.points).toEqual(curve);
  plainExpect(water.points).toEqual(pts);
  for (const kept of [{ ...water, straight: true }, createArea("parking", pts), createArea("building", pts)]) {
    plainExpect(areaPath(kept)).toEqual(pts);
    plainExpect(drawnAreas([kept])[0]).toBe(kept);
  }
});

plain("the painting is made again when anything painted changes (a tree's kind or size, a tee pad), not for a name", () => {
  const doc = createEmptyCourse();
  const h = newHole();
  doc.holes.push(h);
  const tee = createTee(h.id, { x: 100, y: 100 });
  const tree = createTree({ x: 200, y: 200 });
  doc.items.push(tee, tree);
  const key = (d: typeof doc) => JSON.stringify(paintedFrom(d));
  const k0 = key(doc);
  const edit = (id: string, patch: object) => key({ ...doc, items: doc.items.map(i => (i.id === id ? { ...i, ...patch } : i)) as typeof doc.items });
  plainExpect(edit(tree.id, { treeType: "conifer" })).not.toBe(k0);
  plainExpect(edit(tree.id, { width: 1.5 })).not.toBe(k0);
  plainExpect(edit(tree.id, { height: 70 })).not.toBe(k0);
  plainExpect(edit(tee.id, { padLength: 14 })).not.toBe(k0);
  plainExpect(key({ ...doc, holes: [{ ...h, name: "The Gauntlet", par: 4 }] })).toBe(k0);
});

plain("basket marks: five kinds, on the map and in the legend", () => {
  const doc = sample();
  doc.style.legend = true;
  doc.style.theme = "illustrated";
  const seen = new Set<string>();
  for (const mark of BASKET_MARKS.map(m => m.value)) {
    doc.style.basketMark = mark;
    const one = basketMark(mark, { x: 0, y: 0 }, 1, "#f2c94c", "12");
    plainExpect(seen.has(one), mark).toBe(false);
    seen.add(one);
    // Both baskets and the legend's sample carry the mark
    const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
    plainExpect(svg.split(`data-mark="${mark}"`).length - 1, mark).toBe(3);
  }
  // The number mark carries the hole's number
  doc.style.basketMark = "number";
  const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(svg).toMatch(/font-weight="700" font-size="[\d.]+" fill="#1b1d1a">2</);
  // Dark marks keep a light symbol inside (badge on a dark color)
  plainExpect(basketMark("badge", { x: 0, y: 0 }, 1, "#222222")).toContain('stroke="#ffffff"');
});

plain("courses saved before basket marks keep their look; old styles come back as Forest", () => {
  const forest = normalizeCourse({ holes: [], items: [], style: { theme: "forest" } });
  plainExpect(forest.style.basketMark).toBe("basket");
  const topo = normalizeCourse({ holes: [], items: [], style: { theme: "topo" } });
  plainExpect(topo.style.basketMark).toBe("target");
  const chosen = normalizeCourse({ holes: [], items: [], style: { theme: "topo", basketMark: "flag" } });
  plainExpect(chosen.style.basketMark).toBe("flag");
  // The old styles come back as the painted Forest map, in their landscape's colors, keeping what they showed
  const night = normalizeCourse({ holes: [], items: [], style: { theme: "night", landscape: "pines", legend: true, font: "Bitter", fairway: "#2f6b3a", rough: "#16211b" } as any });
  plainExpect(night.style.theme).toBe("forest");
  plainExpect(night.style.rough).toBe("#55703f");
  plainExpect(night.style.legend).toBe(true);
  plainExpect(night.style.font).toBe("Bitter");
});

plain("the wide tee sign's north arrow stands out from its disc in every style", () => {
  const lum = (c: string) => {
    const v = c.startsWith("#") ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    return (0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2]) / 255;
  };
  for (const theme of ["forest", "illustrated", "satellite", "topo", "minimal", "night"] as const) {
    const doc = sample();
    doc.style.theme = theme;
    const sign = renderTeeSign(doc, doc.holes[0].id, "18x12", { contours: null, hillshade: null })!;
    const m = sign.svg.match(/<circle r="[\d.]+" fill="([^"]+)" fill-opacity="0.9"[^>]*\/><path d="M0 [^"]+" fill="([^"]+)"/);
    plainExpect(m, theme).not.toBeNull();
    plainExpect(Math.abs(lum(m![1]) - lum(m![2])), theme).toBeGreaterThan(0.4);
  }
});

plain("features on the printed map: mandos, drop zones, amenity pictograms, OB and hazard tags, red OB edges", () => {
  const doc = sample();
  doc.style.theme = "illustrated";
  doc.style.legend = true;
  const h = doc.holes[0];
  doc.items.push(
    { ...createMando({ x: 280, y: 480 }, h.id, 0), side: "right" },
    createDropZone({ x: 250, y: 560 }, h.id),
    createAmenity({ x: 120, y: 620 }, "restroom"),
    createAmenity({ x: 160, y: 620 }, "here"),
    createArea("hazard", [{ x: 600, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 450 }, { x: 600, y: 450 }])
  );
  const road = { ...createLine("road", [{ x: 0, y: 700 }, { x: 900, y: 700 }]), label: "Park Rd" };
  doc.items.push(road);
  const plainSvg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  for (const sym of ["mando", "dropzone", "restroom", "here"]) {
    // On the map, and its sample in the legend
    plainExpect(plainSvg.split(`data-symbol="${sym}"`).length - 1, sym).toBe(2);
  }
  plainExpect(plainSvg).toContain(">Mando<");
  plainExpect(plainSvg).not.toContain("Mando: pass on the arrow's side");
  plainExpect(plainSvg).toContain(">You are here<");
  plainExpect(plainSvg).toContain(">HAZARD<");
  plainExpect(plainSvg).toContain(">OB<");
  // The road marked OB: red edges along both sides and an OB tag of its own
  const tagsBefore = plainSvg.split(">OB<").length;
  road.ob = true;
  const marked = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(marked.split(">OB<").length).toBe(tagsBefore + 1);
  plainExpect(marked.split(`stroke="${doc.style.ob}" stroke-width`).length).toBeGreaterThan(plainSvg.split(`stroke="${doc.style.ob}" stroke-width`).length + 1);
  // A gate (two paired posts) is one symbol, with its own legend line
  const a = { ...createMando({ x: 380, y: 491 }, h.id, 0), side: "right" as const }, b = { ...createMando({ x: 380, y: 509 }, h.id, 0), side: "left" as const };
  a.pairId = b.id;
  b.pairId = a.id;
  doc.items.push(a, b);
  const gated = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(gated.split('data-symbol="gate"').length - 1).toBe(2);
  plainExpect(gated.split('data-symbol="mando"').length - 1).toBe(2);
  plainExpect(gated).toContain(">Mando gate<");
  plainExpect(gated).not.toContain("Gate: pass between");
});

plain("marking colors: map colors (red OB) or PDGA colors (white OB, red out of play); casual areas in blue", () => {
  const doc = sample();
  doc.style.theme = "illustrated";
  doc.style.legend = true;
  const box = (x: number, y: number) => [{ x, y }, { x: x + 150, y }, { x: x + 150, y: y + 120 }, { x, y: y + 120 }];
  doc.items.push(createArea("ob", box(600, 300)), createArea("nogo", box(600, 500)), createArea("casual", box(100, 600)), createArea("hazard", box(300, 600)));
  const pond = createArea("water", box(800, 600));
  doc.items.push(pond);
  const legendOf = (svg: string) => svg.slice(svg.indexOf("Out of bounds") - 2000);
  const map = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(doc.style.markings).toBe("map");
  plainExpect(map).toContain(">CASUAL<");
  plainExpect(map).toContain(">OUT OF PLAY<");
  plainExpect(map).toContain(">Casual area<");
  plainExpect(map).toContain(">Out of play<");
  plainExpect(map).toContain(">Hazard<");
  plainExpect(map).not.toMatch(/free relief|relief required|one-throw penalty/);
  // A pond is OB by default: its own legend line
  plainExpect(map).toContain("OB water");
  plainExpect(map).toContain(`stroke="${doc.style.ob}" stroke-width`);
  plainExpect(map).toContain('stroke="#7c3aed"');
  plainExpect(map).toContain('stroke="#3b82f6"');
  // PDGA colors: no red OB left, white OB cased dark, red out of play
  doc.style.markings = "pdga";
  const pdga = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(pdga).not.toContain(`stroke="${doc.style.ob}" stroke-width`);
  plainExpect(pdga).not.toContain('stroke="#7c3aed"');
  plainExpect(pdga).toContain('stroke="#e11d2e"');
  plainExpect(pdga).toContain('stroke="#1b1d1a" stroke-opacity="0.9"');
  plainExpect(legendOf(pdga)).toContain('stroke="#ffffff" stroke-width');
  // Not marked OB (the pond, and the sample's creek): no OB water line
  pond.ob = false;
  for (const i of doc.items) if (i.type === "line" && i.kind === "stream") i.ob = false;
  plainExpect(renderPoster(doc, { contours: null, hillshade: null }).svg).not.toContain("OB water");
});

test("choosing PDGA marking colors in the Design step", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await page.getByRole("tab", { name: "General" }).click();
  await expect(page.getByTestId("markings-map")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("markings-pdga").click();
  await expect.poll(async () => (await course(page)).style.markings).toBe("pdga");
  await expect(page.getByTestId("markings-pdga")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).style.markings).toBe("map");
});

plain("elevation on the map: relief exaggerated to suit the course, tidy contour intervals, heights on the bolder contours", () => {
  // A gentle course's rises still show; a steep one isn't overdone
  plainExpect(reliefExaggeration(0.03)).toBeCloseTo(12, 0);
  plainExpect(reliefExaggeration(0.5)).toBe(1.5);
  plainExpect(reliefExaggeration(0.0001)).toBe(14);
  plainExpect(contourInterval(30)).toBe(5);
  plainExpect(contourInterval(110)).toBe(10);
  plainExpect(contourInterval(8)).toBe(1);
  // A slope rising to the east: the topographic style labels the bolder lines with their height
  const doc = sample();
  doc.style.theme = "topo";
  doc.style.contours = true;
  doc.site.baseElevationFt = 1000;
  const heights: Record<string, number> = {};
  for (let x = 0; x <= doc.canvas.width; x += doc.gridSize) for (let y = 0; y <= doc.canvas.height; y += doc.gridSize) heights[`${x},${y}`] = x * 0.1;
  doc.terrainHeights = heights;
  const contours = contoursOf(heights, doc.gridSize, doc.canvas.width, doc.canvas.height);
  const svg = renderPoster(doc, { contours, hillshade: null }).svg;
  const labels = [...svg.matchAll(/>(1\d{3})<\/text>/g)].map(m => Number(m[1]));
  plainExpect(labels.length).toBeGreaterThan(1);
  for (const l of labels) plainExpect(l % contours.interval).toBe(0);
  // In meters when the course is
  doc.units = "m";
  plainExpect(renderPoster(doc, { contours, hillshade: null }).svg).toMatch(/>3\d\d<\/text>/);
});

test("elevation on the Forest map: hills shade the painting, each Elevation look paints its own, contour lines are painted in on request, Hills fine-tunes the relief", async ({ page }) => {
  test.setTimeout(600_000);
  await importSite(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const painting = page.getByTestId("design-page").locator("image").first();
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
  await painted(page);
  const shaded = await painting.getAttribute("href");
  // Elevation off: a different picture (the hill's light and shade gone); each other look its own
  // (in the map's parts, under Light and shadow)
  await page.getByTestId("look-part-elevation").getByRole("button").first().click();
  await page.getByTestId("elevation-off").click();
  await expect.poll(async () => (await course(page)).style.hillshade).toBe(false);
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(shaded);
  const seen = new Set([shaded]);
  for (const look of ["cliffs", "contours", "terraces"]) {
    await page.getByTestId(`elevation-${look}`).click();
    await expect.poll(async () => (await course(page)).style.reliefLook).toBe(look);
    // (a picture of its own: waited for, as on a slow machine the last look's can still be up as
    // the new one starts painting)
    await expect.poll(async () => seen.has(await painting.getAttribute("href")), { timeout: 60_000 }).toBe(false);
    await painted(page);
    seen.add(await painting.getAttribute("href"));
  }
  await page.getByTestId("elevation-shaded").click();
  await expect.poll(async () => (await course(page)).style.reliefLook).toBeUndefined();
  await expect.poll(async () => painting.getAttribute("href")).toBe(shaded);
  // Contour lines: painted into the land, not drawn over it
  await page.getByLabel("Contour lines").check();
  await expect.poll(async () => (await course(page)).style.contours).toBe(true);
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(shaded);
  expect(await page.getByTestId("design-page").locator("path[stroke-linejoin='round'][fill='none'][stroke^='rgba(20,40,10']").count()).toBe(0);
  await page.getByLabel("Contour lines").uncheck();
  await expect.poll(async () => painting.getAttribute("href")).toBe(shaded);
  // Hills: the relief fine-tuned, from flat (the same as no hill shading) to stronger
  // (in the Elevation part, still open)
  const hills = page.getByLabel("Hills");
  await hills.fill("0");
  await hills.dispatchEvent("pointerup");
  await expect.poll(async () => (await course(page)).style.reliefScale).toBe(0);
  await expect(page.getByText("Flat", { exact: true })).toBeVisible();
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(shaded);
  await hills.fill("2");
  await hills.dispatchEvent("pointerup");
  await expect.poll(async () => (await course(page)).style.reliefScale).toBe(2);
  await expect.poll(async () => painting.getAttribute("href")).not.toBe(shaded);
});

test("painted water: a pond is lighter at its rim and in the shallows, deep and dark in the middle", async ({ page }) => {
  test.setTimeout(150_000);
  await blankCourse(page);
  await addHole(page, { x: 150, y: 950 }, { x: 450, y: 950 });
  await page.keyboard.press("Escape");
  // A round pond beside the hole (in the map's frame)
  await page.evaluate(() => {
    const cx = 300, cy = 860;
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: cx + Math.cos((i / 40) * Math.PI * 2) * 70, y: cy + Math.sin((i / 40) * Math.PI * 2) * 70 }));
    (window as any).__dgEditor().set({ areaKind: "water" });
    (window as any).__dgActions.addDrawn("area", pts);
  });
  await page.getByRole("button", { name: "3 Map" }).click();
  await woodsAt(page, "Drawn only");
  const painting = page.getByTestId("design-page").locator("image").first();
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
  await painted(page);
  await page.waitForTimeout(1500);
  // Along the row through the pond's middle (its widest): the water's edge against its middle
  const profile = await page.evaluate(async (url: string) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const all = g.getImageData(0, 0, img.width, img.height).data;
    let best: number[] = [];
    for (let y = 0; y < img.height; y += 2) {
      const water: number[] = [];
      for (let x = 0; x < img.width; x++) {
        const k = (y * img.width + x) * 4, r = all[k], gg = all[k + 1], b = all[k + 2];
        if (b > r + 15 && b > gg - 10) water.push(0.3 * r + 0.59 * gg + 0.11 * b);
      }
      if (water.length > best.length) best = water;
    }
    return best;
  }, (await painting.getAttribute("href"))!);
  expect(profile.length).toBeGreaterThan(100);
  const n = profile.length, mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const rim = mean([...profile.slice(0, Math.round(n * 0.06)), ...profile.slice(n - Math.round(n * 0.06))]);
  const middle = mean(profile.slice(Math.round(n * 0.35), Math.round(n * 0.65)));
  expect(rim).toBeGreaterThan(middle + 12);
});

test("tall grass is painted its own way: lighter, straw-colored tufts, not the grass's dark green; in the legend; its own color", async ({ page }) => {
  test.setTimeout(150_000);
  await blankCourse(page);
  await addHole(page, { x: 150, y: 950 }, { x: 450, y: 950 });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as any).__dgEditor().set({ areaKind: "rough" });
    (window as any).__dgActions.addDrawn("area", [{ x: 150, y: 700 }, { x: 500, y: 700 }, { x: 500, y: 860 }, { x: 150, y: 860 }]);
  });
  await page.getByRole("button", { name: "3 Map" }).click();
  await woodsAt(page, "Drawn only");
  const painting = page.getByTestId("design-page").locator("image").first();
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
  await painted(page);
  await page.waitForTimeout(1500);
  // Straw-green pixels (red near green, both well over blue): the tall grass; the grass and the
  // fairway are much greener
  const straw = (url: string) => page.evaluate(async (u: string) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 1] * 0.86 && d[i] < d[i + 1] * 1.02 && d[i + 1] > d[i + 2] + 25) n++;
    return n / (d.length / 4);
  }, url);
  // (about a quarter of the page here; a few percent without it)
  expect(await straw((await painting.getAttribute("href"))!)).toBeGreaterThan(0.1);
  // Its own color, to set (in the grass's part)
  await page.getByTestId("look-part-grass").getByRole("button", { name: /Grass/ }).first().click();
  await expect(page.getByLabel("Tall grass")).toBeVisible();
});

test("a hole's fairway turned off leaves the painted map: no fairway painted along its line, only the grass", async ({ page }) => {
  test.setTimeout(240_000);
  await blankCourse(page);
  await addHole(page, { x: 150, y: 950 }, { x: 450, y: 950 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await woodsAt(page, "Drawn only");
  const painting = page.getByTestId("design-page").locator("image").first();
  // (the fairway's light, mown green: much brighter than the grass round it)
  const fair = async () => {
    await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
    await painted(page);
    await page.waitForTimeout(1500);
    return page.evaluate(async (u: string) => {
      const img = new Image();
      img.src = u;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const lum = (i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += lum(i);
      const mean = sum / (d.length / 4);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] && d[i + 1] > d[i + 2] && lum(i) > mean + 25) n++;
      return n / (d.length / 4);
    }, (await painting.getAttribute("href"))!);
  };
  const on = await fair();
  expect(on).toBeGreaterThan(0.005);
  const before = await painting.getAttribute("href");
  await page.evaluate(() => { const d = (window as any).__dgCourse(); (window as any).__dgActions.hole(d.holes[0].id, { fairway: false }); });
  await expect(painting).not.toHaveAttribute("href", before!);
  const off = await fair();
  expect(off).toBeLessThan(on * 0.35);
  // The same switch in the Map step: Fairways in the map style lists the holes with one
  await page.getByTestId("part-fairway").click();
  const chip = page.getByTestId("fairway-holes").getByRole("button", { name: "Hole 1" });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  // (its ? says what the numbers do)
  await page.getByTestId("help-show-hide-fairway").click();
  await expect(page.getByTestId("help-tip")).toContainText("hide its fairway");
  await page.keyboard.press("Escape");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  expect((await course(page)).holes[0].fairway).toBe(true);
  // And under the ⋯ of the hole's number picked on the map
  await page.evaluate(() => { const d = (window as any).__dgCourse(); (window as any).__dgEditor().set({ designSel: `label:num:${d.holes[0].id}` }); });
  await page.getByTestId("piece-more").click();
  await page.getByTestId("piece-more-menu").getByLabel("Fairway").uncheck();
  expect((await course(page)).holes[0].fairway).toBe(false);
});

plain("tall grass: in the legend, its color the grass's made lighter and straw yellow unless set", () => {
  const doc = createEmptyCourse();
  doc.style.legend = true;
  doc.items.push(createArea("rough", [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }]));
  const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(svg).toContain(">Tall grass<");
  const tg = tallGrassOf(doc.style);
  plainExpect(tg).not.toBe(doc.style.rough);
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(tg), [r0, g0] = rgb(doc.style.rough);
  plainExpect(r + g + b).toBeGreaterThan(rgb(doc.style.rough).reduce((a, v) => a + v, 0));
  plainExpect(r / g).toBeGreaterThan(r0 / g0);
  plainExpect(tallGrassOf({ ...doc.style, tallGrass: "#123456" })).toBe("#123456");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test("the live preview's painting is smaller on a phone (quicker, lighter on memory)", async ({ page }) => {
    await blankCourse(page);
    await classicLook(page);
    await page.evaluate(() => {
      (window as any).__dgActions.addHole({ x: 300, y: 700 }, { x: 650, y: 700 }, "blue");
      (window as any).__dgEditor().set({ step: "map", tool: "select" });
    });
    const painting = page.getByTestId("design-page").locator("image").first();
    await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/, { timeout: 30_000 });
    const width = await page.evaluate(async (url: string) => { const img = new Image(); img.src = url; await img.decode(); return Math.max(img.width, img.height); }, (await painting.getAttribute("href"))!);
    expect(width).toBeLessThanOrEqual(1500);
    expect(width).toBeGreaterThan(1000);
  });
});

test("the page never freezes while the map paints: it paints between frames, the last picture standing in", async ({ page }) => {
  test.setTimeout(150_000);
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await addHole(page, { x: 700, y: 650 }, { x: 900, y: 350 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const painting = page.getByTestId("design-page").locator("image").first();
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/, { timeout: 60_000 });
  const before = await painting.getAttribute("href");
  // Watch the frames while a new painting is made
  await page.evaluate(() => {
    const w = window as any;
    w.__gaps = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      w.__gaps.push(now - last);
      last = now;
      if (!w.__stopTick) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // (a change that paints the map again: Tree cover, set in Site's Trees)
  await page.evaluate(() => (window as any).__dgActions.style({ treeCover: 0.55 }));
  // The old picture stays up while the new one paints
  await expect.poll(() => page.evaluate(() => (window as any).__dgPainting())).toBe(true);
  expect(await painting.getAttribute("href")).toBe(before);
  await expect.poll(async () => painting.getAttribute("href"), { timeout: 60_000 }).not.toBe(before);
  const gaps = await page.evaluate(() => { (window as any).__stopTick = true; return (window as any).__gaps as number[]; });
  expect(gaps.length).toBeGreaterThan(20);
  // No frame held up for long (a painting all at once took over a second here)
  expect(Math.max(...gaps)).toBeLessThan(400);
});

test("no explainers: the steps' panels and the printed pages say what things are, not how they work", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  const explainers = [/Make the course map beautiful/, /Click a tee spot, then a basket spot/, /A layout plays each hole/, /Quick OB/, /Draw around it/, /Anyone with the link/, /budgets usually run/, /The same sun lights/, /Short on fairways/, /stay clear\. Lone trees/, /Made with/, /PDGA par guidelines/, /Play safe/];
  for (const step of ["1 Site", "2 Design", "3 Map", "4 Export"]) {
    await page.getByRole("button", { name: step }).click();
    // (Design has no side panel: the holes down the map's side)
    const text = (await page.getByTestId(step === "2 Design" ? "holes-column" : "side-panel").textContent()) ?? "";
    for (const e of explainers) expect(text, `${step}: ${e}`).not.toMatch(e);
  }
  // The printed pages: the course map, a tee sign, the scorecard
  for (const tab of ["Course map", "Tee sign", "Scorecard"]) {
    await page.getByRole("button", { name: "3 Map" }).click();
    await page.getByRole("tab", { name: tab }).click();
    const text = (await page.getByTestId("design-page").textContent()) ?? "";
    for (const e of explainers) expect(text, `${tab}: ${e}`).not.toMatch(e);
  }
});

plain("a walk drawn to the next tee takes the automatic walk's place (pure logic)", () => {
  // Three holes: baskets at (400, 500), (500, 150); tees at (100, 500), (500, 450), (800, 150)
  const stats = [
    { holeId: "1", complete: true, line: [{ x: 100, y: 500 }, { x: 400, y: 500 }] },
    { holeId: "2", complete: true, line: [{ x: 500, y: 450 }, { x: 500, y: 150 }] },
    { holeId: "3", complete: true, line: [{ x: 800, y: 150 }, { x: 800, y: 600 }] }
  ];
  const pairs = (items: any[]) => autoWalks(items, stats).map(w => `${w.a.holeId}>${w.b.holeId}`);
  plainExpect(pairs([])).toEqual(["1>2", "2>3"]);
  // A winding walk drawn from hole 1's basket to hole 2's tee: only 2 > 3 is left automatic
  const walk = createLine("walk", [{ x: 410, y: 510 }, { x: 460, y: 560 }, { x: 495, y: 470 }]);
  plainExpect(pairs([walk])).toEqual(["2>3"]);
  // Drawn the other way round, the same
  plainExpect(pairs([{ ...walk, points: [...walk.points].reverse() }])).toEqual(["2>3"]);
  // A walk somewhere else, or a path (not a walk), changes nothing
  plainExpect(pairs([createLine("walk", [{ x: 0, y: 0 }, { x: 50, y: 0 }]), createLine("path", walk.points)])).toEqual(["1>2", "2>3"]);
});

test("trees placed on a fairway are painted where and as they were placed, and the woods add none there", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 500 }, { x: 700, y: 500 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await woodsAt(page, "Drawn only");
  const painting = page.getByTestId("design-page").locator("image").first();
  await expect(painting).toHaveAttribute("href", /^(data:image\/jpeg|blob:)/);
  await painted(page);
  // The share of the land in canopy shade (much darker than the grass)
  const dark = async () => {
    const href = await painting.getAttribute("href");
    return page.evaluate(async (url: string) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 200;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, 300, 200);
      const d = g.getImageData(0, 0, 300, 200).data;
      const l: number[] = [];
      for (let i = 0; i < d.length; i += 4) l.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      const median = [...l].sort((a, b) => a - b)[l.length >> 1];
      return l.filter(v => v < median * 0.62).length / l.length;
    }, href!);
  };
  // Nothing drawn, nothing placed: no trees at all (the woods once stood a few along every fairway)
  expect(await dark()).toBeLessThan(0.002);
  // A big pine placed in the middle of the fairway: there, at its own size
  const before = await painting.getAttribute("href");
  await page.evaluate(() => {
    const e = (window as any).__dgEditor();
    e.set({ treeKind: "conifer" });
    (window as any).__dgActions.placeAt("add-tree", { x: 500, y: 500 });
  });
  const tree = (await course(page)).items.find((i: any) => i.type === "tree");
  expect(tree.treeType).toBe("conifer");
  await expect.poll(() => painting.getAttribute("href"), { timeout: 30_000 }).not.toBe(before);
  const share = await dark();
  // (its crown's share of the land, give or take its shaded side and the page's margins)
  const doc = await course(page);
  const crown = (Math.PI * tree.radius * tree.radius) / (doc.canvas.width * doc.canvas.height);
  expect(share).toBeGreaterThan(crown * 0.3);
});

test("the course map's page edited like Canva: pick, drag, size, style, hide; text added, typed, moved, deleted", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await page.getByRole("button", { name: "3 Map" }).click();
  const svg = page.getByTestId("design-page");
  const style = async () => (await course(page)).style;
  // (Delete on the page with nothing picked never deletes the hole picked on the map)
  await page.keyboard.press("Delete");
  expect((await course(page)).holes).toHaveLength(1);
  await page.getByTestId("page-tool-print-layers").click();
  await page.getByRole("button", { name: "Show Legend" }).click();
  const legend = svg.locator('[data-el="legend"]');
  await expect(legend).toHaveCount(1);
  const box = (await legend.boundingBox())!;
  const pageBox = (await svg.boundingBox())!;
  // Picked by a click: its settings in the toolbar right over it
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await editorState(page)).designSel).toBe("legend");
  await expect(page.getByTestId("page-selection")).toBeVisible();
  await expect(page.getByTestId("piece-toolbar")).toContainText("Legend");
  // Dragged to the middle of the page
  const to = { x: pageBox.x + pageBox.width / 2, y: pageBox.y + pageBox.height / 2 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await style()).page?.legend?.x ?? 0).toBeGreaterThan(0.2);
  expect((await style()).page.legend.x).toBeLessThan(0.7);
  // (the page is drawn again as the painting comes in: measured once it's there)
  await expect.poll(async () => { const b = await legend.boundingBox(); return b ? Math.abs(b.x + b.width / 2 - to.x) : Infinity; }).toBeLessThan(pageBox.width * 0.1);
  // One undo step; then back in place
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await style()).page?.legend?.x).toBeUndefined();
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await style()).page?.legend?.x).toBeTruthy();
  await page.getByTestId("piece-reset").click();
  await expect.poll(async () => (await style()).page?.legend?.x).toBeUndefined();
  // Sized with a corner square
  const corner = page.getByTestId("page-corner").nth(3);
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 80, c.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await style()).page?.legend?.scale ?? 1).toBeGreaterThan(1.1);
  // Its heading, typed on the page; then Delete hides it
  await page.getByTestId("piece-edit-text").click();
  await page.getByTestId("page-typing").fill("Key");
  await page.getByTestId("page-typing").press("Enter");
  await expect(svg).toContainText("KEY");
  await page.keyboard.press("Escape");
  await page.locator('[data-el="legend"]').click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await style()).legend).toBe(false);
  // The hole guide's columns
  await page.getByRole("button", { name: "Show Hole guide" }).click();
  await page.getByTestId("layer").filter({ hasText: "Hole guide" }).click();
  await page.getByTestId("piece-more").click();
  await page.getByTestId("piece-more-menu").getByText("Elevation").click();
  await expect(svg).toContainText("ELEV");
  // The title hidden from its toolbar
  await page.keyboard.press("Escape");
  await page.getByTestId("layer").filter({ hasText: "Title" }).click();
  await page.getByTestId("piece-remove").click();
  await expect.poll(async () => (await style()).page?.title?.hidden).toBe(true);
  await expect(svg.locator('[data-el="title"]')).toHaveCount(0);
  // Text: added, typed, dragged, deleted
  await page.getByTestId("page-tool-print-add").click();
  await page.getByTestId("add-text").click();
  await expect.poll(async () => (await style()).texts?.length ?? 0).toBe(1);
  await page.getByTestId("piece-edit-text").click();
  await page.getByTestId("page-typing").fill("Sponsored by Acme");
  await page.getByTestId("page-typing").press("Enter");
  await expect(svg).toContainText("Sponsored by Acme");
  const t0 = (await style()).texts[0];
  const added = svg.locator(`[data-el="text:${t0.id}"]`);
  await expect(added).toBeVisible();
  await page.waitForTimeout(300);
  const tb = (await added.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2 - 100, tb.y + tb.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await style()).texts[0].x).toBeLessThan(t0.x - 0.02);
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await style()).texts.length).toBe(2);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await style()).texts.length).toBe(1);
  expect((await course(page)).holes).toHaveLength(1);
});

test("the map stays put on the Design page; its labels are dragged, hidden and put back", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const style = async () => (await course(page)).style;
  // (the map isn't one of the things to pick)
  await page.getByTestId("page-tool-print-layers").click();
  await expect(page.getByTestId("layer").first()).toBeVisible();
  await expect(page.getByTestId("layer").filter({ hasText: /^Map$/ })).toHaveCount(0);
  const num = page.getByTestId("design-page").locator(`[data-label="num:${hole.id}"]`);
  await expect(num).toHaveCount(1);
  const b = (await num.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await style()).labelAt?.[`num:${hole.id}`]?.dx ?? 0).not.toBe(0);
  expect((await editorState(page)).designSel).toBe(`label:num:${hole.id}`);
  // Drawn there now
  await expect.poll(async () => { const m = (await num.boundingBox())!; return Math.hypot(m.x + m.width / 2 - from.x - 60, m.y + m.height / 2 - from.y - 40); }).toBeLessThan(10);
  // Back in place; hidden; shown again
  await page.getByTestId("piece-reset").click();
  await expect.poll(async () => (await style()).labelAt?.[`num:${hole.id}`]).toBeUndefined();
  await num.click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await style()).labelAt?.[`num:${hole.id}`]?.hidden).toBe(true);
  await expect(num).toHaveCount(0);
  await page.getByTestId("page-show-labels").click();
  await expect(num).toHaveCount(1);
  expect((await style()).page?.map).toBeUndefined();
});

test("the Design page zooms with Ctrl and the wheel and pans with a press and drag", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const zoom = async () => parseInt((await page.getByTestId("design-zoom").textContent()) ?? "0");
  await expect.poll(zoom).toBeGreaterThan(0);
  const z0 = await zoom();
  const scroller = page.getByTestId("design-scroll");
  const area = (await scroller.boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.6, area.y + area.height * 0.4);
  // (the wheel on its own scrolls the page; with Ctrl it zooms)
  await page.keyboard.down("Control");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await expect.poll(zoom).toBeGreaterThan(z0 * 1.6);
  // Dragged on the map (away from its labels): the page moves under the pointer
  const s0 = await scroller.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  const from = { x: area.x + area.width * 0.5, y: area.y + area.height * 0.25 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 160, from.y - 90, { steps: 8 });
  await page.mouse.up();
  const s1 = await scroller.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  expect(s1.x - s0.x).toBeGreaterThan(100);
  expect(s1.y - s0.y).toBeGreaterThan(50);
  expect((await editorState(page)).designSel).toBeNull();
});

test("zoomed in on the Design page, every edge of the page can be reached: the far left and top too", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await expect.poll(async () => parseInt((await page.getByTestId("design-zoom").textContent()) ?? "0")).toBeGreaterThan(0);
  for (let i = 0; i < 6; i++) await page.getByTestId("map-designer").getByRole("button", { name: "Zoom in", exact: true }).click();
  const scroller = page.getByTestId("design-scroll");
  const edges = async (to: "start" | "end") => {
    await scroller.evaluate((el, to) => {
      el.scrollLeft = to === "start" ? 0 : el.scrollWidth;
      el.scrollTop = to === "start" ? 0 : el.scrollHeight;
    }, to);
    const area = (await scroller.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.left + el.clientWidth, bottom: r.top + el.clientHeight }; }));
    const sheet = (await page.getByTestId("design-page").boundingBox())!;
    return { area, sheet };
  };
  // Scrolled all the way left and up: the page's left and top edges in view
  const start = await edges("start");
  expect(start.sheet.x).toBeGreaterThanOrEqual(start.area.left - 0.5);
  expect(start.sheet.y).toBeGreaterThanOrEqual(start.area.top - 0.5);
  // All the way right and down: its right and bottom edges
  const end = await edges("end");
  expect(end.sheet.x + end.sheet.width).toBeLessThanOrEqual(end.area.right + 0.5);
  expect(end.sheet.y + end.sheet.height).toBeLessThanOrEqual(end.area.bottom + 0.5);
});

plain("tee sign extras: text filled in for each hole, a picture, the hole's sponsors, a QR code; on every hole or the ones picked", () => {
  const doc = sample();
  const [h1, h2] = doc.holes;
  const art = { contours: null, hillshade: null };
  const sign = (id: string) => renderTeeSign(doc, id, "18x12", art)!.svg;
  doc.style.sponsors = [{ id: "s1", name: "Joe's Pizza", text: "JOE'S PIZZA" }, { id: "s2", name: "River Bank", text: "RIVER BANK", holes: [h2.id] }];
  doc.style.sign = { extras: [
    { id: "t", kind: "text", x: 0.1, y: 0.1, w: 0.3, text: "Hole {hole} · par {par}", size: 30 },
    { id: "q", kind: "qr", x: 0.8, y: 0.05, w: 0.1, url: "https://example.org/course" },
    { id: "sp", kind: "sponsors", x: 0.05, y: 0.8, w: 0.3 },
    { id: "only2", kind: "text", x: 0.1, y: 0.3, w: 0.3, text: "Second only", holes: [h2.id] }
  ] };
  const s1 = sign(h1.id), s2 = sign(h2.id);
  plainExpect(s1).toContain('<g data-el="x:t">');
  plainExpect(s1).toMatch(/Hole 1 · par \d/);
  plainExpect(s2).toMatch(/Hole 2 · par \d/);
  plainExpect(s1).toContain('<g data-el="x:q">');
  plainExpect(s1).toContain("HOLE SPONSOR<");
  plainExpect(s1).toContain("JOE'S PIZZA");
  plainExpect(s1).not.toContain("RIVER BANK");
  plainExpect(s2).toContain("HOLE SPONSORS<");
  plainExpect(s2).toContain("RIVER BANK");
  plainExpect(s1).not.toContain("Second only");
  plainExpect(s2).toContain("Second only");
});

plain("a QR code (or anything added) hidden in Layers leaves the page: the course map and the tee signs", () => {
  const doc = sample();
  const art = { contours: null, hillshade: null };
  const qr = { id: "q", kind: "qr" as const, x: 0.8, y: 0.05, w: 0.1, url: "https://example.org/course" };
  doc.style.theme = "forest";
  doc.style.mapExtras = [qr];
  doc.style.sign = { extras: [qr] };
  plainExpect(renderPoster(doc, art).svg).toContain('data-el="x:q"');
  plainExpect(renderTeeSign(doc, doc.holes[0].id, "18x12", art)!.svg).toContain('data-el="x:q"');
  doc.style.mapExtras = [{ ...qr, hidden: true }];
  doc.style.sign = { extras: [{ ...qr, hidden: true }] };
  plainExpect(renderPoster(doc, art).svg).not.toContain('data-el="x:q"');
  plainExpect(renderTeeSign(doc, doc.holes[0].id, "18x12", art)!.svg).not.toContain('data-el="x:q"');
});

plain("one sponsor on its own: placed by itself, only on its own holes", () => {
  const doc = sample();
  const [h1, h2] = doc.holes;
  const art = { contours: null, hillshade: null };
  doc.style.sponsors = [{ id: "s1", name: "Joe's Pizza", text: "JOE'S PIZZA", holes: [h2.id] }];
  doc.style.sign = { extras: [{ id: "one", kind: "sponsor", sponsorId: "s1", x: 0.1, y: 0.8, w: 0.15 }] };
  plainExpect(renderTeeSign(doc, h1.id, "18x12", art)!.svg).not.toContain("JOE'S PIZZA");
  const s2 = renderTeeSign(doc, h2.id, "18x12", art)!.svg;
  plainExpect(s2).toContain('<g data-el="x:one">');
  plainExpect(s2).toContain("JOE'S PIZZA");
});

plain("the scorecard's pieces placed by hand (both cards alike), with what's added on both", () => {
  const doc = sample();
  doc.style.scorecard = { layout: { table: { dy: 0.05 } }, extras: [{ id: "q", kind: "qr", x: 0.85, y: 0.05, w: 0.08, url: "https://example.org" }], players: 3 };
  const svg = renderScorecard(doc).svg;
  plainExpect(svg).toContain('<g data-el="table" transform="translate(0 15.3) scale(1)">');
  plainExpect(svg).toContain('<g data-pc="table" transform="translate(0 15.3) scale(1)">');
  plainExpect(svg).toContain('<g data-el="x:q">');
  plainExpect(svg).toContain('<g data-pc="x:q">');
});

plain("fonts are the same everywhere: the map's lettering and the headings take any font, a script keeps its own capitals", () => {
  const doc = sample();
  doc.style.font = "Bebas Neue";
  doc.style.card = { font: "Pacifico" };
  const sign = renderTeeSign(doc, doc.holes[0].id, "18x12", { contours: null, hillshade: null })!.svg;
  plainExpect(sign).toContain("'Bebas Neue'");
  plainExpect(sign).toContain("'Pacifico'");
  // (lettering with a width to keep inside)
  plainExpect(sign).toContain("data-fit=");
});

plain("hole pages: pieces placed by hand, and Just the hole (its picture across the page, its number, the rest a click away)", () => {
  const doc = sample();
  const [h1] = doc.holes;
  const art = { contours: null, hillshade: null };
  const page = () => renderHolePage(doc, h1.id, "letter", art)!.svg;
  plainExpect(page()).toContain('<g data-el="par">');
  doc.style.holePage = { layout: { par: { dx: 0.1, dy: 0, scale: 1 } } };
  plainExpect(page()).toContain('<g data-el="par" transform="translate(61.2 0) scale(1)">');
  doc.style.holePage = { look: "justhole" };
  const just = page();
  plainExpect(just).toContain('<g data-el="map">');
  plainExpect(just).toContain('<g data-el="number">');
  plainExpect(just).not.toContain(">PAR ");
  plainExpect(just).not.toContain("HOLE NOTES");
  // The par brought back
  doc.style.holePage = { look: "justhole", layout: { par: { hidden: false } } };
  plainExpect(page()).toContain(">PAR ");
});

plain("tee sign pieces: moved, sized, restyled or hidden, for every hole or one hole's own, on every look", () => {
  const doc = sample();
  const [h1, h2] = doc.holes;
  const art = { contours: null, hillshade: null };
  const sign = (id: string) => renderTeeSign(doc, id, "18x12", art)!.svg;
  plainExpect(sign(h1.id)).toContain('<g data-el="number">');
  // Moved half the page across and a quarter down, twice its size; the par hidden; the name restyled
  doc.style.sign = { layout: { number: { dx: 0.5, dy: 0.25, scale: 2 }, par: { hidden: true }, courseName: { font: "Bitter", color: "#ff0000" } } };
  const s1 = sign(h1.id);
  plainExpect(s1).toContain('<g data-el="number" transform="translate(648 216) scale(2)">');
  plainExpect(s1).not.toContain(">PAR ");
  plainExpect(s1).toContain("fill:#ff0000 !important");
  plainExpect(s1).toContain("font-family:Bitter");
  // One hole's own: hole 2 keeps its par
  h2.sign = { layout: { par: {} } };
  plainExpect(sign(h2.id)).toContain(">PAR ");
  plainExpect(sign(h1.id)).not.toContain(">PAR ");
  // Every look has its pieces
  for (const look of ["trailhead", "fieldguide", "openview"] as const) {
    doc.style.sign = { look, layout: { number: { dx: 0.1 } } };
    plainExpect(sign(h1.id)).toContain('<g data-el="number" transform="translate(129.6 0) scale(1)">');
    plainExpect(sign(h1.id)).toContain('<g data-el="map"');
  }
});

plain("tee signs: other holes faded, left out or shown; each part shown or left out, for all holes or one hole's own", () => {
  const doc = sample();
  const [h1, h2] = doc.holes;
  const art = { contours: null, hillshade: null };
  const sign = (id: string, size: "18x12" | "12x18" = "18x12") => renderTeeSign(doc, id, size, art)!.svg;
  // (Classic's pure blue pads, to count them by)
  doc.style.lineLook = undefined;
  // Other holes faded by default (as much as asked), shown as clear, or left out (their tees gone)
  const blue = (svg: string) => (svg.match(/<polygon points="[^"]*" fill="#2563eb"/g) ?? []).length;
  const allTees = blue(sign(h1.id));
  plainExpect(allTees).toBeGreaterThan(0);
  plainExpect(sign(h1.id)).toContain('opacity="0.3"');
  doc.style.sign = { fade: 0.15 };
  plainExpect(sign(h1.id)).toContain('opacity="0.15"');
  doc.style.sign = { others: "shown" };
  plainExpect(sign(h1.id)).not.toContain('opacity="0.15"');
  doc.style.sign = { others: "hidden" };
  plainExpect(blue(sign(h1.id))).toBe(allTees / 2);
  // Parts left out for every hole: the par and the course's name
  doc.style.sign = { show: { par: false, courseName: false } };
  for (const id of [h1.id, h2.id]) {
    plainExpect(sign(id)).not.toContain(">PAR ");
    plainExpect(sign(id)).not.toContain("THE HOLLOW");
    plainExpect(sign(id, "12x18")).not.toContain(">PAR ");
  }
  // One hole's own: the par back on hole 2 only
  h2.sign = { show: { par: true } };
  plainExpect(sign(h2.id)).toContain(">PAR ");
  plainExpect(sign(h1.id)).not.toContain(">PAR ");
});

test("while the Design preview paints, a bar shows how far along it is, gone when it is done", async ({ page }) => {
  test.setTimeout(180_000);
  await blankCourse(page);
  await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  const bar = page.getByTestId("paint-progress");
  await expect(bar).toBeVisible({ timeout: 20_000 });
  await expect(bar).toContainText("Painting the map");
  const first = Number(await bar.getAttribute("aria-valuenow"));
  await expect.poll(async () => Number((await bar.getAttribute("aria-valuenow").catch(() => null)) ?? 100), { timeout: 90_000 }).toBeGreaterThan(first);
  await expect(bar).toBeHidden({ timeout: 150_000 });
});

test("tee sign settings: one hole's own given to the holes picked (Apply to holes), and back to the settings for all holes", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 500 }, { x: 700, y: 500 });
  await addHole(page, { x: 300, y: 700 }, { x: 700, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Map" }).click();
  await page.getByRole("tab", { name: "Tee sign" }).click();
  const panel = page.getByTestId("sign-settings");
  const scope = page.getByTestId("change-scope");
  await scope.getByRole("radio", { name: /^Hole \d+ only/ }).click();
  await panel.getByRole("radio", { name: "Hidden" }).click();
  const signs = async () => (await course(page)).holes.map((h: any) => h.sign?.others);
  await expect.poll(signs).toContain("hidden");
  const own = (await signs()).indexOf("hidden");
  await panel.getByTestId("sign-apply").getByRole("button", { name: "Apply to holes…" }).click();
  await page.getByTestId("apply-holes").getByRole("button", { name: "All holes" }).click();
  await page.getByTestId("apply-holes").getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(signs).toEqual(["hidden", "hidden"]);
  // From Every hole: the holes with their own sign, one of them put back to the every-hole sign
  await scope.getByRole("radio", { name: "Every hole" }).click();
  await expect(panel.getByTestId("sign-apply")).toHaveCount(0);
  const ownHoles = panel.getByTestId("sign-own");
  await ownHoles.getByRole("button", { name: "Holes with their own sign (2)…" }).click();
  await ownHoles.getByRole("button", { name: own === 0 ? "Hole 2" : "Hole 1" }).click();
  await ownHoles.getByRole("button", { name: "Back to every hole's sign" }).click();
  await expect.poll(async () => (await course(page)).holes[own === 0 ? 1 : 0].sign).toBeUndefined();
  expect((await course(page)).holes[own].sign?.others).toBe("hidden");
});

test("a scale bar can't be sized by hand on any printout (it would measure wrong); it follows a sign's picture when that's sized", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  // (a tall sign: the wide one has no scale bar)
  await page.evaluate(() => (window as any).__dgActions.style({ scale: true, signSize: "12x18" }));
  for (const tab of ["map", "sign"]) {
    await page.evaluate(tab => (window as any).__dgEditor().set({ step: "map", designTab: tab, designSel: null }), tab);
    await expect(page.getByTestId("design-page").locator("[data-el=scale]")).toBeAttached();
    await page.evaluate(() => (window as any).__dgEditor().set({ designSel: "scale" }));
    await expect(page.getByTestId("piece-toolbar")).toBeVisible();
    await expect(page.getByTestId("piece-size")).toHaveCount(0);
    await expect(page.getByTestId("page-corner")).toHaveCount(0);
    // (moving it still works)
    await expect(page.getByTestId("page-turn")).toBeVisible();
  }
  // The sign's picture made twice as big: its scale bar's distance halves
  const label = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=design-page] [data-el=scale] text")].map(t => t.textContent).join(" "));
  const before = await label();
  await page.evaluate(() => { const d = (window as any).__dgCourse(); (window as any).__dgActions.style({ sign: { ...(d.style.sign ?? {}), layout: { ...(d.style.sign?.layout ?? {}), map: { scale: 2 } } } }); });
  await expect.poll(label).not.toBe(before);
});
