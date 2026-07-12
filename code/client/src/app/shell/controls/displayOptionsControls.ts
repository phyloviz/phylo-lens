import type { GraphDisplayOptions } from "../../../render/renderer.types";

export const DISPLAY_OPTION_NODE_LABELS = "node-labels";
export const DISPLAY_OPTION_EDGE_DISTANCE_LABELS = "edge-distance-labels";
export const DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES = "distance-weighted-edges";

export function buildDisplayOptions(selectedValues: string[]): GraphDisplayOptions {
  const selected = new Set(selectedValues);
  const hasExplicitSelection = selected.size > 0;

  return {
    nodeLabels: !hasExplicitSelection || selected.has(DISPLAY_OPTION_NODE_LABELS),
    edgeDistanceLabels: selected.has(DISPLAY_OPTION_EDGE_DISTANCE_LABELS),
    distanceWeightedEdges: selected.has(DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES),
  };
}

export function toggleClickedOption(select: HTMLSelectElement | undefined, event: MouseEvent): boolean {
  if (!select || !(event.target instanceof HTMLOptionElement)) {
    return false;
  }

  event.preventDefault();
  event.target.selected = !event.target.selected;
  return true;
}
