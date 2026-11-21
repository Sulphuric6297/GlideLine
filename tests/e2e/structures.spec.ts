// Built things: bridges, boardwalks, stairs, walls, buildings, shelters and decks. Drawn with the
// Build tool, edited in the inspector, reshaped with handles, real 3D models in the map view, and
// drawn on the printed map (every style) with their legend lines.
import { test as plain, expect as plainExpect } from "@playwright/test";
import { test, expect, blankCourse, clickPlan, course, drag, editorState, handleCenter, screenOf } from "./fixtures";
import { STRUCTURE_ORDER } from "../../src/constants";
import { createArea, createBasket, createEmptyCourse, createStructure, createTee, newHole, normalizeCourse, createAmenity } from "../../src/lib/course";
import { THEMES, renderPoster } from "../../src/lib/mapSvg";
import { boardwalkDeck, bridgeDeck, gazeboOutline, roofOf, stairSteps } from "../../src/lib/structures";
import { roofShape } from "../../src/lib/geo/buildings";
import type { MapTheme, StructureKind } from "../../src/types";

const structures = async (page: import("@playwright/test").Page) => (await course(page)).items.filter((i: any) => i.type === "structure");
/** The meshes of a structure's 3D model, by material ("deck", "timber", "stone", a building's "walls"...). */
const model = (page: import("@playwright/test").Page, id: string) =>
  page.evaluate(id => {
    const g = (window as any).__dgView.scene.getObjectByName(`structure:${id}`);
    return g ? { kind: g.userData.structure, parts: g.children.map((c: any) => c.name).sort(), cast: g.children.every((c: any) => c.castShadow) } : null;
  }, id);

test("a bridge drawn with the Build tool; the inspector sets its width, height and name; undo and redo", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("s");
  expect((await editorState(page)).tool).toBe("draw-structure");
  await page.getByTestId("structure-kind-bridge").click();
  await expect(page.getByTestId("tool-hint")).toContainText("Click one bank");
  await clickPlan(page, 400, 500);
  await clickPlan(page, 440, 470);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const bridge = (await structures(page))[0];
  expect(bridge.kind).toBe("bridge");
  expect(bridge.points).toHaveLength(2);
  expect((await editorState(page)).tool).toBe("select");
  expect((await editorState(page)).selectedId).toBe(bridge.id);
  await expect(page.getByTestId("inspector-title")).toHaveText("Bridge");
  await expect(page.getByTestId("structure-size")).toHaveText(/^\d+ ft long$/);
  expect(Math.hypot(bridge.points[1].x - bridge.points[0].x, bridge.points[1].y - bridge.points[0].y)).toBeCloseTo(50, -1);
  // A real model: deck boards, timber rails and beams, stone abutments; selected, it's see-through
  // (to see the map under it while it's reshaped), casting no shadow; let go of, solid again
  await expect.poll(() => model(page, bridge.id)).toEqual({ kind: "bridge", parts: ["deck", "stone", "timber"], cast: false });
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await expect.poll(() => model(page, bridge.id)).toEqual({ kind: "bridge", parts: ["deck", "stone", "timber"], cast: true });
  await page.evaluate(id => (window as any).__dgActions.select(id), bridge.id);
  await expect(page.getByTestId("inspector-title")).toHaveText("Bridge");
  // Inspector edits, one undo step each
  await page.getByRole("slider", { name: "Width" }).fill("8");
  await expect.poll(async () => (await structures(page))[0].width).toBe(8);
  await page.getByRole("slider", { name: "Deck above the banks" }).fill("2.5");
  await expect.poll(async () => (await structures(page))[0].height).toBe(2.5);
  await page.getByLabel("Structure name").fill("Mill Creek Bridge");
  await expect.poll(async () => (await structures(page))[0].label).toBe("Mill Creek Bridge");
  // Its name shows on the map
  await expect(page.getByTestId("plan").getByText("Mill Creek Bridge", { exact: true })).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo" });
  await undo.click();
  await expect.poll(async () => (await structures(page))[0].label).toBeUndefined();
  expect((await structures(page))[0].height).toBe(2.5);
  // Back past the edits to before it was drawn
  for (let i = 0; i < 6 && (await structures(page)).length; i++) await undo.click();
  await expect.poll(async () => (await structures(page)).length).toBe(0);
  await expect.poll(() => model(page, bridge.id)).toBeNull();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  await expect.poll(() => model(page, bridge.id)).not.toBeNull();
});

/** What each kind's model is made of (its meshes, one per material). */
const MATERIALS: Record<StructureKind, string[]> = {
  bridge: ["deck", "stone", "timber"], boardwalk: ["deck", "timber"], stairs: ["concrete", "timber"], wall: ["stone"],
  // (a building: its walls and roof, foundation, trim, window frames, glass and the rooms behind it, a door)
  building: ["dark", "door", "found", "frames", "glass", "roof", "room", "trim", "walls"], shelter: ["concrete", "shelterRoof", "timber"], deck: ["deck", "timber"]
};

// (a wall is a line now, drawn from Build beside the fence: tests/e2e/walls.spec.ts)
test("a boardwalk and stairs drawn from the Features list, click by click", async ({ page }) => {
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  let x = 250;
  for (const kind of ["boardwalk", "stairs"] as const) {
    await page.keyboard.press("s");
    await page.getByTestId(`structure-kind-${kind}`).click();
    await expect.poll(async () => (await editorState(page)).tool).toBe("draw-structure");
    await clickPlan(page, x, 400);
    await clickPlan(page, x + 40, 470, { double: true });
    await expect.poll(async () => (await structures(page)).map((s: any) => s.kind)).toContain(kind);
    x += 250;
  }
  const all = await structures(page);
  expect(all.map((s: any) => s.kind)).toEqual(["boardwalk", "stairs"]);
  for (const s of all) {
    expect(s.points, s.kind).toHaveLength(2);
    await expect.poll(async () => (await model(page, s.id))?.parts, s.kind).toEqual(MATERIALS[s.kind as StructureKind]);
  }
});

