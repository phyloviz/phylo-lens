import type Sigma from "sigma";

export interface SigmaViewportBounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export type SigmaCameraLike = {
  on?: (event: "updated", handler: () => void) => void;
  off?: (event: "updated", handler: () => void) => void;
  getState?: () => { x?: number; y?: number; ratio?: number; angle?: number };
  animatedReset?: (options?: { duration?: number }) => void;
  animate?: (state: { x: number; y: number; ratio: number }, options?: { duration?: number }) => void;
  ratio?: number;
};

export type SigmaNodeEvent = "clickNode" | "doubleClickNode";

export type SigmaViewportLike = Sigma & {
  on?: (event: SigmaNodeEvent, handler: (payload: { node?: string; event?: { node?: string } }) => void) => void;
  off?: (event: SigmaNodeEvent, handler: (payload: { node?: string; event?: { node?: string } }) => void) => void;
  getCamera: () => SigmaCameraLike;
  getDimensions?: () => { width: number; height: number };
  getContainer?: () => HTMLElement;
  viewportToGraph: (point: { x: number; y: number }) => { x: number; y: number };
  viewportToFramedGraph: (point: { x: number; y: number }) => { x: number; y: number };
  graphToViewport: (
    point: { x: number; y: number },
    options?: { cameraState?: { x: number; y: number; ratio: number; angle: number } },
  ) => { x: number; y: number };
  refresh?: () => void;
  scheduleRender?: () => void;
};
