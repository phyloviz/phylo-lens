import { describe, expect, it } from "vitest";

import {
  isGraphPrepareResponse,
  isGraphPrepareStatus,
  isGraphRegionResponse,
  isGraphSearchResponse,
  isGraphViewportResponse,
  isNormalizeRequest,
} from "../src/api/graphGuards";

const VIEWPORT_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  lod_level: 0,
  zoom: 0.5,
  layout_status: "ready",
  truncated: false,
  total_node_count: 1,
  global_bounds: { min_x: -10, max_x: 10, min_y: -5, max_y: 5 },
  nodes: [
    {
      id: "cluster_1",
      cluster_id: "cluster_1",
      x: 10,
      y: 12,
      layout_status: "ready",
      member_count: 4,
      is_representative: true,
    },
  ],
  edges: [],
} satisfies unknown;

const PREPARE_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  node_count: 3,
  edge_count: 2,
  cluster_count: 2,
  layout_status: "ready",
  warnings: [],
} satisfies unknown;

const REGION_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  layout_status: "ready",
  truncated: false,
  total_node_count: 2,
  nodes: [
    {
      id: "a",
      cluster_id: "a",
      x: 1,
      y: 2,
      layout_status: "ready",
      member_count: 1,
      is_representative: false,
    },
  ],
  edges: [],
  aggregated_metadata: { region: "north", score: 16 },
} satisfies unknown;

const SEARCH_FIXTURE = {
  dataset_id: "tree",
  layout_version: "abc123",
  query: "port",
  total_count: 2,
  matches: [
    { node_id: "portugal_1", score: 60, matched_text: "portugal_1", cluster_id: "cluster_portugal" },
    { node_id: "isolate_x", score: 20, matched_text: "isolate_x Portugal" },
  ],
} satisfies unknown;

