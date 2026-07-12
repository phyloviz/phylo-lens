import type { PieMappingOptions } from "../../../mapping/pieMapping";
import type { SizeScale } from "../../../mapping/visualMapping";

export interface ResolvedViewportVisuals {
  colorField: string;
  sizeField: string;
  scale: SizeScale;
  palette: string[];
  // Frequency-ranked value -> colour resolver for colorField, built once over
  // all viewport nodes so every node fill (and the pies/wheels that mirror it)
  // share the same assignment. The most common value takes palette[0].
  colorForValue: (value: string | number | boolean | null | undefined) => string;
  numericStats?: { min: number; max: number };
  // Present only when an explicit pie mapping is active for this viewport.
  pie?: PieMappingOptions;
}
