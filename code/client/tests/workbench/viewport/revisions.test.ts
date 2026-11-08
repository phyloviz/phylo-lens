import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import { toDatasetId, toLayoutVersion, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { decodeApiMetadata } from '../../../src/ancillary/apiMetadata';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';
import { viewportResponse, clusterResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
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
