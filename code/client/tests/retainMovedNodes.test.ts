import { describe, expect, it } from "vitest";
import { retainMovedNodes } from "../src/app/workbench/viewport/retainMovedNodes";
import type { GraphViewportResponse } from "../src/api/graphContracts";
const response = (ids: string[]): GraphViewportResponse => ({
  dataset_id: "d",
  layout_version: "v",
  lod_level: 1,
  zoom: 2,
  layout_status: "ready",
  truncated: false,
  total_node_count: 10,
  nodes: ids.map((id, x) => ({
    id,
    x,
    y: 0,
    cluster_id: id,
    is_representative: false,
    member_count: 1,
    layout_status: "ready",
  })),
  edges: [{ id: "ab", source: "a", target: "b", distance: 7 }],
});
describe("budgeted viewport retention", () => {
  it("retains a visible dragged node and its available edges within the budget", () => {
    const previous = response(["a", "b"]),
      next = response(["b", "c"]);
    const retained = retainMovedNodes(next, previous, ["a"], 2);
    expect(retained.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(retained.edges).toEqual(previous.edges);
    expect(retained.truncated).toBe(true);
    expect(next.nodes.map((n) => n.id)).toEqual(["b", "c"]);
  });
  it("does not carry old nodes into another tier or layout version", () => {
    const previous = response(["a", "b"]);
    for (const next of [
      { ...response(["b"]), lod_level: 2 },
      { ...response(["b"]), layout_version: "new" },
    ]) {
      expect(retainMovedNodes(next, previous, ["a"], 5)).toBe(next);
    }
  });
  it("prefers fresh ancillary records returned by the server", () => {
    const previous = response(["a"]),
      next = response(["a", "b"]);
    next.nodes[0].metadata = { country: "PT" };
    expect(retainMovedNodes(next, previous, ["a"], 3).nodes[0].metadata).toEqual({ country: "PT" });
  });
});
