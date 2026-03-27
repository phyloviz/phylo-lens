import {
  ClientGraphFilterEngine,
  EMPTY_METADATA_FILTER_STATE,
  MetadataFilterState,
} from "../src/ancillary/filterEngine";
import { buildMetadataIndex } from "../src/ancillary/metadataIndex";
import { CanonicalDataset } from "../src/contracts/canonical";
import { PositionedGraph } from "../src/contracts/positioned";

const DATASET: CanonicalDataset = {
  dataset_id: "d1",
  nodes: [{ id: "root" }, { id: "a" }, { id: "b" }, { id: "c" }],
  edges: [
    { id: "e1", source: "root", target: "a" },
    { id: "e2", source: "root", target: "b" },
    { id: "e3", source: "root", target: "c" },
  ],
  metadata_schema: [
    { key: "region", type: "string" },
    { key: "distance", type: "number" },
  ],
  metadata_by_node_id: {
    root: { region: "EU", distance: 0 },
    a: { region: "EU", distance: 1 },
    b: { region: "AF", distance: 3 },
    c: { region: "AS", distance: 5 },
  },
  source: {
    format: "newick",
    generated_at: "2026-03-27T10:00:00+00:00",
  },
};

const GRAPH: PositionedGraph = {
  nodes: [
    { id: "root", x: 0, y: 0 },
    { id: "a", x: -1, y: -1 },
    { id: "b", x: 1, y: -1 },
    { id: "c", x: 2, y: -1 },
  ],
  edges: [
    { id: "e1", source: "root", target: "a" },
    { id: "e2", source: "root", target: "b" },
    { id: "e3", source: "root", target: "c" },
  ],
  viewMeta: { layout: "force", lodLevel: 0 },
};

describe("filterEngine", () => {
  it("returns full graph when no active filters exist", () => {
    const engine = new ClientGraphFilterEngine();
    const index = buildMetadataIndex(DATASET);

    const filtered = engine.apply(GRAPH, index, EMPTY_METADATA_FILTER_STATE);

    expect(filtered.nodes).toHaveLength(4);
    expect(filtered.edges).toHaveLength(3);
  });

  it("filters by categorical values and keeps only valid connecting edges", () => {
    const engine = new ClientGraphFilterEngine();
    const index = buildMetadataIndex(DATASET);
    const state: MetadataFilterState = {
      categorical: [{ fieldKey: "region", acceptedValues: ["EU"] }],
      numeric: [],
    };

    const filtered = engine.apply(GRAPH, index, state);

    expect(filtered.nodes.map((node) => node.id)).toEqual(["root", "a"]);
    expect(filtered.edges.map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("supports numeric range filtering", () => {
    const engine = new ClientGraphFilterEngine();
    const index = buildMetadataIndex(DATASET);
    const state: MetadataFilterState = {
      categorical: [],
      numeric: [{ fieldKey: "distance", min: 1, max: 3 }],
    };

    const filtered = engine.apply(GRAPH, index, state);

    expect(filtered.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(filtered.edges).toHaveLength(0);
  });
});
