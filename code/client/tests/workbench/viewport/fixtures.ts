import { toDatasetId, toLayoutVersion, toNodeId, toClusterId } from '../../../src/contracts/graph/graphIdentifiers';
import { nodeAnnotations } from '../../fixtures/graph';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';

export function viewportResponse(overrides: Partial<GraphViewportResult> = {}): GraphViewportResult {
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

export function clusterResponse(): GraphViewportResult {
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
