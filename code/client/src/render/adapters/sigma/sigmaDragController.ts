import type Graph from "graphology";
import type Sigma from "sigma";

type MouseEventPayload = {
  x: number;
  y: number;
  preventSigmaDefault?: () => void;
};

type SigmaNodeEventPayload = {
  node?: string;
  event?: MouseEventPayload;
  preventSigmaDefault?: () => void;
};

type SigmaEventTarget = {
  on?: (event: string, handler: (payload: SigmaNodeEventPayload) => void) => void;
  off?: (
    event: string,
    handler: (payload: SigmaNodeEventPayload) => void,
  ) => void;
};

type SigmaMouseCaptor = {
  on?: (event: string, handler: (payload: MouseEventPayload) => void) => void;
  off?: (event: string, handler: (payload: MouseEventPayload) => void) => void;
};

interface SigmaDragControllerOptions {
  getGraph: () => Graph | null;
  getSigma: () => Sigma | null;
  suppressViewChangesFor: (durationMs: number) => void;
  suppressNodeClicksFor: (durationMs: number) => void;
}

export class SigmaDragController {
  private readonly options: SigmaDragControllerOptions;
  private draggedNodeId: string | null = null;
  private draggedNodeMoved = false;
  private previousCameraPanningEnabled: boolean | null = null;
  private readonly boundNodeDragStarted = (payload: SigmaNodeEventPayload) => {
    this.startNodeDrag(payload);
  };
  private readonly boundNodeDragged = (payload: MouseEventPayload) => {
    this.dragNode(payload);
  };
  private readonly boundNodeDragEnded = () => {
    this.endNodeDrag();
  };

  constructor(options: SigmaDragControllerOptions) {
    this.options = options;
  }

  bind(): void {
    const sigma = this.options.getSigma() as SigmaEventTarget | null;
    const mouseCaptor = this.options.getSigma()?.getMouseCaptor?.() as
      | SigmaMouseCaptor
      | undefined;

    sigma?.off?.("downNode", this.boundNodeDragStarted);
    sigma?.on?.("downNode", this.boundNodeDragStarted);
    mouseCaptor?.off?.("mousemovebody", this.boundNodeDragged);
    mouseCaptor?.on?.("mousemovebody", this.boundNodeDragged);
    mouseCaptor?.off?.("mouseup", this.boundNodeDragEnded);
    mouseCaptor?.on?.("mouseup", this.boundNodeDragEnded);
  }

  unbind(): void {
    const sigma = this.options.getSigma() as SigmaEventTarget | null;
    const mouseCaptor = this.options.getSigma()?.getMouseCaptor?.() as
      | SigmaMouseCaptor
      | undefined;

    sigma?.off?.("downNode", this.boundNodeDragStarted);
    mouseCaptor?.off?.("mousemovebody", this.boundNodeDragged);
    mouseCaptor?.off?.("mouseup", this.boundNodeDragEnded);
  }

  reset(): void {
    this.draggedNodeId = null;
    this.draggedNodeMoved = false;
    this.previousCameraPanningEnabled = null;
  }

  private startNodeDrag(payload: SigmaNodeEventPayload): void {
    const graph = this.options.getGraph();
    const sigma = this.options.getSigma();
    const nodeId = payload.node;

    if (!nodeId || !graph?.hasNode(nodeId) || !sigma) {
      return;
    }

    this.draggedNodeId = nodeId;
    this.draggedNodeMoved = false;
    this.options.suppressViewChangesFor(250);
    this.previousCameraPanningEnabled = sigma.getSetting?.(
      "enableCameraPanning",
    ) as boolean | null;
    sigma.setSetting?.("enableCameraPanning", false);
    payload.preventSigmaDefault?.();
    payload.event?.preventSigmaDefault?.();
  }

  private dragNode(payload: MouseEventPayload): void {
    const graph = this.options.getGraph();
    const sigma = this.options.getSigma();

    if (!this.draggedNodeId || !graph || !sigma) {
      return;
    }

    const position = sigma.viewportToGraph({
      x: payload.x,
      y: payload.y,
    });

    graph.setNodeAttribute(this.draggedNodeId, "x", position.x);
    graph.setNodeAttribute(this.draggedNodeId, "y", position.y);
    this.draggedNodeMoved = true;
    this.options.suppressViewChangesFor(250);
    payload.preventSigmaDefault?.();
    sigma.refresh({
      partialGraph: { nodes: [this.draggedNodeId] },
      skipIndexation: true,
    });
  }

  private endNodeDrag(): void {
    const sigma = this.options.getSigma();

    if (!sigma || !this.draggedNodeId) {
      return;
    }

    if (typeof this.previousCameraPanningEnabled === "boolean") {
      sigma.setSetting?.("enableCameraPanning", this.previousCameraPanningEnabled);
    }

    if (this.draggedNodeMoved) {
      this.options.suppressNodeClicksFor(250);
    }

    this.reset();
    this.options.suppressViewChangesFor(250);
  }
}
