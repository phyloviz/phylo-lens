import { describe, expect, it } from "vitest";

import { EMPTY_ANCILLARY_FILTER_STATE, filterGraphByAncillaryData } from "../src/ancillary/filterEngine";
import type { AncillaryFilterState } from "../src/ancillary/ancillaryTypes";
import { buildAncillaryIndex } from "../src/ancillary/ancillaryIndex";
import type { CanonicalDataset } from "../src/contracts/models";
import type { PositionedGraph } from "../src/contracts/positioned";

const DATASET: CanonicalDataset = {
  dataset_id: "d1",
  nodes: [{ id: "root" }, { id: "a" }, { id: "b" }, { id: "c" }],
  edges: [
    { id: "e1", source: "root", target: "a" },
    { id: "e2", source: "root", target: "b" },
    { id: "e3", source: "root", target: "c" },
  ],
  ancillarySchema: [
    { key: "region", type: "string" },
    { key: "distance", type: "number" },
  ],
  annotationsByNodeId: {
    root: {
      ancillaryData: { region: "EU", distance: 0 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
    a: {
      ancillaryData: { region: "EU", distance: 1 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
    b: {
      ancillaryData: { region: "AF", distance: 3 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
    c: {
      ancillaryData: { region: "AS", distance: 5 },
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
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

describe("filterGraphByAncillaryData", () => {
  it("returns the original graph when no active filters exist", () => {
    const index = buildAncillaryIndex(DATASET);

    const filtered = filterGraphByAncillaryData(GRAPH, index, EMPTY_ANCILLARY_FILTER_STATE);

    expect(filtered).toBe(GRAPH);
  });

  it("filters by categorical values and keeps only valid connecting edges", () => {
    const index = buildAncillaryIndex(DATASET);
    const state: AncillaryFilterState = {
      categorical: [{ fieldKey: "region", acceptedValues: ["EU"] }],
      numeric: [],
    };

    const filtered = filterGraphByAncillaryData(GRAPH, index, state);

    expect(filtered.nodes.map((node) => node.id)).toEqual(["root", "a"]);
    expect(filtered.edges.map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("supports numeric range filtering", () => {
    const index = buildAncillaryIndex(DATASET);
    const state: AncillaryFilterState = {
      categorical: [],
      numeric: [{ fieldKey: "distance", min: 1, max: 3 }],
    };

    const filtered = filterGraphByAncillaryData(GRAPH, index, state);

    expect(filtered.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(filtered.edges).toHaveLength(0);
  });
});
