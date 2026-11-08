import { setupUiShellHarness } from './harness';
import { workbenchFake as makeFakeWorkbench } from '../doubles/workbenchFake';
import { decodeApiMetadata } from '../../src/ancillary/apiMetadata';
import { expect, it, vi } from 'vitest';
import { setInputFiles } from '../helpers/inputFiles';
const uiShell = setupUiShellHarness();

describe('uiShell', () => {
  it('starts each dataset from its explicit mapping and clears old metadata coloring', async () => {
    const form = document.createElement('form');
    const input = document.createElement('textarea');
    const ancillaryInput = document.createElement('textarea');
    const select = document.createElement('select');
    select.multiple = true;
    input.value = '(A,B)Root;';
    ancillaryInput.value = JSON.stringify({ ancillary_schema: [], visual_mapping: { colorField: 'country' } });
    const workbench = makeFakeWorkbench({
      nodes: [{ id: 'a', x: 0, y: 0, attributes: { annotations: decodeApiMetadata({ country: 'Portugal' }) } }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    const shell = uiShell({
      workbench,
      elements: {
        form,
        newickInput: input,
        ancillaryInput,
        ancillaryFieldSelect: select,
        status: document.createElement('div'),
      },
    });
    shell.mount();
    await shell.renderCurrentInput();
    expect(select.value).toBe('country');
    expect(workbench.loadGraph).toHaveBeenLastCalledWith(
      { content: '(A,B)Root;', datasetName: undefined, format: 'newick' },
      expect.objectContaining({ visualMapping: expect.objectContaining({ colorField: 'country' }) })
    );
    ancillaryInput.value = '';
    await shell.renderCurrentInput();
    expect(select.value).toBe('');
    expect(workbench.loadGraph).toHaveBeenLastCalledWith(
      { content: '(A,B)Root;', datasetName: undefined, format: 'newick' },
      expect.objectContaining({ visualMapping: {} })
    );
    shell.unmount();
  });

  it('updates status after successful render', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: 'root', x: 0, y: 0 }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 0,
        lodTierCount: 3,
        sliceNodeCount: 1,
        zoom: 4,
      },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(status.textContent).toContain('Rendered');
    expect(status.textContent).toContain('1 symbol drawn');
    expect(status.textContent).toContain('detail level 1/3');
    expect(status.textContent).not.toContain('LoD zoom');
    shell.unmount();
  });

  it('warns in the status line when the layout is degraded', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: 'root', x: 0, y: 0 }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 0,
        sliceNodeCount: 1,
        layoutStatus: 'degraded',
      },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    // Still reports the render, but appends the degraded-layout warning so a
    // legacy persisted layouts remain visibly marked for host applications.
    expect(status.textContent).toContain('Rendered');
    expect(status.textContent).toContain('earlier service version');
    shell.unmount();
  });

  it('surfaces prepare warnings in the rendered status line', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: 'root', x: 0, y: 0 }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 0,
        sliceNodeCount: 1,
        layoutStatus: 'ready',
        layoutWarnings: ['Newick input contains 761 disconnected components; kept as a forest.'],
      },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(status.textContent).toContain('Rendered');
    expect(status.textContent).toContain('761 disconnected components');
    shell.unmount();
  });

  it('shows failure status on empty Newick input', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '   ';

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(status.textContent).toContain('Failed');
    expect(fakeWorkbench.loadGraph).not.toHaveBeenCalled();
    shell.unmount();
  });

  it('shows failure status on invalid ancillary JSON', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <textarea id="ancillary-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const ancillary = document.getElementById('ancillary-input') as HTMLTextAreaElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';
    ancillary.value = '{';

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        ancillaryInput: ancillary,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(status.textContent).toContain('Failed');
    expect(fakeWorkbench.loadGraph).not.toHaveBeenCalled();
    shell.unmount();
  });

  it('forwards LoD controls to the workbench render request', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="max-nodes" type="number" />
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const maxNodesInput = document.getElementById('max-nodes') as HTMLInputElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';
    maxNodesInput.value = '2400';

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: 'root', x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 1 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
        maxNodesInput,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(fakeWorkbench.loadGraph).toHaveBeenCalledWith(
      { content: '(A,B)Root;', datasetName: undefined, format: 'newick' },
      expect.objectContaining({
        lod: expect.objectContaining({
          maxNodes: 2400,
        }),
      })
    );
    shell.unmount();
  });

  it('forwards uploaded Newick and ancillary table files', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="newick-file" type="file" />
      <input id="ancillary-file" type="file" />
      <input id="ancillary-join-column" type="text" />
      <select id="ancillary-format">
        <option value="auto">Auto</option>
        <option value="tsv">TSV</option>
      </select>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const newickFileInput = document.getElementById('newick-file') as HTMLInputElement;
    const ancillaryFileInput = document.getElementById('ancillary-file') as HTMLInputElement;
    const ancillaryJoinColumnInput = document.getElementById('ancillary-join-column') as HTMLInputElement;
    const ancillaryFormatSelect = document.getElementById('ancillary-format') as HTMLSelectElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(Ignored:1)Root;';
    ancillaryJoinColumnInput.value = 'isolate';
    ancillaryFormatSelect.value = 'tsv';
    setInputFiles(newickFileInput, [new File(['(P09:0.1,P12:0.2)Root;'], 'tree.nwk')]);
    setInputFiles(ancillaryFileInput, [new File(['isolate\tcountry\nP09\tUnknown\n'], 'isolates.tsv')]);

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: 'p09', x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        newickFileInput,
        ancillaryFileInput,
        ancillaryJoinColumnInput,
        ancillaryFormatSelect,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(fakeWorkbench.loadGraph).toHaveBeenCalledWith(
      { content: '(P09:0.1,P12:0.2)Root;', datasetName: undefined, format: 'newick' },
      expect.objectContaining({
        ancillaryData: {
          content: 'isolate\tcountry\nP09\tUnknown\n',
          joinColumn: 'isolate',
          format: 'tsv',
        },
      })
    );
    shell.unmount();
  });

  it('forwards typing data with the typing_data source format', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="newick-file" type="file" />
      <input id="typing-file" type="file" />
      <select id="source-format">
        <option value="newick">Newick tree</option>
        <option value="typing_data">Typing data</option>
      </select>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const newickFileInput = document.getElementById('newick-file') as HTMLInputElement;
    const typingFileInput = document.getElementById('typing-file') as HTMLInputElement;
    const sourceFormatSelect = document.getElementById('source-format') as HTMLSelectElement;
    const status = document.getElementById('status') as HTMLElement;

    sourceFormatSelect.value = 'typing_data';
    setInputFiles(typingFileInput, [new File(['ST\tgene1\tgene2\n1\t1\t2\n'], 'profiles.tsv')]);

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: '1', x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        newickFileInput,
        typingFileInput,
        sourceFormatSelect,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(fakeWorkbench.loadGraph).toHaveBeenCalledWith(
      { content: 'ST\tgene1\tgene2\n1\t1\t2', datasetName: undefined, format: 'typing_data' },
      expect.objectContaining({})
    );
    shell.unmount();
  });
});

