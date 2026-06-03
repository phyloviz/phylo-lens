import { UiShellController } from "../src/app/uiShell";
import type { GraphWorkbench } from "../src/app/workbench/graphWorkbench";
import type { PositionedGraph } from "../src/contracts/positioned";

function makeFakeWorkbench(renderedGraph: PositionedGraph) {
  let graphRenderedHandler: ((graph: PositionedGraph) => void) | null = null;

  return {
    renderNewick: vi.fn(async () => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    updateVisualMapping: vi.fn(() => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
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
        collapsedClusterCount: 0,
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

  it("searches rendered datasets and focuses selected results", async () => {
    document.body.innerHTML = `
      <form id="render-form"></form>
      <textarea id="newick-input"></textarea>
      <input id="search-input" type="search" />
      <button id="search-button" type="button">Search</button>
      <div id="search-results"></div>
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
    const status = document.getElementById("status") as HTMLElement;

    input.value = "(A,B)Root;";
    searchInput.value = "port";

    const fakeWorkbench = makeFakeWorkbench({
      nodes: [{ id: "a", x: 0, y: 0 }],
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
