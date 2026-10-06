import Graph from 'graphology';
import Sigma from 'sigma';

import { isClusterRepresentative } from '../../mapping/clusterNodes';
import type { GraphLayoutBounds } from '../../../contracts/graph/viewport/GraphLayoutBounds';
import { DisplayPositions } from './motion/displayPositions';
import type { Point } from '../../../contracts/Point';
import type { DragSelection } from '../../renderer.types';
import { exportSigmaPublication } from './sigmaPublicationExport';
import type { SigmaNodeEventPayload } from 'sigma/types';
import type { PositionedGraph } from '../../../contracts/positioned';
import {
  type GraphDisplayOptions,
  type PngExportOptions,
  type GraphRenderer,
  type RenderContext,
  type RenderInteractiveAggregateTarget,
  type RenderNodeClickState,
  type RenderViewportBounds,
  type RenderViewportRequestState,
  RendererType,
  type RenderViewportState,
} from '../../renderer.types';
import { detectPieSliceKeys, PIE_ATTRIBUTE_PREFIX } from '../../mapping/pieMapping';
import {
  defaultCameraState,
  deriveGraphBounds,
  normalizeGraphBounds,
  type SigmaSemanticViewState,
  sigmaCameraToSemanticViewState,
} from './camera/sigmaCamera';
import sigmaBoxSelectController from './interaction/sigmaBoxSelectController';
import sigmaDragController from './interaction/sigmaDragController';
import applySigmaHighlighting from './interaction/sigmaHighlighting';
import createSigmaForceMotion from './motion/sigmaForceMotion';
import createSigmaTransitions from './motion/sigmaTransitions';
import { areStringArraysEqual } from './attributes/sigmaAttributeUtils';
import { addPositionedEdges } from './attributes/sigmaEdgeAttributes';
import {
  addPositionedNodes,
  applyClusterTriangleRotations,
  applyPieChartNodeTypes,
} from './attributes/sigmaNodeAttributes';
import { buildPieProgramSignature, piechartProgramClasses, type PieNodeView } from './programs/sigmaPiePrograms';
import { buildSigmaSettings } from './sigmaRenderer.settings';
import type { SigmaPiechartOptions, SigmaRendererOptions } from './sigmaRenderer.types';
import {
  applyStableCameraBounds,
  centerCameraOnCoordinates,
  centerCameraOnGraphNode,
  readCameraState,
  restoreCameraState,
} from './camera/sigmaCameraState';
import { fitSigmaToGraphSnapshot } from './viewport/graphViewportFit';
import { exportCanvasLayersAsPng } from '../../export/canvasExport';
import { PHYLOVIZ_NODE_SELECTED_COLOR, SIGMA_NODE_TYPE_TRIANGLE } from './sigmaRendering.constants';

export {
  SIGMA_DEFAULT_CAMERA_ZOOM,
  SIGMA_MAX_LOD_ZOOM,
  sigmaCameraToViewportState,
  sigmaCameraToSemanticViewState,
  sigmaRatioToLodZoom,
} from './camera/sigmaCamera';
export type { SigmaPiechartOptions, SigmaRendererOptions };

export const ERR_SIGMA_NOT_READY = 'Sigma renderer is not mounted.';

type NodeClickPayload = SigmaNodeEventPayload | { readonly node?: string; readonly event?: { readonly node?: string } };

