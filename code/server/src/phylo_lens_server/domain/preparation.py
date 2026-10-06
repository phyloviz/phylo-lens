from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.sfdp import SfdpOptions
from phylo_lens_server.domain.views import LayoutBounds, LayoutStatus

from .ancillary import AncillaryData, AncillaryField
from .models import SourceFormat
from .revisions import AncillaryTable
from .values import FrozenValue


@dataclass(frozen=True)
class PreparedCluster:
    """A collapsed connected descendant subtree (or singleton) in a LoD tier."""

    cluster_id: str
    lod_level: int
    member_node_ids: tuple[str, ...]
    representative_node_id: str

    @property
    def member_count(self) -> int:
        return len(self.member_node_ids)


@dataclass(frozen=True)
class PreparedLayoutArtifacts:
    dataset: Dataset
    layout_version: str
    clusters: tuple[PreparedCluster, ...]
    sfdp_options: SfdpOptions = field(default_factory=SfdpOptions)


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
class QuotientEdge:
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
    prepared_edges: tuple[QuotientEdge, ...] = field(default_factory=tuple)
    layout_status: LayoutStatus = "ready"


@dataclass(frozen=True)
class PrepareOptions:
    allow_self_loops: bool = False


@dataclass(frozen=True)
class PrepareInput:
    format: SourceFormat
    content: str
    dataset_name: str = "dataset"
    options: PrepareOptions = field(default_factory=PrepareOptions)
    ancillary_schema: tuple[AncillaryField, ...] = ()
    ancillary_by_node_id: Mapping[str, AncillaryData] = field(default_factory=dict)
    ancillary_data: AncillaryTable | None = None
    sfdp_options: SfdpOptions = field(default_factory=SfdpOptions)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "ancillary_by_node_id",
            MappingProxyType(
                {
                    key: MappingProxyType(dict(value))
                    for key, value in self.ancillary_by_node_id.items()
                }
            ),
        )


class PreparationSummary(FrozenValue):
    dataset_id: str
    layout_version: str
    node_count: int
    edge_count: int
    cluster_count: int
    lod_tier_count: int = 1
    layout_status: LayoutStatus
    warnings: tuple[str, ...] = ()

    @classmethod
    def from_result(
        cls, result: PreparedLayoutResult, warnings: tuple[str, ...]
    ) -> PreparationSummary:
        levels = {cluster.lod_level for cluster in result.artifacts.clusters}
        return cls(
            dataset_id=result.artifacts.dataset.dataset_id,
            layout_version=result.artifacts.layout_version,
            node_count=len(result.artifacts.dataset.nodes),
            edge_count=len(result.artifacts.dataset.edges),
            cluster_count=len(result.artifacts.clusters),
            lod_tier_count=max(len(levels), 1),
            layout_status=result.layout_status,
            warnings=warnings,
        )
