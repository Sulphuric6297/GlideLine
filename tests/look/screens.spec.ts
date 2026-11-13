// `npm run look`: screenshots of the main screens into look/, to see the real UI (not assertions).
import { test, expect, importSite, addHole, course, handleCenter, drag, longPress, tapPlan } from "../e2e/fixtures";
import { devices, type Page } from "@playwright/test";

const shot = (page: Page, name: string) => page.screenshot({ path: `look/${name}.png` });

/** A nine-hole course on the imported site, with OB, a mando, a drop zone, a bench and a parking sign. */
export async function seedCourse(page: Page) {
  await page.evaluate(() => {
    const a = (window as any).__dgActions;
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    const holes: [number, number, number, number][] = [
      [0.32, 0.86, 0.22, 0.62], [0.2, 0.56, 0.12, 0.3], [0.16, 0.24, 0.42, 0.14], [0.47, 0.12, 0.72, 0.2], [0.76, 0.24, 0.9, 0.48],
      [0.88, 0.54, 0.7, 0.62], [0.66, 0.66, 0.6, 0.88], [0.56, 0.9, 0.46, 0.66], [0.42, 0.62, 0.38, 0.4]
    ];
    holes.forEach(([tx, ty, bx, by]) => a.addHole({ x: tx * W, y: ty * H }, { x: bx * W, y: by * H }, "blue"));
    const s = (window as any).__dgEditor();
    s.set({ areaKind: "ob" });
    a.addDrawn("area", [{ x: 0.5 * W, y: 0.3 * H }, { x: 0.62 * W, y: 0.28 * H }, { x: 0.64 * W, y: 0.4 * H }, { x: 0.52 * W, y: 0.42 * H }]);
    s.set({ lineKind: "ob" });
    a.addDrawn("line", [{ x: 0.95 * W, y: 0.3 * H }, { x: 0.95 * W, y: 0.7 * H }]);
    s.set({ areaKind: "hazard" });
    a.addDrawn("area", [{ x: 0.66 * W, y: 0.7 * H }, { x: 0.72 * W, y: 0.72 * H }, { x: 0.7 * W, y: 0.8 * H }, { x: 0.64 * W, y: 0.78 * H }]);
    s.set({ lineKind: "stream" });
    a.addDrawn("line", [{ x: 0.05 * W, y: 0.97 * H }, { x: 0.2 * W, y: 0.9 * H }, { x: 0.35 * W, y: 0.95 * H }, { x: 0.52 * W, y: 0.86 * H }, { x: 0.64 * W, y: 0.9 * H }, { x: 0.8 * W, y: 0.8 * H }, { x: 0.86 * W, y: 0.6 * H }, { x: 0.83 * W, y: 0.35 * H }, { x: 0.9 * W, y: 0.05 * H }]);
    s.set({ lineKind: "path" });
    a.addDrawn("line", [{ x: 0.24 * W, y: 0.64 * H }, { x: 0.22 * W, y: 0.58 * H }]);
    a.addDrawn("line", [{ x: 0.74 * W, y: 0.2 * H }, { x: 0.76 * W, y: 0.24 * H }]);
    s.set({ areaKind: "woods" });
    a.addDrawn("area", [{ x: 0.02 * W, y: 0.02 * H }, { x: 0.12 * W, y: 0.04 * H }, { x: 0.1 * W, y: 0.18 * H }, { x: 0.03 * W, y: 0.2 * H }]);
    a.select(d.holes[0]?.id ?? null);
    const d2 = (window as any).__dgCourse();
    s.set({ activeHoleId: d2.holes[3].id });
    a.placeAt("add-mando", { x: 0.6 * W, y: 0.15 * H });
    a.placeAt("add-dropzone", { x: 0.55 * W, y: 0.2 * H });
    s.set({ amenityKind: "bench" });
    a.placeAt("add-amenity", { x: 0.36 * W, y: 0.9 * H });
    s.set({ amenityKind: "parking" });
    a.placeAt("add-amenity", { x: 0.3 * W, y: 0.95 * H });
    a.select(null);
    s.set({ tool: "select", activeHoleId: null });
  });
}

test("start", async ({ page }) => {
  await shot(page, "01-start");
});

