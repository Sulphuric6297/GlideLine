import { test as plainHoles, expect as plainHolesExpect } from "@playwright/test";
import { test, expect, addHole, blankCourse, clickPlan, course, drag, editorState, handleCenter, screenOf } from "./fixtures";
import { createTee, newHole, teeLines, walkEnds, WALK_OUT_FT } from "../../src/lib/course";
import { createTeePad, fitTeePad } from "../../src/three/courseModels";
import * as THREE from "three";
import { CIRCLE_ONE_FT } from "../../src/constants";

test("a new hole: click the tee, then the basket; length and par show live", async ({ page }) => {
  await blankCourse(page);
  await clickPlan(page, 400, 700);
  // While choosing the basket spot, the distance follows the pointer
  const p = await screenOf(page, 700, 700);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await expect(page.getByTestId("draft-label")).toContainText(/300 ft · par 3/);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await course(page)).holes.length).toBe(1);
  const doc = await course(page);
  const tee = doc.items.find((i: any) => i.type === "tee");
  const basket = doc.items.find((i: any) => i.type === "basket");
  expect(tee.holeId).toBe(doc.holes[0].id);
  expect(basket.position).toBe("A");
  expect(Math.round(basket.x - tee.x)).toBe(300);
  await expect(page.getByTestId("hole-row")).toHaveCount(1);
  await expect(page.getByTestId("hole-row")).toContainText("300 ft");
  await expect(page.getByTestId("hole-row")).toContainText("Par 3");
  // Back to Select, the new hole picked
  expect((await editorState(page)).tool).toBe("select");
  expect((await editorState(page)).selectedId).toBe(doc.holes[0].id);
});

test("long holes get par 4 and 5 by the PDGA's effective length", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 100, y: 200 }, { x: 650, y: 200 }); // 550 ft blue: par 4
  await addHole(page, { x: 100, y: 500 }, { x: 1000, y: 500 }); // 900 ft blue: par 5
  const rows = page.getByTestId("hole-row");
  await expect(rows.nth(0)).toContainText("Par 4");
  await expect(rows.nth(1)).toContainText("Par 5");
  await expect(page.getByTestId("course-totals-button")).toContainText(/9\s*par/);
});

test("bending the throw line: pull the middle dot to add a dogleg, double-click to remove it", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 400, y: 700 }, { x: 800, y: 700 });
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  const mid = await handleCenter(page, "mid");
  // (the hole's distance label clear of the dot)
  const label = (await page.getByTestId("hole-distance").boundingBox())!;
  expect(label).not.toBeNull();
  expect(mid.x > label.x - 8 && mid.x < label.x + label.width + 8 && mid.y > label.y - 8 && mid.y < label.y + label.height + 8).toBe(false);
  const to = await screenOf(page, 600, 550);
  await drag(page, mid, to);
  await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBe(1);
  const d = (await course(page)).holes[0].doglegs[0];
  expect(Math.abs(d.x - 600)).toBeLessThan(8);
  expect(Math.abs(d.y - 550)).toBeLessThan(8);
  // Longer along the bend: two legs of 250 ft
  await expect(page.getByTestId("hole-row")).toContainText("500 ft");
  // One undo step for the whole drag
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBe(1);
  const dot = await handleCenter(page, "dogleg");
  await page.mouse.dblclick(dot.x, dot.y);
  await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBe(0);
});

