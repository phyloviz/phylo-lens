import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import { toDatasetId, toLayoutVersion, toNodeId, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { nodeAnnotations } from '../../fixtures/graph';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';
import { viewportResponse, clusterResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('folds indexed descendants across streamed viewports and ancillary replacement, and restores exact edges', async () => {
    const renderer = recordingRenderer();
    const indices = [
      { componentId: 'z-root', parentId: null, depth: 0, start: 0, end: 4 },
      { componentId: 'z-root', parentId: 'z-root', depth: 1, start: 1, end: 3 },
      { componentId: 'z-root', parentId: 'a-branch', depth: 2, start: 2, end: 3 },
      { componentId: 'z-root', parentId: 'z-root', depth: 1, start: 3, end: 4 },
      { componentId: 'other-root', parentId: null, depth: 0, start: 4, end: 6 },
      { componentId: 'other-root', parentId: 'other-root', depth: 1, start: 5, end: 6 },
    ];
    const nodes = ['z-root', 'a-branch', 'b-leaf', 'sibling', 'other-root', 'other-leaf'].map((id, i) => ({
      annotations: nodeAnnotations(),
      id: toNodeId(id),
      clusterId: toClusterId(`single-${id}`),
      treeIndex: indices[i],
      x: i,
      y: i,
      layoutStatus: 'ready' as const,
      memberCount: 1,
      isRepresentative: false,
    }));
    const edges = [
      ['z-root', 'a-branch'],
      ['a-branch', 'b-leaf'],
      ['z-root', 'sibling'],
      ['other-root', 'other-leaf'],
    ].map(([source, target], i) => ({
      id: toNodeId(`e${i}`),
      source: toNodeId(source),
      target: toNodeId(target),
      distance: i + 1,
    }));
    const response = viewportResponse({ nodes, edges, totalNodeCount: 6 });
    const readViewport = vi.fn(async (request: GraphViewportRequest) => ({
      ...response,
      layoutVersion: request.layoutVersion ?? response.layoutVersion,
    }));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 6,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const original = renderer.appliedGraphs.at(-1)!;
    expect(original.nodes.find(node => node.id === 'a-branch')?.attributes?.canCollapseBranch).toBe(true);
    expect(original.nodes.find(node => node.id === 'b-leaf')?.attributes?.canCollapseBranch).toBe(false);
    renderer.viewportState = { ...renderer.viewportState, pixelSize: { width: 800, height: 600 } };
    controller.collapseBranch(toNodeId('a-branch'));
    const folded = renderer.appliedGraphs.at(-1)!;
    expect(folded.nodes.map(node => node.id)).toEqual(['z-root', 'a-branch', 'sibling', 'other-root', 'other-leaf']);
    expect(folded.nodes.find(node => node.id === 'a-branch')?.attributes).toMatchObject({
      isBranchCollapsed: true,
      isClusterProxy: undefined,
      type: 'triangle',
      color: '#7c3aed',
      collapsedBranchCount: 1,
    });
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readViewport).toHaveBeenCalledTimes(2);
    await controller.replaceLayoutVersion(toLayoutVersion('updated'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).not.toContain('b-leaf');
    controller.expandBranch(toNodeId('a-branch'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toEqual(nodes.map(node => node.id));
    expect(renderer.appliedGraphs.at(-1)?.edges).toEqual(original.edges);
    controller.collapseBranch(toNodeId('a-branch'));
    controller.collapseBranch(toNodeId('z-root'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toEqual(['z-root', 'other-root', 'other-leaf']);
    controller.expandBranch(toNodeId('z-root'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).not.toContain('b-leaf');
    controller.expandBranch(toNodeId('a-branch'));
    expect(renderer.appliedGraphs.at(-1)?.edges).toEqual(original.edges);
    controller.collapseBranch(toNodeId('a-branch'));
    await controller.expandCluster(toClusterId('single-b-leaf'), { focusNodeId: toNodeId('b-leaf') });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('b-leaf');
    await controller.collapseAll();
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toEqual(['z-root', 'other-root']);
    await controller.expandAll();
    expect(renderer.appliedGraphs.at(-1)?.nodes).toHaveLength(6);
    expect(() => controller.collapseBranch(toNodeId('b-leaf'))).toThrow(/internal node/);
    controller.unmount();
  });

  it('keeps folds across automatic coarse and fine viewport slices without forcing global detail', async () => {
    const renderer = recordingRenderer();
    renderer.viewportState = { ...renderer.viewportState, pixelSize: { width: 800, height: 600 } };
    const [template] = viewportResponse().nodes;
    const branch = {
      ...template,
      id: toNodeId('branch'),
      clusterId: toClusterId('fine-branch'),
      treeIndex: { componentId: 'root', parentId: 'root', depth: 1, start: 5, end: 100 },
    };
    const leaf = {
      ...template,
      id: toNodeId('leaf'),
      clusterId: toClusterId('fine-leaf'),
      treeIndex: { componentId: 'root', parentId: 'branch', depth: 2, start: 10, end: 11 },
    };
    const coarse = {
      ...template,
      id: toNodeId('ancestor'),
      clusterId: toClusterId('coarse-ancestor'),
      isRepresentative: true,
      memberCount: 200,
      treeIndex: { componentId: 'root', parentId: 'root', depth: 1, start: 1, end: 201 },
    };
    let nodes = [branch, leaf];
    const readViewport = vi.fn(async (request: GraphViewportRequest) =>
      viewportResponse({ nodes, edges: [], totalNodeCount: nodes.length, zoom: request.zoom ?? 1 })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      nodeCount: 10000,
      lodTierCount: 6,
      debounceMs: 0,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.collapseBranch(branch.id);
    nodes = [coarse];
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(n => n.id)).toEqual(['ancestor']);
    expect(controller.getExpansionState().manuallyCollapsedBranchCount).toBe(1);
    nodes = [branch, leaf];
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(n => n.id)).toEqual(['branch']);
    expect(readViewport).toHaveBeenCalledTimes(3);
    expect(readViewport.mock.calls[1][0]).toMatchObject({ lodLevel: 0, xmin: expect.any(Number) });
    expect(readViewport.mock.calls[1][0].clusterId).toBeUndefined();
    controller.unmount();
  });

  it('folds a specific internal node inside an expanded group whose members share a cluster ID', async () => {
    const renderer = recordingRenderer();
    const [template] = viewportResponse().nodes;
    const indexed = (id: string, start: number, end: number, parentId: string | null) => ({
      ...template,
      id: toNodeId(id),
      clusterId: toClusterId('group'),
      treeIndex: { componentId: 'root', parentId, depth: start, start, end },
    });
    const branch = indexed('branch', 1, 4, 'root');
    const inner = indexed('inner', 2, 4, 'branch');
    const leaf = indexed('leaf', 3, 4, 'inner');
    const base = viewportResponse({ nodes: [{ ...branch, isRepresentative: true, memberCount: 3 }], edges: [] });
    const patch = viewportResponse({ nodes: [branch, inner, leaf], edges: [], totalNodeCount: 3 });
    const readViewport = vi.fn(async (request: GraphViewportRequest) => (request.clusterId ? patch : base));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(toClusterId('group'));
    controller.collapseBranch(inner.id);
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(n => n.id)).toEqual(['branch', 'inner']);
    expect(controller.getExpansionState().expandedClusterIds).toEqual(['group']);
    controller.expandBranch(inner.id);
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(n => n.id)).toEqual(['branch', 'inner', 'leaf']);
    expect(readViewport).toHaveBeenCalledTimes(2);
    controller.unmount();
  });

  it('restores the original LoD representative and its edges when a group is collapsed', async () => {
    const renderer = recordingRenderer();
    const [template] = viewportResponse().nodes;
    const root = {
      ...template,
      id: toNodeId('branch'),
      clusterId: toClusterId('group'),
      treeIndex: { componentId: 'root', parentId: 'root', depth: 1, start: 1, end: 3 },
    };
    const leaf = {
      ...root,
      id: toNodeId('leaf'),
      treeIndex: { ...root.treeIndex, parentId: 'branch', depth: 2, start: 2, end: 3 },
    };
    const outside = { ...template, id: toNodeId('outside'), clusterId: toClusterId('outside') };
    const boundary = { id: toNodeId('boundary'), source: outside.id, target: root.id, distance: 4 };
    const base = viewportResponse({
      nodes: [outside, { ...root, isRepresentative: true, memberCount: 2 }],
      edges: [{ ...boundary, isMeta: true }],
    });
    const patch = viewportResponse({
      nodes: [outside, root, leaf],
      edges: [boundary, { id: toNodeId('inside'), source: root.id, target: leaf.id, distance: 2 }],
      totalNodeCount: 2,
    });
    const readViewport = vi.fn(async (request: GraphViewportRequest) => (request.clusterId ? patch : base));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const original = renderer.appliedGraphs.at(-1)!;
    await controller.expandCluster(toClusterId('group'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toEqual(['outside', 'branch', 'leaf']);
    controller.collapseCluster(toClusterId('group'));
    expect(renderer.appliedGraphs.at(-1)).toEqual(original);
    expect(controller.getExpansionState()).toMatchObject({ expandedClusterIds: [] });
    expect(controller.getExpansionState().manuallyCollapsedBranchCount).toBeUndefined();
    expect(readViewport).toHaveBeenCalledTimes(2);
    controller.unmount();
  });

  it('can expand a representative again after navigation replaces its expanded snapshot', async () => {
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    renderer.viewportState = { ...renderer.viewportState, cameraRatio: 0.1 };
    controller.refreshNow({ lodLevel: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(toClusterId('cluster-a'));
    controller.setKeepExpanded(true);
    await vi.advanceTimersByTimeAsync(0);
    renderer.viewportState = { ...renderer.viewportState, cameraRatio: 2 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(120);
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ lodLevel: 2 }));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).toContain('a1');
    controller.collapseCluster(toClusterId('cluster-a'));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map(node => node.id)).not.toContain('a1');
    controller.setKeepExpanded(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ lodLevel: 0 }));
    controller.unmount();
  });

  it("leaves a group's summary intact when its full expansion exceeds the budget", async () => {
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ lodLevel: 3, maxNodes: 3 })
    );
    expect(readViewport.mock.calls.at(-1)?.[0]).not.toHaveProperty('xmin');
    controller.unmount();
  });

  it('does not restore expansion when a pending response arrives after collapse', async () => {
    const renderer = recordingRenderer();
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
    const renderer = recordingRenderer();
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
    renderer.viewportState = { ...renderer.viewportState, cameraRatio: 4 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(readViewport).toHaveBeenCalledTimes(requests);
    await controller.replaceLayoutVersion(toLayoutVersion('ancillary-2'));
    expect(controller.getExpansionState().allExpanded).toBe(true);
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ lodLevel: 3, layoutVersion: toLayoutVersion('ancillary-2') })
    );
    expect(await controller.collapseAll()).toMatchObject({ allExpanded: false, expandedClusterIds: [] });
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ lodLevel: 0 }));
    controller.unmount();
  });

  it('expands and collapses representative clusters without renderer transport hooks', async () => {
    const renderer = recordingRenderer();
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

    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ clusterId: toClusterId('cluster-a') })
    );
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
    const renderer = recordingRenderer();
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
    expect(vi.mocked(readViewport).mock.calls.map(call => call[0])).toContainEqual(
      expect.objectContaining({ clusterId: toClusterId('cluster-b') })
    );
  });
});
