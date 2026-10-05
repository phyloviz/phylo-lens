import type { DatasetId, LayoutVersion } from "../graphIdentifiers";
export interface GraphSearchRequest {
  datasetId: DatasetId;
  layoutVersion?: LayoutVersion | null;
  query: string;
  limit?: number;
}
