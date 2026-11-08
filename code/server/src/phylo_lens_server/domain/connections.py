"""Values for additional connections; these never become tree topology."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from .models import GraphEdge, SourceFormat

DistanceMetric = Literal["allelic", "patristic"]


@dataclass(frozen=True)
class ConnectionContext:
    node_components: Mapping[str, str]
    tree_edges: tuple[GraphEdge, ...]


@dataclass(frozen=True)
class ConnectionQuery:
    dataset_id: str
    layout_version: str
    format: SourceFormat
    content: str
    threshold: float
    max_connections: int = 50_000


@dataclass(frozen=True)
class ConnectionResult:
    dataset_id: str
    layout_version: str
    metric: DistanceMetric
    threshold: float
    edges: tuple[GraphEdge, ...]


class ConnectionLimitError(ValueError):
    pass
