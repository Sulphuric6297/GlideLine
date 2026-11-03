import { test as plain, expect as plainExpect } from "@playwright/test";
import { test, expect, addHole, backToMap, blankCourse, course, drag, editorState, flyButton, handleCenter, screenOf, teeBar, teeCard } from "./fixtures";
import { autoFlight, flightAt, flightClock, FLYOVER_DEFAULTS, insertKey, insertKeyAt, keyBetween, keyFlight, keysFromFlight, keyTimes } from "../../src/lib/flight";
import { createArea, createBasket, createEmptyCourse, createTee, newHole, normalizeCourse } from "../../src/lib/course";
import { drawOverlay } from "../../src/viewport/flyTitle";
import { detailArea } from "../../src/lib/forest";

test("view from the tee: the hole's numbers, other holes with the arrows, back with Esc", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 750, y: 700 });
  await addHole(page, { x: 800, y: 650 }, { x: 800, y: 300 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  const hud = teeCard(page);
  await expect(hud).toContainText("Par 3 · 350 ft");
  // The basket is marked with its distance
  await expect(page.getByTestId("pov-basket")).toContainText("350 ft");
  // The camera stands at the tee, at eye height, looking down the hole
  const pose = await page.evaluate(() => {
    const v = (window as any).__dgView;
    return { x: v.povCam.position.x, y: v.povCam.position.y, z: v.povCam.position.z };
  });
  expect(Math.round(pose.x)).toBe(400);
  expect(Math.round(pose.z)).toBe(700);
  expect(pose.y).toBeGreaterThan(5);
  await page.keyboard.press("ArrowRight");
  await expect(hud).toContainText("Par 3 · 350 ft");
  await expect.poll(async () => (await editorState(page)).teeView).not.toBeNull();
  const second = (await editorState(page)).teeView;
  const doc = await page.evaluate(() => (window as any).__dgCourse().holes.map((h: any) => h.id));
  expect(second).toBe(doc[1]);
  await page.keyboard.press("Escape");
  await expect(hud).toBeHidden();
  expect((await editorState(page)).teeView).toBeNull();
});

test("a slow frame doesn't skip the flyover", async ({ page }) => {
  await blankCourse(page);
  // A long hole: a long flight
  await addHole(page, { x: 250, y: 850 }, { x: 1250, y: 250 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await page.getByTestId("flyover").click();
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Pause");
  // The page is busy for longer than a short flight (like a first frame compiling shaders)
  const before = await page.evaluate(() => {
    const p = (window as any).__dgView.flyProgress();
    const t = performance.now();
    while (performance.now() - t < 7000);
    return p;
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => (window as any).__dgView.flyProgress());
  expect(after).not.toBeNull();
  expect(after - before).toBeLessThan(0.2);
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Pause");
});

test("flyover runs from the tee to the basket and stops", async ({ page }) => {
  test.setTimeout(150_000);
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await page.getByTestId("flyover").click();
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Pause");
  // (it waits for everything to be drawn first, up to 15 s, then holds its title a moment)
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.flyProgress()), { timeout: 30_000 }).toBeGreaterThan(0.05);
  // It lands by itself (a short hole flies for 6 seconds and slows to a stop; a slow frame
  // doesn't skip it, so drawn in software here it takes longer)
  // (it holds on its last picture, paused)
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Play", { timeout: 90_000 });
  expect((await page.evaluate(() => (window as any).__dgEditor().flyPaused))).toBe(true);
  await backToMap(page);
  await expect(teeBar(page)).toHaveCount(0);
});

test("leaving a flyover part way leaves nothing of it over the map (its title, badge, distance)", async ({ page }) => {
  test.setTimeout(120_000);
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await page.getByTestId("flyover").click();
  await expect(page.getByTestId("fly-overlay")).toBeVisible();
  await backToMap(page);
  await expect(teeBar(page)).toHaveCount(0);
  await expect(page.getByTestId("fly-overlay")).toBeHidden();
  await expect(page.getByTestId("pov-basket")).toBeHidden();
  // (and after a while on the map too)
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("fly-overlay")).toBeHidden();
});

test("under the 3D trees the painted ground is grass, not painted treetops (the trees still stand on its woods)", async ({ page }) => {
  // (slow under software rendering: the view from the tee drawn frame by frame)
  test.setTimeout(240_000);
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 750, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  // (the 3D view rests while it paints: drawn in software, its frames would starve the painting)
  await page.evaluate(() => (window as any).__dgView.setPaused(true));
  await expect.poll(() => page.evaluate(() => { const v = (window as any).__dgView; return !!v.ground.paintedTexture && v.shapes.has("painted-woods"); }), { timeout: 150_000 }).toBe(true);
  // How much the brightness varies over 40 ft squares in the woods: treetops lit and shaded vary
  // a lot, grass little
  const spread = await page.evaluate(() => {
    const v = (window as any).__dgView, img = v.ground.paintedTexture.image, doc = (window as any).__dgCourse();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const k = img.width / doc.canvas.width;
    return [[150, 200], [1000, 300]].map(([x, y]) => {
      const d = g.getImageData(Math.round((x - 20) * k), Math.round((y - 20) * k), Math.round(40 * k), Math.round(40 * k)).data;
      let n = 0, sum = 0, sq = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; sum += l; sq += l * l; n++; }
      return Math.sqrt(sq / n - (sum / n) ** 2);
    });
  });
  for (const sd of spread) expect(sd).toBeLessThan(10);
  await backToMap(page);
});

test("Enter on a selected hole opens its tee view", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 650, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").click();
  await page.keyboard.press("Enter");
  await expect(teeCard(page)).toBeVisible();
});

test("from a tee and flying over, the ground is the painted map with trees on its woods; Photo puts the photo back", async ({ page }) => {
  test.setTimeout(300_000);
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 750, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  const ground = () => page.evaluate(() => {
    const v = (window as any).__dgView;
    const plane = v.ground.mapPlane.material;
    return { painted: !!v.ground.paintedTexture, shown: !!plane.map && plane.map === v.ground.paintedTexture && plane.visible, trees: v.shapes.has("painted-woods") };
  });
  // (the 3D view rests while it paints: drawn in software here, its frames would starve the painting)
  await page.evaluate(() => (window as any).__dgView.setPaused(true));
  await expect.poll(ground, { timeout: 150_000 }).toEqual({ painted: true, shown: true, trees: true });
  // The View panel beside it: the photo instead (kept for next time); none in the flyover's settings
  // (the Flyover panel, open beside the view)
  await expect(page.getByTestId("flyover-settings")).toBeVisible();
  await expect(page.getByTestId("flyover-settings").getByRole("radio", { name: "Photo" })).toHaveCount(0);
  await page.locator("[data-pov-ui]").getByTestId("scene-button").click();
  const viewGround = page.getByTestId("scene-panel").getByTestId("view-ground");
  await viewGround.getByRole("radio", { name: "Photo" }).click();
  await expect.poll(async () => (await ground()).painted).toBe(false);
  expect((await editorState(page)).flyLook).toBe("photo");
  await viewGround.getByRole("radio", { name: "Painted map" }).click();
  await expect.poll(async () => (await ground()).painted, { timeout: 30_000 }).toBe(true);
  // Back on the map: the photo's ground again, no painted trees (closed while still resting:
  // the tee view's painted woods drawn in software would hold up the click)
  await backToMap(page);
  await page.evaluate(() => (window as any).__dgView.setPaused(false));
  await expect.poll(ground, { timeout: 30_000 }).toEqual({ painted: false, shown: false, trees: false });
});

