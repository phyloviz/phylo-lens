import { ERR_SIGMA_NOT_READY } from '../src/render/adapters/sigma/sigmaRenderer';
import { describe, expect, it } from 'vitest';

import rendererFactory from '../src/render/rendererFactory';
import { RendererType } from '../src/render/renderer.types';

describe('rendererFactory', () => {
    it('creates the sigma renderer adapter', () => {
        const factory = rendererFactory();
        const renderer = factory.createRenderer(RendererType.Sigma);

        expect(renderer.getViewportState?.()).toBeNull();
        expect(() => renderer.render({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } })).toThrow(
            ERR_SIGMA_NOT_READY
        );
    });

    it('creates the mock renderer adapter', () => {
        const factory = rendererFactory();
        const renderer = factory.createRenderer(RendererType.Mock);

        const container = document.createElement('div');
        renderer.mount({ container });
        renderer.render({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
        expect(renderer.getViewportState?.()).toMatchObject({ cameraRatio: 1 });
        renderer.unmount();
    });

    it('rejects unsupported renderer types at runtime', () => {
        expect(() => rendererFactory().createRenderer('unsupported' as RendererType)).toThrow(
            'Unsupported renderer type: unsupported'
        );
    });
});
