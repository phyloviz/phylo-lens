import { describe, expect, it } from "vitest";
import { buildRenderedStatus } from "../src/app/shell/status/renderedStatus";
import type { PositionedGraph } from "../src/contracts/positioned";

function graph(counts: Array<number | undefined>): PositionedGraph {
  return {
    nodes: counts.map((count, index) => ({
      id: String(index),
      x: index,
      y: 0,
      attributes: { metadata: { profile_count: count } },
    })),
    edges: [],
    viewMeta: { layout: "server", lodLevel: 0, lodTierCount: 1 },
  };
}

describe("rendered status", () => {
  it("summarizes excluded loci without discarding the diagnostic list", () => {
    const data = graph([2, 1]);
    const summary = "Excluded 1940 loci containing allele 0 in at least one profile; retained 1104 loci.";
    const warning = `${summary} Excluded loci: ${Array.from({ length: 1940 }, (_, i) => `locus-${i}`).join(", ")}.`;
    data.viewMeta.layoutWarnings = [warning];
    const status = buildRenderedStatus(data);
    expect(status).toContain(summary);
    expect(status).not.toContain("locus-0");
    expect(status.length).toBeLessThan(240);
    expect(data.viewMeta.layoutWarnings).toEqual([warning]);
  });

  it("reports represented isolates rather than implying a dataset total", () => {
    expect(buildRenderedStatus(graph([15, 2, 1]))).toContain("18 isolates represented");
    expect(buildRenderedStatus(graph([15]))).toContain("15 isolates represented");
  });

  it("does not invent counts when membership is missing or invalid", () => {
    for (const counts of [[], [undefined], [2, undefined], [NaN], [0], [-1]]) {
      expect(buildRenderedStatus(graph(counts))).not.toContain("isolates represented");
    }
  });

  it("preserves other warnings", () => {
    const data = graph([]);
    data.viewMeta.layoutWarnings = ["Graphviz could not compute a layout."];
    expect(buildRenderedStatus(data)).toContain(data.viewMeta.layoutWarnings[0]);
  });
});