test("a building, a shelter and a deck dragged out as rectangles; kind and roof in the inspector", async ({ page }) => {
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  let x = 250;
  for (const kind of ["building", "shelter", "deck"] as const) {
    await page.keyboard.press("s");
    await page.getByTestId(`structure-kind-${kind}`).click();
    await page.getByTestId("draw-shape-box").click();
    await drag(page, await screenOf(page, x, 400), await screenOf(page, x + 60, 440), 3);
    await expect.poll(async () => (await structures(page)).map((s: any) => s.kind)).toContain(kind);
    x += 250;
  }
  const all = await structures(page);
  expect(all.map((s: any) => s.kind)).toEqual(["building", "shelter", "deck"]);
  for (const s of all) {
    expect(s.points, s.kind).toHaveLength(4);
    await expect.poll(async () => (await model(page, s.id))?.parts, s.kind).toEqual(MATERIALS[s.kind as StructureKind]);
  }
  // The inspector offers kinds of the same shape, and a building's roof
  await page.evaluate(id => (window as any).__dgActions.select(id), all[0].id);
  await expect(page.getByTestId("inspector-title")).toHaveText("Building");
  const kind = page.getByRole("radiogroup", { name: "Structure kind" });
  await expect(kind.getByRole("radio")).toHaveText(["Building", "Shelter", "Deck"]);
  await page.getByRole("radiogroup", { name: "Roof" }).getByRole("radio", { name: "Hip" }).click();
  await expect.poll(async () => (await structures(page))[0].roof).toBe("hip");
  await kind.getByRole("radio", { name: "Shelter" }).click();
  await expect.poll(async () => (await structures(page))[0].kind).toBe("shelter");
  await expect.poll(async () => (await model(page, all[0].id))?.parts).toEqual(MATERIALS.shelter);
});

test("reshaping a building with its corner and mid handles, moving it, deleting it", async ({ page }) => {
  // (a long test: 45 s by itself on the test machine, twice that with others running beside it)
  test.setTimeout(180_000);
  await blankCourse(page);
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 340, minY: 340, maxX: 560, maxY: 520 }, { animate: false }));
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  // (buildings start as rectangles: corner by corner here)
  await page.getByTestId("draw-shape-points").click();
  for (const [x, y] of [[400, 400], [480, 400], [480, 460]] as const) await clickPlan(page, x, y);
  await clickPlan(page, 400, 460, { double: true });
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  // Drag a corner out
  await drag(page, await handleCenter(page, "corner", 0), await screenOf(page, 380, 380));
  await expect.poll(async () => Math.round((await structures(page))[0].points[0].x)).toBeLessThan(390);
  // Pull a mid dot: a fifth corner
  await drag(page, await handleCenter(page, "mid", 1), await screenOf(page, 500, 430));
  await expect.poll(async () => (await structures(page))[0].points.length).toBe(5);
  // Drag the inside: it moves
  const before = (await structures(page))[0].points[1].x;
  await drag(page, await screenOf(page, 430, 430), await screenOf(page, 460, 430));
  await expect.poll(async () => (await structures(page))[0].points[1].x).toBeGreaterThan(before + 15);
  // The model followed (rebuilt), and Delete takes it away
  await expect.poll(() => model(page, id)).not.toBeNull();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await structures(page)).length).toBe(0);
  await expect.poll(() => model(page, id)).toBeNull();
});

test("buildings like the Security Camera Planner's: type, a color scheme, siding, roofs, turning, height; a shelter as a gazebo", async ({ page }) => {
  // (a long test: 45 s by itself on the test machine, twice that with others running beside it)
  test.setTimeout(180_000);
  await blankCourse(page);
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 300, minY: 300, maxX: 700, maxY: 600 }, { animate: false }));
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await clickPlan(page, 400, 400);
  await clickPlan(page, 480, 450);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  await page.keyboard.press("Escape");
  await page.evaluate(i => (window as any).__dgActions.select(i), id);
  // Not every building is a house: a barn; painted in a color scheme (walls, trim and door at once);
  // brick siding; each part's color its own
  await page.getByTestId("building-type").getByRole("radio", { name: "Barn" }).click();
  await expect.poll(async () => (await structures(page))[0].buildingType).toBe("barn");
  await page.getByTestId("scheme-sage").click();
  await expect.poll(async () => (await structures(page))[0].wallColor).toBe("#8e9b80");
  expect((await structures(page))[0].doorColor).toBe("#8a2f26");
  await page.getByTestId("building-siding-brick").click();
  await expect.poll(async () => (await structures(page))[0].siding).toBe("brick");
  await page.getByTestId("color-trimColor").click();
  await page.getByRole("button", { name: "Navy" }).first().click();
  await expect.poll(async () => (await structures(page))[0].trimColor).toBe("#2f3e55");
  await page.getByRole("radiogroup", { name: "Roof" }).getByRole("radio", { name: "Flat" }).click();
  await expect.poll(async () => (await structures(page))[0].roof).toBe("flat");
  for (const roof of ["Shed", "Pyramid", "Gable"]) {
    await page.getByRole("radiogroup", { name: "Roof" }).getByRole("radio", { name: roof }).click();
    await expect.poll(async () => (await structures(page))[0].roof).toBe(roof.toLowerCase());
  }
  // Turned with its round handle, about its middle
  const before = (await structures(page))[0].points.map((p: any) => ({ ...p }));
  const r = await handleCenter(page, "rotate");
  const mid = await screenOf(page, 440, 425);
  await drag(page, r, { x: mid.x + (mid.y - r.y), y: mid.y }, 12);
  const after = (await structures(page))[0].points;
  const angle = (p: any) => Math.atan2(p.y - 425, p.x - 440);
  const turned = Math.abs(((angle(after[0]) - angle(before[0]) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  expect(turned).toBeGreaterThan(0.5);
  // Its height, with the handle above it in the tilted view
  await expect(page.locator('[data-handle="height"]')).toBeHidden();
  await page.keyboard.press("3");
  await expect(page.locator('[data-handle="height"]')).toBeVisible({ timeout: 20_000 });
  const h = await handleCenter(page, "height");
  await drag(page, h, { x: h.x, y: h.y - 60 }, 8);
  await expect.poll(async () => (await structures(page))[0].height ?? 12).toBeGreaterThan(14);
  await page.keyboard.press("2");
  // A shelter as a gazebo: eight sides and a pyramid roof
  await page.getByRole("radiogroup", { name: "Structure kind" }).getByRole("radio", { name: "Shelter" }).click();
  await page.getByRole("radiogroup", { name: "Shelter shape" }).getByRole("radio", { name: "Gazebo" }).click();
  await expect.poll(async () => (await structures(page))[0].points.length).toBe(8);
  expect((await structures(page))[0].roof).toBe("pyramid");
});

test("in 3D a click on a roof picks the building, not the tree standing over its edge; the tree's leaves pick the tree", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 300, minY: 300, maxX: 700, maxY: 600 }, { animate: false }));
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await clickPlan(page, 400, 400);
  await clickPlan(page, 480, 450);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const house = (await structures(page))[0].id;
  await page.keyboard.press("Escape");
  // A tree just behind the house (from where the 3D view looks), its crown over the roof's back edge
  await page.keyboard.press("r");
  await clickPlan(page, 440, 392);
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "tree").length).toBe(1);
  const tree = (await course(page)).items.find((i: any) => i.type === "tree");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await page.keyboard.press("3");
  await page.waitForTimeout(1500);
  // The roof in front of it: the line of sight goes on through the roof into the tree
  const roof = await screenOf(page, 440, 412, 14);
  await page.mouse.click(roof.x, roof.y);
  await expect.poll(async () => (await editorState(page)).selectedId).toBe(house);
  // The top of the tree's crown
  const crown = await screenOf(page, tree.x, tree.y, (tree.height ?? 30) * 0.9);
  await page.mouse.click(crown.x, crown.y);
  await expect.poll(async () => (await editorState(page)).selectedId).toBe(tree.id);
});

