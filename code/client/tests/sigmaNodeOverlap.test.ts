import Graph from "graphology";
import type Sigma from "sigma";

import type { PositionedGraph } from "../src/contracts/positioned";
import {
  NODE_OVERLAP_MAX_DISPLACEMENT_PX,
  NODE_OVERLAP_PADDING_PX,
  nodeWithCachedOverlapPosition,
  removeRenderedNodeOverlaps,
} from "../src/render/adapters/sigma/sigmaNodeOverlap";

const IDENTITY_SIGMA = {
  graphToViewport: (point: { x: number; y: number }) => point,
  viewportToGraph: (point: { x: number; y: number }) => point,
} as Sigma;

describe("sigmaNodeOverlap", () => {
  it("separates rendered circles using their actual radii", () => {
    const graph = new Graph();
    graph.addNode("a", { x: 0, y: 0, size: 10 });
    graph.addNode("b", { x: 0, y: 0, size: 10 });
    const positionedGraph: PositionedGraph = {
      nodes: [
        { id: "a", x: 0, y: 0, size: 10 },
        { id: "b", x: 0, y: 0, size: 10 },
      ],
      edges: [],
      viewMeta: { layout: "server", lodLevel: 1 },
    };

    removeRenderedNodeOverlaps(graph, IDENTITY_SIGMA, positionedGraph);

    const deltaX =
      Number(graph.getNodeAttribute("b", "x")) -
      Number(graph.getNodeAttribute("a", "x"));
    const deltaY =
      Number(graph.getNodeAttribute("b", "y")) -
      Number(graph.getNodeAttribute("a", "y"));
    expect(Math.hypot(deltaX, deltaY)).toBeGreaterThanOrEqual(
      20 + NODE_OVERLAP_PADDING_PX - 0.01,
    );
  });

  it("keeps collision movement bounded around the global layout", () => {
    const graph = new Graph();
    for (let index = 0; index < 8; index += 1) {
      graph.addNode(String(index), { x: 0, y: 0, size: 10 });
    }
    const positionedGraph: PositionedGraph = {
      nodes: graph.nodes().map((id) => ({ id, x: 0, y: 0, size: 10 })),
      edges: [],
      viewMeta: { layout: "server", lodLevel: 1 },
    };

    removeRenderedNodeOverlaps(graph, IDENTITY_SIGMA, positionedGraph);

    graph.forEachNode((_nodeId, attributes) => {
      expect(Math.hypot(Number(attributes.x), Number(attributes.y))).toBeLessThanOrEqual(
        NODE_OVERLAP_MAX_DISPLACEMENT_PX + 0.01,
      );
    });
  });

  it("reuses a correction only while the server anchor remains unchanged", () => {
    const cache = new Map([
      [
        "a",
        {
          anchorX: 10,
          anchorY: 20,
          x: 14,
          y: 18,
        },
      ],
    ]);

    expect(
      nodeWithCachedOverlapPosition({ id: "a", x: 10, y: 20 }, cache),
    ).toMatchObject({ x: 14, y: 18 });
    expect(
      nodeWithCachedOverlapPosition({ id: "a", x: 11, y: 20 }, cache),
    ).toMatchObject({ x: 11, y: 20 });
  });
});
