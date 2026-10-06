from __future__ import annotations

from enum import StrEnum

from pydantic import Field, model_validator

from .ancillary import (
    AncillaryField,
    NodeAnnotations,
    ReadonlyAncillaryData,
)
from .values import FrozenMapping, FrozenValue

NEWICK_ROOTING_STRATEGY = "newick-component-root-v1"
GOEBURST_ROOTING_STRATEGY = "goeburst-lv-v1"


class SourceFormat(StrEnum):
    """Supported dataset source families in the current server contract."""

    NEWICK = "newick"
    TYPING_DATA = "typing_data"


class GraphNode(FrozenValue):
    """A graph node; its identity is not necessarily an isolate or sequence type."""

    id: str = Field(min_length=1)
    x: float | None = None
    y: float | None = None
    cluster_id: str | None = None
    is_cluster_proxy: bool | None = None
    is_cluster_skeleton: bool | None = None
    subtree_size: int | None = Field(default=None, ge=1)
    leaf_count: int | None = Field(default=None, ge=1)


class GraphEdge(FrozenValue):
    """An edge linking two graph nodes."""

    id: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    distance: float | None = Field(default=None, ge=0)


class DatasetSource(FrozenValue):
    """Capture ingest source format and provenance for reproducibility."""

    format: SourceFormat
    generated_at: str = Field(min_length=1)
    provenance: str | None = None
    rooting_strategy: str = Field(min_length=1)


class Isolate(FrozenValue):
    """An original isolate identity and its ancillary observations."""

    id: str = Field(min_length=1)
    ancillary_data: ReadonlyAncillaryData = Field(default_factory=dict)


class Dataset(FrozenValue):
    """Graph topology, isolate membership, and separately typed annotations."""

    dataset_id: str = Field(min_length=1)
    isolates_by_node_id: FrozenMapping[str, tuple[Isolate, ...]] = Field(
        default_factory=dict
    )
    nodes: tuple[GraphNode, ...]
    edges: tuple[GraphEdge, ...]
    technical_roots: tuple[str, ...]
    ancillary_schema: tuple[AncillaryField, ...] = Field(default_factory=tuple)
    summary_schema: tuple[AncillaryField, ...] = Field(default_factory=tuple)
    annotations_by_node_id: FrozenMapping[str, NodeAnnotations] = Field(
        default_factory=dict
    )
    ancillary_rows_by_node_id: FrozenMapping[str, tuple[ReadonlyAncillaryData, ...]] = (
        Field(default_factory=dict)
    )
    source: DatasetSource

    @model_validator(mode="after")
    def validate_roots(self):
        neighbors = {node.id: set() for node in self.nodes}
        for edge in self.edges:
            if edge.source in neighbors and edge.target in neighbors:
                neighbors[edge.source].add(edge.target)
                neighbors[edge.target].add(edge.source)
        unseen = set(neighbors)
        components: list[set[str]] = []
        while unseen:
            component = set()
            frontier = [next(iter(unseen))]
            while frontier:
                node = frontier.pop()
                if node in component:
                    continue
                component.add(node)
                frontier.extend(neighbors[node] - component)
            components.append(component)
            unseen -= component
        if len(self.technical_roots) != len(components) or any(
            len(component.intersection(self.technical_roots)) != 1
            for component in components
        ):
            raise ValueError(
                "Every tree component requires exactly one technical root."
            )
        if self.source.format == SourceFormat.TYPING_DATA and len(components) != 1:
            raise ValueError("A goeBURST Full MST must be one connected tree.")
        expected_strategy = (
            GOEBURST_ROOTING_STRATEGY
            if self.source.format == SourceFormat.TYPING_DATA
            else NEWICK_ROOTING_STRATEGY
        )
        if self.source.rooting_strategy != expected_strategy:
            raise ValueError("Rooting strategy does not match the dataset source.")
        return self


class DomainValidationError(Exception):
    """Domain-level validation error carrying one or more invariant failures."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))
