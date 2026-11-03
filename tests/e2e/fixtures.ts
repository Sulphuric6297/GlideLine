import { test as base, expect, Page } from "@playwright/test";
import { encode } from "fast-png";
import { readFileSync } from "fs";

// ---------------------------------------------------------------------------------------------
// Offline stubs for every external service the app uses, so tests are fast and deterministic.
// The place is made up ("Springfield Park").
// ---------------------------------------------------------------------------------------------

export const SITE = { lat: 39.78073, lon: -89.68103, label: "Springfield Park, 100 Park Rd, Springfield" };
const M_PER_DEG = 111320;
const COS = Math.cos((SITE.lat * Math.PI) / 180);
/** East and north of the site's middle, meters. */
const local = (lat: number, lon: number) => ({ e: (lon - SITE.lon) * M_PER_DEG * COS, n: (lat - SITE.lat) * M_PER_DEG });

/** The ground: 600 m, a round hill 18 m high about 120 m north-east of the middle, rising gently east. */
export const groundMeters = (lat: number, lon: number) => {
  const { e, n } = local(lat, lon);
  return 600 + e * 0.01 + 18 * Math.exp(-((e - 120) ** 2 + (n - 120) ** 2) / (2 * 70 ** 2));
};

// Photo features: a pond, a footpath and a few tree crowns
export const POND = { e: -150, n: -60, r: 35 };
export const PHOTO_TREES = [{ e: -40, n: 60, r: 5 }, { e: 40, n: -90, r: 6 }, { e: 170, n: -40, r: 5 },
  // A stand of trees (crowns touching), about 40 m across: woods
  ...Array.from({ length: 25 }, (_, k) => ({ e: 104 + (k % 5) * 8 + ((k / 5) | 0) % 2 * 3, n: 64 + ((k / 5) | 0) * 8, r: 5 }))];
/** Where the stand of trees on the photo is (its middle, m east and north of the site's center). */
export const STAND = { e: 121, n: 80 };

const cors = { "access-control-allow-origin": "*" };
const json = (body: unknown) => ({ status: 200, headers: { "content-type": "application/json", ...cors }, body: JSON.stringify(body) });
const png = (bytes: Uint8Array) => ({ status: 200, headers: { "content-type": "image/png", ...cors }, body: Buffer.from(bytes) });

const latOfPixel = (gy: number, world: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / world))) * 180) / Math.PI;

/** Terrarium elevation tile. */
const terrariumTile = (z: number, x: number, y: number) => {
  const size = 256;
  const world = size * Math.pow(2, z);
  const data = new Uint8Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    const lat = latOfPixel(y * size + py + 0.5, world);
    for (let px = 0; px < size; px++) {
      const lon = ((x * size + px + 0.5) / world) * 360 - 180;
      const v = groundMeters(lat, lon) + 32768;
      const i = (py * size + px) * 3;
      data[i] = Math.floor(v / 256);
      data[i + 1] = Math.floor(v % 256);
      data[i + 2] = Math.floor((v % 1) * 256);
    }
  }
  return encode({ width: size, height: size, data, channels: 3, depth: 8 });
};

/** The photo's color at a spot (m east and north of the middle; gx, gy: its pixel, for the grain),
 * and its near-infrared brightness: leaves brightest, grass a little less, the path and the pond dark. */
const photoColor = (e: number, n: number, gx: number, gy: number) => {
  const h = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
  const noise = (h - Math.floor(h) - 0.5) * 26;
  let col = [92 + noise, 132 + noise, 64 + noise * 0.5, 150 + noise * 0.5];
  if (Math.abs(n - e * 0.3 + 20) < 1.2) col = [196 + noise * 0.3, 176 + noise * 0.3, 140, 110];
  if (Math.hypot(e - POND.e, n - POND.n) < POND.r) col = [40, 80 + noise * 0.2, 120, 25];
  for (const t of PHOTO_TREES) {
    const d = Math.hypot(e - t.e, n - t.n);
    if (d < t.r) {
      const c = Math.sin(Math.floor(e / 0.5) * 91.7 + Math.floor(n / 0.5) * 47.3) * 9631.7;
      const leaf = (c - Math.floor(c) - 0.5) * 60;
      col = [38 + leaf * 0.6, 72 + leaf, 30 + leaf * 0.4, 205 + leaf * 0.5];
    }
  }
  return col;
};

