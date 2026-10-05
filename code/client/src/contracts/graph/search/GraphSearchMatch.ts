import type { ClusterId, NodeId } from '../graphIdentifiers';
export type GraphSearchMatch = {
    readonly nodeId: NodeId;
    readonly score: number;
    readonly matchedText: string;
    readonly clusterId?: ClusterId | null;
    readonly x?: number | null;
    readonly y?: number | null;
};