test("from a tee, the hole's ground is painted sharper (over the whole site's painting); gone back on the map", async ({ page }) => {
  // (slow under software rendering: the view from the tee drawn frame by frame)
  test.setTimeout(240_000);
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 750, y: 700 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  // (the 3D view rests while it paints: drawn in software, its frames would starve the painting)
  await page.evaluate(() => (window as any).__dgView.setPaused(true));
  const sharp = () => page.evaluate(() => {
    const v = (window as any).__dgView;
    const d = v.ground.detailPainting, plane = v.ground.detailPlane, base = v.ground.paintedTexture;
    if (!d || !plane || !base) return null;
    return { rect: d.rect, pxPerFt: d.canvas.width / d.rect.width, basePxPerFt: base.image.width / v.doc.canvas.width, shown: plane.visible };
  });
  await expect.poll(sharp, { timeout: 120_000 }).not.toBeNull();
  const d = (await sharp())!;
  expect(d.shown).toBe(true);
  // (round the hole, tee to basket)
  expect(d.rect.x).toBeLessThan(400);
  expect(d.rect.x + d.rect.width).toBeGreaterThan(750);
  expect(d.rect.y).toBeLessThan(700);
  expect(d.rect.y + d.rect.height).toBeGreaterThan(700);
  expect(d.pxPerFt).toBeGreaterThan(d.basePxPerFt * 1.5);
  // (closed while still resting, as above)
  await backToMap(page);
  await page.evaluate(() => (window as any).__dgView.setPaused(false));
  await expect.poll(sharp).toBeNull();
});

plain("the timeline scrubbed: the camera where the flight is at that moment; a keyframe added there splits the time, so the rest keeps its timing", () => {
  const flat = () => 0, set = { ...FLYOVER_DEFAULTS, speed: 1 };
  const keys = [
    { x: 0, y: 0, alt: 20, lookX: 100, lookY: 0, secs: undefined },
    { x: 100, y: 0, alt: 40, lookX: 200, lookY: 0, secs: 4 },
    { x: 200, y: 0, alt: 20, lookX: 300, lookY: 0, secs: 6 }
  ];
  const f = keyFlight(keys, set, flat)!;
  plainExpect(f.dur).toBeCloseTo(10, 5);
  // (at a keyframe's moment, just where it is; between, along the way)
  const atStart = flightAt(f, 0, flat), at4 = flightAt(f, 4, flat), at7 = flightAt(f, 7, flat);
  plainExpect(Math.abs(atStart.x)).toBeLessThan(1);
  plainExpect(Math.abs(at4.x - 100)).toBeLessThan(2);
  plainExpect(Math.abs(at4.alt - 40)).toBeLessThan(1);
  plainExpect(at7.x).toBeGreaterThan(110);
  plainExpect(at7.x).toBeLessThan(190);
  // A keyframe added 7 s in: third of four, 3 s after the one before and 3 s before the next
  const r = insertKeyAt(keys, 7, { ...at7, alt: 60 }, set, flat);
  plainExpect(r.at).toBe(2);
  plainExpect(r.keys).toHaveLength(4);
  plainExpect(r.keys[2].secs).toBeCloseTo(3, 1);
  plainExpect(r.keys[3].secs).toBeCloseTo(3, 1);
  plainExpect(keyTimes(r.keys, set, flat).map(t => Math.round(t * 10) / 10)).toEqual([0, 4, 7, 10]);
  // (past the end: after the last)
  plainExpect(insertKeyAt(keys, 12, at7, set, flat).at).toBe(3);
});

plain("a flight's motion slows smoothly to a stop at its end (and by itself gets going gently): no jolt anywhere", () => {
  for (const [dur, easeIn] of [[8, true], [6, false], [2, true]] as const) {
    const { play, at } = flightClock(dur, easeIn);
    plainExpect(play).toBeGreaterThan(dur);
    plainExpect(at(0)).toBe(0);
    plainExpect(at(play)).toBeCloseTo(dur, 9);
    const dt = 0.01;
    const speed = (t: number) => (at(t + dt) - at(t - dt)) / (2 * dt);
    // Stopped at the end, flying at full speed before the slowing, and never jumping
    plainExpect(speed(play - dt)).toBeLessThan(0.01);
    plainExpect(speed(play - Math.min(2, dur / 3) * 2 - 0.05)).toBeCloseTo(1, 2);
    let last = speed(dt);
    for (let t = 2 * dt; t < play - dt; t += dt) {
      const v = speed(t);
      plainExpect(v).toBeGreaterThanOrEqual(-1e-9);
      plainExpect(Math.abs(v - last)).toBeLessThan(0.04);
      last = v;
    }
    // By itself it starts from rest; through keyframes, straight away at their speed
    if (easeIn) plainExpect(speed(dt)).toBeLessThan(0.05);
    else plainExpect(at(1)).toBeCloseTo(1, 9);
  }
});

test("a video is drawn finer than the screen (thinner haze; with a graphics card, every tree in full detail however far off), and the screen's back after", async ({ page }) => {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 750, y: 700 });
  const info = () => page.evaluate(() => (window as any).__dgView.qualityInfo());
  const screen = await info();
  const during = await page.evaluate(() => {
    const v = (window as any).__dgView;
    const frames = v.flightFrames(64, 36);
    const q = v.qualityInfo();
    frames.dispose();
    return q;
  });
  expect(during.video).toBe(true);
  expect(during.haze).toBeLessThan(screen.haze);
  // (drawn in software here, where only the haze changes)
  expect(during.allTrees).toBe(!during.software);
  const after = await info();
  expect([after.video, after.nearFt, after.allTrees, after.haze, after.shadow]).toEqual([false, screen.nearFt, false, screen.haze, screen.shadow]);
});

plain("where a hole is painted sharper: round its line on the terrain's grid, at most 6 px a foot, none when no sharper than the whole site", () => {
  const doc = { canvas: { width: 2000, height: 1500 }, gridSize: 10 };
  const line = [{ x: 403, y: 707 }, { x: 755, y: 698 }];
  const a = detailArea(doc, line, 3072, 1)!;
  plainExpect(a.rect).toEqual({ x: 240, y: 530, width: 680, height: 340 });
  for (const v of Object.values(a.rect)) plainExpect(v % 10).toBe(0);
  plainExpect(a.k).toBeCloseTo(3072 / 680, 6);
  // (a short hole: no sharper than 6 px a foot)
  plainExpect(detailArea(doc, [{ x: 500, y: 500 }, { x: 560, y: 500 }], 3072, 1)!.k).toBe(6);
  // (at the site's edge: kept on the site)
  plainExpect(detailArea(doc, [{ x: 30, y: 20 }, { x: 300, y: 20 }], 3072, 1)!.rect.x).toBe(0);
  // Not worth it when the whole site's painting is about as sharp
  plainExpect(detailArea(doc, line, 3072, 4)).toBeNull();
});

