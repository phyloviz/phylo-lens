import { setupSigmaHarness } from './harness';
import { expect, it, vi } from 'vitest';

const harness = setupSigmaHarness();

describe('sigmaRenderer', () => {
  it('keeps independent views alive when another renderer is disposed', () => {
    const first = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    first.mount({ container: document.createElement('div') });
    first.render({ nodes: [{ id: 'first', x: 0, y: 0 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    const firstSigma = harness.sigma();
    const second = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    second.mount({ container: document.createElement('div') });
    second.render({ nodes: [{ id: 'second', x: 1, y: 1 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    const secondSigma = harness.sigma();
    const changed = vi.fn();
    second.setViewChangeHandler(changed);
    first.unmount();
    secondSigma.dimensions = { width: 640, height: 480 };
    secondSigma.emit('resize', {});
    expect(firstSigma.disposed).toBe(true);
    expect(secondSigma.disposed).toBe(false);
    expect(secondSigma.graph.nodes()).toEqual(['second']);
    expect(second.getViewportState()?.pixelSize).toEqual({ width: 640, height: 480 });
    expect(changed).toHaveBeenCalledOnce();
  });

  it('resizes with its host panel and disconnects the container observer on unmount', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let notify: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      }
    );
    try {
      const renderer = harness.createSigmaRenderer();
      const container = harness.requireContainer();
      renderer.mount({ container });
      expect(observe).toHaveBeenCalledWith(container);
      const before = harness.sigma().scheduledRenders;
      notify?.([], {} as ResizeObserver);
      expect(harness.sigma().scheduledRenders).toBe(before + 1);
      renderer.unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
      notify?.([], {} as ResizeObserver);
      expect(harness.sigma().scheduledRenders).toBe(before + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps renderer instances independent and allows methods to be passed as callbacks', () => {
    const first = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    const second = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    first.mount({ container: document.createElement('div') });
    const firstGraph = harness.sigma().graph!;
    second.mount({ container: document.createElement('div') });
    const secondGraph = harness.sigma().graph!;

    const { render, unmount } = first;
    render({ nodes: [{ id: 'a', x: 1, y: 2 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    expect(firstGraph.nodes()).toEqual(['a']);
    expect(secondGraph.nodes()).toEqual([]);

    unmount();
    second.render({ nodes: [{ id: 'b', x: 3, y: 4 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    expect(secondGraph.nodes()).toEqual(['b']);
    expect(second.getViewportState()).not.toBeNull();
    second.unmount();
  });

  it('keeps camera and node handlers bound after Sigma is rebuilt for pie programs', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    const viewHandler = vi.fn();
    const clickHandler = vi.fn();
    renderer.mount({ container: harness.requireContainer() });
    renderer.setViewChangeHandler(viewHandler);
    renderer.setNodeClickHandler(clickHandler);

    renderer.render({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: { pie__country__value__portugal: 1 },
        },
      ],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 0,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });

    harness.sigma().camera.emit('updated', undefined);
    harness.sigma().handler('clickNode')?.({ node: 'a' });

    expect(viewHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: expect.any(Object),
        zoom: expect.any(Number),
      })
    );
    expect(clickHandler).toHaveBeenCalledWith({
      nodeId: 'a',
      attributes: expect.objectContaining({ pie__country__value__portugal: 1 }),
    });

    expect(harness.sigma().customBBox).toEqual({ x: [-1000, 1000], y: [-500, 500] });
    renderer.unmount();
  });

  it('does not reconstruct Sigma when applying a plain server graph snapshot', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const plainGraph = {
      nodes: [{ id: 'leaf', x: 0, y: 0, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } }],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    const constructions = harness.sigmaDoubles.instances.length;

    renderer.applyGraphSnapshot(plainGraph);
    renderer.applyGraphSnapshot(plainGraph);

    expect(harness.sigmaDoubles.instances).toHaveLength(constructions);

    renderer.unmount();
  });

  it('clears every retained position when another dataset reuses node identities', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 10, y: 20 },
        { id: 'b', x: 20, y: 30 },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    expect(harness.starts().length).toBe(1);
    renderer.resetLayoutEdits({ allViews: true });
    renderer.setMotionEnabled(true);
    expect(harness.starts().length).toBe(1);
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 100, y: 200 },
        { id: 'b', x: 200, y: 300 },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    expect(harness.sigma().graph!.getNodeAttributes('a')).toMatchObject({ x: 100, y: 200 });
    renderer.unmount();
  });

  it('captures nested renderer settings before mounting', () => {
    const options = { label: { size: 13 }, display: { nodeLabels: true }, edge: { labelSize: 9 } };
    const renderer = harness.createSigmaRenderer(options);
    options.label.size = 50;
    options.display.nodeLabels = false;
    options.edge.labelSize = 50;
    renderer.mount({ container: harness.requireContainer() });
    expect(harness.sigma().settings).toMatchObject({ labelSize: 13, renderLabels: true, edgeLabelSize: 9 });
    renderer.unmount();
  });
});
