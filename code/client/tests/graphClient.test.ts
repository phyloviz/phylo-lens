import { describe, expect, it, vi } from "vitest";

import {
  createGraphClient,
  ERR_GRAPH_PREPARE_FAILED,
  ERR_INVALID_GRAPH_PREPARE_JOB,
  ERR_INVALID_GRAPH_VIEWPORT_RESPONSE,
  ROUTE_GRAPH_PREPARE,
  ROUTE_GRAPH_SEARCH,
  ROUTE_GRAPH_VIEWPORT,
} from "../src/api/graphClient";
import type { GraphPrepareStatus } from "../src/api/graphContracts";
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

const SEARCH_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  query: "port",
  total_count: 2,
  matches: [
    { node_id: "portugal_1", score: 60, matched_text: "portugal_1", cluster_id: "cluster_portugal" },
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
