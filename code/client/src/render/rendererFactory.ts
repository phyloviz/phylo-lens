import mockRenderer from "./adapters/mockRenderer";
import { SigmaRenderer } from "./adapters/sigma/sigmaRenderer";
import {
  type GraphRenderer,
  RENDERER_KIND_MOCK,
  RENDERER_KIND_SIGMA,
  type RendererFactory,
  type RendererKind,
} from "./types";

export const ERR_UNSUPPORTED_RENDERER = "Unsupported renderer kind: {kind}";

// Create renderer adapters through one modular factory entry point.
export default function () {
  return {
    createRenderer: createRenderer,
  } satisfies RendererFactory;

  function createRenderer(kind: RendererKind): GraphRenderer {
    if (kind === RENDERER_KIND_SIGMA) {
      return new SigmaRenderer();
    }

    if (kind === RENDERER_KIND_MOCK) {
      return mockRenderer();
    }

    throw new Error(ERR_UNSUPPORTED_RENDERER.replace("{kind}", kind));
  }
}
