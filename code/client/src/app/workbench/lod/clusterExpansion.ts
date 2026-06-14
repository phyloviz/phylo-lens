import type { PositionedGraph } from "../../../contracts/positioned";
import type { RenderNodeClickState } from "../../../render/types";

export interface ClusterExpansionState {
  expandedClusterIds: Set<string>;
  collapsedClusterIds: Set<string>;
}

export function toggleClusterExpansion(
  state: ClusterExpansionState,
  clusterId: string,
): "expanded" | "collapsed" {
  if (state.expandedClusterIds.has(clusterId)) {
    state.expandedClusterIds.delete(clusterId);
    state.collapsedClusterIds.add(clusterId);
    return "collapsed";
  }

  state.collapsedClusterIds.delete(clusterId);
  state.expandedClusterIds.add(clusterId);
  return "expanded";
}

export function isClusterProxyClick(
  clickState: RenderNodeClickState,
  clickedNode: PositionedGraph["nodes"][number] | undefined,
): boolean {
  return (
    clickState.attributes?.is_cluster_proxy === true ||
    clickedNode?.attributes?.is_cluster_proxy === true
  );
}

export function getClickedClusterId(
  clickState: RenderNodeClickState,
  clickedNode: PositionedGraph["nodes"][number] | undefined,
): string | undefined {
  const fromClickState = clickState.attributes?.cluster_id;
  const fromGraphNode = clickedNode?.attributes?.cluster_id;

  if (typeof fromClickState === "string") {
    return fromClickState;
  }

  if (typeof fromGraphNode === "string") {
    return fromGraphNode;
  }

  return undefined;
}
