import type { ClusterId, NodeId } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';
import type { NodeAnnotations, Isolate, AncillaryObservation } from '../../ancillary';

export type GraphViewportNode = {
    readonly id: NodeId;
    readonly clusterId: ClusterId;
    readonly x: number;
    readonly y: number;
    readonly layoutStatus: GraphLayoutStatus;
    readonly memberCount: number;
    readonly isRepresentative: boolean;
    readonly annotations: NodeAnnotations;
    readonly isolates?: readonly Isolate[];
    readonly ancillaryDistribution?: readonly AncillaryObservation[];
};
