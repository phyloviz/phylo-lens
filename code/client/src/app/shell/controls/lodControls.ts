import type { PositionedGraph } from '../../../contracts/positioned';

export function updateLodRefreshControl({
  input,
  lodAvailable,
  paused,
}: {
  input: HTMLInputElement | undefined;
  lodAvailable: boolean;
  paused: boolean;
}): void {
  if (!input) return;
  input.disabled = !lodAvailable;
  input.checked = !paused;
}

export function isLodGraph(graph: PositionedGraph | null): boolean {
  return typeof graph?.viewMeta.sliceNodeCount === 'number';
}

export function parseMaxNodes(value: string | undefined): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.round(parsed);
}
