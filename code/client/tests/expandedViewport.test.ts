import { describe, expect, it } from "vitest";
import { composeExpandedViewport } from "../src/app/workbench/viewport/expandedViewport";
import type { PositionedGraph } from "../src/contracts/positioned";

const graph = (nodes: PositionedGraph["nodes"], edges: PositionedGraph["edges"] = []): PositionedGraph => ({
  nodes,
  edges,
  viewMeta: { layout: "server", lodLevel: 2 },
});

describe("expanded viewport composition", () => {
  it("never replaces a detailed member with another patch's boundary representative", () => {
    const proxy = { id: "a", x: 0, y: 0, attributes: { is_cluster_proxy: true } };
    const member = { id: "a", x: 4, y: 5, attributes: { is_cluster_proxy: false } };
    const result = composeExpandedViewport(graph([proxy]), [graph([member]), graph([proxy])], 10);
    expect(result.graph.nodes).toEqual([member]);
    expect(result.graph.viewMeta.lodLevel).toBe(2);
  });

  it("caps the combined graph and removes edges with omitted endpoints", () => {
    const base = graph([{ id: "a", x: 0, y: 0 }]);
    const patch = graph(
      [
        { id: "b", x: 1, y: 1 },
        { id: "c", x: 2, y: 2 },
      ],
      [
        { id: "ab", source: "a", target: "b" },
        { id: "bc", source: "b", target: "c" },
      ],
    );
    const result = composeExpandedViewport(base, [patch], 2);
    expect(result.partial).toBe(true);
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(result.graph.edges.map((edge) => edge.id)).toEqual(["ab"]);
    expect(base.nodes).toHaveLength(1);
    expect(patch.nodes).toHaveLength(2);
  });
});
