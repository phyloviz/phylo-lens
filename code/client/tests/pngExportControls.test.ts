import { beforeEach, describe, expect, it, vi } from 'vitest';
import createPngExportControls from '../src/app/shell/controls/pngExportControls';
import { downloadBlob } from '../src/app/shell/inputs/fileInputs';
import type { GraphWorkbench } from '../src/app/workbench/graphWorkbench';
import { deferred } from './helpers/state';

vi.mock('../src/app/shell/inputs/fileInputs', () => ({ downloadBlob: vi.fn() }));

function fixture() {
  const button = document.createElement('button');
  const pending = deferred<Blob>();
  const exportPng = vi.fn<GraphWorkbench['exportPng']>().mockReturnValue(pending.promise);
  const setStatus = vi.fn();
  const setFailureStatus = vi.fn();
  const getLoadSequence = vi.fn(() => 1);
  const controls = createPngExportControls({
    workbench: { exportPng },
    elements: { exportButton: button },
    hasGraph: () => true,
    getEdgeLabelsEnabled: () => true,
    getLoadSequence,
    setStatus,
    setFailureStatus,
  });
  controls.mount();
  return { button, pending, exportPng, controls, getLoadSequence, setStatus, setFailureStatus };
}

describe('PNG export lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finishes the captured export across a graph load without replacing the new status', async () => {
    const h = fixture();
    h.button.click();
    expect(h.button.disabled).toBe(true);
    expect(h.exportPng).toHaveBeenCalledWith({ scale: 2, edgeLabelSize: 12, edgeLabels: 'all', includeLegend: true });
    h.getLoadSequence.mockReturnValue(2);
    const blob = new Blob(['PNG']);
    h.pending.resolve(blob);
    await Promise.resolve();
    expect(downloadBlob).toHaveBeenCalledWith('phylo-lens.png', blob);
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.button.disabled).toBe(false);
    h.controls.unmount();
  });

  it('releases listeners and ignores an export that finishes after unmount', async () => {
    const h = fixture();
    h.button.click();
    h.controls.unmount();
    h.button.click();
    expect(h.exportPng).toHaveBeenCalledTimes(1);
    // A new owner may reuse the button before the old export finishes.
    h.button.disabled = true;
    h.pending.resolve(new Blob(['PNG']));
    await Promise.resolve();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.button.disabled).toBe(true);
  });

  it('reports export failures and releases the button', async () => {
    const h = fixture();
    h.button.click();
    h.pending.reject(new Error('PNG failed'));
    await Promise.resolve();
    expect(h.setFailureStatus).toHaveBeenCalledWith('PNG failed');
    expect(h.button.disabled).toBe(false);
    expect(downloadBlob).not.toHaveBeenCalled();
    h.controls.unmount();
  });
});
