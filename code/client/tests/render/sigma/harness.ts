import { afterEach, beforeEach, vi } from 'vitest';
import { createSigmaDoubles } from '../../doubles/sigmaFake';
import { createMotionWorkerDoubles } from '../../doubles/motionWorkerFake';
import realSigmaRenderer from '../../../src/render/adapters/sigma/sigmaRenderer';

type PieInput = { slices: Array<{ color: { value: string }; value: { attribute: string } }> };
function freshState() {
  return {
    sigmaDoubles: createSigmaDoubles(),
    motionDoubles: createMotionWorkerDoubles(true),
    renderers: new Set<ReturnType<typeof realSigmaRenderer>>(),
    shouldThrowOnPieProgram: false,
    pieProgramInputs: [] as PieInput[],
    animationFrameCallback: null as FrameRequestCallback | null,
    animationFrameId: 0,
  };
}
let state: ReturnType<typeof freshState>;

// Registration stays at the module boundary; all mutable fixture state is recreated per test.
vi.mock('../../../src/render/adapters/sigma/motion/elastic.worker?worker&inline', () => ({
  default: function () {
    return new state.motionDoubles.Worker();
  },
}));
vi.mock('@sigma/node-piechart', () => ({
  createNodePiechartProgram(input: PieInput) {
    state.pieProgramInputs.push(input);
    if (state.shouldThrowOnPieProgram) throw new Error('pie program failed');
    return class FakePiechartProgram {};
  },
}));
vi.mock('sigma', () => ({
  default: function (...args: ConstructorParameters<ReturnType<typeof createSigmaDoubles>['Sigma']>) {
    return new state.sigmaDoubles.Sigma(...args);
  },
}));

export function setupSigmaHarness() {
  beforeEach(() => {
    state = freshState();
    document.body.innerHTML = '<div id="graph-root"></div>';
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      state.animationFrameCallback = callback;
      return ++state.animationFrameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      state.animationFrameCallback = null;
    });
  });
  afterEach(() => {
    try {
      state.renderers.forEach(renderer => renderer.unmount());
    } finally {
      state.motionDoubles.instances.forEach(worker => worker.terminate());
      vi.useRealTimers();
      vi.restoreAllMocks();
      document.body.replaceChildren();
    }
  });
  const commands = () =>
    state.motionDoubles.instances.flatMap(worker => worker.postMessage.mock.calls.map(([command]) => command));
  return {
    sigma: () => state.sigmaDoubles.instances.at(-1)!,
    motion: () => state.motionDoubles.instances.at(-1)!,
    commands,
    starts: () => commands().filter(command => command.type === 'start'),
    kills: () => state.motionDoubles.instances.reduce((count, worker) => count + worker.terminate.mock.calls.length, 0),
    createSigmaRenderer(...args: Parameters<typeof realSigmaRenderer>) {
      const owner = state;
      const renderer = realSigmaRenderer(...args);
      const mount = renderer.mount;
      const unmount = renderer.unmount;
      renderer.mount = (...contexts) => {
        owner.renderers.add(renderer);
        mount(...contexts);
      };
      renderer.unmount = () => {
        owner.renderers.delete(renderer);
        unmount();
      };
      owner.renderers.add(renderer);
      return renderer;
    },
    requireContainer() {
      const container = document.getElementById('graph-root');
      if (!container) throw new Error('Missing test container: graph-root');
      return container;
    },
    get sigmaDoubles() {
      return state.sigmaDoubles;
    },
    get pieProgramInputs() {
      return state.pieProgramInputs;
    },
    get shouldThrowOnPieProgram() {
      return state.shouldThrowOnPieProgram;
    },
    set shouldThrowOnPieProgram(value: boolean) {
      state.shouldThrowOnPieProgram = value;
    },
    get animationFrameCallback() {
      return state.animationFrameCallback;
    },
    set animationFrameCallback(value: FrameRequestCallback | null) {
      state.animationFrameCallback = value;
    },
  };
}
