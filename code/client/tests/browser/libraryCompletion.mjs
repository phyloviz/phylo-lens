import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { browserHarness, nextFrames, observeProductRenderer, waitForView } from './browserHarness.mjs';

const examples = new URL('../../../../examples/documentation/', import.meta.url);
const screenshots = process.argv.includes('--screenshots');
const output = fileURLToPath(new URL('../../../../output/playwright/library-completion/', import.meta.url));
if (screenshots) await mkdir(output, { recursive: true });
const api = process.env.REQUIREMENTS_API_URL ?? 'http://127.0.0.1:8136';
const { page, errors, close, url } = await browserHarness({ api, viewport: { width: 1440, height: 1000 } });
const captures = [];
let prepareCount = 0;
page.on('request', request => {
  if (request.url().endsWith('/api/graph/prepare')) prepareCount++;
});

async function capture(name) {
  if (screenshots) {
    await nextFrames(page);
    await page.screenshot({ path: join(output, name + '.png') });
    captures.push(name);
  }
}

async function load(file, name, ancillary, typing = false) {
  await page.locator('#change-data').click();
  await page.locator('#dataset-name-input').fill(name);
  await page.locator('#source-format').selectOption(typing ? 'typing_data' : 'newick');
  await page
    .locator(typing ? '#typing-file-input' : '#newick-file-input')
    .setInputFiles(fileURLToPath(new URL(file, examples)));
  if (ancillary) {
    const details = page.locator('details').filter({ has: page.locator('#ancillary-file-input') });
    if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
    await page.locator('#ancillary-file-input').setInputFiles(fileURLToPath(new URL(ancillary, examples)));
    await page.locator('#ancillary-join-column-input').selectOption('ID');
  } else {
    await page.locator('#ancillary-file-input').setInputFiles([]);
  }
  if (typing) {
    await page.locator('#typing-algorithm').selectOption('goeburst');
    await page.locator('#typing-nlv-level').fill('3');
  }
  const prepared = page.waitForResponse(
    response =>
      response.url().includes('/api/graph/prepare/') &&
      response.request().method() === 'GET' &&
      response.status() === 200
  );
  await page.locator('button[type=submit]').click();
  await prepared;
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Rendered'));
  await waitForView(page);
}

