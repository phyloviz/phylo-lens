import { forceCollide, forceLink, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface MotionSettings {
  linkStrength?: number;
  anchorStrength?: number;
  velocityDecay?: number;
  alphaDecay?: number;
  /** Radius relative to the median edge length. Zero keeps collision handling disabled. */
  collisionRadius?: number;
  collisionStrength?: number;
  collisionIterations?: number;
}

export interface MotionNode {
  id: string;
  x: number;
  y: number;
  referenceX: number;
  referenceY: number;
  anchorX: number;
  anchorY: number;
  size?: number;
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
  size: number;
}

export const DEFAULT_MOTION_SETTINGS = {
  linkStrength: 0.35,
  anchorStrength: 0.06,
  velocityDecay: 0.5,
  alphaDecay: 0.03,
  collisionRadius: 0.15,
  collisionStrength: 1,
  collisionIterations: 2,
};
/** Elastic refinement, not another global layout. No charge or origin gravity:
 * the prepared arrangement is an equilibrium until the user edits it. Normalize
 * by geometric edge length so Graphviz units do not tune the physics.
 */
export function createElasticSimulation(graph: MotionGraph, options: MotionSettings = {}) {
  const settings = { ...DEFAULT_MOTION_SETTINGS, ...options };

  const in01 = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

  const validators = {
    linkStrength: in01,
    anchorStrength: in01,
    velocityDecay: in01,
    alphaDecay: (v: number) => Number.isFinite(v) && v > 0,
    collisionRadius: (v: number) => Number.isFinite(v) && v >= 0,
    collisionStrength: in01,
    collisionIterations: (v: number) => Number.isInteger(v) && v >= 1,
  };

  if (!Object.entries(validators).every(([key, validate]) => validate(settings[key as keyof typeof settings]))) {
    throw new Error("Invalid motion setting");
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

  const sizes = graph.nodes
    .map((node) => node.size)
    .filter((size): size is number => typeof size === "number" && Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);

  const medianSize =
    sizes.length === 0
      ? 1
      : sizes.length % 2 === 1
        ? sizes[Math.floor(sizes.length / 2)]
        : (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2;

  const nodes: Particle[] = graph.nodes.map((n) => ({
    id: n.id,
    x: (n.x - origin.x) / unit,
    y: (n.y - origin.y) / unit,
    anchorX: (n.anchorX - origin.x) / unit,
    anchorY: (n.anchorY - origin.y) / unit,
    size: typeof n.size === "number" && Number.isFinite(n.size) && n.size > 0 ? n.size : medianSize,
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

  if (settings.collisionRadius > 0) {
    simulation.force(
      "collide",
      forceCollide<Particle>((node) => settings.collisionRadius * (node.size / medianSize))
        .strength(settings.collisionStrength)
        .iterations(settings.collisionIterations),
    );
  }

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
