import { UiShellController } from "../src/app/uiShell";
import type { GraphWorkbench } from "../src/app/workbench/graphWorkbench";

function makeFakeWorkbench(renderedGraph: {
  nodes: Array<{ id: string; x: number; y: number }>;
  edges: Array<{ id?: string; source?: string; target?: string }>;
  viewMeta: Record<string, unknown>;
}) {
  let graphRenderedHandler:
    | ((graph: typeof renderedGraph) => void)
    | null = null;

  return {
    renderNewick: vi.fn(async () => {
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
});
