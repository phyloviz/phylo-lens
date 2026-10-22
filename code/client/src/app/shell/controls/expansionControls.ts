import { toError } from '../../errors';
import {
  reduceExpansionControls,
  type ExpansionControlAction,
  type ExpansionControlState,
  type ExpansionSelection,
} from './expansionState';
import { toClusterId, toNodeId } from '../../../contracts/graph/graphIdentifiers';
import type { GraphWorkbench } from '../../workbench/graphWorkbench.types';
import type { RenderNodeClickState } from '../../../render/renderer.types';
import type { ExpansionState, ExpansionResult } from '../../../contracts/expansion';
import type { PositionedGraph } from '../../../contracts/positioned';
import eventBindings from '../events/eventBindings';

export type ExpansionControlsElements = {
  expandSelected?: HTMLButtonElement;
  collapseSelected?: HTMLButtonElement;
  expandAll?: HTMLButtonElement;
  collapseAll?: HTMLButtonElement;
  keepExpanded?: HTMLInputElement;
  feedback?: HTMLElement;
  selectionLabel?: HTMLElement;
};

export function expansionControls(
  workbench: Pick<
    GraphWorkbench,
    | 'getExpansionState'
    | 'setKeepExpanded'
    | 'expandAll'
    | 'collapseAll'
    | 'expandCluster'
    | 'collapseCluster'
    | 'expandBranch'
    | 'collapseBranch'
  >,
  elements: ExpansionControlsElements = {}
) {
  const bindings = eventBindings();
  let state: ExpansionControlState = { kind: 'unavailable' };
  let revision = 0;
  const dispatch = (action: ExpansionControlAction) => {
    state = reduceExpansionControls(state, action);
  };
  const available = Object.values(elements).some(Boolean);
  const selection = () => (state.kind === 'unavailable' ? null : state.selected);

  function update() {
    if (!available) return;
    const ready = state.kind !== 'unavailable';
    const busy = state.kind === 'updating';
    const failure = state.kind === 'ready' ? state.failure : null;
    const expansion = ready ? workbench.getExpansionState() : null;
    const selected = selection();
    const expanded =
      selected !== null && expansion !== null && expansion.expandedClusterIds.includes(selected.clusterId);
    const description = describeSelection(selected, expanded);
    if (elements.selectionLabel) elements.selectionLabel.textContent = description.label;
    if (elements.expandSelected) elements.expandSelected.textContent = `Expand ${description.target}`;
    if (elements.collapseSelected) elements.collapseSelected.textContent = `Collapse ${description.target}`;
    if (elements.expandSelected)
      elements.expandSelected.disabled =
        !ready || busy || (expanded && selected?.manuallyCollapsed !== true) || selected?.expandable !== true;
    if (elements.collapseSelected)
      elements.collapseSelected.disabled =
        !ready || busy || selected?.manuallyCollapsed === true || (!expanded && selected?.collapsible !== true);
    for (const button of [elements.expandAll, elements.collapseAll]) if (button) button.disabled = !ready || busy;
    if (elements.keepExpanded) {
      elements.keepExpanded.disabled = !ready || busy;
      elements.keepExpanded.checked = expansion?.keepExpanded ?? false;
    }
    if (elements.feedback && failure) elements.feedback.textContent = failure;
    else if (expansion && !busy) show(expansion);
  }

  function show(state: ExpansionState) {
    const feedback = elements.feedback;
    if (!feedback) return;
    if (state.partial) {
      const limit = state.maxNodes === undefined ? '' : ` (limit ${state.maxNodes})`;
      feedback.textContent = `Partial result: ${state.renderedNodeCount} nodes shown${limit}. Some nodes remain unavailable in this view.`;
    } else if (state.manuallyCollapsedBranchCount) {
      const count = state.manuallyCollapsedBranchCount;
      const noun = count === 1 ? 'branch' : 'branches';
      feedback.textContent = `${count} ${noun} manually collapsed. Expand a marked node to restore its descendants.`;
    } else if (state.allExpanded) {
      feedback.textContent = `All nodes expanded: ${state.renderedNodeCount}.`;
    } else {
      feedback.textContent = `${state.expandedClusterIds.length} groups explicitly expanded.`;
    }
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
        void run(() => {
          const selected = selection();
          if (!selected) throw new Error('Select a node before expanding.');
          if (selected.manuallyCollapsed && selected.nodeId) return workbench.expandBranch(toNodeId(selected.nodeId));
          return workbench.expandCluster(selected.clusterId);
        });
      });
      bindings.on(elements.collapseSelected, 'click', () => {
        void run(() => {
          const selected = selection();
          if (!selected) throw new Error('Select a node before collapsing.');
          if (selected.collapsible && selected.nodeId) return workbench.collapseBranch(toNodeId(selected.nodeId));
          return workbench.collapseCluster(selected.clusterId);
        });
      });
      bindings.on(elements.expandAll, 'click', () => {
        void run(() => workbench.expandAll());
      });
      bindings.on(elements.collapseAll, 'click', () => {
        void run(() => workbench.collapseAll());
      });
      const keepExpanded = elements.keepExpanded;
      if (keepExpanded) {
        bindings.on(keepExpanded, 'change', () => {
          const keep = keepExpanded.checked;
          void run(() => workbench.setKeepExpanded(keep));
        });
      }
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
                nodeId: state.nodeId,
                expandable: state.attributes?.isClusterProxy === true || state.attributes?.isBranchCollapsed === true,
                collapsible: state.attributes?.canCollapseBranch === true,
                manuallyCollapsed: state.attributes?.isBranchCollapsed === true,
              },
      });
      update();
    },
    refreshGraph(graph: PositionedGraph) {
      const selected = selection();
      if (!selected?.nodeId) return;
      const node = graph.nodes.find(node => node.id === selected.nodeId);
      dispatch({
        kind: 'selected',
        selected: node
          ? {
              ...selected,
              clusterId: toClusterId(String(node.attributes?.clusterId ?? node.id)),
              expandable: node.attributes?.isClusterProxy === true || node.attributes?.isBranchCollapsed === true,
              collapsible: node.attributes?.canCollapseBranch === true,
              manuallyCollapsed: node.attributes?.isBranchCollapsed === true,
            }
          : null,
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

function describeSelection(selected: ExpansionSelection, expanded: boolean): { label: string; target: string } {
  if (!selected?.nodeId) {
    return { label: 'Select a node in the graph or search results.', target: 'selection' };
  }
  let kind = 'Leaf node';
  let target = 'selection';
  if (selected.manuallyCollapsed) {
    kind = 'Collapsed branch';
    target = 'branch';
  } else if (selected.collapsible) {
    kind = 'Internal node';
    target = 'branch';
  } else if (selected.expandable || expanded) {
    kind = 'Automatic group';
    target = 'group';
  }
  return { label: `Selected: ${selected.nodeId} · ${kind}`, target };
}
