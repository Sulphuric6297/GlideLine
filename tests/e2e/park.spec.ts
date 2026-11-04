// A park's things: fields, courts and play areas put down with the Park tool (one click at their
// usual size, or by their corners), their panel (kind, in or out of play, markings turned, a ball
// field's home plate), the checks about them and power lines, the newer amenities and lines
// (grills, power lines, hedges), a phone placing one with taps, and what OpenStreetMap's tags
// come in as (pure logic).
import { test as plain, expect as plainExpect } from "@playwright/test";
import { devices, type Page } from "@playwright/test";
import { test, expect, addHole, blankCourse, clickPlan, course, drag, editorState, screenOf, tapPlan } from "./fixtures";
import { createArea, createBasket, createEmptyCourse, createLine, createTee, newHole } from "../../src/lib/course";
import { courtCount, createField, fieldHome, fieldOutline, homeCorner } from "../../src/lib/fields";
import { amenityOf, fieldOf, lineOf } from "../../src/lib/geo/parkKinds";
import { isOutOfPlay, safetyIssues } from "../../src/lib/holeStats";
import type { CourseDoc, P } from "../../src/types";

const fields = async (page: Page) => (await course(page)).items.filter((i: any) => i.type === "area" && i.kind === "field");

test("a ball field put down with one click at its usual size; its kind, play, markings and home plate in its panel", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("field-kind-baseball")).toBeVisible();
  await expect(page.getByTestId("draw-shape-usual")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("tool-hint")).toContainText("Click where the ball field goes");
  await clickPlan(page, 800, 550);
  await expect.poll(async () => (await fields(page)).length).toBe(1);
  let f = (await fields(page))[0];
  expect(f.field).toBe("baseball");
  expect(f.outOfPlay).toBeUndefined();
  // (its fan, 330 ft each way from home plate at the south-west corner, north up)
  const xs = f.points.map((p: P) => p.x), ys = f.points.map((p: P) => p.y);
  expect(Math.round(Math.max(...xs) - Math.min(...xs))).toBe(330);
  expect(Math.round(Math.max(...ys) - Math.min(...ys))).toBe(330);
  expect(fieldHome(f)).toBe(0);
  // Picked, Select back, its panel open
  expect((await editorState(page)).tool).toBe("select");
  await expect(page.getByTestId("inspector-title")).toHaveText("Baseball field");
  const panel = page.getByTestId("inspector");
  await expect(panel.getByTestId("field-home")).toContainText(`Corner 1 of ${f.points.length}`);
  await panel.getByTestId("field-home-next").click();
  await expect.poll(async () => (await fields(page))[0].home).toBe(1);
  // No markings to turn on a ball field; the same Out of bounds as any area
  await expect(panel.getByRole("slider", { name: "Markings turn" })).toHaveCount(0);
  await expect(panel.getByRole("radiogroup", { name: "Penalty" })).toBeVisible();
  // Made a soccer field: no home plate, markings to turn
  await panel.getByRole("radiogroup", { name: "Field kind" }).getByRole("radio", { name: "Soccer field" }).click();
  await expect.poll(async () => (await fields(page))[0].field).toBe("soccer");
  f = (await fields(page))[0];
  expect(f.home).toBeUndefined();
  await expect(page.getByTestId("inspector-title")).toHaveText("Soccer field");
  await panel.getByRole("slider", { name: "Markings turn" }).fill("20");
  await expect.poll(async () => (await fields(page))[0].fieldTurn).toBe(20);
  // Out of play, and its holes to count for
  await panel.getByRole("radiogroup", { name: "Play" }).getByRole("radio", { name: "Out of play" }).click();
  await expect.poll(async () => (await fields(page))[0].outOfPlay).toBe(true);
  await expect(panel.getByTestId("belongs-to")).toBeVisible();
  // A dog park: no markings to turn; out of play as set (and as a dog park starts)
  await panel.getByRole("radiogroup", { name: "Field kind" }).getByRole("radio", { name: "Dog park" }).click();
  await expect.poll(async () => (await fields(page))[0].field).toBe("dog");
  f = (await fields(page))[0];
  expect(f.fieldTurn).toBeUndefined();
  expect(f.outOfPlay).toBe(true);
  await expect(panel.getByRole("slider", { name: "Markings turn" })).toHaveCount(0);
  // ...and a dog park made a tennis court goes in play, as courts start
  await panel.getByRole("radiogroup", { name: "Field kind" }).getByRole("radio", { name: "Tennis court" }).click();
  await expect.poll(async () => (await fields(page))[0].outOfPlay).toBeUndefined();
  await expect(panel.getByRole("radiogroup", { name: "Play" }).getByRole("radio", { name: "In play" })).toHaveAttribute("aria-checked", "true");
  // One undo step each
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await fields(page))[0].field).toBe("dog");
});

