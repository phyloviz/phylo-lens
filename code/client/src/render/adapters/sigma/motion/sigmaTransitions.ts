import type Graph from 'graphology';
import type Sigma from 'sigma';
import type { PositionedGraph } from '../../../../contracts/positioned';
import type { DisplayPositions, Point } from './displayPositions';
import type createSigmaForceMotion from './sigmaForceMotion';
import { isString } from '../../../../validation/guards';

type TransitionAnchor = {
  readonly ids: readonly string[];
  readonly screen: Point;
};

type SigmaTransitionsOptions = {
  readonly getGraph: () => Graph | null;
  readonly getSigma: () => Sigma | null;
  readonly positions: Pick<DisplayPositions, 'set'>;
  readonly motion: Pick<ReturnType<typeof createSigmaForceMotion>, 'start' | 'suspend'>;
  readonly onManipulationChanged: (active: boolean) => void;
  readonly onComplete: () => void;
};

const TRANSITION_DURATION_MS = 240;

export default function createSigmaTransitions(options: SigmaTransitionsOptions) {
  let frameId: number | null = null;
  let active = false;
  let sequence = 0;
  let zoomPointer: Point | null = null;
  let anchor: TransitionAnchor | null = null;

  return {
    isActive: () => active,
    setZoomPointer: (point: Point) => {
      zoomPointer = { ...point };
    },
    captureAnchor,
    start,
    cancel,
  };

  function cancel(): void {
    sequence += 1;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    anchor = null;
    active = false;
    options.motion.suspend(false);
  }

  // Capture focus before the renderer replaces the old graph's nodes.
  function captureAnchor(next: PositionedGraph): void {
    const graph = options.getGraph();
    const sigma = options.getSigma();
    anchor = null;
    if (!graph || !sigma) return;

    const dimensions = sigma.getDimensions();
    const focus = zoomPointer ?? { x: dimensions.width / 2, y: dimensions.height / 2 };
    const nextIds = new Set(next.nodes.map(node => node.id));
    const nextClusters = new Map<string, string[]>();

    for (const node of next.nodes) {
      const cluster = node.attributes?.clusterId;
      if (isString(cluster)) {
        const ids = nextClusters.get(cluster) ?? [];
        ids.push(node.id);
        nextClusters.set(cluster, ids);
      }
    }

    let nearestDistance = Infinity;
    graph.forEachNode((id, attributes) => {
      const ids = nextIds.has(id) ? [id] : (nextClusters.get(attributes.clusterId) ?? []);
      if (!ids.length) return; // Never guess parentage between unrelated levels.

      const screen = sigma.graphToViewport({ x: attributes.x, y: attributes.y });
      const distance = Math.hypot(screen.x - focus.x, screen.y - focus.y);

      if (distance < nearestDistance) {
        anchor = { ids, screen };
        nearestDistance = distance;
      }
    });
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
      preserveFocus(graph);
      if (currentSequence !== sequence) return;

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        frameId = null;
        active = false;
        anchor = null;
        options.motion.start(graph);
        options.motion.suspend(false);
        options.onManipulationChanged(false);
        options.onComplete();
      }
    };
    frameId = requestAnimationFrame(tick);
  }

  function preserveFocus(graph: Graph): void {
    const sigma = options.getSigma();
    if (!anchor || !sigma) return;

    const { ids, screen } = anchor;
    const point = ids.reduce(
      (sum, id) => {
        const attributes = graph.getNodeAttributes(id);
        return { x: sum.x + attributes.x / ids.length, y: sum.y + attributes.y / ids.length };
      },
      { x: 0, y: 0 }
    );
    const camera = sigma.getCamera();
    const cameraState = camera.getState();
    const projection = { cameraState };
    const current = sigma.viewportToFramedGraph(sigma.graphToViewport(point, projection), projection);
    const desired = sigma.viewportToFramedGraph(screen, projection);
    camera.setState({ x: cameraState.x + current.x - desired.x, y: cameraState.y + current.y - desired.y });
  }
}
