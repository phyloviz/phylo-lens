import { describe, expect, it, vi } from "vitest";

import { createGraphWorkbench } from "../src/app/workbench/graphWorkbench";
import type { GraphClient } from "../src/api/graphClient";
import type { GraphRenderer, RendererFactory } from "../src/render/renderer.types";

describe("graphWorkbench navigation", () => {
  it("opens the matched cluster when search focus uses coordinates outside the current slice", async () => {
    const renderer: GraphRenderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      startGraphViewportSync: vi.fn(),
      focusNode: vi.fn(),
      centerOnNode: vi.fn(() => false),
      centerOnCoordinates: vi.fn(() => true),
      expandCluster: vi.fn(),
      refreshGraphViewportSync: vi.fn(),
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
      readViewport: vi.fn(),
      readRegion: vi.fn(),
    } as unknown as GraphClient;
    const workbench = createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererKind: "sigma",
      renderContext: { containerId: "graph" },
    });

    await workbench.renderNewick("(a:1,b:1)root;", "tree");
    vi.mocked(renderer.focusNode).mockClear();
    await workbench.focusNode("missing-node", { x: 42, y: 84, clusterId: "cluster-42" });

    expect(renderer.focusNode).toHaveBeenCalledWith("missing-node");
    expect(renderer.centerOnNode).toHaveBeenCalledWith("missing-node");
    expect(renderer.centerOnCoordinates).toHaveBeenCalledWith(42, 84);
    expect(renderer.expandCluster).toHaveBeenCalledWith("cluster-42", {
      fitToResponse: true,
      focusNodeId: "missing-node",
    });
    expect(renderer.refreshGraphViewportSync).not.toHaveBeenCalled();

    await workbench.focusNode("missing-node", { x: 42, y: 84, clusterId: "cluster-42" });

    expect(renderer.focusNode).toHaveBeenCalledTimes(1);
    expect(renderer.centerOnNode).toHaveBeenCalledTimes(1);
    expect(renderer.centerOnCoordinates).toHaveBeenCalledTimes(1);
    expect(renderer.expandCluster).toHaveBeenCalledTimes(1);
  });
});