test("site and holes", async ({ page }) => {
  await importSite(page);
  await page.waitForTimeout(1500);
  await shot(page, "02-site");
  const doc = await course(page);
  const w = doc.canvas.width, h = doc.canvas.height;
  await addHole(page, { x: w * 0.3, y: h * 0.7 }, { x: w * 0.45, y: h * 0.45 });
  await addHole(page, { x: w * 0.5, y: h * 0.4 }, { x: w * 0.7, y: h * 0.25 });
  await addHole(page, { x: w * 0.72, y: h * 0.3 }, { x: w * 0.8, y: h * 0.65 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await shot(page, "03-holes");
  await page.keyboard.press("3");
  await page.waitForTimeout(1500);
  await shot(page, "04-3d");
  await page.getByTestId("hole-row").first().click();
  await page.waitForTimeout(1200);
  await shot(page, "05-hole-selected");
  await page.getByTestId("tee-view").click();
  await page.waitForTimeout(1500);
  await shot(page, "06-tee-view");
  await expect(page.getByTestId("tee-view-hud")).toBeVisible();
});

test("course design and export", async ({ page }) => {
  test.setTimeout(300_000);
  await importSite(page);
  await seedCourse(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "4 Review" }).click();
  await page.waitForTimeout(1000);
  await shot(page, "07-review");
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.waitForTimeout(2500);
  await shot(page, "08-design-forest-photo");
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(2000);
  await shot(page, "08-design-forest");
  await page.getByTestId("best-rotation").click();
  await page.waitForTimeout(2000);
  await shot(page, "08-design-forest-turned");
  await page.getByRole("button", { name: "North up" }).click();
  for (const t of ["park", "pines", "dry", "autumn", "desert", "woods"]) {
    await page.getByTestId(`style-${t}`).click();
    await page.waitForTimeout(2500);
    await shot(page, `09-design-${t}`);
  }
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.getByRole("tab", { name: "Tee sign" }).click();
  await page.waitForTimeout(2000);
  await shot(page, "10-tee-sign");
  await page.getByLabel("Hole for the tee sign").selectOption({ index: 6 });
  await page.waitForTimeout(1500);
  await shot(page, "10-tee-sign-7");
  await page.getByLabel("Tee sign size").selectOption("12x18");
  await page.waitForTimeout(1500);
  await shot(page, "10-tee-sign-tall");
  await page.getByRole("tab", { name: "Scorecard" }).click();
  await page.waitForTimeout(800);
  await shot(page, "11-scorecard");
  await page.getByRole("tab", { name: "Hole page" }).click();
  await page.getByLabel("Hole for the hole page").selectOption({ index: 3 });
  await page.waitForTimeout(2000);
  await shot(page, "10-hole-page");
  await page.getByTestId("design-page").screenshot({ path: "look/10-hole-page-close.png" });
  for (const size of ["square", "card"]) {
    await page.getByLabel("Hole page size").selectOption(size);
    await page.waitForTimeout(1500);
    await page.getByTestId("design-page").screenshot({ path: `look/10-hole-page-${size}.png` });
  }
  await page.getByRole("button", { name: "6 Export" }).click();
  await page.waitForTimeout(800);
  await shot(page, "12-export");
  await page.getByTestId("export-thing-video").getByRole("button").first().click();
  await page.waitForTimeout(1500);
  await shot(page, "12-export-holes-video");
  // Recording (small, so it is quick), seen from another step and from the Export step
  await page.evaluate(() => (window as any).__dgVideo().set({ size: { width: 320, height: 180 } }));
  await page.getByTestId("video-record").click();
  await expect(page.getByTestId("video-progress")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId("export-thing-video").screenshot({ path: "look/12-export-recording.png" });
  await page.getByRole("button", { name: "4 Review" }).click();
  await page.waitForTimeout(800);
  await shot(page, "12-recording-elsewhere");
  await page.getByTestId("export-progress-cancel").click();
});

test("flyover video frames", async ({ page }) => {
  test.setTimeout(300_000);
  await importSite(page);
  await seedCourse(page);
  // A short video of hole 4, played back in the page and looked at a few moments in
  await page.evaluate(async () => {
    const w = window as any;
    const id = w.__dgCourse().holes[3].id;
    const video = await w.__dgView.recordFlyover([id], { width: 640, height: 360, fps: 30 });
    const v = document.createElement("video");
    v.muted = true;
    v.src = URL.createObjectURL(video.blob);
    v.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;z-index:9999;background:#000";
    v.setAttribute("data-testid", "look-video");
    document.body.appendChild(v);
    await new Promise(r => (v.onloadeddata = r));
  });
  for (const [t, name] of [[0.3, "a-title"], [2.5, "b-flight"], [6.5, "c-basket"]] as const) {
    await page.evaluate(async t => {
      const v = document.querySelector("[data-testid=look-video]") as HTMLVideoElement;
      v.currentTime = t;
      await new Promise(r => (v.onseeked = r));
    }, t);
    await page.waitForTimeout(300);
    await page.getByTestId("look-video").screenshot({ path: `look/17-video-${name}.png` });
  }
});

test("forest map close up", async ({ page }) => {
  await importSite(page);
  await seedCourse(page);
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(2500);
  await page.getByTestId("design-page").screenshot({ path: "look/13-forest-page.png" });
  // Twice as big: the treetops, trails and creek up close
  const bar = page.getByRole("button", { name: "Fit the page" }).locator("..");
  for (let i = 0; i < 3; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(800);
  await shot(page, "13-forest-zoom");
  // Contour lines painted in (under the treetops)
  await page.getByLabel("Contour lines").check();
  await page.waitForTimeout(2500);
  await shot(page, "13-forest-contours-zoom");
  await page.getByRole("button", { name: "Fit the page" }).click();
  await page.waitForTimeout(800);
  await page.getByTestId("design-page").screenshot({ path: "look/13-forest-contours.png" });
  await page.getByLabel("Contour lines").uncheck();
  for (let i = 0; i < 3; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  // Different light: a low sun from the right, deep shadows
  await page.getByRole("button", { name: "Fit the page" }).click();
  for (const [label, v] of [["Sun from the", "90"], ["Sun height", "18"], ["Shadows", "1"]] as const) {
    const sl = page.getByLabel(label);
    await sl.fill(v);
    await sl.dispatchEvent("pointerup");
  }
  await page.waitForTimeout(3500);
  await page.getByTestId("design-page").screenshot({ path: "look/13-forest-light.png" });
  await page.getByTestId("light-shadow").screenshot({ path: "look/13-light-panel.png" });
  await page.getByTestId("forest-options").getByRole("radio", { name: "From the photo" }).click();
  await page.getByRole("button", { name: "Fit the page" }).click();
  await page.waitForTimeout(2500);
  await page.getByTestId("design-page").screenshot({ path: "look/13-forest-page-photo.png" });
});

test("basket marks", async ({ page }) => {
  await importSite(page);
  await seedCourse(page);
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(2500);
  const bar = page.getByRole("button", { name: "Fit the page" }).locator("..");
  for (let i = 0; i < 4; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(800);
  for (const mark of ["basket", "badge", "flag", "target", "number"]) {
    await page.getByTestId(`basket-mark-${mark}`).click();
    await page.waitForTimeout(600);
    await shot(page, `15-basket-${mark}`);
  }
  await page.getByTestId("basket-mark-basket").scrollIntoViewIfNeeded();
  await page.getByRole("radiogroup", { name: "Basket marks" }).locator("..").screenshot({ path: "look/15-basket-picker.png" });
});

test("features close up", async ({ page }) => {
  await importSite(page);
  await seedCourse(page);
  await page.evaluate(() => {
    const w = window as any, a = w.__dgActions, d = w.__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    // A gate on hole 6
    w.__dgEditor().set({ mandoKind: "gate", activeHoleId: d.holes[5].id });
    a.placeAt("add-mando", { x: 0.79 * W, y: 0.58 * H });
    w.__dgEditor().set({ mandoKind: "single", activeHoleId: null });
    for (const [kind, x, y] of [["restroom", 0.26, 0.86], ["trash", 0.4, 0.84], ["water", 0.27, 0.8], ["kiosk", 0.33, 0.82], ["here", 0.38, 0.92], ["firstaid", 0.22, 0.88], ["picnic", 0.44, 0.9]] as const) {
      w.__dgEditor().set({ amenityKind: kind });
      a.placeAt("add-amenity", { x: x * W, y: y * H });
    }
    a.select(null);
  });
  // The road is OB (picked in its inspector)
  await page.getByRole("button", { name: "3 Features" }).click();
  const roadId = await page.evaluate(() => (window as any).__dgCourse().items.find((i: any) => i.type === "line" && i.kind === "road")?.id);
  await page.evaluate(id => (window as any).__dgActions.select(id), roadId);
  await page.getByRole("radiogroup", { name: "Out of bounds" }).getByRole("radio", { name: "OB, red edge" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "2 Holes" }).click();
  await page.getByTestId("hole-row").nth(1).click();
  await page.getByTestId("ob-left").click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "3 Features" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "16-features");
  await page.evaluate(() => {
    const d = (window as any).__dgCourse();
    (window as any).__dgView.fitHole(d.holes[3].id);
  });
  await page.waitForTimeout(1500);
  await shot(page, "16-features-zoom");
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(2500);
  await page.getByTestId("design-page").screenshot({ path: "look/16-print-forest.png" });
});

test("3d scene: sky, grass and trees", async ({ page }) => {
  test.setTimeout(240_000);
  await importSite(page);
  await seedCourse(page);
  await page.evaluate(() => {
    (window as any).__dgEditor().set({ grass: 2, areaKind: "rough" });
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    (window as any).__dgActions.addDrawn("area", [{ x: 0.33 * W, y: 0.8 * H }, { x: 0.4 * W, y: 0.78 * H }, { x: 0.42 * W, y: 0.86 * H }, { x: 0.35 * W, y: 0.9 * H }]);
    (window as any).__dgEditor().set({ tool: "select" });
  });
  await page.keyboard.press("3");
  await page.waitForTimeout(2000);
  await shot(page, "17-3d-overview");
  // Down low over the first hole's fairway
  await page.evaluate(() => {
    const v = (window as any).__dgView;
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    const tx = 0.3 * W, ty = 0.8 * H;
    const h = (x: number, y: number) => v.groundHeight?.(x, y) ?? 0;
    void v.controls.setLookAt(tx + 30, h(tx, ty) + 18, ty + 60, 0.24 * W, h(0.24 * W, 0.66 * H) + 4, 0.66 * H, false);
  });
  await page.waitForTimeout(2500);
  await shot(page, "17-3d-low");
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  await page.waitForTimeout(2500);
  await shot(page, "17-tee-grass");
  // Looking right, at the tall grass beside the tee
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const v = (window as any).__dgView;
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    const ex = 0.3 * W, ey = 0.88 * H;
    void v.controls.setLookAt(ex, v.groundHeight(ex, ey) + 6, ey, 0.37 * W, v.groundHeight(0.37 * W, 0.84 * H) + 1, 0.84 * H, false);
  });
  await page.waitForTimeout(2500);
  await shot(page, "17-tall-grass");
});

test("landscapes and marking colors", async ({ page }) => {
  test.setTimeout(300_000);
  await importSite(page);
  await seedCourse(page);
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(2000);
  await page.getByTestId("landscapes").screenshot({ path: "look/18-landscape-picker.png" });
  for (const id of ["autumn", "desert", "pines", "park"]) {
    await page.getByTestId(`landscape-${id}`).click();
    await page.waitForTimeout(2500);
    await page.getByTestId("design-page").screenshot({ path: `look/18-landscape-${id}.png` });
  }
  // PDGA marking colors on the painted map
  await page.getByTestId("landscape-woods").click();
  await page.getByTestId("markings-pdga").click();
  await page.waitForTimeout(2500);
  await page.getByTestId("design-page").screenshot({ path: "look/18-markings-pdga.png" });
  // Pines in 3D
  await page.getByTestId("landscape-pines").click();
  await page.evaluate(() => {
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    (window as any).__dgEditor().set({ areaKind: "woods" });
    (window as any).__dgActions.addDrawn("area", [{ x: 0.42 * W, y: 0.45 * H }, { x: 0.6 * W, y: 0.45 * H }, { x: 0.6 * W, y: 0.6 * H }, { x: 0.42 * W, y: 0.6 * H }]);
    (window as any).__dgEditor().set({ tool: "select", step: "holes" });
  });
  await page.keyboard.press("3");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const v = (window as any).__dgView;
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    const ex = 0.51 * W, ey = 0.75 * H, tx = 0.51 * W, ty = 0.55 * H;
    void v.controls.setLookAt(ex, v.groundHeight(ex, ey) + 30, ey, tx, v.groundHeight(tx, ty) + 25, ty, false);
  });
  await page.waitForTimeout(4000);
  await shot(page, "18-pines-3d");
});

