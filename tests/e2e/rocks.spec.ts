// Rocks: put down with the Rocks tool (J), edited in the panel (kind, stone, size, a drawn
// outline), standing in 3D, and drawn on the painted map from the same shapes; rock surfaces drawn
// as areas.
import { test, expect, blankCourse, clickPlan, course, drag, editorState, handleCenter, screenOf } from "./fixtures";
import { rockItemGeometry, rockFootprint, rockSpan } from "../../src/three/rocks";
import type { RockItem } from "../../src/types";

const rocks = async (page: import("@playwright/test").Page) => (await course(page)).items.filter((i: any) => i.type === "rock") as RockItem[];
const rockIn3d = (page: import("@playwright/test").Page, id: string) =>
  page.evaluate(id => { let n = 0; (window as any).__dgView.scene.traverse((o: any) => { if (o.userData.rock && o.userData.itemId === id) n++; }); return n; }, id);

test("a boulder put down with the Rocks tool; its panel sets kind, stone and size; an outline drawn and reshaped", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("j");
  expect((await editorState(page)).tool).toBe("add-rock");
  await page.getByTestId("rock-kind-boulder").click();
  await expect(page.getByTestId("tool-hint")).toContainText("where the boulder goes");
  await clickPlan(page, 400, 400);
  await expect.poll(async () => (await rocks(page)).length).toBe(1);
  const r = (await rocks(page))[0];
  expect([r.kind, r.length, r.width, r.height]).toEqual(["boulder", 6, 4.5, 3.5]);
  // (rocks go down one after another, as trees and benches do; the one put down is picked, its
  // panel there once the tool is put away)
  expect((await editorState(page)).selectedId).toBe(r.id);
  await page.keyboard.press("v");
  await expect(page.getByTestId("inspector-title")).toHaveText("Boulder");
  // In 3D: a rock (its three versions, finer close up)
  await expect.poll(() => rockIn3d(page, r.id)).toBe(1);
  // The panel: stone, size, buried
  await page.getByTestId("rock-stone").getByRole("radio", { name: "Sandstone" }).click();
  await expect.poll(async () => (await rocks(page))[0].stone).toBe("sandstone");
  await page.getByRole("slider", { name: "Length" }).fill("9");
  await expect.poll(async () => (await rocks(page))[0].length).toBe(9);
  await page.getByRole("slider", { name: "Buried" }).fill("30");
  await expect.poll(async () => (await rocks(page))[0].buried).toBe(0.3);
  // A drawn outline: its points round it, dragged to a new shape
  await page.getByRole("radiogroup", { name: "Outline" }).getByRole("radio", { name: "Drawn" }).click();
  await expect.poll(async () => (await rocks(page))[0].outline?.length).toBe(8);
  await expect(page.getByTestId("rock-outline-note")).toBeVisible();
  const before = (await rocks(page))[0];
  const h = await handleCenter(page, "corner", 0);
  await drag(page, h, { x: h.x + 60, y: h.y });
  await expect.poll(async () => (await rocks(page))[0].length).toBeGreaterThan(before.length + 2);
  // Back to an oval
  await page.getByRole("radiogroup", { name: "Outline" }).getByRole("radio", { name: "Oval" }).click();
  await expect.poll(async () => (await rocks(page))[0].outline).toBeUndefined();
  // Another kind: its usual size
  await page.getByTestId("rock-kind").getByRole("radio", { name: "Rock wall" }).click();
  await expect.poll(async () => { const w = (await rocks(page))[0]; return [w.kind, w.length, w.width]; }).toEqual(["wall", 22, 2]);
  await expect(page.getByTestId("inspector-title")).toHaveText("Rock wall");
  // Undo takes it back step by step
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await rocks(page))[0].kind).toBe("boulder");
});

test("a rock surface drawn with the Rocks tool, its look and stone set in its panel", async ({ page }) => {
  await blankCourse(page);
  await page.keyboard.press("j");
  await page.getByTestId("area-kind-rock").click();
  for (const [x, y] of [[300, 300], [360, 290], [380, 350], [320, 370]]) await clickPlan(page, x, y);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area" && i.kind === "rock").length).toBe(1);
  await expect(page.getByTestId("inspector-title")).toHaveText("Rock surface");
  await page.getByTestId("rock-look").getByRole("radio", { name: "Broken rock" }).click();
  await page.getByTestId("rock-surface-stone").getByRole("radio", { name: "Basalt" }).click();
  await expect.poll(async () => { const a = (await course(page)).items.find((i: any) => i.kind === "rock"); return [a.rockLook, a.stone]; }).toEqual(["broken", "basalt"]);
});

test("a rock's shape: its size as set, sunk as deep as it's buried, a drawn outline met on the ground", () => {
  const base: RockItem = { id: "r", type: "rock", kind: "boulder", stone: "granite", x: 0, y: 0, rotation: 0, length: 8, width: 5, height: 4, seed: 3 };
  const g = rockItemGeometry(base, 0.3);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  // (as long and wide as set, give or take its lumps; the part above ground about as tall as it isn't buried)
  expect(b.max.x - b.min.x).toBeGreaterThan(6.5);
  expect(b.max.x - b.min.x).toBeLessThan(9.5);
  expect(b.max.z - b.min.z).toBeLessThan(6.5);
  expect(b.max.y).toBeGreaterThan(2.4);
  expect(b.max.y).toBeLessThan(4);
  // A drawn outline with a notch: the rock meets the ground on it
  const outline = [{ x: 5, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 1 }, { x: -3, y: 3 }, { x: -5, y: 0 }, { x: -3, y: -3 }, { x: 3, y: -3 }];
  const o = rockItemGeometry({ ...base, outline, ...rockSpan(outline) }, 0.3);
  const foot = rockFootprint(o, 36);
  const reach = (a: number) => { const k = Math.round(((a / (Math.PI * 2)) * 36 + 36) % 36); return Math.hypot(...foot[k]); };
  // (east it reaches about 5 ft; in the notch, north (+z), much less)
  expect(reach(0)).toBeGreaterThan(4);
  expect(reach(Math.PI / 2)).toBeLessThan(2);
});
