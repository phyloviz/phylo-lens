import { GraphLayoutStatus } from "../graphTypes";
import type { GraphViewportNode } from "./GraphViewportNode";
import type { GraphViewportEdge } from "./GraphViewportEdge";
import type { GraphLayoutBounds } from "./GraphLayoutBounds";
import type { AncillaryField } from "../../ancillary";

export interface GraphViewportResult {
  datasetId: string;
  layoutVersion: string;
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
