import { test as plain, expect as plainExpect } from "@playwright/test";
import { treeSpread } from "../../src/three/treeKit";
import { test, expect, addHole, blankCourse, clickPlan, course, drag, editorState, handleCenter, screenOf } from "./fixtures";

test("drawing an OB area: click corners, double-click to finish; Backspace and Esc", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("o");
  await expect(page.getByTestId("tool-options")).toBeVisible();
  await page.getByTestId("area-kind-ob").click();
  await clickPlan(page, 300, 300);
  await clickPlan(page, 600, 300);
  await clickPlan(page, 650, 320);
  // Backspace takes back the last point
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("draft-label")).toContainText("2 points");
  await clickPlan(page, 600, 500);
  await clickPlan(page, 300, 500, { double: true });
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
  const area = (await course(page)).items.find((i: any) => i.type === "area");
  expect(area.kind).toBe("ob");
  expect(area.points).toHaveLength(4);
  expect((await editorState(page)).tool).toBe("select");
  expect((await editorState(page)).selectedId).toBe(area.id);
  await expect(page.getByTestId("inspector-title")).toHaveText("OB area");
  // Esc drops a shape being drawn
  await page.keyboard.press("o");
  await clickPlan(page, 900, 300);
  await clickPlan(page, 1000, 300);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  expect((await course(page)).items.filter((i: any) => i.type === "area")).toHaveLength(1);
});

test("an area's corners can be dragged, a mid dot adds one, and the picked area moves by its edge (a drag from inside moves the map)", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("w");
  await page.getByTestId("area-kind-water").click();
  for (const [x, y] of [[300, 300], [600, 300], [600, 500]]) await clickPlan(page, x, y);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
  const c0 = await handleCenter(page, "corner", 0);
  await drag(page, c0, await screenOf(page, 250, 250));
  await expect.poll(async () => Math.round((await course(page)).items[0].points[0].x)).toBeLessThan(260);
  const mid = await handleCenter(page, "mid", 0);
  await drag(page, mid, await screenOf(page, 450, 200));
  await expect.poll(async () => (await course(page)).items[0].points.length).toBe(4);
  // Drag the inside: the map moves, the area stays where it is
  const before = (await course(page)).items[0].points[1].x;
  const inside = await screenOf(page, 500, 380);
  await drag(page, inside, { x: inside.x + 60, y: inside.y });
  await page.waitForTimeout(300);
  expect((await course(page)).items[0].points[1].x).toBe(before);
  // Drag its edge (as drawn: water's runs round; a quarter of the way along the closing side, clear
  // of the dots): the whole area moves
  const on = await page.evaluate(() => {
    const v = (window as any).__dgView, a = (window as any).__dgCourse().items[0];
    return v.shapeOf(a).pts.reduce((b: any, p: any) => (Math.hypot(p.x - 512.5, p.y - 437.5) < Math.hypot(b.x - 512.5, b.y - 437.5) ? p : b));
  });
  const edge = await screenOf(page, on.x, on.y);
  await drag(page, edge, { x: edge.x + 60, y: edge.y });
  await expect.poll(async () => (await course(page)).items[0].points[1].x).toBeGreaterThan(before + 20);
});

test("lines: an OB line and a walking path with its width", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("l");
  await page.getByTestId("line-kind-path").click();
  await clickPlan(page, 200, 900);
  await clickPlan(page, 1400, 900);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  await page.getByRole("slider", { name: "Width" }).fill("12");
  await expect.poll(async () => (await course(page)).items[0].width).toBe(12);
  await page.keyboard.press("o");
  await page.getByTestId("line-kind-ob").click();
  // (below the map's controls at the top right)
  await clickPlan(page, 1500, 600);
  await clickPlan(page, 1500, 1000);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").map((l: any) => l.kind).sort()).toEqual(["ob", "path"]);
});

test("a mando placed on a hole faces down it, passed on the line's side; its side can be switched; a drop zone joins the hole", async ({ page }) => {
  await blankCourse(page);
  const hole = await addHole(page, { x: 400, y: 600 }, { x: 400, y: 200 });
  await page.keyboard.press("m");
  // A post to the right of the line (east of a hole running north) is passed on its left
  await clickPlan(page, 430, 400);
  let mando = (await course(page)).items.find((i: any) => i.type === "mando");
  expect(mando.holeId).toBe(hole.id);
  // The hole runs north (up the screen): -90°
  expect(Math.round(mando.rotation)).toBe(-90);
  expect(mando.side).toBe("left");
  // ...and one to the left of it on its right
  await clickPlan(page, 370, 450);
  expect((await course(page)).items.filter((i: any) => i.type === "mando")[1].side).toBe("right");
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__dgActions.select(id), mando.id);
  await page.getByRole("radiogroup", { name: "Mando side" }).getByRole("radio", { name: "Right of it" }).click();
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.type === "mando").side).toBe("right");
  // On the map: the post, and the arrow and restricted line on the ground
  await expect(page.getByTestId("mando-chip").first().locator("svg")).toBeVisible();
  // Turn it with its handle
  const rot = await handleCenter(page, "rotate");
  await drag(page, rot, await screenOf(page, 480, 400));
  mando = (await course(page)).items.find((i: any) => i.type === "mando");
  // (turned to about straight up: 359° is as near as 1°)
  const turn = ((mando.rotation % 360) + 360) % 360;
  expect(Math.min(turn, 360 - turn)).toBeLessThan(10);
  await page.keyboard.press("z");
  await clickPlan(page, 470, 380);
  const dz = (await course(page)).items.find((i: any) => i.type === "dropzone");
  expect(dz.holeId).toBe(hole.id);
  await expect(page.getByTestId("dropzone-chip")).toBeVisible();
});

