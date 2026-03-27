import { MockRenderer } from "./adapters/mockRenderer";
import { SigmaRenderer } from "./adapters/sigmaRenderer";
import {
  GraphRenderer,
  RENDERER_KIND_MOCK,
  RENDERER_KIND_SIGMA,
  RendererFactory,
  RendererKind,
} from "./types";

export const ERR_UNSUPPORTED_RENDERER = "Unsupported renderer kind: {kind}";

// Create renderer adapters through one modular factory entry point.
export class DefaultRendererFactory implements RendererFactory {
  createRenderer(kind: RendererKind): GraphRenderer {
    if (kind === RENDERER_KIND_SIGMA) {
      return new SigmaRenderer();
    }

    if (kind === RENDERER_KIND_MOCK) {
      return new MockRenderer();
    }

    throw new Error(ERR_UNSUPPORTED_RENDERER.replace("{kind}", kind));
  }
}
