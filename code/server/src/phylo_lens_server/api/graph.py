from __future__ import annotations

import os
from functools import lru_cache
import logging
from pathlib import Path
from tempfile import gettempdir
from time import perf_counter

from fastapi import APIRouter, HTTPException, status
from fastapi.params import Depends
from pydantic import BaseModel, Field, ValidationError, model_validator

from phylo_lens_server.api.errors import (
    domain_validation_error_to_http,
    not_found_error,
    parse_error_to_http,
    pydantic_validation_error_to_http,
    unexpected_server_error,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    DomainValidationError,
)
from phylo_lens_server.data.normalizer import (
    NormalizeRequest,
    normalize_dataset,
)
from phylo_lens_server.data.parsers import ParseError
from phylo_lens_server.prepared_layout.jobs import (
    JOB_STATUS_FAILED,
    JOB_STATUS_READY,
    PrepareJobRegistry,
    PrepareJobSnapshot,
)
from phylo_lens_server.prepared_layout.layout import (
    LAYOUT_DEGRADED_SFDP_FAILED,
    LAYOUT_DEGRADED_SFDP_INCOMPLETE,
    LAYOUT_DEGRADED_SFDP_MISSING,
)
from phylo_lens_server.prepared_layout.models import (
    LayoutStatus,
    PreparedLayoutResult,
)
from phylo_lens_server.prepared_layout.store import PreparedLayoutStore
from phylo_lens_server.prepared_layout.worker import PreparedLayoutWorker

ROUTER_PREFIX = "/api/graph"
ROUTER_TAG = "graph"

ROUTE_PREPARE = "/prepare"
ROUTE_PREPARE_STATUS = "/prepare/{job_id}"
ROUTE_VIEWPORT = "/viewport"
ROUTE_REGION = "/region"

ENV_PREPARED_LAYOUT_STORE_DIR = "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR"
DEFAULT_PREPARED_LAYOUT_STORE_DIR = Path(gettempdir()) / "phylo_lens_prepared_layout"
DEFAULT_MAX_VIEWPORT_NODES = 2_500
HARD_MAX_VIEWPORT_NODES = 20_000

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])
logger = logging.getLogger(__name__)

_LAYOUT_DEGRADED_WARNINGS = {
    LAYOUT_DEGRADED_SFDP_MISSING: (
        "Graphviz 'sfdp' was unavailable; produced a circular fallback layout "
        "instead of a force-directed one. Install Graphviz and re-prepare for a "
        "topology-aware layout."
    ),
    LAYOUT_DEGRADED_SFDP_FAILED: (
        "Graphviz 'sfdp' failed to run; produced a circular fallback layout "
        "instead of a force-directed one."
    ),
    LAYOUT_DEGRADED_SFDP_INCOMPLETE: (
        "Graphviz 'sfdp' returned an incomplete layout; produced a circular "
        "fallback layout instead of a force-directed one."
    ),
}
_LAYOUT_DEGRADED_WARNING_FALLBACK = (
    "The layout degraded to a circular fallback instead of a force-directed one."
)


def layout_degraded_warning(reason: str | None) -> str:
    """Map a layout degrade reason to a client-facing warning message."""
    return _LAYOUT_DEGRADED_WARNINGS.get(reason, _LAYOUT_DEGRADED_WARNING_FALLBACK)


class GraphPrepareResponse(BaseModel):
    dataset_id: str
    layout_version: str
    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    cluster_count: int = Field(ge=0)
    # Number of distinct distance thresholds (LoD tiers, coarsest to finest)
    # precomputed for this dataset. The client maps camera zoom onto these tiers
    # for semantic zooming; a value of 1 means only the finest detail exists.
    lod_tier_count: int = Field(default=1, ge=1)
    layout_status: LayoutStatus
    warnings: list[str] = Field(default_factory=list)


class GraphPrepareJob(BaseModel):
    """Acknowledgement returned when a prepare job is accepted.

    Layout runs on a background worker, so ``/prepare`` returns immediately with
    a ``job_id`` the client polls at ``/prepare/{job_id}`` until it is ready.
    """

    job_id: str
    status: str
    dataset_id: str


