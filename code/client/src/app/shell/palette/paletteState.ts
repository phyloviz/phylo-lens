import { copyVisualMapping, type VisualMappingOptions } from '../../../render/mapping/visualMapping';
import type { PieCategoryGrouping } from '../../../render/mapping/pieMapping.types';

export type PaletteState = {
  readonly baseMapping: VisualMappingOptions;
  readonly mapping: VisualMappingOptions;
  readonly colors: Readonly<Record<string, string>>;
  readonly groupingByFields: Readonly<Record<string, PieCategoryGrouping>>;
};

export type PaletteAction =
  | { readonly kind: 'reset' }
  | { readonly kind: 'baseChanged'; readonly mapping: VisualMappingOptions; readonly fieldKey: string }
  | {
      readonly kind: 'controlsRead';
      readonly colors: Record<string, string>;
      readonly grouping: PieCategoryGrouping;
      readonly fieldKey: string;
    }
  | { readonly kind: 'colorsLoaded'; readonly colors: Record<string, string> }
  | { readonly kind: 'mappingApplied'; readonly mapping: VisualMappingOptions };

export function initialPaletteState(): PaletteState {
  return { baseMapping: {}, mapping: {}, colors: {}, groupingByFields: {} };
}

/** Base configuration and the last applied mapping are distinct; neither shares caller-owned records. */
export function reducePalette(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.kind) {
    case 'reset':
      return initialPaletteState();
    case 'baseChanged':
      return {
        baseMapping: copyVisualMapping(action.mapping),
        mapping: {},
        colors: { ...action.mapping.pie?.categoryColors },
        groupingByFields: {
          ...state.groupingByFields,
          [action.fieldKey]: { ...action.mapping.pie?.categoryGrouping },
        },
      };
    case 'controlsRead':
      return {
        ...state,
        colors: { ...state.colors, ...action.colors },
        groupingByFields: { ...state.groupingByFields, [action.fieldKey]: { ...action.grouping } },
      };
    case 'colorsLoaded':
      return { ...state, colors: { ...state.colors, ...action.colors } };
    case 'mappingApplied':
      return { ...state, mapping: copyVisualMapping(action.mapping) };
  }
  const unhandledAction: never = action;
  throw new Error(`Unhandled action: ${JSON.stringify(unhandledAction)}`);
}
