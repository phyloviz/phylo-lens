import type {
  GraphWorkbench,
  RenderNewickOptions,
} from "./workbench/graphWorkbench";
import {
  DEFAULT_PROFILE_COUNT_FIELD,
  SIZE_SCALE_LINEAR,
  SIZE_SCALE_LOG,
} from "../render/visualMappings";
import type {
  SizeScale,
  VisualMappingOptions,
} from "../render/visualMappings";
import {
  buildAncillaryWheelStats,
  buildMetadataFieldWheelStats,
  collectMetadataFieldSummaries,
  renderAncillaryWheel,
} from "../components/ancillaryWheel";
import type { PositionedGraph } from "../contracts/positioned";
import type { MetadataField } from "../contracts/models";

export const DEFAULT_STATUS_READY = "Ready";
export const STATUS_RENDERING_PREFIX = "Rendering";
export const STATUS_RENDERED_PREFIX = "Rendered";
export const STATUS_FAILED_PREFIX = "Failed";
export const DEFAULT_MAX_NODES = 4000;
export const DEFAULT_INITIAL_ZOOM = 4;

export const ANCILLARY_MODE_GLOBAL = "global";
export const ANCILLARY_MODE_CURRENT = "current";
export const ANCILLARY_MODE_SELECTED = "selected";

export type AncillaryMode =
  | typeof ANCILLARY_MODE_GLOBAL
  | typeof ANCILLARY_MODE_CURRENT
  | typeof ANCILLARY_MODE_SELECTED;

export const ERR_STATUS_ELEMENT_REQUIRED = "Status element is required.";
export const ERR_RENDER_FORM_REQUIRED = "Render form is required.";
export const ERR_NEWICK_INPUT_REQUIRED = "Newick input is required.";
export const ERR_INVALID_ANCILLARY_JSON =
  "Ancillary JSON must be a valid object with metadata_schema and/or metadata_by_node_id.";
export const ERR_ANCILLARY_JOIN_COLUMN_REQUIRED =
  "Ancillary table join column is required.";

const KEY_METADATA_SCHEMA = "metadata_schema";
const KEY_METADATA_BY_NODE_ID = "metadata_by_node_id";
const KEY_VISUAL_MAPPING = "visual_mapping";
const HIGH_CARDINALITY_PIE_FIELD_THRESHOLD = 24;

interface AncillaryPayload {
  metadata_schema?: MetadataField[];
  metadata_by_node_id?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  visual_mapping?: VisualMappingOptions;
}

export interface UiShellElements {
  form: HTMLFormElement;
  newickInput: HTMLTextAreaElement;
  newickFileInput?: HTMLInputElement;
  datasetNameInput?: HTMLInputElement;
  ancillaryInput?: HTMLTextAreaElement;
  ancillaryFileInput?: HTMLInputElement;
  ancillaryJoinColumnInput?: HTMLInputElement;
  ancillaryFormatSelect?: HTMLSelectElement;
  status: HTMLElement;
  ancillaryWheelContainer?: HTMLElement;
  ancillaryModeSelect?: HTMLSelectElement;
  ancillaryNodeSelect?: HTMLSelectElement;
  metadataPieFieldSelect?: HTMLSelectElement;
  metadataSizeFieldInput?: HTMLInputElement;
  metadataSizeScaleSelect?: HTMLSelectElement;
  maxNodesInput?: HTMLInputElement;
  initialZoomInput?: HTMLInputElement;
  searchInput?: HTMLInputElement;
  searchButton?: HTMLButtonElement;
  searchResults?: HTMLElement;
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
  private readonly datasetNameInput?: HTMLInputElement;
  private readonly ancillaryInput?: HTMLTextAreaElement;
  private readonly ancillaryFileInput?: HTMLInputElement;
  private readonly ancillaryJoinColumnInput?: HTMLInputElement;
  private readonly ancillaryFormatSelect?: HTMLSelectElement;
  private readonly statusElement: HTMLElement;
  private readonly ancillaryWheelContainer?: HTMLElement;
  private readonly ancillaryModeSelect?: HTMLSelectElement;
  private readonly ancillaryNodeSelect?: HTMLSelectElement;
  private readonly metadataPieFieldSelect?: HTMLSelectElement;
  private readonly metadataSizeFieldInput?: HTMLInputElement;
  private readonly metadataSizeScaleSelect?: HTMLSelectElement;
  private readonly maxNodesInput?: HTMLInputElement;
  private readonly initialZoomInput?: HTMLInputElement;
  private readonly searchInput?: HTMLInputElement;
  private readonly searchButton?: HTMLButtonElement;
  private readonly searchResults?: HTMLElement;

