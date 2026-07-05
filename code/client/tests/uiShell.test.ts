import { UiShellController } from "../src/app/uiShell";
import type { GraphWorkbench } from "../src/app/workbench/graphWorkbench";
import type { PositionedGraph } from "../src/contracts/positioned";

function makeFakeWorkbench(
  renderedGraph: PositionedGraph = {
    nodes: [],
    edges: [],
    viewMeta: { layout: "force", lodLevel: 0 },
  },
) {
  let graphRenderedHandler: ((graph: PositionedGraph) => void) | null = null;
  let nodeClickedHandler: ((state: { nodeId: string }) => void) | null = null;
  let lodRefreshPaused = false;

  return {
    renderNewick: vi.fn(async () => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    updateVisualMapping: vi.fn(() => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    updateDisplayOptions: vi.fn(),
    setLodRefreshPaused: vi.fn(async (paused: boolean) => {
      lodRefreshPaused = paused;
      return renderedGraph;
    }),
    isLodRefreshPaused: vi.fn(() => lodRefreshPaused),
    searchNodes: vi.fn(async () => ({
      dataset_id: "fixture-tree",
      query: "port",
      matches: [
        {
          node_id: "a",
          score: 8,
          matched_text: "a Portugal",
          metadata: { country: "Portugal" },
        },
      ],
      total_count: 1,
    })),
    focusNode: vi.fn(async () => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    setGraphRenderedHandler: vi.fn((handler) => {
      graphRenderedHandler = handler;
    }),
    setNodeClickedHandler: vi.fn((handler) => {
      nodeClickedHandler = handler;
    }),
    emitNodeClick: (nodeId: string) => {
      nodeClickedHandler?.({ nodeId });
    },
    dispose: vi.fn(),
  } as unknown as GraphWorkbench;
}

describe("uiShell", () => {
  it("updates status after successful render", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "root", x: 0, y: 0 }],
      edges: [],
      viewMeta: {
        layout: "force",
        lodLevel: 0,
        sliceNodeCount: 1,
        zoom: 4,
      },
    });

    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(status.textContent).toContain("Rendered");
    expect(status.textContent).toContain("slice 1 nodes");
    expect(status.textContent).toContain("rendered depth 0");
    expect(status.textContent).toContain("LoD zoom 4.00");
    shell.unmount();
  });

  it("shows failure status on empty Newick input", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "   ";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(status.textContent).toContain("Failed");
    expect(fakeWorkbench.renderNewick).not.toHaveBeenCalled();
    shell.unmount();
  });

  it("shows failure status on invalid ancillary JSON", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <textarea id="ancillary-input"></textarea>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const ancillary = document.getElementById(
      "ancillary-input",
    ) as HTMLTextAreaElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    ancillary.value = "{";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const shell = new UiShellController({
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

    expect(status.textContent).toContain("Failed");
    expect(fakeWorkbench.renderNewick).not.toHaveBeenCalled();
    shell.unmount();
  });

  it("forwards LoD controls to the workbench render request", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="max-nodes" type="number" />
      <input id="initial-zoom" type="number" />
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const maxNodesInput = document.getElementById(
      "max-nodes",
    ) as HTMLInputElement;
    const initialZoomInput = document.getElementById(
      "initial-zoom",
    ) as HTMLInputElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    maxNodesInput.value = "2400";
    initialZoomInput.value = "3.5";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "root", x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 1 },
    });

    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        status,
        maxNodesInput,
        initialZoomInput,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(fakeWorkbench.renderNewick).toHaveBeenCalledWith(
      "(A,B)Root;",
      undefined,
      expect.objectContaining({
        lod: expect.objectContaining({
          maxNodes: 2400,
          zoom: 3.5,
        }),
      }),
    );
    shell.unmount();
  });

  it("forwards uploaded Newick and ancillary table files", async () => {
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

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const newickFileInput = document.getElementById(
      "newick-file",
    ) as HTMLInputElement;
    const ancillaryFileInput = document.getElementById(
      "ancillary-file",
    ) as HTMLInputElement;
    const ancillaryJoinColumnInput = document.getElementById(
      "ancillary-join-column",
    ) as HTMLInputElement;
    const ancillaryFormatSelect = document.getElementById(
      "ancillary-format",
    ) as HTMLSelectElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(Ignored:1)Root;";
    ancillaryJoinColumnInput.value = "isolate";
    ancillaryFormatSelect.value = "tsv";
    setInputFiles(newickFileInput, [
      new File(["(P09:0.1,P12:0.2)Root;"], "tree.nwk"),
    ]);
    setInputFiles(ancillaryFileInput, [
      new File(["isolate\tcountry\nP09\tUnknown\n"], "isolates.tsv"),
    ]);

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "p09", x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const shell = new UiShellController({
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

    expect(fakeWorkbench.renderNewick).toHaveBeenCalledWith(
      "(P09:0.1,P12:0.2)Root;",
      undefined,
      expect.objectContaining({
        ancillaryData: {
          content: "isolate\tcountry\nP09\tUnknown\n",
          join_column: "isolate",
          format: "tsv",
        },
      }),
    );
    shell.unmount();
  });

  it("renders selected metadata field distributions in the wheel", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-pie-field"></select>
      <div id="ancillary-wheel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const metadataPieFieldSelect = document.getElementById(
      "metadata-pie-field",
    ) as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById(
      "ancillary-wheel",
    ) as HTMLElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B,C)Root;";
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: { metadata: { country: "Portugal" } },
        },
        {
          id: "b",
          x: 1,
          y: 1,
          attributes: { metadata: { country: "Portugal" } },
        },
        {
          id: "c",
          x: 2,
          y: 2,
          attributes: { metadata: { country: "Canada" } },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        metadataPieFieldSelect,
        ancillaryWheelContainer,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    metadataPieFieldSelect.value = "country";
    metadataPieFieldSelect.dispatchEvent(new Event("change"));

    expect(fakeWorkbench.updateVisualMapping).toHaveBeenCalledWith({
      pie: {
        enabled: true,
        fields: ["country"],
      },
    });
    expect([...metadataPieFieldSelect.options].map((option) => option.value)).toEqual([
      "",
      "country",
    ]);
    expect(ancillaryWheelContainer.textContent).toContain("Portugal");
    expect(ancillaryWheelContainer.textContent).toContain("Canada");
    shell.unmount();
  });

  it("shows a clicked node's pie data in the ancillary wheel", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="ancillary-mode">
        <option value="global">Global</option>
        <option value="selected">Selected node</option>
      </select>
      <select id="ancillary-node"></select>
      <div id="ancillary-wheel"></div>
      <div id="status"></div>
    `;

    const graph: PositionedGraph = {
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            pie__Portugal: 3,
            pie__Canada: 1,
          },
        },
        {
          id: "b",
          x: 1,
          y: 1,
          attributes: { pie__Canada: 2 },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    };
    const fakeWorkbench = makeFakeWorkbench(graph) as GraphWorkbench & {
      emitNodeClick: (nodeId: string) => void;
    };
    const newickInput = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    newickInput.value = "(A,B)Root;";
    const ancillaryModeSelect = document.getElementById(
      "ancillary-mode",
    ) as HTMLSelectElement;
    const ancillaryNodeSelect = document.getElementById(
      "ancillary-node",
    ) as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById(
      "ancillary-wheel",
    ) as HTMLElement;

    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form: document.getElementById("render-form") as HTMLFormElement,
        newickInput,
        ancillaryModeSelect,
        ancillaryNodeSelect,
        ancillaryWheelContainer,
        status: document.getElementById("status") as HTMLElement,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    fakeWorkbench.emitNodeClick("a");

    expect(ancillaryModeSelect.value).toBe("selected");
    expect(ancillaryNodeSelect.value).toBe("a");
    expect(ancillaryNodeSelect.disabled).toBe(false);
    expect(ancillaryWheelContainer.textContent).toContain("Portugal");
    expect(ancillaryWheelContainer.textContent).toContain("75.0%");
    expect(ancillaryWheelContainer.textContent).toContain(
      "Ancillary distribution across 1 node",
    );
    shell.unmount();
  });

  it("toggles multiple pie fields with normal option clicks", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-pie-field" multiple></select>
      <div id="ancillary-wheel"></div>
      <div id="palette-controls"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const metadataPieFieldSelect = document.getElementById(
      "metadata-pie-field",
    ) as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById(
      "ancillary-wheel",
    ) as HTMLElement;
    const paletteControlsContainer = document.getElementById(
      "palette-controls",
    ) as HTMLElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: { metadata: { country: "Portugal", source: "blood" } },
        },
        {
          id: "b",
          x: 1,
          y: 1,
          attributes: { metadata: { country: "Canada", source: "csf" } },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });
    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        metadataPieFieldSelect,
        ancillaryWheelContainer,
        paletteControlsContainer,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    const countryOption = [...metadataPieFieldSelect.options].find(
      (option) => option.value === "country",
    ) as HTMLOptionElement;
    countryOption.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const sourceOption = [...metadataPieFieldSelect.options].find(
      (option) => option.value === "source",
    ) as HTMLOptionElement;
    sourceOption.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    const selectedValues = [...metadataPieFieldSelect.selectedOptions].map(
      (option) => option.value,
    );
    expect(selectedValues).toEqual(["country", "source"]);
    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith({
      pie: {
        enabled: true,
        fields: ["country", "source"],
      },
    });
    shell.unmount();
  });

  it("forwards profile size controls to the visual mapping", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="metadata-size-field" type="text" value="profile_count" />
      <select id="metadata-size-scale">
        <option value="linear">Linear</option>
        <option value="log" selected>Logarithmic</option>
      </select>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const metadataSizeFieldInput = document.getElementById(
      "metadata-size-field",
    ) as HTMLInputElement;
    const metadataSizeScaleSelect = document.getElementById(
      "metadata-size-scale",
    ) as HTMLSelectElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    const fakeWorkbench = makeFakeWorkbench();
    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        metadataSizeFieldInput,
        metadataSizeScaleSelect,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(fakeWorkbench.renderNewick).toHaveBeenCalledWith(
      "(A,B)Root;",
      undefined,
      expect.objectContaining({
        visualMapping: {
          size: {
            field: "profile_count",
            scale: "log",
          },
        },
      }),
    );
    shell.unmount();
  });

  it("forwards category color controls through the visual mapping", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="metadata-pie-field"></select>
      <div id="palette-controls"></div>
      <input id="palette-load-input" type="file" />
      <button id="palette-save-button" type="button"></button>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const metadataPieFieldSelect = document.getElementById(
      "metadata-pie-field",
    ) as HTMLSelectElement;
    const paletteControlsContainer = document.getElementById(
      "palette-controls",
    ) as HTMLElement;
    const paletteLoadInput = document.getElementById(
      "palette-load-input",
    ) as HTMLInputElement;
    const paletteSaveButton = document.getElementById(
      "palette-save-button",
    ) as HTMLButtonElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: { metadata: { country: "Portugal" } },
        },
        {
          id: "b",
          x: 1,
          y: 1,
          attributes: { metadata: { country: "Canada" } },
        },
        {
          id: "c",
          x: 2,
          y: 2,
          attributes: { metadata: { country: "Portugal" } },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });
    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        metadataPieFieldSelect,
        paletteControlsContainer,
        paletteLoadInput,
        paletteSaveButton,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    metadataPieFieldSelect.value = "country";
    metadataPieFieldSelect.dispatchEvent(new Event("change"));

    const portugalColor =
      paletteControlsContainer.querySelector<HTMLInputElement>(
        "[data-category-color='Portugal']",
      );
    expect(portugalColor).not.toBeNull();
    portugalColor!.value = "#123456";
    portugalColor!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pie: expect.objectContaining({
          enabled: true,
          fields: ["country"],
          categoryColors: expect.objectContaining({
            Portugal: "#123456",
          }),
        }),
      }),
    );

    setInputFiles(paletteLoadInput, [
      new File(["18,52,86\n171,205,239\n"], "colors.palette"),
    ]);
    paletteLoadInput.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(fakeWorkbench.updateVisualMapping).toHaveBeenLastCalledWith(
        expect.objectContaining({
          pie: expect.objectContaining({
            categoryColors: expect.objectContaining({
              Portugal: "#123456",
              Canada: "#abcdef",
            }),
          }),
        }),
      );
    });

    if (!URL.createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: () => "blob:palette",
      });
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: () => undefined,
      });
    }

    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:palette");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickAnchor = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    paletteSaveButton.click();

    const savedBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(savedBlob.text()).resolves.toBe("18,52,86\n171,205,239");
    expect(clickAnchor).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:palette");

    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    clickAnchor.mockRestore();
    shell.unmount();
  });

  it("forwards display option selector changes to the workbench", () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="display-options" multiple>
        <option value="node-labels" selected>Node labels</option>
        <option value="edge-distance-labels">Edge distance labels</option>
        <option value="distance-weighted-edges">Distance-weighted edges</option>
      </select>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const displayOptionsSelect = document.getElementById(
      "display-options",
    ) as HTMLSelectElement;
    const status = document.getElementById("status") as HTMLElement;

    const fakeWorkbench = makeFakeWorkbench();
    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        displayOptionsSelect,
        status,
      },
    });

    shell.mount();
    displayOptionsSelect.options[1]!.selected = true;
    displayOptionsSelect.options[2]!.selected = true;
    displayOptionsSelect.dispatchEvent(new Event("change"));

    expect(fakeWorkbench.updateDisplayOptions).toHaveBeenLastCalledWith({
      nodeLabels: true,
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });
    shell.unmount();
  });

  it("toggles display selector options independently on click", () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="display-options" multiple>
        <option value="node-labels" selected>Node labels</option>
        <option value="edge-distance-labels">Edge distance labels</option>
        <option value="distance-weighted-edges">Distance-weighted edges</option>
      </select>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const displayOptionsSelect = document.getElementById(
      "display-options",
    ) as HTMLSelectElement;
    const status = document.getElementById("status") as HTMLElement;

    const fakeWorkbench = makeFakeWorkbench();
    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        displayOptionsSelect,
        status,
      },
    });

    shell.mount();
    displayOptionsSelect.options[1]!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    displayOptionsSelect.options[2]!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(displayOptionsSelect.options[0]!.selected).toBe(true);
    expect(displayOptionsSelect.options[1]!.selected).toBe(true);
    expect(displayOptionsSelect.options[2]!.selected).toBe(true);
    expect(fakeWorkbench.updateDisplayOptions).toHaveBeenLastCalledWith({
      nodeLabels: true,
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });

    displayOptionsSelect.options[1]!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(displayOptionsSelect.options[0]!.selected).toBe(true);
    expect(displayOptionsSelect.options[1]!.selected).toBe(false);
    expect(displayOptionsSelect.options[2]!.selected).toBe(true);
    expect(fakeWorkbench.updateDisplayOptions).toHaveBeenLastCalledWith({
      nodeLabels: true,
      edgeDistanceLabels: false,
      distanceWeightedEdges: true,
    });

    shell.unmount();
  });

  it("toggles LoD playback controls for rendered LoD graphs", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <button id="lod-play-button" type="button"></button>
      <button id="lod-pause-button" type="button"></button>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const lodPlayButton = document.getElementById(
      "lod-play-button",
    ) as HTMLButtonElement;
    const lodPauseButton = document.getElementById(
      "lod-pause-button",
    ) as HTMLButtonElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "root", x: 0, y: 0 }],
      edges: [],
      viewMeta: {
        layout: "server",
        lodLevel: 1,
        sliceNodeCount: 1,
      },
    });
    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        lodPlayButton,
        lodPauseButton,
        status,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();

    expect(lodPlayButton.disabled).toBe(true);
    expect(lodPauseButton.disabled).toBe(false);

    lodPauseButton.click();
    await Promise.resolve();

    expect(fakeWorkbench.setLodRefreshPaused).toHaveBeenLastCalledWith(true);
    expect(lodPlayButton.disabled).toBe(false);
    expect(lodPauseButton.disabled).toBe(true);
    expect(status.textContent).toContain("LoD paused");

    lodPlayButton.click();
    await Promise.resolve();

    expect(fakeWorkbench.setLodRefreshPaused).toHaveBeenLastCalledWith(false);
    expect(lodPlayButton.disabled).toBe(true);
    expect(lodPauseButton.disabled).toBe(false);

    shell.unmount();
  });

  it("searches rendered datasets and focuses selected results", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="search-input" type="search" />
      <button id="search-button" type="button">Search</button>
      <div id="search-results"></div>
      <select id="ancillary-mode">
        <option value="global">Global</option>
        <option value="selected">Selected node</option>
      </select>
      <select id="ancillary-node"></select>
      <div id="ancillary-wheel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const searchInput = document.getElementById(
      "search-input",
    ) as HTMLInputElement;
    const searchButton = document.getElementById(
      "search-button",
    ) as HTMLButtonElement;
    const searchResults = document.getElementById(
      "search-results",
    ) as HTMLElement;
    const ancillaryModeSelect = document.getElementById(
      "ancillary-mode",
    ) as HTMLSelectElement;
    const ancillaryNodeSelect = document.getElementById(
      "ancillary-node",
    ) as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById(
      "ancillary-wheel",
    ) as HTMLElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    searchInput.value = "port";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            pie__Portugal: 3,
            pie__Canada: 1,
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const shell = new UiShellController({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        searchInput,
        searchButton,
        searchResults,
        ancillaryModeSelect,
        ancillaryNodeSelect,
        ancillaryWheelContainer,
        status,
      },
    });

    shell.mount();
    searchButton.click();
    await Promise.resolve();

    const resultButton = searchResults.querySelector(
      ".search-result",
    ) as HTMLButtonElement;
    expect(fakeWorkbench.searchNodes).toHaveBeenCalledWith({
      query: "port",
      limit: 25,
    });
    expect(resultButton.textContent).toBe("a");

    resultButton.click();
    await Promise.resolve();

    expect(fakeWorkbench.focusNode).toHaveBeenCalledWith("a");
    expect(ancillaryModeSelect.value).toBe("selected");
    expect(ancillaryNodeSelect.value).toBe("a");
    expect(ancillaryWheelContainer.textContent).toContain("Portugal");
    expect(ancillaryWheelContainer.textContent).toContain("75.0%");
    expect(status.textContent).toBe("Focused a");
    shell.unmount();
  });
});

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}
