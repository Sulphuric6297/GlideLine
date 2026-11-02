// The real-course checks: the demo course (18 holes, measured trees, buildings, woods, the photo)
// on a real server, used the way a person uses it. Each check is a problem that has really come up,
// so it would have caught it, and most have a speed limit. One page and one course for the run.
//
// Speed limits are for this test machine, which has no graphics card: the 3D drawing is left out
// of them (see kit.ts: draw), so they measure the app's own work, which is what has stalled.
import { test, expect, chromium, type Page } from "@playwright/test";
import { at, course, draw, editor, frame, frames, openDemo, profiled, saved, stalls, watch } from "./kit";
import { createEmptyCourse, normalizeCourse } from "../../src/lib/course";

test.describe.configure({ mode: "serial" });

// A corner of the site kept for the picking checks: a house with a tree just behind it, a path just
// in front of another tree, and tall grass round a third (the measured trees there taken out)
const BOX = { minX: 1460, minY: 100, maxX: 1840, maxY: 520 };
const HOUSE = [{ x: 1600, y: 200 }, { x: 1680, y: 200 }, { x: 1680, y: 250 }, { x: 1600, y: 250 }];
const BEHIND = { x: 1640, y: 188 };
const PATH = [{ x: 1520, y: 331 }, { x: 1600, y: 331 }];
const BY_PATH = { x: 1560, y: 320 };
const GRASS = [{ x: 1700, y: 270 }, { x: 1790, y: 270 }, { x: 1790, y: 350 }, { x: 1700, y: 350 }];
const IN_GRASS = { x: 1745, y: 300 };
const inBox = (p: { x: number; y: number }) => p.x >= BOX.minX && p.x <= BOX.maxX && p.y >= BOX.minY && p.y <= BOX.maxY;

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openDemo(page, doc => {
    // (the corner cleared of what was there, then the check's own things put in)
    doc.items = doc.items.filter((i: any) => !(i.points ?? [i]).some(inBox) || i.type === "tee" || i.type === "basket" || i.kind === "water");
    doc.lidar.removed = [...new Set([...(doc.lidar.removed ?? []), ...doc.lidar.trees.map((t: number[], k: number) => (inBox({ x: t[0], y: t[1] }) ? k : -1)).filter((k: number) => k >= 0)])];
    doc.items.push(
      { id: "t-house", type: "structure", kind: "building", points: HOUSE, x: 1640, y: 225, height: 12 },
      { id: "t-behind", type: "tree", x: BEHIND.x, y: BEHIND.y, radius: 14, height: 40, treeType: "deciduous" },
      { id: "t-path", type: "line", kind: "path", points: PATH, x: 1560, y: 331 },
      { id: "t-bypath", type: "tree", x: BY_PATH.x, y: BY_PATH.y, radius: 14, height: 40, treeType: "deciduous" },
      { id: "t-grass", type: "area", kind: "rough", points: GRASS, x: 1745, y: 310 },
      { id: "t-ingrass", type: "tree", x: IN_GRASS.x, y: IN_GRASS.y, radius: 14, height: 40, treeType: "deciduous" }
    );
    // (woods an older import made from the measured trees, round the first of them, which was tied to it)
    const [tx, ty] = doc.lidar.trees[0];
    doc.items.push({ id: "t-stand", type: "area", kind: "woods", importSource: "lidar", x: tx, y: ty, points: [{ x: tx - 30, y: ty - 30 }, { x: tx + 30, y: ty - 30 }, { x: tx + 30, y: ty + 30 }, { x: tx - 30, y: ty + 30 }] });
    doc.lidar.bound = [0];
    // (and a wood with the older settings: trees in patches, a section of heavy underbrush)
    const sq = (x: number, y: number, r: number) => [{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }];
    doc.items.push({ id: "t-oldwood", type: "area", kind: "woods", x: tx + 200, y: ty, points: sq(tx + 200, ty, 60), trees: "custom", patches: [{ points: sq(tx + 200, ty, 20), fill: 0.5 }], brush: [{ points: sq(tx + 220, ty, 25), level: "heavy" }], brushEdge: 0.3 });
    doc.lidar.removed = (doc.lidar.removed ?? []).filter((k: number) => k !== 0);
  });
});
test.afterAll(async () => { await page?.close(); });

const pickAt = async (p: { x: number; y: number }) => {
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await editor(page)).selectedId, { timeout: 10_000 }).not.toBeNull();
  const id = (await editor(page)).selectedId;
  // (what it is, when it's not one of the check's own: said, to see what got in the way)
  if (!String(id).startsWith("t-")) console.log("picked", id, await page.evaluate(id => { const c = (window as any).__dgCourse(); const i = c.items.find((x: any) => x.id === id); return i ? `${i.type} ${i.kind ?? ""} ${JSON.stringify(i.points?.slice(0, 3) ?? [i.x, i.y])}` : c.holes.some((h: any) => h.id === id) ? "a hole" : "not an item"; }, id));
  return id;
};

