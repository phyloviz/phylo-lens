import type { SourceFormat } from "../../../../contracts/models";

import type { AncillaryField, AncillaryData } from "../../../../contracts/ancillary";
import type { AncillaryDataInputDto } from "../ancillary/AncillaryDataInputDto";
import type { SfdpOptions } from "../../../../contracts/graph/SfdpOptions";

export interface GraphPrepareRequestDto {
  format: SourceFormat;
  dataset_name?: string;
  content: string;

  options?: {
    allow_self_loops?: boolean;
  };

  metadata_schema?: readonly AncillaryField[];
  metadata_by_node_id?: Record<string, AncillaryData>;

  ancillary_data?: AncillaryDataInputDto;

  sfdp_options?: SfdpOptions;
}
