// Denmark: the ground and the trees from Danmarks Højdemodel (Dataforsyningen, with a token), the
// token row in the import, the spring photo's address, and the Danish kinds of trees. The place
// is made up and lies off the coast; the height model is stubbed.
import { type Page } from "@playwright/test";
import { test, expect, course, importSite } from "./fixtures";
import { inDenmark, toUtm32 } from "../../src/lib/geo/denmark";
import { serviceImageUrl } from "../../src/lib/geo/photoSources";
import { LOOK_VARIANTS, regionAt } from "../../src/lib/treeMix";

const DK = { lat: 55.0, lon: 10.95, label: "Springfield Park, Springfield" };

/** A one-band float TIFF (what the height model's GetCoverage sends), `w` by `h`. */
const floatTiff = (w: number, h: number, v: (i: number, j: number) => number) => {
  const tags: [number, number, number][] = [[256, 4, w], [257, 4, h], [258, 3, 32], [259, 3, 1], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 4, h], [279, 4, w * h * 4], [339, 3, 3]];
  const ifd = 8, data = ifd + 2 + tags.length * 12 + 4;
  const buf = Buffer.alloc(data + w * h * 4);
  buf.write("II", 0, "latin1"); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifd, 4); buf.writeUInt16LE(tags.length, ifd);
  tags.forEach(([tag, type, val], k) => {
    const o = ifd + 2 + k * 12;
    buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(1, o + 4);
    if (type === 3) buf.writeUInt16LE(val, o + 8);
    else buf.writeUInt32LE(tag === 273 ? data : val, o + 8);
  });
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) buf.writeFloatLE(v(i, j), data + (j * w + i) * 4);
  return buf;
};

/** Five trees round the site's middle (UTM 32, m), each 14 m tall and 4 m round. */
const mid = toUtm32(DK.lat, DK.lon);
const TREES = [[0, 0], [40, 30], [-40, 30], [40, -30], [-40, -30]].map(([e, n]) => ({ x: mid.x + e, y: mid.y + n }));
const groundAt = (x: number) => 20 + 0.02 * (x - mid.x);
/** And a tower's roof no map has an outline for, 65 m up (not a tree). */
const TOWER = { x: mid.x + 80, y: mid.y - 60 };
const treeAt = (x: number, y: number) => Math.abs(x - TOWER.x) < 8 && Math.abs(y - TOWER.y) < 8 ? 65 : Math.max(0, ...TREES.map(t => { const d = Math.hypot(x - t.x, y - t.y); return d < 5 ? 14 * Math.cos((d / 5) * (Math.PI / 2)) : 0; }));

/** The place found, the token saved, and the height model answering (`asked`: what it was asked for). */
const inDenmarkHere = async (page: Page, opts: { token?: boolean; busyFirst?: boolean } = {}) => {
  const asked: string[] = [];
  let busy = !!opts.busyFirst;
  await page.route(/GeocodeServer\/suggest/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ suggestions: [{ text: `${DK.label}, Denmark`, magicKey: "k1", isCollection: false }] }) }));
  await page.route(/GeocodeServer\/findAddressCandidates/, route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: [{ address: DK.label, score: 100, location: { x: DK.lon, y: DK.lat } }] }) }));
  await page.route(/api\.dataforsyningen\.dk\/dhm_wcs_DAF/, route => {
    const q = new URL(route.request().url()).searchParams;
    // (a busy moment: the first piece asked for times out at the gateway)
    if (busy) { busy = false; return route.fulfill({ status: 504, body: "Gateway Time-out" }); }
    asked.push(`${q.get("coverage")} ${q.get("crs")} ${q.get("token")}`);
    const [x0, y0, x1, y1] = q.get("bbox")!.split(",").map(Number), w = +q.get("width")!, h = +q.get("height")!;
    expect(Math.max(w, h)).toBeLessThanOrEqual(800);
    const px = (x1 - x0) / w;
    const top = q.get("coverage") === "dhm_overflade";
    const body = floatTiff(w, h, (i, j) => { const x = x0 + (i + 0.5) * px, y = y1 - (j + 0.5) * px; return groundAt(x) + (top ? treeAt(x, y) : 0); });
    return route.fulfill({ status: 200, contentType: "image/tiff", body });
  });
  if (opts.token !== false) await page.evaluate(() => localStorage.setItem("glideline-dk-token", "test-token"));
  return asked;
};

