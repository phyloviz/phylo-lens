import { describe, expect, it, vi } from "vitest";

import { createGraphWorkbench, ERR_GRAPH_LOAD_SUPERSEDED } from "../src/app/workbench/graphWorkbench";
import type { GraphClient } from "../src/api/graphClient";
import type { GraphPrepareResponse, GraphViewportResponse } from "../src/api/graphContracts";
import type { GraphRenderer, RenderViewportSyncState, RendererFactory } from "../src/render/renderer.types";
import type { PositionedGraph } from "../src/contracts/positioned";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function prepareResponse(datasetId = "tree", layoutVersion = "layout-1"): GraphPrepareResponse {
  return {
    dataset_id: datasetId,
    layout_version: layoutVersion,
    node_count: 12_000,
    edge_count: 11_999,
    cluster_count: 400,
    lod_tier_count: 4,
    layout_status: "ready",
    warnings: [],
  };
}

function viewportResponse(datasetId = "tree", layoutVersion = "layout-1"): GraphViewportResponse {
  return {
    dataset_id: datasetId,
    layout_version: layoutVersion,
    lod_level: 0,
    zoom: 1,
    layout_status: "ready",
    truncated: false,
    total_node_count: 1,
    metadata_schema: [],
    nodes: [
      {
        id: datasetId,
        cluster_id: datasetId,
        x: 0,
        y: 0,
        layout_status: "ready",
        member_count: 1,
        is_representative: false,
      },
    ],
    edges: [],
  };
}

function createWorkbenchHarness(overrides: Partial<GraphClient> = {}) {
  const viewportState: RenderViewportSyncState = {
    bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
    cameraRatio: 1,
  };
  const renderer: GraphRenderer = {
    mount: vi.fn(),
    unmount: vi.fn(),
    render: vi.fn(),
    focusNode: vi.fn(),
    getViewportSyncState: vi.fn(() => viewportState),
    applyGraphSnapshot: vi.fn(),
    fitGraphSnapshot: vi.fn(() => null),
    setViewChangeHandler: vi.fn(),
    setNodeClickHandler: vi.fn(),
    setNodeDoubleClickHandler: vi.fn(),
  };
  const rendererFactory: RendererFactory = {
    createRenderer: vi.fn(() => renderer),
  };
  const graphClient = {
    prepareGraph: vi.fn(async () => prepareResponse()),
    readViewport: vi.fn(async () => viewportResponse()),
    searchGraph: vi.fn(),
    readRegion: vi.fn(),
    ...overrides,
  } as unknown as GraphClient;

  return {
    graphClient,
    renderer,
    workbench: createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererKind: "sigma",
      renderContext: { container: document.createElement("div") },
    }),
  };
}

