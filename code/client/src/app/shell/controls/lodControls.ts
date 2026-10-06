import type { PositionedGraph } from '../../../contracts/positioned';

export function updateLodPlaybackControls({
  playButton,
  pauseButton,
  lodAvailable,
  paused,
}: {
  playButton: HTMLButtonElement | undefined;
  pauseButton: HTMLButtonElement | undefined;
  lodAvailable: boolean;
  paused: boolean;
}): void {
  if (playButton) {
    playButton.disabled = !lodAvailable || !paused;
    playButton.setAttribute('aria-pressed', String(!paused));
  }

  if (pauseButton) {
    pauseButton.disabled = !lodAvailable || paused;
    pauseButton.setAttribute('aria-pressed', String(paused));
  }
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