  private lastRenderedGraph: PositionedGraph | null = null;
  private baseVisualMapping: VisualMappingOptions = {};
  private currentVisualMapping: VisualMappingOptions = {};

  private boundSubmit: ((event: SubmitEvent) => void) | null = null;
  private boundAncillaryModeChange: (() => void) | null = null;
  private boundAncillaryNodeChange: (() => void) | null = null;
  private boundMetadataPieFieldChange: (() => void) | null = null;
  private boundSizeMappingChange: (() => void) | null = null;
  private boundSearchClick: (() => void) | null = null;

  constructor(options: UiShellOptions) {
    this.workbench = options.workbench;
    this.form = options.elements.form;
    this.newickInput = options.elements.newickInput;
    this.newickFileInput = options.elements.newickFileInput;
    this.datasetNameInput = options.elements.datasetNameInput;
    this.ancillaryInput = options.elements.ancillaryInput;
    this.ancillaryFileInput = options.elements.ancillaryFileInput;
    this.ancillaryJoinColumnInput = options.elements.ancillaryJoinColumnInput;
    this.ancillaryFormatSelect = options.elements.ancillaryFormatSelect;
    this.statusElement = options.elements.status;
    this.ancillaryWheelContainer = options.elements.ancillaryWheelContainer;
    this.ancillaryModeSelect = options.elements.ancillaryModeSelect;
    this.ancillaryNodeSelect = options.elements.ancillaryNodeSelect;
    this.metadataPieFieldSelect = options.elements.metadataPieFieldSelect;
    this.metadataSizeFieldInput = options.elements.metadataSizeFieldInput;
    this.metadataSizeScaleSelect = options.elements.metadataSizeScaleSelect;
    this.maxNodesInput = options.elements.maxNodesInput;
    this.initialZoomInput = options.elements.initialZoomInput;
    this.searchInput = options.elements.searchInput;
    this.searchButton = options.elements.searchButton;
    this.searchResults = options.elements.searchResults;

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
    if (this.ancillaryWheelContainer) {
      renderAncillaryWheel(this.ancillaryWheelContainer, null);
    }

    this.boundAncillaryModeChange = () => {
      this.updateNodeSelectionVisibility();
      this.renderAncillaryStats();
    };
    this.boundAncillaryNodeChange = () => {
      this.renderAncillaryStats();
    };
    this.boundMetadataPieFieldChange = () => {
      this.handleVisualMappingChange();
    };
    this.boundSizeMappingChange = () => {
      this.handleVisualMappingChange();
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
    this.metadataSizeFieldInput?.addEventListener(
      "input",
      this.boundSizeMappingChange,
    );
    this.metadataSizeScaleSelect?.addEventListener(
      "change",
      this.boundSizeMappingChange,
    );
    this.boundSearchClick = () => {
      void this.searchCurrentDataset();
    };
    this.searchButton?.addEventListener("click", this.boundSearchClick);
    this.updateNodeSelectionVisibility();
    this.updateMetadataPieFieldOptions(null);

    this.boundSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      void this.renderCurrentInput();
    };

    this.form.addEventListener("submit", this.boundSubmit as EventListener);
  }

  // Normalize and render using current user input values.
  async renderCurrentInput(): Promise<void> {
    const newick = (await this.getNewickInput()).trim();
    const datasetName = this.datasetNameInput?.value.trim();
    const ancillaryRaw = this.ancillaryInput?.value.trim() ?? "";

    if (!newick) {
      this.setStatus(`${STATUS_FAILED_PREFIX}: empty Newick input`);
      return;
    }

    this.setStatus(`${STATUS_RENDERING_PREFIX}...`);

    try {
      const ancillaryPayload = parseAncillaryPayload(ancillaryRaw);
      const ancillaryData = await this.getAncillaryDataInput();
      this.baseVisualMapping = ancillaryPayload.visual_mapping ?? {};
      this.currentVisualMapping = this.buildCurrentVisualMapping();
      await this.workbench.renderNewick(newick, datasetName || undefined, {
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
      this.updateNodeSelector(null);
      this.updateMetadataPieFieldOptions(null);
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

    if (this.boundSearchClick) {
      this.searchButton?.removeEventListener("click", this.boundSearchClick);
      this.boundSearchClick = null;
    }

    this.workbench.setGraphRenderedHandler(null);
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

    const mode = this.getAncillaryMode();
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
        `Node '${selectedId}' has no ancillary pie data.`,
      );
      return;
    }

    // Current mode uses the currently rendered graph snapshot.
    renderAncillaryWheel(
      this.ancillaryWheelContainer,
      this.buildSelectedWheelStats(),
    );
  }

  private handleGraphRendered(graph: PositionedGraph): void {
    this.setStatus(buildRenderedStatus(graph));
    this.lastRenderedGraph = graph;
    this.updateNodeSelector(graph);
    this.updateMetadataPieFieldOptions(graph);
    this.updateNodeSelectionVisibility();
    this.renderAncillaryStats();
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
    matches: Array<{ node_id: string; matched_text: string; score: number }>,
  ): void {
    if (!this.searchResults) {
      return;
    }

    this.searchResults.innerHTML = "";

    matches.forEach((match) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-result";
      item.textContent = match.node_id;
      item.title = match.matched_text;
      item.addEventListener("click", () => {
        void this.focusSearchResult(match.node_id);
      });
      this.searchResults?.appendChild(item);
    });
  }