test("fairway width handle and par override in the inspector", async ({ page }) => {
  // (on a slow machine, all of it takes a while)
  test.setTimeout(180_000);
  await blankCourse(page);
  const hole = await addHole(page, { x: 400, y: 700 }, { x: 800, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Hole 1");
  // (zoomed to it, as a fairway is shaped: its squares and +s far enough apart to show)
  await page.getByTestId("zoom-hole").click();
  await page.waitForTimeout(1500);
  // Width squares on both edges at four points along the fairway; the first (just off the tee, on the south side)
  // widens it there only, and only on its own side: the north edge stays 15 ft off the line
  await expect(page.locator('[data-handle="width"]')).toHaveCount(8);
  const w = await handleCenter(page, "width", 0);
  const to = await screenOf(page, 460, 700 + 40);
  await drag(page, w, to);
  const across = async () => { const h = (await course(page)).holes[0]; const width = (h.fairwayShape?.[0] ?? 1) * h.fairwayWidth, mid = (h.fairwayShift?.[0] ?? 0) * h.fairwayWidth; return { width, south: mid + width / 2, north: mid - width / 2 }; };
  await expect.poll(async () => (await across()).width).toBeGreaterThan(50);
  expect((await across()).width).toBeLessThan(62);
  expect(Math.abs((await across()).north + 15)).toBeLessThan(2);
  expect(Math.abs((await across()).south - 40)).toBeLessThan(3);
  expect((await course(page)).holes[0].fairwayShape.slice(1)).toEqual([1, 1, 1]);
  // With Shift both sides move alike (the middle stays)
  const mid0 = (await across()).south - (await across()).width / 2;
  const w2 = await handleCenter(page, "width", 0);
  const to2 = await screenOf(page, 460, 700 + 60);
  await page.mouse.move(w2.x, w2.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  for (let k = 1; k <= 8; k++) await page.mouse.move(w2.x + ((to2.x - w2.x) * k) / 8, w2.y + ((to2.y - w2.y) * k) / 8);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await across()).south).toBeGreaterThan(55);
  expect(Math.abs((await across()).south - (await across()).width / 2 - mid0)).toBeLessThan(1);
  expect((await across()).north).toBeLessThan(-30);
  // A + between two points (the landing zones, on the south edge) adds one there, and drags it out
  await expect.poll(async () => (await course(page)).holes[0].fairwayStations).toBeUndefined();
  const plus = await handleCenter(page, "widen", 4);
  await drag(page, plus, await screenOf(page, 610, 700 + 50));
  await expect.poll(async () => (await course(page)).holes[0].fairwayStations?.length).toBe(5);
  {
    const h = (await course(page)).holes[0];
    expect(h.fairwayStations[2]).toBeCloseTo(0.525, 2);
    expect(h.fairwayShape[2] * h.fairwayWidth).toBeGreaterThan(40);
  }
  // A double-click on its square takes it out again
  const sq = await handleCenter(page, "width", 4);
  await page.mouse.dblclick(sq.x, sq.y);
  await expect.poll(async () => (await course(page)).holes[0].fairwayStations?.length).toBe(4);
  await expect(page.getByTestId("fairway-shape")).toContainText(/\d+ to \d+ ft/);
  // The width slider widens it all along, keeping the shape; Even width takes the shape off
  const before = (await course(page)).holes[0].fairwayShape;
  await page.getByRole("slider", { name: /Fairway width/ }).fill("60");
  await expect.poll(async () => (await course(page)).holes[0].fairwayWidth).toBe(60);
  expect((await course(page)).holes[0].fairwayShape).toEqual(before);
  await page.getByTestId("fairway-shape").getByRole("button", { name: "Even width" }).click();
  await expect.poll(async () => (await course(page)).holes[0].fairwayShape).toBeUndefined();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).holes[0].fairwayShape).toEqual(before);
  await page.getByRole("radiogroup", { name: "Par" }).getByRole("radio", { name: "4" }).click();
  await expect.poll(async () => (await course(page)).holes.find((h: any) => h.id === hole.id).par).toBe(4);
  await expect(page.getByTestId("hole-row")).toContainText("Par 4");
  await page.getByRole("radiogroup", { name: "Par" }).getByRole("radio", { name: /Auto/ }).click();
  await expect.poll(async () => (await course(page)).holes[0].par).toBeUndefined();
});