test("flyover settings: height, speed and lens change the flight, one undo step each; a hole's own", async ({ page }) => {
  // (slow under software rendering: the view from the tee drawn frame by frame)
  test.setTimeout(240_000);
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  await expect(page.getByTestId("flyover-settings")).toBeVisible();
  const flight = () => page.evaluate(id => {
    const v = (window as any).__dgView;
    const f = v.flightPath(id);
    const mid = f.pts[Math.floor(f.pts.length / 2)];
    // (the hole as it was laid out: on a slow machine a click can land a little off the spot aimed at)
    const line = v.doc.stats.find((x: any) => x.holeId === id).line as { x: number; y: number }[];
    let len = 0;
    for (let i = 1; i < line.length; i++) len += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    return { alt: mid.y - v.h(mid.x, mid.z), dur: f.dur, fov: f.fov[0], len };
  }, hole.id);
  const before = await flight();
  expect(before.dur).toBeCloseTo(before.len / 70, 1);
  const slider = (name: string) => page.getByTestId("flyover-settings").getByRole("slider", { name });
  // (for all holes; then this hole's own)
  await page.getByTestId("flyover-settings").getByRole("radio", { name: "All holes" }).click();
  await slider("Altitude").focus();
  await page.keyboard.press("End");
  await expect.poll(async () => (await course(page)).flyover?.height).toBe(250);
  await slider("Speed").focus();
  await page.keyboard.press("End");
  // (the lens: 15° zoomed in to 110° wide)
  await slider("Field of view").focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await course(page)).flyover?.fov).toBe(15);
  const after = await flight();
  expect(after.alt).toBeGreaterThan(before.alt + 150);
  expect(after.dur).toBeCloseTo(before.dur / 3, 1);
  expect(after.fov).toBe(15);
  // While it flies, the camera's field of view is the flight's; back to the tee view's once stopped
  await flyButton(page).click();
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.povCam.fov)).toBe(15);
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Play", { timeout: 120_000 });
  await teeBar(page).getByTestId("hud-stop").click();
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.povCam.fov)).toBe(62);
  // Each setting is one undo step
  await backToMap(page);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).flyover?.fov).toBeUndefined();
  expect((await course(page)).flyover?.height).toBe(250);
  // This hole's own: lower than the rest, kept for it only; back to the settings for all holes
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  await expect(page.getByTestId("flyover-settings")).toBeVisible();
  // (the 3D view rests while the settings change: drawn in software, its frames hold up the page)
  await page.evaluate(() => (window as any).__dgView.setPaused(true));
  await page.getByTestId("flyover-settings").getByRole("radio", { name: "This hole" }).click();
  await slider("Altitude").focus();
  await page.keyboard.press("Home");
  // (down to about eye level)
  await expect.poll(async () => (await course(page)).holes[0].flyover?.height, { timeout: 30_000 }).toBe(4);
  expect((await course(page)).flyover?.height).toBe(250);
  expect((await flight()).alt).toBeLessThan(after.alt - 150);
  // (from All holes: Apply to holes, hole 1 picked)
  await page.getByTestId("flyover-settings").getByRole("radio", { name: "All holes" }).click();
  // (Apply to holes is with what's on screen, folded at the bottom)
  await page.getByTestId("flyover-onscreen").locator("summary").click();
  await page.getByTestId("flyover-apply").getByRole("button", { name: "Apply to holes…" }).click();
  await page.getByTestId("apply-holes").getByRole("button", { name: "Hole 1" }).click();
  await page.getByTestId("apply-holes").getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await course(page)).holes[0].flyover).toBeUndefined();
});

test("flyover on-screen switches: off for all holes, back on for one; no disc flight lines anywhere", async ({ page }) => {
  await blankCourse(page);
  const h1 = await addHole(page, { x: 300, y: 500 }, { x: 800, y: 500 });
  const h2 = await addHole(page, { x: 300, y: 700 }, { x: 800, y: 700 });
  await page.keyboard.press("Escape");
  // All holes: the Camera settings from a tee
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  await expect(page.getByTestId("flyover-settings")).toBeVisible();
  await page.evaluate(() => (window as any).__dgView.setPaused(true));
  await page.getByTestId("flyover-settings").getByRole("radio", { name: "All holes" }).click();
  // (the switches folded at the bottom of the panel)
  await page.getByTestId("flyover-onscreen").locator("summary").click();
  const sw = (name: string) => page.getByTestId("flyover-settings").getByRole("checkbox", { name, exact: true });
  for (const name of ["Hole title at the start", "Hole number in the corner", "Distance to the pin", "Course name", "Throw line", "Putting circle", "OB", "Other holes", "Path to the next tee"]) await expect(sw(name)).toBeChecked();
  await sw("Distance to the pin").uncheck();
  await expect(sw("Disc flight")).toHaveCount(0);
  await sw("Other holes").uncheck();
  await expect.poll(async () => { const f = (await course(page)).flyover; return [f?.pinDistance, f?.otherHoles]; }).toEqual([false, false]);
  // One undo step each
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await course(page)).flyover?.otherHoles).toBeUndefined();
  await sw("Other holes").uncheck();
  // Hole 1's own: the distance back on for it
  await backToMap(page);
  await page.getByTestId("hole-row").first().click();
  // (the hole's switches, folded at the bottom of its Flyover panel)
  await page.getByTestId("hole-flight").getByTestId("flyover-onscreen").locator("summary").click();
  await expect(page.getByTestId("hole-flight").getByTestId("flyover-show")).toBeVisible();
  // (they start on All holes, as from the tee, until the hole has settings of its own)
  await page.getByTestId("hole-flight").getByRole("radio", { name: "This hole" }).click();
  const own = (name: string) => page.getByTestId("hole-flight").getByRole("checkbox", { name, exact: true });
  await expect(own("Distance to the pin")).not.toBeChecked();
  await own("Distance to the pin").check();
  await expect.poll(async () => (await course(page)).holes[0].flyover?.pinDistance).toBe(true);
  expect((await course(page)).flyover?.pinDistance).toBe(false);
  // Hole 1's own settings given to hole 2 (Apply to holes: All picks every other hole)
  const apply = page.getByTestId("hole-flight").getByTestId("flyover-apply");
  await apply.getByRole("button", { name: "Apply to holes…" }).click();
  await page.getByTestId("apply-holes").getByRole("button", { name: "All holes" }).click();
  await expect(page.getByTestId("apply-holes").getByRole("button", { name: "All holes" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("apply-holes").getByRole("button", { name: "Hole 2" })).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("apply-holes").getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await course(page)).holes[1].flyover?.pinDistance).toBe(true);
  await expect(page.getByTestId("apply-holes")).toHaveCount(0);
  // No disc flight lines anywhere: none in 3D, no switch for them
  await page.keyboard.press("Escape");
  await page.keyboard.press("3");
  expect(await page.evaluate(ids => ids.map(id => (window as any).__dgView.scene.getObjectByName(`arc:${id}`) ?? null), [h1.id, h2.id])).toEqual([null, null]);
  await page.getByTestId("scene-button").click();
  await expect(page.getByTestId("scene-panel").getByRole("checkbox", { name: "Disc flight lines" })).toHaveCount(0);
});

