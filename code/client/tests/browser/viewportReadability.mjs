import { browserHarness, waitForView, observeUnchanged } from './browserHarness.mjs';
import assert from 'node:assert/strict';
const { page, errors, close, url } = await browserHarness({});
try {
  await page.goto(`${url}/tests/browser/elasticMotion.html?crowded`);
  await page.waitForFunction(() => window.motionFixture);
  const glyphsAreSeparated = () => {
    const { graph, sigma, renderer } = window.motionFixture;
    if (renderer.isManipulating() || renderer.getLayoutMotionState().running || sigma.getCamera().isAnimated())
      return false;
    const nodes = graph.mapNodes((_id, a) => ({ p: sigma.graphToViewport(a), radius: sigma.scaleSize(a.size) }));
    return nodes.every((a, i) =>
      nodes.slice(i + 1).every(b => Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) - a.radius - b.radius > 0.5)
    );
  };
  const checkClearance = async () => {
    await waitForView(page);
    await page.waitForFunction(glyphsAreSeparated, undefined, { timeout: 30000 });
    assert.ok(await page.evaluate(glyphsAreSeparated), 'Settled glyphs overlap');
  };
  await checkClearance();
  await page.evaluate(() => window.motionFixture.sigma.getCamera().setState({ ratio: 4 }));
  await checkClearance();
  await page.evaluate(() => window.motionFixture.sigma.getCamera().setState({ ratio: 0.25 }));
  await checkClearance();
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
  await observeUnchanged(page, () => window.motionFixture.graph.mapNodes((_id, a) => [a.x, a.y]), 500);
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
  await close();
}
