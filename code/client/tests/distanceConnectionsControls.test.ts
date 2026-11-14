import { expect, it, vi } from 'vitest';
import { distanceConnectionsControls } from '../src/app/shell/controls/distanceConnectionsControls';
import type { GraphWorkbench } from '../src/app/workbench/graphWorkbench.types';

it('explains the loaded metric, rejects fractional locus counts and preserves zero as a real threshold', async () => {
  const threshold = document.createElement('input');
  const button = document.createElement('button');
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
  controls.unmount();
});
