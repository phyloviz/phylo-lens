import bootstrapClientShell from "./app/bootstrap";

// Bootstrap immediately when Vite loads this module after DOMContentLoaded
// (for example after HMR), or wait when the document is still being parsed.
const WINDOW_EVENT_DOM_READY = "DOMContentLoaded";

function runWhenDocumentReady(callback: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener(WINDOW_EVENT_DOM_READY, callback, { once: true });
    return;
  }

  callback();
}

runWhenDocumentReady(bootstrapClientShell);
