import { readFileSync } from "fs";
import { test as plain, expect as plainExpect, type Page } from "@playwright/test";
import { test, expect, addHole, blankCourse, course, editorState, flyButton, teeCard } from "./fixtures";
import { VIDEO_HOLD, avcCodec, videoBitrate, videoSuffix, videoTimeline, vp9Codec } from "../../src/lib/video";
import { flightClock } from "../../src/lib/flight";

// 3D renders in software here, so the videos in these tests are small (320 x 180 or less).
const small = (page: Page, width = 320, height = 180) => page.evaluate(([width, height]) => (window as any).__dgVideo().set({ size: { width, height }, fps: 30 }), [width, height]);

/** A short course on open ground: two holes, 250 ft and 300 ft (each flies for 6 seconds). */
async function twoHoles(page: Page, size: [number, number] = [320, 180]) {
  await blankCourse(page);
  await addHole(page, { x: 400, y: 700 }, { x: 650, y: 700 });
  await addHole(page, { x: 700, y: 650 }, { x: 700, y: 350 });
  await page.keyboard.press("Escape");
  await small(page, ...size);
  // (over the photo: painting the ground is tested on its own, and drawn in software here it
  // would take most of a recording's time)
  await page.evaluate(() => (window as any).__dgEditor().set({ flyLook: "photo" }));
}

/** What the browser makes of a video file: its length and size (after loading its metadata). */
const probe = (page: Page, data: Buffer, type: string) =>
  page.evaluate(async ({ b64, type }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const v = document.createElement("video");
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type }));
    await new Promise<void>((resolve, reject) => { v.onloadedmetadata = () => resolve(); v.onerror = () => reject(new Error("not a video")); });
    // WebM from a MediaRecorder has no duration until the end is read
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e6;
      await new Promise(r => (v.ondurationchange = r));
    }
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  }, { b64: data.toString("base64"), type });

/** Notes every toast from now on (they go after a few seconds, and a busy machine can miss one). */
const watchToasts = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__toasts = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll("[role=status] > span")) if (!w.__toasts.includes(el.textContent)) w.__toasts.push(el.textContent);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
const toasts = (page: Page) => page.evaluate(() => (((window as any).__toasts ?? []) as string[]).join("\n"));

/** A real video file: an MP4 ("ftyp" box) or a WebM (EBML header). */
const kindOf = (data: Buffer) => (data.subarray(4, 8).toString("latin1") === "ftyp" ? "mp4" : data.subarray(0, 4).toString("hex") === "1a45dfa3" ? "webm" : "?");

test("record a hole's flyover from the Export step: progress, then a real video file", async ({ page }) => {
  // (drawn in software here: a 10 s video takes minutes)
  test.setTimeout(420_000);
  await twoHoles(page);
  await watchToasts(page);
  await page.getByRole("button", { name: "4 Export" }).click();
  const section = page.getByTestId("video-export");
  await section.getByTestId("video-holes").selectOption({ label: "Hole 1" });
  await expect(section.getByTestId("video-record")).toHaveText(/Export video of hole 1/);
  const downloading = page.waitForEvent("download", { timeout: 380_000 });
  await section.getByTestId("video-record").click();
  // The progress bar (in the banner at the top of the step) moves while the frames are made, and
  // only one export runs at a time
  await expect(page.getByTestId("export-busy").getByTestId("video-progress")).toBeVisible();
  await expect(page.getByTestId("export-map-svg")).toBeDisabled();
  // (after the ground is painted: the whole site's, then the hole's sharper)
  await expect.poll(async () => Number(await page.getByTestId("video-progress").getAttribute("aria-valuenow")), { timeout: 120_000 }).toBeGreaterThan(5);
  const download = await downloading;
  // (a 6 s flight plays for longer: it gets going and slows to a stop gently)
  const plays = flightClock(6, true).play;
  await expect.poll(() => toasts(page), { timeout: 30_000 }).toContain(`Flyover video saved: ${Math.round(plays + VIDEO_HOLD.intro + VIDEO_HOLD.outro)} s, 320 × 180, `);
  const data = readFileSync((await download.path())!);
  const kind = kindOf(data);
  expect(["mp4", "webm"]).toContain(kind);
  expect(download.suggestedFilename()).toBe(`new-disc-golf-course-hole-1-flyover.${kind}`);
  expect(data.length).toBeGreaterThan(20_000);
  // It plays: the hold on the title, a 6 second flight and the hold at the basket, at 320 x 180
  const video = await probe(page, data, kind === "mp4" ? "video/mp4" : "video/webm");
  expect(video.width).toBe(320);
  expect(video.height).toBe(180);
  expect(video.duration).toBeGreaterThan(plays + VIDEO_HOLD.intro);
  expect(video.duration).toBeLessThan(plays + VIDEO_HOLD.intro + VIDEO_HOLD.outro + 0.5);
  // Done: the progress is gone, the Record button is back and the map view is as it was
  await expect(page.getByTestId("video-progress")).toBeHidden();
  await expect(section.getByTestId("video-record")).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__dgView.flyProgress())).toBeNull();
  expect((await editorState(page)).teeView).toBeNull();
});

