import type {
  GraphWorkbench,
  RenderNewickOptions,
} from "./workbench/graphWorkbench";
import { DEFAULT_COLOR_PALETTE } from "../render/visualMappings";
import type { VisualMappingOptions } from "../render/visualMappings";
import { PIE_OTHER_SLICE_COLOR, PIE_OTHER_SLICE_LABEL } from "../render/pieMapping";
import {
  buildAncillaryWheelStats,
  buildMetadataFieldWheelStats,
  collectMetadataFieldSummaries,
  renderAncillaryWheel,
} from "../components/ancillaryWheel";
import type { PositionedGraph } from "../contracts/positioned";
import {
  SOURCE_FORMAT_NEWICK,
  SOURCE_FORMAT_TYPING_DATA,
  type SourceFormat,
} from "../contracts/models";
import { buildRenderedStatus } from "./shell/status/renderedStatus";
import {
  isHexColor,
  parseCategoryColorPalette,
  serializeCategoryColorPalette,
} from "./shell/palette/categoryPalette";
import {
  parseAncillaryPayload,
} from "./shell/inputs/ancillaryPayload";
import { buildVisualMappingForControls } from "./shell/controls/visualMappingControls";
import {
  buildCategorySummaries,
  formatPieFieldOption,
} from "./shell/ancillary/categorySummaries";
import {
  ANCILLARY_MODE_GLOBAL,
  ANCILLARY_MODE_CURRENT,
  ANCILLARY_MODE_SELECTED,
  type AncillaryMode,
  getAncillaryMode,
  updateNodeSelectionVisibility,
  updateNodeSelector,
} from "./shell/ancillary/nodeSelector";
import {
  DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
  DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
  DISPLAY_OPTION_NODE_LABELS,
  buildDisplayOptions,
  toggleClickedOption,
} from "./shell/controls/displayOptionsControls";
import {
  DEFAULT_INITIAL_ZOOM,
  DEFAULT_MAX_NODES,
  isLodGraph,
  parseInitialZoom,
  parseMaxNodes,
  updateLodPlaybackControls,
} from "./shell/controls/lodControls";
import { getSelectedOptions } from "./shell/controls/selectOptions";
import {
  downloadTextFile,
  readTextFile,
  resolveAncillaryFormat,
} from "./shell/inputs/fileInputs";
import {
  renderSearchResults,
  type SearchResultItem,
} from "./shell/search/searchResultsView";
import { renderRegionPanel } from "./shell/region/regionPanelView";
import type { SigmaViewportBounds } from "../render/adapters/sigma/graphViewerTypes";

export { STATUS_RENDERED_PREFIX } from "./shell/status/renderedStatus";
export { ERR_INVALID_ANCILLARY_JSON } from "./shell/inputs/ancillaryPayload";

export const DEFAULT_STATUS_READY = "Ready";
export const STATUS_RENDERING_PREFIX = "Rendering";
export const STATUS_FAILED_PREFIX = "Failed";
export const CATEGORY_COLOR_INPUT_SELECTOR = "[data-category-color]";
export const CATEGORY_COLOR_SAVE_FILENAME = "phyloviz-category-colors.txt";
export const SELECTED_NODE_WHEEL_EMPTY_MESSAGE =
  "Click a node to view its ancillary distribution.";
// PHYLOViZ charts a field only after the user selects a column: absent a
// chosen pie field there is no distribution to show, so both wheels prompt for
// a field rather than folding every metadata column (including coordinates and
// identifiers) into a single meaningless chart.
export const SELECT_PIE_FIELD_MESSAGE =
  "Select a metadata field to view its ancillary distribution.";

export {
  ANCILLARY_MODE_GLOBAL,
  ANCILLARY_MODE_CURRENT,
  ANCILLARY_MODE_SELECTED,
  DEFAULT_INITIAL_ZOOM,
  DEFAULT_MAX_NODES,
  DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
  DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
  DISPLAY_OPTION_NODE_LABELS,
};
export type { AncillaryMode };

export const ERR_STATUS_ELEMENT_REQUIRED = "Status element is required.";
export const ERR_RENDER_FORM_REQUIRED = "Render form is required.";
export const ERR_NEWICK_INPUT_REQUIRED = "Newick input is required.";
export const ERR_ANCILLARY_JOIN_COLUMN_REQUIRED =
  "Ancillary table join column is required.";

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
  initialZoomInput?: HTMLInputElement;
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

