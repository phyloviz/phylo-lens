import type { GraphWorkbench } from "../../workbench/graphWorkbench.types";
import type { RenderNodeClickState } from "../../../render/renderer.types";
import type { ExpansionState } from "../../../contracts/expansion";
import eventBindings from "../events/eventBindings";

export interface ExpansionControlsElements {
  expandSelected?: HTMLButtonElement;
  collapseSelected?: HTMLButtonElement;
  expandAll?: HTMLButtonElement;
  collapseAll?: HTMLButtonElement;
  keepExpanded?: HTMLInputElement;
  feedback?: HTMLElement;
}

export function expansionControls(workbench: GraphWorkbench, elements: ExpansionControlsElements = {}) {
  const bindings = eventBindings();
  let selected: RenderNodeClickState | null = null;
  let ready = false;
  let busy = false;
  let failure: string | null = null;
  const available = Object.values(elements).some(Boolean);
  const clusterId = () => String(selected?.attributes?.cluster_id ?? selected?.nodeId ?? "");

  function update() {
    if (!available) return;
    const state = ready ? workbench.getExpansionState() : null;
    const expanded = state?.expandedClusterIds.includes(clusterId()) ?? false;
    if (elements.expandSelected)
      elements.expandSelected.disabled = !ready || busy || expanded || selected?.attributes?.is_cluster_proxy !== true;
    if (elements.collapseSelected) elements.collapseSelected.disabled = !ready || busy || !expanded;
    for (const button of [elements.expandAll, elements.collapseAll]) if (button) button.disabled = !ready || busy;
    if (elements.keepExpanded) {
      elements.keepExpanded.disabled = !ready || busy;
      elements.keepExpanded.checked = state?.keepExpanded ?? false;
    }
    if (elements.feedback && failure) elements.feedback.textContent = failure;
    else if (state && !busy) show(state);
  }

  function show(state: ExpansionState) {
    if (!elements.feedback) return;
    elements.feedback.textContent = state.partial
      ? `Partial result: ${state.renderedNodeCount} nodes shown (limit ${state.maxNodes}). Some nodes remain unavailable in this view.`
      : state.allExpanded
        ? `All nodes expanded: ${state.renderedNodeCount}.`
        : `${state.expandedClusterIds.length} groups explicitly expanded.`;
  }

  async function run(action: () => unknown) {
    busy = true;
    failure = null;
    update();
    if (elements.feedback) elements.feedback.textContent = "Updating expansion…";
    try {
      const result = await action();
      if (result && typeof result === "object" && "status" in result && result.status === "superseded") {
        failure = "Expansion was superseded by a newer view. Try again.";
      }
    } catch (error) {
      failure = String(error);
    } finally {
      busy = false;
      update();
    }
  }

  return {
    mount() {
      bindings.on(elements.expandSelected, "click", () => {
        void run(() => workbench.expandCluster(clusterId()));
      });
      bindings.on(elements.collapseSelected, "click", () => {
        void run(() => workbench.collapseCluster(clusterId()));
      });
      bindings.on(elements.expandAll, "click", () => {
        void run(() => workbench.expandAll());
      });
      bindings.on(elements.collapseAll, "click", () => {
        void run(() => workbench.collapseAll());
      });
      bindings.on(elements.keepExpanded, "change", () => {
        const keep = elements.keepExpanded!.checked;
        void run(() => workbench.setKeepExpanded(keep));
      });
      update();
    },
    select(state: RenderNodeClickState) {
      selected = state;
      update();
    },
    setReady(value: boolean) {
      ready = value;
      if (!value) {
        selected = null;
        failure = null;
      }
      update();
    },
    update,
    dispose() {
      bindings.clear();
    },
  };
}
