export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isString(value);
}

export function isOptionalBoolean(value: unknown): value is boolean | null | undefined {
  return value === undefined || value === null || isBoolean(value);
}

export function isOptionalFiniteNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || isFiniteNumber(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

export function hasFiniteNumberFields(value: unknown, keys: readonly string[]): value is Record<string, number> {
  return isRecord(value) && keys.every((key) => isFiniteNumber(value[key]));
}

export function isOptionalNumberRecord(value: unknown): value is Record<string, number> | null | undefined {
  if (value === undefined || value === null) {
    return true;
  }

  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}
