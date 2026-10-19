import type { GraphDisplayOptions } from '../renderer.types';

export function showsDistanceLabel(distance: unknown, display?: GraphDisplayOptions): distance is number {
  return (
    display?.edgeDistanceLabels === true &&
    typeof distance === 'number' &&
    Number.isFinite(distance) &&
    (display.edgeDistanceLabelMin === undefined || distance >= display.edgeDistanceLabelMin) &&
    (display.edgeDistanceLabelMax === undefined || distance <= display.edgeDistanceLabelMax)
  );
}

/** Fixed distance mapping: unit edges are black; increasing weights approach light gray. */
export function distanceEdgeColor(distance: unknown, fallback: string): string {
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) return fallback;
  const channel = Math.round(200 - 200 / Math.max(1, distance));
  const hex = channel.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}
