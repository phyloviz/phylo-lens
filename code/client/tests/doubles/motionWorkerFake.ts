import { vi } from 'vitest';
import { createElasticSimulation } from '../../src/render/adapters/sigma/motion/elasticSimulation';
import type { MotionCommand, MotionFrame } from '../../src/render/adapters/sigma/motion/elastic.worker';

/** Protocol tests deliver frames explicitly; renderer/physics tests can opt into real ticks. */
export function createMotionWorkerDoubles(simulate = false) {
  const instances: MotionWorker[] = [];
  class MotionWorker {
    onmessage: ((event: { data: MotionFrame }) => void) | null = null;
    simulation: ReturnType<typeof createElasticSimulation> | undefined;
    revision = 0;
    readonly postMessage = vi.fn((command: MotionCommand) => {
      this.revision = command.revision;
      if (!simulate) return;
      switch (command.type) {
        case 'start':
          this.simulation = createElasticSimulation(command.graph, command.settings);
          break;
        case 'pin':
          this.simulation?.pin(command.points, command.released);
          break;
      }
    });
    readonly terminate = vi.fn();
    get start() {
      const command = this.postMessage.mock.calls[0]?.[0];
      if (command?.type !== 'start') throw new Error('Worker did not receive a start command.');
      return command;
    }
    constructor() {
      instances.push(this);
    }
    emit(positions: number[], settled = false) {
      this.onmessage?.({ data: { positions: new Float64Array(positions), revision: this.revision, settled } });
    }
    tick(iterations: number) {
      if (!this.simulation) throw new Error('Worker fake has no simulation.');
      this.simulation.tick(iterations);
      this.emit([...this.simulation.positions()]);
    }
  }
  return { instances, Worker: MotionWorker };
}
