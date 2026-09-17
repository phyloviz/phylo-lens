import {
  buildAncillaryWheelStats,
  buildAncillaryFieldWheelStats,
  renderAncillaryWheel,
} from "../../../components/ancillaryWheel";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { VisualMappingOptions } from "../../../render/mapping/visualMapping";
import { renderNodeDetails } from "./nodeDetails";
import { ANCILLARY_MODE_SELECTED, getAncillaryMode } from "./nodeSelector";

export interface AncillaryWheelsOptions {
  overviewContainer?: HTMLElement;
  selectedNodeContainer?: HTMLElement;
  modeSelect?: HTMLSelectElement;
  nodeSelect?: HTMLSelectElement;
  getGraph: () => PositionedGraph | null;
  getVisualMapping: () => VisualMappingOptions;
  getCategoryColorOverrides: () => Record<string, string>;
  getSelectedFields: () => string[];
  selectPieFieldMessage: string;
  selectedNodeEmptyMessage: string;
}

export default function (options: AncillaryWheelsOptions) {
  let selectedNodeId: string | null = null;

  return {
    refreshSelectedNode: () => (selectedNodeId ? renderSelectedNode(selectedNodeId) : resetSelectedNode()),
    renderOverview: renderOverview,
    renderSelectedNode: renderSelectedNode,
    resetSelectedNode: resetSelectedNode,
    buildStats: buildStats,
  };

  function renderOverview(): void {
    if (!options.overviewContainer) {
      return;
    }

    if (!options.getGraph()) {
      renderAncillaryWheel(options.overviewContainer, null);
      return;
    }

    if (getAncillaryMode(options.modeSelect) === ANCILLARY_MODE_SELECTED) {
      renderSelectedOverview();
      return;
    }

    renderDistribution(options.overviewContainer, undefined, "Current view");
  }

  function renderSelectedNode(nodeId: string): void {
    const graph = options.getGraph();
    if (!graph || !options.selectedNodeContainer) {
      return;
    }

    const keepIdsOpen = selectedNodeId === nodeId && options.selectedNodeContainer.querySelector("details")?.open;
    selectedNodeId = nodeId;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      renderAncillaryWheel(options.selectedNodeContainer, null, `Node '${nodeId}' is outside the current view.`);
      return;
    }

    options.selectedNodeContainer.replaceChildren();
    renderNodeDetails(options.selectedNodeContainer, node);
    const details = options.selectedNodeContainer.querySelector("details");
    if (details) details.open = Boolean(keepIdsOpen);
    const distribution = document.createElement("div");
    options.selectedNodeContainer.append(distribution);
    renderDistribution(distribution, new Set([nodeId]), `Node '${nodeId}'`);
  }

  function resetSelectedNode(): void {
    selectedNodeId = null;
    if (!options.selectedNodeContainer) {
      return;
    }

    renderAncillaryWheel(options.selectedNodeContainer, null, options.selectedNodeEmptyMessage);
  }

  function buildStats(includeNodeIds?: Set<string>) {
    const graph = options.getGraph();
    if (!graph) {
      return null;
    }

    const selectedFields = options.getSelectedFields();
    const palette = options.getVisualMapping().palette;
    const categoryColors = options.getCategoryColorOverrides();

    if (selectedFields.length > 1) {
      return buildAncillaryWheelStats(graph, {
        includeNodeIds,
        palette,
        categoryColors,
      });
    }

    if (selectedFields.length > 0) {
      return buildAncillaryFieldWheelStats(graph, selectedFields[0] ?? "", {
        includeNodeIds,
        palette,
        categoryColors,
      });
    }

    return null;
  }

  function renderSelectedOverview(): void {
    if (!options.overviewContainer) {
      return;
    }

    const selectedId = options.nodeSelect?.value;
    if (!selectedId) {
      renderAncillaryWheel(options.overviewContainer, null, "Choose a node to view its ancillary distribution.");
      return;
    }

    renderDistribution(options.overviewContainer, new Set([selectedId]), `Node '${selectedId}'`);
  }

  function renderDistribution(container: HTMLElement, ids: Set<string> | undefined, subject: string): void {
    const fields = options.getSelectedFields();
    const heading = document.createElement("p");
    heading.className = "ancillary-color-context";
    heading.textContent =
      fields.length === 0
        ? "Ancillary coloring: none"
        : `${subject} · ${fields.length > 1 ? "Color combinations" : "Color field"}: ${fields.join(" × ")}`;
    const chart = document.createElement("div");
    renderAncillaryWheel(chart, buildStats(ids), emptyMessage(subject));
    container.replaceChildren(heading, chart);
  }

  function emptyMessage(subject?: string): string {
    if (options.getSelectedFields().length === 0) {
      return options.selectPieFieldMessage;
    }

    return subject ? `${subject} has no ancillary pie data.` : "No ancillary pie data detected.";
  }
}
