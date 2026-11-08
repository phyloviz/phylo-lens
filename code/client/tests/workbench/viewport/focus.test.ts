import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import { deferred } from '../../helpers/state';
import { toDatasetId, toNodeId, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { expect, it, vi } from 'vitest';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';
import { viewportResponse, clusterResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('keeps a searched target in a full slice and fetches another member of the same partial cluster', async () => {
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