/** Built things round holes 7 and 8: a bridge over the creek in front of hole 8's tee, a
 * boardwalk, stairs, a wall, a clubhouse, a picnic shelter and a tee deck. */
export async function seedStructures(page: Page) {
  return page.evaluate(() => {
    const w = window as any, a = w.__dgActions, d = w.__dgCourse(), s = w.__dgEditor();
    const W = d.canvas.width, H = d.canvas.height;
    const at = (fx: number, fy: number) => ({ x: fx * W, y: fy * H });
    const rect = (c: { x: number; y: number }, len: number, wid: number, deg: number) => {
      const r = (deg * Math.PI) / 180, u = { x: Math.cos(r), y: Math.sin(r) }, v = { x: -u.y, y: u.x };
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + u.x * i * len / 2 + v.x * j * wid / 2, y: c.y + u.y * i * len / 2 + v.y * j * wid / 2 }));
    };
    // The bridge: square across the creek, on hole 8's line just in front of its tee
    const s0 = at(0.52, 0.86), s1 = at(0.64, 0.9);
    const sl = Math.hypot(s1.x - s0.x, s1.y - s0.y), sd = { x: (s1.x - s0.x) / sl, y: (s1.y - s0.y) / sl };
    const tee = at(0.56, 0.9), basket = at(0.46, 0.66);
    // Where hole 8's line crosses the creek
    const den = (basket.x - tee.x) * sd.y - (basket.y - tee.y) * sd.x;
    const t = ((s0.x - tee.x) * sd.y - (s0.y - tee.y) * sd.x) / den;
    const cross = { x: tee.x + (basket.x - tee.x) * t, y: tee.y + (basket.y - tee.y) * t };
    const hl = Math.hypot(basket.x - tee.x, basket.y - tee.y), hd = { x: (basket.x - tee.x) / hl, y: (basket.y - tee.y) / hl };
    const make = (kind: string, pts: { x: number; y: number }[]) => { s.set({ structureKind: kind }); a.addDrawn("structure", pts); };
    make("bridge", [{ x: cross.x - hd.x * 20, y: cross.y - hd.y * 20 }, { x: cross.x + hd.x * 20, y: cross.y + hd.y * 20 }]);
    const b0 = at(0.6, 0.875);
    make("boardwalk", [b0, { x: b0.x + 40, y: b0.y - 18 }, { x: b0.x + 85, y: b0.y - 20 }, { x: b0.x + 125, y: b0.y - 40 }]);
    const st = at(0.5, 0.79);
    make("stairs", [st, { x: st.x + 14, y: st.y - 22 }]);
    const wl = at(0.47, 0.94);
    make("wall", [wl, { x: wl.x + 60, y: wl.y + 8 }, { x: wl.x + 95, y: wl.y - 10 }]);
    const club = at(0.43, 0.88);
    make("building", rect({ x: club.x, y: club.y - 55 }, 46, 30, 12));
    make("shelter", rect(at(0.505, 0.925), 32, 22, -8));
    make("deck", rect(at(0.7, 0.68), 18, 14, 30));
    a.select(null);
    s.set({ tool: "select" });
    return { cross, ids: w.__dgCourse().items.filter((i: any) => i.type === "structure").map((i: any) => i.id) };
  });
}

