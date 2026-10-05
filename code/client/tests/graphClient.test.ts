import type { GraphPrepareResponseDto } from '../src/services/graph/models/prepare/GraphPrepareResponseDto';
import type { GraphViewportResponseDto } from '../src/services/graph/models/viewport/GraphViewportResponseDto';
import { deferred } from './helpers/state';
import { toDatasetId, toLayoutVersion } from '../src/contracts/graph/graphIdentifiers';
import { describe, expect, it, vi } from 'vitest';

import { createGraphClient } from '../src/services/graph/graphService';
import { GRAPH_API_ERRORS } from '../src/services/graph/graphErrors';
import { GRAPH_ROUTES } from '../src/services/graph/graphRoutes';
import { SUPPORTED_PHYLO_LENS_API_VERSION } from '../src/services/graph/serviceInformationService';
import type { GraphPrepareStatusDto } from '../src/services/graph/models/prepare/GraphPrepareStatusDto';
import { toGraphAncillaryRequestDto } from '../src/services/graph/mappers/graphAncillaryMappers';
import { IncompatiblePhyloLensServiceError, PhyloLensServiceProtocolError } from '../src/services/serviceErrors';
import { SOURCE_FORMAT_NEWICK } from '../src/contracts/models';

const BASE_URL = 'http://localhost:8000';

const PREPARE_JOB_FIXTURE = {
    job_id: 'job-1',
    status: 'pending',
    dataset_id: 'tree',
};
const SERVICE_INFO_FIXTURE = {
    status: 'ok',
    service_version: '0.2.0',
    api_version: SUPPORTED_PHYLO_LENS_API_VERSION,
};

// No polling delay in tests: the client sleeps between polls, so inject a
// no-op sleep to keep the suite fast.
const NO_SLEEP = { sleep: async () => {} };

const VIEWPORT_FIXTURE = {
    dataset_id: 'tree',
    layout_version: 'abc123',
    lod_level: 0,
    zoom: 0.5,
    layout_status: 'ready',
    truncated: false,
    total_node_count: 1,
    nodes: [
        {
            id: 'cluster_1',
            cluster_id: 'cluster_1',
            x: 10,
            y: 12,
            layout_status: 'ready',
            member_count: 4,
            is_representative: true,
        },
    ],
    edges: [],
} satisfies GraphViewportResponseDto;
const PREPARE_FIXTURE = {
    dataset_id: 'tree',
    layout_version: 'abc123',
    node_count: 3,
    edge_count: 2,
    cluster_count: 2,
    layout_status: 'ready',
    warnings: [],
} satisfies GraphPrepareResponseDto;

const SEARCH_FIXTURE = {
    dataset_id: 'tree',
    layout_version: 'abc123',
    query: 'port',
    total_count: 2,
    matches: [
        { node_id: 'portugal_1', score: 60, matched_text: 'portugal_1', cluster_id: 'cluster_portugal' },
        { node_id: 'isolate_x', score: 20, matched_text: 'isolate_x Portugal' },
    ],
};

function makeJsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('graphClient', () => {
    it('normalizes trailing slashes before constructing service and graph URLs', async () => {
        const responses = [
            makeJsonResponse(SERVICE_INFO_FIXTURE),
            makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
            makeJsonResponse({ job_id: 'job-1', status: 'ready', result: PREPARE_FIXTURE }),
        ];
        const seen: string[] = [];
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return responses.shift() ?? makeJsonResponse({});
        });
        const client = createGraphClient({ baseUrl: `${BASE_URL}/`, fetchImpl: fetchSpy });

        await client.prepareGraph(
            {
                format: SOURCE_FORMAT_NEWICK,
                datasetName: 'tree',
                content: '(A,B)Root;',
            },
            NO_SLEEP
        );

        expect(seen[0]).toBe(`${BASE_URL}${GRAPH_ROUTES.health}`);
        expect(seen[1]).toBe(`${BASE_URL}${GRAPH_ROUTES.prepare}`);
    });

    it('joins relative apiUrl prefixes predictably', async () => {
        const seen: string[] = [];
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return makeJsonResponse(SEARCH_FIXTURE);
        });
        const client = createGraphClient({ baseUrl: '/phylo-lens/api/', fetchImpl: fetchSpy });

        await client.searchGraph({
            datasetId: toDatasetId('tree'),
            query: 'port',
            limit: 25,
        });

        expect(seen[0]).toBe(`/phylo-lens/api${GRAPH_ROUTES.search}`);
    });

    it('posts a whole-tree search and returns scored matches', async () => {
        const seen: string[] = [];
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return makeJsonResponse(SEARCH_FIXTURE);
        });

        const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl: fetchSpy });
        const response = await client.searchGraph({
            datasetId: toDatasetId('tree'),
            query: 'port',
            limit: 25,
        });

        expect(seen[0]).toBe(`${BASE_URL}${GRAPH_ROUTES.search}`);
        expect(response.totalCount).toBe(2);
        expect(response.matches[0]!.nodeId).toBe('portugal_1');
    });

    it('submits a prepare job then polls until it is ready', async () => {
        const statusUrl = `${BASE_URL}${GRAPH_ROUTES.prepare}/job-1`;
        const pending: GraphPrepareStatusDto = {
            job_id: 'job-1',
            status: 'pending',
        };
        const ready: GraphPrepareStatusDto = {
            job_id: 'job-1',
            status: 'ready',
            result: PREPARE_FIXTURE,
        };
        // health check -> POST submit -> pending poll -> ready poll.
        const responses = [
            makeJsonResponse(SERVICE_INFO_FIXTURE),
            makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
            makeJsonResponse(pending),
            makeJsonResponse(ready),
        ];
        const seen: string[] = [];
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return responses.shift() ?? makeJsonResponse(ready);
        });

        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: fetchSpy,
        });

        const onPending = vi.fn();
        const response = await client.prepareGraph(
            {
                format: SOURCE_FORMAT_NEWICK,
                datasetName: 'tree',
                content: '(A,B)Root;',
            },
            { ...NO_SLEEP, onPending }
        );

        expect(response.layoutVersion).toBe('abc123');
        expect(seen[0]).toBe(`${BASE_URL}${GRAPH_ROUTES.health}`);
        expect(seen[1]).toBe(`${BASE_URL}${GRAPH_ROUTES.prepare}`);
        expect(seen[2]).toBe(statusUrl);
        expect(seen[3]).toBe(statusUrl);
        expect(onPending).toHaveBeenCalledTimes(1);
    });

    it('rejects ancillary prepare requests that omit join_column before posting', async () => {
        const fetchSpy = vi.fn(async () => makeJsonResponse(SERVICE_INFO_FIXTURE));
        const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl: fetchSpy });

        await expect(
            client.prepareGraph(
                {
                    format: SOURCE_FORMAT_NEWICK,
                    datasetName: 'tree',
                    content: '(A,B)Root;',
                    ancillaryData: {
                        content: 'isolate\tcountry\nA\tPT\n',
                        format: 'tsv',
                    },
                } as never,
                NO_SLEEP
            )
        ).rejects.toThrow(GRAPH_API_ERRORS.invalidPrepareRequest);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('checks service compatibility before each preparation', async () => {
        const ready: GraphPrepareStatusDto = {
            job_id: 'job-1',
            status: 'ready',
            result: PREPARE_FIXTURE,
        };
        const responses = [
            makeJsonResponse(SERVICE_INFO_FIXTURE),
            makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
            makeJsonResponse(ready),
            makeJsonResponse(SERVICE_INFO_FIXTURE),
            makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
            makeJsonResponse(ready),
        ];
        const seen: string[] = [];
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return responses.shift() ?? makeJsonResponse(ready);
        });
        const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl: fetchSpy });

        await client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'first', content: '(A)R;' }, NO_SLEEP);
        await client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'second', content: '(B)R;' }, NO_SLEEP);

        expect(seen.filter(url => url === `${BASE_URL}${GRAPH_ROUTES.health}`)).toHaveLength(2);
        expect(seen.filter(url => url === `${BASE_URL}${GRAPH_ROUTES.prepare}`)).toHaveLength(2);
    });

    it('rejects incompatible service API versions before graph preparation', async () => {
        const seen: string[] = [];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
                seen.push(String(input));
                return makeJsonResponse({ ...SERVICE_INFO_FIXTURE, api_version: '2' });
            }),
        });

        await expect(
            client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'tree', content: '(A)R;' }, NO_SLEEP)
        ).rejects.toMatchObject({
            expectedApiVersion: SUPPORTED_PHYLO_LENS_API_VERSION,
            receivedApiVersion: '2',
        });
        await expect(
            client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'tree', content: '(A)R;' }, NO_SLEEP)
        ).rejects.toBeInstanceOf(IncompatiblePhyloLensServiceError);
        expect(seen).toEqual([`${BASE_URL}${GRAPH_ROUTES.health}`, `${BASE_URL}${GRAPH_ROUTES.health}`]);
    });

    it('rejects malformed service information before graph preparation', async () => {
        const seen: string[] = [];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
                seen.push(String(input));
                return makeJsonResponse({ status: 'ok' });
            }),
        });

        await expect(
            client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'tree', content: '(A)R;' }, NO_SLEEP)
        ).rejects.toBeInstanceOf(PhyloLensServiceProtocolError);
        expect(seen).toEqual([`${BASE_URL}${GRAPH_ROUTES.health}`]);
    });

    it('rejects malformed service JSON as a protocol error', async () => {
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(
                async () =>
                    new Response('{', {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    })
            ),
        });

        await expect(
            client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'tree', content: '(A)R;' }, NO_SLEEP)
        ).rejects.toBeInstanceOf(PhyloLensServiceProtocolError);
    });

    it('rejects unavailable services before graph preparation', async () => {
        const seen: string[] = [];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
                seen.push(String(input));
                throw new TypeError('network down');
            }),
        });

        await expect(
            client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'tree', content: '(A)R;' }, NO_SLEEP)
        ).rejects.toThrow('PhyloLens service is unavailable. network down');
        expect(seen).toEqual([`${BASE_URL}${GRAPH_ROUTES.health}`]);
    });

    it('checks compatibility before submitting graph preparation', async () => {
        const fetchSpy = vi.fn(async () => makeJsonResponse({ status: 'ok' }));
        const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl: fetchSpy });

        await expect(
            client.prepareGraph({ format: SOURCE_FORMAT_NEWICK, datasetName: 'tree', content: '(A)R;' }, NO_SLEEP)
        ).rejects.toBeInstanceOf(PhyloLensServiceProtocolError);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects when a prepare job resolves to failed', async () => {
        const responses = [
            makeJsonResponse(SERVICE_INFO_FIXTURE),
            makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
            makeJsonResponse({
                job_id: 'job-1',
                status: 'failed',
                error: 'sfdp exploded',
            }),
        ];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async () => responses.shift() ?? makeJsonResponse({})),
        });

        await expect(
            client.prepareGraph(
                {
                    format: SOURCE_FORMAT_NEWICK,
                    datasetName: 'tree',
                    content: '(A,B)Root;',
                },
                NO_SLEEP
            )
        ).rejects.toThrow('sfdp exploded');
    });

    it('uses a default failure message when a failed job omits an error', async () => {
        const responses = [
            makeJsonResponse(SERVICE_INFO_FIXTURE),
            makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
            makeJsonResponse({ job_id: 'job-1', status: 'failed' }),
        ];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async () => responses.shift() ?? makeJsonResponse({})),
        });

        await expect(
            client.prepareGraph(
                {
                    format: SOURCE_FORMAT_NEWICK,
                    datasetName: 'tree',
                    content: '(A,B)Root;',
                },
                NO_SLEEP
            )
        ).rejects.toThrow(GRAPH_API_ERRORS.prepareFailed);
    });

    it('posts viewport queries to the viewport endpoint', async () => {
        const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
            expect(String(input)).toBe(`${BASE_URL}${GRAPH_ROUTES.viewport}`);
            return makeJsonResponse(VIEWPORT_FIXTURE);
        });

        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: fetchSpy,
        });

        const response = await client.readViewport({
            datasetId: toDatasetId('tree'),
            xmin: 0,
            xmax: 100,
            ymin: 0,
            ymax: 100,
            lodLevel: 0,
        });

        expect(response.nodes[0]?.memberCount).toBe(4);
    });

    it('rejects invalid viewport responses', async () => {
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async () => makeJsonResponse({ invalid: true })),
        });

        await expect(
            client.readViewport({
                datasetId: toDatasetId('tree'),
                xmin: 0,
                xmax: 100,
                ymin: 0,
                ymax: 100,
            })
        ).rejects.toThrow(GRAPH_API_ERRORS.invalidViewportResponse);
    });

    it('rejects an invalid prepare-job submit response', async () => {
        const responses = [makeJsonResponse(SERVICE_INFO_FIXTURE), makeJsonResponse({ invalid: true })];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async () => responses.shift() ?? makeJsonResponse({})),
        });

        await expect(
            client.prepareGraph(
                {
                    format: SOURCE_FORMAT_NEWICK,
                    datasetName: 'tree',
                    content: '(A,B)Root;',
                },
                NO_SLEEP
            )
        ).rejects.toThrow(GRAPH_API_ERRORS.invalidPrepareJob);
    });
});

