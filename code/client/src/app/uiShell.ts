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
import { isLodGraph, updateLodRefreshControl } from './shell/controls/lodControls';
import eventBindings from './shell/events/eventBindings';
import searchController from './shell/search/searchController';
import regionSelection from './shell/region/regionSelection';
import createArrangementControls, { type ArrangementControlsElements } from './shell/controls/arrangementControls';
import createPngExportControls, { type PngExportControlsElements } from './shell/controls/pngExportControls';
import createWorkspaceControls from './shell/controls/workspaceControls';

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
    readonly workspaceRoot?: HTMLElement;
    readonly expansion?: ExpansionControlsElements;
    readonly automaticDetailInput?: HTMLInputElement;
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
    automaticDetailInput,
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
  let selectedNodeId: string | null = null;
  const getGraph = (): PositionedGraph | null => lastRenderedGraph;
  const bindings = eventBindings();
  const workspace = createWorkspaceControls(elements.workspaceRoot);
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
    onNodeFocused: selectNode,
  });
  const region = regionSelection({
    workbench,
    toggle: regionSelectToggle,
    panel: regionSelectionPanel,
    readyStatus: DEFAULT_STATUS_READY,
    setStatus,
    setFailureStatus,
    getAncillaryDistribution: ancillary.getDistribution,
    onSelected: workspace.showRegion,
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
      workspace.loadStarted();
      selectNode(null);
      search.reset();
      region.reset();
      arrangement.reset();
      arrangement.setReady(false);
      expansion.setReady(false);
      refreshLodControls(false);
    },
    onLoadFailed: () => {
      workspace.loadFailed();
      lastRenderedGraph = null;
      ancillary.resetAfterFailure();
    },
    onLoadCompleted: workspace.loadCompleted,
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
    workspace.mount();
    loading.mount();
    arrangement.mount();
    expansion.mount();
    workbench.setErrorHandler(error => setFailureStatus(error.message));
    workbench.setGraphRenderedHandler(handleGraphRendered);
    workbench.setNodeClickedHandler(state => selectNode(state.nodeId));
    ancillary.mount();
    display.mount();
    pngExport.mount();
    bindings.on(automaticDetailInput, 'change', () => handleLodPlaybackChange(!automaticDetailInput!.checked));
    bindings.on(searchInput, 'input', search.reset);
    bindings.on(searchInput, 'keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      void search.searchCurrentDataset();
    });
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
    workspace.unmount();
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
    arrangement.setReady(graph.nodes.length > 1);
    expansion.setReady(true);
    loading.updateApplyAncillaryButton();
    ancillary.refreshGraph(graph);
    refreshSelectionControls();
    refreshLodControls(isLodGraph(graph));
    region.reset();
  }

  function selectNode(nodeId: string | null): void {
    selectedNodeId = nodeId;
    refreshSelectionControls();
    workspace.selectNode(nodeId);
    if (nodeId === null) ancillary.resetSelectedNode();
    else ancillary.showNode(nodeId);
  }

  function refreshSelectionControls(): void {
    const node = lastRenderedGraph?.nodes.find(candidate => candidate.id === selectedNodeId);
    expansion.select({ nodeId: node?.id ?? null, attributes: node?.attributes });
    arrangement.selectNode(node?.id ?? null);
  }

  function handleLodPlaybackChange(paused: boolean): void {
    try {
      workbench.setLodRefreshPaused(paused);
      refreshLodControls(isLodGraph(lastRenderedGraph));
      setStatus(
        paused
          ? 'Automatic detail updates paused. Node motion is controlled separately.'
          : 'Automatic detail updates enabled.'
      );
    } catch (error) {
      setFailureStatus(toError(error).message);
    }
  }

  function refreshLodControls(lodAvailable: boolean): void {
    updateLodRefreshControl({
      input: automaticDetailInput,
      lodAvailable,
      paused: workbench.isLodRefreshPaused(),
    });
  }
}