// Connect a minimal UI shell to the graph workbench orchestration layer.
export class UiShellController {
  private readonly workbench: GraphWorkbench;
  private readonly form: HTMLFormElement;
  private readonly newickInput: HTMLTextAreaElement;
  private readonly newickFileInput?: HTMLInputElement;
  private readonly sourceFormatSelect?: HTMLSelectElement;
  private readonly typingFileInput?: HTMLInputElement;
  private readonly datasetNameInput?: HTMLInputElement;
  private readonly ancillaryInput?: HTMLTextAreaElement;
  private readonly ancillaryFileInput?: HTMLInputElement;
  private readonly ancillaryJoinColumnInput?: HTMLInputElement;
  private readonly ancillaryFormatSelect?: HTMLSelectElement;
  private readonly statusElement: HTMLElement;
  private readonly ancillaryWheelContainer?: HTMLElement;
  private readonly ancillarySelectedNodeWheelContainer?: HTMLElement;
  private readonly ancillaryModeSelect?: HTMLSelectElement;
  private readonly ancillaryNodeSelect?: HTMLSelectElement;
  private readonly metadataPieFieldSelect?: HTMLSelectElement;
  private readonly metadataSizeFieldInput?: HTMLInputElement;
  private readonly metadataSizeScaleSelect?: HTMLSelectElement;
  private readonly paletteControlsContainer?: HTMLElement;
  private readonly paletteLoadButton?: HTMLButtonElement;
  private readonly paletteLoadInput?: HTMLInputElement;
  private readonly paletteSaveButton?: HTMLButtonElement;
  private readonly displayOptionsSelect?: HTMLSelectElement;
  private readonly lodPlayButton?: HTMLButtonElement;
  private readonly lodPauseButton?: HTMLButtonElement;
  private readonly maxNodesInput?: HTMLInputElement;
  private readonly initialZoomInput?: HTMLInputElement;
  private readonly searchInput?: HTMLInputElement;
  private readonly searchButton?: HTMLButtonElement;
  private readonly searchResults?: HTMLElement;
  private readonly regionSelectToggle?: HTMLButtonElement;
  private readonly regionSelectionPanel?: HTMLElement;

  private regionSelectModeEnabled = false;
  private lastRenderedGraph: PositionedGraph | null = null;
  private baseVisualMapping: VisualMappingOptions = {};
  private currentVisualMapping: VisualMappingOptions = {};
  private categoryColorOverrides: Record<string, string> = {};

  private boundSubmit: ((event: SubmitEvent) => void) | null = null;
  private boundAncillaryModeChange: (() => void) | null = null;
  private boundAncillaryNodeChange: (() => void) | null = null;
  private boundGraphNodeClick: ((state: { nodeId: string }) => void) | null =
    null;
  private boundMetadataPieFieldChange: (() => void) | null = null;
  private boundMetadataPieFieldPointerDown: ((event: MouseEvent) => void) | null =
    null;
  private boundSizeMappingChange: (() => void) | null = null;
  private boundCategoryColorChange: (() => void) | null = null;
  private boundPaletteLoadClick: (() => void) | null = null;
  private boundPaletteLoadChange: (() => void) | null = null;
  private boundPaletteSaveClick: (() => void) | null = null;
  private boundDisplayOptionsPointerDown: ((event: MouseEvent) => void) | null =
    null;
  private boundDisplayOptionsChange: (() => void) | null = null;
  private boundLodPlayClick: (() => void) | null = null;
  private boundLodPauseClick: (() => void) | null = null;
  private boundSearchClick: (() => void) | null = null;
  private boundRegionToggleClick: (() => void) | null = null;
  private boundRegionSelected: ((bounds: SigmaViewportBounds) => void) | null =
    null;

  constructor(options: UiShellOptions) {
    this.workbench = options.workbench;
    this.form = options.elements.form;
    this.newickInput = options.elements.newickInput;
    this.newickFileInput = options.elements.newickFileInput;
    this.sourceFormatSelect = options.elements.sourceFormatSelect;
    this.typingFileInput = options.elements.typingFileInput;
    this.datasetNameInput = options.elements.datasetNameInput;
    this.ancillaryInput = options.elements.ancillaryInput;
    this.ancillaryFileInput = options.elements.ancillaryFileInput;
    this.ancillaryJoinColumnInput = options.elements.ancillaryJoinColumnInput;
    this.ancillaryFormatSelect = options.elements.ancillaryFormatSelect;
    this.statusElement = options.elements.status;
    this.ancillaryWheelContainer = options.elements.ancillaryWheelContainer;
    this.ancillarySelectedNodeWheelContainer =
      options.elements.ancillarySelectedNodeWheelContainer;
    this.ancillaryModeSelect = options.elements.ancillaryModeSelect;
    this.ancillaryNodeSelect = options.elements.ancillaryNodeSelect;
    this.metadataPieFieldSelect = options.elements.metadataPieFieldSelect;
    this.metadataSizeFieldInput = options.elements.metadataSizeFieldInput;
    this.metadataSizeScaleSelect = options.elements.metadataSizeScaleSelect;
    this.paletteControlsContainer = options.elements.paletteControlsContainer;
    this.paletteLoadButton = options.elements.paletteLoadButton;
    this.paletteLoadInput = options.elements.paletteLoadInput;
    this.paletteSaveButton = options.elements.paletteSaveButton;
    this.displayOptionsSelect = options.elements.displayOptionsSelect;
    this.lodPlayButton = options.elements.lodPlayButton;
    this.lodPauseButton = options.elements.lodPauseButton;
    this.maxNodesInput = options.elements.maxNodesInput;
    this.initialZoomInput = options.elements.initialZoomInput;
    this.searchInput = options.elements.searchInput;
    this.searchButton = options.elements.searchButton;
    this.searchResults = options.elements.searchResults;
    this.regionSelectToggle = options.elements.regionSelectToggle;
    this.regionSelectionPanel = options.elements.regionSelectionPanel;

    if (!this.form) {
      throw new Error(ERR_RENDER_FORM_REQUIRED);
    }

    if (!this.newickInput) {
      throw new Error(ERR_NEWICK_INPUT_REQUIRED);
    }

    if (!this.statusElement) {
      throw new Error(ERR_STATUS_ELEMENT_REQUIRED);
    }
  }

