import type { GraphViewportResult } from './GraphViewportResult';

export type GraphViewportReadOptions = {
  readonly signal?: AbortSignal;
  /** Retain annotation references only for the exact immutable dataset/layout. */
  readonly annotationsFrom?: GraphViewportResult | null;
};
