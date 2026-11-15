import type { ClusterId } from '../../../contracts/graph/graphIdentifiers';
import type { GraphComponent } from '../../../contracts/graph/components';
import type { RenderCameraState } from '../../../render/renderer.types';
import type { ManualBranches } from './manualBranches';

export type SavedTreePanel = {
  readonly camera: RenderCameraState | null;
  readonly folds: ManualBranches;
  readonly keepExpanded: boolean;
  readonly allExpanded: boolean;
  readonly expansionLodLevel: number | undefined;
  readonly viewLodLevel: number;
  readonly expandedClusterIds: readonly ClusterId[];
};

type TreePanelSelection = {
  readonly sequence: number;
  readonly component: GraphComponent | null;
  readonly saved: SavedTreePanel | undefined;
};

/** Retain interaction state per tree; inactive panels hold no response payloads. */
export class TreePanels {
  private active: GraphComponent | null = null;
  private switchSequence: number | null = null;
  private readonly saved = new Map<string | null, SavedTreePanel>();

  get component(): GraphComponent | null {
    return this.active;
  }

  get switching(): boolean {
    return this.switchSequence !== null;
  }

  begin(component: GraphComponent | null, sequence: number, current: SavedTreePanel): TreePanelSelection {
    if (!this.switching) this.saved.set(this.active?.id ?? null, current);
    this.switchSequence = sequence;
    const next = component && { ...component, bounds: { ...component.bounds } };
    return { sequence, component: next, saved: this.saved.get(next?.id ?? null) };
  }

  activate(selection: TreePanelSelection): void {
    if (this.switchSequence !== selection.sequence) throw new Error('Tree panel selection was superseded.');
    this.active = selection.component;
  }

  finish(sequence: number): void {
    // A stale response must not release a more recent panel switch.
    if (this.switchSequence === sequence) this.switchSequence = null;
  }

  clear(): void {
    this.saved.clear();
    this.active = null;
    this.switchSequence = null;
  }

  resetOrientation(component: GraphComponent | null): void {
    this.clear();
    this.active = component;
  }
}