plain("the flyover's picture shows only what is switched on: the distance to the pin, the badge, the course's name", () => {
  const texts: string[] = [];
  const noop = () => {};
  const g = new Proxy({} as any, {
    get: (t, k) => (k === "fillText" ? (s: string) => texts.push(s) : k === "measureText" ? () => ({ width: 40 }) : k === "createLinearGradient" ? () => ({ addColorStop: noop }) : k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  const doc = { ...createEmptyCourse(), name: "Springfield Park" };
  const all = { title: true, badge: true, pinDistance: true, courseName: true };
  const title = { number: "1", name: "", par: "PAR 3", length: "300 FT", elevation: "", color: "#fff", ink: "#000", show: all };
  const info = { basket: { x: 600, y: 300 }, toBasket: 287 };
  drawOverlay(g, 1280, 720, title, 0, info, doc);
  plainExpect(texts.some(t => /287/.test(t))).toBe(true);
  plainExpect(texts).toContain("HOLE 1");
  plainExpect(texts).toContain("Springfield Park");
  texts.length = 0;
  drawOverlay(g, 1280, 720, { ...title, show: { ...all, pinDistance: false, badge: false, courseName: false } }, 0, info, doc);
  plainExpect(texts.some(t => /287/.test(t))).toBe(false);
  plainExpect(texts).not.toContain("HOLE 1");
  plainExpect(texts).not.toContain("Springfield Park");
  // The big title off: never drawn, and the distance shows from the start
  texts.length = 0;
  drawOverlay(g, 1280, 720, { ...title, show: { ...all, title: false } }, 1, info, doc);
  plainExpect(texts.some(t => /287/.test(t))).toBe(true);
  plainExpect(texts.filter(t => t === "HOLE 1")).toHaveLength(1);
  plainExpect(FLYOVER_DEFAULTS.pinDistance && FLYOVER_DEFAULTS.otherHoles).toBe(true);
});

/** A range slider set as if dragged there (and let go). */
const setRange = (loc: import("@playwright/test").Locator, v: number) =>
  loc.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, v);

test("a hole's own flight through keyframes: a timeline to pick and retime them, the picked one's card, a + on the map, and flown", async ({ page }) => {
  // (slow under software rendering: the view from the tee drawn frame by frame)
  test.setTimeout(240_000);
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("hole-flight").getByRole("radio", { name: "Custom" }).click();
  // Four to start from: the flight it flies by itself, each at the flyover's height (10 ft); none
  // selected yet
  await expect(page.getByTestId("fly-key")).toHaveCount(4);
  const keys = async () => (await course(page)).holes[0].flyKeys as any[];
  expect((await keys()).map(k => k.alt)).toEqual([10, 10, 10, 10]);
  expect((await keys())[0].x).toBeLessThan(300);
  await expect(page.locator('[data-handle="flykey"]')).toHaveCount(4);
  await expect(page.locator('[data-handle="flylook"]')).toHaveCount(4);
  await expect(page.locator('[data-handle="flyadd"]')).toHaveCount(3);
  await expect(page.getByTestId("fly-key-title")).toHaveText("No keyframe selected");
  await expect(page.locator('[data-handle="flykey"][data-on]')).toHaveCount(0);
  // Keyframe 2's camera dragged off to the side of the hole: it's the one picked now
  await drag(page, await handleCenter(page, "flykey", 1), await screenOf(page, 500, 450));
  await expect.poll(async () => Math.round((await keys())[1].y / 10)).toBe(45);
  await expect(page.getByTestId("fly-key-title")).toHaveText("Keyframe 2");
  await expect(page.locator('[data-handle="flykey"][data-on]')).toHaveAttribute("data-index", "1");
  // Its altitude under its card, one undo step
  const card = page.getByTestId("fly-key-card");
  const keyPart = page.getByTestId("fly-keys");
  const undo0 = await page.evaluate(() => (window as any).__dgHistory().past);
  await setRange(keyPart.getByRole("slider", { name: "Altitude" }), 120);
  await expect.poll(async () => (await keys())[1].alt).toBe(120);
  expect(await page.evaluate(() => (window as any).__dgHistory().past)).toBe(undo0 + 1);
  // The flight goes through keyframe 2, as high as it says
  const near = await page.evaluate(id => {
    const v = (window as any).__dgView;
    const f = v.flightPath(id);
    const k = v.doc.course.holes[0].flyKeys[1];
    let best = Infinity, alt = 0;
    for (const p of f.pts) {
      const d = Math.hypot(p.x - k.x, p.z - k.y);
      if (d < best) { best = d; alt = p.y - v.h(p.x, p.z); }
    }
    return { best, alt };
  }, hole.id);
  expect(near.best).toBeLessThan(5);
  expect(near.alt).toBeCloseTo(120, -1);
  // Keyframe 3 picked on the timeline; its Time set four seconds after keyframe 2 (the slider
  // starts half a second after it)
  await page.getByTestId("fly-key").nth(2).click();
  await expect(page.getByTestId("fly-key-title")).toHaveText("Keyframe 3");
  const time = keyPart.getByRole("slider", { name: "Time" });
  const after2 = Number(await time.getAttribute("min")) - 0.5;
  await setRange(time, Math.round((after2 + 4) * 10) / 10);
  await expect.poll(async () => (await keys())[2].secs).toBe(4);
  // Dragged later on the timeline: it comes later, and keyframe 4 still comes when it did
  const m3 = (await page.getByTestId("fly-key").nth(2).boundingBox())!;
  const before = await page.evaluate(() => {
    const v = (window as any).__dgView;
    return v.flightPath(v.doc.course.holes[0].id).dur;
  });
  await page.mouse.move(m3.x + m3.width / 2, m3.y + m3.height / 2);
  await page.mouse.down();
  await page.mouse.move(m3.x + m3.width / 2 + 25, m3.y + m3.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await keys())[2].secs).toBeGreaterThan(4);
  const after = await page.evaluate(() => {
    const v = (window as any).__dgView;
    return v.flightPath(v.doc.course.holes[0].id).dur;
  });
  expect(Math.abs(after - before)).toBeLessThan(0.15);
  // A + on the map between keyframes 1 and 2: a new keyframe 2, right on the flight that was there
  const path0 = await page.evaluate(id => (window as any).__dgView.flightPath(id).pts.map((p: any) => [p.x, p.y, p.z]), hole.id);
  await page.locator('[data-handle="flyadd"][data-index="0"]').click();
  await expect(page.getByTestId("fly-key")).toHaveCount(5);
  await expect(page.getByTestId("fly-key-title")).toHaveText("Keyframe 2");
  const k1 = (await keys())[1];
  const g = await page.evaluate(k => (window as any).__dgView.h(k.x, k.y), k1);
  const off = Math.min(...path0.map(([x, y, z]: number[]) => Math.hypot(x - k1.x, z - k1.y, y - (g + k1.alt))));
  expect(off).toBeLessThan(3);
  // Removed again from its card
  await card.getByRole("button", { name: "Delete keyframe 2" }).click();
  await expect(page.getByTestId("fly-key")).toHaveCount(4);
  // + Keyframe adds one after the picked one
  await page.getByTestId("fly-key").nth(1).click();
  await page.getByTestId("fly-key-add").click();
  await expect(page.getByTestId("fly-key")).toHaveCount(5);
  await expect(page.getByTestId("fly-key-title")).toHaveText("Keyframe 3");
  // Flown from the panel
  await page.getByTestId("fly-preview").click();
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Pause");
  // From the tee: paused, the keyframes on the bar's timeline, the same settings in the Flyover
  // panel, no Speed for the whole flight
  await flyButton(page).click();
  const tee = page.getByTestId("flyover-settings");
  await expect(teeBar(page).getByTestId("fly-key")).toHaveCount(5);
  await expect(tee.getByRole("slider", { name: "Speed" })).toHaveCount(0);
  // In 3D: back on the map, tilted, the hole picked with its cameras to drag
  await tee.getByTestId("fly-in-3d").click();
  await expect.poll(() => page.evaluate(() => (window as any).__dgEditor().view)).toBe("3d");
  expect(await page.evaluate(() => (window as any).__dgEditor().teeView)).toBeNull();
  await expect(page.locator('[data-handle="flykey"]')).toHaveCount(5);
  // Automatic again
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("hole-flight").getByRole("radio", { name: "Automatic" }).click();
  await expect.poll(async () => (await course(page)).holes[0].flyKeys).toBeUndefined();
  await expect(page.locator('[data-handle="flykey"]')).toHaveCount(0);
});

test("the camera flown by hand: the keys move it, a drag turns it, and each keyframe is just where it was and looks just where it looked", async ({ page }) => {
  // (slow under software rendering: the view from the tee drawn frame by frame)
  test.setTimeout(240_000);
  await blankCourse(page);
  const hole = await addHole(page, { x: 300, y: 600 }, { x: 800, y: 600 });
  await page.keyboard.press("Escape");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("hole-flight").getByTestId("fly-camera").click();
  await expect(page.getByTestId("camera-hud")).toBeVisible();
  // (no keyframes yet: no keyframe card)
  await expect(page.getByTestId("cam-key")).toHaveCount(0);
  const pose = () => page.evaluate(() => (window as any).__dgView.freeKey());
  const keys = async () => ((await course(page)).holes[0].flyKeys ?? []) as any[];
  // (from the tee, at eye height, looking down the hole)
  await expect.poll(async () => (await pose()) !== null).toBe(true);
  const p0 = await pose();
  expect(p0.alt).toBeGreaterThan(4);
  expect(p0.alt).toBeLessThan(8);
  const ahead = { x: p0.lookX - p0.x, y: p0.lookY - p0.y };
  const n = Math.hypot(ahead.x, ahead.y);
  // W held: forward, down the hole
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  const p1 = await pose();
  expect(((p1.x - p0.x) * ahead.x + (p1.y - p0.y) * ahead.y) / n).toBeGreaterThan(5);
  // Space held: up
  await page.keyboard.down(" ");
  await page.waitForTimeout(700);
  await page.keyboard.up(" ");
  const p2 = await pose();
  expect(p2.alt).toBeGreaterThan(p1.alt + 5);
  // Enter: keyframe 1, right there and looking there
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await keys()).length).toBe(1);
  const k0 = (await keys())[0];
  expect(Math.hypot(k0.x - p2.x, k0.y - p2.y)).toBeLessThan(0.5);
  expect(Math.abs(k0.alt - p2.alt)).toBeLessThan(0.5);
  await expect(page.getByTestId("cam-key")).toContainText("Keyframe 1 of 1");
  // A drag turns it; D moves it right; another keyframe
  const box = (await page.locator("main").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const turned = await pose();
  expect(Math.hypot(turned.lookX - k0.lookX, turned.lookY - k0.lookY)).toBeGreaterThan(10);
  await page.keyboard.down("d");
  await page.waitForTimeout(500);
  await page.keyboard.up("d");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await keys()).length).toBe(2);
  // The flight starts exactly at keyframe 1 and looks exactly where it looked
  const exact = await page.evaluate(id => {
    const v = (window as any).__dgView, k = v.doc.course.holes[0].flyKeys;
    const f = v.flightPath(id);
    const a = k[0], c = f.pts[0], l = f.look[0];
    return {
      at: Math.hypot(c.x - a.x, c.z - a.y, c.y - (v.h(a.x, a.y) + a.alt)),
      look: Math.hypot(l.x - a.lookX, l.z - a.lookY, l.y - (v.h(a.lookX, a.lookY) + (a.lookAlt ?? 3)))
    };
  }, hole.id);
  expect(exact.at).toBeLessThan(0.5);
  expect(exact.look).toBeLessThan(0.5);
  await expect(page.getByTestId("cam-play")).toBeEnabled();
  // Keyframe 1 again from its number, moved, and updated to where the camera is now
  await page.getByTestId("camera-bar").getByTestId("fly-key").first().click();
  await expect.poll(async () => Math.hypot((await pose()).x - k0.x, (await pose()).y - k0.y)).toBeLessThan(0.5);
  await expect(page.getByTestId("cam-update")).toBeDisabled();
  await page.keyboard.down("q");
  await page.waitForTimeout(400);
  await page.keyboard.up("q");
  await expect(page.getByTestId("cam-update")).toBeEnabled();
  await page.keyboard.press("u");
  await expect.poll(async () => (await keys())[0].alt).toBeLessThan(k0.alt - 2);
  // Played, stopped; Esc puts the camera away (standing on the tee), and again goes back to the map
  // with the hole still picked
  await page.getByTestId("cam-play").click();
  await expect(page.getByTestId("cam-play")).toHaveAttribute("aria-label", "Pause");
  await page.getByTestId("cam-play").click();
  await expect(page.getByTestId("cam-add")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("camera-hud")).toHaveCount(0);
  await expect(teeCard(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await editorState(page)).teeView).toBeNull();
  expect((await editorState(page)).selectedId).toBe(hole.id);
  // Double-clicking a camera on the map looks through it
  await page.locator('[data-handle="flykey"][data-index="1"]').dblclick();
  await expect(page.getByTestId("camera-hud")).toBeVisible();
  await expect(page.getByTestId("cam-key")).toContainText("Keyframe 2 of 2");
  // (Done: the camera put away, standing on the tee again)
  await page.getByTestId("camera-bar").getByTestId("bar-done").click();
  await expect(page.getByTestId("camera-hud")).toHaveCount(0);
  await expect(teeCard(page)).toBeVisible();
});

