import { describe, expect, it } from "vitest";
import { DisplayPositions } from "../src/render/adapters/sigma/motion/displayPositions";
import type { PositionedGraph, PositionedNode } from "../src/contracts/positioned";
const node = (id: string, x: number, proxy = false): PositionedNode => ({
  id,
  x,
  y: 0,
  attributes: { cluster_id: "group", is_cluster_proxy: proxy },
});
const snapshot = (...nodes: PositionedNode[]): PositionedGraph => ({
  nodes,
  edges: [],
  viewMeta: { layout: "server", lodLevel: 0, globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
});

describe("separate server and display positions", () => {
  it("preserves display positions through reload and viewport removal/re-entry", () => {
    const positions = new DisplayPositions(),
      source = snapshot(node("a", 20));
    positions.ingest(source);
    positions.set("a", { x: 25, y: 3 });
    positions.ingest(snapshot());
    expect(positions.ingest(source).nodes[0]).toMatchObject({ x: 25, y: 3 });
    expect(source.nodes[0]).toMatchObject({ x: 20, y: 0 });
  });
  it("bounds manual translation coherently and non-finite worker output safely", () => {
    const positions = new DisplayPositions();
    positions.ingest(snapshot(node("a", 20), node("b", 40)));
    positions.set("a", { x: 28, y: 0 });
    const moved = positions.translate(
      new Map([
        ["a", { x: 28, y: 0 }],
        ["b", { x: 40, y: 0 }],
      ]),
      { x: 100, y: 5 },
    );
    expect(moved.get("a")).toEqual({ x: 30, y: 5 });
    expect(moved.get("b")).toEqual({ x: 42, y: 5 });
    expect(positions.set("a", { x: Infinity, y: NaN })).toEqual({ x: 20, y: 0 });
  });
  it("expands children from a moved proxy and preserves residual edits on re-expansion", () => {
    const positions = new DisplayPositions(),
      coarse = snapshot(node("proxy", 20, true)),
      fine = snapshot(node("a", 19), node("b", 21));
    positions.ingest(coarse);
    positions.set("proxy", { x: 25, y: 4 });
    const expanded = positions.ingest(fine);
    expect(expanded.origins.get("a")).toEqual({ x: 25, y: 4 });
    expect(expanded.nodes.map((n) => [n.x, n.y])).toEqual([
      [24, 4],
      [26, 4],
    ]);
    positions.set("a", { x: 26, y: 4 });
    positions.set("b", { x: 28, y: 4 });
    expect(positions.ingest(coarse).nodes[0]).toMatchObject({ x: 27, y: 4 });
    positions.set("proxy", { x: 29, y: 5 });
    const again = positions.ingest(fine);
    expect(again.nodes.map((n) => [n.x, n.y])).toEqual([
      [28, 5],
      [30, 5],
    ]);
  });
  it("reset removes child and proxy offsets", () => {
    const positions = new DisplayPositions(),
      source = snapshot(node("a", 20));
    positions.ingest(source);
    positions.set("a", { x: 25, y: 3 });
    positions.clear();
    expect(positions.ingest(source).nodes[0]).toMatchObject({ x: 20, y: 0 });
  });
});
