import type { ClusterId, NodeId } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';
import type { NodeAnnotations, Isolate, AncillaryObservation } from '../../ancillary';
import type { Point } from '../../Point';

export type GraphViewportNode = Point & {
  readonly id: NodeId;
  readonly clusterId: ClusterId;
  readonly layoutStatus: GraphLayoutStatus;
  readonly memberCount: number;
  readonly isRepresentative: boolean;
  readonly annotations: NodeAnnotations;
  readonly isolates?: readonly Isolate[];
  readonly ancillaryDistribution?: readonly AncillaryObservation[];
};
