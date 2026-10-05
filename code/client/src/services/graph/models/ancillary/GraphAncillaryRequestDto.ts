import type { AncillaryDataInputDto } from "./AncillaryDataInputDto";

export interface GraphAncillaryRequestDto {
  dataset_id: string;
  layout_version: string;
  ancillary_data: AncillaryDataInputDto;
}