it('sends an ancillary PUT without submitting a prepare job', async () => {
    const response = { dataset_id: 'tree', layout_version: 'metadata-1', matched_node_count: 2, warnings: [] };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl });
    const request = {
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('original'),
        ancillaryData: { content: 'id,country\nA,PT', joinColumn: 'id' },
    };
    await expect(client.applyAncillaryData(request)).resolves.toEqual({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('metadata-1'),
        matchedNodeCount: 2,
        warnings: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
        `${BASE_URL}/api/graph/ancillary`,
        expect.objectContaining({ method: 'PUT', body: JSON.stringify(toGraphAncillaryRequestDto(request)) })
    );
});

it.each([
    { dataset_id: 'other', layout_version: 'v2', matched_node_count: 1, warnings: [] },
    { dataset_id: 'tree', layout_version: '', matched_node_count: 1, warnings: [] },
    { dataset_id: 'tree', layout_version: 'v2', matched_node_count: 1.5, warnings: [] },
    { dataset_id: 'tree', layout_version: 'v2', matched_node_count: 1, warnings: [42] },
])('rejects malformed ancillary responses', async response => {
    const client = createGraphClient({
        baseUrl: BASE_URL,
        fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(response))),
    });
    await expect(
        client.applyAncillaryData({
            datasetId: toDatasetId('tree'),
            layoutVersion: toLayoutVersion('original'),
            ancillaryData: { content: 'id,country\nA,PT', joinColumn: 'id' },
        })
    ).rejects.toThrow('Invalid graph ancillary response');
});

