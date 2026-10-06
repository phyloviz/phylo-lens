import { toDatasetId, toLayoutVersion, toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prepareGraph: vi.fn(),
    loadGraph: vi.fn(),
    exportPng: vi.fn(),
    updateVisualMapping: vi.fn(),
    applyAncillaryData: vi.fn(),
    dispose: vi.fn(),
    createRenderer: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    expandCluster: vi.fn(),
    collapseCluster: vi.fn(),
    getExpansionState: vi.fn(),
    setKeepExpanded: vi.fn(),
}));

vi.mock('../src/services/graph/graphService', () => ({
    createGraphClient: vi.fn((options: { baseUrl: string }) => ({
        apiUrl: options.baseUrl,
        prepareGraph: mocks.prepareGraph,
    })),
}));

vi.mock('../src/render/rendererFactory', () => ({
    default: vi.fn(() => ({
        createRenderer: mocks.createRenderer,
    })),
}));

vi.mock('../src/app/workbench/graphWorkbench', () => ({
    ERR_GRAPH_LOAD_SUPERSEDED: 'Graph load was superseded by a newer load.',
    createGraphWorkbench: vi.fn(() => ({
        expandAll: mocks.expandAll,
        collapseAll: mocks.collapseAll,
        expandCluster: mocks.expandCluster,
        collapseCluster: mocks.collapseCluster,
        getExpansionState: mocks.getExpansionState,
        setKeepExpanded: mocks.setKeepExpanded,
        setInteractionFeedbackHandler: vi.fn(),
        setMotionEnabled: vi.fn(),
        isMotionEnabled: vi.fn(() => true),
        setErrorHandler: vi.fn(),
        setNodeClickedHandler: vi.fn(),
        setGraphRenderedHandler: vi.fn(),
        loadGraph: mocks.loadGraph,
        exportPng: mocks.exportPng,
        updateVisualMapping: mocks.updateVisualMapping,
        applyAncillaryData: mocks.applyAncillaryData,
        dispose: mocks.dispose,
    })),
}));

import { createGraphWorkbench } from '../src/app/workbench/graphWorkbench';
import { createPhyloLensView } from '../src/index';
import { ERR_PHYLO_LENS_VIEW_DISPOSED } from '../src/phyloLensView';

