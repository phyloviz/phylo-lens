import type { ClusterId } from '../../../contracts/graph/graphIdentifiers';

type Selection = { readonly clusterId: ClusterId; readonly expandable: boolean } | null;
export type ExpansionControlState =
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'ready'; readonly selected: Selection; readonly failure: string | null }
    | { readonly kind: 'updating'; readonly selected: Selection };

export type ExpansionControlAction =
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'ready' }
    | { readonly kind: 'selected'; readonly selected: Selection }
    | { readonly kind: 'started' }
    | { readonly kind: 'finished'; readonly failure: string | null };

export function reduceExpansionControls(
    state: ExpansionControlState,
    action: ExpansionControlAction
): ExpansionControlState {
    switch (action.kind) {
        case 'unavailable':
            return { kind: 'unavailable' };
        case 'ready':
            return state.kind === 'unavailable' ? { kind: 'ready', selected: null, failure: null } : state;
        case 'selected':
            return state.kind === 'unavailable'
                ? state
                : { ...state, selected: action.selected && { ...action.selected } };
        case 'started':
            return state.kind === 'ready' ? { kind: 'updating', selected: state.selected } : state;
        case 'finished':
            return state.kind === 'updating'
                ? { kind: 'ready', selected: state.selected, failure: action.failure }
                : state;
    }
}
