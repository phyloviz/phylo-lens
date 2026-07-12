import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Graph from "graphology";

import type { GraphClient } from "../src/api/graphClient";
import {
  buildGraphViewportQuery,
  DEFAULT_GRAPH_VIEWER_NODE_SIZE,
  expandViewportBounds,
  GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS,
  GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST,
  GRAPH_VIEWER_NODE_COLOR,
  GRAPH_VIEWER_REPRESENTATIVE_COLOR,
  GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
  GraphViewer,
  deriveViewportNodeColor,
  nodeSizeForMemberCount,
  reconcileGraphologyViewport,
  semanticLodLevelForCameraRatio,
  semanticLodLevelForCameraRatioWithHysteresis,
  syncGraphologyViewport,
} from "../src/render/adapters/sigma/GraphViewer";
import type { ViewportSyncSettings } from "../src/render/adapters/sigma/GraphViewer";
import {
  PHYLOVIZ_NODE_COMMON_COLOR,
  PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR,
} from "../src/render/adapters/sigma/sigmaRenderingConstants";
import {
  buildValueColorMap,
  DEFAULT_COLOR_PALETTE,
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
  type NodeHandler = (payload: {
    node?: string;
    event?: { node?: string };
  }) => void;
  const nodeHandlers: Record<string, NodeHandler | null> = {
    clickNode: null,
    doubleClickNode: null,
  };
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
      on: vi.fn((event: string, handler: NodeHandler) => {
        if (event in nodeHandlers) {
          nodeHandlers[event] = handler;
        }
      }),
      off: vi.fn((event: string, handler: NodeHandler) => {
        if (event in nodeHandlers && nodeHandlers[event] === handler) {
          nodeHandlers[event] = null;
        }
      }),
      refresh: vi.fn(),
      scheduleRender: vi.fn(),
    },
    camera,
    setRatio: (nextRatio: number) => {
      currentRatio = nextRatio;
    },
    emitCameraUpdated: () => updatedHandler?.(),
    emitNodeClick: (node: string) => nodeHandlers.clickNode?.({ node }),
    emitNodeDoubleClick: (node: string) =>
      nodeHandlers.doubleClickNode?.({ node }),
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

