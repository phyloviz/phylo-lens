import { afterEach, describe, expect, it, vi } from "vitest";
import Graph from "graphology";
import createSigmaForceMotion from "../src/render/adapters/sigma/motion/sigmaForceMotion";
const workers = vi.hoisted(
  () => [] as { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[],
);
vi.mock("../src/render/adapters/sigma/motion/elastic.worker?worker&inline", () => ({
  default: class {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  },
}));
afterEach(() => {
  workers.length = 0;
  vi.useRealTimers();
});
describe("motion camera geometry lifecycle", () => {
  it("reheats a settled forest after scale changes, preserves anchors, and cancels pending work on pause", async () => {
    vi.useFakeTimers();
    const graph = new Graph();
    graph.addNode("a", { x: 0, y: 0, size: 5 });
    graph.addNode("b", { x: 1, y: 0, size: 5 });
    let radius = 0.01;
    const motion = createSigmaForceMotion(
      {},
      {
        reference: () => ({ x: 0, y: 0 }),
        anchor: () => ({ x: 4, y: 5 }),
        constrain: (_id, p) => p,
        collisionRadius: () => radius,
      },
    );
    motion.start(graph);
    expect(workers).toHaveLength(1);
    motion.refreshGeometry(); // unchanged camera scale, as in panning
    await vi.advanceTimersByTimeAsync(200);
    expect(workers).toHaveLength(1);
    radius *= 2;
    motion.refreshGeometry();
    await vi.advanceTimersByTimeAsync(120);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].postMessage.mock.calls[0][0].graph.nodes[0]).toMatchObject({
      anchorX: 4,
      anchorY: 5,
      collisionRadius: radius,
    });
    radius *= 2;
    motion.refreshGeometry();
    motion.setEnabled(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(workers).toHaveLength(2);
    motion.dispose();
  });
});
