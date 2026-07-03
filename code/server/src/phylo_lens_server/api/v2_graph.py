from __future__ import annotations

import os
from functools import lru_cache
import logging
from pathlib import Path
from tempfile import gettempdir

from fastapi import APIRouter, HTTPException
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
from phylo_lens_server.prepared_layout.models import LayoutStatus
from phylo_lens_server.prepared_layout.store import PreparedLayoutStore
from phylo_lens_server.prepared_layout.worker import PreparedLayoutWorker

ROUTER_PREFIX = "/api/v2/graph"
ROUTER_TAG = "graph-v2"

ROUTE_PREPARE = "/prepare"
ROUTE_VIEWPORT = "/viewport"

ENV_PREPARED_LAYOUT_STORE_DIR = "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR"
DEFAULT_PREPARED_LAYOUT_STORE_DIR = Path(gettempdir()) / "phylo_lens_prepared_layout"
DEFAULT_MAX_VIEWPORT_NODES = 2_500
HARD_MAX_VIEWPORT_NODES = 20_000

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])
logger = logging.getLogger(__name__)


class GraphV2PrepareResponse(BaseModel):
    dataset_id: str
    layout_version: str
    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    cluster_count: int = Field(ge=0)
    layout_status: LayoutStatus
    warnings: list[str] = Field(default_factory=list)


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


@lru_cache(maxsize=1)
def get_prepared_layout_store() -> PreparedLayoutStore:
    return PreparedLayoutStore(
        os.environ.get(
            ENV_PREPARED_LAYOUT_STORE_DIR,
            str(DEFAULT_PREPARED_LAYOUT_STORE_DIR),
        )
    )


@router.post(
    ROUTE_PREPARE,
    response_model=GraphV2PrepareResponse,
    response_model_exclude_none=True,
)
def prepare_graph_v2(
    request: NormalizeRequest,
    store: PreparedLayoutStore = Depends(get_prepared_layout_store),
) -> GraphV2PrepareResponse:
    """Normalize and materialize graph layout artifacts for v2 viewport reads."""
    try:
        normalized = normalize_dataset(request, expose_internal_schema=True)
        dataset, distance_warnings = ensure_graph_v2_edge_distances(
            normalized.dataset,
        )
        result = PreparedLayoutWorker(store).prepare_dataset(dataset)
        layout_warnings: list[str] = []
        if result.layout_status == "degraded":
            layout_warnings.append(
                "Graphviz 'sfdp' was unavailable; produced a circular fallback "
                "layout instead of a force-directed one. Install Graphviz and "
                "re-prepare for a topology-aware layout."
            )
        return GraphV2PrepareResponse(
            dataset_id=dataset.dataset_id,
            layout_version=result.artifacts.layout_version,
            node_count=len(dataset.nodes),
            edge_count=len(dataset.edges),
            cluster_count=len(result.artifacts.clusters),
            layout_status=result.layout_status,
            warnings=[*normalized.warnings, *distance_warnings, *layout_warnings],
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
        logger.info(
            "graph_v2 viewport dataset_id=%s layout_version=%s lod_level=%s "
            "cluster_id=%s bounds=%s nodes=%s edges=%s total=%s truncated=%s",
            query.dataset_id,
            layout_version,
            effective_lod_level(query),
            query.cluster_id,
            "present" if query.xmin is not None else "absent",
            len(result.nodes),
            len(result.edges),
            result.total_node_count,
            result.truncated,
        )
        return GraphViewportResponse(
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
                )
                for edge in result.edges
            ],
            metadata_schema=[
                GraphMetadataField(key=field.key, type=field.type)
                for field in result.metadata_schema
            ],
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


def ensure_graph_v2_edge_distances(
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
        ["Missing edge distances were assigned a unit distance for v2 layout."],
    )
