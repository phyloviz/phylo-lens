import type { SourceFormat } from '../../models';
import type { AncillaryField, AncillaryData, AncillaryDataInput } from '../../ancillary';
import type { SfdpOptions } from '../SfdpOptions';

export type GraphPrepareRequest = {
  readonly format: SourceFormat;
  readonly datasetName?: string;
  readonly content: string;

  readonly options?: {
    readonly allowSelfLoops?: boolean;
  };

  readonly ancillarySchema?: readonly AncillaryField[];
  readonly ancillaryByNodeId?: Readonly<Record<string, AncillaryData>>;

  readonly ancillaryData?: AncillaryDataInput;

  readonly sfdpOptions?: SfdpOptions;
};
