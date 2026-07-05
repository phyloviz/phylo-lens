import type Sigma from "sigma";

import type { SigmaViewportBounds } from "./graphViewerV2Types";

// MouseCoords as emitted by Sigma's mouse captor: viewport pixel position plus
// the originating DOM event (for the Shift modifier) and the pan-suppression
// hook. Modeled narrowly so tests can supply plain objects.
type MouseCaptorPayload = {
  x: number;
  y: number;
  original?: { shiftKey?: boolean };
  preventSigmaDefault?: () => void;
};

type SigmaMouseCaptor = {
  on?: (event: string, handler: (payload: MouseCaptorPayload) => void) => void;
  off?: (event: string, handler: (payload: MouseCaptorPayload) => void) => void;
};

interface SigmaBoxSelectControllerOptions {
  getSigma: () => Sigma | null;
  getContainer: () => HTMLElement | null;
  // True while the toolbar toggle keeps region-select mode on. When enabled a
  // plain drag draws a box; otherwise a box is only drawn while Shift is held.
  isModeEnabled: () => boolean;
  onRegionSelected: (bounds: SigmaViewportBounds) => void;
  suppressNodeClicksFor?: (durationMs: number) => void;
}

export const BOX_SELECT_OVERLAY_CLASS = "sigma-box-select-overlay";
// A drag shorter than this (in viewport pixels) is treated as a click, not a
// box, so a stray shift-click does not fire an empty region selection.
const MIN_BOX_DRAG_PX = 3;

type Point = { x: number; y: number };

// Draws a rectangular selection overlay over the Sigma canvas and, on release,
// converts the two corners to graph-space bounds for a region read. Only active
// when region-select mode is enabled or the Shift modifier is held; while a box
// is being drawn camera panning is suppressed so the drag does not move the
// view.
export class SigmaBoxSelectController {
  private readonly options: SigmaBoxSelectControllerOptions;
  private overlay: HTMLDivElement | null = null;
  private startPoint: Point | null = null;
  private previousCameraPanningEnabled: boolean | null = null;
  private readonly boundMouseDown = (payload: MouseCaptorPayload) => {
    this.startBox(payload);
  };
  private readonly boundMouseMove = (payload: MouseCaptorPayload) => {
    this.updateBox(payload);
  };
  private readonly boundMouseUp = (payload: MouseCaptorPayload) => {
    this.endBox(payload);
  };

  constructor(options: SigmaBoxSelectControllerOptions) {
    this.options = options;
  }

  bind(): void {
    const mouseCaptor = this.mouseCaptor();
    mouseCaptor?.off?.("mousedown", this.boundMouseDown);
    mouseCaptor?.on?.("mousedown", this.boundMouseDown);
    mouseCaptor?.off?.("mousemovebody", this.boundMouseMove);
    mouseCaptor?.on?.("mousemovebody", this.boundMouseMove);
    mouseCaptor?.off?.("mouseup", this.boundMouseUp);
    mouseCaptor?.on?.("mouseup", this.boundMouseUp);
  }

  unbind(): void {
    const mouseCaptor = this.mouseCaptor();
    mouseCaptor?.off?.("mousedown", this.boundMouseDown);
    mouseCaptor?.off?.("mousemovebody", this.boundMouseMove);
    mouseCaptor?.off?.("mouseup", this.boundMouseUp);
    this.teardownBox();
  }

  reset(): void {
    this.teardownBox();
  }

  private mouseCaptor(): SigmaMouseCaptor | undefined {
    return this.options.getSigma()?.getMouseCaptor?.() as
      | SigmaMouseCaptor
      | undefined;
  }

  private isActivationAllowed(payload: MouseCaptorPayload): boolean {
    return (
      this.options.isModeEnabled() || payload.original?.shiftKey === true
    );
  }

  private startBox(payload: MouseCaptorPayload): void {
    const sigma = this.options.getSigma();
    const container = this.options.getContainer();
    if (!sigma || !container || !this.isActivationAllowed(payload)) {
      return;
    }

    this.startPoint = { x: payload.x, y: payload.y };
    this.previousCameraPanningEnabled = sigma.getSetting?.(
      "enableCameraPanning",
    ) as boolean | null;
    sigma.setSetting?.("enableCameraPanning", false);

    this.overlay = document.createElement("div");
    this.overlay.className = BOX_SELECT_OVERLAY_CLASS;
    this.overlay.style.position = "absolute";
    this.overlay.style.pointerEvents = "none";
    this.applyOverlayRect(this.startPoint, this.startPoint);
    container.appendChild(this.overlay);
    payload.preventSigmaDefault?.();
  }

  private updateBox(payload: MouseCaptorPayload): void {
    if (!this.startPoint || !this.overlay) {
      return;
    }
    this.applyOverlayRect(this.startPoint, { x: payload.x, y: payload.y });
    payload.preventSigmaDefault?.();
  }

  private endBox(payload: MouseCaptorPayload): void {
    const start = this.startPoint;
    const sigma = this.options.getSigma();
    if (!start || !sigma) {
      this.teardownBox();
      return;
    }

    const end = { x: payload.x, y: payload.y };
    const draggedFarEnough =
      Math.abs(end.x - start.x) >= MIN_BOX_DRAG_PX ||
      Math.abs(end.y - start.y) >= MIN_BOX_DRAG_PX;

    this.teardownBox();

    if (!draggedFarEnough) {
      return;
    }

    const startGraph = sigma.viewportToGraph(start);
    const endGraph = sigma.viewportToGraph(end);
    const bounds: SigmaViewportBounds = {
      xmin: Math.min(startGraph.x, endGraph.x),
      xmax: Math.max(startGraph.x, endGraph.x),
      ymin: Math.min(startGraph.y, endGraph.y),
      ymax: Math.max(startGraph.y, endGraph.y),
    };
    // A box release lands as a Sigma click on the canvas; suppress the node
    // click that would otherwise reset the selection panel.
    this.options.suppressNodeClicksFor?.(250);
    payload.preventSigmaDefault?.();
    this.options.onRegionSelected(bounds);
  }

  private applyOverlayRect(start: Point, end: Point): void {
    if (!this.overlay) {
      return;
    }
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    this.overlay.style.left = `${left}px`;
    this.overlay.style.top = `${top}px`;
    this.overlay.style.width = `${Math.abs(end.x - start.x)}px`;
    this.overlay.style.height = `${Math.abs(end.y - start.y)}px`;
  }

  private teardownBox(): void {
    const sigma = this.options.getSigma();
    if (typeof this.previousCameraPanningEnabled === "boolean") {
      sigma?.setSetting?.(
        "enableCameraPanning",
        this.previousCameraPanningEnabled,
      );
    }
    this.previousCameraPanningEnabled = null;
    this.startPoint = null;
    if (this.overlay?.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    this.overlay = null;
  }
}