test("measured trees stand on their own: the woods an older import made from them are gone, the trees kept", async () => {
  // (as saved: opened again from the server)
  const id = (await saved(page)).id;
  await page.evaluate(id => (window as any).__dgServer.open(id), id);
  await page.waitForFunction(() => (window as any).__dgCourse?.()?.holes?.length > 0 && !(window as any).__dgCourse().items.some((i: any) => i.id === "t-stand"), null, { timeout: 60_000 }).catch(() => {});
  const back = page.getByTestId("back-to-course");
  if (await back.isVisible().catch(() => false)) await back.click();
  const doc = await course(page);
  expect(doc.items.some((i: any) => i.id === "t-stand")).toBe(false);
  expect(doc.items.some((i: any) => i.type === "area" && i.importSource === "lidar")).toBe(false);
  expect(doc.lidar.bound).toBeUndefined();
  expect(doc.lidar.removed ?? []).not.toContain(0);
  // (the older wood: the measured trees kept and the gaps filled; its section, woods of bushes)
  const old = doc.items.find((i: any) => i.id === "t-oldwood");
  expect([old.trees, old.patches, old.brush, old.brushEdge]).toEqual([undefined, undefined, undefined, undefined]);
  expect(doc.items.filter((i: any) => i.kind === "woods" && i.bushes === 1 && i.density === 2 && Math.abs(i.x - (old.x + 20)) < 1 && Math.abs(i.y - old.y) < 1)).toHaveLength(1);
});

test("autosave: edits made quickly, and two saves asked for at once, all reach the server with no clash", async () => {
  const before = (await saved(page)).version;
  await page.evaluate(() => (window as any).__dgActions.updateItem("t-house", { label: "Clubhouse" }));
  await page.evaluate(() => (window as any).__dgActions.updateItem("t-path", { label: "Lane" }));
  // (as the app does when the course is left while a save is waiting)
  await page.evaluate(() => Promise.all([(window as any).__dgServer.saveNow(), (window as any).__dgServer.saveNow()]));
  await page.evaluate(() => (window as any).__dgActions.updateItem("t-grass", { label: "Meadow" }));
  await expect.poll(async () => (await saved(page)).status, { timeout: 15_000 }).toBe("saved");
  const s = await saved(page);
  expect(s.conflict).toBe("");
  expect(s.version).toBeGreaterThan(before);
  const onServer = await (await page.request.get(`/api/courses/${s.id}`)).json();
  const doc = onServer.doc ?? onServer.course?.doc ?? onServer;
  const label = (id: string) => doc.items.find((i: any) => i.id === id)?.label;
  expect([label("t-house"), label("t-path"), label("t-grass")]).toEqual(["Clubhouse", "Lane", "Meadow"]);
});

test("picking in 3D: a roof in front of a tree picks the house; the path in front of a tree, the path; the tall grass round a tree, the grass", async () => {
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "select" }));
  await page.keyboard.press("3");
  await frame(page, BOX);
  await page.waitForTimeout(1500);
  await draw(page, false);
  expect(await pickAt(await at(page, 1640, 238, 14))).toBe("t-house");
  expect(await pickAt(await at(page, 1532, 331, 0))).toBe("t-path");
  // (a spot in the grass inside the tree's reach but with no leaves drawn under it)
  const c = await at(page, IN_GRASS.x, IN_GRASS.y, 25);
  const spot = await page.evaluate(([x, y]) => {
    const v = (window as any).__dgView;
    for (let r = 2; r <= 160; r += 1.5) for (let a = 0; a < 6.28; a += 0.1) {
      const p = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }, hit = v.treeUnder(v.ray(p.x, p.y)), g = v.groundAt(p.x, p.y);
      if (hit && !hit.drawn && g && g.x > 1705 && g.x < 1785 && g.z > 275 && g.z < 345) return p;
    }
    return null;
  }, [c.x, c.y] as const);
  if (spot) expect(await pickAt(spot)).toBe("t-grass");
  expect(await pickAt(await at(page, BEHIND.x, BEHIND.y, 36))).toBe("t-behind");
});

