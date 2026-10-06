import type { ClusterId, NodeId } from '../../../contracts/graph/graphIdentifiers';

export type SearchResultItem = {
  readonly nodeId: NodeId;
  readonly matchedText: string;
  readonly score: number;
  readonly clusterId?: ClusterId | null;
  readonly x?: number | null;
  readonly y?: number | null;
};

export function renderSearchResults(
  container: HTMLElement | undefined,
  matches: readonly SearchResultItem[],
  onFocusNode: (match: SearchResultItem) => void
): void {
  if (!container) {
    return;
  }

  container.innerHTML = '';

  matches.forEach(match => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-result';
    item.textContent =
      match.score < 40 || match.matchedText === match.nodeId ? match.nodeId : `${match.matchedText} → ${match.nodeId}`;
    item.title = match.matchedText;
    item.addEventListener('click', () => {
      onFocusNode(match);
    });
    container.appendChild(item);
  });
}
