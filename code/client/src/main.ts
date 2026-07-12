import bootstrapClientShell from "./app/bootstrap";

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

// Bootstrap immediately when Vite loads this module after DOMContentLoaded
// (for example after HMR), or wait when the document is still being parsed.
runWhenDocumentReady(bootstrapClientShell);
