import type Graph from "graphology";
import type Sigma from "sigma";

import { SIGMA_REGION_DIMMED_EDGE_COLOR, SIGMA_REGION_DIMMED_NODE_COLOR } from "../sigmaRendering.constants";

interface SigmaHighlightingOptions {
  graph: Graph | null;
  sigma: Sigma | null;
  highlightedNodeIds: ReadonlySet<string> | null;
}

export default function applySigmaHighlighting({ graph, sigma, highlightedNodeIds }: SigmaHighlightingOptions): void {
  if (!sigma) {
    return;
  }

  if (!highlightedNodeIds) {
    sigma.setSetting("nodeReducer", null);
    sigma.setSetting("edgeReducer", null);
    return;
  }

  sigma.setSetting("nodeReducer", (nodeId, data) =>
    highlightedNodeIds.has(nodeId) ? data : { ...data, color: SIGMA_REGION_DIMMED_NODE_COLOR, label: "" },
  );
  sigma.setSetting("edgeReducer", (edgeId, data) => {
    const source = graph?.source(edgeId);
    const target = graph?.target(edgeId);
    const withinRegion =
      source !== undefined && target !== undefined && highlightedNodeIds.has(source) && highlightedNodeIds.has(target);
    return withinRegion ? data : { ...data, color: SIGMA_REGION_DIMMED_EDGE_COLOR };
  });
}
