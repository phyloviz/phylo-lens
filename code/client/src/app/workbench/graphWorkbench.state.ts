import { EMPTY_ANCILLARY_FILTER_STATE } from '../../ancillary/filterEngine';
import type { AncillaryFilterState } from '../../ancillary/ancillaryTypes';
import type { PositionedGraph } from '../../contracts/positioned';
import { GRAPH_WORKBENCH_ERRORS } from './graphWorkbench.errors';
import type { GraphSession } from './graphWorkbench.types';

type WorkbenchControls = {
  readonly activeFilters: AncillaryFilterState;
  readonly lodRefreshPaused: boolean;
};

export type GraphWorkbenchState = WorkbenchControls &
  (
    | { readonly kind: 'idle' }
    | { readonly kind: 'preparing' }
    | { readonly kind: 'loadingViewport'; readonly session: GraphSession }
    | { readonly kind: 'ready'; readonly session: GraphSession; readonly graph: PositionedGraph }
    | { readonly kind: 'failed'; readonly error: Error }
  );

export function createInitialWorkbenchState(): GraphWorkbenchState {
  return { kind: 'idle', activeFilters: EMPTY_ANCILLARY_FILTER_STATE, lodRefreshPaused: false };
}

export function hasGraphSession(
  state: GraphWorkbenchState
): state is Extract<GraphWorkbenchState, { session: GraphSession }> {
  return state.kind === 'loadingViewport' || state.kind === 'ready';
}

export function getGraphSession(state: GraphWorkbenchState): GraphSession {
  if (!hasGraphSession(state)) throw new Error(GRAPH_WORKBENCH_ERRORS.noGraphRendered);
  return state.session;
}

export function getGraphSnapshot(state: GraphWorkbenchState): PositionedGraph | null {
  return state.kind === 'ready' ? state.graph : null;
}