test("in 3D a click on a path just in front of a tree picks the path, not the tree", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 300, minY: 300, maxX: 700, maxY: 600 }, { animate: false }));
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("r");
  await clickPlan(page, 440, 420);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "tree").length).toBe(1);
  // A path passing the tree on the near side (from where the 3D view looks), inside its crown's reach
  await page.evaluate(() => (window as any).__dgActions.addDrawn("line", [{ x: 380, y: 431 }, { x: 500, y: 431 }]));
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line").length).toBe(1);
  const path = (await course(page)).items.find((i: any) => i.type === "line");
  await page.keyboard.press("v");
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await page.keyboard.press("3");
  await page.waitForTimeout(1500);
  const at = await screenOf(page, 434, 431, 0);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await editorState(page)).selectedId).toBe(path.id);
});

test("in 3D the ground cover round a tree is picked where the tree's leaves aren't drawn, even close by", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 300, minY: 300, maxX: 700, maxY: 600 }, { animate: false }));
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("r");
  await clickPlan(page, 440, 420);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "tree").length).toBe(1);
  await page.evaluate(() => (window as any).__dgActions.addDrawn("area", [{ x: 320, y: 320 }, { x: 560, y: 320 }, { x: 560, y: 520 }, { x: 320, y: 520 }]));
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area").length).toBe(1);
  const area = (await course(page)).items.find((i: any) => i.type === "area");
  await page.keyboard.press("v");
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await page.keyboard.press("3");
  await page.waitForTimeout(1500);
  // A spot on the area inside the tree's rough crown shape, with no leaves drawn under it
  const at = await screenOf(page, 440, 420, 25);
  const spot = await page.evaluate(([x, y]) => {
    const v = (window as any).__dgView;
    for (let r = 2; r <= 160; r += 1.5) for (let a = 0; a < 6.28; a += 0.1) {
      const p = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }, hit = v.treeUnder(v.ray(p.x, p.y)), g = v.groundAt(p.x, p.y);
      if (hit && !hit.drawn && g && g.x > 325 && g.x < 555 && g.z > 325 && g.z < 515) return p;
    }
    return null;
  }, [at.x, at.y] as const);
  expect(spot).not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await expect.poll(async () => (await editorState(page)).selectedId).toBe(area.id);
});

// --- Pure logic

plain("roofs that aren't a house's: flat, a single slope (shed), a pyramid over a gazebo's eight sides", () => {
  const rect = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }];
  const flat = roofOf(rect, "flat");
  plainExpect(flat.rise).toBe(0);
  plainExpect(flat.facets).toHaveLength(1);
  const shed = roofOf(rect, "shed");
  plainExpect(shed.facets).toHaveLength(1);
  plainExpect(shed.pitch).toBeLessThanOrEqual(0.25);
  // Low along one long side, high along the other
  plainExpect(Math.abs(shed.run({ x: 20, y: 0 }) - shed.run({ x: 20, y: 20 }))).toBeCloseTo(20, 5);
  const octagon = gazeboOutline(rect);
  plainExpect(octagon).toHaveLength(8);
  const c = { x: 20, y: 10 };
  for (const p of octagon) plainExpect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(15, 5);
  const pyramid = roofOf(octagon, "pyramid");
  plainExpect(pyramid.facets).toHaveLength(8);
  // Highest in the middle, level along every side
  plainExpect(pyramid.run(c)).toBeGreaterThan(pyramid.run({ x: (octagon[0].x + octagon[1].x) / 2, y: (octagon[0].y + octagon[1].y) / 2 }) + 10);
  // A gable and a hip come out as they always did
  plainExpect(roofOf(rect, "gable").facets).toHaveLength(2);
  plainExpect(roofOf(rect, "hip").facets).toHaveLength(4);
});

