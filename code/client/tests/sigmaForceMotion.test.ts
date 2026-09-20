import { describe, expect, it, vi, beforeEach } from "vitest";
import Graph from "graphology";
import type { MotionCommand, MotionFrame } from "../src/render/adapters/sigma/motion/elastic.worker";
const workers = vi.hoisted(() => ({
  instances: [] as {
    onmessage: ((event: { data: MotionFrame }) => void) | null;
    terminate: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("../src/render/adapters/sigma/motion/elastic.worker?worker&inline", () => ({
  default: class {
    onmessage = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      workers.instances.push(this);
    }
  },
}));
import createMotion from "../src/render/adapters/sigma/motion/sigmaForceMotion";
const graph = () => {
  const g = new Graph();
  g.addNode("a", { x: 0, y: 0 });
  g.addNode("b", { x: 1, y: 1 });
  g.addEdge("a", "b");
  return g;
};
const callbacks = () => ({
  reference: () => undefined,
  anchor: () => undefined,
  constrain: (_id: string, p: { x: number; y: number }) => p,
});
beforeEach(() => {
  workers.instances.length = 0;
});
function emit(index: number, revision: number) {
  workers.instances[index].onmessage?.({
    data: { revision, positions: new Float64Array([9, 8, 7, 6]), settled: false },
  });
}
function lastCommand(index = 0): MotionCommand {
  return workers.instances[index].postMessage.mock.lastCall![0];
}
describe("elastic worker lifecycle", () => {
  it("freezes on pause and ignores queued results from terminated workers", () => {
    const g = graph(),
      m = createMotion({}, callbacks());
    m.start(g);
    const revision = lastCommand().revision;
    m.setEnabled(false);
    emit(0, revision);
    expect(g.getNodeAttribute("a", "x")).toBe(0);
    expect(workers.instances[0].terminate).toHaveBeenCalledOnce();
    m.setEnabled(true);
    emit(0, revision);
    expect(g.getNodeAttribute("a", "x")).toBe(0);
    emit(1, lastCommand(1).revision);
    expect(g.getNodeAttribute("a", "x")).toBe(9);
    m.dispose();
  });
  it("rejects an in-flight result superseded by a drag or release", () => {
    const g = graph(),
      m = createMotion({}, callbacks());
    m.start(g);
    const revision = lastCommand().revision;
    m.setPins([{ id: "a", x: 30, y: 40 }]);
    emit(0, revision);
    expect(g.getNodeAttribute("a", "x")).toBe(0);
    const dragRevision = lastCommand().revision;
    m.setPins([], [{ id: "a", x: 30, y: 40 }]);
    emit(0, dragRevision);
    expect(g.getNodeAttribute("a", "x")).toBe(0);
    m.dispose();
  });
  it("preserves the paused preference across graph replacement and transitions", () => {
    const m = createMotion({ enabled: false }, callbacks());
    m.start(graph());
    expect(workers.instances).toHaveLength(0);
    m.setEnabled(true);
    m.suspend(true);
    m.start(graph());
    expect(workers.instances).toHaveLength(1);
    m.setEnabled(false);
    m.suspend(false);
    expect(workers.instances).toHaveLength(1);
    m.setEnabled(true);
    expect(workers.instances).toHaveLength(2);
    m.dispose();
  });
});

it("keeps neighbour updates flowing during frequent pointer updates", () => {
  const g = graph();
  const m = createMotion({}, { ...callbacks(), constrain: (id, point) => (id === "a" ? { x: 40, y: 50 } : point) });
  m.start(g);
  m.setPins([{ id: "a", x: 30, y: 40 }]);
  const previousPointerRevision = lastCommand().revision;
  m.setPins([{ id: "a", x: 40, y: 50 }]);
  emit(0, previousPointerRevision);
  expect(g.getNodeAttributes("a")).toMatchObject({ x: 40, y: 50 });
  expect(g.getNodeAttributes("b")).toMatchObject({ x: 7, y: 6 });
  m.dispose();
});
