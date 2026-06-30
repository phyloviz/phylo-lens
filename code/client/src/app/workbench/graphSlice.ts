import {
  type CanonicalDataset,
  SOURCE_FORMAT_NEWICK,
} from "../../contracts/models";
import { LAYOUT_SERVER, type PositionedGraph } from "../../contracts/positioned";
import {
  DEFAULT_LAYER_GAP,
  DEFAULT_NODE_GAP,
  buildForceDirectedLayout,
} from "../../layout/forceDirectedLayout";
import type { RenderNewickOptions } from "./workbenchTypes";

export function buildSliceDataset(
  datasetId: string,
  nodes: CanonicalDataset["nodes"],
  edges: CanonicalDataset["edges"],
  metadataSchema: CanonicalDataset["metadata_schema"],
  metadataByNodeId: CanonicalDataset["metadata_by_node_id"],
  ancillaryRowsByNodeId: CanonicalDataset["ancillary_rows_by_node_id"] = {},
): CanonicalDataset {
  const visibleNodeIds = new Set(nodes.map((node) => node.id));

  const visibleMetadataByNodeId = Object.fromEntries(
    Object.entries(metadataByNodeId).filter(([nodeId]) =>
      visibleNodeIds.has(nodeId),
    ),
  );
  const visibleAncillaryRowsByNodeId = Object.fromEntries(
    Object.entries(ancillaryRowsByNodeId ?? {}).filter(([nodeId]) =>
      visibleNodeIds.has(nodeId),
    ),
  );

  return {
    dataset_id: datasetId,
    nodes,
    edges,
    metadata_schema: metadataSchema,
    metadata_by_node_id: visibleMetadataByNodeId,
    ancillary_rows_by_node_id: visibleAncillaryRowsByNodeId,
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
  if (dataset.nodes.every(hasServerCoordinates)) {
    return buildServerPositionedGraph(dataset);
  }

  const initialNodePositions = getInitialNodePositions(previousGraph);

  return buildForcePositionedGraph(dataset, options, initialNodePositions);
}

export function buildFullPositionedGraph(
  dataset: CanonicalDataset,
  options: RenderNewickOptions["layout"] = {},
): PositionedGraph {
  return buildPositionedSliceGraph(dataset, options, null);
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
): PositionedGraph {
  return {
    nodes: dataset.nodes.map(buildServerPositionedNode),
    edges: dataset.edges.map(buildPositionedEdge),
    viewMeta: {
      layout: LAYOUT_SERVER,
      lodLevel: 0,
    },
  };
}

function buildPositionedEdge(
  edge: CanonicalDataset["edges"][number],
): PositionedGraph["edges"][number] {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    attributes:
      typeof edge.distance === "number" && Number.isFinite(edge.distance)
        ? { distance: edge.distance }
        : undefined,
  };
}

function buildServerPositionedNode(
  node: CanonicalDataset["nodes"][number],
): PositionedGraph["nodes"][number] {
  const anchored = serverPosition(node);

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
    is_cluster_skeleton: node.is_cluster_skeleton === true,
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

function serverPosition(node: CanonicalDataset["nodes"][number]): {
  x: number;
  y: number;
} {
  return {
    x: (node.x as number) * DEFAULT_NODE_GAP,
    y: (node.y as number) * DEFAULT_LAYER_GAP,
  };
}
