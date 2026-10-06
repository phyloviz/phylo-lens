import type { GraphDisplayOptions } from '../../../render/renderer.types';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';
import { getSelectedOptions } from './selectOptions';

export type DisplayOptionsControlsElements = {
  readonly displayOptionsSelect?: HTMLSelectElement;
  readonly edgeLabelPolicySelect?: HTMLSelectElement;
};

export default function createDisplayOptionsControls(
  workbench: Pick<GraphWorkbench, 'updateDisplayOptions'>,
  elements: DisplayOptionsControlsElements
) {
  const { displayOptionsSelect, edgeLabelPolicySelect } = elements;
  const bindings = eventBindings();

  return { mount, unmount: bindings.clear, readOptions, apply };

  function mount(): void {
    bindings.on(edgeLabelPolicySelect, 'change', apply);
    bindings.on(displayOptionsSelect, 'change', apply);
    bindings.on(displayOptionsSelect, 'mousedown', event => {
      if (toggleClickedOption(displayOptionsSelect, event)) apply();
    });
  }

  function readOptions(): GraphDisplayOptions {
    const display = buildDisplayOptions(getSelectedOptions(displayOptionsSelect));
    return edgeLabelPolicySelect
      ? { ...display, edgeDistanceLabelPolicy: edgeLabelPolicySelect.value === 'always' ? 'always' : 'auto' }
      : display;
  }

  function apply(): void {
    workbench.updateDisplayOptions(readOptions());
  }
}

export const DISPLAY_OPTION_NODE_LABELS = 'node-labels';
export const DISPLAY_OPTION_EDGE_DISTANCE_LABELS = 'edge-distance-labels';
export const DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES = 'distance-weighted-edges';

export function buildDisplayOptions(selectedValues: readonly string[]): GraphDisplayOptions {
  const selected = new Set(selectedValues);

  return {
    nodeLabels: selected.has(DISPLAY_OPTION_NODE_LABELS),
    edgeDistanceLabels: selected.has(DISPLAY_OPTION_EDGE_DISTANCE_LABELS),
    distanceWeightedEdges: selected.has(DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES),
  };
}

export function toggleClickedOption(select: HTMLSelectElement | undefined, event: MouseEvent): boolean {
  if (!select || !(event.target instanceof HTMLOptionElement)) {
    return false;
  }

  event.preventDefault();
  event.target.selected = !event.target.selected;
  return true;
}