it('applies an uploaded table to the current tree without submitting the render form', async () => {
  document.body.innerHTML = `<form></form><textarea>(A,B)Root;</textarea><input id="file" type="file" /><input id="join" value="id" /><button type="button"></button><div id="status"></div>`;
  const form = document.querySelector('form')!;
  const newickInput = document.querySelector('textarea')!;
  const ancillaryFileInput = document.querySelector<HTMLInputElement>('#file')!;
  const ancillaryJoinColumnInput = document.querySelector<HTMLInputElement>('#join')!;
  const applyAncillaryButton = document.querySelector('button')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const workbench = makeFakeWorkbench();
  workbench.applyAncillaryData = vi.fn().mockResolvedValue({ matchedNodeCount: 2, warnings: [] });
  const shell = uiShell({
    workbench,
    elements: { form, newickInput, ancillaryFileInput, ancillaryJoinColumnInput, applyAncillaryButton, status },
  });
  shell.mount();
  expect(applyAncillaryButton.disabled).toBe(true);
  await shell.renderCurrentInput();
  expect(applyAncillaryButton.disabled).toBe(false);
  const content = 'id,country\nA,PT\nB,CA';
  setInputFiles(ancillaryFileInput, [new File([content], 'metadata.csv')]);
  applyAncillaryButton.click();
  expect(applyAncillaryButton.disabled).toBe(true);
  await vi.waitFor(() => expect(status.textContent).toContain('Applied ancillary data to 2 nodes'));
  expect(workbench.applyAncillaryData).toHaveBeenCalledWith({ content, joinColumn: 'id', format: 'csv' });
  expect(workbench.loadGraph).toHaveBeenCalledTimes(1);
  expect(applyAncillaryButton.disabled).toBe(false);
  shell.unmount();
});
