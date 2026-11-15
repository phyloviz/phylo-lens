import type { GraphLayoutStatus } from '../../../contracts/graph/graphTypes';
import type { GraphViewportNodeDto, GraphViewportEdgeDto } from '../viewport/viewportDto';
import type { AncillaryField, AncillaryData } from '../../../contracts/ancillary';
export interface GraphRegionRequestDto {
  component_id?: string;
  dataset_id: string;
  layout_version?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  max_nodes?: number | null;
}

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