describe("graphWorkbench navigation", () => {
  it("resolves renderNewick only after prepare, first viewport, and renderer update", async () => {
    const events: string[] = [];
    const { renderer, workbench } = createWorkbenchHarness({
      prepareGraph: vi.fn(async () => {
        events.push("prepare");
        return prepareResponse();
      }),
      readViewport: vi.fn(async () => {
        events.push("viewport");
        return viewportResponse();
      }),
    } as Partial<GraphClient>);
    vi.mocked(renderer.applyGraphSnapshot).mockImplementation(() => {
      events.push("renderer");
    });

    await workbench.renderNewick("(a:1,b:1)root;", "tree");
    events.push("resolved");

    expect(events).toEqual(["prepare", "viewport", "renderer", "resolved"]);
  });

  it("rejects renderNewick when the first viewport fails", async () => {
    const { renderer, workbench } = createWorkbenchHarness({
      readViewport: vi.fn(async () => {
        throw new Error("viewport failed");
      }),
    } as Partial<GraphClient>);

    await expect(workbench.renderNewick("(a:1,b:1)root;", "tree")).rejects.toThrow("viewport failed");
    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it("prevents an older overlapping load from replacing a newer graph", async () => {
    vi.useFakeTimers();
    const firstPrepare = deferred<GraphPrepareResponse>();
    const secondPrepare = deferred<GraphPrepareResponse>();
    const secondViewport = deferred<GraphViewportResponse>();
    const { graphClient, renderer, workbench } = createWorkbenchHarness({
      prepareGraph: vi.fn().mockReturnValueOnce(firstPrepare.promise).mockReturnValueOnce(secondPrepare.promise),
      readViewport: vi.fn(() => secondViewport.promise),
    } as Partial<GraphClient>);

    try {
      const firstLoad = workbench.renderNewick("(a:1)b;", "first");
      const secondLoad = workbench.renderNewick("(c:1)d;", "second");

      secondPrepare.resolve(prepareResponse("second-tree", "layout-2"));
      await vi.advanceTimersByTimeAsync(0);
      secondViewport.resolve(viewportResponse("second-tree", "layout-2"));
      await secondLoad;
      firstPrepare.resolve(prepareResponse("first-tree", "layout-1"));

      await expect(firstLoad).rejects.toThrow(ERR_GRAPH_LOAD_SUPERSEDED);
      expect(graphClient.readViewport).toHaveBeenCalledTimes(1);
      expect(renderer.applyGraphSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ nodes: [expect.objectContaining({ id: "second-tree" })] }) as PositionedGraph,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates pending loads when disposed during prepare", async () => {
    const prepare = deferred<GraphPrepareResponse>();
    const { renderer, workbench } = createWorkbenchHarness({
      prepareGraph: vi.fn(() => prepare.promise),
    } as Partial<GraphClient>);

    const load = workbench.renderNewick("(a:1)b;", "tree");
    workbench.dispose();
    prepare.resolve(prepareResponse());

    await expect(load).rejects.toThrow(ERR_GRAPH_LOAD_SUPERSEDED);
    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it("invalidates pending loads when disposed during the initial viewport", async () => {
    vi.useFakeTimers();
    const viewport = deferred<GraphViewportResponse>();
    const { renderer, workbench } = createWorkbenchHarness({
      readViewport: vi.fn(() => viewport.promise),
    } as Partial<GraphClient>);

    try {
      const load = workbench.renderNewick("(a:1)b;", "tree");
      await vi.advanceTimersByTimeAsync(0);
      workbench.dispose();
      viewport.resolve(viewportResponse());

      await expect(load).rejects.toThrow(ERR_GRAPH_LOAD_SUPERSEDED);
      expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the matched cluster when search focus uses coordinates outside the current slice", async () => {
    const renderer: GraphRenderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      focusNode: vi.fn(),
      centerOnNode: vi.fn(() => false),
      centerOnCoordinates: vi.fn(() => true),
      getViewportSyncState: vi.fn(() => ({
        bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
        cameraRatio: 1,
      })),
      applyGraphSnapshot: vi.fn(),
      fitGraphSnapshot: vi.fn(() => null),
      setNodeClickHandler: vi.fn(),
      setNodeDoubleClickHandler: vi.fn(),
    };
    const rendererFactory: RendererFactory = {
      createRenderer: vi.fn(() => renderer),
    };
    const graphClient = {
      prepareGraph: vi.fn(async () => ({
        dataset_id: "tree",
        layout_version: "layout-1",
        node_count: 12_000,
        edge_count: 11_999,
        cluster_count: 400,
        lod_tier_count: 4,
        layout_status: "ready",
        warnings: [],
      })),
      searchGraph: vi.fn(),
      readViewport: vi.fn(async () => ({
        dataset_id: "tree",
        layout_version: "layout-1",
        lod_level: null,
        zoom: 1,
        layout_status: "ready",
        truncated: false,
        total_node_count: 2,
        metadata_schema: [],
        nodes: [
          {
            id: "missing-node",
            cluster_id: "cluster-42",
            x: 42,
            y: 84,
            layout_status: "ready",
            member_count: 1,
            is_representative: false,
          },
        ],
        edges: [],
      })),
      readRegion: vi.fn(),
    } as unknown as GraphClient;
    const workbench = createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererKind: "sigma",
      renderContext: { container: document.createElement("div") },
    });

    await workbench.renderNewick("(a:1,b:1)root;", "tree");
    vi.mocked(renderer.focusNode).mockClear();
    vi.mocked(graphClient.readViewport).mockClear();
    await workbench.focusNode("missing-node", { x: 42, y: 84, clusterId: "cluster-42" });

    expect(renderer.focusNode).toHaveBeenCalledWith("missing-node");
    expect(renderer.centerOnNode).toHaveBeenCalledWith("missing-node");
    expect(renderer.centerOnCoordinates).toHaveBeenCalledWith(42, 84);
    await Promise.resolve();
    expect(graphClient.readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster_id: "cluster-42",
        focus_node_id: "missing-node",
      }),
    );
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ id: "missing-node" })],
      }) as PositionedGraph,
    );
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ id: "missing-node" })],
      }),
      { resetFirst: false },
    );

    await workbench.focusNode("missing-node", { x: 42, y: 84, clusterId: "cluster-42" });

    expect(renderer.focusNode).toHaveBeenCalledTimes(1);
    expect(renderer.centerOnNode).toHaveBeenCalledTimes(1);
    expect(renderer.centerOnCoordinates).toHaveBeenCalledTimes(1);
    expect(graphClient.readViewport).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous viewport sync session when a second dataset is loaded", async () => {
    vi.useFakeTimers();
    const viewHandlers: Array<(() => void) | null> = [];
    const renderer: GraphRenderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      focusNode: vi.fn(),
      getViewportSyncState: vi.fn(() => ({
        bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
        cameraRatio: 0.1,
      })),
      applyGraphSnapshot: vi.fn(),
      fitGraphSnapshot: vi.fn(() => null),
      setViewChangeHandler: vi.fn((handler) => {
        viewHandlers.push(handler as (() => void) | null);
      }),
      setNodeClickHandler: vi.fn(),
      setNodeDoubleClickHandler: vi.fn(),
    };
    const rendererFactory: RendererFactory = {
      createRenderer: vi.fn(() => renderer),
    };
    const graphClient = {
      prepareGraph: vi
        .fn()
        .mockResolvedValueOnce({
          dataset_id: "first-tree",
          layout_version: "layout-1",
          node_count: 12_000,
          edge_count: 11_999,
          cluster_count: 400,
          lod_tier_count: 4,
          layout_status: "ready",
          warnings: [],
        })
        .mockResolvedValueOnce({
          dataset_id: "second-tree",
          layout_version: "layout-2",
          node_count: 12_000,
          edge_count: 11_999,
          cluster_count: 400,
          lod_tier_count: 4,
          layout_status: "ready",
          warnings: [],
        }),
      searchGraph: vi.fn(),
      readViewport: vi.fn(async (query: { dataset_id: string; layout_version?: string | null }) => ({
        dataset_id: query.dataset_id,
        layout_version: query.layout_version ?? "layout",
        lod_level: 0,
        zoom: 1,
        layout_status: "ready",
        truncated: false,
        total_node_count: 1,
        metadata_schema: [],
        nodes: [
          {
            id: query.dataset_id,
            cluster_id: query.dataset_id,
            x: 0,
            y: 0,
            layout_status: "ready",
            member_count: 1,
            is_representative: false,
          },
        ],
        edges: [],
      })),
      readRegion: vi.fn(),
    } as unknown as GraphClient;
    const workbench = createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererKind: "sigma",
      renderContext: { container: document.createElement("div") },
    });

    try {
      const firstLoad = workbench.renderNewick("(a:1)b;", "first");
      await vi.advanceTimersByTimeAsync(0);
      await firstLoad;
      const firstHandler = viewHandlers.find((handler): handler is () => void => typeof handler === "function");

      const secondLoad = workbench.renderNewick("(c:1)d;", "second");
      await vi.advanceTimersByTimeAsync(0);
      await secondLoad;
      vi.mocked(graphClient.readViewport).mockClear();

      firstHandler?.();
      await vi.advanceTimersByTimeAsync(200);
      expect(graphClient.readViewport).not.toHaveBeenCalled();

      viewHandlers.at(-1)?.();
      await vi.advanceTimersByTimeAsync(60);
      expect(graphClient.readViewport).toHaveBeenCalledWith(
        expect.objectContaining({
          dataset_id: "second-tree",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
