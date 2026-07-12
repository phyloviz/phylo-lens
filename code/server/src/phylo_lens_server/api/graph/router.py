from __future__ import annotations

import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from phylo_lens_server.api.errors import (
    domain_validation_error_to_http,
    not_found_error,
    parse_error_to_http,
    pydantic_validation_error_to_http,
    unexpected_server_error,
)
from phylo_lens_server.api.graph.dependencies import (
    get_prepare_job_registry,
    get_prepared_layout_store,
)
from phylo_lens_server.api.graph.responses import (
    graph_region_response_from_result,
    graph_search_response_from_result,
    graph_viewport_response_from_result,
    prepare_response_from_result,
)
from phylo_lens_server.api.graph.schemas import (
    GraphPrepareJob,
    GraphPrepareStatus,
    GraphRegionQuery,
    GraphRegionResponse,
    GraphSearchQuery,
    GraphSearchResponse,
    GraphViewportQuery,
    GraphViewportResponse,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    DomainValidationError,
)
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.parsers import ParseError
from phylo_lens_server.prepared_layout.jobs import (
    JOB_STATUS_FAILED,
    JOB_STATUS_READY,
    PrepareJobRegistry,
    PrepareJobSnapshot,
)
from phylo_lens_server.prepared_layout.store.prepared_layout_store import (
    PreparedLayoutStore,
)

ROUTER_PREFIX = "/api/graph"
ROUTER_TAG = "graph"

ROUTE_PREPARE = "/prepare"
ROUTE_PREPARE_STATUS = "/prepare/{job_id}"
ROUTE_VIEWPORT = "/viewport"
ROUTE_REGION = "/region"
ROUTE_SEARCH = "/search"

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])
logger = logging.getLogger(__name__)


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


@router.post(
    ROUTE_PREPARE,
    response_model=GraphPrepareJob,
    status_code=status.HTTP_202_ACCEPTED,
)
def prepare_graph(
    request: NormalizeRequest,
    registry: PrepareJobRegistry = Depends(get_prepare_job_registry),
) -> GraphPrepareJob:
    try:
        normalized = normalize_dataset(request, expose_internal_schema=True)
        dataset, distance_warnings = ensure_graph_edge_distances(
            normalized.dataset,
        )
        submit_warnings = (*normalized.warnings, *distance_warnings)
        job_id = registry.submit(dataset, submit_warnings)
        return GraphPrepareJob(
            job_id=job_id,
            status="pending",
            dataset_id=dataset.dataset_id,
        )

    except ParseError as exc:
        raise parse_error_to_http(exc) from exc
    except DomainValidationError as exc:
        raise domain_validation_error_to_http(exc) from exc
    except ValidationError as exc:
        raise pydantic_validation_error_to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


@router.get(
    ROUTE_PREPARE_STATUS,
    response_model=GraphPrepareStatus,
    response_model_exclude_none=True,
)
def prepare_graph_status(
    job_id: str,
    registry: PrepareJobRegistry = Depends(get_prepare_job_registry),
) -> GraphPrepareStatus:
    snapshot = registry.snapshot(job_id)
    if snapshot is None:
        raise not_found_error(f"Prepare job '{job_id}' was not found.")

    if snapshot.status == JOB_STATUS_READY and snapshot.result is not None:
        return GraphPrepareStatus(
            job_id=snapshot.job_id,
            status=snapshot.status,
            result=prepare_response_from_result(
                _dataset_id_for_snapshot(snapshot),
                snapshot.result,
                snapshot.warnings,
            ),
        )
    if snapshot.status == JOB_STATUS_FAILED:
        return GraphPrepareStatus(
            job_id=snapshot.job_id,
            status=snapshot.status,
            error=snapshot.error or "Layout preparation failed.",
        )
    return GraphPrepareStatus(job_id=snapshot.job_id, status=snapshot.status)


def _dataset_id_for_snapshot(snapshot: PrepareJobSnapshot) -> str:
    assert snapshot.result is not None
    return snapshot.result.artifacts.dataset.dataset_id


@router.post(
    ROUTE_VIEWPORT,
    response_model=GraphViewportResponse,
    response_model_exclude_none=True,
)
def read_graph_viewport(
    query: GraphViewportQuery,
    store: PreparedLayoutStore = Depends(get_prepared_layout_store),
) -> GraphViewportResponse:
    try:
        layout_version = query.layout_version or store.latest_layout_version(
            query.dataset_id
        )
        if layout_version is None:
            raise not_found_error(
                f"Prepared layout for dataset '{query.dataset_id}' was not found."
            )

        read_started = perf_counter()
        result = store.read_viewport(
            dataset_id=query.dataset_id,
            layout_version=layout_version,
            xmin=query.xmin,
            xmax=query.xmax,
            ymin=query.ymin,
            ymax=query.ymax,
            max_nodes=query.max_nodes,
            lod_level=effective_lod_level(query),
            cluster_id=query.cluster_id,
        )
        read_ms = (perf_counter() - read_started) * 1000.0

        serialize_started = perf_counter()
        response = graph_viewport_response_from_result(
            result,
            lod_level=effective_lod_level(query),
            zoom=query.zoom,
        )
        serialize_ms = (perf_counter() - serialize_started) * 1000.0
        logger.info(
            "graph viewport dataset_id=%s layout_version=%s lod_level=%s "
            "cluster_id=%s bounds=%s nodes=%s edges=%s total=%s truncated=%s "
            "max_nodes=%s read_ms=%.1f serialize_ms=%.1f",
            query.dataset_id,
            layout_version,
            effective_lod_level(query),
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
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


@router.post(
    ROUTE_REGION,
    response_model=GraphRegionResponse,
    response_model_exclude_none=True,
)
def read_graph_region(
    query: GraphRegionQuery,
    store: PreparedLayoutStore = Depends(get_prepared_layout_store),
) -> GraphRegionResponse:
    try:
        layout_version = query.layout_version or store.latest_layout_version(
            query.dataset_id
        )
        if layout_version is None:
            raise not_found_error(
                f"Prepared layout for dataset '{query.dataset_id}' was not found."
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
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


@router.post(
    ROUTE_SEARCH,
    response_model=GraphSearchResponse,
    response_model_exclude_none=True,
)
def search_graph_nodes(
    query: GraphSearchQuery,
    store: PreparedLayoutStore = Depends(get_prepared_layout_store),
) -> GraphSearchResponse:
    try:
        layout_version = query.layout_version or store.latest_layout_version(
            query.dataset_id
        )
        if layout_version is None:
            raise not_found_error(
                f"Prepared layout for dataset '{query.dataset_id}' was not found."
            )

        result = store.search_nodes(
            dataset_id=query.dataset_id,
            layout_version=layout_version,
            query=query.query,
            limit=query.limit,
        )

        return graph_search_response_from_result(result)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc
