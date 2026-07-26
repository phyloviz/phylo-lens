import type { GraphWorkbench, RenderNewickOptions } from "./workbench/graphWorkbench";
import type { PositionedGraph } from "../contracts/positioned";
import { SOURCE_FORMAT_NEWICK, SOURCE_FORMAT_TYPING_DATA, type SourceFormat } from "../contracts/models";
import { buildRenderedStatus } from "./shell/status/renderedStatus";
import { parseAncillaryPayload } from "./shell/inputs/ancillaryPayload";
import {
  ANCILLARY_MODE_GLOBAL,
  ANCILLARY_MODE_CURRENT,
  ANCILLARY_MODE_SELECTED,
  type AncillaryMode,
  getAncillaryMode,
  updateNodeSelectionVisibility as updateNodeSelectionVisibilityControl,
  updateNodeSelector,
} from "./shell/ancillary/nodeSelector";
import ancillaryWheels from "./shell/ancillary/ancillaryWheels";
import {
  DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
  DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
  DISPLAY_OPTION_NODE_LABELS,
  buildDisplayOptions,
  toggleClickedOption,
} from "./shell/controls/displayOptionsControls";
import {
  DEFAULT_MAX_NODES,
  isLodGraph,
  parseMaxNodes,
  updateLodPlaybackControls as updateLodPlaybackControlsView,
} from "./shell/controls/lodControls";
import metadataPieFieldControls from "./shell/controls/metadataPieFieldControls";
import { getSelectedOptions } from "./shell/controls/selectOptions";
import { readTextFile, resolveAncillaryFormat } from "./shell/inputs/fileInputs";
import eventBindings from "./shell/events/eventBindings";
import searchController from "./shell/search/searchController";
import regionSelection from "./shell/region/regionSelection";
import visualMappingPalette from "./shell/palette/visualMappingPalette";

// Re-export constants for external use.
export { STATUS_RENDERED_PREFIX } from "./shell/status/renderedStatus";
export { ERR_INVALID_ANCILLARY_JSON } from "./shell/inputs/ancillaryPayload";
export { CATEGORY_COLOR_INPUT_SELECTOR } from "./shell/palette/categoryColorControls";

// Status and user feedback messages for the shell UI.
export const DEFAULT_STATUS_READY = "Ready";
export const STATUS_RENDERING_PREFIX = "Rendering";
export const STATUS_FAILED_PREFIX = "Failed";
export const CATEGORY_COLOR_SAVE_FILENAME = "phyloviz-category-colors.txt";
export const SELECTED_NODE_WHEEL_EMPTY_MESSAGE = "Click a node to view its ancillary distribution.";
export const SELECT_PIE_FIELD_MESSAGE = "Select a metadata field to view its ancillary distribution.";

// Re-export ancillary mode constants for external use.
export {
  ANCILLARY_MODE_GLOBAL,
  ANCILLARY_MODE_CURRENT,
  ANCILLARY_MODE_SELECTED,
  DEFAULT_MAX_NODES,
  DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
  DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
  DISPLAY_OPTION_NODE_LABELS,
};
export type { AncillaryMode };

// Error messages for required shell elements.
export const ERR_STATUS_ELEMENT_REQUIRED = "Status element is required.";
export const ERR_RENDER_FORM_REQUIRED = "Render form is required.";
export const ERR_NEWICK_INPUT_REQUIRED = "Newick input is required.";
export const ERR_ANCILLARY_JOIN_COLUMN_REQUIRED = "Ancillary table join column is required.";

export interface UiShellElements {
  form: HTMLFormElement;
  newickInput: HTMLTextAreaElement;
  newickFileInput?: HTMLInputElement;
  sourceFormatSelect?: HTMLSelectElement;
  typingFileInput?: HTMLInputElement;
  datasetNameInput?: HTMLInputElement;
  ancillaryInput?: HTMLTextAreaElement;
  ancillaryFileInput?: HTMLInputElement;
  ancillaryJoinColumnInput?: HTMLInputElement;
  ancillaryFormatSelect?: HTMLSelectElement;
  status: HTMLElement;
  ancillaryWheelContainer?: HTMLElement;
  ancillarySelectedNodeWheelContainer?: HTMLElement;
  ancillaryModeSelect?: HTMLSelectElement;
  ancillaryNodeSelect?: HTMLSelectElement;
  metadataPieFieldSelect?: HTMLSelectElement;
  metadataSizeFieldInput?: HTMLInputElement;
  metadataSizeScaleSelect?: HTMLSelectElement;
  paletteControlsContainer?: HTMLElement;
  paletteLoadButton?: HTMLButtonElement;
  paletteLoadInput?: HTMLInputElement;
  paletteSaveButton?: HTMLButtonElement;
  displayOptionsSelect?: HTMLSelectElement;
  lodPlayButton?: HTMLButtonElement;
  lodPauseButton?: HTMLButtonElement;
  maxNodesInput?: HTMLInputElement;
  searchInput?: HTMLInputElement;
  searchButton?: HTMLButtonElement;
  searchResults?: HTMLElement;
  regionSelectToggle?: HTMLButtonElement;
  regionSelectionPanel?: HTMLElement;
}

