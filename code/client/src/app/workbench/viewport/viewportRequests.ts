/** Own request generations, cancellation, and pending focus for one viewport. */
export class ViewportRequests {
  private generation = 0;
  private controller: AbortController | null = null;
  private pendingReads = 0;
  private focusGeneration: number | null = null;

  get hasPendingReads(): boolean {
    return this.pendingReads > 0;
  }

  isCurrent(sequence: number): boolean {
    return sequence === this.generation;
  }

  invalidate(): number {
    // Abort listeners may settle synchronously; revoke ownership first.
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    return this.generation;
  }

  beginRead(): { sequence: number; signal: AbortSignal; finish: () => void } {
    this.pendingReads += 1;
    const sequence = this.invalidate();
    const controller = new AbortController();
    this.controller = controller;
    return {
      sequence,
      signal: controller.signal,
      finish: () => {
        this.pendingReads -= 1;
        if (this.controller === controller) this.controller = null;
      },
    };
  }

  trackFocus(sequence: number): void {
    this.focusGeneration = sequence;
  }

  finishFocus(sequence: number): void {
    if (this.focusGeneration === sequence) this.focusGeneration = null;
  }

  cancelFocus(): void {
    if (this.focusGeneration === this.generation) this.invalidate();
    this.focusGeneration = null;
  }
}
