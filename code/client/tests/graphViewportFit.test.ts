import { describe, expect, it, vi } from "vitest";

import { fitSigmaToGraphSnapshot } from "../src/render/adapters/sigma/viewport/graphViewportFit";

const graph = {
  nodes: [
    { id: "left", x: 10, y: 0 },
    { id: "right", x: 20, y: 10 },
  ],
  edges: [],
  viewMeta: { layout: "server", lodLevel: 0 },
} as const;

describe("graphViewportFit", () => {
  it("fits graph snapshots using Sigma framed coordinates instead of raw graph coordinates", () => {
    const camera = {
      getState: () => ({ x: 0, y: 0, ratio: 2, angle: 0 }),
      animate: vi.fn(),
    };
    const sigma = {
      getCamera: () => camera,
      getDimensions: () => ({ width: 200, height: 100 }),
      graphToViewport: (point: { x: number; y: number }) => ({
        x: point.x * 10 + 7,
        y: point.y * 10 + 11,
      }),
      viewportToFramedGraph: (point: { x: number; y: number }) => ({
        x: (point.x - 7) / 100,
        y: (point.y - 11) / 100,
      }),
      viewportToGraph: (point: { x: number; y: number }) => point,
      refresh: vi.fn(),
      scheduleRender: vi.fn(),
    };

    fitSigmaToGraphSnapshot(sigma as never, graph, { resetFirst: false });

    expect(camera.animate).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 1.5,
        y: 0.5,
        ratio: expect.any(Number),
      }),
      { duration: 300 },
    );
  });

  it("zooms out before fitting a graph snapshot from a very deep camera zoom", async () => {
    vi.useFakeTimers();
    const camera = {
      getState: () => ({ x: -20, y: 12, ratio: 0.01, angle: 0 }),
      animate: vi.fn(),
    };
    const sigma = {
      getCamera: () => camera,
      getDimensions: () => ({ width: 200, height: 100 }),
      graphToViewport: (point: { x: number; y: number }) => ({
        x: point.x * 10,
        y: point.y * 10,
      }),
      viewportToFramedGraph: (point: { x: number; y: number }) => ({
        x: point.x / 100,
        y: point.y / 100,
      }),
      viewportToGraph: (point: { x: number; y: number }) => point,
      refresh: vi.fn(),
      scheduleRender: vi.fn(),
    };

    try {
      fitSigmaToGraphSnapshot(sigma as never, graph, { resetFirst: false });

      expect(camera.animate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          x: -20,
          y: 12,
          ratio: expect.any(Number),
        }),
        { duration: 140 },
      );

      await vi.advanceTimersByTimeAsync(140);

      expect(camera.animate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          x: 1.5,
          y: 0.5,
          ratio: expect.any(Number),
        }),
        { duration: 160 },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
