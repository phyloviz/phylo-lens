import {
  ERR_NO_GRAPH_RENDERED,
  GraphWorkbench,
} from "../src/app/graphWorkbench";
import { MetadataField } from "../src/contracts/canonical";
import { DatasetClient } from "../src/api/datasetClient";
import { RENDERER_KIND_MOCK } from "../src/render/types";
import { DefaultRendererFactory } from "../src/render/rendererFactory";

const BASE_URL = "http://localhost:8000";
const DATASET_NAME = "workbench-tree";
const NEWICK_CONTENT = "(A,B)Root;";
const METADATA_SCHEMA: MetadataField[] = [
  { key: "region", type: "string" },
  { key: "distance", type: "number" },
];
const METADATA_BY_NODE_ID = {
  root: { region: "EU", distance: 0 },
  a: { region: "EU", distance: 1 },
  b: { region: "AF", distance: 3 },
};

const PREPARE_RESPONSE = {
  dataset_id: DATASET_NAME,
  stats: {
    node_count: 3,
    edge_count: 2,
    ingest_ms: 1,
    normalize_ms: 2,
    hierarchy_ms: 0.5,
    store_ms: 0.1,
  },
  warnings: [],
};
const VIEW_SLICE_RESPONSE = {
  dataset_id: DATASET_NAME,
  lod_level: 1,
  nodes: [
    { id: "root", x: 0, y: 0 },
    { id: "a", x: -0.5, y: 1 },
    { id: "b", x: 0.5, y: 1 },
  ],
  edges: [
    { id: "e_root_a_1", source: "root", target: "a" },
    { id: "e_root_b_1", source: "root", target: "b" },
  ],
  collapsed_clusters: [],
  view_meta: {
    viewport: { x: 0, y: 0, width: 1000, height: 600 },
    zoom: 2,
    returned_node_count: 3,
    returned_edge_count: 2,
  },
};

function makeJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("graphWorkbench", () => {
  it("prepares Newick, fetches a visible slice, and renders through selected adapter", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(VIEW_SLICE_RESPONSE)) as unknown as typeof fetch;

    const datasetClient = new DatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = new GraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    const graph = await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.viewMeta.lodLevel).toBe(1);
    expect(graph.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["root", 0, 0],
      ["a", -60, 150],
      ["b", 60, 150],
    ]);
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => String(call[0]),
      ),
    ).toEqual([
      `${BASE_URL}/dataset/prepare`,
      `${BASE_URL}/dataset/view-slice`,
    ]);

    workbench.dispose();
  });

  it("applies metadata filters on the current visible slice after rendering", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(VIEW_SLICE_RESPONSE)) as unknown as typeof fetch;

    const datasetClient = new DatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = new GraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      metadataSchema: METADATA_SCHEMA,
      metadataByNodeId: METADATA_BY_NODE_ID,
    });

    const filtered = workbench.applyMetadataFilters({
      categorical: [{ fieldKey: "region", acceptedValues: ["EU"] }],
      numeric: [],
    });

    expect(filtered.nodes.map((node) => node.id)).toEqual(["root", "a"]);
    expect(filtered.edges.map((edge) => edge.id)).toEqual(["e_root_a_1"]);

    const restored = workbench.clearMetadataFilters();
    expect(restored.nodes).toHaveLength(3);
    expect(restored.edges).toHaveLength(2);

    workbench.dispose();
  });

  it("fails filter operations before first render", () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(VIEW_SLICE_RESPONSE)) as unknown as typeof fetch;

    const datasetClient = new DatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = new GraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    expect(() =>
      workbench.applyMetadataFilters({
        categorical: [{ fieldKey: "region", acceptedValues: ["EU"] }],
        numeric: [],
      }),
    ).toThrow(ERR_NO_GRAPH_RENDERED);

    expect(() => workbench.clearMetadataFilters()).toThrow(
      ERR_NO_GRAPH_RENDERED,
    );

    workbench.dispose();
  });

  it("forwards ancillary metadata payload to prepare request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(VIEW_SLICE_RESPONSE)) as unknown as typeof fetch;

    const datasetClient = new DatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = new GraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      metadataSchema: [{ key: "trait_a", type: "number" }],
      metadataByNodeId: {
        root: { trait_a: 10 },
      },
    });

    const firstCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const init = firstCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;

    expect(body.metadata_schema).toEqual([{ key: "trait_a", type: "number" }]);
    expect(body.metadata_by_node_id).toEqual({ root: { trait_a: 10 } });

    workbench.dispose();
  });
});
