import type { ClusterId } from './graph/graphIdentifiers';
/** Explicit expansion is scoped to the currently loaded dataset. */
export type ExpansionState = {
  readonly keepExpanded: boolean;
  readonly expandedClusterIds: readonly ClusterId[];
  readonly allExpanded: boolean;
  readonly partial: boolean;
  readonly renderedNodeCount: number;
  readonly maxNodes?: number;
};

export type ExpansionResult = ExpansionState & {
  readonly status: 'complete' | 'partial' | 'superseded';
};
