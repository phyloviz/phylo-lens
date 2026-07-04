import Graph from "graphology";

import type { GraphV2Client } from "../src/api/graphV2Client";
import {
  buildGraphV2ViewportQuery,
  DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE,
  expandViewportBounds,
  GRAPH_VIEWER_V2_LOD_CHANGE_DEBOUNCE_MS,
  GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST,
  GRAPH_VIEWER_V2_NODE_COLOR,
  GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR,
  GRAPH_VIEWER_V2_SMALL_TREE_NODE_THRESHOLD,
  GraphViewerV2,
  nodeSizeForMemberCount,
  reconcileGraphologyViewport,
  semanticLodLevelForCameraRatio,
  syncGraphologyViewport,
} from "../src/render/adapters/sigma/GraphViewerV2";
import type { ViewportSyncSettings } from "../src/render/adapters/sigma/GraphViewerV2";
import {
  DEFAULT_COLOR_PALETTE,
  deriveColor,
  deriveSize,
} from "../src/render/visualMappings";
import {
  PIE_ATTRIBUTE_PREFIX,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_PALETTE_ATTRIBUTE,
} from "../src/render/pieMapping";

function fakeSigma(ratio = 0.5) {
  let currentRatio = ratio;
  let updatedHandler: (() => void) | null = null;
  let clickedHandler:
    | ((payload: { node?: string; event?: { node?: string } }) => void)
    | null = null;
  const camera = {
    getState: () => ({ ratio: currentRatio }),
    on: vi.fn((_event: "updated", handler: () => void) => {
      updatedHandler = handler;
    }),
    off: vi.fn((_event: "updated", handler: () => void) => {
      if (updatedHandler === handler) {
        updatedHandler = null;
      }
    }),
    animatedReset: vi.fn(),
    animate: vi.fn(),
  };

  return {
    sigma: {
      getCamera: () => camera,
      getDimensions: () => ({ width: 200, height: 100 }),
      viewportToGraph: ({ x, y }: { x: number; y: number }) => ({
        x: x - 100,
        y: y - 50,
      }),
      on: vi.fn(
        (
          _event: "clickNode",
          handler: (payload: { node?: string; event?: { node?: string } }) => void,
        ) => {
          clickedHandler = handler;
        },
      ),
      off: vi.fn(
        (
          _event: "clickNode",
          handler: (payload: { node?: string; event?: { node?: string } }) => void,
        ) => {
          if (clickedHandler === handler) {
            clickedHandler = null;
          }
        },
      ),
      refresh: vi.fn(),
      scheduleRender: vi.fn(),
    },
    camera,
    setRatio: (nextRatio: number) => {
      currentRatio = nextRatio;
    },
    emitCameraUpdated: () => updatedHandler?.(),
    emitNodeClick: (node: string) => clickedHandler?.({ node }),
  };
}

const VIEWPORT_RESPONSE = {
  dataset_id: "tree",
  layout_version: "layout-1",
  lod_level: 1,
  zoom: 2,
  layout_status: "ready" as const,
  truncated: false,
  total_node_count: 2,
  nodes: [
    {
      id: "a",
      cluster_id: "ca",
      x: 0,
      y: 0,
      layout_status: "ready" as const,
      member_count: 1,
      is_representative: false,
    },
    {
      id: "cluster_b",
      cluster_id: "cluster_b",
      x: 20,
      y: 0,
      layout_status: "ready" as const,
      member_count: 12,
      is_representative: true,
    },
  ],
  edges: [
    {
      id: "edge_a_b",
      source: "a",
      target: "cluster_b",
      distance: 3,
    },
  ],
};

