import { expect, it, vi } from 'vitest';
import forestControls from '../src/app/shell/controls/forestControls';
import { deferred } from './helpers/state';
import type { GraphComponentsResult } from '../src/contracts/graph/components';
import type { PositionedGraph } from '../src/contracts/positioned';

const tree = (id: string) => ({ id, nodeCount: 3, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } });
const graph: PositionedGraph = { nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } };

it('pages tree tabs and restores controls after a failed switch', async () => {
  document.body.innerHTML = '<section id="forest"></section><div id="graph-root"></div>';
  const root = document.querySelector<HTMLElement>('#forest')!;
  const client = {
    listComponents: vi
      .fn()
      .mockResolvedValueOnce({ components: [tree('a')], nextCursor: 5 })
      .mockResolvedValueOnce({ components: [tree('b')], nextCursor: null }),
    getComponentId: () => undefined,
    selectComponent: vi.fn().mockRejectedValue(new Error('offline')),
  };
  const changed = vi.fn();
  const controller = forestControls(
    client,
    { forestControls: root, graphRoot: document.querySelector<HTMLElement>('#graph-root')! },
    changed
  );
  controller.mount();
  await controller.load();
  expect(root.hidden).toBe(false);
  const more = [...root.querySelectorAll('button')].find(button => button.textContent === 'More trees')!;
  more.click();
  await vi.waitFor(() => expect(root.querySelectorAll('[role="tab"]')).toHaveLength(3));
  expect(client.listComponents).toHaveBeenLastCalledWith({ after: 5 });
  const overview = root.querySelector<HTMLButtonElement>('[role="tab"]')!;
  overview.focus();
  overview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.activeElement?.textContent).toContain('Tree 1');
  (document.activeElement as HTMLButtonElement).click();
  await vi.waitFor(() => expect(root.textContent).toContain('offline'));
  expect(changed.mock.calls).toEqual([[true], [false]]);
  expect(overview.disabled).toBe(false);
  expect(overview.getAttribute('aria-selected')).toBe('true');
  controller.unmount();
});

it('does not apply a page or selection from a previous dataset', async () => {
  const pending = deferred<GraphComponentsResult>();
  const selection = deferred<PositionedGraph>();
  const root = document.createElement('section');
  const client = {
    listComponents: vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ components: [tree('a'), tree('b')], nextCursor: null }),
    getComponentId: () => undefined,
    selectComponent: vi.fn(() => selection.promise),
  };
  const changed = vi.fn();
  const controller = forestControls(client, { forestControls: root }, changed);
  controller.mount();
  const loading = controller.load();
  controller.reset();
  pending.resolve({ components: [tree('old'), tree('other')], nextCursor: null });
  await loading;
  expect(root.hidden).toBe(true);
  expect(root.querySelectorAll('[role="tab"]')).toHaveLength(0);
  await controller.load();
  root.querySelector<HTMLButtonElement>('[data-component-id="a"]')!.click();
  controller.reset();
  selection.resolve(graph);
  await Promise.resolve();
  await Promise.resolve();
  expect(root.hidden).toBe(true);
  expect(root.hasAttribute('aria-busy')).toBe(false);
  expect(changed.mock.calls).toEqual([[true]]);
  controller.unmount();
});

it('offers a working retry when the initial tree list fails', async () => {
  const root = document.createElement('section');
  const workbench = {
    listComponents: vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ components: [tree('a'), tree('b')], nextCursor: null }),
    getComponentId: () => undefined,
    selectComponent: vi.fn(async () => graph),
  };
  const controller = forestControls(workbench, { forestControls: root }, vi.fn());
  controller.mount();
  await controller.load();
  const retry = [...root.querySelectorAll('button')].find(button => button.textContent === 'Retry tree list')!;
  expect(retry.hidden).toBe(false);
  retry.click();
  await vi.waitFor(() => expect(root.querySelectorAll('[role="tab"]')).toHaveLength(3));
  expect(root.textContent).not.toContain('offline');
  controller.unmount();
});
