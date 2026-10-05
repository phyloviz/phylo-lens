export interface GraphSearchRequest {
  datasetId: string;
  layoutVersion?: string | null;
  query: string;
  limit?: number;
}
