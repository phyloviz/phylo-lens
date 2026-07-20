import { describe, expect, it } from "vitest";

import {
  buildAncillaryWheelStats,
  buildMetadataFieldWheelStats,
  collectMetadataFieldKeys,
} from "../src/components/ancillaryWheel";
import type { PositionedGraph } from "../src/contracts/positioned";
import { buildValueColorMap, DEFAULT_COLOR_PALETTE } from "../src/render/mapping/colorMapping";
import {
  buildPieAttributes,
  detectPieSliceKeys,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_OTHER_SLICE_COLOR,
  pieCategoricalAttributeKey,
  resolvePieSliceColors,
} from "../src/render/mapping/pieMapping";

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

  it("gives each selected-field slice its own palette color", () => {
    // Reproduces the workbench snapshot: every node carries pie__ slices for
    // ALL metadata fields (country + region), so a graph-wide top-12 pool would
    // colour only the single most frequent key and grey out the rest of the
    // selected field. Scoping colours to the chosen field must instead give
    // every displayed country slice a distinct, non-Others colour.
    const nodes = [
      { country: "Iceland", region: "Europe" },
      { country: "Iceland", region: "Europe" },
      { country: "Iceland", region: "Europe" },
      { country: "Portugal", region: "Europe" },
      { country: "Canada", region: "Americas" },
    ].map((metadata, index) => ({
      id: `n${index}`,
      x: index,
      y: 0,
      attributes: {
        metadata,
        ...buildPieAttributes(metadata, {
          enabled: true,
          fields: ["country", "region"],
        }),
      },
    }));
    const graph: PositionedGraph = {
      nodes,
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    const stats = buildMetadataFieldWheelStats(graph, "country");

    expect(stats?.slices.map((slice) => slice.label)).toEqual(["Iceland", "Canada", "Portugal"]);
    const colors = stats?.slices.map((slice) => slice.color) ?? [];
    // Colours are ranked by graph-wide frequency and assigned palette entries in
    // order — the same map that paints the node fill — so the wheel and node
    // agree AND the top values are all distinct (no grey Others, no collision).
    expect(colors).not.toContain(PIE_OTHER_SLICE_COLOR);
    expect(new Set(colors).size).toBe(colors.length);
    const rankedColor = buildValueColorMap(
      ["Iceland", "Iceland", "Iceland", "Portugal", "Canada"],
      DEFAULT_COLOR_PALETTE,
    );
    stats?.slices.forEach((slice) => {
      expect(slice.color).toBe(rankedColor(slice.label));
    });
  });

  it("reflects a live category-color override from the shell controls", () => {
    // The wheel graph snapshot carries no palette edits on its nodes, so the
    // shell forwards the current override map. A colour edit for one value must
    // recolour just that slice (matching the tree, repainted the same way).
    const nodes = [{ country: "Iceland" }, { country: "Iceland" }, { country: "Portugal" }, { country: "Peru" }].map(
      (metadata, index) => ({
        id: `n${index}`,
        x: index,
        y: 0,
        attributes: {
          metadata,
          ...buildPieAttributes(metadata, { enabled: true, fields: ["country"] }),
        },
      }),
    );
    const graph: PositionedGraph = {
      nodes,
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    const overridden = buildMetadataFieldWheelStats(graph, "country", {
      categoryColors: { Peru: "#123456" },
    });
    const peru = overridden?.slices.find((slice) => slice.label === "Peru");
    const iceland = overridden?.slices.find((slice) => slice.label === "Iceland");
    expect(peru?.color).toBe("#123456");
    // Only the overridden value changes; the rest keep their ranked colours.
    expect(iceland?.color).toBe(DEFAULT_COLOR_PALETTE[0]);
  });

  it("reflects a live palette swap from the shell controls", () => {
    // Swapping the palette must recolour the wheel: the most frequent value
    // takes the new palette[0], mirroring how the tree re-ranks on the same
    // palette. Guards the wheel against ignoring palette edits.
    const nodes = [{ country: "Iceland" }, { country: "Iceland" }, { country: "Portugal" }].map((metadata, index) => ({
      id: `n${index}`,
      x: index,
      y: 0,
      attributes: {
        metadata,
        ...buildPieAttributes(metadata, { enabled: true, fields: ["country"] }),
      },
    }));
    const graph: PositionedGraph = {
      nodes,
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    const swapped = ["#111111", "#222222"];
    const stats = buildMetadataFieldWheelStats(graph, "country", {
      palette: swapped,
    });
    const iceland = stats?.slices.find((slice) => slice.label === "Iceland");
    const portugal = stats?.slices.find((slice) => slice.label === "Portugal");
    expect(iceland?.color).toBe("#111111");
    expect(portugal?.color).toBe("#222222");
  });

  it("colors a single selected node by the value's ranked color", () => {
    // A clicked node's wheel charts one value, so its slice used to always land
    // on palette index 0 (red) regardless of which value it was. Colours are now
    // keyed to the value's graph-wide frequency rank, so a selected node's slice
    // is that value's stable colour — identical to the overview wheel and node.
    const nodes = [
      { country: "Iceland" },
      { country: "Iceland" },
      { country: "Iceland" },
      { country: "Portugal" },
      { country: "Peru" },
    ].map((metadata, index) => ({
      id: `n${index}`,
      x: index,
      y: 0,
      attributes: {
        metadata,
        ...buildPieAttributes(metadata, { enabled: true, fields: ["country"] }),
      },
    }));
    const graph: PositionedGraph = {
      nodes,
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    const overview = buildMetadataFieldWheelStats(graph, "country");
    const overviewColorByLabel = new Map((overview?.slices ?? []).map((slice) => [slice.label, slice.color]));

    // The Peru node (least frequent) must match the colour Peru has in the
    // overview wheel and equal its graph-wide ranked colour — not palette index
    // 0. Peru ranks 2nd here (Iceland is most frequent), so it is palette[1].
    const rankedColor = buildValueColorMap(
      ["Iceland", "Iceland", "Iceland", "Portugal", "Peru"],
      DEFAULT_COLOR_PALETTE,
    );
    const peruStats = buildMetadataFieldWheelStats(graph, "country", {
      includeNodeIds: new Set(["n4"]),
    });
    expect(peruStats?.slices).toHaveLength(1);
    expect(peruStats?.slices[0]?.label).toBe("Peru");
    expect(peruStats?.slices[0]?.color).toBe(overviewColorByLabel.get("Peru"));
    expect(peruStats?.slices[0]?.color).toBe(rankedColor("Peru"));
    expect(peruStats?.slices[0]?.color).not.toBe(overviewColorByLabel.get("Iceland"));
  });

  it("matches wheel slice colors to the on-node Sigma pie colors", () => {
    // The rendered node's pie and this wheel both resolve each value through
    // deriveColor(value). The wheel snapshot carries pie__ for every field while
    // the Sigma node program restricts to the selected field, but because both
    // colour by value, a value's wheel slice equals its on-node pie slice.
    const metadataByNode = [
      { country: "Iceland", region: "Europe" },
      { country: "Iceland", region: "Europe" },
      { country: "Peru", region: "Americas" },
      { country: "Portugal", region: "Europe" },
      { country: "China", region: "Asia" },
    ];
    const graph: PositionedGraph = {
      nodes: metadataByNode.map((metadata, index) => ({
        id: `n${index}`,
        x: index,
        y: 0,
        attributes: {
          metadata,
          // Wheel snapshot: pie__ slices for ALL fields.
          ...buildPieAttributes(metadata, {
            enabled: true,
            fields: ["country", "region"],
          }),
        },
      })),
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };

    // Reproduce the Sigma node program's colour resolution: pie__ restricted to
    // the selected field, then detect + resolve. The renderer's nodes carry
    // metadata, which resolvePieSliceColors uses to colour each slice by value.
    const sigmaNodeViews = metadataByNode.map((metadata) => ({
      attributes: {
        metadata,
        ...buildPieAttributes(metadata, {
          enabled: true,
          fields: ["country"],
        }),
      },
    }));
    const sigmaColors = resolvePieSliceColors(sigmaNodeViews, detectPieSliceKeys(sigmaNodeViews));

    const wheel = buildMetadataFieldWheelStats(graph, "country");
    for (const slice of wheel?.slices ?? []) {
      expect(slice.color).toBe(sigmaColors[pieCategoricalAttributeKey("country", slice.label)]);
    }
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

    expect(selectedStats?.slices[0]?.color).toBe(globalStats?.slices.find((slice) => slice.key === oceaniaKey)?.color);
  });

  it("builds auto-mode pie stats from workbench-derived node attributes", () => {
    // Reproduces the rendered-graph snapshot the workbench now produces for a
    // LoD viewport node: the server's per-node metadata (with aggregated
    // __category_count__ keys) plus the pie__ slice attributes derived from it
    // via buildPieAttributes. A clicked/selected node must yield a populated
    // wheel in the default "Auto pie fields" path (buildAncillaryWheelStats),
    // rather than the "no ancillary pie data" empty state.
    // Mirrors the server payload: the real "country" field plus the synthetic
    // aggregated per-category counts. The workbench excludes __category_count__
    // keys from the pie fields so they are not double-counted as their own
    // numeric slices (which would inflate the total from 4 to 8).
    const metadata = {
      country: "Portugal",
      __category_count__country__value__Portugal: 3,
      __category_count__country__value__Canada: 1,
    };
    const graph: PositionedGraph = {
      nodes: [
        {
          id: "539264",
          x: 0,
          y: 0,
          attributes: {
            metadata,
            ...buildPieAttributes(metadata, {
              enabled: true,
              fields: ["country"],
            }),
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "server", lodLevel: 2 },
    };

    const stats = buildAncillaryWheelStats(graph, {
      includeNodeIds: new Set(["539264"]),
    });

    expect(stats).not.toBeNull();
    expect(stats?.total).toBe(4);
    const byValue = new Map(stats?.slices.map((slice) => [slice.value, slice.key]));
    expect(byValue.get(3)).toBe(pieCategoricalAttributeKey("country", "Portugal"));
    expect(byValue.get(1)).toBe(pieCategoricalAttributeKey("country", "Canada"));
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
