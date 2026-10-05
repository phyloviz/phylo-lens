import type { GraphDisplayOptions } from '../render/renderer.types';
import { toError } from './errors';
import { expansionControls, type ExpansionControlsElements } from './shell/controls/expansionControls';
import type { GraphWorkbench } from './workbench/graphWorkbench';
import type { PositionedGraph } from '../contracts/positioned';
import { SOURCE_FORMAT_NEWICK, SOURCE_FORMAT_TYPING_DATA, type SourceFormat } from '../contracts/models';

import { buildRenderedStatus } from './shell/status/renderedStatus';
import { parseAncillaryPayload } from './shell/inputs/ancillaryPayload';
import {
    ANCILLARY_MODE_GLOBAL,
    ANCILLARY_MODE_CURRENT,
    ANCILLARY_MODE_SELECTED,
    type AncillaryMode,
    getAncillaryMode,
    updateNodeSelectionVisibility as updateNodeSelectionVisibilityControl,
    updateNodeSelector,
} from './shell/ancillary/nodeSelector';
import ancillaryWheels from './shell/ancillary/ancillaryWheels';
import {
    DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
    DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
    DISPLAY_OPTION_NODE_LABELS,
    buildDisplayOptions,
    toggleClickedOption,
} from './shell/controls/displayOptionsControls';
import {
    isLodGraph,
    parseMaxNodes,
    updateLodPlaybackControls as updateLodPlaybackControlsView,
} from './shell/controls/lodControls';
import ancillaryFieldControls from './shell/controls/ancillaryFieldControls';
import { getSelectedOptions } from './shell/controls/selectOptions';
import { downloadBlob } from './shell/inputs/fileInputs';
import { graphInputReader } from './shell/inputs/graphInput';
import { ancillaryJoinColumnPicker } from './shell/inputs/ancillaryJoinColumn';
import eventBindings from './shell/events/eventBindings';
import searchController from './shell/search/searchController';
import regionSelection from './shell/region/regionSelection';
import visualMappingPalette from './shell/palette/visualMappingPalette';

// Re-export constants for external use.
export { STATUS_RENDERED_PREFIX } from './shell/status/renderedStatus';
export { ERR_INVALID_ANCILLARY_JSON } from './shell/inputs/ancillaryPayload';
export { CATEGORY_COLOR_INPUT_SELECTOR } from './shell/palette/categoryColorControls';

// Status and user feedback messages for the shell UI.
export const DEFAULT_STATUS_READY = 'Ready';
export const STATUS_RENDERING_PREFIX = 'Rendering';
export const STATUS_FAILED_PREFIX = 'Failed';
export const CATEGORY_COLOR_SAVE_FILENAME = 'phyloviz-category-colors.txt';
export const SELECTED_NODE_WHEEL_EMPTY_MESSAGE = 'Click a node to view its ancillary distribution.';
export const SELECT_PIE_FIELD_MESSAGE = 'Select an ancillary field to view its distribution.';

// Re-export ancillary mode constants for external use.
export {
    ANCILLARY_MODE_GLOBAL,
    ANCILLARY_MODE_CURRENT,
    ANCILLARY_MODE_SELECTED,
    DISPLAY_OPTION_DISTANCE_WEIGHTED_EDGES,
    DISPLAY_OPTION_EDGE_DISTANCE_LABELS,
    DISPLAY_OPTION_NODE_LABELS,
};
export type { AncillaryMode };

// Error messages for required shell elements.
export const ERR_STATUS_ELEMENT_REQUIRED = 'Status element is required.';
export const ERR_RENDER_FORM_REQUIRED = 'Render form is required.';
export const ERR_NEWICK_INPUT_REQUIRED = 'Newick input is required.';
export { ERR_ANCILLARY_JOIN_COLUMN_REQUIRED } from './shell/inputs/graphInput';

