import { buildMetadataIndex } from "../src/ancillary/metadataIndex";
import {
  CanonicalDataset,
  METADATA_TYPE_NUMBER,
  METADATA_TYPE_STRING,
  SOURCE_FORMAT_NEWICK,
} from "../src/contracts/canonical";
import { PositionedGraph } from "../src/contracts/positioned";
import { applyVisualMappings } from "../src/render/visualMappings";
import {
  PIE_ATTRIBUTE_PREFIX,
  PIE_PALETTE_ATTRIBUTE,
} from "../src/render/pieMapping";

const DATASET: CanonicalDataset = {
  dataset_id: "visual-dataset",
  nodes: [{ id: "a" }, { id: "b" }],
  edges: [{ id: "e_a_b_1", source: "a", target: "b" }],
  metadata_schema: [
    { key: "region", type: METADATA_TYPE_STRING },
    { key: "distance", type: METADATA_TYPE_NUMBER },
    { key: "trait_a", type: METADATA_TYPE_NUMBER },
  ],
  metadata_by_node_id: {
    a: { region: "EU", distance: 10, trait_a: 4 },
    b: { region: "US", distance: 30, trait_a: 8 },
  },
  source: {
    format: SOURCE_FORMAT_NEWICK,
    generated_at: "2026-03-27T00:00:00Z",
  },
};

const BASE_GRAPH: PositionedGraph = {
  nodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 100 },
  ],
  edges: [{ id: "e_a_b_1", source: "a", target: "b" }],
  viewMeta: { layout: "force", lodLevel: 0 },
};

describe("visualMappings", () => {
  it("applies color and size derived from metadata index", () => {
    const index = buildMetadataIndex(DATASET);
    const mapped = applyVisualMappings(BASE_GRAPH, DATASET, index, {
      colorField: "region",
      sizeField: "distance",
      pie: {
        fields: ["trait_a"],
        palette: ["#111111", "#222222"],
      },
    });

    expect(mapped.nodes[0]?.color).toBeDefined();
    expect(mapped.nodes[1]?.color).toBeDefined();
    expect(mapped.nodes[0]?.size).toBeLessThan(mapped.nodes[1]?.size ?? 0);
    expect(
      (mapped.nodes[0]?.attributes as Record<string, unknown>)?.dataset_id,
    ).toBe("visual-dataset");

    const nodeAttributes = mapped.nodes[0]?.attributes as Record<
      string,
      unknown
    >;
    const pieKeys = Object.keys(nodeAttributes).filter((key) =>
      key.startsWith(PIE_ATTRIBUTE_PREFIX),
    );

    expect(pieKeys).toContain(`${PIE_ATTRIBUTE_PREFIX}trait_a`);
    expect(Array.isArray(nodeAttributes?.[PIE_PALETTE_ATTRIBUTE])).toBe(true);
  });
});
