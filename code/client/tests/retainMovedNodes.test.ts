import { nodeAnnotations } from './fixtures/graph';
import { toDatasetId, toLayoutVersion, toNodeId, toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { describe, expect, it } from 'vitest';
import { retainMovedNodes } from '../src/app/workbench/viewport/retainMovedNodes';
import type { GraphViewportResult } from '../src/contracts/graph/viewport/GraphViewportResult';
const response = (ids: string[]): GraphViewportResult => ({
  datasetId: toDatasetId('d'),
  layoutVersion: toLayoutVersion('v'),
  lodLevel: 1,
  zoom: 2,
  layoutStatus: 'ready',
  truncated: false,
  totalNodeCount: 10,
  nodes: ids.map((id, x) => ({
    annotations: nodeAnnotations(),
    id: toNodeId(id),
    x,
    y: 0,
    clusterId: toClusterId(id),
    isRepresentative: false,
    memberCount: 1,
    layoutStatus: 'ready',
  })),
  edges: [{ id: toNodeId('ab'), source: toNodeId('a'), target: toNodeId('b'), distance: 7 }],
});
describe('budgeted viewport retention', () => {
  it('retains displaced nodes without dropping incoming nodes when unbounded', () => {
    const ids = Array.from({ length: 6001 }, (_, i) => String(i));
    const retained = retainMovedNodes(response(ids), response(['a']), [toNodeId('a')], undefined);
    expect(retained.nodes).toHaveLength(6002);
    expect(retained.truncated).toBe(false);
  });

  it('retains a visible dragged node and its available edges within the budget', () => {
    const previous = response(['a', 'b']),
      next = response(['b', 'c']);
    const retained = retainMovedNodes(next, previous, [toNodeId('a')], 2);
    expect(retained.nodes.map(n => n.id)).toEqual(['a', 'b']);
    expect(retained.edges).toEqual(previous.edges);
    expect(retained.truncated).toBe(true);
    expect(next.nodes.map(n => n.id)).toEqual(['b', 'c']);
  });
  it('does not carry old nodes into another tier or layout version', () => {
    const previous = response(['a', 'b']);
    for (const next of [
      { ...response(['b']), lodLevel: 2 },
      { ...response(['b']), layoutVersion: toLayoutVersion('new') },
    ]) {
      expect(retainMovedNodes(next, previous, [toNodeId('a')], 5)).toBe(next);
    }
  });
  it('prefers fresh ancillary records returned by the server', () => {
    const previous = response(['a']),
      next = response(['a', 'b']);
    Object.assign(next.nodes[0], { annotations: nodeAnnotations({ country: 'PT' }) });
    expect(retainMovedNodes(next, previous, [toNodeId('a')], 3).nodes[0].annotations.ancillaryData).toEqual({
      country: 'PT',
    });
  });
});