test("a court drawn as a rectangle with the Park tool; the courts it holds; the way it was drawn is kept", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("p");
  await page.getByTestId("field-kind-tennis").click();
  await page.getByTestId("draw-shape-box").click();
  expect((await editorState(page)).tool).toBe("draw-area");
  await drag(page, await screenOf(page, 600, 500), await screenOf(page, 840, 560), 12);
  await expect.poll(async () => (await fields(page)).length).toBe(1);
  const f = (await fields(page))[0];
  expect(f.field).toBe("tennis");
  expect(f.points).toHaveLength(4);
  await expect(page.getByTestId("inspector-title")).toHaveText("Tennis court");
  await expect(page.getByTestId("area-size")).toContainText("2 courts");
  // Back to the Park tool: a rectangle again
  await page.keyboard.press("p");
  await expect(page.getByTestId("draw-shape-box")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("field-kind-tennis")).toBeVisible();
  // Search finds a kind by its name
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("pickleball");
  await expect(page.getByTestId("goto-option").first()).toContainText("Pickleball court");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => { const e = (window as any).__dgEditor(); return [e.areaKind, e.fieldKind]; })).toEqual(["field", "pickleball"]);
});

test("checks: a hole across a field in play, over one out of play, under a power line", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 500 }, { x: 900, y: 500 });
  await page.keyboard.press("Escape");
  // A soccer field across the middle of the hole
  await page.keyboard.press("p");
  await page.getByTestId("field-kind-soccer").click();
  await clickPlan(page, 600, 500);
  await expect.poll(async () => (await fields(page)).length).toBe(1);
  await page.getByTestId("problems-button").click();
  const list = page.getByTestId("issues");
  await expect(list.getByTestId("issue-row").filter({ hasText: "Hole 1 throws across a soccer field." })).toHaveCount(1);
  // Out of play: thrown over, as an Out of play area
  await page.getByTestId("inspector").getByRole("radiogroup", { name: "Play" }).getByRole("radio", { name: "Out of play" }).click();
  await expect(list.getByTestId("issue-row").filter({ hasText: "Hole 1 throws over a soccer field." })).toHaveCount(1);
  await expect(list.getByTestId("issue-row").filter({ hasText: "across a soccer field" })).toHaveCount(0);
  // A power line across the hole, from Build
  await page.keyboard.press("Escape");
  await page.keyboard.press("s");
  await page.getByTestId("line-kind-power").click();
  await clickPlan(page, 450, 250);
  await clickPlan(page, 450, 750);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line" && i.kind === "power").length).toBe(1);
  await expect(list.getByTestId("issue-row").filter({ hasText: "Hole 1 throws under a power line." })).toHaveCount(1);
});

