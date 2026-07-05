from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from phylo_lens_server.core.models import CanonicalDataset

LayoutStatus = Literal["pending", "refining", "ready", "degraded", "failed"]


@dataclass(frozen=True)
class PreparedCluster:
    cluster_id: str
    threshold: float | None
    member_node_ids: tuple[str, ...]
    representative_node_id: str
    internal_edge_ids: tuple[str, ...]
    boundary_edge_ids: tuple[str, ...]

    @property
    def member_count(self) -> int:
        return len(self.member_node_ids)


@dataclass(frozen=True)
class PreparedLayoutArtifacts:
    dataset: CanonicalDataset
    layout_version: str
    clusters: tuple[PreparedCluster, ...]


@dataclass(frozen=True)
class LayoutBounds:
    min_x: float
    max_x: float
    min_y: float
    max_y: float


@dataclass(frozen=True)
class ClusterLayout:
    dataset_id: str
    layout_version: str
    cluster_id: str
    representative_node_id: str
    member_count: int
    x: float
    y: float
    radius: float
    bounds: LayoutBounds
    status: LayoutStatus


@dataclass(frozen=True)
class NodeLayoutPosition:
    dataset_id: str
    layout_version: str
    cluster_id: str
    node_id: str
    x: float
    y: float
    status: LayoutStatus


@dataclass(frozen=True)
class PreparedEdge:
    dataset_id: str
    layout_version: str
    lod_level: int
    edge_id: str
    source: str
    target: str
    distance: float | None


@dataclass(frozen=True)
class PreparedLayoutResult:
    artifacts: PreparedLayoutArtifacts
    cluster_layouts: tuple[ClusterLayout, ...] = field(default_factory=tuple)
    node_positions: tuple[NodeLayoutPosition, ...] = field(default_factory=tuple)
    prepared_edges: tuple[PreparedEdge, ...] = field(default_factory=tuple)
    layout_status: LayoutStatus = "ready"
    layout_degraded_reason: str | None = None


@dataclass(frozen=True)
class MetadataSchemaField:
    key: str
    type: str


@dataclass(frozen=True)
class ViewportNode:
    node_id: str
    cluster_id: str
    x: float
    y: float
    layout_status: LayoutStatus
    member_count: int = 1
    is_representative: bool = False
    metadata: dict[str, str | float | bool | None] | None = None


@dataclass(frozen=True)
class ViewportEdge:
    edge_id: str
    source: str
    target: str
    distance: float | None
    # Meta-edge fields. Ordinary edges leave these unset (None); rerouted
    # boundary edges of a collapsed cluster set is_meta=True and carry the
    # number of original boundary edges bundled into this single meta-edge.
    is_meta: bool | None = None
    bundled_edge_count: int | None = None


@dataclass(frozen=True)
class ViewportReadResult:
    dataset_id: str
    layout_version: str
    nodes: tuple[ViewportNode, ...]
    edges: tuple[ViewportEdge, ...]
    total_node_count: int
    truncated: bool
    layout_status: LayoutStatus
    metadata_schema: tuple[MetadataSchemaField, ...] = ()
