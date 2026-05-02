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

    TREE = "tree"
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
    source: DatasetSource


class HierarchyCluster(BaseModel):
    """Deterministic hierarchy entry used by server-side LoD processing."""

    cluster_id: str = Field(min_length=1)
    parent_cluster_id: str | None = None
    child_cluster_ids: list[str] = Field(default_factory=list)
    representative_node_id: str | None = None
    preorder_index: int = Field(ge=0)
    postorder_index: int = Field(ge=0)
    subtree_size: int = Field(ge=1)
    leaf_count: int = Field(ge=1)
    depth: int = Field(ge=0)
    min_depth: int = Field(ge=0)
    max_depth: int = Field(ge=0)
    centroid: dict[str, float] | None = None
    bounds: dict[str, float] | None = None
    aggregate_metadata: dict[str, str | float | bool | None] = Field(
        default_factory=dict
    )


class HierarchyIndex(BaseModel):
    """Persisted hierarchy index backing visible-slice selection."""

    kind: Literal[HierarchyKind.TREE] = HierarchyKind.TREE
    dataset_id: str = Field(min_length=1)
    root_cluster_id: str = Field(min_length=1)
    clusters: dict[str, HierarchyCluster]


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

    dataset_id: str = Field(min_length=1)
    viewport: Viewport
    zoom: float = Field(ge=0)
    lod_hint: int | None = Field(default=None, ge=0)
    max_nodes: int | None = Field(default=None, ge=1)
    focus_node_id: str | None = None
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


class VisibleSliceResponse(BaseModel):
    """Bounded graph slice returned for semantic zoom rendering."""

    dataset_id: str = Field(min_length=1)
    lod_level: int = Field(ge=0)
    nodes: list[CanonicalNode]
    edges: list[CanonicalEdge]
    collapsed_clusters: list[CollapsedCluster] = Field(default_factory=list)
    view_meta: VisibleSliceViewMeta


class PreparedDatasetRecord(BaseModel):
    """Persisted dataset plus hierarchy used by LoD endpoints."""

    dataset: CanonicalDataset
    hierarchy: HierarchyIndex | ThresholdHierarchyIndex = Field(discriminator="kind")
    warnings: list[str] = Field(default_factory=list)


class PrepareDatasetStats(BaseModel):
    """Timings and counts captured while preparing a dataset for LoD queries."""

    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    ingest_ms: float = Field(ge=0)
    normalize_ms: float = Field(ge=0)
    hierarchy_ms: float = Field(ge=0)
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