plain("a bridge spans a creek's dip: its deck runs straight between its ends, never into the ground", () => {
  // Level banks at 10 ft, a creek 8 ft deep in the middle
  const ground = (x: number) => (Math.abs(x - 50) < 12 ? 2 : 10);
  const deck = bridgeDeck([{ x: 20, y: 0 }, { x: 80, y: 0 }], x => ground(x), 1);
  plainExpect(deck[0].top).toBeCloseTo(11, 5);
  plainExpect(deck[deck.length - 1].top).toBeCloseTo(11, 5);
  const middle = deck.find(d => Math.abs(d.x - 50) < 0.6)!;
  // At the banks' height plus a slight camber, far above the creek bed
  plainExpect(middle.top).toBeGreaterThan(11);
  plainExpect(middle.top).toBeLessThan(13);
  plainExpect(middle.top - middle.ground).toBeGreaterThan(8);
  // A hump under it lifts the deck clear of the ground
  const hump = bridgeDeck([{ x: 0, y: 0 }, { x: 40, y: 0 }], x => (Math.abs(x - 20) < 4 ? 20 : 0), 1);
  plainExpect(Math.min(...hump.map(d => d.top - d.ground))).toBeGreaterThan(0.1);
});

plain("a boardwalk follows the ground at its height, ramping down at the ends; stairs climb the slope", () => {
  const slope = (x: number) => x * 0.2;
  const walk = boardwalkDeck([{ x: 0, y: 0 }, { x: 100, y: 0 }], x => slope(x), 1.5);
  const mid = walk.find(d => Math.abs(d.x - 50) < 0.6)!;
  plainExpect(mid.top - mid.ground).toBeCloseTo(1.5, 1);
  plainExpect(walk[0].top - walk[0].ground).toBeLessThan(0.6);
  const steps = stairSteps([{ x: 0, y: 0 }, { x: 20, y: 0 }], x => x * 0.5);
  // Risers no higher than about 7 inches, each step above the ground under it
  plainExpect(steps.length).toBeGreaterThanOrEqual(17);
  for (let i = 1; i < steps.length; i++) plainExpect(steps[i].top - steps[i - 1].top).toBeLessThan(0.62);
  for (const s of steps) plainExpect(s.top).toBeGreaterThanOrEqual(s.s1 * 0.5);
});

plain("roofs: a gable has two faces, a hip four, rising to the middle", () => {
  const rect = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 24 }, { x: 0, y: 24 }];
  const gable = roofOf(rect, "gable", 1.5);
  plainExpect(gable.facets).toHaveLength(2);
  plainExpect(gable.run({ x: 20, y: 12 })).toBeCloseTo(12, 5);
  plainExpect(gable.run({ x: 20, y: 0 })).toBeCloseTo(0, 5);
  // The ridge runs the long way: along its line the run doesn't change
  plainExpect(gable.run({ x: 2, y: 12 })).toBeCloseTo(12, 5);
  const hip = roofOf(rect, "hip", 1.5);
  plainExpect(hip.facets).toHaveLength(4);
  plainExpect(hip.run({ x: 2, y: 12 })).toBeCloseTo(2, 5);
  // The eaves overhang the walls
  plainExpect(Math.min(...hip.eaves.map(p => p.x))).toBeCloseTo(-1.5, 5);
});