test("structures", async ({ page }) => {
  await importSite(page);
  await seedCourse(page);
  const { cross } = await seedStructures(page);
  await page.getByRole("button", { name: "3 Features" }).click();
  await page.evaluate(c => (window as any).__dgView.fitBounds({ minX: c.x - 260, minY: c.y - 200, maxX: c.x + 200, maxY: c.y + 120 }, { animate: false }), cross);
  await page.waitForTimeout(1500);
  await shot(page, "17-structures-editor");
  // The clubhouse picked: its inspector and handles
  const building = await page.evaluate(() => (window as any).__dgCourse().items.find((i: any) => i.kind === "building" && i.type === "structure").id);
  await page.evaluate(id => (window as any).__dgActions.select(id), building);
  await page.waitForTimeout(800);
  await shot(page, "17-structures-selected");
  await page.evaluate(() => (window as any).__dgActions.select(null));
  await page.keyboard.press("s");
  await page.waitForTimeout(400);
  await shot(page, "17-structures-tool");
  await page.keyboard.press("Escape");
  // In 3D, close and tilted
  await page.keyboard.press("3");
  await page.waitForTimeout(2500);
  await shot(page, "17-structures-3d");
  await page.evaluate(c => { const v = (window as any).__dgView; v.fitBounds({ minX: c.x - 70, minY: c.y - 50, maxX: c.x + 40, maxY: c.y + 40 }, { animate: false }); }, cross);
  await page.waitForTimeout(2500);
  await shot(page, "17-structures-3d-close");
  // From hole 8's tee: the bridge just ahead
  const hole8 = await page.evaluate(() => (window as any).__dgCourse().holes[7].id);
  await page.evaluate(id => (window as any).__dgEditor().set({ teeView: id, flyover: false }), hole8);
  await page.waitForTimeout(2500);
  await shot(page, "17-structures-tee");
  await page.keyboard.press("Escape");
  // The printed map: Forest, then Illustrated with its legend
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(3000);
  await page.getByTestId("design-page").screenshot({ path: "look/17-print-forest.png" });
  const bar = page.getByRole("button", { name: "Fit the page" }).locator("..");
  for (let i = 0; i < 5; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="design-page"] [data-structure="bridge"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, "17-print-forest-zoom");
  await page.getByRole("tab", { name: "Tee sign" }).click();
  await page.getByLabel("Hole for the tee sign").selectOption({ index: 7 });
  await page.waitForTimeout(2500);
  await page.getByTestId("design-page").screenshot({ path: "look/17-tee-sign.png" });
  await page.getByRole("tab", { name: "Course map" }).click();
  await page.waitForTimeout(2000);
  await page.getByTestId("design-page").screenshot({ path: "look/17-print-forest.png" });
  for (let i = 0; i < 5; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="design-page"] [data-structure="bridge"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, "17-print-forest-zoom");
});

