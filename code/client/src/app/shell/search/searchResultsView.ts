import type { ClusterId, NodeId } from "../../../contracts/graph/graphIdentifiers";
export interface SearchResultItem {
  nodeId: NodeId;
  matchedText: string;
  score: number;
  clusterId?: ClusterId | null;
  // Global layout coordinates of the matched node (omitted when unavailable),
  // forwarded to the focus handler so it can fetch a region around the hit.
  x?: number | null;
  y?: number | null;
}

export function renderSearchResults(
  container: HTMLElement | undefined,
  matches: SearchResultItem[],
  onFocusNode: (match: SearchResultItem) => void,
): void {
  if (!container) {
    return;
  }

  container.innerHTML = "";

  matches.forEach((match) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-result";
    item.textContent =
      match.score < 40 || match.matchedText === match.nodeId ? match.nodeId : `${match.matchedText} → ${match.nodeId}`;
    item.title = match.matchedText;
    item.addEventListener("click", () => {
      onFocusNode(match);
    });
    container.appendChild(item);
  });
}
