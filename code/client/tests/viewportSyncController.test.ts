import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphViewportQuery, GraphViewportResponse } from "../src/api/graphContracts";
import { ViewportSyncController } from "../src/app/workbench/viewport/viewportSyncController";
import type { PositionedGraph } from "../src/contracts/positioned";
import type { GraphRenderer, RenderViewportSyncState } from "../src/render/renderer.types";

let viewportState: RenderViewportSyncState;

function viewportResponse(overrides: Partial<GraphViewportResponse> = {}): GraphViewportResponse {
  return {
    dataset_id: "tree",
    layout_version: "layout-1",
    lod_level: 0,
    zoom: 1,
    layout_status: "ready",
    truncated: false,
    total_node_count: 2,
    global_bounds: { min_x: -100, max_x: 100, min_y: -50, max_y: 50 },
    metadata_schema: [],
    nodes: [
      {
        id: "root",
        cluster_id: "root",
        x: 0,
        y: 0,
        layout_status: "ready",
        member_count: 1,
        is_representative: false,
      },
      {
        id: "cluster-a",
        cluster_id: "cluster-a",
        x: 10,
        y: 0,
        layout_status: "ready",
        member_count: 3,
        is_representative: true,
      },
    ],
    edges: [{ id: "root-cluster-a", source: "root", target: "cluster-a" }],
    ...overrides,
  };
}

function clusterResponse(): GraphViewportResponse {
  return viewportResponse({
    nodes: [
      {
        id: "a1",
        cluster_id: "cluster-a",
        x: 9,
        y: 1,
        layout_status: "ready",
        member_count: 1,
        is_representative: false,
      },
      {
        id: "a2",
        cluster_id: "cluster-a",
        x: 11,
        y: -1,
        layout_status: "ready",
        member_count: 1,
        is_representative: false,
      },
    ],
    edges: [{ id: "a1-a2", source: "a1", target: "a2" }],
  });
}

function createRenderer(): GraphRenderer & {
  appliedGraphs: PositionedGraph[];
  emitViewChange: () => void;
} {
  let viewHandler: (() => void) | null = null;
  const renderer = {
    appliedGraphs: [] as PositionedGraph[],
    mount: vi.fn(),
    unmount: vi.fn(),
    render: vi.fn(),
    setViewChangeHandler: vi.fn((handler: (() => void) | null) => {
      viewHandler = handler;
    }),
    getViewportSyncState: vi.fn(() => viewportState),
    applyGraphSnapshot: vi.fn((graph: PositionedGraph) => {
      renderer.appliedGraphs.push(graph);
    }),
    fitGraphSnapshot: vi.fn(() => null),
    emitViewChange: () => viewHandler?.(),
  };
  return renderer;
}