test("trees, benches and labels; delete, duplicate and lock", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("r");
  await clickPlan(page, 300, 300);
  await clickPlan(page, 340, 300);
  expect((await course(page)).items.filter((i: any) => i.type === "tree")).toHaveLength(2);
  await page.keyboard.press("a");
  await page.getByTestId("tool-options").getByRole("button", { name: "Trash can" }).click();
  await clickPlan(page, 600, 600);
  const can = (await course(page)).items.find((i: any) => i.type === "amenity");
  expect(can.kind).toBe("trash");
  // On the map: its pictogram, as on the printed map
  await expect(page.getByTestId("amenity-chip").locator('[data-symbol="trash"]')).toBeAttached();
  await page.keyboard.press("k");
  await clickPlan(page, 800, 800);
  // (put down, it's picked with Select back, its text ready to type over)
  await expect.poll(async () => (await editorState(page)).tool).toBe("select");
  await page.getByLabel("Label text").fill("Clubhouse");
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.type === "label").text).toBe("Clubhouse");
  // Duplicate, then delete the copy
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "label").length).toBe(2);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "label").length).toBe(1);
  // A locked item doesn't delete
  const label = (await course(page)).items.find((i: any) => i.type === "label");
  await page.evaluate(id => (window as any).__dgActions.select(id), label.id);
  await page.getByTestId("inspector").getByRole("button", { name: "Lock", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("It's locked. Unlock it first.")).toBeVisible();
  expect((await course(page)).items.filter((i: any) => i.type === "label")).toHaveLength(1);
});

test("measuring: distance and elevation change", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("d");
  await clickPlan(page, 200, 200);
  await clickPlan(page, 500, 600);
  await expect(page.getByTestId("measure-label")).toHaveText("500 ft");
  // A small tag halfway along the line, its dots at the ends (once a bar right across the map)
  const tag = (await page.getByTestId("measure-label").boundingBox())!;
  expect(tag.width).toBeLessThan(120);
  const mid = await screenOf(page, 350, 400);
  expect(Math.hypot(tag.x + tag.width / 2 - mid.x, tag.y + tag.height / 2 - mid.y)).toBeLessThan(40);
  const dot = (await page.getByTestId("measure-point").first().boundingBox())!;
  const a = await screenOf(page, 200, 200);
  expect(dot.width).toBeLessThan(20);
  expect(Math.hypot(dot.x + dot.width / 2 - a.x, dot.y + dot.height / 2 - a.y)).toBeLessThan(8);
  // Another click: the first point stays, the other end moves there
  await clickPlan(page, 200, 500);
  await expect(page.getByTestId("measure-label")).toHaveText("300 ft");
  const m = await page.evaluate(() => (window as any).__dgView.measurement());
  expect(m.points).toHaveLength(2);
  expect(Math.hypot(m.points[0].x - 200, m.points[0].y - 200)).toBeLessThan(2);
  // (and where the next click would reach, faint, while the pointer moves)
  const p = await screenOf(page, 600, 200);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await expect(page.getByTestId("measure-next")).toHaveText("400 ft");
  // Shift+click adds a turn: a path, with its total
  await page.keyboard.down("Shift");
  await clickPlan(page, 500, 500);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("measure-label")).toHaveCount(2);
  // Esc ends it
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("measure-point")).toHaveCount(0);
});

test("shapes by dragging: a rectangle and a circle", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("o");
  await page.getByTestId("area-kind-hazard").click();
  await page.getByTestId("draw-shape-box").click();
  await expect(page.getByTestId("tool-hint")).toContainText("Drag a rectangle");
  await drag(page, await screenOf(page, 300, 300), await screenOf(page, 600, 500), 3);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
  const box = (await course(page)).items.find((i: any) => i.type === "area");
  expect(box.kind).toBe("hazard");
  expect(box.points).toHaveLength(4);
  // Keeps its corners (shapes drawn point by point curve)
  expect(box.straight).toBe(true);
  const xs = box.points.map((p: any) => p.x), ys = box.points.map((p: any) => p.y);
  expect(Math.min(...xs)).toBeCloseTo(300, -1);
  expect(Math.max(...xs)).toBeCloseTo(600, -1);
  expect(Math.min(...ys)).toBeCloseTo(300, -1);
  expect(Math.max(...ys)).toBeCloseTo(500, -1);
  // A circle, from its middle out
  await page.keyboard.press("o");
  await page.getByTestId("draw-shape-circle").click();
  await drag(page, await screenOf(page, 900, 400), await screenOf(page, 1000, 400), 3);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(2);
  const circle = (await course(page)).items.filter((i: any) => i.type === "area")[1];
  expect(circle.points.length).toBeGreaterThan(20);
  for (const p of circle.points) expect(Math.hypot(p.x - 900, p.y - 400)).toBeCloseTo(100, -1);
  expect(circle.straight).toBeUndefined();
  // Points again: a drag pans the map instead of drawing
  await page.keyboard.press("o");
  await page.getByTestId("draw-shape-points").click();
  await drag(page, await screenOf(page, 300, 700), await screenOf(page, 500, 800), 3);
  expect((await course(page)).items.filter((i: any) => i.type === "area")).toHaveLength(2);
});