test("only what's drawn is picked: no tree with the trees hidden, no underbrush past where it's drawn; an area's edge picks the area, the pointer over it outlines and names it, and a picked area moves only from its edge", async () => {
  await draw(page, false);
  const sweep = () => page.evaluate(() => {
    const v = (window as any).__dgView, doc = (window as any).__dgCourse(), r = v.container.getBoundingClientRect(), cam = v.mainEye().cam.position;
    const out = { trees: 0, farBrush: 0, edges: 0, inside: 0, edge: null as null | { x: number; y: number; id: string } };
    for (let y = r.top + 40; y < r.bottom - 40; y += 22) for (let x = r.left + 40; x < r.right - 40; x += 22) {
      const t = v.clickTarget(x, y);
      if (t.tree) { out.trees++; if (t.tree.kind === "spot" && t.tree.height < 9 && Math.hypot(t.tree.x - cam.x, t.tree.y - cam.z) > 420) out.farBrush++; }
      else if (t.id && doc.items.find((i: any) => i.id === t.id)?.type === "area") {
        if (v.pickedEdge) { out.edges++; out.edge ??= { x, y, id: t.id }; } else out.inside++;
      }
    }
    return out;
  });
  const shown = await sweep();
  console.log("picks over the view:", JSON.stringify({ ...shown, edge: !!shown.edge }));
  expect(shown.trees, "trees picked over the view").toBeGreaterThan(0);
  expect(shown.farBrush, "underbrush picked past where it's drawn").toBe(0);
  expect(shown.edges, "area edges picked").toBeGreaterThan(0);
  expect(shown.inside, "insides of areas picked").toBeGreaterThan(0);
  // (the trees hidden: none of them picked)
  await page.evaluate(() => (window as any).__dgView.setTreesHidden(true));
  await draw(page, false);
  const hidden = await sweep();
  await page.evaluate(() => (window as any).__dgView.setTreesHidden(false));
  expect(hidden.trees, "trees picked with the trees hidden").toBe(0);
  // (the pointer resting on an edge: that area outlined, and its name beside it)
  const e = shown.edge!;
  await page.mouse.move(e.x - 3, e.y);
  await page.mouse.move(e.x, e.y);
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.hoverId)).toBe(e.id);
  await expect(page.getByTestId("stand-tip")).toContainText(/edge$/, { timeout: 3000 });
  await page.mouse.move(5, 5);
  // (an area picked, then a drag from inside it, here from a tree standing in it: the map moves,
  // not the area; then a drag from its edge: the area moves) (a wood framed, so trees stand in it)
  const woodBox = await page.evaluate(() => {
    const d = (window as any).__dgCourse(), size = (pts: any[]) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; } return Math.abs(s); };
    const w = d.items.filter((i: any) => i.type === "area" && i.kind === "woods" && !i.locked && !(i.bushes >= 1)).sort((a: any, b: any) => size(b.points) - size(a.points))[0];
    const xs = w.points.map((p: any) => p.x), ys = w.points.map((p: any) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  });
  await frame(page, woodBox);
  await draw(page, false);
  const onTree = await page.evaluate(() => {
    const v = (window as any).__dgView, doc = (window as any).__dgCourse(), r = v.container.getBoundingClientRect();
    for (let y = r.top + 80; y < r.bottom - 80; y += 9) for (let x = r.left + 80; x < r.right - 80; x += 9) {
      const t = v.clickTarget(x, y);
      if (!t.tree) continue;
      const under = v.pick(x, y), it = doc.items.find((i: any) => i.id === under);
      if (it?.type === "area" && !v.pickedEdge && !it.locked) return { x, y, id: under };
    }
    return null;
  });
  expect(onTree, "a tree standing in an area, in view").not.toBeNull();
  await page.evaluate(id => (window as any).__dgActions.select(id), onTree!.id);
  const before = JSON.stringify((await course(page)).items.find((i: any) => i.id === onTree!.id).points);
  await page.mouse.move(onTree!.x, onTree!.y);
  await page.mouse.down();
  await page.mouse.move(onTree!.x + 40, onTree!.y + 25, { steps: 6 });
  await page.mouse.up();
  expect(JSON.stringify((await course(page)).items.find((i: any) => i.id === onTree!.id).points), "the picked area, after a drag from a tree in it").toBe(before);
  const edgeAt = await page.evaluate(id => {
    const v = (window as any).__dgView, r = v.container.getBoundingClientRect();
    for (let y = r.top + 80; y < r.bottom - 80; y += 3) for (let x = r.left + 80; x < r.right - 80; x += 3) if (v.pick(x, y) === id && v.pickedEdge && !v.clickTarget(x, y).tree) return { x, y };
    return null;
  }, onTree!.id);
  expect(edgeAt, "the picked area's edge, in view").not.toBeNull();
  await page.mouse.move(edgeAt!.x, edgeAt!.y);
  await page.mouse.down();
  await page.mouse.move(edgeAt!.x + 40, edgeAt!.y + 25, { steps: 6 });
  await page.mouse.up();
  expect(JSON.stringify((await course(page)).items.find((i: any) => i.id === onTree!.id).points), "the picked area, after a drag from its edge").not.toBe(before);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => JSON.stringify((await course(page)).items.find((i: any) => i.id === onTree!.id).points)).toBe(before);
  await page.keyboard.press("Escape");
});

test("dragging a house: each step quick, letting go quick, back with one undo", async () => {
  await draw(page, false);
  const was = (await course(page)).items.find((i: any) => i.id === "t-house").points[0];
  await page.evaluate(() => (window as any).__dgActions.select("t-house"));
  // (the house framed, wherever the checks before left the map: clear of the panels over it)
  await frame(page, { minX: was.x - 150, minY: was.y - 150, maxX: was.x + 150, maxY: was.y + 150 });
  await frames(page);
  // (off the middle of the roof: its height handle is there in 3D)
  const c = await at(page, 1612, 242, 12);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [c.x, c.y]), "the roof, on the map").toBe("CANVAS");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  const steps: number[] = [];
  const { top, app } = await profiled(page, async () => {
    for (let i = 1; i <= 10; i++) {
      const s = Date.now();
      await page.mouse.move(c.x + i * 4, c.y + i * 2);
      await frames(page);
      steps.push(Date.now() - s);
    }
  });
  const s = Date.now();
  await page.mouse.up();
  await frames(page);
  const letGo = Date.now() - s;
  const perStep = app / steps.length;
  console.log("drag steps ms", steps.join(" "), "· the app's own work", Math.round(perStep), "ms a step · let go", letGo);
  if (perStep >= 80) console.log("where the drag's time went:\n" + top.join("\n"));
  // (about 40 to 60 ms here, without a graphics card; it was over 100 before the drag was made quicker)
  expect(perStep).toBeLessThan(80);
  expect(letGo).toBeLessThan(1500);
  const now = (await course(page)).items.find((i: any) => i.id === "t-house").points[0];
  expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeGreaterThan(3);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).items.find((i: any) => i.id === "t-house").points[0].x).toBeCloseTo(was.x, 1);
});

