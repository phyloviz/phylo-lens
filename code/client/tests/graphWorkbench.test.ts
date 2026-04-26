import {
  ERR_NO_GRAPH_RENDERED,
  GraphWorkbench,
} from "../src/app/graphWorkbench";
import { MetadataField } from "../src/contracts/canonical";
import { DatasetClient } from "../src/api/datasetClient";
import { LAYOUT_FORCE } from "../src/contracts/positioned";
import {
  GraphRenderer,
  RENDERER_KIND_MOCK,
  RenderContext,
  RenderNodeClickState,
  RenderViewportState,
  RendererFactory,
} from "../src/render/types";
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

class ClickableTestRenderer implements GraphRenderer {
  readonly kind = RENDERER_KIND_MOCK;

  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  lastCenteredNodeId: string | null = null;

  mount(_context: RenderContext): void {}

  render(_graph: unknown): void {}

  setViewChangeHandler(
    handler: ((state: RenderViewportState) => void) | null,
  ): void {
    this.viewChangeHandler = handler;
  }

  setNodeClickHandler(
    handler: ((state: RenderNodeClickState) => void) | null,
  ): void {
    this.nodeClickHandler = handler;
  }

  unmount(): void {
    this.nodeClickHandler = null;
    this.viewChangeHandler = null;
    this.lastCenteredNodeId = null;
  }

  emitNodeClick(state: RenderNodeClickState): void {
    this.nodeClickHandler?.(state);
  }

  centerOnNode(nodeId: string): void {
    this.lastCenteredNodeId = nodeId;
  }
}

class StaticRendererFactory implements RendererFactory {
  constructor(private readonly renderer: GraphRenderer) {}

  createRenderer(): GraphRenderer {
    return this.renderer;
  }
}

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
      ["a", -75, 170],
      ["b", 75, 170],
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

  it("applies force refinement over server-provided hierarchy coordinates when requested", async () => {
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

    const graph = await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      layout: {
        mode: "force",
        forceIterations: 2,
      },
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.viewMeta.layout).toBe(LAYOUT_FORCE);
    expect(graph.nodes.map((node) => [node.id, node.x, node.y])).not.toEqual([
      ["root", 0, 0],
      ["a", -60, 150],
      ["b", 60, 150],
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

  it("drills into cluster proxy nodes by focusing their subtree and increasing zoom", async () => {
    const proxySliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      nodes: [
        { id: "root", x: 0, y: 0, is_cluster_proxy: false },
        {
          id: "x",
          x: -0.5,
          y: 1,
          is_cluster_proxy: true,
          subtree_size: 32,
          leaf_count: 16,
        },
        { id: "y", x: 0.5, y: 1, is_cluster_proxy: true, subtree_size: 32 },
      ],
      edges: [
        { id: "e_root_x_1", source: "root", target: "x" },
        { id: "e_root_y_1", source: "root", target: "y" },
      ],
      collapsed_clusters: [
        { cluster_id: "cluster_x", subtree_size: 32 },
        { cluster_id: "cluster_y", subtree_size: 32 },
      ],
    };
    const focusedSliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      nodes: [
        { id: "x", x: -0.5, y: 1, is_cluster_proxy: false },
        { id: "a", x: -0.75, y: 2 },
        { id: "b", x: -0.25, y: 2 },
      ],
      edges: [
        { id: "e_x_a_1", source: "x", target: "a" },
        { id: "e_x_b_1", source: "x", target: "b" },
      ],
      collapsed_clusters: [],
      view_meta: {
        viewport: { x: -60, y: 150, width: 1000, height: 600 },
        zoom: 5,
        returned_node_count: 3,
        returned_edge_count: 2,
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(proxySliceResponse))
      .mockResolvedValueOnce(makeJsonResponse(focusedSliceResponse)) as unknown as typeof fetch;

    const datasetClient = new DatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const renderer = new ClickableTestRenderer();
    const workbench = new GraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: {
        zoom: 4,
      },
    });

    renderer.emitNodeClick({
      nodeId: "x",
      attributes: {
        is_cluster_proxy: true,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const finalCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[2];
    const body = JSON.parse(String((finalCall?.[1] as RequestInit)?.body ?? "{}")) as Record<
      string,
      unknown
    >;

    expect(String(finalCall?.[0])).toBe(`${BASE_URL}/dataset/view-slice`);
    expect(body.focus_node_id).toBe("x");
    expect(body.zoom).toBe(5);
    expect(body.viewport).toEqual({
      x: -75,
      y: 170,
      width: 1000,
      height: 600,
    });

    workbench.dispose();
  });
});