describe("GraphViewerV2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds padded bbox and semantic zoom queries from Sigma camera state", () => {
    const { sigma } = fakeSigma();

    const query = buildGraphV2ViewportQuery({
      datasetId: "tree",
      sigma: sigma as never,
      maxNodes: 500,
    });

    expect(query).toMatchObject({
      dataset_id: "tree",
      xmin: -200,
      xmax: 200,
      ymin: -100,
      ymax: 100,
      zoom: 2,
      lod_level: 1,
      max_nodes: 500,
    });
  });

  it("omits bbox for global lod zero queries", () => {
    const { sigma } = fakeSigma(2);

    const query = buildGraphV2ViewportQuery({
      datasetId: "tree",
      sigma: sigma as never,
      maxNodes: 500,
    });

    expect(query.lod_level).toBe(0);
    expect(query.xmin).toBeUndefined();
    expect(query.xmax).toBeUndefined();
    expect(query.ymin).toBeUndefined();
    expect(query.ymax).toBeUndefined();
  });

  it("maps Sigma camera ratio to semantic lod levels", () => {
    expect(semanticLodLevelForCameraRatio(1.2)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.8)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.79)).toBe(1);
    expect(semanticLodLevelForCameraRatio(0.2)).toBe(1);
  });

  it("keeps representative node size subtle for large clusters", () => {
    const cap =
      DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE + GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST;

    // Singletons render at the base size.
    expect(nodeSizeForMemberCount(1)).toBe(DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE);
    // Size grows with cluster size...
    expect(nodeSizeForMemberCount(12)).toBeGreaterThan(
      nodeSizeForMemberCount(1),
    );
    // ...but is capped so even huge clusters never dominate the canvas.
    expect(nodeSizeForMemberCount(12_000)).toBe(cap);
  });

  it("syncs Graphology to the viewport response", () => {
    const graph = new Graph();
    graph.addNode("stale", { x: 1, y: 1 });
    graph.addEdgeWithKey("stale_edge", "stale", "stale");

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE);

    expect(graph.hasNode("stale")).toBe(true);
    expect(graph.hasNode("a")).toBe(true);
    expect(graph.getNodeAttribute("a", "color")).toBe(
      GRAPH_VIEWER_V2_NODE_COLOR,
    );
    expect(graph.getNodeAttribute("cluster_b", "member_count")).toBe(12);
    expect(graph.getNodeAttribute("cluster_b", "is_cluster_proxy")).toBe(true);
    expect(graph.getNodeAttribute("cluster_b", "type")).toBe("triangle");
    expect(graph.getNodeAttribute("cluster_b", "color")).toBe(
      GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR,
    );
    expect(graph.hasEdge("edge_a_b")).toBe(true);
    expect(graph.getEdgeAttribute("edge_a_b", "distance")).toBe(3);
  });

  it("reconciles Graphology by dropping nodes and edges absent from the response", () => {
    const graph = new Graph();
    graph.addNode("stale", { x: 1, y: 1 });
    graph.addNode("stale_neighbour", { x: 2, y: 2 });
    graph.addEdgeWithKey("stale_edge", "stale", "stale_neighbour");

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE);
    reconcileGraphologyViewport(graph, VIEWPORT_RESPONSE);

    // Nodes/edges outside the viewport response are removed.
    expect(graph.hasNode("stale")).toBe(false);
    expect(graph.hasNode("stale_neighbour")).toBe(false);
    expect(graph.hasEdge("stale_edge")).toBe(false);

    // Everything present in the response survives.
    expect(graph.hasNode("a")).toBe(true);
    expect(graph.hasNode("cluster_b")).toBe(true);
    expect(graph.hasEdge("edge_a_b")).toBe(true);
    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
  });

  it("expands viewport bounds with spatial padding", () => {
    expect(
      expandViewportBounds(
        { xmin: 0, xmax: 100, ymin: -50, ymax: 50 },
        0.5,
      ),
    ).toEqual({ xmin: -50, xmax: 150, ymin: -100, ymax: 100 });
  });

  it("debounces camera updates before loading and applying the viewport", async () => {
    const graph = new Graph();
    const { sigma, camera, emitCameraUpdated } = fakeSigma();
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
    });

    viewer.mount();
    emitCameraUpdated();
    emitCameraUpdated();

    await vi.advanceTimersByTimeAsync(249);
    expect(client.readViewport).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(client.readViewport).toHaveBeenCalledTimes(1);
    expect(client.readViewport).toHaveBeenCalledWith(
      expect.objectContaining({ lod_level: 0 }),
    );
    expect(client.readViewport).toHaveBeenCalledWith(
      expect.not.objectContaining({ xmin: expect.any(Number) }),
    );
    expect(graph.hasNode("a")).toBe(true);

    viewer.unmount();
    expect(camera.off).toHaveBeenCalled();
  });

  it("fetches detailed nodes on a short debounce when the ratio crosses the zoom-in threshold", async () => {
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    // A large tree keeps semantic zooming active (small trees bypass it).
    const largeTreeResponse = {
      ...VIEWPORT_RESPONSE,
      total_node_count: GRAPH_VIEWER_V2_SMALL_TREE_NODE_THRESHOLD + 1,
    };
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => largeTreeResponse),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lod_level: 0 }),
    );

    setRatio(0.79);
    emitCameraUpdated();

    // LoD changes use a short debounce (not the full same-level delay, not 0ms
    // which would thrash the server on rapid zoom).
    await vi.advanceTimersByTimeAsync(GRAPH_VIEWER_V2_LOD_CHANGE_DEBOUNCE_MS - 1);
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lod_level: 1,
        xmin: expect.any(Number),
        xmax: expect.any(Number),
        ymin: expect.any(Number),
        ymax: expect.any(Number),
      }),
    );

    viewer.unmount();
  });

  it("stops issuing viewport queries on camera movement for small trees", async () => {
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    // total_node_count of 2 (VIEWPORT_RESPONSE) is well below the small-tree
    // threshold, so the whole tree is loaded once and never re-queried.
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    setRatio(0.79);
    emitCameraUpdated();
    await vi.runOnlyPendingTimersAsync();

    // No additional query: the small tree is already rendered whole.
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    viewer.unmount();
  });

  it("does not refresh on camera movement while LoD playback is paused", async () => {
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    const largeTreeResponse = {
      ...VIEWPORT_RESPONSE,
      total_node_count: GRAPH_VIEWER_V2_SMALL_TREE_NODE_THRESHOLD + 1,
    };
    let paused = false;
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => largeTreeResponse),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      getPaused: () => paused,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    paused = true;
    setRatio(0.79);
    emitCameraUpdated();
    await vi.runOnlyPendingTimersAsync();

    // Frozen: no new slice fetched while paused.
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    // Resuming and issuing an explicit refresh reconciles the current view.
    paused = false;
    viewer.refreshNow();
    await vi.runOnlyPendingTimersAsync();
    expect(client.readViewport).toHaveBeenCalledTimes(2);

    viewer.unmount();
  });

  it("fits the camera after the first global lod zero load", async () => {
    const graph = new Graph();
    const { sigma, camera } = fakeSigma(2);
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => ({
        ...VIEWPORT_RESPONSE,
        lod_level: 0,
      })),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 0,
    });

    viewer.mount();

    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenCalledWith(
      expect.not.objectContaining({ xmin: expect.any(Number) }),
    );
    expect(sigma.refresh).toHaveBeenCalled();
    expect(camera.animatedReset).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(camera.animatedReset).toHaveBeenCalledWith({ duration: 300 });

    await vi.advanceTimersByTimeAsync(300);
    expect(camera.animate).toHaveBeenCalledWith(
      expect.objectContaining({ ratio: 2.3 }),
      { duration: 100 },
    );
  });

  it("loads cluster members and fits the camera when clicking a representative", async () => {
    const graph = new Graph();
    const { sigma, camera, emitNodeClick } = fakeSigma(0.5);
    const clusterResponse = {
      ...VIEWPORT_RESPONSE,
      lod_level: null,
      nodes: [
        {
          id: "b1",
          cluster_id: "cluster_b",
          x: 10,
          y: 0,
          layout_status: "ready" as const,
          member_count: 1,
          is_representative: false,
        },
        {
          id: "b2",
          cluster_id: "cluster_b",
          x: 20,
          y: 10,
          layout_status: "ready" as const,
          member_count: 1,
          is_representative: false,
        },
      ],
      edges: [
        {
          id: "edge_b1_b2",
          source: "b1",
          target: "b2",
          distance: 1,
        },
      ],
    };
    const client: GraphV2Client = {
      readViewport: vi
        .fn()
        .mockResolvedValueOnce({ ...VIEWPORT_RESPONSE, lod_level: 0 })
        .mockResolvedValueOnce(clusterResponse),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 0,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    emitNodeClick("cluster_b");
    await vi.runOnlyPendingTimersAsync();

    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cluster_id: "cluster_b",
        lod_level: null,
      }),
    );
    expect(graph.hasNode("b1")).toBe(true);
    expect(graph.getNodeAttribute("b1", "color")).toBe(
      GRAPH_VIEWER_V2_NODE_COLOR,
    );
    expect(graph.getNodeAttribute("b1", "type")).toBeUndefined();
    expect(graph.hasEdge("edge_b1_b2")).toBe(true);
    expect(camera.animate).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 15,
        y: 5,
      }),
      { duration: 350 },
    );

    viewer.unmount();
  });
});

