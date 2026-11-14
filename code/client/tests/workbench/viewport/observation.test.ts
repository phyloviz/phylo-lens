import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import { toDatasetId, toLayoutVersion, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import { viewportResponse, clusterResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('leaves the normal snapshot lifecycle unchanged when no observer is installed', async () => {
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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

  it('labels viewport, expansion, and local collapse applications with monotonic sequences', async () => {
    const renderer = recordingRenderer();
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
    renderer.viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };
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
});
