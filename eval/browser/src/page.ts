// @ts-expect-error The browser bundle intentionally imports the built public
// package entry; declarations are emitted separately by the package build.
import { createPhyloLensView } from "../../../code/client/dist/index.js";

type RunCommand = {
  kind: "rq2-run";
  apiUrl: string;
  labelsEnabled: boolean;
};

const root = document.querySelector<HTMLElement>("#graph-root");
if (!root) throw new Error("Missing graph root.");

declare global {
  interface Window {
    phyloLensEvaluation?: {
      run: (config: RunCommand) => Promise<unknown>;
      createView: (apiUrl: string) => void;
      startFrameSampling: () => void;
      finishFrameSampling: () => number[];
      dispose: () => void;
    };
  }
}

let activeView: ReturnType<typeof createPhyloLensView> | undefined;
let frameSampling: { samples: number[]; previous?: number; active: boolean } | undefined;

window.phyloLensEvaluation = {
  createView: (apiUrl: string) => {
    if (activeView) throw new Error("Evaluation view is already active.");
    activeView = createPhyloLensView({ container: root, apiUrl });
  },
  run: async (data: RunCommand) => {
  const view = activeView;
  if (!view) throw new Error("Evaluation view was not created.");
  const t0 = performance.now();
  try {
    await view.load({
      content: "(A:1,B:1)root;",
      name: "rq2-replay",
      lod: { maxNodes: 100000 },
      visualMapping: undefined,
    });
    const t1 = performance.now();
    const t2 = await doubleAnimationFrame();
    const canvas = root.querySelector("canvas");
    const visualOutput = canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
    return { ok: true, t0, t1, t2, visualOutput };
  } catch (error) {
    view.dispose();
    activeView = undefined;
    return { ok: false, error: String(error) };
  }
  },
  startFrameSampling: () => {
    if (frameSampling) {
      throw new Error("Frame sampling is already active.");
    }
    frameSampling = { samples: [], active: true };
    const tick = (now: number) => {
      const sampler = frameSampling;
      if (!sampler || !sampler.active) return;
      if (sampler.previous !== undefined) sampler.samples.push(now - sampler.previous);
      sampler.previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  finishFrameSampling: () => {
    if (!frameSampling) throw new Error("Frame sampling was not started.");
    frameSampling.active = false;
    const samples = frameSampling.samples;
    frameSampling = undefined;
    return samples;
  },
  dispose: () => {
    activeView?.dispose();
    activeView = undefined;
  },
};
document.documentElement.dataset.rq2Bootstrap = "ready";

function doubleAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))));
}
