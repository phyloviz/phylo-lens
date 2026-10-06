import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
  options: {
    'api-url': { type: 'string' },
    dataset: { type: 'string' },
    layout: { type: 'string' },
    tiers: { type: 'string' },
    nodes: { type: 'string' },
    'focus-x': { type: 'string' },
    'focus-y': { type: 'string' },
    help: { type: 'boolean' },
  },
});
const usage =
  'Usage: node tests/browser/zoomRefinement.mjs --api-url URL --dataset ID --layout VERSION --tiers N --nodes N [--focus-x X --focus-y Y]';
if (values.help) {
  console.log(usage);
  process.exit(0);
}
for (const name of ['api-url', 'dataset', 'layout', 'tiers', 'nodes']) if (!values[name]) throw new Error(usage);
for (const name of ['tiers', 'nodes'])
  if (!Number.isSafeInteger(Number(values[name])) || Number(values[name]) < 1)
    throw new Error(`${name} must be a positive integer`);
if ((values['focus-x'] === undefined) !== (values['focus-y'] === undefined))
  throw new Error('Supply both focus coordinates');
if (
  values['focus-x'] !== undefined &&
  (!Number.isFinite(Number(values['focus-x'])) || !Number.isFinite(Number(values['focus-y'])))
)
  throw new Error('Focus coordinates must be finite');
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
  await page.evaluate(
    config =>
      window.startLiveViewport(
        config['api-url'],
        config.dataset,
        config.layout,
        Number(config.tiers),
        Number(config.nodes)
      ),
    values
  );
  await page.waitForTimeout(1500);
  if (values['focus-x'] !== undefined)
    await page.evaluate(config => {
      const r = window.motionFixture.renderer;
      r.centerOnCoordinates(Number(config['focus-x']), Number(config['focus-y']));
    }, values);
  await page.waitForTimeout(500);
  const sweep = [];
  for (const zoom of [1.9, 5, 10, 25, 51.22, 100]) {
    await page.evaluate(zoom => {
      const r = window.motionFixture.renderer;
      window.motionFixture.sigma.getCamera().setState({ ratio: 1 / zoom });
    }, zoom);
    await page.waitForTimeout(3500);
    const state = await page.evaluate(() => {
      const r = window.motionFixture.renderer;
      const last = window.liveViewport.requests.at(-1);
      return {
        ...last,
        markerRadius: window.motionFixture.sigma.scaleSize(3),
        cameraRatio: window.motionFixture.sigma.getCamera().getState().ratio,
      };
    });
    assert.ok(Math.abs(state.query.zoom - zoom) < 1e-6, 'No fresh viewport request for camera zoom');
    sweep.push({ zoom, ...state });
    console.log(JSON.stringify(sweep.at(-1)));
  }
  assert.ok(sweep[4].level > sweep[0].level, 'Deep zoom is still frozen on the 53-object coarse tier');
  assert.ok(sweep[4].markerRadius <= 4.5 + 1e-9, 'Deep zoom inflates ordinary glyphs');
  assert.ok(
    sweep[4].query.lod_selection_bounds.xmax - sweep[4].query.lod_selection_bounds.xmin <
      sweep[0].query.lod_selection_bounds.xmax - sweep[0].query.lod_selection_bounds.xmin
  );
  assert.ok(
    sweep[4].query.lod_target_representations >= sweep[1].query.lod_target_representations,
    'Zoom-dependent glyph growth collapsed the detail budget'
  );
  await page.evaluate(() => window.liveViewport.controller.unmount());
  assert.deepEqual(errors, []);
  console.log('PASS: actual prepared-tree viewport requests refine across deep zoom; glyph size remains bounded.');
} finally {
  await browser?.close();
  await server.close();
}
