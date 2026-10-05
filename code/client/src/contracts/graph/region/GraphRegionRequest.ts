import type { DatasetId, LayoutVersion } from "../graphIdentifiers";
export interface GraphRegionRequest {
  datasetId: DatasetId;
  layoutVersion?: LayoutVersion | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  maxNodes?: number | null;
}
