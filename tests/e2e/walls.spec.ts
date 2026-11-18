// Walls: drawn with the Build tool as a line, so a wall works as a fence does (OB, curved, a
// stretch taken out). It stands on the ground all along, dry stone or mortared. Walls from before
// (a Rock wall, a built wall) stay as they were, with a button that makes them the new wall. And
// steep ground's bare rock: a click picks it, and its panel sets its stone.
import { test, expect, blankCourse, clickPlan, course, editorState, screenOf, tapPlan } from "./fixtures";
import { test as plain, expect as plainExpect, devices } from "@playwright/test";
import { createBasket, createEmptyCourse, createTee, newHole } from "../../src/lib/course";
import { THEMES, renderPoster } from "../../src/lib/mapSvg";
import { wallRun } from "../../src/lib/wallJoin";
import { ROCK_STONES, STONE_ORDER, stoneShown } from "../../src/constants";
import type { LineItem, MapTheme } from "../../src/types";

type Page = import("@playwright/test").Page;
const walls = async (page: Page) => (await course(page)).items.filter((i: any) => i.type === "line" && i.kind === "wall") as LineItem[];
/** A mound 80 ft high with steep sides, in the middle of the first 30 squares. */
const mound = (page: Page, style: Record<string, unknown> = {}) => page.evaluate(style => {
  const w = window as any, d = w.__dgCourse(), g = d.gridSize, mid = 15 * g, th: Record<string, number> = {};
  for (let x = 0; x <= 30 * g; x += g) for (let y = 0; y <= 30 * g; y += g) th[x + "," + y] = 80 * Math.max(0, Math.min(1, (110 - Math.hypot(x - mid, y - mid)) / 60));
  // (a step of its own, so Undo later goes back to this and no further)
  w.__dgStore.getState().change(() => ({ terrainHeights: th, style: { ...d.style, forest: "woods", ...style } }));
  return mid as number;
}, style);
/** The wall in 3D: how many stretches it's built in, what it's made of, and how far its solid
 * shape's corners are above or below the ground under them (ft). */
const wallIn3d = (page: Page, id: string) => page.evaluate(id => {
  const v = (window as any).__dgView, out = { stretches: 0, parts: [] as string[], low: 0, high: 0 };
  v.scene.traverse((o: any) => {
    if (o.name !== `line:${id}`) return;
    o.traverse((m: any) => {
      if (m.isLOD) out.stretches++;
      if (m.isMesh && !out.parts.includes(m.name)) out.parts.push(m.name);
      if (m.isMesh && m.name === "solid") {
        const p = m.geometry.attributes.position, at = m.parent.position;
        for (let i = 0; i < p.count; i++) { const up = p.getY(i) + at.y - v.h(p.getX(i) + at.x, p.getZ(i) + at.z); out.low = Math.min(out.low, up); out.high = Math.max(out.high, up); }
      }
    });
  });
  return out;
}, id);

