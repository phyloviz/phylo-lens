import type { AncillaryData, NodeAnnotations } from '../../src/contracts/ancillary';
import type { GraphPrepareResult } from '../../src/contracts/graph/prepare/GraphPrepareResult';
import type { GraphViewportNode } from '../../src/contracts/graph/viewport/GraphViewportNode';
import type { GraphViewportResult } from '../../src/contracts/graph/viewport/GraphViewportResult';
import { toClusterId, toDatasetId, toLayoutVersion, toNodeId } from '../../src/contracts/graph/graphIdentifiers';

export function nodeAnnotations(values: AncillaryData = {}): NodeAnnotations {
    return { ancillaryData: { ...values }, ancillarySummary: { values: {}, categoryCounts: {} }, profileSummary: {} };
}

export function viewportNode(id: string, overrides: Partial<GraphViewportNode> = {}): GraphViewportNode {
    return {
        id: toNodeId(id),
        clusterId: toClusterId(id),
        x: 0,
        y: 0,
        layoutStatus: 'ready',
        memberCount: 1,
        isRepresentative: false,
        annotations: nodeAnnotations(),
        ...overrides,
    };
}

export function viewportResult(overrides: Partial<GraphViewportResult> = {}): GraphViewportResult {
    return {
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        lodLevel: 0,
        zoom: 1,
        layoutStatus: 'ready',
        truncated: false,
        totalNodeCount: 1,
        nodes: [viewportNode('tree')],
        edges: [],
        ...overrides,
    };
}

export function prepareResult(overrides: Partial<GraphPrepareResult> = {}): GraphPrepareResult {
    return {
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        nodeCount: 12_000,
        edgeCount: 11_999,
        clusterCount: 400,
        lodTierCount: 4,
        layoutStatus: 'ready',
        warnings: [],
        ...overrides,
    };
}
