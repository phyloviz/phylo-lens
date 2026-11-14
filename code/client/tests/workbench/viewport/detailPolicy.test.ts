import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import type { GraphClient } from '../../../src/contracts/graph/GraphClient';
import { toDatasetId, toNodeId, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { nodeAnnotations } from '../../fixtures/graph';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import { viewportResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('reassesses a complete overview for early refinement and viewport changes', async () => {
    const renderer = recordingRenderer();
    renderer.viewportState = {
      ...renderer.viewportState,
      bounds: { xmin: -110, xmax: 110, ymin: -60, ymax: 60 },
      pixelSize: { width: 480, height: 240 },
    };
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
    renderer.viewportState = { ...renderer.viewportState, bounds: { xmin: -10, xmax: 10, ymin: -20, ymax: 20 } };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenCalledTimes(3);
    expect(readViewport.mock.calls.at(-1)?.[0]).toHaveProperty('lodSelectionBounds', renderer.viewportState.bounds);
    controller.unmount();
  });

  it('uses the effective response tier for density hysteresis and pinned expansions', async () => {
    const renderer = recordingRenderer();
    renderer.viewportState = { ...renderer.viewportState, cameraRatio: 0.05, pixelSize: { width: 480, height: 240 } };
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
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ lodLevel: 3, lodTargetRepresentations: 200, previousLodLevel: 0 })
    );
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.lodLevel).toBe(1);
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ lodLevel: 3, previousLodLevel: 1 })
    );
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
    const renderer = recordingRenderer();
    renderer.viewportState = { ...renderer.viewportState, pixelSize: { width: 96, height: 96 } };
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
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ lodLevel: 7, lodTargetRepresentations: 16, xmin: -20 })
    );
    controller.unmount();
  });

  it('honors a configured visual ceiling for very large cluster representatives', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () =>
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
      getRenderSettings: () => ({ visualMapping: { groupSize: { maximumSize: 20 } } }),
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.appliedGraphs[0]?.nodes[0]?.size).toBeGreaterThan(19);
    expect(renderer.appliedGraphs[0]?.nodes[0]?.size).toBeLessThanOrEqual(20);
  });

  it('loads known small datasets at the finest tier', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
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

    expect(vi.mocked(readViewport).mock.calls.map(call => call[0])).toContainEqual(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        lodLevel: 3,
        maxNodes: 6000,
      })
    );
    expect(readViewport.mock.calls[0]).not.toHaveProperty('xmin');
  });

  it('keeps medium datasets at coarse LoD even when they fit within the node budget', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
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

    expect(vi.mocked(readViewport).mock.calls.map(call => call[0])).toContainEqual(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        lodLevel: 0,
        maxNodes: 6000,
      })
    );
    expect(readViewport.mock.calls[0]).not.toHaveProperty('xmin');
  });
});
