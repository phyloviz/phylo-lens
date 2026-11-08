import { browserHarness, waitForView, observeUnchanged } from './browserHarness.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const { page, errors, close, url } = await browserHarness({});
try {
  await page.goto(`${url}/tests/browser/elasticMotion.html`);
  await page.waitForFunction(() => window.motionFixture);
  await page.evaluate(async () => {
    const { graphSnapshotFromViewportResponse } = await import('/src/app/workbench/viewport/viewportSnapshot.ts');
    const { decodeApiMetadata } = await import('/src/ancillary/apiMetadata.ts');
    const response = (nodes, edges, lodLevel) =>
      graphSnapshotFromViewportResponse({
        datasetId: 'stability',
        layoutVersion: 'v1',
        lodLevel,
        zoom: 1,
        layoutStatus: 'ready',
        truncated: false,
        totalNodeCount: 97_001,
        ancillarySchema: [],
        globalBounds: { minX: 0, maxX: 12, minY: -2, maxY: 4 },
        nodes: nodes.map(node => ({
          layoutStatus: 'ready',
          memberCount: 1,
          isRepresentative: false,
          annotations: decodeApiMetadata({}),
          ...node,
        })),
        edges: edges.map(edge => ({ distance: edge.id === 'boundary' ? 4 : 1, ...edge })),
      });
    const anchor = { id: 'anchor', clusterId: 'anchor', x: 2, y: 0 };
    const members = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      clusterId: 'cluster',
      x: 6 + (i % 5) * 0.25,
      y: Math.floor(i / 5) * 0.3,
    }));
    window.stabilityViews = {
      coarse: response(
        [anchor, { id: 'proxy', clusterId: 'cluster', x: 6, y: 0, memberCount: 97_000, isRepresentative: true }],
        [{ id: 'boundary', source: 'anchor', target: 'proxy' }],
        0
      ),
      detailed: response(
        [anchor, ...members],
        [
          { id: 'boundary', source: 'anchor', target: 'm0' },
          ...members
            .slice(1)
            .map((node, i) => ({ id: `e${i}`, source: members[Math.floor(i / 2)].id, target: node.id })),
        ],
        1
      ),
    };
  });
  const sizes = await page.evaluate(() => {
    const { renderer, sigma } = window.motionFixture;
    renderer.setMotionEnabled(false);
    renderer.render(window.stabilityViews.coarse);
    sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 0.5 });
    sigma.refresh();
    const graph = sigma.getGraph();
    return {
      radius: graph.getNodeAttribute('proxy', 'size'),
      spacing: renderer.getViewportState().representationSpacingPx,
    };
  });
  const samples = [];
  for (const motion of [false, true]) {
    await page.evaluate(motion => {
      const { renderer, sigma } = window.motionFixture;
      renderer.setMotionEnabled(false);
      renderer.render(window.stabilityViews.coarse);
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 0.5 });
      renderer.setMotionEnabled(motion);
    }, motion);
    for (const view of ['detailed', 'coarse', 'detailed', 'coarse']) {
      const before = await page.evaluate(view => {
        const { renderer, sigma } = window.motionFixture;
        const point = sigma.graphToViewport({ x: 2, y: 0 });
        const camera = sigma.getCamera().getState();
        renderer.applyGraphSnapshot(window.stabilityViews[view]);
        return { point, camera };
      }, view);
      await waitForView(page);
      await observeUnchanged(page, () => window.motionFixture.sigma.getCamera().getState());
      const after = await page.evaluate(view => {
        const { sigma } = window.motionFixture;
        const graph = sigma.getGraph();
        const snapshot = window.stabilityViews[view];
        return {
          point: sigma.graphToViewport({ x: 2, y: 0 }),
          camera: sigma.getCamera().getState(),
          sourcePositionError: Math.max(
            ...snapshot.nodes.map(node => {
              const attributes = graph.getNodeAttributes(node.id);
              return Math.hypot(node.x - attributes.x, node.y - attributes.y);
            })
          ),
          edges: graph
            .mapEdges((id, attributes, source, target) => [id, source, target, attributes.distance, attributes.size])
            .sort(),
          expectedEdges: snapshot.edges
            .map(edge => [edge.id, edge.source, edge.target, edge.attributes.distance, edge.attributes.size])
            .sort(),
        };
      }, view);
      assert.deepEqual(after.edges, after.expectedEdges, 'LoD changed edge endpoints, distances or thickness');
      if (!motion) assert.ok(after.sourcePositionError < 1e-6, 'Paused LoD updates moved prepared node positions');
      samples.push({
        motion,
        view,
        cameraDriftPx: Math.hypot(before.point.x - after.point.x, before.point.y - after.point.y),
        before: before.camera,
        after: after.camera,
      });
    }
  }
  const wheelSamples = [];
  const box = await page.locator('#graph').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  for (const delta of [-20, 20]) {
    await page.evaluate(() => window.motionFixture.renderer.applyGraphSnapshot(window.stabilityViews.detailed));
    await waitForView(page);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(30);
    }
    await waitForView(page);
    const before = await page.evaluate(() => {
      const { sigma, renderer } = window.motionFixture;
      const point = sigma.graphToViewport({ x: 2, y: 0 });
      renderer.applyGraphSnapshot(window.stabilityViews.coarse);
      return point;
    });
    await waitForView(page);
    await observeUnchanged(page, () => window.motionFixture.sigma.getCamera().getState());
    const after = await page.evaluate(() => window.motionFixture.sigma.graphToViewport({ x: 2, y: 0 }));
    wheelSamples.push({ delta, cameraDriftPx: Math.hypot(before.x - after.x, before.y - after.y) });
  }
  const result = { sizes, samples, wheelSamples, edgesUnchanged: true, pausedPositionsUnchanged: true, errors };
  console.log(JSON.stringify(result));
  if (process.env.STABILITY_REPORT) await writeFile(process.env.STABILITY_REPORT, JSON.stringify(result, null, 2));
  if (!process.env.STABILITY_REPORT_ONLY) {
    assert.ok(sizes.radius <= 12, 'Default aggregate radius is unbounded');
    assert.ok(sizes.spacing >= 2 * sizes.radius * 1.35, 'LoD underestimates the visible aggregate footprint');
    assert.ok(
      samples.every(sample => sample.cameraDriftPx < 0.5),
      'LoD updates autonomously move the camera'
    );
    assert.ok(
      wheelSamples.every(sample => sample.cameraDriftPx < 0.5),
      'A LoD response overwrote continuous wheel navigation'
    );
    assert.deepEqual(errors, []);
  }
} finally {
  await close();
}
