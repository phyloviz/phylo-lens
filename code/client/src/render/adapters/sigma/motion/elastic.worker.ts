import { createElasticSimulation, type MotionGraph, type MotionPoint, type MotionSettings } from "./elasticSimulation";

export type MotionCommand =
  | { type: "start"; graph: MotionGraph; settings: MotionSettings; revision: number }
  | { type: "pin"; points: MotionPoint[]; released: MotionPoint[]; revision: number };

export interface MotionFrame {
  positions: Float64Array;
  revision: number;
  settled: boolean;
}

let simulation: ReturnType<typeof createElasticSimulation> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;

function frame() {
  timer = undefined;
  if (!simulation) return;
  simulation.tick(2);

  const positions = simulation.positions();
  const settled = simulation.settled();

  postMessage({ positions, revision, settled } satisfies MotionFrame, { transfer: [positions.buffer] });
  if (!settled) timer = setTimeout(frame, 16);
}

self.onmessage = ({ data }: MessageEvent<MotionCommand>) => {
  revision = data.revision;
  if (data.type === "start") {
    simulation = createElasticSimulation(data.graph, data.settings);
  } else {
    simulation?.pin(data.points, data.released);
  }

  if (timer === undefined) timer = setTimeout(frame, 0);
};
