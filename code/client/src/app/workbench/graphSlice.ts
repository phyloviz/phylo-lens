import type { PositionedGraph } from "../../contracts/positioned";

export function emptyGraph(): PositionedGraph {
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