describe('createPhyloLensView', () => {
    beforeEach(() => {
        mocks.prepareGraph.mockReset();
        mocks.loadGraph.mockReset();
        mocks.exportPng.mockReset();
        mocks.updateVisualMapping.mockReset();
        mocks.applyAncillaryData.mockReset();
        mocks.dispose.mockReset();
        mocks.createRenderer.mockReset();
    });

    it('creates the existing workbench stack and loads Newick content', async () => {
        const container = document.createElement('div');
        const view = createPhyloLensView({
            container,
            apiUrl: 'https://phylo-lens.example.test',
        });

        await view.load({
            content: '(a:1,b:1)root;',
            name: 'example-tree',
            ancillarySchema: [{ key: 'country', type: 'string' }],
            ancillaryByNodeId: {
                a: { country: 'PT' },
            },
        });
        view.dispose();

        expect(createGraphWorkbench).toHaveBeenCalledWith({
            graphClient: expect.objectContaining({
                apiUrl: 'https://phylo-lens.example.test',
            }),
            rendererFactory: expect.objectContaining({
                createRenderer: mocks.createRenderer,
            }),
            rendererType: 'sigma',
            renderContext: { container },
        });
        expect(mocks.loadGraph).toHaveBeenCalledWith(
            { content: '(a:1,b:1)root;', datasetName: 'example-tree', format: 'newick' },
            {
                ancillarySchema: [{ key: 'country', type: 'string' }],
                ancillaryByNodeId: {
                    a: { country: 'PT' },
                },
            }
        );
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it('delegates each load call to the workbench', async () => {
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        await view.load({ content: '(a:1)b;', name: 'first' });
        await view.load({ content: '(c:1)d;', name: 'second' });

        expect(mocks.loadGraph).toHaveBeenNthCalledWith(
            1,
            { content: '(a:1)b;', datasetName: 'first', format: 'newick' },
            {}
        );
        expect(mocks.loadGraph).toHaveBeenNthCalledWith(
            2,
            { content: '(c:1)d;', datasetName: 'second', format: 'newick' },
            {}
        );
    });

    it('exposes SFDP configuration through the public load API', async () => {
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        await view.load({
            content: '(a:1)b;',
            sfdpOptions: { overlap: 'prism', quadtree: 'fast' },
        });

        expect(mocks.loadGraph).toHaveBeenCalledWith(
            { content: '(a:1)b;', datasetName: undefined, format: 'newick' },
            {
                sfdpOptions: { overlap: 'prism', quadtree: 'fast' },
            }
        );
    });

    it('makes dispose idempotent', () => {
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        view.dispose();
        view.dispose();

        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it('exposes PNG export on the normal view API', async () => {
        const png = new Blob(['png'], { type: 'image/png' });
        mocks.exportPng.mockResolvedValueOnce(png);
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        await expect(view.exportPng()).resolves.toBe(png);
        expect(mocks.exportPng).toHaveBeenCalledOnce();
    });

    it('allows dispose after a failed load', async () => {
        mocks.loadGraph.mockRejectedValueOnce(new Error('prepare failed'));
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        await expect(view.load({ content: '(a:1)b;' })).rejects.toThrow('prepare failed');
        view.dispose();

        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it('rejects an in-flight load with the public disposed error after disposal', async () => {
        let rejectLoad: (error: unknown) => void = () => undefined;
        mocks.loadGraph.mockReturnValueOnce(
            new Promise((_resolve, reject) => {
                rejectLoad = reject;
            })
        );
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        const load = view.load({ content: '(a:1)b;' });
        view.dispose();
        rejectLoad(new Error('Graph load was superseded by a newer load.'));

        await expect(load).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it('rejects load calls after disposal with a clear error', async () => {
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });

        view.dispose();

        await expect(view.load({ content: '(a:1)b;' })).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
        expect(mocks.loadGraph).not.toHaveBeenCalled();
    });

    it('rejects export after disposal with the public disposed error', () => {
        const view = createPhyloLensView({
            container: document.createElement('div'),
            apiUrl: 'https://phylo-lens.example.test',
        });
        view.dispose();

        expect(() => view.exportPng()).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    });
});

it('updates pie visibility through the public API and rejects changes after disposal', async () => {
    const view = createPhyloLensView({ container: document.createElement('div'), apiUrl: '' });
    await view.load({ content: '(A,B);' });
    view.updateVisualMapping({ pie: { enabled: false } });
    expect(mocks.updateVisualMapping).toHaveBeenLastCalledWith({ pie: { enabled: false } });
    view.updateVisualMapping({ pie: { enabled: true } });
    expect(mocks.updateVisualMapping).toHaveBeenLastCalledWith({ pie: { enabled: true } });
    view.dispose();
    expect(() => view.updateVisualMapping({})).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});

it('exposes ancillary upload results without leaking layout identifiers', async () => {
    mocks.applyAncillaryData.mockResolvedValue({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('revision'),
        matchedNodeCount: 2,
        warnings: ['Unmatched row'],
    });
    const view = createPhyloLensView({ container: document.createElement('div'), apiUrl: '' });
    const data = { content: 'id,country\nA,PT', joinColumn: 'id', format: 'csv' as const };
    await expect(view.applyAncillaryData(data)).resolves.toEqual({ matchedNodeCount: 2, warnings: ['Unmatched row'] });
    expect(mocks.applyAncillaryData).toHaveBeenCalledWith(data);
    view.dispose();
    await expect(view.applyAncillaryData(data)).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});

it('exposes expansion results and prevents operations after disposal', async () => {
    const partial = {
        status: 'partial',
        renderedNodeCount: 10,
        maxNodes: 10,
        partial: true,
        allExpanded: false,
        expandedClusterIds: [],
        keepExpanded: true,
    };
    mocks.expandAll.mockResolvedValue(partial);
    const view = createPhyloLensView({ container: document.createElement('div'), apiUrl: '' });
    expect(await view.expandAll()).toEqual(partial);
    view.setKeepExpanded(true);
    expect(mocks.setKeepExpanded).toHaveBeenCalledWith(true);
    await view.expandCluster(toClusterId('group'));
    expect(mocks.expandCluster).toHaveBeenCalledWith('group');
    view.dispose();
    await expect(view.expandAll()).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    await expect(view.collapseAll()).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    expect(() => view.collapseCluster(toClusterId('group'))).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});

it('exposes motion preference and feedback without allowing calls after disposal', () => {
    const feedback = vi.fn();
    const view = createPhyloLensView({
        container: document.createElement('div'),
        apiUrl: '',
        onInteractionFeedback: feedback,
    });
    const workbench = vi.mocked(createGraphWorkbench).mock.results.at(-1)!.value;
    view.setMotionEnabled(false);
    expect(workbench.setMotionEnabled).toHaveBeenCalledWith(false);
    expect(workbench.setInteractionFeedbackHandler).toHaveBeenCalledWith(feedback);
    expect(view.isMotionEnabled()).toBe(true);
    view.dispose();
    expect(() => view.setMotionEnabled(true)).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    expect(() => view.isMotionEnabled()).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});
