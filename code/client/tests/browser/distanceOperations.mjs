import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from './browserRuntime.mjs';

const api = process.env.REQUIREMENTS_API_URL ?? 'http://127.0.0.1:8128';
const cacheDir = await mkdtemp(join(tmpdir(), 'phylo-lens-distance-vite-'));
const server = await createServer({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: false,
  cacheDir,
  optimizeDeps: { include: ['d3-force', 'sigma', 'graphology'] },
  server: { host: '127.0.0.1', port: 0, proxy: { '/api': api, '/health': api } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/src/main.ts', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'import "/tests/browser/meetingRequirements.ts";',
    })
  );
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => window.requirementsShell);
  const content = '((a:0,b:2.5)branch:3,c:4)root;';
  const load = async (cutoff, edgeCount) => {
    await page.locator('#change-data').click();
    await page.locator('#dataset-name-input').fill('distance-operations-browser');
    await page
      .locator('#newick-file-input')
      .setInputFiles({ name: 'distances.nwk', mimeType: 'text/plain', buffer: Buffer.from(content) });
    await page.locator('#distance-cutoff').fill(cutoff);
    const request = page.waitForRequest(request => request.url().endsWith('/api/graph/prepare'));
    await page.locator('button[type=submit]').click();
    assert.equal((await request).postDataJSON().distance_cutoff, cutoff === '' ? undefined : Number(cutoff));
    await page.waitForFunction(edgeCount => {
      const graph = window.requirementsSigma?.getGraph();
      return (
        graph?.order === 5 &&
        graph.size === edgeCount &&
        document.querySelector('#status').textContent.includes('Rendered')
      );
    }, edgeCount);
  };
  await load('2.5', 2);
  await page.waitForFunction(() => document.querySelectorAll('#forest-controls [role=tab]').length === 4);
  assert.match(await page.locator('#status').textContent(), /cutoff ≤ 2.5/);
  assert.deepEqual(
    await page.evaluate(() =>
      window.requirementsSigma
        .getGraph()
        .mapEdges((_id, a) => a.distance)
        .sort()
    ),
    [0, 2.5]
  );
  await page.locator('#forest-controls [role=tab][title="Root: root"]').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 1);
  assert.deepEqual(await page.evaluate(() => window.requirementsSigma.getGraph().nodes()), ['root']);
  await load('3', 3);
  await page.waitForFunction(() => document.querySelectorAll('#forest-controls [role=tab]').length === 3);
  await load('0', 1);
  await page.waitForFunction(() => document.querySelectorAll('#forest-controls [role=tab]').length === 5);
  await page.evaluate(() => {
    window.distanceCaptions = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.distanceCaptions.push(text);
      return original.call(this, text, ...args);
    };
  });
  await page.locator('#open-export').click();
  await page.locator('#export-scale').selectOption('1');
  const download = page.waitForEvent('download');
  await page.locator('#export-png').click();
  await download;
  assert.ok((await page.evaluate(() => window.distanceCaptions)).some(text => text.includes('at or below 0 retained')));
  await page.keyboard.press('Escape');
  await load('', 4);
  assert.ok(!(await page.locator('#status').textContent()).includes('cutoff'));
  assert.deepEqual(errors, []);
  console.log(
    'Distance cutoff: decimal/equal/zero thresholds, isolated-node panels, PNG caption and original-tree restoration passed.'
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
