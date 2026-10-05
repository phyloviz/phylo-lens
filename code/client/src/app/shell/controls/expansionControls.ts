import { toError } from '../../errors';
import { reduceExpansionControls, type ExpansionControlAction, type ExpansionControlState } from './expansionState';
import { toClusterId } from '../../../contracts/graph/graphIdentifiers';
import type { GraphWorkbench } from '../../workbench/graphWorkbench.types';
import type { RenderNodeClickState } from '../../../render/renderer.types';
import type { ExpansionState, ExpansionResult } from '../../../contracts/expansion';
import eventBindings from '../events/eventBindings';

export interface ExpansionControlsElements {
    expandSelected?: HTMLButtonElement;
    collapseSelected?: HTMLButtonElement;
    expandAll?: HTMLButtonElement;
    collapseAll?: HTMLButtonElement;
    keepExpanded?: HTMLInputElement;
    feedback?: HTMLElement;
}

export function expansionControls(workbench: GraphWorkbench, elements: ExpansionControlsElements = {}) {
    const bindings = eventBindings();
    let state: ExpansionControlState = { kind: 'unavailable' };
    let revision = 0;
    const dispatch = (action: ExpansionControlAction) => {
        state = reduceExpansionControls(state, action);
    };
    const available = Object.values(elements).some(Boolean);
    const selection = () => (state.kind === 'unavailable' ? null : state.selected);
    const clusterId = () => selection()?.clusterId ?? toClusterId('');

    function update() {
        if (!available) return;
        const ready = state.kind !== 'unavailable';
        const busy = state.kind === 'updating';
        const failure = state.kind === 'ready' ? state.failure : null;
        const expansion = ready ? workbench.getExpansionState() : null;
        const expanded = expansion?.expandedClusterIds.includes(clusterId()) ?? false;
        if (elements.expandSelected)
            elements.expandSelected.disabled = !ready || busy || expanded || selection()?.expandable !== true;
        if (elements.collapseSelected) elements.collapseSelected.disabled = !ready || busy || !expanded;
        for (const button of [elements.expandAll, elements.collapseAll]) if (button) button.disabled = !ready || busy;
        if (elements.keepExpanded) {
            elements.keepExpanded.disabled = !ready || busy;
            elements.keepExpanded.checked = expansion?.keepExpanded ?? false;
        }
        if (elements.feedback && failure) elements.feedback.textContent = failure;
        else if (expansion && !busy) show(expansion);
    }

    function show(state: ExpansionState) {
        if (!elements.feedback) return;
        elements.feedback.textContent = state.partial
            ? `Partial result: ${state.renderedNodeCount} nodes shown${state.maxNodes === undefined ? '' : ` (limit ${state.maxNodes})`}. Some nodes remain unavailable in this view.`
            : state.allExpanded
              ? `All nodes expanded: ${state.renderedNodeCount}.`
              : `${state.expandedClusterIds.length} groups explicitly expanded.`;
    }

    async function run(action: () => ExpansionState | Promise<ExpansionResult>): Promise<void> {
        if (state.kind !== 'ready') return;
        const request = ++revision;
        dispatch({ kind: 'started' });
        update();
        if (elements.feedback) elements.feedback.textContent = 'Updating expansion…';
        let failure: string | null = null;
        try {
            const result = await action();
            if ('status' in result && result.status === 'superseded')
                failure = 'Expansion was superseded by a newer view. Try again.';
        } catch (error) {
            failure = String(toError(error));
        }
        if (request !== revision) return;
        dispatch({ kind: 'finished', failure });
        update();
    }

    return {
        mount() {
            bindings.on(elements.expandSelected, 'click', () => {
                void run(() => workbench.expandCluster(clusterId()));
            });
            bindings.on(elements.collapseSelected, 'click', () => {
                void run(() => workbench.collapseCluster(clusterId()));
            });
            bindings.on(elements.expandAll, 'click', () => {
                void run(() => workbench.expandAll());
            });
            bindings.on(elements.collapseAll, 'click', () => {
                void run(() => workbench.collapseAll());
            });
            bindings.on(elements.keepExpanded, 'change', () => {
                const keep = elements.keepExpanded!.checked;
                void run(() => workbench.setKeepExpanded(keep));
            });
            update();
        },
        select(state: RenderNodeClickState) {
            dispatch({
                kind: 'selected',
                selected:
                    state.nodeId === null
                        ? null
                        : {
                              clusterId: toClusterId(String(state.attributes?.clusterId ?? state.nodeId)),
                              expandable: state.attributes?.isClusterProxy === true,
                          },
            });
            update();
        },
        setReady(value: boolean) {
            if (!value) revision++;
            dispatch({ kind: value ? 'ready' : 'unavailable' });
            update();
        },
        update,
        dispose() {
            revision++;
            dispatch({ kind: 'unavailable' });
            bindings.clear();
        },
    };
}
