import type { GraphPrepareJobStatus } from '../../../../contracts/graph/graphTypes';

export interface GraphPrepareJobDto {
  job_id: string;
  status: GraphPrepareJobStatus;
  dataset_id: string;
}
