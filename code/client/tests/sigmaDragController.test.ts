import { describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import type Sigma from "sigma";
import createDrag, { resolveDragMembers } from "../src/render/adapters/sigma/interaction/sigmaDragController";
import type { DragSelection } from "../src/render/renderer.types";
function tree() {
  const g = new Graph();
  ["r", "a", "b", "c", "isolated"].forEach((id, i) => g.addNode(id, { x: i * 10, y: 0 }));
  g.addEdge("r", "a", { distance: 4 });
  g.addEdge("a", "b", { distance: 2 });
  g.addEdge("r", "c", { distance: 3 });
  return g;
}
function setup(selection: DragSelection = { kind: "node" }) {
  const graph = tree(),
    nodes = new Map(),
    mouse = new Map();
  let panning = true;
  const sigma = {
    on: (e: string, h: unknown) => nodes.set(e, h),
    off: (e: string) => nodes.delete(e),
    getMouseCaptor: () => ({ on: (e: string, h: unknown) => mouse.set(e, h), off: (e: string) => mouse.delete(e) }),
    viewportToGraph: (p: unknown) => p,
    getSetting: () => panning,
    setSetting: (_key: string, v: boolean) => (panning = v),
    refresh: vi.fn(),
  };
  const events = { onStart: vi.fn(), onEnd: vi.fn(), onMoved: vi.fn(), onUnavailable: vi.fn() };
  const controller = createDrag({
    getGraph: () => graph,
    getSigma: () => sigma as unknown as Sigma,
    getSelection: () => selection,
    isRegionSelectionEnabled: () => false,
    ...events,
    translate: (members, d) => new Map([...members].map(([id, p]) => [id, { x: p.x + d.x, y: p.y + d.y }])),
    suppressViewChangesFor: vi.fn(),
    suppressNodeClicksFor: vi.fn(),
  });
  controller.bind();
  return {
    graph,
    events,
    controller,
    down: (id: string) => nodes.get("downNode")({ node: id, event: { x: 10, y: 0 } }),
    move: () => mouse.get("mousemovebody")({ x: 15, y: 7 }),
    up: () => mouse.get("mouseup")(),
    panning: () => panning,
  };
}
describe("direct and advanced dragging", () => {
  it("pins only the grabbed node, translates it and releases on mouseup", () => {
    const t = setup(),
      before = t.graph.export().edges;
    t.down("a");
    expect(t.graph.getNodeAttribute("a", "fixed")).toBe(true);
    t.move();
    expect(t.graph.getNodeAttributes("a")).toMatchObject({ x: 15, y: 7 });
    expect(t.graph.getNodeAttribute("b", "x")).toBe(20);
    t.up();
    expect(t.panning()).toBe(true);
    expect(t.graph.getNodeAttribute("a", "fixed")).toBe(false);
    expect(t.events.onEnd).toHaveBeenCalledOnce();
    expect(t.graph.export().edges).toEqual(before);
    t.controller.unbind();
  });
  it("moves an internal branch coherently without a biological root assumption", () => {
    const t = setup({ kind: "branch", rootId: "r" });
    t.down("a");
    t.move();
    expect(t.graph.getNodeAttributes("b")).toMatchObject({ x: 25, y: 7 });
    expect(t.graph.getNodeAttribute("c", "x")).toBe(30);
    t.up();
    t.controller.unbind();
  });
  it("selects the root component and explicit groups, excluding unloaded members", () => {
    const g = tree();
    expect(resolveDragMembers(g, "r", { kind: "branch", rootId: "r" }).nodeIds.sort()).toEqual(["a", "b", "c", "r"]);
    expect(resolveDragMembers(g, "a", { kind: "group", nodeIds: ["a", "c", "absent"] }).nodeIds).toEqual(["a", "c"]);
  });
  it("reports missing/disconnected roots and cycles instead of silently doing nothing", () => {
    const g = tree();
    expect(resolveDragMembers(g, "a", { kind: "branch", rootId: "missing" }).error).toMatch(/root/);
    expect(resolveDragMembers(g, "isolated", { kind: "branch", rootId: "r" }).error).toMatch(/disconnected/);
    g.addEdge("b", "r");
    expect(resolveDragMembers(g, "a", { kind: "branch", rootId: "r" }).error).toMatch(/cycle/);
    const t = setup({ kind: "branch", rootId: "missing" });
    t.down("a");
    expect(t.events.onUnavailable).toHaveBeenCalledOnce();
    expect(t.events.onStart).not.toHaveBeenCalled();
    t.controller.unbind();
  });
  it("blur releases pins and the manipulation lock", () => {
    const t = setup();
    t.down("a");
    window.dispatchEvent(new Event("blur"));
    expect(t.events.onEnd).toHaveBeenCalledOnce();
    expect(t.panning()).toBe(true);
    t.controller.unbind();
  });
});
