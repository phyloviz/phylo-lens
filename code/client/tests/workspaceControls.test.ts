import html from '../index.html?raw';
import { afterEach, expect, it } from 'vitest';
import workspaceControls from '../src/app/shell/controls/workspaceControls';

function mount() {
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/^[^>]+>/, '');
  const controls = workspaceControls(document.body);
  controls.mount();
  return controls;
}

afterEach(() => document.body.replaceChildren());

it('supports keyboard task navigation and preserves data input and per-task scroll positions', () => {
  const controls = mount();
  const data = document.getElementById('data-tab')!;
  const explore = document.getElementById('explore-tab')!;
  const appearance = document.getElementById('appearance-tab')!;
  const input = document.getElementById('dataset-name-input') as HTMLInputElement;
  const drawer = document.getElementById('workspace-sidebar')!;
  input.value = 'my analysis';
  drawer.scrollTop = 80;
  data.focus();
  data.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
  expect(document.activeElement).toBe(explore);
  expect(document.getElementById('data-panel')?.hidden).toBe(true);
  drawer.scrollTop = 120;
  explore.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', cancelable: true }));
  expect(document.activeElement).toBe(data);
  expect(drawer.scrollTop).toBe(80);
  data.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
  expect(document.activeElement).toBe(appearance);
  appearance.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }));
  expect(document.activeElement).toBe(explore);
  explore.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
  expect(document.activeElement).toBe(data);
  const unrelated = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
  data.dispatchEvent(unrelated);
  expect(unrelated.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(data);
  expect(document.querySelectorAll('.workspace-tabs [tabindex="0"]')).toHaveLength(1);
  data.click();
  expect(input.value).toBe('my analysis');
  controls.unmount();
  explore.click();
  expect(data.getAttribute('aria-selected')).toBe('true');
});

it('moves from data entry to exploration and keeps inspection contextual without losing settings', () => {
  const controls = mount();
  const exportButton = document.getElementById('open-export') as HTMLButtonElement;
  controls.loadStarted();
  expect(exportButton.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#render-form button[type="submit"]')?.disabled).toBe(true);
  controls.loadCompleted('<my tree>');
  const legend = document.getElementById('graph-legend')!;
  const graph = {
    nodes: [{ id: 'fold', x: 0, y: 0, attributes: { isBranchCollapsed: true } }],
    edges: [],
    viewMeta: { layout: 'server' as const, lodLevel: 0 },
  };
  controls.graphRendered(graph);
  expect(legend.hidden).toBe(false);
  expect([...legend.querySelectorAll('li')].filter(item => !item.hidden).map(item => item.textContent)).toEqual([
    'Collapsed branch',
  ]);
  const about = legend.querySelector('details')!;
  expect(about.open).toBe(false);
  about.open = true;
  controls.graphRendered({ ...graph, nodes: [{ id: 'group', x: 0, y: 0, attributes: { isClusterProxy: true } }] });
  expect([...legend.querySelectorAll('li')].filter(item => !item.hidden).map(item => item.textContent)).toEqual([
    'Automatic group',
  ]);
  expect(legend.querySelector('details')).toBe(about);
  expect(about.open).toBe(true);
  controls.graphRendered({
    ...graph,
    nodes: [],
    edges: [{ id: 'extra', source: 'a', target: 'b', attributes: { isDistanceConnection: true } }],
  });
  expect([...legend.querySelectorAll('li')].filter(item => !item.hidden).map(item => item.textContent)).toEqual([
    'Additional connection',
  ]);
  controls.graphRendered({ ...graph, nodes: [] });
  expect(legend.hidden).toBe(true);
  expect(exportButton.disabled).toBe(false);
  expect(document.getElementById('current-dataset')?.textContent).toBe('<my tree>');
  expect(document.getElementById('explore-tab')?.getAttribute('aria-selected')).toBe('true');
  controls.selectNode('a');
  expect(document.getElementById('inspect-node-panel')?.hidden).toBe(false);
  document.getElementById('inspector-close')!.click();
  expect(document.getElementById('workspace-inspector')?.hidden).toBe(true);
  expect(document.activeElement).toBe(document.getElementById('inspector-toggle'));
  controls.showRegion();
  expect(document.getElementById('workspace-inspector')?.hidden).toBe(false);
  expect(document.getElementById('inspect-region-panel')?.hidden).toBe(false);
  controls.loadFailed();
  expect(legend.hidden).toBe(true);
  expect(exportButton.disabled).toBe(true);
  expect(document.getElementById('data-tab')?.getAttribute('aria-selected')).toBe('true');
  expect(document.getElementById('current-dataset')?.textContent).toBe('No dataset loaded');
  controls.unmount();
});
