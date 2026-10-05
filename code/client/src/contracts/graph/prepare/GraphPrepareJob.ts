import type { DatasetId } from '../graphIdentifiers';
import { GraphPrepareJobStatus } from '../graphTypes';

export type GraphPrepareJob = {
    readonly jobId: string;
    readonly status: GraphPrepareJobStatus;
    readonly datasetId: DatasetId;
};
