import { describe, expect, it, vi } from "vitest";

import mockRenderer from "../src/render/adapters/mock/mockRenderer";
import { RENDERER_KIND_MOCK } from "../src/render/renderer.types";
import type { PositionedGraph } from "../src/contracts/positioned";

describe("mockRenderer", () => {
  const graph = {
    nodes: [{ id: "root", x: 0, y: 0 }],
    edges: [],
    viewMeta: { layout: "force", lodLevel: 0 },
  } as PositionedGraph;

  it("captures mount, render, and emitted events", () => {
    const renderer = mockRenderer();
    const viewHandler = vi.fn();
    const clickHandler = vi.fn();
    const doubleClickHandler = vi.fn();

    expect(renderer.kind).toBe(RENDERER_KIND_MOCK);

    const container = document.createElement("div");
    container.id = "graph-root";

    renderer.mount({ container });
    renderer.render(graph);
    renderer.applyGraphSnapshot?.(graph);
    renderer.setViewChangeHandler(viewHandler);
    renderer.setNodeClickHandler(clickHandler);
    renderer.setNodeDoubleClickHandler?.(doubleClickHandler);
    renderer.centerOnNode("root");
    renderer.centerOnCoordinates?.(5, 10);

    renderer.emitViewChange({
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      zoom: 2,
    });
    renderer.emitNodeClick({ nodeId: "root" });
    renderer.emitNodeDoubleClick({ nodeId: "root" });

    expect(renderer.getMountedContainerId()).toBe("graph-root");
    expect(renderer.getRenderedGraph()).toBe(graph);
    expect(renderer.getLastCenteredNodeId()).toBe("root");
    expect(renderer.getLastCenteredCoordinates()).toEqual({ x: 5, y: 10 });
    expect(renderer.getViewportSyncState?.()).toEqual({
      bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
      cameraRatio: 1,
    });
    expect(viewHandler).toHaveBeenCalledWith({
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      zoom: 2,
    });
    expect(clickHandler).toHaveBeenCalledWith({ nodeId: "root" });
    expect(doubleClickHandler).toHaveBeenCalledWith({ nodeId: "root" });

    renderer.unmount();

    expect(renderer.getMountedContainerId()).toBe("");
    expect(renderer.getRenderedGraph()).toBeNull();
    expect(renderer.getLastCenteredNodeId()).toBeNull();
    expect(renderer.getLastCenteredCoordinates()).toBeNull();
  });
});
