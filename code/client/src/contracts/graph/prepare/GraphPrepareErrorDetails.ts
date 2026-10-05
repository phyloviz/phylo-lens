export interface GraphPrepareErrorDetails {
  algorithm: string;
  stage: string;
  exitStatus?: number | null;
  timeoutSeconds?: number | null;
  stderr?: string | null;
  detail?: string | null;
}
