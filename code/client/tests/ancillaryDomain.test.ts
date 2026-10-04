import { describe, expect, it } from "vitest";
import { decodeApiMetadata } from "../src/ancillary/apiMetadata";
import { parseAncillaryPayload } from "../src/app/shell/inputs/ancillaryPayload";
import { resolveAncillaryInput } from "../src/ancillary/ancillaryInput";
import { readNodeAnnotations } from "../src/ancillary/ancillaryAccess";
import { buildAncillaryFieldWheelStats } from "../src/components/ancillaryWheel";
import { graphSnapshotFromViewportResponse } from "../src/app/workbench/viewport/viewportSnapshot";
import type { GraphViewportResponse } from "../src/api/graphContracts";

const metadata = {
  country: "PT;ES",
  profile_count: 3,
  __category_count__country__value__PT: 2,
  __category_count__country__value__ES: 1,
};

describe("ancillary domain boundaries", () => {
  it("separates observations, category frequencies and represented isolate counts", () => {
    expect(decodeApiMetadata(metadata)).toEqual({
      ancillaryData: {},
      ancillarySummary: { values: { country: "PT;ES" }, categoryCounts: { country: { PT: 2, ES: 1 } } },
      profileSummary: { isolateCount: 3 },
    });
    expect(decodeApiMetadata({}).profileSummary.isolateCount).toBeUndefined();
    expect(readNodeAnnotations({ metadata })).toEqual(decodeApiMetadata(metadata));
  });

  it("handles arbitrary field names without interpreting them as object properties", () => {
    const decoded = decodeApiMetadata(
      JSON.parse('{"__proto__":"observation","__category_count__constructor__value____proto__":2}'),
    );
    expect(Object.hasOwn(decoded.ancillarySummary.values, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(decoded.ancillarySummary.values)).toBe(Object.prototype);
    expect(decoded.ancillarySummary.categoryCounts.constructor).toEqual({ ["__proto__"]: 2 });
  });

  it("uses ancillary options and supplies empty defaults", () => {
    const values = { a: { country: "PT" } };
    expect(resolveAncillaryInput({ ancillaryByNodeId: values })).toEqual({
      ancillarySchema: [],
      ancillaryByNodeId: values,
    });
    expect(resolveAncillaryInput({})).toEqual({ ancillarySchema: [], ancillaryByNodeId: {} });
  });

  it("accepts current ancillary JSON and rejects removed metadata aliases", () => {
    expect(parseAncillaryPayload('{"ancillary_by_node_id":{"a":{"country":"PT"}}}')).toMatchObject({
      ancillaryByNodeId: { a: { country: "PT" } },
    });
    expect(() => parseAncillaryPayload('{"metadata_by_node_id":{"a":{"country":"PT"}}}')).toThrow(
      "Ancillary JSON must include ancillary_schema and/or ancillary_by_node_id",
    );
  });

  it("renders v1 inputs through typed annotations without changing pie proportions", () => {
    const response: GraphViewportResponse = {
      dataset_id: "fixture",
      layout_version: "1",
      lod_level: 0,
      zoom: 1,
      layout_status: "ready",
      truncated: false,
      total_node_count: 1,
      edges: [],
      nodes: [
        {
          id: "profile",
          cluster_id: "profile",
          x: 0,
          y: 0,
          layout_status: "ready",
          member_count: 1,
          is_representative: false,
          metadata,
          isolates: [
            { id: "A", metadata: { country: "PT" } },
            { id: "B", metadata: { country: "PT" } },
            { id: "C", metadata: { country: "ES" } },
          ],
        },
      ],
    };
    const graph = graphSnapshotFromViewportResponse(response, { visualMapping: { pie: { fields: ["country"] } } });
    expect(graph.nodes[0]?.attributes?.metadata).toBeUndefined();
    expect(graph.nodes[0]?.attributes?.annotations).toEqual(decodeApiMetadata(metadata));
    expect(graph.nodes[0]?.attributes?.isolates).toEqual([
      { id: "A", ancillaryData: { country: "PT" } },
      { id: "B", ancillaryData: { country: "PT" } },
      { id: "C", ancillaryData: { country: "ES" } },
    ]);
    const stats = buildAncillaryFieldWheelStats(graph, "country");
    expect(stats?.total).toBe(3);
    expect(stats?.slices.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "PT", value: 2 },
      { label: "ES", value: 1 },
    ]);
  });
});
