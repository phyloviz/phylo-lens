import { resolveAncillaryInput } from "../../ancillary/ancillaryInput";
import type { NormalizeRequest, GraphClient } from "../../api/graphContracts";
import type { PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer } from "../../render/renderer.types";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";
import { ERR_GRAPH_LOAD_SUPERSEDED } from "./graphWorkbench.errors";
import type { GraphInput, GraphWorkbenchState, LoadGraphOptions } from "./graphWorkbench.types";
import type { SnapshotAppliedObserver } from "./internalSnapshotObserver";
import { GraphViewportCoordinator } from "./viewport/viewportCoordinator";

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

  replaceViewportCoordinator(renderer);

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
        visualMapping: state.preparedSession?.visualMapping,
        filterState: state.activeFilters,
        ancillarySchema: state.preparedSession?.ancillarySchema,
        ancillaryByNodeId: state.preparedSession?.ancillaryByNodeId,
        displayOptions: state.preparedSession?.displayOptions,
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
    throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
  }
}
