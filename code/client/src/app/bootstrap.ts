import { createGraphClient } from "../api/graphClient";
import rendererFactory from "../render/rendererFactory";
import { RENDERER_KIND_SIGMA } from "../render/renderer.types";
import { createGraphWorkbench } from "./workbench/graphWorkbench";
import uiShell, { type UiShell } from "./uiShell";

export const DEFAULT_SERVER_BASE_URL = "http://localhost:8000";

export const ID_RENDER_FORM = "render-form";
export const ID_NEWICK_INPUT = "newick-input";
export const ID_NEWICK_FILE_INPUT = "newick-file-input";
export const ID_SOURCE_FORMAT = "source-format";
export const ID_TYPING_FILE_INPUT = "typing-file-input";
export const ID_DATASET_NAME_INPUT = "dataset-name-input";
export const ID_ANCILLARY_INPUT = "ancillary-input";
export const ID_ANCILLARY_FILE_INPUT = "ancillary-file-input";
export const ID_ANCILLARY_JOIN_COLUMN_INPUT = "ancillary-join-column-input";
export const ID_ANCILLARY_FORMAT = "ancillary-format";
export const ID_STATUS = "status";
export const ID_GRAPH_ROOT = "graph-root";
export const ID_ANCILLARY_WHEEL = "ancillary-wheel";
export const ID_ANCILLARY_SELECTED_NODE_WHEEL = "ancillary-selected-node-wheel";
export const ID_ANCILLARY_MODE = "ancillary-mode";
export const ID_ANCILLARY_NODE = "ancillary-node";
export const ID_METADATA_PIE_FIELD = "metadata-pie-field";
export const ID_METADATA_SIZE_FIELD = "metadata-size-field";
export const ID_METADATA_SIZE_SCALE = "metadata-size-scale";
export const ID_PALETTE_CONTROLS = "palette-controls";
export const ID_PALETTE_LOAD_BUTTON = "palette-load-button";
export const ID_PALETTE_LOAD_INPUT = "palette-load-input";
export const ID_PALETTE_SAVE_BUTTON = "palette-save-button";
export const ID_DISPLAY_OPTIONS = "display-options";
export const ID_LOD_PLAY_BUTTON = "lod-play-button";
export const ID_LOD_PAUSE_BUTTON = "lod-pause-button";
export const ID_MAX_NODES_INPUT = "max-nodes-input";
export const ID_SEARCH_INPUT = "search-input";
export const ID_SEARCH_BUTTON = "search-button";
export const ID_SEARCH_RESULTS = "search-results";
export const ID_REGION_SELECT_TOGGLE = "region-select-toggle";
export const ID_REGION_SELECTION_PANEL = "region-selection-panel";

export const ERR_MISSING_RENDER_FORM = "Missing render form element.";
export const ERR_MISSING_NEWICK_INPUT = "Missing Newick input element.";
export const ERR_MISSING_STATUS = "Missing status element.";

export default function bootstrapClientShell(baseUrl = DEFAULT_SERVER_BASE_URL): UiShell {
  const elements = {
    form: requireElement<HTMLFormElement>(ID_RENDER_FORM, ERR_MISSING_RENDER_FORM),
    newickInput: requireElement<HTMLTextAreaElement>(ID_NEWICK_INPUT, ERR_MISSING_NEWICK_INPUT),
    status: requireElement(ID_STATUS, ERR_MISSING_STATUS),

    newickFileInput: getInput(ID_NEWICK_FILE_INPUT),
    sourceFormatSelect: getSelect(ID_SOURCE_FORMAT),
    typingFileInput: getInput(ID_TYPING_FILE_INPUT),
    datasetNameInput: getInput(ID_DATASET_NAME_INPUT),

    ancillaryInput: getTextArea(ID_ANCILLARY_INPUT),
    ancillaryFileInput: getInput(ID_ANCILLARY_FILE_INPUT),
    ancillaryJoinColumnInput: getInput(ID_ANCILLARY_JOIN_COLUMN_INPUT),
    ancillaryFormatSelect: getSelect(ID_ANCILLARY_FORMAT),
    ancillaryWheelContainer: getOptionalElement(ID_ANCILLARY_WHEEL),
    ancillarySelectedNodeWheelContainer: getOptionalElement(ID_ANCILLARY_SELECTED_NODE_WHEEL),
    ancillaryModeSelect: getSelect(ID_ANCILLARY_MODE),
    ancillaryNodeSelect: getSelect(ID_ANCILLARY_NODE),

    metadataPieFieldSelect: getSelect(ID_METADATA_PIE_FIELD),
    metadataSizeFieldInput: getInput(ID_METADATA_SIZE_FIELD),
    metadataSizeScaleSelect: getSelect(ID_METADATA_SIZE_SCALE),

    paletteControlsContainer: getOptionalElement(ID_PALETTE_CONTROLS),
    paletteLoadButton: getButton(ID_PALETTE_LOAD_BUTTON),
    paletteLoadInput: getInput(ID_PALETTE_LOAD_INPUT),
    paletteSaveButton: getButton(ID_PALETTE_SAVE_BUTTON),

    displayOptionsSelect: getSelect(ID_DISPLAY_OPTIONS),
    lodPlayButton: getButton(ID_LOD_PLAY_BUTTON),
    lodPauseButton: getButton(ID_LOD_PAUSE_BUTTON),
    maxNodesInput: getInput(ID_MAX_NODES_INPUT),

    searchInput: getInput(ID_SEARCH_INPUT),
    searchButton: getButton(ID_SEARCH_BUTTON),
    searchResults: getOptionalElement(ID_SEARCH_RESULTS),

    regionSelectToggle: getButton(ID_REGION_SELECT_TOGGLE),
    regionSelectionPanel: getOptionalElement(ID_REGION_SELECTION_PANEL),
  };

  const graphClient = createGraphClient({ baseUrl });
  const workbench = createGraphWorkbench({
    graphClient,
    rendererFactory: rendererFactory(),
    rendererKind: RENDERER_KIND_SIGMA,
    renderContext: { containerId: ID_GRAPH_ROOT },
  });

  const shell = uiShell({
    workbench,
    elements,
  });

  shell.mount();

  return shell;
}

function getButton(id: string): HTMLButtonElement | undefined {
  return getOptionalElement<HTMLButtonElement>(id);
}

function getInput(id: string): HTMLInputElement | undefined {
  return getOptionalElement<HTMLInputElement>(id);
}

function getSelect(id: string): HTMLSelectElement | undefined {
  return getOptionalElement<HTMLSelectElement>(id);
}

function getOptionalElement<T extends HTMLElement = HTMLElement>(id: string): T | undefined {
  return (document.getElementById(id) as T | null) ?? undefined;
}

function getTextArea(id: string): HTMLTextAreaElement | undefined {
  return getOptionalElement<HTMLTextAreaElement>(id);
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string, errorMessage: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(errorMessage);
  }

  return element as T;
}
