import { DEFAULT_SMALL_COMPONENT_THRESHOLD } from '../../../contracts/graph/LodPreparationOptions';
import type { DistanceConnectionOptions } from '../../../contracts/graph/connections';
import type { TypingOptions } from '../../../contracts/graph/TypingOptions';
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
  readonly typingAlgorithmSelect?: HTMLSelectElement;
  readonly typingNlvControls?: HTMLElement;
  readonly typingNlvInput?: HTMLInputElement;
  readonly initialNlvInput?: HTMLInputElement;
  readonly initialNlvControls?: HTMLElement;
  readonly initialNlvLevelInput?: HTMLInputElement;
  readonly initialNlvLimitInput?: HTMLInputElement;
  readonly datasetNameInput?: HTMLInputElement;
  readonly ancillaryInput?: HTMLTextAreaElement;
  readonly ancillaryFileInput?: HTMLInputElement;
  readonly applyAncillaryButton?: HTMLButtonElement;
  readonly ancillaryJoinColumnInput?: HTMLInputElement | HTMLSelectElement;
  readonly ancillaryFormatSelect?: HTMLSelectElement;
  readonly maxNodesInput?: HTMLInputElement;
  readonly smallComponentThresholdInput?: HTMLInputElement;
  readonly distanceCutoffInput?: HTMLInputElement;
};

type GraphLoadingOptions = {
  readonly workbench: Pick<GraphWorkbench, 'loadGraph' | 'applyAncillaryData'>;
  readonly elements: GraphLoadingElements;
  readonly ancillary: Pick<
    ReturnType<typeof createAncillaryControls>,
    'resetSelectedNode' | 'prepareVisualMapping' | 'resetPalette'
  >;
  readonly getGraph: () => PositionedGraph | null;
  readonly getDisplayOptions: () => GraphDisplayOptions;
  readonly onLoadStarted: () => void;
  readonly onLoadFailed: () => void;
  readonly onLoadCompleted?: (
    name: string,
    format: SourceFormat,
    connections?: DistanceConnectionOptions
  ) => void | Promise<void>;
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
    typingAlgorithmSelect,
    typingNlvControls,
    typingNlvInput,
    initialNlvInput,
    initialNlvControls,
    datasetNameInput,
    ancillaryInput,
    ancillaryFileInput,
    applyAncillaryButton,
    ancillaryJoinColumnInput,
    ancillaryFormatSelect,
    maxNodesInput,
    smallComponentThresholdInput,
    distanceCutoffInput,
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
    bindings.on(initialNlvInput, 'change', updateSourceControls);
    bindings.on(typingAlgorithmSelect, 'change', updateSourceControls);
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
    const bounded = typing && typingAlgorithmSelect?.value === 'goeburst';
    typingNlvControls?.toggleAttribute('hidden', !bounded);
    if (typingNlvInput) typingNlvInput.disabled = !bounded;
    initialNlvControls?.toggleAttribute('hidden', !typing || !initialNlvInput?.checked);
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
      options.ancillary.resetPalette();
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
    let loadStarted = false;
    try {
      const format = getSourceFormat();
      const typingOptions = readTypingOptions(format, options.elements);
      const initialConnections = readInitialNlvConnections(format, options.elements);
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

      const payload = parseAncillaryPayload(ancillaryRaw);
      const ancillaryData = await inputs.readAncillaryTable();
      if (sequence !== loadSequence) return;
      const displayOptions = options.getDisplayOptions();
      const distanceCutoff = parseDistanceCutoff(distanceCutoffInput?.value);
      const maxNodes = parseMaxNodes(maxNodesInput?.value);
      const smallComponentThreshold = parseSmallComponentThreshold(smallComponentThresholdInput?.value);
      loadStarted = true;
      loadingGraph = true;
      options.onLoadStarted();
      updateApplyAncillaryButton();
      options.setStatus(`${STATUS_RENDERING_PREFIX}...`);
      options.ancillary.resetSelectedNode();
      const visualMapping = options.ancillary.prepareVisualMapping(payload.visualMapping ?? {});
      await options.workbench.loadGraph(
        { content, datasetName: datasetName || undefined, format },
        {
          ancillarySchema: payload.ancillarySchema,
          ancillaryByNodeId: payload.ancillaryByNodeId,
          ancillaryData,
          visualMapping,
          displayOptions,
          distanceCutoff,
          typingOptions,
          lod: { maxNodes },
          lodPreparation: { smallComponentThreshold },
        }
      );
      if (sequence !== loadSequence) return;
      const fileName = (format === SOURCE_FORMAT_TYPING_DATA ? typingFileInput : newickFileInput)?.files?.[0]?.name;
      await options.onLoadCompleted?.(datasetName || fileName || 'Untitled dataset', format, initialConnections);
    } catch (error) {
      if (sequence !== loadSequence) return;
      options.setFailureStatus(toError(error).message);
      if (loadStarted) options.onLoadFailed();
    } finally {
      if (sequence === loadSequence) {
        loadingGraph = false;
        updateApplyAncillaryButton();
      }
    }
  }
}

function readTypingOptions(format: SourceFormat, elements: GraphLoadingElements): TypingOptions | undefined {
  if (format !== SOURCE_FORMAT_TYPING_DATA) return undefined;
  if (elements.typingAlgorithmSelect?.value !== 'goeburst') return { algorithm: 'goeburstfullmst' };
  const raw = elements.typingNlvInput?.value.trim();
  const nlv = raw ? Number(raw) : 3;
  if (!Number.isSafeInteger(nlv) || nlv < 1 || nlv > 2147483647)
    throw new Error('goeBURST nLV level must be a positive whole number up to 2147483647.');
  return { algorithm: 'goeburst', nlv };
}

function parseSmallComponentThreshold(value: string | undefined): number {
  const threshold = value?.trim() ? Number(value) : DEFAULT_SMALL_COMPONENT_THRESHOLD;
  if (!Number.isSafeInteger(threshold) || threshold < 0)
    throw new Error('Small component threshold must be a nonnegative integer.');
  return threshold;
}

function readInitialNlvConnections(
  format: SourceFormat,
  elements: GraphLoadingElements
): DistanceConnectionOptions | undefined {
  if (format !== SOURCE_FORMAT_TYPING_DATA || !elements.initialNlvInput?.checked) return undefined;
  const rawLevel = elements.initialNlvLevelInput?.value.trim();
  const threshold = rawLevel ? Number(rawLevel) : NaN;
  if (!Number.isSafeInteger(threshold) || threshold < 0)
    throw new Error('Initial nLV level must be a nonnegative whole number.');
  const maxConnections = Number(elements.initialNlvLimitInput?.value ?? 50000);
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1)
    throw new Error('Maximum additional connections must be a positive whole number.');
  return { threshold, maxConnections };
}

function parseDistanceCutoff(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const cutoff = Number(value);
  if (!Number.isFinite(cutoff) || cutoff < 0) throw new Error('Distance cutoff must be a finite nonnegative number.');
  return cutoff;
}
