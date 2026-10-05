import type { DatasetId, LayoutVersion } from "../graphIdentifiers";
import type { AncillaryDataInput } from "../../ancillary";

export interface GraphAncillaryRequest {
  datasetId: DatasetId;
  layoutVersion: LayoutVersion;
  ancillaryData: AncillaryDataInput;
}
