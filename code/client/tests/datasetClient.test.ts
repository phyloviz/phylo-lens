import {
  DatasetClient,
  ERR_INVALID_RESPONSE,
  ERR_INVALID_PREPARE_RESPONSE,
  ERR_INVALID_VISIBLE_SLICE_RESPONSE,
  isCanonicalDataset,
  isNormalizeResponse,
  isPrepareDatasetResponse,
  isVisibleSliceResponse,
  ROUTE_NORMALIZE,
  ROUTE_PREPARE,
  ROUTE_VIEW_SLICE,
} from "../src/api/datasetClient";
import { SOURCE_FORMAT_NEWICK } from "../src/contracts/canonical";

const BASE_URL = "http://localhost:8000";
const DATASET_NAME = "fixture-tree";
const NEWICK_CONTENT = "(A,B)Root;";
const NORMALIZE_FIXTURE = {
  dataset: {
    dataset_id: "small-tree",
    nodes: [{ id: "root" }, { id: "a" }, { id: "b" }],
    edges: [
      { id: "e_root_a_1", source: "root", target: "a" },
      { id: "e_root_b_1", source: "root", target: "b" },
    ],
    metadata_schema: [{ key: "region", type: "string" }],
    metadata_by_node_id: {
      a: { region: "EU" },
      b: { region: "US" },
    },
    source: {
      format: "newick",
      generated_at: "2026-03-23T11:00:00+00:00",
    },
  },
  stats: {
    node_count: 3,
    edge_count: 2,
    ingest_ms: 1.2,
    normalize_ms: 1.8,
  },
  warnings: [],
} satisfies unknown;
const PREPARE_FIXTURE = {
  dataset_id: "small-tree",
  stats: {
    node_count: 3,
    edge_count: 2,
    ingest_ms: 1.2,
    normalize_ms: 1.8,
    hierarchy_ms: 0.9,
    store_ms: 0.2,
  },
  warnings: [],
} satisfies unknown;
const VISIBLE_SLICE_FIXTURE = {
  dataset_id: "small-tree",
  lod_level: 1,
  nodes: [
    { id: "root", cluster_id: null, subtree_size: null },
    { id: "a", x: null, y: null },
    { id: "b", is_cluster_proxy: null, leaf_count: null },
  ],
  edges: [
    { id: "e_root_a_1", source: "root", target: "a", distance: null },
    { id: "e_root_b_1", source: "root", target: "b", distance: null },
  ],
  collapsed_clusters: [
    {
      cluster_id: "cluster_root",
      representative_node_id: null,
      subtree_size: 3,
      centroid: null,
    },
  ],
  view_meta: {
    viewport: { x: 0, y: 0, width: 1000, height: 600 },
    zoom: 2,
    returned_node_count: 3,
    returned_edge_count: 2,
  },
} satisfies unknown;

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("datasetClient", () => {
  it("validates a fixture response through runtime guards", () => {
    const fixture = NORMALIZE_FIXTURE;

    expect(isNormalizeResponse(fixture)).toBe(true);

    const dataset = (fixture as { dataset: unknown }).dataset;
    expect(isCanonicalDataset(dataset)).toBe(true);
  });

  it("sends normalize requests to the expected endpoint", async () => {
    const fixture = NORMALIZE_FIXTURE;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_NORMALIZE}`);
      return makeJsonResponse(fixture);
    }) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const result = await client.normalizeDataset({
      format: SOURCE_FORMAT_NEWICK,
      dataset_name: DATASET_NAME,
      content: NEWICK_CONTENT,
    });

    expect(result.dataset.dataset_id).toBe("small-tree");
    expect(result.stats.node_count).toBe(3);
  });

  it("validates prepare and visible-slice responses through runtime guards", () => {
    expect(isPrepareDatasetResponse(PREPARE_FIXTURE)).toBe(true);
    expect(isVisibleSliceResponse(VISIBLE_SLICE_FIXTURE)).toBe(true);
  });

  it("sends prepare requests to the expected endpoint", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_PREPARE}`);
      return makeJsonResponse(PREPARE_FIXTURE);
    }) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const result = await client.prepareDataset({
      format: SOURCE_FORMAT_NEWICK,
      dataset_name: DATASET_NAME,
      content: NEWICK_CONTENT,
    });

    expect(result.dataset_id).toBe("small-tree");
    expect(result.stats.hierarchy_ms).toBe(0.9);
  });

  it("sends visible-slice requests to the expected endpoint", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_VIEW_SLICE}`);
      return makeJsonResponse(VISIBLE_SLICE_FIXTURE);
    }) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const result = await client.viewSlice({
      dataset_id: DATASET_NAME,
      viewport: { x: 0, y: 0, width: 1000, height: 600 },
      zoom: 2,
    });

    expect(result.dataset_id).toBe("small-tree");
    expect(result.lod_level).toBe(1);
  });

  it("rejects invalid response shapes", async () => {
    const invalidPayload = { invalid: true };
    const fetchSpy = vi.fn(async () =>
      makeJsonResponse(invalidPayload),
    ) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    await expect(
      client.normalizeDataset({
        format: SOURCE_FORMAT_NEWICK,
        dataset_name: DATASET_NAME,
        content: NEWICK_CONTENT,
      }),
    ).rejects.toThrow(ERR_INVALID_RESPONSE);
  });

  it("rejects invalid prepare response shapes", async () => {
    const fetchSpy = vi.fn(async () =>
      makeJsonResponse({ invalid: true }),
    ) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    await expect(
      client.prepareDataset({
        format: SOURCE_FORMAT_NEWICK,
        dataset_name: DATASET_NAME,
        content: NEWICK_CONTENT,
      }),
    ).rejects.toThrow(ERR_INVALID_PREPARE_RESPONSE);
  });

  it("rejects invalid visible-slice response shapes", async () => {
    const fetchSpy = vi.fn(async () =>
      makeJsonResponse({ invalid: true }),
    ) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    await expect(
      client.viewSlice({
        dataset_id: DATASET_NAME,
        viewport: { x: 0, y: 0, width: 1000, height: 600 },
        zoom: 2,
      }),
    ).rejects.toThrow(ERR_INVALID_VISIBLE_SLICE_RESPONSE);
  });
});
