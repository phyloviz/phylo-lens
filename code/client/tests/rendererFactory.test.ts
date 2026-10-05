import { SigmaRenderer } from '../src/render/adapters/sigma/sigmaRenderer';
import { describe, expect, it } from 'vitest';

import rendererFactory from '../src/render/rendererFactory';
import { RENDERER_KIND_MOCK, RENDERER_KIND_SIGMA } from '../src/render/renderer.types';

describe('rendererFactory', () => {
    it('creates the sigma renderer adapter', () => {
        const factory = rendererFactory();
        const renderer = factory.createRenderer(RENDERER_KIND_SIGMA);

        expect(renderer).toBeInstanceOf(SigmaRenderer);
    });

    it('creates the mock renderer adapter', () => {
        const factory = rendererFactory();
        const renderer = factory.createRenderer(RENDERER_KIND_MOCK);

        const container = document.createElement('div');
        renderer.mount({ container });
        renderer.render({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
        expect(renderer.getViewportState?.()).toMatchObject({ cameraRatio: 1 });
        renderer.unmount();
    });
});
