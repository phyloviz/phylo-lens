import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

import { CanonicalDataset } from "../contracts/canonical";
import {
  LAYOUT_FORCE,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
} from "../contracts/positioned";

export const DEFAULT_LAYER_GAP = 170;
export const DEFAULT_NODE_GAP = 150;
export const DEFAULT_ROOT_Y = 0;
export const DEFAULT_FORCEATLAS2_ITERATIONS = 220;
export const FORCEATLAS2_SEED_SPREAD_X = 320;
export const FORCEATLAS2_SEED_SPREAD_Y = 220;
export const FORCEATLAS2_PROXY_RADIUS = 140;
export const LAYOUT_MODE_FORCE = "force";

export type TreeLayoutMode = typeof LAYOUT_MODE_FORCE;

export interface SimpleTreeLayoutOptions {
  layerGap?: number;
  nodeGap?: number;
  mode?: TreeLayoutMode;
  forceIterations?: number;
}

interface LevelMap {
  [nodeId: string]: number;
}

// Build a force-directed positioned graph seeded from deterministic tree levels.
export function buildSimpleTreeLayout(
  dataset: CanonicalDataset,
  options: SimpleTreeLayoutOptions = {},
): PositionedGraph {
  const seededGraph = buildSeededGraph(dataset, options);
  return refinePositionedGraphWithForce(
    seededGraph,
    options.forceIterations,
  );
}

// Apply ForceAtlas2 over an existing positioned graph.
export function refinePositionedGraphWithForce(
  graph: PositionedGraph,
  iterations = DEFAULT_FORCEATLAS2_ITERATIONS,
): PositionedGraph {
  const layoutGraph = new Graph();
  const degreeByNodeId = computeDegreeByNodeId(graph.edges);

  graph.nodes.forEach((node, index) => {
    const seed = buildForceSeed(node, index, degreeByNodeId.get(node.id) ?? 0);
    layoutGraph.addNode(node.id, {
      x: seed.x,
      y: seed.y,
      size: node.size,
      color: node.color,
      ...(node.attributes ?? {}),
    });
  });

  graph.edges.forEach((edge) => {
    if (!layoutGraph.hasNode(edge.source) || !layoutGraph.hasNode(edge.target)) {
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

  return {
    ...graph,
    nodes: expandPackedLayout(
      graph.nodes.map((node) => {
        const attributes = layoutGraph.getNodeAttributes(node.id) as Record<
          string,
          unknown
        >;
        return {
          ...node,
          x: Number(attributes.x ?? node.x),
          y: Number(attributes.y ?? node.y),
        };
      }),
    ),
    viewMeta: {
      ...graph.viewMeta,
      layout: LAYOUT_FORCE,
    },
  };
}

function buildSeededGraph(
  dataset: CanonicalDataset,
  options: SimpleTreeLayoutOptions,
): PositionedGraph {
  const layerGap = options.layerGap ?? DEFAULT_LAYER_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;

  const levelByNode = computeLevels(dataset);
  const grouped = groupByLevel(dataset, levelByNode);

  const nodes: PositionedNode[] = [];
  for (const level of Object.keys(grouped)
    .map((value) => Number(value))
    .sort((a, b) => a - b)) {
    const ids = grouped[level] ?? [];
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    const centerOffset = (sortedIds.length - 1) / 2;

    sortedIds.forEach((id, index) => {
      nodes.push({
        id,
        x: (index - centerOffset) * nodeGap,
        y: DEFAULT_ROOT_Y + level * layerGap,
      });
    });
  }

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

function computeLevels(dataset: CanonicalDataset): LevelMap {
  const parentToChildren = new Map<string, string[]>();
  const allNodeIds = new Set<string>(dataset.nodes.map((node) => node.id));
  const childIds = new Set<string>();

  dataset.edges.forEach((edge) => {
    const existingChildren = parentToChildren.get(edge.source) ?? [];
    existingChildren.push(edge.target);
    parentToChildren.set(edge.source, existingChildren);
    childIds.add(edge.target);
  });

  const roots = [...allNodeIds]
    .filter((id) => !childIds.has(id))
    .sort((a, b) => a.localeCompare(b));
  const levelByNode: LevelMap = {};
  const queue: Array<{ id: string; level: number }> = roots.map((id) => ({
    id,
    level: 0,
  }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const previousLevel = levelByNode[current.id];
    if (previousLevel !== undefined && previousLevel <= current.level) {
      continue;
    }

    levelByNode[current.id] = current.level;

    const children = (parentToChildren.get(current.id) ?? []).sort((a, b) =>
      a.localeCompare(b),
    );
    children.forEach((childId) => {
      queue.push({ id: childId, level: current.level + 1 });
    });
  }

  dataset.nodes.forEach((node) => {
    if (levelByNode[node.id] === undefined) {
      levelByNode[node.id] = 0;
    }
  });

  return levelByNode;
}

function groupByLevel(
  dataset: CanonicalDataset,
  levelByNode: LevelMap,
): Record<number, string[]> {
  return dataset.nodes.reduce<Record<number, string[]>>((acc, node) => {
    const level = levelByNode[node.id] ?? 0;
    const group = acc[level] ?? [];
    group.push(node.id);
    acc[level] = group;
    return acc;
  }, {});
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
): { x: number; y: number } {
  const angle = seededAngle(node.id, index);
  const radialStep = 1 + Math.min(degree, 8) * 0.45;
  const proxyBoost = node.attributes?.is_cluster_proxy === true ? 1.2 : 1;

  return {
    x:
      node.x +
      Math.cos(angle) * FORCEATLAS2_SEED_SPREAD_X * radialStep * proxyBoost +
      (node.attributes?.is_cluster_proxy === true
        ? Math.cos(angle * 0.5) * FORCEATLAS2_PROXY_RADIUS
        : 0),
    y:
      node.y +
      Math.sin(angle) * FORCEATLAS2_SEED_SPREAD_Y * radialStep * proxyBoost +
      (node.attributes?.is_cluster_proxy === true
        ? Math.sin(angle * 0.5) * FORCEATLAS2_PROXY_RADIUS
        : 0),
  };
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
