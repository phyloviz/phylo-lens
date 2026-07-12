import type { GraphClient } from "../../api/graphClient";
import type { SearchDatasetResponse } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import type { SigmaViewportBounds } from "../../render/adapters/sigma/graphViewerTypes";
import type { GraphRenderer } from "../../render/types";
import { requirePreparedSession } from "./graphWorkbench.state";
import type { GraphWorkbenchState, RegionSelectionResult } from "./graphWorkbench.types";
import { createEmptyGraph } from "./viewportGraph";

interface WorkbenchNavigationOptions {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  graphClient: GraphClient;
}

export default function createGraphNavigation({ state, renderer, graphClient }: WorkbenchNavigationOptions) {
  return {
    selectRegion: selectRegion,
    searchNodes: searchNodes,
    focusNode: focusNode,
  };

  async function selectRegion(bounds: SigmaViewportBounds): Promise<RegionSelectionResult> {
    const session = requirePreparedSession(state);

    const response = await graphClient.readRegion({
      dataset_id: session.datasetId,
      layout_version: session.layoutVersion ?? null,
      xmin: bounds.xmin,
      xmax: bounds.xmax,
      ymin: bounds.ymin,
      ymax: bounds.ymax,
    });

    const nodeIds = response.nodes.map((node) => node.id);
    renderer.setHighlightedNodes?.(new Set(nodeIds));

    return {
      nodeIds,
      nodeCount: response.total_node_count,
      truncated: response.truncated,
      aggregatedMetadata: response.aggregated_metadata,
      metadataSchema: response.metadata_schema ?? [],
    };
  }

  async function searchNodes(query: { query: string; limit?: number }): Promise<SearchDatasetResponse> {
    const session = requirePreparedSession(state);

    const response = await graphClient.searchGraph({
      dataset_id: session.datasetId,
      layout_version: session.layoutVersion ?? null,
      query: query.query,
      limit: query.limit,
    });

    return {
      dataset_id: response.dataset_id,
      query: response.query,
      matches: response.matches.map((match) => ({
        node_id: match.node_id,
        score: match.score,
        matched_text: match.matched_text,
        metadata: {},
        x: match.x ?? null,
        y: match.y ?? null,
      })),
      total_count: response.total_count,
    };
  }

  async function focusNode(
    nodeId: string,
    coordinates?: { x: number | null; y: number | null },
  ): Promise<PositionedGraph> {
    requirePreparedSession(state);

    state.focusedNodeId = nodeId;
    renderer.focusNode?.(nodeId);

    const centeredInSlice = renderer.centerOnNode?.(nodeId);
    if (
      centeredInSlice !== true &&
      coordinates &&
      coordinates.x !== null &&
      coordinates.y !== null &&
      renderer.centerOnCoordinates?.(coordinates.x, coordinates.y) === true
    ) {
      renderer.refreshGraphViewportSync?.();
    }

    return state.currentGraph ?? createEmptyGraph();
  }
}