const METADATA_VIEWPORT_RESPONSE = {
  dataset_id: "tree",
  layout_version: "layout-1",
  lod_level: 1,
  zoom: 2,
  layout_status: "ready" as const,
  truncated: false,
  total_node_count: 2,
  metadata_schema: [
    { key: "region", type: "string" },
    { key: "distance", type: "number" },
  ],
  nodes: [
    {
      id: "a",
      cluster_id: "ca",
      x: 0,
      y: 0,
      layout_status: "ready" as const,
      member_count: 1,
      is_representative: false,
      metadata: { region: "eu", distance: 1 },
    },
    {
      id: "b",
      cluster_id: "cb",
      x: 20,
      y: 0,
      layout_status: "ready" as const,
      member_count: 1,
      is_representative: false,
      metadata: { region: "us", distance: 9 },
    },
  ],
  edges: [
    {
      id: "edge_a_b",
      source: "a",
      target: "b",
      distance: 3,
    },
  ],
};

const COLOR_SIZE_SETTINGS: ViewportSyncSettings = {
  visualMapping: {
    colorField: "region",
    size: { field: "distance", scale: "linear" },
    palette: DEFAULT_COLOR_PALETTE,
  },
  metadataSchema: METADATA_VIEWPORT_RESPONSE.metadata_schema,
};

