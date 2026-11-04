// Picking several things at once: a box (Shift+drag, or the map's box button), Shift+click,
// Ctrl+A; moving, nudging, duplicating, locking and deleting them together, each one undo step;
// whole holes among them; a finger with the box button.
import { test, expect, addHole, blankCourse, clickPlan, course, drag, editorState, screenOf, touchDrag } from "./fixtures";
import { devices, type Page } from "@playwright/test";

type XY = { x: number; y: number };
const BENCHES: XY[] = [{ x: 400, y: 400 }, { x: 470, y: 420 }, { x: 420, y: 480 }];

/** Benches at BENCHES, and an OB area reaching well past them; nothing selected, Select tool. */
async function benchesOnArea(page: Page) {
  await blankCourse(page);
  await page.evaluate(() => {
    (window as any).__dgActions.addDrawn("area", [{ x: 250, y: 250 }, { x: 750, y: 250 }, { x: 750, y: 750 }, { x: 250, y: 750 }]);
  });
  await page.keyboard.press("a");
  for (const p of BENCHES) await clickPlan(page, p.x, p.y);
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await expect.poll(async () => (await editorState(page)).tool).toBe("select");
  return (await course(page)).items.filter((i: any) => i.type === "amenity").map((i: any) => i.id as string);
}

const group = async (page: Page) => ((await editorState(page)).group as string[]).slice().sort();
const benches = async (page: Page) => (await course(page)).items.filter((i: any) => i.type === "amenity").map((i: any) => ({ x: i.x, y: i.y }));

/** Shift+drag on the map between two plan points. */
async function shiftBox(page: Page, a: XY, b: XY) {
  await page.keyboard.down("Shift");
  await drag(page, await screenOf(page, a.x, a.y), await screenOf(page, b.x, b.y));
  await page.keyboard.up("Shift");
}

test("Shift+drag picks what's inside the box (not an area reaching past it); dragging one moves them all, one undo step", async ({ page }) => {
  const ids = await benchesOnArea(page);
  await shiftBox(page, { x: 350, y: 350 }, { x: 540, y: 540 });
  await expect.poll(() => group(page)).toEqual(ids.slice().sort());
  expect((await editorState(page)).selectedId).toBeNull();
  await expect(page.getByTestId("select-box")).toHaveCount(0);
  await expect(page.getByTestId("inspector-title")).toHaveText("3 selected");
  await expect(page.getByTestId("group-kinds")).toContainText("×3");
  // Each one marked as selected on the map
  await expect(page.locator('[data-testid="amenity-chip"].sel')).toHaveCount(3);
  // Dragging one of them takes the others along, by the same amount
  const before = await benches(page);
  const chip = (await page.locator('[data-testid="amenity-chip"]').first().boundingBox())!;
  const from = { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 };
  const step = (await screenOf(page, 450, 400)).x - (await screenOf(page, 400, 400)).x;
  await drag(page, from, { x: from.x + step, y: from.y });
  await expect.poll(async () => (await benches(page))[2].x - before[2].x).toBeGreaterThan(40);
  const after = await benches(page);
  for (let i = 0; i < 3; i++) {
    expect(after[i].x - before[i].x).toBeCloseTo(50, -1);
    expect(after[i].y - before[i].y).toBeCloseTo(0, -1);
  }
  // The area stayed where it was, and the move undoes in one step
  expect((await course(page)).items.find((i: any) => i.type === "area").points[0]).toEqual({ x: 250, y: 250 });
  await page.keyboard.press("Control+z");
  await expect.poll(() => benches(page)).toEqual(before);
});

test("Shift+click adds a thing and takes it out; arrows nudge them all; Esc picks nothing", async ({ page }) => {
  const ids = await benchesOnArea(page);
  // (by id: a chip is drawn again, last, when it is picked)
  const chips = { nth: (i: number) => page.locator(`[data-item-id="${ids[i]}"]`) };
  await chips.nth(0).click();
  expect((await editorState(page)).selectedId).toBe(ids[0]);
  await chips.nth(1).click({ modifiers: ["Shift"] });
  await expect.poll(() => group(page)).toEqual([ids[0], ids[1]].sort());
  await chips.nth(2).click({ modifiers: ["Shift"] });
  await expect.poll(async () => (await group(page)).length).toBe(3);
  await chips.nth(1).click({ modifiers: ["Shift"] });
  await expect.poll(() => group(page)).toEqual([ids[0], ids[2]].sort());
  // Shift+click on the last but one: that one alone stays, simply selected
  await chips.nth(2).click({ modifiers: ["Shift"] });
  await expect.poll(async () => (await editorState(page)).selectedId).toBe(ids[0]);
  expect(await group(page)).toEqual([]);
  // Two again, nudged together
  await chips.nth(2).click({ modifiers: ["Shift"] });
  const before = await benches(page);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await benches(page))[0].x).toBe(before[0].x + 10);
  expect((await benches(page))[2].x).toBe(before[2].x + 10);
  expect((await benches(page))[1].x).toBe(before[1].x);
  await page.keyboard.press("Escape");
  await expect.poll(() => group(page)).toEqual([]);
  await expect(page.getByTestId("inspector")).toHaveCount(0);
});