test("looking round 3D with a hole picked and the course at rest: no stall over 0.2 s", async () => {
  await draw(page, false);
  const hole = (await course(page)).holes[0];
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await page.evaluate(() => (window as any).__dgView.fitSite(false));
  // (at rest long enough for the ground to start painting ahead for a flyover)
  await page.waitForTimeout(3000);
  await watch(page);
  const turn = setInterval(() => void page.evaluate(() => { const v = (window as any).__dgView; v.controls.rotate(0.03, 0, false); v.invalidate(); }).catch(() => {}), 30);
  await page.waitForTimeout(8000);
  clearInterval(turn);
  const s = await stalls(page);
  console.log("stalls while turning, ms", s.all.join(" ") || "none");
  expect(s.over).toBe(0);
});

test("the Trees tool has leafy trees, pines, bushes, woods and hedges; a wood drawn with it is there", async () => {
  await draw(page, false);
  await page.keyboard.press("2");
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "select" }));
  await page.keyboard.press("r");
  for (const id of ["tree-kind-deciduous", "tree-kind-conifer", "tree-kind-bush", "area-kind-woods", "line-kind-hedge"]) await expect(page.getByTestId(id)).toBeVisible();
  const n = (await course(page)).items.filter((i: any) => i.type === "area" && i.kind === "woods").length;
  await page.getByTestId("area-kind-woods").click();
  await frame(page, BOX);
  await page.waitForTimeout(800);
  for (const p of [{ x: 1520, y: 140 }, { x: 1580, y: 140 }, { x: 1580, y: 180 }, { x: 1520, y: 180 }]) {
    const c = await at(page, p.x, p.y);
    await page.mouse.click(c.x, c.y);
  }
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "area" && i.kind === "woods").length).toBe(n + 1);
  await page.keyboard.press("Escape");
});

test("a stand of conifers: Conifer, then Rectangle, dragged out; a wood that grows only conifers round the measured trees, its mix in its panel", async () => {
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "select" }));
  await page.keyboard.press("r");
  await page.getByTestId("tree-kind-conifer").click();
  for (const w of ["one", "points", "box", "circle", "freehand", "paint"]) await expect(page.getByTestId(`draw-shape-${w}`)).toBeVisible();
  await page.getByTestId("draw-shape-box").click();
  await expect(page.getByTestId("tree-kind-conifer")).toHaveClass(/bg-zinc-100/);
  const had = new Set((await course(page)).items.map((i: any) => i.id));
  await frame(page, BOX);
  await page.waitForTimeout(800);
  const a = await at(page, 1480, 420), b = await at(page, 1560, 480);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => !had.has(i.id) && i.kind === "woods").length).toBe(1);
  const stand = (await course(page)).items.find((i: any) => !had.has(i.id) && i.kind === "woods");
  expect([stand.pines, stand.bushes, stand.trees, stand.patches]).toEqual([1, undefined, undefined, undefined]);
  // (a wood drawn by hand fills in round the measured trees, its mix in its panel)
  await page.evaluate(id => (window as any).__dgActions.select(id), stand.id);
  const panel = page.getByTestId("woods-settings");
  await expect(panel.getByTestId("grows-pine")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("grows-leafy")).toHaveAttribute("aria-pressed", "false");
  await expect(panel.getByRole("checkbox", { name: "Keep the measured trees in it" })).toBeChecked();
  // (bushes too: half and half; thick)
  await panel.getByTestId("grows-bush").click();
  await panel.getByRole("radio", { name: "Thick" }).click();
  await expect.poll(async () => { const w = (await course(page)).items.find((i: any) => i.id === stand.id); return [w.pines, w.bushes, w.density]; }).toEqual([1, 0.5, 2]);
  // (the last one on stays on)
  await panel.getByTestId("grows-pine").click();
  await panel.getByTestId("grows-bush").click();
  await expect(panel.getByTestId("grows-bush")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("radiogroup", { name: "Underbrush" })).toHaveCount(0);
  // (One tree: back to a tree at a time)
  await page.keyboard.press("r");
  await page.getByTestId("draw-shape-one").click();
  expect((await editor(page)).tool).toBe("add-tree");
  await page.keyboard.press("Escape");
});

test("a hole's trees in the way: said, cleared when asked (and said), brought back", async () => {
  const doc = await course(page);
  let found = false;
  for (const h of doc.holes) {
    await page.evaluate(id => (window as any).__dgActions.select(id), h.id);
    const card = page.getByTestId("fairway-trees");
    if (!(await card.isVisible().catch(() => false)) || !/in the way/.test(await card.innerText())) continue;
    found = true;
    await page.getByTestId("trees-clear").click();
    await expect(card).toContainText("cut down");
    await expect(page.getByText(/^Cut down \d+ trees? on hole \d+/)).toBeVisible();
    await page.getByTestId("trees-back").click();
    await expect(card).toContainText("in the way");
    break;
  }
  expect(found).toBe(true);
});

test("a pond made a hazard: never OB as well", async () => {
  const pond = (await course(page)).items.find((i: any) => i.type === "area" && i.kind === "water");
  await page.evaluate(id => (window as any).__dgActions.select(id), pond.id);
  await page.getByRole("radiogroup", { name: "Penalty" }).getByRole("radio", { name: "Hazard" }).click();
  await expect.poll(async () => { const p = (await course(page)).items.find((i: any) => i.id === pond.id); return [p.hazard, p.ob]; }).toEqual([true, false]);
  await page.keyboard.press("Control+z");
});

