import { describe, expect, it } from "vitest";
import { createElasticSimulation, type MotionGraph } from "../src/render/adapters/sigma/motion/elasticSimulation";

function tree(scale = 1): MotionGraph {
  const nodes = Array.from({ length: 127 }, (_, i) => {
    const level = Math.floor(Math.log2(i + 1));
    const x = (scale * 12 * (i - (2 ** level - 1) + 0.5)) / 2 ** level,
      y = scale * level * 0.3;
    return { id: String(i), x, y, referenceX: x, referenceY: y, anchorX: x, anchorY: y };
  });
  return { nodes, links: nodes.slice(1).map((n) => ({ source: String(Math.floor((+n.id - 1) / 2)), target: n.id })) };
}
function settle(sim: ReturnType<typeof createElasticSimulation>) {
  for (let i = 0; i < 1000 && !sim.settled(); i++) sim.tick();
  expect(sim.settled()).toBe(true);
}
describe("elastic motion on a prepared layout", () => {
  it.each([0.001, 1, 1000])("preserves the server tree without oscillation at scale %s", (scale) => {
    const graph = tree(scale),
      sim = createElasticSimulation(graph);
    settle(sim);
    const positions = sim.positions();
    graph.nodes.forEach((n, i) => {
      expect(positions[i * 2] / scale).toBeCloseTo(n.x / scale, 6);
      expect(positions[i * 2 + 1] / scale).toBeCloseTo(n.y / scale, 6);
    });
  });
  it("holds a far-away drag exactly, moves its neighbours, and settles after release", () => {
    const graph = tree(),
      sim = createElasticSimulation(graph);
    settle(sim);
    const point = { id: "0", x: 50, y: -30 };
    sim.pin([point]);
    sim.tick(80);
    expect([...sim.positions().slice(0, 2)]).toEqual([50, -30]);
    expect(sim.positions()[2]).not.toBeCloseTo(graph.nodes[1].x, 2);
    expect(sim.settled()).toBe(false);
    sim.pin([], [point]);
    settle(sim);
    expect([...sim.positions()].every(Number.isFinite)).toBe(true);
    // The manually moved node retains an edited anchor, rather than returning home.
    expect(sim.positions()[0]).toBeGreaterThan(graph.nodes[0].x + 5);
  });
  it("is independent of coordinate units during the same drag", () => {
    const results = [0.001, 1, 1000].map((scale) => {
      const sim = createElasticSimulation(tree(scale));
      sim.pin([{ id: "0", x: 8 * scale, y: 2 * scale }]);
      sim.tick(50);
      sim.pin([], [{ id: "0", x: 8 * scale, y: 2 * scale }]);
      settle(sim);
      return [...sim.positions()].map((v) => v / scale);
    });
    results.forEach((positions) => positions.forEach((value, i) => expect(value).toBeCloseTo(results[1][i], 6)));
  });

  it("resolves node overlap when collision handling is enabled", () => {
    const graph: MotionGraph = {
      nodes: [
        { id: "a", x: 0, y: 0, referenceX: 0, referenceY: 0, anchorX: 0, anchorY: 0 },
        { id: "b", x: 0, y: 0, referenceX: 0, referenceY: 0, anchorX: 0, anchorY: 0 },
      ],
      links: [],
    };
    const sim = createElasticSimulation(graph, {
      anchorStrength: 0,
      collisionRadius: 2,
      collisionStrength: 1,
      collisionIterations: 4,
    });

    sim.tick(20);

    const positions = sim.positions();
    expect(Math.hypot(positions[2] - positions[0], positions[3] - positions[1])).toBeGreaterThan(3.9);
  });

  it("scales collision radius with relative visual node size", () => {
    const graph: MotionGraph = {
      nodes: [
        {
          id: "small",
          x: 0,
          y: 0,
          referenceX: 0,
          referenceY: 0,
          anchorX: 0,
          anchorY: 0,
          size: 1,
        },
        {
          id: "large",
          x: 0,
          y: 0,
          referenceX: 0,
          referenceY: 0,
          anchorX: 0,
          anchorY: 0,
          size: 4,
        },
        {
          id: "median",
          x: 100,
          y: 0,
          referenceX: 100,
          referenceY: 0,
          anchorX: 100,
          anchorY: 0,
          size: 2,
        },
      ],
      links: [],
    };

    const sim = createElasticSimulation(graph, {
      anchorStrength: 0,
      collisionRadius: 1,
      collisionStrength: 1,
      collisionIterations: 4,
    });

    sim.tick(20);

    const positions = sim.positions();
    const distance = Math.hypot(positions[2] - positions[0], positions[3] - positions[1]);

    expect(distance).toBeGreaterThan(2.4);
  });
});
