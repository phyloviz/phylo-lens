export interface SearchResultItem {
  node_id: string;
  matched_text: string;
  score: number;
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
    item.textContent = match.node_id;
    item.title = match.matched_text;
    item.addEventListener("click", () => {
      onFocusNode(match);
    });
    container.appendChild(item);
  });
}