test("from the Export step's video: Play flyover flies the hole picked, Edit flyover opens the Flyover editor on it", async ({ page }) => {
  test.setTimeout(180_000);
  await twoHoles(page, [160, 90]);
  const second = (await course(page)).holes[1].id;
  const tee = () => page.evaluate(() => { const e = (window as any).__dgEditor(); return [e.teeView, e.flyover, !!e.flyCam]; });
  await page.getByRole("button", { name: "4 Export" }).click();
  const section = page.getByTestId("video-export");
  await section.getByTestId("video-holes").selectOption({ label: "Hole 2" });
  await section.getByTestId("video-camera-settings").click();
  await expect.poll(tee).toEqual([second, false, true]);
  await expect(page.getByTestId("cam-panel").getByTestId("flyover-settings")).toBeVisible();
  // (Done: back where it was opened, off the tee)
  await page.getByTestId("cam-done").click();
  await expect.poll(tee).toEqual([null, false, false]);
  await page.getByTestId("video-export").getByTestId("video-fly").click();
  await expect.poll(tee).toEqual([second, true, false]);
});

test("cancel stops a recording, and leaving the Export step doesn't", async ({ page }) => {
  test.setTimeout(120_000);
  await twoHoles(page, [160, 90]);
  await watchToasts(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "4 Export" }).click();
  await expect(page.getByTestId("video-record")).toHaveText(/Export video of the course/);
  await page.getByTestId("video-record").click();
  await expect.poll(async () => Number(await page.getByTestId("video-progress").getAttribute("aria-valuenow")), { timeout: 60_000 }).toBeGreaterThan(1);
  // Off to another step: the recording goes on, shown over the map
  await page.getByRole("button", { name: "2 Design" }).click();
  const pill = page.getByTestId("export-progress-pill");
  // (it says what it's on: over the photo, each hole as it's recorded)
  await expect(pill).toContainText(/Recording hole [12] \([12] of 2\)/);
  const at = Number(await pill.getByRole("progressbar").getAttribute("aria-valuenow"));
  await expect.poll(async () => Number(await pill.getByRole("progressbar").getAttribute("aria-valuenow")), { timeout: 60_000 }).toBeGreaterThan(at);
  // Back, and cancel
  await page.getByRole("button", { name: "4 Export" }).click();
  await page.getByTestId("video-cancel").click();
  await expect(page.getByTestId("video-progress")).toBeHidden();
  await expect.poll(() => toasts(page), { timeout: 30_000 }).toContain("Cancelled: Course flyover video.");
  await expect(page.getByTestId("video-record")).toBeEnabled();
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  // The map still works: the view from the first tee
  await page.getByRole("button", { name: "2 Design" }).click();
  await page.getByTestId("hole-row").first().click();
  await page.getByTestId("tee-view").click();
  await expect(teeCard(page)).toContainText("Par 3 · 250 ft");
  await expect(page.getByTestId("pov-basket")).toContainText("250 ft");
});

