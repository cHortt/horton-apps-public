import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const modules = process.env.VOCAL_TEST_MODULES || "/tmp/vocal-test/node_modules";
const load = (path) => import(pathToFileURL(join(modules, path)).href);
const { PNG } = await load("pngjs/lib/png.js");
const pixelmatch = (await load("pixelmatch/index.js")).default;
const { chromium } = await load("playwright/index.mjs");

const root = new URL("..", import.meta.url).pathname;
const fixture = new URL("../fixtures/song-title.musicxml", import.meta.url).pathname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".musicxml": "application/xml",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/plain",
};
const devices = {
  "iphone-portrait": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "iphone-landscape": { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  "ipad-landscape": { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
// Visible system counts from the B4 mock at these viewports.
const structure = {
  "iphone-portrait": { systems: 16, visible: 5, staffPct: 662 / 844 },
  "iphone-landscape": { systems: 8, visible: 3, staffPct: 342 / 390 },
  "ipad-landscape": { systems: 4, visible: 4, staffPct: 638 / 820 },
};

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(path);
      res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function chromeMatch(live, ref, mask) {
  const a = new PNG({ width: live.width, height: live.height });
  const b = new PNG({ width: live.width, height: live.height });
  a.data.set(live.data);
  b.data.set(ref.data);
  let chrome = 0;
  for (let y = 0; y < live.height; y++) {
    for (let x = 0; x < live.width; x++) {
      const cssX = x / mask.dpr;
      const cssY = y / mask.dpr;
      const inStaff = cssX >= mask.staff.x && cssX < mask.staff.r && cssY >= mask.staff.y && cssY < mask.staff.b;
      const inDrawer = mask.drawer && cssX >= mask.drawer.x && cssX < mask.drawer.r && cssY >= mask.drawer.y && cssY < mask.drawer.b;
      const i = (y * live.width + x) * 4;
      if (inStaff && !inDrawer) {
        a.data[i] = a.data[i + 1] = a.data[i + 2] = b.data[i] = b.data[i + 1] = b.data[i + 2] = 255;
        a.data[i + 3] = b.data[i + 3] = 255;
      } else chrome++;
    }
  }
  const diff = new PNG({ width: live.width, height: live.height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, live.width, live.height, { threshold: 0.1 });
  return { ratio: 1 - mismatched / chrome, mismatched, chrome, diff };
}

async function loadSong(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.setInputFiles("#file", fixture);
  await page.waitForFunction(() => document.querySelector("#song-title")?.textContent === "Song title");
  await page.waitForSelector(".system");
}

async function armUndo(page) {
  await page.locator('[data-part="A"]').click();
  const note = page.locator('ellipse[data-parts="A"][data-pitch="A4"][data-bar="2"]');
  assert.equal(await note.count(), 1);
  await note.click();
  await page.locator("#up").click();
  await page.locator("#down").click();
  await page.waitForFunction(() => document.querySelector("#readout")?.textContent === "High · bar 2 · A4");
}

test("B4 chrome matches the mock and the staff wraps onto the same systems", { timeout: 120000 }, async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const [dev, state] of [
      ["iphone-portrait", "selected"],
      ["iphone-portrait", "none"],
      ["iphone-portrait", "more"],
      ["iphone-landscape", "selected"],
      ["ipad-landscape", "selected"],
    ]) {
      const context = await browser.newContext(devices[dev]);
      const page = await context.newPage();
      await page.goto(`${origin}/index.html`, { waitUntil: "load" });
      await loadSong(page);
      await armUndo(page);
      if (state === "none") {
        await page.locator("#staff").click({ position: { x: 200, y: 90 } });
        await page.waitForFunction(() => document.querySelector("#song-title")?.textContent === "Song title" && document.querySelector("#readout").hidden);
        if ((await page.locator("#play-from-label").textContent()) !== "Play from 1") {
          await page.locator("#bar-prev").click();
        }
        await page.waitForFunction(() => document.querySelector("#play-from-label").textContent === "Play from 1");
      }
      if (state === "more") {
        await page.locator("#more").click();
        await page.waitForSelector("#drawer:not([hidden])");
        await page.waitForFunction(() => document.querySelector("#drawer-heading").textContent === "High · bar 2");
      }
      const mask = await page.evaluate(() => {
        const box = (el) => {
          if (!el || el.hidden || el.closest("[hidden]")) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, r: r.right, b: r.bottom };
        };
        const staff = document.getElementById("staff").getBoundingClientRect();
        const systems = [...document.querySelectorAll(".system")].map((system) => {
          const r = system.getBoundingClientRect();
          return { first: Number(system.dataset.first), last: Number(system.dataset.last), top: r.top, bottom: r.bottom };
        });
        const visible = systems.filter((system) => system.bottom > staff.top + 1 && system.top < staff.bottom - 1);
        const small = [...document.querySelectorAll("button, a.home")].filter((el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || el.closest("[hidden]")) return false;
          return r.width < 44 || r.height < 44;
        }).map((el) => (el.getAttribute("aria-label") || el.textContent).trim());
        return {
          dpr: window.devicePixelRatio,
          staff: { x: staff.left, y: staff.top, r: staff.right, b: staff.bottom },
          drawer: box(document.getElementById("drawer")),
          staffPct: staff.height / innerHeight,
          systems: systems.length,
          visible: visible.length,
          measures: visible.reduce((sum, system) => sum + system.last - system.first + 1, 0),
          small,
        };
      });
      const live = PNG.sync.read(await page.screenshot());
      const ref = PNG.sync.read(readFileSync(new URL(`b4-${dev}-${state}.png`, import.meta.url)));
      assert.equal(live.width, ref.width, `${dev} ${state} width`);
      assert.equal(live.height, ref.height, `${dev} ${state} height`);
      const match = chromeMatch(live, ref, mask);
      const expect = structure[dev];
      report.push({ dev, state, chrome: Number((match.ratio * 100).toFixed(2)), staffPct: Number((mask.staffPct * 100).toFixed(1)), systems: mask.systems, visible: mask.visible, measures: mask.measures });
      // References are a same-browser render of the B4 mock source, so font
      // rasterization matches this Playwright Chromium. Every screen must clear 97%.
      if (match.ratio < 0.97) writeFileSync(`/tmp/b4-diff-${dev}-${state}.png`, PNG.sync.write(match.diff));
      assert.ok(match.ratio >= 0.97, `${dev} ${state} chrome match ${(match.ratio * 100).toFixed(2)}% (${match.mismatched} px)`);
      assert.equal(mask.systems, expect.systems, `${dev} system count`);
      assert.ok(Math.abs(mask.visible - expect.visible) <= 1, `${dev} visible systems ${mask.visible}`);
      assert.ok(Math.abs(mask.staffPct - expect.staffPct) < 0.03, `${dev} staff ${(mask.staffPct * 100).toFixed(1)}%`);
      assert.deepEqual(mask.small, [], `${dev} ${state} tap targets under 44px`);
      await context.close();
    }
  } finally {
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
