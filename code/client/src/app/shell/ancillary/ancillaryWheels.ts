import {
  buildAncillaryWheelStats,
  buildMetadataFieldWheelStats,
  renderAncillaryWheel,
} from "../../../components/ancillaryWheel";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { VisualMappingOptions } from "../../../render/mapping/visualMapping";
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
  return {
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

    renderAncillaryWheel(options.overviewContainer, buildStats(), emptyMessage());
  }

  function renderSelectedNode(nodeId: string): void {
    const graph = options.getGraph();
    if (!graph || !options.selectedNodeContainer) {
      return;
    }

    const nodeExists = graph.nodes.some((node) => node.id === nodeId);
    if (!nodeExists) {
      return;
    }

    renderAncillaryWheel(
      options.selectedNodeContainer,
      buildStats(new Set([nodeId])),
      emptyMessage(`Node '${nodeId}'`),
    );
  }

  function resetSelectedNode(): void {
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
      return buildMetadataFieldWheelStats(graph, selectedFields[0] ?? "", {
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

    renderAncillaryWheel(
      options.overviewContainer,
      buildStats(new Set([selectedId])),
      emptyMessage(`Node '${selectedId}'`),
    );
  }

  function emptyMessage(subject?: string): string {
    if (options.getSelectedFields().length === 0) {
      return options.selectPieFieldMessage;
    }

    return subject ? `${subject} has no ancillary pie data.` : "No ancillary pie data detected.";
  }
}