/** Imagery tile: textured grass with a pond, a footpath, tree crowns and a stand of trees. */
const imageryTile = (z: number, tx: number, ty: number) => {
  const size = 256;
  const world = size * Math.pow(2, z);
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const gy = ty * size + py;
    const lat = latOfPixel(gy + 0.5, world);
    for (let px = 0; px < size; px++) {
      const gx = tx * size + px;
      const lon = ((gx + 0.5) / world) * 360 - 180;
      const { e, n } = local(lat, lon);
      const col = photoColor(e, n, gx, gy);
      const i = (py * size + px) * 4;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  }
  return encode({ width: size, height: size, data, channels: 4, depth: 8 });
};

/** An aerial photo service's exported image of a web-mercator box: the same ground as the map
 * tiles, in color or (`nir`) its near-infrared band as a grey image. */
const imageryBox = (x0: number, y0: number, x1: number, y1: number, w: number, h: number, nir: boolean) => {
  const data = new Uint8Array(w * h * 4);
  const R = 6378137;
  for (let py = 0; py < h; py++) {
    const my = y1 - ((py + 0.5) / h) * (y1 - y0);
    const lat = (Math.atan(Math.sinh(my / R)) * 180) / Math.PI;
    for (let px = 0; px < w; px++) {
      const lon = ((x0 + ((px + 0.5) / w) * (x1 - x0)) / R) * (180 / Math.PI);
      const { e, n } = local(lat, lon);
      const col = photoColor(e, n, Math.round(e * 2), Math.round(n * 2));
      const i = (py * w + px) * 4;
      data[i] = nir ? col[3] : col[0];
      data[i + 1] = nir ? col[3] : col[1];
      data[i + 2] = nir ? col[3] : col[2];
      data[i + 3] = 255;
    }
  }
  return encode({ width: w, height: h, data, channels: 4, depth: 8 });
};

const tileCache = new Map<string, Uint8Array>();
const cached = (key: string, make: () => Uint8Array) => {
  if (!tileCache.has(key)) tileCache.set(key, make());
  return tileCache.get(key)!;
};
const at = (e: number, n: number) => ({ lat: SITE.lat + n / M_PER_DEG, lon: SITE.lon + e / (M_PER_DEG * COS) });
/** A point `e` meters east and `n` meters north of the made-up site's middle (for stubbed map data). */
export const geoAt = at;

