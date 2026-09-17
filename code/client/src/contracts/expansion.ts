/** Explicit expansion is scoped to the currently loaded dataset. */
export interface ExpansionState {
  keepExpanded: boolean;
  expandedClusterIds: readonly string[];
  allExpanded: boolean;
  partial: boolean;
  renderedNodeCount: number;
  maxNodes: number;
}

export interface ExpansionResult extends ExpansionState {
  status: "complete" | "partial" | "superseded";
}
