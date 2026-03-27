import { UiShellController } from "../src/app/uiShell";
import { GraphWorkbench } from "../src/app/graphWorkbench";

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

    const fakeWorkbench = {
      renderNewick: vi.fn(async () => ({
        nodes: [{ id: "root", x: 0, y: 0 }],
        edges: [],
        viewMeta: { layout: "force", lodLevel: 0 },
      })),
      dispose: vi.fn(),
    } as unknown as GraphWorkbench;

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

    const fakeWorkbench = {
      renderNewick: vi.fn(async () => ({
        nodes: [],
        edges: [],
        viewMeta: { layout: "force", lodLevel: 0 },
      })),
      dispose: vi.fn(),
    } as unknown as GraphWorkbench;

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

    const fakeWorkbench = {
      renderNewick: vi.fn(async () => ({
        nodes: [],
        edges: [],
        viewMeta: { layout: "force", lodLevel: 0 },
      })),
      dispose: vi.fn(),
    } as unknown as GraphWorkbench;

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
});