export async function stubNetwork(page: Page) {
  // Anything not explicitly stubbed must not hit the internet.
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, route => route.abort());
  await page.route(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/, route => {
    const [z, x, y] = route.request().url().match(/terrarium\/(\d+)\/(\d+)\/(\d+)/)!.slice(1).map(Number);
    route.fulfill(png(cached(`t${z}/${x}/${y}`, () => terrariumTile(z, x, y))));
  });
  await page.route(/arcgisonline\.com\/.*\/tile\/(\d+)\/(\d+)\/(\d+)/, route => {
    const [z, y, x] = route.request().url().match(/tile\/(\d+)\/(\d+)\/(\d+)/)!.slice(1).map(Number);
    route.fulfill(png(cached(`i${z}/${x}/${y}`, () => imageryTile(z, x, y))));
  });
  await page.route(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)/, route => {
    const [z, x, y] = route.request().url().match(/org\/(\d+)\/(\d+)\/(\d+)/)!.slice(1).map(Number);
    route.fulfill(png(cached(`i${z}/${x}/${y}`, () => imageryTile(z, x, y))));
  });
  await page.route(/\/tilemap\//, route => route.fulfill(json({ adjusted: false, data: [0] })));
  // Statewide ortho and USGS: "unavailable", so the fallbacks run
  await page.route(/nconemap\.gov|gis\.nc\.gov|elevation\.nationalmap\.gov/, route => route.abort());
  // (the US government's maps: nothing here, unless a test says otherwise)
  await page.route(/hydro\.nationalmap\.gov|wetlandsmapservice|USA_Structures_View/, route => route.fulfill(json({ features: [] })));
  await page.route(/GeocodeServer\/suggest/, route =>
    route.fulfill(json({ suggestions: [{ text: `${SITE.label}, USA`, magicKey: "k1", isCollection: false }] }))
  );
  await page.route(/GeocodeServer\/findAddressCandidates/, route =>
    route.fulfill(json({ candidates: [{ address: SITE.label, score: 100, location: { x: SITE.lon, y: SITE.lat } }] }))
  );
  await page.route(/census\.gov|photon\.komoot|nominatim/, route => route.abort());
  // OpenStreetMap: the footpath, the pond, a road along the south edge and a parking lot
  const ring = (c: { e: number; n: number }, r: number) => Array.from({ length: 13 }, (_, i) => at(c.e + Math.cos((i / 12) * Math.PI * 2) * r, c.n + Math.sin((i / 12) * Math.PI * 2) * r));
  await page.route(/overpass/, route =>
    route.fulfill(json({
      elements: [
        { type: "way", tags: { highway: "footway" }, geometry: [at(-200, -80), at(0, -20), at(200, 40)] },
        { type: "way", tags: { natural: "water", name: "Mill Pond" }, geometry: ring(POND, POND.r) },
        { type: "way", tags: { highway: "residential", name: "Park Rd" }, geometry: [at(-260, -140), at(260, -140)] },
        { type: "way", tags: { amenity: "parking" }, geometry: [at(-60, -125), at(-20, -125), at(-20, -105), at(-60, -105), at(-60, -125)] }
      ]
    }))
  );
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** The open course, without the photo and terrain (their size only), for checking. */
export const course = (page: Page) => page.evaluate(() => {
  const d = (window as any).__dgCourse();
  return { ...d, background: d.background ? `${d.background.slice(0, 22)}… (${d.background.length})` : null, terrainHeights: Object.keys(d.terrainHeights).length };
});
/** Tee view on a computer: the hole's card (in the Flyover panel, or floating when the panel is
 * put away), its bar over the view, and Back to map on it. */
export const teeCard = (page: Page) => page.locator('[data-testid="fly-panel"], [data-testid="tee-view-hud"]').first();
export const teeBar = (page: Page) => page.getByTestId("tee-bar");
export const backToMap = (page: Page) => page.getByTestId("tee-bar").getByTestId("bar-done").click();
/** The flyover's Play on its bar: "Pause" while it plays, "Play" held (paused, or at its end). */
export const flyButton = (page: Page) => page.getByTestId("tee-bar").getByTestId("hud-flyover");

export const editorState = (page: Page) => page.evaluate(() => {
  const s = (window as any).__dgEditor();
  return { step: s.step, tool: s.tool, selectedId: s.selectedId, group: s.group, dragSelect: s.dragSelect, designSel: s.designSel, activeHoleId: s.activeHoleId, view: s.view, teeView: s.teeView, flyLook: s.flyLook };
});

/** The map at rest: a fit or zoom easing in on a slow machine moves what's under a click. */
export const settled = (page: Page) =>
  page.waitForFunction(() => { const v = (window as any).__dgView; return !v?.settled || v.settled(); }, null, { timeout: 15_000 }).catch(() => {});

/** Where a plan point (on the ground) is on screen (once the map is at rest). */
export const screenOf = async (page: Page, x: number, y: number, lift = 0) => {
  await settled(page);
  return page.evaluate(([x, y, lift]) => (window as any).__dgView.toClient(x, y, lift), [x, y, lift] as const) as Promise<{ x: number; y: number }>;
};

/** Plan point under a screen point. */
export const planAt = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => (window as any).__dgView.toPlan(x, y), [x, y] as const) as Promise<{ x: number; y: number } | null>;

/** A point on the map at a fraction of its box. */
export async function mapPoint(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId("plan").boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Clicks a plan point (feet) on the map. */
export async function clickPlan(page: Page, x: number, y: number, opts: { double?: boolean } = {}) {
  const p = await screenOf(page, x, y);
  if (opts.double) await page.mouse.dblclick(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(60);
}

/** Center of a selection handle. */
export async function handleCenter(page: Page, kind: string, index = 0) {
  const h = page.locator(`[data-handle="${kind}"]`).nth(index);
  await expect(h).toBeVisible();
  let last = { x: NaN, y: NaN };
  for (let i = 0; i < 20; i++) {
    const b = (await h.boundingBox())!;
    const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    if (Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return p;
    last = p;
    await page.waitForTimeout(60);
  }
  return last;
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

// --- Touch (for the phone and tablet layouts; the page needs `hasTouch`) ---

type XY = { x: number; y: number };
/** Raw touches through the DevTools protocol: a finger's press, moves and lift (pointer events
 * of type "touch", as on a phone). */
export async function touches(page: Page, run: (send: (type: "touchStart" | "touchMove" | "touchEnd", points: XY[]) => Promise<void>) => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await run(async (type, points) => { await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })) }); });
  } finally {
    await cdp.detach();
  }
}

