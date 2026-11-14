import html from '../../index.html?raw';
import { expect, it, vi } from 'vitest';
import { setupUiShellHarness } from './harness';
import { workbenchFake } from '../doubles/workbenchFake';
import { setInputFiles } from '../helpers/inputFiles';

const uiShell = setupUiShellHarness();

function initialConnections() {
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/^[^>]+>/, '');
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const source = document.getElementById('source-format') as HTMLSelectElement;
  const level = input('initial-nlv-level');
  const limit = input('initial-nlv-limit');
  const enabled = input('initial-nlv-connections');
  source.value = 'typing_data';
  enabled.checked = true;
  level.value = '2';
  limit.value = '100';
  setInputFiles(input('typing-file-input'), [new File(['id\tL1\na\t1\nb\t2\n'], 'profiles.tsv')]);
  const graph = {
    nodes: [{ id: 'a', x: 0, y: 0 }],
    edges: [],
    viewMeta: { layout: 'server' as const, lodLevel: 0 },
  };
  const workbench = workbenchFake(graph);
  const status = document.getElementById('status')!;
  const shell = uiShell({
    workbench,
    elements: {
      workspaceRoot: document.body,
      form: document.getElementById('render-form') as HTMLFormElement,
      newickInput: document.getElementById('newick-input') as HTMLTextAreaElement,
      typingFileInput: input('typing-file-input'),
      sourceFormatSelect: source,
      initialNlvInput: enabled,
      initialNlvControls: document.getElementById('initial-nlv-controls')!,
      initialNlvLevelInput: level,
      initialNlvLimitInput: limit,
      connectionThreshold: input('connection-threshold'),
      connectionLimit: input('connection-limit'),
      connectionFeedback: document.getElementById('connection-feedback')!,
      status,
    },
  });
  shell.mount();
  return { shell, workbench, graph, level, limit, source, enabled, status };
}

it('loads the tree before adding initial links, owns the chosen settings and keeps them editable in Explore', async () => {
  const { shell, workbench, graph, level, limit, source } = initialConnections();
  let finishTree!: () => void;
  workbench.loadGraph.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishTree = () => resolve(graph);
      })
  );
  workbench.setDistanceConnections.mockImplementationOnce(async () => {
    const overlay = {
      ...graph,
      viewMeta: {
        ...graph.viewMeta,
        distanceConnections: { metric: 'allelic' as const, threshold: 2, totalCount: 3, visibleCount: 3 },
      },
    };
    workbench.setGraphRenderedHandler.mock.calls[0]?.[0]?.(overlay);
    return overlay;
  });
  const loading = shell.renderCurrentInput();
  await vi.waitFor(() => expect(workbench.loadGraph).toHaveBeenCalledOnce());
  expect(workbench.setDistanceConnections).not.toHaveBeenCalled();
  level.value = '9';
  limit.value = '1';
  finishTree();
  await loading;
  expect(workbench.setDistanceConnections).toHaveBeenCalledWith({ threshold: 2, maxConnections: 100 });
  expect((document.getElementById('connection-threshold') as HTMLInputElement).value).toBe('2');
  expect((document.getElementById('connection-limit') as HTMLInputElement).value).toBe('100');
  expect(document.getElementById('connection-feedback')?.textContent).toContain('3 of 3 additional connections');
  expect(document.getElementById('explore-tab')?.getAttribute('aria-selected')).toBe('true');

  // Saved typing settings must not apply a different metric to a later Newick tree.
  source.value = 'newick';
  source.dispatchEvent(new Event('change'));
  (document.getElementById('newick-input') as HTMLTextAreaElement).value = '(a:1)b;';
  expect(document.getElementById('initial-nlv-controls')?.hidden).toBe(true);
  await shell.renderCurrentInput();
  expect(workbench.setDistanceConnections).toHaveBeenCalledTimes(1);
});

it('keeps the loaded tree usable and retains an initial overlay error across viewport updates', async () => {
  const { shell, workbench, graph } = initialConnections();
  workbench.setDistanceConnections.mockRejectedValueOnce(new Error('Connection limit exceeded. No partial overlay.'));
  await shell.renderCurrentInput();
  expect(document.getElementById('connection-feedback')?.textContent).toContain('No partial overlay');
  workbench.setGraphRenderedHandler.mock.calls[0]?.[0]?.(graph);
  expect(document.getElementById('connection-feedback')?.textContent).toContain('No partial overlay');
  expect(document.getElementById('explore-tab')?.getAttribute('aria-selected')).toBe('true');
  expect((document.getElementById('open-export') as HTMLButtonElement).disabled).toBe(false);
  expect(document.getElementById('current-dataset')?.textContent).toBe('profiles.tsv');
});

it('preserves the current tree on invalid initial settings and allows the setting to be turned off', async () => {
  const { shell, workbench, level, enabled, status } = initialConnections();
  enabled.checked = false;
  await shell.renderCurrentInput();
  enabled.checked = true;
  level.value = '1.5';
  await shell.renderCurrentInput();
  expect(workbench.loadGraph).toHaveBeenCalledOnce();
  expect(status.textContent).toContain('nonnegative whole number');
  expect(document.getElementById('current-dataset')?.textContent).toBe('profiles.tsv');
  expect((document.getElementById('open-export') as HTMLButtonElement).disabled).toBe(false);
  enabled.checked = false;
  enabled.dispatchEvent(new Event('change'));
  await shell.renderCurrentInput();
  expect(workbench.loadGraph).toHaveBeenCalledTimes(2);
  expect(workbench.setDistanceConnections).not.toHaveBeenCalled();
});
