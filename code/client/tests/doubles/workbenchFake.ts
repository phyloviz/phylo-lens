import { vi } from 'vitest';
import type { GraphWorkbench } from '../../src/app/workbench/graphWorkbench';
import type { PositionedGraph } from '../../src/contracts/positioned';
import { toDatasetId, toNodeId, toClusterId } from '../../src/contracts/graph/graphIdentifiers';
import { decodeApiMetadata } from '../../src/ancillary/apiMetadata';
export function workbenchFake(
  renderedGraph: PositionedGraph = {
    nodes: [],
    edges: [],
    viewMeta: { layout: 'force', lodLevel: 0 },
  }
) {
  let graphRenderedHandler: ((graph: PositionedGraph) => void) | null = null;
  let nodeClickedHandler: ((state: { nodeId: string | null }) => void) | null = null;
  let regionSelectedHandler: ((bounds: { xmin: number; xmax: number; ymin: number; ymax: number }) => void) | null =
    null;
  let lodRefreshPaused = false;
  let regionSelectModeEnabled = false;

  return {
    setDistanceConnections: vi.fn(async () => renderedGraph),
    listComponents: vi.fn(async () => ({ components: [], nextCursor: null })),
    selectComponent: vi.fn(async () => renderedGraph),
    getComponentId: vi.fn(() => undefined),
    relaxLayout: vi.fn(),
    stopLayout: vi.fn(),
    getLayoutMotionState: vi.fn(() => ({ automatic: false, running: false })),
    setLayoutMotionHandler: vi.fn(),
    setErrorHandler: vi.fn(),
    applyAncillaryFilters: vi.fn(() => renderedGraph),
    clearAncillaryFilters: vi.fn(() => renderedGraph),
    setMotionEnabled: vi.fn(),
    isMotionEnabled: vi.fn(() => true),
    setInteractionFeedbackHandler: vi.fn(),
    setDragSelection: vi.fn(),
    resetLayoutEdits: vi.fn(),
    exportPng: vi.fn(),
    expandCluster: vi.fn(),
    collapseCluster: vi.fn(),
    collapseBranch: vi.fn(),
    expandBranch: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    setKeepExpanded: vi.fn(),
    getExpansionState: vi.fn(() => ({
      keepExpanded: false,
      expandedClusterIds: [],
      allExpanded: false,
      partial: false,
      renderedNodeCount: renderedGraph.nodes.length,
    })),
    applyAncillaryData: vi.fn(),
    loadGraph: vi.fn(async () => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    updateVisualMapping: vi.fn(() => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    updateDisplayOptions: vi.fn(),
    setLodRefreshPaused: vi.fn((paused: boolean) => {
      lodRefreshPaused = paused;
      return renderedGraph;
    }),
    isLodRefreshPaused: vi.fn(() => lodRefreshPaused),
    searchNodes: vi.fn(async () => ({
      datasetId: toDatasetId('fixture-tree'),
      query: 'port',
      matches: [
        {
          nodeId: toNodeId('a'),
          score: 8,
          matchedText: 'a Portugal',
          annotations: decodeApiMetadata({ country: 'Portugal' }),
          clusterId: toClusterId('cluster-a'),
          x: 12,
          y: 34,
        },
      ],
      totalCount: 1,
    })),
    cancelPendingFocus: vi.fn(),
    focusNode: vi.fn(async () => {
      graphRenderedHandler?.(renderedGraph);
      return renderedGraph;
    }),
    setGraphRenderedHandler: vi.fn(handler => {
      graphRenderedHandler = handler;
    }),
    setNodeClickedHandler: vi.fn(handler => {
      nodeClickedHandler = handler;
    }),
    setRegionSelectModeEnabled: vi.fn((enabled: boolean) => {
      regionSelectModeEnabled = enabled;
    }),
    isRegionSelectModeEnabled: () => regionSelectModeEnabled,
    selectRegion: vi.fn(async () => ({
      nodeIds: [toNodeId('a'), toNodeId('b')],
      nodeCount: 2,
      truncated: false,
      aggregatedAncillaryData: { country: 'Portugal', score: 4 },
      ancillarySchema: [],
    })),
    setRegionSelectedHandler: vi.fn(handler => {
      regionSelectedHandler = handler;
    }),
    clearRegionSelection: vi.fn(),
    emitNodeClick: (nodeId: string) => {
      nodeClickedHandler?.({ nodeId });
    },
    emitRegionSelected: (bounds: { xmin: number; xmax: number; ymin: number; ymax: number }) => {
      regionSelectedHandler?.(bounds);
    },
    dispose: vi.fn(),
  } satisfies GraphWorkbench & {
    isRegionSelectModeEnabled: () => boolean;
    emitNodeClick: (nodeId: string) => void;
    emitRegionSelected: (bounds: { xmin: number; xmax: number; ymin: number; ymax: number }) => void;
  };
}
