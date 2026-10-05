import type { GraphPrepareStatus } from "./GraphPrepareStatus";

export interface GraphPrepareOptions {
  onPending?: (status: GraphPrepareStatus) => void;
  pollIntervalMs?: number;
  // Optional host-side wait limit. The default is unlimited so a valid global
  // `sfdp` preparation is not abandoned merely because it is expensive.
  pollTimeoutMs?: number | null;
  sleep?: (ms: number) => Promise<void>;
}
