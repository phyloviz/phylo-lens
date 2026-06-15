import type { PositionedGraph } from "../../../contracts/positioned";

export const DEFAULT_MAX_NODES = 4000;
export const DEFAULT_INITIAL_ZOOM = 4;

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
    playButton.setAttribute("aria-pressed", String(!paused));
  }

  if (pauseButton) {
    pauseButton.disabled = !lodAvailable || paused;
    pauseButton.setAttribute("aria-pressed", String(paused));
  }
}

export function isLodGraph(graph: PositionedGraph | null): boolean {
  return typeof graph?.viewMeta.sliceNodeCount === "number";
}

export function parseMaxNodes(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10) {
    return DEFAULT_MAX_NODES;
  }
  return Math.round(parsed);
}

export function parseInitialZoom(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INITIAL_ZOOM;
  }
  return parsed;
}
