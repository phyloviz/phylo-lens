import { describe, expect, it, vi } from "vitest";

import { drawTriangleNodeHover } from "../src/render/programs/triangleNodeProgram";

describe("drawTriangleNodeHover", () => {
  it("converts graph-space triangle rotation for the screen-space hover overlay", () => {
    const moveTo = vi.fn();
    const context = {
      beginPath: vi.fn(),
      moveTo,
      lineTo: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fill: vi.fn(),
      shadowBlur: 0,
      shadowColor: "",
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    drawTriangleNodeHover(context, {
      x: 20,
      y: 30,
      size: 10,
      color: "#93c5fd",
      triangleRotation: -Math.PI / 2,
    } as never);

    // The first vertex is the triangle point. Sigma flips graph-space Y for
    // the canvas overlay, so the hover rotation must be inverted.
    const firstPoint = moveTo.mock.calls[0] as [number, number];
    expect(firstPoint[1]).toBeGreaterThan(30);
  });
});
