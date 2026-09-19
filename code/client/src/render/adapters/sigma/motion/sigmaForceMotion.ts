import type Graph from "graphology";
import forceAtlas2, { type ForceAtlas2Settings } from "graphology-layout-forceatlas2";
import ForceAtlas2Supervisor from "graphology-layout-forceatlas2/worker.js";
import type { Attributes } from "graphology-types";

export const DEFAULT_FORCE_MOTION_SETTINGS: ForceAtlas2Settings = {
  adjustSizes: false,
  barnesHutOptimize: true,
  strongGravityMode: false,
  gravity: 0.02,
  scalingRatio: 18,
  slowDown: 10,
};
export interface SigmaForceMotionOptions {
  enabled?: boolean;
  settings?: ForceAtlas2Settings;
}
export interface SigmaForceMotionCallbacks {
  onTick?: () => void;
  constrain?: (id: string, attributes: Attributes) => Attributes;
}

/** Motion is user-controlled and independent of server/client layout provenance. */
export default function createSigmaForceMotion(
  options: SigmaForceMotionOptions = {},
  callbacks: SigmaForceMotionCallbacks = {},
) {
  let supervisor: ForceAtlas2Supervisor | null = null;
  let graph: Graph | null = null;
  let enabled = options.enabled !== false;
  let suspended = false;
  const updated = () => callbacks.onTick?.();

  function stop(): void {
    supervisor?.kill();
    supervisor = null;
    graph?.off("eachNodeAttributesUpdated", updated);
  }
  function resume(): void {
    if (!enabled || suspended || !graph || graph.order < 2 || !graph.size || supervisor) return;
    supervisor = new ForceAtlas2Supervisor(graph, {
      settings: { ...forceAtlas2.inferSettings(graph), ...DEFAULT_FORCE_MOTION_SETTINGS, ...options.settings },
      getEdgeWeight: () => 1,
      outputReducer: callbacks.constrain,
    });
    graph.on("eachNodeAttributesUpdated", updated);
    supervisor.start();
  }
  return {
    start: (next: Graph) => {
      stop();
      graph = next;
      resume();
    },
    stop,
    setEnabled: (value: boolean) => {
      enabled = value;
      if (value) resume();
      else stop();
    },
    isEnabled: () => enabled,
    suspend: (value: boolean) => {
      suspended = value;
      if (value) stop();
      else resume();
    },
    dispose: () => {
      stop();
      graph = null;
    },
  };
}
