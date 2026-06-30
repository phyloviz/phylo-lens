import Graph from "graphology";

import type { GraphV2Client } from "../src/api/graphV2Client";
import {
  buildGraphV2ViewportQuery,
  expandViewportBounds,
  GRAPH_VIEWER_V2_NODE_COLOR,
  GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR,
  GraphViewerV2,
  nodeSizeForMemberCount,
  semanticLodLevelForCameraRatio,
  syncGraphologyViewport,
} from "../src/render/adapters/sigma/GraphViewerV2";

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
    expect(nodeSizeForMemberCount(1)).toBe(5);
    expect(nodeSizeForMemberCount(12)).toBeLessThan(7);
    expect(nodeSizeForMemberCount(12_000)).toBeLessThanOrEqual(11);
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

  it("immediately fetches detailed nodes when Sigma ratio crosses the zoom-in threshold", async () => {
    const graph = new Graph();
    const { sigma, setRatio, emitCameraUpdated } = fakeSigma(1.2);
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
    expect(client.readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lod_level: 0 }),
    );

    setRatio(0.79);
    emitCameraUpdated();
    await vi.advanceTimersByTimeAsync(0);

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