export interface UiShellElements {
    form: HTMLFormElement;
    newickInput: HTMLTextAreaElement;
    newickFileInput?: HTMLInputElement;
    newickSourceControls?: HTMLElement;
    sourceFormatSelect?: HTMLSelectElement;
    typingFileInput?: HTMLInputElement;
    typingSourceControls?: HTMLElement;
    datasetNameInput?: HTMLInputElement;
    ancillaryInput?: HTMLTextAreaElement;
    ancillaryFileInput?: HTMLInputElement;
    applyAncillaryButton?: HTMLButtonElement;
    ancillaryJoinColumnInput?: HTMLInputElement | HTMLSelectElement;
    ancillaryFormatSelect?: HTMLSelectElement;
    status: HTMLElement;
    ancillaryWheelContainer?: HTMLElement;
    ancillarySelectedNodeWheelContainer?: HTMLElement;
    ancillaryModeSelect?: HTMLSelectElement;
    ancillaryNodeSelect?: HTMLSelectElement;
    ancillaryFieldSelect?: HTMLSelectElement;
    showNodePiesInput?: HTMLInputElement;
    ancillarySizeFieldInput?: HTMLInputElement;
    ancillarySizeScaleSelect?: HTMLSelectElement;
    paletteControlsContainer?: HTMLElement;
    paletteLoadButton?: HTMLButtonElement;
    paletteLoadInput?: HTMLInputElement;
    paletteSaveButton?: HTMLButtonElement;
    displayOptionsSelect?: HTMLSelectElement;
    motionInput?: HTMLInputElement;
    branchRootButton?: HTMLButtonElement;
    singleDragButton?: HTMLButtonElement;
    resetLayoutButton?: HTMLButtonElement;
    dragStatus?: HTMLElement;
    edgeLabelPolicySelect?: HTMLSelectElement;
    exportScaleInput?: HTMLSelectElement;
    exportLabelSizeInput?: HTMLInputElement;
    exportButton?: HTMLButtonElement;
    expansion?: ExpansionControlsElements;
    lodPlayButton?: HTMLButtonElement;
    lodPauseButton?: HTMLButtonElement;
    maxNodesInput?: HTMLInputElement;
    searchInput?: HTMLInputElement;
    searchButton?: HTMLButtonElement;
    searchResults?: HTMLElement;
    regionSelectToggle?: HTMLButtonElement;
    regionSelectionPanel?: HTMLElement;
}

export interface UiShellOptions {
    workbench: GraphWorkbench;
    elements: UiShellElements;
}

export interface UiShell {
    mount: () => void;
    renderCurrentInput: () => Promise<void>;
    unmount: () => void;
}

