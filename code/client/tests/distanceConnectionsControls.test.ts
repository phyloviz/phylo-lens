import { expect, it, vi } from 'vitest';
import { distanceConnectionsControls } from '../src/app/shell/controls/distanceConnectionsControls';
import type { GraphWorkbench } from '../src/app/workbench/graphWorkbench.types';

it('explains the loaded metric, rejects fractional locus counts and preserves zero as a real threshold', async () => {
  const threshold = document.createElement('input');
  const button = document.createElement('button');
  const clear = document.createElement('button');
  const metric = document.createElement('p');
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
      connectionFeedback: feedback,
    }
  );
  controls.mount();
  expect(button.disabled).toBe(true);
  expect(metric.textContent).toContain('Load a dataset');
  controls.setSource('typing_data');
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
  controls.unmount();
});
