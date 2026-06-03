import {
  ERR_NO_GRAPH_RENDERED,
  SEARCH_FOCUS_LOD_ZOOM,
  createGraphWorkbench,
} from "../src/app/workbench/graphWorkbench";
import type { MetadataField } from "../src/contracts/models";
import { createDatasetClient } from "../src/api/datasetClient";
import { LAYOUT_SERVER } from "../src/contracts/positioned";
import type {
  GraphRenderer,
  RenderNodeClickState,
  RenderViewportState,
  RendererFactory,
} from "../src/render/types";
import { RENDERER_KIND_MOCK } from "../src/render/types";
import { DefaultRendererFactory } from "../src/render/rendererFactory";
import { pieCategoricalAttributeKey } from "../src/render/pieMapping";
import { describe, it, vi, expect } from "vitest";

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

const NORMALIZE_RESPONSE = {
  dataset: {
    dataset_id: DATASET_NAME,
    nodes: [{ id: "root" }, { id: "a" }, { id: "b" }],
    edges: [
      { id: "e_root_a_1", source: "root", target: "a" },
      { id: "e_root_b_1", source: "root", target: "b" },
    ],
    metadata_schema: METADATA_SCHEMA,
    metadata_by_node_id: METADATA_BY_NODE_ID,
    source: {
      format: "newick",
      generated_at: "2026-05-25T00:00:00+00:00",
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
    global_bounds: { min_x: -600, max_x: 600, min_y: 0, max_y: 1200 },
  },
};

class ClickableTestRenderer implements GraphRenderer {
  readonly kind = RENDERER_KIND_MOCK;

  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  lastCenteredNodeId: string | null = null;
  lastRenderedGraph: unknown = null;

  mount(): void {}

  render(graph: unknown): void {
    this.lastRenderedGraph = graph;
  }

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
    this.lastRenderedGraph = null;
  }

  emitNodeClick(state: RenderNodeClickState): void {
    this.nodeClickHandler?.(state);
  }

  emitViewChange(state: RenderViewportState): void {
    this.viewChangeHandler?.(state);
  }

  centerOnNode(nodeId: string): void {
    this.lastCenteredNodeId = nodeId;
  }
}

class RenderUpdatingRenderer extends ClickableTestRenderer {
  override render(graph: unknown): void {
    super.render(graph);
    this.emitViewChange({
      viewport: { x: 0, y: 0, width: 1000, height: 600 },
      zoom: 1,
    });
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
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    const graph = await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: { enabled: true },
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.viewMeta.lodLevel).toBe(1);
    expect(graph.viewMeta.globalBounds).toEqual({
      minX: -600,
      maxX: 600,
      minY: 0,
      maxY: 1200,
    });
    const nodeById = Object.fromEntries(
      graph.nodes.map((node) => [node.id, node]),
    );
    expect(Number.isFinite(nodeById["root"]?.x)).toBe(true);
    expect(Number.isFinite(nodeById["root"]?.y)).toBe(true);
    expect(Number.isFinite(nodeById["a"]?.x)).toBe(true);
    expect(Number.isFinite(nodeById["b"]?.y)).toBe(true);
    expect(nodeById["a"]?.x).not.toBe(nodeById["b"]?.x);
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => String(call[0]),
      ),
    ).toEqual([
      `${BASE_URL}/dataset/normalize`,
      `${BASE_URL}/dataset/prepare`,
      `${BASE_URL}/dataset/view-slice`,
    ]);

    workbench.dispose();
  });

  it("requests a detail LoD slice and centers searched nodes on focus", async () => {
    const focusedSliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      view_meta: {
        ...VIEW_SLICE_RESPONSE.view_meta,
        zoom: SEARCH_FOCUS_LOD_ZOOM,
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(VIEW_SLICE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(focusedSliceResponse),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const renderer = new ClickableTestRenderer();
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: {
        enabled: true,
        zoom: 1,
      },
    });
    await workbench.focusNode("b");

    const focusCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[3];
    const body = JSON.parse(
      String((focusCall?.[1] as RequestInit)?.body ?? "{}"),
    ) as Record<string, unknown>;

    expect(String(focusCall?.[0])).toBe(`${BASE_URL}/dataset/view-slice`);
    expect(body.focus_node_id).toBe("b");
    expect(body.zoom).toBe(SEARCH_FOCUS_LOD_ZOOM);
    expect(renderer.lastCenteredNodeId).toBe("b");

    workbench.dispose();
  });

  it("searches and focuses locally for full-rendered graphs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          ...NORMALIZE_RESPONSE,
          dataset: {
            ...NORMALIZE_RESPONSE.dataset,
            nodes: [{ id: "8" }, { id: "1274" }],
            edges: [{ id: "e_8_1274_1", source: "8", target: "1274" }],
            metadata_schema: [{ key: "age_yr", type: "number" }],
            metadata_by_node_id: {
              "8": { age_yr: 99 },
              "1274": { age_yr: 8 },
            },
          },
        }),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const renderer = new ClickableTestRenderer();
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick("(8:1,1274:1)Root;", DATASET_NAME, {
      lod: { enabled: false },
    });

    const numericMatches = await workbench.searchNodes({
      query: "8",
      includeMetadataKeys: ["age_yr"],
    });
    const metadataMatches = await workbench.searchNodes({
      query: "99",
      includeMetadataKeys: ["age_yr"],
    });
    await workbench.focusNode("1274");

    expect(numericMatches.matches.map((match) => match.node_id)).toEqual(["8"]);
    expect(metadataMatches.matches.map((match) => match.node_id)).toEqual([
      "8",
    ]);
    expect(metadataMatches.matches[0]?.metadata).toEqual({ age_yr: 99 });
    expect(renderer.lastCenteredNodeId).toBe("1274");
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
        String(call[0]),
      ),
    ).toEqual([`${BASE_URL}/dataset/normalize`]);

    workbench.dispose();
  });

  it("uses server-provided hierarchy coordinates as authoritative positions", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    const graph = await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      layout: {
        forceIterations: 2,
      },
      lod: { enabled: true },
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.viewMeta.layout).toBe(LAYOUT_SERVER);
    expect(graph.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["root", 0, 0],
      ["a", -75, 170],
      ["b", 75, 170],
    ]);

    workbench.dispose();
  });

  it("does not perturb collinear server-provided hierarchy coordinates", async () => {
    const collinearSliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 1, y: 0 },
        { id: "b", x: 2, y: 0 },
      ],
      view_meta: {
        ...VIEW_SLICE_RESPONSE.view_meta,
        global_bounds: { min_x: 0, max_x: 300, min_y: 0, max_y: 1 },
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(collinearSliceResponse),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    const graph = await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: { enabled: true },
    });

    expect(graph.viewMeta.layout).toBe(LAYOUT_SERVER);
    expect(graph.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["root", 0, 0],
      ["a", 150, 0],
      ["b", 300, 0],
    ]);

    workbench.dispose();
  });

  it("applies metadata filters on the current visible slice after rendering", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      metadataSchema: METADATA_SCHEMA,
      metadataByNodeId: METADATA_BY_NODE_ID,
      lod: { enabled: true },
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
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
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
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
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
      lod: { enabled: true },
    });

    const prepareCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[1];
    const init = prepareCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;

    expect(body.metadata_schema).toEqual([{ key: "trait_a", type: "number" }]);
    expect(body.metadata_by_node_id).toEqual({ root: { trait_a: 10 } });

    workbench.dispose();
  });

  it("forwards tabular ancillary data and uses normalized metadata for slices", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new DefaultRendererFactory(),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      ancillaryData: {
        format: "tsv",
        join_column: "isolate",
        content: "isolate\tregion\nA\tEU\nB\tAF\n",
      },
      lod: { enabled: true },
    });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const normalizeInit = calls[0]?.[1] as RequestInit | undefined;
    const prepareInit = calls[1]?.[1] as RequestInit | undefined;
    const viewSliceInit = calls[2]?.[1] as RequestInit | undefined;

    const expectedAncillaryData = {
      format: "tsv",
      join_column: "isolate",
      content: "isolate\tregion\nA\tEU\nB\tAF\n",
    };

    expect(JSON.parse(String(normalizeInit?.body ?? "{}"))).toEqual(
      expect.objectContaining({
        ancillary_data: expectedAncillaryData,
      }),
    );
    expect(JSON.parse(String(prepareInit?.body ?? "{}"))).toEqual(
      expect.objectContaining({
        ancillary_data: expectedAncillaryData,
      }),
    );
    expect(JSON.parse(String(viewSliceInit?.body ?? "{}"))).toEqual(
      expect.objectContaining({
        include_metadata_keys: ["region", "distance"],
      }),
    );

    workbench.dispose();
  });

  it("updates graph node pies when visual mapping changes", async () => {
    const renderer = new ClickableTestRenderer();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: { enabled: true },
    });

    const graph = workbench.updateVisualMapping({
      pie: { enabled: true, fields: ["region"] },
    });

    const nodeAttributes = graph.nodes.find((node) => node.id === "a")
      ?.attributes as Record<string, unknown>;

    expect(nodeAttributes[pieCategoricalAttributeKey("region", "EU")]).toBe(1);
    expect(renderer.lastRenderedGraph).toBe(graph);

    workbench.dispose();
  });

  it("drills into cluster proxy nodes by focusing their subtree without changing zoom", async () => {
    const proxySliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      nodes: [
        { id: "root", x: 0, y: 0, is_cluster_proxy: false },
        {
          id: "x",
          cluster_id: "cluster_x",
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
        zoom: 4,
        returned_node_count: 3,
        returned_edge_count: 2,
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(proxySliceResponse))
      .mockResolvedValueOnce(
        makeJsonResponse(focusedSliceResponse),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const renderer = new ClickableTestRenderer();
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: {
        enabled: true,
        zoom: 4,
      },
    });

    renderer.emitNodeClick({
      nodeId: "x",
      attributes: {
        cluster_id: "cluster_x",
        is_cluster_proxy: true,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const finalCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[3];
    const body = JSON.parse(
      String((finalCall?.[1] as RequestInit)?.body ?? "{}"),
    ) as Record<string, unknown>;

    expect(String(finalCall?.[0])).toBe(`${BASE_URL}/dataset/view-slice`);
    expect(body.focus_node_id).toBe("x");
    expect(body.focus_cluster_id).toBe("cluster_x");
    expect(body.expanded_cluster_ids).toEqual(["cluster_x"]);
    expect(body.zoom).toBe(4);
    expect(renderer.lastCenteredNodeId).toBeNull();
    expect(body.viewport).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      width: 1000,
      height: 600,
    });

    workbench.dispose();
  });

  it("collapses expanded cluster proxy nodes without changing zoom", async () => {
    const proxySliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      nodes: [
        { id: "root", x: 0, y: 0, is_cluster_proxy: false },
        {
          id: "x",
          cluster_id: "cluster_x",
          x: -0.5,
          y: 1,
          is_cluster_proxy: true,
          subtree_size: 32,
        },
      ],
      edges: [{ id: "e_root_x_1", source: "root", target: "x" }],
      collapsed_clusters: [{ cluster_id: "cluster_x", subtree_size: 32 }],
    };
    const expandedSliceResponse = {
      ...VIEW_SLICE_RESPONSE,
      nodes: [
        {
          id: "x",
          cluster_id: "cluster_x",
          x: -0.5,
          y: 1,
          is_cluster_proxy: true,
          subtree_size: 32,
        },
        { id: "a", x: -0.75, y: 2 },
      ],
      edges: [{ id: "e_x_a_1", source: "x", target: "a" }],
      collapsed_clusters: [],
      view_meta: {
        ...VIEW_SLICE_RESPONSE.view_meta,
        zoom: 4,
      },
    };
    const collapsedSliceResponse = {
      ...proxySliceResponse,
      view_meta: {
        ...VIEW_SLICE_RESPONSE.view_meta,
        zoom: 4,
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(proxySliceResponse))
      .mockResolvedValueOnce(makeJsonResponse(expandedSliceResponse))
      .mockResolvedValueOnce(
        makeJsonResponse(collapsedSliceResponse),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const renderer = new ClickableTestRenderer();
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: {
        enabled: true,
        zoom: 4,
      },
    });

    renderer.emitNodeClick({
      nodeId: "x",
      attributes: {
        cluster_id: "cluster_x",
        is_cluster_proxy: true,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    renderer.emitNodeClick({
      nodeId: "x",
      attributes: {
        cluster_id: "cluster_x",
        is_cluster_proxy: true,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const finalCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[4];
    const body = JSON.parse(
      String((finalCall?.[1] as RequestInit)?.body ?? "{}"),
    ) as Record<string, unknown>;

    expect(String(finalCall?.[0])).toBe(`${BASE_URL}/dataset/view-slice`);
    expect(body.expanded_cluster_ids).toEqual([]);
    expect(body.collapsed_cluster_ids).toEqual(["cluster_x"]);
    expect(body.zoom).toBe(4);
    expect(renderer.lastCenteredNodeId).toBeNull();

    workbench.dispose();
  });

  it("keeps the camera stable when refreshing semantic zoom on viewport changes", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
        .mockResolvedValueOnce(makeJsonResponse(VIEW_SLICE_RESPONSE))
        .mockResolvedValueOnce(
          makeJsonResponse(VIEW_SLICE_RESPONSE),
        ) as unknown as typeof fetch;

      const datasetClient = createDatasetClient({
        baseUrl: BASE_URL,
        fetchImpl,
      });
      const renderer = new ClickableTestRenderer();
      const workbench = createGraphWorkbench({
        datasetClient,
        rendererFactory: new StaticRendererFactory(renderer),
        rendererKind: RENDERER_KIND_MOCK,
        renderContext: { containerId: "graph-root" },
      });

      await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
        lod: {
          enabled: true,
          zoom: 4,
        },
      });

      expect(renderer.lastCenteredNodeId).toBeNull();

      await vi.advanceTimersByTimeAsync(150);

      renderer.emitViewChange({
        viewport: { x: 0, y: 0, width: 1000, height: 600 },
        zoom: 5,
      });

      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();

      expect(renderer.lastCenteredNodeId).toBeNull();
      expect(
        (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(3);

      workbench.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores renderer-originated view changes immediately after render", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(NORMALIZE_RESPONSE))
      .mockResolvedValueOnce(makeJsonResponse(PREPARE_RESPONSE))
      .mockResolvedValueOnce(
        makeJsonResponse(VIEW_SLICE_RESPONSE),
      ) as unknown as typeof fetch;

    const datasetClient = createDatasetClient({ baseUrl: BASE_URL, fetchImpl });
    const renderer = new RenderUpdatingRenderer();
    const workbench = createGraphWorkbench({
      datasetClient,
      rendererFactory: new StaticRendererFactory(renderer),
      rendererKind: RENDERER_KIND_MOCK,
      renderContext: { containerId: "graph-root" },
    });

    await workbench.renderNewick(NEWICK_CONTENT, DATASET_NAME, {
      lod: { enabled: true },
    });

    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => String(call[0]),
      ),
    ).toEqual([
      `${BASE_URL}/dataset/normalize`,
      `${BASE_URL}/dataset/prepare`,
      `${BASE_URL}/dataset/view-slice`,
    ]);

    workbench.dispose();
  });
});
