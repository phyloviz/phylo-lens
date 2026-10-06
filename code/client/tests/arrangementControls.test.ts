import { expect, it, vi } from 'vitest';
import createArrangementControls from '../src/app/shell/controls/arrangementControls';

it('owns arrangement actions and releases listeners and feedback on unmount', () => {
  const workbench = {
    isMotionEnabled: () => true,
    setMotionEnabled: vi.fn(),
    setInteractionFeedbackHandler: vi.fn(),
    setDragSelection: vi.fn(),
    resetLayoutEdits: vi.fn(),
  };
  const motionInput = document.createElement('input');
  const branchRootButton = document.createElement('button');
  const singleDragButton = document.createElement('button');
  const resetLayoutButton = document.createElement('button');
  const controls = createArrangementControls(workbench, {
    motionInput,
    branchRootButton,
    singleDragButton,
    resetLayoutButton,
  });
  controls.mount();
  expect(motionInput.checked).toBe(true);
  controls.selectNode('a');
  branchRootButton.click();
  expect(workbench.setDragSelection).toHaveBeenCalledWith({ kind: 'branch', rootId: 'a' });
  resetLayoutButton.click();
  expect(workbench.resetLayoutEdits).toHaveBeenCalledTimes(1);
  expect(motionInput.checked).toBe(false);
  expect(branchRootButton.disabled).toBe(true);

  controls.unmount();
  expect(workbench.setInteractionFeedbackHandler).toHaveBeenLastCalledWith(null);
  workbench.setDragSelection.mockClear();
  singleDragButton.click();
  motionInput.dispatchEvent(new Event('change'));
  expect(workbench.setDragSelection).not.toHaveBeenCalled();
  expect(workbench.setMotionEnabled).not.toHaveBeenCalled();
});
