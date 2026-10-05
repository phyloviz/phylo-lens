import type { SearchDatasetResponse } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer, RenderViewportBounds } from "../../render/renderer.types";
import { getGraphSession } from "./graphWorkbench.state";
import type { GraphWorkbenchState, RegionSelectionResult } from "./graphWorkbench.types";
import { createEmptyGraph } from "./viewportGraph";
import type { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import type { GraphClient } from "../../contracts/graph";
import { type GraphWorkbenchAction } from "./graphWorkbench.actions";

const DEFAULT_SEARCH_RESULT_LIMIT = 50;

interface WorkbenchNavigationOptions {
  getState: () => GraphWorkbenchState;
  dispatch: (action: GraphWorkbenchAction) => void;
  renderer: GraphRenderer;
  graphClient: GraphClient;
  getViewportCoordinator: () => GraphViewportCoordinator | null;
  getLoadGeneration: () => number;
}

export default function createGraphNavigation({
  getState,
  renderer,
  graphClient,
  getViewportCoordinator,
  getLoadGeneration,
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
    const session = getGraphSession(getState());

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
      datasetId: session.datasetId,
      layoutVersion: session.layoutVersion ?? null,
      xmin: bounds.xmin,
      xmax: bounds.xmax,
      ymin: bounds.ymin,
      ymax: bounds.ymax,
    });

    const nodeIds = response.nodes.map((node) => node.id);
    renderer.setHighlightedNodes?.(new Set(nodeIds));

    return {
      nodeIds,
      nodeCount: response.totalNodeCount,
      truncated: response.truncated,
      aggregatedMetadata: response.aggregatedMetadata,
      metadataSchema: response.ancillarySchema ?? [],
    };
  }

  async function searchNodes(query: { query: string; limit?: number }): Promise<SearchDatasetResponse> {
    const session = getGraphSession(getState());
    cancelPendingFocus();

    const response = await graphClient.searchGraph({
      datasetId: session.datasetId,
      layoutVersion: session.layoutVersion ?? null,
      query: query.query,
      limit: query.limit,
    });

    return {
      datasetId: response.datasetId,
      query: response.query,
      matches: response.matches.map((match) => ({
        nodeId: match.nodeId,
        score: match.score,
        matchedText: match.matchedText,
        metadata: {},
        clusterId: match.clusterId ?? null,
        x: match.x ?? null,
        y: match.y ?? null,
      })),
      totalCount: response.totalCount,
    };
  }

  async function focusNode(
    nodeId: string,
    coordinates?: { x: number | null; y: number | null; clusterId?: string | null },
  ): Promise<PositionedGraph> {
    const session = getGraphSession(getState());
    const generation = getLoadGeneration();

    cancelPendingFocus();

    const sequence = focusSequence;
    const coordinator = getViewportCoordinator();

    const isCurrent = () =>
      sequence === focusSequence && generation === getLoadGeneration() && getViewportCoordinator() === coordinator;
    const currentSnapshot = () => getState().graphSnapshot ?? createEmptyGraph();

    // A repeated selection must recenter too: the user may have panned away.
    const visible = getState().graphSnapshot?.nodes.some(
      (node) => node.id === nodeId && node.attributes?.isClusterProxy !== true,
    );

    if (!visible || !renderer.centerOnNode?.(nodeId)) {
      let location = coordinates;

      if (!location?.clusterId) {
        const response = await graphClient.searchGraph({
          datasetId: session.datasetId,
          layoutVersion: session.layoutVersion ?? null,
          query: nodeId,
          limit: DEFAULT_SEARCH_RESULT_LIMIT,
        });
        if (!isCurrent()) return currentSnapshot();
        const match = response.matches.find((item) => item.nodeId === nodeId);
        if (!match) throw new Error(`Profile ${nodeId} was not found.`);
        location = { x: match.x ?? null, y: match.y ?? null, clusterId: match.clusterId };
      }

      if (!location.clusterId || !coordinator) {
        throw new Error(`Profile ${nodeId} has no available layout location.`);
      }

      const result = await coordinator.expandCluster(location.clusterId, { focusNodeId: nodeId });

      if (!isCurrent() || result.status === "superseded") {
        return currentSnapshot();
      }

      if (!renderer.centerOnNode?.(nodeId) && location.x != null && location.y != null) {
        renderer.centerOnCoordinates?.(location.x, location.y);
      }
    }

    if (isCurrent()) {
      renderer.focusNode?.(nodeId);
    }

    return currentSnapshot();
  }
}
