import { centerCameraOnCoordinates } from '../src/render/adapters/sigma/camera/sigmaCameraState';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSigmaDoubles } from './doubles/sigmaFake';
import { createMotionWorkerDoubles } from './doubles/motionWorkerFake';

let sigmaDoubles: ReturnType<typeof createSigmaDoubles>;
let motionDoubles: ReturnType<typeof createMotionWorkerDoubles>;
const sigma = () => sigmaDoubles.instances.at(-1)!;
const motion = () => motionDoubles.instances.at(-1)!;
const commands = () =>
  motionDoubles.instances.flatMap(worker => worker.postMessage.mock.calls.map(([command]) => command));
const starts = () => commands().filter(command => command.type === 'start');
const kills = () => motionDoubles.instances.reduce((count, worker) => count + worker.terminate.mock.calls.length, 0);
let shouldThrowOnPieProgram = false;
let pieProgramInputs: Array<{ slices: Array<{ color: { value: string }; value: { attribute: string } }> }> = [];
let animationFrameCallback: FrameRequestCallback | null = null;
let animationFrameId = 0;

vi.mock('../src/render/adapters/sigma/motion/elastic.worker?worker&inline', () => ({
  default: function () {
    return new motionDoubles.Worker();
  },
}));

vi.mock('@sigma/node-piechart', () => ({
  createNodePiechartProgram: (input: { slices: Array<{ color: { value: string }; value: { attribute: string } }> }) => {
    pieProgramInputs.push(input);
    if (shouldThrowOnPieProgram) {
      throw new Error('pie program failed');
    }
    return class FakePiechartProgram {};
  },
}));

vi.mock('sigma', () => ({
  default: function (...args: ConstructorParameters<ReturnType<typeof createSigmaDoubles>['Sigma']>) {
    return new sigmaDoubles.Sigma(...args);
  },
}));

import realSigmaRenderer, {
  SIGMA_MAX_LOD_ZOOM,
  sigmaCameraToViewportState,
  sigmaCameraToSemanticViewState,
  sigmaRatioToLodZoom,
} from '../src/render/adapters/sigma/sigmaRenderer';
import { MAX_PIE_SLICE_KEYS, PIE_ATTRIBUTE_PREFIX, PIE_OTHER_SLICE_KEY } from '../src/render/mapping/pieMapping';
import Graph from 'graphology';
import { applyPieChartNodeTypes } from '../src/render/adapters/sigma/attributes/sigmaNodeAttributes';
import {
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_NODE_TYPE_PIECHART,
} from '../src/render/adapters/sigma/sigmaRendering.constants';
import type { GraphNodeAttributes, PositionedGraph } from '../src/contracts/positioned';
import { freezeInput } from './helpers/state';

const renderers = new Set<ReturnType<typeof realSigmaRenderer>>();
function createSigmaRenderer(...args: Parameters<typeof realSigmaRenderer>) {
  const renderer = realSigmaRenderer(...args);
  renderers.add(renderer);
  return renderer;
}

const CONTAINER_ID = 'graph-root';

function requireContainer(): HTMLElement {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    throw new Error(`Missing test container: ${CONTAINER_ID}`);
  }
  return container;
}

