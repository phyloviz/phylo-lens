import {
  CATEGORY_COUNT_FIELD_PREFIX,
  CATEGORY_COUNT_FIELD_SEPARATOR,
  PIE_ATTRIBUTE_PREFIX,
  PIE_FIELD_VALUE_SEPARATOR,
  type AncillaryRow,
  type CategoryCountEntry,
  type MetadataRecord,
} from "./pieMapping.types";

export function categoricalPieValues(value: string | number | boolean | null | undefined): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value !== "string") {
    return [String(value)];
  }

  const parts = value
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return [value.trim()].filter((part) => part.length > 0);
  }

  return [...new Set(parts)];
}

export function pieCategoricalAttributeKey(fieldKey: string, value: string): string {
  return `${PIE_ATTRIBUTE_PREFIX}${safeAttributeToken(fieldKey)}${PIE_FIELD_VALUE_SEPARATOR}${safeAttributeToken(value)}`;
}

export function categoryCountsForField(metadata: MetadataRecord, fieldKey: string): CategoryCountEntry[] {
  return Object.entries(metadata)
    .map(([key, value]) => parseCategoryCountMetadataEntry(key, value))
    .filter((entry): entry is CategoryCountEntry => entry !== null && entry.fieldKey === fieldKey)
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

export function categoryCountsForFieldCombination(rows: AncillaryRow[], fieldKeys: string[]): CategoryCountEntry[] {
  const selectedFields = fieldKeys.map((fieldKey) => fieldKey.trim()).filter(Boolean);
  if (selectedFields.length <= 1 || rows.length === 0) {
    return [];
  }

  const fieldKey = combinationPieFieldKey(selectedFields);
  const countsByCategory = new Map<string, number>();
  rows.forEach((row) => {
    combinationLabelsForRow(row, selectedFields).forEach((category) => {
      countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
    });
  });

  return [...countsByCategory.entries()]
    .map(([category, count]) => ({
      fieldKey,
      category,
      count,
    }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

export function combinationPieFieldKey(fieldKeys: string[]): string {
  return fieldKeys
    .map((fieldKey) => fieldKey.trim())
    .filter(Boolean)
    .join(" + ");
}

export function isCategoryCountMetadataKey(key: string): boolean {
  return parseCategoryCountMetadataKey(key) !== null;
}

export function parseCategoryCountMetadataEntry(
  key: string,
  value: string | number | boolean | null,
): CategoryCountEntry | null {
  const parsedKey = parseCategoryCountMetadataKey(key);
  if (!parsedKey || typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) {
    return null;
  }

  return {
    ...parsedKey,
    count: value,
  };
}

function combinationLabelsForRow(row: AncillaryRow, fieldKeys: string[]): string[] {
  const valuesByField = fieldKeys.map((fieldKey) => {
    const values = categoricalPieValues(row[fieldKey]);
    return values.map((value) => `${fieldKey}:${value}`);
  });

  if (valuesByField.some((values) => values.length === 0)) {
    return [];
  }

  return valuesByField.reduce<string[]>(
    (combinations, values) =>
      combinations.flatMap((combination) =>
        values.map((value) => (combination.length > 0 ? `${combination} ${value}` : value)),
      ),
    [""],
  );
}

function parseCategoryCountMetadataKey(key: string): Omit<CategoryCountEntry, "count"> | null {
  if (!key.startsWith(CATEGORY_COUNT_FIELD_PREFIX)) {
    return null;
  }

  const withoutPrefix = key.slice(CATEGORY_COUNT_FIELD_PREFIX.length);
  const separatorIndex = withoutPrefix.indexOf(CATEGORY_COUNT_FIELD_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }

  const encodedField = withoutPrefix.slice(0, separatorIndex);
  const encodedCategory = withoutPrefix.slice(separatorIndex + CATEGORY_COUNT_FIELD_SEPARATOR.length);

  try {
    return {
      fieldKey: decodeURIComponent(encodedField),
      category: decodeURIComponent(encodedCategory),
    };
  } catch {
    return null;
  }
}

function safeAttributeToken(value: string): string {
  const readableToken = value
    .trim()
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${readableToken || "blank"}_${hashString(value)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