/** Taps a plan point (feet) on the map with a finger. */
export async function tapPlan(page: Page, x: number, y: number) {
  const p = await screenOf(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(80);
}

/** LiDAR from the air over the test site: a made-up survey (tests/fixtures/lidar, see make.py)
 * served for whichever survey is asked for. */
export async function withLidar(page: Page) {
  const dir = new URL("../fixtures/lidar/", import.meta.url);
  const file = (name: string) => readFileSync(new URL(name, dir));
  await page.route(/s3-us-west-2\.amazonaws\.com\/usgs-lidar-public\/[^/]+\/(.+)$/, route => {
    const rest = route.request().url().match(/usgs-lidar-public\/[^/]+\/(.+)$/)![1];
    if (rest === "ept.json" || rest === "ept-hierarchy/0-0-0-0.json") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: file(rest) });
    if (rest === "ept-data/0-0-0-0.laz") return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "access-control-allow-origin": "*" }, body: file(rest) });
    return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
}

/** The course in the Classic look (a new one starts in Brushed): for the checks on the painting's
 * own parts, quick to paint on a test machine with no graphics chip. Brushed has its own checks
 * in tests/real. */
export async function classicLook(page: Page) {
  await page.evaluate(() => (window as any).__dgActions.style({ mapLook: undefined }));
}

/** No survey over the test site (the app's list of surveys empty), so the photo's trees are the
 * ones: where a survey covers a site, the photo is looked over for water only. */
export async function noSurvey(page: Page) {
  await page.route(/lidar-index\.json$/, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ base: "", surveys: [] }) }));
}

/** USGS NAIP Plus over the test site: its catalog says a summer photo, 60 cm, four bands, and the
 * photo itself is the same made-up ground as the map tiles (its near-infrared band too). */
export async function withNaip(page: Page) {
  const attributes = { Name: "m_0000000_ne_00_060_20230816", Year: 2023, acquisition_date: Date.UTC(2023, 7, 16), resolution_value: 0.6, resolution_units: "METER", band_count: 4, State: "IL" };
  await page.route(/imagery\.nationalmap\.gov\/.*USGSNAIPPlus\/ImageServer\/getSamples/, route =>
    route.fulfill(json({ samples: [0, 1, 2, 3, 4].map(locationId => ({ locationId, rasterId: 7, value: "92 132 64 150", resolution: 0.6, attributes })) }))
  );
  await page.route(/imagery\.nationalmap\.gov\/.*USGSNAIPPlus\/ImageServer\/exportImage/, route => {
    const u = new URL(route.request().url());
    const [x0, y0, x1, y1] = u.searchParams.get("bbox")!.split(",").map(Number);
    const [w, h] = u.searchParams.get("size")!.split(",").map(Number);
    route.fulfill(png(imageryBox(x0, y0, x1, y1, w, h, u.searchParams.get("bandIds") === "3")));
  });
}

/** Holds a finger still at a point (a long-press). */
export async function longPress(page: Page, p: XY, ms = 750) {
  await touches(page, async send => {
    await send("touchStart", [p]);
    await page.waitForTimeout(ms);
    await send("touchEnd", []);
  });
}

