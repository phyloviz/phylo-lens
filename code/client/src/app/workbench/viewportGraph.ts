import type { GraphViewportResponse } from "../../api/graphContracts";
import {
  type CanonicalDataset,
  SOURCE_FORMAT_NEWICK,
  type Viewport,
} from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import { buildMetadataIndex } from "../../ancillary/metadataIndex";
import type { GraphWorkbenchState } from "./graphWorkbench.types";

export const DEFAULT_VIEW_SLICE_MAX_NODES = 6000;
export const GRAPH_DETAIL_LOD_LEVEL = 3;

export const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  width: 1000,
  height: 600,
};

export function createEmptyGraph(): PositionedGraph {
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

export function updateStateFromGraphViewport(
  state: GraphWorkbenchState,
  response: GraphViewportResponse,
): void {
  const graph: PositionedGraph = {
    nodes: response.nodes.map((node) => {
      const metadata = node.metadata ?? undefined;
      return {
        id: node.id,
        x: node.x,
        y: node.y,
        size: Math.max(5, Math.log1p(node.member_count) * 2),
        attributes: {
          cluster_id: node.cluster_id,
          is_cluster_proxy: node.is_representative,
          subtree_size: node.member_count,
          layout_status: node.layout_status,
          ...(metadata ? { metadata } : {}),
        },
      };
    }),
    edges: response.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      attributes:
        typeof edge.distance === "number" && Number.isFinite(edge.distance)
          ? { distance: edge.distance }
          : undefined,
    })),
    viewMeta: {
      layout: "server",
      lodLevel: response.lod_level ?? GRAPH_DETAIL_LOD_LEVEL,
      lodTierCount: state.preparedSession?.lodTierCount,
      sliceNodeCount: response.nodes.length,
      sliceEdgeCount: response.edges.length,
      zoom: response.zoom,
      layoutStatus: response.layout_status,
      layoutWarnings: state.preparedSession?.layoutWarnings,
    },
  };

  const metadataSignature = viewportMetadataSignature(response);
  if (
    metadataSignature !== state.metadataIndexSignature ||
    state.metadataIndex === null ||
    state.currentSliceDataset === null
  ) {
    const syntheticDataset = buildViewportDataset(state, response);
    state.currentSliceDataset = syntheticDataset;
    state.metadataIndex = buildMetadataIndex(syntheticDataset);
    state.metadataIndexSignature = metadataSignature;
  }

  state.currentGraph = graph;
  state.graphRenderedHandler?.(graph);
}

function viewportMetadataSignature(response: GraphViewportResponse): string {
  const nodeIds = response.nodes.map((node) => node.id).sort();
  return [
    response.dataset_id,
    response.layout_version,
    response.lod_level ?? "",
    nodeIds.length,
    nodeIds.join(","),
  ].join("|");
}

function buildViewportDataset(
  state: GraphWorkbenchState,
  response: GraphViewportResponse,
): CanonicalDataset {
  const metadataByNodeId: CanonicalDataset["metadata_by_node_id"] = {};
  response.nodes.forEach((node) => {
    if (node.metadata) {
      metadataByNodeId[node.id] = node.metadata;
    }
  });

  return {
    dataset_id: response.dataset_id,
    nodes: response.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      cluster_id: node.cluster_id,
      is_cluster_proxy: node.is_representative,
      subtree_size: node.member_count,
    })),
    edges: response.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      distance: edge.distance ?? null,
    })),
    metadata_schema: state.preparedSession?.metadataSchema ?? [],
    metadata_by_node_id: metadataByNodeId,
    source: {
      format: SOURCE_FORMAT_NEWICK,
      generated_at: new Date().toISOString(),
    },
  };
}
