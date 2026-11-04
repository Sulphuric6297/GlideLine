// On site: a hole re-created by walking it with a phone (state/onSite, components/OnSite). The
// phone's GPS is set to plan spots: the tee, two pins, a fairway walked with a bend, an OB line.
import { devices, type Page, type BrowserContext } from "@playwright/test";
import { test, expect, course, editorState } from "./fixtures";

const { defaultBrowserType: _b, ...phone } = devices["iPhone 13"];
test.use({ ...phone, permissions: ["geolocation"], geolocation: { latitude: 40, longitude: -90, accuracy: 3 } });

const bounds = { north: 40, south: 39.99, west: -90, east: -89.99 };
/** A blank course placed on the earth; `geo` turns a plan spot into the phone's reading there. */
async function onEarth(page: Page) {
  await page.getByTestId("welcome-blank").click();
  await expect.poll(async () => (await editorState(page)).tool).toBe("add-hole");
  await page.evaluate(b => { (window as any).__dgActions.site({ bounds: b }); (window as any).__dgEditor().set({ tool: "select" }); }, bounds);
  const { width, height } = (await course(page)).canvas;
  return (x: number, y: number) => ({ latitude: bounds.north - (y / height) * (bounds.north - bounds.south), longitude: bounds.west + (x / width) * (bounds.east - bounds.west), accuracy: 3 });
}
/** Standing at a spot until the dot's there (a reading or two). */
const standAt = async (page: Page, context: BrowserContext, at: { latitude: number; longitude: number; accuracy: number }) => {
  await context.setGeolocation(at);
  await page.waitForTimeout(400);
};

test("on site: a new hole walked onto the map: its tee, pins A and B, the fairway's bend, par, an OB line; then on to the next", async ({ page, context }) => {
  test.setTimeout(240_000);
  const geo = await onEarth(page);
  await standAt(page, context, geo(300, 600));
  // In from the holes list
  // (the Design step's panel, up out of its tab: the holes list, its last row On site)
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Design/ }).tap();
  await page.getByTestId("onsite-new").scrollIntoViewIfNeeded();
  await page.getByTestId("onsite-new").tap();
  const site = page.getByTestId("onsite");
  await expect(site).toHaveAttribute("data-step", "start");
  await expect(page.getByTestId("onsite-title")).toContainText("New hole · On site");
  // (the phone's own panels away: the walk's card instead)
  await expect(page.getByTestId("tee-view-hud")).toHaveCount(0);
  await expect(page.getByTestId("onsite-sure")).toHaveAttribute("data-sure", "good");
  await page.getByTestId("onsite-start").tap();
  await expect(site).toHaveAttribute("data-step", "tee");
  // The 3D view stands where you are
  await expect.poll(async () => (await editorState(page)).teeView).toBe("here");
  // The tee: hold still, six readings averaged
  await page.getByTestId("onsite-set").tap();
  await expect(page.getByTestId("onsite-set")).toContainText("Hold still");
  await expect(site).toHaveAttribute("data-step", "pin", { timeout: 15_000 });
  // Pin A, walked to: the hole's made with its tee and basket
  await standAt(page, context, geo(700, 600));
  await expect(page.getByTestId("onsite-card")).toContainText("from the tee");
  await page.getByTestId("onsite-set").tap();
  await expect.poll(async () => (await course(page)).holes.length, { timeout: 15_000 }).toBe(1);
  let d = await course(page);
  const holeId = d.holes[0].id;
  const tee = d.items.find((i: any) => i.type === "tee"), a = d.items.find((i: any) => i.type === "basket");
  expect(Math.hypot(tee.x - 300, tee.y - 600)).toBeLessThan(8);
  expect(Math.hypot(a.x - 700, a.y - 600)).toBeLessThan(8);
  expect(a.position).toBe("A");
  await expect.poll(async () => (await editorState(page)).teeView).toBe(holeId);
  // Pin B, a step on
  await standAt(page, context, geo(740, 540));
  await page.getByTestId("onsite-another-pin").tap();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "basket").map((b: any) => b.position).sort(), { timeout: 15_000 }).toEqual(["A", "B"]);
  // The fairway: walked from the tee out to a bend and on to the basket
  await page.getByTestId("onsite-next-step").tap();
  await expect(site).toHaveAttribute("data-step", "fairway");
  await standAt(page, context, geo(300, 600));
  await page.getByTestId("onsite-walk").tap();
  for (const [x, y] of [[360, 560], [420, 520], [500, 480], [560, 500], [620, 550], [690, 595]]) await standAt(page, context, geo(x, y));
  await expect(page.getByTestId("onsite-walk")).toContainText("Recording");
  await page.getByTestId("onsite-walk").tap();
  await expect(site).toHaveAttribute("data-step", "finish");
  await expect.poll(async () => (await course(page)).holes[0].doglegs.length).toBeGreaterThan(0);
  // Par: 4; an OB line walked
  await page.getByTestId("onsite-par-4").tap();
  await expect.poll(async () => (await course(page)).holes[0].par).toBe(4);
  await page.getByTestId("onsite-ob").tap();
  for (const [x, y] of [[400, 700], [500, 705], [600, 700]]) await standAt(page, context, geo(x, y));
  await page.getByTestId("onsite-walk").tap();
  await expect.poll(async () => (await course(page)).items.filter((i: any) => i.type === "line" && i.kind === "ob" && i.holeId === holeId).length).toBe(1);
  await expect(page.getByTestId("onsite-facts")).toContainText("A, B");
  // Next: a new hole (this was the last), from its tee
  await page.getByTestId("onsite-next").tap();
  await expect(site).toHaveAttribute("data-step", "tee");
  await expect(page.getByTestId("onsite-title")).toContainText("New hole · Tee");
  // The map instead of the 3D view, and out: what's set stays
  await page.getByTestId("onsite-map").tap();
  await expect.poll(async () => (await editorState(page)).teeView).toBeNull();
  await page.getByTestId("onsite-close").tap();
  await expect(site).toHaveCount(0);
  d = await course(page);
  expect(d.holes.length).toBe(1);
});

test("on site for a hole that's there: Keep moves its tee to where you stand; a weak signal is said, and can still be set", async ({ page, context }) => {
  test.setTimeout(180_000);
  const geo = await onEarth(page);
  await page.evaluate(() => (window as any).__dgActions.addHole({ x: 300, y: 300 }, { x: 600, y: 300 }));
  const hole = (await course(page)).holes[0];
  await standAt(page, context, { ...geo(320, 320), accuracy: 5 });
  // From the hole's strip
  await page.evaluate(id => (window as any).__dgActions.select(id), hole.id);
  await page.getByTestId("strip-onsite").tap();
  await page.getByTestId("onsite-hole").tap();
  await expect(page.getByTestId("onsite-title")).toContainText("Hole 1 · On site");
  await page.getByTestId("onsite-keep").tap();
  await expect(page.getByTestId("onsite-sure")).toHaveAttribute("data-sure", "fair");
  await page.getByTestId("onsite-set").tap();
  await expect(page.getByTestId("onsite")).toHaveAttribute("data-step", "pin", { timeout: 15_000 });
  const tee = (await course(page)).items.find((i: any) => i.type === "tee");
  expect(Math.hypot(tee.x - 320, tee.y - 320)).toBeLessThan(10);
  // Keep the pins, the bends; leave
  await page.getByTestId("onsite-skip").tap();
  await expect(page.getByTestId("onsite")).toHaveAttribute("data-step", "fairway");
  await page.getByTestId("onsite-close").tap();
  expect((await course(page)).items.filter((i: any) => i.type === "basket").length).toBe(1);
});