test("a grill, a power line and a hedge put down like the others; their panels", async ({ page }) => {
  await blankCourse(page);
  // A grill from Amenities, found by Search too
  await page.keyboard.press("a");
  await page.getByTestId("amenity-kind-grill").click();
  await expect(page.getByTestId("tool-hint")).toContainText("Click where the grill goes");
  await clickPlan(page, 500, 500);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "amenity").map((i: any) => i.kind)).toEqual(["grill"]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("light pole");
  await expect(page.getByTestId("goto-option").first()).toContainText("Light pole");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => { const e = (window as any).__dgEditor(); return [e.tool, e.amenityKind]; })).toEqual(["add-amenity", "light"]);
  await clickPlan(page, 560, 500);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "amenity").length).toBe(2);
  // A power line from Build: its wire height and Out of bounds
  await page.keyboard.press("s");
  await page.getByTestId("line-kind-power").click();
  await clickPlan(page, 300, 300);
  await clickPlan(page, 900, 320);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  await expect(page.getByTestId("inspector-title")).toHaveText("Power line");
  const panel = page.getByTestId("inspector");
  await expect(panel.getByRole("slider", { name: "Width" })).toHaveCount(0);
  await panel.getByRole("slider", { name: "Wire height" }).fill("40");
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.kind === "power").fenceHeight).toBe(40);
  await expect(panel.getByRole("radiogroup", { name: "Penalty" })).toBeVisible();
  // A hedge from Trees: its width and height
  await page.keyboard.press("r");
  await page.getByTestId("line-kind-hedge").click();
  await clickPlan(page, 300, 700);
  await clickPlan(page, 700, 760);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.kind === "hedge").length).toBe(1);
  await expect(page.getByTestId("inspector-title")).toHaveText("Hedge");
  await panel.getByRole("slider", { name: "Width" }).fill("6");
  await panel.getByRole("slider", { name: "Height" }).fill("8");
  await expect.poll(async () => { const h = (await course(page)).items.find((i: any) => i.kind === "hedge"); return [h.width, h.fenceHeight]; }).toEqual([6, 8]);
  // Made a power line: its own usual height again
  await panel.getByRole("radiogroup", { name: "Line kind" }).getByRole("radio", { name: "Power line" }).click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.kind === "power").length).toBe(2);
  const was = (await course(page)).items.filter((i: any) => i.kind === "power").find((i: any) => i.fenceHeight !== 40);
  expect(was.fenceHeight).toBeUndefined();
  expect(was.width).toBeUndefined();
});

test("a field's right-click menu marks it out of play and back", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("p");
  await page.getByTestId("field-kind-multi").click();
  await clickPlan(page, 700, 500);
  await expect.poll(async () => (await fields(page)).length).toBe(1);
  const at = await screenOf(page, 700, 500);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByTestId("menu-out-of-play").click();
  await expect.poll(async () => (await fields(page))[0].outOfPlay).toBe(true);
});

/** A Playwright device in Chromium (the device list's iPhones say WebKit). */
const device = (name: string) => {
  const { defaultBrowserType: _browser, ...d } = devices[name];
  return d;
};

