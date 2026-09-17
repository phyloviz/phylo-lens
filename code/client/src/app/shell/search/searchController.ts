import type { GraphWorkbench } from "../../workbench/graphWorkbench";
import { renderSearchResults, type SearchResultItem } from "./searchResultsView";

const SEARCH_LIMIT = 25;

export interface SearchControllerOptions {
  workbench: GraphWorkbench;
  input?: HTMLInputElement;
  results?: HTMLElement;
  setStatus: (status: string) => void;
  setFailureStatus: (message: string) => void;
  onNodeFocused: (nodeId: string) => void;
}

export default function (options: SearchControllerOptions) {
  let generation = 0;
  let focusGeneration = 0;
  const reset = () => {
    generation += 1;
    focusGeneration += 1;
    options.workbench.cancelPendingFocus();
    renderMatches([]);
  };
  return {
    reset,
    searchCurrentDataset: searchCurrentDataset,
  };

  async function searchCurrentDataset(): Promise<void> {
    reset();
    const request = generation;
    const query = options.input?.value.trim() ?? "";

    if (!query) {
      renderMatches([]);
      return;
    }

    try {
      const response = await options.workbench.searchNodes({
        query,
        limit: SEARCH_LIMIT,
      });
      if (request !== generation) return;
      renderMatches(response.matches);
      options.setStatus(`Search found ${response.total_count} matches`);
    } catch (error) {
      if (request !== generation) return;
      const message = error instanceof Error ? error.message : "unknown error";
      options.setFailureStatus(message);
    }
  }

  function renderMatches(matches: SearchResultItem[]): void {
    renderSearchResults(options.results, matches, (match) => {
      void focusSearchResult(match);
    });
  }

  async function focusSearchResult(match: SearchResultItem): Promise<void> {
    const request = generation;
    const focus = ++focusGeneration;
    const isCurrent = () => request === generation && focus === focusGeneration;
    const nodeId = match.node_id;
    try {
      // Pass the match's global coordinates so the workbench can fetch a region
      // around the hit when it lies outside the current LoD slice; only then is
      // the node present in the rendered graph to center and highlight.
      await options.workbench.focusNode(nodeId, {
        x: match.x ?? null,
        y: match.y ?? null,
        clusterId: match.cluster_id ?? null,
      });
      if (!isCurrent()) return;
      options.onNodeFocused(nodeId);
      options.setStatus(`Focused ${nodeId}`);
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "unknown error";
      options.setFailureStatus(message);
    }
  }
}
