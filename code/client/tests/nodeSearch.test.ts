import { describe, expect, it } from "vitest";
import { searchDatasetNodes } from "../src/app/workbench/nodeSearch";

type MetadataByNodeId = Record<
  string,
  Record<string, string | number | boolean | null>
>;

const METADATA: MetadataByNodeId = {
  portugal_1: { country: "Portugal", region: "EU", profile_count: 12 },
  canada_1: { country: "Canada", region: "NA" },
  port_wine: { country: "Portugal", region: "EU" },
  isolate_x: { country: "Spain", region: "EU" },
  union_3: { country: "Portugal" },
  "__category_count__country__value__Portugal": { country: "hidden" },
};

const DATASET_ID = "fixture-tree";

describe("searchDatasetNodes", () => {
  it("returns an empty result for a blank query", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, { query: "  " });
    expect(result.matches).toEqual([]);
    expect(result.total_count).toBe(0);
    expect(result.dataset_id).toBe(DATASET_ID);
  });

  it("ranks an exact id match above prefix and substring id matches", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, { query: "port_wine" });
    expect(result.matches[0]?.node_id).toBe("port_wine");
    expect(result.matches[0]?.score).toBeGreaterThan(
      result.matches[1]?.score ?? 0,
    );
  });

  it("matches on metadata values case-insensitively", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, {
      query: "portugal",
    });
    const ids = result.matches.map((m) => m.node_id);
    // portugal_1 (id prefix) + port_wine (metadata) match; union_3 excluded.
    expect(ids).toContain("portugal_1");
    expect(ids).toContain("port_wine");
    expect(ids).not.toContain("union_3");
  });

  it("never surfaces union junction nodes", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, { query: "union" });
    expect(result.matches).toEqual([]);
    expect(result.total_count).toBe(0);
  });

  it("ignores internal metadata keys (profile_count, __category_count__)", () => {
    const byCount = searchDatasetNodes(DATASET_ID, METADATA, { query: "12" });
    expect(byCount.matches).toEqual([]);

    const byHidden = searchDatasetNodes(DATASET_ID, METADATA, {
      query: "hidden",
    });
    expect(byHidden.matches).toEqual([]);
  });

  it("restricts metadata matching to includeMetadataKeys when provided", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, {
      query: "eu",
      includeMetadataKeys: ["country"],
    });
    // "eu" only appears in region values, which is excluded, so no metadata
    // matches; ids do not contain "eu" either.
    expect(result.matches).toEqual([]);
  });

  it("caps matches by limit while total_count reflects all matches", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, {
      query: "eu",
      limit: 1,
    });
    expect(result.total_count).toBeGreaterThan(1);
    expect(result.matches).toHaveLength(1);
  });

  it("produces a readable matched_text for metadata matches", () => {
    const result = searchDatasetNodes(DATASET_ID, METADATA, {
      query: "canada",
    });
    const match = result.matches.find((m) => m.node_id === "canada_1");
    expect(match?.matched_text).toContain("canada_1");
  });
});
