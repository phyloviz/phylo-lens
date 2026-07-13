import { describe, expect, it, vi } from "vitest";

import uiShell from "../src/app/uiShell";
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
  let nodeClickedHandler: ((state: { nodeId: string | null }) => void) | null = null;
  let regionSelectedHandler:
    | ((bounds: {
        xmin: number;
        xmax: number;
        ymin: number;
        ymax: number;
      }) => void)
    | null = null;
  let lodRefreshPaused = false;
  let regionSelectModeEnabled = false;

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
          cluster_id: "cluster-a",
          x: 12,
          y: 34,
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
    setRegionSelectModeEnabled: vi.fn((enabled: boolean) => {
      regionSelectModeEnabled = enabled;
    }),
    isRegionSelectModeEnabled: () => regionSelectModeEnabled,
    selectRegion: vi.fn(async () => ({
      nodeIds: ["a", "b"],
      nodeCount: 2,
      truncated: false,
      aggregatedMetadata: { country: "Portugal", score: 4 },
      metadataSchema: [],
    })),
    setRegionSelectedHandler: vi.fn((handler) => {
      regionSelectedHandler = handler;
    }),
    clearRegionSelection: vi.fn(),
    emitNodeClick: (nodeId: string) => {
      nodeClickedHandler?.({ nodeId });
    },
    emitRegionSelected: (bounds: {
      xmin: number;
      xmax: number;
      ymin: number;
      ymax: number;
    }) => {
      regionSelectedHandler?.(bounds);
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
        layout: "server",
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

    expect(status.textContent).toContain("Rendered");
    expect(status.textContent).toContain("slice 1 nodes");
    // Tier is 1-based: lodLevel 0 of 3 tiers reads "LoD tier 1/3", making a
    // semantic-zoom transition observable in the status bar.
    expect(status.textContent).toContain("LoD tier 1/3");
    expect(status.textContent).toContain("LoD zoom 4.00");
    shell.unmount();
  });

  it("warns in the status line when the layout is degraded", async () => {
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
        layout: "server",
        lodLevel: 0,
        sliceNodeCount: 1,
        layoutStatus: "degraded",
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
    // topology-ignoring circular fallback is not mistaken for a real layout.
    expect(status.textContent).toContain("Rendered");
    expect(status.textContent).toContain("Degraded layout");
    shell.unmount();
  });

  it("surfaces prepare warnings in the rendered status line", async () => {
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
        layout: "server",
        lodLevel: 0,
        sliceNodeCount: 1,
        layoutStatus: "ready",
        layoutWarnings: [
          "Newick input contains 761 disconnected components; kept as a forest.",
        ],
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

    expect(status.textContent).toContain("Rendered");
    expect(status.textContent).toContain("761 disconnected components");
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

    expect(status.textContent).toContain("Failed");
    expect(fakeWorkbench.renderNewick).not.toHaveBeenCalled();
    shell.unmount();
  });

  it("forwards LoD controls to the workbench render request", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="max-nodes" type="number" />
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const maxNodesInput = document.getElementById(
      "max-nodes",
    ) as HTMLInputElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    maxNodesInput.value = "2400";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "root", x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 1 },
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

    expect(fakeWorkbench.renderNewick).toHaveBeenCalledWith(
      "(A,B)Root;",
      undefined,
      expect.objectContaining({
        lod: expect.objectContaining({
          maxNodes: 2400,
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

  it("forwards typing data with the typing_data source format", async () => {
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

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const newickFileInput = document.getElementById(
      "newick-file",
    ) as HTMLInputElement;
    const typingFileInput = document.getElementById(
      "typing-file",
    ) as HTMLInputElement;
    const sourceFormatSelect = document.getElementById(
      "source-format",
    ) as HTMLSelectElement;
    const status = document.getElementById("status") as HTMLElement;

    sourceFormatSelect.value = "typing_data";
    setInputFiles(typingFileInput, [
      new File(["ST\tgene1\tgene2\n1\t1\t2\n"], "profiles.tsv"),
    ]);

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "1", x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
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

    expect(fakeWorkbench.renderNewick).toHaveBeenCalledWith(
      "ST\tgene1\tgene2\n1\t1\t2",
      undefined,
      expect.objectContaining({ sourceFormat: "typing_data" }),
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

    const shell = uiShell({
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
      colorField: "country",
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

  it("shows a clicked node's pie data in the selected-node wheel without changing overview mode", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <select id="ancillary-mode">
        <option value="global">Global</option>
        <option value="selected">Selected node</option>
      </select>
      <select id="ancillary-node"></select>
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
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            metadata: {
              country: "Portugal;Canada",
              __category_count__country__value__Portugal: 3,
              __category_count__country__value__Canada: 1,
            },
          },
        },
        {
          id: "b",
          x: 1,
          y: 1,
          attributes: {
            metadata: {
              country: "Canada",
              __category_count__country__value__Canada: 2,
            },
          },
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
    const metadataPieFieldSelect = document.getElementById(
      "metadata-pie-field",
    ) as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById(
      "ancillary-wheel",
    ) as HTMLElement;
    const ancillarySelectedNodeWheelContainer = document.getElementById(
      "ancillary-selected-node-wheel",
    ) as HTMLElement;

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form: document.getElementById("render-form") as HTMLFormElement,
        newickInput,
        ancillaryModeSelect,
        ancillaryNodeSelect,
        metadataPieFieldSelect,
        ancillaryWheelContainer,
        ancillarySelectedNodeWheelContainer,
        status: document.getElementById("status") as HTMLElement,
      },
    });

    shell.mount();
    await shell.renderCurrentInput();
    // Choose the "country" field (PHYLOViZ charts a column only once selected).
    metadataPieFieldSelect.value = "country";
    metadataPieFieldSelect.dispatchEvent(new Event("change"));
    fakeWorkbench.emitNodeClick("a");

    // The overview wheel and its mode selector are left untouched by a click.
    expect(ancillaryModeSelect.value).toBe("global");
    // The clicked node's distribution appears in the dedicated second panel.
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain(
      "Portugal",
    );
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain("75.0%");
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain(
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
    const shell = uiShell({
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
      colorField: "country",
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
    const shell = uiShell({
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
    const shell = uiShell({
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
    const shell = uiShell({
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
    const shell = uiShell({
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
    const shell = uiShell({
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
      <select id="metadata-pie-field"></select>
      <div id="ancillary-wheel"></div>
      <div id="ancillary-selected-node-wheel"></div>
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
    const metadataPieFieldSelect = document.getElementById(
      "metadata-pie-field",
    ) as HTMLSelectElement;
    const ancillaryWheelContainer = document.getElementById(
      "ancillary-wheel",
    ) as HTMLElement;
    const ancillarySelectedNodeWheelContainer = document.getElementById(
      "ancillary-selected-node-wheel",
    ) as HTMLElement;
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    searchInput.value = "port";

    // Node "a" carries a pre-aggregated country distribution as the server's
    // __category_count__ metadata keys; with the "country" field selected, its
    // focused-node wheel resolves to Portugal 3 / Canada 1 (75% / 25%).
    const fakeWorkbench = makeFakeWorkbench({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            metadata: {
              country: "Portugal;Canada",
              __category_count__country__value__Portugal: 3,
              __category_count__country__value__Canada: 1,
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const shell = uiShell({
      workbench: fakeWorkbench,
      elements: {
        form,
        newickInput: input,
        searchInput,
        searchButton,
        searchResults,
        ancillaryModeSelect,
        ancillaryNodeSelect,
        metadataPieFieldSelect,
        ancillaryWheelContainer,
        ancillarySelectedNodeWheelContainer,
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

    // Focusing renders the graph, which populates the pie-field options; select
    // the "country" column (PHYLOViZ charts a field only once chosen) and focus
    // again so the clicked node's wheel resolves to its country distribution.
    resultButton.click();
    await Promise.resolve();
    metadataPieFieldSelect.value = "country";
    metadataPieFieldSelect.dispatchEvent(new Event("change"));
    resultButton.click();
    await Promise.resolve();

    expect(fakeWorkbench.focusNode).toHaveBeenCalledWith("a", {
      x: 12,
      y: 34,
      clusterId: "cluster-a",
    });
    // Focusing a search result populates the selected-node panel, not the
    // overview wheel or its mode selector.
    expect(ancillaryModeSelect.value).toBe("global");
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain(
      "Portugal",
    );
    expect(ancillarySelectedNodeWheelContainer.textContent).toContain("75.0%");
    expect(status.textContent).toBe("Focused a");
    shell.unmount();
  });

  it("enables region-select mode via the toggle", () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <button id="region-select-toggle" type="button" aria-pressed="false">Select region</button>
      <div id="region-selection-panel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const regionSelectToggle = document.getElementById(
      "region-select-toggle",
    ) as HTMLButtonElement;
    const regionSelectionPanel = document.getElementById(
      "region-selection-panel",
    ) as HTMLElement;
    const status = document.getElementById("status") as HTMLElement;

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
    expect(regionSelectToggle.getAttribute("aria-pressed")).toBe("false");
    expect(regionSelectionPanel.textContent).toContain("Shift+drag");

    regionSelectToggle.click();
    expect(fakeWorkbench.setRegionSelectModeEnabled).toHaveBeenLastCalledWith(
      true,
    );
    expect(regionSelectToggle.getAttribute("aria-pressed")).toBe("true");

    // Toggling off disables the mode and clears any selection.
    regionSelectToggle.click();
    expect(fakeWorkbench.setRegionSelectModeEnabled).toHaveBeenLastCalledWith(
      false,
    );
    expect(fakeWorkbench.clearRegionSelection).toHaveBeenCalled();
    expect(regionSelectToggle.getAttribute("aria-pressed")).toBe("false");

    shell.unmount();
  });

  it("populates the region panel with aggregated metadata on selection", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <button id="region-select-toggle" type="button" aria-pressed="false">Select region</button>
      <div id="region-selection-panel"></div>
      <div id="status"></div>
    `;

    const form = document.getElementById("render-form") as HTMLFormElement;
    const input = document.getElementById(
      "newick-input",
    ) as HTMLTextAreaElement;
    const regionSelectToggle = document.getElementById(
      "region-select-toggle",
    ) as HTMLButtonElement;
    const regionSelectionPanel = document.getElementById(
      "region-selection-panel",
    ) as HTMLElement;
    const status = document.getElementById("status") as HTMLElement;

    const fakeWorkbench = makeFakeWorkbench() as GraphWorkbench & {
      emitRegionSelected: (bounds: {
        xmin: number;
        xmax: number;
        ymin: number;
        ymax: number;
      }) => void;
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
      expect(regionSelectionPanel.textContent).toContain("2 nodes selected");
    });

    expect(fakeWorkbench.selectRegion).toHaveBeenCalledWith({
      xmin: 0,
      xmax: 5,
      ymin: 0,
      ymax: 5,
    });
    // Server-aggregated field/value pairs are tabulated.
    expect(regionSelectionPanel.textContent).toContain("country");
    expect(regionSelectionPanel.textContent).toContain("Portugal");
    expect(regionSelectionPanel.textContent).toContain("score");
    expect(status.textContent).toBe("Region selected: 2 nodes");

    shell.unmount();
  });
});

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}
