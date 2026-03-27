import Graph from "graphology";
import forceLayout from "graphology-layout-force";

import { CanonicalDataset } from "../contracts/canonical";
import {
  LAYOUT_FORCE,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
} from "../contracts/positioned";

export const DEFAULT_LAYER_GAP = 150;
export const DEFAULT_NODE_GAP = 120;
export const DEFAULT_ROOT_Y = 0;
export const DEFAULT_FORCE_ITERATIONS = 120;

export const LAYOUT_MODE_DETERMINISTIC = "deterministic";
export const LAYOUT_MODE_FORCE = "force";

export type TreeLayoutMode =
  | typeof LAYOUT_MODE_DETERMINISTIC
  | typeof LAYOUT_MODE_FORCE;

export interface SimpleTreeLayoutOptions {
  layerGap?: number;
  nodeGap?: number;
  mode?: TreeLayoutMode;
  forceIterations?: number;
}

interface LevelMap {
  [nodeId: string]: number;
}

// Build a deterministic positioned graph using parent-child levels from edges.
export function buildSimpleTreeLayout(
  dataset: CanonicalDataset,
  options: SimpleTreeLayoutOptions = {},
): PositionedGraph {
  const layerGap = options.layerGap ?? DEFAULT_LAYER_GAP;
  const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
  const mode = options.mode ?? LAYOUT_MODE_DETERMINISTIC;

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
      // Center each depth layer around x=0 for balanced tree readability.
      const x = (index - centerOffset) * nodeGap;
      const y = DEFAULT_ROOT_Y + level * layerGap;
      nodes.push({ id, x, y });
    });
  }

  const edges: PositionedEdge[] = dataset.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

  const finalNodes =
    mode === LAYOUT_MODE_FORCE
      ? applyForceRefinement(nodes, edges, options.forceIterations)
      : nodes;

  return {
    nodes: finalNodes,
    edges,
    viewMeta: {
      layout: LAYOUT_FORCE,
      lodLevel: 0,
    },
  };
}

// Refine deterministic coordinates using a force-directed pass.
function applyForceRefinement(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  iterations = DEFAULT_FORCE_ITERATIONS,
): PositionedNode[] {
  const graph = new Graph();

  nodes.forEach((node) => {
    graph.addNode(node.id, {
      x: node.x,
      y: node.y,
      size: node.size,
      color: node.color,
      ...(node.attributes ?? {}),
    });
  });

  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      return;
    }

    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      ...(edge.attributes ?? {}),
    });
  });

  forceLayout.assign(graph, {
    maxIterations: Math.max(1, iterations),
    settings: {
      attraction: 0.0009,
      repulsion: 0.16,
      gravity: 0.00012,
      inertia: 0.7,
      maxMove: 120,
    },
  });

  return nodes.map((node) => {
    const attributes = graph.getNodeAttributes(node.id) as Record<
      string,
      unknown
    >;
    return {
      ...node,
      x: Number(attributes.x ?? node.x),
      y: Number(attributes.y ?? node.y),
    };
  });
}

// Compute deterministic depth levels from edge directions.
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

// Group node ids by level to simplify coordinate assignment.
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
