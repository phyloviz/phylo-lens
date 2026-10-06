import mockRenderer from './adapters/mock/mockRenderer';
import createSigmaRenderer from './adapters/sigma/sigmaRenderer';
import { type GraphRenderer, RendererType, type RendererFactory } from './renderer.types';

export const ERR_UNSUPPORTED_RENDERER = 'Unsupported renderer type: {type}';

export default function rendererFactory(): RendererFactory {
  return {
    createRenderer,
  };

  function createRenderer(type: RendererType): GraphRenderer {
    switch (type) {
      case RendererType.Sigma:
        return createSigmaRenderer();

      case RendererType.Mock:
        return mockRenderer();
    }

    throw new Error(ERR_UNSUPPORTED_RENDERER.replace('{type}', String(type)));
  }
}
