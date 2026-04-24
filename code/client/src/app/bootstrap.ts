import { DatasetClient } from "../api/datasetClient";
import { GraphWorkbench } from "./graphWorkbench";
import { UiShellController } from "./uiShell";
import { DefaultRendererFactory } from "../render/rendererFactory";
import { RENDERER_KIND_SIGMA } from "../render/types";

export const DEFAULT_SERVER_BASE_URL = "http://localhost:8000";

export const ID_RENDER_FORM = "render-form";
export const ID_NEWICK_INPUT = "newick-input";
export const ID_DATASET_NAME_INPUT = "dataset-name-input";
export const ID_ANCILLARY_INPUT = "ancillary-input";
export const ID_STATUS = "status";
export const ID_GRAPH_ROOT = "graph-root";
export const ID_ANCILLARY_WHEEL = "ancillary-wheel";
export const ID_ANCILLARY_MODE = "ancillary-mode";
export const ID_ANCILLARY_NODE = "ancillary-node";
export const ID_LAYOUT_MODE = "layout-mode";
export const ID_MAX_NODES_INPUT = "max-nodes-input";
export const ID_INITIAL_ZOOM_INPUT = "initial-zoom-input";

export const ERR_MISSING_RENDER_FORM = "Missing render form element.";
export const ERR_MISSING_NEWICK_INPUT = "Missing Newick input element.";
export const ERR_MISSING_STATUS = "Missing status element.";

// Bootstrap the client shell using DOM ids and the modular workbench pipeline.
export function bootstrapClientShell(
  baseUrl = DEFAULT_SERVER_BASE_URL,
): UiShellController {
  const form = document.getElementById(
    ID_RENDER_FORM,
  ) as HTMLFormElement | null;
  const newickInput = document.getElementById(
    ID_NEWICK_INPUT,
  ) as HTMLTextAreaElement | null;
  const datasetNameInput = document.getElementById(
    ID_DATASET_NAME_INPUT,
  ) as HTMLInputElement | null;
  const ancillaryInput = document.getElementById(
    ID_ANCILLARY_INPUT,
  ) as HTMLTextAreaElement | null;
  const status = document.getElementById(ID_STATUS);
  const ancillaryWheelContainer = document.getElementById(ID_ANCILLARY_WHEEL);
  const ancillaryModeSelect = document.getElementById(
    ID_ANCILLARY_MODE,
  ) as HTMLSelectElement | null;
  const ancillaryNodeSelect = document.getElementById(
    ID_ANCILLARY_NODE,
  ) as HTMLSelectElement | null;
  const layoutModeSelect = document.getElementById(
    ID_LAYOUT_MODE,
  ) as HTMLSelectElement | null;
  const maxNodesInput = document.getElementById(
    ID_MAX_NODES_INPUT,
  ) as HTMLInputElement | null;
  const initialZoomInput = document.getElementById(
    ID_INITIAL_ZOOM_INPUT,
  ) as HTMLInputElement | null;

  if (!form) {
    throw new Error(ERR_MISSING_RENDER_FORM);
  }

  if (!newickInput) {
    throw new Error(ERR_MISSING_NEWICK_INPUT);
  }

  if (!status) {
    throw new Error(ERR_MISSING_STATUS);
  }

  const datasetClient = new DatasetClient({ baseUrl });
  const workbench = new GraphWorkbench({
    datasetClient,
    rendererFactory: new DefaultRendererFactory(),
    rendererKind: RENDERER_KIND_SIGMA,
    renderContext: { containerId: ID_GRAPH_ROOT },
  });

  const shell = new UiShellController({
    workbench,
    elements: {
      form,
      newickInput,
      datasetNameInput: datasetNameInput ?? undefined,
      ancillaryInput: ancillaryInput ?? undefined,
      status,
      ancillaryWheelContainer: ancillaryWheelContainer ?? undefined,
      ancillaryModeSelect: ancillaryModeSelect ?? undefined,
      ancillaryNodeSelect: ancillaryNodeSelect ?? undefined,
      layoutModeSelect: layoutModeSelect ?? undefined,
      maxNodesInput: maxNodesInput ?? undefined,
      initialZoomInput: initialZoomInput ?? undefined,
    },
  });

  shell.mount();
  return shell;
}
