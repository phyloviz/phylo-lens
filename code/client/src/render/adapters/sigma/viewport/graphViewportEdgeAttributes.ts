import type { GraphViewportEdge } from "../../../../api/graphContracts";
import type { GraphDisplayOptions } from "../../../renderer.types";
import { edgeSizeForDistance } from "../attributes/sigmaStyle";

export const GRAPH_VIEWER_EDGE_COLOR = "#94a3b8";
// Base thickness for a viewport edge before any distance weighting is applied.
export const GRAPH_VIEWER_BASE_EDGE_SIZE = 1;

export function buildGraphViewportEdgeAttributes(
  edge: GraphViewportEdge,
  displayOptions?: GraphDisplayOptions,
): Record<string, unknown> {
  const isMeta = edge.is_meta === true;
  const hasDistance = typeof edge.distance === "number" && Number.isFinite(edge.distance);
  const showEdgeLabel = displayOptions?.edgeDistanceLabels === true;
  return {
    color: GRAPH_VIEWER_EDGE_COLOR,
    size: edgeSizeForDistance(
      edge.distance,
      GRAPH_VIEWER_BASE_EDGE_SIZE,
      displayOptions?.distanceWeightedEdges === true,
    ),
    distance: edge.distance ?? undefined,
    label: showEdgeLabel && hasDistance ? String(edge.distance) : "",
    forceLabel: showEdgeLabel,
    // Carry meta-edge provenance so downstream styling can distinguish
    // rerouted boundary edges. Phase 1 only surfaces the attributes.
    isMeta,
    bundledEdgeCount: isMeta ? (edge.bundled_edge_count ?? 1) : undefined,
  };
}
