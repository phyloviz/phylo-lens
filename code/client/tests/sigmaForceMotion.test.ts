import { describe, expect, it, vi, beforeEach } from "vitest";
import Graph from "graphology";
const workers = vi.hoisted(() => ({
  instances: [] as { start: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }[],
}));
vi.mock("graphology-layout-forceatlas2/worker.js", () => ({
  default: class {
    start = vi.fn();
    kill = vi.fn();
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
beforeEach(() => (workers.instances.length = 0));
describe("worker motion lifecycle", () => {
  it("runs by default without a timed auto-stop, pauses and resumes", () => {
    vi.useFakeTimers();
    const m = createMotion();
    m.start(graph());
    expect(m.isEnabled()).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(workers.instances[0].kill).not.toHaveBeenCalled();
    m.setEnabled(false);
    expect(workers.instances[0].kill).toHaveBeenCalledOnce();
    m.setEnabled(true);
    expect(workers.instances).toHaveLength(2);
    m.dispose();
    vi.useRealTimers();
  });
  it("preserves paused preference across viewport replacement and transition suspension", () => {
    const m = createMotion({ enabled: false });
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
  it("detaches old graph listeners on replacement/disposal", () => {
    const onTick = vi.fn(),
      a = graph(),
      b = graph(),
      m = createMotion({}, { onTick });
    m.start(a);
    m.start(b);
    a.emit("eachNodeAttributesUpdated", {});
    expect(onTick).not.toHaveBeenCalled();
    b.emit("eachNodeAttributesUpdated", {});
    expect(onTick).toHaveBeenCalledOnce();
    m.dispose();
    b.emit("eachNodeAttributesUpdated", {});
    expect(onTick).toHaveBeenCalledOnce();
  });
});
