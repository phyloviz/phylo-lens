import { toNodeId, toClusterId, toDatasetId, toLayoutVersion } from '../src/contracts/graph/graphIdentifiers';
import { nodeAnnotations } from './fixtures/graph';
import { decodeApiMetadata } from '../src/ancillary/apiMetadata';
import { deriveColor, DEFAULT_COLOR_PALETTE } from '../src/render/mapping/colorMapping';
import { describe, expect, it } from 'vitest';

import type { GraphViewportNode } from '../src/contracts/graph/viewport/GraphViewportNode';
import type { GraphViewportResult } from '../src/contracts/graph/viewport/GraphViewportResult';
import { graphSnapshotFromViewportResponse } from '../src/app/workbench/viewport/viewportSnapshot';

function viewportNode(id: string, overrides: Partial<GraphViewportNode> = {}): GraphViewportNode {
    return {
        annotations: nodeAnnotations(),
        id: toNodeId(id),
        clusterId: toClusterId(id),
        x: 0,
        y: 0,
        layoutStatus: 'ready',
        memberCount: 1,
        isRepresentative: false,
        ...overrides,
    };
}

function viewportResponse(
    nodes: GraphViewportNode[],
    overrides: Partial<GraphViewportResult> = {}
): GraphViewportResult {
    return {
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        lodLevel: 0,
        zoom: 1,
        layoutStatus: 'ready',
        truncated: false,
        totalNodeCount: nodes.length,
        nodes,
        edges: [],
        ancillarySchema: [],
        ...overrides,
    };
}

