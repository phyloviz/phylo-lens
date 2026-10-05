import { copyVisualMapping } from '../../render/mapping/visualMapping';
import { toError } from '../errors';
import { getGraphSession, getGraphSnapshot } from './graphWorkbench.state';
import { resolveAncillaryInput } from '../../ancillary/ancillaryInput';
import type { GraphPrepareRequest } from '../../contracts/graph/prepare/GraphPrepareRequest';
import type { GraphClient } from '../../contracts/graph/GraphClient';
import type { GraphPrepareResult } from '../../contracts/graph/prepare/GraphPrepareResult';
import type { PositionedGraph } from '../../contracts/positioned';
import type { GraphRenderer } from '../../render/renderer.types';
import type { GraphWorkbenchAction } from './graphWorkbench.actions';
import { GRAPH_WORKBENCH_ERRORS } from './graphWorkbench.errors';
import type { GraphInput, GraphSession, LoadGraphOptions } from './graphWorkbench.types';
import type { GraphWorkbenchState } from './graphWorkbench.state';
import type { SnapshotAppliedObserver } from './internalSnapshotObserver';
import { GraphViewportCoordinator } from './viewport/viewportCoordinator';
import { GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD } from './viewport/viewportRequest';

export interface LoadGraphDependencies {
    readonly getState: () => GraphWorkbenchState;
    readonly dispatch: (action: GraphWorkbenchAction) => void;

    readonly renderer: GraphRenderer;
    readonly graphClient: GraphClient;

    readonly replaceViewportCoordinator: (coordinator: GraphViewportCoordinator | null) => void;

    readonly isCurrentLoad: () => boolean;

    readonly snapshotObserver?: SnapshotAppliedObserver;
    readonly nextSnapshotSequence: () => number;

    readonly onError?: (error: Error) => void;
    readonly onGraphRendered?: (graph: PositionedGraph) => void;
}

export async function loadGraph(
    dependencies: LoadGraphDependencies,
    input: GraphInput,
    options: LoadGraphOptions = {}
): Promise<PositionedGraph> {
    const {
        getState,
        dispatch,
        renderer,
        graphClient,
        replaceViewportCoordinator,
        isCurrentLoad,
        snapshotObserver,
        nextSnapshotSequence,
        onGraphRendered,
        onError,
    } = dependencies;

    replaceViewportCoordinator(null);

    dispatch({
        kind: 'loadStarted',
    });

    try {
        resetRenderer(renderer);

        const ancillary = resolveAncillaryInput(options);

        const request: GraphPrepareRequest = {
            format: input.format,
            datasetName: input.datasetName,
            content: input.content,
            ancillarySchema: ancillary.ancillarySchema,
            ancillaryByNodeId: ancillary.ancillaryByNodeId,
            ancillaryData: options.ancillaryData,
            sfdpOptions: options.sfdpOptions,
        };

        requireViewportRenderer(renderer);

        const preparedGraph = await graphClient.prepareGraph(request);

        assertCurrentLoad(isCurrentLoad);

        const session = createGraphSession(preparedGraph, options);

        dispatch({
            kind: 'graphPrepared',
            session,
        });

        const coordinator = new GraphViewportCoordinator({
            client: graphClient,
            datasetId: session.datasetId,
            layoutVersion: session.layoutVersion,
            renderer,

            maxNodes: session.lod.maxNodes,
            representationSpacingPx: session.lod.representationSpacingPx,
            smallTreeThreshold: session.lod.smallTreeThreshold,

            lodTierCount: preparedGraph.lodTierCount,
            nodeCount: preparedGraph.nodeCount,

            getPaused: () => getState().lodRefreshPaused,
            onError: error => {
                if (isCurrentLoad()) onError?.(error);
            },

            onGraphApplied: (graph, response) => {
                if (!isCurrentLoad()) return;
                dispatch({
                    kind: 'viewportApplied',
                    graph,
                    layoutVersion: response?.layoutVersion,
                });

                const graphSnapshot = getGraphSnapshot(getState());

                if (graphSnapshot) {
                    onGraphRendered?.(graphSnapshot);
                }
            },

            snapshotObserver,
            nextSnapshotSequence,

            getRenderSettings: () => {
                const state = getState();

                return {
                    visualMapping: getGraphSession(state).visualMapping,
                    filterState: state.activeFilters,
                    displayOptions: session.displayOptions,
                };
            },
        });

        replaceViewportCoordinator(coordinator);
        coordinator.mount();

        const graph = await coordinator.waitForInitialViewport();

        assertCurrentLoad(isCurrentLoad);

        return graph;
    } catch (error) {
        const failure = toError(error);
        assertCurrentLoad(isCurrentLoad);

        replaceViewportCoordinator(null);

        dispatch({
            kind: 'loadFailed',
            error: failure,
        });

        throw failure;
    }
}

// Helpers

function assertCurrentLoad(isCurrentLoad: () => boolean): void {
    if (!isCurrentLoad()) {
        throw new Error(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
    }
}

function requireViewportRenderer(renderer: GraphRenderer): void {
    if (!renderer.getViewportState || !renderer.applyGraphSnapshot) {
        throw new Error(GRAPH_WORKBENCH_ERRORS.viewportRequired);
    }
}

function resetRenderer(renderer: GraphRenderer): void {
    const motionEnabled = renderer.isMotionEnabled?.() ?? true;

    renderer.resetLayoutEdits?.();
    renderer.setMotionEnabled?.(motionEnabled);
    renderer.focusNode?.(null);
}

function createGraphSession(preparedGraph: GraphPrepareResult, options: LoadGraphOptions): GraphSession {
    return {
        datasetId: preparedGraph.datasetId,
        layoutVersion: preparedGraph.layoutVersion,

        visualMapping: options.visualMapping && copyVisualMapping(options.visualMapping),
        displayOptions: options.displayOptions && { ...options.displayOptions },

        layoutWarnings: [...preparedGraph.warnings],
        lodTierCount: preparedGraph.lodTierCount,

        lod: {
            maxNodes: options.lod?.maxNodes,
            representationSpacingPx: options.lod?.representationSpacingPx,
            smallTreeThreshold: options.lod?.smallTreeThreshold ?? GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
        },
    };
}
