import { expect, it, vi } from 'vitest';
import { distanceConnectionsControls } from '../src/app/shell/controls/distanceConnectionsControls';
import type { GraphWorkbench } from '../src/app/workbench/graphWorkbench.types';

it('explains the loaded metric, rejects fractional locus counts and preserves zero as a real threshold', async () => {
  const threshold = document.createElement('input');
  const button = document.createElement('button');
  const clear = document.createElement('button');
  const metric = document.createElement('p');
  const heading = document.createElement('summary');
  const thresholdLabel = document.createElement('span');
  const feedback = document.createElement('p');
  const apply = vi
    .fn<GraphWorkbench['setDistanceConnections']>()
    .mockResolvedValue({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
  const controls = distanceConnectionsControls(
    { setDistanceConnections: apply },
    {
      connectionThreshold: threshold,
      applyConnections: button,
      clearConnections: clear,
      connectionMetric: metric,
      connectionHeading: heading,
      connectionThresholdLabel: thresholdLabel,
      connectionFeedback: feedback,
    }
  );
  controls.mount();
  expect(button.disabled).toBe(true);
  expect(metric.textContent).toContain('Load a dataset');
  controls.setSource('typing_data');
  expect(heading.textContent).toBe('nLV connections — link profiles');
  expect(thresholdLabel.textContent).toBe('nLV level (maximum differing loci)');
  expect(threshold.step).toBe('1');
  expect(metric.textContent).toContain('Allelic distance');
  threshold.value = '1.5';
  button.click();
  expect(apply).not.toHaveBeenCalled();
  expect(feedback.textContent).toContain('whole number');
  threshold.value = '0';
  button.click();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledWith({ threshold: 0, maxConnections: 50000 }));
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  apply.mockRejectedValueOnce(new Error('Connection limit exceeded. No partial overlay.'));
  button.click();
  await vi.waitFor(() => expect(feedback.textContent).toContain('No partial overlay'));
  controls.refresh({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
  expect(feedback.textContent).toContain('No partial overlay');
  clear.click();
  await vi.waitFor(() => expect(feedback.textContent).toContain('No additional connections'));
  controls.setSource('newick');
  expect(heading.textContent).toBe('Tree-path connections');
  expect(thresholdLabel.textContent).toBe('Maximum tree-path distance');
  expect(metric.textContent).toContain('not an nLV level');
  expect(threshold.step).toBe('any');
  controls.setSource(null);
  expect(heading.textContent).toBe('Distance connections (nLV for profiles)');
  expect(thresholdLabel.textContent).toBe('Maximum pairwise distance');
  expect(button.disabled).toBe(true);
  controls.unmount();
});
