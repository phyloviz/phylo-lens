from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from phylo_lens_server.data.normalizer import NormalizeRequest
from phylo_lens_server.data.parsers import ParseError
from phylo_lens_server.domain.models import DomainValidationError
from phylo_lens_server.http.errors import (
    domain_validation_error_to_http,
    not_found_error,
    parse_error_to_http,
    pydantic_validation_error_to_http,
    unexpected_server_error,
)
from phylo_lens_server.http.graph.dependencies import (
    get_prepare_job_registry,
    get_prepared_layout_store,
)
from phylo_lens_server.http.graph.schemas import (
    GraphAncillaryRequest,
    GraphAncillaryResponse,
    GraphPrepareJob,
    GraphPrepareStatus,
    GraphRegionQuery,
    GraphRegionResponse,
    GraphSearchQuery,
    GraphSearchResponse,
    GraphViewportQuery,
    GraphViewportResponse,
)
from phylo_lens_server.repository.jobs.local import (
    PrepareJobRegistry,
    PrepareQueueFullError,
)
from phylo_lens_server.repository.layout.ancillary_revision import (
    AncillaryLayoutNotFoundError,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from phylo_lens_server.services import graph_service

ROUTER_PREFIX = "/api/graph"
ROUTER_TAG = "graph"

ROUTE_PREPARE = "/prepare"
ROUTE_PREPARE_STATUS = "/prepare/{job_id}"
ROUTE_VIEWPORT = "/viewport"
ROUTE_REGION = "/region"
ROUTE_SEARCH = "/search"

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])


@router.post(
    ROUTE_PREPARE,
    response_model=GraphPrepareJob,
    status_code=status.HTTP_202_ACCEPTED,
)
def prepare_graph(
    request: NormalizeRequest,
    registry: Annotated[
        PrepareJobRegistry,
        Depends(get_prepare_job_registry),
    ],
) -> GraphPrepareJob:
    try:
        return graph_service.prepare_graph_job(request, registry)
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
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


@router.get(
    ROUTE_PREPARE_STATUS,
    response_model=GraphPrepareStatus,
    response_model_exclude_none=True,
)
def prepare_graph_status(
    job_id: str,
    registry: Annotated[
        PrepareJobRegistry,
        Depends(get_prepare_job_registry),
    ],
) -> GraphPrepareStatus:
    try:
        return graph_service.prepare_graph_status(job_id, registry)
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
        PreparedLayoutStore,
        Depends(get_prepared_layout_store),
    ],
) -> GraphViewportResponse:
    try:
        return graph_service.read_graph_viewport(query, store)
    except graph_service.PreparedLayoutNotFoundError as exc:
        raise not_found_error(
            f"Prepared layout for dataset '{query.dataset_id}' was not found."
        ) from exc
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
    store: Annotated[
        PreparedLayoutStore,
        Depends(get_prepared_layout_store),
    ],
) -> GraphRegionResponse:
    try:
        return graph_service.read_graph_region(query, store)
    except graph_service.PreparedLayoutNotFoundError as exc:
        raise not_found_error(
            f"Prepared layout for dataset '{query.dataset_id}' was not found."
        ) from exc
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
    store: Annotated[
        PreparedLayoutStore,
        Depends(get_prepared_layout_store),
    ],
) -> GraphSearchResponse:
    try:
        return graph_service.search_graph_nodes(query, store)
    except graph_service.PreparedLayoutNotFoundError as exc:
        raise not_found_error(
            f"Prepared layout for dataset '{query.dataset_id}' was not found."
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


@router.put("/ancillary", response_model=GraphAncillaryResponse)
def apply_ancillary_data(
    request: GraphAncillaryRequest,
    store: Annotated[PreparedLayoutStore, Depends(get_prepared_layout_store)],
) -> GraphAncillaryResponse:
    """Replace metadata in a new version, reusing the source's prepared geometry."""
    try:
        return graph_service.apply_ancillary_data(request, store)
    except AncillaryLayoutNotFoundError as exc:
        raise not_found_error("The requested prepared layout was not found.") from exc
    except ParseError as exc:
        raise parse_error_to_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc
