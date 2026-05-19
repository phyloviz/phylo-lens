import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

import type { CanonicalDataset } from "../contracts/models";
import { LAYOUT_FORCE } from "../contracts/positioned";
import type {
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
} from "../contracts/positioned";

export const DEFAULT_LAYER_GAP = 170;
export const DEFAULT_NODE_GAP = 150;
export const DEFAULT_FORCEATLAS2_ITERATIONS = 220;
export const FORCEATLAS2_SEED_SPREAD_X = 320;
export const FORCEATLAS2_SEED_SPREAD_Y = 220;
export const FORCEATLAS2_PROXY_RADIUS = 140;
export const FORCEATLAS2_ANCHOR_BLEND = 0.2;
export const FORCEATLAS2_COLLINEAR_Y_RATIO = 0.12;
export const FORCEATLAS2_COLLINEAR_ANCHOR_SCALE = 0.25;
export const LAYOUT_MODE_FORCE = "force";

export type ForceLayoutMode = typeof LAYOUT_MODE_FORCE;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface ForceDirectedLayoutOptions {
  layerGap?: number;
  nodeGap?: number;
  forceIterations?: number;
  initialNodePositions?: Record<string, { x: number; y: number }>;
  normalizeOutput?: boolean;
}

// Build a force-directed positioned graph seeded from deterministic node order.
export function buildForceDirectedLayout(
  dataset: CanonicalDataset,
  options: ForceDirectedLayoutOptions = {},
): PositionedGraph {
  if (dataset.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      viewMeta: {
        layout: LAYOUT_FORCE,
        lodLevel: 0,
      },
    };
  }

  const seededGraph = buildSeededGraph(dataset, options);
  return refinePositionedGraphWithForce(
    seededGraph,
    options.forceIterations,
    options.normalizeOutput,
  );
}

// Apply ForceAtlas2 over an existing positioned graph.
export function refinePositionedGraphWithForce(
  graph: PositionedGraph,
  iterations = DEFAULT_FORCEATLAS2_ITERATIONS,
  normalizeOutput = true,
): PositionedGraph {
  if (graph.nodes.length === 0) {
    return {
      ...graph,
      viewMeta: {
        ...graph.viewMeta,
        layout: LAYOUT_FORCE,
      },
    };
  }

  const layoutGraph = new Graph();
  const degreeByNodeId = computeDegreeByNodeId(graph.edges);
  const nodeCount = graph.nodes.length;
  const collinearSeedInput = isCollinearInputGraph(graph.nodes);

  graph.nodes.forEach((node, index) => {
    const seed = buildForceSeed(
      node,
      index,
      degreeByNodeId.get(node.id) ?? 0,
      nodeCount,
      collinearSeedInput,
    );
    layoutGraph.addNode(node.id, {
      x: seed.x,
      y: seed.y,
      size: node.size,
      color: node.color,
      ...(node.attributes ?? {}),
    });
  });

  graph.edges.forEach((edge) => {
    if (
      !layoutGraph.hasNode(edge.source) ||
      !layoutGraph.hasNode(edge.target)
    ) {
      return;
    }

    layoutGraph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      ...(edge.attributes ?? {}),
    });
  });

  const settings = forceAtlas2.inferSettings(layoutGraph);
  forceAtlas2.assign(layoutGraph, {
    iterations: Math.max(1, iterations),
    settings: {
      ...settings,
      adjustSizes: false,
      barnesHutOptimize: true,
      strongGravityMode: false,
      gravity: 0.02,
      scalingRatio: 18,
      slowDown: 1.4,
    },
  });

  const positionedNodes = graph.nodes.map((node) => {
    const attributes = layoutGraph.getNodeAttributes(node.id) as Record<
      string,
      unknown
    >;
    return {
      ...node,
      x: Number(attributes.x ?? node.x),
      y: Number(attributes.y ?? node.y),
    };
  });

  return {
    ...graph,
    nodes: normalizeOutput
      ? expandPackedLayout(positionedNodes)
      : positionedNodes,
    viewMeta: {
      ...graph.viewMeta,
      layout: LAYOUT_FORCE,
    },
  };
}

