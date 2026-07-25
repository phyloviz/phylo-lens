from __future__ import annotations

import logging
from time import perf_counter

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.domain.models import CanonicalDataset, CanonicalEdge
from phylo_lens_server.http.graph.responses import (
    graph_region_response_from_result,
    graph_search_response_from_result,
    graph_viewport_response_from_result,
)
from phylo_lens_server.http.graph.schemas import (
    GraphPrepareJob,
    GraphPrepareResponse,
    GraphPrepareStatus,
    GraphRegionQuery,
    GraphRegionResponse,
    GraphSearchQuery,
    GraphSearchResponse,
    GraphViewportQuery,
    GraphViewportResponse,
)
from phylo_lens_server.repository.jobs.local import (
    JOB_STATUS_FAILED,
    JOB_STATUS_READY,
    PrepareJobRegistry,
)
from phylo_lens_server.repository.jobs.result_payload import prepare_result_payload
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)

logger = logging.getLogger(__name__)


class PreparedLayoutNotFoundError(LookupError):
    """Raised when a dataset has no published prepared layout."""


def prepare_graph_job(
    request: NormalizeRequest,
    registry: PrepareJobRegistry,
) -> GraphPrepareJob:
    reservation = getattr(registry, "reserve_capacity", None)
    if callable(reservation):
        with reservation():
            normalized = normalize_dataset(request, expose_internal_schema=True)
            dataset, distance_warnings = ensure_graph_edge_distances(normalized.dataset)
            submit_warnings = (*normalized.warnings, *distance_warnings)
            job_id = registry.submit(
                dataset,
                submit_warnings,
                reserved_capacity=True,
            )
    else:
        normalized = normalize_dataset(request, expose_internal_schema=True)
        dataset, distance_warnings = ensure_graph_edge_distances(normalized.dataset)
        submit_warnings = (*normalized.warnings, *distance_warnings)
        job_id = registry.submit(dataset, submit_warnings)
    return GraphPrepareJob(
        job_id=job_id,
        status="pending",
        dataset_id=dataset.dataset_id,
    )


def prepare_graph_status(
    job_id: str, registry: PrepareJobRegistry
) -> GraphPrepareStatus:
    snapshot = registry.snapshot(job_id)
    if snapshot is None:
        raise KeyError(job_id)

    if snapshot.status == JOB_STATUS_READY and snapshot.result_payload is not None:
        return GraphPrepareStatus(
            job_id=snapshot.job_id,
            status=snapshot.status,
            result=GraphPrepareResponse.model_validate(snapshot.result_payload),
        )
    if snapshot.status == JOB_STATUS_READY and snapshot.result is not None:
        return GraphPrepareStatus(
            job_id=snapshot.job_id,
            status=snapshot.status,
            result=GraphPrepareResponse.model_validate(
                prepare_result_payload(snapshot.result, snapshot.warnings)
            ),
        )
    if snapshot.status == JOB_STATUS_FAILED:
        return GraphPrepareStatus(
            job_id=snapshot.job_id,
            status=snapshot.status,
            error=snapshot.error or "Layout preparation failed.",
        )
    return GraphPrepareStatus(job_id=snapshot.job_id, status=snapshot.status)


def read_graph_viewport(
    query: GraphViewportQuery,
    store: PreparedLayoutStore,
) -> GraphViewportResponse:
    layout_version = resolve_layout_version(
        store, query.dataset_id, query.layout_version
    )
    lod_level = effective_lod_level(query)

    read_started = perf_counter()
    result = store.read_viewport(
        dataset_id=query.dataset_id,
        layout_version=layout_version,
        xmin=query.xmin,
        xmax=query.xmax,
        ymin=query.ymin,
        ymax=query.ymax,
        max_nodes=query.max_nodes,
        lod_level=lod_level,
        cluster_id=query.cluster_id,
        focus_node_id=query.focus_node_id,
    )
    read_ms = (perf_counter() - read_started) * 1000.0

    serialize_started = perf_counter()
    response = graph_viewport_response_from_result(
        result,
        lod_level=lod_level,
        zoom=query.zoom,
    )
    serialize_ms = (perf_counter() - serialize_started) * 1000.0
    logger.info(
        "graph viewport dataset_id=%s layout_version=%s lod_level=%s "
        "cluster_id=%s bounds=%s nodes=%s edges=%s total=%s truncated=%s "
        "max_nodes=%s read_ms=%.1f serialize_ms=%.1f",
        query.dataset_id,
        layout_version,
        lod_level,
        query.cluster_id,
        "present" if query.xmin is not None else "absent",
        len(result.nodes),
        len(result.edges),
        result.total_node_count,
        result.truncated,
        query.max_nodes,
        read_ms,
        serialize_ms,
    )
    return response


def read_graph_region(
    query: GraphRegionQuery,
    store: PreparedLayoutStore,
) -> GraphRegionResponse:
    layout_version = resolve_layout_version(
        store, query.dataset_id, query.layout_version
    )
    result = store.read_region(
        dataset_id=query.dataset_id,
        layout_version=layout_version,
        xmin=query.xmin,
        xmax=query.xmax,
        ymin=query.ymin,
        ymax=query.ymax,
        max_nodes=query.max_nodes,
    )
    return graph_region_response_from_result(result)


def search_graph_nodes(
    query: GraphSearchQuery,
    store: PreparedLayoutStore,
) -> GraphSearchResponse:
    layout_version = resolve_layout_version(
        store, query.dataset_id, query.layout_version
    )
    result = store.search_nodes(
        dataset_id=query.dataset_id,
        layout_version=layout_version,
        query=query.query,
        limit=query.limit,
    )
    return graph_search_response_from_result(result)


def effective_lod_level(query: GraphViewportQuery) -> int | None:
    if query.lod_level is not None:
        return query.lod_level
    if query.zoom < 1.0:
        return 0
    return None


def ensure_graph_edge_distances(
    dataset: CanonicalDataset,
) -> tuple[CanonicalDataset, list[str]]:
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
                        distance=1.0,
                    )
                    for edge in dataset.edges
                ]
            }
        ),
        ["Missing edge distances were assigned a unit distance for layout."],
    )


def resolve_layout_version(
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str | None,
) -> str:
    resolved = layout_version or store.latest_layout_version(dataset_id)
    if resolved is None:
        raise PreparedLayoutNotFoundError(dataset_id)
    return resolved
