import type { GraphAncillaryResult, GraphClient } from "../../contracts/graph";
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

export async function updateGraphAncillaryData(
  dependencies: UpdateGraphAncillaryDataDependencies,
  data: AncillaryTableInput,
): Promise<GraphAncillaryResult> {
  const { getState, graphClient, requireViewportCoordinator, getLoadGeneration, getViewportCoordinator } = dependencies;

  const coordinator = requireViewportCoordinator();
  const session = getGraphSession(getState());
  const generation = getLoadGeneration();

  const result = await graphClient.applyAncillaryData({
    datasetId: session.datasetId,
    layoutVersion: session.layoutVersion,
    ancillaryData: data,
  });

  assertCurrentGraph(generation, coordinator, getLoadGeneration, getViewportCoordinator);

  await coordinator.replaceLayoutVersion(result.layoutVersion);

  assertCurrentGraph(generation, coordinator, getLoadGeneration, getViewportCoordinator);

  return result;
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
