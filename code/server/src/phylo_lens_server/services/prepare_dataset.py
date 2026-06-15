from __future__ import annotations

import hashlib
import json
import time

from phylo_lens_server.clustering.threshold_hierarchy import (
    ThresholdHierarchyBuildError,
    ThresholdHierarchyBuildStats,
    build_threshold_hierarchy_with_stats,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    PrepareDatasetResult,
    PrepareDatasetStats,
    PreparedDatasetRecord,
    SourceFormat,
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
    fingerprint = prepare_request_fingerprint(request)

    cached = store.load_prepare_cache(
        fingerprint,
        dataset_id=request.dataset_name,
    )

    if cached is not None:
        return restore_cached_prepared_dataset(cached, store)

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
    store.save_prepare_cache(fingerprint, record)
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
            layout_iterations=hierarchy_stats.layout_iterations,
            cluster_ms=hierarchy_stats.cluster_ms,
            geometry_ms=hierarchy_stats.geometry_ms,
            spatial_index_ms=hierarchy_stats.spatial_index_ms,
            store_ms=round(store_ms, DEFAULT_ROUND_DECIMALS),
        ),
        warnings=warnings,
    )


def restore_cached_prepared_dataset(
    record: PreparedDatasetRecord,
    store: DatasetStore,
) -> PrepareDatasetResult:
    """Restore a cached prepared record into the normal dataset-id store."""
    store_start = time.perf_counter()
    store.save(record)
    store_ms = elapsed_ms(store_start)

    return cached_prepare_result(record, store_ms)


def cached_prepare_result(
    record: PreparedDatasetRecord,
    store_ms: float,
) -> PrepareDatasetResult:
    return PrepareDatasetResult(
        dataset_id=record.dataset.dataset_id,
        stats=PrepareDatasetStats(
            node_count=len(record.dataset.nodes),
            edge_count=len(record.dataset.edges),
            cache_hit=True,
            ingest_ms=0.0,
            normalize_ms=0.0,
            hierarchy_ms=0.0,
            topology_ms=0.0,
            thresholds_ms=0.0,
            components_ms=0.0,
            layout_ms=0.0,
            layout_iterations=0,
            cluster_ms=0.0,
            geometry_ms=0.0,
            spatial_index_ms=0.0,
            store_ms=round(store_ms, DEFAULT_ROUND_DECIMALS),
        ),
        warnings=record.warnings,
    )


def prepare_request_fingerprint(request: NormalizeRequest) -> str:
    """Fingerprint the content-affecting request fields.

    The dataset name is intentionally excluded so the same content can be reused
    under a different dataset id.
    """
    payload = request.model_dump(
        mode="json",
        exclude={"dataset_name"},
    )
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return hashlib.sha256(encoded).hexdigest()


def build_prepared_hierarchy(
    dataset: CanonicalDataset,
) -> tuple[CanonicalDataset, ThresholdHierarchyIndex, ThresholdHierarchyBuildStats]:
    if not should_use_distance_threshold_hierarchy(dataset):
        raise ThresholdHierarchyBuildError(ERR_THRESHOLD_ONLY_PREPARE)

    hierarchy, stats = build_threshold_hierarchy_with_stats(dataset)
    return dataset, hierarchy, stats


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


def should_use_distance_threshold_hierarchy(dataset: CanonicalDataset) -> bool:
    # if dataset.source.format is SourceFormat.TYPING_DATA:
    #     return False

    return len(dataset.edges) > 0 and all(
        edge.distance is not None for edge in dataset.edges
    )


def elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000
