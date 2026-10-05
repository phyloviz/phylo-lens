import type { ClusterId, DatasetId, LayoutVersion, NodeId } from '../graphIdentifiers';
export type GraphViewportRequest = {
    readonly datasetId: DatasetId;
    readonly layoutVersion?: LayoutVersion | null;
    readonly clusterId?: ClusterId | null;
    readonly focusNodeId?: NodeId | null;
    readonly xmin?: number;
    readonly xmax?: number;
    readonly ymin?: number;
    readonly ymax?: number;
    readonly zoom?: number;
    readonly lodLevel?: number | null;
    readonly maxNodes?: number | null;
    /** Adaptive selection ceiling is lodLevel; counts never limit retrieval. */
    readonly lodTargetRepresentations?: number;
    readonly lodSelectionBounds?: {
        readonly xmin: number;
        readonly xmax: number;
        readonly ymin: number;
        readonly ymax: number;
    };
    readonly previousLodLevel?: number | null;
};
