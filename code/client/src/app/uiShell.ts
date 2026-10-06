import { toError } from './errors';
import { expansionControls, type ExpansionControlsElements } from './shell/controls/expansionControls';
import type { GraphWorkbench } from './workbench/graphWorkbench';
import type { PositionedGraph } from '../contracts/positioned';
import { buildRenderedStatus } from './shell/status/renderedStatus';
import createAncillaryControls, { type AncillaryControlsElements } from './shell/ancillary/ancillaryControls';
import createGraphLoading, { type GraphLoadingElements } from './shell/inputs/graphLoading';
import createDisplayOptionsControls, {
  type DisplayOptionsControlsElements,
} from './shell/controls/displayOptionsControls';
import { isLodGraph, updateLodPlaybackControls } from './shell/controls/lodControls';
import eventBindings from './shell/events/eventBindings';
import searchController from './shell/search/searchController';
import regionSelection from './shell/region/regionSelection';
import createArrangementControls, { type ArrangementControlsElements } from './shell/controls/arrangementControls';
import createPngExportControls, { type PngExportControlsElements } from './shell/controls/pngExportControls';

export { STATUS_RENDERED_PREFIX } from './shell/status/renderedStatus';
export { STATUS_RENDERING_PREFIX } from './shell/inputs/graphLoading';
export { ERR_INVALID_ANCILLARY_JSON } from './shell/inputs/ancillaryPayload';
export { ERR_ANCILLARY_JOIN_COLUMN_REQUIRED } from './shell/inputs/graphInput';
export { CATEGORY_COLOR_INPUT_SELECTOR } from './shell/palette/categoryColorControls';
export {
  CATEGORY_COLOR_SAVE_FILENAME,
  SELECTED_NODE_WHEEL_EMPTY_MESSAGE,
  SELECT_PIE_FIELD_MESSAGE,
} from './shell/ancillary/ancillaryControls';
export {
  ANCILLARY_MODE_GLOBAL,
  ANCILLARY_MODE_CURRENT,
  ANCILLARY_MODE_SELECTED,
  type AncillaryMode,
} from './shell/ancillary/nodeSelector';
export {
  DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
  DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
  DISPLAY_OPTION_NODE_LABELS,
} from './shell/controls/displayOptionsControls';

export const DEFAULT_STATUS_READY = 'Ready';
export const STATUS_FAILED_PREFIX = 'Failed';
export const ERR_STATUS_ELEMENT_REQUIRED = 'Status element is required.';
export const ERR_RENDER_FORM_REQUIRED = 'Render form is required.';
export const ERR_NEWICK_INPUT_REQUIRED = 'Newick input is required.';

export type UiShellElements = ArrangementControlsElements &
  DisplayOptionsControlsElements &
  PngExportControlsElements &
  AncillaryControlsElements &
  GraphLoadingElements & {
    readonly status: HTMLElement;
    readonly expansion?: ExpansionControlsElements;
    readonly lodPlayButton?: HTMLButtonElement;
    readonly lodPauseButton?: HTMLButtonElement;
    readonly searchInput?: HTMLInputElement;
    readonly searchButton?: HTMLButtonElement;
    readonly searchResults?: HTMLElement;
    readonly regionSelectToggle?: HTMLButtonElement;
    readonly regionSelectionPanel?: HTMLElement;
  };

export type UiShellOptions = {
  readonly workbench: GraphWorkbench;
  readonly elements: UiShellElements;
};

export type UiShell = {
  mount: () => void;
  renderCurrentInput: () => Promise<void>;
  unmount: () => void;
};

