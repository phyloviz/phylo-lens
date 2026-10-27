import type { AncillaryData } from '../../../../contracts/ancillary';

export interface GraphIsolateDto {
  id: string;
  metadata: AncillaryData;
  metadata_cached?: boolean;
}