test("delete, duplicate and lock the things picked together, each one step; Ctrl+A picks everything", async ({ page }) => {
  const ids = await benchesOnArea(page);
  await shiftBox(page, { x: 350, y: 350 }, { x: 540, y: 540 });
  await expect.poll(async () => (await group(page)).length).toBe(3);
  // Duplicate: three copies, picked in their place
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await benches(page)).length).toBe(6);
  const copies = await group(page);
  expect(copies).toHaveLength(3);
  expect(copies.some(id => ids.includes(id))).toBe(false);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await benches(page)).length).toBe(3);
  await page.evaluate(i => (window as any).__dgActions.pickGroup(i), ids);
  // Lock: a locked one stays put while the others move, and isn't deleted
  await page.getByTestId("inspector").getByRole("button", { name: "Lock", exact: true }).click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.locked).length).toBe(3);
  await page.getByTestId("inspector").getByRole("button", { name: "Unlock" }).click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.locked).length).toBe(0);
  // Delete: all three in one step, with Undo
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await benches(page)).length).toBe(0);
  const toast = page.getByRole("status").filter({ hasText: "Deleted 3 things." });
  await expect(toast).toBeVisible();
  expect((await course(page)).items.filter((i: any) => i.type === "area")).toHaveLength(1);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await benches(page)).length).toBe(3);
  // Ctrl+A: everything not locked
  await page.keyboard.press("Control+a");
  await expect.poll(async () => (await group(page)).length).toBe(4);
});

test("the map's box button: a plain drag draws the box; a whole hole comes along with its bend, and copies as a new hole", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 500 }, { x: 600, y: 500 });
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await page.getByTestId("bend-left").click();
  await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBe(1);
  await page.keyboard.press("Escape");
  const box = page.getByTestId("drag-select");
  await expect(box).toHaveAccessibleName("Select with a box");
  await box.click();
  expect((await editorState(page)).dragSelect).toBe(true);
  await expect(box).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tool-hint")).toContainText("Drag a box");
  // A plain drag: a box, not a move of the map
  const view0 = await page.evaluate(() => (window as any).__dgView.toClient(450, 500));
  await drag(page, await screenOf(page, 250, 380), await screenOf(page, 650, 560));
  await expect.poll(async () => (await group(page)).length).toBe(2);
  const view1 = await page.evaluate(() => (window as any).__dgView.toClient(450, 500));
  expect(Math.hypot(view1.x - view0.x, view1.y - view0.y)).toBeLessThan(1);
  await expect(page.getByTestId("group-kinds")).toHaveText("Hole 1");
  // Moved together: the tee, the basket and the bend
  const bend0 = (await course(page)).holes[0].doglegs[0];
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await course(page)).holes[0].doglegs[0].y).toBeCloseTo(bend0.y + 10, 5);
  expect((await course(page)).items.find((i: any) => i.type === "tee").y).toBeCloseTo(510, 3);
  expect((await course(page)).items.find((i: any) => i.type === "basket").y).toBeCloseTo(510, 3);
  // Duplicated: a second hole, with its own tee and basket
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await course(page)).holes.length).toBe(2);
  const doc = await course(page);
  const h2 = doc.holes[1];
  expect(doc.items.filter((i: any) => i.holeId === h2.id).map((i: any) => i.type).sort()).toEqual(["basket", "tee"]);
  expect(h2.doglegs).toHaveLength(1);
  // Back to moving the map: the same button again
  await box.click();
  expect((await editorState(page)).dragSelect).toBe(false);
  await expect(box).toHaveAttribute("aria-pressed", "false");
});

