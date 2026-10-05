import type { GraphLayoutStatus } from "../../../../contracts/graph/graphTypes";
import type { GraphViewportNodeDto } from "./GraphViewportNodeDto";
import type { GraphViewportEdgeDto } from "./GraphViewportEdgeDto";
import type { GraphLayoutBoundsDto } from "./GraphLayoutBoundsDto";
import type { AncillaryField } from "../../../../contracts/ancillary";

export interface GraphViewportResponseDto {
  dataset_id: string;
  layout_version: string;
  lod_level?: number | null;
  zoom: number;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNodeDto[];
  edges: GraphViewportEdgeDto[];
  global_bounds?: GraphLayoutBoundsDto | null;
  metadata_schema?: AncillaryField[];
}
