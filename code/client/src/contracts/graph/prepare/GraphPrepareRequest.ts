import type { SourceFormat } from "../../models";
import type { AncillaryField, AncillaryData, AncillaryDataInput } from "../../ancillary";
import type { SfdpOptions } from "../SfdpOptions";

export interface GraphPrepareRequest {
  format: SourceFormat;
  datasetName?: string;
  content: string;

  options?: {
    allowSelfLoops?: boolean;
  };

  ancillarySchema?: readonly AncillaryField[];
  ancillaryByNodeId?: Record<string, AncillaryData>;

  ancillaryData?: AncillaryDataInput;

  sfdpOptions?: SfdpOptions;
}
