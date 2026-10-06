export type GraphPrepareErrorDetails = {
  readonly algorithm: string;
  readonly stage: string;
  readonly exitStatus?: number | null;
  readonly timeoutSeconds?: number | null;
  readonly stderr?: string | null;
  readonly detail?: string | null;
};
