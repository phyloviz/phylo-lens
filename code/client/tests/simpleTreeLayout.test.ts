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
  it("builds a force-directed graph with valid coordinates", () => {
    const graph = buildSimpleTreeLayout(FIXTURE_DATASET, {
      layerGap: 100,
      nodeGap: 80,
      forceIterations: 10,
    });

    const nodeById = Object.fromEntries(
      graph.nodes.map((node) => [node.id, node]),
    );

    expect(graph.viewMeta.layout).toBe("force");
    expect(Number.isFinite(nodeById["root"]?.x)).toBe(true);
    expect(Number.isFinite(nodeById["root"]?.y)).toBe(true);
    expect(Number.isFinite(nodeById["a"]?.x)).toBe(true);
    expect(Number.isFinite(nodeById["a1"]?.y)).toBe(true);
    expect(nodeById["a"]?.x).not.toBe(nodeById["b"]?.x);
    expect(graph.edges).toHaveLength(3);
  });
});
