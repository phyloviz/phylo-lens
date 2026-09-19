import { SigmaRenderer } from "../../src/render/adapters/sigma/sigmaRenderer";
import type { PositionedGraph } from "../../src/contracts/positioned";
// Deterministic server-position fixture. Use the real Sigma renderer and real worker.
const nodes = Array.from({ length: 127 }, (_, i) => {
  const level = Math.floor(Math.log2(i + 1));
  return { id: String(i), x: (12 * (i - (2 ** level - 1) + 0.5)) / 2 ** level, y: level * 0.3, size: 5 };
});
const snapshot: PositionedGraph = {
  nodes,
  edges: nodes.slice(1).map((n) => ({ id: `e${n.id}`, source: String(Math.floor((+n.id - 1) / 2)), target: n.id })),
  viewMeta: { layout: "server", lodLevel: 0, globalBounds: { minX: 0, maxX: 12, minY: -2, maxY: 4 } },
};
const renderer = new SigmaRenderer();
renderer.mount({ container: document.querySelector<HTMLElement>("#graph")! });
renderer.render(snapshot);
Object.assign(window, { motionFixture: { renderer, snapshot } });
