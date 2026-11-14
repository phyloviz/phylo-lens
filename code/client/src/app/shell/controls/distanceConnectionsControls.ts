import type { SourceFormat } from '../../../contracts/models';
import type { PositionedGraph } from '../../../contracts/positioned';
import type { GraphWorkbench } from '../../workbench/graphWorkbench.types';
import eventBindings from '../events/eventBindings';

export type DistanceConnectionsElements = {
  readonly connectionThreshold?: HTMLInputElement;
  readonly connectionLimit?: HTMLInputElement;
  readonly applyConnections?: HTMLButtonElement;
  readonly clearConnections?: HTMLButtonElement;
  readonly connectionMetric?: HTMLElement;
  readonly connectionHeading?: HTMLElement;
  readonly connectionThresholdLabel?: HTMLElement;
  readonly connectionFeedback?: HTMLElement;
};

export function distanceConnectionsControls(
  workbench: Pick<GraphWorkbench, 'setDistanceConnections'>,
  elements: DistanceConnectionsElements
) {
  const bindings = eventBindings();
  let ready = false;
  let busy = false;
  let failure: string | null = null;
  let sequence = 0;
  let sourceFormat: SourceFormat | null = null;
  let graph: PositionedGraph | null = null;

  function update(): void {
    if (elements.applyConnections) elements.applyConnections.disabled = !ready || busy;
    if (elements.clearConnections) elements.clearConnections.disabled = !ready;
    if (elements.connectionThreshold) {
      elements.connectionThreshold.disabled = !ready;
      elements.connectionThreshold.step = sourceFormat === 'typing_data' ? '1' : 'any';
    }
    if (elements.connectionLimit) elements.connectionLimit.disabled = !ready;
    let heading = 'Distance connections (nLV for profiles)';
    let label = 'Maximum pairwise distance';
    let metric = 'Load a dataset to see its distance metric.';
    switch (sourceFormat) {
      case 'typing_data':
        heading = 'nLV connections — link profiles';
        label = 'nLV level (maximum differing loci)';
        metric =
          'Allelic distance: nLV means n-locus variant. A level of 2 connects profiles differing at no more than 2 retained loci. Uses the same missing-locus policy as tree preparation.';
        break;
      case 'newick':
        heading = 'Tree-path connections';
        label = 'Maximum tree-path distance';
        metric =
          'Tree-path distance: sum of branch lengths between named Newick nodes. Units come from the input; this is not an nLV level or an inferred allelic distance.';
        break;
    }
    if (elements.connectionHeading) elements.connectionHeading.textContent = heading;
    if (elements.connectionThresholdLabel) elements.connectionThresholdLabel.textContent = label;
    if (elements.connectionMetric) elements.connectionMetric.textContent = metric;
  }

  function refresh(next: PositionedGraph | null): void {
    graph = next;
    if (busy || !elements.connectionFeedback) return;
    if (failure !== null) {
      elements.connectionFeedback.textContent = failure;
      return;
    }
    const connections = graph?.viewMeta.distanceConnections;
    elements.connectionFeedback.textContent = connections
      ? `${connections.visibleCount} of ${connections.totalCount} additional connections visible at distance ≤ ${connections.threshold}. Grouped or hidden endpoints are omitted.`
      : 'No additional connections. Original tree edges are kept.';
  }

  async function apply(): Promise<void> {
    if (!ready || busy) return;
    const current = ++sequence;
    failure = null;
    try {
      const raw = elements.connectionThreshold?.value.trim();
      const threshold = raw ? Number(raw) : NaN;
      const limit = Number(elements.connectionLimit?.value ?? '50000');
      if (
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        (sourceFormat === 'typing_data' && !Number.isSafeInteger(threshold))
      )
        throw new Error(
          sourceFormat === 'typing_data'
            ? 'Enter a nonnegative whole number of differing loci.'
            : 'Enter a finite nonnegative tree-path distance.'
        );
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error('Connection limit must be a positive whole number.');
      busy = true;
      update();
      if (elements.connectionFeedback) elements.connectionFeedback.textContent = 'Computing additional connections…';
      const next = await workbench.setDistanceConnections({ threshold, maxConnections: limit });
      if (current !== sequence) return;
      graph = next;
    } catch (error) {
      if (current === sequence) failure = error instanceof Error ? error.message : String(error);
    } finally {
      if (current === sequence) {
        busy = false;
        update();
        refresh(graph);
      }
    }
  }

  async function clear(): Promise<void> {
    if (!ready) return;
    const current = ++sequence;
    busy = false;
    failure = null;
    update();
    try {
      const next = await workbench.setDistanceConnections(null);
      if (current === sequence) refresh(next);
    } catch (error) {
      if (current === sequence) {
        failure = error instanceof Error ? error.message : String(error);
        refresh(graph);
      }
    }
  }

  return {
    mount() {
      bindings.on(elements.applyConnections, 'click', () => void apply());
      bindings.on(elements.clearConnections, 'click', () => void clear());
      update();
    },
    setSource(format: SourceFormat | null) {
      ++sequence;
      sourceFormat = format;
      ready = format !== null;
      busy = false;
      failure = null;
      refresh(null);
      update();
    },
    refresh,
    unmount() {
      ++sequence;
      bindings.clear();
    },
  };
}
