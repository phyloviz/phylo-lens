import type { PositionedGraph } from '../src/contracts/positioned';
import { toDatasetId, toNodeId } from '../src/contracts/graph/graphIdentifiers';
import { describe, expect, it, vi } from 'vitest';
import searchController from '../src/app/shell/search/searchController';
import type { GraphWorkbench } from '../src/app/workbench/graphWorkbench';
import type { GraphSearchResult } from '../src/contracts/graph/search/GraphSearchResult';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const response = (id: string): GraphSearchResult => ({
  datasetId: toDatasetId('tree'),
  query: id,
  totalCount: 1,
  matches: [{ nodeId: toNodeId(id), matchedText: id, score: 100 }],
});
function harness() {
  const input = document.createElement('input');
  const results = document.createElement('div');
  const workbench = {
    searchNodes: vi.fn<GraphWorkbench['searchNodes']>(),
    focusNode: vi.fn<GraphWorkbench['focusNode']>(),
    cancelPendingFocus: vi.fn(),
  };
  const options = {
    input,
    results,
    workbench,
    setStatus: vi.fn(),
    setFailureStatus: vi.fn(),
    onNodeFocused: vi.fn(),
  };
  return { ...options, workbench, controller: searchController(options) };
}

describe('search request ownership', () => {
  it('keeps the newest results when searches finish out of order', async () => {
    const h = harness();
    const old = deferred<GraphSearchResult>();
    h.workbench.searchNodes.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('B'));
    h.input.value = 'A';
    const first = h.controller.searchCurrentDataset();
    h.input.value = 'B';
    await h.controller.searchCurrentDataset();
    old.resolve(response('A'));
    await first;
    expect(h.results.textContent).toBe('B');
    expect(h.setStatus).toHaveBeenCalledTimes(1);
  });

  it('ignores errors and results after editing, clearing or replacing the dataset', async () => {
    const h = harness();
    const old = deferred<GraphSearchResult>();
    h.workbench.searchNodes.mockReturnValueOnce(old.promise);
    h.input.value = 'A';
    const pending = h.controller.searchCurrentDataset();
    h.controller.reset();
    old.reject(new Error('obsolete'));
    await pending;
    expect(h.results.textContent).toBe('');
    expect(h.setFailureStatus).not.toHaveBeenCalled();
  });

  it('does not report an older focus as completed after a newer selection', async () => {
    const h = harness();
    const first = deferred<PositionedGraph>();
    h.workbench.searchNodes.mockResolvedValue({
      ...response('A'),
      matches: [...response('A').matches, ...response('B').matches],
    });
    h.workbench.focusNode
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    h.input.value = 'A';
    await h.controller.searchCurrentDataset();
    const buttons = h.results.querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    await Promise.resolve();
    first.resolve({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    await Promise.resolve();
    expect(h.onNodeFocused).toHaveBeenCalledTimes(1);
    expect(h.onNodeFocused).toHaveBeenCalledWith('B');
  });

  it('reports a focus failure started by a click without reporting success', async () => {
    const h = harness();
    const pendingFocus = deferred<PositionedGraph>();
    h.workbench.searchNodes.mockResolvedValue(response('A'));
    h.workbench.focusNode.mockReturnValue(pendingFocus.promise);
    h.input.value = 'A';
    await h.controller.searchCurrentDataset();
    h.setStatus.mockClear();

    h.results.querySelector('button')!.click();
    expect(h.onNodeFocused).not.toHaveBeenCalled();
    pendingFocus.reject(new Error('Could not focus A'));
    await Promise.resolve();

    expect(h.setFailureStatus).toHaveBeenCalledWith('Could not focus A');
    expect(h.onNodeFocused).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalled();
  });
});
