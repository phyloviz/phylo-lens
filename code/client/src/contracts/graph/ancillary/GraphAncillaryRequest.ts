import type { AncillaryDataInput } from "../../ancillary";

export interface GraphAncillaryRequest {
  datasetId: string;
  layoutVersion: string;
  ancillaryData: AncillaryDataInput;
}