/** A course with one hole and one of every built thing. */
const builtCourse = () => {
  const doc = createEmptyCourse();
  doc.name = "Springfield Park";
  const h = newHole();
  doc.holes.push(h);
  doc.items.push(createTee(h.id, { x: 100, y: 500 }), createBasket(h.id, { x: 500, y: 500 }));
  const rect = (x: number, y: number, w: number, d: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
  doc.items.push(
    createStructure("bridge", [{ x: 200, y: 480 }, { x: 240, y: 480 }]),
    createStructure("boardwalk", [{ x: 250, y: 560 }, { x: 300, y: 580 }, { x: 360, y: 570 }]),
    createStructure("stairs", [{ x: 380, y: 420 }, { x: 400, y: 400 }]),
    createStructure("wall", [{ x: 120, y: 380 }, { x: 220, y: 390 }]),
    createStructure("building", rect(300, 300, 44, 28)),
    createStructure("shelter", rect(420, 600, 30, 20)),
    createStructure("deck", rect(80, 520, 18, 14))
  );
  return doc;
};

plain("the printed map draws every built thing in every style, with a legend line for each kind there is", () => {
  const doc = builtCourse();
  for (const theme of Object.keys(THEMES) as MapTheme[]) {
    doc.style.theme = theme;
    const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
    for (const kind of STRUCTURE_ORDER) plainExpect(svg, `${theme} ${kind}`).toContain(`data-structure="${kind}"`);
  }
  doc.style.theme = "illustrated";
  doc.style.legend = true;
  const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  const legend = svg.slice(svg.indexOf(">LEGEND<"));
  for (const label of ["Bridge", "Boardwalk", "Stairs", "Wall", "Building", "Shelter", "Deck"]) plainExpect(legend).toContain(`>${label}<`);
  // Only the kinds on the map
  doc.items = doc.items.filter(i => i.type !== "structure" || i.kind === "bridge");
  const fewer = renderPoster(doc, { contours: null, hillshade: null }).svg;
  const fewerLegend = fewer.slice(fewer.indexOf(">LEGEND<"));
  plainExpect(fewerLegend).toContain(">Bridge<");
  plainExpect(fewerLegend).not.toContain(">Boardwalk<");
  plainExpect(fewerLegend).not.toContain(">Building<");
});

plain("a roof's lit face follows the map's sun", () => {
  const doc = builtCourse();
  doc.items = doc.items.filter(i => i.type !== "structure" || i.kind === "building");
  doc.style.theme = "illustrated";
  const faces = (sunFrom: number) => {
    doc.style.sunFrom = sunFrom;
    const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
    const roof = svg.slice(svg.indexOf('data-structure="building"'));
    return [...roof.matchAll(/<path d="[^"]+Z" fill="(#[0-9a-f]{6})" stroke=/g)].slice(0, 2).map(m => m[1]);
  };
  // The sun from the south: the south face is the lighter; low in the north-east (a summer morning,
  // as far north as the sun goes here): the north face is (the sun never shines from due north)
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  const fromSouth = faces(180), fromNorthEast = faces(60);
  plainExpect(fromSouth).toHaveLength(2);
  plainExpect(lum(fromSouth[0]) > lum(fromSouth[1])).not.toBe(lum(fromNorthEast[0]) > lum(fromNorthEast[1]));
});

plain("older courses still load and draw: the building area, the bridge and shelter pictograms; a structure with defaults", () => {
  const raw = {
    holes: [],
    items: [
      createArea("building", [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }]),
      createAmenity({ x: 50, y: 50 }, "bridge"),
      createAmenity({ x: 80, y: 50 }, "shelter"),
      { id: "s1", type: "structure", kind: "bridge", points: [{ x: 10, y: 80 }, { x: 40, y: 80 }], x: 25, y: 80, rotation: 0 },
      // (Damaged: no points, or a kind this version doesn't know)
      { id: "s2", type: "structure", kind: "bridge", x: 0, y: 0, rotation: 0 },
      { id: "s3", type: "structure", kind: "castle", points: [], x: 0, y: 0, rotation: 0 }
    ],
    style: { theme: "illustrated" }
  } as any;
  const doc = normalizeCourse(raw);
  plainExpect(doc.items.map(i => i.id)).toEqual([raw.items[0].id, raw.items[1].id, raw.items[2].id, "s1"]);
  doc.style.legend = true;
  const svg = renderPoster(doc, { contours: null, hillshade: null }).svg;
  plainExpect(svg).toContain('data-symbol="bridge"');
  plainExpect(svg).toContain('data-symbol="shelter"');
  plainExpect(svg).toContain('data-structure="bridge"');
});

plain("a building's roof read from the survey: a gable along it and one across, a hip, a flat roof, with its pitch and eaves; a tree over a corner left out", () => {
  // (a 120 x 80 ft site on 1 ft cells, its roof heights on 2 ft ones; the ground at 0)
  const W = 120, H = 80, snx = W / 2, sny = H / 2;
  const survey = (z: (p: { x: number; y: number }) => number) => {
    const surface = new Float32Array(snx * sny);
    for (let j = 0; j < sny; j++) for (let i = 0; i < snx; i++) surface[j * snx + i] = z({ x: (i + 0.5) * 2, y: (j + 0.5) * 2 });
    return { nx: W, ny: H, cell: 1, ground: new Float32Array(W * H), surface, snx, sny };
  };
  // A house 60 ft long (east-west), 30 ft deep
  const house = [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 50 }, { x: 20, y: 50 }];
  const inside = (p: { x: number; y: number }) => p.x > 20 && p.x < 80 && p.y > 20 && p.y < 50;
  const along = roofShape(survey(p => (inside(p) ? 10 + 0.5 * Math.min(p.y - 20, 50 - p.y) : 0)), house);
  plainExpect(along).toMatchObject({ kind: "gable", across: false, pitch: 0.5 });
  plainExpect(along!.eaves).toBeCloseTo(10, 0);
  const across = roofShape(survey(p => (inside(p) ? 11 + 0.75 * Math.min(p.x - 20, 80 - p.x) : 0)), house);
  plainExpect(across).toMatchObject({ kind: "gable", across: true, pitch: 0.75 });
  const hip = roofShape(survey(p => (inside(p) ? 9 + (5 / 12) * Math.min(p.y - 20, 50 - p.y, p.x - 20, 80 - p.x) : 0)), house);
  plainExpect(hip).toMatchObject({ kind: "hip", pitch: 5 / 12 });
  const flat = roofShape(survey(p => (inside(p) ? 14 : 0)), house);
  plainExpect(flat).toMatchObject({ kind: "flat", pitch: undefined });
  plainExpect(flat!.eaves).toBeCloseTo(14, 0);
  // A tree's crown over one corner of the gable: still the gable, as steep
  const tree = roofShape(survey(p => (!inside(p) ? 0 : Math.hypot(p.x - 25, p.y - 25) < 6 ? 35 : 10 + 0.5 * Math.min(p.y - 20, 50 - p.y))), house);
  plainExpect(tree).toMatchObject({ kind: "gable", across: false, pitch: 0.5 });
  // Too little roof to tell: none
  plainExpect(roofShape(survey(() => 10), [{ x: 20, y: 20 }, { x: 26, y: 20 }, { x: 26, y: 26 }, { x: 20, y: 26 }])).toBeNull();
});

test("a building's walls, doors and windows: a wall clicked in 3D, a window put on it, slid along, deleted; Esc goes back", async ({ page }) => {
  test.setTimeout(180_000);
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await page.getByTestId("draw-shape-box").click();
  await drag(page, await screenOf(page, 400, 400), await screenOf(page, 436, 424), 3);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  // (looking at its north wall, the first, from the north)
  await page.evaluate(() => { const v = (window as any).__dgView, g = v.groundHeight(418, 412); v.controls.setLookAt(410, g + 24, 350, 414, g + 5, 412, false); v.controls.update(0); });
  await page.evaluate(i => (window as any).__dgActions.select(i), id);
  await page.waitForTimeout(1500);
  const screen = (x: number, h: number, z: number) => page.evaluate(([x, h, z]) => {
    const v = (window as any).__dgView, c = v.camera, r = v.container.getBoundingClientRect();
    const P = new c.position.constructor(x, h + v.groundHeight(x, z), z).project(c);
    return { x: r.left + ((P.x + 1) / 2) * r.width, y: r.top + ((1 - P.y) / 2) * r.height };
  }, [x, h, z]);
  // Pointing at the wall outlines it and names it; a click picks it, its part at the top of the panel
  const w = await screen(411, 4, 399.8);
  await page.mouse.move(w.x, w.y);
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.container.title)).toBe("Front wall");
  await page.mouse.click(w.x, w.y);
  await expect.poll(async () => (await editorState(page)).buildingPart).toEqual({ wall: 0 });
  await expect(page.getByTestId("building-part-name")).toHaveText("Front wall");
  // + Window: one more on the wall, picked, with its handles
  const before = (await structures(page))[0].openings?.length ?? 0;
  await page.getByTestId("add-window").click();
  await expect.poll(async () => (await structures(page))[0].openings?.length ?? 0).toBeGreaterThan(before);
  const added = (await structures(page))[0].openings.at(-1);
  expect((await editorState(page)).buildingPart).toEqual({ wall: 0, opening: added.id });
  await expect(page.locator('[data-handle="openw"]')).toBeVisible();
  await expect(page.locator('[data-handle="openh"]')).toBeVisible();
  // Picked, the building is solid (its outside is what's being worked on)
  expect(await page.evaluate(() => (window as any).__dgView.seeThrough)).toBeNull();
  // Slid along the wall by dragging it anywhere on it (here, its lower part)
  const side = await handleCenter(page, "openw"), top = await handleCenter(page, "openh");
  const on = { x: top.x - (side.x - top.x) * 0.4, y: side.y + (side.y - top.y) * 0.5 };
  await drag(page, on, { x: on.x + 60, y: on.y }, 10);
  await expect.poll(async () => Math.abs((await structures(page))[0].openings.find((o: any) => o.id === added.id).at - added.at)).toBeGreaterThan(1);
  // Delete takes only it; Esc goes back to the building, then puts it down
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await structures(page))[0].openings.some((o: any) => o.id === added.id)).toBe(false);
  expect((await structures(page)).length).toBe(1);
  expect((await editorState(page)).buildingPart).toEqual({ wall: 0 });
  await page.keyboard.press("Escape");
  expect((await editorState(page)).buildingPart).toBeNull();
  expect((await editorState(page)).selectedId).toBe(id);
  // Right-click the wall: Add a porch here; it's picked; Delete takes only it
  await page.mouse.click(w.x, w.y, { button: "right" });
  await page.getByTestId("menu-add-porch").click();
  await expect.poll(async () => (await structures(page))[0].addOns?.length ?? 0).toBe(1);
  const porch = (await structures(page))[0].addOns[0];
  expect(porch.kind).toBe("porch");
  expect((await editorState(page)).buildingPart).toEqual({ wall: 0, addOn: porch.id });
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await structures(page))[0].addOns?.length ?? 0).toBe(0);
  expect((await structures(page)).length).toBe(1);
});

