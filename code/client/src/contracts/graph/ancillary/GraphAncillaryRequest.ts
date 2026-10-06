import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
import type { AncillaryDataInput } from '../../ancillary';

export type GraphAncillaryRequest = {
  readonly datasetId: DatasetId;
  readonly layoutVersion: LayoutVersion;
  readonly ancillaryData: AncillaryDataInput;
};