test("a flyover's keyframes: two set, the timeline scrubbed (the camera follows it), and a keyframe added at that moment", async () => {
  await draw(page, false);
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "select" }));
  const hole = (await course(page)).holes[0];
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await page.getByTestId("hole-flight").getByTestId("fly-camera").click();
  await expect(page.getByTestId("camera-hud")).toBeVisible();
  const keys = async () => ((await course(page)).holes.find((h: any) => h.id === hole.id).flyKeys ?? []) as any[];
  const had = (await keys()).length;
  await page.keyboard.press("Enter");
  await page.keyboard.down("w");
  await page.waitForTimeout(900);
  await page.keyboard.up("w");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await keys()).length).toBe(had + 2);
  await expect(page.getByTestId("cam-timeline")).toBeVisible();
  // (half way through the flight: the camera there, the status says so)
  const end = Number(await page.getByTestId("cam-scrub").getAttribute("max"));
  await page.getByTestId("cam-scrub").fill(String(Math.round((end / 2) * 20) / 20));
  await expect(page.getByTestId("cam-status")).toContainText("At ");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await keys()).length).toBe(had + 3);
  expect((await editor(page)).flyKey).toBe(had + 1);
  await page.getByTestId("cam-done").click();
});

test("on a phone, the Trees tool has the same kinds, woods included, and the ways to plant a stand", async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
  await phone.goto("/");
  const id = (await saved(page)).id;
  await phone.evaluate(id => (window as any).__dgServer.open(id), id);
  await phone.waitForFunction(() => (window as any).__dgCourse?.()?.holes?.length > 0, null, { timeout: 60_000 });
  const back = phone.getByTestId("back-to-course");
  if (await back.isVisible().catch(() => false)) await back.click();
  await phone.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "add-tree" }));
  for (const t of ["tree-kind-deciduous", "tree-kind-conifer", "tree-kind-bush", "area-kind-woods", "line-kind-hedge"]) await expect(phone.getByTestId(t)).toBeAttached();
  await expect(phone.getByTestId("area-kind-woods")).toBeVisible();
  await expect(phone.getByTestId("draw-shape-points")).toBeAttached();
  await phone.close();
});

test("the painted map: Where to paint the woods is there with measured trees, and the map paints in time", async () => {
  // (where the woods grow is the place's: the Site step's Trees, which the map draws the same)
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "site", tool: "select" }));
  const trees = page.getByTestId("site-trees").locator("summary");
  if (!(await page.getByTestId("forest-options").isVisible())) await trees.click();
  await expect(page.getByTestId("forest-options")).toBeVisible();
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "map", tool: "select" }));
  const s = Date.now();
  await page.waitForFunction(() => !(window as any).__dgPainting(), null, { timeout: 150_000 });
  console.log("map painted in", Math.round((Date.now() - s) / 1000), "s");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("design-page").first()).toHaveScreenshot("painted-map.png");
});

test("the painted map past the measured ground: level, never the edge's hills drawn on outward in stripes", async () => {
  await page.waitForFunction(() => typeof (window as any).__dgMapDiff === "function", null, { timeout: 60_000 });
  const d = await page.evaluate(async () => {
    const w = window as any, doc = w.__dgCourse();
    // (stretches well past the site's east and west edges: the Hills setting changes nothing there)
    const out: number[] = [];
    for (const cx of [doc.canvas.width + 700, -700]) out.push(await w.__dgMapDiff(doc, { ...doc.style, reliefScale: 1 }, { ...doc.style, reliefScale: 2.5 }, { cx, cy: doc.canvas.height / 2, rotation: 0, scale: 0.5, width: 240, height: 400 }));
    return out;
  });
  expect(Math.max(...d)).toBeLessThan(0.2);
});

test("the course map comes in close: every tee, basket and amenity on the page and clear of its pieces, little of it past the site", async () => {
  await page.waitForFunction(() => typeof (window as any).__dgPosterFit === "function", null, { timeout: 60_000 });
  const fits = await page.evaluate(() => {
    const w = window as any, doc = w.__dgCourse();
    // (turned every which way, on a poster and on letter paper)
    return [0, 45, 90, 135, 180, 225, 270, 315].flatMap(rotation => ["36x48", "letter"].map(paper => ({ rotation, paper, ...w.__dgPosterFit({ ...doc, style: { ...doc.style, rotation, paper } }) })));
  });
  for (const f of fits) {
    expect(f.under, `${f.rotation}° on ${f.paper}: under ${f.under.join(", ")}`).toEqual([]);
    expect(f.nearest, `${f.rotation}° on ${f.paper}`).toBeGreaterThan(0);
  }
  // (north up, the site holds nearly all the poster)
  expect(fits.find(f => f.rotation === 0 && f.paper === "36x48")!.offSite).toBeLessThan(0.05);
});

test("a new color or tone is painted again only where it reaches: the same pixels as a whole new painting, and quicker", async () => {
  await page.waitForFunction(() => typeof (window as any).__dgPaintAgain === "function", null, { timeout: 60_000 });
  const runs = await page.evaluate(async () => {
    const w = window as any, doc = w.__dgCourse(), s = doc.style;
    const view = { cx: doc.canvas.width / 2, cy: doc.canvas.height / 2, rotation: 0, scale: 0.6, width: 1200, height: 1000 };
    const out: Record<string, { differ: number; fastMs: number; wholeMs: number }> = {};
    for (const [name, patch] of [["water", { water: "#7a2a8a" }], ["fairway", { fairway: "#d9f07a" }], ["path", { path: "#d23c3c" }], ["grass", { rough: "#9a7a3a" }], ["light", { light: 0.12 }], ["contrast and water", { contrast: 0.2, water: "#2a6a9a" }], ["brushwork", { paint: 0.3 }]] as const)
      out[name] = await w.__dgPaintAgain(doc, s, { ...s, ...patch }, view);
    return out;
  });
  console.log("painted again:", JSON.stringify(runs));
  for (const [name, r] of Object.entries(runs)) expect(r.differ, `${name}: pixels unlike a whole new painting`).toBe(0);
  for (const name of ["water", "path", "light"]) expect(runs[name].fastMs, `${name}: ${runs[name].fastMs} ms against ${runs[name].wholeMs}`).toBeLessThan(runs[name].wholeMs * 0.6);
});

