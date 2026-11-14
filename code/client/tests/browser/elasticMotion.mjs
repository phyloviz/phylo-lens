import { browserHarness, waitForView, waitForMotionIdle, nextFrames, observeUnchanged } from './browserHarness.mjs';
import assert from 'node:assert/strict';

const { page, errors, close, url } = await browserHarness({});
try {
  await page.goto(`${url}/tests/browser/elasticMotion.html`);
  await page.waitForFunction(() => window.motionFixture);
  await waitForMotionIdle(page);
  const initialError = await page.evaluate(() => {
    const { renderer: r, snapshot } = window.motionFixture;
    return Math.max(
      ...snapshot.nodes.map(n =>
        Math.hypot(
          window.motionFixture.graph.getNodeAttribute(n.id, 'x') - n.x,
          window.motionFixture.graph.getNodeAttribute(n.id, 'y') - n.y
        )
      )
    );
  });
  assert.ok(initialError < 1e-6, 'Motion deformed the initial server layout');
  const screenPoint = () =>
    page.evaluate(() => {
      const r = window.motionFixture.renderer;
      return window.motionFixture.sigma.graphToViewport(window.motionFixture.graph.getNodeAttributes('0'));
    });
  const start = await screenPoint(),
    destination = { x: start.x + 180, y: start.y + 110 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await nextFrames(page);
  await page.waitForFunction(() => {
    const { graph, snapshot } = window.motionFixture;
    const n = snapshot.nodes[1];
    return Math.hypot(graph.getNodeAttribute('1', 'x') - n.x, graph.getNodeAttribute('1', 'y') - n.y) > 0.01;
  });
  const held = await screenPoint();
  assert.ok(Math.hypot(held.x - destination.x, held.y - destination.y) < 1, 'Grabbed node did not follow the pointer');
  assert.ok(
    await page.evaluate(() => {
      const { renderer: r, snapshot } = window.motionFixture,
        n = snapshot.nodes[1];
      return (
        Math.hypot(
          window.motionFixture.graph.getNodeAttribute('1', 'x') - n.x,
          window.motionFixture.graph.getNodeAttribute('1', 'y') - n.y
        ) > 0.01
      );
    }),
    'Worker did not move connected nodes'
  );
  await page.mouse.up();
  await waitForMotionIdle(page);
  const settledPositions = await page.evaluate(() =>
    window.motionFixture.graph.mapNodes((id, a) => ({ id, x: a.x, y: a.y }))
  );
  await observeUnchanged(page, () => window.motionFixture.graph.mapNodes((id, a) => [id, a.x, a.y]), 300);
  assert.equal(
    await page.evaluate(before => {
      const r = window.motionFixture.renderer;
      return Math.max(
        ...before.map(n => {
          const a = window.motionFixture.graph.getNodeAttributes(n.id);
          return Math.hypot(n.x - a.x, n.y - a.y);
        })
      );
    }, settledPositions),
    0,
    'Motion continued after settling'
  );
  await page.evaluate(() => window.motionFixture.renderer.setMotionEnabled(false));
  const pausedStart = await screenPoint(),
    pausedEnd = { x: pausedStart.x - 140, y: pausedStart.y - 130 };
  await page.mouse.move(pausedStart.x, pausedStart.y);
  await page.mouse.down();
  await page.mouse.move(pausedEnd.x, pausedEnd.y, { steps: 10 });
  await page.mouse.up();
  await waitForView(page);
  const paused = await screenPoint();
  assert.ok(Math.hypot(paused.x - pausedEnd.x, paused.y - pausedEnd.y) < 1, 'Paused dragging was constrained');
  const arrangedPositions = await page.evaluate(() =>
    window.motionFixture.graph.mapNodes((id, a) => ({ id, x: a.x, y: a.y }))
  );
  const focusBefore = await page.evaluate(() => {
    const { renderer: r, snapshot } = window.motionFixture;
    const p = window.motionFixture.sigma.graphToViewport(window.motionFixture.graph.getNodeAttributes('0'));
    const container = document.querySelector('#graph');
    const rect = container.getBoundingClientRect();
    container.dispatchEvent(new WheelEvent('wheel', { clientX: rect.left + p.x, clientY: rect.top + p.y }));
    r.applyGraphSnapshot({ ...snapshot, viewMeta: { ...snapshot.viewMeta, lodLevel: 1 } });
    return p;
  });
  await waitForView(page);
  const focusAfter = await screenPoint();
  assert.ok(
    Math.hypot(focusBefore.x - focusAfter.x, focusBefore.y - focusAfter.y) < 1,
    'LoD transition moved the zoom focus'
  );
  assert.ok(
    await page.evaluate(arranged => {
      const { renderer: r } = window.motionFixture;
      return (
        !r.isMotionEnabled() &&
        arranged.every(
          n =>
            Math.hypot(
              window.motionFixture.graph.getNodeAttribute(n.id, 'x') - n.x,
              window.motionFixture.graph.getNodeAttribute(n.id, 'y') - n.y
            ) < 1e-6
        )
      );
    }, arrangedPositions),
    'LoD changed saved positions or resumed automatic motion'
  );
  await page.evaluate(() => window.motionFixture.renderer.resetLayoutEdits());
  assert.deepEqual(errors, []);
  console.log(
    'PASS: initial layout, real worker, direct/paused dragging, settling, LoD focus, retained arrangements and reset.'
  );
} finally {
  await close();
}