test.describe("phone", () => {
  test.use(device("iPhone 13"));

  test("a field put down with a tap; its strip sets its kind and play", async ({ page }) => {
    await page.getByTestId("welcome-blank").click();
    await expect.poll(async () => (await editorState(page)).tool).toBe("add-hole");
    await page.evaluate(() => {
      (window as any).__dgActions.addHole({ x: 300, y: 500 }, { x: 600, y: 500 }, "blue");
      (window as any).__dgActions.select(null);
      (window as any).__dgEditor().set({ tool: "select" });
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(300);
    // (on the Design step already: its tools along the foot, Park among them)
    await page.getByTestId("tool-strip").locator('[data-tool="park"]').tap();
    // (the tool's bar: Kind opens the kinds just over it)
    await page.getByTestId("tool-options").tap();
    await page.getByTestId("field-kind-basketball").tap();
    // (picking closes the menu, or a tap on the view does; the next tap only once it's gone, or
    // that tap closes it instead)
    const menu = page.getByTestId("bar-menu");
    const closed = async () => {
      await expect(menu).toHaveCount(0, { timeout: 2000 }).catch(() => page.getByTestId("bar-away").tap({ timeout: 2000 }).catch(() => {}));
      await expect(menu).toHaveCount(0);
      await expect(page.getByTestId("bar-away")).toHaveCount(0);
    };
    await closed();
    await tapPlan(page, 450, 380);
    await expect.poll(async () => (await fields(page)).length).toBe(1);
    const f = (await fields(page))[0];
    expect(f.field).toBe("basketball");
    expect(Math.round(Math.max(...f.points.map((p: P) => p.x)) - Math.min(...f.points.map((p: P) => p.x)))).toBe(94);
    expect((await editorState(page)).selectedId).toBe(f.id);
    const strip = page.getByTestId("item-strip");
    await expect(strip).toBeVisible();
    // (a setting's choices grow out of its button, over the bar)
    await strip.getByTestId("strip-play").tap();
    await menu.getByRole("radiogroup", { name: "Play" }).getByRole("radio", { name: "Out of play" }).tap();
    await expect.poll(async () => (await fields(page))[0].outOfPlay).toBe(true);
    await closed();
    await strip.getByTestId("strip-kind").tap();
    await menu.getByRole("radiogroup", { name: "Field kind" }).getByRole("radio", { name: "Volleyball court" }).tap();
    await expect.poll(async () => (await fields(page))[0].field).toBe("volleyball");
    await closed();
    await strip.getByTestId("strip-markings").tap();
    await expect(menu.getByRole("slider", { name: "Markings turn" })).toBeVisible();
  });
});

// --- Pure logic ---

const make = (holes: [P, P][]): CourseDoc => {
  const doc = createEmptyCourse();
  for (const [t, b] of holes) {
    const h = newHole();
    doc.holes.push(h);
    doc.items.push(createTee(h.id, t, "blue"), createBasket(h.id, b));
  }
  return doc;
};
const rect = (x: number, y: number, w: number, h: number): P[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

plain("fields out of play count as Out of play; checks over and across fields, and under power lines", () => {
  const doc = make([[{ x: 100, y: 300 }, { x: 700, y: 300 }]]);
  const playground = createField("playground", rect(200, 260, 80, 80));
  const soccer = createField("soccer", rect(400, 200, 200, 200));
  plainExpect(playground.outOfPlay).toBe(true);
  plainExpect(soccer.outOfPlay).toBeUndefined();
  plainExpect(isOutOfPlay(playground)).toBe(true);
  plainExpect(isOutOfPlay(soccer)).toBe(false);
  plainExpect(isOutOfPlay(createArea("nogo", rect(0, 0, 10, 10)))).toBe(true);
  doc.items.push(playground, soccer, createLine("power", [{ x: 350, y: 100 }, { x: 350, y: 500 }]));
  const t = safetyIssues(doc).map(i => i.text);
  plainExpect(t).toContain("Hole 1 throws over a playground.");
  plainExpect(t).toContain("Hole 1 throws across a soccer field.");
  plainExpect(t).toContain("Hole 1 throws under a power line.");
  // (an Out of play area is still said as one)
  // (a new course object: the checks are worked out once per course)
  const more = { ...doc, items: [...doc.items, createArea("nogo", rect(620, 280, 30, 40))] };
  plainExpect(safetyIssues(more).map(i => i.text)).toContain("Hole 1 throws over an out-of-play area.");
});

plain("a ball field's home plate: the fan's point, wherever it starts and however it's turned; courts side by side", () => {
  const fan = fieldOutline("softball", { x: 0, y: 0 });
  plainExpect(homeCorner(fan)).toBe(0);
  const turn = (pts: P[], a: number) => pts.map(p => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
  plainExpect(homeCorner(turn([...fan.slice(3), ...fan.slice(0, 3)], 0.7))).toBe(fan.length - 3);
  // (a foul line mapped in two pieces)
  const split = [fan[0], { x: (fan[0].x + fan[1].x) / 2, y: fan[0].y }, ...fan.slice(1)];
  plainExpect(homeCorner(split)).toBe(0);
  plainExpect(fieldHome({ points: fan, home: 3 })).toBe(3);
  plainExpect(courtCount("tennis", rect(0, 0, 120, 60))).toBe(1);
  plainExpect(courtCount("tennis", rect(0, 0, 180, 120))).toBe(3);
  plainExpect(courtCount("tennis", rect(0, 0, 240, 120))).toBe(4);
  plainExpect(courtCount("soccer", rect(0, 0, 900, 225))).toBe(1);
});

plain("OpenStreetMap's tags as fields, amenities and lines", () => {
  const fan = fieldOutline("baseball", { x: 0, y: 0 });
  plainExpect(fieldOf({ leisure: "pitch", sport: "baseball;softball" }, fan)).toEqual({ field: "baseball", home: 0 });
  plainExpect(fieldOf({ leisure: "pitch", sport: "american_football" }, rect(0, 0, 360, 160))).toEqual({ field: "football" });
  plainExpect(fieldOf({ leisure: "pitch" }, rect(0, 0, 300, 200))).toEqual({ field: "multi" });
  plainExpect(fieldOf({ leisure: "pitch", sport: "tennis" }, rect(0, 0, 240, 120))).toEqual({ field: "tennis", courts: 4 });
  plainExpect(fieldOf({ leisure: "pitch", sport: "baseball", pitch: "infield" }, fan)).toBeNull();
  plainExpect(fieldOf({ leisure: "pitch", sport: "golf" }, rect(0, 0, 300, 200))).toBeNull();
  plainExpect(fieldOf({ leisure: "playground" }, rect(0, 0, 90, 70))).toEqual({ field: "playground", outOfPlay: true });
  plainExpect(fieldOf({ leisure: "swimming_pool" }, rect(0, 0, 82, 50))).toEqual({ field: "pool", outOfPlay: true });
  plainExpect(fieldOf({ leisure: "swimming_pool", access: "private" }, rect(0, 0, 30, 15))).toBeNull();
  plainExpect(fieldOf({ leisure: "swimming_pool", indoor: "yes" }, rect(0, 0, 82, 50))).toBeNull();
  plainExpect(fieldOf({ leisure: "splash_pad" }, rect(0, 0, 50, 50))?.field).toBe("splash");
  plainExpect(fieldOf({ leisure: "water_park", name: "Riverside Splash Pad" }, rect(0, 0, 50, 50))?.field).toBe("splash");
  plainExpect(fieldOf({ leisure: "dog_park" }, rect(0, 0, 200, 150))?.field).toBe("dog");
  plainExpect(fieldOf({ leisure: "track", sport: "running" }, rect(0, 0, 580, 300))?.field).toBe("track");
  plainExpect(fieldOf({ leisure: "track", sport: "horse_racing" }, rect(0, 0, 580, 300))).toBeNull();
  plainExpect(fieldOf({ leisure: "skatepark" }, rect(0, 0, 120, 90))?.field).toBe("skate");
  plainExpect(fieldOf({ leisure: "garden" }, rect(0, 0, 100, 60))?.field).toBe("garden");
  plainExpect(fieldOf({ leisure: "playground" }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  plainExpect(["bbq", "fitness_station", "flagpole", "street_lamp", "pole", "utility_pole", "bicycle_parking", "fountain", "gate"].map(v =>
    amenityOf(v === "fitness_station" ? { leisure: v } : v === "flagpole" || v === "utility_pole" ? { man_made: v } : v === "street_lamp" ? { highway: v } : v === "pole" ? { power: v } : v === "gate" ? { barrier: v } : { amenity: v })))
    .toEqual(["grill", "fitness", "flagpole", "light", "pole", "pole", "bikerack", "fountain", "gate"]);
  plainExpect(amenityOf({ amenity: "fountain", fountain: "drinking" })).toBe("water");
  plainExpect(amenityOf({ amenity: "bench" })).toBeNull();
  plainExpect(lineOf({ power: "minor_line" })).toEqual({ kind: "power" });
  plainExpect(lineOf({ power: "line", voltage: "138000" })).toEqual({ kind: "power", height: 80 });
  plainExpect(lineOf({ power: "line", height: "12" })).toEqual({ kind: "power", height: 39.5 });
  plainExpect(lineOf({ barrier: "hedge", height: "1.5", width: "1" })).toEqual({ kind: "hedge", height: 5, width: 3.5 });
  plainExpect(lineOf({ power: "cable" })).toBeNull();
});
