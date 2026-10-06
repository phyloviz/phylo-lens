import type { GraphViewportRequest } from '../src/contracts/graph/viewport/GraphViewportRequest';
import { deriveColor } from '../src/render/mapping/colorMapping';
import { toDatasetId, toLayoutVersion, toNodeId, toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { GRAPH_WORKBENCH_ERRORS } from '../src/app/workbench/graphWorkbench.errors';
import { nodeAnnotations } from './fixtures/graph';
import { describe, expect, it, vi } from 'vitest';

import { createGraphWorkbench } from '../src/app/workbench/graphWorkbench';
import type { GraphClient } from '../src/contracts/graph/GraphClient';
import type { GraphPrepareResult } from '../src/contracts/graph/prepare/GraphPrepareResult';
import type { GraphViewportResult } from '../src/contracts/graph/viewport/GraphViewportResult';
import type { GraphRenderer, RenderViewportRequestState, RendererFactory } from '../src/render/renderer.types';
import type { PositionedGraph } from '../src/contracts/positioned';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function prepareResponse(datasetId = 'tree', layoutVersion = 'layout-1'): GraphPrepareResult {
  return {
    datasetId: toDatasetId(datasetId),
    layoutVersion: toLayoutVersion(layoutVersion),
    nodeCount: 12_000,
    edgeCount: 11_999,
    clusterCount: 400,
    lodTierCount: 4,
    layoutStatus: 'ready' as const,
    warnings: [],
  };
}

function viewportResponse(datasetId = 'tree', layoutVersion = 'layout-1'): GraphViewportResult {
  return {
    datasetId: toDatasetId(datasetId),
    layoutVersion: toLayoutVersion(layoutVersion),
    lodLevel: 0,
    zoom: 1,
    layoutStatus: 'ready' as const,
    truncated: false,
    totalNodeCount: 1,
    ancillarySchema: [],
    nodes: [
      {
        annotations: nodeAnnotations(),
        id: toNodeId(datasetId),
        clusterId: toClusterId(datasetId),
        x: 0,
        y: 0,
        layoutStatus: 'ready' as const,
        memberCount: 1,
        isRepresentative: false,
      },
    ],
    edges: [],
  };
}

function createWorkbenchHarness(overrides: Partial<GraphClient> = {}) {
  const viewportState: RenderViewportRequestState = {
    bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
    cameraRatio: 1,
  };
  const renderer = {
    mount: vi.fn(),
    unmount: vi.fn(),
    render: vi.fn(),
    focusNode: vi.fn(),
    getViewportState: vi.fn(() => viewportState),
    applyGraphSnapshot: vi.fn(),
    fitGraphSnapshot: vi.fn(() => null),
    updateDisplayOptions: vi.fn(),
    setViewChangeHandler: vi.fn(),
    setNodeClickHandler: vi.fn(),
    setNodeDoubleClickHandler: vi.fn(),
  } satisfies GraphRenderer;
  const rendererFactory: RendererFactory = {
    createRenderer: vi.fn(() => renderer),
  };
  const graphClient = {
    prepareGraph: vi.fn(async () => prepareResponse()),
    readViewport: vi.fn(async () => viewportResponse()),
    applyAncillaryData: vi.fn(async () => {
      throw new Error('Unexpected ancillary update');
    }),
    searchGraph: vi.fn(),
    readRegion: vi.fn(),
    ...overrides,
  } satisfies GraphClient;

  return {
    graphClient,
    renderer,
    workbench: createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererType: 'sigma',
      renderContext: { container: document.createElement('div') },
    }),
  };
}

