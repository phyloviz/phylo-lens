import { GraphPrepareJobStatus } from '../graphTypes';
import type { GraphPrepareResult } from './GraphPrepareResult';
import type { GraphPrepareErrorDetails } from './GraphPrepareErrorDetails';

export type GraphPrepareStatus = {
    readonly jobId: string;
    readonly status: GraphPrepareJobStatus;
    readonly result?: GraphPrepareResult | null;
    readonly error?: string | null;
    readonly errorDetails?: GraphPrepareErrorDetails | null;
};
