import type Graph from 'graphology';
import ElasticWorker from './elastic.worker?worker&inline';
import type { MotionCommand, MotionFrame } from './elastic.worker';
import type { MotionPoint, MotionSettings } from './elasticSimulation';
import type { Point } from '../../../../contracts/Point';

export type SigmaForceMotionOptions = {
  readonly enabled?: boolean;
  readonly settings?: MotionSettings;
};
export interface SigmaForceMotionCallbacks {
  onTick?: () => void;
  onError?: (message: string) => void;
  reference: (id: string) => Point | undefined;
  anchor: (id: string) => Point | undefined;
  collisionRadius?: (id: string, size: number) => number | undefined;
  constrain: (id: string, point: Point) => Point;
}

/** Pause terminates the inline worker. Instance and revision checks reject
 * queued frames from before pause, graph replacement, or a grab/release boundary.
 */
export default function createSigmaForceMotion(
  options: SigmaForceMotionOptions = {},
  callbacks: SigmaForceMotionCallbacks
) {
  const settings = { ...options.settings };
  let worker: Worker | null = null,
    graph: Graph | null = null;
  let enabled = options.enabled !== false,
    suspended = false,
    revision = 0,
    minimumRevision = 0;
  let pins: MotionPoint[] = [];
  let geometryTimer: ReturnType<typeof setTimeout> | undefined;
  let previousRadius: number | undefined;
  function radius() {
    if (!graph?.order) return undefined;
    const id = graph.findNode(() => true)!;
    return callbacks.collisionRadius?.(id, graph.getNodeAttribute(id, 'size') ?? 5);
  }
  function stop() {
    clearTimeout(geometryTimer);
    geometryTimer = undefined;
    worker?.terminate();
    worker = null;
    minimumRevision = ++revision;
  }
  function send(command: MotionCommand) {
    worker?.postMessage(command);
  }
  function resume() {
    if (!enabled || suspended || !graph || graph.order < 2 || worker) return;
    try {
      const active = new ElasticWorker();
      worker = active;
      previousRadius = radius();
      const ids = graph.nodes();
      const indices = new Map(ids.map((id, i) => [id, i]));

      active.onmessage = ({ data }: MessageEvent<MotionFrame>) => {
        if (worker !== active || data.revision < minimumRevision || !graph) return;
        graph.updateEachNodeAttributes(
          (id, attributes) => {
            const i = indices.get(id)!;
            const point = callbacks.constrain(id, {
              x: data.positions[i * 2],
              y: data.positions[i * 2 + 1],
            });
            return { ...attributes, ...point };
          },
          { attributes: ['x', 'y'] }
        );
        callbacks.onTick?.();
      };
      active.onerror = () => {
        if (worker === active) {
          stop();
          callbacks.onError?.('Motion stopped because its worker failed. You can still arrange nodes with Motion off.');
        }
      };

      send({
        type: 'start',
        revision,
        settings,
        graph: {
          nodes: graph.mapNodes((id, a) => {
            const reference = callbacks.reference(id) ?? (a as Point),
              anchor = callbacks.anchor(id) ?? (a as Point);

            return {
              id,
              x: a.x,
              y: a.y,
              referenceX: reference.x,
              referenceY: reference.y,
              anchorX: anchor.x,
              anchorY: anchor.y,
              collisionRadius: callbacks.collisionRadius?.(id, typeof a.size === 'number' ? a.size : 5),
              size: typeof a.size === 'number' && Number.isFinite(a.size) && a.size > 0 ? a.size : undefined,
            };
          }),
          links: graph.mapEdges((_id, _a, source, target) => ({ source, target })),
        },
      });

      if (pins.length) send({ type: 'pin', revision, points: pins, released: [] });
    } catch (error) {
      stop();
      callbacks.onError?.(`Motion could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    start(next: Graph) {
      stop();
      graph = next;
      resume();
    },
    stop,
    // Camera translation does not change glyph footprints. Reheat only after a
    // meaningful scale/resize change and debounce animations; never reset anchors.
    refreshGeometry() {
      if (!enabled || suspended || !graph) return;
      const next = radius();
      if (
        next === undefined ||
        (previousRadius !== undefined && Math.abs(next - previousRadius) <= previousRadius * 0.05)
      )
        return;
      clearTimeout(geometryTimer);
      geometryTimer = setTimeout(() => {
        stop();
        resume();
      }, 120);
    },
    setPins(points: readonly MotionPoint[], released: readonly MotionPoint[] = []) {
      const changedMembers = points.length !== pins.length || points.some((point, i) => point.id !== pins[i]?.id);
      pins = points.map(point => ({ ...point }));
      revision++;
      // During a continuous drag, accept slightly older neighbour updates while
      // the renderer holds the grabbed nodes at the latest pointer position.
      // Reject old frames at grab/release boundaries, not on every mousemove.
      if (changedMembers || released.length) minimumRevision = revision;
      send({ type: 'pin', revision, points: pins, released });
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (value) resume();
      else stop();
    },
    isEnabled: () => enabled,
    suspend(value: boolean) {
      suspended = value;
      if (value) stop();
      else resume();
    },
    dispose() {
      stop();
      graph = null;
      pins = [];
    },
  };
}
