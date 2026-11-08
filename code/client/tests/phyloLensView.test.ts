import type { PhyloLensViewOptions } from '../src/phyloLensView';
import type { GraphWorkbenchOptions } from '../src/app/workbench/graphWorkbench.types';
import { toDatasetId, toLayoutVersion, toClusterId, toNodeId } from '../src/contracts/graph/graphIdentifiers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  workbenches: new WeakMap<HTMLElement, ReturnType<typeof import('./doubles/workbenchFake').workbenchFake>>(),
}));
vi.mock('../src/services/graph/graphService', () => ({
  createGraphClient: vi.fn((options: { baseUrl: string }) => ({ apiUrl: options.baseUrl, prepareGraph: vi.fn() })),
}));
vi.mock('../src/render/rendererFactory', () => ({ default: vi.fn(() => ({ createRenderer: vi.fn() })) }));
vi.mock('../src/app/workbench/graphWorkbench', async () => {
  const { workbenchFake } = await import('./doubles/workbenchFake');
  return {
    ERR_GRAPH_LOAD_SUPERSEDED: 'Graph load was superseded by a newer load.',
    createGraphWorkbench: vi.fn((options: GraphWorkbenchOptions) => {
      const workbench = workbenchFake();
      boundary.workbenches.set(options.renderContext.container, workbench);
      return workbench;
    }),
  };
});
import { createGraphWorkbench } from '../src/app/workbench/graphWorkbench';
import { createPhyloLensView } from '../src/index';
import { ERR_PHYLO_LENS_VIEW_DISPOSED } from '../src/phyloLensView';

const views = new Set<ReturnType<typeof createPhyloLensView>>();
function createView(options: Partial<PhyloLensViewOptions> = {}) {
  const container = options.container ?? document.createElement('div');
  const view = createPhyloLensView({ apiUrl: '', ...options, container });
  views.add(view);
  const workbench = boundary.workbenches.get(container);
  if (!workbench) throw new Error('The view did not create its workbench.');
  return { view, workbench };
}
beforeEach(() => {
  boundary.workbenches = new WeakMap();
  vi.clearAllMocks();
});
afterEach(() => {
  views.forEach(view => view.dispose());
  views.clear();
});

describe('createPhyloLensView', () => {
  it('routes simultaneous views to their own workbenches and disposes them independently', async () => {
    const first = createView();
    const second = createView();
    await first.view.load({ content: '(a:1)b;', name: 'first' });
    await second.view.load({ content: '(c:1)d;', name: 'second' });
    expect(first.workbench.loadGraph).toHaveBeenCalledOnce();
    expect(second.workbench.loadGraph).toHaveBeenCalledOnce();
    expect(first.workbench.loadGraph).toHaveBeenCalledWith(expect.objectContaining({ datasetName: 'first' }), {});
    expect(second.workbench.loadGraph).toHaveBeenCalledWith(expect.objectContaining({ datasetName: 'second' }), {});
    first.view.dispose();
    await second.view.load({ content: '(e:1)f;', name: 'still-open' });
    expect(first.workbench.dispose).toHaveBeenCalledOnce();
    expect(second.workbench.dispose).not.toHaveBeenCalled();
    expect(second.workbench.loadGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({ datasetName: 'still-open' }),
      {}
    );
  });
  it('creates the existing workbench stack and loads Newick content', async () => {
    const container = document.createElement('div');
    const { view, workbench } = createView({
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
        createRenderer: expect.any(Function),
      }),
      rendererType: 'sigma',
      renderContext: { container },
    });
    expect(workbench.loadGraph).toHaveBeenCalledWith(
      { content: '(a:1,b:1)root;', datasetName: 'example-tree', format: 'newick' },
      {
        ancillarySchema: [{ key: 'country', type: 'string' }],
        ancillaryByNodeId: {
          a: { country: 'PT' },
        },
      }
    );
    expect(workbench.dispose).toHaveBeenCalledOnce();
  });

  it('delegates each load call to the workbench', async () => {
    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });

    await view.load({ content: '(a:1)b;', name: 'first' });
    await view.load({ content: '(c:1)d;', name: 'second' });

    expect(workbench.loadGraph).toHaveBeenNthCalledWith(
      1,
      { content: '(a:1)b;', datasetName: 'first', format: 'newick' },
      {}
    );
    expect(workbench.loadGraph).toHaveBeenNthCalledWith(
      2,
      { content: '(c:1)d;', datasetName: 'second', format: 'newick' },
      {}
    );
  });

  it('exposes SFDP configuration through the public load API', async () => {
    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });

    await view.load({
      content: '(a:1)b;',
      sfdpOptions: { overlap: 'prism', quadtree: 'fast' },
    });

    expect(workbench.loadGraph).toHaveBeenCalledWith(
      { content: '(a:1)b;', datasetName: undefined, format: 'newick' },
      {
        sfdpOptions: { overlap: 'prism', quadtree: 'fast' },
      }
    );
  });

  it('makes dispose idempotent', () => {
    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });

    view.dispose();
    view.dispose();

    expect(workbench.dispose).toHaveBeenCalledOnce();
  });

  it('exposes PNG export on the normal view API', async () => {
    const png = new Blob(['png'], { type: 'image/png' });

    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });
    workbench.exportPng.mockResolvedValueOnce(png);

    await expect(view.exportPng()).resolves.toBe(png);
    expect(workbench.exportPng).toHaveBeenCalledOnce();
  });

  it('allows dispose after a failed load', async () => {
    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });
    workbench.loadGraph.mockRejectedValueOnce(new Error('prepare failed'));

    await expect(view.load({ content: '(a:1)b;' })).rejects.toThrow('prepare failed');
    view.dispose();

    expect(workbench.dispose).toHaveBeenCalledOnce();
  });

  it('rejects an in-flight load with the public disposed error after disposal', async () => {
    let rejectLoad: (error: unknown) => void = () => undefined;

    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });
    workbench.loadGraph.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      })
    );

    const load = view.load({ content: '(a:1)b;' });
    view.dispose();
    rejectLoad(new Error('Graph load was superseded by a newer load.'));

    await expect(load).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    expect(workbench.dispose).toHaveBeenCalledOnce();
  });

  it('rejects load calls after disposal with a clear error', async () => {
    const { view, workbench } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });

    view.dispose();

    await expect(view.load({ content: '(a:1)b;' })).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
    expect(workbench.loadGraph).not.toHaveBeenCalled();
  });

  it('rejects export after disposal with the public disposed error', () => {
    const { view } = createView({
      container: document.createElement('div'),
      apiUrl: 'https://phylo-lens.example.test',
    });
    view.dispose();

    expect(() => view.exportPng()).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
  });
});