test("the Record button over a flyover records that hole", async ({ page }) => {
  // (the recording and the flight on screen at once, drawn in software)
  test.setTimeout(330_000);
  await twoHoles(page, [160, 90]);
  // (small, so it is quick: the size is the Export step's choice, tested there)
  await page.evaluate(() => (window as any).__dgVideo().set({ size: { width: 320, height: 180 } }));
  await page.getByTestId("hole-row").nth(1).click();
  await page.getByTestId("flyover").click();
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Pause");
  const downloading = page.waitForEvent("download", { timeout: 300_000 });
  // (Export video, on the bar)
  const record = page.getByTestId("tee-bar").getByTestId("fly-export");
  await record.click();
  // (Exporting… until the frames start coming, then how far along it is)
  await expect(record).toHaveText(/Exporting( \d+%|…)/);
  await expect(record).toHaveText(/Exporting \d+%/, { timeout: 60_000 });
  await expect(page.getByTestId("export-progress-pill")).toContainText("Recording hole 2");
  // The flight on screen goes on by itself, separate from the recording, and lands (held on its
  // last picture)
  await expect(flyButton(page)).toHaveAttribute("aria-label", "Play", { timeout: 60_000 });
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^new-disc-golf-course-hole-2-flyover\.(mp4|webm)$/);
  expect(kindOf(readFileSync((await download.path())!))).not.toBe("?");
  await expect(record).toHaveText("Export video");
  await expect(page.getByTestId("export-progress-pill")).toBeHidden();
  // Still looking at hole 2
  expect((await editorState(page)).teeView).toBe(await page.evaluate(() => (window as any).__dgCourse().holes[1].id));
});

test("while a video records, the view from the tee holds still (the recording's frames come first)", async ({ page }) => {
  test.setTimeout(180_000);
  await twoHoles(page, [320, 180]);
  await page.getByTestId("hole-row").nth(1).click();
  await page.getByTestId("tee-view").click();
  await expect(teeCard(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__dgEditor().wind)).toBe(true);
  const info = () => page.evaluate(() => (window as any).__dgView.drawInfo() as { frames: number; recording: boolean });
  const downloading = page.waitForEvent("download", { timeout: 150_000 });
  await page.getByTestId("tee-bar").getByTestId("fly-export").click();
  await expect.poll(async () => (await info()).recording).toBe(true);
  await page.waitForTimeout(300);
  // Nothing moves on screen but the breeze: it waits (it once kept redrawing the screen and took
  // most of the recording's time on a slow computer)
  const a = await info();
  await page.waitForTimeout(1500);
  const b = await info();
  expect(a.recording && b.recording, "still recording while counted").toBe(true);
  expect(b.frames - a.frames).toBeLessThanOrEqual(1);
  await downloading;
  // The breeze again afterwards
  await expect.poll(async () => (await info()).recording).toBe(false);
  const c = (await info()).frames;
  await expect.poll(async () => (await info()).frames - c, { timeout: 20_000 }).toBeGreaterThan(1);
});

test("without WebCodecs, the flyover is recorded in real time with a MediaRecorder", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    delete (window as any).VideoEncoder;
    delete (window as any).VideoFrame;
  });
  await page.reload();
  await twoHoles(page);
  await page.getByRole("button", { name: "4 Export" }).click();
  await page.getByTestId("video-holes").selectOption({ label: "Hole 1" });
  const downloading = page.waitForEvent("download", { timeout: 150_000 });
  const started = Date.now();
  await page.getByTestId("video-record").click();
  const download = await downloading;
  // Real time: it takes as long as the video lasts
  expect(Date.now() - started).toBeGreaterThan(6000);
  const data = readFileSync((await download.path())!);
  expect(kindOf(data)).toBe("webm");
  const video = await probe(page, data, "video/webm");
  expect(video.width).toBe(320);
  expect(video.duration).toBeGreaterThan(5);
});

