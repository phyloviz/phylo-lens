import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--no-sandbox",
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? ["--no-zygote", "--single-process"] : []),
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/browser/elasticMotion.html`);
  await page.waitForFunction(() => window.motionFixture);
  await page.waitForTimeout(2800);
  const initialError = await page.evaluate(() => {
    const { renderer: r, snapshot } = window.motionFixture;
    return Math.max(
      ...snapshot.nodes.map((n) =>
        Math.hypot(r.graph.getNodeAttribute(n.id, "x") - n.x, r.graph.getNodeAttribute(n.id, "y") - n.y),
      ),
    );
  });
  assert.ok(initialError < 1e-6, "Motion deformed the initial server layout");
  const screenPoint = () =>
    page.evaluate(() => {
      const r = window.motionFixture.renderer;
      return r.sigma.graphToViewport(r.graph.getNodeAttributes("0"));
    });
  const start = await screenPoint(),
    destination = { x: start.x + 180, y: start.y + 110 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await page.waitForTimeout(400);
  const held = await screenPoint();
  assert.ok(Math.hypot(held.x - destination.x, held.y - destination.y) < 1, "Grabbed node did not follow the pointer");
  assert.ok(
    await page.evaluate(() => {
      const { renderer: r, snapshot } = window.motionFixture,
        n = snapshot.nodes[1];
      return Math.hypot(r.graph.getNodeAttribute("1", "x") - n.x, r.graph.getNodeAttribute("1", "y") - n.y) > 0.01;
    }),
    "Worker did not move connected nodes",
  );
  await page.mouse.up();
  await page.waitForTimeout(3500);
  const settledPositions = await page.evaluate(() =>
    window.motionFixture.renderer.graph.mapNodes((id, a) => ({ id, x: a.x, y: a.y })),
  );
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate((before) => {
      const r = window.motionFixture.renderer;
      return Math.max(
        ...before.map((n) => {
          const a = r.graph.getNodeAttributes(n.id);
          return Math.hypot(n.x - a.x, n.y - a.y);
        }),
      );
    }, settledPositions),
    0,
    "Motion continued after settling",
  );
  await page.evaluate(() => window.motionFixture.renderer.setMotionEnabled(false));
  const pausedStart = await screenPoint(),
    pausedEnd = { x: pausedStart.x - 140, y: pausedStart.y - 130 };
  await page.mouse.move(pausedStart.x, pausedStart.y);
  await page.mouse.down();
  await page.mouse.move(pausedEnd.x, pausedEnd.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const paused = await screenPoint();
  assert.ok(Math.hypot(paused.x - pausedEnd.x, paused.y - pausedEnd.y) < 1, "Paused dragging was constrained");
  const focusBefore = await page.evaluate(() => {
    const { renderer: r, snapshot } = window.motionFixture;
    const p = r.sigma.graphToViewport(r.graph.getNodeAttributes("0"));
    r.zoomPointer = p;
    r.applyGraphSnapshot({ ...snapshot, viewMeta: { ...snapshot.viewMeta, lodLevel: 1 } });
    return p;
  });
  await page.waitForTimeout(400);
  const focusAfter = await screenPoint();
  assert.ok(
    Math.hypot(focusBefore.x - focusAfter.x, focusBefore.y - focusAfter.y) < 1,
    "LoD transition moved the zoom focus",
  );
  assert.ok(
    await page.evaluate(() => {
      const { renderer: r, snapshot } = window.motionFixture;
      return (
        !r.isMotionEnabled() &&
        snapshot.nodes.every(
          (n) =>
            Math.hypot(r.graph.getNodeAttribute(n.id, "x") - n.x, r.graph.getNodeAttribute(n.id, "y") - n.y) < 1e-6,
        )
      );
    }),
    "LoD did not restore server positions or preserve Pause",
  );
  await page.evaluate(() => window.motionFixture.renderer.resetLayoutEdits());
  assert.deepEqual(errors, []);
  console.log(
    "PASS: initial layout, real worker, direct/paused dragging, settling, LoD focus, server return and reset.",
  );
} finally {
  await browser?.close();
  await server.close();
}
