import { GraphLayoutStatus } from "../graphTypes";
import type { NodeAnnotations, Isolate, AncillaryObservation } from "../../ancillary";

export interface GraphViewportNode {
  id: string;
  clusterId: string;
  x: number;
  y: number;
  layoutStatus: GraphLayoutStatus;
  memberCount: number;
  isRepresentative: boolean;
  annotations: NodeAnnotations;
  isolates?: Isolate[];
  ancillaryDistribution?: AncillaryObservation[];
}
