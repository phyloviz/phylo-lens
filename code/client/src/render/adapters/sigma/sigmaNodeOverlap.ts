import type Graph from "graphology";
import type Sigma from "sigma";

import {
  LAYOUT_SERVER,
  type PositionedGraph,
} from "../../../contracts/positioned";

export const NODE_OVERLAP_ITERATIONS = 8;
export const NODE_OVERLAP_PADDING_PX = 3;
export const NODE_OVERLAP_MAX_STEP_PX = 4;
export const NODE_OVERLAP_MAX_DISPLACEMENT_PX = 24;

interface ViewportNode {
  id: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  radius: number;
}

export interface CachedNodePosition {
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
}

export type CachedNodePositionMap = Map<string, CachedNodePosition>;

export function nodeWithCachedOverlapPosition(
  node: PositionedGraph["nodes"][number],
  cache: CachedNodePositionMap,
): PositionedGraph["nodes"][number] {
  const cached = cache.get(node.id);
  if (
    !cached ||
    !sameCoordinate(cached.anchorX, node.x) ||
    !sameCoordinate(cached.anchorY, node.y)
  ) {
    return node;
  }

  return {
    ...node,
    x: cached.x,
    y: cached.y,
  };
}

export function removeRenderedNodeOverlaps(
  graph: Graph,
  sigma: Sigma,
  positionedGraph: PositionedGraph,
): CachedNodePositionMap {
  if (
    positionedGraph.viewMeta.layout !== LAYOUT_SERVER ||
    graph.order < 2
  ) {
    return new Map();
  }

  const anchorByNodeId = new Map(
    positionedGraph.nodes.map((node) => [
      node.id,
      { x: node.x, y: node.y },
    ]),
  );
  const nodes = graph.nodes().map((nodeId) => {
    const attributes = graph.getNodeAttributes(nodeId);
    const currentViewport = sigma.graphToViewport({
      x: Number(attributes.x),
      y: Number(attributes.y),
    });
    const graphAnchor = anchorByNodeId.get(nodeId) ?? {
      x: Number(attributes.x),
      y: Number(attributes.y),
    };
    const anchorViewport = sigma.graphToViewport(graphAnchor);

    return {
      id: nodeId,
      anchorX: anchorViewport.x,
      anchorY: anchorViewport.y,
      x: currentViewport.x,
      y: currentViewport.y,
      radius: Math.max(1, Number(attributes.size) || 1),
    };
  });
  const maxRadius = Math.max(...nodes.map((node) => node.radius));
  const cellSize = Math.max(4, maxRadius * 2 + NODE_OVERLAP_PADDING_PX);

  for (let iteration = 0; iteration < NODE_OVERLAP_ITERATIONS; iteration += 1) {
    if (!separateOverlappingNodes(nodes, cellSize)) {
      break;
    }
  }

  const nextCache: CachedNodePositionMap = new Map();
  nodes.forEach((node) => {
    const graphPosition = sigma.viewportToGraph({ x: node.x, y: node.y });
    graph.setNodeAttribute(node.id, "x", graphPosition.x);
    graph.setNodeAttribute(node.id, "y", graphPosition.y);
    const anchor = anchorByNodeId.get(node.id);
    if (anchor) {
      nextCache.set(node.id, {
        anchorX: anchor.x,
        anchorY: anchor.y,
        x: graphPosition.x,
        y: graphPosition.y,
      });
    }
  });

  return nextCache;
}

function separateOverlappingNodes(
  nodes: ViewportNode[],
  cellSize: number,
): boolean {
  const grid = buildSpatialGrid(nodes, cellSize);
  const displacement = new Map<string, { x: number; y: number }>();
  let moved = false;

  nodes.forEach((node) => {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        grid
          .get(spatialCellKey(cellX + offsetX, cellY + offsetY))
          ?.forEach((neighbor) => {
            if (node.id >= neighbor.id) {
              return;
            }

            const minimumDistance =
              node.radius + neighbor.radius + NODE_OVERLAP_PADDING_PX;
            let deltaX = neighbor.x - node.x;
            let deltaY = neighbor.y - node.y;
            let distance = Math.hypot(deltaX, deltaY);

            if (distance >= minimumDistance) {
              return;
            }

            if (distance < 0.001) {
              const angle = deterministicPairAngle(node.id, neighbor.id);
              deltaX = Math.cos(angle);
              deltaY = Math.sin(angle);
              distance = 1;
            }

            const step = Math.min(
              NODE_OVERLAP_MAX_STEP_PX,
              (minimumDistance - distance) / 2,
            );
            const unitX = deltaX / distance;
            const unitY = deltaY / distance;
            addDisplacement(
              displacement,
              node.id,
              -unitX * step,
              -unitY * step,
            );
            addDisplacement(
              displacement,
              neighbor.id,
              unitX * step,
              unitY * step,
            );
            moved = true;
          });
      }
    }
  });

  nodes.forEach((node) => {
    const delta = displacement.get(node.id);
    if (!delta) {
      return;
    }

    const nextX = node.x + delta.x;
    const nextY = node.y + delta.y;
    const anchorDeltaX = nextX - node.anchorX;
    const anchorDeltaY = nextY - node.anchorY;
    const anchorDistance = Math.hypot(anchorDeltaX, anchorDeltaY);
    const anchorScale =
      anchorDistance > NODE_OVERLAP_MAX_DISPLACEMENT_PX
        ? NODE_OVERLAP_MAX_DISPLACEMENT_PX / anchorDistance
        : 1;

    node.x = node.anchorX + anchorDeltaX * anchorScale;
    node.y = node.anchorY + anchorDeltaY * anchorScale;
  });

  return moved;
}

function buildSpatialGrid(
  nodes: ViewportNode[],
  cellSize: number,
): Map<string, ViewportNode[]> {
  const grid = new Map<string, ViewportNode[]>();

  nodes.forEach((node) => {
    const key = spatialCellKey(
      Math.floor(node.x / cellSize),
      Math.floor(node.y / cellSize),
    );
    const cell = grid.get(key);
    if (cell) {
      cell.push(node);
    } else {
      grid.set(key, [node]);
    }
  });

  return grid;
}

function spatialCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function addDisplacement(
  displacement: Map<string, { x: number; y: number }>,
  nodeId: string,
  x: number,
  y: number,
): void {
  const current = displacement.get(nodeId);
  if (current) {
    current.x += x;
    current.y += y;
  } else {
    displacement.set(nodeId, { x, y });
  }
}

function deterministicPairAngle(leftId: string, rightId: string): number {
  const value = `${leftId}:${rightId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function sameCoordinate(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}
