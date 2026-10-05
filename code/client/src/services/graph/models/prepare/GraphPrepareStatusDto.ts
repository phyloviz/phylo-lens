import type { GraphPrepareJobStatus } from "../../../../contracts/graph/graphTypes";
import type { GraphPrepareResponseDto } from "./GraphPrepareResponseDto";
import type { GraphPrepareErrorDetailsDto } from "./GraphPrepareErrorDetailsDto";

export interface GraphPrepareStatusDto {
  job_id: string;
  status: GraphPrepareJobStatus;
  result?: GraphPrepareResponseDto | null;
  error?: string | null;
  error_details?: GraphPrepareErrorDetailsDto | null;
}
