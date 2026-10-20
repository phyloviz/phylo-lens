import bootstrap from '../../src/app/bootstrap';
import Sigma from 'sigma';

// Observe the same public Sigma module as the product without exposing app internals.
const originalGetCamera = Sigma.prototype.getCamera;
Sigma.prototype.getCamera = function () {
  Object.assign(window, { requirementsSigma: this });
  return originalGetCamera.call(this);
};
Object.assign(window, { requirementsShell: bootstrap() });
window.addEventListener('pagehide', () => {
  Sigma.prototype.getCamera = originalGetCamera;
});
