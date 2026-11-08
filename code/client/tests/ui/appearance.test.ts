import { setupUiShellHarness } from './harness';
import type { GraphWorkbench } from '../../src/app/workbench/graphWorkbench';
import type { PositionedGraph } from '../../src/contracts/positioned';
import { workbenchFake as makeFakeWorkbench } from '../doubles/workbenchFake';
import { decodeApiMetadata } from '../../src/ancillary/apiMetadata';
import { expect, it, vi } from 'vitest';
import { setInputFiles } from '../helpers/inputFiles';
const uiShell = setupUiShellHarness();

describe('uiShell', () => {
  it('renders selected metadata field distributions in the wheel', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="show-node-pies" type="checkbox" checked />
      <select id="metadata-pie-field"></select>
      <div id="ancillary-wheel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const ancillaryFieldSelect = document.getElementById('metadata-pie-field') as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById('ancillary-wheel') as HTMLElement;
    const showNodePiesInput = document.getElementById('show-node-pies') as HTMLInputElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B,C)Root;';
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: { annotations: decodeApiMetadata({ country: 'Portugal' }) },
        },
        {
          id: 'b',
          x: 1,
          y: 1,
          attributes: { annotations: decodeApiMetadata({ country: 'Portugal' }) },
        },
        {
          id: 'c',
          x: 2,
          y: 2,
          attributes: { annotations: decodeApiMetadata({ country: 'Canada' }) },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        ancillaryFieldSelect,
        showNodePiesInput,
        ancillaryWheelContainer,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    ancillaryFieldSelect.value = 'country';
    ancillaryFieldSelect.dispatchEvent(new Event('change'));

    expect(fakeWorkbench.updateVisualMapping).toHaveBeenCalledWith({
      colorField: 'country',
      pie: {
        enabled: true,
        fields: ['country'],
      },
    });
    expect([...ancillaryFieldSelect.options].map(option => option.value)).toEqual(['', 'country']);
    expect(ancillaryWheelContainer.textContent).toContain('Portugal');
    expect(ancillaryWheelContainer.textContent).toContain('Canada');
    showNodePiesInput.checked = false;
    showNodePiesInput.dispatchEvent(new Event('change'));
    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith({
      colorField: 'country',
      pie: { enabled: false, fields: ['country'] },
    });
    ancillaryFieldSelect.dispatchEvent(new Event('change'));
    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pie: { enabled: false, fields: ['country'] },
      })
    );
    showNodePiesInput.checked = true;
    showNodePiesInput.dispatchEvent(new Event('change'));
    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pie: { enabled: true, fields: ['country'] },
      })
    );
    shell.unmount();
  });

  it("shows a clicked node's pie data in the selected-node wheel without changing overview mode", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-pie-field"></select>
      <div id="ancillary-wheel"></div>
      <div id="ancillary-selected-node-wheel"></div>
      <div id="status"></div>
    `;

    // Node "a" carries a pre-aggregated per-category distribution (a profile
    // node standing in for several isolates), expressed as the server's
    // __category_count__ metadata keys. With the "country" pie field selected,
    // its clicked-node wheel resolves to Portugal 3 / Canada 1 (75% / 25%).
    const graph: PositionedGraph = {
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
        {
          id: 'b',
          x: 1,
          y: 1,
          attributes: {
            annotations: decodeApiMetadata({
              country: 'Canada',
              __category_count__country__value__Canada: 2,
            }),
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    };
    const fakeWorkbench = makeFakeWorkbench(graph) as GraphWorkbench & {
      emitNodeClick: (nodeId: string) => void;
    };
    const newickInput = document.getElementById('newick-input') as HTMLTextAreaElement;
    newickInput.value = '(A,B)Root;';
    const ancillaryFieldSelect = document.getElementById('metadata-pie-field') as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById('ancillary-wheel') as HTMLElement;
    const ancillarySelectedNodeWheelContainer = document.getElementById('ancillary-selected-node-wheel') as HTMLElement;

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form: document.getElementById('render-form') as HTMLFormElement,
        newickInput,
        ancillaryFieldSelect,
        ancillaryWheelContainer,
        ancillarySelectedNodeWheelContainer,
        status: document.getElementById('status') as HTMLElement,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    // Choose the "country" field (PHYLOViZ charts a column only once selected).
    ancillaryFieldSelect.value = 'country';
    ancillaryFieldSelect.dispatchEvent(new Event('change'));
    fakeWorkbench.emitNodeClick('a');

    // The overview wheel and its mode selector are left untouched by a click.
    // The clicked node's distribution appears in the dedicated second panel.
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain('Portugal');
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain('75.0%');
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain('Ancillary distribution across 1 node');
    shell.unmount();
  });

  it('toggles multiple pie fields with normal option clicks', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-pie-field" multiple></select>
      <div id="ancillary-wheel"></div>
      <div id="palette-controls"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const ancillaryFieldSelect = document.getElementById('metadata-pie-field') as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById('ancillary-wheel') as HTMLElement;
    const paletteControlsContainer = document.getElementById('palette-controls') as HTMLElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: { annotations: decodeApiMetadata({ country: 'Portugal', source: 'blood' }) },
        },
        {
          id: 'b',
          x: 1,
          y: 1,
          attributes: { annotations: decodeApiMetadata({ country: 'Canada', source: 'csf' }) },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });
    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        ancillaryFieldSelect,
        ancillaryWheelContainer,
        paletteControlsContainer,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    const countryOption = [...ancillaryFieldSelect.options].find(
      option => option.value === 'country'
    ) as HTMLOptionElement;
    countryOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const sourceOption = [...ancillaryFieldSelect.options].find(
      option => option.value === 'source'
    ) as HTMLOptionElement;
    sourceOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    const selectedValues = [...ancillaryFieldSelect.selectedOptions].map(option => option.value);
    expect(selectedValues).toEqual(['country', 'source']);
    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith({
      colorField: 'country',
      pie: {
        enabled: true,
        fields: ['country', 'source'],
      },
    });
    shell.unmount();
  });

  it('forwards profile size controls to the visual mapping', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-size-field"><option value="profile_count">Profile count</option></select>
      <select id="metadata-size-scale">
        <option value="linear">Linear</option>
        <option value="log" selected>Logarithmic</option>
      </select>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const ancillarySizeFieldSelect = document.getElementById('metadata-size-field') as HTMLSelectElement;
    const ancillarySizeScaleSelect = document.getElementById('metadata-size-scale') as HTMLSelectElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';
    const fakeWorkbench = makeFakeWorkbench();
    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        ancillarySizeFieldSelect,
        ancillarySizeScaleSelect,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(fakeWorkbench.loadGraph).toHaveBeenCalledWith(
      { content: '(A,B)Root;', datasetName: undefined, format: 'newick' },
      expect.objectContaining({
        visualMapping: {
          size: {
            field: 'profile_count',
            scale: 'log',
          },
        },
      })
    );
    shell.unmount();
  });

  it('forwards category color controls through the visual mapping', async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-pie-field"></select>
      <div id="palette-controls"></div>
      <input id="palette-load-input" type="file" />
      <button id="palette-save-button" type="button"></button>
      <div id="status"></div>
    `;

    const form = document.getElementById('render-form') as HTMLFormElement;
    const input = document.getElementById('newick-input') as HTMLTextAreaElement;
    const ancillaryFieldSelect = document.getElementById('metadata-pie-field') as HTMLSelectElement;
    const paletteControlsContainer = document.getElementById('palette-controls') as HTMLElement;
    const paletteLoadInput = document.getElementById('palette-load-input') as HTMLInputElement;
    const paletteSaveButton = document.getElementById('palette-save-button') as HTMLButtonElement;
    const status = document.getElementById('status') as HTMLElement;

    input.value = '(A,B)Root;';
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: { annotations: decodeApiMetadata({ country: 'Portugal' }) },
        },
        {
          id: 'b',
          x: 1,
          y: 1,
          attributes: { annotations: decodeApiMetadata({ country: 'Canada' }) },
        },
        {
          id: 'c',
          x: 2,
          y: 2,
          attributes: { annotations: decodeApiMetadata({ country: 'Portugal' }) },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });
    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        ancillaryFieldSelect,
        paletteControlsContainer,
        paletteLoadInput,
        paletteSaveButton,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    ancillaryFieldSelect.value = 'country';
    ancillaryFieldSelect.dispatchEvent(new Event('change'));

    const portugalColor = paletteControlsContainer.querySelector<HTMLInputElement>("[data-category-color='Portugal']");
    expect(portugalColor).not.toBeNull();
    portugalColor!.value = '#123456';
    portugalColor!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pie: expect.objectContaining({
          enabled: true,
          fields: ['country'],
          categoryColors: expect.objectContaining({
            Portugal: '#123456',
          }),
        }),
      })
    );

    setInputFiles(paletteLoadInput, [new File(['18,52,86\n171,205,239\n'], 'colors.palette')]);
    paletteLoadInput.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith(
        expect.objectContaining({
          pie: expect.objectContaining({
            categoryColors: expect.objectContaining({
              Portugal: '#123456',
              Canada: '#abcdef',
            }),
          }),
        })
      );
    });

    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: () => 'blob:palette',
      });
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: () => undefined,
      });
    }

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:palette');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    paletteSaveButton.click();

    const savedBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(savedBlob.text()).resolves.toBe('18,52,86\n171,205,239');
    expect(clickAnchor).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:palette');

    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    clickAnchor.mockRestore();
    shell.unmount();
  });

  it('keeps independent display choices and defers invalid label intervals', () => {
    document.body.innerHTML = `
      <form id="render-form"></form><textarea id="newick-input"></textarea>
      <input id="node-labels" type="checkbox" checked />
      <input id="edge-labels" type="checkbox" />
      <input id="weighted" type="checkbox" />
      <fieldset id="bounds"><input id="min" type="number" min="0" /><input id="max" type="number" min="0" /></fieldset>
      <p id="feedback"></p><div id="status"></div>`;
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const settings = document.getElementById('bounds') as HTMLFieldSetElement;
    const feedback = document.getElementById('feedback')!;
    const workbench = makeFakeWorkbench();
    const shell = uiShell({
      workbench,
      elements: {
        form: document.getElementById('render-form') as HTMLFormElement,
        newickInput: document.getElementById('newick-input') as HTMLTextAreaElement,
        status: document.getElementById('status')!,
        nodeLabelsInput: input('node-labels'),
        edgeDistanceLabelsInput: input('edge-labels'),
        distanceWeightedEdgesInput: input('weighted'),
        edgeLabelMinInput: input('min'),
        edgeLabelMaxInput: input('max'),
        edgeLabelSettings: settings,
        edgeLabelFeedback: feedback,
      },
    });
    shell.mount();
    expect(settings.hidden).toBe(true);
    input('edge-labels').click();
    input('weighted').click();
    input('node-labels').click();
    expect(settings.hidden).toBe(false);
    expect(workbench.updateDisplayOptions).toHaveBeenLastCalledWith({
      nodeLabels: false,
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });
    input('min').value = '4';
    input('min').dispatchEvent(new Event('input'));
    workbench.updateDisplayOptions.mockClear();
    input('max').value = '2';
    input('max').dispatchEvent(new Event('input'));
    expect(workbench.updateDisplayOptions).not.toHaveBeenCalled();
    expect(feedback.textContent).toContain('Maximum must be at least minimum');
    input('max').value = '8';
    input('max').dispatchEvent(new Event('input'));
    expect(feedback.textContent).toBe('');
    expect(workbench.updateDisplayOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        edgeDistanceLabelMin: 4,
        edgeDistanceLabelMax: 8,
      })
    );
    input('edge-labels').click();
    expect(settings.hidden).toBe(true);
    expect(settings.disabled).toBe(true);
    expect(input('min').value).toBe('4');
    expect(input('weighted').checked).toBe(true);
    shell.unmount();
    workbench.updateDisplayOptions.mockClear();
    input('weighted').click();
    expect(workbench.updateDisplayOptions).not.toHaveBeenCalled();
  });
});