test("a whole new painting shared out among workers on a computer: the same pixels as painted on the page alone", async () => {
  await page.waitForFunction(() => typeof (window as any).__dgPaintBands === "function", null, { timeout: 60_000 });
  const r = await page.evaluate(async () => {
    const w = window as any, doc = w.__dgCourse();
    return w.__dgPaintBands(doc, { cx: doc.canvas.width / 2, cy: doc.canvas.height / 2, rotation: 30, scale: 0.9, width: 1600, height: 1200 });
  });
  console.log("painted in bands:", JSON.stringify(r));
  expect(r.differ, "pixels unlike the page's own painting").toBe(0);
});

test("underbrush from the import: more with How much, heavier with How thick, never on buildings, roads, paths, parking or water; a tap steps a patch lighter, then gone, then back; painted alike in workers", async () => {
  await page.waitForFunction(() => typeof (window as any).__dgBrush === "function", null, { timeout: 60_000 });
  const r = await page.evaluate(() => { const w = window as any; return w.__dgBrush(w.__dgCourse()); });
  console.log("underbrush:", JSON.stringify({ ...r, areas: r.areas.length }));
  expect(r.much[0], "acres at Only the surest").toBeGreaterThan(0);
  for (let k = 1; k < 5; k++) expect(r.much[k], `acres at step ${k} of How much`).toBeGreaterThanOrEqual(r.much[k - 1]);
  expect(r.much[4], "Every hint against Only the surest").toBeGreaterThan(r.much[0]);
  expect(r.heavy[2], "heavy acres at Much thicker against Much thinner").toBeGreaterThan(r.heavy[0]);
  expect(r.onNever, "blocks of brush on a building, road, path, parking or water").toBe(0);
  expect(r.overBuilt, "brush areas over a building, a parking lot or a road").toBe(0);
  // (heavy, medium, light, gone, then heavy again)
  expect(r.taps).toEqual([...Array.from({ length: r.startsAt }, (_, k) => r.startsAt - 1 - k), r.startsAt]);
  // (its bushes painted the same shared out among workers as on the page alone)
  const p = await page.evaluate(async areas => {
    const w = window as any, doc = w.__dgCourse();
    return w.__dgPaintBands({ ...doc, items: [...doc.items, ...areas] }, { cx: doc.canvas.width * 0.7, cy: doc.canvas.height / 2, rotation: 0, scale: 1.2, width: 900, height: 700 });
  }, r.areas);
  console.log("underbrush painted:", JSON.stringify(p));
  expect(p.differ, "pixels unlike the page's own painting").toBe(0);
});