it('updates pie visibility through the public API and rejects changes after disposal', async () => {
  const { view, workbench } = createView({ container: document.createElement('div'), apiUrl: '' });
  await view.load({ content: '(A,B);' });
  view.updateVisualMapping({ pie: { enabled: false } });
  expect(workbench.updateVisualMapping).toHaveBeenLastCalledWith({ pie: { enabled: false } });
  view.updateVisualMapping({ pie: { enabled: true } });
  expect(workbench.updateVisualMapping).toHaveBeenLastCalledWith({ pie: { enabled: true } });
  view.dispose();
  expect(() => view.updateVisualMapping({})).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});

it('exposes ancillary upload results without leaking layout identifiers', async () => {
  const { view, workbench } = createView({ container: document.createElement('div'), apiUrl: '' });
  workbench.applyAncillaryData.mockResolvedValue({
    datasetId: toDatasetId('tree'),
    layoutVersion: toLayoutVersion('revision'),
    matchedNodeCount: 2,
    warnings: ['Unmatched row'],
  });
  const data = { content: 'id,country\nA,PT', joinColumn: 'id', format: 'csv' as const };
  await expect(view.applyAncillaryData(data)).resolves.toEqual({ matchedNodeCount: 2, warnings: ['Unmatched row'] });
  expect(workbench.applyAncillaryData).toHaveBeenCalledWith(data);
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

  const { view, workbench } = createView({ container: document.createElement('div'), apiUrl: '' });
  workbench.expandAll.mockResolvedValue(partial);
  expect(await view.expandAll()).toEqual(partial);
  view.setKeepExpanded(true);
  expect(workbench.setKeepExpanded).toHaveBeenCalledWith(true);
  await view.expandCluster(toClusterId('group'));
  expect(workbench.expandCluster).toHaveBeenCalledWith('group');
  view.collapseBranch(toNodeId('internal'));
  view.expandBranch(toNodeId('internal'));
  expect(workbench.collapseBranch).toHaveBeenCalledWith('internal');
  expect(workbench.expandBranch).toHaveBeenCalledWith('internal');
  view.dispose();
  await expect(view.expandAll()).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
  await expect(view.collapseAll()).rejects.toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
  expect(() => view.collapseCluster(toClusterId('group'))).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
  expect(() => view.collapseBranch(toNodeId('internal'))).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
  expect(() => view.expandBranch(toNodeId('internal'))).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});

it('exposes motion preference and feedback without allowing calls after disposal', () => {
  const feedback = vi.fn();
  const { view, workbench } = createView({
    container: document.createElement('div'),
    apiUrl: '',
    onInteractionFeedback: feedback,
  });
  view.setMotionEnabled(false);
  expect(workbench.setMotionEnabled).toHaveBeenCalledWith(false);
  expect(workbench.setInteractionFeedbackHandler).toHaveBeenCalledWith(feedback);
  expect(view.isMotionEnabled()).toBe(true);
  view.dispose();
  expect(() => view.setMotionEnabled(true)).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
  expect(() => view.isMotionEnabled()).toThrow(ERR_PHYLO_LENS_VIEW_DISPOSED);
});
