import type { GraphLayoutStatus } from "../../../../contracts/graph/graphTypes";
import type { GraphViewportNodeDto } from "../viewport/GraphViewportNodeDto";
import type { GraphViewportEdgeDto } from "../viewport/GraphViewportEdgeDto";
import type { AncillaryField, AncillaryData } from "../../../../contracts/ancillary";

export interface GraphRegionResponseDto {
  dataset_id: string;
  layout_version: string;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNodeDto[];
  edges: GraphViewportEdgeDto[];
  metadata_schema?: AncillaryField[];
  aggregated_metadata: AncillaryData;
}
