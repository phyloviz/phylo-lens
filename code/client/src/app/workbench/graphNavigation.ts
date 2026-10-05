import { toNodeId } from '../../contracts/graph/graphIdentifiers';
import type { ClusterId, NodeId } from '../../contracts/graph/graphIdentifiers';
import type { GraphSearchResult } from '../../contracts/graph/search/GraphSearchResult';

import type { PositionedGraph } from '../../contracts/positioned';
import type { GraphRenderer, RenderViewportBounds } from '../../render/renderer.types';
import { getGraphSession, getGraphSnapshot, hasGraphSession } from './graphWorkbench.state';
import type { RegionSelectionResult } from './graphWorkbench.types';
import type { GraphWorkbenchState } from './graphWorkbench.state';
import { GRAPH_WORKBENCH_ERRORS } from './graphWorkbench.errors';
import { createEmptyGraph } from './viewportGraph';
import type { GraphViewportCoordinator } from './viewport/viewportCoordinator';
import type { GraphClient } from '../../contracts/graph/GraphClient';

const DEFAULT_SEARCH_RESULT_LIMIT = 50;

interface WorkbenchNavigationOptions {
    getState: () => GraphWorkbenchState;
    renderer: GraphRenderer;
    graphClient: GraphClient;
    getViewportCoordinator: () => GraphViewportCoordinator | null;
    getLoadGeneration: () => number;
}

export default function createGraphNavigation({
    getState,
    renderer,
    graphClient,
    getViewportCoordinator,
    getLoadGeneration,
}: WorkbenchNavigationOptions) {
    let focusSequence = 0;
    let regionSequence = 0;
    let searchSequence = 0;
    const cancelPendingFocus = () => {
        focusSequence += 1;
        getViewportCoordinator()?.cancelPendingFocus();
    };

    return {
        cancelPendingFocus,
        cancelPendingRegionSelection: () => {
            regionSequence += 1;
        },
        selectRegion: selectRegion,
        searchNodes: searchNodes,
        focusNode: focusNode,
    };

    async function selectRegion(bounds: RenderViewportBounds): Promise<RegionSelectionResult> {
        const session = getGraphSession(getState());
        const generation = getLoadGeneration();
        const sequence = ++regionSequence;
        const coordinator = getViewportCoordinator();

        // The server cannot select a rectangle in a deformed layout. Select the loaded
        // display explicitly; its ancillary wheel is built from these same node IDs.
        const displayed = renderer.getDisplayedNodesInBounds?.(bounds);
        if (displayed) {
            const nodeIds = [...displayed].map(toNodeId);
            renderer.setHighlightedNodes?.(new Set(nodeIds));
            return {
                nodeIds,
                nodeCount: nodeIds.length,
                truncated: false,
                aggregatedAncillaryData: {},
                scope: 'display',
            };
        }
        const response = await graphClient.readRegion({
            datasetId: session.datasetId,
            layoutVersion: session.layoutVersion,
            xmin: bounds.xmin,
            xmax: bounds.xmax,
            ymin: bounds.ymin,
            ymax: bounds.ymax,
        });

        const currentState = getState();
        if (
            sequence !== regionSequence ||
            generation !== getLoadGeneration() ||
            coordinator !== getViewportCoordinator() ||
            !hasGraphSession(currentState) ||
            session.layoutVersion !== currentState.session.layoutVersion
        ) {
            throw new Error(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
        }
        const nodeIds = response.nodes.map(node => node.id);
        renderer.setHighlightedNodes?.(new Set(nodeIds));

        return {
            nodeIds,
            nodeCount: response.totalNodeCount,
            truncated: response.truncated,
            aggregatedAncillaryData: response.aggregatedAncillaryData,
        };
    }

    async function searchNodes(query: { query: string; limit?: number }): Promise<GraphSearchResult> {
        const session = getGraphSession(getState());
        cancelPendingFocus();
        const generation = getLoadGeneration();
        const sequence = ++searchSequence;
        const coordinator = getViewportCoordinator();

        const response = await graphClient.searchGraph({
            datasetId: session.datasetId,
            layoutVersion: session.layoutVersion,
            query: query.query,
            limit: query.limit,
        });

        const currentState = getState();
        if (
            sequence !== searchSequence ||
            generation !== getLoadGeneration() ||
            coordinator !== getViewportCoordinator() ||
            !hasGraphSession(currentState) ||
            session.layoutVersion !== currentState.session.layoutVersion
        ) {
            throw new Error(GRAPH_WORKBENCH_ERRORS.loadSuperseded);
        }
        return response;
    }

    async function focusNode(
        nodeId: NodeId,
        coordinates?: { readonly x: number | null; readonly y: number | null; readonly clusterId?: ClusterId | null }
    ): Promise<PositionedGraph> {
        const session = getGraphSession(getState());
        const generation = getLoadGeneration();

        cancelPendingFocus();

        const sequence = focusSequence;
        const coordinator = getViewportCoordinator();

        const isCurrent = () =>
            sequence === focusSequence &&
            generation === getLoadGeneration() &&
            getViewportCoordinator() === coordinator;
        const currentSnapshot = () => getGraphSnapshot(getState()) ?? createEmptyGraph();

        // A repeated selection must recenter too: the user may have panned away.
        const visible = getGraphSnapshot(getState())?.nodes.some(
            node => node.id === nodeId && node.attributes?.isClusterProxy !== true
        );

        if (!visible || !renderer.centerOnNode?.(nodeId)) {
            let location = coordinates && { ...coordinates };

            if (!location?.clusterId) {
                const response = await graphClient.searchGraph({
                    datasetId: session.datasetId,
                    layoutVersion: session.layoutVersion,
                    query: nodeId,
                    limit: DEFAULT_SEARCH_RESULT_LIMIT,
                });
                if (!isCurrent()) return currentSnapshot();
                const match = response.matches.find(item => item.nodeId === nodeId);
                if (!match) throw new Error(`Node ${nodeId} was not found.`);
                location = { x: match.x ?? null, y: match.y ?? null, clusterId: match.clusterId };
            }

            if (!location.clusterId || !coordinator) {
                throw new Error(`Node ${nodeId} has no available layout location.`);
            }

            const result = await coordinator.expandCluster(location.clusterId, { focusNodeId: nodeId });

            if (!isCurrent() || result.status === 'superseded') {
                return currentSnapshot();
            }

            if (!renderer.centerOnNode?.(nodeId) && location.x != null && location.y != null) {
                renderer.centerOnCoordinates?.(location.x, location.y);
            }
        }

        if (isCurrent()) {
            renderer.focusNode?.(nodeId);
        }

        return currentSnapshot();
    }
}
