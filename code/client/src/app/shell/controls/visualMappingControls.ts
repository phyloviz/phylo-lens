import {
  DEFAULT_PROFILE_COUNT_FIELD,
  SIZE_SCALE_LINEAR,
  SIZE_SCALE_LOG,
  type SizeScale,
  type VisualMappingOptions,
} from "../../../render/mapping/visualMapping";

export function buildVisualMappingForControls(
  baseVisualMapping: VisualMappingOptions,
  fieldKeys: string[],
  sizeFieldKey: string | undefined,
  sizeScaleValue: string | undefined,
  categoryColors: Record<string, string> | undefined,
): VisualMappingOptions {
  const selectedFields = fieldKeys.map((field) => field.trim()).filter(Boolean);
  const mapping: VisualMappingOptions = { ...baseVisualMapping };
  const hasSizeControls = sizeFieldKey !== undefined || sizeScaleValue !== undefined;

  if (hasSizeControls || baseVisualMapping.size || baseVisualMapping.sizeField) {
    const selectedSizeField =
      sizeFieldKey?.trim() ||
      baseVisualMapping.size?.field ||
      baseVisualMapping.sizeField ||
      DEFAULT_PROFILE_COUNT_FIELD;
    mapping.size = {
      ...(baseVisualMapping.size ?? {}),
      field: selectedSizeField,
      scale: normalizeSizeScale(sizeScaleValue, baseVisualMapping.size?.scale),
    };
  }

  if (categoryColors && Object.keys(categoryColors).length > 0) {
    mapping.pie = {
      ...(mapping.pie ?? baseVisualMapping.pie ?? {}),
      categoryColors,
    };
  }

  if (selectedFields.length === 0) {
    return mapping;
  }

  return {
    ...mapping,
    // Selecting a pie field also drives the solid node fill, so the node, its
    // pie, and the wheel all colour by the same field/value.
    colorField: selectedFields[0],
    pie: {
      ...(mapping.pie ?? baseVisualMapping.pie ?? {}),
      enabled: true,
      fields: selectedFields,
    },
  };
}

function normalizeSizeScale(value: string | undefined, fallback: SizeScale | undefined): SizeScale {
  if (value === SIZE_SCALE_LOG) {
    return SIZE_SCALE_LOG;
  }
  if (value === SIZE_SCALE_LINEAR) {
    return SIZE_SCALE_LINEAR;
  }
  return fallback ?? SIZE_SCALE_LINEAR;
}