// Sigma renderer adapter keeps Sigma-specific behavior isolated from core contracts.
export default function createSigmaRenderer(options: SigmaRendererOptions = {}) {
  let cancelFit: (() => void) | null = null;
  let sigmaGraph: Graph | null = null;
  let glyphFootprintDirty = true;
  let maxGlyphSize = 0;
  let dragSelection: DragSelection = { kind: 'node' };
  const displayPositions = new DisplayPositions();
  const dragPins = new Map<string, Point>();
  let manipulationHandler: ((active: boolean) => void) | null = null;
  let feedbackHandler: ((message: string) => void) | null = null;
  let selectingRegion = false;
  let pendingSnapshot: { graph: PositionedGraph; options?: { preservePositions?: boolean } } | null = null;
  let sourceSnapshot: PositionedGraph | null = null;
  let sigmaInstance: Sigma | null = null;
  let containerElement: HTMLElement | null = null;
  let pieSliceKeys: string[] = [];
  let pieProgramSignature = '';
  let coordinateBounds: GraphLayoutBounds | null = null;
  let viewChangeHandler: ((state: RenderViewportState) => void) | null = null;
  let nodeClickHandler: ((state: RenderNodeClickState) => void) | null = null;
  let nodeDoubleClickHandler: ((state: RenderNodeClickState) => void) | null = null;
  let regionSelectModeEnabled = false;
  let regionSelectedHandler: ((bounds: RenderViewportBounds) => void) | null = null;
  let highlightedNodeIds: ReadonlySet<string> | null = null;
  let suppressViewChangesUntil = 0;
  // One-shot guard: swallows exactly the next view-change emission caused by a
  // programmatic camera move (e.g. focusing a search result), then re-enables
  // immediately so user panning is never blocked by a time window.
  let suppressNextViewChange = false;
  let suppressNodeClicksUntil = 0;
  let lastRenderedGraph: PositionedGraph | null = null;
  let selectedNodeId: string | null = null;
  let selectedClusterStyle: { id: string; color: unknown; size: unknown } | null = null;

  const { forceMotion, ...renderOptions } = options;
  let rendererOptions: SigmaRendererOptions = {
    ...renderOptions,
    label: options.label && { ...options.label },
    edge: options.edge && { ...options.edge },
    display: options.display && { ...options.display },
    piechart: options.piechart && {
      ...options.piechart,
      palette: options.piechart.palette && [...options.piechart.palette],
    },
  };
  const forceMotionController = createSigmaForceMotion(forceMotion, {
    onTick: updateClusterTriangleRotations,
    onError: message => feedbackHandler?.(message),
    reference: id => displayPositions.reference(id),
    anchor: id => displayPositions.anchor(id),
    collisionRadius: (id, size) => {
      const sigma = sigmaInstance;
      if (!sigma?.scaleSize) return undefined;
      const a = sigma.viewportToGraph({ x: 0, y: 0 });
      const b = sigma.viewportToGraph({ x: 1, y: 0 });
      const graphUnitsPerPixel = Math.hypot(b.x - a.x, b.y - a.y);
      // Use the same zoom/resize transform as the GPU, including glyph sizes.
      const shapeScale =
        sigmaGraph?.getNodeAttribute(id, 'type') === SIGMA_NODE_TYPE_TRIANGLE ||
        sigmaGraph?.getNodeAttribute(id, 'isClusterProxy') === true
          ? 1.35
          : 1;
      return (sigma.scaleSize(size) * shapeScale + 1) * graphUnitsPerPixel;
    },
    constrain: (id, point) => displayPositions.set(id, dragPins.get(id) ?? point),
  });
  const transitions = createSigmaTransitions({
    getGraph: () => sigmaGraph,
    getSigma: () => sigmaInstance,
    positions: displayPositions,
    motion: forceMotionController,
    onManipulationChanged: active => manipulationHandler?.(active),
    onComplete: () => emitViewChange(readSemanticViewState()),
  });
  const dragController = sigmaDragController({
    getGraph: () => sigmaGraph,
    getSelection: () => dragSelection,
    isRegionSelectionEnabled: () => regionSelectModeEnabled,
    onStart: ids => {
      cancelCameraFit();
      captureDisplayPositions();
      transitions.cancel();
      ids.forEach(id => dragPins.set(id, displayPositions.get(id)!));
      sendDragPins();
      manipulationHandler?.(true);
    },
    translate: (members, delta) => displayPositions.translate(members, delta),
    onUnavailable: message => feedbackHandler?.(message),
    onMoved: positions => {
      positions.forEach((point, id) => dragPins.set(id, displayPositions.arrange(id, point)));
      sendDragPins();
    },
    onEnd: () => {
      const released = [...dragPins].map(([id, point]) => ({ id, ...point }));
      dragPins.clear();
      forceMotionController.setPins([], released);
      finishManipulation();
    },
    getSigma: () => sigmaInstance,
    suppressViewChangesFor,
    suppressNodeClicksFor,
  });
  const boxSelectController = sigmaBoxSelectController({
    getSigma: () => sigmaInstance,
    getContainer: () => containerElement,
    isModeEnabled: () => regionSelectModeEnabled,
    onStart: () => {
      cancelCameraFit();
      captureDisplayPositions();
      transitions.cancel();
      selectingRegion = true;
      forceMotionController.suspend(true);
      manipulationHandler?.(true);
    },
    onEnd: () => {
      selectingRegion = false;
      forceMotionController.suspend(false);
      finishManipulation();
    },
    onRegionSelected: bounds => regionSelectedHandler?.(bounds),
    suppressNodeClicksFor,
  });

  return {
    kind: RendererType.Sigma,
    setMotionEnabled,
    isMotionEnabled,
    setInteractionFeedbackHandler,
    setManipulationHandler,
    isManipulating,
    getVisibleDisplacedNodeIds,
    getDisplayedNodesInBounds,
    setDragSelection,
    resetLayoutEdits,
    mount,
    render,
    setViewChangeHandler,
    setNodeClickHandler,
    setNodeDoubleClickHandler,
    centerOnNode,
    centerOnCoordinates,
    focusNode,
    updateDisplayOptions,
    exportPng,
    unmount,
    setRegionSelectModeEnabled,
    setRegionSelectedHandler,
    getViewportState,
    applyGraphSnapshot,
    getInteractiveAggregateTargets,
    fitGraphSnapshot,
    setHighlightedNodes,
  } satisfies GraphRenderer & { readonly kind: RendererType };

  function cancelCameraFit(): void {
    cancelFit?.();
    cancelFit = null;
  }

  function trackZoomPointer(event: WheelEvent): void {
    const rect = containerElement?.getBoundingClientRect();
    if (rect) transitions.setZoomPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (transitions.isActive()) {
      captureDisplayPositions();
      transitions.cancel();
      finishManipulation();
    }
  }

  function setMotionEnabled(enabled: boolean): void {
    forceMotionController.setEnabled(enabled);
  }

  function isMotionEnabled(): boolean {
    return forceMotionController.isEnabled();
  }

  function setInteractionFeedbackHandler(handler: ((message: string) => void) | null): void {
    feedbackHandler = handler;
  }

  function setManipulationHandler(handler: ((active: boolean) => void) | null): void {
    manipulationHandler = handler;
  }

  function isManipulating(): boolean {
    return dragPins.size > 0 || transitions.isActive() || selectingRegion;
  }

  function getVisibleDisplacedNodeIds(): readonly string[] {
    const bounds = currentViewportBounds();
    return getDisplayedNodesInBounds(bounds).filter(id => {
      const home = displayPositions.reference(id),
        display = displayPositions.get(id);
      return home && display && Math.hypot(home.x - display.x, home.y - display.y) > 1e-9;
    });
  }

  function getDisplayedNodesInBounds(bounds: RenderViewportBounds): readonly string[] {
    return (
      sigmaGraph?.filterNodes(
        (_id, a) => a.x >= bounds.xmin && a.x <= bounds.xmax && a.y >= bounds.ymin && a.y <= bounds.ymax
      ) ?? []
    );
  }

  function captureDisplayPositions(): void {
    sigmaGraph?.forEachNode((id, attributes) => displayPositions.set(id, { x: attributes.x, y: attributes.y }));
  }

  function sendDragPins(): void {
    forceMotionController.setPins([...dragPins].map(([id, point]) => ({ id, ...point })));
  }

  function finishManipulation(): void {
    const pending = pendingSnapshot;
    pendingSnapshot = null;
    if (pending) applyGraphSnapshot(pending.graph, pending.options);
    manipulationHandler?.(isManipulating());
  }

  function setDragSelection(selection: DragSelection): void {
    dragController.reset();
    dragSelection = selection.kind === 'group' ? { ...selection, nodeIds: [...selection.nodeIds] } : { ...selection };
  }

  function resetLayoutEdits(): void {
    pendingSnapshot = null;
    setMotionEnabled(false);
    transitions.cancel();
    dragController.reset();
    displayPositions.clear();
    dragSelection = { kind: 'node' };
    if (sourceSnapshot && sigmaInstance) applyGraphSnapshot(sourceSnapshot, { preservePositions: false });
    manipulationHandler?.(false);
  }

  // Bind the renderer adapter to a view container.
  function mount(context: RenderContext): void {
    containerElement = context.container;
    sigmaGraph = new Graph();
    sigmaInstance = new Sigma(sigmaGraph, containerElement, buildSigmaSettings(rendererOptions));
    sigmaInstance.getCamera().setState(defaultCameraState());
    bindSigmaHandlers();
  }

  // Render positioned nodes and edges into Graphology then refresh Sigma.
  function render(graph: PositionedGraph): void {
    if (!sigmaGraph || !sigmaInstance) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    transitions.cancel();
    dragController.reset();
    sourceSnapshot = graph;
    maxGlyphSize = 0;
    displayPositions.clear();
    forceMotionController.stop();
    beginGraphUpdate(sigmaGraph, graph);
    updatePiePrograms(graph.nodes);
    applyStableCameraBounds(sigmaInstance, coordinateBounds);

    addPositionedNodes(sigmaGraph, graph.nodes, rendererOptions, pieSliceKeys);
    addPositionedEdges(sigmaGraph, graph, rendererOptions);
    updateClusterTriangleRotations();
    sigmaInstance.refresh();
    displayPositions.ingest(graph);
    forceMotionController.start(sigmaGraph);
    updateEdgeLabelVisibility(readSemanticViewState());
  }

  function beginGraphUpdate(graph: Graph, snapshot: PositionedGraph): boolean {
    const previousBounds = coordinateBounds;
    lastRenderedGraph = snapshot;
    glyphFootprintDirty = true;
    graph.clear();
    coordinateBounds = normalizeGraphBounds(snapshot.viewMeta.globalBounds) ?? deriveGraphBounds(snapshot.nodes);
    return !graphBoundsEqual(previousBounds, coordinateBounds);
  }

  function setViewChangeHandler(handler: ((state: RenderViewportState) => void) | null): void {
    viewChangeHandler = handler;
  }

  function setNodeClickHandler(handler: ((state: RenderNodeClickState) => void) | null): void {
    nodeClickHandler = handler;
  }

  function setNodeDoubleClickHandler(handler: ((state: RenderNodeClickState) => void) | null): void {
    nodeDoubleClickHandler = handler;
  }

  function centerOnNode(nodeId: string): boolean {
    if (
      !centerCameraOnGraphNode({
        graph: sigmaGraph,
        sigma: sigmaInstance,
        nodeId,
        // Swallow only the single programmatic camera move; user panning stays
        // responsive immediately afterward (no time window).
        beforeSetState: () => {
          suppressNextViewChange = true;
        },
      })
    ) {
      return false;
    }

    focusNode(nodeId);
    return true;
  }

  // Move the camera to raw graph coordinates without requiring the node to be
  // in the rendered graph. Used by search focus so a node outside the current
  // LoD slice can be centered; a subsequent viewport re-fetch pulls in its
  // slice, where the node then renders as the selected (red) node.
  function centerOnCoordinates(x: number, y: number): boolean {
    return centerCameraOnCoordinates({
      sigma: sigmaInstance,
      x,
      y,
      beforeSetState: () => {
        suppressNextViewChange = true;
      },
    });
  }

  function focusNode(nodeId: string | null): void {
    selectedNodeId = nodeId;
    applyHighlighting();
    sigmaInstance?.scheduleRender?.();
  }

  function updateDisplayOptions(displayOptions: GraphDisplayOptions): void {
    rendererOptions = {
      ...rendererOptions,
      display: {
        ...rendererOptions.display,
        ...displayOptions,
      },
    };

    if (sigmaInstance) {
      sigmaInstance.setSetting(
        'renderLabels',
        rendererOptions.label?.enabled !== false && rendererOptions.display?.nodeLabels !== false
      );
      updateEdgeLabelVisibility(readSemanticViewState());
    }
  }

  function exportPng(options?: PngExportOptions): Promise<Blob> {
    if (!containerElement) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }
    if (options && sigmaInstance && sigmaGraph && lastRenderedGraph)
      return exportSigmaPublication(sigmaInstance, sigmaGraph, lastRenderedGraph, rendererOptions, options);
    sigmaInstance?.refresh();
    return exportCanvasLayersAsPng(containerElement.querySelectorAll('canvas'));
  }

  // Drop container and graph references when renderer is detached.
  function unmount(): void {
    transitions.cancel();
    forceMotionController.dispose();
    pendingSnapshot = null;
    manipulationHandler = null;
    unbindSigmaHandlers();
    sigmaInstance?.kill();
    sigmaInstance = null;
    sigmaGraph = null;
    containerElement = null;
    pieSliceKeys = [];
    pieProgramSignature = '';
    coordinateBounds = null;
    lastRenderedGraph = null;
    sourceSnapshot = null;
    displayPositions.clear();
    dragSelection = { kind: 'node' };
    selectedNodeId = null;
    glyphFootprintDirty = true;
    selectedClusterStyle = null;
    highlightedNodeIds = null;
    dragController.reset();
    boxSelectController.reset();
  }

  function setRegionSelectModeEnabled(enabled: boolean): void {
    regionSelectModeEnabled = enabled;
  }

  function setRegionSelectedHandler(handler: ((bounds: RenderViewportBounds) => void) | null): void {
    regionSelectedHandler = handler;
  }

  function getViewportState(): RenderViewportRequestState | null {
    if (!sigmaInstance) {
      return null;
    }
    const bounds = currentViewportBounds();
    const halo = displayPositions.queryPadding();
    return {
      bounds: {
        xmin: bounds.xmin - halo.x,
        xmax: bounds.xmax + halo.x,
        ymin: bounds.ymin - halo.y,
        ymax: bounds.ymax + halo.y,
      },
      cameraRatio: currentCameraRatio(),
      selectionBounds: bounds,
      pixelSize: sigmaInstance.getDimensions(),
      representationSpacingPx: projectedRepresentationSpacing(),
    };
  }

  function applyGraphSnapshot(graph: PositionedGraph, options?: { preservePositions?: boolean }): void {
    if (!sigmaGraph || !sigmaInstance) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    if (dragPins.size || selectingRegion) {
      pendingSnapshot = { graph, options: options && { ...options } };
      return;
    }
    const wasTransitioning = transitions.isActive();
    transitions.cancel();
    forceMotionController.stop();
    const previousLod = sourceSnapshot?.viewMeta.lodLevel;
    if (options?.preservePositions) captureDisplayPositions();
    sourceSnapshot = graph;
    const planned = displayPositions.ingest(graph);
    graph = { ...graph, nodes: planned.nodes };
    const lodChanged = previousLod !== undefined && previousLod !== graph.viewMeta.lodLevel;
    const needsTransition = wasTransitioning || lodChanged || planned.origins.size > 0;
    const targets = needsTransition ? new Map(graph.nodes.map(node => [node.id, { x: node.x, y: node.y }])) : null;
    if (lodChanged) transitions.captureAnchor(graph);
    if (needsTransition) {
      const previousPositions = new Map<string, Point>();
      sigmaGraph.forEachNode((id, attributes) => previousPositions.set(id, { x: attributes.x, y: attributes.y }));
      graph = {
        ...graph,
        nodes: graph.nodes.map(node => ({
          ...node,
          ...displayPositions.constrain(
            node.id,
            planned.origins.get(node.id) ?? previousPositions.get(node.id) ?? node
          ),
        })),
      };
    }
    const cameraState = readCameraState(sigmaInstance);
    selectedClusterStyle = null;
    const boundsChanged = beginGraphUpdate(sigmaGraph, graph);
    if (boundsChanged) {
      applyStableCameraBounds(sigmaInstance, coordinateBounds);
    }

    addPositionedNodes(sigmaGraph, graph.nodes);
    addPositionedEdges(sigmaGraph, graph);
    updateClusterTriangleRotations();
    syncPieProgramsFromGraph();
    applyHighlighting();
    captureDisplayPositions();
    sigmaInstance.refresh();
    sigmaInstance.scheduleRender();
    if (cameraState) {
      suppressViewChangesFor(16);
      restoreCameraState(sigmaInstance, cameraState);
    }
    updateEdgeLabelVisibility(readSemanticViewState());
    if (targets) transitions.start(targets);
    else {
      forceMotionController.start(sigmaGraph);
      manipulationHandler?.(false);
    }
  }

  function getInteractiveAggregateTargets(): readonly RenderInteractiveAggregateTarget[] {
    if (!sigmaGraph || !sigmaInstance || !containerElement) return [];

    const rect = containerElement.getBoundingClientRect();
    const targets: RenderInteractiveAggregateTarget[] = [];
    sigmaGraph.forEachNode((nodeId, attributes) => {
      if (!isClusterRepresentative(attributes)) return;

      const point = sigmaInstance?.graphToViewport({ x: Number(attributes.x), y: Number(attributes.y) });
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

      targets.push({
        clusterId: typeof attributes.clusterId === 'string' ? attributes.clusterId : nodeId,
        representedNodeCount: attributes.memberCount as number,
        clientX: rect.left + point.x,
        clientY: rect.top + point.y,
      });
    });
    return targets.sort((left, right) => left.clusterId.localeCompare(right.clusterId));
  }

  function fitGraphSnapshot(graph: PositionedGraph, options: { resetFirst?: boolean } = {}): (() => void) | null {
    if (!sigmaInstance) {
      return null;
    }
    cancelCameraFit();
    cancelFit = fitSigmaToGraphSnapshot(sigmaInstance, graph, options);
    return cancelFit;
  }

  // Dim every node/edge outside `nodeIds` so the selected region stands out.
  // An empty set or null clears the highlight and repaints at full opacity.
  function setHighlightedNodes(nodeIds: ReadonlySet<string> | null): void {
    highlightedNodeIds = nodeIds && nodeIds.size > 0 ? new Set(nodeIds) : null;
    applyHighlighting();
    sigmaInstance?.scheduleRender?.();
  }

  // Install node/edge reducers that grey out anything outside the active
  // highlight set. Reinstalled after every Sigma rebuild via bindSigmaHandlers
  // so the highlight survives piechart-program registration.
  function applyHighlighting(): void {
    syncSelectedClusterStyle();
    applySigmaHighlighting({
      graph: sigmaGraph,
      sigma: sigmaInstance,
      highlightedNodeIds,
      selectedNodeId,
    });
  }

  // Avoid materializing node views when pies are disabled or absent.
  function syncPieProgramsFromGraph(): void {
    if (!sigmaGraph || !sigmaInstance || !containerElement) return;
    const hasPies =
      rendererOptions.piechart?.enabled !== false &&
      sigmaGraph.findNode((_id, attributes) =>
        Object.keys(attributes).some(key => key.startsWith(PIE_ATTRIBUTE_PREFIX))
      ) !== undefined;
    if (!hasPies) {
      if (pieSliceKeys.length) rebuildSigma([]);
      return;
    }
    updatePiePrograms(graphNodeViews(sigmaGraph));
    applyPieChartNodeTypes(sigmaGraph, pieSliceKeys);
  }

  function suppressViewChangesFor(durationMs: number): void {
    suppressViewChangesUntil = Date.now() + durationMs;
  }

  function suppressNodeClicksFor(durationMs: number): void {
    suppressNodeClicksUntil = Date.now() + durationMs;
  }

  function updatePiePrograms(nodes: readonly PieNodeView[]): void {
    if (rendererOptions.piechart?.enabled === false) {
      if (pieSliceKeys.length) rebuildSigma([]);
      return;
    }
    const sliceKeys = detectPieSliceKeys(nodes);
    const signature = buildPieProgramSignature(sliceKeys, nodes);
    if (areStringArraysEqual(pieSliceKeys, sliceKeys) && pieProgramSignature === signature) return;
    try {
      rebuildSigma(sliceKeys, nodes, signature);
    } catch (error) {
      console.warn('Failed to build Sigma piechart program; falling back to default nodes.', {
        sliceCount: sliceKeys.length,
        sliceKeys,
        error,
      });
      rebuildSigma([], [], '');
    }
  }

  function rebuildSigma(
    sliceKeys: string[],
    nodes: readonly PieNodeView[] = [],
    signature = buildPieProgramSignature(sliceKeys, nodes)
  ): void {
    cancelCameraFit();
    const previousCameraState = readCameraState(sigmaInstance);
    const previousSigma = sigmaInstance;
    const sigmaSettings = buildSigmaSettings(
      rendererOptions,
      piechartProgramClasses(sliceKeys, nodes, rendererOptions.piechart ?? {})
    );

    unbindSigmaHandlers();
    previousSigma?.kill();
    sigmaInstance = new Sigma(sigmaGraph as Graph, containerElement as HTMLElement, sigmaSettings);
    pieSliceKeys = sliceKeys;
    pieProgramSignature = signature;
    // Camera coordinates are relative to this frame, not the currently loaded slice.
    applyStableCameraBounds(sigmaInstance, coordinateBounds);
    sigmaInstance.refresh();
    restoreCameraState(sigmaInstance, previousCameraState);
    bindSigmaHandlers();
  }

  function bindSigmaHandlers(): void {
    containerElement?.addEventListener('wheel', trackZoomPointer, { capture: true, passive: true });
    for (const event of ['pointerdown', 'wheel', 'touchstart']) {
      containerElement?.addEventListener(event, cancelCameraFit, { capture: true, passive: true });
    }
    sigmaInstance?.off('resize', handleCameraUpdated);
    sigmaInstance?.on('resize', handleCameraUpdated);
    const sigma = sigmaInstance;
    const camera = sigma?.getCamera();
    camera?.off?.('updated', handleCameraUpdated);
    camera?.on?.('updated', handleCameraUpdated);
    sigma?.off?.('clickNode', emitNodeClick);
    sigma?.on?.('clickNode', emitNodeClick);
    sigma?.off?.('doubleClickNode', emitNodeDoubleClick);
    sigma?.on?.('doubleClickNode', emitNodeDoubleClick);
    sigma?.off?.('clickStage', clearNodeSelection);
    sigma?.on?.('clickStage', clearNodeSelection);
    dragController.bind();
    boxSelectController.bind();
    applyHighlighting();
  }

  function unbindSigmaHandlers(): void {
    containerElement?.removeEventListener('wheel', trackZoomPointer, true);
    cancelCameraFit();
    for (const event of ['pointerdown', 'wheel', 'touchstart']) {
      containerElement?.removeEventListener(event, cancelCameraFit, true);
    }
    boxSelectController.unbind();
    dragController.unbind();
    sigmaInstance?.off?.('clickStage', clearNodeSelection);
    sigmaInstance?.off?.('clickNode', emitNodeClick);
    sigmaInstance?.off?.('doubleClickNode', emitNodeDoubleClick);
    sigmaInstance?.off('resize', handleCameraUpdated);
    sigmaInstance?.getCamera()?.off?.('updated', handleCameraUpdated);
  }

  function handleCameraUpdated(): void {
    forceMotionController.refreshGeometry();
    const viewState = readSemanticViewState();
    updateEdgeLabelVisibility(viewState);
    emitViewChange(viewState);
  }

  function readSemanticViewState(): SigmaSemanticViewState | null {
    if (!sigmaInstance || !coordinateBounds) {
      return null;
    }

    const camera = sigmaInstance.getCamera();
    return sigmaCameraToSemanticViewState(coordinateBounds, camera.getState?.() ?? camera);
  }

  function projectedRepresentationSpacing(): number {
    const sigma = sigmaInstance;
    if (!sigma?.scaleSize || !sigmaGraph?.order) return 0;
    // Snapshot/style changes scan once; camera events only apply the scalar
    // zoom transform, so panning does not scan the loaded graph each frame.
    if (glyphFootprintDirty) {
      // Keep a per-render high-water footprint: switching to a tier with small
      // glyphs must not immediately loosen the budget and oscillate back.
      sigmaGraph.forEachNode((id, attributes) => {
        const baseSize = selectedClusterStyle?.id === id ? selectedClusterStyle.size : attributes.size;
        const size = typeof baseSize === 'number' ? baseSize : 5;
        const shapeScale =
          attributes.type === SIGMA_NODE_TYPE_TRIANGLE || attributes.isClusterProxy === true ? 1.35 : 1;
        maxGlyphSize = Math.max(maxGlyphSize, size * shapeScale);
      });
      glyphFootprintDirty = false;
    }
    return maxGlyphSize > 0 ? 2 * sigma.scaleSize(maxGlyphSize) + 2 : 0;
  }

  function currentViewportBounds(): RenderViewportBounds {
    const sigma = sigmaInstance;
    if (!sigma) {
      return { xmin: 0, xmax: 0, ymin: 0, ymax: 0 };
    }
    const dimensions = sigma.getDimensions?.() ?? sigma.getContainer?.().getBoundingClientRect();
    const width = dimensions?.width ?? 1;
    const height = dimensions?.height ?? 1;
    const corners = [
      sigma.viewportToGraph({ x: 0, y: 0 }),
      sigma.viewportToGraph({ x: width, y: 0 }),
      sigma.viewportToGraph({ x: 0, y: height }),
      sigma.viewportToGraph({ x: width, y: height }),
    ];
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    return {
      xmin: Math.min(...xs),
      xmax: Math.max(...xs),
      ymin: Math.min(...ys),
      ymax: Math.max(...ys),
    };
  }

  function currentCameraRatio(): number {
    const camera = sigmaInstance?.getCamera();
    const state = camera?.getState?.() ?? camera;
    return typeof state?.ratio === 'number' && Number.isFinite(state.ratio) ? state.ratio : 1;
  }

  function emitViewChange(viewState: SigmaSemanticViewState | null): void {
    if (transitions.isActive()) return;
    if (suppressNextViewChange) {
      suppressNextViewChange = false;
      return;
    }
    if (Date.now() < suppressViewChangesUntil) {
      return;
    }

    if (!viewChangeHandler || !containerElement || !viewState) {
      return;
    }

    viewChangeHandler({
      viewport: viewState.viewport,
      zoom: viewState.lodZoom,
    });
  }

  function updateEdgeLabelVisibility(viewState: SigmaSemanticViewState | null): void {
    if (!sigmaInstance || !viewState) {
      return;
    }

    const shouldRender =
      rendererOptions.display?.edgeDistanceLabels === true &&
      (rendererOptions.display.edgeDistanceLabelPolicy === 'always' || viewState.edgeDistanceLabelsVisible);

    if (sigmaInstance.getSetting('renderEdgeLabels') !== shouldRender) {
      sigmaInstance.setSetting('renderEdgeLabels', shouldRender);
      sigmaInstance.scheduleRender();
    }
  }

  function emitNodeClick(payload: NodeClickPayload): void {
    if (Date.now() < suppressNodeClicksUntil) {
      return;
    }

    if (!nodeClickHandler || !sigmaGraph) {
      return;
    }

    const nodeId = clickedNodeId(payload);
    if (!nodeId || !sigmaGraph.hasNode(nodeId)) {
      return;
    }

    focusNode(nodeId);
    nodeClickHandler({
      nodeId,
      attributes: Object.freeze({ ...sigmaGraph.getNodeAttributes(nodeId) }),
    });
  }

  function emitNodeDoubleClick(payload: NodeClickPayload): void {
    if (Date.now() < suppressNodeClicksUntil || !nodeDoubleClickHandler || !sigmaGraph) {
      return;
    }

    const nodeId = clickedNodeId(payload);
    if (!nodeId || !sigmaGraph.hasNode(nodeId)) {
      return;
    }

    nodeDoubleClickHandler({
      nodeId,
      attributes: Object.freeze({ ...sigmaGraph.getNodeAttributes(nodeId) }),
    });
  }

  function clearNodeSelection(): void {
    if (Date.now() < suppressNodeClicksUntil) {
      return;
    }

    focusNode(null);
    nodeClickHandler?.({ nodeId: null });
  }

  function syncSelectedClusterStyle(): void {
    if (!sigmaGraph) return;

    if (selectedClusterStyle && selectedClusterStyle.id !== selectedNodeId) {
      if (sigmaGraph.hasNode(selectedClusterStyle.id)) {
        sigmaGraph.mergeNodeAttributes(selectedClusterStyle.id, {
          color: selectedClusterStyle.color,
          size: selectedClusterStyle.size,
        });
      }
      glyphFootprintDirty = true;
      selectedClusterStyle = null;
    }

    if (!selectedNodeId || selectedClusterStyle || !sigmaGraph.hasNode(selectedNodeId)) return;

    const attributes = sigmaGraph.getNodeAttributes(selectedNodeId) as Record<string, unknown>;
    if (attributes.type !== SIGMA_NODE_TYPE_TRIANGLE && attributes.isClusterProxy !== true) return;

    const size = typeof attributes.size === 'number' ? attributes.size : 5;
    glyphFootprintDirty = true;
    selectedClusterStyle = {
      id: selectedNodeId,
      color: attributes.color,
      size: attributes.size,
    };
    sigmaGraph.mergeNodeAttributes(selectedNodeId, {
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
      size: Math.max(size * 1.35, size + 2),
    });
  }

  function updateClusterTriangleRotations(): void {
    if (!sigmaGraph || !lastRenderedGraph) {
      return;
    }

    applyClusterTriangleRotations(sigmaGraph, lastRenderedGraph.edges);
    sigmaInstance?.scheduleRender();
  }
}

function clickedNodeId(payload: NodeClickPayload): string | undefined {
  if (typeof payload.node === 'string') return payload.node;
  const event = payload.event;
  return event && typeof event === 'object' && 'node' in event && typeof event.node === 'string'
    ? event.node
    : undefined;
}

function graphNodeViews(graph: Graph): PieNodeView[] {
  return graph.mapNodes((_nodeId, attributes) => ({
    attributes: attributes as Record<string, unknown>,
  }));
}

function graphBoundsEqual(left: GraphLayoutBounds | null, right: GraphLayoutBounds | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.minX === right.minX && left.maxX === right.maxX && left.minY === right.minY && left.maxY === right.maxY;
}
