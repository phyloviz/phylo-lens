const HIGH_CARDINALITY_PIE_FIELD_THRESHOLD = 24;

export function formatPieFieldOption(summary: { key: string; uniqueValueCount: number }): string {
  const suffix =
    summary.uniqueValueCount > HIGH_CARDINALITY_PIE_FIELD_THRESHOLD
      ? "many values"
      : `${summary.uniqueValueCount} values`;
  return `${summary.key} (${suffix})`;
}
