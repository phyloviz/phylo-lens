import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from './browserRuntime.mjs';

// Run against an isolated local service: REQUIREMENTS_API_URL defaults to port 8128.
const api = process.env.REQUIREMENTS_API_URL ?? 'http://127.0.0.1:8128';
const server = await createServer({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: false,
  server: { host: '127.0.0.1', port: 0, proxy: { '/api': api, '/health': api } },
});
await server.listen();
let browser;
let page;
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/src/main.ts', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    import '/tests/browser/meetingRequirements.ts';
  `,
    })
  );
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(() => window.requirementsShell);
  const load = async name => {
    await page.locator('#dataset-name-input').fill(name);
    await page.locator('#newick-file-input').setInputFiles({
      name: 'requirements.nwk',
      mimeType: 'text/plain',
      buffer: Buffer.from('((a:1,b:2)branch:4,sibling:8)root;'),
    });
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(
      () =>
        window.requirementsSigma?.getGraph().order === 5 &&
        document.querySelector('#status').textContent.includes('Rendered')
    );
    await page.waitForTimeout(600);
  };
  const clickNode = async id => {
    const point = await page.evaluate(id => {
      const sigma = window.requirementsSigma;
      const p = sigma.graphToViewport(sigma.getGraph().getNodeAttributes(id));
      const bounds = sigma.getContainer().getBoundingClientRect();
      return { x: bounds.left + p.x, y: bounds.top + p.y };
    }, id);
    await page.mouse.click(point.x, point.y);
    // Selection may coincide with the 240 ms LoD transition. Commands wait
    // until its manipulation guard releases, as a completed interaction would.
    await page.waitForTimeout(300);
  };
  await load('requirements-browser');
  console.log('Loaded product tree.');
  await page.locator('#motion-enabled').uncheck();
  await page.locator('#display-options').selectOption(['node-labels']);
  assert.equal(await page.locator('#ancillary-node').count(), 0);
  await clickNode('branch');
  await page.locator('#collapse-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 3);
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'isBranchCollapsed')),
    true
  );
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'type')),
    'border'
  );
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'label')),
    'branch (+2)'
  );
  await page.screenshot({ path: join(tmpdir(), 'phylo-lens-manual-branch.png') });
  await page.locator('#expand-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 5);
  await page.locator('#collapse-all').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 1);
  await page.locator('#expand-all').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 5);
  await page.waitForTimeout(600);
  console.log('Manual collapse/expand passed.');

  // Exercise the real display controls and graph snapshots.
  await page
    .locator('#display-options')
    .selectOption(['node-labels', 'edge-distance-labels', 'distance-weighted-edges']);
  await page.locator('#edge-label-min').fill('2');
  await page.locator('#edge-label-max').fill('4');
  await page.waitForFunction(() => {
    const graph = window.requirementsSigma.getGraph();
    return graph.mapEdges((_id, a) => a.label).filter(Boolean).length === 2;
  });
  const edges = await page.evaluate(() =>
    window.requirementsSigma
      .getGraph()
      .mapEdges((_id, a) => ({ distance: a.distance, color: a.color, size: a.size, label: a.label }))
  );
  assert.ok(edges.every(edge => edge.size === 1));
  assert.deepEqual(
    edges
      .filter(edge => edge.label)
      .map(edge => edge.distance)
      .sort((a, b) => a - b),
    [2, 4]
  );
  assert.equal(edges.find(edge => edge.distance === 1).color, '#000000');
  assert.equal(edges.find(edge => edge.distance === 4).color, '#969696');
  console.log('Edge interval and grayscale passed.');

  // Replace ancillary data and test palette edits, Reset, replacement, and tree changes.
  await page.locator('details.optional-card > summary').click();
  const table =
    'id,country,origin\na,Portugal,Portugal\nb,Spain,Spain\nbranch,Portugal,Portugal\nsibling,Spain,Spain\nroot,Portugal,Portugal\n';
  const upload = async () => {
    await page
      .locator('#ancillary-file-input')
      .setInputFiles({ name: 'ancillary.csv', mimeType: 'text/csv', buffer: Buffer.from(table) });
    await page.locator('#ancillary-join-column-input').selectOption('id');
    const applied = page.waitForResponse(
      response => response.url().endsWith('/api/graph/ancillary') && response.request().method() === 'PUT'
    );
    await page.locator('#apply-ancillary-button').click();
    assert.equal((await applied).status(), 200);
    await page.waitForFunction(() => !document.querySelector('#apply-ancillary-button').disabled);
  };
  await upload();
  await page.locator('#metadata-pie-field').selectOption(['country']);
  const color = page.locator('[data-category-color="Portugal"]');
  const original = await color.inputValue();
  const edit = async () => {
    await color.fill('#123456');
    await color.dispatchEvent('input');
    await page.waitForFunction(() => window.requirementsSigma.getGraph().getNodeAttribute('a', 'color') === '#123456');
  };
  await edit();
  await page.locator('#palette-reset-button').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().getNodeAttribute('a', 'color') !== '#123456');
  assert.equal(await color.inputValue(), original);
  await edit();
  await page.locator('#metadata-pie-field').selectOption(['origin']);
  assert.equal(await color.inputValue(), original);
  await page.locator('#metadata-pie-field').selectOption(['country']);
  assert.equal(await color.inputValue(), '#123456');
  await upload();
  assert.equal(await color.inputValue(), original);
  await edit();
  await load('requirements-browser-second-tree');
  await page.locator('#metadata-pie-field').selectOption(['country']);
  assert.equal(await color.inputValue(), original);

  // Verify branch dragging with real pointer events and an explicit arrangement root.
  console.log('Palette lifecycle passed.');
  await page.locator('#motion-enabled').uncheck();
  await page.locator('details.help-details > summary').filter({ hasText: 'Advanced branch dragging' }).click();
  await clickNode('root');
  await page.locator('#branch-root').click();
  const before = await page.evaluate(() => {
    const sigma = window.requirementsSigma,
      graph = sigma.getGraph();
    const p = sigma.graphToViewport(graph.getNodeAttributes('branch'));
    const r = sigma.getContainer().getBoundingClientRect();
    return {
      point: { x: p.x + r.left, y: p.y + r.top },
      nodes: graph.mapNodes((id, a) => ({ id, x: a.x, y: a.y })),
      edges: graph.export().edges,
    };
  });
  await page.mouse.move(before.point.x, before.point.y);
  await page.mouse.down();
  await page.mouse.move(before.point.x + 55, before.point.y + 35, { steps: 12 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    nodes: window.requirementsSigma.getGraph().mapNodes((id, a) => ({ id, x: a.x, y: a.y })),
    edges: window.requirementsSigma.getGraph().export().edges,
  }));
  const delta = id => {
    const a = after.nodes.find(n => n.id === id),
      b = before.nodes.find(n => n.id === id);
    return { x: a.x - b.x, y: a.y - b.y };
  };
  const moved = delta('branch');
  assert.ok(Math.hypot(moved.x, moved.y) > 0.01);
  for (const id of ['a', 'b']) {
    assert.ok(Math.abs(delta(id).x - moved.x) < 1e-8 && Math.abs(delta(id).y - moved.y) < 1e-8);
  }
  assert.deepEqual(delta('sibling'), { x: 0, y: 0 });
  assert.deepEqual(after.edges, before.edges);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: process.env.REQUIREMENTS_SCREENSHOT ?? join(tmpdir(), 'phylo-lens-requirements.png') });
  // A larger tree starts as a partial LoD slice. Fold its root using only the
  // streamed interval, then verify that camera queries continue while folded.
  const total = 4095;
  const binaryTree = i =>
    i >= total ? '' : i * 2 + 1 >= total ? `n${i}:1` : `(${binaryTree(i * 2 + 1)},${binaryTree(i * 2 + 2)})n${i}:1`;
  await page.locator('#dataset-name-input').fill('requirements-streamed-index');
  await page.locator('#small-component-threshold').fill('32');
  await page
    .locator('#newick-file-input')
    .setInputFiles({ name: 'indexed.nwk', mimeType: 'text/plain', buffer: Buffer.from(binaryTree(0) + ';') });
  const preparation = page.waitForRequest(
    request => request.url().endsWith('/api/graph/prepare') && request.method() === 'POST'
  );
  await page.locator('button[type=submit]').click();
  assert.equal((await preparation).postDataJSON().lod_options.small_component_threshold, 32);
  await page.waitForFunction(
    () =>
      window.requirementsSigma.getGraph().hasNode('n0') &&
      document.querySelector('#status').textContent.includes('Rendered'),
    undefined,
    { timeout: 30000 }
  );
  await page.waitForTimeout(600);
  const partialOrder = await page.evaluate(() => window.requirementsSigma.getGraph().order);
  assert.ok(partialOrder > 1 && partialOrder < total);
  await page.waitForLoadState('networkidle');
  await page.evaluate(
    () =>
      new Promise(resolve => {
        let frames = 0;
        const tick = () => (++frames < 32 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      })
  );
  await clickNode('n0');
  await page.waitForLoadState('networkidle');
  await page.locator('#collapse-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 1);
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('n0', 'collapsedBranchCount')),
    total - 1
  );
  // Snapshot application suppresses its own camera events for one frame.
  await page.waitForTimeout(50);
  const refreshed = page.waitForResponse(
    response => response.url().endsWith('/api/graph/viewport') && response.request().method() === 'POST'
  );
  await page.evaluate(() => {
    const camera = window.requirementsSigma.getCamera();
    camera.setState({ ratio: camera.getState().ratio * 1.2 });
  });
  const viewport = await refreshed;
  assert.equal(viewport.status(), 200);
  assert.equal(typeof viewport.request().postDataJSON().xmin, 'number');
  await page.waitForFunction(
    () =>
      window.requirementsSigma.getGraph().order === 1 &&
      document.querySelector('#expansion-feedback').textContent.includes('manually collapsed')
  );
  await page.locator('#expand-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order > 1);
  assert.ok((await page.evaluate(() => window.requirementsSigma.getGraph().order)) < total);
  assert.deepEqual(errors, []);
  console.log('Streamed collapse, configurable preparation, and live viewport refresh passed.');
  console.log(
    'Browser requirements passed: manual branches, display bounds, grayscale, palette lifecycle, node selection, and branch dragging.'
  );
} catch (error) {
  if (page) {
    console.error(
      await page.evaluate(() => ({
        status: document.querySelector('#status')?.textContent,
        feedback: document.querySelector('#expansion-feedback')?.textContent,
        shell: Boolean(window.requirementsShell),
        sigma: Boolean(window.requirementsSigma),
        nodes: window.requirementsSigma
          ?.getGraph()
          .mapNodes((id, a) => ({ id, collapsed: a.isBranchCollapsed, collapsible: a.canCollapseBranch }))
          .slice(0, 20),
      }))
    );
    await page.screenshot({ path: join(tmpdir(), 'phylo-lens-requirements-failure.png') });
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
