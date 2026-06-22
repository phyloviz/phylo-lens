from __future__ import annotations

from dataclasses import replace
import time

from phylo_lens_server.clustering.force_directed import apply_force_directed_layout_if_needed
from phylo_lens_server.clustering.threshold_hierarchy import (
    ThresholdHierarchyBuildError,
    ThresholdHierarchyBuildStats,
    build_threshold_hierarchy,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    PrepareDatasetResult,
    PrepareDatasetStats,
    PreparedDatasetRecord,
    ThresholdHierarchyIndex,
)
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.store import DatasetStore
from phylo_lens_server.services.search_index import build_prepared_search_index

ERR_THRESHOLD_ONLY_PREPARE = (
    "Prepare currently supports only weighted datasets with distances for the "
    "distance-threshold hierarchy path."
)
WARN_UNIT_DISTANCE_ASSIGNED = (
    "Missing edge distances were assigned a unit distance for LoD preparation."
)

DEFAULT_ROUND_DECIMALS = 3
UNIT_DISTANCE = 1.0


def prepare_dataset_for_lod(
    request: NormalizeRequest,
    store: DatasetStore,
) -> PrepareDatasetResult:
    """Normalize, build the LoD hierarchy, and persist the prepared dataset."""
    normalized = normalize_dataset(request, expose_internal_schema=True)

    hierarchy_start = time.perf_counter()
    prepared_dataset, distance_warnings = ensure_prepare_edge_distances(
        normalized.dataset,
    )
    warnings = [*normalized.warnings, *distance_warnings]
    prepared_dataset, hierarchy, hierarchy_stats = build_prepared_hierarchy(
        prepared_dataset,
    )
    hierarchy_ms = elapsed_ms(hierarchy_start)

    record = PreparedDatasetRecord(
        dataset=prepared_dataset,
        hierarchy=hierarchy,
        warnings=warnings,
        search_index=build_prepared_search_index(prepared_dataset),
    )

    store_start = time.perf_counter()
    store.save(record)
    store_ms = elapsed_ms(store_start)

    return PrepareDatasetResult(
        dataset_id=prepared_dataset.dataset_id,
        stats=PrepareDatasetStats(
            node_count=len(prepared_dataset.nodes),
            edge_count=len(prepared_dataset.edges),
            ingest_ms=normalized.stats.ingest_ms,
            normalize_ms=normalized.stats.normalize_ms,
            hierarchy_ms=round(hierarchy_ms, DEFAULT_ROUND_DECIMALS),
            topology_ms=hierarchy_stats.topology_ms,
            thresholds_ms=hierarchy_stats.thresholds_ms,
            components_ms=hierarchy_stats.components_ms,
            layout_ms=hierarchy_stats.layout_ms,
            cluster_ms=hierarchy_stats.cluster_ms,
            geometry_ms=hierarchy_stats.geometry_ms,
            spatial_index_ms=hierarchy_stats.spatial_index_ms,
            store_ms=round(store_ms, DEFAULT_ROUND_DECIMALS),
        ),
        warnings=warnings,
    )


def build_prepared_hierarchy(
    dataset: CanonicalDataset,
) -> tuple[CanonicalDataset, ThresholdHierarchyIndex, ThresholdHierarchyBuildStats]:
    if not dataset.edges or any(edge.distance is None for edge in dataset.edges):
        raise ThresholdHierarchyBuildError(ERR_THRESHOLD_ONLY_PREPARE)

    layout_start = time.perf_counter()
    dataset_with_layout = apply_force_directed_layout_if_needed(dataset)
    layout_ms = elapsed_ms(layout_start)
    hierarchy, stats = build_threshold_hierarchy(dataset_with_layout)
    return dataset_with_layout, hierarchy, replace(stats, layout_ms=layout_ms)


def ensure_prepare_edge_distances(
    dataset: CanonicalDataset,
) -> tuple[CanonicalDataset, list[str]]:
    # Only infer distances when no edge has an explicit distance.
    if not dataset.edges or any(edge.distance is not None for edge in dataset.edges):
        return dataset, []

    return (
        dataset.model_copy(
            update={
                "edges": [
                    CanonicalEdge(
                        id=edge.id,
                        source=edge.source,
                        target=edge.target,
                        distance=UNIT_DISTANCE,
                    )
                    for edge in dataset.edges
                ],
            }
        ),
        [WARN_UNIT_DISTANCE_ASSIGNED],
    )


def elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000
