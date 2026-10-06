import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';
import { downloadBlob } from '../inputs/fileInputs';

export type PngExportControlsElements = {
  readonly exportScaleInput?: HTMLSelectElement;
  readonly exportLabelSizeInput?: HTMLInputElement;
  readonly exportButton?: HTMLButtonElement;
};

type PngExportControlsOptions = {
  readonly workbench: Pick<GraphWorkbench, 'exportPng'>;
  readonly elements: PngExportControlsElements;
  readonly hasGraph: () => boolean;
  readonly getEdgeLabelsEnabled: () => boolean;
  readonly getLoadSequence: () => number;
  readonly setStatus: (message: string) => void;
  readonly setFailureStatus: (message: string) => void;
};

export default function createPngExportControls(options: PngExportControlsOptions) {
  const { exportButton, exportScaleInput, exportLabelSizeInput } = options.elements;
  const bindings = eventBindings();
  let sequence = 0;

  return { mount, unmount };

  function mount(): void {
    bindings.on(exportButton, 'click', () => void exportCurrentView());
  }

  function unmount(): void {
    sequence += 1;
    bindings.clear();
    if (exportButton) exportButton.disabled = false;
  }

  async function exportCurrentView(): Promise<void> {
    if (!options.hasGraph() || !exportButton) {
      options.setFailureStatus('load a tree before exporting');
      return;
    }
    const request = ++sequence;
    const load = options.getLoadSequence();
    const isCurrent = () => request === sequence;
    exportButton.disabled = true;
    try {
      const blob = await options.workbench.exportPng({
        scale: Number(exportScaleInput?.value ?? 2),
        edgeLabelSize: Number(exportLabelSizeInput?.value ?? 12),
        edgeLabels: options.getEdgeLabelsEnabled() ? 'all' : 'none',
        includeLegend: true,
      });
      if (!isCurrent()) return;
      // Finish exports across graph loads; status still belongs to the current load.
      downloadBlob('phylo-lens.png', blob);
      if (load === options.getLoadSequence()) options.setStatus('Exported PNG of the current slice and view.');
    } catch (error) {
      if (isCurrent() && load === options.getLoadSequence())
        options.setFailureStatus(error instanceof Error ? error.message : 'PNG export failed');
    } finally {
      if (isCurrent()) exportButton.disabled = false;
    }
  }
}
