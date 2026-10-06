"""Ancillary replacement values, separate from geometry and SQL transactions."""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from .ancillary import AncillaryField, NodeAnnotations
from .models import Isolate


@dataclass(frozen=True)
class AncillaryTable:
    content: str
    join_column: str
    format: Literal["auto", "csv", "tsv"] = "auto"


@dataclass(frozen=True)
class AncillarySource:
    node_ids: frozenset[str]
    isolates_by_node_id: Mapping[str, tuple[Isolate, ...]]


@dataclass(frozen=True)
class AncillaryReplacement:
    schema: tuple[AncillaryField, ...]
    annotations_by_node_id: Mapping[str, NodeAnnotations]
    isolates_by_node_id: Mapping[str, tuple[Isolate, ...]]
    matched_node_count: int
    warnings: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "annotations_by_node_id",
            MappingProxyType(dict(self.annotations_by_node_id)),
        )
        object.__setattr__(
            self,
            "isolates_by_node_id",
            MappingProxyType(
                {key: tuple(value) for key, value in self.isolates_by_node_id.items()}
            ),
        )


@dataclass(frozen=True)
class AncillaryUpdate:
    dataset_id: str
    layout_version: str
    ancillary_data: AncillaryTable


@dataclass(frozen=True)
class AncillaryUpdateResult:
    dataset_id: str
    layout_version: str
    matched_node_count: int
    warnings: tuple[str, ...]


class AncillaryLayoutNotFoundError(LookupError):
    """The exact source version is missing or is not published."""
