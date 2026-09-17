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
      expect.any(Function),
    );
  });

  it.each([0, 50, 100])("cancels initial fits after %i ms without a late reset", async (elapsed) => {
    vi.useFakeTimers();
    const state = { x: 0.2, y: 0.8, ratio: 0.4, angle: 0 };
    const camera = { getState: () => state, animate: vi.fn(), animatedReset: vi.fn() };
    const sigma = {
      getCamera: () => camera,
      getDimensions: () => ({ width: 200, height: 100 }),
      graphToViewport: (point: { x: number; y: number }) => point,
      viewportToFramedGraph: (point: { x: number; y: number }) => point,
      refresh: vi.fn(),
    };
    try {
      const cancel = fitSigmaToGraphSnapshot(sigma as never, graph);
      await vi.advanceTimersByTimeAsync(elapsed);
      cancel?.();
      const calls = camera.animate.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(camera.animate).toHaveBeenCalledTimes(calls);
      expect(camera.animatedReset).not.toHaveBeenCalled();
      if (elapsed === 0) expect(calls).toBe(0);
      else expect(camera.animate).toHaveBeenLastCalledWith(state, { duration: 0 });
    } finally {
      vi.useRealTimers();
    }
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
        expect.any(Function),
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
        expect.any(Function),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
