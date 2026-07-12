import type Sigma from "sigma";

import type { SigmaViewportBounds } from "./graphViewerTypes";

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
export default function (options: SigmaBoxSelectControllerOptions) {
  let overlay: HTMLDivElement | null = null;
  let startPoint: Point | null = null;
  let previousCameraPanningEnabled: boolean | null = null;

  const boundMouseDown = (payload: MouseCaptorPayload) => {
    startBox(payload);
  };
  const boundMouseMove = (payload: MouseCaptorPayload) => {
    updateBox(payload);
  };
  const boundMouseUp = (payload: MouseCaptorPayload) => {
    endBox(payload);
  };

  return {
    bind: bind,
    unbind: unbind,
    reset: reset,
  };

  function bind(): void {
    const captor = mouseCaptor();
    captor?.off?.("mousedown", boundMouseDown);
    captor?.on?.("mousedown", boundMouseDown);
    captor?.off?.("mousemovebody", boundMouseMove);
    captor?.on?.("mousemovebody", boundMouseMove);
    captor?.off?.("mouseup", boundMouseUp);
    captor?.on?.("mouseup", boundMouseUp);
  }

  function unbind(): void {
    const captor = mouseCaptor();
    captor?.off?.("mousedown", boundMouseDown);
    captor?.off?.("mousemovebody", boundMouseMove);
    captor?.off?.("mouseup", boundMouseUp);
    teardownBox();
  }

  function reset(): void {
    teardownBox();
  }

  function mouseCaptor(): SigmaMouseCaptor | undefined {
    return options.getSigma()?.getMouseCaptor?.() as SigmaMouseCaptor | undefined;
  }

  function isActivationAllowed(payload: MouseCaptorPayload): boolean {
    return options.isModeEnabled() || payload.original?.shiftKey === true;
  }

  function startBox(payload: MouseCaptorPayload): void {
    const sigma = options.getSigma();
    const container = options.getContainer();
    if (!sigma || !container || !isActivationAllowed(payload)) {
      return;
    }

    startPoint = { x: payload.x, y: payload.y };
    previousCameraPanningEnabled = sigma.getSetting?.("enableCameraPanning") as boolean | null;
    sigma.setSetting?.("enableCameraPanning", false);

    overlay = document.createElement("div");
    overlay.className = BOX_SELECT_OVERLAY_CLASS;
    overlay.style.position = "absolute";
    overlay.style.pointerEvents = "none";
    applyOverlayRect(startPoint, startPoint);
    container.appendChild(overlay);
    payload.preventSigmaDefault?.();
  }

  function updateBox(payload: MouseCaptorPayload): void {
    if (!startPoint || !overlay) {
      return;
    }
    applyOverlayRect(startPoint, { x: payload.x, y: payload.y });
    payload.preventSigmaDefault?.();
  }

  function endBox(payload: MouseCaptorPayload): void {
    const start = startPoint;
    const sigma = options.getSigma();
    if (!start || !sigma) {
      teardownBox();
      return;
    }

    const end = { x: payload.x, y: payload.y };
    const draggedFarEnough =
      Math.abs(end.x - start.x) >= MIN_BOX_DRAG_PX || Math.abs(end.y - start.y) >= MIN_BOX_DRAG_PX;

    teardownBox();

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
    options.suppressNodeClicksFor?.(250);
    payload.preventSigmaDefault?.();
    options.onRegionSelected(bounds);
  }

  function applyOverlayRect(start: Point, end: Point): void {
    if (!overlay) {
      return;
    }
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${Math.abs(end.x - start.x)}px`;
    overlay.style.height = `${Math.abs(end.y - start.y)}px`;
  }

  function teardownBox(): void {
    const sigma = options.getSigma();
    if (typeof previousCameraPanningEnabled === "boolean") {
      sigma?.setSetting?.("enableCameraPanning", previousCameraPanningEnabled);
    }
    previousCameraPanningEnabled = null;
    startPoint = null;
    if (overlay?.parentElement) {
      overlay.parentElement.removeChild(overlay);
    }
    overlay = null;
  }
}
