import type { PositionedGraph } from '../../../contracts/positioned';
import type { VisualMappingOptions } from '../../../render/mapping/visualMapping';
import ancillaryFieldControls from '../controls/ancillaryFieldControls';
import sizeFieldControls from '../controls/sizeFieldControls';
import { getSelectedOptions } from '../controls/selectOptions';
import eventBindings from '../events/eventBindings';
import visualMappingPalette from '../palette/visualMappingPalette';
import ancillaryWheels from './ancillaryWheels';

export const CATEGORY_COLOR_SAVE_FILENAME = 'phyloviz-category-colors.txt';
export const SELECTED_NODE_WHEEL_EMPTY_MESSAGE = 'Click a node to view its ancillary distribution.';
export const SELECT_PIE_FIELD_MESSAGE = 'Select an ancillary field to view its distribution.';

export type AncillaryControlsElements = {
  readonly ancillaryWheelContainer?: HTMLElement;
  readonly ancillarySelectedNodeWheelContainer?: HTMLElement;
  readonly ancillaryFieldSelect?: HTMLSelectElement;
  readonly showNodePiesInput?: HTMLInputElement;
  readonly ancillarySizeFieldSelect?: HTMLSelectElement;
  readonly ancillarySizeScaleSelect?: HTMLSelectElement;
  readonly paletteControlsContainer?: HTMLElement;
  readonly paletteLoadButton?: HTMLButtonElement;
  readonly paletteLoadInput?: HTMLInputElement;
  readonly paletteSaveButton?: HTMLButtonElement;
  readonly paletteResetButton?: HTMLButtonElement;
};

type AncillaryControlsOptions = {
  readonly updateVisualMapping: (mapping: VisualMappingOptions) => void;
  readonly elements: AncillaryControlsElements;
  readonly getGraph: () => PositionedGraph | null;
  readonly setStatus: (message: string) => void;
  readonly setFailureStatus: (message: string) => void;
};

export default function createAncillaryControls(options: AncillaryControlsOptions) {
  const {
    ancillaryWheelContainer,
    ancillarySelectedNodeWheelContainer,
    ancillaryFieldSelect,
    showNodePiesInput,
    ancillarySizeFieldSelect,
    ancillarySizeScaleSelect,
    paletteControlsContainer,
    paletteLoadButton,
    paletteLoadInput,
    paletteSaveButton,
    paletteResetButton,
  } = options.elements;
  const bindings = eventBindings();
  const fields = ancillaryFieldControls(ancillaryFieldSelect);
  const sizeFields = sizeFieldControls(ancillarySizeFieldSelect);
  const palette = visualMappingPalette({
    updateVisualMapping: options.updateVisualMapping,
    container: paletteControlsContainer,
    loadInput: paletteLoadInput,
    saveFilename: CATEGORY_COLOR_SAVE_FILENAME,
    getGraph: options.getGraph,
    getSelectedFields: () => getSelectedOptions(ancillaryFieldSelect),
    getPiesEnabled: () => showNodePiesInput?.checked,
    getSizeFieldValue: () => ancillarySizeFieldSelect?.value,
    getSizeScaleValue: () => ancillarySizeScaleSelect?.value,
    onChanged: () => {
      wheels.renderOverview();
      wheels.refreshSelectedNode();
    },
    setStatus: options.setStatus,
    setFailureStatus: options.setFailureStatus,
  });
  const wheels = ancillaryWheels({
    overviewContainer: ancillaryWheelContainer,
    selectedNodeContainer: ancillarySelectedNodeWheelContainer,
    getGraph: options.getGraph,
    getVisualMapping: palette.getCurrentVisualMapping,
    getCategoryColorOverrides: palette.getCategoryColorOverrides,
    getSelectedFields: () => getSelectedOptions(ancillaryFieldSelect),
    selectPieFieldMessage: SELECT_PIE_FIELD_MESSAGE,
    selectedNodeEmptyMessage: SELECTED_NODE_WHEEL_EMPTY_MESSAGE,
  });

  return {
    mount,
    unmount,
    refreshGraph,
    resetAfterFailure,
    prepareVisualMapping,
    resetPalette: palette.resetColors,
    showNode: wheels.renderSelectedNode,
    resetSelectedNode: wheels.resetSelectedNode,
    getDistribution: wheels.getDistribution,
  };

  function mount(): void {
    wheels.renderOverview();
    wheels.resetSelectedNode();
    palette.renderControls();
    bindings.on(ancillaryFieldSelect, 'change', applyFieldSelection);
    bindings.on(ancillaryFieldSelect, 'mousedown', event => {
      if (fields.toggleOption(event)) applyFieldSelection();
    });
    bindings.on(showNodePiesInput, 'change', palette.applyControlChange);
    bindings.on(ancillarySizeFieldSelect, 'change', palette.applyControlChange);
    bindings.on(ancillarySizeScaleSelect, 'change', palette.applyControlChange);
    bindings.on(paletteControlsContainer, 'input', palette.applyControlChange);
    bindings.on(paletteLoadButton, 'click', () => paletteLoadInput?.click());
    bindings.on(paletteLoadInput, 'change', () => void palette.load());
    bindings.on(paletteSaveButton, 'click', palette.save);
    bindings.on(paletteResetButton, 'click', palette.resetColors);
    fields.updateOptions(null);
    sizeFields.reset();
  }

  function applyFieldSelection(): void {
    palette.renderControls();
    palette.applyControlChange();
  }

  function refreshGraph(graph: PositionedGraph): void {
    fields.updateOptions(graph);
    sizeFields.refresh(graph);
    palette.renderControls();
    wheels.renderOverview();
    wheels.refreshSelectedNode();
  }

  function prepareVisualMapping(mapping: VisualMappingOptions): VisualMappingOptions {
    sizeFields.reset(mapping.size?.field);
    fields.setSelection(
      mapping.pie?.enabled !== false && mapping.pie?.fields?.length
        ? mapping.pie.fields
        : mapping.colorField
          ? [mapping.colorField]
          : []
    );
    palette.reset();
    palette.setBaseVisualMapping(mapping);
    return palette.getCurrentVisualMapping();
  }

  function resetAfterFailure(): void {
    palette.reset();
    fields.updateOptions(null);
    sizeFields.reset();
    palette.renderControls();
    wheels.renderOverview();
  }

  function unmount(): void {
    palette.reset();
    bindings.clear();
  }
}