export interface UiShellOptions {
  workbench: GraphWorkbench;
  elements: UiShellElements;
}

export interface UiShell {
  mount: () => void;
  renderCurrentInput: () => Promise<void>;
  unmount: () => void;
}

// Connect a minimal UI shell to the graph workbench orchestration layer.
export default function (options: UiShellOptions): UiShell {
  const workbench = options.workbench;
  const {
    form,
    newickInput,
    newickFileInput,
    sourceFormatSelect,
    typingFileInput,
    datasetNameInput,
    ancillaryInput,
    ancillaryFileInput,
    ancillaryJoinColumnInput,
    ancillaryFormatSelect,
    status: statusElement,
    ancillaryWheelContainer,
    ancillarySelectedNodeWheelContainer,
    ancillaryModeSelect,
    ancillaryNodeSelect,
    metadataPieFieldSelect,
    metadataSizeFieldInput,
    metadataSizeScaleSelect,
    paletteControlsContainer,
    paletteLoadButton,
    paletteLoadInput,
    paletteSaveButton,
    displayOptionsSelect,
    lodPlayButton,
    lodPauseButton,
    maxNodesInput,
    searchInput,
    searchButton,
    searchResults,
    regionSelectToggle,
    regionSelectionPanel,
  } = options.elements;

  let lastRenderedGraph: PositionedGraph | null = null;
  const bindings = eventBindings();
  const pieFieldControls = metadataPieFieldControls(metadataPieFieldSelect);
  const palette = visualMappingPalette({
    workbench,
    container: paletteControlsContainer,
    loadInput: paletteLoadInput,
    saveFilename: CATEGORY_COLOR_SAVE_FILENAME,
    getGraph: () => lastRenderedGraph,
    getSelectedFields: () => getSelectedOptions(metadataPieFieldSelect),
    getSizeFieldValue: () => metadataSizeFieldInput?.value,
    getSizeScaleValue: () => metadataSizeScaleSelect?.value,
    onChanged: () => {
      wheels.renderOverview();
    },
    setStatus,
    setFailureStatus,
  });
  const wheels = ancillaryWheels({
    overviewContainer: ancillaryWheelContainer,
    selectedNodeContainer: ancillarySelectedNodeWheelContainer,
    modeSelect: ancillaryModeSelect,
    nodeSelect: ancillaryNodeSelect,
    getGraph: () => lastRenderedGraph,
    getVisualMapping: () => palette.getCurrentVisualMapping(),
    getCategoryColorOverrides: () => palette.getCategoryColorOverrides(),
    getSelectedFields: () => getSelectedOptions(metadataPieFieldSelect),
    selectPieFieldMessage: SELECT_PIE_FIELD_MESSAGE,
    selectedNodeEmptyMessage: SELECTED_NODE_WHEEL_EMPTY_MESSAGE,
  });
  const search = searchController({
    workbench,
    input: searchInput,
    results: searchResults,
    setStatus,
    setFailureStatus,
    onNodeFocused: wheels.renderSelectedNode,
  });
  const region = regionSelection({
    workbench,
    toggle: regionSelectToggle,
    panel: regionSelectionPanel,
    readyStatus: DEFAULT_STATUS_READY,
    setStatus,
    setFailureStatus,
    buildWheelStats: wheels.buildStats,
  });

  if (!form) {
    throw new Error(ERR_RENDER_FORM_REQUIRED);
  }

  if (!newickInput) {
    throw new Error(ERR_NEWICK_INPUT_REQUIRED);
  }

  if (!statusElement) {
    throw new Error(ERR_STATUS_ELEMENT_REQUIRED);
  }

  return {
    mount: mount,
    renderCurrentInput: renderCurrentInput,
    unmount: unmount,
  };

  // Attach submit handlers and set initial shell status.
  function mount(): void {
    setStatus(DEFAULT_STATUS_READY);
    workbench.setGraphRenderedHandler((graph) => {
      handleGraphRendered(graph);
    });
    workbench.setNodeClickedHandler(({ nodeId }) => {
      if (nodeId === null) {
        wheels.resetSelectedNode();
        return;
      }
      wheels.renderSelectedNode(nodeId);
    });
    wheels.renderOverview();
    wheels.resetSelectedNode();
    palette.renderControls();

    const handleAncillaryModeChange = () => {
      updateNodeSelector(
        ancillaryNodeSelect,
        getAncillaryMode(ancillaryModeSelect) === ANCILLARY_MODE_SELECTED ? lastRenderedGraph : null,
      );
      updateNodeSelectionVisibility();
      wheels.renderOverview();
    };
    const handleMetadataPieFieldChange = () => {
      palette.renderControls();
      palette.applyControlChange();
    };
    const handleCategoryColorChange = () => {
      palette.readControlColors();
      palette.applyControlChange();
    };
    bindings.on(ancillaryModeSelect, "change", handleAncillaryModeChange);
    bindings.on(ancillaryNodeSelect, "change", () => {
      wheels.renderOverview();
    });
    bindings.on(metadataPieFieldSelect, "change", handleMetadataPieFieldChange);
    bindings.on(metadataPieFieldSelect, "mousedown", (event) => {
      handleMetadataPieFieldPointerDown(event as MouseEvent);
    });
    bindings.on(metadataSizeFieldInput, "input", () => {
      palette.applyControlChange();
    });
    bindings.on(metadataSizeScaleSelect, "change", () => {
      palette.applyControlChange();
    });
    bindings.on(paletteControlsContainer, "input", handleCategoryColorChange);
    bindings.on(paletteLoadButton, "click", () => {
      paletteLoadInput?.click();
    });
    bindings.on(paletteLoadInput, "change", () => {
      void palette.load();
    });
    bindings.on(paletteSaveButton, "click", () => {
      palette.save();
    });
    bindings.on(displayOptionsSelect, "change", () => {
      handleDisplayOptionsChange();
    });
    bindings.on(displayOptionsSelect, "mousedown", (event) => {
      handleDisplayOptionPointerDown(event as MouseEvent);
    });
    bindings.on(lodPlayButton, "click", () => {
      void handleLodPlaybackChange(false);
    });
    bindings.on(lodPauseButton, "click", () => {
      void handleLodPlaybackChange(true);
    });
    bindings.on(searchButton, "click", () => {
      void search.searchCurrentDataset();
    });
    bindings.on(regionSelectToggle, "click", () => {
      region.toggle();
    });
    workbench.setRegionSelectedHandler((bounds) => {
      void region.handleSelected(bounds);
    });
    region.mount();

    updateNodeSelectionVisibility();
    pieFieldControls.updateOptions(null);
    updateLodPlaybackControls(false);
    handleDisplayOptionsChange();

    bindings.on(form, "submit", (event) => {
      event.preventDefault();
      void renderCurrentInput();
    });
  }

  // Normalize and render using current user input values.
  async function renderCurrentInput(): Promise<void> {
    const sourceFormat = getSourceFormat();
    const content = (await getSourceContent(sourceFormat)).trim();
    const datasetName = datasetNameInput?.value.trim();
    const ancillaryRaw = ancillaryInput?.value.trim() ?? "";

    if (!content) {
      const label = sourceFormat === SOURCE_FORMAT_TYPING_DATA ? "empty typing data input" : "empty Newick input";
      setFailureStatus(label);
      return;
    }

    setStatus(`${STATUS_RENDERING_PREFIX}...`);

    try {
      const ancillaryPayload = parseAncillaryPayload(ancillaryRaw);
      const ancillaryData = await getAncillaryDataInput();
      palette.setBaseVisualMapping(ancillaryPayload.visual_mapping ?? {});
      await workbench.renderNewick(content, datasetName || undefined, {
        sourceFormat,
        metadataSchema: ancillaryPayload.metadata_schema,
        metadataByNodeId: ancillaryPayload.metadata_by_node_id,
        ancillaryData,
        visualMapping: palette.getCurrentVisualMapping(),
        displayOptions: buildCurrentDisplayOptions(),
        lod: {
          maxNodes: getSelectedMaxNodes(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setFailureStatus(message);
      lastRenderedGraph = null;
      palette.reset();
      updateNodeSelector(ancillaryNodeSelect, null);
      pieFieldControls.updateOptions(null);
      palette.renderControls();
      wheels.renderOverview();
    }
  }

  // Remove shell event listeners and dispose rendering resources.
  function unmount(): void {
    bindings.clear();
    workbench.setGraphRenderedHandler(null);
    workbench.setNodeClickedHandler(null);
    workbench.setRegionSelectedHandler(null);
    workbench.dispose();
  }

  // Update the shell status text for user feedback.
  function setStatus(status: string): void {
    statusElement.textContent = status;
  }

  function setFailureStatus(message: string): void {
    setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
  }

  function handleGraphRendered(graph: PositionedGraph): void {
    setStatus(buildRenderedStatus(graph));
    lastRenderedGraph = graph;
    updateNodeSelector(
      ancillaryNodeSelect,
      getAncillaryMode(ancillaryModeSelect) === ANCILLARY_MODE_SELECTED ? graph : null,
    );
    pieFieldControls.updateOptions(graph);
    palette.renderControls();
    updateNodeSelectionVisibility();
    updateLodPlaybackControls(isLodGraph(graph));
    wheels.renderOverview();
    wheels.resetSelectedNode();
    region.reset();
  }

  function handleDisplayOptionsChange(): void {
    workbench.updateDisplayOptions(buildCurrentDisplayOptions());
  }

  function handleMetadataPieFieldPointerDown(event: MouseEvent): void {
    if (pieFieldControls.toggleOption(event)) {
      palette.renderControls();
      palette.applyControlChange();
    }
  }

  function handleDisplayOptionPointerDown(event: MouseEvent): void {
    if (toggleClickedOption(displayOptionsSelect, event)) {
      handleDisplayOptionsChange();
    }
  }

  async function handleLodPlaybackChange(paused: boolean): Promise<void> {
    try {
      await workbench.setLodRefreshPaused(paused);
      updateLodPlaybackControls(isLodGraph(lastRenderedGraph));
      if (paused) {
        setStatus("LoD paused: navigate freely without slice refreshes");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setFailureStatus(message);
    }
  }

  function updateNodeSelectionVisibility(): void {
    updateNodeSelectionVisibilityControl(ancillaryNodeSelect, ancillaryModeSelect);
  }

  function updateLodPlaybackControls(lodAvailable: boolean): void {
    updateLodPlaybackControlsView({
      playButton: lodPlayButton,
      pauseButton: lodPauseButton,
      lodAvailable,
      paused: workbench.isLodRefreshPaused(),
    });
  }

  function getSelectedMaxNodes(): number {
    return parseMaxNodes(maxNodesInput?.value);
  }

  function buildCurrentDisplayOptions() {
    return buildDisplayOptions(getSelectedOptions(displayOptionsSelect));
  }

  function getSourceFormat(): SourceFormat {
    return sourceFormatSelect?.value === SOURCE_FORMAT_TYPING_DATA ? SOURCE_FORMAT_TYPING_DATA : SOURCE_FORMAT_NEWICK;
  }

  // Read the raw dataset content for the active source format: a typing-data
  // allelic-profile file when in typing mode, otherwise the Newick file (with
  // the hidden textarea as a fallback so a no-file demo still works).
  async function getSourceContent(sourceFormat: SourceFormat): Promise<string> {
    if (sourceFormat === SOURCE_FORMAT_TYPING_DATA) {
      const typingFile = typingFileInput?.files?.[0];
      return typingFile ? readTextFile(typingFile) : "";
    }

    const file = newickFileInput?.files?.[0];
    if (file) {
      return readTextFile(file);
    }

    return newickInput.value;
  }

  async function getAncillaryDataInput(): Promise<RenderNewickOptions["ancillaryData"] | undefined> {
    const file = ancillaryFileInput?.files?.[0];
    if (!file) {
      return undefined;
    }

    const joinColumn = ancillaryJoinColumnInput?.value.trim();
    if (!joinColumn) {
      throw new Error(ERR_ANCILLARY_JOIN_COLUMN_REQUIRED);
    }

    return {
      content: await readTextFile(file),
      join_column: joinColumn,
      format: resolveAncillaryFormat(ancillaryFormatSelect?.value, file.name),
    };
  }
}
