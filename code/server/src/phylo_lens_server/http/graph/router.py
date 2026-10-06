from __future__ import annotations

import logging
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from phylo_lens_server.data.parsers import ParseError
from phylo_lens_server.domain.models import DomainValidationError
from phylo_lens_server.domain.revisions import (
    AncillaryLayoutNotFoundError,
    AncillaryTable,
    AncillaryUpdate,
)
from phylo_lens_server.domain.search import SearchQuery
from phylo_lens_server.domain.views import RegionQuery, ViewportBounds, ViewportQuery
from phylo_lens_server.http.errors import (
    domain_validation_error_to_http,
    not_found_error,
    parse_error_to_http,
    pydantic_validation_error_to_http,
)
from phylo_lens_server.http.graph.dependencies import (
    get_prepare_job_registry,
    get_prepared_layout_store,
)
from phylo_lens_server.http.graph.responses import (
    graph_region_response_from_result,
    graph_search_response_from_result,
    graph_viewport_response_from_result,
)
from phylo_lens_server.http.graph.schemas import (
    GraphAncillaryRequest,
    GraphAncillaryResponse,
    GraphPrepareJob,
    GraphPrepareResponse,
    GraphPrepareStatus,
    GraphRegionQuery,
    GraphRegionResponse,
    GraphSearchQuery,
    GraphSearchResponse,
    GraphViewportQuery,
    GraphViewportResponse,
    NormalizeRequest,
)
from phylo_lens_server.jobs.models import (
    PrepareJobs,
    PrepareQueueFullError,
)
from phylo_lens_server.repository.interfaces import LayoutRepository
from phylo_lens_server.services import ancillary, graph_reads, preparation

ROUTER_PREFIX = "/api/graph"
ROUTER_TAG = "graph"

ROUTE_PREPARE = "/prepare"
ROUTE_PREPARE_STATUS = "/prepare/{job_id}"
ROUTE_VIEWPORT = "/viewport"
ROUTE_REGION = "/region"
ROUTE_SEARCH = "/search"

logger = logging.getLogger(__name__)

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])


@router.post(
    ROUTE_PREPARE,
    response_model=GraphPrepareJob,
    status_code=status.HTTP_202_ACCEPTED,
)
def prepare_graph(
    request: NormalizeRequest,
    registry: Annotated[
        PrepareJobs,
        Depends(get_prepare_job_registry),
    ],
) -> GraphPrepareJob:
    try:
        job = preparation.prepare_graph_job(request.to_domain(), registry)
        return GraphPrepareJob(
            job_id=job.job_id, status=job.status, dataset_id=job.dataset_id
        )
    except PrepareQueueFullError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except ParseError as exc:
        raise parse_error_to_http(exc) from exc
    except DomainValidationError as exc:
        raise domain_validation_error_to_http(exc) from exc
    except ValidationError as exc:
        raise pydantic_validation_error_to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    ROUTE_PREPARE_STATUS,
    response_model=GraphPrepareStatus,
    response_model_exclude_none=True,
)
def prepare_graph_status(
    job_id: str,
    registry: Annotated[
        PrepareJobs,
        Depends(get_prepare_job_registry),
    ],
) -> GraphPrepareStatus:
    try:
        snapshot = preparation.prepare_graph_status(job_id, registry)
        return GraphPrepareStatus(
            job_id=snapshot.job_id,
            status=snapshot.status,
            result=GraphPrepareResponse.model_validate(
                snapshot.result, from_attributes=True
            )
            if snapshot.result
            else None,
            error=(snapshot.error or "Layout preparation failed.")
            if snapshot.status == "failed"
            else None,
            error_details=dict(snapshot.error_details)
            if snapshot.error_details
            else None,
        )
    except KeyError:
        raise not_found_error(f"Prepare job '{job_id}' was not found.")


@router.post(
    ROUTE_VIEWPORT,
    response_model=GraphViewportResponse,
    response_model_exclude_none=True,
)
def read_graph_viewport(
    query: GraphViewportQuery,
    store: Annotated[
        LayoutRepository,
        Depends(get_prepared_layout_store),
    ],
) -> GraphViewportResponse:
    try:
        read_started = perf_counter()
        bounds = query.lod_selection_bounds
        internal_query = ViewportQuery(
            **query.model_dump(exclude={"lod_selection_bounds"}),
            lod_selection_bounds=ViewportBounds(**bounds.model_dump())
            if bounds
            else None,
        )
        result = graph_reads.read_graph_viewport(internal_query, store)
        read_ms = (perf_counter() - read_started) * 1000.0
        serialize_started = perf_counter()
        response = graph_viewport_response_from_result(result)
        serialize_ms = (perf_counter() - serialize_started) * 1000.0
        logger.info(
            "graph viewport dataset_id=%s layout_version=%s lod_level=%s "
            "cluster_id=%s bounds=%s nodes=%s edges=%s total=%s truncated=%s "
            "max_nodes=%s read_ms=%.1f serialize_ms=%.1f",
            query.dataset_id,
            result.layout_version,
            result.lod_level,
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
    except graph_reads.PreparedLayoutNotFoundError as exc:
        raise not_found_error(
            f"Prepared layout for dataset '{query.dataset_id}' was not found."
        ) from exc


@router.post(
    ROUTE_REGION,
    response_model=GraphRegionResponse,
    response_model_exclude_none=True,
)
def read_graph_region(
    query: GraphRegionQuery,
    store: Annotated[
        LayoutRepository,
        Depends(get_prepared_layout_store),
    ],
) -> GraphRegionResponse:
    try:
        return graph_region_response_from_result(
            graph_reads.read_graph_region(RegionQuery(**query.model_dump()), store)
        )
    except graph_reads.PreparedLayoutNotFoundError as exc:
        raise not_found_error(
            f"Prepared layout for dataset '{query.dataset_id}' was not found."
        ) from exc


@router.post(
    ROUTE_SEARCH,
    response_model=GraphSearchResponse,
    response_model_exclude_none=True,
)
def search_graph_nodes(
    query: GraphSearchQuery,
    store: Annotated[
        LayoutRepository,
        Depends(get_prepared_layout_store),
    ],
) -> GraphSearchResponse:
    try:
        return graph_search_response_from_result(
            graph_reads.search_graph_nodes(SearchQuery(**query.model_dump()), store)
        )
    except graph_reads.PreparedLayoutNotFoundError as exc:
        raise not_found_error(
            f"Prepared layout for dataset '{query.dataset_id}' was not found."
        ) from exc


@router.put("/ancillary", response_model=GraphAncillaryResponse)
def apply_ancillary_data(
    request: GraphAncillaryRequest,
    store: Annotated[LayoutRepository, Depends(get_prepared_layout_store)],
) -> GraphAncillaryResponse:
    """Replace metadata in a new version, reusing the source's prepared geometry."""
    try:
        result = ancillary.apply_ancillary_data(
            AncillaryUpdate(
                request.dataset_id,
                request.layout_version,
                AncillaryTable(**request.ancillary_data.model_dump()),
            ),
            store,
        )
        return GraphAncillaryResponse(
            dataset_id=result.dataset_id,
            layout_version=result.layout_version,
            matched_node_count=result.matched_node_count,
            warnings=list(result.warnings),
        )
    except AncillaryLayoutNotFoundError as exc:
        raise not_found_error("The requested prepared layout was not found.") from exc
    except ParseError as exc:
        raise parse_error_to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