test("a wall drawn with the Build tool is a line: it stands on the ground over a hill, dry stone or mortared, and takes OB and a gap as a fence does", async ({ page }) => {
  await blankCourse(page);
  const mid = await mound(page);
  await page.keyboard.press("s");
  await page.getByTestId("line-kind-wall").click();
  expect((await editorState(page)).tool).toBe("draw-line");
  // (from flat ground, over the mound's top and down the other side)
  await clickPlan(page, mid - 180, mid);
  await clickPlan(page, mid + 180, mid);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await walls(page)).length).toBe(1);
  const w = (await walls(page))[0];
  expect(w.seed).toBeGreaterThan(0);
  expect([w.wallStyle, w.stone, w.width, w.fenceHeight]).toEqual([undefined, undefined, undefined, undefined]);
  await page.evaluate(id => (window as any).__dgActions.select(id), w.id);
  await expect(page.getByTestId("inspector-title")).toHaveText("Wall");
  // In 3D: built in stretches, each a solid shape from far off; its foot in the ground and its top
  // the wall's height (3 ft) above it all along, 80 ft up the mound and down again
  await expect.poll(async () => (await wallIn3d(page, w.id)).stretches).toBe(9);
  const dry = await wallIn3d(page, w.id);
  expect(dry.parts).toContain("solid");
  expect(dry.low).toBeGreaterThan(-2.5);
  expect(dry.low).toBeLessThan(-0.2);
  expect(dry.high).toBeGreaterThan(2.4);
  expect(dry.high).toBeLessThan(3.4);
  // Its panel: what it is, its stone, how thick and how tall
  await page.getByTestId("wall-stone").getByRole("radio", { name: "Granite", exact: true }).click();
  await expect.poll(async () => (await walls(page))[0].stone).toBe("granite");
  await page.getByRole("slider", { name: "Thickness" }).fill("3");
  await expect.poll(async () => (await walls(page))[0].width).toBe(3);
  await page.getByRole("slider", { name: "Height" }).fill("4");
  await expect.poll(async () => (await walls(page))[0].fenceHeight).toBe(4);
  await expect.poll(async () => (await wallIn3d(page, w.id)).high).toBeGreaterThan(3.4);
  await page.getByTestId("wall-new-shape").click();
  await expect.poll(async () => (await walls(page))[0].seed).not.toBe(w.seed);
  await page.getByTestId("wall-style").getByRole("radio", { name: "Mortared" }).click();
  await expect.poll(async () => (await walls(page))[0].wallStyle).toBe("mortared");
  await expect(page.getByTestId("wall-stone")).toHaveCount(0);
  await expect(page.getByTestId("wall-new-shape")).toHaveCount(0);
  await expect.poll(async () => (await wallIn3d(page, w.id)).parts).toEqual(["stone"]);
  await page.getByTestId("wall-style").getByRole("radio", { name: "Dry stone" }).click();
  await expect.poll(async () => (await walls(page))[0].wallStyle).toBeUndefined();
  // As a fence: OB, straight between its points, and a stretch taken out (two walls left)
  await page.getByTestId("ob-choice").getByRole("radio", { name: "OB", exact: true }).click();
  await expect.poll(async () => (await walls(page))[0].ob).toBe(true);
  await page.getByRole("checkbox", { name: "Curved" }).uncheck();
  await expect.poll(async () => (await walls(page))[0].straight).toBe(true);
  await page.getByTestId("line-cut").click();
  await expect(page.getByTestId("ob-pick-bar")).toContainText("Remove a stretch");
  await clickPlan(page, mid - 140, mid);
  await clickPlan(page, mid - 110, mid);
  await expect.poll(async () => (await walls(page)).length).toBe(2);
  const [a, b] = await walls(page);
  expect(Math.abs(a.points[a.points.length - 1].x - (mid - 140))).toBeLessThan(10);
  expect(Math.abs(b.points[0].x - (mid - 110))).toBeLessThan(10);
  // (both still granite, OB and 4 ft)
  expect([b.stone, b.ob, b.fenceHeight]).toEqual(["granite", true, 4]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await walls(page)).length).toBe(1);
  // Made a fence, it's a fence: nothing of the wall's left on it
  await page.evaluate(id => (window as any).__dgActions.select(id), w.id);
  await page.getByRole("radiogroup", { name: "Line kind" }).getByRole("radio", { name: "Fence" }).click();
  await expect.poll(async () => { const l = (await course(page)).items.find((i: any) => i.id === w.id); return [l.kind, l.stone, l.seed, l.width]; }).toEqual(["fence", undefined, undefined, undefined]);
});

