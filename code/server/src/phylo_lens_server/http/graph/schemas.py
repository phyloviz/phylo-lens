from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from phylo_lens_server.data.normalizer import AncillaryDataRequest
from phylo_lens_server.pipeline.models import LayoutStatus

DEFAULT_MAX_VIEWPORT_NODES = 2_500
HARD_MAX_VIEWPORT_NODES = 20_000
DEFAULT_SEARCH_LIMIT = 25
HARD_MAX_SEARCH_LIMIT = 500


class GraphPrepareResponse(BaseModel):
    dataset_id: str
    layout_version: str
    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    cluster_count: int = Field(ge=0)
    lod_tier_count: int = Field(default=1, ge=1)
    layout_status: LayoutStatus
    warnings: list[str] = Field(default_factory=list)


class GraphPrepareJob(BaseModel):
    job_id: str
    status: str
    dataset_id: str


class GraphPrepareStatus(BaseModel):
    job_id: str
    status: str
    result: GraphPrepareResponse | None = None
    error: str | None = None
    error_details: dict[str, str | int | float | None] | None = None


class GraphViewportQuery(BaseModel):
    dataset_id: str = Field(min_length=1)
    layout_version: str | None = None
    cluster_id: str | None = None
    focus_node_id: str | None = None
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
        xmin = self.xmin
        xmax = self.xmax
        ymin = self.ymin
        ymax = self.ymax
        if xmin is None and xmax is None and ymin is None and ymax is None:
            return self
        if xmin is None or xmax is None or ymin is None or ymax is None:
            raise ValueError("xmin, xmax, ymin and ymax must be supplied together.")
        if xmax < xmin:
            raise ValueError("xmax must be greater than or equal to xmin.")
        if ymax < ymin:
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
    is_meta: bool | None = None
    bundled_edge_count: int | None = None


class GraphLayoutBounds(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float


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
    global_bounds: GraphLayoutBounds | None = None
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
        xmin = self.xmin
        xmax = self.xmax
        ymin = self.ymin
        ymax = self.ymax
        if xmax < xmin:
            raise ValueError("xmax must be greater than or equal to xmin.")
        if ymax < ymin:
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


class GraphSearchQuery(BaseModel):
    dataset_id: str = Field(min_length=1)
    layout_version: str | None = None
    query: str = Field(min_length=1)
    limit: int = Field(
        default=DEFAULT_SEARCH_LIMIT,
        ge=1,
        le=HARD_MAX_SEARCH_LIMIT,
    )


class GraphSearchMatch(BaseModel):
    node_id: str
    score: int
    matched_text: str
    cluster_id: str | None = None
    x: float | None = None
    y: float | None = None


class GraphSearchResponse(BaseModel):
    dataset_id: str
    layout_version: str
    query: str
    matches: list[GraphSearchMatch]
    total_count: int


class GraphAncillaryRequest(BaseModel):
    dataset_id: str = Field(min_length=1)
    layout_version: str = Field(min_length=1)
    ancillary_data: AncillaryDataRequest


class GraphAncillaryResponse(BaseModel):
    dataset_id: str
    layout_version: str
    matched_node_count: int = Field(ge=1)
    warnings: list[str] = Field(default_factory=list)
