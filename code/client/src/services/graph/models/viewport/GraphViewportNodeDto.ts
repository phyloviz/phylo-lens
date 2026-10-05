import type { GraphLayoutStatus } from "../../../../contracts/graph/graphTypes";
import type { AncillaryData, AncillaryObservation } from "../../../../contracts/ancillary";
import type { GraphIsolateDto } from "./GraphIsolateDto";

export interface GraphViewportNodeDto {
  id: string;
  cluster_id: string;
  x: number;
  y: number;
  layout_status: GraphLayoutStatus;
  member_count: number;
  is_representative: boolean;
  metadata?: AncillaryData | null;
  isolates?: GraphIsolateDto[];
  ancillary_distribution?: AncillaryObservation[];
}
