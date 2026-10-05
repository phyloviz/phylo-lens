import type { DatasetId, LayoutVersion } from "../graphIdentifiers";
import { GraphLayoutStatus } from "../graphTypes";
import type { GraphViewportNode } from "./GraphViewportNode";
import type { GraphViewportEdge } from "./GraphViewportEdge";
import type { GraphLayoutBounds } from "./GraphLayoutBounds";
import type { AncillaryField } from "../../ancillary";

export interface GraphViewportResult {
  datasetId: DatasetId;
  layoutVersion: LayoutVersion;
  lodLevel?: number | null;
  zoom: number;
  layoutStatus: GraphLayoutStatus;
  truncated: boolean;
  totalNodeCount: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  globalBounds?: GraphLayoutBounds | null;
  ancillarySchema?: AncillaryField[];
}
