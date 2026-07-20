import { describe, expect, it } from "vitest";

import { buildMetadataIndex, filterNodeIdsByFieldValues, getNodeMetadata } from "../src/ancillary/metadataIndex";
import { METADATA_TYPE_NUMBER, METADATA_TYPE_STRING, SOURCE_FORMAT_NEWICK } from "../src/contracts/models";
import type { CanonicalDataset } from "../src/contracts/models";

const DATASET: CanonicalDataset = {
  dataset_id: "meta-dataset",
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [],
  metadata_schema: [
    { key: "region", type: METADATA_TYPE_STRING },
    { key: "distance", type: METADATA_TYPE_NUMBER },
  ],
  metadata_by_node_id: {
    a: { region: "EU", distance: 10 },
    b: { region: "US", distance: 30 },
    c: { region: "EU", distance: 20 },
  },
  source: {
    format: SOURCE_FORMAT_NEWICK,
    generated_at: "2026-03-27T00:00:00Z",
  },
};

describe("metadataIndex", () => {
  it("builds fast lookups for metadata by node", () => {
    const index = buildMetadataIndex(DATASET);

    expect(getNodeMetadata(index, "a").region).toBe("EU");
    expect(getNodeMetadata(index, "missing")).toEqual({});
  });

  it("filters nodes by categorical metadata values", () => {
    const index = buildMetadataIndex(DATASET);
    const ids = filterNodeIdsByFieldValues(index, "region", ["EU"]);

    expect([...ids].sort()).toEqual(["a", "c"]);
  });

  it("computes numeric stats for size mappings", () => {
    const index = buildMetadataIndex(DATASET);
    const stats = index.numericStats.get("distance");

    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(30);
  });
});
