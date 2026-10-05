export interface GraphPrepareErrorDetailsDto {
  algorithm: string;
  stage: string;
  exit_status?: number | null;
  timeout_seconds?: number | null;
  stderr?: string | null;
  detail?: string | null;
}
