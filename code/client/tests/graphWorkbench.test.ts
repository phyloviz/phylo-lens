import {
  ERR_NO_GRAPH_RENDERED,
  GraphWorkbench,
} from "../src/app/graphWorkbench";
import { DatasetClient } from "../src/api/datasetClient";
import { RENDERER_KIND_MOCK } from "../src/render/types";
import { DefaultRendererFactory } from "../src/render/rendererFactory";

const BASE_URL = "http://localhost:8000";
const DATASET_NAME = "workbench-tree";
const NEWICK_CONTENT = "(A,B)Root;";

const NORMALIZE_RESPONSE = {
  dataset: {
    dataset_id: DATASET_NAME,
    nodes: [{ id: "root" }, { id: "a" }, { id: "b" }],
    edges: [
      { id: "e_root_a_1", source: "root", target: "a" },
      { id: "e_root_b_1", source: "root", target: "b" },
    ],
    metadata_schema: [
      { key: "region", type: "string" },
      { key: "distance", type: "number" },
    ],
    metadata_by_node_id: {
      root: { region: "EU", distance: 0 },
      a: { region: "EU", distance: 1 },
      b: { region: "AF", distance: 3 },
    },
    source: {
      format: "newick",
      generated_at: "2026-03-23T12:10:00+00:00",
    },
  },
  stats: {
    node_count: 3,
    edge_count: 2,
    ingest_ms: 1,
    normalize_ms: 2,
  },
  warnings: [],
};

function makeJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("graphWorkbench", () => {
  it("normalizes Newick then renders through selected adapter", async () => {
    const fetchImpl = vi.fn(async () =>
      makeJsonResponse(NORMALIZE_RESPONSE),
    ) as unknown as typeof fetch;

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

    workbench.dispose();
  });

  it("applies metadata filters after rendering", async () => {
    const fetchImpl = vi.fn(async () =>
      makeJsonResponse(NORMALIZE_RESPONSE),
    ) as unknown as typeof fetch;

    const datasetClient = new DatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = new GraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME);

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
    const fetchImpl = vi.fn(async () =>
      makeJsonResponse(NORMALIZE_RESPONSE),
    ) as unknown as typeof fetch;

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

  it("forwards ancillary metadata payload to normalize request", async () => {
    const fetchImpl = vi.fn(async () =>
      makeJsonResponse(NORMALIZE_RESPONSE),
    ) as unknown as typeof fetch;

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

    const lastCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const init = lastCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;

    expect(body.metadata_schema).toEqual([{ key: "trait_a", type: "number" }]);
    expect(body.metadata_by_node_id).toEqual({ root: { trait_a: 10 } });

    workbench.dispose();
  });
});
