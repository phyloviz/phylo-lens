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
  cacheDir: join(tmpdir(), 'phylo-lens-requirements-vite'),
  optimizeDeps: { include: ['d3-force'] },
  server: { watch: { ignored: ['**/*'] }, host: '127.0.0.1', port: 0, proxy: { '/api': api, '/health': api } },
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
  const task = async name => {
    if (!(await page.locator('#workspace-sidebar').isVisible())) await page.locator('#controls-toggle').click();
    await page.locator(`[data-workspace-tab="${name}"]`).click();
  };
  const load = async (name, content = '((a:1,b:2)branch:4,sibling:8)root;', count = 5) => {
    await page.locator('#change-data').click();
    await page.locator('#dataset-name-input').fill(name);
    await page.locator('#newick-file-input').setInputFiles({
      name: 'requirements.nwk',
      mimeType: 'text/plain',
      buffer: Buffer.from(content),
    });
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(
      count =>
        window.requirementsSigma?.getGraph().order === count &&
        document.querySelector('#status').textContent.includes('Rendered'),
      count
    );
    await page.waitForFunction(name => document.querySelector('#current-dataset').textContent === name, name);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#explore-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#current-dataset').innerText(), name);
  };
  const clickNode = async id => {
    await page.locator('#graph-root').scrollIntoViewIfNeeded();
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
  await page.locator('#automatic-detail').uncheck();
  assert.equal(await page.locator('#motion-enabled').isChecked(), false);
  await page.locator('#motion-enabled').check();
  await page.locator('#automatic-detail').check();
  await page.locator('#motion-enabled').uncheck();
  assert.equal(await page.locator('#automatic-detail').isChecked(), true);
  await task('appearance');
  await page.locator('#show-node-labels').check();
  assert.equal(await page.locator('#ancillary-node').count(), 0);
  let prepareRequests = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/graph/prepare')) prepareRequests++;
  });
  await page.locator('#search-input').fill('branch');
  await page.locator('#search-input').press('Enter');
  await page
    .locator('#search-results button')
    .filter({ hasText: /^branch$/ })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('#selected-node-label').textContent.startsWith('Selected: branch ·')
  );
  assert.equal(prepareRequests, 0, 'Searching must not submit the dataset form.');
  await page.waitForTimeout(500);
  await page.locator('#collapse-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 3);
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'isBranchCollapsed')),
    true
  );
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'type')),
    'triangle'
  );
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'color')),
    '#7c3aed'
  );
  assert.equal(
    await page.evaluate(() => window.requirementsSigma.getGraph().getNodeAttribute('branch', 'label')),
    'branch (+2)'
  );
  await page.screenshot({ path: join(tmpdir(), 'phylo-lens-manual-branch.png') });
  await page.locator('#expand-selected').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 5);
  await task('explore');
  await page.locator('#collapse-all').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 1);
  await page.locator('#expand-all').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 5);
  await page.waitForTimeout(600);
  console.log('Manual collapse/expand passed.');

  // Exercise the real display controls and graph snapshots.
  await task('appearance');
  await page.locator('#show-edge-distance-labels').check();
  await page.locator('#distance-weighted-edges').check();
  await page.locator('#edge-label-min').fill('2');
  await page.locator('#edge-label-max').fill('4');
  await page.locator('#edge-label-max').press('Enter');
  assert.equal(prepareRequests, 0, 'Editing labels must not submit the dataset form.');
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
  await page.locator('#edge-label-max').fill('1');
  assert.match(await page.locator('#edge-label-feedback').innerText(), /Maximum must be at least minimum/);
  assert.deepEqual(
    await page.evaluate(() =>
      window.requirementsSigma
        .getGraph()
        .mapEdges((_id, a) => a.label)
        .filter(Boolean)
    ),
    edges.filter(edge => edge.label).map(edge => edge.label)
  );
  await page.locator('#edge-label-max').fill('4');
  await page.locator('#show-edge-distance-labels').uncheck();
  assert.equal(await page.locator('#edge-label-settings').isVisible(), false);
  await page.locator('#show-edge-distance-labels').check();
  assert.equal(await page.locator('#edge-label-min').inputValue(), '2');
  assert.equal(await page.locator('#distance-weighted-edges').isChecked(), true);
  await page.locator('#edge-label-policy').selectOption('always');
  console.log('Edge interval, validation, retained choices and grayscale passed.');

  // Replace ancillary data and test palette edits, Reset, replacement, and tree changes.
  await task('data');
  await page.locator('details.optional-card > summary').click();
  const table =
    'id,country,origin,score\na,Portugal,Portugal,1\nb,Spain,Spain,10\nbranch,Portugal,Portugal,4\nsibling,Spain,Spain,8\nroot,Portugal,Portugal,2\n';
  const upload = async () => {
    await task('data');
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
    await task('appearance');
  };
  await upload();
  const sizeOptions = await page
    .locator('#metadata-size-field option')
    .evaluateAll(options => options.map(option => option.value));
  assert.ok(sizeOptions.includes('score'));
  assert.ok(!sizeOptions.includes('country'));
  await page.locator('#metadata-size-field').selectOption('score');
  await page.waitForFunction(() => window.requirementsSigma.getGraph().getNodeAttribute('b', 'size') === 15);
  await page.locator('#metadata-size-scale').selectOption('log');
  await page.waitForFunction(
    () =>
      Math.abs(window.requirementsSigma.getGraph().getNodeAttribute('b', 'size') - (3 + 1.2 * Math.log1p(10))) < 1e-8
  );
  await page.locator('#metadata-size-scale').selectOption('linear');
  await page.waitForFunction(() => window.requirementsSigma.getGraph().getNodeAttribute('b', 'size') === 15);
  await page.locator('#metadata-pie-field').selectOption(['country']);
  const color = page.locator('[data-category-color="Portugal"]');
  const original = await color.inputValue();
  const edit = async () => {
    await color.fill('#123456');
    await color.dispatchEvent('input');
    await page.waitForFunction(() => window.requirementsSigma.getGraph().getNodeAttribute('a', 'color') === '#123456');
  };
  // A real PNG download includes the current view and retains label filtering.
  await page.locator('#open-export').click();
  assert.equal(await page.locator('#export-dialog').isVisible(), true);
  await page.locator('#close-export').press('Tab');
  assert.equal(await page.locator('#export-dialog').evaluate(dialog => dialog.contains(document.activeElement)), true);
  await page.locator('#export-scale').selectOption('1');
  const exported = page.waitForEvent('download');
  await page.locator('#export-png').click();
  const download = await exported;
  assert.equal(download.suggestedFilename(), 'phylo-lens.png');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
  assert.equal(await page.locator('#export-feedback').innerText(), 'PNG downloaded.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#export-dialog').isVisible(), false);
  assert.equal(await page.locator('#open-export').evaluate(button => button === document.activeElement), true);
  assert.equal(await page.locator('#edge-label-min').inputValue(), '2');
  console.log('Numeric size mapping, scales, modal focus and PNG export passed.');
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
  await task('appearance');
  await page.locator('#metadata-pie-field').selectOption(['country']);
  assert.equal(await color.inputValue(), original);

  // Verify branch dragging with real pointer events and an explicit arrangement root.
  console.log('Palette lifecycle passed.');
  await task('explore');
  await page.locator('#motion-enabled').uncheck();
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
  // The canvas must resize when the inspector closes, without a window resize.
  const widthWithInspector = await page.locator('#graph-root').evaluate(node => node.clientWidth);
  await page.locator('#inspector-close').click();
  await page.waitForFunction(
    () => window.requirementsSigma.getDimensions().width === document.querySelector('#graph-root').clientWidth
  );
  assert.ok((await page.locator('#graph-root').evaluate(node => node.clientWidth)) > widthWithInspector);
  await page.locator('#inspector-toggle').click();
  await page.waitForFunction(
    () => window.requirementsSigma.getDimensions().width === document.querySelector('#graph-root').clientWidth
  );
  await task('appearance');
  assert.equal(await page.locator('#edge-label-min').inputValue(), '2');
  await page.locator('#appearance-tab').focus();
  await page.locator('#appearance-tab').press('ArrowRight');
  assert.equal(await page.locator('#data-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#newick-file-input').evaluate(input => input.files[0].name), 'requirements.nwk');
  // Check control layout independently of the proposed sidebar grouping.
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(overflow.scroll <= overflow.width, `Horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await task('appearance');
  await page.locator('#display-heading').scrollIntoViewIfNeeded();
  await page.locator('#selected-node-label').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'phylo-lens-sidebar-controls.png') });
  // One renderer presents disconnected components with independent view state.
  await load('requirements-forest-panels', '((a:1,b:2)branch:4,sibling:8)root; (d:1,e:1)other; isolated;', 9);
  await page.locator('#forest-controls [role="tab"]').nth(3).waitFor();
  assert.equal(await page.locator('#motion-enabled').isChecked(), false);
  const requests = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/graph/viewport')) requests.push(request.postDataJSON());
  });
  const treeTab = root => page.locator(`#forest-controls [role="tab"][title="Root: ${root}"]`);
  await treeTab('root').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 5);
  await page.waitForTimeout(600);
  assert.deepEqual(
    await page.evaluate(() => [
      ...new Set(window.requirementsSigma.getGraph().mapNodes((_id, a) => a.treeIndex.componentId)),
    ]),
    ['root']
  );
  assert.equal(requests.at(-1).component_id, 'root');
  const drag = await page.evaluate(() => {
    const sigma = window.requirementsSigma;
    const graph = sigma.getGraph();
    const p = sigma.graphToViewport(graph.getNodeAttributes('a'));
    const r = sigma.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x + 50, drag.y + 25, { steps: 10 });
  await page.mouse.up();
  const arranged = await page.evaluate(() => {
    const a = window.requirementsSigma.getGraph().getNodeAttributes('a');
    return { x: a.x, y: a.y };
  });
  await page.evaluate(() => window.requirementsSigma.getCamera().setState({ ratio: 0.6, x: 0.4, y: 0.6 }));
  await page.waitForTimeout(800);
  assert.deepEqual(
    await page.evaluate(() => {
      const a = window.requirementsSigma.getGraph().getNodeAttributes('a');
      return { x: a.x, y: a.y };
    }),
    arranged
  );
  const camera = await page.evaluate(() => window.requirementsSigma.getCamera().getState());
  await treeTab('other').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 3);
  await page.waitForTimeout(600);
  assert.deepEqual((await page.evaluate(() => window.requirementsSigma.getGraph().nodes())).sort(), [
    'd',
    'e',
    'other',
  ]);
  await page.locator('#search-input').fill('branch');
  await page.locator('#search-input').press('Enter');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Search found 0 matches'));
  await treeTab('root').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().hasNode('a'));
  await page.waitForTimeout(600);
  assert.deepEqual(await page.evaluate(() => window.requirementsSigma.getCamera().getState()), camera);
  assert.deepEqual(
    await page.evaluate(() => {
      const a = window.requirementsSigma.getGraph().getNodeAttributes('a');
      return { x: a.x, y: a.y };
    }),
    arranged
  );
  await task('explore');
  await page.locator('#relax-layout').click();
  await page.waitForFunction(() => document.querySelector('#layout-motion-status').textContent.includes('Relaxing'));
  await page.waitForFunction(() => !document.querySelector('#relax-layout').disabled, undefined, { timeout: 30000 });
  assert.equal(await page.locator('#motion-enabled').isChecked(), false);
  const settled = await page.evaluate(() =>
    window.requirementsSigma.getGraph().mapNodes((id, a) => ({ id, x: a.x, y: a.y }))
  );
  await page.evaluate(() => window.requirementsSigma.getCamera().setState({ ratio: 1.2 }));
  await page.waitForTimeout(800);
  assert.deepEqual(
    await page.evaluate(() => window.requirementsSigma.getGraph().mapNodes((id, a) => ({ id, x: a.x, y: a.y }))),
    settled
  );
  await page.locator('#motion-enabled').check();
  await page.locator('#stop-layout').click();
  assert.equal(await page.locator('#motion-enabled').isChecked(), false);
  await page.locator('#forest-controls [role="tab"]').filter({ hasText: 'Forest overview' }).click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 9);
  await treeTab('isolated').click();
  await page.waitForFunction(() => window.requirementsSigma.getGraph().order === 1);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(errors, []);
  console.log(
    'Forest tabs, scoped search, independent cameras, retained edits, manual settling and explicit stop passed.'
  );

  // A larger tree starts as a partial LoD slice. Fold its root using only the
  // streamed interval, then verify that camera queries continue while folded.
  const total = 4095;
  const binaryTree = i =>
    i >= total ? '' : i * 2 + 1 >= total ? `n${i}:1` : `(${binaryTree(i * 2 + 1)},${binaryTree(i * 2 + 2)})n${i}:1`;
  await page.locator('#change-data').click();
  await page.locator('#dataset-name-input').fill('requirements-streamed-index');
  await page
    .locator('summary')
    .filter({ hasText: /^Advanced preparation$/ })
    .click();
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
  await page.waitForTimeout(600);
  const group = await page.evaluate(() => {
    const graph = window.requirementsSigma.getGraph();
    const id = graph.findNode((_id, attributes) => attributes.isClusterProxy === true);
    return id ? { id, clusterId: graph.getNodeAttribute(id, 'clusterId'), count: graph.order } : null;
  });
  assert.ok(group, 'The streamed view must contain an expandable LoD group.');
  await clickNode(group.id);
  assert.equal(await page.locator('#expand-selected').textContent(), 'Expand group');
  await page.locator('#expand-selected').click();
  await page.waitForFunction(count => window.requirementsSigma.getGraph().order > count, group.count);
  await page.waitForTimeout(500);
  const member = await page.evaluate(
    clusterId =>
      window.requirementsSigma
        .getGraph()
        .findNode((_id, attributes) => attributes.clusterId === clusterId && attributes.canCollapseBranch === true),
    group.clusterId
  );
  assert.ok(member, 'The expanded group must contain an internal member.');
  await clickNode(member);
  assert.equal(await page.locator('#collapse-selected').textContent(), 'Collapse group');
  await page.locator('#collapse-selected').click();
  await page.waitForFunction(({ id, count }) => {
    const graph = window.requirementsSigma.getGraph();
    return graph.order === count && graph.hasNode(id) && graph.getNodeAttribute(id, 'isClusterProxy') === true;
  }, group);
  assert.equal(await page.locator('#expansion-feedback').textContent(), '0 groups explicitly expanded.');
  assert.deepEqual(errors, []);
  console.log('Expanded LoD group restores its representative without creating a manual branch fold.');
  console.log('Streamed collapse, configurable preparation, and live viewport refresh passed.');
  console.log(
    'Browser requirements passed: manual branches, display bounds, grayscale, palette lifecycle, node selection, and branch dragging.'
  );
} catch (error) {
  if (page) {
    console.error(
      await page.evaluate(() => ({
        overflow: [...document.querySelectorAll('body *')]
          .filter(element => {
            const r = element.getBoundingClientRect();
            return r.width && r.right > innerWidth + 1;
          })
          .map(element => ({
            tag: element.tagName,
            id: element.id,
            class: element.className,
            width: element.getBoundingClientRect().width,
            right: element.getBoundingClientRect().right,
          }))
          .slice(0, 20),
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
