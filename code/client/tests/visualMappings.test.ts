import { buildMetadataIndex } from "../src/ancillary/metadataIndex";
import {
  METADATA_TYPE_NUMBER,
  METADATA_TYPE_STRING,
  SOURCE_FORMAT_NEWICK,
} from "../src/contracts/models";
import type { CanonicalDataset } from "../src/contracts/models";
import type { PositionedGraph } from "../src/contracts/positioned";
import {
  applyVisualMappings,
  CLUSTER_PROXY_COLOR,
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
} from "../src/render/visualMappings";
import {
  detectPieSliceKeys,
  MAX_PIE_SLICE_KEYS,
  PIE_OTHER_SLICE_KEY,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_ATTRIBUTE_PREFIX,
  PIE_PALETTE_ATTRIBUTE,
  pieCategoricalAttributeKey,
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

  it("maps explicit category colors to categorical pie attributes", () => {
    const index = buildMetadataIndex(DATASET);
    const mapped = applyVisualMappings(BASE_GRAPH, DATASET, index, {
      pie: {
        fields: ["region"],
        categoryColors: {
          EU: "#123456",
          US: "#abcdef",
        },
      },
    });

    const nodeAttributes = mapped.nodes[0]?.attributes as Record<
      string,
      unknown
    >;
    const categoryColors = nodeAttributes[PIE_CATEGORY_COLORS_ATTRIBUTE] as
      | Record<string, string>
      | undefined;

    expect(categoryColors).toMatchObject({
      [pieCategoricalAttributeKey("region", "EU")]: "#123456",
    });
  });

  it("sizes nodes by profile count with linear or logarithmic scaling", () => {
    // Given
    const profileDataset: CanonicalDataset = {
      ...DATASET,
      nodes: [...DATASET.nodes, { id: "c" }],
      metadata_schema: [
        ...DATASET.metadata_schema,
        { key: "profile_count", type: METADATA_TYPE_NUMBER },
      ],
      metadata_by_node_id: {
        a: { region: "EU", distance: 10, trait_a: 4, profile_count: 10 },
        b: { region: "US", distance: 30, trait_a: 8, profile_count: 100 },
        c: { region: "AS", distance: 50, trait_a: 12, profile_count: 1000 },
      },
    };
    const profileGraph: PositionedGraph = {
      ...BASE_GRAPH,
      nodes: [...BASE_GRAPH.nodes, { id: "c", x: 200, y: 200 }],
    };
    const index = buildMetadataIndex(profileDataset);

    // When
    const linearMapped = applyVisualMappings(profileGraph, profileDataset, index, {
      size: { field: "profile_count", scale: "linear" },
    });
    const logMapped = applyVisualMappings(profileGraph, profileDataset, index, {
      size: { field: "profile_count", scale: "log" },
    });

    // Then
    expect(linearMapped.nodes[0]?.size).toBe(MIN_NODE_SIZE);
    expect(linearMapped.nodes[2]?.size).toBe(MAX_NODE_SIZE);
    expect(logMapped.nodes[0]?.size).toBe(MIN_NODE_SIZE);
    expect(logMapped.nodes[2]?.size).toBe(MAX_NODE_SIZE);
    expect(logMapped.nodes[1]?.size ?? 0).toBeGreaterThan(
      linearMapped.nodes[1]?.size ?? 0,
    );
  });

  it("styles cluster proxy nodes explicitly", () => {
    const index = buildMetadataIndex(DATASET);
    const proxyGraph: PositionedGraph = {
      ...BASE_GRAPH,
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            is_cluster_proxy: true,
            subtree_size: 128,
            leaf_count: 64,
          },
        },
      ],
      edges: [],
    };

    const mapped = applyVisualMappings(proxyGraph, DATASET, index);
    const proxyNode = mapped.nodes[0];

    expect(proxyNode?.color).toBe(CLUSTER_PROXY_COLOR);
    expect((proxyNode?.size ?? 0)).toBeGreaterThan(10);
    expect(
      (proxyNode?.attributes as Record<string, unknown>)?.is_cluster_proxy,
    ).toBe(true);
  });

  it("maps selected categorical metadata fields to graph pie slices", () => {
    const index = buildMetadataIndex(DATASET);
    const mapped = applyVisualMappings(BASE_GRAPH, DATASET, index, {
      pie: {
        fields: ["region"],
      },
    });

    const nodeAttributes = mapped.nodes[0]?.attributes as Record<
      string,
      unknown
    >;
    const pieKeys = Object.keys(nodeAttributes).filter((key) =>
      key.startsWith(PIE_ATTRIBUTE_PREFIX),
    );

    const expectedKey = pieCategoricalAttributeKey("region", "EU");

    expect(pieKeys).toEqual([expectedKey]);
    expect(nodeAttributes[expectedKey]).toBe(1);
  });

  it("maps multi-valued categorical metadata to multiple pie slices", () => {
    // Given
    const dataset: CanonicalDataset = {
      ...DATASET,
      metadata_by_node_id: {
        a: { region: "Asia;Europe", distance: 10, trait_a: 4 },
        b: { region: "US", distance: 30, trait_a: 8 },
      },
    };
    const index = buildMetadataIndex(dataset);

    // When
    const mapped = applyVisualMappings(BASE_GRAPH, dataset, index, {
      pie: {
        fields: ["region"],
      },
    });

    // Then
    const nodeAttributes = mapped.nodes[0]?.attributes as Record<
      string,
      unknown
    >;
    expect(nodeAttributes[pieCategoricalAttributeKey("region", "Asia")]).toBe(
      1,
    );
    expect(nodeAttributes[pieCategoricalAttributeKey("region", "Europe")]).toBe(
      1,
    );
  });

  it("combines multiple selected metadata fields into pie slices", () => {
    // Given
    const dataset: CanonicalDataset = {
      ...DATASET,
      metadata_schema: [
        ...DATASET.metadata_schema,
        { key: "country", type: METADATA_TYPE_STRING },
      ],
      metadata_by_node_id: {
        a: {
          region: "Europe",
          country: "Portugal",
          distance: 10,
          trait_a: 4,
        },
        b: { region: "US", country: "Canada", distance: 30, trait_a: 8 },
      },
    };
    const index = buildMetadataIndex(dataset);

    // When
    const mapped = applyVisualMappings(BASE_GRAPH, dataset, index, {
      pie: {
        fields: ["region", "country"],
      },
    });

    // Then
    const nodeAttributes = mapped.nodes[0]?.attributes as Record<
      string,
      unknown
    >;
    expect(nodeAttributes[pieCategoricalAttributeKey("region", "Europe")]).toBe(
      1,
    );
    expect(
      nodeAttributes[pieCategoricalAttributeKey("country", "Portugal")],
    ).toBe(1);
  });

  it("caps detected pie slice keys and aggregates the tail as Others", () => {
    // Given
    const nodes = Array.from({ length: MAX_PIE_SLICE_KEYS + 10 }, (_, index) => ({
      attributes: {
        [`${PIE_ATTRIBUTE_PREFIX}country_${index}`]: index + 1,
      },
    }));

    // When
    const keys = detectPieSliceKeys(nodes);

    // Then
    expect(keys).toHaveLength(MAX_PIE_SLICE_KEYS + 1);
    expect(keys).toContain(
      `${PIE_ATTRIBUTE_PREFIX}country_${MAX_PIE_SLICE_KEYS + 9}`,
    );
    expect(keys).toContain(PIE_OTHER_SLICE_KEY);
    expect(keys).not.toContain(`${PIE_ATTRIBUTE_PREFIX}country_0`);
  });

  it("sanitizes real-world categorical values for graph pie attributes", () => {
    const index = buildMetadataIndex({
      ...DATASET,
      metadata_by_node_id: {
        a: { region: "UK [England]", distance: 10, trait_a: 4 },
        b: { region: "US", distance: 30, trait_a: 8 },
      },
    });
    const mapped = applyVisualMappings(BASE_GRAPH, DATASET, index, {
      pie: {
        fields: ["region"],
      },
    });

    const nodeAttributes = mapped.nodes[0]?.attributes as Record<
      string,
      unknown
    >;
    const expectedKey = pieCategoricalAttributeKey("region", "UK [England]");

    expect(expectedKey).toMatch(/^pie__region_/);
    expect(expectedKey).not.toContain("[");
    expect(nodeAttributes[expectedKey]).toBe(1);
  });
});