test("structures close up", async ({ page }) => {
  await importSite(page, { trees: false });
  // One of each on the hill's slope (south-west of its top), and a hole over the bridge
  const spots = await page.evaluate(() => {
    const w = window as any, a = w.__dgActions, s = w.__dgEditor(), d = w.__dgCourse();
    const b = d.site.bounds, W = d.canvas.width, H = d.canvas.height;
    const lat = 39.78073 + 120 / 111320, lon = -89.68103 + 120 / (111320 * Math.cos((39.78073 * Math.PI) / 180));
    const c = { x: ((lon - b.west) / (b.east - b.west)) * W, y: ((b.north - lat) / (b.north - b.south)) * H };
    const P = (dx: number, dy: number) => ({ x: c.x + dx, y: c.y + dy });
    const rect = (m: { x: number; y: number }, len: number, wid: number, deg: number) => {
      const r = (deg * Math.PI) / 180, u = { x: Math.cos(r), y: Math.sin(r) }, v = { x: -u.y, y: u.x };
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: m.x + u.x * i * len / 2 + v.x * j * wid / 2, y: m.y + u.y * i * len / 2 + v.y * j * wid / 2 }));
    };
    const make = (kind: string, pts: { x: number; y: number }[]) => { s.set({ structureKind: kind }); a.addDrawn("structure", pts); return w.__dgCourse().items.at(-1).id; };
    const ids: Record<string, string> = {
      stairs: make("stairs", [P(-205, 205), P(-178, 178)]),
      deck: make("deck", rect(P(-150, 235), 22, 14, 35)),
      building: make("building", rect(P(-270, 120), 44, 28, 20)),
      shelter: make("shelter", rect(P(-110, 310), 30, 20, -10)),
      boardwalk: make("boardwalk", [P(-330, 250), P(-290, 290), P(-250, 305), P(-215, 330)]),
      wall: make("wall", [P(-235, 160), P(-215, 200), P(-185, 225)]),
      bridge: make("bridge", [P(-360, 170), P(-330, 205)])
    };
    a.addHole(P(-375, 150), P(-250, 300), "blue");
    a.select(null);
    s.set({ tool: "select" });
    const out: Record<string, { x: number; y: number }> = {};
    for (const [k, id] of Object.entries(ids)) { const it = w.__dgCourse().items.find((i: any) => i.id === id); out[k] = { x: it.x, y: it.y }; }
    return out;
  });
  await page.keyboard.press("3");
  await page.waitForTimeout(1500);
  for (const [kind, p] of Object.entries(spots)) {
    await page.evaluate(p => {
      const v = (window as any).__dgView;
      // (The ground's height there)
      const g = v.h(p.x, p.y);
      void v.controls.setLookAt(p.x - 38, g + 28, p.y + 48, p.x, g + 2, p.y, false);
      v.invalidate(true);
    }, p);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `look/18-3d-${kind}.png`, clip: { x: 340, y: 56, width: 1260, height: 860 } });
  }
  const hole = await page.evaluate(() => (window as any).__dgCourse().holes[0].id);
  await page.evaluate(id => (window as any).__dgEditor().set({ teeView: id }), hole);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "look/18-tee-bridge.png", clip: { x: 340, y: 56, width: 1260, height: 860 } });
  await page.keyboard.press("Escape");
  // The printed map up close, on open lawn (woods only where drawn)
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Drawn only" }).click();
  await page.waitForTimeout(3000);
  const bar = page.getByRole("button", { name: "Fit the page" }).locator("..");
  for (let i = 0; i < 7; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(2000);
  for (const kind of ["building", "bridge", "shelter"]) {
    await page.locator(`[data-testid="design-page"] [data-structure="${kind}"]`).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `look/18-print-forest-${kind}.png`, clip: { x: 340, y: 105, width: 1260, height: 870 } });
  }
});