describe("GraphViewerV2 metadata-driven sync", () => {
  it("derives node color and size from metadata when a visual mapping is active", () => {
    const graph = new Graph();

    syncGraphologyViewport(
      graph,
      METADATA_VIEWPORT_RESPONSE,
      COLOR_SIZE_SETTINGS,
    );

    // Colors come from the categorical color field, not member-count defaults.
    expect(graph.getNodeAttribute("a", "color")).toBe(
      deriveColor("eu", DEFAULT_COLOR_PALETTE),
    );
    expect(graph.getNodeAttribute("b", "color")).toBe(
      deriveColor("us", DEFAULT_COLOR_PALETTE),
    );

    // Sizes come from min/max normalization of the numeric size field across
    // the current viewport (distance spans 1..9).
    const stats = { min: 1, max: 9 };
    expect(graph.getNodeAttribute("a", "size")).toBe(
      deriveSize(1, stats, "linear"),
    );
    expect(graph.getNodeAttribute("b", "size")).toBe(
      deriveSize(9, stats, "linear"),
    );
    expect(graph.getNodeAttribute("b", "size")).toBeGreaterThan(
      graph.getNodeAttribute("a", "size") as number,
    );
  });

  it("leaves the default representative styling intact without a mapping", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE);

    expect(graph.getNodeAttribute("a", "color")).toBe(GRAPH_VIEWER_V2_NODE_COLOR);
    expect(graph.getNodeAttribute("cluster_b", "color")).toBe(
      GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR,
    );
    expect(graph.getNodeAttribute("cluster_b", "size")).toBe(
      nodeSizeForMemberCount(12),
    );
  });

  it("drops nodes and dangling edges failing an active categorical filter", () => {
    const graph = new Graph();
    const settings: ViewportSyncSettings = {
      filterState: {
        categorical: [{ fieldKey: "region", acceptedValues: ["eu"] }],
        numeric: [],
      },
    };

    syncGraphologyViewport(graph, METADATA_VIEWPORT_RESPONSE, settings);

    expect(graph.hasNode("a")).toBe(true);
    expect(graph.hasNode("b")).toBe(false);
    // The edge to the dropped node must not be added.
    expect(graph.hasEdge("edge_a_b")).toBe(false);
  });

  it("drops nodes failing an active numeric filter", () => {
    const graph = new Graph();
    const settings: ViewportSyncSettings = {
      filterState: {
        categorical: [],
        numeric: [{ fieldKey: "distance", min: 5 }],
      },
    };

    syncGraphologyViewport(graph, METADATA_VIEWPORT_RESPONSE, settings);

    expect(graph.hasNode("a")).toBe(false);
    expect(graph.hasNode("b")).toBe(true);
  });

  it("reconciles previously filtered-out nodes back out of the graph", () => {
    const graph = new Graph();
    const activeFilter: ViewportSyncSettings = {
      filterState: {
        categorical: [{ fieldKey: "region", acceptedValues: ["eu"] }],
        numeric: [],
      },
    };

    // First sync without a filter admits both nodes.
    syncGraphologyViewport(graph, METADATA_VIEWPORT_RESPONSE);
    expect(graph.hasNode("b")).toBe(true);

    // Re-syncing with an active filter and reconciling drops the excluded node.
    syncGraphologyViewport(graph, METADATA_VIEWPORT_RESPONSE, activeFilter);
    reconcileGraphologyViewport(graph, METADATA_VIEWPORT_RESPONSE, activeFilter);

    expect(graph.hasNode("a")).toBe(true);
    expect(graph.hasNode("b")).toBe(false);
    expect(graph.hasEdge("edge_a_b")).toBe(false);
  });
});

const PIE_VIEWPORT_RESPONSE = {
  dataset_id: "tree",
  layout_version: "layout-1",
  lod_level: 0,
  zoom: 0.5,
  layout_status: "ready" as const,
  truncated: false,
  total_node_count: 1,
  metadata_schema: [
    { key: "region", type: "string" },
    { key: "distance", type: "number" },
  ],
  nodes: [
    {
      id: "cluster_x",
      cluster_id: "cluster_x",
      x: 0,
      y: 0,
      layout_status: "ready" as const,
      member_count: 4,
      is_representative: true,
      // Server pre-aggregates member categories into __category_count__ keys.
      metadata: {
        region: "eu",
        distance: 2,
        "__category_count__region__value__eu": 3,
        "__category_count__region__value__us": 1,
      },
    },
  ],
  edges: [],
};

function pieSliceAttributes(
  attributes: Record<string, unknown>,
): Array<[string, unknown]> {
  return Object.entries(attributes).filter(([key]) =>
    key.startsWith(PIE_ATTRIBUTE_PREFIX),
  );
}

describe("GraphViewerV2 pie mapping under LoD", () => {
  it("produces pie slice attributes from aggregated metadata when a pie mapping is active", () => {
    const graph = new Graph();
    const settings: ViewportSyncSettings = {
      visualMapping: { pie: { enabled: true, fields: ["region"] } },
      metadataSchema: PIE_VIEWPORT_RESPONSE.metadata_schema,
    };

    syncGraphologyViewport(graph, PIE_VIEWPORT_RESPONSE, settings);

    const attributes = graph.getNodeAttributes("cluster_x") as Record<
      string,
      unknown
    >;
    const slices = pieSliceAttributes(attributes);
    // One slice per aggregated category (eu, us).
    expect(slices).toHaveLength(2);
    const total = slices.reduce(
      (sum, [, value]) => sum + (value as number),
      0,
    );
    expect(total).toBe(4);
  });

  it("omits pie attributes when no pie mapping is active", () => {
    const graph = new Graph();
    const settings: ViewportSyncSettings = {
      visualMapping: { colorField: "region", palette: DEFAULT_COLOR_PALETTE },
      metadataSchema: PIE_VIEWPORT_RESPONSE.metadata_schema,
    };

    syncGraphologyViewport(graph, PIE_VIEWPORT_RESPONSE, settings);

    const attributes = graph.getNodeAttributes("cluster_x") as Record<
      string,
      unknown
    >;
    expect(pieSliceAttributes(attributes)).toHaveLength(0);
    expect(attributes[PIE_PALETTE_ATTRIBUTE]).toBeUndefined();
    expect(attributes[PIE_CATEGORY_COLORS_ATTRIBUTE]).toBeUndefined();
  });

  it("omits pie attributes entirely without any visual mapping", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, PIE_VIEWPORT_RESPONSE);

    const attributes = graph.getNodeAttributes("cluster_x") as Record<
      string,
      unknown
    >;
    expect(pieSliceAttributes(attributes)).toHaveLength(0);
  });

  it("treats an explicitly disabled pie mapping as inactive", () => {
    const graph = new Graph();
    const settings: ViewportSyncSettings = {
      visualMapping: { pie: { enabled: false, fields: ["region"] } },
      metadataSchema: PIE_VIEWPORT_RESPONSE.metadata_schema,
    };

    syncGraphologyViewport(graph, PIE_VIEWPORT_RESPONSE, settings);

    const attributes = graph.getNodeAttributes("cluster_x") as Record<
      string,
      unknown
    >;
    expect(pieSliceAttributes(attributes)).toHaveLength(0);
  });

  it("carries pie palette and category colours onto pie nodes", () => {
    const graph = new Graph();
    const palette = ["#112233", "#445566"];
    const settings: ViewportSyncSettings = {
      visualMapping: {
        pie: {
          enabled: true,
          fields: ["region"],
          palette,
          categoryColors: { eu: "#abcdef" },
        },
      },
      metadataSchema: PIE_VIEWPORT_RESPONSE.metadata_schema,
    };

    syncGraphologyViewport(graph, PIE_VIEWPORT_RESPONSE, settings);

    const attributes = graph.getNodeAttributes("cluster_x") as Record<
      string,
      unknown
    >;
    expect(attributes[PIE_PALETTE_ATTRIBUTE]).toEqual(palette);
    const categoryColors = attributes[PIE_CATEGORY_COLORS_ATTRIBUTE] as Record<
      string,
      string
    >;
    expect(Object.values(categoryColors)).toContain("#abcdef");
  });
});

