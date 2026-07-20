import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareGraph: vi.fn(),
  renderNewick: vi.fn(),
  dispose: vi.fn(),
  createRenderer: vi.fn(),
}));

vi.mock("../src/api/graphClient", () => ({
  createGraphClient: vi.fn((options: { baseUrl: string }) => ({
    apiUrl: options.baseUrl,
    prepareGraph: mocks.prepareGraph,
  })),
}));

vi.mock("../src/render/rendererFactory", () => ({
  default: vi.fn(() => ({
    createRenderer: mocks.createRenderer,
  })),
}));

vi.mock("../src/app/workbench/graphWorkbench", () => ({
  createGraphWorkbench: vi.fn(() => ({
    renderNewick: mocks.renderNewick,
    dispose: mocks.dispose,
  })),
}));

import { createGraphWorkbench } from "../src/app/workbench/graphWorkbench";
import { createPhyloLensView } from "../src";
import { ERR_PHYLO_LENS_VIEW_DISPOSED } from "../src/phyloLensView";

describe("createPhyloLensView", () => {
  beforeEach(() => {
    mocks.prepareGraph.mockReset();
    mocks.renderNewick.mockReset();
    mocks.dispose.mockReset();
    mocks.createRenderer.mockReset();
  });

  it("creates the existing workbench stack and loads Newick content", async () => {
    const container = document.createElement("div");
    const view = createPhyloLensView({
      container,
      apiUrl: "https://phylo-lens.example.test",
    });

    await view.load({
      content: "(a:1,b:1)root;",
      name: "example-tree",
      metadataSchema: [{ key: "country", type: "string" }],
      metadataByNodeId: {
        a: { country: "PT" },
      },
    });
    view.dispose();

    expect(createGraphWorkbench).toHaveBeenCalledWith({
      graphClient: expect.objectContaining({
        apiUrl: "https://phylo-lens.example.test",
      }),
      rendererFactory: expect.objectContaining({
        createRenderer: mocks.createRenderer,
      }),
      rendererKind: "sigma",
      renderContext: { container },
    });
    expect(mocks.renderNewick).toHaveBeenCalledWith("(a:1,b:1)root;", "example-tree", {
      sourceFormat: "newick",
      metadataSchema: [{ key: "country", type: "string" }],
      metadataByNodeId: {
        a: { country: "PT" },
      },
    });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("delegates each load call to the workbench", async () => {
    const view = createPhyloLensView({
      container: document.createElement("div"),
      apiUrl: "https://phylo-lens.example.test",
    });

    await view.load({ content: "(a:1)b;", name: "first" });
    await view.load({ content: "(c:1)d;", name: "second" });

    expect(mocks.renderNewick).toHaveBeenNthCalledWith(1, "(a:1)b;", "first", {
      sourceFormat: "newick",
    });
    expect(mocks.renderNewick).toHaveBeenNthCalledWith(2, "(c:1)d;", "second", {
      sourceFormat: "newick",
    });
  });

  it("makes dispose idempotent", () => {
    const view = createPhyloLensView({
      container: document.createElement("div"),
      apiUrl: "https://phylo-lens.example.test",
    });

    view.dispose();
    view.dispose();

    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("allows dispose after a failed load", async () => {
    mocks.renderNewick.mockRejectedValueOnce(new Error("prepare failed"));
    const view = createPhyloLensView({
      container: document.createElement("div"),
      apiUrl: "https://phylo-lens.example.test",
    });

    await expect(view.load({ content: "(a:1)b;" })).rejects.toThrow("prepare failed");
    view.dispose();

    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects load calls after disposal with a clear error", async () => {
    const view = createPhyloLensView({
      container: document.createElement("div"),
      apiUrl: "https://phylo-lens.example.test",
    });

    view.dispose();

    await expect(view.load({ content: "(a:1)b;" })).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    expect(mocks.renderNewick).not.toHaveBeenCalled();
  });
});
