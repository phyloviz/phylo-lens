import { afterEach, beforeEach, vi } from 'vitest';
import { GraphViewportCoordinator } from '../../../src/app/workbench/viewport/viewportCoordinator';

export function setupViewportHarness() {
  const controllers = new Set<GraphViewportCoordinator>();
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    try {
      controllers.forEach(controller => controller.unmount());
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
  class Coordinator extends GraphViewportCoordinator {
    constructor(...args: ConstructorParameters<typeof GraphViewportCoordinator>) {
      super(...args);
      controllers.add(this);
    }
    override mount() {
      controllers.add(this);
      super.mount();
    }
    override unmount() {
      controllers.delete(this);
      super.unmount();
    }
  }
  return { Coordinator };
}
