import { createGraphWorkbench } from "./workbench/graphWorkbench";
import { createGraphClient } from "../api/graphClient";
import uiShell, { type UiShell } from "./uiShell";
import rendererFactory from "../render/rendererFactory";
import { RENDERER_KIND_SIGMA } from "../render/types";

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

// Bootstrap the client shell using DOM ids and the modular workbench pipeline.
export default function bootstrapClientShell(
  baseUrl = DEFAULT_SERVER_BASE_URL,
): UiShell {
  const form = document.getElementById(
    ID_RENDER_FORM,
  ) as HTMLFormElement | null;
  const newickInput = document.getElementById(
    ID_NEWICK_INPUT,
  ) as HTMLTextAreaElement | null;
  const newickFileInput = document.getElementById(
    ID_NEWICK_FILE_INPUT,
  ) as HTMLInputElement | null;
  const sourceFormatSelect = document.getElementById(
    ID_SOURCE_FORMAT,
  ) as HTMLSelectElement | null;
  const typingFileInput = document.getElementById(
    ID_TYPING_FILE_INPUT,
  ) as HTMLInputElement | null;
  const datasetNameInput = document.getElementById(
    ID_DATASET_NAME_INPUT,
  ) as HTMLInputElement | null;
  const ancillaryInput = document.getElementById(
    ID_ANCILLARY_INPUT,
  ) as HTMLTextAreaElement | null;
  const ancillaryFileInput = document.getElementById(
    ID_ANCILLARY_FILE_INPUT,
  ) as HTMLInputElement | null;
  const ancillaryJoinColumnInput = document.getElementById(
    ID_ANCILLARY_JOIN_COLUMN_INPUT,
  ) as HTMLInputElement | null;
  const ancillaryFormatSelect = document.getElementById(
    ID_ANCILLARY_FORMAT,
  ) as HTMLSelectElement | null;
  const status = document.getElementById(ID_STATUS);
  const ancillaryWheelContainer = document.getElementById(ID_ANCILLARY_WHEEL);
  const ancillarySelectedNodeWheelContainer = document.getElementById(
    ID_ANCILLARY_SELECTED_NODE_WHEEL,
  );
  const ancillaryModeSelect = document.getElementById(
    ID_ANCILLARY_MODE,
  ) as HTMLSelectElement | null;
  const ancillaryNodeSelect = document.getElementById(
    ID_ANCILLARY_NODE,
  ) as HTMLSelectElement | null;
  const metadataPieFieldSelect = document.getElementById(
    ID_METADATA_PIE_FIELD,
  ) as HTMLSelectElement | null;
  const metadataSizeFieldInput = document.getElementById(
    ID_METADATA_SIZE_FIELD,
  ) as HTMLInputElement | null;
  const metadataSizeScaleSelect = document.getElementById(
    ID_METADATA_SIZE_SCALE,
  ) as HTMLSelectElement | null;
  const paletteControlsContainer = document.getElementById(ID_PALETTE_CONTROLS);
  const paletteLoadButton = document.getElementById(
    ID_PALETTE_LOAD_BUTTON,
  ) as HTMLButtonElement | null;
  const paletteLoadInput = document.getElementById(
    ID_PALETTE_LOAD_INPUT,
  ) as HTMLInputElement | null;
  const paletteSaveButton = document.getElementById(
    ID_PALETTE_SAVE_BUTTON,
  ) as HTMLButtonElement | null;
  const displayOptionsSelect = document.getElementById(
    ID_DISPLAY_OPTIONS,
  ) as HTMLSelectElement | null;
  const lodPlayButton = document.getElementById(
    ID_LOD_PLAY_BUTTON,
  ) as HTMLButtonElement | null;
  const lodPauseButton = document.getElementById(
    ID_LOD_PAUSE_BUTTON,
  ) as HTMLButtonElement | null;
  const maxNodesInput = document.getElementById(
    ID_MAX_NODES_INPUT,
  ) as HTMLInputElement | null;
  const searchInput = document.getElementById(
    ID_SEARCH_INPUT,
  ) as HTMLInputElement | null;
  const searchButton = document.getElementById(
    ID_SEARCH_BUTTON,
  ) as HTMLButtonElement | null;
  const searchResults = document.getElementById(ID_SEARCH_RESULTS);
  const regionSelectToggle = document.getElementById(
    ID_REGION_SELECT_TOGGLE,
  ) as HTMLButtonElement | null;
  const regionSelectionPanel = document.getElementById(
    ID_REGION_SELECTION_PANEL,
  );

  if (!form) {
    throw new Error(ERR_MISSING_RENDER_FORM);
  }

  if (!newickInput) {
    throw new Error(ERR_MISSING_NEWICK_INPUT);
  }

  if (!status) {
    throw new Error(ERR_MISSING_STATUS);
  }

  const graphClient = createGraphClient({ baseUrl });
  const workbench = createGraphWorkbench({
    graphClient,
    rendererFactory: rendererFactory(),
    rendererKind: RENDERER_KIND_SIGMA,
    renderContext: { containerId: ID_GRAPH_ROOT },
  });

  const shell = uiShell({
    workbench,
    elements: {
      form,
      newickInput,
      newickFileInput: newickFileInput ?? undefined,
      sourceFormatSelect: sourceFormatSelect ?? undefined,
      typingFileInput: typingFileInput ?? undefined,
      datasetNameInput: datasetNameInput ?? undefined,
      ancillaryInput: ancillaryInput ?? undefined,
      ancillaryFileInput: ancillaryFileInput ?? undefined,
      ancillaryJoinColumnInput: ancillaryJoinColumnInput ?? undefined,
      ancillaryFormatSelect: ancillaryFormatSelect ?? undefined,
      status,
      ancillaryWheelContainer: ancillaryWheelContainer ?? undefined,
      ancillarySelectedNodeWheelContainer:
        ancillarySelectedNodeWheelContainer ?? undefined,
      ancillaryModeSelect: ancillaryModeSelect ?? undefined,
      ancillaryNodeSelect: ancillaryNodeSelect ?? undefined,
      metadataPieFieldSelect: metadataPieFieldSelect ?? undefined,
      metadataSizeFieldInput: metadataSizeFieldInput ?? undefined,
      metadataSizeScaleSelect: metadataSizeScaleSelect ?? undefined,
      paletteControlsContainer: paletteControlsContainer ?? undefined,
      paletteLoadButton: paletteLoadButton ?? undefined,
      paletteLoadInput: paletteLoadInput ?? undefined,
      paletteSaveButton: paletteSaveButton ?? undefined,
      displayOptionsSelect: displayOptionsSelect ?? undefined,
      lodPlayButton: lodPlayButton ?? undefined,
      lodPauseButton: lodPauseButton ?? undefined,
      maxNodesInput: maxNodesInput ?? undefined,
      searchInput: searchInput ?? undefined,
      searchButton: searchButton ?? undefined,
      searchResults: searchResults ?? undefined,
      regionSelectToggle: regionSelectToggle ?? undefined,
      regionSelectionPanel: regionSelectionPanel ?? undefined,
    },
  });

  shell.mount();
  return shell;
}
