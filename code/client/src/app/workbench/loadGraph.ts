import { resolveAncillaryInput } from "../../ancillary/ancillaryInput";
import type { NormalizeRequest, GraphClient, GraphPrepareResponse } from "../../api/graphContracts";
import type { PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer } from "../../render/renderer.types";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";
import { GRAPH_WORKBENCH_ERRORS } from "./graphWorkbench.errors";
import type { GraphInput, GraphSession, GraphWorkbenchState, LoadGraphOptions } from "./graphWorkbench.types";
import type { SnapshotAppliedObserver } from "./internalSnapshotObserver";
import { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import { GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD } from "./viewport/viewportQuery";
import { DEFAULT_VIEWPORT } from "./viewportGraph";

export interface LoadGraphDependencies {
  readonly getState: () => GraphWorkbenchState;
  readonly dispatch: (action: GraphWorkbenchAction) => void;

  readonly renderer: GraphRenderer;
  readonly graphClient: GraphClient;

  readonly replaceViewportCoordinator: (coordinator: GraphViewportCoordinator | null) => void;

  readonly isCurrentLoad: () => boolean;

  readonly snapshotObserver?: SnapshotAppliedObserver;
  readonly nextSnapshotSequence: () => number;

  readonly onGraphRendered?: (graph: PositionedGraph) => void;
}

export async function loadGraph(
  dependencies: LoadGraphDependencies,
  input: GraphInput,
  options: LoadGraphOptions = {},
): Promise<PositionedGraph> {
  const {
    getState,
    dispatch,
    renderer,
    graphClient,
    replaceViewportCoordinator,
    isCurrentLoad,
    snapshotObserver,
    nextSnapshotSequence,
    onGraphRendered,
  } = dependencies;

  replaceViewportCoordinator(null);

  dispatch({
    type: ACTIONS.reset,
  });

  resetRenderer(renderer);

  const ancillary = resolveAncillaryInput(options);

  const request: NormalizeRequest = {
    format: input.format,
    dataset_name: input.datasetName,
    content: input.content,
    metadata_schema: ancillary.ancillarySchema,
    metadata_by_node_id: ancillary.ancillaryByNodeId,
    ancillary_data: options.ancillaryData,
    sfdp_options: options.sfdpOptions,
  };

  requireViewportRenderer(renderer);

  const preparedGraph = await graphClient.prepareGraph(request);

  assertCurrentLoad(isCurrentLoad);

  const session = createGraphSession(preparedGraph, ancillary, options);

  dispatch({
    type: ACTIONS.graphPrepared,
    session,
  });

  const coordinator = new GraphViewportCoordinator({
    client: graphClient,
    datasetId: session.datasetId,
    layoutVersion: session.layoutVersion,
    renderer,

    maxNodes: session.lod.maxNodes,
    representationSpacingPx: session.lod.representationSpacingPx,
    smallTreeThreshold: session.lod.smallTreeThreshold,

    lodTierCount: preparedGraph.lod_tier_count,
    nodeCount: preparedGraph.node_count,

    getPaused: () => getState().lodRefreshPaused,

    onGraphSynced: (graph, response) => {
      dispatch({
        type: ACTIONS.viewportSynced,
        graph,
        response,
      });

      const graphSnapshot = getState().graphSnapshot;

      if (graphSnapshot) {
        onGraphRendered?.(graphSnapshot);
      }
    },

    snapshotObserver,
    nextSnapshotSequence,

    getRenderSettings: () => {
      const state = getState();

      return {
        visualMapping: state.graphSession?.visualMapping,
        filterState: state.activeFilters,
        ancillarySchema: state.graphSession?.ancillarySchema,
        ancillaryByNodeId: state.graphSession?.ancillaryByNodeId,
        displayOptions: state.graphSession?.displayOptions,
      };
    },
  });

  replaceViewportCoordinator(coordinator);
  coordinator.mount();

  try {
    const graph = await coordinator.waitForInitialViewport();

    assertCurrentLoad(isCurrentLoad);

    return graph;
  } catch (error) {
    assertCurrentLoad(isCurrentLoad);

    replaceViewportCoordinator(null);

    dispatch({
      type: ACTIONS.graphCleared,
    });

    throw error;
  }
}

// Helpers

function assertCurrentLoad(isCurrentLoad: () => boolean): void {
  if (!isCurrentLoad()) {
    throw new Error(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
  }
}

function requireViewportRenderer(renderer: GraphRenderer): void {
  if (!renderer.getViewportSyncState || !renderer.applyGraphSnapshot) {
    throw new Error(GRAPH_WORKBENCH_ERRORS.viewportRequired);
  }
}

function resetRenderer(renderer: GraphRenderer): void {
  const motionEnabled = renderer.isMotionEnabled?.() ?? true;

  renderer.resetLayoutEdits?.();
  renderer.setMotionEnabled?.(motionEnabled);
  renderer.focusNode?.(null);
}

function createGraphSession(
  preparedGraph: GraphPrepareResponse,
  ancillary: ReturnType<typeof resolveAncillaryInput>,
  options: LoadGraphOptions,
): GraphSession {
  return {
    datasetId: preparedGraph.dataset_id,
    layoutVersion: preparedGraph.layout_version,

    ancillarySchema: ancillary.ancillarySchema,
    ancillaryByNodeId: ancillary.ancillaryByNodeId,

    visualMapping: options.visualMapping,
    displayOptions: options.displayOptions,

    layoutWarnings: preparedGraph.warnings,
    lodTierCount: preparedGraph.lod_tier_count,

    lod: {
      maxNodes: options.lod?.maxNodes,
      representationSpacingPx: options.lod?.representationSpacingPx,
      smallTreeThreshold: options.lod?.smallTreeThreshold ?? GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
      lodHint: options.lod?.lodHint,
      viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
    },
  };
}
