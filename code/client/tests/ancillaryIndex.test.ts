import { describe, expect, it } from "vitest";

import { buildAncillaryIndex, filterNodeIdsByFieldValues, getNodeAncillaryData } from "../src/ancillary/ancillaryIndex";
import { METADATA_TYPE_NUMBER, METADATA_TYPE_STRING, SOURCE_FORMAT_NEWICK } from "../src/contracts/models";
import type { CanonicalDataset } from "../src/contracts/models";

const DATASET: CanonicalDataset = {
  dataset_id: "meta-dataset",
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [],
  ancillarySchema: [
    { key: "region", type: METADATA_TYPE_STRING },
    { key: "distance", type: METADATA_TYPE_NUMBER },
  ],
  annotationsByNodeId: {
    a: {
      ancillaryData: { region: "EU", distance: 10 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
    b: {
      ancillaryData: { region: "US", distance: 30 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
    c: {
      ancillaryData: { region: "EU", distance: 20 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
  },
  source: {
    format: SOURCE_FORMAT_NEWICK,
    generated_at: "2026-03-27T00:00:00Z",
  },
};

describe("metadataIndex", () => {
  it("builds fast lookups for metadata by node", () => {
    const index = buildAncillaryIndex(DATASET);

    expect(getNodeAncillaryData(index, "a").region).toBe("EU");
    expect(getNodeAncillaryData(index, "missing")).toEqual({});
  });

  it("filters nodes by categorical metadata values", () => {
    const index = buildAncillaryIndex(DATASET);
    const ids = filterNodeIdsByFieldValues(index, "region", ["EU"]);

    expect([...ids].sort()).toEqual(["a", "c"]);
  });

  it("computes numeric stats for size mappings", () => {
    const index = buildAncillaryIndex(DATASET);
    const stats = index.numericStats.get("distance");

    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(30);
  });
});
