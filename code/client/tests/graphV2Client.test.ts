import {
  createGraphV2Client,
  ERR_INVALID_GRAPH_V2_PREPARE_RESPONSE,
  ERR_INVALID_GRAPH_V2_VIEWPORT_RESPONSE,
  isGraphV2PrepareResponse,
  isGraphV2ViewportResponse,
  ROUTE_GRAPH_V2_PREPARE,
  ROUTE_GRAPH_V2_VIEWPORT,
} from "../src/api/graphV2Client";
import { SOURCE_FORMAT_NEWICK } from "../src/contracts/models";

const BASE_URL = "http://localhost:8000";

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

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("graphV2Client", () => {
  it("validates prepare responses", () => {
    expect(isGraphV2PrepareResponse(PREPARE_FIXTURE)).toBe(true);
    expect(isGraphV2PrepareResponse({ ...PREPARE_FIXTURE, node_count: "3" }))
      .toBe(false);
  });

  it("validates viewport responses", () => {
    expect(isGraphV2ViewportResponse(VIEWPORT_FIXTURE)).toBe(true);
    expect(isGraphV2ViewportResponse({ ...VIEWPORT_FIXTURE, nodes: [{}] })).toBe(
      false,
    );
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

    expect(isGraphV2ViewportResponse(withMetadata)).toBe(true);
  });

  it("treats absent node metadata and metadata schema as valid", () => {
    // metadata omitted entirely, and explicit null, are both permitted.
    expect(isGraphV2ViewportResponse(VIEWPORT_FIXTURE)).toBe(true);
    expect(
      isGraphV2ViewportResponse({
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

    expect(isGraphV2ViewportResponse(withInternalKeys)).toBe(true);
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

    expect(isGraphV2ViewportResponse(nestedObject)).toBe(false);
    expect(isGraphV2ViewportResponse(arrayValue)).toBe(false);
    expect(isGraphV2ViewportResponse(nonFiniteNumber)).toBe(false);
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

    expect(isGraphV2ViewportResponse(missingType)).toBe(false);
    expect(isGraphV2ViewportResponse(notAnArray)).toBe(false);
  });

  it("posts prepare requests to the v2 endpoint", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_GRAPH_V2_PREPARE}`);
      return makeJsonResponse(PREPARE_FIXTURE);
    }) as unknown as typeof fetch;

    const client = createGraphV2Client({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const response = await client.prepareGraph({
      format: SOURCE_FORMAT_NEWICK,
      dataset_name: "tree",
      content: "(A,B)Root;",
    });

    expect(response.layout_version).toBe("abc123");
  });

  it("posts viewport queries to the v2 endpoint", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_GRAPH_V2_VIEWPORT}`);
      return makeJsonResponse(VIEWPORT_FIXTURE);
    }) as unknown as typeof fetch;

    const client = createGraphV2Client({
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
    const client = createGraphV2Client({
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
    ).rejects.toThrow(ERR_INVALID_GRAPH_V2_VIEWPORT_RESPONSE);
  });

  it("rejects invalid prepare responses", async () => {
    const client = createGraphV2Client({
      baseUrl: BASE_URL,
      fetchImpl: vi.fn(async () =>
        makeJsonResponse({ invalid: true }),
      ) as unknown as typeof fetch,
    });

    await expect(
      client.prepareGraph({
        format: SOURCE_FORMAT_NEWICK,
        dataset_name: "tree",
        content: "(A,B)Root;",
      }),
    ).rejects.toThrow(ERR_INVALID_GRAPH_V2_PREPARE_RESPONSE);
  });
});
