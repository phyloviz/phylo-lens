import { describe, expect, it, vi } from "vitest";

import {
  createGraphClient,
  ERR_GRAPH_PREPARE_FAILED,
  isGraphRegionResponse,
  isGraphSearchResponse,
  ERR_INVALID_GRAPH_PREPARE_JOB,
  ERR_INVALID_GRAPH_VIEWPORT_RESPONSE,
  isGraphPrepareResponse,
  isGraphViewportResponse,
  ROUTE_GRAPH_PREPARE,
  ROUTE_GRAPH_SEARCH,
  ROUTE_GRAPH_VIEWPORT,
  type GraphPrepareStatus,
} from "../src/api/graphClient";
import { SOURCE_FORMAT_NEWICK } from "../src/contracts/models";

const BASE_URL = "http://localhost:8000";

const PREPARE_JOB_FIXTURE = {
  job_id: "job-1",
  status: "pending",
  dataset_id: "tree",
} satisfies unknown;

// No polling delay in tests: the client sleeps between polls, so inject a
// no-op sleep to keep the suite fast.
const NO_SLEEP = { sleep: async () => {} };

const VIEWPORT_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  lod_level: 0,
  zoom: 0.5,
  layout_status: "ready",
  truncated: false,
  total_node_count: 1,
  nodes: [
    {
      id: "cluster_1",
      cluster_id: "cluster_1",
      x: 10,
      y: 12,
      layout_status: "ready",
      member_count: 4,
      is_representative: true,
    },
  ],
  edges: [],
} satisfies unknown;
const PREPARE_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  node_count: 3,
  edge_count: 2,
  cluster_count: 2,
  layout_status: "ready",
  warnings: [],
} satisfies unknown;

const REGION_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  layout_status: "ready",
  truncated: false,
  total_node_count: 2,
  nodes: [
    {
      id: "a",
      cluster_id: "a",
      x: 1,
      y: 2,
      layout_status: "ready",
      member_count: 1,
      is_representative: false,
    },
  ],
  edges: [],
  aggregated_metadata: { region: "north", score: 16 },
} satisfies unknown;

