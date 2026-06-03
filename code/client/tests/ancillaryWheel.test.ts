import {
  buildMetadataFieldWheelStats,
  collectMetadataFieldKeys,
} from "../src/components/ancillaryWheel";
import type { PositionedGraph } from "../src/contracts/positioned";

const GRAPH: PositionedGraph = {
  nodes: [
    {
      id: "a",
      x: 0,
      y: 0,
      attributes: {
        metadata: { country: "Portugal", age_yr: 12 },
      },
    },
    {
      id: "b",
      x: 1,
      y: 1,
      attributes: {
        metadata: { country: "Portugal", age_yr: 4 },
      },
    },
    {
      id: "c",
      x: 2,
      y: 2,
      attributes: {
        metadata: { country: "Canada", age_yr: null },
      },
    },
  ],
  edges: [],
  viewMeta: { layout: "force", lodLevel: 0 },
};

describe("ancillaryWheel metadata distributions", () => {
  it("collects metadata keys from rendered node attributes", () => {
    expect(collectMetadataFieldKeys(GRAPH)).toEqual(["age_yr", "country"]);
  });

  it("builds categorical pie stats for a selected metadata field", () => {
    const stats = buildMetadataFieldWheelStats(GRAPH, "country");

    expect(stats?.total).toBe(3);
    expect(stats?.slices.map((slice) => [slice.label, slice.value])).toEqual([
      ["Portugal", 2],
      ["Canada", 1],
    ]);
  });

  it("splits multi-valued metadata when building selected field stats", () => {
    // Given
    const graph: PositionedGraph = {
      ...GRAPH,
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            metadata: { country: "Portugal;Spain" },
          },
        },
      ],
    };

    // When
    const stats = buildMetadataFieldWheelStats(graph, "country");

    // Then
    expect(stats?.total).toBe(2);
    expect(stats?.slices.map((slice) => [slice.label, slice.value])).toEqual([
      ["Portugal", 1],
      ["Spain", 1],
    ]);
  });
});
