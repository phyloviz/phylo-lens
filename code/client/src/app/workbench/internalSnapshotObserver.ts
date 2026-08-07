import type { PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer, RenderViewportSyncState } from "../../render/renderer.types";

// Internal diagnostics channel for evaluation tooling. This is deliberately not
// exported from the package entry point and is not a supported library API.
export const INTERNAL_SNAPSHOT_APPLIED_OBSERVER = Symbol.for("@phyloviz/phylo-lens.internal.snapshot-applied.v1");

export type SnapshotApplicationReason = "initial_load" | "viewport_sync" | "cluster_expand" | "cluster_collapse";

export interface SnapshotAggregateTarget {
  clusterId: string;
  representedNodeCount: number;
  clientX: number;
  clientY: number;
  structuralFingerprint: string;
}

export interface SnapshotAppliedBoundary {
  sequence: number;
  reason: SnapshotApplicationReason;
  datasetId: string;
  layoutVersion: string | null;
  clusterId: string | null;
  visibleNodeCount: number;
  visibleEdgeCount: number;
  visiblePrimitiveCount: number;
}

export interface SnapshotAppliedDiagnostics {
  visibleAggregateTriangleCount: number;
  snapshotFingerprint: string;
  viewport: RenderViewportSyncState | null;
  aggregateTargets: readonly SnapshotAggregateTarget[];
}

// The callback receives the O(1) application boundary first. Evaluation code
// records t3 immediately, then calls readDiagnostics for size-dependent data.
export type SnapshotAppliedObserver = (
  boundary: SnapshotAppliedBoundary,
  readDiagnostics: () => SnapshotAppliedDiagnostics | null,
) => void;

type ObserverContainer = HTMLElement & {
  [INTERNAL_SNAPSHOT_APPLIED_OBSERVER]?: unknown;
};

export function snapshotAppliedObserverForContainer(container: HTMLElement): SnapshotAppliedObserver | undefined {
  try {
    const observer = (container as ObserverContainer)[INTERNAL_SNAPSHOT_APPLIED_OBSERVER];
    return typeof observer === "function" ? (observer as SnapshotAppliedObserver) : undefined;
  } catch {
    // Diagnostics discovery must never affect normal view construction.
    return undefined;
  }
}

export function notifySnapshotApplied({
  observer,
  sequence,
  reason,
  datasetId,
  layoutVersion,
  clusterId = null,
  graph,
  renderer,
}: {
  observer: SnapshotAppliedObserver | undefined;
  sequence: number;
  reason: SnapshotApplicationReason;
  datasetId: string;
  layoutVersion: string | null | undefined;
  clusterId?: string | null;
  graph: PositionedGraph;
  renderer: GraphRenderer;
}): void {
  if (!observer) return;

  const boundary = Object.freeze({
    sequence,
    reason,
    datasetId,
    layoutVersion: layoutVersion ?? null,
    clusterId,
    visibleNodeCount: graph.nodes.length,
    visibleEdgeCount: graph.edges.length,
    visiblePrimitiveCount: graph.nodes.length + graph.edges.length,
  });
  let diagnostics: Omit<SnapshotAppliedDiagnostics, "viewport"> | null | undefined;

  const readDiagnostics = (): SnapshotAppliedDiagnostics | null => {
    if (diagnostics === undefined) {
      try {
        const aggregateTargets = Object.freeze(
          aggregateTargetDescriptors(graph, renderer.getInteractiveAggregateTargets?.() ?? []).map((target) =>
            Object.freeze(target),
          ),
        );
        diagnostics = Object.freeze({
          visibleAggregateTriangleCount: graph.nodes.filter((node) => node.attributes?.type === "triangle").length,
          snapshotFingerprint: snapshotFingerprint(graph),
          aggregateTargets,
        });
      } catch {
        // Diagnostics construction is strictly observational.
        diagnostics = null;
      }
    }
    return (
      diagnostics &&
      Object.freeze({
        ...diagnostics,
        viewport: immutableViewport(renderer.getViewportSyncState?.() ?? null),
      })
    );
  };

  try {
    observer(boundary, readDiagnostics);
  } catch {
    // Callback failures must not alter client control flow or rendering.
  }
}

function aggregateTargetDescriptors(
  graph: PositionedGraph,
  targets: readonly Omit<SnapshotAggregateTarget, "structuralFingerprint">[],
): SnapshotAggregateTarget[] {
  const targetIds = new Set(targets.map((target) => target.clusterId));
  const incidentEdges = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (targetIds.has(edge.source)) {
      incidentEdges.set(edge.source, [...(incidentEdges.get(edge.source) ?? []), edge.id]);
    }
    if (targetIds.has(edge.target) && edge.target !== edge.source) {
      incidentEdges.set(edge.target, [...(incidentEdges.get(edge.target) ?? []), edge.id]);
    }
  }
  return targets.map((target) => ({
    ...target,
    structuralFingerprint: fingerprint([
      `n:${target.clusterId}:${target.representedNodeCount}`,
      ...(incidentEdges.get(target.clusterId) ?? []).sort().map((edge) => `e:${edge}`),
    ]),
  }));
}

function immutableViewport(viewport: RenderViewportSyncState | null): RenderViewportSyncState | null {
  if (!viewport) return null;
  return Object.freeze({
    bounds: Object.freeze({ ...viewport.bounds }),
    cameraRatio: viewport.cameraRatio,
  });
}

function snapshotFingerprint(graph: PositionedGraph): string {
  const identifiers = [
    ...graph.nodes.map((node) => `n:${node.id}`).sort(),
    ...graph.edges.map((edge) => `e:${edge.id}:${edge.source}:${edge.target}`).sort(),
  ];
  return fingerprint(identifiers);
}

function fingerprint(identifiers: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const identifier of identifiers) {
    for (let index = 0; index < identifier.length; index += 1) {
      hash ^= identifier.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