class GraphPrepareStatus(BaseModel):
    """Poll result for a prepare job.

    ``result`` is populated only once ``status == "ready"``; ``error`` only when
    ``status == "failed"``. Both are absent while the job is still pending.
    """

    job_id: str
    status: str
    result: GraphPrepareResponse | None = None
    error: str | None = None


class GraphViewportQuery(BaseModel):
    dataset_id: str = Field(min_length=1)
    layout_version: str | None = None
    cluster_id: str | None = None
    xmin: float | None = None
    xmax: float | None = None
    ymin: float | None = None
    ymax: float | None = None
    zoom: float = Field(default=1.0, ge=0)
    lod_level: int | None = Field(default=None, ge=0)
    max_nodes: int = Field(
        default=DEFAULT_MAX_VIEWPORT_NODES,
        ge=1,
        le=HARD_MAX_VIEWPORT_NODES,
    )

    @model_validator(mode="after")
    def validate_bounds(self) -> GraphViewportQuery:
        bounds = (self.xmin, self.xmax, self.ymin, self.ymax)
        if all(value is None for value in bounds):
            return self
        if any(value is None for value in bounds):
            raise ValueError("xmin, xmax, ymin and ymax must be supplied together.")
        if self.xmax < self.xmin:
            raise ValueError("xmax must be greater than or equal to xmin.")
        if self.ymax < self.ymin:
            raise ValueError("ymax must be greater than or equal to ymin.")
        return self


class GraphMetadataField(BaseModel):
    key: str
    type: str


class GraphViewportNode(BaseModel):
    id: str
    cluster_id: str
    x: float
    y: float
    layout_status: LayoutStatus
    member_count: int = Field(default=1, ge=1)
    is_representative: bool = False
    metadata: dict[str, str | float | bool | None] | None = None


class GraphViewportEdge(BaseModel):
    id: str
    source: str
    target: str
    distance: float | None = None
    # Meta-edge fields. Left unset (None) for ordinary edges so that
    # response_model_exclude_none keeps their payload unchanged; populated only
    # for rerouted boundary edges of a collapsed cluster.
    is_meta: bool | None = None
    bundled_edge_count: int | None = None


class GraphViewportResponse(BaseModel):
    dataset_id: str
    layout_version: str
    lod_level: int | None = None
    zoom: float
    layout_status: LayoutStatus
    truncated: bool
    total_node_count: int
    nodes: list[GraphViewportNode]
    edges: list[GraphViewportEdge]
    metadata_schema: list[GraphMetadataField] = Field(default_factory=list)


class GraphRegionQuery(BaseModel):
    dataset_id: str = Field(min_length=1)
    layout_version: str | None = None
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    max_nodes: int = Field(
        default=DEFAULT_MAX_VIEWPORT_NODES,
        ge=1,
        le=HARD_MAX_VIEWPORT_NODES,
    )

    @model_validator(mode="after")
    def validate_bounds(self) -> GraphRegionQuery:
        if self.xmax < self.xmin:
            raise ValueError("xmax must be greater than or equal to xmin.")
        if self.ymax < self.ymin:
            raise ValueError("ymax must be greater than or equal to ymin.")
        return self


class GraphRegionResponse(BaseModel):
    dataset_id: str
    layout_version: str
    layout_status: LayoutStatus
    truncated: bool
    total_node_count: int
    nodes: list[GraphViewportNode]
    edges: list[GraphViewportEdge]
    metadata_schema: list[GraphMetadataField] = Field(default_factory=list)
    aggregated_metadata: dict[str, str | float | bool | None] = Field(
        default_factory=dict
    )


@lru_cache(maxsize=1)
def get_prepared_layout_store() -> PreparedLayoutStore:
    return PreparedLayoutStore(
        os.environ.get(
            ENV_PREPARED_LAYOUT_STORE_DIR,
            str(DEFAULT_PREPARED_LAYOUT_STORE_DIR),
        )
    )


