import type { DatasetId } from "../graphIdentifiers";
import { GraphPrepareJobStatus } from "../graphTypes";

export interface GraphPrepareJob {
  jobId: string;
  status: GraphPrepareJobStatus;
  datasetId: DatasetId;
}