test("fairway shaped along a hole", async ({ page }) => {
  test.setTimeout(240_000);
  await importSite(page);
  await seedCourse(page);
  // Hole 3, the long one: a wide landing zone and a pinched gap before the basket
  await page.getByTestId("hole-row").nth(2).click();
  await page.waitForTimeout(800);
  // Out from the hole's line (its tee to its basket), k pixels (negative: in toward it)
  const widen = async (i: number, k: number) => {
    const h = await handleCenter(page, "width", i);
    const [a, b] = await page.evaluate(() => {
      const d = (window as any).__dgCourse();
      const v = (window as any).__dgView;
      const W = d.canvas.width, H = d.canvas.height;
      return [v.toClient(0.16 * W, 0.24 * H), v.toClient(0.42 * W, 0.14 * H)];
    });
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const s = Math.sign((h.x - a.x) * n.x + (h.y - a.y) * n.y) || 1;
    await drag(page, h, { x: h.x + n.x * s * k, y: h.y + n.y * s * k });
  };
  await widen(1, 40);
  await widen(2, -12);
  await page.waitForTimeout(800);
  await shot(page, "19-fairway-shape-editor");
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(2500);
  await page.getByTestId("design-page").screenshot({ path: "look/19-fairway-shape-print.png" });
});

test("half wooded, half open course: painted map, 3D and from a tee", async ({ page }) => {
  test.setTimeout(300_000);
  await importSite(page);
  await seedCourse(page);
  // Woods over the west half (the seeded corner woods replaced by a big stand), open field east
  await page.evaluate(() => {
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    const s = (window as any).__dgEditor();
    s.set({ areaKind: "woods" });
    (window as any).__dgActions.addDrawn("area", [{ x: 0, y: 0 }, { x: 0.52 * W, y: 0 }, { x: 0.44 * W, y: 0.35 * H }, { x: 0.5 * W, y: 0.62 * H }, { x: 0.4 * W, y: H }, { x: 0, y: H }]);
    s.set({ tool: "select", grass: 2 });
  });
  await page.getByRole("button", { name: "5 Design" }).click();
  await page.getByTestId("forest-options").getByRole("radio", { name: "Drawn only" }).click();
  await page.waitForTimeout(3000);
  await page.getByTestId("design-page").screenshot({ path: "look/20-half-woods-print.png" });
  const bar = page.getByRole("button", { name: "Fit the page" }).locator("..");
  for (let i = 0; i < 3; i++) await bar.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "20-half-woods-print-zoom");
  // The same course painted with woods everywhere off the fairways, for comparison
  await page.getByTestId("forest-options").getByRole("radio", { name: "Everywhere" }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Fit the page" }).click();
  await page.waitForTimeout(800);
  await page.getByTestId("design-page").screenshot({ path: "look/20-everywhere-print.png" });
  // 3D: tilted over the whole course, then low over the pond, then from hole 2's tee
  await page.getByRole("button", { name: "2 Holes" }).click();
  await page.keyboard.press("3");
  await page.waitForTimeout(3000);
  await shot(page, "20-half-woods-3d");
  await page.evaluate(() => {
    const v = (window as any).__dgView;
    const d = (window as any).__dgCourse();
    const W = d.canvas.width, H = d.canvas.height;
    // Low over the pond's south side, looking north across it
    const ex = 0.2 * W, ey = 0.73 * H, tx = 0.16 * W, ty = 0.6 * H;
    void v.controls.setLookAt(ex, v.groundHeight(ex, ey) + 9, ey, tx, v.groundHeight(tx, ty) + 2, ty, false);
  });
  await page.waitForTimeout(4000);
  await shot(page, "20-pond-3d");
  await page.getByTestId("hole-row").nth(1).click();
  await page.getByTestId("tee-view").click();
  await page.waitForTimeout(4000);
  await shot(page, "20-tee-woods-edge");
});

