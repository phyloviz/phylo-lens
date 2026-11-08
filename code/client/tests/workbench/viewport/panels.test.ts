import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import type { GraphClient } from '../../../src/contracts/graph/GraphClient';
import { deferred } from '../../helpers/state';
import { toDatasetId, toLayoutVersion, toNodeId } from '../../../src/contracts/graph/graphIdentifiers';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';
import { viewportResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('restores each panel camera and folds, scopes reads, and reuses revised ancillary data', async () => {
    const renderer = recordingRenderer();
    let camera = { x: 0.5, y: 0.5, ratio: 1 };
    renderer.getCameraState = () => ({ ...camera });
    renderer.restoreCameraState = state => {
      camera = { ...camera, ...state };
    };
    const source = viewportResponse({
      nodes: viewportResponse().nodes.map((node, i) => ({
        ...node,
        isRepresentative: false,
        memberCount: 1,
        treeIndex: { componentId: 'root', parentId: i ? 'root' : null, depth: i, start: i, end: 2 },
      })),
    });
    const readViewport = vi.fn(async (request: GraphViewportRequest) => ({
      ...source,
      layoutVersion: request.layoutVersion ?? source.layoutVersion,
    }));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const component = { id: 'root', nodeCount: 2, bounds: source.globalBounds! };
    await controller.selectComponent(component);
    camera = { x: 0.2, y: 0.3, ratio: 0.4 };
    controller.collapseBranch(toNodeId('root'));
    await controller.selectComponent(null);
    expect(camera).toEqual({ x: 0.5, y: 0.5, ratio: 1 });
    expect(renderer.appliedGraphs.at(-1)?.nodes).toHaveLength(2);
    await controller.replaceLayoutVersion(toLayoutVersion('ancillary-2'));
    await controller.selectComponent(component);
    expect(camera).toEqual({ x: 0.2, y: 0.3, ratio: 0.4 });
    expect(renderer.appliedGraphs.at(-1)?.nodes).toHaveLength(1);
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.componentId).toBe('root');
    await controller.expandAll();
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ componentId: 'root', layoutVersion: 'ancillary-2' })
    );
    controller.unmount();
  });

  it('ignores an older panel response and leaves the displayed view intact after a failed switch', async () => {
    const renderer = recordingRenderer();
    const pending = deferred<GraphViewportResult>();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockReturnValueOnce(pending.promise);
    const a = { id: 'a', nodeCount: 2, bounds: viewportResponse().globalBounds! };
    const old = controller.selectComponent(a);
    const rejection = expect(old).rejects.toThrow(/superseded/);
    await controller.selectComponent({ ...a, id: 'b' });
    pending.resolve(viewportResponse());
    await rejection;
    expect(controller.getComponentId()).toBe('b');
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.componentId).toBe('b');
    readViewport.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.selectComponent(a)).rejects.toThrow('offline');
    expect(controller.getComponentId()).toBe('b');
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.componentId).toBe('b');
    controller.unmount();
  });

  it('releases a pending panel switch when dragging supersedes its response', async () => {
    const renderer = recordingRenderer();
    const pending = deferred<GraphViewportResult>();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockReturnValueOnce(pending.promise);
    const switching = controller.selectComponent({
      id: 'root',
      nodeCount: 2,
      bounds: viewportResponse().globalBounds!,
    });
    const rejection = expect(switching).rejects.toThrow(/superseded/);
    renderer.emitManipulation(true);
    pending.resolve(viewportResponse());
    await rejection;
    renderer.emitManipulation(false);
    expect(controller.getComponentId()).toBeUndefined();
    await expect(controller.collapseAll()).resolves.toMatchObject({ status: 'complete' });
    controller.unmount();
  });

  it('captures the requested component before awaiting its viewport', async () => {
    const renderer = recordingRenderer();
    const pending = deferred<GraphViewportResult>();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockReturnValueOnce(pending.promise);
    const component = { id: 'root', nodeCount: 2, bounds: { ...viewportResponse().globalBounds! } };
    const switching = controller.selectComponent(component);
    component.id = 'changed-by-caller';
    component.bounds.minX = 123;
    pending.resolve(viewportResponse());
    const graph = await switching;
    expect(controller.getComponentId()).toBe('root');
    expect(graph.viewMeta.componentId).toBe('root');
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ componentId: 'root' }));
    controller.unmount();
  });

  it('does not let an older response unlock the panel request that replaced it', async () => {
    const renderer = recordingRenderer();
    const first = deferred<GraphViewportResult>();
    const second = deferred<GraphViewportResult>();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const component = { id: 'a', nodeCount: 2, bounds: viewportResponse().globalBounds! };
    const old = controller.selectComponent(component);
    const rejection = expect(old).rejects.toThrow(/superseded/);
    const latest = controller.selectComponent({ ...component, id: 'b' });
    first.resolve(viewportResponse());
    await rejection;
    await expect(controller.collapseAll()).rejects.toThrow(/Expansion requires/);
    second.resolve(viewportResponse());
    await latest;
    expect(controller.getComponentId()).toBe('b');
    await expect(controller.expandAll()).resolves.toMatchObject({ status: 'complete' });
    controller.unmount();
  });
});