test("another tee and pin for a hole, and layouts pick between them", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 800, y: 700 });
  // A shorter red tee and a B pin for the hole being worked on
  await page.keyboard.press("t");
  await page.getByTestId("tee-level-red").click();
  await clickPlan(page, 500, 700);
  await page.keyboard.press("b");
  await clickPlan(page, 850, 650);
  const doc = await course(page);
  const tees = doc.items.filter((i: any) => i.type === "tee");
  expect(tees.map((t: any) => t.level).sort()).toEqual(["blue", "red"]);
  expect(doc.items.filter((i: any) => i.type === "basket").map((b: any) => b.position).sort()).toEqual(["A", "B"]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hole-row")).toContainText("400 ft");
  // (one layout: no switcher above the holes)
  await expect(page.getByTestId("layout-picker")).toHaveCount(0);
  // A red layout to pin B
  // (the course's totals open its layouts)
  await page.getByTestId("course-totals-button").click();
  await page.getByRole("button", { name: "Edit layouts" }).click();
  await page.getByRole("button", { name: "Add a layout" }).click();
  const editor = page.getByTestId("layout-editor");
  const last = editor.locator("> div").last();
  await last.getByRole("radiogroup", { name: "Layout tees" }).getByRole("radio", { name: "Red" }).click();
  await last.getByRole("radiogroup", { name: "Layout pins" }).getByRole("radio", { name: "B", exact: true }).click();
  // Red tee at 500 to pin B at (850, 650): about 354 ft
  await expect(page.getByTestId("hole-row")).toContainText("354 ft");
  // Two layouts: the switcher at the top of the holes column, the one worked on picked
  await page.getByRole("button", { name: "Done" }).click();
  const picker = page.getByTestId("holes-column").getByRole("radiogroup", { name: "Layout" });
  await expect(picker.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
  // (its tees to the fore: the blue one, only the other layout's, a faint dot; new tees red)
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("course-more")).toHaveCount(0);
  const blueTee = tees.find((t: any) => t.level === "blue").id;
  const redTee = tees.find((t: any) => t.level === "red").id;
  await expect(page.locator(`.dg-tee[data-item-id="${blueTee}"]`)).toHaveClass(/(^| )off( |$)/);
  await expect(page.locator(`.dg-tee[data-item-id="${redTee}"]`)).not.toHaveClass(/(^| )off( |$)/);
  expect(await page.evaluate(() => (window as any).__dgEditor().teeLevel)).toBe("red");
  // Back to Main: blue to the fore, 400 ft again
  await picker.getByRole("radio", { name: "Main" }).click();
  await expect(page.getByTestId("hole-row")).toContainText("400 ft");
  await expect(page.locator(`.dg-tee[data-item-id="${redTee}"]`)).toHaveClass(/(^| )off( |$)/);
  await expect(page.locator(`.dg-tee[data-item-id="${blueTee}"]`)).not.toHaveClass(/(^| )off( |$)/);
  expect(await page.evaluate(() => (window as any).__dgEditor().teeLevel)).toBe("blue");
  // (the ? by Layouts: a tip, and on to the guide's page)
  await page.getByTestId("course-totals-button").click();
  await page.getByTestId("help-layouts").click();
  await expect(page.getByTestId("help-tip")).toContainText("Layouts");
  await page.getByTestId("help-tip-more").click();
  await expect(page.getByTestId("help-guide")).toBeVisible();
});

test("a hole with pins A to D: no Another pin position; the Pin tool and Ctrl+D on its basket say it has them", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 400, y: 700 }, { x: 800, y: 700 });
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await expect(page.getByTestId("another-pin")).toBeVisible();
  const pins = async () => (await course(page)).items.filter((i: any) => i.type === "basket").map((b: any) => b.position).sort();
  await page.evaluate(id => {
    (window as any).__dgEditor().set({ activeHoleId: id });
    for (const p of [{ x: 850, y: 650 }, { x: 850, y: 750 }, { x: 750, y: 750 }]) (window as any).__dgActions.placeAt("add-basket", p);
  }, hole.id);
  await expect.poll(pins).toEqual(["A", "B", "C", "D"]);
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await expect(page.getByTestId("another-pin")).toHaveCount(0);
  await expect(page.getByTestId("another-tee")).toBeVisible();
  // A fifth with the Pin tool: none, and the toast says why
  await page.evaluate(() => (window as any).__dgActions.placeAt("add-basket", { x: 750, y: 650 }));
  await expect(page.getByText("Hole 1 has pins A to D already.")).toBeVisible();
  expect(await pins()).toEqual(["A", "B", "C", "D"]);
  // Ctrl+D on a basket: the same
  await page.keyboard.press("Escape");
  await expect(page.getByText("Hole 1 has pins A to D already.")).toHaveCount(0, { timeout: 15_000 });
  const a = (await course(page)).items.find((i: any) => i.type === "basket" && i.position === "A");
  await page.evaluate(id => (window as any).__dgActions.select(id), a.id);
  await page.keyboard.press("Control+d");
  await expect(page.getByText("Hole 1 has pins A to D already.")).toBeVisible();
  expect(await pins()).toEqual(["A", "B", "C", "D"]);
});