test("walls from before stay as they were: a built wall and a rock wall each change to the new wall with one button, in one undo step", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => {
    const w = window as any, d = w.__dgCourse();
    w.__dgStore.getState().change(() => ({ items: [...d.items,
      { id: "built", type: "structure", kind: "wall", points: [{ x: 300, y: 300 }, { x: 380, y: 300 }, { x: 380, y: 360 }], x: 353, y: 320, rotation: 0, width: 2.5, height: 5, label: "Old wall" },
      { id: "rockwall", type: "rock", kind: "wall", stone: "sandstone", x: 500, y: 400, rotation: 90, length: 30, width: 2, height: 2.5, moss: 0.5, seed: 9 },
      { id: "boulder", type: "rock", kind: "boulder", stone: "granite", x: 600, y: 300, rotation: 0, length: 6, width: 5, height: 4, seed: 1 }
    ] }));
  });
  await page.keyboard.press("v");
  const item = async (id: string) => (await course(page)).items.find((i: any) => i.id === id);
  // The built wall: as it was (a built thing, mortared blocks), until its button is pressed
  await page.evaluate(() => (window as any).__dgActions.select("built"));
  await expect(page.getByTestId("inspector-title")).toHaveText("Wall");
  await expect(page.getByTestId("old-wall")).toContainText("This is an older wall");
  expect((await item("built")).type).toBe("structure");
  await page.getByTestId("to-line-wall").click();
  await expect.poll(async () => (await item("built")).type).toBe("line");
  const b = await item("built");
  expect([b.kind, b.wallStyle, b.width, b.fenceHeight, b.straight, b.label, b.points.length]).toEqual(["wall", "mortared", 2.5, 5, true, "Old wall", 3]);
  expect((await editorState(page)).selectedId).toBe("built");
  await expect(page.getByTestId("wall-style")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await item("built")).type).toBe("structure");
  // The rock wall: its ends where they were (30 ft, pointing down the map), its stone and moss kept
  await page.evaluate(() => (window as any).__dgActions.select("rockwall"));
  await expect(page.getByTestId("old-wall")).toContainText("This wall stays level");
  await page.getByTestId("to-line-wall").click();
  await expect.poll(async () => (await item("rockwall")).type).toBe("line");
  const r = await item("rockwall");
  expect([r.kind, r.wallStyle, r.stone, r.moss, r.seed, r.width, r.fenceHeight]).toEqual(["wall", undefined, "sandstone", 0.5, 9, 2, 2.5]);
  expect(r.points.map((p: any) => [Math.round(p.x), Math.round(p.y)])).toEqual([[500, 385], [500, 415]]);
  // A rock can no longer be made a rock wall: walls are drawn with Build
  await page.evaluate(() => (window as any).__dgActions.select("boulder"));
  await expect(page.getByTestId("rock-kind").getByRole("radio", { name: "Block" })).toBeVisible();
  await expect(page.getByTestId("rock-kind").getByRole("radio", { name: "Rock wall" })).toHaveCount(0);
  await page.keyboard.press("j");
  await expect(page.getByTestId("rock-kind-boulder")).toBeVisible();
  await expect(page.getByTestId("rock-kind-wall")).toHaveCount(0);
});

test.describe("steep rock", () => {
test.use({ viewport: { width: 1280, height: 720 } });
test("steep ground's bare rock: the pointer over it lights its edge, a click picks it, its panel sets its stone, and picking anything else puts it away", async ({ page }) => {
  await blankCourse(page);
  // (the test machine has no graphics card, and without one steep rock isn't drawn: drawn here
  // as a computer with one draws it, at the coarsest level and on a small window, so the tests
  // running beside this one keep their share of the machine)
  test.setTimeout(180_000);
  await page.evaluate(() => { const v = (window as any).__dgView; v.software = false; v.setTier(4); });
  const mid = await mound(page, { steepRock: 40 });
  await page.keyboard.press("v");
  const view = () => page.evaluate(() => { const v = (window as any).__dgView; return { hover: !!v.steepHover, picked: !!v.steepPicked }; });
  // (the mound's east side: 53° steep)
  const cliff = await screenOf(page, mid + 80, mid), flat = await screenOf(page, mid + 300, mid);
  await page.mouse.move(flat.x, flat.y);
  await page.mouse.move(cliff.x, cliff.y);
  await expect.poll(async () => (await view()).hover).toBe(true);
  await page.mouse.move(flat.x, flat.y);
  await expect.poll(async () => (await view()).hover).toBe(false);
  // A click on flat ground picks nothing; on the rock, the rock
  await page.mouse.click(flat.x, flat.y);
  await expect(page.getByTestId("steep-rock-settings")).toHaveCount(0);
  await page.mouse.click(cliff.x, cliff.y);
  await expect(page.getByTestId("inspector-title")).toHaveText("Steep rock");
  await expect.poll(async () => (await view()).picked).toBe(true);
  // Its stone: the cliff's own brown until one is picked, and back again
  const stone = page.getByTestId("steep-rock-settings").getByTestId("steep-stone");
  await expect(stone.getByRole("radio", { name: "Brown cliff" })).toBeChecked();
  await stone.getByRole("radio", { name: "Granite", exact: true }).click();
  await expect.poll(async () => (await course(page)).style.steepStone).toBe("granite");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).style.steepStone).toBeUndefined();
  await stone.getByRole("radio", { name: "Basalt" }).click();
  await stone.getByRole("radio", { name: "Brown cliff" }).click();
  await expect.poll(async () => (await course(page)).style.steepStone).toBeUndefined();
  // Put away by its close button, by a click elsewhere, and by picking a tool
  await page.getByTestId("inspector").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("steep-rock-settings")).toHaveCount(0);
  await expect.poll(async () => (await view()).picked).toBe(false);
  await page.mouse.click(cliff.x, cliff.y);
  await expect(page.getByTestId("steep-rock-settings")).toBeVisible();
  await page.mouse.click(flat.x, flat.y);
  await expect(page.getByTestId("steep-rock-settings")).toHaveCount(0);
  await page.mouse.click(cliff.x, cliff.y);
  await expect(page.getByTestId("steep-rock-settings")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("steep-rock-settings")).toHaveCount(0);
  await page.mouse.click(cliff.x, cliff.y);
  await expect(page.getByTestId("steep-rock-settings")).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("v");
  await expect(page.getByTestId("steep-rock-settings")).toHaveCount(0);
  // With steep rock off (as a course from before has it), there's none to pick
  await page.evaluate(() => (window as any).__dgActions.style({ steepRock: undefined }));
  // (once the view has drawn it so: the click picks what is on screen)
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.ground.detail.steepCos.value)).toBe(0);
  await page.mouse.click(cliff.x, cliff.y);
  await expect(page.getByTestId("steep-rock-settings")).toHaveCount(0);
});
});