test("in real time, getting the next hole ready is left out of the video (its frames all go in)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    delete (window as any).VideoEncoder;
    delete (window as any).VideoFrame;
    const w = window as any;
    w.__frameTimes = [];
    const req = CanvasCaptureMediaStreamTrack.prototype.requestFrame;
    CanvasCaptureMediaStreamTrack.prototype.requestFrame = function () {
      w.__frameTimes.push(performance.now());
      return req.call(this);
    };
  });
  await page.reload();
  await twoHoles(page);
  // Getting hole 2 ready takes longer than its flight
  await page.evaluate(() => {
    const w = window as any, v = w.__dgView;
    const frames = v.flightFrames.bind(v);
    v.flightFrames = (width: number, height: number) => {
      const f = frames(width, height);
      let n = 0;
      return { ...f, duration: f.duration, draw: f.draw, dispose: f.dispose, prepare: async (id: string) => {
        if (n++ === 1) await new Promise(r => setTimeout(r, 7000));
        await f.prepare?.(id);
        w.__secondReady = performance.now();
      } };
    };
  });
  await page.getByRole("button", { name: "4 Export" }).click();
  await page.getByTestId("video-holes").selectOption("all");
  const downloading = page.waitForEvent("download", { timeout: 200_000 });
  await page.getByTestId("video-record").click();
  await downloading;
  const { after, all } = await page.evaluate(() => {
    const w = window as any;
    return { after: (w.__frameTimes as number[]).filter(t => t >= w.__secondReady).length, all: w.__frameTimes.length };
  });
  console.log(`frames: ${all}, after hole 2 was ready: ${after}`);
  // About as many of hole 2's frames as hole 1's (both fly for 6 s; software drawing here skips some
  // of each, more on a slow machine); left out, hole 2 would have next to none
  expect(after).toBeGreaterThan((all - after) * 0.6);
});

test("where the browser encodes H.264, the video is an MP4", async ({ page }) => {
  test.setTimeout(150_000);
  // Chromium here has no H.264 encoder: a stand-in that takes H.264 settings and gives out
  // (meaningless) H.264 chunks, so the MP4 file around them can be checked
  await page.addInitScript(() => {
    const Real = (window as any).VideoEncoder;
    class StandIn {
      static async isConfigSupported(c: any) { return { supported: c.codec.startsWith("avc1.6400") || (await Real.isConfigSupported(c)).supported, config: c }; }
      state = "unconfigured";
      encodeQueueSize = 0;
      private config: any;
      private n = 0;
      constructor(private init: { output: (chunk: unknown, meta?: unknown) => void; error: (e: unknown) => void }) {}
      configure(c: any) { this.config = c; this.state = "configured"; (window as any).__configured = c.codec; }
      encode(frame: any, opts?: { keyFrame?: boolean }) {
        const chunk = new (window as any).EncodedVideoChunk({ type: opts?.keyFrame ? "key" : "delta", timestamp: frame.timestamp, duration: frame.duration ?? undefined, data: new Uint8Array([0, 0, 0, 4, 0x65, 0x88, 0x84, 0x00]) });
        const first = this.n++ === 0;
        const avcC = new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
        queueMicrotask(() => this.init.output(chunk, first ? { decoderConfig: { codec: this.config.codec, codedWidth: this.config.width, codedHeight: this.config.height, description: avcC } } : undefined));
      }
      async flush() { await new Promise(r => setTimeout(r, 10)); }
      close() { this.state = "closed"; }
      addEventListener() {}
      removeEventListener() {}
    }
    (window as any).VideoEncoder = StandIn;
  });
  await page.reload();
  await twoHoles(page, [160, 90]);
  await page.getByRole("button", { name: "4 Export" }).click();
  await page.getByTestId("video-holes").selectOption({ label: "Hole 2" });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByTestId("video-record").click()]);
  expect(download.suggestedFilename()).toBe("new-disc-golf-course-hole-2-flyover.mp4");
  expect(await page.evaluate(() => (window as any).__configured)).toBe("avc1.64001e");
  const data = readFileSync((await download.path())!);
  expect(kindOf(data)).toBe("mp4");
  // Its boxes follow each other to the end of the file (the media's size written in at the end)
  const boxes: string[] = [];
  for (let at = 0; at < data.length;) {
    const size = data.readUInt32BE(at);
    expect(size).toBeGreaterThan(7);
    boxes.push(data.subarray(at + 4, at + 8).toString("latin1"));
    at += size;
    if (at === data.length) break;
    expect(at).toBeLessThan(data.length);
  }
  expect(boxes).toEqual(["ftyp", "mdat", "moov"]);
  expect(data.includes(Buffer.from("avcC"))).toBe(true);
});

