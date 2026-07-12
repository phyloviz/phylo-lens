import type { AncillaryWheelStats } from "../../../components/ancillaryWheel";
import type { SigmaViewportBounds } from "../../../render/adapters/sigma/viewport/graphViewport.types";
import type { GraphWorkbench } from "../../workbench/graphWorkbench";
import { renderRegionPanel } from "./regionPanelView";

export interface RegionSelectionOptions {
  workbench: GraphWorkbench;
  toggle?: HTMLButtonElement;
  panel?: HTMLElement;
  readyStatus: string;
  setStatus: (status: string) => void;
  setFailureStatus: (message: string) => void;
  buildWheelStats: (includeNodeIds?: Set<string>) => AncillaryWheelStats | null;
}

export default function (options: RegionSelectionOptions) {
  let enabled = false;

  return {
    mount: mount,
    toggle: toggle,
    reset: reset,
    handleSelected: handleSelected,
  };

  function mount(): void {
    resetPanel();
    updateToggleLabel();
  }

  function toggle(): void {
    enabled = !enabled;
    options.workbench.setRegionSelectModeEnabled(enabled);
    updateToggleLabel();

    if (!enabled) {
      reset();
    }

    options.setStatus(enabled ? "Select region: drag a box on the canvas to isolate an area" : options.readyStatus);
  }

  function reset(): void {
    options.workbench.clearRegionSelection();
    resetPanel();
  }

  async function handleSelected(bounds: SigmaViewportBounds): Promise<void> {
    if (!options.panel) {
      return;
    }

    try {
      const result = await options.workbench.selectRegion(bounds);
      renderRegionPanel(options.panel, {
        nodeCount: result.nodeCount,
        truncated: result.truncated,
        aggregatedMetadata: result.aggregatedMetadata,
        wheelStats: options.buildWheelStats(new Set(result.nodeIds)),
      });
      options.setStatus(`Region selected: ${result.nodeCount} ${result.nodeCount === 1 ? "node" : "nodes"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      options.setFailureStatus(message);
    }
  }

  function resetPanel(): void {
    if (options.panel) {
      renderRegionPanel(options.panel, null);
    }
  }

  function updateToggleLabel(): void {
    if (!options.toggle) {
      return;
    }

    options.toggle.textContent = enabled ? "Selecting…" : "Select region";
    options.toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
}