test.describe("on a phone", () => {
  // (a Playwright phone in Chromium: the device list's iPhones say WebKit)
  const { defaultBrowserType: _browser, ...iphone } = devices["iPhone 13"];
  // (one screen dot a point: a third of the drawing, on a machine that draws without a graphics card)
  test.use({ ...iphone, deviceScaleFactor: 1 });
  test("a wall's bar has its settings in its panel's order, and steep rock tapped has a bar of its own", async ({ page }) => {
    test.setTimeout(180_000);
    await page.getByTestId("welcome-blank").click();
    await page.evaluate(() => { const v = (window as any).__dgView; v.software = false; v.setTier(4); });
    const mid = await mound(page, { steepRock: 40 });
    await page.evaluate(mid => {
      const w = window as any, d = w.__dgCourse();
      w.__dgStore.getState().change(() => ({ items: [...d.items, { id: "w1", type: "line", kind: "wall", points: [{ x: mid - 150, y: mid + 180 }, { x: mid + 150, y: mid + 180 }], x: mid, y: mid + 180, rotation: 0, seed: 3 }] }));
      w.__dgEditor().set({ tool: "select" });
      w.__dgView.fitBounds({ minX: mid - 200, minY: mid - 200, maxX: mid + 200, maxY: mid + 260 }, { animate: false });
      w.__dgActions.select("w1");
    }, mid);
    const strip = page.getByTestId("item-strip");
    await expect(strip).toBeVisible();
    const ids = () => strip.locator("[data-setting]").evaluateAll(els => els.map(e => e.getAttribute("data-setting")));
    expect((await ids()).slice(0, 6)).toEqual(["kind", "wall", "stone", "width", "height", "ob"]);
    expect(await ids()).toEqual(expect.arrayContaining(["curved", "cut", "moss", "lichen", "newshape"]));
    await strip.getByTestId("strip-wall").tap();
    await page.getByTestId("bar-menu").getByRole("radio", { name: "Mortared" }).tap();
    await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === "w1").wallStyle).toBe("mortared");
    await expect.poll(async () => (await ids()).filter(i => ["stone", "moss", "lichen", "newshape"].includes(i!))).toEqual([]);
    // Steep rock: a tap on it, its bar (its stone and how steep), put away with its check mark
    await page.evaluate(() => (window as any).__dgActions.select(null));
    await expect(strip).toHaveCount(0);
    await tapPlan(page, mid + 80, mid);
    const steep = page.getByTestId("steep-strip");
    await expect(steep).toBeVisible();
    expect(await steep.locator("[data-setting]").evaluateAll(els => els.map(e => e.getAttribute("data-setting")))).toEqual(["stone", "steep"]);
    await steep.getByTestId("strip-stone").tap();
    await page.getByTestId("bar-menu").getByRole("radio", { name: "Sandstone" }).tap();
    await expect.poll(async () => (await course(page)).style.steepStone).toBe("sandstone");
    await steep.getByTestId("bar-done").tap();
    await expect(steep).toHaveCount(0);
  });
});

