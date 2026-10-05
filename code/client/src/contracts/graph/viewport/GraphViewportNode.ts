import { GraphLayoutStatus } from "../graphTypes";
import type { AncillaryData, Isolate, AncillaryObservation } from "../../ancillary";

export interface GraphViewportNode {
  id: string;
  clusterId: string;
  x: number;
  y: number;
  layoutStatus: GraphLayoutStatus;
  memberCount: number;
  isRepresentative: boolean;
  metadata?: AncillaryData | null;
  isolates?: Isolate[];
  ancillaryDistribution?: AncillaryObservation[];
}
