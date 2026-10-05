import { GraphLayoutStatus } from "../graphTypes";
import type { GraphViewportNode } from "../viewport/GraphViewportNode";
import type { GraphViewportEdge } from "../viewport/GraphViewportEdge";
import type { AncillaryField, AncillaryData } from "../../ancillary";

export interface GraphRegionResult {
  datasetId: string;
  layoutVersion: string;
  layoutStatus: GraphLayoutStatus;
  truncated: boolean;
  totalNodeCount: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  ancillarySchema?: AncillaryField[];
  aggregatedMetadata: AncillaryData;
}