plain("a wall drawn up to another stops at its face, and two walls from one corner join: one runs through, the other stops against it", () => {
  const wall = (id: string, points: { x: number; y: number }[]): LineItem => ({ id, type: "line", kind: "wall", points, x: 0, y: 0, rotation: 0, straight: true });
  const a = wall("a", [{ x: 0, y: 0 }, { x: 100, y: 0 }]), b = wall("b", [{ x: 50, y: 0 }, { x: 50, y: 40 }]), c = wall("c", [{ x: 100, y: 0 }, { x: 100, y: 40 }]);
  const items = [a, b, c];
  // (b meets a's middle: it starts a few inches inside a's face, a foot from a's line, laid as a run)
  const rb = wallRun(b, b.points, items);
  plainExpect(rb.butt).toEqual([true, false]);
  plainExpect(rb.pts[0].y).toBeGreaterThan(0.7);
  plainExpect(rb.pts[0].y).toBeLessThan(1.01);
  plainExpect(rb.pts[1]).toEqual({ x: 50, y: 40 });
  // (a and c share a corner: a, the first of them, runs on through c's thickness; c stops against it)
  const ra = wallRun(a, a.points, items), rc = wallRun(c, c.points, items);
  plainExpect(ra.butt).toEqual([false, false]);
  plainExpect(ra.pts[1].x).toBeCloseTo(101, 3);
  plainExpect(rc.butt).toEqual([true, false]);
  plainExpect(rc.pts[0].y).toBeGreaterThan(0.7);
  // (drawn a yard out a's far side: cut back to a's near face all the same; drawn right across: left alone)
  const through = wall("through", [{ x: 50, y: -3 }, { x: 50, y: 40 }]), across = wall("across", [{ x: 50, y: -20 }, { x: 50, y: 40 }]);
  const rt = wallRun(through, through.points, [a, through]);
  plainExpect(rt.butt).toEqual([true, false]);
  plainExpect(rt.pts[0].y).toBeGreaterThan(0.7);
  plainExpect(rt.pts[0].y).toBeLessThan(1.01);
  plainExpect(wallRun(across, across.points, [a, across])).toEqual({ pts: across.points, butt: [false, false] });
  // (a wall by itself, and one that only passes near another, are as drawn)
  plainExpect(wallRun(a, a.points, [a]).pts).toBe(a.points);
  const far = wall("far", [{ x: 50, y: 3 }, { x: 50, y: 40 }]);
  plainExpect(wallRun(far, far.points, [a, far])).toEqual({ pts: far.points, butt: [false, false] });
});

plain("a stone is one color wherever it shows: its swatch and its rocks in 3D take the color the map paints it, softer than the stone's own", () => {
  const sat = (hex: string) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return Math.max(...c) - Math.min(...c); };
  const shown = STONE_ORDER.map(stoneShown);
  plainExpect(new Set(shown).size).toBe(STONE_ORDER.length);
  for (const st of STONE_ORDER) {
    plainExpect(stoneShown(st)).toMatch(/^#[0-9a-f]{6}$/);
    plainExpect(sat(stoneShown(st)), st).toBeLessThan(sat(ROCK_STONES[st].color));
  }
  plainExpect(stoneShown("granite")).toBe("#a59f97");
});

plain("the printed map draws a wall drawn as a line with the built things, in every style, and names it in the legend", () => {
  const doc = createEmptyCourse(), h = newHole();
  doc.holes.push(h);
  doc.items.push(createTee(h.id, { x: 100, y: 500 }), createBasket(h.id, { x: 500, y: 500 }));
  const wall = (id: string, y: number, extra: Partial<LineItem> = {}): LineItem => ({ id, type: "line", kind: "wall", points: [{ x: 100, y }, { x: 300, y: y + 20 }], x: 200, y, rotation: 0, ...extra });
  doc.items.push(wall("dry", 200), wall("mortared", 300, { wallStyle: "mortared", straight: true }));
  for (const theme of Object.keys(THEMES) as MapTheme[]) {
    doc.style.theme = theme;
    const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
    // (on the painted map a dry stone wall is in the painting, stone by stone)
    plainExpect(svg.split('data-structure="wall"').length - 1, theme).toBe(theme === "forest" ? 1 : 2);
  }
  doc.style.theme = "illustrated";
  doc.style.legend = true;
  const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(svg.slice(svg.indexOf(">LEGEND<"))).toContain(">Wall<");
});