// Connect a minimal UI shell to the graph workbench orchestration layer.
export default function (options: UiShellOptions): UiShell {
    const workbench = options.workbench;
    const {
        form,
        newickInput,
        newickFileInput,
        newickSourceControls,
        sourceFormatSelect,
        typingFileInput,
        typingSourceControls,
        datasetNameInput,
        ancillaryInput,
        ancillaryFileInput,
        applyAncillaryButton,
        ancillaryJoinColumnInput,
        ancillaryFormatSelect,
        status: statusElement,
        ancillaryWheelContainer,
        ancillarySelectedNodeWheelContainer,
        ancillaryModeSelect,
        ancillaryNodeSelect,
        ancillaryFieldSelect,
        showNodePiesInput,
        ancillarySizeFieldInput,
        ancillarySizeScaleSelect,
        paletteControlsContainer,
        paletteLoadButton,
        paletteLoadInput,
        paletteSaveButton,
        displayOptionsSelect,
        motionInput,
        branchRootButton,
        singleDragButton,
        resetLayoutButton,
        dragStatus,
        edgeLabelPolicySelect,
        exportScaleInput,
        exportLabelSizeInput,
        exportButton,
        lodPlayButton,
        lodPauseButton,
        maxNodesInput,
        searchInput,
        searchButton,
        searchResults,
        regionSelectToggle,
        regionSelectionPanel,
    } = options.elements;

    const expansion = expansionControls(workbench, options.elements.expansion);
    let applyingAncillary = false;
    let loadingGraph = false;
    let loadSequence = 0;
    let lastRenderedGraph: PositionedGraph | null = null;
    const bindings = eventBindings();
    const joinColumnPicker = ancillaryJoinColumnPicker({
        fileInput: ancillaryFileInput,
        columnInput: ancillaryJoinColumnInput,
        formatSelect: ancillaryFormatSelect,
        onError: setFailureStatus,
    });
    const inputs = graphInputReader(
        {
            newickInput,
            newickFileInput,
            typingFileInput,
            ancillaryFileInput,
            ancillaryColumnInput: ancillaryJoinColumnInput,
            ancillaryFormatSelect,
        },
        joinColumnPicker.whenReady
    );
    const pieFieldControls = ancillaryFieldControls(ancillaryFieldSelect);
    const palette = visualMappingPalette({
        workbench,
        container: paletteControlsContainer,
        loadInput: paletteLoadInput,
        saveFilename: CATEGORY_COLOR_SAVE_FILENAME,
        getGraph: () => lastRenderedGraph,
        getSelectedFields: () => getSelectedOptions(ancillaryFieldSelect),
        getPiesEnabled: () => showNodePiesInput?.checked,
        getSizeFieldValue: () => ancillarySizeFieldInput?.value,
        getSizeScaleValue: () => ancillarySizeScaleSelect?.value,
        onChanged: () => {
            wheels.renderOverview();
            wheels.refreshSelectedNode();
        },
        setStatus,
        setFailureStatus,
    });
    const wheels = ancillaryWheels({
        overviewContainer: ancillaryWheelContainer,
        selectedNodeContainer: ancillarySelectedNodeWheelContainer,
        modeSelect: ancillaryModeSelect,
        nodeSelect: ancillaryNodeSelect,
        getGraph: () => lastRenderedGraph,
        getVisualMapping: () => palette.getCurrentVisualMapping(),
        getCategoryColorOverrides: () => palette.getCategoryColorOverrides(),
        getSelectedFields: () => getSelectedOptions(ancillaryFieldSelect),
        selectPieFieldMessage: SELECT_PIE_FIELD_MESSAGE,
        selectedNodeEmptyMessage: SELECTED_NODE_WHEEL_EMPTY_MESSAGE,
    });
    const search = searchController({
        workbench,
        input: searchInput,
        results: searchResults,
        setStatus,
        setFailureStatus,
        onNodeFocused: wheels.renderSelectedNode,
    });
    const region = regionSelection({
        workbench,
        toggle: regionSelectToggle,
        panel: regionSelectionPanel,
        readyStatus: DEFAULT_STATUS_READY,
        setStatus,
        setFailureStatus,
        getAncillaryDistribution: wheels.getDistribution,
    });

    if (!form) {
        throw new Error(ERR_RENDER_FORM_REQUIRED);
    }

    if (!newickInput) {
        throw new Error(ERR_NEWICK_INPUT_REQUIRED);
    }

    let selectedDragRoot: string | null = null;

    if (!statusElement) {
        throw new Error(ERR_STATUS_ELEMENT_REQUIRED);
    }

    return {
        mount: mount,
        renderCurrentInput: renderCurrentInput,
        unmount: unmount,
    };

    // Attach submit handlers and set initial shell status.
    function mount(): void {
        setStatus(DEFAULT_STATUS_READY);
        void joinColumnPicker.refresh();
        bindings.on(ancillaryFileInput, 'change', () => void joinColumnPicker.refresh());
        bindings.on(ancillaryFormatSelect, 'change', () => void joinColumnPicker.refresh());
        if (motionInput) motionInput.checked = workbench.isMotionEnabled?.() ?? true;
        workbench.setInteractionFeedbackHandler?.(message => {
            if (dragStatus) dragStatus.textContent = message;
        });
        expansion.mount();
        workbench.setErrorHandler(error => setFailureStatus(error.message));
        workbench.setGraphRenderedHandler(graph => {
            handleGraphRendered(graph);
        });
        workbench.setNodeClickedHandler(state => {
            expansion.select(state);
            selectedDragRoot = state.nodeId;
            if (branchRootButton) branchRootButton.disabled = state.nodeId === null;
            const { nodeId } = state;
            if (nodeId === null) {
                wheels.resetSelectedNode();
                return;
            }
            wheels.renderSelectedNode(nodeId);
        });
        wheels.renderOverview();
        wheels.resetSelectedNode();
        palette.renderControls();

        const handleAncillaryModeChange = () => {
            updateNodeSelector(
                ancillaryNodeSelect,
                getAncillaryMode(ancillaryModeSelect) === ANCILLARY_MODE_SELECTED ? lastRenderedGraph : null
            );
            updateNodeSelectionVisibility();
            wheels.renderOverview();
        };
        const handleAncillaryFieldChange = () => {
            palette.renderControls();
            palette.applyControlChange();
        };
        bindings.on(ancillaryModeSelect, 'change', handleAncillaryModeChange);
        bindings.on(ancillaryNodeSelect, 'change', () => {
            wheels.renderOverview();
        });
        bindings.on(ancillaryFieldSelect, 'change', handleAncillaryFieldChange);
        bindings.on(showNodePiesInput, 'change', () => palette.applyControlChange());
        bindings.on(ancillaryFieldSelect, 'mousedown', event => {
            handleAncillaryFieldPointerDown(event);
        });
        bindings.on(ancillarySizeFieldInput, 'input', () => {
            palette.applyControlChange();
        });
        bindings.on(ancillarySizeScaleSelect, 'change', () => {
            palette.applyControlChange();
        });
        bindings.on(paletteControlsContainer, 'input', palette.applyControlChange);
        bindings.on(paletteLoadButton, 'click', () => {
            paletteLoadInput?.click();
        });
        bindings.on(paletteLoadInput, 'change', () => {
            void palette.load();
        });
        bindings.on(paletteSaveButton, 'click', () => {
            palette.save();
        });
        bindings.on(motionInput, 'change', () => {
            workbench.setMotionEnabled(motionInput!.checked);
        });
        bindings.on(branchRootButton, 'click', () => {
            if (!selectedDragRoot) return;
            workbench.setDragSelection({ kind: 'branch', rootId: selectedDragRoot });
            if (dragStatus) dragStatus.textContent = `Drag branches away from arrangement root: ${selectedDragRoot}.`;
        });
        bindings.on(singleDragButton, 'click', () => {
            workbench.setDragSelection({ kind: 'node' });
            if (dragStatus) dragStatus.textContent = 'Direct dragging: connected nodes react while Motion is on.';
        });
        bindings.on(resetLayoutButton, 'click', () => {
            workbench.resetLayoutEdits();
            if (motionInput) motionInput.checked = false;
            resetDragControls();
        });
        bindings.on(edgeLabelPolicySelect, 'change', handleDisplayOptionsChange);
        bindings.on(exportButton, 'click', () => void exportCurrentView());
        bindings.on(displayOptionsSelect, 'change', () => {
            handleDisplayOptionsChange();
        });
        bindings.on(displayOptionsSelect, 'mousedown', event => {
            handleDisplayOptionPointerDown(event);
        });
        bindings.on(lodPlayButton, 'click', () => {
            void handleLodPlaybackChange(false);
        });
        bindings.on(lodPauseButton, 'click', () => {
            void handleLodPlaybackChange(true);
        });
        bindings.on(searchInput, 'input', search.reset);
        bindings.on(searchButton, 'click', () => {
            void search.searchCurrentDataset();
        });
        bindings.on(regionSelectToggle, 'click', () => {
            region.toggle();
        });
        bindings.on(sourceFormatSelect, 'change', updateSourceControls);
        workbench.setRegionSelectedHandler(bounds => {
            void region.handleSelected(bounds);
        });
        region.mount();

        updateNodeSelectionVisibility();
        updateSourceControls();
        pieFieldControls.updateOptions(null);
        updateLodPlaybackControls(false);
        handleDisplayOptionsChange();

        updateApplyAncillaryButton();
        bindings.on(applyAncillaryButton, 'click', () => {
            void applyCurrentAncillaryData();
        });
        bindings.on(form, 'submit', event => {
            event.preventDefault();
            void renderCurrentInput();
        });
    }

    function updateApplyAncillaryButton(): void {
        if (applyAncillaryButton) {
            applyAncillaryButton.disabled = !lastRenderedGraph || applyingAncillary || loadingGraph;
        }
    }

    function updateSourceControls(): void {
        const typingDataSelected = getSourceFormat() === SOURCE_FORMAT_TYPING_DATA;
        newickSourceControls?.toggleAttribute('hidden', typingDataSelected);
        typingSourceControls?.toggleAttribute('hidden', !typingDataSelected);
    }

    async function applyCurrentAncillaryData(): Promise<void> {
        if (!lastRenderedGraph || applyingAncillary || loadingGraph) return;
        const sequence = loadSequence;
        applyingAncillary = true;
        updateApplyAncillaryButton();
        setStatus('Applying ancillary data...');
        try {
            const data = await inputs.readAncillaryTable();
            if (sequence !== loadSequence) return;
            if (!data) throw new Error('Choose an ancillary table first.');
            const result = await workbench.applyAncillaryData(data);
            if (sequence !== loadSequence) return;
            setStatus(
                `Applied ancillary data to ${result.matchedNodeCount} nodes.${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}`
            );
        } catch (error) {
            if (sequence !== loadSequence) return;
            setFailureStatus(toError(error).message);
        } finally {
            if (sequence === loadSequence) {
                applyingAncillary = false;
                updateApplyAncillaryButton();
            }
        }
    }

    // Prepare and render the current input.
    async function renderCurrentInput(): Promise<void> {
        const sequence = ++loadSequence;
        applyingAncillary = false;
        try {
            const sourceFormat = getSourceFormat();
            const content = (await inputs.readSourceContent(sourceFormat)).trim();
            if (sequence !== loadSequence) return;
            const datasetName = datasetNameInput?.value.trim();
            const ancillaryRaw = ancillaryInput?.value.trim() ?? '';

            if (!content) {
                const label =
                    sourceFormat === SOURCE_FORMAT_TYPING_DATA ? 'empty typing data input' : 'empty Newick input';
                setFailureStatus(label);
                return;
            }

            search.reset();
            region.reset();
            resetDragControls();
            loadingGraph = true;
            expansion.setReady(false);
            updateApplyAncillaryButton();
            setStatus(`${STATUS_RENDERING_PREFIX}...`);

            wheels.resetSelectedNode();
            const ancillaryPayload = parseAncillaryPayload(ancillaryRaw);
            const ancillaryData = await inputs.readAncillaryTable();
            if (sequence !== loadSequence) return;
            const mapping = ancillaryPayload.visualMapping ?? {};
            pieFieldControls.setSelection(
                mapping.pie?.enabled !== false && mapping.pie?.fields?.length
                    ? mapping.pie.fields
                    : mapping.colorField
                      ? [mapping.colorField]
                      : []
            );
            palette.reset();
            palette.setBaseVisualMapping(mapping);
            await workbench.loadGraph(
                { content, datasetName: datasetName || undefined, format: sourceFormat },
                {
                    ancillarySchema: ancillaryPayload.ancillarySchema,
                    ancillaryByNodeId: ancillaryPayload.ancillaryByNodeId,
                    ancillaryData,
                    visualMapping: palette.getCurrentVisualMapping(),
                    displayOptions: buildCurrentDisplayOptions(),
                    lod: {
                        maxNodes: getSelectedMaxNodes(),
                    },
                }
            );
        } catch (error) {
            if (sequence !== loadSequence) return;
            const message = toError(error).message;
            setFailureStatus(message);
            lastRenderedGraph = null;
            palette.reset();
            updateNodeSelector(ancillaryNodeSelect, null);
            pieFieldControls.updateOptions(null);
            palette.renderControls();
            wheels.renderOverview();
        } finally {
            if (sequence === loadSequence) {
                loadingGraph = false;
                updateApplyAncillaryButton();
            }
        }
    }

    // Remove shell event listeners and dispose rendering resources.
    function unmount(): void {
        loadSequence += 1;
        palette.reset();
        joinColumnPicker.dispose();
        search.reset();
        region.reset();
        bindings.clear();
        expansion.dispose();
        workbench.setErrorHandler(null);
        workbench.setGraphRenderedHandler(null);
        workbench.setInteractionFeedbackHandler?.(null);
        workbench.setNodeClickedHandler(null);
        workbench.setRegionSelectedHandler(null);
        workbench.dispose();
    }

    // Update the shell status text for user feedback.
    function setStatus(status: string): void {
        statusElement.textContent = status;
    }

    function setFailureStatus(message: string): void {
        setStatus(`${STATUS_FAILED_PREFIX}: ${message}`);
    }

    function handleGraphRendered(graph: PositionedGraph): void {
        setStatus(buildRenderedStatus(graph));
        lastRenderedGraph = graph;
        expansion.setReady(true);
        updateApplyAncillaryButton();
        updateNodeSelector(
            ancillaryNodeSelect,
            getAncillaryMode(ancillaryModeSelect) === ANCILLARY_MODE_SELECTED ? graph : null
        );
        pieFieldControls.updateOptions(graph);
        palette.renderControls();
        updateNodeSelectionVisibility();
        updateLodPlaybackControls(isLodGraph(graph));
        wheels.renderOverview();
        wheels.refreshSelectedNode();
        region.reset();
    }

    function handleDisplayOptionsChange(): void {
        workbench.updateDisplayOptions(buildCurrentDisplayOptions());
    }

    function handleAncillaryFieldPointerDown(event: MouseEvent): void {
        if (pieFieldControls.toggleOption(event)) {
            palette.renderControls();
            palette.applyControlChange();
        }
    }

    function handleDisplayOptionPointerDown(event: MouseEvent): void {
        if (toggleClickedOption(displayOptionsSelect, event)) {
            handleDisplayOptionsChange();
        }
    }

    function handleLodPlaybackChange(paused: boolean): void {
        try {
            workbench.setLodRefreshPaused(paused);
            updateLodPlaybackControls(isLodGraph(lastRenderedGraph));
            if (paused) {
                setStatus('LoD paused: navigate freely without slice refreshes');
            }
        } catch (error) {
            const message = toError(error).message;
            setFailureStatus(message);
        }
    }

    function updateNodeSelectionVisibility(): void {
        updateNodeSelectionVisibilityControl(ancillaryNodeSelect, ancillaryModeSelect);
    }

    function updateLodPlaybackControls(lodAvailable: boolean): void {
        updateLodPlaybackControlsView({
            playButton: lodPlayButton,
            pauseButton: lodPauseButton,
            lodAvailable,
            paused: workbench.isLodRefreshPaused(),
        });
    }

    function getSelectedMaxNodes(): number | undefined {
        return parseMaxNodes(maxNodesInput?.value);
    }

    function resetDragControls(): void {
        selectedDragRoot = null;
        if (branchRootButton) branchRootButton.disabled = true;
        if (dragStatus) dragStatus.textContent = 'Direct dragging: connected nodes react while Motion is on.';
    }

    function buildCurrentDisplayOptions(): GraphDisplayOptions {
        const display = buildDisplayOptions(getSelectedOptions(displayOptionsSelect));
        return edgeLabelPolicySelect
            ? {
                  ...display,
                  edgeDistanceLabelPolicy: edgeLabelPolicySelect.value === 'always' ? 'always' : 'auto',
              }
            : display;
    }

    async function exportCurrentView(): Promise<void> {
        if (!lastRenderedGraph || !exportButton) {
            setFailureStatus('load a tree before exporting');
            return;
        }
        const request = loadSequence;
        exportButton.disabled = true;
        try {
            const blob = await workbench.exportPng({
                scale: Number(exportScaleInput?.value ?? 2),
                edgeLabelSize: Number(exportLabelSizeInput?.value ?? 12),
                edgeLabels: buildCurrentDisplayOptions().edgeDistanceLabels ? 'all' : 'none',
                includeLegend: true,
            });
            downloadBlob('phylo-lens.png', blob);
            if (request === loadSequence) setStatus('Exported PNG of the current slice and view.');
        } catch (error) {
            if (request === loadSequence)
                setFailureStatus(error instanceof Error ? error.message : 'PNG export failed');
        } finally {
            exportButton.disabled = false;
        }
    }

    function getSourceFormat(): SourceFormat {
        return sourceFormatSelect?.value === SOURCE_FORMAT_TYPING_DATA
            ? SOURCE_FORMAT_TYPING_DATA
            : SOURCE_FORMAT_NEWICK;
    }
}
