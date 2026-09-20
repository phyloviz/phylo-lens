import type Graph from "graphology";
import ElasticWorker from "./elastic.worker?worker&inline";
import type { MotionCommand, MotionFrame } from "./elastic.worker";
import type { MotionPoint, MotionSettings } from "./elasticSimulation";
import type { Point } from "./displayPositions";

export interface SigmaForceMotionOptions {
  enabled?: boolean;
  settings?: MotionSettings;
}
export interface SigmaForceMotionCallbacks {
  onTick?: () => void;
  onError?: (message: string) => void;
  reference: (id: string) => Point | undefined;
  anchor: (id: string) => Point | undefined;
  constrain: (id: string, point: Point) => Point;
}

/** Pause terminates the inline worker. Instance and revision checks reject
 * queued frames from before pause, graph replacement, or a grab/release boundary.
 */
export default function createSigmaForceMotion(
  options: SigmaForceMotionOptions = {},
  callbacks: SigmaForceMotionCallbacks,
) {
  let worker: Worker | null = null,
    graph: Graph | null = null;
  let enabled = options.enabled !== false,
    suspended = false,
    revision = 0,
    minimumRevision = 0;
  let pins: MotionPoint[] = [];
  function stop() {
    worker?.terminate();
    worker = null;
    minimumRevision = ++revision;
  }
  function send(command: MotionCommand) {
    worker?.postMessage(command);
  }
  function resume() {
    if (!enabled || suspended || !graph || graph.order < 2 || !graph.size || worker) return;
    try {
      const active = new ElasticWorker();
      worker = active;
      const ids = graph.nodes();
      const indices = new Map(ids.map((id, i) => [id, i]));
      active.onmessage = ({ data }: MessageEvent<MotionFrame>) => {
        if (worker !== active || data.revision < minimumRevision || !graph) return;
        graph.updateEachNodeAttributes(
          (id, attributes) => {
            const i = indices.get(id)!;
            const point = callbacks.constrain(id, { x: data.positions[i * 2], y: data.positions[i * 2 + 1] });
            return { ...attributes, ...point };
          },
          { attributes: ["x", "y"] },
        );
        callbacks.onTick?.();
      };
      active.onerror = () => {
        if (worker === active) {
          stop();
          callbacks.onError?.("Motion stopped because its worker failed. You can still arrange nodes with Motion off.");
        }
      };
      send({
        type: "start",
        revision,
        settings: options.settings ?? {},
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
            };
          }),
          links: graph.mapEdges((_id, _a, source, target) => ({ source, target })),
        },
      });
      if (pins.length) send({ type: "pin", revision, points: pins, released: [] });
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
    setPins(points: MotionPoint[], released: MotionPoint[] = []) {
      const changedMembers = points.length !== pins.length || points.some((point, i) => point.id !== pins[i]?.id);
      pins = points;
      revision++;
      // During a continuous drag, accept slightly older neighbour updates while
      // the renderer holds the grabbed nodes at the latest pointer position.
      // Reject old frames at grab/release boundaries, not on every mousemove.
      if (changedMembers || released.length) minimumRevision = revision;
      send({ type: "pin", revision, points, released });
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