export default function createUiShell(options: UiShellOptions): UiShell {
  const { workbench, elements } = options;
  const {
    status,
    lodPlayButton,
    lodPauseButton,
    searchInput,
    searchButton,
    searchResults,
    regionSelectToggle,
    regionSelectionPanel,
  } = elements;
  if (!elements.form) throw new Error(ERR_RENDER_FORM_REQUIRED);
  if (!elements.newickInput) throw new Error(ERR_NEWICK_INPUT_REQUIRED);
  if (!status) throw new Error(ERR_STATUS_ELEMENT_REQUIRED);

  let lastRenderedGraph: PositionedGraph | null = null;
  const getGraph = (): PositionedGraph | null => lastRenderedGraph;
  const bindings = eventBindings();
  const expansion = expansionControls(workbench, elements.expansion);
  const arrangement = createArrangementControls(workbench, elements);
  const display = createDisplayOptionsControls(workbench, elements);
  const ancillary = createAncillaryControls({
    updateVisualMapping: mapping => workbench.updateVisualMapping(mapping),
    elements,
    getGraph,
    setStatus,
    setFailureStatus,
  });
  const search = searchController({
    workbench,
    input: searchInput,
    results: searchResults,
    setStatus,
    setFailureStatus,
    onNodeFocused: ancillary.showNode,
  });
  const region = regionSelection({
    workbench,
    toggle: regionSelectToggle,
    panel: regionSelectionPanel,
    readyStatus: DEFAULT_STATUS_READY,
    setStatus,
    setFailureStatus,
    getAncillaryDistribution: ancillary.getDistribution,
  });
  const loading = createGraphLoading({
    workbench,
    elements,
    ancillary,
    getGraph,
    getDisplayOptions: display.readOptions,
    setStatus,
    setFailureStatus,
    onLoadStarted: () => {
      search.reset();
      region.reset();
      arrangement.reset();
      expansion.setReady(false);
    },
    onLoadFailed: () => {
      lastRenderedGraph = null;
      ancillary.resetAfterFailure();
    },
  });
  const pngExport = createPngExportControls({
    workbench,
    elements,
    hasGraph: () => lastRenderedGraph !== null,
    getEdgeLabelsEnabled: () => display.readOptions().edgeDistanceLabels === true,
    getLoadSequence: loading.getLoadSequence,
    setStatus,
    setFailureStatus,
  });

  return { mount, renderCurrentInput: loading.renderCurrentInput, unmount };

  function mount(): void {
    setStatus(DEFAULT_STATUS_READY);
    loading.mount();
    arrangement.mount();
    expansion.mount();
    workbench.setErrorHandler(error => setFailureStatus(error.message));
    workbench.setGraphRenderedHandler(handleGraphRendered);
    workbench.setNodeClickedHandler(state => {
      expansion.select(state);
      arrangement.selectNode(state.nodeId);
      if (state.nodeId === null) ancillary.resetSelectedNode();
      else ancillary.showNode(state.nodeId);
    });
    ancillary.mount();
    display.mount();
    pngExport.mount();
    bindings.on(lodPlayButton, 'click', () => handleLodPlaybackChange(false));
    bindings.on(lodPauseButton, 'click', () => handleLodPlaybackChange(true));
    bindings.on(searchInput, 'input', search.reset);
    bindings.on(searchButton, 'click', () => void search.searchCurrentDataset());
    bindings.on(regionSelectToggle, 'click', region.toggle);
    workbench.setRegionSelectedHandler(bounds => void region.handleSelected(bounds));
    region.mount();
    refreshLodControls(false);
    display.apply();
  }

  function unmount(): void {
    loading.unmount();
    ancillary.unmount();
    search.reset();
    region.reset();
    bindings.clear();
    display.unmount();
    pngExport.unmount();
    expansion.dispose();
    workbench.setErrorHandler(null);
    workbench.setGraphRenderedHandler(null);
    arrangement.unmount();
    workbench.setNodeClickedHandler(null);
    workbench.setRegionSelectedHandler(null);
    workbench.dispose();
  }

  function setStatus(message: string): void {
    status.textContent = message;
  }

  function setFailureStatus(message: string): void {
    setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
  }

  function handleGraphRendered(graph: PositionedGraph): void {
    setStatus(buildRenderedStatus(graph));
    lastRenderedGraph = graph;
    expansion.setReady(true);
    loading.updateApplyAncillaryButton();
    ancillary.refreshGraph(graph);
    refreshLodControls(isLodGraph(graph));
    region.reset();
  }

  function handleLodPlaybackChange(paused: boolean): void {
    try {
      workbench.setLodRefreshPaused(paused);
      refreshLodControls(isLodGraph(lastRenderedGraph));
      if (paused) setStatus('LoD paused: navigate freely without slice refreshes');
    } catch (error) {
      setFailureStatus(toError(error).message);
    }
  }

  function refreshLodControls(lodAvailable: boolean): void {
    updateLodPlaybackControls({
      playButton: lodPlayButton,
      pauseButton: lodPauseButton,
      lodAvailable,
      paused: workbench.isLodRefreshPaused(),
    });
  }
}
