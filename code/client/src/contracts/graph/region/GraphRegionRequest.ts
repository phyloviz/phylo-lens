export interface GraphRegionRequest {
  datasetId: string;
  layoutVersion?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  maxNodes?: number | null;
}