test("hole numbers typed in (any number, others keep theirs); deleted with undo", async ({ page }) => {
  await blankCourse(page);
  const a = await addHole(page, { x: 200, y: 300 }, { x: 500, y: 300 });
  const b = await addHole(page, { x: 600, y: 600 }, { x: 900, y: 600 });
  const c = await addHole(page, { x: 200, y: 800 }, { x: 500, y: 800 });
  await page.keyboard.press("Escape");
  // The last one typed as 27 (more than there are holes): the others keep 1 and 2
  await page.getByTestId("hole-row").nth(2).click();
  await page.getByTestId("hole-number").fill("27");
  await page.getByTestId("hole-number").press("Enter");
  await expect.poll(async () => (await course(page)).holes.map((h: any) => [h.id, h.number])).toEqual([[a.id, 1], [b.id, 2], [c.id, 27]]);
  await expect(page.getByTestId("inspector-title")).toHaveText("Hole 27");
  // Esc leaves the badge without keeping what was typed
  await page.getByTestId("hole-number").fill("5");
  await page.getByTestId("hole-number").press("Escape");
  await expect(page.getByTestId("hole-number")).toHaveValue("27");
  expect((await course(page)).holes.find((h: any) => h.id === c.id).number).toBe(27);
  // The second as 1: before the first now, which stays 1 too (shown, not renumbered)
  await page.getByTestId("hole-row").nth(1).click();
  await page.getByTestId("hole-number").fill("1");
  await page.getByTestId("hole-number").press("Enter");
  await expect.poll(async () => (await course(page)).holes.map((h: any) => [h.id, h.number])).toEqual([[a.id, 1], [b.id, 1], [c.id, 27]]);
  await expect(page.getByTestId("hole-number-taken")).toBeVisible();
  await page.getByTestId("hole-number").fill("3");
  await page.getByTestId("hole-number").press("Enter");
  await expect.poll(async () => (await course(page)).holes.map((h: any) => [h.id, h.number])).toEqual([[a.id, 1], [b.id, 3], [c.id, 27]]);
  await expect(page.getByTestId("hole-number-taken")).toHaveCount(0);
  // A new hole takes the first number free (2)
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 100, minY: 100, maxX: 1000, maxY: 900 }, { animate: false }));
  const d = await addHole(page, { x: 700, y: 200 }, { x: 950, y: 200 });
  await expect.poll(async () => (await course(page)).holes.map((h: any) => [h.id, h.number])).toEqual([[a.id, 1], [d.id, 2], [b.id, 3], [c.id, 27]]);
  // One undo step each; Delete with Undo
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").nth(1).click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await course(page)).holes.length).toBe(3);
  expect((await course(page)).items.filter((i: any) => i.holeId === d.id)).toHaveLength(0);
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect.poll(async () => (await course(page)).holes.length).toBe(4);
});

test("dragging a tee moves it and the hole's length follows", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 800, y: 700 });
  await page.keyboard.press("Escape");
  const badge = page.getByTestId("tee-badge").first();
  const box = (await badge.boundingBox())!;
  const to = await screenOf(page, 300, 700);
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, to);
  await expect.poll(async () => Math.round((await course(page)).items.find((i: any) => i.type === "tee").x / 10)).toBe(30);
  // (to the foot, as near as a pixel of the map lands)
  await expect(page.getByTestId("hole-row")).toContainText(/(499|500|501) ft/);
});

