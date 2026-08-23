from __future__ import annotations

from dataclasses import dataclass
import inspect
from pathlib import Path
import tempfile

from .datasets import synthetic_tree_dataset
from .metrics import MetricRecorder
from .paths import bootstrap_server_src
from .serialization import result_to_json_bytes
from .sqlite_inspection import (
    centered_bounds,
    dataset_bounds,
    materialized_size_bytes,
    query_plan_events,
    thresholds,
)

bootstrap_server_src()

from phylo_lens_server.pipeline.ingest import prepare_layout_artifacts  # noqa: E402
from phylo_lens_server.pipeline.layout import compute_prepared_layouts  # noqa: E402
from phylo_lens_server.repository.layout.sqlite_layout_repository import (  # noqa: E402
    PreparedLayoutStore,
)
from phylo_lens_server.pipeline.worker import compute_prepared_edges  # noqa: E402


DEFAULT_SEARCH_LIMIT = 25
LAYOUT_ACCEPTS_MAXITER = "maxiter" in inspect.signature(
    compute_prepared_layouts
).parameters


@dataclass(frozen=True)
class ServerProfileConfig:
    shape: str
    metadata_fields: int
    max_nodes: int
    viewport_fractions: tuple[float, ...]
    region_fraction: float
    lod_levels: tuple[int, ...]
    layout_maxiter: int
    search_query: str
    seed: int


def run_one_dataset(
    *,
    config: ServerProfileConfig,
    recorder: MetricRecorder,
    size: int,
) -> None:
    with tempfile.TemporaryDirectory(prefix="phylo-lens-profile-") as temp_dir:
        store = PreparedLayoutStore(Path(temp_dir) / "store")

        with recorder.stage("generate_dataset"):
            dataset = synthetic_tree_dataset(
                node_count=size,
                shape=config.shape,
                metadata_fields=config.metadata_fields,
                seed=config.seed,
            )

        recorder.emit(
            "dataset",
            dataset_id=dataset.dataset_id,
            actual_nodes=len(dataset.nodes),
            actual_edges=len(dataset.edges),
            metadata_fields=len(dataset.metadata_schema),
        )

        with recorder.stage("prepare_lod_artifacts"):
            artifacts = prepare_layout_artifacts(dataset)

        with recorder.stage("compute_prepared_edges"):
            prepared_edges = compute_prepared_edges(artifacts)

        with recorder.stage(
            "compute_layout",
            layout_maxiter=config.layout_maxiter,
        ):
            if LAYOUT_ACCEPTS_MAXITER:
                cluster_layouts, node_positions = compute_prepared_layouts(
                    artifacts,
                    maxiter=config.layout_maxiter,
                )
            else:
                cluster_layouts, node_positions = compute_prepared_layouts(artifacts)

        with recorder.stage("persist_artifacts"):
            store.save_artifacts(
                artifacts,
                status="ready",
                stage_factory=recorder.stage,
            )

        with recorder.stage("persist_layouts"):
            store.save_layouts(
                cluster_layouts,
                node_positions,
                stage_factory=recorder.stage,
            )

        with recorder.stage("persist_prepared_edges"):
            store.save_prepared_edges(
                prepared_edges,
                stage_factory=recorder.stage,
            )

        layout_version = artifacts.layout_version
        full_bounds = dataset_bounds(store, dataset.dataset_id, layout_version)
        tier_thresholds = thresholds(store, dataset.dataset_id, layout_version)
        recorder.emit(
            "summary",
            dataset_id=dataset.dataset_id,
            layout_version=layout_version,
            lod_tier_count=len(tier_thresholds),
            clusters=len(artifacts.clusters),
            prepared_edges=len(prepared_edges),
            node_positions=len(node_positions),
            cluster_layouts=len(cluster_layouts),
            sqlite_bytes=materialized_size_bytes(store.path),
        )

        emit_query_plans(
            recorder,
            store=store,
            dataset_id=dataset.dataset_id,
            layout_version=layout_version,
            tier_thresholds=tier_thresholds,
            viewport_fractions=config.viewport_fractions,
            max_nodes=config.max_nodes,
            full_bounds=full_bounds,
        )
        profile_viewports(
            recorder,
            store=store,
            dataset_id=dataset.dataset_id,
            layout_version=layout_version,
            tier_count=len(tier_thresholds),
            full_bounds=full_bounds,
            config=config,
        )
        profile_region(
            recorder,
            store=store,
            dataset_id=dataset.dataset_id,
            layout_version=layout_version,
            full_bounds=full_bounds,
            config=config,
        )
        profile_search(
            recorder,
            store=store,
            dataset_id=dataset.dataset_id,
            layout_version=layout_version,
            query=config.search_query,
        )


