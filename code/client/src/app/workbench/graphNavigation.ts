import type { SearchDatasetResponse } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer, RenderViewportBounds } from "../../render/renderer.types";
import { getPreparedSession } from "./graphWorkbench.state";
import type { GraphWorkbenchState, RegionSelectionResult } from "./graphWorkbench.types";
import { createEmptyGraph } from "./viewportGraph";
import type { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import type { GraphClient } from "../../api/graphContracts";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";

interface WorkbenchNavigationOptions {
  getState: () => GraphWorkbenchState;
  dispatch: (action: GraphWorkbenchAction) => void;
  renderer: GraphRenderer;
  graphClient: GraphClient;
  getViewportCoordinator: () => GraphViewportCoordinator | null;
}

export default function createGraphNavigation({
  getState,
  dispatch,
  renderer,
  graphClient,
  getViewportCoordinator: getViewportCoordinator,
}: WorkbenchNavigationOptions) {
  let focusSequence = 0;
  const cancelPendingFocus = () => {
    focusSequence += 1;
    getViewportCoordinator()?.cancelPendingFocus();
  };

  return {
    cancelPendingFocus,
    selectRegion: selectRegion,
    searchNodes: searchNodes,
    focusNode: focusNode,
  };

  async function selectRegion(bounds: RenderViewportBounds): Promise<RegionSelectionResult> {
    const session = getPreparedSession(getState());

    // The server cannot select a rectangle in a deformed layout. Select the loaded
    // display explicitly; its ancillary wheel is built from these same node IDs.
    const displayed = renderer.getDisplayedNodesInBounds?.(bounds);
    if (displayed) {
      const nodeIds = [...displayed];
      renderer.setHighlightedNodes?.(new Set(nodeIds));
      return {
        nodeIds,
        nodeCount: nodeIds.length,
        truncated: false,
        aggregatedMetadata: {},
        metadataSchema: [],
        scope: "display",
      };
    }
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
    const session = getPreparedSession(getState());
    cancelPendingFocus();

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
        cluster_id: match.cluster_id ?? null,
        x: match.x ?? null,
        y: match.y ?? null,
      })),
      total_count: response.total_count,
    };
  }

  async function focusNode(
    nodeId: string,
    coordinates?: { x: number | null; y: number | null; clusterId?: string | null },
  ): Promise<PositionedGraph> {
    const session = getPreparedSession(getState());

    cancelPendingFocus();

    const sequence = focusSequence;
    const controller = getViewportCoordinator();

    const isCurrent = () =>
      sequence === focusSequence && getState().preparedSession === session && getViewportCoordinator() === controller;
    const currentGraph = () => getState().graphSnapshot ?? createEmptyGraph();

    // A repeated selection must recenter too: the user may have panned away.
    const visible = getState().graphSnapshot?.nodes.some(
      (node) => node.id === nodeId && node.attributes?.is_cluster_proxy !== true,
    );

    if (!visible || !renderer.centerOnNode?.(nodeId)) {
      let location = coordinates;

      if (!location?.clusterId) {
        const response = await graphClient.searchGraph({
          dataset_id: session.datasetId,
          layout_version: session.layoutVersion ?? null,
          query: nodeId,
          limit: 50,
        });
        if (!isCurrent()) return currentGraph();
        const match = response.matches.find((item) => item.node_id === nodeId);
        if (!match) throw new Error(`Profile ${nodeId} was not found.`);
        location = { x: match.x ?? null, y: match.y ?? null, clusterId: match.cluster_id };
      }

      if (!location.clusterId || !controller) {
        throw new Error(`Profile ${nodeId} has no available layout location.`);
      }

      const result = await controller.expandCluster(location.clusterId, { focusNodeId: nodeId });

      if (!isCurrent() || result.status === "superseded") {
        return currentGraph();
      }

      if (!renderer.centerOnNode?.(nodeId) && location.x != null && location.y != null) {
        renderer.centerOnCoordinates?.(location.x, location.y);
      }
    }

    if (isCurrent()) {
      dispatch({
        type: ACTIONS.nodeFocused,
        nodeId,
      });
      renderer.focusNode?.(nodeId);
    }

    return currentGraph();
  }
}
