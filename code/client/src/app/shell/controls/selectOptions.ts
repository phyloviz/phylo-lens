export function getSelectedOptions(select: HTMLSelectElement | undefined): string[] {
  if (!select) {
    return [];
  }

  return [...select.selectedOptions].map((option) => option.value).filter((value) => value.trim().length > 0);
}
