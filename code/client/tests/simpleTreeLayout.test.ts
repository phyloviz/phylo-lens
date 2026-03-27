import { buildSimpleTreeLayout } from "../src/layout/simpleTreeLayout";
import {
  CanonicalDataset,
  SOURCE_FORMAT_NEWICK,
} from "../src/contracts/canonical";

const FIXTURE_DATASET: CanonicalDataset = {
  dataset_id: "layout-tree",
  nodes: [{ id: "root" }, { id: "a" }, { id: "b" }, { id: "a1" }],
  edges: [
    { id: "e_root_a_1", source: "root", target: "a" },
    { id: "e_root_b_1", source: "root", target: "b" },
    { id: "e_a_a1_1", source: "a", target: "a1" },
  ],
  metadata_schema: [],
  metadata_by_node_id: {},
  source: {
    format: SOURCE_FORMAT_NEWICK,
    generated_at: "2026-03-23T12:00:00+00:00",
  },
};

describe("simpleTreeLayout", () => {
  it("assigns deterministic levels and coordinates", () => {
    const graph = buildSimpleTreeLayout(FIXTURE_DATASET, {
      layerGap: 100,
      nodeGap: 80,
    });

    const nodeById = Object.fromEntries(
      graph.nodes.map((node) => [node.id, node]),
    );

    expect(nodeById["root"]?.y).toBe(0);
    expect(nodeById["a"]?.y).toBe(100);
    expect(nodeById["b"]?.y).toBe(100);
    expect(nodeById["a1"]?.y).toBe(200);
    expect(nodeById["a"]?.x).toBe(-40);
    expect(nodeById["b"]?.x).toBe(40);
    expect(graph.edges).toHaveLength(3);
  });
});