test("a carport put on from the roof's menu, let go, picked again with one click, sized by its handle; the roof hides a porch behind it; the same in 2D", async ({ page }) => {
  test.setTimeout(180_000);
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await page.getByTestId("draw-shape-box").click();
  await drag(page, await screenOf(page, 400, 400), await screenOf(page, 436, 424), 3);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  // (from the south, high: the south wall and the roof in sight; a porch on the north wall, behind)
  await page.evaluate(() => { const v = (window as any).__dgView, g = v.groundHeight(418, 412); v.controls.setLookAt(428, g + 80, 512, 418, g, 412, false); v.controls.update(0); });
  await page.evaluate(i => { const a = (window as any).__dgActions; a.select(null); (window as any).__dgStore.getState().change((d: any) => ({ items: d.items.map((x: any) => (x.id === i ? { ...x, addOns: [{ id: "back", kind: "porch", wall: 0, at: 18, width: 16, depth: 8 }] } : x)) }), false); }, id);
  await page.waitForTimeout(1500);
  // (a spot inside the roof, over the south half; or inside a porch's or carport's box, 5 ft up over
  // its middle: its wall the outline's side from corner `wall` to the next)
  const at = (what: string) => page.evaluate(([i, what]) => {
    const v = (window as any).__dgView, st = (window as any).__dgCourse().items.find((x: any) => x.id === i);
    let pt: number[];
    if (what === "roof") pt = [418, v.groundHeight(418, 418) + 13, 418];
    else {
      const a = st.addOns.find((x: any) => x.id === what), P = st.points, n = P.length, A = P[a.wall], B = P[(a.wall + 1) % n];
      const len = Math.hypot(B.x - A.x, B.y - A.y), dir = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
      const c = { x: P.reduce((s: number, q: any) => s + q.x, 0) / n, y: P.reduce((s: number, q: any) => s + q.y, 0) / n };
      let out = { x: dir.y, y: -dir.x };
      if ((A.x - c.x) * out.x + (A.y - c.y) * out.y < 0) out = { x: -out.x, y: -out.y };
      const q = { x: A.x + dir.x * a.at + out.x * (a.depth / 2), y: A.y + dir.y * a.at + out.y * (a.depth / 2) };
      pt = [q.x, v.groundHeight(q.x, q.y) + 5, q.y];
    }
    const c = v.camera, r = v.container.getBoundingClientRect(), P = new c.position.constructor(...pt).project(c);
    return { x: r.left + ((P.x + 1) / 2) * r.width, y: r.top + ((1 - P.y) / 2) * r.height };
  }, [id, what] as const);
  // The roof's menu, over the porch behind: the Add rows, not the porch's
  let p = await at("roof");
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.getByTestId("menu-add-carport")).toBeVisible();
  await expect(page.getByTestId("menu-remove-addon")).toHaveCount(0);
  await page.getByTestId("menu-add-carport").click();
  await expect.poll(async () => (await structures(page))[0].addOns.length).toBe(2);
  const carport = (await structures(page))[0].addOns.find((a: any) => a.kind === "carport");
  expect(carport.wall).not.toBe(0);
  // Let go of it all, then one click on its roof picks the building and it
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect((await editorState(page)).selectedId).toBeNull();
  p = await at(carport.id);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await editorState(page)).buildingPart).toEqual({ wall: carport.wall, addOn: carport.id });
  expect((await editorState(page)).selectedId).toBe(id);
  await expect(page.getByTestId("building-part-name")).toContainText("Carport");
  await expect(page.getByTestId("addon-fields")).toBeVisible();
  // Its depth handle draws it out
  const h = await handleCenter(page, "addd");
  await drag(page, h, { x: h.x, y: h.y + 40 }, 10);
  await expect.poll(async () => (await structures(page))[0].addOns.find((a: any) => a.id === carport.id).depth).not.toBe(carport.depth);
  // Its menu: Remove this carport (only it)
  p = await at(carport.id);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByTestId("menu-remove-addon").click();
  await expect.poll(async () => (await structures(page))[0].addOns.map((a: any) => a.id)).toEqual(["back"]);
  // In 2D: the roof's menu has the Add rows; a click on the porch picks it
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("2");
  await page.evaluate(() => (window as any).__dgView.fitBounds({ minX: 370, minY: 370, maxX: 466, maxY: 454 }, { animate: false }));
  await page.waitForTimeout(1200);
  p = await screenOf(page, 418, 414);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.getByTestId("menu-add-deck")).toBeVisible();
  await page.keyboard.press("Escape");
  p = await screenOf(page, 418, 395);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await editorState(page)).buildingPart).toEqual({ wall: 0, addOn: "back" });
});

