import { setupUiShellHarness } from './harness';
import type { GraphWorkbench } from '../../src/app/workbench/graphWorkbench';
import { workbenchFake as makeFakeWorkbench } from '../doubles/workbenchFake';
import { toClusterId } from '../../src/contracts/graph/graphIdentifiers';
import { decodeApiMetadata } from '../../src/ancillary/apiMetadata';
import { expect, it, vi } from 'vitest';
const uiShell = setupUiShellHarness();

describe('uiShell', () => {
  it('synchronizes the automatic-detail checkbox without changing node motion', async () => {
    const form = document.createElement('form');
    const newickInput = document.createElement('textarea');
    newickInput.value = '(A,B)Root;';
    const automaticDetailInput = document.createElement('input');
    automaticDetailInput.type = 'checkbox';
    document.body.append(automaticDetailInput);
    const status = document.createElement('div');
    const workbench = makeFakeWorkbench({
      nodes: [{ id: 'root', x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 1, sliceNodeCount: 1 },
    });
    const shell = uiShell({ workbench, elements: { form, newickInput, automaticDetailInput, status } });
    shell.mount();
    expect(automaticDetailInput.disabled).toBe(true);
    await shell.renderCurrentInput();
    expect(automaticDetailInput.disabled).toBe(false);
    expect(automaticDetailInput.checked).toBe(true);
    automaticDetailInput.click();
    expect(workbench.setLodRefreshPaused).toHaveBeenLastCalledWith(true);
    expect(automaticDetailInput.checked).toBe(false);
    expect(status.textContent).toContain('paused');
    automaticDetailInput.click();
    expect(workbench.setLodRefreshPaused).toHaveBeenLastCalledWith(false);
    expect(automaticDetailInput.checked).toBe(true);
    expect(workbench.setMotionEnabled).not.toHaveBeenCalled();
    shell.unmount();
  });

  it('searches rendered datasets and focuses selected results', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="search-input" type="search" />
      <button id="search-button" type="button">Search</button>
      <div id="search-results"></div>
      <select id="metadata-pie-field"></select>
      <div id="ancillary-wheel"></div>
      <div id="ancillary-selected-node-wheel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchButton = document.getElementById('search-button') as HTMLButtonElement;
    const searchResults = document.getElementById('search-results') as HTMLElement;
    const ancillaryFieldSelect = document.getElementById('metadata-pie-field') as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById('ancillary-wheel') as HTMLElement;
    const ancillarySelectedNodeWheelContainer = document.getElementById('ancillary-selected-node-wheel') as HTMLElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';
    searchInput.value = 'port';

    // Node "a" carries a pre-aggregated country distribution as the server's
    // __category_count__ metadata keys; with the "country" field selected, its
    // focused-node wheel resolves to Portugal 3 / Canada 1 (75% / 25%).
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: {
            annotations: decodeApiMetadata({
              country: 'Portugal;Canada',
              __category_count__country__value__Portugal: 3,
              __category_count__country__value__Canada: 1,
            }),
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const branchRootButton = document.createElement('button');
    const selectionLabel = document.createElement('p');
    const collapseSelected = document.createElement('button');
    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        searchInput,
        searchButton,
        searchResults,
        ancillaryFieldSelect,
        ancillaryWheelContainer,
        ancillarySelectedNodeWheelContainer,
        status,
        branchRootButton,
        expansion: { collapseSelected, selectionLabel },
      },
    });

    shell.mount();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    searchInput.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(fakeWorkbench.loadGraph).not.toHaveBeenCalled();
    await Promise.resolve();

    const resultButton = searchResults.querySelector('.search-result') as HTMLButtonElement;
    expect(fakeWorkbench.searchNodes).toHaveBeenCalledWith({
      query: 'port',
      limit: 25,
    });
    expect(resultButton.textContent).toBe('a');

    // Focusing renders the graph, which populates the pie-field options; select
    // the "country" column (PHYLOViZ charts a field only once chosen) and focus
    // again so the clicked node's wheel resolves to its country distribution.
    resultButton.click();
    await Promise.resolve();
    ancillaryFieldSelect.value = 'country';
    ancillaryFieldSelect.dispatchEvent(new Event('change'));
    resultButton.click();
    await Promise.resolve();

    expect(fakeWorkbench.focusNode).toHaveBeenCalledWith('a', {
      x: 12,
      y: 34,
      clusterId: toClusterId('cluster-a'),
    });
    // Focusing a search result populates the selected-node panel, not the
    // overview wheel or its mode selector.
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain('Portugal');
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain('75.0%');
    expect(status.textContent).toBe('Focused a');
    expect(selectionLabel.textContent).toBe('Selected: a · Leaf node');
    expect(branchRootButton.disabled).toBe(false);
    branchRootButton.click();
    expect(fakeWorkbench.setDragSelection).toHaveBeenLastCalledWith({ kind: 'branch', rootId: 'a' });
    shell.unmount();
  });

  it('enables region-select mode via the toggle', () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <button id="region-select-toggle" type="button" aria-pressed="false">Select region</button>
      <div id="region-selection-panel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const regionSelectToggle = document.getElementById('region-select-toggle') as HTMLButtonElement;
    const regionSelectionPanel = document.getElementById('region-selection-panel') as HTMLElement;
    const status = document.getElementById('status') as HTMLElement;

    const fakeWorkbench = makeFakeWorkbench();
    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        regionSelectToggle,
        regionSelectionPanel,
        status,
      },
    });

    shell.mount();
    // Starts disabled with the empty prompt.
    expect(regionSelectToggle.getAttribute('aria-pressed')).toBe('false');
    expect(regionSelectionPanel.textContent).toContain('Shift+drag');

    regionSelectToggle.click();
    expect(fakeWorkbench.setRegionSelectModeEnabled).toHaveBeenLastCalledWith(true);
    expect(regionSelectToggle.getAttribute('aria-pressed')).toBe('true');

    // Toggling off disables the mode and clears any selection.
    regionSelectToggle.click();
    expect(fakeWorkbench.setRegionSelectModeEnabled).toHaveBeenLastCalledWith(false);
    expect(fakeWorkbench.clearRegionSelection).toHaveBeenCalled();
    expect(regionSelectToggle.getAttribute('aria-pressed')).toBe('false');

    shell.unmount();
  });

  it('populates the region panel with aggregated metadata on selection', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <button id="region-select-toggle" type="button" aria-pressed="false">Select region</button>
      <div id="region-selection-panel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const regionSelectToggle = document.getElementById('region-select-toggle') as HTMLButtonElement;
    const regionSelectionPanel = document.getElementById('region-selection-panel') as HTMLElement;
    const status = document.getElementById('status') as HTMLElement;

    const fakeWorkbench = makeFakeWorkbench() as GraphWorkbench & {
      emitRegionSelected: (bounds: { xmin: number; xmax: number; ymin: number; ymax: number }) => void;
    };
    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        regionSelectToggle,
        regionSelectionPanel,
        status,
      },
    });

    shell.mount();
    fakeWorkbench.emitRegionSelected({
      xmin: 0,
      xmax: 5,
      ymin: 0,
      ymax: 5,
    });
    await vi.waitFor(() => {
      expect(regionSelectionPanel.textContent).toContain('2 nodes selected');
    });

    expect(fakeWorkbench.selectRegion).toHaveBeenCalledWith({
      xmin: 0,
      xmax: 5,
      ymin: 0,
      ymax: 5,
    });
    // Server-aggregated field/value pairs are tabulated.
    expect(regionSelectionPanel.textContent).toContain('country');
    expect(regionSelectionPanel.textContent).toContain('Portugal');
    expect(regionSelectionPanel.textContent).toContain('score');
    expect(status.textContent).toBe('Region selected: 2 nodes');

    shell.unmount();
  });
});

it('enables arrangement-root selection and clears it for the next dataset', async () => {
  const workbench = makeFakeWorkbench({
    nodes: [{ id: 'a', x: 0, y: 0 }],
    edges: [],
    viewMeta: { layout: 'server', lodLevel: 0 },
  });
  workbench.setDragSelection = vi.fn();
  const branchRootButton = document.createElement('button');
  branchRootButton.disabled = true;
  const input = document.createElement('textarea');
  input.value = '(A,B)Root;';
  const shell = uiShell({
    workbench,
    elements: {
      form: document.createElement('form'),
      newickInput: input,
      status: document.createElement('div'),
      branchRootButton,
    },
  });
  shell.mount();
  await shell.renderCurrentInput();
  const select = vi.mocked(workbench.setNodeClickedHandler).mock.calls[0][0]!;
  select({ nodeId: 'a' });
  expect(branchRootButton.disabled).toBe(false);
  branchRootButton.click();
  expect(workbench.setDragSelection).toHaveBeenCalledWith({ kind: 'branch', rootId: 'a' });
  await shell.renderCurrentInput();
  expect(branchRootButton.disabled).toBe(true);
  shell.unmount();
});
