import type { PositionedGraph } from '../../../contracts/positioned';
import { SOURCE_FORMAT_TYPING_DATA, SOURCE_FORMAT_NEWICK, type SourceFormat } from '../../../contracts/models';
import type { GraphDisplayOptions } from '../../../render/renderer.types';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import { toError } from '../../errors';
import type createAncillaryControls from '../ancillary/ancillaryControls';
import { parseMaxNodes } from '../controls/lodControls';
import eventBindings from '../events/eventBindings';
import { ancillaryJoinColumnPicker } from './ancillaryJoinColumn';
import { parseAncillaryPayload } from './ancillaryPayload';
import { graphInputReader } from './graphInput';

export const STATUS_RENDERING_PREFIX = 'Rendering';

export type GraphLoadingElements = {
  readonly form: HTMLFormElement;
  readonly newickInput: HTMLTextAreaElement;
  readonly newickFileInput?: HTMLInputElement;
  readonly newickSourceControls?: HTMLElement;
  readonly sourceFormatSelect?: HTMLSelectElement;
  readonly typingFileInput?: HTMLInputElement;
  readonly typingSourceControls?: HTMLElement;
  readonly datasetNameInput?: HTMLInputElement;
  readonly ancillaryInput?: HTMLTextAreaElement;
  readonly ancillaryFileInput?: HTMLInputElement;
  readonly applyAncillaryButton?: HTMLButtonElement;
  readonly ancillaryJoinColumnInput?: HTMLInputElement | HTMLSelectElement;
  readonly ancillaryFormatSelect?: HTMLSelectElement;
  readonly maxNodesInput?: HTMLInputElement;
};

type GraphLoadingOptions = {
  readonly workbench: Pick<GraphWorkbench, 'loadGraph' | 'applyAncillaryData'>;
  readonly elements: GraphLoadingElements;
  readonly ancillary: Pick<ReturnType<typeof createAncillaryControls>, 'resetSelectedNode' | 'prepareVisualMapping'>;
  readonly getGraph: () => PositionedGraph | null;
  readonly getDisplayOptions: () => GraphDisplayOptions;
  readonly onLoadStarted: () => void;
  readonly onLoadFailed: () => void;
  readonly setStatus: (message: string) => void;
  readonly setFailureStatus: (message: string) => void;
};

export default function createGraphLoading(options: GraphLoadingOptions) {
  const {
    form,
    newickInput,
    newickFileInput,
    newickSourceControls,
    sourceFormatSelect,
    typingFileInput,
    typingSourceControls,
    datasetNameInput,
    ancillaryInput,
    ancillaryFileInput,
    applyAncillaryButton,
    ancillaryJoinColumnInput,
    ancillaryFormatSelect,
    maxNodesInput,
  } = options.elements;
  const bindings = eventBindings();
  let applyingAncillary = false;
  let loadingGraph = false;
  let loadSequence = 0;
  const columns = ancillaryJoinColumnPicker({
    fileInput: ancillaryFileInput,
    columnInput: ancillaryJoinColumnInput,
    formatSelect: ancillaryFormatSelect,
    onError: options.setFailureStatus,
  });
  const inputs = graphInputReader(
    {
      newickInput,
      newickFileInput,
      typingFileInput,
      ancillaryFileInput,
      ancillaryColumnInput: ancillaryJoinColumnInput,
      ancillaryFormatSelect,
    },
    columns.whenReady
  );

  return { mount, unmount, renderCurrentInput, updateApplyAncillaryButton, getLoadSequence: () => loadSequence };

  function mount(): void {
    void columns.refresh();
    bindings.on(ancillaryFileInput, 'change', () => void columns.refresh());
    bindings.on(ancillaryFormatSelect, 'change', () => void columns.refresh());
    bindings.on(sourceFormatSelect, 'change', updateSourceControls);
    bindings.on(applyAncillaryButton, 'click', () => void applyCurrentAncillaryData());
    bindings.on(form, 'submit', event => {
      event.preventDefault();
      void renderCurrentInput();
    });
    updateSourceControls();
    updateApplyAncillaryButton();
  }

  function unmount(): void {
    loadSequence += 1;
    columns.dispose();
    bindings.clear();
  }

  function getSourceFormat(): SourceFormat {
    return sourceFormatSelect?.value === SOURCE_FORMAT_TYPING_DATA ? SOURCE_FORMAT_TYPING_DATA : SOURCE_FORMAT_NEWICK;
  }

  function updateSourceControls(): void {
    const typing = getSourceFormat() === SOURCE_FORMAT_TYPING_DATA;
    newickSourceControls?.toggleAttribute('hidden', typing);
    typingSourceControls?.toggleAttribute('hidden', !typing);
  }

  function updateApplyAncillaryButton(): void {
    if (applyAncillaryButton) applyAncillaryButton.disabled = !options.getGraph() || applyingAncillary || loadingGraph;
  }

  async function applyCurrentAncillaryData(): Promise<void> {
    if (!options.getGraph() || applyingAncillary || loadingGraph) return;
    const sequence = loadSequence;
    applyingAncillary = true;
    updateApplyAncillaryButton();
    options.setStatus('Applying ancillary data...');
    try {
      const data = await inputs.readAncillaryTable();
      if (sequence !== loadSequence) return;
      if (!data) throw new Error('Choose an ancillary table first.');
      const result = await options.workbench.applyAncillaryData(data);
      if (sequence !== loadSequence) return;
      options.setStatus(
        `Applied ancillary data to ${result.matchedNodeCount} nodes.${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}`
      );
    } catch (error) {
      if (sequence !== loadSequence) return;
      options.setFailureStatus(toError(error).message);
    } finally {
      if (sequence === loadSequence) {
        applyingAncillary = false;
        updateApplyAncillaryButton();
      }
    }
  }

  async function renderCurrentInput(): Promise<void> {
    const sequence = ++loadSequence;
    applyingAncillary = false;
    try {
      const format = getSourceFormat();
      const content = (await inputs.readSourceContent(format)).trim();
      if (sequence !== loadSequence) return;
      const datasetName = datasetNameInput?.value.trim();
      const ancillaryRaw = ancillaryInput?.value.trim() ?? '';
      if (!content) {
        options.setFailureStatus(
          format === SOURCE_FORMAT_TYPING_DATA ? 'empty typing data input' : 'empty Newick input'
        );
        return;
      }

      loadingGraph = true;
      options.onLoadStarted();
      updateApplyAncillaryButton();
      options.setStatus(`${STATUS_RENDERING_PREFIX}...`);
      options.ancillary.resetSelectedNode();
      const payload = parseAncillaryPayload(ancillaryRaw);
      const ancillaryData = await inputs.readAncillaryTable();
      if (sequence !== loadSequence) return;
      const visualMapping = options.ancillary.prepareVisualMapping(payload.visualMapping ?? {});
      await options.workbench.loadGraph(
        { content, datasetName: datasetName || undefined, format },
        {
          ancillarySchema: payload.ancillarySchema,
          ancillaryByNodeId: payload.ancillaryByNodeId,
          ancillaryData,
          visualMapping,
          displayOptions: options.getDisplayOptions(),
          lod: { maxNodes: parseMaxNodes(maxNodesInput?.value) },
        }
      );
    } catch (error) {
      if (sequence !== loadSequence) return;
      options.setFailureStatus(toError(error).message);
      options.onLoadFailed();
    } finally {
      if (sequence === loadSequence) {
        loadingGraph = false;
        updateApplyAncillaryButton();
      }
    }
  }
}