test("a porch as the Security Camera Planner's: steps put on and taken off from its menu, one side's railing off, copied onto another wall; set into the house from the panel and by dragging its front in, the wall behind it still picked", async ({ page }) => {
  test.setTimeout(180_000);
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await page.getByTestId("draw-shape-box").click();
  await drag(page, await screenOf(page, 400, 400), await screenOf(page, 436, 424), 3);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  // (a porch on the south wall, seen from the south)
  const south = await page.evaluate(i => { const st = (window as any).__dgCourse().items.find((x: any) => x.id === i); return st.points.findIndex((p: any, k: number) => Math.abs(p.y - 424) < 0.5 && Math.abs(st.points[(k + 1) % st.points.length].y - 424) < 0.5); }, id);
  expect(south).toBeGreaterThanOrEqual(0);
  await page.evaluate(([i, w]) => (window as any).__dgStore.getState().change((d: any) => ({ items: d.items.map((x: any) => (x.id === i ? { ...x, addOns: [{ id: "fp", kind: "porch", wall: w, at: 18, width: 18, depth: 8, floor: 2.5 }] } : x)) }), false), [id, south] as const);
  await page.evaluate(() => { const v = (window as any).__dgView, g = v.groundHeight(418, 412); v.controls.setLookAt(424, g + 70, 520, 418, g, 420, false); v.controls.update(0); (window as any).__dgActions.select(null); });
  await page.waitForTimeout(1200);
  // (a spot on its floor: sx along from its middle, d out, `up` ft over it)
  const fpt = (sx: number, d: number, up = 0.3) => page.evaluate(([i, sx, d, up]) => {
    const v = (window as any).__dgView, st = (window as any).__dgCourse().items.find((x: any) => x.id === i), a = st.addOns.find((x: any) => x.id === "fp");
    const B = (window as any).__dgParts, F = B.buildingFrame(st, v.standGround), L = B.addOnLevels(F, a, v.standGround);
    const c = v.camera, r = v.container.getBoundingClientRect(), P = new c.position.constructor(L.mid.x + L.w.dir.x * sx + L.w.out.x * d, L.top + up, L.mid.y + L.w.dir.y * sx + L.w.out.y * d).project(c);
    return { x: r.left + ((P.x + 1) / 2) * r.width, y: r.top + ((1 - P.y) / 2) * r.height };
  }, [id, sx, d, up] as const);
  const porch = async () => (await structures(page))[0].addOns.find((a: any) => a.id === "fp");
  const menu = async (p: { x: number; y: number }) => { await page.mouse.click(p.x, p.y, { button: "right" }); };
  // Put steps here, on its front off the middle; Remove these steps on the middle ones
  await menu(await fpt(5.5, 7.4));
  await page.getByTestId("menu-put-steps").click();
  await expect.poll(async () => (await porch()).steps?.length).toBe(2);
  await menu(await fpt(0, 7.6));
  await page.getByTestId("menu-remove-steps").click();
  await expect.poll(async () => (await porch()).steps?.length).toBe(1);
  expect((await porch()).steps[0].at).toBeGreaterThan(0.7);
  // No railing on this side (an end)
  await menu(await fpt(8.6, 4));
  await page.getByTestId("menu-rail-side").click();
  await expect.poll(async () => (await porch()).noRail?.length).toBe(1);
  // Copy this porch; Paste the porch here, from the roof's menu
  await menu(await fpt(-3, 4));
  await page.getByTestId("menu-copy-addon").click();
  const roofSpot = await page.evaluate(() => { const v = (window as any).__dgView, c = v.camera, r = v.container.getBoundingClientRect(), P = new c.position.constructor(418, v.groundHeight(418, 418) + 13, 418).project(c); return { x: r.left + ((P.x + 1) / 2) * r.width, y: r.top + ((1 - P.y) / 2) * r.height }; });
  await menu(roofSpot);
  await page.getByTestId("menu-paste-addon").click();
  await expect.poll(async () => (await structures(page))[0].addOns.length).toBe(2);
  const pasted = (await structures(page))[0].addOns.find((a: any) => a.id !== "fp");
  expect([pasted.kind, pasted.width, pasted.depth, pasted.noRail?.length]).toEqual(["porch", 18, 8, 1]);
  await page.evaluate(i => (window as any).__dgStore.getState().change((d: any) => ({ items: d.items.map((x: any) => (x.id === i ? { ...x, addOns: x.addOns.filter((a: any) => a.id === "fp") } : x)) }), false), id);
  // Placement: Set into the house (the panel)
  await page.evaluate(([i, w]) => { (window as any).__dgActions.select(i); (window as any).__dgEditor().set({ buildingPart: { wall: w, addOn: "fp" } }); }, [id, south] as const);
  await page.getByRole("radio", { name: "Set into the house" }).click();
  await expect.poll(async () => (await porch()).roof).toBe("house");
  // The wall behind it: a click picks the wall, not the porch; its floor picks the porch
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).__dgView.controls.setLookAt(424, (window as any).__dgView.groundHeight(418, 412) + 18, 470, 418, (window as any).__dgView.groundHeight(418, 412) + 4, 420, false));
  await page.waitForTimeout(800);
  const depth = (await porch()).depth;
  let p = await fpt(-6, -depth + 0.05, 4);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await editorState(page)).buildingPart).toEqual({ wall: south });
  p = await fpt(4, -2, 0.05);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await editorState(page)).buildingPart).toEqual({ wall: south, addOn: "fp" });
  // Its front handle (its back, set in) dragged out past the wall: out from it again
  const h = await handleCenter(page, "addd");
  await drag(page, h, { x: h.x, y: h.y + 200 }, 14);
  await expect.poll(async () => (await porch()).roof).toBeUndefined();
});