test("fourth round: imported areas, several picked, a shared basket, painted flyovers, keyframes", async ({ page }) => {
  test.setTimeout(300_000);
  await importSite(page);
  await page.waitForTimeout(1500);
  await shot(page, "21-import-areas");
  await seedCourse(page);
  await page.waitForTimeout(800);
  // Several picked with a box
  const doc = await course(page);
  const W = doc.canvas.width, H = doc.canvas.height;
  const v = (x: number, y: number) => page.evaluate(([px, py]) => (window as any).__dgView.toClient(px, py), [x, y]);
  await page.keyboard.down("Shift");
  await drag(page, await v(0.45 * W, 0.05 * H), await v(0.98 * W, 0.5 * H));
  await page.keyboard.up("Shift");
  await page.waitForTimeout(600);
  await shot(page, "21-group-selected");
  await page.keyboard.press("Escape");
  // A hole played to hole 1's basket
  const b1 = doc.items.find((i: any) => i.type === "basket" && i.holeId === doc.holes[0].id);
  await page.evaluate(([x, y]) => {
    const a = (window as any).__dgActions;
    a.addHole({ x: x + 220, y: y + 160 }, { x, y }, "red");
    a.select(null);
    (window as any).__dgEditor().set({ tool: "select" });
  }, [b1.x, b1.y]);
  await page.waitForTimeout(800);
  await shot(page, "21-shared-basket");
  // From a tee and flying over: the painted map on the ground
  await page.getByTestId("hole-row").nth(3).click();
  await page.getByTestId("tee-view").click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__dgView.ground.paintedTexture), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(2500);
  await shot(page, "21-tee-painted");
  await page.getByTestId("hud-flyover").click();
  await expect.poll(() => page.evaluate(() => (window as any).__dgView.flyProgress() ?? 0), { timeout: 90_000 }).toBeGreaterThan(0.45);
  await shot(page, "21-flyover-painted");
  await page.getByTestId("hud-settings").click();
  await page.waitForTimeout(400);
  await shot(page, "21-flyover-camera");
  await page.getByTestId("hud-close").click();
  // A hole's keyframes on the map
  await page.getByTestId("hole-row").nth(3).click();
  await page.getByTestId("hole-flight").getByRole("radio", { name: "Keyframes" }).click();
  await page.evaluate(id => (window as any).__dgView.fitHole(id), doc.holes[3].id);
  await page.waitForTimeout(1200);
  await shot(page, "21-keyframes");
});

// ---------------------------------------------------------------------------------------------
// Phones and tablets: the bottom sheet and step bar (upright), the rail (on its side), tablets
// ---------------------------------------------------------------------------------------------

/** A Playwright device in Chromium (the device list's iPhones say WebKit). */
const device = (name: string) => {
  const { defaultBrowserType: _browser, ...d } = devices[name];
  return d;
};
const sheetTo = async (page: Page, detent: "peek" | "half" | "full") => {
  for (let i = 0; i < 3 && (await page.getByTestId("sheet").getAttribute("data-detent")) !== detent; i++) await page.getByTestId("sheet-handle").click();
  await page.waitForTimeout(450);
};
const navTo = (page: Page, step: string) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: new RegExp(step) }).click();