plain("the flight by itself: a low glide from behind the tee, under a crown over the line, round its trunk, over a bush, never bobbing (pure logic)", () => {
  const line = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
  const flat = () => 100;
  const open = autoFlight(line, FLYOVER_DEFAULTS, flat)!;
  plainExpect(open.cam[0].x).toBeCloseTo(-60, 5);
  // (a short hole flies for 6 seconds)
  plainExpect(open.dur).toBe(6);
  const at = (f: typeof open, x: number) => f.cam.reduce((a, c) => (Math.abs(c.x - x) < Math.abs(a.x - x) ? c : a));
  // Low over open ground: the height asked the whole way (10 ft by default)
  plainExpect(FLYOVER_DEFAULTS.height).toBe(10);
  for (const c of open.cam) plainExpect(Math.abs(c.z - 110)).toBeLessThan(0.2);
  // A big tree over the line at 200 ft (leaves from 30 to 70 ft up, its trunk on the line), a bush at 340 ft
  const trees = (p: { x: number; y: number }, reach: number) => {
    if (Math.hypot(p.x - 200, p.y) < reach + 25) return { base: 130, top: 170, trunks: Math.hypot(p.x - 200, p.y) < reach + 8 ? [{ x: 200, y: 0 }] : [] };
    if (Math.hypot(p.x - 340, p.y) < reach + 10) return { base: 100, top: 125, trunks: [] };
    return null;
  };
  const glide = autoFlight(line, FLYOVER_DEFAULTS, flat, trees)!;
  // Under the big tree's leaves, and off to the side of its trunk
  for (const c of glide.cam) if (Math.hypot(c.x - 200, c.y) < 26) plainExpect(c.z).toBeLessThanOrEqual(130 - 5 + 1e-6);
  plainExpect(Math.min(...glide.cam.map(c => Math.hypot(c.x - 200, c.y)))).toBeGreaterThan(4);
  // Over the bush (too low to pass under)
  plainExpect(at(glide, 340).z).toBeGreaterThan(125);
  // Never a sudden hop: at most half a foot up or down per foot along
  for (let i = 1; i < glide.cam.length; i++) plainExpect(Math.abs(glide.cam[i].z - glide.cam[i - 1].z)).toBeLessThanOrEqual(Math.hypot(glide.cam[i].x - glide.cam[i - 1].x, glide.cam[i].y - glide.cam[i - 1].y) * 0.5 + 1e-6);
  // To the right of the line (south, flying east), and twice as fast
  const side = autoFlight(line, { ...FLYOVER_DEFAULTS, side: 50, speed: 2 }, flat)!;
  plainExpect(at(side, 200).y).toBeCloseTo(50, 5);
  plainExpect(side.dur).toBeCloseTo(open.dur / 2, 5);
  // Over rolling ground it keeps its height over the ground (rising and falling with it)
  const bumpy = (x: number) => 100 + 8 * Math.sin(x / 20);
  const steady = autoFlight(line, FLYOVER_DEFAULTS, x => bumpy(x))!;
  for (const c of steady.cam) plainExpect(Math.abs(c.z - bumpy(c.x) - 10)).toBeLessThan(2);
});

