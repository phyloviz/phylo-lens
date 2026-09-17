import { describe, expect, it, vi } from "vitest";
import { expansionControls } from "../src/app/shell/controls/expansionControls";
import type { GraphWorkbench } from "../src/app/workbench/graphWorkbench.types";

describe("expansion controls", () => {
  it("preserves a checkbox's new value and surfaces partial results and errors", async () => {
    const state = {
      keepExpanded: false,
      expandedClusterIds: [],
      allExpanded: false,
      partial: false,
      renderedNodeCount: 2,
      maxNodes: 10,
    };
    const workbench = {
      getExpansionState: () => state,
      setKeepExpanded: vi.fn((keep: boolean) => {
        state.keepExpanded = keep;
        return state;
      }),
      expandAll: vi.fn(async () => {
        state.partial = true;
        state.renderedNodeCount = 10;
        return state;
      }),
      collapseAll: vi.fn(async () => {
        throw new Error("Network unavailable");
      }),
    } as unknown as GraphWorkbench;
    const keepExpanded = document.createElement("input");
    keepExpanded.type = "checkbox";
    const expandAll = document.createElement("button");
    const collapseAll = document.createElement("button");
    const feedback = document.createElement("p");
    const controls = expansionControls(workbench, { keepExpanded, expandAll, collapseAll, feedback });
    document.body.append(keepExpanded, expandAll, collapseAll, feedback);
    controls.mount();
    controls.setReady(true);
    keepExpanded.click();
    await Promise.resolve();
    expect(workbench.setKeepExpanded).toHaveBeenCalledWith(true);
    expect(keepExpanded.checked).toBe(true);
    expandAll.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(feedback.textContent).toContain("Partial result: 10 nodes shown (limit 10)");
    collapseAll.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(feedback.textContent).toContain("Network unavailable");
    controls.dispose();
  });
});
