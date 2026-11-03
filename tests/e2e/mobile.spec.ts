// Phones and tablets: the step bar, the bottom sheet (peek, half, full), tools by tap with Undo,
// Cancel and Done, the selection in the sheet, long-press menus, the Design preview fitted to the
// screen, the tee view, a phone on its side, a tablet, and the desktop layout left as it was.
import { test, expect, classicLook, course, editorState, tapPlan, longPress, touchDrag, touches, pinch, screenOf, planAt } from "./fixtures";
import { devices, type Page } from "@playwright/test";
import { writeFileSync } from "fs";
import { createBasket, createEmptyCourse, createTee, newHole } from "../../src/lib/course";

/** A Playwright device in Chromium (the device list's iPhones and iPads say WebKit). */
const device = (name: string) => {
  const { defaultBrowserType: _browser, ...d } = devices[name];
  return d;
};
const nav = (page: Page) => page.getByRole("navigation", { name: "Steps" });
const sheet = (page: Page) => page.getByTestId("sheet");
const detent = (page: Page) => sheet(page).getAttribute("data-detent");
/** Settles after a sheet move (its slide takes 0.3 s). */
const settle = (page: Page) => page.waitForTimeout(450);
/** The glass bar of what's picked (its pill and its row of settings). */
const bar = (page: Page, testid = "item-strip") => page.getByTestId(testid);
/** A setting's menu or dial, open above the bar. */
const menu = (page: Page) => page.getByTestId("bar-menu");

/** Starts on open ground, with the Hole tool. */
async function openGround(page: Page) {
  await page.getByTestId("welcome-blank").click();
  await expect.poll(async () => (await editorState(page)).tool).toBe("add-hole");
}

/** A hole from (300, 500) to (600, 500), made directly; back to the Select tool, nothing selected. */
async function oneHole(page: Page) {
  await openGround(page);
  await page.evaluate(() => {
    (window as any).__dgActions.addHole({ x: 300, y: 500 }, { x: 600, y: 500 }, "blue");
    (window as any).__dgActions.select(null);
    (window as any).__dgEditor().set({ tool: "select" });
  });
  // (Once the panels have their size: the map's size follows them)
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__dgView.fitCourse(false));
  await page.waitForTimeout(300);
}