plain("video codecs: the H.264 and VP9 level fits the size and frame rate", () => {
  plainExpect(avcCodec(1920, 1080, 30)).toBe("avc1.640028");
  plainExpect(avcCodec(1920, 1080, 60)).toBe("avc1.64002a");
  plainExpect(avcCodec(1280, 720, 30)).toBe("avc1.64001f");
  plainExpect(avcCodec(2560, 1440, 30)).toBe("avc1.640032");
  plainExpect(avcCodec(3840, 2160, 30)).toBe("avc1.640033");
  plainExpect(avcCodec(3840, 2160, 60)).toBe("avc1.640034");
  plainExpect(avcCodec(1920, 1080, 30, "baseline")).toBe("avc1.42e028");
  plainExpect(vp9Codec(320, 180, 30)).toBe("vp09.00.11.08");
  plainExpect(vp9Codec(1920, 1080, 30)).toBe("vp09.00.40.08");
  plainExpect(vp9Codec(3840, 2160, 60)).toBe("vp09.00.51.08");
  plainExpect(videoBitrate(1920, 1080, 30)).toBeGreaterThan(6e6);
  plainExpect(videoBitrate(1920, 1080, 60)).toBeGreaterThan(videoBitrate(1920, 1080, 30));
});

plain("the frames of a recording: a title, the flight at a steady step, a hold at the basket", () => {
  const frames = videoTimeline([6, 10], 30);
  const intro = Math.round(VIDEO_HOLD.intro * 30), outro = Math.round(VIDEO_HOLD.outro * 30);
  plainExpect(frames).toHaveLength(2 * (intro + outro) + 180 + 300);
  // Two cuts, one per hole
  plainExpect(frames.filter(f => f.cut).map(f => f.hole)).toEqual([0, 1]);
  const flight = frames.filter(f => f.hole === 0 && f.render && f.t > 0);
  plainExpect(flight).toHaveLength(180);
  flight.forEach((f, i) => plainExpect(Math.abs(f.t - (i + 1) / 30)).toBeLessThan(1e-9));
  plainExpect(flight[flight.length - 1].t).toBe(6);
  // Drawn once per moment: held frames repeat the picture
  plainExpect(frames.filter(f => f.render)).toHaveLength(2 + 180 + 300);
  // The title shows at the start and is gone a second into the flight
  plainExpect(frames[0].title).toBe(1);
  plainExpect(flight[45].title).toBe(0);
  const doc = { holes: [{ id: "a" }, { id: "b" }, { id: "c" }] } as any;
  plainExpect(videoSuffix(doc, ["c"])).toBe("-hole-3-flyover");
  plainExpect(videoSuffix(doc, ["a", "b", "c"])).toBe("-course-flyover");
});
