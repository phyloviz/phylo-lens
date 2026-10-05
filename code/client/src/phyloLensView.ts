import { toNodeId, toClusterId } from './contracts/graph/graphIdentifiers';
import type { ClusterId, NodeId } from './contracts/graph/graphIdentifiers';
import type { DragSelection, PngExportOptions } from './render/renderer.types';
import type { ExpansionState, ExpansionResult } from './contracts/expansion';
import type { AncillaryTableInput } from './contracts/ancillary';
import type { AncillaryInputOptions } from './ancillary/ancillaryInput';
import { createGraphClient } from './services/graph/graphService';
import type { SfdpOptions } from './contracts/graph/SfdpOptions';
import { SOURCE_FORMAT_NEWICK, type SourceFormat } from './contracts/models';

import rendererFactory from './render/rendererFactory';
import { RENDERER_KIND_SIGMA } from './render/renderer.types';
import type { VisualMappingOptions } from './render/mapping/visualMapping';
import { createGraphWorkbench, type GraphWorkbench } from './app/workbench/graphWorkbench';
import type { GraphWorkbenchOptions } from './app/workbench/graphWorkbench.types';
import { GRAPH_WORKBENCH_ERRORS } from './app/workbench/graphWorkbench.errors';
import { snapshotAppliedObserverForContainer } from './app/workbench/internalSnapshotObserver';

export const ERR_PHYLO_LENS_VIEW_DISPOSED = 'PhyloLens view has been disposed.';

export interface PhyloLensViewOptions {
    container: HTMLElement;
    apiUrl: string;
    onError?: (error: Error) => void;
    onNodeSelected?: (selection: { nodeId: NodeId | null; clusterId: ClusterId | null; expandable: boolean }) => void;
    onInteractionFeedback?: (message: string) => void;
    onExpansionChanged?: (state: ExpansionState) => void;
}

export interface PhyloLensLoadOptions extends AncillaryInputOptions {
    content: string;
    name?: string;
    sourceFormat?: SourceFormat;
    visualMapping?: VisualMappingOptions;
    sfdpOptions?: SfdpOptions;
    lod?: {
        maxNodes?: number;
        representationSpacingPx?: number;
        smallTreeThreshold?: number;
    };
}

export interface PhyloLensAncillaryResult {
    readonly matchedNodeCount: number;
    readonly warnings: readonly string[];
}

export interface PhyloLensView {
    searchNodes: GraphWorkbench['searchNodes'];
    focusNode: GraphWorkbench['focusNode'];
    cancelPendingFocus: () => void;
    expandCluster: (clusterId: ClusterId) => Promise<ExpansionResult>;
    collapseCluster: (clusterId: ClusterId) => ExpansionState;
    expandAll: () => Promise<ExpansionResult>;
    collapseAll: () => Promise<ExpansionResult>;
    setKeepExpanded: (keep: boolean) => ExpansionState;
    getExpansionState: () => ExpansionState;

    load: (options: PhyloLensLoadOptions) => Promise<void>;
    /** Replace the visual mapping of a loaded tree and schedule a viewport refresh. */
    updateVisualMapping: (mapping: VisualMappingOptions) => void;
    applyAncillaryData: (data: AncillaryTableInput) => Promise<PhyloLensAncillaryResult>;
    setMotionEnabled: (enabled: boolean) => void;
    isMotionEnabled: () => boolean;
    setDragSelection: (selection: DragSelection) => void;
    resetLayoutEdits: () => void;
    exportPng: (options?: PngExportOptions) => Promise<Blob>;
    dispose: () => void;
}

export function createPhyloLensView(options: PhyloLensViewOptions): PhyloLensView {
    const workbench = createWorkbench(options);
    let disposed = false;
    workbench.setErrorHandler(options.onError ?? null);
    workbench.setInteractionFeedbackHandler(options.onInteractionFeedback ?? null);
    workbench.setNodeClickedHandler(state =>
        options.onNodeSelected?.({
            nodeId: state.nodeId === null ? null : toNodeId(state.nodeId),
            clusterId: typeof state.attributes?.clusterId === 'string' ? toClusterId(state.attributes.clusterId) : null,
            expandable: state.attributes?.isClusterProxy === true,
        })
    );
    workbench.setGraphRenderedHandler(() => options.onExpansionChanged?.(workbench.getExpansionState()));

    const activeWorkbench = () => {
        if (disposed) throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
        return workbench;
    };

    return {
        setMotionEnabled: enabled => activeWorkbench().setMotionEnabled(enabled),
        isMotionEnabled: () => activeWorkbench().isMotionEnabled(),
        setDragSelection: selection => activeWorkbench().setDragSelection(selection),
        resetLayoutEdits: () => activeWorkbench().resetLayoutEdits(),
        searchNodes: query => activeWorkbench().searchNodes(query),
        focusNode: (id, coordinates) => activeWorkbench().focusNode(id, coordinates),
        cancelPendingFocus: () => activeWorkbench().cancelPendingFocus(),
        expandCluster: async id => activeWorkbench().expandCluster(id),
        collapseCluster: id => activeWorkbench().collapseCluster(id),
        expandAll: async () => activeWorkbench().expandAll(),
        collapseAll: async () => activeWorkbench().collapseAll(),
        setKeepExpanded: keep => activeWorkbench().setKeepExpanded(keep),
        getExpansionState: () => activeWorkbench().getExpansionState(),
        load: async ({ content, name, sourceFormat = SOURCE_FORMAT_NEWICK, ...loadOptions }) => {
            if (disposed) {
                throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
            }

            try {
                await workbench.loadGraph(
                    {
                        content,
                        format: sourceFormat,
                        datasetName: name,
                    },
                    loadOptions
                );
            } catch (error) {
                if (disposed && error instanceof Error && error.message === GRAPH_WORKBENCH_ERRORS.loadSuperseded) {
                    throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
                }
                throw error;
            }
        },
        applyAncillaryData: async data => {
            if (disposed) throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
            try {
                const result = await workbench.applyAncillaryData(data);
                return { matchedNodeCount: result.matchedNodeCount, warnings: result.warnings };
            } catch (error) {
                if (disposed) throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
                throw error;
            }
        },
        updateVisualMapping: mapping => {
            if (disposed) {
                throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
            }
            workbench.updateVisualMapping(mapping);
        },
        exportPng: exportOptions => {
            if (disposed) {
                throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
            }
            return workbench.exportPng(exportOptions);
        },
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            workbench.dispose();
        },
    };
}

function createWorkbench({ container, apiUrl }: PhyloLensViewOptions): GraphWorkbench {
    const options: GraphWorkbenchOptions = {
        graphClient: createGraphClient({ baseUrl: apiUrl }),
        rendererFactory: rendererFactory(),
        rendererKind: RENDERER_KIND_SIGMA,
        renderContext: { container },
    };
    const snapshotObserver = snapshotAppliedObserverForContainer(container);
    return snapshotObserver ? createGraphWorkbench(options, snapshotObserver) : createGraphWorkbench(options);
}
