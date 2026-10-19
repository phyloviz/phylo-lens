import { copyVisualMapping, type VisualMappingOptions } from '../../../render/mapping/visualMapping';
import type { PieCategoryGrouping } from '../../../render/mapping/pieMapping.types';

export type PaletteState = {
  readonly baseMapping: VisualMappingOptions;
  readonly mapping: VisualMappingOptions;
  readonly colorsByFields: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly groupingByFields: Readonly<Record<string, PieCategoryGrouping>>;
};

export type PaletteAction =
  | { readonly kind: 'reset' }
  | { readonly kind: 'resetColors' }
  | { readonly kind: 'baseChanged'; readonly mapping: VisualMappingOptions; readonly fieldKey: string }
  | {
      readonly kind: 'controlsRead';
      readonly colors: Record<string, string>;
      readonly grouping: PieCategoryGrouping;
      readonly fieldKey: string;
    }
  | { readonly kind: 'colorsLoaded'; readonly colors: Record<string, string>; readonly fieldKey: string }
  | { readonly kind: 'mappingApplied'; readonly mapping: VisualMappingOptions };

export function initialPaletteState(): PaletteState {
  return { baseMapping: {}, mapping: {}, colorsByFields: {}, groupingByFields: {} };
}

/** Base configuration and the last applied mapping are distinct; neither shares caller-owned records. */
export function reducePalette(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.kind) {
    case 'reset':
      return initialPaletteState();
    case 'resetColors': {
      const withoutColors = (mapping: VisualMappingOptions): VisualMappingOptions => {
        const copy = { ...mapping };
        delete copy.palette;
        if (copy.pie) {
          const pie = { ...copy.pie };
          delete pie.palette;
          delete pie.categoryColors;
          copy.pie = pie;
        }
        return copyVisualMapping(copy);
      };
      return {
        ...state,
        baseMapping: withoutColors(state.baseMapping),
        mapping: withoutColors(state.mapping),
        colorsByFields: {},
      };
    }
    case 'baseChanged':
      return {
        baseMapping: copyVisualMapping(action.mapping),
        mapping: {},
        colorsByFields: { [action.fieldKey]: { ...action.mapping.pie?.categoryColors } },
        groupingByFields: {
          ...state.groupingByFields,
          [action.fieldKey]: { ...action.mapping.pie?.categoryGrouping },
        },
      };
    case 'controlsRead':
      return {
        ...state,
        colorsByFields: {
          ...state.colorsByFields,
          [action.fieldKey]: { ...state.colorsByFields[action.fieldKey], ...action.colors },
        },
        groupingByFields: { ...state.groupingByFields, [action.fieldKey]: { ...action.grouping } },
      };
    case 'colorsLoaded':
      return {
        ...state,
        colorsByFields: {
          ...state.colorsByFields,
          [action.fieldKey]: { ...state.colorsByFields[action.fieldKey], ...action.colors },
        },
      };
    case 'mappingApplied':
      return { ...state, mapping: copyVisualMapping(action.mapping) };
  }
  const unhandledAction: never = action;
  throw new Error(`Unhandled action: ${JSON.stringify(unhandledAction)}`);
}
