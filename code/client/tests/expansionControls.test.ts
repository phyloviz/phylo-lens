import { toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { describe, expect, it, vi } from 'vitest';
import { expansionControls } from '../src/app/shell/controls/expansionControls';
import type { GraphWorkbench } from '../src/app/workbench/graphWorkbench.types';

describe('expansion controls', () => {
  it("preserves a checkbox's new value and surfaces partial results and errors", async () => {
    const state = {
      keepExpanded: false,
      expandedClusterIds: [],
      allExpanded: false,
      partial: false,
      renderedNodeCount: 2,
      maxNodes: 10,
    };
    const workbench = {
      getExpansionState: () => state,
      setKeepExpanded: vi.fn((keep: boolean) => {
        state.keepExpanded = keep;
        return state;
      }),
      expandAll: vi.fn(async () => {
        state.partial = true;
        state.renderedNodeCount = 10;
        return { ...state, status: 'partial' as const };
      }),
      collapseAll: vi.fn(async () => {
        throw new Error('Network unavailable');
      }),
      expandCluster: vi.fn(),
      collapseCluster: vi.fn(),
      collapseBranch: vi.fn(),
      expandBranch: vi.fn(),
    } satisfies Pick<
      GraphWorkbench,
      | 'getExpansionState'
      | 'setKeepExpanded'
      | 'expandAll'
      | 'collapseAll'
      | 'expandCluster'
      | 'collapseCluster'
      | 'expandBranch'
      | 'collapseBranch'
    >;
    const keepExpanded = document.createElement('input');
    keepExpanded.type = 'checkbox';
    const expandAll = document.createElement('button');
    const collapseAll = document.createElement('button');
    const feedback = document.createElement('p');
    const controls = expansionControls(workbench, { keepExpanded, expandAll, collapseAll, feedback });
    document.body.append(keepExpanded, expandAll, collapseAll, feedback);
    controls.mount();
    controls.setReady(true);
    keepExpanded.click();
    await Promise.resolve();
    expect(workbench.setKeepExpanded).toHaveBeenCalledWith(true);
    expect(keepExpanded.checked).toBe(true);
    expandAll.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(feedback.textContent).toContain('Partial result: 10 nodes shown (limit 10)');
    collapseAll.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(feedback.textContent).toContain('Network unavailable');
    controls.dispose();
  });
});

it('routes indexed members and manual markers by node ID within an expanded group', async () => {
  const group = toClusterId('shared-group');
  const state = {
    keepExpanded: false,
    expandedClusterIds: [group],
    allExpanded: false,
    partial: false,
    renderedNodeCount: 3,
  };
  const workbench = {
    getExpansionState: () => state,
    setKeepExpanded: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    expandCluster: vi.fn(),
    collapseCluster: vi.fn(),
    expandBranch: vi.fn(() => state),
    collapseBranch: vi.fn(() => state),
  };
  const expandSelected = document.createElement('button');
  const collapseSelected = document.createElement('button');
  const controls = expansionControls(workbench, { expandSelected, collapseSelected });
  controls.mount();
  controls.setReady(true);
  controls.select({ nodeId: 'internal', attributes: { clusterId: group, canCollapseBranch: true } });
  expect(collapseSelected.disabled).toBe(false);
  collapseSelected.click();
  await Promise.resolve();
  expect(workbench.collapseBranch).toHaveBeenCalledWith('internal');
  expect(workbench.collapseCluster).not.toHaveBeenCalled();
  controls.select({ nodeId: 'internal', attributes: { clusterId: group, isBranchCollapsed: true } });
  expect(expandSelected.disabled).toBe(false);
  expandSelected.click();
  await Promise.resolve();
  expect(workbench.expandBranch).toHaveBeenCalledWith('internal');
  expect(workbench.expandCluster).not.toHaveBeenCalled();
  controls.dispose();
});
