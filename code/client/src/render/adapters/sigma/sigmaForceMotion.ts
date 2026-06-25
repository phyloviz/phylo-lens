import type Graph from "graphology";
import forceAtlas2, {
  type ForceAtlas2Settings,
} from "graphology-layout-forceatlas2";
import ForceAtlas2Supervisor from "graphology-layout-forceatlas2/worker";

import {
  LAYOUT_FORCE,
  type PositionedGraph,
} from "../../../contracts/positioned";

export const DEFAULT_FORCE_MOTION_DURATION_MS = 4_000;
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
  durationMs?: number;
  settings?: ForceAtlas2Settings;
}

export interface SigmaForceMotionCallbacks {
  onTick?: () => void;
}

export default function createSigmaForceMotion(
  options: SigmaForceMotionOptions = {},
  callbacks: SigmaForceMotionCallbacks = {},
): {
  start: (graph: Graph, positionedGraph: PositionedGraph) => void;
  stop: () => void;
} {
  let supervisor: ForceAtlas2Supervisor | null = null;
  let stopTimerId: number | null = null;
  let tickFrameId: number | null = null;

  return {
    start: start,
    stop: stop,
  };

  function start(graph: Graph, positionedGraph: PositionedGraph): void {
    stop();

    if (
      options.enabled === false ||
      !isForceMotionLayout(positionedGraph) ||
      graph.order < 2 ||
      graph.size < 1
    ) {
      return;
    }

    supervisor = new ForceAtlas2Supervisor(graph, {
      settings: {
        ...forceAtlas2.inferSettings(graph),
        ...DEFAULT_FORCE_MOTION_SETTINGS,
        ...options.settings,
      },
    });
    supervisor.start();
    tick();

    const durationMs = options.durationMs ?? DEFAULT_FORCE_MOTION_DURATION_MS;
    if (durationMs > 0) {
      stopTimerId = window.setTimeout(() => {
        stopTimerId = null;
        stop();
      }, durationMs);
    }
  }

  function stop(): void {
    if (stopTimerId !== null) {
      window.clearTimeout(stopTimerId);
      stopTimerId = null;
    }

    if (tickFrameId !== null) {
      window.cancelAnimationFrame(tickFrameId);
      tickFrameId = null;
    }

    supervisor?.kill();
    supervisor = null;
  }

  function tick(): void {
    callbacks.onTick?.();
    tickFrameId = window.requestAnimationFrame(tick);
  }
}

function isForceMotionLayout(graph: PositionedGraph): boolean {
  return graph.viewMeta.layout === LAYOUT_FORCE;
}
