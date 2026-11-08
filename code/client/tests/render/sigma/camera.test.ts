import { centerCameraOnCoordinates } from '../../../src/render/adapters/sigma/camera/sigmaCameraState';
import { expect, it, vi } from 'vitest';

it('does not suppress the next user event when centering is a camera no-op', () => {
  const beforeSetState = vi.fn(),
    setState = vi.fn();
  const sigma = {
    getCamera: () => ({ getState: () => ({ x: 1, y: 2, ratio: 0.02 }), setState }),
    graphToViewport: (p: { x: number; y: number }) => p,
    viewportToFramedGraph: (p: { x: number; y: number }) => p,
  };
  expect(centerCameraOnCoordinates({ sigma: sigma as never, x: 1, y: 2, beforeSetState })).toBe(true);
  expect(beforeSetState).not.toHaveBeenCalled();
  expect(setState).not.toHaveBeenCalled();
});
