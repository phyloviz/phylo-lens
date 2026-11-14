import { setupSigmaHarness } from './harness';
import { expect, it, vi } from 'vitest';
import {
  SIGMA_MAX_LOD_ZOOM,
  sigmaCameraToViewportState,
  sigmaCameraToSemanticViewState,
  sigmaRatioToLodZoom,
} from '../../../src/render/adapters/sigma/sigmaRenderer';

const harness = setupSigmaHarness();

describe('sigmaRenderer', () => {
  it('refreshes viewport detail on resize without requiring a camera change', () => {
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: document.createElement('div') });
    renderer.render({ nodes: [{ id: 'a', x: 0, y: 0 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    const handler = vi.fn();
    renderer.setViewChangeHandler(handler);
    harness.sigma().dimensions = { width: 600, height: 400 };
    harness.sigma().handler('resize')?.({});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(renderer.getViewportState()?.pixelSize).toEqual({ width: 600, height: 400 });
    renderer.unmount();
    expect(harness.sigma().handler('resize')).toBeNull();
  });

  it('keeps a stable footprint budget across tiers and resets it for a new render', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: document.createElement('div') });
    harness.sigma().scaleSize = size => size;
    const snapshot = {
      nodes: [{ id: 'a', x: 0, y: 0, size: 20 }],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    expect(renderer.getViewportState()?.representationSpacingPx).toBe(42);
    const finer = { ...snapshot, nodes: [{ id: 'a', x: 0, y: 0, size: 3 }] };
    renderer.applyGraphSnapshot(finer);
    expect(renderer.getViewportState()?.representationSpacingPx).toBe(42);
    renderer.render(finer);
    expect(renderer.getViewportState()?.representationSpacingPx).toBe(8);
    renderer.unmount();
  });

  it('accounts for the real triangle footprint in the stable detail budget', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: document.createElement('div') });
    harness.sigma().scaleSize = size => size;
    const snapshot = {
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 12,
          attributes: { type: 'triangle', isClusterProxy: true, memberCount: 90_000 },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    expect(harness.sigma().graph?.getNodeAttribute('group', 'size')).toBe(12);
    expect(renderer.getViewportState()?.representationSpacingPx).toBeCloseTo(2 * 12 * 1.35 + 2);
    renderer.applyGraphSnapshot({
      ...snapshot,
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 10,
          attributes: { type: 'triangle', isBranchCollapsed: true, memberCount: 1 },
        },
      ],
    });
    expect(renderer.getViewportState()?.representationSpacingPx).toBeCloseTo(2 * 12 * 1.35 + 2);
    renderer.unmount();
  });

  it('exposes renderer-neutral viewport sync state', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    harness.sigma().camera?.setState({ ratio: 2 });

    expect(renderer.getViewportState()).toEqual({
      bounds: { xmin: 0, xmax: 300, ymin: 0, ymax: 200 },
      cameraRatio: 2,
      selectionBounds: { xmin: 0, xmax: 300, ymin: 0, ymax: 200 },
      representationSpacingPx: 0,
      pixelSize: { width: 300, height: 200 },
    });

    renderer.unmount();
  });

  it('provides real Sigma-derived hit coordinates for interactive aggregate triangles', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    harness.sigmaDoubles.defaults.graphToViewport = point => ({ x: point.x + 100, y: point.y + 50 });

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        {
          id: 'cluster-b',
          x: 12,
          y: 8,
          attributes: { clusterId: 'cluster-b', memberCount: 5, isClusterProxy: true, type: 'triangle' },
        },
        { id: 'leaf', x: 2, y: 3, attributes: { memberCount: 1 } },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(renderer.getInteractiveAggregateTargets()).toEqual([
      { clusterId: 'cluster-b', representedNodeCount: 5, clientX: 112, clientY: 58 },
    ]);

    renderer.unmount();
  });

  it("centers raw search coordinates through Sigma's graph conversion", () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    harness.sigmaDoubles.defaults.graphToViewport = point => ({
      x: point.x * 4 + 100,
      y: point.y * 4 + 50,
    });
    harness.sigmaDoubles.defaults.viewportToFramedGraph = point => ({
      x: (point.x - 100) / 40,
      y: (point.y - 50) / 40,
    });

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });

    expect(renderer.centerOnCoordinates(25, -5)).toBe(true);
    expect(harness.sigma().camera?.state).toMatchObject({
      x: 2.5,
      y: -0.5,
      ratio: 1,
    });

    renderer.unmount();
  });

  it('maps deeper camera zoom to progressively higher lod zoom values', () => {
    expect(sigmaRatioToLodZoom(2)).toBe(0.5);
    expect(sigmaRatioToLodZoom(1)).toBe(1);
    expect(sigmaRatioToLodZoom(0.5)).toBe(2);
    expect(sigmaRatioToLodZoom(0.25)).toBe(3);
    expect(sigmaRatioToLodZoom(0.125)).toBe(4);
    expect(sigmaRatioToLodZoom(0.05)).toBeGreaterThanOrEqual(5);
    expect(sigmaRatioToLodZoom(0.002)).toBe(SIGMA_MAX_LOD_ZOOM);
  });

  it('translates sigma camera state into graph-space viewport bounds', () => {
    expect(
      sigmaCameraToViewportState({ minX: -120, maxX: 280, minY: 0, maxY: 300 }, { x: 0.25, y: 0.5, ratio: 0.5 })
    ).toEqual({
      x: -20,
      y: 150,
      width: 200,
      height: 150,
    });
  });

  it('derives semantic view state from normalized sigma camera state', () => {
    expect(
      sigmaCameraToSemanticViewState({ minX: -120, maxX: 280, minY: 0, maxY: 300 }, { x: -10, y: 2, ratio: 0.25 })
    ).toEqual({
      camera: {
        x: 0,
        y: 1,
        ratio: 0.25,
      },
      viewport: {
        x: -120,
        y: 300,
        width: 100,
        height: 75,
      },
      lodZoom: 3,
      edgeDistanceLabelsVisible: true,
    });
  });

  it('emits camera viewports in global graph bounds when a slice provides them', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    const handler = vi.fn();
    renderer.mount({ container: harness.requireContainer() });
    renderer.setViewChangeHandler(handler);
    renderer.render({
      nodes: [
        { id: 'left', x: -10, y: 0 },
        { id: 'nearby', x: 10, y: 0 },
      ],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });

    harness.sigma().camera?.setState({ x: 0.25, y: 0.5, ratio: 0.25 });
    harness.sigma().camera.emit('updated', undefined);

    expect(handler).toHaveBeenCalledWith({
      viewport: {
        x: -500,
        y: 0,
        width: 500,
        height: 250,
      },
      zoom: 3,
    });
    expect(harness.sigma().customBBox).toEqual({
      x: [-1000, 1000],
      y: [-500, 500],
    });

    renderer.unmount();
  });

  it('preserves camera state across repeated server graph snapshots', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const graph = {
      nodes: [{ id: 'leaf', x: 0, y: 0, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } }],
      edges: [],
      viewMeta: {
        layout: 'server' as const,
        lodLevel: 1,
        globalBounds: { minX: -100, maxX: 100, minY: -50, maxY: 50 },
      },
    };

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    harness.sigma().camera?.setState({ x: 0.35, y: 0.45, ratio: 0.2 });

    renderer.applyGraphSnapshot(graph);
    renderer.applyGraphSnapshot({
      ...graph,
      nodes: [{ id: 'leaf-2', x: 10, y: 5, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } }],
    });

    expect(harness.sigma().camera?.state).toMatchObject({ x: 0.35, y: 0.45, ratio: 0.2 });
    expect(harness.sigma().customBBox).toEqual({ x: [-100, 100], y: [-50, 50] });
    expect(harness.sigma().customBBoxCalls).toBe(1);

    renderer.unmount();
  });

  it('preserves the global coordinate frame when toggling labels on a partial slice', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'leaf', x: 10, y: 5 }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });
    harness.sigma().camera?.setState({ x: 1.2, y: -0.3, ratio: 0.2 });
    const constructions = harness.sigmaDoubles.instances.length;
    for (const enabled of [true, false, true]) {
      renderer.updateDisplayOptions({ edgeDistanceLabels: enabled });
      expect(harness.sigma().customBBox).toEqual({ x: [-1000, 1000], y: [-500, 500] });
      expect(harness.sigma().camera?.state).toMatchObject({ x: 1.2, y: -0.3, ratio: 0.2 });
    }
    expect(harness.sigmaDoubles.instances.length).toBe(constructions);
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'leaf', x: 10, y: 5, attributes: { pie__country__value__portugal: 1 } }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });
    expect(harness.sigmaDoubles.instances.length).toBeGreaterThan(constructions);
    expect(harness.sigma().customBBox).toEqual({ x: [-1000, 1000], y: [-500, 500] });
    expect(harness.sigma().camera?.state).toMatchObject({ x: 1.2, y: -0.3, ratio: 0.2 });
    renderer.unmount();
  });
});
