import { setupViewportHarness } from './harness';
import { recordingRenderer } from '../../doubles/recordingRenderer';
import type { GraphClient } from '../../../src/contracts/graph/GraphClient';
import { toDatasetId, toLayoutVersion } from '../../../src/contracts/graph/graphIdentifiers';
import { expect, it, vi } from 'vitest';
import type { GraphViewportRequest } from '../../../src/contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../../src/contracts/graph/viewport/GraphViewportResult';
import type { GraphViewportReadOptions } from '../../../src/contracts/graph/viewport/GraphViewportReadOptions';
import type { GraphRenderer } from '../../../src/render/renderer.types';
import { viewportResponse } from './fixtures';
const { Coordinator: GraphViewportCoordinator } = setupViewportHarness();

describe('GraphViewportCoordinator', () => {
  it('keeps a fulfilled initial load fulfilled after unmount', async () => {
    const renderer = recordingRenderer();
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport: vi.fn().mockResolvedValue(viewportResponse()) },
    });
    const initial = controller.waitForInitialViewport();
    controller.mount();
    await vi.runOnlyPendingTimersAsync();
    const graph = await initial;
    controller.unmount();
    await expect(controller.waitForInitialViewport()).resolves.toBe(graph);
  });

  it('can recover the view after an initial failure without changing the rejected initial promise', async () => {
    const renderer = recordingRenderer();
    const failure = new Error('Initial viewport failed');
    const readViewport = vi
      .fn<() => Promise<GraphViewportResult>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
    });
    const initial = controller.waitForInitialViewport();
    const rejected = expect(initial).rejects.toBe(failure);
    controller.mount();
    await vi.runOnlyPendingTimersAsync();
    await rejected;
    controller.refreshNow();
    await vi.runOnlyPendingTimersAsync();
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    await expect(controller.waitForInitialViewport()).rejects.toBe(failure);
    controller.unmount();
  });

  it('invalidates in-flight responses and defers refresh until manipulation ends', async () => {
    const renderer = recordingRenderer();
    let resolveLate: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi
      .fn()
      .mockResolvedValueOnce(viewportResponse())
      .mockImplementationOnce(
        () =>
          new Promise<GraphViewportResult>(resolve => {
            resolveLate = resolve;
          })
      )
      .mockResolvedValue(viewportResponse({ lodLevel: 1 }));
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      renderer,
      client: { readViewport },
      lodTierCount: 2,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    renderer.emitManipulation(true);
    controller.refreshNow({ lodLevel: 1 });
    resolveLate(viewportResponse({ nodes: [] }));
    await vi.advanceTimersByTimeAsync(500);
    expect(renderer.appliedGraphs).toHaveLength(1);
    expect(readViewport).toHaveBeenCalledTimes(2);
    renderer.emitManipulation(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenCalledTimes(3);
    expect(renderer.appliedGraphs.at(-1)?.viewMeta.lodLevel).toBe(1);
    controller.unmount();
  });

  it('loads viewport responses and applies renderer-neutral graph snapshots', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const onGraphApplied = vi.fn();
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      layoutVersion: toLayoutVersion('layout-0'),
      client: { readViewport },
      renderer,
      lodTierCount: 3,
      onGraphApplied,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.mocked(readViewport).mock.calls.map(call => call[0])).toContainEqual(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        layoutVersion: toLayoutVersion('layout-0'),
        lodLevel: 0,
      })
    );
    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.fitGraphSnapshot).toHaveBeenCalledWith(renderer.appliedGraphs[0]);
    expect(renderer.appliedGraphs[0]?.nodes.map(node => node.id)).toEqual(['root', 'cluster-a']);
    expect(renderer.appliedGraphs[0]?.viewMeta.globalBounds).toEqual({
      minX: -100,
      maxX: 100,
      minY: -50,
      maxY: 50,
    });
    expect(onGraphApplied).toHaveBeenCalledWith(
      renderer.appliedGraphs[0],
      expect.objectContaining({ datasetId: toDatasetId('tree') })
    );
  });

  it('reads a bounded viewport when the renderer reports a camera change', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockClear();
    renderer.viewportState = {
      bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 },
      cameraRatio: 0.1,
    };

    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);

    expect(vi.mocked(readViewport).mock.calls.map(call => call[0])).toContainEqual(
      expect.objectContaining({
        datasetId: toDatasetId('tree'),
        xmin: expect.any(Number),
        xmax: expect.any(Number),
        ymin: expect.any(Number),
        ymax: expect.any(Number),
        lodLevel: expect.any(Number),
      })
    );
  });

  it('suppresses older in-flight responses when a newer viewport request wins', async () => {
    const renderer = recordingRenderer();
    const pending: Array<(response: GraphViewportResult) => void> = [];
    const readViewport = vi.fn(
      () =>
        new Promise<GraphViewportResult>(resolve => {
          pending.push(resolve);
        })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()?.(viewportResponse({ layoutVersion: toLayoutVersion('initial') }));
    await Promise.resolve();
    vi.mocked(renderer.applyGraphSnapshot!).mockClear();
    renderer.appliedGraphs = [];

    renderer.viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    controller.refreshNow({ lodLevel: 'finest' });
    await vi.advanceTimersByTimeAsync(0);

    pending[1]?.(viewportResponse({ layoutVersion: toLayoutVersion('newer'), nodes: [] }));
    await Promise.resolve();
    pending[0]?.(viewportResponse({ layoutVersion: toLayoutVersion('older') }));
    await Promise.resolve();

    expect(renderer.applyGraphSnapshot).toHaveBeenCalledTimes(1);
    expect(renderer.appliedGraphs[0]?.nodes).toEqual([]);
  });

  it('invalidates an in-flight viewport as soon as a newer camera query is scheduled', async () => {
    const renderer = recordingRenderer();
    const pending: Array<(response: GraphViewportResult) => void> = [];
    const signals: AbortSignal[] = [];
    const readViewport = vi.fn((_request: GraphViewportRequest, options?: GraphViewportReadOptions) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise<GraphViewportResult>(resolve => pending.push(resolve));
    });
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    pending.shift()!(viewportResponse());
    await Promise.resolve();
    renderer.viewportState = { ...renderer.viewportState, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(60);
    const applied = renderer.appliedGraphs.length;
    renderer.viewportState = { ...renderer.viewportState, bounds: { xmin: 100, xmax: 200, ymin: -200, ymax: -100 } };
    renderer.emitViewChange();
    pending.shift()!(viewportResponse({ nodes: [] }));
    expect(signals[1]?.aborted).toBe(true);
    await Promise.resolve();
    expect(renderer.appliedGraphs).toHaveLength(applied);
    await vi.advanceTimersByTimeAsync(120);
    pending.shift()!(viewportResponse({ nodes: [] }));
    await Promise.resolve();
    expect(renderer.appliedGraphs).toHaveLength(applied + 1);
    expect(signals[2]?.aborted).toBe(false);
    expect(readViewport.mock.calls[2]?.[1]?.annotationsFrom).toMatchObject({ layoutVersion: 'layout-1' });
    controller.unmount();
  });

  it('fetches the final camera position when input interrupts a fitted response', async () => {
    const renderer = recordingRenderer();
    const readViewport = vi.fn().mockResolvedValue(viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      nodeCount: 10000,
    });
    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.refreshNow({ fitToResponse: true });
    await vi.advanceTimersByTimeAsync(0);
    const requests = readViewport.mock.calls.length;
    renderer.viewportState = { bounds: { xmin: 100, xmax: 200, ymin: -200, ymax: -100 }, cameraRatio: 0.1 };
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(readViewport).toHaveBeenCalledTimes(requests + 1);
    expect(vi.mocked(readViewport).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ xmin: 50, xmax: 250 }));
    controller.unmount();
  });

  it('ignores stale responses after unmount', async () => {
    const renderer = recordingRenderer();
    let resolveResponse: (response: GraphViewportResult) => void = () => undefined;
    const readViewport = vi.fn(
      () =>
        new Promise<GraphViewportResult>(resolve => {
          resolveResponse = resolve;
        })
    );
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    controller.unmount();
    resolveResponse(viewportResponse());
    await Promise.resolve();

    expect(renderer.applyGraphSnapshot).not.toHaveBeenCalled();
  });

  it('does not refresh from camera changes while paused but refreshes predictably on resume', async () => {
    let paused = false;
    const renderer = recordingRenderer();
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      lodTierCount: 4,
      getPaused: () => paused,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);
    readViewport.mockClear();
    renderer.viewportState = { bounds: { xmin: 1, xmax: 2, ymin: 3, ymax: 4 }, cameraRatio: 0.1 };

    paused = true;
    renderer.emitViewChange();
    await vi.advanceTimersByTimeAsync(200);
    expect(readViewport).not.toHaveBeenCalled();

    paused = false;
    controller.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(readViewport).toHaveBeenCalledOnce();
  });

  it('fails predictably when a renderer cannot apply graph snapshots', async () => {
    const readViewport = vi.fn<GraphClient['readViewport']>(async () => viewportResponse());
    const onError = vi.fn();
    const renderer: GraphRenderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      setViewChangeHandler: vi.fn(),
      getViewportState: vi.fn(() => ({ bounds: { xmin: -10, xmax: 10, ymin: -20, ymax: 20 }, cameraRatio: 1 })),
    };
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId('tree'),
      client: { readViewport },
      renderer,
      onError,
    });

    controller.mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Viewport sync requires a renderer that can apply graph snapshots.',
      })
    );
  });
});
