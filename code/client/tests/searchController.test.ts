import { describe, expect, it, vi } from "vitest";
import searchController from "../src/app/shell/search/searchController";
import type { GraphWorkbench } from "../src/app/workbench/graphWorkbench";
import type { SearchDatasetResponse } from "../src/contracts/models";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const response = (id: string): SearchDatasetResponse => ({
  dataset_id: "tree",
  query: id,
  total_count: 1,
  matches: [{ node_id: id, matched_text: id, score: 100, metadata: {} }],
});
function harness() {
  const input = document.createElement("input");
  const results = document.createElement("div");
  const workbench = { searchNodes: vi.fn(), focusNode: vi.fn(), cancelPendingFocus: vi.fn() };
  const options = {
    input,
    results,
    workbench: workbench as unknown as GraphWorkbench,
    setStatus: vi.fn(),
    setFailureStatus: vi.fn(),
    onNodeFocused: vi.fn(),
  };
  return { ...options, workbench, controller: searchController(options) };
}

describe("search request ownership", () => {
  it("keeps the newest results when searches finish out of order", async () => {
    const h = harness();
    const old = deferred<SearchDatasetResponse>();
    h.workbench.searchNodes.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response("B"));
    h.input.value = "A";
    const first = h.controller.searchCurrentDataset();
    h.input.value = "B";
    await h.controller.searchCurrentDataset();
    old.resolve(response("A"));
    await first;
    expect(h.results.textContent).toBe("B");
    expect(h.setStatus).toHaveBeenCalledTimes(1);
  });

  it("ignores errors and results after editing, clearing or replacing the dataset", async () => {
    const h = harness();
    const old = deferred<SearchDatasetResponse>();
    h.workbench.searchNodes.mockReturnValueOnce(old.promise);
    h.input.value = "A";
    const pending = h.controller.searchCurrentDataset();
    h.controller.reset();
    old.reject(new Error("obsolete"));
    await pending;
    expect(h.results.textContent).toBe("");
    expect(h.setFailureStatus).not.toHaveBeenCalled();
  });

  it("does not report an older focus as completed after a newer selection", async () => {
    const h = harness();
    const first = deferred<unknown>();
    h.workbench.searchNodes.mockResolvedValue({
      ...response("A"),
      matches: [...response("A").matches, ...response("B").matches],
    });
    h.workbench.focusNode.mockReturnValueOnce(first.promise).mockResolvedValueOnce({});
    h.input.value = "A";
    await h.controller.searchCurrentDataset();
    const buttons = h.results.querySelectorAll("button");
    buttons[0].click();
    buttons[1].click();
    await Promise.resolve();
    first.resolve({});
    await Promise.resolve();
    expect(h.onNodeFocused).toHaveBeenCalledTimes(1);
    expect(h.onNodeFocused).toHaveBeenCalledWith("B");
  });
});
