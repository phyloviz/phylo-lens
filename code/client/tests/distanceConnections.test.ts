import { expect, it, vi } from 'vitest';
import { DistanceConnectionOverlay } from '../src/app/workbench/viewport/distanceConnections';
import { readDistanceConnections } from '../src/services/graph/graphConnectionsService';
import { createHttpClient } from '../src/services/httpClient';
import type { PositionedGraph } from '../src/contracts/positioned';

it('draws only concrete endpoint pairs in the same component without changing tree edges', () => {
  const index = (componentId: string) => ({ componentId, parentId: null, depth: 0, start: 0, end: 1 });
  const graph: PositionedGraph = {
    nodes: [
      { id: 'a', x: 0, y: 0, attributes: { treeIndex: index('root') } },
      { id: 'b', x: 1, y: 0, attributes: { treeIndex: index('root') } },
      { id: 'group', x: 2, y: 0, attributes: { treeIndex: index('root'), isClusterProxy: true } },
      { id: 'fold', x: 3, y: 0, attributes: { treeIndex: index('root'), isBranchCollapsed: true } },
      { id: 'other', x: 4, y: 0, attributes: { treeIndex: index('other') } },
    ],
    edges: [],
    viewMeta: { layout: 'server', lodLevel: 0 },
  };
  const overlay = new DistanceConnectionOverlay({
    metric: 'patristic',
    threshold: 2,
    edges: [
      ...['b', 'group', 'fold', 'other', 'absent'].map(target => ({ id: target, source: 'a', target, distance: 2 })),
    ],
  });
  const result = overlay.apply(graph);
  expect(result.edges.map(edge => edge.id)).toEqual(['b']);
  expect(result.viewMeta.distanceConnections).toMatchObject({ totalCount: 5, visibleCount: 1 });
  expect(graph.edges).toEqual([]);
});

it('validates distance response identity and scientific bounds before applying any result', async () => {
  const request = {
    datasetId: 'tree',
    layoutVersion: 'v1',
    format: 'newick' as const,
    content: '(a:1,b:1)r;',
    threshold: 2,
  };
  const result = {
    dataset_id: 'tree',
    layout_version: 'v1',
    metric: 'patristic',
    threshold: 2,
    edges: [{ id: 'ab', source: 'a', target: 'b', distance: 2 }],
  };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result)));
  const http = createHttpClient({ baseUrl: 'http://test', fetchImpl });
  expect((await readDistanceConnections(http, request)).edges).toHaveLength(1);
  for (const invalid of [
    { ...result, layout_version: 'old' },
    { ...result, metric: 'allelic' },
    { ...result, edges: [{ ...result.edges[0], distance: 3 }] },
    { ...result, edges: [...result.edges, ...result.edges] },
  ]) {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(invalid)));
    await expect(readDistanceConnections(http, request)).rejects.toThrow();
  }
});