test("a building as a rectangle by two clicks (Rectangle comes first for buildings), and a circle the same way", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await expect(page.getByTestId("draw-shape-box")).toHaveAttribute("aria-checked", "true");
  // One corner, then the opposite one (it once only ever added corner points)
  await clickPlan(page, 300, 300);
  expect((await course(page)).items.filter((i: any) => i.type === "structure")).toHaveLength(0);
  await clickPlan(page, 420, 380);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "structure").length).toBe(1);
  const b = (await course(page)).items.find((i: any) => i.type === "structure");
  expect(b.kind).toBe("building");
  expect(b.points).toHaveLength(4);
  const xs = b.points.map((p: any) => p.x), ys = b.points.map((p: any) => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, -1);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(80, -1);
  // A circular hazard: the middle, then the edge
  await page.keyboard.press("o");
  await page.getByTestId("area-kind-hazard").click();
  await page.getByTestId("draw-shape-circle").click();
  await clickPlan(page, 700, 500);
  await clickPlan(page, 760, 500);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
  const c = (await course(page)).items.find((i: any) => i.type === "area");
  for (const p of c.points) expect(Math.hypot(p.x - 700, p.y - 500)).toBeCloseTo(60, -1);
  // Esc between the two clicks drops it (the area tool again: a finished shape goes back to Select)
  await page.keyboard.press("o");
  await page.getByTestId("draw-shape-box").click();
  await clickPlan(page, 300, 700);
  await page.keyboard.press("Escape");
  await clickPlan(page, 400, 800);
  await page.waitForTimeout(300);
  expect((await course(page)).items.filter((i: any) => i.type === "area")).toHaveLength(1);
});

test("a freehand line, drawn by dragging", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("w");
  await page.getByTestId("line-kind-stream").click();
  await page.getByTestId("draw-shape-freehand").click();
  await expect(page.getByTestId("tool-hint")).toContainText("Drag to draw");
  const from = await screenOf(page, 200, 800), mid = await screenOf(page, 500, 700), to = await screenOf(page, 800, 850);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  const creek = (await course(page)).items.find((i: any) => i.type === "line");
  expect(creek.kind).toBe("stream");
  expect(creek.points.length).toBeGreaterThanOrEqual(3);
  // It bends through the middle point
  expect(Math.min(...creek.points.map((p: any) => p.y))).toBeLessThan(730);
  // A line can't be a rectangle: picked for an area, lines still draw freehand
  await page.keyboard.press("o");
  await page.getByTestId("draw-shape-box").click();
  await page.keyboard.press("l");
  await expect(page.getByTestId("draw-shape-freehand")).toHaveAttribute("aria-checked", "true");
});