/** Drags one finger from a point to another. */
export async function touchDrag(page: Page, from: XY, to: XY, steps = 12) {
  await touches(page, async send => {
    await send("touchStart", [from]);
    for (let i = 1; i <= steps; i++) await send("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    await send("touchEnd", []);
  });
}

/** Pinches two fingers apart (scale > 1) or together around a point. */
export async function pinch(page: Page, at: XY, fromGap: number, toGap: number, steps = 10) {
  await touches(page, async send => {
    const pts = (g: number) => [{ x: at.x - g / 2, y: at.y }, { x: at.x + g / 2, y: at.y }];
    await send("touchStart", pts(fromGap));
    for (let i = 1; i <= steps; i++) await send("touchMove", pts(fromGap + ((toGap - fromGap) * i) / steps));
    await send("touchEnd", []);
  });
}

/** Starts on open ground (no site) and lays out holes: each [tee, basket] in plan feet. */
export async function blankCourse(page: Page) {
  await page.getByTestId("welcome-blank").click();
  await expect.poll(async () => (await editorState(page)).tool).toBe("add-hole");
}

export async function addHole(page: Page, tee: { x: number; y: number }, basket: { x: number; y: number }) {
  const had = new Set((await course(page)).holes.map((h: any) => h.id));
  if ((await editorState(page)).tool !== "add-hole") await page.keyboard.press("h");
  await clickPlan(page, tee.x, tee.y);
  await clickPlan(page, basket.x, basket.y);
  await expect.poll(async () => (await course(page)).holes.length).toBe(had.size + 1);
  // (the new one: not always the last, once holes have numbers of their own)
  return (await course(page)).holes.find((h: any) => !had.has(h.id));
}

/** Runs the whole site import against the stubs; returns "Site brought in." and what the import
 * said it brought in (the site's notes, listed on the Site step under What came in). */
export async function importSite(page: Page, opts: { trees?: boolean; osm?: boolean; review?: (page: Page) => Promise<void> } = {}) {
  // (an import is slow on a machine drawing without a graphics card: time for it and what follows)
  test.setTimeout(Math.max(test.info().timeout, 240_000));
  const welcome = page.getByTestId("welcome-find");
  if (await welcome.isVisible()) await welcome.click();
  else {
    await page.getByRole("button", { name: /^1\s*Site$/ }).click();
    const find = page.getByTestId("find-site");
    if (await find.isVisible()) await find.click();
    else await page.getByTestId("resize-site").click();
  }
  // (a site in already: the dialog opens on its frame; back to the search first)
  const again = page.getByRole("button", { name: "Search again" });
  if (await again.isVisible().catch(() => false)) await again.click();
  await page.getByLabel("Search address").fill("Springfield Park");
  await page.getByRole("button", { name: /Springfield Park/ }).first().click();
  await expect(page.getByTestId("site-size")).toBeVisible();
  // (what comes in: a switch each; the photo's trees only offered where no survey covers the site)
  // (once what this spot has is known: the switches settle)
  await expect(page.locator('[data-testid=import-what][data-here=ready]')).toBeVisible({ timeout: 90_000 });
  const photoTrees = page.getByTestId("bring-photo-trees");
  if (opts.trees === false && await photoTrees.isVisible()) await photoTrees.click();
  if (opts.osm === false) await page.getByTestId("bring-osm").click();
  await page.getByTestId("import-site").click();
  // Looked at first: each source on the map, switched on or off; then brought in
  await expect(page.getByTestId("import-review")).toBeVisible({ timeout: 120_000 });
  if (opts.review) await opts.review(page);
  await page.getByTestId("review-bring").click();
  // The card that says what came in (the same in a sentence, its label), then on to designing
  const ready = page.getByTestId("site-ready");
  await expect(ready).toBeVisible({ timeout: 60_000 });
  await expect(ready).toHaveAttribute("aria-label", /^Site brought in[.:]/);
  await page.evaluate(() => { (window as any).__importDone = document.querySelector("[data-testid=site-ready]")?.getAttribute("aria-label"); });
  await page.getByTestId("site-ready-start").click();
  // (the toast lists what came in; the import's own sentences are kept with the site)
  const notes: string[] = await page.evaluate(() => (window as any).__dgCourse().site.notes ?? []);
  return "Site brought in. " + notes.join(" ");
}

type Fixtures = { errors: string[] };

/** Every test starts from an empty app with the network stubbed, and fails on uncaught page errors. */
export const test = base.extend<Fixtures>({
  errors: async ({}, use) => {
    await use([]);
  },
  page: async ({ page, errors }, use) => {
    page.on("pageerror", err => errors.push(err.message));
    await stubNetwork(page);
    await page.goto("/");
    await page.evaluate(async () => {
      localStorage.clear();
      // (and this tab's place: a refresh keeps it, a new visit has none)
      sessionStorage.clear();
      // (an empty app: no dashboard and no example course, as a new visitor to the demo gets)
      localStorage.setItem("hyzerlab-start-blank", "1");
      await new Promise<void>(resolve => {
        const req = indexedDB.deleteDatabase("disc-golf-course-designer");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    });
    await page.reload();
    await expect(page.getByTestId("welcome")).toBeVisible();
    await use(page);
    expect(errors, "uncaught errors in the page").toEqual([]);
  }
});

export { expect };