test("Denmark: where it is, UTM 32, the spring photo's WMS and the Danish kinds of trees (pure logic)", async () => {
  expect(inDenmark({ north: 55.7, south: 55.6, west: 12.5, east: 12.6 })).toBe(true);
  expect(inDenmark({ north: 39.8, south: 39.7, west: -89.7, east: -89.6 })).toBe(false);
  // (on the zone's middle meridian: 500 km east; either side of it, mirrored)
  expect(toUtm32(56, 9).x).toBeCloseTo(500000, 3);
  const e = toUtm32(56, 10).x - 500000, w = 500000 - toUtm32(56, 8).x;
  expect(e).toBeGreaterThan(62000);
  expect(e).toBeCloseTo(w, 3);
  // (a degree of latitude: about 111 km)
  expect(toUtm32(57, 9).y - toUtm32(56, 9).y).toBeGreaterThan(111000);
  expect(toUtm32(57, 9).y - toUtm32(56, 9).y).toBeLessThan(111500);
  const url = new URL(serviceImageUrl("https://api.dataforsyningen.dk/orto_foraar_DAF", { wms: { layer: "orto_foraar" } }, "1,2,3,4", 64, 32));
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ service: "WMS", request: "GetMap", layers: "orto_foraar", crs: "EPSG:3857", bbox: "1,2,3,4", width: "64", height: "32", format: "image/jpeg" });
  expect(LOOK_VARIANTS.beech.shape).toBe("broadleaf");
  const r = await regionAt(55.4, 10.4);
  expect(r?.name).toBe("Denmark");
  expect(r?.recommended).toEqual(["spruce", "beech", "oak"]);
});

test("in Denmark the import asks for a Dataforsyningen token; saved, it shows Saved · Change and the height model is the ground and the measured trees", async ({ page }) => {
  await inDenmarkHere(page, { token: false });
  await page.getByTestId("welcome-find").click();
  await page.getByLabel("Search address").fill("Springfield Park");
  await page.getByRole("button", { name: /Springfield Park/ }).first().click();
  await expect(page.locator('[data-testid=import-what][data-here=ready]')).toBeVisible({ timeout: 90_000 });
  const row = page.getByTestId("dk-token");
  await expect(row.getByRole("link", { name: "Get a free token" })).toBeVisible();
  // (no token: the ground as anywhere, no measured trees)
  await expect(page.getByTestId("bring-ground")).not.toContainText("DHM");
  await expect(page.getByTestId("bring-lidar")).toHaveCount(0);
  await row.getByPlaceholder("Token").fill("test-token");
  await row.getByPlaceholder("Token").press("Enter");
  await expect(row).toContainText("Saved");
  expect(await page.evaluate(() => localStorage.getItem("glideline-dk-token"))).toBe("test-token");
  await expect(page.getByTestId("bring-ground")).toContainText("DHM 0.4 m");
  await expect(page.getByTestId("bring-lidar")).toContainText("DHM");
  // Change: the field again, the token kept until a new one is saved
  await row.getByTestId("dk-token-change").click();
  await expect(row.getByPlaceholder("Token")).toBeVisible();
  await row.getByPlaceholder("Token").press("Escape");
  await expect(row).toContainText("Saved");
});

test("a site in Denmark comes in on Danmarks Højdemodel: its ground, and the trees standing on it (asked for in pieces, a timed-out one asked again)", async ({ page }) => {
  const asked = await inDenmarkHere(page, { busyFirst: true });
  await importSite(page);
  const doc = await course(page);
  expect(asked.some(a => a === "dhm_terraen EPSG:25832 test-token")).toBe(true);
  expect(asked.some(a => a === "dhm_overflade EPSG:25832 test-token")).toBe(true);
  // (no piece bigger than Dataforsyningen answers in time: the surface in more than one)
  expect(asked.filter(a => a.startsWith("dhm_overflade")).length).toBeGreaterThan(1);
  expect(doc.site.elevationSource).toBe("DHM");
  expect(doc.lidar?.source).toBe("DHM");
  // (the five trees, each where it stands and about as tall)
  const trees = doc.lidar.trees as [number, number, number][];
  expect(trees.length).toBeGreaterThanOrEqual(4);
  expect(trees.length).toBeLessThanOrEqual(6);
  for (const t of trees) { expect(t[2]).toBeGreaterThan(35); expect(t[2]).toBeLessThan(60); }
  // (the ground rises to the east: 2 m in 100 m)
  const rise = await page.evaluate(() => {
    const d = (window as any).__dgCourse(), w = d.canvas.width, h = d.canvas.height;
    const at = (x: number) => { let s = 0, n = 0; for (const [k, v] of Object.entries(d.terrainHeights as Record<string, number>)) { const [kx, ky] = k.split(",").map(Number); if (Math.abs(kx - x) <= d.gridSize && Math.abs(ky - h / 2) <= h * 0.3) { s += v; n++; } } return n ? s / n : 0; };
    return { ft: at(w * 0.9) - at(w * 0.1), across: w * 0.8 };
  });
  expect(rise.ft / rise.across).toBeGreaterThan(0.015);
  expect(rise.ft / rise.across).toBeLessThan(0.025);
});
