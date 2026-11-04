import { test as plain, expect as plainExpect } from "@playwright/test";
import { readFileSync } from "fs";
import { test, expect, course, editorState } from "./fixtures";
import { createBasket, createEmptyCourse, createTee, newHole } from "../../src/lib/course";

// The example as published: a whole course, with nothing in it that places it or names the real one
plain("the example course is whole, and nothing in it says where it is or what it really is", () => {
  const raw = readFileSync("public/example/course.json", "utf8");
  const d = JSON.parse(raw);
  plainExpect(d.name).toBe("Thunder Hollow");
  plainExpect(d.holes.length).toBe(18);
  plainExpect(d.site.location).toBe(null);
  plainExpect(d.site.bounds).toBe(null);
  const words = JSON.stringify({ ...d, background: "", terrainHeights: [] });
  for (const w of ["Siler", "OSDGC", "Franklin", "USGS", "OneMap", "davidiz", "Dnet", "\"lat\":", "\"lon\":"]) plainExpect(words, w).not.toContain(w);
});

/** A small course in the example's place: the whole example, its trees all drawn in software, is
 * more than a test machine keeps up with. */
const stand = () => {
  const d = createEmptyCourse();
  const holes = [newHole(), newHole()];
  return { ...d, id: "example-thunder-hollow", name: "Thunder Hollow", holes, items: holes.flatMap((h, i) => [createTee(h.id, { x: 300 + i * 300, y: 700 }), createBasket(h.id, { x: 500 + i * 300, y: 400 })]) };
};

test("a new visitor to the demo lands on Courses with the example course open behind it, takes the walk round it, and comes back", async ({ page }) => {
  test.setTimeout(300_000);
  await page.route(/\/example\/course\.json$/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify(stand()) }));
  // (a new visitor: not the tests' empty start)
  // (and no place kept in this tab: a refresh keeps it, a new visit has none)
  await page.evaluate(() => { localStorage.removeItem("hyzerlab-start-blank"); sessionStorage.clear(); });
  await page.reload();
  await expect(page.getByTestId("demo-home")).toBeVisible();
  await expect(page.getByTestId("example-card")).toContainText("Thunder Hollow");
  // The example, open behind the page: its holes, and nothing that places it on the earth
  await expect.poll(async () => (await course(page)).holes.length, { timeout: 60_000 }).toBe(2);
  const doc = await course(page);
  expect(doc.name).toBe("Thunder Hollow");
  expect(doc.site.location).toBe(null);
  expect(doc.site.bounds).toBe(null);
  // The walk: every stop, Next to the end
  await page.getByTestId("home-tour-start").click();
  await expect(page.getByTestId("demo-home")).toHaveCount(0);
  await expect(page.getByTestId("tour-title")).toHaveText("This is Thunder Hollow");
  // (the walk taken: Courses' main button is New course from now on)
  expect(await page.evaluate(() => localStorage.getItem("hyzerlab-walked"))).toBe("1");
  const seen: string[] = [];
  const next = async () => { seen.push((await page.getByTestId("tour-title").textContent()) ?? ""); await page.getByTestId("tour-next").click(); };
  for (let i = 0; i < 2; i++) await next();
  // (its two stops in 3D: the whole course in 3D is more than software drawing keeps up with, so
  // the walk is taken through them by its state rather than clicks)
  const at = (n: number) => page.evaluate(n => (window as any).__dgTour.setState({ at: n }), n);
  await at(2);
  await expect.poll(async () => (await editorState(page)).view, { timeout: 60_000 }).toBe("3d");
  await at(3);
  await expect.poll(async () => (await editorState(page)).teeView, { timeout: 60_000 }).toBeTruthy();
  seen.push("In 3D", "From the tee");
  await at(4);
  await expect.poll(async () => (await editorState(page)).teeView, { timeout: 60_000 }).toBe(null);
  await expect.poll(async () => (await editorState(page)).view, { timeout: 60_000 }).toBe("2d");
  for (let i = 0; i < 4; i++) await next();
  await expect(page.getByTestId("tour-title")).toHaveText("Your own course");
  await expect(page.getByTestId("tour-own-course")).toHaveText("Start your own course");
  expect(seen).toContain("A hole");
  expect(seen).toContain("The printed map");
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  expect((await editorState(page)).teeView).toBe(null);
  // The logo brings Courses back; the example is there, open now
  await page.getByTestId("logo-home").click();
  await expect(page.getByTestId("example-card")).toContainText(/open now/i);
  await page.getByTestId("demo-home-back").click();
  await expect(page.getByTestId("demo-home")).toHaveCount(0);
});
