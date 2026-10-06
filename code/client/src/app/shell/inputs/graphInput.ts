import type { AncillaryTableInput } from '../../../contracts/ancillary';
import { SOURCE_FORMAT_TYPING_DATA, type SourceFormat } from '../../../contracts/models';
import { readTextFile, resolveAncillaryFormat } from './fileInputs';

export const ERR_ANCILLARY_JOIN_COLUMN_REQUIRED = 'Ancillary table join column is required.';

type GraphInputElements = {
  readonly newickInput: HTMLTextAreaElement;
  readonly newickFileInput?: HTMLInputElement;
  readonly typingFileInput?: HTMLInputElement;
  readonly ancillaryFileInput?: HTMLInputElement;
  readonly ancillaryColumnInput?: HTMLInputElement | HTMLSelectElement;
  readonly ancillaryFormatSelect?: HTMLSelectElement;
};

/** Read form inputs; preparation and UI status remain in their owning workflows. */
export function graphInputReader(elements: GraphInputElements, waitForColumns: () => Promise<void>) {
  return { readSourceContent, readAncillaryTable };

  async function readSourceContent(format: SourceFormat): Promise<string> {
    if (format === SOURCE_FORMAT_TYPING_DATA) {
      const file = elements.typingFileInput?.files?.[0];
      return file ? readTextFile(file) : '';
    }
    const file = elements.newickFileInput?.files?.[0];
    return file ? readTextFile(file) : elements.newickInput.value;
  }

  async function readAncillaryTable(): Promise<AncillaryTableInput | undefined> {
    await waitForColumns();
    const file = elements.ancillaryFileInput?.files?.[0];
    if (!file) return undefined;
    const joinColumn = elements.ancillaryColumnInput?.value.trim();
    if (!joinColumn) throw new Error(ERR_ANCILLARY_JOIN_COLUMN_REQUIRED);
    return {
      content: (await readTextFile(file)).replace(/^\uFEFF/, ''),
      joinColumn,
      format: resolveAncillaryFormat(elements.ancillaryFormatSelect?.value, file.name),
    };
  }
}