test("one click adds OB along a hole's side or behind its basket", async ({ page }) => {
  await blankCourse(page);
  // A hole running north
  const hole = await addHole(page, { x: 500, y: 800 }, { x: 500, y: 300 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await page.getByTestId("ob-left").click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  const left = (await course(page)).items.find((i: any) => i.type === "line");
  expect(left.kind).toBe("ob");
  expect(left.holeId).toBe(hole.id);
  // West of the fairway (its left, facing north), past the basket
  for (const p of left.points) expect(p.x).toBeLessThan(500 - 15);
  expect(Math.min(...left.points.map((p: any) => p.y))).toBeLessThan(300);
  await expect(page.getByText(/OB line added along the left of hole 1/)).toBeVisible();
  await page.getByTestId("hole-row").click();
  await page.getByTestId("ob-long").click();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(2);
  const long = (await course(page)).items.filter((i: any) => i.type === "line")[1];
  // Behind the basket (north of it), about 10 m out
  for (const p of long.points) expect(Math.hypot(p.x - 500, p.y - 300)).toBeGreaterThan(35);
  expect(Math.max(...long.points.map((p: any) => p.y))).toBeLessThan(320);
  // Undo takes it back
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
});

test("the right-click menu goes with a left click anywhere: on the map, or on the page around it", async ({ page }) => {
  await blankCourse(page);
  const at = await screenOf(page, 700, 600);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(page.getByTestId("map-menu")).toBeVisible();
  const away = await screenOf(page, 300, 300);
  await page.mouse.click(away.x, away.y);
  await expect(page.getByTestId("map-menu")).toHaveCount(0);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(page.getByTestId("map-menu")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByTestId("map-menu")).toHaveCount(0);
});

test("a road marked OB from its right-click menu", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("l");
  await page.getByTestId("line-kind-road").click();
  await clickPlan(page, 200, 600);
  await clickPlan(page, 1200, 600);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  await page.keyboard.press("Escape");
  const at = await screenOf(page, 700, 600);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Mark as OB (red edge)" }).click();
  await expect.poll(async () => (await course(page)).items[0].ob).toBe(true);
  // The inspector says so, and it can be taken back there
  await page.evaluate(id => (window as any).__dgActions.select(id), (await course(page)).items[0].id);
  const ob = page.getByRole("radiogroup", { name: "Penalty" });
  await expect(ob.getByRole("radio", { name: "OB", exact: true })).toHaveAttribute("aria-checked", "true");
  await ob.getByRole("radio", { name: "None" }).click();
  await expect.poll(async () => (await course(page)).items[0].ob).toBeUndefined();
});

test("a stretch of a road marked OB with two clicks on it (or from its right-click menu), its ends dragged along it; OB and beyond", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 500 }, { x: 800, y: 500 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await page.getByTestId("line-kind-road").click();
  await clickPlan(page, 150, 600);
  await clickPlan(page, 950, 600);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  await page.keyboard.press("Escape");
  const road = () => course(page).then(c => c.items.find((i: any) => i.type === "line"));
  await page.evaluate(id => (window as any).__dgActions.select(id), (await road()).id);
  // Only a stretch: where it starts, then where it ends (a click off the road does nothing)
  await page.getByRole("radiogroup", { name: "Penalty" }).getByRole("radio", { name: "OB", exact: true }).click();
  await page.getByTestId("ob-mark-stretch").click();
  await expect(page.getByTestId("ob-pick-bar")).toBeVisible();
  await clickPlan(page, 400, 600);
  await clickPlan(page, 550, 800);
  await clickPlan(page, 700, 600);
  await expect.poll(async () => (await road()).obStretches?.length ?? 0).toBe(1);
  const [[a, b]] = (await road()).obStretches;
  expect(a).toBeCloseTo(250 / 800, 1);
  expect(b).toBeCloseTo(550 / 800, 1);
  await expect(page.getByTestId("ob-pick-bar")).toBeHidden();
  await expect(page.getByTestId("ob-stretch")).toHaveText(/250 to 550 ft/);
  // Its end dragged along the road
  await drag(page, await handleCenter(page, "obend", 1), await screenOf(page, 850, 610));
  await expect.poll(async () => Math.round((await road()).obStretches[0][1] * 800)).toBeGreaterThan(680);
  // OB and beyond, then one undo step back
  await page.getByRole("radiogroup", { name: "Penalty" }).getByRole("radio", { name: "OB and beyond" }).click();
  await expect.poll(async () => (await road()).obBeyond).toBe(true);
  // For the hole beside it; then for all holes, and that hole picked again
  const holeId = (await course(page)).holes[0].id;
  await expect.poll(async () => (await road()).obHoles).toEqual([holeId]);
  await page.getByTestId("ob-for").getByRole("button", { name: "All holes" }).click();
  await expect.poll(async () => (await road()).obHoles).toBeUndefined();
  await page.getByTestId("ob-for").getByRole("button", { name: "Hole 1" }).click();
  await expect.poll(async () => (await road()).obHoles).toEqual([holeId]);
  // Another from the right-click menu: from here, then a click where it ends; Esc on a third
  await page.keyboard.press("Escape");
  const from = await screenOf(page, 200, 600);
  await page.mouse.click(from.x, from.y, { button: "right" });
  await page.getByRole("menuitem", { name: "OB along a stretch" }).click();
  await clickPlan(page, 300, 600);
  await expect.poll(async () => (await road()).obStretches?.length ?? 0).toBe(2);
  expect((await road()).obStretches[0][0]).toBeCloseTo(50 / 800, 1);
  await page.mouse.click(from.x, from.y, { button: "right" });
  await page.getByRole("menuitem", { name: "OB along a stretch" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ob-pick-bar")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__dgEditor().obPick)).toBeNull();
  await clickPlan(page, 120, 600);
  expect((await road()).obStretches).toHaveLength(2);
  // All of it again
  await page.evaluate(id => (window as any).__dgActions.select(id), (await road()).id);
  await page.getByTestId("ob-all").click();
  await expect.poll(async () => (await road()).obStretches).toBeUndefined();
  expect((await road()).ob).toBe(true);
});

test("a stretch taken out of a road with two clicks on it (two roads left), or from its right-click menu to its end (only shorter); one undo step", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("l");
  await page.getByTestId("line-kind-road").click();
  await clickPlan(page, 100, 600);
  await clickPlan(page, 900, 600);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const roads = () => course(page).then(c => c.items.filter((i: any) => i.type === "line"));
  const id = (await roads())[0].id;
  await page.evaluate(id => (window as any).__dgActions.select(id), id);
  await page.getByTestId("line-cut").click();
  await expect(page.getByTestId("ob-pick-bar")).toContainText("Remove a stretch");
  // Where it starts, then where it ends (a click off the road does nothing)
  await clickPlan(page, 400, 600);
  await clickPlan(page, 500, 800);
  await clickPlan(page, 600, 600);
  await expect.poll(async () => (await roads()).length).toBe(2);
  const [a, b] = await roads();
  expect(a.id).toBe(id);
  expect(Math.abs(a.points[a.points.length - 1].x - 400)).toBeLessThan(10);
  expect(Math.abs(b.points[0].x - 600)).toBeLessThan(10);
  expect(a.ob).toBeUndefined();
  await expect(page.getByTestId("ob-pick-bar")).toBeHidden();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await roads()).length).toBe(1);
  // From its right-click menu, to its end
  await page.keyboard.press("Escape");
  const from = await screenOf(page, 750, 600);
  await page.mouse.click(from.x, from.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Remove a stretch" }).click();
  await clickPlan(page, 905, 600);
  await expect.poll(async () => (await roads())[0].points.at(-1).x).toBeLessThan(760);
  expect(await roads()).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__dgEditor().obPick)).toBeNull();
});

