import { copyFilterState } from '../../ancillary/filterEngine';
import { copyVisualMapping } from '../../render/mapping/visualMapping';
import { createInitialWorkbenchState, hasGraphSession, type GraphWorkbenchState } from './graphWorkbench.state';
import type { GraphWorkbenchAction } from './graphWorkbench.actions';

export function reduceGraphWorkbenchState(
    state: GraphWorkbenchState,
    action: GraphWorkbenchAction
): GraphWorkbenchState {
    switch (action.kind) {
        case 'loadStarted':
            return { ...createInitialWorkbenchState(), kind: 'preparing' };
        case 'graphPrepared':
            return state.kind === 'preparing' ? { ...state, kind: 'loadingViewport', session: action.session } : state;
        case 'loadFailed':
            if (state.kind === 'idle' || state.kind === 'failed') return state;
            return {
                kind: 'failed',
                error: action.error,
                activeFilters: state.activeFilters,
                lodRefreshPaused: state.lodRefreshPaused,
            };
        case 'lodRefreshPaused':
            return hasGraphSession(state) ? { ...state, lodRefreshPaused: action.paused } : state;
        case 'filtersUpdated':
            return hasGraphSession(state) ? { ...state, activeFilters: copyFilterState(action.filters) } : state;
        case 'visualMappingUpdated':
            return hasGraphSession(state)
                ? { ...state, session: { ...state.session, visualMapping: copyVisualMapping(action.visualMapping) } }
                : state;
        case 'displayOptionsUpdated':
            return hasGraphSession(state)
                ? {
                      ...state,
                      session: {
                          ...state.session,
                          displayOptions: { ...state.session.displayOptions, ...action.displayOptions },
                      },
                  }
                : state;
        case 'viewportApplied': {
            if (!hasGraphSession(state)) return state;
            const session =
                action.layoutVersion === undefined
                    ? state.session
                    : { ...state.session, layoutVersion: action.layoutVersion };
            return {
                ...state,
                kind: 'ready',
                session,
                graph: {
                    ...action.graph,
                    viewMeta: {
                        ...action.graph.viewMeta,
                        lodTierCount: session.lodTierCount,
                        layoutWarnings: session.layoutWarnings,
                    },
                },
            };
        }
    }
}