describe("GraphViewerV2 sync lifecycle hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes onGraphSynced after the graph is populated and before Sigma refresh", async () => {
    const graph = new Graph();
    const { sigma } = fakeSigma(2);
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    let nodeCountAtSync = -1;
    let refreshCountAtSync = -1;
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      onGraphSynced: () => {
        nodeCountAtSync = graph.order;
        refreshCountAtSync = (sigma.refresh as ReturnType<typeof vi.fn>).mock
          .calls.length;
      },
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);

    // Fired once the viewport nodes are in the graph...
    expect(nodeCountAtSync).toBe(2);
    // ...but before Sigma is refreshed.
    expect(refreshCountAtSync).toBe(0);
    expect(sigma.refresh).toHaveBeenCalled();

    viewer.unmount();
  });

  it("routes camera and click events through a Sigma instance rebuilt mid-session", async () => {
    const graph = new Graph();
    const first = fakeSigma(2);
    const second = fakeSigma(2);
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: first.sigma as never,
      debounceMs: 5,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);

    viewer.rebindSigma(second.sigma as never);
    expect(second.camera.on).toHaveBeenCalled();
    expect(second.sigma.on).toHaveBeenCalledWith(
      "clickNode",
      expect.any(Function),
    );

    // A click on the rebuilt instance drives cluster expansion.
    second.emitNodeClick("cluster_b");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ cluster_id: "cluster_b" }),
    );

    viewer.unmount();
  });

  it("treats rebindSigma with the current instance as a no-op", async () => {
    const graph = new Graph();
    const { sigma, camera } = fakeSigma(2);
    const client: GraphV2Client = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewerV2({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    const onCallsBefore = (camera.on as ReturnType<typeof vi.fn>).mock.calls
      .length;

    viewer.rebindSigma(sigma as never);
    expect((camera.on as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      onCallsBefore,
    );

    viewer.unmount();
  });
});
