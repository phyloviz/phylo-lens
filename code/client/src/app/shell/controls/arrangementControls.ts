import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';

export type ArrangementControlsElements = {
  readonly motionInput?: HTMLInputElement;
  readonly branchRootButton?: HTMLButtonElement;
  readonly singleDragButton?: HTMLButtonElement;
  readonly resetLayoutButton?: HTMLButtonElement;
  readonly dragStatus?: HTMLElement;
};

type ArrangementWorkbench = Pick<
  GraphWorkbench,
  'isMotionEnabled' | 'setMotionEnabled' | 'setInteractionFeedbackHandler' | 'setDragSelection' | 'resetLayoutEdits'
>;

const DIRECT_DRAG_STATUS = 'Direct dragging: connected nodes react while Motion is on.';

export default function createArrangementControls(
  workbench: ArrangementWorkbench,
  elements: ArrangementControlsElements
) {
  const { motionInput, branchRootButton, singleDragButton, resetLayoutButton, dragStatus } = elements;
  const bindings = eventBindings();
  let selectedNodeId: string | null = null;

  return { mount, unmount, selectNode, reset };

  function mount(): void {
    if (motionInput) {
      motionInput.checked = workbench.isMotionEnabled?.() ?? true;
      bindings.on(motionInput, 'change', () => workbench.setMotionEnabled(motionInput.checked));
    }
    workbench.setInteractionFeedbackHandler?.(message => {
      if (dragStatus) dragStatus.textContent = message;
    });
    bindings.on(branchRootButton, 'click', () => {
      if (!selectedNodeId) return;
      workbench.setDragSelection({ kind: 'branch', rootId: selectedNodeId });
      if (dragStatus) dragStatus.textContent = `Drag branches away from arrangement root: ${selectedNodeId}.`;
    });
    bindings.on(singleDragButton, 'click', () => {
      workbench.setDragSelection({ kind: 'node' });
      if (dragStatus) dragStatus.textContent = DIRECT_DRAG_STATUS;
    });
    bindings.on(resetLayoutButton, 'click', () => {
      workbench.resetLayoutEdits();
      if (motionInput) motionInput.checked = false;
      reset();
    });
  }

  function selectNode(nodeId: string | null): void {
    selectedNodeId = nodeId;
    if (branchRootButton) branchRootButton.disabled = nodeId === null;
  }

  function reset(): void {
    selectNode(null);
    if (dragStatus) dragStatus.textContent = DIRECT_DRAG_STATUS;
  }

  function unmount(): void {
    bindings.clear();
    workbench.setInteractionFeedbackHandler?.(null);
  }
}
