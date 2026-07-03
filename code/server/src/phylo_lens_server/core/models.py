from __future__ import annotations

from enum import StrEnum
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
    TYPING_DATA = "typing_data"


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
    is_cluster_skeleton: bool | None = None
    subtree_size: int | None = Field(default=None, ge=1)
    leaf_count: int | None = Field(default=None, ge=1)


class CanonicalEdge(BaseModel):
    """Canonical edge endpoint representation linking two canonical node ids."""

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
    ancillary_rows_by_node_id: dict[str, list[dict[str, str | float | bool | None]]] = (
        Field(default_factory=dict)
    )
    source: DatasetSource


class DomainValidationError(Exception):
    """Domain-level validation error carrying one or more invariant failures."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))