@lru_cache(maxsize=1)
def get_prepare_job_registry() -> PrepareJobRegistry:
    return PrepareJobRegistry(PreparedLayoutWorker(get_prepared_layout_store()))


def prepare_response_from_result(
    dataset_id: str,
    result: PreparedLayoutResult,
    submit_warnings: tuple[str, ...],
) -> GraphPrepareResponse:
    """Build the ready-state prepare response from a finished layout result."""
    layout_warnings: list[str] = []
    if result.layout_status == "degraded":
        layout_warnings.append(layout_degraded_warning(result.layout_degraded_reason))
    # Distinct non-None thresholds are the LoD tiers the client can zoom across.
    # This mirrors the enumeration in compute_prepared_edges, where each distinct
    # threshold maps to a lod_level index.
    distinct_thresholds = {
        cluster.threshold
        for cluster in result.artifacts.clusters
        if cluster.threshold is not None
    }
    return GraphPrepareResponse(
        dataset_id=dataset_id,
        layout_version=result.artifacts.layout_version,
        node_count=len(result.artifacts.dataset.nodes),
        edge_count=len(result.artifacts.dataset.edges),
        cluster_count=len(result.artifacts.clusters),
        lod_tier_count=max(len(distinct_thresholds), 1),
        layout_status=result.layout_status,
        warnings=[*submit_warnings, *layout_warnings],
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
    """Submit a background layout job and return a job id to poll.

    Normalization and distance validation run synchronously so malformed input
    fails fast with a 4xx; the force-directed layout itself runs on a background
    worker and is polled via ``/prepare/{job_id}``.
    """
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
    """Poll a prepare job; returns the full response once the layout is ready."""
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
    """Read materialized graph coordinates for one visual viewport."""
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
        response = GraphViewportResponse(
            dataset_id=result.dataset_id,
            layout_version=result.layout_version,
            lod_level=effective_lod_level(query),
            zoom=query.zoom,
            layout_status=result.layout_status,
            truncated=result.truncated,
            total_node_count=result.total_node_count,
            nodes=[
                GraphViewportNode(
                    id=node.node_id,
                    cluster_id=node.cluster_id,
                    x=node.x,
                    y=node.y,
                    layout_status=node.layout_status,
                    member_count=node.member_count,
                    is_representative=node.is_representative,
                    metadata=node.metadata,
                )
                for node in result.nodes
            ],
            edges=[
                GraphViewportEdge(
                    id=edge.edge_id,
                    source=edge.source,
                    target=edge.target,
                    distance=edge.distance,
                    is_meta=edge.is_meta,
                    bundled_edge_count=edge.bundled_edge_count,
                )
                for edge in result.edges
            ],
            metadata_schema=[
                GraphMetadataField(key=field.key, type=field.type)
                for field in result.metadata_schema
            ],
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
    """Read an isolated subgraph for a hand-drawn selection box."""
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

        return GraphRegionResponse(
            dataset_id=result.dataset_id,
            layout_version=result.layout_version,
            layout_status=result.layout_status,
            truncated=result.truncated,
            total_node_count=result.total_node_count,
            nodes=[
                GraphViewportNode(
                    id=node.node_id,
                    cluster_id=node.cluster_id,
                    x=node.x,
                    y=node.y,
                    layout_status=node.layout_status,
                    member_count=node.member_count,
                    is_representative=node.is_representative,
                    metadata=node.metadata,
                )
                for node in result.nodes
            ],
            edges=[
                GraphViewportEdge(
                    id=edge.edge_id,
                    source=edge.source,
                    target=edge.target,
                    distance=edge.distance,
                    is_meta=edge.is_meta,
                    bundled_edge_count=edge.bundled_edge_count,
                )
                for edge in result.edges
            ],
            metadata_schema=[
                GraphMetadataField(key=field.key, type=field.type)
                for field in result.metadata_schema
            ],
            aggregated_metadata=result.aggregated_metadata,
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


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
                ],
            }
        ),
        ["Missing edge distances were assigned a unit distance for layout."],
    )