try {
  await observeProductRenderer(page);
  // Observe the actual camera and bootstrap without substituting data, layout or rendering.
  await page.route('**/src/main.ts', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'import "/tests/browser/meetingRequirements.ts";',
    })
  );
  await page.goto(url);
  await page.waitForFunction(() => window.requirementsShell);
  await load('overview.nwk', 'Documentation forest', 'overview-ancillary.csv');
  await page.waitForFunction(() => document.querySelectorAll('#forest-controls [role=tab]').length === 3);
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await page.locator('#metadata-pie-field').selectOption(['country']);
  await page.locator('#show-node-labels').check();
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await page.locator('#forest-controls [data-component-id="st001"]').click();
  await waitForView(page);
  await capture('overview');
  await page.locator('#search-input').fill('st002');
  await page.locator('#search-input').press('Enter');
  await page
    .locator('#search-results button')
    .filter({ hasText: /^st002$/ })
    .click();
  await page.locator('#technical-root:enabled').waitFor();
  await waitForView(page);

  const geometry = await page.evaluate(() => ({
    camera: window.requirementsSigma.getCamera().getState(),
    nodes: window.requirementsSigma
      .getGraph()
      .mapNodes((id, attrs) => [id, attrs.x, attrs.y])
      .sort(),
  }));
  const beforeRoot = prepareCount;
  const revision = page.waitForResponse(response => response.url().endsWith('/api/graph/root'));
  await page.locator('#technical-root').click();
  const response = await (await revision).json();
  assert.deepEqual(response.technical_roots, ['st002', 'remote']);
  assert.deepEqual(response.component_ids, { st001: 'st002', remote: 'remote' });
  await page.locator('#forest-controls [data-component-id="st002"]').waitFor();
  await page.waitForFunction(() =>
    document.querySelector('#technical-root-status').textContent.startsWith('Technical root: st002.')
  );
  await waitForView(page);
  assert.equal(prepareCount, beforeRoot);
  assert.equal(await page.locator('#forest-controls [data-component-id="st001"]').count(), 0);
  assert.deepEqual(
    await page.evaluate(() => ({
      camera: window.requirementsSigma.getCamera().getState(),
      nodes: window.requirementsSigma
        .getGraph()
        .mapNodes((id, attrs) => [id, attrs.x, attrs.y])
        .sort(),
    })),
    geometry
  );
  const scope = { dataset_id: response.dataset_id, layout_version: response.layout_version };
  const finest = await page.request.post(`${url}/api/graph/viewport`, { data: { ...scope, lod_level: 999 } });
  const roots = (await finest.json()).nodes
    .filter(node => node.tree_index.depth === 0)
    .map(node => node.id)
    .sort();
  assert.deepEqual(roots, ['remote', 'st002']);
  await page.locator('#search-input').fill('st002');
  await page.locator('#search-input').press('Enter');
  await page
    .locator('#search-results button')
    .filter({ hasText: /^st002$/ })
    .click();
  await waitForView(page);
  await capture('rerooting');
  await page.locator('#reset-technical-roots').click();
  await page.locator('#forest-controls [data-component-id="st001"]').waitFor();
  await waitForView(page);

  if (process.env.DOC_INCLUDE_TYPING === '1') {
    await load('typing.tsv', 'goeBURST · maximum nLV 3', 'typing-ancillary.csv', true);
    await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 4);
    assert.equal(await page.locator('#forest-controls [data-component-id]').count(), 2);
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.locator('#metadata-pie-field').selectOption(['country']);
    await page.getByRole('tab', { name: 'Explore', exact: true }).click();
    const box = await page.locator('#graph-root').boundingBox();
    const point = await page.evaluate(() => {
      const sigma = window.requirementsSigma;
      return sigma.graphToViewport(sigma.getGraph().getNodeAttributes('a'));
    });
    await page.mouse.click(box.x + point.x, box.y + point.y);
    await page.waitForFunction(() =>
      document.querySelector('#selected-node-label').textContent.includes('Selected: a ·')
    );
    await capture('typing-forest');
    if (screenshots) {
      await page.getByRole('tab', { name: 'Data', exact: true }).click();
      await page.locator('#render-form').evaluate(form => form.scrollIntoView({ block: 'start' }));
      await capture('typing-options');
      await page.getByRole('tab', { name: 'Explore', exact: true }).click();
    }
  }
  await load('detail-groups.nwk', 'Detail groups · 4,095 labelled nodes');
  await page.waitForFunction(() => window.requirementsSigma.getGraph().someNode((_id, attrs) => attrs.isClusterProxy));
  const graphBounds = await page.locator('#graph-root').boundingBox();
  await page.mouse.move(graphBounds.x + graphBounds.width / 2, graphBounds.y + graphBounds.height / 2);
  for (let step = 0; step < 8 && (await page.evaluate(() => window.requirementsSigma.getGraph().order < 15)); step++) {
    const refreshed = page.waitForResponse(response => response.url().endsWith('/api/graph/viewport'));
    await page.mouse.wheel(0, -240);
    await refreshed;
    await waitForView(page);
  }
  await capture('detail-groups');
  await page.locator('#open-export').click();
  await page.locator('#export-scale').selectOption('1');
  await capture('export');
  const download = page.waitForEvent('download');
  await page.locator('#export-png').click();
  const file = await download;
  if (screenshots) await file.saveAs(join(output, 'exported-view.png'));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ status: 'passed', realRootRevision: scope, captures, preparationRequests: prepareCount })
  );
} finally {
  await close();
}
