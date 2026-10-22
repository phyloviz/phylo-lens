import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';

export type ArrangementControlsElements = {
  readonly motionInput?: HTMLInputElement;
  readonly branchRootButton?: HTMLButtonElement;
  readonly singleDragButton?: HTMLButtonElement;
  readonly resetLayoutButton?: HTMLButtonElement;
  readonly dragStatus?: HTMLElement;
  readonly relaxLayoutButton?: HTMLButtonElement;
  readonly stopLayoutButton?: HTMLButtonElement;
  readonly layoutMotionStatus?: HTMLElement;
};

type ArrangementWorkbench = Pick<
  GraphWorkbench,
  | 'setMotionEnabled'
  | 'setInteractionFeedbackHandler'
  | 'setDragSelection'
  | 'resetLayoutEdits'
  | 'relaxLayout'
  | 'stopLayout'
  | 'getLayoutMotionState'
  | 'setLayoutMotionHandler'
>;

const DIRECT_DRAG_STATUS = 'Direct dragging. Enable automatic relaxation for connected nodes to react.';

export default function createArrangementControls(
  workbench: ArrangementWorkbench,
  elements: ArrangementControlsElements
) {
  const { motionInput, branchRootButton, singleDragButton, resetLayoutButton, dragStatus } = elements;
  const bindings = eventBindings();
  let selectedNodeId: string | null = null;
  let ready = false;

  return {
    mount,
    unmount,
    selectNode,
    reset,
    setReady: (value: boolean) => {
      ready = value;
      refresh();
    },
  };

  function refresh(): void {
    const state = workbench.getLayoutMotionState();
    if (motionInput) motionInput.checked = state.automatic;
    if (elements.relaxLayoutButton) elements.relaxLayoutButton.disabled = !ready || state.running;
    if (elements.stopLayoutButton) elements.stopLayoutButton.disabled = !state.running && !state.automatic;
    const status = elements.layoutMotionStatus;
    if (!status) return;
    if (state.running) {
      status.textContent = 'Relaxing the loaded view…';
    } else if (state.automatic) {
      status.textContent = 'Automatic relaxation enabled. Settled positions are retained.';
    } else {
      status.textContent = 'Manual layout. Zoom preserves positions; use Relax layout when needed.';
    }
  }

  function mount(): void {
    workbench.setLayoutMotionHandler(refresh);
    refresh();
    bindings.on(elements.relaxLayoutButton, 'click', () => {
      workbench.relaxLayout();
      refresh();
    });
    bindings.on(elements.stopLayoutButton, 'click', () => {
      workbench.stopLayout();
      refresh();
    });
    if (motionInput) {
      bindings.on(motionInput, 'change', () => workbench.setMotionEnabled(motionInput.checked));
    }
    workbench.setInteractionFeedbackHandler(message => {
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
    workbench.setDragSelection({ kind: 'node' });
    selectNode(null);
    if (dragStatus) dragStatus.textContent = DIRECT_DRAG_STATUS;
  }

  function unmount(): void {
    bindings.clear();
    workbench.setInteractionFeedbackHandler(null);
    workbench.setLayoutMotionHandler(null);
  }
}
