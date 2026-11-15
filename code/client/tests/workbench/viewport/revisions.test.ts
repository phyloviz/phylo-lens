import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import { toDatasetId, toLayoutVersion, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { decodeApiMetadata } from '../../../src/ancillary/apiMetadata';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';
import { viewportResponse, clusterResponse } from './fixtures';
import type { GraphRootingResult } from '../../../src/contracts/graph/rooting';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('replaces rooted groups, clears expansion and saved folds, and maps the active component without refitting', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn(async (request: GraphViewportRequest) => ({
      ...(request.clusterId ? clusterResponse() : viewportResponse()),
      layoutVersion: request.layoutVersion ?? toLayoutVersion('layout-1'),
    }));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-1'),
      client: { readViewport },
      renderer,
      lodTierCount: 3,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.selectComponent({ id: 'root', nodeCount: 4, bounds: viewportResponse().globalBounds! });
    await controller.expandCluster(toClusterId('cluster-a'));
    controller.setKeepExpanded(true);
    const fits = vi.mocked(renderer.fitGraphSnapshot!).mock.calls.length;
    const result: GraphRootingResult = {
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('rooted'),
      technicalRoots: ['a1'],
      defaultRoots: ['root'],
      componentIds: { root: 'a1' },
      nodeCount: 4,
      edgeCount: 3,
      clusterCount: 4,
      lodTierCount: 1,
      layoutStatus: 'ready',
      warnings: [],
    };
    const beforeApply = vi.fn();
    await controller.replaceRootedLayout(result, beforeApply);
    expect(beforeApply).toHaveBeenCalledOnce();
    expect(controller.getComponentId()).toBe('a1');
    expect(controller.getExpansionState()).toMatchObject({
      expandedClusterIds: [],
      keepExpanded: false,
      allExpanded: false,
    });
    expect(readViewport.mock.calls.at(-1)?.[0]).toMatchObject({
      componentId: 'a1',
      layoutVersion: 'rooted',
      lodLevel: 0,
    });
    expect(renderer.appliedGraphs.at(-1)?.nodes.some(node => node.id === 'a1')).toBe(false);
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledTimes(fits);
    await controller.selectComponent(null);
    await controller.selectComponent({ id: 'a1', nodeCount: 4, bounds: viewportResponse().globalBounds! });
    expect(readViewport.mock.calls.at(-1)?.[0].layoutVersion).toBe('rooted');
  });
  it('drops old viewport responses and refreshes expanded clusters when adopting ancillary data', async () => {
    const renderer = recordingRenderer();
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
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ layoutVersion: toLayoutVersion('metadata-1') })
    );
    controller.unmount();
  });

  it('does not apply a metadata viewport after disposal', async () => {
    const renderer = recordingRenderer();
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
});