describe("GraphViewer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds padded bbox and semantic zoom queries from Sigma camera state", () => {
    const { sigma } = fakeSigma();

    const query = buildGraphViewportQuery({
      datasetId: "tree",
      sigma: sigma as never,
      maxNodes: 500,
      lodTierCount: 2,
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

    const query = buildGraphViewportQuery({
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

  it("targets the finest tier with no bbox when forcing finest tier", () => {
    // A zoomed-in camera would normally pick a bounded finer tier, but a
    // forced finest-tier (small-tree) query pins the deepest tier and drops the
    // bounds so the whole tree is read at once.
    const { sigma } = fakeSigma(0.1);

    const query = buildGraphViewportQuery({
      datasetId: "tree",
      sigma: sigma as never,
      maxNodes: 500,
      forceFinestTier: true,
      lodTierCount: 4,
    });

    expect(query.lod_level).toBe(3);
    expect(query.xmin).toBeUndefined();
    expect(query.xmax).toBeUndefined();
    expect(query.ymin).toBeUndefined();
    expect(query.ymax).toBeUndefined();
  });

  it("maps Sigma camera ratio to semantic lod levels", () => {
    // With a single tier, every ratio resolves to the overview tier 0.
    expect(semanticLodLevelForCameraRatio(1.2, 1)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.2, 1)).toBe(0);
    // Two tiers reproduce the original binary behavior at the 0.8 boundary.
    expect(semanticLodLevelForCameraRatio(1.2, 2)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.8, 2)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.79, 2)).toBe(1);
    expect(semanticLodLevelForCameraRatio(0.2, 2)).toBe(1);
  });

  it("maps camera ratio across geometric lod tier bands", () => {
    // Boundaries: tier1 <0.8, tier2 <0.32, tier3 <0.128 (each x0.4). Values are
    // chosen clearly inside each band to avoid exact-boundary float artifacts.
    expect(semanticLodLevelForCameraRatio(0.9, 4)).toBe(0);
    expect(semanticLodLevelForCameraRatio(0.5, 4)).toBe(1);
    expect(semanticLodLevelForCameraRatio(0.35, 4)).toBe(1);
    expect(semanticLodLevelForCameraRatio(0.3, 4)).toBe(2);
    expect(semanticLodLevelForCameraRatio(0.14, 4)).toBe(2);
    expect(semanticLodLevelForCameraRatio(0.1, 4)).toBe(3);
    // Clamps to the finest available tier even when the ratio would go deeper.
    expect(semanticLodLevelForCameraRatio(0.001, 4)).toBe(3);
    expect(semanticLodLevelForCameraRatio(0.001, 3)).toBe(2);
  });

  it("holds the current tier within the boundary hysteresis dead-band", () => {
    // 0.79 normally maps to tier 1, but within 0.05 of the 0.8 boundary a
    // camera coming from tier 0 holds tier 0 to avoid oscillation.
    expect(
      semanticLodLevelForCameraRatioWithHysteresis(0.79, 4, 0),
    ).toBe(0);
    // Once clear of the dead-band it commits to the naive tier.
    expect(
      semanticLodLevelForCameraRatioWithHysteresis(0.7, 4, 0),
    ).toBe(1);
    // No prior tier (null) never holds.
    expect(
      semanticLodLevelForCameraRatioWithHysteresis(0.79, 4, null),
    ).toBe(1);
    // Coming down from tier 1 across the same boundary also holds tier 1.
    expect(
      semanticLodLevelForCameraRatioWithHysteresis(0.82, 4, 1),
    ).toBe(1);
  });

  it("keeps representative node size subtle for large clusters", () => {
    const cap =
      DEFAULT_GRAPH_VIEWER_NODE_SIZE + GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST;

    // Singletons render at the base size.
    expect(nodeSizeForMemberCount(1)).toBe(DEFAULT_GRAPH_VIEWER_NODE_SIZE);
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
      GRAPH_VIEWER_NODE_COLOR,
    );
    expect(graph.getNodeAttribute("cluster_b", "member_count")).toBe(12);
    expect(graph.getNodeAttribute("cluster_b", "is_cluster_proxy")).toBe(true);
    expect(graph.getNodeAttribute("cluster_b", "type")).toBe("triangle");
    expect(graph.getNodeAttribute("cluster_b", "color")).toBe(
      GRAPH_VIEWER_REPRESENTATIVE_COLOR,
    );
    expect(graph.hasEdge("edge_a_b")).toBe(true);
    expect(graph.getEdgeAttribute("edge_a_b", "distance")).toBe(3);
  });

  it("renders a single-member cluster proxy as a plain leaf, not a triangle", () => {
    // The server materializes a single-member cluster per node at each tier, so
    // some viewport nodes arrive with is_representative === true yet
    // member_count === 1. These must render as ordinary leaves (labeled circle),
    // never as expandable triangle "clusters" holding one node.
    const graph = new Graph();
    syncGraphologyViewport(graph, {
      ...VIEWPORT_RESPONSE,
      nodes: [
        {
          id: "lone",
          cluster_id: "cluster_lone",
          x: 0,
          y: 0,
          layout_status: "ready" as const,
          member_count: 1,
          is_representative: true,
        },
      ],
      edges: [],
    });

    expect(graph.getNodeAttribute("lone", "type")).toBeUndefined();
    expect(graph.getNodeAttribute("lone", "is_cluster_proxy")).toBeUndefined();
    expect(graph.getNodeAttribute("lone", "label")).toBe("lone");
  });

  it("colors leaf nodes by their PHYLOViZ role", () => {
    const roleNode = (id: string, role: unknown) => ({
      id,
      cluster_id: id,
      x: 0,
      y: 0,
      layout_status: "ready" as const,
      member_count: 1,
      is_representative: false,
      metadata: { phyloviz_role: role } as Record<string, unknown>,
    });

    // Group founder -> light green, sub-group founder -> dark green.
    expect(deriveViewportNodeColor(roleNode("g", "group founder"))).toBe(
      PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR,
    );
    expect(deriveViewportNodeColor(roleNode("s", "sub-group founder"))).toBe(
      PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR,
    );
    // Unknown / absent role falls back to the common node blue.
    expect(deriveViewportNodeColor(roleNode("c", "common"))).toBe(
      PHYLOVIZ_NODE_COMMON_COLOR,
    );
    expect(
      deriveViewportNodeColor({
        id: "x",
        cluster_id: "x",
        x: 0,
        y: 0,
        layout_status: "ready",
        member_count: 1,
        is_representative: false,
      }),
    ).toBe(PHYLOVIZ_NODE_COMMON_COLOR);
    // A selected node overrides its role with the selected red.
    expect(
      deriveViewportNodeColor({
        ...roleNode("sel", "group founder"),
        metadata: { phyloviz_role: "group founder", selected: true },
      }),
    ).toBe(PHYLOVIZ_NODE_SELECTED_COLOR);
  });

  it("applies role colors to leaf nodes while representatives keep their tone", () => {
    const graph = new Graph();
    const response = {
      ...VIEWPORT_RESPONSE,
      nodes: [
        {
          id: "founder",
          cluster_id: "founder",
          x: 0,
          y: 0,
          layout_status: "ready" as const,
          member_count: 1,
          is_representative: false,
          metadata: { phyloviz_role: "group_founder" },
        },
        VIEWPORT_RESPONSE.nodes[1],
      ],
      edges: [],
    };

    syncGraphologyViewport(graph, response);

    expect(graph.getNodeAttribute("founder", "color")).toBe(
      PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR,
    );
    // The representative (triangle) keeps its distinct tone, not a role color.
    expect(graph.getNodeAttribute("cluster_b", "color")).toBe(
      GRAPH_VIEWER_REPRESENTATIVE_COLOR,
    );
  });

  it("carries meta-edge fields into graphology edge attributes", () => {
    const graph = new Graph();
    const response = {
      ...VIEWPORT_RESPONSE,
      nodes: [
        ...VIEWPORT_RESPONSE.nodes,
        {
          id: "cluster_c",
          cluster_id: "cluster_c",
          x: 40,
          y: 0,
          layout_status: "ready" as const,
          member_count: 5,
          is_representative: true,
        },
      ],
      edges: [
        { id: "edge_a_b", source: "a", target: "cluster_b", distance: 3 },
        {
          id: "meta_edge:a:cluster_c",
          source: "a",
          target: "cluster_c",
          distance: 2,
          is_meta: true,
          bundled_edge_count: 4,
        },
      ],
    };

    syncGraphologyViewport(graph, response);

    // Meta-edge carries its provenance attributes.
    expect(graph.getEdgeAttribute("meta_edge:a:cluster_c", "isMeta")).toBe(true);
    expect(
      graph.getEdgeAttribute("meta_edge:a:cluster_c", "bundledEdgeCount"),
    ).toBe(4);
    // Ordinary edges stay non-meta with no bundled count.
    expect(graph.getEdgeAttribute("edge_a_b", "isMeta")).toBe(false);
    expect(
      graph.getEdgeAttribute("edge_a_b", "bundledEdgeCount"),
    ).toBeUndefined();
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

  it("suspends nodeDropped/edgeDropped listeners during a large reconcile", () => {
    const graph = new Graph();
    // Seed a large stale graph so a naive per-drop re-index would fire
    // thousands of events. Each stale node is connected to the next to build a
    // matching set of stale edges.
    const staleCount = 2000;
    for (let i = 0; i < staleCount; i += 1) {
      graph.addNode(`stale_${i}`, { x: i, y: i });
    }
    for (let i = 0; i < staleCount - 1; i += 1) {
      graph.addEdgeWithKey(`stale_edge_${i}`, `stale_${i}`, `stale_${i + 1}`);
    }

    // Attach the same listeners Sigma installs; each would normally trigger a
    // full O(N+E) re-index per drop.
    const nodeDropped = vi.fn();
    const edgeDropped = vi.fn();
    graph.on("nodeDropped", nodeDropped);
    graph.on("edgeDropped", edgeDropped);

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE);
    reconcileGraphologyViewport(graph, VIEWPORT_RESPONSE);

    // No per-drop events fired during the batch, even though ~2000 nodes and
    // ~2000 edges were removed.
    expect(nodeDropped).not.toHaveBeenCalled();
    expect(edgeDropped).not.toHaveBeenCalled();

    // The stale graph was fully reconciled to the response.
    expect(graph.hasNode("stale_0")).toBe(false);
    expect(graph.hasEdge("stale_edge_0")).toBe(false);
    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);

    // The listeners are restored, so future mutations are still tracked.
    graph.dropNode("a");
    expect(nodeDropped).toHaveBeenCalledTimes(1);
  });

  it("expands viewport bounds with spatial padding", () => {
    expect(
      expandViewportBounds(
        { xmin: 0, xmax: 100, ymin: -50, ymax: 50 },
        0.5,
      ),
    ).toEqual({ xmin: -50, xmax: 150, ymin: -100, ymax: 100 });
  });

  it("debounces same-tier pans before loading and applying the viewport", async () => {
    const graph = new Graph();
    // A finer tier keeps pan-driven refetch active (LOD 0 pans are ignored as a
    // fixed global overview). ratio 0.7 sits in tier 1 with two tiers available.
    const { sigma, camera, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    const largeTreeResponse = {
      ...VIEWPORT_RESPONSE,
      total_node_count: GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD + 1,
    };
    const client: GraphClient = {
      readViewport: vi.fn(async () => largeTreeResponse),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      lodTierCount: 2,
    });

    viewer.mount();
    // Initial load is the forced-global LOD 0 overview.
    await vi.advanceTimersByTimeAsync(0);
    // Zoom into tier 1 so subsequent same-ratio pans are same-tier.
    setRatio(0.7);
    emitCameraUpdated();
    await vi.advanceTimersByTimeAsync(GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS);
    expect(client.readViewport).toHaveBeenCalledTimes(2);
    (client.readViewport as ReturnType<typeof vi.fn>).mockClear();

    // Two rapid same-tier pans collapse into one debounced query.
    emitCameraUpdated();
    emitCameraUpdated();

    await vi.advanceTimersByTimeAsync(249);
    expect(client.readViewport).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(client.readViewport).toHaveBeenCalledTimes(1);
    expect(client.readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        lod_level: 1,
        xmin: expect.any(Number),
      }),
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
      total_node_count: GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD + 1,
    };
    const client: GraphClient = {
      readViewport: vi.fn(async () => largeTreeResponse),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      lodTierCount: 2,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lod_level: 0 }),
    );

    // 0.7 is clear of the 0.8 boundary hysteresis dead-band, so the tier
    // actually crosses from 0 to 1 (0.79 would be held by hysteresis).
    setRatio(0.7);
    emitCameraUpdated();

    // LoD changes use a short debounce (not the full same-level delay, not 0ms
    // which would thrash the server on rapid zoom).
    await vi.advanceTimersByTimeAsync(GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS - 1);
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
    const client: GraphClient = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewer({
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

  it("freezes a loaded small tree across LoD tier boundaries", async () => {
    // A small tree is rendered whole on first paint, so there is nothing further
    // to fetch: crossing a tier boundary by zooming must NOT re-query — the
    // full tree is already on screen as individual nodes.
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    const client: GraphClient = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      lodTierCount: 2,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    // Zoom well past the 0.8 boundary (clear of the hysteresis dead-band) — a
    // large tree would transition LoD 0 → 1, but a loaded small tree stays put.
    setRatio(0.7);
    emitCameraUpdated();
    await vi.advanceTimersByTimeAsync(GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS);

    expect(client.readViewport).toHaveBeenCalledTimes(1);

    viewer.unmount();
  });

  it("keeps a loaded small tree at the finest tier when refreshed", async () => {
    // A visual-mapping change (e.g. selecting a metadata pie field) calls
    // refreshNow() to re-render. For a small tree that first painted whole at
    // the finest tier, this refresh must re-request the finest tier unbounded —
    // NOT snap back to the tier-0 triangle overview. Regression guard for the
    // "picking a pie field turns nodes into triangles" bug.
    const graph = new Graph();
    const { sigma } = fakeSigma(1.2);
    const client: GraphClient = {
      // total_node_count of 2 is well below the small-tree threshold.
      readViewport: vi.fn(async () => ({
        ...VIEWPORT_RESPONSE,
        total_node_count: 2,
      })),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      lodTierCount: 3,
      // Prepared count unknown up front; the small-tree state is instead
      // established from the loaded total_node_count on the first response.
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.readViewport).toHaveBeenCalledTimes(1);

    // Simulate updateVisualMapping's refresh after a pie-field selection.
    viewer.refreshNow();
    await vi.runOnlyPendingTimersAsync();

    expect(client.readViewport).toHaveBeenCalledTimes(2);
    const refreshQuery = (client.readViewport as ReturnType<typeof vi.fn>).mock
      .calls[1][0];
    // Finest of the 3 tiers, unbounded — the whole tree as individual nodes,
    // never the tier-0 overview that would introduce triangle representatives.
    expect(refreshQuery.lod_level).toBe(2);
    expect(refreshQuery.xmin).toBeUndefined();
    expect(refreshQuery.xmax).toBeUndefined();
    expect(refreshQuery.ymin).toBeUndefined();
    expect(refreshQuery.ymax).toBeUndefined();

    viewer.unmount();
  });

  it("loads a known small tree at the finest tier with no bounds", async () => {
    // When the prepared node count is known to be small, the initial load must
    // request the finest precomputed tier (individual nodes, no cluster proxies)
    // and carry no bounds so the whole tree renders at once.
    const graph = new Graph();
    const { sigma } = fakeSigma(1.2);
    const client: GraphClient = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      lodTierCount: 3,
      // Well below the default small-tree threshold.
      nodeCount: 2,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.readViewport).toHaveBeenCalledTimes(1);
    const query = (client.readViewport as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // Finest of the 3 tiers, unbounded.
    expect(query.lod_level).toBe(2);
    expect(query.xmin).toBeUndefined();
    expect(query.xmax).toBeUndefined();

    viewer.unmount();
  });

  it("refetches a bounded slice on a same-tier pan at a finer LoD level", async () => {
    // At LOD > 0 the query is bounds-driven, so panning to a new region must
    // fetch the nodes the camera moved onto instead of freezing on the current
    // slice. A large tree keeps semantic zooming active.
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    const largeTreeResponse = {
      ...VIEWPORT_RESPONSE,
      total_node_count: GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD + 1,
    };
    const client: GraphClient = {
      readViewport: vi.fn(async () => largeTreeResponse),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 250,
      lodTierCount: 2,
    });

    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);

    // Zoom into the finer tier so subsequent queries carry bounds.
    setRatio(0.7);
    emitCameraUpdated();
    await vi.advanceTimersByTimeAsync(GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS);
    expect(client.readViewport).toHaveBeenCalledTimes(2);
    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lod_level: 1 }),
    );

    // A pure pan at the same finer tier (no ratio change) must still refetch a
    // bounded slice after the same-level debounce.
    emitCameraUpdated();
    await vi.advanceTimersByTimeAsync(250);
    expect(client.readViewport).toHaveBeenCalledTimes(3);
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

  it("does not refresh on camera movement while LoD playback is paused", async () => {
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
    const largeTreeResponse = {
      ...VIEWPORT_RESPONSE,
      total_node_count: GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD + 1,
    };
    let paused = false;
    const client: GraphClient = {
      readViewport: vi.fn(async () => largeTreeResponse),
    };
    const viewer = new GraphViewer({
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
    const client: GraphClient = {
      readViewport: vi.fn(async () => ({
        ...VIEWPORT_RESPONSE,
        lod_level: 0,
      })),
    };
    const viewer = new GraphViewer({
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

  it("loads cluster members without moving the camera when clicking a representative", async () => {
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
    const client: GraphClient = {
      readViewport: vi
        .fn()
        .mockResolvedValueOnce({ ...VIEWPORT_RESPONSE, lod_level: 0 })
        .mockResolvedValueOnce(clusterResponse),
    };
    const onGraphSynced = vi.fn();
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: sigma as never,
      debounceMs: 0,
      onGraphSynced,
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
      GRAPH_VIEWER_NODE_COLOR,
    );
    expect(graph.getNodeAttribute("b1", "type")).toBeUndefined();
    expect(graph.hasEdge("edge_b1_b2")).toBe(true);
    expect(onGraphSynced).toHaveBeenLastCalledWith(clusterResponse);
    // Expanding a cluster adds members in place; the camera must stay put so
    // the surrounding graph remains visible and the user can keep expanding.
    expect(camera.animate).not.toHaveBeenCalled();

    viewer.unmount();
  });
});

describe("GraphViewer collapse gesture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    edges: [{ id: "edge_b1_b2", source: "b1", target: "b2", distance: 1 }],
  };

  async function mountAndExpand() {
    const graph = new Graph();
    const rig = fakeSigma(0.5);
    const client: GraphClient = {
      readViewport: vi
        .fn()
        .mockResolvedValueOnce({ ...VIEWPORT_RESPONSE, lod_level: 0 })
        .mockResolvedValue(clusterResponse),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: rig.sigma as never,
      debounceMs: 0,
    });
    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);
    rig.emitNodeClick("cluster_b");
    await vi.runOnlyPendingTimersAsync();
    return { graph, client, viewer, ...rig };
  }

  it("collapses an expanded cluster back to its representative on double-click", async () => {
    const { graph, viewer, emitNodeDoubleClick } = await mountAndExpand();
    // Expanded: members present, proxy + boundary edge still there (additive).
    expect(graph.hasNode("b1")).toBe(true);
    expect(graph.hasNode("b2")).toBe(true);

    emitNodeDoubleClick("cluster_b");

    // Members dropped; representative proxy restored with its attributes and
    // its boundary edge to "a".
    expect(graph.hasNode("b1")).toBe(false);
    expect(graph.hasNode("b2")).toBe(false);
    expect(graph.hasNode("cluster_b")).toBe(true);
    expect(graph.getNodeAttribute("cluster_b", "color")).toBe(
      GRAPH_VIEWER_REPRESENTATIVE_COLOR,
    );
    expect(graph.getNodeAttribute("cluster_b", "member_count")).toBe(12);
    expect(graph.hasEdge("edge_a_b")).toBe(true);

    viewer.unmount();
  });

  it("does not issue a server query when collapsing (restores from cache)", async () => {
    const { client, viewer, emitNodeDoubleClick } = await mountAndExpand();
    const callsBeforeCollapse = (client.readViewport as ReturnType<typeof vi.fn>)
      .mock.calls.length;

    emitNodeDoubleClick("cluster_b");

    expect(
      (client.readViewport as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsBeforeCollapse);

    viewer.unmount();
  });

  it("is reversible: expand -> collapse -> expand restores members", async () => {
    const { graph, viewer, emitNodeClick, emitNodeDoubleClick } =
      await mountAndExpand();

    emitNodeDoubleClick("cluster_b");
    expect(graph.hasNode("cluster_b")).toBe(true);
    expect(graph.hasNode("b1")).toBe(false);

    emitNodeClick("cluster_b");
    await vi.runOnlyPendingTimersAsync();
    expect(graph.hasNode("b1")).toBe(true);
    expect(graph.hasNode("b2")).toBe(true);

    viewer.unmount();
  });

  it("collapseCluster is a no-op for a cluster that was never expanded", async () => {
    const graph = new Graph();
    const rig = fakeSigma(0.5);
    const client: GraphClient = {
      readViewport: vi.fn(async () => ({ ...VIEWPORT_RESPONSE, lod_level: 0 })),
    };
    const viewer = new GraphViewer({
      datasetId: "tree",
      client,
      graph,
      sigma: rig.sigma as never,
      debounceMs: 0,
    });
    viewer.mount();
    await vi.advanceTimersByTimeAsync(0);

    // "cluster_b" is present as a proxy but was never expanded via a click.
    expect(graph.hasNode("cluster_b")).toBe(true);
    viewer.collapseCluster("cluster_b");
    // Untouched: proxy and its edge remain, nothing dropped or re-added.
    expect(graph.hasNode("cluster_b")).toBe(true);
    expect(graph.hasEdge("edge_a_b")).toBe(true);

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

describe("GraphViewer metadata-driven sync", () => {
  it("derives node color and size from metadata when a visual mapping is active", () => {
    const graph = new Graph();

    syncGraphologyViewport(
      graph,
      METADATA_VIEWPORT_RESPONSE,
      COLOR_SIZE_SETTINGS,
    );

    // Colors come from the categorical color field, ranked by graph-wide
    // frequency and assigned palette entries in order (ties broken by label, so
    // "eu" -> palette[0], "us" -> palette[1]). Distinct values, distinct colors.
    const rankedColor = buildValueColorMap(["eu", "us"], DEFAULT_COLOR_PALETTE);
    expect(graph.getNodeAttribute("a", "color")).toBe(rankedColor("eu"));
    expect(graph.getNodeAttribute("b", "color")).toBe(rankedColor("us"));
    expect(graph.getNodeAttribute("a", "color")).not.toBe(
      graph.getNodeAttribute("b", "color"),
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

  it("keeps role color for nodes with no value for the color field", () => {
    // A node that has no value for the active color field must NOT be painted a
    // palette slot (which could coincidentally match a real value's slate) — it
    // keeps its PHYLOViZ role color. Only nodes WITH a value get palette colors.
    const graph = new Graph();
    const responseWithEmpty = {
      ...METADATA_VIEWPORT_RESPONSE,
      nodes: [
        ...METADATA_VIEWPORT_RESPONSE.nodes,
        {
          id: "empty",
          cluster_id: "cempty",
          x: 40,
          y: 0,
          layout_status: "ready" as const,
          member_count: 1,
          is_representative: false,
          metadata: { distance: 5 },
        },
      ],
    };

    syncGraphologyViewport(graph, responseWithEmpty, COLOR_SIZE_SETTINGS);

    // The empty-field node keeps the common-node role color, not a palette slot.
    expect(graph.getNodeAttribute("empty", "color")).toBe(
      GRAPH_VIEWER_NODE_COLOR,
    );
    // Nodes WITH a value are still coloured by the ranked palette.
    const rankedColor = buildValueColorMap(["eu", "us"], DEFAULT_COLOR_PALETTE);
    expect(graph.getNodeAttribute("a", "color")).toBe(rankedColor("eu"));
  });

  it("leaves the default representative styling intact without a mapping", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE);

    expect(graph.getNodeAttribute("a", "color")).toBe(GRAPH_VIEWER_NODE_COLOR);
    expect(graph.getNodeAttribute("cluster_b", "color")).toBe(
      GRAPH_VIEWER_REPRESENTATIVE_COLOR,
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

describe("GraphViewer display options under LoD", () => {
  it("labels leaves and hides edge labels/weighting by default", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE);

    // Leaf keeps its id label; representative (triangle) stays unlabeled.
    expect(graph.getNodeAttribute("a", "label")).toBe("a");
    expect(graph.getNodeAttribute("cluster_b", "label")).toBe("");
    // No display options => no edge distance labels and base (unweighted) size.
    expect(graph.getEdgeAttribute("edge_a_b", "label")).toBe("");
    expect(graph.getEdgeAttribute("edge_a_b", "forceLabel")).toBe(false);
    expect(graph.getEdgeAttribute("edge_a_b", "size")).toBe(1);
  });

  it("blanks leaf labels when node labels are disabled", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE, {
      displayOptions: { nodeLabels: false },
    });

    expect(graph.getNodeAttribute("a", "label")).toBe("");
    // Representatives were already unlabeled regardless of the toggle.
    expect(graph.getNodeAttribute("cluster_b", "label")).toBe("");
  });

  it("shows edge distance labels when the option is enabled", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE, {
      displayOptions: { edgeDistanceLabels: true },
    });

    expect(graph.getEdgeAttribute("edge_a_b", "label")).toBe("3");
    expect(graph.getEdgeAttribute("edge_a_b", "forceLabel")).toBe(true);
  });

  it("widens edges by distance when distance weighting is enabled", () => {
    const graph = new Graph();

    syncGraphologyViewport(graph, VIEWPORT_RESPONSE, {
      displayOptions: { distanceWeightedEdges: true },
    });

    // Base size (1) widened by log1p(distance); strictly larger than the base.
    expect(
      graph.getEdgeAttribute("edge_a_b", "size") as number,
    ).toBeGreaterThan(1);
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

describe("GraphViewer pie mapping under LoD", () => {
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

describe("GraphViewer sync lifecycle hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes onGraphSynced after the graph is populated and before Sigma refresh", async () => {
    const graph = new Graph();
    const { sigma } = fakeSigma(2);
    const client: GraphClient = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    let nodeCountAtSync = -1;
    let refreshCountAtSync = -1;
    const viewer = new GraphViewer({
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
    const client: GraphClient = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewer({
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
    const client: GraphClient = {
      readViewport: vi.fn(async () => VIEWPORT_RESPONSE),
    };
    const viewer = new GraphViewer({
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
