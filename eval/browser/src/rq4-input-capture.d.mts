export interface Rq4InputCaptureSpecification {
  eventType: "click" | "dblclick";
  nativeEventType: "click" | "dblclick";
  clickCount: number | null;
  clientX: number;
  clientY: number;
  coordinateTolerancePx?: number;
  targetClusterId: string | null;
}

export interface Rq4CapturedInput {
  eventType: "click" | "dblclick";
  nativeEventType: "click" | "dblclick";
  clickCount: number;
  capturePhase: true;
  timestamp: number;
  clientX: number;
  clientY: number;
  isTrusted: true;
  targetClusterId: string | null;
  stage: "graph-root";
}

export function matchesCaptureInput(
  event: MouseEvent,
  specification: Rq4InputCaptureSpecification,
  root: HTMLElement,
): boolean;

export function armCaptureInput(
  document: Document,
  root: HTMLElement,
  specification: Rq4InputCaptureSpecification,
  onCapture: (input: Rq4CapturedInput) => void,
): () => void;
