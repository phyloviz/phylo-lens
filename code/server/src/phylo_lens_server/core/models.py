from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class MetadataType(StrEnum):
    """Supported scalar metadata types for canonical metadata contracts."""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    NULL = "null"


class SourceFormat(StrEnum):
    """Supported dataset source families in the current server contract."""

    NEWICK = "newick"
    EDGELIST = "edgelist"
    TYPING_DATA = "typing_data"


class HierarchyKind(StrEnum):
    """Supported hierarchy families backing LoD selection."""

    THRESHOLD = "threshold"


class MetadataField(BaseModel):
    """Describe one metadata key and its canonical scalar type."""

    key: str = Field(min_length=1)
    type: MetadataType


class CanonicalNode(BaseModel):
    """Canonical node representation used across server and client modules."""

    id: str = Field(min_length=1)
    x: float | None = None
    y: float | None = None
    cluster_id: str | None = None
    is_cluster_proxy: bool | None = None
    subtree_size: int | None = Field(default=None, ge=1)
    leaf_count: int | None = Field(default=None, ge=1)


class CanonicalEdge(BaseModel):
    """Canonical directed edge representation linking two canonical node ids."""

    id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    distance: float | None = Field(default=None, ge=0)


class DatasetSource(BaseModel):
    """Capture ingest source format and provenance for reproducibility."""

    format: SourceFormat
    generated_at: str = Field(min_length=1)
    provenance: str | None = None


class CanonicalDataset(BaseModel):
    """Canonical graph-plus-metadata contract emitted by normalization workflows."""

    dataset_id: str = Field(min_length=1)
    nodes: list[CanonicalNode]
    edges: list[CanonicalEdge]
    metadata_schema: list[MetadataField] = Field(default_factory=list)
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]] = Field(
        default_factory=dict
    )
    ancillary_rows_by_node_id: dict[
        str, list[dict[str, str | float | bool | None]]
    ] = Field(default_factory=dict)
    source: DatasetSource


class SpatialBounds(BaseModel):
    """Axis-aligned bounds in the same coordinate space as visible-slice queries."""

    min_x: float
    max_x: float
    min_y: float
    max_y: float


class SpatialIndexNode(BaseModel):
    """One static R-tree node over prepared cluster bounds."""

    bounds: SpatialBounds
    child_node_indices: list[int] = Field(default_factory=list)
    cluster_ids: list[str] = Field(default_factory=list)
    cluster_bounds_by_id: dict[str, SpatialBounds] = Field(default_factory=dict)


class SpatialLevelIndex(BaseModel):
    """Static spatial index for clusters belonging to one LoD level."""

    level: int = Field(ge=0)
    root_node_index: int | None = None
    nodes: list[SpatialIndexNode] = Field(default_factory=list)


class ThresholdHierarchyCluster(BaseModel):
    """Threshold-derived cluster entry for weighted unrooted LoD processing."""

    cluster_id: str = Field(min_length=1)
    parent_cluster_id: str | None = None
    child_cluster_ids: list[str] = Field(default_factory=list)
    representative_node_id: str | None = None
    member_node_ids: list[str] = Field(default_factory=list)
    subtree_size: int = Field(ge=1)
    distance_threshold_level: int = Field(ge=0)
    distance_threshold: float | None = Field(default=None, ge=0)
    centroid: dict[str, float] | None = None
    bounds: dict[str, float] | None = None
    aggregate_metadata: dict[str, str | float | bool | None] = Field(
        default_factory=dict
    )


class ThresholdHierarchyIndex(BaseModel):
    """Persisted threshold hierarchy index for weighted datasets."""

    kind: Literal[HierarchyKind.THRESHOLD] = HierarchyKind.THRESHOLD
    dataset_id: str = Field(min_length=1)
    root_cluster_id: str = Field(min_length=1)
    clusters: dict[str, ThresholdHierarchyCluster]
    global_bounds: SpatialBounds | None = None
    max_distance_threshold_level: int = Field(default=0, ge=0)
    cluster_ids_by_level: dict[int, list[str]] = Field(default_factory=dict)
    spatial_index_by_level: dict[int, SpatialLevelIndex] = Field(default_factory=dict)


class Viewport(BaseModel):
    """Viewport request bounds used for visible-slice selection."""

    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class VisibleSliceFilters(BaseModel):
    """Optional metadata filters attached to a visible-slice query."""

    categorical: dict[str, list[str]] = Field(default_factory=dict)
    numeric: dict[str, dict[str, float]] = Field(default_factory=dict)