describe('graphWorkbench navigation', () => {
  it('selects triangles without expanding and leaves double-click zoom unbound', async () => {
    const { workbench, renderer, graphClient } = createWorkbenchHarness();
    await workbench.loadGraph({ content: '(a:1)b;', format: 'newick', datasetName: 'tree' });
    vi.mocked(graphClient.readViewport).mockClear();
    const selected = vi.fn();
    workbench.setNodeClickedHandler(selected);
    const click = vi.mocked(renderer.setNodeClickHandler!).mock.calls[0][0]!;
    click({ nodeId: toNodeId('a'), attributes: { clusterId: toClusterId('group'), isClusterProxy: true } });
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ nodeId: toNodeId('a') }));
    expect(graphClient.readViewport).not.toHaveBeenCalled();
    expect(renderer.setNodeDoubleClickHandler).not.toHaveBeenCalled();
    workbench.dispose();
  });

  it('translates ancillary load options to the compatible API v1 request', async () => {
    const { workbench, graphClient } = createWorkbenchHarness();
    await workbench.loadGraph(
      { content: '(a:1)b;', format: 'newick', datasetName: 'tree' },
      {
        ancillarySchema: [{ key: 'country', type: 'string' }],
        ancillaryByNodeId: { a: { country: 'PT' } },
      }
    );
    expect(graphClient.prepareGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        ancillarySchema: [{ key: 'country', type: 'string' }],
        ancillaryByNodeId: { a: { country: 'PT' } },
      })
    );
    workbench.dispose();
  });

  it('resolves loadGraph only after prepare, first viewport, and renderer update', async () => {
    const events: string[] = [];
    const { renderer, workbench } = createWorkbenchHarness({
      prepareGraph: vi.fn(async () => {
        events.push('prepare');
        return prepareResponse();
      }),
      readViewport: vi.fn(async () => {
        events.push('viewport');
        return viewportResponse();
      }),
    });
    vi.mocked(renderer.applyGraphSnapshot!).mockImplementation(() => {
      events.push('renderer');
    });

    await workbench.loadGraph({ content: '(a:1,b:1)root;', format: 'newick', datasetName: 'tree' });
    events.push('resolved');

    expect(events).toEqual(['prepare', 'viewport', 'renderer', 'resolved']);
  });

  it('maps public SFDP options into the prepare request', async () => {
    const { graphClient, workbench } = createWorkbenchHarness();

    await workbench.loadGraph(
      { content: '(a:1,b:1)root;', format: 'newick', datasetName: 'tree' },
      {
        sfdpOptions: { k: 0.5, overlap: 'prism', prismIterations: 10, beautify: true },
      }
    );

    expect(graphClient.prepareGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        sfdpOptions: { k: 0.5, overlap: 'prism', prismIterations: 10, beautify: true },
      })
    );
  });

  it('keeps initial display options when constructing the viewport session', async () => {
    const { renderer, workbench } = createWorkbenchHarness({
      readViewport: vi.fn(async () => ({
        ...viewportResponse(),
        edges: [{ id: toNodeId('tree-edge'), source: toNodeId('tree'), target: toNodeId('tree'), distance: 3 }],
      })),
    });

    await workbench.loadGraph(
      { content: '(a:1,b:1)root;', format: 'newick', datasetName: 'tree' },
      {
        displayOptions: {
          nodeLabels: false,
          edgeDistanceLabels: true,
          distanceWeightedEdges: true,
        },
      }
    );

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ attributes: expect.objectContaining({ label: '' }) })],
        edges: [
          expect.objectContaining({
            attributes: expect.objectContaining({ label: '3', forceLabel: true, size: expect.any(Number) }),
          }),
        ],
      }) as PositionedGraph
    );
  });

  it('applies display options to the live viewport without another request', async () => {
    const { graphClient, renderer, workbench } = createWorkbenchHarness({
      readViewport: vi.fn(async () => ({
        ...viewportResponse(),
        edges: [{ id: toNodeId('tree-edge'), source: toNodeId('tree'), target: toNodeId('tree'), distance: 3 }],
      })),
    });

    await workbench.loadGraph({ content: '(a:1,b:1)root;', format: 'newick', datasetName: 'tree' });
    vi.mocked(graphClient.readViewport).mockClear();
    vi.mocked(renderer.applyGraphSnapshot!).mockClear();

    workbench.updateDisplayOptions({
      nodeLabels: false,
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });

    expect(graphClient.readViewport).not.toHaveBeenCalled();
    expect(renderer.updateDisplayOptions).toHaveBeenCalledWith({
      nodeLabels: false,
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ attributes: expect.objectContaining({ label: '' }) })],
        edges: [
          expect.objectContaining({
            attributes: expect.objectContaining({ label: '3', forceLabel: true, size: expect.any(Number) }),
          }),
        ],
      }) as PositionedGraph
    );
  });

  it('rejects loadGraph when the first viewport fails', async () => {
    const { renderer, workbench } = createWorkbenchHarness({
      readViewport: vi.fn(async () => {
        throw new Error('viewport failed');
      }),
    });

    await expect(
      workbench.loadGraph({ content: '(a:1,b:1)root;', format: 'newick', datasetName: 'tree' })
    ).rejects.toThrow('viewport failed');
    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it('prevents an older overlapping load from replacing a newer graph', async () => {
    vi.useFakeTimers();
    const firstPrepare = deferred<GraphPrepareResult>();
    const secondPrepare = deferred<GraphPrepareResult>();
    const secondViewport = deferred<GraphViewportResult>();
    const { graphClient, renderer, workbench } = createWorkbenchHarness({
      prepareGraph: vi.fn().mockReturnValueOnce(firstPrepare.promise).mockReturnValueOnce(secondPrepare.promise),
      readViewport: vi.fn(() => secondViewport.promise),
    });

    try {
      const firstLoad = workbench.loadGraph({ content: '(a:1)b;', format: 'newick', datasetName: 'first' });
      const secondLoad = workbench.loadGraph({ content: '(c:1)d;', format: 'newick', datasetName: 'second' });

      secondPrepare.resolve(prepareResponse('second-tree', 'layout-2'));
      await vi.advanceTimersByTimeAsync(0);
      secondViewport.resolve(viewportResponse('second-tree', 'layout-2'));
      await secondLoad;
      firstPrepare.resolve(prepareResponse('first-tree', 'layout-1'));

      await expect(firstLoad).rejects.toThrow(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
      expect(graphClient.readViewport).toHaveBeenCalledTimes(1);
      expect(renderer.applyGraphSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: [expect.objectContaining({ id: toNodeId('second-tree') })],
        }) as PositionedGraph
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates pending loads when disposed during prepare', async () => {
    const prepare = deferred<GraphPrepareResult>();
    const { renderer, workbench } = createWorkbenchHarness({
      prepareGraph: vi.fn(() => prepare.promise),
    });

    const load = workbench.loadGraph({ content: '(a:1)b;', format: 'newick', datasetName: 'tree' });
    workbench.dispose();
    prepare.resolve(prepareResponse());

    await expect(load).rejects.toThrow(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it('invalidates pending loads when disposed during the initial viewport', async () => {
    vi.useFakeTimers();
    const viewport = deferred<GraphViewportResult>();
    const { renderer, workbench } = createWorkbenchHarness({
      readViewport: vi.fn(() => viewport.promise),
    });

    try {
      const load = workbench.loadGraph({ content: '(a:1)b;', format: 'newick', datasetName: 'tree' });
      await vi.advanceTimersByTimeAsync(0);
      workbench.dispose();
      viewport.resolve(viewportResponse());

      await expect(load).rejects.toThrow(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
      expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a partial matched cluster when search focus uses coordinates outside the current slice', async () => {
    const renderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      focusNode: vi.fn(),
      centerOnNode: vi.fn(() => false),
      centerOnCoordinates: vi.fn(() => true),
      getViewportState: vi.fn(() => ({
        bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
        cameraRatio: 1,
      })),
      applyGraphSnapshot: vi.fn(),
      fitGraphSnapshot: vi.fn(() => null),
      setNodeClickHandler: vi.fn(),
      setNodeDoubleClickHandler: vi.fn(),
    };
    const rendererFactory: RendererFactory = {
      createRenderer: vi.fn(() => renderer),
    };
    const graphClient = {
      prepareGraph: vi.fn(async () => ({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        nodeCount: 12_000,
        edgeCount: 11_999,
        clusterCount: 400,
        lodTierCount: 4,
        layoutStatus: 'ready' as const,
        warnings: [],
      })),
      applyAncillaryData: vi.fn(async () => {
        throw new Error('Unexpected ancillary update');
      }),
      searchGraph: vi.fn(),
      readViewport: vi.fn(async () => ({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-1'),
        lodLevel: null,
        zoom: 1,
        layoutStatus: 'ready' as const,
        truncated: true,
        totalNodeCount: 2,
        ancillarySchema: [],
        nodes: [
          {
            annotations: nodeAnnotations(),
            id: toNodeId('missing-node'),
            clusterId: toClusterId('cluster-42'),
            x: 42,
            y: 84,
            layoutStatus: 'ready' as const,
            memberCount: 1,
            isRepresentative: false,
          },
        ],
        edges: [],
      })),
      readRegion: vi.fn(),
    } satisfies GraphClient;
    const workbench = createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererType: 'sigma',
      renderContext: { container: document.createElement('div') },
    });

    await workbench.loadGraph({ content: '(a:1,b:1)root;', format: 'newick', datasetName: 'tree' });
    vi.mocked(renderer.focusNode!).mockClear();
    vi.mocked(graphClient.readViewport).mockClear();
    await workbench.focusNode(toNodeId('missing-node'), { x: 42, y: 84, clusterId: toClusterId('cluster-42') });

    expect(renderer.focusNode).toHaveBeenCalledWith('missing-node');
    expect(renderer.centerOnNode).toHaveBeenCalledWith('missing-node');
    expect(renderer.centerOnCoordinates).toHaveBeenCalledWith(42, 84);
    await Promise.resolve();
    expect(graphClient.readViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: toClusterId('cluster-42'),
        focusNodeId: 'missing-node',
      })
    );
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ id: toNodeId('missing-node') })],
      }) as PositionedGraph
    );
    // Re-selecting after a pan must not be treated as an already-completed focus.
    await workbench.focusNode(toNodeId('missing-node'), { x: 42, y: 84, clusterId: toClusterId('cluster-42') });
    expect(renderer.focusNode).toHaveBeenCalledTimes(2);
    expect(renderer.centerOnCoordinates).toHaveBeenCalledTimes(2);
    expect(graphClient.readViewport).toHaveBeenCalledTimes(2);
  });

  it('replaces the previous viewport sync session when a second dataset is loaded', async () => {
    vi.useFakeTimers();
    const viewHandlers: Array<(() => void) | null> = [];
    const renderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      focusNode: vi.fn(),
      getViewportState: vi.fn(() => ({
        bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
        cameraRatio: 0.1,
      })),
      applyGraphSnapshot: vi.fn(),
      fitGraphSnapshot: vi.fn(() => null),
      setViewChangeHandler: vi.fn(handler => {
        viewHandlers.push(handler as (() => void) | null);
      }),
      setNodeClickHandler: vi.fn(),
      setNodeDoubleClickHandler: vi.fn(),
    };
    const rendererFactory: RendererFactory = {
      createRenderer: vi.fn(() => renderer),
    };
    const graphClient = {
      prepareGraph: vi
        .fn()
        .mockResolvedValueOnce({
          datasetId: toDatasetId('first-tree'),
          layoutVersion: toLayoutVersion('layout-1'),
          nodeCount: 12_000,
          edgeCount: 11_999,
          clusterCount: 400,
          lodTierCount: 4,
          layoutStatus: 'ready' as const,
          warnings: [],
        })
        .mockResolvedValueOnce({
          datasetId: toDatasetId('second-tree'),
          layoutVersion: toLayoutVersion('layout-2'),
          nodeCount: 12_000,
          edgeCount: 11_999,
          clusterCount: 400,
          lodTierCount: 4,
          layoutStatus: 'ready' as const,
          warnings: [],
        }),
      applyAncillaryData: vi.fn(async () => {
        throw new Error('Unexpected ancillary update');
      }),
      searchGraph: vi.fn(),
      readViewport: vi.fn(async (query: GraphViewportRequest) => ({
        datasetId: query.datasetId,
        layoutVersion: query.layoutVersion ?? toLayoutVersion('layout'),
        lodLevel: 0,
        zoom: 1,
        layoutStatus: 'ready' as const,
        truncated: false,
        totalNodeCount: 1,
        ancillarySchema: [],
        nodes: [
          {
            annotations: nodeAnnotations(),
            id: toNodeId(query.datasetId),
            clusterId: toClusterId(query.datasetId),
            x: 0,
            y: 0,
            layoutStatus: 'ready' as const,
            memberCount: 1,
            isRepresentative: false,
          },
        ],
        edges: [],
      })),
      readRegion: vi.fn(),
    } satisfies GraphClient;
    const workbench = createGraphWorkbench({
      graphClient,
      rendererFactory,
      rendererType: 'sigma',
      renderContext: { container: document.createElement('div') },
    });

    try {
      const firstLoad = workbench.loadGraph({ content: '(a:1)b;', format: 'newick', datasetName: 'first' });
      await vi.advanceTimersByTimeAsync(0);
      await firstLoad;
      const firstHandler = viewHandlers.find((handler): handler is () => void => typeof handler === 'function');

      const secondLoad = workbench.loadGraph({ content: '(c:1)d;', format: 'newick', datasetName: 'second' });
      await vi.advanceTimersByTimeAsync(0);
      await secondLoad;
      vi.mocked(graphClient.readViewport).mockClear();

      firstHandler?.();
      await vi.advanceTimersByTimeAsync(200);
      expect(graphClient.readViewport).not.toHaveBeenCalled();

      viewHandlers.at(-1)?.();
      await vi.advanceTimersByTimeAsync(60);
      expect(graphClient.readViewport).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: toDatasetId('second-tree'),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

const ancillaryData = { format: 'csv' as const, joinColumn: 'id', content: 'id,country\ntree,Portugal\n' };
const ancillaryResult = {
  datasetId: toDatasetId('tree'),
  layoutVersion: toLayoutVersion('metadata-1'),
  matchedNodeCount: 1,
  warnings: [],
};

it('applies ancillary data without preparation or camera fitting and updates subsequent queries', async () => {
  const updatedViewport = viewportResponse('tree', 'metadata-1');
  Object.assign(updatedViewport, { ancillarySchema: [{ key: 'country', type: 'string' }] });
  Object.assign(updatedViewport.nodes[0], { annotations: nodeAnnotations({ country: 'Portugal' }) });
  const readViewport = vi.fn().mockResolvedValueOnce(viewportResponse()).mockResolvedValue(updatedViewport);
  const applyAncillaryData = vi.fn().mockResolvedValue(ancillaryResult);
  const { workbench, renderer, graphClient } = createWorkbenchHarness({ readViewport, applyAncillaryData });
  await workbench.loadGraph({ content: '(A,B)Root;', format: 'newick', datasetName: undefined });
  const fits = vi.mocked(renderer.fitGraphSnapshot!).mock.calls.length;
  await expect(workbench.applyAncillaryData(ancillaryData)).resolves.toEqual(ancillaryResult);
  expect(applyAncillaryData).toHaveBeenCalledWith({
    datasetId: toDatasetId('tree'),
    layoutVersion: toLayoutVersion('layout-1'),
    ancillaryData: ancillaryData,
  });
  expect(graphClient.prepareGraph).toHaveBeenCalledTimes(1);
  expect(renderer.fitGraphSnapshot).toHaveBeenCalledTimes(fits);
  expect(readViewport).toHaveBeenLastCalledWith(
    expect.objectContaining({ layoutVersion: toLayoutVersion('metadata-1') })
  );
  expect(renderer.applyGraphSnapshot).toHaveBeenLastCalledWith(
    expect.objectContaining({
      nodes: [
        expect.objectContaining({
          attributes: expect.objectContaining({
            annotations: expect.objectContaining({ ancillaryData: { country: 'Portugal' } }),
          }),
        }),
      ],
    }),
    { preservePositions: true }
  );
  await workbench.applyAncillaryData(ancillaryData);
  expect(applyAncillaryData).toHaveBeenLastCalledWith(
    expect.objectContaining({ layoutVersion: toLayoutVersion('metadata-1') })
  );
  workbench.dispose();
});

it('keeps the source version usable if the updated viewport fails', async () => {
  const applyAncillaryData = vi.fn().mockResolvedValue(ancillaryResult);
  const readViewport = vi.fn().mockResolvedValueOnce(viewportResponse()).mockRejectedValueOnce(new Error('offline'));
  const { workbench, renderer } = createWorkbenchHarness({ applyAncillaryData, readViewport });
  await workbench.loadGraph({ content: '(A,B)Root;', format: 'newick', datasetName: undefined });
  await expect(workbench.applyAncillaryData(ancillaryData)).rejects.toThrow('offline');
  expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
  readViewport.mockResolvedValue(viewportResponse('tree', 'metadata-1'));
  await workbench.applyAncillaryData(ancillaryData);
  expect(applyAncillaryData).toHaveBeenLastCalledWith(
    expect.objectContaining({ layoutVersion: toLayoutVersion('layout-1') })
  );
  workbench.dispose();
});

it('rejects concurrent uploads and ignores an upload completed after another tree loads', async () => {
  const pending = deferred<typeof ancillaryResult>();
  const applyAncillaryData = vi.fn(() => pending.promise);
  const { workbench, renderer } = createWorkbenchHarness({ applyAncillaryData });
  await workbench.loadGraph({ content: '(A,B)Root;', format: 'newick', datasetName: undefined });
  const upload = workbench.applyAncillaryData(ancillaryData);
  const rejected = expect(upload).rejects.toThrow(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
  await expect(workbench.applyAncillaryData(ancillaryData)).rejects.toThrow('pending');
  await workbench.loadGraph({ content: '(C,D)Root;', format: 'newick', datasetName: undefined });
  pending.resolve(ancillaryResult);
  await rejected;
  expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(2);
  workbench.dispose();
});

it('rejects applying data before a tree is loaded', async () => {
  const applyAncillaryData = vi.fn();
  const { workbench } = createWorkbenchHarness({ applyAncillaryData });
  await expect(workbench.applyAncillaryData(ancillaryData)).rejects.toThrow();
  expect(applyAncillaryData).not.toHaveBeenCalled();
  workbench.dispose();
});

it('captures load settings before preparation while retaining caller ownership', async () => {
  vi.useFakeTimers();
  const prepared = deferred<GraphPrepareResult>();
  const { workbench, graphClient } = createWorkbenchHarness({
    prepareGraph: vi.fn(() => prepared.promise),
    readViewport: vi.fn(async () => ({
      ...viewportResponse(),
      nodes: [{ ...viewportResponse().nodes[0], annotations: nodeAnnotations({ country: 'PT', year: 2020 }) }],
    })),
  });
  try {
    const options = {
      visualMapping: { colorField: 'country', palette: ['#123456'], pie: { fields: ['country'] } },
      displayOptions: { nodeLabels: false },
      lod: { maxNodes: 25 },
    };
    const pending = workbench.loadGraph({ format: 'newick', content: 'A;' }, options);
    options.visualMapping.colorField = 'year';
    options.visualMapping.palette[0] = '#ffffff';
    options.visualMapping.pie.fields.push('year');
    options.displayOptions.nodeLabels = true;
    options.lod.maxNodes = 50;
    prepared.resolve(prepareResponse());
    await vi.advanceTimersByTimeAsync(0);
    const graph = await pending;
    expect(graph.nodes[0].color).toBe(deriveColor('PT', ['#123456']));
    expect(graph.nodes[0].attributes?.label).toBe('');
    expect(graphClient.readViewport).toHaveBeenCalledWith(expect.objectContaining({ maxNodes: 25 }));
    expect(Object.isFrozen(options.visualMapping.pie.fields)).toBe(false);
  } finally {
    workbench.dispose();
    vi.useRealTimers();
  }
});
