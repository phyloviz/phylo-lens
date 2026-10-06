import { toError } from '../../errors';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import { renderSearchResults, type SearchResultItem } from './searchResultsView';

const SEARCH_LIMIT = 25;

type SearchControllerOptions = {
    workbench: Pick<GraphWorkbench, 'searchNodes' | 'focusNode' | 'cancelPendingFocus'>;
    input?: HTMLInputElement;
    results?: HTMLElement;
    setStatus: (status: string) => void;
    setFailureStatus: (message: string) => void;
    onNodeFocused: (nodeId: string) => void;
};

export default function createSearchController(options: SearchControllerOptions) {
    // New searches invalidate pending searches and focus; selections invalidate only focus.
    let searchSequence = 0;
    let focusSequence = 0;

    function reset(): void {
        searchSequence += 1;
        focusSequence += 1;
        options.workbench.cancelPendingFocus();
        renderMatches([]);
    }

    async function searchCurrentDataset(): Promise<void> {
        reset();
        const searchAtStart = searchSequence;
        const query = options.input?.value.trim() ?? '';

        if (!query) return;

        try {
            const result = await options.workbench.searchNodes({
                query,
                limit: SEARCH_LIMIT,
            });
            if (searchAtStart !== searchSequence) return;
            renderMatches(result.matches);
            options.setStatus(`Search found ${result.totalCount} matches`);
        } catch (error) {
            if (searchAtStart !== searchSequence) return;
            options.setFailureStatus(toError(error).message);
        }
    }

    function renderMatches(matches: readonly SearchResultItem[]): void {
        renderSearchResults(options.results, matches, match => {
            // The click starts focus; focusSearchResult handles its completion and errors.
            void focusSearchResult(match);
        });
    }

    async function focusSearchResult(match: SearchResultItem): Promise<void> {
        const searchAtStart = searchSequence;
        const focusAtStart = ++focusSequence;
        const isCurrent = () => searchAtStart === searchSequence && focusAtStart === focusSequence;
        const nodeId = match.nodeId;
        try {
            // Global coordinates allow focusing a match outside the current LoD view.
            await options.workbench.focusNode(nodeId, {
                x: match.x ?? null,
                y: match.y ?? null,
                clusterId: match.clusterId ?? null,
            });
            if (!isCurrent()) return;
            options.onNodeFocused(nodeId);
            options.setStatus(`Focused ${nodeId}`);
        } catch (error) {
            if (!isCurrent()) return;
            options.setFailureStatus(toError(error).message);
        }
    }

    return { reset, searchCurrentDataset };
}
