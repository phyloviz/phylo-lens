import type Graph from 'graphology';
import type Sigma from 'sigma';
import type { DisplayPositions } from './displayPositions';
import type { Point } from '../../../../contracts/Point';
import type createSigmaForceMotion from './sigmaForceMotion';

type SigmaTransitionsOptions = {
  readonly getGraph: () => Graph | null;
  readonly getSigma: () => Sigma | null;
  readonly positions: Pick<DisplayPositions, 'set'>;
  readonly motion: Pick<ReturnType<typeof createSigmaForceMotion>, 'start' | 'suspend'>;
  readonly onManipulationChanged: (active: boolean) => void;
  readonly onComplete: () => void;
};

const TRANSITION_DURATION_MS = 240;

// Animate node positions in the prepared coordinate frame. The camera belongs
// to user navigation and explicit fits, never to a changing aggregate centroid.
export default function createSigmaTransitions(options: SigmaTransitionsOptions) {
  let frameId: number | null = null;
  let active = false;
  let sequence = 0;

  return {
    isActive: () => active,
    start,
    cancel,
  };

  function cancel(): void {
    sequence += 1;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    active = false;
    options.motion.suspend(false);
  }

  function start(targets: ReadonlyMap<string, Point>): void {
    const graph = options.getGraph();
    if (!graph) return;

    if (frameId !== null) {
      cancelAnimationFrame(frameId);
    }

    const currentSequence = ++sequence;
    const steps = Array.from(targets, ([id, target]) => {
      const attributes = graph.getNodeAttributes(id);
      return { id, from: { x: attributes.x, y: attributes.y }, to: { ...target } };
    });

    active = true;
    options.motion.suspend(true);
    options.onManipulationChanged(true);
    if (currentSequence !== sequence) return;
    const startedAt = performance.now();

    const tick = (now: number): void => {
      // A cancelled callback may already be queued; it must not affect a newer view.
      if (currentSequence !== sequence || options.getGraph() !== graph) return;
      const progress = Math.min(1, (now - startedAt) / TRANSITION_DURATION_MS);
      const eased = progress * progress * (3 - 2 * progress);

      for (const { id, from, to } of steps) {
        graph.mergeNodeAttributes(
          id,
          options.positions.set(id, {
            x: from.x + (to.x - from.x) * eased,
            y: from.y + (to.y - from.y) * eased,
          })
        );
      }

      options.getSigma()?.refresh();
      if (currentSequence !== sequence) return;

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        frameId = null;
        active = false;
        options.motion.start(graph);
        options.motion.suspend(false);
        options.onManipulationChanged(false);
        options.onComplete();
      }
    };
    frameId = requestAnimationFrame(tick);
  }
}
