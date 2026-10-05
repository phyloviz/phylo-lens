import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
export type GraphAncillaryResult = {
    readonly datasetId: DatasetId;
    readonly layoutVersion: LayoutVersion;
    readonly matchedNodeCount: number;
    readonly warnings: readonly string[];
};
