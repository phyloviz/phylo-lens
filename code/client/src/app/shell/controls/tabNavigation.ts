/** Returns null when a key or the current focus does not belong to this tab group. */
export function tabIndexForKey(key: string, currentIndex: number, tabCount: number): number | null {
  if (currentIndex < 0 || currentIndex >= tabCount) return null;

  switch (key) {
    case 'ArrowRight':
      return (currentIndex + 1) % tabCount;
    case 'ArrowLeft':
      return (currentIndex + tabCount - 1) % tabCount;
    case 'Home':
      return 0;
    case 'End':
      return tabCount - 1;
    default:
      return null;
  }
}
