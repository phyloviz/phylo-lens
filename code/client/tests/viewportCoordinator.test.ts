import { deferred } from './helpers/state';
import { toDatasetId, toLayoutVersion, toNodeId, toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { nodeAnnotations } from './fixtures/graph';
import { decodeApiMetadata } from '../src/ancillary/apiMetadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphViewportRequest } from '../src/contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../src/contracts/graph/viewport/GraphViewportResult';
import { GraphViewportCoordinator } from '../src/app/workbench/viewport/viewportCoordinator';
import type { PositionedGraph } from '../src/contracts/positioned';
import type { GraphRenderer, RenderViewportRequestState, RenderViewportState } from '../src/render/renderer.types';

let viewportState: RenderViewportRequestState;

function viewportResponse(overrides: Partial<GraphViewportResult> = {}): GraphViewportResult {
  return {
    datasetId: toDatasetId('tree'),
    layoutVersion: toLayoutVersion('layout-1'),
    lodLevel: 0,
    zoom: 1,
    layoutStatus: 'ready',
    truncated: false,
    totalNodeCount: 2,
    globalBounds: { minX: -100, maxX: 100, minY: -50, maxY: 50 },
    ancillarySchema: [],
    nodes: [
      {
        annotations: nodeAnnotations(),
        id: toNodeId('root'),
        clusterId: toClusterId('root'),
        x: 0,
        y: 0,
        layoutStatus: 'ready',
        memberCount: 1,
        isRepresentative: false,
      },
      {
        annotations: nodeAnnotations(),
        id: toNodeId('cluster-a'),
        clusterId: toClusterId('cluster-a'),
        x: 10,
        y: 0,
        layoutStatus: 'ready',
        memberCount: 3,
        isRepresentative: true,
      },
    ],
    edges: [{ id: toNodeId('root-cluster-a'), source: toNodeId('root'), target: toNodeId('cluster-a') }],
    ...overrides,
  };
}

function clusterResponse(): GraphViewportResult {
  return viewportResponse({
    nodes: [
      {
        annotations: nodeAnnotations(),
        id: toNodeId('a1'),
        clusterId: toClusterId('cluster-a'),
        x: 9,
        y: 1,
        layoutStatus: 'ready',
        memberCount: 1,
        isRepresentative: false,
      },
      {
        annotations: nodeAnnotations(),
        id: toNodeId('a2'),
        clusterId: toClusterId('cluster-a'),
        x: 11,
        y: -1,
        layoutStatus: 'ready',
        memberCount: 1,
        isRepresentative: false,
      },
    ],
    edges: [{ id: toNodeId('a1-a2'), source: toNodeId('a1'), target: toNodeId('a2') }],
  });
}

function createRenderer(): GraphRenderer & {
  appliedGraphs: PositionedGraph[];
  emitViewChange: () => void;
  emitManipulation: (active: boolean) => void;
} {
  let viewHandler: ((state: RenderViewportState) => void) | null = null;
  let manipulationHandler: ((active: boolean) => void) | null = null;
  const renderer = {
    appliedGraphs: [] as PositionedGraph[],
    mount: vi.fn(),
    unmount: vi.fn(),
    render: vi.fn(),
    setViewChangeHandler: vi.fn((handler: ((state: RenderViewportState) => void) | null) => {
      viewHandler = handler;
    }),
    getViewportState: vi.fn(() => viewportState),
    applyGraphSnapshot: vi.fn((graph: PositionedGraph) => {
      renderer.appliedGraphs.push(graph);
    }),
    fitGraphSnapshot: vi.fn(() => null),
    emitViewChange: () => viewHandler?.({ viewport: { x: 0, y: 0, width: 1, height: 1 }, zoom: 1 }),
    setManipulationHandler: (handler: ((active: boolean) => void) | null) => {
      manipulationHandler = handler;
    },
    emitManipulation: (active: boolean) => manipulationHandler?.(active),
  };
  return renderer;
}

describe('GraphViewportCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewportState = {
      bounds: { xmin: -10, xmax: 10, ymin: -20, ymax: 20 },
      cameraRatio: 1,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a fulfilled initial load fulfilled after unmount', async () => {
    const renderer = createRenderer();
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport: vi.fn().mockResolvedValue(viewportResponse()) },
    });
    const initial = controller.waitForInitialViewport();
    controller.mount();
    await vi.runOnlyPendingTimersAsync();
    const graph = await initial;
    controller.unmount();
    await expect(controller.waitForInitialViewport()).resolves.toBe(graph);
  });

  it('can recover the view after an initial failure without changing the rejected initial promise', async () => {
    const renderer = createRenderer();
    const failure = new Error('Initial viewport failed');
    const readViewport = vi
      .fn<() => Promise<GraphViewportResult>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
    });
    const initial = controller.waitForInitialViewport();
    const rejected = expect(initial).rejects.toBe(failure);
    controller.mount();
    await vi.runOnlyPendingTimersAsync();
    await rejected;
    controller.refreshNow();
    await vi.runOnlyPendingTimersAsync();
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    await expect(controller.waitForInitialViewport()).rejects.toBe(failure);
    controller.unmount();
  });

  it('reassesses a complete overview for early refinement and viewport changes', async () => {
    viewportState = {
      ...viewportState,
      bounds: { xmin: -110, xmax: 110, ymin: -60, ymax: 60 },
      pixelSize: { width: 480, height: 240 },
    };
    const renderer = createRenderer();
    const readViewport = vi.fn().mockResolvedValue(viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenCalledTimes(2);
    viewportState = { ...viewportState, bounds: { xmin: -10, xmax: 10, ymin: -20, ymax: 20 } };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenCalledTimes(3);
    expect(readViewport.mock.calls.at(-1)?.[0]).toHaveProperty('lodSelectionBounds', viewportState.bounds);
    controller.unmount();
  });

  it('uses the effective response tier for density hysteresis and pinned expansions', async () => {
    viewportState = { ...viewportState, cameraRatio: 0.05, pixelSize: { width: 480, height: 240 } };
    const renderer = createRenderer();
    const readViewport = vi
      .fn()
      .mockImplementation(async (query: GraphViewportRequest) =>
        viewportResponse({ lodLevel: query.lodTargetRepresentations ? 1 : query.lodLevel })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport.mock.calls[0][0]).not.toHaveProperty('lodTargetRepresentations');
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lodLevel: 3, lodTargetRepresentations: 200, previousLodLevel: 0 })
    );
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.lodLevel).toBe(1);
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lodLevel: 3, previousLodLevel: 1 }));
    controller.setKeepExpanded(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport.mock.calls.at(-1)?.[0].lodLevel).toBe(1);
    expect(readViewport.mock.calls.at(-1)?.[0]).not.toHaveProperty('lodTargetRepresentations');
    await controller.expandAll();
    expect(readViewport.mock.calls.at(-1)?.[0].lodLevel).toBe(3);
    expect(readViewport.mock.calls.at(-1)?.[0]).not.toHaveProperty('lodTargetRepresentations');
    controller.unmount();
  });

  it('keeps small-tree finest intent but adapts viewport reads instead of freezing a global snapshot', async () => {
    viewportState = { ...viewportState, pixelSize: { width: 96, height: 96 } };
    const renderer = createRenderer();
    const readViewport = vi
      .fn()
      .mockImplementation(async (query: GraphViewportRequest) =>
        viewportResponse({ lodLevel: query.lodTargetRepresentations ? 1 : query.lodLevel })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
      lodTierCount: 8,
      nodeCount: 379,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport.mock.calls[0][0].lodLevel).toBe(7);
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lodLevel: 7, lodTargetRepresentations: 16, xmin: -20 })
    );
    controller.unmount();
  });

  it('invalidates in-flight responses and defers refresh until manipulation ends', async () => {
    const renderer = createRenderer();
    let resolveLate: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResult>(resolve => {
            resolveLate = resolve;
          })
      )
      .mockResolvedValue(viewportResponse({ lodLevel: 1 }));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
      lodTierCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    renderer.emitManipulation(true);
    controller.refreshNow({ lodLevel: 1 });
    resolveLate(viewportResponse({ nodes: [] }));
    await vi.advanceTimersByTimeAsync(500);
    expect(renderer.appliedGraphs).toHaveLength(1);
    expect(readViewport).toHaveBeenCalledTimes(2);
    renderer.emitManipulation(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenCalledTimes(3);
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.lodLevel).toBe(1);
    controller.unmount();
  });

  it('drops old viewport responses and refreshes expanded clusters when adopting ancillary data', async () => {
    const renderer = createRenderer();
    let resolveOld: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockResolvedValueOnce(clusterResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResult>(resolve => {
            resolveOld = resolve;
          })
      )
      .mockImplementation(async (query: GraphViewportRequest) => ({
        ...(query.clusterId ? clusterResponse() : viewportResponse()),
        layoutVersion: toLayoutVersion('metadata-1'),
        nodes: (query.clusterId ? clusterResponse() : viewportResponse()).nodes.map(node => ({
          ...node,
          annotations: decodeApiMetadata({ country: 'PT' }),
        })),
      }));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 3,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(toClusterId('cluster-a'));
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    const fits = vi.mocked(renderer.fitGraphSnapshot!).mock.calls.length;
    await controller.replaceLayoutVersion(toLayoutVersion('metadata-1'));
    const appliedCount = renderer.appliedGraphs.length;
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('a1');
    controller.collapseCluster(toClusterId('cluster-a'));
    resolveOld(viewportResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.appliedGraphs).toHaveLength(appliedCount + 1);
    const collapsed = renderer.appliedGraphs.at(-1)!;
    expect(collapsed.nodes.map(node => node.id)).not.toContain('a1');
    expect(collapsed.nodes.find(node => node.id === 'cluster-a')?.attributes?.annotations).toMatchObject({
      ancillaryData: { country: 'PT' },
    });
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledTimes(fits);
    expect(readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutVersion: toLayoutVersion('metadata-1') })
    );
    controller.unmount();
  });

  it('does not apply a metadata viewport after disposal', async () => {
    const renderer = createRenderer();
    let resolveReplacement: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResult>(resolve => {
            resolveReplacement = resolve;
          })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const pending = controller.replaceLayoutVersion(toLayoutVersion('metadata-1'));
    const rejected = expect(pending).rejects.toThrow('superseded');
    controller.unmount();
    resolveReplacement(viewportResponse({ layoutVersion: toLayoutVersion('metadata-1') }));
    await rejected;
    expect(renderer.appliedGraphs).toHaveLength(1);
  });

  it('loads viewport responses and applies renderer-neutral graph snapshots', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const onGraphApplied = vi.fn();
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-0'),
      client: { readViewport },
      renderer,
      lodTierCount: 3,
      onGraphApplied,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-0'),
        lodLevel: 0,
      })
    );
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledWith(renderer.appliedGraphs[0]);
    expect(renderer.appliedGraphs[0]?.nodes.map(node => node.id)).toEqual(['root', 'cluster-a']);
    expect(renderer.appliedGraphs[0]?.viewMeta.globalBounds).toEqual({
      minX: -100,
      maxX: 100,
      minY: -50,
      maxY: 50,
    });
    expect(onGraphApplied).toHaveBeenCalledWith(
      renderer.appliedGraphs[0],
      expect.objectContaining({ datasetId: toDatasetId('tree') })
    );
  });

  it('leaves the normal snapshot lifecycle unchanged when no observer is installed', async () => {
    const renderer = createRenderer();
    const nextSnapshotSequence = vi.fn(() => 1);
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      nextSnapshotSequence,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledOnce();
    expect(nextSnapshotSequence).not.toHaveBeenCalled();
  });

  it('reports an O(1) post-application boundary before deferred immutable diagnostics', async () => {
    const renderer = createRenderer();
    renderer.getInteractiveAggregateTargets = vi.fn(() => [
      { clusterId: toClusterId('cluster-a'), representedNodeCount: 3, clientX: 110, clientY: 90 },
    ]);
    const events: unknown[] = [];
    const order: string[] = [];
    vi.mocked(renderer.applyGraphSnapshot!).mockImplementation(graph => {
      renderer.appliedGraphs.push(graph);
      order.push('applied');
    });
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-0'),
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      snapshotObserver: (boundary, readDiagnostics) => {
        order.push('observed');
        expect(renderer.getInteractiveAggregateTargets).not.toHaveBeenCalled();
        events.push({ boundary, diagnostics: readDiagnostics() });
      },
      nextSnapshotSequence: () => 7,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(['applied', 'observed']);
    expect(events).toEqual([
      expect.objectContaining({
        boundary: {
          sequence: 7,
          reason: 'initial_load',
          datasetId: toDatasetId('tree'),
          layoutVersion: toLayoutVersion('layout-1'),
          clusterId: null,
          visibleNodeCount: 2,
          visibleEdgeCount: 1,
          visiblePrimitiveCount: 3,
        },
        diagnostics: expect.objectContaining({
          visibleAggregateTriangleCount: 1,
          aggregateTargets: [
            expect.objectContaining({
              clusterId: toClusterId('cluster-a'),
              representedNodeCount: 3,
              clientX: 110,
              clientY: 90,
              structuralFingerprint: expect.any(String),
            }),
          ],
        }),
      }),
    ]);
    expect(Object.isFrozen((events[0] as { boundary: object }).boundary)).toBe(true);
  });

  it('isolates observer failures from the applied snapshot lifecycle', async () => {
    const renderer = createRenderer();
    const onGraphApplied = vi.fn();
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      snapshotObserver: () => {
        throw new Error('diagnostics failure');
      },
      nextSnapshotSequence: () => 1,
      onGraphApplied,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledOnce();
    expect(onGraphApplied).toHaveBeenCalledOnce();
  });

  it('isolates deferred diagnostics failures after the t3 boundary', async () => {
    const renderer = createRenderer();
    renderer.getInteractiveAggregateTargets = vi.fn(() => {
      throw new Error('target diagnostics failure');
    });
    const onGraphApplied = vi.fn();
    const diagnostics = vi.fn();
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      snapshotObserver: (_boundary, readDiagnostics) => diagnostics(readDiagnostics()),
      nextSnapshotSequence: () => 1,
      onGraphApplied,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(diagnostics).toHaveBeenCalledWith(null);
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledOnce();
    expect(onGraphApplied).toHaveBeenCalledOnce();
  });

  it('keeps very large cluster representatives visually bounded', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () =>
      viewportResponse({
        nodes: [
          {
            annotations: nodeAnnotations(),
            id: toNodeId('cluster-huge'),
            clusterId: toClusterId('cluster-huge'),
            x: 0,
            y: 0,
            layoutStatus: 'ready',
            memberCount: 97_000,
            isRepresentative: true,
          },
        ],
        edges: [],
      })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.appliedGraphs[0]?.nodes[0]?.size).toBeLessThanOrEqual(6);
  });

  it('reads a bounded viewport when the renderer reports a camera change', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockClear();
    viewportState = {
      bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 },
      cameraRatio: 0.1,
    };

    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        xmin: expect.any(Number),
        xmax: expect.any(Number),
        ymin: expect.any(Number),
        ymax: expect.any(Number),
        lodLevel: expect.any(Number),
      })
    );
  });

  it('loads known small datasets at the finest tier', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      maxNodes: 6000,
      smallTreeThreshold: 2500,
      nodeCount: 2500,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        lodLevel: 3,
        maxNodes: 6000,
      })
    );
    expect(readViewport.mock.calls[0]).not.toHaveProperty('xmin');
  });

  it('keeps medium datasets at coarse LoD even when they fit within the node budget', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      maxNodes: 6000,
      smallTreeThreshold: 2500,
      nodeCount: 6000,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        lodLevel: 0,
        maxNodes: 6000,
      })
    );
    expect(readViewport.mock.calls[0]).not.toHaveProperty('xmin');
  });

  it('suppresses older in-flight responses when a newer viewport request wins', async () => {
    const renderer = createRenderer();
    const pending: Array<(response: GraphViewportResult) => void> = [];
    const readViewport = vi.fn(
      () =>
        new Promise<GraphViewportResult>(resolve => {
          pending.push(resolve);
        })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()?.(viewportResponse({ layoutVersion: toLayoutVersion('initial') }));
    await Promise.resolve();
    vi.mocked(renderer.applyGraphSnapshot!).mockClear();
    renderer.appliedGraphs = [];

    viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    controller.refreshNow({ lodLevel: 'finest' });
    await vi.advanceTimersByTimeAsync(0);

    pending[1]?.(viewportResponse({ layoutVersion: toLayoutVersion('newer'), nodes: [] }));
    await Promise.resolve();
    pending[0]?.(viewportResponse({ layoutVersion: toLayoutVersion('older') }));
    await Promise.resolve();

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.appliedGraphs[0]?.nodes).toEqual([]);
  });

  it('invalidates an in-flight viewport as soon as a newer camera query is scheduled', async () => {
    const renderer = createRenderer();
    const pending: Array<(response: GraphViewportResult) => void> = [];
    const readViewport = vi.fn(() => new Promise<GraphViewportResult>(resolve => pending.push(resolve)));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()!(viewportResponse());
    await Promise.resolve();
    viewportState = { ...viewportState, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    const applied = renderer.appliedGraphs.length;
    viewportState = { ...viewportState, bounds: { xmin: 100, xmax: 200, ymin: -200, ymax: -100 } };
    renderer.emitViewChange();
    pending.shift()!(viewportResponse({ nodes: [] }));
    await Promise.resolve();
    expect(renderer.appliedGraphs).toHaveLength(applied);
    await vi.advanceTimersByTimeAsync(120);
    pending.shift()!(viewportResponse({ nodes: [] }));
    await Promise.resolve();
    expect(renderer.appliedGraphs).toHaveLength(applied + 1);
    controller.unmount();
  });

  it('fetches the final camera position when input interrupts a fitted response', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn().mockResolvedValue(viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow({ fitToResponse: true });
    await vi.advanceTimersByTimeAsync(0);
    const requests = readViewport.mock.calls.length;
    viewportState = { bounds: { xmin: 100, xmax: 200, ymin: -200, ymax: -100 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(readViewport).toHaveBeenCalledTimes(requests + 1);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ xmin: 50, xmax: 250 }));
    controller.unmount();
  });

  it('can expand a representative again after navigation replaces its expanded snapshot', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportRequest) =>
      query.clusterId ? clusterResponse() : viewportResponse()
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const click = {
      nodeId: toNodeId('cluster-a'),
      attributes: { clusterId: toClusterId('cluster-a'), isClusterProxy: true },
    };
    await controller.expandCluster(click.attributes.clusterId);
    await Promise.resolve();
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(click.attributes.clusterId);
    await Promise.resolve();
    expect(readViewport.mock.calls.filter(([query]) => query.clusterId)).toHaveLength(2);
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('a1');
    controller.unmount();
  });

  it('keeps explicit patches across zoom-out queries until persistence is disabled', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportRequest) =>
      query.clusterId ? clusterResponse() : viewportResponse({ lodLevel: query.lodLevel })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 10000,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    viewportState = { ...viewportState, cameraRatio: 0.1 };
    controller.refreshNow({ lodLevel: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(toClusterId('cluster-a'));
    controller.setKeepExpanded(true);
    await vi.advanceTimersByTimeAsync(0);
    viewportState = { ...viewportState, cameraRatio: 2 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(120);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lodLevel: 2 }));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('a1');
    controller.collapseCluster(toClusterId('cluster-a'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).not.toContain('a1');
    controller.setKeepExpanded(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lodLevel: 0 }));
    controller.unmount();
  });

  it("leaves a group's summary intact when its full expansion exceeds the budget", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn().mockResolvedValueOnce(viewportResponse()).mockResolvedValue(clusterResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      maxNodes: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const result = await controller.expandCluster(toClusterId('cluster-a'));
    expect(result).toMatchObject({ status: 'partial', expandedClusterIds: [], renderedNodeCount: 2 });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toEqual(['root', 'cluster-a']);
    controller.unmount();
  });

  it('keeps unbounded navigation, cluster expansion and expand-all free of default caps', async () => {
    const renderer = createRenderer();
    const nodes = Array.from({ length: 6001 }, (_, i) => ({
      annotations: nodeAnnotations(),
      id: toNodeId(`member-${i}`),
      clusterId: toClusterId('cluster-a'),
      x: i,
      y: 0,
      layoutStatus: 'ready' as const,
      memberCount: 1,
      isRepresentative: false,
    }));
    const detailed = viewportResponse({ nodes, edges: [], totalNodeCount: nodes.length });
    const readViewport = vi.fn().mockResolvedValueOnce(viewportResponse()).mockResolvedValue(detailed);
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const expanded = await controller.expandCluster(toClusterId('cluster-a'));
    expect(expanded.status).toBe('complete');
    expect(expanded.renderedNodeCount).toBe(6002);
    const all = await controller.expandAll();
    expect(all).toMatchObject({ status: 'complete', allExpanded: true, renderedNodeCount: 6001 });
    expect(all.maxNodes).toBeUndefined();
    for (const [query] of readViewport.mock.calls) expect(query).not.toHaveProperty('maxNodes');
    controller.unmount();
  });

  it('reports partial expand-all results and enforces the rendered node budget', async () => {
    const renderer = createRenderer();
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockResolvedValue(
        viewportResponse({
          ...clusterResponse(),
          totalNodeCount: 10000,
          truncated: true,
          nodes: [...viewportResponse().nodes, ...clusterResponse().nodes],
        })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      maxNodes: 3,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const result = await controller.expandAll();
    expect(result).toMatchObject({ status: 'partial', allExpanded: false, renderedNodeCount: 3, maxNodes: 3 });
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lodLevel: 3, maxNodes: 3 }));
    expect(readViewport.mock.calls.at(-1)?.[0]).not.toHaveProperty('xmin');
    controller.unmount();
  });

  it('does not restore expansion when a pending response arrives after collapse', async () => {
    const renderer = createRenderer();
    let resolve: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResult>(done => {
            resolve = done;
          })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const pending = controller.expandCluster(toClusterId('cluster-a'));
    controller.collapseCluster(toClusterId('cluster-a'));
    resolve(clusterResponse());
    expect(await pending).toMatchObject({ status: 'superseded', expandedClusterIds: [] });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).not.toContain('a1');
    controller.unmount();
  });

  it('retains a complete expand-all snapshot through zoom and ancillary replacement', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportRequest) =>
      viewportResponse({
        layoutVersion: query.layoutVersion ?? toLayoutVersion('layout-1'),
        lodLevel: query.lodLevel,
      })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 10000,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.setKeepExpanded(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(await controller.expandAll()).toMatchObject({ status: 'complete', allExpanded: true });
    const requests = readViewport.mock.calls.length;
    viewportState = { ...viewportState, cameraRatio: 4 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(readViewport).toHaveBeenCalledTimes(requests);
    await controller.replaceLayoutVersion(toLayoutVersion('ancillary-2'));
    expect(controller.getExpansionState().allExpanded).toBe(true);
    expect(readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lodLevel: 3, layoutVersion: toLayoutVersion('ancillary-2') })
    );
    expect(await controller.collapseAll()).toMatchObject({ allExpanded: false, expandedClusterIds: [] });
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lodLevel: 0 }));
    controller.unmount();
  });

  it('ignores stale responses after unmount', async () => {
    const renderer = createRenderer();
    let resolveResponse: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi.fn(
      () =>
        new Promise<GraphViewportResult>(resolve => {
          resolveResponse = resolve;
        })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.unmount();
    resolveResponse(viewportResponse());
    await Promise.resolve();

    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it('does not refresh from camera changes while paused but refreshes predictably on resume', async () => {
    let paused = false;
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      getPaused: () => paused,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockClear();
    viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };

    paused = true;
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(200);
    expect(readViewport).not.toHaveBeenCalled();

    paused = false;
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenCalledOnce();
  });

  it('fails predictably when a renderer cannot apply graph snapshots', async () => {
    const readViewport = vi.fn(async () => viewportResponse());
    const onError = vi.fn();
    const renderer: GraphRenderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      setViewChangeHandler: vi.fn(),
      getViewportState: vi.fn(() => viewportState),
    };
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      onError,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Viewport sync requires a renderer that can apply graph snapshots.',
      })
    );
  });

  it('expands and collapses representative clusters without renderer transport hooks', async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportRequest) =>
      query.clusterId === 'cluster-a' ? clusterResponse() : viewportResponse()
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(toClusterId('cluster-a'));
    await Promise.resolve();

    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ clusterId: toClusterId('cluster-a') }));
    expect(
      renderer.appliedGraphs
        .at(-1)
        ?.nodes.map(node => node.id)
        .sort()
    ).toEqual(['a1', 'a2', 'root']);

    readViewport.mockClear();
    await controller.expandCluster(toClusterId('cluster-a'));
    await Promise.resolve();
    expect(readViewport).not.toHaveBeenCalled();

    controller.collapseCluster(toClusterId('cluster-a'));

    expect(
      renderer.appliedGraphs
        .at(-1)
        ?.nodes.map(node => node.id)
        .sort()
    ).toEqual(['cluster-a', 'root']);
  });

  it('still expands a different eligible cluster immediately after another cluster is expanded', async () => {
    const renderer = createRenderer();
    const initial = viewportResponse({
      nodes: [
        ...viewportResponse().nodes,
        {
          annotations: nodeAnnotations(),
          id: toNodeId('cluster-b'),
          clusterId: toClusterId('cluster-b'),
          x: -10,
          y: 0,
          layoutStatus: 'ready',
          memberCount: 4,
          isRepresentative: true,
        },
      ],
      edges: [
        ...viewportResponse().edges,
        { id: toNodeId('root-cluster-b'), source: toNodeId('root'), target: toNodeId('cluster-b') },
      ],
    });
    const readViewport = vi.fn(async (query: GraphViewportRequest) => (query.clusterId ? clusterResponse() : initial));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(toClusterId('cluster-a'));
    await Promise.resolve();
    readViewport.mockClear();

    await controller.expandCluster(toClusterId('cluster-b'));
    await Promise.resolve();

    expect(readViewport).toHaveBeenCalledOnce();
    expect(readViewport).toHaveBeenCalledWith(expect.objectContaining({ clusterId: toClusterId('cluster-b') }));
  });

  it('labels viewport, expansion, and local collapse applications with monotonic sequences', async () => {
    const renderer = createRenderer();
    const events: Array<{ sequence: number; reason: string; clusterId: string | null }> = [];
    let nextSequence = 0;
    const readViewport = vi.fn(async (query: GraphViewportRequest) =>
      query.clusterId === 'cluster-a' ? clusterResponse() : viewportResponse()
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      snapshotObserver: boundary => events.push(boundary),
      nextSnapshotSequence: () => ++nextSequence,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    await controller.expandCluster(toClusterId('cluster-a'));
    await Promise.resolve();
    controller.collapseCluster(toClusterId('cluster-a'));

    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map(event => event.reason)).toEqual([
      'initial_load',
      'viewport_sync',
      'cluster_expand',
      'cluster_collapse',
    ]);
    expect(events.at(-1)?.clusterId).toBe('cluster-a');
  });
  it('keeps a searched target in a full slice and fetches another member of the same partial cluster', async () => {
    const renderer = createRenderer();
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockResolvedValueOnce(
        viewportResponse({ ...clusterResponse(), nodes: [clusterResponse().nodes[0]], truncated: true })
      )
      .mockResolvedValueOnce(
        viewportResponse({ ...clusterResponse(), nodes: [clusterResponse().nodes[1]], truncated: true })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      maxNodes: 2,
    });
    controller.mount();
    await vi.runAllTimersAsync();
    await controller.expandCluster(toClusterId('cluster-a'), { focusNodeId: toNodeId('a1') });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('a1');
    await controller.expandCluster(toClusterId('cluster-a'), { focusNodeId: toNodeId('a2') });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('a2');
    expect(renderer.appliedGraphs.at(-1)?.nodes).toHaveLength(2);
    expect(readViewport).toHaveBeenCalledTimes(3);
    controller.unmount();
  });

  it('does not apply a focus response after navigation has been cancelled', async () => {
    const renderer = createRenderer();
    let resolve!: (response: GraphViewportResult) => void;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResult>(done => {
            resolve = done;
          })
      );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });
    controller.mount();
    await vi.runAllTimersAsync();
    const focus = controller.expandCluster(toClusterId('cluster-a'), { focusNodeId: toNodeId('a1') });
    controller.cancelPendingFocus();
    resolve(clusterResponse());
    expect((await focus).status).toBe('superseded');
    expect(renderer.appliedGraphs).toHaveLength(1);
    controller.unmount();
  });
  it('captures focus and camera-fit options while expansion is pending', async () => {
    const renderer = createRenderer();
    const next = deferred<GraphViewportResult>();
    const readViewport = vi
      .fn(async () => viewportResponse())
      .mockReturnValueOnce(Promise.resolve(viewportResponse()))
      .mockReturnValueOnce(next.promise);
    const coordinator = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
    });
    coordinator.mount();
    await vi.advanceTimersByTimeAsync(0);
    const fits = vi.mocked(renderer.fitGraphSnapshot!).mock.calls.length;
    const options = { focusNodeId: toNodeId('a1'), fitToResponse: false };
    const expanding = coordinator.expandCluster(toClusterId('cluster-a'), options);
    options.focusNodeId = toNodeId('missing');
    options.fitToResponse = true;
    next.resolve(clusterResponse());
    await expect(expanding).resolves.toMatchObject({ status: 'complete' });
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledTimes(fits);
    coordinator.unmount();
  });
});
