import bootstrapClientShell from "./app/bootstrap";
import { runWhenDocumentReady } from "./app/clientBootstrap";

// Bootstrap immediately when Vite loads this module after DOMContentLoaded
// (for example after HMR), or wait when the document is still being parsed.
runWhenDocumentReady(bootstrapClientShell);
