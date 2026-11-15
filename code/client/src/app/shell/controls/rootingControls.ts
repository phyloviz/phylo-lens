import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import type { PositionedNode } from '../../../contracts/positioned';
import { toNodeId } from '../../../contracts/graph/graphIdentifiers';
import { toError } from '../../errors';
import eventBindings from '../events/eventBindings';

export type RootingControlsElements = {
  readonly technicalRootButton?: HTMLButtonElement;
  readonly resetRootsButton?: HTMLButtonElement;
  readonly technicalRootStatus?: HTMLElement;
};

export function rootingControls(
  workbench: Pick<GraphWorkbench, 'setTechnicalRoot' | 'getTechnicalRoots' | 'canSetTechnicalRoot' | 'getComponentId'>,
  elements: RootingControlsElements,
  onChanged: () => Promise<void>
) {
  const bindings = eventBindings();
  let selected: string | null = null;
  let selectedComponent: string | undefined;
  let ready = false;
  let pending = false;
  let generation = 0;
  const feedback = elements.technicalRootStatus;

  function refresh(): void {
    const enabled = ready && !pending && workbench.canSetTechnicalRoot();
    if (elements.technicalRootButton)
      elements.technicalRootButton.disabled =
        !enabled ||
        selected === null ||
        (selectedComponent ? selectedComponent === selected : workbench.getTechnicalRoots().includes(selected));
    if (elements.resetRootsButton) elements.resetRootsButton.disabled = !enabled;
    if (feedback && !pending) {
      const roots = workbench.getTechnicalRoots();
      const component = selectedComponent ?? workbench.getComponentId();
      if (!workbench.canSetTechnicalRoot()) feedback.textContent = 'This backend does not provide technical rerooting.';
      else if (component) feedback.textContent = `Technical root: ${component}.`;
      else if (roots.length > 3)
        feedback.textContent = `Technical roots (${roots.length.toLocaleString()}): ${roots.slice(0, 3).join(', ')}, … Select a group to inspect its root.`;
      else
        feedback.textContent = roots.length
          ? `Technical ${roots.length === 1 ? 'root' : 'roots'}: ${roots.join(', ')}.`
          : 'Select an ordinary tree node to change its technical root.';
    }
  }

  async function apply(nodeId: string | null): Promise<void> {
    const current = generation;
    const previousRoots = workbench.getTechnicalRoots();
    pending = true;
    refresh();
    if (feedback) feedback.textContent = 'Rebuilding rooted branches and detail levels…';
    try {
      await workbench.setTechnicalRoot(nodeId === null ? null : toNodeId(nodeId));
      if (current !== generation) return;
      const roots = workbench.getTechnicalRoots();
      const changed =
        roots.length !== previousRoots.length || roots.some((root, index) => root !== previousRoots[index]);
      if (changed) await onChanged();
      if (current !== generation) return;
      pending = false;
      refresh();
      if (feedback)
        feedback.textContent += changed
          ? ' Branch folds and distance connections were cleared.'
          : ' Orientation is unchanged.';
    } catch (error) {
      if (current !== generation) return;
      pending = false;
      refresh();
      if (feedback) feedback.textContent = toError(error).message;
    }
  }

  return {
    mount() {
      bindings.on(elements.technicalRootButton, 'click', () => {
        if (selected !== null) void apply(selected);
      });
      bindings.on(elements.resetRootsButton, 'click', () => void apply(null));
      refresh();
    },
    select(node: PositionedNode | undefined) {
      selected = node && node.attributes?.isClusterProxy !== true ? node.id : null;
      selectedComponent = selected ? node?.attributes?.treeIndex?.componentId : undefined;
      refresh();
    },
    setReady(value: boolean) {
      ready = value;
      refresh();
    },
    reset() {
      generation++;
      pending = false;
      ready = false;
      selected = null;
      selectedComponent = undefined;
      refresh();
    },
    unmount() {
      generation++;
      bindings.clear();
    },
  };
}
