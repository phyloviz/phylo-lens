export const GraphPrepareJobStatus = {
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
} as const;

export type GraphPrepareJobStatus = (typeof GraphPrepareJobStatus)[keyof typeof GraphPrepareJobStatus];

export const GraphLayoutStatus = {
  PENDING: "pending",
  REFINING: "refining",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed",
} as const;

export type GraphLayoutStatus = (typeof GraphLayoutStatus)[keyof typeof GraphLayoutStatus];
