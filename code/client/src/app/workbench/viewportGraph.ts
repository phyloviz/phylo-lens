import { graphSnapshotFromViewportResponse } from "./viewport/viewportSnapshot";
import { decodeLegacyMetadata } from "../../ancillary/legacyMetadata";
import type { GraphViewportResponse } from "../../api/graphContracts";
import { type CanonicalDataset, SOURCE_FORMAT_NEWICK, type Viewport } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import { buildAncillaryIndex } from "../../ancillary/ancillaryIndex";
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

export function updateStateFromGraphViewport(state: GraphWorkbenchState, response: GraphViewportResponse): void {
  const graph = graphSnapshotFromViewportResponse(response, {
    visualMapping: state.preparedSession?.visualMapping,
    filterState: state.activeFilters,
    ancillarySchema: state.preparedSession?.ancillarySchema,
    ancillaryByNodeId: state.preparedSession?.ancillaryByNodeId,
    displayOptions: state.preparedSession?.displayOptions,
  });
  graph.viewMeta.lodTierCount = state.preparedSession?.lodTierCount;
  graph.viewMeta.layoutWarnings = state.preparedSession?.layoutWarnings;

  const ancillarySignature = viewportAncillarySignature(response);
  if (
    ancillarySignature !== state.ancillaryIndexSignature ||
    state.ancillaryIndex === null ||
    state.currentSliceDataset === null
  ) {
    const syntheticDataset = buildViewportDataset(state, response);
    state.currentSliceDataset = syntheticDataset;
    state.ancillaryIndex = buildAncillaryIndex(syntheticDataset);
    state.ancillaryIndexSignature = ancillarySignature;
  }

  state.currentGraph = graph;
  state.graphRenderedHandler?.(graph);
}

function viewportAncillarySignature(response: GraphViewportResponse): string {
  const nodeIds = response.nodes.map((node) => node.id).sort();
  return [
    response.dataset_id,
    response.layout_version,
    response.lod_level ?? "",
    nodeIds.length,
    nodeIds.join(","),
  ].join("|");
}

function buildViewportDataset(state: GraphWorkbenchState, response: GraphViewportResponse): CanonicalDataset {
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
    ancillarySchema: response.metadata_schema ?? state.preparedSession?.ancillarySchema ?? [],
    annotationsByNodeId: Object.fromEntries(
      response.nodes.map((node) => [node.id, decodeLegacyMetadata(node.metadata ?? {})]),
    ),
    source: {
      format: SOURCE_FORMAT_NEWICK,
      generated_at: new Date().toISOString(),
    },
  };
}
