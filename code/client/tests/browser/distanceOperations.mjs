import { browserHarness, waitForView, observeProductRenderer } from './browserHarness.mjs';
import assert from 'node:assert/strict';
import { join } from 'node:path';

const api = process.env.REQUIREMENTS_API_URL ?? 'http://127.0.0.1:8128';
const { page, errors, close, url } = await browserHarness({ api, viewport: { width: 1440, height: 1000 } });
try {
  await observeProductRenderer(page);
  await page.route('**/src/main.ts', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'import "/tests/browser/meetingRequirements.ts";',
    })
  );
  await page.goto(`${url}/`);
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
    const animations = await page.evaluate(() => window.requirementsView.completedAnimations);
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
    await page.waitForFunction(before => window.requirementsView.completedAnimations > before, animations);
    await waitForView(page);
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
  await waitForView(page);
  const arrangement = await page.evaluate(() => ({
    camera: window.requirementsSigma.getCamera().getState(),
    nodes: window.requirementsSigma.getGraph().mapNodes((id, a) => [id, a.x, a.y]),
  }));
  await page.locator('#distance-connections-controls > summary').click();
  assert.match(await page.locator('#connection-metric').textContent(), /Tree-path distance/);
  await page.locator('#connection-threshold').fill('3');
  await page.locator('#apply-connections').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().size === 6);
  assert.deepEqual(await page.locator('#graph-legend li:visible').allTextContents(), ['Additional connection']);
  const overlay = await page.evaluate(() =>
    window.requirementsSigma
      .getGraph()
      .mapEdges((id, a, source, target) => ({ id, source, target, ...a }))
      .filter(edge => edge.isDistanceConnection)
  );
  assert.deepEqual(overlay.map(edge => [edge.source, edge.target, edge.distance]).sort(), [
    ['a', 'b', 2.5],
    ['a', 'root', 3],
  ]);
  assert.ok(overlay.every(edge => edge.color === '#2563eb'));
  if (process.env.DISTANCE_SCREENSHOT) await page.screenshot({ path: process.env.DISTANCE_SCREENSHOT });
  assert.deepEqual(
    await page.evaluate(() => ({
      camera: window.requirementsSigma.getCamera().getState(),
      nodes: window.requirementsSigma.getGraph().mapNodes((id, a) => [id, a.x, a.y]),
    })),
    arrangement
  );
  await page.locator('#connection-limit').fill('1');
  await page.locator('#connection-threshold').fill('100');
  await page.locator('#apply-connections').click();
  await page.waitForFunction(() =>
    document.querySelector('#connection-feedback').textContent.includes('No partial overlay')
  );
  assert.equal(await page.evaluate(() => window.requirementsSigma.getGraph().size), 6);
  // A manual fold omits its descendants' links instead of fabricating group distances.
  await page.locator('#search-input').fill('branch');
  await page.locator('#search-input').press('Enter');
  await page
    .locator('#search-results button')
    .filter({ hasText: /^branch$/ })
    .click();
  await page.waitForFunction(() => !document.querySelector('#collapse-selected').disabled);
  await page.locator('#collapse-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 3);
  assert.equal(
    await page.evaluate(
      () => window.requirementsSigma.getGraph().filterEdges((_id, a) => a.isDistanceConnection).length
    ),
    0
  );
  await page.locator('#expand-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().size === 6);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#open-export').click();
  const connectedImage = page.waitForEvent('download');
  await page.locator('#export-png').click();
  const image = await connectedImage;
  if (process.env.DISTANCE_EXPORT) await image.saveAs(process.env.DISTANCE_EXPORT);
  assert.ok(
    (await page.evaluate(() => window.distanceCaptions))
      .join('')
      .includes('additional tree-path connections at distance ≤ 3')
  );
  await page.keyboard.press('Escape');
  await page.locator('#clear-connections').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().size === 4);
  assert.ok(!(await page.locator('#status').textContent()).includes('additional'));
  console.log(
    'Additional connections: exact path distances, blue styles, all-or-nothing budget, manual folds, responsive layout, PNG metric and removal passed.'
  );
  assert.deepEqual(errors, []);
  console.log(
    'Distance cutoff: decimal/equal/zero thresholds, isolated-node panels, PNG caption and original-tree restoration passed.'
  );
} finally {
  await close();
}