describe("graphGuards", () => {
  it("requires ancillary join_column on normalize requests", () => {
    expect(
      isNormalizeRequest({
        format: "newick",
        dataset_name: "tree",
        content: "(A,B)Root;",
        ancillary_data: {
          content: "isolate\tcountry\nA\tPT\n",
          join_column: "isolate",
          format: "tsv",
        },
      }),
    ).toBe(true);

    expect(
      isNormalizeRequest({
        format: "newick",
        dataset_name: "tree",
        content: "(A,B)Root;",
        ancillary_data: {
          content: "isolate\tcountry\nA\tPT\n",
          format: "tsv",
        },
      }),
    ).toBe(false);
  });

  it("validates prepare responses", () => {
    expect(isGraphPrepareResponse(PREPARE_FIXTURE)).toBe(true);
    expect(isGraphPrepareResponse({ ...PREPARE_FIXTURE, node_count: "3" })).toBe(false);
  });

  it("accepts structured failed-prepare diagnostics", () => {
    expect(
      isGraphPrepareStatus({
        job_id: "job-1",
        status: "failed",
        error: "sfdp exited",
        error_details: {
          algorithm: "sfdp",
          stage: "global_layout",
          exit_status: 17,
          stderr: "bad input",
        },
      }),
    ).toBe(true);
  });

  it("validates viewport responses", () => {
    expect(isGraphViewportResponse(VIEWPORT_FIXTURE)).toBe(true);
    expect(isGraphViewportResponse({ ...VIEWPORT_FIXTURE, nodes: [{}] })).toBe(false);
    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        global_bounds: { min_x: -10, max_x: "10", min_y: -5, max_y: 5 },
      }),
    ).toBe(false);
  });

  it("validates region responses", () => {
    expect(isGraphRegionResponse(REGION_FIXTURE)).toBe(true);
    // metadata_schema is optional; aggregated_metadata is required.
    const withoutAggregate = { ...REGION_FIXTURE } as Record<string, unknown>;
    delete withoutAggregate.aggregated_metadata;
    expect(isGraphRegionResponse(withoutAggregate)).toBe(false);
    // Non-scalar aggregate values are rejected.
    expect(
      isGraphRegionResponse({
        ...REGION_FIXTURE,
        aggregated_metadata: { region: { nested: true } },
      }),
    ).toBe(false);
    // Malformed nodes are rejected.
    expect(isGraphRegionResponse({ ...REGION_FIXTURE, nodes: [{}] })).toBe(false);
  });

  it("accepts meta-edge fields on edges and rejects wrong types", () => {
    const withMetaEdge = {
      ...VIEWPORT_FIXTURE,
      edges: [
        {
          id: "meta_edge:a:cluster_1",
          source: "a",
          target: "cluster_1",
          distance: 2,
          is_meta: true,
          bundled_edge_count: 3,
        },
      ],
    };
    expect(isGraphViewportResponse(withMetaEdge)).toBe(true);

    const plainEdge = {
      ...VIEWPORT_FIXTURE,
      edges: [{ id: "e1", source: "a", target: "cluster_1", distance: 1 }],
    };
    expect(isGraphViewportResponse(plainEdge)).toBe(true);

    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        edges: [
          {
            id: "e1",
            source: "a",
            target: "cluster_1",
            is_meta: "yes",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        edges: [
          {
            id: "e1",
            source: "a",
            target: "cluster_1",
            bundled_edge_count: "3",
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepts node metadata and a metadata schema", () => {
    const withMetadata = {
      ...VIEWPORT_FIXTURE,
      metadata_schema: [
        { key: "region", type: "string" },
        { key: "distance", type: "number" },
      ],
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: {
            region: "eu",
            distance: 3,
            resistant: true,
            missing: null,
          },
        },
      ],
    };

    expect(isGraphViewportResponse(withMetadata)).toBe(true);
  });

  it("treats absent node metadata and metadata schema as valid", () => {
    expect(isGraphViewportResponse(VIEWPORT_FIXTURE)).toBe(true);
    expect(
      isGraphViewportResponse({
        ...VIEWPORT_FIXTURE,
        nodes: [{ ...VIEWPORT_FIXTURE.nodes[0], metadata: null }],
      }),
    ).toBe(true);
  });

  it("permits internal-key metadata to pass the guard untouched", () => {
    // Internal aggregation keys are scalar values; downstream code filters them
    // from public views rather than asking the contract guard to strip them.
    const withInternalKeys = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: {
            profile_count: 5,
            __category_count__region__value__eu: 3,
            region: "eu",
          },
        },
      ],
    };

    expect(isGraphViewportResponse(withInternalKeys)).toBe(true);
  });

  it("rejects non-scalar node metadata values", () => {
    const nestedObject = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: { region: { nested: "eu" } },
        },
      ],
    };
    const arrayValue = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: { regions: ["eu", "us"] },
        },
      ],
    };
    const nonFiniteNumber = {
      ...VIEWPORT_FIXTURE,
      nodes: [
        {
          ...VIEWPORT_FIXTURE.nodes[0],
          metadata: { distance: Number.NaN },
        },
      ],
    };

    expect(isGraphViewportResponse(nestedObject)).toBe(false);
    expect(isGraphViewportResponse(arrayValue)).toBe(false);
    expect(isGraphViewportResponse(nonFiniteNumber)).toBe(false);
  });

  it("rejects malformed metadata schema entries", () => {
    const missingType = {
      ...VIEWPORT_FIXTURE,
      metadata_schema: [{ key: "region" }],
    };
    const notAnArray = {
      ...VIEWPORT_FIXTURE,
      metadata_schema: { region: "string" },
    };

    expect(isGraphViewportResponse(missingType)).toBe(false);
    expect(isGraphViewportResponse(notAnArray)).toBe(false);
  });

  it("validates search responses", () => {
    expect(isGraphSearchResponse(SEARCH_FIXTURE)).toBe(true);
    expect(isGraphSearchResponse({ ...SEARCH_FIXTURE, total_count: "2" })).toBe(false);
    expect(isGraphSearchResponse({ ...SEARCH_FIXTURE, matches: [{ node_id: "x" }] })).toBe(false);
  });
});
