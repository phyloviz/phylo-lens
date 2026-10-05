import type { DatasetId, LayoutVersion } from "../graphIdentifiers";
export interface GraphAncillaryResult {
  datasetId: DatasetId;
  layoutVersion: LayoutVersion;
  matchedNodeCount: number;
  warnings: string[];
}