test.describe("phone", () => {
  test.use(device("iPhone 13"));

  test("a hole picked: its bar under a whole-screen map, its dial widening the fairway live (one undo step); holding open ground offers a tee, a bend, a new hole", async ({ page }) => {
    await oneHole(page);
    const hole = (await course(page)).holes[0];
    await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
    await expect(bar(page, "hole-strip")).toBeVisible();
    await settle(page);
    // (no sheet, no steps, no tools: the map has the screen down to the bar)
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    await expect(page.getByTestId("tool-strip")).toHaveCount(0);
    // The hole in the map above the bar
    const barTop = (await bar(page, "hole-strip").boundingBox())!.y;
    expect(barTop).toBeGreaterThan(page.viewportSize()!.height * 0.75);
    const mid = await screenOf(page, 450, 500);
    expect(mid.y).toBeLessThan(barTop);
    // Fairway: the dial dragged left widens it as it goes, one undo step in all
    await page.getByTestId("strip-fairway").tap();
    const dial = page.getByTestId("dial");
    // (the menu grown out of its button all the way before the dial's place is measured)
    await expect(dial).toBeVisible();
    await page.waitForTimeout(400);
    const w0 = (await course(page)).holes[0].fairwayWidth;
    const past0 = await page.evaluate(() => (window as any).__dgHistory().past);
    const b = (await dial.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 90, b.y + b.height / 2, { steps: 6 });
    await expect.poll(async () => (await course(page)).holes[0].fairwayWidth).toBe(w0 + 10);
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).__dgHistory().past)).toBe(past0 + 1);
    // Par: its choices grow out of its button; a pick closes them
    await page.getByTestId("strip-par").tap();
    await menu(page).getByRole("radio", { name: "Par 4" }).tap();
    await expect.poll(async () => (await course(page)).holes[0].par).toBe(4);
    await expect(menu(page)).toHaveCount(0);
    // Holding open ground beside the hole: a tee there, a bend
    // (open ground a little above the hole on screen, clear of its fairway)
    const m = await screenOf(page, 450, 500);
    const g = { x: m.x, y: m.y - 70 };
    await longPress(page, g);
    await expect(page.getByTestId("map-menu-here")).toBeVisible();
    await page.getByRole("menuitem", { name: "Bend the hole here" }).tap();
    await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBe(1);
    const m2 = await screenOf(page, 330, 500);
    await longPress(page, { x: m2.x, y: m2.y - 70 });
    await page.getByRole("menuitem", { name: "Add a tee here" }).tap();
    await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "tee").length).toBe(2);
  });

  test("where you are: the blue dot follows you, and a new hole's tee and basket go where you stand", async ({ page, context }) => {
    await openGround(page);
    // (the site placed on the earth; the phone's GPS at plan spots)
    const bounds = { north: 40, south: 39.99, west: -90, east: -89.99 };
    await page.evaluate(b => (window as any).__dgActions.site({ bounds: b }), bounds);
    const { width, height } = (await course(page)).canvas;
    const geo = (x: number, y: number) => ({ latitude: bounds.north - (y / height) * (bounds.north - bounds.south), longitude: bounds.west + (x / width) * (bounds.east - bounds.west), accuracy: 2 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(geo(300, 500));
    await page.getByTestId("locate-me").tap();
    await expect(page.getByTestId("my-location")).toBeVisible();
    // (followed: the dot in the map's middle, about)
    const box = (await page.getByTestId("my-location").boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(vp.width * 0.25);
    // The Hole tool offers your spot; the tee there, then walk to the basket
    await expect(page.getByTestId("here-bar")).toContainText("Tee here");
    await page.getByTestId("here-button").tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().drawPoints)).toBe(1);
    await context.setGeolocation(geo(600, 500));
    await expect(page.getByTestId("draw-bar")).toContainText("Basket here");
    // (once the dot has come to the new spot)
    await expect.poll(async () => {
      const d = (await page.getByTestId("my-location").boundingBox())!, s = await screenOf(page, 600, 500);
      return Math.hypot(d.x + d.width / 2 - s.x, d.y + d.height / 2 - s.y);
    }).toBeLessThan(20);
    await page.getByTestId("here-button").tap();
    await expect.poll(async () => (await course(page)).holes.length).toBe(1);
    const d = await course(page);
    const tee = d.items.find((i: any) => i.type === "tee"), basket = d.items.find((i: any) => i.type === "basket");
    expect(Math.hypot(tee.x - 300, tee.y - 500)).toBeLessThan(6);
    expect(Math.hypot(basket.x - 600, basket.y - 500)).toBeLessThan(6);
    // How far to the basket, under the dot
    await expect(page.getByTestId("my-location-tag")).toContainText("to the basket");
    // Off again: no dot, no offer
    await page.evaluate(() => (window as any).__dgEditor().set({ tool: "add-hole" }));
    await page.getByTestId("locate-me").tap();
    await expect(page.getByTestId("my-location")).toHaveCount(0);
    await expect(page.getByTestId("here-bar")).toHaveCount(0);
  });

  test("where you stand, for everything: a bench put there, an OB line corner by corner, a wood walked round, and Move here says how far first", async ({ page, context }) => {
    await openGround(page);
    const bounds = { north: 40, south: 39.99, west: -90, east: -89.99 };
    await page.evaluate(b => (window as any).__dgActions.site({ bounds: b }), bounds);
    const { width, height } = (await course(page)).canvas;
    const geo = (x: number, y: number) => ({ latitude: bounds.north - (y / height) * (bounds.north - bounds.south), longitude: bounds.west + (x / width) * (bounds.east - bounds.west), accuracy: 2 });
    const dotAt = async (x: number, y: number) => expect.poll(async () => {
      const d = (await page.getByTestId("my-location").boundingBox())!, s = await screenOf(page, x, y);
      return Math.hypot(d.x + d.width / 2 - s.x, d.y + d.height / 2 - s.y);
    }).toBeLessThan(20);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(geo(300, 400));
    await page.getByTestId("locate-me").tap();
    await expect(page.getByTestId("my-location")).toBeVisible();
    // Any tool that puts a thing down: Put one here
    await page.evaluate(() => (window as any).__dgEditor().set({ tool: "add-amenity", amenityKind: "bench" }));
    await page.getByTestId("put-here").tap();
    await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "amenity").length).toBe(1);
    const bench = (await course(page)).items.find((i: any) => i.type === "amenity");
    expect(Math.hypot(bench.x - 300, bench.y - 400)).toBeLessThan(6);
    // A line, a corner where you stand at each
    await page.evaluate(() => (window as any).__dgEditor().set({ tool: "draw-line", lineKind: "ob", drawShape: "points" }));
    await page.getByTestId("point-here").tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().drawPoints)).toBe(1);
    await context.setGeolocation(geo(500, 400));
    await dotAt(500, 400);
    await page.getByTestId("point-here").tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().drawPoints)).toBe(2);
    await page.getByTestId("draw-done").tap();
    await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line" && i.kind === "ob").length).toBe(1);
    const ob = (await course(page)).items.find((i: any) => i.type === "line" && i.kind === "ob");
    expect(Math.hypot(ob.points[1].x - 500, ob.points[1].y - 400)).toBeLessThan(6);
    // A wood walked round: a corner every 10 ft or so, none while standing still
    await page.evaluate(() => (window as any).__dgEditor().set({ tool: "draw-area", areaKind: "woods", drawShape: "points" }));
    await page.getByTestId("walk-it").tap();
    for (const [x, y] of [[500, 400], [500, 470], [560, 470], [560, 400]]) {
      await context.setGeolocation(geo(x, y));
      await dotAt(x, y);
    }
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().drawPoints)).toBeGreaterThanOrEqual(4);
    await page.getByTestId("draw-done").tap();
    await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area" && i.kind === "woods").length).toBe(1);
    // Move here: where it goes and how far, then Move it
    await page.evaluate(() => (window as any).__dgEditor().set({ tool: "select" }));
    await page.evaluate(id => (window as any).__dgActions.select(id), bench.id);
    // (the first setting on its bar while your location is on)
    await page.getByTestId("strip-movehere").tap();
    await page.getByTestId("move-here").tap();
    await expect(page.getByTestId("move-here-check")).toContainText("moves");
    await page.getByTestId("move-here-go").tap();
    await expect.poll(async () => { const b = (await course(page)).items.find((i: any) => i.id === bench.id); return Math.hypot(b.x - 560, b.y - 400); }).toBeLessThan(8);
  });

  test("a course file opens from the menu (which closes while the file is picked)", async ({ page }) => {
    await openGround(page);
    const doc = createEmptyCourse();
    doc.name = "Pocket Course";
    const h = newHole();
    doc.holes.push(h);
    doc.items.push(createTee(h.id, { x: 300, y: 500 }), createBasket(h.id, { x: 600, y: 500 }));
    const path = test.info().outputPath("pocket.dgcourse.json");
    writeFileSync(path, JSON.stringify(doc));
    await page.getByTestId("app-menu-button").tap();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: /Open a course file/ }).tap();
    const chooser = await choosing;
    await expect(page.getByTestId("app-menu")).toHaveCount(0);
    await chooser.setFiles(path);
    await expect.poll(async () => (await course(page)).name).toBe("Pocket Course");
    expect((await course(page)).holes).toHaveLength(1);
  });

  test("the map's buttons all sit above the step's row and its panel; the compass shows once the map is turned", async ({ page }) => {
    await oneHole(page);
    const above = async () => {
      await settle(page);
      const top = (await (await sheet(page).count() ? sheet(page) : page.getByTestId("tool-strip")).boundingBox())!.y;
      const buttons = page.getByTestId("map-controls").locator("button");
      const n = await buttons.count();
      expect(n).toBeGreaterThan(1);
      for (let i = 0; i < n; i++) {
        const b = (await buttons.nth(i).boundingBox())!;
        expect(b.y + b.height).toBeLessThanOrEqual(top);
      }
    };
    await above();
    await expect(page.getByLabel("Show the whole course")).toBeVisible();
    await expect(page.getByTestId("compass")).toHaveCount(0);
    await page.evaluate(() => (window as any).__dgView.rotateBy(30));
    await expect(page.getByTestId("compass")).toBeVisible();
    await above();
    // (with the panel lower, more of them)
    await nav(page).getByRole("button", { name: /Design/ }).tap();
    await above();
  });

  test("the View list rises from the bottom over the panel and the step bar, every switch in it in reach", async ({ page }) => {
    await oneHole(page);
    await page.getByTestId("map-controls").getByTestId("scene-button").tap();
    const list = page.getByTestId("scene-panel");
    await expect(list).toBeVisible();
    await settle(page);
    const b = (await list.boundingBox())!, vh = page.viewportSize()!.height, vw = page.viewportSize()!.width;
    expect(b.y + b.height).toBeLessThanOrEqual(vh + 1);
    expect(b.width).toBeGreaterThan(vw * 0.9);
    // (nothing over it: the spot in the middle of its bottom row is the list's own)
    const own = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-testid=scene-panel]"), [b.x + b.width / 2, b.y + b.height - 30]);
    expect(own).toBe(true);
    // A switch in it works and keeps it open; a tap above it closes it
    await list.getByRole("checkbox").first().tap();
    await expect(list).toBeVisible();
    await page.mouse.click(vw / 2, 40);
    await expect(list).toHaveCount(0);
  });

  test("a selected hole's header steps to the next and previous hole", async ({ page }) => {
    await oneHole(page);
    await page.evaluate(() => (window as any).__dgActions.addHole({ x: 300, y: 700 }, { x: 600, y: 700 }, "blue"));
    await page.evaluate(() => (window as any).__dgActions.select((window as any).__dgCourse().holes[0].id));
    await expect(page.getByTestId("sheet-title")).toHaveText("Hole 1");
    await page.getByTestId("selection-header").getByTestId("hole-next").tap();
    await expect(page.getByTestId("sheet-title")).toHaveText("Hole 2");
    const next = (await page.getByTestId("selection-header").getByTestId("hole-next").boundingBox())!;
    expect(next.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("selection-header").getByTestId("hole-prev").tap();
    await expect(page.getByTestId("sheet-title")).toHaveText("Hole 1");
  });

  test("the step bar switches steps and the sheet shows each one (the Map step its page and a row of tools instead); no desktop panels", async ({ page }) => {
    await expect(page.getByTestId("side-panel")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Tools" })).toHaveCount(0);
    // (A course with a hole: an empty one shows the welcome card on the Site step instead)
    await oneHole(page);
    const titles: Record<string, string> = { Site: "Your site", Design: "Design", Map: "Map", Export: "Export" };
    for (const [label, title] of Object.entries(titles)) {
      await nav(page).getByRole("button", { name: new RegExp(label) }).tap();
      await expect.poll(async () => (await editorState(page)).step).toBe(label.toLowerCase());
      if (label === "Map") {
        // (no sheet over the page: its settings are a row of tools, each opening a short panel)
        await expect(page.getByTestId("sheet-title")).toHaveCount(0);
        await expect(page.getByTestId("page-tools")).toBeVisible();
        await page.getByTestId("page-tool-fold-paper").tap();
        await expect(page.getByTestId("page-tool-panel")).toContainText("Landscape");
        await expect(page.getByTestId("page-tool-panel").getByTestId("print-layers")).toHaveCount(0);
        await page.getByTestId("page-tool-done").tap();
        await expect(page.getByTestId("page-tool-panel")).toHaveCount(0);
      } else if (label === "Design") {
        // (about the map: its tools in the row over the steps, its panel in its tab)
        await expect(sheet(page)).toHaveCount(0);
        await expect(page.getByTestId("tool-strip")).toBeVisible();
        await expect(page.getByTestId("tool-select")).toHaveCount(0);
      } else await expect(page.getByTestId("sheet-title")).toHaveText(title);
      await expect(nav(page).getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-current", "step");
    }
    // Tapping the step you're on brings its panel up out of the tab, and again puts it away
    await nav(page).getByRole("button", { name: /Design/ }).tap();
    await expect(page.getByTestId("tool-strip")).toBeVisible();
    await nav(page).getByRole("button", { name: /Design/ }).tap();
    await expect.poll(() => detent(page)).toBe("half");
    await expect(page.getByTestId("sheet-title")).toHaveText("Design");
    await expect(page.getByTestId("tool-strip")).toHaveCount(0);
    await nav(page).getByRole("button", { name: /Design/ }).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByTestId("tool-strip")).toBeVisible();
  });

  test("finding the park on a phone: the search in the sheet, then the place on top, the map, and the panel dragged down to give the map the screen, its button still there", async ({ page }) => {
    await page.getByTestId("welcome-find").tap();
    const dialog = page.getByRole("dialog", { name: "Find your park" });
    await page.getByLabel("Search address").fill("Springfield Park");
    await dialog.getByRole("button", { name: /Springfield Park/ }).first().tap();
    await expect(page.getByTestId("site-size")).toBeVisible();
    // A picked place closes the suggestions (they used to open again for the place's own name)
    await page.waitForTimeout(600);
    await expect(dialog.getByRole("button", { name: /Springfield Park/ })).toHaveCount(0);
    const place = (await page.getByRole("button", { name: "Search again" }).boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(place.y).toBeLessThan(vh * 0.15);
    // The panel all the way down: the map has the screen, Import still in reach at the bottom
    const panel = page.getByTestId("import-sheet");
    await panel.getByTestId("sheet-handle").focus();
    await page.keyboard.press("End");
    await expect(panel).toHaveAttribute("data-detent", "peek");
    await settle(page);
    const go = (await page.getByTestId("import-site").boundingBox())!;
    expect(go.y).toBeGreaterThan(vh * 0.7);
    expect(go.y + go.height).toBeLessThanOrEqual(vh);
    await page.getByTestId("import-site").tap();
    // (looking first: Bring it in in the panel's header, as Import was)
    await page.getByTestId("review-bring").tap({ timeout: 60_000 });
    await expect.poll(async () => (await course(page)).background, { timeout: 60_000 }).not.toBeNull();
    await expect.poll(async () => (await editorState(page)).step).toBe("design");
    // (the pointer first: a look round before the first hole)
    await expect.poll(async () => (await editorState(page)).tool).toBe("select");
  });

  test("a step's panel comes up out of its tab, half and full: drag it, tap its handle, or use the arrow keys; at its smallest it goes back into the tab", async ({ page }) => {
    await oneHole(page);
    const design = nav(page).getByRole("button", { name: /Design/ });
    const away = async () => { await expect(sheet(page)).toHaveCount(0); await expect(page.getByTestId("tool-strip")).toBeVisible(); };
    // (Design at rest: its tools over the steps, its panel in its tab)
    await away();
    await design.tap();
    await expect.poll(() => detent(page)).toBe("half");
    const handle = page.getByTestId("sheet-handle");
    const top = async () => (await sheet(page).boundingBox())!.y;
    // Tap: half, full, then back into the tab
    await settle(page);
    await handle.tap();
    await settle(page);
    expect(await detent(page)).toBe("full");
    // At full height a strip of the map (and the top bar) stays in view
    const bar = (await page.getByTestId("top-bar").boundingBox())!;
    expect(await top()).toBeGreaterThanOrEqual(bar.y + bar.height - 4);
    await handle.tap();
    await away();
    // Drag the handle up: it follows the finger, then rests at the nearest height; dragged right
    // down, it goes back into its tab
    await design.tap();
    await expect.poll(() => detent(page)).toBe("half");
    await settle(page);
    let h = (await handle.boundingBox())!;
    await touchDrag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2, y: h.y - 300 }, 16);
    await settle(page);
    expect(await detent(page)).toBe("full");
    // (a flick down goes one height: full to half, then half back into the tab)
    h = (await handle.boundingBox())!;
    await touchDrag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2, y: h.y + 300 }, 16);
    await settle(page);
    expect(await detent(page)).toBe("half");
    h = (await handle.boundingBox())!;
    await touchDrag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2, y: h.y + 300 }, 16);
    await away();
    await settle(page);
    // The keyboard: the handle is a button that takes the arrow keys
    await design.tap();
    await expect.poll(() => detent(page)).toBe("half");
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => detent(page)).toBe("full");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => detent(page)).toBe("half");
    await page.keyboard.press("ArrowDown");
    await away();
    // The list itself: pulled up while the panel isn't at full height, it brings it up; pulled
    // down from its top, it lets it down
    await design.tap();
    await expect.poll(() => detent(page)).toBe("half");
    await settle(page);
    const list = (await page.getByTestId("sheet-body").boundingBox())!;
    const at = { x: list.x + list.width / 2, y: list.y + 40 };
    await touchDrag(page, at, { x: at.x, y: at.y - 200 }, 16);
    await settle(page);
    expect(await detent(page)).toBe("full");
    const list2 = (await page.getByTestId("sheet-body").boundingBox())!;
    const at2 = { x: list2.x + list2.width / 2, y: list2.y + 40 };
    await touchDrag(page, at2, { x: at2.x, y: at2.y + 200 }, 16);
    await settle(page);
    expect(await detent(page)).toBe("half");
  });

  test("a hole laid out with two taps: the tee, then the basket", async ({ page }) => {
    await openGround(page);
    await expect(page.getByTestId("tool-hint")).toContainText("Tap where the tee goes");
    await tapPlan(page, 300, 500);
    await expect(page.getByTestId("draw-bar")).toContainText("Now tap the basket spot");
    await tapPlan(page, 650, 500);
    await expect.poll(async () => (await course(page)).holes.length).toBe(1);
    const doc = await course(page);
    const tee = doc.items.find((i: any) => i.type === "tee");
    const basket = doc.items.find((i: any) => i.type === "basket");
    expect(Math.abs(basket.x - tee.x - 350)).toBeLessThan(6);
    expect(Math.abs(basket.y - tee.y)).toBeLessThan(6);
    await expect(page.getByTestId("draw-bar")).toHaveCount(0);
    // The tool stays on for the next hole; X goes back to Select
    expect((await editorState(page)).tool).toBe("add-hole");
    await page.getByTestId("bar-done").tap();
    expect((await editorState(page)).tool).toBe("select");
  });

  test("an area drawn with taps: Undo takes a point back, Done finishes it", async ({ page }) => {
    await oneHole(page);
    // (on Design already: its tools in the row over the steps)
    await page.locator('[data-tool="rules"]').tap();
    // (what it puts down: Kind, on the tool's bar)
    await page.getByTestId("tool-options").tap();
    await page.getByTestId("area-kind-ob").tap();
    await expect(page.getByTestId("tool-hint")).toHaveText("Tap the corners");
    for (const [x, y] of [[350, 300], [550, 300], [550, 420], [350, 420]]) await tapPlan(page, x, y);
    const done = page.getByTestId("draw-done");
    await expect(done).toContainText("4");
    await page.getByTestId("draw-undo").tap();
    await expect(done).toContainText("3");
    await done.tap();
    await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
    const area = (await course(page)).items.find((i: any) => i.type === "area");
    expect(area.kind).toBe("ob");
    expect(area.points.length).toBe(3);
    expect((await editorState(page)).tool).toBe("select");
    // (the drawn area picked, its bar up: ✓ puts it down, back to the tools)
    await page.getByTestId("bar-done").tap();
    // Cancel drops what is being drawn
    await page.locator('[data-tool="paths"]').tap();
    await tapPlan(page, 300, 250);
    await tapPlan(page, 600, 250);
    await page.getByTestId("draw-cancel").tap();
    await expect(page.getByTestId("draw-bar")).toHaveCount(0);
    expect((await course(page)).items.filter((i: any) => i.type === "line").length).toBe(0);
  });

  test("the app never scrolls as a whole when something low in the sheet is brought into view", async ({ page }) => {
    // (on the Site step, its long panel up at half height)
    await oneHole(page);
    await nav(page).getByRole("button", { name: /Site/ }).tap();
    await expect.poll(() => detent(page)).toBe("half");
    await settle(page);
    const before = (await page.getByTestId("plan").boundingBox())!;
    // The panel's last button is below the screen at half height; a keyboard, a screen
    // reader or find in page brings it into view like this (it once scrolled the whole app up,
    // map, sheet and step bar, with no way back)
    const below = await sheet(page).evaluate(el => {
      const b = [...el.querySelectorAll("button")].pop()!;
      const top = b.getBoundingClientRect().top;
      b.scrollIntoView();
      b.focus();
      return top - innerHeight;
    });
    expect(below).toBeGreaterThan(0);
    await page.waitForTimeout(100);
    expect(await page.locator('[data-layout="phone"]').evaluate(el => el.scrollTop)).toBe(0);
    expect((await page.getByTestId("plan").boundingBox())!.y).toBe(before.y);
    await expect(nav(page)).toBeInViewport({ ratio: 1 });
  });

  test("tapping a hole puts its bar over the map: every setting in its row, its notes too, what can be done with it from its name; ✓ returns to the step", async ({ page }) => {
    await oneHole(page);
    await tapPlan(page, 450, 500);
    await expect(bar(page, "hole-strip")).toBeVisible();
    await expect(page.getByTestId("sheet-title")).toHaveText("Hole 1");
    await expect(page.getByTestId("selection-header")).toContainText("Par 3");
    // (Screen readers hear it: the panel changes without the focus moving)
    await expect(page.getByTestId("announce")).toHaveText("Hole 1 selected");
    // Every setting is in the row, the rarer ones further along (no All settings)
    for (const id of ["par", "fairway", "tees", "pins", "ob", "foliage", "name", "notes", "number"]) await expect(page.getByTestId(`strip-${id}`)).toBeAttached();
    await expect(page.getByTestId("strip-all")).toHaveCount(0);
    await expect(page.getByTestId("bar-more")).toBeVisible();
    await page.getByTestId("bar-more").tap();
    await page.getByTestId("strip-notes").tap();
    await menu(page).getByRole("textbox", { name: "Hole notes" }).fill("Mando left of the oak");
    await page.getByTestId("bar-away").dispatchEvent("pointerdown");
    await expect.poll(async () => (await course(page)).holes[0].notes).toBe("Mando left of the oak");
    // Its name opens what can be done with it
    await page.getByTestId("pill-open").tap();
    await expect(page.getByTestId("pill-menu").getByTestId("menu-zoom")).toBeVisible();
    await page.getByTestId("pill-open").tap();
    await page.getByTestId("bar-done").tap();
    await expect.poll(async () => (await editorState(page)).selectedId).toBeNull();
    await expect(page.getByTestId("tool-strip")).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toBeVisible();
  });

  test("holding a finger on a tee opens its menu (the right-click); Delete there, and Undo", async ({ page }) => {
    await oneHole(page);
    const doc = await course(page);
    const tee = doc.items.find((i: any) => i.type === "tee");
    await longPress(page, await screenOf(page, tee.x, tee.y, 1));
    const menu = page.getByTestId("item-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Blue tee");
    await expect(menu.getByRole("menuitem", { name: "View from this tee" })).toBeVisible();
    // The finger's lift doesn't pick anything in it, and Cancel closes it
    await page.waitForTimeout(200);
    await expect(menu).toBeVisible();
    await page.getByTestId("action-sheet-cancel").tap();
    await expect(menu).toHaveCount(0);
    await longPress(page, await screenOf(page, tee.x, tee.y, 1));
    await page.getByTestId("menu-delete").tap();
    await expect.poll(async () => (await course(page)).items.some((i: any) => i.type === "tee")).toBe(false);
    // (Undo on the top bar, always in reach)
    await page.getByTestId("top-bar").getByTestId("undo").tap();
    await expect.poll(async () => (await course(page)).items.some((i: any) => i.type === "tee")).toBe(true);
    // A short press is a tap: no menu
    await tapPlan(page, 450, 500);
    await page.waitForTimeout(700);
    await expect(menu).toHaveCount(0);
  });

  test("a selected hole's width squares stand clear of its tee: holding the tee still opens its menu", async ({ page }) => {
    await oneHole(page);
    // The hole selected and seen from far, short on the screen (a square once sat on the tee and
    // took its long-press)
    await page.evaluate(() => (window as any).__dgActions.select((window as any).__dgCourse().holes[0].id));
    await page.evaluate(() => (window as any).__dgView.zoomBy(1 / 2.5));
    await page.waitForTimeout(800);
    const tee = (await course(page)).items.find((i: any) => i.type === "tee");
    const at = await screenOf(page, tee.x, tee.y, 1);
    const centers = await page.locator('[data-handle="width"]:visible').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    for (const c of centers) expect(Math.hypot(c.x - at.x, c.y - at.y)).toBeGreaterThanOrEqual(40);
    await longPress(page, at);
    const menu = page.getByTestId("item-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Blue tee");
    await page.getByTestId("action-sheet-cancel").tap();
    // At any zoom, no square on the tee, the basket or the hole's distance label; zoomed in on
    // the hole, all four are there
    const basket = (await course(page)).items.find((i: any) => i.type === "basket");
    for (const zoom of [0.5, 0.7, 1, 1.4, 2.5]) {
      // (At once, not animated: the squares and the label are checked where they come to rest;
      // zoomed in on the hole's middle, in the map's room above the sheet)
      await page.evaluate(z => {
        const v = (window as any).__dgView, id = (window as any).__dgCourse().holes[0].id;
        const b = v.itemBounds(id), cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const hw = Math.max(b.maxX - b.minX, 160) * 0.6 / z, hh = Math.max(b.maxY - b.minY, 96) * 0.6 / z;
        v.fitBounds({ minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }, { margin: 1.15, animate: false });
      }, zoom);
      await page.waitForTimeout(400);
      const ends = [await screenOf(page, tee.x, tee.y, 1), await screenOf(page, basket.x, basket.y, 1)];
      const label = await page.getByTestId("hole-distance").evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent).map(e => e.getBoundingClientRect().toJSON()));
      const squares = await page.locator('[data-handle="width"]:visible').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      for (const c of squares) {
        for (const e of ends) expect(Math.hypot(c.x - e.x, c.y - e.y), `zoom ${zoom}`).toBeGreaterThanOrEqual(40);
        for (const r of label) expect(c.x > r.left - 4 && c.x < r.right + 4 && c.y > r.top - 4 && c.y < r.bottom + 4, `zoom ${zoom}: a square on the label`).toBe(false);
      }
      // (a square on each edge at each of the four points along the hole)
      if (zoom === 2.5) expect(squares.length).toBe(8);
    }
  });

  test("two fingers pinch the map; they place nothing, even with the Hole tool", async ({ page }) => {
    await openGround(page);
    const scale = () => page.evaluate(() => (window as any).__dgView.viewInfo().pxPerUnit);
    const before = await scale();
    const box = (await page.getByTestId("plan").boundingBox())!;
    await pinch(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.35 }, 80, 240);
    await expect.poll(scale).toBeGreaterThan(before * 1.4);
    await page.waitForTimeout(300);
    expect((await course(page)).holes.length).toBe(0);
    await expect(page.getByTestId("draw-bar")).toHaveCount(0);
    // The + and − buttons do it with one finger
    const now = await scale();
    await page.getByRole("button", { name: "Zoom out" }).tap();
    await expect.poll(scale).toBeLessThan(now * 0.85);
  });

  test("two fingers twisted turn the map in 2D as in 3D, round the ground between them; it stays looking straight down", async ({ page }) => {
    await openGround(page);
    const info = () => page.evaluate(() => (window as any).__dgView.viewInfo());
    const i0 = await info();
    expect(i0.tiltDeg).toBeLessThan(1);
    const box = (await page.getByTestId("plan").boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.4 };
    const g0 = (await planAt(page, at.x, at.y))!;
    // (a quarter turn of the fingers, a little at a time, as a hand turns)
    await touches(page, async send => {
      const two = (deg: number) => { const r = (deg * Math.PI) / 180; return [{ x: at.x - 70 * Math.cos(r), y: at.y - 70 * Math.sin(r) }, { x: at.x + 70 * Math.cos(r), y: at.y + 70 * Math.sin(r) }]; };
      await send("touchStart", two(0));
      for (let i = 1; i <= 15; i++) await send("touchMove", two(4 * i));
      await send("touchEnd", []);
    });
    await page.waitForTimeout(500);
    const i1 = await info();
    const turned = Math.abs((((i1.heading - i0.heading) % 360) + 540) % 360 - 180);
    expect(turned).toBeGreaterThan(30);
    expect(i1.tiltDeg).toBeLessThan(1);
    await expect.poll(async () => (await editorState(page)).view).toBe("2d");
    await expect(page.getByTestId("compass")).toBeVisible();
    // (the ground that was between the fingers is still there)
    const g1 = (await planAt(page, at.x, at.y))!;
    expect(Math.hypot(g1.x - g0.x, g1.y - g0.y)).toBeLessThan(6);
  });

  test("a finger holds the ground as it moves the map, flat and tilted; let go while moving and it slides on, slowing; two fingers slide it too", async ({ page }) => {
    await oneHole(page);
    const box = (await page.getByTestId("plan").boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
    // (the ground under a point on screen, and where it is on screen now, moving or not)
    const ground = async () => (await planAt(page, at.x, at.y))!;
    const now = (g: { x: number; y: number }) => page.evaluate(([x, y]) => (window as any).__dgView.toClient(x, y, 0), [g.x, g.y] as const) as Promise<{ x: number; y: number }>;
    const still = async () => { await page.waitForTimeout(200); };
    for (const view of ["2d", "3d"]) {
      await page.evaluate(v => (window as any).__dgEditor().set({ view: v }), view);
      await page.waitForTimeout(300);
      await expect.poll(() => page.evaluate(() => (window as any).__dgView.settled()), { timeout: 15000 }).toBe(true);
      // (from the whole course: well inside the site's edge, past which the map doesn't go)
      await page.evaluate(() => (window as any).__dgView.fitCourse(false));
      // A slow drag, held still before lifting: the ground under the finger stayed under it
      const g = await ground();
      await touches(page, async send => {
        await send("touchStart", [at]);
        for (let i = 1; i <= 12; i++) await send("touchMove", [{ x: at.x + 5 * i, y: at.y + 6 * i }]);
        await still();
        await send("touchEnd", []);
      });
      await page.waitForTimeout(300);
      const end = await now(g);
      expect(Math.abs(end.x - (at.x + 60)), view).toBeLessThan(3);
      expect(Math.abs(end.y - (at.y + 72)), view).toBeLessThan(3);
      // A quick flick: the map goes on sliding the same way after the finger lifts, then stops.
      // (Sent within the page at a finger's pace, 10 ms a move: touches sent from outside wait on
      // each picture, and a test machine with no graphics chip draws too slowly for a flick)
      const f = await ground();
      await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y)!;
        const fire = (type: string, px: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: "touch", isPrimary: true, clientX: px, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
        const pause = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { /* a finger's pace */ } };
        fire("pointerdown", x);
        for (let i = 1; i <= 6; i++) { pause(10); fire("pointermove", x + 14 * i); }
        pause(8);
        fire("pointerup", x + 84);
      }, [at.x, at.y] as const);
      const lifted = await now(f);
      await page.waitForTimeout(1500);
      expect((await now(f)).x - lifted.x, view).toBeGreaterThan(15);
      // (then comes to rest)
      await expect.poll(() => page.evaluate(() => (window as any).__dgView.settled()), { timeout: 15000 }).toBe(true);
    }
    // Two fingers side by side, slid together: the ground between them moves with them (and the
    // map isn't turned)
    const heading = () => page.evaluate(() => (window as any).__dgView.viewInfo().heading);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    const h0 = await heading(), g2 = await ground();
    await touches(page, async send => {
      const two = (dx: number) => [{ x: at.x - 60 + dx, y: at.y }, { x: at.x + 60 + dx, y: at.y }];
      await send("touchStart", two(0));
      for (let i = 1; i <= 10; i++) await send("touchMove", two(8 * i));
      await still();
      await send("touchEnd", []);
    });
    await page.waitForTimeout(400);
    expect(Math.abs((await now(g2)).x - (at.x + 80))).toBeLessThan(4);
    expect(Math.abs((await heading()) - h0)).toBeLessThan(1);
  });

  test("the thing picked is framed above the bar: picked low on the map, the map moves it clear of the bar", async ({ page }) => {
    await oneHole(page);
    // (a tree low on the map, where the bar will be)
    const strip = page.viewportSize()!.height - 60;
    const box = (await page.getByTestId("plan").boundingBox())!;
    const g = (await planAt(page, box.x + box.width / 2, strip - 40))!;
    await page.evaluate(p => (window as any).__dgActions.placeAt("add-tree", p), g);
    const id = (await course(page)).items.find((i: any) => i.type === "tree").id;
    await page.evaluate(i => (window as any).__dgActions.select(i), id);
    await expect.poll(async () => (await editorState(page)).selectedId).toBe(id);
    await expect(bar(page)).toBeVisible();
    await settle(page);
    const top = (await bar(page).boundingBox())!.y;
    await expect.poll(async () => (await screenOf(page, g.x, g.y)).y, { timeout: 8000 }).toBeLessThan(top - 20);
    expect((await screenOf(page, g.x, g.y)).y).toBeGreaterThan(64);
  });

  test("a thing picked: its bar over the map (every setting in its row, its choices growing out of their buttons), the thing framed above it; panned away, Back to it", async ({ page }) => {
    await oneHole(page);
    const box = (await page.getByTestId("plan").boundingBox())!;
    const g = (await planAt(page, box.x + box.width / 2, box.y + box.height * 0.4))!;
    const id = await page.evaluate(p => {
      const a = (window as any).__dgActions;
      (window as any).__dgEditor().set({ areaKind: "woods" });
      a.addDrawn("area", [{ x: p.x - 40, y: p.y - 30 }, { x: p.x + 40, y: p.y - 30 }, { x: p.x + 40, y: p.y + 30 }, { x: p.x - 40, y: p.y + 30 }]);
      const d = (window as any).__dgCourse();
      return d.items[d.items.length - 1].id;
    }, g);
    await page.evaluate(i => (window as any).__dgActions.select(i), id);
    await expect(bar(page)).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    const vh = page.viewportSize()!.height;
    const top = async () => (await bar(page).boundingBox())!.y;
    // (the map keeps all but the bar; the woods show above it)
    expect(await top()).toBeGreaterThan(vh * 0.75);
    const inView = () => page.evaluate(i => (window as any).__dgView.inView(i), id);
    await expect.poll(inView).toBe(true);
    // Its name: a field over the bar
    await page.getByTestId("strip-name").tap();
    await page.getByRole("textbox", { name: "Area name" }).tap();
    await page.keyboard.type("Big woods");
    await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === id).label).toBe("Big woods");
    // Kind: a picture of each, never taking more than about a third of the screen; a tap changes it
    // at once, and the menu closes
    await page.getByTestId("strip-kind").tap();
    await expect(page.getByTestId("kind-tiles").getByRole("radio", { name: "Woods" })).toHaveAttribute("aria-checked", "true");
    expect((await menu(page).boundingBox())!.height).toBeLessThanOrEqual(Math.min(vh * 0.36, 340) + 1);
    await page.getByTestId("kind-water").tap();
    await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === id).kind).toBe("water");
    await expect(menu(page)).toHaveCount(0);
    // A tap on the map closes what's open without drawing anything
    await page.getByTestId("strip-name").tap();
    await expect(menu(page)).toBeVisible();
    const n = (await course(page)).items.length;
    await page.getByTestId("bar-away").dispatchEvent("pointerdown");
    await expect(menu(page)).toHaveCount(0);
    expect((await course(page)).items.length).toBe(n);
    // Panned well away (once the map has settled): Back to it brings it back
    await settle(page);
    await expect.poll(() => page.evaluate(() => (window as any).__dgView.settled())).toBe(true);
    await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 1450, minY: 1000, maxX: 1550, maxY: 1080 }, { animate: false }));
    await expect.poll(inView).toBe(false);
    await expect(page.getByTestId("back-to-it")).toBeVisible();
    await page.getByTestId("back-to-it").tap();
    await expect.poll(inView).toBe(true);
    await expect(page.getByTestId("back-to-it")).toHaveCount(0);
  });

  test("picking never zooms: a small tree or woods bigger than the screen picked, the map's scale stays as it was", async ({ page }) => {
    await oneHole(page);
    const scale = () => page.evaluate(() => (window as any).__dgView.viewInfo().pxPerUnit);
    const s0 = await scale();
    await page.evaluate(() => (window as any).__dgActions.placeAt("add-tree", { x: 450, y: 540 }));
    const tree = (await course(page)).items.find((i: any) => i.type === "tree").id;
    await page.evaluate(id => (window as any).__dgActions.select(id), tree);
    await page.waitForTimeout(1500);
    expect(Math.abs((await scale()) / s0 - 1)).toBeLessThan(0.01);
    await page.evaluate(() => {
      (window as any).__dgEditor().set({ areaKind: "woods" });
      (window as any).__dgActions.addDrawn("area", [{ x: -2000, y: -2000 }, { x: 4000, y: -2000 }, { x: 4000, y: 4000 }, { x: -2000, y: 4000 }]);
      const d = (window as any).__dgCourse();
      (window as any).__dgActions.select(d.items[d.items.length - 1].id);
    });
    await page.waitForTimeout(1500);
    expect(Math.abs((await scale()) / s0 - 1)).toBeLessThan(0.01);
  });

  test("a double tap zooms in where it lands; the zoom slider zooms as it slides", async ({ page }) => {
    await oneHole(page);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    const scale = () => page.evaluate(() => (window as any).__dgView.viewInfo().pxPerUnit);
    const box = (await page.getByTestId("plan").boundingBox())!;
    const at = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.35 };
    const s0 = await scale();
    // (two taps sent within the page, a finger's pace apart: from outside, each waits on a picture)
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)!;
      const fire = (type: string, id: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
      const pause = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { /* a finger's pace */ } };
      fire("pointerdown", 41); pause(60); fire("pointerup", 41); pause(120); fire("pointerdown", 42); pause(60); fire("pointerup", 42);
    }, [at.x, at.y] as const);
    await expect.poll(scale).toBeGreaterThan(s0 * 1.6);
    // The slider: slid up, closer; a tap low on its track, far out
    const slider = page.getByTestId("zoom-slider");
    await expect(slider).toBeVisible();
    const s1 = await scale(), sb = (await slider.boundingBox())!;
    await touchDrag(page, { x: sb.x + sb.width / 2, y: sb.y + sb.height * 0.6 }, { x: sb.x + sb.width / 2, y: sb.y + sb.height * 0.2 }, 6);
    await expect.poll(scale).toBeGreaterThan(s1 * 1.3);
    await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height - 12);
    await expect.poll(scale).toBeLessThan(s0 * 0.6);
  });

  test("a tree's height changed in 3D: the camera looks at it from the side, and goes back after", async ({ page }) => {
    await oneHole(page);
    await page.evaluate(() => (window as any).__dgActions.placeAt("add-tree", { x: 450, y: 540 }));
    const id = (await course(page)).items.find((i: any) => i.type === "tree").id;
    await page.evaluate(() => (window as any).__dgEditor().set({ view: "3d" }));
    await page.waitForTimeout(300);
    await expect.poll(() => page.evaluate(() => (window as any).__dgView.settled()), { timeout: 15000 }).toBe(true);
    const tilt = () => page.evaluate(() => (window as any).__dgView.viewInfo().tiltDeg);
    const t0 = await tilt();
    await page.evaluate(i => (window as any).__dgActions.select(i), id);
    await page.getByTestId("strip-height").tap();
    await expect.poll(tilt, { timeout: 15000 }).toBeGreaterThan(70);
    await page.getByTestId("strip-spread").tap();
    await expect.poll(tilt, { timeout: 15000 }).toBeLessThan(t0 + 3);
  });

  test("the Map step's page fills the phone's screen, as the 3D map does (its five tabs whole); Fit shows it whole, pinch and the buttons zoom it", async ({ page }) => {
    await oneHole(page);
    await nav(page).getByRole("button", { name: /Map/ }).tap();
    const pageBox = async () => (await page.getByTestId("design-page").boundingBox())!;
    await expect(page.getByTestId("design-page")).toBeVisible();
    const vw = page.viewportSize()!.width;
    const tabs = page.getByRole("tablist").first().getByRole("tab");
    await expect(tabs).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const t = (await tabs.nth(i).boundingBox())!;
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(vw);
      expect(await tabs.nth(i).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    // (filling the room between the bars: the page at least as wide as the screen, its middle in sight)
    const b = await pageBox();
    expect(b.width).toBeGreaterThanOrEqual(vw - 24);
    expect(b.x + b.width / 2).toBeGreaterThan(vw / 2 - 30);
    expect(b.x + b.width / 2).toBeLessThan(vw / 2 + 30);
    const zoom = async () => parseInt((await page.getByTestId("design-zoom").textContent()) ?? "0", 10);
    const fill = await zoom();
    await page.getByRole("button", { name: "Fit the page" }).tap();
    await expect.poll(zoom).toBeLessThanOrEqual(fill);
    const fit = await zoom();
    // (once its glide there has ended)
    await expect.poll(async () => (await pageBox()).x).toBeGreaterThanOrEqual(0);
    const w = await pageBox();
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.x + w.width).toBeLessThanOrEqual(vw);
    await pinch(page, { x: w.x + w.width / 2, y: w.y + w.height / 2 }, 60, 180);
    await expect.poll(zoom).toBeGreaterThan(fit * 1.8);
    await page.getByRole("button", { name: "Fit the page" }).tap();
    await expect.poll(zoom).toBe(fit);
    await page.getByRole("button", { name: "Fill the screen" }).tap();
    await expect.poll(zoom).toBe(fill);
    await page.getByRole("button", { name: "Zoom in" }).tap();
    await expect.poll(zoom).toBeGreaterThan(fill);
  });

  test("the Map step is the page's: its printouts are chips on the top bar, a tool opens a low sheet in the tools' place, and a picked piece has its own bar", async ({ page }) => {
    await oneHole(page);
    await nav(page).getByRole("button", { name: /Map/ }).tap();
    await expect(page.getByTestId("design-page")).toBeVisible();
    // (the chips where the course's name was, the page under them as big as it goes)
    const chips = page.getByTestId("top-bar").getByRole("tab");
    await expect(chips).toHaveCount(5);
    await expect(page.getByTestId("course-name")).toHaveCount(0);
    await chips.filter({ hasText: "Sign" }).tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().designTab)).toBe("sign");
    await expect(page.getByTestId("hole-step")).toBeVisible();
    await chips.filter({ hasText: "Map" }).tap();
    // (the page under the sheet as it was: it floats over it, nothing zooms)
    const before = (await page.getByTestId("design-page").boundingBox())!;
    // (the paper's name at the page's top left opens the Paper tool, its size first)
    await page.getByTestId("paper-chip").tap();
    const sheet = page.getByTestId("page-tool-panel");
    await expect(sheet).toBeVisible();
    expect((await page.getByTestId("design-page").boundingBox())!.width).toBeCloseTo(before.width, 0);
    await sheet.getByLabel("Paper size").selectOption("letter");
    await expect.poll(async () => (await page.evaluate(() => (window as any).__dgCourse().style.paper))).toBe("letter");
    // (unfolded under the tools, as the 3D map's panel: the Paper tool lit)
    await expect(page.getByTestId("page-tool-fold-paper")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("page-tool-done").tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Page settings" })).toBeVisible();
    // A piece picked: Done first, then its tools, each unfolding its settings under them
    await page.evaluate(() => (window as any).__dgEditor().set({ designSel: "title" }));
    const bar = page.getByTestId("piece-toolbar");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button").first()).toHaveAccessibleName("Done");
    await bar.getByTestId("piece-tool-font").tap();
    await expect(page.getByTestId("piece-panel")).toBeVisible();
    await expect(page.getByTestId("piece-panel").getByTestId("piece-size")).toBeVisible();
    const sel = (await page.getByTestId("page-selection").boundingBox())!, panel = (await page.getByTestId("piece-sheet").boundingBox())!;
    expect(sel.y + sel.height).toBeLessThanOrEqual(panel.y);
    await page.getByTestId("piece-panel").getByRole("button", { name: "Bigger" }).tap();
    await page.getByTestId("piece-panel-done").tap();
    await expect(page.getByTestId("piece-panel")).toHaveCount(0);
    await bar.getByTestId("piece-done").tap();
    await expect.poll(async () => (await editorState(page)).designSel).toBe(null);
  });

  test("a finger on the map style pictures scrolls the tool's settings up and down, as well as the pictures sideways", async ({ page }) => {
    await oneHole(page);
    await nav(page).getByRole("button", { name: /Map/ }).tap();
    await page.getByTestId("page-tool-map-style").tap();
    const pic = page.getByTestId("map-styles").locator("button").first();
    await expect(pic).toBeVisible();
    await page.waitForTimeout(400);
    const scroller = page.getByTestId("page-tool-panel").locator(".overflow-y-auto").first();
    const b = (await pic.boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
    for (let i = 1; i <= 14; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x, y: at.y - i * 10 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(20);
    await cdp.detach();
  });

  test("a tee sign's pieces follow a slow finger (snapping doesn't hold them back), and a tap off the picked one lets go", async ({ page }) => {
    await oneHole(page);
    await nav(page).getByRole("button", { name: /Map/ }).tap();
    await page.evaluate(() => (window as any).__dgEditor().set({ designTab: "sign", designSel: null }));
    await expect(page.getByTestId("design-page").locator("[data-el=number]")).toBeAttached();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, pts: { x: number; y: number }[]) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints: pts.map((p, i) => ({ ...p, id: i })) });
    const left = (id: string) => page.evaluate(id => document.querySelector(`[data-testid=design-page] [data-el="${id}"]`)!.getBoundingClientRect().left, id);
    for (const id of ["number", "par"]) {
      await page.evaluate(id => (window as any).__dgEditor().set({ designSel: id }), id);
      await expect(page.getByTestId("piece-toolbar")).toBeVisible();
      const r = (await page.locator(`[data-testid=design-page] [data-el="${id}"]`).boundingBox())!;
      const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      // (a finger moving a pixel at a time: the piece stays with it, never more than the finger's
      // few pixels of snapping behind)
      await touch("touchStart", [at]);
      let worst = 0;
      for (let k = 1; k <= 60; k++) {
        await touch("touchMove", [{ x: at.x + k, y: at.y + k / 2 }]);
        worst = Math.max(worst, Math.abs((await left(id)) - r.x - k));
      }
      await touch("touchEnd", []);
      expect(worst).toBeLessThanOrEqual(5);
      await expect.poll(async () => (await left(id)) - r.x).toBeGreaterThan(50);
    }
    // A tap beside what's picked (on another piece, or off the page) lets go of it
    const band = (await page.locator("[data-testid=design-page] [data-el=courseName]").boundingBox())!;
    await touch("touchStart", [{ x: band.x + band.width / 2, y: band.y + band.height / 2 }]);
    await touch("touchEnd", []);
    await expect.poll(async () => (await editorState(page)).designSel).toBe(null);
    await cdp.detach();
  });

  test("a pinch on the Map step's preview while the map paints still ends (the painting goes in once the fingers lift)", async ({ page }) => {
    await oneHole(page);
    await classicLook(page);
    await nav(page).getByRole("button", { name: /Map/ }).tap();
    await expect(page.getByTestId("design-page")).toBeVisible();
    const painting = () => page.evaluate(() => (window as any).__dgPainting());
    const zoom = async () => parseInt((await page.getByTestId("design-zoom").textContent()) ?? "0", 10);
    const fit = await zoom();
    const b = (await page.getByTestId("design-page").boundingBox())!;
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const fingers = (gap: number) => [{ x: at.x - gap / 2, y: at.y, id: 0 }, { x: at.x + gap / 2, y: at.y, id: 1 }];
    const cdp = await page.context().newCDPSession(page);
    // Two fingers down while it paints; the painting done while they rest; then the pinch
    expect(await painting()).toBe(true);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(60) });
    await expect.poll(painting, { timeout: 60_000 }).toBe(false);
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(60 + 12 * i) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await expect.poll(zoom).toBeGreaterThan(fit * 1.8);
    // (and the new painting is shown then)
    await expect(page.getByTestId("design-page").locator("image").first()).toBeAttached();
  });

  test("tee view on a phone: the hole's card (its Flyover line once opened), one line along the bottom (the hole's name, Play flyover, ✓), Tap mode over it, Edit flyover in the hole's menu, back to the map", async ({ page }) => {
    // (on a slow machine, all of it takes a while)
    test.setTimeout(180_000);
    await oneHole(page);
    await tapPlan(page, 450, 500);
    // (the hole's name opens View from the tee and Play flyover)
    await page.getByTestId("pill-open").tap();
    await expect(page.getByTestId("pill-menu").getByRole("button", { name: "Play flyover" })).toBeVisible();
    await page.getByTestId("menu-tee-view").tap();
    await expect(page.getByTestId("tee-view-hud")).toBeVisible();
    await expect(page.getByTestId("tee-view-hud")).toContainText("Par 3");
    // The card slim at first: a tap opens the hole's profile, another closes it
    await expect(page.getByTestId("tee-view-hud").locator("svg").first()).toBeVisible();
    await expect(page.getByTestId("card-flyover")).toHaveCount(0);
    await page.getByTestId("hud-card-open").tap();
    await expect(page.getByTestId("hud-card-open")).toHaveAttribute("aria-expanded", "true");
    // (opened: the hole's flyover, Automatic, with the way into its editor)
    await expect(page.getByTestId("card-flyover")).toContainText("Automatic");
    await expect(page.getByTestId("card-fly-edit")).toBeVisible();
    expect((await page.getByTestId("card-fly-edit").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("hud-card-open").tap();
    // Along the bottom, one line of the map's glass bar: the hole's name, Play flyover, ✓; no row of
    // settings, no Edit flyover or Export video on it; Tap mode just over it at the right
    const bar = page.getByTestId("tee-bar");
    await expect(bar.getByTestId("sheet-title")).toHaveText("Hole 1");
    await expect(bar.getByTestId("hud-flyover")).toContainText("Play flyover");
    await expect(bar.getByTestId("bar-row")).toHaveCount(0);
    await expect(bar.getByTestId("fly-edit")).toHaveCount(0);
    await expect(bar.getByTestId("fly-export")).toHaveCount(0);
    await expect(page.getByTestId("tap-switch")).toBeVisible();
    const sw = (await page.getByTestId("tap-switch").boundingBox())!, line = (await bar.getByTestId("hud-flyover").boundingBox())!;
    expect(sw.y + sw.height).toBeLessThanOrEqual(line.y);
    expect(sw.x + sw.width).toBeGreaterThan(page.viewportSize()!.width - 70);
    // The hole's name opens its menu: Edit flyover (saying what the flyover is), help; no Export video
    await expect(page.getByTestId("hud-edit")).toHaveCount(0);
    await bar.getByTestId("pill-open").tap();
    await expect(page.getByTestId("hud-edit")).toContainText("Automatic");
    await expect(page.getByTestId("hud-help")).toContainText("Tee view help");
    await expect(page.getByTestId("hud-record")).toHaveCount(0);
    await bar.getByTestId("pill-open").tap();
    await expect(page.getByTestId("pill-menu")).toHaveCount(0);
    // Immersive: no step bar or sheet
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    await expect(sheet(page)).toHaveCount(0);
    const close = (await bar.getByTestId("bar-done").boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(44);
    await bar.getByTestId("bar-done").tap();
    await expect.poll(async () => (await editorState(page)).teeView).toBeNull();
    // (back on the map with the hole still picked: its bar, the steps waiting till it's put down)
    await expect(page.getByTestId("hole-strip")).toBeVisible();
    await page.getByTestId("bar-done").tap();
    await expect(page.getByTestId("bottom-nav")).toBeVisible();
  });

  test("the flyover's settings in the Flyover editor's bar on a phone; a thing selected in tee view, its bar in the flyover bar's place", async ({ page }) => {
    // (a flight's loading screen takes a while on a slow machine)
    test.setTimeout(360_000);
    await oneHole(page);
    await tapPlan(page, 450, 500);
    await page.getByTestId("pill-open").tap();
    await page.getByTestId("menu-tee-view").tap();
    const bar = page.getByTestId("tee-bar");
    // Edit flyover, in the hole's menu: the editor's bar, the whole flyover's settings in its row
    await bar.getByTestId("pill-open").tap();
    await page.getByTestId("hud-edit").tap();
    const ed = page.getByTestId("camera-bar");
    await expect(ed.getByTestId("cam-pill")).toContainText("Flyover");
    // A setting's dial grows out of its button: Altitude, one step up with the arrow key
    const height = () => page.evaluate(() => (window as any).__dgCourse().flyover?.height ?? null);
    const before = await height();
    await ed.getByTestId("strip-altitude").tap();
    const dial = page.getByTestId("bar-menu").getByTestId("dial");
    await expect(dial).toBeVisible();
    await dial.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(height).not.toBe(before);
    // (a tap on the view closes it, and nothing else)
    await page.getByTestId("bar-away").tap();
    await expect(page.getByTestId("bar-menu")).toHaveCount(0);
    // ✓: out of the editor, back in tee view
    await ed.getByTestId("bar-done").tap();
    await expect(page.getByTestId("camera-hud")).toHaveCount(0);
    await expect(bar).toBeVisible();
    // Tap mode Select: a thing selected brings its own bar in the flyover bar's place, the switch
    // still over it; ✓ puts it down and the flyover bar is back
    await page.getByTestId("tap-edit").tap();
    await expect(page.getByTestId("tap-edit")).toHaveAttribute("aria-checked", "true");
    await page.evaluate(() => { const c = (window as any).__dgCourse(); (window as any).__dgActions.select(c.items.find((i: any) => i.type === "tee").id); });
    await expect(page.getByTestId("item-strip")).toBeVisible();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("tap-switch")).toBeVisible();
    await page.getByTestId("item-strip").getByTestId("bar-done").tap();
    await expect(bar).toBeVisible();
    // ✓ goes back to the map
    await bar.getByTestId("bar-done").tap();
    await expect.poll(async () => (await editorState(page)).teeView).toBeNull();
  });

  test("playing on a phone: tee view's bar folds to its timeline, a tap brings it back, Pause on the folded timeline pauses it", async ({ page }) => {
    // (a flight's loading screen takes a while on a slow machine, and the flight is at its slowest)
    test.setTimeout(600_000);
    await oneHole(page);
    // (Speed at its slowest, so the flyover is still under way when it's paused below)
    await page.evaluate(() => (window as any).__dgActions.flyover({ speed: 0.25 }));
    await tapPlan(page, 450, 500);
    await page.getByTestId("pill-open").tap();
    await page.getByTestId("menu-tee-view").tap();
    const bar = page.getByTestId("tee-bar");
    await expect(bar).toBeVisible();
    // Playing: the card hides, Play flyover becomes the timeline with Stop at its start
    const flying = () => page.evaluate(() => !!(window as any).__dgEditor().flyover);
    // (while the flight gets ready, drawn in software, the page can be too busy to be asked for a
    // while: a minute for each of these)
    const busy = { timeout: 60_000 };
    await bar.getByTestId("hud-flyover").tap();
    await expect.poll(flying, busy).toBe(true);
    await expect(page.getByTestId("tee-view-hud")).toBeHidden();
    // (the flight's ready: its loading screen, over everything while it gets ready, out of the way)
    // (the loading screen comes a moment after Play is tapped: waited for as done, not as not yet there)
    await expect.poll(() => page.evaluate(() => { const ed = (window as any).__dgEditor(), el = document.querySelector('[data-testid="flyover-loading"]'); return !ed.flyover || (ed.flyLoading === null && (!el || getComputedStyle(el).pointerEvents === "none")); }), { timeout: 120_000 }).toBe(true);
    if (!(await flying())) return;
    await expect(page.getByTestId("fly-line")).toBeVisible();
    await expect(page.getByTestId("tap-switch")).toHaveCount(0);
    // Left alone, the bar folds to its timeline; a tap on the view brings it back, and only that
    await expect(bar.locator("[data-tucked]")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("fly-line")).toBeVisible();
    // (seen the moment it comes back: drawn in software, the page can be too busy to be asked
    // before it folds again three seconds later)
    await page.evaluate(() => {
      const w = window as any, el = document.querySelector('[data-testid="tee-bar"]')!;
      w.__barBack = false;
      const mo = new MutationObserver(() => { if (!el.querySelector("[data-tucked]")) { w.__barBack = true; mo.disconnect(); } });
      mo.observe(el, { subtree: true, attributes: true, childList: true });
    });
    await page.touchscreen.tap(200, 300);
    await expect.poll(() => page.evaluate(() => (window as any).__barBack), busy).toBe(true);
    await expect(page.getByTestId("bar-menu")).toHaveCount(0);
    // Folded again, Pause on its timeline pauses it at once (the bar coming back as it does) and
    // holds it on its moment, the bar staying up (it ends paused too, on its last picture)
    // (folded all the way, the timeline settled at the foot, before the tap: not as it moves there)
    await expect(bar.locator("[data-tucked]")).toHaveCount(1, { timeout: 15_000 });
    await expect(bar.getByTestId("flyover-pill")).toBeHidden();
    const paused = () => page.evaluate(() => !!(window as any).__dgEditor().flyPaused);
    if (!(await paused())) await bar.getByTestId("hud-flyover").tap();
    await expect.poll(paused, busy).toBe(true);
    await expect(bar.locator("[data-tucked]")).toHaveCount(0);
    expect(await flying()).toBe(true);
    await expect(bar.getByTestId("hud-flyover")).toHaveAttribute("aria-label", "Play");
    await page.waitForTimeout(3500);
    await expect(bar.locator("[data-tucked]")).toHaveCount(0);
    // ✓ goes back to the map
    await bar.getByTestId("bar-done").tap();
    await expect.poll(async () => (await editorState(page)).teeView).toBeNull();
  });

  test("a custom camera path in the Flyover editor on a phone: the timeline across the bar; a keyframe tapped, its own bar; Add keyframe adds one after it; ✓ back to the whole flyover", async ({ page }) => {
    test.setTimeout(180_000);
    await oneHole(page);
    await tapPlan(page, 450, 500);
    await page.getByTestId("pill-open").tap();
    await page.getByTestId("menu-tee-view").tap();
    await page.getByTestId("tee-bar").getByTestId("pill-open").tap();
    await page.getByTestId("hud-edit").tap();
    const bar = page.getByTestId("camera-bar");
    const keys = () => page.evaluate(() => ((window as any).__dgCourse().holes[0].flyKeys ?? []).length);
    await bar.getByTestId("fly-path").tap();
    await page.getByTestId("bar-menu").getByRole("radio", { name: /Custom/ }).tap();
    await expect.poll(keys).toBeGreaterThanOrEqual(2);
    // (the whole flyover's bar: the timeline over the name, Add keyframe beside it)
    await expect(bar.getByTestId("fly-line")).toBeVisible();
    await expect(bar.getByTestId("cam-add")).toBeVisible();
    await expect(bar.getByTestId("cam-pill")).toContainText("Flyover");
    // A keyframe tapped: its own bar, the camera at its shot
    await bar.getByTestId("fly-key").nth(1).tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().flyKey)).toBe(1);
    await expect(bar.getByTestId("cam-pill")).toContainText("Keyframe 2");
    await expect(bar.getByTestId("cam-add")).toContainText("after 2");
    // Add keyframe: one more, after it, and it's the one selected
    const n = await keys();
    await bar.getByTestId("cam-add").tap();
    await expect.poll(keys).toBe(n + 1);
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().flyKey)).toBe(2);
    await expect(bar.getByTestId("cam-pill")).toContainText("Keyframe 3");
    // ✓: done with the keyframe, the whole flyover's bar again
    await bar.getByTestId("bar-done").tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().flyKey)).toBeNull();
    await expect(bar.getByTestId("cam-pill")).toContainText("Flyover");
  });

  test("the camera on a phone: the stick moves it, the arrows lift it, a drag turns it, a big button adds the keyframe", async ({ page }) => {
    test.setTimeout(180_000);
    await oneHole(page);
    await tapPlan(page, 450, 500);
    // (the header's eye: the hole's panel under it has a View from the tee button too)
    await page.getByTestId("pill-open").tap();
    await page.getByTestId("menu-tee-view").tap();
    await page.getByTestId("tee-bar").getByTestId("pill-open").tap();
    await page.getByTestId("hud-edit").tap();
    await expect(page.getByTestId("camera-hud")).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    const pose = () => page.evaluate(() => (window as any).__dgView.freeKey());
    await expect.poll(async () => (await pose()) !== null).toBe(true);
    const p0 = await pose();
    // The stick pushed up and held: forward
    const st = (await page.getByTestId("cam-stick").boundingBox())!;
    const c = { x: st.x + st.width / 2, y: st.y + st.height / 2 };
    await touches(page, async send => {
      await send("touchStart", [c]);
      await send("touchMove", [{ x: c.x, y: c.y - 20 }]);
      await send("touchMove", [{ x: c.x, y: c.y - 45 }]);
      await page.waitForTimeout(700);
      await send("touchEnd", []);
    });
    const p1 = await pose();
    const ahead = { x: p0.lookX - p0.x, y: p0.lookY - p0.y }, n = Math.hypot(ahead.x, ahead.y);
    expect(((p1.x - p0.x) * ahead.x + (p1.y - p0.y) * ahead.y) / n).toBeGreaterThan(5);
    // (let go: it stops)
    await page.waitForTimeout(200);
    const still = await pose();
    await page.waitForTimeout(300);
    expect(Math.hypot((await pose()).x - still.x, (await pose()).y - still.y)).toBeLessThan(0.2);
    // The up arrow held: higher
    const up = (await page.getByTestId("cam-up").boundingBox())!;
    await longPress(page, { x: up.x + up.width / 2, y: up.y + up.height / 2 }, 700);
    expect((await pose()).alt).toBeGreaterThan(p1.alt + 5);
    // A finger dragged across the view: it turns
    const before = await pose();
    await touchDrag(page, { x: 190, y: 380 }, { x: 80, y: 400 });
    expect(Math.hypot((await pose()).lookX - before.lookX, (await pose()).lookY - before.lookY)).toBeGreaterThan(5);
    // Big enough for a thumb; adds the shot as a keyframe (the camera path turns Custom)
    const add = (await page.getByTestId("cam-add").boundingBox())!;
    expect(add.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId("cam-add").tap();
    await expect.poll(async () => ((await course(page)).holes[0].flyKeys ?? []).length).toBeGreaterThanOrEqual(2);
    // (✓ is done with the new keyframe; ✓ again puts the camera away, standing on the tee again; ✓
    // there goes to the map)
    await page.getByTestId("camera-bar").getByTestId("bar-done").tap();
    await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().flyKey)).toBeNull();
    await page.getByTestId("camera-bar").getByTestId("bar-done").tap();
    await expect(page.getByTestId("camera-hud")).toHaveCount(0);
    await expect(page.getByTestId("tee-view-hud")).toBeVisible();
    expect((await editorState(page)).teeView).not.toBeNull();
    await page.getByTestId("tee-bar").getByTestId("bar-done").tap();
    await expect(page.getByTestId("hole-strip")).toBeVisible();
    await page.getByTestId("bar-done").tap();
    await expect(page.getByTestId("bottom-nav")).toBeVisible();
  });

  test("touch targets: the step bar, tools and map buttons are at least 44 px", async ({ page }) => {
    await openGround(page);
    const small: string[] = [];
    for (const loc of [nav(page).getByRole("button"), page.getByTestId("tool-strip").getByRole("button"), page.getByTestId("map-controls").getByRole("button"), page.getByTestId("top-bar").getByRole("button"), page.getByTestId("top-bar").getByRole("radio")]) {
      for (const b of await loc.all()) {
        const box = (await b.boundingBox())!;
        if (Math.round(box.height) < 44 || Math.round(box.width) < 44) small.push(`${await b.getAttribute("aria-label") ?? await b.textContent()}: ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    expect(small).toEqual([]);
  });
});

test.describe("phone on its side", () => {
  test.use(device("iPhone 13 landscape"));

  test("a rail of steps on the left, the panel beside it (it folds away), the map on the right; a thing picked, its bar up the right edge", async ({ page }) => {
    await oneHole(page);
    await expect(page.getByTestId("nav-rail")).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    const side = page.getByTestId("side-sheet");
    await expect(side).toBeVisible();
    await nav(page).getByRole("button", { name: /Export/ }).tap();
    await expect(side.getByTestId("sheet-title")).toHaveText("Export");
    const mapW = async () => (await page.getByTestId("plan").boundingBox())!.width;
    const w = await mapW();
    await page.getByTestId("panel-toggle").tap();
    await expect(side).toHaveCount(0);
    await expect.poll(mapW).toBeGreaterThan(w + 200);
    // A step brings the panel back
    await nav(page).getByRole("button", { name: /Design/ }).tap();
    await expect(side).toBeVisible();
    // (the map back at its width before the hole is tapped where it shows)
    await expect.poll(mapW).toBeLessThan(w + 2);
    await page.waitForTimeout(300);
    // A hole picked: its bar up the right edge, the panel out of the map's way
    await tapPlan(page, 450, 500);
    await expect(page.getByTestId("hole-strip")).toBeVisible();
    await expect(side).toHaveCount(0);
    const bar = (await page.getByTestId("hole-strip").boundingBox())!;
    expect(bar.x).toBeGreaterThan(page.viewportSize()!.width - 130);
    expect(bar.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
    await page.getByTestId("bar-done").tap();
    await expect(side).toBeVisible();
  });
});

test.describe("tablet held upright", () => {
  test.use(device("iPad Pro 11"));

  test("the rail and the panel beside the map, with touch-sized tools", async ({ page }) => {
    await oneHole(page);
    await expect(page.getByTestId("nav-rail")).toBeVisible();
    await expect(page.getByTestId("side-sheet")).toBeVisible();
    await expect(page.getByTestId("side-panel")).toHaveCount(0);
    const tool = (await page.locator('[data-tool="hole"]').boundingBox())!;
    expect(tool.height).toBeGreaterThanOrEqual(44);
    await page.locator('[data-tool="hole"]').tap();
    await tapPlan(page, 300, 800);
    await tapPlan(page, 600, 800);
    await expect.poll(async () => (await course(page)).holes.length).toBe(2);
  });
});

test.describe("tablet on its side", () => {
  test.use(device("iPad Pro 11 landscape"));

  test("a tablet on its side keeps the desktop layout; the top bar and tools fit on screen", async ({ page }) => {
    await oneHole(page);
    await expect(page.getByTestId("holes-column")).toBeVisible();
    await expect(page.getByRole("button", { name: "2 Design" })).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
    const vw = page.viewportSize()!.width;
    const tools = (await page.getByRole("toolbar", { name: "Tools" }).boundingBox())!;
    expect(tools.x).toBeGreaterThanOrEqual(0);
    expect(tools.x + tools.width).toBeLessThanOrEqual(vw);
    // Nothing in the top bar runs off the screen
    for (const b of await page.locator("header button, header input").all()) {
      const box = await b.boundingBox();
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
    }
    await tapPlan(page, 450, 500);
    await expect(page.getByTestId("inspector")).toBeVisible();
  });
});

test("desktop at 1600 × 1000 keeps its layout: top bar steps, side panel, tool bar, no phone parts", async ({ page }) => {
  await oneHole(page);
  const header = (await page.locator("header").boundingBox())!;
  expect(header.height).toBe(50);
  // (the Site step's panel; Design has the holes down the map's side instead)
  await page.getByRole("button", { name: "1 Site" }).click();
  const side = (await page.getByTestId("side-panel").boundingBox())!;
  expect(side.width).toBe(340);
  // (the bar and the panel float, 10 px from the edges and from each other)
  expect(side.y).toBe(70);
  await page.getByRole("button", { name: "2 Design" }).click();
  await expect(page.getByTestId("holes-column")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
  // (no prompt over the map with Select; a tool's own prompt when one is picked)
  await expect(page.getByTestId("tool-hint")).toHaveCount(0);
  await page.keyboard.press("t");
  await expect(page.getByTestId("tool-hint")).toContainText("Click where hole 1's gold tee goes");
  await page.keyboard.press("Escape");
  for (const id of ["bottom-nav", "sheet", "nav-rail", "side-sheet", "top-bar", "draw-bar"]) await expect(page.getByTestId(id)).toHaveCount(0);
  // What's picked opens down the map's left, next to the hole list (just the numbers while it
  // shows): the map's right side stays clear
  await page.getByTestId("hole-row").click();
  const insp = (await page.getByTestId("inspector").boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  expect(insp.width).toBe(300);
  expect(Math.round(insp.x - main.x)).toBe(76);
  expect(Math.round((await page.getByTestId("hole-list").boundingBox())!.width)).toBe(52);
});
