import bootstrap from '../../src/app/bootstrap';
import Sigma from 'sigma';
import type { CameraState } from 'sigma/types';
import type { AnimateOptions } from 'sigma/utils';

// Observe the same public Sigma module as the product without exposing app internals.
const originalGetCamera = Sigma.prototype.getCamera;
const view = { completedAnimations: 0 };
const observedCameras = new WeakSet();
Sigma.prototype.getCamera = function () {
  Object.assign(window, { requirementsSigma: this });
  const camera = originalGetCamera.call(this);
  if (!observedCameras.has(camera)) {
    observedCameras.add(camera);
    const animate = camera.animate.bind(camera);
    function observedAnimate(state: Partial<CameraState>, options: Partial<AnimateOptions>, callback: () => void): void;
    function observedAnimate(state: Partial<CameraState>, options?: Partial<AnimateOptions>): Promise<void>;
    function observedAnimate(
      state: Partial<CameraState>,
      options?: Partial<AnimateOptions>,
      callback?: () => void
    ): void | Promise<void> {
      // Preserve both real overloads, including delayed initial fits and completion callbacks.
      if (callback)
        return animate(state, options ?? {}, () => {
          view.completedAnimations++;
          callback();
        });
      return animate(state, options).then(() => {
        view.completedAnimations++;
      });
    }
    camera.animate = observedAnimate;
  }
  return camera;
};
Object.assign(window, { requirementsView: view, requirementsShell: bootstrap() });
window.addEventListener('pagehide', () => {
  Sigma.prototype.getCamera = originalGetCamera;
});
