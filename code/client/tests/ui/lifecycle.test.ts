import { setupUiShellHarness } from './harness';
import { workbenchFake as makeFakeWorkbench } from '../doubles/workbenchFake';
import { expect, it, vi } from 'vitest';
import { deferred } from '../helpers/state';
import { setInputFiles } from '../helpers/inputFiles';
const uiShell = setupUiShellHarness();

it('ignores an older source-file read after a newer input has loaded', async () => {
  const workbench = makeFakeWorkbench();
  const input = document.createElement('textarea');
  const fileInput = document.createElement('input');
  const pending = deferred<string>();
  const file = new File(['old'], 'old.nwk');
  vi.spyOn(file, 'text').mockReturnValue(pending.promise);
  setInputFiles(fileInput, [file]);
  const status = document.createElement('div');
  const shell = uiShell({
    workbench,
    elements: { form: document.createElement('form'), newickInput: input, newickFileInput: fileInput, status },
  });
  shell.mount();
  const first = shell.renderCurrentInput();
  setInputFiles(fileInput, []);
  input.value = '(NewA,NewB)NewRoot;';
  await shell.renderCurrentInput();
  const newestStatus = status.textContent;
  pending.resolve('(OldA,OldB)OldRoot;');
  await first;
  expect(workbench.loadGraph).toHaveBeenCalledTimes(1);
  expect(workbench.loadGraph).toHaveBeenCalledWith(
    expect.objectContaining({ content: input.value }),
    expect.anything()
  );
  expect(status.textContent).toBe(newestStatus);
  shell.unmount();
});

it('ignores a pending file read and removes form handlers after unmount', async () => {
  const workbench = makeFakeWorkbench();
  const form = document.createElement('form');
  const input = document.createElement('textarea');
  const fileInput = document.createElement('input');
  const status = document.createElement('div');
  const pending = deferred<string>();
  const file = new File(['old'], 'old.nwk');
  vi.spyOn(file, 'text').mockReturnValue(pending.promise);
  setInputFiles(fileInput, [file]);
  const shell = uiShell({ workbench, elements: { form, newickInput: input, newickFileInput: fileInput, status } });
  shell.mount();
  const load = shell.renderCurrentInput();
  shell.unmount();
  const previousStatus = status.textContent;
  pending.resolve('(A,B)Root;');
  await load;
  expect(workbench.loadGraph).not.toHaveBeenCalled();
  expect(status.textContent).toBe(previousStatus);
  setInputFiles(fileInput, []);
  input.value = '(NewA,NewB)NewRoot;';
  const submit = new Event('submit', { cancelable: true });
  form.dispatchEvent(submit);
  expect(submit.defaultPrevented).toBe(false);
  expect(workbench.loadGraph).not.toHaveBeenCalled();
});

it('releases ancillary field handlers when the shell is unmounted', async () => {
  const workbench = makeFakeWorkbench({
    nodes: [{ id: 'a', x: 0, y: 0, attributes: { metadata: { country: 'Portugal' } } }],
    edges: [],
    viewMeta: { layout: 'server', lodLevel: 0 },
  });
  const input = document.createElement('textarea');
  input.value = '(A,B)Root;';
  const fields = document.createElement('select');
  const shell = uiShell({
    workbench,
    elements: {
      form: document.createElement('form'),
      newickInput: input,
      status: document.createElement('div'),
      ancillaryFieldSelect: fields,
    },
  });
  shell.mount();
  await shell.renderCurrentInput();
  fields.value = 'country';
  fields.dispatchEvent(new Event('change'));
  expect(workbench.updateVisualMapping).toHaveBeenCalledWith(expect.objectContaining({ colorField: 'country' }));
  shell.unmount();
  workbench.updateVisualMapping.mockClear();
  fields.dispatchEvent(new Event('change'));
  expect(workbench.updateVisualMapping).not.toHaveBeenCalled();
});
