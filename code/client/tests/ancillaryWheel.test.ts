import {
  buildAncillaryWheelStats,
  buildMetadataFieldWheelStats,
  collectMetadataFieldKeys,
} from "../src/components/ancillaryWheel";
import type { PositionedGraph } from "../src/contracts/positioned";
import {
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  pieCategoricalAttributeKey,
} from "../src/render/pieMapping";

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

  it("omits generated profile counts from selectable metadata keys", () => {
    // Given
    const graph: PositionedGraph = {
      ...GRAPH,
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            metadata: { country: "Portugal", profile_count: 3 },
          },
        },
      ],
    };

    // Then
    expect(collectMetadataFieldKeys(graph)).toEqual(["country"]);
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

  it("uses category count metadata for selected field stats", () => {
    // Given
    const graph: PositionedGraph = {
      ...GRAPH,
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            metadata: {
              country: "Portugal;Spain",
              __category_count__country__value__Portugal: 3,
              __category_count__country__value__Spain: 1,
            },
          },
        },
      ],
    };

    // When
    const stats = buildMetadataFieldWheelStats(graph, "country");

    // Then
    expect(stats?.total).toBe(4);
    expect(stats?.slices.map((slice) => [slice.label, slice.value])).toEqual([
      ["Portugal", 3],
      ["Spain", 1],
    ]);
    expect(collectMetadataFieldKeys(graph)).toEqual(["country"]);
  });

  it("keeps clicked-node colors aligned with the graph-wide pie palette", () => {
    const africaKey = pieCategoricalAttributeKey("region", "Africa");
    const europeKey = pieCategoricalAttributeKey("region", "Europe");
    const oceaniaKey = pieCategoricalAttributeKey("region", "Oceania");
    const graph: PositionedGraph = {
      nodes: [
        {
          id: "africa",
          x: 0,
          y: 0,
          attributes: { [africaKey]: 1 },
        },
        {
          id: "europe",
          x: 1,
          y: 0,
          attributes: { [europeKey]: 1 },
        },
        {
          id: "oceania",
          x: 2,
          y: 0,
          attributes: { [oceaniaKey]: 1 },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    const globalStats = buildAncillaryWheelStats(graph);
    const selectedStats = buildAncillaryWheelStats(graph, {
      includeNodeIds: new Set(["oceania"]),
    });

    expect(selectedStats?.slices[0]?.color).toBe(
      globalStats?.slices.find((slice) => slice.key === oceaniaKey)?.color,
    );
  });

  it("merges category colors stored on different nodes", () => {
    const africaKey = pieCategoricalAttributeKey("region", "Africa");
    const oceaniaKey = pieCategoricalAttributeKey("region", "Oceania");
    const graph: PositionedGraph = {
      nodes: [
        {
          id: "africa",
          x: 0,
          y: 0,
          attributes: {
            [africaKey]: 1,
            [PIE_CATEGORY_COLORS_ATTRIBUTE]: { [africaKey]: "#ff0000" },
          },
        },
        {
          id: "oceania",
          x: 1,
          y: 0,
          attributes: {
            [oceaniaKey]: 1,
            [PIE_CATEGORY_COLORS_ATTRIBUTE]: { [oceaniaKey]: "#00aa00" },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    const selectedStats = buildAncillaryWheelStats(graph, {
      includeNodeIds: new Set(["oceania"]),
    });

    expect(selectedStats?.slices[0]?.color).toBe("#00aa00");
  });
});