test("bending a hole: Bend left and Bend right curve it, Straighten undoes it", async ({ page }) => {
  await blankCourse(page);
  // East along y = 500
  await addHole(page, { x: 300, y: 500 }, { x: 700, y: 500 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  const turn = async () => (await course(page)).holes[0].doglegs as { x: number; y: number }[];
  // Left of the line of play (north, looking east) by a sixth of its length
  await page.getByTestId("bend-left").click();
  await expect.poll(async () => (await turn()).length).toBe(1);
  expect((await turn())[0].x).toBeCloseTo(500, 0);
  expect((await turn())[0].y).toBeCloseTo(500 - 400 / 6, 0);
  await page.getByTestId("bend-right").click();
  await expect.poll(async () => (await turn())[0]?.y).toBeCloseTo(500 + 400 / 6, 0);
  // Longer to play than straight
  await expect(page.getByTestId("hole-row")).not.toContainText("400 ft");
  await page.getByRole("button", { name: "Straighten" }).click();
  await expect.poll(async () => (await turn()).length).toBe(0);
});

test("two holes to one basket: a basket click on a basket shares it; the Basket choice; deleting one hole leaves it to the other", async ({ page }) => {
  await blankCourse(page);
  const a = await addHole(page, { x: 300, y: 700 }, { x: 650, y: 700 });
  // Hole 2 from another tee (the Hole tool again: a hole made goes back to Select), its basket
  // click on hole 1's basket
  await page.keyboard.press("h");
  await clickPlan(page, 650, 350);
  const badge = page.getByTestId("basket-badge").first();
  const bb = (await badge.boundingBox())!;
  await page.mouse.click(bb.x + bb.width / 2 + 3, bb.y + bb.height / 2 + 3);
  await expect.poll(async () => (await course(page)).holes.length).toBe(2);
  const b = (await course(page)).holes[1];
  const baskets = () => course(page).then(d => d.items.filter((i: any) => i.type === "basket"));
  expect(await baskets()).toHaveLength(1);
  expect((await baskets())[0].holeId).toBe(a.id);
  expect((await baskets())[0].alsoHoles).toEqual([b.id]);
  // Each hole measured to it, and the basket carries both numbers
  await expect(page.getByTestId("hole-row").nth(0)).toContainText("350 ft");
  await expect(page.getByTestId("hole-row").nth(1)).toContainText("350 ft");
  await expect(badge).toContainText("1 & 2");
  // Hole 2 back to a basket of its own, then onto hole 1's again
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").nth(1).click();
  const pick = page.getByTestId("share-basket");
  await expect(pick).toHaveValue(a.id);
  await pick.selectOption("");
  await expect.poll(async () => (await baskets()).length).toBe(2);
  expect((await baskets()).find((i: any) => i.holeId === a.id).alsoHoles).toBeUndefined();
  await expect(page.getByTestId("hole-row").nth(1)).toContainText("325 ft");
  await pick.selectOption(a.id);
  await expect.poll(async () => (await baskets()).length).toBe(1);
  // Deleting hole 1 leaves the basket to hole 2
  await page.getByTestId("hole-row").nth(0).click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await course(page)).holes.length).toBe(1);
  expect(await baskets()).toHaveLength(1);
  expect((await baskets())[0].holeId).toBe(b.id);
  expect((await baskets())[0].alsoHoles).toBeUndefined();
  await expect(page.getByTestId("hole-row")).toContainText("350 ft");
});

plainHoles("the walk to the next tee leaves from outside the putting circle, away from the fairway, and arrives behind the next tee; moved by hand where asked (pure logic)", () => {
  // Hole 1 played south, to (0, 300); hole 2's tee up the fairway's side, throwing north
  const hole = [{ x: 0, y: 0 }, { x: 0, y: 300 }];
  const next = [{ x: 40, y: 200 }, { x: 40, y: -100 }];
  const { from, to } = walkEnds(hole, next);
  const basket = hole[1];
  plainHolesExpect(Math.hypot(from.x - basket.x, from.y - basket.y)).toBeCloseTo(WALK_OUT_FT, 5);
  plainHolesExpect(WALK_OUT_FT).toBeGreaterThan(CIRCLE_ONE_FT);
  // At least 70 degrees off the way back up the fairway (north)
  const angle = Math.acos(((from.x - basket.x) * 0 + (from.y - basket.y) * -1) / WALK_OUT_FT) * 180 / Math.PI;
  plainHolesExpect(angle).toBeGreaterThanOrEqual(70 - 1e-6);
  // Behind the next tee (south of it, as it throws north)
  plainHolesExpect(to).toEqual({ x: 40, y: 218 });
  // Moved by hand: where it was put, from the basket and the tee
  plainHolesExpect(walkEnds(hole, next, { x: -50, y: 10 }, { x: 5, y: 25 })).toEqual({ from: { x: -50, y: 310 }, to: { x: 45, y: 225 } });
});

