import { forceLink, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface MotionSettings {
  linkStrength?: number;
  anchorStrength?: number;
  velocityDecay?: number;
  alphaDecay?: number;
}

export interface MotionNode {
  id: string;
  x: number;
  y: number;
  referenceX: number;
  referenceY: number;
  anchorX: number;
  anchorY: number;
}

export interface MotionGraph {
  nodes: MotionNode[];
  links: { source: string; target: string }[];
}

export type MotionPoint = { id: string; x: number; y: number };

interface Particle extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
}

export const DEFAULT_MOTION_SETTINGS = {
  linkStrength: 0.35,
  anchorStrength: 0.02,
  velocityDecay: 0.45,
  alphaDecay: 0.025,
};

/** Elastic refinement, not another global layout. No charge or origin gravity:
 * the prepared arrangement is an equilibrium until the user edits it. Normalize
 * by geometric edge length so Graphviz units do not tune the physics.
 */
export function createElasticSimulation(graph: MotionGraph, options: MotionSettings = {}) {
  const settings = { ...DEFAULT_MOTION_SETTINGS, ...options };

  for (const [key, value] of Object.entries(settings)) {
    if (!Number.isFinite(value) || value < 0 || value > 1 || (key === "alphaDecay" && value === 0))
      throw new Error(`Invalid motion setting: ${key}`);
  }

  const references = new Map(graph.nodes.map((n) => [n.id, n]));
  const lengths = graph.links.map((link) => {
    const a = references.get(link.source)!;
    const b = references.get(link.target)!;

    return Math.hypot(a.referenceX - b.referenceX, a.referenceY - b.referenceY);
  });

  const positive = lengths.filter((length) => length > 0 && Number.isFinite(length)).sort((a, b) => a - b);
  const unit = positive[Math.floor(positive.length / 2)] ?? 1;
  const origin = graph.nodes[0] ?? { x: 0, y: 0 };

  const nodes: Particle[] = graph.nodes.map((n) => ({
    id: n.id,
    x: (n.x - origin.x) / unit,
    y: (n.y - origin.y) / unit,
    anchorX: (n.anchorX - origin.x) / unit,
    anchorY: (n.anchorY - origin.y) / unit,
  }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const xForce = forceX<Particle>((n) => n.anchorX).strength(settings.anchorStrength);
  const yForce = forceY<Particle>((n) => n.anchorY).strength(settings.anchorStrength);
  const links = graph.links.map((link, i) => ({ ...link, distance: lengths[i] / unit }));

  const simulation = forceSimulation(nodes)
    .stop()
    .velocityDecay(settings.velocityDecay)
    .alphaDecay(settings.alphaDecay)
    .force(
      "links",
      forceLink<Particle, (typeof links)[number]>(links)
        .id((n) => n.id)
        .distance((link) => link.distance)
        .strength(settings.linkStrength)
        .iterations(2),
    )
    .force("anchorX", xForce)
    .force("anchorY", yForce);

  let pinned = false;

  return {
    pin(points: MotionPoint[], released: MotionPoint[] = []) {
      for (const n of nodes) {
        n.fx = null;
        n.fy = null;
      }

      for (const point of released) {
        const n = byId.get(point.id);
        if (!n) continue;
        n.x = n.anchorX = (point.x - origin.x) / unit;
        n.y = n.anchorY = (point.y - origin.y) / unit;
        n.vx = n.vy = 0;
      }

      for (const point of points) {
        const n = byId.get(point.id);
        if (!n) continue;
        n.x = n.fx = (point.x - origin.x) / unit;
        n.y = n.fy = (point.y - origin.y) / unit;
        n.vx = n.vy = 0;
      }

      xForce.x((n) => n.anchorX);
      yForce.y((n) => n.anchorY);
      pinned = points.length > 0;
      simulation.alphaTarget(pinned ? 0.25 : 0).alpha(Math.max(simulation.alpha(), 0.35));
    },
    tick(iterations = 1) {
      simulation.tick(iterations);
    },
    settled: () => !pinned && simulation.alpha() < simulation.alphaMin(),
    positions: () => new Float64Array(nodes.flatMap((n) => [origin.x + n.x * unit, origin.y + n.y * unit])),
  };
}
