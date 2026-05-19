import bootstrapClientShell from "./app/bootstrap";

export const WINDOW_EVENT_DOM_READY = "DOMContentLoaded";

// Bootstrap the demo shell once the page DOM is ready.
document.addEventListener(WINDOW_EVENT_DOM_READY, () => {
  bootstrapClientShell();
});