describe('viewportSnapshot', () => {
    it('sizes a profile by isolate area independently of the visible slice', () => {
        const single = viewportNode('single', { isolates: [{ id: toNodeId('S'), ancillaryData: {} }] });
        const grouped = viewportNode('grouped', {
            isolates: Array.from({ length: 4 }, (_, index) => ({ id: toNodeId(`S${index}`), ancillaryData: {} })),
            annotations: decodeApiMetadata({ profile_count: 4 }),
        });
        const graph = graphSnapshotFromViewportResponse(viewportResponse([single, grouped]));
        expect(graph.nodes[1]?.size).toBe(2 * (graph.nodes[0]?.size ?? 0));
        expect(graph.nodes[1]?.attributes?.type).toBeUndefined();
        expect(graph.nodes[1]?.attributes?.isolates).toHaveLength(4);
        const isolatedSlice = graphSnapshotFromViewportResponse(viewportResponse([grouped]), { visualMapping: {} });
        expect(isolatedSlice.nodes[0]?.size).toBe(graph.nodes[1]?.size);
        const demoDefault = graphSnapshotFromViewportResponse(viewportResponse([grouped]), {
            visualMapping: { size: { field: 'profile_count', scale: 'linear' } },
        });
        expect(demoDefault.nodes[0]?.size).toBe(graph.nodes[1]?.size);
    });

    it('uses isolate counts for country pies and preserves multi-field correlations', () => {
        const node = viewportNode('profile', {
            annotations: decodeApiMetadata({
                profile_count: 2,
                country: 'Portugal;Spain',
                year: '2020;2021',
                __category_count__country__value__Portugal: 1,
                __category_count__country__value__Spain: 1,
            }),
            isolates: [
                { id: toNodeId('A'), ancillaryData: { country: 'Portugal', year: 2020 } },
                { id: toNodeId('B'), ancillaryData: { country: 'Spain', year: 2021 } },
            ],
        });
        const single = graphSnapshotFromViewportResponse(viewportResponse([node]), {
            visualMapping: { pie: { fields: ['country'] } },
        });
        const attributes = single.nodes[0]?.attributes ?? {};
        const values = Object.entries(attributes).filter(([key]) => key.startsWith('pie__'));
        expect(values.map(([, value]) => value)).toEqual([1, 1]);
        const combined = graphSnapshotFromViewportResponse(viewportResponse([node]), {
            visualMapping: { pie: { fields: ['country', 'year'] } },
        });
        const combinations = Object.entries(combined.nodes[0]?.attributes ?? {}).filter(([key]) =>
            key.startsWith('pie__')
        );
        expect(combinations).toHaveLength(2);
        expect(combinations.map(([, value]) => value)).toEqual([1, 1]);
    });

    it('uses compact node sizes for opened server slices', () => {
        const graph = graphSnapshotFromViewportResponse(
            viewportResponse([
                viewportNode('leaf'),
                viewportNode('cluster-huge', {
                    memberCount: 97_000,
                    isRepresentative: true,
                }),
            ])
        );

        expect(graph.nodes.find(node => node.id === 'leaf')?.size).toBe(3);
        expect(graph.nodes.find(node => node.id === 'cluster-huge')?.size).toBeLessThanOrEqual(6);
    });

    it('keeps labels available even for dense slices', () => {
        const small = graphSnapshotFromViewportResponse(viewportResponse([viewportNode('leaf')]));
        const dense = graphSnapshotFromViewportResponse(
            viewportResponse(Array.from({ length: 251 }, (_, index) => viewportNode(`leaf-${index}`)))
        );

        expect(small.nodes[0]?.attributes?.label).toBe('leaf');
        expect(dense.nodes[0]?.attributes?.label).toBe('leaf-0');
    });

    it('keeps metadata coloring neutral until a field is explicitly selected', () => {
        const graph = graphSnapshotFromViewportResponse(
            viewportResponse(
                [
                    viewportNode('leaf', {
                        annotations: decodeApiMetadata({ country: 'Portugal' }),
                    }),
                ],
                { ancillarySchema: [{ key: 'country', type: 'string' }] }
            ),
            { visualMapping: {} }
        );

        expect(graph.nodes[0]?.color).toBe('#64748b');
    });

    it('applies display toggles to edge attributes in the first viewport snapshot', () => {
        const graph = graphSnapshotFromViewportResponse(
            viewportResponse([viewportNode('root'), viewportNode('leaf')], {
                edges: [{ id: toNodeId('root-leaf'), source: toNodeId('root'), target: toNodeId('leaf'), distance: 4 }],
            }),
            {
                displayOptions: {
                    nodeLabels: false,
                    edgeDistanceLabels: true,
                    distanceWeightedEdges: true,
                },
            }
        );

        expect(graph.nodes[0]?.attributes?.label).toBe('');
        expect(graph.edges[0]?.attributes).toMatchObject({ label: '4', forceLabel: true });
        expect(graph.edges[0]?.attributes?.size).toBeGreaterThan(1);
    });

    it('keeps categorical colors stable when the session has complete metadata', () => {
        const settings = {
            visualMapping: { colorField: 'country' },
            metadataByNodeId: {
                a: { country: 'Portugal' },
                b: { country: 'Spain' },
                c: { country: 'Spain' },
            },
        };
        const firstSlice = graphSnapshotFromViewportResponse(
            viewportResponse([viewportNode('a', { annotations: decodeApiMetadata({ country: 'Portugal' }) })]),
            settings
        );
        const secondSlice = graphSnapshotFromViewportResponse(
            viewportResponse([
                viewportNode('a', { annotations: decodeApiMetadata({ country: 'Portugal' }) }),
                viewportNode('b', { annotations: decodeApiMetadata({ country: 'Spain' }) }),
            ]),
            settings
        );

        expect(firstSlice.nodes[0]?.color).toBe(deriveColor('Portugal', DEFAULT_COLOR_PALETTE));
        expect(secondSlice.nodes.find(node => node.id === 'a')?.color).toBe(firstSlice.nodes[0]?.color);
    });

    it('honors linear and logarithmic size scales for numeric metadata strings', () => {
        const response = viewportResponse(
            [
                viewportNode('small', { annotations: decodeApiMetadata({ distance: '10' }) }),
                viewportNode('middle', { annotations: decodeApiMetadata({ distance: '100' }) }),
                viewportNode('large', { annotations: decodeApiMetadata({ distance: '1000' }) }),
            ],
            { ancillarySchema: [{ key: 'distance', type: 'number' }] }
        );

        const linear = graphSnapshotFromViewportResponse(response, {
            visualMapping: { size: { field: 'distance', scale: 'linear' } },
        });
        const logarithmic = graphSnapshotFromViewportResponse(response, {
            visualMapping: { size: { field: 'distance', scale: 'log' } },
        });

        expect(logarithmic.nodes[1]?.size ?? 0).toBeGreaterThan(linear.nodes[1]?.size ?? 0);
    });
});
