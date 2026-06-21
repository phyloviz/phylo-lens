export const WINDOW_EVENT_DOM_READY = "DOMContentLoaded";

export function runWhenDocumentReady(
  callback: () => void,
  documentRef: Document = document,
): void {
  if (documentRef.readyState === "loading") {
    documentRef.addEventListener(WINDOW_EVENT_DOM_READY, callback, {
      once: true,
    });
    return;
  }

  callback();
}
