import {
  type CanonicalDataset,
  SOURCE_FORMAT_NEWICK,
} from "../../contracts/models";
import {
  LAYOUT_SERVER,
  type PositionedGraph,
} from "../../contracts/positioned";
import {
  DEFAULT_LAYER_GAP,
  DEFAULT_NODE_GAP,
  buildForceDirectedLayout,
} from "../../layout/forceDirectedLayout";
import type { RenderNewickOptions } from "./graphWorkbench.ts";

export function buildSliceDataset(
  datasetId: string,
  nodes: CanonicalDataset["nodes"],
  edges: CanonicalDataset["edges"],
  metadataSchema: CanonicalDataset["metadata_schema"],
  metadataByNodeId: CanonicalDataset["metadata_by_node_id"],
): CanonicalDataset {
  const visibleNodeIds = new Set(nodes.map((node) => node.id));

  const visibleMetadataByNodeId = Object.fromEntries(
    Object.entries(metadataByNodeId).filter(([nodeId]) =>
      visibleNodeIds.has(nodeId),
    ),
  );

  return {
    dataset_id: datasetId,
    nodes,
    edges,
    metadata_schema: metadataSchema,
    metadata_by_node_id: visibleMetadataByNodeId,
    source: {
      format: SOURCE_FORMAT_NEWICK,
      generated_at: new Date(0).toISOString(),
    },
  };
}

export function buildPositionedSliceGraph(
  dataset: CanonicalDataset,
  options: RenderNewickOptions["layout"] = {},
  previousGraph: PositionedGraph | null = null,
): PositionedGraph {
  const initialNodePositions = getInitialNodePositions(previousGraph);

  if (dataset.nodes.every(hasServerCoordinates)) {
    return buildServerPositionedGraph(dataset, initialNodePositions);
  }

  return buildForcePositionedGraph(dataset, options, initialNodePositions);
}

export function emptyGraph(): PositionedGraph {
  return {
    nodes: [],
    edges: [],
    viewMeta: {
      layout: "force",
      lodLevel: 0,
      sliceNodeCount: 0,
      sliceEdgeCount: 0,
      collapsedClusterCount: 0,
    },
  };
}

function getInitialNodePositions(
  previousGraph: PositionedGraph | null,
): Record<string, { x: number; y: number }> | undefined {
  if (!previousGraph) {
    return undefined;
  }

  return Object.fromEntries(
    previousGraph.nodes.map((node) => [
      node.id,
      {
        x: node.x,
        y: node.y,
      },
    ]),
  );
}

function buildServerPositionedGraph(
  dataset: CanonicalDataset,
  initialNodePositions?: Record<string, { x: number; y: number }>,
): PositionedGraph {
  return {
    nodes: dataset.nodes.map((node) =>
      buildServerPositionedNode(node, initialNodePositions),
    ),
    edges: dataset.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    viewMeta: {
      layout: LAYOUT_SERVER,
      lodLevel: 0,
    },
  };
}

function buildServerPositionedNode(
  node: CanonicalDataset["nodes"][number],
  initialNodePositions?: Record<string, { x: number; y: number }>,
): PositionedGraph["nodes"][number] {
  const previousPosition = initialNodePositions?.[node.id];

  if (previousPosition) {
    return {
      id: node.id,
      x: previousPosition.x,
      y: previousPosition.y,
      attributes: buildNodeAttributes(node),
    };
  }

  const anchored = serverAnchoredPosition(node);

  return {
    id: node.id,
    x: anchored.x,
    y: anchored.y,
    attributes: buildNodeAttributes(node),
  };
}

function buildForcePositionedGraph(
  dataset: CanonicalDataset,
  options: RenderNewickOptions["layout"],
  initialNodePositions?: Record<string, { x: number; y: number }>,
): PositionedGraph {
  return buildForceDirectedLayout(dataset, {
    forceIterations: options?.forceIterations,
    initialNodePositions,
    normalizeOutput: true,
  });
}

function buildNodeAttributes(
  node: CanonicalDataset["nodes"][number],
): PositionedGraph["nodes"][number]["attributes"] {
  return {
    cluster_id: node.cluster_id,
    is_cluster_proxy: node.is_cluster_proxy === true,
    subtree_size: node.subtree_size,
    leaf_count: node.leaf_count,
  };
}

function hasServerCoordinates(
  node: CanonicalDataset["nodes"][number],
): boolean {
  return (
    typeof node.x === "number" &&
    Number.isFinite(node.x) &&
    typeof node.y === "number" &&
    Number.isFinite(node.y)
  );
}

function serverAnchoredPosition(node: CanonicalDataset["nodes"][number]): {
  x: number;
  y: number;
} {
  return {
    x: (node.x as number) * DEFAULT_NODE_GAP,
    y: (node.y as number) * DEFAULT_LAYER_GAP,
  };
}
