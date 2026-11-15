import type { LodPreparationOptions } from '../LodPreparationOptions';
import type { SourceFormat } from '../../models';
import type { AncillaryField, AncillaryData, AncillaryDataInput } from '../../ancillary';
import type { SfdpOptions } from '../SfdpOptions';
import type { TypingOptions } from '../TypingOptions';

export type GraphPrepareRequest = {
  readonly format: SourceFormat;
  readonly datasetName?: string;
  readonly content: string;
  readonly distanceCutoff?: number;
  readonly typingOptions?: TypingOptions;

  readonly options?: {
    readonly allowSelfLoops?: boolean;
  };

  readonly ancillarySchema?: readonly AncillaryField[];
  readonly ancillaryByNodeId?: Readonly<Record<string, AncillaryData>>;

  readonly ancillaryData?: AncillaryDataInput;

  readonly sfdpOptions?: SfdpOptions;
  readonly lodPreparation?: LodPreparationOptions;
};
