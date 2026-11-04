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
/** The meshes of a structure's 3D model, by material ("deck", "timber", "stone", "shingle"...). */
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
  building: ["door", "glass", "shingle", "siding", "stone", "trim"], shelter: ["concrete", "metal", "timber"], deck: ["deck", "timber"]
};

test("a boardwalk, stairs and a wall drawn from the Features list, click by click", async ({ page }) => {
  await blankCourse(page);
  await page.getByRole("button", { name: "2 Design" }).click();
  let x = 250;
  for (const kind of ["boardwalk", "stairs", "wall"] as const) {
    await page.keyboard.press("s");
    await page.getByTestId(`structure-kind-${kind}`).click();
    await expect.poll(async () => (await editorState(page)).tool).toBe("draw-structure");
    await clickPlan(page, x, 400);
    await clickPlan(page, x + 40, 470, { double: true });
    await expect.poll(async () => (await structures(page)).map((s: any) => s.kind)).toContain(kind);
    x += 250;
  }
  const all = await structures(page);
  expect(all.map((s: any) => s.kind)).toEqual(["boardwalk", "stairs", "wall"]);
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

test("buildings like the Security Camera Planner's: looks, roofs, colors, turning, height; a shelter as a gazebo", async ({ page }) => {
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
  // Not every building is a house: a barn (red walls), restrooms (a flat roof)
  await page.getByTestId("building-look-barn").click();
  await expect.poll(async () => (await structures(page))[0].wallColor).toBe("#8e2f25");
  await page.getByTestId("building-look-restrooms").click();
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