test("a gate: two posts across the hole's line, passed between", async ({ page }) => {
  await blankCourse(page);
  // A hole running east
  const hole = await addHole(page, { x: 300, y: 500 }, { x: 800, y: 500 });
  await page.keyboard.press("m");
  await page.getByTestId("mando-kind-gate").click();
  await expect(page.getByTestId("tool-hint")).toContainText("where the gate is");
  await expect(page.getByTestId("tool-hint")).not.toContainText("the disc passes between");
  await clickPlan(page, 550, 505);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "mando").length).toBe(2);
  const [a, b] = (await course(page)).items.filter((i: any) => i.type === "mando");
  expect(a.pairId).toBe(b.id);
  expect(b.pairId).toBe(a.id);
  for (const m of [a, b]) {
    expect(m.holeId).toBe(hole.id);
    expect(Math.round(m.rotation)).toBe(0);
    expect(m.x).toBeCloseTo(550, 0);
  }
  // Facing east: the north post (left of the line) is passed on its right, the south one on its left
  const north = a.y < b.y ? a : b, south = a.y < b.y ? b : a;
  expect(north.y).toBeLessThan(500);
  expect(south.y).toBeGreaterThan(500);
  expect(north.side).toBe("right");
  expect(south.side).toBe("left");
  await expect(page.getByTestId("mando-chip")).toHaveCount(2);
});

test("a new line's points snap onto the corners of shapes already drawn", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("o");
  for (const [x, y] of [[300, 300], [600, 300], [600, 500]]) await clickPlan(page, x, y);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
  const corner = (await course(page)).items[0].points[1];
  // Start an OB line a few pixels off the area's corner, end it in the open
  await page.keyboard.press("l");
  const near = await screenOf(page, corner.x, corner.y);
  await page.mouse.click(near.x + 4, near.y - 3);
  await clickPlan(page, 900, 300);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  const line = (await course(page)).items.find((i: any) => i.type === "line");
  expect(line.points[0]).toEqual({ x: corner.x, y: corner.y });
  // Far from any corner: no snapping
  expect(line.points[1].x).toBeCloseTo(900, -1);
});

test("a mando joins the hole it is placed beside, not just the one being worked on", async ({ page }) => {
  await blankCourse(page);
  const first = await addHole(page, { x: 300, y: 800 }, { x: 300, y: 300 });
  const second = await addHole(page, { x: 900, y: 300 }, { x: 900, y: 800 });
  expect((await editorState(page)).activeHoleId).toBe(second.id);
  await page.keyboard.press("m");
  // (the pointer there first, as a person's is: on a slow machine its move can come after the click)
  const p = await screenOf(page, 320, 550);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.waitForTimeout(300);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.type === "mando")?.holeId).toBe(first.id);
  const mando = (await course(page)).items.find((i: any) => i.type === "mando");
  // Facing up the first hole (north)
  expect(Math.round(mando.rotation)).toBe(-90);
});

test("turning drawn shapes: an area with its round handle, a path with the Turn buttons; one undo step each", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => {
    const a = (window as any).__dgActions;
    a.addDrawn("area", [{ x: 400, y: 400 }, { x: 560, y: 400 }, { x: 560, y: 460 }, { x: 400, y: 460 }]);
  });
  const area = (await course(page)).items.find((i: any) => i.type === "area");
  await page.keyboard.press("v");
  await page.evaluate(id => (window as any).__dgActions.select(id), area.id);
  // A quarter turn about its middle (480, 430)
  const r = await handleCenter(page, "rotate");
  const mid = await screenOf(page, 480, 430);
  await drag(page, r, { x: mid.x + (mid.y - r.y), y: mid.y }, 12);
  const turned = (await course(page)).items.find((i: any) => i.id === area.id).points;
  const xs = turned.map((p: any) => p.x), ys = turned.map((p: any) => p.y);
  // (long side now north-south)
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === area.id).points[1].x).toBeCloseTo(560, 3);
  // A path: Turn right 90° in the inspector
  await page.evaluate(() => (window as any).__dgActions.addDrawn("line", [{ x: 300, y: 600 }, { x: 400, y: 600 }]));
  const path = (await course(page)).items.find((i: any) => i.type === "line");
  await page.evaluate(id => (window as any).__dgActions.select(id), path.id);
  await page.getByRole("button", { name: "Turn right 90°" }).click();
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === path.id).points.map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([{ x: 350, y: 550 }, { x: 350, y: 650 }]);
  await page.getByRole("button", { name: "Turn left 15°" }).click();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => Math.round((await course(page)).items.find((i: any) => i.id === path.id).points[0].x)).toBe(350);
});

test("walks to the next hole are drawn over the paths they cross", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("v");
  await page.evaluate(() => {
    const w = window as any;
    w.__dgEditor().set({ lineKind: "path" });
    w.__dgActions.addDrawn("line", [{ x: 300, y: 500 }, { x: 700, y: 500 }]);
    w.__dgEditor().set({ lineKind: "walk" });
    w.__dgActions.addDrawn("line", [{ x: 500, y: 300 }, { x: 500, y: 700 }]);
  });
  // (the walk as wide as a path: a ribbon like the path's)
  await page.getByRole("slider", { name: "Width" }).fill("8");
  const items = (await course(page)).items;
  const path = items.find((i: any) => i.kind === "path"), walk = items.find((i: any) => i.kind === "walk");
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === walk.id).width).toBe(8);
  const orders = (name: string) => page.evaluate(n => {
    const out: number[] = [];
    (window as any).__dgView.scene.getObjectByName(n)?.traverse((o: any) => { if (o.isMesh) out.push(o.renderOrder); });
    return out;
  }, name);
  await expect.poll(async () => (await orders(`line:${walk.id}`)).length).toBeGreaterThan(1);
  expect((await orders(`line:${path.id}`)).length).toBeGreaterThan(0);
  expect(Math.min(...(await orders(`line:${walk.id}`)))).toBeGreaterThan(Math.max(...(await orders(`line:${path.id}`))));
});