test("a porch set into the house opens at its sides round the house's corners, as the planner's: the panel's Open sides, the menu's Close this side and Open this side", async ({ page }) => {
  test.setTimeout(120_000);
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await page.getByTestId("draw-shape-box").click();
  await drag(page, await screenOf(page, 400, 400), await screenOf(page, 436, 424), 3);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  // (a porch set 8 ft into the 24 ft east wall, 2 ft short of each corner; seen from the east)
  const east = await page.evaluate(i => { const st = (window as any).__dgCourse().items.find((x: any) => x.id === i); return st.points.findIndex((p: any, k: number) => Math.abs(p.x - 436) < 0.5 && Math.abs(st.points[(k + 1) % st.points.length].x - 436) < 0.5); }, id);
  expect(east).toBeGreaterThanOrEqual(0);
  await page.evaluate(([i, w]) => (window as any).__dgStore.getState().change((d: any) => ({ items: d.items.map((x: any) => (x.id === i ? { ...x, addOns: [{ id: "op", kind: "porch", wall: w, at: 12, width: 20, depth: 8, roof: "house" }] } : x)) }), false), [id, east] as const);
  const ends = () => page.evaluate(i => {
    const v = (window as any).__dgView, st = (window as any).__dgCourse().items.find((x: any) => x.id === i), a = st.addOns[0];
    const r = (window as any).__dgParts.buildingFrame(st, v.standGround).recesses[0];
    return [Math.round((a.at - a.width / 2) * 10) / 10, Math.round((a.at + a.width / 2) * 10) / 10, !!r?.open0, !!r?.open1];
  }, id);
  expect(await ends()).toEqual([2, 22, false, false]);
  // Open sides: Both runs it to both corners, open there
  await page.evaluate(([i, w]) => { (window as any).__dgActions.select(i); (window as any).__dgEditor().set({ buildingPart: { wall: w, addOn: "op" } }); }, [id, east] as const);
  await page.getByRole("radiogroup", { name: "Open sides" }).getByRole("radio", { name: "Both" }).click();
  await expect.poll(ends).toEqual([0, 24, true, true]);
  // Close this side, from its menu on its floor near one end
  await page.evaluate(() => { const v = (window as any).__dgView, g = v.groundHeight(436, 412); v.controls.setLookAt(490, g + 30, 418, 432, g + 2, 412, false); v.controls.update(0); });
  await page.waitForTimeout(1000);
  const spot = await page.evaluate(i => {
    const v = (window as any).__dgView, st = (window as any).__dgCourse().items.find((x: any) => x.id === i), a = st.addOns[0];
    const B = (window as any).__dgParts, F = B.buildingFrame(st, v.standGround), L = B.addOnLevels(F, a, v.standGround), sx = -(L.half - 3);
    const c = v.camera, r = v.container.getBoundingClientRect(), P = new c.position.constructor(L.mid.x + L.w.dir.x * sx - L.w.out.x * 4, L.top + 0.05, L.mid.y + L.w.dir.y * sx - L.w.out.y * 4).project(c);
    return { x: r.left + ((P.x + 1) / 2) * r.width, y: r.top + ((1 - P.y) / 2) * r.height };
  }, id);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await page.getByTestId("menu-close-side").click();
  await expect.poll(ends).toEqual([2, 24, false, true]);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await page.getByTestId("menu-open-side").click();
  await expect.poll(ends).toEqual([0, 24, true, true]);
  // None closes both
  await page.evaluate(([i, w]) => { (window as any).__dgActions.select(i); (window as any).__dgEditor().set({ buildingPart: { wall: w, addOn: "op" } }); }, [id, east] as const);
  await page.getByRole("radiogroup", { name: "Open sides" }).getByRole("radio", { name: "None" }).click();
  await expect.poll(ends).toEqual([2, 22, false, false]);
});

test("a window looks its own way: its Style and Frame color over the building's, and As the house puts it back", async ({ page }) => {
  test.setTimeout(90_000);
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.keyboard.press("s");
  await page.getByTestId("structure-kind-building").click();
  await page.getByTestId("draw-shape-box").click();
  await drag(page, await screenOf(page, 400, 400), await screenOf(page, 436, 424), 3);
  await expect.poll(async () => (await structures(page)).length).toBe(1);
  const id = (await structures(page))[0].id;
  await page.evaluate(i => (window as any).__dgStore.getState().change((d: any) => ({ items: d.items.map((x: any) => (x.id === i ? { ...x, openings: [{ id: "w1", kind: "window", wall: 0, at: 10, width: 3, height: 4.75, sill: 2.75 }, { id: "w2", kind: "window", wall: 0, at: 20, width: 3, height: 4.75, sill: 2.75 }] } : x)) }), false), id);
  await page.evaluate(i => { (window as any).__dgActions.select(i); (window as any).__dgEditor().set({ buildingPart: { wall: 0, opening: "w1" } }); }, id);
  const win = (k: string) => page.evaluate(([i, k]) => (window as any).__dgCourse().items.find((x: any) => x.id === i).openings.find((o: any) => o.id === k), [id, k] as const);
  await page.getByRole("radiogroup", { name: "Style", exact: true }).getByRole("radio", { name: "Shutters" }).click();
  await expect.poll(async () => (await win("w1")).style).toBe("shutters");
  expect((await win("w2")).style).toBeUndefined();
  await page.getByRole("button", { name: "Frame color", exact: true }).click();
  await page.getByTestId("color-palette").nth(3).click();
  await expect.poll(async () => typeof (await win("w1")).color).toBe("string");
  await expect(page.getByTestId("color-natural")).toHaveText("As the house");
  await page.getByTestId("color-natural").click();
  await expect.poll(async () => (await win("w1")).color).toBeUndefined();
  await page.getByRole("radiogroup", { name: "Style", exact: true }).getByRole("radio", { name: "As the house" }).click();
  await expect.poll(async () => (await win("w1")).style).toBeUndefined();
});
