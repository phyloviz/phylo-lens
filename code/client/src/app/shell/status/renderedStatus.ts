import { readNodeAnnotations } from '../../../ancillary/ancillaryAccess';
import type { PositionedGraph } from '../../../contracts/positioned';

export const STATUS_RENDERED_PREFIX = 'Rendered';
// Degraded is retained only when reading a layout created by an earlier service
// version; current preparation never silently substitutes a fallback layout.
export const STATUS_DEGRADED_LAYOUT_WARNING = '⚠ This stored layout was prepared by an earlier service version';

export function buildRenderedStatus(graph: PositionedGraph): string {
  const parts = [
    `${graph.nodes.length} visible ${graph.nodes.length === 1 ? 'node' : 'nodes'}`,
    `${graph.edges.length} edges`,
    detailLevelLabel(graph),
  ];
  const isolateCounts = graph.nodes.map(node => {
    return readNodeAnnotations(node.attributes).profileSummary.isolateCount;
  });
  if (
    isolateCounts.length > 0 &&
    isolateCounts.every(
      (count): count is number => typeof count === 'number' && Number.isSafeInteger(count) && count > 0
    )
  ) {
    parts.push(`${isolateCounts.reduce((sum, count) => sum + count, 0)} isolates represented`);
  }

  const status = `${STATUS_RENDERED_PREFIX}: ${parts.join(', ')}`;
  const warnings = statusWarnings(graph);
  return warnings.length > 0 ? `${status} — ${warnings.join(' — ')}` : status;
}

function statusWarnings(graph: PositionedGraph): string[] {
  const warnings: string[] = [];
  const prepareWarning = graph.viewMeta.layoutWarnings?.find(warning => warning.trim().length > 0);
  if (prepareWarning) {
    // The complete locus list stays in layoutWarnings/the prepare response.
    // Keep the status useful even for datasets excluding thousands of loci,
    // including responses cached before the compact status was introduced.
    const locusList = prepareWarning.indexOf(' Excluded loci:');
    warnings.push(
      prepareWarning.startsWith('Excluded ') && locusList >= 0 ? prepareWarning.slice(0, locusList) : prepareWarning
    );
  }
  if (graph.viewMeta.layoutStatus === 'degraded' && !isLayoutWarning(prepareWarning)) {
    warnings.push(STATUS_DEGRADED_LAYOUT_WARNING);
  }
  return warnings;
}

function isLayoutWarning(warning: string | undefined): boolean {
  if (!warning) {
    return false;
  }
  const normalized = warning.toLowerCase();
  return normalized.includes('graphviz') || normalized.includes('layout');
}

// Keep semantic detail changes visible without exposing viewport request diagnostics.
function detailLevelLabel(graph: PositionedGraph): string {
  const tierCount = graph.viewMeta.lodTierCount;
  if (typeof tierCount === 'number' && tierCount > 0) {
    const tier = Math.min(graph.viewMeta.lodLevel + 1, tierCount);
    return `detail level ${tier}/${tierCount}`;
  }
  return `detail level ${graph.viewMeta.lodLevel + 1}`;
}