function buildSeededGraph(
  dataset: CanonicalDataset,
  options: ForceDirectedLayoutOptions,
): PositionedGraph {
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const sortedNodes = [...dataset.nodes].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const nodes: PositionedNode[] = sortedNodes.map((node, index) => {
    const priorPosition = options.initialNodePositions?.[node.id];
    if (priorPosition) {
      const angle = seededAngle(node.id, index);
      const offset = nodeGap * 0.08;
      return {
        id: node.id,
        x: priorPosition.x + Math.cos(angle) * offset,
        y: priorPosition.y + Math.sin(angle) * offset,
      };
    }

    const angle = index * GOLDEN_ANGLE + seededAngle(node.id, index) * 0.15;
    const radius = Math.sqrt(index + 1) * nodeGap;

    return {
      id: node.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  const edges: PositionedEdge[] = dataset.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

  return {
    nodes,
    edges,
    viewMeta: {
      layout: LAYOUT_FORCE,
      lodLevel: 0,
    },
  };
}

function computeDegreeByNodeId(edges: PositionedEdge[]): Map<string, number> {
  const degreeByNodeId = new Map<string, number>();

  edges.forEach((edge) => {
    degreeByNodeId.set(edge.source, (degreeByNodeId.get(edge.source) ?? 0) + 1);
    degreeByNodeId.set(edge.target, (degreeByNodeId.get(edge.target) ?? 0) + 1);
  });

  return degreeByNodeId;
}

function buildForceSeed(
  node: PositionedNode,
  index: number,
  degree: number,
  nodeCount: number,
  collinearSeedInput: boolean,
): { x: number; y: number } {
  const angle = seededAngle(node.id, index);
  const radialStep = 1 + Math.min(degree, 8) * 0.45;
  const proxyBoost = node.attributes?.is_cluster_proxy === true ? 1.2 : 1;
  const densitySpread = Math.min(
    2.4,
    1 + Math.log10(Math.max(nodeCount, 10)) * 0.35,
  );
  const seedSpreadX = FORCEATLAS2_SEED_SPREAD_X * densitySpread;
  const seedSpreadY = FORCEATLAS2_SEED_SPREAD_Y * densitySpread;
  const anchorBlend =
    node.attributes?.is_cluster_proxy === true
      ? FORCEATLAS2_ANCHOR_BLEND * 1.5
      : FORCEATLAS2_ANCHOR_BLEND;
  const effectiveAnchorBlend = collinearSeedInput
    ? anchorBlend * FORCEATLAS2_COLLINEAR_ANCHOR_SCALE
    : anchorBlend;

  return {
    x:
      node.x * effectiveAnchorBlend +
      Math.cos(angle) * seedSpreadX * radialStep * proxyBoost +
      (node.attributes?.is_cluster_proxy === true
        ? Math.cos(angle * 0.5) * FORCEATLAS2_PROXY_RADIUS
        : 0),
    y:
      node.y * effectiveAnchorBlend +
      Math.sin(angle) * seedSpreadY * radialStep * proxyBoost +
      (node.attributes?.is_cluster_proxy === true
        ? Math.sin(angle * 0.5) * FORCEATLAS2_PROXY_RADIUS
        : 0),
  };
}

function isCollinearInputGraph(nodes: PositionedNode[]): boolean {
  if (nodes.length <= 2) {
    return false;
  }

  let minX = nodes[0]?.x ?? 0;
  let maxX = minX;
  let minY = nodes[0]?.y ?? 0;
  let maxY = minY;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  });

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  return spanY / spanX <= FORCEATLAS2_COLLINEAR_Y_RATIO;
}

function seededAngle(nodeId: string, index: number): number {
  let hash = 2166136261;
  for (let offset = 0; offset < nodeId.length; offset += 1) {
    hash ^= nodeId.charCodeAt(offset);
    hash = Math.imul(hash, 16777619);
  }

  const normalized = ((hash >>> 0) + index * 2654435761) >>> 0;
  return (normalized / 0xffffffff) * Math.PI * 2;
}

function expandPackedLayout(nodes: PositionedNode[]): PositionedNode[] {
  if (nodes.length <= 1) {
    return nodes;
  }

  let minX = nodes[0]?.x ?? 0;
  let maxX = minX;
  let minY = nodes[0]?.y ?? 0;
  let maxY = minY;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  });

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scaleX = Math.max(1, 1100 / spanX);
  const scaleY = Math.max(1, 700 / spanY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return nodes.map((node) => ({
    ...node,
    x: (node.x - centerX) * scaleX,
    y: (node.y - centerY) * scaleY,
  }));
}