describe("ViewportSyncController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewportState = {
      bounds: { xmin: -10, xmax: 10, ymin: -20, ymax: 20 },
      cameraRatio: 1,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drops old viewport responses and refreshes expanded clusters when adopting ancillary data", async () => {
    const renderer = createRenderer();
    let resolveOld: (response: GraphViewportResponse) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockResolvedValueOnce(clusterResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResponse>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementation(async (query: GraphViewportQuery) => ({
        ...(query.cluster_id ? clusterResponse() : viewportResponse()),
        layout_version: "metadata-1",
        nodes: (query.cluster_id ? clusterResponse() : viewportResponse()).nodes.map((node) => ({
          ...node,
          metadata: { country: "PT" },
        })),
      }));
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 3,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster("cluster-a");
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    const fits = vi.mocked(renderer.fitGraphSnapshot!).mock.calls.length;
    await controller.replaceLayoutVersion("metadata-1");
    const appliedCount = renderer.appliedGraphs.length;
    expect(renderer.appliedGraphs.at(-1)?.nodes.map((node) => node.id)).toContain("a1");
    controller.collapseCluster("cluster-a");
    resolveOld(viewportResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.appliedGraphs).toHaveLength(appliedCount + 1);
    const collapsed = renderer.appliedGraphs.at(-1)!;
    expect(collapsed.nodes.map((node) => node.id)).not.toContain("a1");
    expect(collapsed.nodes.find((node) => node.id === "cluster-a")?.attributes?.annotations).toMatchObject({
      ancillaryData: { country: "PT" },
    });
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledTimes(fits);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ layout_version: "metadata-1" }));
    controller.unmount();
  });

  it("does not apply a metadata viewport after disposal", async () => {
    const renderer = createRenderer();
    let resolveReplacement: (response: GraphViewportResponse) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResponse>((resolve) => {
            resolveReplacement = resolve;
          }),
      );
    const controller = new ViewportSyncController({ datasetId: "tree", client: { readViewport }, renderer });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const pending = controller.replaceLayoutVersion("metadata-1");
    const rejected = expect(pending).rejects.toThrow("superseded");
    controller.unmount();
    resolveReplacement(viewportResponse({ layout_version: "metadata-1" }));
    await rejected;
    expect(renderer.appliedGraphs).toHaveLength(1);
  });

  it("loads viewport responses and applies renderer-neutral graph snapshots", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const onGraphSynced = vi.fn();
    const controller = new ViewportSyncController({
      datasetId: "tree",
      layoutVersion: "layout-0",
      client: { readViewport },
      renderer,
      lodTierCount: 3,
      onGraphSynced,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_id: "tree",
        layout_version: "layout-0",
        lod_level: 0,
      }),
    );
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledWith(renderer.appliedGraphs[0]);
    expect(renderer.appliedGraphs[0]?.nodes.map((node) => node.id)).toEqual(["root", "cluster-a"]);
    expect(renderer.appliedGraphs[0]?.viewMeta.globalBounds).toEqual({
      minX: -100,
      maxX: 100,
      minY: -50,
      maxY: 50,
    });
    expect(onGraphSynced).toHaveBeenCalledWith(
      renderer.appliedGraphs[0],
      expect.objectContaining({ dataset_id: "tree" }),
    );
  });

  it("leaves the normal snapshot lifecycle unchanged when no observer is installed", async () => {
    const renderer = createRenderer();
    const nextSnapshotSequence = vi.fn(() => 1);
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      nextSnapshotSequence,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledOnce();
    expect(nextSnapshotSequence).not.toHaveBeenCalled();
  });

  it("reports an O(1) post-application boundary before deferred immutable diagnostics", async () => {
    const renderer = createRenderer();
    renderer.getInteractiveAggregateTargets = vi.fn(() => [
      { clusterId: "cluster-a", representedNodeCount: 3, clientX: 110, clientY: 90 },
    ]);
    const events: unknown[] = [];
    const order: string[] = [];
    vi.mocked(renderer.applyGraphSnapshot).mockImplementation((graph) => {
      renderer.appliedGraphs.push(graph);
      order.push("applied");
    });
    const controller = new ViewportSyncController({
      datasetId: "tree",
      layoutVersion: "layout-0",
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      snapshotObserver: (boundary, readDiagnostics) => {
        order.push("observed");
        expect(renderer.getInteractiveAggregateTargets).not.toHaveBeenCalled();
        events.push({ boundary, diagnostics: readDiagnostics() });
      },
      nextSnapshotSequence: () => 7,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(["applied", "observed"]);
    expect(events).toEqual([
      expect.objectContaining({
        boundary: {
          sequence: 7,
          reason: "initial_load",
          datasetId: "tree",
          layoutVersion: "layout-1",
          clusterId: null,
          visibleNodeCount: 2,
          visibleEdgeCount: 1,
          visiblePrimitiveCount: 3,
        },
        diagnostics: expect.objectContaining({
          visibleAggregateTriangleCount: 1,
          aggregateTargets: [
            expect.objectContaining({
              clusterId: "cluster-a",
              representedNodeCount: 3,
              clientX: 110,
              clientY: 90,
              structuralFingerprint: expect.any(String),
            }),
          ],
        }),
      }),
    ]);
    expect(Object.isFrozen((events[0] as { boundary: object }).boundary)).toBe(true);
  });

  it("isolates observer failures from the applied snapshot lifecycle", async () => {
    const renderer = createRenderer();
    const onGraphSynced = vi.fn();
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      snapshotObserver: () => {
        throw new Error("diagnostics failure");
      },
      nextSnapshotSequence: () => 1,
      onGraphSynced,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledOnce();
    expect(onGraphSynced).toHaveBeenCalledOnce();
  });

  it("isolates deferred diagnostics failures after the t3 boundary", async () => {
    const renderer = createRenderer();
    renderer.getInteractiveAggregateTargets = vi.fn(() => {
      throw new Error("target diagnostics failure");
    });
    const onGraphSynced = vi.fn();
    const diagnostics = vi.fn();
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport: vi.fn(async () => viewportResponse()) },
      renderer,
      snapshotObserver: (_boundary, readDiagnostics) => diagnostics(readDiagnostics()),
      nextSnapshotSequence: () => 1,
      onGraphSynced,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(diagnostics).toHaveBeenCalledWith(null);
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledOnce();
    expect(onGraphSynced).toHaveBeenCalledOnce();
  });

  it("keeps very large cluster representatives visually bounded", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () =>
      viewportResponse({
        nodes: [
          {
            id: "cluster-huge",
            cluster_id: "cluster-huge",
            x: 0,
            y: 0,
            layout_status: "ready",
            member_count: 97_000,
            is_representative: true,
          },
        ],
        edges: [],
      }),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(renderer.appliedGraphs[0]?.nodes[0]?.size).toBeLessThanOrEqual(6);
  });

  it("reads a bounded viewport when the renderer reports a camera change", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockClear();
    viewportState = {
      bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 },
      cameraRatio: 0.1,
    };

    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_id: "tree",
        xmin: expect.any(Number),
        xmax: expect.any(Number),
        ymin: expect.any(Number),
        ymax: expect.any(Number),
        lod_level: expect.any(Number),
      }),
    );
  });

  it("loads known medium-small datasets at the finest tier within the node budget", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      maxNodes: 6000,
      nodeCount: 6000,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset_id: "tree",
        lod_level: 3,
        max_nodes: 6000,
      }),
    );
    expect(readViewport.mock.calls[0]?.[0]).not.toHaveProperty("xmin");
  });

  it("suppresses older in-flight responses when a newer viewport request wins", async () => {
    const renderer = createRenderer();
    const pending: Array<(response: GraphViewportResponse) => void> = [];
    const readViewport = vi.fn(
      () =>
        new Promise<GraphViewportResponse>((resolve) => {
          pending.push(resolve);
        }),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()?.(viewportResponse({ layout_version: "initial" }));
    await Promise.resolve();
    vi.mocked(renderer.applyGraphSnapshot).mockClear();
    renderer.appliedGraphs = [];

    viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    controller.refreshNow({ lodLevel: "finest" });
    await vi.advanceTimersByTimeAsync(0);

    pending[1]?.(viewportResponse({ layout_version: "newer", nodes: [] }));
    await Promise.resolve();
    pending[0]?.(viewportResponse({ layout_version: "older" }));
    await Promise.resolve();

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.appliedGraphs[0]?.nodes).toEqual([]);
  });

  it("invalidates an in-flight viewport as soon as a newer camera query is scheduled", async () => {
    const renderer = createRenderer();
    const pending: Array<(response: GraphViewportResponse) => void> = [];
    const readViewport = vi.fn(() => new Promise<GraphViewportResponse>((resolve) => pending.push(resolve)));
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()!(viewportResponse());
    await Promise.resolve();
    viewportState.cameraRatio = 0.1;
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    const applied = renderer.appliedGraphs.length;
    viewportState.bounds = { xmin: 100, xmax: 200, ymin: -200, ymax: -100 };
    renderer.emitViewChange();
    pending.shift()!(viewportResponse({ nodes: [] }));
    await Promise.resolve();
    expect(renderer.appliedGraphs).toHaveLength(applied);
    await vi.advanceTimersByTimeAsync(120);
    pending.shift()!(viewportResponse({ nodes: [] }));
    await Promise.resolve();
    expect(renderer.appliedGraphs).toHaveLength(applied + 1);
    controller.unmount();
  });

  it("fetches the final camera position when input interrupts a fitted response", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn().mockResolvedValue(viewportResponse());
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow({ fitToResponse: true });
    await vi.advanceTimersByTimeAsync(0);
    const requests = readViewport.mock.calls.length;
    viewportState = { bounds: { xmin: 100, xmax: 200, ymin: -200, ymax: -100 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(readViewport).toHaveBeenCalledTimes(requests + 1);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ xmin: 50, xmax: 250 }));
    controller.unmount();
  });

  it("can expand a representative again after navigation replaces its expanded snapshot", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportQuery) =>
      query.cluster_id ? clusterResponse() : viewportResponse(),
    );
    const controller = new ViewportSyncController({ datasetId: "tree", client: { readViewport }, renderer });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const click = { nodeId: "cluster-a", attributes: { cluster_id: "cluster-a", is_cluster_proxy: true } };
    await controller.expandCluster(click.nodeId);
    await Promise.resolve();
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster(click.nodeId);
    await Promise.resolve();
    expect(readViewport.mock.calls.filter(([query]) => query.cluster_id)).toHaveLength(2);
    expect(renderer.appliedGraphs.at(-1)?.nodes.map((node) => node.id)).toContain("a1");
    controller.unmount();
  });

  it("keeps explicit patches across zoom-out queries until persistence is disabled", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportQuery) =>
      query.cluster_id ? clusterResponse() : viewportResponse({ lod_level: query.lod_level }),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      nodeCount: 10000,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    viewportState.cameraRatio = 0.1;
    controller.refreshNow({ lodLevel: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster("cluster-a");
    controller.setKeepExpanded(true);
    await vi.advanceTimersByTimeAsync(0);
    viewportState.cameraRatio = 2;
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(120);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lod_level: 2 }));
    expect(renderer.appliedGraphs.at(-1)?.nodes.map((node) => node.id)).toContain("a1");
    controller.collapseCluster("cluster-a");
    expect(renderer.appliedGraphs.at(-1)?.nodes.map((node) => node.id)).not.toContain("a1");
    controller.setKeepExpanded(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lod_level: 0 }));
    controller.unmount();
  });

  it("leaves a group's summary intact when its full expansion exceeds the budget", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn().mockResolvedValueOnce(viewportResponse()).mockResolvedValue(clusterResponse());
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      maxNodes: 3,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const result = await controller.expandCluster("cluster-a");
    expect(result).toMatchObject({ status: "partial", expandedClusterIds: [], renderedNodeCount: 2 });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map((node) => node.id)).toEqual(["root", "cluster-a"]);
    controller.unmount();
  });

  it("reports partial expand-all results and enforces the rendered node budget", async () => {
    const renderer = createRenderer();
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockResolvedValue(
        viewportResponse({
          ...clusterResponse(),
          total_node_count: 10000,
          truncated: true,
          nodes: [...viewportResponse().nodes, ...clusterResponse().nodes],
        }),
      );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      maxNodes: 3,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const result = await controller.expandAll();
    expect(result).toMatchObject({ status: "partial", allExpanded: false, renderedNodeCount: 3, maxNodes: 3 });
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lod_level: 3, max_nodes: 3 }));
    expect(readViewport.mock.calls.at(-1)?.[0]).not.toHaveProperty("xmin");
    controller.unmount();
  });

  it("does not restore expansion when a pending response arrives after collapse", async () => {
    const renderer = createRenderer();
    let resolve: (response: GraphViewportResponse) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResponse>((done) => {
            resolve = done;
          }),
      );
    const controller = new ViewportSyncController({ datasetId: "tree", client: { readViewport }, renderer });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    const pending = controller.expandCluster("cluster-a");
    controller.collapseCluster("cluster-a");
    resolve(clusterResponse());
    expect(await pending).toMatchObject({ status: "superseded", expandedClusterIds: [] });
    expect(renderer.appliedGraphs.at(-1)?.nodes.map((node) => node.id)).not.toContain("a1");
    controller.unmount();
  });

  it("retains a complete expand-all snapshot through zoom and ancillary replacement", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportQuery) =>
      viewportResponse({ layout_version: query.layout_version ?? "layout-1", lod_level: query.lod_level }),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      nodeCount: 10000,
      lodTierCount: 4,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.setKeepExpanded(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(await controller.expandAll()).toMatchObject({ status: "complete", allExpanded: true });
    const requests = readViewport.mock.calls.length;
    viewportState.cameraRatio = 4;
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(readViewport).toHaveBeenCalledTimes(requests);
    await controller.replaceLayoutVersion("ancillary-2");
    expect(controller.getExpansionState().allExpanded).toBe(true);
    expect(readViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ lod_level: 3, layout_version: "ancillary-2" }),
    );
    expect(await controller.collapseAll()).toMatchObject({ allExpanded: false, expandedClusterIds: [] });
    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ lod_level: 0 }));
    controller.unmount();
  });

  it("ignores stale responses after unmount", async () => {
    const renderer = createRenderer();
    let resolveResponse: (response: GraphViewportResponse) => void = () => undefined;
    const readViewport = vi.fn(
      () =>
        new Promise<GraphViewportResponse>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.unmount();
    resolveResponse(viewportResponse());
    await Promise.resolve();

    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it("does not refresh from camera changes while paused but refreshes predictably on resume", async () => {
    let paused = false;
    const renderer = createRenderer();
    const readViewport = vi.fn(async () => viewportResponse());
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      getPaused: () => paused,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockClear();
    viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };

    paused = true;
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(200);
    expect(readViewport).not.toHaveBeenCalled();

    paused = false;
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenCalledOnce();
  });

  it("fails predictably when a renderer cannot apply graph snapshots", async () => {
    const readViewport = vi.fn(async () => viewportResponse());
    const onError = vi.fn();
    const renderer: GraphRenderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      setViewChangeHandler: vi.fn(),
      getViewportSyncState: vi.fn(() => viewportState),
    };
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      onError,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Viewport sync requires a renderer that can apply graph snapshots.",
      }),
    );
  });

  it("expands and collapses representative clusters without renderer transport hooks", async () => {
    const renderer = createRenderer();
    const readViewport = vi.fn(async (query: GraphViewportQuery) =>
      query.cluster_id === "cluster-a" ? clusterResponse() : viewportResponse(),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster("cluster-a");
    await Promise.resolve();

    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ cluster_id: "cluster-a" }));
    expect(
      renderer.appliedGraphs
        .at(-1)
        ?.nodes.map((node) => node.id)
        .sort(),
    ).toEqual(["a1", "a2", "cluster-a", "root"]);

    readViewport.mockClear();
    await controller.expandCluster("cluster-a");
    await Promise.resolve();
    expect(readViewport).not.toHaveBeenCalled();

    controller.collapseCluster("cluster-a");

    expect(
      renderer.appliedGraphs
        .at(-1)
        ?.nodes.map((node) => node.id)
        .sort(),
    ).toEqual(["cluster-a", "root"]);
  });

  it("still expands a different eligible cluster immediately after another cluster is expanded", async () => {
    const renderer = createRenderer();
    const initial = viewportResponse({
      nodes: [
        ...viewportResponse().nodes,
        {
          id: "cluster-b",
          cluster_id: "cluster-b",
          x: -10,
          y: 0,
          layout_status: "ready",
          member_count: 4,
          is_representative: true,
        },
      ],
      edges: [...viewportResponse().edges, { id: "root-cluster-b", source: "root", target: "cluster-b" }],
    });
    const readViewport = vi.fn(async (query: GraphViewportQuery) => (query.cluster_id ? clusterResponse() : initial));
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    await controller.expandCluster("cluster-a");
    await Promise.resolve();
    readViewport.mockClear();

    await controller.expandCluster("cluster-b");
    await Promise.resolve();

    expect(readViewport).toHaveBeenCalledOnce();
    expect(readViewport).toHaveBeenCalledWith(expect.objectContaining({ cluster_id: "cluster-b" }));
  });

  it("labels viewport, expansion, and local collapse applications with monotonic sequences", async () => {
    const renderer = createRenderer();
    const events: Array<{ sequence: number; reason: string; clusterId: string | null }> = [];
    let nextSequence = 0;
    const readViewport = vi.fn(async (query: GraphViewportQuery) =>
      query.cluster_id === "cluster-a" ? clusterResponse() : viewportResponse(),
    );
    const controller = new ViewportSyncController({
      datasetId: "tree",
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      snapshotObserver: (boundary) => events.push(boundary),
      nextSnapshotSequence: () => ++nextSequence,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    await controller.expandCluster("cluster-a");
    await Promise.resolve();
    controller.collapseCluster("cluster-a");

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map((event) => event.reason)).toEqual([
      "initial_load",
      "viewport_sync",
      "cluster_expand",
      "cluster_collapse",
    ]);
    expect(events.at(-1)?.clusterId).toBe("cluster-a");
  });
});
