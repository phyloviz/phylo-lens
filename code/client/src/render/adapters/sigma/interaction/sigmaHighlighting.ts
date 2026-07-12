import type Graph from "graphology";
import type Sigma from "sigma";

import {
  PHYLOVIZ_NODE_SELECTED_BORDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_NODE_TYPE_BORDER,
  SIGMA_NODE_TYPE_TRIANGLE,
  SIGMA_REGION_DIMMED_EDGE_COLOR,
  SIGMA_REGION_DIMMED_NODE_COLOR,
} from "../sigmaRendering.constants";

interface SigmaHighlightingOptions {
  graph: Graph | null;
  sigma: Sigma | null;
  highlightedNodeIds: ReadonlySet<string> | null;
  selectedNodeId: string | null;
}

export default function applySigmaHighlighting({
  graph,
  sigma,
  highlightedNodeIds,
  selectedNodeId,
}: SigmaHighlightingOptions): void {
  if (!sigma) {
    return;
  }

  if (!highlightedNodeIds && !selectedNodeId) {
    sigma.setSetting("nodeReducer", null);
    sigma.setSetting("edgeReducer", null);
    return;
  }

  sigma.setSetting("nodeReducer", (nodeId, data) => {
    const outsideHighlight = highlightedNodeIds !== null && !highlightedNodeIds.has(nodeId);
    const selected = nodeId === selectedNodeId && !isRepresentativeNode(data);
    const nextData = outsideHighlight ? { ...data, color: SIGMA_REGION_DIMMED_NODE_COLOR, label: "" } : data;

    if (!selected) {
      return nextData;
    }

    const baseSize = typeof data.size === "number" ? data.size : 5;
    return {
      ...nextData,
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
      size: Math.max(baseSize * 1.55, baseSize + 6),
      type: SIGMA_NODE_TYPE_BORDER,
      borderColor: PHYLOVIZ_NODE_SELECTED_BORDER_COLOR,
      label: typeof nextData.label === "string" && nextData.label.length > 0 ? nextData.label : nodeId,
      forceLabel: true,
    };
  });

  sigma.setSetting(
    "edgeReducer",
    highlightedNodeIds
      ? (edgeId, data) => {
          const source = graph?.source(edgeId);
          const target = graph?.target(edgeId);
          const withinRegion =
            source !== undefined && target !== undefined && highlightedNodeIds.has(source) && highlightedNodeIds.has(target);
          return withinRegion ? data : { ...data, color: SIGMA_REGION_DIMMED_EDGE_COLOR };
        }
      : null,
  );
}

function isRepresentativeNode(data: Record<string, unknown>): boolean {
  return (
    data.type === SIGMA_NODE_TYPE_TRIANGLE ||
    data.is_cluster_proxy === true ||
    (typeof data.member_count === "number" && data.member_count > 1)
  );
}
