import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
// Reuse the evaluation workspace's installed browser runtime when the client
// workspace has no Playwright dependency; no package installation is needed.
const { chromium } = await import('playwright').catch(
  () => import('../../../../eval/browser/node_modules/playwright/index.mjs')
);
const server = await createServer({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: false,
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/browser/elasticMotion.html?crowded`);
  await page.waitForFunction(() => window.motionFixture);
  const clearance = () =>
    page.evaluate(() => {
      const r = window.motionFixture.renderer,
        nodes = window.motionFixture.graph.mapNodes((id, a) => ({
          id,
          p: window.motionFixture.sigma.graphToViewport(a),
          radius: window.motionFixture.sigma.scaleSize(a.size),
        }));
      let minimum = Infinity;
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++)
          minimum = Math.min(
            minimum,
            Math.hypot(nodes[i].p.x - nodes[j].p.x, nodes[i].p.y - nodes[j].p.y) - nodes[i].radius - nodes[j].radius
          );
      return minimum;
    });
  await page.waitForTimeout(3000);
  assert.ok((await clearance()) > 0.5, 'Crowded glyphs still overlap after settling');
  await page.evaluate(() => window.motionFixture.sigma.getCamera().setState({ ratio: 4 }));
  await page.waitForTimeout(3000);
  assert.ok((await clearance()) > 0.5, 'Zoom-out left overlapping glyphs');
  await page.evaluate(() => window.motionFixture.sigma.getCamera().setState({ ratio: 0.25 }));
  await page.waitForTimeout(3000);
  assert.ok((await clearance()) > 0.5, 'Zoom-in did not reheat settled collision handling');
  const pan = await page.evaluate(() => {
    const r = window.motionFixture.renderer;
    let events = 0;
    r.setViewChangeHandler(() => events++);
    const before = r.getViewportState().bounds;
    const camera = window.motionFixture.sigma.getCamera();
    camera.setState({ x: camera.getState().x + 0.2 });
    return { before, after: r.getViewportState().bounds, events, ratio: camera.getState().ratio };
  });
  assert.ok(pan.events > 0, 'Panning did not notify viewport selection');
  assert.notEqual(pan.before.xmin, pan.after.xmin);
  assert.equal(pan.ratio, 0.25);
  await page.evaluate(() => {
    const r = window.motionFixture.renderer;
    r.setMotionEnabled(false);
    window.motionFixture.sigma.getCamera().setState({ ratio: 2 });
  });
  const paused = await page.evaluate(() => window.motionFixture.graph.mapNodes((_id, a) => [a.x, a.y]));
  await page.waitForTimeout(500);
  assert.deepEqual(
    await page.evaluate(() => window.motionFixture.graph.mapNodes((_id, a) => [a.x, a.y])),
    paused,
    'Camera change ignored Motion off'
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 53 crowded nodes, projected collision clearance, zoom-out scaling, zoom reheating, pan notification and Motion off.'
  );
} finally {
  await browser?.close();
  await server.close();
}
