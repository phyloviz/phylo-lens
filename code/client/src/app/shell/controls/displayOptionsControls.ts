import type { GraphDisplayOptions } from '../../../render/renderer.types';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';

export type DisplayOptionsControlsElements = {
  readonly nodeLabelsInput?: HTMLInputElement;
  readonly edgeDistanceLabelsInput?: HTMLInputElement;
  readonly distanceWeightedEdgesInput?: HTMLInputElement;
  readonly edgeLabelSettings?: HTMLFieldSetElement;
  readonly edgeLabelFeedback?: HTMLElement;
  readonly edgeLabelPolicySelect?: HTMLSelectElement;
  readonly edgeLabelMinInput?: HTMLInputElement;
  readonly edgeLabelMaxInput?: HTMLInputElement;
};

export default function createDisplayOptionsControls(
  workbench: Pick<GraphWorkbench, 'updateDisplayOptions'>,
  elements: DisplayOptionsControlsElements
) {
  const {
    nodeLabelsInput,
    edgeDistanceLabelsInput,
    distanceWeightedEdgesInput,
    edgeLabelSettings,
    edgeLabelFeedback,
    edgeLabelPolicySelect,
    edgeLabelMinInput,
    edgeLabelMaxInput,
  } = elements;
  const bindings = eventBindings();

  return { mount, unmount: bindings.clear, readOptions, apply };

  function mount(): void {
    bindings.on(edgeLabelPolicySelect, 'change', apply);
    bindings.on(edgeLabelMinInput, 'input', apply);
    bindings.on(edgeLabelMaxInput, 'input', apply);
    for (const input of [nodeLabelsInput, edgeDistanceLabelsInput, distanceWeightedEdgesInput])
      bindings.on(input, 'change', apply);
  }

  function readOptions(): GraphDisplayOptions {
    const display: GraphDisplayOptions = {
      nodeLabels: nodeLabelsInput?.checked ?? false,
      edgeDistanceLabels: edgeDistanceLabelsInput?.checked ?? false,
      distanceWeightedEdges: distanceWeightedEdgesInput?.checked ?? false,
    };
    if (edgeLabelSettings) {
      edgeLabelSettings.hidden = !display.edgeDistanceLabels;
      edgeLabelSettings.disabled = !display.edgeDistanceLabels;
    }
    const readBound = (input?: HTMLInputElement) => {
      if (!input?.value.trim()) return undefined;
      const value = Number(input.value);
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    };
    const min = readBound(edgeLabelMinInput);
    const max = readBound(edgeLabelMaxInput);
    const message =
      display.edgeDistanceLabels && min !== undefined && max !== undefined && min > max
        ? 'Maximum must be at least minimum.'
        : '';
    edgeLabelMaxInput?.setCustomValidity(message);
    if (edgeLabelFeedback)
      edgeLabelFeedback.textContent = display.edgeDistanceLabels
        ? ([edgeLabelMinInput, edgeLabelMaxInput].find(input => input && !input.validity.valid)?.validationMessage ??
          '')
        : '';
    if (min !== undefined) Object.assign(display, { edgeDistanceLabelMin: min });
    if (max !== undefined) Object.assign(display, { edgeDistanceLabelMax: max });
    return edgeLabelPolicySelect
      ? { ...display, edgeDistanceLabelPolicy: edgeLabelPolicySelect.value === 'always' ? 'always' : 'auto' }
      : display;
  }

  function apply(): void {
    const options = readOptions();
    if (
      options.edgeDistanceLabels &&
      [edgeLabelMinInput, edgeLabelMaxInput].some(input => input && !input.validity.valid)
    )
      return;
    workbench.updateDisplayOptions(options);
  }
}
