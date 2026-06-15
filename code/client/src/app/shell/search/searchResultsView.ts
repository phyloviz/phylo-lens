export interface SearchResultItem {
  node_id: string;
  matched_text: string;
  score: number;
}

export function renderSearchResults(
  container: HTMLElement | undefined,
  matches: SearchResultItem[],
  onFocusNode: (nodeId: string) => void,
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
      onFocusNode(match.node_id);
    });
    container.appendChild(item);
  });
}
