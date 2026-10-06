import { calculateAncillaryDistribution, type AncillaryDistribution } from '../../../ancillary/ancillaryDistribution';
import { renderAncillaryWheel } from '../../../components/ancillary-wheel/AncillaryWheel';
import type { PositionedGraph } from '../../../contracts/positioned';
import { resolveMappingPalette, type VisualMappingOptions } from '../../../render/mapping/visualMapping';
import { renderNodeDetails } from './nodeDetails';
import { ANCILLARY_MODE_SELECTED, getAncillaryMode } from './nodeSelector';

type AncillaryWheelsOptions = {
  readonly overviewContainer?: HTMLElement;
  readonly selectedNodeContainer?: HTMLElement;
  readonly modeSelect?: HTMLSelectElement;
  readonly nodeSelect?: HTMLSelectElement;
  readonly getGraph: () => PositionedGraph | null;
  readonly getVisualMapping: () => VisualMappingOptions;
  readonly getCategoryColorOverrides: () => Readonly<Record<string, string>>;
  readonly getSelectedFields: () => readonly string[];
  readonly selectPieFieldMessage: string;
  readonly selectedNodeEmptyMessage: string;
};

export default function createAncillaryWheels(options: AncillaryWheelsOptions) {
  let selectedNodeId: string | null = null;

  return {
    refreshSelectedNode: () => (selectedNodeId ? renderSelectedNode(selectedNodeId) : resetSelectedNode()),
    renderOverview,
    renderSelectedNode,
    resetSelectedNode,
    getDistribution,
  };

  function renderOverview(): void {
    if (!options.overviewContainer) {
      return;
    }

    const graph = options.getGraph();
    if (!graph) {
      renderAncillaryWheel(options.overviewContainer, null);
      return;
    }

    if (getAncillaryMode(options.modeSelect) === ANCILLARY_MODE_SELECTED) {
      renderSelectedOverview(graph);
      return;
    }

    renderDistribution(options.overviewContainer, graph, undefined, 'Current view');
  }

  function renderSelectedNode(nodeId: string): void {
    const graph = options.getGraph();
    if (!graph || !options.selectedNodeContainer) {
      return;
    }

    const keepIdsOpen = selectedNodeId === nodeId && options.selectedNodeContainer.querySelector('details')?.open;
    selectedNodeId = nodeId;
    const node = graph.nodes.find(candidate => candidate.id === nodeId);
    if (!node) {
      renderAncillaryWheel(options.selectedNodeContainer, null, `Node '${nodeId}' is outside the current view.`);
      return;
    }

    options.selectedNodeContainer.replaceChildren();
    renderNodeDetails(options.selectedNodeContainer, node);
    const details = options.selectedNodeContainer.querySelector('details');
    if (details) details.open = Boolean(keepIdsOpen);
    const distribution = document.createElement('div');
    options.selectedNodeContainer.append(distribution);
    renderDistribution(distribution, graph, new Set([nodeId]), `Node '${nodeId}'`);
  }

  function resetSelectedNode(): void {
    selectedNodeId = null;
    if (!options.selectedNodeContainer) {
      return;
    }

    renderAncillaryWheel(options.selectedNodeContainer, null, options.selectedNodeEmptyMessage);
  }

  function getDistribution(includeNodeIds?: ReadonlySet<string>): AncillaryDistribution | null {
    const graph = options.getGraph();
    return graph ? distributionForSelection(graph, options.getSelectedFields(), includeNodeIds) : null;
  }

  function distributionForSelection(
    graph: PositionedGraph,
    fields: readonly string[],
    includeNodeIds?: ReadonlySet<string>
  ): AncillaryDistribution | null {
    if (fields.length === 0) return null;
    const mapping = options.getVisualMapping();
    return calculateAncillaryDistribution(graph, {
      fields,
      includeNodeIds,
      palette: resolveMappingPalette(mapping),
      categoryColors: options.getCategoryColorOverrides(),
      categoryGrouping: mapping.pie?.categoryGrouping,
    });
  }

  function renderSelectedOverview(graph: PositionedGraph): void {
    if (!options.overviewContainer) {
      return;
    }

    const selectedId = options.nodeSelect?.value;
    if (!selectedId) {
      renderAncillaryWheel(options.overviewContainer, null, 'Choose a node to view its ancillary distribution.');
      return;
    }

    renderDistribution(options.overviewContainer, graph, new Set([selectedId]), `Node '${selectedId}'`);
  }

  function renderDistribution(
    container: HTMLElement,
    graph: PositionedGraph,
    ids: ReadonlySet<string> | undefined,
    subject: string
  ): void {
    const fields = options.getSelectedFields();
    const heading = document.createElement('p');
    heading.className = 'ancillary-color-context';
    heading.textContent =
      fields.length === 0
        ? 'Ancillary coloring: none'
        : `${subject} · ${fields.length > 1 ? 'Observed combinations' : 'Color field'}: ${fields.join(' × ')} · one contribution per observation, including missing values`;
    const chart = document.createElement('div');
    const emptyMessage = fields.length ? `${subject} has no ancillary pie data.` : options.selectPieFieldMessage;
    renderAncillaryWheel(chart, distributionForSelection(graph, fields, ids), emptyMessage);
    container.replaceChildren(heading, chart);
  }
}
