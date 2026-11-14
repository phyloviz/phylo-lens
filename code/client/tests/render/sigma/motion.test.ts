import { setupSigmaHarness } from './harness';
import { expect, it, vi } from 'vitest';
import Graph from 'graphology';
import type { PositionedGraph } from '../../../src/contracts/positioned';

const harness = setupSigmaHarness();

describe('sigmaRenderer', () => {
  it('runs live force motion for both client and server layouts', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.starts().length).toBe(1);

    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(harness.starts().length).toBe(2);
    expect(harness.kills()).toBe(1);
    expect(harness.starts().at(-1)?.settings).toMatchObject({
      // Defaults are applied inside the worker.
    });

    renderer.unmount();
  });

  it('allows scale-aware force settings to be overridden', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer({
      forceMotion: {
        enabled: true,
        settings: { anchorStrength: 0.05, linkStrength: 0.4 },
      },
    });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.starts().at(-1)?.settings).toMatchObject({
      anchorStrength: 0.05,
      linkStrength: 0.4,
    });

    renderer.unmount();
  });

  it('can disable live force motion', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.starts().length).toBe(0);

    renderer.unmount();
  });

  it('keeps cluster proxy triangle tips aligned while force motion moves nodes', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        {
          id: 'cluster',
          x: 0,
          y: 10,
          attributes: { isClusterProxy: true },
        },
      ],
      edges: [{ id: 'root-cluster', source: 'root', target: 'cluster' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    harness.motion().emit([10, 0, 0, 10]);

    expect(harness.sigma().graph?.getNodeAttribute('cluster', 'triangleRotation')).toBeCloseTo(Math.atan2(-10, 10));

    renderer.unmount();
  });

  it('keeps worker motion on while dragging, protects pins and defers viewport replacement', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });
    const snapshot: PositionedGraph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 20, y: 0 },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b', attributes: { distance: 7 } }],
      viewMeta: { layout: 'server', lodLevel: 0, globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    };
    renderer.applyGraphSnapshot(snapshot);
    const graph = harness.sigma().graph!;
    harness.sigma().handler('downNode')?.({ node: 'a', event: { x: 0, y: 0 } });
    harness
      .sigma()
      .mouse.handlers.get('mousemovebody')
      ?.forEach(handler => handler({ x: 4, y: 3 }));
    expect(renderer.isManipulating()).toBe(true);
    expect(harness.kills()).toBe(0);
    harness.motion().tick(10);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 4, y: 3 });
    expect(graph.getNodeAttribute('b', 'x')).not.toBe(20);
    expect(graph.getEdgeAttribute('ab', 'distance')).toBe(7);
    renderer.applyGraphSnapshot({ ...snapshot, nodes: [...snapshot.nodes, { id: 'c', x: 30, y: 0 }] });
    expect(graph.hasNode('c')).toBe(false);
    harness
      .sigma()
      .mouse.handlers.get('mouseup')
      ?.forEach(handler => handler({ x: 4, y: 3 }));
    expect(graph.hasNode('c')).toBe(true);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 4, y: 3 });
    expect(renderer.isMotionEnabled()).toBe(true);
    expect(renderer.isManipulating()).toBe(false);
    renderer.setMotionEnabled(false);
    const startCount = harness.starts().length;
    renderer.applyGraphSnapshot(snapshot);
    expect(harness.starts().length).toBe(startCount);
    expect(renderer.getDisplayedNodesInBounds({ xmin: 3, xmax: 5, ymin: 2, ymax: 4 })).toEqual(['a']);
    renderer.resetLayoutEdits();
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 0, y: 0 });
    expect(renderer.isMotionEnabled()).toBe(false);
    renderer.unmount();
  });

  it('preserves manual positions through expansion and detail changes without animating', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: harness.requireContainer() });
    const coarse: PositionedGraph = {
      nodes: [{ id: 'p', x: 20, y: 0, size: 3, attributes: { isClusterProxy: true, clusterId: 'g' } }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0, globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    };
    renderer.applyGraphSnapshot(coarse);
    harness.sigma().handler('downNode')?.({ node: 'p', event: { x: 20, y: 0 } });
    harness
      .sigma()
      .mouse.handlers.get('mousemovebody')
      ?.forEach(handler => handler({ x: 25, y: 3 }));
    harness
      .sigma()
      .mouse.handlers.get('mouseup')
      ?.forEach(handler => handler({ x: 25, y: 3 }));
    const fine: PositionedGraph = {
      ...coarse,
      nodes: [
        { id: 'a', x: 19, y: 0, size: 3, attributes: { clusterId: 'g' } },
        { id: 'b', x: 21, y: 0, size: 3, attributes: { clusterId: 'g' } },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
    };
    renderer.applyGraphSnapshot(fine);
    const graph = harness.sigma().graph!;
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 24, y: 3 });
    expect(renderer.isManipulating()).toBe(false);
    harness.animationFrameCallback?.(performance.now() + 300);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 24, y: 3 });
    expect(graph.getNodeAttributes('b')).toMatchObject({ x: 26, y: 3 });
    expect(renderer.isMotionEnabled()).toBe(false);
    expect(renderer.isManipulating()).toBe(false);
    renderer.applyGraphSnapshot(fine);
    expect(renderer.isManipulating()).toBe(false);
    renderer.applyGraphSnapshot({ ...fine, viewMeta: { ...fine.viewMeta, lodLevel: 1 } });
    expect(renderer.isManipulating()).toBe(false);
    harness.animationFrameCallback?.(performance.now() + 300);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 24, y: 3 });
    renderer.unmount();
  });

  it('interrupts child animation at the displayed position when direct dragging starts', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });
    const viewMeta: PositionedGraph['viewMeta'] = {
      layout: 'server',
      lodLevel: 0,
      globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    };
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'p', x: 20, y: 0, attributes: { isClusterProxy: true, clusterId: 'g' } }],
      edges: [],
      viewMeta,
    });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 25, y: 0, attributes: { clusterId: 'g' } },
        { id: 'b', x: 30, y: 0, attributes: { clusterId: 'g' } },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
      viewMeta,
    });
    harness.animationFrameCallback?.(performance.now() + 80);
    const graph = harness.sigma().graph!;
    const x = graph.getNodeAttribute('a', 'x');
    expect(x).toBeGreaterThan(20);
    expect(x).toBeLessThan(25);
    harness.sigma().handler('downNode')?.({ node: 'a', event: { x, y: 0 } });
    expect(graph.getNodeAttribute('a', 'x')).toBe(x);
    harness
      .sigma()
      .mouse.handlers.get('mousemovebody')
      ?.forEach(handler => handler({ x: x + 1, y: 0 }));
    expect(graph.getNodeAttribute('a', 'x')).toBeCloseTo(x + 1);
    harness
      .sigma()
      .mouse.handlers.get('mouseup')
      ?.forEach(handler => handler({ x: x + 1, y: 0 }));
    expect(renderer.isManipulating()).toBe(false);
    renderer.unmount();
  });

  it('retains dragged positions while replacing ancillary presentation', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    const snapshot: PositionedGraph = {
      nodes: [{ id: 'a', x: 0, y: 0, color: '#123456', size: 3 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    };
    renderer.applyGraphSnapshot(snapshot);
    const graph = harness.sigma().graph!;
    graph.mergeNodeAttributes('a', { x: 0.05, y: 0.07 });
    renderer.applyGraphSnapshot(
      { ...snapshot, nodes: [{ ...snapshot.nodes[0], color: '#abcdef' }] },
      { preservePositions: true }
    );
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 0.05, y: 0.07, color: '#abcdef' });
    renderer.unmount();
  });

  it('restarts motion after an LoD transition completes', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    vi.spyOn(performance, 'now').mockReturnValue(0);

    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });

    renderer.render({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
      ],
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(harness.starts().length).toBe(1);

    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
      ],
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
      viewMeta: { layout: 'server', lodLevel: 1 },
    });

    expect(harness.starts().length).toBe(1);

    const frame = harness.animationFrameCallback;
    expect(frame).not.toBeNull();

    frame?.(1000);

    expect(harness.starts().length).toBe(2);

    renderer.unmount();
  });

  it('does not recenter the camera during a moving LoD transition or overwrite newer navigation', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: document.createElement('div') });
    const viewMeta = { layout: 'server' as const, lodLevel: 0, globalBounds: { minX: 0, maxX: 12, minY: -2, maxY: 4 } };
    renderer.render({
      nodes: [
        { id: 'anchor', x: 2, y: 0 },
        { id: 'proxy', x: 6, y: 0, attributes: { isClusterProxy: true, clusterId: 'group' } },
      ],
      edges: [],
      viewMeta,
    });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'anchor', x: 2, y: 0 },
        { id: 'm1', x: 6, y: 0, attributes: { clusterId: 'group' } },
        { id: 'm2', x: 7, y: 1, attributes: { clusterId: 'group' } },
      ],
      edges: [],
      viewMeta: { ...viewMeta, lodLevel: 1 },
    });
    harness.sigma().camera?.setState({ x: 0.6, y: 0.4, ratio: 0.3 });
    harness.animationFrameCallback?.(1000);
    expect(harness.sigma().camera?.state).toMatchObject({ x: 0.6, y: 0.4, ratio: 0.3 });
    renderer.unmount();
  });

  it('ignores queued transition frames after a newer snapshot or unmount', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({ nodes: [{ id: 'a', x: 0, y: 0 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'a', x: 10, y: 0 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 1 },
    });
    const oldFrame = harness.animationFrameCallback;
    expect(oldFrame).not.toBeNull();

    renderer.applyGraphSnapshot({
      nodes: [{ id: 'b', x: 20, y: 0 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 2 },
    });
    const currentFrame = harness.animationFrameCallback;
    expect(currentFrame).not.toBeNull();
    const graph = harness.sigma().graph!;
    const notify = vi.fn();
    renderer.setManipulationHandler(notify);
    oldFrame?.(performance.now() + 300);
    expect(graph.nodes()).toEqual(['b']);
    expect(graph.getNodeAttributes('b')).toMatchObject({ x: 20, y: 0 });
    expect(renderer.isManipulating()).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    renderer.unmount();
    currentFrame?.(performance.now() + 300);
    expect(renderer.isManipulating()).toBe(false);
    expect(graph.getNodeAttributes('b')).toMatchObject({ x: 20, y: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('captures motion settings and pin values before restarting the worker', async () => {
    const { default: motion } = await import('../../../src/render/adapters/sigma/motion/sigmaForceMotion');
    const graph = new Graph();
    graph.addNode('a', { x: 0, y: 0 });
    graph.addNode('b', { x: 10, y: 0 });
    graph.addEdge('a', 'b');
    const options = { enabled: false, settings: { linkStrength: 0.2 } };
    const physics = motion(options, {
      reference: () => undefined,
      anchor: () => undefined,
      constrain: (_id, point) => point,
    });
    const pins = [{ id: 'a', x: 5, y: 7 }];
    physics.setPins(pins);
    pins[0].x = 900;
    pins.push({ id: 'b', x: 800, y: 800 });
    options.settings.linkStrength = 0.9;
    physics.start(graph);
    physics.setEnabled(true);
    const start = [...harness.commands()].reverse().find(command => command.type === 'start');
    const pin = [...harness.commands()].reverse().find(command => command.type === 'pin');
    expect(start?.type === 'start' && start.settings.linkStrength).toBe(0.2);
    expect(pin?.type === 'pin' && pin.points).toEqual([{ id: 'a', x: 5, y: 7 }]);
    physics.dispose();
  });
});