const SEARCH_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  query: "port",
  total_count: 2,
  matches: [
    { node_id: "portugal_1", score: 60, matched_text: "portugal_1" },
    { node_id: "isolate_x", score: 20, matched_text: "isolate_x Portugal" },
  ],
} satisfies unknown;

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("graphClient", () => {
  it("validates prepare responses", () => {
    expect(isGraphPrepareResponse(PREPARE_FIXTURE)).toBe(true);
    expect(isGraphPrepareResponse({ ...PREPARE_FIXTURE, node_count: "3" }))
      .toBe(false);
  });

  it("validates viewport responses", () => {
    expect(isGraphViewportResponse(VIEWPORT_FIXTURE)).toBe(true);
    expect(isGraphViewportResponse({ ...VIEWPORT_FIXTURE, nodes: [{}] })).toBe(
      false,
    );
  });

  it("validates region responses", () => {
    expect(isGraphRegionResponse(REGION_FIXTURE)).toBe(true);
    // metadata_schema is optional; aggregated_metadata is required.
    const withoutAggregate = { ...REGION_FIXTURE } as Record<string, unknown>;
    delete withoutAggregate.aggregated_metadata;
    expect(isGraphRegionResponse(withoutAggregate)).toBe(false);
    // Non-scalar aggregate values are rejected.
    expect(
      isGraphRegionResponse({
        ...REGION_FIXTURE,
        aggregated_metadata: { region: { nested: true } },
      }),
    ).toBe(false);
    // Malformed nodes are rejected.
    expect(isGraphRegionResponse({ ...REGION_FIXTURE, nodes: [{}] })).toBe(
      false,
    );
  });

  it("accepts meta-edge fields on edges and rejects wrong types", () => {
    const withMetaEdge = {
      ...VIEWPORT_FIXTURE,
      edges: [
        {
          id: "meta_edge:a:cluster_1",
          source: "a",
          target: "cluster_1",
          distance: 2,
          is_meta: true,
          bundled_edge_count: 3,
        },
      ],
    };
    expect(isGraphViewportResponse(withMetaEdge)).toBe(true);

    // Ordinary edges omit the meta fields entirely.
    const plainEdge = {
      ...VIEWPORT_FIXTURE,
      edges: [{ id: "e1", source: "a", target: "cluster_1", distance: 1 }],
    };
    expect(isGraphViewportResponse(plainEdge)).toBe(true);

    // Wrong types are rejected.
    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        edges: [
          {
            id: "e1",
            source: "a",
            target: "cluster_1",
            is_meta: "yes",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        edges: [
          {
            id: "e1",
            source: "a",
            target: "cluster_1",
            bundled_edge_count: "3",
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepts node metadata and a metadata schema", () => {
    const withMetadata = {
      ...VIEWPORT_FIXTURE,
      metadata_schema: [
        { key: "region", type: "string" },
        { key: "distance", type: "number" },
      ],
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: {
            region: "eu",
            distance: 3,
            resistant: true,
            missing: null,
          },
        },
      ],
    };

    expect(isGraphViewportResponse(withMetadata)).toBe(true);
  });

  it("treats absent node metadata and metadata schema as valid", () => {
    // metadata omitted entirely, and explicit null, are both permitted.
    expect(isGraphViewportResponse(VIEWPORT_FIXTURE)).toBe(true);
    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        nodes: [{ ...VIEWPORT_FIXTURE.nodes[0], metadata: null }],
      }),
    ).toBe(true);
  });

  it("permits internal-key metadata to pass the guard untouched", () => {
    // Internal aggregation keys are not stripped by the client guard; they are
    // scalar values and downstream code filters them from public views.
    const withInternalKeys = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: {
            profile_count: 5,
            "__category_count__region__value__eu": 3,
            region: "eu",
          },
        },
      ],
    };

    expect(isGraphViewportResponse(withInternalKeys)).toBe(true);
  });

  it("rejects non-scalar node metadata values", () => {
    const nestedObject = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: { region: { nested: "eu" } },
        },
      ],
    };
    const arrayValue = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: { regions: ["eu", "us"] },
        },
      ],
    };
    const nonFiniteNumber = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: { distance: Number.NaN },
        },
      ],
    };

    expect(isGraphViewportResponse(nestedObject)).toBe(false);
    expect(isGraphViewportResponse(arrayValue)).toBe(false);
    expect(isGraphViewportResponse(nonFiniteNumber)).toBe(false);
  });

  it("rejects malformed metadata schema entries", () => {
    const missingType = {
      ...VIEWPORT_FIXTURE,
      metadata_schema: [{ key: "region" }],
    };
    const notAnArray = {
      ...VIEWPORT_FIXTURE,
      metadata_schema: { region: "string" },
    };

    expect(isGraphViewportResponse(missingType)).toBe(false);
    expect(isGraphViewportResponse(notAnArray)).toBe(false);
  });

  it("validates search responses", () => {
    expect(isGraphSearchResponse(SEARCH_FIXTURE)).toBe(true);
    // total_count must be numeric.
    expect(isGraphSearchResponse({ ...SEARCH_FIXTURE, total_count: "2" })).toBe(
      false,
    );
    // Malformed matches are rejected.
    expect(
      isGraphSearchResponse({ ...SEARCH_FIXTURE, matches: [{ node_id: "x" }] }),
    ).toBe(false);
  });

  it("posts a whole-tree search and returns scored matches", async () => {
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return makeJsonResponse(SEARCH_FIXTURE);
    }) as unknown as typeof fetch;

    const client = createGraphClient({ baseUrl: BASE_URL, fetchImpl: fetchSpy });
    const response = await client.searchGraph({
      dataset_id: "tree",
      query: "port",
      limit: 25,
    });

    expect(seen[0]).toBe(`${BASE_URL}${ROUTE_GRAPH_SEARCH}`);
    expect(response.total_count).toBe(2);
    expect(response.matches[0]!.node_id).toBe("portugal_1");
  });

  it("submits a prepare job then polls until it is ready", async () => {
    const statusUrl = `${BASE_URL}${ROUTE_GRAPH_PREPARE}/job-1`;
    const pending: GraphPrepareStatus = {
      job_id: "job-1",
      status: "pending",
    };
    const ready: GraphPrepareStatus = {
      job_id: "job-1",
      status: "ready",
      result: PREPARE_FIXTURE as never,
    };
    // POST submit -> pending poll -> ready poll.
    const responses = [
      makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
      makeJsonResponse(pending),
      makeJsonResponse(ready),
    ];
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return responses.shift() ?? makeJsonResponse(ready);
    }) as unknown as typeof fetch;

    const client = createGraphClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const onPending = vi.fn();
    const response = await client.prepareGraph(
      {
        format: SOURCE_FORMAT_NEWICK,
        dataset_name: "tree",
        content: "(A,B)Root;",
      },
      { ...NO_SLEEP, onPending },
    );

    expect(response.layout_version).toBe("abc123");
    expect(seen[0]).toBe(`${BASE_URL}${ROUTE_GRAPH_PREPARE}`);
    expect(seen[1]).toBe(statusUrl);
    expect(seen[2]).toBe(statusUrl);
    expect(onPending).toHaveBeenCalledTimes(1);
  });

  it("rejects when a prepare job resolves to failed", async () => {
    const responses = [
      makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
      makeJsonResponse({
        job_id: "job-1",
        status: "failed",
        error: "sfdp exploded",
      }),
    ];
    const client = createGraphClient({
      baseUrl: BASE_URL,
      fetchImpl: vi.fn(
        async () => responses.shift() ?? makeJsonResponse({}),
      ) as unknown as typeof fetch,
    });

    await expect(
      client.prepareGraph(
        {
          format: SOURCE_FORMAT_NEWICK,
          dataset_name: "tree",
          content: "(A,B)Root;",
        },
        NO_SLEEP,
      ),
    ).rejects.toThrow("sfdp exploded");
  });

  it("uses a default failure message when a failed job omits an error", async () => {
    const responses = [
      makeJsonResponse(PREPARE_JOB_FIXTURE, 202),
      makeJsonResponse({ job_id: "job-1", status: "failed" }),
    ];
    const client = createGraphClient({
      baseUrl: BASE_URL,
      fetchImpl: vi.fn(
        async () => responses.shift() ?? makeJsonResponse({}),
      ) as unknown as typeof fetch,
    });

    await expect(
      client.prepareGraph(
        {
          format: SOURCE_FORMAT_NEWICK,
          dataset_name: "tree",
          content: "(A,B)Root;",
        },
        NO_SLEEP,
      ),
    ).rejects.toThrow(ERR_GRAPH_PREPARE_FAILED);
  });

  it("posts viewport queries to the viewport endpoint", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_GRAPH_VIEWPORT}`);
      return makeJsonResponse(VIEWPORT_FIXTURE);
    }) as unknown as typeof fetch;

    const client = createGraphClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const response = await client.readViewport({
      dataset_id: "tree",
      xmin: 0,
      xmax: 100,
      ymin: 0,
      ymax: 100,
      lod_level: 0,
    });

    expect(response.nodes[0]?.member_count).toBe(4);
  });

  it("rejects invalid viewport responses", async () => {
    const client = createGraphClient({
      baseUrl: BASE_URL,
      fetchImpl: vi.fn(async () =>
        makeJsonResponse({ invalid: true }),
      ) as unknown as typeof fetch,
    });

    await expect(
      client.readViewport({
        dataset_id: "tree",
        xmin: 0,
        xmax: 100,
        ymin: 0,
        ymax: 100,
      }),
    ).rejects.toThrow(ERR_INVALID_GRAPH_VIEWPORT_RESPONSE);
  });

  it("rejects an invalid prepare-job submit response", async () => {
    const client = createGraphClient({
      baseUrl: BASE_URL,
      fetchImpl: vi.fn(async () =>
        makeJsonResponse({ invalid: true }),
      ) as unknown as typeof fetch,
    });

    await expect(
      client.prepareGraph(
        {
          format: SOURCE_FORMAT_NEWICK,
          dataset_name: "tree",
          content: "(A,B)Root;",
        },
        NO_SLEEP,
      ),
    ).rejects.toThrow(ERR_INVALID_GRAPH_PREPARE_JOB);
  });
});