test("plotting a hole's line by hand: clicks along it (Backspace takes one back), Enter; a freehand drag; Cancel leaves it be", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  const turns = async () => (await course(page)).holes[0].doglegs as { x: number; y: number }[];
  await page.getByTestId("plot-line").click();
  await expect(page.getByTestId("plot-bar")).toBeVisible();
  await clickPlan(page, 420, 500);
  await page.waitForTimeout(450);
  await clickPlan(page, 560, 700);
  await page.waitForTimeout(450);
  await clickPlan(page, 650, 520);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await turns()).length).toBe(2);
  const t = await turns();
  expect(Math.hypot(t[0].x - 420, t[0].y - 500)).toBeLessThan(6);
  expect(Math.hypot(t[1].x - 560, t[1].y - 700)).toBeLessThan(6);
  await expect(page.getByTestId("plot-bar")).toHaveCount(0);
  // Freehand: a sweep south of the straight line
  await page.getByTestId("plot-line").click();
  await page.mouse.move(...(Object.values(await screenOf(page, 330, 620)) as [number, number]));
  await page.mouse.down();
  for (const [x, y] of [[400, 680], [500, 720], [600, 700], [700, 650], [770, 610]]) {
    const p = await screenOf(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await page.mouse.up();
  await expect.poll(async () => (await turns()).some(p => p.y > 680)).toBe(true);
  // Cancel: as it was
  const before = await turns();
  await page.getByTestId("plot-line").click();
  await clickPlan(page, 500, 400);
  await page.getByTestId("plot-cancel").click();
  expect(await turns()).toEqual(before);
});

test("a hole with two numbers (1/2): shown as both, counted twice; a new hole doesn't take either", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 200, y: 300 }, { x: 500, y: 300 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("hole-number").fill("1/2");
  await page.getByTestId("hole-number").press("Enter");
  await expect.poll(async () => { const h = (await course(page)).holes[0]; return [h.number, h.alsoNumbers]; }).toEqual([1, [2]]);
  await expect(page.getByTestId("inspector-title")).toHaveText("Hole 1/2");
  await expect(page.getByTestId("hole-row").first()).toContainText("1/2");
  // Counted twice, as on the scorecard; its badge holds both numbers
  await expect(page.getByTestId("course-totals-button")).toContainText(/2\s*holes/);
  expect(await page.getByTestId("hole-badge").first().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 100, minY: 100, maxX: 1000, maxY: 900 }, { animate: false }));
  const b = await addHole(page, { x: 600, y: 600 }, { x: 900, y: 600 });
  await expect.poll(async () => (await course(page)).holes.find((h: any) => h.id === b.id).number).toBe(3);
});