def emit_query_plans(
    recorder: MetricRecorder,
    *,
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str,
    tier_thresholds: tuple[float, ...],
    viewport_fractions: tuple[float, ...],
    max_nodes: int,
    full_bounds,
) -> None:
    plan_bounds = centered_bounds(full_bounds, viewport_fractions[0])
    plan_threshold = tier_thresholds[0] if tier_thresholds else None
    for query_name, details in query_plan_events(
        store,
        dataset_id=dataset_id,
        layout_version=layout_version,
        threshold=plan_threshold,
        bounds=plan_bounds,
        limit=max_nodes,
    ):
        recorder.emit("query_plan", query=query_name, detail=details)


def profile_viewports(
    recorder: MetricRecorder,
    *,
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str,
    tier_count: int,
    full_bounds,
    config: ServerProfileConfig,
) -> None:
    for lod_level in resolved_lod_levels(config.lod_levels, tier_count):
        for fraction in config.viewport_fractions:
            bounds = centered_bounds(full_bounds, fraction)
            with recorder.stage(
                "read_viewport",
                lod_level=lod_level,
                bounds_fraction=fraction,
                max_nodes=config.max_nodes,
            ):
                result = store.read_viewport(
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    xmin=bounds.xmin,
                    xmax=bounds.xmax,
                    ymin=bounds.ymin,
                    ymax=bounds.ymax,
                    max_nodes=config.max_nodes,
                    lod_level=lod_level,
                )
            recorder.emit(
                "viewport",
                lod_level=lod_level,
                bounds_fraction=fraction,
                nodes=len(result.nodes),
                edges=len(result.edges),
                total_node_count=result.total_node_count,
                truncated=result.truncated,
                representative_nodes=sum(
                    1 for node in result.nodes if node.is_representative
                ),
                metadata_fields=len(result.metadata_schema),
                payload_bytes=len(result_to_json_bytes(result)),
            )


def profile_region(
    recorder: MetricRecorder,
    *,
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str,
    full_bounds,
    config: ServerProfileConfig,
) -> None:
    region_bounds = centered_bounds(full_bounds, config.region_fraction)
    with recorder.stage(
        "read_region",
        bounds_fraction=config.region_fraction,
        max_nodes=config.max_nodes,
    ):
        region = store.read_region(
            dataset_id=dataset_id,
            layout_version=layout_version,
            xmin=region_bounds.xmin,
            xmax=region_bounds.xmax,
            ymin=region_bounds.ymin,
            ymax=region_bounds.ymax,
            max_nodes=config.max_nodes,
        )
    recorder.emit(
        "region",
        bounds_fraction=config.region_fraction,
        nodes=len(region.nodes),
        edges=len(region.edges),
        total_node_count=region.total_node_count,
        truncated=region.truncated,
        metadata_fields=len(region.metadata_schema),
        payload_bytes=len(result_to_json_bytes(region)),
    )


def profile_search(
    recorder: MetricRecorder,
    *,
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str,
    query: str,
) -> None:
    with recorder.stage("search_nodes", query=query):
        search = store.search_nodes(
            dataset_id=dataset_id,
            layout_version=layout_version,
            query=query,
            limit=DEFAULT_SEARCH_LIMIT,
        )
    recorder.emit(
        "search",
        query=query,
        matches=len(search.matches),
        total_count=search.total_count,
        payload_bytes=len(result_to_json_bytes(search)),
    )


def resolved_lod_levels(requested: tuple[int, ...], tier_count: int) -> list[int]:
    if tier_count <= 0:
        return [0]
    result: list[int] = []
    for level in requested:
        resolved = tier_count - 1 if level < 0 else min(level, tier_count - 1)
        if resolved not in result:
            result.append(resolved)
    return result
