import type { GraphWorkbench } from "./workbench/graphWorkbench";
import type { VisualMappingOptions } from "../render/visualMappings";
import {
  buildAncillaryWheelStats,
  renderAncillaryWheel,
} from "../components/ancillaryWheel";
import type { PositionedGraph } from "../contracts/positioned";
import type { MetadataField } from "../contracts/models";

export const DEFAULT_STATUS_READY = "Ready";
export const STATUS_RENDERING_PREFIX = "Rendering";
export const STATUS_RENDERED_PREFIX = "Rendered";
export const STATUS_FAILED_PREFIX = "Failed";
export const DEFAULT_MAX_NODES = 1500;
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

const KEY_METADATA_SCHEMA = "metadata_schema";
const KEY_METADATA_BY_NODE_ID = "metadata_by_node_id";
const KEY_VISUAL_MAPPING = "visual_mapping";

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
  datasetNameInput?: HTMLInputElement;
  ancillaryInput?: HTMLTextAreaElement;
  status: HTMLElement;
  ancillaryWheelContainer?: HTMLElement;
  ancillaryModeSelect?: HTMLSelectElement;
  ancillaryNodeSelect?: HTMLSelectElement;
  maxNodesInput?: HTMLInputElement;
  initialZoomInput?: HTMLInputElement;
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
  private readonly datasetNameInput?: HTMLInputElement;
  private readonly ancillaryInput?: HTMLTextAreaElement;
  private readonly statusElement: HTMLElement;
  private readonly ancillaryWheelContainer?: HTMLElement;
  private readonly ancillaryModeSelect?: HTMLSelectElement;
  private readonly ancillaryNodeSelect?: HTMLSelectElement;
  private readonly maxNodesInput?: HTMLInputElement;
  private readonly initialZoomInput?: HTMLInputElement;

  private lastRenderedGraph: PositionedGraph | null = null;

  private boundSubmit: ((event: SubmitEvent) => void) | null = null;
  private boundAncillaryModeChange: (() => void) | null = null;
  private boundAncillaryNodeChange: (() => void) | null = null;

  constructor(options: UiShellOptions) {
    this.workbench = options.workbench;
    this.form = options.elements.form;
    this.newickInput = options.elements.newickInput;
    this.datasetNameInput = options.elements.datasetNameInput;
    this.ancillaryInput = options.elements.ancillaryInput;
    this.statusElement = options.elements.status;
    this.ancillaryWheelContainer = options.elements.ancillaryWheelContainer;
    this.ancillaryModeSelect = options.elements.ancillaryModeSelect;
    this.ancillaryNodeSelect = options.elements.ancillaryNodeSelect;
    this.maxNodesInput = options.elements.maxNodesInput;
    this.initialZoomInput = options.elements.initialZoomInput;

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

    this.ancillaryModeSelect?.addEventListener(
      "change",
      this.boundAncillaryModeChange,
    );
    this.ancillaryNodeSelect?.addEventListener(
      "change",
      this.boundAncillaryNodeChange,
    );
    this.updateNodeSelectionVisibility();

    this.boundSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      void this.renderCurrentInput();
    };

    this.form.addEventListener("submit", this.boundSubmit as EventListener);
  }

  // Normalize and render using current user input values.
  async renderCurrentInput(): Promise<void> {
    const newick = this.newickInput.value.trim();
    const datasetName = this.datasetNameInput?.value.trim();
    const ancillaryRaw = this.ancillaryInput?.value.trim() ?? "";

    if (!newick) {
      this.setStatus(`${STATUS_FAILED_PREFIX}: empty Newick input`);
      return;
    }

    this.setStatus(`${STATUS_RENDERING_PREFIX}...`);

    try {
      const ancillaryPayload = parseAncillaryPayload(ancillaryRaw);
      await this.workbench.renderNewick(newick, datasetName || undefined, {
        metadataSchema: ancillaryPayload.metadata_schema,
        metadataByNodeId: ancillaryPayload.metadata_by_node_id,
        visualMapping: ancillaryPayload.visual_mapping,
        lod: {
          maxNodes: this.getSelectedMaxNodes(),
          zoom: this.getSelectedInitialZoom(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
      this.lastRenderedGraph = null;
      this.updateNodeSelector(null);
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
        buildAncillaryWheelStats(this.lastRenderedGraph, {
          includeNodeIds: new Set([selectedId]),
        }),
        `Node '${selectedId}' has no ancillary pie data.`,
      );
      return;
    }

    // Current mode uses the currently rendered graph snapshot.
    renderAncillaryWheel(
      this.ancillaryWheelContainer,
      buildAncillaryWheelStats(this.lastRenderedGraph),
    );
  }

  private handleGraphRendered(graph: PositionedGraph): void {
    this.setStatus(buildRenderedStatus(graph));
    this.lastRenderedGraph = graph;
    this.updateNodeSelector(graph);
    this.updateNodeSelectionVisibility();
    this.renderAncillaryStats();
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
}

function buildRenderedStatus(graph: PositionedGraph): string {
  const parts = [
    `${graph.nodes.length} nodes`,
    `${graph.edges.length} edges`,
    `LoD ${graph.viewMeta.lodLevel}`,
  ];

  if (typeof graph.viewMeta.sliceNodeCount === "number") {
    parts.push(`slice ${graph.viewMeta.sliceNodeCount} nodes`);
  }

  if (typeof graph.viewMeta.collapsedClusterCount === "number") {
    parts.push(`${graph.viewMeta.collapsedClusterCount} collapsed clusters`);
  }

  if (typeof graph.viewMeta.zoom === "number") {
    parts.push(`zoom ${graph.viewMeta.zoom.toFixed(2)}`);
  }

  return `${STATUS_RENDERED_PREFIX}: ${parts.join(", ")}`;
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