test("from hole to hole: the panel's arrows and [ ] go to the previous and next hole and bring it into view", async ({ page }) => {
  await blankCourse(page);
  const a = await addHole(page, { x: 200, y: 300 }, { x: 500, y: 300 });
  const b = await addHole(page, { x: 600, y: 700 }, { x: 900, y: 700 });
  const c = await addHole(page, { x: 200, y: 800 }, { x: 300, y: 1000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  const sel = async () => (await editorState(page)).selectedId;
  await expect.poll(sel).toBe(a.id);
  await page.getByTestId("hole-next").click();
  await expect.poll(sel).toBe(b.id);
  await expect(page.getByTestId("inspector-title")).toHaveText("Hole 2");
  // In view: hole 2's basket on the map
  await expect.poll(async () => {
    const box = await page.getByTestId("plan").boundingBox();
    const p = await page.evaluate(() => (window as any).__dgView.toClient(900, 700));
    return !!box && p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height;
  }).toBe(true);
  await page.keyboard.press("]");
  await expect.poll(sel).toBe(c.id);
  // (round the end of the list)
  await page.keyboard.press("]");
  await expect.poll(sel).toBe(a.id);
  await page.keyboard.press("[");
  await expect.poll(sel).toBe(c.id);
  await page.getByTestId("hole-prev").click();
  await expect.poll(sel).toBe(b.id);
  // AltGr types [ and ] on many keyboards (Ctrl+Alt on Windows)
  await page.keyboard.press("Control+Alt+BracketRight");
  await expect.poll(sel).toBe(c.id);
  // (and what else it types is no shortcut: the hole stays)
  await page.keyboard.press("Control+Alt+Backspace");
  await page.waitForTimeout(300);
  expect((await course(page)).holes).toHaveLength(3);
});

plainHoles("a tee pad on sloping ground tilts with it (up to 8 degrees), raised clear and built down: the ground never cuts through", () => {
  const tee = { ...createTee("h", { x: 100, y: 100 }), padLength: 12, padWidth: 5 };
  // A gentle slope, a steep one (1 ft every 3 ft) with a hump under the pad's back corner
  const grounds = [(x: number) => (x - 100) / 20, (x: number, y: number) => (x - 100) / 3 + (Math.hypot(x - 95, y - 98) < 2 ? 1 : 0)];
  for (const [gi, ground] of grounds.entries()) for (const aim of [0, 35, 90, 200]) {
    const obj = createTeePad(tee, 1);
    obj.position.set(tee.x, ground(tee.x, tee.y), tee.y);
    obj.rotation.set(0, (-aim * Math.PI) / 180, 0);
    fitTeePad(obj, tee, aim, ground);
    obj.updateMatrixWorld(true);
    const deck = obj.getObjectByName("tee-deck")!;
    const slab = obj.getObjectByName("tee-pad") as THREE.Mesh;
    const half = (0.35 * slab.scale.y) / 2;
    // Everywhere under the pad, the ground is below its top and above its bottom (in the pad's own frame)
    const a = (aim * Math.PI) / 180;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 5; j++) {
      const lx = i - 6, lz = j - 2.5;
      const x = tee.x + lx * Math.cos(a) - lz * Math.sin(a), y = tee.y + lx * Math.sin(a) + lz * Math.cos(a);
      const local = deck.worldToLocal(new THREE.Vector3(x, ground(x, y), y));
      plainHolesExpect(local.y).toBeLessThan(slab.position.y + half);
      plainHolesExpect(local.y).toBeGreaterThan(slab.position.y - half);
    }
    const tilt = Math.max(Math.abs(deck.rotation.x), Math.abs(deck.rotation.z));
    plainHolesExpect(tilt).toBeLessThanOrEqual((8 * Math.PI) / 180 + 1e-9);
    // (a gentle slope: it simply lies on it, as thin as on flat ground)
    if (gi === 0) plainHolesExpect(slab.scale.y).toBeLessThan(1.6);
  }
  // On flat ground: flat and thin
  const flat = createTeePad(tee, 1);
  fitTeePad(flat, tee, 0, () => 5);
  plainHolesExpect((flat.getObjectByName("tee-pad") as THREE.Mesh).scale.y).toBeCloseTo(0.5 / 0.35, 2);
  plainHolesExpect(flat.getObjectByName("tee-deck")!.rotation.z).toBeCloseTo(0, 6);
  // The sign's board in front of its posts: no post through it
  const sign = (flat.userData.pad as { sign: THREE.Object3D }).sign;
  flat.updateMatrixWorld(true);
  const parts = sign.children.map(m => new THREE.Box3().setFromObject(m));
  const board = parts.reduce((b, p) => (p.max.y - p.min.y < b.max.y - b.min.y ? p : b));
  const posts = parts.filter(p => p !== board);
  plainHolesExpect(posts).toHaveLength(2);
  for (const p of posts) {
    plainHolesExpect(p.intersectsBox(board)).toBe(false);
    plainHolesExpect(p.max.y).toBeGreaterThan(board.min.y);
  }
});

plainHoles("each tee of a hole has a line of play of its own to the basket, past the turns it is already beyond", () => {
  const hole = newHole({ doglegs: [{ x: 300, y: 100 }] });
  const main = { ...createTee(hole.id, { x: 100, y: 100 }), level: "blue" as const };
  const ahead = { ...createTee(hole.id, { x: 320, y: 140 }), level: "red" as const };
  const beside = { ...createTee(hole.id, { x: 110, y: 160 }), level: "white" as const };
  const basket = { x: 500, y: 300 };
  const doc = { items: [main, ahead, beside] };
  const lines = teeLines(doc, hole, [{ x: 100, y: 100 }, { x: 300, y: 100 }, basket], main.id);
  plainHolesExpect(lines).toHaveLength(3);
  plainHolesExpect(lines[0]).toEqual([{ x: 100, y: 100 }, { x: 300, y: 100 }, basket]);
  // (a tee beyond the turn goes straight on; one beside the main tee through the turn)
  const fromAhead = lines.find(l => l[0].x === 320)!;
  plainHolesExpect(fromAhead).toEqual([{ x: 320, y: 140 }, basket]);
  const fromBeside = lines.find(l => l[0].x === 110)!;
  plainHolesExpect(fromBeside).toEqual([{ x: 110, y: 160 }, { x: 300, y: 100 }, basket]);
});

test("a hole with two tees has two fairways, drawn as one where they overlap", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  await page.evaluate(id => {
    const w = window as any;
    const d = w.__dgCourse();
    const tee = d.items.find((i: any) => i.type === "tee" && i.holeId === id);
    w.__dgEditor().set({ activeHoleId: id, teeLevel: "red" });
    w.__dgActions.placeAt("add-tee", { x: tee.x + 120, y: tee.y + 40 });
    w.__dgActions.select(null);
  }, hole.id);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "tee").length).toBe(2);
  const fair = () => page.evaluate(id => {
    const g = (window as any).__dgView.scene.getObjectByName(`fair:${id}`);
    if (!g) return null;
    const meshes = g.children.filter((c: any) => c.isMesh && !c.isLine2);
    return { meshes: meshes.length, once: meshes.every((m: any) => m.material.stencilWrite && m.material.stencilFunc === 517) };
  }, hole.id);
  await expect.poll(fair).toEqual({ meshes: 2, once: true });
});

