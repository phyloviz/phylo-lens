import type { GraphPrepareStatus } from './GraphPrepareStatus';

export type GraphPrepareOptions = {
    readonly onPending?: (status: GraphPrepareStatus) => void;
    readonly pollIntervalMs?: number;
    // Optional host-side wait limit. The default is unlimited so a valid global
    // `sfdp` preparation is not abandoned merely because it is expensive.
    readonly pollTimeoutMs?: number | null;
    readonly sleep?: (ms: number) => Promise<void>;
};