test("a placed path made longer from either end with its + handles", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("v");
  await page.evaluate(() => {
    const w = window as any;
    w.__dgEditor().set({ lineKind: "path" });
    w.__dgActions.addDrawn("line", [{ x: 400, y: 500 }, { x: 600, y: 500 }]);
  });
  const path = (await course(page)).items.find((i: any) => i.kind === "path");
  await expect(page.locator('[data-handle="extend"]')).toHaveCount(2);
  // On from its end, then from its start
  await drag(page, await handleCenter(page, "extend", 1), await screenOf(page, 750, 560));
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === path.id).points.length).toBe(3);
  let pts = (await course(page)).items.find((i: any) => i.id === path.id).points;
  expect(Math.hypot(pts[2].x - 750, pts[2].y - 560)).toBeLessThan(8);
  await drag(page, await handleCenter(page, "extend", 0), await screenOf(page, 300, 450));
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === path.id).points.length).toBe(4);
  pts = (await course(page)).items.find((i: any) => i.id === path.id).points;
  expect(Math.hypot(pts[0].x - 300, pts[0].y - 450)).toBeLessThan(8);
  // One undo step each
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === path.id).points.length).toBe(3);
});

test("a tree made taller keeps its shape: its crown grows with it, and in 3D it is never stretched thin", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("v");
  await page.evaluate(() => (window as any).__dgActions.placeAt("add-tree", { x: 500, y: 500 }));
  const tree = (await course(page)).items.find((i: any) => i.type === "tree");
  await page.evaluate(id => (window as any).__dgActions.select(id), tree.id);
  const h0 = tree.height ?? tree.radius * 2.6;
  await page.getByRole("slider", { name: "Height" }).fill(String(Math.round(h0 * 2)));
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === tree.id).height).toBe(Math.round(h0 * 2));
  const r = (await course(page)).items.find((i: any) => i.id === tree.id).radius;
  expect(r / tree.radius).toBeGreaterThan(1.8);
  expect(r / tree.radius).toBeLessThan(2.2);
});

plain("a tree's crown is drawn as wide as set, whatever its height (all the way along both sliders)", () => {
  for (const [shape, natural] of [["deciduous", 0.75], ["conifer", 0.62]] as const) {
    for (const height of [3, 10, 40, 80, 110]) {
      for (const radius of [2, 5, 10, 20, 40]) {
        const drawn = height * natural * treeSpread((radius * 2) / height / natural);
        plainExpect(drawn).toBeCloseTo(radius * 2, 6);
      }
    }
    void shape;
  }
});