test("a tee or basket picked opens its hole's panel, with it opened up under Tees and baskets", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 400, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  const tee = await page.evaluate(id => (window as any).__dgCourse().items.find((i: any) => i.type === "tee" && i.holeId === id).id, hole.id);
  await page.evaluate(id => (window as any).__dgActions.select(id), tee);
  const insp = page.getByTestId("inspector");
  await expect(insp.getByTestId("inspector-title")).toHaveText("Hole 1");
  await expect(page.getByTestId("selection-part")).toHaveText("Blue tee");
  await expect(insp.getByTestId("hole-part-settings")).toHaveCount(1);
  await expect(insp.getByRole("radiogroup", { name: "Tee color" })).toBeVisible();
  // (the hole's own settings right there too)
  await expect(insp.getByRole("radiogroup", { name: "Par" })).toBeVisible();
  // The basket's row: it opens instead, and it's the one picked on the map
  await insp.getByTestId("hole-part-basket").click();
  await expect(insp.getByRole("radiogroup", { name: "Pin position" })).toBeVisible();
  await expect(insp.getByRole("radiogroup", { name: "Tee color" })).toHaveCount(0);
  const basket = await page.evaluate(id => (window as any).__dgCourse().items.find((i: any) => i.type === "basket" && i.holeId === id).id, hole.id);
  expect((await editorState(page)).selectedId).toBe(basket);
  // Clicked again: closed, and the hole is the pick
  await insp.getByTestId("hole-part-basket").click();
  await expect(insp.getByTestId("hole-part-settings")).toHaveCount(0);
  expect((await editorState(page)).selectedId).toBe(hole.id);
});

test("a tip on the map waits for the pointer to rest on a point, and never shows while it's dragged", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 400, y: 600 }, { x: 800, y: 600 });
  // (the pointer off the new basket it rested on, and long enough for any tip of it to be gone)
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  const mid = page.getByTestId("handle-mid").first();
  await expect(mid).toBeVisible();
  const tip = page.getByTestId("tooltip");
  const b = (await mid.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(700);
  await expect(tip).not.toHaveClass(/show/);
  await expect(tip).toHaveClass(/show/, { timeout: 3000 });
  await expect(tip).toContainText("Drag to bend the hole here");
  // (pressed and dragged: gone, and not back while dragging)
  await page.mouse.down();
  await expect(tip).not.toHaveClass(/show/);
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + 40, { steps: 6 });
  await page.waitForTimeout(1800);
  await expect(tip).not.toHaveClass(/show/);
  await page.mouse.up();
});

test("a tip on a button at a panel's edge stays inside the panel (and the window)", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  const insp = page.getByTestId("inspector");
  // (the close button, in the panel's top right corner)
  await insp.getByRole("button", { name: "Close" }).hover();
  const tip = page.getByTestId("tooltip");
  await expect(tip).toHaveClass(/show/);
  await page.waitForTimeout(200);
  const t = (await tip.boundingBox())!, p = (await insp.boundingBox())!;
  expect(t.x).toBeGreaterThanOrEqual(p.x);
  expect(t.x + t.width).toBeLessThanOrEqual(p.x + p.width + 0.5);
  expect(t.y).toBeGreaterThanOrEqual(p.y);
  expect(t.y + t.height).toBeLessThanOrEqual(p.y + p.height + 0.5);
});