test.describe("phone", () => {
  test.use(device("iPhone 13"));

  test("phone: steps, sheet, drawing, selection, tee view", async ({ page }) => {
    test.setTimeout(300_000);
    await shot(page, "m01-phone-start");
    await page.getByTestId("welcome-find").click();
    await page.getByLabel("Search address").fill("Springfield Park");
    await page.getByRole("button", { name: /Springfield Park/ }).first().click();
    await expect(page.getByTestId("site-size")).toBeVisible();
    await page.waitForTimeout(1500);
    await shot(page, "m02-phone-find-site");
    await page.getByTestId("import-site").click();
    await page.getByTestId("review-bring").click({ timeout: 60_000 });
    await expect(page.getByTestId("import-site")).toBeHidden({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot(page, "m03-phone-hole-tool");
    const doc = await course(page);
    const W = doc.canvas.width, H = doc.canvas.height;
    await tapPlan(page, W * 0.35, H * 0.62);
    await page.waitForTimeout(300);
    await shot(page, "m04-phone-hole-tee-placed");
    await tapPlan(page, W * 0.55, H * 0.42);
    await page.waitForTimeout(600);
    await page.getByTestId("tool-close").click();
    await seedCourse(page);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(1200);
    await shot(page, "m05-phone-holes-peek");
    await sheetTo(page, "half");
    await shot(page, "m06-phone-holes-half");
    await sheetTo(page, "full");
    await shot(page, "m07-phone-holes-full");
    await page.getByTestId("hole-row").first().click();
    await page.waitForTimeout(1200);
    await shot(page, "m08-phone-inspector");
    await sheetTo(page, "peek");
    await shot(page, "m09-phone-inspector-peek");
    const tee = await page.evaluate(() => { const d = (window as any).__dgCourse(); const t = d.items.find((i: any) => i.type === "tee"); return (window as any).__dgView.toClient(t.x, t.y, 1); });
    await longPress(page, tee);
    await page.waitForTimeout(400);
    await shot(page, "m10-phone-item-menu");
    await page.getByTestId("action-sheet-cancel").click();
    await page.getByTestId("selection-back").click();
    await navTo(page, "Features");
    await page.waitForTimeout(600);
    await shot(page, "m11-phone-features");
    await page.locator('[data-tool="draw-area"]').click();
    await page.getByTestId("area-kind-ob").click();
    await page.waitForTimeout(300);
    for (const [fx, fy] of [[0.4, 0.5], [0.5, 0.47], [0.52, 0.58]]) await tapPlan(page, W * fx, H * fy);
    await page.waitForTimeout(400);
    await shot(page, "m12-phone-drawing");
    await page.getByTestId("draw-done").click();
    await page.waitForTimeout(600);
    await shot(page, "m12-phone-drawn");
    await page.getByTestId("selection-back").click().catch(() => {});
    for (const [step, name] of [["Review", "m13-phone-review"], ["Design", "m14-phone-design"], ["Export", "m15-phone-export"], ["Site", "m16-phone-site"]]) {
      await navTo(page, step);
      await page.waitForTimeout(step === "Design" ? 3500 : 900);
      await shot(page, name);
    }
    await navTo(page, "Holes");
    await page.getByRole("radio", { name: "3D" }).click();
    await page.waitForTimeout(2000);
    await shot(page, "m17-phone-3d");
    await page.getByRole("radio", { name: "2D" }).click();
    await sheetTo(page, "half");
    await page.getByTestId("hole-row").nth(2).click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "View from the tee" }).first().click();
    await page.waitForTimeout(2500);
    await shot(page, "m18-phone-tee-view");
    await page.getByTestId("hud-close").click();
    await page.waitForTimeout(600);
    await page.getByTestId("app-menu-button").click();
    await page.waitForTimeout(400);
    await shot(page, "m19-phone-menu");
    await page.getByTestId("menu-help").click();
    await page.waitForTimeout(400);
    await shot(page, "m20-phone-help");
  });
});

test.describe("phone on its side", () => {
  test.use(device("iPhone 13 landscape"));

  test("phone landscape: rail, side panel, selection, design", async ({ page }) => {
    test.setTimeout(240_000);
    await importSite(page);
    await seedCourse(page);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(1500);
    await shot(page, "m30-landscape-holes");
    await page.getByTestId("hole-row").first().click();
    await page.waitForTimeout(1200);
    await shot(page, "m31-landscape-inspector");
    await page.getByTestId("selection-back").click();
    await page.locator('[data-tool="draw-line"]').click();
    await page.waitForTimeout(400);
    await shot(page, "m32-landscape-tool");
    await page.getByTestId("tool-close").click();
    await navTo(page, "Design");
    await page.waitForTimeout(3500);
    await shot(page, "m33-landscape-design");
  });
});

test.describe("tablet held upright", () => {
  test.use(device("iPad Pro 11"));

  test("tablet upright: rail and panel", async ({ page }) => {
    test.setTimeout(240_000);
    await importSite(page);
    await seedCourse(page);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(1500);
    await shot(page, "m42-tablet-upright-holes");
    await page.getByTestId("hole-row").first().click();
    await page.waitForTimeout(1200);
    await shot(page, "m43-tablet-upright-inspector");
  });
});

test.describe("tablet", () => {
  test.use(device("iPad Pro 11 landscape"));

  test("tablet: side panel layout", async ({ page }) => {
    test.setTimeout(240_000);
    await importSite(page);
    await seedCourse(page);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(1500);
    await shot(page, "m40-tablet-holes");
    await page.getByTestId("hole-row").first().click();
    await page.waitForTimeout(1200);
    await shot(page, "m41-tablet-inspector");
  });
});

test.describe("android phone", () => {
  test.use(device("Pixel 7"));

  test("pixel: holes and a line being drawn", async ({ page }) => {
    test.setTimeout(240_000);
    await importSite(page);
    await seedCourse(page);
    await page.evaluate(() => (window as any).__dgView.fitCourse(false));
    await page.waitForTimeout(1200);
    await shot(page, "m50-pixel-holes");
    await page.locator('[data-tool="draw-line"]').click();
    const doc = await course(page);
    for (const [fx, fy] of [[0.3, 0.3], [0.45, 0.36], [0.6, 0.33]]) await tapPlan(page, doc.canvas.width * fx, doc.canvas.height * fy);
    await page.waitForTimeout(400);
    await shot(page, "m51-pixel-drawing-line");
  });
});