  // Attach submit handlers and set initial shell status.
  mount(): void {
    this.setStatus(DEFAULT_STATUS_READY);
    this.workbench.setGraphRenderedHandler((graph) => {
      this.handleGraphRendered(graph);
    });
    this.boundGraphNodeClick = ({ nodeId }) => {
      this.handleGraphNodeClick(nodeId);
    };
    this.workbench.setNodeClickedHandler(this.boundGraphNodeClick);
    if (this.ancillaryWheelContainer) {
      renderAncillaryWheel(this.ancillaryWheelContainer, null);
    }
    if (this.ancillarySelectedNodeWheelContainer) {
      renderAncillaryWheel(
        this.ancillarySelectedNodeWheelContainer,
        null,
        SELECTED_NODE_WHEEL_EMPTY_MESSAGE,
      );
    }
    this.renderCategoryColorControls();

    this.boundAncillaryModeChange = () => {
      updateNodeSelector(
        this.ancillaryNodeSelect,
        getAncillaryMode(this.ancillaryModeSelect) === ANCILLARY_MODE_SELECTED
          ? this.lastRenderedGraph
          : null,
      );
      this.updateNodeSelectionVisibility();
      this.renderAncillaryStats();
    };
    this.boundAncillaryNodeChange = () => {
      this.renderAncillaryStats();
    };
    this.boundMetadataPieFieldChange = () => {
      this.renderCategoryColorControls();
      this.handleVisualMappingChange();
    };
    this.boundMetadataPieFieldPointerDown = (event: MouseEvent) => {
      this.handleMetadataPieFieldPointerDown(event);
    };
    this.boundSizeMappingChange = () => {
      this.handleVisualMappingChange();
    };
    this.boundCategoryColorChange = () => {
      this.categoryColorOverrides = this.getSelectedCategoryColors() ?? {};
      this.handleVisualMappingChange();
    };
    this.boundPaletteLoadClick = () => {
      this.paletteLoadInput?.click();
    };
    this.boundPaletteLoadChange = () => {
      void this.handlePaletteLoad();
    };
    this.boundPaletteSaveClick = () => {
      this.handlePaletteSave();
    };
    this.boundDisplayOptionsChange = () => {
      this.handleDisplayOptionsChange();
    };
    this.boundDisplayOptionsPointerDown = (event: MouseEvent) => {
      this.handleDisplayOptionPointerDown(event);
    };
    this.boundLodPlayClick = () => {
      void this.handleLodPlaybackChange(false);
    };
    this.boundLodPauseClick = () => {
      void this.handleLodPlaybackChange(true);
    };

    this.ancillaryModeSelect?.addEventListener(
      "change",
      this.boundAncillaryModeChange,
    );
    this.ancillaryNodeSelect?.addEventListener(
      "change",
      this.boundAncillaryNodeChange,
    );
    this.metadataPieFieldSelect?.addEventListener(
      "change",
      this.boundMetadataPieFieldChange,
    );
    this.metadataPieFieldSelect?.addEventListener(
      "mousedown",
      this.boundMetadataPieFieldPointerDown,
    );
    this.metadataSizeFieldInput?.addEventListener(
      "input",
      this.boundSizeMappingChange,
    );
    this.metadataSizeScaleSelect?.addEventListener(
      "change",
      this.boundSizeMappingChange,
    );
    this.paletteControlsContainer?.addEventListener(
      "input",
      this.boundCategoryColorChange,
    );
    this.paletteLoadButton?.addEventListener(
      "click",
      this.boundPaletteLoadClick,
    );
    this.paletteLoadInput?.addEventListener(
      "change",
      this.boundPaletteLoadChange,
    );
    this.paletteSaveButton?.addEventListener(
      "click",
      this.boundPaletteSaveClick,
    );
    this.displayOptionsSelect?.addEventListener(
      "change",
      this.boundDisplayOptionsChange,
    );
    this.displayOptionsSelect?.addEventListener(
      "mousedown",
      this.boundDisplayOptionsPointerDown,
    );
    this.lodPlayButton?.addEventListener("click", this.boundLodPlayClick);
    this.lodPauseButton?.addEventListener("click", this.boundLodPauseClick);
    this.boundSearchClick = () => {
      void this.searchCurrentDataset();
    };
    this.searchButton?.addEventListener("click", this.boundSearchClick);

    this.boundRegionToggleClick = () => {
      this.toggleRegionSelectMode();
    };
    this.regionSelectToggle?.addEventListener(
      "click",
      this.boundRegionToggleClick,
    );
    this.boundRegionSelected = (bounds) => {
      void this.handleRegionSelected(bounds);
    };
    this.workbench.setRegionSelectedHandler(this.boundRegionSelected);
    if (this.regionSelectionPanel) {
      renderRegionPanel(this.regionSelectionPanel, null);
    }
    this.updateRegionToggleLabel();

    this.updateNodeSelectionVisibility();
    this.updateMetadataPieFieldOptions(null);
    this.updateLodPlaybackControls(false);
    this.handleDisplayOptionsChange();

    this.boundSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      void this.renderCurrentInput();
    };

