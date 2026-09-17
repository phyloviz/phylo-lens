from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .ancillary import AncillaryData, AncillaryField, AncillaryType, NodeAnnotations
from .legacy_metadata import (
    decode_node_annotations,
    encode_node_annotations,
    is_summary_key,
)

# Deprecated Python import aliases; new domain code uses Ancillary*.
MetadataType = AncillaryType
MetadataField = AncillaryField


class SourceFormat(StrEnum):
    """Supported dataset source families in the current server contract."""

    NEWICK = "newick"
    TYPING_DATA = "typing_data"


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


class Isolate(BaseModel):
    """An original isolate identity and its ancillary observations."""

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1)
    ancillary_data: AncillaryData = Field(default_factory=dict, alias="metadata")

    @property
    def metadata(self) -> AncillaryData:
        """Deprecated compatibility accessor; use ancillary_data."""
        return self.ancillary_data


IsolateRecord = Isolate  # Deprecated import alias.


class CanonicalDataset(BaseModel):
    """Graph topology, isolate membership, and separately typed annotations."""

    dataset_id: str = Field(min_length=1)
    isolates_by_node_id: dict[str, list[Isolate]] = Field(default_factory=dict)
    nodes: list[CanonicalNode]
    edges: list[CanonicalEdge]
    ancillary_schema: list[AncillaryField] = Field(default_factory=list)
    summary_schema: list[AncillaryField] = Field(default_factory=list)
    annotations_by_node_id: dict[str, NodeAnnotations] = Field(default_factory=dict)
    ancillary_rows_by_node_id: dict[str, list[AncillaryData]] = Field(
        default_factory=dict
    )
    source: DatasetSource

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_metadata(cls, data):
        if not isinstance(data, dict):
            return data
        data = dict(data)
        if "metadata_by_node_id" in data:
            if "annotations_by_node_id" in data:
                raise ValueError(
                    "Supply annotations_by_node_id or legacy metadata_by_node_id, not both."
                )
            data["annotations_by_node_id"] = {
                node_id: decode_node_annotations(values)
                for node_id, values in data.pop("metadata_by_node_id").items()
            }
        if "metadata_schema" in data:
            if "ancillary_schema" in data or "summary_schema" in data:
                raise ValueError(
                    "Supply ancillary_schema or legacy metadata_schema, not both."
                )
            fields = [
                AncillaryField.model_validate(value)
                for value in data.pop("metadata_schema")
            ]
            data["ancillary_schema"] = [
                field for field in fields if not is_summary_key(field.key)
            ]
            data["summary_schema"] = [
                field for field in fields if is_summary_key(field.key)
            ]
        return data

    def model_copy(self, *, update=None, deep=False):
        # Older in-process consumers may still copy using the API v1 field names.
        return super().model_copy(
            update=self.accept_legacy_metadata(update or {}), deep=deep
        )

    @property
    def metadata_by_node_id(self) -> dict[str, AncillaryData]:
        """Legacy snapshot for API v1 and existing persistence; do not mutate."""
        return {
            key: encode_node_annotations(value)
            for key, value in self.annotations_by_node_id.items()
        }

    @property
    def metadata_schema(self) -> list[AncillaryField]:
        """Legacy flat schema, including computed fields when requested."""
        return sorted(
            [*self.ancillary_schema, *self.summary_schema], key=lambda field: field.key
        )


class DomainValidationError(Exception):
    """Domain-level validation error carrying one or more invariant failures."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))