test("painting areas: Remove cuts a wood drawn by points (a stroke across splits it, every corner it misses stays put), Add from inside grows it, underbrush steps a level a pass, a locked area never changes; Reshape with the brush is one undo", async () => {
  await page.waitForFunction(() => typeof (window as any).__dgAreaBrush === "function" || typeof (window as any).__dgAreaBrush === "object", null, { timeout: 60_000 });
  const r = await page.evaluate(() => {
    const w = window as any, B = w.__dgAreaBrush, doc = w.__dgCourse();
    const area = (pts: any[]) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; } return Math.abs(s / 2); };
    const inside = (p: any, pts: any[]) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
    // (a wood drawn corner by corner: the biggest one that isn't underbrush)
    const woods = doc.items.filter((i: any) => i.type === "area" && i.kind === "woods" && !(i.bushes >= 1) && !i.locked).sort((a: any, b: any) => area(b.points) - area(a.points))[0];
    const xs = woods.points.map((p: any) => p.x), ys = woods.points.map((p: any) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const across = B.strokeOutline([{ x: minX - 40, y: midY }, { x: maxX + 40, y: midY }], 12);
    const cut = B.brushStroke(doc.items, { kind: "woods", brush: false }, "remove", across, { x: minX - 40, y: midY }, woods.id, []);
    const after = B.applyEdit(doc.items, cut);
    const pieces = after.filter((i: any) => i.id === woods.id || cut.add.some((a: any) => a.id === i.id));
    const kept = new Set(pieces.flatMap((i: any) => i.points.map((p: any) => `${p.x},${p.y}`)));
    const far = woods.points.filter((p: any) => Math.abs(p.y - midY) > 20);
    // (Add from inside: the same wood, bigger)
    const c = { x: woods.points.reduce((s: number, p: any) => s + p.x, 0) / woods.points.length, y: woods.points.reduce((s: number, p: any) => s + p.y, 0) / woods.points.length };
    const out = woods.points.reduce((b: any, p: any) => (Math.hypot(p.x - c.x, p.y - c.y) > Math.hypot(b.x - c.x, b.y - c.y) ? p : b), woods.points[0]);
    // (from just inside its edge, toward its farthest corner, out past it)
    const along = (t: number) => ({ x: c.x + (out.x - c.x) * t, y: c.y + (out.y - c.y) * t });
    let lastIn = 0;
    for (let t = 0; t <= 1.2; t += 0.01) if (inside(along(t), woods.points)) lastIn = t;
    const start = along(Math.max(0, lastIn - 0.03)), end = along(lastIn + 0.3);
    const grow = B.brushStroke(doc.items, { kind: "woods", brush: false }, "add", B.strokeOutline([start, end], 15), start, null, []);
    const grown = grow?.update.find((a: any) => a.id === woods.id);
    // (underbrush: a level a pass, at a spot inside the heaviest patch)
    const lvAt = (items: any[], p: any) => { let m = 0; for (const i of items) if (i.type === "area" && i.bushes >= 1 && inside(p, i.points)) m = Math.max(m, i.density === 0.5 ? 1 : i.density === 2 ? 3 : 2); return m; };
    const brush = doc.items.filter((i: any) => i.type === "area" && i.bushes >= 1).sort((a: any, b: any) => (b.density ?? 1) - (a.density ?? 1) || area(b.points) - area(a.points))[0];
    const bp = brush.points.reduce((s: any, p: any) => ({ x: s.x + p.x / brush.points.length, y: s.y + p.y / brush.points.length }), { x: 0, y: 0 });
    const spot = inside(bp, brush.points) ? bp : brush.points[0];
    const dab = B.strokeOutline([spot], 10);
    let items = doc.items;
    const steps = [lvAt(items, spot)];
    for (const m of ["thinner", "thinner", "thicker"]) { const e = B.brushStroke(items, { kind: "woods", brush: true }, m, dab, spot, null, []); if (e) items = B.applyEdit(items, e); steps.push(lvAt(items, spot)); }
    // (a locked wood: nothing)
    const locked = B.brushStroke(doc.items.map((i: any) => (i.id === woods.id ? { ...i, locked: true } : i)), { kind: "woods", brush: false }, "remove", across, { x: minX - 40, y: midY }, null, []);
    return {
      pieces: pieces.length, before: Math.round(area(woods.points)), afterArea: Math.round(pieces.reduce((s: number, i: any) => s + area(i.points), 0)),
      farKept: far.filter((p: any) => kept.has(`${p.x},${p.y}`)).length, far: far.length,
      grown: !!grown && area(grown.points) > area(woods.points), sameId: !!grown,
      steps, lockedTouched: !!locked && (locked.update.some((a: any) => a.id === woods.id) || locked.remove.includes(woods.id)),
      woodsId: woods.id, mid: { x: (minX + maxX) / 2, y: midY }, box: { minX, minY: Math.min(...ys), maxX, maxY: Math.max(...ys) }
    };
  });
  console.log("painting areas:", JSON.stringify({ ...r, mid: undefined, box: undefined }));
  expect(r.pieces, "a stroke right across: two woods").toBeGreaterThanOrEqual(2);
  expect(r.afterArea, "less wood after the cut").toBeLessThan(r.before);
  expect(r.farKept, "corners the stroke didn't reach, still exactly where they were").toBe(r.far);
  expect(r.grown && r.sameId, "Add from inside: the same wood, bigger").toBe(true);
  const [s0, s1, s2, s3] = r.steps;
  expect(s1, "a Thinner pass").toBe(Math.max(0, s0 - 1));
  expect(s2, "another").toBe(Math.max(0, s0 - 2));
  expect(s3, "a Thicker pass").toBe(Math.min(3, s2 + 1));
  expect(r.lockedTouched, "a locked wood, changed").toBe(false);
  // (Reshape with the brush, from the wood's panel, and a real drag across it: one undo puts it back)
  await frame(page, r.box);
  await draw(page, false);
  await page.evaluate(id => (window as any).__dgActions.select(id), r.woodsId);
  await page.getByTestId("reshape-brush").click();
  await page.getByTestId("area-brush-remove").click();
  const before = JSON.stringify((await course(page)).items.find((i: any) => i.id === r.woodsId).points);
  const a = await at(page, r.mid.x - 30, r.mid.y, 0), b = await at(page, r.mid.x + 30, r.mid.y, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await course(page)).items.find((i: any) => i.id === r.woodsId)?.points), { message: "the wood after a stroke" }).not.toBe(before);
  await page.getByTestId("reshape-done").click();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => JSON.stringify((await course(page)).items.find((i: any) => i.id === r.woodsId)?.points), { message: "after one undo" }).toBe(before);
});

test("a refresh in a course comes back to it, on its step and printout; on the course list, to the list", async () => {
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "map", designTab: "sign", tool: "select" }));
  await page.waitForTimeout(400);
  const id = await page.evaluate(() => (window as any).__dgServer.state().id);
  await page.reload();
  await page.waitForFunction(() => (window as any).__dgCourse?.()?.holes?.length > 0 && !!(window as any).__dgServer?.state().id, null, { timeout: 60_000 });
  await expect(page.getByTestId("home")).toBeHidden();
  expect(await page.evaluate(() => [(window as any).__dgServer.state().id, (window as any).__dgEditor().step, (window as any).__dgEditor().designTab])).toEqual([id, "map", "sign"]);
  // (on the list, refreshed: the list)
  await page.getByTestId("logo-home").click();
  await expect(page.getByTestId("home")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("home")).toBeVisible({ timeout: 30_000 });
  // (back in the course for the checks after)
  await page.getByTestId("back-to-course").click();
  await expect(page.getByTestId("home")).toBeHidden();
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "select" }));
});