test.describe("touch", () => {
  const { defaultBrowserType: _b, ...phone } = devices["iPhone 13"];
  test.use(phone);

  test("with Select on, a finger draws the box and a tap adds or takes out one thing", async ({ page }) => {
    await page.getByTestId("welcome-blank").click();
    await page.evaluate(() => {
      const a = (window as any).__dgActions;
      const ed = (window as any).__dgEditor();
      ed.set({ tool: "add-amenity" });
      a.placeAt("add-amenity", { x: 400, y: 400 });
      a.placeAt("add-amenity", { x: 470, y: 420 });
      a.placeAt("add-amenity", { x: 700, y: 700 });
      a.select(null);
      ed.set({ tool: "select" });
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(300);
    // The map's own button turns it on
    await page.getByTestId("touch-drag-select").tap();
    await expect.poll(async () => (await editorState(page)).dragSelect).toBe(true);
    // (a bar over the map's foot says how it works, with Done; the map's buttons make room for it,
    // the box button among them while it fits)
    await expect(page.getByTestId("box-bar")).toBeVisible();
    if (await page.getByTestId("touch-drag-select").count()) await expect(page.getByTestId("touch-drag-select")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 300, minY: 300, maxX: 800, maxY: 1000 }, { animate: false }));
    await page.waitForTimeout(300);
    const ids = (await course(page)).items.filter((i: any) => i.type === "amenity").map((i: any) => i.id as string);
    await touchDrag(page, await screenOf(page, 360, 360), await screenOf(page, 520, 470));
    await expect.poll(() => group(page)).toEqual([ids[0], ids[1]].sort());
    await expect(page.getByTestId("sheet-title")).toHaveText("2 selected");
    // A tap on the third puts it in; a tap on it again takes it out
    const third = (await page.locator(`[data-item-id="${ids[2]}"]`).boundingBox())!;
    await page.touchscreen.tap(third.x + third.width / 2, third.y + third.height / 2);
    await expect.poll(async () => (await group(page)).length).toBe(3);
    await page.touchscreen.tap(third.x + third.width / 2, third.y + third.height / 2);
    await expect.poll(async () => (await group(page)).length).toBe(2);
    // (Delete all 2, at the end of the things picked's bar)
    await page.getByTestId("group-strip").getByTestId("menu-delete").tap();
    await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "amenity").length).toBe(1);
  });
});

test("copy and paste: Ctrl+V where the pointer is on the map; off the map, next to the original (a group too), never on another copy; Ctrl+X cuts; Paste here", async ({ page }) => {
  const ids = await benchesOnArea(page);
  await page.locator(`[data-item-id="${ids[0]}"]`).click();
  await page.keyboard.press("Control+c");
  // With the pointer on the map: there
  const away = await screenOf(page, 650, 650);
  await page.mouse.move(away.x, away.y, { steps: 3 });
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await benches(page)).length).toBe(4);
  const there = (await course(page)).items.find((i: any) => i.type === "amenity" && !ids.includes(i.id));
  expect(Math.hypot(there.x - 650, there.y - 650)).toBeLessThan(4);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await benches(page)).length).toBe(3);
  // With the pointer off the map (over the top bar): next to the original
  await page.mouse.move(away.x, 8, { steps: 3 });
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await benches(page)).length).toBe(4);
  const pasted = (await course(page)).items.find((i: any) => i.type === "amenity" && !ids.includes(i.id));
  expect(Math.hypot(pasted.x - 430, pasted.y - 430)).toBeLessThan(2);
  expect((await editorState(page)).selectedId).toBe(pasted.id);
  // Again: beside that copy, not on it
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await benches(page)).length).toBe(5);
  expect((await benches(page)).some(b => Math.hypot(b.x - 460, b.y - 460) < 2)).toBe(true);
  // A group keeps its arrangement, next to where it was (past the copies already there)
  await page.evaluate(i => (window as any).__dgActions.pickGroup(i), ids);
  await expect.poll(async () => (await group(page)).length).toBe(3);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await benches(page)).length).toBe(8);
  const after = await benches(page);
  const copiedBy = (d: number) => BENCHES.every(b => after.some(p => Math.hypot(p.x - b.x - d, p.y - b.y - d) < 2));
  expect(copiedBy(90)).toBe(true);
  // Cut: gone, and pasted back where it was
  await page.keyboard.press("Control+x");
  await expect.poll(async () => (await benches(page)).length).toBe(5);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await benches(page)).length).toBe(8);
  const back = await benches(page);
  expect(BENCHES.every(b => back.some(p => Math.hypot(p.x - b.x - 90, p.y - b.y - 90) < 2))).toBe(true);
  // Paste here: at a right-click
  const spot = await screenOf(page, 650, 650);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Paste here" }).click();
  await expect.poll(async () => (await benches(page)).length).toBe(11);
  expect((await benches(page)).some(b => Math.hypot(b.x - 650, b.y - 650) < 60)).toBe(true);
});

test("duplicating the same thing twice puts the second copy beside the first, not on it", async ({ page }) => {
  const ids = await benchesOnArea(page);
  for (let k = 0; k < 2; k++) {
    await page.evaluate(id => (window as any).__dgActions.select(id), ids[0]);
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await benches(page)).length).toBe(4 + k);
  }
  const all = await benches(page);
  expect(all.some(b => Math.hypot(b.x - 430, b.y - 430) < 2)).toBe(true);
  expect(all.some(b => Math.hypot(b.x - 460, b.y - 460) < 2)).toBe(true);
});