class VisibleSliceQuery(BaseModel):
    """Runtime query contract for a visible graph slice."""

    dataset_id: str
    viewport: Viewport
    zoom: float
    lod_hint: int | None = None
    max_nodes: int | None = None
    focus_node_id: str | None = None
    focus_cluster_id: str | None = None
    expanded_cluster_ids: list[str] = Field(default_factory=list)
    collapsed_cluster_ids: list[str] = Field(default_factory=list)
    include_metadata_keys: list[str] = Field(default_factory=list)
    filters: VisibleSliceFilters = Field(default_factory=VisibleSliceFilters)


class CollapsedCluster(BaseModel):
    """Collapsed hierarchy region returned in a visible slice."""

    cluster_id: str = Field(min_length=1)
    representative_node_id: str | None = None
    subtree_size: int = Field(ge=1)
    centroid: dict[str, float] | None = None


class VisibleSliceViewMeta(BaseModel):
    """Metadata describing how a visible slice was selected."""

    viewport: Viewport
    zoom: float = Field(ge=0)
    returned_node_count: int = Field(ge=0)
    returned_edge_count: int = Field(ge=0)
    global_bounds: SpatialBounds | None = None
    focus_cluster_id: str | None = None
    focus_cluster_bounds: SpatialBounds | None = None


class VisibleSliceResponse(BaseModel):
    """Bounded graph slice returned for semantic zoom rendering."""

    dataset_id: str = Field(min_length=1)
    lod_level: int = Field(ge=0)
    nodes: list[CanonicalNode]
    edges: list[CanonicalEdge]
    collapsed_clusters: list[CollapsedCluster] = Field(default_factory=list)
    view_meta: VisibleSliceViewMeta


class PreparedSearchIndex(BaseModel):
    """Prepared lookup tables for text/id/metadata node search."""

    node_ids_by_exact_id: dict[str, list[str]] = Field(default_factory=dict)
    node_ids_by_exact_text: dict[str, list[str]] = Field(default_factory=dict)
    node_ids_by_prefix: dict[str, list[str]] = Field(default_factory=dict)
    searchable_text_by_node_id: dict[str, str] = Field(default_factory=dict)
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]] = Field(
        default_factory=dict
    )


class PreparedDatasetRecord(BaseModel):
    """Persisted dataset plus hierarchy used by LoD endpoints."""

    dataset: CanonicalDataset
    hierarchy: ThresholdHierarchyIndex
    warnings: list[str] = Field(default_factory=list)
    search_index: PreparedSearchIndex | None = Field(default=None, exclude=True)


class SearchDatasetQuery(BaseModel):
    """Search request over one prepared dataset."""

    dataset_id: str
    query: str = Field(min_length=1)
    limit: int = Field(default=50, ge=1, le=500)
    include_metadata_keys: list[str] = Field(default_factory=list)


class SearchDatasetMatch(BaseModel):
    """One search hit in a prepared dataset."""

    node_id: str
    score: float = Field(ge=0)
    matched_text: str
    metadata: dict[str, str | float | bool | None] = Field(default_factory=dict)


class SearchDatasetResponse(BaseModel):
    """Search results over one prepared dataset."""

    dataset_id: str
    query: str
    matches: list[SearchDatasetMatch]
    total_count: int = Field(ge=0)



class PrepareDatasetStats(BaseModel):
    """Timings and counts captured while preparing a dataset for LoD queries."""

    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    cache_hit: bool = False
    ingest_ms: float = Field(ge=0)
    normalize_ms: float = Field(ge=0)
    hierarchy_ms: float = Field(ge=0)
    topology_ms: float | None = Field(default=None, ge=0)
    thresholds_ms: float | None = Field(default=None, ge=0)
    components_ms: float | None = Field(default=None, ge=0)
    layout_ms: float | None = Field(default=None, ge=0)
    layout_iterations: int | None = Field(default=None, ge=0)
    cluster_ms: float | None = Field(default=None, ge=0)
    geometry_ms: float | None = Field(default=None, ge=0)
    spatial_index_ms: float | None = Field(default=None, ge=0)
    store_ms: float = Field(ge=0)


class PrepareDatasetResult(BaseModel):
    """Response returned when a dataset is prepared and persisted for LoD use."""

    dataset_id: str = Field(min_length=1)
    stats: PrepareDatasetStats
    warnings: list[str] = Field(default_factory=list)


class DomainValidationError(Exception):
    """Domain-level validation error carrying one or more invariant failures."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))