  private async focusSearchResult(nodeId: string): Promise<void> {
    try {
      await this.workbench.focusNode(nodeId);
      this.setStatus(`Focused ${nodeId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }
  }

  private buildSelectedWheelStats(includeNodeIds?: Set<string>) {
    if (!this.lastRenderedGraph) {
      return null;
    }

    const selectedFields = getSelectedOptions(this.metadataPieFieldSelect);
    if (selectedFields.length > 0) {
      return buildMetadataFieldWheelStats(
        this.lastRenderedGraph,
        selectedFields[0] ?? "",
        {
          includeNodeIds,
        },
      );
    }

    return buildAncillaryWheelStats(this.lastRenderedGraph, { includeNodeIds });
  }

  private getAncillaryMode(): AncillaryMode {
    const mode = this.ancillaryModeSelect?.value;
    if (
      mode === ANCILLARY_MODE_GLOBAL ||
      mode === ANCILLARY_MODE_CURRENT ||
      mode === ANCILLARY_MODE_SELECTED
    ) {
      return mode;
    }
    return ANCILLARY_MODE_GLOBAL;
  }

  private updateNodeSelector(graph: PositionedGraph | null): void {
    if (!this.ancillaryNodeSelect) {
      return;
    }

    this.ancillaryNodeSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select node";
    this.ancillaryNodeSelect.appendChild(placeholder);

    if (!graph) {
      return;
    }

    const nodeIds = [...graph.nodes.map((node) => node.id)].sort((a, b) =>
      a.localeCompare(b),
    );
    nodeIds.forEach((nodeId) => {
      const option = document.createElement("option");
      option.value = nodeId;
      option.textContent = nodeId;
      this.ancillaryNodeSelect?.appendChild(option);
    });
  }

  private updateNodeSelectionVisibility(): void {
    if (!this.ancillaryNodeSelect) {
      return;
    }
    const selectedMode = this.getAncillaryMode();
    this.ancillaryNodeSelect.disabled =
      selectedMode !== ANCILLARY_MODE_SELECTED;
  }

  private updateMetadataPieFieldOptions(graph: PositionedGraph | null): void {
    if (!this.metadataPieFieldSelect) {
      return;
    }

    const previousValue = this.metadataPieFieldSelect.value;
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
    if (keys.includes(previousValue)) {
      this.metadataPieFieldSelect.value = previousValue;
    }
  }

  private getSelectedMaxNodes(): number {
    const rawValue = this.maxNodesInput?.value;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 10) {
      return DEFAULT_MAX_NODES;
    }
    return Math.round(parsed);
  }

  private getSelectedInitialZoom(): number {
    const rawValue = this.initialZoomInput?.value;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_INITIAL_ZOOM;
    }
    return parsed;
  }

  private buildCurrentVisualMapping(): VisualMappingOptions {
    return buildVisualMappingForControls(
      this.baseVisualMapping,
      getSelectedOptions(this.metadataPieFieldSelect),
      this.metadataSizeFieldInput?.value,
      this.metadataSizeScaleSelect?.value,
    );
  }

  private async getNewickInput(): Promise<string> {
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
      format: this.getAncillaryFormat(file),
    };
  }

  private getAncillaryFormat(file: File): "auto" | "csv" | "tsv" {
    const selectedFormat = this.ancillaryFormatSelect?.value;
    if (
      selectedFormat === "auto" ||
      selectedFormat === "csv" ||
      selectedFormat === "tsv"
    ) {
      return selectedFormat;
    }

    const filename = file.name.toLowerCase();
    if (filename.endsWith(".tsv") || filename.endsWith(".txt")) {
      return "tsv";
    }
    if (filename.endsWith(".csv")) {
      return "csv";
    }
    return "auto";
  }
}

function buildRenderedStatus(graph: PositionedGraph): string {
  const parts = [
    `${graph.nodes.length} nodes`,
    `${graph.edges.length} edges`,
    `rendered depth ${graph.viewMeta.lodLevel}`,
  ];

  if (typeof graph.viewMeta.sliceNodeCount === "number") {
    parts.push(`slice ${graph.viewMeta.sliceNodeCount} nodes`);
  }

  if (typeof graph.viewMeta.collapsedClusterCount === "number") {
    parts.push(`${graph.viewMeta.collapsedClusterCount} collapsed clusters`);
  }

  if (typeof graph.viewMeta.zoom === "number") {
    parts.push(`LoD zoom ${graph.viewMeta.zoom.toFixed(2)}`);
  }

  return `${STATUS_RENDERED_PREFIX}: ${parts.join(", ")}`;
}

function formatPieFieldOption(summary: {
  key: string;
  uniqueValueCount: number;
}): string {
  const suffix =
    summary.uniqueValueCount > HIGH_CARDINALITY_PIE_FIELD_THRESHOLD
      ? "many values"
      : `${summary.uniqueValueCount} values`;
  return `${summary.key} (${suffix})`;
}

function parseAncillaryPayload(rawInput: string): AncillaryPayload {
  if (!rawInput) {
    return {};
  }

  const parsed: unknown = JSON.parse(rawInput);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(ERR_INVALID_ANCILLARY_JSON);
  }

  const record = parsed as Record<string, unknown>;
  const metadataSchema = record[KEY_METADATA_SCHEMA];
  const metadataByNodeId = record[KEY_METADATA_BY_NODE_ID];
  const visualMapping = record[KEY_VISUAL_MAPPING];

  const hasSchema = Array.isArray(metadataSchema);
  const hasByNodeId =
    metadataByNodeId !== undefined &&
    metadataByNodeId !== null &&
    typeof metadataByNodeId === "object";

  if (!hasSchema && !hasByNodeId) {
    throw new Error(ERR_INVALID_ANCILLARY_JSON);
  }

  return {
    metadata_schema: hasSchema
      ? (metadataSchema as MetadataField[])
      : undefined,
    metadata_by_node_id: hasByNodeId
      ? (metadataByNodeId as Record<
          string,
          Record<string, string | number | boolean | null>
        >)
      : undefined,
    visual_mapping:
      visualMapping && typeof visualMapping === "object"
        ? (visualMapping as VisualMappingOptions)
        : undefined,
  };
}

function buildVisualMappingForControls(
  baseVisualMapping: VisualMappingOptions,
  fieldKeys: string[],
  sizeFieldKey: string | undefined,
  sizeScaleValue: string | undefined,
): VisualMappingOptions {
  const selectedFields = fieldKeys.map((field) => field.trim()).filter(Boolean);
  const mapping: VisualMappingOptions = { ...baseVisualMapping };
  const hasSizeControls =
    sizeFieldKey !== undefined || sizeScaleValue !== undefined;

  if (hasSizeControls || baseVisualMapping.size || baseVisualMapping.sizeField) {
    const selectedSizeField =
      sizeFieldKey?.trim() ||
      baseVisualMapping.size?.field ||
      baseVisualMapping.sizeField ||
      DEFAULT_PROFILE_COUNT_FIELD;
    mapping.size = {
      ...(baseVisualMapping.size ?? {}),
      field: selectedSizeField,
      scale: normalizeSizeScale(sizeScaleValue, baseVisualMapping.size?.scale),
    };
  }

  if (selectedFields.length === 0) {
    return mapping;
  }

  return {
    ...mapping,
    pie: {
      ...(baseVisualMapping.pie ?? {}),
      enabled: true,
      fields: selectedFields,
    },
  };
}

function getSelectedOptions(select: HTMLSelectElement | undefined): string[] {
  if (!select) {
    return [];
  }

  return [...select.selectedOptions]
    .map((option) => option.value)
    .filter((value) => value.trim().length > 0);
}

function normalizeSizeScale(
  value: string | undefined,
  fallback: SizeScale | undefined,
): SizeScale {
  if (value === SIZE_SCALE_LOG) {
    return SIZE_SCALE_LOG;
  }
  if (value === SIZE_SCALE_LINEAR) {
    return SIZE_SCALE_LINEAR;
  }
  return fallback ?? SIZE_SCALE_LINEAR;
}

function readTextFile(file: File): Promise<string> {
  return file.text();
}
