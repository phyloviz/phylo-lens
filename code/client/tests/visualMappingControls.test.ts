import { toDatasetId, toLayoutVersion, toNodeId, toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { decodeApiMetadata } from '../src/ancillary/apiMetadata';
import { describe, expect, it } from 'vitest';
import { buildVisualMappingForControls } from '../src/app/shell/controls/visualMappingControls';
import { graphSnapshotFromViewportResponse } from '../src/app/workbench/viewport/viewportSnapshot';
import type { GraphViewportResult } from '../src/contracts/graph/viewport/GraphViewportResult';

const response: GraphViewportResult = {
    datasetId: toDatasetId('fixture'),
    layoutVersion: toLayoutVersion('1'),
    lodLevel: 0,
    zoom: 1,
    layoutStatus: 'ready',
    truncated: false,
    totalNodeCount: 2,
    ancillarySchema: [{ key: 'country', type: 'string' }],
    edges: [],
    nodes: ['Portugal', 'Spain'].map(country => ({
        id: toNodeId(country),
        clusterId: toClusterId(country),
        x: 0,
        y: 0,
        layoutStatus: 'ready',
        memberCount: 1,
        isRepresentative: false,
        annotations: decodeApiMetadata({ country }),
    })),
};

describe('explicit metadata coloring', () => {
    it('does not interpret incidental metadata as selection or founder styling', () => {
        const graph = graphSnapshotFromViewportResponse({
            ...response,
            nodes: response.nodes.map(node => ({
                ...node,
                annotations: decodeApiMetadata({
                    ...node.annotations.ancillaryData,
                    selected: true,
                    role: 'group_founder',
                }),
            })),
        });
        expect(graph.nodes.map(node => node.color)).toEqual(['#64748b', '#64748b']);
    });

    it('returns to neutral after clearing a selection without mutating the base mapping', () => {
        const base = {
            colorField: 'country',
            pie: { enabled: true, fields: ['country'] },
            size: { field: 'profile_count' },
        };
        const selected = graphSnapshotFromViewportResponse(response, { visualMapping: base });
        expect(selected.nodes[0]?.color).not.toBe(selected.nodes[1]?.color);
        const cleared = buildVisualMappingForControls(base, [], undefined, undefined, undefined);
        const neutral = graphSnapshotFromViewportResponse(response, { visualMapping: cleared });
        expect(neutral.nodes.map(node => node.color)).toEqual(['#64748b', '#64748b']);
        expect(
            neutral.nodes.every(node => !Object.keys(node.attributes ?? {}).some(key => key.startsWith('pie__')))
        ).toBe(true);
        expect(base.pie.fields).toEqual(['country']);
        expect(cleared.size?.field).toBe('profile_count');
    });
});
