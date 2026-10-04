import type { Viewport } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";

export const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  width: 1000,
  height: 600,
};

export function createEmptyGraph(): PositionedGraph {
  return {
    nodes: [],
    edges: [],
    viewMeta: {
      layout: "force",
      lodLevel: 0,
      sliceNodeCount: 0,
      sliceEdgeCount: 0,
    },
  };
}