test("an OB line set to be OB for two holes with the hole buttons; back to all holes", async ({ page }) => {
  await blankCourse(page);
  const a = await addHole(page, { x: 300, y: 400 }, { x: 700, y: 400 });
  const b = await addHole(page, { x: 300, y: 600 }, { x: 700, y: 600 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.evaluate(() => {
    const w = window as any;
    w.__dgEditor().set({ lineKind: "ob" });
    w.__dgActions.addDrawn("line", [{ x: 500, y: 300 }, { x: 500, y: 700 }]);
  });
  const line = async () => (await course(page)).items.find((i: any) => i.type === "line");
  const picker = page.getByTestId("belongs-to");
  await picker.getByRole("button", { name: "Hole 1" }).click();
  await picker.getByRole("button", { name: "Hole 2" }).click();
  await expect.poll(async () => { const l = await line(); return [l.holeId, l.alsoHoles]; }).toEqual([a.id, [b.id]]);
  await expect(picker.getByRole("button", { name: "Hole 2" })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "All holes" }).click();
  await expect.poll(async () => (await line()).holeId).toBeUndefined();
});

test("a creek wider in one stretch: drag the square on its bank; the Width slider sets it all along; double-click and Even width; made a path, its widths go", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("v");
  await page.evaluate(() => {
    const w = window as any;
    w.__dgEditor().set({ lineKind: "stream" });
    w.__dgActions.addDrawn("line", [{ x: 200, y: 500 }, { x: 500, y: 500 }, { x: 800, y: 500 }]);
  });
  const creek = async () => (await course(page)).items.find((i: any) => i.type === "line");
  const c0 = await creek();
  expect(c0.kind).toBe("stream");
  expect(c0.widths).toBeUndefined();
  await page.evaluate(id => (window as any).__dgActions.select(id), c0.id);
  // A square on either bank at each point
  await expect(page.locator('[data-handle="linewidth"]')).toHaveCount(6);
  const square = page.locator('[data-handle="linewidth"][data-point="1"][data-side="1"]');
  const center = async () => { const b = (await square.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // (feet per pixel across the creek)
  const a = await screenOf(page, 500, 500), b = await screenOf(page, 500, 600);
  const ftPerPx = 100 / Math.hypot(b.x - a.x, b.y - a.y);
  // Pulled out 30 px away from the creek's middle: only the middle point gets wider
  const from = await center();
  const dir = { x: (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y), y: (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y) };
  await drag(page, from, { x: from.x + dir.x * 30, y: from.y + dir.y * 30 }, 6);
  await expect.poll(async () => (await creek()).widths?.length).toBe(3);
  const w1 = (await creek()).widths;
  expect(w1[0]).toBe(1);
  expect(w1[2]).toBe(1);
  // (6 ft wide, each bank 30 px further out)
  expect(w1[1] * 6).toBeCloseTo(6 + 2 * 30 * ftPerPx, -1);
  expect((await creek()).width).toBeUndefined();
  await expect(page.getByTestId("line-widths")).toBeVisible();
  // The whole creek twice as wide: that stretch stays wider than the rest
  await page.getByRole("slider", { name: "Width (all along)" }).fill("12");
  await expect.poll(async () => (await creek()).width).toBe(12);
  expect((await creek()).widths).toEqual(w1);
  // A point put in between keeps the widths in step with the points
  const mid = await handleCenter(page, "mid", 0);
  await drag(page, mid, { x: mid.x, y: mid.y - 20 }, 4);
  await expect.poll(async () => (await creek()).points.length).toBe(4);
  const w2 = (await creek()).widths;
  expect(w2).toHaveLength(4);
  expect(w2[1]).toBeGreaterThan(1);
  expect(w2[1]).toBeLessThan(w1[1]);
  expect(w2[2]).toBe(w1[1]);
  // Double-click the wide point's square: back to the creek's width there
  await expect(page.locator('[data-handle="linewidth"]')).toHaveCount(8);
  const wide = page.locator('[data-handle="linewidth"][data-point="2"][data-side="1"]');
  const wb = (await wide.boundingBox())!;
  await page.mouse.dblclick(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await expect.poll(async () => (await creek()).widths?.[2]).toBe(1);
  // Even width: the same all along (one undo step brings the stretch back)
  await page.getByRole("button", { name: "Even width" }).click();
  await expect.poll(async () => (await creek()).widths).toBeUndefined();
  await expect(page.getByTestId("line-widths")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await creek()).widths?.length).toBe(4);
  await expect(page.getByTestId("line-widths")).toBeVisible();
  // Made a path: one width all along, and the creek's widths and width go with it
  const lineKind = page.getByRole("radiogroup", { name: "Line kind" });
  await lineKind.getByRole("radio", { name: "Walking path" }).click();
  await expect.poll(async () => (await creek()).kind).toBe("path");
  expect((await creek()).widths).toBeUndefined();
  expect((await creek()).width).toBeUndefined();
  await expect(page.getByText("Width (all along)")).toHaveCount(0);
  await expect(page.getByTestId("line-widths")).toHaveCount(0);
  await expect(page.locator('[data-handle="linewidth"]')).toHaveCount(0);
  // A creek again: even, at a creek's width
  await lineKind.getByRole("radio", { name: "Stream" }).click();
  await expect.poll(async () => (await creek()).kind).toBe("stream");
  expect((await creek()).widths).toBeUndefined();
  await expect(page.getByTestId("line-widths")).toHaveCount(0);
  await expect(page.locator('[data-handle="linewidth"]')).toHaveCount(8);
});

plain("a stretch round a ring goes the way it was traced, the shorter way when not; across its start, two stretches (pure logic)", async () => {
  const { ringStretch, isRing } = await import("../../src/lib/course");
  plainExpect(ringStretch(0.2, 0.4, 1)).toEqual([[0.2, 0.4]]);
  plainExpect(ringStretch(0.2, 0.4, -1)).toEqual([[0.4, 1], [0, 0.2]]);
  plainExpect(ringStretch(0.9, 0.1, 0)).toEqual([[0.9, 1], [0, 0.1]]);
  plainExpect(ringStretch(0.1, 0.9, 0)).toEqual([[0.9, 1], [0, 0.1]]);
  plainExpect(isRing([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 1 }])).toBe(true);
  plainExpect(isRing([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 30 }])).toBe(false);
});

test("any area's edge OB: all round, or a stretch traced the long way round", async ({ page }) => {
  await blankCourse(page);
  const id = await page.evaluate(() => {
    (window as any).__dgEditor().set({ areaKind: "building" });
    (window as any).__dgActions.addDrawn("area", [{ x: 300, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 600 }, { x: 300, y: 600 }]);
    (window as any).__dgEditor().set({ tool: "select" });
    return (window as any).__dgEditor().selectedId;
  });
  const area = () => course(page).then(c => c.items.find((i: any) => i.id === id));
  await page.getByRole("radiogroup", { name: "Penalty" }).getByRole("radio", { name: "OB", exact: true }).click();
  await expect.poll(async () => (await area()).ob).toBe(true);
  await expect(page.getByTestId("ob-stretches")).toContainText("All the way round");
  // Only a stretch: from the top's middle, round by the right, the bottom and the left, to near the top-left corner
  await page.getByTestId("ob-mark-stretch").click();
  // (not at the edge's middle: that's the handle that adds a corner)
  await clickPlan(page, 420, 300);
  for (const [x, y] of [[520, 300], [560, 300], [600, 400], [600, 520], [520, 600], [400, 600], [300, 560], [300, 420], [300, 320], [360, 300]]) {
    const p = await screenOf(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(40);
  }
  await clickPlan(page, 360, 300);
  await expect.poll(async () => (await area()).obStretches?.length ?? 0).toBeGreaterThan(0);
  const total = (await area()).obStretches.reduce((t: number, [a, b]: number[]) => t + (b - a), 0);
  expect(total).toBeGreaterThan(0.7);
});

test("a building drawn over trees: the trees standing in it go, one undo step", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => {
    const a = (window as any).__dgActions;
    a.placeAt("add-tree", { x: 450, y: 450 });
    a.placeAt("add-tree", { x: 800, y: 800 });
    (window as any).__dgEditor().set({ areaKind: "building" });
    a.addDrawn("area", [{ x: 300, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 600 }, { x: 300, y: 600 }]);
  });
  const trees = () => course(page).then(c => c.items.filter((i: any) => i.type === "tree").length);
  expect(await trees()).toBe(1);
  await expect(page.getByText("Took out 1 tree standing in it.")).toBeVisible();
  // (a dropdown's list reads light on dark)
  const bg = await page.evaluate(() => { const o = document.createElement("option"); const s = document.createElement("select"); s.appendChild(o); document.body.appendChild(s); const c = getComputedStyle(o).backgroundColor; s.remove(); return c; });
  expect(bg).toBe("rgb(29, 38, 33)");
});