test("the browser's Back and Forward go through the steps, and between a course and Courses", async () => {
  const step = () => page.evaluate(() => (window as any).__dgEditor().step);
  for (const s of ["design", "map", "export"]) {
    await page.evaluate(to => (window as any).__dgEditor().set({ step: to, tool: "select" }), s);
    await page.waitForTimeout(150);
  }
  await page.goBack();
  await expect.poll(step).toBe("map");
  await page.goBack();
  await expect.poll(step).toBe("design");
  await page.goForward();
  await expect.poll(step).toBe("map");
  await page.getByTestId("logo-home").click();
  await expect(page.getByTestId("home")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("home")).toBeHidden();
  await expect.poll(step).toBe("map");
  await page.evaluate(() => (window as any).__dgEditor().set({ step: "design", tool: "select" }));
});

test("Hand painted's trees on the graphics chip: two paintings at once, and one stopped part way, each whole, as if painted alone", async () => {
  test.setTimeout(300_000);
  // (a browser of its own with an emulated graphics chip, as the check below has: the trees are
  // painted on the chip only where there is one)
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ baseURL: "http://localhost:4176", viewport: { width: 1280, height: 820 }, storageState: await page.context().storageState() });
  const p2 = await ctx.newPage();
  try {
    await p2.goto("/");
    const demo = await (await p2.request.get("/example/course.json")).json();
    await p2.evaluate(d => (window as any).__dgServer.start(d), demo);
    await p2.waitForFunction(() => (window as any).__dgCourse?.()?.holes?.length > 0 && typeof (window as any).__dgPaintTogether === "function", null, { timeout: 60_000 });
    const r = await p2.evaluate(async () => {
      const w = window as any, doc = w.__dgCourse();
      const s = { ...doc.style, mapLook: "handpainted", lookParts: { ...doc.style.lookParts, trees: { ...doc.style.lookParts?.trees, style: "brushed" } } };
      const mid = { cx: doc.canvas.width / 2, cy: doc.canvas.height / 2, rotation: 0 };
      // (a stretch of woods, small: the emulated chip is slow)
      return w.__dgPaintTogether({ ...doc, style: s }, { ...mid, scale: 1.2, width: 300, height: 240 }, { ...mid, scale: 1.5, width: 240, height: 300 });
    });
    console.log("painted together:", JSON.stringify(r));
    expect(r.a, "the first of two at once").toBe(0);
    expect(r.b, "the second of two at once").toBe(0);
    expect(r.afterStopped, "after one stopped part way").toBe(0);
  } finally { await b.close(); }
});

test("Hand painted: the demo (made before) stays Classic, a new course starts in Hand painted, and its map paints in time", async () => {
  expect((await course(page)).style.mapLook).toBeUndefined();
  expect(createEmptyCourse().style.mapLook).toBe("handpainted");
  expect(normalizeCourse({ ...createEmptyCourse(), style: { ...createEmptyCourse().style, mapLook: undefined } }).style.mapLook).toBeUndefined();
  // (in a browser of its own, its emulated graphics chip in its faster mode: the default one is
  // about 22 times slower, nothing like a real chip; and the 3D view drawing nothing)
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ baseURL: "http://localhost:4176", viewport: { width: 1280, height: 820 }, storageState: await page.context().storageState() });
  const p2 = await ctx.newPage();
  try {
    // (its own copy of the demo: two pages saving the same course would each paint again and again)
    await p2.goto("/");
    const demo = await (await p2.request.get("/example/course.json")).json();
    await p2.evaluate(d => (window as any).__dgServer.start(d), demo);
    await p2.waitForFunction(() => (window as any).__dgCourse?.()?.holes?.length > 0, null, { timeout: 60_000 });
    const back = p2.getByTestId("back-to-course");
    if (await back.isVisible().catch(() => false)) await back.click();
    if (await p2.evaluate(() => !!(window as any).__dgView)) await draw(p2, false);
    // (every painting of the trees, as it ends)
    await p2.evaluate(() => { (window as any).__times = []; window.addEventListener("dg-tree-timing", (e: any) => (window as any).__times.push({ ...e.detail, at: Math.round(performance.now()) })); });
    p2.on("console", m => { if (/Hand painted|webgl|WebGL/i.test(m.text())) console.log("[page]", m.text().slice(0, 300)); });
    const ticker = setInterval(() => void p2.evaluate(() => [(window as any).__dgPainting(), JSON.stringify((window as any).__times)]).then(v => console.log("painting", v[0], v[1])).catch(() => {}), 15_000);
    await p2.evaluate(() => (window as any).__dgEditor().set({ step: "map", tool: "select" }));
    await p2.getByTestId("map-style-handpainted").click();
    await expect.poll(async () => (await course(p2)).style.mapLook).toBe("handpainted");
    await p2.waitForFunction(() => !!(window as any).__dgTreeTiming, null, { timeout: 170_000 });
    const t = await p2.evaluate(() => (window as any).__dgTreeTiming);
    console.log("Hand painted trees:", JSON.stringify(t));
    expect(t.how).toContain("graphics chip");
    await p2.waitForFunction(() => !(window as any).__dgPainting(), null, { timeout: 120_000 });
    await p2.waitForTimeout(1500);
    clearInterval(ticker);
    await p2.getByTestId("design-page").first().screenshot({ path: "test-results/handpainted-map.png" });
    // (on the emulated chip, a whole 18-hole course in under 20 s; a real one is far quicker)
    expect(t.total).toBeLessThan(20_000);
    await p2.keyboard.press("Control+z");
  } finally { await b.close(); }
});
