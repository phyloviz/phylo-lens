/** Preparation policy. Zero disables protection of small components. */
export type LodPreparationOptions = {
  readonly smallComponentThreshold?: number;
};

export const DEFAULT_SMALL_COMPONENT_THRESHOLD = 64;