    this.form.addEventListener("submit", this.boundSubmit as EventListener);
  }

  // Normalize and render using current user input values.
  async renderCurrentInput(): Promise<void> {
    const sourceFormat = this.getSourceFormat();
    const content = (await this.getSourceContent(sourceFormat)).trim();
    const datasetName = this.datasetNameInput?.value.trim();
    const ancillaryRaw = this.ancillaryInput?.value.trim() ?? "";

    if (!content) {
      const label =
        sourceFormat === SOURCE_FORMAT_TYPING_DATA
          ? "empty typing data input"
          : "empty Newick input";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${label}`);
      return;
    }

    this.setStatus(`${STATUS_RENDERING_PREFIX}...`);

    try {
      const ancillaryPayload = parseAncillaryPayload(ancillaryRaw);
      const ancillaryData = await this.getAncillaryDataInput();
      this.baseVisualMapping = ancillaryPayload.visual_mapping ?? {};
      this.currentVisualMapping = this.buildCurrentVisualMapping();
      await this.workbench.renderNewick(content, datasetName || undefined, {
        sourceFormat,
        metadataSchema: ancillaryPayload.metadata_schema,
        metadataByNodeId: ancillaryPayload.metadata_by_node_id,
        ancillaryData,
        visualMapping: this.currentVisualMapping,
        lod: {
          maxNodes: this.getSelectedMaxNodes(),
          zoom: this.getSelectedInitialZoom(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
      this.lastRenderedGraph = null;
      this.baseVisualMapping = {};
      this.currentVisualMapping = {};
      this.categoryColorOverrides = {};
      updateNodeSelector(this.ancillaryNodeSelect, null);
      this.updateMetadataPieFieldOptions(null);
      this.renderCategoryColorControls();
      this.renderAncillaryStats();
    }
  }

  // Remove shell event listeners and dispose rendering resources.
  unmount(): void {
    if (this.boundSubmit) {
      this.form.removeEventListener(
        "submit",
        this.boundSubmit as EventListener,
      );
      this.boundSubmit = null;
    }

    if (this.boundAncillaryModeChange) {
      this.ancillaryModeSelect?.removeEventListener(
        "change",
        this.boundAncillaryModeChange,
      );
      this.boundAncillaryModeChange = null;
    }

    if (this.boundAncillaryNodeChange) {
      this.ancillaryNodeSelect?.removeEventListener(
        "change",
        this.boundAncillaryNodeChange,
      );
      this.boundAncillaryNodeChange = null;
    }

    if (this.boundMetadataPieFieldChange) {
      this.metadataPieFieldSelect?.removeEventListener(
        "change",
        this.boundMetadataPieFieldChange,
      );
      this.boundMetadataPieFieldChange = null;
    }

    if (this.boundMetadataPieFieldPointerDown) {
      this.metadataPieFieldSelect?.removeEventListener(
        "mousedown",
        this.boundMetadataPieFieldPointerDown,
      );
      this.boundMetadataPieFieldPointerDown = null;
    }

    if (this.boundSizeMappingChange) {
      this.metadataSizeFieldInput?.removeEventListener(
        "input",
        this.boundSizeMappingChange,
      );
      this.metadataSizeScaleSelect?.removeEventListener(
        "change",
        this.boundSizeMappingChange,
      );
      this.boundSizeMappingChange = null;
    }

    if (this.boundCategoryColorChange) {
      this.paletteControlsContainer?.removeEventListener(
        "input",
        this.boundCategoryColorChange,
      );
      this.boundCategoryColorChange = null;
    }

    if (this.boundPaletteLoadChange) {
      this.paletteLoadInput?.removeEventListener(
        "change",
        this.boundPaletteLoadChange,
      );
      this.boundPaletteLoadChange = null;
    }

    if (this.boundPaletteLoadClick) {
      this.paletteLoadButton?.removeEventListener(
        "click",
        this.boundPaletteLoadClick,
      );
      this.boundPaletteLoadClick = null;
    }

    if (this.boundPaletteSaveClick) {
      this.paletteSaveButton?.removeEventListener(
        "click",
        this.boundPaletteSaveClick,
      );
      this.boundPaletteSaveClick = null;
    }

    if (this.boundDisplayOptionsChange) {
      this.displayOptionsSelect?.removeEventListener(
        "change",
        this.boundDisplayOptionsChange,
      );
      this.boundDisplayOptionsChange = null;
    }

    if (this.boundDisplayOptionsPointerDown) {
      this.displayOptionsSelect?.removeEventListener(
        "mousedown",
        this.boundDisplayOptionsPointerDown,
      );
      this.boundDisplayOptionsPointerDown = null;
    }

    if (this.boundLodPlayClick) {
      this.lodPlayButton?.removeEventListener("click", this.boundLodPlayClick);
      this.boundLodPlayClick = null;
    }

    if (this.boundLodPauseClick) {
      this.lodPauseButton?.removeEventListener(
        "click",
        this.boundLodPauseClick,
      );
      this.boundLodPauseClick = null;
    }

    if (this.boundSearchClick) {
      this.searchButton?.removeEventListener("click", this.boundSearchClick);
      this.boundSearchClick = null;
    }

    if (this.boundRegionToggleClick) {
      this.regionSelectToggle?.removeEventListener(
        "click",
        this.boundRegionToggleClick,
      );
      this.boundRegionToggleClick = null;
    }

    this.workbench.setGraphRenderedHandler(null);
    this.workbench.setNodeClickedHandler(null);
    this.workbench.setRegionSelectedHandler(null);
    this.boundGraphNodeClick = null;
    this.boundRegionSelected = null;
    this.workbench.dispose();
  }

  // Update the shell status text for user feedback.
  private setStatus(status: string): void {
    this.statusElement.textContent = status;
  }

  private renderAncillaryStats(): void {
    if (!this.ancillaryWheelContainer) {
      return;
    }

    if (!this.lastRenderedGraph) {
      renderAncillaryWheel(this.ancillaryWheelContainer, null);
      return;
    }

    const mode = getAncillaryMode(this.ancillaryModeSelect);
    if (mode === ANCILLARY_MODE_SELECTED) {
      const selectedId = this.ancillaryNodeSelect?.value;
      if (!selectedId) {
        renderAncillaryWheel(
          this.ancillaryWheelContainer,
          null,
          "Choose a node to view its ancillary distribution.",
        );
        return;
      }

      renderAncillaryWheel(
        this.ancillaryWheelContainer,
        this.buildSelectedWheelStats(new Set([selectedId])),
        this.ancillaryWheelEmptyMessage(`Node '${selectedId}'`),
      );
      return;
    }

    // Current mode uses the currently rendered graph snapshot.
    renderAncillaryWheel(
      this.ancillaryWheelContainer,
      this.buildSelectedWheelStats(),
      this.ancillaryWheelEmptyMessage(),
    );
  }

  // Render a clicked node's ancillary distribution into the dedicated
  // selected-node panel, leaving the primary overview wheel untouched.
  private handleGraphNodeClick(nodeId: string): void {
    if (!this.lastRenderedGraph || !this.ancillarySelectedNodeWheelContainer) {
      return;
    }

    const nodeExists = this.lastRenderedGraph.nodes.some(
      (node) => node.id === nodeId,
    );
    if (!nodeExists) {
      return;
    }

    renderAncillaryWheel(
      this.ancillarySelectedNodeWheelContainer,
      this.buildSelectedWheelStats(new Set([nodeId])),
      this.ancillaryWheelEmptyMessage(`Node '${nodeId}'`),
    );
  }

  // Empty-state message for a wheel: prompt for a field when none is selected
  // (PHYLOViZ is field-selection driven), otherwise report that the target
  // carries no data for the chosen field(s).
  private ancillaryWheelEmptyMessage(subject?: string): string {
    if (getSelectedOptions(this.metadataPieFieldSelect).length === 0) {
      return SELECT_PIE_FIELD_MESSAGE;
    }
    return subject
      ? `${subject} has no ancillary pie data.`
      : "No ancillary pie data detected.";
  }

  private handleGraphRendered(graph: PositionedGraph): void {
    this.setStatus(buildRenderedStatus(graph));
    this.lastRenderedGraph = graph;
    updateNodeSelector(
      this.ancillaryNodeSelect,
      getAncillaryMode(this.ancillaryModeSelect) === ANCILLARY_MODE_SELECTED
        ? graph
        : null,
    );
    this.updateMetadataPieFieldOptions(graph);
    this.renderCategoryColorControls();
    this.updateNodeSelectionVisibility();
    this.updateLodPlaybackControls(isLodGraph(graph));
    this.renderAncillaryStats();
    this.resetSelectedNodeWheel();
    this.resetRegionSelection();
  }

  // Clear any active region highlight/panel on re-render (a new dataset or slice
  // invalidates the previously selected node ids).
  private resetRegionSelection(): void {
    this.workbench.clearRegionSelection();
    if (this.regionSelectionPanel) {
      renderRegionPanel(this.regionSelectionPanel, null);
    }
  }

  // Return the selected-node panel to its empty prompt (e.g. on re-render).
  private resetSelectedNodeWheel(): void {
    if (!this.ancillarySelectedNodeWheelContainer) {
      return;
    }
    renderAncillaryWheel(
      this.ancillarySelectedNodeWheelContainer,
      null,
      SELECTED_NODE_WHEEL_EMPTY_MESSAGE,
    );
  }

  private handleVisualMappingChange(): void {
    this.currentVisualMapping = this.buildCurrentVisualMapping();

    if (!this.lastRenderedGraph) {
      this.renderAncillaryStats();
      return;
    }

    try {
      this.workbench.updateVisualMapping(this.currentVisualMapping);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }

    // Repaint the wheel with the same palette/category edits just applied to the
    // tree, so a colour change is reflected in both places at once.
    this.renderAncillaryStats();
  }

  private handleDisplayOptionsChange(): void {
    this.workbench.updateDisplayOptions(this.buildCurrentDisplayOptions());
  }

  private handleMetadataPieFieldPointerDown(event: MouseEvent): void {
    if (
      !this.metadataPieFieldSelect ||
      !(event.target instanceof HTMLOptionElement)
    ) {
      return;
    }

    event.preventDefault();
    const clickedOption = event.target;
    const selectedValue = clickedOption.value;

    if (selectedValue === "") {
      [...this.metadataPieFieldSelect.options].forEach((option) => {
        option.selected = option === clickedOption;
      });
    } else {
      clickedOption.selected = !clickedOption.selected;
      const automaticOption = [...this.metadataPieFieldSelect.options].find(
        (option) => option.value === "",
      );
      if (automaticOption) {
        automaticOption.selected = false;
      }
    }

    this.boundMetadataPieFieldChange?.();
  }

  private handleDisplayOptionPointerDown(event: MouseEvent): void {
    if (toggleClickedOption(this.displayOptionsSelect, event)) {
      this.handleDisplayOptionsChange();
    }
  }

  private async handleLodPlaybackChange(paused: boolean): Promise<void> {
    try {
      await this.workbench.setLodRefreshPaused(paused);
      this.updateLodPlaybackControls(isLodGraph(this.lastRenderedGraph));
      if (paused) {
        this.setStatus("LoD paused: navigate freely without slice refreshes");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }
  }

  private async handlePaletteLoad(): Promise<void> {
    const file = this.paletteLoadInput?.files?.[0];
    if (!file) {
      return;
    }

    try {
      const categories = this.getEditableCategoryOrder();
      const loadedColors = parseCategoryColorPalette(
        await readTextFile(file),
        categories,
      );
      this.categoryColorOverrides = {
        ...this.categoryColorOverrides,
        ...loadedColors,
      };
      this.renderCategoryColorControls();
      this.handleVisualMappingChange();
      this.setStatus(`Loaded ${Object.keys(loadedColors).length} category colors`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    } finally {
      if (this.paletteLoadInput) {
        this.paletteLoadInput.value = "";
      }
    }
  }

  private handlePaletteSave(): void {
    const colors = this.getSelectedCategoryColors();
    const categories = this.getEditableCategoryOrder();
    if (!colors || categories.length === 0) {
      this.setStatus(`${STATUS_FAILED_PREFIX}: no category colors to save`);
      return;
    }

    downloadTextFile(
      CATEGORY_COLOR_SAVE_FILENAME,
      serializeCategoryColorPalette(colors, categories),
    );
    this.setStatus(`Saved ${categories.length} category colors`);
  }

  private async searchCurrentDataset(): Promise<void> {
    const query = this.searchInput?.value.trim() ?? "";

    if (!query) {
      this.renderSearchResults([]);
      return;
    }

    try {
      const response = await this.workbench.searchNodes({
        query,
        limit: 25,
      });
      this.renderSearchResults(response.matches);
      this.setStatus(`Search found ${response.total_count} matches`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }
  }

  private renderSearchResults(
    matches: SearchResultItem[],
  ): void {
    renderSearchResults(this.searchResults, matches, (nodeId) => {
      void this.focusSearchResult(nodeId);
    });
  }

  private async focusSearchResult(nodeId: string): Promise<void> {
    try {
      await this.workbench.focusNode(nodeId);
      this.handleGraphNodeClick(nodeId);
      this.setStatus(`Focused ${nodeId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }
  }

  private toggleRegionSelectMode(): void {
    this.regionSelectModeEnabled = !this.regionSelectModeEnabled;
    this.workbench.setRegionSelectModeEnabled(this.regionSelectModeEnabled);
    this.updateRegionToggleLabel();
    if (!this.regionSelectModeEnabled) {
      this.workbench.clearRegionSelection();
      if (this.regionSelectionPanel) {
        renderRegionPanel(this.regionSelectionPanel, null);
      }
    }
    this.setStatus(
      this.regionSelectModeEnabled
        ? "Select region: drag a box on the canvas to isolate an area"
        : DEFAULT_STATUS_READY,
    );
  }

  private updateRegionToggleLabel(): void {
    if (!this.regionSelectToggle) {
      return;
    }
    this.regionSelectToggle.textContent = this.regionSelectModeEnabled
      ? "Selecting…"
      : "Select region";
    this.regionSelectToggle.setAttribute(
      "aria-pressed",
      this.regionSelectModeEnabled ? "true" : "false",
    );
  }

  private async handleRegionSelected(
    bounds: SigmaViewportBounds,
  ): Promise<void> {
    if (!this.regionSelectionPanel) {
      return;
    }

    try {
      const result = await this.workbench.selectRegion(bounds);
      const wheelStats = this.buildSelectedWheelStats(
        new Set(result.nodeIds),
      );
      renderRegionPanel(this.regionSelectionPanel, {
        nodeCount: result.nodeCount,
        truncated: result.truncated,
        aggregatedMetadata: result.aggregatedMetadata,
        wheelStats,
      });
      this.setStatus(
        `Region selected: ${result.nodeCount} ${
          result.nodeCount === 1 ? "node" : "nodes"
        }`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }
  }

  private buildSelectedWheelStats(includeNodeIds?: Set<string>) {
    if (!this.lastRenderedGraph) {
      return null;
    }

    // Forward the live palette + per-category colour edits so the wheel resolves
    // colours identically to the tree, which the shell repaints through the same
    // overrides. Without this the wheel snapshot's nodes carry no palette edits.
    const palette = this.currentVisualMapping.palette;
    const categoryColors = this.categoryColorOverrides;
    const selectedFields = getSelectedOptions(this.metadataPieFieldSelect);
    if (selectedFields.length > 1) {
      return buildAncillaryWheelStats(this.lastRenderedGraph, {
        includeNodeIds,
        palette,
        categoryColors,
      });
    }

    if (selectedFields.length > 0) {
      return buildMetadataFieldWheelStats(
        this.lastRenderedGraph,
        selectedFields[0] ?? "",
        {
          includeNodeIds,
          palette,
          categoryColors,
        },
      );
    }

    // No field selected: match PHYLOViZ and chart nothing until the user picks
    // a column. Auto-aggregating every pie__ attribute would fold coordinates
    // and identifiers into a meaningless distribution, so defer to the
    // field-selection prompt instead.
    return null;
  }

  private updateNodeSelectionVisibility(): void {
    updateNodeSelectionVisibility(
      this.ancillaryNodeSelect,
      this.ancillaryModeSelect,
    );
  }

  private updateMetadataPieFieldOptions(graph: PositionedGraph | null): void {
    if (!this.metadataPieFieldSelect) {
      return;
    }

    const previousValues = new Set(getSelectedOptions(this.metadataPieFieldSelect));
    this.metadataPieFieldSelect.innerHTML = "";

    const automaticOption = document.createElement("option");
    automaticOption.value = "";
    automaticOption.textContent = "Auto pie fields";
    this.metadataPieFieldSelect.appendChild(automaticOption);

    if (!graph) {
      this.metadataPieFieldSelect.disabled = true;
      return;
    }

    const summaries = collectMetadataFieldSummaries(graph);
    const keys = summaries.map((summary) => summary.key);
    summaries.forEach((summary) => {
      const option = document.createElement("option");
      option.value = summary.key;
      option.textContent = formatPieFieldOption(summary);
      option.title = `${summary.key}: ${summary.uniqueValueCount} unique values in the current graph`;
      this.metadataPieFieldSelect?.appendChild(option);
    });

    this.metadataPieFieldSelect.disabled = keys.length === 0;
    [...this.metadataPieFieldSelect.options].forEach((option) => {
      option.selected = previousValues.has(option.value);
    });
  }

  private renderCategoryColorControls(): void {
    if (!this.paletteControlsContainer) {
      return;
    }

    this.paletteControlsContainer.innerHTML = "";
    const selectedFields = getSelectedOptions(this.metadataPieFieldSelect);
    const selectedField = selectedFields[0];
    if (!this.lastRenderedGraph || !selectedField) {
      const empty = document.createElement("span");
      empty.className = "category-color-empty";
      empty.textContent = "Choose a pie field";
      this.paletteControlsContainer.appendChild(empty);
      return;
    }
    if (selectedFields.length > 1) {
      const empty = document.createElement("span");
      empty.className = "category-color-empty";
      empty.textContent = "Combination colors use the generated palette";
      this.paletteControlsContainer.appendChild(empty);
      return;
    }

    const categories = buildCategorySummaries(
      this.lastRenderedGraph,
      selectedField,
    );
    if (categories.length === 0) {
      const empty = document.createElement("span");
      empty.className = "category-color-empty";
      empty.textContent = "No categories";
      this.paletteControlsContainer.appendChild(empty);
      return;
    }

    categories.forEach((category, index) => {
      const color =
        category.label === PIE_OTHER_SLICE_LABEL
          ? PIE_OTHER_SLICE_COLOR
          : this.categoryColorOverrides[category.label] ??
            category.color ??
            DEFAULT_COLOR_PALETTE[index % DEFAULT_COLOR_PALETTE.length] ??
            "#0f766e";
      const label = document.createElement("label");
      label.className = "category-color-row";
      label.title = category.label;

      const input = document.createElement("input");
      input.type = "color";
      input.value = color;
      input.dataset.categoryColor = category.label;
      input.disabled = category.label === PIE_OTHER_SLICE_LABEL;
      input.setAttribute("aria-label", `${category.label} color`);

      const name = document.createElement("span");
      name.className = "category-color-name";
      name.textContent = category.label;

      const count = document.createElement("span");
      count.className = "category-color-count";
      count.textContent = `n = ${category.count}, ${category.percentage.toFixed(1)}%`;

      label.appendChild(input);
      label.appendChild(name);
      label.appendChild(count);
      this.paletteControlsContainer?.appendChild(label);
    });
  }

  private updateLodPlaybackControls(lodAvailable: boolean): void {
    updateLodPlaybackControls({
      playButton: this.lodPlayButton,
      pauseButton: this.lodPauseButton,
      lodAvailable,
      paused: this.workbench.isLodRefreshPaused(),
    });
  }

  private getSelectedMaxNodes(): number {
    return parseMaxNodes(this.maxNodesInput?.value);
  }

  private getSelectedInitialZoom(): number {
    return parseInitialZoom(this.initialZoomInput?.value);
  }

  private buildCurrentVisualMapping(): VisualMappingOptions {
    return buildVisualMappingForControls(
      this.baseVisualMapping,
      getSelectedOptions(this.metadataPieFieldSelect),
      this.metadataSizeFieldInput?.value,
      this.metadataSizeScaleSelect?.value,
      this.getSelectedCategoryColors(),
    );
  }

  private getSelectedCategoryColors(): Record<string, string> | undefined {
    if (!this.paletteControlsContainer) {
      return undefined;
    }

    const colorsByCategory: Record<string, string> = {};
    [
      ...this.paletteControlsContainer.querySelectorAll<HTMLInputElement>(
        CATEGORY_COLOR_INPUT_SELECTOR,
      ),
    ].forEach((input) => {
      const category = input.dataset.categoryColor;
      const color = input.value.trim();
      if (category && !input.disabled && isHexColor(color)) {
        colorsByCategory[category] = color;
      }
    });

    return Object.keys(colorsByCategory).length > 0
      ? colorsByCategory
      : undefined;
  }

  private getEditableCategoryOrder(): string[] {
    if (!this.paletteControlsContainer) {
      return [];
    }

    return [
      ...this.paletteControlsContainer.querySelectorAll<HTMLInputElement>(
        CATEGORY_COLOR_INPUT_SELECTOR,
      ),
    ]
      .filter((input) => !input.disabled && input.dataset.categoryColor)
      .map((input) => input.dataset.categoryColor as string);
  }

  private buildCurrentDisplayOptions() {
    return buildDisplayOptions(getSelectedOptions(this.displayOptionsSelect));
  }

  private getSourceFormat(): SourceFormat {
    return this.sourceFormatSelect?.value === SOURCE_FORMAT_TYPING_DATA
      ? SOURCE_FORMAT_TYPING_DATA
      : SOURCE_FORMAT_NEWICK;
  }

  // Read the raw dataset content for the active source format: a typing-data
  // allelic-profile file when in typing mode, otherwise the Newick file (with
  // the hidden textarea as a fallback so a no-file demo still works).
  private async getSourceContent(sourceFormat: SourceFormat): Promise<string> {
    if (sourceFormat === SOURCE_FORMAT_TYPING_DATA) {
      const typingFile = this.typingFileInput?.files?.[0];
      return typingFile ? readTextFile(typingFile) : "";
    }

    const file = this.newickFileInput?.files?.[0];
    if (file) {
      return readTextFile(file);
    }

    return this.newickInput.value;
  }

  private async getAncillaryDataInput(): Promise<
    RenderNewickOptions["ancillaryData"] | undefined
  > {
    const file = this.ancillaryFileInput?.files?.[0];
    if (!file) {
      return undefined;
    }

    const joinColumn = this.ancillaryJoinColumnInput?.value.trim();
    if (!joinColumn) {
      throw new Error(ERR_ANCILLARY_JOIN_COLUMN_REQUIRED);
    }

    return {
      content: await readTextFile(file),
      join_column: joinColumn,
      format: resolveAncillaryFormat(
        this.ancillaryFormatSelect?.value,
        file.name,
      ),
    };
  }
}