test("OB and beyond: the app's side, or either side chosen (named by the compass)", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 300, y: 500 }, { x: 800, y: 500 });
  await page.keyboard.press("Escape");
  const id = await page.evaluate(() => {
    (window as any).__dgEditor().set({ lineKind: "road" });
    (window as any).__dgActions.addDrawn("line", [{ x: 150, y: 600 }, { x: 950, y: 600 }]);
    (window as any).__dgEditor().set({ tool: "select" });
    return (window as any).__dgEditor().selectedId;
  });
  const road = () => course(page).then(c => c.items.find((i: any) => i.id === id));
  await page.getByRole("radiogroup", { name: "Penalty" }).getByRole("radio", { name: "OB and beyond" }).click();
  // (the hole is north of the road: OB runs south, away from it)
  const side = page.getByRole("radiogroup", { name: "OB side" });
  await expect(side.getByRole("radio", { name: "Auto (south)" })).toHaveAttribute("aria-checked", "true");
  await side.getByRole("radio", { name: "North", exact: true }).click();
  await expect.poll(async () => (await road()).obToward).toBe(-1);
  await side.getByRole("radio", { name: /Auto/ }).click();
  await expect.poll(async () => (await road()).obToward).toBeUndefined();
});

test("tall grass has no underbrush until you pick some; then it grows there in 3D", async ({ page }) => {
  await blankCourse(page);
  const id = await page.evaluate(() => {
    (window as any).__dgEditor().set({ areaKind: "rough", tool: "select" });
    (window as any).__dgActions.addDrawn("area", [{ x: 300, y: 400 }, { x: 700, y: 400 }, { x: 700, y: 700 }, { x: 300, y: 700 }]);
    const d = (window as any).__dgCourse();
    const a = d.items[d.items.length - 1];
    (window as any).__dgActions.select(a.id);
    return a.id;
  });
  const insp = page.getByTestId("inspector");
  const brush = insp.getByRole("radiogroup", { name: "Underbrush", exact: true });
  await expect(brush.getByRole("radio", { name: "None" })).toHaveAttribute("aria-checked", "true");
  // (how many bushes grow in it: the tall grass never cleared its own underbrush away)
  const grows = () => page.evaluate(id => (window as any).__dgView.shapes.get(`woods:${id}:under`)?.obj.userData.spots?.length ?? 0, id);
  expect(await grows()).toBe(0);
  await brush.getByRole("radio", { name: "Light" }).click();
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === id).underbrush).toBe("light");
  await expect.poll(grows, { timeout: 30_000 }).toBeGreaterThan(100);
  const light = await grows();
  // Heavy: closer still
  await brush.getByRole("radio", { name: "Heavy" }).click();
  await expect.poll(grows, { timeout: 30_000 }).toBeGreaterThan(light * 3);
  // Back to none: gone again
  await brush.getByRole("radio", { name: "None" }).click();
  await expect.poll(grows, { timeout: 30_000 }).toBe(0);
});

test("a wood of bushes drawn over tall grass: its bushes grow there", async ({ page }) => {
  await blankCourse(page);
  const id = await page.evaluate(() => {
    const a = (window as any).__dgActions, e = (window as any).__dgEditor();
    e.set({ areaKind: "rough", tool: "select" });
    a.addDrawn("area", [{ x: 250, y: 350 }, { x: 750, y: 350 }, { x: 750, y: 750 }, { x: 250, y: 750 }]);
    (window as any).__dgEditor().set({ areaKind: "woods", tool: "select" });
    a.addDrawn("area", [{ x: 300, y: 400 }, { x: 700, y: 400 }, { x: 700, y: 700 }, { x: 300, y: 700 }]);
    const d = (window as any).__dgCourse();
    const w = d.items[d.items.length - 1];
    a.updateItem(w.id, { bushes: 1, pines: undefined });
    a.select(null);
    return w.id;
  });
  const bushes = () => page.evaluate(id => (window as any).__dgView.shapes.get(`woods:${id}:under`)?.obj.userData.spots?.length ?? 0, id);
  await expect.poll(bushes, { timeout: 30_000 }).toBeGreaterThan(100);
});

test("the ? in the hint over the tool bar opens its tip on the screen, above the hint", async ({ page }) => {
  await blankCourse(page);
  await page.getByTestId("tool-bar").getByRole("button", { name: /Build/ }).click();
  const hint = page.getByTestId("tool-hint");
  await hint.getByRole("button", { name: /^Help:/ }).click();
  const tip = page.getByTestId("help-tip");
  await expect(tip).toBeVisible();
  const t = (await tip.boundingBox())!, h = (await hint.boundingBox())!, vh = page.viewportSize()!.height;
  plainExpect(t.y).toBeGreaterThanOrEqual(0);
  plainExpect(t.y + t.height).toBeLessThanOrEqual(h.y);
  plainExpect(t.y + t.height).toBeLessThanOrEqual(vh);
  // (its way on to the guide works from there too)
  await tip.getByTestId("help-tip-more").click();
  await expect(tip).toHaveCount(0);
});