it('captures ancillary request identity and content before awaiting HTTP', async () => {
    const reply = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(reply.promise);
    const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl });
    const request = {
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('original'),
        ancillaryData: { content: 'id,country\nA,PT', joinColumn: 'id' },
    };
    const operation = client.applyAncillaryData(request);
    const completed = expect(operation).resolves.toMatchObject({ datasetId: 'tree', matchedNodeCount: 1 });
    request.datasetId = toDatasetId('other');
    request.ancillaryData.content = 'changed';
    reply.resolve(
        makeJsonResponse({ dataset_id: 'tree', layout_version: 'updated', matched_node_count: 1, warnings: [] })
    );
    await completed;
    expect(fetchImpl.mock.calls[0][1]?.body).toBe(
        JSON.stringify({
            dataset_id: 'tree',
            layout_version: 'original',
            ancillary_data: { content: 'id,country\nA,PT', join_column: 'id' },
        })
    );
});

it('captures prepare data and polling callbacks before waiting for service health', async () => {
    const health = deferred<Response>();
    let polls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
        if (String(url).endsWith(GRAPH_ROUTES.health)) return health.promise;
        if (init?.method === 'POST') return makeJsonResponse(PREPARE_JOB_FIXTURE, 202);
        return makeJsonResponse(
            ++polls === 1
                ? { job_id: 'job-1', status: 'pending' }
                : { job_id: 'job-1', status: 'ready', result: PREPARE_FIXTURE }
        );
    });
    const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl });
    const request = {
        format: 'newick' as const,
        content: 'A;',
        ancillarySchema: [{ key: 'country', type: 'string' as const }],
        ancillaryByNodeId: { A: { country: 'PT' } },
        sfdpOptions: { k: 0.5 },
    };
    const onPending = vi.fn();
    const sleep = vi.fn(async () => {});
    const options = { onPending, sleep, pollIntervalMs: 1 };
    const preparing = client.prepareGraph(request, options);
    request.ancillarySchema[0].key = 'changed';
    request.ancillaryByNodeId.A.country = 'changed';
    request.sfdpOptions.k = 2;
    options.onPending = vi.fn(() => {
        throw new Error('Changed callback');
    });
    options.pollIntervalMs = 1000;
    health.resolve(makeJsonResponse(SERVICE_INFO_FIXTURE));
    await preparing;
    const post = fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
        metadata_schema: [{ key: 'country', type: 'string' }],
        metadata_by_node_id: { A: { country: 'PT' } },
        sfdp_options: { k: 0.5 },
    });
    expect(onPending).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1);
});

it('keeps waiting for a long preparation when no timeout is requested', async () => {
    vi.useFakeTimers();
    try {
        const responses = [
            SERVICE_INFO_FIXTURE,
            PREPARE_JOB_FIXTURE,
            { job_id: 'job-1', status: 'pending' },
            { job_id: 'job-1', status: 'ready', result: PREPARE_FIXTURE },
        ];
        const client = createGraphClient({
            baseUrl: BASE_URL,
            fetchImpl: vi.fn(async () => makeJsonResponse(responses.shift())),
        });
        await expect(
            client.prepareGraph(
                { format: 'newick', content: 'A;' },
                {
                    sleep: async () => {
                        vi.advanceTimersByTime(60 * 60 * 1000);
                    },
                }
            )
        ).resolves.toMatchObject({ layoutVersion: 'abc123' });
    } finally {
        vi.useRealTimers();
    }
});