describe('sigmaRenderer', () => {
  beforeEach(() => {
    sigmaDoubles = createSigmaDoubles();
    motionDoubles = createMotionWorkerDoubles(true);
    document.body.innerHTML = `<div id="${CONTAINER_ID}"></div>`;
    shouldThrowOnPieProgram = false;
    pieProgramInputs = [];
    animationFrameCallback = null;
    animationFrameId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      animationFrameCallback = callback;
      animationFrameId += 1;
      return animationFrameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      animationFrameCallback = null;
    });
  });

  afterEach(() => {
    renderers.forEach(renderer => renderer.unmount());
    renderers.clear();
    motionDoubles.instances.forEach(worker => worker.terminate());
    vi.restoreAllMocks();
  });

  it('keeps independent views alive when another renderer is disposed', () => {
    const first = createSigmaRenderer({ forceMotion: { enabled: false } });
    first.mount({ container: document.createElement('div') });
    first.render({ nodes: [{ id: 'first', x: 0, y: 0 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    const firstSigma = sigma();
    const second = createSigmaRenderer({ forceMotion: { enabled: false } });
    second.mount({ container: document.createElement('div') });
    second.render({ nodes: [{ id: 'second', x: 1, y: 1 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    const secondSigma = sigma();
    const changed = vi.fn();
    second.setViewChangeHandler(changed);
    first.unmount();
    secondSigma.dimensions = { width: 640, height: 480 };
    secondSigma.emit('resize', {});
    expect(firstSigma.disposed).toBe(true);
    expect(secondSigma.disposed).toBe(false);
    expect(secondSigma.graph.nodes()).toEqual(['second']);
    expect(second.getViewportState()?.pixelSize).toEqual({ width: 640, height: 480 });
    expect(changed).toHaveBeenCalledOnce();
  });

  it('resizes with its host panel and disconnects the container observer on unmount', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let notify: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      }
    );
    try {
      const renderer = createSigmaRenderer();
      const container = requireContainer();
      renderer.mount({ container });
      expect(observe).toHaveBeenCalledWith(container);
      const before = sigma().scheduledRenders;
      notify?.([], {} as ResizeObserver);
      expect(sigma().scheduledRenders).toBe(before + 1);
      renderer.unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
      notify?.([], {} as ResizeObserver);
      expect(sigma().scheduledRenders).toBe(before + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps renderer instances independent and allows methods to be passed as callbacks', () => {
    const first = createSigmaRenderer({ forceMotion: { enabled: false } });
    const second = createSigmaRenderer({ forceMotion: { enabled: false } });
    first.mount({ container: document.createElement('div') });
    const firstGraph = sigma().graph!;
    second.mount({ container: document.createElement('div') });
    const secondGraph = sigma().graph!;

    const { render, unmount } = first;
    render({ nodes: [{ id: 'a', x: 1, y: 2 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    expect(firstGraph.nodes()).toEqual(['a']);
    expect(secondGraph.nodes()).toEqual([]);

    unmount();
    second.render({ nodes: [{ id: 'b', x: 3, y: 4 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    expect(secondGraph.nodes()).toEqual(['b']);
    expect(second.getViewportState()).not.toBeNull();
    second.unmount();
  });

  it('refreshes viewport detail on resize without requiring a camera change', () => {
    const renderer = createSigmaRenderer();
    renderer.mount({ container: document.createElement('div') });
    renderer.render({ nodes: [{ id: 'a', x: 0, y: 0 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    const handler = vi.fn();
    renderer.setViewChangeHandler(handler);
    sigma().dimensions = { width: 600, height: 400 };
    sigma().handler('resize')?.({});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(renderer.getViewportState()?.pixelSize).toEqual({ width: 600, height: 400 });
    renderer.unmount();
    expect(sigma().handler('resize')).toBeNull();
  });

  it('keeps a stable footprint budget across tiers and resets it for a new render', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: document.createElement('div') });
    sigma().scaleSize = size => size;
    const snapshot = {
      nodes: [{ id: 'a', x: 0, y: 0, size: 20 }],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    expect(renderer.getViewportState()?.representationSpacingPx).toBe(42);
    const finer = { ...snapshot, nodes: [{ id: 'a', x: 0, y: 0, size: 3 }] };
    renderer.applyGraphSnapshot(finer);
    expect(renderer.getViewportState()?.representationSpacingPx).toBe(42);
    renderer.render(finer);
    expect(renderer.getViewportState()?.representationSpacingPx).toBe(8);
    renderer.unmount();
  });

  it('accounts for the real triangle footprint in the stable detail budget', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: document.createElement('div') });
    sigma().scaleSize = size => size;
    const snapshot = {
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 12,
          attributes: { type: 'triangle', isClusterProxy: true, memberCount: 90_000 },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    expect(sigma().graph?.getNodeAttribute('group', 'size')).toBe(12);
    expect(renderer.getViewportState()?.representationSpacingPx).toBeCloseTo(2 * 12 * 1.35 + 2);
    renderer.applyGraphSnapshot({
      ...snapshot,
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 10,
          attributes: { type: 'triangle', isBranchCollapsed: true, memberCount: 1 },
        },
      ],
    });
    expect(renderer.getViewportState()?.representationSpacingPx).toBeCloseTo(2 * 12 * 1.35 + 2);
    renderer.unmount();
  });

  it('exposes renderer-neutral viewport sync state', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    sigma().camera?.setState({ ratio: 2 });

    expect(renderer.getViewportState()).toEqual({
      bounds: { xmin: 0, xmax: 300, ymin: 0, ymax: 200 },
      cameraRatio: 2,
      selectionBounds: { xmin: 0, xmax: 300, ymin: 0, ymax: 200 },
      representationSpacingPx: 0,
      pixelSize: { width: 300, height: 200 },
    });

    renderer.unmount();
  });

  it('emits separate node click and double-click callbacks', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    const clickHandler = vi.fn();
    const doubleClickHandler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [{ id: 'cluster-a', x: 0, y: 0, attributes: { clusterId: 'cluster-a' } }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    renderer.setNodeClickHandler(clickHandler);
    renderer.setNodeDoubleClickHandler(doubleClickHandler);

    sigma().handler('clickNode')?.({ node: 'cluster-a' });
    sigma().handler('doubleClickNode')?.({ node: 'cluster-a' });

    expect(clickHandler).toHaveBeenCalledWith({
      nodeId: 'cluster-a',
      attributes: expect.objectContaining({ clusterId: 'cluster-a' }),
    });
    expect(doubleClickHandler).toHaveBeenCalledWith({
      nodeId: 'cluster-a',
      attributes: expect.objectContaining({ clusterId: 'cluster-a' }),
    });

    renderer.unmount();
  });

  it('provides real Sigma-derived hit coordinates for interactive aggregate triangles', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    sigmaDoubles.defaults.graphToViewport = point => ({ x: point.x + 100, y: point.y + 50 });

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        {
          id: 'cluster-b',
          x: 12,
          y: 8,
          attributes: { clusterId: 'cluster-b', memberCount: 5, isClusterProxy: true, type: 'triangle' },
        },
        { id: 'leaf', x: 2, y: 3, attributes: { memberCount: 1 } },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(renderer.getInteractiveAggregateTargets()).toEqual([
      { clusterId: 'cluster-b', representedNodeCount: 5, clientX: 112, clientY: 58 },
    ]);

    renderer.unmount();
  });

  it('keeps camera and node handlers bound after Sigma is rebuilt for pie programs', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    const viewHandler = vi.fn();
    const clickHandler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.setViewChangeHandler(viewHandler);
    renderer.setNodeClickHandler(clickHandler);

    renderer.render({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: { pie__country__value__portugal: 1 },
        },
      ],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 0,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });

    sigma().camera.emit('updated', undefined);
    sigma().handler('clickNode')?.({ node: 'a' });

    expect(viewHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: expect.any(Object),
        zoom: expect.any(Number),
      })
    );
    expect(clickHandler).toHaveBeenCalledWith({
      nodeId: 'a',
      attributes: expect.objectContaining({ pie__country__value__portugal: 1 }),
    });

    expect(sigma().customBBox).toEqual({ x: [-1000, 1000], y: [-500, 500] });
    renderer.unmount();
  });

  it('dims non-highlighted nodes/edges via reducers and clears them', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 10 },
        { id: 'c', x: 20, y: 20 },
      ],
      edges: [
        { id: 'e_a_b', source: 'a', target: 'b' },
        { id: 'e_b_c', source: 'b', target: 'c' },
      ],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    renderer.setHighlightedNodes(new Set(['a', 'b']));

    const nodeReducer = sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const edgeReducer = sigma().settings?.edgeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(typeof nodeReducer).toBe('function');
    // Highlighted node is untouched; outside node is dimmed and delabeled.
    expect(nodeReducer?.('a', { color: '#111', label: 'a' })).toMatchObject({
      color: '#111',
      label: 'a',
    });
    expect(nodeReducer?.('c', { color: '#111', label: 'c' })).toMatchObject({
      color: '#cbd5e1',
      label: '',
    });
    // Internal edge stays; boundary edge (b-c) is dimmed.
    expect(edgeReducer?.('e_a_b', { color: '#111' })).toMatchObject({
      color: '#111',
    });
    expect(edgeReducer?.('e_b_c', { color: '#111' })).toMatchObject({
      color: '#e2e8f0',
    });

    // Clearing removes the reducers.
    renderer.setHighlightedNodes(null);
    expect(sigma().settings?.nodeReducer).toBeNull();
    expect(sigma().settings?.edgeReducer).toBeNull();

    renderer.unmount();
  });

  it('runs live force motion for both client and server layouts', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(starts().length).toBe(1);

    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(starts().length).toBe(2);
    expect(kills()).toBe(1);
    expect(starts().at(-1)?.settings).toMatchObject({
      // Defaults are applied inside the worker.
    });

    renderer.unmount();
  });

  it('allows scale-aware force settings to be overridden', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer({
      forceMotion: {
        enabled: true,
        settings: { anchorStrength: 0.05, linkStrength: 0.4 },
      },
    });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(starts().at(-1)?.settings).toMatchObject({
      anchorStrength: 0.05,
      linkStrength: 0.4,
    });

    renderer.unmount();
  });

  it('can disable live force motion', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [{ id: 'e_root_a_1', source: 'root', target: 'a' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(starts().length).toBe(0);

    renderer.unmount();
  });

  it('shows exact scoped hover counts, refreshes them across snapshots and clears stale tooltips', () => {
    const container = requireContainer();
    const renderer = createSigmaRenderer();
    renderer.mount({ container });
    const snapshot = {
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 8,
          attributes: { isClusterProxy: true, memberCount: 3, metadata: { profile_count: 7 } },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    sigma().handler('enterNode')?.({ node: 'group' });
    expect(container.title).toContain('Automatic group (LoD): group');
    expect(container.title).toContain('Nodes represented: 3');
    expect(container.title).toContain('Isolates represented: 7');
    renderer.applyGraphSnapshot({
      ...snapshot,
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 8,
          attributes: { isBranchCollapsed: true, collapsedBranchCount: 99, metadata: { profile_count: 2 } },
        },
      ],
    });
    expect(container.title).toContain('Nodes represented: 100 (root + 99 hidden)');
    expect(container.title).toContain('Root node isolates: 2');
    expect(container.title).toContain('Branch isolate total: Unavailable');
    sigma().handler('leaveNode')?.({ node: 'group' });
    expect(container.hasAttribute('title')).toBe(false);
    sigma().handler('enterNode')?.({ node: 'group' });
    renderer.applyGraphSnapshot({ ...snapshot, nodes: [] });
    expect(container.hasAttribute('title')).toBe(false);
    renderer.unmount();
    expect(sigma().handler('enterNode')).toBeNull();
    expect(sigma().handler('leaveNode')).toBeNull();
  });

  it('registers node programs for selected nodes and expandable cluster proxies', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });

    const nodeProgramClasses = sigma().settings?.['nodeProgramClasses'] as Record<string, unknown> | undefined;

    expect(nodeProgramClasses).toBeDefined();
    expect(nodeProgramClasses?.['border']).toBeDefined();
    expect(nodeProgramClasses?.['triangle']).toBeDefined();

    renderer.unmount();
  });

  it('points cluster proxy triangle tips at their incident tree edges', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        {
          id: 'cluster',
          x: 0,
          y: 10,
          attributes: { isClusterProxy: true },
        },
      ],
      edges: [{ id: 'root-cluster', source: 'root', target: 'cluster' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(sigma().graph?.getNodeAttribute('cluster', 'type')).toBe('triangle');
    expect(sigma().graph?.getNodeAttribute('cluster', 'triangleRotation')).toBeCloseTo(-Math.PI / 2);

    renderer.unmount();
  });

  it('keeps summary markers visible and distinct when their roots are structural junctions', () => {
    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    const snapshot = {
      nodes: [
        { id: 'union_1', x: 0, y: 0, size: 0, color: '#ffffff' },
        {
          id: 'union_2',
          x: 10,
          y: 0,
          size: 9,
          attributes: { isClusterProxy: true, memberCount: 37, type: 'triangle' },
        },
        { id: 'union_3', x: 0, y: 10, size: 8, attributes: { isBranchCollapsed: true, type: 'triangle' } },
      ],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    const check = () => {
      expect(sigma().graph?.getNodeAttributes('union_1')).toMatchObject({ size: 0, color: '#ffffff' });
      expect(sigma().graph?.getNodeAttributes('union_2')).toMatchObject({
        size: 9,
        color: '#f59e0b',
        type: 'triangle',
      });
      expect(sigma().graph?.getNodeAttributes('union_3')).toMatchObject({
        size: 8,
        color: '#7c3aed',
        type: 'triangle',
      });
    };
    check();
    renderer.applyGraphSnapshot(snapshot);
    check();
    renderer.unmount();
  });

  it('renders manual folds as violet triangles without treating them as LoD aggregates', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'fold', x: 0, y: 10, attributes: { isBranchCollapsed: true, type: 'triangle' } },
        { id: 'group', x: 10, y: 0, attributes: { isClusterProxy: true, memberCount: 5 } },
      ],
      edges: [{ id: 'root-fold', source: 'root', target: 'fold' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    expect(sigma().graph?.getNodeAttribute('fold', 'type')).toBe('triangle');
    expect(sigma().graph?.getNodeAttribute('fold', 'color')).toBe('#7c3aed');
    expect(sigma().graph?.getNodeAttribute('group', 'color')).toBe('#f59e0b');
    expect(sigma().graph?.getNodeAttribute('fold', 'triangleRotation')).toBeCloseTo(-Math.PI / 2);
    expect(renderer.getInteractiveAggregateTargets().map(target => target.clusterId)).toEqual(['group']);
    renderer.focusNode('fold');
    const reducer = sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(reducer?.('fold', sigma().graph!.getNodeAttributes('fold')).type).toBe('triangle');
    expect(reducer?.('fold', sigma().graph!.getNodeAttributes('fold')).color).toBe('#7c3aed');
    renderer.focusNode(null);
    expect(sigma().graph?.getNodeAttribute('fold', 'color')).toBe('#7c3aed');
    renderer.unmount();
  });

  it('keeps cluster proxy triangle tips aligned while force motion moves nodes', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        {
          id: 'cluster',
          x: 0,
          y: 10,
          attributes: { isClusterProxy: true },
        },
      ],
      edges: [{ id: 'root-cluster', source: 'root', target: 'cluster' }],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    motion().emit([10, 0, 0, 10]);

    expect(sigma().graph?.getNodeAttribute('cluster', 'triangleRotation')).toBeCloseTo(Math.atan2(-10, 10));

    renderer.unmount();
  });

  it('uses centered node labels and hides implementation-only node ids', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'union_1', x: 0, y: 0 },
        // A real isolate whose label merely starts with the union prefix
        // must NOT be hidden — only generated `union_<digits>` ids are.
        { id: 'union_sample', x: 0.75, y: 0.75 },
        // `internal_` is not a structural convention the server emits, so an
        // `internal_`-prefixed id is a real node and must render normally.
        { id: 'internal_7', x: 0.5, y: 0.5 },
        { id: 'profile_1', x: 1, y: 1 },
        {
          id: 'cluster_proxy:lod_4_42',
          x: 2,
          y: 2,
          attributes: {
            clusterId: 'lod_4_42',
            isClusterProxy: true,
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(sigma().settings?.defaultDrawNodeLabel).toBeTypeOf('function');
    expect(sigma().graph?.getNodeAttribute('union_1', 'label')).toBe('');
    expect(sigma().graph?.getNodeAttribute('union_1', 'size')).toBe(0);
    expect(sigma().graph?.getNodeAttribute('union_1', 'color')).toBe('#ffffff');
    expect(sigma().graph?.getNodeAttribute('union_sample', 'label')).toBe('union_sample');
    expect(sigma().graph?.getNodeAttribute('union_sample', 'size')).not.toBe(0);
    expect(sigma().graph?.getNodeAttribute('internal_7', 'label')).toBe('internal_7');
    expect(sigma().graph?.getNodeAttribute('internal_7', 'size')).not.toBe(0);
    expect(sigma().graph?.getNodeAttribute('profile_1', 'label')).toBe('profile_1');
    expect(sigma().graph?.getNodeAttribute('cluster_proxy:lod_4_42', 'label')).toBe('');

    renderer.unmount();
  });

  it('renders edge distance labels and distance-weighted grayscale at constant width', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer({
      display: {
        edgeDistanceLabels: true,
        distanceWeightedEdges: true,
      },
    });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [
        {
          id: 'e_root_a_1',
          source: 'root',
          target: 'a',
          attributes: { distance: 2.5 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(sigma().settings?.renderEdgeLabels).toBe(false);
    expect(sigma().graph?.getEdgeAttribute('e_root_a_1', 'label')).toBe('2.500');
    expect(sigma().graph?.getEdgeAttribute('e_root_a_1', 'forceLabel')).toBe(true);
    expect(sigma().graph?.getEdgeAttribute('e_root_a_1', 'size')).toBe(1.75);
    expect(sigma().graph?.getEdgeAttribute('e_root_a_1', 'color')).toBe('#787878');

    sigma().camera?.setState({ ratio: 0.4 });
    sigma().camera.emit('updated', undefined);
    expect(sigma().settings?.renderEdgeLabels).toBe(true);

    sigma().camera?.setState({ ratio: 1 });
    sigma().camera.emit('updated', undefined);
    expect(sigma().settings?.renderEdgeLabels).toBe(false);

    renderer.unmount();
  });

  it('updates display options without remounting the workbench', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [
        {
          id: 'e_root_a_1',
          source: 'root',
          target: 'a',
          attributes: { distance: 3 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    renderer.updateDisplayOptions({
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [
        {
          id: 'e_root_a_1',
          source: 'root',
          target: 'a',
          attributes: { distance: 3 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(sigma().settings?.renderEdgeLabels).toBe(false);
    expect(sigma().graph?.getEdgeAttribute('e_root_a_1', 'label')).toBe('3');

    renderer.unmount();
  });

  it('applies PHYLOViZ node and goeBURST edge color conventions', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        {
          id: 'founder',
          x: 0,
          y: 0,
          attributes: { metadata: { st_role: 'group founder' } },
        },
        {
          id: 'subfounder',
          x: 80,
          y: 100,
          attributes: { subgroup_founder: true },
        },
        { id: 'common', x: 160, y: 100 },
        { id: 'selected', x: 240, y: 100, attributes: { selected: true } },
      ],
      edges: [
        {
          id: 'rule_1',
          source: 'founder',
          target: 'subfounder',
          attributes: { tie_break_rule: 1 },
        },
        {
          id: 'rule_3',
          source: 'subfounder',
          target: 'common',
          attributes: { tiebreak_rule: 'rule 3' },
        },
        {
          id: 'tlv',
          source: 'common',
          target: 'selected',
          attributes: { level: 'TLV' },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(sigma().graph?.getNodeAttribute('founder', 'color')).toBe('#86efac');
    expect(sigma().graph?.getNodeAttribute('subfounder', 'color')).toBe('#15803d');
    expect(sigma().graph?.getNodeAttribute('common', 'color')).toBe('#93c5fd');
    expect(sigma().graph?.getNodeAttribute('selected', 'color')).toBe('#dc2626');
    expect(sigma().graph?.getEdgeAttribute('rule_1', 'color')).toBe('#2563eb');
    expect(sigma().graph?.getEdgeAttribute('rule_3', 'color')).toBe('#dc2626');
    expect(sigma().graph?.getEdgeAttribute('tlv', 'color')).toBe('#9ca3af');

    renderer.unmount();
  });

  it('marks focused search nodes as PHYLOViZ selected nodes', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer({
      display: {
        nodeLabels: false,
      },
    });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'target', x: 0, y: 0, size: 6 },
        { id: 'nearby', x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    renderer.focusNode('target');

    const nodeReducer = sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const renderedTarget = nodeReducer?.('target', {
      type: sigma().graph?.getNodeAttribute('target', 'type'),
      color: sigma().graph?.getNodeAttribute('target', 'color'),
      borderColor: sigma().graph?.getNodeAttribute('target', 'borderColor'),
      label: sigma().graph?.getNodeAttribute('target', 'label'),
      size: sigma().graph?.getNodeAttribute('target', 'size'),
    });

    expect(sigma().graph?.getNodeAttribute('target', 'type')).toBe('circle');
    expect(sigma().graph?.getNodeAttribute('target', 'color')).toBe('#93c5fd');
    expect(renderedTarget).toMatchObject({
      type: 'border',
      color: '#dc2626',
      borderColor: '#ffffff',
      forceLabel: true,
      label: 'target',
    });
    expect(renderedTarget?.size).toBeGreaterThan(6);
    expect(sigma().graph?.getNodeAttribute('nearby', 'type')).toBe('circle');

    renderer.unmount();
  });

  it("centers raw search coordinates through Sigma's graph conversion", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    sigmaDoubles.defaults.graphToViewport = point => ({
      x: point.x * 4 + 100,
      y: point.y * 4 + 50,
    });
    sigmaDoubles.defaults.viewportToFramedGraph = point => ({
      x: (point.x - 100) / 40,
      y: (point.y - 50) / 40,
    });

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });

    expect(renderer.centerOnCoordinates(25, -5)).toBe(true);
    expect(sigma().camera?.state).toMatchObject({
      x: 2.5,
      y: -0.5,
      ratio: 1,
    });

    renderer.unmount();
  });

  it('clears focused node selection when the canvas background is clicked', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    const nodeClickHandler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.setNodeClickHandler(nodeClickHandler);
    renderer.render({
      nodes: [
        { id: 'target', x: 0, y: 0, size: 6 },
        { id: 'nearby', x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    renderer.focusNode('target');
    expect(sigma().settings?.nodeReducer).toEqual(expect.any(Function));

    sigma().handler('clickStage')?.({});

    expect(sigma().settings?.nodeReducer).toBeNull();
    expect(nodeClickHandler).toHaveBeenCalledWith({ nodeId: null });

    renderer.unmount();
  });

  it('uses darker Full MST grayscale links for lower distances', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 80, y: 0 },
        { id: 'c', x: 160, y: 0 },
      ],
      edges: [
        {
          id: 'near',
          source: 'a',
          target: 'b',
          attributes: { distance: 1 },
        },
        {
          id: 'far',
          source: 'b',
          target: 'c',
          attributes: { distance: 5 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(sigma().graph?.getEdgeAttribute('near', 'color')).toBe('#232323');
    expect(sigma().graph?.getEdgeAttribute('far', 'color')).toBe('#969696');

    renderer.unmount();
  });

  it('maps deeper camera zoom to progressively higher lod zoom values', () => {
    expect(sigmaRatioToLodZoom(2)).toBe(0.5);
    expect(sigmaRatioToLodZoom(1)).toBe(1);
    expect(sigmaRatioToLodZoom(0.5)).toBe(2);
    expect(sigmaRatioToLodZoom(0.25)).toBe(3);
    expect(sigmaRatioToLodZoom(0.125)).toBe(4);
    expect(sigmaRatioToLodZoom(0.05)).toBeGreaterThanOrEqual(5);
    expect(sigmaRatioToLodZoom(0.002)).toBe(SIGMA_MAX_LOD_ZOOM);
  });

  it('translates sigma camera state into graph-space viewport bounds', () => {
    expect(
      sigmaCameraToViewportState({ minX: -120, maxX: 280, minY: 0, maxY: 300 }, { x: 0.25, y: 0.5, ratio: 0.5 })
    ).toEqual({
      x: -20,
      y: 150,
      width: 200,
      height: 150,
    });
  });

  it('derives semantic view state from normalized sigma camera state', () => {
    expect(
      sigmaCameraToSemanticViewState({ minX: -120, maxX: 280, minY: 0, maxY: 300 }, { x: -10, y: 2, ratio: 0.25 })
    ).toEqual({
      camera: {
        x: 0,
        y: 1,
        ratio: 0.25,
      },
      viewport: {
        x: -120,
        y: 300,
        width: 100,
        height: 75,
      },
      lodZoom: 3,
      edgeDistanceLabelsVisible: true,
    });
  });

  it('emits camera viewports in global graph bounds when a slice provides them', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    const handler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.setViewChangeHandler(handler);
    renderer.render({
      nodes: [
        { id: 'left', x: -10, y: 0 },
        { id: 'nearby', x: 10, y: 0 },
      ],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });

    sigma().camera?.setState({ x: 0.25, y: 0.5, ratio: 0.25 });
    sigma().camera.emit('updated', undefined);

    expect(handler).toHaveBeenCalledWith({
      viewport: {
        x: -500,
        y: 0,
        width: 500,
        height: 250,
      },
      zoom: 3,
    });
    expect(sigma().customBBox).toEqual({
      x: [-1000, 1000],
      y: [-500, 500],
    });

    renderer.unmount();
  });

  it('falls back to default nodes if pie-program rebuild fails', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      return undefined;
    });
    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [{ id: 'a', x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    shouldThrowOnPieProgram = true;
    expect(() => {
      renderer.render({
        nodes: [
          {
            id: 'a',
            x: 0,
            y: 0,
            attributes: { pie__country__value__canada: 1 },
          },
        ],
        edges: [],
        viewMeta: { layout: 'force', lodLevel: 0 },
      });
    }).not.toThrow();
    expect(sigma().graph?.getNodeAttribute('a', 'type')).toBe('circle');
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to build Sigma piechart program; falling back to default nodes.',
      expect.objectContaining({
        sliceCount: 1,
        sliceKeys: ['pie__country__value__canada'],
        error: expect.any(Error),
      })
    );

    shouldThrowOnPieProgram = false;
    expect(() =>
      renderer.render({
        nodes: [{ id: 'a', x: 0, y: 0 }],
        edges: [],
        viewMeta: { layout: 'force', lodLevel: 0 },
      })
    ).not.toThrow();

    renderer.unmount();
    warnSpy.mockRestore();
  });

  it('does not reconstruct Sigma when applying a plain server graph snapshot', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const plainGraph = {
      nodes: [{ id: 'leaf', x: 0, y: 0, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } }],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    const constructions = sigmaDoubles.instances.length;

    renderer.applyGraphSnapshot(plainGraph);
    renderer.applyGraphSnapshot(plainGraph);

    expect(sigmaDoubles.instances).toHaveLength(constructions);

    renderer.unmount();
  });

  it('preserves camera state across repeated server graph snapshots', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const graph = {
      nodes: [{ id: 'leaf', x: 0, y: 0, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } }],
      edges: [],
      viewMeta: {
        layout: 'server' as const,
        lodLevel: 1,
        globalBounds: { minX: -100, maxX: 100, minY: -50, maxY: 50 },
      },
    };

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    sigma().camera?.setState({ x: 0.35, y: 0.45, ratio: 0.2 });

    renderer.applyGraphSnapshot(graph);
    renderer.applyGraphSnapshot({
      ...graph,
      nodes: [{ id: 'leaf-2', x: 10, y: 5, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } }],
    });

    expect(sigma().camera?.state).toMatchObject({ x: 0.35, y: 0.45, ratio: 0.2 });
    expect(sigma().customBBox).toEqual({ x: [-100, 100], y: [-50, 50] });
    expect(sigma().customBBoxCalls).toBe(1);

    renderer.unmount();
  });

  it('preserves the global coordinate frame when toggling labels on a partial slice', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'leaf', x: 10, y: 5 }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });
    sigma().camera?.setState({ x: 1.2, y: -0.3, ratio: 0.2 });
    const constructions = sigmaDoubles.instances.length;
    for (const enabled of [true, false, true]) {
      renderer.updateDisplayOptions({ edgeDistanceLabels: enabled });
      expect(sigma().customBBox).toEqual({ x: [-1000, 1000], y: [-500, 500] });
      expect(sigma().camera?.state).toMatchObject({ x: 1.2, y: -0.3, ratio: 0.2 });
    }
    expect(sigmaDoubles.instances.length).toBe(constructions);
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'leaf', x: 10, y: 5, attributes: { pie__country__value__portugal: 1 } }],
      edges: [],
      viewMeta: {
        layout: 'server',
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });
    expect(sigmaDoubles.instances.length).toBeGreaterThan(constructions);
    expect(sigma().customBBox).toEqual({ x: [-1000, 1000], y: [-500, 500] });
    expect(sigma().camera?.state).toMatchObject({ x: 1.2, y: -0.3, ratio: 0.2 });
    renderer.unmount();
  });

  it('keeps worker motion on while dragging, protects pins and defers viewport replacement', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });
    const snapshot: PositionedGraph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 20, y: 0 },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b', attributes: { distance: 7 } }],
      viewMeta: { layout: 'server', lodLevel: 0, globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    };
    renderer.applyGraphSnapshot(snapshot);
    const graph = sigma().graph!;
    sigma().handler('downNode')?.({ node: 'a', event: { x: 0, y: 0 } });
    sigma()
      .mouse.handlers.get('mousemovebody')
      ?.forEach(handler => handler({ x: 4, y: 3 }));
    expect(renderer.isManipulating()).toBe(true);
    expect(kills()).toBe(0);
    motion().tick(10);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 4, y: 3 });
    expect(graph.getNodeAttribute('b', 'x')).not.toBe(20);
    expect(graph.getEdgeAttribute('ab', 'distance')).toBe(7);
    renderer.applyGraphSnapshot({ ...snapshot, nodes: [...snapshot.nodes, { id: 'c', x: 30, y: 0 }] });
    expect(graph.hasNode('c')).toBe(false);
    sigma()
      .mouse.handlers.get('mouseup')
      ?.forEach(handler => handler({ x: 4, y: 3 }));
    expect(graph.hasNode('c')).toBe(true);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 4, y: 3 });
    expect(renderer.isMotionEnabled()).toBe(true);
    expect(renderer.isManipulating()).toBe(false);
    renderer.setMotionEnabled(false);
    const startCount = starts().length;
    renderer.applyGraphSnapshot(snapshot);
    expect(starts().length).toBe(startCount);
    expect(renderer.getDisplayedNodesInBounds({ xmin: 3, xmax: 5, ymin: 2, ymax: 4 })).toEqual(['a']);
    renderer.resetLayoutEdits();
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 0, y: 0 });
    expect(renderer.isMotionEnabled()).toBe(false);
    renderer.unmount();
  });

  it('preserves manual positions through expansion and detail changes without animating', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    const coarse: PositionedGraph = {
      nodes: [{ id: 'p', x: 20, y: 0, size: 3, attributes: { isClusterProxy: true, clusterId: 'g' } }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0, globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    };
    renderer.applyGraphSnapshot(coarse);
    sigma().handler('downNode')?.({ node: 'p', event: { x: 20, y: 0 } });
    sigma()
      .mouse.handlers.get('mousemovebody')
      ?.forEach(handler => handler({ x: 25, y: 3 }));
    sigma()
      .mouse.handlers.get('mouseup')
      ?.forEach(handler => handler({ x: 25, y: 3 }));
    const fine: PositionedGraph = {
      ...coarse,
      nodes: [
        { id: 'a', x: 19, y: 0, size: 3, attributes: { clusterId: 'g' } },
        { id: 'b', x: 21, y: 0, size: 3, attributes: { clusterId: 'g' } },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
    };
    renderer.applyGraphSnapshot(fine);
    const graph = sigma().graph!;
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 24, y: 3 });
    expect(renderer.isManipulating()).toBe(false);
    animationFrameCallback?.(performance.now() + 300);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 24, y: 3 });
    expect(graph.getNodeAttributes('b')).toMatchObject({ x: 26, y: 3 });
    expect(renderer.isMotionEnabled()).toBe(false);
    expect(renderer.isManipulating()).toBe(false);
    renderer.applyGraphSnapshot(fine);
    expect(renderer.isManipulating()).toBe(false);
    renderer.applyGraphSnapshot({ ...fine, viewMeta: { ...fine.viewMeta, lodLevel: 1 } });
    expect(renderer.isManipulating()).toBe(false);
    animationFrameCallback?.(performance.now() + 300);
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 24, y: 3 });
    renderer.unmount();
  });

  it('interrupts child animation at the displayed position when direct dragging starts', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });
    const viewMeta: PositionedGraph['viewMeta'] = {
      layout: 'server',
      lodLevel: 0,
      globalBounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    };
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'p', x: 20, y: 0, attributes: { isClusterProxy: true, clusterId: 'g' } }],
      edges: [],
      viewMeta,
    });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 25, y: 0, attributes: { clusterId: 'g' } },
        { id: 'b', x: 30, y: 0, attributes: { clusterId: 'g' } },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
      viewMeta,
    });
    animationFrameCallback?.(performance.now() + 80);
    const graph = sigma().graph!;
    const x = graph.getNodeAttribute('a', 'x');
    expect(x).toBeGreaterThan(20);
    expect(x).toBeLessThan(25);
    sigma().handler('downNode')?.({ node: 'a', event: { x, y: 0 } });
    expect(graph.getNodeAttribute('a', 'x')).toBe(x);
    sigma()
      .mouse.handlers.get('mousemovebody')
      ?.forEach(handler => handler({ x: x + 1, y: 0 }));
    expect(graph.getNodeAttribute('a', 'x')).toBeCloseTo(x + 1);
    sigma()
      .mouse.handlers.get('mouseup')
      ?.forEach(handler => handler({ x: x + 1, y: 0 }));
    expect(renderer.isManipulating()).toBe(false);
    renderer.unmount();
  });

  it('clears every retained position when another dataset reuses node identities', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 10, y: 20 },
        { id: 'b', x: 20, y: 30 },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    expect(starts().length).toBe(1);
    renderer.resetLayoutEdits({ allViews: true });
    renderer.setMotionEnabled(true);
    expect(starts().length).toBe(1);
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 100, y: 200 },
        { id: 'b', x: 200, y: 300 },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    expect(sigma().graph!.getNodeAttributes('a')).toMatchObject({ x: 100, y: 200 });
    renderer.unmount();
  });

  it('retains dragged positions while replacing ancillary presentation', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    const snapshot: PositionedGraph = {
      nodes: [{ id: 'a', x: 0, y: 0, color: '#123456', size: 3 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    };
    renderer.applyGraphSnapshot(snapshot);
    const graph = sigma().graph!;
    graph.mergeNodeAttributes('a', { x: 0.05, y: 0.07 });
    renderer.applyGraphSnapshot(
      { ...snapshot, nodes: [{ ...snapshot.nodes[0], color: '#abcdef' }] },
      { preservePositions: true }
    );
    expect(graph.getNodeAttributes('a')).toMatchObject({ x: 0.05, y: 0.07, color: '#abcdef' });
    renderer.unmount();
  });

  it('rebuilds pie programs when category colors change', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: {
            pie__country__value__portugal: 1,
            __pie_category_colors: {
              pie__country__value__portugal: '#123456',
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });
    renderer.render({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: {
            pie__country__value__portugal: 1,
            __pie_category_colors: {
              pie__country__value__portugal: '#abcdef',
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(pieProgramInputs).toHaveLength(2);
    expect(pieProgramInputs[0]?.slices[0]?.color.value).toBe('#123456');
    expect(pieProgramInputs[1]?.slices[0]?.color.value).toBe('#abcdef');

    renderer.unmount();
  });

  it('renders omitted high-cardinality pie values through Others', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: Array.from({ length: MAX_PIE_SLICE_KEYS + 2 }, (_, index) => ({
        id: `node_${index}`,
        x: index,
        y: index,
        attributes: {
          [`${PIE_ATTRIBUTE_PREFIX}country_${index}`]: index + 1,
        },
      })),
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const latestPieProgram = pieProgramInputs.at(-1);
    expect(latestPieProgram?.slices).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(latestPieProgram?.slices.map(slice => slice.value.attribute)).toContain(PIE_OTHER_SLICE_KEY);
    expect(sigma().graph?.getNodeAttribute('node_0', PIE_OTHER_SLICE_KEY)).toBe(1);
    expect(sigma().graph?.getNodeAttribute('node_0', 'type')).toBe('piechart');

    renderer.unmount();
  });

  it('keeps node piecharts visible for 24-category PHYLOViZ fields', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const categories = Array.from({ length: 24 }, (_, index) => `emm_${index}`);
    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: categories.map((category, index) => ({
        id: `node_${index}`,
        x: index,
        y: index,
        attributes: {
          [`${PIE_ATTRIBUTE_PREFIX}emm_type__value__${category}`]: index + 1,
        },
      })),
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const latestPieProgram = pieProgramInputs.at(-1);
    expect(latestPieProgram?.slices).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(latestPieProgram?.slices.map(slice => slice.value.attribute)).toContain(PIE_OTHER_SLICE_KEY);
    expect(sigma().graph?.getNodeAttribute('node_0', 'type')).toBe('piechart');
    expect(sigma().graph?.getNodeAttribute('node_0', PIE_OTHER_SLICE_KEY)).toBe(1);

    renderer.unmount();
  });

  it('toggles and restores node selection styling in-place in viewport sync mode', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = createSigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'node_1', x: 10, y: 20, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } },
        { id: 'node_2', x: 30, y: 40, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    const graph = sigma().graph!;

    // Nodes keep their base graphology attributes; selection is a render reducer.
    expect(graph.getNodeAttribute('node_1', 'unselectedStyle')).toBeUndefined();
    expect(graph.getNodeAttribute('node_1', 'type')).toBeUndefined();
    expect(graph.getNodeAttribute('node_1', 'color')).toBe('#93c5fd');

    renderer.focusNode('node_1');
    const selectedNodeReducer = sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(selectedNodeReducer?.('node_1', graph.getNodeAttributes('node_1'))).toMatchObject({
      type: 'border',
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
      borderColor: '#ffffff',
      forceLabel: true,
    });
    expect(graph.getNodeAttribute('node_1', 'type')).toBeUndefined();
    expect(graph.getNodeAttribute('node_1', 'color')).toBe('#93c5fd');

    renderer.focusNode('node_2');
    const nextNodeReducer = sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(nextNodeReducer?.('node_2', graph.getNodeAttributes('node_2'))).toMatchObject({
      type: 'border',
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
    });
    expect(graph.getNodeAttribute('node_1', 'type')).toBeUndefined();
    expect(graph.getNodeAttribute('node_2', 'type')).toBeUndefined();

    renderer.focusNode(null);
    expect(sigma().settings?.nodeReducer).toBeNull();
    expect(graph.getNodeAttribute('node_2', 'type')).toBeUndefined();

    renderer.unmount();
  });

  it('restarts motion after an LoD transition completes', () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    vi.spyOn(performance, 'now').mockReturnValue(0);

    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });

    renderer.render({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
      ],
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(starts().length).toBe(1);

    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
      ],
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
      viewMeta: { layout: 'server', lodLevel: 1 },
    });

    expect(starts().length).toBe(1);

    const frame = animationFrameCallback;
    expect(frame).not.toBeNull();

    frame?.(1000);

    expect(starts().length).toBe(2);

    renderer.unmount();
  });

  it('does not recenter the camera during a moving LoD transition or overwrite newer navigation', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: document.createElement('div') });
    const viewMeta = { layout: 'server' as const, lodLevel: 0, globalBounds: { minX: 0, maxX: 12, minY: -2, maxY: 4 } };
    renderer.render({
      nodes: [
        { id: 'anchor', x: 2, y: 0 },
        { id: 'proxy', x: 6, y: 0, attributes: { isClusterProxy: true, clusterId: 'group' } },
      ],
      edges: [],
      viewMeta,
    });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'anchor', x: 2, y: 0 },
        { id: 'm1', x: 6, y: 0, attributes: { clusterId: 'group' } },
        { id: 'm2', x: 7, y: 1, attributes: { clusterId: 'group' } },
      ],
      edges: [],
      viewMeta: { ...viewMeta, lodLevel: 1 },
    });
    sigma().camera?.setState({ x: 0.6, y: 0.4, ratio: 0.3 });
    animationFrameCallback?.(1000);
    expect(sigma().camera?.state).toMatchObject({ x: 0.6, y: 0.4, ratio: 0.3 });
    renderer.unmount();
  });

  it('ignores queued transition frames after a newer snapshot or unmount', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: true } });
    renderer.mount({ container: requireContainer() });
    renderer.render({ nodes: [{ id: 'a', x: 0, y: 0 }], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    renderer.applyGraphSnapshot({
      nodes: [{ id: 'a', x: 10, y: 0 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 1 },
    });
    const oldFrame = animationFrameCallback;
    expect(oldFrame).not.toBeNull();

    renderer.applyGraphSnapshot({
      nodes: [{ id: 'b', x: 20, y: 0 }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 2 },
    });
    const currentFrame = animationFrameCallback;
    expect(currentFrame).not.toBeNull();
    const graph = sigma().graph!;
    const notify = vi.fn();
    renderer.setManipulationHandler(notify);
    oldFrame?.(performance.now() + 300);
    expect(graph.nodes()).toEqual(['b']);
    expect(graph.getNodeAttributes('b')).toMatchObject({ x: 20, y: 0 });
    expect(renderer.isManipulating()).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    renderer.unmount();
    currentFrame?.(performance.now() + 300);
    expect(renderer.isManipulating()).toBe(false);
    expect(graph.getNodeAttributes('b')).toMatchObject({ x: 20, y: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
  const snapshot = (attributes: GraphNodeAttributes = {}) => ({
    nodes: [
      { id: 'a', x: 0, y: 0, size: 3, color: '#123456', attributes },
      { id: 'b', x: 10, y: 0, size: 3, color: '#123456' },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b', attributes: { size: 1, color: '#123456', distance: 4, label: '' } }],
    viewMeta: { layout: 'server' as const, lodLevel: 0 },
  });
  it('preserves the different styling rules for initial rendering and prepared snapshots', () => {
    const input = freezeInput({
      nodes: [
        {
          id: 'a',
          x: 5,
          y: 6,
          size: 8,
          color: '#123456',
          attributes: { x: 900, y: 901, size: 77, color: '#abcdef', phyloviz_role: 'group_founder', label: ' sample ' },
        },
        { id: 'b', x: 10, y: 0 },
      ],
      edges: [
        {
          id: 'ab',
          source: 'a',
          target: 'b',
          attributes: { distance: 4, size: 7, color: '#112233', label: ' prepared edge ', forceLabel: false },
        },
        { id: 'outside', source: 'b', target: 'missing', attributes: { distance: 8 } },
      ],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    });
    const renderer = createSigmaRenderer({
      forceMotion: { enabled: false },
      edge: { size: 2 },
      display: { edgeDistanceLabels: true },
    });
    renderer.mount({ container: requireContainer() });
    renderer.render(input);
    expect(sigma().graph?.getNodeAttributes('a')).toMatchObject({
      x: 900,
      y: 901,
      size: 77,
      color: '#86efac',
      label: 'sample',
    });
    expect(sigma().graph?.getEdgeAttributes('ab')).toMatchObject({
      size: 2,
      color: '#232323',
      label: '4',
      forceLabel: true,
    });
    expect(sigma().graph?.edges()).toEqual(['ab']);

    renderer.applyGraphSnapshot(input);
    expect(sigma().graph?.getNodeAttributes('a')).toMatchObject({
      x: 5,
      y: 6,
      size: 8,
      color: '#123456',
      label: ' sample ',
    });
    expect(sigma().graph?.getEdgeAttributes('ab')).toMatchObject({
      size: 7,
      color: '#112233',
      label: ' prepared edge ',
      forceLabel: false,
    });
    expect(sigma().graph?.edges()).toEqual(['ab']);
    renderer.unmount();
  });

  it.each(['render', 'applyGraphSnapshot'] as const)(
    '%s owns edge attributes independently from Graphology updates',
    operation => {
      const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
      renderer.mount({ container: requireContainer() });
      const graph = snapshot();
      Object.freeze(graph.edges[0].attributes);
      renderer[operation](graph);
      sigma().graph!.setEdgeAttribute('ab', 'label', '4');
      expect(graph.edges[0].attributes.label).toBe('');
      expect(sigma().graph?.getEdgeAttribute('ab', 'label')).toBe('4');
      renderer.unmount();
    }
  );
  it('owns highlight sets instead of observing edits to the supplied set', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    renderer.applyGraphSnapshot(snapshot());
    const selected = new Set(['a']);
    renderer.setHighlightedNodes(selected);
    selected.clear();
    selected.add('b');
    const reducer = sigma().settings?.nodeReducer as (id: string, attrs: { color: string }) => { color: string };
    expect(reducer('a', { color: '#123456' }).color).toBe('#123456');
    expect(reducer('b', { color: '#123456' }).color).not.toBe('#123456');
    renderer.unmount();
  });
  it('captures motion settings and pin values before restarting the worker', async () => {
    const { default: motion } = await import('../src/render/adapters/sigma/motion/sigmaForceMotion');
    const graph = new Graph();
    graph.addNode('a', { x: 0, y: 0 });
    graph.addNode('b', { x: 10, y: 0 });
    graph.addEdge('a', 'b');
    const options = { enabled: false, settings: { linkStrength: 0.2 } };
    const physics = motion(options, {
      reference: () => undefined,
      anchor: () => undefined,
      constrain: (_id, point) => point,
    });
    const pins = [{ id: 'a', x: 5, y: 7 }];
    physics.setPins(pins);
    pins[0].x = 900;
    pins.push({ id: 'b', x: 800, y: 800 });
    options.settings.linkStrength = 0.9;
    physics.start(graph);
    physics.setEnabled(true);
    const start = [...commands()].reverse().find(command => command.type === 'start');
    const pin = [...commands()].reverse().find(command => command.type === 'pin');
    expect(start?.type === 'start' && start.settings.linkStrength).toBe(0.2);
    expect(pin?.type === 'pin' && pin.points).toEqual([{ id: 'a', x: 5, y: 7 }]);
    physics.dispose();
  });
  it('reuses one pie update path for render and viewport snapshots', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    const graph = snapshot();
    graph.nodes[0].attributes = { pie__one: 2, __pie_category_colors: { pie__one: '#ff0000' } };
    renderer.render(graph);
    const first = sigmaDoubles.instances.length;
    renderer.applyGraphSnapshot(graph);
    expect(sigmaDoubles.instances.length).toBe(first);
    renderer.applyGraphSnapshot({
      ...graph,
      nodes: [
        { ...graph.nodes[0], attributes: { pie__one: 2, __pie_category_colors: { pie__one: '#00ff00' } } },
        graph.nodes[1],
      ],
    });
    expect(sigmaDoubles.instances.length).toBe(first + 1);
    const plain = snapshot();
    renderer.applyGraphSnapshot(plain);
    expect(sigmaDoubles.instances.length).toBe(first + 2);
    renderer.applyGraphSnapshot(plain);
    expect(sigmaDoubles.instances.length).toBe(first + 2);
    renderer.unmount();
  });
  it('keeps the pie fast path and releases event handlers on teardown', () => {
    const renderer = createSigmaRenderer({ piechart: { enabled: false }, forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    renderer.applyGraphSnapshot(snapshot());
    const graph = sigma().graph!;
    const materialize = vi.spyOn(graph, 'mapNodes');
    renderer.applyGraphSnapshot(snapshot());
    expect(materialize).not.toHaveBeenCalled();
    const notify = vi.fn();
    renderer.setNodeClickHandler(notify);
    sigma().handler('clickNode')?.({ event: { node: 'a' } });
    expect(notify).toHaveBeenCalledTimes(1);
    renderer.unmount();
    expect(sigma().handler('clickNode')).toBeNull();
    expect(sigma().handler('doubleClickNode')).toBeNull();
    expect(sigma().camera.handler('updated')).toBeNull();
  });
  it('retains the pie-program failure fallback', () => {
    const renderer = createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    shouldThrowOnPieProgram = true;
    const graph = snapshot();
    graph.nodes[0].attributes = { pie__one: 2 };
    renderer.applyGraphSnapshot(graph);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sigma().graph?.getNodeAttribute('a', 'type')).not.toBe('piechart');
    renderer.unmount();
  });

  it('captures nested renderer settings before mounting', () => {
    const options = { label: { size: 13 }, display: { nodeLabels: true }, edge: { labelSize: 9 } };
    const renderer = createSigmaRenderer(options);
    options.label.size = 50;
    options.display.nodeLabels = false;
    options.edge.labelSize = 50;
    renderer.mount({ container: requireContainer() });
    expect(sigma().settings).toMatchObject({ labelSize: 13, renderLabels: true, edgeLabelSize: 9 });
    renderer.unmount();
  });
});

describe('applyPieChartNodeTypes', () => {
  it('fills slice keys and preserves cluster proxy triangles', () => {
    const graph = new Graph();
    graph.addNode('cluster', {
      type: 'triangle',
      isClusterProxy: true,
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 3,
    });
    graph.addNode('leaf', {});
    const sliceKeys = [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`, `${PIE_ATTRIBUTE_PREFIX}region__value__us`];

    applyPieChartNodeTypes(graph, sliceKeys);

    // Cluster proxies remain triangles; the absent slice key is still filled
    // so a later expansion can reuse the registered pie program.
    expect(graph.getNodeAttribute('cluster', 'type')).toBe('triangle');
    expect(graph.getNodeAttribute('cluster', `${PIE_ATTRIBUTE_PREFIX}region__value__us`)).toBe(0);
    // Leaf has no positive pie data: type is left untouched.
    expect(graph.getNodeAttribute('leaf', 'type')).toBeUndefined();
  });

  it('aggregates non-displayed pie keys into the Others slice', () => {
    const graph = new Graph();
    graph.addNode('n', {
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 2,
      [`${PIE_ATTRIBUTE_PREFIX}region__value__hidden`]: 5,
    });
    const sliceKeys = [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`, PIE_OTHER_SLICE_KEY];

    applyPieChartNodeTypes(graph, sliceKeys);

    expect(graph.getNodeAttribute('n', PIE_OTHER_SLICE_KEY)).toBe(5);
    expect(graph.getNodeAttribute('n', 'type')).toBe(SIGMA_NODE_TYPE_PIECHART);
  });

  it('leaves node types untouched when there are no slice keys', () => {
    const graph = new Graph();
    graph.addNode('n', {
      type: 'triangle',
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 3,
    });

    applyPieChartNodeTypes(graph, []);

    expect(graph.getNodeAttribute('n', 'type')).toBe('triangle');
  });
});

it('does not suppress the next user event when centering is a camera no-op', () => {
  const beforeSetState = vi.fn(),
    setState = vi.fn();
  const sigma = {
    getCamera: () => ({ getState: () => ({ x: 1, y: 2, ratio: 0.02 }), setState }),
    graphToViewport: (p: { x: number; y: number }) => p,
    viewportToFramedGraph: (p: { x: number; y: number }) => p,
  };
  expect(centerCameraOnCoordinates({ sigma: sigma as never, x: 1, y: 2, beforeSetState })).toBe(true);
  expect(beforeSetState).not.toHaveBeenCalled();
  expect(setState).not.toHaveBeenCalled();
});
