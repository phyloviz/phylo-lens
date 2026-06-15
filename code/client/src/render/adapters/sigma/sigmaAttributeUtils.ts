export function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function toPositiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

export function firstAttributeValue(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[],
): unknown {
  if (!attributes) {
    return undefined;
  }

  for (const key of keys) {
    const direct = attributes[key];
    if (direct !== undefined && direct !== null) {
      return direct;
    }

    const metadata = attributes.metadata;
    if (metadata && typeof metadata === "object") {
      const metadataValue = (metadata as Record<string, unknown>)[key];
      if (metadataValue !== undefined && metadataValue !== null) {
        return metadataValue;
      }
    }
  }

  return undefined;
}

export function isTruthyAttribute(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[],
): boolean {
  const value = firstAttributeValue(attributes, keys);
  return value === true || value === 1 || normalizeRoleValue(value) === "true";
}

export function normalizeRoleValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (
    normalized === "sub_group_founder" ||
    normalized === "sub_founder" ||
    normalized === "subgroup"
  ) {
    return "subgroup_founder";
  }
  if (normalized === "group_founder" || normalized === "founder") {
    return "group_founder";
  }
  if (normalized === "common_node") {
    return "common";
  }
  return normalized.replace(/^rule_0?/, "rule_");
}
