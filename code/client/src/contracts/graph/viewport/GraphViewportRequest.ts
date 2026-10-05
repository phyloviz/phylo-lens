import type { ClusterId, DatasetId, LayoutVersion, NodeId } from "../graphIdentifiers";
export interface GraphViewportRequest {
  datasetId: DatasetId;
  layoutVersion?: LayoutVersion | null;
  clusterId?: ClusterId | null;
  focusNodeId?: NodeId | null;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  zoom?: number;
  lodLevel?: number | null;
  maxNodes?: number | null;
  /** Adaptive selection ceiling is lodLevel; counts never limit retrieval. */
  lodTargetRepresentations?: number;
  lodSelectionBounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  previousLodLevel?: number | null;
}
