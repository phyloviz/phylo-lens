from __future__ import annotations

from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from phylo_lens_server.domain.ancillary import (
    AncillaryData,
    AncillaryField,
    AncillaryObservation,
)
from phylo_lens_server.domain.models import SourceFormat
from phylo_lens_server.domain.preparation import PrepareInput, PrepareOptions
from phylo_lens_server.domain.revisions import AncillaryTable
from phylo_lens_server.domain.sfdp import SfdpOptions
from phylo_lens_server.domain.views import LayoutStatus


class NormalizeOptions(BaseModel):
    allow_self_loops: bool = False


class AncillaryDataRequest(BaseModel):
    """Tabular ancillary observations supplied alongside graph/tree content."""

    content: str = Field(min_length=1)
    join_column: str = Field(min_length=1)
    format: Literal["auto", "csv", "tsv"] = "auto"


class NormalizeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    format: SourceFormat
    dataset_name: str = Field(default="dataset", min_length=1)
    content: str = Field(min_length=1)
    options: NormalizeOptions = Field(default_factory=NormalizeOptions)
    ancillary_schema: list[AncillaryField] = Field(
        default_factory=list, alias="metadata_schema"
    )
    ancillary_by_node_id: dict[str, AncillaryData] = Field(
        default_factory=dict, alias="metadata_by_node_id"
    )
    ancillary_data: AncillaryDataRequest | None = None
    sfdp_options: SfdpOptions = Field(default_factory=SfdpOptions)

    @model_validator(mode="before")
    @classmethod
    def reject_ambiguous_aliases(cls, data):
        if isinstance(data, dict):
            for current, legacy in (
                ("ancillary_schema", "metadata_schema"),
                ("ancillary_by_node_id", "metadata_by_node_id"),
            ):
                if current in data and legacy in data:
                    raise ValueError(
                        f"Supply {current} or deprecated {legacy}, not both."
                    )
        return data

    def to_domain(self) -> PrepareInput:
        return PrepareInput(
            format=self.format,
            content=self.content,
            dataset_name=self.dataset_name,
            options=PrepareOptions(self.options.allow_self_loops),
            ancillary_schema=tuple(self.ancillary_schema),
            ancillary_by_node_id=MappingProxyType(
                {key: dict(value) for key, value in self.ancillary_by_node_id.items()}
            ),
            ancillary_data=AncillaryTable(**self.ancillary_data.model_dump())
            if self.ancillary_data
            else None,
            sfdp_options=self.sfdp_options,
        )


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
    status: Literal["pending", "ready", "failed"]
    dataset_id: str


class GraphPrepareStatus(BaseModel):
    job_id: str
    status: Literal["pending", "ready", "failed"]
    result: GraphPrepareResponse | None = None
    error: str | None = None
    error_details: dict[str, str | int | float | None] | None = None


class GraphViewportBounds(BaseModel):
    xmin: float = Field(allow_inf_nan=False)
    xmax: float = Field(allow_inf_nan=False)
    ymin: float = Field(allow_inf_nan=False)
    ymax: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_order(self) -> GraphViewportBounds:
        if self.xmax < self.xmin or self.ymax < self.ymin:
            raise ValueError("Viewport bounds must be ordered.")
        return self


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
    max_nodes: int | None = Field(default=None, ge=1)
    lod_target_representations: int | None = Field(default=None, ge=1)
    lod_selection_bounds: GraphViewportBounds | None = None
    previous_lod_level: int | None = Field(default=None, ge=0)

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


class GraphAncillaryField(BaseModel):
    key: str
    type: str


class GraphIsolate(BaseModel):
    """API v1 names; the domain stores ancillary_data instead of metadata."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: str = Field(min_length=1)
    metadata: dict[str, str | float | bool | None] = Field(
        default_factory=dict, validation_alias="ancillary_data"
    )


class GraphViewportNode(BaseModel):
    id: str
    cluster_id: str
    x: float
    y: float
    layout_status: LayoutStatus
    member_count: int = Field(default=1, ge=1)
    is_representative: bool = False
    metadata: dict[str, str | float | bool | None] | None = None
    isolates: list[GraphIsolate] = Field(default_factory=list)
    ancillary_distribution: list[AncillaryObservation] = Field(default_factory=list)


class GraphViewportEdge(BaseModel):
    id: str
    source: str
    target: str
    distance: float | None = None
    is_meta: bool | None = None


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
    metadata_schema: list[GraphAncillaryField] = Field(default_factory=list)


class GraphRegionQuery(BaseModel):
    dataset_id: str = Field(min_length=1)
    layout_version: str | None = None
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    max_nodes: int | None = Field(default=None, ge=1)

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
    metadata_schema: list[GraphAncillaryField] = Field(default_factory=list)
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
