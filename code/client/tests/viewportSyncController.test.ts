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
    expect(onGraphSynced).toHaveBeenCalledWith(
      renderer.appliedGraphs[0],
      expect.objectContaining({ dataset_id: "tree" }),
    );
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
    controller.handleNodeClick({
      nodeId: "cluster-a",
      attributes: renderer.appliedGraphs.at(-1)?.nodes.find((node) => node.id === "cluster-a")?.attributes,
    });
    await Promise.resolve();

    expect(readViewport).toHaveBeenLastCalledWith(expect.objectContaining({ cluster_id: "cluster-a" }));
    expect(
      renderer.appliedGraphs
        .at(-1)
        ?.nodes.map((node) => node.id)
        .sort(),
    ).toEqual(["a1", "a2", "cluster-a", "root"]);

    controller.handleNodeDoubleClick({ nodeId: "cluster-a", attributes: { cluster_id: "cluster-a" } });

    expect(
      renderer.appliedGraphs
        .at(-1)
        ?.nodes.map((node) => node.id)
        .sort(),
    ).toEqual(["cluster-a", "root"]);
  });
});
