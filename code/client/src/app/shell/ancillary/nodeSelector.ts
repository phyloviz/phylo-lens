import type { PositionedGraph } from "../../../contracts/positioned";

export const ANCILLARY_MODE_GLOBAL = "global";
export const ANCILLARY_MODE_CURRENT = "current";
export const ANCILLARY_MODE_SELECTED = "selected";

export type AncillaryMode =
  | typeof ANCILLARY_MODE_GLOBAL
  | typeof ANCILLARY_MODE_CURRENT
  | typeof ANCILLARY_MODE_SELECTED;

export function getAncillaryMode(
  modeSelect: HTMLSelectElement | undefined,
): AncillaryMode {
  const mode = modeSelect?.value;
  if (
    mode === ANCILLARY_MODE_GLOBAL ||
    mode === ANCILLARY_MODE_CURRENT ||
    mode === ANCILLARY_MODE_SELECTED
  ) {
    return mode;
  }
  return ANCILLARY_MODE_GLOBAL;
}

export function updateNodeSelector(
  nodeSelect: HTMLSelectElement | undefined,
  graph: PositionedGraph | null,
): void {
  if (!nodeSelect) {
    return;
  }

  nodeSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select node";
  nodeSelect.appendChild(placeholder);

  if (!graph) {
    return;
  }

  const nodeIds = [...graph.nodes.map((node) => node.id)].sort((a, b) =>
    a.localeCompare(b),
  );
  nodeIds.forEach((nodeId) => {
    const option = document.createElement("option");
    option.value = nodeId;
    option.textContent = nodeId;
    nodeSelect.appendChild(option);
  });
}

export function updateNodeSelectionVisibility(
  nodeSelect: HTMLSelectElement | undefined,
  modeSelect: HTMLSelectElement | undefined,
): void {
  if (!nodeSelect) {
    return;
  }

  nodeSelect.disabled = getAncillaryMode(modeSelect) !== ANCILLARY_MODE_SELECTED;
}