test("a hole cut through woods is flown at its height down the fairway, between the woods' own trees", async ({ page }) => {
  const doc = createEmptyCourse();
  const h = newHole({ fairwayWidth: 40 });
  doc.holes.push(h);
  doc.items.push(createTee(h.id, { x: 250, y: 500 }, "blue"), createBasket(h.id, { x: 650, y: 470 }));
  // (the woods drawn over the whole hole: its trees stand either side of the fairway)
  doc.items.push(createArea("woods", [{ x: 150, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 700 }, { x: 150, y: 700 }]));
  await page.getByLabel("Open course file").setInputFiles({ name: "woods.dgcourse.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await expect.poll(() => page.evaluate(() => (window as any).__dgCourse().holes.length), { timeout: 30_000 }).toBe(1);
  const above = () => page.evaluate(() => {
    const v = (window as any).__dgView;
    const path = v.flightPath((window as any).__dgCourse().holes[0].id);
    return path.pts.map((q: any) => q.y - v.h(q.x, q.z));
  });
  await expect.poll(async () => (await above()).length).toBeGreaterThan(30);
  for (const a of await above()) {
    expect(a).toBeGreaterThan(9);
    expect(a).toBeLessThan(11);
  }
});

test("woods with few corners stand where their curve bulges past the corners (flyovers go over them there)", async ({ page }) => {
  await blankCourse(page);
  await page.evaluate(() => {
    (window as any).__dgEditor().set({ areaKind: "woods" });
    (window as any).__dgActions.addDrawn("area", [{ x: 300, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 700 }, { x: 300, y: 700 }]);
  });
  // 42 ft out from the middle of a side: inside the curve drawn, beyond the corners' square
  const top = (y: number) => page.evaluate(y => (window as any).__dgView.canopyAt({ x: 500, y }, 4)?.top ?? null, y);
  await expect.poll(() => top(258)).toBeGreaterThan(50);
  expect(await top(200)).toBeNull();
});

plain("the flight round the trees standing there: at its height through woods, aside round a pine on the line, a little under a low crown, over a wall it can't get round, from past trees behind the tee (pure logic)", () => {
  const line = [{ x: 0, y: 0 }, { x: 600, y: 0 }];
  const flat = () => 0;
  type C = { x: number; y: number; r: number; base: number; top: number };
  const standing = (crowns: C[]) => (p: { x: number; y: number }, reach: number) => {
    const near = crowns.filter(c => Math.hypot(c.x - p.x, c.y - p.y) < reach + c.r);
    const trunks = crowns.filter(c => Math.hypot(c.x - p.x, c.y - p.y) < reach + 8).map(c => ({ x: c.x, y: c.y }));
    if (!near.length && !trunks.length) return null;
    return { base: Math.min(...near.map(c => c.base)), top: Math.max(-Infinity, ...near.map(c => c.top)), trunks, crowns: near };
  };
  // Woods on both sides of a 70 ft fairway: broadleaf crowns and pines down to the ground
  const woods: C[] = [];
  for (let x = 0; x <= 600; x += 22) for (const side of [-1, 1]) {
    woods.push({ x, y: side * 48, r: 18, base: 15, top: 55 });
    woods.push({ x: x + 11, y: side * 40, r: 8, base: 4, top: 45 });
  }
  const through = autoFlight(line, FLYOVER_DEFAULTS, flat, standing(woods))!;
  for (const c of through.cam) plainExpect(Math.abs(c.z - 10)).toBeLessThan(0.5);
  // A pine on the line: round it at its height, never more than 15 ft aside
  const pine = { x: 300, y: 0, r: 8, base: 3, top: 45 };
  const round = autoFlight(line, FLYOVER_DEFAULTS, flat, standing([pine]))!;
  for (const c of round.cam) {
    plainExpect(Math.abs(c.z - 10)).toBeLessThan(0.5);
    plainExpect(Math.hypot(c.x - 300, c.y)).toBeGreaterThanOrEqual(pine.r + 4);
    plainExpect(Math.abs(c.y)).toBeLessThanOrEqual(15.01);
  }
  // A broad crown hanging low over the line: just under its leaves, then back to its height
  const low = autoFlight(line, FLYOVER_DEFAULTS, flat, standing([{ x: 200, y: 0, r: 20, base: 13, top: 60 }]))!;
  const by = (f: typeof low, x: number) => f.cam.reduce((a, c) => (Math.abs(c.x - x) < Math.abs(a.x - x) ? c : a));
  plainExpect(by(low, 200).z).toBeLessThanOrEqual(8 + 1e-6);
  plainExpect(Math.abs(by(low, 300).z - 10)).toBeLessThan(0.3);
  // A wall of pines across the line, wider than it can go round: over it, and down again after
  const wall: C[] = [];
  for (let y = -80; y <= 80; y += 12) wall.push({ x: 320, y, r: 8, base: 3, top: 40 });
  const over = autoFlight(line, FLYOVER_DEFAULTS, flat, standing(wall))!;
  plainExpect(by(over, 320).z).toBeGreaterThanOrEqual(48 - 1e-6);
  plainExpect(Math.abs(over.cam[0].z - 10)).toBeLessThan(0.3);
  plainExpect(Math.abs(over.cam[over.cam.length - 1].z - 10)).toBeLessThan(0.3);
  // Pines just behind the tee: it starts past them, at its height
  const behind = autoFlight(line, FLYOVER_DEFAULTS, flat, standing([{ x: -40, y: 0, r: 8, base: 3, top: 40 }, { x: -40, y: 14, r: 8, base: 3, top: 40 }, { x: -40, y: -14, r: 8, base: 3, top: 40 }]))!;
  plainExpect(behind.cam[0].x).toBeGreaterThan(-40 + 8);
  plainExpect(Math.abs(behind.cam[0].z - 10)).toBeLessThan(0.3);
});

plain("a flight through keyframes goes exactly where they say, never into the ground, and never around trees by itself (pure logic)", () => {
  const bumpy = (x: number) => 100 + 8 * Math.sin(x / 20);
  const keys = [{ x: 0, y: 0, alt: 10, lookX: 100, lookY: 0 }, { x: 200, y: 0, alt: 10, lookX: 300, lookY: 0 }, { x: 400, y: 0, alt: 10, lookX: 500, lookY: 0 }];
  const f = keyFlight(keys, FLYOVER_DEFAULTS, x => bumpy(x))!;
  // (at each keyframe: its spot, as high over the ground as it says)
  for (const k of keys) {
    const c = f.cam.reduce((a, q) => (Math.hypot(q.x - k.x, q.y - k.y) < Math.hypot(a.x - k.x, a.y - k.y) ? q : a));
    plainExpect(Math.abs(c.x - k.x)).toBeLessThan(1.5);
    plainExpect(Math.abs(c.z - bumpy(k.x) - k.alt)).toBeLessThan(0.6);
  }
  // (between them, never under the ground)
  for (const c of f.cam) plainExpect(c.z).toBeGreaterThanOrEqual(bumpy(c.x) + 4 - 1e-6);
  // A wall of trees between two keyframes: the same flight (what's set is what flies)
  const wall = (p: { x: number; y: number }, reach: number) => (Math.abs(p.x - 300) < reach + 8 ? { base: 103, top: 140, trunks: [] } : null);
  const g = keyFlight(keys, FLYOVER_DEFAULTS, x => bumpy(x), wall)!;
  plainExpect(g.cam).toEqual(f.cam);
});

plain("a flight never jolts: round the trees by itself, and through keyframes at their own speeds (pure logic)", () => {
  const flat = () => 0;
  type C = { x: number; y: number; r: number; base: number; top: number };
  const crowns: C[] = [];
  for (let x = 0; x <= 600; x += 22) for (const side of [-1, 1]) crowns.push({ x, y: side * (44 + (x % 3) * 4), r: 12 + (x % 5), base: 6 + (x % 4) * 3, top: 50 });
  crowns.push({ x: 150, y: 4, r: 8, base: 3, top: 40 }, { x: 300, y: -6, r: 16, base: 14, top: 50 }, { x: 450, y: 30, r: 14, base: 4, top: 45 });
  const trees = (p: { x: number; y: number }, reach: number) => {
    const near = crowns.filter(c => Math.hypot(c.x - p.x, c.y - p.y) < reach + c.r);
    const trunks = crowns.filter(c => Math.hypot(c.x - p.x, c.y - p.y) < reach + 8).map(c => ({ x: c.x, y: c.y }));
    return near.length || trunks.length ? { base: Math.min(...near.map(c => c.base)), top: Math.max(-Infinity, ...near.map(c => c.top)), trunks, crowns: near } : null;
  };
  // Played as the map view plays it (30 frames a second, eased in and out, on a curve through its points):
  // how hard it's thrown sideways or up and down (ft/s²) and how suddenly its view starts or stops turning (°/s²)
  const jolts = (f: NonNullable<ReturnType<typeof autoFlight>>, easeIn: boolean) => {
    const clock = flightClock(f.dur, easeIn);
    const curve = (a: { x: number; y: number; z: number }[], e: number) => {
      const idx = e * (a.length - 1), i = Math.min(a.length - 2, Math.floor(idx)), u = idx - i;
      const [p0, p1, p2, p3] = [a[Math.max(0, i - 1)], a[i], a[i + 1], a[Math.min(a.length - 1, i + 2)]];
      const c = (k: "x" | "y" | "z") => p1[k] + 0.5 * u * (p2[k] - p0[k] + u * (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k] + u * (3 * (p1[k] - p2[k]) + p3[k] - p0[k])));
      return [c("x"), c("y"), c("z")];
    };
    const frames: { p: number[]; d: number[] }[] = [];
    for (let t = 0; t <= clock.play; t += 1 / 30) {
      const e = clock.at(t) / f.dur, p = curve(f.cam, e), l = curve(f.look, e);
      const d = l.map((v, i) => v - p[i]), n = Math.hypot(...d);
      frames.push({ p, d: d.map(v => v / n) });
    }
    let side = 0, turn = 0;
    const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    for (let k = 2; k < frames.length; k++) {
      const v1 = frames[k - 1].p.map((v, i) => (v - frames[k - 2].p[i]) * 30), v2 = frames[k].p.map((v, i) => (v - frames[k - 1].p[i]) * 30);
      const a = v2.map((v, i) => (v - v1[i]) * 30), sp = Math.hypot(...v2);
      if (sp < 1) continue;
      const along = a.reduce((s, x, i) => s + (x * v2[i]) / sp, 0);
      side = Math.max(side, Math.hypot(...a.map((x, i) => x - (along * v2[i]) / sp)));
      turn = Math.max(turn, Math.abs(angle(frames[k].d, frames[k - 1].d) - angle(frames[k - 1].d, frames[k - 2].d)) * 900 * 180 / Math.PI);
    }
    return { side, turn };
  };
  const auto = jolts(autoFlight([{ x: 0, y: 0 }, { x: 600, y: 0 }], FLYOVER_DEFAULTS, flat, trees)!, true);
  plainExpect(auto.side).toBeLessThan(80);
  plainExpect(auto.turn).toBeLessThan(25);
  // Through keyframes, each stretch at its own speed (faster, slower, faster)
  const keys = [{ x: -40, y: 0, alt: 10, lookX: 120, lookY: 10 }, { x: 150, y: 15, alt: 12, lookX: 320, lookY: 20, secs: 2 }, { x: 300, y: 25, alt: 9, lookX: 450, lookY: 5, secs: 4 }, { x: 560, y: 5, alt: 10, lookX: 620, lookY: 0, secs: 2.5 }];
  for (const obstacles of [undefined, trees]) {
    const by = jolts(keyFlight(keys, FLYOVER_DEFAULTS, flat, obstacles)!, false);
    plainExpect(by.side).toBeLessThan(80);
    plainExpect(by.turn).toBeLessThan(25);
  }
});

plain("a flight through keyframes: through each one on its seconds, the field of view between them (pure logic)", () => {
  const flat = () => 0;
  const keys = [
    { x: 0, y: 0, alt: 50, lookX: 100, lookY: 0 },
    { x: 100, y: 50, alt: 80, lookX: 200, lookY: 0, fov: 40, secs: 2 },
    { x: 200, y: 0, alt: 30, lookX: 300, lookY: 0, secs: 3 }
  ];
  const f = keyFlight(keys, FLYOVER_DEFAULTS, flat)!;
  plainExpect(f.dur).toBe(5);
  const at = (t: number) => f.cam[Math.round((t / f.dur) * (f.cam.length - 1))];
  plainExpect(at(0)).toEqual({ x: 0, y: 0, z: 50 });
  plainExpect(at(2).x).toBeCloseTo(100, 0);
  plainExpect(at(2).y).toBeCloseTo(50, 0);
  plainExpect(at(2).z).toBeCloseTo(80, 0);
  plainExpect(at(5)).toEqual({ x: 200, y: 0, z: 30 });
  plainExpect(f.fov[0]).toBe(62);
  plainExpect(f.fov[Math.round((2 / 5) * (f.fov.length - 1))]).toBeCloseTo(40, 0);
  // Starting keyframes from a flight, and one between two
  const from = keysFromFlight(f, flat, 3);
  plainExpect(from.map(k => Math.round(k.x))).toEqual([0, Math.round(f.cam[Math.round((f.cam.length - 1) / 2)].x), 200]);
  plainExpect(keyBetween(keys[0], keys[2])).toEqual({ x: 100, y: 0, alt: 40, lookX: 200, lookY: 0 });
  // At the flyover's height, but over woods (no room under them) and under a tall tree's crown
  const woods = (p: { x: number }) => (p.x > 180 ? { base: 0, top: 45, trunks: [] } : p.x < 20 ? { base: 40, top: 70, trunks: [] } : null);
  const level = keysFromFlight(f, flat, 3, 10, woods);
  plainExpect(level.map(k => k.alt)).toEqual([10, 10, 45 + 5 + 3]);
  const low = keysFromFlight(f, flat, 3, 38, woods);
  plainExpect(low.map(k => k.alt)).toEqual([35, 38, 53]);
});

plain("a keyframe added between two lands on the flight as it was, and the two halves take the time the whole did (pure logic)", () => {
  const flat = () => 100;
  const keys = [{ x: 0, y: 0, alt: 20, lookX: 100, lookY: 0 }, { x: 200, y: 50, alt: 60, lookX: 300, lookY: 50 }, { x: 400, y: 0, alt: 30, lookX: 500, lookY: 0 }];
  const f0 = keyFlight(keys, FLYOVER_DEFAULTS, flat)!;
  const r = insertKey(keys, 0, FLYOVER_DEFAULTS, flat);
  plainExpect(r.at).toBe(1);
  plainExpect(r.keys).toHaveLength(4);
  const t0 = keyTimes(keys, FLYOVER_DEFAULTS, flat), t1 = keyTimes(r.keys, FLYOVER_DEFAULTS, flat);
  plainExpect(Math.abs(t1[2] - t0[1])).toBeLessThan(0.11);
  const k = r.keys[1];
  const off = Math.min(...f0.cam.map(c => Math.hypot(c.x - k.x, c.y - k.y, c.z - (100 + k.alt))));
  plainExpect(off).toBeLessThan(1.5);
  // (after the last: carried on the way it was going)
  const e = insertKey(keys, 2, FLYOVER_DEFAULTS, flat);
  plainExpect(e.at).toBe(3);
  plainExpect(e.keys[3].x).toBe(600);
});

plain("a flight through keyframes saved while Speed and Lens applied to it flies as it did: its seconds and lens written into its keyframes, once (pure logic)", () => {
  const k = (x: number, secs?: number, fov?: number) => ({ x, y: 0, alt: 20, lookX: x + 50, lookY: 0, ...(secs ? { secs } : {}), ...(fov ? { fov } : {}) });
  const hole = { ...newHole(), flyKeys: [k(0), k(140, 6), k(280, undefined, 40)] };
  const doc = normalizeCourse({ ...createEmptyCourse(), flyover: { ...FLYOVER_DEFAULTS, speed: 2, fov: 70 }, holes: [hole] });
  const keys = doc.holes[0].flyKeys!;
  // (6 s at speed 2: 3 s; none of its own, at the pace by itself: 140 ft in 3.2 s, at speed 2 in 1.6)
  plainExpect(keys.map(x => x.secs)).toEqual([undefined, 3, 1.6]);
  plainExpect(keys.map(x => x.fov)).toEqual([70, 70, 40]);
  plainExpect(doc.holes[0].flyover?.speed).toBe(1);
  // (opened again: nothing more changes; Speed no longer times keyframes)
  plainExpect(normalizeCourse(doc).holes[0].flyKeys).toEqual(keys);
  plainExpect(keyTimes(keys, { ...FLYOVER_DEFAULTS, speed: 3 }, () => 0)).toEqual(keyTimes(keys, FLYOVER_DEFAULTS, () => 0));
});
