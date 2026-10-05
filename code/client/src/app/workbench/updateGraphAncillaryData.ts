import type { GraphAncillaryResult } from "../../contracts/graph/ancillary/GraphAncillaryResult";
import type { GraphClient } from "../../contracts/graph/GraphClient";
import type { AncillaryTableInput } from "../../contracts/ancillary";
import { GRAPH_WORKBENCH_ERRORS } from "./graphWorkbench.errors";
import { getGraphSession } from "./graphWorkbench.state";
import type { GraphWorkbenchState } from "./graphWorkbench.types";
import type { GraphViewportCoordinator } from "./viewport/viewportCoordinator";

export interface UpdateGraphAncillaryDataDependencies {
  readonly getState: () => GraphWorkbenchState;
  readonly graphClient: GraphClient;

  readonly requireViewportCoordinator: () => GraphViewportCoordinator;

  readonly getLoadGeneration: () => number;
  readonly getViewportCoordinator: () => GraphViewportCoordinator | null;
}

export function createGraphAncillaryUpdater(dependencies: UpdateGraphAncillaryDataDependencies) {
  let pending: { coordinator: GraphViewportCoordinator; generation: number } | null = null;

  return async function updateGraphAncillaryData(data: AncillaryTableInput): Promise<GraphAncillaryResult> {
    const { getState, graphClient, requireViewportCoordinator, getLoadGeneration, getViewportCoordinator } =
      dependencies;
    const coordinator = requireViewportCoordinator();
    const session = getGraphSession(getState());
    const generation = getLoadGeneration();
    if (pending?.coordinator === coordinator && pending.generation === generation) {
      throw new Error("An ancillary update is already pending for this graph.");
    }
    const operation = { coordinator, generation };
    pending = operation;
    const assertCurrent = () => assertCurrentGraph(generation, coordinator, getLoadGeneration, getViewportCoordinator);
    try {
      const result = await graphClient.applyAncillaryData({
        datasetId: session.datasetId,
        layoutVersion: session.layoutVersion,
        ancillaryData: data,
      });
      assertCurrent();
      await coordinator.replaceLayoutVersion(result.layoutVersion);
      assertCurrent();
      return result;
    } catch (error) {
      assertCurrent();
      throw error;
    } finally {
      if (pending === operation) pending = null;
    }
  };
}

function assertCurrentGraph(
  generation: number,
  coordinator: GraphViewportCoordinator,
  getLoadGeneration: () => number,
  getViewportCoordinator: () => GraphViewportCoordinator | null,
): void {
  if (generation !== getLoadGeneration() || coordinator !== getViewportCoordinator()) {
    throw new Error(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
  }
}
