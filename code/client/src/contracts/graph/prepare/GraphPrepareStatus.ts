import { GraphPrepareJobStatus } from "../graphTypes";
import type { GraphPrepareResult } from "./GraphPrepareResult";
import type { GraphPrepareErrorDetails } from "./GraphPrepareErrorDetails";

export interface GraphPrepareStatus {
  jobId: string;
  status: GraphPrepareJobStatus;
  result?: GraphPrepareResult | null;
  error?: string | null;
  errorDetails?: GraphPrepareErrorDetails | null;
}
